/**
 * Harmony player.
 *
 * Turns a stored, FOLDED progression (the repeat-preserving cell list from
 * harmonyModel.js / harmonyScene.js) into a timed, REPEAT-HONOURING sequence
 * of chord spans, and answers "what chord is sounding at beat N, and what's
 * next" against a global beat clock.
 *
 * Two layers:
 *   - {@link expandProgression} + {@link harmonyAt}: PURE, deterministic
 *     functions. No DOM, no esm.sh, no Node built-ins — importable by a
 *     `node --test` and checkable by `node --check`. expandProgression
 *     traverses repeats/endings/similes to produce the PLAYED order; the
 *     stored progression itself stays folded (this expansion is internal to
 *     playback). harmonyAt is a pure function of (expanded, globalBeat, loop).
 *   - {@link HarmonyPlayer}: a thin holder that builds the expansion once for
 *     a scene.harmony and exposes getHarmonyAt(globalBeat, loop). Commit 4
 *     wires the firing context; here it is just exposed.
 *
 * Beat model. A bar lasts `beatsPerBar = timeSignature[0]` beats. Within a
 * bar, chords sit on beats: a chord lasts from its beat until the next chord
 * in the bar (or the bar end). `empty` (XyQ) cells are beats where the
 * previous chord continues; `barDivider` (,) separates beat positions. The
 * bar's beats are distributed across its chords by the actual beat positions
 * the cells imply (1 chord = whole bar; 2 chords typically split 2+2 in 4/4).
 */

// @ts-check

import { classifyNavComment, sequenceBars, stripEndingSpacers } from "./harmonyNavigation.js";

/**
 * @typedef {import("./harmonyModel.js").ProgressionCell} ProgressionCell
 * @typedef {import("./irealChord.js").Chord} Chord
 */

/**
 * A played chord span: a chord sounding over a half-open beat range
 * [startBeat, endBeat). `chord` is the key-relative Chord, or null for an
 * explicit No-Chord (N.C.) cell. `noChord` is true only for that N.C. case.
 * @typedef {Object} ChordSpan
 * @property {Chord | null} chord
 * @property {boolean} [noChord]
 * @property {number} startBeat   inclusive, beats from 0
 * @property {number} endBeat     exclusive, beats from 0
 * @property {string} [section]   section label opening at this bar; set only on
 *   the FIRST span of a bar that a `sectionOpen` marker precedes (used by the
 *   unwind to preserve the song's A/B sections).
 */

/**
 * @typedef {Object} ExpandedHarmony
 * @property {ChordSpan[]} spans
 * @property {number} totalBeats
 * @property {string[]} notes   non-fatal expansion notes (e.g. unmodelled nav)
 */

/**
 * A bar of the folded progression: the chord cells inside it (in order) plus
 * the simile marker if the bar is a repeat-bar placeholder.
 * @typedef {Object} FoldedBar
 * @property {ChordCellLite[]} chords   chord cells (possibly empty)
 * @property {number[]} beatPositions   slot index (0-based) each chord starts on
 * @property {boolean} hadEmpty   true if any `empty`/`barDivider` placed a chord
 *   on an explicit slot (so positions are authoritative); false means the bar's
 *   chords carry no explicit beat placement and should be spread evenly.
 * @property {"repeatBar" | "repeatTwoBars" | "repeatLastBar" | null} simile
 */

/**
 * @typedef {Object} ChordCellLite
 * @property {Chord | null} chord
 * @property {boolean} noChord
 */

/**
 * Group a flat, folded progression into bars, recording where each chord sits
 * within its bar so timing can be derived. Bars are delimited by `bar`,
 * `repeatOpen`, `repeatClose`, `ending`, `end` markers (any barline-ish
 * token). Structural markers other than chords are attached to the bar
 * sequence as control tokens so the expansion pass can honour repeats.
 *
 * Returns a flat list of "events": either a control marker (repeatOpen,
 * repeatClose, ending, sectionOpen, end, timeSignature) or a completed bar.
 * The expansion pass walks this list.
 *
 * @param {ProgressionCell[]} progression
 * @param {number} beatsPerBar
 * @returns {Array<{kind:"bar", bar: FoldedBar} | {kind:"marker", cell: ProgressionCell}>}
 */
