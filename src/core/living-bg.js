// Living background engine.
//
// A theme draws a full scene (koi pond, butterfly garden, firefly night, ...) onto an off-screen 2D canvas.
// This engine then shows that scene through a real water surface: a small wave simulation (height field)
// whose slope bends the picture (refraction, with a touch of colour split) and catches the light (specular
// glints). Clicks and swimming fish disturb the surface, so ripples spread, bounce off the edges and fade,
// like real water. If WebGL is not available the scene is drawn straight to the page without the ripples.
//
// Themes register themselves: AM.Living.themes.<name> = (o) => scene, where `o` is
//   { canvas, W, H, dpr, onWake(x, y, strength), onDrop(x, y, strength) }
// and a scene is { advance(dt), poke(x, y), resize(W, H, dpr), params, dark, destroy?() }.
// No dependencies, no inline script, nothing leaves the tab.
(() => {
  const AM = (globalThis.Headroom = globalThis.Headroom || { adapters: [] });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const VERT = 'attribute vec2 p;varying vec2 v;void main(){v=p*0.5+0.5;gl_Position=vec4(p,0.0,1.0);}';
  const FRAG = `precision mediump float;
varying vec2 v;
uniform sampler2D uScene;
uniform sampler2D uWave;
uniform float uRefr;
uniform float uSpec;
uniform float uShade;
uniform vec3 uTint;
void main(){
  vec4 w = texture2D(uWave, v);
  vec2 n = (w.xy - 0.5) * 2.0;
  float h = (w.z - 0.5) * 2.0;
  vec2 off = n * uRefr;
  vec3 col;
  col.r = texture2D(uScene, clamp(v + off * 1.10, 0.0, 1.0)).r;
  col.g = texture2D(uScene, clamp(v + off, 0.0, 1.0)).g;
  col.b = texture2D(uScene, clamp(v + off * 0.90, 0.0, 1.0)).b;
  vec3 N = normalize(vec3(-n * 2.6, 1.0));
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(N, H), 0.0), 70.0) * uSpec;
  float rim = pow(clamp(length(n), 0.0, 1.0), 1.5);
  col *= 1.0 + h * uShade;
  col += uTint * spec + uTint * rim * 0.06 * uSpec;
  gl_FragColor = vec4(col, 1.0);
}`;

  // Size of the page canvas in CSS pixels, and a pixel ratio that keeps big screens affordable.
  function size() {
    const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    while (dpr > 1 && W * H * dpr * dpr > 3.4e6) dpr -= 0.25;
    return { W, H, dpr: Math.max(1, dpr) };
  }

  // Whether the page itself is dark: read its own background, fall back to the browser preference.
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
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Where is the reading on this page? Boxes of text, inputs and buttons in view, so creatures can keep clear of them.
  const TEXT_SEL = 'iframe,p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,td,th,label,summary,textarea,input,button,a,[contenteditable="true"],[role="textbox"]';
  const FIELD_SEL = 'iframe,textarea,input,[contenteditable="true"],[role="textbox"]';
  function textBoxes() {
    const out = [];
    const vw = window.innerWidth, vh = window.innerHeight;
    const els = document.querySelectorAll(TEXT_SEL);
    for (let i = 0; i < els.length && out.length < 260; i++) {
      const el = els[i];
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      if (el.closest('[data-headroom]')) continue;
      if (!el.matches(FIELD_SEL) && !(el.textContent || '').trim()) continue;
      out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    return out;
  }
  // Is (x, y) inside any box grown by `margin`? If so, the way out: a unit direction and how deep the point is.
  function avoid(x, y, margin, obs) {
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (x > o.l - margin && x < o.r + margin && y > o.t - margin && y < o.b + margin) {
        const dl = x - (o.l - margin), dr = o.r + margin - x, dt = y - (o.t - margin), db = o.b + margin - y;
        const m = Math.min(dl, dr, dt, db);
        if (m === dl) return { x: -1, y: 0, d: m };
        if (m === dr) return { x: 1, y: 0, d: m };
        if (m === dt) return { x: 0, y: -1, d: m };
        return { x: 0, y: 1, d: m };
      }
    }
    return null;
  }

  function mount(opts = {}) {
    const doc = document, win = window;
    const parent = opts.parent || doc.documentElement;
    const themes = AM.Living.themes;
    const reduceMq = win.matchMedia('(prefers-reduced-motion: reduce)');
    // overlay: draw only the creatures on a see-through canvas over the page (no water surface, no refraction)
    // blend: 'auto' draws the whole scene over the page with a blend mode picked from the page's own colours
    // (multiply on light pages, screen on dark ones), so the scene reads as sitting behind the text.
    let overlay = !!opts.overlay;
    const blend = opts.blend === 'auto';
    let tone = blend && pageIsDark() ? 'dark' : blend ? 'light' : 'dark';

    const canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('data-headroom', 'living-bg');
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: overlay || blend ? '2147483000' : '0', pointerEvents: 'none', background: overlay ? 'transparent' : '#000', opacity: overlay ? '0.92' : '1' });
    const applyBlend = () => {
      if (!blend || overlay) return;
      canvas.style.mixBlendMode = tone === 'dark' ? 'screen' : 'multiply';
      canvas.style.opacity = tone === 'dark' ? '0.82' : '0.9';
    };
    applyBlend();
    parent.appendChild(canvas);

    let scene = overlay ? canvas : doc.createElement('canvas'); // the theme draws here
    let gl = null, ctx2d = null;
    if (!overlay) try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true }); } catch {}
    if (!gl && !overlay) {
      if (blend) { // no WebGL: fall back to the creatures alone, on a see-through canvas
        overlay = true; scene = canvas;
        canvas.style.background = 'transparent'; canvas.style.mixBlendMode = 'normal'; canvas.style.opacity = '0.92';
      } else ctx2d = canvas.getContext('2d');
    }

    let prog, texScene, texWave, loc = {};
    if (gl) {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const pl = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(pl);
      gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
      const mk = () => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      };
      texScene = mk(); texWave = mk();
      for (const n of ['uScene', 'uWave', 'uRefr', 'uSpec', 'uShade', 'uTint']) loc[n] = gl.getUniformLocation(prog, n);
      gl.uniform1i(loc.uScene, 0);
      gl.uniform1i(loc.uWave, 1);
    }

    // ---- wave simulation (height field, damped wave equation) -----------------------------------
    const GW = 220;
    let GH = 140, h0 = new Float32Array(1), h1 = new Float32Array(1), wavePix = new Uint8Array(4);
    let acc = 0;
    const initWave = (W, H) => {
      GH = Math.max(8, Math.round((GW * H) / W));
      h0 = new Float32Array(GW * GH);
      h1 = new Float32Array(GW * GH);
      wavePix = new Uint8Array(GW * GH * 4);
    };
    function disturb(x, y, amp, radius = 3) {
      const gx = (x / W) * GW, gy = (y / H) * GH;
      const r = Math.ceil(radius * 2.2);
      for (let j = -r; j <= r; j++) {
        for (let i = -r; i <= r; i++) {
          const cx = Math.round(gx) + i, cy = Math.round(gy) + j;
          if (cx < 1 || cy < 1 || cx >= GW - 1 || cy >= GH - 1) continue;
          const d2 = (cx - gx) * (cx - gx) + (cy - gy) * (cy - gy);
          h1[cy * GW + cx] += amp * Math.exp(-d2 / (radius * radius));
        }
      }
    }
    function simulate(damp) {
      for (let y = 1; y < GH - 1; y++) {
        for (let x = 1; x < GW - 1; x++) {
          const i = y * GW + x;
          h0[i] = ((h1[i - 1] + h1[i + 1] + h1[i - GW] + h1[i + GW]) * 0.5 - h0[i]) * damp;
        }
      }
      const t = h0; h0 = h1; h1 = t;
    }
    function encodeWave() {
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
          const i = y * GW + x;
          const l = x > 0 ? h1[i - 1] : h1[i], r = x < GW - 1 ? h1[i + 1] : h1[i];
          const u = y > 0 ? h1[i - GW] : h1[i], d = y < GH - 1 ? h1[i + GW] : h1[i];
          const o = ((GH - 1 - y) * GW + x) * 4; // flipped to match the scene texture
          wavePix[o] = clamp(128 + (r - l) * 90, 0, 255);
          wavePix[o + 1] = clamp(128 - (d - u) * 90, 0, 255);
          wavePix[o + 2] = clamp(128 + h1[i] * 60, 0, 255);
          wavePix[o + 3] = 255;
        }
      }
    }

    // ---- theme + frame loop ---------------------------------------------------------------------
    let W = 1, H = 1, dpr = 1;
    let current = null, name = '', params = { refr: 0.01, spec: 0.8, damp: 0.992, shade: 0.35, tint: [1, 1, 1] };
    let raf = 0, last = 0, destroyed = false, ringQueue = [];
    let obstacles = [];

    function resize() {
      const s = size();
      if (s.W === W && s.H === H && s.dpr === dpr && current) return;
      W = s.W; H = s.H; dpr = s.dpr;
      scene.width = canvas.width = Math.max(1, Math.round(W * dpr));
      scene.height = canvas.height = Math.max(1, Math.round(H * dpr));
      initWave(W, H);
      if (current) current.resize(W, H, dpr);
      if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function setTheme(n) {
      if (!themes[n]) n = Object.keys(themes)[0];
      if (current && current.destroy) current.destroy();
      name = n;
      const s = size();
      W = 0; H = 0; // force resize() to size the canvases and the wave grid
      current = null;
      const mkScene = themes[n];
      resize.pending = true;
      W = s.W; H = s.H; dpr = s.dpr;
      scene.width = canvas.width = Math.max(1, Math.round(W * dpr));
      scene.height = canvas.height = Math.max(1, Math.round(H * dpr));
      initWave(W, H);
      if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
      current = mkScene({
        canvas: scene, W, H, dpr,
        overlay, tone, blend,
        onWake: overlay ? null : (x, y, k) => disturb(x, y, -0.07 * k, 1.8),
        onDrop: overlay ? null : (x, y, k) => disturb(x, y, -0.9 * k, 2.4),
      });
      current.resize(W, H, dpr);
      params = Object.assign({ refr: 0.01, spec: 0.8, damp: 0.992, shade: 0.35, tint: [1, 1, 1] }, current.params || {});
      ringQueue = [];
      if (current.setObstacles) current.setObstacles(obstacles);
      if (opts.onTheme) opts.onTheme(n, current);
    }

    function render() {
      if (destroyed || !current || overlay) return;
      if (gl) {
        encodeWave();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texScene);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texWave);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, wavePix);
        gl.uniform1f(loc.uRefr, params.refr);
        gl.uniform1f(loc.uSpec, params.spec);
        gl.uniform1f(loc.uShade, params.shade);
        gl.uniform3f(loc.uTint, params.tint[0], params.tint[1], params.tint[2]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        ctx2d.drawImage(scene, 0, 0);
      }
    }

    function advance(dt) {
      if (!current) return;
      current.advance(dt);
      // delayed echo rings after a click
      for (const r of ringQueue) r.t -= dt;
      for (const r of ringQueue.filter((q) => q.t <= 0)) disturb(r.x, r.y, r.amp, r.rad);
      ringQueue = ringQueue.filter((q) => q.t > 0);
      if (overlay) return;
      acc += dt;
      let steps = 0;
      while (acc >= 1 / 60 && steps < 4) { simulate(params.damp); acc -= 1 / 60; steps++; }
      if (acc > 0.1) acc = 0;
      render();
    }

    function poke(x, y) {
      if (!current) return;
      if (!overlay) disturb(x, y, -2.6, 2.6);
      if (!overlay) ringQueue.push({ t: 0.09, x, y, amp: 1.5, rad: 4.2 }, { t: 0.22, x, y, amp: -0.9, rad: 5.8 });
      current.poke(x, y);
    }

    function tick(now) {
      raf = 0;
      if (destroyed) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      advance(dt);
      raf = win.requestAnimationFrame(tick);
    }
    const start = () => { if (!raf && !destroyed && !opts.manual && !doc.hidden && !reduceMq.matches) { last = 0; raf = win.requestAnimationFrame(tick); } };
    const stop = () => { if (raf) { win.cancelAnimationFrame(raf); raf = 0; } };

    const onDown = (e) => { if (!reduceMq.matches) poke(e.clientX, e.clientY); };
    const onVis = () => (doc.hidden ? stop() : start());
    const onMotion = () => { if (reduceMq.matches) { stop(); render(); } else start(); };
    const onResize = () => { resize(); if (!raf) render(); };
    const toneTimer = blend && !overlay ? win.setInterval(() => {
      const t = pageIsDark() ? 'dark' : 'light';
      if (t !== tone) { tone = t; applyBlend(); setTheme(name); }
    }, 1500) : 0;
    // Keep creatures off the text: rescan now and then, and while the page scrolls.
    let scanTimer = 0, scrollWait = 0;
    const scan = () => {
      if (doc.hidden || destroyed) return;
      obstacles = textBoxes();
      if (current && current.setObstacles) current.setObstacles(obstacles);
    };
    const onScroll = () => { if (!scrollWait) scrollWait = win.setTimeout(() => { scrollWait = 0; scan(); }, 120); };
    if (opts.avoidText) {
      scanTimer = win.setInterval(scan, 700);
      win.addEventListener('scroll', onScroll, { passive: true, capture: true });
      scan();
    }
    win.addEventListener('pointerdown', onDown, { passive: true, capture: true });
    win.addEventListener('resize', onResize);
    doc.addEventListener('visibilitychange', onVis);
    reduceMq.addEventListener('change', onMotion);

    setTheme(opts.theme || 'koi');
    for (let i = 0; i < 60; i++) advance(1 / 30); // settle before the first frame
    start();

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      if (toneTimer) win.clearInterval(toneTimer);
      if (scanTimer) { win.clearInterval(scanTimer); win.removeEventListener('scroll', onScroll, { capture: true }); }
      win.removeEventListener('pointerdown', onDown, { capture: true });
      win.removeEventListener('resize', onResize);
      doc.removeEventListener('visibilitychange', onVis);
      reduceMq.removeEventListener('change', onMotion);
      if (current && current.destroy) current.destroy();
      canvas.remove();
    }

    return { setTheme, advance, poke, destroy, canvas, get theme() { return name; }, themes: () => Object.keys(themes) };
  }

  // Injected once per theme: keep what an earlier injection registered.
  if (!AM.Living) AM.Living = { themes: {}, size, mount, pageIsDark, avoid };
})();
