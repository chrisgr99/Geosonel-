/**
 * Menu helper utilities.
 *
 * Shared between the File menu and the View menu. Builds a
 * dropdown from a list of entries and wires it to a menu-bar
 * item so clicking opens and closes it, clicking an item
 * triggers its action, clicking outside closes, and Escape
 * closes.
 *
 * Entries can carry optional `checked` and `disabled` getter
 * functions for live state. When either is present, each
 * open of the dropdown re-evaluates the getters and updates
 * the row's classes accordingly: `.checked` items render a
 * green checkmark in a left-hand column that the dropdown
 * reserves for the whole menu (so labels stay aligned
 * regardless of whether the current state is checked or
 * unchecked), and `.disabled` items render in muted text and
 * skip their action when clicked. View → Auto Zoom is the
 * first user of both; the File menu's plain action-only
 * entries are unaffected because they pass neither getter.
 */

// @ts-check

/**
 * @typedef {Object} DropdownActionEntry
 * @property {string} label
 * @property {string} [shortcut]
 * @property {() => void} action
 * @property {() => boolean} [checked]  Optional live getter; when present, the
 *   menu paints a green checkmark next to the label whenever the getter returns
 *   true at open time. Reserves a checkmark column across the whole dropdown
 *   so other items don't shift between checked/unchecked refreshes.
 * @property {() => boolean} [disabled] Optional live getter; when present and
 *   returning true at open time, the row renders muted and the click action
 *   is suppressed. Useful for items whose effect would be meaningless under
 *   the current state (e.g. Zoom In while Auto Zoom is on).
 */

/**
 * @typedef {{ separator: true }} DropdownSeparatorEntry
 */

/**
 * @typedef {DropdownActionEntry | DropdownSeparatorEntry} DropdownEntry
 */

/**
 * Locate a .menu-item element in the top menu bar by its
 * visible label text.
 * @param {string} label
 * @returns {HTMLElement | null}
 */
export function findMenuItem(label) {
    const items = document.querySelectorAll("#menubar .menu-item");
    for (const item of items) {
        if (item instanceof HTMLElement && item.textContent?.trim() === label) {
            return item;
        }
    }
    return null;
}

/**
 * Build a dropdown element from a list of entries.
 *
 * Returned element exposes a `refresh()` method that walks
 * every row carrying a `checked` or `disabled` getter and
 * toggles the matching CSS classes from the current getter
 * value. wireDropdown calls refresh just before opening so
 * the state shown reflects the moment the user clicks the
 * trigger, not the moment buildDropdown ran.
 *
 * @param {DropdownEntry[]} entries
 * @returns {HTMLElement & { refresh: () => void }}
 */
export function buildDropdown(entries) {
    const el = /** @type {HTMLElement & { refresh: () => void }} */ (
        document.createElement("div")
    );
    el.className = "menu-dropdown";

    // If any entry exposes a `checked` getter, the dropdown
    // gets a marker class that the stylesheet uses to
    // reserve a fixed-width column for the checkmark glyph
    // on every row. Without the reservation, items would
    // shift right when their `checked` state flips on,
    // because the glyph would push the label horizontally.
    // With the reservation, the column always exists and
    // only the glyph's colour changes (transparent vs
    // green) between checked and unchecked.
    const hasCheckable = entries.some(
        (entry) => !("separator" in entry) && typeof entry.checked === "function",
    );
    if (hasCheckable) {
        el.classList.add("menu-dropdown-checkable");
    }

    /** @type {Array<{row: HTMLElement, entry: DropdownActionEntry}>} */
    const stateRows = [];

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
            // Re-evaluate disabled at click time so a state
            // that flipped between the dropdown opening and
            // the click is respected (a corner case in
            // practice, but a cheap guard). When disabled,
            // the click is consumed without firing the
            // action and without closing the dropdown, so
            // the user sees the muted row stay put and can
            // pick another item.
            if (typeof entry.disabled === "function" && entry.disabled()) {
                return;
            }
            entry.action();
            el.classList.remove("open");
        });

        if (typeof entry.checked === "function" ||
            typeof entry.disabled === "function") {
            stateRows.push({ row, entry });
        }

        el.appendChild(row);
    }

    el.refresh = () => {
        for (const { row, entry } of stateRows) {
            if (typeof entry.checked === "function") {
                row.classList.toggle("checked", entry.checked());
            }
            if (typeof entry.disabled === "function") {
                row.classList.toggle("disabled", entry.disabled());
            }
        }
    };

    return el;
}

/**
 * Wire a dropdown element to its menu-bar trigger: click to
 * toggle, click-outside to close, Escape to close, and
 * position-on-open. Calls dropdown.refresh() right before
 * positioning so any live checked/disabled state is current
 * at the moment the menu becomes visible.
 * @param {HTMLElement & { refresh?: () => void }} trigger  The menu-bar item element.
 * @param {HTMLElement & { refresh?: () => void }} dropdown The dropdown element created by
 *   buildDropdown().
 */
export function wireDropdown(trigger, dropdown) {
    const close = () => dropdown.classList.remove("open");
    const open = () => {
        // Refresh any live checked/disabled states so the
        // dropdown shows current values rather than whatever
        // they were at buildDropdown time. The hook is
        // defensive (typeof check) because nothing in the
        // type signature forces refresh to exist, even
        // though buildDropdown always attaches it.
        if (typeof dropdown.refresh === "function") {
            dropdown.refresh();
        }
        // Close any other open dropdowns so only one is visible
        // at a time.
        document.querySelectorAll(".menu-dropdown.open").forEach((el) => {
            if (el !== dropdown) el.classList.remove("open");
        });
        const rect = trigger.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom}px`;
        dropdown.classList.add("open");
    };

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (dropdown.classList.contains("open")) {
            close();
        } else {
            open();
        }
    });

    document.addEventListener("click", (e) => {
        if (!dropdown.contains(/** @type {Node} */ (e.target))) {
            close();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
    });
}
