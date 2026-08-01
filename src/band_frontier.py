"""R4 endgame band (ML 30-36) coverage — NATIVE-roster derivation (U6).

Re-homed onto the gear-planner NATIVE roster (the single source of truth). Each
built item carries `ml`, `slot`, `sets`, and `wiki_url` natively, so the ML 30-36
endgame band is derived directly from the roster. This module no longer reads any
gear-planner-independent shard:
  - `roster_*.json`                 (the `_roster_lookup` slot index — retired)
  - `ml30_36_attribution.json`      (the wiki `Update NN` band harvest — retired;
                                      derivation is now on-the-fly, no static file)
  - `solver_active_baseline.json`   (the `enriched_names` snapshot — retired)
  - `band_worklist.json`            (the emitted work-list — retired)
  - `quarantined_r4.json`           (quarantine list — retired)
Those files stay on disk (U7 purges them); nothing here reads them.

Single-source completeness collapses the terminal states. gear-planner provides
COMPLETE data for every item it lists, so every band item is solver-active — the
legacy `pending` / `quarantined` states no longer occur; every band item is
`enriched`. Coverage reports honest per-(expansion, slot) counts.

Expansion attribution (coarser now, honestly disclosed):
The native item carries NO "Update NN" field, so the band can no longer be split
across Isle of Dread / Myth Drannor / U81 by release update — that split relied
on the wiki `Update NN named items` category harvest, now retired. An expansion is
attributed ONLY where a reliable NATIVE signal exists; a release we cannot derive
natively is NOT fabricated:
  - isle_of_dread — Dinosaur Bone crafting items, self-identifying via the
    single-source Dino crafting catalog (their `wiki_url` is the Dinosaur_Bone
    crafting page).
Every other band item has no native expansion signal and is reported under
`unattributed/<slot>` as a per-slot ML-band count.
"""
from __future__ import annotations

BAND_MIN, BAND_MAX = 30, 36

# Native reliable-signal expansion attribution. Only Isle of Dread is derivable
# from native fields today (the Dino crafting catalog is single-source); the old
# Update-55/69/81 split is retired (see module docstring).
DINO_URL_MARKER = "Dinosaur_Bone"


def _is_dino(it) -> bool:
    """True when the item is Dinosaur Bone crafting gear (Isle of Dread), detected
    natively via its wiki_url on the single-source Dino crafting page."""
    return DINO_URL_MARKER in (it.get("wiki_url") or "")


def _in_band(it) -> bool:
    """A band item is native ML 30-36, OR a Dinosaur Bone host (endgame IoD gear
    whose ML is tier-derived and may be absent on the synthetic set-bonus hosts)."""
    ml = it.get("ml")
    if isinstance(ml, (int, float)) and BAND_MIN <= ml <= BAND_MAX:
        return True
    return _is_dino(it)


def band_coverage(items):
    """Live per-(expansion, slot) coverage of the ML30-36 endgame band, derived
    from the built NATIVE roster, for honest browse/disclosure metadata.

    `items` is the built variant list. Items are de-duplicated by `source_item`
    (tier variants of one item count once). Each band item is `enriched`:
    single-source completeness means every native item is solver-active, so the
    `pending` / `quarantined` states no longer occur (kept in the shape at 0 for
    renderer compatibility and honest disclosure).

    Expansion: `isle_of_dread` where the native Dino signal fires; everything else
    is reported under `unattributed/<slot>` (per-slot ML-band count) — the coarser
    attribution the retirement of the wiki Update-NN harvest imposes.

    Returns {"by_slot": {"<expansion>/<slot>": {...}}, "totals": {...}, ...}.
    """
    seen = {}
    for it in items or []:
        si = it.get("source_item")
        if si and si not in seen:
            seen[si] = it

    by_slot = {}
    totals = {"band_total": 0, "enriched": 0, "quarantined": 0, "pending": 0}
    attributed = 0
    for it in seen.values():
        if not _in_band(it):
            continue
        slot = it.get("slot") or "Unknown"
        if _is_dino(it):
            expansion = "isle_of_dread"
            attributed += 1
        else:
            expansion = "unattributed"
        key = f"{expansion}/{slot}"
        c = by_slot.setdefault(
            key, {"band_total": 0, "enriched": 0, "quarantined": 0, "pending": 0})
        # Single-source: every native band item is complete -> solver-active.
        c["band_total"] += 1
        c["enriched"] += 1
        totals["band_total"] += 1
        totals["enriched"] += 1

    return {
        "by_slot": by_slot,
        "totals": totals,
        # Disclosure: attribution is native-derived and coarser than the retired
        # Update-NN harvest. Only Isle of Dread (Dino crafting) is reliably
        # attributable; the rest of the band is per-slot ML-band counts.
        "attribution": "native-coarse",
        "expansions_attributed": ["isle_of_dread"],
        "attributed": attributed,
        "unattributed": totals["band_total"] - attributed,
        "note": ("Native roster carries no release ('Update NN') field, so only "
                 "Isle of Dread (Dinosaur Bone crafting) is reliably attributable; "
                 "all other ML30-36 gear is reported per-slot under 'unattributed'. "
                 "Under single-source completeness every band item is solver-active."),
    }
