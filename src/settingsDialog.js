/**
 * Settings dialog.
 *
 * Opens a modal with a left-side category list and a right-side
 * panel showing the controls for the selected category. Each
 * preference is rendered from its schema entry in
 * src/preferences.js \u2014 type, bounds, default, label, and
 * description \u2014 so adding a new setting requires only adding
 * an entry there, not editing this file.
 *
 * Values save on every change; there is no Apply or OK. The
 * dialog dismisses on Escape, click-outside, or the Close
 * button.
 */

// @ts-check

import { openDialog } from "./dialog.js";
import {
    PREFERENCES,
    getPreference,
    setPreference,
} from "./preferences.js";

export function openSettingsDialog() {
    const handle = openDialog({ title: "Settings", width: "640px" });
    const body = handle.body;
    body.classList.add("settings-body");

    // Bucket preferences by category, preserving the schema's
    // declaration order within each bucket.
    /** @type {Map<string, import("./preferences.js").PreferenceDef[]>} */
    const byCategory = new Map();
    for (const def of PREFERENCES) {
        const cat = def.category ?? "Display";
        let bucket = byCategory.get(cat);
        if (bucket === undefined) {
            bucket = [];
            byCategory.set(cat, bucket);
        }
        bucket.push(def);
    }
    const categories = Array.from(byCategory.keys());

    // Layout: a two-column flex with category list on the left
    // and a panel of controls on the right.
    const layout = document.createElement("div");
    layout.className = "settings-layout";
    body.appendChild(layout);

    const sidebar = document.createElement("div");
    sidebar.className = "settings-sidebar";
    sidebar.setAttribute("role", "tablist");
    layout.appendChild(sidebar);

    const panel = document.createElement("div");
    panel.className = "settings-panel";
    layout.appendChild(panel);

    let activeCategory = categories[0];

    const renderPanel = () => {
        panel.innerHTML = "";
        const defs = byCategory.get(activeCategory) ?? [];
        for (const def of defs) {
            panel.appendChild(makeFieldRow(def));
        }
    };

    for (const cat of categories) {
        const item = document.createElement("div");
        item.className = "settings-category";
        item.setAttribute("role", "tab");
        item.setAttribute("tabindex", "0");
        item.textContent = cat;
        if (cat === activeCategory) item.classList.add("selected");

        const select = () => {
            activeCategory = cat;
            for (const sib of sidebar.children) {
                if (sib instanceof HTMLElement) sib.classList.remove("selected");
            }
            item.classList.add("selected");
            renderPanel();
        };

        item.addEventListener("click", select);
        item.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                select();
            }
        });
        sidebar.appendChild(item);
    }

    renderPanel();

    body.appendChild(makeButtonRow(handle));
}

/**
 * Build a single labelled control plus its help text.
 * @param {import("./preferences.js").PreferenceDef} def
 * @returns {HTMLElement}
 */
function makeFieldRow(def) {
    const row = document.createElement("div");
    row.className = "settings-row";

    const label = document.createElement("label");
    label.className = "settings-label";
    label.textContent = def.label;
    row.appendChild(label);

    const control = makeControl(def);
    if (control !== null) {
        const id = `settings-${def.key}`;
        control.id = id;
        label.setAttribute("for", id);
        row.appendChild(control);
    }

    if (def.description !== "") {
        const desc = document.createElement("div");
        desc.className = "settings-description";
        desc.textContent = def.description;
        row.appendChild(desc);
    }

    return row;
}

/**
 * Build the input control for a preference definition.
 * @param {import("./preferences.js").PreferenceDef} def
 * @returns {HTMLElement | null}
 */
function makeControl(def) {
    if (def.type === "number") {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "settings-input settings-input-number";
        if (def.min !== undefined) input.min = String(def.min);
        if (def.max !== undefined) input.max = String(def.max);
        if (def.step !== undefined) input.step = String(def.step);
        input.value = String(getPreference(def.key));
        // Save on every change, both for arrow-keys (input) and
        // for direct typing followed by blur (change).
        input.addEventListener("input", () => {
            const n = parseFloat(input.value);
            if (Number.isFinite(n)) setPreference(def.key, n);
        });
        return input;
    }
    if (def.type === "boolean") {
        const wrap = document.createElement("div");
        wrap.className = "settings-toggle";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(getPreference(def.key));
        input.addEventListener("change", () => {
            setPreference(def.key, input.checked);
        });
        wrap.appendChild(input);
        return wrap;
    }
    if (def.type === "string") {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "settings-input settings-input-text";
        input.value = String(getPreference(def.key));
        input.addEventListener("input", () => {
            setPreference(def.key, input.value);
        });
        return input;
    }
    return null;
}

/**
 * @param {import("./dialog.js").DialogHandle} handle
 */
function makeButtonRow(handle) {
    const buttons = document.createElement("div");
    buttons.className = "modal-buttons";

    const close = document.createElement("button");
    close.className = "modal-button modal-button-primary";
    close.textContent = "Close";
    close.addEventListener("click", () => handle.close());
    buttons.appendChild(close);

    return buttons;
}
