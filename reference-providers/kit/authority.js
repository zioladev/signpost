// kit/authority.js — CHALLENGE-PERIOD work (authored 2026-08-28; adapted here to
// the published port). Shared, identical across the gated providers.
//
// The provider-local authority injected into the neutral @zioladev/execution-control
// seam. It IMPLEMENTS the published ExecutionControlProvider port:
//
//     evaluate(candidate) -> 'allow' | 'block' | 'indeterminate'
//
// POLICY (this is challenge-period, not part of the prior package):
//   A human authorizes EXACT material terms on the provider's own page (see
//   authorize-panel + authorize-gesture). At execution the authority revalidates the
//   CURRENT candidate's material terms against the fingerprint the human bound
//   (TOCTOU). Exact match -> allow; any divergence -> block; no authorization ->
//   indeterminate (fail closed). TTL bounds an authorization's lifetime only; the
//   real protection is revalidation at use.
//
// The published package never reads candidate.arguments. This authority does:
// provider-specific term binding, fingerprint comparison, and single-use claim
// policy remain outside the neutral execution-control package.

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data); // browser + Node 20+
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function canonical(provider_id, action, terms) {
  const norm = (v) =>
    Array.isArray(v) ? [...v].map((x) => String(x).toLowerCase().trim()).sort()
    : v === null || v === undefined ? null
    : typeof v === 'string' ? v.toLowerCase().trim()
    : v;

  const obj = {};
  for (const k of Object.keys(terms || {}).sort()) obj[k] = norm(terms[k]);

  return JSON.stringify({ provider_id, action, terms: obj });
}

const fingerprint = (p, a, t) => sha256Hex(canonical(p, a, t));

function diffTerms(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out = [];
  for (const k of keys) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) {
      out.push(`${k}(${JSON.stringify(a?.[k])}→${JSON.stringify(b?.[k])})`);
    }
  }
  return out;
}

export function createAuthority({
  now = () => Date.now(),
  ttlMs = 5 * 60 * 1000,
  store = new Map(),
} = {}) {
  const key = (p, a) => p + '::' + a;

  // Creates an authorization record binding the disclosed material terms and their
  // fingerprint. The submitted consequential-provider wiring supplies this call
  // through the provider-local authorization UI.
  async function authorize({ provider_id, action, material_terms }) {
    const fp = await fingerprint(provider_id, action, material_terms);
    const auth = {
      authorization_id: 'auth_' + Math.random().toString(36).slice(2, 12),
      provider_id,
      action,
      material_terms,
      terms_fingerprint: fp,
      issued_at: new Date(now()).toISOString(),
      expires_at: new Date(now() + ttlMs).toISOString(),
      status: 'active',
    };

    store.set(key(provider_id, action), auth);
    return auth;
  }

  // The published ExecutionControlProvider port. Input: candidate ONLY; output: a
  // bare disposition (no reason, no receipt) — exactly the port's contract. This
  // check does not consume an active authorization. A consumed record reads as
  // 'indeterminate', requiring a fresh authorization before execution can proceed.
  async function evaluate(candidate) {
    const provider_id = candidate?.provider;
    const action = candidate?.tool;
    const terms = candidate?.arguments?.material_terms;
    const auth = store.get(key(provider_id, action));

    if (!auth) return 'indeterminate'; // no authorization -> fail closed

    if (Date.parse(auth.expires_at) <= now()) {
      auth.status = 'expired';
      return 'block';
    }

    if (auth.status === 'consumed') return 'indeterminate'; // needs a fresh authorization
    if (auth.status !== 'active') return 'block';

    const current = await fingerprint(provider_id, action, terms);
    if (current !== auth.terms_fingerprint) return 'block'; // material divergence (TOCTOU)

    return 'allow';
  }

  // SINGLE-USE CLAIM — the execution decision. Same exact-term revalidation as
  // evaluate(), but if (and only if) it would allow, it atomically CONSUMES the
  // authorization so no second caller can. One authorization record permits AT MOST
  // ONE successful claim, even if two identical invocations claim concurrently.
  //
  // Atomicity without locks: the sole `await` (the fingerprint hash) completes BEFORE
  // the critical section. From `store.get` to the return there is NO await, so on a
  // single-threaded event loop that section runs to completion for one claimant before
  // the next begins — the first flips status to 'consumed', the second reads it. Do
  // NOT reintroduce an await inside the critical section.
  async function claim(candidate) {
    const provider_id = candidate?.provider;
    const action = candidate?.tool;
    const terms = candidate?.arguments?.material_terms;
    const current = await fingerprint(provider_id, action, terms); // the only await

    // Critical section: synchronous; no await.
    const auth = store.get(key(provider_id, action));

    if (!auth) return { disposition: 'indeterminate' };

    if (Date.parse(auth.expires_at) <= now()) {
      auth.status = 'expired';
      return { disposition: 'block' };
    }

    if (auth.status === 'consumed') {
      return { disposition: 'indeterminate' };
    }

    if (auth.status !== 'active') return { disposition: 'block' };

    if (current !== auth.terms_fingerprint) {
      return { disposition: 'block' };
    }

    auth.status = 'consumed';
    auth.consumed_at = new Date(now()).toISOString();

    return {
      disposition: 'allow',
      authorization_id: auth.authorization_id,
    };
  }

  // Diagnostic sidecar (NOT part of the port): the reason/remedy used only for the
  // in-band agent result and the evidence record. The disposition it reports agrees
  // with evaluate().
  async function explain(candidate) {
    const provider_id = candidate?.provider;
    const action = candidate?.tool;
    const terms = candidate?.arguments?.material_terms;
    const auth = store.get(key(provider_id, action));

    if (!auth) {
      return {
        disposition: 'indeterminate',
        reason: 'no human authorization for these terms',
        remedy: 'a human must press Authorize on this page for these exact terms, then retry',
      };
    }

    if (Date.parse(auth.expires_at) <= now()) {
      return {
        disposition: 'block',
        reason: 'authorization expired',
        remedy: 're-authorize the current terms',
      };
    }

    if (auth.status === 'consumed') {
      return {
        disposition: 'indeterminate',
        reason: 'previous authorization already used (single-use)',
        remedy: 'authorize again for this action',
      };
    }

    if (auth.status !== 'active') {
      return {
        disposition: 'block',
        reason: `authorization ${auth.status}`,
        remedy: 're-authorize the current terms',
      };
    }

    const current = await fingerprint(provider_id, action, terms);

    if (current !== auth.terms_fingerprint) {
      return {
        disposition: 'block',
        reason: 'material divergence at execution: ' +
          diffTerms(auth.material_terms, terms).join(', '),
        remedy: 're-disclose and re-authorize the new terms',
      };
    }

    return { disposition: 'allow' };
  }

  const pending = (provider_id, action) =>
    store.get(key(provider_id, action)) || null;

  return {
    authorize,
    evaluate,
    claim,
    explain,
    pending,
    _store: store,
  };
}

export default { createAuthority };
