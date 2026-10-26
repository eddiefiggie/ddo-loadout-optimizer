"""#905 — the item-harvest loader: a chunk is accepted only when both sides index
the same seed and the body survived the transfer intact."""
import base64
import gzip
import hashlib
import importlib.util
import json
import os
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("load_harvest", os.path.join(ROOT, "scripts", "load_harvest.py"))
L = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(L)

RAW = [{"url": "/page/Item:%2B1_Starter_Dagger"}, {"url": "/page/Item:Beacon_of_Day"},
       {"url": "/page/Item:Beacon_of_Day"}, {"url": "/page/Item:Ball_o%27_Yarn"}, {"name": "no url"}]
TITLES = L.seed_titles(RAW)


def _chunk(pages, frm=0, to=None, digest=None, sha=None, count=None):
    body = json.dumps(pages).encode()
    gz = base64.urlsafe_b64encode(gzip.compress(body)).decode().rstrip("=")
    to = len(TITLES) if to is None else to
    return {"kind": L.KIND, "v": 1, "id": "items-test", "digest": digest or L.digest(TITLES), "total": len(TITLES),
            "chunk": 0, "from": frm, "to": to, "count": len(pages) if count is None else count,
            "complete": len(pages) == to - frm, "sha256": sha or hashlib.sha256(body).hexdigest(), "gz": gz}


def _pages(n=None):
    return [{"i": i, "title": t, "missing": False, "redirect": None, "revid": 100 + i, "wikitext": "{{Named item}}"}
            for i, t in enumerate(TITLES[:n])]


def test_seed_titles_decode_dedupe_and_sort_by_code_point():
    assert TITLES == ["Item:+1 Starter Dagger", "Item:Ball o' Yarn", "Item:Beacon of Day"]


def test_a_good_chunk_round_trips_and_reports_coverage():
    with tempfile.TemporaryDirectory() as d:
        out = L.ingest(_chunk(_pages()), TITLES, root=d)
        assert out["pages"] == 3 and out["complete"] is True
        cov = L.coverage(L.load_pages("items-test", root=d), len(TITLES))
        assert cov == {"total": 3, "harvested": 3, "missing_pages": 0, "redirects": 0,
                       "resume_at": None, "complete": True}


def test_a_partial_harvest_names_the_index_to_resume_at():
    with tempfile.TemporaryDirectory() as d:
        L.ingest(_chunk(_pages(2), to=3), TITLES, root=d)
        cov = L.coverage(L.load_pages("items-test", root=d), len(TITLES))
        assert cov["resume_at"] == 2 and cov["complete"] is False


def _refused(chunk, needle):
    try:
        with tempfile.TemporaryDirectory() as d:
            L.ingest(chunk, TITLES, root=d)
    except L.HarvestError as e:
        assert needle in str(e), e
        return
    raise AssertionError("the loader accepted a chunk it must refuse")


def test_a_different_seed_is_refused():
    _refused(_chunk(_pages(), digest="0" * 64), "seed digest")


def test_a_corrupted_body_is_refused():
    _refused(_chunk(_pages(), sha="f" * 64), "corrupted")


def test_a_page_outside_its_chunk_range_is_refused():
    _refused(_chunk(_pages(), to=2), "outside")


def test_a_page_whose_title_disagrees_with_the_seed_is_refused():
    pages = _pages()
    pages[1]["title"] = "Item:Something Else"
    _refused(_chunk(pages), "is not the seed's")


def test_a_count_mismatch_is_refused():
    _refused(_chunk(_pages(), count=5), "the chunk says")


def test_padding_that_forces_a_small_chunk_to_a_file_is_dropped():
    with tempfile.TemporaryDirectory() as d:
        chunk = dict(_chunk(_pages()), pad="x" * 1000)
        out = L.ingest(chunk, TITLES, root=d)
        with gzip.open(out["path"], "rt", encoding="utf-8") as fh:
            assert "pad" not in json.load(fh)["meta"]


def test_unwrap_reads_the_saved_tool_result_shape():
    chunk = _chunk(_pages())
    saved = json.dumps([{"type": "text", "text": json.dumps(json.dumps(chunk))
                         + "\n\n(captured at origin https://ddowiki.com)"}])
    assert L.unwrap(saved) == chunk
    assert L.unwrap(json.dumps(chunk)) == chunk


def test_the_real_seed_yields_a_stable_title_list():
    with open(L.SEED, encoding="utf-8") as fh:
        titles = L.seed_titles(json.load(fh))
    assert len(titles) > 8000 and titles == sorted(titles) and len(set(titles)) == len(titles)
    assert all(t.startswith("Item:") for t in titles), [t for t in titles if not t.startswith("Item:")][:5]


# #908 — an explicit title list (set pages, `Named item sets`) instead of the item seed.

def test_explicit_titles_dedupe_and_sort_like_the_snippet():
    assert L.explicit_titles(["Named item sets", "Abishai Set", "Named item sets"]) == ["Abishai Set", "Named item sets"]


def test_an_empty_or_non_list_title_file_is_refused():
    for bad in ([], {"titles": ["x"]}):
        try:
            L.explicit_titles(bad)
        except L.HarvestError:
            continue
        raise AssertionError(f"accepted a title file it must refuse: {bad!r}")


def test_a_seed_chunk_is_refused_under_an_explicit_title_list():
    explicit = L.explicit_titles(["Named item sets"])
    with tempfile.TemporaryDirectory() as d:
        try:
            L.ingest(_chunk(_pages()), explicit, root=d)
        except L.HarvestError as e:
            assert "seed digest" in str(e)
            return
    raise AssertionError("an item-seed chunk was ingested against an explicit title list")


def test_main_ingests_and_reports_an_explicit_title_harvest():
    with tempfile.TemporaryDirectory() as d:
        tfile = os.path.join(d, "titles.json")
        with open(tfile, "w") as fh:
            json.dump(["Named item sets"], fh)
        titles = L.explicit_titles(["Named item sets"])
        pages = [{"i": 0, "title": "Named item sets", "missing": False, "redirect": None, "revid": 1,
                  "wikitext": "==Sets==", "html": "<div></div>", "html_revid": 1}]
        body = json.dumps(pages).encode()
        chunk = {"kind": L.KIND, "v": 1, "id": "pages-test", "digest": L.digest(titles), "total": 1, "chunk": 0,
                 "from": 0, "to": 1, "count": 1, "complete": True, "titles": True, "parse": True,
                 "sha256": hashlib.sha256(body).hexdigest(),
                 "gz": base64.urlsafe_b64encode(gzip.compress(body)).decode().rstrip("=")}
        cfile = os.path.join(d, "chunk.json")
        with open(cfile, "w") as fh:
            json.dump(chunk, fh)
        out, L.OUT = L.OUT, os.path.join(d, "harvest")
        try:
            assert L.main(["--titles", tfile, "ingest", cfile]) == 0
            assert L.main(["ingest", cfile]) == 1           # against the item seed: refused
            assert L.load_pages("pages-test")[0]["html"] == "<div></div>"
        finally:
            L.OUT = out


def test_every_committed_title_file_is_a_readable_list():
    d = os.path.join(ROOT, "data", "harvest_titles")
    files = [f for f in os.listdir(d) if f.endswith(".json")]
    assert files, "no title files under data/harvest_titles/ — the guard inspected nothing"
    for f in files:
        with open(os.path.join(d, f), encoding="utf-8") as fh:
            assert L.explicit_titles(json.load(fh)), f
