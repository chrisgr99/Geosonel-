## Section 30 — Composer Helper Library

This section captures the in-progress design of a composer helper library for GXW and the authoring idioms that support it. The library covers signal-transform helpers, scale and chord helpers in both declarative pattern-returning and procedural single-value forms, MIDI note emission with voice management, the callback context shape used by procedural helpers, and the editor affordances that support all of the above. The design is iterating in this section while it stabilizes. As individual pieces settle and implementations land, the canonical documentation for each piece migrates to its natural section: Section 9 (Behaviour Slots and behaviors.js) for the callback API, Section 11 (Score Orchestration and Harmony) for harmony, Section 19 (Audio and MIDI Output) for MIDI output and voice management, Section 28 (Pattern Authoring and the Cursor Model) for editor affordances. This section also accumulates worked examples and eventually condenses to a recipes collection or becomes a forwarding stub once the design is fully absorbed, following the model used by Section 28 after the v2.5 fold-back pass.

Status. The only piece of this section's design that has shipped is the mapClip transform helper plus the MIDISender fix to accept numeric MIDI notes (commit 1 of the in-flight signal-range-control series). Everything else in this section is design-in-progress: shapes agreed in conversation but not yet implemented. Open design questions are flagged in the Future Scope subsection at the end rather than scattered through the body.

### The options-object pattern

Every helper in the library takes its parameters as a single options object, a JavaScript object literal whose fields are named, rather than as a sequence of positional arguments. The pattern serves three purposes.

Usability. Named fields make intent legible at the use site. A call like `scaleNotes({sig: pxLt, baseNote: 60, octaves: 2, scale: "A minor", rhythm: "1 1 1 1"})` reads as a sentence in which each value is labeled. The alternative positional form `scaleNotes(pxLt, 0.4, 0.6, 60, 2, "A minor", "1 1 1 1")` requires the reader to know what each position means. Named fields also remove a class of bugs from accidental parameter swapping.

Intent grouping. The options object is not just a bag of fields; it is a semantic unit. A harmony object says "this is the tonal context." A voice object says "this is the voice configuration." A rhythm object says "this is the rhythmic frame." A function taking a harmony or voice object communicates the category of its argument at a glance, separate from the specific values inside.

Composition with base-plus-overrides. Score-level constants can be defined once and reused with per-use overrides via the spread idiom:

```
const scoreHarmony = {
  key: "C major",
  baseNote: 60,
  octaves: 2,
  scale: "major",
  progression: "I V vi [I IV]"
};

$CRV1: scaleNotes({...scoreHarmony, sig: pxLt, inLo: 0.4, inHi: 0.6, rhythm: "1 1 1 1"})

$CRV2: scaleNotes({...scoreHarmony, sig: pxChr, baseNote: 36, octaves: 1, rhythm: "1 ~ 1 ~"})
```

The two voices share the same key, scale, and progression; each adds its own signal binding and overrides whichever fields differ. Changing `scoreHarmony.key` from `"C major"` to `"A minor"` updates both voices on the next cycle. The same harmony object is also consumed by procedural helpers (see Callback Context Shape below) so callbacks fire chord-aware notes against the same harmony as the declarative voices.

### Modulatable parameters

