## Section 31 — Semantic Code Speech Layer

This section captures the design of a CodeMirror 6 extension that provides synchronized speech and visual highlighting of source code, intended as an accessibility provision for low-vision developers. It sits alongside Section 26 (Accessibility) as a separate, larger provision rather than a sub-point inside that section, because the surface area (extension architecture, dictionaries, JSDoc annotations, speech engine, walker rules) is substantial enough to warrant its own treatment.

Status. Design only. No implementation has been started. The extension is envisioned as a long-term CodeMirror plugin that may eventually be released for others to use, but the immediate scope is internal to GXW. The first integration point is GXW's tabbed code editor, where the user reads and edits behaviors.js for the active score.

### Initial implementation scope

The v0.1 target is the Code tab in GXW only, where the user edits behaviors.js for the active score. This is a much narrower scope than reading arbitrary JavaScript source. The function vocabulary in behaviors.js is bounded to three sources: GXW helpers (which get @group and @arg annotations in the helper library source as part of authoring), strudel functions called from patterns, and a small set of JS standard library calls.

The scope narrowing simplifies several layers significantly. The pronunciation dictionary that matters is small, covering the user's own identifiers (signal names like pxChr, helper names like mapClip, common ambient identifiers like ctx) rather than an open-ended set. Convention inference and the project-level overrides JSON described in later subsections fall to near-zero importance for v0.1, because most relevant functions are either user-owned and annotated directly or part of the helper library. The broader design they support is retained in this document for a later version that may extend reading to arbitrary JavaScript code if that proves useful in practice.

### Purpose and user profile

The user reads code under substantial macOS Zoom magnification. Under that magnification the user can see and read any specific identifier, literal, or punctuation mark in the source. What is lost is structural overview. Only a few characters fit in the viewport at any moment, sometimes only part of a long identifier name, and there is no way to glance at a whole expression to grasp its shape.

This layer fills that overview gap. The user points the mouse pointer at a line of code, presses a keyboard shortcut bound on the macro pad, and the system speaks a compressed semantic description of that line while visually highlighting the regions the speech refers to. The speech is intentionally terse and assumes domain context, in the style of two developers discussing code they both already know. The user can still zoom into any highlighted region to read its literal content.

The system is therefore not a screen reader. Screen readers transcribe the visual layout for a user who cannot see it. This layer interprets the structure for a user who can see the screen but cannot take it in at scale. Literal mode (reading every character of code) is explicitly out of scope; the user already gets literal reading via Apple Speak Selection when needed.

### Architecture overview

The layer is a CodeMirror 6 extension running in the GXW Electron renderer. It consists of five conceptual parts.

A pointer tracker captures the current mouse position and maps it to an editor position via the editor's posAtCoords.

A tree walker descends the Lezer syntax tree from a chosen target node (the enclosing expression statement, or the smallest enclosing sub-expression containing the pointer) and emits a queue of speakable chunks paired with their source ranges.

A dictionary layer supplies the speech text for identifiers, including substitution (pxChr to "chroma", mapClip to "map clipped") and elision (ctx, this, self silenced when used as the object of property access).

A speech engine renders each chunk through the browser SpeechSynthesis API while a decoration manager keeps a CodeMirror decoration set in sync with the chunk currently being spoken.

The runtime never calls an AI service. Every lookup is local and synchronous. AI is used only offline, by a separate tool, to propose new dictionary entries the user reviews and commits.

### Pointer-driven targeting

Two keyboard shortcuts cover the common reading actions. The first reads the whole enclosing expression statement at the pointer, ending at the next semicolon even if the expression spans multiple physical lines. The second reads the smallest enclosing sub-expression containing the pointer (typically a function call, a binary expression, or a member access), which lets the user drill into one piece of a long line.

A selection-based override covers the cases where the pointer is on the wrong thing or the user wants to read exactly a hand-picked region. If a non-empty text selection is present when the shortcut fires, the selection range becomes the target instead of the pointer-derived range.

The text cursor in the editor is not a targeting input. The pointer is the sole targeting mechanism, consistent with how the user already drives macOS Zoom.

### The walker and chunk queue

Given a target syntax node, the walker descends recursively and emits a sequence of chunk records. Each record carries spoken text and one or more source ranges to highlight while that text is being read. The highlight may cover a single contiguous span or several disjoint spans; a CodeMirror decoration set supports both shapes natively.

A call expression emits a chunk for the function name (read through the pronunciation dictionary), then a chunk per argument or per argument group. Argument groupings come from JSDoc annotations on the function definition (see Function Signature Annotations below) or from convention inference (see Convention Inference and Overrides below).

