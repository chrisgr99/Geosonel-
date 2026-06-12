/**
 * iReal Pro chord + key parsing, and Roman/Letter rendering.
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`.
 *
 * The harmony model stores chords in ROMAN form relative to the song's
 * key: { degree, accidental, quality, bass? } plus the raw iReal symbol
 * for debugging. The absolute letter form is derivable from degree + key.
 *
 * Quality is normalised to a small documented string set (see QUALITIES).
 * We keep the iReal *suffix* shape close to the original so a later
 * renderer can append it directly to a Roman numeral or a letter root.
 */

// @ts-check

/**
 * @typedef {Object} Chord
 * @property {number} degree         Scale degree 1..7 relative to key tonic
 *                                   (counting by letter/diatonic position).
 * @property {"" | "b" | "#"} accidental  Chromatic alteration of the root.
 * @property {string} quality        Normalised quality suffix (see QUALITIES).
 * @property {ChordBass} [bass]       Optional slash-bass, as degree+accidental.
 * @property {string} raw            Original iReal chord symbol, for debugging.
 */

/**
 * @typedef {Object} ChordBass
 * @property {number} degree
 * @property {"" | "b" | "#"} accidental
 */

/**
 * @typedef {Object} Key
 * @property {number} tonicPitchClass  0..11, C = 0.
 * @property {"major" | "minor"} mode
 */

/** Pitch class of each natural letter, C = 0. */
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Letter order for diatonic-degree counting. */
const LETTER_ORDER = ["C", "D", "E", "F", "G", "A", "B"];

/**
 * The normalised quality set. These are the iReal suffixes we recognise;
 * unknown-but-parseable suffixes are passed through verbatim (still a
 * valid Chord, just an uncatalogued quality string). Documented here so
 * downstream code can switch on them.
 *
 * Examples seen in real data: "" (major triad), "7", "-7" (min7),
 * "^7" (maj7), "6", "-6", "h7" (ø7), "o7" (dim7), "-" (minor triad),
 * "+" (aug), "7sus", "7b9", "7#11", "7alt", "^9", "69", "add9", …
 */
export const QUALITIES = Object.freeze({
  MAJOR: "",
  MINOR: "-",
  MAJ7: "^7",
  MAJ: "^",
  DOM7: "7",
  MIN7: "-7",
  HALF_DIM7: "h7",
  HALF_DIM: "h",
  DIM7: "o7",
  DIM: "o",
  AUG: "+",
  SIX: "6",
  MIN6: "-6",
  SUS: "sus",
});

/**
 * Parse an iReal key field into { tonicPitchClass, mode }.
 * iReal writes minor keys with a trailing "-", e.g. "A-", "Bb-", "C#-".
 *
 * @param {string} field
 * @returns {Key | null} null if unparseable.
 */
