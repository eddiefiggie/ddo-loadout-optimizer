---
title: DDOBuilderV2 Gearset Export - Plan
type: feat
date: 2026-08-06
topic: ddobuilder-gearset-export
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# DDOBuilderV2 Gearset Export - Plan

## Goal Capsule

- **Objective:** Add a sixth share export that writes a `.gearset` file DDOBuilderV2 imports directly, carrying the solved gear on top and the full build record below.
- **Product authority:** The user (project owner), who ranked import fidelity and record completeness as co-equal and chose the two-part file to get both.
- **Open blockers:** None. Q1 is resolved (KTD4); Q2 is resolved (KTD5).
- **Product Contract preservation:** Changed — added R16 (augments also listed in the record block). Planning measured that only ~70% of solar/lunar augments place through the importable block, so the record block absorbs the remainder. No existing R-ID was altered.

---

## Product Contract

### Summary

A "DDOBuilderV2" button in the Share tab downloads a `.gearset` file. The top block is the importable gear set in DDOBuilderV2's file grammar; below a blank line sits a human-readable record of the character, the solve inputs, the ranked priorities, every craft decision, and the achieved stat totals.

### Problem Frame

DDOBuilderV2 is where DDO players actually assemble and evaluate builds. Today the optimizer's five exports (Markdown, BBCode, CSV, Print, portable JSON) all target humans or this app — a player who wants the solved loadout inside DDOBuilder re-enters fourteen items by hand, then every augment and craft choice on top. That is where a proven-optimal result stops being usable.

DDOBuilderV2 already ships a gear importer with two entry points — "Import from File" (`.gearset`) and "Import from Clipboard" — so the interop surface exists and is stable. Nothing in this project targets it. The catalogs also already agree: both this project and DDOBuilder derive item names from the DDO Gear Planner, so names line up without a translation layer.

### Key Decisions

- **Target the `.gearset` file grammar, not the clipboard grammar.** (session-settled: user-directed — chosen over a clipboard-shaped export: a downloaded file matches how every other share export behaves, and the Share tab is a download surface.) The cost is real and accepted: the clipboard grammar is the only one with native craft-decision lines, so choosing the file grammar is what makes craft decisions record-only.

- **One file, two parts, split by a blank line.** (session-settled: user-directed — chosen over either import-fidelity-only or full-record-only: it delivers both with no loss.) DDOBuilderV2's file parser stops at the first empty line and ignores everything after it, so the metadata block is invisible to the importer and fully visible to a reader. The split is also what makes the metadata safe: the parser matches slot labels by substring anywhere in a line, so a metadata line containing `Weapon:` placed *above* the split would be misparsed as gear.

- **Craft decisions are recorded, never emitted as importable augments.** Expressing them as `{}` entries would make DDOBuilderV2 consume real augment slots for them, producing a build that differs from the solved one while looking successful. A silently wrong import is worse than an honest manual step.

- **No pre-validation against DDOBuilderV2's item catalog.** (session-settled: user-approved — chosen over embedding their catalog to pre-warn: 96.4% of our items already match by name, and carrying an 8,779-name list means keeping it in sync forever for a 3.7% tail.) Unmatched lines no-op on import.

- **The exporter reads the existing projection, like every other export.** The resolved view already carries character name, constraints, per-slot augments with their affixes, and per-slot crafting — this is a new renderer, not new data plumbing. It also inherits the standing invariant that new mechanics reach every export by default.

### Requirements

**The importable block**

- R1. The file opens with one line per equipped slot in DDOBuilderV2's file grammar: the slot label, a colon, the item name, then zero or more `{}` entries, with no space after the colon and no space before the first brace.
- R2. Slot labels use DDOBuilderV2's file vocabulary — `Eye`, `Head`, `Neck`, `Trinket`, `Body`, `Back`, `Wrist`, `Waist`, `Finger1`, `Feet`, `Hand`, `Finger2`, `Weapon`, `Offhand` — mapped from this project's slot names.
- R3. Item names are emitted exactly as the catalog holds them, with no normalization, because the importer compares them for exact equality.
- R4. Each placed augment emits one `{}` entry carrying its bonus type, stat name, and value.
- R5. Slots this project models that have no DDOBuilderV2 file label are omitted from the importable block and recorded in the metadata block instead.
- R6. An empty slot emits no line.

