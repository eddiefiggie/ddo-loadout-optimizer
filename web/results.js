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

/** Per-target contributor attribution for the achieved-priority view (R11, R12,
 *  R16). Reads the solver's already-computed breakdown (which now carries the
 *  host slot for worn + item-crafts and the yielding slots for sets, KTD6) and
 *  fills the remaining augment host slot from the augment reconstruction. Returns
 *  { stat: [{ bonus_type, value, source, sourceKind, slots:[...], isSet }], ... },
 *  highest-value first — presentation only, no solve. */
function attributionByTarget(result) {
  const breakdown = result.breakdown || {};
  // augment variant_id -> host slot, from the same reconstruction the paperdoll uses
  const augAssign = assignAugments(result.chosen, result.augmentsPlaced);
  const augSlot = new Map();
  for (const [idx, augs] of augAssign.byIndex) {
    const slot = result.chosen[idx] && result.chosen[idx].slot;
    for (const a of augs) augSlot.set(a.variant_id, slot);
  }
  const out = {};
  for (const stat of Object.keys(breakdown)) {
    out[stat] = breakdown[stat].map((p) => {
      let slots = [];
      if (p.setYieldingSlots && p.setYieldingSlots.length) slots = p.setYieldingSlots.slice();
      else if (p.slot) slots = [p.slot];
      else if (p.sourceKind === "augment" && augSlot.has(p.source)) slots = [augSlot.get(p.source)];
      return {
        bonus_type: p.bonus_type, value: p.value, source: p.source,
        sourceKind: p.sourceKind, slots, isSet: p.sourceKind === "set",
      };
    });
  }
  return out;
}

/** Which ranked targets a specific equipped item wins, and by how much (R8, R9)
 *  — the justification for a pick, especially a surprising low-ML one. `item` is
 *  { slot, variant_id }. Worn contributions match on variant_id (so the two rings
 *  stay distinct); set and craft contributions match on the host slot. Returns
 *  [{ stat, value, viaSet }], highest-value first; empty when the item wins no
 *  ranked target (a filler/tie-break pick). */
