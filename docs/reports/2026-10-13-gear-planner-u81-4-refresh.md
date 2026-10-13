# The U81.4 re-vendor — adjudication of record

**Upstream:** `illusionistpm/ddo-gear-planner` `397c673a` (2026-09-23) → `c36b45e1` (2026-10-13)
**Trigger:** Update 81.4, live 2026-10-07 — the balance pass, the Night Revels 2026 event
(loot to ML36, ends Nov 1), and the Lahar DR-bypass augments. Tracked under #875, closes #871.
**Build:** `10132026.2` · dataset 9,225 variants from 8,063 records

---

## 1. What arrived

| | count |
|---|---|
| upstream commits since the pin | 48 (daily `[auto-update]` wiki pulls + one Slaver's parser fix) |
| new gear-planner records | +13 net (22 new keys, 9 of them re-keyed by an ml change) |
| changed records | 105 |
| crafting systems | 84 → 87 (three `Upgradeable` keys) |
| new augments | 4 (the U81.4 Lahar Rubies) + 7 existing Lahar Rubies re-levelled |
| golden fixtures moved | **0 of 24** |

Upstream moved its data files from `site/src/assets/` to `data/` in this window; the
pinned fetch in `raw/SOURCE.json` records the new paths. The content contract is unchanged.

Eight gates fired in sequence. Each is adjudicated below; none was cleared by bumping a
number, and every count pin that moved carries its itemised cause in the test that holds it.

## 2. The gates

**1. `Upgradeable Item` — a new crafting system (#879, deferred).** Upstream began modelling
per-item upgrade pools on 25 heroic named items (Stormreaver, Litany of the Dead, Madstone,
...). Registered in the crafting-slot registry and the coverage allowlist as recognised and
**unmodelled**: each item keeps exactly the base affixes it always shipped with. The two
new names that live only inside these pools (`Bone Breaking`, `Greater Telekinetic`) reach
no solver.

**2. `Upgradeable - Primary/Secondary Augment` — an over-credit corrected (#878 for the
rest).** The 397c673 dump listed every colour an Epic item's upgrade slot may become as its
own slot: Epic Chain of Conviction had Blue + Green + Yellow, Emerald Twilight six. The wiki
says otherwise — "Upgradeable - Primary Augment (Yellow Augment Slot or Blue Augment Slot)",
"Upgradeable - Secondary Augment (Green Augment Slot)" — one slot per upgrade, colour chosen.
Upstream now encodes exactly that in a new per-item `augmentUpgrades` map.
`planner_items._augment_slots` reads it: a single permitted colour is a real slot; several
become one quarantined "ambiguous multi-color slot". **32 items lose phantom slots**; 28 keep
their fixed Green; the multi-colour slot is disclosed rather than counted, until #878 gives
the solver a choice slot.

**3. Four new augments.** `Ruby of Bludgeoning Blows`, `Ruby of Piercing Precision`,
`Ruby of Slashing Strikes` (ML1) and `Ruby of the Quori` (Crystal, ML8) — exactly the
"Itemization" section of the wiki's `Update 81 Patch 4 Release Notes`. The same release
standardised the existing Lahar Rubies to ML4 (alignment) / ML8 (material); upstream
carries both. Registered in the augment registry; their wiki `locations` harvested (gate 6).

**4. `Sneak Attack Bonus` → `Deception` — a fold accepted.** Upstream re-pointed its
Deception synonym and rewrote all 44 raw `Sneak Attack Bonus` affixes. Accepted as one
mechanic: `Template:Sneak Attack Bonus` defines the amount as a to-hit bonus with 1.5x
damage on sneak-attack hits; `Deception` is "+X (type) bonus to hit and +Y to damage for
any hit that would qualify as a sneak attack"; the template's own note says untyped Sneak
Attack Bonus "does not stack with Deception"; `Backstabbing` lists both categories as
sources of one effect; and every #613 type correction's harvested tooltip *is* Deception's
definition. The two names now share Deception's per-type buckets (max, not sum).

The dropped `Sneak Attacks` synonym was checked for life in our own channels, on the
`Well Rounded` precedent: it was briefly re-adopted under `local_affix_synonyms`, and
`check_local_synonym_staleness` rejected it as matching nothing — the Dino Fang insert
arrives structured. So it is inert, and the one unit test that used that wording now
exercises a fold that is live.

**5. Twenty stale type corrections.** The #613 retypes keyed on `Sneak Attack Bonus`.
Each was re-pointed to `Deception` only after confirming the same record still carries the
same pseudo-type and value — 20 of 20 matched.

**6. Three material harvests.** Legendary Robe of Shadow (Cloth), Legendary Spectre
Deflector (level 32, level 36) (Densewood) — stated in each infobox and category.

**7. Augment locations for the four Rubies.** One paced read; all four state "Lahar +
purchasable augments + The Twelve, (20) Token of the Twelve".

**8. Eight Night Revels items at ml 1 — an upstream regression corrected.** On 2026-10-12
a wiki editor reformatted these pages: `minlevel` became `minimum level`, and the quest line
became `turn in collector :: Joe Candymaker`. Upstream's parser reads the old names, so
Cloak of Night (levels 4–28) and Bottled Fear fell to ml 1 with no quest. The new
`data/seed/compendium/item_ml_corrections.json` restores the stated level on all eight
(each page re-read) and the quest the previous snapshot carried. Every entry names the
upstream value it replaces, so it fails the build if upstream changes again, fails as
*stale* once upstream ships the fix, and fails if it names no record — all three proven.

Not restored: **Sun Flask** also lost its quest, but its page (re-edited 2026-10-13) now
states none — turn-in collector "Event", with Festivult only in prose. It enters no-drop
triage as unverified, which shows the player nothing.

## 3. Resolved by the refresh

- **#863** — `Legendary Ratkiller (level 36)` now ships ml 36 (U81.4: "The level 36
  version of the Ratcatcher Maul is now actually level 36"). Its allowlist entry is retired.
  The entry's liveness check matched the NAME only and so stayed green after the fix it
  excused; it now requires the disagreeing ml, and was proven red on the stale entry.
- **#872, in part** — the Lahar augments arrived through the normal path. Legendary Armor
  Piercing and the set-bonus relabel remain on that watch list.

## 4. Verification

Python **1,469 passed / 0 failed**; JS all files passed. Thirteen named assertions in
`tests/test_u81_4_revendor.py` were written before the golden was run; eleven fail on the
pre-refresh tree, the twelfth is a deliberate no-change guard, and the thirteenth (the
Night Revels levels) was proven red on the current tree with the corrections disabled.

**The golden did not move.** None of the 24 fixtures' optimal loadouts changes: the Night
Revels and Lahar additions do not beat what those builds already pick, and the 32 items
that lost phantom augment slots were not chosen by any fixture.

## 5. Filed, not folded in

- **#878** — choice slots for the 32 upgrade hosts (one slot of a chosen colour).
- **#879** — the `Upgradeable Item` per-item upgrade pools.
