// End-to-end harness: loads an unpacked copy of the extension into Chromium, serves a mock claude.ai
// (layout rebuilt from the user's screenshots) and mock usage API, and checks what the extension did to the page.
// Usage: node e2e.mjs <extDir> [--scheme=dark|light] [--bg=<css colour>] [--shots=<dir>] [--json]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(3).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const EXT = path.resolve(process.argv[2]);
const scheme = args.scheme || 'dark'; // the user's OS is in dark mode while claude.ai is light (dark bar in the screenshot)
const PAGE_BG = args.bg || 'oklch(0.985 0.004 286)';
const shots = args.shots || null;
const msgs = Array.from({ length: Number(args.msgs || 40) }, (_, i) => `<div class="msg">Message ${i + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit.</div>`).join('');
// --fixture=islands: a different mock page (fixtures/islands.html) for the island / halo scenarios (--bigislands, --chatswitch, ...)
const fixture = args.fixture || null;
const html = fs.readFileSync(new URL(`./fixtures/${fixture || 'claude'}.html`, import.meta.url), 'utf8').replace('PAGE_BG', PAGE_BG)
  // --plate=other: the square plate behind the input is a DIFFERENT colour from the page (translucent white) and shorter than the rounded input
  .replace('PLATE_BG', args.plate === 'other' ? 'rgba(255,255,255,.8)' : 'var(--bg-100)')
  .replace('PLATE_CSS', args.plate === 'other' ? '.plate{padding:0 12px}.input{margin:-8px 0;position:relative}' : '').replace('MSGS', msgs);
const CHAT = '11111111-2222-3333-4444-555555555555';
const resetIn = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const counters = { usage: 0, conv: 0, orgs: 0 };

