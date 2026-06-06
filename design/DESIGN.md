# GeosonixV2 — Design (skeleton, in progress)

STATUS: New design document for the GeosonixV2 direction. This is a DRAFT SKELETON —
most sections are outlines to be filled in with Chris over coming sessions. The
previous Strudel-based design is archived alongside this folder at `design-strudel/`,
and the full working Strudel codebase is preserved on the `seed-variation` branch, the
`strudel-baseline` tag, and the `../GXW-strudel` worktree, all available to read from.

How we build this document: Chris designs by talking it through; Claude captures it
here in clean prose he can have read back. The paradigm-neutral parts (sections 2 and
5–8 below) are re-derived from the archived design since they survive the pivot. The
procedural pattern model (section 3) and the inspector restructure (section 4) are
written fresh and are the heart of the work.

## 1. Vision & goals
GeosonixV2 is the procedural successor to GeoSonix, carrying forward the geometric,
image-driven music engine of GXW (GeoSonel) but replacing Strudel's declarative
pattern language with a fully PROCEDURAL pattern model in the GeoSonix spirit, combined
with the creation and mutation system developed in GXW. Primary driver: the app must be
expressible and navigable for Chris, who has limited eyesight and works by dictation —
a procedural model he is fluent in and can read is the foundation, where Strudel's dense
mini-notation was not.
[TODO: expand — concrete goals and non-goals; the GeoSonix + GXW-creation-system synthesis.]

## 2. What carries over from GXW (paradigm-neutral)
Re-derive from the archived design. Keep: the canvas and geometric objects (curves,
sprites, triggers); image and pixel signals; sprite kinematics; collision callbacks
(hasHit / beenHit); audio output (superdough plus the GeoSonel virtual MIDI port); the
save and session system; the UI shell; and the creation / mutation + audition system.
[TODO: re-state each, noting any changes the procedural model implies.]

## 3. The procedural pattern model   ← CENTERPIECE, to design
How a pattern is expressed, and how notes and events are produced, the procedural way —
GeoSonix-style imperative generation — replacing mini-notation and the two-pass firing
engine. The procedural engine produces events directly, so the two-pass query goes away
and the engine should become substantially simpler.

