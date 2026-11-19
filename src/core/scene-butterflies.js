// Butterfly garden theme for the living-background engine: golden-hour meadow, swaying flowers and grass,
// butterflies that flutter, visit flowers and rest, drifting petals and pollen. Click: a gust of wind scatters
// the butterflies and lifts the petals; the flowers sway.
// (overlay mode draws only the butterflies, petals and pollen on a see-through canvas.)
(() => {
  const AM = globalThis.Headroom;
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angleDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

  // Wing outlines for the upper side (y > 0) in units where the body is 1 long and sits on the x axis.
  const FORE = [[0.16, 0.03], [0.38, 0.32, 0.46, 0.78, 0.24, 0.98], [0.04, 1.1, -0.16, 0.86, -0.2, 0.58], [-0.22, 0.32, -0.12, 0.1, -0.06, 0.03]];
  const HIND = [[-0.05, 0.03], [0.02, 0.32, -0.02, 0.62, -0.24, 0.78], [-0.44, 0.88, -0.58, 0.62, -0.48, 0.38], [-0.42, 0.2, -0.22, 0.08, -0.08, 0.03]];
  const wingPath = (ctx, w, sc) => {
    ctx.beginPath();
    ctx.moveTo(w[0][0] * sc, w[0][1] * sc);
    for (let i = 1; i < w.length; i++) ctx.bezierCurveTo(w[i][0] * sc, w[i][1] * sc, w[i][2] * sc, w[i][3] * sc, w[i][4] * sc, w[i][5] * sc);
    ctx.closePath();
  };

  const SPECIES = [
    { name: 'monarch', a: '#ffa530', b: '#e4551a', edge: '#1d1410', dots: '#fff6e6', vein: 'rgba(25,15,10,0.8)' },
    { name: 'morpho', a: '#5aa9ff', b: '#1f4fe0', edge: '#0d1636', dots: '#d9efff', vein: 'rgba(10,20,60,0.55)' },
    { name: 'swallowtail', a: '#fff08a', b: '#f4c21b', edge: '#1a1608', dots: '#ffffff', vein: 'rgba(30,25,5,0.8)' },
    { name: 'lilac', a: '#e8b8ff', b: '#a35be0', edge: '#2a1038', dots: '#ffffff', vein: 'rgba(40,10,60,0.6)' },
  ];
  const PETAL_COLORS = ['#ffd1dc', '#ffc2d4', '#fff0f4', '#ffe0a8'];
  const FLOWERS = [['#ffffff', '#ffd23c'], ['#ff9ec0', '#ffe27a'], ['#ffb347', '#7a3b0d'], ['#c9a8ff', '#ffe27a'], ['#ff7a7a', '#ffe27a']];

  function create(o) {
    const canvas = o.canvas, ctx = canvas.getContext('2d');
    const overlay = !!o.overlay;
    let W = 1, H = 1, dpr = 1, clock = 0, destroyed = false;
    let flowers = [], grass = [], petals = [], pollen = [], bokeh = [], flies = [], gusts = [];

    const makeFlower = () => {
      const [pet, cen] = pick(FLOWERS);
      return { x: rand(W * 0.05, W * 0.95), y: rand(H * 0.5, H * 0.9), r: rand(16, 30), n: pick([8, 10, 12]), pet, cen, ph: rand(0, TAU), stem: rand(40, 110), push: 0 };
    };
    const makeFly = () => {
      const sp = pick(SPECIES);
      return { x: rand(0, W), y: rand(0, H * 0.8), heading: rand(0, TAU), size: rand(92, 132), sp, flap: rand(0, TAU), state: 'fly', flower: null, until: 0, push: { x: 0, y: 0 }, t: rand(0, 100), sw: rand(0.4, 0.8) };
    };
    const makePetal = () => ({ x: rand(0, W), y: rand(-40, H), vx: rand(8, 22), vy: rand(14, 30), rot: rand(0, TAU), vr: rand(-1.4, 1.4), s: rand(6, 11), c: pick(PETAL_COLORS), ph: rand(0, TAU), z: rand(0.6, 1) });

    function resize(w, h, d) {
      W = w; H = h; dpr = d;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const area = (W * H) / (1280 * 800);
      const want = (n) => Math.max(2, Math.round(n * area));
      flowers = Array.from({ length: want(15) }, makeFlower).sort((a, b) => a.y - b.y);
      grass = Array.from({ length: Math.round(W / 9) }, (_, i) => ({ x: (i / (W / 9)) * W + rand(-5, 5), h: rand(0.05, 0.16) * H, ph: rand(0, TAU), w: rand(2.5, 5.5), s: rand(0.35, 1), front: Math.random() < 0.45 }));
      petals = Array.from({ length: want(26) }, makePetal);
      pollen = Array.from({ length: want(70) }, () => ({ x: rand(0, W), y: rand(0, H), r: rand(0.8, 2.4), vy: rand(-6, -1), vx: rand(-4, 6), ph: rand(0, TAU), a: rand(0.35, 0.9) }));
      bokeh = Array.from({ length: want(14) }, () => ({ x: rand(0, W), y: rand(0, H * 0.7), r: rand(24, 80), a: rand(0.05, 0.14), ph: rand(0, TAU), vx: rand(-4, 4) }));
      flies = Array.from({ length: clamp(want(6), 4, 9) }, makeFly);
    }

    function stepFly(f, dt) {
      f.t += dt;
      const gx = f.push.x, gy = f.push.y;
      f.push.x *= Math.exp(-1.8 * dt); f.push.y *= Math.exp(-1.8 * dt);
      if (f.state === 'rest') {
        f.flap += dt * 1.6;
        if (clock > f.until) { f.state = 'fly'; f.flower = null; f.heading = rand(0, TAU); }
        return;
      }
      // wander, with a pull to a flower now and then
      f.heading += Math.sin(f.t * 0.9 + f.sw * 6) * 1.5 * dt + Math.sin(f.t * 0.37 + f.sw) * 1.0 * dt;
      const margin = 80;
      const near = Math.max((margin - f.x) / margin, (f.x - (W - margin)) / margin, (margin - f.y) / margin, (f.y - (H * 0.86 - margin)) / margin, 0);
      if (near > 0) f.heading += angleDiff(Math.atan2(H * 0.4 - f.y, W / 2 - f.x), f.heading) * Math.min(1, near) * 2.4 * dt;
      if (f.flower) {
        const fl = f.flower, tx = fl.x, ty = fl.y - fl.stem * 0.0;
        f.heading += angleDiff(Math.atan2(ty - f.y, tx - f.x), f.heading) * 2.2 * dt;
        if (Math.hypot(tx - f.x, ty - f.y) < 14) { f.state = 'rest'; f.until = clock + rand(3.5, 7); f.x = tx; f.y = ty; f.heading = -Math.PI / 2 + rand(-0.6, 0.6); return; }
      } else if (Math.random() < dt * 0.18 && flowers.length) {
        f.flower = pick(flowers);
      }
      f.flap += dt * (13 + Math.sin(f.t * 2.2) * 3);
      const sp = (48 + 30 * Math.sin(f.t * 1.4 + f.sw)) * (0.75 + 0.5 * Math.max(0, Math.sin(f.flap)));
      f.x += Math.cos(f.heading) * sp * dt + gx * dt;
      f.y += Math.sin(f.heading) * sp * dt + Math.sin(f.t * 3.1) * 14 * dt + gy * dt;
      if (f.x < -120 || f.x > W + 120 || f.y < -120 || f.y > H + 120) { f.x = rand(0.2 * W, 0.8 * W); f.y = rand(0.2 * H, 0.7 * H); }
    }

    function advance(dt) {
      if (destroyed) return;
      clock += dt;
      for (const f of flies) stepFly(f, dt);
      const ease = 1 - Math.exp(-1.4 * dt); // petals settle back to their drift after a gust
      for (const p of petals) {
        p.vx += (14 - p.vx) * ease; p.vy += (22 - p.vy) * ease; p.vr *= 1 - 0.8 * ease;
        p.x += (p.vx + Math.sin(clock * 0.8 + p.ph) * 14) * dt * p.z;
        p.y += p.vy * dt * p.z;
        p.rot += p.vr * dt;
        if (p.y > H + 20 || p.x > W + 30) { p.y = -20; p.x = rand(-40, W * 0.9); }
      }
      for (const q of pollen) {
        q.x += (q.vx + Math.sin(clock * 0.6 + q.ph) * 6) * dt; q.y += q.vy * dt;
        if (q.y < -6) { q.y = H + 6; q.x = rand(0, W); }
        if (q.x > W + 6) q.x = -6;
      }
      for (const b of bokeh) { b.x += b.vx * dt; if (b.x > W + 90) b.x = -90; if (b.x < -90) b.x = W + 90; }
      for (const g of gusts) g.age += dt;
      gusts = gusts.filter((g) => g.age < 2.2);
      for (const fl of flowers) fl.push *= Math.exp(-1.6 * dt);
      draw();
    }

    function drawBackground() {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#ffe6bd'); g.addColorStop(0.45, '#ffd9b3'); g.addColorStop(0.7, '#cfe3a2'); g.addColorStop(1, '#7fb86c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const sun = ctx.createRadialGradient(W * 0.82, H * 0.08, 0, W * 0.82, H * 0.08, Math.max(W, H) * 0.6);
      sun.addColorStop(0, 'rgba(255,252,225,0.95)'); sun.addColorStop(0.25, 'rgba(255,240,190,0.45)'); sun.addColorStop(1, 'rgba(255,230,170,0)');
      ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of bokeh) {
        ctx.fillStyle = `rgba(255,244,205,${b.a * (0.7 + 0.3 * Math.sin(clock * 0.5 + b.ph))})`;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawGrass(front) {
      const base = H;
      for (const b of grass) {
        if (b.front !== front) continue;
        const gust = gusts.reduce((s, g) => s + Math.max(0, 1 - g.age / 2.2) * Math.exp(-Math.abs(b.x - g.x) / 260) * Math.sin(g.age * 8 - b.x * 0.02), 0);
        const sway = Math.sin(clock * 0.9 + b.ph + b.x * 0.01) * 10 * b.s + gust * 36;
        const hh = b.h * (front ? 1.15 : 0.9);
        ctx.fillStyle = front ? `rgba(${40 + b.s * 40},${105 + b.s * 55},${50},0.95)` : `rgba(${90 + b.s * 30},${160 + b.s * 30},${95},0.8)`;
        ctx.beginPath();
        ctx.moveTo(b.x - b.w, base);
        ctx.quadraticCurveTo(b.x - b.w * 0.2 + sway * 0.4, base - hh * 0.55, b.x + sway, base - hh);
        ctx.quadraticCurveTo(b.x + b.w * 0.5 + sway * 0.45, base - hh * 0.5, b.x + b.w, base);
        ctx.closePath(); ctx.fill();
      }
    }

    function drawFlower(fl) {
      const gust = gusts.reduce((s, g) => s + Math.max(0, 1 - g.age / 2.2) * Math.exp(-Math.hypot(fl.x - g.x, fl.y - g.y) / 300) * Math.sin(g.age * 7 - fl.x * 0.02), 0);
      const sway = Math.sin(clock * 0.8 + fl.ph) * 5 + gust * 16;
      const hx = fl.x + sway, hy = fl.y;
      ctx.strokeStyle = 'rgba(70,140,70,0.9)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fl.x - sway * 0.2, Math.min(H, fl.y + fl.stem)); ctx.quadraticCurveTo(fl.x + sway * 0.1, fl.y + fl.stem * 0.5, hx, hy); ctx.stroke();
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(sway * 0.02);
      for (let i = 0; i < fl.n; i++) {
        ctx.save();
        ctx.rotate((i / fl.n) * TAU);
        const g = ctx.createLinearGradient(0, 0, 0, -fl.r);
        g.addColorStop(0, fl.cen); g.addColorStop(0.3, fl.pet); g.addColorStop(1, fl.pet);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(0, -fl.r * 0.62, fl.r * 0.2, fl.r * 0.42, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, fl.r * 0.3);
      cg.addColorStop(0, '#fff1a8'); cg.addColorStop(1, fl.cen);
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, 0, fl.r * 0.3, 0, TAU); ctx.fill();
      ctx.restore();
    }

    function drawFly(f) {
      const S = f.size;
      const open = f.state === 'rest' ? 0.55 + 0.35 * Math.sin(f.flap) : 0.5 + 0.5 * Math.cos(f.flap);
      const span = 0.16 + 0.84 * open;
      ctx.save();
      ctx.translate(f.x, f.y + (f.state === 'fly' ? Math.sin(f.flap * 0.5) * 3 : 0));
      ctx.rotate(f.heading);
      // soft shadow
      ctx.save();
      ctx.translate(S * 0.1, S * 0.16); ctx.globalAlpha = 0.12; ctx.fillStyle = '#1d2a14';
      ctx.scale(1, span); wingPath(ctx, FORE, S * 0.5); ctx.fill();
      ctx.scale(1, -1); wingPath(ctx, FORE, S * 0.5); ctx.fill();
      ctx.restore();
      for (const side of [1, -1]) {
        ctx.save();
        ctx.scale(1, side * span);
        for (const [w, back] of [[HIND, true], [FORE, false]]) {
          const sc = S * 0.5;
          const g = ctx.createLinearGradient(0, 0, 0, sc);
          g.addColorStop(0, f.sp.a); g.addColorStop(1, f.sp.b);
          ctx.fillStyle = g;
          wingPath(ctx, w, sc); ctx.fill();
          ctx.strokeStyle = f.sp.edge; ctx.lineWidth = Math.max(1.4, S * 0.03); ctx.lineJoin = 'round'; ctx.stroke();
          ctx.save(); wingPath(ctx, w, sc); ctx.clip();
          ctx.strokeStyle = f.sp.vein; ctx.lineWidth = 1;
          for (let i = 0; i < 5; i++) {
            const a = 0.15 + i * 0.2, ex = w[2][4] * sc, ey = w[2][5] * sc;
            ctx.beginPath(); ctx.moveTo(w[0][0] * sc, w[0][1] * sc);
            ctx.quadraticCurveTo(ex * (0.4 + a * 0.4), ey * (0.2 + a), ex * (0.9 - a * 0.5), ey * (0.55 + a * 0.6)); ctx.stroke();
          }
          ctx.fillStyle = f.sp.dots;
          for (let i = 0; i < 4; i++) { const t = 0.25 + i * 0.2; ctx.beginPath(); ctx.arc(w[2][4] * sc * (0.55 + t * 0.4), w[2][5] * sc * (0.9 - t * 0.2), Math.max(1.4, S * 0.022), 0, TAU); ctx.fill(); }
          ctx.restore();
        }
        ctx.restore();
      }
      // body and antennae
      ctx.fillStyle = f.sp.edge;
      ctx.beginPath(); ctx.ellipse(0, 0, S * 0.3, S * 0.05, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(S * 0.31, 0, S * 0.045, 0, TAU); ctx.fill();
      ctx.strokeStyle = f.sp.edge; ctx.lineWidth = 1.2;
      for (const sd of [1, -1]) { ctx.beginPath(); ctx.moveTo(S * 0.33, sd * S * 0.02); ctx.quadraticCurveTo(S * 0.45, sd * S * 0.08, S * 0.5, sd * S * 0.16 + Math.sin(clock * 3) * 2); ctx.stroke(); }
      ctx.restore();
    }

    function drawPetal(p) {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.scale(1, 0.55 + 0.45 * Math.cos(p.rot * 1.7));
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }

    function draw() {
      if (overlay) ctx.clearRect(0, 0, W, H); else drawBackground();
      if (!overlay) { drawGrass(false); for (const fl of flowers) drawFlower(fl); }
      for (const q of pollen) { ctx.fillStyle = `rgba(255,248,200,${q.a * (0.6 + 0.4 * Math.sin(clock * 1.5 + q.ph))})`; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU); ctx.fill(); }
      for (const f of flies.filter((x) => x.state === 'rest')) drawFly(f);
      for (const p of petals) drawPetal(p);
      for (const f of flies.filter((x) => x.state !== 'rest')) drawFly(f);
      if (!overlay) drawGrass(true);
    }

    function poke(x, y) {
      gusts.push({ x, y, age: 0 });
      for (const f of flies) {
        const dx = f.x - x, dy = f.y - y, d = Math.hypot(dx, dy) || 1;
        const k = Math.max(0, 1 - d / 460);
        f.push.x += (dx / d) * 520 * k; f.push.y += (dy / d) * 520 * k;
        if (f.state === 'rest' && k > 0.15) { f.state = 'fly'; f.flower = null; f.heading = Math.atan2(dy, dx); }
        else f.heading += angleDiff(Math.atan2(dy, dx), f.heading) * k;
      }
      for (const p of petals) {
        const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1, k = Math.max(0, 1 - d / 420);
        p.vx += (dx / d) * 240 * k; p.vy += (dy / d) * 240 * k - 60 * k; p.vr += rand(-4, 4) * k;
        p.vx = clamp(p.vx, -300, 300); p.vy = clamp(p.vy, -200, 240);
      }
    }
    resize(o.W, o.H, o.dpr);
    for (let i = 0; i < 60; i++) advance(1 / 30);
    return {
      resize, advance, poke,
      destroy() { destroyed = true; },
      params: { refr: 0.0045, spec: 0.0, damp: 0.975, shade: 0.12, tint: [1, 1, 1] },
    };
  }
  if (AM.Living) AM.Living.themes.butterflies = create;
})();
