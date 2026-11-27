// Browser test for the Settings (options) and Welcome pages of the unpacked extension.
// Part 1, a matrix: every Settings page (plus Weather with the Fluid background) and the Welcome page, at widths 360, 768, 1280,
//   1440, 1920 and 2560, in the light and the dark colour scheme: no page error, no console error, no horizontal overflow, and an
//   axe-core scan (wcag2a, wcag2aa, wcag21aa; serious and critical fail, minor and moderate are warnings). axe's colour-contrast
//   rule is the contrast check (4.5:1).
// Part 2, functional checks on Settings: switches, radios, slider, background picker, sidebar summaries, search, thresholds, export
//   and import, restore defaults, clear usage data, quota rules, keyboard and focus ring, and that user-controlled text is escaped.
// Usage: node pages.mjs <extDir> [--json] [--quick]   (--quick: widths 360, 1280 and 2560 only; --functional-only / --matrix-only)
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(here, '..'));
const json = process.argv.includes('--json');
const quick = process.argv.includes('--quick');
const onlyF = process.argv.includes('--functional-only');
const onlyM = process.argv.includes('--matrix-only');
const WIDTHS = quick ? [360, 1280, 2560] : [360, 768, 1280, 1440, 1920, 2560];
const SCHEMES = ['light', 'dark'];
const PAGES = ['weather', 'meter', 'limits', 'alerts', 'sites', 'data', 'help'];
const AXE = path.join(here, 'node_modules', 'axe-core', 'axe.min.js');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

const results = { matrix: { loads: 0, failures: [], warnings: [] }, functional: {}, _errors: [] };
const fail = (where, msg) => results.matrix.failures.push({ where, msg });

const PLACE = { name: 'Kochi, India', lat: 9.93, lon: 76.27 };
const XSS_PLACE = { name: '<img id="xss1" src=x onerror="window.__xss=1">Kochi', lat: 9.93, lon: 76.27 };

