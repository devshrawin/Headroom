# Prompt: Headroom logo

Paste into an image or logo generator (Gemini, Midjourney, Ideogram, Recraft) or give to a designer.

```
Design an app icon / logo mark for "Headroom", a Chrome extension that shows how much of your AI chat usage limit is left (Claude, ChatGPT, Gemini and others) as a small meter on the page. A cat mascot called Iris (white, fluffy, calm face) sits on top of the meter.

Concept: "headroom" is the space left above you before you hit the ceiling. Combine a usage gauge with a cat's head. Idea to explore: a thick gauge ring or arc that is partly filled, with two cat ears on top. The unfilled part of the ring is the headroom. Also try one alternative with Iris's face peeking over a gauge arc.

Style: flat, modern, friendly, confident. Simple geometric shapes, rounded ends, no outlines, no tiny detail, no text inside the mark. One strong silhouette that still reads at 16 x 16 pixels.

Colour: deep violet to indigo gradient tile (#7b5ce6 to #4527a8), white and soft lavender (#d9ceff) for the mark. Optional small accent in status green #16794a. Nothing else.

Deliver: a square 1024 x 1024 icon on a rounded-square tile (corner radius about 24%), plus the mark alone on transparent background, plus a one-colour (white on violet) version. Clean vector look, centred, generous padding, plain white background around the tile.

Avoid: realistic cat photos, whiskers or eyes that become noise at small size, speedometer clichés with a red needle, gradients with many colours, any brand logos of AI companies, any text.
```

Also ask for: a horizontal lockup (mark + the word "Headroom" in a rounded geometric sans, semi-bold) for the store marquee.

How to use the result: save the square PNG as `icons/icon128.png`, or give me the SVG and I will drop it into `assets/headroom-logo.svg` and run `node scripts/make-icons.mjs`, which writes the 16, 32, 48 and 128 px icons.
