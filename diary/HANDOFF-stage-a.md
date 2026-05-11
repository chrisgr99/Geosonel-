# Handoff — Stage A continuation (pattern authoring pivot)

Working reference for the next conversation. The doc-leads-code work that established the labelled-statement design in section 28 of DESIGN.md is committed; Stage A1 of the five-stage code sequence (drop Band 4 inspector pattern editor) is committed and tested. Stages A2 through A5 remain.

Read this first, then read section 28 of DESIGN.md as the spec, then the most recent diary entry at diary/2026-05-11-pattern-authoring-pivot-and-stage-a1.md for the narrative.

## Project orientation

GXW is a browser-based JavaScript music app at /Users/chrisgr/ProgrammingProjects/GXW. Scenes contain curves, sprites, and triggers. Each object can carry a cyclePattern (a strudel mini-notation or pattern expression) plus three JavaScript callbacks (hasHit, beenHit, onTick). Behaviors.js holds the callback function bodies and, after the design pivot, the labelled-statement pattern blocks. Scene.json holds declarative data including the active cyclePattern value per object.

The Code tab in the editor displays behaviors.js with CodeMirror plus Acorn-driven syntax linting. The Properties tab displays the property inspector. The canvas pane shows the scene.

## User context

Chris has limited eyesight. He uses macOS Accessibility Zoom (mapped to a macro pad knob for quick zoom level changes) and Speak Selection (mapped to a Hammerspoon TripleClick spoon bound to Ctrl+Alt+S) to read text aloud paragraph by paragraph. These accessibility tools shape everything about how he interacts with the screen; the chat-response style rules in Workflow Conventions below matter because text he cannot see well or hear cleanly is text he cannot use.

He works from a recliner with a monitor on an articulating arm, and inputs primarily via speech-to-text dictation. His keyboard time is limited; he does not type long passages. Design proposals should be substantive enough to react to with a brief spoken response rather than requiring him to type long replies.

TextEdit is broken on his Mac at the moment (Launch Constraint Violation from a corrupted shared cache) and will be fixed when he upgrades macOS. If a workflow ordinarily routes through TextEdit, route through VS Code or another editor instead.

Chris is a confident programmer who reads code fluently and has built GXW, the GX2 Python predecessor, an Arduino-based HIDTransformer trackball customisation project, and other adjacent work. He does not need verbose explanations of standard JavaScript or design-pattern mechanics. Spend explanation effort on the specific choices being made, not on the language or library itself.

He runs the GXW dev loop manually: edit files, refresh the browser, click around. There is no test framework wired up; testing means run the app and try it. This is fine for the current stage; do not propose adding a test framework unless he asks for one.

## Workflow conventions

### Response style in chat

Plain prose paragraphs only. No headers, no bullet points, no numbered lists, no bold or italic emphasis, no emojis. Chris reads chat responses via macOS Speak Selection text-to-speech, so visual structure that the screen reader cannot voice (headers, bullets, bold) becomes silent noise that fragments the reading flow. Even short replies should be flowing sentences. The only exception is when Chris explicitly asks for a list or comparison; in that case use a numbered list rather than bullets so the items have spoken structure.

This rule applies only to chat replies. File content created for the project can use whatever structure fits (existing diary entries are flowing prose with one top-level header; design docs use double-hash subsections; this handoff file uses double-hash subsections because it is a reference doc that gets scanned). The constraint is specifically about what appears in the assistant's chat replies, not what gets written into files.

Inline backticks for short identifiers, paths, or commands within prose are fine — TTS handles them gracefully. Triple-backtick code blocks are appropriate sparingly for command sequences Chris will copy and paste, like git invocations. Do not use code blocks as quasi-paragraphs or for prose explanations; that pulls the content out of the natural reading flow.

Do not paste full file contents back into chat for verification after making file changes. Describe at a high level what was added, what was removed, and the rationale. Chris reads the file directly if he wants to verify. The exception is when he explicitly asks to see specific content; even then, quote the minimum that answers the question.

Long replies in general should be avoided. After a tool sequence, a few sentences summarising what changed and what to test is usually right. Chris asks for more detail when he wants it.

### Doc leads code

Design decisions land in DESIGN.md sections (or other design files) before the code that implements them. The doc is committed first, then code is committed in small testable stages. Each stage is independently buildable and testable. This applies even for small features — the design write-up forces clarity before code is written, and the doc-first commit gives Chris a chance to push back on the design before any code has been spent on it. If a design point comes up mid-coding that was not in the doc, pause the code work, propose the design update, get agreement, write the doc change, and only then go back to code.

### Commit rhythm

After making code changes, describe what was changed in chat but do not propose a commit message until Chris has built, run, and confirmed the changes work. Once he confirms, propose a commit message (subject line plus optional body explaining what shipped and what it sets up). Wait for him to actually commit before moving to the next stage.

Stage planning. Within a multi-stage plan like Stage A's five commits, pause between stages for testing. Do not chain stage implementations without giving Chris a chance to verify each one. Five small commits beat one big commit even when the small ones are individually trivial — the bisect history stays clean and each commit message captures one concept.

