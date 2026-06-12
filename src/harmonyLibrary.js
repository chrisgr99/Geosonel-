/**
 * App-level harmony playlist library (localStorage-backed).
 *
 * Stores imported iReal Pro playlists so a composer can browse their
 * tunes and pick one as a scene's chosen progression. Modeled on
 * src/recentFiles.js (the localStorage list pattern + try/catch guards)
 * and src/preferences.js (synchronous get/set with graceful degradation).
 *
 * STORAGE MODEL — raw payloads, not expanded progressions.
 * Each library entry is { id, name, payload } where `payload` is the
 * decoded irealb:// playlist string. We deliberately do NOT persist the
 * expanded progressions: Jazz 1460 is ~0.7 MB of payload text (fits
 * localStorage comfortably), but its ~53k expanded cells would not. So:
 *   - the lightweight song list (titles / composers / keys, which live in
 *     the PLAINTEXT fields — no de-scramble needed) is parsed eagerly for
 *     listing;
 *   - a song's full progression (de-scramble + tokenize) is parsed LAZILY,
 *     only when that one song is fetched via getSong.
 *
 * TESTABILITY — pure logic vs. storage.
 * Node has no localStorage, and tests must not touch it. So every
 * localStorage access is wrapped in try/catch (private mode / quota
 * degrade to "empty library"), and ALL the real logic — lightweight
 * metadata extraction, dedupe, search/filter — lives in PURE functions
 * that take their data as arguments (exported below the "pure" banner).
 * The storage-touching API delegates to those pure functions, so the
 * logic is unit-testable without any localStorage at all.
 *
 * This module DOES import the iReal parser (src/irealParse.js,
 * src/harmonyModel.js), which are themselves pure (no esm.sh, no DOM), so
 * the whole module stays node-importable and node --checkable.
 */

// @ts-check

import { splitPlaylist } from "./irealParse.js";
import { buildSong } from "./harmonyModel.js";
import { parseKey } from "./irealChord.js";

const STORAGE_KEY = "gxw.harmony.library";

/**
 * @typedef {Object} LibraryEntry
 * @property {string} id        Stable unique id for this playlist.
 * @property {string} name      Display name (the playlist's trailing name).
 * @property {string} payload   The decoded irealb:// playlist string.
 */

/**
 * @typedef {import("./harmonyModel.js").Song} Song
 * @typedef {import("./irealChord.js").Key} Key
 */

/* ======================================================================
 * Pure logic (no localStorage). All exported so tests exercise them with
 * in-memory sample data — never touching storage.
 * ==================================================================== */

/**
 * Validate that a value is a plain (non-array, non-null) object.
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Sanitise an arbitrary parsed value into a clean LibraryEntry[]. Drops
 * any entry missing a string id / name / payload, so a hand-edited or
 * partially-corrupt localStorage blob degrades to its valid entries
 * rather than throwing. Pure: takes the parsed value, returns a fresh
 * array.
 * @param {unknown} parsed
 * @returns {LibraryEntry[]}
 */
export function sanitiseLibrary(parsed) {
    if (!Array.isArray(parsed)) return [];
    /** @type {LibraryEntry[]} */
    const out = [];
    for (const e of parsed) {
        if (!isPlainObject(e)) continue;
        if (typeof e.id !== "string" || e.id === "") continue;
        if (typeof e.name !== "string") continue;
        if (typeof e.payload !== "string") continue;
        out.push({ id: e.id, name: e.name, payload: e.payload });
    }
    return out;
}

/**
 * Add a playlist to a library array, returning a new array and the entry.
 * Dedupes by NAME (case-sensitive exact match): re-importing a playlist
 * whose name already exists REPLACES that entry's payload in place
 * (keeping its id), rather than adding a duplicate. Pure: does not read
 * or write storage; the id generator is injected so callers control id
 * shape and tests stay deterministic.
 *
 * @param {LibraryEntry[]} library  current entries.
 * @param {string} name             playlist display name.
 * @param {string} payload          decoded irealb:// payload.
 * @param {() => string} makeId     id generator (called only on a fresh add).
 * @returns {{ library: LibraryEntry[], id: string }}
 */
