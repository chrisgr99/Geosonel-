/**
 * Harmony NAVIGATION: the single source of truth for the PLAYED order of a
 * chart's bars — repeats, 1st/2nd endings, AND the dal-segno / da-capo / coda /
 * fine jumps that iReal Pro charts encode in comment text.
 *
 * Two pure exports, no DOM / no Node built-ins (so `node --test` and
 * `node --check` both work):
 *
 *   - {@link classifyNavComment}: read one iReal comment string and decide
 *     whether it is a navigation instruction (D.S./D.C. al Coda|Fine|Nth-ending),
 *     a Fine marker, or a repeat-count override (`<3x>`), or nothing.
 *   - {@link sequenceBars}: given a flat list of structural bars (repeat marks,
 *     ending numbers, segno/coda flags, a nav instruction), return the order in
 *     which the bars actually PLAY, as indices back into the input. Both the
 *     audio expansion (harmonyPlayer.expandProgression) and the chart cursor
 *     (harmonyChartLayout.buildBarPlayback) drive this same function over
 *     structurally-equivalent bar lists, so the highlight can never disagree
 *     with the sound.
 *
 * iReal encoding notes (from the real Pop/Jazz/Blues/Brazilian libraries):
 *   - The jump itself lives in a `<comment>`, often polluted with a leading
 *     rehearsal-mark `*NN` and/or stray `XyQ` (empty-cell) tokens, e.g.
 *     `<*66XyQ  D.S. al Coda>`. classifyNavComment strips that noise first.
 *   - Segno is the `S` token; BOTH the "To Coda" sign and the Coda section use
 *     the same `Q` token. `Q` is overloaded (also rehearsal noise), so a `Q` is
 *     only treated as coda navigation when an `al Coda` instruction exists to
 *     pair it with: the nearest `Q` at/before the instruction is the jump-FROM
 *     ("To Coda"), the first `Q` after it is the jump-TO (the Coda).
 *   - On the return trip (after D.S./D.C.) iReal does NOT re-take the inner
 *     `{ }` repeats — each plays once — and exits at the Coda / Fine / chosen
 *     ending. That convention is encoded in sequenceBars's "return" mode.
 */

// @ts-check

/**
 * A navigation instruction parsed from a comment.
 * - kind "jump": a D.C. (from the top) or D.S. (from the segno), with a target.
 *     target.type "coda" → play to the To-Coda sign, jump to the Coda.
 *     target.type "fine" → play to the Fine marker, stop.
 *     target.type "ending" → on the return, take ending `n`.
 *     target.type "end"  → play to the final barline (bare "D.C." / "on cue").
 * - kind "fine": this comment marks the Fine point (where al Fine stops).
 * - kind "repeat": a `<Nx>` count override for the enclosing repeat.
 * @typedef {(
 *   { kind: "jump", from: "DC" | "DS",
 *     target: { type: "coda" } | { type: "fine" } | { type: "end" } | { type: "ending", n: number } }
 *   | { kind: "fine" }
 *   | { kind: "repeat", times: number }
 * )} NavComment
 */

/**
 * Strip iReal comment noise: a leading rehearsal mark `*NN`, any `XyQ`
 * empty-cell tokens that leaked into the text, and surrounding whitespace;
 * collapse internal runs of space.
 * @param {string} text
 * @returns {string}
 */
