# Tooltip snapshots — refresh tracker

**Established:** 2026-08-08 (#134), extended to Parrying and Heightened
Awareness 2026-08-08 (PR #169).

| Field | Snapshot store | Guard |
|---|---|---|
| `speed` | `speed_enchantment.json` -> `snapshots` | `speed_split.check_against_snapshots()` |
| `speed_augment` | `speed_augment.json` -> `snapshots` | `speed_split.check_against_snapshots()` |
| `parrying_version` | `parrying_version.json` -> `snapshots` | `parrying_split.check_against_snapshots()` |
| `heightened_awareness` | `heightened_awareness.json` -> `snapshots` | `heightened_awareness.check_against_snapshots()` |

All guards run on every build. All are offline — they read the stored snapshot,
never the wiki. Each affix keeps its OWN guard rather than sharing one: the
tooltip dialects, provenance rules, and lookups differ, and a generalization
covering all of them would have to drop assertions one of them needs (KTD1).

This is the registration point for the tooltip refresher. It is a step in the
wiki-validation loop, not a scheduled job — standing automation against a
throttled third-party wiki needs an owner when it goes red.

---

## Why this exists

Our derived alacrity values come from a hand-transcribed copy of
`Template:Speed`'s Arabic switch. The wiki maintains that switch by hand too, so
it can gain a row at any time — and a magnitude that renders 5% today because
nobody recorded one may render a real number tomorrow. The chain we assert is:

```
wiki tooltip  --(link 1: this refresher, manual)-->  stored snapshot
stored snapshot  --(link 2: the offline guard, every build)-->  derived value
```

Link 2 runs for free on every push. Link 1 is the one that needs a human, and
this file is where that gets remembered.

## When to run it

Whenever the wiki-validation loop is worked. There is no clock — the trigger is
sitting down to validate wiki-sourced data at all.

## How to run it

Get the work list. Roman ranks derive from a documented stable formula
(`movement = min(5 x rank, 30)`, `attack speed = rank%`) and are skipped; only
the hand-maintained Arabic rows can move:

```
python3 scripts/merge_harvest.py --field speed --tooltip-worklist
```

**The scope differs per field, and the difference is load-bearing.** Speed skips
its Roman rows because they derive from a formula. Parrying does NOT: its
I -> 1, IV -> 2, VIII -> 4 is a three-entry lookup that no formula fits (I breaks
every ratio), so every invocation including the Roman ones is refreshed. A field
with no invocations exits **non-zero** rather than printing an empty list, which
would read identically to "nothing to do".

```
python3 scripts/merge_harvest.py --field parrying_version --tooltip-worklist
python3 scripts/merge_harvest.py --field heightened_awareness --tooltip-worklist
```

Render them. ddowiki has no server-side transport — `curl` and WebFetch return
empty behind Cloudflare — so this runs same-origin from a ddowiki tab, per
`harvest-method.md`. One `action=parse` POST renders every invocation at once:
send them as wikitext separated by unique markers, strip `<style>`/`<link>`
elements from the parsed HTML before reading text, and **strip `| = & ?` from
anything returned** or the privacy guard blocks the whole result.

Write the render to a JSON object of `{invocation: tooltip}` and compare:

```
python3 scripts/merge_harvest.py --field speed --compare-tooltips /path/to/dump.json
```

It never writes. Exit 0 means no drift; exit 1 means at least one tooltip moved.

## What to do when it reports drift

Drift is a **review event**, not an automatic update — the same rule
`merge_harvest` already applies when two harvests disagree about one item.

The valuable case is a currently-`defaulted` invocation gaining a real recorded
magnitude. That is a promotion from `defaulted` to `stated`, and it must be done
deliberately: re-harvest the affected invocation, update the derived values,
re-ratify, and record it. Nothing promotes itself, because a silent promotion
would write a confident number onto every item using that invocation.

## Snapshot state

30 distinct invocations cover all 194 harvested entries. All 30 were rendered and
stored on 2026-08-08, and every recorded switch row that live data exercises was
confirmed against its tooltip — the transcription needed no correction. The one
exception is `{{Speed|24}}`, which no harvested item uses, so it renders nowhere
and stays unverified.

| Group | Invocations | Refresh scope |
|---|---|---|
| Arabic `{{Speed\|N}}` | 14 | **Yes** — hand-maintained on the wiki |
| Roman `{{Speed\|RANK}}` | 11 | No — stable formula |
| `{{Striding\|N}}` | 6 | No — movement only, no alacrity component |

Note: 30 keys rather than 31 raw strings, because `{{Speed|V}}` and
`{{speed|V}}` case-normalize onto one snapshot.

| Last refreshed | By | Result |
|---|---|---|
| 2026-08-08 | initial harvest (#134) | 30/30 stored; no drift to compare against |

## Parrying and Heightened Awareness snapshot state (#169)

Full evidence, per-item citations, and the reasoning behind the Arabic "Saves"
shorthand live in `parrying-versions.md`. Summary:

| Field | Invocations | Entries | Provenance | Refresh scope |
|---|---|---|---|---|
| `parrying_version` | 9 (Arabic 1-6, Roman I/IV/VIII) | 139 | 139 `stated` | **All 9** — the Roman mapping is a lookup, not a formula |
| `heightened_awareness` | 6 (Arabic 1-6) | 26 | 26 `stated` | All 6 |

Both were rendered and stored on 2026-08-08, and every entry is compared against
its own tooltip on every build (`compared` is reported separately from `checked`,
so a shard that resolved no snapshot cannot report a healthy count). As of #170
every guard in the family reports both counts, Speed included.

**Every guard also binds each snapshot to the key it is filed under**, so a
snapshot harvested against the wrong invocation is reported rather than compared
against itself. The anchors differ per affix and all come from evidence already
recorded here:

| Field | Arabic anchor | Roman anchor |
|---|---|---|
| `speed` | argument is the movement %; attack speed from the recorded switch | `attack = rank%`, `movement = min(5 x rank, 30)` |
| `parrying_version` | the argument is the magnitude | `ROMAN_MAGNITUDE` lookup (I/IV/VIII) |
| `heightened_awareness` | the argument is the magnitude | none exists — a Roman rank is refused |

A new invocation must be checked against its anchor before being stored. Where no
anchor exists, the rank is refused rather than trusted.

**Watch for:** a `Parrying II` or any Roman numeral outside I/IV/VIII, and any
Heightened Awareness Roman variant. Both currently fail the build by design —
they must be harvested, never extrapolated. A new Arabic `Parrying 8` would also
be significant: its absence today is what makes every stored 8 a flattened
Roman VIII.
