// GXW-specific entries in the same JSDoc-derived schema the
// vendored Strudel autocomplete and tooltip read. Hand-edited
// (in contrast to strudel-doc.js, which is regenerated). Add
// one entry per function or signal we want surfaced in the
// editor's autocomplete popup and Ctrl-hover tooltip.
//
// Schema (per entry):
//   name          string   The identifier the user types. Required.
//   longname      string   Optional; falls back to name. Used as
//                          the display label if present.
//   description   string   HTML or plain text. Renders below the
//                          name in the info panel.
//   params        array    Optional. Each: { name, type: { names: [...] },
//                          description }.
//   examples      array    Optional. Each is a string of example code
//                          rendered in a <pre> block.
//   synonyms      array    Optional aliases. Each shown as its own
//                          completion entry pointing back to this doc.
//   kind          string   "function" / "constant" / "member" / "class".
//                          Entries with kind === "package" are filtered
//                          out by isValidDoc in autocomplete.mjs.
//   tags          array    Optional. Tags with originalTitle of
//                          "superdirtOnly" or "noAutocomplete" cause the
//                          entry to be skipped.
//
// AGPL-3.0-or-later (see repo-root LICENSE).

export default {
    docs: [
        // Placeholder. Add GXW-specific entries here as the runtime
        // exposes new functions or signals worth surfacing in the
        // Code tab's autocomplete. Example shape:
        //
        // {
        //     name: "mySignal",
        //     kind: "function",
        //     description: "GXW-specific oscillator signal that...",
        //     params: [
        //         { name: "freq", type: { names: ["number"] },
        //           description: "Frequency in Hz." },
        //     ],
        //     examples: [
        //         'note("c d e").gain(mySignal(2))',
        //     ],
        // },
    ],
};
