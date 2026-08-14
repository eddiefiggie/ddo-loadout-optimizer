# Spell Focus values vs the wiki — the #93 sweep (verified correct)

**Ruled:** 2026-08-13. **Verdict: the "pre-U80 Spell Focus values" report does
NOT reproduce.** Every flagged row — all same-band anomalies and every
pre-U80-looking outlier the inventory surfaced — matches the wiki's rendered
value exactly. No corrections were filed from this sweep. Do not re-raise a
stored school-focus value on band-shape suspicion alone; anything new needs a
specific item + rendered-tooltip evidence.

## Method

Inventory: all school-focus affixes in the built dataset grouped by value, type
and ML band; the anomalies (values below band mode, Quality +1-vs-+2
inconsistency, same-band spreads) became the work list — ~38 item-affix rows
across 26 wiki pages, tiered pages covering multiple rows. Wikitext via
same-origin `action=query`; template semantics settled by `action=parse`
renders of the distinct invocations.

## The three findings that settle the anomalies

**1. `{{Spell Focus|School|ROMAN}}` is face value.** The template accepts Roman
numerals and the rendered tooltip states the same number: `Evocation Focus V:
+5 Equipment bonus to the DC of Evocation spells.` (V→+5, III→+3, II→+2,
verified by render). Unlike `Parrying` — where the Roman form is a rank
granting a different number — Spell Focus Romans ARE the magnitude. Every
Roman-carrier row matches stored: Epic Rod of Mythant (V=+5), The Epic Band
Immaterial (V/V + Insightful 2s), Bracelet of Madness (II=+2), Staff of the
Necromancer (III=+3), Twilight, Element of Magic (III/III), Dreampiercer
(III=+3), Sage's family (below).

**2. Tiered items resolve at `Item:<name> (level N)` subpages.** `Item:Robe of
Shadow` etc. are `{{Tiered item}}` DPL wrappers; the values live on per-level
pages (`Robe/Docent of Shadow` 20→II, 24→III, Docent 32→10; Crystalline
Scepter 23/24→II, 25→III; Gloves of the Master Illusionist 26→IV, 27/28→V).
All match stored.

**3. The "missing" Sage's pages are leveled titles.** `Sage's Locket` has no
base page; `Item:Sage's Locket (level 26)` exists (Evocation V), as do
`Sage's Mantle (level 27)` (Enchantment V, Illusion IV) and `Sage's Shoes
(level 27)` (Conjuration V). All match stored.

Also confirmed as stored: the ML29 Quality +1 trio (Legendary Summoner's
Spectacles, Legendary Reflective Bloodstone, Legendary Twisthallow Cloak — the
wiki states Quality 1; the ML28 +2s are Insightful, a different type), and the
ML30+ spot checks (Gorth's Mage Hand Illusion 10, Perfected Salt-Pearl Ring
Enchantment 11, Legendary Torc of Prince Raiyum-de II Enchantment 9, Legendary
Diabolist's Robe Conjuration 9).

## Standing context

`spell-focus-universal.md` already rules the Argonnessen Eye Band correction
(PR #210) "one stale row, not systematic drift"; this sweep is the systematic
half that #93 asked for, and it confirms that ruling. The unavailable-items
half of #93 is separate — see `no-drop-source.md` (the `Special event items`
extension).
