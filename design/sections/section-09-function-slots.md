## Section 9 — Function Slots and Context Objects

Each object kind has a fixed set of optional function slots whose names appear in the property inspector and whose semantics are described below. Defining a function means writing a named JavaScript function in the score's behaviours.js file and referencing it by name in the object's matching slot field; an empty slot leaves the corresponding event unhandled.

### Slot inventory

- Sprite: Motion Update, Auto.
- Trigger: Collision, Auto.
- Curve: Hit Beat, Hit Trigger.

The names describe the event from the firing object's perspective. Sprite Motion Update updates the sprite's motion every physics tick. Sprite Auto fires on the sprite's own beat-aligned timer. Trigger Collision fires when something collides with the trigger (currently only a curve's extended cursor; sprite-trigger collisions are a future milestone). Trigger Auto fires on the trigger's own timer. Curve Hit Beat fires when the curve's cursor reaches one of its own active beat points during cycle advancement. Curve Hit Trigger fires when the curve's extended cursor sweeps across a trigger or a beats-as-trigger position on another curve.

The pair Curve Hit Trigger and Trigger Collision describe the same physical event from the two participants' perspectives — the curve hit something, and the trigger was hit. Both functions fire when both are defined; the order is documented under Section 8 and Section 10.5. The asymmetric naming reflects the asymmetric perspective: "hit" is what the curve's cursor does, "collision" is what happens to the trigger. When the unified bound-trigger model in Section 10.5 lands, beat points become triggers themselves and the same Hit Trigger / Collision pair fires for cursor-on-beat events; Curve Hit Beat continues to fire only when the curve's own cursor reaches its own beats internally, never on external collision.

### The behaviours.js file

Callback functions live in a behaviours.js file inside the score bundle, alongside scene.json. The file is a regular bundle text file edited in the same CodeMirror tab system that hosts scene.json: full JavaScript syntax highlighting, parser-driven error squiggles, undo, and the existing explicit-save model. Edits to behaviours.js trigger a scene reload through the same pipeline that reloads on scene.json edits, so a saved behaviour change takes effect on the next runScene cycle without restarting playback.

The file's content is plain top-level function declarations:

```
function motionUpdate(ctx) {
    const c = ctx.imageColor;
    const brightness = (c.r + c.g + c.b) / 3;
    return { ax: (brightness - 128) * 0.5, ay: 0 };
}

function auto_kick(ctx) {
    return { note: 36, velocity: 96, duration: 0.1 };
}
```

No export statements, no module wrapper. The simulation evaluates the file once per reload and indexes its top-level function declarations by name; objects in scene.json reference functions by exact name in their slot fields. A name in scene.json that does not resolve to a function in behaviours.js is a soft error — the slot stays inert for that object, and the inspector renders the field's content with a warning indicator. The scene continues to run.

behaviours.js may also contain helper functions that are not bound to any slot; objects' slot bindings reference only the top-level functions, but the body of a slot function may call any helper defined elsewhere in the file. Helpers are typical for shared math or for response curves the composer wants to tune in one place across multiple slots.

### Auto-generated function names

When the composer clicks the Create button next to a slot field in the property inspector, the inspector generates a stub function in behaviours.js with a default name and binds the slot to it. The default name combines the slot's role with the object's typed name using the convention `role_objectName`, where `role` is one of `motionUpdate`, `auto`, `collision`, `hitBeat`, `hitTrigger`, and `objectName` is whatever the composer typed into the object's Name field. A trigger named `kick` with an empty Auto slot offers `auto_kick` as the default; clicking Create writes a stub `function auto_kick(ctx) { ... }` to behaviours.js and sets the slot field to `auto_kick`. The composer can edit the field before clicking Create to override the default name.

When the object has no typed name, the default falls back to `role_<id>` using the object's generated id (e.g. `auto_sp_a3f7`). The composer can rename the function and the field separately afterward; the binding is by name, so renaming the function in behaviours.js without updating the slot field breaks the binding and produces the soft error described above.

If the named function already exists in behaviours.js when the composer clicks Create, the button does nothing and is rendered disabled. The composer can either choose a different name (typing in the field changes the proposed default) or accept the existing function as the binding (in which case the field is left as-is, since the function is already there). This protects against accidental overwrites of behaviours the composer has already authored.

### Shared default for Sprite Motion Update

Sprite Motion Update is the one slot that defaults to a shared function across all sprites in the score. The convention is that all sprites typically inhabit the same image and respond to the same compositional intent (the same force field, the same colour-driven physics), so one function describing how a sprite responds to its environment usually suffices. The shared default function is named `motionUpdate` (no underscore suffix, no per-object qualifier) so its identity as the score-wide motion behaviour is encoded in its name.

