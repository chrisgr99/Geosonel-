# Section — Harmony

_Status: feature in progress; this section is a stub plus working design notes. (Final section number TBD.)_

How GX2 follows a chord progression: import a chart, and your objects can sound notes that fit the chord playing at each moment.

## In this section (to write as the feature lands)

- Importing a chart from iReal Pro (File menu) and the playlist library.
- Choosing a song for the scene; the chord chart view and the Letter/Roman toggle.
- How the progression advances on the global clock, and the loop-or-stop choice.
- Making objects follow the harmony from a script (`mapToHarmony`, and later the bass/accompaniment helpers).

---

## Design notes — NOT YET BUILT (internal; convert to user prose as each ships)

> These are working design ideas, not current behaviour. Don't read them as features that exist.

### Helper functions (commit 4 scope)
v1 ships only a basic **`mapToHarmony`** (map an object value — 0..1 from position / colour / beat — onto a tone of the *current* chord) and exposes the **current and next chord** to callbacks. `mapToBass`, `mapToWalkingBass`, and `mapToAccompaniment` are **deferred** — they need their own research and prototyping pass.

### Form-locked playback — repeat the music when the harmony repeats
**Idea:** optionally, when a section of the harmony repeats, the *generated music* repeats identically too — so a listener hears the same phrase each time the same chords come around. This is what gives a piece recognizable **form** (a head that returns) instead of continuous generation that merely happens to be over recurring chords. Should be an **option** (some pieces want literal repetition; others want evolving variation).

**Mechanism (leans on existing determinism):** GX2 already produces the identical event sequence from the same starting state and elapsed beats. So rather than recording and replaying audio, **reset the generative state** — object cursors, per-object cycle counts, any per-object randomness — back to where it stood at the *start* of a harmony section whenever that section repeats. Same chords meet the same state, so the same notes come out, for free.

**Open design questions:**
- What counts as a "section" — the chart's `{ }` repeat blocks, the `*A`/`*B` section markers, or the whole-piece loop?
- Whole-scene reset, or a **per-object opt-in** (snap the "head" objects back to the form while a slow drifting texture keeps evolving)? Likely pairs with a per-object "follow harmony" choice.
- Relationship to the **audition system**: the audition Loop is for *trying* ideas while composing; this is about the *finished piece* having form. They'd share the same "loop / reset state at a boundary" machinery, so this could extend or reframe the audition loop rather than be a separate thing — decide whether to unify.

**Status:** design idea; prototype against a real imported chart (one with a repeat) after the core harmony UI is in.

### Loop a selected section of the chart (iReal-style, but the selection persists)
**Idea:** drag over bars in the chord chart to select a range; on play, that section loops. Unlike iReal Pro, the **selection persists** across stop/restart (stored on the scene, not transient). The section repeats *identically* — the whole score loops over it, not just the harmony (a vamp where objects keep evolving was rejected: "no point in having time evolve differently than if played from the start").

**Mechanism (the determinism makes this tractable):**
- Looping = reset the global clock to the section's start beat on each wrap (a true loop region `[startBeat, endBeat]`). Every **clock-driven object reproduces for free** — curves are pure functions of elapsed beats — with NO requirement that the loop length align with any object's cycle.
- The only path-dependent objects are **wandering sprites**. During the first pass through the section, RECORD each sprite's physical state (position, both velocity layers, flipX/flipY) at checkpoints (per chord change, plus a full snapshot at the loop start); on later passes, RESTORE from the record so the sprite re-walks its identical path. Jitter/image-forces are deterministic *given the state*, so a restored sprite replays exactly.
- "Play the section once before it loops cleanly" applies ONLY to **onTick-force-driven sprites** (their trajectory can't be shortcut to bar 5 without travelling there). Curves, stationary sprites, and base-velocity-only sprites (cheap to fast-forward) can start the loop directly. → This is the *manual, selection-driven* sibling of form-locked playback above; same record/replay machinery.

**Open decisions:** checkpoint granularity (loop-start snapshot vs per-chord re-sync — lean: both); selection→played-timeline mapping when the drag touches the chart's own `{ }` repeats/endings (v1: contiguous selections only, flag odd cases); held-note clipping at the loop seam (the audition loop's seam-guard problem); where play starts (jump to section start, like iReal); precedence over the global loop-or-stop. Likely shares machinery with the audition Loop.
