# gear-planner canon migration — vendoring + re-freeze report (#374, U4)

**Date:** 2026-08-18 · **Plan:** `docs/plans/2026-08-18-001-fix-gear-planner-canon-migration-plan.md` (U4)
**Status: BLOCKED.** The data is vendored and all four registries are re-frozen, but the build does not
complete. The refresh arms two aliases U3 deliberately declined to mint, and then cascades into five
further curated-shard adjudications that no unit in the plan owns. Every finding below is measured
against the vendored snapshot, not predicted.

---

## 1. Vendoring

**Upstream commit:** `767a7f747d0e7d211a702b8c456348e1c36ba699` (`illusionistpm/ddo-gear-planner`,
`master`, authored + committed 2026-08-18T03:58:14Z, `[auto-update] Latest data`).
Previous stamp: `ec3e595d0d879b29c13f3c34ffc155e71d0418c4` (2026-08-01) — 17 days stale.

SHA resolved first, then every file fetched **pinned to that SHA**, never from `master`, so an upstream
push mid-import cannot mix commits:

```
git ls-remote https://github.com/illusionistpm/ddo-gear-planner master
# 767a7f747d0e7d211a702b8c456348e1c36ba699  refs/heads/master

SHA=767a7f747d0e7d211a702b8c456348e1c36ba699
BASE=https://raw.githubusercontent.com/illusionistpm/ddo-gear-planner/$SHA/site/src/assets
curl -sSfL -o data/seed/compendium/raw/gearplanner_items.json          $BASE/items.json
curl -sSfL -o data/seed/compendium/raw/gearplanner_crafting.json       $BASE/crafting.json
curl -sSfL -o data/seed/compendium/raw/gearplanner_sets.json           $BASE/sets.json
curl -sSfL -o data/seed/compendium/raw/gearplanner_affix_synonyms.json $BASE/affix-synonyms.json
```

`site/src/assets/nearly-finished.json` is deliberately **not** vendored — that is #371, out of scope.

`assert_freshness` reads only the hand-written `upstream_commit` string in `SOURCE.json` and never
inspects the raw files, so it cannot corroborate the vendoring. The pinned-SHA fetch is the mitigation;
the guard is only a stamp check. Verified both directions:

| check | result |
|---|---|
| `assert_freshness('767a7f7…')` | returns the commit — pass |
| `assert_freshness('ec3e595…')` (old stamp) | `FreshnessError: raw mirror commit '767a7f7…' != expected 'ec3e595…' — re-import` |

**Raw population deltas.** `SOURCE.json` updated first, before any other edit.

| file | old | new |
|---|---|---|
| items (raw records) | 8188 | 8190 |
| crafting pools | 83 | 83 |
| set defs | 282 | 282 |
| affix-synonym entries | 46 | 69 |

The +2 net item movement is 14 added / 12 removed, all attributable to upstream's scraper:
7 `Flame Blade (level N)` tiers added; the `… of Doublestrike N` shield/dart family renamed to
`… of the Oozing Hunger` (7 pairs); `Allegiance (historic)`, `Legendary Sceptre`, `Potent 49 Sceptre`
retired; and one doubled name (`Legendary Dart of the Oozing Hunger of the Oozing Hunger`) de-duplicated.
The +364 KB of item data is therefore *affix detail on existing items*, not new items.

---

## 2. The upstream change nobody modelled: the type-field re-encoding

This is the largest finding in the refresh and the root cause of four of the six gates that fire.
**Upstream changed how it encodes "no bonus type".** It used to omit the `type` key; it now emits a
literal string.

| encoding | old snapshot | new snapshot |
|---|---|---|
| `type` key absent | 5709 | 90 |
| `"type": "Untyped"` | 148 | 886 |
| `"type": "Bool"` | 8554 | 13088 |
| total affix dicts (items+crafting+sets) | 33865 | 39642 |

Roughly 5,619 previously key-less affixes were re-encoded, overwhelmingly into `Bool` and `Untyped`.
Four measured consequences:

1. **`iter_affixes` now sees them.** The walk requires `name` + `type` + `value` together, so those
   affixes were invisible to the referential-integrity gate and to `armed_canon_variants`. `Ki` goes
   from 0 gate-visible occurrences to 20 (19 items + 1 crafting). This — not any per-name decision —
   is why **#229's mask is gone**, exactly as the plan predicted but for a structural reason.
2. **`build_dataset.rankable_affixes` tests `untyped = bt in (None, "")`** (`:458`). The literal
   `"Untyped"` is neither, and it is not in `("boolean","Bool")` nor `NON_RANKABLE_TYPES`, so 886
   affix occurrences now fall through as **rankable stats carrying a bonus type of `"Untyped"`** —
   the population the repo deliberately excludes as procs/banes. 148 already leaked this way before
   the refresh; the refresh multiplies it ~6×. This is solver-visible and needs a ruling.
3. **`untyped_rankable.assert_adjudicated`** walks the same empty-type candidate predicate. 35 of its
   43 entries (including the `Enhanced Ki` allow entry) now match nothing.
4. **`utility_procs`** — the whole ~118-name weapon-proc adjudication is stale for the same reason.

---

## 3. Fold-diff adjudication (`check_affix_synonyms`)

Upstream's table moves **46 entries / 94 folds → 69 entries / 145 folds**. `check_affix_synonyms`
raises on the FIRST added/removed/re-pointed fold in sorted order, so the diff was computed offline
and adjudicated in full before the registry was re-frozen once, as one act.

Occurrence columns are `items/crafting/sets` counts in the **refreshed** raw.

### 3a. Added folds — 58

**Verdict: no added fold can merge two mechanics we treat as distinct. 57 of the 58 have ZERO
occurrences of their fold KEY anywhere in the refreshed raw** — they are historical-spelling aliases
upstream added defensively alongside its rename, not live merges. A fold whose key occurs nowhere
cannot move a record.

| group | count | example | key occ | adjudication |
|---|---|---|---|---|
| **Flipped canon** — our enchantment name on the *synonym* side | 11 | `Combustion` → `Fire Spell Power` | 0/0/0 | 10 are in `vocabulary.PROTECTED_CANON` and dropped by `_suppressed_upstream_folds` (KTD4). **`Legendary Conditioning` → `False Life (%)` is NOT** — see §6.3 |
| **`Spellpower` → `Spell Power`** orthography | 11 | `Fire Spellpower` → `Fire Spell Power` | 0/0/0 | Same mechanic, one-word vs two-word spelling. Accept |
| **Element-name synonyms** | 4 | `Ice Spell Power` → `Cold Spell Power`, `Magnetic` → `Electric Spell Power` | 0/0/0 | Same mechanic. Accept |
| **`Spell Crit Damage` → `Intensity`** rename | 7 | `Force Spell Crit Damage` → `Kinetic Intensity` | 0/0/0 | Upstream renamed the crit-damage family. Accept |
| **`X Intensity` consolidation** | 13 | `Combustion Intensity` → `Fire Intensity` | 0/0/0 | Accept |
| **Lore renames** | 11 | `Corrosion Lore` → `Acid Lore`, `Nullification Lore` → `Negative Lore` | 0/0/0 | Accept; `Ice Lore`/`Void Lore` keys are protected and suppressed |
| **Abbreviation** | 1 | `UMD` → `Use Magic Device` | 0/**3**/0 | The ONLY live added fold. Same skill; `Use Magic Device` occurs 46/6/0. Accept |

