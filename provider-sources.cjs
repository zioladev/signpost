// Deployment configuration only: URLs of provider-owned declarations.
// The browser and declaration proxy share this list. No capability descriptions,
// tool names, execution plans, or provider connections belong here.
const DEFAULT_SOURCES = [
  'https://deckhouse.coffee/agent-capabilities.json',
  'https://chairandcomb.studio/agent-capabilities.json',
  'https://hexregistry.dev/agent-capabilities.json',
];

function declarationUrls(env = process.env) {
  const extra = JSON.parse(env.SIGNPOST_EXTRA_DECLARATION_URLS || '[]');
  if (!Array.isArray(extra)) throw new Error('SIGNPOST_EXTRA_DECLARATION_URLS must be a JSON array.');
  for (const value of extra) {
    if (typeof value !== 'string') throw new Error('Declaration URLs must be strings.');
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.hash) {
      throw new Error('Declaration URLs must use HTTPS (or loopback HTTP), without credentials or fragments.');
    }
  }
  return [...new Set([...DEFAULT_SOURCES, ...extra])];
}

module.exports = { declarationUrls };
