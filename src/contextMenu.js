/**
 * Context menu component.
 *
 * Generic single-shot popup menu for right-click and other
 * "show menu at point" gestures. The menu mounts at the
 * document body with fixed positioning so it floats above
 * any pane layout, dismisses on outside-click or Escape,
 * and clamps itself to the viewport so a click near a
 * screen edge doesn't cut the menu off.
 *
 * Used by two trigger sites at the moment:
 *   - Canvas right-click on a sprite or path. Items are
 *     "<name> properties" (switch to Properties tab) and
 *     "<name> code" (switch to Behaviors and scroll to the
 *     bound function). The clicked object is the menu's
 *     target; main.js replaces the canvas selection with it
 *     before showing the menu so the inspector lands on the
 *     right object.
 *   - CodeMirror right-click on a top-level function name.
 *     One item: "<binding-name> properties" — reverse-
 *     lookup of the first scene object that binds that
 *     function name in any of its callback slots.
 *
 * The menu renders one item per entry in the items array.
 * Items can carry either a plain text label or HTML
 * fragment (for labels that mix bright user-typed names
 * with dim-italic auto-id placeholders); see ContextMenuItem
 * below. Disabled items render greyed and don't fire on
 * click. Items that the caller wants to hide entirely just
 * shouldn't be in the array — there's no "visible" flag.
 *
 * Single-shot lifetime. showContextMenu builds a fresh
 * menu element each call and tears it down on dismissal.
 * Only one context menu can exist at a time; calling
 * showContextMenu while a previous menu is open dismisses
 * the previous menu first.
 */

// @ts-check

/**
 * @typedef {Object} ContextMenuItem
 * @property {string} [label]  Plain-text label. Used when the
 *     entire item is one piece of text. If both label and
 *     html are present, html wins.
 * @property {string} [html]   HTML fragment for the item's
 *     content. Use when the label needs mixed styling, e.g.
 *     a bright user-typed name plus a dim-italic auto-id
 *     placeholder. The HTML is inserted via innerHTML, so
 *     callers are responsible for escaping any user-provided
 *     text segments.
 * @property {boolean} [disabled]  Renders the item greyed and
 *     ignores clicks. Defaults to false.
 * @property {() => void} [action]  Click handler. Fired after
 *     the menu dismisses. Optional for disabled items.
 */

/**
 * Active menu element, if any. We keep one global slot
 * because at most one context menu is open at a time —
 * a second open call dismisses the first one before
 * mounting its own DOM.
 *
 * @type {HTMLElement | null}
 */
let activeMenu = null;

/**
 * Dismiss-handler closures registered for the active menu's
 * window-level events. Stored so dismissActive can remove
 * them cleanly without leaking listeners across menu
 * lifetimes.
 *
 * @type {{
 *   onMouseDown: ((e: MouseEvent) => void) | null,
 *   onKeyDown: ((e: KeyboardEvent) => void) | null,
 *   onScroll: (() => void) | null,
 *   onResize: (() => void) | null,
 * }}
 */
const activeListeners = {
    onMouseDown: null,
    onKeyDown: null,
    onScroll: null,
    onResize: null,
};

/**
 * Show a context menu with the given items at screen
 * coordinates (x, y). The (x, y) pair is the position the
 * menu's top-left corner aims for; if that would push the
 * menu past the viewport edge, the menu is shifted left or
 * up so the entire menu stays visible. Pass the
 * contextmenu event's clientX/clientY directly.
 *
 * Returns nothing — there is no programmatic way to query
 * which item was selected; instead, each item's action
 * runs as a side effect of the click.
 *
 * @param {ContextMenuItem[]} items
 * @param {number} x   Viewport-relative X coordinate (clientX).
 * @param {number} y   Viewport-relative Y coordinate (clientY).
 */
