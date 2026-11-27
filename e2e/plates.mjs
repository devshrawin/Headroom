// Pixel test for the pale plate / white frame around the message box (Node port of tests/headroom-1.4.6/plates.py: Python is
// not available on the owner's machine). Loads the unpacked extension into Chromium, serves fixtures/plates.html as claude.ai
// with each way of painting a plate or a frame, focuses the message box, types, then scrolls the conversation up (which makes
// the page add its frame). Next to the rounded input the sky must look like the sky just outside it, the container's faint side
// border must not show as a line, and the input, an open menu and a bordered button must keep their own paint. Measured at rest,
// 200 ms after the scroll (no flash) and 2.2 s after it, and for flicker.
// Usage: node plates.mjs <extDir> [variant,variant,...] [--json]
// Variants: bg, focus, pseudo, gradient, ring, outline, radius, fborder, fring, fside; append @far for an ivory page with a
// white plate (far from the page colour, which defeats colour matching).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(here, '..'));
const rest = process.argv.slice(2).filter((a) => !a.startsWith('--')).slice(1);
const json = process.argv.includes('--json');
const ALL = ['bg', 'focus', 'pseudo', 'gradient', 'ring', 'outline', 'radius', 'fborder', 'fring', 'fside', 'bg@far', 'focus@far', 'fborder@far'];
const VARIANTS = rest[0] ? rest[0].split(',') : ALL;
const TEMPLATE = fs.readFileSync(new URL('./fixtures/plates.html', import.meta.url), 'utf8');
const MSGS = Array.from({ length: 60 }, (_, i) => `<div class="msg">Message ${i}: lorem ipsum dolor sit amet, consectetur adipiscing elit.</div>`).join('');
const pageHtml = (v) => {
  const [bg, plate] = v.endsWith('@far') ? ['#efece3', '#ffffff'] : ['rgb(248, 248, 252)', 'rgb(253, 253, 253)'];
  return TEMPLATE.replace('PAGE_BG', bg).replace('PLATE_BG', plate).replace('MSGS', MSGS);
};

