// #591 half B — harvest the Cannith Challenge WEAPON family pages from ddowiki.
//
// WHY A BROWSER SNIPPET: ddowiki has no server-side transport (Cloudflare). The
// only thing that works is same-origin fetch from a ddowiki tab. See
// docs/wiki-evidence/harvest-method.md for the loop this follows and the traps
// it avoids (POST not GET, 20 titles per request, ~1.5s pacing, resumable).
//
// HOW TO RUN (preferred — you, in DevTools, nothing passes through a privacy guard):
//   1. Open any https://ddowiki.com page in a tab. Open DevTools > Console.
//   2. Paste this whole file. It runs, prints a per-family table, and copies the
//      full verbatim dump to the clipboard.
//   3. Paste the clipboard into data/seed/compendium/raw/cannith_weapon_families.json
//      and commit it. The repo side (half B) takes it from there.
//   If it stops with "throttled": navigate the tab to any ddowiki page (that
//   clears the 202-empty throttle) and paste again — it resumes, skipping pages
//   already fetched. Page-scoped state is LOST on navigation, so the snippet
//   re-fetches only what is missing after a reload; nothing is double-counted.
//
// HOW TO RUN (via Claude-in-Chrome / the Browser pane): same, but the returned
// value must be the stripped SUMMARY only — `window.__cw.summaryText` — never the
// raw dump, or the privacy guard blocks the whole result on `| = & ?`.
//
// WHAT IT RECORDS, AND WHAT IT DOES NOT DECIDE:
//   - the full wikitext of every family page, verbatim (`pages`)
//   - every `{{Turnin…}}` row it can find, with the variant the Level field links
//     to, the tier label, and the Enhancements text VERBATIM (`rows`)
//   - a substring flag per row: does this row grant a Purple augment slot
//   - the per-family row count, against the expected 13 (4 levels x 3 tiers + Epic)
// It does NOT convert templates into affixes, and it does NOT normalize anything.
// That conversion is repo-side code with tests; a harvest that decides is a
// harvest that has to be re-run when the decision changes.
//
// THE KNOWN TRAP (from the 2026-09-06 mapping on #591): the Level field is written
// two ways — `[[Item:X (level 8)|Level 8 (Tier 1)]]` on Mournlode/Calomel and
// `{{Item|X (Level 4)|Level 4}}` on the Elemental families. A regex for one form
// silently returns a plausible row count with four whole families absent. Both
// forms are matched below, and the row-count guard is what catches a third.