**Merge-risk check, done explicitly (this is the #154 question).** Three added folds send two different
keys to one canonical:

- `Light Spell Crit Damage` **and** `Alignment Spell Crit Damage` → `Radiance Intensity`
- `Force Spell Crit Damage` **and** `Physical Spell Crit Damage` → `Kinetic Intensity`
- `Negative Spell Crit Damage`, `Poison Spell Crit Damage` **and** `Negative and Poison Spell Crit Damage` → `Void Intensity`

These are not merges of distinct mechanics — they are the DDO spell-lore groupings the wiki itself
uses, already recorded in `docs/wiki-evidence/spell-lore.md`: Radiance Lore covers Light **and**
Alignment, Kinetic Lore covers Force **and** Physical, Void Lore covers Negative **and** Poison.
All six keys occur 0/0/0 regardless, so nothing moves today either way.

### 3b. Removed folds — 7

| fold | key occ in new raw | canonical occ | adjudication |
|---|---|---|---|
| `Fortification bypass` → `Armor-Piercing` | 0/0/0 | 182/14/19 | Dead key. Upstream retired a fold that was already a no-op. No second bucket possible. Accept |
| `all Ability Scores` → `Well Rounded` | 0/0/0 | 87/4/24 | Same. Accept |
| `all spell DCs` → `Spell Focus Mastery` | 0/0/0 | 227/35/40 | Same. Accept |
| `hit` → `Accuracy` | 0/0/0 | 233/52/21 | Same. Accept |
| `Negative Lore` → `Void Lore` | 92/5/7 | 0/0/0 | **The flip.** Direction reversed; our canon leaves raw. Handled by the `Negative Lore` → `Void Lore` name correction + `local_affix_names` mint |
| `Negative Spell Power` → `Nullification` | 153/22/8 | 0/0/0 | The flip. Same handling |
| `Positive Spell Power` → `Devotion` | 168/22/14 | 0/0/0 | The flip. Same handling |

### 3c. Re-pointed folds — 6

**Every re-pointed key occurs 0/0/0 in the refreshed raw, so all six are inert and no mechanic moves.**

| key | was | now | adjudication |
|---|---|---|---|
| `Force and Physical Spell Crit Damage` | `Force Spell Crit Damage` | `Kinetic Intensity` | Target renamed, same mechanic |
| `Light and Alignment Spell Crit Damage` | `Light Spell Crit Damage` | `Radiance Intensity` | Target renamed, same mechanic |
| `Negative Spell Crit Chance` | `Void Lore` | `Negative Lore` | The flip, on a non-protected key. Inert today; see §6.3 for the class |
| `Positive Spellpower` | `Devotion` | `Positive Spell Power` | The flip, non-protected key. Inert today; same class |
| `Sunder DCs` | `Sunder` | `Sundering` | Target renamed |
| `Trip DCs` | `Trip` | `Vertigo` | Target renamed to the enchantment name (`Vertigo` grants Trip DCs). Consistent with KTD1's own principle |

**Re-frozen** `affix_synonyms_registry.json` in one act: `affix_synonyms` 46 → 69 entries, `count`
94 → 145 folds. The `local_affix_synonyms` section is untouched by the gate by design.

---

## 4. Registry removal attribution (`affix_names` 1441 → 1483: +102, −60)

The gate resolves through the alias map *before* checking membership, so it catches alias
misdirection but never a name **leaving** raw. Every one of the 60 removals is attributed below.

| class | count | names | verdict |
|---|---|---|---|
| **Silent upstream rename of OUR canon — minted by U3** | 11 | `Combustion`, `Corrosion`, `Devotion`, `Glaciation`, `Impulse`, `Magnetism`, `Nullification`, `Resonance`, `Ice Lore`, `Void Lore`, `Damage to helpless enemies` | Covered — all 11 are in `local_affix_names`, all 11 pass `_split_type` with a non-empty stat, none collides with `BONUS_TYPES` |
| **Silent upstream rename of OUR canon — NOT minted** | 1 | `Legendary Conditioning` | **BLOCKING** — see §6.1 |
| **Fold-away: helpless-family consolidation** | 8 | `Additional Damage to Helpless Targets`, `Damage vs the Helpless`, `Damage vs. Helpless Opponents`, `Damage vs. Helpless opponents`, `Helplessness Damage`, `damage versus the Helpless`, `damage vs the Helpless`, `damage vs. helpless` | `local_affix_synonyms` **synonyms**, not canonicals. Adjudicated in §5 |
| **Legendary-prefix family: upstream adopted our fold** | 4 | `Legendary Accuracy`, `Legendary Armor-Piercing`, `Legendary Deadly`, `Legendary Spell Penetration` | Upstream now emits the BASE name at `type: "Legendary"` (`Accuracy` 14, `Armor-Piercing` 22, `Deadly` 3, `Spell Penetration` 12 items) — i.e. upstream pre-applied exactly what `src/legendary_fold.py` produces. The fold becomes inert (it has no `assert_all_reached`, so this is silent) but the emitted data is unchanged. **No action needed; recorded so a later audit does not read the inert fold as a defect** |
| **Upstream scrape-noise cleanup: bare numerals** | 11 | `+1`, `+3`, `+6`, `+7`, `+9`, `+10`, `+11`, `+13`, `+14`, `+16`, `-1 Enhancement Bonus` | Genuinely retired parse artifacts. `is_noise_affix_name` already filters this class at the emit site |
| **Upstream scrape-noise cleanup: tooltip bleed** | 17 | the 10 `Hidden effect: …` names, the 3 `Spellcasting Implement +15, …` blobs, the 2 `Once every three seconds …` blobs, `Evocation Focus II, Kinetic Lore V…`, `Necromancy Focus II, Void Lore V…`, `See the item description page for details.`, `Silver , alchemical` | Genuinely retired. Upstream fixed its parser |
| **Capitalization normalization** | 2 | `Greater Dragonmark Charge`, `Greater Dragonmark charges` | Upstream settled on `Greater Dragonmark Charges` (present in the new registry). Both old spellings are alias **variants** pointing at it — the alias still resolves. Accept |
| **Genuinely retired / renamed, no repo dependency** | 6 | `Feat: Proficiency: Bastard Sword`, `Feat: Wind through the Trees`, `Ground Lore`, `Litany of the Dead - Ability Bonus`, plus 2 folded above | Referenced only in `vocab_registries.json` itself and the generated artifact. Accept |

**Blocking test, stated precisely.** Twelve removals are simultaneously an alias canonical *and* a
name-correction canonical. Eleven are covered by U3's `local_affix_names` mint. The twelfth,
`Legendary Conditioning`, is not — and that is the blocking case.

**Other registry channels:**

| registry | before | after | movement |
|---|---|---|---|
| `bonus_types` | 43 | 42 | `Maximum dexterity` retired upstream |
| `crafting_slots` (pool keys) | 83 | 83 | unchanged |
| `augments` (affix + option names in colour pools) | 1224 | 1223 | +13 / −14; the substantive pairs are `Shock` → `Electrifying`, `Melee Alacrity` → `Swiftness`, `Greater Dragonmark charges` → `Greater Dragonmark Charges`, plus the 8 flipped spell-power names and 2 retired blobs |
| `crafting_slot_registry` (pool keys ∪ item markers) | 95 | 95 | +12 / −12 — the `Cannith:` → `Essence Crafting:` relabel. **Re-frozen here; U5 owns the allowlist re-curation, the pinned assertions and the KTD1 principle check on the label itself** |
| `augment_registry` (option names only) | 1000 | 1000 | byte-identical; file unchanged |

---

## 5. Gates that fired, and how each was adjudicated

### 5.1 `check_local_synonym_staleness` — FIRED, adjudicated, resolved

Eight of the eleven #305 helpless spellings now match nothing: upstream consolidated the family to
one spelling. Only `Damage vs. the Helpless` (structured affix names) and `damage vs. the helpless`
(Dino free text) still occur.

**Adjudication: retain and allowlist, not retire** — following the precedent of the existing
`Damage vs. Helpless` entry. Every spelling is a recorded wiki wording tabulated in
`docs/wiki-evidence/helpless-damage.md` with the set or item that carries it; upstream re-scrapes
ddowiki near-daily, so a re-harvest or an upstream revert brings the spelling back verbatim, at which
point the fold must already exist or the one mechanic re-splits into two buckets silently.
`check_local_synonym_staleness` is two-directional, so a returning spelling fails the build until its
allowlist entry is dropped in the same commit — the exemption cannot rot.

`unmatched_synonyms` goes 1 → 9, with the reasoning recorded in `unmatched_evidence`.

### 5.2 `check_set_records_spelling` — did NOT fire

As U4 predicted. U2's `_suppressed_upstream_folds` is in the tree, so none of the ten
`PROTECTED_CANON` names is a fold key in `registry_synonym_folds()` (verified directly: all ten
return absent). No wave-through was needed.

### 5.3 `assert_canon_defense` (KTD3) — FIRED. **This is the blocker.** See §6.1

### 5.4 `ml36_augments.check` — FIRED, needs a wiki ruling. See §6.2

### 5.5 `no_drop_source` shard guard — FIRED

Upstream's `quests` field now records a source for six items previously verified as having none:
`Dark Star of the Deep`, `Shards of the Deep`, `Legendary Dark Star of the Deep`,
`Legendary Shards of the Deep` (all → *A Blood Pact*), and `Drow Wizard's Greaves`,
`Legendary Drow Wizard's Greaves` (→ *Stealing from Sorcere*). The guard's remedy is retirement, and
it explicitly calls un-flagging "a manual review event, never automatic" — so these need a wiki
re-verification pass, not a deletion. **Not absorbed.**

### 5.6 `value_corrections` + `affix_type_corrections` staleness — FIRED, fully diagnosed

All 17 item-value corrections and the one affix-type correction are now **upstream-native no-ops**:

| outcome | count | detail |
|---|---|---|
| upstream now reads exactly our corrected `to` value | 14 | e.g. `Legendary Argonnessen Eye Band / Spell Focus Mastery / Equipment` 5→8, upstream now 8 |
| target "absent" only because of the vocabulary flip | 2 | `Fraz-Urb'luu's Reign / Impulse / Quality` 44→43 — upstream carries `Force Spell Power / Quality = 43`; `Zuggtmoy's Reign / Corrosion / Quality` 44→43 — upstream carries `Acid Spell Power / Quality = 43`. Both already at our corrected value under upstream's spelling |
| value adopted **and** re-typed upstream | 1 | `Juiblex's Reign / Acid Absorption` — our corrections said value 16→15 and type `Enhancement`→`Insight`; upstream now carries `Insight / 15` natively. Both the value and the type correction retire together |

**Upstream adopted the 2026-08-13 batch's wiki-verified numbers.** The clean adjudication is to
retire the whole `item_value_corrections.json` payload and the `Juiblex's Reign` type entry — a
verify-first win, and the #207 staleness rule working exactly as designed. **Not absorbed** (it
empties a curated shard; the vacuity behaviour of both guards needs checking in the same change).

