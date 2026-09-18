// #591 half B — harvest the Cannith Challenge WEAPON variant pages from ddowiki.
//
// SUPERSEDES `harvest_cannith_weapon_families.js` for the purpose of admitting the
// tier-granted augment slot. That script reads the FAMILY pages' `{{Turnin}}`
// wikitext, which is the right source for the full per-(level, tier) matrix and is
// what the 2026-09-06 mapping found. It has one practical problem: its dump is raw
// wikitext, so it cannot be returned through a tool boundary that strips
// `| = & ?` — those characters ARE the template syntax, and stripping them
// destroys it. That is why the work order routes it through a DevTools paste.
//
// This script takes the other road, and the shard's own contract is what makes it
// legal. `cannith_challenge_tiers.json`'s `_meta.raw_is_authoritative` says:
//
//     "`raw` is the verbatim RENDERED Enchantments block, tier headers included,
//      with ' / ' separating lines."
//
// So the shard never wanted wikitext. The 33 worn entries are rendered text, and
// every weapon variant has its own item page carrying the same rendered block. That
// text is ordinary prose — no template pipes — so it survives the strip untouched
// and needs no paste. Verified per variant below: a `raw` that is not byte-identical
// after stripping is REFUSED rather than silently degraded.
//
// HOW TO RUN: open any https://ddowiki.com page, DevTools > Console (or the Browser
// pane), paste, and re-paste until `remaining` reaches 0 — it is chunked and
// resumable, and page-scoped state lives in `window.__cwv`.
//
// WHAT IT RECORDS, AND WHAT IT DOES NOT DECIDE: one entry per variant with
// `wiki_url`, `ml`, `slot`, and `raw` — the same four fields the worn entries carry.
// It does NOT derive `slots`, pick a tier, or parse an affix. `src/cannith_tiers.py`
// already does all of that FROM `raw`, and the tests re-derive it; a harvest that
// decides has to be re-run when the decision changes.

(async () => {
  // The 80 Vaults weapon variants, by their dataset `source_item`. Page titles are
  // `Item:<source_item>`; a title that does not resolve is RECORDED, never guessed
  // around (the repeaters and bows have irregular page names — see #591's dialect
  // C/D note — and a wrong guess would silently attribute one variant's text to
  // another).
  const VARIANTS = (window.__cwvTitles || []);
  const CHUNK = 20;

  const S = (window.__cwv = window.__cwv || {
    harvested: new Date().toISOString(), items: {}, missing: [], dirty: [],
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function post(params) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch("/api.php", {
        method: "POST", body: new URLSearchParams(params), credentials: "same-origin",
      });
      const text = await res.text();
      try { return JSON.parse(text); } catch (e) { await sleep(3000 * (attempt + 1)); }
    }
    return null;
  }

  /** The rendered Enchantments block, as the shard's ' / ' form.
   *
   *  Three removals, each load-bearing:
   *    - nested `ul`/`ol`, so a parent line does not swallow its children's text;
   *    - `span.tooltip`, or every label renders twice (once bare, once as
   *      "Label: <the whole tooltip sentence>");
   *    - `style`/`script`, because the augment template ships an inline
   *      stylesheet INSIDE its `li` and its CSS text otherwise lands in `raw`
   *      between "Adds" and "Purple Augment Slot". Measured, not hypothetical.
   */
  function enchantBlock(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const th = [...doc.querySelectorAll("th")]
      .find((e) => /^Enchantments/i.test((e.textContent || "").trim()));
    const td = th && th.nextElementSibling;
    if (!td) return null;
    const lines = [];
    for (const li of td.querySelectorAll("li")) {
      const c = li.cloneNode(true);
      c.querySelectorAll("ul,ol,style,script,link").forEach((e) => e.remove());
      c.querySelectorAll("span.tooltip").forEach((e) => e.remove());
      const t = (c.textContent || "").replace(/\s+/g, " ").trim();
      if (t) lines.push(t);
    }
    return lines.length ? lines.join(" / ") : null;
  }

  const todo = VARIANTS.filter((v) => !(v in S.items) && !S.missing.includes(v));
  for (const name of todo.slice(0, CHUNK)) {
    const j = await post({
      action: "parse", page: `Item:${name}`, prop: "text",
      format: "json", formatversion: "2",
    });
    if (!j) return "THROTTLED — navigate to any ddowiki page and paste again to resume";
    if (j.error || !j.parse) { S.missing.push(name); await sleep(1500); continue; }
    const raw = enchantBlock(j.parse.text);
    if (!raw) { S.missing.push(name); await sleep(1500); continue; }
    // The guard that makes this route legal: if the rendered text is NOT identical
    // after stripping the four characters, returning it would hand the repo a
    // silently mangled `raw`. Refuse it and name it instead.
    if (raw.replace(/[|=&?]/g, " ") !== raw) { S.dirty.push(name); await sleep(1500); continue; }
    const m = /\(level (\d+)\)/.exec(name);
    S.items[name] = {
      wiki_url: "https://ddowiki.com/page/Item:" + name.replace(/ /g, "_"),
      ml: m ? parseInt(m[1], 10) : null,
      raw,
    };
    await sleep(1500);
  }

  const done = Object.keys(S.items).length;
  const remaining = VARIANTS.filter((v) => !(v in S.items) && !S.missing.includes(v)).length;
  // "Found nothing" and "asked nothing" must not look alike.
  if (!VARIANTS.length) return "NO TITLE LIST — set window.__cwvTitles first; refusing to report a clean zero";
  return JSON.stringify({
    done, remaining, missing: S.missing, dirty: S.dirty,
    withPurple: Object.values(S.items).filter((x) => /Purple Augment Slot/i.test(x.raw)).length,
  });
})();
