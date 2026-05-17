## Section 11 — Score Orchestration and Harmony

This section covers two intertwined topics. The first is score orchestration: the mechanism by which score-level events — form changes, transport resets, mutation, harmonic context changes — are scheduled in musical time and dispatched to the objects they affect. The second is harmony: how the score's tonal context (tonic, scale, chord, root) evolves over a piece and how per-object patterns consume it. The two are presented together because the design has been worked out in conversation rather than in implementation, the conductor mechanism is the means by which harmonic changes are scheduled, and splitting them prematurely would obscure how they relate. If harmony grows enough specification to deserve its own section, it can be lifted out into an 11.5 sub-section later.

The mechanism is built on three pieces working together: a new pattern wrapper called `conductor()` parallel to `note()` and `sound()`, a per-object role field that labels each object's functional category in the score, and a small extensible vocabulary of command tokens that target objects by role. A score may carry any number of conductor curves running in parallel, each handling its own concern — one for form, one for harmony, one for mutation, others for project-specific schedules.

Everything in this section is subject to prototyping. The design has been worked out in conversation with enough detail to guide a first implementation, but it is provisional in a way that the rest of the design doc is not. The right starting point is the smallest possible prototype — perhaps a single conductor curve issuing rewind commands to a single voice — built end-to-end through the existing pattern engine and dispatcher, with the richer pieces added as composer experience reveals them to be needed. Several of the details specified below may turn out to be unnecessary, awkward in practice, or to need shapes that have not been anticipated. Working with a small prototype is the cheapest way to find out which details actually matter and which are noise.

### Conductor patterns

A conductor pattern is a Strudel pattern whose value tokens are commands rather than notes or sounds. It is authored with the `conductor()` wrapper, alongside the existing `note()` and `sound()` wrappers that Pattern Language (Section 10) describes. Inside the wrapper, mini-notation behaves the same way it does for note patterns: subdivisions, repetition, rests, parallel layers, and the curated modifier vocabulary all work, but each non-rest event resolves to a command-token value rather than a note value. The Pattern Engine (Section 12) routes events from `conductor()` patterns to a command dispatcher rather than to MIDI or audio.

The conductor wrapper is the sole syntactic marker. There is no flag on the curve or other object that identifies a pattern as a conductor pattern; the wrapper carries that information at the pattern level, and the dispatcher decides routing by inspecting the parsed pattern's outer wrapper. This keeps the data model unchanged — the cyclePattern field on a curve holds a Strudel pattern as before — and lets the editor offer wrapper-specific autocomplete: command tokens and known roles inside `conductor(...)`, the existing mini-notation note vocabulary inside `note(...)`. The wrapper-driven mode switch is automatic; the composer never has to mode-toggle their thinking between conductor and note editing.

Multiple conductor curves can run in parallel, each on its own beatsPerCycle. A typical score might have a form conductor cycling every 28 beats, a harmony conductor cycling every 16 beats, and a mutation conductor cycling every 64 beats, with their effects coexisting through whatever schedule each happens to encode. Each is a regular curve in the scene with its own cyclePattern wrapped in `conductor()`.

### Roles

Every object — curve, sprite, trigger — carries a string field called `role` that labels its functional category in the score. Examples a composer might use: `M1`, `M2` for melody voices, `R1`, `R2` for rhythm voices, `B` for bass, `Pad`, `FX1`. The field defaults to empty; an object with no role is uncategorised and not addressable by conductor commands.

The role field is authored in the property inspector via a dropdown with autocomplete: typing into the field filters against role values already used elsewhere in the score, picking from the dropdown selects an existing role, and typing a new value coins a new role for the score. This keeps the vocabulary small and discoverable without locking it to a fixed enumeration, since different scores will want different role sets.

Roles enable group addressing: a conductor command can target all objects in a role by naming the role rather than naming individual objects. A pattern step like `R_M1` rewinds every object with role `M1`, regardless of how many such objects exist. Composers think in sections — the strings, the lead instruments, the rhythm section — and roles let conductor patterns address those sections directly.

A roles panel — a small sidebar or tab listing the roles used in the score, which objects belong to each, and which conductors address each — is wanted as a discoverability aid once scores grow past a handful of voices. It is purely a visualisation over existing data, not a model addition; specifics are deferred to Section 13.

### Command vocabulary

Commands are short tokens of letters, numbers, and separator characters. The vocabulary has two shapes.

Bare tokens are verbs that apply globally. `R` rewinds everything addressable, `M` mutates everything addressable, `RM` rewinds and mutates everything addressable. Chord-change tokens are also bare and apply to the score's tonal context as a whole: `Am`, `F`, `G`, `C`, `Dm`, and so on, with whatever chord-name vocabulary @strudel/tonal accepts. A bare `.` is a rest — no command at that step, the cursor passes through with no effect.

