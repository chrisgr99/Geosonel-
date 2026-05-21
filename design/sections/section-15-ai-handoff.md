## Section 15 — Disk Mirror and AI Integration

The disk mirror is the mechanism by which an AI assistant — typically Claude Desktop with a filesystem MCP server pointed at the mirror folder — observes and edits the score the user is currently working on. The mirror is a single folder at a stable, known location holding a live copy of the open score's content plus a set of observation-only artifacts describing its current state and the protocol the AI is participating in. The mirror is kept in sync with the in-memory bundle as the user edits, on a debounced timer rather than on every keystroke. The AI reads from the mirror to understand the user's current state and writes to a restricted subset of files to propose edits, which flow back into the editor as bundle changes after validation. The mirror is always running while GeoSonel is open; there is no Hand Off or Fetch gesture to invoke, and the user does not interact with the mirror folder directly.

For some users this is a primary authoring channel, not just an AI nice-to-have. Composers with limited eyesight, those who prefer voice or dictation input, and anyone who finds writing pattern code or procedural logic more comfortable in conversation than in an editor all get a route into GeoSonel through the mirror. The reliability bar reflects that: errors round-trip with rich actionable detail, the AI cannot leave the score in a half-applied state, and the conversation's authority belongs to the user, not to the AI.

Status and history. This design reverses the v2.2 deprecation of an earlier disk-mirror approach and supersedes the v2.3 AI Handoff feature (explicit user-driven Hand Off and Fetch via a configured folder) that replaced it. The earlier disk-mirror was deprecated because it ran in a browser context: the File System Access API revoked filesystem permissions on every tab restart, prompting the user repeatedly; absolute paths were not exposed to the AI; module caches masked external edits until a hard reload; and the round-trip introduced subtle formatting bugs. None of those constraints apply in the Electron build, where the renderer talks directly to the filesystem through the IPC layer and scores live as real .gxs folders at user-chosen paths. The disk mirror is therefore Electron-only by design and not implemented in the web build; web users do not get AI integration through this path. The composition mirror described in this section is Phase 1 and is implemented at stage 4 of the Electron migration. Phase 2 adds event logging during playback. Subsequent phases (motion data, per-run persistence, on-demand query mechanism, database layer) are described in the Phasing block at the end of this section.

Location. The mirror folder is at ~/Library/Application Support/GeoSonel/Active/. The user configures their MCP server (or other AI tooling) to read and write this path once, and otherwise never touches it. ~/Library is hidden by default in Finder, so the mirror is not surfaced to the user during ordinary use; the path exists for AI access only. This keeps the user from accidentally editing mirror contents directly, which would not be the right way to modify a score (the in-memory bundle is the source of truth; mirror edits feed back into it but are not how the user should think about authoring). The Active folder always contains exactly the currently-open score; on a score switch the folder is cleared and refilled with the new score's content. The mirror does not persist history between sessions; each launch starts fresh with whatever the resolved initial bundle's state is.

Contents. The Active folder splits into two file categories based on who is permitted to write each file. Round-trip files are read-write from the AI's side: the bundle accepts AI-edited versions, validates them, and applies them back to the in-memory state. Observation-only files are write-from-bundle, read-only from the AI's side; the AI consumes them as information but any AI edits to them are ignored or rejected. The two lists are declared in active-score.json's `files` field so the AI knows which is which on first contact. The watcher only triggers the apply pipeline on round-trip files; edits to observation-only files don't run validation or modify scene state.

Round-trip files (Phase 1):

