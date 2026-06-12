/**
 * Harmony data model: turns raw iReal songs into the structured form the
 * rest of the import feature consumes.
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`.
 *
 * A {@link Song} carries its key + time signature and a `progression`: the
 * ordered, repeat-preserving list of cells from {@link tokenizeBody}, with
 * every chord cell converted to ROMAN form (degree + accidental + quality)
 * relative to the song key. Structural markers (bars, sections, repeats,
 * endings, time-signature changes) are kept verbatim, so repeats are
 * honoured, not flattened.
 *
 * Progression cell shapes (the contract for downstream commits):
 *   { type: "chord", chord: Chord, raw: string }      // chord, key-relative
 *   { type: "chord", noChord: true }                  // explicit N.C.
 *   { type: "bar", barStyle: "single"|"double" }      // barline
 *   { type: "repeatOpen" } | { type: "repeatClose" }  // {  }
 *   { type: "ending", ending: number }                // N1 / N2 …
 *   { type: "sectionOpen", label: string }            // *A, *B, *i …
 *   { type: "timeSignature", timeSignature: [n,d] }   // mid-tune T-change
 *   { type: "repeatBar" } | { type: "repeatTwoBars" } | { type: "repeatLastBar" }
 *   { type: "empty" }                                 // XyQ blank cell
 *   { type: "barDivider" }                            // , beat divider
 *   { type: "end" }                                   // Z final barline
 *   { type: "comment", text } | { type: "segno" } | { type: "coda" }
 */

// @ts-check

import { parseChord, parseKey } from "./irealChord.js";
import {
  extractIrealPayload,
  splitPlaylist,
  tokenizeBody,
} from "./irealParse.js";

/**
 * @typedef {import("./irealChord.js").Chord} Chord
 * @typedef {import("./irealChord.js").Key} Key
 * @typedef {import("./irealParse.js").Cell} RawCell
 */

/**
 * @typedef {Object} Song
 * @property {string} title
 * @property {string} composer
 * @property {string} style
 * @property {Key} key
 * @property {[number, number]} timeSignature   [num, den]
 * @property {ProgressionCell[]} progression
 * @property {boolean} supported   false if the chart hits a v1 limitation.
 * @property {string[]} flags      human-readable reasons (empty if clean).
 */

/**
 * A progression cell: a chord, or a structural marker. See module header.
 * @typedef {ProgChord | ProgMarker} ProgressionCell
 */

/**
 * @typedef {Object} ProgChord
 * @property {"chord"} type
 * @property {Chord} [chord]      key-relative chord (absent for No-Chord)
 * @property {boolean} [noChord]  true for explicit N.C.
 * @property {string} [raw]       raw iReal symbol (debug)
 */

/**
 * @typedef {Object} ProgMarker
 * @property {string} type
 * @property {string} [barStyle]
 * @property {string} [label]
 * @property {number} [ending]
 * @property {[number, number]} [timeSignature]
 * @property {string} [text]
 */

/** v1 supports only 3/4 and 4/4 (denominator 4, numerator 3 or 4). */
function isSupportedTimeSignature(/** @type {[number, number]} */ ts) {
  return ts[1] === 4 && (ts[0] === 3 || ts[0] === 4);
}

/**
 * Build a {@link Song} from a raw iReal song (already de-scrambled body).
 *
 * @param {import("./irealParse.js").RawSong} raw
 * @returns {Song}
 */
export function buildSong(raw) {
  /** @type {string[]} */
  const flags = [];

  const key = parseKey(raw.key);
  /** @type {Key} */
  const safeKey = key || { tonicPitchClass: 0, mode: "major" };
  if (!key) flags.push(`unparseable key field: ${JSON.stringify(raw.key)}`);

  const cells = tokenizeBody(raw.body);

  // Time signature: first one found in the body, else default 4/4.
  /** @type {[number, number]} */
  let timeSignature = [4, 4];
  let sawTs = false;
  let tsCount = 0;
  for (const c of cells) {
    if (c.type === "timeSignature" && c.timeSignature) {
      tsCount += 1;
      if (!sawTs) {
        timeSignature = c.timeSignature;
        sawTs = true;
      }
    }
  }
  if (!sawTs) flags.push("no time signature in body; defaulted to 4/4");
  if (tsCount > 1) flags.push("multiple time signatures (mid-tune meter change)");

  let supported = true;
  if (sawTs && !isSupportedTimeSignature(timeSignature)) {
    supported = false;
    flags.push(`unsupported meter ${timeSignature[0]}/${timeSignature[1]} (v1: only 3/4, 4/4)`);
  }
  if (!key) supported = false;

  const progression = cells.map((c) => toProgressionCell(c, safeKey));

  return {
    title: raw.title,
    composer: raw.composer,
    style: raw.style,
    key: safeKey,
    timeSignature,
    progression,
    supported,
    flags,
  };
}

/**
 * Convert a raw tokenizer cell to a progression cell, resolving chords to
 * key-relative Roman form. Structural markers pass through unchanged.
 * @param {RawCell} c
 * @param {Key} key
 * @returns {ProgressionCell}
 */
function toProgressionCell(c, key) {
  if (c.type === "chord") {
    if (c.noChord) return { type: "chord", noChord: true };
    const chord = parseChord(c.symbol, key);
    if (!chord) {
      // Unparseable chord symbol: keep the raw for debugging, no Chord.
      return { type: "chord", raw: c.symbol };
    }
    return { type: "chord", chord, raw: c.symbol };
  }
  return /** @type {ProgMarker} */ (c);
}

/**
 * @typedef {Object} ParsedPlaylist
 * @property {string} name
 * @property {Song[]} songs
 */

/**
 * Parse a whole iReal Pro HTML export into a {@link ParsedPlaylist}.
 * (HTML reading happens by the caller; this takes the HTML string.)
 * @param {string} html
 * @returns {ParsedPlaylist | null} null if no irealb:// payload found.
 */
export function parsePlaylistHtml(html) {
  const payload = extractIrealPayload(html);
  if (payload == null) return null;
  return parsePlaylistPayload(payload);
}

/**
 * Parse a decoded irealb:// payload into a {@link ParsedPlaylist}.
 * @param {string} payload
 * @returns {ParsedPlaylist}
 */
export function parsePlaylistPayload(payload) {
  const { name, songs } = splitPlaylist(payload);
  return { name, songs: songs.map(buildSong) };
}
