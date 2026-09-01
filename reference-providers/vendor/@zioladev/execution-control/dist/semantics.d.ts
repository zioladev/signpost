import type { ExecutionControlDisposition } from './types.ts';
/**
 * May the runtime proceed with the candidate, given this disposition? True ONLY for `allow`.
 * `block` and `indeterminate` both return false — indeterminate is never permission.
 */
export declare function mayProceed(disposition: ExecutionControlDisposition): boolean;
//# sourceMappingURL=semantics.d.ts.map