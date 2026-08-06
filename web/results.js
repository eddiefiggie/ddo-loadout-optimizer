// U8 — render a solved loadout as a full build sheet. Display-only; the
// optimization happens in the solver (U1/U3/U5). Set bonuses and augments are
// now optimized and prescribed here; crafting/upgrade paths are a pending
// follow-up, surfaced honestly in the coverage disclosure.

// The shared content projection (loaded before results.js in the browser;
// require()'d in Node tests). The pure reconstruction primitives — affix/augment/
// dino/attribution/set logic — live there as ONE definition (KTD2), bound here so
// the live views and the exports can never drift. Their doc comments live in
// projection.js.
const Proj = (typeof Projection !== "undefined") ? Projection
  : (typeof require !== "undefined" ? require("./projection.js") : null);
const affixLabel = Proj.affixLabel;
const assignAugments = Proj.assignAugments;
const assignDinoInserts = Proj.assignDinoInserts;
const attributionByTarget = Proj.attributionByTarget;
const whyThis = Proj.whyThis;
const satisfiedSets = Proj.satisfiedSets;
const suppressedHostIds = Proj.suppressedHostIds;
const slotSetNames = Proj.slotSetNames;
const activeSetDetail = Proj.activeSetDetail;
const satisfiedSetDetail = Proj.satisfiedSetDetail;

// Item-level ML read native-first (`ml`), falling back to the legacy `minimum_level`
// alias for a pre-overhaul persisted item (U5).
// `var` (not `const`): itemMl is declared in both results.js and browse.js, which
// share one global scope as plain browser scripts; `var` tolerates the redeclaration
// while each file keeps its own copy for node's module-scoped `require`.
var itemMl = (v) => (v && v.ml != null) ? v.ml : (v && v.minimum_level);

// Standard fillable augment-slot colors — a generic augment can go here, so an
// open one is a realizable upgrade. Named crafting slots (Lamordia, celestial)
// need specific augments and are shown as craft slots, not flagged as unused.
const STD_AUG_COLORS = new Set(["blue", "red", "yellow", "green", "orange", "purple", "colorless", "clear"]);

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

// U2/U4 — the shared pin-normalize path (single variant_id or Ring variant_ids
// list). Global from model.js in the browser; require()'d in Node tests. Lets a
// per-row Deep-Dive badge test its OWN variant against the slot's pin(s).
var _pinnedVariantIds = (typeof pinnedVariantIds !== "undefined") ? pinnedVariantIds
  // eslint-disable-next-line global-require
  : require("./model.js").pinnedVariantIds;