**The record block**

- R7. A single blank line separates the importable block from everything below it, and no blank line appears anywhere above it.
- R8. The record block carries the character name and the solve inputs needed to reproduce the run — level cap and floor, race, armor type, combat style and oath, gear pool, and any pinned or locked slots.
- R9. The record block carries the ranked priority list in priority order, including any per-row bounds.
- R10. The record block names every craft decision the solver made, attributed to its slot, across all crafting families the solver can choose from.
- R11. The record block reports the achieved value per ranked stat, preserving any cap disclosure the results already show.
- R12. Every line in the record block is prefixed so it reads as commentary rather than data.

**The control**

- R13. A "DDOBuilderV2" control sits alongside the existing share exports and downloads the file.
- R14. The downloaded filename uses the `.gearset` extension so DDOBuilderV2's file picker offers it by default, and incorporates the character name when one is set.
- R15. The export is available on the same terms as the other share exports, including for a loadout restored from a saved character.
- R16. The record block also lists every placed augment with the affixes it grants, attributed to its slot, so an augment the importable block fails to place is still recoverable by hand.

### Acceptance Examples

- AE1. Exact-format compliance
  - **Covers R1, R3.**
  - **Given:** the solver equips `The Ruined Vision` in Goggles.
  - **Then:** the line is `Eye:The Ruined Vision` — a space after the colon would make the parsed name `" The Ruined Vision"`, fail exact equality, and drop the item silently.

- AE2. Slot with augments
  - **Covers R1, R2, R4.**
  - **Given:** Helmet holds `Legendary Downcast Bowler` with a Solar Gem granting Seeker +4 Artifact and a Topaz granting Melee Power +12 Enhancement.
  - **Then:** one `Head:` line carries the item name followed by both `{}` entries, with no space before the first brace.

- AE3. The split is honored
  - **Covers R7, R12.**
  - **Given:** any solved loadout.
  - **When:** DDOBuilderV2 imports the file.
  - **Then:** it consumes only the lines above the blank line, and the character name, priorities, crafts, and totals below it never reach the parser.

- AE4. A craft decision does not become an augment
  - **Covers R10.**
  - **Given:** Goggles carry a Viktranium craft granting Deadly +12 Competence.
  - **Then:** no `{}` entry is emitted for it on the `Eye:` line; it appears only in the record block, attributed to Goggles.

- AE5. An unmapped slot degrades cleanly
  - **Covers R5.**
  - **Given:** the loadout fills a slot with no DDOBuilderV2 file label.
  - **Then:** the importable block omits it and the record block names both the item and the reason it could not be imported.

- AE6. An unmatched item name
  - **Covers R3.**
  - **Given:** an equipped item whose name has no counterpart in DDOBuilderV2's catalog.
  - **Then:** the line is emitted unchanged and DDOBuilderV2 skips it on import; the export neither warns nor rewrites the name.

### Scope Boundaries

- A clipboard-shaped variant matching DDOBuilderV2's other import path. The file path covers the need; the clipboard grammar is a second format to maintain.
- Importing *from* DDOBuilderV2. This export is one-way.
- Embedding DDOBuilderV2's item catalog to validate names before download.
- DDOBuilderV2 concepts this project does not model, including filigrees and personality.
- Reproducing the solve inside DDOBuilderV2. The record block is for a human to read and check against.

### Dependencies / Assumptions

- DDOBuilderV2's file grammar is read from its published source and assumed stable. It is a moving project; a grammar change would break the importable block. The record block is unaffected either way.
- Both catalogs track the DDO Gear Planner, which is what keeps item names aligned. Measured against DDOBuilderV2's 8,779 item files: 7,022 of our 8,045 non-augment items match exactly, 729 more match ignoring case and whitespace, and 294 (3.7%) have no counterpart — concentrated in `[Crafted]` items, shield `(angular)`/`(round)` variants, and joke items.
- DDOBuilderV2 places an imported augment into the first empty *compatible* slot rather than the color the solve chose. Stats are unaffected because compatibility is required, but the physical slot may differ from the app's display.
- The importer caps import files at 20KB.

