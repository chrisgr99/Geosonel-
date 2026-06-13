/**
 * Harmony panel.
 *
 * The Harmony tab's picker: a playlist dropdown plus a type-to-filter
 * song combobox. Choosing a song freezes that chart into the scene's
 * `harmony` field (so objects can follow the progression) and aligns the
 * scene's time signature to the chart.
 *
 * Structurally mirrors CanvasInspector: the panel owns its DOM subtree
 * inside a container the editor hands it, exposes a small wiring contract
 * (onChooseSong for the edit pipeline), and a refresh() the editor calls
 * when the Harmony tab activates so a freshly imported playlist appears
 * without an app restart.
 *
 * SCOPE (this commit): picker only. No chord-chart rendering, no
 * now-playing highlight, no loop/stop, no Letter/Roman toggle.
 *
 * DATA. The lightweight listing path (playlists + per-song metadata +
 * title search) comes from src/harmonyLibrary.js, which is pure and
 * node-importable. The full parsed Song (the lazy, expensive path) is
 * fetched on select via the library's getSong and handed to the
 * onChooseSong callback, which dispatches the scene edit.
 *
 * This module is DOM-only (document.* at render time) plus a pure-library
 * import, so it is node --checkable for syntax even though it only really
 * runs in the renderer.
 */

// @ts-check

import {
    listPlaylists,
    listSongs,
    searchSongs,
    getSong,
} from "./harmonyLibrary.js";
import { layoutChart, groupRows, formatChordParts } from "./harmonyChartLayout.js";

const SCOPE_ALL = "all";

/** Bars per chart row before wrapping. */
const BARS_PER_ROW = 4;

// Pitch-class spelling for the "Now:" key label. Flat-side tonics spell
// with flats (Eb not D#); everything else with sharps. Mirrors the bias
// irealChord.js uses for tonic spelling, kept local so this panel stays
// a leaf with no chord-internals dependency.
const PC_TO_NAME_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PC_TO_NAME_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const FLAT_TONIC_PCS = new Set([5, 10, 3, 8, 1, 6]);

/**
 * @param {{ tonicPitchClass: number, mode: "major" | "minor" }} key
 * @returns {string} e.g. "C minor", "Eb major"
 */
function keyLabel(key) {
    const pc = ((key.tonicPitchClass % 12) + 12) % 12;
    const name = FLAT_TONIC_PCS.has(pc) ? PC_TO_NAME_FLAT[pc] : PC_TO_NAME_SHARP[pc];
    return `${name} ${key.mode}`;
}

/**
 * @param {[number, number]} ts
 * @returns {string} e.g. "4/4"
 */
function tsLabel(ts) {
    return `${ts[0]}/${ts[1]}`;
}

/**
 * Build text spans for a CONTAINS match, wrapping the matched substring
 * in <span class="harmony-song-match">. Case-insensitive; matches the
 * first occurrence (the same one the library's CONTAINS test found).
 * @param {string} title
 * @param {string} needle  already lower-cased, non-empty
 * @returns {DocumentFragment}
 */
function highlightTitle(title, needle) {
    const frag = document.createDocumentFragment();
    const idx = title.toLowerCase().indexOf(needle);
    if (idx < 0 || needle === "") {
        frag.appendChild(document.createTextNode(title));
        return frag;
    }
    if (idx > 0) frag.appendChild(document.createTextNode(title.slice(0, idx)));
    const mark = document.createElement("span");
    mark.className = "harmony-song-match";
    mark.textContent = title.slice(idx, idx + needle.length);
    frag.appendChild(mark);
    const rest = title.slice(idx + needle.length);
    if (rest !== "") frag.appendChild(document.createTextNode(rest));
    return frag;
}

