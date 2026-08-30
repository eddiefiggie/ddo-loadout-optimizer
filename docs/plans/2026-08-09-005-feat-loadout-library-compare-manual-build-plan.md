---
title: Loadout Library, Compare, and Manual Building - Plan
type: feat
date: 2026-08-09
topic: loadout-library-compare-manual-build
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
planning_source: ce-plan
planned: 2026-08-20
execution: code
---

# Loadout Library, Compare, and Manual Building - Plan

## Goal Capsule

- **Objective:** Turn the app from a one-solve-at-a-time optimizer into a build library: one saved record per loadout, shareable and re-importable, comparable against each other under the benchmark's priorities, and hand-buildable down to individual augments and crafts.
- **Product authority:** This document. Requirements and Key Decisions here are settled unless a later plan supersedes them in place.
- **Sequencing:** This effort is queued behind the open player-reported correctness issues — #88 (bonus-type stacking), #91 (niche gear over holistic value), #92 (set-bonus over-fitting), #93 (data currency). A build library is built on top of the optimizer's core claim, and that claim is what players are currently disputing. Plan and ship those first.
  - **Gate status (checked 2026-08-17):** #91, #92 and #93 are CLOSED; only #88 remains open. Three quarters of this gate has lifted since the plan was written, so re-read the sequencing before assuming the effort is blocked. The plan itself was never committed — it sat in a git stash on a since-deleted branch until this recovery, which is why the note went stale unnoticed.
- **Open blockers:** None for planning. **Execution is still gated on #88** — see Sequencing. The effort ships whole rather than staged (KD12).
- **Planning status (2026-08-20):** Enriched to implementation-ready. The seven Outstanding Questions are resolved below under *Planning Contract*; #190 is folded in as U2 rather than left an external dependency, on KD12's ships-whole reasoning.
- **Execution status (2026-08-29):** The #88 gate is CLOSED, so execution is no longer gated.
  **KD12 was broken, then relaxed.** #190 shipped standalone as PR #587 on 2026-08-29
  without this plan being read — the staged intermediate state KD12 declined after two
  reviewers proposed it: a build can now be imported but not compared. Rather than leave
  the plan asserting a rule reality had already broken, KD12 was **relaxed on the same
  day, user-directed**; see the Key Decision itself for what carries over. The remaining
  units may ship independently. **U2 is therefore partly shipped and incomplete against its own requirements** —
  the envelope reader, whole-file refusal, `sanitizeCharacter` validation and the
  never-overwrite collision rule all landed, but **R12 (provenance stamping) did not**, and
  neither did U2's deep-clone regression test. Whoever resumes U2 should treat it as
  outstanding on R12, not as done.
- **Product Contract preservation:** unchanged. No R/A/F/AE ID or Key Decision was altered by planning; every question planning answered was already marked "deferred to planning".

---

## Product Contract

### Summary

One saved-build record that is both the character and the loadout. It may be written at any step; a record written after a solve additionally carries the loadout. It holds everything needed to reload, export, or compare it. Loadouts become shareable and re-importable, with a Compare tab — reachable by importing a file or picking from saved builds — that scores those against whatever build is currently loaded, judged on that build's priorities. Pinning grows teeth: a pinned item expands to its augment slots and craft options, so pinning everything is a hand-built loadout.

### Problem Frame

The app can already compare one loadout against another: the Alternatives tab scores a near-optimal alternative against the current optimum, reports a per-ranked-target delta (`web/alternatives.js:21`), and renders per-target contributor attribution (`web/results.js:427-470`). What it cannot do is take the other loadout from anywhere but its own solver. A build the player saved last month, or one another player sent them, has no way in. So comparison happens by exporting two builds and reading them side by side by eye — the workaround the site's owner uses today.

Three things block the library the app is one step away from being.

**Saving is confusing at the point of entry and lossy at the point of storage.** The intro step offers a "Character name" field whose help text reads *"Name this character to save its build and reload it later"* (`web/wizard.js:882`), implying a save that does not happen there. The real save is a second name input at the results step (`web/wizard.js:1098`). Beneath that, everything persisted passes through a hand-maintained twenty-field allowlist (`web/persist.js:15`), while a freshly-solved build renders from the full unstripped result. The same renderer therefore receives two different shapes — the full result on a solve (`web/wizard.js:1619`), the stripped snapshot on a reload (`web/wizard.js:1797`) — so anything nobody remembered to add to the allowlist appears on screen and then vanishes on reload. That has already happened: the comment at `web/persist.js:20` records `creditReport` being added after the declared-credit honesty disclosure went quiet on reload while still solving correctly.

**Sharing is a dead end.** The app writes a versioned `ddo-loadout/v1` envelope carrying the verbatim saved record plus a stable projection (`web/exporters.js:356`), designed for exactly this effort and deferred twice. Nothing reads it back — issue #190. A player can hand the file to someone; neither of them can load it.

**The solver cannot be told about an ordinary augment it did not choose.** Per-host binding already exists for the crafting families and for Set Augments: each crafting option is a per-option binary gated by its host item, and a Set Augment copy is a `y[aug,i]` binary tied to a specific host with a per-host Colorless cap (`web/solver.js:396-404`). Ordinary augments are the exception — they use aggregate per-colour capacity, with the physical placement reconstructed after the solve. That exception is deliberate and documented: a variable per physical slot "scaled with the candidate-item count and blew the program up ~100×" (`web/solver.js:277-278`). So the gap is narrower than "the model cannot bind an augment to a host", and harder than it looks: the binding pattern exists, and extending it to the full augment pool is what runs into a recorded performance wall.

### Key Decisions

