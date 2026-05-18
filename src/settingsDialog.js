/**
 * Settings dialog.
 *
 * Two kinds of categories:
 *
 *   1. Schema-driven: each preference in src/preferences.js
 *      lives in a category, and renders as a labelled control
 *      whose type comes from the schema. Adding a new schema
 *      preference automatically appears here.
 *
 *   2. Custom: hard-coded categories with their own render
 *      function, used for things that don't fit the simple
 *      schema (Storage, with its folder picker and disk-mirror
 *      state, is the only one currently).
 *
 * Values save on every change; there is no Apply or OK. The
 * dialog dismisses on Escape, click-outside, or Close.
 */

// @ts-check

import { openDialog } from "./dialog.js";
import {
    PREFERENCES,
    getPreference,
    setPreference,
} from "./preferences.js";
import { loadAllScoreRecords } from "./storage.js";

/**
 * @typedef {{ kind: "schema", name: string, defs: import("./preferences.js").PreferenceDef[] }
 *         | { kind: "custom", name: string, render: (panel: HTMLElement) => void }} CategoryEntry
 */

/**
 * @typedef {Object} SettingsContext
 * @property {import("./diskMirror.js").DiskMirror} diskMirror
 * @property {import("./messages.js").MessageArea} messages
 */

/**
 * Open the Settings dialog.
 * @param {SettingsContext} ctx
 */
