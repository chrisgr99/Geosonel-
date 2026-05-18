# Fold-Back Plan: Sections 27 and 28

Working document for the planned fold-back of sections 27 and 28 into the earlier sections plus three new sections (Pattern Language, Pattern Engine, Canvas). The renumbering pass is complete; the fold-back execution is the remaining work. Captures the paragraph-by-paragraph destination map, identity and slot positions of the three new sections, per-destination diff findings comparing existing absorbed content against what each destination needs added, content marked for pruning, decisions resolved, and execution status.

## Approach

The planning pass produces destination assignments for every paragraph or near-paragraph in sections 27 and 28. Assignments fall into three categories: relocate to an existing section, relocate to one of three new sections (Pattern Language at slot 10, Pattern Engine at slot 12, Canvas at slot 13.5), or prune entirely (history, postmortem detail that does not belong in a forward-looking design doc, or content already absorbed during the recent section 3-through-26 pass).

Confidence on destination assignments is now high after reading the twelve destination sections. The pattern across the destination cluster is that the recent design pass through sections 3 through 26 already absorbed the foundational concepts from sections 27 and 28 more thoroughly than originally assumed; what remains in the fold-back is the next layer of detail (rationale, defaults, edge cases) plus entirely new material in just a few places.

## Renumbering scope and status

The renumbering pass turned out to be small and is now complete. Only three sections were actually deprecated stubs: section 10 (Beat Points and Strength Strings), section 10.5 (Unified Bound-Trigger Model), and section 12 (Phrases and the Compositor). Sections 11 (Harmony Framework), 14 (Authoring Workflow), 15 (AI Handoff), 17 (Version Management via Git), and 18 (Auto-Reload) are all substantive active sections.

Renumbering operations completed: section-10-pattern-language.md created with scaffold content (the old section-10-beat-points.md deleted), section-12-pattern-engine.md created with scaffold content (the old section-12-phrases.md deleted), section-13-5-canvas.md created with scaffold content, section-10-5-bound-trigger-model.md deleted entirely, DESIGN.md TOC updated to reflect the new structure. Sections 11 and 13 through 26 keep their current numbers. No cascading renumbering.

External references to sections 27 and 28 in HANDOFF.md, READMEs, code comments, and the diary remain valid because sections 27 and 28 become forwarding stubs at the end of fold-back execution; explicit updates to those references are optional polish rather than strictly required.

## The three new sections

Pattern Language at slot 10 (replacing the Beat Points stub). Content describing what GXW absorbs from Strudel as a language: the curated modifier vocabulary, the static and dynamic signal set including the OKLCh-derived px signals and sprite kinematic signals, the labelled-statement syntax in the Code tab, and the soft-warning rules for context-inappropriate modifier use. Composer-facing reference material.

Pattern Engine at slot 12 (replacing the Phrases stub). Content describing how GXW evaluates and dispatches patterns: queryArc plumbing, two-pass evaluation (Pass 1 for structure, Pass 2 for value refresh), one-cycle-ahead scheduling, late-refresh dispatch via Web MIDI with the audio commit window, firing-context pointer mechanism with try-finally hygiene, behaviour at pattern edit (no cancellation, current cycle plays out, new pattern takes effect at the next wrap). Implementation-facing architectural material.

