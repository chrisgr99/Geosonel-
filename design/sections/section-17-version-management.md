## Section 17 — Version Management via Git

Each GXW bundle contains a git repository. Git operations are performed in the browser by isomorphic-git, a pure-JavaScript git implementation that works against both IndexedDB-backed bundles and File System Access folders.

Commit policy:
- Auto-commit on every successful sketch reload. Default message: timestamp.
- User-initiated milestone commits via a "Save milestone" action that prompts for a description. Internally stored as a git tag.
- Time-based tags created by a background cleanup pass: one per hour for the last day, one per day for the last week, one per week for the last month.

Version history UI:
- A unified history panel listing versions.
- By default shows milestones prominently and time-based tags chronologically.
- A "show all versions" toggle expands to include auto-commits.
- Each entry: human-readable timestamp, description, click to view or restore.

Restore behaviour: "restore to this version" copies that version's files over the current ones, which triggers auto-reload and a new auto-commit. History stays linear from the user's perspective. No detached-HEAD confusion.

What gets committed: everything in the bundle except .git itself and anything in .gitignore. sketch.js, image.png, resources/. Image versioning means you can see when the background changed.

Pushing to a remote (GitHub, personal git server) is available via isomorphic-git's push support. Requires the user to provide credentials. Optional and secondary.
