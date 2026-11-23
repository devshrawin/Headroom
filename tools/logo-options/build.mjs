// Draws the logo options as SVG (no blue), and a preview sheet showing each at 128, 48 and 16 px.
//   node tools/logo-options/build.mjs   ->  docs/logo-options/*.svg, sheet.html, sheet.png (needs Chrome for the PNG)
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'docs/logo-options');
mkdirSync(out, { recursive: true });

const sq = (id, a, b, extra = '') => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>${extra}</defs><rect width="128" height="128" rx="28" fill="url(#${id})"/>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${body}</svg>`;
const bar = (x, y, w, fill, track = '#fff', ta = .35, h = 14, col = '#fff') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${track}" opacity="${ta}"/><rect x="${x}" y="${y}" width="${fill}" height="${h}" rx="${h / 2}" fill="${col}"/>`;

const logos = [
  ['1-sunrise-bar', 'Sunrise bar', svg(`${sq('a', '#FFB36B', '#E4457A')}<circle cx="64" cy="62" r="25" fill="#FFF3CF"/><circle cx="64" cy="62" r="34" fill="#FFF3CF" opacity=".25"/>${bar(20, 94, 88, 58)}`)],
  ['2-dusk-horizon', 'Dusk horizon', svg(`${sq('b', '#2B1B3D', '#6A2D5B')}<path d="M32 76a32 32 0 0 1 64 0z" fill="url(#sun)"/><defs><linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD27A"/><stop offset="1" stop-color="#FF8A4C"/></linearGradient></defs><rect x="22" y="84" width="84" height="7" rx="3.5" fill="#FFE9C9"/><rect x="22" y="97" width="58" height="7" rx="3.5" fill="#FFE9C9" opacity=".6"/><rect x="22" y="110" width="30" height="0" rx="3.5" fill="#FFE9C9"/>`)],
  ['3-cloud-bar', 'Cloud and bar', svg(`${sq('c', '#F7A072', '#EE5D6C')}<g fill="#fff"><circle cx="48" cy="58" r="17"/><circle cx="68" cy="48" r="22"/><circle cx="88" cy="60" r="15"/><rect x="34" y="58" width="68" height="20" rx="10"/></g>${bar(26, 94, 76, 44, '#fff', .4, 12)}`)],
  ['4-moon-bar', 'Moon and bar', svg(`${sq('d', '#1E1B2E', '#4A2C57')}<mask id="m"><rect width="128" height="128" fill="#fff"/><circle cx="76" cy="46" r="24" fill="#000"/></mask><circle cx="58" cy="52" r="26" fill="#FFF1C9" mask="url(#m)"/><circle cx="96" cy="30" r="3" fill="#FFF1C9"/><circle cx="34" cy="28" r="2" fill="#FFF1C9" opacity=".7"/>${bar(24, 94, 80, 52, '#FFF1C9', .25, 12, '#FFC857')}`)],
  ['5-gauge', 'Gauge', svg(`${sq('e', '#2A2523', '#171413')}<path d="M24 86A40 40 0 0 1 104 86" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="13" stroke-linecap="round"/><path d="M24 86A40 40 0 0 1 84 51.4" fill="none" stroke="url(#g)" stroke-width="13" stroke-linecap="round"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFD166"/><stop offset="1" stop-color="#FF6B4A"/></linearGradient></defs><circle cx="64" cy="86" r="8" fill="#FFE9C9"/>`)],
  ['6-h-bar', 'H with a bar', svg(`${sq('f', '#2F9E6F', '#1B5E45')}<rect x="32" y="30" width="17" height="68" rx="8.5" fill="#fff"/><rect x="79" y="30" width="17" height="68" rx="8.5" fill="#fff"/><rect x="40" y="56" width="48" height="16" rx="8" fill="#fff" opacity=".4"/><rect x="40" y="56" width="30" height="16" rx="8" fill="#FFC857"/>`)],
  ['7-sun-dial-light', 'Sun on cream', svg(`${sq('h', '#FFF6E5', '#FFE3B8')}<g stroke="#FF8A3D" stroke-width="6" stroke-linecap="round"><path d="M64 14v10M64 78v0M26 38l7 7M102 38l-7 7M16 62h10M102 62h10"/></g><circle cx="64" cy="58" r="22" fill="#FF8A3D"/>${bar(22, 96, 84, 56, '#2B2118', .16, 14, '#2B2118')}`)],
  ['8-raindrop', 'Raindrop bar', svg(`${sq('i', '#7A2F8E', '#D6477E')}<path d="M64 20C64 20 38 52 38 74a26 26 0 0 0 52 0C90 52 64 20 64 20z" fill="#fff"/><rect x="50" y="70" width="28" height="11" rx="5.5" fill="#D6477E" opacity=".3"/><rect x="50" y="70" width="18" height="11" rx="5.5" fill="#D6477E"/>`)],
];

for (const [file, , body] of logos) writeFileSync(join(out, file + '.svg'), body);
const cell = ([file, name, body]) => `<div class="c"><div class="big">${body}</div><div class="row"><div class="sm" style="width:48px;height:48px">${body.replace('width="128" height="128"', 'width="48" height="48"')}</div><div class="sm" style="width:16px;height:16px">${body.replace('width="128" height="128"', 'width="16" height="16"')}</div></div><b>${file.split('-')[0]}. ${name}</b></div>`;
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f4f1ec;font:15px system-ui,sans-serif;color:#2b2118}.g{display:grid;grid-template-columns:repeat(4,1fr);gap:28px 20px;padding:32px 36px;width:1200px}.c{display:flex;flex-direction:column;align-items:center;gap:10px}.row{display:flex;gap:14px;align-items:center}h1{margin:28px 36px 0;font-size:22px}</style><h1>Headroom logo options (no blue)</h1><div class="g">${logos.map(cell).join('')}</div>`;
writeFileSync(join(out, 'sheet.html'), html);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const r = spawnSync(CHROME, ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1272,700', `--screenshot=${join(out, 'sheet.png')}`, 'file:///' + join(out, 'sheet.html').replace(/\\/g, '/')], { stdio: 'ignore' });
console.log('chrome exit', r.status, 'wrote', logos.length, 'logos to', out);