function groupIntoBars(progression, beatsPerBar) {
  /** @type {Array<{kind:"bar", bar: FoldedBar} | {kind:"marker", cell: ProgressionCell}>} */
  const out = [];

  /** @type {ChordCellLite[]} */
  let chords = [];
  /** @type {number[]} */
  let beatPositions = [];
  /** @type {FoldedBar["simile"]} */
  let simile = null;
  // Slot cursor within the current bar. Each chord cell occupies the slot at
  // the cursor and advances it; an `empty` (XyQ) cell advances the cursor
  // (the previous chord holds that beat); a `barDivider` (,) also advances it
  // (pins the next chord onto the next beat). `hadEmpty` records whether any
  // empty/divider gave the bar explicit beat placement: if so, slot positions
  // are authoritative; if not, the chords carry no placement and are spread
  // evenly across the bar (iReal's default for adjacent chords).
  let beatCursor = 0;
  let hadEmpty = false;
  let barHasContent = false;

  const flushBar = () => {
    if (!barHasContent) return;
    out.push({ kind: "bar", bar: { chords, beatPositions, hadEmpty, simile } });
    chords = [];
    beatPositions = [];
    simile = null;
    beatCursor = 0;
    hadEmpty = false;
    barHasContent = false;
  };

  for (const cell of progression) {
    switch (cell.type) {
      case "chord": {
        barHasContent = true;
        chords.push({
          chord: cell.chord || null,
          noChord: cell.noChord === true,
        });
        beatPositions.push(beatCursor);
        beatCursor += 1;
        break;
      }
      case "empty": {
        // A blank beat: the previous chord continues. Advance the cursor so a
        // following chord in the same bar lands on the right beat.
        barHasContent = true;
        hadEmpty = true;
        beatCursor += 1;
        break;
      }
      case "barDivider": {
        // Beat separator within a bar: pin the next chord onto the next beat.
        hadEmpty = true;
        beatCursor += 1;
        break;
      }
      case "repeatBar":
      case "repeatTwoBars":
      case "repeatLastBar": {
        // A simile occupies its OWN bar. If the current bar already holds
        // chords (a common iReal idiom writes `C-7 XyQ Kcl` with no barline
        // before the Kcl, meaning "bar 1 = C-7, bar 2 = repeat bar 1"), flush
        // the chord bar first so the simile duplicates it as a fresh bar.
        if (chords.length > 0) flushBar();
        barHasContent = true;
        simile = cell.type;
        break;
      }
      case "bar":
      case "repeatOpen":
      case "repeatClose":
      case "ending":
      case "end":
      case "sectionOpen":
      case "timeSignature": {
        // Barline-ish: close the current bar, then emit the control marker.
        flushBar();
        out.push({ kind: "marker", cell });
        break;
      }
      case "coda":
        // A coda sign (§Q). Whether the TO-CODA jump PLAYS this bar depends on where
        // the sign sits relative to the bar's chords: AFTER them (`C §Q |` — iReal's
        // common case, the sign at the bar END → play the bar, then jump) vs BEFORE
        // any content (`§Q C |` — the sign at the bar START → jump before playing).
        // `afterContent` records which, for sequenceBars to honour.
        out.push({ kind: "marker", cell, afterContent: barHasContent });
        break;
      default:
        // comment, segno and anything else: no timing effect here.
        // (segno nav is noted by the expansion pass, not the grouper.)
        out.push({ kind: "marker", cell });
        break;
    }
  }
  flushBar();
  return out;
}

