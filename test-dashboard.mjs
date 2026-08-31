// Mechanical checks for the dashboard's pure logic. Feeds a representative
// evidence stream with one allowed execution, one blocked attempt, and discovery
// events, then asserts the plane split, authority tallies, and aggregate
// provider-call count check. Run: node test-dashboard.mjs

import { splitByPlane, tally, planeOf, traversalOrder } from './dashboard-logic.js';

let pass = 0, fail = 0; const failures = [];
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; failures.push(n); console.log('  ✗', n, x ? `— ${x}` : ''); } };

// Discovery events (from the Signpost page) + two authority runs (from providers).
const events = [
  { kind: 'declaration_loaded', origin: 'https://signpost.ziola.dev' },
  { kind: 'index_built', origin: 'https://signpost.ziola.dev' },
  { kind: 'resolve_surface_called', origin: 'https://signpost.ziola.dev', detail: 'order a coffee' },
  // Allowed attempt → executed
  { kind: 'state_change_proposed', origin: 'https://deckhouse.coffee', action: 'order_item' },
  { kind: 'authority_checked', origin: 'https://deckhouse.coffee', verdict: 'allow' },
  { kind: 'execution_allowed', origin: 'https://deckhouse.coffee' },
  { kind: 'provider_call_observed', origin: 'https://deckhouse.coffee' },
  { kind: 'provider_result_observed', origin: 'https://deckhouse.coffee' },
  // Blocked attempt (material drift) → no provider call in this fixture
  { kind: 'state_change_proposed', origin: 'https://chairandcomb.studio', action: 'book_appointment' },
  { kind: 'authority_checked', origin: 'https://chairandcomb.studio', verdict: 'block' },
  { kind: 'execution_blocked', origin: 'https://chairandcomb.studio', reason: 'material divergence: time' },
];

console.log('Dashboard logic — plane split + authority tallies\n=================================================');

const { discovery, authority, other } = splitByPlane(events);
check('discovery plane collects declaration/index/resolve events', discovery.length === 3);
check('authority plane collects proposal/verdict/call/result events', authority.length === 8);
check('no unclassified events', other.length === 0);
check('planeOf maps a provider_call to authority', planeOf('provider_call_observed') === 'authority');
check('planeOf maps resolve_surface_called to discovery', planeOf('resolve_surface_called') === 'discovery');

const t = tally(authority);
check('attempts = 2', t.attempts === 2, String(t.attempts));
check('allowed = 1', t.allowed === 1, String(t.allowed));
check('blocked = 1', t.blocked === 1, String(t.blocked));
check('indeterminate = 0', t.indeterminate === 0, String(t.indeterminate));
check('provider calls = 1 (only the allowed run)', t.providerCalls === 1, String(t.providerCalls));
check('results = 1', t.results === 1, String(t.results));
check('allow ≠ provider-call are separate counts', t.allowed === 1 && t.providerCalls === 1); // equal here, but distinct tiles
check('count check: provider calls do not exceed allows', t.invariantHolds === true);
check(
  'observed block/indeterminate dispositions = 1',
  t.nonAllowNoCall === 1,
  String(t.nonAllowNoCall)
);

// Evidence-derived traversal: distinct origins in first-touched order, by
// received_at. Feed events out of array order to verify sorting by the collector
// timestamp rather than list position. Observed origins: Signpost (discovery) →
// deckhouse → chairandcomb (authority).
const journeyEvents = [
  { kind: 'provider_call_observed', origin: 'https://deckhouse.coffee', received_at: '2026-08-28T10:00:03Z' },
  { kind: 'declaration_loaded', origin: 'https://signpost.ziola.dev', received_at: '2026-08-28T10:00:00Z' },
  { kind: 'state_change_proposed', origin: 'https://deckhouse.coffee', received_at: '2026-08-28T10:00:02Z' },
  { kind: 'resolve_surface_called', origin: 'https://signpost.ziola.dev', received_at: '2026-08-28T10:00:01Z' },
  { kind: 'state_change_proposed', origin: 'https://chairandcomb.studio', received_at: '2026-08-28T10:00:05Z' },
];

const path = traversalOrder(journeyEvents);
check('traversal lists 3 distinct origins', path.length === 3, String(path.length));
check(
  'observed origins ordered by first-touch time',
  path.map((s) => s.host).join(' → ') === 'signpost.ziola.dev → deckhouse.coffee → chairandcomb.studio',
  path.map((s) => s.host).join(' → ')
);
check('first stop tagged discovery plane', path[0].plane === 'discovery');
check('provider stop tagged authority plane', path[1].plane === 'authority');
check('provider stop counted both of its facts', path[1].events === 2, String(path[1].events));
check('empty stream → empty traversal', traversalOrder([]).length === 0);

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed.`);
if (fail > 0) { for (const f of failures) console.log('   • ' + f); process.exit(1); }
