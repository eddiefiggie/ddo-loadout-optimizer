// U5 — searchable/filterable item browser, fully data-driven from data/items.json.
// The filter logic is a pure function (filterVariants) so it is unit-testable
// under node; DOM rendering only runs in the browser.

// Read an item affix's NAME/TYPE native-first (`{name,type}`), falling back to the
// legacy alias for the not-yet-native crafting-pool / set-bonus affixes and for a
// pre-overhaul persisted item. Item-level ML reads `ml` native-first (== minimum_level).
const affixName = (a) => (a && a.name != null) ? a.name : (a && a.stat);
const affixType = (a) => (a && a.type != null) ? a.type : (a && a.bonus_type);
// `var` (not `const`): this identical helper is declared in both browse.js and
// results.js, which share one global scope as plain browser scripts (a `const`
// redeclaration is a SyntaxError). Each file keeps its own copy so node `require`
// resolves it in module scope; `var` tolerates the browser-global redeclaration.
var itemMl = (v) => (v && v.ml != null) ? v.ml : (v && v.minimum_level);

/**
 * Pure filter. Returns the variants matching every active criterion.
 * @param {Array} items - variant records
 * @param {Object} c - {query, stat, slot, maxMl, verification}
 */
function filterVariants(items, c) {
  c = c || {};
  const q = (c.query || "").trim().toLowerCase();
  return items.filter((v) => {
    if (c.slot && v.slot !== c.slot) return false;
    if (c.verification && c.verification !== "all" && v.verification !== c.verification) return false;
    if (c.maxMl != null && c.maxMl !== "" && Number(itemMl(v)) > Number(c.maxMl)) return false;
    if (c.stat) {
      const stats = variantStats(v);
      if (!stats.includes(c.stat)) return false;
    }
    if (q) {
      const hay = [v.variant_id, v.source_item, ...variantStats(v)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** All distinct stat names a variant carries (affixes + scaling). */
function variantStats(v) {
  const out = [];
  (v.affixes || []).forEach((a) => out.push(affixName(a)));   // item affix (native name)
  (v.scaling || []).forEach((s) => out.push(s.stat));         // scaling: legacy at rest
  return out;
}

function distinct(items, fn) {
  return [...new Set(items.flatMap(fn))].filter(Boolean).sort();
}

function affixText(v) {
  const parts = (v.affixes || []).map((a) => {
    const name = affixName(a), bt = affixType(a);
    if (bt === "boolean") return `✓ ${name}`;   // U4: presence, not a magnitude
    const type = bt && bt !== "Enhancement" ? ` ${bt}` : "";
    const unit = a.unit === "pct" ? "%" : "";
    return `${name} +${a.value}${unit}${type}`;
  });
  (v.scaling || []).forEach((s) => parts.push(`${s.stat} (scales to +${s.val_hi}${s.unit === "pct" ? "%" : ""})`));
  // A Dinosaur Bone blank's value is its typed Dino slots, not affixes — surface
  // them so it reads as a host, not an empty row.
  if ((v.dino_slots_norm || []).length) {
    parts.push(`Isle of Dread slots: ${v.dino_slots_norm.join(" / ")}`);
  }
  return parts;
}

/** Display-only pseudo-variant for one Dino insert, so the crafting pool is
 *  browsable alongside items. NOT an equippable item — the solver reads the
 *  separate dino_inserts pool; this is inventory visibility only. */
function dinoInsertRow(ins) {
  // An insert is a UNIT keyed by (dino_type, category) that may carry several
  // affixes (KTD4). Fall back to a flat single-affix record for back-compat.
  // Pool option objects are legacy-shaped ({stat,bonus_type}); the display row is
  // built native ({name,type}) so the native readers above render it (U5).
  const affixes = (ins.affixes && ins.affixes.length)
    ? ins.affixes.map((a) => ({ name: a.stat, type: a.bonus_type, value: a.value, unit: a.unit || "flat" }))
    : [{ name: ins.stat, type: ins.bonus_type, value: ins.value, unit: ins.unit || "flat" }];
  const category = ins.category || "Accessory";
  const title = ins.name ? `${ins.name} — ${ins.dino_type}` : `${ins.dino_type}: ${affixes[0].name}`;
  return {
    variant_id: title,
    source_item: `Isle of Dread Dino insert (${category})`,
    slot: `Dinosaur Bone augment (${ins.dino_type} / ${category})`,
    ml: 31,
    verification: "verified",
    affixes,
    scaling: [],
    wiki_url: ins.wiki_url,
    dino_insert: true,
  };
}

/** Display-only pseudo-variant for one U81 Nearly-Complete craft option, so the
 *  effect pool is browsable. NOT an equippable item — an item's slot selects one
 *  option; this is inventory visibility only. */
function ncRow(opt) {
  return {
    variant_id: `Nearly Completed: ${opt.stat} (${opt.tier})`,
    source_item: `Nearly Completed — ${opt.category}`,
    slot: `Nearly Completed (${opt.category})`,
    ml: opt.tier === "legendary" ? 35 : 11,
    verification: "verified",
    affixes: [{ name: opt.stat, type: opt.bonus_type, value: opt.value, unit: opt.unit || "flat" }],
    scaling: [],
    wiki_url: opt.wiki_url,
    nc_option: true,
  };
}

/** Display-only pseudo-variant for one U81 Viktranium ("Lamordia") craft option,
 *  so the typed effect pool is browsable. NOT an equippable item — a host's typed
 *  slot selects one option; this is inventory visibility only. */
function vikRow(opt) {
  return {
    variant_id: `Slot ${opt.slot_type} Viktranium augment: ${opt.stat} (${opt.tier})`,
    source_item: `Viktranium — ${opt.slot_type} (${opt.category})`,
    slot: `Viktranium (${opt.slot_type} ${opt.category})`,
    ml: opt.tier === "legendary" ? 34 : 8,
    verification: "verified",
    affixes: [{ name: opt.stat, type: opt.bonus_type, value: opt.value, unit: opt.unit || "flat" }],
    scaling: [],
    wiki_url: opt.wiki_url,
    vik_option: true,
  };
}

/** Display-only pseudo-variant for one compendium roster entry — a named item
 *  the index knows exists (name, slot, wiki link) but whose stats are not yet
 *  sourced. Status "indexed": browse-only, never fed to the solver. Enriched
 *  items appear as their own real variant rows, so only indexed-only entries are
 *  rendered here (no double-listing). */
function compendiumRow(it) {
  const typ = it.weapon_type || it.armor_type || it.offhand_type;
  return {
    variant_id: it.name,
    source_item: `Compendium index — ${it.slot}${typ ? ` (${typ})` : ""}`,
    slot: it.slot,
    ml: null,
    verification: "indexed",
    verification_reasons: ["indexed — stats not yet sourced"],
    affixes: [],
    scaling: [],
    wiki_url: it.wiki_url,
    compendium: true,
  };
}

/** The browsable list: real item variants plus the Dino insert pool, the U81
 *  Nearly-Complete option pool, and the compendium index (indexed-only entries)
 *  rendered as display rows. Pure, so it is unit-testable. */
function browsableItems(dataset) {
  const items = (dataset && dataset.items) || [];
  const inserts = ((dataset && dataset.dino_inserts) || []).map(dinoInsertRow);
  const nc = ((dataset && dataset.nearly_complete) || []).map(ncRow);
  const vik = ((dataset && dataset.viktranium) || []).map(vikRow);
  const comp = ((dataset && dataset.compendium) || [])
    .filter((x) => x.status === "indexed").map(compendiumRow);
  return items.concat(inserts, nc, vik, comp);
}

// ---- DOM rendering (browser only) ----

function initBrowse(dataset) {
  const controls = document.getElementById("browse-controls");
  const status = document.getElementById("browse-status");
  const results = document.getElementById("browse-results");
  if (!controls || !status || !results) return; // on-demand: no-op until the browser panel exists
  const items = browsableItems(dataset);   // real items + Dino insert pool rows

  const slots = distinct(items, (v) => [v.slot]);
  // Affix filter uses the build's curated rankable-affix vocabulary (U4) so parser
  // noise from wiki-only shards stays out of the dropdown; fall back to every stat
  // present for older builds without the metadata.
  const _curated = dataset.metadata && dataset.metadata.rankable_affixes;
  const stats = (_curated && _curated.length) ? _curated.slice() : distinct(items, variantStats);

  controls.innerHTML = `
    <input id="f-query" type="search" placeholder="Search item or affix…" />
    <select id="f-stat"><option value="">Any affix</option>${stats.map((s) => `<option>${s}</option>`).join("")}</select>
    <select id="f-slot"><option value="">Any slot</option>${slots.map((s) => `<option>${s}</option>`).join("")}</select>
    <label>ML ≤ <input id="f-ml" type="number" min="1" max="40" style="width:4rem" /></label>
    <select id="f-verif">
      <option value="all">All</option>
      <option value="verified">Verified only</option>
      <option value="quarantined">Quarantined only</option>
      <option value="indexed">Indexed (not yet sourced)</option>
    </select>
    <button id="f-clear" type="button">Clear</button>`;

  const read = () => ({
    query: document.getElementById("f-query").value,
    stat: document.getElementById("f-stat").value,
    slot: document.getElementById("f-slot").value,
    maxMl: document.getElementById("f-ml").value,
    verification: document.getElementById("f-verif").value,
  });

  function render() {
    const rows = filterVariants(items, read());
    status.textContent = `${rows.length} of ${items.length} items`;
    if (rows.length === 0) {
      results.innerHTML = `<div class="empty">No items match these filters. <button id="empty-clear" type="button">Clear filters</button></div>`;
      document.getElementById("empty-clear").addEventListener("click", clearAll);
      return;
    }
    // esc()/safeUrl() are globals from results.js (loaded first); this render runs
    // only in the browser. Every dataset-derived field is escaped — the item data
    // is wiki-harvested and not fully trusted, matching the results-panel hardening.
    const body = rows.map((v) => {
      const badge = `<span class="badge ${esc(v.verification)}">${esc(v.verification)}</span>`;
      const affixes = affixText(v).map((t) => `<span class="chip">${esc(t)}</span>`).join(" ")
        || `<span class="muted">${esc((v.verification_reasons || []).join("; ")) || "—"}</span>`;
      const tier = v.tier_values_incomplete ? ` <span class="muted">(tiers ${esc((v.tier_ml_list || []).join("/"))}; upper-tier stats)</span>` : "";
      const link = v.wiki_url ? `<a href="${safeUrl(v.wiki_url)}" rel="noopener" target="_blank">wiki</a>` : "";
      return `<tr>
        <td data-label="Item">${esc(v.variant_id)}${tier}</td>
        <td data-label="Slot">${esc(v.slot)}</td>
        <td class="num" data-label="ML">${esc(itemMl(v) ?? "—")}</td>
        <td data-label="Status">${badge}</td>
        <td data-label="Affixes">${affixes}</td>
        <td data-label="Source">${link}</td>
      </tr>`;
    }).join("");
    // .items.cards turns rows into stacked cards under the phone breakpoint (R11);
    // .table-wrap contains any residual overflow so the page never scrolls sideways.
    results.innerHTML = `<div class="table-wrap"><table class="items cards">
      <thead><tr><th>Item</th><th>Slot</th><th class="num">ML</th><th>Status</th><th>Affixes</th><th>Source</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  function clearAll() {
    ["f-query", "f-stat", "f-slot", "f-ml", "f-verif"].forEach((id) => {
      const el = document.getElementById(id);
      if (el.tagName === "SELECT") el.selectedIndex = 0;
      else el.value = "";
    });
    render();
  }

  controls.addEventListener("input", render);
  document.getElementById("f-clear").addEventListener("click", clearAll);
  render();
}

// Exposed for the wizard's on-demand Item Browser mode (U9); no auto-mount —
// the wizard opens a panel that provides the browse-* elements, then calls this.
if (typeof window !== "undefined") {
  window.ItemBrowser = { initBrowse, browsableItems, filterVariants };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { filterVariants, variantStats, affixText, dinoInsertRow, ncRow, vikRow, compendiumRow, browsableItems };
}