- scene.json — the score's composition data, current in-memory state.
- behaviours.js — the score's per-object callback code.
- image.png (or the bundle's actual image filename) — the score's background image.

Observation-only files (Phase 1):

- snapshot.png — a capture of the canvas's current pixels at last sync, showing where cursors, sprites, triggers, and selection markers are right now. Refreshed at edit time only, not on simulation tick.
- snapshot-annotated.png — the same capture with object id labels drawn next to each visible element, matching scene.json's ids, so the AI can refer to specific objects in conversation by the same ids the score uses.
- snapshot-description.md — a structured text rendering of canvas state covering per-object id, kind, position, and key properties. Cheap to consume in AI token budget (a few hundred tokens), and the AI's default reference for routine work; the PNG snapshots are reserved for cases where pixel-level spatial verification matters.
- active-score.json — metadata about the score and the mirror protocol; the AI's first read on any conversation. Schema documented below.
- sceneSchema.md — a reference describing scene.json's structure (object kinds, required fields, type constraints, reference rules) so the AI can ground writes against the actual schema rather than reconstruct it from error messages.
- AGENTS.md — an AI-facing orientation document covering what GXW is, core concepts (paths, cursors, sprites, triggers, cyclePattern semantics, the simulation tick model), the mirror protocol, editing patterns for scene.json and behaviours.js, log interpretation when Phase 2 lands, and workflow conventions. Read at the start of any conversation to bootstrap AI context. Naming follows the emerging cross-tool convention for AI-facing project documentation.

Observation-only files added in Phase 2 (event logging):

- run-log.ndjson — a compact append-only log of musical events during the current run. Cleared at transport start, finalized at transport stop. Format detailed under Phasing below.
- run-summary.json — aggregate statistics for the current run (per-object, per-pitch, per-time-bucket, totals). The AI's first-read surface for time-based queries.
- run-log-schema.md — a reference describing run-log.ndjson's format and code tables.

active-score.json schema (Phase 1):

```json
{
  "protocolVersion": 1,
  "score": {
    "displayName": "Tofes 17",
    "path": "/Users/chrisgr/Documents/Geosonix Scores/Tofes 17.gxs",
    "dirty": true
  },
  "sync": {
    "lastSyncAt": "2026-05-21T15:30:00.000Z",
    "quiescenceWindowMs": 500
  },
  "transport": {
    "state": "playing",
    "elapsedSeconds": 12.34,
    "beat": 8
  },
  "files": {
    "roundTrip": ["scene.json", "behaviours.js", "tofes.jpg"],
    "observationOnly": ["snapshot.png", "snapshot-annotated.png", "snapshot-description.md", "active-score.json", "sceneSchema.md", "AGENTS.md"]
  },
  "atomicWrites": {
    "pendingSentinel": ".pending",
    "description": "Write '.pending' before a multi-file edit and remove it after to defer application past the quiescence window. The sentinel may include createdAt and expiresAt timestamps; bundle treats sentinels older than 60 seconds (or past expiresAt) as orphaned and removes them with user notification."
  },
  "isLive": true,
  "lastApplyResult": {
    "appliedAt": "2026-05-21T15:30:01.234Z",
    "status": "accepted",
    "summary": "Batch of 2 files applied successfully.",
    "errors": []
  }
}
```

`protocolVersion` lets the file evolve without breaking AI tooling that reads earlier versions. For an Untitled bundle, `score.path` is null and the AI knows the score has no canonical home yet. `transport` state is a single snapshot value at last sync, not a stream — it tells the AI whether the user is currently playing or paused without requiring runtime instrumentation. `isLive` is true while GeoSonel is running and is set to false on quit; an AI reading the folder while the app is closed sees the data is not fresh. `lastApplyResult` is documented under Validation and rollback below.

Update model. Bundle state pushes to the mirror folder on a debounced timer — roughly 500ms after the last user edit — so the mirror reflects the user's current work rather than the last saved version. Switching scores, opening a different score, or creating a new Untitled bundle replaces the folder contents immediately rather than waiting on the debounce. The user's explicit Cmd-S still writes to the score's real on-disk path; the mirror tracks the in-memory state regardless of whether the user has saved. This means the AI can see and reason about work-in-progress, not just committed work, which matters most for Untitled bundles that have no on-disk path yet.

Round-trip protocol — echo prevention. The bundle's own pushes use the standard temp-and-rename atomic-write pattern: write scene.json.tmp (or behaviours.js.tmp) then atomically rename to the final name. The fs.watch filters out events for *.tmp files. The rename appears as a single change event on the final filename, but the watcher's normal apply pipeline handles such events as AI writes by default — the bundle's pre-push setup includes a brief muted flag for known self-originating rename targets so the watcher ignores them. On startup the bundle also scans Active/ and removes any leftover *.tmp files from a previous crash or interrupted write.

Round-trip protocol — multi-file atomic application. The watcher uses quiescence-based debouncing: it resets a 500ms timer on each event and applies the accumulated batch only after the directory has been quiet for the full window. A single logical edit that touches scene.json and behaviours.js as a pair lands in one batch. For edits the AI knows will exceed the quiescence window (long-running file generation, deliberate pauses between writes), the AI writes a `.pending` sentinel file before its batch and removes it after; the bundle waits indefinitely for `.pending` to clear before applying. The sentinel carries `createdAt` and an optional `expiresAt`; if the bundle is still waiting past expiresAt or past a 60-second default timeout, it treats the sentinel as orphaned, removes the file, notifies the user via the message area, and resumes normal quiescence-based application.

Round-trip protocol — validation and rollback. Once a batch is ready to apply, the bundle validates each file in turn: JSON parsing for scene.json, schema validation against sceneSchema.js for scene.json, syntax check via Acorn for behaviours.js. Validation runs on AI-originating writes only; the bundle's own pushes are valid by construction. Any failure rejects the entire batch: the in-memory state stays unchanged, the bundle re-pushes its last-known-good content to the mirror to overwrite the AI's bad write, and the mirror always reflects bundle state. The AI on its next read sees its attempted change was reverted.

Failure details land in active-score.json's `lastApplyResult` field. The field carries `status` (accepted or rejected), `appliedAt` timestamp, a top-level `summary` string for one-read overview (for example "1 schema violation in scene.json; batch rejected, mirror reverted to last-known-good"), and an `errors` array. Each error entry carries the file path, the error kind (jsonParseError, schemaViolation, jsSyntaxError, etc.), and details appropriate to the kind. Schema violations include the object reference (e.g. "sprites/sprite-c4f"), the field path within the object, the invalid value, the expected type or shape, valid values if enumerable (the list of existing path ids when a reference doesn't resolve), an optional near-match suggestion, and a human-readable message tying the entry together. Parse errors and syntax errors include the line and column from the parser, a short context snippet around the error position, and the parser's own message. The error info aims to give the AI enough to self-correct or have a productive conversation with the user about the failure; the user is always in the loop and the AI is acting on the user's instructions, so a productive failure conversation is the expected outcome of any rejected batch.

