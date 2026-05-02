## Section 12 — Phrases and the Compositor

Curves, triggers, and sprites all emit Phrases — time-indexed event streams in beats.

A Phrase has:
- A sequence of events, each with time offset in beats and musical parameters, plus optional metadata.
- An overall duration in beats.
- An optional name.

The Compositor accepts phrases from any source (rendered curve output, recorded trigger output, accumulated sprite output, imported MIDI files) and arranges them on a beat-indexed timeline via a box-graph model inherited from GeoMaestro. Echo boxes, iterative boxes, synth boxes, mix boxes, effect boxes.

The Compositor is deferred. Initial releases produce phrases but arrange them trivially.
