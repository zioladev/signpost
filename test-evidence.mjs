// Mechanical test of the evidence collector against a MOCK Upstash REST endpoint
// (global.fetch is stubbed) and mock req/res. Verifies: Origin allowlist,
// append-only (RPUSH) on POST, read-back (LRANGE) on GET, OPTIONS preflight,
// env-not-configured failure, and that the request Origin is stamped server-side.
//
// Run: node test-evidence.mjs

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);

process.env.UPSTASH_REDIS_REST_URL = 'https://mock-upstash.local';
process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';

// In-memory list standing in for the Redis list; fetch stub speaks the Upstash
// REST protocol (POST a command array → { result }).
const LIST = [];
const calls = [];
globalThis.fetch = async (url, opts) => {
  const cmd = JSON.parse(opts.body);
  calls.push(cmd);
  const [op, , ...rest] = cmd;
  if (op === 'RPUSH') { LIST.push(rest[0]); return { ok: true, json: async () => ({ result: LIST.length }) }; }
  if (op === 'LRANGE') { return { ok: true, json: async () => ({ result: LIST.slice() }) }; }
  return { ok: false, status: 400, json: async () => ({ error: 'unexpected op ' + op }) };
};

const handler = require('./api/evidence.js');
const mockRes = () => {
  const r = { _status: 200, _headers: {}, _body: null, _ended: false };
  r.setHeader = (k, v) => { r._headers[k.toLowerCase()] = v; };
  r.status = (c) => { r._status = c; return r; };
  r.json = (o) => { r._body = o; r._ended = true; return r; };
  r.end = () => { r._ended = true; return r; };
  return r;
};
const evt = (origin, body) => ({ method: 'POST', headers: { origin }, body });

let pass = 0, fail = 0; const failures = [];
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; failures.push(n + (x ? ` — ${x}` : '')); console.log('  ✗', n, x ? `— ${x}` : ''); } };

console.log('Evidence collector — mechanical checks\n======================================');

// OPTIONS preflight
{
  const res = mockRes();
  await handler({ method: 'OPTIONS', headers: { origin: 'https://deckhouse.coffee' } }, res);
  check('OPTIONS preflight → 204 with CORS for allowlisted origin', res._status === 204 && res._headers['access-control-allow-origin'] === 'https://deckhouse.coffee');
}

// POST from an allowlisted origin → RPUSH, origin stamped
{
  const res = mockRes();
  await handler(evt('https://chairandcomb.studio', { kind: 'execution_blocked', action: 'book_appointment', reason: 'material divergence' }), res);
  check('allowlisted POST → 202', res._status === 202 && res._body?.ok === true, `status=${res._status}`);
  check('append used RPUSH (append-only)', calls.some((c) => c[0] === 'RPUSH'));
  const stored = JSON.parse(LIST[LIST.length - 1]);
  check('server stamps request Origin + received_at', stored.origin === 'https://chairandcomb.studio' && typeof stored.received_at === 'string');
  check('event body preserved (kind/action)', stored.kind === 'execution_blocked' && stored.action === 'book_appointment');
}

// POST whose body the runtime did NOT pre-parse (req.body undefined) — the
// text/plain raw-stream case. The handler must drain the raw stream and store it.
{
  const before = LIST.length;
  const res = mockRes();
  const payload = JSON.stringify({ kind: 'provider_call_observed', action: 'order_item' });
  const req = new EventEmitter();
  req.method = 'POST';
  req.headers = { origin: 'https://deckhouse.coffee', 'content-type': 'text/plain;charset=UTF-8' };
  req.destroy = () => {};
  // body intentionally absent → handler falls back to draining the stream
  const p = handler(req, res);
  req.emit('data', payload);
  req.emit('end');
  await p;
  check('text/plain POST with no pre-parsed body → 202 via raw-stream fallback', res._status === 202 && res._body?.ok === true, `status=${res._status}`);
  check('raw-stream event was appended', LIST.length === before + 1 && JSON.parse(LIST[LIST.length - 1]).kind === 'provider_call_observed');
}

// Host-based allowlist: the www. form of a provider is accepted (apex/www differ
// by deploy and the browser stamps whichever the page is on).
{
  const res = mockRes();
  await handler(evt('https://www.deckhouse.coffee', { kind: 'state_change_proposed', action: 'order_item' }), res);
  check('www. form of an allowlisted host → 202', res._status === 202 && res._body?.ok === true, `status=${res._status}`);
  check('ACAO echoes the www origin', res._headers['access-control-allow-origin'] === 'https://www.deckhouse.coffee');
}

// http (non-TLS) origin of an allowed host is still rejected.
{
  const res = mockRes();
  await handler(evt('http://deckhouse.coffee', { kind: 'execution_allowed' }), res);
  check('non-https origin → 403 even for an allowed host', res._status === 403);
}

// POST from a NON-allowlisted origin → 403, nothing stored
{
  const before = LIST.length;
  const res = mockRes();
  await handler(evt('https://evil.example', { kind: 'execution_allowed' }), res);
  check('non-allowlisted origin POST → 403', res._status === 403);
  check('rejected POST stored nothing', LIST.length === before);
}

// POST missing kind → 400
{
  const res = mockRes();
  await handler(evt('https://deckhouse.coffee', { not_kind: 1 }), res);
  check('POST without a string kind → 400', res._status === 400);
}

// GET → LRANGE read-back, events parsed
{
  const res = mockRes();
  await handler({ method: 'GET', headers: { origin: 'https://signpost.ziola.dev' } }, res);
  check('GET → 200 with parsed events', res._status === 200 && Array.isArray(res._body?.events));
  check('GET used LRANGE (read-only)', calls.some((c) => c[0] === 'LRANGE'));
  check('read-back includes the appended event', res._body.events.some((e) => e.kind === 'execution_blocked' && e.origin === 'https://chairandcomb.studio'));
}

// Only append/read commands were ever issued — no DEL/LSET/LREM (append-only surface)
check('no destructive Redis commands issued (append-only)', calls.every((c) => c[0] === 'RPUSH' || c[0] === 'LRANGE'));

// env not configured → clean 500, no throw. Clear ALL supported url/token pairs
// (Upstash, Vercel KV, alt Redis REST) so this actually creates the unconfigured
// condition regardless of what the host environment happens to have set.
{
  const KEYS = [
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_URL', 'KV_REST_API_TOKEN',
    'REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN',
  ];
  const saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }

  const res = mockRes();
  await handler({ method: 'GET', headers: { origin: '' } }, res);
  check('missing redis env → 500 (fails cleanly, not a crash)', res._status === 500 && /redis env/.test(res._body?.error || ''));

  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed.`);
if (fail > 0) { for (const f of failures) console.log('   • ' + f); process.exit(1); }
