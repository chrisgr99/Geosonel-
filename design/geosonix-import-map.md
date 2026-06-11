# GeoSonix → GeoSonixV2 import map

Working notes for importing a legacy GeoSonix `.score` file into our native
score (scene.json objects + script.js). A living document — we add to it as we
review more scores. Decisions below were settled in discussion with Chris.

A GeoSonix `.score` is XML: a `snapShot` of flat `command` lines (CDATA) that
rebuild the score — score-level settings, then each object as `addCurve` /
`addCursor` / `addTrigger` followed by its `set…` commands — plus an attached
`script` of JS lines. Reference command library:
`~/Documents/Geosonix Scores/JavaScriptLibrary.js`. First file analysed:
"Three Simple Beat Curves.score" (3 ellipse curves, each paired with a cursor,
+ a `curveMessage()` function).

Ticks: **GeoSonix is 96 PPQN** (96 ticks = a quarter note, 48 = eighth, 24 =
sixteenth). Ours is 960-based, so map by *musical value*, not raw ticks.

---

## 1. Structural model

GeoSonix splits a **curve** (shape + beat points) from a **cursor** (an object
that traverses the curve and fires its message). We **merge both into one
curve**: our curve carries the shape, the cursor extents (`cursorR`/`cursorL`),
`cycleSpeeds`, the beat points, and the `onActiveBeat` callback.

→ Each GeoSonix **curve + cursor pair becomes one of our curves**. Clean 1:1 in
simple scores. Only awkward if one GeoSonix curve has *several* cursors — then
we'd duplicate the shape into several of our curves. (Not yet encountered.)

---

## 2. Translates directly (or near-directly)

| GeoSonix command | Our field | Notes |
|---|---|---|
| `setActiveBeats <str>` | `curve.activeBeats` | **Identical** x/`.`/`\|` syntax |
| `setBeatEmphasis <digits>` | `curve.strength` | **Identical** — each digit 0–9 is one beat's strength (NOT a 0–100 scalar) |
| `setPointsEllipse w h` + `setPosition x y` | `shape = {type:"ellipse", cx, cy, w, h}` | direct |
| `setPattern <speeds>` (cursor) e.g. `1 -1` | `curve.cycleSpeeds` | **same concept** — per-cycle speed/direction multipliers |
| `setDuration n` (cursor) | cycle length (`beatsPerCycle` × `beatInterval`) | **CONVERSION**: GeoSonix `setDuration` can be **seconds** OR multiples of a note interval. Our cycle length is always musical. If a score gives seconds, convert at the score BPM (`beats = seconds × BPM/60`) and express as the nearest sensible note-interval multiple. |
| `setCursorWidth1 / setCursorWidth2` | `cursorR` / `cursorL` | direct |
| `setBPM n` | `scene.bpm` | direct |
| `setLineThickness n` | `curve.curveThickness` | direct |
| `setActive 0/1`, `setHideObject` | `curve.state` (active/passive/disabled) | direct-ish |
| `setGroup <name>` | `curve.group` | direct |
| `setLabel <name>` | `curve.name` | direct |
| `registerImage background L T R B <path>` + script `setBackground(...)` | `scene.imageName` + embedded bundle image bytes; `canvasW` / `canvasH` | Read the PNG from the absolute path (always present on disk for our imports) and embed it. The rect **is** our canvas size: `canvasW = R−L`, `canvasH = T−B` (here 28 × 20); the image fills the canvas. |

### Beat points — `setBeatPoints` format

`b CYCLE COUNT` (basic) or `e CYCLE COUNT SHIFT REPEATS` (euclidean). Decoded in
`geosonix-vocabulary.md` and confirmed by sampling all scores.

- `b` → our **normal** mode, `e` → our **euclidean** mode.
- `CYCLE` (16/32/64) → `beatsPerCycle`.
- Euclidean `COUNT / SHIFT / REPEATS` → `activeBeatsCount / beatShift / repeats`
  (our model has exactly these).
- Basic-mode `COUNT` → **IGNORE** (purpose unclear / hardly used; the
  `activeBeats` string already defines the active beats).

### Intervals (ticks → token)

- `setBeatInterval <ticks>` → our `beatInterval` token by musical value
  (96→"Qtr", 48→"8th", 24→"16th", …). Build a ticks→token table.

---

## 3. Needs a conversion table (translatable, mechanical)

