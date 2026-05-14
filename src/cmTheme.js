/**
 * Shared CodeMirror theme and highlighting.
 *
 * Two CodeMirror surfaces share the same look in GXW: the
 * Code tab's full-pane editor (mounted by TabbedEditor in
 * editor.js) and the property inspector's Band 4 cyclePattern
 * editor (mounted by patternEditor.js). Both should render
 * code with the same fonts, the same colour palette, and the
 * same contrast adjustments so the visual language reads as
 * one application.
 *
 * This module is the one place those decisions live. The
 * highlight style (contrastOverrides) sits on top of oneDark
 * to push specific token groups to colours that read better
 * for the composer; the bundled-extensions helper
 * (customDarkTheme) returns the array both call sites can
 * drop into their EditorState.create extensions list.
 *
 * Iterating by exception: the highlight style only re-defines
 * the small set of tokens the composer finds hard to read
 * under oneDark's defaults. Everything not listed keeps
 * oneDark's default colour. That keeps the override list
 * short and the relationship with oneDark legible — a tag
 * not listed here is unchanged.
 */

// @ts-check

import { HighlightStyle, syntaxHighlighting } from "https://esm.sh/@codemirror/language@6?deps=@codemirror/state@6.5.2";
import { Prec } from "https://esm.sh/@codemirror/state@6.5.2";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6?deps=@codemirror/state@6.5.2";
import { tags as t } from "https://esm.sh/@lezer/highlight@1";

/**
 * Targeted overrides to oneDark.
 *
 * Comments shift to a warm gray so commented-out code and
 * documentation read at the same brightness as the message
 * area, keeping the app's overall warm-light feel consistent.
 *
 * Coral-group tokens (oneDark's saturated coral-red for
 * property names, names, characters, macro names, deletions)
 * shift to a lighter pink with more white mixed in, since
 * the saturated red reads poorly for the composer.
 */
export const contrastOverrides = HighlightStyle.define([
    { tag: t.comment, color: "#c8c0b0" },
    { tag: t.lineComment, color: "#c8c0b0" },
    { tag: t.blockComment, color: "#c8c0b0" },
    { tag: t.docComment, color: "#c8c0b0" },
    { tag: t.meta, color: "#c8c0b0" },

    { tag: t.propertyName, color: "#ff8595" },
    { tag: t.name, color: "#ff8595" },
    { tag: t.character, color: "#ff8595" },
    { tag: t.macroName, color: "#ff8595" },
    { tag: t.deleted, color: "#ff8595" },
]);

/**
 * Bundle the dark theme plus the contrast overrides into a
 * single extensions array. Drop into an EditorState.create
 * extensions list to give a CodeMirror instance GXW's shared
 * code-rendering look.
 *
 * Prec.highest on the override-highlighting ensures these
 * colour assignments win over oneDark's defaults (which set
 * the same token groups at default precedence). Without the
 * precedence boost, oneDark's colours would mask ours.
 *
 * Selection-background contrast (oneDark's default sits very
 * close to the editor background, hard to see under low
 * vision) is handled at the CSS level in main.css rather
 * than here, since CodeMirror's StyleModule extension path
 * had a stubborn override-resistance issue that !important
 * rules in main.css sidestep cleanly. drawSelection() is
 * still enabled in editor.js so the selection renders as a
 * .cm-selectionBackground div (full colour fidelity) rather
 * than as native ::selection (browser-imposed translucency).
 *
 * @returns {Array<any>}
 */
export function customDarkTheme() {
    return [
        oneDark,
        Prec.highest(syntaxHighlighting(contrastOverrides)),
    ];
}
