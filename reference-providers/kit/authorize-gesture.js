// kit/authorize-gesture.js — CHALLENGE-PERIOD work (authored 2026-08-29).
// Shared, identical across the gated providers.
//
// Reject authorization attempts presented through events whose `isTrusted` value
// is not true. Browser-generated trusted interaction events pass this check;
// script-synthesized DOM events such as dispatchEvent(new MouseEvent(...)) do not.
//
// This helper is one part of the provider-local authorization path. The submitted
// provider wiring controls access to the authority instance used for execution.
export async function authorizeFromGesture(event, { authority, proposal, onReject } = {}) {
  if (!event || event.isTrusted !== true) {
    if (typeof onReject === 'function') onReject({ reason: 'untrusted_gesture' });
    return { authorized: false, reason: 'untrusted_gesture' };
  }
  if (!proposal) return { authorized: false, reason: 'no_pending_proposal' };
  if (!authority || typeof authority.authorize !== 'function') return { authorized: false, reason: 'no_authority' };
  const auth = await authority.authorize(proposal);
  return { authorized: true, auth };
}

export default { authorizeFromGesture };