The rule for the inspector's Motion Update field on a sprite:

- When the field is empty, the simulation looks up `motionUpdate` in behaviours.js. If it exists, every sprite with an empty field uses it. If it does not exist, every sprite with an empty field has no Motion Update and runs pure inertial physics (Section 22's milestone-2 behaviour: integrate by velocity, bounce off walls).
- The inspector field renders the implicit `motionUpdate` name as a placeholder hint when the slot is empty, so the composer can see what would be invoked.
- The Create button on an empty Motion Update field offers `motionUpdate` as the default name. Clicking Create when `motionUpdate` does not yet exist creates the shared function. Clicking Create when `motionUpdate` already exists is disabled (the function is already there; the empty field is already bound to it through the convention).
- The composer overrides the default for a single sprite by typing a different name into the field. The inspector then offers that name as the Create default — if the name is `motionUpdate_specialSprite`, clicking Create scaffolds that function. The override takes precedence over the shared default for that sprite only; other sprites still resolve through `motionUpdate`.

No other slot has a shared-default convention. Curve Hit Beat, Curve Hit Trigger, Trigger Collision, Trigger Auto, and Sprite Auto all default to per-object names like `hitBeat_kick` or `auto_drum`, on the principle that each curve plays its own beat pattern, each trigger represents a different musical event, and each sprite that has its own Auto handler is firing different events than its peers. Composers who do want shared functions for these slots can achieve it by typing the same name into multiple objects' fields — the binding is by name, so two triggers both bound to `auto_kick` share that function.

### Sprite Motion Update context and return shape

The Motion Update function receives a context object and returns an acceleration vector. The acceleration is added to the sprite's velocity before position integration, with the maxSpeed clamp applied both before Motion Update runs and again after the acceleration has been applied. The simulation's per-sprite per-tick order is:

1. Clamp velocity to the sprite's authored maxSpeed.
2. Call Motion Update if a function is bound (either through the per-sprite override or the shared `motionUpdate` default). Receive `{ ax, ay }` or `null`/`undefined` for no acceleration this tick.
3. Apply acceleration: `vx += ax * dt`, `vy += ay * dt`.
4. Clamp velocity to maxSpeed again, so Motion Update cannot push velocity past the ceiling.
5. Integrate position: `x += vx * dt`, `y += vy * dt`.
6. Resolve canvas walls under the inside-only rule (Section 22).

The acceleration semantics mean Motion Update expresses physics in the natural language of force fields: "image brightness pulls me harder" reads as a larger acceleration value, not as a velocity delta. Sprites have no defined mass, so the distinction between acceleration and force is uninteresting — the value the function returns is whatever the composer wants the rate of velocity change to be, in canvas-units-per-second-squared. The simulation handles the dt multiplication; the composer reasons about acceleration directly.

Motion Update does not fire musical events. Returning `{ note: ..., velocity: ... }` is meaningless in this slot — the simulation reads only `ax` and `ay` from the return value. Composers who want sprite motion to also drive events use the Auto slot for rhythmic events, or compute event-firing conditions inside Motion Update and emit them through a side channel (a future capability; in v2.4 Motion Update is purely physics).

The context object on every Motion Update call carries:

- `ctx.dt`: the simulation time step in real seconds (currently 1/240 s; see Section 22).
- `ctx.x`, `ctx.y`: the sprite's current runtime position in canvas units.
- `ctx.vx`, `ctx.vy`: the sprite's current runtime velocity, after the maxSpeed clamp at the top of the tick.
- `ctx.imageColor`: the image pixel colour at the sprite's current position as `{ r, g, b }` in 0–255. Returns the no-image fill colour `{ r: 64, g: 64, b: 64 }` when no image is loaded or when the sprite is outside the canvas region.
- `ctx.imageColorAt(x, y)`: a function returning the image colour at an arbitrary canvas-unit position. Used for gradient sampling — "what colour is one unit ahead of me?" — and for any pattern where the sprite reads multiple positions per tick. Same fallback when out of canvas or no image.
- Harmony and transport state will be added in Section 11's harmony milestone; in v2.4 the context covers physics-relevant fields only.

### Other slots' context shapes

The other five slots' context objects are documented here as the v2.4 plan; the simulation hooks for them land in subsequent milestones. The Motion Update slot is the first message-function slot to ship (milestone 3 of the v2.4 development cycle), with Sprite Auto, Trigger Auto, and Curve Hit Beat following once the Strudel-driven beat-firing path lands (Section 27). Trigger Collision and Curve Hit Trigger arrive with the trigger-collision implementation milestone.

Sprite Auto. Fires on the sprite's beat-aligned timer.
- `this`: the sprite (id, position, payload).
- `ctx.beatNumber`: the index of this firing within the score's overall beat sequence.
- `ctx.imageColor`, `ctx.imageColorAt(x, y)`: as in Motion Update, sampled at the sprite's current runtime position.
- Harmony and transport fields.
- Returns `{ note, velocity, duration, channel, port }` to fire a musical event, or `null`/`undefined` for silence.

Trigger Collision. Fires when a curve's extended cursor sweeps over the trigger.
- `this`: the trigger (position, payload, id).
- `ctx.curve`: the curve whose cursor hit it.
- `ctx.d`, `ctx.side`, `ctx.angle`, `ctx.cursorParam`: the geometry of the hit — perpendicular distance, side of the curve, local curve direction, position along the curve.
- `ctx.imageColor`, `ctx.imageColorAt(x, y)`: image samples at the trigger's position.
- Harmony and transport fields.
- Returns musical-event parameters.

Trigger Auto. Fires on the trigger's beat-aligned timer.
- `this`: the trigger.
- `ctx.beatNumber`: as in Sprite Auto.
- `ctx.imageColor`, `ctx.imageColorAt(x, y)`: image samples at the trigger's position.
- Harmony and transport fields.
- Returns musical-event parameters.

Curve Hit Beat. Fires when the curve's cursor reaches an active beat point during cycle advancement.
- `this`: the curve (id, cycle parameters, harmony overrides).
- `ctx.beatIndex`: the slot index of the firing beat, 0-based, in [0, cycleDuration).
- `ctx.strength`: the velocity digit from the strength string, 0–9.
- `ctx.cyclePosition`: the cursor's position around the curve as a fraction in [0, 1).
- `ctx.imageColor`, `ctx.imageColorAt(x, y)`: image samples at the beat point's canvas position.
- Harmony and transport fields.
- Returns musical-event parameters.

Curve Hit Trigger. Fires when the curve's extended cursor collides with a trigger (or with a beats-as-trigger position on another curve).
- `this`: the curve.
- `ctx.trigger`: the trigger that was hit (full object access, including its own payload and position).
- `ctx.d`, `ctx.side`, `ctx.angle`, `ctx.cursorParam`: hit geometry as in Trigger Collision.
- `ctx.imageColor`, `ctx.imageColorAt(x, y)`: image samples at the trigger's position.
- Harmony and transport fields.
- Returns musical-event parameters.

When both ends of a Curve Hit Trigger / Trigger Collision pair are bound, both fire — the trigger's Collision first, then the curve's Hit Trigger — and each runs with its own context object. Coordination between the two functions, if needed, happens through composer-managed shared state (a payload field on the trigger that the curve reads, a global counter, a side-channel object); the simulation does not enforce a precedence model. Section 10.5 expands on the case where beat points become triggers under the unified bound-trigger model.

### Helpers and globals

The pre-v2.4 helper functions — scaleMap, rangeMap, chordMap, harmonyMap, listMap — remain available globally to all callbacks, alongside Math. The harmony helpers will be reimplemented over Tonal in the phase documented in Section 27; existing call sites will continue to work unchanged.

All slot functions also have access to the score-level scene object through a `scene` global, which lets a callback read other objects' positions, payloads, and runtime state. Use is by convention rather than enforcement — the scene is mutable, and a callback that modifies scene state outside its bound object's properties is doing something unusual that the simulation will faithfully execute. This power is occasionally useful (a Motion Update function that reads other sprites' positions to implement flocking, for instance) and is the usual escape hatch for any compositional pattern not covered by a single object's context fields.

### Simulation tick rate

Motion Update fires at the simulation's fixed-step rate, currently 1/240 s per step (~4.17 ms, 240 Hz). At this rate even naive Euler-style physics produce smooth motion, and the per-tick cost is bounded — a hundred sprites running non-trivial Motion Update functions consume a small fraction of the per-frame budget. The other slots fire on event boundaries (beat points reached, collisions detected, auto timers expiring) rather than per tick, and their cost is therefore proportional to event density rather than to the simulation rate.

### Authoring workflow summary

The end-to-end flow for adding a behaviour to a score is:

1. Select the object in the canvas. The property inspector shows the object's slots in band 3.
2. Click Create on the desired slot's row, or type a custom name into the slot field first and then click Create. The inspector creates a stub function in behaviours.js using the default name (or the typed name) and binds the slot field to that name.
3. Switch to the behaviours.js tab and edit the function body. Save when ready.
4. The simulation reload picks up the new function; the next time the slot's event fires, the new behaviour runs.

Binding multiple objects to one shared function is a matter of typing the same name into each object's slot field; deleting an object does not remove its bound functions from behaviours.js, on the principle that the composer may want to reuse them. Cleanup of orphaned functions is manual.
