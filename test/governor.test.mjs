import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// weather-sky.js only defines functions at load, so its quality governor can be exercised without a DOM or WebGL
const ctx = vm.createContext({ console });
vm.runInContext('globalThis.Headroom = {}', ctx);
vm.runInContext(readFileSync(new URL('../src/core/weather-sky.js', import.meta.url), 'utf8'), ctx, { filename: 'weather-sky.js' });
const makeGovernor = ctx.Headroom.WeatherSky.makeGovernor;

// helper: feed N drawn frames of the given gap; returns how many times it stepped down
const draw = (g, n, gap, t0) => { let downs = 0, t = t0; for (let i = 0; i < n; i++) { t += gap; if (g.drawn(gap, t)) downs++; } return { downs, t }; };
const raf = (g, n, gap, t0) => { let ups = 0, t = t0; for (let i = 0; i < n; i++) { t += gap; if (g.raf(gap, t)) ups++; } return { ups, t }; };

test('governor: a slow GPU steps the resolution down', () => {
  const g = makeGovernor();
  assert.equal(g.quality, 1);
  const r = draw(g, 80, 70, 0); // 70 ms between drawn frames, well under 30 fps
  assert.ok(r.downs >= 1, 'stepped down');
  assert.ok(g.quality < 1);
});

test('governor: after a step down, step-ups are blocked for 30 s even when frames are fast', () => {
  const g = makeGovernor();
  const d = draw(g, 80, 70, 0);
  const q = g.quality;
  const early = raf(g, 240, 10, d.t); // 2.4 s of fast frames: well inside the cooldown
  assert.equal(early.ups, 0, 'no step up inside the cooldown');
  assert.equal(g.quality, q);
  const late = raf(g, 240, 10, d.t + 31000); // after the cooldown
  assert.ok(late.ups >= 1, 'steps up once the cooldown has passed');
  assert.ok(g.quality > q);
});

test('governor: stepping up needs frames averaging under 18 ms (borderline GPUs stay put)', () => {
  const g = makeGovernor();
  const d = draw(g, 80, 70, 0);
  const q = g.quality;
  const r = raf(g, 480, 20, d.t + 60000); // 20 ms frames: fine for 30 fps drawing, not fast enough to raise the resolution
  assert.equal(r.ups, 0);
  assert.equal(g.quality, q);
});

test('governor: it cannot oscillate: slow, fast, slow produces at most one change per 30 s', () => {
  const g = makeGovernor();
  let changes = 0, t = 0;
  for (let round = 0; round < 6; round++) { // 6 rounds of slow then fast, each round about 10 s
    const d = draw(g, 60, 70, t); changes += d.downs; t = d.t;
    const r = raf(g, 120, 12, t); changes += r.ups; t = r.t;
  }
  assert.ok(changes <= Math.ceil(t / 30000) + 2, `${changes} changes in ${Math.round(t / 1000)} s`);
});

test('governor: a fast GPU never steps down, and quality never exceeds 1', () => {
  const g = makeGovernor();
  const d = draw(g, 400, 33, 0);
  assert.equal(d.downs, 0);
  raf(g, 1200, 8, d.t);
  assert.equal(g.quality, 1);
});
