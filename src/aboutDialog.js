/**
 * About dialog.
 *
 * A read-only modal showing the app's identity \u2014 name, version,
 * description, and a few static identifiers that help the user
 * place which build of the codebase they're looking at.
 *
 * All values come from src/version.js so this file stays purely
 * presentational. Every row renders unconditionally; values
 * that are empty in version.js show as \"(not set)\" in italic
 * gray so the dialog's vertical layout stays stable as those
 * fields get filled in over time.
 */

// @ts-check

import { openDialog } from "./dialog.js";
import {
    APP_NAME,
    APP_VERSION,
    APP_DESCRIPTION,
    DATA_FORMAT_VERSION,
    DESIGN_DOC_REFERENCE,
    SOURCE_URL,
    AUTHOR_LINE,
} from "./version.js";

export function openAboutDialog() {
    const handle = openDialog({ title: `About ${APP_NAME}`, width: "440px" });
    const body = handle.body;
    body.classList.add("about-body");

    body.appendChild(makeHeader());
    body.appendChild(makeRow("Version", APP_VERSION));
    body.appendChild(makeRow("Data format", DATA_FORMAT_VERSION));
    body.appendChild(makeRow("Design", DESIGN_DOC_REFERENCE));
    body.appendChild(makeRow("Author", AUTHOR_LINE));
    body.appendChild(makeRow("Source", SOURCE_URL));

    body.appendChild(makeButtonRow(handle));
}

function makeHeader() {
    const wrap = document.createElement("div");
    wrap.className = "about-header";

    const name = document.createElement("div");
    name.className = "about-app-name";
    name.textContent = APP_NAME;
    wrap.appendChild(name);

    const desc = document.createElement("div");
    desc.className = "about-description";
    desc.textContent = APP_DESCRIPTION;
    wrap.appendChild(desc);

    return wrap;
}

/**
 * @param {string} label
 * @param {string} value
 */
function makeRow(label, value) {
    const row = document.createElement("div");
    row.className = "about-row";

    const labelEl = document.createElement("span");
    labelEl.className = "about-row-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const valueEl = document.createElement("span");
    valueEl.className = "about-row-value";
    if (value === "") {
        valueEl.textContent = "(not set)";
        valueEl.classList.add("about-row-value-empty");
    } else {
        valueEl.textContent = value;
    }
    row.appendChild(valueEl);

    return row;
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