EMERGING MODEL (from the Msg Functions band of the inspector): patterns are expressed as
named procedural CALLBACKS on each object — hasHit and beenHit (collision), autoMessage
(fires at the object's Automessage Interval), and onTick (per tick) — which generate
notes and events imperatively, via ctx.playNote / ctx.playSound. This is GXW's existing
procedural spine (behaviours.js onTick, the collision callbacks, playNote/playSound),
promoted to the primary authoring model.
[TODO: the authoring surface for writing these callbacks; the context/API available
inside them; how the harmony layer maps their output; the enhancements Chris has in mind.]

### Reference example: the GeoSonix code tab (the target authoring model)
GeoSonix's code tab could define an ENTIRE scene procedurally, and we want the same kind
of thing. A representative script (pasted by Chris) builds 200 ellipse-arranged curves —
each with a cursor and a trigger — then defines a per-firing message function:

```
var nLines = 200;
clear();
rotate();
center(0, 0);
zoom(75);
rewind();
setBPM(80);
setChord(chmin7);
//Ellipse curves
var circleRadius  = -8;
var triggerCircle = 9;
for(var lineIndex = 0;  lineIndex < nLines;  lineIndex++) {
    var angle = map(lineIndex, 0, nLines, 0, TWO_PI);
    addLine(lineIndex, 
        {x: lineIndex/nLines * 10,  y: circleRadius  * sin(angle)},
        {x: triggerCircle * cos(angle),  y: triggerCircle * sin(angle)});
}
setColor("lines", 50, 150, 91, 255);
setColor("cursors", 55,  99,  190, 200);
setColor("triggers", 230,  40,  160, 200);
setLineThickness("lines",1);
setLineThickness("cursors",3);
clearSelection();
//Custom function
function addLine(lineIndex, start, end) {
    id=addCurve(1000 + lineIndex);
    setGroup("lines");
    setPointAt(0, start.x, start.y);
    setPointAt(1, end.x, end.y);
    var id = addCursor(lineIndex);
    setGroup("cursors");
    setCurve();
    setCursorWidth(id, .2+.2* lineIndex / nLines,0);
    setPattern("3 -6 3 -6");
    setSpeed(0.2 + lineIndex / (nLines*50));
    addTrigger(2000 + lineIndex,end.x, end.y);
    setGroup(2000 + lineIndex,"triggers");
}
function triggerMessage() {
    if (_score.hasBackgroundImage) {
        note = this.note?this.note:mapHarmony(this.cursor.r,0,1);
        vel = map(this.cursor.g,0,1,60,90);
    } else {
        note = this.note?this.note:mapHarmony(this.cursor.angle,0,359);
        vel = map(this.cursor.x,-triggerCircle,triggerCircle,100,50);
    }
    dur = map(this.b,0,1,500,2500);
    midi.note(this.port,this.channel,note,vel,dur,100)
}
```

It shows TWO API surfaces sharing one code tab:
- Scene construction, run once: global setup (clear, center, zoom, rewind, setBPM,
  setChord); object creation via a stateful CURRENT-OBJECT builder (addCurve / addCursor /
  addTrigger create and select an object; setGroup / setPointAt / setPattern / setSpeed /
  setCursorWidth then act on the current object); group styling (setColor / setLineThickness
  by group name); and math helpers (map, sin, cos, TWO_PI) — all plain JS with vars, loops,
  and user functions like addLine.
- The message-function / callback surface, run per firing event (triggerMessage): a `this`
  firing context — this.cursor.r / .g / .angle / .x, this.note, this.b (beat position),
  this.port, this.channel, plus _score.hasBackgroundImage — with mapHarmony mapping a
  continuous value to a pitch against the current chord, and note output (GeoSonix
  midi.note, which becomes our playNote).

Notable for the GeosonixV2 design: GeoSonix patterns were simple scale-degree sequences
("3 -6 3 -6"), and pitches were often derived by mapHarmony from a continuous value rather
than spelled out — so the harmony layer (Tonal) plus scale-degree mapping is central, and
the deterministic Strudel evaluator is a complement to it, not the main path. And a code
surface builds the scene itself, not just per-object behaviour.

OPEN QUESTION (where the design paused, 2026-06-06): should procedural scene-construction
code build the SAME scene the canvas renders and the inspector edits — code and inspector
as two views of one scene — and should the engine design cover the scene-construction API
alongside the callbacks now, or do the callback API first with construction as a parallel
track? Also on the table: inventory Chris's GeoSonix scores in ~/Documents/Geosonix Scores
for the full command vocabulary before drafting the API.

## 4. The property inspector (as built)
The inspector was restructured band by band with Chris to follow GeoSonix's object
inspector more closely while remaining its own thing. This section describes the
inspector AS BUILT — the code is the source of truth (`src/inspector.js` and its
prototype-mixin modules `inspectorBandsObject.js`, `inspectorBandsExtra.js`,
`inspectorFields.js`, plus `inspectorSelection.js`, `inspectorShared.js`,
`inspectorWidgets.js`, and the helpers `intervalMenu.js` and `euclidean.js`). Where the
as-built inspector diverged from the earlier GeoSonix sketch, the as-built version is
what is recorded here.

RENDER ORDER (top to bottom, from `_render`): Title bar, Identity, Transform &
appearance, Msg Functions (callbacks + the Automessage Interval, merged into this one
band — there is NO separate Automessage band), Beat Points, Cycle, then a separator, the
reserved middle area, a heavy separator, and the global band.

The form always renders, even with nothing selected: every band shows with its fields
greyed and the title bar reads "No selection". Fields grey PER SELECTION — a control that
doesn't apply to the selected kind(s) greys in place rather than disappearing, so the
layout stays stable.

### Title bar
GXW's existing inspector title bar, kept as-is — NOT GeoSonix's tabbed Object Properties
/ Script / Message Monitor header. Single-select shows the kind plus the object's id
(e.g. "Curve CRV2"); multi-select shows a count summary; empty shows "No selection".

### Shared component — the interval (note-duration) menu
`src/intervalMenu.js` exports the single reusable interval / note-duration menu
(`INTERVAL_OPTIONS`, `INTERVAL_TOKENS`, `DEFAULT_INTERVAL`), consumed through
`Inspector._buildDropdownField`. Nineteen tokens ordered by length: Off, 384th, 128th,
64th, 32nd, 8th Tr, 16th, Qtr Tr, Dot 16th, 8th, Half Tr, Dot 8th, Qtr, Dot Qtr, Half,
Dot Half, Whole, 2 × Wh, 4 × Wh ("Tr" = triplet, "Dot" = dotted, "Off" = none). Used by
Time Lag (Identity), the Automessage Interval (Msg Functions), and Trigger Sync To Beat
(Cycle). The token→duration mapping is the engine's concern, defined later.

### Identity band
Two lines:
- Line 1: Object ID (read-only / "locked" on single-select, blank-greyed on multi) +
  State — a three-state radio group, Active / No Cursor / Disable (model values active /
  passive / disabled). Curves and sprites offer all three; triggers offer Active / Disable
  only (no cursor).
- Line 2: Object Name + Time Lag. Object Name reuses GXW's `name` field but is rendered
  BLANK and non-editable for now — there is no defined way to author names yet, so it is a
  placeholder until the authoring semantics are designed. Time Lag is a multiplier field ×
  an interval from the shared menu (the "×" reads "times"); fields `timeLagMultiplier` +
  `timeLagInterval`. Time Lag's behaviour is still TBD (model + UI scaffolding).

Dropped here vs GeoSonix / old GXW: the Enable/Hide checkboxes (replaced by State), Group,
and GXW's old cycle row + Strudel pattern row (cycle controls now live in the Beat Points
and Cycle bands).