/**
 * Distribute `beatsPerBar` beats across a bar's chords, producing relative
 * [start,end) ranges (in beats) for each chord. A bar with no chords yields no
 * ranges. One chord = whole bar.
 *
 * Two modes:
 *   - `hadEmpty` true: the chords carry EXPLICIT beat placement (empty cells /
 *     barDividers pinned them). Each chord runs from its slot until the next
 *     chord's slot, the last until the bar end. So [0,2] in 4/4 splits 2+2,
 *     [0,1] splits 1+3.
 *   - `hadEmpty` false: the chords carry NO placement (e.g. two adjacent
 *     chords `F^7 Ab7`). They are spread EVENLY across the bar — iReal's
 *     default — so two chords in 4/4 split 2+2, three split as evenly as the
 *     beat grid allows (e.g. 2+1+1).
 *
 * @param {FoldedBar} bar
 * @param {number} beatsPerBar
 * @returns {Array<{ cell: ChordCellLite, start: number, end: number }>}
 */
function barChordRanges(bar, beatsPerBar) {
  const n = bar.chords.length;
  if (n === 0) return [];
  /** @type {Array<{ cell: ChordCellLite, start: number, end: number }>} */
  const ranges = [];

  if (!bar.hadEmpty) {
    // Even spread: chord i runs [floor(i*B/n), floor((i+1)*B/n)). Guarantees
    // contiguous coverage of the whole bar and a minimum one-beat width when
    // chords <= beats; if chords > beats, later chords collapse to zero width
    // and are dropped (an over-full bar — rare, keeps timing monotonic).
    for (let i = 0; i < n; i++) {
      const start = Math.floor((i * beatsPerBar) / n);
      const end = i + 1 < n ? Math.floor(((i + 1) * beatsPerBar) / n) : beatsPerBar;
      if (end <= start) continue; // over-full bar: drop the zero-width chord
      ranges.push({ cell: bar.chords[i], start, end });
    }
    if (ranges.length === 0) {
      ranges.push({ cell: bar.chords[0], start: 0, end: beatsPerBar });
    } else {
      ranges[ranges.length - 1].end = beatsPerBar;
    }
    return ranges;
  }

  // Explicit placement from slot positions.
  for (let i = 0; i < n; i++) {
    let start = bar.beatPositions[i];
    if (start >= beatsPerBar) start = beatsPerBar - 1; // clamp overfull bars
    let end;
    if (i + 1 < n) {
      end = bar.beatPositions[i + 1];
      if (end > beatsPerBar) end = beatsPerBar;
      if (end <= start) end = start + 1; // ensure forward progress
    } else {
      end = beatsPerBar;
    }
    ranges.push({ cell: bar.chords[i], start, end });
  }
  // Guard: ensure the final chord reaches the bar end and ranges are sane.
  ranges[ranges.length - 1].end = beatsPerBar;
  return ranges;
}

/**
 * Append a folded bar's chord spans to `spans`, starting at absolute beat
 * `barStartBeat`. Returns the absolute beat at which the bar ends.
 * `lastEmittedBars` is the running history of fully-resolved bars (each as an
 * array of {cell,start,end} relative ranges) so similes can duplicate them.
 *
 * @param {ChordSpan[]} spans
 * @param {FoldedBar} bar
 * @param {number} barStartBeat
 * @param {number} beatsPerBar
 * @param {Array<Array<{cell: ChordCellLite, start: number, end: number}>>} history
 * @param {string | null} [section]  label to tag onto this bar's first span
 * @returns {number}
 */
function emitBar(spans, bar, barStartBeat, beatsPerBar, history, section = null) {
  const startLen = spans.length;
  const tag = () => {
    if (section != null && spans.length > startLen) {
      spans[startLen].section = section;
    }
  };
  /** @type {Array<{cell: ChordCellLite, start: number, end: number}>} */
  let ranges;
  if (bar.simile === "repeatLastBar" || bar.simile === "repeatBar") {
    ranges = history.length ? cloneRanges(history[history.length - 1]) : [];
  } else if (bar.simile === "repeatTwoBars") {
    // r duplicates the previous TWO bars. Emit the bar two-back first, then
    // the bar one-back, each as its own bar.
    const twoBack = history.length >= 2 ? history[history.length - 2] : null;
    const oneBack = history.length >= 1 ? history[history.length - 1] : null;
    let cursor = barStartBeat;
    if (twoBack) {
      cursor = emitRanges(spans, twoBack, cursor, beatsPerBar);
      history.push(cloneRanges(twoBack));
    }
    if (oneBack) {
      cursor = emitRanges(spans, oneBack, cursor, beatsPerBar);
      history.push(cloneRanges(oneBack));
    }
    tag();
    return cursor;
  } else {
    ranges = barChordRanges(bar, beatsPerBar);
  }
  const end = emitRanges(spans, ranges, barStartBeat, beatsPerBar);
  history.push(cloneRanges(ranges));
  tag();
  return end;
}