export function showContextMenu(items, x, y) {
    dismissActive();
    if (!Array.isArray(items) || items.length === 0) return;

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.setAttribute("role", "menu");
    // Position off-screen first so we can measure the
    // rendered size, then clamp into the viewport. Using
    // visibility:hidden rather than display:none lets the
    // browser do layout (so offsetWidth/offsetHeight read
    // real numbers) without flashing the menu in the wrong
    // spot.
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.visibility = "hidden";

    for (const item of items) {
        const itemEl = document.createElement("div");
        itemEl.className = "context-menu-item";
        itemEl.setAttribute("role", "menuitem");
        const disabled = item.disabled === true;
        if (disabled) {
            itemEl.classList.add("disabled");
            itemEl.setAttribute("aria-disabled", "true");
        }
        if (typeof item.html === "string") {
            itemEl.innerHTML = item.html;
        } else if (typeof item.label === "string") {
            itemEl.textContent = item.label;
        } else {
            // Defensive: an item with neither label nor html
            // is a configuration bug, not a user-facing
            // condition. Render an empty placeholder rather
            // than throwing so a single bad entry doesn't
            // take down the rest of the menu.
            itemEl.textContent = "";
        }
        // mousedown rather than click for the activation
        // event so the menu's own dismiss handler (also on
        // mousedown at the window level) doesn't fire first
        // and tear the menu down before the click reaches
        // the item. Using stopPropagation on mousedown keeps
        // the dismiss handler from seeing the activation
        // click as an outside click.
        if (!disabled && typeof item.action === "function") {
            const action = item.action;
            itemEl.addEventListener("mousedown", (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                dismissActive();
                try {
                    action();
                } catch (err) {
                    console.error("GXW: context menu action threw.", err);
                }
            });
        }
        menu.appendChild(itemEl);
    }

    document.body.appendChild(menu);
    activeMenu = menu;

    // Clamp the menu's position so the entire menu stays in
    // the viewport. If x + menuWidth exceeds the viewport,
    // shift the menu left of the click point — the user
    // already sees the menu next to where they clicked, just
    // on the other side. Same idea for the vertical axis.
    // 4-pixel inset keeps the menu off the absolute edge.
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const inset = 4;
    let left = x;
    let top = y;
    if (left + w > vw - inset) left = Math.max(inset, x - w);
    if (top + h > vh - inset) top = Math.max(inset, y - h);
    if (left < inset) left = inset;
    if (top < inset) top = inset;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "visible";

    // Dismissal listeners. Outside-click via mousedown at
    // the window level (capture phase so our handler runs
    // before any pane-level listeners that might cancel
    // propagation); Escape via keydown at the window level;
    // any window scroll or resize also dismisses since the
    // menu's anchor coordinates are now stale and the menu
    // shouldn't drift relative to the page content.
    const onMouseDown = (/** @type {MouseEvent} */ e) => {
        if (activeMenu === null) return;
        if (e.target instanceof Node && activeMenu.contains(e.target)) return;
        dismissActive();
    };
    const onKeyDown = (/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            dismissActive();
        }
    };
    const onScroll = () => dismissActive();
    const onResize = () => dismissActive();

    activeListeners.onMouseDown = onMouseDown;
    activeListeners.onKeyDown = onKeyDown;
    activeListeners.onScroll = onScroll;
    activeListeners.onResize = onResize;

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
}

/**
 * Tear down the active menu, if any. Idempotent; safe to
 * call when no menu is open. Removes the menu element from
 * the DOM, clears the activeMenu slot, and unregisters the
 * window-level dismiss listeners installed by
 * showContextMenu.
 */
export function dismissActive() {
    if (activeMenu !== null) {
        activeMenu.remove();
        activeMenu = null;
    }
    if (activeListeners.onMouseDown !== null) {
        window.removeEventListener("mousedown", activeListeners.onMouseDown, true);
        activeListeners.onMouseDown = null;
    }
    if (activeListeners.onKeyDown !== null) {
        window.removeEventListener("keydown", activeListeners.onKeyDown, true);
        activeListeners.onKeyDown = null;
    }
    if (activeListeners.onScroll !== null) {
        window.removeEventListener("scroll", activeListeners.onScroll, true);
        activeListeners.onScroll = null;
    }
    if (activeListeners.onResize !== null) {
        window.removeEventListener("resize", activeListeners.onResize);
        activeListeners.onResize = null;
    }
}

/**
 * Helper for callers that build menu items containing both
 * a name segment and a verb segment. Renders the name in
 * plain bright text (when typed by the user) or in dim-
 * italic placeholder style (when it's an auto-id), followed
 * by a single space and the verb. Returns an HTML fragment
 * suitable for the ContextMenuItem.html field.
 *
 * The verb is appended as plain text so the menu reads as
 * "kick properties" or "sprite3 properties" — italic on
 * the name, plain on the verb, just like the inspector
 * title bar's single-select handle convention.
 *
 * Both the name and the verb are escaped so caller-supplied
 * strings can't inject HTML.
 *
 * @param {string} name           Display name (typed or auto-id).
 * @param {boolean} isPlaceholder True iff the name is an
 *     auto-id placeholder rather than a user-typed name.
 * @param {string} verb           "properties" or "code".
 * @returns {string}
 */
export function buildNameVerbHtml(name, isPlaceholder, verb) {
    const nameEl = isPlaceholder
        ? `<span class="context-menu-name placeholder">${escapeHtml(name)}</span>`
        : `<span class="context-menu-name">${escapeHtml(name)}</span>`;
    return `${nameEl} ${escapeHtml(verb)}`;
}

/**
 * Minimal HTML escaper for the four characters that can
 * affect parsing inside an innerHTML fragment. Used by
 * buildNameVerbHtml so caller-supplied names can't smuggle
 * markup into the menu.
 *
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
