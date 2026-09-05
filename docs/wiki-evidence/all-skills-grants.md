# How an all-skills grant is represented — RULING

**Established:** 2026-08-28 (issue #570)
**Question:** How is a grant covering *every* skill represented, given skills are modelled individually?
**Source:** https://ddowiki.com/page/Skills (renders as `Skill`), §"List of Skills"
**Guarded by:** `tests/test_all_skills.py`

**Ruling: an all-skills grant EXPANDS into the 21 concrete skills the wiki
enumerates**, following the `charisma skills` precedent — not a single rankable
name. The list is sourced from the wiki's own all-skills table, **not** assembled
from the six ability umbrellas.

---

## 1. The wiki enumerates "all skills" outright — this is the citation

#570 asked for a citation for an all-skills list, "since 'all skills' needs its
own source rather than being assembled from six tooltips that each answer a
different question." The `Skill` page has one. Its *List of Skills* section is
prefaced:

> Not all Pen & Paper skills are included in DDO, and some traditional skills
> have been modified to fit DDO. This table describes all the skills present in
> DDO.

That is an explicit completeness claim by the source, about the exact population
in question. The table has **21 rows**, read structurally from its `Skill`,
`Ability` and `Affix` columns on 2026-08-28:

| Skill | Ability | Wiki `Affix` column |
|---|---|---|
| Balance | Dexterity | Balance |
| Bluff | Charisma | Bluff |
| Concentration | Constitution | Inner Focus |
| Diplomacy | Charisma | Eloquence |
| Disable Device | Intelligence | Disable Device |
| Haggle | Charisma | Haggle, Bartered |
| Heal | Wisdom | Sustenance |
| Hide | Dexterity | Hiding |
| Intimidate | Charisma | Intimidating |
| Jump | Strength | Jump Springing |
| Listen | Wisdom | Listening |
| Move Silently | Dexterity | Silencing |
| Open Lock | Dexterity | Escape |
| Perform | Charisma | Performing |
| Repair | Intelligence | Repairing |
| Search | Intelligence | Minute Seeing, Inspected |
| Spellcraft | Intelligence | Spellsight |
| Spot | Wisdom | Eagle |
| Swim | Strength | Swimming |
| Tumble | Dexterity | Tumbling |
| Use Magic Device (UMD) | Charisma | Use Magic Device (UMD) |

**All 21 are already in `metadata.rankable_affixes`** (measured against the
2026-08-28 build; 217 rankable affixes total). So the expansion needs no new
rankability work — every component it would emit is already a target a player can
rank.

## 2. Expand, do not mint a name

#570 observed the project has two existing shapes for "a grant covering several
skills", and asked which one governs:

- **expand into components** — `charisma skills` → six concrete skills
  (`src/spell_focus.py`);
- **keep one rankable name** — `Alluring Skills Bonus` (61), `Nimble Skills
  Bonus` (28), and siblings.

**Expansion wins, and the second option is not actually available.** The
`* Skills Bonus` family are affix names **gear-planner emits**, read structurally
from the catalog — they exist because the source names them. An all-skills grant
synthesized from a spell-page subtraction has no such name to inherit; inventing
`"All Skills Bonus"` would be minting vocabulary the catalog does not carry, and
it would fail twice over:

1. **It would compete with nothing.** A name nothing else shares keys its own
   bucket, so it could never take a max against a real Balance or Search bonus of
   the same type — the under-modelling the expansion mechanism exists to fix.
2. **It would be invisible to the player who ranked the skill.** Someone ranking
   `Use Magic Device` would get no credit from an item granting every skill,
   which is the wrong answer to the only question they asked.

This is the same reasoning that put `SAVES` behind `all saving throws` rather
than a single "Saves" name.

## 3. The list is 21, and it must NOT be built from the six umbrellas

The six ability umbrellas in `src/spell_focus.py` union to **20**. The gap is
exactly one skill — **`Swim`** — and #570 measured this correctly.

**Do not "fix" `SKILLS_STR` by adding Swim.** `SKILLS_STR = ["Jump"]` traces to a
rendered `{{Skills|Strength|6}}` tooltip that says "Strength based skills of:
Jump", read 2026-08-13. That is a quoted source, and editing it silently
re-scopes every `strength skills` carrier.

**The two wiki sources genuinely disagree, and both are right about their own
question.** The `Skill` page's table assigns Swim to Strength; the `{{Skills}}`
tooltip omits it. The tooltip describes *what that item enchantment grants*, and
the table describes *what skills exist*. An all-skills list built by unioning six
enchantment tooltips would inherit whichever skills no enchantment happens to
cover, and silently drop `Swim` — which is precisely why #570 insisted the list
carry its own citation. It does, in §1.

`Swim` is a real, live target: the `Diamond of Swim` augment family and the
`Lunar/Solar Gem of Jump and Swim` gems carry it, and it is rankable today.

## 4. The completeness claim is a guard, not a date

Per `a-dated-coverage-claim-cannot-notice-its-own-staleness.md`, §1's claim
("these 21 are all the skills, and all 21 are rankable") is asserted on every
build by `tests/test_all_skills.py`, which pins:

- all 21 named skills appear in `metadata.rankable_affixes`;
- the six `spell_focus` umbrellas union to exactly the 21 **minus `Swim`** — so
  an edit to any umbrella that drifts from this ruling goes red rather than
  quietly re-scoping the all-skills list;
- the roster is non-empty and is exactly 21, so the guard cannot pass by
  inspecting nothing.

## Scope

Ruling only, as written 2026-08-28. **Nothing was registered in `spell_focus.py`'s
allowlist here**, and that was deliberate: no affix in the built catalog carried
an all-skills phrase in its NAME (measured — zero matches for `all skills` /
`skill checks` across every affix name), so a registration would have had no
carrier. The first consumer was #140's `Greater Heroism` write, alongside the
`Morale` type (`web/dataset.js` `_ALL_SKILLS`, expanded at load time because
that affix is a Bool composite).

The other prerequisite for that write was `morale-bonus-type.md` (#569).

### 2026-09-05 — the roster's first build-time registration (#717)

The measurement above was about affix NAMES, and the all-skills phrase turned out
to live in a TOOLTIP: `Good Luck +2: This item gives a +2 Luck bonus to all saves
and skill checks.` (`Item:Ancient_Gemstone`, harvested 2026-09-04 by #713). A
player reported the Luck bonus missing from both saves and skills, and it was —
`Good Luck` was rankable as its own name and expanded nowhere.

The roster now lives in `src/spell_focus.py` as `ALL_SKILLS`, and `good luck` is
registered in `_UNIVERSAL` as `SAVES + ALL_SKILLS` (24 components, type Luck).
`tests/test_all_skills.py` keeps its own copy of the 21 as the wiki citation and
pins the module's list equal to it, so the expansion cannot drift from the
ruling it cites. `web/dataset.js`'s `_ALL_SKILLS` is the same list for the
load-time composite; three copies, two guards.

**§2's description of the `* Skills Bonus` family as "keep one rankable name" was
a description of the shipped state, not a ruling that it was right.** #718
expands those four to their own tooltips' lists (see
`umbrella-adjudication-sweep.md`). The reasoning in §2 — a name nothing shares
keys its own bucket and is invisible to the player who ranked the skill — was
always the argument for expanding them too.
