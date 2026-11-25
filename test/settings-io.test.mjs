import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadBackground } from './chrome-stub.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const AM = (() => {
  const ctx = vm.createContext({ console });
  for (const f of ['src/core/quotas.js', 'src/core/common.js']) vm.runInContext(read(f), ctx, { filename: f });
  return ctx.Headroom;
})();
const plain = (v) => JSON.parse(JSON.stringify(v));
const wrap = (settings) => JSON.stringify({ app: 'headroom', format: 1, settings });

test('export holds settings only, with a version and a timestamp', () => {
  const file = plain(AM.buildExport({ notify: false, thresholds: [60, 95], usage: { secret: 1 }, 'debug.log': ['x'], customSites: [{ host: 'chat.example.com', limit: 5, windowHours: 2 }] }, '1.0.0', new Date('2026-10-31T10:00:00Z')));
  assert.equal(file.app, 'headroom');
  assert.equal(file.version, '1.0.0');
  assert.equal(file.exportedAt, '2026-10-31T10:00:00.000Z');
  assert.equal(file.settings.notify, false);
  assert.deepEqual(file.settings.thresholds, [60, 95]);
  assert.equal('usage' in file.settings, false);
  assert.equal('debug.log' in file.settings, false);
  assert.deepEqual(Object.keys(file.settings).sort(), ['chatStats', 'customSites', 'debug', 'meterStyle', 'notify', 'quotas', 'thresholds', 'weather', 'weatherStrength', 'weatherUnits', 'widget']);
});

test('export then import round-trips the settings', () => {
  const settings = AM.mergeSettings({ notify: false, meterStyle: 'bar-top', thresholds: [50, 80], quotas: { gemini: [{ id: 'm', label: 'Prompts', pattern: '.*', limit: 77, windowHours: 5 }] }, customSites: [{ host: 'chat.example.com', limit: 9, windowHours: 3 }] });
  const r = AM.parseImport(JSON.stringify(AM.buildExport(settings, '1.0.0')));
  assert.equal(r.ok, true);
  assert.equal(r.settings.notify, false);
  assert.equal(r.settings.meterStyle, 'bar-top');
  assert.deepEqual(plain(r.settings.thresholds), [50, 80]);
  assert.equal(r.settings.quotas.gemini[0].limit, 77);
  assert.deepEqual(plain(r.sites), [{ host: 'chat.example.com', limit: 9, windowHours: 3 }]);
});

test('import rejects things that are not a backup', () => {
  for (const [text, msg] of [
    ['not json', /valid JSON/],
    ['[]', /not an Headroom backup/],
    ['{"app":"other","settings":{}}', /not an Headroom backup/],
    ['{"app":"headroom"}', /not an Headroom backup/],
    ['{"app":"headroom","settings":[]}', /not an Headroom backup/],
    [' '.repeat(200001), /too large/],
    [null, /too large/],
  ]) {
    const r = AM.parseImport(text);
    assert.equal(r.ok, false, String(text).slice(0, 30));
    assert.match(r.error, msg);
  }
});

test('import keeps only well-typed values and drops the rest', () => {
  const r = AM.parseImport(wrap({
    widget: 'yes', notify: true, debug: 1, irisEnergy: 'wild', thresholds: [50, -1, 'x', 101, 90],
    quotas: {
      gemini: [
        { id: 'ok', label: 'Prompts', pattern: 'a|b', limit: 10, windowHours: 5 },
        { id: 'bad-regex', label: 'x', pattern: '(', limit: 1, windowHours: 1 },
        { id: 'neg', label: 'x', pattern: '.*', limit: -1, windowHours: 1 },
        { id: 'zero-window', label: 'x', pattern: '.*', limit: 1, windowHours: 0 },
        { id: 'long', label: 'x'.repeat(101), pattern: '.*', limit: 1, windowHours: 1 },
        'junk', null,
      ],
      'bad id!': [], __proto__: [], evil: 'no',
    },
    customSites: [{ host: 'chat.example.com', limit: 'x', windowHours: -3 }, { host: '*.evil.com' }, { host: 'localhost' }, { host: 5 }, null],
    extra: 'dropped',
  }));
  assert.equal(r.ok, true);
  assert.equal('widget' in r.settings, false);
  assert.equal(r.settings.notify, true);
  assert.equal('debug' in r.settings, false);
  assert.equal('irisEnergy' in r.settings, false);
  assert.deepEqual(plain(r.settings.thresholds), [50, 90]);
  assert.deepEqual(plain(r.settings.quotas.gemini.map((x) => x.id)), ['ok']);
  assert.deepEqual(Object.keys(r.settings.quotas), ['gemini']);
  assert.equal('extra' in r.settings, false);
  assert.deepEqual(plain(r.sites), [{ host: 'chat.example.com', limit: 0, windowHours: 24 }]);
});

