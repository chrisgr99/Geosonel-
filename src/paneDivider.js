/**
 * Generic draggable divider.
 *
 * Used for both the vertical divider between the editor and
 * canvas panes and the horizontal divider between the canvas
 * area and the message area. The pointer-event pattern is the
 * same in both cases; only the axis and the pane being resized
 * differ.
 *
 * Minimum sizes prevent either side from collapsing to
 * something unusable. Resizing sets a fixed flex-basis on the
 * first pane; the second pane keeps flex: 1 1 0 so it absorbs
 * whatever space remains.
 */

// @ts-check

const MIN_PANE_PX = 100;

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
 * @property {() => void} [onDrag]   Optional callback on each drag step.
 */

/**
 * Wire up a draggable divider. Call once after the DOM is ready.
 * @param {DividerOptions} options
 */
export function installDivider(options) {
    const { dividerId, firstPaneId, containerId, orientation, onDrag } = options;

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
            newSize = e.clientX - rect.left;
            total = rect.width;
            dividerSize = divider.offsetWidth;
        } else {
            newSize = e.clientY - rect.top;
            total = rect.height;
            dividerSize = divider.offsetHeight;
        }

        const max = total - MIN_PANE_PX - dividerSize;
        if (newSize < MIN_PANE_PX) newSize = MIN_PANE_PX;
        if (newSize > max) newSize = Math.max(MIN_PANE_PX, max);

        firstPane.style.flex = `0 0 ${newSize}px`;
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
