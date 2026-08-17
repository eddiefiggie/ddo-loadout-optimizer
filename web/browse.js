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

// #353 — the presence predicate comes from projection.js (one definition for the
// whole app); browser-global-first, require() under node. `var` for the shared
// browser global scope, same rationale as itemMl above. This file's own
// `=== "boolean"` check was dead: the pipeline types presence affixes `"Bool"`,
// so Browse rendered `Ghostly +1 Bool` instead of `✓ Ghostly`.
var _browseIsPresenceType = (typeof Projection !== "undefined" && Projection.isPresenceType)
  ? Projection.isPresenceType
  : (typeof require !== "undefined" ? require("./projection.js").isPresenceType : null);

// plan 2026-08-12-003 (U4, #262) — the no-drop-source disclosure. The wording is
// owned by projection.js (NO_DROP_SOURCE_WORDING: one constant, every surface);
// bridged here browser-global-first, require() under node. `var` for the shared
// browser global scope (same rationale as itemMl above). The literal fallback
// only covers a stale cached projection.js that predates the constant.
var _browseNoDropWording = (function () {
  const P = (typeof Projection !== "undefined") ? Projection
    : (typeof require !== "undefined" ? require("./projection.js") : null);
  return (P && P.NO_DROP_SOURCE_WORDING) || "no known live drop source";
})();

/** Badge HTML for a wiki-confirmed sourceless item's status cell; "" otherwise.
 *  Only-when-set: absence of the flag is the default and renders nothing. Pure
 *  (unit-tested); the wording is code-owned, so no esc() dependency here. */
