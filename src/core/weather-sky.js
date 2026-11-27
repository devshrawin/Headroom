// The weather sky: one full-page WebGL canvas that shows the real weather as a luminous animated sky (smooth gradient
// that follows the sun and moon, soft clouds lit from the sun's side and driven by the real wind, fine rain, snow, fog,
// lightning that flashes inside the clouds, falling leaves and petals by season). One fragment shader, no assets, no
// network. It never blocks the page (pointer-events: none), pauses when the tab is hidden, stays still when the
// system asks for reduced motion, and is injected into a tab only when the weather is switched on.
(() => {
  const AM = globalThis.Headroom;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // The quality governor: a slow GPU steps the drawing resolution down, a fast one steps it back up. Each change reallocates the
  // canvas, so a borderline GPU must not bounce between sizes: after a step down, step-ups are blocked for UP_BLOCK_MS, and a
  // step up needs the animation frames to average under UP_AVG_MS apart.
  const UP_BLOCK_MS = 30000, UP_AVG_MS = 18;
  function makeGovernor() {
    let quality = 1, slow = 0, seen = 0, downAt = -Infinity, gapSum = 0, gapN = 0;
    return {
      get quality() { return quality; },
      // one drawn frame (about 30 a second); gap = ms since the previous drawn frame. True when the resolution just stepped down.
      drawn(gap, now) {
        // frames arriving much slower than 30 a second, for about two seconds: draw fewer pixels (down to about 45%)
        if (++seen > 20 && quality > .46) {
          slow = gap > 50 ? slow + 1 : Math.max(0, slow - 1);
          if (slow > 45) { slow = 0; quality *= .8; downAt = now; gapSum = 0; gapN = 0; return true; }
        }
        return false;
      },
      // one animation-frame gap in ms. True when the resolution just stepped up.
      raf(g, now) {
        if (g < 250) { gapSum += g; gapN++; }
        if (gapN < 120) return false;
        const avg = gapSum / gapN; gapSum = 0; gapN = 0;
        if (avg < UP_AVG_MS && quality < 1 && now - downAt >= UP_BLOCK_MS) { quality = Math.min(1, quality * 1.1); slow = 0; return true; }
        return false;
      },
    };
  }

  // A queue that never loses work: drain() handles at most `max` entries (and stops when ok() says the frame's time is up), the rest
  // stay queued for the next call. An entry added with deep = true also queues all of its descendants (expand) once it is handled.
  // fn(x) returns false for an entry that no longer counts (e.g. it left the page).
  function makeBatchQueue() {
    const q = new Set(), deep = new WeakSet();
    return {
      get size() { return q.size; },
      add(x, isDeep) { q.add(x); if (isDeep) deep.add(x); },
      clear() { q.clear(); },
      drain(max, fn, expand, ok) {
        let n = 0, seen = 0;
        for (const x of q) {
          if (n >= max) break;
          if ((++seen & 15) === 0 && ok && !ok()) break;
          q.delete(x);
          if (fn(x) === false) continue;
          n++;
          if (deep.has(x)) { deep.delete(x); if (expand) for (const d of expand(x)) q.add(d); }
        }
        return n;
      },
    };
  }

  // Text-bearing content (a paragraph, table, rule, quote, code, a heading, a picture, or anything with text of its own) is
  // never part of a plate or frame around the message box, even when it scrolls behind the composer.
  const CONTENT_TAGS = /^(P|LI|UL|OL|DL|DT|DD|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|CAPTION|HR|BLOCKQUOTE|CODE|PRE|KBD|MARK|H[1-6]|FIGURE|FIGCAPTION|IMG|PICTURE|VIDEO|CANVAS|MATH)$/;
  function isContentBlock(el) {
    if (CONTENT_TAGS.test(el.tagName || '')) return true;
    for (const n of el.childNodes || []) if (n.nodeType === 3 && /\S/.test(n.nodeValue || '')) return true;
    return false;
  }

  // The shader's ink band follows the page's text colour: it stays off (0) until the page's text has been switched to the ink
  // (data-hr-ink set), then eases in. instant: reduced motion, no easing.
  function bandStep(k, active, ease, instant) {
    const target = active ? 1 : 0;
    return instant || !Number.isFinite(k) ? target : k + (target - k) * ease;
  }

  // Windows high contrast (forced colours) and "more contrast": the page must keep its own colours, so there is no sky.
  const PLAIN_QUERIES = ['(forced-colors: active)', '(prefers-contrast: more)'];
  function plainLook(w) {
    try { return PLAIN_QUERIES.some((q) => w.matchMedia(q).matches); } catch { return false; }
  }

  // Should the theme be read again? The read lifts every override and un-pins every island (a full style recalculation on a big chat),
  // so it only runs when the theme signature changed, and at most once per minGap ms. Returns -1 skip, 0 run now, > 0 wait that long.
  function readGate(sig, lastSig, now, lastAt, minGap, force) {
    if (!force && sig === lastSig) return -1;
    return Math.max(0, lastAt + minGap - now);
  }

  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime;
// sky stops, computed on the CPU from hour x season x weather
uniform vec3 uTop,uMid,uHor,uGlow;
// light: sun or moon colour, cloud lit side, cloud shadow side
uniform vec3 uSunCol,uLit,uAmb,uFogCol;
uniform vec2 uSun,uMoon;
uniform float uSunVis,uMoonVis,uMoonPhase,uTwi,uNight,uDay;
uniform float uCover,uGloom,uTower,uCirrus,uRain,uSnow,uFog,uHaze,uHalo,uSparkle;
uniform float uStars,uMilky,uPetals,uLeaves,uFlash,uFlashX,uBolt,uCalm;
// Text on the sky: the page's text that sits straight on the sky is drawn in one ink, dark or white, chosen on the CPU for the
// sky of the moment. uInk: +1 dark ink, so the sky is kept light (OKLab lightness >= LMIN); -1 white ink, so it is kept dark
// (<= LMAX); in between while it eases from one to the other. Only lightness is moved, never hue or chroma, so nothing is
// washed toward white or grey: a deep blue stays a vivid blue, only brighter or deeper. uVivid boosts the chroma on top.
uniform float uInk, uVivid;
uniform vec3 uPage;  // the page's own colour: Sky strength below 100% blends the sky toward it, before the ink band is applied
uniform float uMix;  // Sky strength, .2 .. 1
uniform vec2 uWind,uSeed,uShift; // uShift: how far the wind has carried things in all (so a change in wind never makes clouds jump)

float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  float a=h21(i),b=h21(i+vec2(1,0)),c=h21(i+vec2(0,1)),d=h21(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
const mat2 RT=mat2(.8,.6,-.6,.8);
float fbm(vec2 p,int oct){float v=0.,a=.5;for(int i=0;i<6;i++){if(i>=oct)break;v+=a*vn(p);p=RT*p*2.03+vec2(11.7,5.3);a*=.5;}return v;}
// billowy fbm: rounded "cauliflower" lobes for cumulus tops
float bill(vec2 p,int oct){float v=0.,a=.5;for(int i=0;i<6;i++){if(i>=oct)break;v+=a*(1.-abs(vn(p)*2.-1.));p=RT*p*2.07+vec2(3.1,7.9);a*=.5;}return v;}
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}

// ---------- 1. sky dome ----------
vec3 skyDome(vec2 uv,float asp){
  float y=uv.y+.035*pow(abs(uv.x-.5)*2.,2.);          // stops bend a little: reads as a dome, not a flat card
  vec3 g=mix(uHor,uMid,smoothstep(0.,.42,y));
  g=mix(g,uTop,smoothstep(.3,1.05,y));
  vec2 ds=(uv-uSun)*vec2(asp,1.);
  float l=length(ds);
  // forward scattering: the sky whitens towards the sun (strong at low sun, gentle by day)
  vec2 dw=(uv-uSun)*vec2(asp*.5,1.7);
  g+=uGlow*exp(-dot(dw,dw)*2.2)*(.12+.36*uTwi)*max(uSunVis,uTwi*.6);
  g+=uSunCol*exp(-l*2.4)*.10*uSunVis*(1.-uTwi);
  // anti-twilight: a rosy band opposite the sun with the blue earth shadow under it
  float opp=smoothstep(.25,.75,abs(uv.x-uSun.x));
  g+=vec3(.42,.20,.22)*exp(-pow((y-.17)/.07,2.))*opp*uTwi*.22*(1.-uGloom);
  g=mix(g,g*vec3(.78,.84,1.),smoothstep(.12,0.,y)*opp*uTwi*.5);
  // horizon haze: summer heat, autumn dust, monsoon humidity
  g=mix(g,mix(uHor,vec3(1.),.25),uHaze*exp(-max(y,0.)*7.));
  return g;
}

// ---------- 2. night: Milky Way and stars ----------
vec3 starLayer(vec2 q,float sc,float prob,float rad,float seed){
  vec2 p=q*sc,id=floor(p),f=fract(p)-.5;
  float h=h21(id+seed);
  if(h>prob)return vec3(0.);
  vec2 o=(vec2(h21(id+seed+1.),h21(id+seed+2.))-.5)*.7;
  float d=length(f-o),b=h21(id+seed+3.);
  float tw=b>.8?.6+.4*sin(uTime*(1.1+b*1.7)+h*70.):1.;    // only one star in five twinkles
  vec3 tint=mix(vec3(.72,.80,1.),vec3(1.,.86,.70),h21(id+seed+4.));
  return tint*exp(-d*d/(rad*rad))*(.25+.75*b*b*b)*tw;
}
vec3 nightSky(vec2 uv,float asp){
  vec2 q=uv*vec2(asp,1.);
  vec2 a=vec2(-.1,-.15),dir=normalize(vec2(asp*.75,1.25)),nrm=vec2(-dir.y,dir.x);
  float dist=dot(q-a,nrm),along=dot(q-a,dir);
  float band=exp(-dist*dist/.07);
  float core=exp(-pow((along-.55)/.45,2.));
  float cl=fbm(q*2.6+7.,5);
  float lane=smoothstep(.5,.72,fbm(vec2(along*3.,dist*9.)+3.,4))*exp(-dist*dist/.006);
  float mw=band*smoothstep(.25,.7,cl)*(.55+.9*core)*(1.-.75*lane)*uMilky;
  vec3 c=mix(vec3(.50,.58,.76),vec3(.92,.84,.72),core*.55)*mw*.24;
  float boost=1.+band*uMilky*2.5;
  c+=starLayer(q,260.,.06*boost,.07,1.)*.55;
  c+=starLayer(q,120.,.05,.075,7.)*.9;
  c+=starLayer(q,46.,.035,.06,13.)*1.5;
  return c*uStars*smoothstep(.0,.35,uv.y);
}

// ---------- 3. clouds ----------
// density on a cloud deck seen in perspective: big overhead, small and flat near the horizon
float cumDensity(vec2 p,float cov,float bias){
  float shape=fbm(p*.55+vec2(uTime*.004,uTime*.002),4);                               // where the clouds are
  vec2 w=vec2(vn(p*1.3+4.1),vn(p*1.3+9.7))-.5;
  float detail=fbm(p*2.6+w*.9+shape*1.5+vec2(uTime*.021,-uTime*.014),5);              // the puffs inside them
  float lobes=bill(p*5.2+w+vec2(-uTime*.034,uTime*.022),3);                           // small rounded lobes on the edges
  float n=shape*.62+detail*.36+lobes*.12+bias;
  float lo=mix(.75,.36,cov);
  return clamp((n-lo)*mix(6.,3.,uGloom),0.,1.);
}
vec4 cumulus(vec2 uv,float asp,float cov,float bias,float calm,vec2 Lp,float Lvis,float sc){
  float hz=max(uv.y,0.)+.28;                             // distance to the horizon: clouds shrink and flatten towards it
  vec2 p=vec2((uv.x-.5)*asp/pow(hz,.55)*.62,1./hz*.85)*sc+uSeed;
  p+=uShift*.06;
  float d=cumDensity(p,cov,bias);
  if(d<.002)return vec4(0.);
  vec2 Ls=(Lp-uv)*vec2(asp,1.);Ls=normalize(Ls+vec2(0.,.4));
  vec2 dq=vec2(Ls.x*.6,Ls.y*.9)/hz*.06*sc;
  float dl=cumDensity(p+dq,cov,bias);
  float du=cumDensity(p+vec2(0.,.05/hz*sc),cov,bias);
  float lit=clamp(.58+(d-dl)*1.5+(d-du)*.9-.25*d*d,0.,1.);
  lit=lit*lit*(3.-2.*lit);
  vec3 c=mix(uAmb,uLit,lit);
  c*=1.-(.08+.32*uTower)*smoothstep(.55,1.,d)*(1.-lit);
  float near=exp(-length((uv-Lp)*vec2(asp,1.))*3.);
  float edge=1.-smoothstep(.0,.45,d);
  c+=uSunCol*edge*(.05+.8*near)*Lvis*(1.-.85*uGloom);
  float far=smoothstep(.45,.0,uv.y);
  c=mix(c,mix(uHor,uLit,.3),far*.45);
  float a=smoothstep(0.,.6,d)*(1.-.35*calm);
  return vec4(c,a);
}
// high, thin ice cloud: fine streaks that catch the low sun
float cirrus(vec2 uv,float asp){
  vec2 p=vec2(uv.x*asp,uv.y);
  p=mat2(.94,.34,-.34,.94)*p;
  p+=uShift*.022;
  float w=fbm(p*vec2(1.2,3.),3);
  float n=fbm(vec2(p.x*1.6+w*1.5,p.y*11.+w*2.),5);
  return smoothstep(.5,.82,n)*smoothstep(.35,.9,uv.y)*uCirrus;
}

// ---------- 4. particles ----------
float rainLayer(vec2 uv,float asp,float sc,float spd,float seed,float slant,float thick){
  vec2 p=vec2(uv.x*asp,uv.y)*vec2(sc,sc*.085);
  p.x+=p.y*slant;p.y+=uTime*spd;
  vec2 id=floor(p),f=fract(p);
  float h=h21(id+seed);
  if(h21(id+seed+9.)>uRain*.75)return 0.;
  float x=abs(f.x-(.15+.7*h));
  float len=(.35+.35*h21(id+seed+5.))*mix(.4,1.,uRain);
  float t=f.y/len;
  if(t>1.)return 0.;
  float tail=pow(1.-t,1.4)*smoothstep(0.,.05,t);
  return smoothstep(thick,thick*.2,x)*tail;
}
float snowLayer(vec2 uv,float asp,float sc,float spd,float seed,float rad,float soft){
  vec2 p=vec2(uv.x*asp,uv.y)*sc;
  p.y+=uTime*spd;p.x+=sin(uTime*.4+p.y*.9+seed)*.25+uShift.x*.1;
  vec2 id=floor(p),f=fract(p)-.5;
  if(h21(id+seed+7.)>uSnow*.45)return 0.;
  vec2 o=(vec2(h21(id+seed),h21(id+seed+3.))-.5)*.55;
  float r=rad*(.6+.7*h21(id+seed+13.));
  return smoothstep(r,r*soft,length(f-o));
}
// petals (kind 0) or leaves (kind 1): sparse, tumbling, out of focus when near
vec4 drift(vec2 uv,float asp,float sc,float spd,float seed,float dens,float kind,float blur){
  vec2 p=vec2(uv.x*asp,uv.y)*sc;
  p.y+=uTime*spd;p.x+=uShift.x*.3+sin(uTime*.35+p.y*.8+seed)*.35;
  vec2 id=floor(p),f=fract(p)-.5;
  float h=h21(id+seed);
  if(h21(id+seed+4.)>dens)return vec4(0.);
  vec2 o=(vec2(h,h21(id+seed+2.))-.5)*.45;
  float ang=h*6.28+uTime*(h-.5)*.9;
  vec2 q=f-o;float cs=cos(ang),sn=sin(ang);q=vec2(cs*q.x-sn*q.y,sn*q.x+cs*q.y);
  float flip=.35+.65*abs(cos(uTime*(.5+h)+h*9.));      // tumbling: the shape foreshortens as it turns
  float s=.075*(.7+.6*h21(id+seed+8.));
  float m;vec3 col;float k=h21(id+seed+6.);
  if(kind<.5){
    q/=vec2(s*flip,s*.62);
    float d=length(q)+.18*smoothstep(.6,1.,q.x)*(1.-abs(q.y)*2.); // a soft notch at the tip
    m=smoothstep(1.,1.-blur,d);
    col=mix(vec3(1.,.84,.88),vec3(1.,.95,.96),k)*mix(.94,1.06,smoothstep(1.,0.,d));
  }else{
    q/=vec2(s*flip*1.1,s*.48);
    float d=length(vec2(q.x,q.y*(1.+.6*q.x*q.x)));        // pointed ends
    m=smoothstep(1.,1.-blur,d)*(1.-.25*exp(-q.y*q.y*90.)*step(abs(q.x),.9)); // faint midrib
    col=k<.4?vec3(.96,.56,.18):k<.75?vec3(.86,.36,.14):vec3(.98,.74,.30);
    col*=.82+.3*smoothstep(.2,-.6,q.x);                  // sunlight through the leaf: one side glows
  }
  return vec4(col,m);
}

// ---------- 5. the moon ----------
vec4 moonDisc(vec2 uv,float asp){
  vec2 d=(uv-uMoon)*vec2(asp,1.);
  float r=.024,l=length(d);
  if(l>r*1.3)return vec4(0.);
  vec2 n2=d/r;float z=sqrt(max(0.,1.-dot(n2,n2)));
  vec3 N=vec3(n2,z),L=normalize(vec3(sin(uMoonPhase),.12,-cos(uMoonPhase)));
  float lit=smoothstep(-.06,.16,dot(N,L));
  float mar=fbm(n2*1.9+4.2,4);
  float alb=.92-.26*smoothstep(.48,.66,mar)-.05*fbm(n2*7.,3);
  vec3 s=vec3(1.,.985,.95)*alb*(.06+.98*lit)*(.84+.16*z);   // a hint of earthshine and limb darkening
  float m=smoothstep(r,r-1.6/uRes.y,l);
  return vec4(s*1.4,m);
}

// ---------- 6. colour: OKLab, gamut mapping, the ink band ----------
vec3 toLin(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(.04045,c));}
vec3 toSrgb(vec3 c){c=max(c,0.);return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}
vec3 toLab(vec3 c){
  vec3 lms=vec3(.4122214708*c.r+.5363325363*c.g+.0514459929*c.b,.2119034982*c.r+.6806995451*c.g+.1073969566*c.b,.0883024619*c.r+.2817188376*c.g+.6299787005*c.b);
  lms=pow(max(lms,0.),vec3(1./3.));
  return vec3(.2104542553*lms.x+.7936177850*lms.y-.0040720468*lms.z,1.9779984951*lms.x-2.4285922050*lms.y+.4505937099*lms.z,.0259040371*lms.x+.7827717662*lms.y-.8086757660*lms.z);
}
vec3 fromLab(vec3 c){
  vec3 lms=vec3(c.x+.3963377774*c.y+.2158037573*c.z,c.x-.1055613458*c.y-.0638541728*c.z,c.x-.0894841775*c.y-1.2914855480*c.z);
  lms=lms*lms*lms;
  return vec3(4.0767416621*lms.x-3.3077115913*lms.y+.2309699292*lms.z,-1.2684380046*lms.x+2.6097574011*lms.y-.3413193965*lms.z,-.0041960863*lms.x-.7034186147*lms.y+1.7076147010*lms.z);
}
bool inGamut(vec3 c){return all(greaterThanEqual(c,vec3(-.0005)))&&all(lessThanEqual(c,vec3(1.0005)));}
// out-of-gamut colours keep their lightness and hue and lose only as much chroma as they must (clipping would shift the hue)
vec3 labToLin(vec3 lab){
  vec3 c=fromLab(lab);
  if(inGamut(c))return c;
  float lo=0.,hi=1.;
  for(int i=0;i<7;i++){float m=(lo+hi)*.5;if(inGamut(fromLab(vec3(lab.x,lab.yz*m))))lo=m;else hi=m;}
  return clamp(fromLab(vec3(lab.x,lab.yz*lo)),0.,1.);
}
// the lightness band for the ink, with a knee so cloud structure survives in compressed form instead of being flattened:
// dark ink: [0, LMIN+KNEE] -> [LMIN, LMIN+KNEE]; white ink: [LMAX-KNEE, 1] -> [LMAX-KNEE, LMAX]
const float LMIN=.64,LMAX=.50,KNEE=.10;
float bandDark(float L){float t=LMIN+KNEE;return L<t?LMIN+KNEE*(L/t):L;}
float bandLight(float L){float t=LMAX-KNEE;return L>t?t+KNEE*((L-t)/(1.-t)):L;}
vec3 inkSafe(vec3 col){
  vec3 lab=toLab(toLin(clamp(col,0.,1.)));
  // more boost for the near-greys (rain, overcast, fog), so they read as tinted skies rather than flat grey
  lab.yz*=uVivid+.8*(1.-smoothstep(0.,.08,length(lab.yz)));
  float k=clamp(uInk,-1.,1.);
  if(k>0.)lab.x=mix(lab.x,bandDark(lab.x),k);
  else if(k<0.)lab.x=mix(lab.x,bandLight(lab.x),-k);
  return toSrgb(labToLin(lab));
}

void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  // the reading column: middle third, lower two thirds of the window
  float calm=(1.-smoothstep(.17,.36,abs(uv.x-.5)))*(1.-smoothstep(.70,.95,uv.y))*uCalm;

  vec3 base=skyDome(uv,asp);
  vec3 col=base;
  // stars, the sun's and moon's discs and a lightning bolt are small bright points: they are laid on after the ink band
  // (which would dim them), hidden by whatever covers them in between (vis)
  vec3 cel=vec3(0.),bolt=vec3(0.);
  float vis=1.;

  if(uNight>.01)cel+=nightSky(uv,asp)*uNight*(1.-smoothstep(.25,.85,uCover))*(1.-.5*calm);

  // sun behind everything else
  float ls=length((uv-uSun)*vec2(asp,1.));
  col+=uSunCol*(exp(-ls*4.)*.16+exp(-ls*14.)*.28+exp(-ls*55.)*.55)*uSunVis;
  float sunD=smoothstep(.021,.0175,ls)*uSunVis*(1.-uFog*.85);

  // moon: soft atmosphere, a faint 22-degree ice halo in cold, hazy air, then the disc
  float lm=length((uv-uMoon)*vec2(asp,1.));
  col+=vec3(.78,.84,.95)*(exp(-lm*5.)*.08+exp(-lm*18.)*.18+exp(-lm*60.)*.3)*uMoonVis;
  if(uHalo>.001&&uMoonVis>.001){
    float ring=exp(-pow((lm-.20)/.022,2.))*(.6+.4*fbm(uv*vec2(asp,1.)*6.,3));
    col+=(vec3(.72,.78,.92)*ring+vec3(.06,.03,.01)*exp(-pow((lm-.182)/.012,2.)))*.035*uHalo*uMoonVis;
  }
  vec4 mo=moonDisc(uv,asp);
  mo.a*=uMoonVis;

  vec2 Lp=uSunVis>uMoonVis?uSun:uMoon;
  float Lvis=max(uSunVis,uMoonVis*.55);

  // high cirrus, then the cumulus deck in two depths
  // a solid cloud deck under heavy cover: soft, low-contrast texture so grey never reads as flat paint
  if(uCover>.8){
    float hz=max(uv.y,0.)+.3;
    vec2 sp=vec2((uv.x-.5)*asp/pow(hz,.55)*.5,1./hz*.7)*1.6+uSeed*.7+uShift*.035;
    float stx=fbm(sp,5);
    vec3 deck=mix(uAmb,mix(uAmb,uLit,.75),smoothstep(.3,.75,stx));
    float dk=smoothstep(.8,1.,uCover)*.75*(1.-.3*calm);
    col=mix(col,mix(deck,base,.35),dk);vis*=1.-dk;
  }
  float ci=cirrus(uv,asp);
  col=mix(col,uLit*1.02+uGlow*.12*uTwi,ci*.42*(1.-.4*calm));vis*=1.-ci*.42*(1.-.4*calm);
  // keep the open sky open where people read: clouds lean to the top and the side edges
  float edges=smoothstep(.22,.5,abs(uv.x-.5));
  float topb=smoothstep(.55,.95,uv.y);
  float bias=(.05*topb+.05*edges-.09*calm)*(1.-uCover*uCover);
  vec4 c2=cumulus(uv+vec2(.37,.0),asp,uCover*.8,bias-.03,calm,Lp,Lvis,1.9);
  c2.rgb=mix(c2.rgb,base,.18);
  float a2=c2.a*.85*(1.-.75*uCover*uCover);
  col=mix(col,c2.rgb,a2);vis*=1.-a2;
  vec4 c1=cumulus(uv,asp,uCover,bias,calm,Lp,Lvis,1.1);
  col=mix(col,c1.rgb,c1.a);vis*=1.-c1.a;
  float cloudA=max(c1.a,c2.a*.85);

  // glare on top of the clouds: the sun still burns through thin edges
  col+=uSunCol*(exp(-ls*18.)*.18+exp(-ls*70.)*.45)*uSunVis*(1.-.75*cloudA)*(1.-uGloom);

  // lightning: the cloud lights from inside, then an optional thin bolt at the window edge
  if(uFlash>.001){
    vec2 fd=(uv-vec2(uFlashX,.80))*vec2(asp*.8,1.3);float g=exp(-dot(fd,fd)*7.);
    col+=vec3(.78,.84,1.)*uFlash*(.03+g*(.15+cloudA*.75));
    if(uBolt>.001&&uv.y<.74&&uv.y>.2){
      float y=uv.y;
      float xo=uFlashX+(fbm(vec2(y*6.,uFlashX*9.),4)-.5)*.07+(vn(vec2(y*55.,2.))-.5)*.008;
      float dx=abs(uv.x-xo)*asp;
      float bb=exp(-dx*dx/2.2e-6)*1.1+exp(-dx*55.)*.22;
      float xb=xo+(.56-y)*.22+(vn(vec2(y*48.,9.))-.5)*.008;    // one branch
      float db=abs(uv.x-xb)*asp;
      bb+=(exp(-db*db/1.2e-6)*.7+exp(-db*70.)*.12)*step(y,.56)*smoothstep(.36,.5,y);
      bolt+=vec3(.90,.93,1.)*bb*uBolt*smoothstep(.2,.32,y)*(1.-.8*c1.a);
    }
  }

  // fog: horizontal banks that thicken towards the ground; the sun becomes a pale disc
  if(uFog>.01){
    float f=0.;
    for(int i=0;i<3;i++){
      float fi=float(i);
      float n=fbm(vec2(uv.x*asp*(1.1+fi*.5)+uTime*.006*(fi+1.)+fi*13.,uv.y*(4.5+fi)),4);
      f+=smoothstep(.32,.78,n)*exp(-pow((uv.y-(.12+fi*.2))/.2,2.))*(.75-fi*.15);
    }
    f=clamp(.42+f*.55+(1.-uv.y)*.3,0.,1.)*uFog;
    vec3 fc=uFogCol+uSunCol*(exp(-ls*3.)*.18+exp(-ls*16.)*.35+smoothstep(.03,.026,ls)*.25)*uSunVis+vec3(.6,.65,.75)*(exp(-lm*4.)*.08+exp(-lm*16.)*.12+smoothstep(.03,.026,lm)*.15)*uMoonVis;
    col=mix(col,fc,f*.9);vis*=1.-f*.9;
  }

  // rain: fine streaks at four depths and soft curtains below the cloud base
  if(uRain>.01){
    float sl=-uWind.x*.35-.08;
    float shafts=fbm(vec2(uv.x*asp*5.+uv.y*sl*4.,uv.y*.6+uTime*.05),3);
    col=mix(col,uAmb*.92,smoothstep(.45,.8,shafts)*smoothstep(.9,.35,uv.y)*uRain*.22*(1.-calm*.5));
    float r=rainLayer(uv,asp,34.,3.6,1.,sl,.035)*.55+rainLayer(uv,asp,60.,3.0,3.,sl,.03)*.6
           +rainLayer(uv,asp,105.,2.4,7.,sl,.026)*.5+rainLayer(uv,asp,170.,2.,11.,sl,.022)*.38;
    vec3 rc=mix(uLit,vec3(1.),.3);
    col+=rc*r*(.16+.26*uDay)*(1.-.5*calm);
    col=mix(col,uFogCol,smoothstep(.45,0.,uv.y)*uRain*.18);    // spray haze
  }
  // snow: near flakes large and out of focus, far flakes small and crisp
  if(uSnow>.01){
    float s=snowLayer(uv,asp,6.,.09,1.,.16,.0)*.22+snowLayer(uv,asp,13.,.12,5.,.12,.25)*.45
           +snowLayer(uv,asp,26.,.10,9.,.10,.45)*.6+snowLayer(uv,asp,48.,.07,15.,.09,.5)*.45;
    col+=vec3(.97,.98,1.)*s*(.45+.4*uDay+.15*uNight)*(1.-.5*calm);
  }
  // diamond dust: tiny glints in very cold, clear air
  if(uSparkle>.01){
    vec2 p=uv*vec2(asp,1.)*90.;p.y+=uTime*.25;
    vec2 id=floor(p),f=fract(p)-.5;
    float h=h21(id+31.);
    float sp=step(.985,h)*exp(-dot(f,f)*220.)*pow(.5+.5*sin(uTime*2.5+h*90.),6.);
    col+=vec3(1.,.97,.9)*sp*uSparkle*(1.-calm);
  }
  // petals and leaves, kept to the edges
  float dens=uPetals+uLeaves;
  if(dens>.01){
    float kind=uLeaves>uPetals?1.:0.;
    float side=mix(.15,1.,edges);
    vec4 d2=drift(uv,asp,9.,.05,4.,dens*.13*side,kind,.3);
    vec4 d1=drift(uv,asp,3.2,.08,1.,dens*.12*side,kind,.8);
    float lightK=(.35+.65*uDay)*(1.-.3*uGloom);
    col=mix(col,d2.rgb*lightK,d2.a*.85);
    col=mix(col,d1.rgb*lightK*1.04,d1.a*.6);
  }

  // the reading column: pull mid-tones gently back towards the open sky (fewer hard cloud edges behind text)
  col=mix(col,base+(col-base)*.6,calm*.5);
  // soft shoulder so glows never clip into flat white
  col=vec3(col.r<.82?col.r:.82+.18*(1.-exp(-(col.r-.82)/.18)),
           col.g<.82?col.g:.82+.18*(1.-exp(-(col.g-.82)/.18)),
           col.b<.82?col.b:.82+.18*(1.-exp(-(col.b-.82)/.18)));
  // corners a touch deeper for depth (before the band, so the band still holds in the corners)
  col*=1.-.10*pow(length((uv-vec2(.5,.45))*vec2(1.,1.2)),2.5);
  // Sky strength blends toward the page's colour; then the ink band and the colour boost. No white wash anywhere.
  col=inkSafe(mix(uPage,col,uMix));
  // the bright points, over the band
  col+=cel*vis*uMix+bolt*uMix;
  col=mix(col,vec3(1.,.99,.96),sunD*vis*uMix);
  col=mix(col,mo.rgb,mo.a*vis*uMix);
  col+=(h21(gl_FragCoord.xy+fract(uTime)*91.)-.5)/255.;
  gl_FragColor=vec4(col,1.);
}
`;

  // Is the page itself dark? Read its own background, fall back to the browser preference.
  // ignoreNight: skip the "our night flip is on" short-circuit (used when re-reading the page's real theme).
  function pageIsDark(ignoreNight) {
    if (AM.pageIsDark) return AM.pageIsDark(ignoreNight); // page-tone.js: understands oklch(), color(), hsl() too
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
    if (!ignoreNight && root.hasAttribute('data-hr-night')) return false; // our own light-text rule is on: the page underneath is light
    const cs = getComputedStyle(root).colorScheme || '';
    if (/\bdark\b/.test(cs) && !/\blight\b/.test(cs)) return true;
    if (/(^|\s)dark(\s|$)/.test(root.className || '') || /dark/i.test(root.getAttribute('data-theme') || root.getAttribute('data-color-mode') || '')) return true;
    if (document.body) {
      const tl = lum(getComputedStyle(document.body).color); // light text means a dark page
      if (tl !== null) return tl > 0.6;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // opts: { strength: 0.2..1, onLost() }. Returns null when WebGL is not available.
  let live = null; // the mounted instance (for stats())
  function mount(opts = {}) {
    const doc = document, win = window;
    if (plainLook(win)) return null; // forced colours / more contrast: leave the page as it is
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
    const rgbaOf = (css) => (AM.cssRGBA ? AM.cssRGBA(css) : null);
    const alphaOf = (css) => {
      const c = rgbaOf(css);
      if (c) return c[3];
      if (!css || css === 'transparent') return 0;
      const n = css.slice(css.indexOf('(') + 1, css.lastIndexOf(')')).split(/[ ,/]+/).filter(Boolean);
      return n.length > 3 ? +n[3] : 1;
    };
    const readPageBg = () => {
      for (const el of [doc.body, rootEl]) { if (!el) continue; const c = win.getComputedStyle(el).backgroundColor; if (c && alphaOf(c) >= .5) return c; }
      return null;
    };
    const pageBg = readPageBg();
    const rootPrev = [rootEl.style.getPropertyValue('background-color'), rootEl.style.getPropertyPriority('background-color')];
    rootEl.style.setProperty('background-color', pageBg || (pageIsDark() ? '#14141c' : '#ffffff'), 'important');
    // Marked elements lose their background (and any fade drawn by ::before / ::after) through one
    // stylesheet, so nothing is edited inline and everything comes back when the sheet is removed.
    const MARK = 'data-hr-sky';
    const sheet = doc.createElement('style');
    sheet.setAttribute('data-headroom', 'weather');
    sheet.textContent = ':root [' + MARK + '][' + MARK + ']{background-color:transparent !important;background-image:none !important}'
      + ':root [' + MARK + '][' + MARK + ']::before,:root [' + MARK + '][' + MARK + ']::after{background:none !important}'
      // Text straight on the sky takes the ink of the moment: near-black on a light sky, white on a dark one (see decideInk).
      // Islands, the elements that keep a background of their own (the message box, cards, code, menus, buttons, bubbles),
      // keep the site's colours, and so does everything inside them. data-hr-ink is only set once the islands are known.
      + ':root[data-hr-ink=dark]{--hr-ink:rgb(18,19,23)}:root[data-hr-ink=light]{--hr-ink:rgb(254,254,253)}'
      + ':root[data-hr-ink] body :not([data-hr-island]):not([data-hr-island] *){color:var(--hr-ink) !important}'
      + ':root[data-hr-ink] body :not([data-hr-island]):not([data-hr-island] *)::placeholder{color:var(--hr-ink) !important;opacity:.7 !important}';
    (doc.head || rootEl).appendChild(sheet);
    let destroyed = false;
    // ---- islands: elements that keep a background of their own (see the ink rule above) ----
    const ISLAND = 'data-hr-island';
    let islandsReady = false; // the first full walk has looked at every element
    // An island without a colour of its own would inherit the ink from the forced text around it (white text on a white card).
    // Such islands get their original colour back, inline: read before the ink rule was switched on, or else taken from the
    // nearest island above it, or from the page's own text colour. Islands that set their own colour are left alone. The inks
    // are odd values (no site uses exactly them), so "this island's colour is the ink" means it is only inherited.
    const INK_DARK = 'rgb(18, 19, 23)', INK_LIGHT = 'rgb(254, 254, 253)';
    const islandOrig = new WeakMap(); // island -> its colour as the site set it
    const pinned = new Map();         // island -> [inline color before, priority]: what to put back
    let siteInk = '';                 // the page's own text colour (<body>), read with our rules off
    const inkActive = () => rootEl.hasAttribute('data-hr-ink');
    function pinIsland(el) {
      if (!inkActive() || pinned.has(el)) return;
      let c;
      try { c = win.getComputedStyle(el).color; } catch { return; }
      if (c !== INK_DARK && c !== INK_LIGHT) return; // it has a colour of its own
      let orig = islandOrig.get(el);
      for (let a = el.parentElement; !orig && a && a !== doc.body; a = a.parentElement) if (a.hasAttribute(ISLAND)) orig = islandOrig.get(a) || (pinned.has(a) ? a.style.getPropertyValue('color') : '');
      orig = orig || siteInk;
      if (!orig || orig === INK_DARK || orig === INK_LIGHT) return;
      pinned.set(el, [el.style.getPropertyValue('color'), el.style.getPropertyPriority('color')]);
      el.style.setProperty('color', orig, 'important');
    }
    function unpinIsland(el) {
      const prev = pinned.get(el);
      if (!prev) return;
      pinned.delete(el);
      if (prev[0]) el.style.setProperty('color', prev[0], prev[1]); else el.style.removeProperty('color');
    }
    // the island mark is only ever removed together with its pin
    function dropIsland(el) { el.removeAttribute(ISLAND); unpinIsland(el); }
    // elements that left the page must not stay referenced (a single-page app swaps whole conversation trees): put their colour back and forget them
    function prunePinned() { for (const el of [...pinned.keys()]) if (!el.isConnected) unpinIsland(el); }
    function checkIsland(el) {
      if (!el || el.nodeType !== 1 || el === canvas || el === rootEl || el === doc.body || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
      if (el.hasAttribute('data-headroom')) return;
      let cs;
      try { cs = win.getComputedStyle(el); } catch { return; }
      // cleared by us (it reads transparent now, but say so explicitly) or painted: a solid fill, a gradient or an image
      const cleared = el.hasAttribute(MARK) || el.hasAttribute('data-hr-halo');
      const painted = (s) => alphaOf(s.backgroundColor) >= .5 || (!!s.backgroundImage && s.backgroundImage !== 'none');
      // a card can also be drawn by the element's own ::before / ::after placed behind its text
      const pseudo = (which) => { const p = win.getComputedStyle(el, which); return p.content !== 'none' && p.content !== 'normal' && p.position === 'absolute' && painted(p); };
      const is = !cleared && (painted(cs) || pseudo('::before') || pseudo('::after'));
      if (is && !inkActive() && !pinned.has(el)) islandOrig.set(el, cs.color);
      if (is !== el.hasAttribute(ISLAND)) {
        if (is) el.setAttribute(ISLAND, '');
        else dropIsland(el);
      }
      if (is) pinIsland(el); else if (pinned.has(el)) unpinIsland(el);
    }
    // New content (a reply streaming in with a code block, a menu opening) and class or style changes are looked at in the next
    // animation frame, before it is painted: a new white card never shows white-on-white text, not even for a frame.
    // Each frame handles at most ISLAND_PER_FRAME elements (and about ISLAND_BUDGET_MS of work); whatever is left stays queued for the next frame.
    const ISLAND_PER_FRAME = 6000, ISLAND_BUDGET_MS = 12;
    const islandQueue = makeBatchQueue();
    let islandRaf = 0, islandTimer = 0, pruneDue = false, readRuns = 0;
    // A backlog is continued by whichever comes first, the next animation frame or a short timer: a page whose frames come slowly
    // (a busy GPU, a background tab) must not leave elements waiting for seconds.
    const flushIslands = () => {
      if (islandRaf) win.cancelAnimationFrame(islandRaf);
      win.clearTimeout(islandTimer);
      islandRaf = 0; islandTimer = 0;
      if (destroyed) { islandQueue.clear(); return; }
      const t0 = performance.now();
      takeRecs(islandMo.takeRecords()); // what the page changed since the last callback comes first
      islandQueue.drain(ISLAND_PER_FRAME, (el) => { if (!el.isConnected) return false; checkIsland(el); return true; },
        (el) => el.getElementsByTagName('*'), () => performance.now() - t0 < ISLAND_BUDGET_MS);
      if (pruneDue) { pruneDue = false; prunePinned(); }
      islandMo.takeRecords(); // our own pins / un-pins (inline colour) are not page changes: without this every pinned element would queue itself again
      if (islandQueue.size && !destroyed) { islandRaf = win.requestAnimationFrame(flushIslands); islandTimer = win.setTimeout(flushIslands, 24); }
    };
    // Hover, focus and transitions change backgrounds without changing classes (a sidebar row lights up under the pointer):
    // look at the element and a few ancestors at once and again when a fade-in has finished.
    let hoverT = 0;
    const queueUp = (t, n) => {
      if (destroyed || !t || t.nodeType !== 1) return;
      for (let a = t, i = 0; a && a !== doc.body && a !== rootEl && i < n; a = a.parentElement, i++) islandQueue.add(a);
      if (!islandRaf) islandRaf = win.requestAnimationFrame(flushIslands);
    };
    const onHover = (e) => {
      if (!inkActive()) return;
      const t = e.target;
      queueUp(t, 5);
      win.clearTimeout(hoverT);
      hoverT = win.setTimeout(() => queueUp(t, 5), 220);
    };
    const onTransition = (e) => { if (inkActive()) queueUp(e.target, 1); };
    const takeRecs = (recs) => {
      for (const r of recs) {
        if (r.type === 'childList') {
          for (const nd of r.addedNodes) if (nd.nodeType === 1) islandQueue.add(nd, true);
          if (r.removedNodes.length && pinned.size) pruneDue = true;
        }
        else if (r.target.nodeType === 1) islandQueue.add(r.target);
      }
    };
    const islandMo = new MutationObserver((recs) => {
      if (destroyed) return;
      takeRecs(recs);
      if ((islandQueue.size || pruneDue) && !islandRaf) islandRaf = win.requestAnimationFrame(flushIslands);
    });
    const marked = new Set();     // full-screen / bar backdrops: marked once
    const bandMarked = new Set(); // edge bands: re-validated on every scan, unmarked when they stop qualifying
    const tintMarked = new Set(); // wide strips painted in the page's own colour (headers, composer strips): re-validated by shape
    // The page's own colour. Headers, composer strips and the plates behind inputs are painted in it so they blend into the
    // page; once the page shows the sky they must go too, wherever they sit (pinned or not, at the edge or not).
    let pageRGB = rgbaOf(pageBg);
    let scanSeen = new WeakMap(); // element -> layout signature at its last check: unchanged elements are not re-read
    const isBacking = (cs) => alphaOf(cs.backgroundColor) >= .9 || (cs.backgroundImage || '').indexOf('gradient') >= 0;
    const COLOUR_RE = /(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi;
    // painted in the page colour: a solid fill (alpha >= .5, so frosted 80-90% headers count) or a fade whose stops use it
    const pageTinted = (cs) => {
      if (!pageRGB) return false;
      const c = rgbaOf(cs.backgroundColor);
      if (c && c[3] >= .5 && AM.sameColour(c, pageRGB)) return true;
      const img = cs.backgroundImage || '';
      if (img.indexOf('gradient') < 0) return false;
      return (img.match(COLOUR_RE) || []).some((s) => { const g = rgbaOf(s); return g && g[3] >= .5 && AM.sameColour(g, pageRGB); });
    };
    const rounded = (cs) => Math.max(parseFloat(cs.borderTopLeftRadius) || 0, parseFloat(cs.borderTopRightRadius) || 0, parseFloat(cs.borderBottomLeftRadius) || 0, parseFloat(cs.borderBottomRightRadius) || 0) > 1;
    // a wide, square-cornered strip (cards, bubbles and inputs are rounded and keep their own paint)
    const stripShape = (r, vw, vh) => r.width >= vw * .4 && r.height >= 16 && r.height < vh * .85;
    const XHTML = 'http://www.w3.org/1999/xhtml';
    const OVERLAY_SEL = '[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip],[role=status],[role=alert],dialog,[popover],[aria-modal=true]';
    // Optional "frosted strips": a cleared strip on the top or bottom edge blurs what is behind it (the sky, and any text scrolling
    // under it) instead of showing it raw. backdrop-filter makes the element the containing block of its position:fixed
    // descendants, so a strip that holds a menu, dialog or popover (now or when one opens) is left unfrosted: :has() decides it live.
    const FROST = 'data-hr-frost';
    let frost = !!opts.frost;
    const FROST_RULE = ':root[data-hr-frost-on] [' + MARK + '][' + FROST + ']:not(:has(' + OVERLAY_SEL + ')){-webkit-backdrop-filter:blur(12px) !important;backdrop-filter:blur(12px) !important}';
    sheet.textContent += FROST_RULE;
    const applyFrost = () => { if (frost) rootEl.setAttribute('data-hr-frost-on', ''); else rootEl.removeAttribute('data-hr-frost-on'); };
    applyFrost();
    const edgeTouch = (r, vh) => r.top <= 3 || r.bottom >= vh - 3;
    // A square-cornered band stuck to the top or bottom edge (the strip behind a composer): a fixed or sticky element that sits
    // fully inside the viewport. In-flow things that merely cross the edge while scrolling, rounded cards and overlays do not count.
    function bandShape(el, r, vw, vh) {
      if (r.width < vw * .4 || r.height < 20 || r.height > vh * .4) return false;
      if (!((r.top >= -1 && r.top <= 3) || (r.bottom <= vh + 1 && r.bottom >= vh - 3))) return false;
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none') return false;
      if (parseFloat(cs.borderTopLeftRadius) > 0 || parseFloat(cs.borderTopRightRadius) > 0 || parseFloat(cs.borderBottomLeftRadius) > 0 || parseFloat(cs.borderBottomRightRadius) > 0) return false;
      // pinned: the element itself is fixed or sticky, or an ancestor (up to 3 up) is AND shares the element's edge on the
      // band's side (within 3 px): an in-flow child of a fixed app shell that merely crosses the edge does not qualify
      const topBand = r.top >= -1 && r.top <= 3;
      let pinned = cs.position === 'fixed' || cs.position === 'sticky';
      for (let a = el.parentElement, i = 0; !pinned && a && i < 3; a = a.parentElement, i++) {
        const p = win.getComputedStyle(a).position;
        if (p !== 'fixed' && p !== 'sticky') continue;
        const ar = a.getBoundingClientRect();
        if (Math.abs((topBand ? ar.top - r.top : ar.bottom - r.bottom)) <= 3) pinned = true;
        break;
      }
      if (!pinned) return false;
      return !el.closest(OVERLAY_SEL);
    }
    // fresh: ignore the cache. The on-screen pass always reads current styles: :focus-within, :hover and scroll-state rules change
    // an element's paint without changing its classes, size or position, so a cached "nothing to clear" would go stale.
    function visit(el, vw, vh, fresh) {
      if (marked.has(el) || bandMarked.has(el) || tintMarked.has(el) || el === canvas || el === rootEl || el.namespaceURI !== XHTML) return;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      // skip elements whose box and classes have not changed since they were last checked (a long chat has thousands)
      // position only matters at the top and bottom edges (bandShape); elsewhere, scrolling must not invalidate the cache
      const edge = r.top <= 3 ? 't' + Math.round(r.top) : r.bottom >= vh - 3 ? 'b' + Math.round(vh - r.bottom) : 'm';
      const sig = (el.getAttribute('class') || '') + '|' + (el.getAttribute('style') || '').length + '|' + edge + '|' + Math.round(r.width) + ',' + Math.round(r.height);
      if (!fresh && scanSeen.get(el) === sig) return;
      scanSeen.set(el, sig);
      if (el.closest(OVERLAY_SEL)) return; // never clear anything inside a dialog, menu, tooltip or alert
      // a page backdrop: most of the screen, or as tall as it. Width-only bars (headers, composer strips) go through bandShape.
      const full = r.width * r.height >= vw * vh * .5 || r.height >= vh * .85;
      const strip = !full && stripShape(r, vw, vh);
      if (!full && !strip) return;
      const band = !full && bandShape(el, r, vw, vh);
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none') return;
      const pre = win.getComputedStyle(el, '::before'), post = win.getComputedStyle(el, '::after');
      if (full || band) {
        if (isBacking(cs) || isBacking(pre) || isBacking(post)) {
          // the first full-screen backdrop tells us the page colour when <body> and <html> carry none
          if (full && !pageRGB) { const c = rgbaOf(cs.backgroundColor); if (c && c[3] >= .9) { pageRGB = c; scanSeen = new WeakMap(); } }
          (full ? marked : bandMarked).add(el); el.setAttribute(MARK, ''); dropIsland(el);
          if (!full && edgeTouch(r, vh)) el.setAttribute(FROST, '');
          return;
        }
      }
      // (a rounded ::before / ::after behind the text is a card, not a strip: it keeps its paint)
      if (strip && !rounded(cs) && (pageTinted(cs) || (pageTinted(pre) && !rounded(pre)) || (pageTinted(post) && !rounded(post)))) { tintMarked.add(el); el.setAttribute(MARK, ''); dropIsland(el); if (edgeTouch(r, vh)) el.setAttribute(FROST, ''); }
    }
    // ---- the message box's surroundings ----
    // Sites paint the space right around their message box in the page colour: a plate behind it, a frame that only appears
    // while the conversation is scrolled up (it hides text passing beside the box), a border, a spread box-shadow ring, an
    // outline or a pseudo-element. Over the sky each of those shows as a pale shape around the box, and their colour is often
    // not exactly the page colour. So instead of matching colours, the box itself is found (the rounded, painted box around
    // the text field), and every kind of paint on the elements that hug it is switched off through the stylesheet. Because the
    // marks sit on the elements and not on their current look, a plate or frame that only appears later (on focus, on scroll)
    // is already neutralised the moment it appears. The box keeps its own look; menus and dialogs are never touched.
    const HALO = 'data-hr-halo';     // background, border and box-shadow off (the ancestors, plates and gutters hugging the box)
    const HALO_P = 'data-hr-halo-p'; // the box's own ::before / ::after off (a plate drawn as the box's pseudo-element)
    const HALO_O = 'data-hr-halo-o'; // a thick (4 px+) outline off; thin outlines are focus indicators and stay
    sheet.textContent += ':root [' + HALO + '][' + HALO + ']{background-color:transparent !important;background-image:none !important;border-color:transparent !important;box-shadow:none !important}'
      + ':root [' + HALO + '][' + HALO + ']::before,:root [' + HALO + '][' + HALO + ']::after,:root [' + HALO_P + '][' + HALO_P + ']::before,:root [' + HALO_P + '][' + HALO_P + ']::after{background:none !important;border-color:transparent !important;box-shadow:none !important}'
      + ':root [' + HALO_O + '][' + HALO_O + ']{outline-color:transparent !important}';
    const EDIT_SEL = 'textarea,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"],[role=textbox]';
    const INTERACTIVE = 'button,a[href],input,select,textarea,[role=button],[role=link],[role=tab],[role=switch],[role=checkbox],[contenteditable]';
    const HUG = 72; // how far past the box's sides an element may reach and still count as hugging it (px)
    const radiusOf = (cs) => Math.max(parseFloat(cs.borderTopLeftRadius) || 0, parseFloat(cs.borderTopRightRadius) || 0, parseFloat(cs.borderBottomLeftRadius) || 0, parseFloat(cs.borderBottomRightRadius) || 0);
    const paintsBox = (cs) => alphaOf(cs.backgroundColor) >= .5 || (cs.backgroundImage || '').indexOf('gradient') >= 0
      || ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs['border' + s + 'Width']) >= .5 && alphaOf(cs['border' + s + 'Color']) >= .15);
    const pseudoPaints = (el) => [win.getComputedStyle(el, '::before'), win.getComputedStyle(el, '::after')].some((p) => p.content && p.content !== 'none' && (alphaOf(p.backgroundColor) > 0 || (p.backgroundImage || '').indexOf('gradient') >= 0 || (p.boxShadow && p.boxShadow !== 'none')));
    const haloMarks = new Map(); // element -> the tick it was last confirmed as hugging a box
    let haloTick = 0;
    const keepHalo = (el, attr) => {
      if (!el.hasAttribute(attr)) { el.setAttribute(attr, ''); if (attr === HALO) dropIsland(el); }
      haloMarks.set(el, haloTick);
    };
    // The message box around a text field: the outermost rounded, painted ancestor (up to 12 levels) that is still
    // composer-sized (not the whole panel). Null for small fields (a sidebar search box) and anything inside a menu or dialog.
    function boxFor(edit, vw, vh) {
      let box = null;
      for (let a = edit, i = 0; a && a !== doc.body && a !== rootEl && i < 12; a = a.parentElement, i++) {
        const r = a.getBoundingClientRect();
        if (r.width > vw * .95 || r.height > vh * .6) break;
        if (box && r.width > box.r.width + 2 * HUG) break; // past the box's surroundings
        const cs = win.getComputedStyle(a);
        if (radiusOf(cs) >= 6 && paintsBox(cs)) box = { el: a, r };
      }
      return box && box.r.width >= Math.min(300, vw * .25) ? box : null;
    }
    function hugBox(box, b, vw, vh) {
      const limH = b.height + vh * .5;
      const hugs = (r) => r.left >= b.left - HUG && r.right <= b.right + HUG && r.height <= limH;
      // a wide strip of the composer: stuck to the top or bottom edge of the window, at most 40% of its height
      const edgeStrip = (r) => r.width >= vw * .4 && r.height >= 16 && r.height <= vh * .4 && (r.bottom >= vh - 10 || r.top <= 10);
      // the conversation: inside an ancestor that scrolls vertically but does not contain the message box
      const scrollMemo = new Map();
      const inScroller = (e) => {
        for (let a = e; a && a !== doc.body && a !== rootEl; a = a.parentElement) {
          if (a.contains(box)) return false;
          let sc = scrollMemo.get(a);
          if (sc === undefined) { const o = win.getComputedStyle(a).overflowY; sc = o === 'auto' || o === 'scroll' || o === 'overlay'; scrollMemo.set(a, sc); }
          if (sc) return true;
        }
        return false;
      };
      const outline = (el, cs) => { if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 4) keepHalo(el, HALO_O); };
      // 1. the box's ancestors that hug it: its plate, frame, column, the composer strip
      const ancestors = [];
      const own = []; // wide edge strips that contain the box: part of the composer too, for the scope check in step 3
      for (let a = box.parentElement, i = 0; a && a !== doc.body && a !== rootEl && i < 10; a = a.parentElement, i++) {
        if (a.closest(OVERLAY_SEL)) break;
        const ar = a.getBoundingClientRect();
        if (hugs(ar)) { ancestors.push(a); keepHalo(a, HALO); outline(a, win.getComputedStyle(a)); continue; }
        // The composer's own full-width strip behind the column (on claude.ai the pale panels at the left and right of the message
        // box): far wider than the box, so it does not hug it, but it is a wide square strip stuck to the window's edge and the box
        // sits inside it. Its colour does not matter (it need not match the page colour).
        const acs = win.getComputedStyle(a);
        if (edgeStrip(ar) && radiusOf(acs) < 6) { own.push(a); keepHalo(a, HALO); outline(a, acs); continue; }
        break;
      }
      // 2. square plates next to it: wide children of those ancestors (painted or not yet: a :focus-within plate is still bare)
      for (const a of ancestors) {
        let n = 0;
        for (const c of a.children) {
          if (++n > 40) break;
          if (c === box || c.contains(box) || c.matches(OVERLAY_SEL) || c.matches(INTERACTIVE)) continue;
          const r = c.getBoundingClientRect();
          if (r.width < b.width * .8 || !hugs(r)) continue;
          const cs = win.getComputedStyle(c);
          if (radiusOf(cs) >= 6) continue; // a rounded card or tray next to the box keeps its look
          keepHalo(c, HALO); outline(c, cs);
        }
      }
      // 3. whatever is hit just outside the box: side gutters, plates drawn by cousins, the box's own pseudo-elements
      const ys = [b.top + 8, b.top + b.height / 2, b.bottom - 8, b.bottom + 12, (b.bottom + vh) / 2];
      const pts = [];
      for (const y of ys) for (const x of [b.left - 6, b.left - 20, b.right + 6, b.right + 20]) pts.push([x, y]);
      for (const x of [b.left + 24, b.left + b.width / 2, b.right - 24]) { pts.push([x, b.top - 2]); pts.push([x, b.bottom + 2]); }
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
        let stack;
        try { stack = doc.elementsFromPoint(x, y); } catch { continue; }
        for (const e of stack) {
          if (e === canvas || e === rootEl || e === doc.body || marked.has(e)) break; // reached the page backdrop
          if (e.hasAttribute('data-headroom') || e.namespaceURI !== XHTML) continue;
          // (once marked, the pseudo-element's paint reads as none: keep confirming the mark, or it would come and go)
          if (e === box) { if (box.hasAttribute(HALO_P) || pseudoPaints(box)) keepHalo(box, HALO_P); continue; }
          if (box.contains(e) || e.closest(OVERLAY_SEL)) continue;
          const r = e.getBoundingClientRect();
          if (r.width * r.height >= vw * vh * .5) break;
          if (e.contains(box)) { if (hugs(r) || edgeStrip(r)) keepHalo(e, HALO); continue; }
          if ((!hugs(r) && !edgeStrip(r)) || e.matches(INTERACTIVE) || e.closest(INTERACTIVE)) continue;
          // the composer's own subtree keeps the old rules; anything else is cleared only if it is not conversation content
          if (!ancestors.some((a) => a.contains(e)) && !own.some((a) => a.contains(e)) && (isContentBlock(e) || inScroller(e))) continue;
          const cs = win.getComputedStyle(e);
          if (radiusOf(cs) >= 6) continue;
          keepHalo(e, HALO); outline(e, cs);
        }
      }
    }
    function haloPass() {
      if (destroyed || !doc.body) return;
      const vw = win.innerWidth, vh = win.innerHeight;
      haloTick++;
      let edits = [];
      try { edits = Array.prototype.slice.call(doc.querySelectorAll(EDIT_SEL), 0, 12); } catch {}
      const ae = doc.activeElement;
      if (ae && ae.matches && ae.matches(EDIT_SEL) && edits.indexOf(ae) < 0) edits.push(ae);
      const done = new Set();
      for (const ed of edits) {
        const er = ed.getBoundingClientRect();
        if (er.width < 40 || er.height < 10 || er.bottom < 0 || er.top > vh || ed.closest(OVERLAY_SEL)) continue;
        const box = boxFor(ed, vw, vh);
        if (!box || done.has(box.el)) continue;
        done.add(box.el);
        hugBox(box.el, box.r, vw, vh);
      }
      // Marks stay while they keep being confirmed. A gutter that is display:none right now (it only shows while scrolled)
      // keeps its mark, so it is already neutralised when it reappears.
      for (const [el, t] of haloMarks) {
        const gone = !el.isConnected;
        const hidden = !gone && el.getClientRects().length === 0;
        if (gone || (!hidden && haloTick - t > 3)) { el.removeAttribute(HALO); el.removeAttribute(HALO_P); el.removeAttribute(HALO_O); haloMarks.delete(el); if (!gone) checkIsland(el); }
      }
    }
    // Plates and frames often appear on focus or on scroll; look again in the next animation frame, after the page's own
    // handlers have run and before anything is painted, so a newly shown gutter never flashes.
    let haloRaf = 0, haloLast = 0, haloTrail = 0;
    const haloSoon = () => {
      if (destroyed) return;
      win.clearTimeout(haloTrail);
      haloTrail = win.setTimeout(haloPass, 160); // and once more when the scrolling stops
      if (haloRaf || performance.now() - haloLast < 120) return;
      haloRaf = win.requestAnimationFrame(() => { haloRaf = 0; haloLast = performance.now(); haloPass(); });
    };
    // The scan runs in ~4 ms slices (idle time when available) and resumes where it stopped: no element cap.
    let scanNodes = null, scanI = 0, scanHandle = 0, scanIdle = false;
    const schedule = (fn) => {
      if (win.requestIdleCallback) { scanIdle = true; scanHandle = win.requestIdleCallback(fn, { timeout: 400 }); }
      else { scanIdle = false; scanHandle = win.setTimeout(fn, 16); }
    };
    const cancelScan = () => {
      if (scanHandle) { if (scanIdle) win.cancelIdleCallback(scanHandle); else win.clearTimeout(scanHandle); }
      scanHandle = 0; scanNodes = null;
    };
    function scanSlice() {
      scanHandle = 0;
      if (destroyed || !scanNodes || !doc.body) { scanNodes = null; return; }
      const vw = win.innerWidth, vh = win.innerHeight, all = scanNodes, t0 = performance.now();
      let c = 0;
      while (scanI < all.length) {
        const el = scanI < 0 ? doc.body : all[scanI]; // the body itself is often what paints the page colour
        scanI++;
        visit(el, vw, vh);
        if (!islandsReady) checkIsland(el);
        if ((++c & 15) === 0 && performance.now() - t0 > 4) break;
      }
      if (scanI >= all.length) {
        scanNodes = null;
        if (!islandsReady) { islandsReady = true; applyInk(); }
      } else schedule(scanSlice);
    }
    // What is on screen first: the stacks under a grid of points (edges included) cover the header, the composer strip and
    // the page backdrops in a few dozen hit tests. It runs on every tick, even while a full walk is still under way: on a
    // long chat (thousands of elements) the walk alone took 10+ seconds to reach the composer, which stayed opaque meanwhile.
    function visibleFirst(vw, vh) {
      try {
        const seenNow = new Set();
        for (const fx of [.02, .25, .5, .75, .98]) for (const fy of [.004, .03, .08, .3, .6, .9, .95, .985, .996]) {
          for (const el of doc.elementsFromPoint(fx * vw, fy * vh)) if (!seenNow.has(el)) { seenNow.add(el); visit(el, vw, vh, true); checkIsland(el); }
        }
      } catch {}
    }
    let ticks = 0;
    function clearBackdrops(force) {
      if (destroyed || !doc.body || doc.hidden) return;
      const vw = win.innerWidth, vh = win.innerHeight;
      // the on-screen pass runs every tick; the full walk (for whatever the grid misses) every third tick, or when forced
      const walk = force === true || ++ticks % 3 === 1;
      haloPass();
      if (scanNodes || !walk) { visibleFirst(vw, vh); return; }
      prunePinned();
      // drop detached nodes, and let bands go that stopped qualifying
      for (const el of marked) if (!el.isConnected) { el.removeAttribute(MARK); marked.delete(el); }
      for (const el of bandMarked) {
        if (!el.isConnected) { el.removeAttribute(MARK); bandMarked.delete(el); continue; }
        if (!bandShape(el, el.getBoundingClientRect(), vw, vh)) { el.removeAttribute(MARK); el.removeAttribute(FROST); bandMarked.delete(el); scanSeen.delete(el); checkIsland(el); }
      }
      // tinted strips: their colour cannot be re-read while cleared, so only their shape is re-checked
      for (const el of tintMarked) {
        if (!el.isConnected) { el.removeAttribute(MARK); tintMarked.delete(el); continue; }
        const r = el.getBoundingClientRect();
        if ((r.width || r.height) && (!stripShape(r, vw, vh) || el.closest(OVERLAY_SEL) || rounded(win.getComputedStyle(el)))) { el.removeAttribute(MARK); el.removeAttribute(FROST); tintMarked.delete(el); scanSeen.delete(el); checkIsland(el); }
      }
      visibleFirst(vw, vh);
      scanNodes = doc.body.querySelectorAll('*'); scanI = -1;
      scanSlice();
    }
    const restoreBackdrops = () => {
      cancelScan();
      for (const el of marked) el.removeAttribute(MARK);
      for (const el of bandMarked) el.removeAttribute(MARK);
      for (const el of tintMarked) el.removeAttribute(MARK);
      marked.clear(); bandMarked.clear(); tintMarked.clear(); scanSeen = new WeakMap();
      for (const el of doc.querySelectorAll('[' + MARK + '],[' + FROST + ']')) { el.removeAttribute(MARK); el.removeAttribute(FROST); }
      for (const el of haloMarks.keys()) { el.removeAttribute(HALO); el.removeAttribute(HALO_P); el.removeAttribute(HALO_O); }
      haloMarks.clear();
      for (const el of doc.querySelectorAll('[' + HALO + '],[' + HALO_P + '],[' + HALO_O + ']')) { el.removeAttribute(HALO); el.removeAttribute(HALO_P); el.removeAttribute(HALO_O); }
      rootEl.removeAttribute('data-hr-night');
      rootEl.removeAttribute('data-hr-frost-on');
      rootEl.removeAttribute('data-hr-ink');
      for (const el of [...pinned.keys()]) unpinIsland(el);
      for (const el of doc.querySelectorAll('[' + ISLAND + ']')) el.removeAttribute(ISLAND);
      sheet.remove();
      if (rootPrev[0]) rootEl.style.setProperty('background-color', rootPrev[0], rootPrev[1]); else rootEl.style.removeProperty('background-color');
    };
    const maskTimer = win.setInterval(clearBackdrops, 1500);
    let resizeScanT = 0;
    const onResizeScan = () => { win.clearTimeout(resizeScanT); resizeScanT = win.setTimeout(() => clearBackdrops(true), 250); };
    (doc.documentElement).appendChild(canvas);
    // The "fluid" background (Settings > Weather > Background): a second canvas, drawn by fluid-sim.js, sits above this one. This
    // sky keeps doing everything else for it (clearing the page backdrops, the message-box plate, the text colour, the clean-up
    // when it is switched off) but draws nothing: its night palette is the dark colour the ink is decided against, so text is white.
    // If the fluid cannot start (no WebGL2/float textures), the sky simply draws as usual.
    const fluid = opts.fluid && AM.FluidSim ? AM.FluidSim.mount({ strength: opts.strength, onLost: () => onLost() }) : null;

    const reduceMq = win.matchMedia('(prefers-reduced-motion: reduce)');
    let W = 0, H = 0, raf = 0, last = 0, lost = false;
    let strength = fluid ? 1 : clamp(opts.strength == null ? 1 : opts.strength, .2, 1);
    let dark = pageIsDark();
    let tone = null;

    // The palette (CPU side) turns hour x season x weather into final colours and amounts; every value eases toward its
    // target over a second or two, so a change in the weather or the hour never pops.
    const PAL = AM.SKYPAL;
    let sky = { season: 'summer', weather: 'clear', hour: 12, rise: 6.3, set: 18.4, live: true, seasonForced: false, t0: performance.now(), wind: [.5, 0] };
    let curU = null, simT = 0, shX = 0, shY = 0;
    let flashT0 = -10, flashNext = 2.5, flashX = .85, boltOn = false;
    // one peak per strike: a single exponential decay (no flicker train, WCAG 2.3.1)
    const flashAt = (t) => { const d = t - flashT0; return d < 0 || d > 1.2 ? 0 : Math.exp(-d * 9); };

    const gov = makeGovernor(); // a slow GPU steps the resolution down instead of stuttering
    let lastRaf = 0; // animation-frame spacing, to step quality back up on a fast GPU
    const resize = (noDraw) => {
      // drawn at the screen's real pixels, capped so a big or high-DPI screen stays light on the GPU
      const dpr = Math.min(1.5, win.devicePixelRatio || 1);
      const k = Math.max(.45, Math.min(dpr, Math.sqrt(1.5e6 / Math.max(1, win.innerWidth * win.innerHeight))) * gov.quality);
      const w = Math.max(2, Math.round(win.innerWidth * k)), h = Math.max(2, Math.round(win.innerHeight * k));
      if (w === W && h === H) return;
      W = w; H = h; canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H);
      // changing the size clears the buffer (alpha is off, so it would show black): always draw again at once, and let the
      // next tick draw too. noDraw: the caller draws right after (the quality step-up at the top of a tick).
      last = 0;
      if (!noDraw && !lost && curU) frame(performance.now(), 0);
    };
    const onWinResize = () => resize();

    // The canvas is always shown whole, in its own colours: no fade by night, no brightness or saturation filter. Sky strength and
    // the page's colour are blended inside the shader (uMix, uPage), before the ink band, so text contrast holds at any strength.
    // (1.4.5 and earlier faded and washed the sky toward white for dark text, and inverted light pages at night; now the text
    // follows the sky instead, see decideInk.)
    let lastOp = -1;
    function setOpacity() {
      if (lastOp === 1 || fluid) return; // with the fluid the sky canvas stays transparent: the page colour shows through at low strength
      lastOp = 1; canvas.style.opacity = '1'; canvas.style.filter = 'none';
    }
    function applyTone() {
      const t = dark ? 'dark' : 'light';
      if (t === tone) return;
      tone = t;
      canvas.style.mixBlendMode = 'normal';
      setOpacity();
    }

    // ---- ink: the colour of the text that sits straight on the sky ----
    // Whichever of the two inks needs the smaller lightness change to the sky wins: OKLab lightness is sampled at the top,
    // middle and horizon of the sky as it will be drawn (clouds, fog and Sky strength included), and each ink's cost is how far
    // those samples sit outside its band (dark ink needs L >= LMIN, white ink L <= LMAX; the shader holds the same values).
    // A change of ink must win clearly (by .02) for 2.5 s, so the text never flickers at dusk.
    const LMIN = .64, LMAX = .50, VIVID = 1.4;
    const s2l = (c) => (c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4));
    const okL = (c) => {
      const r = s2l(clamp(c[0], 0, 1)), g = s2l(clamp(c[1], 0, 1)), b = s2l(clamp(c[2], 0, 1));
      const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
      return .2104542553 * l + .7936177850 * m - .0040720468 * s;
    };
    const mixv = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const pageColour = () => (pageRGB ? [pageRGB[0] / 255, pageRGB[1] / 255, pageRGB[2] / 255] : dark ? [.078, .078, .11] : [1, 1, 1]);
    let ink = 0, inkWant = 0, inkSince = 0, curInk = NaN, bandK = 0;
    function inkCosts(u) {
      const page = pageColour();
      const cloud = mixv(u.uAmb, u.uLit, .55), cov = clamp(u.uCover, 0, 1) * .7, fog = clamp(u.uFog, 0, 1) * .6;
      let dk = 0, lt = 0;
      for (const [c, w] of [[u.uTop, .25], [u.uMid, .45], [u.uHor, .3]]) {
        const L = okL(mixv(page, mixv(mixv(c, cloud, cov), u.uFogCol, fog), strength));
        dk += w * Math.max(0, LMIN - L); lt += w * Math.max(0, L - LMAX);
      }
      return { dark: dk, light: lt };
    }
    function applyInk() {
      if (destroyed || !ink || !islandsReady) return;
      const first = !inkActive();
      if (first && !siteInk && doc.body) siteInk = win.getComputedStyle(doc.body).color;
      rootEl.setAttribute('data-hr-ink', ink > 0 ? 'dark' : 'light');
      if (first) for (const el of doc.querySelectorAll('[' + ISLAND + ']')) pinIsland(el);
    }
    function decideInk(now, u) {
      const c = inkCosts(u);
      const want = c.dark <= c.light ? 1 : -1;
      if (!ink) { ink = want; applyInk(); return; }
      if (want === ink || Math.abs(c.dark - c.light) < .02) { inkWant = 0; return; }
      if (inkWant !== want) { inkWant = want; inkSince = now; }
      if (reduceMq.matches || now - inkSince > 2500) { inkWant = 0; ink = want; applyInk(); }
    }

    // The page's own theme can change after we mounted (a toggle, late CSS, the system scheme). Read it with our own
    // overrides lifted for a moment, then put them back; follow the new colour with the forced root background.
    let mo = null, readT = 0, lastSig = '';
    // a cheap signature of everything that could flip the page's theme (our own data-hr-* marks left out)
    const themeSig = () => {
      const parts = [];
      for (const el of [rootEl, doc.body]) {
        if (!el) continue;
        parts.push(el.className && el.className.baseVal === undefined ? el.className : '');
        for (const a of el.attributes) if (a.name.indexOf('data-') === 0 && a.name.indexOf('data-hr-') !== 0) parts.push(a.name + '=' + a.value);
      }
      // inline CSS variables on <html>/<body> (a theme set through style="--bg:..."), minus the background colour we force ourselves
      for (const el of [rootEl, doc.body]) if (el) parts.push((el.getAttribute('style') || '').replace(/background-color\s*:[^;]*;?/g, ''));
      // stylesheets in <head> (a theme swapped in by adding or removing a <link> or <style>), ours left out
      if (doc.head) parts.push('css:' + doc.head.querySelectorAll('link[rel~="stylesheet"],style:not([data-headroom])').length);
      parts.push(win.getComputedStyle(rootEl).colorScheme || '');
      return parts.join('|');
    };
    lastSig = themeSig();
    let lastReadAt = -Infinity;
    const READ_GAP = 1000;
    function readDark() {
      if (destroyed) return;
      readRuns++; lastReadAt = performance.now();
      lastSig = themeSig();
      const pv = rootEl.style.getPropertyValue('background-color'), pp = rootEl.style.getPropertyPriority('background-color');
      let d = dark, col = null;
      sheet.disabled = true;
      rootEl.style.removeProperty('background-color');
      const pins = [...pinned.keys()];
      for (const el of pins) unpinIsland(el);
      try {
        d = pageIsDark(true); col = readPageBg();
        if (doc.body) siteInk = win.getComputedStyle(doc.body).color;
        for (const el of doc.querySelectorAll('[' + ISLAND + ']')) islandOrig.set(el, win.getComputedStyle(el).color);
      }
      finally {
        const next = d !== dark ? (col || (d ? '#14141c' : '#ffffff')) : null;
        if (next) rootEl.style.setProperty('background-color', next, 'important');
        else if (pv) rootEl.style.setProperty('background-color', pv, pp);
        sheet.disabled = false;
        if (mo) mo.takeRecords(); // our own writes are not page changes
        for (const el of doc.querySelectorAll('[' + ISLAND + ']')) pinIsland(el);
      }
      const rgb = rgbaOf(col);
      if (rgb && !(pageRGB && AM.sameColour(rgb, pageRGB, 2))) {
        // the page changed colour (theme toggle): strips cleared for the old colour are judged again
        pageRGB = rgb;
        for (const el of tintMarked) el.removeAttribute(MARK);
        tintMarked.clear(); scanSeen = new WeakMap();
        clearBackdrops(true);
      }
      if (d !== dark) { dark = d; tone = null; applyTone(); }
      if (AM.widget && AM.widget.retone) AM.widget.retone();
    }
    // a burst of <head> and <html> / <body> changes ends in one look at the signature, and the read runs only if it changed (and at most once a second)
    const maybeRead = (force) => {
      if (destroyed) return;
      const wait = readGate(themeSig(), lastSig, performance.now(), lastReadAt, READ_GAP, force === true);
      if (wait < 0) return;
      if (wait > 0) { win.clearTimeout(readT); readT = win.setTimeout(() => maybeRead(force), wait); return; }
      forcePending = false;
      readDark();
    };
    let forcePending = false; // sticky: a later, unforced reschedule (a <meta> update within 300 ms) must not drop a forced read
    const scheduleRead = (force) => { if (force === true) forcePending = true; win.clearTimeout(readT); readT = win.setTimeout(() => maybeRead(forcePending), 300); };
    const onSchemeChange = () => scheduleRead(true); // the system scheme flipped: CSS media queries may have changed the colours without touching any attribute

    function setState(st) {
      if (destroyed) return;
      if (fluid) st = { season: 'summer', weather: 'clear', tod: 0, live: false, windX: 0, windY: 0 }; // the fixed dark palette
      sky = { season: st.season, weather: st.weather, hour: st.tod, rise: st.rise, set: st.set, live: !!st.live, seasonForced: !!st.seasonForced, t0: performance.now(), wind: [st.windX * 2.2, st.windY || 0] };
      if (reduceMq.matches) curU = null; // no easing without motion: show the new state at once
      if (reduceMq.matches || !raf) frame(performance.now(), .05);
    }
    function setStrength(v) { if (destroyed) return; const s = clamp(v, .2, 1); if (fluid) fluid.setStrength(s); strength = fluid ? 1 : s; tone = null; applyTone(); } // (the fluid dims itself; its canvas stays opaque black, so the ink never needs the page colour)

    function frame(now, dt) {
      simT += dt;
      const hour = sky.live ? (sky.hour + (now - sky.t0) / 3.6e6) % 24 : sky.hour; // the hour moves on in real time
      const tgt = PAL.uniforms({ season: sky.season, weather: sky.weather, hour, rise: sky.rise, set: sky.set, t: 0, wind: sky.wind, flash: 0, bolt: 0, seasonMood: sky.seasonForced });
      // a non-finite target (e.g. polar day, rise == set) must never get into the eased values
      for (const key in tgt) {
        const v = tgt[key], c = curU && curU[key];
        if (typeof v === 'number') { if (!Number.isFinite(v)) tgt[key] = typeof c === 'number' && Number.isFinite(c) ? c : 0; }
        else if (v && v.length) for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) v[i] = c && Number.isFinite(c[i]) ? c[i] : 0;
      }
      // thunderstorms flash at random (never with reduced motion); a forced monsoon night flickers far away
      const stormy = !reduceMq.matches && (sky.weather === 'storm' || (sky.season === 'monsoon' && sky.weather === 'clear' && sky.seasonForced && tgt.uNight > .5));
      if (stormy && simT > flashNext) {
        flashT0 = simT; flashNext = simT + 4 + Math.random() * 7;
        flashX = Math.random() < .5 ? .07 + Math.random() * .13 : .8 + Math.random() * .13;
        boltOn = sky.weather === 'storm' && Math.random() < .45;
      }
      const rawFlash = stormy ? flashAt(simT) * (sky.weather === 'storm' ? .75 : .3) : 0;
      const fl = Math.min(.18, rawFlash); // a soft brightening, never a hard strobe
      if (!curU) curU = JSON.parse(JSON.stringify(tgt)); // the very first state is shown at once
      const kSlow = 1 - Math.exp(-dt / 1.6), kSun = 1 - Math.exp(-dt / .35);
      for (const key in tgt) {
        if (key === 'uTime') continue;
        const k = key === 'uSun' || key === 'uMoon' ? kSun : kSlow;
        if (typeof tgt[key] === 'number') {
          if (!Number.isFinite(curU[key])) curU[key] = tgt[key];
          curU[key] += (tgt[key] - curU[key]) * k;
        } else {
          if (!curU[key]) curU[key] = tgt[key].slice();
          for (let i = 0; i < tgt[key].length; i++) {
            if (!Number.isFinite(curU[key][i])) curU[key][i] = tgt[key][i];
            curU[key][i] += (tgt[key][i] - curU[key][i]) * k;
          }
        }
      }
      // the ink for this sky; the sky's band follows it smoothly (the page's text switches at once)
      decideInk(now, curU);
      if (!Number.isFinite(curInk) || reduceMq.matches) curInk = ink;
      else curInk += (ink - curInk) * kSlow;
      bandK = bandStep(bandK, inkActive(), kSlow, reduceMq.matches); // no band until the page's text has taken the ink
      shX += (curU.uWind[0] + .45) * dt; shY += curU.uWind[1] * dt; // always a gentle drift, more with real wind
      if (doc.hidden) return; // nothing is drawn while the tab is hidden
      if (fluid) return; // the fluid draws its own canvas; the sky only decided the ink above
      const set1 = (n, v) => { const l = U[n]; if (l == null) return; if (typeof v === 'number') gl.uniform1f(l, v); else if (v.length === 2) gl.uniform2fv(l, v); else gl.uniform3fv(l, v); };
      set1('uRes', [W, H]); set1('uTime', 37 + simT);
      for (const key in curU) set1(key, curU[key]);
      set1('uShift', [shX, shY]);
      set1('uFlash', fl); set1('uFlashX', flashX); set1('uBolt', boltOn ? Math.min(.6, rawFlash * 1.6) : 0);
      set1('uInk', curInk * bandK); set1('uVivid', VIVID); set1('uPage', pageColour()); set1('uMix', strength);
      setOpacity();
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function tick(now) {
      raf = 0;
      if (destroyed || lost) return;
      if (lastRaf && gov.raf(now - lastRaf, now)) resize(true); // quality steps back up (with a cooldown, see makeGovernor)
      lastRaf = now;
      if (now - last >= (fluid ? 1000 : 33)) { // 30 frames a second is plenty for a sky (once a second for the fluid: this loop only decides the ink)
        const gap = last ? now - last : 33;
        const dt = last ? Math.min(.1, gap / 1000) : .033;
        last = now;
        frame(now, dt);
        if (gov.drawn(gap, now)) resize();
      }
      raf = win.requestAnimationFrame(tick);
    }
    const start = () => { if (!raf && !destroyed && !lost && !doc.hidden && !reduceMq.matches) raf = win.requestAnimationFrame(tick); };
    const stop = () => { if (raf) { win.cancelAnimationFrame(raf); raf = 0; } lastRaf = 0; };

    const onVis = () => {
      if (doc.hidden) {
        stop();
        // uTime grows for days otherwise and the shader loses float precision: start the clock over
        if (simT > 1e4) { simT = 0; shX = 0; shY = 0; flashT0 = -10; flashNext = 2.5; }
      } else if (reduceMq.matches) { if (curU && !lost) frame(performance.now(), 0); }
      else start();
    };
    const onMotion = () => { if (reduceMq.matches) { stop(); curU = null; frame(performance.now(), .05); } else start(); };
    const darkMq = win.matchMedia('(prefers-color-scheme: dark)');
    let api = null;
    const onLost = () => { lost = true; if (api) api.destroy(); if (opts.onLost) opts.onLost(); }; // no preventDefault: the context stays gone, the page is put back as it was
    // forced colours or "more contrast" switched on while mounted: hand the page back (the caller may mount again when it is off)
    const plainMqs = PLAIN_QUERIES.map((q) => win.matchMedia(q));
    const onPlain = () => { if (destroyed || !plainMqs.some((m) => m.matches)) return; if (api) api.destroy(); if (opts.onDisabled) opts.onDisabled(); };
    for (const m of plainMqs) m.addEventListener('change', onPlain);
    api = {
      setState, setStrength,
      stats: () => ({ pinned: pinned.size, pinnedDetached: [...pinned.keys()].filter((e) => !e.isConnected).length, queued: islandQueue.size, readRuns }),
      setFrost(v) { frost = !!v; applyFrost(); },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (live === api) live = null;
        for (const m of plainMqs) m.removeEventListener('change', onPlain);
        stop();
        win.clearInterval(maskTimer); win.clearInterval(sigTimer);
        islandMo.disconnect(); if (islandRaf) win.cancelAnimationFrame(islandRaf); win.clearTimeout(islandTimer); islandQueue.clear(); win.clearTimeout(hoverT);
        doc.removeEventListener('pointerover', onHover, true); doc.removeEventListener('pointerout', onHover, true);
        doc.removeEventListener('focusin', onHover, true); doc.removeEventListener('focusout', onHover, true);
        doc.removeEventListener('transitionend', onTransition, true);
        win.clearTimeout(resizeScanT); win.clearTimeout(readT); win.clearTimeout(firstRead);
        win.removeEventListener('resize', onResizeScan);
        doc.removeEventListener('scroll', haloSoon, true); doc.removeEventListener('focusin', haloSoon, true); doc.removeEventListener('focusout', haloSoon, true);
        if (haloRaf) win.cancelAnimationFrame(haloRaf);
        win.clearTimeout(haloTrail);
        restoreBackdrops();
        if (mo) { mo.disconnect(); mo = null; }
        darkMq.removeEventListener('change', onSchemeChange);
        win.removeEventListener('resize', onWinResize);
        doc.removeEventListener('visibilitychange', onVis);
        reduceMq.removeEventListener('change', onMotion);
        canvas.removeEventListener('webglcontextlost', onLost);
        if (fluid) { try { fluid.destroy(); } catch {} }
        let ext = null;
        try { ext = gl.getExtension('WEBGL_lose_context'); } catch {}
        canvas.remove();
        if (ext) { try { ext.loseContext(); } catch {} }
      },
      canvas,
    };
    win.addEventListener('resize', onResizeScan);
    // capture: scroll events do not bubble, and the conversation scrolls inside its own container, not the window
    doc.addEventListener('scroll', haloSoon, { capture: true, passive: true });
    doc.addEventListener('focusin', haloSoon, true);
    doc.addEventListener('focusout', haloSoon, true);
    if (doc.body) islandMo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    doc.addEventListener('pointerover', onHover, true); doc.addEventListener('pointerout', onHover, true);
    doc.addEventListener('focusin', onHover, true); doc.addEventListener('focusout', onHover, true);
    doc.addEventListener('transitionend', onTransition, true);
    win.addEventListener('resize', onWinResize);
    doc.addEventListener('visibilitychange', onVis);
    reduceMq.addEventListener('change', onMotion);
    canvas.addEventListener('webglcontextlost', onLost);
    darkMq.addEventListener('change', onSchemeChange);
    // every attribute change on <html> and <body> (ours, data-hr-*, are ignored), and stylesheet / meta swaps in <head>
    mo = new MutationObserver((recs) => { if (recs.some((r) => r.type !== 'attributes' || (r.attributeName || '').indexOf('data-hr-') !== 0)) scheduleRead(); });
    mo.observe(rootEl, { attributes: true });
    if (doc.body) mo.observe(doc.body, { attributes: true });
    if (doc.head) mo.observe(doc.head, { childList: true });
    // fallback for anything the observer cannot see (media-query flips, late CSS): the expensive read runs only if the signature changed
    const sigTimer = win.setInterval(() => { if (!destroyed && themeSig() !== lastSig) readDark(); }, 5000);
    const firstRead = win.setTimeout(readDark, 1500); // site CSS may not have loaded yet at mount

    resize();
    applyTone();
    clearBackdrops();
    canvas.style.opacity = '0';
    win.requestAnimationFrame(() => { if (destroyed) return; lastOp = -1; setOpacity(); });
    start();

    live = api;
    return api;
  }

  AM.WeatherSky = { mount, pageIsDark, makeGovernor, makeBatchQueue, isContentBlock, bandStep, plainLook, readGate, stats: () => (live ? live.stats() : null) };
})();
