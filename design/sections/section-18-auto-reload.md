## Section 18 — Auto-Reload

When the active sketch is saved in the editor, GXW re-executes it after a short debounce (a few hundred milliseconds) to absorb multiple rapid writes.

Transport state is preserved across reload where possible. If the transport is playing when the sketch reloads, it keeps playing. Function definition changes take effect on next call. Scene construction changes apply as diffs: new objects appear, deleted objects disappear, existing objects update their declarative properties (position, functions, cursor extent, beat strings, and so on) while preserving runtime-dynamic state (current cursor cycle position, current velocity for sprites, strength-pointer position).

Module caches for files in resources/ are invalidated on reload, so changes to imported support modules are picked up too.

Auto-reload requires no user action. This behaviour is proven to work from GeoSonix, which had the same mechanism for JavaScript sketches.

Errors during reload do not block loading. Errors in scene construction cause the affected objects to be skipped, and the scene loads without them. Errors in function definitions cause affected functions to be skipped; curves, triggers, or sprites referencing them will fail when they fire. Errors are reported in the status area at the bottom of the editor window.

When bundles are stored in the File System Access API and modified externally, GXW polls for changes at a low frequency (every second or two) since browsers do not expose a filesystem notification API.
