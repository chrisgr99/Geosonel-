## Section 20 — Implementation

GXW is implemented as a static web application. Source files are HTML, CSS, and JavaScript (with JSDoc type annotations for IDE support). No build step is required for development; files are served directly by a local HTTP server during development and by any static host in production.

Core technologies:
- Language: Modern JavaScript (ES2022+) with JSDoc type hints.
- Editor: CodeMirror 6 for the tabbed sketch editor.
- Graphics: HTML Canvas 2D for scene rendering.
- Audio: Web Audio API for synthesis and timing.
- MIDI: Web MIDI API (where supported).
- Storage: IndexedDB (primary) and File System Access API (optional).
- Version control: isomorphic-git.
- AI authoring: Anthropic API via direct browser fetch with a lightweight authentication proxy.

No framework. Vanilla JavaScript with ES modules. Small helper utilities may be added as needed but there is no React, Vue, or similar.

Development workflow: edit files, reload browser. A simple local HTTP server (Python's http.server or similar) serves the project folder. Modern browsers' DevTools handle debugging. VS Code with the built-in JavaScript and TypeScript language server provides type checking from JSDoc annotations.

The repository is at /Users/chrisgr/ProgrammingProjects/GXW. The earlier Python prototype at /Users/chrisgr/ProgrammingProjects/GX2 is preserved but not referenced.
