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
import { TEST_PROGRESSIONS } from "./samples/testProgressions.js";
import { layoutChart, groupRows, formatChordParts, buildBarPlayback, chartSections, rangesForLabel } from "./harmonyChartLayout.js";
import { applyUnwind, sanitiseUnwind } from "./harmonyUnwind.js";
import { expandProgression } from "./harmonyPlayer.js";

const SCOPE_ALL = "all";
// Built-in "Default Charts" scope: the bundled test progressions
// (src/samples/testProgressions.js), always available with no import. A pseudo-
// playlist that lives only in the picker, never in the localStorage library.
const SCOPE_DEFAULT = "default-charts";

// The picker's chosen scope (playlist id, SCOPE_ALL, or SCOPE_DEFAULT) is a UI
// preference persisted across sessions in localStorage, so reopening the app
// returns to the playlist you last browsed rather than the first in the list.
const SCOPE_STORAGE_KEY = "gxw.harmony.scope";
/** @returns {string | null} the stored scope, or null if none/unavailable. */
function loadStoredScope() {
    try { return window.localStorage.getItem(SCOPE_STORAGE_KEY); } catch { return null; }
}
/** @param {string} scope */
function saveStoredScope(scope) {
    try { window.localStorage.setItem(SCOPE_STORAGE_KEY, scope); } catch { /* storage unavailable */ }
}

/** Bars per chart row before wrapping. */
const BARS_PER_ROW = 4;

/** Debounce (ms) before an arrow-browse step loads its chart. */
const BROWSE_DEBOUNCE_MS = 150;

// Pitch-class spelling for the "Now:" key label. Flat-side tonics spell
// with flats (Eb not D#); everything else with sharps. Mirrors the bias
// irealChord.js uses for tonic spelling, kept local so this panel stays
// a leaf with no chord-internals dependency.
const PC_TO_NAME_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PC_TO_NAME_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const FLAT_TONIC_PCS = new Set([5, 10, 3, 8, 1, 6]);

/**
 * Tonic roots for the Key submenu, listed top-to-bottom DESCENDING the
 * chromatic scale from C, black keys dual-labelled sharp/flat. Choosing one
 * transposes the chart's root (mode unchanged).
 * @type {Array<{ pc: number, label: string }>}
 */
