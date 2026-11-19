// Koi pond: a calm, animated pond drawn on one full-page canvas that sits over the AI chat page without
// blocking it (pointer-events: none). Koi are drawn as smooth vector fish (spine that follows the head,
// patterned body, pectoral fins, flowing tail), with ripples and lily pads. Clicking anywhere on the page
// sends a ripple and the nearby fish dart away.
//
// The canvas blends with the page (multiply on light pages, screen on dark ones), so the fish look like
// they swim under the text instead of on top of it. No dependencies, no inline script, nothing leaves the tab.
(() => {
  const AM = (globalThis.Headroom = globalThis.Headroom || { adapters: [] });
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angleDiff = (a, b) => {
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };

  const N = 14; // spine points per fish
  // Half-width of the body along the spine, as a fraction of the maximum (index 0 is the head).
  const WIDTH = [0.34, 0.66, 0.9, 1, 1, 0.95, 0.86, 0.74, 0.6, 0.48, 0.38, 0.3, 0.24, 0.2];

  const PALETTE = {
    water: { white: '#fff3df', red: '#ef4a2b', orange: '#ff8c1a', gold: '#f6c445', black: '#16161f', eye: '#07070b', line: 'rgba(255,255,255,0.20)', shadow: 'rgba(0,12,18,0.32)', ripple: 'rgba(200,240,255,', pad: '#2f9a63', padVein: 'rgba(8,60,35,0.45)' },
    light: { white: '#fff6e6', red: '#e5472f', orange: '#f28a2b', gold: '#e9b43c', black: '#2c2b36', eye: '#1b1a22', line: 'rgba(40,45,70,0.22)', shadow: 'rgba(20,40,60,0.16)', ripple: 'rgba(30,70,110,', pad: '#3f9b6a', padVein: 'rgba(15,70,45,0.35)' },
    dark: { white: '#f3ead9', red: '#ff6a4d', orange: '#ffa04a', gold: '#ffd05a', black: '#7a78b0', eye: '#0e0d14', line: 'rgba(255,255,255,0.16)', shadow: 'rgba(0,0,0,0.0)', ripple: 'rgba(170,205,255,', pad: '#3a8f69', padVein: 'rgba(210,255,230,0.28)' },
  };
  // [body, patches...] by kind of koi.
  const SCHEMES = [
    ['white', 'red', 'red', 'red'], // kohaku
    ['white', 'red', 'black', 'red'], // sanke
    ['orange', 'white', 'orange'], // orange with pearl patches
    ['gold', 'gold', 'white'], // ogon
    ['white', 'orange', 'red', 'gold'], // calico
    ['black', 'red', 'white', 'red'], // showa
  ];

  function makeKoi(W, H) {
    const size = rand(0.85, 1.15) * clamp(Math.min(W, H) * 0.17, 100, 165);
    const heading = rand(0, TAU);
    const x = rand(W * 0.1, W * 0.9);
    const y = rand(H * 0.1, H * 0.9);
    const seg = size / (N - 1);
    const spine = [];
    for (let i = 0; i < N; i++) spine.push({ x: x - Math.cos(heading) * seg * i, y: y - Math.sin(heading) * seg * i });
    const scheme = pick(SCHEMES);
    const patches = [];
    const count = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < count; i++) {
      patches.push({
        t: rand(0.05, 0.85),
        off: rand(-0.5, 0.5),
        rx: rand(0.07, 0.15),
        ry: rand(0.45, 0.9),
        c: scheme[1 + ((Math.random() * (scheme.length - 1)) | 0)],
      });
    }
    return {
      size, seg, spine, heading, speed: size * 0.22, base: size * rand(0.17, 0.26), flee: 0, scheme, patches,
      phase: rand(0, TAU), fin: rand(0, TAU),
      f1: rand(0.18, 0.3), p1: rand(0, TAU), a1: rand(0.5, 0.9),
      f2: rand(0.05, 0.11), p2: rand(0, TAU), a2: rand(0.4, 0.8),
      mirror: Math.random() < 0.5 ? 1 : -1,
    };
  }

  function makePad(W, H) {
    return { x: rand(0, W), y: rand(0, H), r: rand(26, 54), rot: rand(0, TAU), notch: rand(0.18, 0.3), vx: rand(-3, 3), vy: rand(-3, 3), spin: rand(-0.02, 0.02) };
  }

  function mount(opts = {}) {
    const doc = document;
    const win = window;
    const parent = opts.parent || doc.documentElement;
    const isDark = opts.isDark || (() => win.matchMedia('(prefers-color-scheme: dark)').matches);
    const water = opts.scene === 'water'; // a full pond with its own water, instead of a blended overlay

    const canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('data-headroom', 'pond');
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: water ? '0' : '2147483000',
      pointerEvents: 'none', opacity: water ? '1' : '0', transition: water ? 'none' : 'opacity 1.2s ease', background: 'transparent',
    });
    parent.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const reduceMq = win.matchMedia('(prefers-reduced-motion: reduce)');

    let W = 0, H = 0, dpr = 1;
    let koi = [];
    let pads = [];
    let ripples = [];
    let lights = [];
    let dark = isDark();
    let clock = 0;
    let last = 0;
    let raf = 0;
    let destroyed = false;
    let themeTimer = 0;

    const applyMode = () => {
      if (water) { canvas.style.mixBlendMode = 'normal'; return; }
      canvas.style.mixBlendMode = dark ? 'screen' : 'multiply';
      canvas.style.opacity = dark ? '0.55' : '0.6';
    };

    function resize() {
      const w = win.innerWidth, h = win.innerHeight;
      const d = Math.min(2, win.devicePixelRatio || 1);
      if (w === W && h === H && d === dpr) return;
      W = w; H = h; dpr = d;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wantKoi = water ? clamp(Math.round((W * H) / 170000), 5, 9) : clamp(Math.round((W * H) / 260000), 3, 7);
      while (koi.length < wantKoi) koi.push(makeKoi(W, H));
      koi.length = wantKoi;
      const wantPads = clamp(Math.round((W * H) / 450000), 2, 4);
      while (pads.length < wantPads) pads.push(makePad(W, H));
      pads.length = wantPads;
      pads.forEach((p, i) => { p.lotus = water && i === 0; });
      while (lights.length < 12) lights.push({ x: rand(0, W), y: rand(0, H), r: rand(140, 320), vx: rand(-8, 8), vy: rand(-8, 8), ph: rand(0, TAU) });
    }

    // ---- simulation -------------------------------------------------------------------------
    function step(k, dt) {
      const head0 = k.spine[0];
      // Each fish drifts toward a pond spot of its own and picks a new one now and then, so the pond fills evenly.
      if (!k.goal || clock > k.goal.until || Math.hypot(k.goal.x - head0.x, k.goal.y - head0.y) < k.size * 0.6) {
        k.goal = { x: rand(W * 0.06, W * 0.94), y: rand(H * 0.08, H * 0.92), until: clock + rand(7, 14) };
      }
      k.heading += angleDiff(Math.atan2(k.goal.y - head0.y, k.goal.x - head0.x), k.heading) * 0.55 * dt;
      for (const o of koi) {
        if (o === k) continue;
        const dx = head0.x - o.spine[0].x, dy = head0.y - o.spine[0].y, d = Math.hypot(dx, dy);
        if (d < k.size * 1.15) k.heading += angleDiff(Math.atan2(dy, dx), k.heading) * (1 - d / (k.size * 1.15)) * 2.2 * dt;
      }
      const turn = Math.sin(clock * k.f1 + k.p1) * k.a1 * 0.5 + Math.sin(clock * k.f2 + k.p2) * k.a2 * 0.5;
      k.heading += turn * dt * (0.5 + k.flee);
      const head = k.spine[0];
      const margin = Math.min(140, W * 0.2, H * 0.2);
      const near = Math.max((margin - head.x) / margin, (head.x - (W - margin)) / margin, (margin - head.y) / margin, (head.y - (H - margin)) / margin, 0);
      if (near > 0) {
        const home = Math.atan2(H / 2 - head.y, W / 2 - head.x);
        k.heading += angleDiff(home, k.heading) * Math.min(1, near) * 2.4 * dt;
      }
      k.flee *= Math.exp(-1.5 * dt);
      const target = k.base * (1 + k.flee * 3.2);
      k.speed += (target - k.speed) * Math.min(1, dt * 2.5);
      head.x += Math.cos(k.heading) * k.speed * dt;
      head.y += Math.sin(k.heading) * k.speed * dt;
      for (let i = 1; i < N; i++) {
        const a = k.spine[i - 1], b = k.spine[i];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d; dy /= d;
        b.x = a.x + dx * k.seg;
        b.y = a.y + dy * k.seg;
      }
      k.phase += dt * (2 + (k.speed / k.size) * 9);
      k.fin += dt * (1.6 + k.flee * 5);
      // Loose fish (flung far off the page) come back from the other side.
      if (head.x < -k.size * 2 || head.x > W + k.size * 2 || head.y < -k.size * 2 || head.y > H + k.size * 2) {
        const re = makeKoi(W, H);
        Object.assign(k, re);
      }
    }

    function stepAll(dt) {
      clock += dt;
      for (const k of koi) step(k, dt);
      for (const l of lights) { l.x += l.vx * dt; l.y += l.vy * dt; if (l.x < -200) l.x = W + 200; if (l.x > W + 200) l.x = -200; if (l.y < -200) l.y = H + 200; if (l.y > H + 200) l.y = -200; }
      for (const p of pads) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
        if (p.x < -80) p.x = W + 80; if (p.x > W + 80) p.x = -80;
        if (p.y < -80) p.y = H + 80; if (p.y > H + 80) p.y = -80;
      }
      ripples = ripples.filter((r) => clock - r.t < r.life);
      if (Math.random() < dt * 0.25) ripples.push({ x: rand(0, W), y: rand(0, H), t: clock, life: rand(3, 4.5), max: rand(36, 70), soft: true });
    }

    // ---- drawing ----------------------------------------------------------------------------
    function smoothClosed(pts) {
      const n = pts.length;
      const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      let m = mid(pts[n - 1], pts[0]);
      ctx.moveTo(m.x, m.y);
      for (let i = 0; i < n; i++) {
        const p = pts[i], nx = pts[(i + 1) % n];
        m = mid(p, nx);
        ctx.quadraticCurveTo(p.x, p.y, m.x, m.y);
      }
      ctx.closePath();
    }

    function bodyFrame(k) {
      // Points along the swimming wave (the spine plus a sideways sway that grows toward the tail).
      const pts = [];
      const amp = k.size * 0.05 * (0.5 + clamp(k.speed / (k.base * 2), 0, 1.6));
      for (let i = 0; i < N; i++) {
        const prev = k.spine[Math.max(0, i - 1)], next = k.spine[Math.min(N - 1, i + 1)];
        let tx = next.x - prev.x, ty = next.y - prev.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const nx = -ty, ny = tx;
        const sway = Math.sin(k.phase - i * 0.55) * amp * (0.12 + 0.88 * Math.pow(i / (N - 1), 1.4));
        pts.push({ x: k.spine[i].x + nx * sway, y: k.spine[i].y + ny * sway, tx, ty, nx, ny, hw: WIDTH[i] * k.size * 0.135 });
      }
      return pts;
    }

    function outline(pts, nose) {
      const left = [], right = [];
      left.push(nose); // pointed-but-soft nose
      for (const p of pts) { left.push({ x: p.x + p.nx * p.hw, y: p.y + p.ny * p.hw }); right.push({ x: p.x - p.nx * p.hw, y: p.y - p.ny * p.hw }); }
      return left.concat(right.reverse());
    }

    function drawKoi(k, pal) {
      const pts = bodyFrame(k);
      const h = pts[0];
      const nose = { x: h.x + h.tx * -k.seg * 0.0 + (pts[0].x - pts[1].x) * 0.55, y: h.y + (pts[0].y - pts[1].y) * 0.55 };
      const out = outline(pts, nose);
      const col = (name) => pal[name] || name;

      // tail: two flowing lobes that follow the end of the spine
      const t0 = pts[N - 1], t1 = pts[N - 3];
      let dx = t0.x - t1.x, dy = t0.y - t1.y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl; dy /= dl;
      const tl = k.size * 0.3;
      const swing = Math.sin(k.phase - N * 0.55 - 0.4) * 0.55;
      const rot = (a) => ({ x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) });
      const lobeA = rot(0.62 + swing), lobeB = rot(-0.62 + swing), mid = rot(swing * 0.8);
      const tailPath = () => {
        ctx.beginPath();
        ctx.moveTo(t0.x, t0.y);
        ctx.quadraticCurveTo(t0.x + lobeA.x * tl * 0.55 - lobeA.y * tl * 0.2, t0.y + lobeA.y * tl * 0.55 + lobeA.x * tl * 0.2, t0.x + lobeA.x * tl, t0.y + lobeA.y * tl);
        ctx.quadraticCurveTo(t0.x + mid.x * tl * 0.78 + lobeA.x * tl * 0.12, t0.y + mid.y * tl * 0.78 + lobeA.y * tl * 0.12, t0.x + mid.x * tl * 0.6, t0.y + mid.y * tl * 0.6);
        ctx.quadraticCurveTo(t0.x + mid.x * tl * 0.78 + lobeB.x * tl * 0.12, t0.y + mid.y * tl * 0.78 + lobeB.y * tl * 0.12, t0.x + lobeB.x * tl, t0.y + lobeB.y * tl);
        ctx.quadraticCurveTo(t0.x + lobeB.x * tl * 0.55 + lobeB.y * tl * 0.2, t0.y + lobeB.y * tl * 0.55 - lobeB.x * tl * 0.2, t0.x, t0.y);
        ctx.closePath();
      };

      // soft shadow on the water
      if (pal.shadow && pal.shadow !== 'rgba(0,0,0,0.0)') {
        ctx.save();
        ctx.translate(k.size * 0.05, k.size * 0.07);
        ctx.fillStyle = pal.shadow;
        ctx.beginPath(); smoothClosed(out); ctx.fill();
        tailPath(); ctx.fill();
        ctx.restore();
      }

      const bodyCol = col(k.scheme[0]);
      // tail fill fades from the body colour
      const grad = ctx.createLinearGradient(t0.x, t0.y, t0.x + dx * tl, t0.y + dy * tl);
      grad.addColorStop(0, bodyCol);
      grad.addColorStop(1, bodyCol + 'e0');
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = grad;
      tailPath(); ctx.fill();
      ctx.globalAlpha = 1;

      // pectoral fins
      const fp = pts[3];
      for (const side of [1, -1]) {
        const flap = Math.sin(k.fin + (side > 0 ? 0 : 1.2)) * 0.35;
        const ang = Math.atan2(fp.ty, fp.tx) + side * (1.15 + flap);
        const base1 = { x: fp.x + fp.nx * side * fp.hw * 0.9, y: fp.y + fp.ny * side * fp.hw * 0.9 };
        const fl = k.size * 0.17;
        const tip = { x: base1.x + Math.cos(ang) * fl, y: base1.y + Math.sin(ang) * fl };
        const base2 = { x: base1.x + fp.tx * k.seg * 1.5, y: base1.y + fp.ty * k.seg * 1.5 };
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = bodyCol;
        ctx.beginPath();
        ctx.moveTo(base1.x, base1.y);
        ctx.quadraticCurveTo(base1.x + Math.cos(ang - 0.5) * fl * 0.7, base1.y + Math.sin(ang - 0.5) * fl * 0.7, tip.x, tip.y);
        ctx.quadraticCurveTo(base2.x + Math.cos(ang + 0.2) * fl * 0.5, base2.y + Math.sin(ang + 0.2) * fl * 0.5, base2.x, base2.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // body
      ctx.save();
      ctx.beginPath(); smoothClosed(out);
      ctx.fillStyle = bodyCol; ctx.fill();
      ctx.clip();
      for (const p of k.patches) {
        const idx = clamp(Math.round(p.t * (N - 1)), 1, N - 2);
        const q = pts[idx];
        const cx = q.x + q.nx * p.off * q.hw, cy = q.y + q.ny * p.off * q.hw;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.atan2(q.ty, q.tx));
        ctx.fillStyle = col(p.c);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.rx * k.size, p.ry * q.hw * 1.1, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      // sheen along the back
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = k.size * 0.035;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[1].x - pts[1].nx * pts[1].hw * 0.35, pts[1].y - pts[1].ny * pts[1].hw * 0.35);
      for (let i = 2; i < N - 2; i++) ctx.lineTo(pts[i].x - pts[i].nx * pts[i].hw * 0.35, pts[i].y - pts[i].ny * pts[i].hw * 0.35);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();

      // outline
      ctx.strokeStyle = pal.line; ctx.lineWidth = 1;
      ctx.beginPath(); smoothClosed(out); ctx.stroke();

      // eyes
      ctx.fillStyle = pal.eye;
      for (const side of [1, -1]) {
        const e = pts[1];
        ctx.beginPath();
        ctx.arc(e.x + e.nx * side * e.hw * 0.78, e.y + e.ny * side * e.hw * 0.78, Math.max(1.6, k.size * 0.014), 0, TAU);
        ctx.fill();
      }
    }

    function drawPad(p, pal) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = water ? 0.92 : 0.7;
      ctx.fillStyle = pal.pad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, p.r, p.notch * Math.PI, TAU - p.notch * Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = pal.padVein; ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const a = p.notch * Math.PI + ((TAU - 2 * p.notch * Math.PI) * (i + 0.5)) / 5;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * p.r * 0.92, Math.sin(a) * p.r * 0.92); ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    function drawRipples(pal) {
      for (const r of ripples) {
        const age = (clock - r.t) / r.life;
        const radius = r.max * (0.15 + age * 0.85) * (r.soft ? 1 : 2.4);
        const alpha = (1 - age) * (r.soft ? 0.35 : 0.55);
        ctx.lineWidth = r.soft ? 1.2 : 1.6;
        for (let ring = 0; ring < 2; ring++) {
          const rr = radius - ring * (r.soft ? 8 : 16);
          if (rr <= 1) continue;
          ctx.strokeStyle = `${pal.ripple}${(alpha * (ring ? 0.55 : 1)).toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(r.x, r.y, rr, rr * 0.86, 0, 0, TAU);
          ctx.stroke();
        }
      }
    }

    function drawWater() {
      const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
      g.addColorStop(0, '#0e5560'); g.addColorStop(0.55, '#0a3d4c'); g.addColorStop(1, '#06222f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const l of lights) {
        const a = 0.05 + 0.03 * Math.sin(clock * 0.4 + l.ph);
        const rg = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
        rg.addColorStop(0, `rgba(110,215,205,${a})`); rg.addColorStop(1, 'rgba(110,215,205,0)');
        ctx.fillStyle = rg; ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,10,16,0.45)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }

    function drawLotus(p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * 0.5);
      const R = p.r * 0.62;
      for (let layer = 0; layer < 3; layer++) {
        const n = layer === 2 ? 6 : 8, len = R * (1 - layer * 0.28);
        for (let i = 0; i < n; i++) {
          ctx.save();
          ctx.rotate((i / n) * TAU + layer * 0.3);
          const g = ctx.createLinearGradient(0, 0, 0, -len);
          g.addColorStop(0, layer === 2 ? '#ffe7a8' : '#ffd6e3'); g.addColorStop(1, layer === 0 ? '#f0709a' : '#f7a3c0');
          ctx.fillStyle = g;
          ctx.globalAlpha = 0.95;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(len * 0.42, -len * 0.4, 0, -len);
          ctx.quadraticCurveTo(-len * 0.42, -len * 0.4, 0, 0);
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath(); ctx.arc(0, 0, R * 0.14, 0, TAU); ctx.fill();
      ctx.restore();
    }

    function drawFrame() {
      if (destroyed || !W) return;
      const pal = water ? PALETTE.water : dark ? PALETTE.dark : PALETTE.light;
      if (water) drawWater(); else ctx.clearRect(0, 0, W, H);
      drawRipples(pal);
      for (const p of pads) { drawPad(p, pal); if (p.lotus) drawLotus(p); }
      for (const k of koi) drawKoi(k, pal);
    }

    function tick(now) {
      raf = 0;
      if (destroyed) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      stepAll(dt);
      drawFrame();
      raf = win.requestAnimationFrame(tick);
    }
    const start = () => { if (!raf && !destroyed && !doc.hidden && !reduceMq.matches) { last = 0; raf = win.requestAnimationFrame(tick); } };
    const stop = () => { if (raf) { win.cancelAnimationFrame(raf); raf = 0; } };

    // ---- interaction ------------------------------------------------------------------------
    function onPointerDown(e) {
      if (reduceMq.matches) return;
      ripples.push({ x: e.clientX, y: e.clientY, t: clock, life: 2.2, max: 46, soft: false });
      for (const k of koi) {
        const h = k.spine[0];
        const dx = h.x - e.clientX, dy = h.y - e.clientY;
        const d = Math.hypot(dx, dy);
        if (d < 260) {
          const f = 1 - d / 260;
          const away = Math.atan2(dy, dx);
          k.heading += angleDiff(away, k.heading) * (0.6 + 0.4 * f);
          k.flee = Math.max(k.flee, 0.35 + f);
        }
      }
    }
    const onVisibility = () => (doc.hidden ? stop() : start());
    const onMotion = () => { if (reduceMq.matches) { stop(); drawFrame(); } else start(); };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;

    win.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
    win.addEventListener('resize', resize);
    doc.addEventListener('visibilitychange', onVisibility);
    reduceMq.addEventListener('change', onMotion);
    if (ro) ro.observe(doc.documentElement);
    themeTimer = win.setInterval(() => {
      const d = isDark();
      if (d !== dark) { dark = d; applyMode(); if (!raf) drawFrame(); }
    }, 1500);

    applyMode();
    resize();
    // Let the fish settle into a natural arrangement before the first frame.
    for (let i = 0; i < 90; i++) stepAll(1 / 30);
    drawFrame();
    if (!water) win.requestAnimationFrame(() => { canvas.style.opacity = dark ? '0.55' : '0.6'; });
    if (!opts.manual) start();

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      win.clearInterval(themeTimer);
      win.removeEventListener('pointerdown', onPointerDown, { capture: true });
      win.removeEventListener('resize', resize);
      doc.removeEventListener('visibilitychange', onVisibility);
      reduceMq.removeEventListener('change', onMotion);
      if (ro) ro.disconnect();
      canvas.remove();
    }
    // Manual stepping (used to render the demo video frame by frame).
    const advance = (dt) => { stepAll(dt); drawFrame(); };
    const poke = (x, y) => onPointerDown({ clientX: x, clientY: y });
    return { destroy, canvas, advance, poke };
  }

  // Whether the page itself is dark: read its own background, fall back to the browser preference.
  AM.pageIsDark = () => {
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
  };

  AM.KoiPond = { mount };
})();
