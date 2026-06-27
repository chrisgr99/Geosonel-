/**
 * Chord-chart LAYOUT: turn a flat progression (harmonyModel cells) into a
 * list of BARS, each carrying its chord label(s) plus the structural
 * decorations (section label, open/close repeat marks, ending number) that
 * apply to it. This is the pure, DOM-free half of the Harmony tab's chart
 * display; src/harmonyPanel.js renders the returned bars to DOM.
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`.
 *
 * The progression is a flat ordered list of typed cells (see
 * harmonyModel.js): chord cells `{type:"chord", chord?, noChord?, raw?}`
 * and markers `bar` / `repeatOpen` / `repeatClose` / `ending` /
 * `sectionOpen` / `timeSignature` / `repeatBar` / `repeatTwoBars` /
 * `repeatLastBar` / `empty` / `barDivider` / `end` (plus `comment` /
 * `segno` / `coda`, which carry no harmonic content for the v1 chart).
 *
 * GROUPING. A "bar" is the run of chord/slot content between barlines.
 * Barlines (`bar`, `repeatClose`, `end`) CLOSE the current bar. Markers
 * that precede a bar's content (`sectionOpen`, `repeatOpen`, `ending`,
 * `timeSignature`) are PENDING decorations: they attach to the next bar
 * that gets content. `repeatClose` both closes the current bar (flagging
 * its right edge) and, like a barline, starts a fresh one. This keeps the
 * musical structure visible without flattening repeats.
 *
 * BEATS. Each bar is tagged with a beat offset computed from the running
 * time signature (numerator beats per bar), so a later now-playing overlay
 * can map a global beat to a bar without re-walking the cells.
 */

// @ts-check

import { chordToLetter, chordToRoman } from "./irealChord.js";
import { classifyNavComment, sequenceBars, stripEndingSpacers } from "./harmonyNavigation.js";

/**
 * @typedef {import("./harmonyModel.js").ProgressionCell} ProgressionCell
 * @typedef {import("./irealChord.js").Key} Key
 */

/**
 * One rendered chord slot inside a bar. A bar usually has one slot; a split
 * bar (two chords) has two. `label` is the display string for the current
 * mode; `noChord` flags an explicit N.C.; `simile` flags a repeat-bar mark
 * (a chord that's "same as previous"), rendered as a simile glyph.
 * @typedef {Object} ChartSlot
 * @property {string} label
 * @property {boolean} [noChord]
 * @property {"single"|"double"|"last"} [simile]  repeatBar / repeatTwoBars / repeatLastBar
 * @property {boolean} [empty]
 */

/**
 * One bar in the chart.
 * @typedef {Object} ChartBar
 * @property {number} index          0-based bar index across the whole chart.
 * @property {number} beatStart      Cumulative beats before this bar.
 * @property {number} beats          Beats in this bar (time-signature numerator).
 * @property {ChartSlot[]} slots     One or two chord slots (split bar).
 * @property {string} [section]      Section label opening at this bar (e.g. "A").
 * @property {boolean} [repeatOpen]  A `{:` mark sits at this bar's left edge.
 * @property {boolean} [repeatClose] A `:}` mark sits at this bar's right edge.
 * @property {number} [ending]       Ending bracket number opening at this bar.
 * @property {boolean} [end]         Final barline (Z) at this bar's right edge.
 * @property {boolean} [doubleRight] A double barline `‖` at this bar's right edge
 *                                   (a section boundary that isn't the final bar).
 * @property {[number, number]} [timeSignature]  A meter change announced at this bar.
 * @property {boolean} [segno]       A segno (`S`) sits at this bar.
 * @property {boolean} [coda]        A coda sign (`Q`) sits at this bar.
 * @property {boolean} [codaAfter]   The coda sign sits at this bar's END (after its
 *   chords) rather than its start — drives the To-Coda jump's play-then-jump.
 * @property {boolean} [fine]        A Fine marker sits at this bar.
 * @property {number}  [passes]      Repeat-count override (`<Nx>`) for the repeat opened here.
 * @property {{ from: "DC" | "DS", target: { type: "coda" | "fine" | "end" } | { type: "ending", n: number } }} [nav]
 *                                   A D.C./D.S. jump that fires AFTER this bar.
 */

