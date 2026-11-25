// Headroom sky: everything that depends on hour, season and weather is decided here, on the CPU, once per change.
// The shader only receives final colours and a handful of 0..1 amounts.
(() => {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const mul = (a, k) => a.map((v) => v * k);

  // Sky stops per season and time of day: [zenith, middle, horizon]
  const SKY = {
    spring:  { dawn: ['#2A3E6D', '#AE8798', '#F2C2A4'], day: ['#2363BE', '#5B9CE3', '#C6E3F4'], golden: ['#33507F', '#D29A80', '#FFD7A2'], night: ['#050B1A', '#0D1A36', '#1E3155'] },
    summer:  { dawn: ['#23386A', '#C28A86', '#FFC690'], day: ['#0D48A8', '#2C7EDC', '#ADD4F2'], golden: ['#2A4279', '#DD875E', '#FFBF6C'], night: ['#03081A', '#0A1636', '#1B2C50'] },
    autumn:  { dawn: ['#2C3960', '#B0857D', '#F2BA8C'], day: ['#1F4F96', '#4B87C8', '#D3D9D6'], golden: ['#323F6C', '#CF7C4E', '#F7AA5E'], night: ['#060912', '#101A30', '#252C42'] },
    winter:  { dawn: ['#2B3B60', '#8E9AB8', '#E9C6B4'], day: ['#3268AC', '#78A7D8', '#E0ECF5'], golden: ['#35476E', '#B39AA2', '#F3CBA9'], night: ['#02060F', '#08132A', '#172744'] },
    monsoon: { dawn: ['#1A2836', '#4A5E6C', '#E39C6A'], day: ['#2C4656', '#5B7A8A', '#A9BCC0'], golden: ['#1B2633', '#4C5A66', '#EE965A'], night: ['#04070C', '#0C141C', '#18242E'] },
  };
  // Light by time: sun/moon colour, horizon glow, cloud lit side, cloud shadow side
  const LIGHT = {
    dawn:   { sun: '#FFB894', glow: '#E88C74', lit: '#FFD8C8', amb: '#5D6888' },
    day:    { sun: '#FFF5E4', glow: '#FFFFFF', lit: '#FCFDFF', amb: '#A7B9D2' },
    golden: { sun: '#FFA052', glow: '#FF8C40', lit: '#FFCB92', amb: '#5A617C' },
    night:  { sun: '#DCE5F6', glow: '#1A2440', lit: '#56637E', amb: '#0C1424' },
  };
  // Weather skies by day and by night: [zenith, middle, horizon, cloud lit, cloud shadow, fog]
  const WX = {
    overcast: { w: .85, day: ['#7C8CA2', '#A2B1C3', '#CAD3DD', '#E6EBF1', '#8C99AC', '#C9D0D8'], night: ['#0C1119', '#161E2A', '#232D3B', '#2E3848', '#121821', '#202834'] },
    drizzle:  { w: .85, day: ['#62728A', '#8697AC', '#B0BDCB', '#D2D9E2', '#6E7C90', '#B4BECA'], night: ['#0A0F17', '#141B27', '#212B39', '#283242', '#0E141D', '#1C2430'] },
    rain:     { w: .92, day: ['#4D5D73', '#74859A', '#A0AFBF', '#BAC5D2', '#56657A', '#9CA8B6'], night: ['#080C13', '#111823', '#1C2533', '#232D3C', '#0B1018', '#18202B'] },
    storm:    { w: 1,   day: ['#161C27', '#2A3341', '#4A5564', '#66728A', '#1A212C', '#3E4855'], night: ['#04060B', '#0B1018', '#161E29', '#1E2633', '#06090E', '#121821'] },
    snow:     { w: .8,  day: ['#8494AB', '#B2BFCE', '#DDE4EB', '#F2F5F8', '#9AA8BA', '#DCE2E9'], night: ['#0F1520', '#1B2434', '#2C3748', '#3A4558', '#151C28', '#28313F'] },
    fog:      { w: .55, day: ['#8FA2BA', '#BAC6D2', '#E2E5E7', '#EEF0F2', '#B5BDC7', '#DCE0E4'], night: ['#0B111B', '#18202C', '#2A323E', '#2F3846', '#141A24', '#2A323D'] },
  };
  // amounts per condition
  const COND = {
    clear:    { cover: .06, gloom: 0,   rain: 0,   snow: 0,  fog: 0,   tower: .2 },
    partly:   { cover: .42, gloom: 0,   rain: 0,   snow: 0,  fog: 0,   tower: .35 },
    overcast: { cover: 1.0,  gloom: .35, rain: 0,   snow: 0,  fog: .05, tower: .25 },
    drizzle:  { cover: .86, gloom: .42, rain: .32, snow: 0,  fog: .12, tower: .3 },
    rain:     { cover: .97, gloom: .65, rain: .7,  snow: 0,  fog: .12, tower: .55 },
    storm:    { cover: 1,   gloom: .9,  rain: .95, snow: 0,  fog: .08, tower: 1 },
    snow:     { cover: .88, gloom: .25, rain: 0,   snow: .8, fog: .18, tower: .2 },
    fog:      { cover: .25, gloom: .1,  rain: 0,   snow: 0,  fog: .9,  tower: .1 },
  };
  // the season's own default mood (what a typical day looks like), plus its details
  const SEASON = {
    spring:  { cond: 'partly', cover: .4, cirrus: .12, haze: .08, petals: .9,  leaves: 0,  milky: .55, halo: 0,  sparkle: 0,  sunDay: [.73, .80], moon: [.76, .79], phase: 2.0 },
    summer:  { cond: 'partly', cover: .34, cirrus: 0,   haze: .32, petals: 0,   leaves: 0,  milky: 1.0, halo: 0,  sparkle: 0,  sunDay: [.70, .90], moon: [.75, .82], phase: 2.5 },
    autumn:  { cond: 'partly', cover: .26, cirrus: .6,  haze: .22, petals: 0,   leaves: .8, milky: .6,  halo: 0,  sparkle: 0,  sunDay: [.74, .74], moon: [.76, .78], phase: 2.2 },
    winter:  { cond: 'clear',  cover: .05, cirrus: .35, haze: 0,   petals: 0,   leaves: 0,  milky: .4,  halo: .9, sparkle: .7, sunDay: [.77, .60], moon: [.74, .84], phase: 2.7 },
    monsoon: { cond: 'rain',   cover: .82, cirrus: 0,   haze: .25, petals: 0,   leaves: 0,  milky: 0,   halo: 0,  sparkle: 0,  sunDay: [.72, .80], moon: [.76, .80], phase: 2.3, rain: .4, gloom: .35, tower: .9, wxw: .12 },
  };
  // sunrise / sunset (local hours) and how high the sun climbs, per season
  const SUNPATH = { spring: [6.1, 18.4, .84], summer: [5.7, 19.0, .88], autumn: [6.2, 18.0, .74], winter: [6.9, 17.6, .55], monsoon: [5.8, 19.0, .86] };
  // the four key hours used for the comparison frames
  const KEYHOUR = { spring: { dawn: 6.25, day: 14.5, golden: 18.05, night: 2 }, summer: { dawn: 5.85, day: 14.5, golden: 18.65, night: 2 }, autumn: { dawn: 6.35, day: 14.3, golden: 17.65, night: 2 }, winter: { dawn: 7.05, day: 15.0, golden: 17.25, night: 2 }, monsoon: { dawn: 5.95, day: 14.5, golden: 18.65, night: 2 } };
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  function sky(season, hour) {
    const [rise, set, top] = SUNPATH[season];
    const L = set - rise, f = (hour - rise) / L;
    let e, sun;
    if (f >= 0 && f <= 1) { e = Math.sin(Math.PI * f); sun = [.1 + .8 * f, .04 + top * Math.sin(Math.PI * f)]; }
    else { const nf = (((hour - set) + 24) % 24) / (24 - L); e = -Math.sin(Math.PI * Math.min(1, nf)) * .6; sun = [f > 1 ? .9 + (f - 1) * .3 : .1 + f * .3, -.25]; }
    const nf = f > 1 ? (hour - set) / (24 - L) : f < 0 ? (hour + 24 - set) / (24 - L) : -1;
    const moon = nf >= 0 && nf <= 1 ? [.12 + .8 * nf, .18 + .64 * Math.sin(Math.PI * nf)] : [.5, -.4];
    // weights of the four key palettes
    let wN = 1 - ss(-.16, .0, e), wT = Math.exp(-Math.pow((e - .03) / .17, 2)), wD = ss(.1, .42, e);
    const sum = wN + wT + wD; wN /= sum; wT /= sum; wD /= sum;
    return { e, sun, moon, wN, wT, wD, twiKey: hour < 12 ? 'dawn' : 'golden', sunUp: ss(-.05, .03, e) };
  }

  function uniforms(st) {
    const season = SKY[st.season] ? st.season : 'summer';
    const se = SEASON[season];
    const hour = st.hour != null ? st.hour : KEYHOUR[season][st.time || 'day'];
    const S = sky(season, hour);
    const auto = !st.weather || st.weather === 'auto';
    const wname = auto ? se.cond : st.weather;
    const c = { ...COND[wname] };
    if (auto) { c.cover = se.cover; if (se.rain != null) c.rain = se.rain; if (se.gloom != null) c.gloom = se.gloom; if (se.tower != null) c.tower = se.tower; if (season !== 'monsoon') c.gloom = 0; }
    const blend3 = (fn) => { const d = fn('day'), t = fn(S.twiKey), n = fn('night'); return d.map((v, i) => v * S.wD + t[i] * S.wT + n[i] * S.wN); };
    let top = blend3((k) => hex(SKY[season][k][0])), mid = blend3((k) => hex(SKY[season][k][1])), hor = blend3((k) => hex(SKY[season][k][2]));
    let sun = blend3((k) => hex(LIGHT[k].sun)), glow = blend3((k) => hex(LIGHT[k].glow)), lit = blend3((k) => hex(LIGHT[k].lit)), amb = blend3((k) => hex(LIGHT[k].amb));
    amb = mix(amb, mid, .25);
    let fogC = mix(hor, [1, 1, 1], .3 * (1 - S.wN));
    const wx = WX[wname];
    if (wx && !(auto && season !== 'monsoon')) {
      const ww = auto ? se.wxw : wx.w;
      const day = S.wD + .55 * S.wT; // twilight under cloud sits between the day and night greys
      const W = wx.day.map((h, i) => mix(hex(wx.night[i]), hex(h), day));
      top = mix(top, W[0], ww); mid = mix(mid, W[1], ww); hor = mix(hor, W[2], ww * (1 - .3 * S.wT));
      lit = mix(lit, W[3], ww * .9); amb = mix(amb, W[4], ww); fogC = W[5];
      glow = mul(glow, 1 - ww * .6);
    }
    if (season === 'monsoon') fogC = mix(hor, mid, .3);
    const veil = Math.min(1, Math.max(0, (c.cover - .55) / .45));
    const sunVis = S.sunUp * (1 - .75 * veil) * (1 - .8 * c.gloom);
    const moonVis = S.wN * (S.moon[1] > -.1 ? 1 : 0) * (1 - .6 * veil) * (1 - .7 * c.gloom);
    const flashDefault = wname === 'storm' ? .55 : 0;
    return {
      uTime: 37.0 + (st.t || 0), uTop: top, uMid: mid, uHor: hor, uGlow: glow, uSunCol: sun, uLit: lit, uAmb: amb, uFogCol: fogC,
      uSun: S.sun, uMoon: S.moon, uSunVis: sunVis, uMoonVis: moonVis, uMoonPhase: se.phase, uTwi: S.wT * (1 - .5 * c.gloom), uNight: S.wN, uDay: S.wD + .35 * S.wT,
      uCover: c.cover, uGloom: c.gloom, uTower: c.tower, uCirrus: (auto ? se.cirrus : 0) * (1 - veil), uRain: c.rain, uSnow: c.snow, uFog: c.fog,
      uHaze: auto ? se.haze : 0, uHalo: auto ? se.halo : 0, uSparkle: auto ? se.sparkle * (1 - S.wN) : 0,
      uStars: S.wN, uMilky: auto ? se.milky : .6, uPetals: auto ? se.petals : 0, uLeaves: auto ? se.leaves : 0,
      uFlash: st.flash != null ? st.flash : flashDefault, uFlashX: st.flashX != null ? st.flashX : .84, uBolt: st.bolt != null ? st.bolt : (wname === 'storm' ? 1 : 0),
      uCalm: st.calm != null ? st.calm : 1, uWind: st.wind || [.6, 0],
      uSeed: (({ spring: [3, 1], summer: [11, 4], autumn: [23, 7], winter: [5, 13], monsoon: [17, 2] })[season]).map((v, i) => v + (auto ? 0 : ({ clear: 0, partly: 0, overcast: 0, drizzle: 6.1, rain: 9.7, storm: 4.4, snow: 7.9, fog: 0 })[wname] * (i ? .6 : 1))),
    };
  }
  globalThis.HRSKY = { uniforms, sky, SUNPATH, KEYHOUR, SKY, LIGHT, WX, COND, SEASON };
})();
