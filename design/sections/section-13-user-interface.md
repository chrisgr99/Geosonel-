## Section 13 — User Interface

GXW's main window is divided into four regions: a top menu bar, a canvas pane on the left showing the live scene, a tabbed code editor on the right showing one tab per JavaScript file in the score bundle, and a transport bar along the bottom. Three-pixel grey dividers separate every region so the window structure stays visually clear.

The canvas pane occupies roughly half the window width by default and can be resized by dragging its right edge. A menu option can pop the canvas out into a separate floating browser window for composers who prefer a Processing-style two-window layout.

The tabbed editor shows every .js file in the current bundle as a tab. Tabs are left-aligned. The editor uses CodeMirror 6 with a dark theme: warm off-white text on a near-black background. A grey divider runs along the bottom of the tab bar and breaks under the currently selected tab so that tab visually connects to the editor content below it.

Tab labels show a dot prefix when the tab has unsaved changes. Save and Save All actions live in the File menu alongside New Score, Open Score, Save Score As, New Module, and Delete Current Module. Recent scores are tracked and reopenable from an Open Recent submenu, and the last opened score reopens automatically on launch.

Transport bar. The transport bar at the bottom contains, from left to right: a rewind button, a play-pause toggle, an elapsed-time readout in minutes, seconds, and hundredths, and a BPM field editable via up-down stepper arrows. A vertical grey divider separates these controls from the right half of the bar, which is reserved for error and status output from sketch execution.

Canvas as live viewer. The canvas displays the scene: background image, curves rendered as their geometric shapes with cyclePattern markers at event positions, cursors rendered as line segments (curves' cursors perpendicular to the curve, sprites' cursors perpendicular to last motion direction, both sweeping their extent), triggers rendered as filled discs at their position, sprites rendered as filled circles coloured from the pixel underneath, and optional trails fading behind sprites.

Canvas toolbar. A toolbar strip across the top of the canvas pane holds object-creation tools. Each tool has three states: idle, armed (single-click, one-shot), and locked (double-click, repeat), with clicking the active tool again or pressing Escape disarming any state. While armed or locked the cursor is a crosshair and clicks place a new object at the click position. The current toolbar exposes Add Sprite; Add Trigger and the curve-shape tools follow.

Selection model. With no tool armed, the canvas behaves as a selection surface. Clicking an object selects it (replacing any previous selection); shift-clicking toggles membership; clicking empty space clears everything. Dragging from empty space draws a marquee (a translucent grey rectangle following the mouse), and on release every object the marquee touches joins the selection. Dragging from a selected sprite moves all selected sprites together; selection is multi-kind across all three object types, but drag-to-move is sprite-only at this milestone (triggers and curves are selectable and deletable but not yet movable through the canvas).

Edit pipeline. Canvas operations (Add Sprite, drag-to-move sprites, Delete to remove objects of any kind) commit by parsing scene.json, mutating the parsed data, stringifying back, updating the bundle in place, refreshing the editor's Properties JSON view, then re-running the scene. Re-running auto-saves first, so each canvas edit also persists through the normal save pipeline. The Delete and Backspace keys remove all currently-selected objects; the listener checks the focus target so typing in the JSON tab still does the obvious thing.

Property inspector. The form-based property inspector occupies the Properties tab as the primary editing surface for object properties. It renders three bands: Band 1 Identity (Object ID, Hide Cursor, the cycle-duration row, and the pattern row), Band 2 Geometry/visual (Starting State, Curve Size, Curve Thickness, Cursor R/L, Cursor Thickness, Sprite/Trigger Size, Color), and Band 3 Callback slots (hasHit, beenHit, onTick rows each with a Can-X checkbox, function-name field, and Create/Go-to button). Fields that do not apply to the current selection stay in their fixed positions but lose their green frame, so the form's layout never reflows when the selection changes. See section 9 for the behaviors.js authoring path the Band 1 pattern row and Band 3 callback rows route into.

Reflow rule. Each band has a fixed vertical height that does not change for any reason: not for selection changes, not for mode changes, not for any other state. Within a band, fields may appear, disappear, or swap based on selection, provided the band's overall height stays constant. This stability is an accessibility concern: the user, particularly under accessibility zoom, can rely on each band sitting in a consistent location and can build muscle memory for where to look for a given field.

Edit lifecycle. Editable fields share a validator-driven commit lifecycle: hard errors squiggle red and refuse to commit on Enter (blur silently reverts); soft warnings squiggle yellow and commit; ok values commit cleanly. Numeric fields support scroll-wheel adjustment in 0.3 increments with validator-driven clamping. Multi-select shows aggregate values per field, with a "varies" tri-state for boolean checkboxes when the selected objects disagree.

AI authoring. An AI-aided authoring path is a general aspiration: providing a way for AI to assist canvas and pattern (score) development. Specific UI details are to be determined.

No REPL. The initial release has no REPL and no live-coding during playback; the edit-and-rerun loop is the primary editing pattern. A future milestone may expose per-line and per-function evaluation of code, matching the GeoSonix execution model.

Keyboard shortcuts:

- Spacebar: toggle play-pause.
- R: rewind.
- Cmd-S: save the active tab.
- Cmd-Shift-S: save all tabs.
- Cmd-O: open a score.
- Cmd-N: create a new score.

Accessibility. Limited vision is a first-class concern in the UI. Measures include large bold fonts, a dark theme, visible grey dividers segmenting every window region, no use of colour alone to convey information, and clean composition with browser and OS-level zoom. Imported background images pass through a perceptual brightness reduction transform before display, so broad bright regions do not dominate the canvas while local contrast and detail are preserved; the transform affects display only, while the pixel data used for music generation passes through unchanged. See section 26 for the full description.