/**
 * Lay a progression out as a list of {@link ChartBar}s.
 *
 * @param {ProgressionCell[]} progression
 * @param {Key} key
 * @param {"letter" | "roman"} mode
 * @param {[number, number]} timeSignature  the song's starting meter.
 * @returns {ChartBar[]}
 */
export function layoutChart(progression, key, mode, timeSignature) {
    // Drop iReal's 2nd-ending alignment spacer up front (shared with the player) so
    // the displayed chart and the audio agree on the bars.
    progression = stripEndingSpacers(progression);
    /** @type {ChartBar[]} */
    const bars = [];

    let beatsPerBar = ts0(timeSignature);
    let beatCursor = 0;
    let barIndex = 0;

    // Decorations waiting to attach to the next bar that gets content.
    /** @type {{ section?: string, repeatOpen?: boolean, ending?: number, timeSignature?: [number, number], segno?: boolean, coda?: boolean, fine?: boolean, nav?: ChartBar["nav"], passes?: number }} */
    let pending = {};
    // Bars (refs) of currently-open repeat blocks, so a `<Nx>` count attaches to
    // the bar that opened the enclosing repeat.
    /** @type {ChartBar[]} */
    const openRepeats = [];
    // Does a `:}` mark belong on the bar we just closed?
    let closeRepeatPending = false;
    let endPending = false;
    // Does a `‖` double barline belong on the bar we just closed (a section
    // boundary that isn't the final bar)?
    let doubleRightPending = false;

    /** @type {ChartBar | null} */
    let current = null;

    /** Start a fresh bar, draining any pending decorations onto it. */
    const startBar = () => {
        current = {
            index: barIndex,
            beatStart: beatCursor,
            beats: beatsPerBar,
            slots: [],
        };
        if (pending.section !== undefined) current.section = pending.section;
        if (pending.repeatOpen) current.repeatOpen = true;
        if (pending.ending !== undefined) current.ending = pending.ending;
        if (pending.timeSignature !== undefined) current.timeSignature = pending.timeSignature;
        if (pending.segno) current.segno = true;
        if (pending.coda) current.coda = true;
        if (pending.fine) current.fine = true;
        if (pending.nav !== undefined) current.nav = pending.nav;
        // A `<Nx>` seen before this bar's first content (e.g. `{ <4x> … }`) was
        // stashed; apply it to the repeat-open bar it belongs to.
        if (pending.passes !== undefined && current.repeatOpen) current.passes = pending.passes;
        pending = {};
        if (current.repeatOpen) openRepeats.push(current);
    };

    /** Close the current bar: push it, advance the beat cursor + index. */
    const closeBar = () => {
        if (current === null) return;
        // Drop a bar that never got content AND carries no decorations
        // (e.g. a leading barline before the first chord). A decorated but
        // contentless bar (a lone section marker) is kept so structure shows.
        const decorated = current.section !== undefined
            || current.repeatOpen === true
            || current.ending !== undefined
            || current.timeSignature !== undefined;
        if (current.slots.length === 0 && !decorated
            && !closeRepeatPending && !endPending && !doubleRightPending) {
            // A bare section boundary before any content: nothing to mark.
            doubleRightPending = false;
            current = null;
            return;
        }
        if (closeRepeatPending) { current.repeatClose = true; closeRepeatPending = false; openRepeats.pop(); }
        if (endPending) { current.end = true; endPending = false; }
        if (doubleRightPending) { current.doubleRight = true; doubleRightPending = false; }
        bars.push(current);
        beatCursor += current.beats;
        barIndex += 1;
        current = null;
    };

    const ensureBar = () => { if (current === null) startBar(); };

    // A measure-repeat (simile) occupies its OWN bar. A common iReal idiom
    // writes `C-7 XyQ Kcl` with NO barline before the repeat, meaning "bar 1 =
    // C-7, bar 2 = repeat bar 1". So if the open bar already holds a real
    // (non-empty) slot, close it first, or the simile would be swallowed into
    // the chord's bar and that whole measure would vanish from the chart. This
    // mirrors expandProgression's grouping, so the chart and playback agree on
    // the bar count.
    const breakBeforeSimile = () => {
        if (current !== null && current.slots.some((s) => !s.empty)) closeBar();
    };

    for (const cell of progression) {
        switch (cell.type) {
            case "chord":
                ensureBar();
                if (cell.noChord) {
                    /** @type {ChartBar} */ (current).slots.push({ label: "N.C.", noChord: true });
                } else if (cell.chord) {
                    const label = mode === "roman"
                        ? chordToRoman(cell.chord)
                        : chordToLetter(cell.chord, key);
                    /** @type {ChartBar} */ (current).slots.push({ label });
                } else {
                    // Unparseable chord: show its raw symbol so nothing is lost.
                    /** @type {ChartBar} */ (current).slots.push({ label: cell.raw || "?" });
                }
                break;

            case "empty":
                ensureBar();
                /** @type {ChartBar} */ (current).slots.push({ label: "", empty: true });
                break;

            case "repeatBar":
                breakBeforeSimile();
                ensureBar();
                /** @type {ChartBar} */ (current).slots.push({ label: "%", simile: "single" });
                break;
            case "repeatTwoBars":
                breakBeforeSimile();
                ensureBar();
                /** @type {ChartBar} */ (current).slots.push({ label: "%%", simile: "double" });
                break;
            case "repeatLastBar":
                breakBeforeSimile();
                ensureBar();
                /** @type {ChartBar} */ (current).slots.push({ label: "%", simile: "last" });
                break;

            case "barDivider":
                // A beat divider inside a bar separates its two chord slots;
                // grouping already keeps them in one bar, so nothing to do.
                break;

            case "sectionOpen": {
                // A section opens the NEXT bar. Close any in-progress bar so
                // the label lands on a clean bar boundary; the bar that ends
                // the OUTGOING section gets a double barline on its right
                // edge. That bar is either the one still open (capped via the
                // pending flag) or, if a barline already closed it, the last
                // pushed bar — cap it directly. Never the leading section.
                const hadCurrent = current !== null;
                if (hadCurrent) doubleRightPending = true;
                closeBar();
                if (!hadCurrent && bars.length > 0
                    && !bars[bars.length - 1].end
                    && !bars[bars.length - 1].repeatClose) {
                    bars[bars.length - 1].doubleRight = true;
                }
                pending.section = cell.label;
                break;
            }

            case "repeatOpen":
                closeBar();
                pending.repeatOpen = true;
                break;

            case "ending":
                closeBar();
                pending.ending = cell.ending;
                break;

            case "timeSignature": {
                // A meter change: update the running beats-per-bar and tag
                // the next bar so the chart can show the new signature.
                closeBar();
                const ts = cell.timeSignature || timeSignature;
                beatsPerBar = ts0(ts);
                pending.timeSignature = ts;
                break;
            }

            case "repeatClose":
                if (current === null) {
                    // `}` after an empty tail (e.g. `… r|  <Fine>  }`): there is no
                    // open bar to cap, so the repeat closes on the PREVIOUS content
                    // bar — matching the audio grouping (which attaches the close to
                    // the last flushed bar). Deferring it onto the NEXT bar would
                    // wrongly fold that bar into the repeat.
                    if (bars.length > 0) {
                        bars[bars.length - 1].repeatClose = true;
                        openRepeats.pop();
                    }
                } else {
                    // Close the current bar with a :} on its right edge, then the
                    // close also acts as a barline (the next content starts fresh).
                    closeRepeatPending = true;
                    closeBar();
                }
                break;

            case "bar":
                closeBar();
                break;

            case "end":
                endPending = true;
                closeBar();
                break;

            case "segno":
                // Segno sign: opens (or marks) the bar it precedes. Attach to the
                // open bar if one is in progress, else to the next bar.
                if (current !== null) current.segno = true; else pending.segno = true;
                break;

            case "coda":
                // A coda sign on an in-progress bar sits AFTER its chords (bar END →
                // codaAfter, the To-Coda bar is played before the jump); with no
                // current bar it's at the next bar's START. Mirrors groupIntoBars in
                // harmonyPlayer.js so the cursor and the audio sequence identically.
                if (current !== null) { current.coda = true; current.codaAfter = true; }
                else pending.coda = true;
                break;

            case "comment": {
                // iReal hides D.C./D.S./Fine and `<Nx>` repeat counts in comment
                // text. Classify and attach so the cursor's play order (built from
                // these bars) matches the audio's. A jump/Fine rides the bar it
                // sits in (open bar, else the next); a count sets the enclosing
                // repeat's pass total.
                const nav = classifyNavComment(cell.text || "");
                if (nav && nav.kind === "jump") {
                    if (current !== null) current.nav = { from: nav.from, target: nav.target };
                    else pending.nav = { from: nav.from, target: nav.target };
                } else if (nav && nav.kind === "fine") {
                    if (current !== null) current.fine = true; else pending.fine = true;
                } else if (nav && nav.kind === "repeat") {
                    const open = openRepeats[openRepeats.length - 1];
                    if (open !== undefined) open.passes = nav.times;
                    else pending.passes = nav.times;
                }
                break;
            }

            default:
                break;
        }
    }

    // Flush a trailing open bar.
    closeBar();

    return bars;
}

