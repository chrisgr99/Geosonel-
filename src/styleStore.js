/**
 * App-wide style library (vStyles now; rStyles later).
 *
 * Styles are defined once and used across every score — the same pattern as the
 * image gallery, but because a style is tiny JSON (not an image blob) it needs
 * no dedicated store: the whole library persists as a SINGLE settings entry via
 * storage.js's cross-backend getSetting/setSetting (Electron settings.json or web
 * IndexedDB, transparently). No new object store, no DB-version bump, no preload
 * bridge.
 *
 * The library is TYPE-AWARE — each record carries a `type` ("voice" | "rhythm")
 * so the one store holds both libraries; only voice styles are populated until
 * the rStyle work lands.
 *
 * A synchronous in-memory CACHE is the source of truth for reads, because the
 * firing engine resolves a style per note and can't await IndexedDB. loadStyles()
 * hydrates the cache once at startup; every mutation updates the cache
 * synchronously and persists in the background (best-effort, never throws into
 * the caller). Voice records are also kept pre-materialised (VStyle instances)
 * keyed by name, so resolveStyleByName is a Map lookup, not a per-note re-parse.
 *
 * Pure record helpers (upsertRecord / removeRecord) are exported and unit-tested;
 * the stateful API wraps them over the module cache.
 */

// @ts-check

import { materializeVStyle } from "./vStyle.js";
import { getSetting, setSetting } from "./storage.js";

/** The single settings key the whole library serialises under. */
const STYLES_KEY = "styleLibrary";

/**
 * @typedef {{ type: "voice" | "rhythm", name: string, def: any }} StyleRecord
 *   `def` is the serialized style (serializeVStyle output for a voice).
 */

/** The authoritative in-memory library. @type {StyleRecord[]} */
let records = [];

/** Pre-materialised voice styles by name (sync engine reads). @type {Map<string, import("./vStyle.js").VStyle>} */
let voiceCache = new Map();

/** A record is well-formed enough to keep. @param {any} r */
function isValidRecord(r) {
    return r !== null && typeof r === "object"
        && typeof r.name === "string" && r.name !== ""
        && (r.type === "voice" || r.type === "rhythm")
        && r.def !== null && typeof r.def === "object";
}

/** Rebuild the materialised-voice map from the current records. */
function rebuildVoiceCache() {
    voiceCache = new Map();
    for (const r of records) {
        if (r.type === "voice") voiceCache.set(r.name, materializeVStyle(r.def));
    }
}

// --- Pure record helpers (testable, no module state) ---------------------

/**
 * Return a new list with `rec` upserted (replacing any same type+name).
 * @param {StyleRecord[]} list @param {StyleRecord} rec @returns {StyleRecord[]}
 */
export function upsertRecord(list, rec) {
    const i = list.findIndex((r) => r.type === rec.type && r.name === rec.name);
    const next = list.slice();
    if (i >= 0) next[i] = rec; else next.push(rec);
    return next;
}

/**
 * Return a new list without the record of this type+name.
 * @param {StyleRecord[]} list @param {string} type @param {string} name
 * @returns {StyleRecord[]}
 */
export function removeRecord(list, type, name) {
    return list.filter((r) => !(r.type === type && r.name === name));
}

// --- Stateful API --------------------------------------------------------

/**
 * All records, or just those of `type`. A shallow copy so callers can't mutate
 * the cache. @param {"voice" | "rhythm"} [type] @returns {StyleRecord[]}
 */
export function listStyles(type) {
    return type ? records.filter((r) => r.type === type) : records.slice();
}

/** @param {string} type @param {string} name @returns {StyleRecord | null} */
export function getStyleRecord(type, name) {
    return records.find((r) => r.type === type && r.name === name) || null;
}

/**
 * The materialised VStyle for a user voice style of this name, or null. Sync —
 * this is the engine's per-note path (resolveStyleByName).
 * @param {string} name @returns {import("./vStyle.js").VStyle | null}
 */
export function getMaterializedVoice(name) {
    return voiceCache.get(name) || null;
}

/**
 * Upsert a record into the library and persist (best-effort). The cache updates
 * synchronously, so a following read sees the change immediately.
 * @param {StyleRecord} rec @returns {Promise<void>}
 */
export function saveStyle(rec) {
    records = upsertRecord(records, rec);
    rebuildVoiceCache();
    return persist();
}

/**
 * Remove a record and persist (best-effort).
 * @param {"voice" | "rhythm"} type @param {string} name @returns {Promise<void>}
 */
export function removeStyle(type, name) {
    records = removeRecord(records, type, name);
    rebuildVoiceCache();
    return persist();
}

/**
 * Hydrate the cache from persisted settings. Called once at startup before the
 * first run. Tolerant: a missing / malformed entry yields an empty library
 * rather than throwing.
 * @returns {Promise<void>}
 */
export async function loadStyles() {
    try {
        const raw = await getSetting(STYLES_KEY);
        records = Array.isArray(raw) ? raw.filter(isValidRecord) : [];
    } catch (_err) {
        records = [];
    }
    rebuildVoiceCache();
}

/** Persist the whole library under one settings key. Best-effort: a backend
 *  failure is logged, never thrown into the mutation caller. */
async function persist() {
    try {
        await setSetting(STYLES_KEY, records);
    } catch (err) {
        console.warn("[styleStore] persist failed:", err && /** @type {any} */ (err).message);
    }
}

/** Test seam: clear the in-memory library (no persistence). */
export function _resetForTest() {
    records = [];
    voiceCache = new Map();
}