function whyThis(result, item) {
  const attr = attributionByTarget(result);
  const wins = [];
  for (const stat of Object.keys(attr)) {
    let val = 0, viaSet = false;
    for (const p of attr[stat]) {
      const mine = p.sourceKind === "worn"
        ? p.source === item.variant_id
        : (p.slots || []).includes(item.slot);
      if (mine) { val += p.value; if (p.isSet) viaSet = true; }
    }
    if (val > 0) wins.push({ stat, value: val, viaSet });
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
  const jokers = (maps.jokerByHost && maps.jokerByHost.get(v.variant_id) || [])
    .map((j) => `<span class="chip joker" title="wildcard set piece — assigned to the set it best completes">Wildcard set: ${esc(j.set)}</span>`).join(" ");
  const link = v.wiki_url ? `<a href="${safeUrl(v.wiki_url)}" target="_blank" rel="noopener">wiki ↗</a>` : "";
  const chips = [contrib, augs, dinos, ncs, rolls, viks, seals, jokers].filter(Boolean).join(" ");
  return `<div>${chips || '<span class="muted">— no target-relevant affixes —</span>'}</div>${link ? `<div class="pd-craftline">${link}</div>` : ""}`;
}

// The set(s) an equipped piece belongs to, stated inline on its slot (R15).
function slotSetNames(v) {
  return [...new Set((v.set_bonus || []).map((s) => s.set).filter(Boolean))];
}

// One paperdoll slot cell. `pick` is {variant, idx} or null for an empty slot.
// `label` is the displayed slot name (lets the weapon cell read "Off Hand" when
// empty but "Rune Arm" when the solver equips one — KTD10). `extra` is optional
// trailing markup inside the summary (e.g. the per-item "why this?" affordance).
function paperdollSlot(label, pos, pick, query, maps, extra) {
  if (!pick) {
    return `<div class="pd-slot empty pos-${pos}"><div class="pd-label">${esc(label)}</div><div class="pd-item"><span class="muted">— empty —</span></div></div>`;
  }
  const v = pick.variant;
  const sets = slotSetNames(v);
  const setTag = sets.length
    ? `<div class="pd-set" title="set member">${sets.map((s) => `<span class="setpip"></span>${esc(s)}`).join(" · ")}</div>` : "";
  return `<details class="pd-slot occupied pos-${pos}">
    <summary>
      <div class="pd-label">${esc(label)}</div>
      <div class="pd-item"><span>${esc(v.variant_id)}</span><span class="ml">ML ${esc(v.minimum_level ?? "—")}</span></div>
      ${setTag}
      ${extra || ""}
    </summary>
    <div class="pd-detail">${slotDetailChips(v, pick.idx, query, maps)}</div>
  </details>`;
}

// Front-facing armored-adventurer silhouette for the paperdoll centre (decorative).
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
    return `<li class="attrib-row ${kind}">
      <span class="attrib-type">${esc(c.bonus_type)}</span>
      <span class="attrib-val">+${esc(c.value)}</span>
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

// The "why this?" line for an equipped item (R8, R9): the ranked target(s) it
// wins and by how much. Empty-state (a filler/tie-break pick that wins nothing)
// reads as such rather than blank. `item` is { slot, variant_id }.
function whyThisLine(result, item) {
  const wins = whyThis(result, item);
  if (!wins.length) return `<div class="pd-why muted">included to complete the loadout</div>`;
  const txt = wins.slice(0, 3).map((w) => `${esc(w.stat)} +${esc(w.value)}${w.viaSet ? " (set)" : ""}`).join(", ");
  return `<div class="pd-why" title="why this item is best-in-slot here">wins ${txt}</div>`;
}

// The expandable proof panel (R10): plain-language method + the ranked-priority
// order the solve optimized + a per-target contribution breakdown. `attr` is the
// attributionByTarget map, reused so the breakdown matches the achieved readout.
function proofPanel(result, query, attr) {
  const cs = result.computeScale || {};
  const ms = result.solveMs;
  const order = query.targets.map((stat, i) => {
    const v = (result.perTarget && result.perTarget[stat] != null) ? result.perTarget[stat] : (result.effective[stat] ?? 0);
    return `<li><span class="proof-rank">${i + 1}</span><span class="proof-stat">${esc(stat)}</span><span class="proof-val">${esc(v)}</span></li>`;
  }).join("");
  const breakdown = query.targets.map((stat) => `
    <div class="proof-target">
      <div class="proof-target-head">${esc(stat)} = ${esc(result.effective[stat] ?? 0)}</div>
      ${attributionList(attr[stat] || [])}
    </div>`).join("");
  return `<details class="proof-panel" id="proof-panel">
    <summary>How do we know this is optimal?</summary>
    <div class="proof-body">
      <p class="proof-method">This isn't a guess. The optimizer models your gear as an <strong>exact integer program</strong> and effectively checks <strong>every legal combination</strong>${cs.variants ? ` of ${esc(cs.variants)} candidate items` : ""}, then returns the loadout that is <strong>provably the best</strong> for your ranked priorities${ms != null ? `, solved in ${esc(ms)} ms` : ""}. <em>MILP</em> is the method — a mixed-integer linear program; <em>provable</em> means no other legal loadout scores better on these priorities. A low-level item can still win a slot when its bonus genuinely beats every higher-level option for a target you ranked.</p>
      <div class="proof-section"><h4>Your priorities, in the order they were maximized</h4><ol class="proof-order">${order}</ol></div>
      <div class="proof-section"><h4>What builds each value</h4>${breakdown}</div>
    </div>
  </details>`;
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
  const jokerByHost = new Map();  // wildcard picks are keyed by host (the Gem's variant_id)
  for (const j of result.jokerPlaced || []) {
    if (!jokerByHost.has(j.host)) jokerByHost.set(j.host, []);
    jokerByHost.get(j.host).push(j);
  }
  const maps = {
    augAssign, dinoAssign,
    ncByItem: byItemMap(result.ncPlaced), rollByItem: byItemMap(result.rollPlaced),
    vikByItem: byItemMap(result.vikPlaced), sealByItem: byItemMap(result.sealPlaced),
    jokerByHost,
  };

  // group equipped picks by slot (preserving the flat index augment assignment used)
  const picksBySlot = new Map();
  result.chosen.forEach((c, idx) => {
    if (!picksBySlot.has(c.slot)) picksBySlot.set(c.slot, []);
    picksBySlot.get(c.slot).push({ variant: c.variant, idx });
  });

  // --- hero: ranked-target readout (R1, R2, R3, R7) ---
  const cs = result.computeScale || { variants: 0, crafts: 0, stages: 0 };
  // The verdict is a tap/keyboard-openable explanation (R7) — native <details>,
  // so it works on touch (no hover) and via keyboard, not a hover-only tooltip.
  const banner = `
    <div class="solve-banner">
      <details class="solve-explain">
        <summary class="solve-verdict"><span class="dot"></span><span class="label">OPTIMAL</span><span class="sub">· exact MILP, provably best</span><span class="explain-hint" aria-hidden="true">ⓘ</span></summary>
        <div class="solve-explain-body">Every legal combination of your gear was checked as an exact math problem — this loadout is <strong>provably the best</strong> for your ranked priorities, not a guess or estimate. Open “How do we know this is optimal?” below for the full proof.</div>
      </details>
      <div class="solve-scale">
        <div class="scale-item"><span class="n">${esc(cs.variants)}</span><span class="k">variants</span></div>
        <div class="scale-item"><span class="n">${esc(cs.crafts)}</span><span class="k">craft options</span></div>
        <div class="scale-item"><span class="n">${esc(cs.stages)}</span><span class="k">solve stages</span></div>
        <div class="scale-item"><span class="n">${esc(result.solveMs ?? "—")}</span><span class="k">ms</span></div>
      </div>
    </div>`;

  const attr = attributionByTarget(result);
  const cards = query.targets.map((stat, i) => {
    const total = result.effective[stat] ?? 0;
    const contribs = attr[stat] || [];
    // A capped stat (e.g. Dodge under an armor cap) shows the CAPPED achieved
    // value as the headline, but the raw contributions can sum higher. Disclose
    // the cap so the headline and the attribution don't read as a contradiction.
    const cap = result.capped ? result.capped[stat] : null;
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

  // --- paperdoll (R4, R5, R14, R15) — symmetric figure + a 3-cell weapon row ---
  const WEAPON_POS = { mainhand: 0, offhand: 1, quiver: 2 };
  const paired = [];
  const weapon = [null, null, null]; // [Main Hand, Off Hand/Rune Arm, Quiver]
  for (const slot of model.worn) {
    const picks = picksBySlot.get(slot.slot) || [];
    const cardinality = slot.cardinality || 1;
    for (let r = 0; r < cardinality; r++) {
      const pos = slotPosition(slot.slot, r);
      const pick = picks[r] || null;
      // Adaptive weapon-middle label (KTD10): the model has no "Off Hand" slot,
      // so the Rune-Arm cell reads "Off Hand" when empty and "Rune Arm" when the
      // solver actually equips one — a chosen Rune Arm is shown, never dropped.
      const label = pos === "offhand" && !pick ? "Off Hand" : slot.slot;
      const extra = pick ? whyThisLine(result, { slot: slot.slot, variant_id: pick.variant.variant_id }) : "";
      const cell = paperdollSlot(label, pos, pick, query, maps, extra);
      if (pos in WEAPON_POS) weapon[WEAPON_POS[pos]] = cell;
      else paired.push(cell);
    }
  }
  const emptyWeapon = [["Main Hand", "mainhand"], ["Off Hand", "offhand"], ["Quiver", "quiver"]];
  const weaponCells = weapon
    .map((c, i) => c || paperdollSlot(emptyWeapon[i][0], emptyWeapon[i][1], null, query, maps))
    .join("");

  // --- sets (R6, R12, R16): state the granted stats + which slots yield them ---
  const active = activeSetDetail(result).map((s) => {
    const grants = s.affixes.length ? esc(s.affixes.map(affixLabel).join(", ")) : "bonus active";
    const via = s.slots.length ? `<div class="set-via">yielded by ${esc(s.slots.join(", "))}</div>` : "";
    return `<li class="set-card">
      <strong>${esc(s.set)}</strong> <span class="meta">— ${esc(s.pieces)} pieces</span>
      <div class="set-grants">${grants}</div>${via}</li>`;
  }).join("");
  const nearMiss = nearMissSetHints(result.chosen, query.targets).map((h) =>
    `<li class="set-card near"><strong>${esc(h.set)}</strong> <span class="meta">(${esc(h.have)}/${esc(h.need)}) — one more piece adds ${esc(h.affixes.map(affixLabel).join(", "))}</span></li>`).join("");
  const setsBlock = (active || nearMiss) ? `
    <div class="sets-section">
      <h3 class="section-title">Set bonuses</h3>
      <ul class="sets">${active}${nearMiss}</ul>
    </div>` : "";

  container.innerHTML = `
    ${banner}
    ${proofPanel(result, query, attr)}
    <div class="readout-grid">
      <div class="readout-main">
        <div class="readout-hero">
          <h3 class="section-title">Achieved — ranked priority</h3>
          <div class="targets">${cards}</div>
          ${setsBlock}
        </div>
        <div class="readout-doll">
          <h3 class="section-title">Loadout</h3>
          <div class="paperdoll">${paperdollFigure()}${paired.join("")}</div>
          <div class="pd-weapons">${weaponCells}</div>
        </div>
      </div>
    </div>
    ${coverageNote(dataset)}`;

  animateCounters(container);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderResults, affixLabel, assignAugments, assignDinoInserts, nearMissSetHints, attributionByTarget, whyThis, whyThisLine, proofPanel, activeSetDetail, attributionList, coverageNote, slotPosition, paperdollSlot, slotDetailChips, esc, safeUrl };
}
