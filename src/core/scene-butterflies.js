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
  const FORE = [[0.16, 0.03], [0.42, 0.34, 0.5, 0.84, 0.26, 1.02], [0.04, 1.14, -0.2, 0.9, -0.24, 0.6], [-0.26, 0.34, -0.14, 0.1, -0.06, 0.03]];
  const HIND = [[-0.05, 0.03], [0.04, 0.34, 0.0, 0.66, -0.22, 0.82], [-0.46, 0.96, -0.64, 0.66, -0.52, 0.38], [-0.44, 0.2, -0.22, 0.08, -0.08, 0.03]];
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
    const dk = !!o.blend && o.tone === 'dark'; // dark page: a twilight garden that screens into it
    let W = 1, H = 1, dpr = 1, clock = 0, destroyed = false;
    let obstacles = [];
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
        if (clock > f.until || (obstacles.length && AM.Living.avoid(f.x, f.y, f.size * 0.4, obstacles))) { f.state = 'fly'; f.flower = null; f.heading = rand(0, TAU); }
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
        const fl = pick(flowers);
        if (!AM.Living.avoid(fl.x, fl.y, f.size * 0.4, obstacles)) f.flower = fl; // never settle on a flower that sits over text
      }
      if (obstacles.length) {
        const hit = AM.Living.avoid(f.x, f.y, f.size * 0.45, obstacles);
        if (hit) {
          f.heading += angleDiff(Math.atan2(hit.y, hit.x), f.heading) * Math.min(1, 3 + hit.d / 40) * dt * 3;
          f.x += hit.x * 90 * dt; f.y += hit.y * 90 * dt;
          if (f.flower) f.flower = null;
        }
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
      if (dk) { g.addColorStop(0, '#0b1d2a'); g.addColorStop(0.5, '#10302f'); g.addColorStop(1, '#16452f'); }
      else { g.addColorStop(0, '#ffe6bd'); g.addColorStop(0.45, '#ffd9b3'); g.addColorStop(0.7, '#cfe3a2'); g.addColorStop(1, '#7fb86c'); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const sun = ctx.createRadialGradient(W * 0.82, H * 0.08, 0, W * 0.82, H * 0.08, Math.max(W, H) * 0.6);
      sun.addColorStop(0, dk ? 'rgba(255,236,190,0.28)' : 'rgba(255,252,225,0.95)'); sun.addColorStop(0.25, dk ? 'rgba(255,220,160,0.12)' : 'rgba(255,240,190,0.45)'); sun.addColorStop(1, 'rgba(255,230,170,0)');
      ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of bokeh) {
        const al = b.a * 0.75 * (0.7 + 0.3 * Math.sin(clock * 0.5 + b.ph));
        const bgr = ctx.createRadialGradient(b.x, b.y, b.r * 0.2, b.x, b.y, b.r);
        bgr.addColorStop(0, `rgba(255,246,214,${al * 0.55})`); bgr.addColorStop(0.8, `rgba(255,240,200,${al})`); bgr.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.fillStyle = bgr; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
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
        ctx.fillStyle = dk
          ? (front ? `rgba(${12 + b.s * 14},${52 + b.s * 34},${34},0.95)` : `rgba(${22 + b.s * 12},${74 + b.s * 26},${48},0.85)`)
          : (front ? `rgba(${40 + b.s * 40},${105 + b.s * 55},${50},0.95)` : `rgba(${90 + b.s * 30},${160 + b.s * 30},${95},0.8)`);
        ctx.beginPath();
        ctx.moveTo(b.x - b.w, base);
        ctx.quadraticCurveTo(b.x - b.w * 0.2 + sway * 0.4, base - hh * 0.55, b.x + sway, base - hh);
        ctx.quadraticCurveTo(b.x + b.w * 0.5 + sway * 0.45, base - hh * 0.5, b.x + b.w, base);
        ctx.closePath(); ctx.fill();
      }
    }

    // A flower's petals never change, so they are drawn once to a small canvas and moved each frame.
    function renderFlower(fl) {
      const pad = Math.ceil(fl.r * 1.4), px = Math.ceil(pad * 2 * dpr);
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const x = c.getContext('2d');
      x.scale(px / (pad * 2), px / (pad * 2));
      x.translate(pad, pad);
      const sh = x.createRadialGradient(2, 4, fl.r * 0.2, 2, 4, fl.r * 1.2); // one soft shadow
      sh.addColorStop(0, 'rgba(60,40,20,0.2)'); sh.addColorStop(1, 'rgba(60,40,20,0)');
      x.fillStyle = sh; x.beginPath(); x.arc(2, 4, fl.r * 1.2, 0, TAU); x.fill();
      for (let layer = 0; layer < 2; layer++) {
        for (let i = 0; i < fl.n; i++) {
          x.save();
          x.rotate((i / fl.n) * TAU + layer * (Math.PI / fl.n));
          const L = fl.r * (layer ? 0.78 : 1);
          const g = x.createLinearGradient(0, 0, 0, -L);
          g.addColorStop(0, fl.cen); g.addColorStop(0.22, fl.pet); g.addColorStop(0.75, fl.pet); g.addColorStop(1, 'rgba(255,255,255,0.65)');
          x.fillStyle = g;
          x.beginPath();
          x.moveTo(0, 0);
          x.bezierCurveTo(L * 0.34, -L * 0.2, L * 0.3, -L * 0.85, 0, -L);
          x.bezierCurveTo(-L * 0.3, -L * 0.85, -L * 0.34, -L * 0.2, 0, 0);
          x.fill();
          x.strokeStyle = 'rgba(0,0,0,0.08)'; x.lineWidth = 0.8;
          x.beginPath(); x.moveTo(0, -L * 0.15); x.lineTo(0, -L * 0.8); x.stroke();
          x.restore();
        }
      }
      const cg = x.createRadialGradient(0, 0, 0, 0, 0, fl.r * 0.3);
      cg.addColorStop(0, '#fff1a8'); cg.addColorStop(1, fl.cen);
      x.fillStyle = cg; x.beginPath(); x.arc(0, 0, fl.r * 0.3, 0, TAU); x.fill();
      fl.sprite = c; fl.pad = pad;
    }

    function drawFlower(fl) {
      if (!fl.sprite) renderFlower(fl);
      const gust = gusts.reduce((s, g) => s + Math.max(0, 1 - g.age / 2.2) * Math.exp(-Math.hypot(fl.x - g.x, fl.y - g.y) / 300) * Math.sin(g.age * 7 - fl.x * 0.02), 0);
      const sway = Math.sin(clock * 0.8 + fl.ph) * 5 + gust * 16;
      const hx = fl.x + sway, hy = fl.y;
      ctx.strokeStyle = 'rgba(70,140,70,0.9)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fl.x - sway * 0.2, Math.min(H, fl.y + fl.stem)); ctx.quadraticCurveTo(fl.x + sway * 0.1, fl.y + fl.stem * 0.5, hx, hy); ctx.stroke();
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(sway * 0.02);
      if (fl.y < H * 0.62) ctx.globalAlpha = 0.82; // the far ones sit back a little
      ctx.drawImage(fl.sprite, -fl.pad, -fl.pad, fl.pad * 2, fl.pad * 2);
      ctx.restore();
    }

    function drawFly(f) {
      const S = f.size;
      const sp = f.sp;
      const open = f.state === 'rest' ? 0.55 + 0.35 * Math.sin(f.flap) : 0.5 + 0.5 * Math.cos(f.flap);
      const span = 0.14 + 0.86 * open;
      const blurSpan = f.state === 'fly' ? 0.14 + 0.86 * (0.5 + 0.5 * Math.cos(f.flap - 0.9)) : null;
      const sc = S * 0.5;
      const wings = (spanK, alpha) => {
        for (const side of [1, -1]) {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.scale(1, side * spanK);
          for (const w of [HIND, FORE]) {
            const g = ctx.createRadialGradient(0.05 * sc, 0.05 * sc, 0, 0.05 * sc, 0.3 * sc, sc * 0.95);
            g.addColorStop(0, sp.b); g.addColorStop(0.55, sp.a); g.addColorStop(1, sp.a);
            wingPath(ctx, w, sc);
            ctx.fillStyle = g; ctx.fill();
            ctx.save(); wingPath(ctx, w, sc); ctx.clip();
            if (sp.name === 'morpho') {
              const ir = ctx.createLinearGradient(-0.4 * sc, 0, 0.4 * sc, sc);
              ir.addColorStop(0, 'rgba(120,230,255,0.55)'); ir.addColorStop(0.5, 'rgba(60,120,255,0)'); ir.addColorStop(1, 'rgba(170,120,255,0.4)');
              ctx.fillStyle = ir; ctx.fillRect(-sc, -sc * 0.2, sc * 2, sc * 1.6);
            }
            // veins
            ctx.strokeStyle = sp.vein; ctx.lineWidth = Math.max(0.8, S * 0.011); ctx.lineCap = 'round';
            const ex = w[2][4] * sc, ey = w[2][5] * sc;
            for (let i = 0; i < 7; i++) {
              const a = i / 6;
              ctx.beginPath(); ctx.moveTo(w[0][0] * sc, w[0][1] * sc);
              ctx.quadraticCurveTo(ex * (0.5 + a * 0.3) + (a - 0.5) * sc * 0.2, ey * (0.25 + a * 0.5), ex * (1.0 - a * 0.7) + (a - 0.5) * sc * 0.3, ey * (0.7 + a * 0.35));
              ctx.stroke();
            }
            // dark margin band, then pale dots in it
            ctx.strokeStyle = sp.edge; ctx.lineWidth = S * (sp.name === 'morpho' ? 0.07 : 0.12); ctx.lineJoin = 'round';
            wingPath(ctx, w, sc); ctx.stroke();
            if (sp.name !== 'morpho') {
              ctx.fillStyle = sp.dots;
              for (let i = 0; i < 7; i++) {
                const t = (i + 0.5) / 7;
                const bx = (w[2][4] + (w[1][4] - w[2][4]) * 0 + 0) * sc;
                const px = w === FORE ? (0.3 - t * 0.5) * sc : (-0.05 - t * 0.45) * sc;
                const py = w === FORE ? (0.97 - Math.abs(t - 0.4) * 0.35) * sc : (0.8 - Math.abs(t - 0.45) * 0.5) * sc;
                ctx.beginPath(); ctx.arc(px, py, Math.max(1.2, S * 0.014), 0, TAU); ctx.fill();
              }
            }
            // soft light on the leading edge
            const hl = ctx.createLinearGradient(0, 0, 0, sc);
            hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.6, 'rgba(255,255,255,0.14)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = hl; ctx.fillRect(-sc, 0, sc * 2, sc * 1.2);
            ctx.restore();
          }
          ctx.restore();
        }
      };
      ctx.save();
      ctx.translate(f.x, f.y + (f.state === 'fly' ? Math.sin(f.flap * 0.5) * 3 : 0));
      ctx.rotate(f.heading);
      // soft blurred shadow, cast to the lower right
      ctx.save();
      const far = 20000;
      ctx.translate(-far * Math.cos(f.heading) + 0, 0);
      ctx.restore();
      ctx.save();
      ctx.shadowColor = 'rgba(40,50,20,0.28)'; ctx.shadowBlur = S * 0.08 * dpr;
      ctx.shadowOffsetX = S * 0.1 * dpr; ctx.shadowOffsetY = S * 0.2 * dpr;
      ctx.globalAlpha = 0.01; ctx.fillStyle = '#000';
      ctx.scale(1, span); wingPath(ctx, FORE, sc); ctx.fill(); ctx.scale(1, -1); wingPath(ctx, FORE, sc); ctx.fill();
      ctx.restore();
      if (blurSpan != null) wings(blurSpan, 0.3); // the other half of the flap, ghosted
      wings(span, 1);
      // body
      const bg = ctx.createLinearGradient(0, -S * 0.05, 0, S * 0.05);
      bg.addColorStop(0, '#5a4a3a'); bg.addColorStop(0.5, sp.edge); bg.addColorStop(1, '#2a2018');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.ellipse(-S * 0.06, 0, S * 0.27, S * 0.04, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(S * 0.2, 0, S * 0.1, S * 0.055, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(S * 0.3, 0, S * 0.04, 0, TAU); ctx.fill();
      ctx.strokeStyle = sp.edge; ctx.lineWidth = Math.max(1, S * 0.012); ctx.lineCap = 'round';
      for (const sd of [1, -1]) {
        const wob = Math.sin(clock * 3 + sd) * 2;
        ctx.beginPath(); ctx.moveTo(S * 0.33, sd * S * 0.015);
        ctx.quadraticCurveTo(S * 0.45, sd * S * 0.07, S * 0.52, sd * S * 0.17 + wob); ctx.stroke();
        ctx.fillStyle = sp.edge; ctx.beginPath(); ctx.arc(S * 0.52, sd * S * 0.17 + wob, S * 0.014, 0, TAU); ctx.fill();
      }
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
      setObstacles(r) { obstacles = r || []; },
      destroy() { destroyed = true; },
      params: { refr: 0.0045, spec: 0.0, damp: 0.975, shade: 0.12, tint: [1, 1, 1] },
    };
  }
  if (AM.Living) AM.Living.themes.butterflies = create;
})();
