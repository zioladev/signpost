// test/smoke-browser.mjs — real-browser smoke test of the BUILT commerce provider in
// AWAIT/RESUME mode. Exercises the shipped bundle through the whole loop in ONE tool call:
//   order_item invoked → Authorize panel appears → browser-generated trusted click →
//   the SAME parked invocation resumes → exact-term revalidation → mutation → result.
// Also checks single-use re-authorization and refusal of a synthetic page-script click.
// Playwright .click() produces a trusted browser event (isTrusted true);
// page.evaluate(() => btn.click()) produces a synthetic event (isTrusted false).
// node test/smoke-browser.mjs
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname, normalize, extname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'commerce');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
};

let pass = 0;
let fail = 0;

const ok = (name, cond, extra = '') => {
  (cond ? pass++ : fail++);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

const server = createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(req.url.split('?')[0]));
    if (p === '/' || p.endsWith('/')) p += 'index.html';

    const file = join(DIST, p);
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end();
      return;
    }

    await stat(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// WebMCP polyfill: a minimal registry on document.modelContext.
const POLYFILL = `(() => {
  const tools = new Map();
  const registry = {
    registerTool(tool){ tools.set(tool.name, tool); return true; },
    async executeTool(name, args){ const t = tools.get(name); if(!t) throw new Error('no tool '+name); return t.execute(args||{}); },
    _names(){ return [...tools.keys()]; },
  };
  Object.defineProperty(document, 'modelContext', { value: registry, configurable: true });
  window.__mcp = registry;
})();`;

const browser = await chromium.launch();

try {
  const page = await browser.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error') console.log('    [page error]', m.text());
  });

  await page.addInitScript(POLYFILL);
  await page.goto(base + '/', { waitUntil: 'networkidle' });

  await page
    .waitForFunction(
      () => window.__mcp && window.__mcp._names().includes('order_item'),
      { timeout: 5000 },
    )
    .catch(() => {});

  const names = await page.evaluate(() =>
    window.__mcp ? window.__mcp._names() : [],
  );

  ok(
    'vendored execution-control import resolved and tools registered',
    names.includes('order_item') && names.includes('read_catalog'),
    names.join(','),
  );

  const parse = (r) => {
    try {
      return JSON.parse(r.content[0].text);
    } catch {
      return r;
    }
  };

  const orders = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('signpost.commerce.orders') || '[]').length,
    );

  // Kick order_item WITHOUT awaiting the parking promise; stash it on window.
  const kick = (quantity = 1) =>
    page.evaluate((q) => {
      window.__order = window.__mcp.executeTool('order_item', {
        item: 'house_blend',
        quantity: q,
      });
    }, quantity);

  const settleParsed = async () =>
    parse(await page.evaluate(async () => await window.__order));

  // Read tool works without the consequential execution-control path.
  const cat = parse(
    await page.evaluate(() => window.__mcp.executeTool('read_catalog', {})),
  );

  ok(
    'read_catalog returns items without consequential execution control',
    Array.isArray(cat.items) && cat.items.length > 0,
  );

  // 1) AWAIT/RESUME happy path:
  // one call parks → panel → trusted browser activation → same call resumes.
  const before1 = await orders();

  await kick(1);
  await page.waitForSelector('#authorize-panel:not([hidden])', {
    timeout: 3000,
  });

  ok('order_item parked and the Authorize panel appeared', true);

  await page.click('#authz-btn');

  const r1 = await settleParsed();
  const after1 = await orders();

  ok(
    'same parked call resumed → order placed',
    r1.placed === true &&
      r1.status === 'confirmed' &&
      /^CM-/.test(r1.order_number || ''),
    r1.order_number,
  );

  ok(
    'exactly one mutation from the resume',
    after1 === before1 + 1,
    `orders ${before1}→${after1}`,
  );

  // 2) SINGLE-USE:
  // a second order remains unexecuted until a fresh authorization is minted.
  const before2 = await orders();

  await kick(1);
  await page.waitForSelector('#authorize-panel:not([hidden])', {
    timeout: 3000,
  });

  const parked2 = await orders();

  ok(
    'prior authorization is not reusable: second call remains unexecuted',
    parked2 === before2,
    `orders ${before2}→${parked2}`,
  );

  await page.click('#authz-btn');

  const r2 = await settleParsed();
  const after2 = await orders();

  ok(
    'fresh authorization lets the second parked call resume',
    r2.placed === true && r2.status === 'confirmed',
    r2.status,
  );

  ok(
    'fresh authorization permits exactly one more mutation',
    after2 === before2 + 1,
    `orders ${before2}→${after2}`,
  );

  // 3) SYNTHETIC activation is refused:
  // a parked call + page-script click mints no authorization.
  const before3 = await orders();

  await kick(1);
  await page.waitForSelector('#authorize-panel:not([hidden])', {
    timeout: 3000,
  });

  await page.evaluate(() =>
    document.querySelector('#authz-btn').click(),
  );

  const status = await page.textContent('#authz-status');

  ok(
    'synthetic .click() on Authorize refused',
    /refused/i.test(status || ''),
    JSON.stringify(status),
  );

  const after3 = await orders();

  ok(
    'refused activation → zero mutation while call remains parked',
    after3 === before3,
    `orders ${before3}→${after3}`,
  );

  // Leave the final parked invocation unresolved; browser.close() tears it down.
} finally {
  await browser.close();
  server.close();
}

console.log(
  `\nsmoke-browser (await/resume) — ${pass} passed, ${fail} failed`,
);

process.exit(fail ? 1 : 0);