Chris runs all git commands himself in his terminal. The assistant does not have shell access in this environment. After file changes are made via the filesystem MCP, propose the git add and git commit sequence; Chris executes it.

### Tool call etiquette

Do not pre-announce filesystem or other tool calls. Just make the calls and summarise what changed afterwards. Saying "I will first read X, then edit Y, then check Z" is exactly the kind of structural noise that adds nothing for someone using TTS and slows the response.

For clarifying questions during a design discussion, ask in plain text prose. Do not use the ask_user_input multiple-choice tool — it does not fit Chris's keyboard-and-dictation flow and turns nuanced design conversation into a forced-choice survey.

### Test inputs

When Chris provides test inputs in chat (strings he wants tried in a test case), drop any surrounding quotes when consuming them. His dictation types quote characters literally, so a string he describes as "spr1" usually means spr1 without the quotes.

### Dictation interpretation

Interpret dictation errors charitably. Characteristic substitutions to recognise: geologic or geosciences means GeoSonix; gem maestro means GeoMaestro; note dot JS means Node dot js; map sometimes means Mac; VS code or BS code means VS Code; based font means monospaced font; dock sometimes means doc; boobies sometimes means Chris's. There are others; if a sentence does not parse cleanly, look for a homophone or near-homophone that does.

### Filesystem MCP quirks

The filesystem MCP server exposes read, write, edit, and list operations but no delete or move. To remove a file, ask Chris to run git rm from his terminal as part of the commit step.

The edit_file tool can corrupt files when oldText contains backtick-dollar combinations and the match is ambiguous; recovery is via git checkout or full write_file rewrite. For content reorganisation rather than localised edits, write_file is safer than edit_file even though it requires composing the full file content. write_file truncates around 30000-plus characters, so very large files cannot be rewritten in one call; split content across smaller files or use a series of edit_file calls in that case.

The MCP filesystem server's wrapper script is at /usr/local/bin/npx-for-claude. Allowed directories are ~/Documents, ~/ProgrammingProjects, and ~/.hammerspoon. Anything outside these paths is not accessible.

## Key file paths

Repo root: /Users/chrisgr/ProgrammingProjects/GXW

Design:
DESIGN.md TOC at design/DESIGN.md.
Section 27 (language and runtime, stable) at design/sections/section-27-strudel-pattern-language.md.
Section 28 (pattern authoring and cursor model, the spec for Stage A) at design/sections/section-28-pattern-authoring-and-cursor-model.md.
PLANNING.md is the early scope doc; not a current status file.

Diary:
Most recent at diary/2026-05-11-pattern-authoring-pivot-and-stage-a1.md.
Earlier at diary/2026-05-10-cursor-as-collider-stage-plan.md and prior.

Code:
Main entry at main.js.
Scene loader (Acorn pre-processing target for Stage A2) at src/sceneLoader.js.
Inspector (Stage A3 target for the pattern row) at src/inspector.js.
Code tab editor (Stage A4 target for Cmd-Enter routing, Stage A5 for active-tag decoration) at src/editor.js.
CodeMirror theme at src/cmTheme.js (kept; used by editor.js).
Pattern parser at src/strudel/patternParse.js.
StrudelRuntime at src/strudel/runtime.js.
Scene editor (sceneEditor) at src/sceneEditor.js (has setCyclePatternOnSelection).
Scene module at src/scene.js.
Bundle at src/bundle.js.
Messages console at src/messages.js.
Main CSS at main.css.
Index at index.html.

src/patternEditor.js was removed in Stage A1; do not reference.

## Stage A progress

Stage A1 — DONE and committed. Dropped the inspector's Band 4 editor. Inspector now renders three bands plus bottom spacer. The cyclePattern schema field still exists on objects, values in scene.json still drive the runtime, but there is no UI to edit cyclePattern until Stage A3 lands. The setCyclePattern dispatch in main.js stays (dormant, will be re-emitted from Code tab in A4). The cyclePatternParseError dispatch is gone. Band 4 CSS removed. main.css's .inspector-panel comment updated. patternEditor.js removed via git rm. cmTheme.js stays.

Stage A2 — PENDING. Add Acorn pre-processing for inertness at scene-load. Extend the existing extractTopLevelFunctionNames in sceneLoader.js with a splitLabelledStatements(source) function that returns {strippedSource, labelledBlocks}. Loader flow becomes: parse scene.json, Acorn-parse behaviors.js for function names AND split labelled statements, execute stripped JS only for function registration, attach labelledBlocks to the Scene as a per-object pattern table. A labelled block is a top-level AST node of type LabeledStatement whose label.name starts with the dollar character. The block's body is the statement after the colon; extracting the expression source means slicing the original source string by node.body.start/end. Store each block as an object containing the objectId (stripped of leading dollar), the expressionText (the source slice), and the range. The labelled blocks table on the Scene need not be consumed by anything in this stage; it is set up for Stages A4 and A5. Test after landing: a behaviors.js with a labelled block like dollar-spr1 colon note open-c-d-e-f-close should load cleanly without executing the note() call.

