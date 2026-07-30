---
title: Character Persistence & Results Restructure - Plan
type: feat
date: 2026-07-30
topic: character-persistence-and-results-restructure
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Character Persistence & Results Restructure - Plan

## Goal Capsule

- **Objective:** Give the optimizer memory, and make a saved build easy to return to and to share. Let a user name and save a character — its inputs *and* its solved loadout — to the browser, reload it straight into a restructured Results view, export/import saved data under a durable backward-compatibility contract, and export a single loadout as a shareable Markdown/CSV/print artifact.
- **Product authority:** User (single-owner personal project).
- **Delivery:** Three phases, each a candidate PR. **Phase 1** persistence + versioned backup and **Phase 2** Results restructure are mutually independent and may ship in either order. **Phase 3** share exports depends on Phase 1 (U12 needs U2's snapshot shape; U13 hangs share controls on U6's Export & Data Management tab), so it ships after Phase 1, not before.
- **Open blockers:** None. The catalog-build-identifier prerequisite is now planned (U1). The exports-scope question is resolved — share exports are in scope, and the objective above carries the sizing goal. One definition (an "unrealized upgrade") is deferred to implementation (see Open Questions).
- **Product Contract preservation:** Product Contract requirements (R1–R22) unchanged. The Goal Capsule objective was extended with a loadout-sharing goal to give R16/R17 a traceable objective (resolves the review's deferred exports-scope call-out).

---

## Product Contract

### Summary

Add local persistence to the DDO Loadout Optimizer. A user gives a character a name in the Character tab and saves it; the save captures the character basics, gear pool, ranked priorities, slot constraints, and a snapshot of the last solved loadout. Reloading a saved character lands directly in Results with that build already shown — no wait. Alongside persistence, restructure the Results view (equipment becomes the first of the second-half tabs, tabs move up under the summary bar, Adjust & re-solve moves beneath them) and add an Export & Data Management tab with versioned JSON backup/restore plus one-way Markdown and CSV loadout exports.

### Problem Frame

Today the optimizer holds all state in memory. Close the tab and every character, every ranked-priority set, and every solved build is gone — a user rebuilding the same character re-enters basics, re-ranks priorities, and re-solves from scratch. Priorities are inherently per-character (a reaper build and a raid build rank different stats), so the natural unit to persist is the character. The Results view has also grown organically: the equipment paperdoll sits above the analysis tabs, the Adjust controls sit far below, and set/deep-dive panels show more than the user needs — restructuring it is the second half of making a saved build pleasant to return to.

### Key Decisions

- **KD1. Store inputs plus a solved snapshot; load restores instantly, re-solve refreshes** (session-settled: user-directed — chosen over inputs-only-and-re-solve-on-load: matches "simply go into the results section", loads instantly, and preserves the exact build as it was when saved). The snapshot is stored **denormalized** — it holds enough item/augment/set data to render standalone, so a later catalog change cannot break a loaded build. It carries the catalog build stamp at solve time so staleness can be detected. Re-solve after load is **view-only**: it updates the in-view build but does not overwrite the saved snapshot until the user explicitly re-saves, so viewing a build can never silently destroy it.
- **KD2. One loadout per character** (session-settled: user-directed — chosen over multiple named loadouts per character: simpler model and UI; a build variant is just a separate saved character, e.g. "Sook - Reaper" vs "Sook - Raid").
- **KD3. Migrate in-window, refuse outside it** (session-settled: user-directed — chosen over best-effort-always import: refusing a too-old or too-new file is safer than silently dropping fields and corrupting a save).
- **KD4. Two export families.** A versioned JSON *backup* of all saved characters is the round-trip format and the only one bound by the compatibility contract. The per-loadout Markdown and CSV *shares* are human-readable and one-way — not re-imported.
- **KD5. Character name is the identity key.** Saving under a name that already exists updates that character after a confirm. (Inferred — flagged in synthesis; change to block/duplicate if undesired.)
- **KD6. Local-only, no accounts.** Storage is browser local storage on one device; the JSON backup export/import is the cross-device path.

### Requirements

**Persistence & storage**

- R1. Saved characters persist in browser local storage. No account, no server, nothing leaves the browser except when the user explicitly exports a file.
- R2. A saved character stores: name; character basics (ML, race, alignment, armor, weapon, artifact toggle); gear-pool selection and any owned-inventory data; ranked priorities; slot constraints; a denormalized snapshot of the last solved loadout (items, augments, crafting slots — enough detail to render standalone without the live catalog); and the catalog build stamp at solve time. Note: no catalog build identifier exists in the served data today (`web/data/items.json` carries no version field), so one must be introduced by the dataset build before the stamp and the R6 comparison have a source — see Outstanding Questions.
- R3. The character name is the identity key, and each character holds exactly one loadout. Saving under an existing name updates that character after a confirmation prompt.
- R4. The Character tab has a character-name field and a short plain-language note explaining that saved characters live only in this browser (no account, cleared if browser data is cleared, moved between devices via export).

**Character tab & load**

- R5. A user can pick a saved character from the Character tab and go straight to Results, which renders the stored (denormalized) loadout snapshot immediately, standalone, without re-solving and without depending on the live catalog.
- R6. When a loaded snapshot's build stamp is older than the current catalog build, Results shows a display-only staleness note; the note never blocks rendering. Its Re-solve action recomputes the build in view only — the saved snapshot is not overwritten until the user re-saves (which runs the R3 overwrite confirm), so clearing a staleness note can never silently replace the saved build.
- R19. A saved character can be deleted from the saved-character picker in the Character tab, behind a confirmation prompt consistent with R3's overwrite confirm. This completes create/update/delete so saves cannot only accumulate against the local-storage budget.

**Results restructure**

- R7. The equipment loadout becomes the first tab, "Loadout", in the second-half tab group. Tab order: Loadout, Ranked Priorities, Set Bonuses, Loadout Deep Dive, Alternatives.
- R8. The tab group moves directly below the optimal summary bar.
- R9. The Adjust & re-solve controls move directly beneath the tab group.
- R10. Equipment blocks render at a uniform size regardless of how much set information a block carries; each block shows the item's stats, its augment slots, and its crafting slots.
- R11. A header above the tabs explains the section — including that selecting an adjustment shows what is gained and what is lost, and then adjusts the loadout shown above.

**Set Bonuses & Deep Dive**

- R12. The Set Bonuses tab shows only the item boxes that make up each completed, applied set. Gear not contributing to an applied set bonus is not shown.
- R13. In the Loadout Deep Dive, each item notes any unrealized upgrade, and any unused augment slot is flagged to the user as available.

**Export & data management**

- R14. A new Export & Data Management tab houses all import/export.
- R15. Backup: export all saved characters as a single versioned JSON file, and import it back. Import enforces the compatibility contract (R18) and the safety rules (R20).
- R16. Share: export a single loadout as (a) a well-organized Markdown file suited to forums, and (b) a clean CSV of full loadout detail. Both carry the loadout name and the character constraints in their header. The CSV export neutralizes spreadsheet formula injection: any field value beginning with `=`, `+`, `-`, `@`, tab, or carriage return is prefixed with a single quote before writing, so a crafted character or item name cannot execute as a formula when the file is opened.
- R17. Print: a print option produces a print-friendly rendering of a loadout via the browser's print flow.
- R21. Backup import applies per character by name key: a name that collides with an existing saved character updates that character (consistent with R3), non-colliding characters are added, and no existing save is wiped unless the user explicitly chooses a replace-all restore.

**Versioning contract**

- R18. The backup JSON carries a schema version. Import migrates any file within the last 3 schema versions up to current and loads it; a file older than that window, or from a newer build than the running app, is refused with a clear message and no partial import. This 3-version contract is stated in the import/export UI.

**Data safety & integrity**

- R20. Import treats the backup file as untrusted. Beyond the version check (R18), it refuses structurally-invalid, oversized, or prototype-polluting payloads (keys such as `__proto__`, `constructor`, `prototype` are stripped or rejected, never merged onto existing state), and it builds saved characters from explicitly-validated fields rather than assigning the parsed object wholesale. Any such failure is a full refusal with no partial import.
- R22. All user-supplied strings (character name, owned-inventory fields, any name or value from an imported backup) are treated as untrusted and output-encoded wherever they are rendered into the DOM or written into an export, reusing the codebase's existing `esc()` helper on every interpolation, so a stored or imported value cannot inject executable markup and defeat R1's "nothing leaves the browser" guarantee.

### Key Flows

- F1. **Save a character**
  - **Trigger:** User has solved a build and enters a name (or re-saves an existing character) in the Character tab.
  - **Steps:** App bundles inputs + current solved snapshot + build stamp; if the name exists, confirm overwrite; write to local storage.
  - **Outcome:** Character appears in the saved list; covered by R1–R3.
- F2. **Load a character**
  - **Trigger:** User picks a saved character from the Character tab.
  - **Steps:** App restores inputs and the snapshot; navigates to Results; renders the snapshot instantly; if the build stamp predates the current catalog, shows the staleness note.
  - **Outcome:** Results shows the saved build, re-solve available; covered by R5, R6.
- F3. **Backup import**
  - **Trigger:** User imports a JSON file in the Export & Data Management tab.
  - **Steps:** Read schema version; if out-of-window (too old or newer than app) or the payload fails the safety checks (R20), refuse with a message and import nothing; otherwise migrate to current and apply per name key (R21) — colliding names update, new names are added, no wholesale wipe unless the user explicitly chose replace-all.
  - **Outcome:** Saved characters restored (merged by name), or a clear refusal; covered by R15, R18, R20, R21.
- F4. **Share export**
  - **Trigger:** User exports a loadout as Markdown, CSV, or print.
  - **Steps:** Render the loadout with a header carrying loadout name + character constraints; produce the file (or print view).
  - **Outcome:** A shareable artifact; covered by R16, R17.

### Visualization — Results layout, before → after

Illustrates R7–R11. Prose in those requirements is complete on its own; this is an on-ramp.

```
BEFORE                                  AFTER
┌────────────────────────────┐          ┌────────────────────────────┐
│ Optimal summary bar        │          │ Optimal summary bar        │
├────────────────────────────┤          ├────────────────────────────┤
│ Equipment paperdoll        │          │ Section header (explains    │
│ (above the tabs)           │          │  adjust = gained/lost)     │
├────────────────────────────┤          ├────────────────────────────┤
│ Tabs:                      │          │ Tabs: [Loadout] Ranked      │
│  Ranked | Sets | Deep | Alt│          │  Sets | Deep | Alt         │
├────────────────────────────┤          ├────────────────────────────┤
│ (active panel)             │          │ Adjust & re-solve          │
│ ...                        │          ├────────────────────────────┤
├────────────────────────────┤          │ (active panel; Loadout =    │
│ Adjust & re-solve (bottom) │          │  uniform equipment blocks)  │
└────────────────────────────┘          └────────────────────────────┘
```

### Acceptance Examples

- AE1. **Stale snapshot** — *Given* a loaded character whose build stamp is older than the current catalog build, *when* Results renders, *then* the snapshot still renders and a display-only staleness note appears with a Re-solve action; re-solving updates the in-view build and clears the note but does not overwrite the saved snapshot until the user re-saves through the R3 confirm. (R6)
- AE2. **Import version window** — *Given* a backup file, *when* imported: within the last 3 schema versions → migrated and loaded; older than 3 versions → refused as too old; from a newer build → refused as newer-than-app. No partial imports. (R18)
- AE3. **Name collision** — *Given* a save under a name that already exists, *when* the user confirms, *then* that character is updated; *when* they cancel, *then* nothing changes. (R3)
- AE4. **Deep-dive notes** — *Given* an item with an unrealized upgrade, *then* the Deep Dive notes it on that item; *given* an item with an empty augment slot, *then* the slot is flagged as available. (R13)
- AE5. **Set Bonuses filtering** — *Given* a loadout completing two set bonuses, *when* the Set Bonuses tab opens, *then* only the item boxes forming those two sets are shown; unrelated gear is absent. (R12)

### Scope Boundaries

- No accounts, login, or cloud sync — local browser storage only.
- MD and CSV exports are one-way shares; only the versioned JSON backup round-trips.
- No multiple loadouts per character (a variant is a new saved character).
- No change to the solver or optimization math — this feature persists, restructures, and exports existing outputs.

### Outstanding Questions

**Resolve before planning**

- Catalog build identifier: `web/data/items.json` carries no version/build field today, so R2's solve-time stamp and R6's "current catalog build" comparison have no source. Confirm the dataset build (`build_dataset.py` output / served data) will emit a stable catalog build/version identifier before R6/AE1 staleness can be implemented.

**Deferred to planning**

- Exact JSON envelope shape, schema-version baseline (v1), and migration mechanism. Note: at the v1 baseline the "last 3 versions" window contains only v1, so R18's migrate-old and AE2's refuse-too-old branches have no reachable input until later schema versions exist — the 3-version statement in the UI is forward policy, not launch-verifiable capability.
- Where the print view lives (dedicated print CSS on a rendered view vs. a separate print route).
- Local-storage capacity handling when many characters are saved (the ~5MB budget) — quota-exceeded behavior and any per-character size guard.
- Precise definition of an "unrealized upgrade" in the Deep Dive — likely derivable from the existing `whyThis` / Alternatives signals rather than a new computation.

### Sources / Research

- `web/wizard.js` — wizard step state (`state` object, no persistence today), `stepCharacter()` (basics, no name field), `stepResults()` (holds the Adjust & re-solve `<details>` and re-solve bar).
- `web/results.js` — `renderResults()` layout: summary banner → `readout-doll` paperdoll (equipment, currently above tabs) → `result-tabs` (Ranked / Sets / Deep Dive / Alternatives); `loadoutDeepDive`, `satisfiedSets`, `assignAugments`, `craftChips` are the panels this restructure touches.
- Verified directly: no `localStorage`/`sessionStorage`/`IndexedDB`/schema-version code exists in `web/` today — this is greenfield persistence.

---

## Deferred / Open Questions

### From 2026-07-30 review

- **Loadout-sharing objective (R16 / R17) — RESOLVED.** Share exports stay in scope; the Goal Capsule objective now names loadout sharing, giving R16/R17 a traceable goal. Delivered in Phase 3 (U12–U13). *(scope-guardian, resolved at planning)*

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Snapshot = stripped, denormalized solver result + query** (instantiates KD1). Persist the panel-consumed subset of the solver result — `status` (`"optimal"`, required: `renderResults` short-circuits to the empty state when `result.status !== "optimal"`, results.js L548), `chosen`, `effective`, `perTarget`, `breakdown`, `setsActive`, `computeScale`, `capped`, and the `*Placed` arrays — plus the `query`. Strip the non-serializable `program` (it carries the whole MILP with cyclic back-references) and never store `model`/`highs`. `chosen[]` already holds full item objects, so the build renders standalone. (The Alternatives tab needs `program`; on a loaded snapshot it degrades to its existing "could not compute alternatives" card until a view-only re-solve — acceptable.) *(session-settled: user-directed — chosen over inputs-only re-solve-on-load: instant load, exact preserved build.)*
- KTD2. **On load, rebuild the `model` scaffold with the full `buildModel(...)` signature — no solve — then render panels from the stored snapshot.** `buildViews`/`renderResults` iterate `model.worn` for the equipped-row scaffold, so the loaded snapshot needs a `model` shape but not a re-solve. Mirror the existing call at wizard.js L303–304: `buildModel(candidateItems(), buildQuery(state), dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium, dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel)`, omitting only the `solveLexicographic` step. `buildModel` is separable from solving (model.js L273) — verified cheap and deterministic. This keeps load instant while feeding the existing render path unchanged.
- KTD3. **Snapshot item references key on `source_item` / `variant_id`, never `.name`.** Live dataset variants carry no `.name` field; code written against `{name}` fixtures passes Node tests and matches nothing live (`docs/solutions/developer-experience/browser-verify-against-real-data-not-just-unit-tests.md`).
- KTD4. **Pure logic lives in new dual-exported modules, namespaced to avoid the single-global-scope trap.** Every `web/*.js` is a plain `<script>` sharing one global scope; a top-level name collision throws a load-time `SyntaxError` invisible to Node tests. New modules — `web/persist.js` (localStorage store), `web/backup.js` (serialize/migrate/validate), `web/exporters.js` (MD/CSV) — expose a single namespaced global plus `module.exports`, and every introduced name is grepped against existing `web/*.js` first.
- KTD5. **Catalog build identifier is new metadata from the dataset pipeline** (instantiates KD1's staleness stamp). Add `build_id` (content hash or build timestamp) and `schema_version` to `build_dataset.py`'s `out["metadata"]` (~L482–504); read via `dataset.metadata` at save time, compare at load. Nothing versions a build today (`seed_generated`/`pipeline_stage` are seed-derived, not build-unique).
- KTD6. **Standardize output-encoding on the global `esc()`** (`web/results.js` L238, escapes `& < > " '`), not wizard.js's weaker local `esc` (L65, omits `'`). All user-supplied strings (names, imported values) route through the global helper on every DOM/export interpolation (satisfies R22).
- KTD7. **Backup safety = version window + payload validation, both as full refusals** (instantiates KD3). Migrate within the last 3 schema versions; refuse older or newer-than-app. Independently, reject structurally-invalid, oversized, or prototype-polluting files (strip/reject `__proto__`/`constructor`/`prototype`; build characters from validated fields, never assign the parsed object wholesale). At the v1 baseline the window holds only v1 — the migrate-old / refuse-too-old branches are forward policy, tested with authored fixtures at future schema versions.
- KTD8. **localStorage store under one namespaced key** (e.g. `ddo.characters.v1`), character name as identity (KD2/KD5): save-under-existing updates behind a confirm; a variant is a new named character. Handle quota-exceeded on save with a clear message.
- KTD9. **The Results restructure re-layouts existing pieces, not net-new plumbing.** The paperdoll (`readout-doll`), the four-tab group (`result-tabs` + `wireResultTabs`, which enumerates tabs generically), the re-solve bar, and the Adjust panel all exist. Moving the equipment into a first "Loadout" tab, repositioning the tab group under the summary bar, and moving Adjust under the tabs are markup/CSS moves plus one added tab + panel.

### Assumptions

- The build is verified by a **manual browser pass** against the built `web/data/items.json` (CI runs only the unit suites); `localStorage`/`sessionStorage` are cleared between runs and ground truth is read from the live DOM, not a screenshot (per the browser-verify learning).
- New results/export CSS uses component-class selectors that own their size-forcing props (uniform blocks), and converts any outgoing hardcoded color literals in `results.js` rather than assuming a token retune reaches them (`docs/solutions/design-patterns/isolate-prototype-styles-when-porting-into-a-project.md`).

### Sequencing

Phase 1 and Phase 2 are mutually independent; Phase 3 follows Phase 1 (U12 depends on U2, U13 on U6). Within each phase, units are dependency-ordered. Phase 1: U1 → U2 → {U3, U5} → {U4, U6} → U7 (U4 after U3; U6 after U5; U7 after U3). Phase 2: U8 → U9 → U10 → U11. Phase 3: U12 → U13.

---

## Implementation Units

### Phase 1 — Persistence & versioned backup

#### U1. Catalog build identifier in the dataset pipeline

- **Goal:** Give every generated dataset a unique, comparable build identity so snapshots can detect a stale catalog.
- **Requirements:** R2, R6 (staleness substrate); KTD5.
- **Dependencies:** none.
- **Files:** `build_dataset.py` (extend `out["metadata"]`), `web/data/items.json` (generated output — do not hand-edit), `tests/test_build_metadata.py` (new).
- **Approach:** Add `build_id` (a content hash of the roster, or an ISO build timestamp) and `schema_version: 1` to the metadata dict (~L482–504). Surface nothing new in the UI yet — this is the substrate U2/U4 read via `dataset.metadata`.
- **Test scenarios:** metadata carries `build_id` and `schema_version`; regenerating with unchanged input yields a stable/again-derivable `build_id`; `schema_version` equals the current baseline.
- **Verification:** `python3 tests/run_tests.py build_metadata` passes; a rebuilt `items.json` shows the fields.

#### U2. localStorage character store module

- **Goal:** A pure, testable store for saved characters (list / save / load / delete) plus snapshot serialization.
- **Requirements:** R1, R2, R3, R19; KTD1, KTD3, KTD4, KTD8.
- **Dependencies:** U1.
- **Files:** `web/persist.js` (new, dual-exported, namespaced global e.g. `CharacterStore`), `web/index.html` (add `<script>` in load order before `wizard.js`), `tests/persist.test.js` (new).
- **Approach:** Serialize a saved character as inputs (name, ML, race, alignment, armor, weapon, artifact toggle, pool, ownedNames, priorities, slotConstraints) + a denormalized snapshot (the KTD1 subset, item refs keyed on `source_item`/`variant_id`) + `stampedBuildId`. Store all characters under one key (`ddo.characters.v1`). Name is the identity key; save-under-existing overwrites the entry (confirm handled in U3). Delete removes by name. Guard `JSON.stringify` writes with a quota-exceeded catch that returns a typed failure.
- **Patterns to follow:** dual-export guard and pure-module shape of `web/import.js`.
- **Test scenarios:** save→list→load round-trip preserves inputs + snapshot; delete removes only the named entry; save under an existing name replaces it; the serialized snapshot contains no `program`/`model` key; item refs use `source_item`/`variant_id`; a simulated quota failure returns the typed error, not a throw.
- **Verification:** `node tests/persist.test.js` passes.

#### U3. Character tab — name field, saved-character picker, save/load/delete

- **Goal:** Let the user name, save, pick, load, and delete characters from the Character tab.
- **Requirements:** R3, R4, R5, R19; KTD8.
- **Dependencies:** U2.
- **Files:** `web/wizard.js` (`state` literal L80–82: add `characterName`; `stepCharacter()` L117–150: name field + explanatory copy + saved-character picker + delete control; `wire()` character block L381–394: handlers).
- **Approach:** Add a name input and a short plain-language note ("saved only in this browser — no account; export to move between devices") to `stepCharacter`. Render the saved-character picker from `CharacterStore.list()`. Save serializes current state + `state.lastRun` snapshot via `CharacterStore`; saving under an existing name fires a confirm (R3). Delete fires an R3-style confirm. Picking a character loads it (U4). Empty-state: picker shows a "no saved characters yet" hint.
- **Patterns to follow:** existing `document.getElementById(...).onchange` wiring; the hidden-file-input display-field pattern for controls.
- **Test scenarios (browser pass):** name + Save adds the character to the picker; Covers AE3. Save under an existing name prompts and updates on confirm, no-ops on cancel; Delete prompts and removes on confirm; picker empty-state shows before any save.
- **Verification:** manual browser pass (clear storage between runs), picker reflects store state.

#### U4. Load into Results — render from snapshot, staleness note, view-only re-solve

- **Goal:** Loading a character lands in Results showing the stored build instantly, with an honest staleness signal and a non-destructive re-solve.
- **Requirements:** R5, R6, AE1; KTD1, KTD2.
- **Dependencies:** U2, U3.
- **Files:** `web/wizard.js` (load path: assign state, rebuild model scaffold, `render()`, `go("results")`; re-solve persistence gating), `web/results.js` (staleness note in the banner region; ensure `renderResults` accepts a prebuilt build).
- **Approach:** On load, rebuild the `model.worn` scaffold via the full `buildModel(...)` signature (no solve) per KTD2, then render panels from the stored snapshot subset (which must include `status: "optimal"` or `renderResults` short-circuits to the empty state). Stamp comparison: if `snapshot.stampedBuildId !== dataset.metadata.build_id`, show a display-only staleness note with a Re-solve action; the note never blocks render. Re-solve recomputes in view only — it updates the displayed build but does not overwrite the stored snapshot until the user re-saves (which runs the U3 confirm).
- **Test scenarios (browser pass):** Covers AE1. Load renders the stored build with no solve wait; a snapshot with a mismatched build id shows the staleness note and still renders; Re-solve updates the view and clears the note but leaves the saved snapshot unchanged until an explicit re-save.
- **Verification:** manual browser pass; confirm no re-solve latency on load and no silent snapshot overwrite.

#### U5. Versioned JSON backup — export, import, migration, payload safety

- **Goal:** Round-trip all saved characters through a versioned backup file that refuses unsafe or unsupported inputs.
- **Requirements:** R15, R18, R20, R21, AE2; KTD7.
- **Dependencies:** U2.
- **Files:** `web/backup.js` (new, dual-exported: `serializeAll`, `parseAndMigrate`, `validate`), `tests/backup.test.js` (new), `tests/fixtures/backup-v1.json` + authored future-version + malicious fixtures.
- **Approach:** Export wraps `{ schema_version, exported_at, characters }` and downloads via Blob + `<a download>` (net-new pattern). Import parses, checks the version window (migrate within 3, refuse older/newer with a clear message, no partial import), then validates: reject oversized payloads, strip/reject `__proto__`/`constructor`/`prototype`, build characters from explicitly-validated fields. Apply per name key (R21): colliding names update, new names add, no wholesale wipe unless the user explicitly chose replace-all.
- **Patterns to follow:** `parseTroveCsv` pure-parser shape; the wizard file-input + `FileReader.readAsText` flow (wizard.js L401–424).
- **Test scenarios:** Covers AE2. Round-trip export→import restores characters; a v1 fixture imports; an authored older-than-window fixture is refused; a newer-than-app fixture is refused; a `__proto__`-laden payload does not pollute `Object.prototype` and is refused; an oversized payload is refused; per-name import updates a colliding name and adds a new one without wiping others.
- **Verification:** `node tests/backup.test.js` passes; prototype-pollution assertion confirms `({}).polluted === undefined` after a hostile import.

#### U6. Export & Data Management surface + backup UI

- **Goal:** A backup import/export surface reachable even with an empty store, stating the 3-version contract.
- **Requirements:** R14, R15; KTD9.
- **Dependencies:** U5.
- **Files:** `web/results.js` (add a tab button in `result-tabs` L588–593 + a matching `.rpanel` section L594–597), `web/wizard.js` (also expose the Export & Data Management entry from a pre-solve step).
- **Approach:** Add the "Export & Data Management" surface hosting backup export/import, wired to `web/backup.js` (file-input + FileReader import flow; Blob download for export) with the 3-version-compatibility statement. **Reachability:** `result-tabs` only renders after a solve (`renderResults` runs post-solve), so backup import on an empty store — the first-device restore path (KD6) — must not live *only* inside the post-solve tab group. Also surface the entry point from the Character/intro step (or a persistent control) so a first-time user can restore before any solve exists. `wireResultTabs` needs no change (generic) for the in-results tab.
- **Test scenarios (browser pass):** the surface is reachable with zero saved characters and no prior solve; export downloads a file; import restores characters and shows refusals inline; the in-results tab also appears after a solve.
- **Verification:** manual browser pass starting from cleared storage and no solve.

#### U7. Output-encoding of user strings

- **Goal:** No stored or imported string can inject markup into the DOM or an export.
- **Requirements:** R22; KTD6.
- **Dependencies:** U3 (names introduced).
- **Files:** `web/wizard.js` (reconcile the local `esc` shadow so name rendering uses the global; or explicitly route names through the global helper), `web/results.js`/`web/persist.js` wherever a saved name renders.
- **Approach:** Ensure every interpolation of a user-supplied string (character name in the picker/header, imported values) uses the global `esc()` from `results.js` (escapes `'`). Audit the new render sites added in U3/U4/U6.
- **Test scenarios (browser pass):** a character named `<img src=x onerror=alert(1)>` renders as inert text in the picker, Results header, and any export; no script executes.
- **Verification:** manual browser pass with a markup-bearing name; console shows no execution.

### Phase 2 — Results restructure

#### U8. Loadout as first tab; tab group + Adjust repositioned

- **Goal:** Equipment becomes the first tab, the tab group sits under the summary bar, and Adjust & re-solve sits under the tabs.
- **Requirements:** R7, R8, R9, R11; KTD9.
- **Dependencies:** none (Phase 2 entry).
- **Files:** `web/results.js` (`renderResults` markup L576–599: add a "Loadout" `.rpanel` holding the paperdoll, reorder `result-tabs` so Loadout is first), `web/wizard.js` (`stepResults` L194–227: move the `#wz-adjust` panel to sit directly under the tabs; keep the re-solve bar), `web/styles.css`.
- **Approach:** Move `readout-doll` markup into a new first tab panel; tab order Loadout, Ranked Priorities, Set Bonuses, Loadout Deep Dive, Alternatives. Reposition the tab group directly below the `.solve-banner`. `wireResultTabs` enumerates tabs generically, so only markup + CSS move. Reserve the header region above the tabs; U11 populates the R11 copy (U8 owns placement, U11 owns content).
- **Test scenarios (browser pass):** Loadout is the first, default-selected tab and shows the equipment; tab group renders under the summary bar; Adjust sits under the tabs; all five tabs switch correctly.
- **Verification:** manual browser pass; keyboard tab navigation still works.

#### U9. Uniform equipment blocks with per-item stats, augment, and craft slots

- **Goal:** Equipment blocks are uniform in size and show each item's stats, augment slots, and crafting slots.
- **Requirements:** R10; KTD9.
- **Dependencies:** U8.
- **Files:** `web/results.js` (`equippedRow` L361–389: add stats/augment/craft chips via a pure projection; reuse `craftChips` L253–273), `web/styles.css` (component classes own `min-height`/`padding` so blocks stay uniform as content varies).
- **Approach:** Extend each equipment block to surface per-item stats plus augment and craft slots, using a pure projection that also surfaces non-affix value (augment-slot color, set membership, slot-only/crafted items) so slot-only items don't render blank (`docs/solutions/design-patterns/browse-visibility-for-separate-source-pools.md`). Fix block height via the block's own class, not element selectors (`isolate-prototype-styles` learning).
- **Test scenarios (browser pass):** every equipped slot shows stats + augment + craft slots; blocks stay the same size whether or not set info is present; a slot-only/crafted item is not blank.
- **Verification:** manual browser pass across a build with and without set bonuses and augments.

#### U10. Deep Dive — unrealized-upgrade notes and unused-augment-slot flags

- **Goal:** The Deep Dive flags per-item unrealized upgrades and available (unused) augment slots.
- **Requirements:** R13, AE4.
- **Dependencies:** U9.
- **Files:** `web/results.js` (`loadoutDeepDive` L332–355; surface `assignAugments().unplaced` L29–52; `craftChips`).
- **Approach:** Surface `unplaced` augments as an "augment slot available" note per item. For unrealized upgrades, derive from existing `whyThis` / Alternatives signals (see Open Questions for the exact definition) rather than a new computation, and annotate the item when a higher-scoring realizable option exists.
- **Test scenarios (browser pass):** Covers AE4. An item with an empty augment slot shows an "available" flag; an item with an identifiable unrealized upgrade shows the note.
- **Verification:** manual browser pass.

#### U11. Section header copy + verify Set Bonuses completed-only

- **Goal:** Add the explanatory section header and confirm the Set Bonuses tab already shows only completed sets.
- **Requirements:** R11, R12.
- **Dependencies:** U8.
- **Files:** `web/results.js` (header copy; `satisfiedSetDetail` L461–491 — verify, adjust only if it renders non-completed gear).
- **Approach:** R12 is largely existing behavior — `satisfiedSetDetail` already renders completed sets only. This unit verifies that against R12's intent and adds the R11 header explaining the section and that an adjustment shows what is gained and lost, then adjusts the loadout above. Change code only if a gap is found.
- **Test scenarios (browser pass):** Covers AE5. The Set Bonuses tab shows only boxes forming applied sets; the section header renders above the tabs.
- **Verification:** manual browser pass; no unrelated gear in the Set Bonuses tab.

### Phase 3 — Share exports

#### U12. Markdown and CSV exporters (pure)

- **Goal:** Serialize a single loadout to a forum-ready Markdown file and a clean CSV, both headed by the character name and constraints.
- **Requirements:** R16; KTD4, KTD6.
- **Dependencies:** U2 (snapshot shape).
- **Files:** `web/exporters.js` (new, dual-exported: `toMarkdown`, `toCsv`), `tests/exporters.test.js` (new).
- **Approach:** Both exporters take a saved character (or the current build) and emit a header block with the character name + constraints (ML/race/alignment/armor/weapon/pool/priorities). Markdown is organized for forums (headed sections, per-slot lines, set bonuses, crafts). CSV is full loadout detail and **neutralizes formula injection**: any field beginning with `=`, `+`, `-`, `@`, tab, or CR is prefixed with a single quote. All interpolated names pass through the global `esc()` for the Markdown path.
- **Test scenarios:** MD output carries the name + constraints header and per-slot detail; CSV carries the header row; a field value `=1+1` is emitted as `'=1+1`; a name with markup is escaped in the MD output.
- **Verification:** `node tests/exporters.test.js` passes.

#### U13. Share export UI + print view

- **Goal:** Buttons to download the MD/CSV files and a print-friendly view of a loadout.
- **Requirements:** R16, R17.
- **Dependencies:** U6 (Export tab), U12.
- **Files:** `web/results.js` (share controls in the Export & Data Management panel: MD/CSV download via Blob + `<a download>`; Print button), `web/styles.css` (`@media print` rules for the print-friendly render).
- **Approach:** Wire MD/CSV downloads to `web/exporters.js` via the Blob + anchor-download pattern. Print produces a print-friendly rendering of the current/selected loadout and calls `window.print()`; a print stylesheet hides chrome and lays out the loadout with its name + constraints header.
- **Test scenarios (browser pass):** MD and CSV download with correct headers; Print opens a clean, single-loadout print layout with the name + constraints header.
- **Verification:** manual browser pass; inspect the downloaded files and the print preview.

---

## Verification Contract

| Gate | Command / action | Applies to |
|---|---|---|
| Python unit suite | `python3 tests/run_tests.py` | U1 (dataset metadata) |
| JS unit suites | `node tests/persist.test.js`, `node tests/backup.test.js`, `node tests/exporters.test.js` | U2, U5, U12 |
| Full JS suite (CI parity) | `for t in tests/*.test.js; do node "$t"; done` | all phases |
| Manual browser pass | `python3 -m http.server 8000` → `http://localhost:8000/web/`; **clear `localStorage` + `sessionStorage` between runs**; read the live DOM (not screenshots) | U3, U4, U6, U7, U8–U11, U13 |

The manual browser pass against the built `web/data/items.json` is the real backstop — CI runs only the unit suites, and unit tests miss browser-only and single-global-scope regressions (`docs/solutions/developer-experience/browser-verify-against-real-data-not-just-unit-tests.md`). On every load, verify the browser console is clean (a namespace collision throws a load-time `SyntaxError`).

## Definition of Done

- **Phase 1:** A named character saves to `localStorage`, reloads into Results instantly showing the stored build, and can be deleted; the staleness note fires on a build-id mismatch and Re-solve is non-destructive; a versioned backup round-trips and refuses out-of-window, oversized, and prototype-polluting files with no partial import; a markup-bearing name renders inert everywhere. Unit suites for U1/U2/U5 green; browser pass clean.
- **Phase 2:** Loadout is the first tab under the summary bar, Adjust sits under the tabs, equipment blocks are uniform and show stats/augment/craft slots, the Deep Dive flags unrealized upgrades and available augment slots, the Set Bonuses tab shows only completed sets, and the section header is present. Browser pass clean across builds with and without sets/augments.
- **Phase 3:** A loadout exports to forum-ready Markdown and to a formula-injection-safe CSV, both headed with the character name + constraints, and a print-friendly view prints cleanly. `exporters.test.js` green; browser pass clean.
- **All phases:** every new module loads without a console `SyntaxError`; no absolute paths or new globals collide with existing `web/*.js`.