export class HarmonyPanel {
    /**
     * @param {HTMLElement} container  Element to mount the panel in.
     */
    constructor(container) {
        this.container = container;

        /**
         * Edit-dispatch callback wired by main.js. Receives the full
         * parsed Song; main.js sets scene.harmony + scene.timeSignature
         * and re-runs. Null until wired.
         * @type {((song: import("./harmonyModel.js").Song) => void) | null}
         */
        this._onChooseSong = null;

        // --- Picker state ---

        /** Selected playlist id, or SCOPE_ALL. */
        this._scope = SCOPE_ALL;
        /** Current filter text. */
        this._query = "";
        /** Index of the keyboard-highlighted result, or -1. */
        this._activeIndex = -1;
        /** Whether the results dropdown is open. */
        this._open = false;
        /**
         * Current result rows: flat hits with playlist context.
         * @type {Array<{playlistId: string, playlistName: string, index: number, title: string, supported: boolean}>}
         */
        this._results = [];
        /** Total songs in scope (for the "N of M" count). */
        this._scopeTotal = 0;
        /**
         * The currently chosen song summary line, or null.
         * @type {{title: string, key: {tonicPitchClass: number, mode: "major"|"minor"}, timeSignature: [number, number]} | null}
         */
        this._chosen = null;

        // --- Chart-display state ---

        /**
         * The scene's current harmony (the chosen, frozen progression) or
         * null. Pushed in from main.js via setHarmony after each scene
         * load/re-run; the inbound direction that mirrors onChooseSong's
         * outbound one. Drives both the "Now:" line and the chord chart.
         * @type {import("./harmonyScene.js").SceneHarmony | null}
         */
        this._harmony = null;

        /**
         * Chord-label mode for the chart. "letter" → Cm7, "roman" → i7.
         * Defaults to letter; flipped by the Letter/Roman toggle.
         * @type {"letter" | "roman"}
         */
        this._displayMode = "letter";

        // --- DOM handles (filled by _render) ---
        /** @type {HTMLSelectElement | null} */
        this._playlistSelect = null;
        /** @type {HTMLInputElement | null} */
        this._input = null;
        /** @type {HTMLDivElement | null} */
        this._list = null;
        /** @type {HTMLDivElement | null} */
        this._nowLine = null;
        /** @type {HTMLDivElement | null} */
        this._chartEl = null;
        /** @type {HTMLButtonElement | null} */
        this._toggleBtn = null;

        this._render();

        // Close the dropdown when the user clicks outside the combo.
        // Added once here (not per-render) and reads this._input live, so
        // it keeps working across refresh() re-renders.
        this._onDocMouseDown = (/** @type {MouseEvent} */ e) => {
            if (!this._open) return;
            const combo = this._input !== null
                ? this._input.closest(".harmony-combo") : null;
            if (combo !== null && combo.contains(/** @type {Node} */ (e.target))) return;
            this._open = false;
            this._renderList();
        };
        document.addEventListener("mousedown", this._onDocMouseDown);
    }

    /**
     * Wire the choose-song edit callback (main.js owns the scene edit +
     * re-run). Mirrors CanvasInspector.onSceneEdit.
     * @param {(song: import("./harmonyModel.js").Song) => void} cb
     */
    onChooseSong(cb) {
        this._onChooseSong = cb;
    }

    /**
     * Reflect the scene's current harmony into the panel (the INBOUND
     * direction; onChooseSong is the outbound one). main.js calls this
     * after every scene load/re-run with `scene.harmony` (or null), so both
     * picking a song (which re-runs) and reopening a saved score that
     * already carries a stored progression populate the chart and the
     * "Now:" line. Re-renders both from the stored harmony.
     * @param {import("./harmonyScene.js").SceneHarmony | null} harmony
     */
    setHarmony(harmony) {
        this._harmony = harmony || null;
        // Keep the "Now:" line in sync even when the chart isn't visible
        // (no library imported yet → picker is the placeholder hint, but a
        // stored harmony should still announce itself).
        if (this._harmony !== null) {
            this._chosen = {
                title: this._harmony.title,
                key: this._harmony.key,
                timeSignature: this._harmony.timeSignature,
            };
        }
        this._renderNowLine();
        this._renderChart();
    }

    /**
     * Re-read the library and rebuild the dropdown + list. Called by the
     * editor when the Harmony tab activates, so a playlist imported via
     * the File menu shows up without an app restart.
     */
    refresh() {
        this._render();
    }

    /** @returns {boolean} */
    _hasLibrary() {
        return listPlaylists().length > 0;
    }