// The applied craft-upgrade chips for one item — Dino inserts, Nearly Completed,
// choice slots, Viktranium, seals, Thunder-Forged, Green Steel — keyed by the
// chosen index (dino) or variant_id (the rest). Assigned crafts only (the maps
// carry no empty-slot inventory). Shared by the Loadout Deep Dive (craftChips)
// and the equipped-block detail (equippedBody, U2) so these families never drift.
// Each family's label text comes from Proj.craftLabel (the single label source,
// KTD6); the whole label is wrapped in one esc() — byte-identical to the prior
// inline templates because esc() distributes over string concatenation.
// NOT included: the augment chips and the joker/membership (wildcard/set) chips —
// craftChips keeps those, and the equipped block surfaces set state via its row
// glow/setLine instead, so a joker/membership rendering change only hits the Deep Dive.
function craftSlotChips(v, idx, maps) {
  const dinos = (maps.dinoAssign.byIndex.get(idx) || []).map((d) => `<span class="chip dino" title="Isle of Dread insert">${esc(Proj.craftLabel(d, "dino"))}</span>`);
  const ncs = (maps.ncByItem.get(v.variant_id) || []).map((n) => `<span class="chip nc" title="Terror of Demogorgon — Nearly Completed">${esc(Proj.craftLabel(n, "nc"))}</span>`);
  const rolls = (maps.rollByItem.get(v.variant_id) || []).map((r) => `<span class="chip roll" title="choice slot, best option selected">${esc(Proj.craftLabel(r, "roll"))}</span>`);
  const viks = (maps.vikByItem.get(v.variant_id) || []).map((n) => `<span class="chip lamordia" title="The Chill of Ravenloft — Viktranium Experiment crafting">${esc(Proj.craftLabel(n, "vik"))}</span>`);
  const seals = (maps.sealByItem.get(v.variant_id) || []).map((n) => `<span class="chip seal" title="unseal one effect at the crafting table">${esc(Proj.craftLabel(n, "seal"))}</span>`);
  const tfs = ((maps.tfByItem && maps.tfByItem.get(v.variant_id)) || []).map((n) => `<span class="chip thunderforged" title="Legendary Thunder-Forged tier upgrade">${esc(Proj.craftLabel(n, "tf"))}</span>`);
  const gss = ((maps.gsByItem && maps.gsByItem.get(v.variant_id)) || []).map((n) => `<span class="chip greensteel" title="Legendary Green Steel craft">${esc(Proj.craftLabel(n, "gs"))}</span>`);
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
    const text = Proj.craftLabel(m, "membership");
    const title = isVecna ? `awaken this set at the ${esc(m.station || "Cannith Repurposing Station")}`
      : `slot a Dinosaur Bone Set Bonus augment at ${esc(m.station || "Dinosaur Bone crafting")}`;
    return `<span class="${cls}" title="${title}">${esc(text)}${m.station ? ` <span class="muted">(${esc(m.station)})</span>` : ""}</span>`;
  });
  // Set-Augment chips (U7): a solver-placed Set Augment attributed to its
  // solver-DECIDED host (KTD-6 — keyed by setAugmentsPlaced[].host, never a greedy
  // reconstruction). The label comes from the single source (Proj.craftLabel), so it
  // matches every export byte-for-byte, including the inline suppression note. Only
  // the first copy on a host carries the suppression note (a host suppresses its own
  // set once).
  const setAugs = ((maps.setAugByHost && maps.setAugByHost.get(v.variant_id)) || []).map((s, i) => {
    const suppresses = i === 0 ? slotSetNames(v) : [];
    const title = suppresses.length
      ? `Set Augment — overrides this item's own set bonus (${esc(suppresses.join(", "))})`
      : "solver-placed Set Augment";
    return `<span class="chip setaug" title="${title}">${esc(Proj.craftLabel({ set: s.set, suppresses }, "augmentset"))}</span>`;
  });
  return [...augs, ...craftSlotChips(v, idx, maps), ...jokers, ...memberships, ...setAugs];
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
    <div class="pd-foot"><span class="pd-ml">ML ${esc(itemMl(v) ?? "?")}</span>${setLine}</div>
  </div>`;
}

// Loadout Deep Dive: one block per equipped item showing where it is worn, its
// affixes, its set membership, and every applied craft/augment (R5 detail moved
// off the paperdoll cell into this tab).
function loadoutDeepDive(result, query, maps, attr) {
  if (!result.chosen.length) return `<p class="dd-none muted">No items equipped for this build.</p>`;
  const suppressed = suppressedHostIds(result);                        // U7: a Set-Augment host suppresses its own set
  const satisfied = satisfiedSets(result.chosen, result.setsActive, suppressed);   // U6/U7: glow on completion, honoring suppression
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
      <div class="dd-head"><span class="dd-slot">${esc(c.slot)}</span><span class="dd-name">${esc(v.variant_id)}</span>${artifactTag}<span class="dd-ml">ML ${esc(itemMl(v) ?? "?")}</span>${wiki}</div>
      ${whyThisLine(result, { slot: c.slot, variant_id: v.variant_id }, attr)}
      ${memberSets.length ? `<div class="dd-set"><span class="setpip"></span>Part of set: ${esc(memberSets.join(", "))}${suppressed.has(v.variant_id) ? ` <span class="dd-suppressed" title="a Set Augment slotted here overrides this item's own set bonus">(suppressed by Set Augment)</span>` : ""}</div>` : ""}
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
function equippedRow(label, pick, slotConstraints, satisfied, maps, augById, ownedInfo) {
  const c = (slotConstraints || {})[label];
  const locked = c && c.type === "empty";
  const owned = ownedInfo || { mode: false, slotsCovered: new Set() };
  const v = pick ? pick.variant : null;
  const canPin = v && !locked;
  // U4/F1+F2 — per-ROW identity. A Ring slot shares the label "Ring" across both
  // rows, so pin/free must target THIS row's variant (not the whole slot) and the
  // "pinned" badge must fire only when THIS row's item is one of the slot's pins.
  const rowId = v ? (v.variant_id || v.source_item) : "";
  const rowPinned = !!(c && c.type === "pin" && rowId && _pinnedVariantIds(c).includes(rowId));
  const ctl = `<button class="pd-ctl" data-slot="${esc(label)}" title="constrain this slot" aria-label="constrain ${esc(label)}">&#8943;</button>`;
  const menu = `<div class="pd-menu" hidden>
    <button data-act="pin" data-slot="${esc(label)}" data-variant="${canPin ? esc(rowId) : ""}"${canPin ? "" : " disabled"}>Pin this item</button>
    <button data-act="empty" data-slot="${esc(label)}">Lock empty</button>
    <button data-act="free" data-slot="${esc(label)}" data-variant="${v ? esc(rowId) : ""}">Free (optimize)</button>
  </div>`;
  const badge = rowPinned ? `<span class="pd-badge pin">pinned</span>`
    : locked ? `<span class="pd-badge empty">locked empty</span>` : "";
  const memberSets = v && !locked ? slotSetNames(v) : [];                          // U6: label = membership
  const glow = !!(v && !locked) && slotSetNames(v, satisfied).length > 0;          // glow = satisfaction (via helper)
  const setLine = memberSets.length ? `<span class="pd-rset" title="part of a set bonus">${esc(memberSets.join(", "))}</span>` : "";
  const isArtifact = !!(v && !locked && v.artifact);   // U5/R5 — tag the equipped Artifact's slot
  const artifactBadge = isArtifact ? `<span class="pd-badge artifact" title="your one equipped Artifact">Artifact</span>` : "";
  const name = locked ? "locked empty" : (v ? esc(v.variant_id) : "empty");
  const nameCls = (!v || locked) ? "pd-rname muted" : "pd-rname";
  const foot = (v && !locked)
    ? `<div class="pd-rfoot"><span class="pd-rml">ML ${esc(itemMl(v) ?? "?")}</span>${setLine}</div>` : "";
  // R8/AE5/AE5a — empty-slot reason note. ONLY for an optimizer-left-empty slot,
  // never for a user-locked-empty slot (that state is shown by the "locked empty"
  // badge; a "no item improves…" note there would state a false cause). In owned
  // mode, distinguish an empty owned pool for the slot from owned-but-no-help;
  // never imply the owned pool limits crafting.
  let reasonNote = "";
  if (!v && !locked) {
    const reason = owned.mode
      ? (owned.slotsCovered.has(label)
          ? "No owned item here improves your ranked priorities."
          : "You own no item for this slot.")
      : "No item here improves your ranked priorities.";
    reasonNote = `<div class="pd-rnote muted">${esc(reason)}</div>`;
  }
  // U9/U2: per-item stats + assigned augments (with their affixes) + assigned
  // craft slots, shown uniformly on every occupied block (empty blocks stay the
  // same height via the grid stretch + the .pd-row min-height). Assignment data
  // comes from `maps` (keyed by the pick's chosen index); `augById` resolves an
  // augment's affixes by variant_id (the placed meta carries none).
  const body = (v && !locked) ? equippedBody(v, pick ? pick.idx : -1, maps, augById, owned.mode) : "";
  const rowCls = `pd-row ${(!v || locked) ? "empty" : "occupied"}${glow ? " is-set" : ""}${isArtifact ? " is-artifact" : ""}${(rowPinned || locked) ? " constrained" : ""}`;
  return `<div class="${rowCls}">
    <div class="pd-rtop"><div class="pd-rlabel">${esc(label)}</div>${ctl}</div>
    <div class="${nameCls}"${v ? ` title="${esc(v.variant_id)}"` : ""}>${name}</div>
    ${foot}${reasonNote}${body}${artifactBadge}${badge}${menu}
  </div>`;
}

