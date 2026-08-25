"""Build-stamp drift guard: README, the footer BUILD, and the `?v=` cache-busts.

Three values have to move together when `web/` ships, and nothing enforced it:

  * `const BUILD` in `web/app.js` — what the live footer prints.
  * every `?v=N` in `web/index.html` — the cache-bust that makes browsers fetch
    the new assets at all. GitHub Pages has no content hashing, so a stale `?v=`
    means users keep running the old code no matter what deployed.
  * the `**Current build:**` line in `README.md` — the repo's own claim about
    what is live.

They have drifted before: four PRs bumped neither, and the footer under-reported
the deployed build for two days while the site itself served fresh assets. This
guard turns that class of mistake into a failed build instead of a quiet wrong
number a reader has no way to doubt.

It deliberately does NOT try to prove the stamp MOVED — that needs history, and a
guard that reads git is a guard that breaks in a shallow clone. It pins what is
checkable from the tree alone: internal consistency, and that the README's claim
matches the code. The directional half lives in `scripts/check_stamp_advanced.py`,
which `.github/workflows/ci.yml` invokes by path where a real checkout exists —
the same split the perf gate uses, and for the same reason.

#467 closed two holes here:

  * `?v=` was an independent integer with NOTHING tying it to `BUILD`, so bumping
    the footer and leaving the cache-bust alone was green — a footer claiming a new
    build while returning visitors ran cached assets, which is the exact failure the
    list above says this guard exists to prevent. The cache-bust IS the stamp now,
    so the two cannot drift; `test_cache_bust_is_the_build_stamp` pins it.
  * The stamp could move BACKWARDS, or not move at all, with all three values in
    perfect agreement. That half needs a previous value and is not checkable here.
    See the CI script.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import build_stamp as B  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BUILD_RE = re.compile(r'const\s+BUILD\s*=\s*"([^"]+)"')
VERSION_RE = re.compile(r"\?v=([0-9.]+)")
README_BUILD_RE = re.compile(r"\*\*Current build:\*\*\s*([0-9.]+)")


def _read(*parts):
    with open(os.path.join(ROOT, *parts), "r", encoding="utf-8") as fh:
        return fh.read()


def _app_build():
    match = BUILD_RE.search(_read("web", "app.js"))
    assert match, "web/app.js no longer declares `const BUILD = \"...\"`"
    return match.group(1)


def test_app_build_stamp_is_well_formed():
    """mmddyyyy.N — the date-based build convention."""
    build = _app_build()
    assert re.fullmatch(r"\d{8}\.\d+", build), build


def test_every_cache_bust_in_index_uses_one_version():
    """A single stale `?v=` ships old code to returning visitors.

    Every asset reference has to move together; one missed line silently pins
    that file to whatever the browser already cached.
    """
    versions = set(VERSION_RE.findall(_read("web", "index.html")))
    assert versions, "web/index.html carries no ?v= cache-busts — did the convention change?"
    assert len(versions) == 1, (
        f"web/index.html mixes cache-bust versions {sorted(versions)} — every asset "
        "must bump together, or the stragglers keep serving cached code")


def test_readme_current_build_matches_the_shipped_stamp():
    """The README's claim about what is live must match what the footer will print."""
    match = README_BUILD_RE.search(_read("README.md"))
    assert match, (
        "README.md no longer carries a `**Current build:** <stamp>` line — it is the "
        "repo's own statement of what is deployed, and this guard is what keeps it true")
    readme_build = match.group(1)
    app_build = _app_build()
    assert readme_build == app_build, (
        f"README says the current build is {readme_build}, but web/app.js ships "
        f"{app_build}. Bump the README line in the same commit as the footer stamp "
        "and the ?v= cache-busts — all three move together.")


