"""#359 — wiki-sourced augment ACQUIRABILITY, stamped onto the augment pool.

Owned-augment mode restricts the augment pool to what a player can actually
use. Restricting it to only what their Trove export lists would delete ~88% of
the pool, most of it augments nobody farms — you buy them from a vendor or
trade Mysterious Remnants for them. So the pool becomes **owned UNION
acquirable**, and this module supplies the acquirable half.

The classification is NOT inferred from the name. `Diamond of …` / `Ruby of …`
look craftable and mostly are, but the catalog also carries named Diamonds and
Rubies that come from one specific drop. The DDO wiki classifies every augment
by rarity, and that taxonomy is the answer:

  * `Category:Common augments`   (668) — vendor / Remnant / generic chest loot
  * `Category:Uncommon augments` (6)
  * `Category:Rare augments`     (1)
  * `Category:Named augments`    (1051) — one specific source; must be OWNED

The seed holds the first three. **Absence is a positive statement**, not a gap:
a name not in the file is drop-specific and only usable when the player's own
export lists it. Evidence: `docs/wiki-evidence/augment-acquirability.md`.

Guard shape follows the corrections family: the join is by exact record name,
and a drop in the join rate FAILS THE BUILD rather than silently shrinking what
owned-mode offers. A player would experience that shrinkage as "the tool forgot
augments I can buy", with nothing on any surface saying so.
"""
from __future__ import annotations

import json
import os


def load(path: str) -> set:
    """The acquirable augment names. A missing file yields an empty set — the
    overlay is optional and the build stays deterministic without it (owned-
    augment mode then simply has no acquirable half to offer)."""
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    return set(raw.get("acquirable") or ())


def apply(records: list, acquirable: set) -> dict:
    """Stamp `acquirable: True` on every augment record the seed names.

    Stamped ONLY on the seeded records — an augment not in the seed carries no
    field at all, so absence is the signal rather than a falsy value written
    across the whole pool (the convention in
    `docs/solutions/conventions/exclude-until-verified-data-gates.md`).

    Returns a coverage dict for the guard below.
    """
    stamped = 0
    augments = 0
    for rec in records:
        if (rec.get("category") or "") != "augment":
            continue
        augments += 1
        # Match on the VARIANT id first: augments are stamped on the emitted
        # variants (where `aug_color` is annotated), not on the upstream pool
        # records, and an augment's variant_id is its name. Falling back to
        # `name` keeps the function usable against a raw pool record in tests.
        key = rec.get("variant_id") or rec.get("name")
        if key in acquirable:
            rec["acquirable"] = True
            stamped += 1
    return {"augments": augments, "stamped": stamped, "seed_size": len(acquirable)}


def assert_join(coverage: dict, seed_path: str) -> None:
    """Fail the build when the seed stops reaching the catalog.

    Two failure modes, both silent without this:

    * **Seed names that match nothing.** An upstream rename would quietly move
      augments from "acquirable" to "must own", shrinking owned-mode's pool.
    * **An empty stamp over a non-empty seed.** The join key changed.

    The join was exact at harvest time — 675 of 675 seed names matched a catalog
    augment — so any unmatched name is new drift, not a known gap. That is why
    this is an equality check rather than a threshold.
    """
    seed_size = coverage.get("seed_size", 0)
    if not seed_size:
        return                                   # no overlay shipped; nothing to guard
    if not coverage.get("augments"):
        raise SystemExit(
            "augment acquirability: the catalog carries no augment records at all — "
            "the guard would inspect nothing")
    stamped = coverage.get("stamped", 0)
    if stamped != seed_size:
        raise SystemExit(
            f"augment acquirability: {seed_size - stamped} of {seed_size} seeded names "
            f"reached no augment record (stamped {stamped}). The join is by exact name "
            f"and was complete when harvested, so this is upstream drift: re-harvest "
            f"{os.path.basename(seed_path)} against the wiki's rarity categories rather "
            "than lowering this check — a silently smaller acquirable set makes "
            "owned-augment mode quietly forget augments the player can buy.")