/** @param {Array<{cell: ChordCellLite, start: number, end: number}>} ranges */
function cloneRanges(ranges) {
  return ranges.map((r) => ({ cell: r.cell, start: r.start, end: r.end }));
}

/**
 * Emit a bar's relative ranges as absolute spans. A bar with no chords emits
 * nothing (silent bar) but still consumes its beats via the caller's cursor.
 * @param {ChordSpan[]} spans
 * @param {Array<{cell: ChordCellLite, start: number, end: number}>} ranges
 * @param {number} barStartBeat
 * @param {number} beatsPerBar
 * @returns {number}
 */
function emitRanges(spans, ranges, barStartBeat, beatsPerBar) {
  for (const r of ranges) {
    spans.push({
      chord: r.cell.noChord ? null : r.cell.chord,
      noChord: r.cell.noChord,
      startBeat: barStartBeat + r.start,
      endBeat: barStartBeat + r.end,
    });
  }
  return barStartBeat + beatsPerBar;
}

/**
 * Expand a folded progression into the played order, honouring repeats,
 * endings, and similes. The stored progression stays folded; this expansion
 * is internal to playback.
 *
 * Repeat handling: a `{ … }` block (repeatOpen … repeatClose) plays for the
 * specified number of passes (default 2, or a `<Nx>` override). First/second
 * endings (N1, N2 …) select which tail plays on which pass. A
 * `repeatBar`/`repeatTwoBars`/`repeatLastBar` simile duplicates the referenced
 * bar(s).
 *
 * Navigation (segno / coda / D.C. / D.S. / Fine, encoded in iReal comment text)
 * is honoured: the chart expands to its FULL authored length. The play ORDER —
 * repeats, endings AND jumps — is computed by the shared {@link sequenceBars}
 * engine, the same one the chart cursor drives, so sound and highlight agree.
 *
 * Meter may change mid-tune (a `timeSignature` marker); each bar carries its own
 * beat count, mirroring the chart layout so the two stay beat-for-beat aligned.
 *
 * @param {ProgressionCell[]} progression
 * @param {[number, number]} timeSignature
 * @returns {ExpandedHarmony}
 */
export function expandProgression(progression, timeSignature) {
  // Drop iReal's 2nd-ending alignment spacer up front (shared with the chart
  // layout) so audio and the displayed/cursored chart see the same bars.
  const { structBars, foldedBars, barBeats, sections } =
    collectFoldedBars(stripEndingSpacers(progression), timeSignature);

  /** @type {string[]} */
  const notes = [];

  // Play order through repeats, endings and navigation (shared engine).
  const seq = sequenceBars(structBars);
  for (const m of seq.notes) notes.push(m);

  // Emit chord spans in play order, advancing the absolute beat cursor with each
  // bar's own meter; `history` lets similes duplicate the previously-played bar.
  /** @type {ChordSpan[]} */
  const spans = [];
  /** @type {Array<Array<{cell: ChordCellLite, start: number, end: number}>>} */
  const history = [];
  let beat = 0;
  for (const idx of seq.order) {
    beat = emitBar(spans, foldedBars[idx], beat, barBeats[idx], history, sections[idx]);
  }

  return { spans, totalBeats: beat, notes };
}

