# The U81.3 re-vendor — adjudication of record

**Upstream:** `illusionistpm/ddo-gear-planner` `767a7f74` (2026-08-18) → `397c673a` (2026-09-23)
**Trigger:** the Update 81.3 raid *Terror of the Demon Lords*, live 2026-09-16
**Build:** `09232026.1` · dataset 9,208 variants from 8,050 records

---

## 1. What this was for, and what it turned out to be

The ask was twenty raid items. The raid went live on 2026-09-16, the Lamannia harvest banked
on 2026-09-05 was ready to promote, and step 4 of its promotion procedure asks whether
upstream has caught up first. It had — so the twenty arrive through the ordinary path and the
wiki harvest becomes corroboration. See
`docs/wiki-evidence/lamannia-preview-demon-lords-raid.md` for the promotion itself and the
preview→live diff (**ten of the twenty items changed**, which is the return on banking it).

The re-vendor was not a drop-in. Measured against the previous snapshot:

| | count |
|---|---|
| genuinely new items | 60 (20 raid + 40 other) |
| renames | 60 (45 `[Crafted]` suffix, 15 Epic/Legendary prefix) |
| changed existing items | 206 |
| new augments | 63 (the ML36 tier, now native) |
| Legendary Green Steel rows | 116 → 156 |

It arrived as a cascade of guards, which is what
[`a-gate-cascade-is-the-refresh-report-not-an-obstacle.md`](../solutions/conventions/a-gate-cascade-is-the-refresh-report-not-an-obstacle.md)
predicts and prescribes. **Fifteen gates fired in sequence**, each invisible until the one
before it cleared. Every one is an adjudication below; none was cleared by bumping a number.

## 2. The retirements — upstream adopted our corrections

**The ML36 augment shard (#260) is retired in full.** Upstream carries all 63 natively. 63/63
present, 59 byte-identical once our canon rename has run, 4 elemental-dice entries resolved in
upstream's favour (ours stored the dice count as the affix value; `Bool` is a presence type, so
the change is behaviour-neutral and ours was the latent defect). Tooltips preserved as
evidence, machinery deleted. Detail in `docs/wiki-evidence/ml36-augment-tier.md`.

**Two `augment_tier_gap` entries** (`Solar Gem of Arcana` Heroic and Legendary) adopted at our
exact values; deleted, and the surviving Epic entry's now-false "absent upstream at every tier"
claim rewritten rather than left standing.

**Eight `no_drop_source` entries** retired. Update 81.2 shipped the quest `Raiding the Raiders`
on 2026-08-19 — *after* the 2026-08-13 triage that recorded these items' Location sections as
empty. Each was re-read on its own rendered page before retiring. The original verdicts were
correct when made; the game changed under them, and the entries record that rather than being
deleted.

**One umbrella ruling** (`Fortitude Save Vs Disease`) retired: upstream dropped the Green Steel
option that carried it.

## 3. The refusals — where upstream moved and we did not follow

