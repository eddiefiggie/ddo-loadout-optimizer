# Wiki evidence — Spell Lore channels + Insightful Spell Lore (U4, U5)

**Verified:** 2026-08-03 (Chrome-MCP, interactive session)
**Source:** https://ddowiki.com/page/Spell_Lore

## U4 — Insightful Spell Lore (issue #89) — CONFIRMED

> Insightful lore — Some items offer **insight bonus** to the spell lore: Insightful Spell Lore I items, Insightful Spell Lore II items, **Insightful Spell Lore V items**, Insightful Radiance Lore items, Insightful Void Lore items …

- **"Insightful Spell Lore"** (levels I..V) is a real affix: an **Insight bonus** to (universal) spell critical chance. Pomura's grants it.
- **Fix (U4):** add `"Insightful Spell Lore"` to the vocabulary with bonus type **Insight**. It then buckets as `Insightful Spell Lore || Insight` and stacks with the base Equipment-type Spell Lore (different type) — standard `name||type` behavior.

## U5 — spell-lore bonus-type channels — CONFIRMED (channel model)

The page enumerates spell lore by **bonus type**:
- Base **Spell Lore** — Equipment bonus (Type: Suffix).
- **Insightful** lore — Insight bonus.
- **Exceptional Universal** lore — Exceptional bonus.
- **Artifact Universal lore** — Artifact bonus (universal; e.g. Eminence of Autumn +6%).
- **Artifact lore** — Artifact bonus (individual/named-set; e.g. Elder's Knowledge, Vol's Influence, Delight of the Devourer, and the **Solar Gem of Spell Critical Chance**).

Also: "The universal Spell Lore … is 10% lower than the corresponding … single damage type." → **universal spell lore and element-specific lore (Fire Lore, etc.) are different stats** (different affix *names*), so they occupy different buckets and both apply to a matching-element spell.

**Consequence for the solver:** the existing `name || equivType(type)` bucketing is already the right mechanism — the fix is ensuring the DATA types each lore affix correctly (Insight vs Exceptional vs Artifact) and names universal vs specific distinctly. No new channel primitive is required for the confirmed cases; two Artifact-typed lore affixes of the **same stat name** collapse to the highest, different names/types stack.

## U5 — the precise solar-vs-artifact stacking claim — QUARANTINED

The Spell Lore page lists the **Solar Gem of Spell Critical Chance under "Artifact lore" (Artifact bonus)** — evidence that the solar aug grants an **Artifact-type** spell-lore bonus, grouped with the individual/named-set artifact lores (Elder's Knowledge, Vol's Influence, …), and distinct from **Artifact Universal lore**.

Attempted the item's own page (`https://ddowiki.com/page/Solar_Gem_of_Spell_Critical_Chance`) on 2026-08-03 — **the article does not exist** ("We don't currently have an article called …"). So the user's precise claim — individual artifact lore (Feywild Dreamer) stacks with universal artifact spell lore but NOT with the solar aug — **cannot be cleanly confirmed** from a dedicated source; only the bonus-type categorization is confirmed.

**Ruling under the hard gate (KTD2/R4): QUARANTINE the precise solar-vs-individual-artifact no-stack rule.** Do NOT implement it on inference. The confirmed, shippable part of U5 is the **channel-typing model**: type spell-lore affixes correctly (Insight / Exceptional / Artifact) and name universal vs specific distinctly, then the existing `name || equivType(type)` bucketing yields the correct stack/no-stack for the confirmed cases. The solar-aug exact interaction ships only if a future lookup (the item's real page, or the Sun/Moon "sun-moon" augment page) states the rule outright; until then it is disclosed as unverified in the coverage note.

**Status:** U4 CONFIRMED (Insight-type affix, add to vocab). U5 channel model CONFIRMED. U5 precise solar-aug stacking **QUARANTINED** (dedicated source missing; categorization-only).
