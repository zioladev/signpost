// Signpost evidence collector — provider-participating, browser-originated evidence.
//
// APPEND-ONLY AT THE API SURFACE: POST appends one event; GET reads the log for the
// dashboard. There is no update/delete endpoint. (This is not cryptographic
// immutability — an operator with store access can still edit Redis directly.)
//
// PERSISTENCE: Upstash Redis via its HTTP REST API — zero npm dependencies, just
// fetch. Env vars are read robustly across the common Vercel/Upstash namings.
//
// PROVENANCE: each record is stamped with the browser-set `Origin` header (a page's
// JS cannot forge it cross-origin) and the origin is allowlisted. This is
// provider-participating, browser-originated evidence attributed by Origin — it is
// NOT application-authenticated provider evidence (a non-browser caller could still
// spoof Origin), and we do not claim otherwise.

// Allowlist by registrable HOST, not by an exact origin string. A provider may
// serve from the apex (deckhouse.coffee) or the www. host depending on how the
// deploy resolves, and the browser stamps whichever one the page is actually on;
// an exact-origin Set silently 403s the other form. Matching the host — apex or a
// leading www. — accepts both and still rejects any origin that is not allowlisted.
// https is required (the Origin a page cannot forge cross-origin is only meaningful
// over TLS here). signpost.ziola.dev posts its own discovery-plane events.
const ALLOWED_HOSTS = new Set([
  'deckhouse.coffee',      // commerce provider (gated, emits evidence)
  'chairandcomb.studio',   // booking provider  (gated, emits evidence)
  'signpost.ziola.dev',    // discovery-plane events from Signpost itself
  // note: hexregistry.dev (read-only) emits no evidence, so it needs no entry.
]);

function originAllowed(origin) {
  if (!origin) return false;
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.host.toLowerCase();
  return ALLOWED_HOSTS.has(host) || ALLOWED_HOSTS.has(host.replace(/^www\./, ''));
}

const LIST_KEY = 'signpost:evidence';
const MAX_RETURN = 500;

function redisEnv() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.REDIS_REST_API_URL ||
    '';
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.REDIS_REST_API_TOKEN ||
    '';
  return { url: url.replace(/\/$/, ''), token };
}

// Read the raw request body off the stream. Providers may post evidence as a
// CORS simple request with content-type text/plain. Some runtimes don't populate
// req.body for text/plain, so we fall back to draining the stream ourselves.
// When the runtime has already consumed the stream to build req.body, this
// drains to empty and we use req.body instead. The body is capped so an
// oversized request cannot exhaust memory.
function readRawBody(req) {
  return new Promise((resolve) => {
    try {
      let data = '';
      req.on('data', (chunk) => { data += chunk; if (data.length > 1_000_000) req.destroy(); });
      req.on('end', () => resolve(data));
      req.on('error', () => resolve(''));
    } catch { resolve(''); }
  });
}

// Parse the event body regardless of how (or whether) the runtime pre-parsed it:
// an already-parsed object, a pre-read string, or the raw stream — in that order.
async function parseEvent(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) raw = await readRawBody(req);
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

// Upstash REST: POST the command array to the REST URL with a Bearer token.
async function redisCmd(cmd) {
  const { url, token } = redisEnv();
  if (!url || !token) throw new Error('redis env not configured (need *_REST_API_URL and *_REST_API_TOKEN)');
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error('redis HTTP ' + res.status);
  const data = await res.json();
  if (data && data.error) throw new Error('redis: ' + data.error);
  return data ? data.result : undefined;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    if (req.method === 'POST') {
      // Provenance guard (not authentication): only allowlisted browser origins append.
      if (!originAllowed(origin)) {
        res.status(403).json({ error: 'origin not allowlisted', origin });
        return;
      }
      const body = await parseEvent(req);
      if (!body || typeof body.kind !== 'string') {
        res.status(400).json({ error: 'event needs a string `kind`' });
        return;
      }
      const record = { ...body, origin, received_at: new Date().toISOString() };
      await redisCmd(['RPUSH', LIST_KEY, JSON.stringify(record)]);
      res.status(202).json({ ok: true });
      return;
    }

    if (req.method === 'GET') {
      const raw = await redisCmd(['LRANGE', LIST_KEY, String(-MAX_RETURN), '-1']);
      const events = (Array.isArray(raw) ? raw : []).map((s) => {
        try { return JSON.parse(s); } catch { return { malformed: true, raw: s }; }
      });
      res.setHeader('Access-Control-Allow-Origin', '*'); // dashboard read is public/same-origin
      res.status(200).json({ count: events.length, events });
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
};
