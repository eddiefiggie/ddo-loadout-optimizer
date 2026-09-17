// #769 — read the wiki's own spelling of the three Slave Lord's sets.
//
// The Slaver's Set Bonus pools name `Slave Lord's Endurance`; the set catalog
// defines `Slave's Endurance`. `src/membership.py` drops the unmatched name and
// discloses it (`metadata.slavers_coverage.set_names_unresolved`) rather than
// mapping one onto the other, because a rename without a source is exactly the
// inference this project does not make. So no Slaver's host can be solved into
// the Endurance set, at either tier, until the wiki says which side is stale.
//
// Note what the catalog looks like before assuming the answer: two of the three
// sets are spelled `Slave Lord's` on BOTH sides, and only Endurance differs — so
// the catalog is the side that breaks its own pattern. That is a reason to read
// the page, not a reason to skip it.
//
// This is a read, not a harvest: `Named item sets` (pageid 9371) is where every
// other set definition in this project came from, and it states each set's name.
//
// HOW TO RUN: open any https://ddowiki.com page, DevTools > Console, paste. It
// prints the Slave* lines from the index with context, plus each candidate set
// page (a `#REDIRECT` is an answer — it is the wiki naming its own canonical
// title). The dump goes to the clipboard; paste it into the #769 thread.
//
// Via Claude-in-Chrome / the Browser pane, return `window.__sl.summaryText` only
// (stripped of `| = & ?`), never the raw dump.

(async () => {
  const INDEX_PAGEID = "9371"; // `Named item sets`
  // Both spellings, both tiers. Might and Sorcery are CONTROLS: they already
  // agree across pools and catalog, so if the index shows them and shows no
  // Endurance line, the read worked and the silence is the finding.
  const TITLES = [
    "Slave Lord's Endurance", "Slave's Endurance",
    "Legendary Slave Lord's Endurance", "Legendary Slave's Endurance",
    "Slave Lord's Might", "Slave Lord's Sorcery",
  ];
  const S = (window.__sl = window.__sl || {
    harvested: new Date().toISOString(), indexLines: [], pages: {}, missing: [], redirects: {},
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function post(paramsObj) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch("/api.php", { method: "POST", body: new URLSearchParams(paramsObj), credentials: "same-origin" });
      const text = await res.text();
      try { return JSON.parse(text); } catch (e) { await sleep(3000 * (attempt + 1)); }
    }
    return null;
  }

  // 1. the index, by pageid — the same page every other set definition came from
  if (!S.indexLines.length) {
    const j = await post({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", format: "json", formatversion: "2", pageids: INDEX_PAGEID });
    if (!j) { console.warn("throttled — navigate to any ddowiki page and paste again"); return; }
    const page = (j.query.pages || [])[0];
    if (!page || page.missing) {
      console.error("!! `Named item sets` not readable under pageid", INDEX_PAGEID, "— the read FAILED; do not read this as 'no mismatch'");
      return;
    }
    const lines = page.revisions[0].slots.main.content.split("\n");
    lines.forEach((ln, i) => {
      if (/Slave/i.test(ln)) {
        S.indexLines.push({ n: i + 1, before: lines[i - 1] || "", line: ln, after: lines[i + 1] || "" });
      }
    });
    await sleep(1500);
  }

  // 2. each candidate set page. A redirect is evidence: the wiki is naming the
  //    title it considers canonical, in its own words.
  const todo = TITLES.filter((t) => !(t in S.pages) && !S.missing.includes(t));
  if (todo.length) {
    const j = await post({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", format: "json", formatversion: "2", titles: todo.join("|") });
    if (!j) { console.warn("throttled — navigate to any ddowiki page and paste again"); return; }
    for (const p of j.query.pages || []) {
      if (p.missing) { S.missing.push(p.title); continue; }
      const body = p.revisions[0].slots.main.content;
      S.pages[p.title] = body;
      const m = body.match(/^\s*#REDIRECT\s*\[\[([^\]]+)\]\]/i);
      if (m) S.redirects[p.title] = m[1];
    }
  }

  // The zero-record guard: "found nothing" and "asked nothing" must not look alike.
  if (!S.indexLines.length) {
    console.error("!! zero Slave* lines in `Named item sets` — that is a BROKEN READ, not a clean result. Check the pageid before concluding anything.");
    return;
  }

  console.log(`===== Named item sets (pageid ${INDEX_PAGEID}) — ${S.indexLines.length} Slave* lines =====`);
  for (const r of S.indexLines) console.log(`L${r.n}\n  ${r.before}\n> ${r.line}\n  ${r.after}`);
  console.log("\n===== candidate set pages =====");
  for (const [t, body] of Object.entries(S.pages)) {
    console.log(`\n--- ${t} ---${S.redirects[t] ? ` (REDIRECTS TO: ${S.redirects[t]})` : ""}\n${body.slice(0, 1200)}`);
  }
  console.log("\nmissing (page does not exist under that title):", S.missing);
  console.log("redirects:", S.redirects);

  S.summaryText = [
    `index Slave lines ${S.indexLines.length}`,
    ...S.indexLines.map((r) => r.line),
    ...Object.entries(S.redirects).map(([t, to]) => `redirect ${t} -> ${to}`),
    `exists ${Object.keys(S.pages).join(" ; ")}`,
    `missing ${S.missing.join(" ; ")}`,
  ].join("\n").replace(/[|=&?]/g, " ");
  try { copy(JSON.stringify(S, null, 1)); console.log("dump copied to clipboard"); } catch (e) { console.log("copy() unavailable — run: JSON.stringify(window.__sl, null, 1)"); }
  return S.summaryText;
})();
