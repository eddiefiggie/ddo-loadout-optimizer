# Utility tier — which worn effects count, and why (#343, #349)

**Ruled:** 2026-08-20. **Method:** same-origin harvest per `harvest-method.md`;
enchantment pages and item-description templates via
`action=query&prop=revisions` (POST, paced, 49 titles in three batches).
**Shards:** `UTILITY_TIER1_PRESENCE` in `src/utility_procs.py` and
`web/dataset.js` (mirrored), `UTILITY_CONTAINER_DEFAULT_ORDER` in
`web/dataset.js`. **Gates:** `tests/encoding_equivalence.js`,
`tests/perf_utility.js`.

## The admission rule

The Utility tier counts **distinct passive effects the player has while the item
is equipped**. The one test, applied to the wiki's own words for each name:

> Does the effect apply simply because the item is worn, with no trigger and no
> magnitude to rank?

That excludes four classes, each of which has a recognisable wiki wording:

| Refused class | Wiki wording that identifies it | Why |
| --- | --- | --- |
| **Proc** | "when you are hit, there is a chance", "N% chance to", "on a natural 20" | Conditional and rate-dependent; its value is a magnitude question (#331), not a presence one |
| **Magnitude** | "+N bonus to X", "+0.5[W]" | Already rankable as itself — counting it too would credit one grant twice |
| **Material / marker** | "this mythical material", "has not been fully unleashed" | Not an effect at all |
| **Unpageable** | no wiki page, or a redirect to a spell rather than the item property | Cannot be ruled without inferring, and the standing rule forbids that |

Candidates were *found* by carrier slot (presence names carried predominantly on
worn gear rather than weapons) but **admitted on the effect's nature**. The slot
heuristic is a search strategy, not the rule — `Immunity to Fear` is admitted
despite 17 weapon carriers because the wiki says the *wearer* is immune.

## Admitted

The six from #343, now evidenced rather than curated (this was the open half of
#349's acceptance — they were originally "the reported case plus its obvious
peers", which was reasonable but unverified):

| Name | Wiki, verbatim |
| --- | --- |
| `Ghostly` | "makes the wielder's melee and ranged attacks able to hit Incorporeal targets. Additionally, enemies suffer a 10% miss chance against the wielder due to incorporeality" |
| `True Seeing` | "**Passive**: You gain the benefit of the spell True Seeing" (from `Template:True Seeing` — the base page is a stub, and the item-effect page does not exist) |
| `Blurry` | "Items with this property make the wearer's outline become blurred. Enemies have a 20% Concealment miss chance" |
| `Freedom of Movement` | "This item grants its wearer the ability to move and attack normally while under the influence of magic that impedes movement, such as paralysis, solid fog, slow and web" (from `Template:Freedom of Movement`; the bare page name is the *spell*) |
| `Blindness Immunity` | "The wearer is immune to Blindness" |
| `Deathblock` | "This effect grants immunity to all death spells and…" |

Batch 1, added by #349:

| Name | Worn carriers | Wiki, verbatim |
| --- | --- | --- |
| `Lesser Displacement` | 67 | "Equipping this item causes light to distort around you. Attacks from enemies have a 25% chance to miss you due to concealment" |
| `Immunity to Fear` | 44 | "The wearer of this item is immune to all fear effects" |
| `Dusk` | 21 | "Equipping this item engulfs you in twilight. Enemies have a 10% chance to miss due to Concealment" (from `Dusk (enchantment)` — the bare name is a disambiguation page) |
| `Ethereal` | 20 | "Equipping this item causes your hands and weapons to become partially incorporeal. Your melee attacks do not roll a miss chance for Incorporeal targets" |
| `Soundproof` | 13 | "Protects against stunning, dazing and disorientation from sound-based spells such as Soundburst and Greater Shout" |

Note the concealment names (`Blurry`, `Lesser Displacement`, `Dusk`) state a
percentage but are **not** magnitude affixes in this catalog: the number is part
of the effect's description, not a rankable stat, which is why the presence
classifier already places all three in the presence population.

## Refused, with the reason

Recorded so a later pass does not re-raise them. This is what makes the roster
derivable rather than curated by memory.

| Name | Class | Wiki, verbatim |
| --- | --- | --- |
| `Eversight` | **redundant** | "you benefit from the spell True Seeing and are Immune to Blindness" — both already counted. A third count for one in-game grant would let a single item claim three distinct effects |
| `Haste Guard`, `Fire Guard`, `Radiance Guard`, `Sticky Goo Guard`, `Fascination Guard`, `Nightmare Guard`, `Incineration Guard`, `Utter Disintegration Guard`, `Invisibility Guard` | proc | `Haste Guard`: "When you are hit by enemies, there is a chance you will be Hasted". The whole `* Guard` family shares the on-being-hit trigger |
| `Demonic Shield`, `Legendary Demonic Shield` | proc | "each time you are hit in combat there is a 10% chance that a shield of demonic energy will grant you…" |
| `Roar` | proc | "25% chance for Melee attackers to take 2d6 sonic damage… when they hit you" |
| `Angelic Grace` | proc | "When you are hit, 5% chance to gain 150 Temporary Hit Points" |
| `Boon of Undeath` | proc (and a drawback) | "Every time a character wearing a Boon of Undeath item is struck in combat, an Inflict Light Wounds spell will be cast on the character" |
| `Glass Jaw Strike` | proc | "when you roll a natural 20 on an unarmed attack…" |
| `Relentless Fury` | proc | "any killing blows you strike against enemies **may** drive you into a furious rage… for 30 seconds" |
| `Sight Beyond Sight` | composite | "You can see through all veils… **+5% Enhancement bonus to Dodge bypass**" — the magnitude half is separately rankable |
| `Temperance of Belief`, `Temperance of Spirit` | magnitude (and ramping) | "+1 quality bonus to Magical Resistance Rating **per Religious Lore feat**" |
| `Strength of Purpose` | magnitude | "+128 Enhancement Bonus to Unconsciousness Range, and regenerate 16 Hit Points…" (the same effect #386 left unadjudicated) |
| `Reinforced Fists`, `Superior Reinforced Fists`, `Spike-Studded` | magnitude / conditional | "+0.5[W]" while unarmed |
| `Whirlwind Ward` | negligible scope | "immune to being knocked down by an **Air Elemental's** whirlwind" — a genuine passive, refused as a product judgment: one monster's knockdown would crowd out effects players notice. Flagged as a judgment, not a wiki fact |
| `Dragontouched` | material | "This mythical material was created by combining an unknown metal with ancient enchantments" |
| `Incredible Potential` | crafting marker | "This ring's power has not been fully unleashed. When this ring is combined with 9 Shavarath Trophies…" |
| `Taint of Shavarath`, `Legendary Taint of Shavarath` | Green Steel drawback | "Green Steel items thirst for pain and suffering… accessories and clothing cannot [sate it]" |
| `VotAU` | unpageable | no wiki page — an abbreviation in the catalog, which is its own data-quality smell |
| `Greater Nimbleness`, `Archmagi`, `Faith`, `Wind Through the Trees` | unpageable | no enchantment page; `Ram's Might`, `Greater Heroism`, `Fire Shield` resolve to **spell** pages, not the item property |

## Gate results for this batch

Run in the order the #349 procedure mandates — correctness before cost.

| Gate | Result |
| --- | --- |
| Encoding equivalence, k=25 (shipped roster) | **17/17 agree, 0 disagree** |
| Encoding equivalence, probe k=22..32 | agree at every size; `largest clean size: 32` |
| Unpinned-gap drift | **0 at k<=24, non-zero from k=26** — the pin is now load-bearing, not precautionary |
| Perf, roster 26 | **2.02x / 2.00x budget — FAIL** |
| Perf, roster 25 (shipped) | **1.98x / 2.00x budget — PASS** |

The 26-name batch failed the perf gate and was trimmed by one. `Eversight` was
the name cut, chosen because it had an independent reason to go (redundancy,
above) rather than because it was the cheapest — a trim on merit, not on cost.

`UTILITY_CONTAINER_CAP` moved 20 -> 28: the gate proves 32, minus a margin of
four. It was 20 only because 20 was the largest size anyone had measured.
