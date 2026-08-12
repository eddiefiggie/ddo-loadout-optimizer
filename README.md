# DDO Loadout Optimizer

**Your best-in-slot gear, proven by math — not a guess.**

🎮 **Play it now:** https://eddiefiggie.github.io/ddo-loadout-optimizer/ · **Code:** https://github.com/eddiefiggie/ddo-loadout-optimizer

**Current build:** 08122026.4 — the live site's footer shows the deployed value. `tests/test_build_stamp.py` fails the build when this line drifts from `web/app.js`, so it cannot go stale silently.

**Category:** Personal

---

## The problem this solves

You capped a life. You have a bag full of named loot, a spreadsheet somebody posted in 2023, and a vague sense that your gear is *fine*. But you want Melee Power, then Doublestrike, then as much Constitution as you can get without giving up either — and working out which thirteen items actually do that, once you account for which bonus types stack and which quietly overwrite each other, is genuinely hard.

Most gear advice is somebody's opinion, frozen at the update it was written for. This isn't. Tell it what you care about and it searches every named item, augment, set bonus, and crafting option it knows about, then hands you the loadout that is **provably optimal** for your priorities — slot by slot, with the receipts.

## What you get

Give it your **ML cap**, optionally your race, armor type, and weapon setup, and a **ranked list of the stats you want**. It returns one loadout and shows its work.

Not a tier list. Not "what a good player usually wears." It considers **9,108 gear variants** built from 8,034 wiki-sourced records plus a wiki-harvested ML36 augment tier, spanning **ML 1 through 36**, and solves for the mathematically best answer under DDO's real stacking rules. When it tells you a set beats three individual items, it's because it checked.

Two things make it more useful than a static list:

**It respects the ranking you gave it.** Priority 1 is maximized first. Priority 2 is then maximized *without giving up a single point* of priority 1, and so on down. You are never quietly traded out of your top stat to pad a lower one.

**It tells you what to craft, not just what to farm.** A drop is only half a slot:

- **Which augment goes in which slot**, respecting the real color rules — Colorless fits anywhere, Red fits Red/Purple/Orange, and so on.
- **Which "Sealed in X" effect to unseal** at the Ritual Table.
- **Which Nearly Completed** option to pick on Terror of Demogorgon gear.
- **Which Viktranium experiment** to run on Chill of Ravenloft (Lamordia) gear.
- **Which Dinosaur Bone insert** to slot from Isle of Dread.
- **Which set bonus to craft into a host** — *awaken* one on a Vecna *Lost Purpose* item at the Cannith Repurposing Station, or slot a Set Bonus augment on a Dino Bone host. It will even complete an artifact set like Vol's Influence or Delight of the Devourer that no single item grants natively.

You can also point it at **only the gear you actually own** by importing a Trove inventory export — useful when you want the best build you can assemble tonight rather than the best build that exists.

## What it knows about

| System | Status |
|---|---|
| Named gear, all slots and tiers, ML 1–36 | ✅ 9,108 variants |
| Bonus-type stacking (Enhancement vs Insightful vs Quality, etc.) | ✅ highest of each type counts, different types add |
| Set bonuses, intrinsic and piece-threshold | ✅ |
| Augments, including multi-fit colors and Lunar/Solar gems | ✅ 1,063 augments (incl. the ML36 tier) |
| Weapon handedness, dual-wield/TWF, shields, off-hand, druid oath | ✅ |
| **Vecna Unleashed set crafting** (Lost Purpose → awaken a set) | ✅ 28 craftable-membership sets |
| **Dino Set-Bonus** augments (Isle of Dread) | ✅ 21 augment sets |
| Sealed in X (Ritual Table) | ✅ Undeath sourced; Fire/Gloom/Mist pending |
| Nearly Completed (Terror of Demogorgon, U81) | ✅ |
| Viktranium / Lamordia (Chill of Ravenloft, U75) | ✅ |
| Dinosaur Bone inserts (Isle of Dread) | ✅ 107 inserts |
| Endgame ML 30–36 (U81 / Isle of Dread / Myth Drannor) | ✅ named + raid gear |
| **Wildcard set pieces** (Gem of Many Facets — counts toward a set you choose) | ✅ |
| **On/off affixes** (Ghost Touch, True Seeing, Freedom of Movement, immunities) | ✅ tracked as present, not as a number |
| **Minor Artifacts** (build around one, optimizer picks the best) | ✅ opt-in |
| Green Steel / Thunder-Forged | ⏳ recipes loaded, no craftable hosts in the roster yet |
| Filigrees, Essence crafting | ⏳ not yet |

