// The weather sky: one full-page WebGL canvas that shows the real weather as a luminous animated sky (smooth gradient
// that follows the sun and moon, soft clouds lit from the sun's side and driven by the real wind, fine rain, snow, fog,
// lightning that flashes inside the clouds, falling leaves and petals by season). One fragment shader, no assets, no
// network. It never blocks the page (pointer-events: none), pauses when the tab is hidden, stays still when the
// system asks for reduced motion, and is injected into a tab only when the weather is switched on.
(() => {
  const AM = globalThis.Headroom;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec2 uSun, uMoon;                 // positions on screen (0..1)
uniform float uDay,uTwi,uNight;           // how much day, twilight and night there is
uniform float uCover,uGloom,uRain,uSnow,uFog,uLight,uLightX,uLeaves,uLeafKind;
uniform vec2 uWind, uShift;   // wind now, and how far the wind has carried things in all
uniform vec3 uSeasonTint;

float h11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*f*(f*(f*6.-15.)+10.);
  float a=h21(i),b=h21(i+vec2(1.,0.)),c=h21(i+vec2(0.,1.)),d=h21(i+vec2(1.,1.));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vn(p);p=p*2.02+vec2(17.3,9.1);a*=.5;}return v;}
float fbm4(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vn(p);p=p*2.02+vec2(17.3,9.1);a*=.5;}return v;}
float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}

// sky gradient: bottom (horizon glow) -> middle -> top, for the hour and the weather
vec3 skyGradient(vec2 uv){
  float y=uv.y;
  vec3 dayT=vec3(.10,.34,.80), dayM=vec3(.27,.55,.92), dayB=vec3(.60,.80,.98);
  vec3 nightT=vec3(.008,.014,.06), nightM=vec3(.03,.06,.16), nightB=vec3(.07,.12,.27);
  vec3 twiT=vec3(.12,.16,.42), twiM=vec3(.62,.32,.50), twiB=vec3(1.,.58,.30);
  vec3 t=mix(nightT,dayT,uDay), m=mix(nightM,dayM,uDay), b=mix(nightB,dayB,uDay);
  t=mix(t,twiT,uTwi*.85); m=mix(m,twiM,uTwi*.85); b=mix(b,twiB,uTwi*.9);
  vec3 g=y>.5?mix(m,t,smoothstep(.5,1.,y)):mix(b,m,smoothstep(0.,.5,y));
  // warm glow where the sun is going down or coming up
  float side=smoothstep(.75,0.,distance(vec2(uv.x*1.2,y*1.6),vec2(uSun.x*1.2,uSun.y*1.6)));
  g+=vec3(1.,.5,.2)*side*uTwi*.35;
  // weather greys the sky and darkens it
  float grey=clamp(smoothstep(.35,1.,uCover)*.85+uGloom*.3,0.,1.);
  vec3 gc=vec3(luma(g))*vec3(.94,1.,1.1)*mix(1.,.34,uGloom);
  g=mix(g,gc,grey);
  g*=uSeasonTint;
  return g;
}

// soft volumetric clouds: wide smooth edges, lit from the sun's side, driven by the wind
vec4 clouds(vec2 uv,float asp,float scale,float speed,float seed,float cover,vec2 sunDir){
  vec2 p=vec2(uv.x*asp,uv.y)*scale+uShift*speed+seed;
  float warp=fbm4(p*.4+3.1);
  float n=fbm4(p+.55*warp);
  float lo=.86-cover*.54, hi=lo+.42;
  float d=smoothstep(lo,hi,n);
  float n2=fbm4(p+sunDir*.2+.55*warp);
  float d2=smoothstep(lo,hi,n2);
  float lit=clamp(.62+(d-d2)*1.5-.2*d*uGloom,0.,1.);
  // clouds hug the upper two thirds of the sky and thin out near the horizon
  float vis=smoothstep(.1,.45,uv.y);
  float a=d*mix(vis,1.,smoothstep(.5,1.,uCover));
  vec3 sunCol=mix(vec3(1.,.55,.28),vec3(1.,.97,.92),smoothstep(0.,.7,uDay*(1.-uTwi)));
  vec3 lightC=mix(sunCol,vec3(.75,.82,1.),uNight*.8)*(.3+.85*(1.-uNight*.7));
  lightC=mix(lightC,vec3(.6,.65,.76)*(.26+.5*uDay),uGloom*.9);
  vec3 shadowC=mix(vec3(.62,.70,.84),vec3(.19,.22,.31),uGloom)*(.28+.72*uDay)+vec3(.02,.03,.07)*uNight;
  shadowC=mix(shadowC,shadowC*vec3(1.1,.8,.8)+vec3(.2,.08,.12)*uTwi,uTwi*.6);
  vec3 c=mix(shadowC,lightC,lit);
  // a bright rim on the side facing the sun
  c+=lightC*pow(clamp(1.-d,0.,1.),3.)*.35*uDay*(1.-uGloom);
  return vec4(c,clamp(a,0.,1.));
}

