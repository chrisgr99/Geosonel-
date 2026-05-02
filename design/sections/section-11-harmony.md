## Section 11 — Harmony Framework

GXW inherits GeoSonix's two-level harmony model. The score has global harmonic parameters and each object can inherit these from the score or override them individually.

Score-level parameters, set in setup():
- tonic(name): the piece's tonic center (e.g. "C").
- scale(name): the piece's scale (e.g. "Major", "D minor", "Dorian").
- root(name): root note for the active chord, often identical to tonic but separable.
- chord(name): the piece's current chord ("Major", "m7", etc.).
- range(semitones): the number of semitones spanned by the output range.
- rangeLow(midi): the lowest MIDI note in the output range.
- mapNotesTo("Score" | "Scale" | "Chord" | "None"): the final mapping target.

Object-level overrides. Each object has the same parameters, defaulting to "inherit from score". Inheritance is the common case; per-object overrides let one curve play in D dorian while the rest of the piece stays in C major without rewriting the score. The override model is uniform across curves, triggers, and sprites — any object can override any parameter.

Map-notes-to target. Controls the final pitch mapping:
- "Score" — use the current effective scale and chord from the object's point of view (considering overrides).
- "Scale" — map notes to the active scale only, ignoring chord.
- "Chord" — map notes to chord tones only (typically one to four notes per octave).
- "None" — no mapping; notes are emitted as-is from the function.

Helper functions in message-function bodies consult these parameters. `scaleMap(value, { scale: ctx.scale, root: ctx.root })` maps a 0-1 input value into a note within the currently effective scale. `chordMap(index, { chord: ctx.chord })` returns the indexed chord tone. These helpers read from the context (which carries the current effective harmony for the firing object) rather than from score-level globals, so per-object overrides are automatically respected. The harmony-framework vocabulary, including the named scales and chords accepted by these fields, will broaden substantially when Tonal becomes the underlying theory engine; see Section 27.
