// #899 — the wiki delta: every Item: page created or edited since our upstream pin.
//
// gear-planner is the catalog's baseline. When it stops updating (#223, 2026-10-14)
// the wiki keeps moving, and this snippet is how we see what moved. It reads
// RecentChanges for the Item: namespace since a date — normally SOURCE.json's
// `upstream_commit_date` — and, for each page, its infobox fields, its
// enchantment lines, and its rendered tooltips (the evidence layer).
//
// It does NOT decide anything. `scripts/triage_wiki_delta.py` classifies the dump
// (already upstream / cosmetic / sibling-buildable / manual) and drafts
// `wiki_supplement_items.json` entries for review. See
// docs/wiki-evidence/harvest-method.md, "When upstream is stale".
//
// HOW TO RUN: open any https://ddowiki.com page, DevTools > Console, set SINCE,
// paste. Paced at ~1.8 s per request with backoff (ddowiki throttles bursts).
// The full dump is `window.__delta.items`; `copy(JSON.stringify(window.__delta))`
// puts it on the clipboard for scripts/triage_wiki_delta.py.
//
// Via the Browser pane, return `window.__delta.summaryText` only: the privacy
// guard strips `| = & ?`, which corrupts wikitext, so the raw dump cannot come
// back that way. The summary encodes `|` as `~` for that reason.
//
// A throttled ddowiki answers the API with HTTP 202 and an empty body. Every call
// refreshes clearance (a hidden same-origin page load, as harvest_items.js does)
// and backs off before retrying. If RecentChanges still cannot be read, or reads
// zero changed pages, the run stops with `done: false` and says why in
// `window.__delta.state`: an empty delta is indistinguishable from a throttled
// one, and on 2026-10-24 a throttled read finished `done: true` with 0 items.

(async () => {
  const SINCE = window.__deltaSince || "2026-10-13"; // SOURCE.json upstream_commit_date
  const PACE_MS = 1800;
  const D = (window.__delta = { since: SINCE, harvested: new Date().toISOString(), items: {}, done: false,
    state: "running", throttles: 0 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const refreshClearance = async () => {
    const f = document.createElement("iframe");
    f.style.display = "none";
    f.src = "/page/Main_Page?delta=" + Date.now();
    document.body.appendChild(f);
    await new Promise((r) => { f.onload = r; setTimeout(r, 15000); });
    await sleep(4000);
    f.remove();
  };
  // null when every attempt came back throttled (or not JSON); never a stand-in {}.
  const api = async (params) => {
    for (let i = 0; i < 5; i++) {
      try {
        const res = await fetch("/api.php", { method: "POST", body: new URLSearchParams({ format: "json", ...params }) });
        return JSON.parse(await res.text());
      } catch (e) {
        D.throttles++;
        await refreshClearance();
        await sleep(5000 * (i + 1));
      }
    }
    return null;
  };

  // 1. Every Item: page created or edited since SINCE (newest first).
  const changed = new Map();
  let cont = {};
  for (let i = 0; i < 20; i++) {
    const r = await api({ action: "query", list: "recentchanges", rcnamespace: "500", rctype: "new|edit",
      rcprop: "title|timestamp|loginfo", rclimit: "500", rcend: SINCE + "T00:00:00Z", ...cont });
    if (!Array.isArray(r?.query?.recentchanges)) {
      D.state = "failed: RecentChanges unreadable (throttled) after " + changed.size + " pages; reload and re-run";
      return;
    }
    for (const c of r.query.recentchanges) {
      const t = c.title.replace(/^Item:/, "");
      const prev = changed.get(t) || { created: false, edits: 0 };
      if (c.type === "new") prev.created = true; else prev.edits++;
      changed.set(t, prev);
    }
    if (!r.continue) break;
    cont = { rccontinue: r.continue.rccontinue };
    await sleep(PACE_MS);
  }
  if (!changed.size) {
    D.state = "failed: RecentChanges lists 0 Item: pages since " + SINCE + "; check SINCE before trusting an empty delta";
    return;
  }

  // 2. Each page's infobox, enchantment lines and rendered tooltips.
  const pick = (wt, k) => { const m = wt.match(new RegExp("\\|\\s*" + k + "\\s*=\\s*([^\\n]*)", "i")); return m ? m[1].trim() : null; };
  for (const [title, meta] of changed) {
    await sleep(PACE_MS);
    const rev = await api({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: "Item:" + title });
    const page = Object.values(rev?.query?.pages || {})[0] || {};
    const wt = page.revisions ? page.revisions[0].slots.main["*"] : "";
    const i = wt.search(/\|\s*enhancements\s*=/i);
    const ench = [];
    if (i >= 0) for (const l of wt.slice(i).split("\n").slice(1)) { if (/^\s*\|/.test(l)) break; if (l.trim()) ench.push(l.trim()); }
    await sleep(PACE_MS);
    const par = await api({ action: "parse", page: "Item:" + title, prop: "text" });
    let tips = [];
    if (par?.parse) {
      const doc = new DOMParser().parseFromString(par.parse.text["*"], "text/html");
      tips = [...new Set([...doc.querySelectorAll("span.tooltip")].map((s) => s.textContent.replace(/\s+/g, " ").trim()))];
    }
    D.items[title] = { ...meta, missing: !wt,
      ml: pick(wt, "minimum level") || pick(wt, "minlevel"), type: pick(wt, "type"), slot: pick(wt, "slot"),
      enchantments: ench, tooltips: tips };
  }
  D.done = true;
  D.state = "done";
  const enc = (s) => String(s).replace(/\|/g, "~").replace(/[=&?]/g, " ");
  D.summaryText = enc(JSON.stringify(D));
  console.log(`harvested ${Object.keys(D.items).length} Item: pages changed since ${SINCE}`);
})();
