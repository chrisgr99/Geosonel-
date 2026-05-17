/**
 * Generic draggable divider.
 *
 * Used for the horizontal divider between the canvas area
 * and the message area, and for the vertical body divider
 * between the editor pane (housing the property inspector)
 * and the canvas pane. The body divider's floor is the
 * inspector's natural content width — narrower than that
 * would clip fields — and its position is persisted across
 * sessions in localStorage.
 *
 * Minimum sizes prevent either side from collapsing to
 * something unusable. Resizing sets a fixed flex-basis on
 * the first pane; the second pane keeps flex: 1 1 0 so it
 * absorbs whatever space remains.
 *
 * Persistence (optional): when persistKey is provided, the
 * current size is read from localStorage on install and
 * applied as the initial flex-basis (clamped to the floor
 * and to the container's room-for-the-second-pane), and
 * saved on every drag step. The save uses a single string
 * key holding the pixel size as an integer.
 */

// @ts-check

const DEFAULT_MIN_PANE_PX = 100;

/**
 * @typedef {Object} DividerOptions
 * @property {string} dividerId      DOM id of the divider element.
 * @property {string} firstPaneId    DOM id of the pane whose flex-basis adjusts.
 * @property {string} containerId    DOM id of the containing flex parent.
 * @property {"vertical" | "horizontal"} orientation
 *     "vertical"   means the divider is a vertical strip and drag changes
 *                  the first pane's width.
 *     "horizontal" means the divider is a horizontal strip and drag changes
 *                  the first pane's height.
 * @property {() => void} [onDrag]    Optional callback on each drag step.
 * @property {number} [minPanePx]     Override the default 100-pixel floor for
 *                                    the first pane. Used by the body divider
 *                                    to floor at the inspector's natural width.
 * @property {string} [persistKey]    localStorage key for persisting the size
 *                                    across sessions. When provided, the saved
 *                                    size is applied at install time (clamped
 *                                    to the floor) and updated on every drag.
 * @property {boolean} [invertControl] When true, the firstPane is treated as
 *                                    sitting AFTER the divider in flow order
 *                                    rather than before, so the controlled
 *                                    pane's size is computed from the END of
 *                                    the container instead of from the start.
 *                                    Used by the message-divider, where the
 *                                    message-area below the divider is the
 *                                    pane whose size we want to control and
 *                                    persist (with the canvas-area above
 *                                    absorbing the residual via flex: 1 1
 *                                    auto). Default false; body-divider uses
 *                                    the default since its editor-pane sits
 *                                    before the divider.
 */

/**
 * Wire up a draggable divider. Call once after the DOM is ready.
 * @param {DividerOptions} options
 */
export function installDivider(options) {
    const {
        dividerId,
        firstPaneId,
        containerId,
        orientation,
        onDrag,
        minPanePx,
        persistKey,
        invertControl,
    } = options;

    const divider = document.getElementById(dividerId);
    const container = document.getElementById(containerId);
    const firstPane = document.getElementById(firstPaneId);

    if (!(divider instanceof HTMLElement) ||
        !(container instanceof HTMLElement) ||
        !(firstPane instanceof HTMLElement)) {
        console.error(`GXW: divider elements missing for ${dividerId}.`);
        return;
    }

    const isVertical = orientation === "vertical";
    const floor = typeof minPanePx === "number" && minPanePx > 0
        ? minPanePx
        : DEFAULT_MIN_PANE_PX;

    // Apply persisted size at install time. Clamped to the
    // floor on the low end; if a previously-saved size is
    // wider than the current container leaves room for, we
    // still apply it — the live drag clamp will pull it in
    // to a sensible value the next time the user drags. We
    // intentionally don't clamp at install against the
    // container size because the container's layout isn't
    // fully resolved yet at module-init time.
    if (typeof persistKey === "string") {
        try {
            const raw = window.localStorage.getItem(persistKey);
            if (raw !== null) {
                const saved = parseInt(raw, 10);
                if (Number.isFinite(saved) && saved > 0) {
                    const initial = Math.max(floor, saved);
                    firstPane.style.flex = `0 0 ${initial}px`;
                }
            } else {
                // No saved size — apply the floor as the
                // initial flex-basis so the first-paint pane
                // size matches the inspector's natural width
                // without relying on whatever placeholder
                // value (e.g. max-content) the CSS happened
                // to start with.
                firstPane.style.flex = `0 0 ${floor}px`;
            }
        } catch (err) {
            // localStorage can throw in private browsing
            // contexts; fall through silently.
        }
    }

    /** @type {number | null} */
    let dragPointerId = null;

    divider.addEventListener("pointerdown", (e) => {
        dragPointerId = e.pointerId;
        divider.setPointerCapture(e.pointerId);
        divider.classList.add("dragging");
        e.preventDefault();
    });

    divider.addEventListener("pointermove", (e) => {
        if (dragPointerId === null) return;
        const rect = container.getBoundingClientRect();

        let newSize;
        let total;
        let dividerSize;
        if (isVertical) {
            total = rect.width;
            dividerSize = divider.offsetWidth;
            // invertControl: controlled pane sits to the RIGHT
            // of the divider, so its width = container-right
            // minus pointer-X. Without invertControl, controlled
            // pane sits to the left and width = pointer-X minus
            // container-left.
            newSize = invertControl
                ? total - (e.clientX - rect.left)
                : e.clientX - rect.left;
        } else {
            total = rect.height;
            dividerSize = divider.offsetHeight;
            // invertControl: controlled pane sits BELOW the
            // divider, so its height = container-bottom minus
            // pointer-Y. Without invertControl, controlled pane
            // sits above and height = pointer-Y minus container-
            // top.
            newSize = invertControl
                ? total - (e.clientY - rect.top)
                : e.clientY - rect.top;
        }

        const max = total - DEFAULT_MIN_PANE_PX - dividerSize;
        if (newSize < floor) newSize = floor;
        if (newSize > max) newSize = Math.max(floor, max);

        firstPane.style.flex = `0 0 ${newSize}px`;
        if (typeof persistKey === "string") {
            try {
                window.localStorage.setItem(persistKey, String(Math.round(newSize)));
            } catch (err) {
                // localStorage write can fail in private mode
                // or when quota is exceeded; ignore and keep
                // the live size unsaved rather than throwing.
            }
        }
        if (onDrag) onDrag();
    });

    const endDrag = () => {
        if (dragPointerId === null) return;
        divider.releasePointerCapture(dragPointerId);
        dragPointerId = null;
        divider.classList.remove("dragging");
    };

    divider.addEventListener("pointerup", endDrag);
    divider.addEventListener("pointercancel", endDrag);
}
