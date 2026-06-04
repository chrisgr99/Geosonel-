// @ts-check

/**
 * Seeded position / velocity offset.
 *
 * Pure, dependency-free computation of the per-object start-state
 * nudge for the seed-variation experiment (the "repetition with
 * variation" direction). Given a global integer seed and one
 * object's id and variability dial, it returns a deterministic 2D
 * Gaussian offset for the object's start POSITION and start
 * VELOCITY. The simulation's seeded rewind reads each object's
 * variability and adds these offsets to its authored home, always
 * from the authored value (never accumulated), so the same seed
 * reproduces the same chunk exactly.
 *
 * Determinism is by HASHING, not by draw order: the sample for a
 * given (seed, objectId, property, component) is a pure function
 * of those four, so it is independent of object iteration order
 * and trivially reproducible. A standard-normal sample is drawn
 * by Box-Muller from two hashed uniforms, then clamped at
 * CLAMP_SD standard deviations so a rare draw cannot fling an
 * object off-canvas or hand it a wild velocity.
 *
 * The magnitude is `variability * referenceSD[property]`. The
 * reference SDs are the tunable constants below: position spread
 * is a few percent of the canvas size (so the value means the
 * same thing regardless of canvas dimensions), velocity spread is
 * a modest characteristic speed. These are placeholders Chris
 * tunes by ear — they are meant to be found and changed here.
 *
 * Seed 0 means "no offset": a normal rewind or play at seed 0 is
 * byte-for-byte today's behaviour. Variability 0 (the default)
 * likewise yields no offset, so an object is locked until opted
 * in. Hermetic (no imports) so it runs under `node --test`; this
 * folder carries its own { "type": "module" } package.json.
 */

// --- Tunable reference spreads (nudge these by ear) ---

/**
 * Position standard deviation as a FRACTION of the canvas
 * dimension, per axis. 0.05 = five percent of canvas width (x)
 * and height (y) at variability 1. Scaled to the canvas so the
 * felt amount is consistent across scores of different sizes.
 */
export const POSITION_SD_FRACTION = 0.05;

/**
 * Velocity standard deviation in canvas units per second at
 * variability 1. A modest fraction of a typical object speed.
 */
export const VELOCITY_SD = 1.5;

/**
 * Clamp on the standard-normal sample, in standard deviations.
 * A draw beyond ±CLAMP_SD is pinned to the boundary, so the
 * largest possible offset is CLAMP_SD * variability * referenceSD.
 */
export const CLAMP_SD = 2.5;

/**
 * FNV-1a hash of a string to a uint32. Small, fast, and
 * well-distributed enough for deriving uniforms; not
 * cryptographic, which is fine — we only need reproducible
 * spread.
 * @param {string} str
 * @returns {number}  uint32
 */
function hashStringToUint32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * A uniform in the open interval (0, 1) derived from a string
 * key. The +0.5 keeps the value strictly inside (0, 1) so the
 * Box-Muller log never sees 0.
 * @param {string} key
 * @returns {number}
 */
function uniform(key) {
    return (hashStringToUint32(key) + 0.5) / 4294967296;
}

/**
 * A clamped standard-normal sample (mean 0, sd 1) that is a pure
 * function of (seed, objectId, property, component). Box-Muller
 * from two independent hashed uniforms.
 * @param {number} seed
 * @param {string} objectId
 * @param {"pos" | "vel"} property
 * @param {"x" | "y"} component
 * @returns {number}
 */
export function standardGaussian(seed, objectId, property, component) {
    const key = `${seed}:${objectId}:${property}:${component}`;
    const u1 = uniform(key + ":u1");
    const u2 = uniform(key + ":u2");
    let z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    if (z > CLAMP_SD) z = CLAMP_SD;
    else if (z < -CLAMP_SD) z = -CLAMP_SD;
    return z;
}

/**
 * The full start-state offset for one object under a seed.
 * Returns the position delta (dx, dy) in canvas units and the
 * velocity delta (dvx, dvy) in canvas units per second. Both are
 * the zero vector when seed is 0 (no offset) or variability is
 * not positive (object locked), so the default path is exactly
 * today's behaviour.
 *
 * @param {number} seed       Global integer seed; 0 = no offset.
 * @param {string} objectId   The object's stable id.
 * @param {number} variability  The object's variability dial (>=0).
 * @param {number} canvasW     Canvas width in canvas units.
 * @param {number} canvasH     Canvas height in canvas units.
 * @returns {{dx: number, dy: number, dvx: number, dvy: number}}
 */
export function computeOffset(seed, objectId, variability, canvasW, canvasH) {
    if (!seed || !(variability > 0)) {
        return { dx: 0, dy: 0, dvx: 0, dvy: 0 };
    }
    const posSdX = POSITION_SD_FRACTION * canvasW;
    const posSdY = POSITION_SD_FRACTION * canvasH;
    return {
        dx: standardGaussian(seed, objectId, "pos", "x") * variability * posSdX,
        dy: standardGaussian(seed, objectId, "pos", "y") * variability * posSdY,
        dvx: standardGaussian(seed, objectId, "vel", "x") * variability * VELOCITY_SD,
        dvy: standardGaussian(seed, objectId, "vel", "y") * variability * VELOCITY_SD,
    };
}
