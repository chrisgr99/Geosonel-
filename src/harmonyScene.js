/**
 * Scene-level chosen-progression sanitiser.
 *
 * A scene may carry a single "chosen progression" — the Song a composer
 * picked from the harmony library, frozen into the score so it travels
 * with the piece (no library dependency at play time). It is stored under
 * the scene's `harmony` field as a small serialisable object:
 *
 *   {
 *     title: string,
 *     composer: string,
 *     key: { tonicPitchClass: number (0..11), mode: "major" | "minor" },
 *     timeSignature: [numerator, denominator],
 *     progression: ProgressionCell[]   // plain-JSON cells (harmonyModel.js)
 *   }
 *
 * The progression cells are already plain JSON (see harmonyModel.js: chord
 * cells hold { type, chord?, noChord?, raw? }; markers hold { type, … }),
 * so they are carried through verbatim once we've confirmed each is a
 * plain object with a string `type`.
 *
 * This module is the load-time guard: a hand-edited or legacy scene.json
 * can carry anything in `harmony`, so the loader runs the raw value
 * through {@link sanitiseSceneHarmony}, which returns a clean object on a
 * well-formed value and `null` on anything malformed. Returning null (the
 * field's default) means a broken `harmony` block can never crash a load —
 * it simply reads as "no chosen progression".
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`.
 */

// @ts-check

/**
 * @typedef {Object} SceneHarmony
 * @property {string} title
 * @property {string} composer
 * @property {{ tonicPitchClass: number, mode: "major" | "minor" }} key
 * @property {[number, number]} timeSignature
 * @property {Array<Object>} progression
 */

/**
 * Validate that a value is a plain (non-array, non-null) object.
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Sanitise a raw `harmony` value (typically from scene.json) into a clean
 * {@link SceneHarmony}, or return null if it is absent or malformed.
 *
 * The shape is validated defensively: title/composer must be strings; key
 * must be { tonicPitchClass: integer 0..11, mode: "major"|"minor" };
 * timeSignature must be a 2-number array; progression must be an array of
 * plain objects each carrying a string `type`. A single bad field fails
 * the whole value to null rather than producing a half-valid object, so a
 * downstream consumer can trust a non-null result completely.
 *
 * Returns a FRESH object (and a shallow-copied progression array of the
 * original cell objects) so the Scene never aliases the loader's parsed
 * scene.json.
 *
 * @param {unknown} value
 * @returns {SceneHarmony | null}
 */
export function sanitiseSceneHarmony(value) {
    if (!isPlainObject(value)) return null;

    const { title, composer, key, timeSignature, progression } = value;

    if (typeof title !== "string") return null;
    if (typeof composer !== "string") return null;

    if (!isPlainObject(key)) return null;
    const tonicPitchClass = key.tonicPitchClass;
    const mode = key.mode;
    if (typeof tonicPitchClass !== "number"
        || !Number.isInteger(tonicPitchClass)
        || tonicPitchClass < 0
        || tonicPitchClass > 11) {
        return null;
    }
    if (mode !== "major" && mode !== "minor") return null;

    if (!Array.isArray(timeSignature) || timeSignature.length !== 2) return null;
    const num = timeSignature[0];
    const den = timeSignature[1];
    if (typeof num !== "number" || !Number.isFinite(num)) return null;
    if (typeof den !== "number" || !Number.isFinite(den)) return null;

    if (!Array.isArray(progression)) return null;
    for (const cell of progression) {
        if (!isPlainObject(cell)) return null;
        if (typeof cell.type !== "string") return null;
    }

    return {
        title,
        composer,
        key: { tonicPitchClass, mode },
        timeSignature: [num, den],
        progression: progression.slice(),
    };
}
