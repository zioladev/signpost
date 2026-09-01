// kit/authorize-events.js — CHALLENGE-PERIOD work. Shared, identical across providers.
//
// The DOM event names used by the provider-local authorization flow. These events
// are exchanged within the provider page; Signpost (the discovery resolver) has no
// part in authorization, so the namespace is `execution:` — not `signpost:` — to
// avoid implying otherwise.
//
//   execution:authorize-pending  — a tool proposed exact terms; the panel should show them
//   execution:authorized         — the authorization UI reports a newly minted authorization
//   execution:authorize-cancel   — an authorization wait was cancelled (internal/supersession)
export const PENDING_EVENT = 'execution:authorize-pending';
export const AUTHORIZED_EVENT = 'execution:authorized';
export const CANCEL_EVENT = 'execution:authorize-cancel';

export default { PENDING_EVENT, AUTHORIZED_EVENT, CANCEL_EVENT };
