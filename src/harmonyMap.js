/**
 * Harmony → MIDI mapping helpers (the GeoSonix chord-tone-index model;
 * our name for the wired global is `mapToHarmony`).
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`. The simulation wires the
 * bare `mapToHarmony(...)` global and `this.chord` to a firing callback;
 * this file holds the value-free arithmetic so it is testable offline.
 *
 * The model mirrors GeoSonix's JavaScriptLibrary.js `mapChord` (~line 706):
 * a value in a source range is mapped to an INDEX into the chord's tones
 * laid out ascending across a MIDI range — it is chord-tone *indexing*, NOT
 * snap-to-nearest. So value 0 picks the lowest available chord tone, value
 * 1 the highest, and the rest distribute linearly between them.
 *
 *   tones  = chordTonesInRange(chord, key, rangeLow, rangeHigh)  // ascending
 *   index  = map(value, lowValue, highValue, 0, tones.length - 1)
 *   result = tones[round(index)]                                  // a MIDI note
 *
 * A chord is the ROMAN-form cell the harmony model stores
 * ({ degree, accidental, quality, … }); we resolve its root against the
 * song key (reusing irealChord.js `rootPitchClass`) and add the
 * quality's chord-tone intervals.
 */

// @ts-check

import { rootPitchClass } from "./irealChord.js";

/**
 * @typedef {import("./irealChord.js").Chord} Chord
 * @typedef {import("./irealChord.js").Key} Key
 */

/**
 * Quality → chord-tone semitone intervals (above the root, root = 0).
 *
 * The keys are the raw iReal quality suffixes the parser produces (see
 * irealChord.js QUALITIES and normaliseQuality). Triads and the common
 * sevenths are exact; extensions (9/11/13) stack the upper structure on
 * the underlying seventh; common alterations (b5/#5/b9/#9/#11/b13) adjust
 * or add the altered tone. Anything not matched here degrades gracefully:
 * the resolver strips trailing extension/alteration text and falls back to
 * the underlying seventh or triad (see {@link qualityIntervals}), so an
 * uncatalogued suffix never crashes — at worst it sounds the plainer chord.
 *
 * Documented base shapes:
 *   ""    major triad        [0,4,7]
 *   "-"   minor triad        [0,3,7]
 *   "+"   augmented triad    [0,4,8]
 *   "o"   diminished triad   [0,3,6]
 *   "h"   half-dim triad     [0,3,6]   (ø without the 7th)
 *   "sus" sus4 triad         [0,5,7]
 *   "2"   sus2 triad         [0,2,7]
 *   "7"   dominant 7th       [0,4,7,10]
 *   "^7"  major 7th          [0,4,7,11]
 *   "^"   major 7th          [0,4,7,11]  (iReal "^" alone = maj7 in practice)
 *   "-7"  minor 7th          [0,3,7,10]
 *   "-^7" minor-major 7th    [0,3,7,11]
 *   "h7"  half-dim 7th (ø7)  [0,3,6,10]
 *   "o7"  diminished 7th     [0,3,6,9]
 *   "6"   major 6th          [0,4,7,9]
 *   "-6"  minor 6th          [0,3,7,9]
 *   "69"  6/9                 [0,4,7,9,14]
 *   "9"   dominant 9th       [0,4,7,10,14]
 *   "^9"  major 9th          [0,4,7,11,14]
 *   "-9"  minor 9th          [0,3,7,10,14]
 *   "11"  dominant 11th      [0,4,7,10,14,17]
 *   "13"  dominant 13th      [0,4,7,10,14,21]
 *   "7sus" dom7 sus4         [0,5,7,10]
 *
 * @type {Record<string, number[]>}
 */
