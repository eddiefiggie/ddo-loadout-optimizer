# location_quest → adventure pack

**Harvested:** 2026-08-29 · **Issue:** #495 · **Shard:** `data/seed/compendium/quest_adventure_packs.json`

## Why a curated seed and not a rule

The Farming List's first job is answering *do I even own this?*, which is a question about
the **adventure pack**, not the quest. The dataset had no pack field and gear-planner has
none upstream. The only acquisition datum is `location_quest`: one free-text string that
may name a quest, a raid, an NPC vendor, a crafting station, a seasonal event, the DDO
Store, or nothing that is a place at all.

No string operation gets from `Gianthold Tor` to `Ruins of Gianthold`, and none separates
`The Twilight Forge` (a quest) from `Ritual Table` (a crafting station). So the mapping is
harvested, and every entry records the wiki signal that decided it.

## Method

Batched MediaWiki API per `harvest-method.md` — POST to `/api.php`, 20 titles per request,
`prop=revisions|categories`, ~1.5s apart. 533 values in 27 requests.

Three template shapes carry the pack, and all three are needed:

| Shape | Example | Meaning |
|---|---|---|
| `\| adpack = X` in `{{Quest}}` | `Gianthold Tor` → Ruins of Gianthold | the quest's own infobox |
| `{{Adpack\|X}}` | `Blue Water Inn` → Mists of Ravenloft | a non-quest page inside a pack |
| `{{Adpack\|adpack=X\|…}}` | `Vaults of the Artificers` | the page **is** the pack |

Kind comes from wiki categories: `Weapon vendors` / `NPCs in …` → vendor, `Crafting
devices` / `Crafting` → crafting, `Events` → event, `DDO Store` → store,
`Free to Play quests` → a quest needing no pack.

One further signal is derived from the harvest itself rather than from any single page:
a title that **other quests cite as their `adpack`** is a pack. That promoted five values
(`Fables of the Feywild`, `Vecna Unleashed`, `Magic of Myth Drannor`,
`Terror of Demogorgon`, `Sinister Secret of Saltmarsh`) which appear in the data as pack
names rather than quest names. That is other pages' stated evidence, not an inference.

## The extraction bug worth recording

The first pattern was `^\s*\|\s*adpack\s*=\s*(.+?)\s*$`. **`\s` matches a newline**, so on
the many pages where `| adpack =` is present and EMPTY the match ran onto the next line and
captured `| level = 8` as the adventure pack for `Body and Mind`, `Dinosaur Crisis` and
`Dread Sea Scrolls`.

It would have shipped three wrong-but-plausible pack names — the exact shape the
never-infer rule exists to prevent, since nothing downstream could have caught it. The
shipped pattern is line-bounded (`[^\n]*`), and an empty `adpack` is now recorded as its
own fact: the wiki **stating** the quest needs no pack.

That reading is corroborated rather than assumed. All 7 pages with an empty `adpack` are
also categorised `Free to Play quests` — two independent signals, zero contradictions.

All 533 rows were hash-verified against the live wiki, per group and in total, before being
written to the seed.

## Coverage — measured, not claimed

| | |
|---|---|
| Source values mapped | **533 of 533** |
| Distinct adventure packs found | **66** |
| Sourced variants reaching a **named pack** | 5,490 of 7,836 (**70.1%**) |
| Sourced variants reaching a **classified kind** | 7,233 of 7,836 (**92.3%**) |
| Variants with no `location_quest` at all | 1,274 (unchanged; their own group) |

By kind: pack-quest 5,522 · crafting 903 · unknown 603 · event 474 · vendor 284 · store 50.

**The 33 unknown values are not a backlog of quests.** They are public zones (`Korthos
Island`, `The Marketplace`, `Necropolis`, `Eveningstar`), non-locations (`None`, `N/A`,
`Random`, `Crafted`, `Favor Rewards`, `Advance to level 15`), and crafting ingredients
(`Silver Flame Nugget`, `Dragontouched Armor`, the Dragonscale armors). They render under
**Source unknown** because the wiki states nothing that could source them, and that is the
correct outcome rather than a gap to close by guessing.

## The guard

`src/adventure_packs.py::check` measures the mapping against the **live** population and
the build stamps the result as `metadata.adventure_pack_coverage`. It fails when a source
value appears that the mapping has never seen, and when the mapping names a value the data
no longer carries. It refuses to inspect zero records.

Proven to fail before being trusted, four ways: dropping an entry (a refresh adding a new
value), adding a stale one, blanking an entry's evidence, and emptying the mapping. Each
goes red; restoring goes green.
