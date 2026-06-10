// @ts-check
/**
 * Object ID picker — a custom dropdown for the inspector's Identity band.
 *
 * Native <select> is unusable here because its popup is OS-drawn: we can't
 * attach per-option mouseenter handlers, and the whole point of this control
 * is to BRIGHTEN the matching object on the canvas as the pointer moves over
 * each id row (a live preview of what clicking will select, so the user
 * doesn't have to remember which id is which object). So this is a custom
 * popup: a trigger plus a floating list appended to <body> (avoids clipping),
 * positioned under the trigger.
 *
 * Interactions:
 *   - row mouseenter / arrow-key focus -> onHighlight({kind, id})
 *   - pointer leaves the popup / popup closes -> onHighlight(null)
 *   - row click / Enter on a focused row   -> onSelect(kind, index) + close
 *   - click outside / Escape               -> close
 *
 * Selection is single-object only: picking an id replaces the selection with
 * that one object (the caller wires onSelect to canvas.setSelection).
 */

/**
 * @param {{
 *   objects: Array<{ id: string, kind: "sprite"|"trigger"|"curve", index: number }>,
 *   currentId: string,
 *   placeholder: string,
 *   enabled: boolean,
 *   width: number,
 *   onSelect: (kind: "sprite"|"trigger"|"curve", index: number) => void,
 *   onHighlight: (target: { kind: "sprite"|"trigger"|"curve", id: string } | null) => void,
 * }} opts
 * @returns {HTMLElement}
 */
export function buildObjectIdPicker(opts) {
    const trigger = document.createElement("div");
    trigger.className = "insp-objid-picker";
    trigger.style.width = `${opts.width}px`;
    trigger.setAttribute("role", "button");
    trigger.setAttribute("aria-haspopup", "listbox");

    const labelEl = document.createElement("span");
    labelEl.className = "insp-objid-picker-label";
    const hasId = opts.currentId !== "";
    labelEl.textContent = hasId ? opts.currentId : opts.placeholder;
    if (!hasId) labelEl.classList.add("placeholder");
    trigger.appendChild(labelEl);

    const chevron = document.createElement("span");
    chevron.className = "insp-objid-picker-chevron";
    chevron.textContent = "▾"; // ▾
    trigger.appendChild(chevron);

    // Disabled (no objects in the scene): inert, greyed, not focusable.
    if (!opts.enabled || opts.objects.length === 0) {
        trigger.classList.add("disabled");
        trigger.tabIndex = -1;
        return trigger;
    }
    trigger.tabIndex = 0;

    /** @type {HTMLElement | null} */
    let popup = null;
    /** @type {HTMLElement[]} */
    let rows = [];
    let focusedIndex = -1;

    const setFocused = (i) => {
        if (popup === null) return;
        if (focusedIndex >= 0 && rows[focusedIndex]) {
            rows[focusedIndex].classList.remove("focused");
        }
        focusedIndex = i;
        if (i >= 0 && rows[i]) {
            rows[i].classList.add("focused");
            rows[i].scrollIntoView({ block: "nearest" });
            const o = opts.objects[i];
            opts.onHighlight({ kind: o.kind, id: o.id });
        }
    };

    const closePopup = () => {
        if (popup === null) return;
        popup.remove();
        popup = null;
        rows = [];
        focusedIndex = -1;
        opts.onHighlight(null);
        document.removeEventListener("mousedown", onDocMouseDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("resize", closePopup);
        window.removeEventListener("blur", closePopup);
        trigger.classList.remove("open");
    };

    /** @param {MouseEvent} e */
    const onDocMouseDown = (e) => {
        if (popup === null) return;
        const t = /** @type {Node} */ (e.target);
        if (popup.contains(t) || trigger.contains(t)) return;
        closePopup();
    };

    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
        if (popup === null) return;
        if (e.key === "Escape") {
            e.preventDefault();
            closePopup();
            trigger.focus();
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocused(Math.min(rows.length - 1, focusedIndex + 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocused(Math.max(0, focusedIndex - 1));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (focusedIndex >= 0) {
                const o = opts.objects[focusedIndex];
                closePopup();
                opts.onSelect(o.kind, o.index);
            }
        }
    };

    const openPopup = () => {
        if (popup !== null) { closePopup(); return; }
        popup = document.createElement("div");
        popup.className = "insp-objid-popup";
        popup.setAttribute("role", "listbox");
        const rect = trigger.getBoundingClientRect();
        popup.style.left = `${Math.round(rect.left)}px`;
        popup.style.top = `${Math.round(rect.bottom + 2)}px`;
        popup.style.minWidth = `${Math.round(rect.width)}px`;

        rows = opts.objects.map((o, i) => {
            const row = document.createElement("div");
            row.className = "insp-objid-row";
            row.setAttribute("role", "option");
            if (o.id === opts.currentId) row.classList.add("current");
            row.textContent = o.id;
            row.addEventListener("mouseenter", () => setFocused(i));
            // Keep focus on mousedown so the click selects cleanly.
            row.addEventListener("mousedown", (e) => e.preventDefault());
            row.addEventListener("click", () => {
                closePopup();
                opts.onSelect(o.kind, o.index);
            });
            popup.appendChild(row);
            return row;
        });

        // Leaving the list (but not closing) drops the preview highlight.
        popup.addEventListener("mouseleave", () => {
            if (focusedIndex >= 0 && rows[focusedIndex]) {
                rows[focusedIndex].classList.remove("focused");
            }
            focusedIndex = -1;
            opts.onHighlight(null);
        });

        document.body.appendChild(popup);
        document.addEventListener("mousedown", onDocMouseDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("resize", closePopup);
        window.addEventListener("blur", closePopup);
        trigger.classList.add("open");

        // Pre-focus the current id so keyboard users land on it.
        const curIdx = opts.objects.findIndex((o) => o.id === opts.currentId);
        if (curIdx >= 0) setFocused(curIdx);
    };

    trigger.addEventListener("click", () => openPopup());
    trigger.addEventListener("keydown", (e) => {
        if (popup !== null) return; // popup's own handler is active
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            openPopup();
        }
    });

    return trigger;
}