/**
 * One PLAYED bar: a displayed bar sounding over an expanded beat range.
 * `index` points back to the displayed {@link ChartBar} so a now-playing
 * highlight can light the right bar even across repeats.
 * @typedef {Object} PlaybackBar
 * @property {number} index      displayed ChartBar.index sounding here
 * @property {number} startBeat  inclusive, expanded beats from 0
 * @property {number} endBeat    exclusive
 */

/**
 * Unroll laid-out bars into the PLAYED order, assigning each played bar an
 * expanded beat range. Honours `{ }` repeats (2 passes, or a `<Nx>` override),
 * 1st/2nd endings, AND the segno/coda/D.C./D.S./Fine navigation — by driving the
 * SAME {@link sequenceBars} engine that harmonyPlayer.expandProgression drives.
 * Because both walk structurally-equivalent bars through one engine, the
 * now-playing cursor lands on the exact displayed bar the audio is sounding,
 * jumps and all. The `index` on each entry points back to the displayed bar.
 *
 * @param {ChartBar[]} bars
 * @returns {{ timeline: PlaybackBar[], totalBeats: number }}
 */
export function buildBarPlayback(bars) {
    /** @type {PlaybackBar[]} */
    const timeline = [];
    if (!Array.isArray(bars) || bars.length === 0) {
        return { timeline, totalBeats: 0 };
    }

    // Project each displayed bar onto the sequencer's structural view.
    const struct = bars.map((b) => {
        /** @type {import("./harmonyNavigation.js").StructBar} */
        const s = {};
        if (b.repeatOpen) s.repeatOpen = true;
        if (b.repeatClose) s.repeatClose = true;
        if (b.ending !== undefined) s.ending = b.ending;
        if (b.segno) s.segno = true;
        if (b.coda) s.coda = true;
        if (b.codaAfter) s.codaAfter = true;
        if (b.fine) s.fine = true;
        if (b.nav !== undefined) s.nav = b.nav;
        if (b.passes !== undefined) s.passes = b.passes;
        return s;
    });

    const { order } = sequenceBars(struct);
    let beat = 0;
    for (const i of order) {
        const bar = bars[i];
        // A two-bar simile (`%%`, repeatTwoBars) is ONE displayed bar but stands
        // for TWO bars of music — the audio emits both — so it occupies 2× beats
        // on the timeline. The highlight then stays on the `%%` bar for its full
        // (doubled) duration, in step with the sound.
        const span = bar.slots && bar.slots.some((s) => s.simile === "double")
            ? bar.beats * 2 : bar.beats;
        timeline.push({ index: bar.index, startBeat: beat, endBeat: beat + span });
        beat += span;
    }
    return { timeline, totalBeats: beat };
}

