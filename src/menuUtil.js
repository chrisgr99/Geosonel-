/**
 * Menu helper utilities.
 *
 * Shared between the File menu and the View menu. Builds a
 * dropdown from a list of entries and wires it to a menu-bar
 * item so clicking opens and closes it, clicking an item
 * triggers its action, clicking outside closes, and Escape
 * closes.
 */

// @ts-check

/**
 * @typedef {{ label: string, shortcut?: string, action: () => void } | { separator: true }} DropdownEntry
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
 * @param {DropdownEntry[]} entries
 * @returns {HTMLElement}
 */
export function buildDropdown(entries) {
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
 * Wire a dropdown element to its menu-bar trigger: click to
 * toggle, click-outside to close, Escape to close, and
 * position-on-open.
 * @param {HTMLElement} trigger  The menu-bar item element.
 * @param {HTMLElement} dropdown The dropdown element created by
 *   buildDropdown().
 */
export function wireDropdown(trigger, dropdown) {
    const close = () => dropdown.classList.remove("open");
    const open = () => {
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