/**
 * Group a folded progression into bars and, in one pass, derive the parallel
 * arrays the sequencer + emitter need: structural flags per bar (for play
 * order, via the shared {@link sequenceBars}), the FoldedBar payload, the
 * per-bar beat count (meter can change mid-tune), and the section label (for
 * the unwind's section recovery).
 *
 * The bar GROUPING and the pending-decoration model here mirror
 * harmonyChartLayout.layoutChart exactly, so the audio bar list and the chart
 * bar list line up one-for-one — the precondition for the cursor and the sound
 * to agree.
 *
 * @param {ProgressionCell[]} progression
 * @param {[number, number]} timeSignature
 * @returns {{ structBars: import("./harmonyNavigation.js").StructBar[], foldedBars: FoldedBar[], barBeats: number[], sections: Array<string | null> }}
 */
export function collectFoldedBars(progression, timeSignature) {
  const startBeats = Math.max(1, Math.round(timeSignature[0]) || 4);
  const events = groupIntoBars(progression, startBeats);

  /** @type {import("./harmonyNavigation.js").StructBar[]} */
  const structBars = [];
  /** @type {FoldedBar[]} */
  const foldedBars = [];
  /** @type {number[]} */
  const barBeats = [];
  /** @type {Array<string | null>} */
  const sections = [];

  let runningBeats = startBeats;
  /**
   * Decorations awaiting the next bar that flushes (mirrors the layout's
   * pending model so the two bar lists line up).
   * @type {{ repeatOpen?: boolean, ending?: number, segno?: boolean, coda?: boolean, fine?: boolean, nav?: any, section?: string | null, passes?: number }}
   */
  let pending = {};
  /** structBars indices of currently-open repeat blocks, for `<Nx>` counts. */
  /** @type {number[]} */
  const openRepeats = [];

  for (const ev of events) {
    if (ev.kind === "bar") {
      /** @type {import("./harmonyNavigation.js").StructBar} */
      const flags = {};
      if (pending.repeatOpen) flags.repeatOpen = true;
      if (pending.ending !== undefined) flags.ending = pending.ending;
      if (pending.segno) flags.segno = true;
      if (pending.coda) flags.coda = true;
      if (pending.codaAfter) flags.codaAfter = true;
      if (pending.fine) flags.fine = true;
      if (pending.nav) flags.nav = pending.nav;
      // A `<Nx>` seen before this repeat-open bar flushed (e.g. a one-bar
      // `{ … <6x> }`) was stashed as pending.passes; apply it to the opening bar.
      if (pending.passes !== undefined && flags.repeatOpen) flags.passes = pending.passes;
      structBars.push(flags);
      foldedBars.push(ev.bar);
      barBeats.push(runningBeats);
      sections.push(pending.section !== undefined ? pending.section : null);
      if (flags.repeatOpen) openRepeats.push(structBars.length - 1);
      pending = {};
      continue;
    }

    const cell = ev.cell;
    switch (cell.type) {
      case "repeatOpen": pending.repeatOpen = true; break;
      case "ending": pending.ending = typeof cell.ending === "number" ? cell.ending : 1; break;
      case "segno": pending.segno = true; break;
      case "coda":
        pending.coda = true;
        // Sign at the bar END (chords already in the bar) → its bar is played before
        // the To-Coda jump; sign at the bar START → jump before playing it.
        if (ev.afterContent) pending.codaAfter = true;
        break;
      case "sectionOpen":
        pending.section = typeof cell.label === "string" ? cell.label : null;
        break;
      case "timeSignature": {
        const ts = cell.timeSignature;
        const n = Array.isArray(ts) ? ts[0] : NaN;
        runningBeats = Number.isFinite(n) && n > 0 ? Math.round(n) : runningBeats;
        break;
      }
      case "repeatClose":
        if (structBars.length > 0) structBars[structBars.length - 1].repeatClose = true;
        openRepeats.pop();
        break;
      case "comment": {
        const nav = classifyNavComment(cell.text || "");
        if (nav) {
          if (nav.kind === "jump") pending.nav = { from: nav.from, target: nav.target };
          else if (nav.kind === "fine") pending.fine = true;
          else if (nav.kind === "repeat") {
            // Attach to the enclosing open repeat if its bar has flushed; else
            // stash for the repeat-open bar still being accumulated (a `<Nx>`
            // sitting between `{` and the bar's first barline).
            const oi = openRepeats[openRepeats.length - 1];
            if (oi !== undefined) structBars[oi].passes = nav.times;
            else pending.passes = nav.times;
          }
        }
        break;
      }
      default:
        break; // end, bar — no structural effect here
    }
  }

  return { structBars, foldedBars, barBeats, sections };
}

