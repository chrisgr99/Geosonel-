# 2026-05-09 — Tier 3 Stage 2B: Band 3 callback slots

Stage 2B introduces the new Band 3 to the property
inspector, exposing the four uniform callback slots
(canCycle, hasHit, beenHit, onTick) that section 27 of
the design document defines for every source kind. With
this commit the inspector renders Bands 1, 2, and 3, plus
a stub Band 4 whose first row carries the Code Location
radio in inert form.

Row labels read as the JavaScript callback function
names: canCycle for the cycle slot, then hasHit, beenHit,
onTick. The shape mirrors the schema's gating boolean
for the cycle slot and the function-name fields for the
others. The five-row layout for Band 3 is as follows.
  Row 1: row label "canCycle", canCycle checkbox,
    cyclePattern text field.
  Row 2: multiline label "beats per cycle" sized to span
    both the leftLabel and the Can-X checkbox columns
    so the beatsPerCycle numeric field's left edge aligns
    with the function-name column above and below; then
    the beatsPerCycle field. The label and the field
    both disable when the canCycle checkbox is unchecked.
  Row 3: row label "hasHit", canHit checkbox,
    hasHitFunction text field, Create / Go-to button.
  Row 4: row label "beenHit", canBeHit checkbox,
    beenHitFunction text field, Create / Go-to button.
  Row 5: row label "onTick", canTick checkbox,
    onTickFunction text field, Create / Go-to button.

Greying. Universal: every Band 3 row activates for any
non-empty selection regardless of kinds, since the
callback-slot vocabulary is identical across curves,
triggers, and sprites. Empty selection greys the band
as a whole, matching the empty-selection presentation
of bands 1 and 2.

Interactivity. The four Can-X checkboxes commit through
new setCanCycle / setCanHit / setCanBeHit / setCanTick
edits, with multi-select tri-state behaviour matching
the Mute and Hide checkboxes in Band 1. beatsPerCycle
is a numeric field with the same scroll-wheel and
validator-driven commit lifecycle as Band 2's numeric
fields, with min 1; disabled when canCycle is unchecked
or the selection is empty. The four string fields
(cyclePattern, hasHitFunction, beenHitFunction,
onTickFunction) accept any text and commit through
setCyclePattern / setHasHitFunction / setBeenHitFunction
/ setOnTickFunction edits.

Create / Go-to buttons. Operative for the hasHit,
beenHit, and onTick rows. Both buttons disable when the
slot's Can-X checkbox is unchecked or when the selection
isn't single-object. When checked and a single object
is selected, the displayed function name (or the
proposed default if the field is empty) is looked up
in scene.functionMap. Found triggers the Go-to label
and a goToFunction edit; not-found triggers the Create
label and a createFunctionStub edit. Click on Go-to
switches the editor to the behaviors.js tab and scrolls
the named declaration's first line to the top of the
visible region (using the existing
selectTabAndScrollToFunction). Click on Create
scaffolds a stub declaration in behaviors.js, binds the
slot's function-name field to the new name on the
selected object, and switches the editor to the new
declaration. The function-name field's typed text
renders muted (opacity 0.55 inline) when the named
function doesn't yet exist in behaviors.js, signalling
the slot's not yet wired up; the field's empty-state
placeholder shows the proposed default name in the
same muted style. Default proposed name is
slotName_objectId, e.g. onTick_sp_a3f7.

Band 4 stub. The first row carries the Code Location
radio (Here / Code Tab) drawn as proper circular radio
buttons (filled circle for the selected option, empty
ring for the unselected). The radio is visually present
but inactive in this commit; click handlers stay
unwired pending the move-semantic design (which decides
what happens to the cyclePattern body when the user
flips between Here and Code Tab). Stage 3 will fill
in the rest of this band with the CodeMirror editor
for the cyclePattern body when Code Location is set
to Code Tab, and will activate the radio.

Deferred. The canCycle row carries no Create / Go-to
button this commit. Its cyclePattern field has dual
interpretation depending on cyclePatternLocation
(inline mini-notation when Here, function name when
Code Tab), and with the Code Location radio inactive
the field stays in the Here interpretation. Adding
Create there would either scaffold a function whose
name is the typed mini-notation pattern (broken) or
commit to a behaviour that hasn't been settled. The
button lands on the canCycle row alongside the radio
activation in a later stage. Stage 4 will add
validateFunctionName for the three function-name fields
and the appropriate parser for cyclePattern; Stage 2B
uses an identity validator that accepts every input
as ok.

New scaffolding in sceneEditor.js. Ten new exported
mutators for the callback-slot fields, each a thin
wrapper over the existing generic helpers
(setBooleanFieldOnSelection for the four Can-X bools,
setStringFieldOnSelection for the four function-name
strings and the cyclePatternLocation, setFieldOnSelection
for beatsPerCycle as a Math.round-ed integer clamped to
min 1). Plus a new scaffoldCallbackSlotFunction that
takes a behaviors.js source string, a function name,
and a slot key (one of "hasHit", "beenHit", "onTick"),
appends a stub declaration if one with the given name
isn't already present at the top level, and returns
the new content along with an alreadyExists flag.
The stub body is generic — section 27's ctx contract
for these slots is still being settled, so the body
stays empty for the composer to fill in once that
contract lands.

New methods in inspector.js. _buildBandCallbackSlots
draws Band 3's five rows. _buildBandCodeMirror draws
the Band 4 stub with the Code Location row.
_buildCodeLocationRadio draws the circular radio
buttons inline-styled for cross-browser consistency,
without click handlers. _buildSlotField is a slot
function-name field with placeholder support and the
function-doesn't-exist muted treatment. _buildSlotButton
is the Create / Go-to button. _functionExistsInScene
consults scene.functionMap. The module-level helper
proposedFunctionName composes slotKey_id from a slot
key and an object's id.

Edit handlers in main.js. Two new ones beyond the ten
slot-field setters: createFunctionStub (scaffold, bind,
navigate) and goToFunction (switch tab, scroll).

Not in scope. The cyclePattern field is still just a
text field — no live mini-notation parsing, no inline
errors. The Code Location radio is inert. The canCycle
row's Create / Go-to button is deferred. Multi-select
disables Create / Go-to since the proposed name is
per-object.
