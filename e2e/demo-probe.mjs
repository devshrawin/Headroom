// Quick numbers for the fluid demo page: brightness of the empty left strip idle, during and after a cursor sweep.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror ' + e));
page.on('console', (m) => logs.push(m.type() + ' ' + m.text()));
await page.goto(pathToFileURL(path.resolve(here, '..', 'tools', 'fluid-demo', 'index.html')).href);
const lab = await ctx.newPage(); await lab.goto('about:blank');
const stat = async () => {
  const b64 = (await page.screenshot({ clip: { x: 10, y: 80, width: 230, height: 500 } })).toString('base64');
  return lab.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let sum = 0, max = 0, bright = 0;
    for (let i = 0; i < d.length; i += 4) { const m = Math.max(d[i], d[i + 1], d[i + 2]); sum += m; if (m > max) max = m; if (m > 40) bright++; }
    return { mean: +(sum / (d.length / 4)).toFixed(1), max, share: +(bright / (d.length / 4)).toFixed(3) };
  }, b64);
};
await page.waitForTimeout(1500);
const out = { start: await stat() };
await page.waitForTimeout(8000);
out.idle = await stat();
await page.mouse.move(40, 120);
for (let k = 0; k < 4; k++) for (let i = 0; i < 30; i++) { await page.mouse.move(40 + (i % 2) * 150, 120 + k * 110 + i * 3); await page.waitForTimeout(16); }
out.afterSweep = await stat();
await page.waitForTimeout(1500);
out.sweep1500 = await stat();
await page.waitForTimeout(4000);
out.sweep5500 = await stat();
await page.screenshot({ path: path.resolve(here, '..', '.smoke-frames', 'probe.png') });
out.logs = logs.slice(0, 6);
console.log(JSON.stringify(out));
await browser.close();
