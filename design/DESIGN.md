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
(hasCollided / beenTriggered); audio output (superdough plus the GeoSonel virtual MIDI port); the
save and session system; the UI shell; and the creation / mutation + audition system.
[TODO: re-state each, noting any changes the procedural model implies.]

## 3. The procedural pattern model   ← CENTERPIECE, to design
How a pattern is expressed, and how notes and events are produced, the procedural way —
GeoSonix-style imperative generation — replacing mini-notation and the two-pass firing
engine. The procedural engine produces events directly, so the two-pass query goes away
and the engine should become substantially simpler.

EMERGING MODEL (from the Msg Functions band of the inspector): patterns are expressed as
named procedural CALLBACKS on each object — hasCollided and beenTriggered (collision)
and onTick (per tick) — which generate
notes and events imperatively, via ctx.playNote / ctx.playSound. This is GXW's existing
procedural spine (script.js onTick, the collision callbacks, playNote/playSound),
promoted to the primary authoring model.
[TODO: the authoring surface for writing these callbacks; the context/API available
inside them; how the harmony layer maps their output; the enhancements Chris has in mind.]

### Reference example: the GeoSonix script tab (the target authoring model)
GeoSonix's script tab could define an ENTIRE scene procedurally, and we want the same kind
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

It shows TWO API surfaces sharing one script tab:
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

RESOLVED (2026-06-06): one scene, two views — confirmed. Construction code builds the same
scene the canvas renders and the inspector edits, and the engine design folds in the
construction surface alongside the callbacks. The substrate subsection below is the answer:
it designs the one set of scene operations both surfaces sit on, so the construction API and
the callbacks fall out of it rather than being reconciled later. The firing FLOW itself
(simulation tick to callback to scheduled note to superdough or MIDI) is the NEXT design
stage and is not specified here.

### The shared substrate (the engine foundation)

This subsection designs the substrate the whole GeosonixV2 engine sits on. The substrate is
one set of scene operations plus the two live handles that read and drive them. Construction
code, the per-object callbacks, the inspector, the canvas tools, and the save format are all
views onto this one set. Designing it first means the construction API and the callback API
are the same vocabulary in two skins, the way GeoSonix's whole functional library turned out
to be thin sugar over a single command layer that was also its save format.

The guiding precedent is GeoSonix's `_obj` / `_o` object handle and its `_score` score
handle, reconciled in design/geosonix-vocabulary.md against the GeoSonix standard library.
GXW already has most of the pieces; the substrate mostly NAMES and CONSOLIDATES what exists
rather than inventing a parallel mechanism. Where GXW already provides something, the design
says so and proposes how it folds in.

#### Where GXW keeps the scene today (the three current representations)

The scene currently lives in three forms, and the substrate's job is to put one coherent
handle over them. First, the SAVE form: scene.json, a plain JSON object with curves,
triggers, and sprites arrays whose entries carry the schema fields (sceneSchema.js defines
the fields per kind). This is what the inspector edits and what the save format serializes.
Second, the LIVE form: the Scene object built by sceneLoader.js, holding Curve, Trigger, and
Sprite instances (scene.js) plus a functionMap of the callback functions parsed out of
script.js. This is what the simulation reads. Third, the per-fire CONTEXT: the ctx object
the simulation builds fresh for each callback invocation (simulation.js), a read-only
snapshot of one object's state at firing time plus the emitters playNote, playSound, and
applyForce.

Today these are separate. The inspector mutates the JSON form through sceneEditor.js setters,
then a Run Scene rebuilds the live Scene from the JSON. Callbacks see only the frozen ctx
snapshot, never a writable handle. The substrate unifies them: ONE object handle, addressed
by id, that both construction code and callbacks use, whose reads come from the live object
and whose writes route through the same operation set the inspector already drives.

#### 1. The object handle

The object handle is a live reference to one curve, cursor, or trigger, obtained by id, whose
properties read and write through to the scene. GeoSonix's `_obj(id)` (short form `_o(id)`)
is the model: `_o(150).y = 4` moves object 150, `_o(8).nBeats` reads its beat count. The
GeosonixV2 handle presents the object's schema fields as named properties, so reading and
writing an object in code is the same vocabulary as reading and writing it in the inspector.

