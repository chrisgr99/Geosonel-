# Multiple customized charts per score (the "chart bench")

DEFERRED design, settled in discussion with Chris. Not yet built — captured so
the decision is not lost. The phrasing engine (Phase 1) is already in; this note
is about how a score holds MORE THAN ONE chart, each possibly customized, without
spawning a new score file per chart.

## The problem

A user wants to experiment with several charts for one score — e.g. play the
piece against "Take the A Train", then against "Autumn Leaves" — and to customize
each (phrasing, unwind, key/transpose) without saving an entirely new score file
each time. The customizations should travel inside the one score bundle.

## Why this is cheap below the UI

The script never names a chart. Callbacks read the current chord from the ambient
harmony (`nxtNote` / `mapToHarmony`), so swapping charts touches no user code and
no engine code. The engine keeps reading a single active `scene.harmony`. All the
work is storage + picker behaviour.

## Storage: a chart bench inside the scene

Keep `scene.harmony` as the ACTIVE chart, exactly as today (so the engine, the
chart panel, and the player are unchanged). Add:

- `scene.harmonyBench: SceneHarmony[]` — the saved/customized charts.
- an active id (which bench entry is currently loaded into `scene.harmony`).

Switching = copy `bench[i]` into `scene.harmony` + rewind the transport +
`clearMelodyState()` (the mini-reset the existing "choose a chart" path already
does, so a replay stays deterministic). Saving the score writes the whole bench
in the same `scene.json` — no extra file per chart.

### Each bench entry is a FULL self-contained chart

Not a library reference. Two reasons: (1) it matches the existing decision to
freeze the chosen progression into the score so play-time has no library
dependency — a reference would rot if the shared library changed or dropped the
chart; (2) the per-chart state has to live somewhere. `phrases`, `unwind`, and any
key/transpose are PER CHART, not per score (the same chart may be phrased
differently). So each entry is a complete `SceneHarmony` carrying its own phrases /
unwind / key. Cost is trivial — a few KB of JSON each.

### Each bench entry carries an `originId`

A stable id linking the entry back to the library chart it was customized from.
This is the key the picker uses (see below). The entry also has its own id; the
`originId` is the "where it came from" link.

## UI: the library list IS the chooser — no separate bench browser

The single entry point stays the existing full-library picker. The only change is
what a pick RESOLVES to:

> On selecting a library chart → if the bundle already holds a customized version
> of that chart (a bench entry whose `originId` matches), load THAT; otherwise load
> the pristine library copy.

This removes any need for a separate "choose among your customized charts" UI. It
hangs entirely off the picker's existing select handler.

A bench entry is created/updated lazily — the first time the user customizes a
loaded chart (edits phrases / unwind / key), keyed by its `originId`.

### Picker shows which charts are customized

Otherwise the swap happens invisibly and the user can't tell a pristine pick from
a customized one. Mark the customized rows — a brief pencil/edit icon beside the
title (preferred), or "(edited)" in parentheses. A row affordance, not a second UI.

### Revert to original

Since a pick now loads the custom version, the user needs a way back to pristine
to start a customization over. This goes in the chart's HAMBURGER MENU as another
option ("Revert to original"), alongside Chords / Key / Unwind — not a new browser.

## Accepted limitation: one customization per library chart (for now)

CURRENT DECISION (Chris): keep it simple — ONE version per library chart per
score. The picker has a single row per library chart, so a pick resolves to one
saved version. Perfect fit for "experiment with several DIFFERENT charts in one
score". It cannot hold two different phrasings of the SAME tune side by side. That
is fine and invisible for the described use case.

### If we ever DO want multiple versions of one chart per score

Preferred shape (Chris): stay in the SAME global picker — no separate bench UI.
Just show each version under the same chart NAME with a short distinguishing tag,
probably just `1` / `2` / `3` (there would rarely be many). So a chart with several
instances in the current score appears as several rows ("Take the A Train 1", "…
2") in the one global list. The resolution logic is unchanged; only the keying
goes from one-per-`originId` to many-per-`originId` plus a version tag.

This supersedes the earlier "duplicate affordance / separate bench UI" sketch — the
tagged-rows-in-the-global-picker approach is simpler and keeps the single chooser.

### Alternative worth weighing then: phrasing in the GLOBAL chart list

A customized PHRASING is plausibly reusable across scores (the way you'd phrase a
tune is fairly intrinsic to the tune, not to one score). So an alternative to
per-score storage is to let a customized chart — or at least its phrasing — live in
the GLOBAL/master chart list, so it is available to every score, not copied into
each. Tension to resolve if we go there: it reintroduces a library dependency at
play time (see "What we deliberately rejected"), so we would likely still FREEZE a
copy into the score on use while ALSO offering to save the phrasing back to the
master chart for reuse. Out of scope now — captured as a fork to consider when/if
multiple versions are taken on.

## Migration

Legacy scenes have only `scene.harmony`. On load: if `harmonyBench` is absent,
`bench = [harmony]`. `sanitiseSceneHarmony` already exists; the bench sanitiser
maps it over the array and drops bad entries. Nothing old breaks.

## What we deliberately rejected

Storing charts as library references with per-score overrides. It re-introduces
the library dependency we removed (scores rot when the library changes), for a
saving that does not matter at a few KB per chart.

## Build sketch (when this becomes necessary)

Additive, no engine work:

1. `scene.harmonyBench` storage + active id + per-entry `originId`; bench
   sanitiser; load migration (`bench = [harmony]` when absent).
2. Picker select handler: resolve customized-if-exists by `originId`.
3. Lazy bench-entry create/update on first customization.
4. Picker row badge (pencil/edit icon) for customized charts.
5. "Revert to original" in the hamburger menu.
