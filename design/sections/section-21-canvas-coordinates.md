## Section 21 — Canvas Coordinate System

Canvas coordinates are Cartesian and origin-centred. The origin (0, 0) sits at the centre of the viewport. Positive X points right, positive Y points up. Both axes share the same metric — one unit in X represents the same displayed distance as one unit in Y — so geometry preserves its shape regardless of the viewport's aspect ratio.

The default viewport at zoom level 1 shows at least ±16 canvas units horizontally and ±12 canvas units vertically, a 32 × 24 region with 4:3 aspect. When the canvas pane's aspect ratio differs from 4:3, the visible region is extended along the longer axis rather than letterboxed, so no grid space is wasted — extra canvas simply shows.

The coordinate system has no inherent boundary. The visible region changes only through zoom, which is always centred on the origin: the viewport always shows the canvas centred on (0, 0) regardless of zoom level. Panning is not supported.

Images, when loaded into a scene, are stretched to fit the ±16 by ±12 default region (32 × 24 units). Any source aspect ratio becomes 4:3. This is intentional: images serve as scalar fields providing colour and luminance, not pictures to be viewed for their own sake, so stretching is acceptable. This inherits GeoSonix's behaviour.

The grid is drawn at 1-unit spacing, with the X=0 and Y=0 axes rendered slightly brighter than the minor grid so the origin is visually anchored. Major 5-unit lines may be drawn slightly brighter than minor 1-unit lines for a subtle ruler effect. No numeric labels — the grid is frequent enough that position can be read by counting cells.

Zoom methods: a View menu with Zoom In, Zoom Out, and Reset Zoom items; keyboard shortcuts (Cmd-plus, Cmd-minus, Cmd-0); and the mouse scroll wheel while the pointer is over the canvas. All three converge on the same Transport-style state; zoom always centres on the origin.

Sprite visual rendering: drawn as a filled circle, default 1.5 canvas units diameter, for composer visibility. The diameter is a display-only setting; sprites themselves are points with no spatial extent (see Section 6).

Trigger render size: controlled per-trigger by its size property, which also serves as the collision radius. Default 0.4 to 0.6 canvas units; the glyph shape indicates payload type.

Curve rendering uses canvas units directly for geometry. Beat points are drawn as tick marks sized by a system constant that reads well at typical zoom levels.
