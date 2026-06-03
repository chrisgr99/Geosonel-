export const W = {
    // Left-edge label column. Wide enough for the longest
    // band-1-or-2 label at 10pt; everything narrower gets
    // the same width so the label column aligns down the
    // entire form.
    leftLabel: 78,

    // ID field — short generated identifier (e.g. "sp_a3f7").
    idField: 80,

    // Inline labels next to the row's leftmost field group,
    // sized to the shortest text that fits at 10pt.
    hideCursor: 90,    // "Hide Cursor" — deprecated width key, kept for any legacy reference; the Band 1 state row now uses W.state / W.stateField instead
    mute: 40,          // "Mute" — deprecated width key from the old single Mute control; superseded by the three-state `state` field (Active / Hide Cursor / Disable) on Band 1's row 1
    state: 40,         // "State" — the Band 1 row-1 label for the three-state activity dropdown (active / passive / disabled)
    stateField: 110,   // the Band 1 state dropdown itself; wide enough for the longest option label ("Hide Cursor")
    curveThick: 60,    // "Curve\nThickness" multiline
    cursorThick: 60,   // "Cursor\nThickness" multiline

    // Numeric fields.
    posXY: 60,         // Position X, Y (legacy; superseded by startState)
    startState: 60,    // Starting State X, Y, vX, vY — four fields share the row at curve-size width (60) to match the visual weight of the surrounding rows
    sizeWH: 60,        // Curve Size W, H
    cursorRL: 50,      // Cursor R, L
    thickness: 60,     // Curve/Cursor Thickness
    spriteTriggerSize: 60,

    // Text fields.
    name: 280,

    // Band 3 function-name and cyclePattern fields. Sized
    // to match the Name field width so the right edge of
    // Band 3 lines up with Band 1's Name row.
    callbackField: 280,

    // Band 1 cycle duration numeric field. Small width
    // since the value is typically a single-digit master-
    // beat count (4 by default).
    beatsPerCycle: 50,

    // Band 1 cycle duration row's Beat Interval label and
    // dropdown. The label sits between the beatsPerCycle
    // field and the dropdown; the dropdown shows the
    // current token ("Qtr", "8th", "Dot 16th", etc.) drawn
    // from the 17-entry TOKENS table in beatIntervals.js.
    // Dropdown width fits the longest token text plus the
    // custom arrow chrome at 11pt. The label wraps to two
    // lines ("Beat" / "Interval") so its column is narrower
    // than the single-line text would need, making room for
    // the Speeds field that follows in the same row.
    beatInterval: 84,
    beatIntervalLabel: 60,

    // Band 1 cycle duration row's cycleSpeeds field and
    // label. The Speeds field carries a whitespace-
    // separated number list (integers or decimals, e.g.
    // "1", "1 -1", "0.5 2 -1.5"). Wider than the
    // original integer-only sizing now that decimals are
    // accepted — multi-entry decimal lists stretch
    // across more characters than a typical integer list,
    // so the field is enlarged to fit them comfortably.
    // The row's leftLabel column stays at the standard
    // 78px width matching every other row above and
    // below; the wider Speeds field grows the row past
    // its pre-decimal footprint, which is acceptable
    // since the Starting State row in Band 2 is similarly
    // wide. The label sits to the left of the field on
    // a single line. Applies to curves and sprites; both
    // carry the cycleSpeeds field with the same shape and
    // meaning (a per-cycle multiplier list).
    cycleSpeeds: 80,
    cycleSpeedsLabel: 50,

    // Band 1 pattern row's Repeats field. Single-digit
    // integer field for the curve-only patternRepeats
    // value. Default value 1 fits in a narrow box; values
    // greater than ~10 are unusual in practice so the
    // field stays small even at the upper end of typical
    // use.
    patternRepeats: 36,
    patternRepeatsLabel: 50,

    // Band 3 Create / Go-to button. Wide enough for the
    // longer "Go to" label (and "Create") at 10pt.
    slotButton: 56,

    // Global band's Sound Engine dropdown. Wide enough for
    // the longest enum label ("Superdough (Web Audio)") at
    // 11pt with the custom green chevron chrome on the
    // right edge. The dropdown lives at the bottom of the
    // inspector in the always-visible global band, which
    // controls which engine the rest of the audio surfaces
    // reshape around.
    soundEngine: 180,
    soundEngineLabel: 90,

    // Middle band voice-field dropdowns under superdough.
    // Wide enough for the longest pitched-sound entry
    // (the "... (noise)" and "... (VCSL)" suffixed labels)
    // and the longest drum-machine bank name at 11pt with
    // the custom green chevron chrome on the right edge,
    // with comfortable margin.
    voiceField: 200,
};

// --- Selection-context helpers ---

