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

const SCOPE_ALL = "all";

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

        // --- DOM handles (filled by _render) ---
        /** @type {HTMLSelectElement | null} */
        this._playlistSelect = null;
        /** @type {HTMLInputElement | null} */
        this._input = null;
        /** @type {HTMLDivElement | null} */
        this._list = null;
        /** @type {HTMLDivElement | null} */
        this._nowLine = null;

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
