# DDO Loadout Optimizer

**Your best-in-slot gear, proven by math — not a guess.**

🎮 **Play it now:** https://eddiefiggie.github.io/ddo-loadout-optimizer/ · **Code:** https://github.com/eddiefiggie/ddo-loadout-optimizer

**Current build:** 09022026.3 — the live site's footer shows the deployed value. `tests/test_build_stamp.py` fails the build when this line drifts from `web/app.js`, so it cannot go stale silently.


---

## The problem this solves

You capped a life. You have a bag full of named loot, a spreadsheet somebody posted in 2023, and a vague sense that your gear is *fine*. But you want Melee Power, then Doublestrike, then as much Constitution as you can get without giving up either — and working out which thirteen items actually do that, once you account for which bonus types stack and which quietly overwrite each other, is genuinely hard.

Most gear advice is somebody's opinion, frozen at the update it was written for. This isn't. Tell it what you care about and it searches every named item, augment, set bonus, and crafting option it knows about, then hands you the loadout that is **provably optimal** for your priorities — slot by slot, with the receipts.

## What you get

Give it your **ML cap**, optionally your race, armor type, and weapon setup, and a **ranked list of the stats you want**. It returns one loadout and shows its work.

Not a tier list. Not "what a good player usually wears." It considers **9,194 gear variants** built from 8,036 wiki-sourced records plus a wiki-harvested ML36 augment tier, spanning **ML 1 through 36**, and solves for the mathematically best answer under DDO's real stacking rules. When it tells you a set beats three individual items, it's because it checked.

Two things make it more useful than a static list:

**It respects the ranking you gave it.** Priority 1 is maximized first. Priority 2 is then maximized *without giving up a single point* of priority 1, and so on down. You are never quietly traded out of your top stat to pad a lower one.

**It tells you what to craft, not just what to farm.** A drop is only half a slot:

- **Which augment goes in which slot**, respecting the real color rules — Colorless fits anywhere, Red fits Red/Purple/Orange, and so on.
- **Which "Sealed in X" effect to unseal** at the Ritual Table or Augmentation Altar.
- **Which Nearly Completed** option to pick on Terror of Demogorgon gear.
- **Which Viktranium experiment** to run on Chill of Ravenloft (Lamordia) gear.
- **Which Dinosaur Bone insert** to slot from Isle of Dread.
- **Which set bonus to craft into a host** — *awaken* one on a Vecna *Lost Purpose* item at the Cannith Repurposing Station, or slot a Set Bonus augment on a Dino Bone host. It will even complete an artifact set like Vol's Influence or Delight of the Devourer that no single item grants natively.

You can also point it at **only the gear you actually own** by importing a Trove inventory export — useful when you want the best build you can assemble tonight rather than the best build that exists.

## What it knows about

