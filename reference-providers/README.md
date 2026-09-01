# Signpost reference providers

Three minimal WebMCP reference providers built for the Signpost challenge submission. Each deploys to its **own origin** and is deliberately small and inspectable: static HTML, ES modules, and a file-copy build with no transpilation.

| Provider     | Origin                        | Capability                                      | Execution control |
| ------------ | ----------------------------- | ----------------------------------------------- | ----------------- |
| **commerce** | `https://deckhouse.coffee`    | `order_item` — consequential demo order         | provider-local    |
| **booking**  | `https://chairandcomb.studio` | `book_appointment` — consequential demo booking | provider-local    |
| **readonly** | `https://hexregistry.dev`     | `check_palette` — read-only inspection          | none              |

Each provider derives runtime identity from `location.host` / `location.origin`. Its declaration supplies the deployed `surface_url` and provider-authored capability description.

All three register WebMCP tools on `document.modelContext`. The two consequential providers additionally enforce authorization at their own mutation seams. Hex Registry is deliberately read-only and does not import the authority, execution gate, evidence transport, or execution-control package.

---

## Reader's map

For each consequential provider (`commerce`, `booking`):

| What                     | File                                          | Relevant symbol                                    |
| ------------------------ | --------------------------------------------- | -------------------------------------------------- |
| Capability declaration   | `providers/<p>/agent-capabilities.json`       | provider-authored declaration                      |
| WebMCP registration      | `kit/webmcp.js` + `providers/<p>/provider.js` | `registerTools(...)`                               |
| Material-term mapping    | `providers/<p>/material-terms.js`             | `orderMaterialTerms` / `bookingMaterialTerms`      |
| Provider-local authority | `kit/authority.js`                            | `createAuthority(...)`, single-use `claim(...)`    |
| Execution gate           | `kit/execution-gate.js`                       | `guardExecution(...)` → `mayProceed(...)`          |
| Authorization UI         | `kit/authorize-panel.js`                      | `mountAuthorizePanel(...)`, `announcePending(...)` |
| Activation check         | `kit/authorize-gesture.js`                    | `authorizeFromGesture(...)`                        |
| Await/resume             | `kit/await-authorization.js`                  | `makeBrowserWaiter(...)`                           |
| Mutation                 | `providers/<p>/provider.js`                   | `recordOrder(...)` / `recordBooking(...)`          |
| Execution evidence       | `kit/evidence.js`                             | `emitEvidence(...)` via the gate                   |

The read-only provider imports only `kit/webmcp.js`. It has no material-term mapping, provider-local authority, authorization UI, execution gate, mutation function, or execution-evidence path.

---

## Consequential execution

For `order_item` and `book_appointment`, the provider derives the material terms and discloses them through its provider-local authorization UI.

If matching authorization is not already available, the **same pending WebMCP invocation** can wait while the user authorizes those exact material terms on the provider page. Authorization itself does not execute the action.

After authorization, the pending invocation resumes through the execution gate. The provider-local authority revalidates the current candidate against the exact bound material terms and performs a single-use claim. The published execution-control seam then permits mutation only when the resulting disposition is `allow`.

`block` and `indeterminate` do not reach the mutation function.

In compact form:

```text
provider derives terms
→ terms disclosed on provider page
→ exact terms authorized
→ same pending invocation resumes
→ provider-local authority revalidates + claims
→ mayProceed(disposition)
→ allow only: mutation
```

The authorization UI receives a snapshot of the proposed material terms rather than the execution candidate's live object reference. The event-boundary regression test verifies that mutation of event-visible terms cannot alter the execution candidate and produce an authorized mutation of undisclosed terms.

The booking drift test separately verifies exact-term revalidation: authorization bound to a `10:00` appointment does not permit execution when the presented appointment time is `10:30`; the changed candidate is blocked before the provider mutation function is called.

---

## Prior work and challenge-period work

The submission has one disclosed prior dependency:

**`@zioladev/execution-control@0.1.0`**, published August 12, 2026.

The package supplies the neutral execution-control contract used here, including `mayProceed(disposition)`. It does not define the commerce or booking material terms and does not read `candidate.arguments`.

A copy of the published package is vendored under:

```text
vendor/@zioladev/execution-control/
```

`npm run verify:vendor` compares the vendored package files with the installed `@zioladev/execution-control@0.1.0` package and fails on a byte mismatch.

Challenge-period work in this repository includes:

