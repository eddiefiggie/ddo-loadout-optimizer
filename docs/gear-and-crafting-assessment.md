# Gear & Crafting-Mechanics Assessment — Myth Drannor · Lamordia · Update 81 · Isle of Dread

**Date:** 2026-07-26 · **Grounding:** live DDO-wiki reconnaissance (Claude-in-Chrome; server-side fetch returns empty for ddowiki.com). Written to answer the goal directive: *"carefully assess their gear crafting mechanics — some may only be related to certain gear, or tied to access to a ritual table."*

This is the source-of-truth for **which crafting systems the optimizer must model (affix choice-slots) vs. which produce named gear to source (item-creation), and how each is gated** — so the named-gear sweep attributes every value correctly.

---

## 1. The two kinds of crafting (why it matters to the solver)

Every DDO crafting system is one of two shapes, and the optimizer treats them differently:

- **Affix-adding (choice-slot / typed insert).** Attaches a craftable affix to an *existing* item. Modeled by the shipped **gated-contribution primitive** — the item gets a slot; the solver picks the best insert. Examples already shipped: Augments, IoD Dino inserts, U81 Nearly Complete/Finished, Viktranium/Lamordia slots.
- **Item-creating.** Produces a *new* named item. Nothing for the solver to model — the output is just **named gear to source** (R4 sweep). Example: Catalyst Crafting.

A system's *gating* (which altar/table, which eligible gear) never changes its availability under the optimizer's **pure-theoretical-BiS** assumption (everything obtainable). Gating matters only for **correct attribution**: which insert pool applies to which gear category, and whether an effect is a solver primitive or a sourced item.

---

## 2. Per-expansion verdict

| Expansion | = Update / Pack | Crafting system(s) | Shape | Ritual table / altar (access gate) | Optimizer treatment |
|---|---|---|---|---|---|
| **Isle of Dread** | Update 67 | **Dinosaur Bone crafting** | affix choice-slot, **two-keyed `(bone type × gear category)`** | Dino crafting altar (Isle of Dread) | ✅ **DONE** — solver-active (Accessory + Weapon/Armor/Raid; multi-affix; 84 insert units). Set-Bonus deferred (see §4). |
| **Lamordia** | "Viktranium Experiment" content (a **Level 8+** system from **U75, The Chill of Ravenloft** — *not* U81) | **Viktranium Experiment Crafting** | affix choice-slot, **two-keyed `(slot type × item category)`** | Viktranium ritual station | ✅ **DONE** — solver-active (194 options, 43 hosts). |
| **Update 81** | **Terror of Demogorgon** (Underdark / Gravenhollow; released 2026-07-22) | **Essence Crafting** *(= Cannith Crafting renamed, U9; universal)* | item-creation + affix slots | **House Kundarak Crafting Hall** | ⚠️ **Universal, not U81-specific** — de-scope from the expansion sweep as a *system*; its crafted generic Enhancement affixes rarely beat named BiS. Revisit separately if ever modeled. |
| **Update 81** | Terror of Demogorgon | **Catalyst Crafting** | **item-CREATION** | **Strange Catalyst Forge, Gravenhollow** — combines a rare Catalyst (from Demogorgon quests) with a *specific older named item* | 🎯 **Named gear** — the created ML11/ML35 Drow/Demon-themed items are sourced in the R4 sweep. **Not** a solver primitive. |
| **Myth Drannor** | "Magic of Myth Drannor" pack (Outskirts + Ruins; Heroic/Legendary sagas) | **none distinct** | — | — | 🎯 **Named/raid gear only.** |

### Direct answers to the directive
- **"Tied to access to a ritual table":** confirmed for **Catalyst Crafting** (Strange Catalyst Forge, Gravenhollow — the clearest "ritual table"), **Essence/Cannith** (Kundarak Crafting Hall), **Viktranium** (its ritual station), **Dino** (its altar), plus the general **Sealed Altar** (L11+) system. Under theoretical-BiS this doesn't restrict availability — but it confirms these are *station-gated crafts*, not intrinsic item stats.
- **"Only related to certain gear":** confirmed and material to attribution — **Dino** inserts are typed by *bone type × gear category* (a Scale-Weapon insert fits only a Scale-Weapon slot); **Viktranium** likewise (slot type × item category); **Catalyst** transforms only *specific eligible older named items*. The solver already enforces the Dino/Viktranium two-key typing.

---

## 3. Named/raid gear frontier (the R4 sweep targets)

The headline goal — capture **all** named + raid gear for these expansions. Frontier pages identified:

- **Update 81 / Terror of Demogorgon:** quest reward gear across Gravenhollow / Underdark quests + the **Terror of Demogorgon raid** (Heroic & Legendary) + the **Catalyst-crafted item roster** (Drow/Demon-themed, ML11/ML35). Enumerate via the quest pages and the raid loot list (no single `Category:Terror of Demogorgon items` exists yet — pack released 2026-07-22, so the wiki taxonomy is still filling in; harvest by quest/raid page + `Category:<slot> items` cross-reference).
- **Lamordia:** the **Lamordian** clothing line + **Legendary Cataclysmic** weapons/shields (the Viktranium "Cataclysmic" item-creation output). Already partly in the local roster (**~32 "Lamordian" + ~44 "Cataclysmic"** name matches) — indexed, **not yet enriched**.
- **Myth Drannor:** the "Magic of Myth Drannor" pack quest gear + **Heroic/Legendary Myth Drannor Saga** reward items.

**Capture = enrich, not just index.** The 7,658-item roster already *indexes* most existing named gear (browse-only), but only **262 are enriched** (solver-active). The roster is keyed by slot, **not tagged by expansion**, so expansion capture proceeds by: identify each expansion's item set (by name family / quest / raid page) → harvest `enhancements` wikitext → `enrich.build_item_record` → verify. Newly-released U81 items may need *indexing* first (roster predates the 2026-07-22 release).

---

## 4. Carry-over decision — Dino Set-Bonus (from M2)

Dino Set-Bonus is a **crafted set-membership choice-slot** (only Armor/Helmet/Cloak hosts carry a set-bonus slot; ≤3 crafted slots, yet one set needs 5 pieces). Sourced + browsable now; **solver activation deferred to the IoD named-gear sweep**, when intrinsic named/raid pieces that also belong to these sets exist and completion becomes meaningful. This is the natural join point between the crafting work (done) and the R4 gear sweep.

---

## 5. Sweep plan (batched, strict provenance)

Per the proven compendium pipeline ([[ddo-optimizer-compendium-shipped]] in memory), each batch: harvest a set's `enhancements` wikitext via the same-origin MediaWiki API (paced — rapid bursts trigger a Cloudflare 202 throttle; a real page navigation refreshes clearance) → `enrich.build_item_record` per item → `enriched_batch<N>.json` + committed raw → rebuild + tests. Suggested order (tractability first):

1. **Lamordia** (Lamordian + Cataclysmic) — already roster-indexed, smallest, name-identifiable. Ships the Viktranium/Lamordia gear alongside its already-active crafting.
2. **Myth Drannor** — bounded pack + saga sets.
3. **Update 81 / Terror of Demogorgon** — largest & newest; index-then-enrich, includes the raid + Catalyst roster. Wire the deferred Dino Set-Bonus here if intrinsic IoD set pieces surface.
4. **Isle of Dread named/raid gear** — completes IoD end-to-end (crafting already done).
