"""CONCEPTS.md cross-links must resolve (#256).

The glossary is one of two knowledge stores this repo keeps *so that problems are
not re-solved*, and a `[[link]]` naming no entry is the failure that store exists
to prevent: a reader follows the pointer, finds nothing, and re-derives whatever it
meant. Two such links shipped — both with the pipe reversed, `[[display|Target]]`
instead of `[[Target|display]]`, which reads correctly to a human and resolves to
nothing.

Enforced rather than re-documented, which is the recommendation
`docs/solutions/design-patterns/milp-encoding-for-gear-optimization.md` closes on.
"""
from __future__ import annotations

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONCEPTS = os.path.join(ROOT, "CONCEPTS.md")

_HEAD = re.compile(r"^### (.+)$", re.M)
_LINK = re.compile(r"\[\[([^\]]+)\]\]")


def _entries_and_links():
    with open(CONCEPTS, encoding="utf-8") as fh:
        text = fh.read()
    entries = {m.group(1).strip() for m in _HEAD.finditer(text)}
    # `[[Target|display text]]` — the target is the part BEFORE the pipe.
    links = {l.split("|")[0].strip() for l in _LINK.findall(text)}
    return entries, links


def test_every_concepts_link_names_a_real_entry():
    entries, links = _entries_and_links()
    assert len(entries) > 40, f"premise: a real glossary, saw {len(entries)} entries"
    assert len(links) > 20, f"premise: it actually cross-links, saw {len(links)}"
    dangling = sorted(l for l in links if l not in entries)
    assert not dangling, (
        f"{len(dangling)} CONCEPTS.md link(s) name no entry: {dangling}. "
        "If the pipe form was used, the TARGET goes first: [[Entry|display text]].")


def test_the_check_would_notice_a_broken_link():
    # Prove it can fail. Without this the assertion above passes on an empty
    # `dangling` list forever and proves only that the file parses.
    entries = {"Real Entry"}
    links = {"Real Entry", "No Such Entry"}
    assert sorted(l for l in links if l not in entries) == ["No Such Entry"]
