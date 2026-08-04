# Wiki evidence — Spell Lore channels + Insightful Spell Lore (U4, U5)

**Verified:** 2026-08-03 (Chrome-MCP, interactive session)
**Source:** https://ddowiki.com/page/Spell_Lore

## U4 — Insightful Spell Lore (issue #89) — VERIFIED, NO FIX NEEDED

> Insightful lore — Some items offer **insight bonus** to the spell lore: Insightful Spell Lore I items, Insightful Spell Lore II items, **Insightful Spell Lore V items** …

- "Insightful Spell Lore" (levels I..V) is a real affix: an **Insight bonus** to spell critical chance.
- **Investigation (build-time data check) overturned the scout's premise.** It is NOT stored as a literal `"Insightful Spell Lore"` name — insight bonuses are stored as `name` + `type`. Pomura's Memento in the generated dataset (`web/data/items.json`) carries **`Spell Lore | Insight | 5 | eligible=True`** — which *is* Insightful Spell Lore **V** (value 5 = level V). It is recognized (`Spell Lore` is in the vocab), eligible, and scored; **35 items** carry Insight-typed Spell Lore.
- **Ruling: no code change.** The affix is already present and scored correctly. The "missing" report was a false positive from string-matching the literal name. Nothing added to the vocab (adding a duplicate `"Insightful Spell Lore"` name would create a phantom bucket that fails to match the correctly-typed data).

### Adjacent finding (routed to #89) — RESOLVED 2026-08-04: correctly DISTINCT, no merge

Investigated whether `"Spell Lore"` and `"Universal Spell Lore"` are the same stat that should be aliased. **Verdict: NO — they are correctly distinct, no fix.**

- **Bonus-type breakdown (generated dataset):** `Spell Lore` → Equipment 73, Insight 35, Exceptional 1, Artifact 3. `Universal Spell Lore` → **Exceptional only (65)**. So `Universal Spell Lore` is the **"Exceptional Universal Spell Lore"** variant the wiki lists (Exceptional bonus type), NOT a synonym for base equipment Spell Lore.
- **Co-occurrence:** 10 items (the *…Longsword of the Undying Age* family) carry BOTH names — on those, `Spell Lore = Equipment 13` and `Universal Spell Lore = Exceptional 5`. **Different bonus types → they legitimately STACK** (13 + 5), which is correct DDO behavior, not a double-count.
- **Ruling:** aliasing/merging them would be a **bug** — it would risk collapsing two genuinely-stacking sources and it contradicts the co-occurrence evidence (`affix_aliases.json` rule: same-item co-occurrence ⇒ distinct, never merge). No alias added. The optimizer's current separate-bucket behavior is correct; a user wanting both can pick both names (both are targetable).

**Status:** #89 (this Spell-Lore/Universal-Spell-Lore pair) VERIFIED correct — no double-count, no merge, no code change.

**Status:** U4 VERIFIED correct — no fix. Surfaced a Spell-Lore/Universal-Spell-Lore synonym question for #89.

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

### U5 — build-time verification: confirmable part already correct — NO FIX NEEDED

The generated dataset already types lore affixes correctly: `Spell Lore | Insight`, `Spell Lore | Equipment`, `Fire Lore | Equipment`, `Universal Spell Lore`, etc. (verified during U4 investigation). The solver's `name || equivType(type)` bucketing — covered by the existing solver suite — therefore already stacks differently-named or differently-typed lores and collapses same-name-same-type ones. So the **confirmed** channel behavior (e.g. "individual element lore stacks with universal spell lore") already holds with no code change. The **only** broken piece was the solar aug's precise interaction, which is QUARANTINED above. **U5 ships no code**; the surfaced Spell-Lore/Universal-Spell-Lore synonym question routes to #89.