The READABLE and WRITABLE properties are grounded in the actual sceneSchema fields, not
invented. Identity and state: id (read only), kind (read only), name, state (active, passive,
or disabled — the inspector's Active / No Cursor / Disable). Position and motion: x, y, vx,
vy (the Transform band's Initial Conditions). Geometry: for a curve the shape and its derived
Length, Width, and Line Width; for a sprite its Size (displayDiameter); for a trigger its
Size. Cursor: cursorL, cursorR, cursorThickness. Appearance: color and its Variability. Beat
points: beatPointsMode, beatsPerCycle, activeBeats, strength, beatsPerBar, and the Euclidean
parameters activeBeatsCount, beatShift, repeats. Cycle: cycleSpeeds, startAtCycle,
stopAtCycle, and a trigger's triggerSyncToBeat. Timing: timeLagMultiplier, timeLagInterval.
Callback bindings: the Can-X gates canActiveBeat, canCollide, canBeTriggered, canTick
and the function-name fields onActiveBeatFunction, hasCollidedFunction, beenTriggeredFunction,
onTickFunction.

Beyond the stored fields, the handle exposes DERIVED reads that a callback needs and that the
current ctx already computes. The live motion and clock reads: speed, the cycle phase
(cycleProgress) and cycle count, flipX and flipY. The colour-under-the-object reads: the ten
px values (pxLt, pxChr, pxR, pxG, pxY, pxB, pxOr, pxLi, pxCy, pxPu) that imageSignalsFromOKLCh
derives from the image pixel beneath the object — these are the r, g, b reads GeoSonix's
firing context exposed, in GXW's richer ten-channel form. These derived reads are read only;
they reflect simulation state and cannot be assigned.

The firing context `this` in GeoSonix is the same handle seen from inside a message function,
with extra per-firing fields (this.beat, this.firstMessage, this.cursor and its colour and
position). In GeosonixV2 the per-object callback receives the handle as its context, so
this.x, this.pxR, this.cyclePhase and so on are exactly the object-handle reads, and the
cursor-side reads attach as a nested cursor view on a curve's handle. The point is that the
handle a callback reads and the handle construction code writes are ONE type, so there is no
second vocabulary to learn or to keep in sync.

WRITE SEMANTICS. A write to a handle property uses the same operation verb wherever it happens,
but it lands on a different LAYER depending on who writes. Writing during construction or setup
(and from the inspector and canvas tools) sets the object's stored field on the CANONICAL
authored scene. Writing from inside a CALLBACK at runtime lands on the RUNTIME PROJECTION
instead and never touches the saved scene; this is resolved in subsection 6 (the firing flow),
where rewind restores the whole projection to the authored scene so callback writes are undone
on rewind. The read side is shared; only the write target differs by phase.

#### 2. The score handle

The score handle is the live reference to score-level state and the transport, GeoSonix's
`_score`. It reads and writes the piece-wide fields the Scene already holds: bpm, the output
route (MIDI or superdough) and engine, the global superdough voice, the background image
name, the canvas size, and the sprite kinematics knobs (drag, jitter, coast, turnDamping)
that script.js already sets through its score global. It also exposes a background read,
the GeoSonix `hasBackgroundImage` gate that the reference example branches on, grounded in
GXW's imageName.

The transport sits on the score handle: play, stop, and rewind, plus the bpm read and write.
GXW already has these in transport.js and transportBar.js (the master clock, BPM, and play
state, kept per the section 10 migration map); the score handle is the procedural face of
that existing transport, not a new clock. GeoSonix's lifecycle hooks onPlay, onRewind, and
onTick are the transport's call-outs into user code and are placed under section 5 below.

Selection is a score-level read: which objects the user has selected on the canvas. The
construction and callback surfaces address objects by id and by selector (section 3), and
"selection" is one of those selectors, so the score handle exposes the current selection as
the backing set for it. GXW already tracks selection canvas-side (canvasSelection.js); the
score handle reads from it.

HARMONY IS A PLACEHOLDER. The score handle will later carry harmony state — tonic, root,
scale, chord, range, and the note-mapping mode — and the object handle will carry per-object
overrides of the same, with "Score" meaning inherit. That whole layer is DEFERRED and will be
reworked on TONAL (@strudel/tonal and @tonaljs), per Chris's explicit instruction. The
substrate reserves the place on both handles and designs nothing else about harmony now.

#### 3. The scene-mutation operations

These are the core verbs every surface resolves to. There are five, and GXW already has all
of them at the JSON level in sceneEditor.js; the substrate's contribution is to give them an
id-and-selector face and the selective-merge rule.

CREATE. Make a curve, cursor, or trigger, by explicit id or by auto-id. GXW has addCurveAt,
addTriggerAt, and addSpriteAt in sceneEditor.js and addCurve / addTrigger / addSprite on the
Scene, with id generation in idGen.js. GeoSonix's addCurve(id) / addCursor(id) /
addTrigger(id) create the object AND select it as the current target; the auto-id form
(addTrigger with no id) auto-numbers. GeosonixV2 keeps both: an explicit id for stable
re-runnable construction (the reference example builds curve 1000 plus lineIndex), and an
auto-id form for quick creation. Create returns the handle.

POSITION. Place an object, GeoSonix setPosition(idOrCurrent, x, y). GXW has
setPositionAxisOnSelection and translateSelection. Note there is no Z in GeosonixV2 (the
inspector dropped it); position is x and y only.

SET A PROPERTY. Assign one field on one object or a selection. This is the workhorse: GXW's
whole set*OnSelection family (setColorOnSelection, setBeatsPerCycleOnSelection,
setStartAtCycleOnSelection, and the rest) routes through two helpers, setFieldOnSelection and
setStringFieldOnSelection, that write a named field across the selected slices of the JSON
data. A handle property write (section 1) is exactly this verb addressed by id. The shared
interval, beat-string, and Euclidean formatting the inspector applies (applyBeatFieldFormatting
and the re-bar pass) are part of the set operation for those fields, so construction code that
sets activeBeats gets the same formatting the inspector produces.

GROUP. Tag an object with a group name so a later operation can address the whole group.
GeoSonix setGroup(idOrCurrent, "groupName") and group-named styling (setColor("lines", ...))
are central to terse construction. This is the substrate's one genuinely new field, and it is
now in place: a `group` string on each kind (sceneSchema.js, the constructors, the
setGroupOnSelection setter, the main.js dispatch), surfaced as the Identity band's Group
dropdown (join an existing group, None to leave, or "New group…" to create one by prompt).
The remaining group-name SELECTOR (addressing every object tagged with a name) is still
design, below; the field it reads is built.

ADDRESS BY SELECTOR. Every operation takes a target, and the target is a selector. GeoSonix
accepts an id, the token current (the last created or last referenced object), all, selection,
and a group name. GeosonixV2 adopts the same set. The id is the convention id (CRV2, TRG3,
SPR1). Current is the stateful builder target — addCurve selects the new object as current,
and the bare setters that follow (setGroup, setPattern) act on it, which is what makes the
reference example's per-line block read cleanly. All is every object; selection is the canvas
selection (read from the score handle); a group name is every object tagged with it. GXW's
internal selection is per-kind index sets today; the substrate puts an id-and-selector layer
over that so code and the inspector address objects the same way.

ID-KEYED SELECTIVE MERGE (the semantics Chris settled). The scene persists across runs, and
running construction code is a MERGE into the living scene, not a rebuild. Construction
addresses objects by id and changes ONLY the properties for which it literally calls a setter.
Any property the code does not touch is RETAINED, including edits the user made by hand in the
inspector. Chris's example: if the code creates trigger T5 but never sets its colour, and the
user has set T5 to red in the inspector, re-running the code keeps red. This is the mechanism
that stops construction code from clobbering hand-made settings, without a separate lock.
clear() is the explicit full reset (as in the reference example's first line); without it,
runs merge. Create-by-id on an id that already exists is therefore an address, not a
duplicate: it selects the existing object so the following setters update it in place. The
merge rule is the substrate's, so the inspector, a canvas edit, and a construction re-run all
compose the same way on one object.

#### 4. The one-operation-set principle

All five surfaces resolve to the operation set above. This is the heart of one-scene-many-views.

The INSPECTOR is already there: every inspector edit calls a sceneEditor set*OnSelection
operation, dispatched from main.js. The substrate does not change this path; it recognises it
as the canonical operation layer and builds the other surfaces on the same functions.

CONSTRUCTION CODE desugars to the same operations. addCurve is the create verb, setPointAt and
setPosition are position, setGroup is group, setPattern / setColor / setSpeed and the rest are
the set verb addressed by the current object or an id. The construction API is a thin builder
that calls the operation set, exactly as GeoSonix's library assembled a command string and ran
it through geosonix.execute. The builder is sugar; the operations are the substance.

The per-object CALLBACKS read through the object handle and (in the next stage) write through
the same set verb. A callback that sets this.color performs the same operation the inspector's
colour field performs.

The CANVAS TOOLS already call create and position and set operations (addCurveAt, drag to
translateSelection, the canvas inspector's field edits). They are another caller of the set,
not a separate path.

The SAVE FORMAT is the serialized result of the operations: scene.json is the curves,
triggers, and sprites the operations have built, and script.js is the construction and
callback code. Because construction is a re-runnable merge, the save format and a construction
script are two encodings of the same scene — the deepest form of one-scene-two-views, the
same identity GeoSonix had where its snapshot command lines and its script API were one
vocabulary.

STATE MODEL (RESOLVED 2026-06-06, with Chris). The authored scene is CANONICAL — the stored
schema fields that the canvas tools, the inspector, and setup all produce. SETUP is authoring
expressed as code: it does the same thing the user would do with the tools, adding objects and
setting properties before the score runs, and it runs on score load and on user request, with
a selected region re-executable on its own (GeoSonix-style line / selection / function / all).
It mutates the authored scene through the operation set with the selective-merge rule of
subsection 3, so whether a re-run replaces a hand edit is the user's choice. The live
simulation is a RUNTIME PROJECTION that starts from the authored scene and accumulates
ALL live change while playing — motion (live position and velocity, cycle phase) and any field
a callback writes. REWIND is a runtime-only reset: it sets transport time to zero and RESTORES
THE WHOLE PROJECTION to the authored scene — every object's motion back to its Initial
Conditions and every field a callback changed back to its authored value; it does NOT re-run
setup and does NOT alter the authored scene. onRewind is the user's hook for resetting their
own script-level state (the prev stores, an RNG seed, counters), not the objects themselves —
the engine restores the whole scene from the authored version.
rewind() is also a command callable from scripts, and scene-building scripts conventionally
call it (the reference example's opening lines do), but that is the script choosing to, not an
automatic effect of rebuilding. No field is tagged build-versus-runtime; the split is by WHO writes:
setup writes the canonical scene (persistent, saved), while a callback writes only the runtime
projection, and ALL of a callback's changes — motion and every other field alike — are
discarded on rewind, so a piece replays identically from the top. That reliable way back to a
known state is fundamental to the deterministic-results objective. (This corrects an earlier
draft that let non-motion callback changes persist through rewind; Chris settled on full
restore on 2026-06-06, since changes accumulating across plays and rewinds would make the
result depend on history and break determinism.) This resolves the live-versus-rebuild
question: the handle reads authored fields from the canonical scene and runtime values from the
simulation; setup writes route to the canonical scene and callback writes to the runtime
projection, all through the one operation set. The build stage still picks the rebuild MECHANICS — a full rebuild versus a cheaper
incremental one — but the state MODEL is fixed here, not deferred.

#### 5. The lifecycle and authoring-surface placement

The script tab holds three kinds of section, all sitting on the substrate, settled with Chris as
a Processing-style split.

SETUP runs once, on demand. It holds scene construction: the create, position, set, and group
operations that build the object arrangement, plus score-level setup (bpm, background, the
kinematics knobs). It is the home of the reference example's whole body. Re-running setup is
the selective merge of section 3, so setup is safe to re-run against a living, hand-edited
scene.

RUN is the global per-tick block, the Processing draw() analogue and the direct descendant of
GeoSonix's onTick(time). It runs every tick, for code that should update repeatedly and is
neither setup nor a per-object callback. It is global, distinct from the per-object onTick
callback (run is one block for the whole score; onTick is one function per object). It may
legitimately do nothing. The section NAME is still open — run is a placeholder; draw, loop,
update, and tick are candidates.

The per-object CALLBACKS are the four named functions the Msg Functions band already binds:
onActiveBeat (a cursor crossing an active beat, gated by canActiveBeat), hasCollided and
beenTriggered (collision, gated by canCollide and canBeTriggered), and onTick (per tick, gated by
canTick).
They live in script.js as plain named functions, bound to objects by name through the
functionMap the loader builds, and they receive the object handle as their context. This is
GXW's existing callback spine (the simulation's dispatchCollision and per-sprite onTick,
firing through fireImmediateNote / fireImmediateSound / fireImmediateValue), promoted to the
primary authoring model and generalised from sprites to all three kinds.

GeoSonix's other global hooks map cleanly: onPlay and onRewind are transport call-outs that
belong with the score handle's transport. Rewind itself is a runtime-only reset — time to
zero and the whole runtime projection restored to the authored scene (motion to Initial
Conditions and every callback-changed field back to its authored value), setup NOT re-run (see
the state model in the one-operation-set subsection above) — and onRewind is where the user
re-initializes their own script-level state (the prev stores, an RNG seed), not the objects
themselves. onMessage (external MIDI
and OSC input) is a later concern noted here but not designed. The token-to-duration tick table from
JavaScriptLibrary.js (whole note 384, the nineteen values that match GXW's interval menu in
intervalMenu.js) is the mapping the engine will use for Time Lag and Trigger Sync; it is
referenced as the engine's concern and not built here.

THE FIRING FLOW is designed in subsection 6 below. This subsection establishes only the
substrate it runs on; subsection 6 covers how a simulation step reaches a callback, how a
callback's note is scheduled, and how it sounds through superdough or MIDI, and it resolves the
rate-and-clock question (the cursor clock is tempo-locked). The write-from-callback semantics
and the fate of the on-demand deterministic pattern call remain open and are listed at the end
of subsection 6.

#### 6. The firing flow

This subsection designs how a simulation step reaches a callback, how a callback's note is
scheduled, and how it sounds — the firing flow the substrate runs on. It was worked through
with Chris on 2026-06-06 and supersedes the "designed later" placeholders left in subsection 5
and in §10.

TWO CLOCKS, DECOUPLED. GeoSonix ran its SIMULATION at the fast MIDI clock — a fine time
resolution that produced virtual positions for every cursor and sprite — and RENDERED
separately at thirty to forty frames a second, as fast as the machine allowed, with no audible
mismatch between what was seen and what was heard. The tight timing came from the
fine-resolution simulation, not from the render tick. GeosonixV2 adopts the same split. Today
GXW's simulation is tied to the animation frame; the firing flow DECOUPLES it. The simulation
steps at a fine FIXED timestep clocked to the audio clock, the canvas simply samples the latest
virtual positions each frame, and the two run at their own rates. Because the simulation steps
finely it does not need to PREDICT events — it steps small and notices what happened — so a
freely moving sprite's collisions get the same fine timing as a beat-point crossing, and the
determinism boundary that worried an earlier sketch dissolves.

THE LOOK-AHEAD. The browser realization is the standard "two clocks" scheduler: each pass
advances the fine-step simulation a short window AHEAD of the audio playhead, runs that span's
callbacks, and schedules every note they emit at its exact upcoming audio time. The window is
fixed at roughly forty to fifty milliseconds. That comfortably exceeds a single render frame
(twenty-five to thirty-three milliseconds at thirty to forty fps), so a stalled frame never
glitches audio that is already scheduled. The one cost of running ahead is that asynchronous
live input — incoming MIDI or OSC, and the user's own edits — lands up to one window late; this
is immaterial, because such input is not aligned to the clock in the first place. GeoSonix
itself kept no explicit window and still felt synchronous at thirty to forty fps, so a window
this size is generous.

THE CURSOR CLOCK IS TEMPO-LOCKED. A cursor's trip around its curve is a musical cycle, never an
absolute number of seconds. Its duration is its beats-per-cycle times its beat interval against
the global BPM, scaled per lap by cycleSpeeds. Change the tempo and every cursor scales with
it. There are no seconds-based cursor durations (GeoSonix's setDuration-in-seconds is not
carried over); cursor timing is entirely tempo-relative.

NOTE DURATIONS ARE IN SECONDS. The length of a fired note is a plain number of seconds — any
decimal value, a fraction of a second or more than a second — and is NOT tempo-locked. This is
deliberately distinct from the cursor clock: the cursor's motion follows the tempo, but a
note's sounding length is an absolute time. The engine schedules the note-off at the fire time
plus the duration, which is the superdough voice's envelope length or the MIDI note-off sent
that many seconds later.

EMISSION. A callback produces sound by calling an emitter explicitly — playNote for a pitched
note, playSound for a sample — not by returning a value. Everything in the call is overridable,
but in practice most of it defaults from the object's own fields: the output routing (the MIDI
port and channel, or under superdough the voice and sound bank) comes from the object unless
the call overrides it, and the callback typically supplies just the note. The optional per-note
parameters are note, velocity, duration, and pan. There are TWO call forms: a positional
convenience form, playNote(note, velocity, duration, pan), and an options-object form,
playNote({ note, velocity, duration, pan, ... }), told apart by whether the first argument is
an object. The options form gives named parameters, reads back more clearly under Speak
Selection, and carries ADDITIONAL parameters beyond the four — a natural pass-through to
superdough's richer parameter set (gain, filter cutoff, envelope, and so on) and room to grow.
playSound takes the same two forms. PAN is per-note only under superdough, which has a real
stereo pan per voice; over plain MIDI there is no per-note pan (channel pan, CC10, would move
the whole channel), so pan is a NO-OP for MIDI output. Per-note MIDI expression including pan
waits on MPE, a future possibility, not designed now.

THE FOUR CALLBACKS. Each object binds up to four named procedural callbacks, and the firing
taxonomy is which event fires which. onActiveBeat fires when a cursor crosses an active beat of
its OWN curve or sprite; this is the melodic and rhythmic firing, GeoSonix's curveMessage, the
PRIMARY musical callback, so it LEADS the band. hasCollided fires on a curve or sprite whose
cursor strikes a diamond — the active side of a collision. beenTriggered fires on the diamond
that was struck — the passive side. onActiveBeat is a DISTINCT path from the collision callbacks,
so a melody on one's own grid and a reaction to striking something elsewhere run different code.
onTick fires at a fixed control rate (below). (REMOVED 2026-06-09: a fifth callback, autoMessage,
fired at a per-object "Automessage Interval". It was cut because onTick plus the per-object
`prev` scratch store does the same self-scheduling — `if (this.time >= prev.nextDue) { …;
prev.nextDue = this.time + computeFromColour() }` — including the self-modulating image-driven
interval that was its whole point, without a separate slot, interval field, or field write-back
machinery. Its inspector controls and schema fields, `canAutoMessage` / `autoMessageFunction` /
`autoMessageInterval`, were never wired to fire and are removed.) The names carry the
active/passive direction in English voice — hasCollided (this
object did the colliding) versus beenTriggered (this object was beenTriggered) — descending from
GXW's old hasCollided / beenTriggered pair; onActiveBeat and onTick carry the on- prefix as "on this event"
callbacks. (An earlier hasCollided / beenTriggered pair, and before that hitTrigger / triggerHit, were
stepping stones; the has/been voice was settled on for the clearest active-vs-passive reading.)

A KEY UNIFICATION underlies this: a beat point and a trigger are the SAME object — a diamond —
playing whichever role the moment calls for. A diamond placed along a curve as part of its
pattern is a beat point; a free-standing diamond is a trigger. So hasCollided and beenTriggered
describe collisions with diamonds, and onActiveBeat describes a cursor meeting the diamonds of
its own pattern. hasCollided is general enough to cover striking any object; beenTriggered names
the common case (a trigger being hit) and stretches to cover the rare others rather than
sacrificing the hasCollided / beenTriggered symmetry.

The Msg Functions band (§4) is built with these names, in the order onActiveBeat, hasCollided,
beenTriggered, onTick. onActiveBeat shows only for
curves and sprites that can carry beat points (never triggers); the others apply to all kinds.

THE PER-STEP PIPELINE. Within one fine simulation step the order is: first onTick runs, so any
steering force a script applies is in place before motion is computed; then motion integrates —
cursors advance along their curves by their tempo-locked phase and sprites integrate their
physics; then the step detects what happened — a cursor crossing one of its own beat points,
and any collision between a cursor and a diamond; then the matching callbacks fire — onActiveBeat
for a crossing, hasCollided on the mover and beenTriggered on the struck diamond for a collision.
Every note these callbacks emit is stamped with that step's audio time, so it sounds exactly
when the step occurred.

THE onTick RATE. onTick fires sixty times a second — once every sixteen-and-two-thirds
milliseconds — fixed and NOT user-settable. Sixty is Processing's and p5's default draw() rate
and the proven cadence for the smooth, force-based steering onTick is for (steering a sprite by
the colour beneath it, sweeping a controller); it is far below the fine-step rate that times
notes, so it is no burden; and being tempo-independent it stays smooth at any tempo. It is
fixed rather than exposed because a user could not easily know a good value, and because
changing it would slightly change the deterministic result of a piece — so it is chosen once
and left alone. Crucially the sixty is counted in SIMULATION time, every one-sixtieth of a
second of the simulation clock, derived from the same clock as the fine steps and NOT tied to
the actual painted frames, which jitter and stall — this keeps onTick repeatable. A force
onTick sets persists between its calls while the fine steps integrate under it, the usual
control-rate-modulating-a-finer-rate arrangement.

THE FIRING CONTEXT. A callback runs with its object handle as `this`, so everything subsection
1 lists is already in hand — position, velocity, the derived speed kept separate for
convenience, the ten colour reads beneath the object, the cycle phase and count, and the
object's own fields. On top of that the context carries the per-firing additions GeoSonix's
`this` had plus a few GeosonixV2 conveniences. The set is deliberately BROAD: an unused field
costs nothing, since it materialises only when a callback names it. The per-firing additions:
for a collision, a full handle to the OTHER party — the diamond that was struck, or on the
struck side the cursor that hit it — so its colour, position, and group read like any handle;
for onActiveBeat, the beat just crossed, namely its index, the total beat count, and its
STRENGTH from the Beat Strength string (the accent, the natural thing to map to velocity); for
a collision, the impact SPEED at contact (hitSpeed) and the contact point; the first-fire and
loop flags firstMessage (the first firing ever) and repeatMessage (the first after each cursor
loop), which GeoSonix carried and which live here; and the scheduled audio time of this firing
with the transport's current cycle position, for code that wants to place itself in musical
time. The GeosonixV2 conveniences: a per-object SCRATCH store named `prev` — a plain object the
callback reads and writes freely (prev.step, prev.note) that persists across that object's
firings, the way one keeps an arpeggiator index or the last note. The name is Chris's, for
"anything from before"; the engine does not auto-populate it and does NOT clear it on rewind,
because it is the user's own state, re-initialised in onRewind if a clean start is wanted,
consistent with the state model. prev is the one freely-writable thing in the context today,
separate from the still-open question of writing back to the object's own schema fields. Also:
a seeded, deterministic random() bound to the score seed and reset on rewind, so variation is
repeatable; and the score handle for piece-wide reads (tempo, and the background gate and size
that steering reflects off). The emitters playNote, playSound, and applyForce and the
Processing-style math helpers are in scope as before, and mapHarmony is reserved against the
deferred Tonal harmony layer.

WRITE-BACK FROM CALLBACKS. A callback may write the object's own fields through its handle, not
only prev — this.x to nudge it, this.color to recolour it, this.beatsPerCycle to reshape its
grid — and it may write another object reached through a handle, such as disabling the trigger
it just struck. Those writes land on the RUNTIME PROJECTION, never the canonical saved scene
(only setup, the inspector, and the canvas tools write canonical), so playing a piece never
edits the file on disk. And rewind restores the whole projection to the authored scene, so
every callback write — motion and any other field alike — is undone and the piece replays
identically. This is the deterministic way back to a known state Chris required: letting
changes survive rewind would make the result depend on how many times the piece had been
played. The only reads a callback cannot write are the derived ones (speed, the colour values,
cycle phase), which are computed. The state model in §3's one-operation-set subsection is
updated to match.

RESOLVED, closing the firing flow. The pattern evaluator is DROPPED as a firing path — all note
and event sequences are generated procedurally — and Strudel mini-notation is kept only as a Beat
Points authoring mode (the new Strudel mode in §4; patternParse.js is reframed in §10 to that
role). setPattern means cycleSpeeds, the cursor's per-cycle speeds, not a note pattern. OUTPUT
ROUTE is global per score, as built: the whole piece plays to MIDI or to superdough exclusively,
with per-object port and channel under MIDI and per-object voice and bank under superdough; mixed
simultaneous output is a separable future possibility. VOICE routing resolves the call override
first, then the object's own voice, then the score-wide voice. The SEAM GUARD becomes a universal
CLIP rather than a drop: when a repeating seam is armed (the audition Loop now, arrangement
segments later), every scheduled note whose held length would overrun the boundary is clipped so
its note-off lands at the boundary, and its release tail is allowed to ring into the next pass for
continuity — the held portion ends at the seam, only the short release decays past. Because the
look-ahead scheduler places each note before it sounds, this is just a shorter duration handed to
the output (an earlier MIDI note-off, a shorter superdough envelope), never the killing of a live
voice, which dissolves the old can't-stop-a-superdough-voice problem. The ear-tuned release margin
no longer pulls notes inward, and the MIDI seam-panic backstop is unnecessary since a real
note-off is sent at the boundary; MIDI PANIC remains only for transport stop, rewind, pause, and
an output-mode switch. The build-time cleanups are resolved in §10: remove cursorTargets.js and
patternHighlight.js (the bidirectional code-canvas link is deferred to rebuild against the
callback bindings), and keep src/strudel/runtime.js as the audio runtime while removing the legacy
src/strudelRuntime.js. Nothing in the firing flow remains open.

#### Proposed file and module plan (for when implementation begins)

The substrate is small and mostly consolidation, so it should be a thin new layer over the
existing model rather than a rewrite.

A new module, src/sceneOps.js, holds the operation set: create, position, set, group, and the
selector resolution, plus the id-keyed selective-merge rule. It is the single seam every
surface calls. It wraps and re-exports the existing sceneEditor.js set*OnSelection functions
rather than duplicating them, so the inspector path is unchanged and the new surfaces share it.

STATUS (built, with one deviation): src/sceneOps.js now exists as a createSceneOps(data)
factory implementing the five operations, the selectors, and the selective merge. It does NOT
wrap sceneEditor as sketched above — it REIMPLEMENTS the per-entry field write, because
sceneEditor transitively imports acorn from an https URL and so cannot load offline (under
node tests). The inspector keeps its sceneEditor path; the two share the same field-write
semantics, and unifying them behind one writer is a later cleanup if it earns its keep. The
module is self-contained (depends only on idGen), not yet wired to any surface, and has no
test yet.

A new module, src/sceneHandles.js, holds the object handle and the score handle: the live
property views (reads from the Scene and the simulation, writes through sceneOps) and the
selector lookup by id, current, all, selection, and group. The callback context becomes a
handle from this module rather than the bespoke ctx object simulation.js builds inline, so
callbacks and construction share one handle type.

A new module, src/construction.js (or a section within the code-tab tooling), holds the
construction builder API — addCurve, addCursor, addTrigger, setGroup, setPointAt, setPattern,
and the rest — as thin sugar that calls sceneOps against the current-object target. This is the
GeoSonix-library analogue: a builder that desugars to the operation set.

scene.js stays the data model (the Curve, Trigger, Sprite, and Scene classes and their
fields). sceneEditor.js stays the JSON-level editing functions; sceneOps wraps them. The new
group field is added across the three kinds the same way the recent inspector fields were
(sceneSchema.js, the constructors in scene.js, a setter in sceneEditor.js, dispatch in
main.js), and removed from stripObsoleteFields' concern since it is new, not revived. No
existing file is rewritten and no runtime behaviour changes in this stage; the plan is the
shape the build will take, not work done now.

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
appearance, Msg Functions (callback slots), Beat Points, Cycle, then a separator, the
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
Time Lag (Identity) and Trigger Sync To Beat
(Cycle). The token→duration mapping is the engine's concern, defined later.

### Identity band
Two lines:
- Line 1: Object ID (read-only / "locked" on single-select, blank-greyed on multi) +
  State — a three-state radio group, Active / No Cursor / Disable (model values active /
  passive / disabled). Curves and sprites offer all three; triggers offer Active / Disable
  only (no cursor).
- Line 2: Object Name + Group. Object Name reuses GXW's `name` field but is rendered
  BLANK and non-editable for now — there is no defined way to author names yet, so it is a
  placeholder until the authoring semantics are designed. Group is the object's group
  membership (field `group`, default ""): a dropdown that, when groups exist in the scene,
  shows the object's group name or "None" if it is ungrouped, and is blank when no groups
  are defined anywhere. The dropdown lists every group name already in the scene to join,
  a "None" entry to leave a group, and a "New group…" entry that prompts for a name and
  creates it. New group names are also expected to come from construction code's setGroup
  later. Group is the selector substrate's one genuinely new field (DESIGN §3).

Time Lag (the multiplier × interval pair `timeLagMultiplier` + `timeLagInterval`) moved OFF
this band to the Cycle band to make room for Group — see the Cycle band below.

Dropped here vs GeoSonix / old GXW: the Enable/Hide checkboxes (replaced by State) and GXW's
old cycle row + Strudel pattern row (cycle controls now live in the Beat Points and Cycle
bands). Group, dropped at the GeosonixV2 restructure, is now restored on Line 2.

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

### Msg Functions band (callback slots)
Four named procedural callbacks — onActiveBeat, hasCollided, beenTriggered, onTick —
replace GeoSonix's message functions. Each callback is a row with a Can-X
checkbox, a function-name field, and ONE contextual button: CREATE when the named function
doesn't exist yet (scaffolds e.g. `onActiveBeat_<id>` in script.js) or GO TO when it does
(navigates to it). Gates: canActiveBeat / canCollide / canBeTriggered / canTick.
Function fields: onActiveBeatFunction / hasCollidedFunction /
beenTriggeredFunction / onTickFunction.

The names carry their meaning in English voice so the active/passive distinction reads at a
glance: hasCollided (the active mover that struck something) versus beenTriggered (the
passive object that was struck), descending from GXW's old hasCollided / beenTriggered pair. onActiveBeat
fires when a cursor crosses an active beat of the object's OWN rhythm (the GeoSonix curve
message) — it is the primary musical callback, so it sits FIRST. It is shown only for curves
and sprites that can carry beat points (greyed for triggers). The collision pair and onTick
apply to all kinds. So the band reads, top to bottom: onActiveBeat, hasCollided,
beenTriggered, onTick.

(REMOVED 2026-06-09: a fifth callback, autoMessage, and its Automessage Interval dropdown —
a per-object self-timed message stream — lived in this band. It was cut in favour of onTick +
the `prev` scratch store doing the same self-scheduling, including the self-modulating
image-driven interval that was its main use; see §3.6's callbacks note. The
`canAutoMessage` / `autoMessageFunction` / `autoMessageInterval` schema fields and the
inspector rows are removed; removing the row also frees vertical space in the band.)

These callbacks ARE the procedural pattern model (section 3): plain functions in script.js.
The collision callbacks and onTick fire today; onActiveBeat's firing (a cursor crossing a beat
point) lands with the scheduler in the firing flow (§3.6). The ctx/API available inside the
callback bodies is defined by §3.6's firing context.

### Beat Points band
Available for curves OR sprites (greyed for triggers / empty). The band's lead label reads
"Beat Pattern" in all modes — a reasonable description whether the pattern is x/dot, Euclidean-
generated, or a Strudel mini-notation expression (the underlying field is still beatPointsMode).
A mode dropdown — None / Normal / Euclidean / Strudel, extensible — drives what is shown:
- None: just the mode dropdown.
- Normal: Beats/Cycle + Beats/Bar; then the Active Beats pattern string and the Beat
  Strength string.
- Euclidean: Beats/Cycle + Beat Interval + Beats/Bar; an indented Active Beats COUNT (k,
  aligned under Beats/Cycle) + Beat Shift + Repeats; then the generated Active Beats pattern
  (LOCKED, read-only) and the Beat Strength string.
- Strudel: the length spec changes — Beats/Cycle and Beats/Bar are BOTH replaced by a single
  Cycle Length control: a note-duration dropdown (the shared interval menu, with "Off" excluded
  since a cycle must have length) times an integer count, laid out `Cycle Length [dropdown] x
  [count]`. The cycle length is `cycleInterval × cycleCount` (default Qtr × 16), and the one-cycle
  mini-notation pattern maps across that span. Then a single Strudel
  pattern field REPLACES the Active Beats x/dot field, and the
  separate Beat Strength field is hidden — strength is carried inline in the one pattern. The
  field is a Strudel mini-notation expression (operators allowed) whose one-cycle event
  positions become the beat points. A numeric token is a beat AT that strength (a digit 0–9), a
  tilde is a rest (no beat, no onActiveBeat), and a bare x is a beat at default strength. A 0 is a
  beat at zero strength — onActiveBeat still fires, distinct from a rest, which fires nothing.
  Because mini-notation subdivides unevenly, beats can fall OFF the even Beats/Cycle grid, which
  is the reach it adds over the x/dot string. The crossed beat's strength reaches the onActiveBeat
  callback through the firing context (§3.6), where it can drive note velocity directly or be
  blended with the colour reads. This is an alternative AUTHORING of beat points, not a
  firing-time evaluator: it is parsed once per cycle by patternParse.js for positions and
  strengths (§10), the same role generateEuclideanPattern plays for Euclidean. Strudel's own
  (k,n) Euclidean shorthand is available here too, but GXW's dedicated Euclidean mode is kept as
  the richer option.

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
activeBeatsCount, beatShift, repeats. The Strudel mode (added per §3.6) introduces a "strudel"
value for beatPointsMode and a new field holding its mini-notation expression (name TBD at
build, e.g. beatPattern); activeBeats and strength are unused while in that mode, since the one
pattern carries both position and strength.

### Cycle band
Reworked from GeoSonix; Cursor Speed, Cycle Time and Time Lock are dropped. Two lines:
- Line 1 (curves & sprites; greyed for triggers/empty): Cycle Speeds (a short string field)
  + Start at Cycle (default 0 — the cycle the object begins on) + Stop at Cycle (default
  -1 — never stop). Fields: cycleSpeeds, startAtCycle, stopAtCycle (start/stop on curves
  and sprites).
- Line 2: Trigger Sync To Beat (triggers; greyed otherwise) — the shared interval dropdown
  (field `triggerSyncToBeat`, default "Off") — at the LEFT; and Time Lag to its right after a
  FIXED gap so the two read as unrelated without the field riding to the pane edge when the
  inspector is widened (the fixed gap keeps the row no wider than the other lines). Time Lag
  is the multiplier × interval pair (`timeLagMultiplier` + `timeLagInterval`, the "×" reads
  "times"), universal across kinds, relocated here from the Identity band. Its behaviour is
  still TBD (model + UI scaffolding).

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
setters, and dispatched in `main.js`: group, timeLagMultiplier, timeLagInterval,
beatPointsMode, activeBeats,
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
state); canvasCollision.js (collision detection feeding hasCollided / beenTriggered); script.js
(the procedural callback bodies — the authoring home); auditionBar.js and the seed/ folder
(mutation and audition); oklch.js (colour conversion behind the pixel reads). From
firingEngine.js, keep the procedural-fire and output spine: fireImmediateNote /
fireImmediateSound / fireImmediateValue, the superdough-versus-MIDI dispatch with its
output-mode switch and MIDI panic, applyVoiceInjection / applyVoiceEnvelope and the
VOICE_ENVELOPES table, the seam guard (setSeamBoundary), the firing-event flash signal,
and lazy sample loading.

