---
title: "A bundled template's numbers live in the tooltip, not the visible cell"
module: data-pipeline
date: 2026-08-08
last_updated: 2026-08-19
problem_type: convention
component: tooling
severity: high
related_components:
  - solver
  - build-pipeline
applies_when:
  - "Harvesting a value from a wiki page where one template name grants several stats at once"
  - "A scraped field looks like a bare label with a single number and no other stats"
  - "Two repo artifacts each record the same wiki fact and nothing compares them"
tags:
  - ddo
  - wiki-harvest
  - rendered-value-authority
  - data-discipline
  - exclude-until-verified
  - provenance
---

# A bundled template's numbers live in the tooltip, not the visible cell

## Context

`Topaz of Swiftness 15%` shipped granting no alacrity at all. It was ruled on
twice and got a different wrong answer each time, and a player reported the same
defect a third time before it was fixed in #168.

Every ruling read the same thing: the augment's effect cell on
`Raw data/Item augments`, which renders `Speed +30%`. That looks like a bare
movement stat next to its siblings' `Striding +30% Melee Alacrity 5%`, so each
pass concluded the wiki simply does not state alacrity for it — and the
2026-08-07 ruling went further, calling the augment "strictly dominated by the
10%".

The tooltip behind that cell says:

> `Speed +30%`: +30% enhancement bonus to movement speed, **15% bonus to attack
> speed.**

Nobody opened it. The augment is not dominated by the 10% — it beats it, and
grants ranged alacrity the 10% does not.

## Guidance

**A wiki effect cell has two layers.** The visible text names the enchantment;
the tooltip behind it carries the numbers. When one template bundles several
stats under one name, the visible layer omits every stat not spelled out in the
cell. Reading only that layer does not produce a gap you can see — it produces a
confident, wrong, complete-looking answer.

**There is a third layer above both: the template invocation itself.** The
tooltip is a *rendering* of `{{Speed|30}}`; the invocation is the page author
stating the fact, and its parameters outrank anything rendered from them. Two
consequences. First, the failure mode is not limited to omitted numbers — a
visible cell can also assert a *wrong bonus type* that the invocation settles
outright, as the legacy `Elemental Resistance` dialect does. Second, when a seed
shard already stores the invocation in a `raw` or `template` field, layer 1 is
local: no harvest, no throttle, no browser round trip. See
[`read-the-standing-ruling-and-judge-the-strongest-evidence-layer.md`](read-the-standing-ruling-and-judge-the-strongest-evidence-layer.md),
which owns the full hierarchy and the triage step that precedes it.

**1. Treat a bare label as a question, not an answer.** `Speed +30%` beside
`Striding +30% Melee Alacrity 5%` is the tell: same shape, fewer stats. That
asymmetry usually means the template bundled them, not that the wiki is silent.

**2. Read the rendered tooltip, not the cell text.** Extract from
`#mw-content-text` via `javascript_tool`; `get_page_text` returns "no text
content" on pages that loaded fine. The tooltip is in the popup span's
`textContent`, after the visible label.

**3. Snapshot per invocation, not per item.** The tooltip is a pure function of
the wikitext, so every page using `{{Speed|30}}` renders the same tooltip. In
this repo 194 harvested entries collapse to 31 distinct invocations. That is
what makes re-checking affordable against a source that throttles after roughly
eight rapid calls — and MediaWiki's `action=parse` renders arbitrary wikitext,
so all of them fit in a single POST.

**4. Keep the cell and the tooltip in separate fields.** They are different
facts and conflating them corrupts the store. The first pass at the augment
shard stored cell text under a `tooltip` key; three augments share
`{{Striding|30}}` but had different strings, because upstream carries the
Swiftness family's Melee Alacrity as a separate affix. Per-invocation snapshots
plus a per-entry `cell` field keep both readable.

