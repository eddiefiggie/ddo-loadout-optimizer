# Wiki evidence — boolean composites carrying hidden magnitude (U4)

**Verified:** 2026-08-05 (Chrome-MCP, interactive session)
**Plan:** `docs/plans/2026-08-05-001-fix-affix-vocabulary-hygiene-plan.md` (U4, feeding U5)
**Reports:** #140 (composite affixes not considered)

## Why this file exists

Four affixes are stored in the dataset as `Bool` — presence with no magnitude — even though the game grants a concrete number. The optimizer therefore knows an item *has* the effect but cannot weigh it against anything. U5 writes the verified components onto the carrying item's record, **additively** (the boolean stays, so the effect remains targetable as presence).

Per KTD5, a component whose bonus type the wiki does not state is **excluded**, not written untyped: an untyped component would land in its own bucket and stack on top of a same-stat affix already on the item, turning an under-counting bug into an over-counting one.

**Outcome: 3 of 4 confirmed, 1 quarantined.**

| Composite | Records | Verdict |
|---|---|---|
| Blurry | 71 | CONFIRMED — 1 component |
| Lesser Displacement | 69 | CONFIRMED — 1 component |
| Crown of Summer | 7 | CONFIRMED — 3 components |
| Greater Heroism | 16 | **QUARANTINED** — magnitude not stated for the item enchantment |

---

## 1. Blurry — CONFIRMED

**Source:** https://ddowiki.com/page/Blurry · https://ddowiki.com/page/Concealment

> Effect: Items with this property make the wearer's outline become blurred. Enemies have a 20% Concealment miss chance.

The item-effect page states the magnitude but not the bonus type. The Concealment page supplies it:

> 20% enhancement bonus to concealment — Item effects: Blurry, Smoke Screen

| Stat | Bonus type | Value |
|---|---|---|
| Concealment | Enhancement | 20 |

**Status:** CONFIRMED — write in U5.

---

## 2. Lesser Displacement — CONFIRMED

**Source:** https://ddowiki.com/page/Concealment

> 25% enhancement bonus to concealment — Item effect: Lesser Displacement

| Stat | Bonus type | Value |
|---|---|---|
| Concealment | Enhancement | 25 |

**Status:** CONFIRMED — write in U5.

---

## 3. Crown of Summer — CONFIRMED

**Source:** https://ddowiki.com/page/Crown_of_Summer

> Crown of Summer: You gain:
> +15 to positive Healing Amplification (enhancement bonus)
> +10 Melee Power (enhancement bonus)
> +5 Ranged Power (enhancement bonus)

All three components carry an explicitly stated bonus type.

| Stat | Bonus type | Value |
|---|---|---|
| Healing Amplification | Enhancement | 15 |
| Melee Power | Enhancement | 10 |
| Ranged Power | Enhancement | 5 |

**Name mapping:** the wiki says "positive Healing Amplification"; the dataset's canonical name for that stat is `Healing Amplification` (the negative and repair variants carry their own distinct names). `Melee Power` and `Ranged Power` map directly. All three are already in `metadata.rankable_affixes`, so no new stat is minted for this composite.

**Status:** CONFIRMED — write in U5.

---

## 4. Greater Heroism — QUARANTINED

**Sources:** https://ddowiki.com/page/Greater_Heroism · https://ddowiki.com/page/Heroism · https://ddowiki.com/page/Item:Legendary_Cloak_of_Victory

The **spell** page states a magnitude:

> The target gains a +4 morale bonus on attack rolls, saves, and skill checks. The target also receives temporary hit points equal to the caster level and immunity to fear.

But the **item enchantment** does not. Carrier items list it as a bare name with no numbers — Legendary Cloak of Victory's enchantment block reads simply `Greater Heroism`, alongside separately-numbered lines like `Charisma +14` and `Combat Mastery +11`. There is no item-effect page for it; both `Greater Heroism` and `Heroism` resolve to spell pages.

**Counter-evidence against assuming the spell's values.** That same cloak lists `Immunity to Fear` as its own separate enchantment. If the item form of Greater Heroism included the spell's fear immunity, listing it separately would be redundant — which is a real signal the item enchantment is not simply "the spell, permanently."

Two further mismatches make the spell values a poor fit for an equipped affix: the spell's temporary hit points scale with **caster level**, which an item has no equivalent of; and the spell is a timed buff, whereas an equipped affix is modeled as always-on.

Applying the spell's `+4 morale` to the item enchantment would be **inference, not sourcing** — precisely what the standing exclude-until-verified rule and KTD5 forbid. The dataset already separates `Greater Heroism` (16 records) from `Greater Heroism clicky` (4 records), so the parser is not conflating the use-activated form; the gap is that neither form has a wiki-stated equipped magnitude.