    /** Full re-render from current library + picker state. */
    _render() {
        this.container.innerHTML = "";

        const heading = document.createElement("h2");
        heading.textContent = "Harmony";
        this.container.appendChild(heading);

        const playlists = listPlaylists();
        if (playlists.length === 0) {
            const hint = document.createElement("p");
            hint.className = "harmony-placeholder-hint";
            hint.textContent =
                "Import a chart from File → Import iReal Pro Chart…, then choose a song.";
            this.container.appendChild(hint);
            // No library, but the scene may still carry a stored harmony
            // (a saved score opened on a machine without the source
            // playlist). Show its chart + "Now:" line anyway.
            const nowLine = document.createElement("p");
            nowLine.className = "harmony-now-line";
            this._nowLine = nowLine;
            this.container.appendChild(nowLine);
            this._renderNowLine();
            this._buildChartSection();
            this._renderChart();
            return;
        }

        // Keep the scope valid against the current library.
        if (this._scope !== SCOPE_ALL &&
            !playlists.some((p) => p.id === this._scope)) {
            this._scope = playlists[0].id;
        }
        if (this._scope === SCOPE_ALL && this._query === "" && this._results.length === 0) {
            // Default to the first playlist on a fresh mount, but never
            // override a user's explicit "All" choice once they've typed.
            this._scope = playlists[0].id;
        }

        const row = document.createElement("div");
        row.className = "harmony-picker-row";

        // Playlist dropdown.
        const select = document.createElement("select");
        select.className = "harmony-playlist-select";
        for (const p of playlists) {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = `${p.name} (${p.songCount})`;
            select.appendChild(opt);
        }
        const allOpt = document.createElement("option");
        allOpt.value = SCOPE_ALL;
        allOpt.textContent = "All playlists";
        select.appendChild(allOpt);
        select.value = this._scope;
        select.addEventListener("change", () => {
            this._scope = select.value;
            this._recomputeResults();
            this._renderList();
        });
        this._playlistSelect = select;
        row.appendChild(select);

        // Song combobox (input + dropdown below).
        const combo = document.createElement("div");
        combo.className = "harmony-combo";

        const input = document.createElement("input");
        input.type = "text";
        input.className = "harmony-song-input";
        input.placeholder = "Type to filter songs…";
        input.value = this._query;
        input.addEventListener("input", () => {
            this._query = input.value;
            this._open = true;
            this._recomputeResults();
            this._renderList();
        });
        input.addEventListener("focus", () => {
            this._open = true;
            this._recomputeResults();
            this._renderList();
        });
        input.addEventListener("keydown", (e) => this._onKeyDown(e));
        this._input = input;
        combo.appendChild(input);

        // Caret affordance: an obvious way to open the song list. Opens
        // with the current query — so right after a pick (query cleared)
        // it shows the whole list. Open-only (Escape / outside-click /
        // selecting closes), to avoid fighting the input's focus-opens.
        const caret = document.createElement("button");
        caret.type = "button";
        caret.className = "harmony-song-caret";
        caret.setAttribute("aria-label", "Show song list");
        caret.textContent = "▾";
        caret.addEventListener("mousedown", (e) => {
            e.preventDefault();
            this._open = true;
            this._recomputeResults();
            if (this._input !== null) this._input.focus();
            this._renderList();
        });
        combo.appendChild(caret);

        const list = document.createElement("div");
        list.className = "harmony-song-list hidden";
        this._list = list;
        combo.appendChild(list);

        row.appendChild(combo);
        this.container.appendChild(row);

        // "Now:" chosen-song line.
        const nowLine = document.createElement("p");
        nowLine.className = "harmony-now-line";
        this._nowLine = nowLine;
        this.container.appendChild(nowLine);
        this._renderNowLine();

        // Chord-chart section (heading + Letter/Roman toggle + chart grid).
        this._buildChartSection();
        this._renderChart();

        // Close the list on outside click.
        this._recomputeResults();
        this._renderList();
    }

