interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const SPLIT_PATH = /^\/api\/splits\/([A-Za-z0-9_-]{8,64})$/;
const MAX_BODY_BYTES = 256 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(req);
    }

    const match = url.pathname.match(SPLIT_PATH);
    if (!match) return json({ error: 'Not found' }, 404);
    const id = match[1];

    if (req.method === 'GET') {
      const row = await env.DB.prepare('SELECT data FROM splits WHERE id = ?')
        .bind(id)
        .first<{ data: string }>();
      if (!row) return json({ error: 'Not found' }, 404);
      return new Response(row.data, { headers: { 'Content-Type': 'application/json' } });
    }

    if (req.method === 'PUT') {
      const text = await req.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: 'Too large' }, 413);

      let data: { people?: unknown; items?: unknown };
      try {
        data = JSON.parse(text);
      } catch {
        return json({ error: 'Invalid JSON' }, 400);
      }
      if (!Array.isArray(data.people) || !Array.isArray(data.items)) {
        return json({ error: 'Expected { people: [], items: [] }' }, 400);
      }

      await env.DB.prepare(
        `INSERT INTO splits (id, data, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
        .bind(id, JSON.stringify({ people: data.people, items: data.items }), Date.now())
        .run();

      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  },
} satisfies ExportedHandler<Env>;