Targeted tokens are verb-plus-separator-plus-role, addressing a specific role: `R_M1` rewinds Melody1, `M_R2` mutates Rhythm2, `RM_M1` rewinds and mutates Melody1. The separator (underscore or period — `R_M1` or `R.M1`, syntax to be confirmed against the mini-notation parser) avoids ambiguity between multi-letter verbs and multi-character role names: without a separator, `RM1` could parse as verb-R-role-M1 or verb-RM-role-1, and the separator makes the split explicit.

Unknown tokens emit a soft warning in the pattern editor — the same yellow-squiggle channel that flags context-inappropriate modifiers in note patterns (see Section 10). The composer can commit a warned pattern; the engine will simply do nothing for the unrecognised token at firing time.

The vocabulary is composer-extensible. behaviors.js carries a registry of command definitions; calling `defineCommand("Drop", () => muteAll("drums"))` registers a token that any conductor curve in the score can use. This mirrors how composers already define helper functions for hasHit, beenHit, and onTick (see Section 9). The built-in core covers rewind, mutate, the chord-name namespace, and, subject to confirmation, solo. Project-specific tokens layer on top.

### Conductor curves and visualisation

A conductor curve is any curve whose cyclePattern is wrapped in `conductor()`. No flag, no special object kind, no inspector mode switch. The wrapper is the marker.

By convention, conductor curves are drawn as straight horizontal lines positioned near the bottom of the canvas, where the image content they pass over is typically empty or unimportant for the music. Multiple conductors stack as parallel lines at slightly different y positions, each handling its own concern — form on the lowest line, harmony just above, mutation events above that, with the canvas's note-bearing curves filling the rest of the image. The line shape is a stylistic convention rather than a structural requirement; a composer could in principle wrap any curve shape in `conductor()`, but the flat-line layout makes the conductor's pattern readable as a timeline.

The visualisation reuses the curve apparatus described in Section 13.5. Markers render at fractional positions along the line via the existing marker-rendering code; the cursor sweeps left-to-right once per cycle and wraps to the left end on each new cycle. Two small additions distinguish conductor markers from note markers: a different glyph (specifics to be decided — possibly an upward-pointing triangle or a coloured tick) and a small text label above each marker showing the command token (`R`, `RM`, `Am`, `R_M1`). The label rendering is the only piece of the visualisation that does not already exist; the geometry, markers, and cursor are unchanged.

### Self-exemption and opt-out

Two rules govern which objects a conductor command reaches.

A conductor curve — any object whose cyclePattern is wrapped in `conductor()` — is automatically exempt from all conductor commands, regardless of which conductor issued them. This prevents feedback: a rewind command that rewinds the issuing conductor mid-pattern would restart it from its first step and produce nonsensical behaviour. The exemption is derived from the pattern wrapper at parse time and cached on the curve, so the dispatcher pays no per-command cost. Conductors may still carry roles for organisational labelling — a composer might tag a form conductor with role `Form` and a harmony conductor with role `Harmony` for readability — but those roles are not reachable from commands. The role field is greyed in the inspector when a curve's pattern is `conductor()`-wrapped.

A non-conductor voice opts out of conductor influence by carrying a role that no conductor in the score addresses. There is no separate "independent" or "uncontrolled" flag; the absence of a matching token in the score's conductor patterns is the opt-out. This makes the data model smaller and the behaviour transparent: a composer can read each conductor's pattern and see exactly which objects it reaches. A drum loop tagged with role `Drone` that no conductor names is effectively free-running.

### Form orchestration

A piece's form — verses, choruses, bridges, sections — is expressed by a dedicated form conductor whose pattern names the voice that plays at each step. The preferred semantics for the form-gating verb (subject to confirmation, see Open Questions) is solo: a token `S_M1` unmutes all objects tagged `M1` and mutes all other voice-bearing roles for as long as that state persists. The state holds until a different solo command fires, so a sequence of repeated `S_M1` tokens leaves M1 soloed without flicker.

An AAABBBC form across three melody voices reads as `conductor("S_M1*3 S_M2*3 S_M3")` — three steps of soloing Melody1, three of Melody2, one of Melody3, with Strudel's `*` repetition operator compressing the runs. If the form conductor's beatsPerCycle is 28 and each voice has a 4-beat inner cycle, the form completes one full AAABBBC every 28 beats and repeats. More complex forms use the full mini-notation vocabulary: `S_M1*3 S_M2*3 S_M3` for AAABBBC, `<S_M1 S_M2>` for alternation across cycles, Euclidean distributions `"S_M1".euclid(3, 8)` for irregular rhythmic placements, and so on.