User notification on rejection appears in the message area ("Claude's edit was rejected; see active-score.json for details"). User-initiated edits during the same batch are protected because the bundle's in-memory state was never changed.

Snapshot artifacts. snapshot.png and snapshot-annotated.png refresh at edit time only — when scene.json, behaviours.js, or the image change. They do not refresh during playback in Phase 1; canvas motion observability belongs with Phase 2's event logging and later phases. snapshot-annotated.png labels each visible object with its scene.json id using minimal visual chrome (small text near the object's position, no full bounding boxes). snapshot-description.md is a structured text rendering of canvas state covering object id, kind, position, and key properties. It is the AI's default reference for routine work since it consumes a few hundred tokens versus a PNG's roughly 1500 to 3000 tokens. The PNG snapshots remain available for cases where pixel-level spatial verification matters.

Edge cases.

Untitled bundles: `score.path` is null in active-score.json. The mirror still reflects in-memory content; the AI references the score by `displayName`.

App startup: the initial bundle loads then gets pushed to the mirror, overwriting whatever was left from the previous session. The bundle also scans Active/ on startup and removes any leftover *.tmp files from a previous interrupted write or crash.

App quit: mirror content is left in place rather than cleaned up, but `isLive` is set to false in active-score.json so any AI reading the folder while GeoSonel is closed knows the data is not fresh. Cleared back to true on next launch.

Score switch with an AI write in flight: any pending watcher batch is cancelled since the user's gesture is authoritative. The user is notified in the message area that an AI batch was discarded. The AI sees the new score on its next read via the refreshed active-score.json.

Multiple GeoSonel instances: handled by Electron's default single-instance lock. Only one instance owns the mirror folder.

Concurrent AI writers: rare enough to defer to batched-but-mixed application until it proves a problem. Two writers within the same quiescence window are folded into one batch, which either validates as a unit or is rejected together.