    /**
     * Recompute _results and _scopeTotal from the current scope + query.
     * - "All": library search across every playlist (CONTAINS, ci).
     * - single playlist: its song metadata, filtered by CONTAINS.
     * An empty query lists everything in scope (so focusing the field
     * shows the whole playlist).
     */
    _recomputeResults() {
        const needle = this._query.trim().toLowerCase();

        if (this._scope === SCOPE_ALL) {
            // Total across all playlists.
            const playlists = listPlaylists();
            this._scopeTotal = playlists.reduce((n, p) => n + p.songCount, 0);
            if (needle === "") {
                // List everything: gather each playlist's songs.
                const all = [];
                for (const p of playlists) {
                    for (const m of listSongs(p.id)) {
                        all.push({
                            playlistId: p.id,
                            playlistName: p.name,
                            index: m.index,
                            title: m.title,
                            supported: m.supported,
                        });
                    }
                }
                this._results = all;
            } else {
                const hits = searchSongs(this._query, { scope: SCOPE_ALL });
                // searchSongs hits lack `supported`; re-derive cheaply.
                this._results = hits.map((h) => ({
                    playlistId: h.playlistId,
                    playlistName: h.playlistName,
                    index: h.index,
                    title: h.title,
                    supported: this._supportedFor(h.playlistId, h.index),
                }));
            }
        } else {
            const metas = listSongs(this._scope);
            this._scopeTotal = metas.length;
            const name = this._playlistName(this._scope);
            const filtered = needle === ""
                ? metas
                : metas.filter((m) => m.title.toLowerCase().includes(needle));
            this._results = filtered.map((m) => ({
                playlistId: this._scope,
                playlistName: name,
                index: m.index,
                title: m.title,
                supported: m.supported,
            }));
        }

        // Clamp the keyboard highlight.
        if (this._results.length === 0) {
            this._activeIndex = -1;
        } else if (this._activeIndex >= this._results.length) {
            this._activeIndex = this._results.length - 1;
        }
    }

    /**
     * Lightweight `supported` lookup for one song (used to annotate
     * "All"-scope search hits, which the library search omits).
     * @param {string} playlistId
     * @param {number} index
     * @returns {boolean}
     */
    _supportedFor(playlistId, index) {
        const m = listSongs(playlistId).find((s) => s.index === index);
        return m ? m.supported : true;
    }

    /**
     * @param {string} id
     * @returns {string}
     */
    _playlistName(id) {
        const p = listPlaylists().find((x) => x.id === id);
        return p ? p.name : "";
    }

    /** Render the results dropdown from _results. */
    _renderList() {
        const list = this._list;
        if (list === null) return;
        list.innerHTML = "";

        if (!this._open) {
            list.classList.add("hidden");
            return;
        }
        list.classList.remove("hidden");

        const needle = this._query.trim().toLowerCase();
        const showPlaylist = this._scope === SCOPE_ALL;

        // "N of M" count header.
        const count = document.createElement("div");
        count.className = "harmony-song-count";
        count.textContent = `${this._results.length} of ${this._scopeTotal}`;
        list.appendChild(count);

        if (this._results.length === 0) {
            const empty = document.createElement("div");
            empty.className = "harmony-song-empty";
            empty.textContent = "No matches";
            list.appendChild(empty);
            return;
        }

        this._results.forEach((r, i) => {
            const rowEl = document.createElement("div");
            rowEl.className = "harmony-song-result";
            if (i === this._activeIndex) rowEl.classList.add("active");

            const titleEl = document.createElement("span");
            titleEl.className = "harmony-song-title";
            if (needle === "") {
                titleEl.textContent = r.title;
            } else {
                titleEl.appendChild(highlightTitle(r.title, needle));
            }
            rowEl.appendChild(titleEl);

            if (!r.supported) {
                const note = document.createElement("span");
                note.className = "harmony-song-note";
                note.textContent = "(unsupported meter)";
                rowEl.appendChild(note);
            }

            if (showPlaylist) {
                const pl = document.createElement("span");
                pl.className = "harmony-song-playlist";
                pl.textContent = r.playlistName;
                rowEl.appendChild(pl);
            }

            rowEl.addEventListener("mousedown", (e) => {
                // mousedown (not click) so the input's blur doesn't close
                // the list before the selection registers.
                e.preventDefault();
                this._select(i);
            });
            rowEl.addEventListener("mousemove", () => {
                if (this._activeIndex !== i) {
                    this._activeIndex = i;
                    this._renderList();
                }
            });

            list.appendChild(rowEl);
        });
    }

