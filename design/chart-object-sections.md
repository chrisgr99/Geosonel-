# Chart sections per object, and the practice loop

Builds on the **Harmony-driven** beat mode (`beatPointsMode: "chart"`), where a
beat-points object follows a loaded chord chart and its rhythm editor mirrors the
chart's measures (`src/chartFollow.js`, `beatPoints.deriveChartMirror`, the
inspector chart-mirror grid).

## Problem

A chart-following object plays the **whole unfolded form**, so its rhythm editor
shows every measure (many rows, a large number of beat points to author) and its
curve traverses the entire form once — repeated sections land at different points
on the curve, so the user never sees or hears a phrase loop back over the same
region of the canvas.

## Sections per object

Each chart-following object can be assigned **one contiguous range of folded
(displayed) chart bars** — *its section*. Objects divide the chart among
themselves (object A → the A section, B → the B section, …).

- The object's **curve is just that range's bars**: far fewer beat points, and the
  curve **re-traces** each time the section comes round.
- Playback is **form-gated**: the object plays only while the form's clock is
  inside its range, **halts** (cursor frozen) otherwise, and re-traces in time as
  its section returns — so on the canvas the user sees objects waiting, then
  springing to life when their section plays.
- **Default**: no range assigned → the object plays the whole form (today's
  behavior). Backward-compatible.

The range is over **folded** bars (the displayed measures), so a section that
repeats in the form replays the object's curve each pass.

## Assignment UI — the repurposed orange line

Done on the **Harmony chart**, where chords, repeats, and section labels are
visible and recognizable.

- Reuses the existing **phrase-overlay line** (the orange line above the
  measures). User editing of musical **phrases is deprecated** — auto-phrasing
  still runs internally for the melodic line, but the line is no longer a phrase
  editor.
- The line now marks the **selected object's** assigned range. Selecting a
  different object shows that object's range.
- **Drag** the line's ends to set the range; **click a section label** to snap the
  line to that whole section.
- The line is always the current **orange** (not the object's colour).
- No line for an object → it plays the whole form; line over a range → only those
  bars. One contiguous range per object.

## Beat editor scoping

The inspector's rhythm grid shows **only the object's assigned measures** (with
the **chord symbol** above each bar so sections are recognizable), instead of the
whole form — fewer rows, fewer beats.

## Practice loop

A transient loop for working on a stretch of bars, set in the **beat editor**
(where the user edits and listens):

- A **loop-icon toggle button** at the top of the beat editor. Pressing it arms
  loop mode (button stays lit, cursor changes); **drag across a range of measures**
  to set the loop; the bars highlight in iReal's **olive** colour.
- While set, the **transport plays only that range** — it is **global** (every
  playing object loops with it, each per its own assignment); start/stop stays
  inside it; **rewind goes to the loop's first bar**.
- Pressing the button again **releases it and clears** the highlight, back to
  full-form playback.
- The loop is **within the object's scoped section** (generally the editor only
  shows that section anyway).
- The same olive highlight **mirrors on the Harmony-tab chord chart** while active.
- **Transient** — not saved with the score.

## Milestones

1. **Section assignment + scoping** — the orange line repurposed per-object,
   phrase editing deprecated, the per-object range stored, and the beat editor +
   the object's curve scoped to the range. (The object loops its range; form-sync
   is M2.)
2. **Form-gated playback** — a shared form clock; the object plays only while the
   form is inside its range, halts otherwise, and re-traces in time.
3. **Practice loop** — the beat-editor loop toggle + olive range + transport loop
   + rewind-to-loop-start + the chord-chart mirror.
