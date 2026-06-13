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
      default:
        // comment, segno, coda and anything else: no timing effect here.
        // (segno/coda nav is noted by the expansion pass, not the grouper.)
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
 * @returns {number}
 */
function emitBar(spans, bar, barStartBeat, beatsPerBar, history) {
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
    return cursor;
  } else {
    ranges = barChordRanges(bar, beatsPerBar);
  }
  const end = emitRanges(spans, ranges, barStartBeat, beatsPerBar);
  history.push(cloneRanges(ranges));
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
 * specified number of passes (iReal does not store a pass count in the cell
 * model, so default 2). First/second endings (N1, N2 …) select which tail
 * plays on which pass: a bar after an `ending: k` marker plays only on pass
 * k (and, for the highest-numbered ending, on any later pass). A
 * `repeatBar`/`repeatTwoBars`/`repeatLastBar` simile duplicates the
 * referenced bar(s).
 *
 * Unmodelled navigation (segno/coda/D.S./D.C.) is noted in `notes` and
 * otherwise skipped — expansion never crashes on it.
 *
 * @param {ProgressionCell[]} progression
 * @param {[number, number]} timeSignature
 * @returns {ExpandedHarmony}
 */
export function expandProgression(progression, timeSignature) {
  const beatsPerBar = Math.max(1, Math.round(timeSignature[0]) || 4);
  const events = groupIntoBars(progression, beatsPerBar);

  /** @type {ChordSpan[]} */
  const spans = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {Array<Array<{cell: ChordCellLite, start: number, end: number}>>} */
  const history = [];
  let beat = 0;

  // We process the event list with a manual index so a repeatClose can rewind
  // to its matching repeatOpen for additional passes.
  /**
   * A pending repeat frame: where the block started (event index just after
   * repeatOpen), how many passes total, and which pass we are on.
   * @type {Array<{ openIndex: number, totalPasses: number, pass: number }>}
   */
  const repeatStack = [];
  // The pass number of the most recently CLOSED repeat block. Endings that
  // live AFTER a repeatClose (e.g. a second ending N2) have no active frame,
  // so they read this to know which pass just finished.
  let lastClosedPass = 1;

  let i = 0;
  let guard = 0;
  while (i < events.length) {
    if (++guard > 1_000_000) {
      notes.push("expansion guard tripped (pathological repeat nesting)");
      break;
    }
    const ev = events[i];

    if (ev.kind === "marker") {
      const cell = ev.cell;
      switch (cell.type) {
        case "repeatOpen": {
          repeatStack.push({ openIndex: i + 1, totalPasses: 2, pass: 1 });
          break;
        }
        case "repeatClose": {
          const frame = repeatStack[repeatStack.length - 1];
          if (frame && frame.pass < frame.totalPasses) {
            frame.pass += 1;
            i = frame.openIndex;
            continue;
          }
          if (frame) {
            lastClosedPass = frame.pass;
            repeatStack.pop();
          }
          break;
        }
        case "ending": {
          // An ending marker: the bars that FOLLOW it belong to ending k.
          // If the current repeat pass doesn't match this ending, skip
          // forward past its bars (up to the next ending / repeatClose).
          // Inside the braces the active frame's pass governs; a trailing
          // ending after the close reads the just-closed pass.
          const frame = repeatStack[repeatStack.length - 1];
          const currentPass = frame ? frame.pass : lastClosedPass;
          const k = typeof cell.ending === "number" ? cell.ending : 1;
          if (!endingPlaysOnPass(k, currentPass, events, i)) {
            i = skipEndingBlock(events, i + 1);
            continue;
          }
          break;
        }
        case "segno":
        case "coda": {
          notes.push(`navigation marker '${cell.type}' not modelled; ignored`);
          break;
        }
        case "end":
        case "bar":
        case "sectionOpen":
        case "timeSignature":
        default:
          break;
      }
      i += 1;
      continue;
    }

    // A bar.
    beat = emitBar(spans, ev.bar, beat, beatsPerBar, history);
    i += 1;
  }

  return { spans, totalBeats: beat, notes };
}

/**
 * Whether ending `k` plays on the given repeat pass. The straightforward rule:
 * ending k plays on pass k. The HIGHEST-numbered ending in the block also
 * plays on any pass beyond it (so a 2-ending block: N1 on pass 1, N2 on pass
 * 2 and any later pass).
 *
 * @param {number} k
 * @param {number} pass
 * @param {Array<{kind:"bar", bar: FoldedBar} | {kind:"marker", cell: ProgressionCell}>} events
 * @param {number} endingIndex  index of this ending marker
 * @returns {boolean}
 */
function endingPlaysOnPass(k, pass, events, endingIndex) {
  if (k === pass) return true;
  // The highest-numbered ending in this ending-group is the final
  // destination; it also plays on any pass beyond its own number (covers a
  // repeat played more times than there are endings). The group spans
  // forward across the enclosing repeatClose (a second ending N2 lives AFTER
  // the `}`), stopping at the next repeatOpen or the end of the chart.
  let maxEnding = k;
  for (let j = endingIndex + 1; j < events.length; j++) {
    const e = events[j];
    if (e.kind === "marker") {
      if (e.cell.type === "repeatOpen") break;
      if (e.cell.type === "ending" && typeof e.cell.ending === "number") {
        if (e.cell.ending > maxEnding) maxEnding = e.cell.ending;
      }
    }
  }
  return k === maxEnding && pass > k;
}

/**
 * Skip past an ending block's bars: advance from `from` to the next ending
 * marker or repeatClose (exclusive), returning that index.
 * @param {Array<{kind:"bar", bar: FoldedBar} | {kind:"marker", cell: ProgressionCell}>} events
 * @param {number} from
 * @returns {number}
 */
function skipEndingBlock(events, from) {
  let j = from;
  while (j < events.length) {
    const e = events[j];
    if (e.kind === "marker"
      && (e.cell.type === "ending" || e.cell.type === "repeatClose")) {
      return j;
    }
    j += 1;
  }
  return j;
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

  const idx = findSpanIndex(spans, beat);
  if (idx === -1) return ended;

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