| GeoSonix | Our side | Conversion |
|---|---|---|
| `setBeatInterval <ticks>` | `beatInterval` token | 96 PPQN musical-value lookup |
| `setColorActive` = theme name (`curve_active`, `cursor_active`) | — | **Ignore** — we have no themes; use OUR default object colour |
| `setColorActive` = explicit custom colour | `color` (hex) | Map per-object (all our colours are per-object). Drop the separate inactive colour (we have one colour + variability) |
| `setTimeShiftMultiplier` | `timeLagMultiplier` | direct number (`0` = off) |
| `setTimeShiftUnitTicks <ticks>` | `timeLagInterval` (note-value token) | Our time lag = a fraction of a beat (interval token, e.g. "8th", "3/32"), NOT raw ticks. Convert ticks → token via the same 96 PPQN table as `setBeatInterval`. Same concept: per-object timing offset = multiplier × interval. |
| `setLine 65535 1` (cursor) | `cursorThickness` / cursor colour | **open** (decode the format) |

---

## 4. Drop / ignore (decided)

| GeoSonix | Reason |
|---|---|
| `setMidiChannel` | Dropping MIDI channels — assume superdough sounds or a single MIDI out |
| `setMidiNote` (fixed note) | Never used in practice; notes always come from the callback |
| `setAutoBeatInterval` | **REVISED — no longer dropped.** Fixed-interval auto-message is synthesised via `onTick` + a library helper (see §5). Only truly ignored when 0 (beat-point firing instead). |
| basic-mode `COUNT` in `setBeatPoints b …` | Purpose unclear, hardly used |
| harmony **settings**: `setScore{ScaleName,ChordName,Root,MapNotesTo}`, `setObject*` harmony | A new harmony system based on the **TONAL** library is planned — don't map the scale/chord/mapNotesTo settings. The script's `mapChord`/`mapScale` *calls* are NOT dropped (§5). EXCEPTIONS now USED by that placeholder: `setScoreRange` / `setScoreRangeLow` set its note range, and `setScoreTonic` roots its minor-pentatonic scale. |
| `zoom` / `center` / `rotate` | View state, not score content |
| `setLine <dashStyle> <dashPattern>` | Line dash/stipple style. We draw all lines **solid** (no dashed-line styling); `65535` = solid = our default anyway. |
| `setTimeSig 4/4` | Ignored for now — our rhythm is per-object (beatInterval token + beatsPerCycle), no score-wide bar grid. Revisit if we add a global time signature feature. |

---

## 5. Script translation (the hard part — mostly OPEN)

**Decision: we DO import/translate the script.** Our object model absorbs the
properties, but the attached script uses a GeoSonix script API we don't have.
The firing model maps conceptually (a cursor's auto-message fired on each active
beat ↔ our `onActiveBeat` callback), but the API surface differs. Items still to
work through:

- **`mapChord` / `mapScale` placeholder (DECIDED):** linear-map the value from
  `[lo, hi]` into the score's **note range** (`rangeLow` .. `rangeLow + range`,
  from `setScoreRangeLow` / `setScoreRange`), then snap to the nearest note of a
  **minor pentatonic** scale (generally sounds pleasant), rooted at the score
  tonic (`setScoreTonic`; default if absent). Return the integer MIDI note. This
  replaces GeoSonix's real chord/scale mapping with a fixed pleasant default so
  the imported score sounds musical BEFORE the TONAL harmony system lands; swap
  in the real mapping when TONAL is ready.

- **`midi.note(port, channel, note, vel, dur)` → `playNote(note, vel, dur/1000)`
  (CONFIRMED).** Our `playNote(note, vel?, dur?, pan?)` was deliberately
  GeoSonix-shaped. Mapping: drop `port` + `channel`; `note` → `note` (MIDI
  number, direct); `vel` → `vel` **direct, both 0..1** (the argument is a
  normalised 0..1 scale, NOT a 0–127 byte); `dur` **milliseconds → seconds**
  (÷1000). Implement as a `midi` shim object in the imported script's scope whose
  `.note(...)` does exactly this, so scripts call `midi.note(...)` unchanged.