    /** Render the "Now: …" chosen-song line. */
    _renderNowLine() {
        const el = this._nowLine;
        if (el === null) return;
        if (this._chosen === null) {
            el.textContent = "";
            return;
        }
        el.textContent =
            `Now: ${this._chosen.title} — ${keyLabel(this._chosen.key)}, ${tsLabel(this._chosen.timeSignature)}`;
    }

    /**
     * Build the chord-chart section: a heading row carrying the
     * Letter/Roman toggle, plus an (empty) chart grid container that
     * _renderChart fills. Idempotent within a _render: rebuilds the
     * subtree and re-captures the DOM handles.
     */
    _buildChartSection() {
        const head = document.createElement("div");
        head.className = "harmony-chart-head";

        const title = document.createElement("span");
        title.className = "harmony-chart-title";
        title.textContent = "Chart";
        head.appendChild(title);

        // Letter/Roman toggle. A single two-state button: its label shows
        // the CURRENT mode; clicking flips the mode and re-renders the
        // chart labels via the other renderer. Default mode is "letter".
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "harmony-mode-toggle";
        toggle.addEventListener("click", () => {
            this._displayMode = this._displayMode === "letter" ? "roman" : "letter";
            this._syncToggleLabel();
            this._renderChart();
        });
        this._toggleBtn = toggle;
        this._syncToggleLabel();
        head.appendChild(toggle);

        this.container.appendChild(head);

        const chart = document.createElement("div");
        chart.className = "harmony-chart";
        this._chartEl = chart;
        this.container.appendChild(chart);
    }

    /** Update the toggle button's label + title to the current mode. */
    _syncToggleLabel() {
        const btn = this._toggleBtn;
        if (btn === null) return;
        const isLetter = this._displayMode === "letter";
        btn.textContent = isLetter ? "Letter" : "Roman";
        btn.title = isLetter
            ? "Showing letter names (Cm7). Click for Roman numerals."
            : "Showing Roman numerals (i7). Click for letter names.";
        btn.setAttribute("aria-pressed", isLetter ? "false" : "true");
    }

    /**
     * Render the chord chart from the stored harmony. Lays the progression
     * out into bars (harmonyChartLayout) and paints them into a single CSS
     * grid of BARS_PER_ROW equal-width columns, so the barlines line up
     * straight down the page. No-op when the chart container isn't mounted.
     * Shows a hint when there's no harmony yet.
     */
    _renderChart() {
        const chart = this._chartEl;
        if (chart === null) return;
        chart.innerHTML = "";

        const head = this.container.querySelector(".harmony-chart-head");

        if (this._harmony === null) {
            if (head instanceof HTMLElement) head.classList.add("hidden");
            const hint = document.createElement("div");
            hint.className = "harmony-chart-empty";
            hint.textContent = "Choose a song to see its chord chart.";
            chart.appendChild(hint);
            return;
        }
        if (head instanceof HTMLElement) head.classList.remove("hidden");

        const h = this._harmony;
        const bars = layoutChart(
            /** @type {any} */ (h.progression),
            h.key,
            this._displayMode,
            h.timeSignature,
        );

        if (bars.length === 0) {
            const hint = document.createElement("div");
            hint.className = "harmony-chart-empty";
            hint.textContent = "This chart has no chord bars to display.";
            chart.appendChild(hint);
            return;
        }

        // Group the bars into ROWS that respect section/ending structure (a
        // section starts a new row at the left; alternative endings indent to
        // align under the first ending), then paint every row into the SAME
        // BARS_PER_ROW equal-width grid so the vertical barlines line up
        // straight down the page. Empty cells (short-row tails are simply left
        // off; ending indents are explicit blanks) render as blank columns.
        const rows = groupRows(bars, BARS_PER_ROW);
        const grid = document.createElement("div");
        grid.className = "harmony-chart-grid";
        grid.style.gridTemplateColumns = `repeat(${BARS_PER_ROW}, 1fr)`;
        for (const row of rows) {
            for (const cell of row) {
                grid.appendChild(
                    cell && cell.empty === true
                        ? this._renderEmptyCell()
                        : this._renderBar(/** @type {any} */ (cell)),
                );
            }
            // Pad a short row's TAIL with blank cells so the next row's first
            // bar still starts in column 1 (the grid flows left-to-right with
            // no per-row reset). These tail blanks carry no barline.
            for (let i = row.length; i < BARS_PER_ROW; i += 1) {
                grid.appendChild(this._renderEmptyCell());
            }
        }
        chart.appendChild(grid);
    }