A variable declaration or assignment reads as "x is expr" with the let or const keyword silenced. The expression on the right gets walked recursively. Compound assignments like `x += y` get a single consistent reading from the operator speech table.

A binary expression consults the operator speech table for the connecting word and walks the operands recursively. A multiplication reads "a times b" by default, an addition reads "a plus b", a comparison reads "a equals b" or "a less than b". The default table is intended to be good enough that the user rarely touches it.

An if statement reads "if cond, then body, else body" with the keywords spoken because they carry the structural intent. The braces are silent and visible only through the highlight. A ternary expression uses the same template inline.

A member access expression reads through the pronunciation dictionary. With ctx and similar identifiers marked for elision, `ctx.pxChr` reads simply as "chroma" while the highlight still covers the full ctx.pxChr range so the user sees what the spoken word refers to in context.

A method call chain reads as the chain in order with the dots elided: `obj.foo(x).bar(y)` reads "foo of obj with x, then bar with y". Each segment is its own chunk and is produced by the same rule that handles any call expression.

An object literal reads as a sequence of "key is value" chunks. Braces and commas are silent. Long object literals are typically not read in isolation; the user reads the surrounding statement and lets the highlights show structure.

An arrow function reads "function of params returns expr" for a single-expression body, or "function of params, then body" for a block body. Parentheses and the arrow are not spoken.

A return statement reads "return expr" with the keyword spoken because the keyword carries the function's intent.

Decorative syntax (parentheses, commas, semicolons, braces, declaration keywords) is silent throughout. The highlight does the work of indicating where the speech sits in the source.

A worked example. The expression `mapClip(ctx.pxChr, 0, 1, 0.2, 0.8) * ctx.beat`, where mapClip carries @group annotations pairing arguments 2-3 as "input range" and arguments 4-5 as "output range", produces five chunks (shown schematically as text plus ranges):

```
[
  { text: "map clipped",     ranges: [ mapClip ] },
  { text: "chroma",          ranges: [ ctx.pxChr ] },
  { text: "input range",     ranges: [ 0, 1 ] },
  { text: "output range",    ranges: [ 0.2, 0.8 ] },
  { text: "scaled by beat",  ranges: [ * ctx.beat ] }
]
```

Playback walks this queue sequentially: highlight the chunk's ranges, speak the text through SpeechSynthesis, await the utterance's onend event, advance to the next chunk.

### Pronunciation dictionary

The pronunciation dictionary is a project-level JSON file mapping identifiers to spoken phrases. Two operations are supported.

Substitution rewrites an identifier as a different phrase. pxChr becomes "chroma", mapClip becomes "map clipped", vel becomes "velocity". The substitution is applied whenever the identifier is spoken in any role.

Elision silences an identifier entirely when it appears as the object of a property access while still keeping it in the highlight. ctx, this, and self are the canonical examples: they are ambient context that everyone working in the codebase already knows is there, so spoken aloud they add noise without information. With ctx marked for elision, ctx.pxChr reads as "chroma" while the highlight still covers the full ctx.pxChr range. An elided identifier in a non-elision-eligible role (standalone reference, function call, assignment target) is still spoken normally.

The dictionary is not hand-written. The intended workflow is for an AI review pass over the codebase to propose candidate entries, which the user reviews, edits, and commits. The runtime never invokes the AI; it only consumes the resulting JSON.

### Function signature annotations

The walker needs to know which arguments of a function call belong together as one semantic chunk. Arguments 2 and 3 of mapClip form an input range that should speak as "input range" rather than as two separate numbers. This information comes from JSDoc-style annotations in the comment block above each function the user owns.

Two custom tags cover the common cases:

```
/**
 * Maps a value from an input range to an output range and clips.
 * @group inputMin, inputMax as "input range"
 * @group outputMin, outputMax as "output range"
 */
function mapClip(source, inputMin, inputMax, outputMin, outputMax) { ... }
```

@group identifies a set of parameter names that should be spoken as one chunk with a shared label. @arg supplies an alternate spoken name for a single parameter when the parameter name itself does not read well. The plain JSDoc description sentence provides the longer-form explanation if and when an expanded reading mode is added later.

A small parser extracts these annotations at load time and produces an in-memory signature dictionary. The user never edits that dictionary directly; the source of truth is the JSDoc above each function. The discipline is to annotate functions as they are authored, so the speech layer is correct from the first reading session that includes the new function.

