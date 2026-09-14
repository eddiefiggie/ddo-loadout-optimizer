// #746 — read the four enchantment pages the Ghost Touch ruling depends on.
//
// The open question on #746 is whether `Ghost Touch`, `Ghostly` and `Ethereal`
// are the same in-game effect (and whether `Ghostbane` belongs with them). If
// they are, the fix is to MINT a shared stat the way `Blurry`/`Lesser
// Displacement` -> `Concealment` already works, which repairs 58 item families at
// once. That is a claim about the game, so it needs the wiki's own words — this
// project never infers a value. This snippet fetches both layers of each page:
// the wikitext (what the editors wrote) and the rendered text (what the page
// says, tooltips included), because bundled templates hide their numbers in the
// tooltip rather than the visible cell.
//
// HOW TO RUN: open any https://ddowiki.com page, DevTools > Console, paste. It
// prints each page's rendered text and copies the dump to the clipboard. Paste
// the dump into the #746 thread or save it beside the eventual ruling in
// docs/wiki-evidence/. A `missing` title means the page is not under that name:
// use the wiki's search box (NOT `insource:` search, which is disabled and returns
// empty for strings that exist) and add the real title to TITLES.
//
// Via Claude-in-Chrome / the Browser pane, return `window.__gt.summaryText` only
// (stripped of `| = & ?`), never the raw dump.

(async () => {
  const TITLES = ["Ghost Touch", "Ghostly", "Ethereal", "Ghostbane"];
  const S = (window.__gt = window.__gt || { harvested: new Date().toISOString(), wikitext: {}, rendered: {}, missing: [] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function post(paramsObj) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch("/api.php", { method: "POST", body: new URLSearchParams(paramsObj), credentials: "same-origin" });
      const text = await res.text();
      try { return JSON.parse(text); } catch (e) { await sleep(3000 * (attempt + 1)); }
    }
    return null;
  }

  // wikitext, one batched POST
  const todo = TITLES.filter((t) => !(t in S.wikitext) && !S.missing.includes(t));
  if (todo.length) {
    const j = await post({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", format: "json", formatversion: "2", titles: todo.join("|") });
    if (!j) { console.warn("throttled — navigate to any ddowiki page and paste again"); return; }
    for (const p of j.query.pages) {
      if (p.missing) { S.missing.push(p.title); continue; }
      S.wikitext[p.title] = p.revisions[0].slots.main.content;
    }
    await sleep(1500);
  }
  // rendered text, one page per POST (action=parse), tooltips included
  for (const t of Object.keys(S.wikitext)) {
    if (t in S.rendered) continue;
    const j = await post({ action: "parse", page: t, prop: "text", format: "json", formatversion: "2" });
    if (!j || !j.parse) { console.warn("parse failed for", t); continue; }
    const doc = new DOMParser().parseFromString(j.parse.text, "text/html");
    const tooltips = [...doc.querySelectorAll("span.tooltip")].map((el) => el.textContent.trim());
    S.rendered[t] = { text: (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim(), tooltips };
    await sleep(1500);
  }

  for (const [t, r] of Object.entries(S.rendered)) {
    console.log(`\n===== ${t} =====\n${r.text}\n--- tooltips: ${JSON.stringify(r.tooltips)}`);
  }
  console.log("missing:", S.missing);
  S.summaryText = Object.entries(S.rendered).map(([t, r]) => `${t}\n${r.text}\ntooltips ${r.tooltips.join(" ; ")}`).join("\n\n")
    .replace(/[|=&?]/g, " ") + `\nmissing ${S.missing.join(", ")}`;
  try { copy(JSON.stringify(S, null, 1)); console.log("dump copied to clipboard"); } catch (e) { console.log("copy() unavailable — run: JSON.stringify(window.__gt, null, 1)"); }
  return S.summaryText;
})();