### Outstanding Questions

**Deferred to implementation**

- Q3. Whether any non-Sun/Moon augment family places at a materially worse rate than the measured 70%. Only the Sun/Moon family was measured. A worse family would not change the design — R16 already carries unplaced augments — so this is calibration, not a blocker.

**Out of scope, routed elsewhere**

- Q4. Our catalog and DDOBuilderV2 disagree on at least one augment value (Lunar Gem of Haggle and Perform: ours 6, theirs 4). Found while measuring; it is a catalog-accuracy question for the affix-vocabulary track, not this export.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **A sixth renderer inside `web/exporters.js`, not a new module.** The five existing formats already share the escapers, cue table, and affix helpers, and all read `Projection.project(rec)`. A separate module would duplicate that surface and drift. `toGearset(rec)` joins the same `api` object and the same dual export.

- KTD2. **Both blocks render from one projection call.** The importable block needs `loadout[].item` and `loadout[].augments`; the record block needs `character`, `loadout[].crafting`, and `attribution`. One `Proj.project(rec)` supplies all of it, which is what keeps this export from drifting when a new mechanic lands.

- KTD3. **Slot mapping is a static two-way-safe table, not a heuristic.** Fourteen app slots map to DDOBuilderV2's fourteen file labels. `Main Hand` maps to `Weapon` and `Off Hand` to `Offhand`; emitting the app's own names would be actively wrong, because the parser tests `Hand:` before `Weapon:` and would file a weapon under Gloves. Slots absent from the table (`Quiver`, `Rune Arm`) fall through to the record block per R5.

- KTD4. **Augment `{}` entries carry bonus type, stat name, and value from the augment's first affix — resolving Q1.** The parser splits on whitespace, lowercases, and requires every token to appear in the candidate augment's description text, placing one augment per entry. A multi-affix gem therefore emits one entry, not one per affix: its tokens all appear in the single combined description (`+6 Profane bonus to Balance and Tumble`). Emitting per-affix would place two augments for one gem.

- KTD5. **Item names are emitted exactly as the catalog holds them — resolving Q2.** `FindItem` compares with `==` and nothing in the call chain trims, so normalization is a coin flip that can only turn an exact match into a miss. The 9% case-and-whitespace near-miss band is left alone; if it ever becomes worth recovering, it needs measured evidence that the differences are systematic, which this plan does not have.

- KTD6. **Augment placement is best-effort, and the record block is the safety net.** Measured against DDOBuilderV2's own `SunAndMoon.Augments.xml`, 150 of 215 name-matched solar/lunar gems have affix tokens that appear in the target description; 65 do not, because our affix vocabulary differs from their prose (`Abjuration Focus` against "abjuration dcs", `Accuracy` against "weapon attacks"). Loosening tokens to raise the rate would place the *wrong* augment, which is worse than placing none — so the tokens stay precise and R16 carries the remainder.

### Assumptions

- DDOBuilderV2's file grammar is read from source at `DDOBuilder/EquippedGear.cpp` and assumed stable; it is an actively developed project with no published format contract.
- The parser's 20KB import cap is assumed comfortably above a fourteen-slot gear block. The record block sits below the terminator and is never parsed, but it does count toward file size.
- The measured 70% augment placement rate is taken from the Sun/Moon family, the one this export's users care most about. Other augment families are assumed to behave comparably; no other family was measured.

---

## Implementation Units

### U1. Slot mapping and the importable gear block

