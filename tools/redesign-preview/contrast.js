// node contrast.js -> prints text elements with contrast < 4.5 in both themes for options pages + welcome
const { chromium } = require('playwright');
const fs = require('fs');
const stub = fs.readFileSync(__dirname + '/stub.js', 'utf8');
const OPT = '/home/claude/work/src/options/options.html', WEL = '/home/claude/work/src/welcome/welcome.html';
const targets = [[OPT, 'weather'], [OPT, 'meter'], [OPT, 'limits'], [OPT, 'alerts'], [OPT, 'sites'], [OPT, 'data'], [OPT, 'help'], [OPT, 'weather', 'fluid'], [OPT, 'weather', 'sky', 'we'], [WEL, '']];
const fn = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bgOf = (el) => { const stack = []; let img = false; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none' && !e.matches('body,html')) img = img || cs.backgroundImage.slice(0, 40); const c = parse(cs.backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } } let b = [255, 255, 255, 1]; if (!stack.length || stack[stack.length - 1][3] < 1) { b = matchMedia('(prefers-color-scheme: dark)').matches ? [0, 0, 0, 1] : [255, 255, 255, 1]; } for (let i = stack.length - 1; i >= 0; i--) b = blend(stack[i], b); return [b, img]; };
  const out = []; const seen = new Set();
  const els = [...document.querySelectorAll('body *')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  for (const e of els) {
    if (e.closest('[hidden]') || e.closest('.sr-only')) continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let col = parse(cs.color); let op = 1; for (let x = e; x; x = x.parentElement) op *= Number(getComputedStyle(x).opacity);
    const [bg, img] = bgOf(e); col = blend([col[0], col[1], col[2], col[3] * op], bg);
    const L1 = lum(col), L2 = lum(bg); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const key = (e.className || e.tagName) + '|' + e.textContent.trim().slice(0, 20);
    if (seen.has(key)) continue; seen.add(key);
    if (cr < 4.5 || img) out.push(`${cr.toFixed(2)} ${img ? '[img ' + img + ']' : ''} <${e.tagName.toLowerCase()} class="${e.className}"> "${e.textContent.trim().slice(0, 30)}"`);
  }
  // placeholders
  for (const i of document.querySelectorAll('input[placeholder]')) { const cs = getComputedStyle(i, '::placeholder'); const c = parse(cs.color); const [bg] = bgOf(i); const L1 = lum(blend(c, bg)), L2 = lum(bg); out.push(`placeholder ${((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2)} #${i.id}`); }
  return out;
};
(async () => {
  const b = await chromium.launch();
  for (const scheme of ['light', 'dark']) for (const [file, hash, bg = 'sky', q] of targets) {
    const ctx = await b.newContext({ viewport: { width: +(process.env.W || 1440), height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.addInitScript(`window.__BG__=${JSON.stringify(bg)};` + stub);
    await p.goto('file://' + file + (hash ? '#' + hash : '')); await p.waitForTimeout(300);
    if (q) { await p.fill('#nav-q', q); await p.waitForTimeout(200); }
    const r = await p.evaluate(fn);
    console.log(`== ${scheme} ${file.split('/').pop()}#${hash} ${bg} ${q || ''}`); r.forEach((x) => console.log('  ' + x));
    await ctx.close();
  }
  await b.close();
})();
