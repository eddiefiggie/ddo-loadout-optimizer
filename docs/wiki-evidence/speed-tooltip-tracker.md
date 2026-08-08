# Speed tooltip snapshots — refresh tracker

**Established:** 2026-08-08 (issue #134)
**Snapshot store:** `data/seed/compendium/speed_enchantment.json` -> `snapshots`
**Guard:** `speed_split.check_against_snapshots()`, run on every build

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
