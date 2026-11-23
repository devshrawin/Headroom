// Renders the chosen logo (an SVG in docs/logo-options) to icons/icon{16,32,48,128}.png and assets/headroom-logo*.png
// with a transparent background, using headless Chrome (each size is drawn from the vector, not scaled down).
//   node tools/logo-options/make-icons.mjs [4-moon-bar]
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const name = process.argv[2] || '4-moon-bar';
const svg = readFileSync(join(root, 'docs/logo-options', name + '.svg'), 'utf8');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const tmp = mkdtempSync(join(tmpdir(), 'hr-icons-'));
const render = (n, dest) => {
  const html = join(tmp, `i${n}.html`);
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg.replace('width="128" height="128"', `width="${n}" height="${n}"`)}`);
  const r = spawnSync(CHROME, ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--default-background-color=00000000', `--window-size=${n},${n}`, `--screenshot=${dest}`, 'file:///' + html.split(String.fromCharCode(92)).join('/')], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error('chrome failed for ' + n);
  console.log('wrote', dest);
};
for (const n of [16, 32, 48, 128]) render(n, join(root, 'icons', `icon${n}.png`));
render(512, join(root, 'assets/headroom-logo-source.png'));
copyFileSync(join(root, 'assets/headroom-logo-source.png'), join(root, 'assets/headroom-logo.png'));
