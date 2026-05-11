# Handoff — Stage A continuation (pattern authoring pivot)

Working reference for the next conversation. The doc-leads-code work that established the labelled-statement design in section 28 of DESIGN.md is committed; Stage A1 of the five-stage code sequence (drop Band 4 inspector pattern editor) is committed and tested. Stages A2 through A5 remain.

Read this first, then read section 28 of DESIGN.md as the spec, then the most recent diary entry at diary/2026-05-11-pattern-authoring-pivot-and-stage-a1.md for the narrative.

## Project orientation

GXW is a browser-based JavaScript music app at /Users/chrisgr/ProgrammingProjects/GXW. Scenes contain curves, sprites, and triggers. Each object can carry a cyclePattern (a strudel mini-notation or pattern expression) plus three JavaScript callbacks (hasHit, beenHit, onTick). Behaviors.js holds the callback function bodies and, after the design pivot, the labelled-statement pattern blocks. Scene.json holds declarative data including the active cyclePattern value per object.

The Code tab in the editor displays behaviors.js with CodeMirror plus Acorn-driven syntax linting. The Properties tab displays the property inspector. The canvas pane shows the scene.

## Workflow conventions

Doc leads code. Design changes land in DESIGN.md sections (or other design files) before the code that implements them. The doc is committed first, then the code is committed in small testable stages.

No commit messages until tested. After making code changes, describe what was changed at a high level in chat but do not propose a commit message until the user has built, run, and confirmed the changes work. Once confirmed, propose a message.

No pre-announcing of tool calls. Just make the calls and summarise after.

