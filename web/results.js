// U8 — render a solved loadout as a full build sheet. Display-only; the
// optimization happens in the solver (U1/U3/U5). Set bonuses and augments are
// now optimized and prescribed here; crafting/upgrade paths are a pending
// follow-up, surfaced honestly in the coverage disclosure.

function affixLabel(a) {
  const type = a.bonus_type && a.bonus_type !== "Enhancement" ? ` ${a.bonus_type}` : "";
  return `${a.stat} +${a.value}${a.unit === "pct" ? "%" : ""}${type}`;
}

/** Which of a variant's affixes hit the query targets (for the "why" column). */
function contributingAffixes(variant, targets) {
  const t = new Set(targets);
  return (variant.affixes || []).filter((a) => t.has(a.stat));
}

/** Reconstruct a concrete augment->item assignment from the solver's aggregate
 *  per-color-capacity placements. The solver decides WHICH augments are placed and
 *  which slot COLOR each consumes (`slot_color` — multi-fit: a Red augment may
 *  consume an Orange slot); it does not pin the host item (that would need the
 *  per-slot variables we deliberately dropped for program size). Reconstruct the
 *  host deterministically: walk equipped items in order and drop each placed
 *  augment into the first item with remaining open capacity of the slot color it
 *  consumed. Capacity feasibility is guaranteed by the solver's per-color bound,
 *  so a placed augment always finds a home. Returns { byIndex, unplaced }. */
function assignAugments(chosen, augmentsPlaced) {
  const remaining = chosen.map((c) => {
    const m = new Map();
    for (const col of ((c.variant.augment_slots_norm || {}).colors) || []) m.set(col, (m.get(col) || 0) + 1);
    return m;
  });
  const byIndex = new Map();
  const unplaced = [];
  for (const aug of augmentsPlaced || []) {
    const want = aug.slot_color || aug.color; // the slot color consumed (falls back to own color)
    let placed = false;
    for (let i = 0; i < chosen.length; i++) {
      if ((remaining[i].get(want) || 0) > 0) {
        remaining[i].set(want, remaining[i].get(want) - 1);
        if (!byIndex.has(i)) byIndex.set(i, []);
        byIndex.get(i).push(aug);
        placed = true;
        break;
      }
    }
    if (!placed) unplaced.push(aug);
  }
  return { byIndex, unplaced };
}

/** Reconstruct a concrete Dino-insert -> item assignment from the solver's
 *  aggregate per-key placements (mirrors assignAugments). Slots are keyed by
 *  `dino_type||category` (KTD1). Walk equipped items in order and drop each
 *  placed insert unit into the first equipped item with a remaining open Dino
 *  slot matching the unit's (type, category). */
function dinoInsertKey(ins) {
  return `${ins.dino_type}||${ins.category || "Accessory"}`;
}
function assignDinoInserts(chosen, dinoPlaced) {
  const remaining = chosen.map((c) => {
    const m = new Map();
    for (const t of c.variant.dino_slots_norm || []) m.set(t, (m.get(t) || 0) + 1);
    return m;
  });
  const byIndex = new Map();
  const unplaced = [];
  for (const ins of dinoPlaced || []) {
    const key = dinoInsertKey(ins);
    let placed = false;
    for (let i = 0; i < chosen.length; i++) {
      if ((remaining[i].get(key) || 0) > 0) {
        remaining[i].set(key, remaining[i].get(key) - 1);
        if (!byIndex.has(i)) byIndex.set(i, []);
        byIndex.get(i).push(ins);
        placed = true;
        break;
      }
    }
    if (!placed) unplaced.push(ins);
  }
  return { byIndex, unplaced };
}

/** Sets you are exactly one piece short of, whose next tier would advance a
 *  target. Display-only nudge; never changes the computed optimum. */
