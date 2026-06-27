# Chart sections per object, and the practice loop

Builds on the **Harmony-driven** beat mode (`beatPointsMode: "chart"`), where a
beat-points object follows a loaded chord chart and its rhythm editor mirrors the
chart's measures (`src/chartFollow.js`, `beatPoints.deriveChartMirror`, the
inspector chart-mirror grid).

## The model

A chart is a set of **sections** — the label-bearing regions of the chart
(`i`, `A`, `B`, …). A section's bar extent runs from its label to the next
structural boundary (the next section, or a fresh repeat block that opens after
this section's repeat has closed — a trailing tag / "repeat and fade" coda),
trimming blank spacers (`harmonyChartLayout.sectionBarRange`). Unlabeled trailing
material (tags, pickups) is **not** a section.

Each chart-following object is assigned **one section label** (or none). The
assignment is the *label*, not a bar-range: a label can occur several times in a
chart (a real AABA-type form has two or three A's — whether written as separate
`A` sections or produced by a repeat), and the object owns **every** occurrence.

- The object's **curve is the section's bars**: few beat points, and the curve
  **re-traces** once per occurrence of its label.
- Playback is **form-gated**: the object plays only while the form is inside one
  of its label's sections, and **freezes** (cursor parked at the section start)
  otherwise.
- **No label assigned** → the object plays **every assigned section** (the whole
  compressed form). Its beat editor shows the active sections **concatenated**
  (each label's first occurrence, in chart order) so beats can be authored per
  section; at playback it re-traces at each section boundary, firing that
  section's own beats with that section's chords. So with B and C assigned and an
  unassigned object, the form B·C·B·C has the unassigned object play B-beats,
  C-beats, B-beats, C-beats. (If nothing is assigned anywhere it plays the whole
  chart, ungated.)

## Compressed form — unassigned sections are dropped

The shared form is the **union of all assigned sections, in chart order**, looped
— **not** the whole chart. Any section assigned to no object (an unwanted intro,
a trailing tag) is **omitted entirely**, as though it were not in the score, so
there is no dead air while nothing is assigned.

Concretely: walk the chart's unfolded played timeline (repeats / navigation
honoured, `buildBarPlayback`) and keep only the played bars whose folded bar
belongs to an assigned section; that filtered timeline is the form clock the
whole ensemble shares. The chord-chart cursor follows it (skipping the dropped
bars), `_syncLoopBeats` is its length, and each object gates on its own label's
bars within it.

Because the filter runs over the *unfolded* timeline, a label that recurs — by
repeat or by a second same-labeled section — yields one form occurrence per
recurrence, and the object plays each as its own pass. With objX→A, objY→B and a
chart that plays A·B·A, the form is A·B·A: objX laps, objY laps, objX laps again,
then loop.

### Substantially-identical occurrences

An object has a single beat layout (the pattern around its curve), edited against
the **first** occurrence of its label. That pattern plays over **every**
occurrence; the chart cursor and the chords (`this.chord`) track whichever bars
are actually sounding. If a later occurrence differs in length the pattern loops
/ truncates to fit — same-length occurrences (the normal case) are seamless.

## Assignment UI — the orange line, by label

Done on the **Harmony chart**, where sections are visible.

- Reuses the **phrase-overlay line** (orange). User editing of musical *phrases*
  is deprecated — auto-phrasing still runs internally for the melodic line.
- **Click a section** → assign that section's **label** to the selected object.
  The orange line is then drawn over **every** section bearing that label, so all
  the object's occurrences glow at once. Clicking again clears the assignment.
- The line is always **orange** (not the object's colour). Selecting a different
  object shows that object's label.
- There is **no free-range drag**: assignment is always a complete section (the
  ad-hoc drag-create / end-drag is retired). Sub-bar selection survives only in
  the transient practice loop (below).

## Beat editor scoping

The inspector's rhythm grid shows **only the object's section** (the first
occurrence's measures) instead of the whole form — fewer rows, fewer beats.

## Practice loop

A transient loop for working on a stretch of bars, set in the **beat editor**:

- **Select measures** in the beat editor (drag a row-major run, or shift-click to
  extend — the same selection Delete uses), then press the **square ⟲ button** that
  sits just right of the Pattern Type menu. The looped span highlights in iReal's
  **olive** and the button lights.
- While set the **transport plays only that range** — **global** (every playing
  object loops with it, each per its assignment); start/stop stays inside it;
  **rewind goes to the loop's first bar**.
- A new selection + press **replaces** the loop. Pressing with **nothing selected
  clears** it and removes the highlight.
- The same olive highlight **mirrors on the Harmony-tab chord chart**.
- **Transient** — not saved with the score.

The practice loop is the one place sub-section bar ranges are still selectable
(for focused practice); it does not change a section assignment.

## Milestones

1. **Section assignment + scoping** — the orange line repurposed, phrase editing
   deprecated, the beat editor + curve scoped. *(built)*
2. **Form-gated playback** — the object plays only while the form is inside its
   section, re-tracing in time (one section-bar per played bar, beat-locked).
   *(built)*
3. **Practice loop** — select measures in the beat editor, press Loop → olive
   range + global transport loop + rewind-to-loop-start + chord-chart mirror.
   *(built)*
4. **By-label assignment** — assignment becomes a section *label*; it resolves to
   every occurrence; the orange line lights them all; the picker is section-only
   (drag retired). The object plays each occurrence as a pass. *(built)*
5. **Compressed form** — the shared form is the union of assigned sections in
   chart order; unassigned sections are dropped from the form clock (a piecewise
   compressed→chart beat map), the cursor, and the harmony context, so nothing
   plays them. *(built)*
6. **Unassigned-object playback** — an object with no label plays *every* assigned
   section, with a per-section beat layout (its editor concatenates the active
   sections); the active beat array swaps per section occurrence, re-tracing each.
   *(built)*
