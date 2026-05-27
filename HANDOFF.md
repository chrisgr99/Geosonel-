# GXW Handoff

This is a handoff document for a fresh Claude session to continue work on GXW. Read this first before doing anything else.

Before going further, read /Users/chrisgr/ProgrammingProjects/CLAUDE.md. That file captures Chris's working style, formatting preferences, dictation interpretation, filesystem access via MCP, and workflow conventions that apply across every project. This handoff assumes those conventions are already in effect.

## What this project is

GXW is a browser-based JavaScript generative music app, the successor to GeoSonix. It lives at /Users/chrisgr/ProgrammingProjects/GXW. The model has three object kinds on a 2D canvas: sprites that move under simple physics, curves whose cursors sweep along them, and triggers as fixed collision points. Object identifiers use the convention SPR, TRG, CRV with integer suffixes (SPR1, TRG3, CRV2). Pattern firing and audio scheduling go through Strudel, imported as the @strudel/* npm packages. Output supports both MIDI to external synths and superdough (Strudel's built-in audio synthesis), with MIDI as the default route. Score-level harmony via @strudel/tonal is planned but not yet integrated.

## Where to read for depth

At the start of any session, read these two files. Both are small and always relevant.

design/sections/section-01-vision.md gives the project vision in three short paragraphs (about 1 KB). design/DESIGN.md is the master index, listing all section files and their topics (about 3 KB).

For deeper reading as needed:

- design/sections/section-NN-*.md holds the per-section design files. Sections 27 and 28 were superseded by the v2.5 fold-back and now exist as forwarding stubs pointing at the destinations of their content.
- design/TODO.md tracks pending work organised by component and is the authoritative list of what is yet to do.
- The git log is the authoritative history of what has shipped.
- src/ holds the current implementation, useful when reasoning about what the code actually does today.

## Current state

The single most important file for picking up where work left off is /Users/chrisgr/ProgrammingProjects/GXW/IN_FLIGHT.md. Read it first. It captures the current task, decisions made in the previous session, files touched, the immediate next step, and any open questions. Section headings inside IN_FLIGHT.md carry ISO date stamps marking when the section was last touched; updates inside an existing section append a new dated paragraph at the top so the chronology stays visible. Sections that haven't been updated in roughly two days migrate to the companion DEFERRED.md file on the next session that notices.

DEFERRED.md is the companion file for parked items not currently in motion but kept for future reference. IN_FLIGHT.md holds a "Deferred items index" at the bottom listing every section in DEFERRED.md with a one-sentence description and approximate line range, so a session can scan the catalogue and pull individual items without reading the full file. Items move from DEFERRED.md back to IN_FLIGHT.md when work on them resumes. Both files are gitignored, live in the repo, and together are the mechanism by which a context-compressed or resumed session avoids losing in-progress work.

For broader context on recently shipped work, give Chris the terminal command below to refresh a summary of recent commits to a file, then read it. The file can be stale relative to actual HEAD if a previous session forgot to regenerate it, so refresh it at session start before trusting its contents.

```
cd /Users/chrisgr/ProgrammingProjects/GXW && git log -10 --date=short --pretty=format:'%h %ad %s' > /Users/chrisgr/Documents/gxw-recent-commits.txt
```

After IN_FLIGHT.md and the recent-commits file, consult design/TODO.md for pending work. Then ask Chris what he would like to focus on next.

## GXW conventions

For setup and how to run GXW locally, see README.md at the repo root. It has the static-server invocation, the browser requirements, and the stack overview.

Three project-specific file paths the conventions in CLAUDE.md depend on: the commit message file is /Users/chrisgr/Documents/gxw-commit-msg.txt, IN_FLIGHT.md lives at /Users/chrisgr/ProgrammingProjects/GXW/IN_FLIGHT.md, and DEFERRED.md lives at /Users/chrisgr/ProgrammingProjects/GXW/DEFERRED.md.

Keep IN_FLIGHT.md updated throughout the session per the in-flight session notes convention in CLAUDE.md. Update it whenever a decision is made, a file is touched, or the next step shifts. Move items between IN_FLIGHT.md and DEFERRED.md as the focus shifts: parked work migrates to DEFERRED.md, and resumed work moves back to IN_FLIGHT.md. This is the mechanism that lets a session survive context compression or end-and-resume without scrambled work.
