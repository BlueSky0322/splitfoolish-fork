// Starts the real Worker with `wrangler dev` against a fresh, empty local D1, for tests
// that go through the API the way the app does. Access is switched off and requests say
// who they are with the X-Dev-User header (see auth.ts).

import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const READY_TIMEOUT_MS = 90_000;

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

export interface LocalWorker {
  /** Calls the API as `who`, returning the status and parsed body */
  call: <T = any>(
    who: string,
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; data: T }>;
  /** The stand-in for Wise and Frankfurter that the Worker gets its rates from */
  rates: FakeRates;
  stop: () => void;
}

export interface FakeRates {
  /** 1 `from` is `rate` `to`, on both services */
  set: (from: string, to: string, rate: number) => void;
  /** Makes one service answer 500 */
  down: (service: 'wise' | 'frankfurter', isDown: boolean) => void;
}

/** A tiny HTTP server answering like Wise's /v1/rates and Frankfurter's /v1/latest */
async function startFakeRates(): Promise<FakeRates & { base: string; close: () => void }> {
  const table = new Map<string, number>();
  const isDown = { wise: false, frankfurter: false };
  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/v1/rates') {
      const [from, to] = [url.searchParams.get('source'), url.searchParams.get('target')];
      const rate = table.get(`${from}${to}`);
      if (isDown.wise || req.headers.authorization !== 'Bearer test-token') return send(500, {});
      return rate == null ? send(400, {}) : send(200, [{ rate, source: from, target: to }]);
    }
    if (url.pathname === '/v1/latest') {
      const [from, to] = [url.searchParams.get('base'), url.searchParams.get('symbols')];
      const rate = table.get(`${from}${to}`);
      if (isDown.frankfurter) return send(500, {});
      return rate == null ? send(404, {}) : send(200, { base: from, rates: { [to!]: rate } });
    }
    send(404, {});
  });
  const port = await freePort();
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
  return {
    base: `http://127.0.0.1:${port}`,
    set: (from, to, rate) => table.set(`${from}${to}`, rate),
    down: (service, value) => {
      isDown[service] = value;
    },
    close: () => server.close(),
  };
}

export async function startLocalWorker(): Promise<LocalWorker> {
  const persist = mkdtempSync(join(tmpdir(), 'splitfoolish-test-'));
  // wrangler dev wants the assets folder to exist, even if the app isn't built
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };

  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'splitfoolish-db',
      '--local',
      '--persist-to',
      persist,
    ],
    { cwd: ROOT, env, stdio: 'pipe' },
  );

  const rates = await startFakeRates();
  const port = await freePort();
  const child: ChildProcess = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(port),
      '--persist-to',
      persist,
      '--var',
      'ACCESS_TEAM_DOMAIN:',
      '--var',
      'ACCESS_AUD:',
      '--var',
      'DEV_USER_EMAIL:nobody@example.com',
      '--var',
      `WISE_BASE:${rates.base}`,
      '--var',
      `FRANKFURTER_BASE:${rates.base}`,
      '--var',
      'WISE_TOKEN:test-token',
      '--var',
      'RECONVERT_RETRY_MS:0',
      '--log-level',
      'warn',
    ],
    { cwd: ROOT, env, stdio: 'pipe', detached: true },
  );
  let output = '';
  child.stdout?.on('data', (d) => (output += d));
  child.stderr?.on('data', (d) => (output += d));

  const base = `http://127.0.0.1:${port}`;
  const stop = () => {
    // The whole group, so workerd goes too
    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch {
      // Already gone
    }
    rates.close();
    rmSync(persist, { recursive: true, force: true });
  };

  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${base}/api/me`);
      if (res.ok) break;
    } catch {
      // Not listening yet
    }
    if (child.exitCode != null || Date.now() - started > READY_TIMEOUT_MS) {
      stop();
      throw new Error(`wrangler dev didn't start:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    stop,
    rates,
    call: async (who, method, path, body, headers = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'X-Dev-User': who, 'Content-Type': 'application/json', ...headers },
        // Bytes (a photo) and strings go as they are; anything else as JSON
        body:
          body === undefined || typeof body === 'string' || body instanceof Uint8Array
            ? (body as BodyInit | undefined)
            : JSON.stringify(body),
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, data };
    },
  };
}
