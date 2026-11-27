// node tab.js <file> <hash> <scheme> [width] -> tabs through, reports focus indicator per stop; screenshots a few
const { chromium } = require('playwright');
const fs = require('fs');
const stub = fs.readFileSync(__dirname + '/stub.js', 'utf8');
const [file, hash, scheme = 'light', w = '1440', shotsAt = ''] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: +w, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.addInitScript(stub);
  await p.goto('file://' + file + (hash ? '#' + hash : '')); await p.waitForTimeout(300);
  const want = shotsAt.split(',').filter(Boolean).map(Number);
  for (let i = 0; i < 80; i++) {
    await p.keyboard.press('Tab'); await p.waitForTimeout(30);
    const info = await p.evaluate(() => {
      const a = document.activeElement; if (!a || a === document.body) return null;
      const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el); return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ; };
      let ind = vis(a) ? 'self' : '';
      if (!ind) { const sib = a.nextElementSibling; if (vis(sib)) ind = 'sibling'; }
      if (!ind) { const bo = a.closest('.bgopt'); if (bo && vis(bo)) ind = 'bgopt'; }
      const r = a.getBoundingClientRect();
      return `${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}.${a.className || ''} [${(a.getAttribute('aria-label') || a.textContent || a.value || '').trim().slice(0, 28)}] ind=${ind || 'NONE'} y=${Math.round(r.y)}`;
    });
    if (!info) { console.log(i, 'body'); break; }
    console.log(i, info);
    if (want.includes(i)) await p.screenshot({ path: `/home/claude/shots/audit2/focus-${file.includes('welcome') ? 'w' : 'o'}-${hash}-${scheme}-${i}.png` });
  }
  await b.close();
})();
