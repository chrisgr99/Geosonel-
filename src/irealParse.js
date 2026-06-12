/**
 * iReal Pro playlist + chart parsing.
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`. (The HTML file read
 * itself lives in the local validation script, not here.)
 *
 * Pipeline (verified against a real 1460-tune export):
 *   1. extract the irealb:// URL from HTML
 *   2. decodeURIComponent the part after irealb://
 *   3. split songs on "===" (last element is the playlist name)
 *   4. split each song's fields on /=+/ → [title, composer, style, key, body]
 *   5. strip the "1r34LbKcu7" body prefix, then unscramble (obfusc50)
 *   6. tokenize the de-scrambled body into a STRUCTURED progression that
 *      PRESERVES repeats, endings, section markers and time signatures.
 *
 * Token vocabulary follows the ireal-reader reference parser (Parser.js),
 * validated against the real data, but — unlike that parser — we do NOT
 * flatten/unwrap repeats: the structure keeps them as explicit markers.
 */

// @ts-check

/** Body prefix prepended to every scrambled chart. */
const BODY_PREFIX = "1r34LbKcu7";

/**
 * @typedef {Object} RawSong
 * @property {string} title
 * @property {string} composer
 * @property {string} style
 * @property {string} key            Raw iReal key field, e.g. "C", "A-".
 * @property {string} body           De-scrambled chord body.
 */

/**
 * Extract the (decoded) irealb:// payload from an HTML export string.
 * @param {string} html
 * @returns {string | null} the decoded payload, or null if none found.
 */
