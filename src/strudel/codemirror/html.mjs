// Vendored from @strudel/codemirror v1.3.0 (packages/codemirror/html.mjs).
// Unmodified. See LICENSE (AGPL-3.0-or-later) and README.md.
export let html = (string) => {
  const template = document.createElement('template');
  template.innerHTML = string.trim();
  return template.content.childNodes;
};
let parseChunk = (chunk) => {
  if (Array.isArray(chunk)) return chunk.flat().join('');
  if (chunk === undefined) return '';
  return chunk;
};
export let h = (strings, ...vars) => {
  let string = '';
  for (let i in strings) {
    string += parseChunk(strings[i]);
    string += parseChunk(vars[i]);
  }
  return html(string);
};
