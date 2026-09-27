"""Wiki links for where gear and augments come from.

WHY

The Loadout card and the Farming List name a quest, an adventure pack and a crafting
step, and until now left the player to look each one up by hand. This stage stamps the
DDO wiki page for each onto the dataset, so the renderer links a name rather than
printing it.

It also supplies the one thing the Farming List could not say at all: where an AUGMENT
comes from. gear-planner records no acquisition data for any augment (`location_quest`
is empty on every one), so the list could name the gem to slot and never where to get
it. The wiki records it, in the `locations` field of each augment's own page, and
`data/seed/compendium/augment_locations.json` carries that harvest.

WHAT IT REFUSES TO DO

It never builds a link to a page nobody checked exists. A title reaches a URL only when:

  * a quest: the #495 pack harvest read that exact title's page (`via` is anything but
    `no wiki page`);
  * a pack: it is in `wiki_link_pages.json`, which lists only titles `prop=info`
    confirmed;
  * an augment: it is a named augment the locations harvest found a page for, or an
    acquirable one — all 675 of which are members of the wiki's rarity categories at
    exactly `Item:<name>`;
  * an augment's drop place: every one of the 112 was confirmed to exist.

A title that fails every test renders as plain text. A dead link would look exactly like
a live one until a player clicked it.

THE GUARD

`check()` fails the build when the harvest has fallen behind the catalog, in both
directions. A named augment with no entry would render with no source and no mention
that one was never looked up; a harvested name that matches nothing is an upstream
rename that has silently orphaned its entry.
"""
import json
import os
from urllib.parse import quote

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUGMENT_LOCATIONS = os.path.join(HERE, "data", "seed", "compendium", "augment_locations.json")
LINK_PAGES = os.path.join(HERE, "data", "seed", "compendium", "wiki_link_pages.json")

WIKI = "https://ddowiki.com/page/"

# The #495 harvest's code for "the title has no page". Every other `via` was read off
# the page of that exact title, so the page exists.
_NO_PAGE_VIA = "no wiki page"


def page_url(title: str) -> str:
    """The wiki URL for a page title: spaces become underscores, the rest is
    percent-encoded as the wiki's own links are (`+` -> `%2B`, `'` -> `%27`)."""
    return WIKI + quote(str(title).replace(" ", "_"), safe=":/(),!")


def _load(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load(locations_path: str = AUGMENT_LOCATIONS, pages_path: str = LINK_PAGES) -> dict:
    """Both shards, in one object. A missing file yields empty parts — the stage is
    additive, and `check()` is what notices that it ran on nothing."""
    locs = _load(locations_path)
    pages = _load(pages_path)
    return {
        "named": locs.get("named") or {},
        "common_prefix": locs.get("common_page_prefix") or None,
        "packs": set(pages.get("packs") or ()),
        "crafting": dict(pages.get("crafting") or {}),
    }


def _place(place: str) -> str:
    """The wiki writes an item-as-place with its namespace (`Item:Hunter Rune`); the
    player reads the item's name."""
    return place[len("Item:"):] if place.startswith("Item:") else place


def apply(records: list, links: dict, pack_mapping: dict) -> None:
    """Stamp the link fields, in place.

    Gear gains `location_url` and `location_pack_url`. Augments gain
    `augment_page_url` and — for a named augment with a page — `augment_locations`.
    Each is stamped only where it is known, so absence means "no page", never a
    falsy value written across the whole pool.
    """
    named = links.get("named") or {}
    packs = links.get("packs") or set()
    prefix = links.get("common_prefix")
    for rec in records:
        if (rec.get("category") or "") == "augment":
            name = rec.get("variant_id") or rec.get("name")
            if rec.get("acquirable"):
                if prefix:
                    rec["augment_page_url"] = page_url(prefix + name)
                continue
            entry = named.get(name) or {}
            if entry.get("page"):
                rec["augment_page_url"] = page_url(entry["page"])
                rec["augment_locations"] = [
                    {"place": _place(l["place"]), "place_url": page_url(l["place"]),
                     "how": l.get("how") or "", "detail": l.get("detail") or ""}
                    for l in entry.get("locations") or []
                ]
            continue
        src = rec.get("location_quest")
        hit = pack_mapping.get(src) if src else None
        if hit and hit.get("via") != _NO_PAGE_VIA:
            rec["location_url"] = page_url(src)
        pack = rec.get("location_pack")
        if pack and pack in packs:
            rec["location_pack_url"] = page_url(pack)


def crafting_urls(links: dict) -> dict:
    """`{craft family: url}` for the families whose page was confirmed."""
    return {fam: page_url(title) for fam, title in sorted((links.get("crafting") or {}).items())}


def check(records: list, links: dict, pack_mapping: dict) -> dict:
    """Fail the build when a shard has fallen behind the data it links.

    Refuses to inspect zero records, and refuses an empty harvest: a guard that passes
    over nothing is not a guard, and a missing shard would otherwise leave every augment
    linkless with a green build.
    """
    if not records:
        raise AssertionError("wiki links: refusing to inspect zero records")
    named = links.get("named") or {}
    if not named:
        raise AssertionError("wiki links: the augment-locations harvest is empty")

    augments = [r for r in records if (r.get("category") or "") == "augment"]
    catalog_named = {r.get("variant_id") for r in augments if not r.get("acquirable")}
    unharvested = sorted(catalog_named - set(named))
    orphaned = sorted(set(named) - catalog_named)
    if unharvested or orphaned:
        raise AssertionError(
            "wiki links: augment_locations.json no longer matches the catalog's named "
            f"augments — {len(unharvested)} never harvested {unharvested[:5]}, "
            f"{len(orphaned)} match nothing {orphaned[:5]}. Re-harvest the `locations` "
            "field for these per docs/wiki-evidence/augment-locations.md.")

    packs_needed = {e.get("pack") for e in pack_mapping.values()
                    if e.get("pack") and e.get("pack") != "Free to Play"}
    unverified_packs = sorted(packs_needed - (links.get("packs") or set()))
    if unverified_packs:
        raise AssertionError(
            f"wiki links: {len(unverified_packs)} adventure pack(s) have no verified page "
            f"{unverified_packs[:5]} — check each exists and add it to wiki_link_pages.json.")

    gear = [r for r in records if (r.get("category") or "") != "augment"]
    return {
        "augments": len(augments),
        "augments_linked": sum(1 for r in augments if r.get("augment_page_url")),
        "augments_with_locations": sum(1 for r in augments if r.get("augment_locations")),
        "named_without_page": sorted(n for n, e in named.items() if not e.get("page")),
        "gear_sourced": sum(1 for r in gear if r.get("location_quest")),
        "gear_source_linked": sum(1 for r in gear if r.get("location_url")),
        "gear_pack_linked": sum(1 for r in gear if r.get("location_pack_url")),
    }
