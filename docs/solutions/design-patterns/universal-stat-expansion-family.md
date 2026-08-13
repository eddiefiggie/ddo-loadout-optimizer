---
title: Expand a DDO "universal" stat into per-target affixes, gated by wiki evidence per family
module: data-pipeline
date: 2026-08-13
last_updated: 2026-08-13
problem_type: design_pattern
component: tooling
severity: high
category: design-patterns
tags:
  - universal-stat
  - stat-family
  - expansion
  - spell-focus-mastery
  - potency
  - bonus-type-stacking
  - provenance
  - wiki-evidence
  - ddo
applies_when:
  - "Adding a stat the DDO wiki documents as applying to every member of a family (e.g. all seven spell school DCs off Spell Focus Mastery, all ten element spellpowers off Potency) rather than one concrete stat"
  - "A gear channel (item, item set bonus, dino insert, dino set, viktranium option, membership def, augment def) can carry an affix naming a family umbrella instead of a concrete target stat, so it would score zero against ranked priorities unmodified"
  - "Deciding whether a universal-sounding stat should expand into per-member affixes at the same bonus type, or must stay unexpanded because it already fully stacks (Universal Spell Power) or is a genuinely-distinct-but-overlapping bonus (Spell Lore)"
  - "Wiring an expanded/stamped family stat into picker or saved-build priority matching so a redirecting label keeps old saved priorities valid"
---

# Expand a DDO "universal" stat into per-target affixes, gated by wiki evidence per family

## Context

DDO has "universal" enchantments — a single named affix that raises a whole *family* of concrete stats at once, rather than one stat. Two families shipped in PR #294 (merged to main 2026-08-13, closes #287/#288/#289 and the Potency half of #290):

- **Spell-DC family** — `Spell Focus Mastery`, bare `Spell Focus`, and the seed wording `Spell DCs` all raise the DC of every spell school, and expand to the seven `SCHOOLS` (`src/spell_focus.py:71-80`).
- **Spellpower family** — `Potency` raises every element spellpower, and expands to the ten `SPELLPOWERS` (`src/spell_focus.py:82-95`).

