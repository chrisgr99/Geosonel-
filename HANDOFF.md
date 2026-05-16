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

Active work changes too frequently to be captured here. To learn what is currently in flight, give Chris the terminal command below to dump a summary of recent commits to a file, then read that file.

```
cd /Users/chrisgr/ProgrammingProjects/GXW && git log -10 --date=short --pretty=format:'%h %ad %s' > /Users/chrisgr/Documents/gxw-recent-commits.txt
```

After reading /Users/chrisgr/Documents/gxw-recent-commits.txt, consult design/TODO.md for pending work. Then ask Chris what he would like to focus on next.

## GXW conventions

For setup and how to run GXW locally, see README.md at the repo root. It has the static-server invocation, the browser requirements, and the stack overview.

Two project-specific file paths the conventions in CLAUDE.md depend on: the commit message file is /Users/chrisgr/Documents/gxw-commit-msg.txt, and IN_FLIGHT.md lives at /Users/chrisgr/ProgrammingProjects/GXW/IN_FLIGHT.md.

Keep IN_FLIGHT.md updated throughout the session per the in-flight session notes convention in CLAUDE.md. Update it whenever a decision is made, a file is touched, or the next step shifts. This is the mechanism that lets a session survive context compression or end-and-resume without scrambled work.
