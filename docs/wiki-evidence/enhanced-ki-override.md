# Enhanced Ki's override target — ruled

**Verified:** 2026-08-29 (same-origin from a ddowiki tab) · **Issue:** #232 · **Source:** https://ddowiki.com/page/Enhanced_Ki

## The question

The `Enhanced Ki` page states:

> Does not stack with [X] (this enchantment will override the ki generation portion of that one.)

The link target was stripped by the privacy guard during the #227 harvest, so which enchantment it overrides was unrecorded. #232 said explicitly: **do not assume `Balanced Ki Strike` — confirm.**

## The answer, and the guess was wrong

The link target is **`Alchemical Conservation`** (`/page/Alchemical_Conservation`), captured from the anchor's `href` rather than its label.

`Balanced Ki Strike` is a different thing entirely — a Shintao finisher effect granting Melee Power and Healing Amplification for a few seconds after Hands of Mercy. It shares no mechanic with ki generation, and the plausible-looking guess would have been recorded as fact.

## No correctness risk, now for a confirmed reason

| | |
|---|---|
| `Enhanced Ki` | 19 instances, type `Untyped`, values 1 / 3 / 4 / 5 |
| `Alchemical Conservation` | 5 instances, type `Bool`, value 1 — **presence, no magnitude** |
| Items carrying **both** | **none** |

`Alchemical Conservation` grants "+1 ki on every successful attack" plus extra daily uses of Action boost, Turn Undead and Bard song, and the page notes its bonuses "are all enhancement bonuses". Our dataset stores it as presence, so there is no ki magnitude to double-count against, and no item pairs the two anyway.

## When this becomes real

Both conditions must hold: `Alchemical Conservation` gains a stored magnitude **and** an item carries it alongside `Enhanced Ki`. Either alone is harmless. The override is recorded here so that a future refresh which types or quantifies it does not have to rediscover which enchantment overrides which.