export function parseKey(field) {
  const m = /^([A-G])([#b]?)(-?)$/.exec((field || "").trim());
  if (!m) return null;
  const [, letter, acc, minor] = m;
  let pc = LETTER_PC[/** @type {keyof typeof LETTER_PC} */ (letter)];
  if (acc === "#") pc = (pc + 1) % 12;
  else if (acc === "b") pc = (pc + 11) % 12;
  return { tonicPitchClass: pc, mode: minor ? "minor" : "major" };
}

/**
 * The diatonic letter that sits `degree-1` letters above the tonic letter.
 * @param {string} tonicLetter  one of C D E F G A B
 * @param {number} degree       1..7
 * @returns {string}
 */
function letterForDegree(tonicLetter, degree) {
  const i = LETTER_ORDER.indexOf(tonicLetter);
  return LETTER_ORDER[(i + degree - 1) % 7];
}

/** Tonic letter name for a key, chosen to keep degree spelling sensible. */
const PC_TO_LETTER_SHARP = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const PC_TO_ACC_SHARP =    ["",  "#", "",  "#", "",  "",  "#", "",  "#", "",  "#", ""];
const PC_TO_LETTER_FLAT =  ["C", "D", "D", "E", "E", "F", "G", "G", "A", "A", "B", "B"];
const PC_TO_ACC_FLAT =     ["",  "b", "",  "b", "",  "",  "b", "",  "b", "",  "b", ""];

/**
 * Choose a spelling (letter + accidental) for a pitch class, biased by
 * whether the key is "flat-side" or "sharp-side" so e.g. Eb major spells
 * its tonic Eb not D#.
 * @param {number} pc 0..11
 * @param {boolean} preferFlat
 * @returns {{letter: string, accidental: "" | "b" | "#"}}
 */
function spellPc(pc, preferFlat) {
  pc = ((pc % 12) + 12) % 12;
  const letter = preferFlat ? PC_TO_LETTER_FLAT[pc] : PC_TO_LETTER_SHARP[pc];
  const accidental = /** @type {"" | "b" | "#"} */ (
    preferFlat ? PC_TO_ACC_FLAT[pc] : PC_TO_ACC_SHARP[pc]
  );
  return { letter, accidental };
}

/** Keys whose signature is on the flat side (used for enharmonic spelling). */
const FLAT_TONIC_PCS = new Set([
  // F, Bb, Eb, Ab, Db, Gb majors and relative minors share these tonics
  5, 10, 3, 8, 1, 6,
]);

/**
 * Split an iReal chord symbol into root letter, root accidental,
 * quality suffix, and optional slash bass.
 * Root letter "W" means "same root as previous chord" (invisible repeat);
 * callers handle that before reaching here.
 *
 * @param {string} symbol
 * @returns {{ letter: string, acc: "" | "b" | "#", quality: string,
 *   bassLetter: string|null, bassAcc: "" | "b" | "#" } | null}
 */
export function splitChordSymbol(symbol) {
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(symbol);
  if (!m) return null;
  const [, letter, acc, quality, bassLetter, bassAcc] = m;
  return {
    letter,
    acc: /** @type {"" | "b" | "#"} */ (acc || ""),
    quality: quality || "",
    bassLetter: bassLetter || null,
    bassAcc: /** @type {"" | "b" | "#"} */ (bassAcc || ""),
  };
}

/**
 * Absolute pitch class of a letter + accidental.
 * @param {string} letter
 * @param {"" | "b" | "#"} acc
 * @returns {number}
 */
function absPc(letter, acc) {
  let pc = LETTER_PC[/** @type {keyof typeof LETTER_PC} */ (letter)];
  if (acc === "#") pc += 1;
  else if (acc === "b") pc -= 1;
  return ((pc % 12) + 12) % 12;
}

/**
 * Convert an absolute root (letter + accidental) to a scale degree +
 * accidental relative to a key. Degree is the diatonic distance counted
 * by LETTER (so the root letter determines the numeral), and the
 * accidental captures any chromatic offset from the diatonic pitch.
 *
 * @param {string} letter   root letter A..G
 * @param {"" | "b" | "#"} acc  root accidental
 * @param {Key} key
 * @returns {{ degree: number, accidental: "" | "b" | "#" }}
 */
export function rootToDegree(letter, acc, key) {
  const preferFlat = FLAT_TONIC_PCS.has(key.tonicPitchClass);
  const tonicSpelling = spellPc(key.tonicPitchClass, preferFlat);
  const tonicLetter = tonicSpelling.letter;

  // degree = how many letters above the tonic letter this root letter is.
  const ti = LETTER_ORDER.indexOf(tonicLetter);
  const ri = LETTER_ORDER.indexOf(letter);
  const degree = ((ri - ti + 7) % 7) + 1;

  // Expected diatonic pitch class of that degree's letter (the natural
  // letter pitch, shifted by the tonic accidental for major scales is not
  // straightforward — instead we compare against the actual key-scale
  // pitch). We compute the diatonic scale pitch for this degree from the
  // major/minor scale of the key tonic, then the accidental is the signed
  // semitone difference between the chord root and that scale pitch.
  const scalePc = diatonicPc(key, degree);
  const rootPc = absPc(letter, acc);
  let diff = ((rootPc - scalePc + 6) % 12) - 6; // signed, -6..5
  // Normalise to -1/0/+1 territory; iReal data only ever needs ±1.
  /** @type {"" | "b" | "#"} */
  let accidental = "";
  if (diff === 1) accidental = "#";
  else if (diff === -1) accidental = "b";
  else if (diff === 2) accidental = "#"; // double-sharp rare; degenerate
  else if (diff === -2) accidental = "b";

  return { degree, accidental };
}

/** Major-scale semitone offsets from tonic, by degree 1..7. */
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
/** Natural-minor semitone offsets from tonic, by degree 1..7. */
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/**
 * Pitch class of degree `n` (1..7) in the song's key scale.
 * @param {Key} key
 * @param {number} degree
 * @returns {number}
 */
function diatonicPc(key, degree) {
  const steps = key.mode === "minor" ? MINOR_STEPS : MAJOR_STEPS;
  return (key.tonicPitchClass + steps[(degree - 1) % 7]) % 12;
}

/**
 * Parse a raw iReal chord symbol into a key-relative {@link Chord}.
 * @param {string} symbol  e.g. "F^7", "G7b9", "A-7/E", "Db^7"
 * @param {Key} key
 * @returns {Chord | null}
 */
export function parseChord(symbol, key) {
  const parts = splitChordSymbol(symbol);
  if (!parts) return null;
  const { degree, accidental } = rootToDegree(parts.letter, parts.acc, key);
  /** @type {Chord} */
  const chord = {
    degree,
    accidental,
    quality: normaliseQuality(parts.quality),
    raw: symbol,
  };
  if (parts.bassLetter) {
    const b = rootToDegree(parts.bassLetter, parts.bassAcc, key);
    chord.bass = { degree: b.degree, accidental: b.accidental };
  }
  return chord;
}

/**
 * Normalise a raw quality suffix. v1 keeps the iReal suffix verbatim
 * (it is already a compact, well-formed shorthand) but trims size hints
 * (`s`/`l`) which sometimes ride along, and maps the bare empty string to
 * "" (major). This is the documented hook for future canonicalisation.
 * @param {string} q
 * @returns {string}
 */
export function normaliseQuality(q) {
  return (q || "").replace(/[sl]/g, "");
}

/** Roman numeral glyphs (uppercase) by degree 1..7. */
const ROMAN_UPPER = ["I", "II", "III", "IV", "V", "VI", "VII"];

/**
 * Decide whether a chord's numeral should display lowercase (minor-ish).
 * @param {string} quality
 * @returns {boolean}
 */
function isLowerCaseQuality(quality) {
  // minor, minor7, min6, min-maj7, half-dim, dim → lowercase numeral.
  return /^(-|h|o)/.test(quality);
}

/**
 * Render a chord in Roman form, e.g. "Imaj7", "vi", "V7", "bVII7".
 * The accidental prefixes the numeral; minor/dim qualities lowercase it.
 * The quality suffix is appended in a readable form.
 * @param {Chord} chord
 * @returns {string}
 */
export function chordToRoman(chord) {
  let numeral = ROMAN_UPPER[(chord.degree - 1) % 7];
  if (isLowerCaseQuality(chord.quality)) numeral = numeral.toLowerCase();
  const suffix = romanQualitySuffix(chord.quality);
  let out = chord.accidental + numeral + suffix;
  if (chord.bass) {
    out += "/" + (chord.bass.accidental + ROMAN_UPPER[(chord.bass.degree - 1) % 7]);
  }
  return out;
}

/**
 * Map a normalised quality to the text shown after a Roman numeral.
 * The numeral case already conveys major/minor, so we strip the leading
 * "-"/"h"/"o" marker and render a readable suffix.
 * @param {string} q
 * @returns {string}
 */
function romanQualitySuffix(q) {
  if (q === "") return "";
  if (q === "-") return "";          // lowercase numeral already says minor
  if (q === "^") return "maj";
  if (q === "^7") return "maj7";
  if (q === "-7") return "7";        // numeral lowercased → "7" = min7
  if (q === "h7") return "ø7";  // ø7
  if (q === "h") return "ø";    // ø
  if (q === "o7") return "dim7";
  if (q === "o") return "dim";
  if (q === "+") return "+";
  // dom and everything else: show verbatim (e.g. "7", "7b9", "sus", "6").
  return q;
}

/**
 * Render a chord in absolute letter form for a key, e.g. "Cmaj7",
 * "Am7", "G7", "Bb7b9". The quality suffix follows common lead-sheet
 * conventions (^7 → "maj7", - → "m", h → "m7b5", o → "dim").
 * @param {Chord} chord
 * @param {Key} key
 * @returns {string}
 */
export function chordToLetter(chord, key) {
  const { letter, accidental } = spellDegree(chord.degree, chord.accidental, key);
  let out = letter + accidental + letterQualitySuffix(chord.quality);
  if (chord.bass) {
    const bs = spellDegree(chord.bass.degree, chord.bass.accidental, key);
    out += "/" + bs.letter + bs.accidental;
  }
  return out;
}

/**
 * Spell a (degree, accidental) pair as a letter + accidental. The LETTER
 * is fixed by the degree (so 7 above C is always a B-something), and the
 * accidental is the signed semitone difference between the chord root and
 * that letter's natural pitch — this yields correct enharmonic spelling
 * (Bb not A#, Eb not D#) regardless of the key's flat/sharp side.
 * @param {number} degree 1..7
 * @param {"" | "b" | "#"} accidental
 * @param {Key} key
 * @returns {{letter: string, accidental: string}}
 */
function spellDegree(degree, accidental, key) {
  const preferFlat = FLAT_TONIC_PCS.has(key.tonicPitchClass) || key.mode === "minor";
  const tonicLetter = spellPc(key.tonicPitchClass, preferFlat).letter;
  const letter = letterForDegree(tonicLetter, degree);
  const targetPc = degreePitchClass(degree, accidental, key);
  const naturalPc = LETTER_PC[/** @type {keyof typeof LETTER_PC} */ (letter)];
  let diff = ((targetPc - naturalPc + 6) % 12) - 6; // signed -6..5
  let acc = "";
  if (diff === 1) acc = "#";
  else if (diff === 2) acc = "##";
  else if (diff === -1) acc = "b";
  else if (diff === -2) acc = "bb";
  return { letter, accidental: acc };
}

/**
 * Absolute pitch class of a chord's root, given the key.
 * @param {Chord} chord
 * @param {Key} key
 * @returns {number}
 */
export function rootPitchClass(chord, key) {
  return degreePitchClass(chord.degree, chord.accidental, key);
}

/**
 * Pitch class of a (degree, accidental) pair within a key.
 * @param {number} degree
 * @param {"" | "b" | "#"} accidental
 * @param {Key} key
 * @returns {number}
 */
function degreePitchClass(degree, accidental, key) {
  let pc = diatonicPc(key, degree);
  if (accidental === "#") pc += 1;
  else if (accidental === "b") pc -= 1;
  return ((pc % 12) + 12) % 12;
}

/**
 * Map a normalised quality to a lead-sheet letter suffix.
 * @param {string} q
 * @returns {string}
 */
function letterQualitySuffix(q) {
  if (q === "") return "";
  if (q === "-") return "m";
  if (q === "^") return "maj7";   // iReal "^" alone means maj7 in practice
  if (q === "^7") return "maj7";
  if (q === "-7") return "m7";
  if (q === "h7") return "m7b5";
  if (q === "h") return "m7b5";
  if (q === "o7") return "dim7";
  if (q === "o") return "dim";
  if (q === "+") return "+";
  if (q === "6") return "6";
  if (q === "-6") return "m6";
  if (q.startsWith("-")) return "m" + q.slice(1); // -9, -11, -^7…
  return q; // dom family and extensions render verbatim (7, 7b9, sus, 9…)
}
