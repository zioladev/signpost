import type { ExecutionControlProvider } from './types.ts';
/** Always permits. Used to prove that an `allow` reaches the provider. */
export declare const allowAll: ExecutionControlProvider;
/** Always withholds. Used to prove that a `block` never reaches the provider. */
export declare const blockAll: ExecutionControlProvider;
/** Always indeterminate. Used to prove that `indeterminate` is never treated as permission. */
export declare const indeterminateAll: ExecutionControlProvider;
/** Always throws. Models an unavailable/erroring authority — a consumer in required mode must not proceed. */
export declare const unavailable: ExecutionControlProvider;
/**
 * Never resolves. Models an authority that hangs — for a consumer that applies its own evaluation
 * timeout (a consumer without a timeout should not call this). A timeout must fail closed. This double
 * never settles, so only race it against a timeout; never plainly await it.
 */
export declare const hangs: ExecutionControlProvider;
//# sourceMappingURL=doubles.d.ts.map