// one depth of falling rain: a streak is a bright head with a long fading tail, softer when it is close
float rainLayer(vec2 uv,float scale,float speed,float seed,float slant,float asp,float thick){
  vec2 p=vec2(uv.x*asp,uv.y)*vec2(scale,scale*.11);
  p.x+=p.y*slant; p.y+=uTime*speed;
  vec2 id=floor(p),f=fract(p);
  float h=h21(id+seed);
  float on=step(1.-uRain*.7,h21(id+seed+9.));
  float x=abs(f.x-(.2+.6*h));
  float len=.55+.4*h21(id+seed+5.);
  float t=clamp(f.y/len,0.,1.);
  float tail=pow(1.-t,1.7)*smoothstep(0.,.04,f.y);        // brightest at the head, gone at the end of the tail
  float w=thick*(.6+.4*(1.-t));                            // and a little thinner toward the tail
  return smoothstep(w,w*.15,x)*tail*step(f.y,len)*on;
}
float snowLayer(vec2 uv,float scale,float speed,float seed,float size,float soft,float asp){
  vec2 p=vec2(uv.x*asp,uv.y)*scale;
  p.y+=uTime*speed;
  p.x+=sin(uTime*.5+p.y*1.7+seed)*.3+uShift.x*.16;
  vec2 id=floor(p),f=fract(p)-.5;
  float h=h21(id+seed);
  vec2 off=(vec2(h,h21(id+seed+3.))-.5)*.6;
  float on=step(1.-uSnow*.9,h21(id+seed+7.));
  float sz=size*(.6+.8*h21(id+seed+13.));
  return smoothstep(sz,sz*soft,length(f-off))*on;
}
vec4 leaves(vec2 uv,float scale,float speed,float seed,float asp){
  vec2 p=vec2(uv.x*asp,uv.y)*scale;
  p.y+=uTime*speed*.5; p.x+=uShift.x*.25+sin(uTime*.5+p.y*1.3+seed)*.4;
  vec2 id=floor(p),f=fract(p)-.5;
  float h=h21(id+seed);
  float on=step(1.-uLeaves*.5,h21(id+seed+4.));
  vec2 off=(vec2(h,h21(id+seed+2.))-.5)*.5;
  float ang=uTime*(h*2.-1.)*1.6+h*6.28;
  vec2 q=f-off; float c=cos(ang),s=sin(ang);
  q=vec2(c*q.x-s*q.y,s*q.x+c*q.y);
  float sz=.1*(.7+.6*h21(id+seed+8.));
  float d=length(q/vec2(sz,sz*(uLeafKind>.5?.55:.42)));
  float m=smoothstep(1.,.6,d)*on;
  vec3 col; float k=h21(id+seed+6.);
  if(uLeafKind>.5) col=mix(vec3(1.,.8,.88),vec3(1.,.94,.96),k);
  else col=k<.34?vec3(.92,.42,.12):k<.67?vec3(.82,.22,.1):vec3(.98,.74,.2);
  return vec4(col,m);
}

