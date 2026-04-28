/**
 * Application preferences.
 *
 * Stores the user's personal settings \u2014 things that travel
 * with the user across all scores rather than living inside a
 * particular score.
 *
 * This module owns:
 *   - The schema of available preferences (key, type, default,
 *     human label, optional bounds).
 *   - Storage in localStorage under the `gxw.prefs.<key>`
 *     namespace, with synchronous get/set so callers don't
 *     need to await reads at draw time.
 *   - A subscription API so live components can re-render
 *     when a preference changes (used sparingly \u2014 most prefs
 *     are read only at score-creation time).
 *
 * Per the model agreed in the design conversations, anything
 * that influences the music or the rendered shape of a score
 * lives in the score, not in preferences. The preferences
 * here are seed values used when a new score is created \u2014
 * they don't reach back into existing scores. A user with low
 * vision sets large defaults, creates a score with those
 * scales baked in, and the score then carries those scales
 * forward when shared with others. This keeps scores fully
 * portable across users without a per-machine display
 * setting changing what the music does.
 */

// @ts-check

const KEY_PREFIX = "gxw.prefs.";

/**
 * @typedef {Object} PreferenceDef
 * @property {string} key       The name used by callers and stored under KEY_PREFIX + key.
 * @property {string} label     Human-readable label for the settings dialog.
 * @property {string} description Short help text shown beneath the control.
 * @property {"number" | "boolean" | "string"} type
 * @property {number | boolean | string} default
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [category]  Settings dialog category. Defaults to "Display".
 */

/**
 * The full list of preferences. Adding a new preference means
 * adding an entry here \u2014 no other registration step needed.
 *
 * @type {PreferenceDef[]}
 */
export const PREFERENCES = [
    {
        key: "defaultTriggerScale",
        label: "Default Trigger Scale",
        description:
            "Multiplier seeded into new scores' triggerScale field. Changing it here doesn't affect existing scores \u2014 they keep whatever scale they were saved with. Each score's own triggerScale can be edited later via the Properties tab.",
        type: "number",
        default: 1.0,
        min: 0.5,
        max: 4.0,
        step: 0.1,
        category: "Display",
    },
    {
        key: "defaultSpriteScale",
        label: "Default Sprite Scale",
        description:
            "Multiplier seeded into new scores' spriteScale field. Sprite size affects how sprites bounce off the canvas edges, so the scale stored in a score is part of the music. Existing scores keep their own value; changing this only affects scores created from now on.",
        type: "number",
        default: 1.0,
        min: 0.3,
        max: 6.0,
        step: 0.1,
        category: "Display",
    },
    {
        key: "imageDimBypass",
        label: "Brightness Reduction: Bypass",
        description: "",
        type: "boolean",
        default: false,
        category: "Accessibility",
    },
    {
        key: "imageDimBlurRadius",
        label: "Brightness Reduction: Blur Radius",
        description: "",
        type: "number",
        default: 50,
        min: 5,
        max: 200,
        step: 5,
        category: "Accessibility",
    },
    {
        key: "imageDimThreshold",
        label: "Brightness Reduction: Threshold",
        description: "",
        type: "number",
        default: 0.5,
        min: 0.0,
        max: 0.9,
        step: 0.05,
        category: "Accessibility",
    },
    {
        key: "imageDimMaxAttenuation",
        label: "Brightness Reduction: Maximum Attenuation",
        description: "",
        type: "number",
        default: 0.5,
        min: 0.2,
        max: 1.0,
        step: 0.05,
        category: "Accessibility",
    },
];

/**
 * Convenience: find the definition for a given key.
 * @param {string} key
 * @returns {PreferenceDef | null}
 */
export function definitionFor(key) {
    return PREFERENCES.find((p) => p.key === key) ?? null;
}

/**
 * Subscribers, keyed by preference key. Each entry is the set
 * of callbacks registered for that key. Using a Set rather
 * than an Array so unsubscribe is O(1).
 * @type {Map<string, Set<(value: any) => void>>}
 */