| System | Status |
|---|---|
| Named gear, all slots and tiers, ML 1–36 | ✅ 9,194 variants |
| Bonus-type stacking (Enhancement vs Insightful vs Quality, etc.) | ✅ highest of each type counts, different types add |
| Set bonuses, intrinsic and piece-threshold | ✅ |
| Augments, including multi-fit colors and Lunar/Solar gems | ✅ 1,063 augments (incl. the ML36 tier) |
| Weapon handedness, dual-wield/TWF, shields, off-hand, druid oath | ✅ |
| **Vecna Unleashed set crafting** (Lost Purpose → awaken a set) | ✅ 28 craftable-membership sets |
| **Dino Set-Bonus** augments (Isle of Dread) | ✅ 21 augment sets |
| Sealed in X (Ritual Table / Augmentation Altar) | ✅ all four pools sourced (Undeath, Fire, Gloom, Mist) |
| Nearly Completed (Terror of Demogorgon, U81) | ✅ |
| Viktranium / Lamordia (Chill of Ravenloft, U75) | ✅ |
| Dinosaur Bone inserts (Isle of Dread) | ✅ 111 inserts |
| Endgame ML 30–36 (U81 / Isle of Dread / Myth Drannor) | ✅ named + raid gear |
| **Wildcard set pieces** (Gem of Many Facets — counts toward a set you choose) | ✅ |
| **On/off affixes** (Ghost Touch, True Seeing, Freedom of Movement, immunities) | ✅ tracked as present, not as a number |
| **Utility tier** (on by default, ranked last) | ✅ after your ranked stats are locked, empty slots fill with gear carrying distinct utility effects (worn toggles like Ghostly, True Seeing and Freedom of Movement — not weapon procs, which stay rankable on their own) — drag the tier up if those matter more than a marginal stat |
| **Minor Artifacts** (build around one, optimizer picks the best) | ✅ opt-in |
| Legendary Green Steel | ⏳ 116 recipes loaded (81 accessory + 35 weapon), no craftable hosts in the roster yet — see [#194](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/194) |
| Thunder-Forged | ❌ no recipes loaded. What shipped under this name is Legendary Green Steel's weapon half — the menu keys are generic and the mapping was an inference; see [#653](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/653) |
| **Essence Crafting** (Gem of Many Facets) | ✅ partial — the Gem's three Trinket menus are solved, choosing from 25 of the 170 effects those menus offer in game. An effect is offered only once its placement, its bonus type and its level curve are all sourced from the wiki; the result says so. Melee, Ring and Rune Arm menus are ⏳ not yet |
| Filigrees | ⏳ not yet |

## Why you can trust the numbers

Gear tools are easy to build and hard to trust, so this one is deliberately paranoid.

**Nothing is guessed.** Every value traces to the DDO Wiki. If the wiki doesn't state a number outright, it is quarantined rather than inferred — and the result tells you what was excluded. A visible gap beats a confident wrong number, because a wrong number looks exactly like a right one in a finished loadout.

**A rendered default is not a value.** Some wiki templates fill in a placeholder when nobody has recorded the real number. Those are detected and excluded rather than treated as fact.

**The data checks itself on every deploy.** Derived values are compared against the wiki's own rendered text before the site ships. If our number and the wiki's number disagree, the build fails rather than publishing. That guard exists because `Topaz of Swiftness 15%` was shipped granting no attack speed at all, was ruled correct twice, and took three player reports to catch — the whole cell said `Speed +30%` while the tooltip behind it said 15% attack speed.

**When a correction makes your gear worse, we say so.** `Parrying` ships in two versions under one name. The Arabic form (`Parrying 4`) grants what it says; the Roman form (`Parrying VIII`) is a *rank* that grants 4. Both were flattened to the same stored number, so four items were credited with double what they actually give. They now score correctly, which makes them weaker: **Oathblade**, **Balizarde, Protector of the King**, and **Bracers of the Sun Soul** drop from 8 to 4, and **Bladed Steel Ring** drops from 4 to 2. (**Ethereal Bracers** is `Parrying I`, which really is +1, so it did not move — a blanket "halve the Roman ones" fix would have broken it.) If any of those anchored a loadout you built here, re-solve; the answer may have changed. In the same pass the correction went the other way for far more gear: 165 items carrying `Parrying` or `Heightened Awareness` now score the Armor Class and saving throws they grant, having previously counted for nothing at all.

A second case, found by re-running the bonus-type audit (#88): **`Meridian Fragment`** and **`Crystallized Drop of Tea`** were each credited **+24 Universal Spell Power**, permanently. The wiki says that bonus arrives *"once every three seconds when you take physical damage… can stack up to three times and each stack lasts for 20 seconds"* — so 24 is the fully-stacked ceiling of a buff you only hold while being hit. Because Universal Spell Power feeds every element spellpower, the over-credit landed on all of them. Both are now **excluded** rather than given a smaller number, because the wiki states no sustained value and guessing one would be the same mistake in the other direction. If you built a caster here, **re-solve**: expect Universal Spell Power and each element spellpower to drop by 24. That is the tool getting closer to the game, not a nerf.

**When a gate gets stricter, we say that too.** Armor type is now **required** before the character step will continue, alongside race and your ML cap. This is a behavior change, not a relabelling: until this build you could advance without it, and the solve would then hand you a loadout you may not be able to wear — armor filters which body armor is equippable. Forged races are exempt; they wear a docent and have no armor choice to make. **A build name is now required too**, for the same reason and with the same honesty: the character step will not continue without one. Naming used to be asked for from a panel beside the form, which meant the one moment that actually needed a name — the unsaved-changes prompt offering “Save and continue” — sent your cursor to a field you had never looked at. The name is now the first thing the Required group asks for, and saving sits in the step's own action bar beside Continue. Existing saved builds are unaffected: every record is keyed by its name, so none of them can have been saved without one. A build you saved earlier that carries no armor still loads, and still shows the loadout it was solved for; the character step marks armor as needing an answer rather than silently blocking you somewhere else.

**Found a wrong value?** [Open an issue](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues). Reports are checked against the wiki and, when confirmed, usually come with a new automated check so the same class of error can't come back.

## How to use it

A short guided wizard walks you through it:

1. Open the [live site](https://eddiefiggie.github.io/ddo-loadout-optimizer/).
2. **Character** — three labelled groups. **Required** holds your build name, ML cap, race and armor type; **Restrictions** holds everything optional (ML floor, alignment, oath, **Include an Artifact**, and how much crafting the solver may assume); **Weapon setup** folds away, and says whether it holds anything. Press Continue with a required field blank and the step holds, scrolls to it, and names every field still needed.
3. **Gear pool** — everything in the game, or only what you own via a Trove import.
4. **Priorities** — add the stats you want, in order, and drag to reorder. First is most important.
5. **Solve.** In well under a second you get six tabs:

| Tab | What it shows |
|---|---|
| **Loadout** | The full kit, slot by slot, set pieces highlighted, with augments and craft steps on each item |
| **Ranked Priorities** | Where every point of every stat came from — which item, which set, which bonus type; and, per priority, what giving ground on it would buy the priorities beneath |
| **Set Bonuses** | Every set you actually complete and what it grants |
| **Adjustment Studio** | What your adjustments did — this build against the one you had before, every difference, *including stats you never ranked* |
| **Farming List** | Where every item comes from, grouped by source and ordered so the best run is first — tick things off as you get them |
| **Share** | Forum-ready Markdown, CSV, a print-friendly page, or a DDOBuilder-importable `.gearset` |

Above the tabs, the notes panel carries an **Upgrades** card. Ask it to search and it looks for builds that reach the same totals while completing another set, freeing a slot, taking fewer crafting steps, or picking up a stat you never ranked — and it shows you only the ones that **cost you nothing**. Widen the bar if you want to see trades, and a suggestion still has to clear it twice: the loss must be small as a share of that priority's total, *and* what it buys must outweigh it once your ranking is taken into account. A point of your first priority is worth far more than a point of your last, so "+1 Dodge for −5 Melee Power" can never reach you. For the one trade you want priced by name, the **Ranked Priorities** tab asks it directly: *what would giving ground here buy me?*

Don't like a slot? **Pin** an item you insist on wearing, **lock** a slot empty, or **free** it, then re-solve in place. Keep getting gear you've already rejected? **Block** it in the gear-pool step — search anything placeable (items *and* augments), tick a whole family across searches, and block the selection in one action; the result then reports itself as optimal *given your exclusions*. **Name** your build in the character step's Required group and **save** it from any step's action bar, beside Continue — saving works at any step, not only after a solve, and reopening a saved build returns you to the step you stopped on. Everything stays in your browser; **Your data**, in the header and on the Share tab, moves every saved build between devices.

There's also a **Browse items** view for searching the whole roster when you just want to look something up.

## Under the hood (for theorycrafters)

It's a real solver, not a pile of if-statements. Every stat source — a worn affix, an augment, a set tier, a crafted option, a crafted set membership — is a **gated contribution** `(stat, bonus_type, value)` that only counts when its enabling conditions hold. Those feed a mixed-integer linear program solved **in your browser** by [HiGHS](https://highs.dev/) compiled to WebAssembly, run as a staged lexicographic solve with a deterministic tie-break so the same query always returns the same build.

Same math a good spreadsheet-wielding theorycrafter does — just exhaustive, exact, and instant.

Set definitions come from a single source of truth, so a set you complete by crafting grants exactly what a set you complete by looting does. Where a real in-game limit **cannot** be sourced, it is disclosed rather than guessed: your armor's Maximum Dexterity Bonus reduces Maximum Dodge Bonus in game, but that limit belongs to the individual armor and the wiki does not state it per item — so if you rank Dodge, the tool says plainly that the total it shows is not reduced by your armor, and invites you to set the limit yourself if you know it.

**Known limits, stated plainly.** The solver maximizes your ranked stats slot-by-slot, which is not the same as "what an experienced player would wear." It has no concept of how hard an item is to farm, and it will happily recommend a niche level-13 item if that item genuinely wins on your priorities. Treat it as a rigorous answer to the question you asked, not as build advice.

## Build & run (developers)

```
python3 build_dataset.py          # seed + wiki shards -> web/data/items.json
python3 -m http.server 8000       # then open http://localhost:8000/web/
python3 tests/run_tests.py        # Python suite (stdlib only; pytest also works)
./scripts/run_js_tests.sh         # JS suite — one file at a time, stops on first failure
```

Run the JS suite through **`scripts/run_js_tests.sh`** rather than a bare loop. It invokes one file at a time (`node a.js b.js` executes only the first, which has silently skipped the golden solver check before), exits non-zero on the first red file, and builds the gitignored `web/data/items.json` if it is missing — otherwise `dataset.test.js` and `browse.test.js` throw on require and a bare loop swallows the exit code.

`web/data/items.json` is a **generated artifact** (gitignored) — edit the pipeline (`build_dataset.py`, `src/`) and the seed data, never the JSON. `web/` is a self-contained static site deployed to GitHub Pages by `.github/workflows/deploy.yml`, which rebuilds the dataset and runs the full suite on every push to `main` before deploying.

## Files

- `web/` — the static app: `wizard.js` (guided-wizard entry point), `solver.js`, `model.js`, `results.js`, `alternatives.js`, `browse.js`, the crafting/data layer (`crafting-systems.js`, `import.js`), and the persistence/sharing layer (`persist.js`, `backup.js`, `exporters.js`).
- `src/` + `build_dataset.py` — the Python pipeline: parse wiki affix text, expand tier variants, verify/quarantine, build the dataset.
- `data/seed/` — hand-verified seed plus wiki-sourced shards.
- `docs/plans/` — the plan behind each milestone (brainstorm → plan → work).
- `docs/solutions/` — documented solutions to past problems (bugs, conventions, design patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in a documented area.
- `docs/wiki-evidence/` — the harvest method and the standing rulings behind contested values.
- `CONCEPTS.md` — shared domain vocabulary. Relevant when orienting to the codebase or discussing domain concepts.
- `AGENTS.md` — operating context for coding agents: where the knowledge stores are and the standing rules that have each cost a real defect. `CLAUDE.md` is a symlink to it.

## Resume prompt

Copy this into a fresh session to pick the project back up:

```
Working on ddo-loadout-optimizer — a public, client-side DDO best-in-slot gear optimizer
(https://github.com/eddiefiggie/ddo-loadout-optimizer, live at
https://eddiefiggie.github.io/ddo-loadout-optimizer/). A Python pipeline builds a
wiki-sourced dataset; a static site solves an exact MILP over it in the browser via
HiGHS-WASM. Deployed to GitHub Pages from main.

Read AGENTS.md first — it carries the standing rules, each of which has cost a real
defect: never infer a value, prove a guard fails before trusting it, prove a new test
fails against the pre-change tree, and the three-place build-stamp bump. It also lists
the Non-goals, which are declined-on-purpose and must not be filed as issues.

GitHub Issues is the single source of truth for open work — not this README, not the
plans. Check the open issues before choosing what to do.

Tests: python3 tests/run_tests.py and ./scripts/run_js_tests.sh (never a bare node loop).
```

## Project state

> **ddo-loadout-optimizer** — a public DDO best-in-slot optimizer, live at eddiefiggie.github.io/ddo-loadout-optimizer. Input = ML cap + race + armor + weapon setup + a ranked affix list (optionally restricted to an imported Trove owned-inventory); output = the provably-optimal fully-upgraded loadout (item + tier + augment-in-slot + crafted options + chosen set-membership bonuses), every value wiki-sourced. **Client-side static app on GitHub Pages**; exact MILP in-browser via **HiGHS-WASM**, staged lexicographic solve, deterministic tie-break; Python generator builds `web/data/items.json` (gitignored). Core rules: strict lexicographic priority; theoretical BiS by default with an optional owned-inventory pool; strict exclude-until-verified data with per-result coverage disclosure; **never infer a value**.
>
> **State (2026-08-28, build `08282026.3`):** 9,194 variants from 8,036 gear-planner records + the wiki-harvested ML36 augment tier, ML 1–36, on upstream snapshot `767a7f74` (2026-08-18). Live: named gear all slots, set bonuses, 1,063 augments w/ multi-fit colors, weapon handedness + TWF + off-hand + druid oath, Vecna Lost Purpose + Dino Set-Bonus crafting via a general chosen-set-membership primitive (28 membership sets, 21 augment sets), Sealed-in-Undeath, Nearly Completed (category **and** per-item `Nearly Finished`/`Almost There` pools), Viktranium, 111 Dino inserts, ML30–36 endgame band, wildcard set pieces, boolean presence affixes, Minor Artifact opt-in, declared stat credits, guided 5-step wizard, 6 result tabs, per-slot Adjust & re-solve, pre-solve pinning + blocklist, client-side save/load/backup, share exports (MD/CSV/print/DDOBuilder `.gearset`), the **Utility tier as a pinned, ordered, player-curated container**, and the **player bonus-type override** (correct one affix's bonus type where the game disagrees with the wiki; created from the results card or Browse, audited in a manager panel, labelled everywhere it counts, and emittable as a catalog-correction report). Universal stats are fully classified: same-type umbrellas (Potency, Spell Focus Mastery) **expand** into element siblings; fully-stacking universals (Universal Spell Power, Spell Lore, Universal Spell Lore) **cross-add**.

> **Agent context lives in `AGENTS.md`** (`CLAUDE.md` is a symlink to it): the knowledge stores, the standing rules, the Open-work/Issues rule, and the Non-goals list.
>
> **Latest work (2026-08-21, PRs #415 + #421 + #424, live at build `08212026.3`) — #88's workstream 2 COMPLETE, in three PRs:** the **player bonus-type override**. An override is a player's assertion that one affix on one item carries a different bonus type in game than the catalog recorded; it re-keys which `stat||type` bucket that affix contributes to and never touches its value.

> **PR #415 (U1–U4)** built the overlay: a four-field identity, a five-class eligibility predicate (20,613 engraved affixes eligible of 42,088), the match ladder, and apply/withdraw over the loaded pool. Review found three defects that are one sentence wearing different clothes — the identity key includes `from`, and apply overwrites the field `from` names.

> **PR #421 (U5–U9)** made it survive a save and reach everything: `overrides` on the input allowlist and `overrideReport` on the result allowlist; the previous character's overlay withdrawn from the shared pool on switch; the seven crafted channels addressable by a composed pool key (976 eligible rows → 894 distinct keys, every collision a byte-identical duplicate); the lifecycle ladder resolved and disclosed on load; the contributor label, the optimality qualifier, and the stale marker; and an overrides line in all six exports. `zOf` became the one place a z variable is minted, which is what lets every contribution family carry the marker.

> **PR #424 (U10–U12)** opened the surfaces: one shared picker rendered from both the results card and Browse (neither keeps its own copy of the predicate), a manager panel beside pinning and the blocklist whose action set is derived from each lifecycle state, and the catalog-correction report — generated text that states outright it has no wiki backing, because an override exists precisely where the wiki and the game disagree.

> **Three learnings banked:** `docs/solutions/design-patterns/an-overlay-keyed-on-the-field-it-overwrites-must-read-through-its-own-stamp.md`, `conventions/one-concept-under-two-field-names-needs-one-accessor.md`, and `conventions/a-source-guard-must-pin-the-property-not-the-syntax-beside-it.md`. `CONCEPTS.md` gained **Bonus-type override** and **Catalog-correction report**.

> **Two rulings deliberately left open at the time, both since settled (#422 and #423 closed):** both were reproduced against real data and filed rather than patched: **#422** (does a sibling occurrence at the replacement type make an override *satisfied*? — 21 crafted-pool key groups carry two types) and **#423** (does R7's load-generated exclusion reach the crafted channels? — 278 eligible crafted rows carry a `via` receipt, and the answer also decides whether the crafted `ineligible` rung is reachable at all).

> **Latest work (2026-08-20, PRs #409 + #412 + #413, live at build `08202026.7`):** three efforts. **#409 (closes #359)** shipped **owned-augment mode**: the Trove export already carried augments and the filter simply never applied them, so the work was semantics, not plumbing. "Owned" means **owned UNION acquirable**, where acquirable is the wiki's own rarity taxonomy (Common/Uncommon/Rare = vendor / Mysterious Remnant / generic loot; Named = must own) — 675 of 1,063, joined exact at 675/675, so the build guard asserts equality rather than a threshold. Measured: 1063 → 745 augments, Con 37→34, for a loadout the player can actually assemble.
>
> **#412 (closes #408)** fixed a real denial of owned gear: **Trove writes stacked items in the plural** (`Solar Gems of Constitution`) while the catalog stores the singular, so owning *two* of something dropped it. Every recovered name is an augment, which made it load-bearing the day #409 shipped. `wizard.js` was also testing ownership with its own bare `has()` that bypassed the shared filter — one predicate now. The issue's "nothing measures it" premise was wrong (coverage was already disclosed); the real gap was that `1,040 unrecognized` read as breakage when **~75% is out of scope by design** — filigrees, collectables, randomly-generated loot. This is a named-gear catalog, not an inventory, and the copy now says so.
>
> **#413 (#88's audit half)** re-ran the bonus-type coverage sweep and found the **completeness claim had gone stale, with a live over-credit in the gap**. `Meridian Fragment` / `Crystallized Drop of Tea` stored `Universal Spell Power | Psionic | 24` — the fully-stacked ceiling of a buff the wiki says is conditional (*needs you hit*), ramping and 20-second temporary. Credited flat and **cross-added into all ten element spellpowers**. Quarantined rather than re-valued (no sustained figure exists to cite). Goldens re-ratified: USP 128→104 across the same six fixtures the 2026-08-18 migration listed as "newly scorable" — a gain that was an over-credit. **Player-visible downgrade, stated in the README beside the Parrying correction.**
>
> **Learning banked:** `docs/solutions/conventions/a-dated-coverage-claim-cannot-notice-its-own-staleness.md`, and **AGENTS.md gained a standing rule**: a completeness claim needs a guard, not a date. Three instances in one day (#349's stale gate order, #88's sweep, #357's stashed gate status).
>
> **Before that (2026-08-20, PRs #405 + #406, build `08202026.4`):** a **user report processed end to end**. A player reported that the Solar Gem of Spell Critical Damage is ignored when they rank `Void Intensity`. Re-harvested rather than defended (#366's precedent): the ruling **stands**, and its basis moved from "no statement found" to a positive finding on three reads — the `Intensity` table has no universal row; `Spell power`'s structurally identical table **does** (`Potency → All Spells`), so the absence is meaningful rather than an incomplete table; and `Spell critical` carries a `Universal` subsection for crit **chance** and none for crit **damage**. Measured: ranking `Void Intensity` places no gem, ranking `Spell Intensity` places it. Nothing was broken (#402 closed as already-correct, with a do-not-reopen note — it was the second time the question had been asked).
>
> The real defect was **disclosure**, shipped as #406: adding any of the ten element Intensities now suggests `Spell Intensity` by name at the picker. **Advisory only** — it never adds or reorders, because unlike the expanded-away path *both* names score. Membership is **derived**: a universal-shaped rankable name that is neither expanded away nor a cross-add source is reachable only by knowing its name, and a guard recomputes that population so the next one cannot arrive silently (today it is exactly one — `Universal Spell Power`/`Universal Spell Lore` cross-add, `Potency`/`Spell Lore` expand away).
>
> **Caught while wiring it:** `companionHintFor` was on `module.exports` but **not** on the `window.DatasetNormalizer` global — green CI, dead feature, no player would ever have seen the hint. The picker's defensive `(DN && DN.fn)` bridge turned it into silence. Found by opening the browser, not by the nine passing tests.
>
> **Learning banked:** `docs/solutions/conventions/a-symbol-on-one-export-surface-is-dead-on-the-other.md` — the sibling of the `var`-not-`const` doc, with the **opposite failure signature**: that one crashes loudly on the next browser load, this one is silent until a player re-reports the same gap.
>
> **Before that (2026-08-20, PRs #399 + #400, build `08202026.3`):** the Litany's **Combat arm** (#396) and the **Utility roster widening** (#349). #399 settled "attack bonus and damage" onto the `Accuracy` / `Deadly` buckets — not by reasoning about the words, but because the catalog already stores two *differently named* gems with one wiki effect ("Accuracy: Profane Bonus to Attack Rolls" / "Attack: Artifact Bonus to Attack Rolls") under the single key `Accuracy`; both keys already carry six bonus types, Profane included, so they are buckets rather than one Competence enchantment. The Litany's Profane now **competes** with the Lunar gems' Profane in one bucket rather than summing beside it — the behavior that made this worth settling before expanding. Its label rule moved from a local branch in `umbrella.py` into the shared `source_label` renderer as `SELF_NAMED`, with a subset guard so the two registries cannot drift.
>
> #400 closed **all three** of #349's acceptance criteria: the six #343 names are now wiki-evidenced rather than curated (two needed the *template* layer — `True Seeing`'s page is a stub, `Freedom of Movement`'s bare page is the spell), five more admitted, and **~30 refused with their reason** so the roster is derivable. Gates ran in the mandated order, correctness before cost: encoding equivalence **17/17 at k=25** (probe clean through 32), perf **1.98x/2.00x** — the 26-name batch **failed at 2.02x and was trimmed by one**, cutting `Eversight` on merit (the wiki says it grants True Seeing *and* Blindness immunity, both already counted). Cap 20 -> 28. Goldens re-ratified with **zero ranked-stat regressions** — `perTarget` byte-identical on all 23 fixtures, 14 changing only which items fill the loadout.
>
> **Two defects surfaced by those gates:** `tbFallback` re-maxed the weighted utility objective **unpinned** (harmless at roster 20, load-bearing once drift goes non-zero at k=26), and `encoding_equivalence.js` carried a stale hardcoded 20-name order — `slice(0, k)` saturates, so a run at `SIZES=26` reported "size 26, 17 agree" while comparing 20-effect vectors. A gate that had stopped checking without failing, guarding a *correctness* property.
>
> **Learning banked:** `docs/solutions/conventions/a-guard-that-copies-its-parameter-measures-the-copy.md` — a guard that keeps its own copy of a production constant measures the copy; completes the set beside the never-runs, circular, and never-seen-red guard learnings. `CONCEPTS.md`: **Container order** and **Measured batch** refreshed with the cap rule and the gate ordering.
>
> **Before that (2026-08-20, PR #397, build `08202026.1`):** the **Litany of the Dead** ability grant (closes #367). Both trinkets stored their ability bonus as one opaque affix, so it credited nothing and no surface could show it — and neither name was in `rankable_affixes`, so the umbrella detector (whose universe *is* the picker's) never saw it either. Wiki-settled from the **template invocation**, corroborated by the rendered tooltip on both pages: `{{Litany of the Dead|N|Ability}}` grants "+N Profane bonus to all Abilities", verbatim the grant `src/umbrella.py` already expands (the Combat arm grants the parameter **squared**, which is why the Epic tier is +4 — our stored values already matched). Registered in a new **`_NAMED_UMBRELLA`** rather than `_UMBRELLA` because the two differ in their LABEL rule: a generic word takes a bonus-type prefix (`Profane Well Rounded`), a name that is already engraved takes itself verbatim. The base tier also needed its type — upstream carries it with **no `type` key at all**, and untyped its six abilities would have stacked with every Profane source instead of competing with them. That entry is the shard's first with a null `from`, which exposed a **bug in the shard's own evidence guard** (truthiness conflated "field missing" with "field recording an absent upstream value"). Measured at ML26 with the trinket pinned: Profane +2 to each ranked ability where it previously gave nothing; at ML13 the base tier is correctly dominated by a Profane +2 gem. **Combat arm deliberately NOT fixed — filed as #396** ("attack bonus and damage" has no settled mapping to our `Accuracy`/`Deadly` keys, and #366 is the precedent that this project settles name-to-concept correspondences explicitly).
>
> **Learning banked:** `docs/solutions/conventions/a-required-field-guard-must-require-the-key-not-a-truthy-value.md` — a required-field guard written as a truthiness test cannot express a legitimately-null value; the inverse of the falsy-collapse over-count already recorded in `browser-verify-against-real-data-not-just-unit-tests.md`, and worth holding as a pair.
>
> **Before that (2026-08-19/20, PRs #394 + #395, build `08192026.7`):** the **display half** of the type re-encoding, then a two-part disclosure fix. #394 (closes #380) restored the counted vs not-counted Utility split, **derived** rather than curated. #395 (closes #370) fixed two surfaces that dropped things the loadout actually has. First, `bundleGroups` scanned only items and placed augments, but **43 crafted options carry `via`** (24 Viktranium, 12 Nearly Complete, 7 Dino inserts) — so an engraved bundle you reach by *crafting* was fully credited and named nowhere (`Exceptional Spell Focus Mastery`, all seven schools from a Woeful craft, measured on a real ML36 solve). The three multi-affix channels are now scanned; the four flat single-affix channels are left out deliberately and a guard asserts that **of the data**, not of the scan list. Second, Lamordia craft chips were built from *placements*, so a declared slot with no scoring option vanished — at ML36 the Cataclysmic Buckler declared 4 and rendered 1, the Bastard Sword 4 → 1, the Contraption Keyring 3 → 2. Unfilled slots are now disclosed with their reason, from one shared helper the app and all six exports both read. **Both causes #370 proposed were wrong** — a headless repro disproved them in minutes; the item and augment channels render correctly today, and the reporter's remaining case is #367.
>
> **Learning banked:** `docs/solutions/design-patterns/render-declared-structure-not-just-placements.md` — a surface built from the solver's placements under-reports the item's *declared* structure, and that gap is indistinguishable from missing data (which is how #365 came in). `CONCEPTS.md`: **Bundled enchantment** gained the craft carrier; **Viktranium Experiment crafting** gained the slots-are-identity rule.
>
> **Before that (2026-08-18/19, ten PRs, build `08192026.5`):** the gear-planner **canon-defending vocabulary migration** and its fallout. Upstream flipped from DDO's enchantment names to generic ones (`Combustion` → `Fire Spell Power`) **and separately re-encoded the `type` field** (key-less affixes 5,709 → 90; literal `"Untyped"` 148 → 886). PR #382 kept our canon — the wiki uses the enchantment names, and matching the tooltip is the standing principle — by renaming at each catalog's **single load point** (so every derived pool inherits it), suppressing the flipped folds in the Dino channel, and minting our canon into a curated `local_affix_names` section the integrity gate unions in **both** its consumers. The armed set is **13**, derived from the direct Rule A predicate, not upstream's fold table. Where the wiki backed *upstream* we adopted instead: `Shock` → `Electrifying`, `Cannith:` → `Essence Crafting:`. Then: #365/#386 relocated two Woeful options misfiled into the Weapon pool (a full four-family Lamordia audit found Melancholic/Dolorous clean); #379 defended `Insight` on six Elemental Resistance carriers on a **standing #191 ruling** that the legacy dialect's visible label lies; #381 added a **derived** retired-label migration so saved characters survive an upstream adoption of one of our folds; #371 sourced the per-item Nearly Complete pools (unserved slots **415 → 348**). #363 and #372 closed as already-resolved, with measured evidence.

> **Two learnings banked from it:** `docs/solutions/conventions/a-gate-cascade-is-the-refresh-report-not-an-obstacle.md` — a refresh that re-encodes its upstream arrives as a *cascade* of independent gate firings, and that cascade is the refresh's only description of itself; six recurring classes, each wanting a different adjudication. And the refreshed `name-corrections-canonical-must-be-a-raw-upstream-name.md`, whose `Ki` prediction **fired** during this migration. `CONCEPTS.md` gained **Gate cascade** and **Normalization seam**.

> **Before that (PR #301 + #302, merged & deployed — closes #290/#291/#292):** the universal-stat cross-add chain. A new solver primitive complements the expansion family: `metadata.cross_add` (20 wiki-evidenced entries, per-channel build guards) installs through the stacking-equivalence seam, and one shared `bucketCountsFor` helper at every `stat||type` prefix site makes an element priority sum its universal sources' buckets (max within each bucket, sum across, names never merged). Measured at ML 32: Nullification 336→439, Void Lore 36→49. The harvest resolved the 10-day-old solar-vs-artifact lore quarantine from the Lunar_and_Solar_Gems hub page (no code needed — name+type bucketing already implements the stated rule) and closed the #292 sweep with a per-candidate disposition table (`docs/wiki-evidence/universal-name-sweep.md`; Spell Intensity is record-only). Also: dino-channel registry-synonym folds (groundwork for #293), a fixed pre-existing crash (multi-word capped stats minted invalid LP names — `dVar`), goldens re-ratified per-fixture (19), and two compound docs (classification pattern update + quarantine re-check convention). Follow-up filed: #300 (extract the cross-add primitive from `web/model.js`, which crossed 1,000 lines).
>
> **Before that (PR #294):** the 2026-08-13 user-report batch — Legendary fold, Esoterica augment-set expansion (#289), the Potency same-type expansion (#290's first half), and Reign corrections.
>
> **Before that (#205-#221):** the necromancer batch — spell-school priorities credit universal DC sources (Spell Focus Mastery + bare Spell Focus expand into the seven schools across item/set-bonus/crafting channels); the Argonnessen value-correction shard; the settle stage keeping zero-value augments out; the solve-overlay microtask repaint fix. `Deific Focus` ruled NOT universal (conditional on-cast buff), recorded so the guess is not re-made.
>
> **Before that (#189–#197):** the backlog-centralization pass — nine long-re-deferred items verified and filed as issues; `AGENTS.md` gained the **Open work** rule (a plan's deferrals must be filed before its PR merges) and the **Non-goals** section.
>
> **Genuinely open:** [all open issues](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues) — GitHub Issues is the single source of truth, so do not maintain a second list here. Self-deferred work carries the [`backlog`](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues?q=is%3Aissue+is%3Aopen+label%3Abacklog) label; user-reported work is `bug`/`enhancement`. **12 open, of which three are not `backlog`** — #664, #672 and #459 are the live queue; everything else is self-deferred. **Next up, in the order last judged (2026-09-02):** **#664** (a field report sums three concealment sources to **170%** where the wiki predicts **120** — blocked on one in-game observation and nothing else, and if those sources genuinely sum then the max-within-bucket reading `docs/wiki-evidence/boolean-composites.md` rests on is wrong for this stat), then **#672** (**four set bonuses grant `Spell Critical Damage`, which is in no player's picker** — 0 item carriers, 4 set-bonus sources, not in `rankable_affixes`, so Elder's Knowledge at all three tiers and Deacon of the Auricular Sacrarium contribute nothing to any solve; that half is #305's fragmentation shape and is fixable now, while the second half — whether it is the same stat as `Spell Intensity`, both `Legendary` at matching magnitudes — needs a same-origin read of the `Legendary Spell Critical Damage +15%` category page and must NOT be resolved by citing the #402 element-crediting ruling, which is a different axis), then **#459** (name the picks a cap clamps out — re-measured 2026-09-01 at **43 of 100** Doublestrike and **15 of 400** Strikethrough on a real ML34 solve, and #573 deleted `ARMOR_DODGE_CAP`, the last ceiling that could engage without the player asking, so this is a **declared-credits** feature or it has nothing to point at; zero of the 24 parity fixtures rank a capped stat, so the golden set cannot currently catch a regression here at all), then **#194** (the only other open `bug` — 116 Legendary Green Steel recipes ship with no craftable host, present-but-inert rather than honestly absent, and #653 has since corrected its premise: Thunder-Forged has no recipes loaded *at all*, so the "recipes loaded" half is true only for Green Steel; #270 is the same identity question one layer down — **554 crafted option rows across six pools carry no `variant_id`, and `seal`/`nearly_complete` carry no name either** — so the two are cheaper together than apart). **Decision-gated, not build-gated** — these want a product ruling, not an implementation slot: **#331** (proc valuation; no design, and the aggregation half collides with the weighted-sum non-goal), **#529**, and **#192** each end in some form of "no code change until this is settled", and **#591**'s 64 stat-less Cannith weapons sit behind #331 rather than jumping the line. **#192 moved on 2026-09-02** — measured against the build, `Command` is already modelled on **40** carriers and already rankable, and penalties are modelled end to end (a shipped `Penalty` bonus type on 70 affixes, 17 of them rankable, with dedicated handling at `web/solver.js:1717`), so its premise that penalties "may not be representable" is falsified twice over and only the −6 Hide half is missing; that is one wiki read, not a product decision. **Closed 2026-09-02:** **#482** (live-pass checklist run — all three concession terminal states and all six `upgradesList` shapes confirmed against the built dataset) and **#496** (already-satisfied: the Set Augment suppression note did NOT die with the Loadout Deep Dive tab — a real solve renders `Set Augment: Arcane Barrier — in Blue slot (suppresses Legendary Temple's Monolith)` from `web/results.js:1004` → `web/projection.js:1669-1674`, inline and in every export). **Before that, closed since the 2026-08-28 judgement:** #578 (PR #581), #411 (PR #610) and #357 — three of that day's four next-up items, which is why this line is re-judged rather than appended to. **Non-goals** (weighted-sum/Pareto modes, user accounts, exhaustive Green Steel space, numeric TWF penalty, attainability as a default solver input) are listed in `AGENTS.md` and are deliberately *not* issues.

> **Standing rules:** wiki values come from the *rendered tooltip*, not the visible cell — a bundled template hides its numbers there (`docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md`). Prove a guard fails before trusting it, and remember coverage of one shard is not coverage of another (`docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`). Set defs come from the gear-planner catalog — never re-harvest into a parallel file. ddowiki has **no server-side transport** (Cloudflare); harvest only same-origin from a ddowiki tab, and strip `| = & ?` from anything returned. Run every `tests/*.test.js` file separately.
