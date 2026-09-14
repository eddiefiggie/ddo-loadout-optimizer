---
title: Wiki Window Work Order - Plan
type: chore
date: 2026-09-14
execution: mixed
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
---

# Wiki Window Work Order - Plan

**Issues:** #746 (the Ghost Touch ruling), #591 half B (the 64 Cannith weapons).
**Base:** `main` at `09142026.6`.

---

## Goal Capsule

Make the next ddowiki session copy, run, paste back. Two of the three open
issues are blocked on the same thing — a same-origin browser tab, which no
build container has — so the setup cost is paid once and both come back.

Nothing here rules on anything. The scripts fetch and record verbatim; the
ruling (#746) and the parser (#591) are repo-side work with tests, done after
the window, from what it brought back.

---

## Why one window, and in this order

**#746 first.** It is the one a player reported, and it needs four page reads.
The 2026-09-11 sweep found 58 item families that rename a counted presence
effect across a tier boundary; the project already fixes that class by minting a
shared stat (`Blurry`/`Lesser Displacement` -> `Concealment`). That mint asserts
the names are one effect — a claim about the game, so it waits on the wiki's own
words. `scripts/browser/read_ghost_touch_family_pages.js` fetches both layers of
`Ghost Touch`, `Ghostly`, `Ethereal` and `Ghostbane`: the wikitext and the
rendered text with tooltips, because a bundled template hides its numbers in
the tooltip (`bundled-template-values-live-in-the-tooltip-not-the-cell.md`).

**#591 half B second.** Half A shipped in #762: the resolver emits `slots`, the
overlay appends them to `crafting[]` and re-runs the planner lift, the coverage
stamp and the end-to-end test are in place. What is missing is the weapons'
text. `scripts/browser/harvest_cannith_weapon_families.js` fetches the family
pages and extracts every `{{Turnin…}}` row with the variant its Level field
links to, the tier label, the Enhancements text verbatim, and a substring flag
for a Purple augment slot.

## What the harvest script guards, because the thread said it must

The 2026-09-06 mapping on #591 recorded that the Level field is written two
ways — `[[Item:X (level 8)|Level 8 (Tier 1)]]` on Mournlode/Calomel (A) and
`{{Item|X (Level 4)|Level 4}}` on the Elemental families (B) — and that a regex
for one form **silently returned a plausible row count with four whole families
absent**. So:

- both link forms are matched, and each row records which one it matched;
- rows are extracted brace-aware, because `{{Enhancement bonus|w|2}}` inside
  the Enhancements field carries its own `}}` and a lazy regex stops there;
- the per-family row count is printed against the expected **13** (four levels
  by three tiers, plus Epic), and a family that is not 13 is flagged, not
  averaged into a total;
- a page under dialect C (a raw `wikitable`, no template) has its tables captured
  verbatim and its row count reads 0, which is the flag;
- every candidate page name for the uncertain families (the repeaters, the
  bows) is requested, and a miss is **recorded**, not guessed around.

Verified offline against fixture rows quoted from the thread, with the API
mocked: A and B both extract, the inner template survives whole, the wikitable
is captured, misses are recorded, and the extension-path summary carries none
of `| = & ?`.

## A correction carried by this plan

The issue thread said "33 families". The built dataset has **18** (by
`source_item` with the level suffix and `Epic ` stripped); 33 is the count of
the WORN items and was mis-carried. The seed `_meta` said 33 for a few hours
today and now says 18. The script lists 20 candidate titles for those 18 because
the repeater and bow page names are unknown.

## What comes back, and where it goes

| From | Paste into | Then |
|---|---|---|
| `window.__gt` dump (#746) | the #746 thread, or a new `docs/wiki-evidence/ghost-touch-family.md` | rule from the text; mint or close |
| `window.__cw` dump (#591) | `data/seed/compendium/raw/cannith_weapon_families.json` | write the row -> shard-entry conversion with tests; the overlay already accepts `slots` |

Both dumps are **verbatim**. The conversion from a Turnin row to a shard entry
(`raw` in the shard's ` / ` form, `slots` derived, tier choice = the Tier 3 row
of each level) is repo-side code proven against the pre-change tree, not a
decision made in the browser.

## Two ways to run, one rule between them

- **In DevTools, by hand** — preferred. Nothing passes through a privacy guard;
  `copy()` puts the verbatim dump on the clipboard.
- **Through Claude-in-Chrome or the Browser pane** — return `summaryText` only.
  It is stripped of `| = & ?`; the raw dump is not and blocks the whole result.

Either way: navigate to a ddowiki page first, keep the pacing, and if it says
"throttled", navigate again and re-paste; both scripts resume.

---

## Scope Boundaries

- **No parser for the weapons ships here.** It is written against the real dump.
- **No ruling on Ghost Touch ships here.** The pages are read; the ruling is a
  separate change with its own evidence doc.
- **`Enhancement bonus` / `Elemental Resistance` on the weapons** stay out of
  #591 per its re-scope; the dump carries their text verbatim, so a follow-up can
  admit them without a re-harvest. File it separately if it is wanted.
- **#196 (Filigrees)** is not touched.
