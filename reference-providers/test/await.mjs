// test/await.mjs — headless verification of AWAIT/RESUME and single-use authorization.
//
// Exercises the real provider-local authority and execution gate, including the
// authority's single-use claim path. It also exercises the browser waiter's
// setup-race recheck and timeout/cancellation behavior in Node, where window is
// unavailable and no DOM authorization event can fire.
//
// Run: node test/await.mjs
import { createAuthority } from '../kit/authority.js';
import { guardExecution } from '../kit/execution-gate.js';
import { authorizeFromGesture } from '../kit/authorize-gesture.js';
import { makeBrowserWaiter } from '../kit/await-authorization.js';

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

const tick = () => new Promise((r) => setTimeout(r, 0));

const PROVIDER = 'deckhouse.coffee';
const ACTION = 'order_item';

const terms = (qty) => ({
  item: 'house_blend',
  quantity: qty,
  unit_price_cents: 1800,
  total_cents: 1800 * qty,
  currency: 'USD',
});

const candidateFor = (qty) => ({
  provider: PROVIDER,
  tool: ACTION,
  arguments: { material_terms: terms(qty) },
  effect: 'state-changing',
});

const proposalFor = (qty) => ({
  provider_id: PROVIDER,
  action: ACTION,
  material_terms: terms(qty),
});

const count = (events, kind) =>
  events.filter((e) => e && e.kind === kind).length;

console.log(
  'Await/resume + single-use authorization\n' +
  '=======================================',
);

// 1 — await success: parks, authorization is minted mid-wait,
//     SAME call resumes -> one mutation.
{
  console.log(
    '\n── 1 · await -> authorize -> resume -> execute (evidence sequence) ──',
  );

  const authy = createAuthority();
  const events = [];
  const state = { calls: 0 };

  // Simulate authorization being minted while the invocation is parked.
  const waitFor = async () => {
    await authy.authorize(proposalFor(1));
    return 'authorized';
  };

  const outcome = await guardExecution({
    candidate: candidateFor(1),
    authority: authy,
    emit: (e) => events.push(e),
    mutate: async () => {
      state.calls++;
      return { id: 'CM-1001' };
    },
    awaitAuthorization: { waitFor },
  });

  check(
    'executed with a confirmation',
    outcome.executed === true && outcome.result?.id === 'CM-1001',
    outcome.disposition,
  );

  check(
    'exactly one provider mutation',
    state.calls === 1 &&
      count(events, 'provider_call_observed') === 1,
  );

  const kinds = events.map((e) => e.kind);
  const expected = [
    'state_change_proposed',
    'awaiting_authorization',
    'authorization_granted',
    'authority_checked',
    'execution_allowed',
    'provider_call_observed',
    'provider_result_observed',
  ];

  check(
    'evidence sequence exactly proposed→awaiting→granted→checked→allowed→call→result',
    JSON.stringify(kinds) === JSON.stringify(expected),
    kinds.join(' → '),
  );
}

// 2 — await then DRIFT: authorization binds different terms;
//     resume revalidation blocks.
{
  console.log(
    '\n── 2 · await -> authorize DIFFERENT terms -> resume blocks, zero mutation ──',
  );

  const authy = createAuthority();
  const events = [];
  const state = { calls: 0 };

  const waitFor = async () => {
    await authy.authorize(proposalFor(2));
    return 'authorized';
  };

  const outcome = await guardExecution({
    candidate: candidateFor(1),
    authority: authy,
    emit: (e) => events.push(e),
    mutate: async () => {
      state.calls++;
      return { id: 'CM-x' };
    },
    awaitAuthorization: { waitFor },
  });

  check(
    'blocked on resume (terms diverged)',
    outcome.executed === false && outcome.disposition === 'block',
    outcome.disposition,
  );

  check(
    'zero provider mutations',
    state.calls === 0 &&
      count(events, 'provider_call_observed') === 0,
  );

  check(
    'authorization_granted was emitted but no execution_allowed',
    count(events, 'authorization_granted') === 1 &&
      count(events, 'execution_allowed') === 0,
  );
}

// 3 — timeout: nothing authorized -> zero mutation, timeout evidence.
{
  console.log('\n── 3 · timeout -> zero provider calls ──');

  const authy = createAuthority();
  const events = [];
  const state = { calls: 0 };

  const outcome = await guardExecution({
    candidate: candidateFor(1),
    authority: authy,
    emit: (e) => events.push(e),
    mutate: async () => {
      state.calls++;
      return { id: 'x' };
    },
    awaitAuthorization: {
      waitFor: async () => 'timeout',
    },
  });

  check(
    'not executed, reason timeout',
    outcome.executed === false &&
      outcome.reason === 'authorization_timeout',
    outcome.reason,
  );

  check(
    'authorization_timeout emitted, zero provider calls',
    count(events, 'authorization_timeout') === 1 &&
      count(events, 'provider_call_observed') === 0,
  );
}

