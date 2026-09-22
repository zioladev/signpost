// Local preview of the actual page and API handlers. Extra sources must be
// configured by the operator; no URL query parameter can add a provider.
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const providers = require('./api/providers.js');
const declaration = require('./api/declaration.js');
const files = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/retrieve.js', ['retrieve.js', 'text/javascript']],
  ['/about.html', ['about.html', 'text/html']],
  ['/dashboard.html', ['dashboard.html', 'text/html']],
  ['/dashboard-logic.js', ['dashboard-logic.js', 'text/javascript']],
]);

export function createPreviewServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (value) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    res.send = (value) => res.end(value);
    req.query = Object.fromEntries(url.searchParams);
    try {
      if (url.pathname === '/api/providers') return providers(req, res);
      if (url.pathname === '/api/declaration') return await declaration(req, res);
      // Local preview does not write to the deployed evidence collector.
      if (url.pathname === '/api/evidence') {
        res.statusCode = 204; res.end(); return;
      }
      const file = files.get(url.pathname);
      if (!file) { res.status(404).json({ error: 'Not found' }); return; }
      res.setHeader('content-type', file[1]);
      res.end(await readFile(new URL(file[0], import.meta.url)));
    } catch { if (!res.headersSent) res.status(500).json({ error: 'Preview request failed' }); else res.end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3200);
  const server = createPreviewServer();
  server.listen(port, '127.0.0.1', () => console.log(`Signpost preview: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
