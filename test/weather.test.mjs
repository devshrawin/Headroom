import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadBackground, makeStorage } from './chrome-stub.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const AM = (() => {
  const ctx = vm.createContext({ console, Date, encodeURIComponent });
  for (const f of ['src/core/quotas.js', 'src/core/common.js', 'src/core/weather-data.js']) vm.runInContext(read(f), ctx, { filename: f });
  return ctx.Headroom;
})();
const W = AM.WEATHER;
const plain = (v) => JSON.parse(JSON.stringify(v));

const forecast = (over = {}) => ({
  utc_offset_seconds: 19800,
  current: { time: '2026-11-23T10:45', temperature_2m: 27.3, weather_code: 0, cloud_cover: 0, wind_speed_10m: 9.1, wind_direction_10m: 81, is_day: 1, precipitation: 0, ...over },
  daily: { sunrise: ['2026-11-23T06:40'], sunset: ['2026-11-23T17:55'] },
});

test('weather codes map to the right condition; a "clear" code with lots of cloud is not clear', () => {
  const cases = [[0, 'clear'], [1, 'clear'], [2, 'partly'], [3, 'overcast'], [45, 'fog'], [48, 'fog'], [53, 'drizzle'], [61, 'rain'], [65, 'rain'], [81, 'rain'], [73, 'snow'], [86, 'snow'], [95, 'storm'], [99, 'storm'], [123, 'partly']];
  for (const [code, want] of cases) assert.equal(W.wmoToWeather(code), want, 'code ' + code);
  assert.equal(W.wmoToWeather(0, 90), 'overcast');
  assert.equal(W.wmoToWeather(0, 40), 'partly');
  assert.equal(W.wmoToWeather(0, 5), 'clear');
  assert.equal(W.wmoToWeather(61, 5), 'rain', 'only a clear code is second-guessed');
});

test('seasons: India has monsoon, the tropics have wet and dry, the south flips, the temperate north has four', () => {
  assert.equal(W.seasonFor(23, 72.5, 6), 'monsoon'); // Ahmedabad in July
  assert.equal(W.seasonFor(23, 72.5, 3), 'summer');
  assert.equal(W.seasonFor(23, 72.5, 9), 'autumn');
  assert.equal(W.seasonFor(23, 72.5, 0), 'winter');
  assert.equal(W.seasonFor(48.8, 2.3, 3), 'spring'); // Paris in April
  assert.equal(W.seasonFor(48.8, 2.3, 9), 'autumn');
  assert.equal(W.seasonFor(48.8, 2.3, 0), 'winter');
  assert.equal(W.seasonFor(-33.9, 151.2, 0), 'summer'); // Sydney in January
  assert.equal(W.seasonFor(-33.9, 151.2, 6), 'winter');
  assert.equal(W.seasonFor(1.3, 103.8, 6), 'monsoon'); // near the equator: wet or dry
});

test('a forecast is parsed into the small record we keep, coordinates rounded; garbage is refused', () => {
  const d = plain(W.parseForecast(forecast(), 23.025791, 72.587265));
  assert.equal(d.lat, 23.03);
  assert.equal(d.lon, 72.59);
  assert.equal(d.code, 0);
  assert.equal(d.temp, 27.3);
  assert.equal(d.rise, 6 + 40 / 60);
  assert.equal(d.set, 17 + 55 / 60);
  assert.equal(d.utcOffset, 19800);
  for (const bad of [null, 'x', 5, {}, { current: null }, { current: {} }, { current: { weather_code: 'sun' } }]) assert.equal(W.parseForecast(bad, 1, 2), null);
  const wild = W.parseForecast(forecast({ temperature_2m: 9999, wind_speed_10m: -5, cloud_cover: 500 }), 1, 2);
  assert.equal(wild.temp, 60, 'out-of-range numbers are clamped');
  assert.equal(wild.windKmh, 0);
  assert.equal(wild.cloud, 100);
});

test('the forecast URL carries only the rounded coordinates; a city search URL is encoded', () => {
  const u = AM.weatherUrl(23.025791, 72.587265);
  assert.match(u, /latitude=23\.03&longitude=72\.59/);
  assert.ok(u.startsWith('https://api.open-meteo.com/'));
  assert.doesNotMatch(u, /23\.025|72\.587/);
  assert.equal(AM.geocodeUrl('São Paulo & co').includes('S%C3%A3o%20Paulo%20%26%20co'), true);
  assert.ok(AM.WEATHER_HOSTS.every((h) => h.startsWith('https://') && h.endsWith('/*')));
});

