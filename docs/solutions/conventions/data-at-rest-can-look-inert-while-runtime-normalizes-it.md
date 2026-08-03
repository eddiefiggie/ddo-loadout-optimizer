---
title: A build-stamped field can look inert at rest while a load-time normalizer makes it live
module: data-pipeline
date: 2026-08-02
problem_type: convention
component: build-pipeline
severity: medium
applies_when:
  - "A generated data field reads as a uniform placeholder (all \"unknown\"/null) at rest"
  - "A bug report claims a gate/filter is a no-op or a wrong recommendation reproduces"
  - "Deciding whether a consumer of dataset data is actually inert before writing a fix"
tags:
  - data-pipeline
  - dataset
  - runtime-normalizer
  - verify-first
  - characterization
  - armor-type
  - exclude-until-verified
---

# A build-stamped field can look inert at rest while a load-time normalizer makes it live

## Context

Reviewing bug #90 ("select Heavy armor, the solver still recommends a cloth robe"), a first read of the data concluded the armor-type gate was inert: every Armor item in the generated `web/data/items.json` carried `armor_type: "unknown"`, and the `variantConflict` armor branch in `web/model.js` fails open on `"unknown"`. That is true **at rest** — but it is not what runs.

`web/dataset.js` `normalizeItem` re-derives `armor_type` from the native `type` field via `ARMOR_TYPE_MAP` on **every load** (`normalizeDataset` walks all items). So in the browser — and in the Node tests, which call `normalizeDataset` — the armor gate sees a concrete `cloth`/`light`/`medium`/`heavy` value, and the wizard already supplies `query.armorTypes`. The gate was **already live**, and #90 did **not** reproduce at runtime.

## Guidance

Before concluding that a data-backed consumer (a gate, filter, scorer) is inert — or that a data-shaped bug reproduces — **verify the runtime path, not just the data at rest.** A value that is a uniform placeholder in the generated artifact may be re-derived to a concrete value by a load-time normalizer before any consumer reads it. Trace: raw source field -> build stamp -> generated artifact -> **load-time normalizer** -> consumer.

The cheap, decisive move is a **characterization test** that drives the real runtime path end-to-end (build-shaped item with the native source field -> `normalizeDataset` -> the consumer), and asserts the observed behavior. If the bug does not reproduce there, the fix is not where the bug report pointed.

Concretely for #90, the verify-first unit collapsed the "fix" to:

- **Hardening, not a code path**: stamp `armor_type` at build in `src/variants.py` `_make_variant` (from the same `type` field, via the same lowercase `ARMOR_TYPE_MAP` vocabulary), so the artifact is honest at rest and matches what the normalizer produces — a single source of truth, not a second parallel value.
- **Removing a stale comment** in `web/model.js` that claimed "armor_type all 'unknown' ... every branch is a no-op" — false since the normalizer + wizard wiring landed.
- **No solver/gate change** — there was no live bug to fix in the consumer.

## Why This Matters

Reading only the data at rest inverts the conclusion: it says "the gate is dead, wire it up / rewrite the solver," when the gate is alive and the real gap is only that the artifact is dishonest at rest (a cosmetic/SSOT issue, plus a false comment). A plan built on the at-rest read would have specified a from-scratch fix for a bug that no longer exists — wasted work, and a risk of regressing a working gate. The runtime derivation is the load-bearing fact, and it is invisible unless you look for it.

This is the mirror image of [[exclude-until-verified-empty-seed-masks-consuming-bugs]]: there, an empty seed leaves a field **genuinely** inert and hides a real consuming bug. Here, a load-time normalizer makes an apparently-inert field **live**. The shared lesson: the at-rest shape of a field never settles whether its consumer is exercised — only the runtime path does.

## When to Apply

- A generated data field is a uniform placeholder and you are about to conclude "the thing that reads it is dead / never fires."
- A bug report describes a data-shaped symptom (wrong recommendation, missing filter) and you are scoping the fix.
- Two layers (a Python build stamp and a JS load-time normalizer) both touch the same field — check whether the later one overrides the earlier, and keep their vocabularies identical so the stamp is SSOT, not a diverging copy.

## Examples

Runtime behavior contradicts the at-rest read:

```
# at rest (web/data/items.json) — looks inert
Armor items: armor_type is "unknown" for the 4 armor classes

# at runtime (after web/dataset.js normalizeItem) — live
Armor-slot armor_type: {cloth: 250, light: 238, medium: 179, heavy: 184, unknown: 209(=Docents)}
# a Heavy query EXCLUDES a cloth robe; #90 does not reproduce
```

Characterization test that proves the runtime path (`tests/model.test.js`):

```javascript
const ds = normalizeDataset({ items: [
  { ...armorV("Aberrant Robe", "unknown"), type: "Cloth armor" },
  { ...armorV("Argenti's Armor", "unknown"), type: "Heavy armor" },
], metadata: {} });
assert.strictEqual(ds.items[0].armor_type, "cloth");           // normalizer made it live
const kept = M.eligible(ds.items, { mlCap: 34, armorTypes: ["heavy"] }).map(x => x.source_item);
assert.deepStrictEqual(kept, ["Argenti's Armor"]);            // gate excludes cloth -> #90 doesn't reproduce
```

## Related

- [[exclude-until-verified-empty-seed-masks-consuming-bugs]] — the inverse: a genuinely-inert empty seed hides a consuming bug.
- [[exclude-until-verified-data-gates]] — when a restriction gate legitimately fails open until its data is sourced.
- [[single-source-of-truth-for-set-definitions]] — the SSOT principle behind stamping `armor_type` from the catalog `type` rather than a parallel value.
