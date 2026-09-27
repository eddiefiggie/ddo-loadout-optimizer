# Where augments come from — the wiki's `locations` field

**Harvested:** 2026-09-27 · **Shards:** `data/seed/compendium/augment_locations.json`,
`data/seed/compendium/wiki_link_pages.json` · **Stage + guard:** `src/wiki_links.py`,
`tests/test_wiki_links.py`

## The question

The Farming List told a player which augment to slot and nothing about where to get it,
because gear-planner records no acquisition data for any augment (`location_quest` is
empty on every one). A player asked for a hunting list: "for augments and the like that
can be found in numerous places … reference where these items can be found".

## The answer is on each augment's own page

Every augment page uses `{{Item Augment}}`, and its `locations` parameter is structured:
one line per source, `Place + how + detail;`.

```
Zoo Creeper + loot + end chest ([[Looting#Rare loot|rare]]);
The Chill of Ravenloft (Legendary) + rewards + any difficulty;
Randall Lyric (Gravenhollow) + purchasable augments + <br/> (6000) [[Item:Mysterious Remnant]];
```

The separator is a literal `+` (character 43, checked on the raw wikitext, not on a
rendered or privacy-filtered copy). The template renders `Place` as a link to the page of
exactly that title, which is why the app can link it too: it is the wiki's own link.

`how` takes four values across the harvest: `loot`, `rewards`, `purchasable augments`,
`reward items`. `detail` is kept as the wiki wrote it, with link markup reduced to its
label, `<br/>` to ` ; `, and `''`/`'''` italic/bold markup removed.

## Which augments were harvested, and why only those

Only the **472 named augments**. The other 675 are acquirable: they are members of
`Category:Common augments`, `Uncommon augments` or `Rare augments`, and
[augment-acquirability.md](augment-acquirability.md) already rules what that means:
vendor stock, Mysterious Remnant trades, and random chest loot, with no specific place to
farm. Harvesting their `locations` would list an augment vendor for each of them, which
says less than the ruling does.

All 675 were checked on 2026-09-27 to sit at exactly `Item:<name>`: the sha256 of the
wiki's sorted, prefix-stripped category members equals the sha256 of the catalog's
acquirable set. So an acquirable augment's page link is built from that ruling, and it
needs no per-augment entry.

## The 82 with no page

All 82 named augments without a wiki page are `(Epic)` Solar or Lunar Gems. They are
recorded as `page: null` and the hunting list says "The DDO wiki has no page for this
augment", which is different from "common" and different from "not loaded". Nothing is
guessed for them. In particular, the Heroic and Legendary siblings' locations are not
reused, because the tiers drop in different places.

## Method

Per [harvest-method.md](harvest-method.md), through the in-app Browser pane:

1. The 472 names were sent to a ddowiki tab and hashed on both sides before use (sha256
   `897cc207…` on both).
2. `action=query&prop=revisions&rvslots=main`, 20 `Item:` titles per POST, ~1.5s apart,
   resumable, 24 requests.
3. The `locations` field was parsed in the page and dictionary-encoded (112 places, 116
   details, 1,087 lines). It was hashed in the browser (sha256 `7a46500d…`), read back
   through the page-text channel with the privacy guard in place, written to disk, and
   re-hashed to the same value before the shard was generated from it.
4. All 112 places, all 66 adventure packs, and the crafting-system titles were checked
   with `prop=info&redirects=1`. Every place and pack exists; eight resolve through a
   redirect, which the wiki follows on its own.

## Crafting-system pages: the obvious titles are wrong

`Viktranium Experiment`, `Nearly Completed` and `Slaver's crafting` do not exist. The real
titles, found with the wiki's own search, are `Viktranium Experiment crafting`,
`Slave Lords Crafting` and `Legendary Green Steel items` (the last reached from
`Legendary Green Steel` through a redirect). A family with no confirmed page links to
nothing, and its step stays plain text.

## Guards

`wiki_links.check()` fails the build when:

- a named augment in the catalog has no harvest entry (a new augment arrived and was never
  looked up), or an entry matches no augment (an upstream rename orphaned it). Both were
  proven red on 2026-09-27 by deleting one entry and adding a stale one;
- an adventure pack in `quest_adventure_packs.json` has no verified page (proven red by
  removing `Ruins of Gianthold`);
- it would inspect zero records, or the harvest is empty.

## Re-harvesting

When the guard names augments, re-run steps 1–3 for those names only and merge them into
`named`. Keep `page: null` for any that still have no page.
