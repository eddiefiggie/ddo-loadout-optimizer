---
title: Bundled Template Affix Audit - Plan
type: chore
date: 2026-08-08
topic: bundled-template-affix-audit
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Bundled Template Affix Audit - Plan

## Goal Capsule

- **Objective:** Answer one question — is `Speed` the only affix where a multi-stat wiki template was flattened into a single stat, or the first one found? Report the size of the class; fix nothing.
- **Product authority:** The DDO Wiki's Template namespace, read via the MediaWiki API.
- **Open blockers:** None.

---

## Product Contract

### Summary

A bounded investigation that intersects the affix names we store against ddowiki's template list, renders every match, and reports how many are genuine defects. No data corrections, no snapshots, no guards — the output is a count and a candidate list that informs whether a fix project is warranted.

### Problem Frame

#168 found that `Topaz of Swiftness 15%` shipped with no alacrity because the wiki renders `Speed +30%` in the visible cell while the numbers live in the tooltip behind it. The fix was specific to Speed. The class was not investigated, and it is explicitly deferred in that plan's Scope Boundaries.

The repo carries exactly two instances of one-name-many-stats today: `src/umbrella.py` expands "all ability scores" / "well rounded" into six abilities, and `src/speed_split.py` splits `Speed` into movement plus two alacrities. **Both were found by a player report. Neither was found by a search.** Nobody can currently say whether that is because two is the true count or because nobody has looked.

The obvious audit shape does not work. Detecting a flattened template from local data would require knowing which template produced each affix, and the upstream catalog carries no provenance — affixes arrive as name, type, and value with no wikitext. Only 194 Speed entries and 1,167 material entries have harvested `raw` wikitext, and both were deliberate per-field harvests. Recovering it for the rest means wiki reads for 9,045 items against a source that throttles persistently after roughly eight rapid calls.

### Key Decisions

- **Template-first, not item-first.** (session-settled: user-approved — chosen over harvesting item wikitext: that path needs thousands of reads against a throttled source and is not affordable.) Invert the search. The wiki's template list is one API call, the intersection against our affix names is free and local, and rendering the matches is roughly one more call because #168 established that `action=parse` renders arbitrary wikitext in a single POST.

- **Spike now, decide fixes after.** (session-settled: user-directed — chosen over committing up front to fix everything found: the size of the class is unknown, so a fix commitment is open-ended until the count exists.) One defect and twenty defects are different projects.

- **Intersect the full registry, not just the rankable subset.** 207 affix names are player-selectable; 1,441 exist in the registry. The wider set costs nothing extra because the expense is the template list, not the comparison — and a flattened stat corrupts a loadout whether or not a player can rank that particular name.

### Requirements

**Discovery**

- R1. Enumerate the DDO Wiki's Template-namespace pages through the MediaWiki API.
- R2. Intersect that list against every affix name the project stores, case-insensitively.
- R3. Render each intersecting template and record how many distinct stats it emits.

**Reporting**

- R4. Report three counts separately rather than collapsed: templates matched, templates emitting two or more stats, and — of those — how many the project models as a single stat. Only the third is a defect count.
- R5. For each genuine defect, record the template, what it emits, what the project stores today, and whether the affix is player-rankable.
- R6. State the method's blind spot alongside the result: the intersection only catches templates whose name matches an affix name we store, so a zero result is a lower bound rather than an all-clear.
- R7. Report the wiki calls spent, so the next investigation can budget against a throttled source.

### Scope Boundaries

- No data corrections. A defect found here is reported, not fixed — the fix project is a separate decision.
- No snapshots or guards. #168's verification chain covers Speed; extending it is part of a fix, not the audit.
- No item-page harvesting. That is the approach this audit exists to avoid.
- Templates whose name diverges from the affix name we store. Out of reach by construction; recorded as a known gap rather than chased.

### Dependencies and Assumptions

- ddowiki has no server-side transport — `curl` and WebFetch return empty behind Cloudflare. Every call runs same-origin from a ddowiki tab, paced, with `| = & ?` stripped from anything returned. See `docs/wiki-evidence/harvest-method.md`.
- `action=parse` batches arbitrary wikitext into one render. Verified during #168 for 30 invocations in a single POST; assumed to hold at a larger batch, and worth confirming on the first call before sizing the rest around it.
- The Template namespace is enumerable via the API and is not so large that intersection becomes the expensive step. Unverified — if the list runs to many thousands, paginate and note the added cost against R7.

### Outstanding Questions

**Deferred to implementation**

- Whether a template emitting multiple stats but modelled as one is always a defect. Some may be deliberate — a component the project chose not to model. The audit records the discrepancy; judging intent is per-case.

### Sources and Research

- `src/speed_split.py`, `src/umbrella.py` — the two known instances of the pattern.
- `docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md` — the lesson from #168 that motivates the audit.
- `data/seed/compendium/vocab_registries.json` — 1,441 affix names; 207 are surfaced as rankable in the built dataset.
- `data/seed/compendium/raw/gearplanner_items.json` — upstream item records carry `name`, `type`, `value` per affix and no template provenance, which is why item-first is not viable.
- `docs/wiki-evidence/harvest-method.md` — the browser loop, pacing, and privacy-guard constraints every wiki call inherits.