CHANGE (kept but reframed): patternParse.js is kept ONLY as the beat-point pattern position
generator for the new Strudel Beat Points mode (§4) — compile a mini-notation expression and
query one cycle into its event positions and per-hap strength values, the same role
generateEuclideanPattern plays; never a firing-time evaluator, never feeding pitch, never a
live engine. Note and event sequences are generated procedurally instead. signals.js reduces to the procedural colour reads:
keep imageSignalsFromOKLCh (the OKLCh-to-ten-values colour math) feeding the callback
context's pixel reads (ctx.pxLt, ctx.pxR, and so on), and keep mapClip as a plain numeric
clamp-and-remap helper. firingEngine.js reduces to the spine above with the pattern
machinery removed. debugTap.js becomes a plain variadic print(...) that writes its
arguments to the message area, space-separated, no labels. The Script tab loses its
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

RESOLVED (for the section-3 engine design): a pattern's playback rate is the tempo-locked cursor
clock (§3.6: a musical cycle against the global BPM, no seconds-based cursor durations). The
cursor-target highlight and the old labelled-block model (cursorTargets.js / patternHighlight.js)
are REMOVED in the build cleanup, since their $-label resolution does not transfer to the
procedural callback model; the wanted bidirectional code-canvas link (cursor in a callback
highlights its objects, and selecting objects marks their callbacks) is captured for a later
rebuild against the callback name-bindings (DEFERRED.md). The two runtime files reconcile to
KEEPING src/strudel/runtime.js as the superdough audio runtime and REMOVING the legacy
src/strudelRuntime.js (the old cyclist / stack-pattern runtime belonging to the removed two-pass
machinery), rewiring any lingering import. The cross-cycle-modifier-index and
on-demand-pattern-call questions are MOOT: the evaluator is dropped as a firing path and
patternParse is the Strudel Beat Points position generator, queried once per cycle (see §3.6 and
§4).