const subscribers = new Map();

/**
 * Read a preference value. Returns the stored value if
 * present and parseable, otherwise the schema default.
 * Synchronous \u2014 safe to call from draw paths.
 * @param {string} key
 * @returns {any}
 */
export function getPreference(key) {
    const def = definitionFor(key);
    if (def === null) {
        console.warn(`GXW: unknown preference "${key}".`);
        return undefined;
    }
    const stored = readRaw(key);
    if (stored === null) return def.default;
    const parsed = parseValue(stored, def.type);
    if (parsed === null) return def.default;
    return clampToBounds(parsed, def);
}

/**
 * Write a preference value and notify subscribers. Coerces
 * the value to the schema's declared type and clamps to any
 * declared bounds; values that can't be coerced are rejected
 * silently with a warning.
 * @param {string} key
 * @param {any} value
 */
export function setPreference(key, value) {
    const def = definitionFor(key);
    if (def === null) {
        console.warn(`GXW: unknown preference "${key}".`);
        return;
    }
    const coerced = coerceValue(value, def.type);
    if (coerced === null) {
        console.warn(`GXW: cannot set preference "${key}" to ${value} (type ${def.type}).`);
        return;
    }
    const clamped = clampToBounds(coerced, def);
    writeRaw(key, String(clamped));
    notify(key, clamped);
}

/**
 * Subscribe to changes of a particular preference. Returns an
 * unsubscribe function. The callback is invoked with the new
 * value every time setPreference writes that key.
 * @param {string} key
 * @param {(value: any) => void} callback
 * @returns {() => void}
 */
export function subscribePreference(key, callback) {
    let bag = subscribers.get(key);
    if (bag === undefined) {
        bag = new Set();
        subscribers.set(key, bag);
    }
    bag.add(callback);
    return () => {
        const current = subscribers.get(key);
        if (current !== undefined) current.delete(callback);
    };
}

/**
 * @param {string} key
 * @returns {string | null}
 */
function readRaw(key) {
    try {
        return localStorage.getItem(KEY_PREFIX + key);
    } catch (err) {
        // Some privacy modes throw on access. Treat as "no
        // value stored" rather than failing the whole module.
        console.warn("GXW: localStorage unavailable; using defaults.", err);
        return null;
    }
}

/**
 * @param {string} key
 * @param {string} value
 */
function writeRaw(key, value) {
    try {
        localStorage.setItem(KEY_PREFIX + key, value);
    } catch (err) {
        console.warn("GXW: localStorage write failed.", err);
    }
}

/**
 * @param {string} raw
 * @param {string} type
 * @returns {any}
 */
function parseValue(raw, type) {
    if (type === "number") {
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : null;
    }
    if (type === "boolean") {
        if (raw === "true") return true;
        if (raw === "false") return false;
        return null;
    }
    if (type === "string") return raw;
    return null;
}

/**
 * @param {any} value
 * @param {string} type
 * @returns {any}
 */
function coerceValue(value, type) {
    if (type === "number") {
        const n = typeof value === "number" ? value : parseFloat(String(value));
        return Number.isFinite(n) ? n : null;
    }
    if (type === "boolean") {
        if (typeof value === "boolean") return value;
        if (value === "true") return true;
        if (value === "false") return false;
        return null;
    }
    if (type === "string") return String(value);
    return null;
}

/**
 * @param {any} value
 * @param {PreferenceDef} def
 * @returns {any}
 */
function clampToBounds(value, def) {
    if (def.type !== "number") return value;
    let v = value;
    if (def.min !== undefined && v < def.min) v = def.min;
    if (def.max !== undefined && v > def.max) v = def.max;
    return v;
}

/**
 * @param {string} key
 * @param {any} value
 */
function notify(key, value) {
    const bag = subscribers.get(key);
    if (bag === undefined) return;
    for (const cb of bag) {
        try {
            cb(value);
        } catch (err) {
            console.error(`GXW: preference subscriber for "${key}" threw.`, err);
        }
    }
}
