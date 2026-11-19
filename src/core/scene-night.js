// Firefly night theme for the living-background engine: a twilight sky with stars, a slow aurora and a moon,
// layered hills, and fireflies that drift and pulse. Click: a burst of sparks, the fireflies scatter and flare,
// then they drift back together.
// (overlay mode draws only the fireflies, sparks and a few drifting lights on a see-through canvas.)
(() => {
  const AM = globalThis.Headroom;
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const sprite = (rgb, size = 96) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.18, `rgba(${rgb},0.75)`); g.addColorStop(0.45, `rgba(${rgb},0.22)`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.fillRect(0, 0, size, size);
    return c;
  };

  function create(o) {
    const canvas = o.canvas, ctx = canvas.getContext('2d');
    const overlay = !!o.overlay;
    const sprites = { warm: sprite('232,255,110'), amber: sprite('255,214,102'), cyan: sprite('120,240,255'), pink: sprite('255,160,220'), white: sprite('235,240,255') };
    let W = 1, H = 1, dpr = 1, clock = 0, destroyed = false;
    let stars = [], flies = [], orbs = [], sparks = [], shooting = null, nextShoot = rand(5, 9), hills = [];

    const makeFly = () => ({
      x: rand(0, W), y: rand(H * 0.2, H * 0.95), vx: rand(-14, 14), vy: rand(-10, 10), ph: rand(0, TAU), freq: rand(0.35, 0.9), s: rand(26, 54),
      spr: pick(['warm', 'warm', 'warm', 'amber', 'cyan']), flare: 0, t: rand(0, 100), push: { x: 0, y: 0 },
    });

    function resize(w, h, d) {
      W = w; H = h; dpr = d;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const area = (W * H) / (1280 * 800);
      stars = Array.from({ length: Math.round(170 * area) }, () => ({ x: rand(0, W), y: rand(0, H * 0.7), r: rand(0.4, 1.5), ph: rand(0, TAU), f: rand(0.6, 2.2) }));
      flies = Array.from({ length: Math.round(46 * area) }, makeFly);
      orbs = Array.from({ length: Math.round(14 * area) }, () => ({ x: rand(0, W), y: rand(0, H), r: rand(40, 120), vx: rand(-6, 6), vy: rand(-5, 3), ph: rand(0, TAU), spr: pick(['cyan', 'pink', 'white']) }));
      // two hill silhouettes
      hills = [0.78, 0.86].map((base, i) => Array.from({ length: 9 }, (_, k) => ({ x: (k / 8) * (W + 200) - 100, y: H * (base + rand(-0.04, 0.04)) })));
    }

    function advance(dt) {
      if (destroyed) return;
      clock += dt;
      for (const f of flies) {
        f.t += dt;
        f.vx += (Math.sin(f.t * 0.7 + f.ph) * 22 - f.vx) * dt * 0.6;
        f.vy += (Math.cos(f.t * 0.55 + f.ph * 1.3) * 16 - f.vy) * dt * 0.6;
        f.x += (f.vx + f.push.x) * dt; f.y += (f.vy + f.push.y) * dt;
        f.push.x *= Math.exp(-1.5 * dt); f.push.y *= Math.exp(-1.5 * dt);
        f.flare *= Math.exp(-1.1 * dt);
        if (f.x < -40) f.x = W + 40; if (f.x > W + 40) f.x = -40;
        if (f.y < H * 0.12) f.vy += 30 * dt; if (f.y > H + 30) f.y = H * 0.3;
      }
      for (const b of orbs) { b.x += b.vx * dt; b.y += b.vy * dt; if (b.x < -150) b.x = W + 150; if (b.x > W + 150) b.x = -150; if (b.y < -150) b.y = H + 150; if (b.y > H + 150) b.y = -150; }
      for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= Math.exp(-2.2 * dt); s.vy *= Math.exp(-2.2 * dt); s.life -= dt; }
      sparks = sparks.filter((s) => s.life > 0);
      nextShoot -= dt;
      if (nextShoot <= 0 && !overlay) { shooting = { x: rand(W * 0.2, W * 0.8), y: rand(0, H * 0.25), t: 0 }; nextShoot = rand(7, 12); }
      if (shooting) { shooting.t += dt; if (shooting.t > 1.1) shooting = null; }
      draw();
    }

    function drawBackground() {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#060a22'); g.addColorStop(0.55, '#12204e'); g.addColorStop(0.85, '#27407a'); g.addColorStop(1, '#2f4f86');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // stars
      for (const s of stars) {
        ctx.fillStyle = `rgba(235,242,255,${0.35 + 0.5 * (0.5 + 0.5 * Math.sin(clock * s.f + s.ph))})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      }
      // aurora ribbons
      ctx.globalCompositeOperation = 'lighter';
      [[0.2, "rgba(60,255,190,", 38, 0.0035, 0.16], [0.28, "rgba(120,150,255,", 46, 0.0028, 0.12], [0.15, "rgba(190,110,255,", 32, 0.004, 0.09]].forEach(([yb, col, amp, fr, al], i) => {
        const top = [], steps = 36;
        for (let k = 0; k <= steps; k++) {
          const x = (k / steps) * W;
          top.push([x, H * yb + Math.sin(x * fr + clock * (0.25 + i * 0.07) + i * 2) * amp + Math.sin(x * fr * 2.3 - clock * 0.18) * amp * 0.4]);
        }
        const gr = ctx.createLinearGradient(0, H * yb - amp, 0, H * yb + amp * 3.2);
        gr.addColorStop(0, col + '0)'); gr.addColorStop(0.22, col + al + ')'); gr.addColorStop(1, col + '0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        top.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        for (let k = steps; k >= 0; k--) ctx.lineTo(top[k][0], top[k][1] + amp * 3.2);
        ctx.closePath(); ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
      // moon
      const mx = W * 0.16, my = H * 0.17, mr = Math.min(W, H) * 0.055;
      const halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 5);
      halo.addColorStop(0, 'rgba(210,225,255,0.38)'); halo.addColorStop(1, 'rgba(210,225,255,0)');
      ctx.fillStyle = halo; ctx.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
      const mg = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
      mg.addColorStop(0, '#fffdf2'); mg.addColorStop(1, '#d6dcf2');
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
      // shooting star
      if (shooting) {
        const k = shooting.t / 1.1, x = shooting.x + k * W * 0.25, y = shooting.y + k * H * 0.13;
        const tg = ctx.createLinearGradient(x, y, x - W * 0.09, y - H * 0.047);
        tg.addColorStop(0, `rgba(255,255,255,${1 - k})`); tg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = tg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - W * 0.09, y - H * 0.047); ctx.stroke();
      }
    }

    function drawHills() {
      hills.forEach((pts, i) => {
        ctx.fillStyle = i === 0 ? '#101b3d' : '#070d22';
        ctx.beginPath();
        ctx.moveTo(-100, H);
        ctx.lineTo(pts[0].x, pts[0].y);
        for (let k = 1; k < pts.length; k++) {
          const p = pts[k - 1], q = pts[k];
          ctx.bezierCurveTo(p.x + (q.x - p.x) * 0.5, p.y, p.x + (q.x - p.x) * 0.5, q.y, q.x, q.y);
        }
        ctx.lineTo(W + 100, H); ctx.closePath(); ctx.fill();
      });
    }

    function draw() {
      if (overlay) ctx.clearRect(0, 0, W, H); else drawBackground();
      ctx.globalCompositeOperation = 'lighter';
      for (const b of orbs) {
        const a = (overlay ? 0.1 : 0.2) * (0.65 + 0.35 * Math.sin(clock * 0.4 + b.ph));
        ctx.globalAlpha = a; ctx.drawImage(sprites[b.spr], b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (!overlay) drawHills();
      ctx.globalCompositeOperation = 'lighter';
      for (const f of flies) {
        const blink = Math.pow(0.5 + 0.5 * Math.sin(clock * f.freq * TAU * 0.5 + f.ph), 2.2);
        const a = clamp(0.12 + 0.88 * blink + f.flare, 0, 1);
        const s = f.s * (0.7 + 0.45 * blink + f.flare * 0.8);
        ctx.globalAlpha = a;
        ctx.drawImage(sprites[f.spr], f.x - s / 2, f.y - s / 2, s, s);
        ctx.globalAlpha = a; // bright pinpoint core
        ctx.drawImage(sprites.white, f.x - 3.5, f.y - 3.5, 7, 7);
      }
      for (const s of sparks) {
        ctx.globalAlpha = clamp(s.life / s.max, 0, 1);
        ctx.drawImage(sprites[s.c], s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    function poke(x, y) {
      for (let i = 0; i < 26; i++) {
        const a = rand(0, TAU), v = rand(80, 360);
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.8, 1.7), max: 1.7, r: rand(4, 13), c: pick(['warm', 'amber', 'cyan', 'pink', 'white']) });
      }
      for (const f of flies) {
        const dx = f.x - x, dy = f.y - y, d = Math.hypot(dx, dy) || 1, k = Math.max(0, 1 - d / 420);
        f.push.x += (dx / d) * 300 * k; f.push.y += (dy / d) * 300 * k; f.flare = Math.max(f.flare, k * 0.9);
      }
    }

    resize(o.W, o.H, o.dpr);
    for (let i = 0; i < 60; i++) advance(1 / 30);
    return {
      resize, advance, poke,
      destroy() { destroyed = true; },
      params: { refr: 0.006, spec: 0.0, damp: 0.975, shade: 0.1, tint: [0.8, 0.9, 1] },
    };
  }
  if (AM.Living) AM.Living.themes.fireflies = create;
})();
