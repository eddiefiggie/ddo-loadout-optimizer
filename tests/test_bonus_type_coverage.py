"""#88 — the bonus-type coverage sweep, guarded instead of dated.

`docs/wiki-evidence/bonus-type-equivalence.md` claims "every stacking bucket the
built dataset produces was examined". That was true on 2026-08-10 and stopped
being true on 2026-08-18, when the canon migration introduced `Psionic` and
nobody re-ran the sweep. The type it missed was a live over-credit.

So the claim is now checked against the data on every build rather than asserted
with a date.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SEED = os.path.join(ROOT, "data", "seed", "compendium", "bonus_type_dispositions.json")
DATASET = os.path.join(ROOT, "web", "data", "items.json")
POOLS = ("dino_inserts", "nearly_complete", "viktranium", "seal",
         "thunder_forged", "green_steel")


def _live_types(d):
    """Every distinct bonus type the built dataset produces, across all channels."""
    out = set()
    for v in d.get("items", []):
        for a in v.get("affixes") or []:
            out.add(a.get("type") if a.get("type") is not None else "(null)")
    for pool in POOLS:
        for r in d.get(pool) or []:
            for a in r.get("affixes") or []:
                t = a.get("bonus_type", a.get("type"))
                out.add(t if t is not None else "(null)")
    return out


def _dispositions():
    with open(SEED, encoding="utf-8") as fh:
        return json.load(fh)["types"]


def test_every_live_bonus_type_is_dispositioned():
    """The guard proper: a NEW type upstream fails the build.

    Failing here is not a defect in the data — it means a bucket exists that
    nobody has ruled on, which is exactly the state that let `Psionic` ship an
    unconditional +24 Universal Spell Power. Read the type's carriers against the
    wiki, then add it to the seed with its disposition.
    """
    if not os.path.exists(DATASET):
        return
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    live = _live_types(d)
    known = set(_dispositions())
    assert len(live) > 20, "the guard inspects a real population, not an empty one"
    undispositioned = sorted(live - known)
    assert not undispositioned, (
        f"bonus type(s) with no disposition: {undispositioned}. A new stacking bucket "
        "arrived upstream and no one has ruled on it. Read its carriers against the "
        "wiki and add it to bonus_type_dispositions.json — do not add it as "
        "'legitimate' without reading, which is how Psionic shipped an unconditional "
        "+24 Universal Spell Power for a buff that needs you to be hit.")


def test_the_seed_does_not_disposition_types_that_no_longer_exist():
    """The other direction — a stale disposition is a smaller problem than an
    undispositioned type, but it means the seed is describing a dataset that is
    gone, which makes the coverage count misleading."""
    if not os.path.exists(DATASET):
        return
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    stale = sorted(set(_dispositions()) - _live_types(d))
    assert not stale, (
        f"disposition(s) for type(s) the dataset no longer produces: {stale}. "
        "Retire them deliberately so the coverage count means what it says.")


def test_dispositions_use_the_closed_vocabulary():
    doc = json.load(open(SEED, encoding="utf-8"))
    allowed = set(doc["_dispositions"])
    for name, disp in doc["types"].items():
        assert disp in allowed, f"{name}: unknown disposition {disp!r}"


def test_psionic_is_gone_and_stays_gone():
    """The specific defect #88's sweep refresh found.

    `Universal Spell Power | Psionic | 24` is the fully-stacked maximum of a buff
    the wiki states is conditional (on taking physical damage), ramping (three
    stacks) and temporary (20s). It cross-adds into all ten element spellpowers,
    so crediting it flat over-credits every spellpower a caster ranks.
    """
    if not os.path.exists(DATASET):
        return
    with open(DATASET, encoding="utf-8") as fh:
        d = json.load(fh)
    assert "Psionic" not in _live_types(d), "the conditional Psionic affix is credited again"
    for name in ("Meridian Fragment", "Crystallized Drop of Tea"):
        rec = next((v for v in d["items"] if v.get("variant_id") == name), None)
        assert rec is not None, f"{name} left the roster — re-verify the ruling"
        assert rec.get("affixes"), f"{name} lost every affix; only the Psionic one should go"
        assert not any(a.get("type") == "Psionic" for a in rec["affixes"])
