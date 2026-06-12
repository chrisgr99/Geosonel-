# Section 12 — Scripting & the Sound API

_Status: outline._

The Script tab is where you write what an object does when it fires. This section covers
the callbacks, the functions you call inside them, and the values you can read.

## In this section

- **The Script tab** — how a script relates to a scene; saving and re-running; editor
  aids (autocomplete, hover values, accessibility helpers).
- **The four callbacks** — onActiveBeat (a beat fires), hasCollided (this object's cursor
  hit something), beenTriggered (this object was hit), onTick (every step); the naming
  convention that binds a function to an object.
- **The firing context (`this`)** — what is available inside a callback: the beat strength
  and velocity, the colour reads (`this.col.*`), position and motion, time and beat, and
  the flip signs.
- **Making sound** — `playNote` and `playSound`: pitched notes versus sample/sound-bank
  hits; velocity, duration, and pan; the leading-string overrides.
- **Applying force** — `applyForce` for steering sprites.
- **Printing / debugging** — `print` to the message area; reading live values by hovering.
- **Construction code** — building and configuring objects from script (placement,
  grouping, setting fields) and the selector model (id, current, all, selection, group).
- **Polyphony** — limiting overlapping voices per object, per group, and per score
  (`this.poly`, `score.poly`, `score.groupPoly`).
- **Determinism** — why scripts must stay a pure function of scene state for replays to
  match.
