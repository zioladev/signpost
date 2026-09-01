// @zioladev/execution-control — public surface (Phase V, 5A).
//
// The neutral execution-control seam of the WebMCP interoperability stack: a runtime proposes a
// state-changing execution, an OPAQUE external authority returns allow | block | indeterminate, and
// only `allow` may reach the provider. This package defines the seam and its outcome semantics — never
// how any authority decides. Family: provider-tools (declare) · provider-conformance (measure) ·
// interop-runtime (execute) · interop-conformance (qualify) · execution-control (mediate).
//
// It interprets nothing: it never inspects candidate arguments, expresses no terms/approval/receipts,
// and takes no dependency on any other package. A proprietary decision engine or an enterprise policy
// engine can each implement the same port; nothing about the implementation is visible here.
export { mayProceed } from "./semantics.js";
export { allowAll, blockAll, indeterminateAll, unavailable, hangs } from "./doubles.js";
export { runExecutionControlConformance, referenceSubject, renderConformanceReport } from "./conformance.js";
//# sourceMappingURL=index.js.map