## Why you can trust the numbers

Gear tools are easy to build and hard to trust, so this one is deliberately paranoid.

**Nothing is guessed.** Every value traces to the DDO Wiki. If the wiki doesn't state a number outright, it is quarantined rather than inferred — and the result tells you what was excluded. A visible gap beats a confident wrong number, because a wrong number looks exactly like a right one in a finished loadout.

**A rendered default is not a value.** Some wiki templates fill in a placeholder when nobody has recorded the real number. Those are detected and excluded rather than treated as fact.

**The data checks itself on every deploy.** Derived values are compared against the wiki's own rendered text before the site ships. If our number and the wiki's number disagree, the build fails rather than publishing. That guard exists because `Topaz of Swiftness 15%` was shipped granting no attack speed at all, was ruled correct twice, and took three player reports to catch — the whole cell said `Speed +30%` while the tooltip behind it said 15% attack speed.

**When a correction makes your gear worse, we say so.** `Parrying` ships in two versions under one name. The Arabic form (`Parrying 4`) grants what it says; the Roman form (`Parrying VIII`) is a *rank* that grants 4. Both were flattened to the same stored number, so four items were credited with double what they actually give. They now score correctly, which makes them weaker: **Oathblade**, **Balizarde, Protector of the King**, and **Bracers of the Sun Soul** drop from 8 to 4, and **Bladed Steel Ring** drops from 4 to 2. (**Ethereal Bracers** is `Parrying I`, which really is +1, so it did not move — a blanket "halve the Roman ones" fix would have broken it.) If any of those anchored a loadout you built here, re-solve; the answer may have changed. In the same pass the correction went the other way for far more gear: 165 items carrying `Parrying` or `Heightened Awareness` now score the Armor Class and saving throws they grant, having previously counted for nothing at all.

**Found a wrong value?** [Open an issue](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues). Reports are checked against the wiki and, when confirmed, usually come with a new automated check so the same class of error can't come back.

## How to use it

A short guided wizard walks you through it:

