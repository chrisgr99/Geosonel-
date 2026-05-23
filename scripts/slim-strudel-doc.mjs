#!/usr/bin/env node
// Slim a raw doc.json from Strudel's jsdoc-json build step and write
// it back out as an ES module (export default) at the destination
// path. Called by scripts/refresh-strudel-doc.sh.
//
// Slimming. The raw JSDoc dump carries fields we don't use at runtime
// (`comment`, the original JSDoc text; `meta`, a per-entry record of
// the source file's local path and line number) plus a single
// `package` kind entry that lists every scanned source file's path.
// All three leak the local build path into the vendored file and bloat
// it by more than half. Drop them: keep only the fields the rendered
// info panel reads (name, longname, description, params, examples,
// synonyms, synonyms_text, kind, tags).
//
// Wrapping. JSON is a strict subset of JavaScript expressions, so
// prepending `export default ` to a JSON-serialised object yields a
// valid ES module. The file is committed as-is to the repo; the
// vendored autocomplete and tooltip import it via the doc.js merger.

import { readFileSync, writeFileSync } from "node:fs";
import { statSync } from "node:fs";

const [, , inputPath, outputPath] = process.argv;
if (inputPath === undefined || outputPath === undefined) {
    console.error("usage: slim-strudel-doc.mjs <input doc.json> <output strudel-doc.js>");
    process.exit(2);
}

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const docs = raw.docs ?? [];

const keepKeys = new Set([
    "name", "longname", "description", "params", "examples",
    "synonyms", "synonyms_text", "kind", "tags",
]);

const slim = [];
for (const doc of docs) {
    // Skip JSDoc's `package` kind entry, which leaks every scanned
    // source file's local path. isValidDoc filters it at runtime anyway.
    if (doc.kind === "package") continue;
    const entry = {};
    for (const k of keepKeys) {
        if (k in doc) entry[k] = doc[k];
    }
    slim.push(entry);
}

const now = new Date().toISOString().slice(0, 10);
const header =
    "// Auto-generated from the Strudel monorepo via\n" +
    "// scripts/refresh-strudel-doc.sh. Do not edit by hand; re-run\n" +
    "// the refresh script if a new Strudel release adds functions.\n" +
    "// AGPL-3.0-or-later (see repo-root LICENSE; original from\n" +
    "// https://codeberg.org/uzu/strudel).\n" +
    "//\n" +
    `// Refreshed: ${now}\n` +
    `// Entries: ${slim.length}\n` +
    "export default ";

const body = JSON.stringify({ docs: slim }, null, 2);
writeFileSync(outputPath, header + body + ";\n", "utf8");

const inputSize = statSync(inputPath).size;
const outputSize = statSync(outputPath).size;
console.log(
    `Slimmed ${docs.length} entries -> ${slim.length} entries; ` +
    `${(inputSize / 1024).toFixed(0)} KB raw -> ${(outputSize / 1024).toFixed(0)} KB output.`
);
