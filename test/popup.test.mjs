import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const AM = (() => {
  const ctx = vm.createContext({ console });
  for (const f of ['src/core/quotas.js', 'src/core/common.js']) vm.runInContext(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  return ctx.Headroom;
})();
const now = 1_000_000_000_000;
const H = 3600e3;

test('resetText: a reset time in the past reads "reset due" / "frees up now", never "in now"', () => {
  assert.equal(AM.resetText({ resetAt: now - 1, source: 'real' }, now), 'reset due');
  assert.equal(AM.resetText({ resetAt: now - 1, source: 'estimate' }, now), 'frees up now');
  assert.match(AM.resetText({ resetAt: now + 13 * H, source: 'real' }, now), /^resets at (tomorrow )?\d{1,2}:\d{2}/);
  assert.match(AM.resetText({ resetAt: now + 13 * H, source: 'estimate' }, now), /^next frees at /);
  assert.match(AM.resetText({ resetAt: now + 3 * 86400e3, source: 'real' }, now), /^resets at \w{3} \d{1,2}:\d{2}/);
  assert.match(AM.formatClock(now + 20 * 86400e3, now), /^\S+ ?\S*$/, 'far-off resets show a date');
  assert.equal(AM.resetText({ source: 'real' }, now), '');
});

test('usageLevel: ok under 75, close from 75, crit from 90, empty at 100 or on a banner, unk without a number', () => {
  const lv = (pct, m) => AM.usageLevel(m || {}, pct);
  assert.equal(lv(0), 'ok');
  assert.equal(lv(74.9), 'ok');
  assert.equal(lv(75), 'close');
  assert.equal(lv(89.9), 'close');
  assert.equal(lv(90), 'crit');
  assert.equal(lv(99.9), 'crit');
  assert.equal(lv(100), 'empty');
  assert.equal(lv(null), 'unk');
  assert.equal(lv(undefined), 'unk');
  assert.equal(lv(10, { source: 'banner' }), 'empty');
});