- **Callback signal surface — DECISION (Chris, supersedes "match GeoSonix names
  natively"): do NOT re-implement GeoSonix property names on our callback
  context. KEEP OUR names; the IMPORTER rewrites the script's GeoSonix names →
  our names via a translation table.** This avoids collisions — e.g. our
  `this.beat` already = **elapsed beats** (`simTime*bpm/60`), whereas GeoSonix
  `this.beat` = **beat strength**. We still IMPLEMENT the missing *capabilities*
  (positions, object colour) — but under OUR own names, not GeoSonix's.
  Colours use OUR colour space (OKLCh-derived).

  Translation table (GeoSonix in-script name → our app property):

  | GeoSonix (in script) | Our property | Status |
  |---|---|---|
  | `this.beat` (strength 0..1) | `this.beatStrength` | exists |
  | `this.beatNumber` | `this.beatIndex` | exists |
  | `this.nBeats` | `this.beatCount` | exists |
  | `this.cursor.r/g/b` (image colour under cursor) | `this.col.<channel>` (our space) | exists — pick channels |
  | `this.r/g/b` (object's OWN colour) | NEW — our name TBD | **IMPLEMENT** |
  | `this.cursor.x/y` (firing-point position) | NEW — our name TBD | **IMPLEMENT** |
  | `this.x/y` (object-centre position) | NEW — our name TBD | **IMPLEMENT** |
  | `this.angle` / `this.cursor.angle` | — | DEFERRED (not used in this score) |
  | `this.note` (fixed note) | — (dropped) | rewrite away → falls to callback note logic |
  | `this.port` / `this.channel` | — (dropped) | remove from call |

  Same principle for the rest of the GeoSonix script API — rewrite names to ours,
  don't reproduce GeoSonix's: `midi.note(...)` → `playNote(...)` (drop
  port/channel, ms→s), `_score` → `score`, `mapChord`/`mapScale` → our
  placeholder fn.
- **`_score.hasBackgroundImage` → `score.hasBackgroundImage` (DECIDED).** Add a
  new boolean property on our score object, true when a background image is
  defined. Expose the score object so GeoSonix's `_score.*` resolves (alias
  `_score` → our `score` global), matching GeoSonix's score property surface.
  Other `_score.*` properties: build out as more scores surface them.
- **Auto-message firing → our callbacks (CONFIRMED with Chris):**
  - **Beat-point auto-message** — cursor fires on each *active beat point*
    (`setAutoBeatInterval` = 0, as in the sample score) → our **`onActiveBeat`**
    callback (`canActiveBeat = true` + `onActiveBeatFunction = <fn>`). Direct; we
    already fire on active beat points.
  - **Fixed-interval auto-message** — `setAutoBeatInterval > 0`, message every N
    ticks regardless of geometry → our **`onTick`** callback plus a **library
    helper** that accumulates **musical** time (beats, so it follows BPM changes)
    and fires the event every interval (interval ticks → note token, 96 PPQN).
    Put the helper in our library so any imported auto-interval becomes
    `onTick` + "fire every N".
  - **Function-name binding**: `setAutoMessageName X` binds the chosen callback to
    script function `X`. Defaults are `cursorAutoMessage` (cursors) /
    `triggerAutoMessage` (triggers); when the named function isn't defined in the
    script (the sample score defines only `curveMessage`), fall back to the
    relevant user-defined message function. Confirm the exact fallback rule when
    it next matters.

Likely approach (TBD): a GeoSonix-compat shim exposing the script API on top of
our model, rather than rewriting each script.

---

## 6. Open questions / TODO (next discussions)

- [x] Cursor → firing-function binding — DONE: beat-point → `onActiveBeat`;
      fixed-interval → `onTick` + library musical-time helper (§5).
- [x] Colour reads in scripts — DONE: substitute our colour-space equivalent (§5).
- [x] `midi.note(…)` → `playNote(note, vel, dur/1000)` — DONE (shim; vel 0..1
      direct; ms→s).
- [x] Callback signal NAMES/mappings decided — expose full GeoSonix `this` /
      `this.cursor` surface natively (§5). (Build task: add position, object
      colour, angle, GeoSonix-named aliases.)
- [x] `_score.hasBackgroundImage` → new `score.hasBackgroundImage` boolean;
      alias `_score` → `score` (§5). (Build task.)
- [x] `mapChord` / `mapScale` placeholder DECIDED — map into the score's note
      range, snap to minor pentatonic (rooted at score tonic) until TONAL (§5).
      (Build task.)
- [ ] Triggers (`addTrigger`) and sprites — not in the first score; map when we hit one
- [ ] Build the `onTick` musical-interval auto-message helper in our library

---

## Status

**"Three Simple Beat Curves" is fully reviewed — every command AND every script
construct now has a decided mapping.** What remains is implementation, not
design decisions:

Build tasks (the importer + a GeoSonix-compat runtime shim):
- Object/geometry/rhythm converter (commands → scene.json), incl. curve+cursor
  merge, ticks→token tables, seconds→beats duration, background image → canvas.
- `midi` shim (`midi.note` → `playNote`).
- ~~`onTick` musical-interval auto-message helper~~ DONE: native `onBeatInterval(interval)`
  library fn (token / "1/8" fraction / number of beats) + a wired curve `onTick`
  dispatch path. Import translates a fixed-interval auto-message to
  `onTick { if (onBeatInterval(token)) { … } }`.
- Add the missing callback-context CAPABILITIES under OUR names: firing-point
  position, object-centre position, object's own colour (angle deferred). The
  importer's translation table maps GeoSonix names → these (§5).
- `score.hasBackgroundImage` + `_score` alias.
- `mapChord` / `mapScale` placeholder (note-range + minor-pentatonic snap).

Deferred / future:
- TONAL harmony system replaces the `mapChord`/`mapScale` placeholder.
- Triggers (`addTrigger`) and sprites — none in this score; map when a score uses
  them.

Recommended first build: the object-only importer (no script execution) as the
sanity check, then layer the runtime shim on top.