const KEY_ROOTS = [
    { pc: 0, label: "C" },
    { pc: 11, label: "B" },
    { pc: 10, label: "A♯ / B♭" },
    { pc: 9, label: "A" },
    { pc: 8, label: "G♯ / A♭" },
    { pc: 7, label: "G" },
    { pc: 6, label: "F♯ / G♭" },
    { pc: 5, label: "F" },
    { pc: 4, label: "E" },
    { pc: 3, label: "D♯ / E♭" },
    { pc: 2, label: "D" },
    { pc: 1, label: "C♯ / D♭" },
];

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

        /**
         * Key-transpose callback wired by main.js. Receives the new tonic
         * pitch class (0..11); main.js rewrites scene.harmony.key (root only,
         * mode unchanged) and re-runs. Null until wired.
         * @type {((tonicPitchClass: number) => void) | null}
         */
        this._onChangeKey = null;

        /**
         * Unwind callback wired by main.js. Receives the chosen iteration
         * count (1..8) or null for "No"; main.js sets scene.harmony.unwind and
         * re-runs. Null until wired.
         * @type {((iterations: number | null) => void) | null}
         */
        this._onChangeUnwind = null;

        /**
         * Section-edit callback wired by main.js. Receives the selected object's
         * id and its new folded chart-bar range [start, end] (or null = whole
         * form); main.js writes that object's chartSection and re-runs. Null
         * until wired.
         * @type {((objectId: string, range: [number, number] | null) => void) | null}
         */
        this._onEditSection = null;

        // --- Picker state ---

        /** Selected playlist id, or SCOPE_ALL — restored from last session if stored. */
        this._scopePersisted = loadStoredScope();
        this._scope = this._scopePersisted || SCOPE_ALL;
        /** Current filter text. */
        this._query = "";
        /** Index of the keyboard-highlighted result, or -1. */
        this._activeIndex = -1;
        /** Whether the results dropdown is open. */
        this._open = false;
        /**
         * Pending debounce timer for arrow-browse live-load, or null.
         * @type {ReturnType<typeof setTimeout> | null}
         */
        this._browseTimer = null;
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
        /** Wrapper holding the count + results menu. @type {HTMLDivElement | null} */
        this._dropdown = null;
        /** "N of M" count element above the menu. @type {HTMLDivElement | null} */
        this._count = null;
        /** Chart title heading (shows the chosen song). @type {HTMLElement | null} */
        this._chartTitle = null;
        /** @type {HTMLDivElement | null} */
        this._chartEl = null;
        /**
         * Played-bar timeline for the now-playing cursor: expanded beat
         * ranges → displayed bar index. Rebuilt by _renderChart.
         * @type {import("./harmonyChartLayout.js").PlaybackBar[]}
         */
        this._playback = [];
        /** Total expanded beats of the playback timeline. */
        this._playbackTotal = 0;
        /** Whether playback loops at the end (drives the cursor's wrap). */
        this._loop = true;
        /** Displayed bar index currently highlighted, or -1. */
        this._nowBarIndex = -1;
        /** Most recent global beat from setPlayhead (re-lights after a re-render). */
        this._lastBeat = null;
        /** The hamburger menu container (button + popup). @type {HTMLElement | null} */
        this._menuEl = null;
        /** The hamburger popup panel. @type {HTMLElement | null} */
        this._menuPopup = null;
        /** The "Key" menu row (enabled only with a harmony). @type {HTMLElement | null} */
        this._keyMenuItem = null;
        /** The "Unwind" menu row (enabled only with a harmony). @type {HTMLElement | null} */
        this._unwindMenuItem = null;
        /** The "Unwind" row's current-value span. @type {HTMLElement | null} */
        this._unwindValueEl = null;
        /** Whether the hamburger popup is open. */
        this._menuOpen = false;

        // --- Section-picker state (per-object chart-bar range) ---

        /**
         * Base-cycle length in beats (folded-progression expanded total).
         * Rebuilt by _renderChart; retained for the playback-fold math.
         */
        this._baseCycle = 0;
        /** The object whose section the orange line edits, or null. @type {string | null} */
        this._sectionObjectId = null;
        /**
         * The selected object's assigned section LABEL (e.g. "A"), or null for the
         * whole form. The label can occur several times; the object owns them all.
         * Pushed in by main.js via setSectionObject. @type {string | null}
         */
        this._sectionLabel = null;
        /**
         * Practice-loop mirror: the folded bar range [start, end] the beat editor
         * is looping, shown as an olive wash on the chart, or null. Transient.
         * @type {[number, number] | null}
         */
        this._loopBars = null;
        /** Whether the section-assigning tool is armed. */
        this._phraseTool = false;
        /** The section-tool toggle button. @type {HTMLButtonElement | null} */
        this._phraseToolBtn = null;

        this._render();

        // Close the dropdown when the user clicks outside the combo.
        // Added once here (not per-render) and reads this._input live, so
        // it keeps working across refresh() re-renders.
        this._onDocMouseDown = (/** @type {MouseEvent} */ e) => {
            const target = /** @type {Node} */ (e.target);
            if (this._open) {
                const combo = this._input !== null
                    ? this._input.closest(".harmony-combo") : null;
                if (combo === null || !combo.contains(target)) {
                    this._open = false;
                    this._renderList();
                }
            }
            if (this._menuOpen) {
                if (this._menuEl === null || !this._menuEl.contains(target)) {
                    this._closeMenu();
                }
            }
        };
        document.addEventListener("mousedown", this._onDocMouseDown);

        // Delete/Backspace clears the section (object reverts to the whole form)
        // while the tool is armed. Ignored when typing in a field (the filter
        // input) so it can't eat a backspace meant for text.
        this._onDocKeyDown = (/** @type {KeyboardEvent} */ e) => {
            if (!this._phraseTool || this._sectionLabel === null) return;
            if (e.key !== "Delete" && e.key !== "Backspace") return;
            const ae = document.activeElement;
            if (ae !== null && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
            e.preventDefault();
            this._clearSection();
        };
        document.addEventListener("keydown", this._onDocKeyDown);
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
     * Wire the key-transpose callback (main.js owns the scene edit + re-run).
     * @param {(tonicPitchClass: number) => void} cb
     */
    onChangeKey(cb) {
        this._onChangeKey = cb;
    }

    /**
     * Wire the unwind callback (main.js owns the scene edit + re-run).
     * @param {(iterations: number | null) => void} cb
     */
    onChangeUnwind(cb) {
        this._onChangeUnwind = cb;
    }

    /**
     * Wire the section-edit callback (main.js owns the scene edit + re-run).
     * @param {(objectId: string, label: string | null) => void} cb
     */
    onEditSection(cb) {
        this._onEditSection = cb;
    }

    /**
     * Point the orange line at a beat-points object: it marks (and, armed, edits)
     * that object's assigned section LABEL — drawn over EVERY section bearing that
     * label. Called by main.js on every selection change. `id === null` (no single
     * chart-mode object selected) hides the line and disables the tool.
     * @param {string | null} id
     * @param {string | null} label  the object's stored chartSection label, or null
     */
    setSectionObject(id, label) {
        this._sectionObjectId = typeof id === "string" ? id : null;
        this._sectionLabel = (this._sectionObjectId !== null && typeof label === "string" && label !== "")
            ? label : null;
        if (this._sectionObjectId === null) this._phraseTool = false;
        this._syncPhraseToolBtn();
        this._renderSection();
    }

    /** All folded bar ranges of the currently-assigned label, or [] if none. */
    _sectionRanges() {
        if (this._harmony === null || this._sectionLabel === null) return [];
        const ts = Array.isArray(this._harmony.timeSignature) ? this._harmony.timeSignature : [4, 4];
        const bars = layoutChart(this._harmony.progression, this._harmony.key, "letter", ts);
        return rangesForLabel(bars, this._sectionLabel);
    }

    /**
     * Mirror the beat editor's practice loop on the chart: an olive wash over the
     * looped folded bars [start, end]. A null start clears it. Transient — main.js
     * calls this as the loop is armed/cleared.
     * @param {number | null} start
     * @param {number | null} end
     */
    setLoopBars(start, end) {
        this._loopBars = (typeof start === "number" && typeof end === "number" && end >= start)
            ? [start, end] : null;
        this._renderLoopBars();
    }

    /** Paint the olive practice-loop wash over the chart's looped bars. */
    _renderLoopBars() {
        const chart = this._chartEl;
        if (chart === null) return;
        for (const cell of chart.querySelectorAll(".harmony-bar.loop-range")) {
            cell.classList.remove("loop-range");
        }
        if (this._loopBars === null) return;
        const [a, b] = this._loopBars;
        for (let i = a; i <= b; i += 1) {
            const cell = chart.querySelector(`.harmony-bar[data-bar-index="${i}"]`);
            if (cell !== null) cell.classList.add("loop-range");
        }
    }

    /**
     * Reflect the scene's current harmony into the panel (the INBOUND
     * direction; onChooseSong is the outbound one). main.js calls this
     * after every scene load/re-run with `scene.harmony` (or null), so both
     * picking a song (which re-runs) and reopening a saved score that
     * already carries a stored progression populate the chart and its
     * title. Re-renders both from the stored harmony.
     * @param {import("./harmonyScene.js").SceneHarmony | null} harmony
     * @param {boolean} [loop=true]  whether playback loops (cursor wrap)
     */
    setHarmony(harmony, loop = true) {
        // A DIFFERENT chart invalidates the section assignment (main.js clears the
        // objects' chartSection in tandem), so drop the working label. A same-chart
        // re-run keeps it (it's per-object, pushed by setSectionObject).
        const prevTitle = this._harmony ? this._harmony.title : null;
        const newTitle = harmony ? harmony.title : null;
        if (newTitle !== prevTitle) this._sectionLabel = null;
        this._harmony = harmony || null;
        this._loop = loop !== false;
        // The section range is per-OBJECT (pushed in by setSectionObject), not a
        // property of the harmony, so a same-chart re-render doesn't reset it. A
        // drag mid-flight stays authoritative; otherwise the freshly-built chart
        // re-paints the current range below.
        // Keep the chart title in sync even when the chart isn't visible
        // (no library imported yet → picker is the placeholder hint, but a
        // stored harmony should still announce itself).
        if (this._harmony !== null) {
            this._chosen = {
                title: this._harmony.title,
                key: this._harmony.key,
                timeSignature: this._harmony.timeSignature,
            };
        }
        this._renderChartTitle();
        this._renderChart();
        this._syncMenuState();
        this._syncPhraseToolBtn();
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
        // No "Harmony" heading: the tab is already labelled "Harmony".
        // Drop stale menu handles; _buildMenu re-sets them when it runs.
        this._menuEl = null;
        this._menuPopup = null;
        this._keyMenuItem = null;
        this._unwindMenuItem = null;
        this._unwindValueEl = null;
        this._menuOpen = false;

        const playlists = listPlaylists();
        if (playlists.length === 0) {
            // No imported library yet — but the built-in Default Charts are always
            // available, so render the picker pinned to that scope (with a hint),
            // rather than bailing out to a placeholder.
            const hint = document.createElement("p");
            hint.className = "harmony-placeholder-hint";
            hint.textContent =
                "No imported charts yet — pick a Default Chart below, or File → Import iReal Pro Chart…";
            this.container.appendChild(hint);
            this._scope = SCOPE_DEFAULT;
        }

        // Keep the scope valid against the current library. SCOPE_ALL and the
        // built-in SCOPE_DEFAULT are always valid (not library playlists).
        if (this._scope !== SCOPE_ALL && this._scope !== SCOPE_DEFAULT &&
            !playlists.some((p) => p.id === this._scope)) {
            this._scope = playlists[0].id;
        }
        if (this._scopePersisted === null && this._scope === SCOPE_ALL
            && this._query === "" && this._results.length === 0
            && playlists.length > 0) {
            // Default to the first playlist on a fresh mount — but only when nothing
            // was stored, so a restored "All" (or any saved choice) is respected.
            this._scope = playlists[0].id;
        }

        // Picker grid: two columns (controls | song field), two rows.
        // Row 1: hamburger menu (top-left) + the "N of M" filter count,
        // the count left-aligned with the song field it filters. Row 2: the
        // playlist dropdown + the song combobox.
        const grid = document.createElement("div");
        grid.className = "harmony-picker-grid";

        // Hamburger menu (top-left): chord-display style + key transpose.
        grid.appendChild(this._buildMenu());

        // "N of M" filter count: above and left-aligned with the song field.
        const count = document.createElement("div");
        count.className = "harmony-song-count";
        this._count = count;
        grid.appendChild(count);

        // Playlist dropdown. "Default Charts" leads — the built-in progressions,
        // always available — then the imported playlists, then "All".
        const select = document.createElement("select");
        select.className = "harmony-playlist-select";
        const defaultOpt = document.createElement("option");
        defaultOpt.value = SCOPE_DEFAULT;
        defaultOpt.textContent = `Default Charts (${TEST_PROGRESSIONS.length})`;
        select.appendChild(defaultOpt);
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
            this._scopePersisted = select.value;   // remember this choice for next session
            saveStoredScope(select.value);
            this._recomputeResults();
            this._renderList();
        });
        this._playlistSelect = select;
        grid.appendChild(select);

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
            // A new search restarts browsing from the top of the new set.
            this._activeIndex = -1;
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

        // Dropdown wrapper: the scrollable results menu, below the field.
        const dropdown = document.createElement("div");
        dropdown.className = "harmony-dropdown hidden";
        this._dropdown = dropdown;

        const list = document.createElement("div");
        list.className = "harmony-song-list";
        this._list = list;
        dropdown.appendChild(list);

        combo.appendChild(dropdown);

        grid.appendChild(combo);
        this.container.appendChild(grid);

        // Chord-chart section (song-title heading + chart grid).
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

        if (this._scope === SCOPE_DEFAULT) {
            // Built-in Default Charts: filtered by the query, selected directly
            // (their SceneHarmony rides on the result; _select bypasses getSong).
            this._scopeTotal = TEST_PROGRESSIONS.length;
            this._results = TEST_PROGRESSIONS
                .filter((s) => needle === "" || s.title.toLowerCase().includes(needle))
                .map((s) => ({ builtin: true, song: s, title: s.title, playlistName: "Default Charts", supported: true }));
        } else if (this._scope === SCOPE_ALL) {
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

        // "N of M" count lives above the field, independent of the menu.
        if (this._count !== null) {
            this._count.textContent = `${this._results.length} of ${this._scopeTotal}`;
        }

        list.innerHTML = "";

        if (!this._open) {
            if (this._dropdown !== null) this._dropdown.classList.add("hidden");
            return;
        }
        if (this._dropdown !== null) this._dropdown.classList.remove("hidden");

        const needle = this._query.trim().toLowerCase();
        const showPlaylist = this._scope === SCOPE_ALL;

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

    /** Render the chart title = the chosen song's name (key + meter). */
    _renderChartTitle() {
        const el = this._chartTitle;
        if (el === null) return;
        if (this._chosen === null) {
            el.textContent = "";
            return;
        }
        el.textContent =
            `${this._chosen.title} — ${keyLabel(this._chosen.key)}, ${tsLabel(this._chosen.timeSignature)}`;
    }

    /**
     * Build the chord-chart section: a title heading (the chosen song's
     * name), plus an (empty) chart grid container that _renderChart fills.
     * Idempotent within a _render: rebuilds the subtree and re-captures the
     * DOM handles. The Letter/Roman toggle lives in the picker grid above.
     */
    _buildChartSection() {
        // Header row: the song title on the left, and on the right the phrase-
        // tool toggle (which arms the light-orange phrase drawing tool).
        const header = document.createElement("div");
        header.className = "harmony-chart-header";

        const title = document.createElement("h3");
        title.className = "harmony-chart-title";
        this._chartTitle = title;
        header.appendChild(title);

        const controls = document.createElement("div");
        controls.className = "harmony-chart-controls";

        const phraseBtn = document.createElement("button");
        phraseBtn.type = "button";
        phraseBtn.className = "harmony-phrase-tool-btn";
        phraseBtn.textContent = "◧ Section";
        phraseBtn.title = "Assign the selected object a chart section: click a section "
            + "label to snap, or drag across bars. Drag the line's ends to adjust; "
            + "press Delete to clear (whole form). Select a chart-following object first.";
        phraseBtn.setAttribute("aria-pressed", "false");
        phraseBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this._togglePhraseTool();
        });
        this._phraseToolBtn = phraseBtn;
        controls.appendChild(phraseBtn);
        header.appendChild(controls);

        this.container.appendChild(header);
        this._renderChartTitle();
        this._syncPhraseToolBtn();

        const chart = document.createElement("div");
        chart.className = "harmony-chart";
        chart.addEventListener("mousedown", (e) => this._onChartMouseDown(e));
        this._chartEl = chart;
        this.container.appendChild(chart);
    }

    /**
     * Build the hamburger menu: a ☰ button that opens a popup with two
     * entries — "Chords" (display style: Letter / Roman) and "Key" (transpose
     * the root, mode unchanged). Each entry reveals a flyout submenu on hover.
     * Returns the menu container for the caller to place in the picker grid.
     * @returns {HTMLElement}
     */
    _buildMenu() {
        const menu = document.createElement("div");
        menu.className = "harmony-menu";
        this._menuEl = menu;
        this._menuOpen = false;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "harmony-menu-btn";
        btn.textContent = "☰";
        btn.setAttribute("aria-label", "Chart options");
        btn.setAttribute("aria-haspopup", "true");
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            this._toggleMenu();
        });
        menu.appendChild(btn);

        const popup = document.createElement("div");
        popup.className = "harmony-menu-popup hidden";

        // "Chords" entry — display style (view only).
        const chordsItem = this._buildMenuItem("Chords");
        for (const mode of /** @type {const} */ (["letter", "roman"])) {
            const label = mode === "letter"
                ? "Letter names (Cm7)" : "Roman numerals (i7)";
            const opt = this._buildSubItem(label, this._displayMode === mode, () => {
                this._displayMode = mode;
                this._renderChart();
                this._syncMenuChecks();
                this._closeMenu();
            });
            opt.dataset.mode = mode;
            chordsItem.submenu.appendChild(opt);
        }
        popup.appendChild(chordsItem.item);

        // "Key" entry — transpose the root (disabled with no harmony loaded).
        const keyItem = this._buildMenuItem("Key");
        this._keyMenuItem = keyItem.item;
        const currentPc = this._harmony !== null
            ? ((this._harmony.key.tonicPitchClass % 12) + 12) % 12 : -1;
        for (const root of KEY_ROOTS) {
            const opt = this._buildSubItem(root.label, root.pc === currentPc, () => {
                this._chooseKeyRoot(root.pc);
                this._closeMenu();
            });
            opt.dataset.pc = String(root.pc);
            keyItem.submenu.appendChild(opt);
        }
        popup.appendChild(keyItem.item);

        // "Unwind" entry — fold (No) or write the song out flat in N repeated
        // sections. The top-level row shows the current choice. Disabled with
        // no harmony loaded.
        const unwindItem = this._buildMenuItem("Unwind");
        this._unwindMenuItem = unwindItem.item;
        this._unwindValueEl = unwindItem.value;
        const currentUnwind = this._harmony !== null
            ? sanitiseUnwind(this._harmony.unwind) : null;
        /** @type {Array<{ label: string, value: number | null }>} */
        const unwindChoices = [{ label: "No", value: null }];
        for (let i = 1; i <= 8; i += 1) unwindChoices.push({ label: String(i), value: i });
        for (const c of unwindChoices) {
            const opt = this._buildSubItem(c.label, c.value === currentUnwind, () => {
                this._chooseUnwind(c.value);
                this._closeMenu();
            });
            opt.dataset.unwind = c.value === null ? "no" : String(c.value);
            unwindItem.submenu.appendChild(opt);
        }
        popup.appendChild(unwindItem.item);

        menu.appendChild(popup);
        this._menuPopup = popup;
        this._syncMenuState();
        return menu;
    }

    /**
     * Reflect the loaded harmony into the menu: enable/disable the Key entry
     * (nothing to transpose without a harmony) and re-tick the current key +
     * display mode. Safe to call before the menu exists.
     */
    _syncMenuState() {
        const noHarmony = this._harmony === null;
        if (this._keyMenuItem !== null) {
            this._keyMenuItem.classList.toggle("disabled", noHarmony);
            if (noHarmony) this._keyMenuItem.setAttribute("aria-disabled", "true");
            else this._keyMenuItem.removeAttribute("aria-disabled");
        }
        if (this._unwindMenuItem !== null) {
            this._unwindMenuItem.classList.toggle("disabled", noHarmony);
            if (noHarmony) this._unwindMenuItem.setAttribute("aria-disabled", "true");
            else this._unwindMenuItem.removeAttribute("aria-disabled");
        }
        if (this._unwindValueEl !== null) {
            const cur = noHarmony ? null : sanitiseUnwind(this._harmony.unwind);
            this._unwindValueEl.textContent = cur === null ? "No" : String(cur);
        }
        this._syncMenuChecks();
    }

    /**
     * Build a top-level menu row carrying a flyout submenu. The `value` span
     * (right-aligned, before the arrow) shows the row's current choice; it
     * stays empty for rows that don't display one.
     * @param {string} label
     * @returns {{ item: HTMLElement, submenu: HTMLElement, value: HTMLElement }}
     */
    _buildMenuItem(label) {
        const item = document.createElement("div");
        item.className = "harmony-menu-item";

        const text = document.createElement("span");
        text.className = "harmony-menu-label";
        text.textContent = label;
        item.appendChild(text);

        const value = document.createElement("span");
        value.className = "harmony-menu-value";
        item.appendChild(value);

        const arrow = document.createElement("span");
        arrow.className = "harmony-menu-arrow";
        arrow.textContent = "▸";
        item.appendChild(arrow);

        const submenu = document.createElement("div");
        submenu.className = "harmony-submenu";
        item.appendChild(submenu);

        return { item, submenu, value };
    }

    /**
     * Build a checkable submenu choice.
     * @param {string} label
     * @param {boolean} checked
     * @param {() => void} onChoose
     * @returns {HTMLButtonElement}
     */
    _buildSubItem(label, checked, onChoose) {
        const opt = document.createElement("button");
        opt.type = "button";
        opt.className = "harmony-subitem" + (checked ? " checked" : "");

        const tick = document.createElement("span");
        tick.className = "harmony-subitem-tick";
        tick.textContent = checked ? "✓" : "";
        opt.appendChild(tick);

        const text = document.createElement("span");
        text.textContent = label;
        opt.appendChild(text);

        opt.addEventListener("click", (e) => {
            e.stopPropagation();
            onChoose();
        });
        return opt;
    }

    /** Re-tick the submenu choices to match the current state. */
    _syncMenuChecks() {
        if (this._menuPopup == null) return;
        const mark = (/** @type {Element} */ el, /** @type {boolean} */ on) => {
            el.classList.toggle("checked", on);
            const tick = el.querySelector(".harmony-subitem-tick");
            if (tick !== null) tick.textContent = on ? "✓" : "";
        };
        for (const el of this._menuPopup.querySelectorAll(".harmony-subitem[data-mode]")) {
            mark(el, /** @type {HTMLElement} */ (el).dataset.mode === this._displayMode);
        }
        const currentPc = this._harmony !== null
            ? ((this._harmony.key.tonicPitchClass % 12) + 12) % 12 : -1;
        for (const el of this._menuPopup.querySelectorAll(".harmony-subitem[data-pc]")) {
            mark(el, Number(/** @type {HTMLElement} */ (el).dataset.pc) === currentPc);
        }
        const curUnwind = this._harmony !== null
            ? sanitiseUnwind(this._harmony.unwind) : null;
        for (const el of this._menuPopup.querySelectorAll(".harmony-subitem[data-unwind]")) {
            const raw = /** @type {HTMLElement} */ (el).dataset.unwind;
            const v = raw === "no" ? null : Number(raw);
            mark(el, v === curUnwind);
        }
    }

    /**
     * Apply an unwind choice (null = "No"/folded, or 1..8 iterations). No-op
     * without a loaded harmony, a wired callback, or when unchanged. main.js
     * sets scene.harmony.unwind, re-runs, and rewinds.
     * @param {number | null} value
     */
    _chooseUnwind(value) {
        if (this._harmony === null) return;
        const current = sanitiseUnwind(this._harmony.unwind);
        if (value === current) return;
        if (this._onChangeUnwind !== null) this._onChangeUnwind(value);
    }

    /** Open/close the hamburger popup. */
    _toggleMenu() {
        if (this._menuOpen) this._closeMenu();
        else this._openMenu();
    }

    _openMenu() {
        if (this._menuPopup == null) return;
        this._menuOpen = true;
        this._menuPopup.classList.remove("hidden");
    }

    _closeMenu() {
        if (this._menuPopup == null) return;
        this._menuOpen = false;
        this._menuPopup.classList.add("hidden");
    }

    /**
     * Transpose the chart to a new tonic root (mode unchanged). No-op without
     * a loaded harmony or a wired callback. main.js rewrites scene.harmony.key
     * and re-runs, then pushes the result back via setHarmony.
     * @param {number} pc  tonic pitch class 0..11
     */
    _chooseKeyRoot(pc) {
        if (this._harmony === null) return;
        const current = ((this._harmony.key.tonicPitchClass % 12) + 12) % 12;
        if (pc === current) return;
        if (this._onChangeKey !== null) this._onChangeKey(pc);
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
        // The DOM is rebuilt, so the old highlight handle is gone; the next
        // setPlayhead re-lights from scratch.
        this._playback = [];
        this._playbackTotal = 0;
        this._nowBarIndex = -1;
        this._baseCycle = 0;

        if (this._harmony === null) {
            const hint = document.createElement("div");
            hint.className = "harmony-chart-empty";
            hint.textContent = "Choose a song to see its chord chart.";
            chart.appendChild(hint);
            return;
        }

        // Base-cycle length (folded progression, repeats honoured but NOT
        // unwound) — the beat space phrases are authored in.
        this._baseCycle = expandProgression(
            /** @type {any} */ (this._harmony.progression),
            /** @type {any} */ (this._harmony.timeSignature || [4, 4]),
        ).totalBeats;

        // Derive the unwound progression when Unwind is set (folded otherwise),
        // so the chart matches what the player sounds.
        const h = applyUnwind(this._harmony);
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

        // Build the now-playing timeline (expanded beats → displayed bar) so
        // setPlayhead can light the sounding bar across repeats.
        const playback = buildBarPlayback(bars);
        this._playback = playback.timeline;
        this._playbackTotal = playback.totalBeats;

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

        // Paint the section overlay (the orange line) and reflect the tool's
        // armed state onto the chart.
        this._renderSection();
        this._renderLoopBars();          // the practice-loop olive mirror
        chart.classList.toggle("phrase-tool-active", this._phraseTool);

        // Re-light the cursor onto the freshly built DOM if a beat is current.
        if (this._lastBeat !== null) this.setPlayhead(this._lastBeat);
    }

    /**
     * Paint the section overlay: the orange line over EVERY section bearing the
     * selected object's assigned label (a label can recur — the object owns them
     * all). Each covered bar gets a full-width rule with downturned caps on each
     * range's true ends, so all occurrences glow at once. No label → no line (the
     * object plays the whole form).
     */
    _renderSection() {
        const chart = this._chartEl;
        if (chart === null) return;
        for (const old of chart.querySelectorAll(".harmony-phrase-line")) old.remove();
        for (const [a, b] of this._sectionRanges()) {
            for (let i = a; i <= b; i += 1) {
                const cell = chart.querySelector(`.harmony-bar[data-bar-index="${i}"]`);
                if (cell === null) continue;
                const line = document.createElement("div");
                line.className = "harmony-phrase-line";
                if (i === a) line.classList.add("start-cap");
                if (i === b) line.classList.add("end-cap");
                line.style.left = "0";
                line.style.width = "100%";
                cell.appendChild(line);
            }
        }
    }

    /** Toggle the section-assigning tool on/off. */
    _togglePhraseTool() {
        this._phraseTool = !this._phraseTool;
        this._syncPhraseToolBtn();
        if (this._chartEl !== null) {
            this._chartEl.classList.toggle("phrase-tool-active", this._phraseTool);
        }
        this._renderSection();
    }

    /** Reflect the tool's armed/disabled state onto its toggle button. */
    _syncPhraseToolBtn() {
        const btn = this._phraseToolBtn;
        if (btn === null) return;
        btn.classList.toggle("active", this._phraseTool);
        btn.setAttribute("aria-pressed", this._phraseTool ? "true" : "false");
        // Enabled only when a chart is loaded AND a single chart-mode object is
        // selected (the object whose section the line edits).
        btn.disabled = this._harmony === null || this._sectionObjectId === null;
    }

    /**
     * Chart mousedown while the tool is armed: assign (or clear) the LABEL of the
     * clicked section to the selected object. Assignment is always a whole section
     * — there is no free-range drag.
     * @param {MouseEvent} e
     */
    _onChartMouseDown(e) {
        if (!this._phraseTool || this._sectionObjectId === null || this._harmony === null) return;
        const target = /** @type {Element} */ (e.target);
        const cell = target.closest ? target.closest(".harmony-bar[data-bar-index]") : null;
        if (cell === null) return;
        const bar = Number(/** @type {HTMLElement} */ (cell).dataset.barIndex);
        if (!Number.isFinite(bar)) return;
        this._assignSectionAt(bar);
    }

    /**
     * Assign the label of the section containing folded bar `bar` to the object.
     * Clicking the already-assigned label clears it (back to the whole form).
     * @param {number} bar
     */
    _assignSectionAt(bar) {
        const ts = Array.isArray(this._harmony.timeSignature) ? this._harmony.timeSignature : [4, 4];
        const bars = layoutChart(this._harmony.progression, this._harmony.key, "letter", ts);
        let label = null;
        for (const s of chartSections(bars)) {
            if (s.range[0] <= bar && bar <= s.range[1]) label = s.label;
        }
        if (label === null) return;                              // clicked outside any section
        this._sectionLabel = (label === this._sectionLabel) ? null : label;   // toggle
        this._commitSection();
    }

    /** Clear the assignment (object reverts to the whole form) and commit. */
    _clearSection() {
        this._sectionLabel = null;
        this._commitSection();
    }

    /** Repaint the line and push the new label out to main.js. */
    _commitSection() {
        this._renderSection();
        if (this._onEditSection !== null && this._sectionObjectId !== null) {
            this._onEditSection(this._sectionObjectId, this._sectionLabel);
        }
    }

    /**
     * Move the now-playing cursor to the bar sounding at `beat` (global beats).
     * Called every playing frame by the canvas via main.js; pass null to clear
     * (playback stopped). Wraps modulo the timeline when looping. Only touches
     * the DOM when the highlighted bar changes, so it's cheap per frame.
     * @param {number | null} beat
     */
    setPlayhead(beat) {
        this._lastBeat = beat;
        if (beat === null || this._playbackTotal <= 0 || this._chartEl === null) {
            this._setNowBar(-1);
            return;
        }
        let b = beat;
        if (this._loop) {
            b = ((b % this._playbackTotal) + this._playbackTotal) % this._playbackTotal;
        }
        if (b < 0 || b >= this._playbackTotal) {
            this._setNowBar(-1); // before start or past the end (loop off)
            return;
        }
        this._setNowBar(this._barIndexAtBeat(b));
    }

    /**
     * Binary-search the playback timeline for the displayed bar index sounding
     * at expanded beat `b` (0 <= b < totalBeats), or -1 if none.
     * @param {number} b
     * @returns {number}
     */
    _barIndexAtBeat(b) {
        const tl = this._playback;
        let lo = 0;
        let hi = tl.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const seg = tl[mid];
            if (b < seg.startBeat) hi = mid - 1;
            else if (b >= seg.endBeat) lo = mid + 1;
            else return seg.index;
        }
        return -1;
    }

    /**
     * Toggle the `now-playing` class so exactly the bar at displayed `index`
     * is highlighted (or none, for -1). No-op when already on that bar.
     * @param {number} index  displayed ChartBar.index, or -1 to clear
     */
    _setNowBar(index) {
        if (index === this._nowBarIndex) return;
        const chart = this._chartEl;
        if (chart !== null) {
            if (this._nowBarIndex >= 0) {
                const prev = chart.querySelector(
                    `.harmony-bar[data-bar-index="${this._nowBarIndex}"]`);
                if (prev !== null) prev.classList.remove("now-playing");
            }
            if (index >= 0) {
                const next = chart.querySelector(
                    `.harmony-bar[data-bar-index="${index}"]`);
                if (next !== null) next.classList.add("now-playing");
            }
        }
        this._nowBarIndex = index;
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
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            // Browse the candidate set with the list CLOSED, so the chord
            // chart stays visible. Each step live-loads its chart (debounced).
            if (this._results.length === 0) this._recomputeResults();
            if (this._results.length === 0) return;
            if (this._open) { this._open = false; this._renderList(); }
            if (this._activeIndex < 0) {
                this._activeIndex = e.key === "ArrowDown" ? 0 : this._results.length - 1;
            } else if (e.key === "ArrowDown") {
                this._activeIndex = Math.min(this._activeIndex + 1, this._results.length - 1);
            } else {
                this._activeIndex = Math.max(this._activeIndex - 1, 0);
            }
            this._scheduleBrowseApply();
        } else if (e.key === "Enter") {
            e.preventDefault();
            // Flush any pending browse load so the highlighted chart is
            // applied immediately.
            if (this._browseTimer !== null) {
                clearTimeout(this._browseTimer);
                this._browseTimer = null;
                if (this._activeIndex >= 0 && this._activeIndex < this._results.length) {
                    this._browseApply(this._activeIndex);
                }
            }
            // Close the list but leave the filter text and the text cursor
            // exactly where they are.
            if (this._open) {
                this._open = false;
                this._renderList();
            }
        } else if (e.key === "Escape") {
            if (this._query !== "") {
                // Clear the filter to reveal the whole list.
                e.preventDefault();
                this._query = "";
                if (this._input !== null) this._input.value = "";
                this._activeIndex = -1;
                this._open = true;
                this._recomputeResults();
                this._renderList();
            } else if (this._open) {
                // Already unfiltered — Escape dismisses the list.
                e.preventDefault();
                this._open = false;
                this._renderList();
            }
        }
    }

    /** Debounce a live-load of the arrow-browse-highlighted chart. */
    _scheduleBrowseApply() {
        if (this._browseTimer !== null) clearTimeout(this._browseTimer);
        this._browseTimer = setTimeout(() => {
            this._browseTimer = null;
            this._browseApply(this._activeIndex);
        }, BROWSE_DEBOUNCE_MS);
    }

    /**
     * Load the chart at index i WITHOUT closing or clearing the search field —
     * the arrow-browse path. Updates the "Now:" line and dispatches the edit
     * (which re-runs the scene; main.js pushes the harmony back and the chart
     * redraws). Keeps the field text and browse index so stepping continues.
     * @param {number} i
     */
    _browseApply(i) {
        const r = this._results[i];
        if (!r) return;
        const song = getSong(r.playlistId, r.index);
        if (song === null) return;

        this._chosen = {
            title: song.title,
            key: song.key,
            timeSignature: song.timeSignature,
        };
        this._renderChartTitle();

        if (this._onChooseSong !== null) {
            this._onChooseSong(song);
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
        // Built-in Default Charts carry their SceneHarmony inline; library songs
        // are fetched by playlist + index.
        const song = r.builtin ? r.song : getSong(r.playlistId, r.index);
        if (song === null) return;

        this._chosen = {
            title: song.title,
            key: song.key,
            timeSignature: song.timeSignature,
        };
        this._open = false;
        // Keep the typed filter text in the field after a pick, so it shows
        // the context you were browsing. Re-focusing reopens the SAME filtered
        // list; Escape clears the filter to reveal everything; Backspace
        // widens it incrementally.
        this._renderChartTitle();
        this._renderList();

        if (this._onChooseSong !== null) {
            this._onChooseSong(song);
        }
    }
}
