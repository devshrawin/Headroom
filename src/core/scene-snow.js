// Snowfall theme for the living-background engine, with the same "drop to the first edge below" physics as Iris.
// Three depths of flakes (faint far ones, soft mid ones, large out-of-focus near ones with real crystals that tumble)
// drift down on a slow wind. They settle on the top edge of real surfaces (message bubbles, the message box, cards,
// panels) as soft mounds, and pile into a drift along the bottom of the window. Scrolling shakes the mounds loose:
// the snow slides off and falls to the next ledge below, or to the ground. A click is a gust of wind and knocks snow
// off the ledges nearby.
// (overlay mode draws only the falling flakes on a see-through canvas.)
(() => {
  const AM = globalThis.Headroom;
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function create(o) {
    const canvas = o.canvas, ctx = canvas.getContext('2d');
    const overlay = !!o.overlay;
    const light = !!o.blend && o.tone === 'light'; // light page: blue-grey snow that still shows once multiplied into white
    const FLAKE = light ? '150,184,224' : '255,255,255';
    const SHADE = light ? 'rgba(90,125,170,' : 'rgba(150,180,225,';

    // ---- sprites, drawn once ----
    const soft = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, `rgba(${FLAKE},1)`); g.addColorStop(0.22, `rgba(${FLAKE},0.9)`); g.addColorStop(0.55, `rgba(${FLAKE},0.32)`); g.addColorStop(1, `rgba(${FLAKE},0)`);
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      return c;
    })();
    const bokeh = (() => { // a flake close to the lens: a soft disc, a little brighter at the rim
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, `rgba(${FLAKE},0.22)`); g.addColorStop(0.7, `rgba(${FLAKE},0.4)`); g.addColorStop(0.9, `rgba(${FLAKE},0.55)`); g.addColorStop(1, `rgba(${FLAKE},0)`);
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return c;
    })();
    const crystals = [0, 1, 2].map((variant) => { // six-fold dendrites, each a little different
      const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
      const x = c.getContext('2d');
      x.translate(S / 2, S / 2);
      x.lineCap = 'round';
      x.shadowColor = light ? 'rgba(80,120,170,0.7)' : 'rgba(190,220,255,0.9)'; x.shadowBlur = 7;
      x.strokeStyle = `rgba(${FLAKE},0.95)`;
      for (let i = 0; i < 6; i++) {
        x.save(); x.rotate((i / 6) * TAU);
        x.lineWidth = 3;
        x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -52); x.stroke();
        x.lineWidth = 2;
        const branches = variant === 0 ? [[16, 14], [32, 10]] : variant === 1 ? [[12, 16], [26, 13], [40, 8]] : [[20, 18], [38, 9]];
        for (const [d, len] of branches) {
          x.beginPath(); x.moveTo(0, -d); x.lineTo(-len * 0.8, -d - len * 0.7); x.moveTo(0, -d); x.lineTo(len * 0.8, -d - len * 0.7); x.stroke();
        }
        if (variant === 2) { x.beginPath(); x.arc(0, -52, 2.5, 0, TAU); x.stroke(); }
        x.restore();
      }
      x.fillStyle = `rgba(${FLAKE},1)`; x.beginPath(); x.arc(0, 0, 4, 0, TAU); x.fill();
      return c;
    });
    const spark = (() => { // a four-point glint
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const x = c.getContext('2d');
      x.translate(16, 16);
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(-16, -16, 32, 32);
      x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 1.2; x.lineCap = 'round';
      x.beginPath(); x.moveTo(-15, 0); x.lineTo(15, 0); x.moveTo(0, -15); x.lineTo(0, 15); x.stroke();
      return c;
    })();

    let W = 1, H = 1, dpr = 1, clock = 0, destroyed = false;
    let flakes = [], platforms = [], puffs = [], glints = [];
    const caps = new Map(); // element id -> { depth, seen, seed }: the snow resting on one ledge
    const GBINS = 112;
    let ground = new Float32Array(GBINS); // snow piled along the bottom, px per column
    let gusts = [];
    const CAP_MAX = 11;
    const groundMax = () => Math.min(84, H * 0.1);
    const baseCount = () => Math.round(150 * ((W * H) / (1280 * 800)));

    // layer 0: faint and small and far; 1: soft mid-field; 2: big, out of focus, close to the lens
    const spawn = (f, top, layer = f.layer ?? ((r) => (r < 0.45 ? 0 : r < 0.9 ? 1 : 2))(Math.random())) => {
      f.layer = layer;
      f.x = rand(0, W); f.y = top ? rand(-60, -6) : rand(-H * 0.1, H);
      f.z = layer === 0 ? rand(0.2, 0.4) : layer === 1 ? rand(0.5, 0.8) : rand(0.85, 1);
      f.size = layer === 0 ? rand(2, 4.2) : layer === 1 ? rand(5, 10) : rand(15, 30);
      f.vy = layer === 0 ? rand(18, 34) : layer === 1 ? rand(32, 58) : rand(58, 92);
      f.vx = 0;
      f.ph = rand(0, TAU); f.rot = rand(0, TAU); f.vr = rand(-0.9, 0.9); f.tumble = rand(0, TAU);
      f.kind = layer === 2 ? (Math.random() < 0.72 ? 'crystal' : 'bokeh') : layer === 1 && Math.random() < 0.18 ? 'crystal' : 'soft';
      if (f.kind === 'crystal') { f.variant = (Math.random() * 3) | 0; if (layer === 1) f.size = rand(11, 17); }
      return f;
    };
    function resize(w, h, d) {
      W = w; H = h; dpr = d;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      flakes = Array.from({ length: baseCount() }, () => spawn({}, false));
      ground = new Float32Array(GBINS);
      for (let i = 0; i < GBINS; i++) ground[i] = 5 + 3 * Math.sin(i * 0.37) + 2 * Math.sin(i * 0.11 + 1); // a thin settled layer to begin with
    }

    function addGround(x, amt) {
      const i = clamp(Math.floor((x / W) * GBINS), 0, GBINS - 1);
      for (const [di, k] of [[0, 1], [-1, 0.45], [1, 0.45], [-2, 0.15], [2, 0.15]]) {
        const j = i + di;
        if (j >= 0 && j < GBINS) ground[j] = Math.min(groundMax(), ground[j] + amt * k);
      }
    }
    const groundAt = (x) => {
      const f = clamp((x / W) * GBINS - 0.5, 0, GBINS - 1.001), i = Math.floor(f);
      return ground[i] + (ground[i + 1] - ground[i]) * (f - i);
    };

    // The page's real surfaces become ledges; each remembers its snow by element id, so a ledge that scrolls keeps its mound.
    function setSurfaces(rects) {
      platforms = (rects || []).filter((r) => r.id != null && r.r - r.l >= 48 && r.b - r.t >= 14 && r.t > 24 && r.t < H - 6);
      for (const p of platforms) {
        const c = caps.get(p.id);
        if (c) c.seen = clock;
      }
      for (const [id, c] of caps) if (clock - c.seen > 2.5) caps.delete(id);
    }

    const puff = (x, y, n, up) => {
      for (let i = 0; i < n && puffs.length < 120; i++) puffs.push({ x: x + rand(-4, 4), y, vx: rand(-26, 26), vy: -rand(8, up), life: rand(0.35, 0.7), max: 0.7, s: rand(2, 4.5) });
    };
    function shedFrom(p, c, amount) {
      const shed = Math.min(c.depth, amount);
      if (shed < 0.05) return;
      c.depth -= shed;
      const n = Math.min(30, Math.ceil(shed * 5));
      for (let i = 0; i < n && flakes.length < 800; i++) {
        flakes.push({ layer: 1, kind: 'soft', x: clamp(rand(p.l, p.r), 0, W), y: p.t - rand(1, 6), z: rand(0.7, 0.95), size: rand(4, 8), vy: rand(6, 26), vx: rand(-30, 30), ph: rand(0, TAU), rot: 0, vr: 0, tumble: 0, fresh: true });
      }
      puff((p.l + p.r) / 2, p.t - 2, 4, 30);
    }
    // Scrolling shakes the ledges: loose snow slides off and falls to whatever is below.
    function shake(dy) {
      const amount = clamp(dy / 70, 0, 3.4);
      if (amount < 0.02) return;
      for (const p of platforms) {
        const c = caps.get(p.id);
        if (c && c.depth > 0.2) shedFrom(p, c, amount * 0.9 + 0.12);
      }
    }

    function advance(dt) {
      if (destroyed) return;
      clock += dt;
      const target = baseCount();
      for (let i = flakes.length - 1; i >= 0; i--) {
        const f = flakes[i];
        const prev = f.y;
        // slow wind with swirls that change with height and time, so the snow moves in drifts, not in lockstep
        const wind = (Math.sin(clock * 0.23) * 14 + Math.sin(clock * 0.61) * 6 + Math.sin(f.y * 0.006 + clock * 0.45) * 10) * f.z;
        f.vx += (wind + Math.sin(clock * 0.9 + f.ph) * 11 * f.z - f.vx) * Math.min(1, dt * 1.3);
        f.x += f.vx * dt;
        f.y += f.vy * dt * (0.92 + 0.16 * Math.sin(clock * 1.7 + f.ph));
        f.rot += f.vr * dt; f.tumble += dt * (0.8 + f.z);
        if (f.x < -40) f.x = W + 40; else if (f.x > W + 40) f.x = -40;
        let done = false;
        if (f.layer > 0 && platforms.length) {
          for (let k = 0; k < platforms.length; k++) {
            const p = platforms[k];
            if (prev <= p.t && f.y >= p.t && f.x > p.l && f.x < p.r) {
              let c = caps.get(p.id);
              if (!c) { c = { depth: 0, seen: clock, seed: rand(0, 99) }; caps.set(p.id, c); }
              c.depth = Math.min(CAP_MAX, c.depth + (f.layer === 2 ? 0.2 : 0.09));
              c.seen = clock;
              if (f.layer === 1 || Math.random() < 0.5) puff(f.x, p.t - c.depth * 0.5, 2, 18);
              done = true; break;
            }
          }
        }
        if (!done && f.y >= H - groundAt(f.x) + (f.layer === 0 ? 4 : 0)) {
          addGround(f.x, f.layer === 2 ? 0.45 : f.layer === 1 ? 0.22 : 0.06);
          if (f.layer > 0 && Math.random() < 0.6) puff(f.x, H - groundAt(f.x), 2, 16);
          done = true;
        }
        if (done || f.y > H + 20) {
          if (f.fresh || flakes.length > target + 30) flakes.splice(i, 1);
          else spawn(f, true);
        }
      }
      while (flakes.length < target) flakes.push(spawn({}, true));
      for (const q of puffs) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 70 * dt; q.vx *= Math.exp(-2 * dt); q.life -= dt; }
      puffs = puffs.filter((q) => q.life > 0);
      // the piled snow settles and smooths out a little
      for (let i = 1; i < GBINS - 1; i++) ground[i] += ((ground[i - 1] + ground[i + 1]) / 2 - ground[i]) * Math.min(1, dt * 0.9);
      // glints: the odd crystal catching the light on a mound or the drift
      if (Math.random() < dt * 5 && glints.length < 14) {
        const onCap = platforms.length && Math.random() < 0.5;
        if (onCap) {
          const p = platforms[(Math.random() * platforms.length) | 0], c = caps.get(p.id);
          if (c && c.depth > 1.2) glints.push({ x: rand(p.l + 8, p.r - 8), y: p.t - c.depth * rand(0.2, 0.7), age: 0, life: rand(0.8, 1.6), s: rand(7, 13) });
        } else {
          const x = rand(0, W);
          glints.push({ x, y: H - groundAt(x) * rand(0.2, 0.8), age: 0, life: rand(0.8, 1.6), s: rand(7, 13) });
        }
      }
      for (const g of glints) g.age += dt;
      glints = glints.filter((g) => g.age < g.life);
      gusts = gusts.filter((g) => (g.age += dt) < 1.6);
      draw();
    }

    function drawBackground() {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      if (light) { g.addColorStop(0, '#eef5fc'); g.addColorStop(1, '#dce9f6'); }
      else { g.addColorStop(0, '#080f22'); g.addColorStop(0.55, '#12224a'); g.addColorStop(1, '#223c70'); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // cold light low in the scene, as if the snow itself were lit
      const gl = ctx.createRadialGradient(W * 0.5, H * 1.02, 0, W * 0.5, H * 1.02, Math.max(W, H) * 0.7);
      gl.addColorStop(0, light ? 'rgba(255,255,255,0.7)' : 'rgba(120,160,230,0.28)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
      const v = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.85);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, light ? 'rgba(120,150,190,0.14)' : 'rgba(0,3,14,0.45)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }

    // a smooth outline through points (midpoint quadratic), so mounds read as soft snow and not as a polyline
    function smoothPath(pts, close) {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last[0], last[1]);
      if (close) ctx.closePath();
    }

    function drawCaps() {
      for (const p of platforms) {
        const c = caps.get(p.id);
        if (!c || c.depth < 0.35) continue;
        const d = c.depth, x0 = Math.max(p.l, -10), x1 = Math.min(p.r, W + 10);
        if (x1 - x0 < 12) continue;
        const pts = [[x0, p.t + 1.5]];
        for (let x = x0 + 4; x < x1 - 2; x += 10) {
          const edge = Math.min(1, (x - x0) / 22, (x1 - x) / 22);
          const bump = 0.55 + 0.3 * Math.sin(x * 0.045 + c.seed) + 0.15 * Math.sin(x * 0.13 + c.seed * 2);
          pts.push([x, p.t - d * bump * Math.sin(edge * Math.PI / 2)]);
        }
        pts.push([x1, p.t + 1.5]);
        // soft shadow where the snow meets the surface, then the mound
        ctx.fillStyle = SHADE + '0.25)';
        ctx.fillRect(x0 + 2, p.t, x1 - x0 - 4, 2.5);
        ctx.beginPath(); smoothPath(pts, true);
        const g = ctx.createLinearGradient(0, p.t - d, 0, p.t + 1);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, light ? '#eaf2fb' : '#f0f5fd'); g.addColorStop(1, light ? '#c4d8ee' : '#cddcf1');
        ctx.fillStyle = g; ctx.fill();
        if (light) { ctx.strokeStyle = 'rgba(110,145,185,0.45)'; ctx.lineWidth = 0.9; ctx.stroke(); }
      }
    }

    function drawGround() {
      const gm = groundMax();
      const pts = [];
      for (let i = 0; i <= GBINS; i += 2) {
        const x = (i / GBINS) * W, h = ground[Math.min(i, GBINS - 1)];
        pts.push([x, H - h]);
      }
      pts.unshift([-4, H + 4]); pts.push([W + 4, H + 4]);
      // a darker, slightly higher back drift for depth
      ctx.beginPath();
      smoothPath(pts.map(([x, y], i) => (i === 0 || i === pts.length - 1 ? [x, y] : [x, y - 5 - 3 * Math.sin(x * 0.012 + 2)])), true);
      ctx.fillStyle = light ? 'rgba(170,198,228,0.7)' : 'rgba(150,178,225,0.5)';
      ctx.fill();
      ctx.beginPath(); smoothPath(pts, true);
      const g = ctx.createLinearGradient(0, H - gm, 0, H);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, light ? '#e9f1fa' : '#eef3fc'); g.addColorStop(1, light ? '#bfd3ea' : '#c6d6ee');
      ctx.fillStyle = g; ctx.fill();
    }

    function drawFlakes(layer) {
      for (const f of flakes) {
        if (f.layer !== layer) continue;
        const s = f.size;
        if (f.kind === 'crystal') {
          const flutter = 0.55 + 0.45 * Math.abs(Math.cos(f.tumble)); // seen edge-on now and then, like a tumbling flake
          ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.scale(1, flutter);
          ctx.globalAlpha = layer === 2 ? 0.8 : 0.9;
          ctx.drawImage(crystals[f.variant], -s / 2, -s / 2, s, s);
          ctx.restore();
        } else if (f.kind === 'bokeh') {
          ctx.globalAlpha = 0.34; ctx.drawImage(bokeh, f.x - s, f.y - s, s * 2, s * 2);
        } else {
          ctx.globalAlpha = layer === 0 ? 0.4 + 0.2 * f.z : 0.55 + 0.4 * f.z;
          ctx.drawImage(soft, f.x - s, f.y - s, s * 2, s * 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    function draw() {
      if (overlay) ctx.clearRect(0, 0, W, H); else drawBackground();
      drawFlakes(0);
      if (!overlay) drawGround();
      drawCaps();
      drawFlakes(1);
      // puffs of powder where snow lands or slides off
      for (const q of puffs) {
        ctx.globalAlpha = clamp(q.life / q.max, 0, 1) * 0.7;
        ctx.drawImage(soft, q.x - q.s * 1.6, q.y - q.s * 1.6, q.s * 3.2, q.s * 3.2);
      }
      for (const g of glints) {
        const a = Math.sin((g.age / g.life) * Math.PI);
        ctx.globalAlpha = a; ctx.drawImage(spark, g.x - g.s / 2, g.y - g.s / 2, g.s, g.s);
      }
      ctx.globalAlpha = 1;
      drawFlakes(2);
    }

    function poke(x, y) {
      gusts.push({ x, y, age: 0 });
      for (const f of flakes) {
        const dx = f.x - x, dy = f.y - y, d = Math.hypot(dx, dy) || 1, k = Math.max(0, 1 - d / 360);
        f.vx += (dx / d) * 280 * k * f.z; f.y += (dy / d) * 36 * k; f.vr += rand(-3, 3) * k;
      }
      puff(x, y, 8, 40);
      for (const p of platforms) { // a gust of wind knocks snow off the ledges nearby
        const c = caps.get(p.id);
        const cx = clamp(x, p.l, p.r), cy = clamp(y, p.t, p.b);
        if (c && c.depth > 0.2 && Math.hypot(cx - x, cy - y) < 260) shedFrom(p, c, c.depth * 0.6);
      }
    }

    resize(o.W, o.H, o.dpr);
    for (let i = 0; i < 100; i++) advance(1 / 30);
    return {
      resize, advance, poke, shake, setSurfaces,
      setObstacles() {}, // flakes are weather: they fall past text, and only rest on real surfaces
      points: () => flakes.slice(0, 40).map((f) => ({ x: f.x, y: f.y })),
      destroy() { destroyed = true; },
      params: { refr: 0.006, spec: 0.35, damp: 0.985, shade: 0.1, tint: [0.8, 0.9, 1] },
    };
  }
  if (AM.Living) AM.Living.themes.snow = create;
})();