1. Open the [live site](https://eddiefiggie.github.io/ddo-loadout-optimizer/).
2. **Character** — set your ML cap, and optionally race, armor type, and weapon setup. Tick **Include an Artifact** to build around a Minor Artifact, or **Don’t build around niche crafting** if you won’t grind the craftable option systems — items then compete on what is actually printed on them.
3. **Gear pool** — everything in the game, or only what you own via a Trove import.
4. **Priorities** — add the stats you want, in order, and drag to reorder. First is most important.
5. **Solve.** In well under a second you get six tabs:

| Tab | What it shows |
|---|---|
| **Loadout** | The full kit, slot by slot, set pieces highlighted, with augments and craft steps on each item |
| **Ranked Priorities** | Where every point of every stat came from — which item, which set, which bonus type |
| **Set Bonuses** | Every set you actually complete and what it grants |
| **Loadout Deep Dive** | Each item's full affix list and every craft to apply |
| **Alternatives** | Near-optimal trade-offs — complete a different set, free a slot, fewer crafting steps |
| **Share** | Forum-ready Markdown, CSV, a print-friendly page, or a DDOBuilder-importable `.gearset` |

Don't like a slot? **Pin** an item you insist on wearing, **lock** a slot empty, or **free** it, then re-solve in place. Keep getting gear you've already rejected? **Block** it in the gear-pool step — search anything placeable (items *and* augments), tick a whole family across searches, and block the selection in one action; the result then reports itself as optimal *given your exclusions*. **Name and save** the character to reload later — everything stays in your browser, and **Export & Data Management** moves saved builds between devices.

There's also a **Browse items** view for searching the whole roster when you just want to look something up.

## Under the hood (for theorycrafters)

It's a real solver, not a pile of if-statements. Every stat source — a worn affix, an augment, a set tier, a crafted option, a crafted set membership — is a **gated contribution** `(stat, bonus_type, value)` that only counts when its enabling conditions hold. Those feed a mixed-integer linear program solved **in your browser** by [HiGHS](https://highs.dev/) compiled to WebAssembly, run as a staged lexicographic solve with a deterministic tie-break so the same query always returns the same build.

Same math a good spreadsheet-wielding theorycrafter does — just exhaustive, exact, and instant.

The armor-dependent **dodge cap** is clamped correctly, and set definitions come from a single source of truth, so a set you complete by crafting grants exactly what a set you complete by looting does.

**Known limits, stated plainly.** The solver maximizes your ranked stats slot-by-slot, which is not the same as "what an experienced player would wear." It has no concept of how hard an item is to farm, and it will happily recommend a niche level-13 item if that item genuinely wins on your priorities. Treat it as a rigorous answer to the question you asked, not as build advice.

## Build & run (developers)

```
python3 build_dataset.py          # seed + wiki shards -> web/data/items.json
python3 -m http.server 8000       # then open http://localhost:8000/web/
python3 tests/run_tests.py        # Python suite (stdlib only; pytest also works)
for t in tests/*.test.js; do node "$t"; done   # JS suite — one file at a time
```

Run the JS tests **file by file**. `node a.js b.js` executes only the first, which has silently skipped the golden solver check before.

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

> Resuming the **ddo-loadout-optimizer** garage project (`~/ClaudeGarage/personal/ddo-loadout-optimizer/`). Public DDO best-in-slot optimizer, live at eddiefiggie.github.io/ddo-loadout-optimizer. Input = ML cap + race + armor + weapon setup + a ranked affix list (optionally restricted to an imported Trove owned-inventory); output = the provably-optimal fully-upgraded loadout (item + tier + augment-in-slot + crafted options + chosen set-membership bonuses), every value wiki-sourced. **Client-side static app on GitHub Pages**; exact MILP in-browser via **HiGHS-WASM**, staged lexicographic solve, deterministic tie-break; Python generator builds `web/data/items.json` (gitignored). Core rules: strict lexicographic priority; theoretical BiS by default with an optional owned-inventory pool; strict exclude-until-verified data with per-result coverage disclosure; **never infer a value**.
>
> **State (2026-08-12):** 9,108 variants from 8,034 gear-planner records + the wiki-harvested ML36 augment tier, ML 1–36. Live: named gear all slots, set bonuses, 1,000 augments w/ multi-fit colors, weapon handedness + TWF + off-hand + druid oath, Vecna Lost Purpose + Dino Set-Bonus crafting via a general chosen-set-membership primitive (28 membership sets, 21 augment sets), Sealed-in-Undeath, Nearly Completed, Viktranium, 107 Dino inserts, ML30–36 endgame band, wildcard set pieces, boolean presence affixes, Minor Artifact opt-in, declared stat credits (a non-gear bonus you already have, carried through solver/results/persistence/exports), guided 5-step wizard, 6 result tabs, per-slot Adjust & re-solve, client-side save/load/backup, share exports (MD/CSV/print/DDOBuilder `.gearset`), and a header Buy Me a Coffee button. Spell-school priorities now count universal DC sources (Spell Focus Mastery and bare Spell Focus expand into the seven schools across the item, set-bonus, and crafting-pool channels), the receipts name the real enchantment, and a settle stage keeps zero-value augments out of the recommendation.
>
> **Agent context lives in `AGENTS.md`** (`CLAUDE.md` is a symlink to it): the knowledge stores, the standing rules, the Open-work/Issues rule, and the Non-goals list.
>
> **Latest work (#205-#221 — merged & deployed):** a player-reported necromancer batch. #205 fixed the core defect: a spell-school priority credited only exact name matches, so every universal DC source (Spell Focus Mastery, bare Spell Focus — 232 + 19 affixes and 516 set tiers) scored zero and no sacred/quality/insightful focus could ever be picked. They now expand into the seven schools at build time, across the item, set-bonus, and crafting-pool channels, so the existing max-per-(stat, bonus type) bucketing reproduces both wiki rules with no new stacking code; receipts show the real enchantment name. Measured at ML 34: Necromancy 26→31, Conjuration 15→31. #207 corrected the Legendary Argonnessen Eye Band to the wiki's +8 via a new value-correction shard that fails the build when its recorded source value moves. #206 added a settle stage so a zero-value augment is never recommended. #218 fixed the solve overlay never painting on a re-solve — the cached solver module made the yield a microtask, and microtasks drain before paint. `Deific Focus` was ruled NOT universal (its tooltip is a conditional single-school on-cast buff), recorded so the guess is not re-made.
>
> **Before that (#201, #202):** a Buy Me a Coffee support button. Added to the footer (#201), then moved into the header opposite the title and directly above **Browse items** (#202), restyled from the vendor's 210×60 Poppins widget to match `.btn.ghost` exactly and share a `--stack-btn-w` width token with it. Aligning the two right edges required moving the header's horizontal padding from `.app-header` onto `.app-header .wrap`: the header padded its *outer* element while `main` pads its *inner* one, so a compensating margin was correct only once `max-width` clamped (right at 2560px, 16px off at 500px). That fix also closed a pre-existing 24px offset between the header title and the card below it. **This is the site's first third-party runtime dependency** — every visitor now fetches `cdnjs.buymeacoffee.com`; the app itself is still fully client-side. Known gap, pre-existing and not filed: below ~385px the topbar's own `flex-wrap` drops Browse items to a left-aligned row, so the two buttons stop stacking.
>
> **Before that (#189–#197):** a backlog-centralization pass. Deferrals had accumulated as untracked prose across nearly every plan in `docs/plans/`, so nine were verified against the current tree and filed as issues (four crafting/data systems that had each been re-deferred in 4–9 separate plans: Essence crafting, Green Steel hosts, Sealed-in Fire/Gloom/Mist, Filigrees; plus percentage-unit ranking, the missing `ddo-loadout/v1` reader, four unaudited bundled templates, the `Command` penalty question, and the rarity/source-tier field blocking every attainability feature). `AGENTS.md` gained an **Open work** rule (a plan's deferrals must be filed before its PR merges) and a **Non-goals** section. Two deferrals were verified as *resolved downstream* and deliberately not filed — `Concealment` (handled by #140/U5) and `Spell Lore` (standing no-fix ruling).
>
> **Earlier (#188, merged):** bundle scope correction and wildcard set attribution; #179–#185 shipped declared stat credits end-to-end (solver, results, persistence, exports) and the priorities-UI Advanced control.
>
> **Earlier still (#168):** augments now get the item path's Speed/Striding classifier against a sibling shard keyed by augment name (`data/seed/compendium/speed_augment.json`) — `Topaz of Swiftness 15%` was granting zero alacrity and had been ruled correct twice. Added a two-link verification chain: a verbatim rendered-tooltip snapshot per distinct template invocation (in each shard's top-level `snapshots` block, case-normalized keys) and `speed_split.check_against_snapshots()`, which fails the build when a derived value disagrees with the wiki's rendered text. Both item and augment shards are guarded. A read-only refresher (`merge_harvest.py --compare-tooltips`) detects wiki-side drift; its cadence lives in `docs/wiki-evidence/speed-tooltip-tracker.md`.
>
> **Genuinely open:** [all open issues](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues) — GitHub Issues is the single source of truth, so do not maintain a second list here. Self-deferred work carries the [`backlog`](https://github.com/eddiefiggie/ddo-loadout-optimizer/issues?q=is%3Aissue+is%3Aopen+label%3Abacklog) label; user-reported work is `bug`/`enhancement`. **Non-goals** (weighted-sum/Pareto modes, user accounts, exhaustive Green Steel space, numeric TWF penalty, attainability as a default solver input) are listed in `AGENTS.md` and are deliberately *not* issues. `{{Speed|24}}` is a recorded switch row no harvested item exercises, so it stays unverified.
>
> **Standing rules:** wiki values come from the *rendered tooltip*, not the visible cell — a bundled template hides its numbers there (`docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md`). Prove a guard fails before trusting it, and remember coverage of one shard is not coverage of another (`docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`). Set defs come from the gear-planner catalog — never re-harvest into a parallel file. ddowiki has **no server-side transport** (Cloudflare); harvest only same-origin from a ddowiki tab, and strip `| = & ?` from anything returned. Run every `tests/*.test.js` file separately.
