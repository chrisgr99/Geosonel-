/**
 * Scene data model.
 *
 * A Scene is the declared structure of a GXW score: a bag of
 * events, movers, and projectors, plus a few piece-level
 * parameters (bpm, time signature, scale, image).
 *
 * The Scene is produced by running the sketch's setup()
 * function. The sketch receives the sketch API as free
 * variables (scene, bpm, timeSignature, scale, image) and
 * populates the scene by calling its add methods.
 *
 * At this milestone the Scene is a static data structure. The
 * simulation engine that animates it (movers integrating
 * physics, projectors sweeping, events firing) comes in a
 * later milestone. For now the canvas renders the scene
 * statically, giving the composer immediate visual feedback
 * on their sketch's declared structure.
 *
 * Inner classes are named ScoreEvent rather than Event to
 * avoid shadowing the DOM's built-in Event globally.
 */

// @ts-check

export class Scene {
    constructor() {
        /** @type {ScoreEvent[]} */
        this.events = [];
        /** @type {Mover[]} */
        this.movers = [];
        /** @type {Projector[]} */
        this.projectors = [];

        /** @type {number | null} */
        this.bpm = null;
        /** @type {[number, number] | null} */
        this.timeSignature = null;
        /** @type {string | null} */
        this.scaleName = null;
        /** @type {string | null} */
        this.imageName = null;
    }

    /**
     * Add an event at a point in canvas coordinates.
     * @param {number} x
     * @param {number} y
     * @param {object} [opts]
     * @returns {ScoreEvent}
     */
    addEvent(x, y, opts = {}) {
        const e = new ScoreEvent(x, y, opts);
        this.events.push(e);
        return e;
    }

    /**
     * Add a mover at a starting position in canvas coordinates.
     * @param {number} x
     * @param {number} y
     * @param {object} [opts]
     * @returns {Mover}
     */
    addMover(x, y, opts = {}) {
        const m = new Mover(x, y, opts);
        this.movers.push(m);
        return m;
    }

    /**
     * Add a projector defined by a sequence of control points.
     * Each point is a [x, y] pair in canvas coordinates.
     * @param {Array<[number, number]>} points
     * @param {object} [opts]
     * @returns {Projector}
     */
    addProjector(points, opts = {}) {
        const p = new Projector(points, opts);
        this.projectors.push(p);
        return p;
    }
}

export class ScoreEvent {
    /**
     * @param {number} x
     * @param {number} y
     * @param {object} opts
     */
    constructor(x, y, opts) {
        this.x = x;
        this.y = y;
        /** Optional shorthand note designation. */
        this.note = opts.note ?? null;
        /** Arbitrary payload the message function can consume. */
        this.payload = opts.payload ?? {};
        /** Hit radius in canvas units. */
        this.radius = opts.radius ?? 0.4;
        /** Named message function to invoke when this event fires. */
        this.messageFn = opts.message ?? null;
    }
}

export class Mover {
    /**
     * @param {number} x
     * @param {number} y
     * @param {object} opts
     */
    constructor(x, y, opts) {
        this.x = x;
        this.y = y;
        /** Initial velocity, canvas units per second. */
        this.vx = opts.vx ?? 0;
        this.vy = opts.vy ?? 0;
        /** Diameter's half, in canvas units. Default 0.75 per
         *  the design doc's mover diameter of 1.5. */
        this.radius = opts.radius ?? 0.75;
        /** Maximum speed ceiling, canvas units per second. */
        this.maxSpeed = opts.maxSpeed ?? 16;
        /** Named firing function for beatless / continuous firing. */
        this.firingFn = opts.firing ?? null;
        /** Named beat pattern for beat-aligned firing. */
        this.beatPattern = opts.beatPattern ?? null;
        /** Named message function bound to this mover. */
        this.messageFn = opts.message ?? null;
    }
}

export class Projector {
    /**
     * @param {Array<[number, number]>} points
     * @param {object} opts
     */
    constructor(points, opts) {
        this.points = points.map((p) => ({ x: p[0], y: p[1] }));
        /** Whether the projector's shape closes from the last
         *  point back to the first. Default false (open polyline). */
        this.closed = opts.closed ?? false;
        /** Sweep duration in beats. Default 4 (one bar at 4/4). */
        this.sweepBeats = opts.sweepBeats ?? 4;
        /** "forward" or "reverse" or "pingpong". */
        this.direction = opts.direction ?? "forward";
    }
}
