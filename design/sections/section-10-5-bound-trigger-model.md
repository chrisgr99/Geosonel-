## Section 10.5 — Unified Bound-Trigger Model (Proposed)

This section is retained as a placeholder. The proposal it captured has been superseded by the cursor-as-collider model documented in sections 8, 27, and 28. The v2.5 design goes further than the bound-trigger proposal: curve cyclePattern markers are always externally collidable (no visibility setting), they fire the curve's beenHit callback when hit, and the runtime's pattern primitive handles the per-event firing semantics that the proposal would have placed on a single curve-level function.

For the unified collision model, see section 8; for the pattern language that replaces the active-beats / strength-string grammar, see section 27; for the marker collidability and beenHit firing, see section 28. The phrase-pasting future direction discussed in the original proposal is not committed to the current design; revisit when @strudel/tonal integration lands.

The section title remains in the table of contents so the supersession is discoverable.
