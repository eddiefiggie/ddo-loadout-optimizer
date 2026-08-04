# Wiki evidence — Negative Amplification (U3, issue #109)

**Verified:** 2026-08-03 (Chrome-MCP, interactive session)
**Source:** https://ddowiki.com/page/Negative_Amplification

## Quoted rule

The page enumerates Negative Amplification by **bonus type**, with dedicated sections:

> Insight bonus … Quality bonus … Profane bonus … (plus Racial enhancements / Class enhancements)

Categories exist for `Insightful Negative Amplification items`, `Quality Negative Amplification items`, and `Profane Negative Amplification items`. Negative Amplification "works just like Healing Amplification."

## Ruling for the optimizer (U3 / R2)

- Negative Amplification is a **typed** stat. Its real bonus types are **Insight, Quality, Profane** (and Enhancement via racial/class enhancements, not gear).
- Standard DDO stacking: **same bonus type → only the highest counts; different types stack.** So Quality (Cuffs of the Forbidden) legitimately stacks with a Profane source — the user accepted that.
- The reported double-count — **Hooves of the Nightmare (Profane 61)** + a separate **Lamordia item (neg-amp 61)** both counting — is only a bug if those two share a bonus type, OR if the Lamordia source carries the **spurious `Enhancement`-typed neg-amp** that issue #109 documents as "not a real affix outside Lunar gems."

## Implication for the fix

The wiki confirms the **channel model** (typed neg-amp; same-type dedup). The remaining step is a **per-item data check** at build time:
1. Identify the specific Chill-of-Ravenloft (Lamordia) item the report names and read its own wiki page for the real neg-amp bonus type.
2. If its data type is a spurious/wrong `Enhancement` (per #109), retype it to the wiki-correct type so it either collapses with Hooves (same type) or stacks correctly (genuinely different type).
3. The solver's `name || equivType(type)` dedup then handles the rest — no equivalence entry needed unless two genuinely-different wiki types must nonetheless not stack (not indicated here).

**Status:** CHANNEL MODEL CONFIRMED. The specific Hooves-vs-Lamordia collapse depends on the Lamordia item's wiki-verified type — a per-item data check in the fix, NOT an inference. If that item cannot be identified/confirmed, its neg-amp entry is quarantined per #109 rather than guessed.

## Resolution (2026-08-04) — ALREADY CORRECT, report was stale

Identified the "separate Lamordia item with neg amp 61" from the data: it is a **Viktranium (Chill of Ravenloft = Lamordia) crafting option: Negative Amplification 61, type Profane** — the **same type and value** as Hooves of the Nightmare (base affix, Profane 61).

- **The spurious `Enhancement`-typed neg-amp of #109 is already gone** from the current dataset (a full type scan shows only Profane / Artifact / Insight / Quality neg-amp — no Enhancement, no null).
- Both real sources are now **Profane 61**, so they share the `Negative Amplification||Profane` bucket. The solver's `Σz ≤ 1` per-bucket constraint (`web/solver.js`) covers **all channels** pushed into `zByBucket[k]` (worn + Viktranium + augment), so two same-type sources **collapse to the max (61), never sum to 122**.
- **Verified empirically:** `tests/solver.test.js` "U3/#109: same-type Negative Amplification does NOT stack across channels" — worn Profane 61 + augment Profane 61 → 61; a genuinely different type (Insight 20) stacks to 81 (correct per the wiki).

**No code fix needed** — the double-count no longer reproduces in the current data + solver. Added a cross-channel regression guard. If the user still sees a stack live, the two items carry genuinely **different** bonus types, which SHOULD stack per DDO rules (only same-type collapses).