function noDropBadge(v) {
  return (v && v.no_drop_source === true)
    ? ` <span class="badge no-drop" title="${_browseNoDropWording}">${_browseNoDropWording}</span>`
    : "";
}

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
    // U4 — two SEPARATE match modes. `stat` means "the item carries this affix"
    // and behaves exactly as before; `setStat` means "a set this item belongs to
    // grants it". Merging them would turn `Melee Power` from 16 rows into ~625,
    // ~97% of which do not carry the stat — a regression of browse's main job.
    if (c.stat) {
      const stats = variantStats(v);
      if (!stats.includes(c.stat)) return false;
    }
    if (c.setStat) {
      if (!variantSetStats(v).includes(c.setStat)) return false;
    }
    if (q) {
      const setNames = (v._setGranted || []).map((e) => e.set);
      const hay = [v.variant_id, v.source_item, ...variantStats(v), ...variantSetStats(v), ...setNames]
        .join(" ").toLowerCase();
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

// #332 — the STRUCTURED form of affixText. The row builder needs to know which
// entries are presence effects (and under which name) so it can mark the ones the
// Utility tier counts; recovering that by slicing the rendered "✓ Name" string
// would couple the marker to the label's formatting. `affixText` is retained as
// the text-only projection of this, so every existing caller and test is
// unaffected. `presenceName` is null for magnitudes, scaling notes, and Dino
// slot lines — only a presence affix can carry a marker.
// #332 — the presence marker. Three cases, and only two of them are marked:
//   counted   — the Utility tier scores this effect (the curated tier-1 roster)
//   rankable  — a reviewed weapon proc: rank it as its own priority, but the tier
//               never counts it. Since #343 this is 24 names, and the gap it
//               explains is real — a player can rank Undead Bane, see it
//               satisfied at 13, and find it absent from the utility count.
//   unmarked  — every other presence effect (~1,067 of them). Deliberately silent:
//               a glyph on all of them would be noise, not signal, and "no mark"
//               already reads as "not counted" once the marked cases are learned.
// Returns null when no marker applies OR when no vocabulary was supplied, so a
// caller without one (a test, an older host) renders exactly as it does today.
function presenceMarker(name, sets) {
  if (!name || !sets) return null;
  const counting = sets.counting, admitted = sets.admitted;
  if (counting && typeof counting.has === "function" && counting.has(name)) {
    return { cls: "counted", glyph: "★",
      title: "Counted by the Utility effects priority — this effect earns a point toward that priority's total." };
  }
  if (admitted && typeof admitted.has === "function" && admitted.has(name)) {
    return { cls: "rankable-only", glyph: "◇",
      title: "Rank this on its own to have the optimizer seek it. The Utility effects priority does NOT count it — weapon procs are ranked individually rather than counted." };
  }
  return null;
}

function affixEntries(v) {
  const entries = (v.affixes || []).map((a) => {
    const name = affixName(a), bt = affixType(a);
    if (_browseIsPresenceType(bt)) {
      // U4: presence, not a magnitude.
      return { text: `✓ ${name}`, presenceName: name, markName: name };
    }
    const type = bt && bt !== "Enhancement" ? ` ${bt}` : "";
    const unit = a.unit === "pct" ? "%" : "";
    // #332 — `markName` is carried on the MAGNITUDE branch too, so set membership is
    // the only gate on the marker. The reviewed weapon procs are untyped MAGNITUDES
    // (Undead Bane appears 115 times, only 6 of them Bool), so gating the marker on
    // presence type reached 75 of 1,656 admitted chips. `presenceName` keeps its
    // narrower "renders as a presence tick" meaning for any caller that wants it.
    return { text: `${name} +${a.value}${unit}${type}`, presenceName: null, markName: name };
  });
  (v.scaling || []).forEach((s) => entries.push({
    text: `${s.stat} (scales to +${s.val_hi}${s.unit === "pct" ? "%" : ""})`, presenceName: null, markName: null }));
  // A Dinosaur Bone blank's value is its typed Dino slots, not affixes — surface
  // them so it reads as a host, not an empty row.
  if ((v.dino_slots_norm || []).length) {
    entries.push({ text: `Isle of Dread slots: ${v.dino_slots_norm.join(" / ")}`, presenceName: null, markName: null });
  }
  return entries;
}

function affixText(v) {
  return affixEntries(v).map((e) => e.text);
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
  // ATOMIC since #211, same as vikRow below: an option may carry several
  // affixes (a Skill-menu craft grants six skills at once), so the row renders
  // the option's WHOLE affix list. Falls back to a flat single-affix record
  // for back-compat with a cached dataset.
  const affixes = (opt.affixes && opt.affixes.length)
    ? opt.affixes.map((a) => ({ name: a.stat, type: a.bonus_type, value: a.value,
                                unit: a.unit || "flat" }))
    : [{ name: opt.stat, type: opt.bonus_type, value: opt.value, unit: opt.unit || "flat" }];
  const label = opt.name || (affixes[0] && affixes[0].name) || opt.category;
  return {
    variant_id: `Nearly Completed: ${label} (${opt.tier})`,
    source_item: `Nearly Completed — ${opt.category}`,
    slot: `Nearly Completed (${opt.category})`,
    ml: opt.tier === "legendary" ? 35 : 11,
    verification: "verified",
    affixes,
    scaling: [],
    wiki_url: opt.wiki_url,
    nc_option: true,
  };
}

/** Display-only pseudo-variant for one U81 Viktranium ("Lamordia") craft option,
 *  so the typed effect pool is browsable. NOT an equippable item — a host's typed
 *  slot selects one option; this is inventory visibility only. */
function vikRow(opt) {
  // An option is an ATOMIC UNIT that may carry several affixes (the universal
  // spell-DC craft grants all seven schools at once), so the row renders the
  // option's WHOLE affix list — one row per OPTION, never one per affix. Falls
  // back to a flat single-affix record for back-compat. Pool option objects are
  // legacy-shaped ({stat,bonus_type}); the display row is built native
  // ({name,type}) so the native readers above render it (U5).
  const affixes = (opt.affixes && opt.affixes.length)
    ? opt.affixes.map((a) => ({ name: a.stat, type: a.bonus_type, value: a.value, unit: a.unit || "flat" }))
    : [{ name: opt.stat, type: opt.bonus_type, value: opt.value, unit: opt.unit || "flat" }];
  // #282 — a variant-marked Weapon-pool record (quarterstaff vs base) shares its
  // name with its sibling; the tag keeps the two rows distinguishable.
  const variantTag = opt.quarterstaff === true ? " (quarterstaff hosts)"
    : opt.quarterstaff === false ? " (non-quarterstaff hosts)" : "";
  const title = (opt.name
    ? `Slot ${opt.slot_type} Viktranium augment: ${opt.name}`
    : `Slot ${opt.slot_type} Viktranium augment: ${affixes[0].name} (${opt.tier})`) + variantTag;
  return {
    variant_id: title,
    source_item: `Viktranium — ${opt.slot_type} (${opt.category})`,
    slot: `Viktranium (${opt.slot_type} ${opt.category})`,
    ml: opt.tier === "legendary" ? 34 : 8,
    verification: "verified",
    affixes,
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
// ---- U3 (#135) — set-granted value -----------------------------------------
// An item's worth can route through a set definition instead of its own affixes,
// so a Set Augment reads as an empty row today. Three shapes carry it:
//   1. `parsed_set_bonuses`  — threshold tiers already on the item
//   2. `set` + augment_set_defs — Set Augments (the reported case)
//   3. `joker_set_groups`    — wildcards: ONE set from each pool, not all of them
// Resolution happens once in browsableItems (the only function handed the whole
// dataset), stamped onto each row as `_setGranted`, so variantStats/affixText/
// filterVariants keep their variant-only signatures and their existing tests.

/** Set name -> tiers, collected from data already in the dataset. Every joker pool
 *  name has parsed tiers on some member item, so no separate definition table is
 *  needed — and collecting from the same records the solver reads guarantees browse
 *  cannot drift from it. */
function collectSetDefs(dataset) {
  const defs = new Map();
  const put = (name, tiers) => {
    if (!name || !tiers || !tiers.length || defs.has(name)) return;
    defs.set(name, tiers);
  };
  for (const it of (dataset && dataset.items) || []) {
    for (const t of it.parsed_set_bonuses || []) {
      if (!t || !t.set || defs.has(t.set)) continue;
      // Gather every tier of this set from this item (they travel together).
      put(t.set, (it.parsed_set_bonuses || []).filter((x) => x && x.set === t.set));
    }
  }
  for (const [name, def] of Object.entries((dataset && dataset.augment_set_defs) || {})) put(name, def && def.tiers);
  for (const [name, def] of Object.entries((dataset && dataset.membership_set_defs) || {})) put(name, def && def.tiers);
  return defs;
}

function _tierAffixNames(tier) {
  return (tier && tier.affixes || []).map((a) => a && (a.stat != null ? a.stat : a.name)).filter(Boolean);
}

/** The set-granted entries for one variant, given the collected defs. Each entry is
 *  one CHIP: `{set, pieces_label, stats, kind, choiceOf}` — one per (set, tier), never
 *  one per granted stat, or a 12-tier item would flood the row. */
function resolveSetGranted(v, defs) {
  const out = [];
  const seen = new Set();
  const push = (set, tier, kind, choiceOf) => {
    const key = `${kind}|${set}|${tier && tier.pieces_required}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      set,
      pieces_label: (tier && (tier.pieces_label || (tier.pieces_required != null ? `${tier.pieces_required} pieces` : ""))) || "",
      stats: _tierAffixNames(tier),
      kind,
      choiceOf: choiceOf || 0,
    });
  };
  // 1. tiers already on the item
  for (const t of v.parsed_set_bonuses || []) if (t && t.set) push(t.set, t, "tier");
  // 2. a Set Augment naming its set
  if (v.set && defs.has(v.set)) for (const t of defs.get(v.set)) push(v.set, t, "augment");
  // 3. wildcard pools — ONE set per group. Emit one chip per GROUP stating the
  //    choice, never one per candidate, which would render 22 chips on the Gem.
  for (const g of v.joker_set_groups || []) {
    const names = Array.isArray(g) ? g : (g && g.sets) || [];
    if (!names.length) continue;
    const stats = new Set();
    for (const n of names) for (const t of defs.get(n) || []) _tierAffixNames(t).forEach((s) => stats.add(s));
    out.push({ set: names.join(", "), pieces_label: "", stats: [...stats], kind: "wildcard", choiceOf: names.length });
  }
  return out;
}

/** Chip text for a set-granted entry. The distinction lives in the VISIBLE TEXT,
 *  not only a CSS class — the shipped `.chip.setbonus` style separates by colour
 *  alone, which fails colourblind players, print, and screen readers. The `✓`
 *  prefix is NOT reused: affixText already means "boolean presence" by it. */
function setChipText(e) {
  if (e.kind === "wildcard") {
    return `Wildcard set: 1 of ${e.choiceOf}${e.stats.length ? ` — ${e.stats.slice(0, 3).join(", ")}${e.stats.length > 3 ? "…" : ""}` : ""}`;
  }
  const cond = e.pieces_label ? ` (with ${e.pieces_label.toLowerCase().replace(/\s*equipped$/, "")})` : "";
  return `Set: ${e.set}${cond}${e.stats.length ? ` — ${e.stats.join(", ")}` : ""}`;
}

/** Stat names a variant gains only through a set. Kept separate from variantStats
 *  so the two filter modes never merge (U4). */
function variantSetStats(v) {
  return [...new Set((v._setGranted || []).flatMap((e) => e.stats))];
}

function browsableItems(dataset) {
  const items = (dataset && dataset.items) || [];
  const inserts = ((dataset && dataset.dino_inserts) || []).map(dinoInsertRow);
  const nc = ((dataset && dataset.nearly_complete) || []).map(ncRow);
  const vik = ((dataset && dataset.viktranium) || []).map(vikRow);
  const comp = ((dataset && dataset.compendium) || [])
    .filter((x) => x.status === "indexed").map(compendiumRow);
  const rows = items.concat(inserts, nc, vik, comp);
  // U3 — resolve set-granted value once, here, where the dataset is in hand.
  const defs = collectSetDefs(dataset);
  for (const v of rows) v._setGranted = resolveSetGranted(v, defs);
  return rows;
}

// ---- DOM rendering (browser only) ----

function initBrowse(dataset, vocab) {
  // #332 — the counted / rankable-only sets come from the picker vocabulary the
  // host already built (canonicalized through the shared alias table there, so a
  // chip matches by the ONE name the solver uses). Optional: without it, chips
  // render exactly as before rather than guessing at membership.
  // #332 — gate on SIZE, not truthiness: a cached pre-stamp dataset yields an empty
  // Set (documented in dataset.js), which is truthy, so the legend would explain two
  // glyphs no chip can carry.
  const utilitySets = (vocab && vocab.utilityCounting && vocab.utilityCounting.size)
    ? { counting: vocab.utilityCounting, admitted: vocab.utilityAdmitted || new Set() }
    : null;
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
  // U4 — the Set bonus group. Normalized against the SAME curated vocabulary that
  // produces rankable_affixes: an unmapped name stays out of the dropdown (so the
  // curation does not regain the parser noise it exists to exclude) but still
  // matches free text. Composed here at render time and kept LOCAL to browse —
  // rankable_affixes also feeds buildPickerVocabulary, so widening it at build
  // time would widen the priority picker too.
  const _known = new Set(stats);
  const setStats = distinct(items, variantSetStats).filter((s) => _known.has(s));

  controls.innerHTML = `
    <input id="f-query" type="search" placeholder="Search item or affix…" />
    <select id="f-stat" aria-label="Filter by affix or set bonus">
      <option value="">Any affix</option>
      <optgroup label="Item affix">${stats.map((s) => `<option value="affix:${s}">${s}</option>`).join("")}</optgroup>
      ${setStats.length ? `<optgroup label="Set bonus">${setStats.map((s) => `<option value="set:${s}">${s}</option>`).join("")}</optgroup>` : ""}
    </select>
    <select id="f-slot"><option value="">Any slot</option>${slots.map((s) => `<option>${s}</option>`).join("")}</select>
    <label>ML ≤ <input id="f-ml" type="number" min="1" max="40" style="width:4rem" /></label>
    <select id="f-verif">
      <option value="all">All</option>
      <option value="verified">Verified only</option>
      <option value="quarantined">Quarantined only</option>
      <option value="indexed">Indexed (not yet sourced)</option>
    </select>
    <button id="f-clear" type="button">Clear</button>`;

  const read = () => {
    // U4 — the option value carries which mode it is: `affix:` (item carries it)
    // or `set:` (a set grants it). A bare value is treated as an affix so an older
    // cached page, or a caller passing {stat} directly, keeps working.
    const raw = document.getElementById("f-stat").value || "";
    const isSet = raw.startsWith("set:");
    const name = raw.replace(/^(affix|set):/, "");
    return {
      query: document.getElementById("f-query").value,
      stat: isSet ? "" : name,
      setStat: isSet ? name : "",
      slot: document.getElementById("f-slot").value,
      maxMl: document.getElementById("f-ml").value,
      verification: document.getElementById("f-verif").value,
    };
  };

  function render() {
    const rows = filterVariants(items, read());
    status.textContent = `${rows.length} of ${items.length} items`;
    // #332 — a glyph nobody can decode is worse than no glyph. The legend renders
    // only when a vocabulary was supplied (so the markers are actually present)
    // and only once, appended after the count.
    if (utilitySets && !status.querySelector(".utility-legend")) {
      // Each half is gated on ITS OWN set having members. `utilitySets` already
      // requires a non-empty counting set, but the admitted half is independent: a
      // dataset that stamps a counting set and no admitted procs would otherwise
      // explain a glyph no chip can carry. Never teach a symbol that cannot appear.
      const parts = [];
      if (utilitySets.counting && utilitySets.counting.size) {
        parts.push('<span class="chip-mark">★</span> counted by the Utility effects priority');
      }
      if (utilitySets.admitted && utilitySets.admitted.size) {
        parts.push('<span class="chip-mark">◇</span> rankable on its own, not counted by it');
      }
      if (parts.length) {
        const legend = document.createElement("p");
        legend.className = "utility-legend";
        legend.innerHTML = parts.join(" &nbsp;·&nbsp; ");
        status.appendChild(legend);
      }
    }
    if (rows.length === 0) {
      results.innerHTML = `<div class="empty">No items match these filters. <button id="empty-clear" type="button">Clear filters</button></div>`;
      document.getElementById("empty-clear").addEventListener("click", clearAll);
      return;
    }
    // esc()/safeUrl() are globals from results.js (loaded first); this render runs
    // only in the browser. Every dataset-derived field is escaped — the item data
    // is wiki-harvested and not fully trusted, matching the results-panel hardening.
    const body = rows.map((v) => {
      // #262 (U4) — the no-drop-source badge rides the same status cell; the row
      // struct carries the flag because browsableItems passes real variants through.
      const badge = `<span class="badge ${esc(v.verification)}">${esc(v.verification)}</span>` + noDropBadge(v);
      // U3 — item-carried chips first, then set-granted ones. Beyond three set
      // chips the remainder collapses: 1,381 items carry threshold tiers and five
      // carry twelve, so an uncapped list would swamp the cell.
      const ownChips = affixEntries(v).map((e) => {
        const m = presenceMarker(e.markName, utilitySets);
        return m
          ? `<span class="chip presence ${m.cls}" title="${esc(m.title)}">${esc(e.text)} <span class="chip-mark" aria-hidden="true">${m.glyph}</span><span class="sr-only"> — ${esc(m.cls === "counted" ? "counted by the Utility effects priority" : "rankable on its own; not counted by the Utility effects priority")}</span></span>`
          : `<span class="chip">${esc(e.text)}</span>`;
      });
      const setEntries = v._setGranted || [];
      const shown = setEntries.slice(0, 3).map((e) => `<span class="chip setbonus">${esc(setChipText(e))}</span>`);
      if (setEntries.length > 3) {
        const rest = setEntries.slice(3).map(setChipText).join("\n");
        shown.push(`<span class="chip setbonus more" title="${esc(rest)}">+${setEntries.length - 3} more set bonuses</span>`);
      }
      const allChips = ownChips.concat(shown);
      const affixes = allChips.join(" ")
        || `<span class="muted">${esc((v.verification_reasons || []).join("; ")) || "—"}</span>`;
      const tier = v.tier_values_incomplete ? ` <span class="muted">(tiers ${esc((v.tier_ml_list || []).join("/"))}; upper-tier stats)</span>` : "";
      const link = v.wiki_url ? `<a href="${safeUrl(v.wiki_url)}" rel="noopener" target="_blank">wiki</a>` : "";
      return `<tr>
        <td data-label="Item">${esc(v.variant_id)}${tier}</td>
        <td data-label="Slot">${esc(v.slot)}</td>
        <td class="num" data-label="ML">${esc(itemMl(v) ?? "—")}</td>
        <td data-label="Status">${badge}</td>
        <td data-label="Affixes &amp; set bonuses">${affixes}</td>
        <td data-label="Source">${link}</td>
      </tr>`;
    }).join("");
    // .items.cards turns rows into stacked cards under the phone breakpoint (R11);
    // .table-wrap contains any residual overflow so the page never scrolls sideways.
    results.innerHTML = `<div class="table-wrap"><table class="items cards">
      <thead><tr><th>Item</th><th>Slot</th><th class="num">ML</th><th>Status</th><th>Affixes &amp; set bonuses</th><th>Source</th></tr></thead>
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
  module.exports = { filterVariants, variantStats, variantSetStats, affixText, affixEntries, presenceMarker, setChipText, collectSetDefs, resolveSetGranted, dinoInsertRow, ncRow, vikRow, compendiumRow, browsableItems, noDropBadge };
}
