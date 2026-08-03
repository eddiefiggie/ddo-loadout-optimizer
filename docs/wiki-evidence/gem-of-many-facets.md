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
