# Race requirements — the `race` infobox parameter

**Harvested:** 2026-09-10 (issue #740)
**Shard:** `data/seed/compendium/race_requirement.json`
**Field:** `race_req` in `scripts/merge_harvest.py`

The catalog carries no race signal whatsoever — `restrictions` is the literal
string `"unknown"` on every record (`src/variants.py:148`), and nothing reads it.
Whether an item is race-gated is a wiki claim, so every value here is harvested
rather than inferred.

---

## The marker

The `Named item` infobox carries a `race` parameter. On
`Item:Razorclaw's Armguards`:

```
 | race                       = Razorclaw Shifter
```

which renders as **"Race Absolutely Required: Razorclaw Shifter"**. That rendered
phrase is the semantics: the parameter is a hard equip gate, not a flavour note.

## Why the sweep had to be exhaustive

Two cheaper routes were tried first and both are dead ends. Recorded so neither
is retried:

- **`insource:` regex search does not work.** CirrusSearch is not installed
  (`MediaWiki 1.43.9`, plain search only), so `insource:/race *= *X/` is parsed
  as a literal term and returns 0 hits with **no error** — a silent false
  negative, the most dangerous possible failure for a completeness claim.
- **Plain search does not index these infoboxes.** Searching `"Razorclaw
  Shifter"` in the Item namespace returns **1** hit, and it is *not*
  `Item:Razorclaw's Armguards`, which demonstrably renders that exact string.

There is also **no tracking category** for race restriction. The only category
the parameter feeds is `Advance to level 15 reward items/<Race>`, which covers
the twelve Iconic starter sets and nothing else — it would have missed
Warforged docents, Dragonborn, and every pet item.

So the roster is the whole `Item:` namespace, swept page by page.

## The sweep

**13,493 pages — every non-redirect in namespace 500 — scanned, 13,493
accounted for.** `list=allpages` enumerated the namespace first so the
denominator was known before the content sweep began; the scanned count equals
it exactly, which is what rules out a silently dropped batch (5 transient
non-JSON responses occurred and were retried).

| outcome | pages |
|---|---|
| `race` stated with a value | 611 |
| `race` present but empty — a `<!-- Choices are ... -->` placeholder | 2,045 |
| no `race` parameter | 10,837 |

**Stripping HTML comments before reading the value is load-bearing.** 2,045
pages carry the parameter with only a comment placeholder behind it. A naive
`| race = (.*)` treats those as stated values and would invent a restriction on
2,045 items — more false gates than there are real ones.

### Pacing — the parallel finding

`generator=allpages` **with** `prop=revisions&rvprop=content` costs ~28s per
50-page request. Switching to explicit `titles=` POSTs against a pre-enumerated
list costs ~1.2s of wall-clock per request across 4 workers — the generator, not
the content volume, was the bottleneck. The whole sweep ran in ~7 minutes
instead of a projected ~2 hours.

Four concurrent workers is safe *here* and the reasoning is worth keeping: the
documented throttle limit is a **request rate** (~1.5s between requests ≈ 0.67
req/s). Four workers each waiting ~28s per response issue ~0.14 req/s in
aggregate — still 5× under the limit. Parallelism is only safe while each
response is slow; if responses get fast, drop the worker count.

## The value vocabulary — 22 distinct strings, 3 kinds

Values are stored **verbatim**. Classification is a separate, revisable step, so
a reclassification never requires a re-harvest.

**Real player-race gates (380 in our catalog):**

| value | catalog variants |
|---|---|
| `Warforged` (+ `warforged`, 1) | 206 |
| `Duergar Mindcleaver` · `Deep Gnome` | 16 each |
| `Sun Elf` · `Bladeforged` · `Tiefling Scoundrel` · `Dhampir Dark Bargainer` | 15 each |
| `Aasimar Scourge` · `Purple Dragon Knight` · `Shadar-kai` · `Eladrin Chaosmancer` | 14 each |
| `Razorclaw Shifter` · `Tabaxi Trailblazer` | 13 each |
| `Dragonborn` | 2 |

**Explicitly unrestricted (156):** `None` (108), `none` (87), `Any` (1) — of
which 156 are ours. These are *stated* evidence of no restriction, which is not
the same as silence, and the shard keeps the distinction.

**Not a player race (6):** `Pet`, `Iron Defender` — pet equipment. These must
never be read as a character race gate.

**Compound values** exist and need splitting, not string equality:
`Bladeforged, Warforged - Iron Defender` (2) and `Warforged - Iron Defender` (1).
The ` - ` suffix names the pet variant, not a second race.

**Case is not normalized upstream:** `None`/`none` and `Warforged`/`warforged`
both occur. Any consumer must fold case.

## What this measures about the bug

380 catalog variants carry a stated race gate. The only race predicate in the
project fires on `v.slot === "Armor"` × docent-ness (`web/model.js:757-762`),
which covers 207 of them.

**173 items are recommendable to a race that cannot equip them**, across 13
slots and 13 races. 12 of those are Forged items the `slot === "Armor"` test
cannot see by construction — the ML 15 Bladeforged set is a Cloak, a Trinket,
two Rings, a Weapon and six armour-adjacent pieces, none of them body armour:

```
Battle-Plated Cloak      Cloak     Creation Forge Sabatons   Boots
Bladed Steel Ring        Ring      Creation Forge Vambraces  Bracers
Creation Forge Bassinet  Helmet    Forgeblade                Weapon
Creation Forge Gauntlets Gloves    Icon of the Lord of Blades Trinket
Creation Forge Girdle    Belt      Livewood Band             Ring
Creation Forge Gorget    Necklace
```

### The reporter was right; the issue's reproduction was not

The report — *"set to gnome, assimar scourge bracers were advised"* —
**reproduces exactly**. `Hidden Armlets` is Bracers, ML 15, `race = Aasimar
Scourge`, and a gnome is offered it.

But #740's own end-to-end repro used **`Cowl of the Drow Devotee`**, and that
page carries **no `race` value at all**. It is named for the Drow and gated on
nobody. Filtering on this evidence would not change that placement, because that
placement was never wrong.

This is the naming trap #740 itself documents, closing on the issue that
documented it: an item's name is not evidence about its race gate, in either
direction. Only the `race` parameter is.

## Not covered

- **Values are unmapped to the wizard's race vocabulary.** The wizard offers
  `"Sun Elf (Morninglord)"`; the wiki says `Sun Elf`. `Shadar-kai` matches
  exactly. That mapping is a code decision and belongs with the filter, not the
  evidence.
- **Whether an Iconic's base race may equip its gear** is not asked here. The
  wiki states one race string; it does not say whether e.g. an Aasimar may wear
  `Aasimar Scourge` gear. Do not assume either way without a separate ruling.
- **69 harvested pages are not in our catalog** and were ignored by the merge,
  per `merge()`'s off-roster rule.