**Ordering defect this exposed, worth its own issue.** `value_corrections_mod.apply` runs at
`build_dataset.py:625`, **before** the item-channel `name_corrections_mod.apply` at `:633`. Any
curated shard keyed on one of our protected canon names and applied before line 633 cannot find its
target once upstream flips the spelling. It bit two entries here. KTD2 placed the rename at each
catalog's single load point; for the *item* channel that load point is downstream of two correction
passes.

### 5.7 `untyped_rankable.assert_adjudicated` and `utility_procs` — FIRED

Both are pinned to the old empty-type encoding (§2). 35 of 43 `untyped_rankable` entries and
essentially the whole ~118-name `utility_procs` adjudication no longer match any candidate. Both need
a policy ruling on how `"Untyped"` and `Bool` are read now, not entry-by-entry curation.
**Not absorbed.**

### 5.8 `crafting_coverage` allowlist (U1) — not reached

The build stops before it. The 12 `Cannith:` allowlist entries will fire as stale exceptions once the
earlier gates clear. **That is U5's, per the unit boundary.**

---

## 6. Blocking findings

### 6.1 U3 minted 11 names; the refresh arms 13 — `Legendary Conditioning` and `Enhanced Ki` are undefended

`armed_canon_variants()` against the vendored snapshot returns **13**, matching the plan's Problem
Frame exactly. `assert_canon_defense` fails with both directions of its own message:

```
canon defence does not match the raw snapshot (KTD3):
  'False Life (%)' is ARMED upstream (canonical 'Legendary Conditioning' has left the raw registry)
      but no live canon_defense correction renames it — the canon would import as upstream's
      spelling and score zero
  'Ki' is ARMED upstream (canonical 'Enhanced Ki' has left the raw registry) but no live
      canon_defense correction renames it — …
```

U3's commit body declined both on measurements that were true of the **pre-refresh** snapshot and are
false of this one:

| U3's stated reason | measured against the refreshed raw |
|---|---|
| "`Legendary Conditioning` is native upstream (minting it is a permanent no-op)" | gate-visible occurrences **34 → 0**. Upstream folded the whole family into `False Life (%)`, which goes **2 → 40** (34 items / 2 crafting / 4 sets, all `type: "Legendary"`). It is not native any more |
| "`Enhanced Ki` is untyped and invisible to the gate's walk — #229's territory" | `Ki` gate-visible occurrences **0 → 20**. The type-field re-encoding (§2) made every one of them visible. #229's mask is gone |

The plan itself says both (lines 75–76). The pipeline outcome after minting is stable and verified
safe: `False Life (%)` → `Legendary Conditioning` → `legendary_fold` → `Conditioning` reproduces the
prior canonical for all 40 occurrences, uniformly, and `_split_type('Legendary Conditioning')` yields
`('Legendary', 'Conditioning')` — a non-empty stat, no `BONUS_TYPES` hazard.