### Transform & appearance band
Rows:
- Initial Conditions: X, Y, vX, vY — the starting position and velocity. vX/vY apply to
  curves and sprites and grey for triggers.
- Dimension: one merged size row. Curves show Length + Width (bbox dimensions) + Line Width
  (curve thickness); a sprite-only or trigger-only selection shows a single Size value
  (sprite displayDiameter / trigger size). Merges the old separate Curve Size and
  Sprite/Trigger Size rows.
- Cursor: Cursor Length (the R and L extents) + Cursor Width (cursor thickness); applies to
  curves and sprites.
- Color + Variability on one row: a single colour (no separate when-inactive colour) with
  the seed-variation dial to its right.

There is NO Z coordinate anywhere. Label renames from GeoSonix/GXW: Length / Width (not
"Curve Size (W, H)"), Line Width (curve thickness), Cursor Length / Cursor Width.

### Msg Functions band (callbacks + Automessage Interval)
The four named procedural callbacks — hasHit, beenHit, onTick, autoMessage — replace
GeoSonix's two message functions (curveMelody / curveAutoMessage). Each callback is a row
with a Can-X checkbox (canHit / canBeHit / canTick / canAutoMessage), a function-name
field, and ONE contextual button: CREATE when the named function doesn't exist yet
(scaffolds e.g. `autoMessage_<id>` in behaviors.js) or GO TO when it does (navigates to
it). Fields: hasHitFunction / beenHitFunction / onTickFunction / autoMessageFunction.

The Automessage Interval dropdown lives in THIS band (the formerly separate Automessage
band is merged in, with no dividing line), rendered ABOVE the autoMessage callback —
because the interval (the fire rate) must be defined for the autoMessage callback to have
meaning. It is the shared interval dropdown (field `autoMessageInterval`, default "Off"),
its control aligned with the callback rows' function-field column. So the band reads, top
to bottom: hasHit, beenHit, onTick, Automessage Interval, autoMessage.

These four callbacks ARE the procedural pattern model (section 3): plain functions in
behaviors.js. The ctx/API available inside the callback bodies is still TO BE DEFINED.

### Beat Points band
Available for curves OR sprites (greyed for triggers / empty). A mode dropdown — None /
Normal / Euclidean, extensible — drives what is shown:
- None: just the mode dropdown.
- Normal: Beats/Cycle + Beats/Bar; then the Active Beats pattern string and the Beat
  Strength string.
- Euclidean: Beats/Cycle + Beat Interval + Beats/Bar; an indented Active Beats COUNT (k,
  aligned under Beats/Cycle) + Beat Shift + Repeats; then the generated Active Beats pattern
  (LOCKED, read-only) and the Beat Strength string.