- **Goal:** Render the top block — one line per equipped slot in DDOBuilderV2's file grammar.
- **Requirements:** R1, R2, R3, R5, R6; AE1, AE2, AE5.
- **Dependencies:** none.
- **Files:** `web/exporters.js`, `tests/exporters.test.js`.
- **Approach:** A static app-slot to DDOBuilder-label table (KTD3) drives emission in the table's order. For each chosen item, emit `<Label>:<item name>` with no space after the colon and nothing between the name and the first brace. Skip empty slots; route table-absent slots to the record block's unmapped list.
- **Patterns to follow:** the per-slot iteration in `toMarkdown` / `toCsv` over `project(rec).loadout`.
- **Test scenarios:**
  - Covers AE1. A Goggles item renders as `Eye:The Ruined Vision` — assert no space follows the colon.
  - An item name containing spaces and parentheses (`Dragonsoul Vestments (level 36)`) survives verbatim, with no normalization or trimming.
  - `Main Hand` renders as `Weapon:`, never `Main Hand:` — the label that would misparse as Gloves.
  - Covers AE5. A `Quiver` or `Rune Arm` item emits no line in the importable block and is named in the record block.
  - Covers AE6. An item whose name has no DDOBuilderV2 counterpart is emitted unchanged, with no warning and no rewrite.
  - An empty slot emits nothing — no bare `Waist:` line.
- **Verification:** the block is fourteen lines or fewer, every line matches `^<Label>:\S`, and no line contains `: `.

### U2. Augment entries on the gear lines

- **Goal:** Append each placed augment to its host item's line as a `{}` entry.
- **Requirements:** R1, R4; AE2.
- **Dependencies:** U1.
- **Files:** `web/exporters.js`, `tests/exporters.test.js`.
- **Approach:** For each host, walk the projection's assigned augments and emit one entry per augment built from its first affix (KTD4) as bonus type, stat name, value. Entries concatenate directly with no separator and no space before the first brace.
- **Patterns to follow:** `augStr` in `web/exporters.js` for how the other formats walk the same assigned-augment list.
- **Test scenarios:**
  - Covers AE2. A helmet with two augments renders one `Head:` line carrying both entries, with no space between the item name and the first `{`.
  - A multi-affix augment emits exactly one entry, not one per affix.
  - An augment whose affixes are absent emits no entry rather than an empty `{}`.
  - A host with no augments renders a bare `<Label>:<name>` line with no trailing braces.
- **Verification:** every emitted entry matches `\{[^{}]+\}` and augment count per line equals the projection's assigned-augment count for that host.

### U3. The split and the record block

- **Goal:** Terminate the importable block and render the human-readable record below it.
- **Requirements:** R7, R8, R9, R10, R11, R12, R16; AE3, AE4.
- **Dependencies:** U1, U2.
- **Files:** `web/exporters.js`, `tests/exporters.test.js`.
- **Approach:** Emit exactly one blank line after the last gear line, then the record. Every record line carries a comment prefix (R12). Sections: character and solve inputs from the projection's constraint pairs; the ranked priority list in order; per-slot craft decisions; per-slot augments with their granted affixes (R16); achieved totals with cap notes; and the unmapped-slot list from U1. Crafts never produce a `{}` entry (AE4). The importable block must contain no blank line, so any multi-line record content stays below the terminator.
- **Patterns to follow:** `constraintLines` and the attribution section in `toMarkdown`; `craftStr` for craft labels.
- **Test scenarios:**
  - Covers AE3. The first blank line is the terminator: no blank line appears above it, and every character-name, priority, craft, and total line falls after it. Blank lines below it are free — the parser has already stopped.
  - Covers AE4. A Viktranium craft appears only in the record block; the host's gear line carries no entry for it.
  - A craft-family sweep — Viktranium, Nearly Complete, seal, dino insert, set-membership, Thunder-Forged, Green Steel — each renders attributed to its slot.
  - Every ranked priority appears in order with its achieved total; a capped stat carries its cap note.
  - Covers R16. Every placed augment appears in the record block with its affixes, including one whose tokens would fail the importable match.
  - A character name containing a slot label (`Weapon:`) appears only below the split and never creates a parseable line.
- **Verification:** the file splits on the first blank line into a parseable half and a fully comment-prefixed half.