Interrupted AI writes have three sub-cases. A stale `.pending` sentinel left by an interrupted AI is handled by the timeout described in the multi-file atomic application paragraph above. A partial batch with no sentinel is handled by the existing validation: if the partial state is internally inconsistent (sprite references undefined callback, schema mismatch), the batch is rejected and the mirror reverts to last-known-good. Stale *.tmp files from interrupted bundle writes or crashes are cleared on startup.

AI context loss between conversations: the mirror represents score state, not the AI's task state. On any new conversation or new AI instance, the AI re-reads active-score.json, scene.json, behaviours.js, sceneSchema.md, snapshot-description.md, and AGENTS.md to ground itself. The user re-states intent as part of the normal dictation-driven workflow. A cooperating AI that wants to record its own task journal can write an optional ai-journal.md as an observation-only file, but the protocol does not require it.

Conflict handling. When the AI writes scene.json or behaviours.js while the user is also editing, the AI's writes take precedence after validation. The bundle's in-memory state is replaced, and the user is notified through the message area ("Claude edited scene.json — your unsaved changes have been replaced"). The user can undo the loss through the normal undo history; the AI cannot undo. This asymmetry reflects the broader pattern that the AI is the slower, more deliberate collaborator and the user's session has rich undo while the AI's session does not. Race-condition windows are kept narrow by the debounce on the upstream side and by single-threaded application of incoming writes on the downstream side.

Playback relationship. The composition mirror updates on bundle edits, not on simulation ticks. During playback, scene.json and behaviours.js in the mirror remain at whatever the user last edited them to be; the moving simulation state (object positions, velocities, current beat) does not flow into the mirror in Phase 1. This keeps scene.json's role as a schema unambiguous — the AI reading scene.json knows it is reading the composition, not a snapshot of a running performance. snapshot.png does not refresh during playback in Phase 1 either. If the AI writes scene.json during playback, the editor pauses playback, applies the change, and notifies the user; this prevents object positions from jumping unexpectedly mid-run as a result of an AI edit.

