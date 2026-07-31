---
title: "Exclude-until-verified: ship a data-gated feature inert behind an empty curated seed"
module: data-pipeline
date: 2026-07-30
problem_type: convention
component: tooling
severity: medium
related_components:
  - solver
  - web-ui
applies_when:
  - "A feature's behavior depends on curated data (an allowlist, gate, or flag) that is slow, risky, or manual to source"
  - "The data must be trusted — a wrong entry silently corrupts results — so it can only be added after verification against an authoritative source"
  - "You want to ship and test the code mechanism now without blocking on the data-sourcing work"
tags:
  - ddo
  - exclude-until-verified
  - data-discipline
  - curated-seed
  - fail-safe-default
  - inert-feature
  - additive-gate
  - wiki-sourcing
---

# Exclude-until-verified: ship a data-gated feature inert behind an empty curated seed

## Context

Several optimizer features are gated on data that is expensive and risky to source: which items carry an alignment equip-restriction, which items are the **Artifact** quality, and (upstream) which affixes parse to a trustworthy `(stat, bonus_type, value)`. The authority is the DDO wiki, which cannot be bulk-fetched (plain `fetch` returns empty; sourcing means a rate-limited Chrome-MCP pass with human-in-the-loop review), and a **wrong** entry is worse than a missing one — an inferred alignment gate would wrongly exclude gear, an inferred Artifact flag would wrongly force or drop an item. The recurring question: how do you ship and test the *code* that consumes this data without waiting for the slow, careful data-sourcing to finish — and without shipping a single unverified value?

The answer this project uses repeatedly is **exclude-until-verified**: the data source is a curated seed that ships **empty**, the pipeline stamps a field only for seeded entries, and every consumer treats an unstamped item as the safe default. The feature's mechanism ships and its tests pass while the feature does nothing, then comes alive as the seed is populated on an independent track. The Artifact opt-in (PR [#51](https://github.com/eddiefiggie/ddo-loadout-optimizer/pull/51)) is the latest instance; the alignment gate (guided-wizard) is the prior one; both ship empty today.

## Guidance

**1. The curated seed is an allowlist that fails safe when empty.** A loader reads the seed into a membership set/map and returns an *empty* structure when the file is missing or empty — never an error, never a default-populated fallback (`build_dataset.py` `load_artifacts` returns `set()`; `load_alignment_restrictions` returns `{}`). Empty seed → nothing to stamp → the pipeline is a no-op.

**2. Stamp a field only for seeded entries; leave everyone else unmarked.** The build adds the gating field (`v["artifact"] = True`, `v["alignment_req"] = [...]`) *only* to variants whose base item is in the seed (`stamp_artifact`, `stamp_alignment_req`). An item not in the seed carries **no** field at all — absence is the signal, not a falsy value written everywhere.

**3. Every consumer treats "unmarked" as the safe default — and the safe default is today's behavior.** The consumer branch must no-op on absent data, and the direction of the no-op must be the *conservative* one:
- A restriction gate **fails open**: exclude only when the data says to. `web/model.js` `eligible()` drops an item for alignment only when `v.alignment_req` exists and is non-empty and excludes the character's alignment — an unstamped item is always eligible.
- An inclusion flag **fails closed toward the prior behavior**: with the Artifact opt-in off (the default), `v.artifact` on an unstamped item is `undefined` (falsy), so the exclusion branch and the exactly-one constraint are both dead. Empty seed = every item is treated as a non-Artifact = exactly the pre-feature world.

The rule: pick the no-op direction that reproduces the behavior from *before* the feature existed, so an empty seed is indistinguishable from the feature not being there.

**4. Data-sourcing is a separate, deferrable, reviewable track — not a subtask of shipping the code.** Because the mechanism is complete and green with an empty seed, populating the seed is decoupled: it ships as its own later effort (a Chrome-MCP wiki harvest, item-by-item, exclude-until-verified — add an entry *only* when the authoritative source explicitly states it, never inferred). The code PR and the data PR are independent; neither blocks the other.

## Why This Matters

The naive alternative couples two very different kinds of work: writing a code mechanism (fast, testable, low-risk) and curating trusted data (slow, manual, rate-limited, easy to get subtly wrong). Coupling them means the code sits unmerged for as long as the data takes, and pressure to "just ship it" tempts inferring data values — which is exactly the silent-corruption failure the discipline exists to prevent (a confidently-wrong "provably optimal" result is this tool's worst outcome). Decoupling via an empty fail-safe seed lets the mechanism land, get reviewed, and be regression-tested against synthetic seeded fixtures *now*, while the real data accretes safely later. The cost is that the feature is invisible until the seed fills — acceptable precisely because the alternative is either a stalled PR or an unsafe one.

The load-bearing invariant is **fail-safe direction**: an empty seed must reproduce pre-feature behavior exactly. Get the no-op direction backwards (e.g. an inclusion flag that defaults to "included" when unmarked, or a gate that defaults to "excluded") and an empty seed silently changes every result — the opposite of inert. Verify it with a test that asserts the empty-seed / unstamped path equals the baseline: `tests/test_artifact_flag.py` asserts the shipping seed loads empty and stamps nothing; `tests/model.test.js` asserts box-off pruning is byte-for-byte unchanged; the browser pass confirmed box-on with the empty seed returns the best non-Artifact build (feature inert, disclosed), not a changed one.

This is the code-side complement to the [[Verified]] / [[Quarantined]] data-trust model already in `CONCEPTS.md`: those govern *whether a parsed value is allowed into a solve*; this governs *how a feature that gates on such data ships before the data exists*.

## When to Apply

Any feature whose behavior is gated on data that is (a) slow/risky/manual to source and (b) trusted, so a wrong entry corrupts results. Curated allowlists, equip/permission gates, quality/type flags, feature-eligibility tables sourced from an external authority. Do **not** reach for it when the data is cheap and safe to source inline (just source it), or when a missing entry has no safe default (then the feature genuinely cannot ship until the data does — say so rather than shipping a mechanism that mis-defaults).

## Examples

The pipeline half — an empty seed stamps nothing, and the loader fails safe:

```python
# build_dataset.py — ships with data/seed/artifacts.json == []
def load_artifacts(path=ARTIFACT_SEED_PATH) -> set:
    if not os.path.exists(path):
        return set()                       # fail-safe: no file -> no data
    raw = json.load(open(path, encoding="utf-8"))
    if not isinstance(raw, list):
        return set()
    return {s for s in raw if isinstance(s, str) and s and not s.startswith("_")}

def stamp_artifact(variants, names) -> int:
    n = 0
    for v in variants:
        if v.get("source_item") in names:  # only seeded items get the field
            v["artifact"] = True
            n += 1
    return n                               # empty seed -> returns 0, stamps nothing
```

The consumer half — absent field is the safe default (here: unmarked == non-Artifact, and the opt-in is off by default):

```js
// web/model.js eligible() — inert until BOTH the seed is populated AND the box is on
if (v.artifact && !query.includeArtifact) return false;   // undefined artifact -> dead branch
```

Verified inert by regression: `tests/test_artifact_flag.py` ("shipping seed is empty until verified") and `tests/model.test.js` ("box off leaves pruning byte-for-byte unchanged"). The same shape backs the alignment gate (`alignment_restrictions.json` ships as a README-only object → `load_alignment_restrictions()` returns `{}` → `eligible()` fails open on alignment).

Related: `CONCEPTS.md`'s `Verified` / `Quarantined` entries (the value-level data-trust model this complements); `../design-patterns/parsing-ddo-wiki-affix-text.md` (the parser-level "never fabricate a value" discipline on the same wiki source).