- KD1. **One record is both the character and the loadout.** *(Amended 2026-08-21 by `docs/plans/2026-08-21-001-feat-wizard-structure-and-save-progress-plan.md` KTD7, which supersedes this decision's write timing: that plan owns the save model — a record may be written at any step, and one written after a solve additionally carries the loadout — and this effort builds its loadout record on top of it rather than defining a second one.)* There is no separate character entity; the record's name is the only identity, and a player who wants several builds names them separately. (session-settled: user-approved — chosen over grouping several loadouts under a character: two name inputs already confuse the entry flow, and a single record lets reload, export, and compare read one shape.)

- KD2. **The compare verdict is strictly on the benchmark's ranked priorities, with a separate labelled section for everything else.** (session-settled: user-directed — chosen over a ranked-only view: strict priority scoping is structurally blind to an unexpected strength, which is one of the three things the comparison exists to surface.)

- KD3. **The benchmark is whatever build is currently loaded.** Importing or picking a saved build puts it in the wizard and makes it the working build; solving replaces it. There is no separate designation step. (session-settled: user-directed — chosen over an explicitly pinned reference: it adds a concept the wizard does not need.)

- KD4. **Priorities come only from the working build.** An import contributes gear and character setup, never a ranking — at either import point. A comparison candidate's own priorities are ignored. (session-settled: user-directed — chosen over inheriting an imported build's ranking: an import contributes gear, never judgment.)

