# 2026-05-09 — Tier 3 stage 2A: inspector cleanup

Stage 2A removes the four obsolete bands from the property
inspector. Bands 3 (message functions), 4 (auto beat
interval), 5 (beat points), and 6 (cycle parameters) all
read fields the section-27 schema reshape eliminated and
emit edits whose mutators target now-removed keys. Stage 1
left these bands as broken-when-accessed code inside
inspector.js; this stage strips them so the inspector is
coherent again, with bands 1 (identity) and 2 (geometry)
remaining as the working surface.

Scope. Class methods removed: _buildBandMessageFunctions,
_buildSlotField, _buildSlotCreateButton, _functionExistsInScene,
_buildBandAutoInterval, _buildAutoBeatIntervalCombo,
_buildBandBeatPoints, _buildModeCombo, _onModeSelected,
_buildBeatIntervalCombo, _buildRhythmStringField. Module-level
helpers removed: functionLabelsFor, functionSlotKeysFor,
editKindForSlot, proposedFunctionName, beatBandActive,
beatBandLabel, modeDisplayLabel, parseBeatsPerBar,
parseCycleDuration, canonicaliseSingleChar,
canonicaliseRhythmString, repipeForDisplay,
findOffsetAfterTypedChars, getCaretOffsetInElement,
placeCaretAtOffset, collectSelectedCurveIds, plus the popover
combo machinery (mkPopoverCombo, mkCombo, mkCreateButton,
mkColorField, _popoverCleanups, closeAllPopovers) and the
constructor's _noneStash field. The W constants block
shrinks to its band-1-and-2 subset; the validator import
list shrinks to validateName / collectOtherNames /
nameConflictsInScene / validateNumber / validateHexColor;
the beatIntervals import goes away entirely.

main.js loses the eighteen edit handlers in editor.inspector.setEditCallback
that the deleted bands emitted (setCycleDuration through
goToFunction) plus the matching sceneEditor imports. The
kept handlers are setMute, setHide, setName, the Band 2
geometry handlers (translateSelection, scaleCurveAxis, the
position / size / cursor / thickness / color setters), and
the toolbar's setCanvasW / setCanvasH.

The mutator functions in sceneEditor.js for the removed
edit kinds stay as dead exports for this commit. Cleaning
those up alongside fillMissingMusicalTimingFields,
cleanLegacyCurveFields, and renameFunctionSlotFields (also
dead after Stage 1's main.js change) is a follow-up commit
once Stage 2B's new Band 3 has settled and we can see the
final mutator surface clearly.

After this commit lands the inspector renders Bands 1 and
2 only. Selecting an object shows the same Object ID,
Name, Mute, Hide, Position, Curve Size, Cursor Size,
Sprite/Trigger Size, and Color fields as before, with the
greying logic intact. Stage 2B introduces the new Band 3
with the five callback-slot rows (cycle, beatsPerCycle plus
Code Location, hasHit, beenHit, onTick) per the section-27
plan; the Code Location radio toggles state but doesn't
yet move code anywhere. Stages 3 and 4 follow with the
CodeMirror Band 4 and the Create-button / validation work.
