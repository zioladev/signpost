// Pure dashboard logic: classify evidence events into the two planes and tally
// the authority-plane measurables. No DOM, no fetch — importable by the page and
// the test. The dashboard OBSERVES; it does not judge or steer. It only counts
// facts already recorded by the collector.

export const DISCOVERY_KINDS = new Set([
  'declaration_loaded', 'index_built', 'declarations_check', 'resolve_surface_called', 'surface_returned',
]);
export const AUTHORITY_KINDS = new Set([
  'state_change_proposed', 'authority_checked',
  'execution_allowed', 'execution_blocked', 'execution_indeterminate',
  'provider_call_observed', 'provider_result_observed',
]);

export function planeOf(kind) {
  if (DISCOVERY_KINDS.has(kind)) return 'discovery';
  if (AUTHORITY_KINDS.has(kind)) return 'authority';
  return 'other';
}

export function splitByPlane(events) {
  const discovery = [], authority = [], other = [];
  for (const e of events || []) {
    const p = planeOf(e && e.kind);
    (p === 'discovery' ? discovery : p === 'authority' ? authority : other).push(e);
  }
  return { discovery, authority, other };
}

// Authority-plane measurables. `execution_allowed` and `provider_call_observed`
// are counted SEPARATELY on purpose: allow is a verdict, a provider call is the
// mutation actually running. Allow is never evidence of execution.
export function tally(events) {
  const c = (k) => (events || []).filter((e) => e && e.kind === k).length;
  const attempts = c('state_change_proposed');
  const allowed = c('execution_allowed');
  const blocked = c('execution_blocked');
  const indeterminate = c('execution_indeterminate');
  const providerCalls = c('provider_call_observed');
  const results = c('provider_result_observed');
  return {
    attempts, allowed, blocked, indeterminate, providerCalls, results,
    // Derived headline: observed block/indeterminate dispositions.
    nonAllowNoCall: (blocked + indeterminate),
    // Aggregate count sanity check: provider calls should never exceed allows.
    invariantHolds: providerCalls <= allowed,
  };
}

// Reconstruct the observed cross-origin traversal from received evidence.
// `traversalOrder` lists each distinct origin in the order its first event was
// received, tagged with the plane of that first event and the number of facts
// contributed by that origin. This is an evidence-derived view, not a complete
// browser-navigation record.
function hostOf(origin) {
  try { return new URL(origin).host; } catch { return origin || '—'; }
}

export function traversalOrder(events) {
  // Order by the server-stamped receive time so the path reflects real arrival,
  // not list position; fall back to stable order when a timestamp is missing.
  const ordered = (events || [])
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = Date.parse(a.e && a.e.received_at) || 0;
      const tb = Date.parse(b.e && b.e.received_at) || 0;
      return ta - tb || a.i - b.i;
    })
    .map((x) => x.e);

  const seen = new Map(); // host -> stop record (first-seen wins for order/plane)
  for (const e of ordered) {
    if (!e || !e.origin) continue;
    const host = hostOf(e.origin);
    let stop = seen.get(host);
    if (!stop) {
      stop = { host, origin: e.origin, plane: planeOf(e && e.kind), firstAt: e.received_at || null, events: 0 };
      seen.set(host, stop);
    }
    stop.events += 1;
  }
  return [...seen.values()];
}
