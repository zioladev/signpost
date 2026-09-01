# @zioladev/execution-control

**A neutral seam for mediating state-changing tool execution.**

A runtime that is about to perform a **consequential (state-changing)** execution consults an external,
**opaque** execution-control authority and receives a disposition — **`allow`**, **`block`**, or
**`indeterminate`**. **Only `allow` may reach the provider.**

This package defines **what a runtime does at that seam**. It says **nothing** about *how* any authority
decides. The authority is fully opaque: one implementation could be a proprietary decision engine,
another an enterprise policy engine. No policy, terms, approval, authorization lifecycle, or receipts
appear here — and the package **never inspects the transported arguments**.

## The whole contract

```ts
interface ExecutionCandidate {
  provider: string;          // opaque provider identity — a label, never interpreted
  tool: string;              // tool name — a label, never interpreted
  arguments: unknown;        // transported to the authority; NEVER read here
  effect: 'state-changing';  // control mediates only consequential actions
}

type ExecutionControlDisposition = 'allow' | 'block' | 'indeterminate';

interface ExecutionControlProvider {
  evaluate(candidate: ExecutionCandidate): Promise<ExecutionControlDisposition>;
}
```

That is the entire public surface (plus the outcome helper and test doubles below). `evaluate` returns
**only** a disposition — no reason, no receipt, no evidence handle. The runtime learns *whether* it may
proceed, never *why*.

## Outcome semantics

```ts
import { mayProceed } from '@zioladev/execution-control';

mayProceed('allow');          // true
mayProceed('block');          // false
mayProceed('indeterminate');  // false  — indeterminate is NEVER permission
```

The intended gate, before a state-changing provider call:

```ts
let disposition;
try {
  disposition = await control.evaluate(candidate);
} catch {
  return; // authority unavailable ⇒ do not proceed (fail closed)
}
if (mayProceed(disposition)) {
  // ... only now may the call reach the provider
}
```

## Test doubles

Fixed, argument-agnostic authorities for testing a seam — `allowAll`, `blockAll`, `indeterminateAll`,
`unavailable` (throws). They ignore the candidate entirely; they are for exercising a seam, not a
decision engine.

## Boundary conformance

`runExecutionControlConformance(subject)` proves that a consumer/runtime **honors** the disposition —
never whether a disposition was *wise*. It drives a runtime-under-test across the neutral doubles and
returns a boundary-only report.

```ts
import { runExecutionControlConformance, referenceSubject, renderConformanceReport } from '@zioladev/execution-control';

const report = await runExecutionControlConformance(referenceSubject);
console.log(renderConformanceReport(report));   // report.pass === true
```

```
Execution-control boundary conformance
  PASS  required+allow → evaluator once
  PASS  required+allow → provider reached once
  PASS  evaluation occurs BEFORE provider execution
  PASS  required+block → provider NEVER reached
  PASS  required+indeterminate → provider NEVER reached
  PASS  required+throws → provider NEVER reached (fail closed)
  PASS  required+missing authority → provider NEVER reached
  PASS  read → authority NEVER consulted (bypass)
  PASS  off → no control claim
  PASS  only `allow` reaches the provider — regardless of candidate
  …
boundary conformance: PASS
```

It answers *"did the runtime honor the disposition?"* — **not** *"was the disposition wise?"* It never
inspects candidate semantics and never scores a decision. It has teeth: a runtime that lets a `block`
through, or consults the authority on a read, **fails**. `referenceSubject` is the executable spec of a
correct gate.

## The laws

- **Only `allow` proceeds.** `block` and `indeterminate` both withhold permission.
- **`indeterminate` is never permission.** An undecided authority does not get benefit of the doubt.
- **The authority is opaque.** The runtime learns the disposition, never the derivation. `evaluate`
  returns only a disposition — no reason, no receipt, no evidence handle.
- **This package interprets nothing.** It never inspects `candidate.arguments`, expresses no
  policy/terms/approval/authorization/receipts, and takes no dependency on any other package.
- **A control disposition establishes only permission-to-proceed** — not user intent, not provider
  conformance, not trajectory qualification.
- **Conformance tests boundary behavior only** — "did the runtime honor the disposition?", never "was
  the disposition wise?" The suite scores no decision and inspects no candidate semantics.

## Where it sits

```
provider-tools        declare
provider-conformance  measure
interop-runtime       execute
interop-conformance   qualify
execution-control     mediate   ← this package
```

The open package defines the neutral seam that makes consequential-execution control **pluggable**.
Any authority — proprietary or in-house — can implement the port, with none of its implementation
visible here.

## Scripts

```
npm run typecheck   # tsc --noEmit
npm test            # node --experimental-strip-types --test  (Node >= 22.6)
npm run build       # emit dist/ (ESM + .d.ts)
```

## License

Apache-2.0. See [`NOTICE`](./NOTICE).
