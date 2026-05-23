#!/usr/bin/env bash
# Refresh src/strudel/codemirror/strudel-doc.js from the Strudel monorepo.
#
# Clones Strudel into a temp directory, runs Strudel's jsdoc-json build step
# (which generates the JSDoc data the vendored autocomplete and tooltip
# extensions consume), slims the output to just the fields the renderer
# reads, and writes the result as an ES module at the target path.
#
# Run this when a new Strudel release adds functions or you want to pull
# in upstream documentation improvements. The result is a single file
# change to src/strudel/codemirror/strudel-doc.js, committable on its own.
#
# Requirements: git, node, npm. Internet access to clone codeberg.org and
# install jsdoc + jsdoc-json from npm.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${REPO_ROOT}/src/strudel/codemirror/strudel-doc.js"
WORK="$(mktemp -d -t gxw-strudel-doc.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "Refreshing $TARGET"
echo "Working directory: $WORK"

cd "$WORK"

echo "Cloning Strudel monorepo..."
# Shallow clone, blobless: we only need the source tree to run JSDoc, not
# the history. The codeberg.org mirror is the canonical source.
git clone --depth 1 --filter=blob:none --quiet \
    https://codeberg.org/uzu/strudel.git strudel

echo "Installing jsdoc and jsdoc-json..."
# Install in an isolated directory because Strudel's package.json uses pnpm
# workspace protocol (`workspace:*`) that plain npm doesn't understand;
# running npm inside the Strudel root would fail at dependency resolution.
mkdir -p tools && cd tools
npm init -y > /dev/null
npm install --silent --no-save jsdoc jsdoc-json

echo "Running JSDoc..."
JSDOC_CONFIG="${WORK}/strudel/jsdoc/jsdoc.config.json"
JSDOC_OUT="${WORK}/doc.json"
cd "$WORK/strudel"
# Note that JSDoc's --template option points to the jsdoc-json package
# folder; the package's main file is what JSDoc loads as the template.
"${WORK}/tools/node_modules/.bin/jsdoc" \
    packages/ \
    --template "${WORK}/tools/node_modules/jsdoc-json" \
    --destination "${JSDOC_OUT}" \
    -c "${JSDOC_CONFIG}"

echo "Slimming and wrapping..."
node "${REPO_ROOT}/scripts/slim-strudel-doc.mjs" "${JSDOC_OUT}" "${TARGET}"

echo "Done. $TARGET updated."
echo "Inspect the diff and commit when ready."
