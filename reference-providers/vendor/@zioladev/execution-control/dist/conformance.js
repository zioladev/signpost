// Boundary conformance suite (Phase V, 5C).
//
// It proves that a consumer/runtime integrating the neutral execution-control seam HONORS the
// disposition correctly — never that a disposition was "wise." It drives a `subject` (a runtime under
// test) across the neutral doubles and checks the boundary invariants. It NEVER inspects candidate
// semantics and NEVER scores the authority's decision quality — that would drift toward proprietary
// decision semantics. The only question is: *did the runtime honor the disposition?*
import { allowAll, blockAll, indeterminateAll, unavailable } from "./doubles.js";
const CANDIDATE = (i = 0) => ({ provider: `p${i}`, tool: `tool_${i}`, arguments: { i }, effect: 'state-changing' });
// A metered wrapper over a control double: counts how many times evaluate() ran and records the order.
function meteredControl(inner, order) {
    let calls = 0;
    return { calls: () => calls, provider: { async evaluate(c) { calls++; order.push('evaluate'); return inner.evaluate(c); } } };
}
/**
 * Run the boundary conformance suite against `subject`. Returns a structured report; every check tests
 * boundary behavior only. Reads/off never consult the authority; only `allow` reaches the provider;
 * block / indeterminate / missing / throwing authorities never reach it; and — for a state-changing
 * required attempt — evaluation happens before the provider is reached.
 */
export async function runExecutionControlConformance(subject) {
    const checks = [];
    const record = (name, pass, detail) => { checks.push({ name, pass, detail }); };
    // One scenario: metered authority + a reach spy. Returns the observed counts + order.
    async function scenario(effect, mode, inner, candidate = CANDIDATE()) {
        const order = [];
        const metered = inner ? meteredControl(inner, order) : undefined;
        let reached = 0;
        const reachProvider = async () => { reached++; order.push('reach'); };
        // A conformant subject fails closed gracefully; a non-conformant one may throw. Either way the
        // boundary property is measured by `reached` (the provider spy), and the suite never crashes.
        let engagedControl = true;
        try {
            const out = await subject.attempt({ effect, mode, control: metered?.provider, candidate, reachProvider });
            engagedControl = out.engagedControl;
        }
        catch { /* subject did not fail closed gracefully — `reached` still records the boundary outcome */ }
        return { evaluates: metered ? metered.calls() : 0, reached, order, engagedControl };
    }
    // required + allow → evaluate once, provider once, evaluation BEFORE the provider.
    {
        const s = await scenario('state-changing', 'required', allowAll);
        record('required+allow → evaluator once', s.evaluates === 1, `evaluates=${s.evaluates}`);
        record('required+allow → provider reached once', s.reached === 1, `reached=${s.reached}`);
        record('evaluation occurs BEFORE provider execution', s.order.indexOf('evaluate') !== -1 && s.order.indexOf('evaluate') < s.order.indexOf('reach'), `order=${s.order.join('→')}`);
    }
    // required + block / indeterminate → evaluate once, provider ZERO.
    for (const [name, dbl] of [['block', blockAll], ['indeterminate', indeterminateAll]]) {
        const s = await scenario('state-changing', 'required', dbl);
        record(`required+${name} → evaluator once`, s.evaluates === 1, `evaluates=${s.evaluates}`);
        record(`required+${name} → provider NEVER reached`, s.reached === 0, `reached=${s.reached}`);
    }
    // required + throwing authority → provider ZERO (fail closed).
    {
        const s = await scenario('state-changing', 'required', unavailable);
        record('required+throws → provider NEVER reached (fail closed)', s.reached === 0, `reached=${s.reached}`);
    }
    // required + missing authority → provider ZERO (fail closed), no evaluation possible.
    {
        const s = await scenario('state-changing', 'required', undefined);
        record('required+missing authority → provider NEVER reached', s.reached === 0, `reached=${s.reached}`);
        record('required+missing authority → control still engaged', s.engagedControl === true, `engagedControl=${s.engagedControl}`);
    }
    // reads bypass the seam entirely.
    {
        const s = await scenario('read', 'required', blockAll);
        record('read → authority NEVER consulted (bypass)', s.evaluates === 0, `evaluates=${s.evaluates}`);
        record('read → provider reached', s.reached === 1, `reached=${s.reached}`);
        record('read → no control claim', s.engagedControl === false, `engagedControl=${s.engagedControl}`);
    }
    // off mode makes no execution-control claim.
    {
        const s = await scenario('state-changing', 'off', blockAll);
        record('off → authority NEVER consulted', s.evaluates === 0, `evaluates=${s.evaluates}`);
        record('off → provider reached (existing behavior)', s.reached === 1, `reached=${s.reached}`);
        record('off → no control claim', s.engagedControl === false, `engagedControl=${s.engagedControl}`);
    }
    // Nothing but `allow` reaches — regardless of candidate content (the neutral form of "model
    // decision / provider conformance / prior qualification cannot substitute for control"). The suite
    // never inspects the candidate; it only varies it and confirms a block still reaches zero.
    {
        let anyReached = 0;
        for (let i = 0; i < 3; i++) {
            const s = await scenario('state-changing', 'required', blockAll, CANDIDATE(i));
            anyReached += s.reached;
        }
        record('only `allow` reaches the provider — regardless of candidate', anyReached === 0, `total reached under block across varied candidates=${anyReached}`);
    }
    return { pass: checks.every((c) => c.pass), checks };
}
/**
 * A minimal, CORRECT execution-control gate — the executable specification of seam-honoring behavior.
 * It reads no arguments, scores no disposition, and only an `allow` lets the execution reach the
 * provider. Ships so the contract is demonstrably satisfiable and so a runtime has a reference to
 * compare against.
 */
export const referenceSubject = {
    async attempt({ effect, mode, control, candidate, reachProvider }) {
        // Reads and `off` mode bypass the seam entirely — no evaluation, no control claim.
        if (effect !== 'state-changing' || mode === 'off') {
            await reachProvider();
            return { engagedControl: false };
        }
        // required + state-changing: consult the authority; fail closed on missing / throw.
        if (!control)
            return { engagedControl: true };
        let disposition;
        try {
            disposition = await control.evaluate(candidate);
        }
        catch {
            return { engagedControl: true }; // threw ⇒ do not proceed
        }
        if (disposition === 'allow')
            await reachProvider(); // only `allow` proceeds; block/indeterminate do not
        return { engagedControl: true };
    },
};
/** A boring, boundary-only rendering of a conformance report. No terms, no reasons, no receipts. */
export function renderConformanceReport(report) {
    const lines = report.checks.map((c) => `  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  (${c.detail})`}`);
    return `Execution-control boundary conformance\n${lines.join('\n')}\n\nboundary conformance: ${report.pass ? 'PASS' : 'FAIL'}`;
}
//# sourceMappingURL=conformance.js.map