const QUALITY_INTERVALS = {
  "": [0, 4, 7],
  "-": [0, 3, 7],
  "+": [0, 4, 8],
  "o": [0, 3, 6],
  "h": [0, 3, 6],
  "sus": [0, 5, 7],
  "2": [0, 2, 7],
  "7": [0, 4, 7, 10],
  "^7": [0, 4, 7, 11],
  "^": [0, 4, 7, 11],
  "-7": [0, 3, 7, 10],
  "-^7": [0, 3, 7, 11],
  "h7": [0, 3, 6, 10],
  "o7": [0, 3, 6, 9],
  "6": [0, 4, 7, 9],
  "-6": [0, 3, 7, 9],
  "69": [0, 4, 7, 9, 14],
  "-69": [0, 3, 7, 9, 14],
  "9": [0, 4, 7, 10, 14],
  "^9": [0, 4, 7, 11, 14],
  "-9": [0, 3, 7, 10, 14],
  "11": [0, 4, 7, 10, 14, 17],
  "-11": [0, 3, 7, 10, 14, 17],
  "13": [0, 4, 7, 10, 14, 21],
  "-13": [0, 3, 7, 10, 14, 21],
  "7sus": [0, 5, 7, 10],
  "9sus": [0, 5, 7, 10, 14],
  "sus2": [0, 2, 7],
};

/**
 * Apply a single alteration token to a working interval set (semitones
 * above the root). Adds or replaces the altered tone. Unknown tokens are
 * ignored (graceful — the base chord still sounds).
 * @param {Set<number>} set
 * @param {string} token  e.g. "b9", "#9", "b5", "#5", "#11", "b13", "add9"
 */
function applyAlteration(set, token) {
  switch (token) {
    case "b5": set.delete(7); set.add(6); break;
    case "#5": case "+5": set.delete(7); set.add(8); break;
    case "b9": set.add(13); break;
    case "#9": set.add(15); break;
    case "#11": case "b5add": set.add(18); break;
    case "b13": case "b6": set.add(20); break;
    case "add9": case "9add": set.add(14); break;
    case "add11": set.add(17); break;
    case "add13": case "add6": set.add(21); break;
    case "alt":
      // Altered dominant: drop the perfect 5th, add b5/#5/b9/#9.
      set.delete(7);
      set.add(6); set.add(8); set.add(13); set.add(15);
      break;
    default:
      break;
  }
}

/**
 * The chord-tone intervals (semitones above the root) for a quality
 * suffix. Direct hits in {@link QUALITY_INTERVALS} win. Otherwise we parse
 * a leading base (minor/major/dom marker + a number) and a trailing run of
 * alteration tokens, stacking the appropriate base chord then applying the
 * alterations. Final fallback for anything unrecognised is the underlying
 * seventh (dom for unmarked, min for "-…") or, lacking that, the triad —
 * never an empty set, never a throw.
 *
 * @param {string} quality  raw iReal suffix (already normalised)
 * @returns {number[]} ascending unique intervals starting at 0
 */
