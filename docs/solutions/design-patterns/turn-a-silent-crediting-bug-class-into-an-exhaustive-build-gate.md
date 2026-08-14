---
title: "Turn a recurring silent-crediting bug class into a build-failing detector with a curated adjudication registry"
date: 2026-08-14
category: design-patterns
module: data-pipeline
problem_type: design_pattern
component: tooling
severity: high
tags: [umbrella-affix, detector-gate, review-queue, closed-adjudication-vocabulary, stale-ruling-check, candidate-universe, silent-zero, build-failing-guard]
related_components:
  - vocabulary
  - build_dataset
  - spell_focus
applies_when:
  - "A bug class recurs as one-off fixes, each added only after a user report of silent zero-crediting"
  - "A name can grant exactly what a consumer asked for under a different name, with no error or warning"
  - "Designing a detector whose candidate universe must equal the full consumer surface, not any one channel"
  - "Deciding between auto-expansion and a human review queue when name shape can lie"
  - "Curating a rulings seed that must never drift against the mechanism registry"
---

# Turn a recurring silent-crediting bug class into a build-failing detector with a curated adjudication registry

## Context

The optimizer credits an affix only when its NAME matches a ranked target (`src/vocabulary.py:699-701`: "`web/model.js` credits an affix only when its NAME matches a ranked target, so an affix granting exactly what the player asked for under a different name contributes zero, silently"). DDO's item vocabulary is full of umbrella names — `Spell Focus Mastery` grants all seven school DCs, `Resistance` grants all three saves, `Charisma Skills` grants six skills — so a player ranking `Necromancy Focus` got zero credit from every `Spell Focus Mastery` item, invisibly. The loadout still solved; it was just wrong, and indistinguishable from right.

