# Signpost

**A stateless capability resolver for WebMCP.**

Signpost lets a generic browser agent discover **where a capability can be performed** without taking ownership of the agent's objective, decomposition, or sequence.

The agent decides what it needs and what to do next. When it needs a capability, it calls one resolver:

```text
resolve_surface({ capability })
```

Signpost returns matching provider surfaces. It holds no journey state, session, route, cursor, history, or server-side plan.

The submitted reference implementation demonstrates this across three independent WebMCP providers, including consequential actions protected at each provider's own execution boundary.

> **Demo scope:** all orders and bookings are simulated. No payment is collected and no real reservation or transaction is created.

## How it works

**Agent owns why and sequence. Signpost answers where. Providers own what. Consequential providers control whether a mutation may execute. Evidence records what happened.**

Signpost does not plan the journey or coordinate providers. A resolver response contains candidates only:

```text
{
  surface_url,
  capability: {
    id,
    description
  }
}
```

Retrieval scores and match diagnostics remain internal to the resolver and are not exposed through its public WebMCP contract.

## Reference providers

| Provider | Capability | Kind | Execution gate |
|---|---|---|---|
| `deckhouse.coffee` | `order_item` | consequential | provider-local |
| `chairandcomb.studio` | `book_appointment` | consequential | provider-local |
| `hexregistry.dev` | `check_palette` | read-only | none |

Hex Registry is deliberately read-only and ungated. Authorization and execution control belong at consequential mutation seams, not at capability discovery.

The provider implementations, shared kit, vendored dependency, and provider tests are under [`reference-providers/`](reference-providers/).

## Capability resolution

`resolve_surface` is registered on the Signpost landing page in `index.html`.

Provider capabilities are described by provider-owned declarations. `api/declaration.js` is an allowlist-guarded same-origin proxy that fetches those declarations for the resolver without adding capability data of its own.

Retrieval uses transparent lexical/fuzzy matching over provider-authored capability IDs and descriptions. Signpost uses no embeddings or model-based retrieval and retains no state between resolution calls.

This means a compound objective can be resolved one capability at a time while the generic agent remains responsible for decomposition and sequence.

## Consequential execution

The two consequential reference providers enforce authorization locally at their own mutation seams. When exact-term authorization is absent, the same pending invocation can await authorization; authorization itself does not execute the action. After authorization, that invocation resumes, re-derives and revalidates the exact material terms immediately before execution, and proceeds only on `allow`. Each authorization is single-use.

Exact-term drift therefore fails closed. The deterministic drift test authorizes an appointment for `10:00`, presents `10:30` at execution, and returns `block` with zero provider calls.

```bash
cd reference-providers
npm install
npm test
npm run test:drift
```

The provider kit also includes a real-browser test of the await/resume path.

## Execution-control dependency

The execution seam uses:

```text
@zioladev/execution-control@0.1.0
```

This package was published on August 12, 2026 and is the submission's one disclosed prior dependency.

The package supplies the neutral execution-control decision contract, including the `mayProceed(disposition)` rule. The reference providers integrate that contract with provider-local exact-term authority, await/resume behavior, revalidation, mutation, and evidence.

A verbatim copy of the published package is included under:

```text
reference-providers/vendor/@zioladev/execution-control/
```

`reference-providers/tools/verify-vendor.mjs` verifies byte identity against the installed npm package.

## Evidence

Discovery and execution evidence are kept on separate planes.

**Discovery-plane evidence** records capability resolution and traversal through Signpost.

**Authority-plane evidence** is emitted by participating providers around consequential execution, including authorization disposition and provider-call evidence.

An authorization decision and an execution are deliberately different facts:

```text
allow ≠ provider_call
```

An `allow` disposition permits execution. It is not evidence that execution occurred.

Provider evidence is browser-originated and attributed using the browser-set `Origin` header. The collector API is append-only at its exposed surface and host-allowlisted. This should not be interpreted as cryptographically authenticated or immutable provider evidence: a non-browser caller could spoof `Origin`.

## Try the live demonstration

Start at:

```text
https://signpost.ziola.dev
```

`resolve_surface` is registered on the landing page. The evidence dashboard is read-only and exposes no WebMCP tools.

Use the canonical compound objective:

```text
Use the visible in-app browser, not background tabs. Task: order one coffee, book the earliest available basic haircut appointment, and check whether the Harbor palette contains hex FF0000.
```

The agent resolves each required capability through Signpost and chooses the sequence itself.

For the consequential providers, the pending invocation waits for exact-term authorization on the provider page before it can proceed. Hex Registry executes without an authorization gate because its capability is read-only.

The authorization store is in-memory per provider page. Reload the provider between demonstration runs to clear it.

## Repository map

| Path | Role |
|---|---|
| `index.html` | Signpost shell, `resolve_surface`, discovery instrumentation |
| `about.html` | static Signpost explainer |
| `retrieve.js` | transparent lexical/fuzzy capability retrieval |
| `api/declaration.js` | allowlist-guarded declaration proxy |
| `api/evidence.js` | evidence collector |
| `dashboard.html` + `dashboard-logic.js` | two-plane evidence dashboard and traversal view |
| `fixtures/` | offline provider declarations used by verification |
| `verify.mjs` | retrieval, statelessness, and declaration-proxy verification |
| `verify-browser.mjs` | real-browser verification of the wired Signpost shell |
| `test-dashboard.mjs` | dashboard logic tests |
| `test-evidence.mjs` | evidence collector tests |
| `reference-providers/` | reference providers, shared kit, vendored dependency, and tests |

The root shell and each reference provider are deployed separately at their respective origins.

## Provenance

`@zioladev/execution-control@0.1.0`, published August 12, 2026, is prior work and is explicitly disclosed as such.

Challenge-period work includes Signpost, the three submitted reference providers, exact-term authority integration, trusted-activation handling, await/resume and single-use authorization, material-term revalidation, execution evidence, and the multi-provider demonstration.

No earlier provider or consumer system is part of the submitted runtime.