Workflow shape. The mirror is most ergonomic with Claude Desktop's filesystem MCP server pointing at the Active folder. The user works in GeoSonel as normal; Claude reads the mirror to understand the current score and writes to it to propose edits. The user sees Claude's changes appear in the editor within the same debounce window, can accept them by saving or revert them through the undo history. A bidirectional conversation about the score does not require any explicit Hand Off / Fetch gestures, which was a friction point in the v2.3 AI Handoff design. Other AI tools (Cursor's MCP, ChatGPT with filesystem access, custom scripts) can use the same folder; the mirror is tooling-agnostic.

Phasing.

Phase 1 (stage 4 of the Electron migration; see Section 29) ships the composition mirror as described above. Files: scene.json, behaviours.js, image, snapshot.png, snapshot-annotated.png, snapshot-description.md, active-score.json, sceneSchema.md, AGENTS.md. Mechanics: temp-and-rename echo prevention, quiescence-based debouncing, `.pending` sentinel with timestamp-based orphan handling, all-or-nothing validation with rollback, rich `lastApplyResult` error reporting.

Phase 2 adds event logging via three new observation-only files: run-log.ndjson, run-summary.json, and run-log-schema.md.

run-log.ndjson captures musical and sound-engine events as they happen during a run: noteOn, noteOff, suppressed, controlChange, and similar event types. Each event carries time (transport-relative seconds plus wall-clock timestamp), event type code, source object reference, source object position at event time, MIDI parameters (channel, note, velocity), cause and trigger reason (which cursor crossed which trigger, which sprite-cursor collision, which beat boundary, which pattern step), cursor position when applicable, and pattern evaluation context where applicable. noteOff events carry a reason field (natural, voiceStolen, transportStop, overriddenByNoteOn) — and when stolen, the stealing source is named — so the AI can answer "why was this note cut short". Suppressed events carry a reason (patternEmittedRest, objectMuted, voiceLimit) so the AI can distinguish "nothing happened" from "something happened but was suppressed", which is what most "why didn't this note fire" questions actually require.

The log's wire format is optimised for AI token consumption rather than human readability. The first line of run-log.ndjson is a header object declaring the schema (the ordered list of field names), enum tables for event types and cause kinds (each as a short code mapping to a small integer), and an object/cursor legend mapping each scene-object id present at run start to an integer index. Each subsequent line is a positional JSON array matching the header's schema. Roughly: `[t, ty, o, px, py, n, vel, c, cx, cy, reason]`. Objects present at run start are referenced by their legend index (numeric); objects added mid-run appear as full string IDs directly in the same position. The reader's decode rule for the object field is: if numeric, resolve through the legend; if string, use directly. This keeps the format simple, the header stable for the file's lifetime, and the dynamic case handled without delta-legend protocols. Deletions and renames don't break the format; legend references are historical and remain valid for the moment the event occurred. A typical 5-minute busy run produces a few hundred KB of NDJSON rather than the megabytes a verbose format would generate.

run-summary.json aggregates the same run into per-object stats (event count, noteOn count, suppressed count, time range, pitches emitted, average velocity, suppression reasons grouped by cause), per-pitch stats (count, sources, time range, average velocity), per-time-bucket stats (events per 10-second window, dominant objects), and totals. The summary is the AI's first read for time-based queries; most questions about a run are answerable directly from the summary. The raw log is read only when the summary points to a question the raw events answer better — typically narrow time-slice queries. The AI can also use filesystem grep-style tools to filter the raw log by object id or pitch without loading the whole file.

run-log-schema.md is an observation-only reference describing run-log.ndjson's wire format and code tables, so the AI grounds its decoding against documentation rather than reconstructing the format from samples.

Implementation hooks for Phase 2 sit at the central note-emission function in the simulation layer (wherever notes leave the simulation toward MIDI or superdough). The hook captures whatever is in scope at the call site — source object, cursor that caused firing, pattern context if applicable — and queues an event. Writes are async-buffered to avoid disk-IO stalls during play, flushed periodically and on transport stop.

Phase 3 and beyond. The on-demand motion-query mechanism (AI writes motion-query.json with time range and filter; bundle responds with motion-result.json) is warranted only if run-log grows large enough that grep-style filtering on it becomes too expensive. Continuous motion sampling (per-object position and velocity at low frequency, around 1 Hz), per-run persistence in a motion-history/ subfolder, and a SQLite database layer (originally proposed in 15.1) sit further out, sequenced when their concrete use cases crystallise. None of these change Phase 1's file shapes.

Forward-compatibility hooks baked into Phase 1. `protocolVersion` in active-score.json lets the file evolve without breaking AI tooling that reads earlier versions. `files.roundTrip` and `files.observationOnly` are dynamic arrays, so later phases append new file names without changing the schema. `transport.elapsedSeconds` and `transport.beat` give future motion or event data a time-reference point baked in from day one. The schema reference file establishes the precedent that schemas evolve through reference documents the AI consults rather than through breaking changes to the embedded schema. The protocol is file-based and additive: new capabilities are new files, existing files don't change shape.

Relationship to other authoring routes. The disk mirror is a fourth way to modify a score, alongside the JSON tab, the Behaviours tab, and the canvas direct-manipulation toolbar (see Section 14). All four routes converge on the same in-memory bundle, the same explicit-save model, and the same parse-mutate-stringify edit pipeline. AI edits via the mirror end up calling the same bundle.updateContent path that the canvas toolbar calls, so the existing dirty-state tracking, the auto-rerun mechanics, the formatting-preservation logic, and the property inspector's data binding all apply without modification.

Timeline placement. The composition mirror (Phase 1) is implemented at stage 4 of the Electron migration (see Section 29). Phase 2 is the natural successor; subsequent phases are scheduled when warranted. All disk-mirror features are Electron-only; users running the web build (if one continues to ship) do not have access, since the mechanism cannot be made reliable in a browser context.

Open considerations. Items deferred from the Section 15 design pass for discussion before or during Phase 1 implementation. None are blockers; each shapes the surface in a noticeable way and is worth settling rather than locking in by default.

View state beyond transport. The Phase 1 active-score.json captures transport state and the dirty flag, but does not surface the user's current view: zoom level, pan offset, current selection, focused tab. The original framing for this work included "current view state," so the question is whether the AI should see what the user is currently looking at (enabling references like "the trigger you have selected") or whether that's scope creep best left for a later phase. Decision pending.

Image round-trip semantics. The image file is currently listed as round-trip, allowing the AI to replace the score's background image entirely. Replacement is more destructive than a typical scene.json edit since the image is often the compositional starting point, so demoting it to observation-only for v1 — with image changes flowing through the regular File menu instead — would be safer. Decision pending.

Discoverability and AI-activity awareness. Per-event notifications in the message area cover individual edits and rejections, but there is no persistent indicator of mirror state. A transport-bar status block showing "idle / pushing / receiving / Claude rejected" would help users build a mental model of what's happening behind the scenes. Worth designing once Phase 1 is in real use and the felt gap is concrete.

Coordinate-system consistency in AI-facing artifacts. scene.json positions use the 1000x1000 image space; the canvas renders at scaled pixel coordinates depending on viewport size; annotated labels in snapshot-annotated.png need to bridge both (positions in canvas-pixel space, ids matching scene.json space). AGENTS.md must be explicit about the two coordinate systems so AIs do not conflate them when reasoning about positions. Drafting note for when AGENTS.md content is written.

MCP setup documentation surface. Users need to point their filesystem MCP server at ~/Library/Application Support/GeoSonel/Active/ to enable AI integration. This instruction needs a canonical home — AGENTS.md, a user-facing guide or README, or both. Worth settling when AGENTS.md is drafted so the instruction lives in one well-known place.

### Section 15.1 — Runtime history extensions (deferred)

Section 15's Phasing block describes the event-logging artifacts (Phase 2) and the on-demand query mechanism (Phase 3). This section captures two longer-horizon exploration directions, both deferred until the basic mirror and event log are in real use and the shape of actual compositional queries against them is clearer from practice.

History as a compositional substrate. A natural extension of the runtime log is to expose the same recorded history to the scene itself, so behaviour callbacks can query the recent past and use it as material for further composition. An object could echo notes it played four beats ago, transpose them up a fifth, and re-fire them; a second object could follow the spatial trajectory of a first object with a half-second delay; a third could play retrograde over a fixed window. Looper-style and music-transformer-style patterns fall out naturally once history is queryable from within the simulation. Canonic imitation, inversion, retrograde, path mimicry, echo with decay, and density-driven response are all expressible as queries against the recent past combined with the existing callback model.

The architectural shift this implies is that history becomes a first-class feature in the simulation, and the disk log becomes one projection of it (the asynchronous, persistent one, for AI access) rather than the primary representation. The simulation would maintain an in-memory history buffer with a configurable retention window; behaviour callbacks would query this buffer synchronously through a narrow API such as ctx.history.notesOf(object).inLast(beats: 4), ctx.history.positionOf(object).at(time: now - 2.0), and ctx.history.collisionsOf(object).since(time: 0). The disk writer would flush the same data asynchronously without coupling to the synchronous query path. Query results would be read-only arrays; the simulation does not let callbacks mutate the historical record.

Phrase extraction. The user listening to a generated score often hears something they want to keep — a bass line between 8 and 10 seconds, a melodic phrase a particular object happened to play, the rhythmic interlock at a moment of high density. The runtime log records all the material needed to recover that phrase exactly. A phrase-extraction feature would let the user (or the AI on the user's behalf) query a time window with an optional object filter and write the result out as a portable musical artifact — a standard MIDI file for universal DAW use, a Strudel mini-notation pattern for self-contained GeoSonel reuse, or a bundle-native clips format preserving fuller metadata. The direct user gesture is a region-select on the transport timeline followed by an Extract Phrase command; the AI-mediated path is conversational, with the AI reading the runtime log to identify events matching a natural-language description.

Both extensions share a data model: queries against the recorded runtime, one producing a callback-readable in-memory array for the simulation to consume during the same run, the other producing an on-disk file for use outside this run. Designing the runtime substrate so it can serve both consumers — a synchronous, narrowly-scoped query API for the simulation and an asynchronous, file-producing export API for phrase capture — is the architectural decision the runtime extensions commit to when their detailed design happens. Both extensions then follow as natural elaborations of the same substrate.

Like all phases beyond Phase 2, these are captured as exploration directions rather than committed features. Detailed design happens when the basic mirror and runtime log are in real use and the shape of useful queries and extractions is clearer from practice.
