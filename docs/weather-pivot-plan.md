# Pivot plan: realistic live-weather background

Written 2026-11-23 after studying `claude-animation-skills` (cloned to `Projects/2 Relevant (not now)/claude-animation-skills`, MIT licence).

## 1. What the repo is, and what we can take from it

It is a set of Claude Code skills that render short **reels to mp4** (1080x1920, offline: HyperFrames + three.js + GSAP + Playwright). It is not a realtime library and it ships **no photographic or weather assets**.

| In the repo | Use for Headroom |
|---|---|
| Fonts (Inter, Inter Tight, Poppins, JetBrains Mono, Lora, Pixelify; SIL OFL) | Fine to bundle for the settings page or video captions, keep the OFL files |
| `kit/`, `build.py`, `template.html` pattern | Render **marketing videos and store promos** of the weather scenes the same way (spec -> mp4). Not runtime |
| `zach-d-films/engine/src/textures.js`, `low-poly/template.html` | Technique: every texture drawn in code (canvas), seeded RNG, glow sprite, `onBeforeCompile` shader hooks (dither, vertex snap), fog. Ideas, not assets |
| `kurzgesagt` template | Technique for a stylised night sky (twinkling stars, glow filters, crescent shading) |
| `low-poly` snow and petals | Same idea as our snowfall; ours already has surface physics |
| Sample Kokoro voice wav, two jpg previews | Nothing useful |

Honest summary: **take the techniques, not assets.** For realism we need real sources (below), not this repo.

## 2. Where realism comes from

1. **Procedural GLSL, not sprites.** One full-screen WebGL pass per frame: sky (sun/moon/stars, time-of-day colour), clouds from fractal noise advected by the real wind, rain as depth-layered streaks, fog as layered noise, lightning as a bolt plus sky flash. Small (tens of KB), resolution-independent, fully tied to live data.
2. **Our existing water pipeline.** Rain on "glass" (drops that bend the picture) and splashes use the wave/refraction engine and the ledge physics already built (snow lands on bubbles, scroll shakes it loose; rain splashes and runs off the same ledges).
3. **CC0 photo sources for textures/skies** if wanted: Poly Haven (HDRI skies, CC0), ambientCG (CC0 textures). Convert to 1k JPEG/WebP, ~100-300 KB each.
4. **Real footage loops** (Coverr, Pexels, Pixabay: free licences) are the most photoreal but huge, opaque, not interactive, need sign-in to download. Optional "cinematic" mode only.

## 3. Live weather: how it works

**Data (no server of our own)**
- Open-Meteo forecast API: free, no key, CORS-friendly, returns current weather code (WMO), cloud cover, precipitation, wind speed/direction, temperature, `is_day`, sunrise/sunset. Check its terms: the free tier is for non-commercial use.
- MET Norway is free but needs a custom User-Agent, which browsers cannot send, so skip it.
- Called from the **background service worker** every 15-30 min (`chrome.alarms`), cached in `chrome.storage.local`. Tabs only read the cache. Never one request per tab.

**Location (the privacy-sensitive part)**
1. Settings page: "Use my location" (asks Chrome once, extension origin, not per website), or "type a city" (Open-Meteo geocoding). City entry is the privacy-best path.
2. Store only coordinates **rounded to 2 decimals (~1 km)**, locally. Send them only to the weather API. No IP-geolocation services.

**Season**: month plus hemisphere (sign of latitude) plus climate band, nudged by temperature. India needs its own mapping (summer heat haze, monsoon, post-monsoon, winter fog), not just four temperate seasons. Seasonal props: spring blossoms/petals, summer heat shimmer and light, monsoon heavy rain, autumn leaves (land on ledges, shaken by scroll), winter snow/fog.

**Time of day**: from sunrise/sunset, smooth blend dawn -> day -> dusk -> night (colour, sun/moon position, stars, light on the water).

**Weather state** (from WMO code): `{ cloud 0..1, precip: none|drizzle|rain|snow|sleet, intensity, fog, thunder, windSpeed, windDir, temp, isDay }` drives every shader parameter; changes cross-fade over ~20 s so it never pops.

## 4. Build order

1. **Engine + sky**: time-of-day sky, sun/moon/stars, noise clouds driven by cover and wind. Location via city search + cache + alarm.
2. **Precipitation**: rain (streaks, glass drops via the water pipeline, splashes on ledges), drizzle, snow (reuse), fog.
3. **Season and extras**: leaves/petals with ledge physics, heat shimmer, lightning, rainbow after rain, wind sway.
4. **Performance and polish**: half-resolution render + upscale, 30 fps when idle, pause when hidden/on battery saver, reduced-motion still frame, quality setting.
5. **Marketing**: render launch videos per weather with the repo's HyperFrames pattern.

Milestones 1 and 2 are the first shippable version.

## 5. What a pivot changes (decide before building)

- **Single purpose / Web Store review.** Today's store listing says one purpose: usage meter. A weather ambience is a different purpose. Safer: a separate extension (new name, new listing), keeping Headroom as the meter.
- **Permissions and privacy policy.** New: optional `geolocation`, host permission for the weather API. The policy currently says nothing leaves the machine except provider calls. Rounded coordinates going to the weather API must be disclosed; data-usage answers change ("location").
- **Iris removal** (you said she is gone): delete `src/core/pet.js`, `iris-frames.js`, `walk8-frames.js`, `src/assets/iris/*` (the bulk of the zip), the pet settings (`pet`, `irisEnergy`, `explore`), the panel's Iris button, the Iris section of README/privacy/listing, and Iris tests. "Iris physics" (things landing on page ledges) stays as generic surface physics.
- **AI-site scope.** Meter needs the 18 AI hosts. A weather background could run on any site (broader permission, harder review) or stay on AI sites only.

## 6. Open questions

1. Separate extension, or Headroom becomes the weather product?
2. Where should it run: AI sites only, or every site?
3. Location: city entry only (simplest, most private) or also "use my location"?
4. Keep the current themes (koi, butterflies, fireflies, snow) as "mood" options next to live weather?