// The stats / augment / craft body of an equipped block. Projects the variant's
// own affixes, then the augments actually slotted (with the affixes they add,
// resolved by variant_id via `augById`) alongside any still-open augment slots,
// and the item's assigned craft-upgrade slots (U2). `maps` (and the pick's `idx`)
// are always supplied on the render path (buildViews -> equippedRow); a maps-less
// call (only the pure test callers) simply renders no augment/craft section.
function equippedBody(v, idx, maps, augById, ownedMode) {
  const affixes = (v.affixes || []);
  const stats = affixes.length
    ? `<ul class="pd-stats">${affixes.map((a) => `<li>${esc(affixLabel(a))}</li>`).join("")}</ul>` : "";

  let augs = "";
  if (maps && maps.augAssign && idx != null && idx >= 0) {
    // Filled slots: the assigned augment + the affixes it adds (R3). Open slots:
    // still shown as a pip so an empty augment slot reads as an open upgrade (AE2).
    const placed = maps.augAssign.byIndex.get(idx) || [];
    const open = maps.augAssign.freeByIndex.get(idx) || [];
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
  }

  // Assigned craft-upgrade slots (R4) — the same shared chips the Deep Dive uses,
  // so the two surfaces never drift. Assigned-only (the maps carry no empty-slot
  // inventory); an unfilled craft slot renders nothing extra.
  const craftArr = (maps && idx != null && idx >= 0) ? craftSlotChips(v, idx, maps) : [];
  const crafts = craftArr.length
    ? `<div class="pd-slots"><span class="pd-slabel">Craft</span>${craftArr.join("")}</div>` : "";

  if (!stats && !augs && !crafts) return "";
  // R7/AE6 — in owned-inventory mode the base item is yours, but augments and
  // crafting are RECOMMENDATIONS from the full catalog, not your inventory. Mark
  // the augment/craft block so it reads as "craft/slot this", not "you own this".
  const recNote = (ownedMode && (augs || crafts))
    ? `<div class="pd-rec-note muted" title="Augments and crafting always come from the full catalog, not your imported inventory">Recommended (not owned)</div>` : "";
  return `<div class="pd-rbody">${stats}${recNote}${augs}${crafts}</div>`;
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

// plan 003 U6/KTD6 — the SAME authority the off-hand pool used, not a re-derivation
// here. If the notice recomputed "is this a declared build" from the raw flag it
// could claim an exclusion under a style where none fired (sword-and-board keeps its
// shields), and the pin flag and this notice could drift apart.
var _offHandItemsExcluded = (typeof offHandItemsExcluded !== "undefined") ? offHandItemsExcluded
  // eslint-disable-next-line global-require
  : (typeof require !== "undefined" ? require("./model.js").offHandItemsExcluded : () => false);

// U5 — honest disclosure of how the solve was bounded: the considered ML band
// (R8), any floor that could not be met (R4), and any user cap that actually held
// a stat down (R12 — "shaped by your cap"). Keeps "provably optimal" truthful by
// naming what was and wasn't solved over. Pure (query + result), exported.
//
// plan 003 U6 (R10) extends it to BOTH limits of a declared Two Weapon Fighting
// build. The exclusion is a real narrowing of the search space, and the optimizer
// scores neither the TWF penalty nor a shield's defensive worth — so a player is
// owed both facts rather than an unexplained off-hand pick.
function boundNotice(query, result) {
  const parts = [];
  const floor = query && Number(query.mlFloor);
  if (floor) parts.push(`Considered gear ML ≥ ${esc(floor)} (your floor).`);
  const per = (result && result.perTarget) || {};
  for (const f of (result && result.floorReport) || []) {
    parts.push(`Couldn't reach your floor of ${esc(f.floor)} ${esc(f.stat)} — best achievable was ${esc(f.achieved)}.`);
  }
  const caps = (query && query.targetCaps) || {};
  const held = Object.keys(caps).filter((s) => per[s] != null && per[s] >= caps[s]);
  if (held.length) parts.push(`Held at your cap: ${held.map((s) => `${esc(s)} ${esc(caps[s])}`).join(", ")}.`);
  if (_offHandItemsExcluded(query || {})) {
    // Did a pin override it? Derivable from the chosen loadout alone: an off-hand
    // item survived a build that excluded off-hand items, which only a pin allows.
    const offHand = ((result && result.chosen) || []).find((c) => c.slot === "Off Hand");
    const overridden = !!(offHand && offHand.variant && offHand.variant.category !== "weapon");
    parts.push(overridden
      ? `You declared Two Weapon Fighting, so shields, orbs, and rune arms left off-hand candidacy — your pinned ${esc(offHand.variant.source_item || offHand.variant.variant_id)} overrode that and is equipped.`
      : `You declared Two Weapon Fighting, so shields, orbs, and rune arms left off-hand candidacy — pin one to bring it back.`);
    parts.push(`The optimizer doesn't score the Two Weapon Fighting penalty (or a shield's defense), so the off-hand pick was compared on ranked-stat value alone.`);
  }
  return parts.length ? `<p class="scope-note bound-note" role="status">${parts.join(" ")}</p>` : "";
}

// U3 (plan 2026-08-05-001) — a priority NOTHING in the active pool can contribute
// to used to score zero with no explanation, which reads as the tool being broken.
// This names it and says which of the two causes applies, because they call for
// different actions: widen the pool, versus drop the priority.
//
// Deliberately NOT in coverageNote — that is dataset-scoped, takes no query or
// result, and has no render call site. This joins the artifactNotice/boundNotice
// family rendered with the loadout, and takes `model` because `result` reports only
// what the CHOSEN loadout achieved: a zero there cannot tell "nothing supplies this"
// from "higher priorities took the slots". The pool lives in `model`, which survives
// a saved-snapshot restore (persist.js drops the MILP program, not the model).
function _collectStatNames(into, affixes) {
  for (const a of affixes || []) {
    const n = a && (a.name != null ? a.name : a.stat);
    if (n) into.add(n);
  }
}

/** Every stat name any source in the ACTIVE pool can contribute. */
function poolStatNames(model) {
  const out = new Set();
  for (const slot of (model && model.worn) || []) {
    for (const v of slot.variants || []) {
      _collectStatNames(out, v.affixes);
      for (const s of v.scaling || []) if (s && s.stat) out.add(s.stat);
      for (const t of v.parsed_set_bonuses || []) _collectStatNames(out, t.affixes);
    }
  }
  const pools = [model.augments, model.dinoInserts, model.nearlyComplete, model.viktranium,
                 model.seal, model.thunderForged, model.greenSteel];
  for (const pool of pools) {
    for (const o of pool || []) {
      if (o && o.stat) out.add(o.stat);
      _collectStatNames(out, o && o.affixes);
    }
  }
  for (const defs of [model.membershipSetDefs, model.augment_set_defs]) {
    for (const def of Object.values(defs || {})) {
      for (const t of (def && def.tiers) || []) _collectStatNames(out, t.affixes);
    }
  }
  return out;
}

/** True when the whole dataset carries the stat somewhere — used only to tell the
 *  two causes apart, and only for stats already known to be pool-unreachable. */
function datasetHasStat(dataset, stat) {
  for (const v of (dataset && dataset.items) || []) {
    for (const a of v.affixes || []) if ((a.name != null ? a.name : a.stat) === stat) return true;
    for (const s of v.scaling || []) if (s && s.stat === stat) return true;
    for (const t of v.parsed_set_bonuses || []) {
      for (const a of t.affixes || []) if ((a.stat != null ? a.stat : a.name) === stat) return true;
    }
  }
  return false;
}

function zeroSourceNotice(query, result, model, dataset) {
  if (!result || result.status !== "optimal") return "";
  const targets = (query && query.targets) || (model && model.targets) || [];
  if (!targets.length || !model) return "";
  const reachable = poolStatNames(model);
  const unsourced = targets.filter((t) => !reachable.has(t));
  if (!unsourced.length) return "";
  // Two causes, two different player actions.
  const absent = [], filtered = [];
  for (const t of unsourced) (datasetHasStat(dataset, t) ? filtered : absent).push(t);
  const parts = [];
  if (absent.length) {
    parts.push(`Nothing in the current data carries ${absent.map(esc).join(", ")} — ranking it can't change your build.`);
  }
  if (filtered.length) {
    // Deliberately does NOT name a single cause. The pool the solver sees is the
    // product of the ML band, the gear pool, the character gates AND the dominance
    // pre-filter, and this function cannot tell which one removed the last source.
    // Naming "your ML band" was wrong for a verified ML-29 item well inside a cap of
    // 34 that the dominance filter had pruned. Only the owned-pool case is named,
    // because opting into it is an explicit, single, reversible choice.
    const owned = query && query.pool === "owned";
    const where = owned ? "your owned-gear pool" : "your current filters";
    parts.push(`No source of ${filtered.map(esc).join(", ")} is available in ${where} — `
      + `${owned ? "the full catalog may have one" : "widening the ML band or character filters may reach "
        + (filtered.length > 1 ? "them" : "it")}.`);
  }
  return `<p class="scope-note zero-source-note" role="status">${parts.join(" ")}</p>`;
}

function renderResults(container, { model, result, query, dataset, highs, onAfterRender }) {
  if (result.status !== "optimal") {
    // Keep the Adjust & re-solve control available on a non-optimal result — this
    // is exactly when the user needs to loosen priorities/constraints in place.
    // Emit its slot and run the post-render callback so fillAdjustSlot repopulates
    // it (fillSharePanel no-ops here — no #rp-sharepanel, nothing to share).
    container.innerHTML = `<div class="empty">No set satisfies these constraints${result.reason ? ` — ${esc(result.reason)}` : ""}.<br><span class="muted">Loosen the ML cap, armor/class filters, or targets.</span></div>
    <div class="wz-adjust-slot" id="wz-adjust-slot"></div>`;
    if (typeof onAfterRender === "function") onAfterRender(container);
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
    ${boundNotice(query, result)}
    ${zeroSourceNotice(query, result, model, dataset)}
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

  // Alternatives tab (U4): gated behind an explicit "Run analysis" button (R7) so
  // the base solve stays instant and nothing computes until asked. While it runs,
  // a panel-local .wz-ring swirly shows (R8/KTD4 — the wizard's overlay() is a
  // closure results.js can't reach). Every terminal state replaces the spinner —
  // cards, "none found", an error-with-retry, or solver-unavailable — so it is
  // never left spinning.
  const altState = { list: null, computing: false };
  const altUnavailable = () => typeof generateAlternatives !== "function" || !highs;
  // Small helper: a message + a button that (re)runs the analysis.
  function altPrompt(msg, btnLabel, cls) {
    const panel = q("#rp-altspanel");
    panel.innerHTML = `<div class="alt-intro"><p class="${cls || "muted"}">${msg}</p><button class="btn ${cls === "dd-none muted" ? "ghost" : "primary"} alt-run" type="button">${esc(btnLabel)}</button></div>`;
    const run = panel.querySelector(".alt-run");
    if (run) run.addEventListener("click", () => { altState.list = null; runAlternatives(); });
  }
  // Initial (or re-open) state: the Run-analysis button, unless already computed
  // (leave the cards/message in place) or the solver never loaded.
  function showAltIntro() {
    if (altState.list !== null || altState.computing) return;
    if (altUnavailable()) {
      q("#rp-altspanel").innerHTML = `<p class="dd-none muted">Alternatives are unavailable (the solver did not load).</p>`;
      altState.list = []; return;
    }
    altPrompt("Explore near-optimal trade-off builds — complete a different set, free a slot, or take fewer crafting steps.", "Run analysis");
  }
  function runAlternatives() {
    const panel = q("#rp-altspanel");
    if (altState.computing) return;
    altState.computing = true;
    // Panel-local swirly (KTD4), same markup as the main solve overlay.
    panel.innerHTML = `<div class="alt-computing"><div class="wz-ring"></div><p class="muted">Computing alternatives…</p></div>`;
    q("#rp-live").textContent = "Computing alternative loadouts…";
    // Defer so the spinner paints before the synchronous re-solves run.
    setTimeout(() => {
      // If a re-render (e.g. a per-slot constraint change) replaced this panel
      // while we waited, abandon: don't run the stale solve or write cards/aria
      // into the fresh closure's live region.
      if (q("#rp-altspanel") !== panel) { altState.computing = false; return; }
      try {
        const raw = generateAlternatives(optimum, model, highs);
        const analyzed = raw.map((c) => analyzeAlternative(optimum, c, query));
        const ranked = rankAlternatives(analyzed, optimum, {});
        altState.list = ranked;
        if (ranked.length) { panel.innerHTML = renderAltCards(ranked); wireAltCards(panel, ranked, setActive); }
        else altPrompt("No worthwhile trade-off build was found — the optimum is hard to beat for these priorities.", "Run again", "dd-none muted");
        q("#rp-live").textContent = ranked.length
          ? `${ranked.length} alternative loadout${ranked.length === 1 ? "" : "s"} found.`
          : "No worthwhile alternative loadouts were found.";
      } catch (e) {
        console.error(e);
        altState.list = null;   // let a retry recompute cleanly
        altPrompt("Could not compute alternatives.", "Retry", "dd-none muted");
        q("#rp-live").textContent = "Could not compute alternative loadouts.";
      }
      altState.computing = false;
    }, 20);
  }
  showAltIntro();   // pre-render the button so the tab is ready on first open
  wireResultTabs(container, () => {});

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
  // The craft-placement maps (augment/dino assignments + per-item craft groupings)
  // come from the shared projection so the Deep Dive chips and the exports read from
  // one builder (KTD6).
  const maps = Proj.buildCraftMaps(build);
  const augAssign = maps.augAssign;
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
  const satisfied = satisfiedSets(build.chosen, build.setsActive, suppressedHostIds(build));   // U6/U7: glow only completed-set pieces, honoring Set-Augment suppression
  // U2 — resolve an augment's affixes by variant_id (the placed meta carries the
  // id + color but no affixes); model.augments holds the full augment records.
  const augById = new Map((model.augments || []).map((a) => [a.variant_id, a]));
  // U6/U7 — owned-mode signal for the empty-slot note and the recommended-augment
  // marking (view layer). Plumbed on the query at solve time; falls back to
  // non-owned when absent (loaded snapshots, pure-test callers).
  const ownedInfo = { mode: !!query.ownedMode, slotsCovered: new Set(query.ownedSlotsCovered || []) };
  const rows = [];
  for (const slot of model.worn) {
    const picks = picksBySlot.get(slot.slot) || [];
    const cardinality = slot.cardinality || 1;
    for (let r = 0; r < cardinality; r++) {
      rows.push(equippedRow(slot.slot, picks[r] || null, query.slotConstraints, satisfied, maps, augById, ownedInfo));
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
  // Set-like bonuses (U8): active non-set solar/lunar-family augment bonuses that
  // occupy their own channels and compete with completing a set. A transparency
  // listing on the Set Bonuses tab — NOT a set-vs-augment comparison or near-miss.
  const setLike = (build.augmentsPlaced || [])
    .map((a) => ({ a, ls: Proj.lunarSolar(a) }))
    .filter((x) => x.ls)
    .map((x) => {
      const eff = (x.a.affixes && x.a.affixes.length) ? esc(x.a.affixes.map(affixLabel).join(", ")) : "";
      const glyph = x.ls === "Lunar" ? "🌙" : "☀️";
      return `<li class="set-card setlike"><strong>${glyph} ${esc(x.ls)}</strong> <span class="meta">${esc(x.a.variant_id)}</span>${eff ? `<div class="set-grants">${eff}</div>` : ""}</li>`;
    }).join("");

  let setsPanel = activeSets
    ? `<ul class="sets">${activeSets}</ul>`
    : `<p class="dd-none muted">No set bonuses are active for this build.</p>`;
  if (setLike) {
    setsPanel += `<h3 class="setlike-h" title="non-set bonuses that occupy their own channels">Other set-like bonuses (compete with sets)</h3><ul class="sets setlike-list">${setLike}</ul>`;
  }

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
  module.exports = { renderResults, buildViews, renderAltCards, affixLabel, assignAugments, assignDinoInserts, satisfiedSets, slotSetNames, satisfiedSetDetail, attributionByTarget, whyThis, whyThisLine, activeSetDetail, attributionList, coverageNote, slotPosition, paperdollSlot, equippedRow, equippedBody, artifactNotice, boundNotice, zeroSourceNotice, poolStatNames, craftChips, craftSlotChips, loadoutDeepDive, esc, safeUrl };
}
