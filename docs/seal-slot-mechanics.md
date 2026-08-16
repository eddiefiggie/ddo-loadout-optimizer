# Seal-Slot Crafting Mechanics — wiki-confirmed

**Date:** 2026-07-26 · **Authority:** the DDO Wiki (sourced via Claude-in-Chrome; plain `fetch` returns empty for ddowiki.com). Raw evidence: `data/seed/compendium/raw/seal_mechanics.json`.

This is the source-of-truth for how the optimizer models the "Sealed in X" enchantments. It backs the wiki-sourced pool in `data/seed/seal.json` under the project's strict-provenance contract.

## The mechanic

Each **"Sealed in X"** enchantment is a `Unique_enchantment` that carries a **single-pick choice-slot**. The wiki text is uniform across the family:

> "…It can have its power unsealed at the [table], **adding one effect. Attempting to add another will remove the original.**"

So the solver treats a seal slot as a gated **select-one**: the host may unseal exactly **one** option from its seal type's pool, mutually exclusive, feeding the same `(stat, bonus_type)` buckets as every other source (so bonus-type stacking holds). This is the identical primitive behind Nearly Complete and Viktranium slots — no new solver mechanic.

## The family (four members; Amber excluded)

| Seal | Gear domain | Unsealed at |
|---|---|---|
| Sealed in Undeath | clothing / jewelry | Ritual Table |
| Sealed in Fire | weapons | Ritual Table |
| Sealed in Gloom | equipment / accessories | Augmentation Altar |
| Sealed in Mist | weapons | Augmentation Altar |

The pool is keyed by **seal type** (each seal is one flat pool over its gear domain). **`Sealed in Amber` is not a member** — it is Ravenloft "The Vampire Hunters" quest content, not a stat-choice seal, and is deliberately excluded from `SEAL_TYPES`.

## The Sealed in Undeath pool (enumerated)

From the Ritual Table "Sealed in Undeath clothing / jewelry upgrades" section — unseal **one** of:

- an ability score (Strength / Constitution / Dexterity / Intelligence / Wisdom / Charisma) at **+15** (Enhancement),
- the same at **+7 Insightful**, or
- the same at **+3 Quality**.

18 options total. The bonus types were verified against `src.affix_parser.parse_line`: a bare `{{Stat|X|15}}` renders untyped → Enhancement; `|Insightful` and `|Quality` render those types. The Fire pool was harvested 2026-08-11 (`docs/wiki-evidence/sealed-in-fire.md`: six unique-enchantment procs, presence) and the Gloom / Mist pools 2026-08-15 (`docs/wiki-evidence/sealed-in-gloom-mist.md`: Gloom is Undeath-shaped — 18 ability options at the Augmentation Altar, bonus types wiki-stated in the tooltip layer; Mist is the same six procs as Fire). **All four pools are enumerated and solver-live.**

## Host sourcing and the reachability gap

Which items carry a seal comes from the **gear-planner dataset** (ddowiki-derived), not a per-item wiki crawl. Two representations must both be read: Undeath / Mist / Gloom appear in an item's `crafting[]` array; Fire / Amber appear in `affixes[]` as `{type:"Bool"}` markers.

The 9 Sealed-in-Undeath hosts are **Threats Old and New** raid jewelry/clothing (the Undying Age "Reflections" gear); they carry `quests: ["Threats Old and New"]`, which the planner import's `QUEST_MAP` did not cover, so they were skipped and appear in no wiki batch. The `undyingage` QUEST_MAP key closes that gap. See `data/seed/compendium/raw/seal_mechanics.json` for the host cross-check (no delta observed vs the gear-planner).

## Known follow-up for the deferred Fire pool

Seven of the Fire hosts (Finality, Flamefang, Folly, Kindling, Nova, Omen, Spur) are **seal-only weapons** — their gear-planner record carries the Fire seal but zero base affixes. The verification gate quarantines a zero-affix item, so `eligible()` prunes these before the seal solver runs. Today this is harmless (the Fire pool is empty, so they could not craft anything anyway), and the coverage count reports them as **pending**, not active — so nothing is overstated. But when the Fire pool is harvested, these hosts must be re-admitted the way Dinosaur Bone blanks are (materialized after the verify pass, or by treating a seal slot as a solver-eligible affix), or their Fire seal can never activate. Undeath is unaffected — every Undeath host carries base affixes and verifies.

## Not applicable (recorded, not deferred)

- **Demogorgon raid upgrade** — the Terror of Demogorgon raid documents no seal/ritual/upgrade slot; its crafting is Catalyst (item-creation, sourced as named gear).
- **Essence Crafting** (the Cannith rename) — a universal craft-your-own system whose generic Enhancement affixes rarely beat named best-in-slot.
