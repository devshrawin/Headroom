/*
 * Fluid background: a trimmed port of "WebGL Fluid Simulation" by Pavel Dobryakov
 * (https://github.com/PavelDoGreat/WebGL-Fluid-Simulation), used under the MIT licence below.
 *
 * MIT License
 *
 * Copyright (c) 2017 Pavel Dobryakov
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// What changed from the original: the GUI, sunrays, screenshot, dithering texture, background image/colour options and every
// outside hook are gone (no network, no assets); the settings are fixed and lighter (page backgrounds on laptop GPUs); the
// canvas sits behind the page (z-index -1, pointer-events none), so input is read from the window instead; and it runs its
// own throttled, pausable loop that stands still for reduced motion.
(() => {
  const AM = globalThis.Headroom;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Fixed settings. Lower resolutions and fewer iterations than the original defaults: this is a backdrop, not the main show.
  const CFG = {
    SIM_RESOLUTION: 128, DYE_RESOLUTION: 512,
    DENSITY_DISSIPATION: 0.97, VELOCITY_DISSIPATION: 0.98, PRESSURE_DISSIPATION: 0.8, PRESSURE_ITERATIONS: 12,
    CURL: 30, SPLAT_RADIUS: 0.25,
    BLOOM_ITERATIONS: 6, BLOOM_RESOLUTION: 128, BLOOM_INTENSITY: 0.8, BLOOM_THRESHOLD: 0.6, BLOOM_SOFT_KNEE: 0.7,
  };
  const FRAME_MS = 33;        // ~30 fps is plenty for a background
  const DT_MAX = 0.0166 * 2;  // a stalled frame must not blow the simulation up
  const STATIC_STEPS = 40;    // reduced motion: how far the fluid develops before the one still frame

  // ---- shaders (the original's, minus the dithering and sunrays ones) ----
  const BASE_VERT = `
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main () {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const CLEAR_FRAG = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;

    void main () {
      gl_FragColor = value * texture2D(uTexture, vUv);
    }
  `;

  // The four display variants (plain / bloom / shading / bloom + shading) of the original, built from one template. Shading
  // lights the dye like a bumpy surface; bloom adds the blurred bright parts back on top.
  const displayFrag = (shading, bloom) => `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    ${shading ? 'varying vec2 vL;\n    varying vec2 vR;\n    varying vec2 vT;\n    varying vec2 vB;' : ''}
    uniform sampler2D uTexture;
    ${bloom ? 'uniform sampler2D uBloom;' : ''}
    ${shading ? 'uniform vec2 texelSize;' : ''}

    void main () {
      vec3 C = texture2D(uTexture, vUv).rgb;
      ${shading ? `
      vec3 L = texture2D(uTexture, vL).rgb;
      vec3 R = texture2D(uTexture, vR).rgb;
      vec3 T = texture2D(uTexture, vT).rgb;
      vec3 B = texture2D(uTexture, vB).rgb;

      float dx = length(R) - length(L);
      float dy = length(T) - length(B);

      vec3 n = normalize(vec3(dx, dy, length(texelSize)));
      vec3 l = vec3(0.0, 0.0, 1.0);

      float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
      C *= diffuse;` : ''}
      ${bloom ? `
      vec3 bloom = texture2D(uBloom, vUv).rgb;
      bloom = pow(bloom.rgb, vec3(1.0 / 2.2));
      C += bloom;` : ''}
      // A background, not a light show: the page's text is white on top of this, so the brightness is capped where text stays
      // readable (encoded luminance .42 is about 5:1 against white). Scaling keeps the hue.
      float lum = dot(C, vec3(0.2126, 0.7152, 0.0722));
      C *= min(1.0, 0.42 / max(lum, 0.0001));
      float a = max(C.r, max(C.g, C.b));
      gl_FragColor = vec4(C, a);
    }
  `;

  const BLOOM_PREFILTER_FRAG = `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 curve;
    uniform float threshold;

    void main () {
      vec3 c = texture2D(uTexture, vUv).rgb;
      float br = max(c.r, max(c.g, c.b));
      float rq = clamp(br - curve.x, 0.0, curve.y);
      rq = curve.z * rq * rq;
      c *= max(rq, br - threshold) / max(br, 0.0001);
      gl_FragColor = vec4(c, 0.0);
    }
  `;

  const BLOOM_BLUR_FRAG = `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;

    void main () {
      vec4 sum = vec4(0.0);
      sum += texture2D(uTexture, vL);
      sum += texture2D(uTexture, vR);
      sum += texture2D(uTexture, vT);
      sum += texture2D(uTexture, vB);
      sum *= 0.25;
      gl_FragColor = sum;
    }
  `;

  const BLOOM_FINAL_FRAG = `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform float intensity;

    void main () {
      vec4 sum = vec4(0.0);
      sum += texture2D(uTexture, vL);
      sum += texture2D(uTexture, vR);
      sum += texture2D(uTexture, vT);
      sum += texture2D(uTexture, vB);
      sum *= 0.25;
      gl_FragColor = sum * intensity;
    }
  `;

  const SPLAT_FRAG = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;

    void main () {
      vec2 p = vUv - point.xy;
      p.x *= aspectRatio;
      vec3 splat = exp(-dot(p, p) / radius) * color;
      vec3 base = texture2D(uTarget, vUv).xyz;
      gl_FragColor = vec4(base + splat, 1.0);
    }
  `;

  // Used when the GPU cannot filter half-float textures: the same bilinear sample, done by hand.
  const ADVECTION_MANUAL_FRAG = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;

    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
      vec2 st = uv / tsize - 0.5;

      vec2 iuv = floor(st);
      vec2 fuv = fract(st);

      vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
      vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
      vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
      vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

      return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }

    void main () {
      vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
      gl_FragColor = dissipation * bilerp(uSource, coord, dyeTexelSize);
      gl_FragColor.a = 1.0;
    }
  `;

  const ADVECTION_FRAG = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;

    void main () {
      vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
      gl_FragColor = dissipation * texture2D(uSource, coord);
      gl_FragColor.a = 1.0;
    }
  `;

  const DIVERGENCE_FRAG = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
      float L = texture2D(uVelocity, vL).x;
      float R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y;
      float B = texture2D(uVelocity, vB).y;

      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) { L = -C.x; }
      if (vR.x > 1.0) { R = -C.x; }
      if (vT.y > 1.0) { T = -C.y; }
      if (vB.y < 0.0) { B = -C.y; }

      float div = 0.5 * (R - L + T - B);
      gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
  `;

  const CURL_FRAG = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
      float L = texture2D(uVelocity, vL).y;
      float R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x;
      float B = texture2D(uVelocity, vB).x;
      float vorticity = R - L - T + B;
      gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
  `;

  const VORTICITY_FRAG = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;

    void main () {
      float L = texture2D(uCurl, vL).x;
      float R = texture2D(uCurl, vR).x;
      float T = texture2D(uCurl, vT).x;
      float B = texture2D(uCurl, vB).x;
      float C = texture2D(uCurl, vUv).x;

      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C;
      force.y *= -1.0;

      vec2 vel = texture2D(uVelocity, vUv).xy;
      gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
    }
  `;

  const PRESSURE_FRAG = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;

    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      float C = texture2D(uPressure, vUv).x;
      float divergence = texture2D(uDivergence, vUv).x;
      float pressure = (L + R + B + T - divergence) * 0.25;
      gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
  `;

  const GRADIENT_SUBTRACT_FRAG = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;

    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity.xy -= vec2(R - L, T - B);
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
  `;

  // ---- colour: random hues at full saturation, dim (x0.3, the original uses x0.15 on a black screen) so the fluid stays a background ----
  function HSVtoRGB(h, s, v) {
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q; break;
    }
    return { r, g, b };
  }
  function generateColor() {
    const c = HSVtoRGB(Math.random(), 1.0, 1.0);
    c.r *= 0.3; c.g *= 0.3; c.b *= 0.3;
    return c;
  }

  const isMobile = () => /Mobi|Android/i.test(navigator.userAgent);

  // opts: { strength: 0.2..1, onLost() }. Returns null when WebGL is not available.
  // The canvas goes after the sky canvas in <html> and behind the page (z-index -1). onLost is called once if the GL context is
  // lost, after the module has already destroyed itself.
  function mount(opts = {}) {
    const doc = document, win = window;
    const canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('data-headroom', 'fluid');
    let strength = clamp(+opts.strength || 1, 0.2, 1);
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '-1', pointerEvents: 'none', opacity: String(strength), background: 'black' });

    let gl = null;
    let ext = null;
    let shading = !isMobile();
    let bloomOn = true;
    const programs = [], shaders = [], buffers = [];
    let program = {}, displayProgram = null;
    let blit = null;
    let simW = 0, simH = 0, dyeW = 0, dyeH = 0, bloomW = 0, bloomH = 0;
    let density = null, velocity = null, divergence = null, curl = null, pressure = null, bloom = null;
    const bloomFbos = [];
    let W = 0, H = 0;
    let lost = false, destroyed = false;

    // ---- GL setup: any failure here returns null, and the context is given back ----
    const releaseGL = () => {
      if (!gl) return;
      try {
        const kill = (f) => { if (f) { gl.deleteFramebuffer(f.fbo); gl.deleteTexture(f.texture); } };
        for (const d of [density, velocity, pressure]) if (d) { kill(d.read); kill(d.write); }
        kill(divergence); kill(curl); kill(bloom);
        bloomFbos.forEach(kill); bloomFbos.length = 0;
        programs.forEach((p) => gl.deleteProgram(p));
        shaders.forEach((s) => gl.deleteShader(s));
        buffers.forEach((b) => gl.deleteBuffer(b));
      } catch {}
      let lose = null;
      try { lose = gl.getExtension('WEBGL_lose_context'); } catch {}
      if (lose) { try { lose.loseContext(); } catch {} }
    };

    function supportRenderTextureFormat(internalFormat, format, type) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(texture);
      return ok;
    }

    // Falls back R16F -> RG16F -> RGBA16F when the GPU cannot render to the narrower format.
    function getSupportedFormat(internalFormat, format, type) {
      if (!supportRenderTextureFormat(internalFormat, format, type)) {
        switch (internalFormat) {
          case gl.R16F: return getSupportedFormat(gl.RG16F, gl.RG, type);
          case gl.RG16F: return getSupportedFormat(gl.RGBA16F, gl.RGBA, type);
          default: return null;
        }
      }
      return { internalFormat, format };
    }

    function setupContext() {
      const params = { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
      gl = canvas.getContext('webgl2', params);
      const isWebGL2 = !!gl;
      if (!isWebGL2) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
      if (!gl) throw new Error('no webgl');

      let halfFloat = null, linear;
      if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        linear = gl.getExtension('OES_texture_float_linear');
      } else {
        halfFloat = gl.getExtension('OES_texture_half_float');
        linear = gl.getExtension('OES_texture_half_float_linear');
        if (!halfFloat) throw new Error('no half float');
      }
      gl.clearColor(0.0, 0.0, 0.0, 1.0); // BACK_COLOR black, not transparent

      const type = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
      let rgba, rg, r;
      if (isWebGL2) {
        rgba = getSupportedFormat(gl.RGBA16F, gl.RGBA, type);
        rg = getSupportedFormat(gl.RG16F, gl.RG, type);
        r = getSupportedFormat(gl.R16F, gl.RED, type);
      } else {
        rgba = rg = r = getSupportedFormat(gl.RGBA, gl.RGBA, type);
      }
      if (!rgba || !rg || !r) throw new Error('no renderable float format');
      ext = { formatRGBA: rgba, formatRG: rg, formatR: r, halfFloatTexType: type, supportLinearFiltering: !!linear };
      // without linear filtering the lit surface and the glow look wrong, so the original turns both off
      if (!ext.supportLinearFiltering) { shading = false; bloomOn = false; }
    }

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
      return shader;
    }

    function makeProgram(vs, fragSource) {
      const p = gl.createProgram();
      programs.push(p);
      gl.attachShader(p, vs);
      gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fragSource));
      gl.bindAttribLocation(p, 0, 'aPosition'); // the quad buffer below feeds attribute 0
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
      const uniforms = {};
      for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
        const name = gl.getActiveUniform(p, i).name;
        uniforms[name] = gl.getUniformLocation(p, name);
      }
      return { program: p, uniforms, bind() { gl.useProgram(p); } };
    }

    function setupPrograms() {
      const vs = compileShader(gl.VERTEX_SHADER, BASE_VERT);
      program.clear = makeProgram(vs, CLEAR_FRAG);
      displayProgram = makeProgram(vs, displayFrag(shading, bloomOn));
      program.bloomPrefilter = makeProgram(vs, BLOOM_PREFILTER_FRAG);
      program.bloomBlur = makeProgram(vs, BLOOM_BLUR_FRAG);
      program.bloomFinal = makeProgram(vs, BLOOM_FINAL_FRAG);
      program.splat = makeProgram(vs, SPLAT_FRAG);
      program.advection = makeProgram(vs, ext.supportLinearFiltering ? ADVECTION_FRAG : ADVECTION_MANUAL_FRAG);
      program.divergence = makeProgram(vs, DIVERGENCE_FRAG);
      program.curl = makeProgram(vs, CURL_FRAG);
      program.vorticity = makeProgram(vs, VORTICITY_FRAG);
      program.pressure = makeProgram(vs, PRESSURE_FRAG);
      program.gradientSubtract = makeProgram(vs, GRADIENT_SUBTRACT_FRAG);

      const vb = gl.createBuffer(), ib = gl.createBuffer();
      buffers.push(vb, ib);
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(0);
      blit = (destination) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      };
    }

    // ---- framebuffers ----
    function createFBO(w, h, internalFormat, format, type, param) {
      gl.activeTexture(gl.TEXTURE0);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);

      return {
        texture, fbo, width: w, height: h,
        attach(id) {
          gl.activeTexture(gl.TEXTURE0 + id);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          return id;
        },
      };
    }
    const deleteFBO = (f) => { gl.deleteFramebuffer(f.fbo); gl.deleteTexture(f.texture); };

    function createDoubleFBO(w, h, internalFormat, format, type, param) {
      return {
        read: createFBO(w, h, internalFormat, format, type, param),
        write: createFBO(w, h, internalFormat, format, type, param),
        swap() { const t = this.read; this.read = this.write; this.write = t; },
      };
    }

    // Resizing keeps what is already on screen: the old contents are copied (scaled) into the new target.
    function resizeFBO(target, w, h, internalFormat, format, type, param) {
      const next = createFBO(w, h, internalFormat, format, type, param);
      program.clear.bind();
      gl.uniform1i(program.clear.uniforms.uTexture, target.attach(0));
      gl.uniform1f(program.clear.uniforms.value, 1);
      blit(next.fbo);
      return next;
    }

    function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
      const oldRead = target.read, oldWrite = target.write;
      target.read = resizeFBO(oldRead, w, h, internalFormat, format, type, param);
      target.write = createFBO(w, h, internalFormat, format, type, param);
      deleteFBO(oldRead); deleteFBO(oldWrite);
      return target;
    }

    function getResolution(resolution) {
      let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
      if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
      const max = Math.round(resolution * aspectRatio);
      const min = Math.round(resolution);
      return gl.drawingBufferWidth > gl.drawingBufferHeight ? { width: max, height: min } : { width: min, height: max };
    }

    // Runs only when the canvas size or aspect changes the grid sizes; a quality step that leaves them the same costs nothing.
    function initFramebuffers() {
      const simRes = getResolution(CFG.SIM_RESOLUTION);
      const dyeRes = getResolution(CFG.DYE_RESOLUTION);
      const bloomRes = getResolution(CFG.BLOOM_RESOLUTION);
      if (density && simRes.width === simW && simRes.height === simH && dyeRes.width === dyeW && dyeRes.height === dyeH
        && bloomRes.width === bloomW && bloomRes.height === bloomH) return;
      simW = simRes.width; simH = simRes.height;
      dyeW = dyeRes.width; dyeH = dyeRes.height;
      bloomW = bloomRes.width; bloomH = bloomRes.height;

      const texType = ext.halfFloatTexType;
      const rgba = ext.formatRGBA, rg = ext.formatRG, r = ext.formatR;
      const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
      gl.disable(gl.BLEND);

      if (density == null) density = createDoubleFBO(dyeW, dyeH, rgba.internalFormat, rgba.format, texType, filtering);
      else density = resizeDoubleFBO(density, dyeW, dyeH, rgba.internalFormat, rgba.format, texType, filtering);

      if (velocity == null) velocity = createDoubleFBO(simW, simH, rg.internalFormat, rg.format, texType, filtering);
      else velocity = resizeDoubleFBO(velocity, simW, simH, rg.internalFormat, rg.format, texType, filtering);

      // divergence, curl and pressure are scratch: rebuilt rather than copied
      if (divergence) deleteFBO(divergence);
      if (curl) deleteFBO(curl);
      if (pressure) { deleteFBO(pressure.read); deleteFBO(pressure.write); }
      divergence = createFBO(simW, simH, r.internalFormat, r.format, texType, gl.NEAREST);
      curl = createFBO(simW, simH, r.internalFormat, r.format, texType, gl.NEAREST);
      pressure = createDoubleFBO(simW, simH, r.internalFormat, r.format, texType, gl.NEAREST);

      if (bloom) deleteFBO(bloom);
      bloomFbos.forEach(deleteFBO);
      bloomFbos.length = 0;
      bloom = createFBO(bloomW, bloomH, rgba.internalFormat, rgba.format, texType, filtering);
      for (let i = 0; i < CFG.BLOOM_ITERATIONS; i++) {
        const width = bloomW >> (i + 1);
        const height = bloomH >> (i + 1);
        if (width < 2 || height < 2) break;
        bloomFbos.push(createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering));
      }
    }

    // ---- simulation ----
    function step(dt) {
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, simW, simH);
      const tx = 1.0 / simW, ty = 1.0 / simH;

      program.curl.bind();
      gl.uniform2f(program.curl.uniforms.texelSize, tx, ty);
      gl.uniform1i(program.curl.uniforms.uVelocity, velocity.read.attach(0));
      blit(curl.fbo);

      program.vorticity.bind();
      gl.uniform2f(program.vorticity.uniforms.texelSize, tx, ty);
      gl.uniform1i(program.vorticity.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(program.vorticity.uniforms.uCurl, curl.attach(1));
      gl.uniform1f(program.vorticity.uniforms.curl, CFG.CURL);
      gl.uniform1f(program.vorticity.uniforms.dt, dt);
      blit(velocity.write.fbo);
      velocity.swap();

      program.divergence.bind();
      gl.uniform2f(program.divergence.uniforms.texelSize, tx, ty);
      gl.uniform1i(program.divergence.uniforms.uVelocity, velocity.read.attach(0));
      blit(divergence.fbo);

      program.clear.bind();
      gl.uniform1i(program.clear.uniforms.uTexture, pressure.read.attach(0));
      gl.uniform1f(program.clear.uniforms.value, CFG.PRESSURE_DISSIPATION);
      blit(pressure.write.fbo);
      pressure.swap();

      program.pressure.bind();
      gl.uniform2f(program.pressure.uniforms.texelSize, tx, ty);
      gl.uniform1i(program.pressure.uniforms.uDivergence, divergence.attach(0));
      for (let i = 0; i < CFG.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(program.pressure.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write.fbo);
        pressure.swap();
      }

      program.gradientSubtract.bind();
      gl.uniform2f(program.gradientSubtract.uniforms.texelSize, tx, ty);
      gl.uniform1i(program.gradientSubtract.uniforms.uPressure, pressure.read.attach(0));
      gl.uniform1i(program.gradientSubtract.uniforms.uVelocity, velocity.read.attach(1));
      blit(velocity.write.fbo);
      velocity.swap();

      const adv = program.advection;
      adv.bind();
      gl.uniform2f(adv.uniforms.texelSize, tx, ty);
      if (!ext.supportLinearFiltering) gl.uniform2f(adv.uniforms.dyeTexelSize, tx, ty);
      const velocityId = velocity.read.attach(0);
      gl.uniform1i(adv.uniforms.uVelocity, velocityId);
      gl.uniform1i(adv.uniforms.uSource, velocityId);
      gl.uniform1f(adv.uniforms.dt, dt);
      gl.uniform1f(adv.uniforms.dissipation, CFG.VELOCITY_DISSIPATION);
      blit(velocity.write.fbo);
      velocity.swap();

      gl.viewport(0, 0, dyeW, dyeH);
      if (!ext.supportLinearFiltering) gl.uniform2f(adv.uniforms.dyeTexelSize, 1.0 / dyeW, 1.0 / dyeH);
      gl.uniform1i(adv.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(adv.uniforms.uSource, density.read.attach(1));
      gl.uniform1f(adv.uniforms.dissipation, CFG.DENSITY_DISSIPATION);
      blit(density.write.fbo);
      density.swap();
    }

    function applyBloom(source, destination) {
      if (bloomFbos.length < 2) return;
      let last = destination;

      gl.disable(gl.BLEND);
      const pre = program.bloomPrefilter;
      pre.bind();
      const knee = CFG.BLOOM_THRESHOLD * CFG.BLOOM_SOFT_KNEE + 0.0001;
      gl.uniform3f(pre.uniforms.curve, CFG.BLOOM_THRESHOLD - knee, knee * 2, 0.25 / knee);
      gl.uniform1f(pre.uniforms.threshold, CFG.BLOOM_THRESHOLD);
      gl.uniform1i(pre.uniforms.uTexture, source.attach(0));
      gl.viewport(0, 0, last.width, last.height);
      blit(last.fbo);

      const blur = program.bloomBlur;
      blur.bind();
      for (let i = 0; i < bloomFbos.length; i++) {
        const dest = bloomFbos[i];
        gl.uniform2f(blur.uniforms.texelSize, 1.0 / last.width, 1.0 / last.height);
        gl.uniform1i(blur.uniforms.uTexture, last.attach(0));
        gl.viewport(0, 0, dest.width, dest.height);
        blit(dest.fbo);
        last = dest;
      }

      gl.blendFunc(gl.ONE, gl.ONE);
      gl.enable(gl.BLEND);
      for (let i = bloomFbos.length - 2; i >= 0; i--) {
        const baseTex = bloomFbos[i];
        gl.uniform2f(blur.uniforms.texelSize, 1.0 / last.width, 1.0 / last.height);
        gl.uniform1i(blur.uniforms.uTexture, last.attach(0));
        gl.viewport(0, 0, baseTex.width, baseTex.height);
        blit(baseTex.fbo);
        last = baseTex;
      }

      gl.disable(gl.BLEND);
      const fin = program.bloomFinal;
      fin.bind();
      gl.uniform2f(fin.uniforms.texelSize, 1.0 / last.width, 1.0 / last.height);
      gl.uniform1i(fin.uniforms.uTexture, last.attach(0));
      gl.uniform1f(fin.uniforms.intensity, CFG.BLOOM_INTENSITY);
      gl.viewport(0, 0, destination.width, destination.height);
      blit(destination.fbo);
    }

    function render() {
      if (bloomOn) applyBloom(density.read, bloom);

      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
      const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      gl.viewport(0, 0, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clear(gl.COLOR_BUFFER_BIT); // black back colour

      displayProgram.bind();
      if (shading) gl.uniform2f(displayProgram.uniforms.texelSize, 1.0 / width, 1.0 / height);
      gl.uniform1i(displayProgram.uniforms.uTexture, density.read.attach(0));
      if (bloomOn) gl.uniform1i(displayProgram.uniforms.uBloom, bloom.attach(1));
      blit(null);
    }

    // x, y are 0..1 across the page (y from the top); dx, dy are the original's pointer velocity units
    function splat(x, y, dx, dy, color) {
      gl.disable(gl.BLEND);
      const sp = program.splat;
      gl.viewport(0, 0, simW, simH);
      sp.bind();
      gl.uniform1i(sp.uniforms.uTarget, velocity.read.attach(0));
      gl.uniform1f(sp.uniforms.aspectRatio, W / H);
      gl.uniform2f(sp.uniforms.point, x, 1.0 - y);
      gl.uniform3f(sp.uniforms.color, dx, -dy, 1.0);
      gl.uniform1f(sp.uniforms.radius, CFG.SPLAT_RADIUS / 100.0);
      blit(velocity.write.fbo);
      velocity.swap();

      gl.viewport(0, 0, dyeW, dyeH);
      gl.uniform1i(sp.uniforms.uTarget, density.read.attach(0));
      gl.uniform3f(sp.uniforms.color, color.r, color.g, color.b);
      blit(density.write.fbo);
      density.swap();
    }

    function multipleSplats(amount) {
      for (let i = 0; i < amount; i++) {
        const color = generateColor();
        color.r *= 3.0; color.g *= 3.0; color.b *= 3.0; // the original's x10 is a light show; this is a background
        splat(Math.random(), Math.random(), 1000 * (Math.random() - 0.5), 1000 * (Math.random() - 0.5), color);
      }
    }

    // ---- start: any failure above this point means "no fluid", never a half-built page ----
    try {
      setupContext();
      setupPrograms();
    } catch (e) {
      try { console.warn('[Headroom] fluid', e); } catch {}
      releaseGL();
      return null;
    }

    // ---- pointer input: read from the window, because the canvas is behind the page ----
    // The original's logic: the last move since the previous frame becomes one splat along the movement. Index 0 is the mouse,
    // the rest are touches. A pointer's first move only sets its position, so there is no streak from wherever it last was.
    const pointers = [];
    for (let i = 0; i < 6; i++) pointers.push({ x: 0, y: 0, dx: 0, dy: 0, down: false, moved: false, color: generateColor() });
    let lastColorChange = 0;
    let reduced = false;

    const moveTo = (p, x, y, gain) => {
      if (!p.down) { p.down = true; p.x = x; p.y = y; return; }
      p.dx = (x - p.x) * gain;
      p.dy = (y - p.y) * gain;
      p.x = x; p.y = y;
      p.moved = true;
    };
    const onMouseMove = (e) => {
      if (reduced || doc.hidden || lost || destroyed) return;
      moveTo(pointers[0], e.clientX, e.clientY, 5.0);
    };
    const onMouseLeave = () => { pointers[0].down = false; };
    const onTouch = (e) => {
      if (reduced || doc.hidden || lost || destroyed) return;
      const t = e.touches;
      for (let i = 0; i < t.length && i < pointers.length - 1; i++) moveTo(pointers[i + 1], t[i].clientX, t[i].clientY, 8.0);
    };
    const onTouchEnd = (e) => {
      const t = e.touches;
      for (let i = t.length; i < pointers.length - 1; i++) pointers[i + 1].down = false;
    };

    const applyInput = (now) => {
      const w = Math.max(1, win.innerWidth), h = Math.max(1, win.innerHeight);
      for (const p of pointers) {
        if (p.moved) { splat(p.x / w, p.y / h, p.dx, p.dy, p.color); p.moved = false; }
      }
      if (lastColorChange + 100 < now) { // pointer colour changes ten times a second
        lastColorChange = now;
        for (const p of pointers) p.color = generateColor();
      }
    };

    // ---- size: the canvas is drawn at k x the window size; k comes from the quality governor (a slow GPU draws fewer pixels) ----
    const gov = AM.WeatherSky && AM.WeatherSky.makeGovernor ? AM.WeatherSky.makeGovernor() : null;
    const resize = () => {
      if (destroyed || lost) return;
      const k = Math.min(win.devicePixelRatio || 1, 1) * (gov ? gov.quality : 1);
      const w = Math.max(2, Math.round(win.innerWidth * k)), h = Math.max(2, Math.round(win.innerHeight * k));
      if (w === W && h === H) return;
      W = w; H = h;
      canvas.width = W; canvas.height = H; // this clears the buffer, so draw again at once
      initFramebuffers();
      render();
    };

    // ---- loop: ~30 fps, paused while the tab is hidden, one still frame under reduced motion ----
    let raf = 0, last = 0, lastRaf = 0, settled = false;
    const reduceMq = win.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = reduceMq.matches;

    function tick(now) {
      raf = 0;
      if (destroyed || lost) return;
      if (lastRaf && gov && gov.raf(now - lastRaf, now)) resize(); // quality steps back up (with a cooldown, see makeGovernor)
      lastRaf = now;
      if (now - last >= FRAME_MS) {
        const gap = last ? now - last : FRAME_MS;
        last = now;
        applyInput(now);
        step(Math.min(gap / 1000, DT_MAX));
        render();
        if (gov && gov.drawn(gap, now)) resize();
      }
      raf = win.requestAnimationFrame(tick);
    }
    const start = () => { if (!raf && !destroyed && !lost && !doc.hidden && !reduced) raf = win.requestAnimationFrame(tick); };
    const stop = () => { if (raf) { win.cancelAnimationFrame(raf); raf = 0; } last = 0; lastRaf = 0; };

    // Reduced motion: let the fluid develop for a moment, draw one frame, and stay still.
    const settle = () => {
      if (destroyed || lost) return;
      multipleSplats(4);
      for (let i = 0; i < STATIC_STEPS; i++) step(0.0166);
      render();
      settled = true;
    };

    const onVis = () => {
      if (doc.hidden) stop();
      else if (reduced) { if (settled) render(); else settle(); }
      else start();
    };
    const onMotion = () => {
      reduced = reduceMq.matches;
      if (reduced) {
        stop();
        for (const p of pointers) { p.down = false; p.moved = false; }
        settled = false;
        if (!doc.hidden) settle();
      } else start();
    };
    const onWinResize = () => resize();

    let api = null;
    // no preventDefault: the context stays gone, and the caller puts the page back as it was
    const onLost = () => { lost = true; if (api) api.destroy(); if (opts.onLost) opts.onLost(); };
    const root = doc.documentElement;
    api = {
      canvas,
      setStrength(v) {
        strength = clamp(+v || strength, 0.2, 1);
        canvas.style.opacity = String(strength);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stop();
        win.removeEventListener('mousemove', onMouseMove);
        win.removeEventListener('touchmove', onTouch);
        win.removeEventListener('touchstart', onTouch);
        win.removeEventListener('touchend', onTouchEnd);
        win.removeEventListener('touchcancel', onTouchEnd);
        root.removeEventListener('mouseleave', onMouseLeave);
        win.removeEventListener('resize', onWinResize);
        doc.removeEventListener('visibilitychange', onVis);
        reduceMq.removeEventListener('change', onMotion);
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.remove();
        releaseGL();
      },
    };

    win.addEventListener('mousemove', onMouseMove, { passive: true });
    win.addEventListener('touchmove', onTouch, { passive: true });
    win.addEventListener('touchstart', onTouch, { passive: true });
    win.addEventListener('touchend', onTouchEnd, { passive: true });
    win.addEventListener('touchcancel', onTouchEnd, { passive: true });
    root.addEventListener('mouseleave', onMouseLeave);
    win.addEventListener('resize', onWinResize);
    doc.addEventListener('visibilitychange', onVis);
    reduceMq.addEventListener('change', onMotion);
    canvas.addEventListener('webglcontextlost', onLost);

    // appended last, so it comes after the sky canvas and sits above it (both are behind the page)
    root.appendChild(canvas);
    try {
      resize();
      if (reduced) { if (!doc.hidden) settle(); } // settle() seeds its own splats
      else { multipleSplats(Math.floor(Math.random() * 4) + 3); render(); start(); } // a few splats to begin with; after that only the cursor moves it
    } catch (e) {
      try { console.warn('[Headroom] fluid', e); } catch {}
      api.destroy();
      return null;
    }

    return api;
  }

  AM.FluidSim = { mount };
})();
