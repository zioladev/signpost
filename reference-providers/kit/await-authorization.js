// kit/await-authorization.js — CHALLENGE-PERIOD work. Shared by the gated providers
// that opt into AWAIT/RESUME. Browser-oriented, but degrades cleanly in Node.
//
// Produces the `waitFor(candidate)` the execution gate parks on. It resolves with the
// FIRST of:
//   'authorized' — a matching authorization signal arrived, or a post-setup
//                  authority recheck found an existing allow disposition;
//   'timeout'    — nothing arrived within timeoutMs (fail-closed backstop);
//   'cancelled'  — an internal cancellation (AbortSignal or execution:authorize-cancel).
//
// It NEVER executes anything and NEVER consumes: resolving 'authorized' only tells the
// gate "an authorization may be available — go try to claim it." The gate's single-use
// authority.claim() is the execution decision. So a lost race here is harmless; the
// loser simply fails to claim.
//
// LOST-WAKEUP SAFETY: the authorization can be minted immediately before or during
// waiter setup. We register the event listener FIRST, then recheck authority state
// with evaluate() — so we catch an already-present authorization instead of waiting
// forever for an event that already fired.
import { AUTHORIZED_EVENT, CANCEL_EVENT } from './authorize-events.js';

const keyOf = (d) => (d?.provider_id ?? d?.provider ?? '') + '::' + (d?.action ?? d?.tool ?? '');

export function makeBrowserWaiter({ authority, timeoutMs = 90000 } = {}) {
  return function waitFor(candidate, { signal } = {}) {
    const k = (candidate?.provider ?? '') + '::' + (candidate?.tool ?? '');

    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(outcome);
      };

      const onAuthorized = (e) => {
        if (keyOf(e?.detail) === k) finish('authorized');
      };
      const onCancel = (e) => {
        if (keyOf(e?.detail) === k) finish('cancelled');
      };
      const onAbort = () => finish('cancelled');
      const timer = setTimeout(() => finish('timeout'), timeoutMs);

      function cleanup() {
        clearTimeout(timer);
        if (typeof window !== 'undefined') {
          window.removeEventListener(AUTHORIZED_EVENT, onAuthorized);
          window.removeEventListener(CANCEL_EVENT, onCancel);
        }
        if (signal) signal.removeEventListener?.('abort', onAbort);
      }

      // 1) Register listeners FIRST.
      if (typeof window !== 'undefined') {
        window.addEventListener(AUTHORIZED_EVENT, onAuthorized);
        window.addEventListener(CANCEL_EVENT, onCancel);
      }

      if (signal) {
        if (signal.aborted) return finish('cancelled');
        signal.addEventListener?.('abort', onAbort);
      }

      // 2) THEN recheck authority state. If a matching authorization already exists,
      // evaluate() reports 'allow' and we resolve now rather than depending on an
      // event we may have registered too late to hear.
      Promise.resolve()
        .then(() => (
          typeof authority?.evaluate === 'function'
            ? authority.evaluate(candidate)
            : 'indeterminate'
        ))
        .then((d) => {
          if (d === 'allow') finish('authorized');
        })
        .catch(() => {});
    });
  };
}

export default { makeBrowserWaiter };