### Parameter name tooltips (v0.1)

Decision settled during v0.1 implementation: the JSDoc-annotation machinery in Function signature annotations above is not built. Argument grouping in the spoken reading is set aside as too verbose for everyday use; every multi-argument call would gain seconds of named-argument speech, which would dominate the reading rather than supplementing it. Instead, parameter names surface as CodeMirror hover tooltips so the user can read them visually when they want detail on a specific argument, without lengthening the speech. The speech reading itself remains structural-only as the walker produces it in Commit 4: each argument reads as its value with no name prefix.

The tooltip behaviour. Hovering on an argument inside a function call surfaces a small tooltip below the argument showing the parameter name for that argument, e.g. `input min`. Hovering on the callee identifier of a call surfaces the full signature on one line, e.g. `mapClip(signal, input min, input max, output min, output max)`, giving a quick scan of all parameter names without per-argument hovering. Hovering outside a known call surfaces nothing. Tooltip text is styled for legibility under macOS Zoom (large font, high contrast against the editor's dark theme) and is selectable so the user can drive Apple Speak Selection over it via the macro pad if they prefer hearing the name to reading it. The per-argument tooltip omits the function name to keep the box narrow enough to fit inside the screen-zoom viewport without being clipped on either side; the function name is available on the callee hover when needed.

Source of tooltip content. A project-level signatures file at `src/codeSpeechSignatures.js` exports an object mapping function name to an ordered array of parameter names. For mapClip the entry is the array `["signal", "input min", "input max", "output min", "output max"]`; tooltips index into the array by argument position. The lookup key is the rightmost identifier of the callee, so both plain calls (`mapClip(...)`) and method calls (`pxLt.range(...)`) use the same dispatch, accepting that method-name collisions are possible across objects and tolerable for v0.1. If a collision matters in practice the key format can grow to `Object.method` qualifiers later.

Maintenance. The signatures file is Claude-maintained, not user-written. When a new helper function is added to the codebase, the user asks Claude to add a corresponding signature entry; Claude appends the entry with parameter names taken from the function declaration. Functions without an entry surface no tooltip, the same as everything outside a known call, so the file grows additively and never breaks reading of unsupported calls.

Relation to the full JSDoc design above. The JSDoc-annotation design remains the long-term target for the spoken side; nothing in the v0.1 tooltip surface precludes that work. If speech-side grouping proves useful in practice in later versions, the signatures file's per-argument names can grow into the JSDoc shape (groups of arguments with shared labels), the walker can emit per-group chunks rather than per-argument, and the tooltip can render from either the simple array or the grouped structure.

### Convention inference and overrides

For functions the user does not own (library calls, host APIs, third-party packages), JSDoc annotations are not available. The walker falls back to convention inference based on parameter naming.

Recognised patterns include: xxxMin and xxxMax in adjacent positions form an "xxx range" chunk; xxxStart and xxxEnd similarly; r, g, b in adjacent positions form a "color" chunk; x, y form a "point" chunk; x, y, z form a "vector" chunk. The patterns are encoded in a small built-in inference table.

Where inference produces a wrong reading on an important third-party function, a project-level overrides JSON file supplies an explicit signature entry that wins over inference. The three streams (JSDoc-extracted signatures, convention inference, overrides JSON) merge into a single signature dictionary at load time, with explicit overrides winning over inference and JSDoc winning over both.

For v0.1 (see Initial implementation scope above) this entire layer is deprioritized because the Code tab function vocabulary is bounded and largely user-owned.

### Operator speech table

Operators carry semantic load that does not live in any function's annotation. A multiplication of two expressions reads as "a times b". An assignment reads as "x is expr". A logical-and reads as "a and b". These readings come from a built-in operator speech table.

The v1 table assigns one consistent reading per operator. The same operator never reads as different words depending on context. Context-aware variants (multiplication reading as "scaled by" when the right operand is a single scalar identifier, for instance) are deferred to a later version once the consistent-reading baseline is in use.

The table is editable per project but the default is intended to be good enough that the user rarely touches it.

### Speech engine

The browser SpeechSynthesis API in the Electron renderer is the speech engine. On macOS it uses the same system voices that Apple Speak Selection uses, so the voice quality matches what the user already knows.

For each chunk in the queue the system creates a SpeechSynthesisUtterance with the chunk text, sets an onend handler that advances to the next chunk, and calls speechSynthesis.speak. Interruption is handled by speechSynthesis.cancel, which clears the queue immediately. When a new shortcut fires while the previous chunk is still in flight, the new request wins.

Per-word events through onboundary are available if sub-chunk highlight animation is wanted later. Chunks are typically short enough that whole-chunk highlight is sufficient for v1.

macOS Speak Selection itself is not usable as the engine for this layer because it cannot be driven programmatically from a renderer process and provides no chunk-boundary callbacks. The browser API supplies both.

### Visual highlighting

CodeMirror 6 decorations cover the highlighting machinery. A decoration set with multiple disjoint ranges supports the non-contiguous case where one chunk highlights two or more separate spans, for example the "input range" chunk highlighting both inputMin and inputMax positions.

Highlight visibility under macOS Zoom magnification with dark mode demands more than a subtle background tint. The intended default is aggressive: a saturated background colour plus a contrasting border or outline around each range. Non-contiguous ranges share their styling so the user reads them as one chunk; a faint connecting underline or a synchronous pulse may help reinforce the grouping. The exact visual styling is to be settled once implementation begins.

### Known challenges

Five risks are flagged for the design phase, in rough order of how much they could degrade or block the project.

Voice quality on technical content. The macOS voices stumble on identifiers, abbreviations, and acronyms before the pronunciation dictionary covers them. This is a real risk to first-day usefulness and argues for putting energy into the AI-assisted dictionary bootstrap early rather than building speech machinery first and dictionaries later.

Cold-start verbosity. Before the dictionaries have meaningful coverage, the first reading sessions will be verbose and clunky in a way the design implicitly assumes away. The build order should pair a minimal speech pass with a minimal dictionary so the first usable reading is already in semantic mode rather than literal.

Highlight visibility under the user's vision profile. Subtle visuals do not work at the user's magnification level in dark mode. The default needs to be aggressive enough to be obviously visible, and non-contiguous highlights need a convention that conveys their grouping.

SpeechSynthesis quirks. The browser API has known issues with cancel races (onend not firing reliably on cancelled utterances), asynchronous voice loading at startup, and stutter on rapid consecutive triggers. These are managed with defensive code (a state machine around speak and cancel, plus a voiceschanged listener) rather than redesigned around.

Maintenance drift. Annotations fall out of date as code evolves, dictionaries lag behind new identifiers, and speech quality degrades silently. A periodic AI re-review of the codebase, and a "show me uncovered identifiers" command in the extension, are the two answers worth wiring in early.

### Build phasing

The implementation breakdown below targets the v0.1 scope (Code tab in GXW, behaviors.js reading). Roughly eight commits, with the first five giving a usable spoken reading and the last three polishing it.

Commit 1, scaffold. CodeMirror extension wired into the Code tab. One keyboard shortcut. Pointer position mapped to editor position via posAtCoords. Find the enclosing expression statement. Log it.

Commit 2, speech wiring. Speak the raw statement text through SpeechSynthesis, with cancel-based interruption.

Commit 3, walker and chunks for the core forms. Call expression, member access, identifier, literal. Chunk queue with synchronized highlights via CodeMirror decorations.

Commit 4, the rest of the walker rules. Assignment, binary expression, ternary, return, arrow function, object literal. Decorative syntax silent throughout.

Commit 5, dictionary and operator table. Pronunciation substitution, elision for ctx and this, built-in operator speech table.

At this point the system speaks reasonably on most lines.

Commit 6, JSDoc signature annotations. Parse @group and @arg from comments above functions. Annotate the helper library (mapClip, scaleNotes, chordNotes, midiNote, the signal transforms) in the same commit so the speech compresses correctly from the moment the parser lands.

For v0.1 this commit was replaced with the simpler tooltip surface described in Parameter name tooltips above: a signatures file carrying just per-argument names that powers a CodeMirror hover tooltip, with no change to the spoken reading. The original JSDoc design is retained for a future version if speech-side argument grouping proves desirable in practice.

Commit 7, highlight visual styling. Iterate on saturation, border, opacity until the highlight is obviously visible under macOS Zoom in dark mode. Non-contiguous grouping convention for chunks whose ranges are disjoint.

Commit 8, interruption robustness and voice load handling. Defensive code around the known SpeechSynthesis quirks (cancel races, asynchronous voice loading, stutter on rapid consecutive triggers).

v0.2 and beyond. The sub-expression shortcut and the selection-based override land in v0.2, along with a small overrides file for strudel surface that does not annotate cleanly. Convention inference and broader code-reading scope (reading arbitrary source beyond behaviors.js) extend in later versions if Code-tab usage suggests they are worth it.
