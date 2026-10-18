#!/usr/bin/env python3
"""#905 — load the item-harvest chunks `scripts/browser/harvest_items.js` exports.

Each chunk arrives as a saved tool result (the harness writes a large Browser-pane
result to a file). This script unwraps it, verifies it, and stores it:

  * the chunk's SEED DIGEST must equal the digest of the titles derived here from
    our own pinned seed — so a page index means the same page on both sides;
  * the decompressed body's SHA-256 must equal the chunk's own `sha256`;
  * every page record's index must fall inside the chunk's [from, to).

Stored as data/harvest/<id>/chunk-<from>.json.gz (gitignored). `status` reports
coverage against the seed: harvested, missing pages, redirects, and the first
index not yet harvested — the `startAt` for resuming after a reload.

Usage:
  python3 scripts/load_harvest.py ingest FILE [FILE ...]
  python3 scripts/load_harvest.py status [ID]
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
import sys
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, "data", "seed", "compendium", "raw", "gearplanner_items.json")
OUT = os.path.join(ROOT, "data", "harvest")
KIND = "item-harvest-chunk"


class HarvestError(ValueError):
    pass


def seed_titles(raw_items) -> list:
    """Every distinct page the seed records point at, exactly as the snippet derives
    it: the url's path after /page/, percent-decoded, `_` -> space, sorted by code
    point."""
    titles = set()
    for r in raw_items or []:
        url = str(r.get("url") or "")
        i = url.find("/page/")
        if i >= 0:
            titles.add(unquote(url[i + len("/page/"):]).replace("_", " "))
    return sorted(titles)


def digest(titles) -> str:
    return hashlib.sha256("\n".join(titles).encode("utf-8")).hexdigest()


def unwrap(text: str) -> dict:
    """The chunk object, from a saved tool result or a bare chunk.

    A saved Browser-pane result is a JSON list of `{type, text}` blocks whose first
    text is the returned value as a JSON string literal, followed by a
    "(captured at origin ...)" note. A bare chunk is the object itself."""
    text = text.strip()
    if text.startswith("["):
        blocks = json.loads(text)
        text = next(b["text"] for b in blocks if b.get("type") == "text")
    text = text.strip()
    if text.startswith('"'):
        text = json.loads(text[: text.rindex('"') + 1])
    obj = json.loads(text)
    if not isinstance(obj, dict) or obj.get("kind") != KIND:
        raise HarvestError("not an item-harvest chunk")
    return obj


def decode(chunk: dict, expected_digest: str) -> list:
    if chunk.get("digest") != expected_digest:
        raise HarvestError(f"chunk {chunk.get('chunk')}: seed digest {chunk.get('digest')!r} does not match "
                           f"the local seed's {expected_digest!r} — the two sides index different title lists")
    gz = chunk["gz"]
    body = gzip.decompress(base64.urlsafe_b64decode(gz + "=" * (-len(gz) % 4)))
    if hashlib.sha256(body).hexdigest() != chunk.get("sha256"):
        raise HarvestError(f"chunk {chunk.get('chunk')}: body digest mismatch — the transfer corrupted it")
    pages = json.loads(body)
    lo, hi = chunk["from"], chunk["to"]
    bad = [p.get("i") for p in pages if not (isinstance(p.get("i"), int) and lo <= p["i"] < hi)]
    if bad:
        raise HarvestError(f"chunk {chunk.get('chunk')}: page indexes {bad[:5]} fall outside [{lo}, {hi})")
    if len(pages) != chunk.get("count"):
        raise HarvestError(f"chunk {chunk.get('chunk')}: {len(pages)} pages but the chunk says {chunk.get('count')}")
    return pages


def ingest(chunk: dict, titles: list, root: str = OUT) -> dict:
    pages = decode(chunk, digest(titles))
    for p in pages:
        if titles[p["i"]] != p.get("title"):
            raise HarvestError(f"page {p['i']}: title {p.get('title')!r} is not the seed's {titles[p['i']]!r}")
    d = os.path.join(root, chunk["id"])
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"chunk-{chunk['from']:05d}.json.gz")
    meta = {k: v for k, v in chunk.items() if k != "gz"}
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump({"meta": meta, "pages": pages}, fh, ensure_ascii=False)
    return {"chunk": chunk["chunk"], "pages": len(pages), "complete": chunk.get("complete"), "path": path}


def load_pages(hid: str, root: str = OUT) -> dict:
    d = os.path.join(root, hid)
    out = {}
    for name in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if name.startswith("chunk-") and name.endswith(".json.gz"):
            with gzip.open(os.path.join(d, name), "rt", encoding="utf-8") as fh:
                for p in json.load(fh)["pages"]:
                    out[p["i"]] = p
    return out


def coverage(pages: dict, total: int) -> dict:
    have = sorted(pages)
    first_gap = next((i for i in range(total) if i not in pages), None)
    return {"total": total, "harvested": len(have),
            "missing_pages": sum(1 for p in pages.values() if p.get("missing")),
            "redirects": sum(1 for p in pages.values() if p.get("redirect")),
            "resume_at": first_gap, "complete": first_gap is None}


def _titles():
    with open(SEED, encoding="utf-8") as fh:
        return seed_titles(json.load(fh))


def main(argv):
    if not argv or argv[0] not in ("ingest", "status"):
        print(__doc__)
        return 2
    titles = _titles()
    if argv[0] == "ingest":
        rc = 0
        for f in argv[1:]:
            try:
                with open(f, encoding="utf-8") as fh:
                    print(json.dumps(ingest(unwrap(fh.read()), titles)))
            except HarvestError as e:
                print(f"REFUSED {f}: {e}")
                rc = 1
        return rc
    hid = argv[1] if len(argv) > 1 else sorted(os.listdir(OUT))[-1]
    print(json.dumps({"id": hid, **coverage(load_pages(hid), len(titles))}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
