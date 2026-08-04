# Wiki evidence — Sheltering (U2)

**Verified:** 2026-08-03 (Chrome-MCP, interactive session)
**Source:** https://ddowiki.com/page/Sheltering

## Quoted rule

> Sheltering: This item provides a +X bonus to **both** your Physical Resistance Rating and Magical Resistance Rating. This is usually a[n] enhancement bonus unless otherwise stated.

## Ruling for the optimizer (U2 / R1)

- Bare **"Sheltering" +X"** grants **+X Physical Sheltering (PRR)** AND **+X Magical Sheltering (MRR)** — the same value to both.
- Default **bonus type is Enhancement** unless the affix states otherwise.
- Typed variants exist and must expand with their type preserved: **Insightful Sheltering → Insightful Physical Sheltering + Insightful Magical Sheltering**; **Quality Sheltering → Quality on both**; etc. (categories "Insightful Sheltering items", "Quality Sheltering items" listed on the page).

## Implication for the fix

At the item-affix expansion seam (build-time / load normalizer), expand a `Sheltering` affix (bare or typed) into **two** affixes — `Physical Sheltering` and `Magical Sheltering` — carrying the **same value and bonus type**. Both then bucket by `name || equivType(type)` and satisfy PRR / MRR targets, and a bare-Sheltering source collapses with an explicit Physical/Magical Sheltering source of the same type (no double-count).

**Status:** CONFIRMED — not quarantined.