def test_cache_bust_is_the_build_stamp():
    """#467 — `?v=` and `BUILD` are the same string, so they cannot drift apart.

    Before this they were unrelated: `?v=` counted 179, 180, 181... while `BUILD`
    carried a date. Nothing compared them, so a commit that bumped the footer and
    the README but missed `web/index.html` passed all three assertions while
    shipping stale assets to every returning visitor.

    Tying them removes the failure mode rather than detecting it — there is no
    longer a second value to forget.
    """
    versions = set(VERSION_RE.findall(_read("web", "index.html")))
    build = _app_build()
    assert versions == {build}, (
        f"web/index.html cache-busts {sorted(versions)} but web/app.js ships {build}. "
        "The `?v=` value IS the build stamp — bump them to the same string, or a "
        "returning visitor keeps running the code they already cached while the "
        "footer claims otherwise.")


# --- #467: the ordering and path rules the CI directional check rests on --------
# Pure functions over strings, asserted here so `tests/` stays shallow-clone-safe.
# The half that needs history is scripts/check_stamp_advanced.py.

def test_stamp_ordering_is_numeric_not_lexicographic():
    """`.10` follows `.9`. String comparison puts it BEFORE, and that is not
    hypothetical — the 2026-08-24 batch reached `.10` in a single day."""
    assert B.stamp_is_after("08242026.10", "08242026.9")
    assert not B.stamp_is_after("08242026.9", "08242026.10")
    assert "08242026.10" < "08242026.9", (
        "the lexicographic trap this ordering exists to avoid has stopped being real —"
        " if that is genuinely true the comment above should change, but check first")


def test_a_stamp_that_did_not_move_is_not_an_advance():
    """The variant that actually fired on 2026-08-24: two branches independently
    bumped to the same value from the same base, git merged them with no conflict,
    and the stamp stood still while a second player-facing change shipped."""
    assert not B.stamp_is_after("08242026.8", "08242026.8")


def test_a_reverted_stamp_is_not_an_advance():
    """Gap 1 as filed: consistent across all three files, one day older."""
    assert not B.stamp_is_after("08232026.3", "08242026.3"), "a day older"
    assert not B.stamp_is_after("08242026.2", "08242026.3"), "same day, lower iteration"
    assert B.stamp_is_after("08252026.1", "08242026.99"), "a new day outranks any iteration"


def test_a_malformed_stamp_never_counts_as_an_advance():
    """Refuse rather than guess. A stamp that will not parse is a failure to report,
    and returning True here would let a typo through as progress."""
    for bad in ["", None, "not-a-stamp", "8242026.1", "08242026", "08242026.",
                "13012026.1", "08322026.1", "08242026.1.2"]:
        assert B.parse_stamp(bad) is None, bad
        assert not B.stamp_is_after(bad, "08242026.1"), bad
        assert not B.stamp_is_after("08242026.2", bad), bad


def test_only_player_facing_paths_oblige_a_bump():
    """AGENTS.md's trigger is behaviour, not file location: `web/` code AND the
    pipeline that produces the dataset the app fetches `no-cache`."""
    assert B.requires_stamp_bump(["web/app.js"]) == ["web/app.js"]
    assert B.requires_stamp_bump(["src/solver_notes.py"]) == ["src/solver_notes.py"]
    assert B.requires_stamp_bump(["data/seed/items.json"]) == ["data/seed/items.json"]
    assert B.requires_stamp_bump(["build_dataset.py"]) == ["build_dataset.py"]
    # Doc- and test-only changes owe nothing — PRs #506 and #510 were exactly that,
    # and requiring a bump there would train people to bump meaninglessly.
    assert B.requires_stamp_bump(["docs/plans/x.md", "tests/t.py", "AGENTS.md",
                                  ".github/workflows/ci.yml", "CONCEPTS.md"]) == []
    # The generated dataset is gitignored, so it cannot appear in a diff — but if it
    # ever does, it is not a hand edit and must not oblige anything.
    assert B.requires_stamp_bump(["web/data/items.json"]) == []
    # It NAMES the offenders rather than returning a bool: "something you touched is
    # player-facing" is not an actionable failure message.
    assert B.requires_stamp_bump(["docs/a.md", "web/results.js", "web/solver.js"]) == [
        "web/results.js", "web/solver.js"]
