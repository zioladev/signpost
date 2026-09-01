// Neutral test doubles — the fixed authorities a consumer/runtime tests its seam against. Each ignores
// the candidate entirely (it does NOT inspect arguments) and returns a fixed disposition, so a consumer
// can prove its own behavior: only `allow` reaches the provider; `block`/`indeterminate`/unavailable
// never do. These are for testing the SEAM; they are not a decision engine.
/** Always permits. Used to prove that an `allow` reaches the provider. */
export const allowAll = { async evaluate() { return 'allow'; } };
/** Always withholds. Used to prove that a `block` never reaches the provider. */
export const blockAll = { async evaluate() { return 'block'; } };
/** Always indeterminate. Used to prove that `indeterminate` is never treated as permission. */
export const indeterminateAll = { async evaluate() { return 'indeterminate'; } };
/** Always throws. Models an unavailable/erroring authority — a consumer in required mode must not proceed. */
export const unavailable = {
    async evaluate() { throw new Error('execution-control authority unavailable'); },
};
/**
 * Never resolves. Models an authority that hangs — for a consumer that applies its own evaluation
 * timeout (a consumer without a timeout should not call this). A timeout must fail closed. This double
 * never settles, so only race it against a timeout; never plainly await it.
 */
export const hangs = {
    evaluate() { return new Promise(() => { }); },
};
//# sourceMappingURL=doubles.js.map