Plain prose responses. No bullets, headers, bold, or emojis in general conversation. The user reads responses via macOS Speak Selection text-to-speech; structure noise breaks the flow. File content can use structure (existing diary entries, design files use prose; this handoff file uses headers because it's a reference doc).

No pasting full file contents back in chat for verification. Describe changes at a high level. The user can read the file directly if needed.

Test inputs in chat: drop surrounding quotes (the user's dictation types them literally).

For sensitive edits to existing files, prefer multiple small edit_file calls over large rewrites. For full-file reorganisations or content moves, write_file is safer than edit_file but watch character limits (write_file truncates around 30000+ chars). The edit_file tool can corrupt files when oldText contains backtick-dollar combinations and the match is ambiguous; recover via git checkout or write_file rewrite if this happens.

The filesystem MCP has no delete or move operation. To remove a file, ask the user to run git rm from their terminal before committing.

## Key file paths

Repo root: /Users/chrisgr/ProgrammingProjects/GXW

Design:
- DESIGN.md TOC: design/DESIGN.md
- Section 27 (language and runtime, stable): design/sections/section-27-strudel-pattern-language.md
- Section 28 (pattern authoring and cursor model, the spec for Stage A): design/sections/section-28-pattern-authoring-and-cursor-model.md
- PLANNING.md is the early scope doc; not a current status file

Diary:
- Most recent: diary/2026-05-11-pattern-authoring-pivot-and-stage-a1.md
- Earlier: diary/2026-05-10-cursor-as-collider-stage-plan.md and prior

Code:
- Main entry: main.js
- Scene loader (Acorn pre-processing target for Stage A2): src/sceneLoader.js
- Inspector (Stage A3 target for the pattern row): src/inspector.js
- Code tab editor (Stage A4 target for Cmd-Enter routing, Stage A5 for active-tag decoration): src/editor.js
- CodeMirror theme: src/cmTheme.js (kept; used by editor.js)
- Pattern parser: src/strudel/patternParse.js
- StrudelRuntime: src/strudel/runtime.js
- Scene editor (sceneEditor): src/sceneEditor.js (has setCyclePatternOnSelection)
- Scene module: src/scene.js
- Bundle: src/bundle.js
- Messages console: src/messages.js
- Main CSS: main.css
- Index: index.html

src/patternEditor.js was removed in Stage A1; do not reference.

## Stage A progress

Stage A1 — DONE and committed. Dropped the inspector's Band 4 editor. Inspector now renders three bands plus bottom spacer. The cyclePattern schema field still exists on objects, values in scene.json still drive the runtime, but there is no UI to edit cyclePattern until Stage A3 lands. The setCyclePattern dispatch in main.js stays (dormant, will be re-emitted from Code tab in A4). The cyclePatternParseError dispatch is gone. Band 4 CSS removed. main.css's .inspector-panel comment updated. patternEditor.js removed via git rm. cmTheme.js stays.

Stage A2 — PENDING. Add Acorn pre-processing for inertness at scene-load. Extend the existing extractTopLevelFunctionNames in sceneLoader.js with a splitLabelledStatements(source) function that returns {strippedSource, labelledBlocks}. Loader flow becomes: parse scene.json, Acorn-parse behaviors.js for function names AND split labelled statements, execute stripped JS only for function registration, attach labelledBlocks to the Scene as a per-object pattern table. A labelled block is a top-level AST node of type LabeledStatement whose label.name starts with the dollar character. The block's body is the statement after the colon; extracting the expression source means slicing the original source string by node.body.start/end. Store each block as {objectId: stripped-of-leading-dollar, expressionText: source slice, range: [start, end]}. The labelled blocks table on the Scene need not be consumed by anything in this stage; it is set up for Stages A4 and A5. Test after landing: a behaviors.js with a labelled block like $spr1: note("c d e") should load cleanly without executing the note() call.

Stage A3 — PENDING. Add a fourth row to Band 3 of the inspector: the pattern row. Row layout: label "pattern", no checkbox, no function-name field, a Create / Go-to button. Button behaviour: when no labelled block exists for the selected object in behaviors.js, click scaffolds an empty `$objectId: ` block at the end of behaviors.js and switches to the Code tab with the cursor on the new block. When a block exists, click switches to the Code tab and scrolls to the first occurrence (a labelled block tagged with this object's id, or any callback function whose name follows the slotName_objectId convention — Go-to should match either). The Go-to lookup can reuse editor.js's existing selectTabAndScrollToFunction machinery, extending it to also match labelled-statement tags. The pattern row is only active for single-object selections (multi-select keeps the button disabled, similar to the existing Create / Go-to gating in the other three Band 3 rows). The pattern row's button does not have a Can-X checkbox alongside it because the canCycle gate is gone (cursor presence is derived from cursor extents and mute per the cursor-as-collider model). Test after landing: clicking the button on a fresh selection creates a labelled block and navigates; clicking again navigates without scaffolding a second block.

Stage A4 — PENDING. Add Cmd-Enter routing in the Code tab for labelled blocks. When Cmd-Enter fires in editor.js, walk the doc through Acorn to find the cursor's enclosing top-level statement. If that statement is a LabeledStatement with a dollar-prefixed label, extract the expression body source, parse it through parsePatternToPositions, write the expression body text to that object's cyclePattern field in scene.json (via setCyclePatternOnSelection or a dedicated edit kind), log the parsed positions to the GXW console, and re-run the scene. The selection emitted with the edit must be a single-object selection for the matched objectId, not the current canvas selection. If the cursor is not inside a labelled block, Cmd-Enter falls through to the existing Run Scene gesture. Parse failures log to the GXW console in error styling and keep editor focus; no scene change propagates. Empty patterns are valid (commit as the explicit "no pattern" state, matching parsePatternToPositions's empty-input handling). Test after landing: cursor in a labelled block, Cmd-Enter, scene re-runs with the new cyclePattern; cursor outside a labelled block, Cmd-Enter falls through.

Stage A5 — PENDING. Add a CodeMirror decoration extension that highlights active block tags. The extension parses the doc via Acorn (or reuses Stage A2's split function if it can be made shared), walks for top-level LabeledStatement nodes with dollar-prefixed labels, and for each one looks up the named object in the scene; if the block's expression body text equals the object's cyclePattern value (text-equality, no normalisation), the extension adds a Decoration.mark on the tag range (the label.name plus the colon) styled in accent green. Inactive tags retain default name-token styling from cmTheme.js. The extension recomputes on doc change automatically via CodeMirror's standard view-update lifecycle; it also needs to re-trigger when scene.json changes (which happens after every Cmd-Enter on a labelled block), via a CodeMirror StateEffect dispatched from main.js or editor.js when setScene fires on the Inspector. Test after landing: a labelled block whose expression matches cyclePattern shows green tag; a duplicate labelled block (same expressionText as the active one) also shows green; editing the expression body so it no longer matches turns the tag back to pink.

## Critical design points

Multi-select preservation on Code-to-Properties tab switch. When the user is in the Code tab with a multi-selection on canvas and switches to Properties, if the cursor's enclosing block's object id is already part of the selection, the selection is preserved. Only if the cursor lands on an object not in the selection does the selection collapse to that one object.

Single-only scroll on Code tab while active. When the canvas selection changes and the Code tab is active, the editor scrolls only on single-object selection changes. Multi-object selections do not scroll the editor.

Text-equality for active-block matching. A block is active when its expression body text equals the cyclePattern value byte-for-byte (no whitespace normalisation, no AST equivalence). Duplicate blocks with identical text both highlight as active. The rule is intentionally simple.

Scene runtime cache vs editing surface. Per-object cyclePattern in scene.json is the runtime cache (currently-active pattern, expression body only, no $ prefix). The Code tab is the editing surface (labelled blocks with $objectId: prefix, potentially multiple variants per object). Cmd-Enter is the only path that writes from the editing surface to the runtime cache. Scene reload reads from the runtime cache directly without touching the editing surface.

Inertness at scene-load via Acorn pre-processing. Labelled blocks never execute as part of scene-load; they are stripped from the JS that gets passed to new Function() and held as inert source text. Stage A2 is the precondition for Stage A3 because A3's Create button generates labelled blocks that would otherwise execute at load time and fail.

Cmd-Enter is an additive overload, not a replacement. Cursor in a labelled block routes to pattern activation. Cursor anywhere else (function body, untagged top-level statement, blank line) falls through to the existing Run Scene gesture.

## User context

Chris has limited eyesight and uses macOS Accessibility Zoom plus Speak Selection (mapped to a Hammerspoon shortcut) to read text. He inputs primarily via speech-to-text dictation which produces characteristic substitutions: "geologic" or "geosciences" means GeoSonix, "gem maestro" means GeoMaestro, "note.JS" means Node.js, "map" means Mac, "VS code" or "BS code" means VS Code, "based font" means monospaced font, "dock" sometimes means "doc". Interpret dictation errors charitably.

He works from a recliner with a monitor on an articulating arm and uses speech-to-text heavily. TextEdit is broken on his Mac (Launch Constraint Violation) and will be fixed when he upgrades macOS.

The Claude Desktop MCP filesystem server is configured with access to ~/Documents, ~/ProgrammingProjects, and ~/.hammerspoon using the wrapper script at /usr/local/bin/npx-for-claude.

## Suggested first turn

Read section 28 of DESIGN.md (it is the spec for everything Stage A does) and the most recent diary entry. Then propose the Stage A2 implementation in design terms before writing any code. Confirm the approach with the user, then make the code changes. Pause for the user to test before moving to A3.
