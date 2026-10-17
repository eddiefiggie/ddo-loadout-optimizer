# Exceptional Fortification — the label says Exceptional, the game stacks it as Insight (#862)

**Ruled:** 2026-10-16. **Method:** in-app Browser pane, same-origin, per `harvest-method.md`: both items' rendered tooltips (`action=parse`), the `Fortification` article and `Template:Fortification` (`action=query&prop=revisions`), and every member of `Category:Exceptional Fortification items`. **Shard:** none, because no data change was needed. **Guard:** `tests/test_exceptional_fortification.py`.

## The question

`The Disciplinator` and `Toven's Hammer` engrave `{{Fortification|0|10}}`, which renders as **"Exceptional Fortification (+10%)"**. The catalog stores both as `Fortification | Insight | 10`, restored by `gap_corrections.json` from gear-planner's own parse at `767a7f7`. `Exceptional` and `Insight` are different stacking buckets, so the question was whether these two should move to `Exceptional`.

## The answer: Insight, stated three ways

1. **The rendered tooltip**, identical on both items: "Exceptional Fortification (+10%): … there is a +10% chance that the critical hit or sneak attack is negated … **This ability is considered an Insight bonus when determining stacking with other sources of fortification**."
2. **The `Fortification` article**, *Sources of Fortification*: "Standard fortification items provide enhancement bonuses … You can combine them with rarer Insightful Fortification items (insight bonus)". Under "**Insight bonus** — stacks with enhancement bonus" it lists `Category:Exceptional Fortification items`.
3. **`Template:Fortification`:** amount `0` selects the *Exceptional* display variant with a separate percentage. It is a label variant of the template, not a bonus-type parameter. A bonus type is passed explicitly only for amounts 5 and up (`{{Fortification|55|Insightful}}`).

This is the shape `seeker-bonus-type.md` re-ruled on 2026-09-04 (#697): "Exceptional" is the engraved **label**, and the tooltip states the type the game applies. The tooltip is the authority.

## Every carrier agrees

`Category:Exceptional Fortification items` has three subcategories, +10%, +25% and +50%, with 21 catalog records between them. Every one stores `Fortification | Insight` at exactly its category's magnitude:

| Magnitude | Records |
|---|---|
| 10 | Embrace of the Spider Queen, Greater Stalwart Trinket, Leaves of the Forest (level 15, 16), Livewood Core (level 15, 16), Stalwart Trinket, Sustaining Symbiont, The Disciplinator, Toven's Hammer |
| 25 | Leaves of the Forest (level 17, 22, 23), Livewood Core (level 17, 22, 23), Omniscience |
| 50 | Epic Emerald Guard, Epic Scales of Surety, Leaves of the Forest (level 24), Livewood Core (level 24) |

No catalog record stores Fortification at `Exceptional`, and none should.

## Why it is recorded even though nothing changed

Upstream re-typed Seeker's "Exceptional" carriers once (397c673), and that silently changed what stacked with what. A refresh doing the same here would make Exceptional Fortification add on top of every Insight fortification source. The guard pins all 21, so that flip fails the build naming the carrier instead.