/** A bar with no chord content (an iReal spacer / blank padding cell). */
function isBlankBar(b) {
    return b == null || !Array.isArray(b.slots) || b.slots.length === 0
        || b.slots.every((s) => s && s.empty === true);
}

/**
 * The folded bar range [start, end] a section spans, given the bar where it
 * opens. The section runs to the bar before the next STRUCTURAL boundary —
 * another section's start, or a fresh repeat block opening after this section's
 * repeat has already closed (a trailing tag / "repeat and fade" coda) — or the
 * chart end, whichever comes first; trailing blank spacer bars are trimmed.
 *
 * So clicking a section label selects just that section, not a trailing tag the
 * label happens to precede. (A section's OWN internal `{ }` repeat doesn't end
 * it — only a new block opened after the section's content has closed does.)
 *
 * @param {ChartBar[]} bars
 * @param {number} startIndex  folded bar where the section opens
 * @returns {[number, number] | null}
 */
export function sectionBarRange(bars, startIndex) {
    const n = bars.length;
    if (n === 0) return null;
    const start = Math.max(0, Math.min(n - 1, Math.floor(Number(startIndex)) || 0));
    let end = n - 1;
    let closed = false;
    for (let i = start + 1; i < n; i += 1) {
        const b = bars[i];
        if (b.section !== undefined) { end = i - 1; break; }   // the next section starts
        if (b.repeatOpen && closed) { end = i - 1; break; }    // a fresh (tag) repeat block
        if (b.repeatClose) closed = true;
    }
    while (end > start && isBlankBar(bars[end])) end -= 1;      // trim trailing spacers
    return [start, end];
}

