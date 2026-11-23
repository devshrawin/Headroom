// Serves the weather preview at http://localhost:8802 (a secure context, so "Use my location" works).
//   node tools/weather-preview/serve.mjs
// Only index.html and the converted JPEGs in ./assets are served.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('./', import.meta.url));
createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = /^\/assets\/([A-Za-z0-9_.-]+\.jpg)$/.exec(url.pathname);
  if (m) {
    const f = join(root, 'assets', m[1]);
    if (!existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' });
    res.end(readFileSync(f));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(readFileSync(join(root, 'index.html')));
}).listen(8802, '127.0.0.1', () => console.log('weather preview on http://localhost:8802'));
