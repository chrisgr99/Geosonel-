# GeoSonix command vocabulary (derived from the score files)

This inventory is derived from reading the script and snapshot contents of the
score files in ~/Documents/Geosonix Scores. It is a USAGE inventory, not the
authoritative definition list — Chris is to paste the GeoSonix file that defines
all possible callbacks and helper functions, and this document should be
reconciled against it. It exists to inform the GeosonixV2 procedural API design
(DESIGN.md section 3).

Files read in full: Script Editor Tutorial, Basic Object Techniques, examples of
all types of message triggering, Example of firstMessage and repeatMessage, ID
Examples, Chord Changer (includes mapScale), Script for Receiving Midi, Receive
OSC from GecoMIDI and Leap Controller. The large geometry-heavy scores (Shape,
the Rosettes, Fractal, the henon maps) were not read in full: they are mostly
serialized object coordinate data and reuse the same vocabulary.

## Two surfaces, one format

A `.score` is XML. It holds a `<snapShot>` of space-delimited `<command>` lines
that serialize the whole scene, and an `<script>` of `<jsline>` lines holding the
attached JavaScript. The snapshot command list and the script API are largely the
SAME vocabulary in two forms: the snapshot uses bare `command arg arg` lines with
the literal token `current` as the implicit current-object reference; the script
uses `command(args)` function calls. This is strong precedent for Chris's "one
scene, two views" model — the serialized scene IS a procedural rebuild script.

## Score-level setup (snapshot + script)

setScoreTonic, setScoreRoot, setScoreScaleName, setScoreChordName, setScoreRange,
setScoreRangeLow, setTimeSig, setBPM, zoom, center, rotate, registerImage,
setBackground (script form: `setBackground("Jazz.png", -14,10,14,-10)`).

## Object creation — the stateful "current" builder

addCurve(id), addCursor(id), addTrigger(id [, x, y, z]) each create an object,
select it, and make it the `current` target. A no-id auto-numbered form exists
(addTrigger2(x, y, z) in the OSC script). After creation, the property setters
below act on `current` (snapshot) or take an id / selector (script).

## Object property setters (shared across kinds)

setPosition(idOrCurrent, x, y, z), setActive, setHideInactive, setHideObject,
setGroup(idOrCurrent, "groupName"), setColorActive, setColorInactive (snapshot
uses named palette tokens like trigger_active / curve_inactive OR explicit
r g b a; script `setColor` takes r,g,b[,a]), setLabel, setMidiChannel,
setMidiNote, setObjectRoot, setObjectTonic, setObjectRangeLow, setObjectRange,
setObjectScaleName, setObjectChordName (the per-object harmony override; value
"Score" means inherit the score), setAutoBeatInterval (in ticks; 0 = off, 96 =
quarter, 192 = half, 384 = whole, given 48 ticks per ... unit), setBeatEmphasis
(the per-beat strength string, e.g. 9777559995859955), setTimeShiftUnitTicks,
setTimeShiftMultiplier, setMessageName (the collision/beat message function),
setAutoMessageName (the automessage function).

## Curve-specific

setPointsEllipse(w, h), setResize(w, h), setLineThickness, setBeatPoints (mode +
params: `b 16 4` = basic with cycle 16, count 4; `e 16 4 2 1` = euclidean cycle
16, count 4, shift 2, repeats 1), setActiveBeats (the pattern string, e.g.
`..x...x...x...x.|`, `x`, `x.`).

## Cursor-specific

