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
  **The same-origin `/api.php` POST loop works through the pane too**, verified
  2026-09-18 (#769): all three `scripts/browser/` snippets ran in one session —
  batched `action=query&prop=revisions` over 20 titles, and per-page
  `action=parse` — returning real wikitext at the documented pacing. So a snippet
  written for the DevTools console runs here unchanged; only its RETURN value
  differs, and that constraint is unchanged (return `summaryText`, never the raw
  dump). The one thing the pane cannot do is hand the verbatim dump back:
  `copy()` is DevTools-only, `navigator.clipboard` needs a user gesture, and the
  privacy guard strips `| = & ?` — which corrupts wikitext beyond use. A harvest
  whose dump must land in the repo verbatim therefore still ends at a DevTools
  paste; a read that only has to be *ruled on* does not.

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


## Match a tooltip's label EXACTLY, never by substring (#858)

The #713 tooltip loop took the first `span.tooltip` on a carrier page whose text **contained** the affix name. A name that prefixes a longer enchantment then captures the wrong sentence: `Repair` matched *Repair Amplification*, and `Armor Class` matched an armor's *+1 Enhancement Bonus*. `Sneak Attack` / `Sneak Attack Dice` is the same trap, waiting.

Match the tooltip's label (the text before its first `:`) after stripping only spelling: a leading or trailing magnitude (`+5 …`, `… +13`), a roman tier (`… IV`), and a bonus-type prefix (`Exceptional …`). In JS:

```js
const labelOf = (t) => t.split(":")[0].trim();
const key = (l) => l.replace(/^[+-]?\d+%?\s+/, "").replace(/\s+[+-]?\d+%?$/, "")
  .replace(/\s+(?=[IVX]+$)X{0,3}(?:IX|IV|V?I{0,3})$/, "").toLowerCase();
const hit = tips.find((t) => key(labelOf(t)) === name.toLowerCase());
```

When the wiki genuinely engraves a stat under another name (`Turn Undead` as *Hallowed*, Implement Universal Spell Power as *Spellcasting Implement*), record it with a `note` saying so. `src/affix_tooltip.label_problems` fails the build on any `stated` entry whose label does not reduce to its key and carries no note.


## When upstream is stale: the wiki-delta loop (#899)

gear-planner is the catalog's baseline, and when its daily updater stops (it failed 2026-10-14..17, illusionistpm/ddo-gear-planner#223) every item the wiki gains is blocked until someone notices. This loop is how we notice and how we carry the gap ourselves, without forking or re-parsing upstream.

1. **The alarm.** `.github/workflows/upstream-freshness.yml` runs `scripts/check_upstream_freshness.py` daily. It keeps ONE issue labelled `upstream-stale` open while upstream's `Data Auto Updater` has failed two runs in a row (`broken`) or our pin trails a healthy upstream by more than a week (`behind`), and closes it on recovery. `behind` means re-vendor per `raw/SOURCE.json`. `broken` means run this loop. A re-vendor that was evaluated and declined is recorded as `_held_upstream` in `raw/SOURCE.json` (commit, date, issue). While upstream is still at that commit, or fewer than `RETEST_AFTER_DAYS` (5) days have passed since the hold, the verdict is `held`: it closes the open alarm once and then stays silent. After that, a newer upstream commit reads `behind` and asks for a **re-test** with the held method, not a re-vendor. Update the record on every held re-test, and delete it when a re-vendor lands (#932).
2. **The delta.** Open any ddowiki page in the Browser pane, set `window.__deltaSince` to SOURCE.json's `upstream_commit_date`, and run `scripts/browser/harvest_wiki_delta.js`. It reads RecentChanges for the `Item:` namespace and, for each page, the infobox, the enchantment lines and the rendered tooltips. Through the Browser pane, return `window.__delta.summaryText` (`|` encoded as `~`); from a real DevTools console, `copy(JSON.stringify(window.__delta))`. Trust the dump only when `window.__delta.done` is `true`. A throttled RecentChanges read, or one that lists no pages, stops the run with `done: false`, and `window.__delta.state` says why.
3. **Triage.** `python3 scripts/triage_wiki_delta.py DUMP.json --drafts drafts.json` sorts every page into one bucket: already upstream, cosmetic, unreadable, sibling-buildable (`X (level N)` with a tier upstream parses), or manual. Sibling-buildable pages get a DRAFT supplement entry: the nearest lower sibling's affixes, the page's own weapon enhancement where its template states it, and the tooltips as evidence.
4. **Review, then supplement.** Check every magnitude in a draft against its `evidence` (the sibling's numbers are a starting point, not a value), delete the draft's `review` note, and copy it into `data/seed/compendium/wiki_supplement_items.json`. A manual page with no sibling names an explicit `base` (`slot`, `type`, `quests`, `pack`) instead.

`src/wiki_supplement.py` refuses an entry that still carries a `review` note, names both or neither of `sibling` and `base`, uses a slot/type pair or an affix `(name, type)` upstream has never used, or lacks evidence and a harvest date. It fails the build outright the moment upstream carries the same name, so a supplement entry retires itself on the first re-vendor that catches up.


## Full item harvest (#905, own item harvest #911)

For harvesting every item page, not a work order of a few hundred. First run: 2026-10-18, 8,072 pages, 0 missing.

- **In.** The Browser pane cannot reach localhost, but it can read `raw.githubusercontent.com`. `scripts/browser/harvest_items.js` fetches the seed (our pinned raw items) from this repo at a commit SHA and derives the page titles. The snippet itself can be loaded the same way: `(0, eval)(await (await fetch(<raw url at SHA>)).text())`.
- **Out.** The harness saves a tool result larger than its inline cap to a file. `harvestChunk(n)` returns 400 pages as gzip + base64url, which is free of the `| = & ?` the privacy guard strips. It is padded past the inline cap so it always lands in a file. `python3 scripts/load_harvest.py ingest <file>` verifies the seed digest and the body digest, then stores the chunk under `data/harvest/<id>/` (gitignored). `status` reports coverage and `resume_at`.
- **Throttle.** A throttled wiki answers HTTP **202 with an empty body**. The snippet refreshes clearance by loading a page in a hidden same-origin iframe, the same page load that navigating does, then backs off. Navigating the tab itself would discard the in-memory harvest.
- **Resume.** After a reload, set `window.__harvestConfig = { startAt: <resume_at>, id: <id> }` and load the snippet again. Each start owns a generation, so a stale loop retires itself.

The first run took about 25 minutes, including one long throttle at index 2,320.


## Explicit-title harvest: set pages (#908)

Phase 3 reads `Named item sets` (pageid 9371) and possibly per-set pages, which are not in the item seed. `harvest_items.js` takes an explicit title list instead:

- **Titles.** A JSON array under `data/harvest_titles/` (`named-item-sets.json` is the first). The snippet fetches it from `raw.githubusercontent.com` at a pinned commit, exactly as it fetches the seed, and the loader reads the same file locally. Both sides de-duplicate and sort by code point, so the digest check holds unchanged. An empty list is refused on both sides.
- **Rendered HTML.** `parse: true` adds one paced `action=parse` request per page and stores `html` and `html_revid` next to the wikitext. Compare the two revids: an edit landing between the two reads shows up there. This is the tooltip layer that bundled templates hide (#912).
- **Run** (any ddowiki page, Browser pane):

  ```js
  window.__harvestConfig = { titles: "https://raw.githubusercontent.com/eddiefiggie/ddo-loadout-optimizer/<SHA>/data/harvest_titles/named-item-sets.json", parse: true, chunkPages: 1 };
  // paste scripts/browser/harvest_items.js, then:
  harvestStart(); harvestStatus(); harvestChunk(0)
  ```

  The id defaults to `pages-YYYYMMDD`. `chunkPages: 1` keeps a large rendered page in a chunk of its own.
- **Load:** `python3 scripts/load_harvest.py --titles data/harvest_titles/named-item-sets.json ingest <saved file>`. If you omit `--titles`, the chunk is refused on its seed digest, because it indexes a different list.
