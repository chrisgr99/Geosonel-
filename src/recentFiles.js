/**
 * Recent Files list.
 *
 * Keeps a localStorage-backed list of the most recently
 * opened scores, used by the File menu's Open Recent
 * submenu. Entries are objects of the shape
 * {name: string, lastOpenedAt: number}; the list is sorted
 * most-recent first and capped at MAX_ENTRIES total.
 *
 * The list is updated on every score load (resolveInitial
 * Bundle, switchToBundle, the score actions). Recording the
 * same score again moves it to the front and refreshes
 * its timestamp. Renaming a score updates the existing
 * entry's name in place; deleting a score removes its
 * entry. The Clear Menu item in the File menu's submenu
 * empties the list.
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
 * @property {string} name           The score's name as it appears in storage.
 * @property {number} lastOpenedAt   Wall-clock ms timestamp of the last time
 *   this score was loaded.
 */

/**
 * Read the current list from localStorage. Returns an empty
 * array on any read or parse failure. The returned array is
 * sorted most-recent first; callers can rely on that
 * ordering without re-sorting.
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
                typeof entry.name === "string" &&
                typeof entry.lastOpenedAt === "number") {
                list.push({
                    name: entry.name,
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
 * @param {string} name
 */
export function recordScoreOpen(name) {
    if (typeof name !== "string" || name === "") return;
    const list = getRecentScores().filter((e) => e.name !== name);
    list.unshift({ name, lastOpenedAt: Date.now() });
    if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
    writeList(list);
}

/**
 * Remove a score's entry from the list. Used when the
 * user deletes a score so the menu doesn't list a stale
 * pointer.
 * @param {string} name
 */
export function forgetScore(name) {
    if (typeof name !== "string" || name === "") return;
    const list = getRecentScores().filter((e) => e.name !== name);
    writeList(list);
}

/**
 * Rename a score's entry without disturbing its position
 * in the list. The lastOpenedAt timestamp is preserved so
 * a rename doesn't shuffle the score to the front. If no
 * entry with the old name exists this is a no-op.
 * @param {string} oldName
 * @param {string} newName
 */
export function renameInRecentScores(oldName, newName) {
    if (typeof oldName !== "string" || oldName === "") return;
    if (typeof newName !== "string" || newName === "") return;
    const list = getRecentScores();
    let changed = false;
    for (const entry of list) {
        if (entry.name === oldName) {
            entry.name = newName;
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