The optimizer credits an affix only when its stat name exactly matches a ranked priority. A universal name therefore scores nothing no matter how many items carry it: `Spell Focus Mastery` sat on 232 items and 516 set-bonus tiers while every school-specific priority (`Necromancy Focus`, etc.) ignored all of them (`src/spell_focus.py:13`; the 516 set-tier count is recorded in `docs/wiki-evidence/spell-focus-universal.md`). The reported symptom (#205) was a necromancer build recommending none of them; `Spell DCs` (#289, the Esoterica augment-set wording) and `Potency` (#290) were the same defect in different channels. This is the second instance of the shape chronologically — the ability-umbrella expansion (`src/umbrella.py`, 2026-07) came first, the spell-DC family followed (#205, 2026-08-09), and the Legendary-name fold (`src/legendary_fold.py`, #287) landed alongside the spellpower widening in #294 — by which point it is a recognized family pattern, not a one-off.

## Guidance

**1. One allowlist table, not per-name code.** `src/spell_focus.py:117-122` holds `_UNIVERSAL`, a `{lowercased name: target list}` dict mapping each universal name to its family's concrete stats:

```python
_UNIVERSAL = {
    "spell focus mastery": SCHOOLS,
    "spell focus": SCHOOLS,
    "spell dcs": SCHOOLS,
    "potency": SPELLPOWERS,
}
```

A name is admitted only with a wiki quote that states universality outright — never inferred from a name pattern. See Guidance §3.

**2. Expansion emits siblings at the same bonus type, stamped with provenance.** `_expand_affix` (`src/spell_focus.py:165-177`) turns one universal affix into N concrete affixes, copying every other field verbatim and stamping the originating name under `PROVENANCE_KEY = "via"` (`src/spell_focus.py:126`):

```python
def _expand_affix(affix: dict) -> list:
    targets = _UNIVERSAL.get((affix.get("stat") or "").strip().lower())
    if not targets:
        return [affix]
    label = source_label(affix.get("stat"), affix.get("bonus_type"))
    return [{**affix, "stat": stat, PROVENANCE_KEY: label} for stat in targets]
```

`source_label` renders the wiki's own wording (`"Sacred Spell Focus Mastery"`, Insight → `"Insightful"`, Equipment unprefixed) so the proof panel can display text that actually appears on the item, never the school it credits (`src/spell_focus.py:156-162`).

**3. Same bonus type is load-bearing — it is what reproduces the wiki's stacking rule for free.** The existing per-`(stat, stacking-type)` max bucket in `web/model.js` (`variantBuckets`, `web/model.js:56-66`, keyed through `equivType`, `web/model.js:35-45`) already implements "same type collapses to the highest, different types add." Because expansion stamps the sibling affixes at the *same* bonus type as the source, that existing bucketing reproduces both DDO rules — universal-vs-school-specific don't-stack, and cross-type stacking — with **no solver or model change**. The module docstring states the invariant directly: "If this expansion ever seems to require a change to that bucketing, the expansion is wrong" (`src/spell_focus.py:29-30`).

**4. Admission is wiki-evidence-gated, one file per family.** `docs/wiki-evidence/spell-focus-universal.md` and `docs/wiki-evidence/spellpower-universal.md` each carry the verbatim quote that justifies expansion — e.g. the Spell Power page's "Potency → All Spells" table row, and the Equipment-bonus page's "Multiple sources of equipment bonus do not stack, only the highest bonus applies," which names Potency and Combustion as the same kind of bonus. No name enters `_UNIVERSAL` without an evidence doc backing it.

**5. Channel coverage — expand at every place a universal name can appear.** `expand_variants` (`src/spell_focus.py:192-216`) covers item affixes and item-attached set-bonus tiers in one pass, since both are carried in the same `{stat, bonus_type, ...}` shape at build time. `expand_affixes` (`src/spell_focus.py:187-189`) is the one-level-in helper for every other multi-affix container, called explicitly at each site (grep `build_dataset.py` for `expand_affixes`/`expand_variants`):

- dino inserts (`build_dataset.py:761`)
- dino set defs (`build_dataset.py:769`)
- membership set defs / Vecna Lost Purpose tiers (`build_dataset.py:833`)
- augment set defs / Esoterica (`build_dataset.py:865`, the #289 channel)
- Viktranium crafting options (`build_dataset.py:896`)

**6. Guard the channel list itself, not just each channel.** Two orphan checks fail the build if an expanded-away name survives anywhere: `enchantment_split_mod.set_bonus_orphans` (`build_dataset.py:818-823`) over variant set-bonus tiers, and `enchantment_split_mod.set_def_orphans` (`build_dataset.py:869-876`) over the membership/augment def channels. Both are checked *per channel*, not aggregated — `set_def_orphans` takes a dict of named channels so a populated channel cannot silently vouch for an emptied sibling (confirmed by `tests/test_augment_sets.py:360` `test_set_def_orphans_vacuity_is_per_channel_not_aggregate`). This guard is what caught the #289 gap: the augment-set defs were built from their own seed and never passed through variant expansion at all.

**7. Web integration is automatic — no per-family registration.** `web/dataset.js:539-572` (`_provenanceScan`) scans the loaded dataset for any affix carrying a `via` stamp and groups by originating label; the comment at `web/dataset.js:704` states the design intent directly: "Every source is a scan of stamped data, never a family list — an eighth family is included the moment it stamps its first affix." The resulting labels become rankable, redirecting priorities: picking `"Sacred Spell Focus Mastery"` in the priority picker expands to its seven components via `resolvePriorityAdd` → `migratePriorities` (`web/wizard.js:698-714`), and a saved character ranking an expanded-away name is migrated the same way on load (`web/wizard.js:2126-2127`, using the same `migratePriorities` function as the picker — "the SAME function the saved-character load path uses," `web/wizard.js:679`).

**8. Golden fixtures ranking an expanded-away name use `aliasTargets`, not a hand-copied stat list.** `tests/parity/capture_golden.js:36-64` resolves `query.aliasTargets` through the identical `buildPickerVocabulary` + `migratePriorities` pair the app uses, and throws if the alias no longer resolves — so a fixture solves exactly what a migrated saved build gets, and can't silently drift from the live table.

## Why This Matters

DDO stores universal enchantments as a single stat name, but the optimizer's credit model is exact-name matching. Without expansion, a universal stat is a complete blind spot: not degraded, not partially credited — invisible, with no error or warning, because nothing about "no item scores this priority" looks different from "no item happens to carry it." All three shipped instances (#205, #289, #290) were discovered the same way: a player ranked a school/element and got zero recommendations from items that, in-game, obviously apply.

The pattern is valuable specifically because it requires **no changes downstream of expansion**. The stacking math, the picker vocabulary, the saved-character migration, and the golden-fixture resolution were all already generic over "any affix with these fields" — expansion just needed to feed them the right shape, once, at build time. That is also why the two DON'T-expand cases are as important as the pattern itself: getting the *target* right (same-type family members) is easy to verify, but getting the *stacking semantics* right (same-type vs. cross-add) is where a careless expansion introduces a real regression instead of fixing a real gap.

## When to Apply

Apply this pattern when a DDO enchantment name is confirmed by the wiki to apply uniformly across a fixed, enumerable set of concrete stats, AND those concrete stats already exist as independently-rankable priorities in the dataset.

Do **not** apply it, or apply something else, when:

- **The universal stat is itself fully additive/stacking**, rather than competing in the same bonus-type bucket as its "children." `Universal Spell Power` is the recorded example: the wiki says it is a flat add to *all your other* spellpowers, not a same-type equipment source — same-type expansion would wrongly place it in max-competition with element spellpowers instead of adding to them. This is deferred to a cross-add mechanism as issue #291, not force-fit into this expansion.
- **The "universal" name and the specific name are actually different stats that both legitimately apply**, per wiki evidence of co-occurrence. Spell Lore is the recorded example (`docs/wiki-evidence/spell-lore.md`): universal and element-specific lore appear together on ten items and add (different bonus types), so expanding/merging them would collapse two real, stacking sources into false competition. This keeps issue #290's lore half open rather than closing it via this mechanism.
- **The evidence is a name pattern or a plausible guess, not a stated rule.** `Deific Focus` was the tempting near-miss for the spell-DC family: same "Focus" naming, Sacred typing, but its actual mechanic (per item tooltips, since it has no wiki page of its own) is a conditional five-second ramping buff cleared by casting a different school — expanding it would have credited +3 Sacred to all seven schools permanently. It stays excluded, recorded in `src/spell_focus.py`'s docstring and `docs/wiki-evidence/spell-focus-universal.md`.
- **A new universal name is found that isn't yet evidenced.** Issue #292 is the standing follow-up to sweep remaining universal names (e.g. `Spell Intensity` is called out as an explicit candidate, not silently included); issue #211 wants a generic name-shape detector for this class of gap across all expansion families (ability umbrella, Legendary fold, spell-DC/spellpower, compound absorption) — #294 adds instances to a recognized shape, it does not build that detector.

## Examples

**Adding a new universal name to an existing family** (e.g. a future DC-granting enchantment): add the lowercased name to `_UNIVERSAL` in `src/spell_focus.py` pointing at `SCHOOLS` or `SPELLPOWERS`, with a wiki quote appended to the matching `docs/wiki-evidence/*.md` file stating the "applies to all X" rule. No other file changes — `expand_variants`/`expand_affixes` call sites, the orphan guards, the provenance scan, and fixture migration all pick it up automatically because they key off the stamped `via` field and the `expanded_away()` map, not a hardcoded family list.

**Reaching a new multi-affix container** (the actual pattern of #289's bug): if a new crafting pool, set-bonus, or def channel is added to `build_dataset.py` that carries `{stat, bonus_type, ...}`-shaped affixes, it must call `spell_focus_mod.expand_affixes(...)` on that channel's affix list explicitly — the per-variant `expand_variants` pass only reaches item affixes and item-attached set-bonus tiers, not standalone def/pool structures. Forgetting this is exactly what happened to the augment-set defs before #289, and is exactly what `set_def_orphans` (per-channel) now catches at build time instead of silently shipping.

**Ranking an expanded-away name in a golden fixture**: use `"query": {"aliasTargets": ["Sacred Spell Focus Mastery"]}` instead of hand-listing the seven school names in `targets` — `tests/parity/capture_golden.js` resolves it through the same `migratePriorities` path a player's saved character goes through, so the fixture can't drift from what the app actually produces.

## Related

- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the admission discipline this pattern applies to an expansion allowlist.
- `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md` — rule 4 (coverage of one channel is not coverage of another) is the trap the per-channel orphan guards exist for; #293 is its latest recurrence.
- Evidence docs: `docs/wiki-evidence/spell-focus-universal.md`, `docs/wiki-evidence/spellpower-universal.md`, `docs/wiki-evidence/spell-lore.md`, `docs/wiki-evidence/bonus-type-equivalence.md`.
- Issues: #205, #289, #290 (the three shipped instances); #291 (cross-add, don't-expand case), #292 (universal-name sweep), #293 (dino-set umbrella gap), #211 (detector).