export function addPlaylistToLibrary(library, name, payload, makeId) {
    const existing = library.find((e) => e.name === name);
    if (existing) {
        const id = existing.id;
        const next = library.map((e) =>
            e.id === id ? { id, name, payload } : e
        );
        return { library: next, id };
    }
    const id = makeId();
    return { library: [...library, { id, name, payload }], id };
}

/**
 * Remove a playlist by id, returning a new array. Pure.
 * @param {LibraryEntry[]} library
 * @param {string} id
 * @returns {LibraryEntry[]}
 */
export function removePlaylistFromLibrary(library, id) {
    return library.filter((e) => e.id !== id);
}

/**
 * @typedef {Object} SongMeta
 * @property {number} index      position of the song in its playlist.
 * @property {string} title
 * @property {string} composer
 * @property {Key | null} key    parsed key, or null if the key field is junk.
 * @property {boolean} supported false if the song hits a v1 limitation
 *   detectable from the lightweight fields (currently: unparseable key).
 */

/**
 * Extract the LIGHTWEIGHT per-song metadata from a decoded payload:
 * titles, composers and keys, which all live in the PLAINTEXT fields, so
 * no de-scramble / tokenize is needed. This is the cheap listing path;
 * the full progression is parsed lazily elsewhere (see getSong).
 *
 * Pure: takes the payload string, returns a fresh array. `supported` is a
 * cheap pre-flight here (key parseable?); the authoritative `supported`
 * flag — which also depends on the body's time signature — is computed by
 * buildSong when the full song is fetched.
 *
 * @param {string} payload  decoded irealb:// payload.
 * @returns {SongMeta[]}
 */
export function extractSongMetadata(payload) {
    const { songs } = splitPlaylist(payload);
    return songs.map((raw, index) => {
        const key = parseKey(raw.key);
        return {
            index,
            title: raw.title,
            composer: raw.composer,
            key,
            supported: key !== null,
        };
    });
}

/**
 * The lightweight playlist-listing shape.
 * @typedef {Object} PlaylistSummary
 * @property {string} id
 * @property {string} name
 * @property {number} songCount
 */

/**
 * Summarise a library array for listing — id, name, and song count. The
 * count comes from a cheap "===" split of the payload rather than a full
 * parse. Pure.
 * @param {LibraryEntry[]} library
 * @returns {PlaylistSummary[]}
 */
export function summariseLibrary(library) {
    return library.map((e) => ({
        id: e.id,
        name: e.name,
        songCount: extractSongMetadata(e.payload).length,
    }));
}

/**
 * @typedef {Object} SongSearchHit
 * @property {string} playlistId
 * @property {string} playlistName
 * @property {number} index
 * @property {string} title
 */

/**
 * CONTAINS search over song titles, case-insensitive. `scope` is either a
 * playlist id (search just that playlist) or "all" (search every
 * playlist). Returns the matching songs as flat hits; no highlighting
 * (that's the UI's job). An empty / whitespace query returns no hits.
 *
 * Pure: operates over the supplied library array and re-derives the
 * lightweight metadata from each payload — no storage access.
 *
 * @param {LibraryEntry[]} library
 * @param {string} query
 * @param {{ scope?: string }} [opts]  scope: a playlistId or "all" (default).
 * @returns {SongSearchHit[]}
 */
export function searchSongsInLibrary(library, query, opts) {
    const scope = (opts && opts.scope) || "all";
    const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
    if (needle === "") return [];

    /** @type {SongSearchHit[]} */
    const hits = [];
    for (const entry of library) {
        if (scope !== "all" && entry.id !== scope) continue;
        const metas = extractSongMetadata(entry.payload);
        for (const m of metas) {
            if (m.title.toLowerCase().includes(needle)) {
                hits.push({
                    playlistId: entry.id,
                    playlistName: entry.name,
                    index: m.index,
                    title: m.title,
                });
            }
        }
    }
    return hits;
}

/**
 * Build the full parsed {@link Song} at `index` within a payload (the
 * lazy, expensive path: de-scramble + tokenize + Roman conversion). Pure:
 * takes the payload, returns the Song or null if the index is out of
 * range.
 * @param {string} payload  decoded irealb:// payload.
 * @param {number} index    song position within the playlist.
 * @returns {Song | null}
 */