A complete musical phrase carries more than just notes. Velocity, duration, pan, gain, filter cutoff, attack, release, and any number of other parameters give the phrase its character, and each may be either a literal value or a value derived from the instantaneous state of a signal (a sampled pixel color, an object's velocity, the current beat-emphasis multiplier, and so on). The library accepts both shapes through a single dual-shape reading rule: a number is a literal; an object with a `sig` field is a mapping spec.

A mapping spec is a small options object naming the source signal, the clip range from the signal, and the output range:

```
{sig: pxChr, inLo: 0, inHi: 1, outLo: 40, outHi: 127}
```

When a helper encounters a parameter shaped this way, it clips the source signal's current value to [inLo, inHi], linearly remaps it to [outLo, outHi], and uses the result. When it encounters a number instead, it uses the number directly. The same field can carry either form, switched freely depending on whether that parameter should be static or signal-driven for a given phrase.

The full options object for a phrase combines pitch parameters (which use the baseNote-plus-octaves form because pitch is musically range-bounded by scale) with modulatable scalar parameters (velocity, duration, pan, gain, and so on, each of which is either a number or a mapping spec):

```
const phrase1 = {
  sig: pxLt,
  inLo: 0.4,
  inHi: 0.6,
  baseNote: 60,
  octaves: 2,
  scale: "A minor",
  rhythm: "1 1 1 1",
  velocity: {sig: pxChr, inLo: 0, inHi: 1, outLo: 40, outHi: 127},
  duration: {sig: pxR, inLo: 0, inHi: 1, outLo: 100, outHi: 1000}
};
```

The same phrase with literal velocity and duration:

```
const phrase2 = {
  sig: pxLt,
  inLo: 0.4,
  inHi: 0.6,
  baseNote: 60,
  octaves: 2,
  scale: "A minor",
  rhythm: "1 1 1 1",
  velocity: 96,
  duration: 500
};
```

The pattern extends to any modulatable parameter the destination accepts. The helper walks known fields, resolves each to a numeric value through the literal or mapping path, and assembles the final note event. New parameters can be added without disturbing existing ones, and the same options object passes through scaleNotes, chordNotes, scaleNote, chordNote, and midiNote unchanged.

The signal vocabulary grows alongside this. Image colors (pxLt, pxChr, pxR, pxG, pxY, pxB, pxOr, pxLi, pxCy, pxPu) are the shipped set. Natural additions for the modulation use case are physics signals for sprites (spriteV is already mentioned in Section 9 as planned, with spriteVx, spriteVy, and spriteSpeed as plausible expansions), cursor signals for curves (cursorSpeed, cursorPhase), beat emphasis (currentBeatEmphasis exposing the active beat-emphasis multiplier from the curve's beat-emphasis pattern), and similar instantaneous state values. Each becomes a strudel signal Pattern by the same convention as the px signals, so it composes with the mapping spec at no additional cost.

A frequently-used mapping spec can be named and reused. Since it is itself a plain options object, the spread idiom and named-constant assignment work the same way they do for scoreHarmony:

```
const velocityFromChroma = {sig: pxChr, inLo: 0, inHi: 1, outLo: 40, outHi: 127};

const phrase3 = {
  ...phrase2,
  velocity: velocityFromChroma
};
```

This lets a score define a small palette of named modulation specs at its top and reference them across all its voices. Changing velocityFromChroma's outHi from 127 to 100 ducks the velocity range for every voice that references it with one field edit.

The same dual-shape reading rule applies in procedural callbacks. scaleNote and chordNote read the same options object and resolve each modulatable parameter at call time: literals stay literal, mapping specs get evaluated against the current values of their referenced signals. The procedural midiNote helper consumes velocity, duration, and any other modulatable fields this way as well, so a single options object built once at the top of behaviors.js can drive both declarative pattern lines and procedural callback emissions with full parameter consistency.

### Signal-transform helpers

A family of small helpers takes a strudel signal Pattern as input, applies a transform, and returns a new signal Pattern that composes with everything strudel and GXW already understand. The first member is mapClip, shipped in commit 1; the rest are proposed.

mapClip(sig, inLo, inHi, outLo, outHi) [SHIPPED] clamps the source signal to [inLo, inHi] and linearly remaps that band onto [outLo, outHi]. Values at or below inLo produce outLo; at or above inHi produce outHi. The clip behaviour means an unexpectedly bright or dark pixel cannot blow past the intended output range. Built as a strudel signal(fn) Pattern that re-queries the source pattern at each query and applies the math, which keeps it independent of which Pattern-method transforms the loaded strudel build exposes. Edge cases: inLo equal to inHi returns the midpoint of outLo and outHi rather than dividing by zero; a non-numeric or absent source value falls back to 0, which after clipping produces outLo.

rangeMid(sig, low, mid, high) is a piecewise linear remap that anchors a midpoint. Values from 0 to 0.5 in the source map proportionally to [low, mid]; values from 0.5 to 1.0 map proportionally to [mid, high]. Useful when one end of the input range deserves finer output resolution than the other.

bucket(sig, thresholds) assigns discrete output values based on threshold bands in the input. Each input range maps to a single output value, with the last value used when the input exceeds all thresholds. Useful for patterns like "if pxLt below 0.3 fire bass, 0.3 to 0.7 fire mid, above 0.7 fire treble."

mapList(sig, lo, hi, list) proportionally maps the input range to indices in a list, returning the list entry at the computed index. Allows mapping a signal into an enumerated set of values without requiring those values to be numerically close to the signal.

quantize(sig, list) snaps the signal to the nearest value in a custom list. The list values must be numerically comparable to the signal; the function finds the nearest entry by absolute distance.

apply(sig, fn) applies an arbitrary unary function to each value emitted by the source signal, producing a new signal whose values are the function's outputs. Allows user-defined transforms (logarithm, exponential, polynomial, custom waveshape, anything) to become first-class signal Patterns.

combine(sig1, sig2, fn) applies an arbitrary binary function to pairs of values from two source signals. Useful for sum, product, difference, conditional blends, and any other two-signal combination.

Strudel itself likely has a native `.fmap(fn)` Pattern method that does the work of apply, and native arithmetic methods (`.add`, `.mul`, `.sub`, `.div`) that overlap with combine. If those methods compose cleanly with the dynamic signal() Patterns the GXW px signals use, they are the more idiomatic form. The standalone helpers above are the reliable fallback: they work regardless of which Pattern methods are exposed because they re-query the source signal directly via queryArc. The exact mix of native and standalone helpers that ends up in the library is to be settled empirically once strudel's Pattern-method behaviour with dynamic signals is verified.

### Declarative scale and chord helpers

The next layer takes signal-transformed values and snaps them to musically meaningful pitches, then wraps the result in a strudel pattern ready for the note() output.

scaleNotes(opts) returns a strudel Pattern ready for note() that fires pitches snapped to a scale. Its opts object carries: sig (the source signal Pattern), inLo and inHi (the clip range from the signal), baseNote (lowest MIDI note in the output range), octaves (how many octaves above baseNote the output spans, fractional values allowed), scale (a string like "minor" or "A minor", a Tonal-recognised scale name, or a literal array of semitone offsets like [0, 2, 4, 5, 7, 9, 11]), and rhythm (a strudel mini-notation rhythmic structure).

```
$CRV2: scaleNotes({
  sig: pxLt,
  inLo: 0.4,
  inHi: 0.6,
  baseNote: 60,
  octaves: 2,
  scale: "A minor",
  rhythm: "1 1 1 1"
})
```

This fires four notes per cycle whose pitches are pxLt-driven, clipped from [0.4, 0.6], snapped to A minor scale tones in the range [60, 84] (two octaves above C4), with a four-equal-beats rhythm.

The scale field accepts either a string or an array. A bare scale type ("minor", "major", "dorian") uses baseNote as the tonic. A full key ("A minor", "F major") parses via Tonal and uses the parsed letter as the tonic. A literal array of semitone offsets bypasses Tonal entirely and uses baseNote as the tonic.

chordNotes(opts) is the chord-snapping sibling. Its opts object replaces the scale field with chord (a Roman numeral like "IV" or "V7" or "ii") and key (the tonal context like "C major" or "A minor"). The function resolves the Roman numeral against the key via Tonal's Progression.fromRomanNumerals to get the absolute chord name, then snaps the signal to that chord's notes:

```
$CRV3: chordNotes({
  sig: pxLt,
  inLo: 0.4,
  inHi: 0.6,
  baseNote: 60,
  octaves: 2,
  chord: "V7",
  key: "C major",
  rhythm: "1 1 1 1"
})
```

This fires four notes per cycle drawn from G7 (resolved from V7 in C major) across the two-octave range above C4.

Roman numerals carry their case convention: uppercase (I, IV, V, V7) for major-derived chords, lowercase (ii, iii, vi, ii7) for minor-derived, plus the extension vocabulary (7, maj7, m7, dim, sus) that Tonal accepts.

A note on internal representation. Tonal returns chord and scale notes as pitch class strings like "G" or "Bb", which are convenient for human-readable display but useless for arithmetic. The helpers convert pitch classes to semitone offsets internally (G to 7, B to 11, and so on), project them across the [baseNote, baseNote + octaves * 12] range to build an extended MIDI integer list, snap the signal to the nearest entry of that list, and emit MIDI integers. Note name strings never leave the helper. The output stream is plain MIDI integers from then on, ready for MIDISender (which accepts numeric notes since commit 1).

### Score harmony and chord progressions

Score-level harmony is expressed as a JavaScript constant at the top of behaviors.js. The constant is a plain options object containing the score-wide tonal context:

```
const scoreHarmony = {
  key: "C major",
  baseNote: 60,
  octaves: 2,
  scale: "major",
  progression: "I V vi [I IV]"
};
```

All voices and procedural callbacks that read this object share the same key, scale, and chord progression. The spread idiom adds per-voice fields without disturbing the shared ones, as shown in The Options-Object Pattern subsection above.

The progression field expresses a sequence of chord changes as a strudel mini-notation string of Roman numerals. Each top-level token represents one measure of the progression's cycle; sub-tokens grouped in brackets split a measure into shorter chord changes. So "I V vi [I IV]" is a four-measure progression where the first three measures hold I, V, and vi respectively, and the fourth measure splits into I for the first two beats and IV for the last two. The full mini-notation vocabulary applies: "*2" repeats the previous token in the same time slot, "." rests, "<I IV>" alternates across cycles, and so on.

As score time advances, the progression's active chord changes according to its cycle. Helpers that consume scoreHarmony look up the active chord at each event time and snap pitches to whichever chord is current at that moment. A scaleNotes voice running against scoreHarmony with rhythm "1 1 1 1" therefore plays four notes per measure, with each note's pitch snapped to the chord active in the measure the note fires in. The fourth measure of the example progression above plays two C-major-snapped notes followed by two F-major-snapped notes.

This integrates conceptually with the harmony conductor mechanism in Section 11. The progression string is the same idea as a `conductor("Am F G C")` pattern, except expressed in Roman numerals against the key (so transposing the score is one field edit) and stored inline in the harmony object (so all the harmony information is in one place). The two forms are not mutually exclusive: a score may use the inline form for simple progressions and a conductor curve for richer score orchestration, or use a conductor curve as the visible canvas representation of the progression while the inline form remains as a JavaScript-only backup. The exact division of labour and the integration mechanism between the inline form and the conductor mechanism is an open question recorded in the Future Scope subsection.

### Procedural scale and chord helpers

For callback slots like onBeat or onSpriteHit (described in Section 9), the library provides single-value siblings of scaleNotes and chordNotes.

scaleNote(value, opts) takes a numeric value and the same options object the declarative scaleNotes takes (sig and rhythm fields are ignored in this form), and returns a single MIDI integer. The value is clipped to [opts.inLo, opts.inHi], remapped to the [opts.baseNote, opts.baseNote + opts.octaves * 12] range, and snapped to the scale defined by opts.scale.

chordNote(value, opts) is the chord-snapping counterpart, returning a single MIDI integer snapped to the active chord (which may come from opts.chord directly or from the active step of opts.progression at the current score time).

```
function onSpriteHit() {
  const note = scaleNote(this.cursor.pxLt, scoreHarmony);
  midiNote({
    port: 0,
    channel: 1,
    note: note,
    velocity: 64 * this.cursor.speedMultiplier,
    duration: 500,
    minDuration: 200,
    voice: "groupMono",
    group: this.group
  });
}
```

The procedural form sharing the options-object shape with the declarative form means an author defines scoreHarmony once at the top of behaviors.js and uses it from both labelled-pattern lines (declarative) and callback functions (procedural) with consistent behaviour. The convention is plural for the Pattern-returning declarative form (scaleNotes, chordNotes) and singular for the single-value procedural form (scaleNote, chordNote).

### MIDI note emission with voice management

GeoSonix's midi.note function carried two unique behaviours beyond raw MIDI note-on/note-off that significantly improved musical results: a minimum-duration suppression gate and a voice-mode system with group scoping. GXW's procedural midiNote helper carries the same capabilities, expressed through the options-object pattern.

```
midiNote({
  port: 0,
  channel: 1,
  note: 64,
  velocity: 96,
  duration: 500,
  minDuration: 1000,
  voice: "groupMono",
  group: "lead"
})
```

minDuration is a suppression gate. If a new note request comes in within minDuration milliseconds of the previous note request on the same scoping unit, the new request is dropped and the previous note holds. This prevents signal-driven note generation from stuttering when dense beat patterns cross regions of rapidly varying signal: a 2000-millisecond minDuration on a curve with eight beats per cycle means at most one note fires every two seconds even if all eight beats land in that window. The behaviour belongs at the routing layer rather than at the pattern layer because it is a property of the destination voice (how often it should re-articulate) rather than of the source pattern (how often events arrive).

Voice modes determine how concurrent notes interact. The vocabulary covers four modes. The "none" mode is the default and applies no voice management; notes overlap freely. The "objectMono" mode permits one note at a time per object; a new note on this object cuts off the previous note from this same object. The "groupMono" mode permits one note at a time across all objects sharing the same group tag; a new note on any object in the group cuts off whatever was previously sounding from any object in the group. The "scoreMono" mode permits one note at a time across the entire score, regardless of group.

The group field is a string tag attached to a curve, sprite, or trigger. Objects with the same group string share groupMono scoping. The group field is authored in the property inspector and persisted in scene.json. Objects without a group string are not part of any group-mono scope.

Internally a voice-state tracker module maintains an active-notes map indexed by (port, channel, voice mode, group). Each midiNote call consults the map: it either fires the note and records the active state, or recognises that an existing active note prevents this one (under the relevant voice mode) and decides between waiting, cutting the previous note, or suppressing the new one. The decision rules per mode are: objectMono, groupMono, and scoreMono all cut off the previous active note in their respective scopes; minDuration acts orthogonally as a per-source suppression gate that drops requests too soon after the source's last successful request.

The combination of voice modes and minDuration produces musical phrasing that raw MIDI cannot. groupMono alone gives no overlap within a group; minDuration alone gives phrase pacing for any one source; together they produce deliberate monophonic phrasing with held notes and intentional silence between phrases. The GeoSonix tutorial that motivated this design (curveMessage / curveMessage2 / curveMessage3 with minDurations of 0, 2000, and 1000 milliseconds and groupMono voicing) demonstrates the effect: three curves all firing into the same group produce a single deliberate melodic line whose voice changes among the three sources rather than a polyphonic pileup.

### Callback context shape

Callbacks in behaviors.js fire with a `this` binding to the object whose callback is executing and with additional cross-references that let the callback read state from related objects. The convention follows the model GeoSonix used and generalises cleanly to GXW's curve-plus-sprite-plus-trigger object model.

For curve callbacks (onTick, onBeat, onSnapshot), `this` is the curve. The cursor's current position, current beat-emphasis multiplier, current pattern phase, and similar live state are read off `this`. Color samples beneath the cursor are available as direct accessors mirroring the px signal vocabulary: `this.pxLt`, `this.pxR`, `this.pxChr`, and so on, returning the current sampled value at the cursor's position. The shorter-form `this.r`, `this.g`, `this.b` accessors (RGB at the cursor's position) are also exposed for ergonomic parity with GeoSonix scripts being ported.

For sprite callbacks (onCollide, onHit), `this` is the sprite, and `this.cursor` is a reference to the cursor of the curve that collided with the sprite at this moment. The sprite reads the cursor's state — its position, current speed multiplier, beat emphasis, sampled colors — and modulates its response accordingly. This is the cross-reference shape that lets a trigger know not just "I was hit" but "I was hit by this cursor moving this fast through this colour region." A sprite can fire different notes for fast-moving versus slow-moving cursors, or for cursors crossing dark versus light pixels, by reading the cursor's state at the moment of contact.

For trigger callbacks, the same pattern holds: `this` is the trigger, and additional fields like `this.cursor` (when the trigger is hit by a cursor) carry cross-reference data.

The "explicit value wins over computed default" idiom comes up frequently. A trigger might carry a fixed note property (set in the inspector) or fall back to a computed note (from harmony resolution against its position) when no fixed note is set. The convention is `this.note ? this.note : scaleNote(this.x, scoreHarmony)`: the conditional check makes the explicit-versus-computed distinction visible at the use site rather than hiding it inside the helper. Helpers in the library do not silently consult `this.someField`; the callback author explicitly passes whichever value they want.

### Editor affordances

Three editor-level features support the library's authoring style.

Snippet templates. The Code tab's autocomplete offers expandable snippets for the common options-object structures. Typing `scoreHarmony` followed by Tab, or `melody` followed by Tab, or `midiNote` followed by Tab, inserts a multi-line template with sensible defaults and tab-stops at each field the author typically wants to edit:

```
const ${1:scoreHarmony} = {
  key: ${2:"C major"},
  baseNote: ${3:60},
  octaves: ${4:2},
  scale: ${5:"major"},
  progression: ${6:"I V vi I"}
};
```

After the snippet expands, the cursor lands at the first tab-stop and tab moves to each subsequent one. The defaults are reasonable starting values; the author either accepts them by tabbing past or overwrites them by typing.

Code folding. CodeMirror's built-in JavaScript folding collapses object literals to a single-line summary so a long scoreHarmony definition (or a multi-voice melody definition) takes one line of vertical space when not actively being edited. The author opens behaviors.js, sees the harmony block at the top folded to one line, expands it when needed for editing, refolds it when done. This keeps long files readable.

Autocomplete. The Code tab's autocomplete completes both strudel surface names (note, sound, mini-notation tokens, .struct, .gain, and the rest) and the GXW helper library (scaleNotes, chordNotes, midiNote, mapClip, scoreHarmony, the px signals). Tonal scale and chord names autocomplete inside string-typed scale and chord fields once the cursor is positioned inside the literal. The autocomplete vocabulary is generated from the actual installed helpers rather than hand-maintained, so additions to the library appear in autocomplete automatically.

### The Score tab

The Score tab is a structured editing surface for the score's harmony, voices, and voice management, parallel to the Code, Properties, and Canvas tabs in the editor pane. It serves two related purposes. For users without an AI assistant integrated into their workflow (the default case, since GXW is free and AI integration is not part of the app), the Score tab is the primary surface for authoring score-level harmony and voice parameters. For users with AI access who edit primarily through natural-language instructions, the Score tab is also a structured reading surface that makes the current state of the score easy to scan and zoom into without reading raw JSON.

The tab renders as a sequence of clearly-labeled buckets. Each bucket is a visually distinct region with a header, generous internal spacing, and rows of labeled fields the eye can scan top-to-bottom. The intent is that a user can zoom in on a bucket and read its rows linearly to remind themselves of what is set there, without having to track positions across a dense form.

The bucket structure covers the score's authoring surface. A Score Harmony bucket holds the score-level fields: key, baseNote, octaves, scale, progression, with the progression rendering a live chord-name preview beneath the mini-notation string (so "I V vi [I IV]" shows "C G Am [C F]" alongside it in C major). A Voices section lists every sound-producing object in the score as its own bucket, with the voice's identifier at the top and the fields it carries as rows beneath. A Shared Mappings bucket lists named modulation specs defined at score scope (velocityFromChroma, durationFromR, and so on), each with its source signal and output range summarized. A Voice Management bucket shows groups and which voices belong to each, with their voice-mode summaries collected in one place. A Conductors bucket (or a separate Conductors tab in evolved versions) lists conductor curves and their patterns, distinct from the voices list because conductors produce score-orchestration events rather than notes.

Every object that produces sound has a bucket in the Voices section, but the bucket's editability depends on what drives the sound. A voice whose cyclePattern uses the helper library (scaleNotes or chordNotes with an options-object argument) gets a fully structured bucket with all helper-library fields editable in place. A voice whose cyclePattern is a raw strudel expression (anything using strudel's note(), sound(), or similar functions directly with method-chained modifiers, instead of unwrapping to a single helper-library call) gets a smaller bucket showing the expression as a one-line preview plus a jump link to the corresponding labelled-pattern block in the Code tab; the bucket is not field-editable. A voice that fires sound from a callback rather than a cyclePattern (a sprite with onCollide that calls midiNote, a trigger with beenHit that does the same) gets a bucket whose content depends on the callback: if the callback uses midiNote with an options-object argument, the bucket shows the midiNote options as form rows; if the callback is custom code beyond that pattern, the bucket shows a "Custom callback" label with a jump link to the callback function in behaviors.js.

Objects with no cyclePattern and no sound-producing callbacks do not appear in the voices list because they are not voices. A curve used only for visual structure, a sprite with only physics behaviour, a trigger wired to non-audio commands all sit outside the form.

The principle that resolves the question of which fields belong in the form: the form surfaces every field of the helper-library options object, and anything beyond that shape stays in the code tab. Adding a new helper to the library or a new field to an existing helper extends the form by the same mechanism. Removing a field shrinks the form. There is no per-field design judgment about which fields to surface; the architecture choice is made once at the helper-library level and every field follows.

For all users, the form is editable in place via the appropriate control per field type. Text inputs handle strings (rhythm, progression, scale name). Dropdowns handle enumerated values (voice mode, group selection from existing groups). Number inputs handle numerics (baseNote, octaves, velocity, duration, minDuration). The full Tonal scale and chord vocabulary autocompletes inside string-typed scale and chord fields. Validation runs as the user types: invalid Roman numerals, unknown scale names, malformed mini-notation all flag the field with a soft warning explaining what went wrong.

Modulatable parameters like velocity and duration get a two-form switch. A "Literal" mode shows a single number input; a "Signal-driven" mode expands into a sub-form with signal dropdown, inLo, inHi, outLo, outHi. A toggle switches between the modes, with the underlying JSON field shape switching between number and mapping-spec object accordingly. Collapsed by default with a one-line summary ("velocity: chroma to 40-110"), expanded on click for editing, so a bucket with several mapping specs does not become a wall of nested controls.

Within voice buckets with many fields (15 to 20 rows is typical for a fully-modulated voice), nested visual bands group related rows: Pitch fields cluster as one sub-section, velocity-and-duration as another, voice-management as a third. Each sub-section gets its own header so the eye finds the right cluster quickly during zoom-and-scan and only the specific row needs to be read carefully. Collapsing rarely-edited sub-sections by default, with the current value summarized in a single line, keeps the bucket compact while still exposing everything for editing when needed.

The underlying JSON in behaviors.js remains the source of truth. Two-way binding follows the same pattern the existing property inspector uses for per-object scene.json fields: form edits parse and write back to the in-code declaration; in-code edits re-read into the form. For users with AI access, AI changes flow through the same path. The AI edits the JSON in behaviors.js, and the form's next refresh shows the new state, indistinguishable from a user-typed change. For users without AI access, the form is their complete authoring surface for score-level harmony and voice parameters.

### Future scope and open questions

Several pieces of the library design are flagged for later resolution. Listed here rather than scattered through the body so the scope of pending work is visible in one place.

A runtime harmony-state concept. The score-level scoreHarmony JavaScript constant is effectively a static harmony state that callers explicitly read. A runtime harmony state, a property on the score (or on individual curves) that helpers read by default when their opts object omits the harmony fields, would let callbacks be even more compact. The trade-off is that hidden defaults are less legible at the use site, and the existing options-object pattern with spread overrides already covers most reuse cases. This idea is not adopted in the current design but is noted as a possible evolution.

Per-position color sampling in callback context. The current callback context exposes the firing source's own sampled color via `this.pxLt` and friends. An extension would expose `this.sample(x, y)` or `this.colorAt(x, y)` to read color at any canvas position. Useful for sprites that respond to nearby image content beyond the colliding cursor's position. Implementation requires hooking into the same image-sampling path the px signals already use; conceptually straightforward, deferred for now.

Beat-emphasis integration with the helper API. GeoSonix's `this.beat` exposed the current beat-emphasis multiplier (a value in [0, 1] derived from the curve's beat-emphasis pattern at the firing event) for callbacks to scale velocity or other parameters by emphasis. GXW has a beat-emphasis mechanism on curves; exposing it through the same `this.beat` accessor is straightforward but not yet wired. The midiNote velocity field is the obvious consumer.

Remaining GeoSonix toolkit ports. The full GeoSonix helper file contains additional helpers (rangeLookup, lookup, randomChoose, color-and-position math, parametric curve plotters, score-construction commands, the mover animation system). Most of these are either already covered by the helpers above, do not apply in the GXW context, or belong to different subsystems entirely. A focused port pass through the remaining helpers will identify which (if any) add value beyond what the current design covers.

Strudel native methods versus standalone helpers. The library's apply and combine helpers are standalone implementations that work regardless of which Pattern methods the loaded strudel build exposes. Strudel's native `.fmap(fn)`, `.add()`, `.mul()`, `.sub()`, and `.div()` methods likely cover the same use cases more idiomatically, but only if they compose cleanly with the dynamic signal() Patterns the GXW px signals use, which is not yet verified. Once a small empirical test confirms the native methods work, the documentation absorbs them and the standalone helpers become the fallback for cases where Pattern-method composition turns out to break.

MIDI CC namespace handling. The modulatable-parameter pattern accommodates well-known parameters like velocity, duration, pan, and gain through named fields. The open-ended MIDI CC namespace (controller numbers 0 through 127, with conventional assignments like CC 1 for modulation wheel, CC 7 for volume, CC 11 for expression, but with per-synth variation in less-common controllers) needs a design choice. Either name the well-known controllers (modulation, expression, breath, sustain) as top-level fields and have those resolve to the right CC number internally, or accept a generic pass-through form like `cc: {11: 64, 1: {sig: pxLt, inLo: 0, inHi: 1, outLo: 0, outHi: 127}}` that maps controller numbers directly to values or mapping specs. Probably both forms have a place: named fields for the well-known controllers, generic numbered form for the rest.

Relationship to the Section 11 harmony conductor. The inline progression field in scoreHarmony covers simple progressions stored as strings. The harmony conductor in Section 11 covers progressions as conductor() patterns on visible curves with canvas representation. Whether the two mechanisms unify (the inline form generates an invisible conductor internally, or the conductor curve form is the visual editor of the inline form), coexist as separate mechanisms, or one supersedes the other, is an open question. Both forms have value: inline for short stable progressions kept in one place, conductor curve for richer score orchestration with visual representation and interactive editing.