function nearMissSetHints(chosen, targets) {
  const t = new Set(targets);
  const counts = new Map();       // set name -> equipped piece count
  const tiersBySet = new Map();   // set name -> Map(pieces_label -> tier)
  for (const c of chosen) {
    for (const sb of c.variant.set_bonus || []) {
      if (sb.set) counts.set(sb.set, (counts.get(sb.set) || 0) + 1);
    }
    for (const tier of c.variant.parsed_set_bonuses || []) {
      if (tier.pieces_required == null || !(tier.affixes || []).length) continue;
      if (!tiersBySet.has(tier.set)) tiersBySet.set(tier.set, new Map());
      const byLabel = tiersBySet.get(tier.set);
      if (!byLabel.has(tier.pieces_label)) byLabel.set(tier.pieces_label, tier);
    }
  }
  const hints = [];
  for (const [setName, byLabel] of tiersBySet) {
    const have = counts.get(setName) || 0;
    for (const [, tier] of byLabel) {
      if (tier.pieces_required !== have + 1) continue;
      const adv = tier.affixes.filter((a) => t.has(a.stat) && a.value > 0);
      if (adv.length) {
        hints.push({ set: setName, have, need: tier.pieces_required, affixes: adv });
      }
    }
  }
  return hints;
}

function coverageNote(dataset) {
  const m = (dataset && dataset.metadata) || {};
  const aug = (m.color_coverage || {}).augments_placeable;
  const setAff = (m.set_coverage || {}).set_affixes_parsed;
  const dc = m.dino_coverage || {};
  const dinoElig = dc.inserts_eligible;
  const nc = m.nc_coverage || {};
  const ncElig = nc.options_eligible;
  const ncHosts = nc.hosts_activated;
  const vik = m.viktranium_coverage || {};
  const vikElig = vik.options_eligible;
  const vikHosts = vik.hosts_active;
  const sl = m.seal_coverage || {};
  const sealElig = sl.options_eligible;
  const sealHosts = sl.hosts_active;
  const sealPending = (sl.seal_types_pending || []).join("/");
  const comp = m.compendium_coverage || {};
  const parts = [
    "<strong>Optimized:</strong> worn affixes, augments" +
      (aug != null ? ` (${aug} placeable)` : "") +
      ", set bonuses" + (setAff != null ? ` (${setAff} threshold effects)` : "") +
      ", Isle of Dread Dino crafting" + (dinoElig != null ? ` (${dinoElig} inserts across Accessory/Armor/Weapon/Raid slots, ${dc.blank_hosts != null ? dc.blank_hosts + " hosts" : "typed"})` : "") +
      ", U81 Nearly Complete crafting" +
      (ncHosts ? ` (${ncHosts} item hosts, ${ncElig != null ? ncElig + " options" : "sourced pool"})` : "") +
      ", U81 Viktranium / Lamordia crafting" +
      (vikHosts ? ` (${vikHosts} item hosts, ${vikElig != null ? vikElig + " options" : "sourced pool"})` : "") +
      ", and Sealed-in-Undeath seal-slot crafting" +
      (sealHosts ? ` (${sealHosts} item hosts, ${sealElig != null ? sealElig + " options" : "sourced pool"})` : ""),
    "<strong>Coverage:</strong> results reflect only verified, wiki-sourced data; ambiguous effects are quarantined and excluded",
    "<strong>Pending:</strong> the Dino Set-Bonus pool (crafted set-membership; sourced + browsable, activation awaits intrinsic named/raid set pieces)" +
      (sealPending ? `, the Sealed-in-${sealPending} seal pools (hosts identified, option pools awaiting harvest)` : "") +
      ", and other expansion crafting systems",
    "<strong>Compendium:</strong> " +
      (comp.total_indexed != null ? `${comp.total_indexed} named items indexed across the game` : "named-item index in progress") +
      (comp.enriched_matched != null ? `, of which ${comp.enriched_matched} are enriched and solver-active` : "") +
      " — indexed-only items are browsable (name, slot, wiki link) but not yet stat-sourced, so the solver ranges over the enriched set; stat enrichment proceeds in batches",
  ];
  return `<p class="scope-note">${parts.join(". ")}. All optimized values are wiki-traceable.</p>`;
}

