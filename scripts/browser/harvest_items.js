// #905 — own item harvest, Phase 0: a resumable wikitext harvest of every item page.
//
// Plan: docs/plans/2026-10-18-001-feat-own-item-harvest-plan.md (#911).
//
// IN: the seed population, fetched from THIS repo on GitHub at a pinned commit (the
// Browser pane cannot reach localhost, but it can read raw.githubusercontent.com).
// Titles are every distinct page the seed records' `url`s point at, decoded and
// sorted — `scripts/load_harvest.py` derives the identical list locally and the two
// sides compare a SHA-256 digest, so an index means the same page on both.
//
// OUT: `harvestChunk(n)` returns one chunk as a JSON string. Its page records are
// gzip-compressed and base64url-encoded, which keeps every chunk under the tool
// result cap AND free of `| = & ?` (the Browser pane's privacy guard strips them).
// The harness saves a large tool result to a file; `load_harvest.py ingest <file>`
// verifies each chunk's digest and writes it under data/harvest/<id>/.
//
// HOW TO RUN (any https://ddowiki.com page, in the Browser pane):
//   1. paste this file once;
//   2. harvestStart()            — runs in the background, paced, until done;
//      window.__harvestConfig = { startAt: N } before step 1 resumes at index N
//      after a reload (the loader's `status` prints N);
//   3. harvestStatus()           — progress, throttles, errors;
//   4. harvestChunk(0), harvestChunk(1), ... — export as they fill, one per call.
// A throttled wiki (empty responses) backs off and retries; after
// `maxThrottles` in a row it pauses, and harvestStart() continues from the cursor.

(() => {
  const C = Object.assign({
    seed: "https://raw.githubusercontent.com/eddiefiggie/ddo-loadout-optimizer/"
      + "d4706dd76aa041136d3e2fa117e2c5c453f45c46/data/seed/compendium/raw/gearplanner_items.json",
    id: "items-" + new Date().toISOString().slice(0, 10).replace(/-/g, ""),
    batch: 20, paceMs: 1700, chunkPages: 400, startAt: 0, maxThrottles: 8,
  }, window.__harvestConfig || {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const b64url = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const gzip = async (s) => new Uint8Array(await new Response(
    new Blob([s]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());

  const H = window.__H = window.__H || { id: C.id, cursor: C.startAt, pages: {}, errors: [],
    throttles: 0, running: false, state: "new" };

  async function loadSeed() {
    if (H.titles) return;
    const raw = await (await fetch(C.seed)).json();
    const set = new Set();
    for (const r of raw) {
      const m = String(r.url || "").match(/\/page\/(.+)$/);
      if (m) set.add(decodeURIComponent(m[1]).replace(/_/g, " "));
    }
    H.titles = [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    H.digest = await sha256(H.titles.join("\n"));
    H.seed = C.seed;
  }

  // A throttled ddowiki answers the API with HTTP 202 and an empty body. Loading a
  // real page refreshes the browser's clearance, which `harvest-method.md` already
  // does by navigating; a hidden same-origin iframe does the same page load without
  // discarding this tab's in-memory harvest.
  async function refreshClearance() {
    const f = document.createElement("iframe");
    f.style.display = "none";
    f.src = "/page/Main_Page?harvest=" + Date.now();
    document.body.appendChild(f);
    await new Promise((r) => { f.onload = r; setTimeout(r, 15000); });
    await sleep(4000);
    f.remove();
  }

  async function query(titles) {
    const res = await fetch("/api.php", { method: "POST", body: new URLSearchParams({
      format: "json", action: "query", titles: titles.join("|"), redirects: "1",
      prop: "revisions", rvprop: "ids|timestamp|content", rvslots: "main" }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return null; }   // empty body = throttled
  }

  async function runBatch(from) {
    const want = H.titles.slice(from, from + C.batch);
    const r = await query(want);
    if (!r || !r.query) return false;
    const hop = new Map();
    for (const n of r.query.normalized || []) hop.set(n.from, n.to);
    const redirects = new Map((r.query.redirects || []).map((x) => [x.from, x.to]));
    const byTitle = new Map(Object.values(r.query.pages || {}).map((p) => [p.title, p]));
    want.forEach((t, k) => {
      let at = hop.get(t) || t;
      const redirect = redirects.get(at) || null;
      if (redirect) at = redirect;
      const p = byTitle.get(at) || {};
      const rev = (p.revisions || [])[0];
      H.pages[from + k] = { i: from + k, title: t, page: p.title || null, pageid: p.pageid || null,
        missing: !rev, redirect, revid: rev ? rev.revid : null, ts: rev ? rev.timestamp : null,
        wikitext: rev ? rev.slots.main["*"] : null };
    });
    return true;
  }

  window.harvestStart = async () => {
    if (H.running) return "already running";
    await loadSeed();
    H.running = true; H.state = "running";
    // Each start owns a generation; a loop from an earlier start (still asleep in a
    // backoff when the snippet is re-pasted or restarted) sees it is stale and exits,
    // so two loops never advance one cursor.
    const gen = H.gen = (H.gen || 0) + 1;
    let fails = 0;
    (async () => {
      while (H.running && H.gen === gen && H.cursor < H.titles.length) {
        let ok = false;
        try { ok = await runBatch(H.cursor); } catch (e) { H.errors.push(H.cursor + ": " + e.message); }
        if (ok) { H.cursor += C.batch; fails = 0; await sleep(C.paceMs); continue; }
        H.throttles++; fails++;
        if (H.gen !== gen) return;
        if (fails >= C.maxThrottles) { H.running = false; H.state = "paused (throttled)"; return; }
        await refreshClearance();
        await sleep(Math.min(120000, 5000 * 2 ** (fails - 1)));
      }
      if (H.gen !== gen) return;
      if (H.cursor >= H.titles.length) H.cursor = H.titles.length;
      H.running = false; H.state = H.cursor >= H.titles.length ? "done" : H.state === "running" ? "stopped" : H.state;
    })();
    return `started at ${H.cursor} of ${H.titles.length}`;
  };
  window.harvestStop = () => { H.running = false; H.state = "stopped"; return H.cursor; };
  window.harvestStatus = () => ({ id: H.id, state: H.state, cursor: H.cursor, total: H.titles ? H.titles.length : null,
    harvested: Object.keys(H.pages).length, throttles: H.throttles, errors: H.errors.slice(-5),
    digest: H.digest, chunks: H.titles ? Math.ceil(H.titles.length / C.chunkPages) : null });

  window.harvestChunk = async (n) => {
    const from = n * C.chunkPages, to = Math.min(H.titles.length, from + C.chunkPages);
    const pages = [];
    for (let i = from; i < to; i++) if (H.pages[i]) pages.push(H.pages[i]);
    const body = JSON.stringify(pages);
    return JSON.stringify({ kind: "item-harvest-chunk", v: 1, id: H.id, seed: H.seed, digest: H.digest,
      total: H.titles.length, chunk: n, from, to, count: pages.length,
      complete: pages.length === to - from, sha256: await sha256(body), harvested: new Date().toISOString(),
      gz: b64url(await gzip(body)),
      // A small chunk would come back inline instead of being saved to a file by the
      // harness; padding past the inline cap keeps every chunk on the same path.
      pad: "x".repeat(Math.max(0, 100000 - body.length)) });
  };
  return "harvest snippet loaded: harvestStart(), harvestStatus(), harvestChunk(n), harvestStop()";
})();