test('the sky state: the hour is the hour AT the place, wind blows the clouds the other way, a preview overrides the real thing', () => {
  const d = W.parseForecast(forecast({ wind_direction_10m: 270, wind_speed_10m: 20 }), 23, 72.5);
  // 2026-11-23 05:00 UTC is 10:30 in India (UTC+5:30)
  const at = Date.UTC(2026, 10, 23, 5, 0);
  const st = W.skyState(d, at, null);
  assert.equal(st.tod, 10.5);
  assert.equal(st.live, true);
  assert.equal(st.weather, 'clear');
  assert.equal(st.season, 'autumn', 'late November in India is post-monsoon');
  assert.ok(st.windX > 0.4 && st.windX < 0.6, 'a west wind (from 270) moves the clouds east');
  const f = W.skyState(d, at, { weather: 'storm', tod: 22 });
  assert.equal(f.weather, 'storm');
  assert.equal(f.tod, 22);
  assert.equal(f.live, false);
  assert.equal(f.season, 'autumn', 'what is not overridden stays real');
  const none = W.skyState(null, at, null);
  assert.equal(none.weather, 'clear');
});

test('targets: the monsoon makes a clear day wet, snow only falls as snow, storms are flagged', () => {
  assert.equal(W.targetsFor('clear', 'monsoon').rain, 0.7);
  assert.equal(W.targetsFor('clear', 'summer').rain, 0);
  assert.equal(W.targetsFor('snow', 'winter').snow, 0.85);
  assert.equal(W.targetsFor('rain', 'winter').snow, 0);
  assert.equal(W.targetsFor('storm', 'summer').thunder, true);
  assert.equal(W.targetsFor('clear', 'autumn').leaves, 0.7);
  assert.equal(W.targetsFor('rain', 'autumn').leaves < 0.7, true, 'fewer leaves in the rain');
  assert.deepEqual(plain(W.targetsFor('nope', 'nope')), plain(W.targetsFor('clear', 'summer')));
});

test('describe: a short line for Settings, in the chosen units', () => {
  const d = W.parseForecast(forecast({ temperature_2m: 20 }), 23, 72.5);
  assert.equal(W.describe(d, 'c').temp, '20°C');
  assert.equal(W.describe(d, 'f').temp, '68°F');
  assert.equal(W.describe(null, 'c'), null);
});

// ---- the background script ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test('background: refreshWeather fetches the chosen place, stores the parsed record, and clears an old error', async () => {
  const storage = makeStorage({ settings: { weather: true, weatherPlace: { name: 'Home', lat: 23.025791, lon: 72.587265 } }, 'weather.error': { error: 'old', t: 1 } });
  const urls = [];
  const bg = loadBackground({ storage, fetch: async (u) => { urls.push(u); return { ok: true, status: 200, json: async () => forecast() }; } });
  const replies = [];
  const [fn] = bg.listeners.message;
  assert.equal(fn({ type: 'headroom:weatherNow' }, {}, (r) => replies.push(r)), true);
  await sleep(30);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /latitude=23\.03&longitude=72\.59/);
  assert.equal(replies[0].ok, true);
  assert.equal(storage.data['weather.data'].code, 0);
  assert.equal('weather.error' in storage.data, false);
});

test('background: a failing or odd response is kept as an error, never as weather', async () => {
  const place = { name: 'Home', lat: 1, lon: 2 };
  for (const make of [
    () => async () => ({ ok: false, status: 429, json: async () => ({}) }),
    () => async () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) }),
    () => async () => { throw new Error('offline'); },
  ]) {
    const storage = makeStorage({ settings: { weather: true, weatherPlace: place } });
    const bg = loadBackground({ storage, fetch: make() });
    const replies = [];
    bg.listeners.message[0]({ type: 'headroom:weatherNow' }, {}, (r) => replies.push(r));
    await sleep(30);
    assert.equal(replies[0].ok, false);
    assert.equal('weather.data' in storage.data, false);
    assert.ok(storage.data['weather.error'] && storage.data['weather.error'].error);
  }
});

