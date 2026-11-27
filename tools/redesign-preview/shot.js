// usage: node shot.js <html path> <hash> <width> <light|dark> <out.png> [bg] [fullPage=1] [height=900]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [file, hash, w, scheme, out, bg = 'sky', full = '1', h = '900'] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(process.env.DSF || 1), colorScheme: scheme, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(`window.__BG__=${JSON.stringify(bg)};` + fs.readFileSync(__dirname + '/stub.js', 'utf8'));
  await p.goto('file://' + file + (hash ? '#' + hash : ''));
  await p.waitForTimeout(400);
  if (full === '1') { const H = await p.evaluate(() => document.documentElement.scrollHeight); await p.setViewportSize({ width: +w, height: Math.max(+h, H) }); await p.waitForTimeout(150); }
  await p.screenshot({ path: out });
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (errs.length) console.log('ERRORS', errs);
  console.log(out, 'overflowX=', ov);
  await b.close();
})();
