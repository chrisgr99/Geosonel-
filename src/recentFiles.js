/**
 * Recent Files list.
 *
 * Keeps a localStorage-backed list of the most recently
 * opened scores, used by the File menu's Open Recent
 * submenu. Entries are objects of the shape
 * {path: string, lastOpenedAt: number}; the list is sorted
 * most-recent first and capped at MAX_ENTRIES total. The
 * display name shown in the menu is derived from the path
 * via scoreNameFromPath at render time, so renames of the
 * underlying folder are reflected automatically when the
 * folder still lives at the recorded path.
 *
 * The list is updated on every score load (resolveInitial
 * Bundle, switchToBundle, the score actions). Recording the
 * same score again moves it to the front and refreshes
 * its timestamp. Renaming a score updates the existing
 * entry's path in place; deleting a score removes its
 * entry. The Clear Menu item in the File menu's submenu
 * empties the list.
 *
 * Older installs had name-based entries ({name, lastOpenedAt})
 * which migrateRecentScoresToPaths upgrades to the path shape
 * on first launch. The migration takes a resolver function
 * rather than importing storage.js directly so this module
 * stays dependency-free.
 *
 * All operations swallow localStorage failures (private
 * mode, quota errors) silently — the menu just won't
 * remember anything in that case, which is acceptable
 * graceful degradation.
 */

// @ts-check

const STORAGE_KEY = "gxw.recentScores";
const MAX_ENTRIES = 10;

/**
 * @typedef {Object} RecentScoreEntry
 * @property {string} path           Storage path identifying the score.
 * @property {number} lastOpenedAt   Wall-clock ms timestamp of the last
 *   time this score was loaded.
 */

/**
 * Read the current list from localStorage. Returns an empty
 * array on any read or parse failure. The returned array is
 * sorted most-recent first; callers can rely on that
 * ordering without re-sorting. Entries that don't match the
 * current schema (e.g. legacy name-only entries from before
 * the migration ran) are skipped.
 * @returns {RecentScoreEntry[]}
 */
export function getRecentScores() {
    /** @type {RecentScoreEntry[]} */
    let list = [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        for (const entry of parsed) {
            if (entry !== null &&
                typeof entry === "object" &&
                typeof entry.path === "string" &&
                typeof entry.lastOpenedAt === "number") {
                list.push({
                    path: entry.path,
                    lastOpenedAt: entry.lastOpenedAt,
                });
            }
        }
    } catch (e) {
        return [];
    }
    list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    return list;
}

/**
 * Persist a list back to localStorage. Best-effort; silently
 * drops on quota or private-mode failures.
 * @param {RecentScoreEntry[]} list
 */
function writeList(list) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
        // Quota or private mode; menu just won't remember.
    }
}

/**
 * Record that a score has just been opened. Moves the
 * entry to the front of the list and refreshes its
 * timestamp; trims to MAX_ENTRIES.
 * @param {string} path
 */
export function recordScoreOpen(path) {
    if (typeof path !== "string" || path === "") return;
    const list = getRecentScores().filter((e) => e.path !== path);
    list.unshift({ path, lastOpenedAt: Date.now() });
    if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
    writeList(list);
}

/**
 * Remove a score's entry from the list. Used when the
 * user deletes a score so the menu doesn't list a stale
 * pointer.
 * @param {string} path
 */
export function forgetScore(path) {
    if (typeof path !== "string" || path === "") return;
    const list = getRecentScores().filter((e) => e.path !== path);
    writeList(list);
}

/**
 * Update a score's path entry in place without disturbing
 * its position in the list. The lastOpenedAt timestamp is
 * preserved so a rename doesn't shuffle the score to the
 * front. If no entry with the old path exists this is a
 * no-op.
 * @param {string} oldPath
 * @param {string} newPath
 */
export function renameInRecentScores(oldPath, newPath) {
    if (typeof oldPath !== "string" || oldPath === "") return;
    if (typeof newPath !== "string" || newPath === "") return;
    const list = getRecentScores();
    let changed = false;
    for (const entry of list) {
        if (entry.path === oldPath) {
            entry.path = newPath;
            changed = true;
        }
    }
    if (changed) writeList(list);
}

/**
 * Empty the list. Triggered by the Clear Menu entry at
 * the bottom of the Open Recent submenu.
 */
export function clearRecentScores() {
    writeList([]);
}

/**
 * One-time migration from name-based entries to path-based
 * entries. Reads the raw localStorage contents, and for any
 * legacy {name, lastOpenedAt} entry resolves a path via the
 * supplied resolver function. Entries that already carry a
 * path are passed through unchanged. Idempotent — once the
 * list is fully path-based, subsequent calls touch nothing.
 *
 * The resolver is passed in (rather than imported from
 * storage.js) so this module stays dependency-free; main.js
 * wires composeScorePathFromName from storage.js as the
 * resolver at startup.
 *
 * @param {(name: string) => Promise<string>} resolver
 * @returns {Promise<void>}
 */
export async function migrateRecentScoresToPaths(resolver) {
    let raw;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch {
        return;
    }
    if (raw === null) return;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return;
    }
    if (!Array.isArray(parsed)) return;

    let mutated = false;
    /** @type {RecentScoreEntry[]} */
    const migrated = [];
    for (const entry of parsed) {
        if (entry === null || typeof entry !== "object") continue;
        if (typeof entry.lastOpenedAt !== "number") continue;
        if (typeof entry.path === "string" && entry.path !== "") {
            migrated.push({
                path: entry.path,
                lastOpenedAt: entry.lastOpenedAt,
            });
            continue;
        }
        if (typeof entry.name === "string" && entry.name !== "") {
            try {
                const path = await resolver(entry.name);
                if (typeof path === "string" && path !== "") {
                    migrated.push({ path, lastOpenedAt: entry.lastOpenedAt });
                    mutated = true;
                }
            } catch {
                // Resolver failed; drop the entry rather than
                // leaving a half-migrated record in place.
                mutated = true;
            }
        }
    }
    if (mutated) writeList(migrated);
}
