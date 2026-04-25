/**
 * App version and identity.
 *
 * Single source of truth for the strings shown in the About
 * dialog and used anywhere the app needs to identify itself.
 *
 * Bumping policy: APP_VERSION advances by hand at the end of
 * each meaningful milestone (a small set of related changes
 * landing as one commit, typically a single working session).
 * Patch-level differences inside a milestone don't usually
 * earn a bump. DATA_FORMAT_VERSION advances only when the
 * shape of scene.json or behaviours.js changes in a way that
 * older loaders can't read forward-compatibly.
 *
 * Versions are strings rather than numbers so we can use dotted
 * segments freely without worrying about float precision.
 */

// @ts-check

/** Display name of the app. */
export const APP_NAME = "GXW";

/** App version. Bump on milestone landings. */
export const APP_VERSION = "0.1";

/**
 * Score-data format version. Tracks the structure of
 * scene.json and behaviours.js, not the app version. Two
 * apps with the same data format version can read each
 * other's scores.
 */
export const DATA_FORMAT_VERSION = "2.1";

/** Reference to the design document this format implements. */
export const DESIGN_DOC_REFERENCE = "DESIGN.md v2.1";

/** Short, audible-friendly description shown in About. */
export const APP_DESCRIPTION = "A generative-music score editor.";

/**
 * Source repository link. Empty string when the project isn't
 * publicly hosted; the About dialog shows "(not set)" in that
 * case so the row position stays visually stable.
 */
export const SOURCE_URL = "";

/**
 * Author line shown in About. Empty string renders as
 * "(not set)" rather than hiding the row.
 */
export const AUTHOR_LINE = "Chris Graham";
