/**
 * Relative-date label formatter.
 *
 * Formats a wall-clock timestamp as a short human-readable
 * label suitable for menu rows in the File menu's Revert to
 * submenu — and any other place where a backup slot's mtime
 * needs to read as something like "5 minutes ago" or
 * "yesterday at 3:15 PM" rather than as a raw ISO string.
 *
 * The rules trade precision for readability:
 *
 *   - Less than 60 seconds ago: "just now".
 *   - Less than 60 minutes ago: "N minutes ago".
 *   - Earlier today (since midnight): "today at HH:MM AM/PM".
 *   - Yesterday (since the prior midnight): "yesterday at HH:MM AM/PM".
 *   - Within the last week: "<weekday> at HH:MM AM/PM".
 *   - Older: "<Month D> at HH:MM AM/PM" with the year added
 *     when the timestamp isn't in the current calendar year.
 *
 * All times are rendered in the user's local timezone via
 * Date's locale methods.
 *
 * Shared between fileMenu.js (in-page menu's Revert to
 * submenu) and menuActions.js (native menu's Revert to
 * submenu) so both surfaces show identical labels for the
 * same backup slot.
 */

// @ts-check

/**
 * @param {number} mtimeMs
 * @returns {string}
 */
export function relativeDateLabel(mtimeMs) {
    const now = Date.now();
    const deltaMs = now - mtimeMs;
    if (deltaMs < 60_000) return "just now";
    if (deltaMs < 60 * 60_000) {
        const minutes = Math.floor(deltaMs / 60_000);
        return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    }

    const then = new Date(mtimeMs);
    const nowDate = new Date(now);

    const timeStr = then.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
    });

    // Build a midnight-of-day comparison so day-boundary
    // rollover is consistent regardless of how many hours
    // have passed.
    const midnight = (/** @type {Date} */ d) =>
        new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const thenDay = midnight(then);
    const nowDay = midnight(nowDate);
    const dayDelta = Math.round((nowDay - thenDay) / 86_400_000);

    if (dayDelta === 0) return `today at ${timeStr}`;
    if (dayDelta === 1) return `yesterday at ${timeStr}`;
    if (dayDelta > 1 && dayDelta < 7) {
        const weekday = then.toLocaleDateString(undefined, { weekday: "long" });
        return `${weekday} at ${timeStr}`;
    }

    /** @type {Intl.DateTimeFormatOptions} */
    const monthDayOpts = { month: "short", day: "numeric" };
    if (then.getFullYear() !== nowDate.getFullYear()) {
        monthDayOpts.year = "numeric";
    }
    const monthDay = then.toLocaleDateString(undefined, monthDayOpts);
    return `${monthDay} at ${timeStr}`;
}
