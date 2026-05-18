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
 * @typedef {Object} DropdownSubmenuEntry
 * @property {string} label
 * @property {() => DropdownEntry[] | Promise<DropdownEntry[]>} buildSubmenu
 *   Called every time the submenu is opened. Letting the caller rebuild
 *   the entry list on demand means dynamic submenus like Open Recent and
 *   Revert to reflect the current state at open time without any
 *   subscribe-and-rebuild plumbing. Synchronous return values are
 *   wrapped in a resolved Promise so async callers (e.g. submenus that
 *   need to fetch data over IPC) work transparently. Returning an empty
 *   array is valid and renders a single muted "(no items)" row so the
 *   submenu is never visibly empty.
 * @property {() => boolean} [disabled] Optional live getter; when true, the
 *   submenu row renders muted and clicking does not open the submenu.
 */

/**
 * @typedef {{ separator: true }} DropdownSeparatorEntry
 */

/**
 * @typedef {DropdownActionEntry | DropdownSubmenuEntry | DropdownSeparatorEntry} DropdownEntry
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

    /** @type {Array<{row: HTMLElement, entry: DropdownActionEntry | DropdownSubmenuEntry}>} */
    const stateRows = [];

    // Submenu coordination state, shared across all rows in
    // this dropdown. Submenu rows register their close-
    // handle here when they're built; mouseenter on any
    // row (including non-submenu rows) closes any open
    // sibling submenu so only one is visible at a time. The
    // delay-based close (250ms) gives the user time to
    // diagonally cross a sibling row on the way to a
    // submenu they intend to use without that submenu
    // closing under them.
    /** @type {Array<{row: HTMLElement, scheduleClose: () => void, isOpen: () => boolean}>} */
    const submenuRows = [];

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

        if ("buildSubmenu" in entry) {
            // Submenu row. Right-pointing chevron in place
            // of the shortcut hint; click opens or closes a
            // child dropdown positioned to the right of
            // this row. The submenu's entries are rebuilt on
            // every open via entry.buildSubmenu so dynamic
            // contents (Open Recent, Revert to) always
            // reflect current state.
            row.classList.add("menu-dropdown-item-submenu");
            const chevron = document.createElement("span");
            chevron.className = "menu-dropdown-submenu-chevron";
            chevron.textContent = "\u25B8";  // BLACK RIGHT-POINTING SMALL TRIANGLE
            row.appendChild(chevron);

            /** @type {(HTMLElement & { refresh?: () => void }) | null} */
            let submenuEl = null;
            // Guard against multiple openSubmenu invocations
            // overlapping when buildSubmenu is async. The flag
            // is set the moment openSubmenu starts the
            // buildSubmenu await and cleared when the submenu
            // is either mounted or the open is aborted; until
            // then, repeat clicks on the row are ignored.
            let opening = false;
            // Hover-based open/close timers. The open timer
            // gives a small grace period so brushing the
            // cursor past a submenu row doesn't open the
            // submenu; the close timer gives the user time to
            // diagonally cross from the parent row down to
            // the submenu without it closing under them.
            /** @type {ReturnType<typeof setTimeout> | null} */
            let openTimer = null;
            /** @type {ReturnType<typeof setTimeout> | null} */
            let closeTimer = null;
            const cancelOpen = () => {
                if (openTimer !== null) {
                    clearTimeout(openTimer);
                    openTimer = null;
                }
            };
            const cancelClose = () => {
                if (closeTimer !== null) {
                    clearTimeout(closeTimer);
                    closeTimer = null;
                }
            };
            const closeSubmenu = () => {
                cancelOpen();
                cancelClose();
                if (submenuEl !== null && submenuEl.parentNode !== null) {
                    submenuEl.parentNode.removeChild(submenuEl);
                }
                submenuEl = null;
                row.classList.remove("submenu-open");
            };
            const scheduleOpen = () => {
                cancelOpen();
                if (submenuEl !== null) return;
                openTimer = setTimeout(() => {
                    openTimer = null;
                    void openSubmenu();
                }, 150);
            };
            const scheduleClose = () => {
                cancelClose();
                if (submenuEl === null) return;
                closeTimer = setTimeout(() => {
                    closeTimer = null;
                    closeSubmenu();
                }, 250);
            };
            const openSubmenu = async () => {
                if (submenuEl !== null) return;
                if (opening) return;
                if (typeof entry.disabled === "function" && entry.disabled()) return;
                opening = true;
                let subEntries;
                try {
                    subEntries = await Promise.resolve(entry.buildSubmenu());
                } catch (err) {
                    console.error("GXW: submenu buildSubmenu threw.", err);
                    opening = false;
                    return;
                }
                // If the parent dropdown closed while we were
                // awaiting buildSubmenu (typical when the user
                // clicked elsewhere during the IPC call), abort
                // mounting the submenu.
                if (!el.classList.contains("open")) {
                    opening = false;
                    return;
                }
                // Wrap each action entry's handler so that
                // clicking a submenu item also tears down
                // the submenu DOM (via closeSubmenu) and
                // closes the parent dropdown. Without the
                // wrap, buildDropdown's default behaviour
                // removes only the submenu's own .open
                // class, leaving the submenu still parented
                // in the DOM with stale state and leaving
                // the File menu visibly open. Separators
                // and nested-submenu entries pass through
                // unchanged.
                /** @type {DropdownEntry[]} */
                const wrapped = subEntries.map((e) => {
                    if ("separator" in e) return e;
                    if ("buildSubmenu" in e) return e;
                    const userAction = e.action;
                    return {
                        ...e,
                        action: () => {
                            userAction();
                            closeSubmenu();
                            el.classList.remove("open");
                        },
                    };
                });
                /** @type {DropdownEntry[]} */
                const effective = wrapped.length === 0
                    ? [{
                        label: "(no items)",
                        action: () => {},
                        disabled: () => true,
                    }]
                    : wrapped;
                submenuEl = buildDropdown(effective);
                submenuEl.classList.add("menu-dropdown-submenu");
                // Append inside the parent dropdown so its
                // own outside-click handler (in wireDropdown)
                // sees clicks on submenu items as inside the
                // dropdown subtree and doesn't close the
                // parent when the user picks a submenu
                // entry. The submenu is positioned `fixed`
                // (see main.css's .menu-dropdown-submenu
                // rule) so its left/top coordinates remain
                // viewport-relative regardless of where in
                // the DOM it's parented.
                el.appendChild(submenuEl);
                const rect = row.getBoundingClientRect();
                submenuEl.style.left = `${rect.right}px`;
                submenuEl.style.top = `${rect.top}px`;
                submenuEl.classList.add("open");
                if (typeof submenuEl.refresh === "function") submenuEl.refresh();
                row.classList.add("submenu-open");
                // Hovering into the submenu cancels any
                // pending close from the parent row
                // mouseleave; moving back out schedules a
                // fresh close after the delay. This keeps
                // the submenu open as long as the cursor is
                // either on the parent row or anywhere
                // inside the submenu, and closes shortly
                // after both lose hover.
                submenuEl.addEventListener("mouseenter", cancelClose);
                submenuEl.addEventListener("mouseleave", scheduleClose);
                opening = false;
            };

            row.addEventListener("click", (e) => {
                e.stopPropagation();
                if (typeof entry.disabled === "function" && entry.disabled()) {
                    return;
                }
                cancelOpen();
                if (submenuEl !== null) {
                    closeSubmenu();
                } else {
                    void openSubmenu();
                }
            });

            // Hover-based open and close. Entering the
            // parent row schedules an open after a short
            // grace period; leaving it (or never reaching
            // the submenu) schedules a close. Hover on a
            // different sibling row also closes the submenu
            // via the shared submenuRows array below. The
            // delay-based open keeps the menu from flashing
            // open when the user is just mousing past on
            // their way to another item.
            row.addEventListener("mouseenter", () => {
                cancelClose();
                if (submenuEl === null) {
                    scheduleOpen();
                }
                // Close any sibling submenus that are
                // currently open. The schedule-based close
                // (rather than immediate) lets the user
                // diagonally move from one parent row to
                // another's submenu without the destination
                // closing on them.
                for (const other of submenuRows) {
                    if (other.row !== row && other.isOpen()) {
                        other.scheduleClose();
                    }
                }
            });
            row.addEventListener("mouseleave", () => {
                cancelOpen();
                scheduleClose();
            });

            // When the parent dropdown closes, our submenu
            // should close too. wireDropdown's outside-click
            // and Escape handlers remove the .open class
            // from the parent dropdown; observing that via
            // MutationObserver is overkill, so instead we
            // hook the same document-level outside-click
            // pattern here: any click that lands outside
            // both this submenu and its parent row closes
            // the submenu. Escape closes globally.
            document.addEventListener("click", (e) => {
                if (submenuEl === null) return;
                const target = /** @type {Node} */ (e.target);
                if (submenuEl.contains(target)) return;
                if (row.contains(target)) return;
                closeSubmenu();
            });
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape" && submenuEl !== null) closeSubmenu();
            });

            // When the parent dropdown loses its .open
            // class (the user picked something elsewhere or
            // hit Escape at the top level), close our
            // submenu too. Observe via a class mutation
            // watcher on the parent element.
            const parentObserver = new MutationObserver(() => {
                if (!el.classList.contains("open") && submenuEl !== null) {
                    closeSubmenu();
                }
            });
            parentObserver.observe(el, { attributes: true, attributeFilter: ["class"] });

            if (typeof entry.disabled === "function") {
                stateRows.push({ row, entry });
            }

            // Register with the shared submenu coordination
            // table so hovers on non-submenu rows and on
            // other submenu rows can ask this submenu to
            // close.
            submenuRows.push({
                row,
                scheduleClose,
                isOpen: () => submenuEl !== null,
            });

            el.appendChild(row);
            continue;
        }

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

        // Hovering over a non-submenu row closes any open
        // sibling submenu (with the standard close delay).
        // Without this the submenu would float open while
        // the user is clearly moving toward an unrelated
        // entry like Save or New, which looks broken.
        row.addEventListener("mouseenter", () => {
            for (const other of submenuRows) {
                if (other.isOpen()) {
                    other.scheduleClose();
                }
            }
        });

        if (typeof entry.checked === "function" ||
            typeof entry.disabled === "function") {
            stateRows.push({ row, entry });
        }

        el.appendChild(row);
    }

    el.refresh = () => {
        for (const { row, entry } of stateRows) {
            if ("checked" in entry && typeof entry.checked === "function") {
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
