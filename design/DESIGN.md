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

## 4. The property inspector (restructure, in progress)
Restructured to follow GeoSonix's object inspector more closely, worked through one band
at a time with Chris and recorded here as we go. The GeoSonix reference inspector (shown
for a Curve object) has these bands, top to bottom: object identity; position & sizes;
colors; Msg Functions; Automessage Interval; Curve Beat Points; Cycle; Notes & Harmony;
plus a status strip. The V2 inspector is its own thing, drawing from both GeoSonix and
GXW; we decide keep/change per band.

LAYOUT & DENSITY: the V2 inspector should be TIGHTLY PACKED, matching the density of the GeoSonix reference inspector — compact rows, minimal padding, several fields per band. For reference, the GeoSonix screenshot measures 816 px wide by 1294 px tall and fits all eight bands plus the status strip in that space. Target a similar panel width (about 816 px) and the same dense row spacing.

LOOK & FEEL (font & colours): match GeoSonix's look closely. Measured from the reference inspector: panel / band background #3e3e3e (with darker band shades around #333333 and #505050), field and input interiors #646464, label text #dcdcdc, header / emphasis text #ffffff. The smaller accents — the green spinner dots and the blue Score-Harmony value text — should be matched from the reference image rather than guessed. Font: GeoSonix's inspector font (a Mac system sans-serif), matched from the reference. The screenshot itself can't be embedded in the repo from here; to match font and accents exactly, the GeoSonix inspector image should be placed in design/reference/ or handed to Claude Code.

### Title bar
Keep GXW's CURRENT inspector title bar as-is — NOT GeoSonix's tabbed Object Properties /
Script / Message Monitor header. [Cross-reference GXW's existing inspector header when
implementing.]

### Shared component — the interval (note-duration) menu
STATUS: IMPLEMENTED (slice 1) — `src/intervalMenu.js` exports INTERVAL_OPTIONS /
INTERVAL_TOKENS / DEFAULT_INTERVAL, consumed via Inspector._buildDropdownField. The
token→duration mapping is still the engine's concern, defined later.

A single reusable popup used wherever an interval / duration is chosen in the inspector
(Time Lag In Object, the Automessage Interval, and more). Defined ONCE and reused.
Values, ordered by length: Off, 384th, 128th, 64th, 32nd, 8th Tr, 16th, Qtr Tr, Dot
16th, 8th, Half Tr, Dot 8th, Qtr, Dot Qtr, Half, Dot Half, Whole, 2 x Wh, 4 x Wh.
("Tr" = triplet, "Dot" = dotted, "Off" = none.)

### Band 1 — object identity (CONFIRMED; two-line band)
STATUS: IMPLEMENTED (slice 1, awaiting Chris's use-validation). Line 1 = Object ID +
State (three-state radio group, unchanged). Line 2 = Object name + Time Lag
In Object (multiplier × shared interval dropdown). Object name REUSES GXW's existing
`name` field but is rendered BLANK and non-editable for now — there is no defined way to
author object names yet, and the legacy `name` holds stale values we don't surface; it
becomes editable and binds to `name` once the authoring semantics are designed. New model
fields `timeLagMultiplier` + `timeLagInterval` on all three kinds (sceneSchema /
scene / sceneEditor setters / main.js dispatch). GXW's old cycle row (Beats/Cycle, Beat
Interval, Speeds) and Strudel Pattern row are REMOVED from Band 1; Beats/Cycle returns in
Band 5, cycle speeds in Band 6. Time Lag behaviour (how the lag delays the object) is
still TBD — model + inspector scaffolding only. Object name capabilities still TBD.

GXW's current second and third identity-band lines are dropped in favour of this
composition, which fits in two lines:
- Object ID — keep, using GXW's Object ID design (not GeoSonix's "locked" style).
- State — GXW's three-state control, labelled active / passive / disabled, replacing
  GeoSonix's two separate Enable and Hide checkboxes.
- Object name — bring in GeoSonix's object-name field (its "Object Label"); GXW has no
  counterpart yet. [Capabilities TO BE DEFINED later.]