Active Beats and Beat Strength use a custom LIVE-INPUT field (`_buildBeatStringField`) —
one character per keystroke: in Active Beats, "." or SPACE enters a dot and any other key
enters a lowercase "x"; in Beat Strength, only 0–9 or a dot/space are accepted. Bar "|"
separators are managed live per Beats/Bar — no bars are drawn when Beats/Bar is 1 (the
field is just the bare string). Both strings loop.

Euclidean is a STARTER: changing a Euclidean parameter (Active Beats count, Beat Shift,
Repeats, Beats/Cycle — or switching INTO Euclidean) REGENERATES the pattern via
`src/euclidean.js` `generateEuclideanPattern(cycleDuration, count, shift, repeats)`; in
Normal mode the typed pattern is preserved and only re-barred. In Euclidean the generated
pattern field is LOCKED read-only (it is derived from the parameters) but shown
full-contrast for reference; Beat Strength stays editable in both modes.

New curve/sprite defaults: Beats/Cycle 16, Beats/Bar 1, Active Beats "x", Beat Strength
"9". Fields: beatPointsMode (default "none"), activeBeats, strength, beatsPerBar,
activeBeatsCount, beatShift, repeats.

### Cycle band
Reworked from GeoSonix; Cursor Speed, Cycle Time and Time Lock are dropped. Two lines:
- Line 1 (curves & sprites; greyed for triggers/empty): Cycle Speeds (a short string field)
  + Start at Cycle (default 0 — the cycle the object begins on) + Stop at Cycle (default
  -1 — never stop). Fields: cycleSpeeds, startAtCycle, stopAtCycle (start/stop on curves
  and sprites).
- Line 2 (triggers; greyed otherwise): Trigger Sync To Beat — the shared interval dropdown
  (field `triggerSyncToBeat`, default "Off").

The behaviour of these fields in the engine (how start / stop / sync drive playback) is
still TBD — model + inspector scaffolding for now.

### Below the separators — reserved middle area + global band
These are the carried-over GXW multi-engine audio bands, untouched by the restructure. The
reserved middle area holds per-object voice controls (under superdough: Note Voice + Sound
Bank dropdowns; empty under MIDI); the global band carries the always-visible Sound Engine
dropdown that the audio surfaces reshape around. This region is the intended future home of
the deferred Notes & Harmony work.

### Look & feel (as built)
Matched to the GeoSonix reference, with colours sampled exactly from Chris's screen-capture
crops: inspector background #3e3e3e (set on `#inspector-area` in `css/layout.css`), field
fill #646464, field borders 2px mint #789678, white value text, and dense rows (compact
band padding, tight row spacing). Styles live in `css/inspector.css` (the loaded
stylesheet) plus the inspector-area background in `css/layout.css`. NOTE: `main.css` is NOT
loaded by index.html and must NOT be edited for inspector styling — a duplicate set of
inspector rules there is dead.

### Model fields added across kinds (for the inspector)
Defined in `sceneSchema.js`, constructed in `scene.js`, written by `sceneEditor.js`
setters, and dispatched in `main.js`: timeLagMultiplier, timeLagInterval,
autoMessageInterval, canAutoMessage, autoMessageFunction, beatPointsMode, activeBeats,
strength, beatsPerBar, activeBeatsCount, beatShift, repeats, startAtCycle, stopAtCycle,
triggerSyncToBeat. (Reused existing fields include name, state, cycleSpeeds, stopAtCycle on
curves, the callback Can-X gates and function refs, and beatsPerCycle / beatInterval.)
CAVEAT for future field work: `stripObsoleteFields` in sceneEditor.js deletes a denylist of
pivot-retired field names on every reload — when reviving any old field name, remove it
from that list first (this bit the beat-points fields once).

### Still to do
Notes & Harmony: DEFERRED — intended to be some merge of what GeoSonix and GXW each had for
harmony; Chris needs to think it through further before it is specified. Status strip:
still to do.

## 5. Creation & audition system (kept, folded in)
The seed-driven mutation, the audition workflow (Mutate / Loop, the beats field, the
clean one-shot stop) and the seam guard, carried over from GXW and adapted to the
procedural model.
[TODO.]

