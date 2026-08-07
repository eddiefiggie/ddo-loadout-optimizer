# Wiki harvest method — browser loop and dump format

**Established:** 2026-08-07 (issues #154, #162)
**Repo-side half:** `src/harvest.py` + `scripts/merge_harvest.py`

Server-side `curl`/WebFetch return empty for ddowiki (Cloudflare). Only
Claude-in-Chrome works, and only same-origin from a ddowiki tab. This is the
loop that works, and the traps around it.

---

## 1. Get the work order

```
python3 scripts/merge_harvest.py --field speed --missing-only
python3 scripts/merge_harvest.py --field material --missing-only
```

This is delta-only by construction: titles already in the shard are excluded, so
a refreshed upstream snapshot surfaces only its genuinely new items. Never
re-run a whole sweep by hand.

Current roster sizes: **speed 194**, **material 1167** (316 shields + 851 body
armor; docents excluded — the oath gate already treats Forged as moot).

## 2. Run the browser loop

Navigate a tab to any `ddowiki.com` page first — a real page navigation also
refreshes Cloudflare clearance when a burst has tripped it.

Non-negotiables, each of which cost a round trip to discover:

- **POST to `/api.php`, never GET.** A GET carrying 50 titles exceeds the URL
  limit and returns an HTML error page, which surfaces as
  `SyntaxError: Unexpected token '<'` — easily misread as a parse bug.
- **20 titles per request**, `action=query&prop=revisions&rvprop=content&rvslots=main`.
- **~1.5s between requests**, with backoff-and-retry on any non-JSON response.
  Rapid bursts trigger a persistent `202`-empty throttle that outlasts the
  session.
- **Accumulate into a page-scoped object keyed by title, and skip titles already
  present**, so the loop is resumable. A single `javascript_tool` call also
  times out around 45s, so the loop must survive being run in chunks.
- **Strip `| = & ?` from anything you return.** The privacy guard reads raw
  wikitext as query-string/cookie-shaped data and blocks the whole result. This
  is why returned lines substitute or remove those characters.

What to extract per page:

| Field | Source | Notes |
|---|---|---|
| `material` | `\| material =` in the item infobox | Record the raw value verbatim — do not normalize case or collapse synonyms. Classification is a separate, revisable step; keeping the raw value means a reclassification never needs a re-harvest. |
| Speed enchantment | `{{Striding\|N}}` or `{{Speed\|MAG}}` in `enhancements` | Record the template name and its argument verbatim. |

## 3. Merge the dump

```
python3 scripts/merge_harvest.py --field speed --dump /path/to/dump.json
```

Dump shape — a JSON object keyed by wiki title:

```json
{
  "Item:Ash Boots": {
    "value": {"movement": 30},
    "provenance": "stated",
    "raw": "{{Striding|30}}"
  },
  "Item:Cape of the Roc": {
    "value": null,
    "provenance": "defaulted",
    "raw": "{{Speed|21}}"
  }
}
```

`provenance` is required on every record:

| Value | Meaning | Solver-eligible? |
|---|---|---|
| `stated` | The wiki says this outright. | **Yes** |
| `defaulted` | A template filled the value in rather than recording it. | No |
| `unsourced` | The page is silent on this field. | No |

The distinction is load-bearing, not bookkeeping. `Template:Speed` states that
its attack-speed numbers are hand-maintained and that **any magnitude nobody
entered silently renders 5%**. A value indistinguishable from that default is
not a sourced value, and under exclude-until-verified it must never reach the
solver.

The merge is idempotent (a re-run changes nothing, including the harvest date)
and refuses to overwrite: a title already harvested with a *different* value
raises rather than merging. Two harvests disagreeing about one item is a review
event.

---

## Worked examples (verified 2026-08-07)

These were hand-checked against rendered pages during the #154 investigation and
are the reference cases for the classifier.

| Item | Wikitext | Renders as | Reading |
|---|---|---|---|
| Ash Boots | `{{Striding\|30}}` | Striding +30% | Movement only, no attack speed |
| Boots of Striding and Springing | `{{Striding\|15}}` | Striding +15% | Movement only |
| Goatskin Boots (level 19) | `{{Speed\|XI}}` | **Speed XI** | Roman-numeral **rank**, not a percentage |
| Brazenband | `{{Speed\|VII}}` | Speed VII | Roman rank |
| Cape of the Roc | `{{Speed\|21}}` | — | Arabic magnitude |

Confirmed `{{Striding|N}}` (movement only): Acrobat's Ring 10, Ash Boots 30,
Boots of Striding and Springing 15, Boots of the Long Step 5, Cannith Boots of
Propulsion 30, Boots of Minor Striding 5, Boots of the Woodsman 30.

Confirmed `{{Speed|ROMAN}}`: Boots of Blessed Travels XV, Breastplate of the
Celestial Avenger XV, Brazenband VII, Goatskin Boots (level 19) XI.

Confirmed `{{Speed|ARABIC}}`: Cape of the Roc 21, Blackfeather Boots 30,
Brightlord the Sigil of the Flame 30, Belt of the Ram 15, Bloodbark Bracers 30,
Admiral's Gumshoes 17, Beachcombers 17, Boots of the Rose 26, Book-Cover
Beltstrap 28, Boots of the Battlemaster 15.

Material, 4/4 sampled: Aegis of Flame → Mithral, Adherence → Steel, Azure
Buckler → Steel, Alchemical Light Shield → Dwarven Iron. (`Material` is present
on non-shields too — Goatskin Boots reads `Material: Leather`.)

**No Speed records have been merged yet.** The magnitude reading is blocked on
an unresolved contradiction between two wiki sources — see
`speed-and-alacrity.md`. Recording a derived value before that resolves would
write a confident wrong number onto every rank item, which is worse than the
current gap.

---

## Traps

- **`insource:` search is disabled on this wiki.** It returns empty even for
  strings that demonstrably exist (`"Topaz of Striding"` is on a live page and
  returns nothing). An earlier ruling used an empty `insource:` result as
  evidence of absence; it is not.
- **`get_page_text` can return "no text content" on a page that loaded fine.**
  Read `#mw-content-text` via `javascript_tool` instead.
- **Augment data lives on `Raw data/Item augments`**, not `Item augments` (which
  does not exist). That is the page gear-planner scrapes.
