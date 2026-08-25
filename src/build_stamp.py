"""The build stamp: parsing, ordering, and which paths oblige it to move.

`mmddyyyy.N` — a date plus that day's build iteration. Three files carry it and
have to agree (`web/app.js`'s `BUILD`, every `?v=` in `web/index.html`,
`README.md`'s `**Current build:**` line); `tests/test_build_stamp.py` pins that
agreement from the tree alone.

#467 — agreement is not enough. The guard pinned the three values against EACH
OTHER and none of them against the previously deployed value, so it could not
tell "bumped" from "bumped to the value already shipped" or from "bumped
backwards". Both are green, and both put a footer in front of players that
under-reports what is actually serving.

The ordering and path rules live HERE, as pure functions over strings, so
`tests/` can assert them without reading git — the objection that kept the
original guard history-free still stands. The part that genuinely needs history
is `scripts/check_stamp_advanced.py`, which CI invokes by path.

ORDERING IS NUMERIC, NOT LEXICOGRAPHIC. `08242026.10` follows `08242026.9`, and
string comparison puts it *before* — `"10" < "9"`. That is not hypothetical: the
2026-08-24 batch reached `.10` in a single day.
"""
import re

STAMP_RE = re.compile(r"^(\d{2})(\d{2})(\d{4})\.(\d+)$")

#: A change under any of these obliges the stamp to move: it alters what a
#: player gets. `web/` is the app itself; the rest is the pipeline that produces
#: the dataset the app fetches `no-cache`, so a data-only merge changes every
#: solve on the live site the moment it deploys (AGENTS.md, and PR #294, which
#: changed every caster solve while the footer claimed nothing happened).
PLAYER_FACING_PREFIXES = ("web/", "src/", "data/seed/")
PLAYER_FACING_FILES = ("build_dataset.py",)

#: Deliberately NOT player-facing, even though they live under a prefix above:
#: the generated dataset is gitignored (it can never appear in a diff, but say so),
#: and `web/data/` holds nothing hand-edited.
_EXEMPT_PREFIXES = ("web/data/",)


def parse_stamp(text):
    """`mmddyyyy.N` -> a sortable `(yyyy, mm, dd, n)` tuple, or None if malformed.

    Returns None rather than raising: callers report the bad value with context
    a bare ValueError could not carry.
    """
    m = STAMP_RE.match((text or "").strip())
    if not m:
        return None
    mm, dd, yyyy, n = m.groups()
    if not (1 <= int(mm) <= 12 and 1 <= int(dd) <= 31):
        return None
    return (int(yyyy), int(mm), int(dd), int(n))


def stamp_is_after(candidate, previous):
    """True when `candidate` is strictly newer than `previous`. Malformed -> False."""
    a, b = parse_stamp(candidate), parse_stamp(previous)
    if a is None or b is None:
        return False
    return a > b


def requires_stamp_bump(changed_paths):
    """The player-facing subset of `changed_paths` — empty means no bump is owed.

    Returns the paths rather than a bool so a failure can NAME what obliged the
    bump. "Something you touched is player-facing" is not an actionable message.
    """
    hits = []
    for raw in changed_paths or ():
        path = str(raw).strip().replace("\\", "/").lstrip("./")
        if not path or path.startswith(_EXEMPT_PREFIXES):
            continue
        if path.startswith(PLAYER_FACING_PREFIXES) or path in PLAYER_FACING_FILES:
            hits.append(path)
    return hits
