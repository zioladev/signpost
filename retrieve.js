// Signpost — transparent lexical/fuzzy retrieval over provider-authored
// capability declarations. No embeddings, no model dependency: every score is
// a function of visible token overlap, so a miss is inspectable and reportable
// as an experimental finding rather than an opaque failure.
//
// This module is PURE and side-effect free. It holds no journey state — no
// objective, session, cursor, sequencing, history, or "next". Its only inputs
// are (declarations) at index-build time and (query) at resolve time. Two
// identical resolve() calls against the same index return identical results.
//
// Importable unchanged in the browser (index.html) and in Node (verify.mjs).

// A small, visible stopword set. Kept deliberately short so the matching stays
// legible — we drop only glue words that carry no capability meaning.
export const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'at', 'in', 'on', 'and', 'or', 'with',
  'me', 'my', 'i', 'please', 'can', 'could', 'you', 'your', 'is', 'it', 'this',
  'that', 'from', 'be', 'get', 'want', 'need', 'would', 'like', 'some',
]);

// Tokenize into lowercased alphanumeric terms, minus stopwords. `id` tokens
// come free because underscores are non-alphanumeric separators, so
// "book_hair_appointment" → ["book","hair","appointment"].
export function tokenize(text) {
  const raw = String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  return raw.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Levenshtein distance, capped small — only used to forgive minor typos /
// morphology ("appointments" vs "appointment"). Iterative, O(n*m).
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 4; // early-out: too far to matter
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j += 1) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i += 1) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[m];
}

// Similarity of a single query token against a single capability token, in
// [0,1]. Fully transparent tiers: exact > prefix > small edit distance.
function tokenSimilarity(q, t) {
  if (q === t) return 1;
  if (q.length >= 3 && t.length >= 3 && (q.startsWith(t) || t.startsWith(q))) return 0.7;
  if (q.length >= 4 && t.length >= 4) {
    const d = editDistance(q, t);
    if (d === 1) return 0.6;
    if (d === 2) return 0.35;
  }
  return 0;
}

// Build a stateless retrieval index from a set of provider declarations.
// Each declaration: { surface_url, capabilities: [{ id, description }] }.
// The index is a flat list of capability entries with their token bag — no
// provider is privileged, no ordering is imposed beyond input order.
export function buildIndex(declarations) {
  const entries = [];
  for (const decl of declarations || []) {
    if (!decl || typeof decl.surface_url !== 'string' || !Array.isArray(decl.capabilities)) continue;
    for (const cap of decl.capabilities) {
      if (!cap || typeof cap.id !== 'string' || typeof cap.description !== 'string') continue;
      // id tokens are weighted a touch higher than description tokens: the id is
      // the provider's own compressed label for the capability.
      const idTokens = tokenize(cap.id);
      const descTokens = tokenize(cap.description);
      const weights = new Map();
      for (const tk of idTokens) weights.set(tk, Math.max(weights.get(tk) || 0, 1.5));
      for (const tk of descTokens) weights.set(tk, Math.max(weights.get(tk) || 0, 1.0));
      entries.push({
        surface_url: decl.surface_url,
        capability: { id: cap.id, description: cap.description },
        terms: [...weights.entries()].map(([term, weight]) => ({ term, weight })),
      });
    }
  }
  return { entries };
}

// Score one query against one index entry. Returns { score, hits } where hits
// lists which query token matched which capability term and how — this is what
// makes a match (or a miss) inspectable.
function scoreEntry(queryTokens, entry) {
  if (queryTokens.length === 0) return { score: 0, hits: [] };
  const hits = [];
  let total = 0;
  for (const q of queryTokens) {
    let best = { sim: 0, term: null, weight: 0 };
    for (const { term, weight } of entry.terms) {
      const sim = tokenSimilarity(q, term);
      if (sim * weight > best.sim * best.weight) best = { sim, term, weight };
    }
    if (best.sim > 0) {
      total += best.sim * best.weight;
      hits.push({ query_token: q, matched_term: best.term, similarity: Number(best.sim.toFixed(2)) });
    }
  }
  // Normalize by query length so score is a coverage ratio in ~[0,1.5], then
  // clamp. A query where every token strongly hits an id term approaches the top.
  const score = Number((total / queryTokens.length).toFixed(4));
  return { score, hits };
}

// The core stateless lookup: given an index and ONE capability need in natural
// language, return candidate surfaces ranked by transparent retrieval fit.
//
// Returns the FULL diagnostic shape (with score + hits). The public WebMCP
// contract deliberately strips score/hits before returning to the agent — that
// projection happens at the call site (index.html), not here, so verification
// can assert on both the ranking and what leaks into the public output.
// `floor` is the minimum coverage score for a candidate to be returned. It is
// set so that a SINGLE weak fuzzy token hit (e.g. an edit-distance match against
// a word buried in a provider's demo boilerplate) does not, on its own,
// constitute a match — a real hit needs either a strong term or more than a
// trace of overlap. It is a visible, tunable retrieval parameter, not a
// semantic threshold; raising it trades recall for precision.
export function resolve(index, query, { floor = 0.25, limit = 5 } = {}) {
  const queryTokens = tokenize(query);
  const scored = (index.entries || [])
    .map((entry) => {
      const { score, hits } = scoreEntry(queryTokens, entry);
      return { surface_url: entry.surface_url, capability: entry.capability, score, hits };
    })
    .filter((r) => r.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { query, query_tokens: queryTokens, matches: scored };
}

// Project a diagnostic resolve() result down to the PUBLIC WebMCP contract:
// { matches: [{ surface_url, capability: { id, description } }] }. No score,
// no hits, no query echo — candidates only. Retrieval math stays diagnostic;
// the agent sees provider surfaces.
export function toPublicContract(resolved) {
  return {
    matches: (resolved.matches || []).map((m) => ({
      surface_url: m.surface_url,
      capability: { id: m.capability.id, description: m.capability.description },
    })),
  };
}