**Status:** ~~QUARANTINED~~ **WRITTEN 2026-08-28 (#140)** — see the resolution at the end of this section. The quarantine reasoning below is kept because it was correct while it stood, and its counter-evidence was later confirmed by the wiki.

**Superseded status line:** QUARANTINED — do **not** write components in U5. `Greater Heroism` keeps its current `Bool` presence behavior, which remains targetable and correct as far as it goes.

### Re-harvest 2026-08-25 — the magnitude question is ANSWERED; the quarantine holds on three new grounds

**Read the whole of this subsection before re-investigating.** The unblock condition the 2026-08-05 ruling named above — "an item-effect page stating the equipped values" — is now **partly satisfied**, so a re-harvest that stops at the spell page will conclude the value is writable. It is not. Three separate walls sit behind it, and none of them is a sourcing problem.

**What the wiki now states.** The spell page carries an items section that rules on the passive form directly:

> The items that have greater heroism as a passive enchantment do not grant the temporary hitpoints and immunity to fear portion of the spell.

This is a **subtraction**, not an assumption, and it is materially stronger than the "assume the spell's values" move the original ruling forbade: spell equals (+4 morale to attack rolls, saves, skill checks) plus (temporary hit points) plus (immunity to fear); the passive item form is the spell minus the last two; the remainder is the +4 morale portion.

**It also vindicates this ruling's own counter-evidence.** The 2026-08-05 entry argued that Legendary Cloak of Victory listing `Immunity to Fear` as a separate enchantment signalled the item form is not simply "the spell, permanently." The wiki now says exactly that. That reasoning was correct and should not be re-litigated.

**The scope is narrower than the whole affix.** The sentence governs items carrying it as a **passive enchantment** only. The carrier table also lists charged forms — Planar Gird and Draconic Necklace read `Greater Heroism — 1 Charges`, Planar Lariat `3 Charges` — which this ruling does not cover. The dataset already separates these: `Greater Heroism` 16 records, `Greater Heroism clicky` 4 (re-counted 2026-08-25, unchanged since the original entry).

**Why the components still cannot be written.** Each of these is an internal modelling decision, not a missing source:

1. **`Morale` is not a bonus type this dataset models.** Zero instances across the catalog; it is absent from the 29 types in use. Writing `+4 Morale` would introduce a new stacking bucket, and a bucket admitted without examining its stacking is the precise shape of the defect recorded in `a-dated-coverage-claim-cannot-notice-its-own-staleness.md` — an unexamined type there credited +24 Universal Spell Power permanently for a buff that requires being hit. This is a solver-semantics change, not a data write.

2. **"Skill checks" is an unbounded fan-out.** Skills are modelled individually — Balance, Bluff, Diplomacy, Hide, Jump and the rest — alongside curated umbrella names like `Alluring Skills Bonus`. Nothing in the vocabulary means "every skill," so the phrase has no single target and expanding it by hand would invent a grouping the catalog does not carry.

**The attack-roll third has a target already — do not re-derive this.** `Accuracy` is the catalog's name for a general attack bonus (249 instances), and `data/seed/compendium/affix_synonyms_registry.json` registers `Attack`, `Hit` and `Attack Bonus` as its synonyms. A search for an affix literally named "Attack Bonus" finds only the `Sneak Attack` family and reads as an absence; it is not one. (Separately, and out of scope here: `vocab.canonical` does not resolve that seed registry, so `Attack Bonus`, `AC` and `Acid Spellpower` all pass through unresolved and unknown in the picker. That is a vocabulary gap in its own right, adjacent to #229, and it has nothing to do with this affix.)

**What would actually unblock it now** — in dependency order, and note both are prerequisites rather than parts of this affix:

- a ruling on whether `Morale` becomes a modelled bonus type, and what it stacks with — **#569, RULED 2026-08-28**;
- a decision on how an all-skills grant is represented, which `Alluring Skills Bonus` and its siblings may already answer — **#570, RULED 2026-08-28**.

Only after those two does writing this affix's components become a data task — and the attack-roll third could then land on `Accuracy` directly. Until then the `Bool` presence behavior is the correct shipped state, and it is targetable, so a player who wants the effect can still rank it.

### RESOLVED 2026-08-28 (#140) — both prerequisites ruled, components written

Both rulings are recorded with their wiki sources, and the write shipped in the
same day's build (`08282026.3`).

| Third of the grant | Target | Ruling |
|---|---|---|
| `+4 morale` (the bonus type) | `Morale`, its own stacking bucket, no equivalence entry | `morale-bonus-type.md` (#569) |
| attack rolls | `Accuracy` | already settled above — do not re-derive |
| saves | `SAVES` | already an expansion target |
| skill checks | expands into the wiki's **21** skills | `all-skills-grants.md` (#570) |

**What the write actually turned out to involve** — recorded because two of the
three things forecast above were wrong in instructive ways:

1. **The disposition guard could not see the type at all.** Forecast: adding
   `Morale` to `bonus_type_dispositions.json` would be *required* or the build
   goes red. Reality: this affix decomposes at the `web/dataset.js` normalize
   seam, so its type never reaches `web/data/items.json`, and the guard reads
   only that. It would have stayed silent — and its staleness arm would have
   *rejected* the correct entry. Both are fixed: `COMPOSITE_COMPONENT_TYPES` is
   now a flat literal the Python guard reads, pinned against the live table by
   `tests/dataset.test.js`. Full account in `morale-bonus-type.md` §5.

2. **One premise-assertion went stale, not two.** `tests/wizard.test.js` reads
   `normalizeDataset(...)`, so its "no shipped item carries a Morale-typed affix"
   premise broke exactly as predicted; `tests/model.test.js` never touched the
   dataset and was unaffected. The wizard test now covers **both** halves — Morale
   as the *displacing* case, and a separate test holding AE4's additive-only case
   on the credit types that still carry no gear (`Alchemical`, `Primal`), asserted
   dynamically so it fails loudly rather than silently covering nothing.

3. **The shadow rule was wrong for this affix, and had to be fixed first.**
   Not forecast at all. `COMPOSITE_COMPONENTS` suppressed a derived component
   whenever the item stated that *name*, regardless of bonus type. That is safe
   only while a component collides within one bucket. Greater Heroism's
   components are `Morale` on common stats, so a carrier stating
   `Accuracy Competence 10` or a Resistance save was silently dropping a +4 that
   genuinely stacks — five component instances across three of the 16 carriers.
   The key is now `(name, bonus type)`, which `src/enchantment_split.py` already
   documents as the right shape for its Python-side equivalent. Measured: the
   change moves **zero** components for the three composites that shipped before
   this one.

**`all skills` was NOT registered in `src/spell_focus.py`.** The roster lives in
`web/dataset.js` as `_ALL_SKILLS`, because this affix decomposes at the
normalizer, not in the build pipeline. The allowlist registration stays unclaimed
until a build-time carrier for the phrase exists.

**Golden ratification.** Five of 24 fixtures moved, every delta exactly +4, and
**every `chosen` loadout byte-identical** — the solver was already picking these
carriers on their other affixes and simply not counting this one. Details in the
`#140` entry in `tests/solver_golden.test.js`.

**One thing this re-harvest could not establish.** Whether that items-section sentence is new since 2026-08-05 or was present and missed. The wiki's page history is login-gated and returned a permission error, so the provenance of the sentence is unknown. Recorded rather than guessed — if it was missed, the harvest method has a gap worth finding; if it is new, nothing was done wrong.

---

## Concealment stacking — the rule that makes entries 1 and 2 safe

**Source:** https://ddowiki.com/page/Concealment

> Generally, multiple concealment bonuses of the same type do not stack, whether beneficial or offensive in nature, only the greatest concealment number applies. Currently almost all of them use the same bonus type - enhancement.

This maps exactly onto the optimizer's existing bucket semantics: same `name || equivType(type)` keeps the **max**, never the sum. Writing both Blurry and Lesser Displacement as `Concealment | Enhancement` therefore reproduces in-game behavior — an item with each does not yield 45% concealment, it yields 25%.

**Two documented exceptions, both out of scope for U5** (neither is an item affix this batch touches):

- Shadowdancer Tier 3 *Depths of Darkness* (+25%) stacks with the highest enhancement bonus to concealment.
- The *Twilight's Cloak* sentient filigree set grants an extra 5% at 5+ filigrees.

Filigrees are already outside the optimizer's modeled scope, and the Shadowdancer enhancement is a destiny ability rather than gear. Recorded here so a later pass does not re-derive them.

---

## Consequence for U5

- **Write three composites**, five component affixes total.
- **`Concealment` must be minted into the picker vocabulary** (KTD4b — union into `CORE_STATS` in `build_dataset.py`). It appears in neither `metadata.rankable_affixes` nor `metadata.affix_registry` today, so without that step the components would be written and still be unrankable.
- `Healing Amplification`, `Melee Power`, and `Ranged Power` already exist and need no minting.
- **Greater Heroism is dropped from U5** per the quarantine above. The plan's per-composite drop-out case covers this; U5 is not empty, so no unit is cancelled.
