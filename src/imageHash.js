/**
 * Image content-hash helper.
 *
 * Computes a SHA-256 hex string of an image's normalized
 * bytes, used as the stable identity for the recent-image
 * gallery's match-and-promote logic and for the bundle's
 * imageContentHash metadata field.
 *
 * Why content hash, not gallery entry id. Stage 4 of the
 * Canvas inspector work settled on content-addressable
 * image identity: the same image (same normalized bytes)
 * imported into two different scores should match the
 * same gallery entry; clearing and rebuilding the user's
 * gallery should not break a score's ability to be
 * recognised on its next open. Hashing the post-
 * normalization bytes (1000×1000 hard-stretched JPEG@70)
 * means two imports from different source formats / sizes
 * produce the same hash as long as the rendered result
 * is the same, which is what the user perceives as "the
 * same image".
 *
 * Why SHA-256, not a faster hash. The hash is computed
 * once per import / score open against a small payload
 * (typically 80–200 KB normalized JPEG). SHA-256 via
 * crypto.subtle.digest runs in microseconds at that size,
 * is universally available in modern browsers without
 * extra libraries, and is collision-resistant to a degree
 * that comfortably covers any plausible user's lifetime
 * collection of images. Faster non-cryptographic hashes
 * would save microseconds at the cost of a non-zero
 * collision risk that would manifest as different images
 * silently sharing a gallery entry — a worse failure mode
 * than the current cost.
 */

// @ts-check

/**
 * Compute the SHA-256 hex digest of the given image bytes.
 * Returns a 64-character lowercase hex string. Callers
 * supply the post-normalization 1000×1000 JPEG@70 bytes
 * produced by src/imageNormalize.js so the same source
 * image arriving through different paths (file picker,
 * drag-and-drop, paste) produces the same hash regardless
 * of its original format or size.
 *
 * @param {ArrayBuffer} bytes
 * @returns {Promise<string>}
 */
export async function computeContentHash(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const view = new Uint8Array(digest);
    let hex = "";
    for (const b of view) {
        hex += b.toString(16).padStart(2, "0");
    }
    return hex;
}
