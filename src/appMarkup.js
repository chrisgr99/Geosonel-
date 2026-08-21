// appMarkup.js — GXW's own furniture, as markup a caller can put somewhere.
//
// This used to live inside index.html, which is fine for exactly one home. GXW is becoming something
// that can also be mounted inside another application's page, and that page has no #app div and no
// knowledge of what belongs in one. So the markup moves here, where both callers can reach it: the
// standalone page fills its empty #app with it at boot, and an embedded GXW fills whatever element
// its host hands over.
//
// ONE SOURCE, NOT TWO. Leaving a copy in index.html and adding another here would mean every future
// change to the layout had to be made twice, and the two would drift apart quietly — the standalone
// build looking one way and the embedded one another.

'use strict';

export const APP_MARKUP = `
        <!-- Top row: in-page menubar for the web build only.
             Hidden on Electron via body.electron-mode rules
             in main.css; the native macOS menu bar replaces
             it there. The transport controls, score name,
             saved indicator, Focus Canvas toggle, MIDI
             indicator, and wordmark that formerly lived here
             all migrated into #canvas-toolbar in the toolbar
             reorganization. The score name now lives in the
             macOS native window title bar, with "(Unsaved)"
             appended while dirty. -->
        <header id="top-row">
            <nav id="menubar" role="menubar" aria-label="Main menu">
                <div class="menu-item" role="menuitem" tabindex="0">GXW</div>
                <div class="menu-item" role="menuitem" tabindex="0">File</div>
                <div class="menu-item" role="menuitem" tabindex="0">Edit</div>
                <div class="menu-item" role="menuitem" tabindex="0">View</div>
                <div class="menu-item" role="menuitem" tabindex="0">Run</div>
            </nav>
        </header>

        <!-- Horizontal grey divider below the top row.
             Hidden alongside #top-row on Electron. -->
        <div id="top-divider" class="divider-horizontal" aria-hidden="true"></div>

        <!-- Main body: canvas left, editor right, draggable divider between.
             The panes are authored in left-to-right order: canvas pane,
             body divider, then the editor pane (housing the inspector). -->
        <main id="body">
            <!-- Canvas pane splits vertically into canvas area on top
                 and message area below, separated by a draggable
                 horizontal divider. -->
            <section id="canvas-pane" aria-label="Canvas">
                <div id="canvas-toolbar" role="toolbar" aria-label="Object tools">
                    <!-- Tool buttons rendered by src/toolbar.js. -->
                </div>
                <div id="canvas-area">
                    <!-- HTML canvas element is created by src/canvas.js. -->
                </div>

                <div id="message-divider" class="divider-horizontal divider-draggable" role="separator" aria-orientation="horizontal" aria-label="Resize canvas and message area" tabindex="0"></div>

                <div id="message-area">
                    <div class="message-placeholder">(No messages)</div>
                </div>
            </section>

            <!-- Draggable vertical divider between canvas and editor.
                 The editor pane houses the property inspector, whose
                 widest row sets a hard floor on how narrow the pane
                 can go (any narrower would clip fields). The divider
                 honours that floor while letting the user pull the
                 inspector wider for breathing room; its position is
                 persisted across sessions. Use View → Hide Inspector
                 (or Cmd-\\) to remove the inspector pane entirely. -->
            <div id="body-divider" class="divider-vertical divider-draggable" role="separator" aria-orientation="vertical" aria-label="Resize editor and canvas panes" tabindex="0"></div>

            <section id="editor-pane" aria-label="Editor">
                <div class="tab-bar" role="tablist">
                    <!-- Tabs are rendered dynamically from the bundle; see src/editor.js. -->
                    <div class="tab-bar-filler"></div>
                </div>
                <div id="editor-area" class="hidden">
                    <!-- CodeMirror mounts here. Hidden by default;
                         the editor swaps which of editor-area and
                         inspector-area is visible based on the
                         active tab. -->
                </div>
                <div id="inspector-area">
                    <!-- Form-based property inspector is mounted
                         here by src/inspector.js (via the editor).
                         Visible by default since the Properties
                         tab is the initial landing tab. -->
                </div>
                <div id="canvas-inspector-area" class="hidden">
                    <!-- Canvas inspector is mounted here by
                         src/canvasInspector.js (via the editor).
                         Hidden by default; becomes visible when
                         the user selects the Canvas tab. See
                         DESIGN.md Section 13.5. -->
                </div>
                <div id="harmony-area" class="hidden">
                    <!-- Harmony tab content is mounted here by
                         src/editor.js. Scaffolding only: holds
                         placeholder content until the iReal Pro
                         chart picker/view lands. Hidden by
                         default; becomes visible when the user
                         selects the Harmony tab. -->
                </div>
                <div id="styles-area" class="hidden">
                    <!-- Styles tab content is mounted here by
                         src/editor.js (StylesPanel). The app-wide
                         voice / rhythm style libraries. Hidden by
                         default; becomes visible when the user
                         selects the Styles tab. -->
                </div>
            </section>
        </main>
    `;

