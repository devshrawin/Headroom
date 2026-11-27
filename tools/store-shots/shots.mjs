// Makes the Chrome Web Store images with the REAL extension: it loads the unpacked extension into Playwright's Chromium, serves a
// neutral mock chat page in place of a supported host (so the real content script, bar, background and details panel run on it),
// seeds sample numbers, and captures:
//   screenshots 1280x800 (x5), promo tile 440x280, marquee 1400x560  ->  docs/store/assets/
//   cd e2e && npm ci && cd .. && node tools/store-shots/shots.mjs         (needs internet once, for the sample place's real sunset time)
// No account, no real chat and no brand logo is ever on screen: the page is made here and the numbers are samples.
// (Until 2.0 this drove a branded Chrome over raw CDP; current Chrome no longer loads unpacked extensions from the command line.)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../e2e/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const OUT = join(root, 'docs/store/assets');
mkdirSync(OUT, { recursive: true });
const HOST = 'https://poe.com/'; // a host the extension already runs on; the document is replaced by the mock below
const icon = readFileSync(join(root, 'icons/icon128.png')).toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = (q) => {
  const dark = q.get('dark') === '1', promo = q.get('promo');
  const c = dark ? { bg: '#14151a', text: '#ececf1', me: '#3b3563', ai: '#26272e', box: '#26272e', mute: '#9a9aa8' } : { bg: '#ffffff', text: '#1f1d2b', me: '#ece9f7', ai: '#f4f4f6', box: '#ffffff', mute: '#6b6880' };
  const chat = promo ? '' : `<div class="m me">Can you summarise the main risks in this contract?</div>
  <div class="m ai">Three things stand out: the auto-renewal clause, the liability cap, and the unusual termination notice period. Want me to go through each one?</div>
  <div class="m me">Yes, start with the liability cap.</div>
  <div class="m ai">The cap is set at the fees paid in the last twelve months, which is common, but it excludes data loss. That is the part worth negotiating.</div>`;
  const hero = promo ? `<div class="hero"><img src="data:image/png;base64,${icon}" width="${promo === 'tile' ? 72 : 140}" height="${promo === 'tile' ? 72 : 140}" alt=""><div><h1>Headroom</h1><p>Limits, in sight.</p>${promo === 'marquee' ? '<p class="s">Your AI usage as a thin bar, under the real weather.</p>' : ''}</div></div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Assistant</title><style>
*{box-sizing:border-box}html,body{margin:0;height:100%}body{background:${c.bg};color:${c.text};font:16px/1.5 system-ui,"Segoe UI",sans-serif}
.top{height:52px;display:flex;align-items:center;padding:0 24px;font-weight:600;color:${c.mute}}
.col{max-width:720px;margin:0 auto;padding:12px 24px;display:flex;flex-direction:column;gap:14px}
.m{max-width:82%;padding:12px 16px;border-radius:18px}.me{align-self:flex-end;background:${c.me}}.ai{align-self:flex-start;background:${c.ai}}
.box{position:fixed;left:50%;transform:translateX(-50%);bottom:34px;width:min(720px,calc(100% - 48px));background:${c.box};border:1px solid ${dark ? '#3a3b44' : '#dcdae6'};border-radius:26px;padding:14px 20px;color:${c.mute};box-shadow:0 6px 24px rgba(0,0,0,.12)}
.hero{position:fixed;inset:0 0 14px 0;display:flex;align-items:center;justify-content:center;gap:28px;color:#fff;text-shadow:0 2px 18px rgba(0,30,90,.45)}
.hero h1{margin:0;font-size:${promo === 'tile' ? 44 : 84}px;line-height:1;letter-spacing:-.03em}.hero p{margin:6px 0 0;font-size:${promo === 'tile' ? 18 : 32}px}.hero .s{font-size:22px;opacity:.9}
</style></head><body>${promo ? '' : '<div class="top">Assistant</div>'}<div class="col">${chat}</div>${promo ? '' : '<div class="box">Message the assistant…</div>'}${hero}</body></html>`;
};