// 4 — cancel: cancellation -> zero mutation, cancel evidence.
{
  console.log('\n── 4 · cancel -> zero provider calls ──');

  const authy = createAuthority();
  const events = [];
  const state = { calls: 0 };

  const outcome = await guardExecution({
    candidate: candidateFor(1),
    authority: authy,
    emit: (e) => events.push(e),
    mutate: async () => {
      state.calls++;
      return { id: 'x' };
    },
    awaitAuthorization: {
      waitFor: async () => 'cancelled',
    },
  });

  check(
    'not executed, reason cancelled',
    outcome.executed === false &&
      outcome.reason === 'authorization_cancelled',
    outcome.reason,
  );

  check(
    'authorization_cancelled emitted, zero provider calls',
    count(events, 'authorization_cancelled') === 1 &&
      count(events, 'provider_call_observed') === 0,
  );
}

// 5 — CONCURRENCY: two parked calls, same candidate/fingerprint,
//     one authorization record. Exactly one reaches mutation;
//     the other resolves non-allow.
{
  console.log(
    '\n── 5 · two identical parked calls, one authorization -> exactly one mutation ──',
  );

  const authy = createAuthority();
  const state = { calls: 0 };

  let release;
  const barrier = new Promise((r) => {
    release = r;
  });

  // Both waiters park on the barrier, then both report that authorization
  // may be available and independently re-enter the gate's authority claim.
  const waitFor = () => barrier.then(() => 'authorized');

  const makeInvocation = () =>
    guardExecution({
      candidate: candidateFor(1),
      authority: authy,
      emit: () => {},
      mutate: async () => {
        state.calls++;
        return { id: 'CM-' + (2000 + state.calls) };
      },
      awaitAuthorization: { waitFor },
    });

  const g1 = makeInvocation();
  const g2 = makeInvocation();

  await tick();
  await tick();

  // Mint ONE authorization record for the shared fingerprint.
  await authy.authorize(proposalFor(1));

  // Both invocations wake and contend for the single-use claim.
  release();

  const [o1, o2] = await Promise.all([g1, g2]);

  const executed = [o1, o2].filter((o) => o.executed).length;
  const blocked = [o1, o2].filter((o) => !o.executed).length;

  check(
    'exactly one invocation executed',
    executed === 1,
    `executed=${executed}`,
  );

  check(
    'the other resolved non-allow after the claim was consumed',
    blocked === 1 &&
      [o1, o2].some(
        (o) => !o.executed && o.disposition !== 'allow',
      ),
  );

  check(
    'TOTAL provider mutations = 1 (single-use holds under concurrency)',
    state.calls === 1,
    `calls=${state.calls}`,
  );
}

// 6 — authorization mints state but never mutates;
//     only a subsequent gate decision can execute.
//
// This is a headless helper test. The event-like object satisfies the helper's
// isTrusted check; browser trust semantics are exercised separately by smoke-browser.
{
  console.log(
    '\n── 6 · authorization mints state, performs no mutation; gate executes separately ──',
  );

  const authy = createAuthority();
  const state = { calls: 0 };

  const res = await authorizeFromGesture(
    { type: 'click', isTrusted: true },
    {
      authority: authy,
      proposal: proposalFor(1),
    },
  );

  check(
    'accepted gesture input minted an authorization',
    res.authorized === true && !!res.auth,
  );

  check(
    'authorizing alone caused ZERO mutations',
    state.calls === 0,
  );

  // The gate performs execution and consumes the authorization.
  const o1 = await guardExecution({
    candidate: candidateFor(1),
    authority: authy,
    emit: () => {},
    mutate: async () => {
      state.calls++;
      return { id: 'CM-3001' };
    },
  });

  const o2 = await guardExecution({
    candidate: candidateFor(1),
    authority: authy,
    emit: () => {},
    mutate: async () => {
      state.calls++;
      return { id: 'CM-3002' };
    },
  });

  check(
    'gate executes once, then single-use blocks the retry',
    o1.executed === true &&
      o2.executed === false &&
      state.calls === 1,
    `calls=${state.calls}`,
  );
}

// 7 — setup race: authorization exists BEFORE the waiter is created.
//     Real makeBrowserWaiter in Node has no DOM event to receive, so the
//     post-setup authority recheck must detect it.
{
  console.log(
    '\n── 7 · waiter recheck catches an authorization that landed before setup ──',
  );

  const authy = createAuthority();

  await authy.authorize(proposalFor(1));

  const waitFor = makeBrowserWaiter({
    authority: authy,
    timeoutMs: 2000,
  });

  const outcome = await waitFor(candidateFor(1));

  check(
    'waiter resolves "authorized" from the recheck (no event needed)',
    outcome === 'authorized',
    outcome,
  );
}

// 8 — real waiter timeout + AbortSignal cancellation in Node.
{
  console.log(
    '\n── 8 · real waiter: timeout backstop + AbortSignal cancel ──',
  );

  const authy = createAuthority();

  const fast = makeBrowserWaiter({
    authority: authy,
    timeoutMs: 30,
  });

  check(
    'no authorization -> resolves "timeout"',
    (await fast(candidateFor(1))) === 'timeout',
  );

  const ac = new AbortController();
  ac.abort();

  const waiter = makeBrowserWaiter({
    authority: authy,
    timeoutMs: 5000,
  });

  check(
    'pre-aborted signal -> resolves "cancelled"',
    (await waiter(candidateFor(1), { signal: ac.signal })) ===
      'cancelled',
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
