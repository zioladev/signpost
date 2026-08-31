// Signpost — mechanical verification of the retrieval engine and the
// stateless resolver boundaries that distinguish it from a coordinator.
//
// Runs in plain Node against LOCAL fixtures (copies of the provider
// declarations). It does NOT need a browser or a WebMCP runtime — it exercises
// retrieve.js directly, which is exactly the code path index.html registers.
//
//   node verify.mjs
//
// Two classes of check:
//   1. Retrieval quality — natural-language needs land on the right provider,
//      cross-need queries stay separated, and genuine misses remain misses.
//   2. Statelessness / journey-blindness — calls are independent, no retrieval
//      history is retained, the public output strips diagnostics, and resolving
//      capabilities does not mutate the index.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildIndex, resolve, toPublicContract } from './retrieve.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

const declarations = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')));

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log('  ✓', name);
  } else {
    fail += 1;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log('  ✗', name, extra ? `— ${extra}` : '');
  }
}

const host = (u) => new URL(u).host;
const index = buildIndex(declarations);

console.log(`\nLoaded ${declarations.length} provider declaration(s), ${index.entries.length} capability(ies).\n`);
console.log('── Retrieval quality (natural-language need → correct provider) ──');

// Each probe is a phrasing an agent might plausibly use for ONE capability.
// `want` is the host we expect as the top match; null means "expect a miss".
const probes = [
  { q: 'order a coffee', want: 'deckhouse.coffee' },
  { q: 'buy a bag of coffee beans for pickup', want: 'deckhouse.coffee' },
  { q: 'grab a cold brew', want: 'deckhouse.coffee' },
  { q: 'book a haircut', want: 'chairandcomb.studio' },
  { q: 'book me a hair appointment', want: 'chairandcomb.studio' },
  { q: 'schedule a beard trim at the barber', want: 'chairandcomb.studio' },
  { q: 'check a hex color', want: 'hexregistry.dev' },
  { q: 'check whether this hex color is in the palette', want: 'hexregistry.dev' },
  { q: 'walk my dog', want: null },                // no lexical overlap at all → clean miss
  { q: 'reserve a table for dinner', want: null }, // stray "reserve~reserves" hit is diluted below floor
];

for (const { q, want } of probes) {
  const r = resolve(index, q);
  const top = r.matches[0];

  if (want === null) {
    check(
      `"${q}" → miss (no provider offers this)`,
      !top,
      top ? `unexpectedly matched ${host(top.surface_url)} (score ${top.score})` : ''
    );
  } else {
    check(
      `"${q}" → ${want}`,
      top && host(top.surface_url) === want,
      top ? `got ${host(top.surface_url)} (score ${top.score})` : 'no match'
    );
  }
}

console.log('\n── Known lexical-retrieval limitation ──');
{
  // Lexical retrieval is negation-blind. The salon's demo disclaimer contains
  // "booking RESERVES nothing", so a short query like "reserve a table" grazes
  // it via reserve~reserves even though the salon does not take table bookings.
  // The SAME stray hit is diluted below the floor once the query is longer
  // ("reserve a table for dinner", asserted as a miss above) — a clean
  // illustration that a single boilerplate token's influence is length-sensitive.
  const r = resolve(index, 'reserve a table');
  const top = r.matches[0];

  check(
    'FINDING: "reserve a table" false-positives on salon via "reserves" (negation-blind)',
    top && host(top.surface_url) === 'chairandcomb.studio',
    top
      ? `score ${top.score} — expected limitation of lexical retrieval`
      : 'no match (limitation no longer reproduces)'
  );
}

console.log('\n── "Matches, never decomposes": compound query is retrieved, not planned ──');
{
  // The agent is supposed to decompose; if it (wrongly) sends the whole
  // objective, Signpost must still just RETRIEVE over it — never return an
  // ordered plan, a "next", or a sequence. We assert only that it returns flat
  // candidates and invents no plan/next/order field.
  const r = resolve(index, 'order a coffee and book a haircut');
  const pub = toPublicContract(r);

  check('compound query returns flat candidate list', Array.isArray(pub.matches));

  check(
    'compound query invents no ordering/next/plan/session field',
    !('next' in pub) &&
      !('order' in pub) &&
      !('plan' in pub) &&
      !('session' in pub) &&
      pub.matches.every(
        (m) => Object.keys(m).sort().join(',') === 'capability,surface_url'
      )
  );
}

