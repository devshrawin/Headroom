// Behaviour of the automatic text colour (ink) over time: hover, streaming replies, pseudo-element cards, a theme switch.
// (Node port of tests/headroom-1.4.6/ink_behaviour.py: Python is not available on the owner's machine.)
// Light page, clear night (white ink). Each check is a WCAG contrast against the element's own background:
//   hover   a sidebar row that only gets a white background under the pointer must not keep white text while hovered, and
//           must get the ink back when the pointer leaves
//   stream  a reply streamed in (text chunks, then a new white card and a code block) must show readable text in the first frames
//   pseudo  a card drawn by ::before keeps the site's text colour
//   theme   the page switches to its dark theme: cards keep readable text afterwards
// Usage: node ink.mjs <extDir> [--json]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(here, '..'));
const json = process.argv.includes('--json');
let html = fs.readFileSync(new URL('./fixtures/sky.html', import.meta.url), 'utf8');
for (const [k, v] of Object.entries({ PAGE_BG: 'rgb(248, 248, 252)', CARD_BG: '#ffffff', TEXT: '#1f1e1d', MUTED: '#73726c', LINK: '#2563eb' })) html = html.split(k).join(v);

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-ink-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  headless: true, channel: 'chromium', viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const out = {};
const errors = [];
try {
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 503, body: '' }));
  await ctx.route('https://claude.ai/**', (r) => (r.request().url().includes('/api/') ? r.fulfill({ status: 404, body: '{}' }) : r.fulfill({ contentType: 'text/html', body: html })));
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  await sw.evaluate(async () => chrome.storage.local.set({ settings: { weatherPlace: { name: 'X', lat: 48.85, lon: 2.35 }, weatherForce: { weather: 'clear', season: 'summer', tod: 23 } } }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('https://claude.ai/chat/x');
  await page.waitForTimeout(4000);
  // contrast of an element's text against the nearest painted ancestor (its own fill, or a ::before / ::after card)
  await page.evaluate(() => {
    window.__contrast = (id) => {
      const e = typeof id === 'string' ? document.getElementById(id) : id;
      const lum = (c) => { const n = c.match(/[\d.]+/g).map(Number); const f = (x) => { x /= 255; return x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }; return { L: .2126 * f(n[0]) + .7152 * f(n[1]) + .0722 * f(n[2]), a: n.length > 3 ? n[3] : 1 }; };
      let bg = null;
      for (let a = e; a && a !== document.documentElement; a = a.parentElement) {
        const own = getComputedStyle(a);
        for (const s of [own, getComputedStyle(a, '::before')]) { const b = lum(s.backgroundColor); if (b.a >= .5 && (s === own || s.content !== 'none')) { bg = b.L; break; } }
        if (bg != null) break;
      }
      const t = lum(getComputedStyle(e).color).L;
      return { color: getComputedStyle(e).color, contrast: bg == null ? null : +((Math.max(t, bg) + .05) / (Math.min(t, bg) + .05)).toFixed(2) };
    };
  });
  const contrast = (id) => page.evaluate((i) => window.__contrast(i), id);
  out.ink = await page.evaluate(() => document.documentElement.getAttribute('data-hr-ink'));
  out.restingRow = await contrast('hov'); // on the sky: no painted ancestor, so contrast is null and the colour is the ink
  const box = await page.evaluate(() => { const r = document.getElementById('hov').getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; });
  // The original Python test looked once after a fixed 450 ms. Software WebGL (SwiftShader) makes frames slow enough that the
  // text colour sometimes needs about a second to follow the pointer, so here the check polls for up to 2.5 s: the colour must
  // correct itself, and how long it took is reported (hoverMs / unhoverMs).
  const until = async (ok) => {
    const t0 = Date.now();
    let v = await contrast('hov');
    while (!ok(v) && Date.now() - t0 < 2500) { await page.waitForTimeout(50); v = await contrast('hov'); }
    return [v, Date.now() - t0];
  };
  await page.mouse.move(box[0], box[1]);
  [out.hovered, out.hoverMs] = await until((v) => (v.contrast || 0) >= 4.5);
  await page.mouse.move(1500, 500);
  [out.unhovered, out.unhoverMs] = await until((v) => v.color === 'rgb(254, 254, 253)');
  out.pseudo = await contrast('pcard');
  // a reply streams in: text chunks every 30 ms for 3 s, then a new card and a code block; read the card's text colour two frames later
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const m0 = await metrics();
  out.stream = await page.evaluate(async () => {
    const col = document.querySelector('.col');
    const p = document.createElement('p'); col.appendChild(p);
    for (let i = 0; i < 100; i++) { p.append(document.createTextNode('token' + i + ' ')); await new Promise((r) => setTimeout(r, 30)); }
    const card = document.createElement('div'); card.className = 'card'; card.textContent = 'A new card streamed in';
    const pre = document.createElement('pre'); pre.textContent = 'print("hello")';
    col.append(card, pre);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { streamedText: window.__contrast(p), newCard: window.__contrast(card), newCode: window.__contrast(pre) };
  });
  const m1 = await metrics();
  out.streamCost = { scriptMs: +((m1.ScriptDuration - m0.ScriptDuration) * 1000).toFixed(1), styleMs: +((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000).toFixed(1), layoutMs: +((m1.LayoutDuration - m0.LayoutDuration) * 1000).toFixed(1) };
  // the page switches to its dark theme
  await page.evaluate(() => { const r = document.documentElement.style; r.setProperty('--bg', 'rgb(31, 30, 29)'); r.setProperty('--card', '#2b2a27'); r.setProperty('--text', '#eeeeec'); r.setProperty('--muted', '#a3a29c'); document.documentElement.classList.add('dark'); });
  await page.waitForTimeout(2500);
  out.themeCard = await contrast('card');
  out.themeBubble = await contrast('bubble');
  out.themeBox = await contrast('edit');
  // turning the sky off hands the page back exactly: no marks, no root attributes, no pinned text colours. The check is only
  // meaningful if the ink was active and islands existed beforehand (so something was actually there to remove).
  const state = () => page.evaluate(() => ({
    ink: document.documentElement.getAttribute('data-hr-ink'),
    islands: document.querySelectorAll('[data-hr-island]').length,
    marks: document.querySelectorAll('[data-hr-sky],[data-hr-halo],[data-hr-halo-p],[data-hr-halo-o],[data-hr-island],[data-hr-frost]').length,
    rootAttrs: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('data-hr')),
    pinned: document.querySelectorAll('body [style*="color"]').length,
    canvas: !!document.querySelector('canvas[data-headroom]'),
  }));
  out.beforeOff = await state();
  await sw.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, weather: false } }); });
  await page.waitForTimeout(2000);
  out.afterOff = await state();
} catch (e) {
  errors.push('HARNESS: ' + (e.stack || e));
} finally {
  await ctx.close();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
}
out.errors = errors;
const ink = 'rgb(254, 254, 253)';
const ok = (v) => (v && v.contrast || 0) >= 4.5;
const checks = {
  'ink is white at night': out.ink === 'light',
  'resting row uses the ink': out.restingRow && out.restingRow.color === ink,
  'hovered row readable (>= 4.5)': ok(out.hovered),
  'row gets the ink back': out.unhovered && out.unhovered.color === ink,
  'pseudo-element card readable': ok(out.pseudo),
  'streamed text uses the ink': out.stream && out.stream.streamedText.color === ink,
  'new card readable in its first frames': out.stream && ok(out.stream.newCard),
  'new code block readable': out.stream && ok(out.stream.newCode),
  'after a theme switch, cards readable': ['themeCard', 'themeBubble', 'themeBox'].every((k) => ok(out[k])),
  'ink was active and islands existed before the sky was turned off': !!(out.beforeOff && out.beforeOff.ink && out.beforeOff.islands > 0),
  'turning the sky off leaves no marks, root attributes, pinned colours or canvas': !!(out.afterOff && out.afterOff.marks === 0 && out.afterOff.rootAttrs.length === 0 && out.afterOff.pinned === 0 && !out.afterOff.canvas),
  'no page errors': !errors.length,
};
const pass = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ checks, pass, detail: out }, null, json ? 0 : 2));
process.exit(pass ? 0 : 1);