/**
 * The harmony query result.
 * @typedef {Object} HarmonyAtResult
 * @property {Chord | null} current        chord sounding at globalBeat (null if N.C. or ended)
 * @property {boolean} [currentNoChord]    true when current is an explicit N.C.
 * @property {number | null} currentStartBeat
 * @property {number | null} currentEndBeat
 * @property {number | null} beatsToNext   currentEndBeat - globalBeat (null if ended)
 * @property {Chord | null} next           chord of the following span (wraps on loop seam)
 * @property {Chord | null} nextAfter      chord two spans ahead (for deeper lookahead)
 */

/**
 * Answer "what chord is sounding at `globalBeat`, and what's next" against an
 * expanded harmony. Pure and deterministic — a function of
 * (expanded, globalBeat, loop) only.
 *
 *   - `current` = the chord of the span containing globalBeat.
 *   - `next` / `nextAfter` = the chords of the following one / two spans.
 *   - `beatsToNext` = currentEndBeat - globalBeat.
 *   - loop=true wraps with `globalBeat mod totalBeats`, and lookahead WRAPS
 *     ACROSS THE LOOP SEAM: when current is the last span, next/nextAfter come
 *     from the start of the piece (so a walking bass can lead back into bar 1).
 *   - loop=false past totalBeats: current is null (ended); next/nextAfter null.
 *
 * @param {ExpandedHarmony} expanded
 * @param {number} globalBeat
 * @param {{ loop?: boolean }} [opts]
 * @returns {HarmonyAtResult}
 */
export function harmonyAt(expanded, globalBeat, opts = {}) {
  const loop = opts.loop === true;
  const { spans, totalBeats } = expanded;

  /** @type {HarmonyAtResult} */
  const ended = {
    current: null,
    currentStartBeat: null,
    currentEndBeat: null,
    beatsToNext: null,
    next: null,
    nextAfter: null,
  };

  if (spans.length === 0 || totalBeats <= 0) return ended;

  let beat = globalBeat;
  if (loop) {
    beat = ((globalBeat % totalBeats) + totalBeats) % totalBeats;
  } else if (globalBeat < 0 || globalBeat >= totalBeats) {
    return ended;
  }

  let idx = findSpanIndex(spans, beat);
  if (idx === -1) return ended;

  // Boundary snap. A beat onset lands a few thousandths of a beat EARLY
  // (simulation beat-firing jitter places a downbeat just shy of the integer
  // beat). Without a snap, a downbeat that coincides with a chord change falls
  // in the tail of the OUTGOING span: beatsToNext ≈ 0 clamps the note to the
  // 0.02-beat floor (an ~11 ms click) AND it sounds the wrong (outgoing) chord.
  // When the onset is within BOUNDARY_EPS of this span's end, treat it as the
  // start of the NEXT chord, so the note gets that chord and its full length.
  const BOUNDARY_EPS = 1 / 32; // beats — far above the jitter, below any real note
  if (spans[idx].endBeat - beat <= BOUNDARY_EPS) {
    idx = loop ? (idx + 1) % spans.length : Math.min(idx + 1, spans.length - 1);
    beat = spans[idx].startBeat;
  }

  const cur = spans[idx];
  const nextIdx = idx + 1;

  // Lookahead. On loop, wrap span indices modulo span count so the last
  // span's next/nextAfter come from the piece start (the loop-seam lookahead).
  const nextSpan = pickSpan(spans, nextIdx, loop);
  const nextAfterSpan = pickSpan(spans, nextIdx + 1, loop);

  return {
    current: cur.noChord ? null : cur.chord,
    currentNoChord: cur.noChord === true,
    currentStartBeat: cur.startBeat,
    currentEndBeat: cur.endBeat,
    beatsToNext: cur.endBeat - beat,
    next: nextSpan ? (nextSpan.noChord ? null : nextSpan.chord) : null,
    nextAfter: nextAfterSpan ? (nextAfterSpan.noChord ? null : nextAfterSpan.chord) : null,
  };
}