/**
 * Every label-bearing section in the chart, in order: its label and bar range
 * (via {@link sectionBarRange}). Unlabeled trailing material (tags, pickups) is
 * not a section and is omitted.
 * @param {ChartBar[]} bars
 * @returns {Array<{ label: string, range: [number, number] }>}
 */
export function chartSections(bars) {
    /** @type {Array<{ label: string, range: [number, number] }>} */
    const out = [];
    for (let i = 0; i < bars.length; i += 1) {
        if (bars[i].section !== undefined) {
            const range = sectionBarRange(bars, i);
            if (range) out.push({ label: /** @type {string} */ (bars[i].section), range });
        }
    }
    return out;
}

/**
 * Every bar range whose section carries `label`, in chart order — a label can
 * recur (an AABA-type form), and an object assigned that label owns them all.
 * @param {ChartBar[]} bars
 * @param {string} label
 * @returns {Array<[number, number]>}
 */
export function rangesForLabel(bars, label) {
    return chartSections(bars).filter((s) => s.label === label).map((s) => s.range);
}

/**
 * The section LABEL an object's stored assignment refers to. A string is the
 * label itself; a legacy `[start,end]` range is migrated to the label of the
 * section containing its start bar. Returns null when nothing resolves.
 * @param {ChartBar[]} bars
 * @param {unknown} chartSection  the object's stored `chartSection`
 * @returns {string | null}
 */
export function sectionLabelFor(bars, chartSection) {
    if (typeof chartSection === "string" && chartSection !== "") {
        return rangesForLabel(bars, chartSection).length > 0 ? chartSection : null;
    }
    if (Array.isArray(chartSection) && chartSection.length === 2) {
        const start = Math.floor(Number(chartSection[0]));
        let label = null;
        for (const s of chartSections(bars)) {
            if (s.range[0] <= start && start <= s.range[1]) label = s.label;
        }
        return label;
    }
    return null;
}

/**
 * A cell in a laid-out ROW: either a real {@link ChartBar} or an EMPTY
 * placeholder used for left-padding (a section's short final row, or an
 * alternative ending indented under the first ending). An empty cell renders
 * as a blank column — no chord, no barline.
 * @typedef {(ChartBar | { empty: true })} RowCell
 */