const user = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-pages-'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-pages-files-'));
let ctx;
try {
  ctx = await launch();
} catch (e) {
  try { ctx = await launch(); } catch (e2) { console.log(JSON.stringify({ _errors: ['launch: ' + (e2.stack || e2)] })); process.exit(1); }
}
async function launch() {
  return chromium.launchPersistentContext(user, {
    headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light', acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const base = `chrome-extension://${id}/src`;
  await ctx.route(/open-meteo\.com/, (r) => r.fulfill({ status: 503, body: '' }));
  try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `chrome-extension://${id}` }); } catch {}

  const setStore = (obj) => sw.evaluate((o) => chrome.storage.local.set(o), obj);
  const clearStore = () => sw.evaluate(() => chrome.storage.local.clear());
  const getStore = (keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys ?? null);
  const settings = async () => (await getStore('settings')).settings || {};
  const waitFor = async (fn, ms = 3000) => { const t0 = Date.now(); for (;;) { let v; try { v = await fn(); } catch { v = false; } if (v) return v; if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 80)); } };

  const page = await ctx.newPage();
  const errs = []; // page errors and console errors of the page under test
  page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const u = m.location() && m.location().url || '';
    if (/open-meteo/.test(u) || /Failed to load resource/.test(m.text()) && /503/.test(m.text())) return; // the weather service is stubbed to fail
    errs.push('console.error: ' + m.text());
  });
  await page.addInitScript({ path: AXE }); // an init script is not blocked by the extension's script CSP

  const open = async (rel, w = 1280, scheme = 'light') => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('about:blank');
    await page.goto(`${base}/${rel}`, { waitUntil: 'load' });
    await page.waitForSelector(rel.startsWith('options') ? '#main .page-h, #main h1' : 'h1');
    await page.waitForTimeout(120);
  };

  // ---------------- Part 1: the matrix ----------------
  if (!onlyF) {
    await clearStore();
    await setStore({
      settings: { weatherPlace: PLACE, customSites: [{ host: 'chat.example.com', limit: 20, windowHours: 5 }] },
      'debug.log': [{ t: Date.now(), provider: 'claude', kind: 'usage', method: 'GET', status: 200, url: 'https://claude.ai/api/x', body: '{"a":1}' }],
      'weather.error': { error: 'offline', t: Date.now() },
    });
    const targets = [...PAGES.map((p) => ({ name: p, rel: 'options/options.html#' + p })), { name: 'weather(fluid)', rel: 'options/options.html#weather', fluid: true }, { name: 'welcome', rel: 'welcome/welcome.html' }];
    const warnSeen = new Map();
    for (const scheme of SCHEMES) for (const w of WIDTHS) for (const t of targets) {
      const where = `${t.name} @${w} ${scheme}`;
      errs.length = 0;
      const cur = await settings();
      if (!!t.fluid !== (cur.weatherStyle === 'fluid')) await setStore({ settings: { ...cur, weatherPlace: PLACE, customSites: cur.customSites, weatherStyle: t.fluid ? 'fluid' : 'sky' } });
      try {
        await open(t.rel, w, scheme);
        results.matrix.loads++;
        const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
        if (ov.sw > ov.iw + 1) fail(where, `horizontal overflow: scrollWidth ${ov.sw} > ${ov.iw}`);
        const res = await page.evaluate((tags) => axe.run(document, { runOnly: { type: 'tag', values: tags } }), AXE_TAGS);
        results.matrix.axeRulesPassed = res.passes.length; results.matrix.axeNodesChecked = (results.matrix.axeNodesChecked || 0) + res.passes.reduce((a, p) => a + p.nodes.length, 0);
        for (const v of res.violations) {
          const sel = v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join(' | ');
          if (v.impact === 'serious' || v.impact === 'critical') fail(where, `axe ${v.impact} ${v.id} (${v.nodes.length}): ${sel} :: ${(v.nodes[0].any[0] || v.nodes[0].all[0] || v.nodes[0].none[0] || {}).message || v.help}`);
          else { const key = `${v.id}|${t.name}`; if (!warnSeen.has(key)) { warnSeen.set(key, 1); results.matrix.warnings.push(`${v.impact} ${v.id} on ${t.name} (first seen @${w} ${scheme}): ${sel}`); } }
        }
      } catch (e) { fail(where, 'harness: ' + (e.message || e)); }
      for (const e of errs) fail(where, e);
    }
    await setStore({ settings: { ...(await settings()), weatherStyle: 'sky' } });
  }

  // ---------------- Part 2: functional ----------------
  if (!onlyM) {
    const F = results.functional;
    const check = async (name, fn) => {
      errs.length = 0;
      try { await fn(); if (errs.length) F[name] = 'FAIL: ' + errs.join(' // '); else F[name] = 'ok'; } catch (e) { F[name] = 'FAIL: ' + String(e.message || e).split('\n')[0] + (errs.length ? ' // ' + errs.join(' // ') : ''); }
    };
    const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
    const ok = (c, what) => { if (!c) throw new Error(what); };
    const reset = async (extra = {}) => { await clearStore(); await setStore({ settings: { weatherPlace: PLACE, ...extra } }); };
    const optionsAt = async (hash, w = 1280, scheme = 'light') => open('options/options.html#' + hash, w, scheme);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    const navText = (pageId) => page.locator(`#nav a[href="#${pageId}"] .nav-s`).innerText();

    await check('switches toggle and persist', async () => {
      const bySection = { weather: ['weather', 'frostedStrips'], meter: ['widget', 'chatStats'], alerts: ['notify'], help: ['debug'] };
      for (const [sec, keys] of Object.entries(bySection)) {
        await reset();
        await optionsAt(sec);
        for (const k of keys) {
          const loc = page.locator(`input[type=checkbox][data-k="${k}"]`);
          const lab = page.locator(`label.sw:has(input[data-k="${k}"])`);
          const DEF = { weather: true, frostedStrips: false, widget: true, chatStats: true, notify: true, debug: false };
          const before = (await settings())[k] ?? DEF[k];
          await lab.click();
          ok(await waitFor(async () => ((await settings())[k] ?? DEF[k]) === !before), `${k} did not persist after click (was ${before})`);
          eq(await loc.isChecked(), !before, `${k} checkbox state`);
          await lab.click();
          ok(await waitFor(async () => ((await settings())[k] ?? DEF[k]) === before), `${k} did not persist after second click`);
        }
      }
    });
    await check('meterStyle radios + summary + demo', async () => {
      await reset();
      await optionsAt('meter');
      for (const [v, text] of [['bar-bottom', 'Bottom edge'], ['bar-left', 'Left edge'], ['bar-right', 'Right edge'], ['bar-top', 'Top edge']]) {
        await page.locator(`label:has(input[data-k="meterStyle"][value="${v}"])`).click();
        ok(await waitFor(async () => (await settings()).meterStyle === v), `meterStyle ${v} not saved`);
        ok(await waitFor(async () => (await navText('meter')) === text), `Meter summary should say "${text}", says "${await navText('meter')}"`);
      }
      await page.locator('label.sw:has(input[data-k="widget"])').click();
      ok(await waitFor(async () => (await navText('meter')) === 'Off'), 'Meter summary should say Off when the meter is off');
    });
    await check('weatherUnits radios', async () => {
      await reset();
      await optionsAt('weather');
      await page.locator('label:has(input[data-k="weatherUnits"][value="f"])').click();
      ok(await waitFor(async () => (await settings()).weatherUnits === 'f'), 'weatherUnits f not saved');
      await page.locator('label:has(input[data-k="weatherUnits"][value="c"])').click();
      ok(await waitFor(async () => (await settings()).weatherUnits === 'c'), 'weatherUnits c not saved');
    });
    await check('Background picker (fluid/sky) hides + shows cards, summary', async () => {
      await reset();
      await optionsAt('weather');
      const skyCards = page.locator('[data-sky-only]');
      eq(await skyCards.count(), 3, 'sky-only card count');
      for (let i = 0; i < 3; i++) ok(await skyCards.nth(i).isVisible(), 'sky-only card should be visible with Sky');
      ok(!(await page.locator('[data-fluid-only]').isVisible()), 'the Fluid note should be hidden with Sky');
      eq(await navText('weather'), 'Weather sky · Kochi', 'Weather summary (sky)');
      await page.locator('label.bgopt:has(input[value="fluid"])').click();
      ok(await waitFor(async () => (await settings()).weatherStyle === 'fluid'), 'weatherStyle fluid not saved');
      for (let i = 0; i < 3; i++) ok(!(await skyCards.nth(i).isVisible()), 'sky-only card should be hidden with Fluid');
      ok(await page.locator('[data-fluid-only]').isVisible(), 'the Fluid note should show with Fluid');
      ok(await waitFor(async () => (await navText('weather')) === 'Fluid'), `Weather summary should say Fluid, says "${await navText('weather')}"`);
      eq(await page.locator('.wx').getAttribute('data-bg'), 'fluid', 'data-bg');
      await page.reload(); await page.waitForSelector('.wx');
      ok(await page.locator('input[data-k="weatherStyle"][value="fluid"]').isChecked(), 'fluid not checked after reload');
      await page.locator('label.bgopt:has(input[value="sky"])').click();
      ok(await waitFor(async () => (await settings()).weatherStyle === 'sky'), 'weatherStyle sky not saved');
      for (let i = 0; i < 3; i++) ok(await skyCards.nth(i).isVisible(), 'sky-only card should be visible again');
      await page.locator('label.sw:has(input[data-k="weather"])').click();
      ok(await waitFor(async () => (await navText('weather')) === 'Off'), 'Weather summary should say Off');
    });
    await check('slider saves', async () => {
      await reset();
      await optionsAt('weather');
      await page.locator('input[data-k="weatherStrength"]').evaluate((el) => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
      ok(await waitFor(async () => (await settings()).weatherStrength === 0.5), 'weatherStrength 0.5 not saved');
      eq(await page.locator('#strv').innerText(), '50%', '#strv');
      await page.reload(); await page.waitForSelector('#strv');
      eq(await page.locator('#strv').innerText(), '50%', '#strv after reload');
    });
    await check('Try a look selects', async () => {
      await reset();
      await optionsAt('weather');
      await page.selectOption('#f-w', 'rain');
      await page.selectOption('#f-t', '23');
      ok(await waitFor(async () => { const f = (await settings()).weatherForce; return f && f.weather === 'rain' && f.tod === 23; }), 'weatherForce not saved');
      await page.locator('[data-act="live"]').click();
      ok(await waitFor(async () => (await settings()).weatherForce === null), '"Back to live" did not clear weatherForce');
    });
    await check('search finds weather and limit, grouped; nothing; clearing', async () => {
      await reset();
      await optionsAt('meter');
      await page.fill('#nav-q', 'weather');
      await page.waitForSelector('.lrow');
      ok((await page.locator('#main .card-t').count()) >= 1, 'no grouped cards for weather');
      ok((await page.locator('#main .lrow').count()) >= 5, 'too few weather results');
      ok(/Results for/.test(await page.locator('#main h1').innerText()), 'results heading missing');
      ok(!(await page.locator('#nav a[aria-current]').count()), 'no section should be current while searching');
      eq(await page.evaluate(() => document.activeElement && document.activeElement.id), 'nav-q', 'search box keeps focus');
      await page.fill('#nav-q', 'limit');
      await page.waitForFunction(() => /limit/i.test(document.querySelector('#main').innerText));
      ok((await page.locator('#main .card-t').allInnerTexts()).includes('Estimate limits') || (await page.locator('#main .card-t').allInnerTexts()).includes('Limits') || (await page.locator('#main .lrow[data-result="limits"]').count()) > 0, 'limit search should reach the Limits section');
      await page.locator('#main .lrow').first().click();
      ok(await waitFor(async () => !(await page.locator('#main .lrow').count())), 'clicking a result should open the page');
      eq(await page.locator('#nav-q').inputValue(), '', 'search box should clear after a result is opened');
      await page.fill('#nav-q', 'zzzzqq');
      await page.waitForFunction(() => /Nothing matches/.test(document.querySelector('#main').innerText));
      await page.fill('#nav-q', '');
      await page.waitForSelector('#main .page-h');
      ok(!/Results for/.test(await page.locator('#main h1').innerText()), 'clearing the search should show the page again');
    });
    await check('thresholds save, reject junk', async () => {
      await reset();
      await optionsAt('alerts');
      const t = page.locator('input[data-k="thresholds"]');
      await t.fill('50, 80,abc'); await t.press('Tab');
      ok(await waitFor(async () => JSON.stringify((await settings()).thresholds) === '[50,80]'), 'thresholds [50,80] not saved');
      ok(await waitFor(async () => (await navText('alerts')) === 'At 50%, 80%'), `Notifications summary wrong: ${await navText('alerts')}`);
      await t.fill('junk'); await t.press('Tab');
      ok(await waitFor(async () => JSON.stringify((await settings()).thresholds) === '[75,90,100]'), 'junk thresholds should fall back to the defaults');
      eq(await t.inputValue(), '75, 90, 100', 'field after junk');
      await t.fill('150, -3, 0'); await t.press('Tab');
      eq(await t.inputValue(), '75, 90, 100', 'field after out-of-range');
    });
    await check('export, import, bad import', async () => {
      await reset({ meterStyle: 'bar-left', thresholds: [60, 95] });
      await optionsAt('data');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act="export"]').click()]);
      const file = path.join(tmp, 'export.json');
      await dl.saveAs(file);
      const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
      eq([exp.app, exp.settings.meterStyle, exp.settings.weatherPlace], ['headroom', 'bar-left', undefined], 'export content (place must not be exported)');
      ok(/^headroom-settings-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), 'export filename ' + dl.suggestedFilename());
      await page.goto('about:blank');
      await setStore({ settings: { ...(await settings()), meterStyle: 'bar-right', thresholds: [10] } });
      await optionsAt('data');
      dialogs.length = 0;
      await page.setInputFiles('#importFile', file);
      ok(await waitFor(async () => { const s = await settings(); return s.meterStyle === 'bar-left' && JSON.stringify(s.thresholds) === '[60,95]'; }), 'import did not restore the exported settings');
      ok(dialogs.length === 1, 'import should ask for confirmation once');
      eq(Object.entries((await settings()).weatherPlace).sort(), Object.entries(PLACE).sort(), 'import must keep the place');
      // bad files
      const before = JSON.stringify(await settings());
      for (const [n, body] of [['not-json', 'hello {'], ['wrong-app', '{"app":"other","settings":{}}'], ['no-settings', '{"app":"headroom"}']]) {
        const f = path.join(tmp, n + '.json'); fs.writeFileSync(f, body);
        await page.setInputFiles('#importFile', f);
        ok(await waitFor(async () => /not a valid|not an Headroom|too large/.test(await page.locator('#saved').innerText())), `bad file ${n}: no error shown (status: ${await page.locator('#saved').innerText()})`);
        eq(JSON.stringify(await settings()), before, `bad file ${n} changed the settings`);
      }
    });
    await check('restore defaults', async () => {
      await reset({ meterStyle: 'bar-right', notify: false, weatherStyle: 'fluid', thresholds: [20], weatherStrength: 0.4 });
      await optionsAt('data');
      await page.locator('[data-act="defaults"]').click();
      ok(await waitFor(async () => { const s = await settings(); return s.meterStyle === 'bar-top' && s.notify === true && s.weatherStyle === 'sky' && s.weatherStrength === 1 && JSON.stringify(s.thresholds) === '[75,90,100]'; }), 'defaults not restored');
    });
    await check('clear usage data', async () => {
      await reset();
      await setStore({ 'usage.claude': { a: 1 }, 'events.claude': [1], notified: { x: 1 }, 'debug.log': [] });
      await optionsAt('data');
      await page.locator('[data-act="clearData"]').click();
      ok(await waitFor(async () => { const a = await getStore(); return !('usage.claude' in a) && !('events.claude' in a) && !('notified' in a) && a.settings; }), 'usage data not cleared, or settings were lost');
    });
    await check('quota rule add, edit, invalid, delete', async () => {
      await reset();
      await optionsAt('limits');
      const prov = page.locator('#quotas .prov').first();
      const pid = await prov.getAttribute('data-provider');
      const n0 = await prov.locator('tr[data-id]').count();
      await prov.locator('[data-add-rule]').click();
      ok(await waitFor(async () => ((await settings()).quotas[pid] || []).length === n0 + 1), 'added rule not saved');
      eq(await prov.locator('tr[data-id]').count(), n0 + 1, 'rows after add');
      const last = prov.locator('tr[data-id]').last();
      await last.locator('[data-f="label"]').fill('My rule');
      await last.locator('[data-f="limit"]').fill('12');
      ok(await waitFor(async () => ((await settings()).quotas[pid] || []).some((r) => r.label === 'My rule' && r.limit === 12)), 'edited rule not saved');
      ok(await waitFor(async () => /rules?$/.test(await navText('limits'))), 'Limits summary');
      await last.locator('[data-f="pattern"]').fill('(');
      ok(await waitFor(async () => /not a valid pattern/.test(await page.locator('#saved').innerText())), 'invalid regex should show an error');
      ok(!((await settings()).quotas[pid] || []).some((r) => r.pattern === '('), 'invalid pattern was saved');
      await last.locator('[data-f="pattern"]').fill('opus');
      await last.locator('[data-del-rule]').click();
      ok(await waitFor(async () => ((await settings()).quotas[pid] || []).length === n0), 'deleted rule still stored');
      eq(await prov.locator('tr[data-id]').count(), n0, 'rows after delete');
    });
    await check('hash routing', async () => {
      await reset();
      await optionsAt('meter');
      eq(await page.locator('#main h1').innerText(), 'Meter', 'h1 for #meter');
      await page.evaluate(() => { location.hash = '#alerts'; });
      await page.waitForFunction(() => document.querySelector('#main h1').textContent === 'Notifications');
      await page.locator('#nav a[href="#sites"]').click();
      await page.waitForFunction(() => document.querySelector('#main h1').textContent === 'Other AI sites');
      eq(await page.evaluate(() => location.hash), '#sites', 'hash after clicking the sidebar');
      await optionsAt('nonsense');
      eq(await page.locator('#main h1').innerText(), 'Weather', 'unknown hash -> Weather');
    });
    await check('buttons: locate, search city, add site (invalid), copy/clear log', async () => {
      await reset();
      await optionsAt('weather');
      await page.locator('[data-act="locate"]').click();
      await page.waitForTimeout(600);
      await page.fill('#city', '');
      await page.locator('[data-act="search"]').click();
      ok(/Type a city/.test(await page.locator('#wmsg').innerText()), 'empty city message');
      await page.fill('#city', 'Kochi');
      await page.press('#city', 'Enter');
      ok(await waitFor(async () => /Search failed|No city/.test(await page.locator('#wmsg').innerText()), 5000), 'Enter in the city box should search (and say it failed offline)');
      await optionsAt('sites');
      await page.fill('#siteHost', 'not a host');
      await page.locator('[data-act="addSite"]').click();
      ok(/hostname/.test(await page.locator('#smsg').innerText()), 'invalid host message');
      await setStore({ 'debug.log': [{ t: Date.now(), provider: 'claude', kind: 'usage', url: 'https://x' }] });
      await optionsAt('help');
      await page.locator('[data-act="copyLog"]').click();
      await page.waitForTimeout(300);
      await page.locator('[data-act="clearLog"]').click();
      ok(await waitFor(async () => !('debug.log' in (await getStore('debug.log')))), 'log not cleared');
    });
    await check('escaping of user-controlled text', async () => {
      await reset({
        weatherPlace: XSS_PLACE, thresholds: [75],
        customSites: [{ host: 'chat.example.com', limit: 1, windowHours: 1 }],
        quotas: { chatgpt: [{ id: 'r1', label: '<i id="xss2">L</i>"><b id="xss3">', pattern: '<u id="xss4">', limit: 1, windowHours: 1 }] },
      });
      await setStore({ 'debug.log': [{ t: Date.now(), provider: '<s id="xss5">', kind: 'usage', url: '<s id="xss6">', body: '<s id="xss7">' }], 'weather.error': { error: '<s id="xss8">' }, 'weather.data': { t: Date.now() } });
      for (const p of PAGES) {
        await optionsAt(p);
        const bad = await page.evaluate(() => [...document.querySelectorAll('[id^="xss"]')].map((e) => e.id).concat(window.__xss ? ['__xss'] : []));
        eq(bad, [], 'injected markup on ' + p);
      }
      await optionsAt('weather'); await page.fill('#nav-q', '<b id="xss9">'); await page.waitForTimeout(200);
      eq(await page.evaluate(() => !!document.getElementById('xss9')), false, 'search text injected');
    });
    await check('S is never undefined: early events before load', async () => {
      // Fire every kind of event before storage has answered: nothing may throw.
      await reset();
      await page.goto('about:blank');
      await page.addInitScript(() => { if (location.search.includes('slow')) { const g = chrome.storage.local.get.bind(chrome.storage.local); chrome.storage.local.get = (...a) => new Promise((r) => setTimeout(() => g(...a).then(r), 700)); } });
      await page.goto(`${base}/options/options.html?slow#weather`);
      await page.waitForTimeout(100);
      await page.evaluate(() => { document.body.dispatchEvent(new Event('change', { bubbles: true })); document.body.dispatchEvent(new Event('input', { bubbles: true })); const f = document.querySelector('#nav-q'); if (f) { f.value = 'x'; f.dispatchEvent(new Event('input', { bubbles: true })); } });
      await page.waitForTimeout(1400);
    });

    await check('a change made just before the tab closes is still saved', async () => {
      await reset();
      const p2 = await ctx.newPage();
      await p2.goto(`${base}/options/options.html#meter`);
      await p2.waitForSelector('.page-h');
      await p2.evaluate(() => document.querySelector('input[data-k="meterStyle"][value="bar-left"]').click());
      await p2.close({ runBeforeUnload: true });
      ok(await waitFor(async () => (await settings()).meterStyle === 'bar-left', 2000), 'meterStyle was lost when the tab closed within the 300 ms save delay');
    });
    await check('a slow page render never overwrites a newer page', async () => {
      await reset();
      await page.goto('about:blank');
      await page.goto(`${base}/options/options.html#weather`);
      await page.waitForSelector('.page-h');
      await page.evaluate(() => { const g = chrome.storage.local.get.bind(chrome.storage.local); chrome.storage.local.get = (...a) => new Promise((r) => setTimeout(() => g(...a).then(r), 3000)); });
      await page.evaluate(() => document.querySelector('#nav a[href="#meter"]').click());
      await page.evaluate(() => document.querySelector('#nav a[href="#weather"]').click());
      await page.evaluate(() => document.querySelector('#nav a[href="#alerts"]').click());
      await page.waitForTimeout(3600);
      eq([await page.locator('#main h1').innerText(), await page.locator('#nav a[aria-current]').getAttribute('href')], ['Notifications', '#alerts'], 'page shown vs sidebar');
    });

    await check('keyboard: Tab reaches sidebar, switches, radios; focus ring visible; Space/Arrows work', async () => {
      await reset();
      await optionsAt('weather');
      const ring = () => page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cands = [el, el.nextElementSibling, el.nextElementSibling && el.nextElementSibling.nextElementSibling, el.closest('.bgopt'), el.closest('.seg label')];
        const vis = cands.some((c) => { if (!c) return false; const s = getComputedStyle(c); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; });
        const key = el.getAttribute('data-k') || el.id || el.getAttribute('href') || el.tagName;
        return { key, type: el.type || el.tagName, vis, inNav: !!el.closest('#nav'), matches: el.matches(':focus-visible'), val: el.value };
      });
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
      const seen = [], bad = [];
      const want = { nav: false, search: false, sw: false, radio: false };
      for (let i = 0; i < 60 && !(want.nav && want.search && want.sw && want.radio); i++) {
        await page.keyboard.press('Tab');
        const r = await ring();
        if (!r) continue;
        seen.push(r.key);
        if (!r.vis || !r.matches) bad.push(r.key);
        if (r.inNav && r.type === 'A') want.nav = true;
        if (r.key === 'nav-q') want.search = true;
        if (r.key === 'weather' || r.key === 'frostedStrips') want.sw = true;
        if (r.type === 'radio') { want.radio = true; }
      }
      ok(want.nav && want.search && want.sw && want.radio, `Tab did not reach everything: ${JSON.stringify(want)} via ${seen.join(',')}`);
      ok(!bad.length, 'focused element without a visible ring: ' + [...new Set(bad)].join(', '));
      // Space toggles a switch
      await page.locator('input[data-k="frostedStrips"]').focus();
      await page.keyboard.press('Space');
      ok(await waitFor(async () => (await settings()).frostedStrips === true), 'Space did not toggle the switch');
      // Arrow keys move through a radio group and persist
      await optionsAt('meter');
      await page.locator('input[data-k="meterStyle"][value="bar-top"]').focus();
      await page.keyboard.press('ArrowRight');
      ok(await waitFor(async () => (await settings()).meterStyle === 'bar-bottom'), 'ArrowRight did not move the Position radio');
      // Enter on a section link opens it, focus stays on the sidebar
      await page.locator('#nav a[href="#data"]').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#main h1').textContent === 'Backup and data');
      eq(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('href')), '#data', 'focus after Enter on a sidebar link');
      // the page defines no Escape behaviour: pressing it must not throw or clear anything
      await page.keyboard.press('Escape');
    });
    await check('keyboard: Welcome links and focus ring', async () => {
      await open('welcome/welcome.html', 1280, 'dark');
      const bad = [];
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return null; const s = getComputedStyle(el); return { t: (el.textContent || '').trim().slice(0, 30), vis: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 || s.boxShadow !== 'none' }; });
        if (r && !r.vis) bad.push(r.t);
      }
      ok(!bad.length, 'welcome focus ring missing on: ' + bad.join(' | '));
    });
    await check('no timers left after a re-render storm (render count stays bounded)', async () => {
      await reset();
      await optionsAt('weather');
      const n = await page.evaluate(async () => { let c = 0; const mo = new MutationObserver(() => c++); mo.observe(document.querySelector('#main'), { childList: true }); await new Promise((r) => setTimeout(r, 1500)); mo.disconnect(); return c; });
      eq(n, 0, 'idle page keeps re-rendering');
    });
  }
} catch (e) {
  results._errors.push('HARNESS: ' + (e.stack || e));
} finally {
  try { await ctx.close(); } catch {}
  for (const d of [user, tmp]) try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
}
const fnFail = Object.entries(results.functional).filter(([, v]) => v !== 'ok');
results._summary = { loads: results.matrix.loads, matrixFailures: results.matrix.failures.length, matrixWarnings: results.matrix.warnings.length, functionalChecks: Object.keys(results.functional).length, functionalFailures: fnFail.length, errors: results._errors.length };
console.log(JSON.stringify(results, null, json ? 0 : 2));
process.exit(results._errors.length || results.matrix.failures.length || fnFail.length ? 1 : 0);
