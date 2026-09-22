import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildIndex, resolve, toPublicContract } from './retrieve.js';
const require = createRequire(import.meta.url);
const { declarationUrls } = require('./provider-sources.cjs');
const declaration = {
  surface_url: 'https://design-library.example/mcp',
  transport: 'mcp-streamable-http',
  capabilities: [{ id: 'retrieve_svg_design', description: 'Browse and retrieve original SVG vector drawings and illustrations.' }],
};

test('MCP candidates retain the provider endpoint and transport without a plan', () => {
  const index = buildIndex([declaration]);
  const before = JSON.stringify(index);
  const result = toPublicContract(resolve(index, 'find an SVG illustration'));
  assert.deepEqual(result, { matches: [{
    surface_url: declaration.surface_url, transport: declaration.transport, capability: declaration.capabilities[0],
  }] });
  assert.equal(JSON.stringify(index), before);
});

test('unlabelled WebMCP results retain their original shape', () => {
  const { transport, ...legacy } = declaration;
  assert.deepEqual(toPublicContract(resolve(buildIndex([legacy]), 'SVG')), {
    matches: [{ surface_url: legacy.surface_url, capability: legacy.capabilities[0] }],
  });
});

test('unknown transports and unusable endpoint URLs are not silently presented as WebMCP', () => {
  for (const bad of [
    { ...declaration, transport: 'unknown' },
    { ...declaration, surface_url: 'javascript:alert(1)' },
    { ...declaration, surface_url: 'not a URL' },
  ]) assert.equal(buildIndex([bad]).entries.length, 0);
});

test('configured source URLs contain no injected capabilities and preserve defaults', () => {
  const defaults = declarationUrls({});
  assert.equal(defaults.length, 3);
  const added = 'http://127.0.0.1:3100/agent-capabilities.json';
  assert.deepEqual(declarationUrls({ SIGNPOST_EXTRA_DECLARATION_URLS: JSON.stringify([added, added]) }), [...defaults, added]);
  for (const input of ['{}', '[1]', '["http://remote.example/a.json"]', '["https://user:secret@example.com/a.json"]']) {
    assert.throws(() => declarationUrls({ SIGNPOST_EXTRA_DECLARATION_URLS: input }));
  }
});

test('the configured declaration proxy relays provider data verbatim and rejects unlisted URLs', async () => {
  const handler = require('./api/declaration.js');
  const oldEnv = process.env.SIGNPOST_EXTRA_DECLARATION_URLS;
  const oldFetch = globalThis.fetch;
  const url = 'https://design-library.example/agent-capabilities.json';
  process.env.SIGNPOST_EXTRA_DECLARATION_URLS = JSON.stringify([url]);
  let calls = 0;
  globalThis.fetch = async (requested, options) => {
    calls++;
    assert.equal(requested, url);
    assert.ok(options.signal);
    return { ok: true, text: async () => JSON.stringify(declaration) };
  };
  const response = () => ({
    code: 200, body: undefined, setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; }, send(body) { this.body = body; },
  });
  try {
    const res = response();
    await handler({ query: { url } }, res);
    assert.equal(res.body, JSON.stringify(declaration));
    assert.equal(calls, 1);
    const rejected = response();
    await handler({ query: { url: 'http://127.0.0.1:1234/private' } }, rejected);
    assert.equal(rejected.code, 400);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnv === undefined) delete process.env.SIGNPOST_EXTRA_DECLARATION_URLS;
    else process.env.SIGNPOST_EXTRA_DECLARATION_URLS = oldEnv;
  }
});