    /**
     * Render a blank grid cell: a structural placeholder used to left-pad a
     * row (an alternative ending indented under the first ending) or to fill a
     * short row's tail. It occupies its column for alignment but draws nothing
     * — no chord, no barline.
     * @returns {HTMLDivElement}
     */
    _renderEmptyCell() {
        const el = document.createElement("div");
        el.className = "harmony-bar harmony-bar-empty";
        return el;
    }

    /**
     * Render a single bar as a grid cell, iReal-style. The bar draws a LEFT
     * BARLINE (a thin vertical rule, or a repeat-open / double variant) hard
     * against its left edge, then left-aligns its chord content right after
     * it — the chord hugs the barline, it is not centred. Structural marks
     * (section box, ending bracket, time-signature stack) sit at the top;
     * the right edge may carry a close-repeat, double, or final barline.
     *
     * Structurally addressable for overlays: carries data-bar-index and
     * data-beat-start so a now-playing highlight or chunk/phrase boundary can
     * target a bar without re-walking the cells.
     * @param {import("./harmonyChartLayout.js").ChartBar} bar
     * @returns {HTMLDivElement}
     */
    _renderBar(bar) {
        const el = document.createElement("div");
        el.className = "harmony-bar";
        el.dataset.barIndex = String(bar.index);
        el.dataset.beatStart = String(bar.beatStart);

        // --- Left barline (its variant depends on what opens here). ---
        const left = document.createElement("span");
        left.className = "harmony-barline harmony-barline-left";
        if (bar.repeatOpen) left.classList.add("repeat-open");
        el.appendChild(left);

        // --- Top-row marks (section box / ending bracket / time-sig). ---
        // Section label: small boxed letter sitting above the barline.
        if (bar.section !== undefined) {
            const sec = document.createElement("span");
            sec.className = "harmony-bar-section";
            sec.textContent = bar.section;
            el.appendChild(sec);
        }

        // Ending bracket: a horizontal rule over the top with "1." / "2.".
        if (bar.ending !== undefined) {
            const ending = document.createElement("span");
            ending.className = "harmony-bar-ending";
            ending.textContent = String(bar.ending) + ".";
            el.appendChild(ending);
            el.classList.add("has-ending");
        }

        // Time-signature stack: numerator over denominator at the bar start.
        if (bar.timeSignature !== undefined) {
            const ts = document.createElement("span");
            ts.className = "harmony-bar-ts";
            const num = document.createElement("span");
            num.className = "harmony-bar-ts-num";
            num.textContent = String(bar.timeSignature[0]);
            const den = document.createElement("span");
            den.className = "harmony-bar-ts-den";
            den.textContent = String(bar.timeSignature[1]);
            ts.appendChild(num);
            ts.appendChild(den);
            el.appendChild(ts);
        }

        // --- Chord content, left-aligned right after the barline. ---
        const slots = document.createElement("div");
        slots.className = "harmony-bar-slots";
        if (bar.slots.length > 1) slots.classList.add("split");
        for (const slot of bar.slots) {
            slots.appendChild(this._renderSlot(slot));
        }
        el.appendChild(slots);

        // --- Right barline variant (close-repeat / double / final). ---
        if (bar.repeatClose || bar.end || bar.doubleRight) {
            const right = document.createElement("span");
            right.className = "harmony-barline harmony-barline-right";
            if (bar.repeatClose) right.classList.add("repeat-close");
            else if (bar.end) right.classList.add("final");
            else right.classList.add("double");
            el.appendChild(right);
        }

        return el;
    }