/**
 * Pick a span by index, wrapping modulo length when loop is true; returns null
 * past the end when loop is false.
 * @param {ChordSpan[]} spans
 * @param {number} index
 * @param {boolean} loop
 * @returns {ChordSpan | null}
 */
function pickSpan(spans, index, loop) {
  if (index < spans.length) return spans[index];
  if (!loop) return null;
  return spans[index % spans.length];
}

/**
 * Binary-search the span whose half-open [startBeat, endBeat) contains `beat`.
 * Spans are contiguous and sorted by startBeat. Returns -1 if none (shouldn't
 * happen for an in-range beat).
 * @param {ChordSpan[]} spans
 * @param {number} beat
 * @returns {number}
 */
function findSpanIndex(spans, beat) {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = spans[mid];
    if (beat < s.startBeat) hi = mid - 1;
    else if (beat >= s.endBeat) lo = mid + 1;
    else return mid;
  }
  // Fallback for beats that fall in a gap (e.g. a silent bar): clamp to the
  // last span starting at or before the beat.
  for (let k = spans.length - 1; k >= 0; k--) {
    if (spans[k].startBeat <= beat) return k;
  }
  return -1;
}

/**
 * Thin engine layer: build the expansion for a scene.harmony once, then answer
 * getHarmonyAt(globalBeat, loop) queries. Commit 4 wires the firing context;
 * main.js can build this on scene load and query it.
 */
export class HarmonyPlayer {
  /**
   * @param {import("./harmonyScene.js").SceneHarmony | null} sceneHarmony
   */
  constructor(sceneHarmony) {
    /** @type {import("./harmonyScene.js").SceneHarmony | null} */
    this._harmony = sceneHarmony;
    /** @type {ExpandedHarmony | null} */
    this._expanded = null;
    if (sceneHarmony) {
      const ts = Array.isArray(sceneHarmony.timeSignature)
        ? /** @type {[number, number]} */ (sceneHarmony.timeSignature)
        : [4, 4];
      this._expanded = expandProgression(
        /** @type {ProgressionCell[]} */ (sceneHarmony.progression),
        ts,
      );
    }
  }

  /** @returns {boolean} true when a progression was loaded and expanded. */
  get hasHarmony() {
    return this._expanded !== null && this._expanded.spans.length > 0;
  }

  /** @returns {ExpandedHarmony | null} the expansion (for inspection/tests). */
  get expanded() {
    return this._expanded;
  }

  /** @returns {number} total played beats (0 when no harmony). */
  get totalBeats() {
    return this._expanded ? this._expanded.totalBeats : 0;
  }

  /** @returns {string[]} non-fatal expansion notes. */
  get notes() {
    return this._expanded ? this._expanded.notes : [];
  }

  /**
   * Query the harmony at a global beat. Returns an "ended" result shape when
   * no harmony is loaded.
   * @param {number} globalBeat
   * @param {boolean} loop
   * @returns {HarmonyAtResult}
   */
  getHarmonyAt(globalBeat, loop) {
    if (!this._expanded) {
      return {
        current: null,
        currentStartBeat: null,
        currentEndBeat: null,
        beatsToNext: null,
        next: null,
        nextAfter: null,
      };
    }
    return harmonyAt(this._expanded, globalBeat, { loop });
  }
}

/**
 * Convenience: build a HarmonyPlayer from a Scene's `harmony` field.
 * @param {{ harmony: import("./harmonyScene.js").SceneHarmony | null }} scene
 * @returns {HarmonyPlayer}
 */
export function buildHarmonyPlayer(scene) {
  return new HarmonyPlayer(scene ? scene.harmony : null);
}
