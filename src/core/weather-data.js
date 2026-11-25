// Weather data: turns a forecast from Open-Meteo into the look of the sky (condition, season, hour, wind).
// Pure functions, no network and no DOM: the background script fetches and stores the data, the page reads it,
// the Settings page describes it. Loaded in the service worker, the pages and the content script.
(() => {
  const AM = (globalThis.Headroom = globalThis.Headroom || { adapters: [] });

  // Every condition the sky can show (the look of each lives in sky-palette.js).
  const WEATHERS = {
    clear:    { label: 'Clear' },
    partly:   { label: 'Partly cloudy' },
    overcast: { label: 'Overcast' },
    drizzle:  { label: 'Drizzle' },
    rain:     { label: 'Rain' },
    storm:    { label: 'Thunderstorm' },
    snow:     { label: 'Snow' },
    fog:      { label: 'Fog' },
  };
  // The seasons (their colours and falling leaves or petals live in sky-palette.js).
  const SEASONS = {
    spring:  { label: 'Spring' },
    summer:  { label: 'Summer' },
    autumn:  { label: 'Autumn' },
    winter:  { label: 'Winter' },
    monsoon: { label: 'Monsoon' },
  };

  // WMO weather codes (what Open-Meteo returns) to a condition.
  function wmoToWeather(code, cloudPct) {
    let w = 'partly';
    if (code === 0 || code === 1) w = 'clear';
    else if (code === 2) w = 'partly';
    else if (code === 3) w = 'overcast';
    else if (code === 45 || code === 48) w = 'fog';
    else if (code >= 51 && code <= 57) w = 'drizzle';
    else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) w = 'rain';
    else if ((code >= 71 && code <= 77) || code === 85 || code === 86) w = 'snow';
    else if (code >= 95 && code <= 99) w = 'storm';
    // a clear code with a lot of cloud in the measurement is not really clear
    if (w === 'clear' && typeof cloudPct === 'number') w = cloudPct > 60 ? 'overcast' : cloudPct > 25 ? 'partly' : 'clear';
    return w;
  }

  // Season from where and when. India has monsoon, not four temperate seasons; the tropics have wet and dry.
  function seasonFor(lat, lon, month) {
    const inIndia = lat > 6 && lat < 36 && lon > 67 && lon < 98;
    if (inIndia) {
      if (month >= 5 && month <= 8) return 'monsoon';
      if (month >= 2 && month <= 4) return 'summer';
      if (month >= 9 && month <= 10) return 'autumn';
      return 'winter';
    }
    const m = lat >= 0 ? month : (month + 6) % 12;
    if (Math.abs(lat) < 15) return m >= 4 && m <= 9 ? 'monsoon' : 'summer';
    if (m >= 2 && m <= 4) return 'spring';
    if (m >= 5 && m <= 7) return 'summer';
    if (m >= 8 && m <= 10) return 'autumn';
    return 'winter';
  }

  const hm = (iso) => {
    const t = String(iso || '').split('T')[1];
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h + m / 60 : null;
  };
  const num = (v, a, b, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);

  // The Open-Meteo forecast URL for one place. Coordinates are rounded to two decimals (about 1 km) before they
  // leave the device.
  AM.weatherUrl = (lat, lon) =>
    'https://api.open-meteo.com/v1/forecast?latitude=' + (+lat).toFixed(2) + '&longitude=' + (+lon).toFixed(2) +
    '&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,is_day,precipitation&daily=sunrise,sunset&timezone=auto&forecast_days=1';
  AM.geocodeUrl = (name) => 'https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=' + encodeURIComponent(String(name).slice(0, 80));
  AM.WEATHER_HOSTS = ['https://api.open-meteo.com/*', 'https://geocoding-api.open-meteo.com/*'];

  // A forecast response to the small record we keep. Returns null for anything that is not a real response.
  function parseForecast(j, lat, lon) {
    if (!j || typeof j !== 'object' || !j.current || typeof j.current !== 'object') return null;
    const c = j.current, d = j.daily || {};
    const code = num(c.weather_code, 0, 99, null);
    if (code == null) return null;
    const rise = hm(d.sunrise && d.sunrise[0]), set = hm(d.sunset && d.sunset[0]);
    return {
      t: Date.now(),
      lat: +(+lat).toFixed(2), lon: +(+lon).toFixed(2),
      utcOffset: num(j.utc_offset_seconds, -14 * 3600, 15 * 3600, 0),
      temp: num(c.temperature_2m, -90, 60, null),
      code, cloud: num(c.cloud_cover, 0, 100, null),
      windKmh: num(c.wind_speed_10m, 0, 400, 0), windDir: num(c.wind_direction_10m, 0, 360, 270),
      precip: num(c.precipitation, 0, 500, 0),
      ...sunTimes(rise, set),
    };
  }

  // Sunrise and sunset, or both null when they are missing or unusable (polar day or night gives the same time twice):
  // the sky then falls back to the season's typical ones.
  function sunTimes(rise, set) {
    const ok = typeof rise === 'number' && typeof set === 'number' && Number.isFinite(rise) && Number.isFinite(set) && set - rise >= 0.25 && set - rise <= 23.75;
    return ok ? { rise, set } : { rise: null, set: null };
  }

  // Everything the sky needs, from the stored data (or a preview override), at a moment in time.
  //   force: { weather?, season?, tod? }  (Settings → "Try a look"); null shows the real thing.
  function skyState(data, nowMs, force) {
    const f = force && typeof force === 'object' ? force : {};
    const now = nowMs == null ? Date.now() : nowMs;
    const off = data ? data.utcOffset * 1000 : -new Date().getTimezoneOffset() * 60000;
    const place = new Date(now + off); // read with the UTC getters: this is the time at the place
    const tod = typeof f.tod === 'number' ? f.tod : place.getUTCHours() + place.getUTCMinutes() / 60;
    const live = data ? wmoToWeather(data.code, data.cloud) : 'clear';
    const weather = WEATHERS[f.weather] ? f.weather : live;
    const season = SEASONS[f.season] ? f.season : data ? seasonFor(data.lat, data.lon, place.getUTCMonth()) : 'summer';
    const kmh = data ? data.windKmh : 8;
    const strength = Math.min(1, kmh / 40);
    // wind blows from windDir; the clouds travel the other way
    const rad = ((data ? data.windDir : 270) * Math.PI) / 180;
    return {
      weather, season, tod, live: !f.weather && !f.season && typeof f.tod !== 'number',
      seasonForced: !!SEASONS[f.season],
      ...(data ? sunTimes(data.rise, data.set) : { rise: 6.3, set: 18.4 }),
      wind: strength, windX: -Math.sin(rad) * strength, windY: -Math.cos(rad) * strength * .3,
      temp: data ? data.temp : null,
    };
  }

  // A line for the Settings page: "27° · Clear · Autumn" and when the data is from.
  function describe(data, units, force) {
    if (!data) return null;
    const st = skyState(data, Date.now(), force);
    const t = data.temp == null ? '' : units === 'f' ? Math.round(data.temp * 9 / 5 + 32) + '°F' : Math.round(data.temp) + '°C';
    return { temp: t, label: WEATHERS[st.weather].label, season: SEASONS[st.season].label, wind: Math.round(data.windKmh), tod: st.tod };
  }

  AM.WEATHER = { WEATHERS, SEASONS, wmoToWeather, seasonFor, parseForecast, skyState, describe };
})();
