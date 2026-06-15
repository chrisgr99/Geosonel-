/**
 * Phrase-sync: map a MASTER beat-pattern object's groove progress to a
 * base-cycle harmony beat, so the chord changes follow the master's groove
 * instead of the wall clock (design/phrase-sync.md, stage 2a).
 *
 * The master's path SWEEP (one cursor cycle, cycleProgress 0→1) is divided into
 * `repeats` GROOVE PHRASES. Groove phrase k of sweep `cycleCount` maps to chart
 * phrase (cycleCount*repeats + k) mod P, advancing one chart phrase per groove
 * phrase and wrapping after the last (the whole chart loops under the master).
 *
 * Within a groove phrase, the assigned chart phrase's chords are laid out, and a
 * chord change SNAPS to the master's nearest preceding ONSET (option B, chosen
 * with Chris for musicality): the chart position is sampled-and-held at the most
 * recent onset, so chords always change on a heard hit rather than sliding off
 * the beat. With no onsets at all the layout falls back to a proportional slide.
 *
 * Pure module: no DOM, no engine state — importable by `node --test` and
 * checkable by `node --check`.
 */

// @ts-check

/**
 * @typedef {{ start: number, end: number }} PhraseSpan
 */

/**
 * The base-cycle harmony beat to look up for the master's current groove phase,
 * or null when there is nothing to drive (no phrases). The returned beat lies in
 * the chart's base cycle (the same space `scene.harmony.phrases` use), ready to
 * feed the harmony player and the phrase-state lookup.
 *
 * @param {object} p
 * @param {PhraseSpan[]} p.phrases     chart phrases in base-cycle beats (P > 0)
 * @param {number} p.cycleCount        the master's completed sweeps (>= 0)
 * @param {number} p.cycleProgress     time-fraction through the current sweep [0, 1)
 * @param {number} p.repeats           groove phrases per sweep (N >= 1)
 * @param {number[]} p.onsets          master active-beat PATH fractions over the
 *                                     whole sweep, in [0, 1) (may be empty)
 * @param {boolean} p.reversed         the current sweep traverses the path backward
 *                                     (so an onset at path fraction f is reached at
 *                                     time-progress 1 - f)
 * @returns {number | null}
 */
export function phraseSyncBeat({ phrases, cycleCount, cycleProgress, repeats, onsets, reversed }) {
    if (!Array.isArray(phrases) || phrases.length === 0) return null;
    const P = phrases.length;
    const N = (Number.isFinite(repeats) && repeats >= 1) ? Math.floor(repeats) : 1;
    // Clamp progress to [0, 1) so floor(cp*N) never reaches N (would index past
    // the last groove phrase of the sweep).
    const cp = Number.isFinite(cycleProgress)
        ? Math.min(1 - 1e-9, Math.max(0, cycleProgress)) : 0;
    const cc = (Number.isFinite(cycleCount) && cycleCount >= 0) ? Math.floor(cycleCount) : 0;

    const pos = cp * N;                  // position across the sweep, in [0, N)
    const k = Math.min(N - 1, Math.floor(pos)); // groove phrase index this sweep
    const pLocal = pos - k;              // progress within this groove phrase [0, 1)
    const G = cc * N + k;                // global groove-phrase counter
    const idx = ((G % P) + P) % P;       // chart phrase, wrapping

    // Snap pLocal to the most recent master onset inside this groove phrase. The
    // sweep's onsets tile across [0, 1); groove phrase k owns time-progress
    // [k/N, (k+1)/N). An onset at path fraction f is reached at time-progress
    // g (= f forward, 1 - f reversed); map it into this phrase's local [0, 1).
    const lo = k / N;
    const hi = (k + 1) / N;
    const EPS = 1e-9;
    let snapped = -1;
    if (Array.isArray(onsets)) {
        for (const f of onsets) {
            if (typeof f !== "number" || !Number.isFinite(f)) continue;
            const g = reversed ? 1 - f : f;
            if (g < lo - EPS || g >= hi - EPS) continue; // not in this groove phrase
            const gl = (g - lo) * N;                     // onset's local position
            if (gl <= pLocal + EPS && gl > snapped) snapped = gl;
        }
    }
    if (snapped < 0) {
        // No onset at or behind the cursor: hold the phrase's first chord when
        // the master has onsets (a chord change only lands on a hit); slide
        // proportionally only when the master has no onsets at all.
        snapped = (Array.isArray(onsets) && onsets.length > 0) ? 0 : pLocal;
    }

    const phrase = phrases[idx];
    const len = phrase.end - phrase.start;
    return phrase.start + snapped * len;
}
