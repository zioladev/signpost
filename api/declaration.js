// Server-side declaration proxy for Signpost (Vercel Node Serverless Function).
//
// Signpost's browser surface loads provider-authored capability declarations
// through this same-origin endpoint so browser CORS does not block discovery.
// The server fetches the provider's live declaration server-to-server.
//
// The proxy does not add or modify capability data. It validates that the
// upstream body is JSON and relays the declaration to the Signpost page.
// Only the seeded provider declaration URLs are allowed, so this is not an
// open proxy.

const ALLOWED = new Set([
  'https://deckhouse.coffee/agent-capabilities.json',      // commerce  — order_item (gated)
  'https://chairandcomb.studio/agent-capabilities.json',   // booking   — book_appointment (gated)
  'https://hexregistry.dev/agent-capabilities.json',        // read-only — check_palette (ungated)
]);

module.exports = async function handler(req, res) {
  const url = req.query && typeof req.query.url === 'string' ? req.query.url : '';
  res.setHeader('Access-Control-Allow-Origin', '*'); // page is same-origin; harmless
  res.setHeader('Cache-Control', 'public, max-age=60');

  if (!ALLOWED.has(url)) {
    res.status(400).json({ error: 'url not in allowlist', allowed: [...ALLOWED] });
    return;
  }
  try {
    const upstream = await fetch(url, { headers: { accept: 'application/json' } });
    if (!upstream.ok) {
      res.status(502).json({ error: `upstream HTTP ${upstream.status}`, url });
      return;
    }
    const text = await upstream.text();
    // Validate that the upstream body parses as JSON before relaying it. A broken
    // upstream surfaces as an error the page can record instead of being indexed.
    try {
      JSON.parse(text);
    } catch {
      res.status(502).json({ error: 'upstream returned non-JSON', url });
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).json({ error: 'fetch failed', detail: String((err && err.message) || err), url });
  }
};
