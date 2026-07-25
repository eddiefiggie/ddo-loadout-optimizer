// U5 — searchable/filterable item browser, fully data-driven from data/items.json.
// The filter logic is a pure function (filterVariants) so it is unit-testable
// under node; DOM rendering only runs in the browser.

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
    if (c.maxMl != null && c.maxMl !== "" && Number(v.minimum_level) > Number(c.maxMl)) return false;
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
  (v.affixes || []).forEach((a) => out.push(a.stat));
  (v.scaling || []).forEach((s) => out.push(s.stat));
  return out;
}

function distinct(items, fn) {
  return [...new Set(items.flatMap(fn))].filter(Boolean).sort();
}

function affixText(v) {
  const parts = (v.affixes || []).map((a) => {
    const type = a.bonus_type && a.bonus_type !== "Enhancement" ? ` ${a.bonus_type}` : "";
    const unit = a.unit === "pct" ? "%" : "";
    return `${a.stat} +${a.value}${unit}${type}`;
  });
  (v.scaling || []).forEach((s) => parts.push(`${s.stat} (scales to +${s.val_hi}${s.unit === "pct" ? "%" : ""})`));
  return parts;
}

// ---- DOM rendering (browser only) ----

function initBrowse(dataset) {
  const items = dataset.items;
  const controls = document.getElementById("browse-controls");
  const status = document.getElementById("browse-status");
  const results = document.getElementById("browse-results");

  const slots = distinct(items, (v) => [v.slot]);
  const stats = distinct(items, variantStats);

  controls.innerHTML = `
    <input id="f-query" type="search" placeholder="Search item or affix…" />
    <select id="f-stat"><option value="">Any affix</option>${stats.map((s) => `<option>${s}</option>`).join("")}</select>
    <select id="f-slot"><option value="">Any slot</option>${slots.map((s) => `<option>${s}</option>`).join("")}</select>
    <label>ML ≤ <input id="f-ml" type="number" min="1" max="40" style="width:4rem" /></label>
    <select id="f-verif">
      <option value="all">All</option>
      <option value="verified">Verified only</option>
      <option value="quarantined">Quarantined only</option>
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
    const body = rows.map((v) => {
      const badge = `<span class="badge ${v.verification}">${v.verification}</span>`;
      const affixes = affixText(v).map((t) => `<span class="chip">${t}</span>`).join(" ")
        || `<span class="muted">${(v.verification_reasons || []).join("; ") || "—"}</span>`;
      const tier = v.tier_values_incomplete ? ` <span class="muted">(tiers ${(v.tier_ml_list || []).join("/")}; upper-tier stats)</span>` : "";
      const link = v.wiki_url ? `<a href="${v.wiki_url}" rel="noopener" target="_blank">wiki</a>` : "";
      return `<tr>
        <td>${v.variant_id}${tier}</td>
        <td>${v.slot}</td>
        <td class="num">${v.minimum_level ?? "—"}</td>
        <td>${badge}</td>
        <td>${affixes}</td>
        <td>${link}</td>
      </tr>`;
    }).join("");
    results.innerHTML = `<table class="items">
      <thead><tr><th>Item</th><th>Slot</th><th>ML</th><th>Status</th><th>Affixes</th><th>Source</th></tr></thead>
      <tbody>${body}</tbody></table>`;
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

if (typeof window !== "undefined" && window.App) {
  window.App.ready(initBrowse);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { filterVariants, variantStats, affixText };
}