test('import cannot pollute prototypes', () => {
  const r = AM.parseImport('{"app":"headroom","settings":{"quotas":{"__proto__":[{"id":"a","label":"b","pattern":".*","limit":1,"windowHours":1}],"constructor":[]}}}');
  assert.equal(r.ok, true);
  assert.equal({}.limit, undefined);
  assert.equal(Object.keys(r.settings.quotas).includes('__proto__'), false);
  assert.equal(r.settings.quotas.limit, undefined);
  assert.deepEqual(Object.keys(r.settings.quotas), ['constructor']);
});

test('first install opens the welcome page; an update or browser update does not', async () => {
  const bg = await loadBackground();
  const fire = async (details) => { for (const fn of bg.listeners.installed) await fn(details); await bg.settle(); };
  await fire({ reason: 'update' });
  await fire({ reason: 'chrome_update' });
  assert.equal(bg.tabsCreated.length, 0);
  await fire({ reason: 'install' });
  assert.equal(bg.tabsCreated.length, 1);
  assert.match(bg.tabsCreated[0].url, /src\/welcome\/welcome\.html$/);
});


test('meterStyle: the bar at the bottom by default, the top when asked, anything else (including the old pill) falls back to the bottom', () => {
  assert.equal(AM.mergeSettings(null).meterStyle, 'bar-bottom');
  assert.equal(AM.mergeSettings({ meterStyle: 'bar-top' }).meterStyle, 'bar-top');
  assert.equal(AM.mergeSettings({ meterStyle: 'pill' }).meterStyle, 'bar-bottom');
});

test('weather settings: on by default but no place; the place is validated and rounded; strength and units are clamped', () => {
  const d = AM.mergeSettings(null);
  assert.equal(d.weather, true);
  assert.equal(d.weatherPlace, null);
  assert.equal(d.weatherUnits, 'c');
  assert.equal(d.weatherStrength, 1);
  assert.equal(d.weatherForce, null);
  const p = AM.mergeSettings({ weatherPlace: { name: 'Ahmedabad, India', lat: 23.025791, lon: 72.587265 } }).weatherPlace;
  assert.equal(p.lat, 23.03);
  assert.equal(p.lon, 72.59);
  assert.equal(AM.mergeSettings({ weatherPlace: { name: 'x', lat: 95, lon: 0 } }).weatherPlace, null);
  assert.equal(AM.mergeSettings({ weatherPlace: 'Paris' }).weatherPlace, null);
  assert.equal(AM.mergeSettings({ weatherStrength: 5 }).weatherStrength, 1);
  assert.equal(AM.mergeSettings({ weatherStrength: 0 }).weatherStrength, 0.2);
  assert.equal(AM.mergeSettings({ weatherUnits: 'k' }).weatherUnits, 'c');
  assert.equal(AM.mergeSettings({ weather: false }).weather, false);
  const f = AM.mergeSettings({ weatherForce: { weather: 'storm', season: 'nope', tod: 30, extra: 1 } }).weatherForce;
  assert.equal(JSON.stringify(f), JSON.stringify({ weather: 'storm' }));
  assert.equal(AM.mergeSettings({ weatherForce: { weather: 'nope' } }).weatherForce, null);
});

test('a settings backup never carries the place; an import keeps weather options but ignores the place', () => {
  const settings = AM.mergeSettings({ weatherPlace: { name: 'Home', lat: 10.5, lon: 76.2 }, weatherUnits: 'f', weatherStrength: 0.5 });
  const file = plain(AM.buildExport(settings, '1.2.0'));
  assert.equal('weatherPlace' in file.settings, false, 'where you are stays on this computer');
  assert.equal(file.settings.weatherUnits, 'f');
  const r = AM.parseImport(JSON.stringify(file));
  assert.equal(r.ok, true);
  assert.equal(r.settings.weatherUnits, 'f');
  assert.equal(r.settings.weatherStrength, 0.5);
  const bad = AM.parseImport(wrap({ weatherUnits: 'k', weatherStrength: 'lots' }));
  assert.equal(bad.ok, true);
  assert.equal(bad.settings.weatherUnits, undefined);
  assert.equal(bad.settings.weatherStrength, undefined);
});

test('meterStyle: all four edges are accepted by merge and import; anything else falls back to bar-bottom', () => {
  for (const s of ['bar-top', 'bar-bottom', 'bar-left', 'bar-right']) {
    assert.equal(AM.mergeSettings({ meterStyle: s }).meterStyle, s, 'merge ' + s);
    const r = AM.parseImport(wrap({ meterStyle: s }));
    assert.equal(r.settings.meterStyle, s, 'import ' + s);
  }
  for (const bad of ['pill', 'bar', 'bar-middle', 'BAR-TOP', '', null, 5, {}, undefined]) {
    assert.equal(AM.mergeSettings({ meterStyle: bad }).meterStyle, 'bar-bottom', 'merge ' + String(bad));
    assert.equal('meterStyle' in AM.parseImport(wrap({ meterStyle: bad })).settings, false, 'import drops ' + String(bad));
    assert.equal(AM.mergeSettings(AM.parseImport(wrap({ meterStyle: bad })).settings).meterStyle, 'bar-bottom');
  }
  assert.equal(AM.mergeSettings(null).meterStyle, 'bar-bottom');
});
