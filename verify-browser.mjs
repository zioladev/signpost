// Signpost production shell — browser-side mechanical verification.
//
// Against a document.modelContext polyfill and a mocked /api/declaration proxy
// backed by local fixtures, this exercises the wired presentation shell and
// verifies that it (1) registers exactly `resolve_surface`, (2) loads all three
// provider declarations through the proxy, (3) resolves each tested need to the
// correct provider, (4) returns only the public resolver contract, and (5) emits
// the expected [SIGNPOST] discovery instrumentation events.
//
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node verify-browser.mjs

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = dirname(fileURLToPath(import.meta.url));

const html = readFileSync(join(root, 'index.html'), 'utf8');
const retrieveJs = readFileSync(join(root, 'retrieve.js'), 'utf8');
const cafeDecl = readFileSync(join(root, 'fixtures', 'deckhouse.json'), 'utf8');
const salonDecl = readFileSync(join(root, 'fixtures', 'chairandcomb.json'), 'utf8');
const paletteDecl = readFileSync(join(root, 'fixtures', 'hexregistry.json'), 'utf8');

const PROXY_MAP = new Map([
  ['https://deckhouse.coffee/agent-capabilities.json', cafeDecl],
  ['https://chairandcomb.studio/agent-capabilities.json', salonDecl],
  ['https://hexregistry.dev/agent-capabilities.json', paletteDecl],
]);

const send = (res, type, body, code = 200) => {
  res.statusCode = code;
  res.setHeader('content-type', type);
  res.setHeader('access-control-allow-origin', '*');
  res.end(body);
};

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/declaration')) {
    const u = new URL(req.url, 'http://x').searchParams.get('url') || '';

    if (PROXY_MAP.has(u)) {
      return send(res, 'application/json', PROXY_MAP.get(u));
    }

    return send(
      res,
      'application/json',
      JSON.stringify({ error: 'url not in allowlist' }),
      400
    );
  }

  if (req.url === '/' || req.url.startsWith('/index')) {
    return send(res, 'text/html', html);
  }

  if (req.url.startsWith('/retrieve.js')) {
    return send(res, 'text/javascript', retrieveJs);
  }

  res.statusCode = 404;
  res.end('not found');
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));

const base = `http://127.0.0.1:${server.address().port}/`;

const POLYFILL = `
  (() => {
    const tools = [];
    const mc = {
      registerTool(def){
        tools.push(def);
        return () => {};
      },
      getTools(){
        return tools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }));
      },
      async executeTool(name, argsString){
        const t = tools.find(x => x.name === name);
        if(!t) throw new Error('no tool ' + name);
        const r = await t.execute(argsString ? JSON.parse(argsString) : {});
        return typeof r === 'string' ? r : JSON.stringify(r);
      },
    };
    Object.defineProperty(document, 'modelContext', {
      value: mc,
      configurable: true
    });
  })();
`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium'
});

const page = await browser.newPage();
const consoleLines = [];

page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[SIGNPOST]')) consoleLines.push(t);
});

let pass = 0;
let fail = 0;
const failures = [];

const check = (name, cond, extra) => {
  if (cond) {
    pass += 1;
    console.log('  ✓', name);
  } else {
    fail += 1;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log('  ✗', name, extra ? `— ${extra}` : '');
  }
};

const host = (u) => new URL(u).host;