test('background: with the weather off or no place, nothing is fetched and stored data is dropped', async () => {
  for (const settings of [{ weather: false, weatherPlace: { name: 'Home', lat: 1, lon: 2 } }, { weather: true, weatherPlace: null }]) {
    const storage = makeStorage({ settings, 'weather.data': { code: 1 } });
    let called = 0;
    const bg = loadBackground({ storage, fetch: async () => { called++; return { ok: true, json: async () => forecast() }; } });
    bg.listeners.message[0]({ type: 'headroom:weatherNow' }, {}, () => {});
    await sleep(30);
    assert.equal(called, 0, 'no request');
    assert.equal('weather.data' in storage.data, false);
  }
});

test('background: loadWeather is refused without a sender tab, and injects only the sky renderer otherwise', async () => {
  const bg = loadBackground();
  const replies = [];
  const [fn] = bg.listeners.message;
  assert.equal(fn({ type: 'headroom:loadWeather' }, {}, (r) => replies.push(r)), undefined);
  assert.equal(replies[0].ok, false);
  assert.equal(fn({ type: 'headroom:loadWeather' }, { tab: { id: 3 }, frameId: 0 }, (r) => replies.push(r)), true);
  await bg.settle();
  assert.equal(replies[1].ok, true);
  assert.equal(bg.executed.length, 1);
  assert.equal(JSON.stringify(bg.executed[0].files), JSON.stringify(['src/core/sky-palette.js', 'src/core/weather-sky.js']));
});

test('background: a 20-minute alarm is created when a place is saved, and the weather is fetched at once', async () => {
  const storage = makeStorage({ settings: { weather: false } });
  let called = 0;
  const bg = loadBackground({ storage, fetch: async () => { called++; return { ok: true, json: async () => forecast() }; } });
  const next = { weather: true, weatherPlace: { name: 'Home', lat: 1, lon: 2 } };
  storage.data.settings = next; // storage already holds the new value when the change event fires
  bg.listeners.storageChanged.forEach((fn) => fn({ settings: { oldValue: { weather: false }, newValue: next } }, 'local'));
  await sleep(40);
  assert.ok(bg.alarms.some((a) => a.name === 'weather|refresh' && a.periodInMinutes === 20), 'the alarm exists');
  assert.equal(called, 1);
});

test('the sky palette and the shader agree on every uniform', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/core/weather-sky.js', import.meta.url), 'utf8');
  const frag = src.slice(src.indexOf('const FRAG = `'), src.indexOf('`;', src.indexOf('const FRAG = `')));
  const g = { Headroom: {} }; g.globalThis = g;
  vm.runInNewContext(readFileSync(new URL('../src/core/sky-palette.js', import.meta.url), 'utf8'), g);
  const PAL = g.Headroom.SKYPAL;
  assert.ok(PAL && PAL.uniforms);
  const declared = new Set([...frag.matchAll(/uniform\s+(?:float|vec2|vec3)\s+([^;]+);/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())));
  const fromPalette = new Set(Object.keys(PAL.uniforms({ season: 'summer', weather: 'rain', hour: 12 })));
  // set by the sky script itself
  const own = ['uRes', 'uTime', 'uShift', 'uFlash', 'uFlashX', 'uBolt'];
  for (const u of fromPalette) assert.ok(declared.has(u), 'palette sets ' + u + ' but the shader has no such uniform');
  for (const u of declared) assert.ok(fromPalette.has(u) || own.includes(u), 'the shader needs ' + u + ' but nothing sets it');
  for (const u of own) assert.ok(src.includes("'" + u + "'") || src.includes('U.' + u), 'weather-sky.js never sets ' + u);
  // every season x weather x hour gives finite numbers (no NaN reaching the GPU)
  for (const season of ['spring', 'summer', 'autumn', 'winter', 'monsoon']) for (const weather of ['clear', 'partly', 'overcast', 'drizzle', 'rain', 'storm', 'snow', 'fog']) for (let h = 0; h < 24; h += 1.5) {
    const u = PAL.uniforms({ season, weather, hour: h, rise: 6.2, set: 18.3 });
    for (const [k, v] of Object.entries(u)) for (const n of [].concat(v)) assert.ok(Number.isFinite(n), season + ' ' + weather + ' ' + h + ' ' + k + ' = ' + n);
  }
});