Canvas at slot 13.5 (new file). Content consolidating canvas-related material from sections 13 (User Interface), 21 (Canvas Coordinate System), 22 (Sprite Physics Details), and 26 (Accessibility), plus new content for the Canvas inspector tab (image transformation tools, recent-image gallery of the last 20 imported images). Populating Canvas with content from sections 13, 21, 22, and 26 is a separate task running in parallel with the section 27/28 fold-back. The fold-back contributes a small amount of Canvas content (section 28's Visualisation subsection); the bulk comes from the consolidation pass over the four existing sections.

## Section 27 pass

The Status preamble at the top of section 27 is history, prunes.

Background and motivation explains the GXSTR pivot rationale — why GXW absorbs Strudel's pattern layer but not its scheduler. Destination: Section 24 (GeoMaestro and GeoSonix Reference) as a third lineage entry alongside GeoMaestro and GeoSonix.

The architectural split paragraph (GXW owns the WHEN, Strudel owns the WHAT) is already absorbed into Section 1 (Vision) and Section 2 (Conceptual Model) during the recent pass. The deeper detail about Strudel's three separable layers belongs in the new Pattern Engine section (slot 12).

Pattern evaluation flow is the deep mechanics — queryArc, two-pass evaluation, firing-context pointer, audio lookahead. Destination: new Pattern Engine section (slot 12).

Curated modifier vocabulary describes the promoted subset of Strudel modifiers. Destination: new Pattern Language section (slot 10).

Static and dynamic signals describes the full signal vocabulary. Destination: new Pattern Language section (slot 10) for what the signals are and how composers use them. The firing-context plumbing description goes to new Pattern Engine section (slot 12).

Tempo and scaling describes how cycleBeats and master BPM together determine wall-clock cycle period and how the runtime maps fractional cycle positions to wall-clock event times. Destination: Section 7 (Transport and Tempo) already absorbs the core concepts; the implementation math (T_event equals T_cycle plus fractional position times cycle duration) and the "GXW does not use Strudel's slow/fast/compress modifiers" note both belong in Pattern Engine rather than Section 7.

Continuous and one-shot firing describes both firing modes plus the per-source flourish duration field. The continuous-versus-one-shot framing is a pattern-engine concept; the continuous-firing detail extends Section 7 (Transport and Tempo); the one-shot-firing detail extends Section 8 (Collision Model). Cross-references handle the placement boundary.

Open questions and future considerations: most entries go to Section 25 (Open Questions) as new numbered items. Recording-and-replay is marked resolved and prunes. Each remaining entry needs inspection before fold-in.

Pre-implementation design tasks lists six items, all marked resolved. The enumeration prunes; resolved decisions relocate to Pattern Engine.

Audio firing path: full strudel, phased rollout. Choice rationale folds into Pattern Engine; Phase 1 through 4 enumeration goes to TODO.md.

One-cycle-ahead scheduling and dynamic-signal late-refresh. Design-shaping decisions go to Pattern Engine; implementation-postmortem detail prunes.

Implementation order describes Tier 1 through Tier 6. Destination: TODO.md.

## Section 28 pass

The Status preamble at the top of section 28 is history, prunes.

Object identifiers content split: the SPR1/TRG1/CRV1 scheme, idCounters persistence, fill-pass behaviour, conventional regex, new-score template counter seeding go to Section 3 (Scene Structure). The callback function naming convention (slotName_objectId) and the labelled-statement form ($objectId: expression) are already in Section 9; section 28's content adds nothing new there.

Inspector integration extends Section 13 (User Interface). Section 13 has the band layout and row content; section 28 adds deeper row-by-row detail.

Playback control during authoring extends Section 13. Section 13 has the Spacebar toggle and R rewind; section 28 adds Cmd-Period, double-click on empty canvas, engine-load auto-trigger, and the first-gesture playback gate.

Cursors, marker layout, and the cursor-as-collider model spans multiple destinations. The canCycle-replaced-by-cursor-extents-and-mute mechanism is already in Sections 4 and 6; section 28 has additional schema-level detail to fold. The lockstep illusion paragraph goes to Pattern Engine. Marker re-rendering on cycle wrap goes to Pattern Engine. Free-sprite cursors extends Section 6 with cursor persistence rules. Curves and starting velocity goes to Section 4 (schema) and Section 22 (physics/bounce mechanics). New-curve cursor extents default goes to Section 4 and Section 13. Cursor-as-collider rationale goes to Section 8. canHit derivation extension goes to Section 8. Deferred items go to Section 25. What-happens-when-curve-has-cyclePattern-but-no-cursor goes to Section 8. Mute and external collisions goes to Section 8.

Visualisation describes pattern-marker rendering options. Destination: new Canvas section (slot 13.5).

## Destination diff findings

State per destination section after reading all twelve. The pattern across the cluster is that the recent design pass through sections 3 through 26 already absorbed the foundational concepts from sections 27 and 28; what remains for fold-back is additive detail plus entirely new material in a few places.

Section 3 (Scene Structure). Object identifiers content entirely missing — needs full Object identifiers subsection added. The section's current tone is light and conceptual, so the addition should match that register rather than dropping in a dense schema discussion.

Section 4 (Curves). Has absorbed: cursor extents schema (cursorL, cursorR), visibility-and-active condition tied to mute, cursor-as-collider phrasing, markers-along-the-curve interpretation, hasHit/beenHit pairing on collision. Needs adding: vx and vy schema fields on curves with the planned curve-bounce mechanics (cross-referenced with Section 22), new-curve cursor extents default of 1 and 1 on toolbar creation, marker re-rendering on cycle wrap (which could also live in Pattern Engine), the stochastic-versus-deterministic distinction on marker visibility.

Section 5 (Triggers). Not yet read but unlikely to need much from sections 27 and 28. The cursor-as-collider note that triggers cannot self-fire is already in Section 8; trigger-specific cyclePattern firing on collision (opt-in via beenHit helper) is in Section 8. Worth a quick read during execution to confirm.

Section 6 (Sprites). Has absorbed: perpendicular cursor segment geometry, cursorL and cursorR extents with mute condition, sprite-vs-other-source collision via cursor. Needs adding: cursor persistence when sprite is stationary (defaults to last non-zero motion direction), default direction for a never-moved sprite (horizontal), distinction that sprite cyclePattern firing happens at the sprite's current position rather than at fixed markers along a path.

Section 7 (Transport and Tempo). Has absorbed: master BPM times beatsPerCycle wall-clock derivation, tempo change auto-rescales source cycles, mini-notation handles within-cycle density, determinism with bit-identical replay, triggers carry beatsPerCycle with internal-only cycle counter. Needs adding: nothing critical. The Section 27 Tempo and scaling implementation math goes to Pattern Engine; the "GXW does not use Strudel's slow/fast/compress modifiers" note also belongs in Pattern Engine. The continuous-versus-one-shot framing could fit at the Section 7/Section 8 boundary or live in Pattern Engine.

Section 8 (Collision Model). Has absorbed: cursor-as-collider rule, collider/collidee distinction, line-vs-centerpoint geometry, self-firing-is-not-collision, beenHit-then-hasHit callback order, opt-in pattern firing on collision via runtime helper from beenHit, proximity-not-colliding. Needs adding: cursor-as-collider rationale (why requiring a cursor for collision is the right shape, design-history-worthy material), mute-and-external-collisions paragraph, deeper "what happens to audio when a curve has cyclePattern but no cursor" explanation.

Section 9 (file title: "Behaviour Slots and behaviors.js"; TOC entry: "Function Slots and Context Objects" — the TOC is stale and needs aligning with the file title during this pass). Has absorbed: labelled-block syntax $objectId: expression, procedural function name convention slotName_objectId with examples, inspector Create/Go-to button behaviour, sharing by name across multiple objects, context-object concept, cyclePattern slot using firing-context rather than ctx. Needs adding: scene-load Acorn pre-processing that splits labelled statements from procedural declarations and keeps labelled blocks inert at load time, active-block highlight via cmTheme.js accent green for the currently-promoted pattern block, bidirectional navigation rules between Properties and Code tabs, pattern parse validation surfaces at Cmd-Enter time.

Section 13 (User Interface). Has absorbed: four-region layout, canvas pane and toolbar, selection model with marquee and shift-click, edit pipeline through scene.json parse-mutate-stringify-refresh, three-band inspector with explicit row content, reflow rule with fixed band heights, edit lifecycle with hard/soft/ok validation, numeric scroll-wheel adjustment, multi-select varies tri-state, Spacebar transport toggle, R rewind. Needs adding: Cmd-Period and double-click-on-empty-canvas transport toggles, engine-load auto-trigger on first user interaction, first-gesture playback gate, deeper row-by-row detail within each band (greying rules per kind, Starting State row absorbing Position and adding velocity, cycle-duration row label format, pattern row mechanics, Hide Cursor explanation).

Section 19 (Audio and MIDI Output). Solid as-is for its scope. Pattern-engine MIDI dispatch detail (late-refresh dispatch, MIDISender adapter, IAC bus preference, noteOn/noteOff structure, CC streams) belongs in Pattern Engine; cross-references handle the boundary. One small update: the opening paragraph references "Section 27" by name in the context of pattern-engine commitments — that reference needs updating to the new Pattern Engine section after fold-back.

Section 22 (Sprite Physics Details). Sprite-focused with one closing paragraph about curve cursor motion being non-physics-integrated. Needs adding: curve velocity (vx, vy) and curve-bounce mechanics in parallel structure to the sprite-vs-wall machinery. Adjacent observation: existing paragraph references "cycleSpeeds modulation list" alongside cycleDuration — cycleSpeeds may be legacy terminology from before the cyclePattern model and may warrant a clean-up during this pass.

Section 23 (Module Overview). Needs both new content and cleanup. New content: a pattern-engine module entry covering queryArc plumbing, firing-context pointer, two-pass evaluation, dispatch. Cleanup: module 5 (Curve) still references "beat points (active-beats and strength strings)" which is deprecated terminology; module 6 (BeatPoint) describes a deprecated per-position firing record that probably no longer exists as a separate module. Both should have been updated to cyclePattern terminology during the recent pass but weren't.

Section 24 (GeoMaestro and GeoSonix Reference). Needs a GXSTR lineage entry following the section's existing pattern: paragraph naming GXSTR with its location at ~/ProgrammingProjects/GXSTR, what it tried to do (integrate Strudel as both pattern engine and audio engine with the cyclist scheduler), why it didn't work (architectural mismatch between Strudel's master cycle and GXW's free-running per-source model), what GXW absorbed versus deliberately replaced. Match the section's existing tightness rather than the more elaborate framing section 27 uses.

Section 25 (Open Questions). Needs new numbered items added from section 27's Open Questions subsection (tonal integration, per-source flourish duration default, concurrent firings, mute and solo, edit-time pattern preview, sample bank loading, mini-notation autocomplete, Strudel version sync). Recording-and-replay was marked resolved in section 27 itself and prunes. Section 28's deferred items (sprite trajectory prediction for markers, sprite-vs-sprite collision) also become new entries. Cleanup: question 25 currently references the deprecated Section 10.5 (Unified bound-trigger model) — since 10.5 is deleted, this question's framing needs revisiting. The question may be obsolete given the cursor-as-collider model has subsumed it, or it may need rewriting to point to current sections.

## Pruning candidates

History and preamble at the top of section 27 and section 28 prunes.

The architectural-split framing already absorbed into Section 1 and Section 2 prunes from section 27; only the deeper three-layer detail relocates to Pattern Engine.

Pre-implementation design tasks as a six-item enumeration prunes; the resolved decisions within each item relocate to their topical destinations.

Audio firing path Phase 1 through 4 enumeration prunes to TODO.md.

Most of the One-cycle-ahead scheduling and dynamic-signal late-refresh subsection's implementation-postmortem detail prunes (noteOff dispatch subtleties, CC stream specifics, commit walker mechanics); the architectural decisions within it relocate to Pattern Engine.

Implementation order Tier 1 through Tier 6 enumeration prunes to TODO.md.

The Status preambles at the top of both sections prune.

Resolved-tasks markers throughout section 27 (the "(Resolved.)" notations) prune as the resolved content folds into its topical destinations.

## Decisions resolved

Number of new sections. Resolved: three — Pattern Language, Pattern Engine, and Canvas. Pattern Engine and Pattern Language stay separate rather than consolidated into one section. Canvas is the unified-canvas section that was previously queued as a separate follow-up; folded into the same renumbering pass.

Position of the new sections. Resolved: Pattern Language at slot 10 (replacing the Beat Points stub), Pattern Engine at slot 12 (replacing the Phrases stub), Canvas at slot 13.5 (new decimal slot immediately after User Interface).

Fate of the deprecated section stubs. Resolved: only three sections were actually stubs (10, 10.5, 12). Stubs 10 and 12 get repurposed as homes for Pattern Language and Pattern Engine. Stub 10.5 (Unified Bound-Trigger Model) was removed entirely. Sections 27 and 28 become stubs after fold-back, following the same supersession pattern.

Renumbering scope. Resolved: minimal. Sections 11 and 13 through 26 kept their current numbers. The file operations (rename plus content rewrite for sections 10 and 12, delete for 10.5, create for 13.5, plus stub conversion for 27 and 28 after fold-back) are all small.

Handling of Phase 1 through 4 audio firing path content and Tier 1 through 6 implementation order content. Resolved: move both fully into TODO.md as-is during fold-back. Duplication and shape mismatch with TODO.md's recent tier-to-component restructure get handled in a follow-up TODO review pass.

## Verification work

Read the index file at design/DESIGN.md and confirm current section titles. Done. Confirmed titles for all twenty-eight sections plus the now-deleted stubs.

Read the current state of the destination sections (3, 4, 6, 7, 8, 9, 13, 19, 22, 23, 24, 25) and identify what folds cleanly versus what needs merging or rewriting. Done. Findings captured in the Destination diff findings section above. Section 5 (Triggers) not yet read but expected to need little; will be checked during execution if anything trigger-specific surfaces.

Grep across the project for references to current sections 27 and 28. Done. References found in HANDOFF.md (calls 27 and 28 "the most current and authoritative") and TODO.md (describes design-doc modernization as "sections 1 to 26 bringing them in line with sections 27 and 28"). Both are polish updates rather than blocking; explicit fixes happen after fold-back. INSPECTOR-FIELD-AUDIT.md references the deprecated Section 10 (Beat Points generator) but that document is slated for deletion when inspector data binding ships.

Confirm the active design decisions about object identifiers, inspector band layout, cursor-as-collider, and cyclePattern are still current. Done implicitly through the destination reads — the conceptual core is consistent across the destination sections and sections 27/28.

## Fold-back execution status

Pattern Language at slot 10 — done. Content folded from section 27's Curated modifier vocabulary subsection (within-cycle, cross-cycle for continuous, cross-cycle for one-shot modifier groups plus the soft-warning rule) and Static and dynamic signals subsection (Strudel built-ins, the OKLCh-derived px image-colour signals, sprite kinematic signals, harmony-context signals). Adapted from section 27's reasoning-as-it-goes prose into a tighter reference-document tone, with cross-references to Section 9 (authoring surface for labelled-statement pattern blocks), Section 12 (Pattern Engine for firing-context mechanism), and Section 11 (Harmony Framework for deferred tonal signals). Structural choices: h3 subsection headers matching Section 9's pattern, bullet lists for the signal definitions where each entry is a distinct definition.

Pattern Engine at slot 12 — done. Content folded from section 27's deeper architectural-split material, Pattern evaluation flow, One-cycle-ahead scheduling, dynamic-signal late-refresh dispatch, firing-context pointer mechanism, continuous-and-one-shot firing, pattern edits and per-source state, lockstep with cursor sweep, audio commit window, and Strudel global state initialisation. Also picked up the Mute and solo gating note. Subsections organised: Layer separation, Pattern evaluation flow, One-cycle-ahead scheduling and late-refresh dispatch, Dynamic signals and the firing-context pointer, Continuous and one-shot firing, Pattern edits and per-source state, Cursor-sweep lockstep, Initialization and the audio commit window, Mute and solo. Implementation-postmortem detail (commit walker internals, noteOff dispatch subtleties, CC stream specifics) pruned per the plan.

Canvas at slot 13.5 — done for the section 28 Visualisation subsection (static glyphs at edit time for deterministic patterns, after-the-fact breadcrumbs for stochastic ones, the hybrid mode that selects between them at parse time). Framing paragraph notes that the section currently covers only pattern-marker visualisation; the broader Canvas consolidation pass folding content from sections 13, 21, 22, and 26 plus new inspector-tab content remains a separate later task.

Section 3 Object identifiers subsection — done. Section 3 already had the Object identifiers content substantively absorbed during the recent design pass (the SPR/TRG/CRV scheme, idCounters persistence, fill-pass, conventional regex, new-score template counter seeding all present). The fold-in added the callback function naming convention extension (`hasHit_SPR4`, `beenHit_SPR4`, `onTick_SPR4`) and a cross-reference to Section 9 for the file-level structure of behaviors.js. The transition-from-hex-format note from section 28 is omitted as historical noise; the project is early enough that no significant body of old-format scores needs the migration warning.

Section 4 curve vx/vy schema and new-curve cursor defaults — done. Cycle pattern paragraph updated with marker re-rendering on cycle wrap and stochastic-vs-deterministic distinction; cross-reference updated from "section 27" to Section 10. Cursor paragraph extended with the toolbar-creation default of cursorR=1 and cursorL=1 plus the schema-default-0 contrast. New Starting velocity paragraph added between Cycle length and Stop at cycle, describing vx/vy fields, the inside-only canvas-boundary reflection rule, and the bounding-box-versus-per-shape geometric test equivalence for the current line/ellipse/piste shape types.

Section 6 sprite cursor edge cases (persistence when stationary, default direction) — done. Cursor paragraph extended with cursor persistence rule (cursor stays in last non-zero motion direction when sprite is stationary) and default horizontal direction for never-moved sprite. Cycle paragraph extended with the distinction that sprite cyclePattern firing happens at the sprite's current position rather than at fixed markers along a path, so a wandering sprite's audio output tracks wherever the sprite is at each event time.

Section 7 cross-references to Pattern Engine — done. Within-cycle event density paragraph in Duration specification picks up a cross-reference to Section 10 (curated modifier vocabulary) and Section 12 (evaluation flow). The rest of Section 7 is left as-is; the implementation math (T_event derivation) lives in Pattern Engine, not in Section 7.

Section 8 cursor-as-collider rationale and mute-and-external-collisions — done. Three new paragraphs added: Why a cursor is required (rationale for the cursor-as-collider rule, explaining why requiring a cursor for collision dissolves the point-vs-point degeneracy), Mute and external collisions (mute silences self-firing only; external collisions credit colliding source's hasHit and muted source's beenHit), and Pattern firing through markers (what happens to audio when a curve has cyclePattern but no cursor; external cursor sweep over markers credits Hap payload to beenHit's ctx).

Section 9 scene-load Acorn pre-processing, active-block highlight, bidirectional navigation rules, parse validation surfaces — done. Two new paragraphs added to behaviors.js structure subsection (Acorn pre-processing splitting labelled statements from procedural declarations to keep labelled blocks inert at load time, scene-runtime-cache separation explanation). Two new paragraphs added to Authoring with the inspector subsection (active-block highlight via cmTheme.js accent green based on text-equality with cyclePattern, two-surface validation explanation rejecting live-parsing). Updated "section 27" reference at end of Score-wide helpers to "Section 12 (Pattern Engine)". New "### Navigating between Properties and Code tabs" subsection added covering Create/Go-to navigation plus tab-following-selection rules. DESIGN.md TOC entry renamed from "Function Slots and Context Objects" to "Behaviour Slots and behaviors.js" to match the file title.

Section 13 Cmd-Period and double-click transport toggles, engine-load auto-trigger, first-gesture playback gate, deeper row-by-row band detail — done. Property inspector paragraph extended with greying-rules-per-kind (curve dimensions for curves, cursor extents for curves and sprites, etc), Starting State row absorbing position plus velocity, Hide Cursor checkbox storing into mute field with cursor-as-collider model reference (Section 8). New "Transport toggle gestures" paragraph covering all three gestures (Spacebar with text-input exception, Cmd-Period everywhere, double-click on empty canvas background). New "Engine-load auto-trigger" paragraph covering first-user-interaction trigger with the three transport gestures gated on engine load. Keyboard shortcuts list updated to add Cmd-Period and clarify Spacebar's text-input exception. Cross-reference to Section 9 updated to capital S.

Section 19 reference update from "Section 27" to Pattern Engine — done. The opening-paragraph reference to "the Strudel pattern-engine commitments documented in Section 27" updated to "the Strudel pattern-engine architecture documented in Section 12 (Pattern Engine)". The follow-on sentence about Section 27 documenting packaging boundaries and staged adoption plan is dropped since that content fragments across Pattern Engine, TODO.md, and Section 24.

Section 22 curve velocity and curve-bounce mechanics — done. Existing Curve cursor motion paragraph updated to reference beatsPerCycle correctly (replacing the stale cycleDuration and cycleSpeeds modulation list reference) and to mention all three target kinds (triggers, sprites, curve markers) for continuous-collision detection. New Curve velocity is physics-integrated paragraph added describing vx/vy translation per simulation tick, the inside-only boundary reflection, and the bbox-versus-per-shape test equivalence for current shapes. Forward-looking nature of curve velocity flagged with reference to TODO.md.

Section 23 pattern-engine module entry plus cleanup of stale Curve and BeatPoint module descriptions — done. Module 5 (Curve) description rewritten to use cyclePattern terminology and mention vx/vy starting velocity, cursor extents, and behaviour slot bindings. Module 6 (BeatPoint, deprecated) replaced with PatternEngine entry covering queryArc plumbing, firing-context pointer, two-pass evaluation, one-cycle-ahead populate, late-refresh dispatch, and cross-references to Section 10 and Section 12. Module 11 (Phrase) marked as deprecated and superseded by PatternEngine. Closing note extended with v2.5 changes (PatternEngine addition subsuming BeatPoint and Phrase). Numbering preserved to avoid invalidating references elsewhere in the design doc.

Section 24 GXSTR lineage entry — done. Section title updated to "GeoMaestro, GeoSonix, and GXSTR Reference" and the corresponding DESIGN.md TOC entry refreshed. Intro sentence updated to reflect the three lineages. GXSTR paragraph inserted after GeoSonix with archive path, what GXSTR attempted, why the cyclist-scheduler integration produced an architectural mismatch with GXW's per-source clock model, and cross-references to Section 10 (Pattern Language) and Section 12 (Pattern Engine). Two new lists added: "Carried forward from GXSTR" (Strudel as pattern-language layer, superdough, static signals, no-build browser stack, module structure) and "Diverged from GXSTR" (no cyclist scheduler, per-source cycle counters, two-pass evaluation, direct math from fractional position to wall-clock, one-cycle-ahead scheduling with late-refresh dispatch).

Section 25 new open-question entries from section 27 plus question 25 cleanup (deleted Section 10.5 reference) — done. Question 25 rewritten from "Unified bound-trigger model" (which referenced the deleted Section 10.5) to a new question about marker-collision firing mechanism details (the cursor-as-collider model from v2.5 has subsumed the substance of the old question; what remains is the implementation-detail question about how beenHit's ctx receives the Hap payload on marker collision). Nine new questions added (27-35) covering: tonal integration, per-source flourish duration default, concurrent firings cycle-counter semantics, edit-time pattern preview affordance, sample bank loading approach, mini-notation autocomplete, Strudel version sync, sprite trajectory prediction for markers, sprite-vs-sprite collision. Section 27's recording-and-replay open question was marked resolved in section 27 itself and pruned rather than relocated. Mute and solo became a subsection in Pattern Engine and is not an open question anymore.

TODO.md absorption of Phase 1-4 and Tier 1-6 content — done as a no-op. TODO.md's component-based restructure (Pattern firing primitive, Dynamic signals, MIDI output, Canvas rendering, Inspector, Code tab and behaviors.js, Audio output) already captures the substance of section 27's Phase 1-4 audio firing path content and Tier 1-6 implementation order content. Doing a verbatim move would have created the duplication that the deferred review pass was supposed to handle. The substance is captured component-by-component; the Tier framing has been retired.

Sections 27 and 28 stub conversion — done. Section 27 converted to a supersession stub with a destinations list covering: Background and motivation → Section 24; The architectural split → Sections 1, 2, 12; Pattern evaluation flow → Section 12; Curated modifier vocabulary → Section 10; Static and dynamic signals → Section 10 (firing-context mechanism in Section 12); Tempo and scaling → Section 7 (math in Section 12); Continuous and one-shot firing → Section 12; Open questions → Section 25 entries 27-33; Pre-implementation design tasks → resolved decisions in Section 12, otherwise pruned; Audio firing path → Section 12 plus TODO.md; One-cycle-ahead scheduling → Section 12; Implementation order → TODO.md. Section 28 converted to a supersession stub with a destinations list covering: Object identifiers → Section 3 (and naming-convention extension in Section 9); Inspector integration → Section 13 (and Code tab role in Section 9); Playback control → Section 13; Cursors, marker layout, cursor-as-collider → Sections 4, 6, 8, 22; Visualisation → Section 13.5; Deferred items → Section 25 entries 34-35.

HANDOFF.md and TODO.md polish updates removing the "sections 27 and 28 are most current" framing — done. HANDOFF.md's reference-list line updated from "Sections 27 and 28 ... are the most current and authoritative" to a forwarding-stubs framing, and from "organised by tier" to "organised by component". TODO.md's Other ongoing items section had the design-doc modernization item removed (the work is now complete) and the per-source flourish duration default item rephrased to drop the Tier 5 reference.

## Remaining work in four chunks

The remaining fold-back work groups into four topical chunks. Each chunk is one commit roughly, possibly two for the larger ones. Order is significant only for chunk four (TODO absorption before stub conversion so the tier and phase content has its new home before the source is reduced to a stub); within each of the first three chunks the order is flexible.

### Chunk 1 — Cursor-as-collider physics cluster

Sections 4 (Curves), 6 (Sprites), 8 (Collision Model), and 22 (Sprite Physics Details). Topically coherent: schema and behaviour for cursor extents, velocity, and collision across the three object kinds plus the physics that runs against them. Sections 4 and 22 cross-reference each other on the bounce mechanics, so landing them in the same session keeps the references mutually accurate.

Section 4 picks up vx and vy schema fields on curves with the planned curve-bounce mechanics, the new-curve cursor extents default of 1 and 1 on toolbar creation, marker re-rendering on cycle wrap, and the stochastic-versus-deterministic distinction on marker visibility. Section 6 picks up cursor persistence when sprite is stationary, default direction for never-moved sprite, and the distinction that sprite cyclePattern firing happens at the sprite's current position rather than at fixed markers. Section 8 picks up the cursor-as-collider rationale, the mute-and-external-collisions paragraph, and the deeper "what happens to audio when a curve has cyclePattern but no cursor" explanation. Section 22 picks up curve velocity and curve-bounce mechanics in parallel structure to the sprite-vs-wall machinery, plus the cycleSpeeds-versus-cyclePattern terminology check.

### Chunk 2 — Authoring surface cluster

Sections 9 (Behaviour Slots and behaviors.js), 13 (User Interface), and Canvas at slot 13.5. All three concern how the composer authors and interacts with the score. Section 13 cross-references Section 9 on the Code tab's role, so doing them in the same session keeps the boundary clean.

Section 9 picks up scene-load Acorn pre-processing that keeps labelled blocks inert at load time, active-block highlight via cmTheme.js accent green for the currently-promoted pattern block, bidirectional navigation rules between Properties and Code tabs, and parse validation surfaces at Cmd-Enter time. The DESIGN.md TOC entry rename from "Function Slots and Context Objects" to "Behaviour Slots and behaviors.js" lands in the same commit. Section 13 picks up Cmd-Period and double-click-on-empty-canvas transport toggles, engine-load auto-trigger on first user interaction, first-gesture playback gate, and deeper row-by-row band detail. Canvas at slot 13.5 picks up the Visualisation subsection from section 28; the larger Canvas consolidation pass from sections 13, 21, 22, and 26 remains a separate later task and is not part of this fold-back.

### Chunk 3 — Cross-references and small cleanup

Sections 7, 19, 23, and 25. Individually small but the cluster is large enough to deserve its own session.

Section 7 needs its references to Section 27 updated to point at the new Pattern Engine. Section 19 needs its opening-paragraph reference to "Section 27" updated to Pattern Engine. Section 23 needs both new content (a pattern-engine module entry covering queryArc plumbing, firing-context pointer, two-pass evaluation, dispatch) and cleanup (module 5 references "beat points (active-beats and strength strings)"; module 6 describes a deprecated per-position firing record — both need updating to current cyclePattern terminology). Section 25 picks up unresolved entries from section 27's Open Questions subsection as new numbered items plus section 28's deferred items, with section 27's recording-and-replay (marked resolved) pruning rather than relocating, and question 25's reference to the deleted Section 10.5 needing rewriting or removal.

### Chunk 4 — Wrap-up

TODO.md absorbs the Phase 1-4 audio firing path content and Tier 1-6 implementation order content from section 27 verbatim. Duplication with TODO.md's recent tier-to-component restructure gets handled in a follow-up TODO review pass. HANDOFF.md and TODO.md polish updates remove the "sections 27 and 28 are the most current and authoritative" framing. Sections 27 and 28 convert to supersession stubs following the same pattern the existing deprecated stubs use: each stub holds a placeholder paragraph naming the supersession plus pointers to the new homes for each piece of relocated content.

The chunk's internal order matters: TODO absorption before stub conversion so the tier and phase content has its new home before the source is reduced to a stub. After chunk 4 lands, fold-back is fully complete; IN_FLIGHT empties out and FOLD_BACK_PLAN can be archived, committed, or deleted depending on preference.

## Status

Plan revised, verified against destination-section reading, and execution complete. All four chunks folded; sections 27 and 28 now exist as supersession stubs pointing at the destinations of their content. The fold-back work is finished. This planning document is now historical; it can be archived (commit it as a record), included in a final fold-back commit, or deleted.