/**
 * Pitched-sound dropdown options for the superdough voice
 * controls, shared by both the per-object middle band and
 * the score-wide global band. The list holds ONLY the
 * instrument entries — no leading sentinel — because the
 * two bands need different top sentinels: the per-object
 * band prepends a "Global" entry (inherit the global
 * voice), while the global band prepends a "Default" entry
 * (inject nothing / superdough's own default). Each band
 * builds its full option list by prepending its own
 * sentinel to these shared entries (see _buildBandMiddle-
 * Area and _buildBandGlobal). Both sentinels use the
 * empty-string value; they differ only in label and in
 * which level they sit at.
 *
 * The entries: the four built-in oscillators, the four
 * noise sources, the startup-loaded Salamander grand
 * piano, and seven VCSL (Versilian Community Sample
 * Library) pitched instruments lazy-loaded from the VCSL
 * sample map on first selection. The VCSL set replaced an
 * earlier list of gm_ General MIDI entries: the
 * @strudel/web umbrella this build uses ships no soundfont
 * code, so gm_ names produced no sound, whereas the VCSL
 * instruments resolve through the same samples() path that
 * already serves the drum banks and piano. The runtime's
 * VCSL_SOUND_NAMES set must stay in sync with the VCSL
 * entries here so ensureSamplesForVoice loads the map when
 * one is chosen. No trumpet or other brass appears because
 * the VCSL map contains none; a real trumpet would need
 * the soundfont path (gm_trumpet) that this build lacks.
 */
export const PITCHED_SOUND_OPTIONS = [
    { value: "sine", label: "sine wave" },
    { value: "sawtooth", label: "sawtooth wave" },
    { value: "square", label: "square wave" },
    { value: "triangle", label: "triangle wave" },
    { value: "white", label: "white (noise)" },
    { value: "pink", label: "pink (noise)" },
    { value: "brown", label: "brown (noise)" },
    { value: "crackle", label: "crackle (noise)" },
    { value: "piano", label: "piano" },
    { value: "steinway", label: "steinway (VCSL)" },
    { value: "vibraphone", label: "vibraphone (VCSL)" },
    { value: "marimba", label: "marimba (VCSL)" },
    { value: "kalimba", label: "kalimba (VCSL)" },
    { value: "harp", label: "harp (VCSL)" },
    { value: "sax", label: "sax (VCSL)" },
];

/**
 * Unpitched bank dropdown options for the superdough voice
 * controls, shared by the per-object middle band and the
 * score-wide global band. As with PITCHED_SOUND_OPTIONS,
 * the list holds ONLY the 13 alphabetised drum-machine
 * bank names from the tidal-drum-machines catalogue — no
 * leading sentinel — and each band prepends its own:
 * "Global" for the per-object band, "Default" for the
 * global band. The names match the bank prefixes
 * superdough applies via strudel's .bank() function: a
 * value of "RolandTR909" means an event with s="bd" (no
 * underscore) becomes RolandTR909_bd at dispatch.
 */
export const UNPITCHED_BANK_OPTIONS = [
    { value: "AceToneRhythmAce", label: "AceToneRhythmAce" },
    { value: "AkaiMPC60", label: "AkaiMPC60" },
    { value: "EmuSP12", label: "EmuSP12" },
    { value: "KorgKR55", label: "KorgKR55" },
    { value: "LinnDrum", label: "LinnDrum" },
    { value: "LinnLM1", label: "LinnLM1" },
    { value: "OberheimDMX", label: "OberheimDMX" },
    { value: "RolandCR78", label: "RolandCR78" },
    { value: "RolandTR606", label: "RolandTR606" },
    { value: "RolandTR707", label: "RolandTR707" },
    { value: "RolandTR808", label: "RolandTR808" },
    { value: "RolandTR909", label: "RolandTR909" },
];

/**
 * Per-object (middle band) option lists: the shared
 * instrument/bank entries with a "Global" sentinel
 * prepended. "Global" (empty-string value) means the
 * object inherits the score-wide global voice for that
 * field; it is the default for a new or untouched object
 * (an absent/empty stored value maps to "Global"). The
 * firing engine resolves a per-object "Global" by falling
 * through to scene.voiceSuperdough at dispatch time.
 */
export const PER_OBJECT_SOUND_OPTIONS = [
    { value: "", label: "Global" },
    ...PITCHED_SOUND_OPTIONS,
];
export const PER_OBJECT_BANK_OPTIONS = [
    { value: "", label: "Global" },
    ...UNPITCHED_BANK_OPTIONS,
];

/**
 * Global-band option lists: the shared instrument/bank
 * entries with a "Default" sentinel prepended. "Default"
 * (empty-string value) means inject nothing at the global
 * level — superdough's own default — so an object
 * inheriting "Global" against a "Default" global resolves
 * to no injection (today's behavior for a fresh score).
 * The global band can't inherit from itself, so its top
 * sentinel is "Default", not "Global".
 */
export const GLOBAL_SOUND_OPTIONS = [
    { value: "", label: "Default" },
    ...PITCHED_SOUND_OPTIONS,
];
export const GLOBAL_BANK_OPTIONS = [
    { value: "", label: "Default" },
    ...UNPITCHED_BANK_OPTIONS,
];
