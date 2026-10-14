// Starts the real Worker with `wrangler dev` against a fresh, empty local D1, for tests
// that go through the API the way the app does. Access is switched off and requests say
// who they are with the X-Dev-User header (see auth.ts).

import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
  stop: () => void;
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
    call: async (who, method, path, body, headers = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'X-Dev-User': who, 'Content-Type': 'application/json', ...headers },
        body:
          body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
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
