// Regression loop: the audit's unit tests, then every end-to-end scenario, each judged against the baseline below.
// Usage: node run-all.mjs [extension dir]   (default: the repo root, one folder up). Node only, no Python.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(here, '..'));
// --only=<scenario name>: run just that end-to-end scenario (no audit unit tests, no pixel suites), for a quick check
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
let failed = 0;
const fail = (m) => { failed++; console.log('  FAIL ' + m); };

// 1. the audit's pure-module unit tests (the repo's own suite runs separately with `npm test` at the root)
if (!only) {
  const r = spawnSync(process.execPath, ['--test', path.join(here, 'audit-unit.test.mjs')], { env: { ...process.env, EXT }, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const pass = +(/ℹ pass (\d+)/.exec(out) || [0, 0])[1], bad = +(/ℹ fail (\d+)/.exec(out) || [0, 0])[1];
  console.log(`audit unit tests: ${pass} pass, ${bad} fail`);
  if (bad || r.status !== 0) fail('audit unit tests');
}

const NIGHT = '--settings={"weatherForce":{"weather":"clear","season":"summer","tod":23}}';
const scenarios = [
  { name: 'light-page-dark-os', args: ['--toggle', '--drag', '--options', '--fetchsem'], tone: 'tone-light', track: [232, 229, 242], sky: true, extra: true },
  { name: 'dark-page-light-os', args: ['--scheme=light', '--bg=#1f1e1d'], tone: 'tone-dark', sky: true },
  { name: 'rgb-page', args: ['--bg=rgb(250, 249, 245)', '--scheme=light'], tone: 'tone-light', track: [232, 229, 242], sky: true },
  { name: 'weather-off', args: ['--settings={"weatherPlace":null}'], tone: 'tone-light', sky: false },
  { name: 'big-chat', args: ['--msgs=4000', '--perf', '--off'], tone: 'tone-light', sky: true },
  { name: 'head-theme', args: ['--headtheme'], tone: 'tone-light', sky: true, headtheme: true },
  { name: 'frosted-strips', args: ['--frost'], tone: 'tone-light', sky: true, frost: true },
  { name: 'fluid', args: ['--fluidpixels', '--styleswitch', '--settings={"weatherStyle":"fluid"}'], tone: 'tone-light', sky: true, fluid: true },
  { name: 'quality-settles', args: ['--quality'], tone: 'tone-light', sky: true, settle: true },
  // 2.0: the island / halo / theme-read scenarios, on their own mock page (fixtures/islands.html): a light page at clear night (white ink)
  { name: 'islands-big', custom: 'big', args: ['--fixture=islands', '--bigislands', '--stalepin', NIGHT] },
  { name: 'islands-chat', custom: 'chat', args: ['--fixture=islands', '--chatswitch', '--haloscope', '--readthrottle', NIGHT] },
];

for (const s of scenarios) {
  if (only && s.name !== only) continue;
  // A browser start-up that dies (a busy machine, a leftover Chromium) is retried once; a real failure fails twice.
  let d;
  for (let attempt = 1; attempt <= 2 && !d; attempt++) {
    const r = spawnSync(process.execPath, [path.join(here, 'e2e.mjs'), EXT, '--json', ...s.args], { encoding: 'utf8', timeout: 240000, maxBuffer: 1 << 26 });
    try { d = JSON.parse(r.stdout); } catch { console.log(`${s.name}: no JSON (attempt ${attempt})\n${(r.stderr || '').slice(0, 400)}`); }
  }
  if (!d) { fail(s.name + ' crashed'); continue; }
  const bad0 = failed;
  const eq = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${s.name}: ${what} = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
  eq('errors', d.errors, []);
  if (s.custom) { // the island / halo scenarios: their own checks (the page, the widget and the plate fixtures above do not apply)
    eq('the white ink is on', (d.islandsFixture || {}).inkStart, 'light');
    eq('the extension reports its state', (d.islandsFixture || {}).statsAvailable, true);
    if (s.custom === 'big') {
      const b = d.bigislands || {}, sp = d.stalepin || {};
      if (!(b.total > 5000)) fail(`${s.name}: only ${b.total} islands were added`);
      eq('islands still forced to the page ink (none may keep it; no island may be skipped)', [b.forced, b.marked === b.total], [0, true]);
      eq('no pinned element has left the page', (b.stats || {}).pinnedDetached, 0);
      eq('the island queue is empty again', (b.stats || {}).queued, 0);
      eq('an island is pinned before it turns into a page backdrop', [!!(sp.before || {}).pinnedInline, (sp.before || {}).island], [true, true]);
      eq('a pinned island that becomes a backdrop is un-pinned (no inline colour left)', [(sp.after || {}).inlineColour, (sp.after || {}).island, (sp.after || {}).sky], ['', false, true]);
    } else {
      const rounds = d.chatswitch || [];
      if (rounds.length !== 3) fail(`${s.name}: chatswitch rounds = ${rounds.length}`);
      for (const [i, r] of rounds.entries()) {
        const st = r.stats || {};
        if (!r.stats || st.pinnedDetached !== 0 || st.queued !== 0 || st.pinned > r.islands + 5 || r.inline > r.islands + 5) fail(`${s.name}: chat switch ${i + 1}: ${JSON.stringify(r)}`);
      }
      if (rounds.length === 3 && rounds[2].stats && rounds[0].stats && rounds[2].stats.pinned > rounds[0].stats.pinned + 5) fail(`${s.name}: pinned colours pile up over chat switches: ${rounds.map((r) => r.stats.pinned)}`);
      const probes = d.haloscope || {};
      const bad = Object.entries(probes).filter(([k, v]) => v !== (k === 'body:empty')).map(([k]) => k);
      if (Object.keys(probes).length !== 12 || bad.length) fail(`${s.name}: the halo pass touched conversation content (or missed a plate): ${bad.join(', ') || 'no probes'}`);
      eq('the composer plate is still cleared', (d.haloscopePlate || {}).plate, true);
      const rt = d.readthrottle || {};
      if (!(rt.noise <= 1)) fail(`${s.name}: ${rt.noise} theme reads for unrelated <head>/<body> noise, want at most 1`);
      if (!(rt.themeChange >= 1)) fail(`${s.name}: a real theme change was not read (${rt.themeChange})`);
    }
    console.log(`${s.name}: ${failed === bad0 ? 'ok' : 'FAILED'}`);
    continue;
  }
  eq('markFlips', d.markFlips, 0);
  eq('churn', d.churn, { usage: 0, conv: 0 });
  eq('sendsLogged', d.sendsLogged, 1);
  if (!String(d.wrapClass).includes(s.tone)) fail(`${s.name}: wrapClass ${d.wrapClass}, want ${s.tone}`);
  if (s.track && d.trackColour !== `rgb(${s.track.join(', ')})`) fail(`${s.name}: track ${d.trackColour}`);
  const a = Object.fromEntries(Object.entries(d.bg || {}).map(([k, v]) => [k, v.alpha]));
  if (s.sky) {
    for (const k of ['hdr', 'cOuter', 'cInner', 'plate']) if (a[k] !== 0) fail(`${s.name}: ${k} alpha ${a[k]}, want 0`);
    for (const k of ['input', 'toolcard', 'dlg']) if (a[k] !== 1) fail(`${s.name}: ${k} alpha ${a[k]}, want 1`);
  } else eq('sky', d.sky, false);
  if (s.extra) {
    eq('fetch semantics', d.fetchsem, { r1: 404, r2: 'TypeError', r3: 200, nested: 200 });
    eq('options stale write keeps the new position', d.optionsStale && d.optionsStale.meterStyle, 'bar-right');
    eq('drag stored', d.drag && d.drag.stored, 'bar-left');
  }
  if (d.frostDefault && Object.entries(d.frostDefault).some(([k, v]) => v && k !== 'hdr')) fail(`${s.name}: something is frosted although the setting is off by default: ${JSON.stringify(d.frostDefault)}`);
  if (s.frost) {
    const on = (o) => Object.entries(o || {}).filter(([, v]) => v).map(([k]) => k).sort().join(',');
    const want = (what, got, keys) => { if (on(got) !== keys.slice().sort().join(',')) fail(`${s.name}: ${what}: frosted = [${on(got)}], want [${keys}]`); };
    want('frost on blurs only the edge strips', d.frostOn, ['hdr', 'cOuter', 'cInner']);
    want('a strip that holds a menu is not frosted', d.frostWithMenu, ['hdr', 'cInner']);
    want('frost returns when the menu closes', d.frostMenuGone, ['hdr', 'cOuter', 'cInner']);
    want('frost off removes every blur', d.frostOff, []);
  }
  if (s.headtheme) { // a theme switched by a <style> added to <head> only: the meter follows and the strips stay cleared
    const h = d.afterHeadTheme || {};
    if (!String(h.wrapClass).includes('tone-dark')) fail(`${s.name}: the meter should follow a head-only theme change: ${h.wrapClass}`);
    for (const k of ['hdr', 'cOuter', 'cInner', 'plate']) if (h[k] !== 'rgba(0, 0, 0, 0)') fail(`${s.name}: ${k} should stay cleared after the theme change: ${h[k]}`);
  }
  if (s.fluid) { // 2.0: the fluid background: it draws, only the cursor moves it, white ink, and style switches / switching off clean up
    eq('the fluid canvas is mounted', d.fluid, true);
    eq('the text is white on the fluid', d.ink, 'light');
    const idle = (d.fluidIdle || {}).max, swept = (d.fluidSwept || {}).max;
    if (!(typeof idle === 'number' && typeof swept === 'number' && swept - idle >= 40)) fail(`${s.name}: a cursor sweep should light up the empty strip (idle max ${idle}, swept max ${swept})`);
    const sw = d.switch || {};
    const look = (what, got, want) => { if (!got || got.fluid !== want.fluid || got.sky !== want.sky || (want.clean && (got.marks !== 0 || got.rootAttrs.length))) fail(`${s.name}: ${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
    look('starts on the fluid', sw.start, { fluid: true, sky: true });
    look('switching to the weather sky removes the fluid canvas', sw.toSky, { fluid: false, sky: true });
    look('switching back brings the fluid back', sw.backToFluid, { fluid: true, sky: true });
    look('switching the weather off leaves nothing behind', sw.off, { fluid: false, sky: false, clean: true });
  }
  if (s.settle) { // R2: the canvas resolution only ever steps down inside the 30 s cooldown, and settles (no bouncing)
    const q = d.quality || [];
    if (!q.length) fail(`${s.name}: no canvas sizes sampled`);
    if (q.some((v, i) => i && v > q[i - 1])) fail(`${s.name}: canvas width went up inside the cooldown: ${q}`);
    if (q.length > 4) fail(`${s.name}: canvas resized ${q.length - 1} times in 12 s: ${q}`);
  }
  if (s.name === 'big-chat' && d.off) { eq('weather off clears marks', d.off.marks, 0); eq('weather off removes canvas', d.off.canvas, false); eq('weather off removes sheet', d.off.sheet, false); eq('weather off leaves no root attributes', d.off.rootAttrs, []); eq('weather off unpins every text colour', d.off.inlineColours, 0); }
  console.log(`${s.name}: ${failed === bad0 ? 'ok' : 'FAILED'}`);
}

// The 1.4.6 pixel suites: every way a plate or frame can be painted around the message box (screenshots measured at rest and
// after a scroll), and the automatic text colour over time. "--fast" skips them (about 5 minutes).
if (!process.argv.includes('--fast') && !only) {
  const suites = [
    ['plates', 'plates.mjs', (d) => (d._errors || []).length === 0 && Object.values(d._summary || {}).length > 0 && Object.values(d._summary).every(Boolean), (d) => Object.entries(d._summary || {}).filter(([, v]) => !v).map(([k]) => k).join(', ') || (d._errors || []).join('; ')],
    ['plates on the fluid', 'plates.mjs', (d) => (d._errors || []).length === 0 && Object.values(d._summary || {}).length > 0 && Object.values(d._summary).every(Boolean), (d) => Object.entries(d._summary || {}).filter(([, v]) => !v).map(([k]) => k).join(', ') || (d._errors || []).join('; '), ['bg,fborder@far,wide@far,wide@dark', '--fluid']],
    ['ink', 'ink.mjs', (d) => d.pass === true, (d) => Object.entries(d.checks || {}).filter(([, v]) => !v).map(([k]) => k).join(', ')],
  ];
  for (const [name, file, passed, why, extra = []] of suites) {
    let d;
    for (let attempt = 1; attempt <= 2 && !d; attempt++) {
      const r = spawnSync(process.execPath, [path.join(here, file), EXT, ...extra, '--json'], { encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 26 });
      try { d = JSON.parse(r.stdout); } catch { console.log(`${name}: no JSON (attempt ${attempt})\n${(r.stderr || '').slice(0, 400)}`); }
    }
    if (!d) { fail(name + ' crashed'); continue; }
    if (passed(d)) console.log(`${name}: ok`);
    else { console.log(`${name}: FAILED`); fail(`${name}: ${why(d)}`); }
  }
}

console.log(failed ? `\n${failed} failure(s)` : '\nall green');
process.exit(failed ? 1 : 0);
