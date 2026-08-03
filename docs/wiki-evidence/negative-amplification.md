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
