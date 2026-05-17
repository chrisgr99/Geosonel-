// Electron preload script.
// Runs in a privileged context before the renderer starts loading.
// For Stage 1 of the migration we expose nothing; the renderer behaves
// exactly like a normal web page. Later stages will use contextBridge here
// to expose file operations and other native capabilities to the renderer.

// Intentionally empty for Stage 1.