    /**
     * Render one chord slot with iReal-style typography: a big root, a
     * raised accidental glyph, and a small subscripted quality/extension run
     * (plus an optional slash-bass). N.C., simile and blank slots take their
     * own simple presentation. Uses formatChordParts (pure) for the split.
     * @param {import("./harmonyChartLayout.js").ChartSlot} slot
     * @returns {HTMLSpanElement}
     */
    _renderSlot(slot) {
        const chord = document.createElement("span");
        chord.className = "harmony-chord";

        if (slot.empty) {
            chord.classList.add("blank");
            return chord;
        }
        if (slot.simile) {
            // CSS-DRAWN simile: iReal's %-style mark (a diagonal slash with a
            // dot upper-right and lower-left), not a Unicode music glyph the
            // system font lacks (which rendered as a missing-glyph box). A
            // two-bar repeat draws the same mark twice.
            chord.classList.add("simile");
            chord.title = slot.simile === "double" ? "Repeat last two bars"
                : slot.simile === "last" ? "Repeat last bar" : "Repeat bar";
            const marks = slot.simile === "double" ? 2 : 1;
            for (let i = 0; i < marks; i += 1) {
                const mark = document.createElement("span");
                mark.className = "harmony-simile-mark";
                const slash = document.createElement("span");
                slash.className = "harmony-simile-slash";
                mark.appendChild(slash);
                const dotTop = document.createElement("span");
                dotTop.className = "harmony-simile-dot top";
                mark.appendChild(dotTop);
                const dotBot = document.createElement("span");
                dotBot.className = "harmony-simile-dot bottom";
                mark.appendChild(dotBot);
                chord.appendChild(mark);
            }
            return chord;
        }
        if (slot.noChord) {
            chord.classList.add("nc");
            chord.textContent = slot.label || "N.C.";
            return chord;
        }

        const parts = formatChordParts(slot.label, this._displayMode);
        if (parts.plain || parts.root === "") {
            // Unparseable (or empty): show the raw label as plain text.
            chord.textContent = parts.root;
            return chord;
        }

        const root = document.createElement("span");
        root.className = "harmony-chord-root";
        root.textContent = parts.root;
        chord.appendChild(root);

        if (parts.accidental !== "") {
            const acc = document.createElement("span");
            acc.className = "harmony-chord-acc";
            acc.textContent = parts.accidental;
            chord.appendChild(acc);
        }
        if (parts.ext !== "") {
            const ext = document.createElement("span");
            ext.className = "harmony-chord-ext";
            ext.textContent = parts.ext;
            chord.appendChild(ext);
        }
        if (parts.bass !== undefined) {
            const slash = document.createElement("span");
            slash.className = "harmony-chord-slash";
            slash.textContent = "/";
            chord.appendChild(slash);
            const bass = document.createElement("span");
            bass.className = "harmony-chord-bass";
            bass.textContent = parts.bass;
            chord.appendChild(bass);
        }
        return chord;
    }

    /**
     * @param {KeyboardEvent} e
     */
    _onKeyDown(e) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!this._open) { this._open = true; this._recomputeResults(); }
            if (this._results.length > 0) {
                this._activeIndex = Math.min(this._activeIndex + 1, this._results.length - 1);
                if (this._activeIndex < 0) this._activeIndex = 0;
            }
            this._renderList();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (this._results.length > 0) {
                this._activeIndex = Math.max(this._activeIndex - 1, 0);
            }
            this._renderList();
        } else if (e.key === "Enter") {
            if (this._open && this._activeIndex >= 0 && this._activeIndex < this._results.length) {
                e.preventDefault();
                this._select(this._activeIndex);
            }
        } else if (e.key === "Escape") {
            if (this._open) {
                e.preventDefault();
                this._open = false;
                this._renderList();
            }
        }
    }

    /**
     * Select the result at index i: fetch the full Song and dispatch the
     * edit. Updates the "Now:" line and closes the list.
     * @param {number} i
     */
    _select(i) {
        const r = this._results[i];
        if (!r) return;
        const song = getSong(r.playlistId, r.index);
        if (song === null) return;

        this._chosen = {
            title: song.title,
            key: song.key,
            timeSignature: song.timeSignature,
        };
        this._open = false;
        // The field is a pure SEARCH box: clear it after a pick (the
        // chosen chart shows in the "Now:" line). Re-focusing then shows
        // the FULL list again so you can choose a different chart, rather
        // than the one already selected.
        if (this._input !== null) this._input.value = "";
        this._query = "";
        this._activeIndex = -1;
        this._renderNowLine();
        this._renderList();

        if (this._onChooseSong !== null) {
            this._onChooseSong(song);
        }
    }
}
