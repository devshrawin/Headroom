const { chromium } = require('playwright');
const fs = require('fs');
const stub = fs.readFileSync(__dirname + '/stub.js', 'utf8');
const OPT = 'file:///home/claude/work/src/options/options.html';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(stub);
  await p.goto(OPT + '#weather'); await p.waitForTimeout(300);
  const st = async () => p.evaluate(async () => (await chrome.storage.local.get('settings')).settings || {});
  await p.click('.bgopt:has(input[value=fluid])'); await p.waitForTimeout(500);
  console.log('after fluid click: data-bg=', await p.getAttribute('.wx', 'data-bg'), 'stored=', (await st()).weatherBackground,
    'skyOnlyVisible=', await p.evaluate(() => [...document.querySelectorAll('[data-sky-only]')].filter((e) => e.offsetParent).length),
    'fluidNoteVisible=', await p.evaluate(() => !!document.querySelector('[data-fluid-only]').offsetParent),
    'navStatus=', await p.textContent('.nav a[aria-current] .nav-s'));
  await p.focus('input[value=fluid]'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(500);
  console.log('after ArrowLeft: data-bg=', await p.getAttribute('.wx', 'data-bg'), 'stored=', (await st()).weatherBackground, 'focus=', await p.evaluate(() => document.activeElement.value));
  // range input
  await p.$eval('input[data-k=weatherStrength]', (e) => { e.value = 60; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(500); console.log('strength', (await st()).weatherStrength, await p.textContent('#strv'));
  // units seg
  await p.click('.seg label:has(input[value=f])'); await p.waitForTimeout(500); console.log('units', (await st()).weatherUnits);
  // nav click
  await p.click('.nav a[href="#limits"]'); await p.waitForTimeout(300); console.log('hash', await p.evaluate(() => location.hash), 'provs', await p.$$eval('#quotas .prov', (x) => x.length));
  const n0 = await p.$$eval('#quotas .prov:first-child tr[data-id]', (x) => x.length);
  await p.click('#quotas .prov:first-child [data-add-rule]'); await p.waitForTimeout(500);
  const n1 = await p.$$eval('#quotas .prov:first-child tr[data-id]', (x) => x.length);
  const s1 = await st(); console.log('add rule', n0, '->', n1, 'stored rules', s1.quotas[Object.keys(s1.quotas).find((k) => k === 'chatgpt') || Object.keys(s1.quotas)[0]].length);
  await p.click('#quotas .prov:first-child tr[data-id]:last-child [data-del-rule]'); await p.waitForTimeout(500);
  console.log('del rule ->', await p.$$eval('#quotas .prov:first-child tr[data-id]', (x) => x.length));
  // search
  await p.click('#nav-q'); await p.keyboard.type('limit'); await p.waitForTimeout(300);
  console.log('search focus kept', await p.evaluate(() => document.activeElement.id), 'value', await p.inputValue('#nav-q'), 'results', await p.$$eval('a[data-result]', (x) => x.length));
  await p.click('a[data-result]'); await p.waitForTimeout(300); console.log('result go', await p.evaluate(() => location.hash));
  // hash routing
  await p.evaluate(() => { location.hash = '#help'; }); await p.waitForTimeout(400); console.log('hashchange ->', await p.textContent('.page-h'), await p.textContent('.nav a[aria-current] .nav-l'));
  await p.click('[data-k=debug]', { force: true }); await p.waitForTimeout(500); console.log('debug', (await st()).debug, await p.textContent('.nav a[aria-current] .nav-s'));
  // meter
  await p.goto(OPT + '#meter'); await p.waitForTimeout(300);
  await p.click('.seg label:has(input[value=bar-left])'); await p.waitForTimeout(500); console.log('meterStyle', (await st()).meterStyle, await p.textContent('.nav a[aria-current] .nav-s'));
  // alerts thresholds
  await p.goto(OPT + '#alerts'); await p.waitForTimeout(300);
  await p.fill('[data-k=thresholds]', '50, 80'); await p.press('[data-k=thresholds]', 'Tab'); await p.waitForTimeout(500); console.log('thresholds', (await st()).thresholds);
  // sites
  await p.goto(OPT + '#sites'); await p.waitForTimeout(300);
  await p.fill('#siteHost', 'chat.example.com'); await p.fill('#siteLimit', '10'); await p.click('[data-act=addSite]'); await p.waitForTimeout(600);
  console.log('sites', JSON.stringify((await st()).customSites), await p.$$eval('[data-rm-site]', (x) => x.length));
  await p.click('[data-rm-site]'); await p.waitForTimeout(600); console.log('after rm', (await st()).customSites.length);
  // data
  await p.goto(OPT + '#data'); await p.waitForTimeout(300); console.log('data acts', await p.$$eval('[data-act]', (x) => x.map((e) => e.dataset.act).join(',')));
  // mobile current pill in view
  await p.setViewportSize({ width: 360, height: 800 }); await p.goto(OPT + '#help'); await p.waitForTimeout(400);
  console.log('mobile help pill visible', await p.evaluate(() => { const a = document.querySelector('.nav a[aria-current]'), l = a.closest('.nav-list'); const r = a.getBoundingClientRect(), lr = l.getBoundingClientRect(); return r.left >= lr.left && r.right <= lr.right; }), 'winScrollY', await p.evaluate(() => scrollY));
  await p.setViewportSize({ width: 1280, height: 560 }); await p.goto(OPT + '#help'); await p.waitForTimeout(400);
  console.log('short help visible', await p.evaluate(() => { const a = document.querySelector('.nav a[aria-current]'), l = a.closest('.nav-list'); const r = a.getBoundingClientRect(), lr = l.getBoundingClientRect(); return [r.top >= lr.top && r.bottom <= lr.bottom, l.scrollHeight, l.clientHeight]; }));
  console.log('errors', errs);
  await b.close();
})();
