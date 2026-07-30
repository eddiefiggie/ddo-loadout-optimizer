// U8 — render a solved loadout as a full build sheet. Display-only; the
// optimization happens in the solver (U1/U3/U5). Set bonuses and augments are
// now optimized and prescribed here; crafting/upgrade paths are a pending
// follow-up, surfaced honestly in the coverage disclosure.

function affixLabel(a) {
  // Boolean feature (U4): presence, not a magnitude. Render a marker so it never
  // reads as a broken "+N" next to real magnitudes.
  if (a.bonus_type === "boolean") return `✓ ${a.stat}`;
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
  // Slots left open per item after placement — the substrate for U10's
  // "unused augment slot" / unrealized-upgrade note.
  const freeByIndex = new Map();
  remaining.forEach((m, i) => {
    const cols = [];
    for (const [col, n] of m) for (let k = 0; k < n; k++) cols.push(col);
    if (cols.length) freeByIndex.set(i, cols);
  });
  return { byIndex, unplaced, freeByIndex };
}

// Standard fillable augment-slot colors — a generic augment can go here, so an
// open one is a realizable upgrade. Named crafting slots (Lamordia, celestial)
// need specific augments and are shown as craft slots, not flagged as unused.
const STD_AUG_COLORS = new Set(["blue", "red", "yellow", "green", "orange", "purple", "colorless", "clear"]);

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

/** Per-target contributor attribution for the achieved-priority view (R11, R12,
 *  R16). Reads the solver's already-computed breakdown (which now carries the
 *  host slot for worn + item-crafts and the yielding slots for sets, KTD6) and
 *  fills the remaining augment host slot from the augment reconstruction. Returns
 *  { stat: [{ bonus_type, value, source, sourceKind, slots:[...], isSet }], ... },
 *  highest-value first — presentation only, no solve. */
function attributionByTarget(result, augAssign) {
  const breakdown = result.breakdown || {};
  // augment host reconstruction (the paperdoll uses the same assignment). Map each
  // placed augment to both its host slot (for display) and host variant_id (for
  // precise per-item matching). Accept a precomputed assignment to avoid re-running it.
  augAssign = augAssign || assignAugments(result.chosen, result.augmentsPlaced);
  const augSlot = new Map(), augHost = new Map();
  for (const [idx, augs] of augAssign.byIndex) {
    const host = result.chosen[idx];
    for (const a of augs) {
      augSlot.set(a.variant_id, host && host.slot);
      augHost.set(a.variant_id, host && host.variant && host.variant.variant_id);
    }
  }
  const out = {};
  for (const stat of Object.keys(breakdown)) {
    out[stat] = breakdown[stat].map((p) => {
      let slots = [];
      let hostIds = p.hostIds ? p.hostIds.slice() : [];
      if (p.setYieldingSlots && p.setYieldingSlots.length) slots = p.setYieldingSlots.slice();
      else if (p.slot) slots = [p.slot];
      else if (p.sourceKind === "augment" && augSlot.has(p.source)) slots = [augSlot.get(p.source)];
      if (!hostIds.length && p.sourceKind === "augment" && augHost.has(p.source)) hostIds = [augHost.get(p.source)];
      return {
        bonus_type: p.bonus_type, value: p.value, source: p.source,
        sourceKind: p.sourceKind, slots, hostIds, isSet: p.sourceKind === "set",
      };
    });
  }
  return out;
}

/** Which ranked targets a specific equipped item wins, and by how much (R8, R9)
 *  — the justification for a pick, especially a surprising low-ML one. `item` is
 *  { slot, variant_id }. Matches every contribution by HOST variant_id (worn, set,
 *  craft, and augment all carry their host id) so the two Rings — which share the
 *  slot name "Ring" — never claim each other's set/craft/augment wins. Pass the
 *  precomputed `attr` from renderResults to avoid re-deriving it per slot. Returns
 *  [{ stat, value, viaSet }], highest first; empty for a filler/tie-break pick. */
