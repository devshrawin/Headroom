// Regression loop: the audit's unit tests, then every end-to-end scenario, each judged against the baseline below.
// Usage: node run-all.mjs [extension dir]   (default: the repo root, one folder up). Node only, no Python.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(process.argv[2] || path.join(here, '..'));
let failed = 0;
const fail = (m) => { failed++; console.log('  FAIL ' + m); };

// 1. the audit's pure-module unit tests (the repo's own suite runs separately with `npm test` at the root)
{
  const r = spawnSync(process.execPath, ['--test', path.join(here, 'audit-unit.test.mjs')], { env: { ...process.env, EXT }, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const pass = +(/ℹ pass (\d+)/.exec(out) || [0, 0])[1], bad = +(/ℹ fail (\d+)/.exec(out) || [0, 0])[1];
  console.log(`audit unit tests: ${pass} pass, ${bad} fail`);
  if (bad || r.status !== 0) fail('audit unit tests');
}

const scenarios = [
  { name: 'light-page-dark-os', args: ['--toggle', '--drag', '--options', '--fetchsem'], tone: 'tone-light', track: [232, 229, 242], sky: true, extra: true },
  { name: 'dark-page-light-os', args: ['--scheme=light', '--bg=#1f1e1d'], tone: 'tone-dark', sky: true },
  { name: 'rgb-page', args: ['--bg=rgb(250, 249, 245)', '--scheme=light'], tone: 'tone-light', track: [232, 229, 242], sky: true },
  { name: 'weather-off', args: ['--settings={"weatherPlace":null}'], tone: 'tone-light', sky: false },
  { name: 'big-chat', args: ['--msgs=4000', '--perf', '--off'], tone: 'tone-light', sky: true },
  { name: 'frosted-strips', args: ['--frost'], tone: 'tone-light', sky: true, frost: true },
  { name: 'quality-settles', args: ['--quality'], tone: 'tone-light', sky: true, settle: true },
];

for (const s of scenarios) {
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
  if (s.settle) { // R2: the canvas resolution only ever steps down inside the 30 s cooldown, and settles (no bouncing)
    const q = d.quality || [];
    if (!q.length) fail(`${s.name}: no canvas sizes sampled`);
    if (q.some((v, i) => i && v > q[i - 1])) fail(`${s.name}: canvas width went up inside the cooldown: ${q}`);
    if (q.length > 4) fail(`${s.name}: canvas resized ${q.length - 1} times in 12 s: ${q}`);
  }
  if (s.name === 'big-chat' && d.off) { eq('weather off clears marks', d.off.marks, 0); eq('weather off removes canvas', d.off.canvas, false); eq('weather off removes sheet', d.off.sheet, false); }
  console.log(`${s.name}: ${failed === bad0 ? 'ok' : 'FAILED'}`);
}

console.log(failed ? `\n${failed} failure(s)` : '\nall green');
process.exit(failed ? 1 : 0);