const user = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-plates-'));
const ctx = await chromium.launchPersistentContext(user, {
  headless: true, channel: 'chromium', viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = { _errors: [] };
try {
  const current = { html: '' };
  await ctx.route('https://claude.ai/**', (r) => {
    const url = r.request().url();
    if (url.includes('/api/organizations/org1/usage')) return r.fulfill({ json: { five_hour: { utilization: 30, resets_at: null } } });
    if (url.endsWith('/api/organizations')) return r.fulfill({ json: [{ uuid: 'org1', capabilities: ['chat'] }] });
    if (url.includes('/api/')) return r.fulfill({ status: 404, body: '{}' });
    return r.fulfill({ contentType: 'text/html', body: current.html });
  });
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 503, body: '' }));
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  await sw.evaluate(async () => chrome.storage.local.set({ settings: { weatherPlace: { name: 'X', lat: 23.02, lon: 72.57 }, weatherForce: { weather: 'rain', tod: 12 }, meterStyle: 'bar-top' } }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => results._errors.push(String(e)));
  const lab = await ctx.newPage(); // a blank page that reads pixels out of screenshots
  await lab.goto('about:blank');

  // means of RGB over rectangles of a screenshot: [[x0, x1, y0, y1], ...] -> [[r, g, b], ...]
  const means = async (buf, rects) => lab.evaluate(async ({ b64, rects }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    return rects.map(([x0, x1, y0, y1]) => {
      const w = Math.max(1, Math.floor(x1) - Math.floor(x0)), h = Math.max(1, Math.floor(y1) - Math.floor(y0));
      const d = g.getImageData(Math.floor(x0), Math.floor(y0), w, h).data;
      const acc = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { acc[0] += d[i]; acc[1] += d[i + 1]; acc[2] += d[i + 2]; }
      const n = d.length / 4;
      return acc.map((a) => Math.round((a / n) * 10) / 10);
    });
  }, { b64: buf.toString('base64'), rects });
  const delta = (a, b) => Math.round(Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i]))) * 10) / 10;
  const rectJs = () => { const b = (id) => { const x = document.getElementById(id).getBoundingClientRect(); return { l: x.left, t: x.top, r: x.right, b: x.bottom }; };
    return { cw: b('cwrap'), inp: b('input'), menu: b('menu'), btn: b('modelBtn'), vh: innerHeight, sky: !!document.querySelector('canvas[data-headroom]') }; };

  const measure = async (buf, r, frame) => {
    const { cw, inp, menu, btn } = r;
    const out = {};
    if (frame) { // the 30 px frame zone beside the input, at its height and below it, against plain sky 45-70 px out
      const y0 = inp.t + 10, y1 = inp.b - 10, yb0 = inp.b + 8, yb1 = r.vh - 6;
      const [a, b, c, d, e, f] = await means(buf, [[inp.l - 26, inp.l - 6, y0, y1], [inp.l - 70, inp.l - 45, y0, y1], [inp.r + 6, inp.r + 26, y0, y1], [inp.r + 45, inp.r + 70, y0, y1], [inp.l - 26, inp.l - 6, yb0, yb1], [inp.l - 70, inp.l - 45, yb0, yb1]]);
      out.left = delta(a, b); out.right = delta(c, d); out.below = delta(e, f);
    } else { // the plate: the 12 px band between the container's edge and the input, top 48 px of the container
      const y0 = cw.t + 10, y1 = cw.t + 40, ly0 = cw.t + 70, ly1 = cw.t + 105;
      const [a, b, c, d, e, f] = await means(buf, [[cw.l + 3, inp.l - 3, y0, y1], [cw.l - 16, cw.l - 6, y0, y1], [inp.r + 3, cw.r - 3, y0, y1], [cw.r + 6, cw.r + 16, y0, y1], [cw.l, cw.l + 1, ly0, ly1], [cw.l - 8, cw.l - 3, ly0, ly1]]);
      out.left = delta(a, b); out.right = delta(c, d); out.line = delta(e, f);
    }
    const [i, m, bt] = await means(buf, [[inp.l + 300, inp.l + 340, inp.t + 20, inp.b - 20], [menu.l + 120, menu.l + 200, menu.t + 30, menu.b - 10], [btn.l + 4, btn.r - 4, btn.t + 2, btn.t + 4]]);
    out.input = Math.min(...i); out.menu = Math.min(...m); out.button = Math.min(...bt);
    const clean = ['left', 'right', 'below', 'line'].every((k) => out[k] === undefined || out[k] < 8);
    out.ok = clean && out.input >= 250 && out.menu >= 250 && out.button >= 250;
    return out;
  };

  for (const v of VARIANTS) {
    const name = v.split('@')[0];
    const frame = ['fborder', 'fring', 'fside'].includes(name);
    current.html = pageHtml(v);
    await page.goto(`https://claude.ai/new?v=${name}`);
    await page.waitForTimeout(3000);
    await page.click('#edit');
    await page.keyboard.type('s');
    await page.waitForTimeout(2600);
    const res = {};
    for (const stage of ['rest', 'scroll+0.2s', 'scroll+2.2s']) {
      if (stage === 'scroll+0.2s') { await page.evaluate(() => { document.querySelector('.scroller').scrollTop = 0; }); await page.waitForTimeout(200); }
      else if (stage === 'scroll+2.2s') await page.waitForTimeout(2000);
      const r = await page.evaluate(rectJs);
      const m = await measure(await page.screenshot(), r, frame);
      m.sky = r.sky;
      res[stage] = m;
    }
    // steady state: no mark may come and go (that would make the plate flicker every few seconds)
    res.flips = await page.evaluate(() => new Promise((done) => {
      let n = 0;
      const mo = new MutationObserver((rs) => { n += rs.filter((x) => /^data-hr-(sky|halo)/.test(x.attributeName || '')).length; });
      mo.observe(document.body, { attributes: true, subtree: true });
      setTimeout(() => { mo.disconnect(); done(n); }, 6500);
    }));
    res.late = await measure(await page.screenshot(), await page.evaluate(rectJs), frame);
    res.ok = ['rest', 'scroll+0.2s', 'scroll+2.2s'].every((s) => res[s].ok && res[s].sky) && res.late.ok && res.flips === 0;
    results[v] = res;
  }
} catch (e) {
  results._errors.push('HARNESS: ' + (e.stack || e));
} finally {
  await ctx.close();
  try { fs.rmSync(user, { recursive: true, force: true }); } catch {}
}
results._summary = Object.fromEntries(Object.entries(results).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, v.ok]));
console.log(JSON.stringify(results, null, json ? 0 : 2));
process.exit(results._errors.length || !Object.values(results._summary).every(Boolean) ? 1 : 0);
