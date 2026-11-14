// Animated ASCII-art creature background for extension pages (popup).
//
// Zero dependencies, no inline script: load this file with a <script src> and call
//   const bg = AIMeter.AsciiBg.mount({ preset: 'mixed' });
//   bg.setPreset('koi');
//   bg.destroy();
//
// Draws onto one full-viewport <canvas> behind the UI (pointer-events: none). Clicks are read from
// `window` so every foreground control stays clickable; a click pushes nearby creatures away from the
// cursor, and they ease back to their normal wandering speed.
(() => {
  const AM = (globalThis.AIMeter = globalThis.AIMeter || {});

  const PRESETS = ['mixed', 'koi', 'butterflies', 'ambient'];
  const FONT_PX = 10;
  const LINE_H = 11;
  const FONT = `${FONT_PX}px ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`;
  const TAU = Math.PI * 2;

  // Scatter physics.
  const BLAST_RADIUS = 150; // px around the click that feels the push
  const BLAST_FORCE = 300; // px/s added at the centre of the push
  const IMPULSE_DAMP = 2.4; // 1/s, how fast the push wears off
  const SPIN_DAMP = 2.8; // 1/s, how fast the spin from a push wears off
  const ROT_RETURN = 1.6; // 1/s, how fast a creature turns back upright

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const angleDiff = (a, b) => {
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };

  // ---- palettes --------------------------------------------------------------------------------
  const KOI_LIGHT = { orange: '#f97316', red: '#dc2626', gold: '#d99a06', pale: '#b9ab98', ember: '#c2410c' };
  const KOI_DARK = { orange: '#fb923c', red: '#ef4444', gold: '#fbbf24', pale: '#f5ede0', ember: '#ea580c' };
  // [base, patch] pairs: kohaku, ogon, showa-ish, chagoi-ish, tancho-ish.
  const KOI_SCHEMES = [['pale', 'red'], ['gold', 'orange'], ['orange', 'pale'], ['red', 'pale'], ['pale', 'gold'], ['ember', 'gold']];
  const WING_COLORS = ['#ef4444', '#f97316', '#dc2626', '#fb923c', '#ea580c'];
  const GREENS_LIGHT = ['#16a34a', '#15803d', '#22c55e', '#65a30d', '#059669'];
  const GREENS_DARK = ['#22c55e', '#4ade80', '#16a34a', '#84cc16', '#10b981'];

  // ---- shapes (keyboard characters only) -------------------------------------------------------
  // Koi face +x (head on the right). Row 0 is the dorsal fin, row 1 the body; the tail characters
  // cycle to wag.
  const KOI_TAILS = ['><', '>=', '>-', '>='];
  const KOI_BODY = "((((o>";
  const KOI_FIN = '   ,_   ';

  // Butterfly wing-flap cycle: open, half, folded, half.
  const FLY_FRAMES = [
    ['(\\ /)', ' )o( ', '(/ \\)'],
    [' \\ / ', ' (o) ', ' / \\ '],
    ['  V  ', ' |o| ', '  ^  '],
    [' \\ / ', ' (o) ', ' / \\ '],
  ];

  const AMBIENT_GLYPHS = [
    ['+'], ['*'], ['o'], ['~'], ['<>'], ['{ }'], ['[+]'], ['/\\'], ['::'], ['.:.'], ['^'], ['#'],
    ['%'], ['()'], ['x'], ['~~'], ['<*>'], ['-|-'], ['{*}'], [' ,', '\\|/'], ['/\\', '\\/'],
  ];

  // ---- creature factories ----------------------------------------------------------------------
  function makeKoi(W, H) {
    const scheme = pick(KOI_SCHEMES);
    // Body characters get the base colour or a patch, picked once per fish.
    const bodyKeys = [...KOI_BODY].map((ch, i) => (ch === '>' || ch === 'o' ? scheme[0] : Math.random() < 0.45 ? scheme[1] : scheme[0]));
    return {
      kind: 'koi',
      x: rand(0, W), y: rand(0, H),
      heading: rand(0, TAU),
      speed: rand(16, 26),
      turnFreq: rand(0.25, 0.55), turnPhase: rand(0, TAU), turnAmp: rand(0.35, 0.7),
      ix: 0, iy: 0, spin: 0, rot: 0,
      phase: rand(0, TAU),
      wag: rand(5, 8),
      alpha: rand(0.75, 1),
      scheme, bodyKeys,
      radius: 26,
    };
  }

  function makeButterfly(W, H) {
    return {
      kind: 'fly',
      x: rand(0, W), y: rand(0, H),
      heading: rand(0, TAU),
      speed: rand(12, 20),
      turnFreq: rand(0.5, 1.1), turnPhase: rand(0, TAU), turnAmp: rand(0.8, 1.5),
      ix: 0, iy: 0, spin: 0, rot: 0,
      phase: rand(0, TAU),
      flapRate: rand(5, 7.5), // frames per second
      frameClock: rand(0, 4),
      bob: rand(0, TAU),
      alpha: rand(0.75, 1),
      wing: pick(WING_COLORS), wing2: pick(WING_COLORS),
      radius: 18,
    };
  }

  function makeAmbient(W, H) {
    return {
      kind: 'ambient',
      x: rand(0, W), y: rand(0, H),
      heading: rand(0, TAU),
      speed: rand(5, 12),
      turnFreq: rand(0.1, 0.3), turnPhase: rand(0, TAU), turnAmp: rand(0.15, 0.4),
      ix: 0, iy: 0, spin: 0, rot: 0,
      drift: rand(-0.35, 0.35), // slow idle spin, rad/s
      angle: rand(0, TAU),
      phase: rand(0, TAU),
      alpha: rand(0.45, 0.85),
      glyph: pick(AMBIENT_GLYPHS),
      colorIdx: (Math.random() * GREENS_DARK.length) | 0,
      radius: 12,
    };
  }

  // How many of each kind to show, scaled to the visible area (a 360x480 popup is the reference).
  function population(preset, W, H) {
    const s = Math.max(0.5, Math.min(2.5, (W * H) / (360 * 480)));
    const n = (x) => Math.max(1, Math.round(x * s));
    switch (preset) {
      case 'koi': return { koi: n(6), fly: 0, ambient: 0 };
      case 'butterflies': return { koi: 0, fly: n(7), ambient: 0 };
      case 'ambient': return { koi: 0, fly: 0, ambient: n(22) };
      default: return { koi: n(3), fly: n(3), ambient: n(10) };
    }
  }

  // ---- engine ----------------------------------------------------------------------------------
  function mount(opts = {}) {
    const doc = document;
    const win = window;
    const parent = opts.parent || doc.body;
    let preset = PRESETS.includes(opts.preset) ? opts.preset : 'mixed';

    const canvas = doc.createElement('canvas');
    canvas.className = 'ascii-bg';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'fixed', inset: '0', zIndex: '0', pointerEvents: 'none', width: '100%', height: '100%' });
    parent.prepend(canvas);
    const ctx = canvas.getContext('2d');

    const reduceMq = win.matchMedia('(prefers-reduced-motion: reduce)');
    const darkMq = win.matchMedia('(prefers-color-scheme: dark)');

    let W = 0, H = 0, dpr = 1, cw = 6;
    let creatures = [];
    let ripples = [];
    let raf = 0;
    let last = 0;
    let clock = 0;
    let destroyed = false;
    let accent = '#9a80e0';

    const readTheme = () => {
      const v = getComputedStyle(doc.documentElement).getPropertyValue('--accent').trim();
      if (v) accent = v;
    };

    function resize() {
      const w = win.innerWidth, h = win.innerHeight;
      const d = win.devicePixelRatio || 1;
      if (w === W && h === H && d === dpr) return;
      W = w; H = h; dpr = d;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = FONT;
      cw = ctx.measureText('M').width || 6;
      populate(false);
      if (!raf) drawFrame(0);
    }

    // Top up or trim each kind to the target count; `reset` starts over (used on preset change).
    function populate(reset) {
      if (!W || !H) return;
      if (reset) creatures = [];
      const want = population(preset, W, H);
      const make = { koi: makeKoi, fly: makeButterfly, ambient: makeAmbient };
      for (const kind of Object.keys(want)) {
        const have = creatures.filter((c) => c.kind === kind);
        for (let i = have.length; i < want[kind]; i++) creatures.push(make[kind](W, H));
        if (have.length > want[kind]) {
          const drop = new Set(have.slice(want[kind]));
          creatures = creatures.filter((c) => !drop.has(c));
        }
      }
      // Draw slow ambient shapes first so fish and butterflies sit on top of them.
      const order = { ambient: 0, koi: 1, fly: 2 };
      creatures.sort((a, b) => order[a.kind] - order[b.kind]);
    }

    function step(c, dt) {
      // Wander: the turn rate itself drifts along two slow sines, which gives smooth curved paths.
      const turn = Math.sin(clock * c.turnFreq + c.turnPhase) * c.turnAmp
        + Math.sin(clock * c.turnFreq * 0.37 + c.turnPhase * 2) * c.turnAmp * 0.6;
      c.heading += turn * dt;

      // Steer gently back toward the middle when close to an edge.
      const margin = Math.min(48, W * 0.15, H * 0.15);
      const near = Math.max(
        (margin - c.x) / margin, (c.x - (W - margin)) / margin,
        (margin - c.y) / margin, (c.y - (H - margin)) / margin, 0,
      );
      if (near > 0) {
        const home = Math.atan2(H / 2 - c.y + rand(-20, 20), W / 2 - c.x + rand(-20, 20));
        c.heading += angleDiff(home, c.heading) * Math.min(1, near) * 2.2 * dt;
      }

      const vx = Math.cos(c.heading) * c.speed + c.ix;
      const vy = Math.sin(c.heading) * c.speed + c.iy;
      c.x += vx * dt;
      c.y += vy * dt;

      // While a push dominates, fish turn to face where they are being carried.
      const push = Math.hypot(c.ix, c.iy);
      if (c.kind === 'koi' && push > c.speed) {
        c.heading += angleDiff(Math.atan2(vy, vx), c.heading) * Math.min(1, dt * 5);
      }

      const k = Math.exp(-IMPULSE_DAMP * dt);
      c.ix *= k; c.iy *= k;
      if (Math.abs(c.ix) < 0.01) c.ix = 0;
      if (Math.abs(c.iy) < 0.01) c.iy = 0;
      c.rot += c.spin * dt;
      c.spin *= Math.exp(-SPIN_DAMP * dt);
      c.rot *= Math.exp(-ROT_RETURN * dt);

      if (c.kind === 'fly') c.frameClock += dt * c.flapRate * (1 + push / 70);
      if (c.kind === 'ambient') c.angle += c.drift * dt;

      // Anything flung past the edge comes back on the other side.
      const pad = c.radius + 8;
      if (c.x < -pad) c.x = W + pad;
      else if (c.x > W + pad) c.x = -pad;
      if (c.y < -pad) c.y = H + pad;
      else if (c.y > H + pad) c.y = -pad;
    }

    function drawLines(lines, colorAt, yOffsetAt) {
      const rows = lines.length;
      for (let r = 0; r < rows; r++) {
        const line = lines[r];
        const x0 = -((line.length - 1) * cw) / 2;
        const y = (r - (rows - 1) / 2) * LINE_H;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === ' ') continue;
          ctx.fillStyle = colorAt(r, i, ch);
          ctx.fillText(ch, x0 + i * cw, y + (yOffsetAt ? yOffsetAt(r, i, line.length) : 0));
        }
      }
    }

    function drawKoi(c, dark) {
      const pal = dark ? KOI_DARK : KOI_LIGHT;
      const tail = KOI_TAILS[Math.floor(clock * c.wag * 0.6 + c.phase) % KOI_TAILS.length];
      const body = tail + KOI_BODY;
      ctx.rotate(c.heading + c.rot);
      // Keep fish swimming left the right way up by mirroring across their spine.
      if (Math.cos(c.heading) < 0) ctx.scale(1, -1);
      const t = clock * c.wag + c.phase;
      drawLines(
        [KOI_FIN, body],
        (r, i) => {
          if (r === 0) return pal[c.scheme[1]];
          if (i < tail.length) return pal[c.scheme[1]];
          return pal[c.bodyKeys[i - tail.length]];
        },
        // Wag: the tail end swings most, the head barely moves.
        (r, i, len) => Math.sin(t - i * 0.8) * 1.6 * Math.pow(1 - i / len, 1.5),
      );
    }

    function drawButterfly(c, dark) {
      const frame = FLY_FRAMES[Math.floor(c.frameClock) % FLY_FRAMES.length];
      const vx = Math.cos(c.heading) * c.speed + c.ix;
      const tilt = Math.sin(clock * 1.7 + c.bob) * 0.12 + Math.max(-0.35, Math.min(0.35, vx / 120));
      ctx.translate(0, Math.sin(clock * 3 + c.bob) * 1.5);
      ctx.rotate(tilt + c.rot);
      const body = dark ? '#fcd34d' : '#92400e';
      drawLines(frame, (r, i, ch) => (ch === 'o' ? body : r === 1 ? c.wing2 : c.wing));
    }

    function drawAmbient(c, dark) {
      const greens = dark ? GREENS_DARK : GREENS_LIGHT;
      ctx.globalAlpha *= 0.7 + 0.3 * Math.sin(clock * 0.9 + c.phase);
      ctx.rotate(c.angle + c.rot);
      const color = greens[c.colorIdx];
      drawLines(c.glyph, () => color);
    }

    function drawRipples(dark) {
      const life = 0.65;
      ripples = ripples.filter((r) => clock - r.t < life);
      ctx.fillStyle = accent;
      for (const rp of ripples) {
        const age = (clock - rp.t) / life;
        const radius = 8 + age * 70;
        const n = 18;
        ctx.globalAlpha = (1 - age) * (dark ? 0.6 : 0.5);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          ctx.fillText(i % 2 ? '.' : '*', rp.x + Math.cos(a) * radius, rp.y + Math.sin(a) * radius);
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawFrame(dt) {
      if (destroyed || !W) return;
      if (dt > 0) for (const c of creatures) step(c, dt);
      const dark = darkMq.matches;
      const base = dark ? 0.6 : 0.85;
      ctx.clearRect(0, 0, W, H);
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const c of creatures) {
        ctx.save();
        ctx.globalAlpha = base * c.alpha;
        ctx.translate(c.x, c.y);
        if (c.kind === 'koi') drawKoi(c, dark);
        else if (c.kind === 'fly') drawButterfly(c, dark);
        else drawAmbient(c, dark);
        ctx.restore();
      }
      drawRipples(dark);
    }

    function tick(now) {
      raf = 0;
      if (destroyed) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      clock += dt;
      drawFrame(dt);
      raf = win.requestAnimationFrame(tick);
    }

    function start() {
      if (destroyed || raf || reduceMq.matches || doc.hidden) return;
      last = 0;
      raf = win.requestAnimationFrame(tick);
    }

    function stop() {
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0;
    }

    function onPointerDown(ev) {
      if (destroyed || reduceMq.matches) return;
      const px = ev.clientX, py = ev.clientY;
      ripples.push({ x: px, y: py, t: clock });
      for (const c of creatures) {
        let dx = c.x - px, dy = c.y - py;
        let d = Math.hypot(dx, dy);
        if (d > BLAST_RADIUS + c.radius) continue;
        if (d < 1) { const a = rand(0, TAU); dx = Math.cos(a); dy = Math.sin(a); d = 1; }
        const f = Math.max(0, 1 - Math.max(0, d - c.radius * 0.5) / BLAST_RADIUS);
        const force = BLAST_FORCE * (0.25 + 0.75 * f * f) * (c.kind === 'ambient' ? 1.15 : 1);
        c.ix += (dx / d) * force;
        c.iy += (dy / d) * force;
        const dir = Math.random() < 0.5 ? -1 : 1;
        c.spin += dir * (c.kind === 'koi' ? 3 : 8) * (0.4 + f);
      }
    }

    const onVisibility = () => (doc.hidden ? stop() : start());
    const onMotionPref = () => {
      if (reduceMq.matches) { stop(); drawFrame(0); } else start();
    };
    const onTheme = () => { readTheme(); if (!raf) drawFrame(0); };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;

    win.addEventListener('pointerdown', onPointerDown, { passive: true });
    win.addEventListener('resize', resize);
    win.addEventListener('pagehide', destroy);
    win.addEventListener('unload', destroy);
    doc.addEventListener('visibilitychange', onVisibility);
    reduceMq.addEventListener('change', onMotionPref);
    darkMq.addEventListener('change', onTheme);
    if (ro) ro.observe(doc.documentElement);

    readTheme();
    resize();
    populate(true);
    drawFrame(0);
    start();

    function setPreset(p) {
      const next = PRESETS.includes(p) ? p : 'mixed';
      if (next === preset) return;
      preset = next;
      populate(true);
      if (!raf) drawFrame(0);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      win.removeEventListener('pointerdown', onPointerDown);
      win.removeEventListener('resize', resize);
      win.removeEventListener('pagehide', destroy);
      win.removeEventListener('unload', destroy);
      doc.removeEventListener('visibilitychange', onVisibility);
      reduceMq.removeEventListener('change', onMotionPref);
      darkMq.removeEventListener('change', onTheme);
      if (ro) ro.disconnect();
      creatures = [];
      ripples = [];
      canvas.remove();
    }

    return { setPreset, destroy, get preset() { return preset; } };
  }

  AM.AsciiBg = { PRESETS, mount };
})();