## 6. Audio & output
superdough and the GeoSonel virtual MIDI port, and how procedural events reach each.
[TODO — note: events are generated directly, with no two-pass refresh step.]

## 7. Canvas, objects, signals, motion, collisions
Curves, sprites and triggers; image-derived signals; kinematics; collisions — the
geometric heart, largely unchanged.
[TODO.]

## 8. Save / session & UI shell
[TODO.]

## 9. Removed with the pivot (reference)
The Strudel mini-notation language; the two-pass firing engine; the Code-tab Strudel
tooling (autocomplete, Ctrl-hover tooltips, and the shelved readability work); the
composition mirror; mapClip feeding mini-notation.

## 10. Engine migration map (step-1 triage)
The keep / change / remove decision per file and subsystem, worked through with Chris
before designing the engine. The new engine IS the procedural-fire and output spine of
the old firing engine, driven by the simulation and the callbacks; the Strudel pattern
machinery is removed; Strudel survives only as an on-demand deterministic evaluator
reached from procedural code.

KEEP (the spine, largely as-is): runtime.js (superdough sound output); midiSender.js
(MIDI to the GeoSonel port); simulation.js (cursors, cycles, cycleProgress — the local
clock that positions firing); transport.js and transportBar.js (master clock, BPM, play
state); canvasCollision.js (collision detection feeding hasHit / beenHit); behaviors.js
(the procedural callback bodies — the authoring home); auditionBar.js and the seed/ folder
(mutation and audition); oklch.js (colour conversion behind the pixel reads). From
firingEngine.js, keep the procedural-fire and output spine: fireImmediateNote /
fireImmediateSound / fireImmediateValue, the superdough-versus-MIDI dispatch with its
output-mode switch and MIDI panic, applyVoiceInjection / applyVoiceEnvelope and the
VOICE_ENVELOPES table, the seam guard (setSeamBoundary), the firing-event flash signal,
and lazy sample loading.

CHANGE (kept but reframed): patternParse.js is kept ONLY as the on-demand deterministic
pattern evaluator — compile a pattern string and query one cycle into events, called
procedurally; never a live engine. signals.js reduces to the procedural colour reads:
keep imageSignalsFromOKLCh (the OKLCh-to-ten-values colour math) feeding the callback
context's pixel reads (ctx.pxLt, ctx.pxR, and so on), and keep mapClip as a plain numeric
clamp-and-remap helper. firingEngine.js reduces to the spine above with the pattern
machinery removed. debugTap.js becomes a plain variadic print(...) that writes its
arguments to the message area, space-separated, no labels. The Code tab loses its
Strudel-language tooling but keeps the editor and the accessibility aids (parenthesis
highlighting, speak-on-hover) repurposed for JavaScript, and its autocomplete is swapped
to JavaScript completion — keywords, in-scope variables and functions, and the GXW
procedural API (playNote, playSound, the colour reads, print).

REMOVE: from firingEngine.js, the two-pass pattern engine — compile-to-Strudel-pattern and
query scheduling, Pass 1 populate and Pass 2 refresh, the one-cycle-ahead scheduling, the
per-source dirty-flag and cycle bookkeeping, and the per-tick snapshot capture for dynamic
signals. firingContext.js (the live Pass-2 context pointer). The Strudel signal patterns
in signals.js — the px* signal() wrappers, installImageSignals and its window globals, the
getFiringContext dependency, and mapClip's Strudel-Pattern form. diskMirror.js and
mirrorPush.js (the composition mirror). The strudel/codemirror Strudel tooling —
mini-notation autocomplete, the Control-hover Strudel documentation tooltips, and the
Strudel-pattern syntax highlighting.

STILL TBD (for the section-3 engine design): how a pattern's playback rate is set (the
object's local cursor clock, locked to the global BPM, is the likely default, with the
global clock available); how cross-cycle pattern modifiers pick their cycle index when a
static pattern repeats; the precise procedural shape of the on-demand pattern call; and
what becomes of the cursor-target highlight and the old labelled-block model
(cursorTargets.js / patternHighlight.js) now that pattern authoring is procedural. Also a
cleanup detail: reconcile the two runtime files (src/strudelRuntime.js versus
src/strudel/runtime.js) during the build.
