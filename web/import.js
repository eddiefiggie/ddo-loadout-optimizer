// U5 — Trove inventory import (pure helpers, no DOM).
//
// Parses a DDO "Trove" inventory export (client-side only) and exposes the
// owned-item set for inventory-mode optimization. Two hard rules from the plan:
//   * Data minimization (R12): only the columns the optimizer uses are read —
//     Name, Quantity, Location, Tab, Binding. The account-identifying
//     SubscriptionHash and Character columns are NEVER read, stored, or logged.
//   * Base-items-only pool (R13, KTD4): inventory mode restricts only the worn/
//     weapon `items` pool by owned name; augment and crafting pools stay full,
//     so the caller filters `items` alone and passes the rest through untouched.
//
// Pure + Node-testable (tests/import.test.js) with a browser global, mirroring
// the web/browse.js dual-export convention.

// Columns the optimizer is allowed to read. Anything else (SubscriptionHash,
// Character) is dropped at parse time — never lifted out of the raw row.
const USED_COLUMNS = ["name", "quantity", "location", "tab", "binding"];

/** Split one CSV line into fields, honoring double-quoted fields that may
 *  contain commas (the Name column does, e.g. "Ring of Fire, Lesser"). Minimal
 *  RFC-4180: doubled quotes inside a quoted field collapse to one quote. */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse a Trove CSV. Returns only optimizer-relevant data:
 *  { ownedNames:Set<string>, quantities:Map<string,number>, rowCount, columns }.
 *  SubscriptionHash / Character are never surfaced. Throws on a file that has
 *  no recognizable header (so the caller can show an inline error, R10). */
function parseTroveCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) throw new Error("Empty file — no rows to import.");

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  if (nameIdx === -1) {
    throw new Error("Not a Trove export — no 'Name' column found.");
  }
  const qtyIdx = header.indexOf("quantity");

  const ownedNames = new Set();
  const quantities = new Map();
  let rowCount = 0;

  for (let r = 1; r < lines.length; r++) {
    const fields = splitCsvLine(lines[r]);
    const name = (fields[nameIdx] || "").trim();
    if (!name) continue;
    rowCount++;
    ownedNames.add(name);
    if (qtyIdx !== -1) {
      const q = parseInt((fields[qtyIdx] || "").trim(), 10);
      quantities.set(name, (quantities.get(name) || 0) + (Number.isFinite(q) ? q : 1));
    }
  }
  // `columns` reports only the used columns that were actually present, so a
  // caller/test can assert account-identifying columns never leaked through.
  const columns = header.filter((h) => USED_COLUMNS.includes(h));
  return { ownedNames, quantities, rowCount, columns };
}

/** The base-item name a Trove "Name" is matched against. Dataset variants carry
 *  `source_item` (the base item) and `variant_id` (tier-specific); Trove exports
 *  the base item name, so `source_item` is the match key. (`.name` is a
 *  test/synthetic fallback — real variants do not carry it.) */
function itemName(v) {
  return (v && (v.source_item || v.variant_id || v.name)) || "";
}

/** #408 — Trove writes a STACKED item's name in the plural, and the catalog
 *  stores the singular. `Solar Gems of Constitution (Legendary)` in the export
 *  is `Solar Gem of Constitution (Legendary)` in the dataset, so a player who
 *  owns two of something had it silently dropped from their pool — in the one
 *  mode whose whole promise is "only what I have".
 *
 *  That went from cosmetic to load-bearing when #359 shipped owned-augment
 *  mode: every recovered name in the sample export is an augment (Solar/Lunar
 *  Gems, a Ruby), so the names this drops are exactly the ones that mode now
 *  filters on.
 *
 *  Deliberately NOT a general singularizer. Each rule below is a specific
 *  head-noun plural observed in a real export; a blanket trailing-`s` strip
 *  would map `Bolts` onto `Bolt` and invent matches. Returns the candidates to
 *  try, never a rewrite of the player's data.
 */
const _STACK_PLURALS = [
  [/\bGems of\b/, "Gem of"],
  [/\bRubies of\b/, "Ruby of"],
  [/\bDiamonds of\b/, "Diamond of"],
  [/\bSapphires of\b/, "Sapphire of"],
  [/\bTopazes of\b/, "Topaz of"],
  [/\bEmeralds of\b/, "Emerald of"],
  [/\bGlobes of\b/, "Globe of"],
  [/\bEssences of\b/, "Essence of"],
  [/\bFacets of\b/, "Facet of"],
];

function singularCandidates(name) {
  const n = String(name || "");
  const out = [];
  for (const [re, to] of _STACK_PLURALS) {
    if (re.test(n)) out.push(n.replace(re, to));
  }
  return out;
}

/** The reverse direction: is this catalog name owned, allowing for the export
 *  having written it in the plural? */
function ownedHasCatalogName(ownedNames, catalogName) {
  if (!ownedNames || !catalogName) return false;
  if (ownedNames.has(catalogName)) return true;
  // The export may hold the plural of this catalog name.
  for (const [re, to] of _STACK_PLURALS) {
    // Build the plural by inverting the rule: "Gem of" -> "Gems of".
    const singular = to;
    if (catalogName.includes(singular)) {
      const plural = catalogName.replace(singular, singular.replace(/^(\w+?)( of)$/, (m, head, tail) => {
        if (/y$/.test(head)) return head.replace(/y$/, "ies") + tail;
        if (/(s|x|z|ch|sh)$/.test(head)) return head + "es" + tail;
        return head + "s" + tail;
      }));
      if (plural !== catalogName && ownedNames.has(plural)) return true;
    }
  }
  return false;
}

/** Coverage disclosure (R11): how many owned distinct names matched the dataset
 *  by base-item name. `items` is the worn/weapon variant pool. */
function ownedMatch(ownedNames, items) {
  const datasetNames = new Set();
  (items || []).forEach((v) => { const n = itemName(v); if (n) datasetNames.add(n); });
  let matched = 0;
  // #408 — a stacked-item plural counts as matched, because the pool filter
  // below now admits it. The two must agree or the disclosure lies.
  ownedNames.forEach((n) => {
    if (datasetNames.has(n)) { matched++; return; }
    if (singularCandidates(n).some((s2) => datasetNames.has(s2))) matched++;
  });
  const ownedCount = ownedNames.size;
  return {
    ownedCount,
    matched,
    unrecognized: ownedCount - matched,
    matchRate: ownedCount ? matched / ownedCount : 0,
  };
}

/** Base-items-only pool filter (R13/KTD4): keep every variant whose base item
 *  (`source_item`) the player owns. Augment/crafting pools are NOT passed here —
 *  the caller forwards them to buildModel unchanged so enhancements stay
 *  full-catalog. */
function filterItemsToOwned(items, ownedNames) {
  return (items || []).filter((v) => ownedHasCatalogName(ownedNames, itemName(v)));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { splitCsvLine, parseTroveCsv, ownedMatch, filterItemsToOwned, itemName,
    ownedHasCatalogName, singularCandidates, USED_COLUMNS };
}
if (typeof window !== "undefined") {
  window.TroveImport = { splitCsvLine, parseTroveCsv, ownedMatch, filterItemsToOwned, itemName,
    ownedHasCatalogName, singularCandidates };
}