**Minimal fix (U3's, not absorbed here):** set `canon_defense: true` on the `Ki` and `False Life (%)`
corrections; add `Enhanced Ki` and `Legendary Conditioning` to `local_affix_names` with evidence; and
add `Legendary Conditioning` to `PROTECTED_CANON` (§6.3).

### 6.2 `ml36_augments` anchors broke, and the re-anchor is a KTD1 question

```
ML36 augment shard guard failed:
  Ruby of Acid (10d6):  [('Acidic','Untyped')]  vs sibling [('Acidic','Bool')]
  Ruby of Flame (10d6): [('Flaming','Untyped')] vs sibling [('Flaming','Bool')]
  Ruby of Frost (10d6): [('Frost','Untyped')]   vs sibling [('Frost','Bool')]
  Ruby of Shock (10d6): [('Shock','Untyped')]   vs sibling [('Electrifying','Bool')]
```

Three are the type re-encoding (§2) and re-anchor mechanically. The fourth is an upstream **rename**:
`Shock` → `Electrifying` (upstream also renamed `Melee Alacrity` → `Swiftness` in the same pools).
Adopting a rename wholesale is precisely what KTD1 exists to interrogate — confirm against the DDO
wiki whether the in-game enchantment on a *Ruby of Shock* reads Shock or Electrifying before taking
upstream's word. **Not absorbed:** no value may be inferred here.

### 6.3 `Legendary Conditioning → False Life (%)` is an unsuppressed flipped fold

`src/vocabulary.py:48–52` states: *"The other three defended names (`Damage to helpless enemies`,
`Legendary Conditioning`, `Enhanced Ki`) are rename-only: upstream carries no fold keyed on them, so
they need no suppression."* **That is now false.** The refreshed table adds
`Legendary Conditioning → False Life (%)`, and `registry_synonym_folds()` carries it (verified):
our canon on the synonym side, exactly the KTD4 hazard, in the one channel — Dino — that applies the
map single-pass.

Latent today (no Dino stat is spelled `Legendary Conditioning`), which is why
`check_set_records_spelling` correctly did not fire. It becomes live the moment a Dino set does.
`PROTECTED_CANON` must gain `Legendary Conditioning`, and the comment above it must be corrected.

The same structural gap exists for folds whose **value** is a generic name we replace
(`Negative Spell Crit Chance` → `Negative Lore`, `Positive Spellpower` → `Positive Spell Power`, and
the whole `X Spellpower` group): `_suppressed_upstream_folds` filters on the fold KEY only. All of
those keys occur 0/0/0 today, so this is a latent widening, not a live defect — recorded rather than
fixed.

---

## 7. Verification evidence

Passing, run against the vendored snapshot and the re-frozen registries:

| check | result |
|---|---|
| `assert_freshness` new commit / old stamp | pass / correctly `FreshnessError` |
| `cross_add.validate_map` on the emitted `_affix_registry` (1494 names) | no `SystemExit` |
| `cross_add` targets **by count** | 20 = all 10 `spell_focus.SPELLPOWERS` + all 10 `cross_add.LORE_ROSTER`; **zero missing on either half** (the lore half omits silently, so count is the only sound assertion) |
| `spell_focus._UNIVERSAL` targets present in the registry | 53/53 |
| no name in both `_UNIVERSAL` key space and its target space | confirmed, empty intersection |
| all 11 minted canon names vs `affix_parser.BONUS_TYPES` | no collision; `_split_type` leaves a non-empty stat for every one |
| `registry_synonym_folds()` suppression | all 10 `PROTECTED_CANON` names absent as fold keys |

**Per-channel generic-name survivors — measured at each catalog's rename seam** (the built artifact
does not exist, because the build is blocked; this is the closest sound substitute and is reported
per pool, never aggregated). Counting all 13 upstream generic names:

| channel | before rename | after rename |
|---|---|---|
| items — raw roster | 1391 | **0** |
| crafting — `crafting_catalog.load_catalog()` (feeds augment / seal / dino / viktranium / nearly-complete / green-steel / thunder-forged) | 251 | **0** |
| sets — `set_catalog.load_raw()` | 140 | **0** |

Not verifiable while the build is blocked, and therefore **not claimed**: the built-artifact grep per
pool, both orphan guards (`set_bonus_orphans`, `set_def_orphans`), and the pinned-population
re-ratifications (`test_overhaul_invariants` `len(items) == 9108`; the 83 crafting pool keys in
`test_vocabulary` / `test_crafting_catalog`). Note the raw pool-key count is **unchanged at 83**, so
that pinned number needs no movement; the item count cannot be attributed until a build completes.

**Golden fixtures were not regenerated** and `solver_golden.test.js` was not re-ratified — U6 owns
that. The build trio was not touched — U7 owns that.

---

## 8. Suite state

`python3 tests/run_tests.py` → **66 failures across 19 modules**, exit 1. The great majority are
downstream of the blocked build (they shell out to `build_dataset.py` or read the built dataset):
`test_build_metadata` 12, `test_vocabulary` 7, `test_seal` 5, `test_provenance` 5,
`test_enriched_set_bonuses` 5, `test_cross_add` 5, `test_name_corrections` 4, then 1–3 each across
`test_planner_import`, `test_no_drop_source`, `test_gap_corrections`, `test_dino`,
`test_untyped_rankable`, `test_nearly_complete`, `test_ml36_augments`, `test_verify`,
`test_utility_procs`, `test_set_catalog`, `test_helpless_fold`, `test_compendium`.

Three failures are **deliberate pre-refresh pins that this unit is supposed to invert**, and they
belong to whichever commit finally lands the refresh:

- `test_vocabulary.test_freshness_reads_and_detects_drift` — pinned to `ec3e595…`
- `test_vocabulary.test_374_armed_canon_variants_is_empty_before_the_refresh_is_vendored`
- `test_vocabulary.test_374_the_local_names_union_is_a_no_op_before_the_refresh`

One is explicitly **U5's** and confirms the unit boundary held:
`test_vocabulary.test_crafting_slot_registry_generates_and_matches_frozen`, which asserts
`"Cannith: Rune Arm - Extra"` is in the generated registry — the label upstream renamed.

The **JS suite was deliberately not run.** `web/data/items.json` is gitignored and generated, and the
blocked build never wrote a new one, so every JS test would be reading the pre-refresh dataset — a
green result there would mean nothing. The golden was not regenerated (U6 owns it).

---

## 9. KTD1 revisit-trigger check (required each refresh)

None of the three triggers fired. No new user report of a player searching upstream's generic name;
the wiki's `Spell_power` / `Spell_Lore` pages are unchanged as the basis for
`docs/wiki-evidence/spellpower-universal.md` and `spell-lore.md`; and the armed set is **13**, well
under the ~20-name threshold at which the override layer's cost was to be re-weighed. KTD1 holds.

---

# U6 — named assertions, then golden re-ratification

## 10. Order, and why it is the point