### U4. Share tab control and download

- **Goal:** Add the button and wire the download.
- **Requirements:** R13, R14, R15.
- **Dependencies:** U3.
- **Files:** `web/wizard.js`, `web/exporters.js`.
- **Approach:** Add the control alongside the five existing share buttons in the panel markup, and wire it in the share-export handler using the same `selected()` guard the others use, so an unsolved or empty build cannot produce a misleading file. Download through the shared file-download helper with the `.gearset` extension and the slugged character name. Export `toGearset` on the module's `api` object.
- **Patterns to follow:** the Portable JSON button — markup, handler, and `downloadFile` call — in `web/wizard.js`.
- **Test scenarios:** none for the DOM wiring; it mirrors five existing buttons and the repo has no DOM harness. The renderer's behavior is covered by U1-U3.
- **Verification:** the button appears in the Share tab, produces a `.gearset` download for a solved build, and shows the same guard message as the other exports when nothing is solved.

### U5. Build stamp and cache-bust

- **Goal:** Ship the web change under a new build identity.
- **Requirements:** none — repo release convention.
- **Dependencies:** U4.
- **Files:** `web/index.html`, `web/app.js`.
- **Approach:** Bump the `?v=` query on every versioned asset reference and the footer `BUILD` constant together. Both move on any `web/*.js` change; bumping one without the other makes the footer under-report which code is live.
- **Test scenarios:** `Test expectation: none -- version stamp, no behavior.`
- **Verification:** the footer build string and the asset `?v=` value both advance, and they agree.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Exporter unit tests | `node tests/exporters.test.js` | U1, U2, U3 |
| Full JS suite | `for t in tests/*.test.js; do node "$t"; done` | all units |
| Python suite | `python3 tests/run_tests.py` | regression guard |
| Manual smoke | Solve a build, download the `.gearset`, confirm the split and spacing by eye | U4, U5 |

The full JS suite runs every file because `node a.js b.js` executes only the first, and the golden solver guard catches drift nothing else does. Both suites are what the deploy workflow runs, and there is no PR CI in this repo — the local run is the merge gate.

## Definition of Done

- The Share tab offers a DDOBuilderV2 export that downloads a `.gearset` file for any solved or restored build.
- The importable block honors the exact grammar: no space after the colon, no space before the first brace, DDOBuilder's slot labels, item names verbatim.
- Exactly one blank line separates the two halves, and no craft decision appears above it.
- The record block carries character, solve inputs, ranked priorities, craft decisions, placed augments, and achieved totals.
- All 19 JS test files and the Python suite pass.
- The footer build stamp and asset cache-bust both advance.

---

### Sources / Research

- `Maetrim/DDOBuilderV2` — `DDOBuilder/EquippedGear.cpp` holds both import grammars: `ImportFromFile` and `ProcessFileLine` for the `.gearset` path, `ImportFromClipboard` and `ProcessClipboardLine` for the clipboard path. `ProcessFileLine` carries the slot-label vocabulary and the `{}` scan; `ApplyFileItemAugment` carries the token-matching rule.
- `Maetrim/DDOBuilderV2` — `DDOBuilder/GlobalSupportFunctions.cpp`, `FindItem` performs a plain equality comparison over item names with no trimming anywhere in the call chain, which is what makes R1's spacing rule load-bearing.
- `Maetrim/DDOBuilderV2` — `DDOBuilder/EquipmentPane.cpp` wires both import entry points and declares the `*.gearset` file filter.
- `Maetrim/DDOBuilderV2` — `Example Gear PLanner Website Set.txt` illustrates the *clipboard* grammar, not the file grammar. The two use different slot vocabularies; reading it as the file format is a trap.
- `web/projection.js` — the resolved view every export renders from, already carrying character name, constraints, per-slot augments with affixes, and per-slot crafting.
- `web/exporters.js` — the five existing share exports and the shared cue and affix helpers.
- `docs/plans/2026-08-03-001-feat-universal-exports-portable-round-trip-plan.md` — the export overhaul that made the projection the single content source.
