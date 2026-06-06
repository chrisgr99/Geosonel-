# Inspector Field Audit

Working document for the v2.3 property inspector data-binding milestone. Walks every field rendered by the inspector v1 form (`src/inspector.js`) and classifies it against the existing scene schema (`src/sceneSchema.js`) and the design document. The output is a disposition table guiding which fields can be wired immediately, which need a small clean schema addition, and which require design discussion before binding can proceed.

This file is a working note, not a design statement. It will become irrelevant once the binding work is complete and is expected to be deleted at that point.

## Bucket definitions

Bucket 1 — the field maps to a schema property that already exists. Wire the read path directly; no schema change needed.

Bucket 2 — the field maps to a clean new property whose semantics are obvious. Add to schema and to the per-kind constructors with a sensible default; document the default; proceed.

Bucket 3 — the field has semantics or a model relationship that has not been pinned down. Capture the open question; defer wiring until the question is answered.

## Disposition table

| Field | Band | Bucket | Notes |
|---|---|---|---|
| Object ID | 1 | 1 | Schema has `id: string, default: null` on all three kinds. Generation logic for stable type-prefixed ids (sp_a3f7) and uniqueness checking needs adding alongside the binding work. |
| Name | 1 | 2 | New field across all three kinds. JS-identifier rule, soft-block on duplicates with rename suggestion, hard-block on syntax errors, names matching the id-format pattern reserved. |
| Enable | 1 | 2 | New boolean field per object, default true. Disabled objects render normally but do not fire events or run their step function. |
| Hide | 1 | 2 | New boolean field per object, default false. Hidden objects do not render but continue to fire and step normally. |
| Position X, Y | 2 | mixed | Sprites and triggers: Bucket 1 — `x`, `y` exist directly. Curves: Bucket 3 — curves position themselves through their `shape` sub-object's parameters (circle's cx/cy, line's endpoints, piste's point list). The inspector either shows a shape-derived centroid read-only for curves, or hides Position when the selection is curve-only. |
| Curve Size W, H | 2 | 3 | Curves' `shape` is opaque in the schema and W/H does not map uniformly across shape types: a circle has one radius, a line has two endpoints, a piste has a point list, a bezier has control points. Decision needed: expose a bounding-box readback derived from the shape, route W/H through a per-shape adapter, or replace this field with shape-specific fields chosen by shape type. |
| Curve Thickness | 2 | 2 | New number field per curve, default 1.0. Render-only — stroke width when the curve is drawn. |
| Cursor Size R, L | 2 | 1 | Schema has `cursorR` and `cursorL` on curves. Direct binding. |
| Cursor Thickness | 2 | 2 | New number field per curve, default 2.0. Render-only — stroke width for the cursor sweep segment. |
| Sprite Size | 2 | 1 | Schema has `displayDiameter` on sprites. Inspector label says "Sprite Size" while schema label says "Display Diameter"; align the label in one place or accept the wording divergence. |
| Trigger Size | 2 | 1 | Schema has `size` on triggers. Direct binding. |
| Color | 2 | 3 | No color field exists in the schema for any kind. Sprites are explicitly coloured at runtime from the image pixel underneath (Section 6 of design); adding a stored color contradicts that. Triggers currently render from payload-type defaults. Curves have no documented color convention. Decision needed: stored color override field per object with null default meaning "use the derived color"; or color is purely derived and the inspector shows it read-only with no edit affordance. |
| Step Function | 3 | 1 | Schema has `step: functionRef` on sprites. Direct binding. |
| Auto Function (sprite) | 3 | 1 | Schema has `auto: functionRef` on sprites. Direct binding. |
| Collision Function | 3 | 1 | Schema has `collision: functionRef` on triggers. Direct binding. |
| Auto Function (trigger) | 3 | 1 | Schema has `auto: functionRef` on triggers. Direct binding. |
| Beat Function | 3 | 1 | Schema has `beat: functionRef` on curves. Direct binding. |
| Sweep Function | 3 | 1 | Schema has `sweep: functionRef` on curves. Direct binding. |
| Auto Interval — Curve column | 4 | 3 | Curves have no auto function or auto-interval field in the schema, and design Section 9 lists only `beat` and `sweep` slots for curves. The inspector exposes a curve column in this band without an underlying model. Decision needed: add a curve auto slot to the model and schema, or remove the curve column from band 4 in the inspector. |
| Auto Interval — Trigger column | 4 | 1 | Schema has `autoInterval: number, default 1` on triggers. The inspector renders it as a combo whose v1 placeholder value is "Off" — the widget choice is open: a numeric stepper, an enum with "Off" plus several preset intervals, or a combo-with-stepper hybrid. Field itself is bucket 1; widget choice is a small open question. |
| Auto Interval — Sprite column | 4 | 1 | Schema has `autoInterval: number, default 1` on sprites. Same widget question as triggers. |
| Beat Points generator | 5 | 3 | Schema stores `activeBeats` directly as a string, with no separate generator type. Design Section 10 names Euclidean as the primary generator parameterised by beats-per-cycle, active-beats-count, and beat-shift. Decision needed: store generator type and its parameters as their own fields with `activeBeats` derived from them, or treat generators as one-shot authoring actions that just write the string and leave no record. |
| Active Beats string | 5 | 1 | Schema has `activeBeats: beatsString` on curves. Read and write binding wired (curves only). Validator allows only `x` and `.`; empty string soft-warns since it mutes the curve's rhythm. |
| Beat Strength string | 5 | 1 | Schema has `strength: strengthString, default "9"` on curves. Read and write binding wired (curves only). Validator allows only digits 0-9; empty string soft-warns since it mutes the curve's beats. |
| Sprite Auto Beats / Strength | 5 | 3 | Sprites have no active-beats or strength fields in the schema, and design Section 6 specifies a simple auto-timer interval, not a beat pattern. Inspector v1 activates Band 5 for sprites with the label "Sprite Auto Beats", anticipating a model extension that has not yet been agreed. Decided for now: Band 5 read and write binding both consult curves only; sprites activate the band in the layout but neither contribute to displayed values nor receive edits. When the sprite-auto-timer simulation milestone arrives, extend the Sprite class with `activeBeats` and `strength` fields, add them to `SPRITE_FIELDS`, update the aggregate sources in `_buildBandBeatPoints` to include `objs.sprites`, and pass `editable: ctx.hasCurves || ctx.hasSprites` to the editable fields. Tracked here so the sprite-side wiring isn't overlooked. |
| Cycle Duration | 6 | 1 | Schema has `cycleDuration: integer, default 4` on curves. Cycle length in score beats; defines tick-position resolution at one tick per beat. Read and write binding wired. Validator clamps to >=1 and rounds non-integer input with a soft warning. |
| Cycle Speeds | 6 | 1 | Schema has `cycleSpeeds: string, default "1"` on curves. Space-separated multipliers cycling through the list cycle by cycle, negative values reverse direction. Read and write binding wired. Validator hard-blocks non-numeric tokens; soft-warns on zero tokens (would freeze cursor for that cycle). |
| Stop at Cycle | 6 | 1 | Schema has `stopAtCycle: integer, default -1` on curves. -1 means play forever; positive integers halt the cursor after that many full cycles. Read and write binding wired. Validator rounds non-integer input with a soft warning, and treats non-(-1) negatives as soft-warned (they behave like -1 but were probably typed by mistake). |
| Cursor Speed | 6 | — | Retired by the v2.2 cycle-parameter simplification. The GeoSonix Cursor Speed / Cycle Time / Time Lock triplet collapsed to a single `cycleDuration` field, with per-cycle modulation handled by `cycleSpeeds` and finite playback by `stopAtCycle`. No replacement field needed. |
| Cycle Time | 6 | — | Retired by the v2.2 cycle-parameter simplification. Cycle time in seconds is now derived at runtime from `cycleDuration` and BPM, never stored. |
| Time Lock | 6 | — | Retired by the v2.2 cycle-parameter simplification. The Time-Lock checkbox is gone; cycle duration is the single authored value. |
| Trigger Sync To Beat | 6 | 3 | Not in schema, not in design. Inspector v1 shows a combo with placeholder "Off". Meaning is unclear. Decision needed: define what this field controls (possibly: align trigger auto-firings to score beat boundaries instead of free-running off their own clock), or remove from the inspector. |

