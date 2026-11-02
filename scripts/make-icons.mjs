// Renders assets/headroom-logo.svg to icons/icon{16,32,48,128}.png with headless Chrome (transparent corners).
//   node scripts/make-icons.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root = new URL('../', import.meta.url);
const svg = readFileSync(new URL('assets/headroom-logo.svg', root), 'utf8');
const tmp = join(tmpdir(), 'headroom-icons');
mkdirSync(tmp, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const html = join(tmp, `i${size}.html`);
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  const out = fileURLToPath(new URL(`icons/icon${size}.png`, root));
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${out}`, pathToFileURL(html).href]);
  console.log('icon' + size);
}
rmSync(tmp, { recursive: true, force: true });
