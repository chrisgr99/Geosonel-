/**
 * Sample-score manifest.
 *
 * The built-in sample scores, bundled with the app (so they're available on
 * both the web and desktop builds — no runtime filesystem needed). Adding a
 * sample is: create a file in src/samples/ that exports
 * `{ id, name, description, build(name) → Bundle }`, then add it to SAMPLES
 * below. The File → Sample Scores menu is generated from this list, and each
 * entry opens the sample as a new UNTITLED copy (the original is read-only).
 *
 * SAMPLE_META is the pure-data view (id / name / description, no build
 * factories) the Electron main process reads to build the native submenu over
 * IPC — it must stay importable without pulling in the Bundle/DOM machinery.
 */

// @ts-check

import { harmonyLines } from "./harmonyLines.js";
import { autoRhythmTestbed } from "./autoRhythmTestbed.js";

/** All built-in samples, in menu order. */
export const SAMPLES = [
    harmonyLines,
    autoRhythmTestbed,
];

/** Pure metadata for menu rendering (id / name / description). */
export const SAMPLE_META = SAMPLES.map((s) => ({
    id: s.id, name: s.name, description: s.description,
}));

/**
 * Build a sample's bundle (untitled, path null), or null for an unknown id.
 * @param {string} id
 * @param {string} [name]
 * @returns {import("../bundle.js").Bundle | null}
 */
export function buildSample(id, name) {
    const s = SAMPLES.find((x) => x.id === id);
    return s ? s.build(name ?? s.name) : null;
}