**`Power Store` → `Magical Efficiency` is refolded as our canon.** Upstream carried this fold
in its own synonyms table until 767a7f7 and dropped it at 397c673, moving 8 item records and 1
augment onto a standalone name. Both wiki pages define one mechanic — Power_Store is "an
enhancement bonus of -10% spell point cost", Magical_Efficiency is "a X% Enhancement discount
to the Spell Point cost". Left split, one mechanic sits in two buckets and **sums** where the
game takes the max (#632/#376). The registry records what upstream does; the behaviour is ours.

This also protected the eight #619 value corrections, which target these very items and would
have gone stale silently. Their `name` is re-pointed to the upstream spelling, because name
corrections run *after* value corrections in the item channel.

**Four `Inherent <element> Resistance -` folds**, same class: upstream's T2/T3 (Equipment) pools
carry the engraved label with the magnitude stripped, leaving a trailing `" -"`. The wiki
sentence names the stat outright. Folded, with zero same-item co-occurrence measured on each.

**`Max Filigree Slots` quarantined** under the standing #196 non-goal. Worth recording honestly:
that non-goal was argued partly on there being no filigree data in any source, and this refresh
changes that premise — upstream now carries a per-item slot count on 95 items. It still carries
no filigree effects or pools, so the decision stands and the note says where the ground moved.

## 4. The two upstream regressions

**The `[Crafted]` collapse.** Upstream merged 45 `X [Crafted]` records onto their base name and
the surviving record carries the SMALLER pre-craft affix block. Twenty-four lost only a
`Craftable*` marker and were left alone. **Twenty-one lost 39 affixes the DDO wiki still states
outright** — `Lucid Dreams` alone lost Potency +48, Spell Lore VI, Mind Drain and Will Save -2,
all four confirmed present on its page. All 21 pages were re-read and the affixes restored
through `gap_corrections.json`, whose sanctioned scope is widened deliberately and on the
record. Two type readings (`Exceptional Fortification` on The Disciplinator and Toven's Hammer)
are restored as-was and filed rather than re-adjudicated inside a data refresh.

**`Facet of Condensed Power`** degraded from `(Magical Efficiency, Enhancement, 1)` to
`(Power Store, Bool, 1)` — name and type. The canon rename restores the name and an
`affix_type_corrections` entry restores the type, returning the record to exactly what upstream
itself shipped before. The magnitude question is older than this refresh (the wiki says 10,
upstream has said 1 both before and after) and is filed, not silently changed.

## 5. The structural changes

**Legendary Green Steel grew 116 → 156** by adding skill-group variants: `False Life` tier 1 now
exists three times over, pairing the same Profane +28 with three different skill groups. The
option `name` records only the primary stat, so tier alone collapsed 12 options onto 6 keys —
blocking one skill group would have silently blocked the other two. `POOL_KEY` widened to
(tier, skill group), per the guard's own instruction.

**The Nearly Complete tier gate** read the ABSENCE of a `Legendary ` prefix as a claim of
"heroic". Eight of the raid's ML35 hosts are plainly named, and upstream files them under three
new per-item pools. The check now fires only when the name actually asserts a tier; the
`Legendary X at a heroic ML` contradiction still stops the build.

**`Leaves of the Forest`** is dropped as an upstream placeholder: ML 1, a single `TBD` affix (the
only one in the dump), and a url pointing at the family index page. Shipping it breaks owned-item
import concretely — the importer strips `(level N)` to match an in-game name, so a player owning
any real tier would also match this shell.

## 6. Verification

Python **1,435 passed / 0 failed**; JS **2,918 passed / 0 failed** across 43 files. Both stamp
guards green, including the directional one.

**The golden moved on four of 24 fixtures**, and the solver code did not change: re-running the
current code against the pre-refresh dataset reproduces the old golden exactly, so every move is
attributable to data alone. Two improved with nothing above them lost; one is a `chosen`-only
tie-break (with a raid item, `The Queen of Rot`, tying into an endgame Dex build).

The fourth needed an argument. `riposte-split-ac-saves-ml34` lost 4 on all three saves while
Physical Sheltering — ranked *below* them — gained 7. Under strict lexicographic priority that
shape is either a defect or proof the higher total became unreachable. It is the latter:
**upstream retyped the heroic Slaver's Suffix `Resistance` option from `Enhancement 4` to
`Resistance 4`**, matching the Legendary sibling it had always disagreed with (`Resistance 10`).
Typed Enhancement it stacked with every other Resistance save source; typed Resistance it shares
their bucket and takes the max. The pre-refresh 38/38/37 was inflated by an over-stack; 34/34/33
is the corrected answer. Measured rather than assumed — blocking the ring the new solve picks
still yields 34/34/33, so the ring swap is a consequence of the retype, not its cause.

Per the cascade doc's seventh point, that mechanic is pinned by a **named assertion written
before the golden was regenerated** and proven red against the pre-refresh dataset:
`397c673 — both Slaver's Resistance suffixes are Resistance-typed, so they share one bucket`.
The new per-tier Green Steel amplification guard was falsified the same way.

## 7. Filed, not folded in

- **#861** — `Facet of Condensed Power`: the wiki states a 10% discount, upstream has always
  said 1. Older than this refresh. The crafting channel has no value-correction path, so the
  type was restored and the magnitude filed.
- **#862** — the two `Exceptional Fortification` readings (The Disciplinator, Toven's Hammer):
  restored as gear-planner had them, because re-typing is a stacking-bucket ruling and not
  part of repairing a collapse.
- **#863** — `Legendary Ratkiller (level 36)` carries `ml=32`: the wiki page title and its own
  infobox disagree. Allowlisted by name so a second case cannot hide behind it.
- **#864** — the untyped-proc backlog. `Wild Frenzy` is reviewed and real, but `allow` is empty
  and 24 peers wait; admitting it alone would make it the only individually rankable proc in
  the game, which is a product decision a data refresh should not settle.
