// The outcome semantics — the whole meaning of a disposition, expressed as code so it cannot drift.
//
// A disposition permits proceeding IF AND ONLY IF it is `allow`. `block` withholds permission, and
// `indeterminate` is NEVER permission. There is no fourth path and no "benefit of the doubt." This is
// the law that keeps an INDETERMINATE decision from silently becoming an allow.
/**
 * May the runtime proceed with the candidate, given this disposition? True ONLY for `allow`.
 * `block` and `indeterminate` both return false — indeterminate is never permission.
 */
export function mayProceed(disposition) {
    return disposition === 'allow';
}
//# sourceMappingURL=semantics.js.map