## Summary of bucket-3 design questions

The bucket-3 fields cluster in three areas. First, the curve geometry presentation: Position for curves, Curve Size W/H, and the broader question of how the inspector exposes the `shape` sub-object's parameters. Second, the cycle-parameters band as a whole — Cycle Speeds, Stop at Cycle, the Cursor Speed / Cycle Time dual under Time Lock, and Trigger Sync To Beat all need decisions before binding. Third, the model-extension questions: a curve auto slot for band 4, sprite beat patterns for band 5, and stored color for band 2. Each of these last three is a model change, not just a schema change, and may belong in a milestone after the core binding work rather than blocking it.

The bucket-1 fields are more numerous than the bucket-3 fields. Most of bands 1, 3, and 5 are bucket 1, plus the trigger and sprite halves of bands 2 and 4. A useful binding sequence is to wire all bucket-1 fields first, demonstrating the full read-and-write pipeline against the parts of the schema that already exist, then handle the bucket-2 additions, and finally settle the bucket-3 questions one at a time.

## Sequencing recommendation

Add ids and names first, as previously planned. The schema already has `id` for every kind with `default: null`; the binding work needs to add generation logic and a uniqueness check. The `name` field is a clean schema addition with the JS-identifier rule.

Wire the bucket-1 fields next, in order of band. Position for sprites and triggers, sprite/trigger size, all six function-binding slots, the trigger and sprite columns of band 4, and the curve `activeBeats` and `strength` strings. This closes most of the form against existing schema with no model changes.

Add the bucket-2 fields alongside or after the bucket-1 work: Enable, Hide, Curve Thickness, Cursor Thickness, Time Lock. Each of these is a schema addition with a clear default and no design ambiguity. Time Lock pairs with the bucket-3 Cursor Speed / Cycle Time question, so it lands once that storage decision is settled.

Defer the bucket-3 fields. Take them one at a time when the binding work surfaces a natural moment to address each, or batch them into a separate design conversation before continuing. The fields most worth resolving early are Color (because it's universal and visually prominent), the curve auto slot question (because it determines whether band 4 has three columns or two), and the Cursor Speed / Cycle Time storage question (because Time Lock can't ship without it).

The remaining bucket-3 questions — Curve Size W/H, Position for curves, Beat Points generator, Sprite Auto Beats, Cycle Speeds, Stop at Cycle, Trigger Sync To Beat — can wait until the inspector covers more of the form's footprint with live data and we have direct evidence of what's missing during use.