setCurve(idOrCurrent, curveRef) where curveRef can be the token `lastCurve`,
setLine, setDuration (seconds for one loop), setCursorWidth1, setCursorWidth2,
setPattern (per-cycle DIRECTION+SPEED sequence — NOT scale degrees; confirmed from
JavaScriptLibrary.js: "set the direction and speed of the cursor on successive cycles,"
e.g. `1 -0.5` = loop 1 forward full speed, loop 2 reverse half speed; `3 -6 3 -6` = per-cycle
speed multipliers. This is exactly GXW's cycleSpeeds field).

## Trigger-specific

setTriggerSize, setImageActive, setImageInactive.

## Selectors and object handles

Selectors accepted where an id is expected: a numeric id, "current", "all",
"selection", or a group name (e.g. "mygroup"). Object handles: `_obj(id)` and its
short form `_o(id)` return a live object whose properties can be read and written
(`_obj(150).x`, `_o(150).y = 4`, `_o(8).nBeats`). The score object `_score`
exposes `.scaleName`, `.chord`, `.root`, `.hasBackgroundImage` (read and write —
the Chord Changer writes `_score.chord` / `_score.root` live).

## Global lifecycle hooks (script functions called by the engine)

onRewind() — runs on rewind (used to (re)initialize state, seed RNG, build
mover objects). onPlay() — runs on play. onTick(time) — runs every tick; this is
the global per-tick block, the direct analogue of GeosonixV2's proposed "run"
section and of Processing's draw(). onMessage(...) — runs on each received
external message; the signature is protocol-discriminated:
`onMessage(protocol, notUsed, channel, msgType, param)` for MIDI and
`onMessage(protocol, sourceURL, sourcePort, address, value)` for OSC.

## Per-object message / callback functions

These are ordinary named JS functions bound to objects by name via
setMessageName / setAutoMessageName (or the inspector). Any number of objects can
share one. The examples used names cursorAutoMessage, curveAutoMessage,
curveMessage, triggerAutoMessage, triggerMessage, chordMsg. There are FIVE firing
situations: automessages (any trigger, cursor, or curve, at its AutoBeatInterval);
curve beat messages (a curve fires when its cursor hits an active beat point);
trigger messages (a trigger fires when a cursor collides with it). The
firstMessage / repeatMessage flags distinguish the first message ever and the
first after each cursor loop.

### The firing context `this` (inside message functions)

this.id, this.port, this.channel, this.note, this.firstMessage, this.repeatMessage,
this.beat (beat strength of the firing beat point), this.beatNumber, this.nBeats,
this.r / this.g / this.b (the object's own colour channels, 0..1), this.x,
this.angle, and this.cursor with its own .r / .g / .b / .x / .angle (the cursor's
colour and position). _score.hasBackgroundImage gates colour-driven branches.

## Harmony and mapping helpers

mapHarmony(value, lo, hi) — map a continuous value to a pitch against the current
chord. mapChord(value, lo, hi, ...) and mapScale(value, lo, hi) — map onto the
current chord / scale. mapList(value, lo, hi, list) — index a list by a mapped
value (used to step through a chord-change array). map(value, inLo, inHi, outLo,
outHi) — the plain linear remap. Constants seen: scale-degree degI, degIV, degV,
degVI; chord types chMaj, chmin, chMajor, chmin7; scale scMajor. A chord
progression is authored as an array of [degree, chordType] pairs and stepped with
mapList against a curve's beat count.

## Output, transport, math, utility

midi.note(port, channel, note, velocity, duration) — the note output primitive
(this becomes GeosonixV2's playNote). Transport: play(speed), stop(), rewind().
print(...) — up to ten items to the console / message area. Math: the script
exposes bare sqrt, sin, cos, abs, and TWO_PI (Processing-style globals), plus full
JS Math (Math.seed = 8 sets a deterministic RNG seed). MIDI input constants:
midiCc 0xb0, midiBend 0xe0, midiNoteOn 0x90, midiNoteOff 0x80, midiPgmChange 0xc0,
midiAftertouch 0xa0, midiChannelPressure 0xD0.

## Observations for the GeosonixV2 design

The harmony layer is central and richer than GXW currently has: per-score AND
per-object tonic / root / scale / chord, with "Score" meaning inherit, plus the
map* family that turns continuous values into pitches against the current chord or
scale. Live chord changes are done by writing _score.chord / _score.root from a
message function (the Chord Changer steps a [degree, chord] array with mapList).

The global hooks onRewind / onPlay / onTick / onMessage are a clean precedent for
the GeosonixV2 setup/run split and for live external control. onTick(time) is
exactly the proposed global "run" section.

The `current` object convention and the id-or-selector arguments ("all",
"selection", group names) are the ergonomics that make procedural construction
terse; worth carrying into the GeosonixV2 builder API.

The note-output signature midi.note(port, channel, note, vel, dur) and the firing
context fields (this.note, this.port, this.channel, this.cursor.*) define the
shape playNote should present.

RESOLVED (2026-06-06, from JavaScriptLibrary.js): setPattern is the cursor's per-cycle
direction+speed sequence, i.e. GXW's cycleSpeeds — NOT a scale-degree / note pattern. The
earlier "scale-degree sequence" reading here was WRONG. GeoSonix has no note-sequence-string
feature at all: melodic pitch comes from message functions calling mapHarmony / mapChord
against the chord/scale, and the beat-point grid (setBeatPoints / setActiveBeats /
setBeatEmphasis) sets when notes fire and their emphasis. So setPattern does NOT overlap the
optional deterministic pattern evaluator; that evaluator's keep-or-drop is a separate open
question for the section-3 engine design.

## Reconciliation with JavaScriptLibrary.js (authoritative)

The authoritative definitions live in ~/Documents/Geosonix Scores/JavaScriptLibrary.js
(this is the GeoSonix standard library auto-loaded into every script). Reading it
confirms and extends the usage inventory above. Key structural findings:

The whole functional API is THIN SUGAR over a command layer. Almost every builder
function just assembles a space-delimited string and calls geosonix.execute("command
args"). Those command strings are exactly the snapshot `<command>` lines. So the
script API, the command interpreter, and the save format are ONE thing in GeoSonix.
This is the deepest validation of the one-scene-two-views model: construction code
and the serialized scene are the same operations in two skins. A GeosonixV2 builder
API could likewise desugar to a single set of scene-mutation operations that the
save format and the canvas tools also drive.

Object and score handles. _obj(id) / _o(id) call _score.obj(id) and return a live
object whose properties read and write through to the engine: .x .y .z, .r .g .b
(colour 0..1), .id, .active, .hidden, .hideInactive, .objectTonic .objectRoot
.objectScale .objectChord .objectRangeLow, .popupLabel, .nBeats. _score exposes
.tonic .root .scale .chord .range .rangeLow .mapNotesTo .chordNotes .notes
.backgroundSize, plus methods obj() objectList() getObjects() addTrigger() addCurve()
addCursor() ellipse() del() delList() background() registerImage() zoom() rotate()
origin() center() play() stop() rewind() select().

Note-duration constants in TICKS (whole note = 384): note384th 1, note128th 3,
note64th 6, note32nd 12, note8thTrill 16, note16th 24, noteQtrTrill 32,
noteDotted16th 36, note8th 48, noteHalfTrill 64, noteDot8th 72, noteQtr 96,
noteDottedQtr 144, noteHalf 192, noteDottedHalf 288, noteWhole 384, note2xWhole 768,
note4xWhole 1536. This list is exactly GXW's 19-token interval menu (intervalMenu.js)
in tick form, so it IS the token-to-duration table the engine needs for Time Lag,
Automessage Interval, and Trigger Sync. setAutoBeatInterval values seen in scores
(96 / 192 / 384) decode as quarter / half / whole against this table.

Scale-degree constants: degI 0, degII 2, degIII 4, degIV 5, degV 7, degVI 9,
degVII 11.

The harmony engine (the substantial piece for GXW's deferred Notes & Harmony work).
mapChord(value, lo, hi, ...) maps a value across the chord notes in range;
mapHarmony(...) uses the object's mapNotesTo property to choose chord-vs-scale;
mappingNotes / notesInRange build the extended note set across octaves;
nearestInScale / nearestInScale2 / degreeToNote / nearestInList quantize to a scale.
Inside a message function these read harmony defaults from _msgCaller (the firing
object) — the library notes that `this` only works in a message function, so
_msgCaller is the engine-provided handle to the caller. Harmony setters come in two
forms: setScoreHarmony(tonic, degree, range, scale) and setObjectHarmony(...), plus
the dual-purpose setTonic/setRoot/setScale/setChord/setRange/setRangeLow/setMapNotesTo
(one arg sets the score, two args set an object). NOTE: mapScale is USED in the
scores (Chord Changer) but is NOT defined in this library — either a built-in or
defined elsewhere; flag as a gap to confirm.

Curve construction helpers. setPointAt / setSmoothPointAt / setPointBezierAt place
points (a `counter` lets you pass "next" for auto point numbering); setPointsEllipse
/ ellipse / addEllipse, setPointsImg, setPointsLines and setPointsSVG (SVG path
strings), setPointsTxt (render text as a curve shape), setSnapPoints. plot(nPts, fX,
fY, fZ, ...) and plotPolar(nPts, fTheta, fR, fPhi, ...) sample parametric functions
into points — this is how the big Fractal / Rosette / Shape scores generate geometry,
and a strong candidate idiom for the GeosonixV2 construction API.

Colour is richer than GXW today: per-state setColorActive / setColorInactive /
setColorActiveCurve / setColorInactiveCurve (object on a curve beat point), each with
Hue and 0..1-normalized (01) variants, plus registerColor / registerColorHue named
colours. GXW currently has a single colour plus variability; the per-state model is
a reference, probably not all needed.

Direct ancestors of GXW's new inspector fields: setTimeLag / setTimeLagMultiplier /
setTimeLagNoteTicks (Time Lag multiplier + unit ticks — matches the new
timeLagMultiplier / timeLagInterval fields), setStopCycle (matches stopAtCycle),
setSpeedMultiplier (cursor speed as a factor of master, setSpeed deprecated),
setTriggerSync, setBeatEmphasis (per-beat velocity scaling = the Beat Strength
string), setBeatPoints / setActiveBeats.

MIDI: setMidiPort / setMidiNote / setMidiController / setMidiChannel configure an
object; output is midi.note(port, channel, note, vel, dur) (defined in the app, not
this library). Input arrives via onMessage; the library header sketches an
oscCallbacks dictionary pattern routing OSC addresses to handler functions.

Lifecycle hooks (engine-called, defined by the user script): onTick(time) — every
tick, the "run" section ancestor; onRewind() — on rewind, used to (re)seed and build
state; onPlay() — on play; onMessage(...) — on each external MIDI/OSC message. The
library's mover class + initMotion / updateMotion show the canonical pattern:
onRewind builds movers, onTick calls updateMotion, and each mover steers an object
from its pixel colour (_obj.r/.g/.b) with reflection off _score.backgroundSize —
i.e. GXW's image-colour-driven sprite steering, already idiomatic in GeoSonix.

Randomness: random(low, high), seeded _rnd via Math.seed, randomChoose(probs,
values). Math/utility globals (Processing lineage): PI, TWO_PI, HALF_PI, QUARTER_PI,
etc., and bare sin/cos/tan/abs/floor/round/sqrt/sq/pow/min/max/etc., plus constrain,
dist, norm, range, rangeMid, map, lookup, rangeLookup, tripleLookup, nearestInList,
reverse, invert, mapList, Counter. Scene/score utility: clear(), clearSelection(),
newScore(), remove(id), select(filter), autoSize(fixed), monitor(...) (log),
ask(category, label, variable, default) (a UI prompt), title(...).

Deprecations worth noting so we don't resurrect them: mapToHarmony (use mapScale /
mapChord), setResize (renamed setCurveSize), setSpeed (use setSpeedMultiplier),
setSpeedF (use setSpeedMultiplierRT), getProperty / getObjects / sendMessage
(replaced by _obj/_score property access and midi.note).
