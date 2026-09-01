// test/event-boundary.mjs — regression: the material_terms placed on the pending
// CustomEvent must be a SNAPSHOT, not the object the candidate/execution path retains.
//
// A page-script listener mutating event.detail.material_terms must NOT reach the
// execution candidate. If authorization is then bound to those altered event-visible
// terms, exact-term revalidation against the untouched candidate must fail closed:
//
//   mismatch/block, 0 provider mutations.
//
// Run: node test/event-boundary.mjs
import { announcePending } from '../kit/authorize-panel.js';
import { createAuthority } from '../kit/authority.js';
import { guardExecution } from '../kit/execution-gate.js';
import { authorizeFromGesture } from '../kit/authorize-gesture.js';

// Minimal window + CustomEvent shim so announcePending can dispatch in Node.
globalThis.CustomEvent = class {
  constructor(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  }
};

const buses = {};

globalThis.window = {
  addEventListener: (type, callback) => {
    (buses[type] ||= []).push(callback);
  },

  dispatchEvent: (event) => {
    (buses[event.type] || []).forEach((callback) => callback(event));
    return true;
  },
};

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

console.log(
  'Event-boundary snapshot (announcePending)\n' +
  '=========================================',
);

const PROVIDER = 'deckhouse.coffee';
const ACTION = 'order_item';

// The one material_terms object a provider builds and passes to both the pending
// announcement and the execution candidate, as the consequential providers do.
const terms = {
  item: 'house_blend',
  quantity: 1,
  unit_price_cents: 1800,
  total_cents: 1800,
  currency: 'USD',
};

const candidate = {
  provider: PROVIDER,
  tool: ACTION,
  arguments: {
    material_terms: terms,
  },
  effect: 'state-changing',
};

let captured = null;

window.addEventListener(
  'execution:authorize-pending',
  (event) => {
    captured = event;
  },
);

announcePending({
  provider_id: PROVIDER,
  action: ACTION,
  material_terms: terms,
  display: 'House Blend ×1 — $18.00',
});

check(
  'a pending event was dispatched',
  !!captured && !!captured.detail,
);

check(
  'event.detail.material_terms is NOT the candidate object (snapshot, not shared ref)',
  captured.detail.material_terms !== terms,
);

check(
  'the snapshot equals the terms by value',
  captured.detail.material_terms.quantity === 1 &&
    captured.detail.material_terms.total_cents === 1800,
);

// Adversarial page-script behavior: mutate the event-visible snapshot.
captured.detail.material_terms.quantity = 99;
captured.detail.material_terms.total_cents = 999999;

check(
  'mutating event.detail.material_terms did NOT mutate the execution candidate',
  terms.quantity === 1 &&
    candidate.arguments.material_terms.quantity === 1 &&
    candidate.arguments.material_terms.total_cents === 1800,
);

// Bind authorization to the now-mutated event-visible terms. This headless test
// supplies an event-like object satisfying the helper's isTrusted check; browser
// trust semantics are exercised separately by smoke-browser.mjs.
//
// Execution still uses the original untouched candidate, so exact-term revalidation
// must detect the mismatch and block before mutation.
const authority = createAuthority();

await authorizeFromGesture(
  {
    type: 'click',
    isTrusted: true,
  },
  {
    authority,
    proposal: {
      provider_id: PROVIDER,
      action: ACTION,
      material_terms: captured.detail.material_terms,
    },
  },
);

let providerCalls = 0;

const outcome = await guardExecution({
  candidate,
  authority,
  emit: () => {},
  mutate: async () => {
    providerCalls += 1;
    return { id: 'CM-SHOULD-NOT-HAPPEN' };
  },
});

check(
  'authorization over altered event terms vs untouched candidate -> block',
  outcome.disposition === 'block' &&
    outcome.executed === false,
  outcome.disposition,
);

check(
  'zero provider mutations',
  providerCalls === 0,
  `calls=${providerCalls}`,
);

console.log(
  `\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed.`,
);

if (fail > 0) {
  for (const failure of failures) {
    console.log('   • ' + failure);
  }

  process.exit(1);
}