// Map a solver worn-slot name to its paperdoll grid position class (KTD2).
// Ring is cardinality-2, so the caller passes which ring (0 or 1). Unknown slots
// fall to "misc" so a new slot is surfaced, never silently dropped.
const SLOT_POSITION = {
  Helmet: "helmet", Goggles: "goggles", Necklace: "necklace", Trinket: "trinket",
  Cloak: "cloak", Belt: "belt", Armor: "armor", Gloves: "gloves", Bracers: "bracers",
  Boots: "boots", Quiver: "quiver", "Main Hand": "mainhand",
  "Rune Arm": "offhand", "Off Hand": "offhand",
};
function slotPosition(slot, ringIndex) {
  if (slot === "Ring") return ringIndex > 0 ? "ring2" : "ring1";
  return SLOT_POSITION[slot] || "misc";
}

// escape for safe interpolation of data-derived strings into HTML
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// href guard: only http(s) URLs are emitted; anything else (javascript:, data:,
// …) becomes an inert "#". Defense-in-depth — esc() alone stops attribute
// breakout but not a hostile scheme. Returns an already-escaped, safe href value.
function safeUrl(u) {
  return /^https?:\/\//i.test(String(u || "")) ? esc(u) : "#";
}

// Build the per-slot detail chips (contributing affixes + every craft prescription).
function slotDetailChips(v, idx, query, maps) {
  const contrib = contributingAffixes(v, query.targets)
    .map((a) => `<span class="chip">${esc(affixLabel(a))}</span>`).join(" ");
  const augs = (maps.augAssign.byIndex.get(idx) || []).map((a) => {
    const where = a.slot_color && a.slot_color !== a.color ? `${a.color} in ${a.slot_color} slot` : (a.color || "");
    return `<span class="chip aug" title="augment slotted (${esc(where)})">${esc(a.variant_id)} <span class="muted">(${esc(where)})</span></span>`;
  }).join(" ");
  const dinos = (maps.dinoAssign.byIndex.get(idx) || []).map((d) => {
    const affixes = (d.affixes && d.affixes.length) ? d.affixes
      : [{ stat: d.stat, bonus_type: d.bonus_type, value: d.value, unit: d.unit || "flat" }];
    const label = affixes.map((a) => affixLabel({ stat: a.stat, bonus_type: a.bonus_type, value: a.value, unit: a.unit || "flat" })).join(", ");
    return `<span class="chip dino" title="Isle of Dread ${esc(d.dino_type)} insert">${esc(d.dino_type)}: ${d.name ? esc(d.name) + " — " : ""}${esc(label)}</span>`;
  }).join(" ");
  const ncs = (maps.ncByItem.get(v.variant_id) || [])
    .map((n) => `<span class="chip nc" title="U81 Nearly Complete (${esc(n.category)}, ${esc(n.tier)})">Nearly Complete: ${esc(affixLabel({ stat: n.stat, bonus_type: n.bonus_type, value: n.value, unit: n.unit || "flat" }))}</span>`).join(" ");
  const rolls = (maps.rollByItem.get(v.variant_id) || [])
    .map((r) => `<span class="chip roll" title="choice-slot: best option selected">Choice: ${esc(affixLabel({ stat: r.stat, bonus_type: r.bonus_type, value: r.value, unit: r.unit || "flat" }))}</span>`).join(" ");
  const viks = (maps.vikByItem.get(v.variant_id) || [])
    .map((n) => `<span class="chip lamordia" title="U81 Viktranium / Lamordia (${esc(n.slot_type)} ${esc(n.category)}, ${esc(n.tier)})">Lamordia ${esc(n.slot_type)}: ${esc(affixLabel({ stat: n.stat, bonus_type: n.bonus_type, value: n.value, unit: n.unit || "flat" }))}</span>`).join(" ");
  const seals = (maps.sealByItem.get(v.variant_id) || [])
    .map((n) => `<span class="chip seal" title="Sealed in ${esc(n.seal_type)} — unseal one effect at the crafting table">Sealed in ${esc(n.seal_type)}: ${esc(affixLabel({ stat: n.stat, bonus_type: n.bonus_type, value: n.value, unit: n.unit || "flat" }))}</span>`).join(" ");
  const link = v.wiki_url ? `<a href="${safeUrl(v.wiki_url)}" target="_blank" rel="noopener">wiki ↗</a>` : "";
  const chips = [contrib, augs, dinos, ncs, rolls, viks, seals].filter(Boolean).join(" ");
  return `<div>${chips || '<span class="muted">— no target-relevant affixes —</span>'}</div>${link ? `<div class="pd-craftline">${link}</div>` : ""}`;
}

