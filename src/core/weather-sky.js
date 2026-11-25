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
// sky stops, computed on the CPU from hour x season x weather
uniform vec3 uTop,uMid,uHor,uGlow;
// light: sun or moon colour, cloud lit side, cloud shadow side
uniform vec3 uSunCol,uLit,uAmb,uFogCol;
uniform vec2 uSun,uMoon;
uniform float uSunVis,uMoonVis,uMoonPhase,uTwi,uNight,uDay;
uniform float uCover,uGloom,uTower,uCirrus,uRain,uSnow,uFog,uHaze,uHalo,uSparkle;
uniform float uStars,uMilky,uPetals,uLeaves,uFlash,uFlashX,uBolt,uCalm;
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
  float shape=fbm(p*.55,4);                               // where the clouds are
  vec2 w=vec2(vn(p*1.3+4.1),vn(p*1.3+9.7))-.5;
  float detail=fbm(p*2.6+w*.9+shape*1.5,5);              // the puffs inside them
  float lobes=bill(p*5.2+w,3);                           // small rounded lobes on the edges
  float n=shape*.62+detail*.36+lobes*.12+bias;
  float lo=mix(.75,.36,cov);
  return clamp((n-lo)*mix(6.,3.,uGloom),0.,1.);
}
vec4 cumulus(vec2 uv,float asp,float cov,float bias,float calm,vec2 Lp,float Lvis,float sc){
  float hz=max(uv.y,0.)+.28;                             // distance to the horizon: clouds shrink and flatten towards it
  vec2 p=vec2((uv.x-.5)*asp/pow(hz,.55)*.62,1./hz*.85)*sc+uSeed;
  p+=uShift*.012;
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
  p+=uShift*.004;
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

void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  // the reading column: middle third, lower two thirds of the window
  float calm=(1.-smoothstep(.17,.36,abs(uv.x-.5)))*(1.-smoothstep(.70,.95,uv.y))*uCalm;

  vec3 base=skyDome(uv,asp);
  vec3 col=base;

  if(uNight>.01)col+=nightSky(uv,asp)*uNight*(1.-smoothstep(.25,.85,uCover))*(1.-.5*calm);

  // sun behind everything else
  float ls=length((uv-uSun)*vec2(asp,1.));
  col+=uSunCol*(exp(-ls*4.)*.16+exp(-ls*14.)*.28+exp(-ls*55.)*.55)*uSunVis;
  col=mix(col,vec3(1.,.99,.96)*1.7,smoothstep(.021,.0175,ls)*uSunVis*(1.-uFog*.85));

  // moon: soft atmosphere, a faint 22-degree ice halo in cold, hazy air, then the disc
  float lm=length((uv-uMoon)*vec2(asp,1.));
  col+=vec3(.78,.84,.95)*(exp(-lm*5.)*.08+exp(-lm*18.)*.18+exp(-lm*60.)*.3)*uMoonVis;
  float ring=exp(-pow((lm-.20)/.022,2.))*(.6+.4*fbm(uv*vec2(asp,1.)*6.,3));
  col+=(vec3(.72,.78,.92)*ring+vec3(.06,.03,.01)*exp(-pow((lm-.182)/.012,2.)))*.035*uHalo*uMoonVis;
  vec4 mo=moonDisc(uv,asp);
  col=mix(col,mo.rgb,mo.a*uMoonVis);

  vec2 Lp=uSunVis>uMoonVis?uSun:uMoon;
  float Lvis=max(uSunVis,uMoonVis*.55);

  // high cirrus, then the cumulus deck in two depths
  // a solid cloud deck under heavy cover: soft, low-contrast texture so grey never reads as flat paint
  if(uCover>.8){
    float hz=max(uv.y,0.)+.3;
    vec2 sp=vec2((uv.x-.5)*asp/pow(hz,.55)*.5,1./hz*.7)*1.6+uSeed*.7+uShift*.008;
    float stx=fbm(sp,5);
    vec3 deck=mix(uAmb,mix(uAmb,uLit,.75),smoothstep(.3,.75,stx));
    col=mix(col,mix(deck,base,.35),smoothstep(.8,1.,uCover)*.75*(1.-.3*calm));
  }
  float ci=cirrus(uv,asp);
  col=mix(col,uLit*1.02+uGlow*.12*uTwi,ci*.42*(1.-.4*calm));
  // keep the open sky open where people read: clouds lean to the top and the side edges
  float edges=smoothstep(.22,.5,abs(uv.x-.5));
  float topb=smoothstep(.55,.95,uv.y);
  float bias=(.05*topb+.05*edges-.09*calm)*(1.-uCover*uCover);
  vec4 c2=cumulus(uv+vec2(.37,.0),asp,uCover*.8,bias-.03,calm,Lp,Lvis,1.9);
  c2.rgb=mix(c2.rgb,base,.18);
  col=mix(col,c2.rgb,c2.a*.85*(1.-.75*uCover*uCover));
  vec4 c1=cumulus(uv,asp,uCover,bias,calm,Lp,Lvis,1.1);
  col=mix(col,c1.rgb,c1.a);
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
      col+=vec3(.90,.93,1.)*bb*uBolt*smoothstep(.2,.32,y)*(1.-.8*c1.a);
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
    col=mix(col,fc,f*.9);
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

  // the reading column: pull mid-tones gently back towards the open sky
  col=mix(col,base+(col-base)*.6,calm*.5);
  // soft shoulder so glows never clip into flat white
  col=vec3(col.r<.82?col.r:.82+.18*(1.-exp(-(col.r-.82)/.18)),
           col.g<.82?col.g:.82+.18*(1.-exp(-(col.g-.82)/.18)),
           col.b<.82?col.b:.82+.18*(1.-exp(-(col.b-.82)/.18)));
  // corners just a touch deeper for depth; never the middle
  col*=1.-.10*pow(length((uv-vec2(.5,.45))*vec2(1.,1.2)),2.5);
  col+=(h21(gl_FragCoord.xy+fract(uTime)*91.)-.5)/255.;
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

    // The palette (CPU side) turns hour x season x weather into final colours and amounts; every value eases toward its
    // target over a second or two, so a change in the weather or the hour never pops.
    const PAL = AM.SKYPAL;
    let sky = { season: 'summer', weather: 'clear', hour: 12, rise: 6.3, set: 18.4, live: true, t0: performance.now(), wind: [.5, 0] };
    let curU = null, simT = 0, shX = 0, shY = 0;
    let flashT0 = -10, flashNext = 2.5, flashX = .85, boltOn = false;
    const flashAt = (t) => { const d = t - flashT0; return d < 0 || d > 1.2 ? 0 : Math.exp(-d * 9) + .7 * Math.exp(-Math.abs(d - .16) * 22) + .45 * Math.exp(-Math.abs(d - .38) * 16); };

    let quality = 1, slow = 0, seen = 0; // a slow GPU steps the resolution down instead of stuttering
    const resize = () => {
      // drawn at the screen's real pixels, capped so a big or high-DPI screen stays light on the GPU
      const dpr = Math.min(1.5, win.devicePixelRatio || 1);
      const k = Math.max(.45, Math.min(dpr, Math.sqrt(2.4e6 / Math.max(1, win.innerWidth * win.innerHeight))) * quality);
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
      lastOp = -1; lastFilter = ""; setOpacity(lastNight);
    }
    const keepTimer = win.setInterval(() => { if (pure && docScrolls()) { noPure = true; setPure(false); } }, 1500);

    let lastOp = -1, lastFilter = "";
    function setOpacity(night) {
      lastNight = night;
      if (!dark && (night > .55 && !pure && !noPure && !docScrolls() || night < .4 && pure)) { setPure(night > .55); return; }
      const deep = dark || pure;
      const o = strength * (deep ? .96 : 1 - .68 * night);
      // a dark page's white text sits on a daytime sky a little dimmed; a light page at dusk gets the sky lifted to a soft tone so dark text stays readable
      const f = deep ? 'brightness(' + (1 - .14 * (1 - night)).toFixed(2) + ')' : night > .02 ? 'brightness(' + (1 + 2.2 * night).toFixed(2) + ') saturate(.8)' : 'none';
      if (Math.abs(o - lastOp) > .01 || f !== lastFilter) {
        lastOp = o; lastFilter = f; canvas.style.opacity = String(o); canvas.style.filter = f;
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
      sky = { season: st.season, weather: st.weather, hour: st.tod, rise: st.rise, set: st.set, live: !!st.live, t0: performance.now(), wind: [st.windX * 2.2, st.windY || 0] };
      if (reduceMq.matches || !raf) frame(performance.now(), .05);
    }
    function setStrength(v) { strength = clamp(v, .2, 1); tone = null; applyTone(); }

    function frame(now, dt) {
      simT += dt;
      const hour = sky.live ? (sky.hour + (now - sky.t0) / 3.6e6) % 24 : sky.hour; // the hour moves on in real time
      const tgt = PAL.uniforms({ season: sky.season, weather: sky.weather, hour, rise: sky.rise, set: sky.set, t: 0, wind: sky.wind, flash: 0, bolt: 0 });
      // thunderstorms flash at random; a monsoon night flickers far away
      const stormy = sky.weather === 'storm' || (sky.season === 'monsoon' && sky.weather === 'clear' && tgt.uNight > .5);
      if (stormy && simT > flashNext) {
        flashT0 = simT; flashNext = simT + 4 + Math.random() * 7;
        flashX = Math.random() < .5 ? .07 + Math.random() * .13 : .8 + Math.random() * .13;
        boltOn = sky.weather === 'storm' && Math.random() < .45;
      }
      const fl = stormy ? flashAt(simT) * (sky.weather === 'storm' ? .75 : .3) : 0;
      if (!curU) curU = JSON.parse(JSON.stringify(tgt)); // the very first state is shown at once
      const kSlow = 1 - Math.exp(-dt / 1.6), kSun = 1 - Math.exp(-dt / .35);
      for (const key in tgt) {
        if (key === 'uTime') continue;
        const k = key === 'uSun' || key === 'uMoon' ? kSun : kSlow;
        if (typeof tgt[key] === 'number') curU[key] += (tgt[key] - curU[key]) * k;
        else for (let i = 0; i < tgt[key].length; i++) curU[key][i] += (tgt[key][i] - curU[key][i]) * k;
      }
      shX += curU.uWind[0] * dt; shY += curU.uWind[1] * dt;
      const set1 = (n, v) => { const l = U[n]; if (l == null) return; if (typeof v === 'number') gl.uniform1f(l, v); else if (v.length === 2) gl.uniform2fv(l, v); else gl.uniform3fv(l, v); };
      set1('uRes', [W, H]); set1('uTime', 37 + simT);
      for (const key in curU) set1(key, curU[key]);
      set1('uShift', [shX, shY]);
      set1('uFlash', fl); set1('uFlashX', flashX); set1('uBolt', boltOn ? Math.min(1, fl * 1.6) : 0);
      setOpacity(curU.uNight);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function tick(now) {
      raf = 0;
      if (destroyed || lost) return;
      if (now - last >= 33) { // 30 frames a second is plenty for a sky
        const gap = last ? now - last : 33;
        const dt = last ? Math.min(.1, gap / 1000) : .033;
        last = now;
        frame(now, dt);
        // frames arriving much slower than 30 a second, for about two seconds: draw fewer pixels (down to about 45%)
        if (++seen > 20 && quality > .46) { slow = gap > 50 ? slow + 1 : Math.max(0, slow - 1); if (slow > 45) { slow = 0; quality *= .8; resize(); } }
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
