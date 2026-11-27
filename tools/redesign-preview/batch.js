// node batch.js <out-prefix> ; shoots options + welcome at many widths/themes, reports errors + overflow
const { chromium } = require('playwright');
const fs = require('fs');
const OPT = '/home/claude/work/src/options/options.html', WEL = '/home/claude/work/src/welcome/welcome.html';
const stub = fs.readFileSync(__dirname + '/stub.js', 'utf8');
const jobs = JSON.parse(process.argv[2]);
(async () => {
  const b = await chromium.launch();
  for (const j of jobs) {
    const [page, hash, w, scheme, bg = 'sky', full = 1, h = 900, extra = ''] = j;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: 'reduce' });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.addInitScript(`window.__BG__=${JSON.stringify(bg)};` + stub);
    await p.goto('file://' + (page === 'o' ? OPT : WEL) + (hash ? '#' + hash : ''));
    await p.waitForTimeout(300);
    if (extra) { await p.evaluate(extra); await p.waitForTimeout(300); }
    if (full) { const H = await p.evaluate(() => document.documentElement.scrollHeight); await p.setViewportSize({ width: w, height: Math.min(8000, Math.max(h, H)) }); await p.waitForTimeout(150); }
    const out = `/home/claude/shots/audit/${page}-${hash || 'top'}-${w}-${scheme}${bg !== 'sky' ? '-' + bg : ''}${extra ? '-x' : ''}${full ? '' : '-vp'}.png`;
    await p.screenshot({ path: out });
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    // clipped elements: any element whose scrollWidth > clientWidth with overflow hidden (text clipping)
    const clip = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const cs = getComputedStyle(e); return cs.overflowX === 'hidden' && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && !e.closest('[aria-hidden="true"]') && cs.textOverflow !== 'ellipsis'; }).slice(0, 5).map((e) => e.className || e.tagName));
    console.log(out.split('/').pop(), 'ovX=', ov, errs.length ? 'ERR ' + errs.join('|') : '', clip.length ? 'clip:' + clip.join(',') : '');
    await ctx.close();
  }
  await b.close();
})();
