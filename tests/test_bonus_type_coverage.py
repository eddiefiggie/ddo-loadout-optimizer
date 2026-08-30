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
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SEED = os.path.join(ROOT, "data", "seed", "compendium", "bonus_type_dispositions.json")
DATASET = os.path.join(ROOT, "web", "data", "items.json")
#: #140 — the OTHER place a bonus type can enter the model. `COMPOSITE_COMPONENTS`
#: decomposes boolean composites at load time in the browser, so the types it mints
#: never appear in the built JSON and were invisible to this guard. `Morale` is the
#: first type to arrive that way; before it, every composite emitted `Enhancement`,
#: which the dataset already carried, so the hole was real but unoccupied.
NORMALIZER = os.path.join(ROOT, "web", "dataset.js")
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


def _composite_types():
    """Bonus types minted by web/dataset.js's COMPOSITE_COMPONENTS.

    Read from the flat `COMPOSITE_COMPONENT_TYPES` literal rather than executed:
    this suite is stdlib-only and must not depend on a node runtime. Scraping the
    table itself does not work — a component built through a helper keeps its type
    literal outside the declaration, which is exactly how `Morale` was missed on the
    first attempt at this guard. tests/dataset.test.js pins the mirror against the
    live table so it cannot drift.
    """
    with open(NORMALIZER, encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(r"var COMPOSITE_COMPONENT_TYPES = \[([^\]]*)\];", src)
    found = set(re.findall(r'"([^"]+)"', m.group(1))) if m else set()
    assert found, (
        "no bonus types were read out of COMPOSITE_COMPONENT_TYPES — the declaration "
        "in web/dataset.js moved or changed shape, so this guard is inspecting "
        "nothing. tests/dataset.test.js pins that literal against the live table.")
    return found


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
    live = _live_types(d) | _composite_types()
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
    stale = sorted(set(_dispositions()) - (_live_types(d) | _composite_types()))
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


# --- #225: a dormant guard, made live -----------------------------------------

#: `src/affix_parser.py` treats `Insight` and `Insightful` as distinct stacking
#: buckets, and `tests/test_affix_parser.py` pins that. Since gear-planner became
#: the structural source of truth for item affixes (#69), NOTHING in the shipping
#: dataset flows through that distinction — so the guard reads as active
#: protection and protects nothing, which is how #225 came to be filed after
#: testers reported "insight and insightful stacking wrong" and the existing test
#: made it look like a settled question.
#:
#: Measured on 2026-08-30: nine channels emit `Insight`, none emits `Insightful`.
#: That disproves #225's second possibility — a live pool minting `Insightful`
#: while gear-planner mints `Insight`, putting one mechanic in two buckets that
#: WOULD stack. The parser is still called by viktranium, seal, nearly_complete,
#: dino, thunder_forged and green_steel; none of them produces the type.
#:
#: So the protection moves here, where it can actually fail. The moment any
#: channel mints `Insightful`, this names it — and that is exactly when the open
#: wiki question ("is Insightful a distinct bonus type, or the affix NAME for a
#: bonus whose type is Insight?") has to be answered before the data ships.
_INSIGHTFUL = "Insightful"


def _every_bonus_type_by_channel(dataset):
    """{bonus type: {channels that mint it}} across every channel in the file."""
    found = {}

    def walk(node, channel):
        if isinstance(node, dict):
            for key in ("bonus_type", "type"):
                value = node.get(key)
                if isinstance(value, str) and value:
                    found.setdefault(value, set()).add(channel)
            for value in node.values():
                walk(value, channel)
        elif isinstance(node, list):
            for value in node:
                walk(value, channel)

    for channel, value in dataset.items():
        if channel == "metadata":
            continue
        walk(value, channel)
    return found


def test_no_channel_mints_insightful_as_a_bonus_type():
    with open(DATASET) as fh:
        dataset = json.load(fh)
    by_type = _every_bonus_type_by_channel(dataset)

    # Non-vacuity: the walker must actually be reaching typed records. Without
    # this a rename of `bonus_type` would empty the map and the assertion below
    # would pass by inspecting nothing — the shape this repo bans.
    assert by_type.get("Insight"), \
        "the walker found no `Insight` at all, so it is not reading typed records"
    assert len(by_type) > 15, f"only {len(by_type)} bonus types found; the walk is not covering the file"

    channels = sorted(by_type.get(_INSIGHTFUL, ()))
    assert not channels, (
        f"{_INSIGHTFUL!r} is now minted as a bonus TYPE by: {', '.join(channels)}. "
        "gear-planner emits `Insight` for the same mechanic, so these are two buckets "
        "for one thing and they will stack. Settle the wiki question in #225 — is "
        "`Insightful` a distinct bonus type, or the affix NAME for a bonus whose type "
        "is Insight? — before this data ships.")


def test_the_parser_still_carries_the_distinction_it_is_tested_for():
    """The parser's own vocabulary is unchanged; what moved is where the claim is
    CHECKED. If `Insightful` ever leaves `src/affix_parser.py`'s type list, the
    guard above starts asserting the absence of something nothing could produce,
    and would keep passing for the wrong reason."""
    from src import affix_parser
    assert _INSIGHTFUL in affix_parser.BONUS_TYPES, (
        "the parser no longer knows `Insightful`, so the dataset guard above can no "
        "longer fail for the reason it was written — retire them together.")
