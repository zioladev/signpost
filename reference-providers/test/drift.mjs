// test/drift.mjs — deterministic regression for exact-term revalidation.
//
// Runs the same authority and execution gate used by the consequential providers,
// with a test mutation function: authorization is bound to appointment time 10:00,
// then a 10:30 execution candidate is presented. The gate revalidates the exact
// material terms immediately before execution and blocks, so the mutation function
// is never called. Exits non-zero if the boundary fails.
//
// Run: npm run test:drift
import { createAuthority } from '../kit/authority.js';
import { guardExecution } from '../kit/execution-gate.js';

const PROVIDER = 'chairandcomb.studio';
const ACTION = 'book_appointment';

const terms = (time) => ({
  service: 'haircut',
  stylist: 'standard',
  date: '2026-09-01',
  time,
  duration_min: 30,
  currency: 'USD',
  total_cents: 4500,
});

const candidate = (time) => ({
  provider: PROVIDER,
  tool: ACTION,
  arguments: { material_terms: terms(time) },
  effect: 'state-changing',
});

const authority = createAuthority();

await authority.authorize({
  provider_id: PROVIDER,
  action: ACTION,
  material_terms: terms('10:00'),
});

let providerCalls = 0;

const outcome = await guardExecution({
  candidate: candidate('10:30'),
  authority,
  emit: () => {},
  mutate: async () => {
    providerCalls += 1;
    return { id: 'BK-SHOULD-NOT-HAPPEN' };
  },
});

console.log('Exact-term revalidation');
console.log('authorized time: 10:00');
console.log('proposed time:   10:30');
console.log('result:          ' + String(outcome.disposition).toUpperCase());
console.log('provider calls:  ' + providerCalls);
if (outcome.reason) console.log('reason:          ' + outcome.reason);

const passed =
  outcome.disposition === 'block' &&
  outcome.executed === false &&
  providerCalls === 0;

console.log('');
console.log(
  passed
    ? '\u2713 PASS — changed material terms are blocked before any provider mutation'
    : '\u2717 FAIL — expected BLOCK with 0 provider calls',
);

process.exit(passed ? 0 : 1);
