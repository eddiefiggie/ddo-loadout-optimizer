# Wiki evidence — the Slave Lords set names, and which side was stale (#769)

**Harvest:** in-app Browser pane, same-origin read of ddowiki, 2026-09-18.
**Snippet:** `scripts/browser/read_slavers_set_names.js`.
**Source:** `Named item sets` (pageid 9371) — the page every other set definition
in this project came from.

## The statement

The index states each Slave Lords Crafting set as an anchored heading. Verbatim,
with the template pipes stripped by the privacy guard:

```
{{Anchor Slave Lord's Might}}'''Slave Lord's Might [ML:8/28]'''
{{Anchor Slave Lord's Sorcery}}'''Slave Lord's Sorcery [ML:8/28]'''
{{Anchor Slave's Endurance}}'''Slave's Endurance [ML:8/28]'''
```

**The Endurance set is `Slave's Endurance`, without `Lord's`.** Might and Sorcery
carry `Lord's`; Endurance does not. One heading covers both tiers — `[ML:8/28]`
is ML 8 heroic and ML 28 legendary — so the wiki does not name the Legendary
variants separately, and this ruling does not claim it does.

## The disagreement this settles

| | Might | Sorcery | Endurance |
|---|---|---|---|
| `raw/gearplanner_crafting.json` pool | `Slave Lord's` | `Slave Lord's` | `Slave Lord's` |
| `raw/gearplanner_sets.json` catalog | `Slave Lord's` | `Slave Lord's` | **`Slave's`** |
| **ddowiki `Named item sets`** | `Slave Lord's` | `Slave Lord's` | **`Slave's`** |

**The set catalog is correct; the crafting pool carries the stale spelling.**
`src/membership.py` was dropping the pool's unmatched name and disclosing it in
`metadata.slavers_coverage.set_names_unresolved`, so no Slaver's host could be
solved into the Endurance set at either tier — one of the three sets the station
offers was off the table.

## Why this page was read at all, and the trap it caught

The pattern argued for the **opposite** fix, and confidently. Might and Sorcery
are spelled identically on both sides and only Endurance differs, which makes the
set catalog look like the side breaking its own pattern — so the obvious
correction was to rename the *catalog* onto `Slave Lord's Endurance`. The wiki
says the catalog was right all along.

Plan `2026-09-14-006` flagged this before the read: *"which makes the answer look
obvious and is still an inference from a pattern, not a source."* One request
reversed it. This is the standing "never infer a value" rule earning its keep —
the inference was available, cheap, consistent with two thirds of the evidence,
and wrong.

`src/crafting_set_names.py` therefore **refuses an entry that cites no page**.
That guard is not paperwork; it is the only thing standing between this read and
the rename that looked obvious.

## Controls, and why "no mismatch" cannot be confused with "no read"

- Might and Sorcery are the controls: both appear in the index and both read as
  expected, so the read worked and the Endurance spelling is a finding rather
  than a gap.
- 9 `Slave` lines were extracted from the index. A zero-line read aborts loudly
  instead of returning a cheerful empty summary — the snippet's guard, proven by
  deleting it from a scratch copy and watching the neutered version report
  `index Slave lines 0` as though it were clean.
- None of the six candidate set titles (`Slave Lord's Endurance`, `Slave's
  Endurance`, and their `Legendary ` forms, plus the two controls) exists as a
  standalone page, and none redirects. Sets are defined only on the index, which
  is consistent with every other set definition in this project. So the index is
  the whole statement, not a summary of one.

## What shipped

A rename of the **pool's** spelling through
`data/seed/compendium/crafting_set_name_corrections.json`, applied by
`src/crafting_set_names.py` at `crafting_catalog.load_catalog` — the single load
point, for the reason #631 records there.

**Never an alias.** An alias would assert the two spellings are the same set
without saying which one the game uses, and the app would still have to pick one
to render. The wiki states a name; minting it at the source ends the
disagreement, and `membership` resolves it like any other name with no special
case.

**Never an edit to the vendored shard.** `raw/gearplanner_*.json` are pinned to
an upstream SHA and re-fetched verbatim on refresh; a hand-edit there would be
silently reverted.

## What admitting the set surfaced

`Spell Saves` — an Artifact-typed affix carried by the two `Slave's Endurance`
tiers and **nothing else in the corpus** (4 occurrences, all in those two tiers;
zero items, zero crafting options). It was unreachable for exactly as long as the
set was, so the moment the set resolved it became rankable and the umbrella
detector flagged it as an unadjudicated candidate and failed the build.

It needed no adjudication entry. It is the set channel's spelling of `Spell
Save`, which 93 item affixes engrave (Resistance 72, Insight 18, Quality 2,
Enhancement 1) and which already holds an atomic ruling harvested 2026-08-13.
`Resistance (enchantment)` states one enchantment and gives it in the singular:

> In addition to the universal Resistance bonuses to saves ... specialized item
> enchantments exist that affect only a subset of saving throws: ... Spell saves
> ('Realistic' prefix) - provide Resistance bonuses against spells from all
> schools of magic

`Spell Save` redirects to that page, so the wiki names the singular as the title
for the mechanic. No record carries both spellings, so this is one mechanic under
two spellings and not a merge of two (the same-item co-occurrence rule), and the
canonical is absent from the sets channel, so nothing collapses. Renamed through
`affix_name_corrections.json` with the paired `affix_aliases.json` entry, per the
documented pair.

Worth keeping: a latent scoring bug was sitting **behind** an unreachable set.
The set's headline defensive affix would have scored zero for every player who
ranked it by the name items engrave, and nothing would have looked wrong. The
umbrella detector found it within one build of the set becoming reachable, which
is the case for guards that fail on a population rather than on a date.