export function openSettingsDialog(ctx) {
    const handle = openDialog({ title: "Settings", width: "640px" });
    const body = handle.body;
    body.classList.add("settings-body");

    /** @type {CategoryEntry[]} */
    const categories = buildCategories(ctx);

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

    let active = categories[0];

    const renderPanel = () => {
        panel.innerHTML = "";
        if (active.kind === "schema") {
            for (const def of active.defs) {
                panel.appendChild(makeFieldRow(def));
            }
        } else {
            active.render(panel);
        }
    };

    for (const cat of categories) {
        const item = document.createElement("div");
        item.className = "settings-category";
        item.setAttribute("role", "tab");
        item.setAttribute("tabindex", "0");
        item.textContent = cat.name;
        if (cat === active) item.classList.add("selected");

        const select = () => {
            active = cat;
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
 * Build the list of categories: schema-driven from PREFERENCES,
 * plus the custom Storage category at the end.
 * @param {SettingsContext} ctx
 * @returns {CategoryEntry[]}
 */
function buildCategories(ctx) {
    // electronOnly preferences are filtered out on the web
    // build so the user never sees a control whose backing
    // feature doesn't exist in their environment (currently
    // just Backups: Number of Backups to Keep, which only
    // has meaning when the desktop build is writing files to
    // disk via Electron IPC).
    const isElectron =
        typeof (/** @type {any} */ (window).gxwStorage) === "object" &&
        (/** @type {any} */ (window).gxwStorage) !== null;

    /** @type {Map<string, import("./preferences.js").PreferenceDef[]>} */
    const byName = new Map();
    for (const def of PREFERENCES) {
        if (def.electronOnly === true && !isElectron) continue;
        const cat = def.category ?? "Display";
        let bucket = byName.get(cat);
        if (bucket === undefined) {
            bucket = [];
            byName.set(cat, bucket);
        }
        bucket.push(def);
    }

    /** @type {CategoryEntry[]} */
    const result = [];
    for (const [name, defs] of byName) {
        result.push({ kind: "schema", name, defs });
    }
    result.push({
        kind: "custom",
        name: "Storage",
        render: (panel) => renderStoragePanel(panel, ctx),
    });
    return result;
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
        input.addEventListener("input", () => {
            const n = parseFloat(input.value);
            if (Number.isFinite(n)) setPreference(def.key, n);
        });
        attachScrub(input, def);
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
 * Attach scrub-to-change behaviour to a number input. The
 * user can press the mouse button anywhere on the input and
 * drag vertically to adjust the value: drag up increases,
 * drag down decreases. The native spinner buttons and direct
 * keyboard editing continue to work unchanged — the scrub
 * only kicks in after the mouse has moved past a small
 * threshold, so a quick click on a spinner or to focus the
 * field for typing is unaffected.
 *
 * Sensitivity is fixed at five vertical pixels per declared
 * step. For the brightness-reduction prefs (step 0.05 over a
 * 0–1 range, 18 steps) this gives roughly 90 pixels of drag
 * per full range, comfortable for both coarse and fine
 * adjustment without needing modifier keys.
 *
 * Per-drag mousemove and mouseup listeners are attached to
 * the window and removed on mouseup, so listeners do not
 * accumulate across multiple drags or across openings of
 * the Settings dialog. The mousedown listener stays on the
 * input itself and is garbage-collected with the input when
 * the dialog DOM is torn down.
 *
 * @param {HTMLInputElement} input
 * @param {import("./preferences.js").PreferenceDef} def
 */
function attachScrub(input, def) {
    const PIXELS_PER_STEP = 5;
    const DRAG_THRESHOLD_PX = 3;
    const step = def.step ?? 1;
    const min = def.min;
    const max = def.max;
    // Number of decimal places implied by the step. Used to
    // round computed values so a scrub of many small steps
    // doesn't accumulate floating-point error (e.g. 0.05
    // multiplied 18 times should land on 0.9, not on
    // 0.8999999...).
    const decimals = String(step).includes(".")
        ? String(step).split(".")[1].length
        : 0;

    /** @param {MouseEvent} e */
    const onMouseDown = (e) => {
        if (e.button !== 0) return;
        const startY = e.clientY;
        const v = parseFloat(input.value);
        const startValue = Number.isFinite(v)
            ? v
            : (typeof def.default === "number" ? def.default : 0);
        let scrubbing = false;

        /** @param {MouseEvent} moveE */
        const onMouseMove = (moveE) => {
            const dy = startY - moveE.clientY;  // up is positive
            if (!scrubbing) {
                if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
                scrubbing = true;
                document.body.style.cursor = "ns-resize";
            }
            // preventDefault during scrub suppresses text
            // selection that would otherwise extend as the
            // mouse moves over the input's text content.
            moveE.preventDefault();
            const stepDelta = Math.round(dy / PIXELS_PER_STEP);
            let newValue = startValue + stepDelta * step;
            if (min !== undefined) newValue = Math.max(min, newValue);
            if (max !== undefined) newValue = Math.min(max, newValue);
            newValue = parseFloat(newValue.toFixed(decimals));
            // Skip the write if the snapped value hasn't
            // changed from the displayed value — avoids firing
            // setPreference (and thus the canvas re-transform)
            // on every mousemove pixel.
            if (parseFloat(input.value) === newValue) return;
            input.value = String(newValue);
            setPreference(def.key, newValue);
        };

        const onMouseUp = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            if (scrubbing) {
                document.body.style.cursor = "";
            }
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    };

    input.addEventListener("mousedown", onMouseDown);
}

/**
 * Render the Storage category, which controls the disk-mirror
 * folder choice. Has its own UI because it isn't a simple
 * scalar value \u2014 it's a folder handle plus a few status bits.
 *
 * @param {HTMLElement} panel
 * @param {SettingsContext} ctx
 */
function renderStoragePanel(panel, ctx) {
    const mirror = ctx.diskMirror;

    // Header explaining the feature, since this is the first
    // time most users will encounter it.
    const intro = document.createElement("div");
    intro.className = "settings-description settings-storage-intro";
    intro.textContent =
        "Mirror your scores to a folder on disk so AI assistants " +
        "(like Claude Desktop's filesystem MCP) can read and edit " +
        "them. Changes made to the files on disk are picked up by " +
        "GXW within a second or two.";
    panel.appendChild(intro);

    // Status row: folder name and current state.
    const statusRow = document.createElement("div");
    statusRow.className = "settings-row settings-storage-status";
    panel.appendChild(statusRow);

    const renderStatus = () => {
        const status = mirror.getStatus();
        statusRow.innerHTML = "";

        const labelEl = document.createElement("div");
        labelEl.className = "settings-label";
        labelEl.textContent = "GXW Working Storage Folder";
        statusRow.appendChild(labelEl);

        const valueEl = document.createElement("div");
        valueEl.className = "settings-storage-folder";
        if (status.folderName === null) {
            valueEl.textContent = "(not connected)";
            valueEl.classList.add("settings-storage-folder-empty");
        } else {
            valueEl.textContent = status.folderName;
        }
        statusRow.appendChild(valueEl);

        const stateEl = document.createElement("div");
        stateEl.className = "settings-storage-state";
        if (!status.hasFolder) {
            stateEl.textContent = "Not configured.";
        } else if (!status.enabled) {
            stateEl.textContent = "Folder chosen but mirroring is paused.";
        } else {
            stateEl.textContent = "Mirroring active.";
        }
        statusRow.appendChild(stateEl);
    };
    renderStatus();
    const unsubscribe = mirror.subscribeStatus(renderStatus);
    // The dialog HTML is removed when the user closes it, but
    // the subscription would leak. We can't easily hook into
    // the dialog's close event from here, so we bound the
    // subscription's lifetime to the panel's connection state
    // via MutationObserver.
    const observer = new MutationObserver(() => {
        if (!document.body.contains(panel)) {
            unsubscribe();
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Action buttons.
    const buttonRow = document.createElement("div");
    buttonRow.className = "settings-storage-buttons";
    panel.appendChild(buttonRow);

    const chooseBtn = document.createElement("button");
    chooseBtn.className = "modal-button modal-button-primary";
    chooseBtn.textContent = "Choose Folder\u2026";
    chooseBtn.addEventListener("click", async () => {
        try {
            await mirror.chooseFolder("GXW Working Storage");
            ctx.messages.write(`Mirroring scores to "${mirror.getStatus().folderName}".`);
        } catch (err) {
            // AbortError is the user dismissing the picker;
            // not an error worth surfacing.
            if (err instanceof Error && err.name !== "AbortError") {
                ctx.messages.write(`Could not choose folder: ${err.message}`, "error");
            }
        }
    });
    buttonRow.appendChild(chooseBtn);

    const pauseBtn = document.createElement("button");
    pauseBtn.className = "modal-button";
    const refreshPauseBtn = () => {
        const s = mirror.getStatus();
        if (!s.hasFolder) {
            pauseBtn.textContent = "Pause";
            pauseBtn.disabled = true;
        } else if (s.enabled) {
            pauseBtn.textContent = "Pause";
            pauseBtn.disabled = false;
        } else {
            pauseBtn.textContent = "Resume";
            pauseBtn.disabled = false;
        }
    };
    refreshPauseBtn();
    mirror.subscribeStatus(refreshPauseBtn);
    pauseBtn.addEventListener("click", async () => {
        const s = mirror.getStatus();
        await mirror.setEnabled(!s.enabled);
        ctx.messages.write(
            mirror.getStatus().enabled
                ? "Disk mirroring resumed."
                : "Disk mirroring paused (folder remembered)."
        );
    });
    buttonRow.appendChild(pauseBtn);

    const disconnectBtn = document.createElement("button");
    disconnectBtn.className = "modal-button";
    disconnectBtn.textContent = "Disconnect";
    const refreshDisconnectBtn = () => {
        disconnectBtn.disabled = !mirror.getStatus().hasFolder;
    };
    refreshDisconnectBtn();
    mirror.subscribeStatus(refreshDisconnectBtn);
    disconnectBtn.addEventListener("click", async () => {
        await mirror.disconnect();
        ctx.messages.write("Disk mirroring disconnected.");
    });
    buttonRow.appendChild(disconnectBtn);

    // Push All button: writes every score from IndexedDB out
    // to disk. Useful for first-time setup so existing scores
    // are immediately available to AI tools without having to
    // open and save each one.
    const pushAllBtn = document.createElement("button");
    pushAllBtn.className = "modal-button";
    pushAllBtn.textContent = "Push All Scores to Disk";
    const refreshPushAllBtn = () => {
        const s = mirror.getStatus();
        pushAllBtn.disabled = !s.ready;
    };
    refreshPushAllBtn();
    mirror.subscribeStatus(refreshPushAllBtn);
    pushAllBtn.addEventListener("click", async () => {
        try {
            const records = await loadAllScoreRecords();
            for (const record of records) {
                await mirror.pushRecord(record);
            }
            ctx.messages.write(
                `Pushed ${records.length} score${records.length === 1 ? "" : "s"} to disk.`
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.messages.write(`Could not push scores to disk: ${msg}`, "error");
        }
    });
    buttonRow.appendChild(pushAllBtn);

    // Help text below buttons.
    const help = document.createElement("div");
    help.className = "settings-description";
    help.textContent =
        "Choosing a folder grants GXW permission to read and write " +
        "in it. The folder's contents are managed by GXW \u2014 each " +
        "score becomes a subfolder containing scene.json and " +
        "behaviours.js. Disconnecting just forgets the folder; the " +
        "files on disk are left in place.";
    panel.appendChild(help);
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
