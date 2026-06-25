/**
 * One-time, load-time renames of legacy scene-object keys to their current
 * names, applied in place to a freshly parsed scene-data object. Run at every
 * parse boundary (the edit layer's parseScene and the runtime's sceneLoader) so
 * a score saved under an old key keeps working: the old key is read, copied to
 * the new key, and dropped, and a later save persists only the new key.
 *
 * Scoped to scene OBJECTS (curves / sprites / triggers) and to this exact key
 * list, so unrelated fields that merely share a word — the curve-only
 * `patternRepeats`, harmony/iReal chart `repeats` — are never touched.
 */

/** @type {Array<[from: string, to: string]>} */
const KEY_RENAMES = [
    // The per-object beat phrase count and its per-phrase pattern/strength stores
    // were renamed repeats → phrases (and repeat* → phrase*) so "repeats" no longer
    // collides with the curve's patternRepeats and harmony chart repeats.
    ["repeats", "phrases"],
    ["repeatPatterns", "phrasePatterns"],
    ["repeatStrengths", "phraseStrengths"],
];

/**
 * Rename legacy keys on every object in a parsed scene-data object, in place.
 * Returns the same object for convenient chaining. A no-op once a scene has been
 * re-saved under the new keys.
 * @param {any} data  a parsed scene.json object (or anything; non-objects pass through)
 * @returns {any}
 */
export function migrateLegacySceneKeys(data) {
    if (data === null || typeof data !== "object") return data;
    for (const group of ["curves", "sprites", "triggers"]) {
        const arr = data[group];
        if (!Array.isArray(arr)) continue;
        for (const obj of arr) {
            if (obj === null || typeof obj !== "object") continue;
            for (const [from, to] of KEY_RENAMES) {
                // If both keys somehow coexist (a half-migrated file), the new key
                // wins; either way the legacy key is removed.
                if (Object.prototype.hasOwnProperty.call(obj, from)) {
                    if (!Object.prototype.hasOwnProperty.call(obj, to)) obj[to] = obj[from];
                    delete obj[from];
                }
            }
        }
    }
    return data;
}
