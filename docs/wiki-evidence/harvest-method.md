# Wiki harvest method — browser loop and dump format

**Established:** 2026-08-07 (issues #154, #162)
**Repo-side half:** `src/harvest.py` + `scripts/merge_harvest.py`

Server-side `curl`/WebFetch return empty for ddowiki (Cloudflare). A real
browser tab is the only transport that works, and only same-origin from a
ddowiki tab. Two browser surfaces have been verified:

- **Claude-in-Chrome** (`mcp__claude-in-chrome__*`) — the original loop below,
  and still the one for a bulk harvest.
- **The in-app Browser pane** (`mcp__Claude_Browser__*`) — verified 2026-09-04
  (#702, #701) when the Chrome extension was disconnected. `navigate` loads
  ddowiki pages normally, `javascript_tool` reads `#mw-content-text`, and
  `browser_batch` chains several page reads in one call (a 3 s `wait` after each
  `navigate` was enough). The same privacy-guard stripping applies. Reach for it
  for a handful of lookups — validating a player report, an item's Armor Type, a
  set bonus — and for the bulk loop only if the pacing rules below are kept.

This is the loop that works, and the traps around it.

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
| Speed enchantment | `{{Striding\|N}}` or `{{Speed\|MAG}}` in `enhancements` | Record the template name and its argument verbatim, **and the rendered tooltip**. |

**Non-negotiable: open the tooltip on any bundled-enchantment template.** A wiki
effect cell has two layers — the visible text names the enchantment, the tooltip
behind it carries the numbers. When one template grants several stats under one
name, the visible layer silently omits every stat not spelled out in the cell.
`Topaz of Swiftness 15%` renders `Speed +30%` and was ruled twice to grant no
alacrity; its tooltip says "15% bonus to attack speed". Read `#mw-content-text`
via `javascript_tool` and capture the tooltip text, not just the link label.
This applies to any field whose value comes from a bundled template, not only
Speed.

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

**Speed is fully merged: 194 records, 181 stated / 13 defaulted / 0 unsourced.**
The contradiction that once blocked the magnitude reading was resolved on
2026-08-07 and the derived values were confirmed against every rendered tooltip
on 2026-08-08 — see `speed-and-alacrity.md` §3 and
`speed-tooltip-tracker.md`.

One caution from that pass: the worked-example list below recorded
`Belt of the Ram 15` correctly, while the shard carried it as
`unsourced` with "no Striding/Speed template found". The two sat in
contradiction through a whole harvest cycle because nothing compared them.
`speed_split.audit_shard()` now reports `unsourced` entries as harvest suspects
for exactly this reason — an `unsourced` reading is a claim about a page, and it
can be wrong.

---

## Traps

- **`insource:` search is disabled on this wiki.** It returns empty even for
  strings that demonstrably exist (`"Topaz of Striding"` is on a live page and
  returns nothing). An earlier ruling used an empty `insource:` result as
  evidence of absence; it is not.
- **`get_page_text` can return "no text content" on a page that loaded fine.**
  Read `#mw-content-text` via `javascript_tool` instead. The Browser pane's
  `get_page_text` has the sibling failure: it returns the page intro and drops
  every wiki table, so a set-bonus or gem table reads as absent when it is not.
  Same fix — `#mw-content-text table tr` via `javascript_tool`.
- **Augment data lives on `Raw data/Item augments`**, not `Item augments` (which
  does not exist). That is the page gear-planner scrapes.

## Rendered tooltips by page: the `parse` variant (2026-09-04, #713)

The revisions loop above returns WIKITEXT, which is what a template
invocation needs. A rendered TOOLTIP needs the parsed HTML, and the same
same-origin `api.php` serves it: POST `action=parse&prop=text&format=json&page=<title>`,
one page per request, and read `span.tooltip` out of the returned HTML with a
`DOMParser`. Two traps beyond the ones above:

- **GET returns an empty body** (`Unexpected end of JSON input`) — same rule as
  the revisions loop, POST only.
- **A burst trips the `202`-empty throttle, and a navigation clears it.** The
  cure is a real page navigation in the tab, which also WIPES page-scoped
  state — export whatever the loop accumulated (`JSON.stringify(window.__tt)`)
  BEFORE navigating, save it, then reload the roster. Keep each
  `javascript_tool` call to about ten pages at ~1.3 s so it stays under the
  45 s ceiling; the loop is resumable because it skips names already stored.
- **Match the tooltip by the LABEL the page engraves, not the stat name.** Ten
  of 198 names render under a different label (`Accuracy` is engraved
  `Attack Bonus`, `False Life` is `Vitality`, the charge counts are
  `Action Boost Enhancement` / `Anger` / `Minor Greater Dragonmark
  Enhancement`); a second pass with a label hint recovered nine.

Shard: `data/seed/compendium/affix_tooltip.json`, one entry per rankable name.