Stage A3 — PENDING. Add a fourth row to Band 3 of the inspector: the pattern row. Row layout: label pattern, no checkbox, no function-name field, a Create / Go-to button. Button behaviour: when no labelled block exists for the selected object in behaviors.js, click scaffolds an empty dollar-objectId colon block at the end of behaviors.js and switches to the Code tab with the cursor on the new block. When a block exists, click switches to the Code tab and scrolls to the first occurrence (a labelled block tagged with this object's id, or any callback function whose name follows the slotName_objectId convention — Go-to should match either). The Go-to lookup can reuse editor.js's existing selectTabAndScrollToFunction machinery, extending it to also match labelled-statement tags. The pattern row is only active for single-object selections (multi-select keeps the button disabled, similar to the existing Create / Go-to gating in the other three Band 3 rows). The pattern row's button does not have a Can-X checkbox alongside it because the canCycle gate is gone (cursor presence is derived from cursor extents and mute per the cursor-as-collider model). Test after landing: clicking the button on a fresh selection creates a labelled block and navigates; clicking again navigates without scaffolding a second block.

Stage A4 — PENDING. Add Cmd-Enter routing in the Code tab for labelled blocks. When Cmd-Enter fires in editor.js, walk the doc through Acorn to find the cursor's enclosing top-level statement. If that statement is a LabeledStatement with a dollar-prefixed label, extract the expression body source, parse it through parsePatternToPositions, write the expression body text to that object's cyclePattern field in scene.json (via setCyclePatternOnSelection or a dedicated edit kind), log the parsed positions to the GXW console, and re-run the scene. The selection emitted with the edit must be a single-object selection for the matched objectId, not the current canvas selection. If the cursor is not inside a labelled block, Cmd-Enter falls through to the existing Run Scene gesture. Parse failures log to the GXW console in error styling and keep editor focus; no scene change propagates. Empty patterns are valid (commit as the explicit no-pattern state, matching parsePatternToPositions's empty-input handling). Test after landing: cursor in a labelled block, Cmd-Enter, scene re-runs with the new cyclePattern; cursor outside a labelled block, Cmd-Enter falls through.

Stage A5 — PENDING. Add a CodeMirror decoration extension that highlights active block tags. The extension parses the doc via Acorn (or reuses Stage A2's split function if it can be made shared), walks for top-level LabeledStatement nodes with dollar-prefixed labels, and for each one looks up the named object in the scene; if the block's expression body text equals the object's cyclePattern value (text-equality, no normalisation), the extension adds a Decoration.mark on the tag range (the label.name plus the colon) styled in accent green. Inactive tags retain default name-token styling from cmTheme.js. The extension recomputes on doc change automatically via CodeMirror's standard view-update lifecycle; it also needs to re-trigger when scene.json changes (which happens after every Cmd-Enter on a labelled block), via a CodeMirror StateEffect dispatched from main.js or editor.js when setScene fires on the Inspector. Test after landing: a labelled block whose expression matches cyclePattern shows green tag; a duplicate labelled block with the same expressionText as the active one also shows green; editing the expression body so it no longer matches turns the tag back to pink.

## Critical design points

Multi-select preservation on Code-to-Properties tab switch. When the user is in the Code tab with a multi-selection on canvas and switches to Properties, if the cursor's enclosing block's object id is already part of the selection, the selection is preserved. Only if the cursor lands on an object not in the selection does the selection collapse to that one object.

Single-only scroll on Code tab while active. When the canvas selection changes and the Code tab is active, the editor scrolls only on single-object selection changes. Multi-object selections do not scroll the editor.

Text-equality for active-block matching. A block is active when its expression body text equals the cyclePattern value byte-for-byte (no whitespace normalisation, no AST equivalence). Duplicate blocks with identical text both highlight as active. The rule is intentionally simple.

Scene runtime cache vs editing surface. Per-object cyclePattern in scene.json is the runtime cache (currently-active pattern, expression body only, no dollar prefix). The Code tab is the editing surface (labelled blocks with dollar-objectId colon prefix, potentially multiple variants per object). Cmd-Enter is the only path that writes from the editing surface to the runtime cache. Scene reload reads from the runtime cache directly without touching the editing surface.

Inertness at scene-load via Acorn pre-processing. Labelled blocks never execute as part of scene-load; they are stripped from the JS that gets passed to new Function() and held as inert source text. Stage A2 is the precondition for Stage A3 because A3's Create button generates labelled blocks that would otherwise execute at load time and fail.

Cmd-Enter is an additive overload, not a replacement. Cursor in a labelled block routes to pattern activation. Cursor anywhere else (function body, untagged top-level statement, blank line) falls through to the existing Run Scene gesture.

## Suggested first turn

Read section 28 of DESIGN.md (it is the spec for everything Stage A does) and the most recent diary entry. Then propose the Stage A2 implementation in design terms before writing any code. Confirm the approach with Chris, then make the code changes. Pause for him to test before moving to A3.
