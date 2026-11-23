// Makes the Chrome Web Store images with the REAL extension: it loads the unpacked extension into a clean headless
// Chrome, serves a neutral mock chat page in place of a supported host (so the real content script, bar, weather sky and
// details panel run on it), seeds sample numbers, and captures:
//   screenshots 1280x800 (x5), promo tile 440x280, marquee 1400x560  ->  docs/store/assets/
//   node tools/store-shots/shots.mjs
// No account, no real chat and no brand logo is ever on screen: the page is made here and the numbers are samples.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const OUT = join(root, 'docs/store/assets');
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HOST = 'https://poe.com/'; // a host the extension already runs on; the document is replaced by the mock below
const icon = readFileSync(join(root, 'icons/icon128.png')).toString('base64');
const port = 9544;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'hr-shots-'));

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

const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-extension-debugging', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const conn = (url) => new Promise((resolve) => {
  const ws = new WebSocket(url); let id = 0; const waiters = new Map(); const events = []; const hooks = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiters.has(d.id)) { waiters.get(d.id)(d); waiters.delete(d.id); } else { events.push(d); hooks.forEach((h) => h(d)); } };
  ws.onopen = () => resolve({ events, on: (h) => hooks.push(h), call: (method, params = {}) => new Promise((res) => { const my = ++id; waiters.set(my, res); ws.send(JSON.stringify({ id: my, method, params })); }), close: () => ws.close() });
});

try {
  let ver;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(250); } }
  const browser = await conn(ver.webSocketDebuggerUrl);
  const load = await browser.call('Extensions.loadUnpacked', { path: root.replace(/[\\/]$/, '') });
  const extId = load.result && load.result.id;
  if (!extId) throw new Error('extension did not load: ' + JSON.stringify(load.error));
  await sleep(2500);

  const open = async (url, w, h, intercept) => {
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const c = await conn(t.webSocketDebuggerUrl); c.targetId = t.id;
    await c.call('Runtime.enable'); await c.call('Page.enable');
    await c.call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    if (intercept) {
      await c.call('Fetch.enable', { patterns: [{ urlPattern: 'https://poe.com/*' }] });
      c.on((d) => {
        if (d.method !== 'Fetch.requestPaused') return;
        const u = new URL(d.params.request.url);
        const isDoc = d.params.resourceType === 'Document';
        c.call('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: isDoc ? 200 : 204, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(isDoc ? mock(u.searchParams) : '').toString('base64') });
      });
    }
    await c.call('Page.navigate', { url });
    return c;
  };
  const ev = async (c, expression) => { const r = await c.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'ERR ' + String(r.result.exceptionDetails.text) : r.result.result.value; };
  const shot = async (c, name) => { const r = await c.call('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); console.log('wrote', name + '.png'); };

  // settings page, also used to set storage for the page shots
  const opts = await open(`chrome-extension://${extId}/src/options/options.html#weather`, 1280, 800);
  await sleep(1500);
  const place = { name: 'London, United Kingdom', lat: 51.51, lon: -0.13 };
  const setSettings = (force, extra = {}) => ev(opts, `chrome.storage.local.set({ settings: ${JSON.stringify({ weather: true, weatherPlace: place, weatherStrength: 1, meterStyle: 'bar-bottom', weatherForce: force, ...extra })} })`);
  const seed = (n) => ev(opts, `chrome.storage.local.set({ 'events.poe': Array.from({ length: ${n} }, (_, i) => ({ t: Date.now() - (i + 1) * 60000, m: 'chat' })) })`);
  await setSettings(null);
  await ev(opts, `chrome.runtime.sendMessage({ type: 'headroom:weatherNow' })`);
  await sleep(1500);
  await ev(opts, `location.reload()`); await sleep(2500);

  // the golden hour at the chosen place: shortly before the real sunset the stored forecast gives
  const sunset = await ev(opts, "chrome.storage.local.get('weather.data').then((r) => r['weather.data'] ? r['weather.data'].set : null)");
  const GOLD = typeof sunset === 'number' ? Math.round((sunset - 0.2) * 100) / 100 : 17.5;
  console.log('sunset at', sunset, '-> golden hour', GOLD);
  const look = async (name, { force, dark, n, panel, hover }) => {
    await setSettings(force); await seed(n);
    const page = await open(`${HOST}?dark=${dark ? 1 : 0}`, 1280, 800, true);
    await sleep(7000);
    const where = await ev(page, "(() => { const h = document.querySelector('[data-headroom=\"\"]'); const b = h && h.shadowRoot && h.shadowRoot.querySelector('.bar, .pill, [role=button]'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()");
    if (hover && where) { const { x, y } = JSON.parse(where); await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 200, y: y - 30 }); await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 200, y }); await sleep(1200); }
    if (panel) {
      const pt = await ev(page, `(() => { const h = document.querySelector('[data-headroom=""]'); const b = h && h.shadowRoot && h.shadowRoot.querySelector('.bar, .pill, [role=button]'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
      if (pt) { const { x, y } = JSON.parse(pt); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(1200); }
      else console.log('no bar found for the panel shot');
    }
    // a neutral name in the panel and tooltip: no brand on screen
    await ev(page, "(() => { const h = document.querySelector('[data-headroom=\"\"]'); if (!h || !h.shadowRoot) return; const w = document.createTreeWalker(h.shadowRoot, 4); for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeValue = n.nodeValue.replace(/Poe/g, 'Example AI'); })()");
    await sleep(300);
    await shot(page, name);
    await fetch(`http://127.0.0.1:${port}/json/close/${page.targetId || ''}`).catch(() => {});
    page.close();
  };

  await look('1-clear-day', { force: { weather: 'clear', season: 'summer', tod: 13.5 }, n: 52, hover: true });
  await look('2-rain-80-percent', { force: { weather: 'rain', season: 'monsoon', tod: 15 }, n: 128, hover: true });
  await look('3-sunset-details', { force: { weather: 'clear', season: 'autumn', tod: GOLD }, n: 70, panel: true });
  await look('4-night-stars', { force: { weather: 'clear', season: 'summer', tod: 23 }, dark: true, n: 40 });

  await setSettings(null);
  await ev(opts, `location.hash = 'weather'; location.reload()`); await sleep(2500);
  await shot(opts, '5-settings-weather');

  // promo tile and marquee: the logo and name over a sunset sky
  for (const [name, w, h, kind] of [['promo-tile-440x280', 440, 280, 'tile'], ['marquee-1400x560', 1400, 560, 'marquee']]) {
    await setSettings({ weather: 'clear', season: 'autumn', tod: GOLD }); await seed(0);
    const page = await open(`${HOST}?promo=${kind}`, w, h, true);
    await sleep(7000);
    await shot(page, name); page.close();
  }
} catch (e) { console.error('ERROR', e); process.exitCode = 1; } finally { chrome.kill(); }