function normaliseComment(text) {
    return String(text == null ? "" : text)
        .replace(/\*\d+/g, " ")   // rehearsal/section number prefix
        .replace(/XyQ/g, " ")      // stray empty-cell tokens
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Classify one iReal comment string as a navigation instruction, a Fine
 * marker, a repeat-count override, or nothing (null).
 * @param {string} text
 * @returns {NavComment | null}
 */
export function classifyNavComment(text) {
    const raw = normaliseComment(text);
    if (raw === "") return null;
    const s = raw.toLowerCase();

    // Repeat-count override: a bare "<Nx>" (e.g. "3x", "7x").
    const rep = /^(\d+)\s*x$/.exec(s);
    if (rep) return { kind: "repeat", times: Number(rep[1]) };

    // A D.C./D.S. jump. Detect the origin first (tolerant of "d.c"/"dc"/"d. c.").
    const hasDC = /\bd\.?\s*c\.?/.test(s);
    const hasDS = /\bd\.?\s*s\.?/.test(s);
    if (hasDC || hasDS) {
        /** @type {NavComment & { kind: "jump" }} */
        const out = { kind: "jump", from: hasDS ? "DS" : "DC", target: { type: "end" } };
        const ending = /al\s+(\d+)(?:st|nd|rd|th)?\s+end/.exec(s);
        if (/al\s+coda/.test(s)) out.target = { type: "coda" };
        else if (/al\s+fine/.test(s)) out.target = { type: "fine" };
        else if (ending) out.target = { type: "ending", n: Number(ending[1]) };
        return out;
    }

    // A bare Fine marker (the stop point for an al-Fine jump). Guard against
    // matching "al fine" inside a jump (handled above) — only a leading "fine".
    if (/^fine\b/.test(s)) return { kind: "fine" };

    return null;
}

/**
 * One structural bar handed to {@link sequenceBars}. Only the flags that affect
 * play ORDER live here; the caller keeps its own per-bar payload (chords, beat
 * ranges, displayed index) and re-attaches it by the returned indices.
 * @typedef {Object} StructBar
 * @property {boolean} [repeatOpen]   `{` opens a repeat at this bar.
 * @property {boolean} [repeatClose]  `}` closes a repeat at this bar.
 * @property {number}  [passes]       repeat-count override for the frame opened here (`<Nx>`).
 * @property {number}  [ending]       ending bracket number opening at this bar.
 * @property {boolean} [segno]        a segno (`S`) sits at this bar.
 * @property {boolean} [coda]         a coda sign (`Q`) sits at this bar.
 * @property {boolean} [codaAfter]    the coda sign sits at this bar's END (after its
 *   chords), so an al-Coda return PLAYS this bar before the To-Coda jump; absent =
 *   the sign is at the bar START, so the jump happens before the bar plays.
 * @property {boolean} [fine]         a Fine marker sits at this bar.
 * @property {{ from: "DC" | "DS", target: { type: "coda" | "fine" | "end" } | { type: "ending", n: number } }} [nav]
 *   a D.C./D.S. instruction that fires AFTER this bar plays.
 */

/**
 * Strip iReal's 2nd-ending ALIGNMENT SPACER from a flat progression. iReal pads a
 * second ending into horizontal position by inserting a measure of empty cells
 * right after the repeat close — `repeatClose (empty|barDivider|bar)+ ending` —
 * which otherwise renders as a phantom blank measure AND plays as an extra held
 * bar. We position endings ourselves, so drop that run (the empties + their
 * barline) between a `repeatClose` and the following `ending`, leaving
 * `repeatClose ending`. Run from the SAME shared helper by both the chart layout
 * (display/cursor) and the player (audio), so they can never disagree on it.
 *
 * Conservative: only a run made purely of empty/divider/bar cells that is
 * immediately followed by an `ending` is removed — a real chord after the repeat
 * (a held bar that actually continues) is left untouched.
 *
 * @param {import("./harmonyModel.js").ProgressionCell[]} cells
 * @returns {import("./harmonyModel.js").ProgressionCell[]}
 */
export function stripEndingSpacers(cells) {
    if (!Array.isArray(cells)) return cells;
    const out = [];
    for (let i = 0; i < cells.length; i += 1) {
        out.push(cells[i]);
        if (cells[i] == null || cells[i].type !== "repeatClose") continue;
        let j = i + 1;
        while (j < cells.length && cells[j] != null
            && (cells[j].type === "empty" || cells[j].type === "barDivider" || cells[j].type === "bar")) {
            j += 1;
        }
        // The run [i+1, j) is pure padding only if an ending follows it directly.
        if (j > i + 1 && j < cells.length && cells[j] != null && cells[j].type === "ending") {
            i = j - 1;   // skip the padding; the loop pushes the ending next
        }
    }
    return out;
}

/**
 * The highest ending number in the ending-group that starts at `from`. The
 * group runs forward to the next repeatOpen (a fresh block) or the list end.
 * @param {StructBar[]} bars
 * @param {number} from
 * @returns {number}
 */
function maxEndingFrom(bars, from) {
    let max = bars[from].ending || 1;
    for (let j = from + 1; j < bars.length; j += 1) {
        if (bars[j].repeatOpen) break;
        if (bars[j].ending !== undefined && bars[j].ending !== null) {
            if (/** @type {number} */ (bars[j].ending) > max) max = /** @type {number} */ (bars[j].ending);
        }
    }
    return max;
}

/**
 * Where the ending block that opens at `s` ends (exclusive), and whether a
 * `repeatClose` sits on its last bar. The block runs until the next ending or
 * the list end, and a `repeatClose` bar is included then terminates it.
 * @param {StructBar[]} bars
 * @param {number} s
 * @returns {{ endExclusive: number, hadClose: boolean }}
 */
function endingBlockEnd(bars, s) {
    let j = s;
    let hadClose = false;
    while (j < bars.length) {
        const b = bars[j];
        if (j > s && b.ending !== undefined && b.ending !== null) break;
        if (b.repeatClose) { hadClose = true; j += 1; break; }
        j += 1;
    }
    return { endExclusive: j, hadClose };
}

/**
 * Compute the PLAYED order of bars, honouring repeats (default 2 passes, or a
 * per-frame `passes` override), 1st/2nd endings, and a single D.C./D.S.
 * navigation with an al-Coda / al-Fine / al-Nth-ending / to-the-end target.
 *
 * Returns the order as indices into `bars` (a bar can appear many times), plus
 * non-fatal `notes` for anything it could not model (missing segno, unpaired
 * coda, …) — it never throws on malformed input.
 *
 * @param {StructBar[]} bars
 * @returns {{ order: number[], notes: string[] }}
 */
export function sequenceBars(bars) {
    /** @type {number[]} */
    const order = [];
    /** @type {string[]} */
    const notes = [];
    const n = Array.isArray(bars) ? bars.length : 0;
    if (n === 0) return { order, notes };

    // Resolve the (first) nav instruction and its jump anchors up front.
    let navIndex = -1;
    for (let k = 0; k < n; k += 1) { if (bars[k].nav) { navIndex = k; break; } }
    let segnoIndex = -1;
    for (let k = 0; k < n; k += 1) { if (bars[k].segno) { segnoIndex = k; break; } }

    let toCodaIndex = -1;
    let codaStartIndex = -1;
    const nav = navIndex >= 0 ? bars[navIndex].nav : null;
    if (nav) {
        if (nav.from === "DS" && segnoIndex < 0) {
            notes.push("D.S. with no segno; navigation ignored");
            navIndex = -1;
        } else if (nav.target.type === "coda") {
            for (let k = navIndex; k >= 0; k -= 1) { if (bars[k].coda) { toCodaIndex = k; break; } }
            for (let k = navIndex + 1; k < n; k += 1) { if (bars[k].coda) { codaStartIndex = k; break; } }
            if (toCodaIndex < 0 || codaStartIndex < 0) {
                notes.push("al Coda: coda signs not found; navigation ignored");
                navIndex = -1;
            }
        }
    }
    const navTarget = navIndex >= 0 ? /** @type {any} */ (bars[navIndex].nav).target : null;
    const navFrom = navIndex >= 0 ? /** @type {any} */ (bars[navIndex].nav).from : null;

    /** @type {Array<{ openIndex: number, passes: number, pass: number }>} */
    const stack = [];
    let lastClosedPass = 1;
    /** @type {"normal" | "return"} */
    let mode = "normal";
    let navFired = false;
    let i = 0;
    let guard = 0;

    while (i < n) {
        if (++guard > 1_000_000) { notes.push("sequencer guard tripped"); break; }
        const bar = bars[i];

        // To-Coda jump, sign-at-bar-START case (`§Q C |`): on an al-Coda return,
        // leap to the Coda BEFORE playing this bar. The sign-at-END case (the common
        // one) is handled after the bar is played, below.
        if (mode === "return" && navTarget && navTarget.type === "coda"
            && i === toCodaIndex && !bar.codaAfter) {
            i = codaStartIndex;
            continue;
        }

        // Open a repeat frame the first time we reach its `{` (never on the
        // jump-back, where the frame already covers this index). Return mode
        // does not loop, so no frames are opened there.
        if (mode === "normal" && bar.repeatOpen &&
            (stack.length === 0 || stack[stack.length - 1].openIndex !== i)) {
            stack.push({ openIndex: i, passes: bar.passes && bar.passes > 0 ? bar.passes : 2, pass: 1 });
        }

        // Ending selection.
        if (bar.ending !== undefined && bar.ending !== null) {
            let play;
            if (mode === "return") {
                // Return trip: take the chosen ending (al Nth ending), else the
                // FIRST ending (the repeat-less path to the coda/fine/end).
                play = navTarget && navTarget.type === "ending"
                    ? bar.ending === navTarget.n
                    : bar.ending === 1;
            } else {
                const frame = stack[stack.length - 1];
                const pass = frame ? frame.pass : lastClosedPass;
                const k = /** @type {number} */ (bar.ending);
                // ending k plays on pass k; the highest ending also covers any
                // later pass (a block repeated more times than it has endings).
                play = k === pass || (k === maxEndingFrom(bars, i) && pass > k);
            }
            if (!play) {
                const { endExclusive, hadClose } = endingBlockEnd(bars, i);
                if (hadClose && mode === "normal") {
                    const frame = stack[stack.length - 1];
                    if (frame) { lastClosedPass = frame.pass; stack.pop(); }
                }
                i = endExclusive;
                continue;
            }
        }

        // Play this bar.
        order.push(i);

        // To-Coda jump, sign-at-bar-END case (`C §Q |`, iReal's common encoding):
        // the To-Coda bar is PLAYED (above) and only THEN do we leap to the Coda.
        // Jumping before playing it would drop the bar, shortening the section by one
        // and knocking the whole form off its bar grid (the All-My-Loving bug).
        if (mode === "return" && navTarget && navTarget.type === "coda"
            && i === toCodaIndex && bar.codaAfter) {
            i = codaStartIndex;
            continue;
        }

        // Fine stop: on an al-Fine return, halt at the Fine bar.
        if (mode === "return" && navTarget && navTarget.type === "fine" && bar.fine) break;

        // Repeat close: loop back while passes remain, else retire the frame.
        if (mode === "normal" && bar.repeatClose) {
            const frame = stack[stack.length - 1];
            if (frame && frame.pass < frame.passes) {
                frame.pass += 1;
                i = frame.openIndex;
                continue;
            }
            if (frame) { lastClosedPass = frame.pass; stack.pop(); }
        }

        // Fire the nav AFTER this bar's repeats have fully resolved.
        if (mode === "normal" && !navFired && navIndex >= 0 && i === navIndex) {
            navFired = true;
            mode = "return";
            if (stack.length > 0) {
                notes.push("D.C./D.S. fired inside an open repeat (unusual placement)");
                stack.length = 0;
            }
            i = navFrom === "DC" ? 0 : segnoIndex;
            continue;
        }

        i += 1;
    }

    return { order, notes };
}