console.log('\n── Public contract projection (retrieval diagnostics stay internal) ──');
{
  const diag = resolve(index, 'book a haircut');
  const pub = toPublicContract(diag);
  const s = JSON.stringify(pub);

  check(
    'diagnostic result DOES carry score (internal)',
    diag.matches.every((m) => typeof m.score === 'number')
  );

  check(
    'public result carries NO score',
    !s.includes('score') && pub.matches.every((m) => !('score' in m))
  );

  check(
    'public result carries NO token hits',
    !s.includes('hits') && pub.matches.every((m) => !('hits' in m))
  );

  check(
    'public result echoes NO query',
    !('query' in pub) && !('query_tokens' in pub)
  );

  check(
    'public match shape is exactly { surface_url, capability{ id, description } }',
    pub.matches.every(
      (m) =>
        Object.keys(m).sort().join(',') === 'capability,surface_url' &&
        Object.keys(m.capability).sort().join(',') === 'description,id'
    )
  );
}

console.log('\n── Statelessness / journey-blindness ──');
{
  // Purity: identical calls → identical results.
  const a = JSON.stringify(resolve(index, 'order a coffee'));
  const b = JSON.stringify(resolve(index, 'order a coffee'));

  check('two identical calls → byte-identical results (pure)', a === b);

  // Order independence: the result for a query does not depend on what was
  // asked before it (no cross-call history influencing retrieval).
  resolve(index, 'book a haircut');
  resolve(index, 'reserve a table');

  const after = JSON.stringify(resolve(index, 'order a coffee'));

  check('result is independent of prior calls (no history)', a === after);

  // Index immutability: a batch of resolves does not mutate the index.
  const before = JSON.stringify(index);

  for (const { q } of probes) resolve(index, q);

  const idxAfter = JSON.stringify(index);

  check(
    'index is unchanged before and after a batch of resolves',
    before === idxAfter
  );

  // Rebuild determinism: building the index twice from the same declarations
  // yields the same structure (no hidden state/ordering).
  check(
    'index rebuild is deterministic',
    JSON.stringify(buildIndex(declarations)) ===
      JSON.stringify(buildIndex(declarations))
  );
}

console.log('\n── Meaning is provider-authored (Signpost injects no taxonomy) ──');
{
  // Every capability the index can return must be traceable to a declaration —
  // Signpost must never surface an id/description it authored itself.
  const declared = new Set();

  for (const d of declarations) {
    for (const c of d.capabilities) {
      declared.add(`${d.surface_url}::${c.id}::${c.description}`);
    }
  }

  const r = resolve(index, 'order a coffee and book a haircut');

  check(
    'every returned capability is verbatim from a provider declaration',
    r.matches.every((m) =>
      declared.has(
        `${m.surface_url}::${m.capability.id}::${m.capability.description}`
      )
    )
  );
}

console.log('\n── Declaration proxy is not an open proxy (SSRF guard) ──');
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const handler = require('./api/declaration.js');

  const mockRes = () => {
    const r = { _status: 200, _headers: {}, _body: null };
    r.setHeader = (k, v) => {
      r._headers[k.toLowerCase()] = v;
    };
    r.status = (c) => {
      r._status = c;
      return r;
    };
    r.json = (o) => {
      r._body = o;
      return r;
    };
    r.send = (s) => {
      r._body = s;
      return r;
    };
    return r;
  };

  // Disallowed URL → 400 before any network call, with the allowlist echoed.
  const r1 = mockRes();

  await handler(
    { query: { url: 'https://evil.example/secret' } },
    r1
  );

  check(
    'disallowed url rejected with 400 (no fetch)',
    r1._status === 400 &&
      r1._body &&
      r1._body.error === 'url not in allowlist'
  );

  check(
    'rejection echoes the seed allowlist only',
    Array.isArray(r1._body.allowed) &&
      r1._body.allowed.length === 3 &&
      r1._body.allowed.every((u) =>
        u.endsWith('/agent-capabilities.json')
      )
  );

  // Missing url → 400 too.
  const r2 = mockRes();

  await handler({ query: {} }, r2);

  check(
    'missing url rejected with 400',
    r2._status === 400
  );

  // A metadata/internal target is not on the allowlist → rejected.
  const r3 = mockRes();

  await handler(
    { query: { url: 'http://169.254.169.254/latest/meta-data/' } },
    r3
  );

  check(
    'internal metadata URL rejected (SSRF blocked)',
    r3._status === 400
  );
}

console.log(
  `\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed.`
);

if (fail > 0) {
  for (const f of failures) {
    console.log('   • ' + f);
  }
  process.exit(1);
}