- Time Lag In Object — a multiplier field times an interval chosen from the shared
  interval menu above (the "x" reads as "times"); the lag is denominated in that interval.
- Group — dropped, at least for now.

### Band 2 — transform & appearance (CONFIRMED)
Mostly GXW's current band, with these changes (this absorbs GeoSonix's separate size and
colors bands):
- Position — X and Y only; there is NO Z coordinate anywhere in the new app.
- Size — a single field called "Size", merging the old sprite and curve size fields:
  one-dimensional (one value) for sprites and triggers, two-dimensional (width and
  height) for curves. The old separate Trigger Size folds into this.
- Color — a single color; NO separate when-inactive color.
- Variability — kept (the creation-system parameter), moved up onto the line above, to
  the right of the color field.
- Initial Conditions — keep this row EXACTLY as GXW has it now: the "Initial Conditions"
  title, the wide X field, and VX and VY.
- Thickness, cursor sizing, and everything else in this band stay exactly as GXW has
  them now.

### Band 3 — Msg Functions / callbacks (CONFIRMED)
Replaces GeoSonix's two message functions (the collision-driven curveMelody and the
interval-driven curveAutoMessage) with FOUR named procedural callbacks, GXW's own:
hasHit, beenHit, autoMessage, and onTick. Presented as four rows, one per callback, each
with a single button that reads CREATE when that callback does not yet exist (makes it)
or GO TO when it does (opens it for editing) — the GeoSonix Show/Create idea unified
into one contextual button. autoMessage's firing rate is governed by the Automessage
Interval band below. These four callbacks ARE the procedural pattern model (section 3). As in GXW, the callbacks are plain functions in the code tab: CREATE makes the named function, GO TO navigates to it. What commands and context API the callback bodies may call is TO BE DEFINED later; for now the rows plus the create / go-to scaffolding and the named functions are what gets built.

### Band 4 — Automessage Interval (CONFIRMED)
Collapses GeoSonix's three separate interval dropdowns (Cursor, Trigger, Curve) into a
SINGLE field, which IS the shared interval / note-duration dropdown (just the dropdown,
no multiplier). It applies its value to whatever object or objects are currently
selected, and sets the rate of the autoMessage callback. The per-source names (cursor /
trigger / curve) are dropped.

### Band 5 — Beat Points (CONFIRMED; retained, renamed)
Formerly GeoSonix's "Curve Beat Points." Retained almost exactly as in GeoSonix (the
beat-points dropdown, Active Beats, Beat Strength), but renamed to just "Beat Points",
dropping the curve-specificity. Enabled when a curve OR a sprite is selected; NOT
available for triggers. [INVESTIGATE: whether beat points can meaningfully apply to
sprites as well as curves.] The Beat Points mode dropdown offers None, Normal, and Euclidean for now, and is extensible — more modes may be added later.

FIELDS. Beats/Cycle sets the number of beats per cycle (e.g. 32). Active Beats is a compact string where `x` marks an active beat and `.` an inactive one, with `|` separating them into bars, e.g. `x.xx|x.x.|x.x.|xxxx`. Beat Strength is a string of single digits 0 to 9 (NOT space-separated), one per beat, giving each beat's strength, e.g. `6555`. Both the Active-Beats pattern and the Beat-Strength string LOOP: when either reaches its end it restarts from the beginning and keeps applying to successive beats, and the strength advances one digit per beat whether or not that beat is active.

### Band 6 — Cycle (CONFIRMED retained; field behaviour TBD)
Fully retained from GeoSonix (Cycle Speeds, Stop at Cycle, Cursor Speed, Cycle Time,
Time Lock, Trigger Sync To Beat). [TO DEFINE: the actual behaviour of these fields in V2.]

### Remaining bands — TO DO
Notes & Harmony: DEFERRED — left undefined for now. Intended to be some merge of what GeoSonix and GXW each had for harmony; Chris needs to think it through further before it is specified. Status strip: still to do.

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