const user = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-'));
const ctx = await chromium.launchPersistentContext(user, {
  headless: true, channel: 'chromium',
  colorScheme: scheme,
  viewport: { width: 1600, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const out = { ext: EXT, scheme, errors: [], console: [] };
try {
  await ctx.route('https://claude.ai/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/organizations') { counters.orgs++; return route.fulfill({ json: [{ uuid: 'org1', capabilities: ['chat'] }] }); }
    if (u.pathname === '/api/organizations/org1/usage') { counters.usage++; return route.fulfill({ json: { five_hour: { utilization: 42, resets_at: resetIn(2) }, seven_day: { utilization: 12, resets_at: resetIn(70) }, seven_day_opus: { utilization: 0, resets_at: null } } }); }
    if (u.pathname.startsWith('/api/organizations/org1/chat_conversations/')) { counters.conv++; return route.fulfill({ json: { chat_messages: [{ uuid: 'a', index: 0, content: [{ type: 'text', text: 'hello '.repeat(200) }], created_at: new Date().toISOString() }] } }); }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '{}' });
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: { utc_offset_seconds: 19800, current: { temperature_2m: 24, weather_code: 63, cloud_cover: 90, wind_speed_10m: 12, wind_direction_10m: 250, is_day: 1, precipitation: 1 }, daily: { sunrise: ['2026-11-26T06:50'], sunset: ['2026-11-26T17:55'] } } }));

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  await sw.evaluate(async (opts) => {
    await chrome.storage.local.set({ settings: { weatherPlace: { name: 'Ahmedabad', lat: 23.02, lon: 72.57 }, weatherForce: { weather: 'rain', tod: 12 }, meterStyle: 'bar-top', debug: true, ...(opts || {}) } });
  }, args.settings ? JSON.parse(args.settings) : null);

  const page = await ctx.newPage();
  page.on('pageerror', (e) => out.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') out.console.push(m.text().slice(0, 300)); });
  await page.goto(`https://claude.ai/chat/${CHAT}`);
  await page.waitForTimeout(Number(args.wait || 5000));
  // scroll the conversation (in-flow content crossing the header / composer must not get cleared or flicker)
  await page.evaluate(() => { const s = document.getElementById('scroller'); s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(2000);

  if (!fixture) Object.assign(out, await page.evaluate(() => {
    const alpha = (el) => { const c = getComputedStyle(el).backgroundColor; const m = c.match(/[\d.]+(?=\)$)/); return /rgba|\/|color\(/.test(c) ? (m ? +m[0] : 1) : (c === 'transparent' ? 0 : 1); };
    const ids = ['hdr', 'cOuter', 'cInner', 'plate', 'input', 'toolcard', 'dlg'];
    const bg = Object.fromEntries(ids.map((id) => [id, { css: getComputedStyle(document.getElementById(id)).backgroundColor, alpha: alpha(document.getElementById(id)), marked: document.getElementById(id).hasAttribute('data-hr-sky') }]));
    const canvas = document.querySelector('canvas[data-headroom=weather]');
    const host = document.querySelector('[data-headroom]:not(canvas):not(style)');
    const sr = host && host.shadowRoot;
    const trk = sr && sr.querySelector('.trk');
    const wrap = sr && sr.querySelector('.wrap');
    return {
      bg,
      sky: !!canvas, skyOpacity: canvas && canvas.style.opacity,
      fluid: !!document.querySelector('canvas[data-headroom=fluid]'), ink: document.documentElement.getAttribute('data-hr-ink'),
      widget: !!host,
      trackColour: trk && getComputedStyle(trk).backgroundColor,
      wrapClass: wrap && wrap.className,
      label: sr && sr.querySelector('.pill') && sr.querySelector('.pill').getAttribute('aria-label'),
      marked: document.querySelectorAll('[data-hr-sky]').length,
    };
  }));
  // click the bar, the panel opens; then take screenshots
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'page.png') });
    await page.mouse.click(400, 2);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, 'panel.png') });
  }
  out.counters = { ...counters };
  // (a) settings churn: three Sky-strength changes from Settings must not make the tab re-fetch usage / the chat
  const before = { ...counters };
  for (const v of [0.9, 0.8, 0.7]) {
    await sw.evaluate(async (v) => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, weatherStrength: v } }); }, v);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);
  out.churn = { usage: counters.usage - before.usage, conv: counters.conv - before.conv };
  // (b) a site that wraps fetch after load (Sentry/Datadog style): one send must be seen once, not twice
  await page.evaluate(() => { const f = window.fetch; window.fetch = function (...a) { return f.apply(this, a); }; });
  await page.waitForTimeout(2600); // inject.js re-wraps every 2 s
  await page.evaluate(() => fetch('/api/organizations/org1/chat_conversations/x/completion', { method: 'POST', body: JSON.stringify({ prompt: 'hi', model: 'claude-x' }) }).catch(() => {}));
  await page.waitForTimeout(1500);
  out.sendsLoggedPlaceholder = 0;
  out.sendsLogged = await sw.evaluate(async () => ((await chrome.storage.local.get('debug.log'))['debug.log'] || []).filter((e) => e.kind === 'request' && /\/completion/.test(e.url)).length);
  // (g) cost of the background scan on this page: script time over 6 s of steady state
  if (args.perf) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    await page.waitForTimeout(6000);
    const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    if (args.profile) {
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
      await page.waitForTimeout(6000);
      const { profile } = await cdp.send('Profiler.stop');
      const self = {}; const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber; self[k] = (self[k] || 0) + (dt[i] || 0) / 1000; });
      out.profile = Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => k + ' ' + v.toFixed(1) + 'ms');
    }
    out.perf = { scriptMsPerSec: +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / 6).toFixed(1), layoutMsPerSec: +(((m1.LayoutDuration - m0.LayoutDuration) * 1000) / 6).toFixed(1), recalcStyleMsPerSec: +(((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) / 6).toFixed(1) };
  }
  // (h) switching the weather off hands the page back exactly as it was
  if (args.off) {
    await sw.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, weather: false } }); });
    await page.waitForTimeout(1500);
    out.beforeOff = await page.evaluate(() => ({ ink: document.documentElement.getAttribute('data-hr-ink'), islands: document.querySelectorAll('[data-hr-island]').length, inlineColours: [...document.querySelectorAll('body [style*="color"]')].length }));
    out.off = await page.evaluate(() => ({ canvas: !!document.querySelector('canvas[data-headroom]'), marks: document.querySelectorAll('[data-hr-sky],[data-hr-halo],[data-hr-halo-p],[data-hr-halo-o],[data-hr-island],[data-hr-frost]').length, rootStyle: document.documentElement.getAttribute('style') || '', rootAttrs: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('data-hr')), inlineColours: [...document.querySelectorAll('body [style*="color"]')].length, sheet: !!document.querySelector('style[data-headroom=weather]'), hdr: getComputedStyle(document.getElementById('hdr')).backgroundColor }));
  }
  // (i) the fetch hook keeps fetch's own behaviour: Request objects, errors, `this`
  if (args.fetchsem) {
    out.fetchsem = await page.evaluate(async () => {
      const r1 = await fetch(new Request('/api/x', { method: 'POST', body: 'abc' })).then((r) => r.status);
      const r2 = await fetch('bad://nope').then(() => 'resolved', (e) => e.name);
      const r3 = await window.fetch.call(window, '/api/organizations').then((r) => r.status);
      const nested = await (async () => { const f = window.fetch; window.fetch = function (...a) { return f.apply(this, a); }; const s = await fetch('/api/organizations').then((r) => r.status); window.fetch = f; return s; })();
      return { r1, r2, r3, nested };
    });
  }
  // (j) canvas resolution changes over 12 s (the quality governor must settle, not oscillate)
  if (args.quality) {
    out.quality = await page.evaluate(() => new Promise((res) => {
      const c = document.querySelector('canvas[data-headroom]'); const seen = [c.width]; const t = setInterval(() => { if (c.width !== seen[seen.length - 1]) seen.push(c.width); }, 100);
      setTimeout(() => { clearInterval(t); res(seen); }, 12000);
    }));
  }
  // (k) R1 frosted strips: off by default; on, only the cleared edge strips blur what is behind them, and a strip that
  // holds a menu/dialog is left alone (backdrop-filter would re-anchor its position:fixed children).
  // The mock header has a blur of its own, so for it the frost attribute is what is checked.
  if (!fixture) {
    const IDS = ['hdr', 'cOuter', 'cInner', 'plate', 'input', 'toolcard', 'dlg'];
    const snap = () => page.evaluate((ids) => Object.fromEntries(ids.map((id) => { const el = document.getElementById(id); const bf = getComputedStyle(el).backdropFilter; return [id, id === 'hdr' ? el.hasAttribute('data-hr-frost') && document.documentElement.hasAttribute('data-hr-frost-on') : /blur/.test(bf)]; })), IDS);
    out.frostDefault = await snap();
    if (args.frost) {
      const set = async (v) => { await sw.evaluate(async (v) => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, frostedStrips: v } }); }, v); await page.waitForTimeout(3500); };
      await set(true);
      out.frostOn = await snap();
      await page.evaluate(() => { const m = document.createElement('div'); m.id = 'tmpmenu'; m.setAttribute('role', 'menu'); document.getElementById('cOuter').appendChild(m); });
      out.frostWithMenu = await snap();
      await page.evaluate(() => document.getElementById('tmpmenu').remove());
      out.frostMenuGone = await snap();
      await set(false);
      out.frostOff = await snap();
    }
  }
  // (l) the fluid background: it really draws (bright pixels on screen after a few seconds), reacts to the cursor, and switching the
  // style or the weather off takes the right canvas away and leaves nothing behind
  if (args.fluidpixels) {
    const lab = await ctx.newPage();
    await lab.goto('about:blank');
    const bright = async () => {
      const b64 = (await page.screenshot({ clip: { x: 10, y: 70, width: 190, height: 640 } })).toString('base64');
      return lab.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
        const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        let n = 0, max = 0, sum = 0;
        for (let i = 0; i < d.length; i += 4) { const m = Math.max(d[i], d[i + 1], d[i + 2]); if (m > 60) n++; sum += m; if (m > max) max = m; }
        return { brightShare: +(n / (d.length / 4)).toFixed(4), mean: +(sum / (d.length / 4)).toFixed(1), max };
      }, b64);
    };
    // Cursor-driven: the few splats it starts with fade, and after that only the cursor moves it. So the strip on the left of
    // the page (no page content there) is nearly black when idle, and a sweep of the cursor down that strip lights it up.
    await page.waitForTimeout(9000);
    out.fluidIdle = await bright();
    await page.mouse.move(40, 120);
    for (let k = 0; k < 4; k++) for (let i = 0; i < 24; i++) await page.mouse.move(40 + (i % 2) * 120, 120 + k * 130 + i * 5);
    await page.waitForTimeout(400);
    out.fluidSwept = await bright();
  }
  if (args.styleswitch) {
    const set = async (patch) => { await sw.evaluate(async (patch) => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, ...patch } }); }, patch); await page.waitForTimeout(3500); };
    const look = () => page.evaluate(() => ({ fluid: !!document.querySelector('canvas[data-headroom=fluid]'), sky: !!document.querySelector('canvas[data-headroom=weather]'), marks: document.querySelectorAll('[data-hr-sky],[data-hr-halo],[data-hr-halo-p],[data-hr-halo-o],[data-hr-island],[data-hr-frost]').length, rootAttrs: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('data-hr')) }));
    out.switch = {};
    out.switch.start = await look();
    await set({ weatherStyle: 'sky' });
    out.switch.toSky = await look();
    await set({ weatherStyle: 'fluid' });
    out.switch.backToFluid = await look();
    await set({ weather: false });
    out.switch.off = await look();
  }
  // (m) 2.0 island / halo scenarios, on fixtures/islands.html (--fixture=islands), light page, clear night (white ink).
  // The extension's own state (its pin table, queue, counters) lives in the content script's isolated world: read it over CDP.
  if (fixture === 'islands') {
    const cdp = await ctx.newCDPSession(page);
    const worlds = [];
    cdp.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
    await cdp.send('Runtime.enable');
    const stats = async () => {
      for (const w of worlds) {
        try {
          const r = await cdp.send('Runtime.evaluate', { contextId: w.id, returnByValue: true, expression: 'JSON.stringify(globalThis.Headroom && Headroom.WeatherSky && Headroom.WeatherSky.stats && Headroom.WeatherSky.stats())' });
          if (r.result && typeof r.result.value === 'string' && r.result.value !== 'null' && r.result.value !== 'undefined') return JSON.parse(r.result.value);
        } catch {}
      }
      return null;
    };
    const INK_LIGHT = 'rgb(254, 254, 253)';
    out.islandsFixture = { inkStart: await page.evaluate(() => document.documentElement.getAttribute('data-hr-ink')), statsAvailable: !!(await stats()) };
    // (m1) several thousand painted islands added in one frame: none may keep the forced (white) text colour
    if (args.bigislands) {
      const n = Number(args.bigislands) > 1 ? Number(args.bigislands) : 8000;
      await page.evaluate((n) => window.addCards(n), n);
      const look = () => page.evaluate((INK) => { const c = [...document.querySelectorAll('#col .card')]; return { total: c.length, forced: c.filter((e) => getComputedStyle(e).color === INK).length, marked: c.filter((e) => e.hasAttribute('data-hr-island')).length }; }, INK_LIGHT);
      let r = await look();
      const t0 = Date.now();
      while ((r.forced || r.marked < r.total) && Date.now() - t0 < 30000) { await page.waitForTimeout(500); r = await look(); }
      out.bigislands = { ...r, settledMs: Date.now() - t0, stats: await stats() };
    }
    // (m2) chat switches: the whole conversation replaced twice; pinned colours and island marks must not pile up, and the
    // extension must not keep the removed elements
    if (args.chatswitch) {
      const rounds = [];
      for (let i = 0; i < 3; i++) {
        await page.evaluate((n) => window.switchChat(n), 600);
        await page.waitForTimeout(1500);
        for (let k = 0, st = await stats(); k < 40 && st && st.queued; k++) { await page.waitForTimeout(500); st = await stats(); } // until the island queue is empty
        await page.waitForTimeout(1000);
        const dom = await page.evaluate(() => ({ islands: document.querySelectorAll('[data-hr-island]').length, inline: document.querySelectorAll('[style*="color"]').length }));
        rounds.push({ ...dom, stats: await stats() });
      }
      out.chatswitch = rounds;
    }
    // (m3) an island pinned to its colour that turns into a page backdrop must lose its pin
    if (args.stalepin) {
      const before = await page.evaluate(() => { const m = document.getElementById('morph'); return { pinnedInline: m.style.getPropertyValue('color'), island: m.hasAttribute('data-hr-island') }; });
      await page.evaluate(() => { document.getElementById('morph').className = 'backdrop'; });
      await page.waitForTimeout(6500);
      const after = await page.evaluate(() => { const m = document.getElementById('morph'); return { inlineColour: m.style.getPropertyValue('color'), island: m.hasAttribute('data-hr-island'), sky: m.hasAttribute('data-hr-sky') }; });
      out.stalepin = { before, after, stats: await stats() };
    }
    // (m4) the halo pass leaves conversation content alone (also when it scrolls behind the composer), but still clears a real plate
    if (args.haloscope) {
      await page.evaluate(() => window.addProbes());
      await page.evaluate(() => { const e = document.getElementById('edit'); e.focus(); });
      await page.waitForTimeout(4500);
      await page.evaluate(() => { document.getElementById('scroller').scrollTop = 1e6; });
      await page.waitForTimeout(2500);
      out.haloscope = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-probe]')].map((e) => [e.getAttribute('data-probe'), e.hasAttribute('data-hr-halo')])));
      out.haloscopePlate = await page.evaluate(() => ({ plate: document.getElementById('plate').hasAttribute('data-hr-halo'), composer: document.getElementById('composer').hasAttribute('data-hr-halo'), plateAlpha: getComputedStyle(document.getElementById('plate')).backgroundColor }));
    }
    // (m5) a burst of unrelated <head> / <body> changes must not make the extension re-read the page's theme over and over
    if (args.readthrottle) {
      const s0 = await stats();
      for (let i = 0; i < 12; i++) {
        await page.evaluate((i) => { document.head.appendChild(document.createElement('meta')); document.body.setAttribute('aria-busy', String(i % 2)); }, i);
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(1200);
      const s1 = await stats();
      await page.evaluate(() => document.documentElement.classList.add('dark')); // a real theme change still gets read
      await page.waitForTimeout(2800);
      const s2 = await stats();
      out.readthrottle = { noise: s0 && s1 ? s1.readRuns - s0.readRuns : null, themeChange: s1 && s2 ? s2.readRuns - s1.readRuns : null };
    }
  }
  // (c) stability: in a steady page nothing is marked / unmarked over and over
  out.markFlips = await page.evaluate(() => new Promise((res) => {
    let n = 0; const mo = new MutationObserver((r) => { n += r.filter((x) => x.attributeName === 'data-hr-sky').length; });
    mo.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-hr-sky'] });
    setTimeout(() => { mo.disconnect(); res(n); }, 4500);
  }));
  // (d) theme toggle: the page goes dark; strips must be judged again against the new colour and the meter must follow
  if (args.toggle) {
    await page.evaluate(() => { document.documentElement.style.setProperty('--bg-100', '#1f1e1d'); document.documentElement.style.setProperty('--text', '#eee'); document.documentElement.classList.add('dark'); });
    await page.waitForTimeout(4500);
    out.afterToggle = await page.evaluate(() => {
      const host = document.querySelector('[data-headroom]:not(canvas):not(style)');
      const res = {};
      for (const id of ['hdr', 'cOuter', 'cInner', 'plate', 'dlg']) res[id] = getComputedStyle(document.getElementById(id)).backgroundColor;
      res.wrapClass = host.shadowRoot.querySelector('.wrap').className;
      res.rootBg = getComputedStyle(document.documentElement).backgroundColor;
      return res;
    });
  }
  // (n) a theme that changes only through <head> (a <style> added: no attribute on <html>/<body> changes) must still be noticed: the
  // strips are judged again against the new colour and the meter follows. (1.4.7 saw any <head> change; the 2.0 read gate must too.)
  if (args.headtheme) {
    await page.evaluate(() => { const s = document.createElement('style'); s.textContent = ':root{--bg-100:#1f1e1d;--text:#eee}'; document.head.appendChild(s); });
    await page.waitForTimeout(5000);
    out.afterHeadTheme = await page.evaluate(() => {
      const host = document.querySelector('[data-headroom]:not(canvas):not(style)');
      const res = {};
      for (const id of ['hdr', 'cOuter', 'cInner', 'plate']) res[id] = getComputedStyle(document.getElementById(id)).backgroundColor;
      res.wrapClass = host.shadowRoot.querySelector('.wrap').className;
      return res;
    });
  }
  // (e) drag the bar from the top edge to the left edge: it must stay there and the choice must be saved
  if (args.drag) {
    await page.mouse.move(800, 2); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(800 - i * 79, 2 + i * 40);
    await page.mouse.up();
    // a usage report arriving right after the drop (the old settings are still in the tab) must not snap it back
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(1500);
    out.drag = {
      stored: await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.meterStyle),
      shown: await page.evaluate(() => document.querySelector('[data-headroom]:not(canvas):not(style)').shadowRoot.querySelector('.wrap').className),
    };
  }
  // (f) the Settings page left open while the bar is dragged elsewhere must not write the old position back
  if (args.options) {
    const id = new URL(sw.url()).host;
    const op = await ctx.newPage();
    op.on('pageerror', (e) => out.errors.push('options: ' + e));
    await op.goto(`chrome-extension://${id}/src/options/options.html#alerts`);
    await op.waitForTimeout(800);
    await sw.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, meterStyle: 'bar-right' } }); });
    await op.waitForTimeout(500);
    await op.click('input[data-k="notify"]', { force: true });
    await op.waitForTimeout(1200);
    out.optionsStale = await sw.evaluate(async () => { const s = (await chrome.storage.local.get('settings')).settings; return { meterStyle: s.meterStyle, notify: s.notify }; });
    for (const pg of ['weather', 'meter', 'limits', 'alerts', 'sites', 'data', 'help']) { await op.goto(`chrome-extension://${id}/src/options/options.html#${pg}`); await op.waitForTimeout(250); }
    await op.close();
  }
} catch (e) {
  out.errors.push('HARNESS: ' + (e.stack || e));
} finally {
  await ctx.close();
}
console.log(JSON.stringify(out, null, args.json ? 0 : 2));
