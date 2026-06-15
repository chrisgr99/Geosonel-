# Repeat the scene & compose by phrases

DEFERRED design, settled in discussion with Chris. Not yet built — the broader,
more speculative companion to [rhythm-auto-generation.md](rhythm-auto-generation.md),
with which it shares concepts (styles, the Mutability vocabulary, seeds,
audition-and-lock).

## Two orthogonal axes

A repeated section can be reasoned about on two INDEPENDENT axes — the earlier
mistake was welding them together (treating Unwind as "vary the notes").

- **Layout — Folded ↔ Unwound.** How the chart is written and addressed: repeat
  marks vs the song spelled out as "Repeat 1 / Repeat 2 / …". Its real purpose
  is readability and per-pass EDITABILITY (you *can* phrase/transpose/re-voice
  one pass). On its own it changes nothing about the sound; identical copies
  stay identical.
- **Repeat-behavior — Evolve ↔ Literal.** Whether the generative state resets at
  a section boundary so identical chord content yields identical notes and an
  identical scene.

They compose freely. Folded+Evolve is today's default (drifts through the
repeat). Folded+Literal snapshots at the repeat-open and restores on the back-
jump. Unwound+Literal resets at each "Repeat k" boundary. Unwound+Evolve drifts
(or differs because you edited that copy).

## Repeat the scene (literal repeat)

A score-level toggle (start there; per-repeat granularity can come later). When
on, the generative state RETURNS to the section's start on each pass, so the
scene and the sound both repeat. Chris's call: the teleport is accepted and
expected — it's the signal the music came back around.

Mechanism = a generalization of rewind (which already resets all runtime state
to AUTHORED initial values). Instead, **deep-copy the EVOLVED state at the
section boundary** and write it back on the repeat-back:

- At a repeat-open, first time through → CAPTURE a snapshot (sprite
  positions/velocities/phases, curve cursor phases, `nxtNote` melodic memory,
  voice/poly state).
- At each subsequent pass start → RESTORE it. Nested repeats → a stack;
  discard all on rewind/setScene.

Boundary beats are derivable from the existing expansion (`expandProgression` /
`buildBarPlayback` unroll the passes — tag the pass-start beats). Folded
playback restores on the back-jump; unwound playback (no back-jump) restores at
the "Repeat k" section boundary.

Hard parts:
- **Completeness** — a literal repeat is only literal if EVERY evolving field is
  captured; miss one and pass 2 drifts. Put `captureState()`/`restoreState()`
  next to the rewind-reset logic so they can't fall out of sync (including the
  `melodyState` hook in callbackContext.js).
- **The audio seam** — already-scheduled notes (superdough lookahead) and notes
  ringing across the boundary don't un-schedule. The restored pass re-triggers
  the downbeat, which is correct for a repeat; the only artifact is a pass-1 tail
  overlapping, like a reverb tail. Accept it rather than hard-cutting voices.
- **Endings / navigation** — 1st/2nd endings work (restore at the section start,
  replay, then diverge into the 2nd ending). D.S./segno/coda aren't modelled in
  the chart engine yet, so those are out of scope until that lands.

## Compose by phrases (the bigger vision)

Generalize "return to a captured state" into "each phrase has a CHOSEN starting
state." The tune becomes a sequence of phrases (already first-class), each
optionally carrying a starting variation; you audition mutations of it, lock the
one you like, move on. The fully-composed tune is a curated list of per-phrase
variations over a fixed progression. Literal-repeat is then the automatic
special case (the variation is "whatever was captured the first time").

Pivotal decision — **store a SEED, not a snapshot.** A seed + a mutation spec
lets the engine REGENERATE the starting state deterministically: same seed →
same initial conditions → same evolution → same notes AND same silences, for
free and reproducibly. Tiny to store, and it's exactly what an audition
explores. Raw capture is the fallback only for the no-authored-seed
auto-literal-repeat case.

Per-phrase mode: `fresh(seed)` (set its own starting state) or `continue` (flow
from the previous phrase's end) — so not every boundary teleports unless chosen.

## The mutation vocabulary is the Mutability band

No new vocabulary to invent — the per-phrase variation is a SEED into the
mutation space the inspector's **Mutability band** already defines. Two layers:

- **Authored bounds** (Mutability band, per object): how far position / velocity
  / rhythm may stray. You set the radius. (Schema already carries per-object
  mutation amounts, e.g. `mutatePosition`.)
- **Per-phrase seed** (the audition): picks a specific point WITHIN that radius.

The radius keeps every variation recognizably the authored object; the seed
finds the interesting one inside it. Position and velocity are well-defined
offsets. **Rhythm** is the under-designed one: a per-slot transform probability
`p` drawing small musical moves — `x→.`/`.→x`, ratchet `n→x`/`n→.`, rarely
`x→2/3` — with strong beats protected (read Beat Strength) and a density choice
(let hit-count drift = looser, or pair drop-with-add = gentler). Same transform
vocabulary as the Auto generator's, different driver (seed vs colour).

## UX guardrails (first-class, not afterthoughts)

Given dictation + limited eyesight, a per-phrase × per-variation parameter grid
would fail. Keep it:

- **Ear-driven and linear** — walk phrases in order; per phrase the verbs are
  *audition* (cycle to the next candidate, looped) / *lock* / *continue* /
  *next*. Audio is the feedback channel; nothing to read or drag.
- **Parameters stay in the Mutability band** — the audition never shows the
  knobs; it only plays candidates (seeds) within the authored radius.
- **Audition-once, apply-to-all** — make one global choice for the whole tune,
  then refine only the handful of phrases that want something different. Most
  phrases need zero interaction. Complexity is proportional to how much you
  actually want to vary.
- The literal-repeat foundation gives value with NO UI at all — the audition/
  lock layer is reached for only when you want to curate rather than evolve.

If we're ever tempted to add per-phrase sliders, that's the signal we've drifted.

## Sequencing

(a) Engine state-machinery — snapshot/restore-or-regenerate at phrase/section
boundaries (the literal repeat). The hard correctness work. (b) Per-phrase seed
storage on `scene.harmony.phrases` + the `fresh/continue` mode. (c) Phrase-scoped
audition + lock. Musical value at each step: (a) alone gives literal repeats;
(b)+(c) give the composed-from-phrases workflow.
