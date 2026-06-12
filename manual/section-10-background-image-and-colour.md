# Section 10 — The Background Image & Colour

_Status: outline._

A background image turns the canvas into a field of colour and brightness that your
score can read and turn into sound.

## In this section

- **Loading an image** — adding a background image to a scene; how it fills the canvas.
- **The image as a signal field** — the idea that an image supplies colour and luminance,
  not a picture to look at.
- **The colour reads** — the set of perceptual signals available under a point
  (lightness, chroma, and the colour primaries); reading them in a callback as
  `this.col.*`.
- **Mapping colour to sound** — common patterns: colour to pitch, brightness to loudness,
  colour to duration.
- **Signal stretching / gain** — how GX2 spreads a narrow range of image values into a
  useful musical range so even subtle images are expressive.
- **Brightness reduction** — dimming the displayed image without changing the signal.
- **Determinism** — why the same image and scene always produce the same result.