function whyThis(result, item, attr) {
  attr = attr || attributionByTarget(result);
  const wins = [];
  for (const stat of Object.keys(attr)) {
    let val = 0, viaSet = false, boolean = false;
    for (const p of attr[stat]) {
      if ((p.hostIds || []).includes(item.variant_id)) {
        val += p.value;
        if (p.isSet) viaSet = true;
        if (p.bonus_type === "boolean") boolean = true;   // U4: presence win
      }
    }
    if (val > 0) wins.push({ stat, value: val, viaSet, boolean });
  }
  wins.sort((a, b) => b.value - a.value);
  return wins;
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
  const band = m.band_coverage || {};
  const bandParts = [];
  if (band.by_slot) {
    const roll = {};
    for (const key of Object.keys(band.by_slot)) {
      const exp = key.split("/")[0];
      const c = band.by_slot[key];
      const r = roll[exp] || (roll[exp] = { band_total: 0, enriched: 0, quarantined: 0, pending: 0 });
      r.band_total += c.band_total; r.enriched += c.enriched;
      r.quarantined += c.quarantined; r.pending += c.pending;
    }
    const label = { isle_of_dread: "Isle of Dread", myth_drannor: "Myth Drannor", u81: "U81" };
    for (const exp of Object.keys(roll).sort()) {
      const r = roll[exp];
      let s = `${label[exp] || exp} ${r.enriched}/${r.band_total} enriched`;
      if (r.quarantined) s += `, ${r.quarantined} quarantined`;
      if (r.pending) s += `, ${r.pending} pending`;
      bandParts.push(s);
    }
  }
  const parts = [
    "<strong>Optimized:</strong> worn affixes, augments" +
      (aug != null ? ` (${aug} placeable)` : "") +
      ", set bonuses" + (setAff != null ? ` (${setAff} threshold effects)` : "") +
      ", Isle of Dread Dino crafting" + (dinoElig != null ? ` (${dinoElig} inserts across Accessory/Armor/Weapon/Raid slots, ${dc.blank_hosts != null ? dc.blank_hosts + " hosts" : "typed"})` : "") +
      ", Nearly Completed crafting" +
      (ncHosts ? ` (${ncHosts} item hosts, ${ncElig != null ? ncElig + " options" : "sourced pool"})` : "") +
      ", Viktranium Experiment crafting" +
      (vikHosts ? ` (${vikHosts} item hosts, ${vikElig != null ? vikElig + " options" : "sourced pool"})` : "") +
      ", and Sealed-in-Undeath seal-slot crafting" +
      (sealHosts ? ` (${sealHosts} item hosts, ${sealElig != null ? sealElig + " options" : "sourced pool"})` : ""),
    "<strong>Coverage:</strong> results reflect only verified, wiki-sourced data; ambiguous effects are quarantined and excluded",
    "<strong>Pending:</strong> the Dinosaur Bone Set Bonus augments (crafted and slotted on Isle of Dread hosts; sourced + browsable, activation awaits intrinsic named/raid set pieces)" +
      (sealPending ? `, the Sealed-in-${sealPending} seal pools (hosts identified, option pools awaiting harvest)` : "") +
      ", and other expansion crafting systems",
    "<strong>Compendium:</strong> " +
      (comp.total_indexed != null ? `${comp.total_indexed} named items indexed across the game` : "named-item index in progress") +
      (comp.enriched_matched != null ? `, of which ${comp.enriched_matched} are enriched and solver-active` : "") +
      " — indexed-only items are browsable (name, slot, wiki link) but not yet stat-sourced, so the solver ranges over the enriched set; stat enrichment proceeds in batches",
  ];
  if (bandParts.length) {
    parts.push("<strong>Endgame band (ML30-36):</strong> " + bandParts.join(", ") +
      " — the exhaustive named + raid gear of these expansions, each item enriched or quarantined (none silently missing)");
  }
  const sec = m.set_enrichment_coverage;
  if (sec && sec.enriched_members_with_set_bonus) {
    let s = `<strong>Set bonuses on enriched gear:</strong> ${sec.enriched_members_with_set_bonus} enriched set members now count toward set thresholds across ${sec.distinct_enriched_sets} sets`;
    const membershipOnly = (sec.membership_only_sets || []).length + (sec.known_undefined_sets || []).length;
    if (membershipOnly) {
      s += `; ${membershipOnly} set${membershipOnly === 1 ? "" : "s"} contribute membership only (non-rankable or undefined bonus, disclosed)`;
    }
    parts.push(s);
  }
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

// Craft/augment prescriptions applied to an equipped item (augments, Dino inserts,
// Nearly Completed, choice slots, Viktranium, seals, wildcard), as labeled chips.
// Used by the Loadout Deep Dive so every applied bonus is visible. Returns an array.
// Crafting-system label registry (U1). Global in the browser (loaded before
// results.js); require()'d in Node tests where the global isn't present.
const CraftingReg = (typeof CraftingSystems !== "undefined") ? CraftingSystems
  : (typeof require !== "undefined" ? require("./crafting-systems.js") : null);

// One craft option's value label (e.g. "Constitution +15"). Shared by every
// craft-chip family so the Deep Dive and the equipped block read identically.
function craftLbl(o) {
  return esc(affixLabel({ stat: o.stat, bonus_type: o.bonus_type, value: o.value, unit: o.unit || "flat" }));
}

// The applied craft-upgrade chips for one item — Dino inserts, Nearly Completed,
// choice slots, Viktranium, seals, Thunder-Forged, Green Steel — keyed by the
// chosen index (dino) or variant_id (the rest). Assigned crafts only (the maps
// carry no empty-slot inventory). Shared by the Loadout Deep Dive (craftChips)
// and the equipped-block detail (equippedBody, U2) so the two never drift.
function craftSlotChips(v, idx, maps) {
  const dinos = (maps.dinoAssign.byIndex.get(idx) || []).map((d) => {
    const affixes = (d.affixes && d.affixes.length) ? d.affixes : [d];
    const label = affixes.map(craftLbl).join(", ");
    return `<span class="chip dino" title="Isle of Dread insert">${esc(d.dino_type)}: ${d.name ? esc(d.name) + ", " : ""}${label}</span>`;
  });
  const ncs = (maps.ncByItem.get(v.variant_id) || []).map((n) => `<span class="chip nc" title="Terror of Demogorgon — Nearly Completed">Nearly Completed: ${craftLbl(n)}</span>`);
  const rolls = (maps.rollByItem.get(v.variant_id) || []).map((r) => `<span class="chip roll" title="choice slot, best option selected">Choice: ${craftLbl(r)}</span>`);
  const viks = (maps.vikByItem.get(v.variant_id) || []).map((n) => `<span class="chip lamordia" title="The Chill of Ravenloft — Viktranium Experiment crafting">Slot ${esc(n.slot_type)} Viktranium augment: ${craftLbl(n)}</span>`);
  const seals = (maps.sealByItem.get(v.variant_id) || []).map((n) => `<span class="chip seal" title="unseal one effect at the crafting table">Sealed in ${esc(n.seal_type)}: ${craftLbl(n)}</span>`);
  const tfs = ((maps.tfByItem && maps.tfByItem.get(v.variant_id)) || []).map((n) => `<span class="chip thunderforged" title="Legendary Thunder-Forged tier upgrade">Thunder-Forged T${esc(n.tier)}: ${craftLbl(n)}</span>`);
  const gss = ((maps.gsByItem && maps.gsByItem.get(v.variant_id)) || []).map((n) => `<span class="chip greensteel" title="Legendary Green Steel craft">Green Steel: ${craftLbl(n)}</span>`);
  return [...dinos, ...ncs, ...rolls, ...viks, ...seals, ...tfs, ...gss];
}

function craftChips(v, idx, maps) {
  const augs = (maps.augAssign.byIndex.get(idx) || []).map((a) => {
    const where = a.slot_color && a.slot_color !== a.color ? `${a.color} in ${a.slot_color} slot` : (a.color || "");
    return `<span class="chip aug" title="augment slotted">${esc(a.variant_id)} <span class="muted">(${esc(where)})</span></span>`;
  });
  const jokers = ((maps.jokerByHost && maps.jokerByHost.get(v.variant_id)) || []).map((j) => `<span class="chip joker" title="wildcard set piece">Wildcard set: ${esc(j.set)}</span>`);
  // Membership chip (R3/R4): Vecna Lost Purpose and Isle-of-Dread Set Bonus flow
  // through one solver primitive but must render different labels — fork on the
  // station via the registry (KTD2). Only Vecna keeps "Awaken".
  const memberships = ((maps.membershipByHost && maps.membershipByHost.get(v.variant_id)) || []).map((m) => {
    // Unknown/absent station defaults to the Dino system (the non-Vecna label),
    // matching the prior fallthrough behavior.
    const sysId = (CraftingReg && CraftingReg.systemForStation(m.station)) || "isle-of-dread-set-bonus";
    const isVecna = sysId === "vecna-lost-purpose";
    const cls = isVecna ? "chip awaken" : "chip setbonus";
    // The label text comes from the registry (single source of truth), not a
    // hardcoded string — a terminology edit in crafting-systems.js now flows
    // straight to the chip instead of drifting from it.
    const text = CraftingReg ? CraftingReg.actionLabel(sysId, { set_name: m.set }) : `Slot Set Bonus augment: ${m.set}`;
    const title = isVecna ? `awaken this set at the ${esc(m.station || "Cannith Repurposing Station")}`
      : `slot a Dinosaur Bone Set Bonus augment at ${esc(m.station || "Dinosaur Bone crafting")}`;
    return `<span class="${cls}" title="${title}">${esc(text)}${m.station ? ` <span class="muted">(${esc(m.station)})</span>` : ""}</span>`;
  });
  return [...augs, ...craftSlotChips(v, idx, maps), ...jokers, ...memberships];
}

/** Sets actually complete in the equipped loadout (U6) — the glow signal. Two
 *  sources, unioned: (1) a static set whose equipped piece count meets its lowest
 *  piece-threshold tier (covers a set that is threshold-met but advanced no ranked
 *  target, which `setsActive` alone would drop); (2) `setsActive`, the solver's
 *  authoritative active-set signal, which additionally covers sets completed by
 *  runtime pieces that carry no static `set_bonus`/`parsed_set_bonuses` — a Gem of
 *  Many Facets joker or a Vecna Lost Purpose awaken. Gating the glow on membership
 *  (the old behavior) lit pieces of an unsatisfied set; this gates on completion. */
function satisfiedSets(chosen, setsActive) {
  const counts = new Map();   // set -> equipped piece count
  const minReq = new Map();   // set -> lowest pieces_required across its tiers
  for (const c of chosen || []) {
    for (const sb of c.variant.set_bonus || []) {
      if (sb.set) counts.set(sb.set, (counts.get(sb.set) || 0) + 1);
    }
    for (const tier of c.variant.parsed_set_bonuses || []) {
      if (tier.pieces_required == null) continue;
      const cur = minReq.get(tier.set);
      if (cur == null || tier.pieces_required < cur) minReq.set(tier.set, tier.pieces_required);
    }
  }
  const out = new Set();
  for (const [set, need] of minReq) if ((counts.get(set) || 0) >= need) out.add(set);
  for (const s of setsActive || []) if (s.set) out.add(s.set);   // runtime-completed (joker/membership)
  return out;
}

// The set(s) an equipped piece belongs to, stated on its slot (R15). When
// `satisfied` (from satisfiedSets) is passed, only sets that are actually
// complete are returned — so the .is-set glow (U6) fires on satisfaction, not
// mere membership. Omitting `satisfied` keeps the raw membership list.
function slotSetNames(v, satisfied) {
  const names = [...new Set((v.set_bonus || []).map((s) => s.set).filter(Boolean))];
  return satisfied ? names.filter((n) => satisfied.has(n)) : names;
}

// One paperdoll slot cell: uniform, fixed-size, showing only the item name, ML,
// and the set it belongs to. A set piece gets a themed highlight frame (.is-set).
// Full affixes/crafts live in the Loadout Deep Dive tab, not on the cell.
function paperdollSlot(label, pos, pick, satisfied) {
  if (!pick) {
    return `<div class="pd-slot empty pos-${pos}"><div class="pd-label">${esc(label)}</div><div class="pd-item muted">empty</div></div>`;
  }
  const v = pick.variant;
  const memberSets = slotSetNames(v);                          // U6: label = membership
  const glow = slotSetNames(v, satisfied).length > 0;          // U6: glow = satisfaction (via helper)
  const setLine = memberSets.length ? `<div class="pd-setname" title="part of a set bonus">${esc(memberSets.join(", "))}</div>` : "";
  return `<div class="pd-slot occupied pos-${pos}${glow ? " is-set" : ""}">
    <div class="pd-label">${esc(label)}</div>
    <div class="pd-item" title="${esc(v.variant_id)}">${esc(v.variant_id)}</div>
    <div class="pd-foot"><span class="pd-ml">ML ${esc(v.minimum_level ?? "?")}</span>${setLine}</div>
  </div>`;
}

// Loadout Deep Dive: one block per equipped item showing where it is worn, its
// affixes, its set membership, and every applied craft/augment (R5 detail moved
// off the paperdoll cell into this tab).
function loadoutDeepDive(result, query, maps, attr) {
  if (!result.chosen.length) return `<p class="dd-none muted">No items equipped for this build.</p>`;
  const satisfied = satisfiedSets(result.chosen, result.setsActive);   // U6: glow on completion, not membership
  const freeByIndex = (maps && maps.augAssign && maps.augAssign.freeByIndex) || new Map();
  return `<div class="deepdive">${result.chosen.map((c, idx) => {
    const v = c.variant;
    // U10: flag open standard-color augment slots as a concrete unrealized upgrade.
    const openAug = (freeByIndex.get(idx) || []).filter((col) => STD_AUG_COLORS.has(String(col).toLowerCase()));
    const upgradeNote = openAug.length
      ? `<div class="dd-upgrade"><span class="dd-upgrade-tag">Unrealized upgrade</span> ${openAug.length} open augment slot${openAug.length === 1 ? "" : "s"} (${esc(openAug.join(", "))}) — slot an augment here for more stats.</div>`
      : "";
    const memberSets = slotSetNames(v);                        // U6: label = raw membership (informative)
    const glow = slotSetNames(v, satisfied).length > 0;        // U6: is-set glow = satisfaction (via the helper)
    const affixes = (v.affixes || []).length
      ? `<ul class="dd-list">${v.affixes.map((a) => `<li>${esc(affixLabel(a))}</li>`).join("")}</ul>`
      : `<p class="dd-none muted">No parsed affixes on this item.</p>`;
    const crafts = craftChips(v, idx, maps);
    const craftBlock = crafts.length
      ? `<div class="dd-crafts"><h5>Applied crafting &amp; augments</h5><div class="dd-chips">${crafts.join(" ")}</div></div>` : "";
    const wiki = v.wiki_url ? `<a class="dd-wiki" href="${safeUrl(v.wiki_url)}" target="_blank" rel="noopener">wiki</a>` : "";
    const artifactTag = v.artifact ? `<span class="dd-artifact" title="your one equipped Artifact">Artifact</span>` : "";
    return `<div class="dd-item${glow ? " is-set" : ""}${v.artifact ? " is-artifact" : ""}">
      <div class="dd-head"><span class="dd-slot">${esc(c.slot)}</span><span class="dd-name">${esc(v.variant_id)}</span>${artifactTag}<span class="dd-ml">ML ${esc(v.minimum_level ?? "?")}</span>${wiki}</div>
      ${whyThisLine(result, { slot: c.slot, variant_id: v.variant_id }, attr)}
      ${memberSets.length ? `<div class="dd-set"><span class="setpip"></span>Part of set: ${esc(memberSets.join(", "))}</div>` : ""}
      ${upgradeNote}
      <div class="dd-affixes"><h5>Affixes</h5>${affixes}</div>
      ${craftBlock}
    </div>`;
  }).join("")}</div>`;
}

// One row of the plain equipped list (prototype layout): slot label, the full
// item name (no truncation), ML, set membership, and a per-slot constraint
// control (U6: pin the current item / lock empty / free). The wizard reads the
// menu clicks via delegation, updates query.slotConstraints, and re-solves.
function equippedRow(label, pick, slotConstraints, satisfied, maps, augById) {
  const c = (slotConstraints || {})[label];
  const locked = c && c.type === "empty";
  const v = pick ? pick.variant : null;
  const canPin = v && !locked;
  const ctl = `<button class="pd-ctl" data-slot="${esc(label)}" title="constrain this slot" aria-label="constrain ${esc(label)}">&#8943;</button>`;
  const menu = `<div class="pd-menu" hidden>
    <button data-act="pin" data-slot="${esc(label)}" data-variant="${canPin ? esc(v.variant_id) : ""}"${canPin ? "" : " disabled"}>Pin this item</button>
    <button data-act="empty" data-slot="${esc(label)}">Lock empty</button>
    <button data-act="free" data-slot="${esc(label)}">Free (optimize)</button>
  </div>`;
  const badge = c && c.type === "pin" ? `<span class="pd-badge pin">pinned</span>`
    : locked ? `<span class="pd-badge empty">locked empty</span>` : "";
  const memberSets = v && !locked ? slotSetNames(v) : [];                          // U6: label = membership
  const glow = !!(v && !locked) && slotSetNames(v, satisfied).length > 0;          // glow = satisfaction (via helper)
  const setLine = memberSets.length ? `<span class="pd-rset" title="part of a set bonus">${esc(memberSets.join(", "))}</span>` : "";
  const isArtifact = !!(v && !locked && v.artifact);   // U5/R5 — tag the equipped Artifact's slot
  const artifactBadge = isArtifact ? `<span class="pd-badge artifact" title="your one equipped Artifact">Artifact</span>` : "";
  const name = locked ? "locked empty" : (v ? esc(v.variant_id) : "empty");
  const nameCls = (!v || locked) ? "pd-rname muted" : "pd-rname";
  const foot = (v && !locked)
    ? `<div class="pd-rfoot"><span class="pd-rml">ML ${esc(v.minimum_level ?? "?")}</span>${setLine}</div>` : "";
  // U9/U2: per-item stats + assigned augments (with their affixes) + assigned
  // craft slots, shown uniformly on every occupied block (empty blocks stay the
  // same height via the grid stretch + the .pd-row min-height). Assignment data
  // comes from `maps` (keyed by the pick's chosen index); `augById` resolves an
  // augment's affixes by variant_id (the placed meta carries none).
  const body = (v && !locked) ? equippedBody(v, pick ? pick.idx : -1, maps, augById) : "";
  const rowCls = `pd-row ${(!v || locked) ? "empty" : "occupied"}${glow ? " is-set" : ""}${isArtifact ? " is-artifact" : ""}${c ? " constrained" : ""}`;
  return `<div class="${rowCls}">
    <div class="pd-rtop"><div class="pd-rlabel">${esc(label)}</div>${ctl}</div>
    <div class="${nameCls}"${v ? ` title="${esc(v.variant_id)}"` : ""}>${name}</div>
    ${foot}${body}${artifactBadge}${badge}${menu}
  </div>`;
}

// The stats / augment / craft body of an equipped block. Projects the variant's
// own affixes, then — when the assignment `maps` (and `idx`) are supplied (U2) —
// the augments actually slotted (with the affixes they add, resolved by
// variant_id via `augById`) alongside any still-open augment slots, and the
// item's assigned craft-upgrade slots. Without maps it falls back to the plain
// slot-color pips, so no occupied block renders blank.
function equippedBody(v, idx, maps, augById) {
  const affixes = (v.affixes || []);
  const stats = affixes.length
    ? `<ul class="pd-stats">${affixes.map((a) => `<li>${esc(affixLabel(a))}</li>`).join("")}</ul>` : "";

  let augs = "";
  if (maps && maps.augAssign) {
    // Filled slots: the assigned augment + the affixes it adds (R3). Open slots:
    // still shown as a pip so an empty augment slot reads as an open upgrade (AE2).
    const placed = (idx != null && idx >= 0 && maps.augAssign.byIndex.get(idx)) || [];
    const open = (idx != null && idx >= 0 && maps.augAssign.freeByIndex.get(idx)) || [];
    const filled = placed.map((p) => {
      const meta = augById && augById.get(p.variant_id);
      const affx = (meta && meta.affixes && meta.affixes.length)
        ? `<span class="aug-affx">${esc(meta.affixes.map(affixLabel).join(", "))}</span>` : "";
      const col = String(p.color || "").toLowerCase();
      const where = p.slot_color && p.slot_color !== p.color ? `${p.color} in ${p.slot_color} slot` : `${p.color || ""} slot`;
      return `<li class="aug-filled"><span class="aug-pip aug-${esc(col)}" title="${esc(where)}"></span><span class="aug-name">${esc(p.variant_id)}</span>${affx}</li>`;
    });
    const openPips = open.map((c) =>
      `<li class="aug-open"><span class="aug-pip aug-${esc(String(c).toLowerCase())}" title="open ${esc(c)} augment slot"></span><span class="muted">open ${esc(c)} slot</span></li>`);
    if (filled.length || openPips.length) {
      augs = `<div class="pd-slots"><span class="pd-slabel">Augments</span><ul class="pd-auglist">${filled.join("")}${openPips.join("")}</ul></div>`;
    }
  } else {
    const augColors = (v.augment_slots_norm && v.augment_slots_norm.colors) || v.augment_slots || [];
    augs = augColors.length
      ? `<div class="pd-slots"><span class="pd-slabel">Augments</span>${augColors.map((c) =>
          `<span class="aug-pip aug-${esc(String(c).toLowerCase())}" title="${esc(c)} augment slot">${esc(c)}</span>`).join("")}</div>` : "";
  }

  // Assigned craft-upgrade slots (R4) — the same shared chips the Deep Dive uses,
  // so the two surfaces never drift. Assigned-only (the maps carry no empty-slot
  // inventory); an unfilled craft slot renders nothing extra.
  const craftArr = (maps && idx != null && idx >= 0) ? craftSlotChips(v, idx, maps) : [];
  const crafts = craftArr.length
    ? `<div class="pd-slots"><span class="pd-slabel">Craft</span>${craftArr.join("")}</div>` : "";

  if (!stats && !augs && !crafts) return "";
  return `<div class="pd-rbody">${stats}${augs}${crafts}</div>`;
}

// Front-facing armored-adventurer silhouette (retired from the results layout;
// kept for reference — the equipped list above replaced it per user preference).
function paperdollFigure() {
  return `<div class="pd-figure" aria-hidden="true"><svg viewBox="0 0 120 300" preserveAspectRatio="xMidYMid meet">
    <path d="M60 34 C40 46 39 210 46 250 L60 238 L74 250 C81 210 80 46 60 34 Z" fill="var(--panel-2)" stroke="var(--border-2)"/>
    <circle cx="60" cy="26" r="15" fill="var(--elev)" stroke="var(--border-2)"/>
    <path d="M46 25 a14 14 0 0 1 28 0 l-4 2 a10 10 0 0 0 -20 0 Z" fill="var(--border-2)"/>
    <path d="M45 48 L75 48 L82 132 L38 132 Z" fill="var(--elev)" stroke="var(--border-2)"/>
    <rect x="40" y="130" width="40" height="8" rx="2" fill="var(--set)" opacity="0.5"/>
    <path d="M42 140 L58 140 L54 250 L46 250 Z" fill="var(--panel-2)" stroke="var(--border)"/>
    <path d="M62 140 L78 140 L74 250 L66 250 Z" fill="var(--panel-2)" stroke="var(--border)"/>
    <path d="M45 52 L30 66 L24 128 L34 130 L44 74 Z" fill="var(--elev)" stroke="var(--border-2)"/>
    <path d="M75 52 L90 66 L96 128 L86 130 L76 74 Z" fill="var(--elev)" stroke="var(--border-2)"/>
    <path d="M44 250 h16 v14 h-20 z" fill="var(--border-2)"/><path d="M64 250 h16 v14 h-20 z" fill="var(--border-2)"/>
  </svg></div>`;
}

// Attribution list for one ranked target (R11, R12, R13): each contributor shows
// its bonus type, value, and the equipped slot(s) driving it — and for a set, the
// slots that yield it (swap-impact). Replaces the old progress bars: the value is
// stated as text, not a bar. `contribs` come from attributionByTarget.
function attributionList(contribs) {
  if (!contribs.length) return `<div class="stat-empty">no contributing gear for this target</div>`;
  return `<ul class="attrib">${contribs.map((c) => {
    const kind = c.isSet ? "is-set" : c.sourceKind === "augment" ? "is-augment" : "";
    const where = c.isSet
      ? `<span class="attrib-set">set: ${esc(c.source)}</span>${c.slots.length ? `<span class="attrib-slots"> via ${c.slots.map(esc).join(", ")}</span>` : ""}`
      : `<span class="attrib-slots">${c.slots.length ? c.slots.map(esc).join(", ") : "—"}</span><span class="attrib-src"> · ${esc(c.source)}</span>`;
    const isBool = c.bonus_type === "boolean";   // U4: presence, not a magnitude
    return `<li class="attrib-row ${kind}">
      <span class="attrib-type">${esc(isBool ? "feature" : c.bonus_type)}</span>
      <span class="attrib-val">${isBool ? "✓" : "+" + esc(c.value)}</span>
      <span class="attrib-where">${where}</span>
    </li>`;
  }).join("")}</ul>`;
}

/** Active set bonuses with the stats they grant and the slots that yield them
 *  (R16, R12). Derives the granted affixes from the equipped members' parsed
 *  tiers and the yielding slots from set membership among the chosen items. */
function activeSetDetail(result) {
  const yields = new Map();          // set -> [slots yielding it]
  const tierAffixes = new Map();     // "set||N" -> granted affixes
  for (const c of result.chosen) {
    for (const sb of c.variant.set_bonus || []) {
      if (!sb.set) continue;
      if (!yields.has(sb.set)) yields.set(sb.set, []);
      yields.get(sb.set).push(c.slot);
    }
    for (const t of c.variant.parsed_set_bonuses || []) {
      if (t.pieces_required == null) continue;
      const k = `${t.set}||${t.pieces_required}`;
      if (!tierAffixes.has(k) && (t.affixes || []).length) tierAffixes.set(k, t.affixes);
    }
  }
  return (result.setsActive || []).map((s) => ({
    set: s.set, pieces: s.pieces_required,
    slots: yields.get(s.set) || [],
    affixes: tierAffixes.get(`${s.set}||${s.pieces_required}`) || [],
  }));
}

/** The Set Bonuses tab (U8): every set complete in the build, grouped by set,
 *  with its granted affixes and the equipped pieces (item names) composing it.
 *  Near-miss / non-set items are excluded (R9). Two sources are unioned so the
 *  tab matches the U6 glow and never drops an active set: (1) static
 *  threshold-satisfied sets (highest satisfied tier + member item names); (2) any
 *  remaining `setsActive` set via the shared `activeSetDetail` expander — this
 *  recovers sets completed by runtime pieces with no static `set_bonus`
 *  (a Gem of Many Facets joker, a Vecna Lost Purpose awaken). */
function satisfiedSetDetail(build) {
  const counts = new Map();    // set -> equipped piece count
  const members = new Map();   // set -> [item names]
  const tiers = new Map();     // set -> Map(pieces_required -> granted affixes)
  for (const c of build.chosen || []) {
    for (const sb of c.variant.set_bonus || []) {
      if (!sb.set) continue;
      counts.set(sb.set, (counts.get(sb.set) || 0) + 1);
      if (!members.has(sb.set)) members.set(sb.set, []);
      members.get(sb.set).push(c.variant.variant_id);
    }
    for (const t of c.variant.parsed_set_bonuses || []) {
      if (t.pieces_required == null) continue;
      if (!tiers.has(t.set)) tiers.set(t.set, new Map());
      const byN = tiers.get(t.set);
      if (!byN.has(t.pieces_required)) byN.set(t.pieces_required, t.affixes || []);
    }
  }
  const bySet = new Map();
  for (const [set, byN] of tiers) {
    const have = counts.get(set) || 0;
    let best = null;                                  // highest tier the count satisfies
    for (const [n, affixes] of byN) if (n <= have && (best == null || n > best.pieces)) best = { pieces: n, affixes };
    if (best) bySet.set(set, { set, pieces: best.pieces, affixes: best.affixes, members: members.get(set) || [] });
  }
  for (const s of activeSetDetail(build)) {           // recover runtime-completed sets
    if (bySet.has(s.set)) continue;
    bySet.set(s.set, { set: s.set, pieces: s.pieces, affixes: s.affixes, members: members.get(s.set) || [] });
  }
  return [...bySet.values()];
}

// The "why this?" line for an equipped item (R8, R9): the ranked target(s) it
// wins and by how much. Empty-state (a filler/tie-break pick that wins nothing)
// reads as such rather than blank. `item` is { slot, variant_id }.
function whyThisLine(result, item, attr) {
  const wins = whyThis(result, item, attr);
  if (!wins.length) return `<div class="pd-why muted">included to complete the loadout</div>`;
  const txt = wins.slice(0, 3).map((w) => w.boolean
    ? `✓ ${esc(w.stat)}`                                   // U4: presence, not "+1"
    : `${esc(w.stat)} +${esc(w.value)}${w.viaSet ? " (set)" : ""}`).join(", ");
  return `<div class="pd-why" title="why this item is best-in-slot here">wins ${txt}</div>`;
}

// Count-up motion (KTD4), robust to motion NOT running (AE4). The final value is
// written into the DOM first and stays there unless an animation frame actually
// fires — so if requestAnimationFrame is throttled/absent, or reduced-motion is
// set, the correct result is always readable immediately, never gated on motion.
function animateCounters(container) {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  container.querySelectorAll(".stat-value").forEach((el) => {
    const final = Number(el.getAttribute("data-final")) || 0;
    el.firstChild.textContent = String(final);              // final value in place first
    if (reduce || hidden || final <= 0 || typeof requestAnimationFrame !== "function") return;
    const dur = 520;
    let started = null, done = false;
    const settle = () => { if (!done) { done = true; el.firstChild.textContent = String(final); } };
    const tick = (now) => {
      if (done) return;
      if (started === null) started = now;                  // anchor on the FIRST real frame
      const p = Math.min(1, (now - started) / dur);
      el.firstChild.textContent = String(Math.round(final * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
      else settle();
    };
    requestAnimationFrame(tick);                            // only dips low once a frame runs
    // Safety net: rAF pauses entirely in a backgrounded/throttled tab and can fire
    // once then stall, freezing the counter at a wrong intermediate value. setTimeout
    // still fires there, so force the final value shortly after the animation window.
    setTimeout(settle, dur + 400);
  });
}

// U5/R6 — the box was checked but no eligible Artifact could be placed (empty
// seed, or the only Artifact's slot locked/pinned away). A distinct callout by
// the loadout — NOT buried in the coverage scope-note — because with the seed
// shipping empty every opt-in hits this path. Pure (query + chosen), exported.
function artifactNotice(result, query) {
  const missing = !!(query && query.includeArtifact && result && result.chosen
    && !result.chosen.some((c) => c.variant && c.variant.artifact));
  return missing
    ? `<div class="artifact-notice" role="status">No Artifact could be included — none is flagged in the current data.</div>`
    : "";
}

function renderResults(container, { model, result, query, dataset, highs, onAfterRender }) {
  if (result.status !== "optimal") {
    container.innerHTML = `<div class="empty">No set satisfies these constraints${result.reason ? ` — ${esc(result.reason)}` : ""}.<br><span class="muted">Loosen the ML cap, armor/class filters, or targets.</span></div>`;
    return;
  }

  const optimum = result;
  const cs = optimum.computeScale || { variants: 0, crafts: 0, stages: 0 };
  // The verdict is a tap/keyboard-openable explanation (R7): native <details>, so
  // it works on touch (no hover) and via keyboard. Explains MILP plainly + links
  // an academic source for readers who want the real math. Always the OPTIMUM.
  const banner = `
    <div class="solve-banner">
      <details class="solve-explain">
        <summary class="solve-verdict"><span class="dot"></span><span class="label">OPTIMAL</span><span class="sub">provably the best build, not a guess</span><span class="explain-hint" aria-hidden="true">ⓘ</span></summary>
        <div class="solve-explain-body">
          <p><strong>What "MILP" means.</strong> It stands for Mixed-Integer Linear Program. In plain terms: the optimizer turns your whole loadout into a math problem where equipping each item is a yes-or-no switch, then finds the one combination of switches that scores highest on your ranked priorities. It does not sample or guess. It effectively checks every legal combination and proves that none does better, so the result is <strong>provably optimal</strong>.</p>
          <p>A low-level item can still win a slot when its bonus genuinely beats every higher-level option for something you ranked.</p>
          <p class="learn-more">Curious about the real math? See UC Berkeley's free <a href="https://people.eecs.berkeley.edu/~vazirani/algorithms/chap7.pdf" target="_blank" rel="noopener">Algorithms textbook chapter on Linear Programming</a>.</p>
        </div>
      </details>
      <div class="solve-scale">
        <div class="scale-item" title="Candidate item variants the solver weighed across your slots"><span class="n">${esc(cs.variants)}</span><span class="k">gear considered</span></div>
        <div class="scale-item" title="Augment and expansion-crafting options considered"><span class="n">${esc(cs.crafts)}</span><span class="k">craft choices</span></div>
        <div class="scale-item" title="One optimization pass per ranked priority, plus a final tie-break"><span class="n">${esc(cs.stages)}</span><span class="k">priority passes</span></div>
        <div class="scale-item" title="Wall-clock solve time"><span class="n">${esc(optimum.solveMs ?? "?")}</span><span class="k">solve ms</span></div>
      </div>
    </div>`;

  container.innerHTML = `
    ${banner}
    ${artifactNotice(result, query)}
    <div class="active-build-bar" hidden>
      <span class="active-build-msg"></span>
      <button class="return-optimum" type="button">Return to optimum</button>
    </div>
    <div class="readout-analysis">
      <p class="readout-header">Your build, tab by tab — <strong>Loadout</strong> is your equipped gear; the other tabs
        break down priorities, set bonuses, and per-item detail. Use <strong>Adjust &amp; re-solve</strong> below to change
        priorities or the gear pool: each adjustment shows what you gain and what you lose, then updates the loadout here.</p>
      <div class="result-tabs" role="tablist" aria-label="Result details">
        <button class="rtab" role="tab" id="rt-loadout" aria-controls="rp-loadout" aria-selected="true" tabindex="0" type="button">Loadout</button>
        <button class="rtab" role="tab" id="rt-ranked" aria-controls="rp-ranked" aria-selected="false" tabindex="-1" type="button">Ranked Priorities</button>
        <button class="rtab" role="tab" id="rt-sets" aria-controls="rp-sets" aria-selected="false" tabindex="-1" type="button">Set Bonuses</button>
        <button class="rtab" role="tab" id="rt-deep" aria-controls="rp-deep" aria-selected="false" tabindex="-1" type="button">Loadout Deep Dive</button>
        <button class="rtab" role="tab" id="rt-alts" aria-controls="rp-alts" aria-selected="false" tabindex="-1" type="button">Alternatives</button>
        <button class="rtab" role="tab" id="rt-share" aria-controls="rp-share" aria-selected="false" tabindex="-1" type="button">Share</button>
      </div>
      <div class="wz-adjust-slot" id="wz-adjust-slot"></div>
      <section id="rp-loadout" class="rpanel" role="tabpanel" aria-labelledby="rt-loadout" tabindex="0">
        <div class="readout-doll"><div class="pd-equipped" id="rp-doll"></div><div id="rp-weapons"></div></div>
      </section>
      <section id="rp-ranked" class="rpanel" role="tabpanel" aria-labelledby="rt-ranked" tabindex="0" hidden><div class="targets" id="rp-cards"></div></section>
      <section id="rp-sets" class="rpanel" role="tabpanel" aria-labelledby="rt-sets" tabindex="0" hidden><div id="rp-setspanel"></div></section>
      <section id="rp-deep" class="rpanel" role="tabpanel" aria-labelledby="rt-deep" tabindex="0" hidden><div id="rp-deeppanel"></div></section>
      <section id="rp-alts" class="rpanel" role="tabpanel" aria-labelledby="rt-alts" tabindex="0" hidden><div id="rp-altspanel"></div></section>
      <section id="rp-share" class="rpanel" role="tabpanel" aria-labelledby="rt-share" tabindex="0" hidden><div id="rp-sharepanel"></div></section>
    </div>
    <div class="sr-only" aria-live="polite" id="rp-live"></div>`;

  const q = (s) => container.querySelector(s);
  // Render the paperdoll + Ranked/Sets/Deep-Dive panels from ANY build (the optimum
  // or a selected alternative) — the alternative's solution has the same shape.
  function renderBuild(build) {
    const v = buildViews(build, model, query);
    q("#rp-doll").innerHTML = v.paperdoll;
    q("#rp-weapons").innerHTML = v.weapons;
    q("#rp-cards").innerHTML = v.cards;
    q("#rp-setspanel").innerHTML = v.setsPanel;
    q("#rp-deeppanel").innerHTML = v.deepDive;
    animateCounters(container);
  }
  function setActive(build, isAlt, label) {
    renderBuild(build);
    q(".active-build-bar").hidden = !isAlt;
    if (isAlt) q(".active-build-msg").textContent = `Viewing alternative — ${label}`;
    // Returning to the optimum: clear any card's selected state so the listbox does not
    // report a selection while the optimum (not that alternative) is shown.
    if (!isAlt) {
      q("#rp-altspanel").querySelectorAll('.alt-card[aria-selected="true"]')
        .forEach((c) => c.setAttribute("aria-selected", "false"));
    }
    q("#rp-live").textContent = isAlt ? `Now viewing alternative: ${label}` : "Now viewing the optimal build";
  }
  q(".return-optimum").addEventListener("click", () => setActive(optimum, false));
  renderBuild(optimum);

  // Alternatives tab (U4): generate on first open so the base solve stays instant (KTD2).
  const altState = { list: null, computing: false };
  function ensureAlternatives() {
    const panel = q("#rp-altspanel");
    if (altState.list !== null || altState.computing) return;
    if (typeof generateAlternatives !== "function" || !highs) {
      panel.innerHTML = `<p class="dd-none muted">Alternatives are unavailable (the solver did not load).</p>`;
      altState.list = []; return;
    }
    altState.computing = true;
    panel.innerHTML = `<p class="dd-none muted">Computing alternatives…</p>`;
    q("#rp-live").textContent = "Computing alternative loadouts…";
    // Defer so the "computing" state paints before the synchronous re-solves run.
    setTimeout(() => {
      try {
        const raw = generateAlternatives(optimum, model, highs);
        const analyzed = raw.map((c) => analyzeAlternative(optimum, c, query));
        const ranked = rankAlternatives(analyzed, optimum, {});
        altState.list = ranked;
        panel.innerHTML = ranked.length ? renderAltCards(ranked)
          : `<p class="dd-none muted">No worthwhile trade-off build was found — the optimum is hard to beat for these priorities.</p>`;
        if (ranked.length) wireAltCards(panel, ranked, setActive);
        q("#rp-live").textContent = ranked.length
          ? `${ranked.length} alternative loadout${ranked.length === 1 ? "" : "s"} found.`
          : "No worthwhile alternative loadouts were found.";
      } catch (e) {
        console.error(e);
        panel.innerHTML = `<p class="dd-none muted">Could not compute alternatives.</p><button class="q-edit alt-retry" type="button">Retry</button>`;
        q("#rp-live").textContent = "Could not compute alternative loadouts.";
        const retry = panel.querySelector(".alt-retry");
        if (retry) retry.addEventListener("click", () => { altState.list = null; ensureAlternatives(); });
      }
      altState.computing = false;
    }, 20);
  }
  wireResultTabs(container, (id) => { if (id === "rp-alts") ensureAlternatives(); });

  // KTD3 — the Adjust (U3) and Share (U5) panels live inside this container and so
  // are destroyed on every renderResults call (solve, load, per-slot constraint
  // change). The wizard supplies a post-render callback to (re)populate + (re)wire
  // its slots — direct drag/click handlers that delegation can't restore — on each
  // render. Fires last, after the panels + tabs exist.
  if (typeof onAfterRender === "function") onAfterRender(container);
}

// Compute the per-build view HTML (paperdoll, weapon row, ranked cards, set panel,
// deep dive) for ANY result-shaped build — the optimum or a selected alternative,
// which carry the same fields (chosen, effective, breakdown, capped, setsActive,
// the *Placed lists). Reused by renderBuild for select-to-inspect (U5).
function buildViews(build, model, query) {
  const augAssign = assignAugments(build.chosen, build.augmentsPlaced);
  const dinoAssign = assignDinoInserts(build.chosen, build.dinoPlaced);
  const byItemMap = (list) => {
    const m = new Map();
    for (const n of list || []) { if (!m.has(n.item)) m.set(n.item, []); m.get(n.item).push(n); }
    return m;
  };
  const jokerByHost = new Map();
  for (const j of build.jokerPlaced || []) {
    if (!jokerByHost.has(j.host)) jokerByHost.set(j.host, []);
    jokerByHost.get(j.host).push(j);
  }
  // Set-membership picks (Vecna Lost Purpose or Dinosaur Bone Set Bonus),
  // keyed by host item like jokers.
  const membershipByHost = new Map();
  for (const m of build.membershipPlaced || []) {
    if (!membershipByHost.has(m.host)) membershipByHost.set(m.host, []);
    membershipByHost.get(m.host).push(m);
  }
  const maps = {
    augAssign, dinoAssign,
    ncByItem: byItemMap(build.ncPlaced), rollByItem: byItemMap(build.rollPlaced),
    vikByItem: byItemMap(build.vikPlaced), sealByItem: byItemMap(build.sealPlaced),
    tfByItem: byItemMap(build.tfPlaced), gsByItem: byItemMap(build.gsPlaced), jokerByHost,
    membershipByHost,
  };
  const picksBySlot = new Map();
  build.chosen.forEach((c, idx) => {
    if (!picksBySlot.has(c.slot)) picksBySlot.set(c.slot, []);
    picksBySlot.get(c.slot).push({ variant: c.variant, idx });
  });

  const attr = attributionByTarget(build, augAssign);
  const cards = query.targets.map((stat, i) => {
    const total = build.effective[stat] ?? 0;
    const contribs = attr[stat] || [];
    const cap = build.capped ? build.capped[stat] : null;
    const rawSum = contribs.reduce((s, p) => s + p.value, 0);
    const capNote = (cap != null && rawSum > total)
      ? `<span class="stat-cap" title="raw ${esc(rawSum)} exceeds the cap for this stat">capped at ${esc(total)} · raw ${esc(rawSum)}</span>` : "";
    return `<div class="stat-card">
      <div class="stat-head"><span class="stat-rank">${i + 1}</span><span class="stat-name">${esc(stat)}</span></div>
      <div class="stat-value" data-final="${esc(total)}">${esc(total)}</div>
      ${capNote}
      ${attributionList(contribs)}
    </div>`;
  }).join("");

  // Equipped list (prototype layout): a plain stacked list of every slot the
  // model considered, occupied or empty — no humanoid figure, full item names
  // (no truncation). Weapons are folded into the same list in slot order.
  const satisfied = satisfiedSets(build.chosen, build.setsActive);   // U6: glow only completed-set pieces
  // U2 — resolve an augment's affixes by variant_id (the placed meta carries the
  // id + color but no affixes); model.augments holds the full augment records.
  const augById = new Map((model.augments || []).map((a) => [a.variant_id, a]));
  const rows = [];
  for (const slot of model.worn) {
    const picks = picksBySlot.get(slot.slot) || [];
    const cardinality = slot.cardinality || 1;
    for (let r = 0; r < cardinality; r++) {
      rows.push(equippedRow(slot.slot, picks[r] || null, query.slotConstraints, satisfied, maps, augById));
    }
  }
  const weapons = ""; // weapons are included in the equipped list above

  // Set Bonuses tab (U8): only satisfied sets, each showing its granted affixes
  // and the equipped pieces composing it (grouped by set). No near-miss hints,
  // no non-set items.
  const activeSets = satisfiedSetDetail(build).map((s) => {
    const grants = s.affixes.length ? esc(s.affixes.map(affixLabel).join(", ")) : "bonus active";
    const pieces = s.members.length ? `<div class="set-via">pieces: ${esc(s.members.join(", "))}</div>` : "";
    return `<li class="set-card"><strong>${esc(s.set)}</strong> <span class="meta">${esc(s.pieces)} pieces</span><div class="set-grants">${grants}</div>${pieces}</li>`;
  }).join("");
  const setsPanel = activeSets
    ? `<ul class="sets">${activeSets}</ul>`
    : `<p class="dd-none muted">No set bonuses are active for this build.</p>`;

  return { paperdoll: `<div class="pd-list">${rows.join("")}</div>`, weapons, cards, setsPanel, deepDive: loadoutDeepDive(build, query, maps, attr) };
}

// Alternative cards (U4): compact trade-off summary + gain tags, as a single-select
// listbox (R10, card a11y).
function renderAltCards(ranked) {
  return `<ul class="alt-list" role="listbox" aria-label="Alternative loadouts">${ranked.map((a, i) => `
    <li class="alt-card" role="option" id="alt-opt-${i}" aria-selected="false" tabindex="${i === 0 ? 0 : -1}" data-idx="${i}">
      <div class="alt-tags">${a.tags.map((t) => `<span class="alt-tag">${esc(t)}</span>`).join("")}</div>
      <div class="alt-gain">${esc(a.gainText)}</div>
      ${altGrantsLine(a)}
      <div class="alt-cost">${esc(a.costText)}</div>
    </li>`).join("")}</ul>`;
}

// U7: name the concrete bonuses an alternative adds. For every set the candidate
// newly activates, expand its granted affixes via the same activeSetDetail
// expander the build sheet uses (dedicated line so multi-affix grants read
// consistently). Non-set gain families already name their delta in gainText.
function altGrantsLine(a) {
  if (!a.activatedSets || !a.activatedSets.length || !a.sol) return "";
  const detail = activeSetDetail(a.sol);
  const parts = (a.activatedSets || []).map((setName) => {
    const d = detail.find((s) => s.set === setName);
    return d && d.affixes.length ? `${setName}: ${d.affixes.map(affixLabel).join(", ")}` : null;
  }).filter(Boolean);
  return parts.length ? `<div class="alt-grants">grants ${esc(parts.join("; "))}</div>` : "";
}

// Wire the alternative cards as a keyboard-operable listbox (U5): arrows rove focus,
// Enter/Space or click selects, selection loads the build into the shared surfaces.
function wireAltCards(panel, ranked, setActive) {
  const cards = [...panel.querySelectorAll('[role="option"]')];
  const rove = (idx) => cards.forEach((c, i) => { c.tabIndex = i === idx ? 0 : -1; if (i === idx) c.focus(); });
  const select = (idx) => {
    cards.forEach((c, i) => c.setAttribute("aria-selected", i === idx ? "true" : "false"));
    rove(idx);
    setActive(ranked[idx].sol, true, ranked[idx].gainText);
  };
  panel.addEventListener("click", (e) => { const c = e.target.closest('[role="option"]'); if (c) select(+c.dataset.idx); });
  panel.addEventListener("keydown", (e) => {
    const focused = cards.findIndex((c) => c === document.activeElement);
    const base = focused >= 0 ? focused : 0;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(base); return; }
    let j = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") j = (base + 1) % cards.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") j = (base - 1 + cards.length) % cards.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = cards.length - 1;
    if (j != null) { e.preventDefault(); rove(j); }
  });
}

// Wire the result sub-tabs (Ranked / Sets / Deep Dive). Re-run on every render.
function wireResultTabs(container, onShow) {
  const tablist = container.querySelector(".result-tabs");
  if (!tablist) return;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const show = (id, focus) => {
    tabs.forEach((t) => {
      const on = t.getAttribute("aria-controls") === id;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
      const p = container.querySelector("#" + t.getAttribute("aria-controls"));
      if (p) p.hidden = !on;
    });
    if (typeof onShow === "function") onShow(id);
  };
  tablist.addEventListener("click", (e) => {
    const t = e.target.closest('[role="tab"]');
    if (t) show(t.getAttribute("aria-controls"), false);
  });
  tablist.addEventListener("keydown", (e) => {
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    let j = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = tabs.length - 1;
    if (j != null) { e.preventDefault(); show(tabs[j].getAttribute("aria-controls"), true); }
  });
  // Enforce the initial active panel deterministically (Ranked Priorities first).
  show(tabs[0].getAttribute("aria-controls"), false);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderResults, buildViews, renderAltCards, affixLabel, assignAugments, assignDinoInserts, satisfiedSets, slotSetNames, satisfiedSetDetail, attributionByTarget, whyThis, whyThisLine, activeSetDetail, attributionList, coverageNote, slotPosition, paperdollSlot, equippedRow, equippedBody, artifactNotice, craftChips, craftSlotChips, loadoutDeepDive, esc, safeUrl };
}