export function songFromPayload(payload, index) {
    const { songs } = splitPlaylist(payload);
    if (!Number.isInteger(index) || index < 0 || index >= songs.length) {
        return null;
    }
    return buildSong(songs[index]);
}

/**
 * Read the playlist name out of a decoded payload (the trailing "==="
 * chunk). Used when importing so the stored entry's display name matches
 * the playlist's own name. Pure.
 * @param {string} payload
 * @returns {string}
 */
export function playlistNameFromPayload(payload) {
    return splitPlaylist(payload).name;
}

/* ======================================================================
 * Storage-guarded API (touches localStorage). Each function reads/writes
 * through the guarded load/save helpers and delegates all real work to
 * the pure functions above.
 * ==================================================================== */

/**
 * Load the library array from localStorage. Returns [] on any read/parse
 * failure (private mode, quota, corrupt blob) — the library just reads as
 * empty in that case, which is acceptable graceful degradation.
 * @returns {LibraryEntry[]}
 */
export function loadLibrary() {
    let raw;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch {
        return [];
    }
    if (raw === null) return [];
    try {
        return sanitiseLibrary(JSON.parse(raw));
    } catch {
        return [];
    }
}

/**
 * Persist a library array to localStorage. Best-effort; silently drops on
 * quota or private-mode failure.
 * @param {LibraryEntry[]} library
 */
export function saveLibrary(library) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
    } catch {
        // Quota or private mode; the library just won't persist.
    }
}

/**
 * Generate a unique-enough playlist id. Random + timestamp; collisions in
 * a hand-managed local library are vanishingly unlikely.
 * @returns {string}
 */
function makePlaylistId() {
    return "pl_" + Date.now().toString(36) + "_" +
        Math.random().toString(36).slice(2, 8);
}

/**
 * Import a decoded irealb:// payload into the library and persist. The
 * stored name is the payload's own trailing playlist name (falling back
 * to "Untitled Playlist" when empty). Dedupes by name (re-importing a
 * same-named playlist replaces its payload, keeping the id). Returns the
 * entry's id.
 * @param {string} payload  decoded irealb:// payload string.
 * @returns {string}
 */
export function importPayload(payload) {
    const rawName = playlistNameFromPayload(payload);
    const name = rawName && rawName.trim() !== "" ? rawName : "Untitled Playlist";
    const library = loadLibrary();
    const { library: next, id } = addPlaylistToLibrary(
        library, name, payload, makePlaylistId
    );
    saveLibrary(next);
    return id;
}

/**
 * List every stored playlist as { id, name, songCount }. Lightweight: no
 * full parse, just a song-count from the payload.
 * @returns {PlaylistSummary[]}
 */
export function listPlaylists() {
    return summariseLibrary(loadLibrary());
}

/**
 * List the lightweight per-song metadata for one playlist:
 * { index, title, composer, key, supported }. Returns [] if the id is
 * unknown. Does NOT expand progressions.
 * @param {string} playlistId
 * @returns {SongMeta[]}
 */
export function listSongs(playlistId) {
    const entry = loadLibrary().find((e) => e.id === playlistId);
    if (!entry) return [];
    return extractSongMetadata(entry.payload);
}

/**
 * Fetch one song's FULL parsed progression (the lazy, expensive path).
 * Returns null if the playlist id is unknown or the index is out of
 * range.
 * @param {string} playlistId
 * @param {number} index
 * @returns {Song | null}
 */
export function getSong(playlistId, index) {
    const entry = loadLibrary().find((e) => e.id === playlistId);
    if (!entry) return null;
    return songFromPayload(entry.payload, index);
}

/**
 * Search song titles (CONTAINS, case-insensitive) across the library.
 * scope is a playlistId or "all". Returns flat hits; no highlighting.
 * @param {string} query
 * @param {{ scope?: string }} [opts]
 * @returns {SongSearchHit[]}
 */
export function searchSongs(query, opts) {
    return searchSongsInLibrary(loadLibrary(), query, opts);
}

/**
 * Remove a playlist by id and persist.
 * @param {string} id
 */
export function removePlaylist(id) {
    saveLibrary(removePlaylistFromLibrary(loadLibrary(), id));
}