- KD5. **An imported loadout is re-resolved against the current catalog.** Its items are looked up in today's dataset and scored with today's values, not the values embedded in the file. (session-settled: user-directed — chosen over scoring from the file's embedded item objects: a build exported before a value correction would otherwise win on numbers the app knows are wrong, and the `Parrying` correction makes that a live case rather than a hypothetical.)

- KD6. **Manual building extends the pin list rather than adding a mode.** A pinned item expands to its augment slots and crafts; pinning all fourteen slots is a complete manual build. The pin list therefore carries two meanings — a deliberate user override and a recorded loadout — which R30 requires be kept distinguishable. (session-settled: user-directed — chosen over a separate build-it-myself pool mode: a second mode creates two ways to say "this item is fixed" that must then be kept consistent with each other.)

- KD7. **Scoring a fixed loadout runs through the solver, not beside it — with no exceptions.** "Score this, do not search" is the existing model with everything pinned: same objective, same bonus-type bucketing, same lexicographic stages. The informational section is included: its totals come from bounded extra solver stages over the already-pinned loadout, not from a projection. (session-settled: user-approved — chosen over totalling the affixes directly in a projection: that would be a second implementation of DDO's stacking rules, and a comparison that disagreed with a solve would be indistinguishable from a real finding. The projection carve-out was considered and rejected because a player who re-ranks a stat surfaced there and re-solves could get a different number back — the exact failure this decision exists to prevent — so the section is bounded to the largest N differences instead, which caps the cost that made a projection tempting.)

- KD8. **The results view renders from the saved-record shape.** The hand-maintained result allowlist stops being the seam between what is shown and what is kept. (session-settled: user-approved — chosen over keeping the allowlist and adding fields as they are missed: that mechanism has already dropped a disclosure once, and it fails silently.)

- KD9. **The don't-solve control is named "Score as-is."** (session-settled: user-approved — chosen over "Use my picks exactly" and "Skip the solve": it is succinct, says what it does rather than what it declines, and reads directly against the existing Solve action.)

- KD10. **Guidance uses the app's existing badge-and-glow vocabulary.** A badge asserts a fact about a slot or record — `pinned`, `locked empty`, `Artifact`, `verified` / `quarantined`. A glow (`is-set`, driven by `contribGlow`) asserts that something is contributing or satisfied. Every state this effort adds — hand-set versus solver-chosen, imported versus your own, verdict versus informational — extends that system rather than introducing a parallel one.

- KD11. **A comparison runs only between compatible character setups; otherwise it is declined.** Two builds are compared under one shared frame or not at all. (session-settled: user-directed — chosen over scoring the candidate under the benchmark's setup, and over scoring each under its own. Scoring under the benchmark's setup silently drops items the benchmark's character cannot wear; scoring each under its own puts two differently-scaled columns side by side, since affix values scale at each build's own ML cap. Both produce a number that looks comparable and is not, which is the failure mode the project's disclosure culture exists to prevent. Declining is the honest third answer, and it narrows what Compare can be pointed at — see R22.)

- KD12. ~~**The effort ships whole rather than staged.**~~ **RELAXED 2026-08-29 (user-directed).**
  The original decision is preserved below because its reasoning is still sound and a
  future effort may want it. It is no longer in force: #190 shipped standalone as PR #587,
  producing the staged intermediate state it declined, and rather than leave the plan
  asserting a rule reality had already broken, the constraint is lifted deliberately.
  **The remaining units may ship independently.** Two things carry over from the original
  reasoning and are NOT relaxed: a unit must not leave a player-visible half-capability
  (U1 is invisible, which is why it is the right next one), and the intermediate states
  the original decision worried about — importable but not comparable — must be disclosed
  where a player would otherwise be misled. Original decision: (session-settled: user-directed — chosen over shipping the record rework and envelope reader first: two reviewers independently proposed staging, and it was declined so that import, Compare, and manual building arrive as one coherent capability rather than an intermediate state where a build can be imported but not compared.)

The single-source consequence of KD7 and KD8 together:

```mermaid
flowchart TB
  REC[Saved build record]
  SOLVE[Solver: full model, or everything pinned]
  RES[Results view]
  EXP[Exports: MD, BBCode, CSV, print, portable, gearset]
  CMP[Compare verdict]
  ELSE[Informational section]
  SOLVE --> REC
  REC --> RES
  REC --> EXP
  SOLVE --> CMP
  SOLVE --> ELSE
  REC -.->|picks which stats to report| ELSE
```

Verdict numbers come from the solver so a comparison cannot disagree with a solve. Everything displayed or shared comes from the record so live, saved, and shared cannot disagree with each other. The informational section reads from the record only to decide which stats to report; its totals come from the solver like every other number, which is what keeps a single stacking implementation in the app.

### Requirements

**The saved build record**

- R1. A saved build is one record holding the character setup, the priorities, the gear pool choice, every pin and manual pick, and the solved loadout. Reloading it restores the build without a re-solve.
- R2. Saving happens only from the results view, after a loadout exists.
- R3. The first wizard step offers a picker that loads a previously saved build; it does not offer to name or save one. Picking a build that already has a solved loadout goes straight to its results, preserving today's fast-reload path, with the wizard steps still reachable for editing.
- R4. The results view, every export, and the compare view read the same saved-record shape for everything they display about a build. A comparison's scored values are the exception: they are recomputed by the solver per KD5 and KD7, never read from a candidate's stored solve.
- R5. When a save cannot be written because browser storage is full, the app says so and declines the save without disturbing existing builds.

**Sharing and import**

- R6. A saved build exports as a portable file that this app can read back.
- R7. Import is offered in exactly two places: the first wizard step and the compare view.
- R8. A build imported at the first wizard step becomes the working build — its gear, character setup, and manual picks load as pins. The working build's priorities are left unchanged.
- R9. A build imported in the compare view is stored alongside saved builds and becomes available as a comparison candidate. It never becomes the working build.
- R10. An imported file is untrusted third-party input and is refused whole — with a message, and nothing written to storage — unless it passes a size gate, carries the expected format identifier and a supported schema version, and its record sanitizes cleanly through the existing backup reader's pollution-key and allowlist defences. This whole-file refusal is distinct from R33's per-item partial acceptance, which applies only after a file has been accepted.
- R11. An import whose build name collides with an existing saved build never overwrites it. The app discloses the collision and stores the incoming build under a distinct name.
- R12. An imported record stores its provenance, and that provenance is shown wherever the record appears — the first step's picker, the results view, and any re-export — so a build received from another player is never presented as one the player solved.

**Compare**

- R13. Compare is a results tab that compares the working build against one or more builds picked from storage.
- R14. The player chooses which saved builds take part in a comparison.
- R15. Every comparison is scored under the benchmark's priorities; a candidate's own priorities are ignored.
- R16. A candidate is scored exactly as given — its items, augments, and crafting choices are all fixed, and nothing is searched for or substituted.
- R17. The verdict reports, for each ranked priority, the benchmark's value, the candidate's value, and the difference.
- R18. A separate section below the verdict reports the largest differences in stats neither build ranked. Its totals come from the solver per KD7, it is bounded to a fixed number of differences, and it is labelled informational and excluded from the verdict.
- R19. A comparison attributes each difference to the slot and the item or set bonus that accounts for it.
- R20. A comparison runs on an explicit action rather than on opening the tab, and a computed verdict carries a staleness signal once the working build changes underneath it.
- R21. When the benchmark was solved over a pool the candidate is not drawn from, the verdict says so — a candidate that cannot in principle exceed a lexicographic optimum on its own priorities is labelled as such rather than reported as simply worse.
- R22. A comparison runs only when the two builds' character setups are compatible enough that their numbers mean the same thing. When they are not, the app declines the comparison and names the specific incompatibility rather than producing a number.
- R23. Compatibility is judged on what would actually corrupt the comparison: a differing ML cap, because affix values scale to it, and any character gate that would make one build's items unequippable for the other. Differences that change neither are not grounds to decline.

**Manual building in the gear pool**

- R24. A pinned item can be expanded to show its augment slots and its crafting options.
- R25. Any augment slot or crafting option on a pinned item can be set by hand or left for the solver.
- R26. A loadout with every slot pinned and every augment and craft chosen is a complete manual build. No separate mode exists to create one.
- R27. A "Score as-is" control totals the loadout exactly as picked instead of searching for a better one.
- R28. With "Score as-is" off, the solver fills only what was left unset and never changes what was set.
- R29. A hand-set augment or craft is preserved in the result, the record, and every export even when it contributes nothing to the ranked priorities.
- R30. A recorded or scored loadout is carried in a channel distinguishable from the player's explicit pins, so per-item escape hatches and pin-provenance disclosures continue to read only deliberate user overrides.
- R31. A manually built loadout saves, exports, and compares through the same path as a solved one.

**Honesty and disclosure**

- R32. An imported build's affix values come from the current catalog, not from the file.
- R33. A pinned item excluded from a scored loadout for any reason — pool mode, ML cap, equippability, or catalog resolution — is named in the result rather than silently omitted. The pool-mode filter never removes an explicitly pinned item.
- R34. Every comparison candidate, imported or saved, discloses that its numbers were recomputed against the current catalog and may differ from what its own saved result shows.

**Guidance and legibility**

- R35. Every state this effort adds is expressed in the existing badge-and-glow vocabulary per KD10, not a parallel one.
- R36. A pinned item shows how much of it is set by hand and how much is left to the solver without being expanded.
- R37. Every slot, augment, and craft in a displayed loadout is attributable to whoever chose it — the player or the solver.
- R38. "Score as-is" states what it will do before it runs, and its state remains visible on the result, so a totalled loadout is never mistaken for an optimized one.
- R39. Compare states which build is the benchmark and that its priorities govern the verdict, at the point of comparison.
- R40. The verdict and the informational section are distinguishable at a glance, so a difference outside the verdict is never read as a win.
- R41. Every empty state this effort introduces names the action that fills it.
- R42. A candidate declined under R22 says which setup difference blocked it and what would make the two builds comparable, rather than reading as a failure.

The gear pool step's new composition, for R24–R28:

```mermaid
flowchart TB
  POOL["Step 2 of 4 — gear pool"]
  MODE["Pool mode: all gear / only what I own"]
  PINS["Pin specific items"]
  ITEM["Pinned item — badge shows hand-set vs left to solver"]
  AUG["Augment slots: set by hand, or leave to the solver"]
  CRAFT["Crafting options: seal, insert, Viktranium, set membership"]
  SCORE["Score as-is — total this kit, do not search"]
  POOL --> MODE
  POOL --> PINS
  PINS --> ITEM
  ITEM --> AUG
  ITEM --> CRAFT
  POOL --> SCORE
```

The Compare tab's region composition, for R13–R23 and R39–R42:

```mermaid
flowchart TB
  TAB["Compare — seventh results tab"]
  BENCH["Benchmark banner: which build, whose priorities govern"]
  PICK["Candidate picker: saved builds, plus import a file"]
  EMPTY["Empty state: no saved builds yet — names how to get one"]
  GATE{"Setups compatible? ML cap, equippability gates"}
  DECLINE["Declined: names the blocking difference and what would fix it"]
  RUN["Run comparison — explicit action, staleness signal after"]
  VERDICT["Verdict: per ranked priority, benchmark vs candidate vs difference"]
  ATTR["Attribution: which slot and item accounts for each difference"]
  INFO["Informational: bounded unranked differences, separated, not the verdict"]
  DISC["Disclosures: recomputed values, excluded items, pool asymmetry"]
  TAB --> BENCH
  TAB --> PICK
  PICK --> EMPTY
  PICK --> GATE
  GATE -->|no| DECLINE
  GATE -->|yes| RUN
  RUN --> VERDICT
  VERDICT --> ATTR
  RUN --> INFO
  RUN --> DISC
```

### Key Flows

- F1. Save a build
  - **Trigger:** A solve completes and the player wants to keep it.
  - **Steps:** The player names the build in the results view and saves. The record captures inputs, pins, manual picks, and the loadout.
  - **Outcome:** The build appears in the first step's picker and in the compare view's candidate list.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Load a shared build and beat it
  - **Trigger:** A player receives a portable loadout file that another player exported per R6.
  - **Steps:** Import at the first wizard step; the file is validated and refused whole if it does not pass. Gear and character setup load as pins; the priority ranking is untouched. The player sets or keeps their own priorities, then solves — either freeing the pins to let the solver search, or keeping them and using Score as-is to total the kit as received.
  - **Outcome:** A working build, benchmarked on the player's own priorities.
  - **Covered by:** R6, R7, R8, R10, R27, R28, R32, R38

- F3. Compare against saved builds
  - **Trigger:** The player opens Compare on a solved build.
  - **Steps:** They pick candidates from storage, or import a file that is stored as a new candidate under a non-colliding name. Each candidate is checked for setup compatibility and declined with a reason if it fails. They run the comparison explicitly; each surviving candidate is scored with everything pinned, under the benchmark's priorities and the current catalog.
  - **Outcome:** A per-priority verdict with attribution, a bounded informational section for unranked differences, and disclosure of recomputation, excluded items, and pool asymmetry.
  - **Covered by:** R9, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R33, R34, R39, R40, R42

- F4. Hand-build a loadout
  - **Trigger:** The player already knows the kit they want and wants its totals.
  - **Steps:** They pin each item in the gear pool step, expand each to choose its augments and crafts, and turn on Score as-is. Each pinned item shows at a glance what is still unset.
  - **Outcome:** A totalled loadout — not an optimized one, and labelled as such — that saves, exports, and compares like any solved build.
  - **Covered by:** R24, R25, R26, R27, R29, R30, R31, R36, R37, R38

### Acceptance Examples

- AE1. Partial manual picks
  - **Covers R25, R28.**
  - **Given** a pinned item with a blue slot set to a chosen augment and a colourless slot left unset, and Score as-is off,
  - **When** the player solves,
  - **Then** the blue slot holds exactly the chosen augment and the colourless slot holds whatever the solver picked.

- AE2. A hand-set augment that wins nothing still survives
  - **Covers R29.**
  - **Given** a hand-set augment that advances none of the ranked priorities,
  - **When** the loadout is solved, saved, and exported,
  - **Then** the augment appears in all three, rather than being dropped as contributing nothing.

- AE3. Score as-is leaves gaps empty
  - **Covers R26, R27.**
  - **Given** a loadout with eleven of fourteen slots pinned and Score as-is on,
  - **When** the player solves,
  - **Then** the three unpinned slots stay empty and the result totals only the eleven pinned items.

- AE4. A candidate is judged on the benchmark's ranking
  - **Covers R15, R17.**
  - **Given** a benchmark ranked Melee Power then Doublestrike, and a candidate whose own saved ranking is Constitution then Dodge,
  - **When** the two are compared,
  - **Then** the verdict reports Melee Power and Doublestrike for both builds and the candidate's own ranking is not shown as the basis of the comparison.

- AE5. An unexpected strength surfaces without contaminating the verdict
  - **Covers R18, R40.**
  - **Given** a candidate carrying materially more Fortification than the benchmark, and neither build ranks Fortification,
  - **When** the two are compared,
  - **Then** Fortification appears in the informational section with a solver-produced total, visually separated and labelled as outside the verdict, and the verdict itself is unchanged by it.

- AE6. An item that no longer resolves
  - **Covers R33, R34.**
  - **Given** an imported build whose belt does not resolve against the current catalog,
  - **When** it is scored,
  - **Then** the comparison runs on the remaining items, names the belt as excluded, and discloses that the candidate's numbers were recomputed.

- AE7. A pinned item the pool mode would have dropped
  - **Covers R33.**
  - **Given** an owned-only gear pool and a pinned item the player does not own,
  - **When** the loadout is scored,
  - **Then** the pin is honored rather than filtered away, or the item is named as excluded — never silently absent from the total.

- AE8. A hostile or malformed import
  - **Covers R10.**
  - **Given** a file that is not a valid portable loadout, or one carrying a newer schema version than the app supports,
  - **When** the player imports it,
  - **Then** the app refuses the whole file with a message and writes nothing to storage.

- AE9. An import that collides with an existing name
  - **Covers R11.**
  - **Given** a saved build named "Sook — Reaper" and an imported file carrying the same name,
  - **When** the import is accepted,
  - **Then** the existing build is untouched, the incoming build is stored under a distinct name, and the collision is disclosed.

- AE10. Storage is full
  - **Covers R5.**
  - **Given** browser storage that cannot accept another record,
  - **When** the player saves,
  - **Then** the app reports that the save failed and every previously saved build is still intact.

- AE11. Import on a fresh session
  - **Covers R8.**
  - **Given** a new session with no priorities set,
  - **When** the player imports a build at the first wizard step,
  - **Then** the gear and character setup load, the priority list stays empty, and the player is routed through the priorities step before anything can be scored.

- AE12. Compare with an empty library
  - **Covers R41.**
  - **Given** a player who has never saved or imported a build,
  - **When** they open Compare,
  - **Then** the tab explains that a comparison needs a saved or imported build and names how to produce one, rather than showing an empty picker.

- AE13. The benchmark changes under a computed verdict
  - **Covers R20.**
  - **Given** a comparison the player has already run,
  - **When** they re-solve and the working build changes,
  - **Then** the displayed verdict is marked stale rather than continuing to read as current.

- AE14. Incompatible setups are declined, not scored
  - **Covers R22, R23, R42.**
  - **Given** a benchmark capped at ML 30 and a candidate saved at ML 34,
  - **When** the player selects that candidate,
  - **Then** the comparison is declined, the differing ML cap is named as the reason, and the player is told what would make the two comparable — no verdict numbers are shown.

- AE15. A harmless setup difference still compares
  - **Covers R23.**
  - **Given** two builds at the same ML cap whose only difference is one the character gates do not act on,
  - **When** the player compares them,
  - **Then** the comparison runs normally rather than being declined.

### Scope Boundaries

**Deferred for later**

- The "what would I change to catch up" shopping list — turning a comparison into a set of swaps that would close the gap. It needs a real re-solve against the candidate's totals as floors, which is a different piece of work.
- A whole-kit paperdoll view of all fourteen slots. Worth revisiting once host-bound augments and crafts are proven through the pin list.

**Outside this effort**

- Making the four presentation exports (Markdown, BBCode, CSV, print) re-importable. They stay read-only; the portable envelope is the round-trip vehicle.
- Server-side sharing, accounts, or any hosted build library. This is a standing non-goal in `AGENTS.md`, not a deferral.

### Dependencies / Assumptions

- Depends on issue #190, the reader for the `ddo-loadout/v1` envelope. That envelope was designed for this effort and its `core` is the verbatim saved record, so no new persistence path is needed — but the envelope must be deep-cloned or treated as read-only, or an import would edit the user's saved build in place (`docs/plans/2026-08-03-001-feat-universal-exports-portable-round-trip-plan.md:352`). That plan also named the reader's validation contract, which R10 carries: validate the record per-record through the backup reader's sanitizer rather than through its whole-file parser.
- Assumes ordinary augments gain per-host binding. Crafting families and Set Augments already have it (`web/solver.js:396-404`), so the pattern exists; ordinary augments are the exception, and the recorded ~100× program blowup from per-physical-slot variables (`web/solver.js:277-278`) is the constraint any extension has to answer. This is the largest single piece of the effort and the shared prerequisite under compare-scoring and hand-set augments alike.
- Assumes every saved and imported build lives in browser storage. Records carry a denormalized snapshot with full item objects, so a library plus imports consumes storage quickly.
- Assumes existing saved records remain loadable. Whether they need migrating depends on how far the record shape moves under R1 and KD8.
- `variant_id` is a natural key — the item name plus an optional tier label (`src/variants.py:111`) — so it survives a dataset rebuild by construction and is a sound re-resolution key for R32 and R33. It moves only when gear-planner renames an item or changes a tier label, which is the same fragility the `.gearset` exporter already lives with. That failure mode is what R33's disclosure exists for.

### Outstanding Questions

**Deferred to planning**

- Whether per-host placement for ordinary augments replaces the aggregate per-colour capacity model or sits alongside it, and how either answer avoids re-triggering the recorded ~100× blowup. Replacing it touches the dominance pre-filter's soundness obligations; sitting alongside it risks two placement models double-booking the same physical slot, which the shared per-colour capacity constraint currently prevents.
- How many differences the informational section reports (R18's bound), and how the candidate stats are chosen before the solver stages run — the union of both builds' affixes is too large to stage exhaustively.
- What threshold makes two character setups incompatible under R23. The ML cap is exact, but "a gate that would make one build's items unequippable for the other" needs a concrete test — likely a dry-run of the candidate's items through the benchmark's equippability filter, declining when any would drop.
- Whether existing saved records need a migration, and what a record from before this effort renders as in Compare.
- How large the storage budget actually is in practice, and whether the snapshot needs slimming before a library of builds is realistic.
- How Compare and Alternatives are distinguished for the player, given that Alternatives already answers "how does another loadout differ from mine" for solver-generated candidates.
- Whether a hand-set augment becomes a hard equality constraint or a preference, since only the former survives the settle stage's placement minimization.

---

## Planning Contract

### Resolved Outstanding Questions

Each of the seven questions the Product Contract deferred to planning, answered. These are now decisions; the Outstanding Questions section above is retained as the record of what was open.

**PQ1 — Does per-host placement for ordinary augments replace the aggregate per-colour capacity model, or sit alongside it?**

**Sits alongside, for pinned assignments only.** The premise that made this the effort's largest piece does not hold as stated. The recorded ~100x blowup (`web/solver.js:360`) is specific to **per-physical-slot** variables, which "scaled with the candidate-item count". Per-**host** binding is a different shape and already ships: the Set Augment path (`web/solver.js:494-508`) creates a `y` per (augment, host) gated `y - x_host <= 0`, then one `cv` per **distinct compatible colour** — never per physical slot — with `sum(cv) - y = 0`.

Crucially those `cv` vars feed the **same `placeByColor` supply** the aggregate model consumes. So the double-booking risk this question raises is already solved in the tree: two placement models share one per-colour capacity constraint, and that constraint is what prevents them from both claiming the same physical slot.

The extension is therefore bounded: create per-host binding vars **only for augment assignments the player pinned**, leaving every unpinned augment on the aggregate model. Pinned assignments are a handful, so the variable count added is O(pins), not O(pool x candidates).

**PQ2 — How many differences does the informational section report, and how are candidate stats chosen before the solver stages run?**

Bounded at **the 8 largest absolute differences**, chosen from the union of both builds' *non-zero* affix names minus the benchmark's ranked priorities, ranked by a cheap pre-solve delta read off each record's `effective` map. The solver then runs bounded extra stages over only those 8 (KD7 keeps totals solver-derived). Eight is a display bound first — a section a reader scans at a glance — and it caps the added stages at a knowable number rather than the union's size.

**PQ3 — What threshold makes two character setups incompatible under R23?**

Two tests, both exact, no heuristics:
1. **ML cap equality.** Different caps mean differently-scaled affix values (KD11's own reasoning).
2. **Equippability dry-run.** Run the candidate's chosen items through the benchmark's existing equippability filter (race, armor proficiency, weapon style, oath, off-hand rules — the gates `web/model.js` already applies). If **any** item would be dropped, decline.

The dry-run reuses the live filter rather than reimplementing the gates, so a future gate is covered by construction. R42's message names the first failing test and the specific item or cap that tripped it.

**PQ4 — Do existing saved records need migration, and what does a pre-effort record render as in Compare?**

**No migration.** KD8 replaces the *result allowlist* as the render seam; the record's `inputs` shape is unchanged, and a pre-effort record simply lacks the new fields. Compare treats a pre-effort record as a **valid candidate** — it carries `chosen`, `effective` and `inputs`, which is everything R16 scoring needs. What it lacks is the manual-pick channel (R30), so it compares as an all-solver-chosen loadout, which is what it was. R12's provenance shows blank rather than fabricated.

**PQ5 — How large is the storage budget in practice, and does the snapshot need slimming first?**

**Measure before slimming; do not slim in this effort.** A record's snapshot carries full item objects for ~14 slots. `localStorage` is ~5MB per origin in every current browser. U1 adds a measured figure (bytes per saved record, taken from the real store) and R5's quota-exceeded path is the correctness requirement regardless of the number. Slimming is deferred to follow-up work with the measurement as its input — slimming on an unmeasured guess would trade a real disclosure for a speculative saving.

**PQ6 — How are Compare and Alternatives distinguished for the player?**

By **what they are for**, stated in each tab's own copy. **Alternatives** answers "what else could the solver have given me *for this query*" — solver-generated candidates over one ranking. **Compare** answers "how does this build do against *another build I have*" — arbitrary saved or imported records, which the solver never generated and may not be reachable from the current query at all. R21's disclosure is the seam that makes the difference concrete: a Compare candidate can be drawn from a pool the benchmark was never solved over.

**PQ7 — Is a hand-set augment a hard equality constraint or a preference?**

**A hard equality constraint**, and this is forced rather than chosen. R29 requires a hand-set augment to survive "even when it contributes nothing to the ranked priorities". The settle stage minimizes placements, so a preference-weighted assignment contributing nothing is exactly what that stage removes. Only an equality constraint survives it. This is the same reason `setAugmentsPlaced` uses `sum(cvars) - y = 0` rather than an objective term.

### Key Technical Decisions

- **KTD1. Per-host binding is added as a pinned-assignment overlay on the existing per-colour capacity model, not a replacement.** Reuses the Set Augment pattern verbatim, including sharing `placeByColor`. Rationale and the blowup distinction: PQ1. *Alternatives:* replacing the capacity model (re-opens the dominance pre-filter's soundness obligations for no benefit to unpinned augments); a parallel placement model with its own supply (the double-booking failure PQ1 names).
- **KTD2. The envelope reader (#190) is U2 of this plan, not a prerequisite.** KD12 ships the effort whole, and Compare is unreachable without import. The envelope's `core` **is** the saved record (`web/exporters.js:571-580`), so the reader is validation plus a deep clone, not a new persistence path. It validates **per-record through `backup.js`'s `sanitizeCharacter`**, not through its whole-file parser, per the origin's Dependencies note.
- **KTD3. `RESULT_KEEP` is deleted, not extended.** KD8's seam removal. Worth recording that the allowlist has grown to **27 fields** since the Product Contract cited 20 — seven more chances to have missed one, which is the argument for removing the mechanism rather than maintaining it.
- **KTD4. The manual-pick channel is a separate map from the pin list.** R30 requires the two be distinguishable; KD6 puts both in the pin list conceptually. Implemented as `slotConstraints` (unchanged, player pins) plus a new `manualPicks` map keyed by host `variant_id`. Pin-provenance and per-item escape hatches keep reading `slotConstraints` alone, so no existing pin behavior shifts.

### Sequencing and Gate Status

**Execution remains gated on #88** (bonus-type stacking accuracy). The Product Contract queued this effort behind #88/#91/#92/#93 because "a build library is built on top of the optimizer's core claim, and that claim is what players are currently disputing." #91, #92 and #93 are closed; **#88 is open**, and it is a stacking-accuracy issue — a Compare verdict computed on wrong stacking is wrong in exactly the way this effort's whole value depends on being right.

Planning proceeds regardless (it costs nothing and this artifact is the deliverable), but `ce-work` should not start until #88 closes or the gate is deliberately re-judged.

---

## Implementation Units

### U1. Record shape and the render seam

- **Goal:** Make the saved record the single shape the results view, exports, and Compare all read. Delete `RESULT_KEEP`.
- **Requirements:** R1, R2, R4, R5; KD8, KTD3.
- **Dependencies:** none.
- **Files:** `web/persist.js`, `web/results.js`, `web/wizard.js`, `tests/persist.test.js`, `tests/results.test.js`.
- **Approach:** Render from the record shape rather than the stripped result. Remove `RESULT_KEEP` and its strip step; keep `INPUT_KEYS` (a genuine input allowlist, and `backup.js` imports it). Add R5's quota-exceeded path: catch the storage write failure, surface it, leave existing builds untouched. Record the measured bytes-per-record figure PQ5 calls for.
- **Execution note:** Characterization first — capture what the results view renders for a saved build today, then prove it unchanged after the seam moves. This is a refactor of a path that has already dropped a field silently.
- **Motivation, hardened 2026-08-29:** the incident is at **five occurrences**, three of
  which were still LIVE when they were finally measured. `creditReport`, `saturationReport`
  and the #449 ceiling census were each added to the allowlist only after somebody noticed
  a disclosure had gone quiet; `intrinsicCaps` (#574), `outbidReport` (#345) and
  `packFilter` (#246) were all shipped broken and found together by a structural guard, the
  last of them on the day it was written. `outbidReport` is the sharpest: projection.js's
  own comment says it is stamped "so a shared build discloses the outbid targets without
  the recipient re-solving", which is precisely what omitting it from the allowlist
  prevented. An interim guard now fails the build on a new omission
  (`tests/persist.test.js`, "#357: every result field the disclosure layer reads survives a
  save"); U1 remains the real fix, because a guard that must be kept in step with an
  allowlist is still two places.
- **Test scenarios:**
  - A field present on a fresh solve but absent from the old allowlist (e.g. `creditReport`) now survives a save/load round trip and renders identically. *This is the `creditReport` incident as a regression test.*
  - A saved record round-trips byte-identically through save then load.
  - A quota-exceeded write surfaces a message, writes nothing, and leaves every existing saved build readable.
  - A pre-effort saved record still loads and renders (no migration — PQ4).
  - Measured: bytes per saved record over the real store, recorded in the PR.

### U2. Portable envelope reader (folds in #190)

- **Goal:** Read a `ddo-loadout/v1` file back into a record.
- **Requirements:** R6, R10, R11, R12, R32; KTD2. **Closes #190.**
- **Dependencies:** U1.
- **Files:** `web/import.js` (or a sibling `web/portable.js`), `web/backup.js`, `tests/import.test.js`.
- **Approach:** Validate the envelope, then validate `core` **per-record through `sanitizeCharacter`**, not the whole-file parser. **Deep-clone** before use — the origin's Dependencies note records that an import editing the envelope in place would edit the user's saved build. Refuse whole on any failure (R10): a message, nothing written. On name collision, store under a disclosed alternate name and never overwrite (R11). Stamp provenance (R12).
- **Test scenarios:**
  - A round trip (export then import) reproduces the record.
  - A file with a bad `format`, a bad `schema_version`, or a malformed `core` is refused whole, with nothing written to storage.
  - An import whose name collides stores alongside the existing build; the existing build is byte-unchanged afterward.
  - Mutating the imported record does **not** mutate the source envelope object (the deep-clone guard).
  - Provenance is stamped and survives a save/load round trip.
  - A file that is valid JSON but not an envelope at all is refused with the same whole-file refusal.

### U3. Per-host augment binding for pinned assignments

- **Goal:** Let the solver be told "this augment goes on this item" without re-triggering the blowup.
- **Requirements:** R25, R28, R29; KTD1, PQ1, PQ7.
- **Dependencies:** U1.
- **Files:** `web/solver.js`, `web/model.js`, `tests/solver.test.js`, `tests/constraints.test.js`.
- **Approach:** For each pinned (augment, host) pair, emit a per-host binding var following the Set Augment pattern at `web/solver.js:494-508` — gate on the host being equipped, one `cv` per distinct compatible colour, and **consume from the same `placeByColor` supply** so the two models cannot double-book. A hand-set assignment is a **hard equality** (PQ7), because the settle stage would otherwise drop a zero-contribution pick. Unpinned augments are untouched.
- **Execution note:** Add a program-size assertion alongside the behavioral tests — the whole point of KTD1 is that this does not scale with the candidate count, and that claim should be measured rather than asserted in prose.
- **Test scenarios:**
  - A pinned augment on a pinned host appears in the result on that host.
  - A pinned augment contributing **nothing** to any ranked priority still survives the settle stage (R29 — the reason PQ7 chose equality).
  - A pinned augment whose host is not equipped is reported, not silently dropped (feeds R33).
  - A pinned augment and an aggregate-model augment never both claim the same physical slot (the shared-supply guard).
  - Program size grows O(pins), not O(pool x candidates): measured var count with 0, 1 and 14 pinned assignments.
  - An unpinned solve produces a byte-identical program to today's (the no-op guard).

### U4. Manual picks channel and "Score as-is"

- **Goal:** Pin expansion down to augments and crafts, and a control that totals the loadout as picked.
- **Requirements:** R24, R26, R27, R28, R30, R31, R36, R37, R38; KD6, KD9, KTD4.
- **Dependencies:** U3.
- **Files:** `web/wizard.js`, `web/query.js`, `web/model.js`, `web/persist.js`, `tests/wizard.test.js`, `tests/constraints.test.js`.
- **Approach:** Add `manualPicks` beside `slotConstraints` (KTD4) so pin-provenance and per-item escape hatches keep reading pins alone. "Score as-is" is the existing model with everything pinned (KD7) — same objective, same stages — never a projection. R36's summary reads the two maps.
- **Test scenarios:**
  - Every slot pinned plus every augment and craft set produces a complete manual build with no search.
  - "Score as-is" off: the solver fills only unset slots and changes nothing set (R28).
  - A manual build saves, exports and compares through the same path as a solved one (R31).
  - The manual channel is distinguishable from explicit pins in the record (R30) — asserted on the persisted shape, not just in memory.
  - R36's per-item summary reports the right set/unset counts without expansion.

### U5. Compare — verdict, informational section, and compatibility

- **Goal:** The Compare tab.
- **Requirements:** R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R34, R39, R40, R42; KD2, KD3, KD4, KD11, PQ2, PQ3, PQ6. *(Enumerated rather than given as a range so every ID is greppable — the trace is the point.)*
- **Dependencies:** U1, U2, U3, U4.
- **Files:** `web/results.js`, `web/solver.js`, `web/projection.js`, `tests/results.test.js`, `tests/solver.test.js`.
- **Approach:** Candidates are scored as given (R16) — everything pinned, through the solver per KD7. The verdict covers the benchmark's ranked priorities only (R15/R17). The informational section is bounded to the 8 largest differences (PQ2) over bounded extra stages. Compatibility is the two exact tests of PQ3, with the equippability dry-run reusing the live filter. An incompatible pair is **declined** with the specific blocking difference (R42), never scored.
- **Test scenarios:**
  - The verdict reports benchmark, candidate and difference for each ranked priority.
  - A candidate's own priorities are ignored (R15) — a candidate saved with a different ranking scores under the benchmark's.
  - Differing ML caps decline with a message naming the cap (R22/R42).
  - An item the benchmark's character cannot equip declines and names that item.
  - Compatible setups that differ only in ways that do not corrupt the comparison still run.
  - The player picks which saved builds take part; an unpicked build is not scored (R14).
  - The informational section reports at most 8 rows of stats **neither build ranked** (R18), with totals from the solver rather than a projection (KD7), and is visually distinguishable from the verdict (R40).
  - A candidate from a pool the benchmark was not solved over carries R21's disclosure.
  - Every candidate carries R34's recomputed-against-current-catalog disclosure.
  - A stale verdict is signalled once the working build changes (R20).

### U6. Library surfaces, provenance and disclosure

- **Goal:** The entry picker, import points, provenance display, and every empty state.
- **Requirements:** R3, R7, R8, R9, R12, R33, R35, R41; KD3, KD10.
- **Dependencies:** U2, U5.
- **Files:** `web/wizard.js`, `web/results.js`, `web/styles.css`, `tests/wizard.test.js`, `tests/tabs.test.js`.
- **Approach:** Import at exactly two points (R7). A first-step import becomes the working build (R8); a Compare import never does (R9). Every state uses the existing badge-and-glow vocabulary (R35/KD10) rather than a parallel one. R33 names any pinned item excluded from a scored loadout and why.
- **Test scenarios:**
  - The first step offers load-a-build and does **not** offer to name or save one (R3).
  - A first-step import becomes the working build; a Compare import does not (R8/R9).
  - A pinned item dropped for each distinct reason (pool mode, ML cap, equippability, catalog resolution) is named with that reason (R33).
  - Every empty state names the action that fills it (R41).
  - New states reuse existing badge/glow classes — asserted against the class names, so a parallel vocabulary fails the test.

---

## Verification Contract

- Full Python suite and every `tests/*.test.js` file run individually (the repo's standing rule).
- **Goldens re-ratified deliberately.** U3 changes program construction; U1 changes the render seam. Any golden movement is inspected before acceptance, and `perTarget` movement on an unpinned solve is a regression, not a re-ratification.
- **Program-size measurement** from U3 recorded in the PR (var counts at 0, 1, 14 pinned assignments) — KTD1's claim is quantitative and should be reported as a number.
- **Storage measurement** from U1 recorded in the PR (bytes per saved record), per PQ5.
- Browser verification of the Compare tab and the manual-build flow against a real solve, not unit tests alone.
- Build stamp bumped in all three places if any `web/` or pipeline file changes.

## Definition of Done

- All 42 requirements are implemented or explicitly deferred in Scope Boundaries with a reason.
- #190 is closed by U2.
- `RESULT_KEEP` no longer exists.
- An unpinned solve produces a byte-identical program to today's.
- Compare declines incompatible setups rather than scoring them, and says why.
- Both measurements (program size, storage) are recorded.

---

### Sources / Research

- `web/persist.js:15` — the `RESULT_KEEP` allowlist; `web/persist.js:20` carries the `creditReport` incident that motivates KD8.
- `web/persist.js:41` — `INPUT_KEYS`, the persisted-input allowlist that `web/backup.js` imports so the two cannot drift.
- `web/persist.js:131` — the store writes by record name, which is why R11 needs a collision rule.
- `web/wizard.js:882` and `web/wizard.js:1098` — the two character-name inputs behind R3.
- `web/wizard.js:1619` and `web/wizard.js:1797` — the two shapes `renderResults` receives, full result versus stripped snapshot.
- `web/solver.js:90-107` — `slotConstraintBodies`, which today understands only `pin` and `empty`, and treats a pin whose variant is absent from the pool as a silent no-op.
- `web/solver.js:277-278` — the recorded ~100× program blowup that forced the aggregate per-colour augment model.
- `web/solver.js:396-404` — Set Augment per-host binding (`y[aug,i]`, host-gated, per-host Colorless cap), the existing pattern host-bound placement extends.
- `web/solver.js:583-727` — the host-gated crafting families (Nearly Completed, Viktranium, seal, Green Steel, joker, chosen set-membership).
- `web/solver.js:302` and `web/solver.js:1064` — the "only augments advancing a target" admission rule and the settle stage's `dropNoOpAugments`, the two mechanisms R27 has to survive.
- `web/model.js:616-626` — the TWF escape hatch that reads explicit pins as user intent, the precedent behind R28.
- `web/alternatives.js:21` and `web/results.js:427-470` — the existing per-ranked-target delta and per-target attribution that R17 and R19 build on.
- `web/results.js:248` and `web/results.js:323` — `contribGlow` and the `pd-badge` family, the visual vocabulary KD10 extends.
- `web/results.js:711-716` — the six existing results tabs; Compare is a seventh.
- `web/backup.js` — the existing reader for the saved-record shape: schema-version window, allowlist shared with `persist.js`, prototype-pollution reviver, size cap. The closest precedent for R10.
- `web/import.js` — the Trove CSV reader, cited only as the pure-parser-with-browser-global pattern.
- `src/variants.py:111` — `variant_id` construction, the natural key an imported build re-resolves against.
- `web/exporters.js:356` — `toPortableJSON` and the `ddo-loadout/v1` envelope.
- `CONCEPTS.md` — Augment (aggregate per-colour capacity), Lexicographic solve (the settle stage already pins a loadout), Gated contribution, Bonus-type bucket, Benchmark loadout.
- `docs/solutions/design-patterns/where-a-per-item-gate-may-live-in-the-solver.md` — the documented incident behind R28.
- Issue #190 — the deferred envelope reader this effort depends on.
