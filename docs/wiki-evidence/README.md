# Wiki evidence — user-reported correctness batch

Per-item DDO-wiki verification for the correctness units of
`docs/plans/2026-08-03-002-fix-user-reported-correctness-batch-plan.md` (KTD7).
Each fix ships only against the cited rule here; anything unconfirmable is
**quarantined**, never inferred. Verified 2026-08-03 via Chrome-MCP (paced).

| Item | Unit | Status | Ruling (one line) |
|---|---|---|---|
| [Sheltering](sheltering.md) | U2 | **CONFIRMED** | Bare "Sheltering" = +X to BOTH PRR and MRR (Enhancement default); expand type-preserving into Physical + Magical Sheltering. |
| [Negative Amplification](negative-amplification.md) | U3 (#109) | **CONFIRMED (model)** | Neg-amp is typed (Insight/Quality/Profane); same-type dedups. The Hooves-vs-Lamordia collapse needs the Lamordia item's own wiki type — a per-item data check, else quarantine. |
| [Insightful Spell Lore](spell-lore.md) | U4 (#89) | **CONFIRMED** | "Insightful Spell Lore" (I..V) is a real **Insight**-bonus affix; add to vocab (Pomura's). |
| [Spell-lore channels](spell-lore.md) | U5 | **CONFIRMED (model)** | Channels are bonus types: Equipment/Insight/Exceptional/Artifact; universal vs specific are different stats. Existing `name‖type` bucketing suffices. |
| [Solar spell-lore aug](spell-lore.md) | U5 | **QUARANTINED** | Dedicated source missing; only categorized as Artifact-type. The precise solar-vs-artifact no-stack rule is NOT implemented on inference. |
| [Gem of Many Facets](gem-of-many-facets.md) | U6 | **CONFIRMED (Heroic)** | Two independent set pools → counts toward one set from EACH (the `joker_set_groups` model). Likely a data fix; verify the Legendary version's pools. |

**Net:** 5 of 6 rulings confirmed and buildable; 1 sub-claim (solar-aug precise stacking) quarantined pending a dedicated source. The neg-amp and Gem fixes carry a per-item data check (Lamordia item type; Legendary Gem pools) to complete at build time — also wiki-cited, not inferred.
