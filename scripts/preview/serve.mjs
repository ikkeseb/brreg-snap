// Tiny static server for the preview harness — see README.md.
// Serves ../../dist-chrome (build first), injects shim.js into the HTML
// entry pages so the built module code finds a `browser` global, and
// answers every data.brreg.no call the shim reroutes to /brreg/: from
// the live API by default, or from recorded files with --fixtures.
//
//   node scripts/preview/serve.mjs [--port 8123] [--fixtures <dir>]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fixtureReply, loadFixtures, MISS_HEADER } from './fixtures.mjs';

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '8123' },
    fixtures: { type: 'string' },
  },
});

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const dist = resolve(here, '..', '..', 'dist-chrome');
const fixtures = args.fixtures
  ? await loadFixtures(resolve(args.fixtures))
  : undefined;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
};

// The built manifest's extension-page CSP, sent as a response header so
// the harness enforces the shipped policy. One deviation: connect-src
// also allows 'self', because the shim reroutes data.brreg.no calls to
// this server's /brreg/ path.
async function harnessCsp() {
  const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
  return manifest.content_security_policy.extension_pages.replace(
    /connect-src ([^;]*)/,
    "connect-src 'self' $1",
  );
}

async function brreg(pathAndQuery) {
  if (fixtures) return fixtureReply(fixtures, pathAndQuery);
  const resp = await fetch('https://data.brreg.no' + pathAndQuery, {
    headers: { accept: 'application/json' },
  });
  return {
    status: resp.status,
    headers: { 'content-type': 'application/json' },
    body: await resp.text(),
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/brreg/')) {
      // An unreachable upstream is a 502, not the 404 below ("not found"
      // means something else to the extension).
      const reply = await brreg(url.pathname.slice('/brreg'.length) + url.search).catch(
        (err) => ({ status: 502, headers: {}, body: String(err) }),
      );
      if (reply.headers[MISS_HEADER]) {
        console.error(`fixture miss: ${url.pathname}${url.search}`);
      }
      res.writeHead(reply.status, { ...reply.headers, 'cache-control': 'no-store' });
      res.end(reply.body);
      return;
    }
    const path = url.pathname === '/' ? '/popup/popup.html' : url.pathname;
    const root = path === '/shim.js' ? here : dist;
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) throw new Error('outside root');
    let body = await readFile(file);
    const headers = {
      'content-type': MIME[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    };
    if (path.endsWith('.html')) {
      body = body
        .toString('utf8')
        .replace('<head>', '<head><script src="/shim.js"></script>');
      headers['content-security-policy'] = await harnessCsp();
    }
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

// Loopback only: the server exposes dist-chrome and a brreg passthrough.
server.listen(Number(args.port), '127.0.0.1', () => {
  const { port } = server.address();
  const mode = fixtures ? `fixtures from ${args.fixtures}` : 'live brreg API';
  console.log(`preview on http://127.0.0.1:${port} (${mode})`);
});
