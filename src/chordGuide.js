// @ts-check
/**
 * Chord-guide voicing.
 *
 * Turns a chord STRUCT ({ root: MIDI, notes: semitone offsets including 0 }, as
 * produced by harmonyMap.chordStructure) into a small set of MIDI notes to sound
 * as a COMPOSING AID while the user edits beats against a chord chart — never
 * part of the piece. A jazz SHELL (root + 3rd + 7th) conveys the chord's quality
 * and cadential pull with just three notes; a chord with no 7th falls back to the
 * 5th (a plain triad), and a sus / quartal chord keeps whatever colour tone it
 * has. Pure and unit-tested.
 */

/**
 * @param {{ root: number, notes: number[] } | null | undefined} struct
 * @returns {number[]} MIDI notes (root + chosen offsets); [] when there's no chord.
 */
export function shellVoicing(struct) {
    if (!struct || !Array.isArray(struct.notes) || struct.notes.length === 0) return [];
    const offs = struct.notes;
    const pick = (...xs) => xs.find((x) => offs.includes(x));
    const third = pick(3, 4);                 // minor or major third
    const colour = pick(10, 11)               // the 7th if present,
        ?? pick(6, 7, 8)                       // else the 5th (a plain triad),
        ?? pick(5, 2);                         // else a sus / quartal colour tone
    /** @type {number[]} */
    const chosen = [0];
    if (third !== undefined) chosen.push(third);
    if (colour !== undefined && !chosen.includes(colour)) chosen.push(colour);
    // Degenerate chord (e.g. just a root, or a power chord): pad with whatever
    // distinct tones exist so the guide still sounds something.
    for (const o of offs) {
        if (chosen.length >= 3) break;
        if (!chosen.includes(o)) chosen.push(o);
    }
    return chosen.map((o) => struct.root + o);
}
