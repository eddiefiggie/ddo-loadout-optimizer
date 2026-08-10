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

It deliberately does NOT try to prove `?v` was bumped *this* commit — that needs
history, and a guard that reads git is a guard that breaks in a shallow clone.
It pins what is checkable from the tree alone: internal consistency, and that the
README's claim matches the code.
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BUILD_RE = re.compile(r'const\s+BUILD\s*=\s*"([^"]+)"')
VERSION_RE = re.compile(r"\?v=(\d+)")
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