export function qualityIntervals(quality) {
  const q = quality || "";
  if (Object.prototype.hasOwnProperty.call(QUALITY_INTERVALS, q)) {
    return QUALITY_INTERVALS[q].slice();
  }

  const isMinor = q.startsWith("-");
  const isMaj7Family = /\^/.test(q); // "^9", "^11" etc.

  // Strip alteration/add tokens before reading the base extension number,
  // so "7b9" reads as a dominant 7th (then b9 is added below) rather than
  // mistaking the "9" in "b9" for a natural-9th extension.
  const altTokenRe = /(b5|#5|\+5|b9|#9|#11|b13|b6|add9|add11|add13|add6|alt)/g;
  const stem = q.replace(altTokenRe, "");

  // Pick a base seventh by the highest extension number present in the stem.
  let base;
  if (/13/.test(stem)) base = isMinor ? [0, 3, 7, 10, 14, 21] : [0, 4, 7, 10, 14, 21];
  else if (/11/.test(stem)) base = isMinor ? [0, 3, 7, 10, 14, 17] : [0, 4, 7, 10, 14, 17];
  else if (/9/.test(stem)) {
    if (isMaj7Family) base = [0, 4, 7, 11, 14];
    else base = isMinor ? [0, 3, 7, 10, 14] : [0, 4, 7, 10, 14];
  } else if (/7/.test(stem)) {
    if (isMaj7Family) base = [0, 4, 7, 11];
    else base = isMinor ? [0, 3, 7, 10] : [0, 4, 7, 10];
  } else if (/6/.test(stem)) {
    base = isMinor ? [0, 3, 7, 9] : [0, 4, 7, 9];
  } else if (q.includes("sus")) {
    base = [0, 5, 7];
  } else {
    // No seventh/extension marker: a triad. Minor / aug / dim / major.
    if (isMinor) base = [0, 3, 7];
    else if (q.includes("+")) base = [0, 4, 8];
    else if (q.includes("o")) base = [0, 3, 6];
    else if (q.includes("h")) base = [0, 3, 6];
    else base = [0, 4, 7];
  }

  const set = new Set(base);
  // sus overrides the 3rd on a dominant-family chord (e.g. "7sus", "9sus").
  if (q.includes("sus")) {
    set.delete(3);
    set.delete(4);
    set.add(5);
  }

  // Apply alteration tokens found anywhere in the suffix.
  altTokenRe.lastIndex = 0;
  let m;
  while ((m = altTokenRe.exec(q)) !== null) {
    applyAlteration(set, m[1]);
  }

  return Array.from(set).sort((a, b) => a - b);
}

/**
 * The pitch classes (0..11) of a chord's tones, given the song key.
 * Resolves the chord root via {@link rootPitchClass} (reusing the import
 * feature's degree→pitch resolution) then adds the quality intervals,
 * folded into pitch-class space and de-duplicated.
 *
 * A null/No-Chord cell (or a cell without a `chord`) yields an empty array.
 *
 * @param {Chord | null | undefined} chord  key-relative Roman chord cell
 * @param {Key} key
 * @returns {number[]} unique pitch classes, ascending
 */
export function chordPitchClasses(chord, key) {
  if (!chord || typeof chord.degree !== "number") return [];
  const root = rootPitchClass(chord, key);
  const intervals = qualityIntervals(chord.quality || "");
  const set = new Set();
  for (const iv of intervals) set.add(((root + iv) % 12 + 12) % 12);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * A chord reduced to a root pitch plus its tones as semitone offsets from
 * that root — the shape exposed to a firing callback as `this.chord` /
 * `this.nextChord`, so a callback can pick pitches without inspecting chord
 * quality. Pure: reuses the same degree→pitch-class resolution that backs
 * {@link chordPitchClasses} / chordToLetter (via {@link rootPitchClass}).
 *
 *   { root: <MIDI int>, notes: <int[]> }
 *
 * - `root` = the chord's root placed in the octave starting at `baseMidi`:
 *   root = baseMidi + rootPitchClass(chord, key). (baseMidi default 48 is
 *   PROVISIONAL — it ties into later register-aware work.)
 * - `notes` = the quality's chord-tone intervals reduced into a single
 *   octave (each % 12), de-duped, sorted ascending, and always INCLUDING 0
 *   (the root). An absolute MIDI note for tone i is `root + notes[i]`. So a
 *   C minor-7 → notes [0,3,7,10]; a C maj7 → [0,4,7,11]; a dom9 (interval
 *   14 present) folds the 9th to 2.
 *
 * Returns null for a null / No-Chord cell.
 *
 * @param {Chord | null | undefined} chord  key-relative Roman chord cell
 * @param {Key} key
 * @param {number} [baseMidi]  octave base for the root (default 48, provisional)
 * @returns {{ root: number, notes: number[] } | null}
 */
export function chordStructure(chord, key, baseMidi = 48) {
  if (!chord || typeof chord.degree !== "number") return null;
  const rootPc = rootPitchClass(chord, key);
  const root = baseMidi + rootPc;
  const set = new Set([0]);
  for (const iv of qualityIntervals(chord.quality || "")) {
    set.add(((iv % 12) + 12) % 12);
  }
  const notes = Array.from(set).sort((a, b) => a - b);
  return { root, notes };
}

/**
 * The chord's tones as ascending MIDI note numbers across [rangeLow,
 * rangeHigh] inclusive. This is the GeoSonix `notesInRange` layout: every
 * octave of every chord pitch class that falls in the range, sorted.
 *
 * Returns an empty array for a null/No-Chord cell or an empty range.
 *
 * @param {Chord | null | undefined} chord
 * @param {Key} key
 * @param {number} rangeLow   lowest MIDI note (inclusive)
 * @param {number} rangeHigh  highest MIDI note (inclusive)
 * @returns {number[]} ascending MIDI notes
 */
export function chordTonesInRange(chord, key, rangeLow, rangeHigh) {
  const pcs = chordPitchClasses(chord, key);
  if (pcs.length === 0) return [];
  // Match GeoSonix notesInRange: an inverted range (low > high) yields no
  // notes rather than being silently swapped.
  const lo = Math.ceil(rangeLow);
  const hi = Math.floor(rangeHigh);
  /** @type {number[]} */
  const notes = [];
  for (let n = lo; n <= hi; n++) {
    if (n < 0 || n > 127) continue;
    if (pcs.includes(((n % 12) + 12) % 12)) notes.push(n);
  }
  return notes;
}

/**
 * Linear map of `value` from [low1, high1] onto [low2, high2], matching
 * GeoSonix's `map`. The value is CLAMPED to the source range first, so an
 * out-of-range value pins to an endpoint (and the index never escapes the
 * tone array). A degenerate source range (low1 === high1) maps to low2.
 * @param {number} value
 * @param {number} low1
 * @param {number} high1
 * @param {number} low2
 * @param {number} high2
 * @returns {number}
 */
export function mapRange(value, low1, high1, low2, high2) {
  if (high1 === low1) return low2;
  let t = (value - low1) / (high1 - low1);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return low2 + t * (high2 - low2);
}

/**
 * Default source range and MIDI destination range for {@link mapToHarmonyCore}
 * / the wired `mapToHarmony` global. Matches GeoSonix's mapChord defaults
 * (value normalised 0..1) with a sensible MIDI window.
 */
export const MAP_TO_HARMONY_DEFAULTS = Object.freeze({
  lowValue: 0,
  highValue: 1,
  rangeLow: 40,
  rangeHigh: 70,
});

/**
 * Core of the `mapToHarmony` helper: map a value to a MIDI note of `chord`.
 *
 * Lays the chord's tones out ascending across [rangeLow, rangeHigh], maps
 * `value` (clamped to [lowValue, highValue]) to an INDEX into that array,
 * rounds, and returns that tone. value=lowValue → lowest tone, value=
 * highValue → highest, midpoint → a middle tone.
 *
 * GRACEFUL DEGRADE: when there is no chord to map against (chord is
 * null/No-Chord, or it resolves to no tones in the range) the value is
 * mapped LINEARLY across [rangeLow, rangeHigh] and rounded — so a scene
 * with no imported chart still produces a sensible, in-range MIDI note
 * instead of NaN. The wired `mapToHarmony` global passes its ambient current
 * chord (null when playback ended with loop off, or no harmony loaded),
 * and this fallback is what fires then.
 *
 * @param {Chord | null | undefined} chord
 * @param {Key | null | undefined} key
 * @param {number} value
 * @param {number} lowValue
 * @param {number} highValue
 * @param {number} rangeLow
 * @param {number} rangeHigh
 * @returns {number} a MIDI note number (rounded integer)
 */
export function mapToHarmonyCore(chord, key, value, lowValue, highValue, rangeLow, rangeHigh) {
  const tones = key ? chordTonesInRange(chord, key, rangeLow, rangeHigh) : [];
  if (tones.length === 0) {
    // No chord context: linear fallback across the MIDI range.
    return Math.round(mapRange(value, lowValue, highValue, rangeLow, rangeHigh));
  }
  if (tones.length === 1) return tones[0];
  const index = mapRange(value, lowValue, highValue, 0, tones.length - 1);
  return tones[Math.round(index)];
}
