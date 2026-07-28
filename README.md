# DDO Loadout Optimizer

**Your best-in-slot gear, proven by math — not a guess.**

🎮 **Play it now:** https://eddiefiggie.github.io/ddo-loadout-optimizer/ · **Code:** https://github.com/eddiefiggie/ddo-loadout-optimizer

**Category:** Personal

---

## What it does

Tell it your build — minimum level, class/race, armor type, weapon setup — and a **ranked list of the stats you care about**. It searches every wiki-sourced named item, augment, set bonus, and crafting option in the game and returns the **single loadout that is provably the best** for your priorities, slot by slot.

Not a tier list. Not "what a good player usually wears." An exact optimizer: it considers **7,900+ item variants** and solves for the mathematically optimal answer under DDO's real bonus-type stacking rules. When it says a set is better than three individual items, it's because it *proved* it.

And it doesn't stop at what drops — it tells you **what to craft**:

- **Which augment goes in which slot** (respecting the real color-fit matrix — Colorless anywhere, Red into Red/Purple/Orange, etc.).
- **Which "Sealed in X" effect to unseal** at the Ritual Table.
- **Which Nearly Complete / Viktranium (Lamordia) option to pick.**
- **Which Dinosaur Bone insert to slot.**
- **Which set bonus to awaken** on a Vecna *Lost Purpose* item at the **Cannith Repurposing Station**, or on a Dinosaur Bone host — including completing an artifact set (Vol's Influence, Delight of the Devourer, and the rest) that isn't found natively on *any* item.

## What's modeled

Bonus-type stacking done right (only the highest of each same-named type counts; different types add), the armor-dependent **dodge cap** clamped correctly, and priority handled as a strict lexicographic order — priority 1 is maximized first, then priority 2 without giving up any of priority 1, and so on, with a deterministic tie-break so the same query always gives the same build.

Coverage that's live today:

| System | Status |
|---|---|
| Named items across all slots + tiers | ✅ full roster (7,658 named items indexed) |
| Set bonuses (intrinsic + piece thresholds) | ✅ |
| Augments (multi-fit colors, Lunar/Solar) | ✅ |
| **Vecna Unleashed set crafting** (Lost Purpose → awaken 1 of 11 sets) | ✅ |
| **Dino Set-Bonus** (Isle of Dread, awaken 1 of 6 sets) | ✅ |
| Sealed in X (Ritual Table) | ✅ Undeath sourced; Fire/Gloom/Mist pending |
| Nearly Complete + Viktranium/Lamordia (U81) | ✅ |
| Dinosaur Bone inserts (Isle of Dread) | ✅ |
| Endgame band ML 30–36 (U81 / Isle of Dread / Myth Drannor) | ✅ named + raid gear solver-active |
| Filigrees, Green Steel, Thunder-Forged, Essence crafting | ⏳ not yet |

Everything is **wiki-sourced and exclude-until-verified**: if the DDO Wiki doesn't state a value explicitly, it's quarantined and disclosed rather than guessed. Every result shows its own coverage so you know what was and wasn't considered.

## How to use it

1. Open the [live site](https://eddiefiggie.github.io/ddo-loadout-optimizer/).
2. Set your **ML cap**, and optionally class/race, armor type, and weapon setup.
3. **Add your target affixes in priority order** (drag to reorder). First = most important.
4. Hit **Solve**. In well under a second you get:
   - a **paperdoll** of the optimal loadout, set pieces highlighted;
   - a **ranked-priority readout** showing exactly where each point of every stat comes from (which item, which set, which bonus type);
   - a **Loadout Deep Dive** with every item's affixes and every craft/augment/awaken to apply;
   - an **Alternatives** tab of near-optimal trade-off builds (complete a different set, free up a slot, fewer crafting steps).

There's also an **Item Browser** to search and filter the whole indexed roster.

## How it works (for the theorycrafters)

It's a real solver, not a script full of if-statements. Every stat source — a worn affix, an augment, a set tier, a crafted option, an awakened set — is a **gated contribution** `(stat, bonus_type, value)` that only counts when its enabling conditions hold. Those feed a mixed-integer linear program solved **in your browser** by [HiGHS](https://highs.dev/) compiled to WebAssembly, run as a staged lexicographic solve. Same math a good spreadsheet-wielding theorycrafter does — just exhaustive, exact, and instant.

The interesting recent addition is a general **chosen-set-membership** primitive: the same machinery that models "this Lost Purpose item can awaken any one of 11 sets" also models the Dino Set-Bonus, and it can complete an artifact set with *no* natively-dropping members purely from awakened pieces.

## Build & run (developers)

```
python3 build_dataset.py          # reads seed + wiki-sourced shards -> writes web/data/items.json
python3 -m http.server 8000       # then open http://localhost:8000/web/
python3 tests/run_tests.py        # Python suite (stdlib-only runner; pytest also works)
node tests/solver.test.js         # MILP solver suite (runs the real HiGHS engine)
node tests/model.test.js tests/browse.test.js tests/results.test.js
```

`web/data/items.json` is a **generated artifact** (gitignored) — edit the pipeline (`build_dataset.py` + `src/`) and the seed data, never the JSON. The `web/` folder is a self-contained static site deployed to GitHub Pages by `.github/workflows/deploy.yml` (rebuilds the dataset + runs the full test suite, then deploys on every push to `main`).

**Set definitions are single-source-of-truth:** all named-set bonuses (including the ones a Lost Purpose / Dino host can awaken) come from the gear-planner set catalog, so an awakened set and an intrinsically-completed one always give identical stats.

## Files
- `web/` — the static app (`solver.js`, `model.js`, `query.js`, `results.js`, `browse.js`, `alternatives.js`).
- `src/` + `build_dataset.py` — the Python data pipeline (parse wiki affix text, expand tier variants, verify/quarantine, build the dataset).
- `data/seed/` — hand-verified seed + wiki-sourced shards.
- `docs/plans/` — the feature plans (brainstorm → plan) behind each milestone.

## Resume prompt
> Resuming the **ddo-loadout-optimizer** garage project (`~/ClaudeGarage/personal/ddo-loadout-optimizer/`). Public DDO best-in-slot optimizer, live at eddiefiggie.github.io/ddo-loadout-optimizer. Input = ML cap + class/race + armor + weapon setup + a ranked affix list; output = the provably-optimal fully-upgraded loadout (item + tier + augment-in-slot + crafted options + chosen/awakened set bonuses), every value wiki-sourced (Claude-in-Chrome scrape; plain fetch returns empty for ddowiki). **Client-side static app on GitHub Pages**; exact MILP in-browser via **HiGHS-WASM**, staged lexicographic solve, deterministic tie-break; Python generator builds `web/data/items.json`. Core rules: strict lexicographic priority; pure theoretical BiS (no per-user inventory); strict exclude-until-verified data with per-result coverage disclosure; **never infer a value**. **State (2026-07-28):** Milestones 1–3 live; endgame band ML30-36 (U81/IoD/Myth Drannor) solver-active; crafting modeled — augments, seal/Ritual Table (Undeath), Nearly Complete, Viktranium, Dino inserts; **Vecna Lost Purpose + Dino Set-Bonus set-crafting SHIPPED** via a general self-seeding **chosen-set-membership primitive** (`web/solver.js`), 28 awakenable sets, awakens rendered in the Loadout Deep Dive with their crafting station. **Set defs come from the gear-planner catalog (single source of truth) — never re-harvest into a parallel file.** Marker-only carrier shards (mirror `_seal_carrier`) attach markers to items already solver-active via the gear-planner import (KTD6 dedup trap). Data pipeline: seed → `build_dataset.py` → `web/data/items.json` (gitignored). Next candidates: filigrees, more enriched Vecna/IoD gear, remaining crafting systems (Green Steel, Thunder-Forged, Essence).
