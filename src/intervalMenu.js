// @ts-check

/**
 * Shared interval / note-duration menu (GeoSonixV2).
 *
 * The single source of truth for the inspector's reusable interval
 * (note-duration) popup, used wherever a duration is chosen — Time
 * Lag In Object (Band 1), the Automessage Interval (Band 4), and
 * more to come. Defined once here and consumed through
 * Inspector._buildDropdownField.
 *
 * Values are ordered by length, shortest to longest, exactly as in
 * DESIGN.md section 4. "Tr" = triplet, "Dot" = dotted, "Off" =
 * none. The stored value is the token string itself (e.g. "Qtr",
 * "Dot 16th", "Off"); how a token maps to a concrete duration is
 * the engine's concern, defined later — this module is just the
 * vocabulary and its display labels.
 *
 * @type {Array<{value: string, label: string}>}
 */
export const INTERVAL_OPTIONS = [
    { value: "Off", label: "Off" },
    { value: "384th", label: "384th" },
    { value: "128th", label: "128th" },
    { value: "64th", label: "64th" },
    { value: "32nd", label: "32nd" },
    { value: "8th Tr", label: "8th Tr" },
    { value: "16th", label: "16th" },
    { value: "Qtr Tr", label: "Qtr Tr" },
    { value: "Dot 16th", label: "Dot 16th" },
    { value: "8th", label: "8th" },
    { value: "Half Tr", label: "Half Tr" },
    { value: "Dot 8th", label: "Dot 8th" },
    { value: "Qtr", label: "Qtr" },
    { value: "Dot Qtr", label: "Dot Qtr" },
    { value: "Half", label: "Half" },
    { value: "Dot Half", label: "Dot Half" },
    { value: "Whole", label: "Whole" },
    { value: "2 x Wh", label: "2 x Wh" },
    { value: "4 x Wh", label: "4 x Wh" },
];

/**
 * The interval token strings in menu order, for schema enumValues.
 * @type {string[]}
 */
export const INTERVAL_TOKENS = INTERVAL_OPTIONS.map((o) => o.value);

/**
 * The default interval ("Off" = none), used as the schema/model
 * default for interval-valued fields.
 */
export const DEFAULT_INTERVAL = "Off";