**5. A rendered number is still not automatically a value.** `Template:Speed`
renders 5% for any Arabic magnitude nobody recorded. The discriminator is the
argument's numeral system, not the number: `{{Speed|V}}` legitimately states 5%,
while `{{Speed|17}}` renders a placeholder. See [[Harvest provenance]] — the
tooltip settles magnitude, never provenance.

**6. When two artifacts record the same fact, make something compare them.**
`harvest-method.md`'s worked-example list recorded `Belt of the Ram 15`
correctly while the shard carried it as `unsourced` with "no Striding/Speed
template found". Both were committed, both trusted, contradictory for a full
harvest cycle, because nothing read them together. `speed_split.audit_shard()`
now reports `unsourced` entries as harvest suspects — an `unsourced` reading is
a *claim about a page*, and it can be wrong.

## Why This Matters

Upstream gear-planner scrapes the visible layer. That is why its catalog folds
`Striding` into `Speed` and why `{{Speed}}` items arrived with their attack-speed
half missing — the blindness is inherited, not local, so it cannot be fixed by
trusting the upstream snapshot harder.

The cost shape is the dangerous part. A missing stat does not surface as a gap or
a parse error. It surfaces as a plausible loadout that quietly omits the best
augment in a slot, on a tool whose stated promise is "provably the best". Three
separate player reports were needed to dislodge it, and two of those produced
rulings that made the record worse rather than better.

## When to Apply

- Any harvest of a field whose value comes from a bundled-enchantment template.
  `harvest-method.md` §2 now records opening the tooltip as a non-negotiable for
  this class, not just for Speed.
- Whenever a scraped cell for one family looks structurally thinner than its
  siblings.
- Before writing a "the wiki does not state X" ruling. That claim requires having
  looked at the rendered layer; the cell text alone cannot support it.
- When adding a second artifact that encodes a fact an existing artifact already
  encodes — add the check that compares them in the same change.

## Examples

**The defect.** All seven augments carrying the folded affix, read 2026-08-08:

| Augment | Cell | Template | Attack speed |
|---|---|---|---|
| Topaz of Striding 10% / 20% / 30% | `Striding +N%` | Striding | none |
| Sapphire of Snowpeaks **Speed** | `Striding +30%` | **Striding** | none |
| Topaz of Swiftness 5% / 10% | `Striding +30% Melee Alacrity N%` | Striding | none |
| **Topaz of Swiftness 15%** | `Speed +30%` | **Speed** | **15%** |

Note the name trap in row two: `Sapphire of Snowpeaks Speed` is Striding.
Classification follows the template in the cell, never the item's name.

**The cross-check that was missing.** `Item:Belt of the Ram` renders
`Speed +15%`, whose tooltip reads "+15% enhancement bonus to movement speed, 5%
bonus to attack speed" — a placeholder 5%, so `defaulted`. The shard had recorded
it as having no template at all. The correction changed no solver output, because
the `unsourced` branch already kept gear-planner's movement value; what it bought
was an entry that can carry a snapshot, and a store that stops asserting
something the wiki contradicts.

**The verification this produced.** Snapshots feed
`speed_split.check_against_snapshots()`, which asserts every derived value
against the wiki's own rendered text on each build. Rendering every invocation
also settled a standing question: the hand-transcribed Arabic switch table had
been verified against exactly one tooltip. Eight of its nine recorded rows now
check out. The ninth, `{{Speed|24}}`, appears on no harvested item, so nothing
renders it and it remains honestly unverified rather than assumed correct.

## Related

`a-templates-magnitude-may-live-on-its-own-page-not-in-the-call.md` is the same
failure one level deeper, and it was found four separate times before anyone saw
the shape. Here the number is in the tooltip *behind* the visible cell. There it
is not on the item page at all — the item names the enchantment and the wiki
states the magnitude once, on that enchantment's own page. A structural read gets
a name and no number, which surfaces as a presence flag, a phantom bonus type, or
an affix filed under a name that is not a stat.

The shared rule: **the visible layer of an item page is not the value layer.**