* the three reference provider implementations;
* provider-authored capability declarations;
* material-term mappings;
* provider-local exact-term authority;
* authorization UI and activation handling;
* await/resume and single-use authorization;
* material-term revalidation;
* execution-gate integration;
* execution-evidence transport; and
* the provider test and verification suite.

`npm run verify:kit` checks the shared kit's import boundary: its only bare-specifier dependency is `@zioladev/execution-control`; the remaining kit imports are relative.

The prior package supplies the neutral execution-control decision contract. The challenge-period provider integration determines what material terms mean, whether matching authorization exists, and where the provider's mutation boundary is.

---

## Evidence

The consequential providers emit execution facts through `kit/evidence.js`.

Evidence is written to the browser console, retained locally in the provider origin's `localStorage`, and sent to the Signpost evidence collector. The collector attributes received records using the browser request's `Origin`.

The gate records authorization disposition separately from execution observations. In particular:

```text
allow ≠ provider_call
```

An `allow` disposition permits execution. It is not evidence that execution occurred.

`provider_call_observed` records entry into the provider's raw mutation branch, while `provider_result_observed` records a returned mutation result.

This is browser-originated, provider-participating evidence. It is not cryptographically authenticated or immutable, and the request `Origin` should not be interpreted as cryptographic proof of provenance.

Hex Registry has no consequential execution path and emits no execution evidence.

---

## Repository layout

| Path                                  | Role                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| `kit/webmcp.js`                       | shared WebMCP registration                                           |
| `kit/authority.js`                    | provider-local exact-term authority and single-use claim             |
| `kit/execution-gate.js`               | execution gate and neutral `mayProceed` integration                  |
| `kit/authorize-gesture.js`            | trusted browser-event check for authorization activation             |
| `kit/authorize-panel.js`              | provider-local exact-term authorization UI and pending-term snapshot |
| `kit/authorize-events.js`             | provider-local authorization event names                             |
| `kit/await-authorization.js`          | same-invocation await/resume support                                 |
| `kit/evidence.js`                     | browser-originated execution-evidence transport                      |
| `providers/commerce/`                 | Deckhouse Coffee declaration, surface, material terms, and mutation  |
| `providers/booking/`                  | Chair & Comb declaration, surface, material terms, and mutation      |
| `providers/readonly/`                 | Hex Registry declaration and read-only surface                       |
| `vendor/@zioladev/execution-control/` | vendored published `0.1.0` dependency — prior work                   |
| `tools/build.mjs`                     | assembles self-contained provider distributions                      |
| `tools/verify-kit.mjs`                | verifies shared-kit import boundary                                  |
| `tools/verify-vendor.mjs`             | compares vendored package with installed npm package                 |
| `test/conformance.mjs`                | execution-control conformance coverage                               |
| `test/acceptance.mjs`                 | provider/gate acceptance coverage                                    |
| `test/await.mjs`                      | await/resume and authorization behavior                              |
| `test/event-boundary.mjs`             | pending-term snapshot/event-boundary regression                      |
| `test/drift.mjs`                      | deterministic exact-term drift regression                            |
| `test/smoke-browser.mjs`              | real-browser smoke test of assembled provider output                 |

---

## Build and verify

The providers are assembled by file copy; there is no transpilation.

```bash
npm install
npm run build
npm test
npm run test:drift
```

`npm test` runs the conformance, acceptance, await/resume, event-boundary, kit-boundary, and vendor verification checks.

The deterministic drift regression is available separately:

```bash
npm run test:drift
```

An optional browser smoke test assembles the commerce provider and exercises it in Chromium:

```bash
npm run test:smoke
```

The browser smoke test requires Playwright.

Build output is written to `dist/<provider>/`. The consequential providers include the vendored execution-control package and resolve it through their import maps. The read-only provider does not include or import that package.

---

## Deployed reference surfaces

The submitted reference providers are:

* `https://deckhouse.coffee`
* `https://chairandcomb.studio`
* `https://hexregistry.dev`

Their provider-authored declarations are available at `/agent-capabilities.json` on each origin and are resolved by Signpost.

Deckhouse Coffee and Chair & Comb participate in the Signpost execution-evidence collector because they expose consequential mutations. Hex Registry is deliberately read-only and does not participate in the provider execution-evidence path.

The reference-provider runtime is self-contained here; Signpost itself remains a separate stateless capability resolver. Signpost does not own provider mutations, authorization state, or the agent's objective and sequence.