/**
 * Group the flat list of {@link ChartBar}s into ROWS for the equal-width grid,
 * so the chart reads like an iReal lead sheet rather than one continuous wrap.
 *
 * Rules (all rows share the same `barsPerRow`-column template so barlines line
 * up straight down the page):
 *
 *  - A bar that OPENS A SECTION (`bar.section` set) starts a NEW row, so the
 *    section's first bar sits in column 1, left-aligned. Bars before the first
 *    section form their own leading rows.
 *  - Within a section, pack `barsPerRow` bars per row, then wrap. A short final
 *    row stays left-aligned; its remaining columns are left EMPTY (blank, no
 *    barline) — we simply don't pad the end.
 *  - FIRST/SECOND ENDINGS stack, column-aligned. The first ending's bars stay
 *    on their current row (no forced break). The first ending's first bar
 *    records its COLUMN; the SECOND (and any later) ending starts a NEW row,
 *    left-padded with EMPTY cells so its first bar lands in that same column —
 *    directly beneath the first ending.
 *
 * Pure: ChartBar[] → RowCell[][]. `data-bar-index` / `data-beat-start` ride on
 * the bars themselves and are untouched (continuous across the whole chart).
 *
 * @param {ChartBar[]} bars
 * @param {number} barsPerRow
 * @returns {RowCell[][]}
 */
export function groupRows(bars, barsPerRow) {
    const cols = Number.isFinite(barsPerRow) && barsPerRow > 0 ? barsPerRow : 4;
    /** @type {RowCell[][]} */
    const rows = [];
    /** @type {RowCell[]} */
    let row = [];

    // Column (1-based) at which the FIRST ending of the current group sits, so
    // a later alternative ending can be indented to the same column. Reset
    // whenever we leave an ending run (a bar without `ending`).
    /** @type {number | null} */
    let firstEndingCol = null;
    // The ending number we treat as "first" of the current stacked group.
    /** @type {number | null} */
    let firstEndingNumber = null;

    const flush = () => {
        if (row.length > 0) rows.push(row);
        row = [];
    };

    for (const bar of bars) {
        const opensSection = bar.section !== undefined;
        const opensEnding = bar.ending !== undefined;

        if (opensEnding) {
            if (firstEndingCol === null) {
                // First ending of a stacked group: it continues on the current
                // row. Record where its first bar lands (1-based column =
                // current row length + 1) so later endings align to it.
                firstEndingCol = row.length + 1;
                firstEndingNumber = bar.ending !== undefined ? bar.ending : null;
            } else if (bar.ending !== firstEndingNumber) {
                // A later alternative ending (2nd, 3rd…): start a NEW row and
                // left-pad with EMPTY cells so this ending's first bar lands in
                // the SAME column as the first ending's first bar.
                flush();
                for (let i = 1; i < firstEndingCol; i += 1) {
                    row.push({ empty: true });
                }
                firstEndingNumber = bar.ending !== undefined ? bar.ending : null;
            }
            // (A continuation bar of the SAME ending number just packs below.)
        } else if (opensSection) {
            // A new section ends any ending group and forces a fresh row at
            // column 1. (Plain bars BETWEEN alternative endings — the tail of
            // the first ending — must NOT clear the recorded column, since the
            // flat model only flags the ending's OPENING bar, not its
            // continuation; the column is held until the next section.)
            firstEndingCol = null;
            firstEndingNumber = null;
            flush();
        }

        // Wrap once the current row is full.
        if (row.length >= cols) flush();

        row.push(bar);
    }

    flush();
    return rows;
}

/**
 * Beats-per-bar from a time signature, guarding a malformed value.
 * @param {[number, number]} ts
 * @returns {number}
 */
function ts0(ts) {
    const n = Array.isArray(ts) ? ts[0] : NaN;
    return Number.isFinite(n) && n > 0 ? n : 4;
}

/**
 * The typographic pieces of a chord label, for iReal-style rendering: a
 * large ROOT on the baseline, an ACCIDENTAL glyph raised after it, and a
 * small SUBSCRIPTED quality/extension run. A slash-bass rides in `bass`.
 *
 * @typedef {Object} ChordParts
 * @property {string} root       The big root (letter or Roman numeral).
 * @property {string} accidental Root accidental as a glyph ("♭"/"♯"/"") .
 * @property {string} ext        Small subscript quality + extensions.
 * @property {string} [bass]     Slash-bass note (already glyph-ified), no "/".
 * @property {boolean} [plain]   True → render `root` verbatim, no split
 *                               (an unparseable fallback).
 */

