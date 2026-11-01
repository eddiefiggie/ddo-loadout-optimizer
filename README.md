# DDO Loadout Optimizer

**Your best-in-slot gear, proven by math — not a guess.**

🎮 **Play it now:** https://eddiefiggie.github.io/ddo-loadout-optimizer/ · **Code:** https://github.com/eddiefiggie/ddo-loadout-optimizer

**Current build:** 10312026.3 — the live site's footer shows the deployed value. `tests/test_build_stamp.py` fails the build when this line drifts from `web/app.js`, so it cannot go stale silently.


---

## The problem this solves

You capped a life. You have a bag full of named loot, a spreadsheet somebody posted in 2023, and a vague sense that your gear is *fine*. But you want Melee Power, then Doublestrike, then as much Constitution as you can get without giving up either — and working out which thirteen items actually do that, once you account for which bonus types stack and which quietly overwrite each other, is genuinely hard.

Most gear advice is somebody's opinion, frozen at the update it was written for. This isn't. Tell it what you care about and it searches every named item, augment, set bonus, and crafting option it knows about, then hands you the loadout that is **provably optimal** for your priorities — slot by slot, with the receipts.

## What you get

Give it your **ML cap**, optionally your race, armor type, and weapon setup, and a **ranked list of the stats you want**. It returns one loadout and shows its work.