export function extractIrealPayload(html) {
  const m = html.match(/irealb:\/\/[^"']+/);
  if (!m) return null;
  return decodeURIComponent(m[0].slice("irealb://".length));
}

/**
 * One 50-char obfuscation block: swap chars 0..4 with 49..45 (reversed)
 * and 10..23 with 39..26 (reversed). (Public iReal de-obfuscation.)
 * @param {string} b  exactly 50 chars
 * @returns {string}
 */
function obfusc50(b) {
  const r = b.split("");
  for (let i = 0; i < 5; i++) {
    r[i] = b[49 - i];
    r[49 - i] = b[i];
  }
  for (let i = 10; i < 24; i++) {
    r[i] = b[49 - i];
    r[49 - i] = b[i];
  }
  return r.join("");
}

/**
 * De-scramble a chart body: process in 50-char blocks; a trailing
 * remainder shorter than 50 is left as-is.
 * @param {string} s
 * @returns {string}
 */
export function unscramble(s) {
  let out = "";
  while (s.length > 50) {
    out += obfusc50(s.slice(0, 50));
    s = s.slice(50);
  }
  return out + s;
}

/**
 * Split a decoded payload into raw songs (title/composer/style/key/body)
 * plus the playlist name. Fields are split on /=+/ so empty fields between
 * adjacent "=" collapse to nothing and the positional mapping stays stable.
 *
 * @param {string} payload  decoded irealb:// payload
 * @returns {{ name: string, songs: RawSong[] }}
 */
export function splitPlaylist(payload) {
  const chunks = payload.split("===");
  const name = chunks.length > 1 ? chunks[chunks.length - 1] : "";
  const songChunks = chunks.length > 1 ? chunks.slice(0, -1) : chunks;
  const songs = [];
  for (const chunk of songChunks) {
    if (!chunk.trim()) continue;
    songs.push(splitSong(chunk));
  }
  return { name, songs };
}

/**
 * Split one song chunk into its raw fields and de-scramble the body.
 * @param {string} chunk
 * @returns {RawSong}
 */
export function splitSong(chunk) {
  const f = chunk.split(/=+/);
  const title = (f[0] || "").trim();
  const composer = (f[1] || "").trim();
  const style = (f[2] || "").trim();
  const key = (f[3] || "").trim();
  let body = f[4] || "";
  if (body.startsWith(BODY_PREFIX)) body = body.slice(BODY_PREFIX.length);
  return { title, composer, style, key, body: unscramble(body) };
}

/* ----------------------------------------------------------------------
 * Structured tokenizer.
 *
 * We walk the de-scrambled body left-to-right with an ordered rule list
 * (longest/most-specific tokens first), emitting structural markers and
 * chord cells into a flat, ordered `cells` array. Repeats, endings and
 * sections are PRESERVED as markers; nothing is unwrapped.
 * -------------------------------------------------------------------- */

/**
 * A single entry in the structured progression. Discriminated by `type`.
 *
 * @typedef {ChordCell | StructuralMarker} Cell
 */

/**
 * @typedef {Object} ChordCell
 * @property {"chord"} type
 * @property {string} symbol     Raw iReal chord symbol (root+quality+/bass),
 *                               or "n" for a No-Chord (N.C.) cell.
 * @property {boolean} [noChord] true for an explicit No-Chord cell.
 */

/**
 * @typedef {Object} StructuralMarker
 * @property {"bar" | "sectionOpen" | "repeatOpen" | "repeatClose"
 *   | "ending" | "end" | "timeSignature" | "repeatBar" | "repeatTwoBars"
 *   | "repeatLastBar" | "empty" | "barDivider" | "comment" | "segno"
 *   | "coda"} type
 * @property {string} [barStyle]  for type "bar": "single" | "double" | "open"
 * @property {string} [label]     for "sectionOpen": the section letter (A,B,i,v…)
 * @property {number} [ending]    for "ending": 1, 2, 3…
 * @property {[number, number]} [timeSignature]  for "timeSignature"
 * @property {string} [text]      for "comment"
 */

/**
 * Tokenize a de-scrambled chord body into a structured, repeat-preserving
 * list of cells. The order follows ireal-reader's rule precedence so that
 * multi-char control tokens are matched before the single-char chord regex.
 *
 * @param {string} body
 * @returns {Cell[]}
 */
export function tokenizeBody(body) {
  /** @type {Cell[]} */
  const cells = [];
  let s = body;

  // chord regex: root A-G (or W = repeat-last-root), quality chars, opt /bass
  const chordRe = /^[A-GW][+\-^\dhob#suadlt]*(?:\/[A-G][#b]?)?/;

  // The "invisible slash chord" token W means "same root + quality as the
  // previous chord" (ireal-reader: pushChordInMeasures). Track the last
  // emitted chord's root+quality (sans its own bass) so a leading W resolves.
  let lastChordHead = "";

  let guard = 0;
  while (s.length > 0) {
    if (++guard > 100000) break; // pathological safety

    // Whitespace and the small/large size hints carry no content.
    if (s[0] === " " || s[0] === "s" || s[0] === "l") {
      s = s.slice(1);
      continue;
    }

    // --- multi-char / specific tokens first ---
    if (s.startsWith("XyQ")) {
      cells.push({ type: "empty" });
      s = s.slice(3);
      continue;
    }
    if (s.startsWith("Kcl")) {
      cells.push({ type: "repeatLastBar" });
      s = s.slice(3);
      continue;
    }
    if (s.startsWith("LZ")) {
      cells.push({ type: "bar", barStyle: "single" });
      s = s.slice(2);
      continue;
    }
    {
      const sec = /^\*(\w)/.exec(s);
      if (sec) {
        cells.push({ type: "sectionOpen", label: sec[1] });
        s = s.slice(sec[0].length);
        continue;
      }
    }
    {
      const cmt = /^<(.*?)>/.exec(s);
      if (cmt) {
        cells.push({ type: "comment", text: cmt[1] });
        s = s.slice(cmt[0].length);
        continue;
      }
    }
    {
      const ts = /^T(\d)(\d)/.exec(s);
      if (ts) {
        cells.push({
          type: "timeSignature",
          timeSignature: [Number(ts[1]), Number(ts[2])],
        });
        s = s.slice(ts[0].length);
        continue;
      }
    }
    {
      const end = /^N(\d)/.exec(s);
      if (end) {
        cells.push({ type: "ending", ending: Number(end[1]) });
        s = s.slice(end[0].length);
        continue;
      }
    }
    {
      const ys = /^Y+/.exec(s); // vertical spacers — no content
      if (ys) {
        s = s.slice(ys[0].length);
        continue;
      }
    }

    // --- single-char control tokens ---
    const c = s[0];
    if (c === "x") {
      cells.push({ type: "repeatBar" });
      s = s.slice(1);
      continue;
    }
    if (c === "r") {
      cells.push({ type: "repeatTwoBars" });
      s = s.slice(1);
      continue;
    }
    if (c === "n") {
      cells.push({ type: "chord", symbol: "n", noChord: true });
      s = s.slice(1);
      continue;
    }
    if (c === "{") {
      cells.push({ type: "repeatOpen" });
      s = s.slice(1);
      continue;
    }
    if (c === "}") {
      cells.push({ type: "repeatClose" });
      s = s.slice(1);
      continue;
    }
    if (c === "[") {
      cells.push({ type: "bar", barStyle: "double" });
      s = s.slice(1);
      continue;
    }
    if (c === "]") {
      cells.push({ type: "bar", barStyle: "double" });
      s = s.slice(1);
      continue;
    }
    if (c === "|") {
      cells.push({ type: "bar", barStyle: "single" });
      s = s.slice(1);
      continue;
    }
    if (c === "Z") {
      cells.push({ type: "end" });
      s = s.slice(1);
      continue;
    }
    if (c === ",") {
      cells.push({ type: "barDivider" });
      s = s.slice(1);
      continue;
    }
    if (c === "S") {
      cells.push({ type: "segno" });
      s = s.slice(1);
      continue;
    }
    if (c === "Q") {
      cells.push({ type: "coda" });
      s = s.slice(1);
      continue;
    }
    if (c === "U" || c === "p") {
      // U = player ending marker, p = pause slash — no harmonic content.
      s = s.slice(1);
      continue;
    }

    // --- chord ---
    const chord = chordRe.exec(s);
    if (chord) {
      let symbol = chord[0];
      if (symbol[0] === "W") {
        // Resolve W to the previous chord's root+quality, keeping any
        // bass that follows this token (e.g. "W/C" → "<lastHead>/C").
        const rest = symbol.slice(1);
        symbol = lastChordHead + rest;
      } else {
        // Remember root+quality (strip this chord's own slash bass).
        lastChordHead = symbol.split("/")[0];
      }
      cells.push({ type: "chord", symbol });
      s = s.slice(chord[0].length);
      continue;
    }

    // Unknown char — skip one and continue (matches ireal-reader fallback).
    s = s.slice(1);
  }

  return cells;
}