Eight umbrella families were discovered this way, each after a player report, each fixed by adding another one-off expansion module (the eight-mechanism table in issue #211; the count at `src/vocabulary.py:701`). The #205 post-mortem quantified the stakes: 232 affix instances of `Spell Focus Mastery` credited nothing to any school priority for the life of the feature (`build_dataset.py:1009-1011`).

PR #310 (merged, closes #211) stopped treating each new umbrella as a fresh bug and generalized the *class*: a detector that runs at dataset build, flags every name that *could* be an umbrella, and fails the build until each is resolved — either modeled by a registered expansion mechanism or ruled `atomic` in a curated, evidence-carrying seed (`data/seed/compendium/umbrella_adjudications.json`, 30 rulings). The detector's first sweep found **twelve new umbrella family entries** (nine tooltip-distinct bundles — three entries are set-channel re-wordings of `Resistance`/`Combat Mastery`) that the eight one-off fixes had never caught — including `Resistance` at 245 affix instances, larger than the original #205 incident (`docs/wiki-evidence/umbrella-adjudication-sweep.md`).

The pattern generalizes: any system where a rankable/queryable vocabulary is matched by name against sources that may bundle or alias values under different names has this latent class — search facets vs. tagged content, metric names vs. emitter aliases, permission names vs. role bundles.

## Guidance

**1. Detect the class, don't fix the instance.** When the same silent-miss shape has recurred (here: eight times), build a signal that flags *candidates* mechanically. Use two complementary signals:

- **Sibling axis:** when a registered expansion family's components share a head-word (`Abjuration Focus` … `Transmutation Focus` → head-word `Focus`), any OTHER rankable name containing that head-word as **any word** is a candidate. Not last-word — `src/vocabulary.py:777-781`:

  ```python
  # ANY word, not just the last: `Spell Focus Mastery` must be caught by
  # the Focus family's axis even though its final word is `Mastery` —
  # last-word matching would have missed exactly the #205 name this
  # detector exists to catch.
  by_head = any(w in heads for w in (name or "").split())
  ```

- **Name-shape complement:** a weaker regex for umbrella-sounding spellings that have no sibling family yet — `_UMBRELLA_SHAPE_RE = re.compile(r"^(All |Universal |Elemental )|( Mastery$)", re.I)` (`src/vocabulary.py:724`). It is "strictly weaker than the sibling axis (catches `Spell Focus Mastery`, misses bare `Spell Focus`) but the only signal for a family-less umbrella" (`src/vocabulary.py:721-723`).

**2. The detector emits a review queue, never an auto-fix.** Name shape lies: `Universal Spell Lore` *genuinely stacks* with element lores per the standing spell-lore ruling, so auto-collapsing on name shape would be a regression, not a fix (`src/vocabulary.py:709-711`, `src/spell_focus.py` module docstring's "Spell **lore** of any kind" exclusion). Every candidate goes to a human adjudication against the primary source.

**3. Closed adjudication vocabulary with a structural no-drift rule.** The seed's disposition vocabulary is closed at `['atomic']` — a name a mechanism models must NOT carry a seed entry, because its registration (e.g. in `src/spell_focus.py` `_UNIVERSAL`) already resolves it (`src/vocabulary.py:804-808`). This makes seed-vs-mechanism disagreement *structurally impossible*: there is no seed spelling that can claim "modeled" while the registry says otherwise, and a name moving between states (newly modeled, or dropped from the roster) trips the stale check (`src/vocabulary.py:816-823`), which demands the entry be retired deliberately, "never leave it asserting a ruling about a name the detector no longer asks about."

**4. Every ruling carries verbatim primary-source evidence.** Each of the 30 `atomic` entries in `data/seed/compendium/umbrella_adjudications.json` records the rendered tooltip, the template invocation, the observing item, and the harvest date — and an atomic ruling missing its evidence or date fails the build (`src/vocabulary.py:810-814`):

  ```json
  "Armor Mastery": {
   "disposition": "atomic",
   "evidence": "Armor Mastery +2: Passive: +2 Enhancement bonus to the Max Dex Bonus of your equipped light, medium, or heavy armor. ...",
   "source_invocation": "{{Armor Mastery|2}}",
   "observed_on": "Item:Daggertooth's Belt (level 12)",
   "harvested": "2026-08-13"
  }
  ```

**5. Refuse to pass on zero.** Per the repo's prove-a-guard convention, a detector that flags nothing over a non-empty vocabulary raises rather than passing — "the signal set is broken, not clean" (`src/vocabulary.py:831-834`, a `ValueError` after all candidates resolve). A guard that can vacuously green is worse than no guard, because it retires vigilance.

**6. The candidate universe must equal the FULL consumer surface.** The detector's universe is "the PICKER's" — worn rankable names PLUS every crafting pool's affix names PLUS the set-definition channels (`src/vocabulary.py:727-750` `pool_affix_names`, which walks pool records and `set_defs` tiers; wired at `build_dataset.py:1017-1026`). The PR's own review pass proved why: the first universe (worn + pools) let 61 set-channel records escape — `all Saving Throws` (12 set tiers), `Saving Throws` (48 item-attached tiers), and `Tactical DCs` (1 augment-set tier); the 12 + 48 + 1 census is in PR #310's body, the wordings in `docs/wiki-evidence/umbrella-adjudication-sweep.md`. Placement follows from the same rule: the detector runs only AFTER every pool is built (`build_dataset.py:1013-1016` — "`Constitution Skills` lives only in the Nearly-Complete Skill menu and was invisible to a worn-only sweep"). This is the repo's #293 channel incident recurring at the detector level: coverage of one channel is not coverage of another.

**7. Iteration converges — let the gate force every wave to rulings.** Each registration can mint new candidates: registering the skill families made `Repair` a component head-word, which flagged `Repair Lore`, `Repair Intensity`, and `Repair Amplification` — all ruled atomic (cross-axis false positives of the any-word signal, per the sweep doc). This is not churn; it is the gate doing its job — every wave of new candidates must reach a ruling before the build goes green, and the process terminates because rulings are durable. The first full run cost ~30 rulings and paid for itself immediately with twelve live families.

Confirmed umbrellas land in the mechanism registry, not the seed: `src/spell_focus.py` `_UNIVERSAL` (lines 171-199) now holds 16 entries — the four pre-existing spell families plus the twelve the sweeps found (`resistance`, `elemental resonance`, `combat mastery`, three set-channel wordings, and six ability-skills families).

## Why This Matters

- **The nth one-off fix has negative expected value.** After eight player-reported instances, the class was known; each additional one-off left the remaining unknown members live. The detector's first sweep found a family (`Resistance`, 245 instances) *larger than the incident that named the class* — meaning the worst member was still in production after eight fixes.
- **Silent zeros are the worst defect shape.** A wrong loadout is indistinguishable from a right one; only a player who happens to cross-check a specific item's tooltip ever files the report. A build gate converts "discovered by a player, eventually, one family at a time" into "cannot ship unresolved."
- **The no-drift rule is structural, not procedural.** Registries curated by hand rot when they can restate what code already knows. Making "modeled" *unrepresentable* in the seed means the two sources cannot disagree, and the stale check turns every state transition into a deliberate, reviewed act.
- **Evidence-per-ruling makes the registry auditable and un-relitigatable.** Standing rulings like `Deific Focus` (a conditional ramping buff that looks universal but is not) are seeded precisely so they are never re-raised — the tempting wrong "fix" is pre-refuted in the entry itself.
- **The universe lesson compounds.** Two separate incidents in this repo (#293, then the detector's own review pass) had the identical root cause: a guard covering one data channel while consumers read several. Enumerating the consumer's full surface — and running the check after that surface is fully constructed — is the transferable fix.

## When to Apply

Apply this pattern when:

- The same "credited/matched under name A, granted under name B, result silently zero" defect has shipped more than twice, each discovered by a downstream consumer rather than a check.
- You can enumerate a *signal* for candidates mechanically (shared head-words with known families, naming conventions like `All `/`Universal `/` Mastery`), but resolving a candidate requires judgment against a primary source.
- A registered-mechanism table already exists (expansion families, alias maps, cross-add sources) whose membership can anchor the sibling-axis signal and define "already modeled."
- The vocabulary keeps growing (new data batches, new channels), so a point-in-time audit would immediately go stale — the gate must run on every build.

Calibrate these choices when applying:

- **Match breadth:** prefer any-word over last-word matching for the sibling axis; accept the false positives (they cost one ruling each) to avoid missing the exact names the detector exists for.
- **Never auto-fix from the signal:** if even one known case exists where the name-shape reading is wrong (like `Universal Spell Lore`), auto-collapse is a regression engine.
- **Universe = union of every consumer channel**, computed after all channels are built; re-audit the universe whenever a new channel is added.
- **Keep the ruling vocabulary minimal and closed.** Only states a mechanism cannot express belong in the seed; everything else must live in (and be resolved by) the mechanism registry.

Do NOT apply when the resolution is itself mechanical (then just fix the normalization — no human queue needed), or when the vocabulary is small and closed enough that a one-time exhaustive audit with a snapshot test suffices.

## Examples

**The gate in place** — `build_dataset.py:1026-1032`, after every pool and set-def channel is constructed:

```python
_umbrella_universe = sorted(set(_rankable_list) | _pool_names)
_umbrella_queue = vocabulary_mod.umbrella_candidates(
    _umbrella_universe, _family_components, _modeled_names)
_umbrella_report = vocabulary_mod.check_umbrella_adjudications(
    _umbrella_queue,
    vocabulary_mod._load(vocabulary_mod.UMBRELLA_ADJUDICATIONS_PATH),
    _umbrella_universe)
```

An unresolved candidate raises `SystemExit("umbrella detector failed: ... unadjudicated umbrella candidates (each is a latent #205 until ruled): ...")` (`src/vocabulary.py:824-830`); the report is disclosed in the built dataset's meta (`build_dataset.py:1278-1282`).

**A confirmed umbrella vs. an atomic ruling.** `Combat Mastery` ("+7 Enhancement bonus to the DC to resist ... Trip, ... Stunning Fist attempts", 136 instances) was confirmed a bundle and registered in `_UNIVERSAL` (`src/spell_focus.py:184`) — so it carries NO seed entry. `Armor Mastery` ("+2 Enhancement bonus to the Max Dex Bonus of your equipped ... armor") matched the same ` Mastery$` shape but is one real stat — it carries the atomic seed entry quoted above and expands to nothing. Same signal, opposite dispositions, both grounded in a verbatim tooltip: that asymmetry is why the detector queues instead of fixing.

**Convergence in practice.** Registering the six ability-skills families (found because `Constitution Skills` exists only in a crafting menu, never on worn gear) made each skill a family component — so `Repair` became a head-word, flagging `Repair Lore`/`Intensity`/`Amplification` on the next run. All three were ruled atomic in one pass (`docs/wiki-evidence/umbrella-adjudication-sweep.md`, "Cross-axis false positives of the any-word signal"). The gate turned a potential whack-a-mole into a terminating loop: candidates can only move to *ruled* or *modeled*, and both states are durable.

## Related

- `docs/solutions/design-patterns/universal-stat-expansion-family.md` — the per-family REMEDY layer beneath this pattern (expand / cross-add / record-only, the `_UNIVERSAL` table, via-stamping, per-channel guards). This detector enumerates the candidates and forces each through that doc's classification; a confirmed umbrella lands there, never in the seed.
- `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md` — the guard-verification discipline this gate instantiates: refuse-zero is its rule 2, and the universe-must-cover-every-channel lesson is its rule 4 with a mechanism attached.
- `docs/solutions/conventions/exclude-until-verified-data-gates.md` — the seed follows its admission discipline (evidence-gated entries) with the default INVERTED: an unadjudicated candidate fails the build loudly, rather than shipping inert.
- `docs/solutions/conventions/golden-fixtures-resolve-aliases-like-saved-builds.md` — the downstream fixture convention; PR #310 extended the same resolve-through-the-app's-own-migration principle to declared stat credits (`migrateCredits`, full-grant allowlist only — an `Elemental Resistance` credit must not fabricate a Sonic component).
- `docs/wiki-evidence/umbrella-adjudication-sweep.md` — the first sweep's full results and rulings.
- Issues: #211 (closed by PR #310, the source), #205 / #249 / #290 / #293 (the one-off instances that preceded the class fix).