Not a tier list. Not "what a good player usually wears." It considers **9,173 gear variants** built from 8,093 wiki-sourced records, spanning **ML 1 through 36**, and solves for the mathematically best answer under DDO's real stacking rules. When it tells you a set beats three individual items, it's because it checked.

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
| Named gear, all slots and tiers, ML 1–36 | ✅ 9,173 variants |
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
| **Legendary Green Steel** (ML 26 blanks, three Legendary Altars) | ✅ 116 recipes (81 accessory + 35 weapon) on 48 blanks (8 accessories + 40 weapons). One effect is chosen per altar tier, independently. The bonus a *matched* tier combination unlocks (the Dominion / Opposition / Ethereal / Material aspects) is not modelled and the result says so — the exhaustive combinatorial space is a standing non-goal. Heroic Green Steel (ML 11–12) has no recipe data and stays browse-only |
| Thunder-Forged | **Not modelled, by decision** (#767, 2026-09-17) — a non-goal, not a gap. The 42 `Thunder-Forged Alloy` weapons are in the dataset and solvable as Orange augment hosts; only the tier recipes are unmodelled, and no source carries them. The pool that once shipped under this name is Legendary Green Steel's weapon half — the menu keys are generic and the mapping was an inference (#653). Since #687 both blank classes live in ONE `legendary_green_steel` container; real Thunder-Forged (Magma Forge) has no menu in the catalog. |
| **Essence Crafting** (Gem of Many Facets, and the Rune Arm / Ring / Melee blanks) | ✅ partial — all twelve menus are solved, choosing from 435 of the 639 shards they offer in game, read from the same [yourddo](https://github.com/veteran-software/yourddo) catalog the item bench uses (#843). A shard is offered once its placement and every enchantment's bonus type and level curve are sourced and every name is one the tool ranks; on/off effects (`Holy`, `Undead Bane`) are offered on/off, and a shard granting several effects at once (`Sheltering`, `Combat Mastery`) is taken whole and credits each (#844). Withheld and named in the result: names the catalog cannot match, and any compound shard with one such part. |
| **Slaver's crafting** (Chains / Five Rings / Shackles, heroic and legendary) | ✅ the four typed slots (Prefix / Suffix / Extra / Bonus) from the catalog's own pools, one effect each, and the Set Bonus slot as a chosen Slave Lord's set. One pool name the catalog defines no set for is disclosed per build rather than mapped (#766) |
| Filigrees | **Not modelled, by decision** (#196, 2026-09-17) — a non-goal, not a gap. No source carries filigree data: the seed tree holds one prose line about slot counts and nothing else. #412 put them out of scope for the owned-inventory path, and the app tells players so. |
| **Items you describe yourself** (Cannith/Essence-crafted gear the wiki has no record of) | ✅ up to 12 per build. Name it, pick its slot, level, augment colours and effects, and it joins the search as a real item — pinnable into a slot, counted in the stacking buckets, filling around the rest of your gear. Effects can be numbers (a stat plus its bonus type) or on/off toggles like Ghost Touch and True Seeing, which count for the Utility tier exactly as a named item's would. Names come from the same lists the tool uses, so everything you enter can be ranked. **These numbers are yours, not wiki-sourced**, so the item is shown as "(yours)" everywhere it appears and every result and export says so |

## Why you can trust the numbers

Gear tools are easy to build and hard to trust, so this one is deliberately paranoid.

**Nothing is guessed.** Every value traces to the DDO Wiki. If the wiki doesn't state a number outright, it is quarantined rather than inferred — and the result tells you what was excluded. A visible gap beats a confident wrong number, because a wrong number looks exactly like a right one in a finished loadout.

**The one exception is the one you make yourself, and it is labelled.** You can describe an item the catalog has never heard of — the Cannith-crafted ring you are weighing up, the Essence-crafted dagger you already made — and the solver will use it. Those numbers are the only ones in the tool that did not come from the wiki, so they never pass as if they had: the item is named `(yours)` on the paperdoll, in the pin list and in all six exports, and a result that uses one says outright that it is only as right as what you typed. The same rule already applied to the two smaller versions of this — a declared "I already have this" bonus, and a bonus type you corrected by hand.

**A rendered default is not a value.** Some wiki templates fill in a placeholder when nobody has recorded the real number. Those are detected and excluded rather than treated as fact.

**The data checks itself on every deploy.** Derived values are compared against the wiki's own rendered text before the site ships. If our number and the wiki's number disagree, the build fails rather than publishing. That guard exists because `Topaz of Swiftness 15%` was shipped granting no attack speed at all, was ruled correct twice, and took three player reports to catch — the whole cell said `Speed +30%` while the tooltip behind it said 15% attack speed.

**When a correction makes your gear worse, we say so.** `Parrying` ships in two versions under one name. The Arabic form (`Parrying 4`) grants what it says; the Roman form (`Parrying VIII`) is a *rank* that grants 4. Both were flattened to the same stored number, so four items were credited with double what they actually give. They now score correctly, which makes them weaker: **Oathblade**, **Balizarde, Protector of the King**, and **Bracers of the Sun Soul** drop from 8 to 4, and **Bladed Steel Ring** drops from 4 to 2. (**Ethereal Bracers** is `Parrying I`, which really is +1, so it did not move — a blanket "halve the Roman ones" fix would have broken it.) If any of those anchored a loadout you built here, re-solve; the answer may have changed. In the same pass the correction went the other way for far more gear: 165 items carrying `Parrying` or `Heightened Awareness` now score the Armor Class and saving throws they grant, having previously counted for nothing at all.

A second case, found by re-running the bonus-type audit (#88): **`Meridian Fragment`** and **`Crystallized Drop of Tea`** were each credited **+24 Universal Spell Power**, permanently. The wiki says that bonus arrives *"once every three seconds when you take physical damage… can stack up to three times and each stack lasts for 20 seconds"* — so 24 is the fully-stacked ceiling of a buff you only hold while being hit. Because Universal Spell Power feeds every element spellpower, the over-credit landed on all of them. Both are now **excluded** rather than given a smaller number, because the wiki states no sustained value and guessing one would be the same mistake in the other direction. If you built a caster here, **re-solve**: expect Universal Spell Power and each element spellpower to drop by 24. That is the tool getting closer to the game, not a nerf.

**The bonus type is checked against the wiki's own sentence, on every build.** A wrong bonus type is the quiet defect: the number is right, the stacking is wrong, and nothing on screen looks off. For every enchantment whose rendered tooltip is on file, the build compares the type that sentence states ("+5 Insight bonus") with the type the catalog stores for that item, and refuses to ship a disagreement it has no ruling for. The Seeker mislabel that took a player's combat-log screenshot to find (#697) is now a field the build reads: the wiki engraves it "Exceptional", the sentence says Insight, and no item is allowed to store it as Exceptional again.

**When an upgrade renames an effect, we say so.** Some item families change the name of an on/off effect between tiers: `Wraithborn Emerald` carries `Ethereal` at ML 8 and `Legendary Wraithborn Emerald` carries `Ghostly` at ML 30. Where the wiki rules two such names one mechanic at two magnitudes (`Blurry` and `Lesser Displacement` are both Concealment), both already score the same stat and nothing is hidden. Where it rules them different effects (`Ghostly` is strictly more than `Ethereal`), the tool does not merge them, and a result that ranks either name says which families carry the other name at the other tier, so you can rank both if the shared part is what you wanted. Every such family is found by the build, not by hand, and the build refuses to ship one it has no ruling for (#850).

**When a gate gets stricter, we say that too.** Armor type is now **required** before the character step will continue, alongside race and your ML cap. This is a behavior change, not a relabelling: until this build you could advance without it, and the solve would then hand you a loadout you may not be able to wear — armor filters which body armor is equippable. Forged races are exempt; they wear a docent and have no armor choice to make. **A build name is now required too**, for the same reason and with the same honesty: the character step will not continue without one. Naming used to be asked for from a panel beside the form, which meant the one moment that actually needed a name — the unsaved-changes prompt offering “Save and continue” — sent your cursor to a field you had never looked at. The name is now the first thing the Required group asks for, and saving sits in the step's own action bar beside Continue. Existing saved builds are unaffected: every record is keyed by its name, so none of them can have been saved without one. A build you saved earlier that carries no armor still loads, and still shows the loadout it was solved for; the character step marks armor as needing an answer rather than silently blocking you somewhere else.

**Found a wrong value?** On the result's **Share** tab, press **Report a problem**: it saves a reproduction file (your settings, priorities, pins, the loadout and its stat breakdown) and opens a [GitHub issue form](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/new/choose) with the build filled in. Reports that carry that file get diagnosed from the file alone; the ones that could not be reproduced were missing exactly it. Reports are checked against the wiki and, when confirmed, usually come with a new automated check so the same class of error can't come back.

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

Don't like a slot? **Pin** an item you insist on wearing, **lock** a slot empty, or **free** it, then re-solve in place. A pin is the more specific instruction, so it is honored through the soft filters (the ML floor, the Artifact opt-in, your owned-gear import, an excluded set, a content pack you did not tick) and the result says so each time; where a pin cannot be honored (an item above your ML cap, a race-locked item, a pinned augment the cap or your crafting rung excludes) the result says that too, and the pin is kept for when the condition lifts. Keep getting gear you've already rejected? **Block** it in the gear-pool step — search anything placeable (items *and* augments), tick a whole family across searches, and block the selection in one action; the result then reports itself as optimal *given your exclusions*. **Name** your build in the character step's Required group and **save** it from any step's action bar, beside Continue — saving works at any step, not only after a solve, and reopening a saved build returns you to the step you stopped on. Everything stays in your browser; **Your data**, in the header and on the Share tab, moves every saved build between devices.

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
- [`docs/plans/README.md`](docs/plans/README.md) — dated index of the design plans; implementation status lives in GitHub Issues.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — work selection, dependency order, and completion criteria.
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

## Continued development

[GitHub Issues](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues) is the live backlog.
Start with the [development guide](docs/DEVELOPMENT.md) for the improvement sequence,
the [plan index](docs/plans/README.md) for design context, and the
[2026-10-31 triage](docs/reports/2026-10-31-issue-plan-triage.md) for the reviewed issue snapshot and proposed cleanup.

The long-running direction is the [own-item-harvest migration (#911)](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues/911).
Player reports and safe data refreshes continue alongside it.
[Historical project-state notes](docs/reports/project-state-history.md) preserve the earlier release narrative.

The [follow-through report](docs/reports/2026-10-31-improvement-follow-through.md)
records the latest upstream retest and set-harvest measurements from the organization pass.