(async () => {
  // 18 families in the built dataset (variants: (level 8/12/16) + Epic). The
  // wiki's family page usually carries the base name. The repeaters and bows are
  // the mapped dialects C and D, whose page names are UNCERTAIN — every
  // candidate is listed and a miss is recorded, not guessed around.
  const TITLES = [
    "Item:Mournlode Greataxe", "Item:Mournlode Light Mace", "Item:Mournlode Longsword",
    "Item:Mournlode Maul", "Item:Mournlode Shortsword", "Item:Mournlode Warhammer",
    "Item:Elemental Greataxe of Fire", "Item:Elemental Khopesh of Water",
    "Item:Elemental Longbow of Earth", "Item:Elemental Rapier of Air",
    "Item:Calomel Falchion", "Item:Calomel Rapier", "Item:Calomel Scimitar",
    "Item:Calomel Studded Handwraps",
    // dialect C candidates (raw wikitable, no Turnin template)
    "Item:Calomel Repeating Crossbow", "Item:Calomel Banded Heavy Repeater",
    "Item:Calomel Banded Light Repeater",
    // dialect D candidates (the page was absent under the implied name)
    "Item:Calomel Longbow", "Item:Calomel Long Bow", "Item:Calomel Strung Long Bow",
  ];
  const EXPECTED_ROWS = 13;
  const PURPLE = /\{\{\s*Augment\s*\|\s*purple\b|Purple Augment Slot/i;

  const S = (window.__cw = window.__cw || { harvested: new Date().toISOString(), pages: {}, missing: [], rows: {}, wikitables: {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- 1. fetch wikitext, 20 titles per POST, resumable ----------------------
  const todo = TITLES.filter((t) => !(t in S.pages) && !S.missing.includes(t));
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    let json = null;
    for (let attempt = 0; attempt < 4 && !json; attempt++) {
      const body = new URLSearchParams({
        action: "query", prop: "revisions", rvprop: "content", rvslots: "main",
        format: "json", formatversion: "2", titles: batch.join("|"),
      });
      const res = await fetch("/api.php", { method: "POST", body, credentials: "same-origin" });
      const text = await res.text();
      try { json = JSON.parse(text); } catch (e) { json = null; await sleep(3000 * (attempt + 1)); }
    }
    if (!json) { console.warn("throttled — navigate the tab to any ddowiki page, then paste again to resume"); break; }
    for (const p of json.query.pages) {
      if (p.missing) { S.missing.push(p.title); continue; }
      S.pages[p.title] = p.revisions[0].slots.main.content;
    }
    await sleep(1500);
  }

  // ---- 2. extract Turnin rows, brace-aware (inner templates carry their own }}) -
  function templateBlocks(src, name) {
    const out = [];
    const re = new RegExp("\\{\\{\\s*" + name, "gi");
    let m;
    while ((m = re.exec(src))) {
      let depth = 0, j = m.index;
      for (; j < src.length - 1; j++) {
        if (src[j] === "{" && src[j + 1] === "{") { depth++; j++; }
        else if (src[j] === "}" && src[j + 1] === "}") { depth--; j++; if (depth === 0) break; }
      }
      out.push(src.slice(m.index, j + 1));
    }
    return out;
  }
  function params(block) {
    // split on top-level `|` only; `{{..|..}}` and `[[..|..]]` nest
    const inner = block.replace(/^\{\{/, "").replace(/\}\}$/, "");
    const parts = []; let depth = 0, cur = "";
    for (let i = 0; i < inner.length; i++) {
      const two = inner.slice(i, i + 2);
      if (two === "{{" || two === "[[") { depth++; cur += two; i++; continue; }
      if (two === "}}" || two === "]]") { depth--; cur += two; i++; continue; }
      if (inner[i] === "|" && depth === 0) { parts.push(cur); cur = ""; continue; }
      cur += inner[i];
    }
    parts.push(cur);
    const kv = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf("=");
      if (eq < 0) continue;
      kv[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
    }
    return kv;
  }
  const LINK_A = /\[\[\s*Item:([^\]|]+?)\s*(?:\|([^\]]*))?\]\]/i;   // [[Item:X (level 8)|Level 8 (Tier 1)]]
  const LINK_B = /\{\{\s*Item\s*\|\s*([^}|]+?)\s*(?:\|([^}]*))?\}\}/i; // {{Item|X (Level 4)|Level 4}}

  for (const [title, src] of Object.entries(S.pages)) {
    const rows = [];
    for (const block of templateBlocks(src, "Turnin")) {
      const kv = params(block);
      const lvl = kv.level || "";
      const link = LINK_A.exec(lvl) || LINK_B.exec(lvl);
      const enh = kv.enhancements || "";
      rows.push({
        dialect: LINK_A.test(lvl) ? "A" : LINK_B.test(lvl) ? "B" : "?",
        variant: link ? link[1].trim() : null,
        label: link ? (link[2] || "").trim() : lvl,
        tier: (/Tier\s*(\d)/i.exec(lvl) || [])[1] || null,
        enhancements: enh,
        purple_slot: PURPLE.test(enh),
        raw: block,
      });
    }
    S.rows[title] = rows;
    // dialect C: a raw wikitable instead of a template — captured verbatim, not parsed
    const tables = src.match(/\{\|[\s\S]*?\n\|\}/g) || [];
    if (tables.length) S.wikitables[title] = tables;
  }

  // ---- 3. the guard: rows per family against the expected count -------------
  const summary = Object.keys(S.pages).sort().map((t) => {
    const r = S.rows[t];
    return {
      page: t, rows: r.length, expected: EXPECTED_ROWS, ok: r.length === EXPECTED_ROWS,
      dialects: [...new Set(r.map((x) => x.dialect))].join(""),
      unlinked_rows: r.filter((x) => !x.variant).length,
      purple_rows: r.filter((x) => x.purple_slot).length,
      wikitables: (S.wikitables[t] || []).length,
    };
  });
  console.table(summary);
  console.log("missing pages:", S.missing);
  S.summary = { families: summary, missing: S.missing };
  // For the extension path ONLY — strip the four privacy-guard characters.
  S.summaryText = JSON.stringify(S.summary).replace(/[|=&?]/g, " ");
  try { copy(JSON.stringify(S, null, 1)); console.log("full dump copied to clipboard"); } catch (e) { console.log("copy() unavailable — run: JSON.stringify(window.__cw, null, 1)"); }
  return S.summaryText;
})();
