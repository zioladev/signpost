// @zioladev/execution-control — the neutral execution-control seam (Phase V, 5A).
//
// A runtime that is about to perform a CONSEQUENTIAL (state-changing) execution consults an external,
// opaque execution-control authority and receives a disposition: allow | block | indeterminate. Only
// `allow` may reach the provider. This package defines WHAT a runtime does at that seam; it says
// NOTHING about HOW any authority decides. The authority is fully opaque — one implementation could be
// a proprietary decision engine, another an enterprise policy engine. No mechanism, terms, approval,
// authorization lifecycle, or receipts appear here.
//
// Hard boundary: this package MUST NOT inspect or validate `candidate.arguments`. It transports the
// candidate to the opaque authority and interprets nothing. The moment it reads arguments, it starts
// walking toward policy/term semantics — which stay entirely outside this package.
export {};
//# sourceMappingURL=types.js.map