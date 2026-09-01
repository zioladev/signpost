import type { ExecutionCandidate, ExecutionControlProvider } from './types.ts';
/**
 * A runtime under test, reduced to the one decision the seam cares about. Given a single execution
 * attempt, the subject runs ITS OWN control logic and calls `reachProvider` IF AND ONLY IF it decides
 * the execution may reach the provider. It reports only whether it ENGAGED execution control (recorded
 * a control outcome) — never why a disposition was returned.
 */
export interface ExecutionControlSubject {
    attempt(input: {
        /** Whether this attempt is a read (bypasses the seam) or a state-changing execution (gated). */
        effect: 'read' | 'state-changing';
        /** `off` = existing behavior, no control claim; `required` = a state-changing call needs `allow`. */
        mode: 'off' | 'required';
        /** The authority to consult; `undefined` models a missing authority (required mode ⇒ fail closed). */
        control?: ExecutionControlProvider;
        /** The candidate, forwarded to the authority unchanged for a state-changing attempt. */
        candidate: ExecutionCandidate;
        /** The subject MUST call this exactly once IFF it lets the execution reach the provider. */
        reachProvider: () => Promise<void>;
    }): Promise<{
        engagedControl: boolean;
    }>;
}
export interface ConformanceCheck {
    name: string;
    pass: boolean;
    detail: string;
}
export interface ConformanceReport {
    pass: boolean;
    checks: ConformanceCheck[];
}
/**
 * Run the boundary conformance suite against `subject`. Returns a structured report; every check tests
 * boundary behavior only. Reads/off never consult the authority; only `allow` reaches the provider;
 * block / indeterminate / missing / throwing authorities never reach it; and — for a state-changing
 * required attempt — evaluation happens before the provider is reached.
 */
export declare function runExecutionControlConformance(subject: ExecutionControlSubject): Promise<ConformanceReport>;
/**
 * A minimal, CORRECT execution-control gate — the executable specification of seam-honoring behavior.
 * It reads no arguments, scores no disposition, and only an `allow` lets the execution reach the
 * provider. Ships so the contract is demonstrably satisfiable and so a runtime has a reference to
 * compare against.
 */
export declare const referenceSubject: ExecutionControlSubject;
/** A boring, boundary-only rendering of a conformance report. No terms, no reasons, no receipts. */
export declare function renderConformanceReport(report: ConformanceReport): string;
//# sourceMappingURL=conformance.d.ts.map