try {
  await page.addInitScript(POLYFILL);
  await page.goto(base, { waitUntil: 'networkidle' });

  await page
    .waitForFunction(() => window.__signpostReady === true, { timeout: 5000 })
    .catch(() => {});

  console.log('\n── Presentation shell ──');

  check(
    'presentation markup intact (hero title present)',
    (await page.$eval('h1', (e) => e.textContent).catch(() => '')) === 'Signpost.'
  );

  check(
    'capability rows still render (3 declared-capability rows)',
    (await page.$$eval('.cap-row', (els) => els.length)) === 3
  );

  console.log('\n── Registration ──');

  const tools = await page.evaluate(() => document.modelContext.getTools());

  check(
    'exactly one tool registered',
    tools.length === 1,
    `got ${tools.length}`
  );

  check(
    'the tool is resolve_surface',
    tools[0]?.name === 'resolve_surface',
    tools[0]?.name
  );

  check(
    'resolve_surface takes a { capability } string',
    tools[0]?.inputSchema?.properties?.capability?.type === 'string'
  );

  console.log('\n── Declarations loaded via proxy + correct resolution ──');

  const rawHair = await page.evaluate(() =>
    document.modelContext.executeTool(
      'resolve_surface',
      JSON.stringify({ capability: 'book me a haircut' })
    )
  );

  const pubHair = JSON.parse(JSON.parse(rawHair).content[0].text);

  check(
    '"book me a haircut" → salon',
    host(pubHair.matches?.[0]?.surface_url) === 'chairandcomb.studio',
    pubHair.matches?.[0] && host(pubHair.matches[0].surface_url)
  );

  const rawCoffee = await page.evaluate(() =>
    document.modelContext.executeTool(
      'resolve_surface',
      JSON.stringify({ capability: 'order a coffee' })
    )
  );

  const pubCoffee = JSON.parse(JSON.parse(rawCoffee).content[0].text);

  check(
    '"order a coffee" → cafe',
    host(pubCoffee.matches?.[0]?.surface_url) === 'deckhouse.coffee',
    pubCoffee.matches?.[0] && host(pubCoffee.matches[0].surface_url)
  );

  const rawHex = await page.evaluate(() =>
    document.modelContext.executeTool(
      'resolve_surface',
      JSON.stringify({ capability: 'check a hex color' })
    )
  );

  const pubHex = JSON.parse(JSON.parse(rawHex).content[0].text);

  check(
    '"check a hex color" → hex registry',
    host(pubHex.matches?.[0]?.surface_url) === 'hexregistry.dev',
    pubHex.matches?.[0] && host(pubHex.matches[0].surface_url)
  );

  console.log('\n── Public contract: score/hits/query stripped ──');

  const blobHair = JSON.parse(rawHair).content[0].text;

  check(
    'public output carries NO score',
    !blobHair.includes('score') &&
      pubHair.matches.every((m) => !('score' in m))
  );

  check(
    'public output carries NO hits/query',
    !blobHair.includes('hits') &&
      !('query' in pubHair)
  );

  check(
    'public match shape is { surface_url, capability{ id, description } }',
    pubHair.matches.every(
      (m) =>
        Object.keys(m).sort().join(',') === 'capability,surface_url' &&
        Object.keys(m.capability).sort().join(',') === 'description,id'
    )
  );

  check(
    'public output invents no next/order/plan/session',
    !['next', 'order', 'plan', 'session'].some((k) => k in pubHair)
  );

  console.log('\n── Statelessness / journey-blindness ──');

  const rawCoffee2 = await page.evaluate(() =>
    document.modelContext.executeTool(
      'resolve_surface',
      JSON.stringify({ capability: 'order a coffee' })
    )
  );

  check(
    'two identical calls → identical public results (pure)',
    JSON.stringify(pubCoffee) ===
      JSON.stringify(JSON.parse(JSON.parse(rawCoffee2).content[0].text))
  );

  console.log('\n── Instrumentation events + capture accessor ──');

  const blob = consoleLines.join('\n');

  for (const k of [
    'page_loaded',
    'declaration_loaded',
    'index_built',
    'declarations_check',
    'webmcp_present',
    'tool_registered',
    'resolve_surface_called',
  ]) {
    check(`event fired: ${k}`, blob.includes(k));
  }

  check(
    'declarations_check shows 3/3 loaded ok',
    /declarations_check.*3\/3.*ok/.test(blob),
    blob.split('\n').find((l) => l.includes('declarations_check')) || 'none'
  );

  const logText = await page.evaluate(() =>
    typeof window.__signpostLog === 'function'
      ? window.__signpostLog()
      : ''
  );

  check(
    '__signpostLog() capture accessor returns the event log',
    /resolve_surface_called/.test(logText)
  );

  console.log(
    `\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed.`
  );
} finally {
  await browser.close();
  server.close();
}

if (fail > 0) {
  for (const f of failures) {
    console.log('   • ' + f);
  }
  process.exit(1);
}
