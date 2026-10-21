# Dual-slot items — Chains, Five Rings, Shackles (#915)

**Read 2026-10-21** from ddowiki, same-origin from a ddowiki tab (see
`harvest-method.md`). Two reads, each recorded where the build can check it:

- **Which slots.** The tips on each item page, read by `src/wiki_item_meta.py` from
  the `items-20261018` harvest into `wiki_item_meta.json` as `worn_slots`.
- **Whether two copies may be worn.** Each page's categories, in
  `data/seed/compendium/dual_slot_exclusivity.json`, read by `src/dual_slot.py`.

## The statement

Verbatim from the tips, with the rest of each sentence omitted:

| Item (and its Legendary tier) | Tips | Catalog slots |
|---|---|---|
| Chains | "can be worn in the Neck slot ''or'' the Waist slot" | Necklace, Belt |
| Five Rings | "can be worn in either Finger slot ''or'' the Trinket slot" | Ring, Trinket |
| Shackles | "can be worn in the Wrist slot ''or'' the Feet slot" | Bracers, Boots |

Each tip goes on to say the item defaults to the first slot when both are empty. The
infobox `slot` is that first slot, so the catalog's `slot` is the infobox one and
`alt_slots` holds the other.

## The population is six, from two independent sources

- **The wiki.** The parser reads every harvested page. Of 8,072, exactly these six
  state a second slot. A tip that reads like one but does not match the stated
  shape is refused, not skipped (`WORN_IN_LOOSE_RE`). On this harvest that refusal
  fires on nothing.
- **gear-planner.** It ships each of these six as two same-name records, one per slot,
  identical apart from `slot` and `type`. They are the only non-weapon same-name
  pairs in the dump; the other 144 pairs are weapons. The build's name dedup had
  been keeping the first record, so each item reached the solver in one slot.

`planner_items.load_planner_items` fails the build when the two sources disagree:
a gear-planner pair the tips do not state, or tips naming a different slot. Once
gear-planner's item file is retired (#910), the tips alone decide.

## Two copies: the ring and weapon rule

`ring-exclusivity.md` (#566) and `weapon-exclusivity.md` (#902) set the rule:
**an item may be worn twice unless it is Exclusive or a Minor Artifact**, both
per-item wiki categories. A page that records a binding and is in neither states
that it is not Exclusive (`Template:Bind` publishes `exclusive`, default false).

All six pages record `Binds to account` and `Binds on acquire`. None is in
`Category:Exclusive` and none carries a Minor Artifact category. So a player may
wear a second copy in the other slot (two Chains, as a necklace and as a belt),
each with its own Slaver's crafting. The `ring_exclusivity.json` read of the two
Five Rings, harvested 2026-08-28, says the same.

**#915 said the opposite.** Its text was "one shared identity so they cannot be
worn twice". That contradicted the standing rule, and no page states it. The owner
chose the rule on 2026-10-21.

### Corroboration from the categories

Each page is filed under **both** of its body-slot categories (Chains: `Neck items`
and `Waist items`; Five Rings: `Finger items` and `Trinket items`; Shackles:
`Wrist items` and `Feet items`). The shard records these as `slot_categories`, and
`dual_slot.check` fails the build if they stop naming both slots the tips state.

| Page | revid |
|---|---:|
| Chains | 628933 |
| Legendary Chains | 631926 |
| Five Rings | 630873 |
| Legendary Five Rings | 632250 |
| Shackles | 634571 |
| Legendary Shackles | 632838 |

## What is not claimed

- **Whether a second copy counts twice toward a Slave Lords set.** The solver counts
  set pieces per worn item, as it does for ring and weapon twins. No page read here
  states how the Slave Lords sets count identical items. The wiki states it for
  one ring set (Katra's, `ring-exclusivity.md`), not in general.
- **Two Five Rings on two fingers, or three copies.** The ring twin gate (#335/#566)
  needs a set bonus, which Five Rings does not carry: its set membership is chosen
  through Slaver's crafting. The only second copy modelled is the one in the
  other slot.

## How the solver uses it

Same shape as the #902 weapon twins:

- The item is a candidate in both slots under its own id. A cap allows one physical
  item in one slot, and the dominance filter will not let an uncapped dual-slot
  item prune a peer it may be unable to replace.
- Where `duplicable_worn` is stamped, a `::twin` copy in the other slot is tied to
  the copy in the item's own slot (`twin <= original`). Pins resolve to either copy.
