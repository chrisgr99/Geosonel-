/**
 * Superdough sound-name index for the Voice band's Beatbox row.
 *
 * The Beatbox bank dropdown picks either a specific drum machine
 * (RolandTR909, LinnDrum, …) or "superdirt" — the no-bank default. The
 * sound dropdown beside it lists the individual sounds available in that
 * choice. Two sources, both loaded from the same sample maps the audio
 * runtime uses (plain JSON, independent of the Strudel engine, so the
 * dropdown fills without "Load Engine"):
 *
 *   - Drum machines: tidal-drum-machines.json (felixroos/dough-samples),
 *     keyed "Bank_sound" (e.g. "RolandTR909_bd"). Split on the first
 *     underscore and group the sound names by bank.
 *   - superdirt default: the Dirt-Samples strudel.json (tidalcycles/
 *     dirt-samples), whose top-level keys ARE the bare sound names
 *     (bd, sd, hh, cp, 808bd, bass, arpy, …) that play with no bank.
 *
 * Both load asynchronously; getBankSoundNames returns [] until they
 * arrive, and loadDrumMachineSounds resolves when ready so the caller
 * can re-render the inspector to fill the dropdown in.
 */

// @ts-check

const TIDAL_DRUM_MACHINES_URL =
    "https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json";
const DIRT_SAMPLES_URL =
    "https://raw.githubusercontent.com/tidalcycles/dirt-samples/master/strudel.json";

/**
 * Bank name → sorted array of sound names, or null until the drum-machine
 * fetch completes (or fails, leaving it null).
 * @type {Record<string, string[]> | null}
 */
let bankSounds = null;

/**
 * The bare superdirt (Dirt-Samples) sound names — the no-bank default —
 * sorted, or null until that fetch completes (or fails).
 * @type {string[] | null}
 */
let defaultSounds = null;

/** In-flight load promise, so concurrent callers share one request. */
let loading = null;

/**
 * Whether the sound index has finished loading (both maps attempted).
 * @returns {boolean}
 */
export function drumMachineSoundsLoaded() {
    return bankSounds !== null && defaultSounds !== null;
}

/**
 * The sound names available for a bank choice, sorted. An empty bank ("")
 * is the "superdirt" default and returns the bare Dirt-Samples names; any
 * other value returns that drum machine's sounds. Returns [] when the
 * index hasn't loaded yet or the bank is unknown.
 * @param {string} bank
 * @returns {string[]}
 */
export function getBankSoundNames(bank) {
    if (typeof bank !== "string") return [];
    if (bank === "") return defaultSounds ?? [];
    if (bankSounds === null) return [];
    return bankSounds[bank] ?? [];
}

/**
 * Group a "Bank_sound" sample map into bank → sorted sound names.
 * @param {Record<string, unknown>} json
 * @returns {Record<string, string[]>}
 */
function groupBanks(json) {
    /** @type {Record<string, string[]>} */
    const map = {};
    for (const key of Object.keys(json)) {
        if (key.startsWith("_")) continue;     // "_base" and other meta keys
        const underscore = key.indexOf("_");
        if (underscore <= 0) continue;
        const bank = key.slice(0, underscore);
        const sound = key.slice(underscore + 1);
        if (map[bank] === undefined) map[bank] = [];
        map[bank].push(sound);
    }
    for (const bank of Object.keys(map)) map[bank].sort();
    return map;
}

/**
 * Fetch and build both indexes (once). Resolves when ready (or immediately
 * if already loaded); never rejects — a failed fetch is logged and leaves
 * that index empty so the rest of the inspector keeps working offline.
 * @returns {Promise<void>}
 */
export function loadDrumMachineSounds() {
    if (drumMachineSoundsLoaded()) return Promise.resolve();
    if (loading !== null) return loading;
    const machines = fetch(TIDAL_DRUM_MACHINES_URL)
        .then((res) => res.json())
        .then((json) => { bankSounds = groupBanks(json); })
        .catch((err) => {
            console.warn("GXW: drum-machine sound index failed to load.", err);
            bankSounds = {};
        });
    const dirt = fetch(DIRT_SAMPLES_URL)
        .then((res) => res.json())
        .then((json) => {
            defaultSounds = Object.keys(json).filter((k) => !k.startsWith("_")).sort();
        })
        .catch((err) => {
            console.warn("GXW: superdirt (Dirt-Samples) sound index failed to load.", err);
            defaultSounds = [];
        });
    loading = Promise.all([machines, dirt]).then(() => undefined);
    return loading;
}
