# Third-party notices

## WebGL Fluid Simulation (the "Fluid" background)

`src/core/fluid-sim.js` is a trimmed port of **WebGL Fluid Simulation** by Pavel Dobryakov
(https://github.com/PavelDoGreat/WebGL-Fluid-Simulation), via the Wallpaper Engine repackaging
(https://github.com/Delivator/WebGL-Fluid-Simulation). It is used under the MIT licence:

```
MIT License

Copyright (c) 2017 Pavel Dobryakov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Changes made here: the control panel, audio reactivity, background-image options, sunrays and
screenshot code were removed; the resolutions and iteration counts were lowered; input comes from
page-level mouse and touch events; the loop pauses in hidden tabs and honours reduced motion.