/** Turn accidental letters in a run into ♭/♯ glyphs. */
function glyphifyAccidentals(s) {
    return s.replace(/b/g, "♭").replace(/#/g, "♯");
}

/**
 * Glyphify the QUALITY/extension run into iReal-style symbols. The numeral
 * case (Roman) and quality markers are mostly already in iReal shape from
 * irealChord.js; here we map the maj7 marker to the triangle and turn
 * accidentals in alterations (b9, #11) into glyphs.
 * @param {string} ext
 * @returns {string}
 */
function glyphifyExt(ext) {
    let out = ext;
    // Minor marker: a LEADING "m" (not "maj") → iReal's "-". The letter
    // renderer spells minor as "m"/"m7"/"m6"…; iReal uses "-7", "-6". Done
    // before the maj→△ pass so "maj" is left intact.
    out = out.replace(/^m(?!aj)/, "-");
    // maj7 / "maj" → triangle (iReal's ^/△). Do the longer match first.
    out = out.replace(/maj7/g, "△7").replace(/maj/g, "△");
    out = out.replace(/\^7/g, "△7").replace(/\^/g, "△");
    // half-diminished marker.
    out = out.replace(/h7/g, "ø7").replace(/(^|[^a-z])h(?![a-z])/g, "$1ø");
    // dim marker "o"/"o7" → ° (keep as small ring).
    out = out.replace(/o7/g, "°7").replace(/(^|[0-9])o(?![a-z])/g, "$1°");
    // accidentals inside alterations.
    out = glyphifyAccidentals(out);
    return out;
}

/**
 * Split a fully-rendered chord label (the string `chordToLetter` /
 * `chordToRoman` produced) into {root, accidental, ext, bass} so a renderer
 * can size the root big and subscript the quality. Pure: string → pieces.
 *
 * Letter roots: a letter A–G plus optional ♭/♯ accidental(s).
 * Roman roots: an optional leading ♭/♯ then a run of I/V (any case).
 * Everything after the root is the (subscripted) quality/extension run.
 * Anything we cannot recognise falls back to `{plain:true, root:<raw>}`.
 *
 * @param {string} label   the display string (letter or roman form).
 * @param {"letter" | "roman"} mode
 * @returns {ChordParts}
 */
export function formatChordParts(label, mode) {
    const text = String(label == null ? "" : label);
    if (text === "") return { root: "", accidental: "", ext: "" };

    // N.C. and bare markers: render verbatim.
    if (text === "N.C." || text === "%" || text === "%%") {
        return { plain: true, root: text, accidental: "", ext: "" };
    }

    // Peel off a slash-bass tail first; the bass note gets glyph accidentals.
    let bass;
    const slash = text.indexOf("/");
    let head = text;
    if (slash >= 0) {
        head = text.slice(0, slash);
        bass = glyphifyAccidentals(text.slice(slash + 1));
    }

    let m;
    if (mode === "roman") {
        // optional accidental, then a roman-numeral run (I/V/i/v).
        m = /^([b#]?)([IiVv]+)(.*)$/.exec(head);
    } else {
        // a letter root, then optional accidental(s).
        m = /^([A-G])([b#]*)(.*)$/.exec(head);
    }
    if (!m) {
        // Unparseable: keep the whole label as plain text so nothing is lost.
        const out = { plain: true, root: text, accidental: "", ext: "" };
        return out;
    }

    let root;
    let accidental;
    let ext;
    if (mode === "roman") {
        accidental = glyphifyAccidentals(m[1]);
        root = m[2];
        ext = glyphifyExt(m[3]);
    } else {
        root = m[1];
        accidental = glyphifyAccidentals(m[2]);
        ext = glyphifyExt(m[3]);
    }

    /** @type {ChordParts} */
    const parts = { root, accidental, ext };
    if (bass !== undefined) parts.bass = bass;
    return parts;
}