// One paperdoll slot cell. `pick` is {variant, idx} or null for an empty slot.
function paperdollSlot(slotName, pos, pick, query, maps) {
  if (!pick) {
    return `<div class="pd-slot empty pos-${pos}"><div class="pd-label">${esc(slotName)}</div><div class="pd-item"><span class="muted">— empty —</span></div></div>`;
  }
  const v = pick.variant;
  return `<details class="pd-slot occupied pos-${pos}">
    <summary>
      <div class="pd-label">${esc(slotName)}</div>
      <div class="pd-item"><span>${esc(v.variant_id)}</span><span class="ml">ML ${esc(v.minimum_level ?? "—")}</span></div>
    </summary>
    <div class="pd-detail">${slotDetailChips(v, pick.idx, query, maps)}</div>
  </details>`;
}

// Bonus-type/source breakdown bars for one target (R2, R7).
function breakdownBars(parts, total) {
  const base = Math.max(total, parts.reduce((s, p) => s + p.value, 0), 1);
  if (!parts.length) return `<div class="stat-empty">no contributing gear for this target</div>`;
  return `<div class="stat-bars">${parts.map((p) => {
    const kind = p.sourceKind === "set" ? "is-set" : (p.sourceKind === "augment" ? "is-augment" : "");
    const src = p.sourceKind === "set" ? `set: ${p.source}` : p.source;
    const pct = Math.max(4, Math.round((p.value / base) * 100));
    return `<div class="stat-bar">
      <div class="bar-meta"><span class="bar-type">${esc(p.bonus_type)}</span><span class="bar-src ${kind}" title="${esc(src)}">${esc(src)}</span></div>
      <span class="bar-val">+${esc(p.value)}</span>
      <div class="bar-track"><div class="bar-fill ${kind}" style="width:${pct}%"></div></div>
    </div>`;
  }).join("")}</div>`;
}

