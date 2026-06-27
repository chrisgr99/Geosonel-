// @ts-check
/**
 * Simple built-in chord progressions for TESTING the note-dynamics and melody
 * styles before the real harmony-generator + tab redesign land
 * (design/harmony-progressions.md). These are short, generic 4 / 8 / 12-bar
 * progressions — NOT the iReal-imported library — authored directly as
 * `SceneHarmony` objects so they load through the existing harmony path
 * (sanitiseSceneHarmony → HarmonyPlayer → the scorer).
 *
 * Authoring shorthand: each bar is a space-separated string of Roman tokens
 * `[b|#]?<degree 1-7><quality>`, where quality is an iReal suffix (see
 * irealChord.js QUALITIES): "" major, "-" minor, "7" dom7, "^7" maj7, "-7" m7,
 * "h7" m7b5, "6" sixth, "sus". Two tokens in a bar split the bar evenly.
 * Degrees are relative to the key tonic (major or minor mode).
 */

/** @typedef {import("../harmonyScene.js").SceneHarmony} SceneHarmony */

/** Parse one Roman token → a chord progression cell, or null if malformed. */
function chordCell(token) {
    const m = /^([b#]?)([1-7])(.*)$/.exec(token);
    if (m === null) return null;
    const accidental = /** @type {"" | "b" | "#"} */ (m[1]);
    return {
        type: "chord",
        chord: { degree: Number(m[2]), accidental, quality: m[3], raw: token },
        raw: token,
    };
}

/**
 * Build a SceneHarmony from a compact bar list.
 * @param {string} title
 * @param {"major"|"minor"} mode
 * @param {number} tonic  tonic pitch class 0..11 (C=0, A=9)
 * @param {string[]} bars  one entry per bar, space-separated Roman tokens
 * @param {[number,number]} [timeSignature]
 * @returns {SceneHarmony}
 */
function prog(title, mode, tonic, bars, timeSignature = [4, 4]) {
    /** @type {Array<Object>} */
    const progression = [];
    bars.forEach((bar, i) => {
        if (i > 0) progression.push({ type: "bar", barStyle: "single" });   // barline BETWEEN bars
        for (const tok of bar.trim().split(/\s+/)) {
            const cell = chordCell(tok);
            if (cell !== null) progression.push(cell);
        }
    });
    progression.push({ type: "end" });
    return { title, composer: "", key: { tonicPitchClass: tonic, mode }, timeSignature, progression };
}

const C = 0, A = 9;

/** @type {SceneHarmony[]} */
export const TEST_PROGRESSIONS = [
    // --- Major, 4 bars (one chord per bar) ---
    prog("Pop Axis", "major", C, ["1", "5", "6-", "4"]),
    prog("Doo-Wop", "major", C, ["1", "6-", "4", "5"]),
    prog("Three-Chord", "major", C, ["1", "4", "5", "1"]),
    prog("Ballad", "major", C, ["6-", "4", "1", "5"]),
    // --- Major, two chords per bar ---
    prog("50s (2/bar)", "major", C, ["1 6-", "4 5", "1 6-", "4 5"]),
    // --- Major, 8 bars ---
    prog("Canon", "major", C, ["1", "5", "6-", "3-", "4", "1", "4", "5"]),
    prog("Jazz I-vi-ii-V", "major", C, ["1^7", "6-7", "2-7", "57", "1^7", "6-7", "2-7", "57"]),
    // --- Minor, 4 bars ---
    prog("Minor Axis", "minor", A, ["1-", "6", "3", "7"]),
    prog("Andalusian", "minor", A, ["1-", "7", "6", "57"]),
    prog("Minor i-iv-v", "minor", A, ["1-", "4-", "5-", "1-"]),
    prog("Minor ii-V-i", "minor", C, ["2h7", "57", "1-7", "1-7"]),
    // --- Simple vamps ---
    prog("Modal Vamp", "minor", A, ["1-"]),
    prog("I-IV Vamp", "major", C, ["1", "4"]),
    // --- 12-bar blues (dominant 7ths) ---
    prog("12-Bar Blues", "major", C, ["17", "17", "17", "17", "47", "47", "17", "17", "57", "47", "17", "57"]),
];

/** Look a test progression up by title. */
export function testProgressionByName(name) {
    return TEST_PROGRESSIONS.find((p) => p.title === name) || null;
}
