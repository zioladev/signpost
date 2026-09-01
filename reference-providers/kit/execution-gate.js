// kit/execution-gate.js — CHALLENGE-PERIOD work. Shared, identical across providers.
//
// Integrates a consequential provider action with the neutral execution-control
// decision contract:
//
//     import { mayProceed } from '@zioladev/execution-control';   // PRIOR (v0.1.0)
//
// mayProceed(disposition) permits only an `allow` disposition. block and
// indeterminate are not permission. That rule comes from the prior package;
// proposing terms, provider-local authorization, await/resume, evidence, and raw
// provider mutation are challenge-period integration.
//
// TWO SHAPES, one gate:
//   • fire-and-return (default): decide once; the caller can authorize and retry.
//   • await/resume (opts.awaitAuthorization): the SAME invocation parks while
//     authorization is obtained, then resumes through the provider authority before
//     any mutation branch is reached. Authorization itself never executes the action.
//
// With the submitted consequential-provider authority, execution decisions use
// authority.claim(), which consumes an authorization on allow. evaluate() remains
// as a compatibility path for authorities that do not implement claim, including
// conformance test doubles.
//
// Load-bearing separation: `execution_allowed` records the execution decision,
// `provider_call_observed` records entry into the raw provider-call branch, and
// `provider_result_observed` records a returned provider result. These are separate
// facts.
import { mayProceed } from '@zioladev/execution-control';

const nowIso = () => new Date().toISOString();
const KNOWN = new Set(['allow', 'block', 'indeterminate']);

// The execution decision: single-use claim() if the authority offers it, otherwise
// the non-consuming evaluate() compatibility path. Returns disposition plus optional
// reason/remedy and fails closed.
async function decide(authority, candidate) {
  let disposition = 'indeterminate';
  let reason;
  let remedy;

  try {
    if (typeof authority.claim === 'function') {
      const claimed = await authority.claim(candidate);
      disposition = claimed?.disposition;
    } else {
      disposition = await authority.evaluate(candidate);
    }

    if (!KNOWN.has(disposition)) {
      disposition = 'indeterminate';
      reason = 'authority returned an unrecognized disposition';
    }

    if (disposition !== 'allow' && typeof authority.explain === 'function') {
      const ex = await authority.explain(candidate);
      reason = reason ?? ex?.reason;
      remedy = ex?.remedy;
    }
  } catch (err) {
    disposition = 'indeterminate';
    reason = 'authority_error: ' + ((err && err.message) || String(err));
  }

  return { disposition, reason, remedy };
}

/**
 * @param {object}   opts
 * @param {object}   opts.candidate  ExecutionCandidate: { provider, tool, arguments:{material_terms}, effect:'state-changing' }
 * @param {object}   opts.authority  ExecutionControlProvider: evaluate(candidate)->disposition (+ optional claim(), explain())
 * @param {function} opts.mutate     async () => result — the RAW provider mutation; called ONLY on allow
 * @param {function} [opts.emit]     (event) => void — evidence sink
 * @param {object}   [opts.awaitAuthorization]  opt-in await/resume: { waitFor(candidate,{signal}), signal? }
 * @returns {Promise<{disposition, executed:boolean, result?, reason?, remedy?}>}
 */
export async function guardExecution({
  candidate,
  authority,
  mutate,
  emit = () => {},
  awaitAuthorization = null,
}) {
  const base = {
    provider: candidate?.provider,
    tool: candidate?.tool,
  };

  emit({
    kind: 'state_change_proposed',
    ...base,
    material_terms: candidate?.arguments?.material_terms,
    ts: nowIso(),
  });

  // Shared allow/non-allow branch for both execution shapes.
  async function proceed({ disposition, reason, remedy }) {
    emit({
      kind: 'authority_checked',
      ...base,
      disposition,
      reason,
      ts: nowIso(),
    });

    emit({
      kind:
        disposition === 'allow'
          ? 'execution_allowed'
          : disposition === 'block'
            ? 'execution_blocked'
            : 'execution_indeterminate',
      ...base,
      reason,
      remedy,
      ts: nowIso(),
    });

    if (!mayProceed(disposition)) {
      return {
        disposition,
        executed: false,
        reason,
        remedy,
      };
    }

    // Entered only after an allow disposition.
    emit({
      kind: 'provider_call_observed',
      ...base,
      ts: nowIso(),
    });

    const result = await mutate();

    emit({
      kind: 'provider_result_observed',
      ...base,
      result_ref: (result && (result.id ?? result.result_ref)) ?? null,
      ts: nowIso(),
    });

    return {
      disposition: 'allow',
      executed: true,
      result,
    };
  }

  const first = await decide(authority, candidate);

  // AWAIT/RESUME: only when opted in and no authorization is currently available.
  if (awaitAuthorization && first.disposition === 'indeterminate') {
    emit({
      kind: 'awaiting_authorization',
      ...base,
      ts: nowIso(),
    });

    const waitFor = awaitAuthorization.waitFor;
    const outcome = await waitFor(candidate, {
      signal: awaitAuthorization.signal,
    });

    if (outcome !== 'authorized') {
      emit({
        kind:
          outcome === 'timeout'
            ? 'authorization_timeout'
            : 'authorization_cancelled',
        ...base,
        ts: nowIso(),
      });

      return {
        disposition: 'indeterminate',
        executed: false,
        reason: 'authorization_' + outcome,
      };
    }

    emit({
      kind: 'authorization_granted',
      ...base,
      ts: nowIso(),
    });

    // Wake-up is not execution permission. Re-enter the authority decision so the
    // current candidate must still satisfy the bound authorization before proceeding.
    const resumed = await decide(authority, candidate);
    return proceed(resumed);
  }

  // FIRE-AND-RETURN (default), plus the pre-authorized fast path in await mode.
  return proceed(first);
}

export default { guardExecution };