const profile = mkdtempSync(join(tmpdir(), 'hr-shots-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: true, channel: 'chromium', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  await ctx.route('https://poe.com/**', (r) => {
    const u = new URL(r.request().url());
    if (r.request().resourceType() === 'document') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mock(u.searchParams) });
    return r.fulfill({ status: 204, body: '' });
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const place = { name: 'London, United Kingdom', lat: 51.51, lon: -0.13 };
  const setSettings = (force, extra = {}) => sw.evaluate(async (s) => chrome.storage.local.set({ settings: s }), { weather: true, weatherPlace: place, weatherStrength: 1, meterStyle: 'bar-top', weatherForce: force,
    quotas: { poe: [{ id: 'messages', label: 'Messages', pattern: '.*', limit: 100, windowHours: 24 }] }, // a limit, so the bar shows a percentage
    ...extra });
  const seed = (n) => sw.evaluate(async (n) => chrome.storage.local.set({ 'events.poe': Array.from({ length: n }, (_, i) => ({ t: Date.now() - (i + 1) * 60000, m: 'chat' })) }), n);
  const shot = async (page, name) => { writeFileSync(join(OUT, name + '.png'), await page.screenshot()); console.log('wrote', name); };

  // the real sunset at the sample place, for the golden-hour shot (falls back to 17.5 offline)
  await setSettings(null);
  const wn = await sw.evaluate(async () => { try { return await chrome.runtime.sendMessage({ type: 'headroom:weatherNow' }); } catch (e) { return { ok: false }; } });
  await sleep(1500);
  const sunset = await sw.evaluate(async () => { const r = await chrome.storage.local.get('weather.data'); return r['weather.data'] ? r['weather.data'].set : null; });
  const GOLD = typeof sunset === 'number' ? Math.round((sunset - 0.2) * 100) / 100 : 17.5;
  console.log('weather fetch', wn && wn.ok, 'sunset at', sunset, '-> golden hour', GOLD);

  const look = async (name, { force, dark, n, panel, hover, fluid }) => {
    await setSettings(force, fluid ? { weatherStyle: 'fluid' } : {}); await seed(n);
    const page = await ctx.newPage();
    await page.goto(`${HOST}?dark=${dark ? 1 : 0}`);
    await sleep(7000);
    const where = await page.evaluate(() => { const h = document.querySelector('[data-headroom=""]'); const b = h && h.shadowRoot && h.shadowRoot.querySelector('.bar, .pill, [role=button]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (hover && where) { await page.mouse.move(where.x - 200, where.y + 40); await page.mouse.move(where.x - 200, where.y + 2, { steps: 4 }); await sleep(500); }
    if (panel) {
      if (where) { await page.mouse.move(where.x, where.y); await page.mouse.click(where.x, where.y); await sleep(500); }
      else console.log('no bar found for the panel shot');
    }
    if (fluid) { // two slow loops of the cursor across the page: the fluid only moves when the cursor does, and is still bright when the shot is taken
      for (const [cx, cy, rx, ry, turns] of [[420, 430, 330, 190, 1.6], [900, 360, 260, 210, 1.2]]) {
        const steps = Math.round(turns * 60);
        for (let i = 0; i <= steps; i++) {
          const a = (i / 60) * Math.PI * 2;
          await page.mouse.move(Math.round(cx + Math.cos(a) * rx * (1 + i / (steps * 1.6))), Math.round(cy + Math.sin(a * 1.2) * ry));
          await sleep(22);
        }
      }
      await sleep(250);
    }
    // a neutral name in the panel and tooltip: no brand on screen
    await page.evaluate(() => { const h = document.querySelector('[data-headroom=""]'); if (!h || !h.shadowRoot) return; const w = document.createTreeWalker(h.shadowRoot, 4); for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeValue = n.nodeValue.replace(/Poe/g, 'Assistant'); });
    await sleep(300);
    await shot(page, name);
    await page.close();
  };

  await look('1-clear-day', { force: { weather: 'clear', season: 'summer', tod: 13.5 }, n: 52, hover: true });
  await look('2-sunset-details', { force: { weather: 'clear', season: 'autumn', tod: GOLD }, n: 70, panel: true });
  await look('3-fluid', { force: null, dark: true, n: 40, fluid: true });

  // the redesigned Settings page, and the new Welcome (onboarding) page: both are the extension's own pages
  await setSettings(null);
  const opts = await ctx.newPage();
  await opts.setViewportSize({ width: 1280, height: 800 });
  await opts.goto(`chrome-extension://${extId}/src/options/options.html#weather`);
  await sleep(2500);
  await shot(opts, '4-settings-weather');
  await opts.goto(`chrome-extension://${extId}/src/welcome/welcome.html`);
  await sleep(2000);
  await shot(opts, '5-welcome');
  await opts.close();

  // promo tile and marquee: the logo and name over a sunset sky
  for (const [name, w, h, kind] of [['promo-tile-440x280', 440, 280, 'tile'], ['marquee-1400x560', 1400, 560, 'marquee']]) {
    await setSettings({ weather: 'clear', season: 'autumn', tod: GOLD }); await seed(0);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${HOST}?promo=${kind}`);
    await sleep(7000);
    await shot(page, name);
    await page.close();
  }
  // the store icon is the extension's own 128 px icon
  writeFileSync(join(OUT, 'store-icon-128.png'), readFileSync(join(root, 'icons/icon128.png')));
  console.log('wrote store-icon-128');
} catch (e) { console.error('ERROR', e); process.exitCode = 1; } finally { await ctx.close(); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