The 2026-08-17 amendment to
`docs/solutions/workflow-issues/golden-solve-guard-missing-from-local-test-sweep.md` governs this
unit: the two classic re-ratification clauses ("diff contained to expected fixtures" + "no priority
target regressed") **cannot adjudicate a `chosen`-only diff**, and a golden's sanctioned remedy for
a red is to overwrite the objection. So `tests/vocabulary_migration.test.js` (20 named assertions)
was written and run **before** `tests/parity/golden.json` was regenerated, and none of its
assertions reads `golden.json` — re-capturing the golden cannot silence any of them.

`web/data/items.json` was rebuilt from this tree before every capture
(`docs/solutions/workflow-issues/rebuild-the-dataset-before-any-golden-capture.md`).

## 11. What the named assertions found before the golden was touched

Writing the assertions first surfaced **three defects the migration had left live**, each red with
its own message before any golden was regenerated:

| # | Defect | Where | Effect |
|---|---|---|---|
| 1 | The Thunder-Forged and Green Steel pool builders call `crafting_catalog.load_catalog()` a **second time** via their `catalog=None` default, bypassing the canon rename applied at the catalog's single load point | `build_dataset.py` (the `tf_mod.build_thunder_forged()` / `gs_mod.build_green_steel()` call site) | 18 Thunder-Forged records shipped under upstream's generic spellings (`Fire Spell Power`, `Positive Spell Power`, `Negative Spell Power`, `Cold Spell Power`, `Electric Spell Power`, `Acid Spell Power`) while every other pool carried our canon — one mechanic, two buckets. The comment on that rename explicitly claimed it already covered green-steel and thunder-forged; it did not. |
| 2 | `legendary_fold` runs on the item and augment channels but **not** on the set catalog | `build_dataset.py` (sets channel) | Our own `False Life (%)` → `Legendary Conditioning` correction minted the engraved name into the raw set catalog, so 22 set-tier affixes credited a stat name no item affix carries — disjoint from the 36 worn `Conditioning` (Legendary) carriers, reopening the split #376 closed. It also made the engraved name **native**, which deleted its provenance label: a player ranking what the item prints scored nothing. |
| 3 | The `#235` untyped-only predicate reads only the *absent-key* spelling of "untyped" | `web/dataset.js` `buildPickerVocabulary` | This is the **fourth predicate of the shape #380 widened three of**. Upstream now emits the literal string `"Untyped"` (key-less 5709 → 90, `"Untyped"` 148 → 886), so all 19 `Enhanced Ki` carriers read as *typed*, `untypedOnly` collapsed to size 0, and the declared-credit gate went globally inert. |

All three are fixed. With the predicate widened, `untypedOnly` is exactly `{Enhanced Ki}` — size 1,
unchanged from before the refresh, which is independent evidence that the widening is the right
shape and not an over-reach.

**Red-proof.** Defects 1–3 were each observed red, with their own assertion's message, against the
pre-fix tree. For the canon defence itself, a scratch copy of `HEAD` had the ten spell-power/lore
renames reverted in the built dataset (4,326 stat names put back to upstream's spelling); the two
data-layer assertions went red there and pass here.

**Measured scope limit, recorded in the test.** On that disarmed dataset the *fixture-level*
detector did **not** go red: `Combustion` fell 464 → 128 and `Ice Lore` 46 → 11 but both stayed
non-zero, because `Universal Spell Power` and the lore roster cross-add into those buckets
independently of the affix name. So "a ranked stat at zero" catches a name that vanishes entirely;
a partial miss inside a cross-add family is caught by the data-layer assertions, which is where the
teeth are. That limitation is written into `tests/vocabulary_migration.test.js` as a `SCOPE LIMIT`.

## 12. Golden attribution — every fixture, with cause

Captured with `node tests/parity/capture_golden.js` against a dataset rebuilt from this tree
(9,110 items). **12 of 23 fixtures are byte-identical; 11 moved.**

**None of the 11 moved because of U6's own fixes.** Proven, not asserted: a scratch export of `HEAD`
*without* the three fixes above was built and all 23 fixtures captured — **0 of 23 differ** from the
ratified capture. Every diff below is therefore attributable to U4/U5's vendored refresh.

### 12a. The five upstream causes

| Cause | Evidence | Fixtures it explains |
|---|---|---|
| **A. Two augments re-encoded from prose to a structured affix.** `Meridian Fragment` (Orange, ML28) and `Crystallized Drop of Tea` (Yellow, ML28) carried their spell-power line as a 200-character untyped sentence; the refresh stores it as `Universal Spell Power / Psionic / 24`. Newly scorable ⇒ **+24 Universal Spell Power** at every cap ≥ 28. | raw dump before/after, both stones | `mid-caster`, `endgame-caster-ml32`, `trance-credit-additive-ml32`, `trance-credit-additive-ml32-baseline`, `cross-add-combustion-usp-ml32`, `aug-ceiling-32-int-caster-ml36` |
| **B. 42 key-less `Wizardry` affixes typed `Enhancement`** (Enhancement 173 → 215, key-less 42 → 0). Untyped affixes stack; Enhancement takes the max ⇒ the sum **drops**. | type histogram before/after; `Epic Rod of Mythant` `Wizardry None 11` → `Enhancement 11` | `absorption-compound-crown-ml35` |
| **C. 18 `Seeker` affixes re-typed Insight → Exceptional** (Insight 50 → 32, Exceptional 0 → 18). Exceptional is a distinct bucket, so a carrier that used to collide with the best Insight source now stacks. | type histogram before/after; `Horseshoe Crab Shield (level 26)` moved Insight → Exceptional | `endgame-dps-ml33` |
| **D. Upstream corrected its single Exceptional-typed `Spell Lore` record.** `Downcast Robe` read `Spell Lore / Exceptional / 3` and now reads `Universal Spell Lore / Exceptional / 3`. Before: `Spell Lore` had exactly one Exceptional carrier; after: zero, and `Universal Spell Lore` Exceptional went 65 → 66. Our umbrella expands `Spell Lore` into the ten element lores; `Universal Spell Lore` is a **separate stat by standing ruling** (`docs/wiki-evidence/spell-lore.md` §"Adjacent finding", #89: same-item co-occurrence ⇒ distinct, never merge), so it correctly does not expand. ⇒ **Kinetic Lore −3**. | raw dump before/after; the wiki's channel model (Exceptional ⇒ Universal) | `utility-ab-kinetic-ml34`, `utility-ab-kinetic-ml34-baseline` |
| **E. `Magical Efficiency` typed `Enhancement`** on its 100 magnitude carriers (key-less before), which puts it in the curated rankable list and makes it the fifth dual-nature stat. Changes the tie-break surface without changing any ranked target. | type histogram; `Epic Fanged Gloves` `Magical Efficiency None 10` → `Enhancement 10` | `endgame-dex-ml36` |

Roster delta from the same refresh: **+14 / −12 items** (the Oozing Hunger family in, the
Doublestrike-suffix duplicates and two historic records out), so every tie-break index shifted.

### 12b. Per fixture

| Fixture | Verdict | perTarget delta | chosen delta | Cause |
|---|---|---|---|---|
| `heroic-str-melee` | unchanged | — | — | control, clean |
| `mid-caster` | re-ratified | `Universal Spell Power` 94 → 118 | Boots/Goggles/Helmet swapped | A (+24; hosts move because the two stones need Orange/Yellow slots) |
| `endgame-tank-ml34` | unchanged | — | — | control, clean |
| `endgame-dex-ml36` | re-ratified | **none** | Gloves: `Gloves of Tranquility` → `Epic Fanged Gloves` | E. A genuine tie: neither glove carries Dexterity, Dodge or Physical Sheltering, and each contributes exactly one counting-set presence effect (`Blurry`). The tie-break order moved with the roster and the re-typing. |
| `endgame-dps-ml33` | re-ratified | `Seeker` 28 → 33 | Helmet + Ring swapped | C |
| `endgame-caster-ml32` | re-ratified | `Universal Spell Power` 104 → 128 and the ten expanded spellpowers each +24 (`Combustion` 439 → 463, `Devotion` 368 → 392, seven at 247 → 271) | none | A, cascading through the `Potency` expansion and the USP cross-add |
| `trance-credit-displaces-ml34-baseline` | unchanged | — | — | control, clean |
| `trance-credit-displaces-ml34` | unchanged | — | — | control, clean |
| `trance-credit-additive-ml32` | re-ratified | `Devotion` 448 → 472, `Universal Spell Power` 104 → 128 | none | A |
| `trance-credit-additive-ml32-baseline` | re-ratified | `Devotion` 436 → 460, `Universal Spell Power` 104 → 128 | none | A |
| `endgame-necro-dc-ml34` | unchanged | — | — | control, clean |
| `viktranium-multi-affix-dc-ml34` | unchanged | — | — | control, clean |
| `absorption-compound-crown-ml35` | re-ratified | `Wizardry` 631 → 620 | Main Hand: `Epic Rod of Mythant` → `Echo of Whelm` | B — the drop is the **removal of an untyped double-count**, not a loss |
| `provenance-alias-sacred-dc-ml34` | unchanged | — | — | control, clean |
| `provenance-components-sacred-dc-ml34` | unchanged | — | — | control, clean |
| `blocklist-topaz-ml36-baseline` | unchanged | — | — | control, clean |
| `blocklist-topaz-ml36` | unchanged | — | — | control, clean |
| `absorption-sonic-flag-ml26` | unchanged | — | — | control, clean |
| `cross-add-combustion-usp-ml32` | re-ratified | `Combustion` 440 → 464, `Universal Spell Power` 101 → 125 | none | A. The A/B still proves the cross-add: both stats move by the same +24. |
| `utility-ab-kinetic-ml34-baseline` | re-ratified | `Kinetic Lore` 49 → 46 | 4 out / 3 in, 5 → 4 slots filled | D |
| `utility-ab-kinetic-ml34` | re-ratified | `Kinetic Lore` 49 → 46 | 3 out / 1 in, 13 → 11 slots filled | D |
| `utility-removed-complex-blocklist-topaz-ml36` | unchanged | — | — | control, clean |
| `aug-ceiling-32-int-caster-ml36` | re-ratified | `Universal Spell Power` 104 → 128 | none | A. Both stones are ML28, so the ceiling-32 gate is unaffected — the fixture still pins what it exists to pin. |

### 12c. Control fixtures — leakage check

Reading "the six non-sentinel control fixtures" as the six general endgame fixtures that predate the
mechanism-specific A/B pairs (`heroic-str-melee`, `mid-caster`, `endgame-tank-ml34`,
`endgame-dex-ml36`, `endgame-dps-ml33`, `endgame-caster-ml32`): **two are byte-identical and four
moved, and none of the four moved for a canon-rename reason.** `mid-caster` and
`endgame-caster-ml32` move by exactly the +24 of cause A; `endgame-dps-ml33` by cause C;
`endgame-dex-ml36` is a tie-break-only move under cause E. No control fixture shows a stat that our
rename touches changing value — which is the leakage signal, and it is absent.

The eleven A/B and mechanism fixtures give a second reading of the same question: the
`blocklist-topaz` pair, the `trance-credit-displaces` pair, `absorption-sonic-flag-ml26`,
`utility-removed-complex-blocklist-topaz-ml36`, `provenance-alias`/`provenance-components`,
`endgame-necro-dc-ml34` and `viktranium-multi-affix-dc-ml34` are all byte-identical.

**Two priority targets regressed and both were adjudicated rather than accepted:** `Wizardry`
−11 (cause B, an untyped double-count removed) and `Kinetic Lore` −3 (cause D, upstream removing a
credit our expansion granted off a mis-typed record). Neither is a solver or pipeline defect.

## 13. The four red JS files

| File | Test | Verdict |
|---|---|---|
| `dataset.test.js` | `#228` word-cap casualty set | **Re-ratified.** `The Dragging of the Depths` is not a new item — its **encoding** is. Six carriers stored `{name, value: "6"}` (key-less, a numeric magnitude); the refresh stores `{type: "Bool", value: 1}`, moving it into the presence population where its five words exceed the word cap exactly as intended. Cause #380. The population moved; the cap did not. |
| `dataset.test.js` | `#305` tier-raw verbatim | **Re-ratified, re-pointed.** It asserted `Damage vs. Helpless Opponents` (13 tier raws) and `Helplessness Damage` (33) survived verbatim. Both spellings **left upstream**: the refreshed `gearplanner_sets.json` consolidated every helpless wording onto `Damage vs. the Helpless` (1 → 27 occurrences; the other two 2 → 0 and 6 → 0). Since tier raw is synthesized from the set catalog's own affix names and the one surviving spelling is the one our #305 rename maps, the verbatim property is no longer demonstrable in this channel — it is still demonstrated in the dino channel, which the same test asserts. Replaced with the stronger claim the fold owes: **every** helpless tier raw reads as the canonical. |
| `dataset.test.js` | `#287` folded Legendary names | **Re-ratified, split in two.** Upstream **adopted** the fold: `Legendary Accuracy`, `Legendary Armor-Piercing`, `Legendary Deadly` and `Legendary Spell Penetration` have zero occurrences left in the raw dump (14 / 22 / 3 / 12 before) and the **same carrier counts** now arrive as the base stat at bonus type `Legendary`. With nothing to fold there is no provenance receipt, so those four stop being shipped labels. The new test states that as a premise (base stat still carried at type `Legendary`), so an upstream revert goes red instead of drifting back. `Legendary Conditioning` is the survivor and is ours — and it was a **genuine regression** (defect 2, §11) until the sets-channel fold landed. |
| `dataset.test.js` | `#332` `utilityAdmitted` real-data marker | **Re-pointed, recorded as no longer expressible, referencing #380.** The `allow` list is empty by design (all 104 adjudications retired because upstream typed those procs `Bool`), so "an admitted proc exists" cannot be asserted against real data. The test now pins what is still true — exposure, disjointness, a non-empty counting set, `Ghostly` counted, `Undead Bane` **not** counted but still reaching the picker via the presence path — and asserts the emptiness itself, so it goes red the moment #380 refills the set. |
| `browse.test.js` | `#332` counted-vs-admitted on real data | **Re-pointed, same cause.** The counted half still fires (`Ghostly` → `counted`); the admitted half has no population, so `presenceMarker("Undead Bane", …)` is now asserted to be `null`. The two-markers-differ mechanism stays pinned by the hand-built test above it, which feeds both sets. |
| `browse.test.js` | `#332` admitted-proc chip join | **Re-pointed.** Its `if (!utilityAdmitted.size) return` early-out was a guard that could stop checking without failing — and the refresh made that branch the only branch. The emptiness is now asserted, and the **counted** half of the same `affixEntries` → `presenceMarker` join is exercised against real data (`> 100` chips) so the seam the test exists to guard is still covered. |
| `wizard.test.js` | `F2` dual-nature escape list | **Re-ratified.** `Magical Efficiency` is the fifth dual-nature stat, and upstream is why: its 100 magnitude carriers were key-less (so it never reached the curated rankable list) and are now typed `Enhancement`, beside the 8 `Bool` lines it already had. Gating it on `presence` alone would hide the min/max of a stat that has one — the exact defect the test blocks, now on a fifth name. |
| `wizard.test.js` | `#235` `Enhanced Ki` untyped-only | **Genuine regression, fixed, test unchanged.** See defect 3 in §11. |
| `solver_golden.test.js` | 11 fixtures | **Re-ratified last, with §12's per-fixture attribution.** |

## 14. Residue for follow-up

1. **The four adopted `Legendary <stat>` names no longer redirect.** A character saved before the
   refresh that ranks `Legendary Accuracy` now ranks a name nothing carries, with no substitution —
   the label path that used to migrate it is gone with the fold. The stat it should resolve to
   (`Accuracy`) is still suggested and still carries the Legendary-typed carriers, so this is a
   migration gap, not a scoring one.
2. **Cause A ratifies a ramping proc as a constant.** `Meridian Fragment` and `Crystallized Drop of
   Tea` grant +8 per stack, up to +24, on taking physical damage, each stack lasting 20 seconds.
   Upstream now stores the ceiling as a flat `24`, so six fixtures ratify a conditional maximum as
   an always-on bonus. This is exactly **#214** (conditional and ramping effects stored as flat
   constants); it should be added there.
3. **Cause C is an upstream re-type of the same shape as #379.** 18 `Seeker` affixes moved
   Insight → Exceptional, which changes stacking and gained 5 points on `endgame-dps-ml33`. #379
   already tracks a re-type (Insight → Competence on Elemental Resistance) whose harvested evidence
   contradicts itself; `Seeker` belongs in that review.

---

# U7 — close-out: unserved diff, #283, perf, build trio

## 15. Method for every number below

Two datasets, one session, one machine. The **pre-refresh** dataset is the pre-U4 commit `96a26bd`
(upstream `ec3e595`) exported with `git archive` into a scratch tree and built there; the
**post-refresh** dataset is this tree (upstream `767a7f7`) rebuilt before any capture, per
`docs/solutions/workflow-issues/rebuild-the-dataset-before-any-golden-capture.md`. Nothing was
stashed and the working tree was never checked out to an older commit — the shared working directory
stays on this branch throughout.

`tests/perf_utility.js` and `tests/parity/fixtures.json` are **byte-identical** between the two
trees (`diff -q`), so the perf comparison varies the dataset, not the harness. The only `web/`
difference between the two trees is `web/dataset.js`'s untyped predicate (U4's fourth `#380` site);
its effect on the counting set was measured as nil — see §17.

## 16. Unserved crafting slots — the diff, attributed

Both figures come from U1's guard itself, read out of `metadata.crafting_slot_coverage` in each
built dataset. The guard runs on the derived pool records, so this is the shipped population, not a
re-derivation.

| field | pre-refresh | post-refresh | Δ |
|---|---|---|---|
| declared labels | 68 | 68 | 0 |
| labels validated | 68 | 68 | 0 |
| served labels | 33 | 33 | 0 |
| **unserved labels** | **35** | **35** | **0** |
| **unserved item-slots** | **415** | **415** | **0** |
| allowlist size | 35 | 35 | 0 |

The baseline holds exactly: **35 unserved labels / 415 item-slots**, as U1 stamped it.

### Every change, attributed

The unserved population changed in exactly **24 entries — 12 removals and 12 additions — and they
are the same twelve slots under their new name.** Each rename carries its item-slot count across
unchanged, which is what makes it a rename rather than two coincident events:

| removed (`Cannith:`) | added (`Essence Crafting:`) | item-slots, both sides |
|---|---|---|
| `Cannith: Rune Arm - Extra` | `Essence Crafting: Rune Arm - Extra` | 39 |
| `Cannith: Rune Arm - Prefix` | `Essence Crafting: Rune Arm - Prefix` | 39 |
| `Cannith: Rune Arm - Suffix` | `Essence Crafting: Rune Arm - Suffix` | 39 |
| `Cannith: Trinket - Extra` | `Essence Crafting: Trinket - Extra` | 4 |
| `Cannith: Trinket - Prefix` | `Essence Crafting: Trinket - Prefix` | 4 |
| `Cannith: Trinket - Suffix` | `Essence Crafting: Trinket - Suffix` | 4 |
| `Cannith: Melee - Extra` | `Essence Crafting: Melee - Extra` | 1 |
| `Cannith: Melee - Prefix` | `Essence Crafting: Melee - Prefix` | 1 |
| `Cannith: Melee - Suffix` | `Essence Crafting: Melee - Suffix` | 1 |
| `Cannith: Ring - Extra` | `Essence Crafting: Ring - Extra` | 1 |
| `Cannith: Ring - Prefix` | `Essence Crafting: Ring - Prefix` | 1 |
| `Cannith: Ring - Suffix` | `Essence Crafting: Ring - Suffix` | 1 |

Sum on both sides: 135 item-slots. Cause: the U4/U5 adoption of upstream's Update-79 rename (§1) —
the one place in this migration where matching the player-visible name meant following upstream
rather than defending our spelling.

**Nothing else moved.** All 23 remaining unserved labels are identical in name *and* count on both
sides — `One of the following` 103, `Nearly Finished` 65, the two `Slaver's` families 15/15 and
3×4 + 3×4, `Almost There` 2, the `Random set` pair 6/6, and the rest. So does the served side: 33
labels, and every pool walked the same number of records pre and post (`augments` 1063,
`augment_set_defs` 21, `membership_set_defs` 28, `viktranium` 297, `nearly_complete` 68,
`dino_inserts` 107, `seal` 48, `green_steel` 108, `thunder_forged` 36), with the same per-pool label
counts. **No named cause is owed beyond the 12 renames, because no other change exists.**

Worth stating because it was the risk this gate was built for: roughly three weeks of new item data
arrived (+364 KB of raw items, roster 8188 → 8190) and **stranded no slot** — no label appeared that
no pool serves, and no allowlisted label went undeclared or became served.

## 17. #283 — the measured state, and what was posted

Full method and tables in the comment on the issue
(`gh issue view 283`); summary here.

**The premise in the U7 brief is false, and measuring it was the first step.** The two
`(quarterstaff)`-qualified **Lamordia** slots — `Dolorous (Weapon) (quarterstaff)` and
`Melancholic (Weapon) (quarterstaff)` — have **not** stopped being emitted. Both keys are present in
`ec3e595` **and** `767a7f7` (83 crafting keys in each), and the built dataset sources both in both,
identically: `quarterstaff_pools_sourced` = the two keys, `quarterstaff_options` 46,
`quarterstaff_options_identical` 38. #282's fix is intact.

**#283's actual subject is the Dino channel**, not Lamordia: `Fang (Weapon) (quarterstaff)` and
`Scale (Weapon) (quarterstaff)`. Measured across the refresh, byte-identical:

- both pools present in both snapshots, 7 option names each, matching the base Weapon pool by name;
- the same 4 options still differ in content — `Iridiscent Fang`; `Brightscale`, `Iridiscent Scale`,
  `Shadowscale` — each still carrying the extra `uniquePropertyRequired: {"requireQuarterstaff": true}`
  affixes at unchanged name, type and value;
- the same 4 host→pool references, from `Attuned Bone Quarterstaff` and `Dinosaur Bone Quarterstaff`;
- `Claw` and `Horn` still have no `(quarterstaff)` variant at all.

**Verdict posted: the refresh leaves #283 open and unchanged** — not resolved, not invalidated.
Every fact in the issue body is still true, and the design question (declare the untyped Dino
weapon blank a quarterstaff from the query, or split it into typed variants, settling the THF
handedness interaction at the same time) is untouched. **No code changed** (KTD6).

The comment also records the silence property for whoever fixes it: `src/viktranium.py` reads these
through a soft `has_qs = category == "Weapon" and qs_key in catalog`, so an upstream drop would fail
nothing — the three `metadata.viktranium_coverage` fields would simply go to zero, and they are the
only detector today. Deliberately **not** filed separately: it is the same code path as the fix.

## 18. Perf — two numbers, because one cannot answer both questions

`tests/perf_utility.js` is a **self-relative A/B**: per fixture it solves the ratified form (a) and
the sentinel-appended form (b) against whatever dataset is on disk. Both arms move together with the
data, so its ratio answers "is the Utility widening still under 2.00×" and **cannot** answer "did the
refresh raise solve cost". The refresh delta is the change in the **absolute arm-(a) medians** across
two runs of the same harness on two datasets.

23 fixtures, shipped roster (20 counted names in **both** trees — so U4's `web/dataset.js` untyped
predicate did not change the counting set; the presence population it walks is also identical, 699
affix incidences over 647 carrier items pre and post).

| run | dataset | (a) baseline median | (b) sentinel median | ratio |
|---|---|---|---|---|
| pre #1 | `ec3e595` (scratch build of `96a26bd`) | 466 ms | 786 ms | 1.69× |
| pre #2 | same | 466 ms | 786 ms | 1.69× |
| post #1 | `767a7f7` (this tree) | 460 ms | 833 ms | 1.81× |
| post #2 | same | 463 ms | 832 ms | 1.80× |

**Number 1 — the refresh delta (absolute arm (a)):** 466 ms → 460–463 ms, **−0.6 % to −1.3 %**.
Three weeks of new item data did **not** raise solve cost. The all-fixture arm-(a) total moved
40.5 s → 38.1 s (−5.8 %), pulled down by the one heavy fixture (`endgame-caster-ml32`
29.1 s → 25.1 s, ×0.86). Per fixture the picture is two-sided and worth recording rather than
averaging away: `trance-credit-additive-ml32` and its `-baseline` twin both rose ×1.79
(≈1.0 s → ≈1.79 s) and `endgame-tank-ml34` rose ×1.22, while everything else sat inside ×0.92–×1.06.
The two trance fixtures moving together by the same factor is the coherent signal — that pair shares
a query — and the median is unmoved, so nothing here is a budget question.

**Number 2 — the Utility gate:** **1.80–1.81×, inside its 2.00× budget. PASS.** It did move up from
1.69× pre-refresh, and it sits above the 1.50–1.75× band recorded in the script header from
2026-08-16, so the margin is thinner than the header implies (the header's own instruction is to
re-measure rather than cite, and this section is that re-measurement — the band is annotated there
with today's numbers). Under budget, so it ships; nothing was waived and no caveat was needed.

## 19. Build trio

Bumped together, because this is a **solver-affecting data change**: the dataset is fetched
`no-cache`, so a data-only merge changes every solve on the live site the moment it deploys, and the
footer is the only version signal a player has.

| thing | from | to |
|---|---|---|
| `web/index.html` `?v=` (17 references) | 146 | **147** |
| `web/app.js` `const BUILD` | 08182026.5 | **08182026.6** |
| `README.md` `**Current build:**` | 08182026.5 | **08182026.6** |

`tests/test_build_stamp.py` passes on all three of its checks (well-formed stamp, one `?v=` version
across the file, README matches the footer).

## 20. What a player actually notices

Written in player terms rather than gate terms, because everything above is a gate.

- **Affix names do not change, deliberately.** A character saved with `Combustion` ranked still
  ranks `Combustion`; the search box still offers `Combustion`; every share export still reads
  `Combustion`. Upstream renamed these ten enchantment stats to generic mechanic names and we kept
  ours, because the enchantment name is what the item tooltip shows in game. This is the whole point
  of the migration and a player should be unable to tell it happened.
- **Upstream's generic names now additionally resolve in the picker.** Typing `Fire Spell Power`
  finds `Combustion` rather than nothing. Search vocabulary and tooltip fidelity are served
  separately, on purpose.
- **Crafting slots relabel.** Items that used to list `Cannith: Rune Arm - Prefix` now list
  `Essence Crafting: Rune Arm - Prefix`, in the compendium and in every share export. That one
  follows upstream, because Update 79 renamed the system in game and `Cannith` was our stale name.
  Neither name is craftable in the tool today — it is a label on an inert slot either way — and a
  player searching the old term will not find it (noted on #193).
- **Recommended loadouts may shift, and that is expected.** Roughly three weeks of new item data
  arrived, so every solve re-runs against a larger, corrected catalog. Eleven of 23 golden fixtures
  moved and each was attributed to a named upstream cause (§12). Nothing about *how* the solver
  values gear changed.
- **One thing a returning player can hit:** a character saved before this build that ranked
  `Legendary Accuracy`, `Legendary Armor-Piercing`, `Legendary Deadly` or `Legendary Spell
  Penetration` now ranks a name nothing carries, with no substitution message — the points still
  exist under `Accuracy` / `Armor-Piercing` / `Deadly` / `Spell Penetration`, but the saved priority
  no longer points at them. Filed as **#381**; not fixed here.
- **The footer reads `08182026.6`.** That is how a player tells the new data is live.

## 21. Residue filed

| residue (§14) | where it went | verified before filing |
|---|---|---|
| The four adopted `Legendary <stat>` names no longer redirect | **new issue #381** | `known` true→false on all four across the two built datasets; `provenanceLabels` / `expandedAwayFor` both empty post-refresh; neither `PROVENANCE_LABEL_FALLBACK` nor `EXPANDED_AWAY_FALLBACK` covers them; the base stats still carry 14 / 22 / 3 / 12 `Legendary`-typed affixes; `Legendary Conditioning` still resolves, as the contrast |
| Cause A ratifies a ramping proc as a flat constant | **comment on #214** (not a new issue — it is that issue's shape) | `Meridian Fragment` and `Crystallized Drop of Tea` went from an untyped free-text affix at value 1 (unrankable, contributed nothing) to `Universal Spell Power` @ `Psionic` = **24**; they are the only two Psionic USP carriers in the dataset (0 pre-refresh, 2 post) |
| Cause C's `Seeker` re-type belongs in #379's review | **comment on #379** | `Seeker` Insight 50 → 32, Exceptional 0 → **18**, with Enhancement 123, Quality 23, Artifact 2 unmoved on both sides |
| (added) The `Cannith:` → `Essence Crafting:` label alias U4's commit says "is filed" — it was not | **comment on #193**, the system that owns those labels | searched issues open and closed: no such issue exists |
