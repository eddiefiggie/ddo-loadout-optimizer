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

/** Coverage disclosure (R11): how many owned distinct names matched the dataset
 *  by base-item name. `items` is the worn/weapon variant pool. */
function ownedMatch(ownedNames, items) {
  const datasetNames = new Set();
  (items || []).forEach((v) => { const n = itemName(v); if (n) datasetNames.add(n); });
  let matched = 0;
  ownedNames.forEach((n) => { if (datasetNames.has(n)) matched++; });
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
  return (items || []).filter((v) => ownedNames.has(itemName(v)));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { splitCsvLine, parseTroveCsv, ownedMatch, filterItemsToOwned, itemName, USED_COLUMNS };
}
if (typeof window !== "undefined") {
  window.TroveImport = { splitCsvLine, parseTroveCsv, ownedMatch, filterItemsToOwned, itemName };
}
