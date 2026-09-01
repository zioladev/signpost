// test/acceptance.mjs — mechanical acceptance of the shared kit against the real
// challenge-period authority and execution-gate modules.
//
// Covers the consequential-action boundary behavior the submission demonstrates:
//   1. matching exact-term authorization -> allow -> exactly one provider call + result
//   2. single-field divergence (10:00 -> 10:30) -> block -> zero provider calls
//   3. no authorization -> indeterminate -> zero provider calls
//   4. gesture helper rejects isTrusted:false and accepts isTrusted:true
//
// Browser-generated trusted activation versus synthetic DOM activation is exercised
// separately by test/smoke-browser.mjs.
//
// Run: node test/acceptance.mjs
import { createAuthority } from '../kit/authority.js';
import { guardExecution } from '../kit/execution-gate.js';
import { authorizeFromGesture } from '../kit/authorize-gesture.js';

let pass = 0;
let fail = 0;
const failures = [];

const check = (name, condition, extra) => {
  if (condition) {
    pass++;
    console.log('  ✓', name);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log('  ✗', name, extra ? `— ${extra}` : '');
  }
};

const count = (events, kind) =>
  events.filter((e) => e && e.kind === kind).length;

const PROVIDER = 'chairandcomb.studio';
const ACTION = 'book_appointment';

const candidateFor = (materialTerms) => ({
  provider: PROVIDER,
  tool: ACTION,
  arguments: { material_terms: materialTerms },
  effect: 'state-changing',
});

// Booking material terms matching the representative provider's bound shape.
const terms = (time) => ({
  service: 'haircut',
  stylist: 'standard',
  date: '2026-08-29',
  time,
  duration_min: 30,
  currency: 'USD',
  total_cents: 4500,
});

// The provider's distilled execution seam:
// candidate -> guardExecution -> counting mutation function.
async function run({ authority, proposedTime }) {
  const state = { calls: 0 };
  const events = [];

  const outcome = await guardExecution({
    candidate: candidateFor(terms(proposedTime)),
    authority,
    emit: (e) => events.push(e),
    mutate: async () => {
      state.calls++;
      return { id: 'BK-' + (1000 + state.calls) };
    },
  });

  return {
    outcome,
    calls: state.calls,
    events,
  };
}

console.log(
  'Shared-kit acceptance (authority + execution-gate + gesture)\n' +
  '===========================================================',
);

// 1 — matching authorization -> allow -> one call
{
  console.log('\n── 1 · exact terms authorized -> allow ──');

  const authy = createAuthority();

  await authy.authorize({
    provider_id: PROVIDER,
    action: ACTION,
    material_terms: terms('10:00'),
  });

  const { outcome, calls, events } = await run({
    authority: authy,
    proposedTime: '10:00',
  });

  check(
    'disposition allow, executed',
    outcome.disposition === 'allow' &&
      outcome.executed === true,
    outcome.disposition,
  );

  check(
    'exactly one provider call + result',
    calls === 1 &&
      count(events, 'provider_call_observed') === 1 &&
      count(events, 'provider_result_observed') === 1,
  );

  check(
    'execution_allowed and provider_call are distinct facts',
    count(events, 'execution_allowed') === 1 &&
      count(events, 'provider_call_observed') === 1,
  );
}

// 2 — single-field drift 10:00 -> 10:30 -> block -> zero calls
{
  console.log(
    '\n── 2 · authorized 10:00, proposed 10:30 -> block ──',
  );

  const authy = createAuthority();

  await authy.authorize({
    provider_id: PROVIDER,
    action: ACTION,
    material_terms: terms('10:00'),
  });

  const { outcome, calls, events } = await run({
    authority: authy,
    proposedTime: '10:30',
  });

  check(
    'disposition block, not executed',
    outcome.disposition === 'block' &&
      outcome.executed === false,
    outcome.disposition,
  );

  check(
    'block names the drifted field (time)',
    /material divergence/.test(outcome.reason || '') &&
      /time/.test(outcome.reason || ''),
    outcome.reason,
  );

  check(
    'provider calls = 0',
    calls === 0 &&
      count(events, 'provider_call_observed') === 0,
  );

  // Fresh authorization for 10:30 then retry -> allow, one call.
  await authy.authorize({
    provider_id: PROVIDER,
    action: ACTION,
    material_terms: terms('10:30'),
  });

  const retry = await run({
    authority: authy,
    proposedTime: '10:30',
  });

  check(
    're-authorize 10:30 -> allow -> one call',
    retry.outcome.disposition === 'allow' &&
      retry.calls === 1,
  );
}

// 3 — no authorization -> indeterminate -> zero calls
{
  console.log(
    '\n── 3 · no authorization -> indeterminate ──',
  );

  const authy = createAuthority();

  const { outcome, calls } = await run({
    authority: authy,
    proposedTime: '10:00',
  });

  check(
    'disposition indeterminate, not executed',
    outcome.disposition === 'indeterminate' &&
      outcome.executed === false,
    outcome.disposition,
  );

  check(
    'provider calls = 0 (fail closed)',
    calls === 0,
  );
}

// 4 — headless gesture-helper semantics.
//
// These are ordinary test objects. This verifies only the helper's isTrusted
// check; browser trust semantics are covered by smoke-browser.mjs.
{
  console.log(
    '\n── 4 · gesture helper isTrusted check ──',
  );

  const authy = createAuthority();

  const proposal = {
    provider_id: PROVIDER,
    action: ACTION,
    material_terms: terms('10:00'),
  };

  const synthetic = await authorizeFromGesture(
    { type: 'click', isTrusted: false },
    { authority: authy, proposal },
  );

  check(
    'isTrusted:false input is refused',
    synthetic.authorized === false &&
      synthetic.reason === 'untrusted_gesture',
  );

  check(
    'no authorization record created',
    authy.pending(PROVIDER, ACTION) === null,
  );

  const afterSynthetic = await run({
    authority: authy,
    proposedTime: '10:00',
  });

  check(
    'seam stays indeterminate after refused input',
    afterSynthetic.outcome.disposition === 'indeterminate' &&
      afterSynthetic.calls === 0,
  );

  const accepted = await authorizeFromGesture(
    { type: 'click', isTrusted: true },
    { authority: authy, proposal },
  );

  check(
    'isTrusted:true input mints authorization',
    accepted.authorized === true &&
      !!accepted.auth,
  );

  const afterAccepted = await run({
    authority: authy,
    proposedTime: '10:00',
  });

  check(
    'seam allows after accepted input -> one call',
    afterAccepted.outcome.disposition === 'allow' &&
      afterAccepted.calls === 1,
  );
}

console.log(
  `\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed.`,
);

if (fail > 0) {
  for (const failure of failures) {
    console.log('   • ' + failure);
  }
  process.exit(1);
}