void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  vec2 pv=uv;
  vec3 col=skyGradient(uv);

  // stars
  if(uNight>.02){
    vec2 q=uv*vec2(asp,1.)*vec2(70.,70.);
    vec2 id=floor(q),f=fract(q)-.5;
    float hh=h21(id);
    float st=step(.965,hh)*smoothstep(.22,0.,length(f-(vec2(h21(id+3.),h21(id+7.))-.5)*.6));
    st*=.55+.45*sin(uTime*(1.2+hh*3.)+hh*50.);
    float big=step(.996,h21(id+11.))*smoothstep(.45,0.,length(f))*.6;
    col+=vec3(.85,.9,1.)*(st+big)*pow(uNight,3.)*(1.-smoothstep(.2,.9,uCover))*smoothstep(.1,.6,uv.y);
  }
  // sun: a soft glow and a bright core, behind the clouds
  float ds=distance((uv-uSun)*vec2(asp,1.),vec2(0.));
  float sunVis=max(uDay,uTwi*.95)*(1.-.55*smoothstep(.3,1.,uCover))*(1.-uGloom);
  vec3 sunCol=mix(vec3(1.,.55,.25),vec3(1.,.95,.85),smoothstep(0.,.5,uDay*(1.-uTwi)));
  col+=sunCol*(exp(-ds*2.6)*.22+exp(-ds*7.)*.3+exp(-ds*22.)*.5+exp(-ds*80.)*1.1)*sunVis*(1.+uTwi*.6);
  col+=vec3(1.,.98,.92)*smoothstep(.03,.022,ds)*2.5*sunVis*(1.-uCover*.6);
  // moon
  float dm=distance((uv-uMoon)*vec2(asp,1.),vec2(0.));
  float moonVis=uNight*(1.-.7*smoothstep(.3,1.,uCover));
  float mdisc=smoothstep(.034,.03,dm);
  float crater=.9+.12*vn((uv-uMoon)*vec2(asp,1.)*90.);
  col+=vec3(.7,.78,1.)*(exp(-dm*9.)*.18+exp(-dm*35.)*.3)*moonVis;
  col=mix(col,vec3(.93,.95,1.)*crater,mdisc*moonVis);

  // clouds: two layers at different distances, so they drift at different speeds
  vec2 sdir=normalize(uSun-vec2(.5,.45)+1e-3);
  vec4 c2=clouds(pv,asp,1.0,.012,5.,uCover*.9,sdir);
  col=mix(col,c2.rgb,c2.a*.8);
  vec4 c1=clouds(pv,asp,1.7,.02,0.,uCover,sdir);
  col=mix(col,c1.rgb,c1.a);
  // fog banks
  if(uFog>.01){
    float fn=fbm4(vec2(uv.x*asp*1.6+uShift.x*.012,uv.y*2.2));
    vec3 fogC=mix(vec3(.66,.69,.74),vec3(.16,.18,.24),uNight)*(.5+.5*uDay);
    col=mix(col,fogC,clamp(uFog*(.35+.65*fn)*(.55+.45*(1.-uv.y)),0.,.93));
  }
  // rain: fine streaks at three depths
  if(uRain>.01){
    float slant=-uWind.x*.4-.06;
    float r=rainLayer(pv,30.,4.6,1.,slant,asp,.05)*.55+rainLayer(pv,52.,3.8,3.,slant,asp,.032)*.6+rainLayer(pv,92.,3.0,7.,slant,asp,.022)*.5+rainLayer(pv,150.,2.4,11.,slant,asp,.016)*.35;
    // a soft mist that rises from the ground and thickens with the rain
    float mist=smoothstep(.55,0.,uv.y)*uRain*.1;
    col+=vec3(.82,.9,1.)*(r*(.22+.4*uDay)*(.5+.5*uRain)+mist*(.4+.6*uDay));
  }
  // snow: soft flakes, the big near ones out of focus
  if(uSnow>.01){
    float s=snowLayer(pv,22.,.5,1.,.22,.05,asp)*.5+snowLayer(pv,40.,.38,5.,.16,.15,asp)*.75+snowLayer(pv,80.,.28,9.,.12,.3,asp)*.8;
    col+=vec3(1.)*s*(.55+.45*uDay);
  }
  // leaves or petals
  if(uLeaves>.01){
    vec4 l1=leaves(pv,7.,.55,1.,asp),l2=leaves(pv,13.,.45,6.,asp);
    col=mix(col,l2.rgb*(.45+.55*uDay),l2.a*.6);
    col=mix(col,l1.rgb*(.5+.5*uDay),l1.a*.9);
  }
  // lightning: the clouds light up from inside
  if(uLight>.01){
    float g=exp(-distance((uv-vec2(uLightX,.72))*vec2(asp,1.),vec2(0.))*3.2);
    col+=vec3(.62,.7,1.)*uLight*(.16+.7*g)*(.3+.7*smoothstep(.1,.9,uv.y));
  }
  // a touch of dither so the gradients never band
  col+=(h21(gl_FragCoord.xy+uTime*60.)-.5)*(1./128.);
  col*=1.-.16*pow(length(uv-.5)*1.2,2.);
  gl_FragColor=vec4(col,1.);
}
`;

  // Sun and moon on the screen, and how much day, twilight and night there is, for a time at the place.
  function skyAt(tod, rise, set) {
    const L = set - rise, f = (tod - rise) / L;
    let e, sun;
    if (f >= 0 && f <= 1) { e = Math.sin(Math.PI * f); sun = [lerp(.1, .9, f), .14 + .62 * Math.sin(Math.PI * f)]; }
    else {
      const nl = 24 - L, nf = (((tod - set) + 24) % 24) / nl;
      e = -Math.sin(Math.PI * Math.min(1, nf)) * .6;
      sun = [lerp(.1, .9, f > 1 ? 1 + (f - 1) * .2 : f), -.2];
    }
    const nf = f > 1 ? (tod - set) / (24 - L) : f < 0 ? (tod + 24 - set) / (24 - L) : -1;
    const moon = nf >= 0 && nf <= 1 ? [lerp(.12, .88, nf), .16 + .58 * Math.sin(Math.PI * nf)] : [.5, -.3];
    return { sun, moon, day: sstep(-.12, .3, e), twi: Math.exp(-Math.pow(e / .2, 2)), night: 1 - sstep(-.2, .06, e) };
  }

  // Is the page itself dark? Read its own background, fall back to the browser preference.
  function pageIsDark() {
    const lum = (css) => {
      const m = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(css || '');
      if (!m) return null;
      if (m[4] !== undefined && +m[4] < 0.5) return null;
      return (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
    };
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      const l = lum(getComputedStyle(el).backgroundColor);
      if (l !== null) return l < 0.45;
    }
    // No opaque page colour to read (the page paints it on an inner element, or ours was cleared): ask the page's own theme.
    const root = document.documentElement;
    if (root.hasAttribute('data-hr-night')) return false; // our own light-text rule is on: the page underneath is light
    const cs = getComputedStyle(root).colorScheme || '';
    if (/\bdark\b/.test(cs) && !/\blight\b/.test(cs)) return true;
    if (/(^|\s)dark(\s|$)/.test(root.className || '') || /dark/i.test(root.getAttribute('data-theme') || root.getAttribute('data-color-mode') || '')) return true;
    if (document.body) {
      const tl = lum(getComputedStyle(document.body).color); // light text means a dark page
      if (tl !== null) return tl > 0.6;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // opts: { strength: 0.3..1, onLost() }. Returns null when WebGL is not available.
  function mount(opts = {}) {
    const doc = document, win = window;
    const canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('data-headroom', 'weather');
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '-1', pointerEvents: 'none', opacity: '0', transition: 'opacity 1.2s ease', background: 'transparent' });
    let gl = null;
    try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false }); } catch {}
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const U = {};
    for (let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) { const info = gl.getActiveUniform(prog, i); U[info.name] = gl.getUniformLocation(prog, info.name); }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pl = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(pl);
    gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
    // The sky sits BEHIND the page (z-index -1). For it to show, the page's own big opaque backgrounds
    // (the body and the full-screen wrappers) are made transparent while the weather is on, and put back
    // when it is turned off. Text, images and panels stay exactly as they are, on top of the sky.
    const rootEl = doc.documentElement;
    const alphaOf = (css) => { const n = (css || '').slice(css.indexOf('(') + 1, css.lastIndexOf(')')).split(/[ ,/]+/).filter(Boolean); return n.length > 3 ? +n[3] : 1; };
    let pageBg = null;
    for (const el of [doc.body, rootEl]) { if (!el) continue; const c = win.getComputedStyle(el).backgroundColor; if (c && alphaOf(c) >= .5) { pageBg = c; break; } }
    const rootPrev = [rootEl.style.getPropertyValue('background-color'), rootEl.style.getPropertyPriority('background-color')];
    rootEl.style.setProperty('background-color', pageBg || (pageIsDark() ? '#14141c' : '#ffffff'), 'important');
    // Marked elements lose their background (and any fade drawn by ::before / ::after) through one
    // stylesheet, so nothing is edited inline and everything comes back when the sheet is removed.
    const MARK = 'data-hr-sky';
    const sheet = doc.createElement('style');
    sheet.setAttribute('data-headroom', 'weather');
    sheet.textContent = ':root [' + MARK + '][' + MARK + ']{background-color:transparent !important;background-image:none !important}'
      + ':root [' + MARK + '][' + MARK + ']::before,:root [' + MARK + '][' + MARK + ']::after{background:none !important}'
      // night on a light page: flip the page dark; media is flipped back so it keeps its real colours
      + ':root[data-hr-night] body{filter:invert(1) hue-rotate(180deg)}'
      + ':root[data-hr-night] body img,:root[data-hr-night] body video,:root[data-hr-night] body picture,:root[data-hr-night] body canvas,:root[data-hr-night] body [style*="background-image"]{filter:invert(1) hue-rotate(180deg)}';
    (doc.head || rootEl).appendChild(sheet);
    const marked = new Set();
    const isBacking = (cs) => alphaOf(cs.backgroundColor) >= .9 || (cs.backgroundImage || '').indexOf('gradient') >= 0;
    function clearBackdrops() {
      if (destroyed || !doc.body) return;
      const vw = win.innerWidth, vh = win.innerHeight;
      const all = doc.body.querySelectorAll('*');
      const n = Math.min(all.length, 6000);
      for (let i = -1; i < n; i++) {
        const el = i < 0 ? doc.body : all[i]; // the body itself is often what paints the page colour
        if (marked.has(el) || el === canvas || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        // a page backdrop: most of the screen, or a bar across it (header, sidebar, the strip round the composer)
        if (!(r.width * r.height >= vw * vh * .5 || r.width >= vw * .85 || r.height >= vh * .85)) continue;
        const cs = win.getComputedStyle(el);
        if (cs.display === 'none') continue;
        if (isBacking(cs) || isBacking(win.getComputedStyle(el, '::before')) || isBacking(win.getComputedStyle(el, '::after'))) {
          marked.add(el); el.setAttribute(MARK, '');
        }
      }
    }
    const restoreBackdrops = () => {
      for (const el of marked) el.removeAttribute(MARK);
      marked.clear();
      rootEl.removeAttribute('data-hr-night');
      sheet.remove();
      if (rootPrev[0]) rootEl.style.setProperty('background-color', rootPrev[0], rootPrev[1]); else rootEl.style.removeProperty('background-color');
    };
    const maskTimer = win.setInterval(clearBackdrops, 1500);
    (doc.documentElement).appendChild(canvas);

    const reduceMq = win.matchMedia('(prefers-reduced-motion: reduce)');
    let W = 0, H = 0, raf = 0, last = 0, destroyed = false, lost = false;
    let strength = clamp(opts.strength == null ? 1 : opts.strength, .2, 1);
    let dark = pageIsDark();
    let tone = null;

    // Current values ease toward the targets over a few seconds, so a change in the weather never pops.
    const S = { cover: .1, gloom: 0, rain: 0, snow: 0, fog: 0, leaves: 0, kind: 0, wind: .25, windX: .5, windY: 0, light: 0, lightX: .5, tint: [1, 1, 1] };
    let tg = AM.WEATHER.targetsFor('clear', 'summer');
    let cur = { tod: 12, rise: 6.3, set: 18.4, fixedTod: false, t0: performance.now(), weather: 'clear', season: 'summer', wind: .25, windX: .5, windY: 0 };
    let boltNext = 3, first = true, shX = 0, shY = 0;

    const resize = () => {
      // drawn at the screen's real pixels (so stars, moon and rain edges are crisp), capped near 3.4 million pixels so a big or high-DPI screen stays light on the GPU
      const dpr = Math.min(2, win.devicePixelRatio || 1);
      const k = Math.max(.6, Math.min(dpr, Math.sqrt(3.4e6 / Math.max(1, win.innerWidth * win.innerHeight))));
      const w = Math.max(2, Math.round(win.innerWidth * k)), h = Math.max(2, Math.round(win.innerHeight * k));
      if (w === W && h === H) return;
      W = w; H = h; canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H);
    };

    // A light page at night gets the real night sky, and the page is flipped to a dark look (the usual invert + hue-rotate
    // trick, with images, video and canvases flipped back so photos keep their colours). It is only used when the page itself
    // does not scroll, because a filter on <body> would move the fixed parts of a page that scrolls as a whole.
    let pure = false, lastNight = 0, noPure = false;
    const docScrolls = () => rootEl.scrollHeight > win.innerHeight + 4;
    function setPure(on) {
      if (on === pure) return;
      pure = on;
      if (on) { rootEl.setAttribute('data-hr-night', ''); clearBackdrops(); }
      else rootEl.removeAttribute('data-hr-night');
      lastOp = -1; setOpacity(lastNight);
    }
    const keepTimer = win.setInterval(() => { if (pure && docScrolls()) { noPure = true; setPure(false); } }, 1500);

    let lastOp = -1;
    function setOpacity(night) {
      lastNight = night;
      if (!dark && (night > .55 && !pure && !noPure && !docScrolls() || night < .4 && pure)) { setPure(night > .55); return; }
      const deep = dark || pure;
      const o = strength * (deep ? .92 : 1 - .68 * night);
      if (Math.abs(o - lastOp) > .01) {
        lastOp = o; canvas.style.opacity = String(o);
        // dusk and dawn on a light page: lift the sky to a soft tone so the dark text stays readable
        canvas.style.filter = deep ? 'brightness(.9)' : night > .02 ? 'brightness(' + (1 + 2.2 * night).toFixed(2) + ') saturate(.8)' : 'none';
      }
    }
    function applyTone() {
      const t = dark ? 'dark' : 'light';
      if (t === tone) return;
      tone = t;
      if (dark && pure) setPure(false);
      canvas.style.mixBlendMode = 'normal';
      lastOp = -1;
      setOpacity(lastNight || 1);
    }

    function setState(st) {
      tg = AM.WEATHER.targetsFor(st.weather, st.season);
      cur = { tod: st.tod, rise: st.rise, set: st.set, fixedTod: !st.live, t0: performance.now(), weather: st.weather, season: st.season, wind: st.wind, windX: st.windX, windY: st.windY };
      if (first) { // the very first state is shown at once; later ones ease in
        first = false;
        for (const k of ['cover', 'gloom', 'rain', 'snow', 'fog', 'leaves']) S[k] = tg[k];
        S.kind = tg.kind; S.tint = tg.tint.slice(); S.wind = st.wind; S.windX = st.windX; S.windY = st.windY;
      }
      if (reduceMq.matches || !raf) frame(performance.now(), .05);
    }
    function setStrength(v) { strength = clamp(v, .2, 1); tone = null; applyTone(); }

    function frame(now, dt) {
      const k = 1 - Math.exp(-dt / 5);
      for (const key of ['cover', 'gloom', 'rain', 'snow', 'fog', 'leaves']) S[key] = lerp(S[key], tg[key], k);
      S.kind = tg.kind;
      S.tint = S.tint.map((v, i) => lerp(v, tg.tint[i], k));
      const wk = 1 - Math.exp(-dt * 2);
      S.wind = lerp(S.wind, cur.wind, wk); S.windX = lerp(S.windX, cur.windX, wk); S.windY = lerp(S.windY, cur.windY, wk);
      S.light *= Math.exp(-dt * 8);
      if (tg.thunder) {
        boltNext -= dt;
        if (boltNext <= 0) { S.light = 1; S.lightX = .12 + Math.random() * .76; boltNext = 3 + Math.random() * 6; win.setTimeout(() => { S.light = Math.max(S.light, .75); }, 130); }
      }
      const wx = S.windX * 2.2;
      shX += wx * dt; shY += S.windY * dt;
      const tod = cur.fixedTod ? cur.tod : (cur.tod + (now - cur.t0) / 3.6e6) % 24; // the hour moves on in real time
      const sk = skyAt(tod, cur.rise, cur.set);
      const f1 = (n, v) => U[n] != null && gl.uniform1f(U[n], v);
      gl.uniform2f(U.uRes, W, H); f1('uTime', now / 1000);
      gl.uniform2f(U.uSun, sk.sun[0], sk.sun[1]); gl.uniform2f(U.uMoon, sk.moon[0], sk.moon[1]);
      setOpacity(sk.night);
      f1('uDay', sk.day); f1('uTwi', sk.twi); f1('uNight', sk.night);
      f1('uCover', S.cover); f1('uGloom', S.gloom); f1('uRain', S.rain); f1('uSnow', S.snow); f1('uFog', S.fog);
      f1('uLight', S.light); f1('uLightX', S.lightX); f1('uLeaves', S.leaves); f1('uLeafKind', S.kind);
      gl.uniform2f(U.uWind, wx, S.windY); gl.uniform2f(U.uShift, shX, shY);
      gl.uniform3f(U.uSeasonTint, S.tint[0], S.tint[1], S.tint[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function tick(now) {
      raf = 0;
      if (destroyed || lost) return;
      if (now - last >= 33) { // 30 frames a second is plenty for a sky
        const dt = last ? Math.min(.1, (now - last) / 1000) : .033;
        last = now;
        frame(now, dt);
      }
      raf = win.requestAnimationFrame(tick);
    }
    const start = () => { if (!raf && !destroyed && !lost && !doc.hidden && !reduceMq.matches) raf = win.requestAnimationFrame(tick); };
    const stop = () => { if (raf) { win.cancelAnimationFrame(raf); raf = 0; } };

    const onVis = () => (doc.hidden ? stop() : start());
    const onMotion = () => { if (reduceMq.matches) { stop(); frame(performance.now(), .05); } else start(); };
    const onLost = (e) => { e.preventDefault(); lost = true; stop(); if (opts.onLost) opts.onLost(); };
    win.addEventListener('resize', clearBackdrops);
    win.addEventListener('resize', resize);
    doc.addEventListener('visibilitychange', onVis);
    reduceMq.addEventListener('change', onMotion);
    canvas.addEventListener('webglcontextlost', onLost);
    const toneTimer = win.setInterval(() => { const d = pageIsDark(); if (d !== dark) { dark = d; tone = null; applyTone(); } }, 2000);

    resize();
    applyTone();
    clearBackdrops();
    canvas.style.opacity = '0';
    win.requestAnimationFrame(() => { lastOp = -1; setOpacity(0); });
    start();

    return {
      setState, setStrength,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stop();
        win.clearInterval(toneTimer);
        win.clearInterval(maskTimer); win.clearInterval(keepTimer); win.removeEventListener('resize', clearBackdrops); restoreBackdrops();
        win.removeEventListener('resize', resize);
        doc.removeEventListener('visibilitychange', onVis);
        reduceMq.removeEventListener('change', onMotion);
        canvas.removeEventListener('webglcontextlost', onLost);
        const ext = gl.getExtension('WEBGL_lose_context');
        canvas.remove();
        if (ext) ext.loseContext();
      },
      canvas,
    };
  }

  AM.WeatherSky = { mount, skyAt, pageIsDark };
})();
