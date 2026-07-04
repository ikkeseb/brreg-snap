// Tiny static server for the preview harness — see README.md.
// Serves ../../dist-chrome (build first), injects shim.js into the two
// HTML entry pages so the built module code finds a `browser` global,
// and proxies regnskapsregisteret (no CORS headers upstream).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, '..', '..', 'dist-chrome');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Server-side proxy for regnskapsregisteret (no CORS upstream).
    if (url.pathname.startsWith('/regnskap-proxy/')) {
      const upstream =
        'https://data.brreg.no/regnskapsregisteret/' +
        url.pathname.slice('/regnskap-proxy/'.length);
      const resp = await fetch(upstream, {
        headers: { accept: 'application/json' },
      });
      const body = await resp.text();
      res.writeHead(resp.status, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }
    const path = url.pathname === '/' ? '/popup/popup.html' : url.pathname;
    const root = path === '/shim.js' ? here : dist;
    let body = await readFile(join(root, path));
    if (path.endsWith('.html')) {
      body = body
        .toString('utf8')
        .replace('<head>', '<head><script src="/shim.js"></script>');
    }
    res.writeHead(200, {
      'content-type': MIME[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(8123, () => console.log('preview on http://localhost:8123'));
