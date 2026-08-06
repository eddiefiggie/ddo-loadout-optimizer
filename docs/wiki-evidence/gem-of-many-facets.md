# Wiki evidence — Gem of Many Facets (U6)

**Verified:** 2026-08-03 (Chrome-MCP, interactive session)
**Source:** https://ddowiki.com/page/Item:Gem_of_Many_Facets (Heroic, ML 5)

## Quoted rule

The item's enchantments list **two independent random set assignments**:

> Random set 1 (from Red Fens or Vault of Night): Divine Blessing · Elder's Knowledge · Marshwalker · Raven's Eye · Shaman's Fury · Siren's Ward · Vulkoor's Cunning · Vulkoor's Might · Kundarak Delving Equipment · Mroranon's Might · Silver Concord's Subtlety · Wards of House Kundarak · Draconic Prophecy
>
> Random set 2 (from Chronoscope or Sands of Menechtarun): Might of the Abishai · The Desert's Biting Sands · The Desert's Burning Sun · The Desert's Starless Nights · The Desert's Writhing Storm · Menechtarun Scavenger · Oasis of Morality · Vulkoor's Chosen · Windlasher's Ferocity

Also: `Yellow Augment Slot`; upgradeable to Epic Gem of Many Facets.

## Ruling for the optimizer (U6 / R7)

- The Gem grants **one set membership from EACH of two independent pools** → it counts toward **two sets simultaneously** (one from pool 1, one from pool 2). This is the "unique multi-set variable" the user reported.
- This is **exactly the `joker_set_groups` two-group model** (one select-one pick per group). So the machinery is correct — the bug is almost certainly **data**: the Gem's `joker_set_groups` is missing a pool, or its set lists are wrong/incomplete vs the two lists above.
- **Fix (U6):** reconcile the Gem's `joker_set_groups` data against these two pools (correct/complete both groups); the solver's one-pick-per-group + `hostSets` no-double-count guard then yields the right two-set behavior. Only touch the solver logic if, after the data is correct, it still can't select one set from each group.

## Caveat — endgame version

This is the **Heroic** Gem (ML 5). The optimizer is endgame-focused, so the **Epic / Legendary Gem of Many Facets** is the relevant one and its two pools may differ or be larger. Verify the Legendary item's page for its actual set pools before finalizing the data — do not assume the Heroic lists carry to Legendary.

**Status:** MECHANIC CONFIRMED (two independent set pools, one membership each). Data reconciliation against the correct (Heroic + Legendary) pools is the fix; the multi-set solver model already supports it.

---

## U5 (2026-08-05) — all three tiers now harvested and wired

The caveat above was right to flag it: **the pools differ per tier by name**, though not by membership. Each tier draws from the same 13 + 9 sets at its own tier prefix.

**Heroic** — re-verified against https://ddowiki.com/page/Item:Gem_of_Many_Facets (ML 5). Unchanged from the 2026-07-27 harvest: 13 + 9 bare names.

**Epic** — harvested fresh from https://ddowiki.com/page/Item:Epic_Gem_of_Many_Facets (ML 20).

> Random set 1 (from Epic Vault of Night or Epic Red Fens): Epic Divine Blessing · Epic Elder's Knowledge · Epic Marshwalker · Epic Raven's Eye · Epic Shaman's Fury · Epic Siren's Ward · Epic Vulkoor's Cunning · Epic Vulkoor's Might · Epic Kundarak Delving Equipment · Epic Mroranon's Might · Epic Silver Concord's Subtlety · Epic Wards of House Kundarak · Epic Draconic Prophecy
>
> Random set 2 (from Epic Chronoscope or Epic Sands of Menechtarun): Epic Might of the Abishai · The Epic Desert's Biting Sands · The Epic Desert's Burning Sun · The Epic Desert's Starless Nights · The Epic Desert's Writhing Storm · Epic Menechtarun Scavenger · Epic Oasis of Morality · Epic Vulkoor's Chosen · Epic Windlasher's Ferocity

Note the Desert sets infix the tier (`The Epic Desert's …`, `The Legendary Desert's …`) rather than prefixing it, so the naming is not mechanically derivable — each tier was read off its own page.

**All 44 names were checked against the built dataset before seeding; every one resolves to a real set definition**, so no tier is wired to a name that grants nothing.

| Tier | ML | Pools | Wired |
|---|---|---|---|
| Gem of Many Facets | 5 | 13 + 9 | yes (+ `[Crafted]` twin) |
| Epic Gem of Many Facets | 20 | 13 + 9 | yes (+ `[Crafted]` twin) |
| Legendary Gem of Many Facets | 30 | 13 + 9 | yes (+ `[Crafted]` twin) |

`tests/test_joker_sets.py::test_non_legendary_gem_tiers_are_not_attached` — which asserted the heroic and Epic tiers stay unattached — is **retired and inverted** into `test_every_gem_tier_is_attached`.

**Consequence for the report.** The reporter said users "have not seen builds with it being used" and named no tier. Before this, only the Legendary variant had any wiring at all, so a heroic or Epic Gem could never be selected as a set piece regardless of whether it was the right answer — that alone explains the report for two of the three tiers.
