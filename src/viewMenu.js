/**
 * View menu.
 *
 * Minimal dropdown implementation for the View menu item in the
 * top row. Opens on click of the View label, shows a list of
 * items with keyboard-shortcut hints, closes on item click or
 * clicking outside or Escape.
 *
 * Keyboard shortcuts are installed globally so they work
 * regardless of whether the menu is open. Shortcut intercepts
 * are suppressed while focus is in a text input or the
 * CodeMirror editor.
 *
 * File and Edit menu items are left inert for this milestone;
 * their dropdowns will be filled in as their actions become
 * implemented.
 */

// @ts-check

/** @typedef {import("./canvas.js").Canvas} Canvas */

/**
 * @typedef {Object} ViewMenuContext
 * @property {Canvas} canvas
 * @property {() => void} toggleFocusCanvas
 */

/**
 * Install the View dropdown and its keyboard shortcuts.
 * @param {ViewMenuContext} ctx
 */
export function installViewMenu(ctx) {
    const viewItem = findMenuItem("View");
    if (viewItem === null) {
        console.error("GXW: View menu item not found.");
        return;
    }

    const dropdown = buildDropdown([
        {
            label: "Zoom In",
            shortcut: "\u2318+",
            action: () => ctx.canvas.zoomIn(),
        },
        {
            label: "Zoom Out",
            shortcut: "\u2318\u2212",
            action: () => ctx.canvas.zoomOut(),
        },
        {
            label: "Reset Zoom",
            shortcut: "\u23300",
            action: () => ctx.canvas.resetZoom(),
        },
        { separator: true },
        {
            label: "Focus Canvas",
            shortcut: "\u21e7\u2318F",
            action: () => ctx.toggleFocusCanvas(),
        },
    ]);

    document.body.appendChild(dropdown);

    const closeDropdown = () => {
        dropdown.classList.remove("open");
    };

    const openDropdown = () => {
        const rect = viewItem.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom}px`;
        dropdown.classList.add("open");
    };

    viewItem.addEventListener("click", (e) => {
        e.stopPropagation();
        if (dropdown.classList.contains("open")) {
            closeDropdown();
        } else {
            openDropdown();
        }
    });

    document.addEventListener("click", (e) => {
        if (!dropdown.contains(/** @type {Node} */ (e.target))) {
            closeDropdown();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeDropdown();
    });

    // Global keyboard shortcuts. These work independently of the
    // dropdown being open, matching how a real menu bar behaves.
    window.addEventListener("keydown", (e) => {
        if (isTypingTarget(e.target)) return;
        const meta = e.metaKey || e.ctrlKey;
        if (!meta) return;

        // Cmd-Shift-F: Focus Canvas toggle.
        if (e.shiftKey && e.key.toLowerCase() === "f") {
            e.preventDefault();
            ctx.toggleFocusCanvas();
            return;
        }

        // Zoom shortcuts \u2014 Cmd-+, Cmd--, Cmd-0.
        //
        // Cmd-+ arrives with key="+" (shift held) or key="=" on
        // keyboards where + requires shift. Accept both.
        if (!e.shiftKey && (e.key === "=" || e.key === "+")) {
            e.preventDefault();
            ctx.canvas.zoomIn();
            return;
        }
        if (e.shiftKey && (e.key === "+" || e.key === "=")) {
            e.preventDefault();
            ctx.canvas.zoomIn();
            return;
        }
        if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            ctx.canvas.zoomOut();
            return;
        }
        if (e.key === "0") {
            e.preventDefault();
            ctx.canvas.resetZoom();
            return;
        }
    });
}

/**
 * @param {string} label
 * @returns {HTMLElement | null}
 */
function findMenuItem(label) {
    const items = document.querySelectorAll("#menubar .menu-item");
    for (const item of items) {
        if (item instanceof HTMLElement && item.textContent?.trim() === label) {
            return item;
        }
    }
    return null;
}

/**
 * @typedef {{ label: string, shortcut?: string, action: () => void } | { separator: true }} DropdownEntry
 */

/**
 * @param {DropdownEntry[]} entries
 * @returns {HTMLElement}
 */
function buildDropdown(entries) {
    const el = document.createElement("div");
    el.className = "menu-dropdown";

    for (const entry of entries) {
        if ("separator" in entry) {
            const sep = document.createElement("div");
            sep.className = "menu-dropdown-separator";
            el.appendChild(sep);
            continue;
        }
        const row = document.createElement("div");
        row.className = "menu-dropdown-item";
        row.setAttribute("role", "menuitem");
        row.setAttribute("tabindex", "0");

        const label = document.createElement("span");
        label.className = "menu-dropdown-label";
        label.textContent = entry.label;
        row.appendChild(label);

        if (entry.shortcut !== undefined) {
            const sc = document.createElement("span");
            sc.className = "menu-dropdown-shortcut";
            sc.textContent = entry.shortcut;
            row.appendChild(sc);
        }

        row.addEventListener("click", () => {
            entry.action();
            el.classList.remove("open");
        });

        el.appendChild(row);
    }

    return el;
}

/**
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    if (target.closest(".cm-editor") !== null) return true;
    return false;
}