// Count-up motion (KTD4), robust to motion NOT running (AE4). The final value is
// written into the DOM first and stays there unless an animation frame actually
// fires — so if requestAnimationFrame is throttled/absent, or reduced-motion is
// set, the correct result is always readable immediately, never gated on motion.
function animateCounters(container) {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  container.querySelectorAll(".stat-value").forEach((el) => {
    const final = Number(el.getAttribute("data-final")) || 0;
    el.firstChild.textContent = String(final);              // final value in place first
    if (reduce || final <= 0 || typeof requestAnimationFrame !== "function") return;
    const dur = 520;
    let started = null;
    const tick = (now) => {
      if (started === null) started = now;                  // anchor on the FIRST real frame
      const p = Math.min(1, (now - started) / dur);
      el.firstChild.textContent = String(Math.round(final * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
      else el.firstChild.textContent = String(final);
    };
    requestAnimationFrame(tick);                            // only dips low once a frame runs
  });
}

function renderResults(container, { model, result, query, dataset }) {
  if (result.status !== "optimal") {
    container.innerHTML = `<div class="empty">No set satisfies these constraints${result.reason ? ` — ${esc(result.reason)}` : ""}.<br><span class="muted">Loosen the ML cap, armor/class filters, or targets.</span></div>`;
    return;
  }

  // group equipped picks by slot, preserving a flat index for augment assignment
  const augAssign = assignAugments(result.chosen, result.augmentsPlaced);
  const dinoAssign = assignDinoInserts(result.chosen, result.dinoPlaced);
  const byItemMap = (list) => {
    const m = new Map();
    for (const n of list || []) { if (!m.has(n.item)) m.set(n.item, []); m.get(n.item).push(n); }
    return m;
  };
  const maps = {
    augAssign, dinoAssign,
    ncByItem: byItemMap(result.ncPlaced), rollByItem: byItemMap(result.rollPlaced),
    vikByItem: byItemMap(result.vikPlaced), sealByItem: byItemMap(result.sealPlaced),
  };

  // group equipped picks by slot (preserving the flat index augment assignment used)
  const picksBySlot = new Map();
  result.chosen.forEach((c, idx) => {
    if (!picksBySlot.has(c.slot)) picksBySlot.set(c.slot, []);
    picksBySlot.get(c.slot).push({ variant: c.variant, idx });
  });

  // --- hero: ranked-target readout (R1, R2, R3, R7) ---
  const cs = result.computeScale || { variants: 0, crafts: 0, stages: 0 };
  const banner = `
    <div class="solve-banner">
      <div class="solve-verdict"><span class="dot"></span><span class="label">OPTIMAL</span><span class="sub">· exact MILP, provably best</span></div>
      <div class="solve-scale">
        <div class="scale-item"><span class="n">${esc(cs.variants)}</span><span class="k">variants</span></div>
        <div class="scale-item"><span class="n">${esc(cs.crafts)}</span><span class="k">craft options</span></div>
        <div class="scale-item"><span class="n">${esc(cs.stages)}</span><span class="k">solve stages</span></div>
        <div class="scale-item"><span class="n">${esc(result.solveMs ?? "—")}</span><span class="k">ms</span></div>
      </div>
    </div>`;

  const cards = query.targets.map((stat, i) => {
    const total = result.effective[stat] ?? 0;
    const parts = (result.breakdown && result.breakdown[stat]) || [];
    // A capped stat (e.g. Dodge under an armor cap) shows the CAPPED achieved
    // value as the headline, but the raw contributions can sum higher. Disclose
    // the cap so the headline and the breakdown bars don't read as a contradiction.
    const cap = result.capped ? result.capped[stat] : null;
    const rawSum = parts.reduce((s, p) => s + p.value, 0);
    const capNote = (cap != null && rawSum > total)
      ? `<span class="stat-cap" title="raw ${esc(rawSum)} exceeds the cap for this stat">capped at ${esc(total)} · raw ${esc(rawSum)}</span>` : "";
    return `<div class="stat-card">
      <div class="stat-head"><span class="stat-rank">${i + 1}</span><span class="stat-name">${esc(stat)}</span></div>
      <div class="stat-value" data-final="${esc(total)}">${esc(total)}</div>
      ${capNote}
      ${breakdownBars(parts, total)}
    </div>`;
  }).join("");

  // --- paperdoll (R4, R5) ---
  const cells = [];
  for (const slot of model.worn) {
    const picks = picksBySlot.get(slot.slot) || [];
    const cardinality = slot.cardinality || 1;
    for (let r = 0; r < cardinality; r++) {
      const pos = slotPosition(slot.slot, r);
      cells.push(paperdollSlot(slot.slot, pos, picks[r] || null, query, maps));
    }
  }

  // --- sets (R6, R7, R8) ---
  const active = (result.setsActive || []).map((s) =>
    `<li class="set-card"><strong>${esc(s.set)}</strong> <span class="meta">— ${esc(s.pieces_required)}-piece bonus active</span></li>`).join("");
  const nearMiss = nearMissSetHints(result.chosen, query.targets).map((h) =>
    `<li class="set-card near"><strong>${esc(h.set)}</strong> <span class="meta">(${esc(h.have)}/${esc(h.need)}) — one more piece adds ${esc(h.affixes.map(affixLabel).join(", "))}</span></li>`).join("");
  const setsBlock = (active || nearMiss) ? `
    <div class="sets-section">
      <h3 class="section-title">Set bonuses</h3>
      <ul class="sets">${active}${nearMiss}</ul>
    </div>` : "";

  container.innerHTML = `
    ${banner}
    <div class="readout-grid">
      <div class="readout-main">
        <div class="readout-hero">
          <h3 class="section-title">Achieved — ranked priority</h3>
          <div class="targets">${cards}</div>
          ${setsBlock}
        </div>
        <div class="readout-doll">
          <h3 class="section-title">Loadout</h3>
          <div class="paperdoll">${cells.join("")}</div>
        </div>
      </div>
    </div>
    ${coverageNote(dataset)}`;

  animateCounters(container);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderResults, affixLabel, assignAugments, assignDinoInserts, nearMissSetHints, coverageNote, slotPosition, breakdownBars, esc, safeUrl };
}