The mute state mutated by the conductor is the same mute state described in Section 12 and elsewhere — the dispatcher writes through to the normal mute mechanism, not a parallel one. This means inspector edits to mute state coexist with conductor-driven mute changes; the last write wins. A composer who manually mutes a soloed voice mid-performance can do so, and the next solo command will revert the change.

The alternative to solo semantics is unmute-current-leave-others, where each token unmutes its role without touching others and the composer balances mutes manually elsewhere. This is less compact in form patterns but gives the composer finer control. The choice between them is recorded as an open question.

### Harmony

Chord changes are emitted by a dedicated harmony conductor whose pattern is a sequence of chord-name tokens interspersed with rests: `conductor("Am . . F . . G . C .")`. When the conductor's cursor passes a chord token, the score's tonal context updates to that chord — concretely, the scene-level `chordName` field (and possibly `root`) is rewritten — and any per-object pattern that reads the live tonal context through @strudel/tonal modifiers or through the harmony-context dynamic signals `currentChord`, `currentScale`, `currentTonic`, and `currentRoot` (see Section 10) picks up the new value on subsequent firings.

The score's existing harmony schema (the `SCENE_FIELDS` for `tonic`, `scaleName`, `root`, `chordName`, `range`, `rangeLow`, `mapNotesTo`, and the per-object `HARMONY_OVERRIDE_FIELDS` mirror) remains the data shape for the tonal context. The conductor mechanism is the means by which these fields evolve over time; the data they hold is unchanged. Per-object overrides still apply with the same inherit-or-override semantics they were designed for: an object that has set its own chord override ignores the score-level chord change, and an object with all overrides null inherits from the score.

The originally planned direction for harmony, captured in the previous version of this section, was a GeoSonix-derived two-level inherit-or-override model integrated with @strudel/tonal, with helpers like `scaleMap` and `chordMap` mapping abstract values into concrete pitches. The relationship between that direction and the conductor-driven chord-change mechanism described here needs careful thought before implementation. The two are not obviously incompatible: @strudel/tonal modifiers and `scaleMap`/`chordMap` helpers can read the score's current tonal state regardless of how that state is set, and the conductor-driven changes simply provide a means of updating that state over musical time. But the design space — what tokens the harmony conductor's vocabulary should support beyond chord names (transpose, scale change, voicing change), how progression libraries from @strudel/tonal might be used to populate longer harmony patterns, how per-object overrides interact with conductor-driven score-level changes — has not been worked through.

### Open questions

Several aspects of the orchestration design are explicitly under-specified and need further design before implementation.

Mutate semantics. The `M` verb is currently a placeholder. What exactly does a mutation event do to a targeted voice? A working sketch is that each voice carries a per-voice mutation rule — possibly a small displacement vector, possibly something richer — and the `M` command applies that rule to the voice. The mutation rule's data shape (single vector, rotation, scale, custom function), whether mutations accumulate or reset, and whether there is a default mutation that applies when no rule is configured, are all to be decided.

Solo confirmation. The form-gating verb's semantics is recorded as solo by working preference (the token unmutes its role and mutes all other voice-bearing roles). The alternative — unmute-current-leave-others — is also viable and gives composers finer control at the cost of more authoring. The choice should be confirmed against concrete authoring scenarios before implementation.

Relationship to the previously planned harmony direction. The GeoSonix-derived `scaleMap`/`chordMap` helpers and the @strudel/tonal integration described in the previous version of this section need to be re-examined against the conductor-driven chord-change mechanism. The two may fold together cleanly, one may supersede the other, or a hybrid may emerge. The decision affects what the harmony conductor's command vocabulary should look like beyond chord names.

Command separator syntax. Targeted command tokens use a separator between verb and role (`R_M1` versus `R.M1` versus another character). The choice depends on what reads cleanly to the composer and what survives Strudel's mini-notation parser without conflict. Decision deferred until the dispatcher is being implemented.

Conductor marker glyph and label rendering. The marker glyph for conductor events is to be distinct from the note-event diamond; specifics (shape, colour) are deferred. Label rendering for command tokens above markers — wrap, truncate, or rotate vertically for long tokens like `setTempo120` — is also deferred.

Composer-extensible vocabulary API. The `defineCommand` mechanism is sketched but the exact API (signature, parameter passing, integration with the parser and dispatcher) needs detail.

Self-exemption when conductor patterns include unresolved tokens. If a token in a `conductor(...)` pattern fails to resolve as a command, does the dispatcher fall back to note interpretation, or treat the token as a no-op with a soft warning? The simpler rule is no fallback — the wrapper is authoritative and unrecognised tokens warn — but the choice should be confirmed.

These open questions are tracked in this section rather than in TODO.md until they are resolved; they are pre-implementable design work, not pending implementation items.