/**
 * Fill an element with GXW's furniture. Returns the element, for chaining.
 *
 * THE ELEMENT BECOMES #app, because that id is not decoration — it carries the layout. The whole
 * window is a three-row grid (menu bar, divider, body) declared on `#app`, and the body's `1fr` is
 * where every pane below gets its height from. Painting the markup into an element WITHOUT that id
 * left GXW with no grid at all: the menu bar took a share of the height instead of its own row, the
 * inspector had no bounded height so it could not scroll to its own bottom, and the panes fell back
 * to content width, which is why the inspector came out wider than it should.
 *
 * Standalone the element already has the id and this changes nothing.
 */
export function paintAppMarkup(element) {
    if (!element.id) element.id = "app";
    element.innerHTML = APP_MARKUP;
    return element;
}

// THE STYLESHEETS TRAVEL TOO. They are linked from index.html, which is fine for exactly one home —
// and mounting GXW inside another application's page produced markup with none of its CSS: every
// element present, nothing laid out, the canvas collapsed. The list lives here for the same reason the
// markup does, so there is one of it.
//
// RESOLVED AGAINST THIS MODULE, not against the page. A relative href in a host's document resolves
// against the HOST's URL, which is how GXW embedded went looking for DreamRack's css directory. Taking
// the URL from import.meta.url means the files are found wherever GXW is being served from.
export const STYLESHEETS = [
    'css/base.css',
    'css/menubar.css',
    'css/canvas-toolbar.css',
    'css/dividers.css',
    'css/layout.css',
    'css/editor.css',
    'css/inspector.css',
    'css/styles.css',
    'css/canvas-inspector.css',
    'css/dialog.css',
    'css/ai-batch-dialog.css',
    'css/context-menu.css',
    'css/mode-overrides.css',
];

/**
 * Add GXW's stylesheets to a document, once. Standalone GXW already has them from its own page, so
 * anything already linked is left alone rather than loaded twice.
 */
export function mountStyles(doc = document) {
    for (const rel of STYLESHEETS) {
        if (doc.querySelector(`link[href$="${rel}"]`)) continue;
        const link = doc.createElement("link");
        link.rel = "stylesheet";
        link.href = new URL("../" + rel, import.meta.url).href;
        link.dataset.gxwStyle = rel;
        doc.head.appendChild(link);
    }
}

/**
 * EMBEDDED: THE MENUS MOVE, THEY ARE NOT REBUILT. Hiding the top row takes away a band of height the
 * host needs, but it also takes away File, Edit, View and Run — so the same #menubar element is moved
 * into a panel behind a hamburger in the canvas toolbar. Moved, not copied: every handler, every
 * keyboard binding and every future menu item comes with it, and there is no second menu to keep in
 * step with the first.
 *
 * Standalone never calls this.
 */
export function installEmbeddedMenu(root) {
    const bar = root.querySelector("#menubar");
    const toolbar = root.querySelector("#canvas-toolbar");
    if (!bar || !toolbar || root.querySelector(".gxw-menu-button")) return null;

    const panel = document.createElement("div");
    panel.className = "gxw-menu-panel";
    panel.hidden = true;
    panel.appendChild(bar);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "gxw-menu-button";
    button.title = "Menus";
    button.setAttribute("aria-label", "Menus");
    button.textContent = "\u2630";
    button.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.hidden = !panel.hidden;
    });
    // Anywhere else closes it, the way a menu should. Capture, so a click that also does something
    // still closes the panel rather than leaving it open behind what it just did.
    document.addEventListener("click", (e) => {
        if (panel.hidden) return;
        if (panel.contains(e.target) || button.contains(e.target)) return;
        panel.hidden = true;
    }, true);

    // THE MENUS ARE NOT INSIDE #app. Every dropdown is appended to document.body and positioned
    // `fixed` at its trigger — which is fine when GXW owns the page, and not fine inside a host, where
    // the host's pane sits above them in the stacking order and they open behind it, invisible.
    //
    // The class goes on the host's body because that is where the dropdowns are; the rule that reads
    // it lives with GXW's other embedded overrides. One class, so GXW's CSS can reach its own menus.
    (root.ownerDocument || document).body.classList.add("gxw-embedded-host");

    toolbar.insertBefore(button, toolbar.firstChild);
    toolbar.parentElement.insertBefore(panel, toolbar.nextSibling);
    return { button, panel };
}
