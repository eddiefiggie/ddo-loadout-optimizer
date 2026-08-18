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

**Status:** U4 CONFIRMED (Insight-type affix, add to vocab). U5 channel model CONFIRMED. U5 precise solar-aug stacking ~~QUARANTINED~~ **RESOLVED 2026-08-13 — see the #290 section below.**

### U5 — build-time verification: confirmable part already correct — NO FIX NEEDED

The generated dataset already types lore affixes correctly: `Spell Lore | Insight`, `Spell Lore | Equipment`, `Fire Lore | Equipment`, `Universal Spell Lore`, etc. (verified during U4 investigation). The solver's `name || equivType(type)` bucketing — covered by the existing solver suite — therefore already stacks differently-named or differently-typed lores and collapses same-name-same-type ones. So the **confirmed** channel behavior (e.g. "individual element lore stacks with universal spell lore") already holds with no code change. The **only** broken piece was the solar aug's precise interaction, which is QUARANTINED above. **U5 ships no code**; the surfaced Spell-Lore/Universal-Spell-Lore synonym question routes to #89.

## #290 (2026-08-13) — lore cross-add evidence: additivity CONFIRMED, solar quarantine RESOLVED, roster recorded

**Harvest:** Claude-in-Chrome, same-origin reads of ddowiki (rendered text), 2026-08-13.
Pages: `Spell_Lore`, `Spell_critical`, `Universal_Spell_Lore`, `Lunar_and_Solar_Gems`
(redirect target of `Sun_and_Moon_Augments`), `Solar_Gem_of_Spell_Critical_Chance`
(still no article — see resolution path below).

### CORRECTED 2026-08-18 (#366) — the base-Spell-Lore leg was a misreading

**This section's original conclusion was wrong in one half, and shipped an
over-stack for five days.** Read the correction before the evidence below.

The quoted sentence licenses **`Universal Spell Lore` <-> anything**. It does
**not** license **base `Spell Lore` <-> element lore**, which is how it was read.
"an item with a Universal Spell Lore Equipment bonus will stack with another item
with a Spell Lore or Acid Lore Equipment bonus" names `Spell Lore` and
`Acid Lore` as two separate things USL stacks *with*; it says nothing about those
two stacking with each other.

Re-read 2026-08-18, same-origin:

* `Universal_Spell_Lore`'s item table is headed **"Exceptional Universal Spell
  Lore items"** with rows reading `Exceptional Universal Spell Lore +3%`. That
  matches our stored `Universal Spell Lore | Exceptional` (65 items) — so the
  wiki's term is our affix of that name, **not** our `Spell Lore | Equipment`.
  The alternative reading, which would have vindicated the cross-add, is dead.
* `Spell_Lore` lists base Spell Lore as a **peer of the element lores**,
  separated only by coverage: "Void Lore - negative energy and poison spells" /
  "**Spell Lore - all spell types**", and types it as an equipment bonus. The
  page states **no stacking rule anywhere**; neither does `Spell_critical`.

So the wiki documents an explicit "separate and stacking" exception for Universal
Spell Lore and documents none for base Spell Lore. DDO's default applies: same
bonus type, only the highest counts.

**Resolution.** Base `Spell Lore` moved to the EXPANSION family
(`spell_focus._UNIVERSAL`), exactly like `Potency` in the spellpower channel — it
was the one member of its family filed in the wrong place. `Universal Spell Lore`
stays in `cross_add`. Reported by a player as Void Lore summing to 55 where 50 was
correct; the fix reproduces 50.

**Why it survived review:** the conclusion below presents both legs at equal
strength and flags the difference only in passing ("additionally rests on"). A
leg that rests on an inference should be labelled as one, not folded into a
section titled "stated outright".

### Additivity — universal lore stacks with element lore, stated outright

`https://ddowiki.com/page/Universal_Spell_Lore`, lead paragraph (verbatim):

> Universal Spell Lore is a separate and stacking source of Spell Critical
> chance modifiers. As such an item with a Universal Spell Lore Equipment bonus
> will stack with another item with a Spell Lore or Acid Lore Equipment bonus,
> for example.

This states same-bonus-type stacking across lore names, explicitly naming an
element lore. Consequence for the solver: an element-lore priority may **sum**
the `Universal Spell Lore` and `Spell Lore` buckets alongside its own
(cross-add), and merging any of these names into one bucket remains a bug.
The `Spell Lore` <-> element-lore leg additionally rests on the U5 channel-model
ruling above ("different stats ... both apply") and the `Spell_Lore` page's
typing ("For each type of damage, there is a specific lore type. In addition,
there's the universal Spell Lore." / "Spell Lore - all spell types"), now
reinforced by the USL sentence grouping `Spell Lore` and `Acid Lore` as peer
stackable Equipment sources.

### Solar-vs-artifact stacking — RESOLVED, no code change needed

The Solar Gem's own article still does not exist (re-checked 2026-08-13), but
`https://ddowiki.com/page/Lunar_and_Solar_Gems` now states both halves:

> Lunar Gems primarily provide Profane bonuses, while Solar Gems primarily
> provide Artifact bonuses. As usual, multiple effects with the same bonus type
> don't stack.

and its Solar table row: `Spell Critical Chance — Artifact Bonus to Spell
Critical Chance +2% +4% +6%` (universal, no element qualifier).

Ruling: the solar crit-chance gem is an Artifact-typed **universal** lore
source. Whether it collapses with a named set's artifact lore is decided by
stat-name identity under the existing per-(stat, bonus-type) max bucket — same
stored name + Artifact = max (the stated "same bonus type don't stack"),
different stored names = stack (the USL "separate and stacking" statement).
The bucketing already implements this; the cross-add must not merge names
(it sums across buckets, never within). **No dedicated exception mechanism is
required.** The old quarantine is closed on these quotes.

### Element-lore roster — cross-add targets and exclusions

`Spell_Lore` page, "Types of spell lore" (verbatim list): Acid Lore, Fire Lore,
Ice Lore, Lightning Lore, Healing Lore, Kinetic [Lore], Radiance Lore, Repair
Lore, Sonic Lore, Void Lore — "In addition, there's the universal Spell Lore."

Cross-add targets are exactly this ten-name wiki roster (as matched against the
dataset vocabulary at build time). **Exclusions, recorded deliberately:**

- `Laceration Lore` — removed from the game (pre-U19); page says so outright.
- Combined/flavored lores (`Blighted Lore`, `Purifying Flame Lore`,
  `Moonlit Haunt Lore`, `Firestorm Lore`, ...) — the page's "Combined Spell
  Lore" section defines these as separate multi-element enchantments; they are
  not in the roster, so they receive no universal credit in the map. In-game
  the universal lores plausibly apply to their underlying spells, but no wiki
  statement ties a universal name to a combined-lore name, so extension is
  deferred until a report warrants it (never infer).
