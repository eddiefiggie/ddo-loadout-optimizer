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
// #353 — one presence predicate for the whole app, over the same bridge.
const _isPresence = Proj.isPresence;
// #346 (U5) — the ladder's vocabulary, over the same cross-runtime bridge.
const _resultsRung = (typeof craftingRung !== "undefined") ? craftingRung
  : (typeof require !== "undefined" ? require("./model.js").craftingRung : () => "everything");
const _resultsRungExcludesSolarLunar = (typeof rungExcludesSolarLunar !== "undefined") ? rungExcludesSolarLunar
  : (typeof require !== "undefined" ? require("./model.js").rungExcludesSolarLunar : () => false);
const _resultsRungExcludesAllAugments = (typeof rungExcludesAllAugments !== "undefined") ? rungExcludesAllAugments
  : (typeof require !== "undefined" ? require("./model.js").rungExcludesAllAugments : () => false);
const _resultsRungExcludesNicheCrafting = (typeof rungExcludesNicheCrafting !== "undefined") ? rungExcludesNicheCrafting
  : (typeof require !== "undefined" ? require("./model.js").rungExcludesNicheCrafting : () => false);
const _resultsIsSolarLunarColor = (typeof isSolarLunarColor !== "undefined") ? isSolarLunarColor
  : (typeof require !== "undefined" ? require("./model.js").isSolarLunarColor : (c) => c === "Sun" || c === "Moon");
// U8 (R8) — bound like every other shared primitive. `renderResults` /
// `equippedBody` / `loadoutDeepDive` run against the LIVE solve result and have no
// saved record, so they cannot reach the collapse through `Proj.project(rec)`;
// they call the same primitive that builds the content model instead.
const collapseExpansions = Proj.collapseExpansions;
const assignAugments = Proj.assignAugments;
const assignDinoInserts = Proj.assignDinoInserts;
const attributionByTarget = Proj.attributionByTarget;
const whyThis = Proj.whyThis;
var itemContributions = Proj.itemContributions;
var saturatedStats = Proj.saturatedStats;
var saturationLineFor = Proj.saturationLineFor;
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

// #91 (U5, KTD1) — the Utility tier's sentinel priority token, owned by
// model.js (single definition). Browser global; Node require — the same bridge
// solver.js uses. `var` because solver.js declares the same name in the shared
// browser scope (same value, same source — the itemMl redeclaration precedent).
var _UTILITY_SENTINEL = (typeof UTILITY_SENTINEL !== "undefined")
  ? UTILITY_SENTINEL
  : (typeof require !== "undefined" ? require("./model.js").UTILITY_SENTINEL : "Utility effects");

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
  const sealSourced = (sl.seal_types_sourced || []).join("/");
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
      `, and Sealed-in-${sealSourced || "X"} seal-slot crafting` +
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
  // #316/R8 — the set-augment placement rule, read from the actual defs via the
  // ONE shared predicate (never a hardcoded claim about our own output).
  const sar = Proj.setAugmentSlotRule && Proj.setAugmentSlotRule(dataset);
  if (sar) {
    let s = "<strong>Set Augments:</strong> " +
      (sar.anyStandardColor
        ? "copies place in any standard augment color slot (Colorless preferred on ties)"
        : "placement follows each set's verified slot matrix");
    if (!sar.moonSunIncluded) {
      s += "; Lunar/Solar (Moon/Sun) slots belong to the separate gem system and accept no standard augments (wiki-ruled)";
    }
    parts.push(s);
  }
  // #262 — items wiki-confirmed to have no live drop source are disclosed, never
  // dropped: they stay solver candidates (exclusion remains the player's move via
  // the blocklist), so the coverage claim must say what the per-item notes mean.
  // The clause embeds the ONE shared wording from projection.js.
  const nds = m.no_drop_source_coverage;
  if (nds && nds.confirmed_no_source > 0) {
    let s = `<strong>Drop sources:</strong> ${nds.confirmed_no_source} item${nds.confirmed_no_source === 1 ? "" : "s"}` +
      ` wiki-confirmed with ${Proj.NO_DROP_SOURCE_WORDING} — noted wherever each renders; excluding them stays your call via the blocklist`;
    if (nds.unverified) {
      s += ` (${nds.unverified} empty-location item${nds.unverified === 1 ? "" : "s"} await wiki triage and carry no note)`;
    }
    parts.push(s);
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
  // #371 — the per-item pools share this chip family; the tooltip names the
  // system the placement actually came from (`pool`), not the category path's.
  const ncs = (maps.ncByItem.get(v.variant_id) || []).map((n) => `<span class="chip nc" title="${esc(n.pool ? n.pool + " — per-item upgrade slot" : "Terror of Demogorgon — Nearly Completed")}">${esc(Proj.craftLabel(n, "nc"))}</span>`);
  const rolls = (maps.rollByItem.get(v.variant_id) || []).map((r) => `<span class="chip roll" title="choice slot, best option selected">${esc(Proj.craftLabel(r, "roll"))}</span>`);
  const vikPlaced = maps.vikByItem.get(v.variant_id) || [];
  const viks = vikPlaced.map((n) => `<span class="chip lamordia" title="The Chill of Ravenloft — Viktranium Experiment crafting">${esc(Proj.craftLabel(n, "vik"))}</span>`);
  // #370 — a Lamordia slot the item DECLARES but the solve left empty renders as
  // a muted chip rather than vanishing. The slot is part of the item's identity,
  // so an item that ships with four slots must never read as a three-slot item.
  // The unfilled set comes from the shared projection helper, the same one every
  // export reads.
  viks.push(...Proj.unfilledVikSlots(v, vikPlaced).map((s) =>
    `<span class="chip lamordia unfilled" title="The Chill of Ravenloft — this slot exists on the item; no option in its pool adds to your ranked stats">${esc(Proj.craftLabel(s, "vikEmpty"))}</span>`));
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
    return `<span class="chip setaug" title="${title}">${esc(Proj.craftLabel({ set: s.set, slot_color: s.slot_color, suppresses }, "augmentset"))}</span>`;
  });
  return [...augs, ...craftSlotChips(v, idx, maps), ...jokers, ...memberships, ...setAugs];
}

// U4 (R7) — the sets one equipped slot CONTRIBUTES to, as [{set, kind}], from the
// shared set-contributor resolver. A wildcard (Gem of Many Facets) or
// chosen-membership piece completes a set without carrying it in item data, so
// every surface that read `set_bonus` alone left it unframed and unnamed.
// `contributors` is `Proj.setContributors(build)`; when a caller has no build in
// hand (the pure unit-test callers) the item's static sets stand in unchanged.
// Reached as `Proj.*` — a per-file alias for a shared identifier is what blanked
// the app twice (KTD1).
function slotContribs(slot, v, contributors) {
  if (contributors) return Proj.contributorsFor(contributors, slot, v.variant_id);
  return slotSetNames(v).map((set) => ({ set, kind: "intrinsic" }));
}
// The frame decision: does this slot feed a COMPLETED set? `satisfied` absent means
// "no satisfaction filter" — the long-standing behavior of slotSetNames(v, undefined).
function contribGlow(contribs, satisfied) {
  return contribs.some((e) => !satisfied || satisfied.has(e.set));
}
// The set-name line. A wildcard/membership contribution is marked (R8): it counts
// exactly as an intrinsic member does, but the two are not interchangeable and the
// label must not imply they are.
function contribSetLabel(contribs) {
  return [...new Set(contribs.map((e) =>
    e.kind === "wildcard" ? `${e.set} (wildcard)`
      : e.kind === "membership" ? `${e.set} (set-bonus pick)`
        : e.set))].join(", ");
}

// One paperdoll slot cell: uniform, fixed-size, showing only the item name, ML,
// and the set it belongs to. A set piece gets a themed highlight frame (.is-set).
// Full affixes/crafts live in the Loadout Deep Dive tab, not on the cell.
function paperdollSlot(label, pos, pick, satisfied, contributors) {
  if (!pick) {
    return `<div class="pd-slot empty pos-${pos}"><div class="pd-label">${esc(label)}</div><div class="pd-item muted">empty</div></div>`;
  }
  const v = pick.variant;
  const contribs = slotContribs(label, v, contributors);       // U4: every set this slot feeds
  const glow = contribGlow(contribs, satisfied);               // U6: glow = satisfaction
  const setLine = contribs.length ? `<div class="pd-setname" title="part of a set bonus">${esc(contribSetLabel(contribs))}</div>` : "";
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
  const contributors = Proj.setContributors(result);                   // U4/R7: wildcard + membership pieces, not just static set_bonus
  const freeByIndex = (maps && maps.augAssign && maps.augAssign.freeByIndex) || new Map();
  // #335 U4 (KD3) — one block per DISPLAYED item, not per chosen index. This tab is
  // the only surface that shows an item's augments and crafts, so a twin rendering
  // its own second block here is the worst place for the "affixes apply twice"
  // misreading. The pair merges into one block; both copies' open slots are unioned
  // so the upgrade note still speaks for the whole ×2 entry.
  return `<div class="deepdive">${Proj.collapseTwins(result.chosen).map((_g) => {
    const idx = _g.indices[0];
    const c = result.chosen[idx];
    const copies = _g.count;
    const v = c.variant;
    // U10: flag open standard-color augment slots as a concrete unrealized upgrade.
    const openAug = _g.indices.reduce((acc, i) => acc.concat(freeByIndex.get(i) || []), [])
      .filter((col) => STD_AUG_COLORS.has(String(col).toLowerCase()));
    const upgradeNote = openAug.length
      ? `<div class="dd-upgrade"><span class="dd-upgrade-tag">Unrealized upgrade</span> ${openAug.length} open augment slot${openAug.length === 1 ? "" : "s"} (${esc(openAug.join(", "))}) — slot an augment here for more stats.</div>`
      : "";
    const contribs = slotContribs(c.slot, v, contributors);    // U4/R7: intrinsic + wildcard + membership
    const glow = contribGlow(contribs, satisfied);             // U6: is-set glow = satisfaction
    // The intrinsic sets this host GAVE UP to a Set Augment — a static-only read on
    // purpose (KTD3): the resolver has already dropped them, so the disclosure has
    // nowhere else to come from, and dropping it would hide what the augment cost.
    const gaveUp = suppressed.has(v.variant_id) ? slotSetNames(v) : [];
    const suppressNote = gaveUp.length
      ? ` <span class="dd-suppressed" title="a Set Augment slotted here overrides this item's own set bonus">(suppressed by Set Augment${contribs.length ? `: ${esc(gaveUp.join(", "))}` : ""})</span>` : "";
    const setLine = (contribs.length || gaveUp.length)
      ? `<div class="dd-set"><span class="setpip"></span>Part of set: ${esc(contribs.length ? contribSetLabel(contribs) : gaveUp.join(", "))}${suppressNote}</div>` : "";
    // U8/R8 — collapsed before render, so an expanded enchantment reads as the one
    // name engraved on the item rather than as seven school lines.
    const shownAffixes = collapseExpansions(v.affixes || []);
    const affixes = shownAffixes.length
      ? `<ul class="dd-list">${shownAffixes.map((a) => `<li>${esc(affixLabel(a))}</li>`).join("")}</ul>`
      : `<p class="dd-none muted">No parsed affixes on this item.</p>`;
    const crafts = craftChips(v, idx, maps);
    const craftBlock = crafts.length
      ? `<div class="dd-crafts"><h5>Applied crafting &amp; augments</h5><div class="dd-chips">${crafts.join(" ")}</div></div>` : "";
    const wiki = v.wiki_url ? `<a class="dd-wiki" href="${safeUrl(v.wiki_url)}" target="_blank" rel="noopener">wiki</a>` : "";
    const artifactTag = v.artifact ? `<span class="dd-artifact" title="your one equipped Artifact">Artifact</span>` : "";
    // #262 — the wiki-confirmed no-drop-source disclosure, beside the Artifact
    // tag: a head-level fact about the item, spelled by the ONE shared wording
    // (projection.js) so the Deep Dive can never drift from the exports.
    const noDropTag = v.no_drop_source
      ? `<span class="dd-nodrop" title="the DDO wiki records no current in-game source for this item — it stays a solver candidate; block it to exclude it">${Proj.NO_DROP_SOURCE_WORDING}</span>` : "";
    return `<div class="dd-item${glow ? " is-set" : ""}${v.artifact ? " is-artifact" : ""}">
      <div class="dd-head"><span class="dd-slot">${esc(c.slot)}</span><span class="dd-name">${esc(v.variant_id)}</span>${artifactTag}${noDropTag}<span class="dd-ml">ML ${esc(itemMl(v) ?? "?")}</span>${wiki}</div>
      ${whyThisLine(result, { slot: c.slot, variant_id: v.variant_id }, attr, query && query.targets)}
      ${setLine}
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
// `prioCtx` ({ result, attr, targets }) is optional (plan 2026-08-12-001 U3):
// pure-test callers omit it and render no summary, matching the maps tolerance.
function equippedRow(label, pick, slotConstraints, satisfied, maps, augById, ownedInfo, contributors, prioCtx) {
  const c = (slotConstraints || {})[label];
  const locked = c && c.type === "empty";
  const owned = ownedInfo || { mode: false, augments: false, slotsCovered: new Set() };
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
    <button data-act="override" data-slot="${esc(label)}" data-variant="${v ? esc(rowId) : ""}"${v && !locked ? "" : " disabled"}>Correct a bonus type…</button>
  </div>`;
  const badge = rowPinned ? `<span class="pd-badge pin">pinned</span>`
    : locked ? `<span class="pd-badge empty">locked empty</span>` : "";
  const contribs = (v && !locked) ? slotContribs(label, v, contributors) : [];     // U4/R7: every set this slot feeds
  const glow = contribs.length > 0 && contribGlow(contribs, satisfied);            // glow = satisfaction
  const setLine = contribs.length ? `<span class="pd-rset" title="part of a set bonus">${esc(contribSetLabel(contribs))}</span>` : "";
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
  const body = (v && !locked) ? equippedBody(v, pick ? pick.idx : -1, maps, augById, owned.mode, owned.augments) : "";
  // #262 — the no-drop-source note on the gear box itself: the moment of seeing
  // the pick is where the player must learn it, not at the wiki after farming.
  // Same shared wording as the Deep Dive and every export (projection.js).
  const noDropNote = (v && !locked && v.no_drop_source)
    ? `<div class="pd-rnote pd-nodrop" title="the DDO wiki records no current in-game source for this item — it stays a solver candidate; block it to exclude it">${Proj.NO_DROP_SOURCE_WORDING}</div>` : "";
  // U3 (plan 2026-08-12-001) — the priority summary sits at the bottom of the
  // box, outside `.pd-rbody` so equippedBody's emptiness guard cannot swallow it.
  const prio = (v && !locked && prioCtx && prioCtx.result)
    ? whyThisLine(prioCtx.result, { slot: label, variant_id: v.variant_id }, prioCtx.attr, prioCtx.targets)
    : "";
  const rowCls = `pd-row ${(!v || locked) ? "empty" : "occupied"}${glow ? " is-set" : ""}${isArtifact ? " is-artifact" : ""}${(rowPinned || locked) ? " constrained" : ""}`;
  return `<div class="${rowCls}">
    <div class="pd-rtop"><div class="pd-rlabel">${esc(label)}</div>${ctl}</div>
    <div class="${nameCls}"${v ? ` title="${esc(v.variant_id)}"` : ""}>${name}</div>
    ${foot}${reasonNote}${noDropNote}${body}${prio}${artifactBadge}${badge}${menu}
  </div>`;
}

// The stats / augment / craft body of an equipped block. Projects the variant's
// own affixes, then the augments actually slotted (with the affixes they add,
// resolved by variant_id via `augById`) alongside any still-open augment slots,
// and the item's assigned craft-upgrade slots (U2). `maps` (and the pick's `idx`)
// are always supplied on the render path (buildViews -> equippedRow); a maps-less
// call (only the pure test callers) simply renders no augment/craft section.
function equippedBody(v, idx, maps, augById, ownedMode, ownedAugments) {
  // U8/R8 — the Loadout block collapses each expansion to its enchantment for the
  // same reason the Deep Dive does: this is what the player compares against the
  // in-game tooltip.
  const affixes = collapseExpansions(v.affixes || []);
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
  // #359 — the note has to track which pool the augments actually came from.
  // With the augment restriction ON they are drawn from `owned UNION acquirable`,
  // so "not owned" would now overstate: every augment shown is either in the
  // player's export or one anyone can buy. Crafting is still full-catalog in
  // both cases, which is why the restricted wording still says so.
  const recNote = (ownedMode && (augs || crafts))
    ? (ownedAugments
      ? `<div class="pd-rec-note muted" title="Augments are limited to your imported inventory plus augments anyone can buy or trade for; crafting still comes from the full catalog">Owned or buyable${crafts ? " · crafting recommended" : ""}</div>`
      : `<div class="pd-rec-note muted" title="Augments and crafting always come from the full catalog, not your imported inventory">Recommended (not owned)</div>`)
    : "";
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
    // U3 (R8) — a declared credit gets its own presentation, like set and augment.
    // It has no slot, so the generic branch would render a bare "— · " with an
    // undefined source; and it is the one contributor the player supplied rather
    // than the tool sourcing it, which must be visible without consulting docs.
    const isDeclared = c.sourceKind === "declared";
    const kind = isDeclared ? "is-declared" : c.isSet ? "is-set" : c.sourceKind === "augment" ? "is-augment" : "";
    const where = isDeclared
      ? `<span class="attrib-declared" title="You told the optimizer you already have this, so it was not verified against the wiki. It competes in its bonus-type bucket exactly as gear does.">${esc(c.source)}</span>`
      : c.isSet
        ? `<span class="attrib-set">set: ${esc(c.source)}</span>${c.slots.length ? `<span class="attrib-slots"> via ${c.slots.map(esc).join(", ")}</span>` : ""}`
        : `<span class="attrib-slots">${c.slots.length ? c.slots.map(esc).join(", ") : "—"}</span><span class="attrib-src"> · ${esc(c.source)}</span>`;
    const isBool = _isPresence(c);   // U4: presence, not a magnitude (#353)
    // #227 — an adjudicated untyped affix (Enhanced Ki) has no bonus type at all.
    // Printing the raw value put the literal string "null" in the receipts. Name
    // it, because untyped is a real and meaningful bucket in DDO: it collides with
    // nothing, so it always adds on top of every typed bonus to the same stat.
    const typeLabel = isBool ? "feature"
      : (c.bonus_type == null || c.bonus_type === "" ? "untyped" : c.bonus_type);
    // #205 — an expanded enchantment is credited to the ranked stat but is printed
    // on the item under its own name. Show that name, or a player checking the
    // tooltip finds text the item does not carry. The sentence stays family-neutral:
    // every expansion family now stamps this key (R12), so a claim about what the
    // enchantment does — "raises the DC of every school" — would be true only for
    // spell focus and false for Parrying, Speed, Well Rounded, and the rest.
    const via = c.via
      ? `<span class="attrib-via" title="This item carries ${esc(c.via)}, which grants several effects at once. It is credited here to the one you ranked.">as ${esc(c.via)}</span>`
      : "";
    // U3 (#290/#291) — a cross-added credit names its SOURCE stat, flat beside
    // the target's own parts (never grouped). Wording is "from <source stat>"
    // everywhere this credit renders — here, the per-item why-this, and every
    // export. The title states only the wiki-confirmed fact: the source stat
    // fully stacks, so its value adds to this stat on top of its own bonuses.
    const from = c.crossAdd
      ? `<span class="attrib-from" title="${esc(c.crossAdd)} fully stacks with this stat — its value adds on top of the stat's own bonuses, so it is counted here.">from ${esc(c.crossAdd)}</span>`
      : "";
    // #88 U8 (R13/R16) — a contribution whose bonus type the PLAYER asserted is
    // labelled wherever contributors are shown, and names both types: the one the
    // catalog recorded and the one they chose. Same obligation as a declared
    // credit, for the same reason — this is the other value in the receipts that
    // does not trace to the wiki.
    const overridden = c.overriddenFrom
      ? `<span class="attrib-declared attrib-override" title="You told the optimizer this carries ${esc(c.bonus_type)} in game; the catalog records ${esc(c.overriddenFrom)}. It is counted in the ${esc(c.bonus_type)} bucket on your word, not the wiki's.">your ${esc(c.bonus_type)}, catalog says ${esc(c.overriddenFrom)}</span>`
      : "";
    return `<li class="attrib-row ${kind}${c.overriddenFrom ? " is-overridden" : ""}">
      <span class="attrib-type">${esc(typeLabel)}</span>
      <span class="attrib-val">${isBool ? "✓" : "+" + esc(c.value)}</span>
      <span class="attrib-where">${where}${via}${from}${overridden}</span>
    </li>`;
  }).join("")}</ul>`;
}

// The per-item priority summary (R8, R9 + plan 2026-08-12-001 U3): the item's
// contributions to the ranked priorities — stat, value, bonus type — with a
// contribution rendered green when its stat is at its ceiling (a stat-level
// fact from saturationReport, restated at the contribution; never a claim this
// item maxed the stat). The full shared sentence rides the green span's title.
// Empty-state (a filler/tie-break pick) reads as such rather than blank.
// `item` is { slot, variant_id }; `targets` is the player's ranked order.
function whyThisLine(result, item, attr, targets) {
  attr = attr || attributionByTarget(result);
  const contribs = itemContributions(result, item, attr, targets);
  if (!contribs.length) return `<div class="pd-why muted">included to complete the loadout</div>`;
  // #245 — an item whose every ranked contribution is a craftable option is not
  // "best in slot", it is best *once you go craft it*. The wildcard families
  // (a Viktranium slot reaches 126 stats) win whole slots on a single crafted
  // point, so the reason must be on the pick, not buried in the deep dive.
  const carried = Proj.craftCarried(result, item, attr);
  if (carried) {
    const txt = carried.slice(0, 3).map((p) =>
      `${esc(p.stat)} +${esc(p.value)} (${esc(p.family)})`).join(", ");
    return `<div class="pd-why pd-carried" title="Nothing printed on this item advances your priorities — its value here depends entirely on crafting it. Un-craftable alternatives are on the Alternatives tab.">⚒ here only for its crafts: ${txt}</div>`;
  }
  const sat = saturatedStats(result);
  const spans = contribs.slice(0, 3).map((c) => {
    // #227 — untyped is a real bucket; never print a raw null.
    const typeLabel = (c.bonus_type == null || c.bonus_type === "") ? "untyped" : c.bonus_type;
    // U3 (#290/#291) — a cross-added credit is labeled "(from <source stat>)",
    // the same wording as the Ranked Priorities rows and every export.
    const from = c.crossAdd ? ` (from ${esc(c.crossAdd)})` : "";
    // #88 U8 (R13/R16) — a player-asserted bonus type is labelled here too, and
    // names both types. Without it the gear box states a bonus type as though the
    // wiki said so, which is exactly the claim an override does not support.
    const ovr = c.overriddenFrom
      ? ` (your call — catalog says ${esc(c.overriddenFrom)})`
      : "";
    const label = c.boolean
      ? `✓ ${esc(c.stat)}`                                 // U4: presence, not "+1"
      : `${esc(c.stat)} +${esc(c.value)} ${esc(typeLabel)}${c.viaSet ? " (set)" : ""}${from}${ovr}`;
    const line = sat.has(c.stat) ? saturationLineFor(result, c.stat) : null;
    return line
      ? `<span class="pd-contrib at-ceiling" title="${esc(line)}">${label}</span>`
      : `<span class="pd-contrib">${label}</span>`;
  });
  return `<div class="pd-prio" title="this item's contributions to your ranked priorities">${spans.join(", ")}</div>`;
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

// U5/R6 + #369 — the two Artifact facts, as one addressable entry each (U10).
//
//  - the box was checked but no eligible Artifact could be placed (empty seed, or
//    the only Artifact's slot locked/pinned away). A distinct callout by the
//    loadout — NOT buried in the coverage scope-note — because with the seed
//    shipping empty every opt-in hits this path;
//  - a pin overrode the opt-in (a pin is the more specific instruction), so the
//    player MUST be told: they left the box unchecked and an Artifact is in the
//    build anyway. Naming the items is the point — a bare "an Artifact was
//    included" would leave them hunting for which one.
//
// The two never share a card: "none is flagged" over a named, included Artifact
// would be a flat contradiction. This function derives the facts and renders;
// projection.js owns the sentences. Pure (query + chosen), exported.
function artifactNotice(result, query) {
  return artifactNoticeEntries(result, query)
    .map((e) => `<div class="artifact-notice" role="status">${e.sentence}</div>`).join("");
}

/** U10 — the Artifact facts this solve fired, each carrying its title and class.
 *  The render above is these entries and nothing else. */
function artifactNoticeEntries(result, query) {
  const missing = !!(query && query.includeArtifact && result && result.chosen
    && !result.chosen.some((c) => c.variant && c.variant.artifact));
  return Proj.artifactNoticeEntries(
    { missing, pinnedArtifacts: artifactsIncludedByPin(result, query) }, esc);
}

/** #369 — Artifacts in the loadout that are there ONLY because they were pinned:
 *  the opt-in is off, the item is flagged, and a slot constraint names it. Returns
 *  their display names, in loadout order. Empty when the opt-in is on (the player
 *  already asked for an Artifact) or nothing pinned is one. */
function artifactsIncludedByPin(result, query) {
  if (!result || !query || query.includeArtifact) return [];
  const pinned = new Set();
  for (const c of Object.values((query.slotConstraints) || {})) {
    if (!c || c.type !== "pin") continue;
    if (Array.isArray(c.variant_ids)) c.variant_ids.forEach((id) => pinned.add(id));
    else if (c.variant_id != null) pinned.add(c.variant_id);
  }
  if (!pinned.size) return [];
  const out = [];
  for (const c of result.chosen || []) {
    const v = c && c.variant;
    if (!v || !v.artifact) continue;
    const id = v.variant_id || v.source_item;
    if (pinned.has(id)) out.push(v.source_item || id);
  }
  return out;
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
  const entries = boundNoticeEntries(query, result);
  return entries.length
    ? `<p class="scope-note bound-note" role="status">${entries.map((e) => e.sentence).join(" ")}</p>`
    : "";
}

/** U10 — the bounds this solve actually hit, one addressable entry per fired
 *  branch, each carrying its title and class. They classify differently — an
 *  unmet floor is something the player can act on, a declared credit is not — so
 *  a single title over the bundle would assert a fact the solve never
 *  established. This function DERIVES the facts (it owns the pin and off-hand
 *  readers); projection.js owns every sentence. */
function boundNoticeEntries(query, result) {
  const per = (result && result.perTarget) || {};
  const caps = (query && query.targetCaps) || {};
  const heldCaps = Object.keys(caps)
    .filter((s) => per[s] != null && per[s] >= caps[s])
    .map((s) => ({ stat: s, cap: caps[s] }));
  let offHand = null;
  if (_offHandItemsExcluded(query || {})) {
    // Is there an off-hand ITEM in a build that excluded off-hand items? Two very
    // different causes, and the notice must not conflate them:
    //
    //  - the player PINNED it (R8's escape hatch) — check the actual pin, do not
    //    infer it from the item's presence;
    //  - the shown loadout was solved BEFORE the declaration existed. A restored
    //    snapshot is not re-solved on load, and plan 003 U4 migrates pre-U1 saves to
    //    declared, so this is reachable, not theoretical. Inferring a pin here would
    //    put a flatly false "your pinned X" in front of a player who pinned nothing.
    const worn = ((result && result.chosen) || []).find((c) => c.slot === "Off Hand");
    const offItem = worn && worn.variant && worn.variant.category !== "weapon" ? worn.variant : null;
    const offPins = _pinnedVariantIds(((query && query.slotConstraints) || {})["Off Hand"]);
    const pinned = !!offItem && offPins.includes(offItem.variant_id || offItem.source_item);
    offHand = {
      mode: pinned ? "pinned" : offItem ? "stale" : "none",
      name: offItem ? (offItem.source_item || offItem.variant_id) : "",
    };
  }
  return Proj.boundNoticeEntries({
    mlFloor: query && query.mlFloor,
    floorReport: (result && result.floorReport) || [],
    heldCaps,
    // U4 (R9, R10) — this notice exists to keep "provably optimal" truthful, and a
    // declared credit is the same class of qualifier as the ML band and a held cap:
    // part of the answer rests on a number the player supplied, which the tool did
    // not verify. Read from `creditReport` (plain JSON on the result) rather than
    // the live program, so a restored character discloses identically without
    // re-solving (KTD6).
    creditLines: (Proj && Proj.creditNoticeLines) ? Proj.creditNoticeLines(result) : [],
    // #88 U8 (R14) — the same class of qualifier as the declared credit directly
    // above: part of the answer rests on a bonus type the player asserted and the
    // tool did not verify. Read from `overrideReport` (plain JSON on the result) so
    // a restored character qualifies identically without re-solving (KTD6).
    overrideLines: (Proj && Proj.overrideNoticeLines) ? Proj.overrideNoticeLines(result) : [],
    offHand,
  }, esc);
}

// #239 — the two disclosures, rendered with the loadout rather than buried in the
// dataset-scoped coverage note, joining the artifactNotice/boundNotice family for
// the reason artifactNotice records: a player reads the build, not the scope note.
//
// Both read the SHARED sentences from projection, never a second wording. A
// notice phrased once here and once in the exporters is how the app and a shared
// build come to disagree about the same solve.

/** The ceiling fact, compact (plan 2026-08-12-001 U2): a count and list —
 *  "3 priorities at ceiling: Intelligence 37, Constitution 40." — in report
 *  order, which is the solve's ranked-target order. The full shared sentences
 *  ride the tooltip and every export still prints them unchanged
 *  (`projection.saturationNoticeLines` stays the single wording source).
 *  Pure (result), and identical on a restored snapshot. */
function saturationNotice(result) {
  const report = (result && result.saturationReport) || [];
  if (!report.length) return "";
  const lines = (Proj && Proj.saturationNoticeLines) ? Proj.saturationNoticeLines(result) : [];
  const list = report.map((e) => `${esc(e.stat)} ${esc(e.total)}`).join(", ");
  const word = report.length === 1 ? "priority" : "priorities";
  // #277 — the solve-banner's tap/keyboard-openable pattern: the full sentences
  // are VISIBLE text in the open state, so a touch or keyboard user is not
  // locked out of the explanation; the title stays as the pointer fast-path.
  return `<details class="scope-note saturation-note">`
    + `<summary title="${lines.map(esc).join(" ")}">${report.length} ${word} at ceiling: ${list}.</summary>`
    + `<div class="sat-sentences">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div></details>`;
}

/** #278 — the stale-save disclosure: an optimal snapshot with no `effective`
 *  predates the current save format. Facts + remedy only; no claim about how
 *  the save got that way. Pure (result), silent on current-format saves. */
function staleSnapshotNotice(result) {
  const stale = result && result.status === "optimal" && result.effective == null;
  return stale
    ? `<p class="scope-note stale-save-note" role="status">This saved build is missing some of its data — `
      + `totals and receipts are unavailable. Re-solve to restore the full analysis.</p>`
    : "";
}

/** #276 — the receipt-card ceiling marker, in the .stat-cap chip idiom: the
 *  same stat-level fact the gear boxes color green, with the same shared
 *  sentence as its tooltip. Empty when the stat is not saturated.
 *
 *  #446 U3 (R17b) — RETAINED ONLY AS THE FALLBACK. A result carrying
 *  `ceilingReport` renders `statReach` instead and never this chip; a build
 *  saved before #446 shipped has no such report, and deleting the chip would
 *  leave it with no ceiling signal at all from data its save still contains.
 *  The card picks one or the other on `statReach` being empty, so the two are
 *  mutually exclusive by construction rather than by two agreeing predicates. */
function ceilingChip(result, stat) {
  const line = (Proj && Proj.saturationLineFor) ? Proj.saturationLineFor(result, stat) : null;
  return line ? `<span class="stat-ceiling at-ceiling" title="${esc(line)}">at ceiling</span>` : "";
}

/** #446 U3 (R11-R16, R29, R30, R33) — the ranked card's achieved/ceiling box.
 *
 *  Every number and every sentence comes from `Proj.ceilingFor`, which owns the
 *  four short forms so the card and the five exports cannot drift. This function
 *  owns only the markup and which treatment each state takes.
 *
 *  Takes the build BEING RENDERED (KTD9). `renderBuild` is generic over the
 *  optimum and any selected alternative, and an alternative carries its own
 *  `ceilingReport` — `readSolution` emits it and `solveConstrained` spreads that
 *  in. Closing over the optimum would state its numerator beside an
 *  alternative's headline: a confidently-stated wrong number.
 *
 *  Empty string when `ceilingFor` returns null (no row for the stat — a pre-#446
 *  restore). That is the sole mechanism behind R19: nothing is rendered, no
 *  denominator is invented, and no re-solve is triggered to obtain one.
 *
 *  The four treatments, and why they differ:
 *   - `maxed`     green box, tint and fill. Reserved for achieved === pool ceiling.
 *   - `shortfall` the neutral accent. A shortfall is not a fault, so no warning
 *                 colour, and the sentence asserts nothing about a solve that was
 *                 never run (KTD2).
 *   - `capBound`  the amber cap idiom `.stat-cap` already uses, agreeing with the
 *                 capNote inches away. NOT green: the pool could raise the stat,
 *                 the cap won't let it land (KTD7).
 *   - `zeroCeiling` no meter at all. `0 / 0` satisfies achieved === ceiling, so
 *                 an ungated green would claim "at ceiling" on a stat the solve
 *                 found nothing for (R30).
 *
 *  R29 — the meter's WHOLE TRACK carries the hatch (`.reach-meter` background),
 *  with the translucent fill drawn over it. Hatching only the remainder puts the
 *  strongest bound signal where the risk is lowest: at 96% filled there is 4% of
 *  track left to render it in, and that near-full bar is exactly the one that
 *  misreads as "almost attainable". There is deliberately no remainder element. */
function statReach(build, stat) {
  const c = (Proj && Proj.ceilingFor) ? Proj.ceilingFor(build, stat) : null;
  if (!c) return "";
  const state = c.capBound ? "is-cap-bound"
    : c.zeroCeiling ? "is-zero-ceiling"
      : c.maxed ? "is-maxed" : "is-shortfall";
  // Width from the CLAMPED pair, so a capped stat's meter agrees with its own
  // fraction. Never divides by a zero denominator — that state renders no meter.
  const pct = c.ceilingUpperBound > 0
    ? Math.max(0, Math.min(100, Math.round((c.achieved / c.ceilingUpperBound) * 100))) : 0;
  // aria-hidden: the fraction and the sentence beside it already carry the whole
  // fact in text, so the bar would only repeat it as noise.
  const meter = c.zeroCeiling ? ""
    : `<div class="reach-meter" aria-hidden="true"><span class="reach-fill" style="width:${pct}%"></span></div>`;
  return `<div class="stat-reach ${state}">`
    + `<span class="reach-fraction">${esc(c.fraction)}</span>`
    + meter
    + `<p class="reach-note">${esc(c.short)}</p>`
    + `</div>`;
}

/** #110 (U7) — the blocklist disclosure. Reads the SHARED sentences from
 *  projection; silent when no block removed an eligible candidate. */
function blockNotice(result) {
  const lines = (Proj && Proj.blockNoticeLines) ? Proj.blockNoticeLines(result) : [];
  return lines.length
    ? `<p class="scope-note block-note" role="status">${lines.map(esc).join(" ")}</p>`
    : "";
}

/** #245 — the niche-crafting opt-out disclosure. Reads the SHARED sentence from
 *  projection (one wording for the app and every export), keyed off the solved
 *  query so a restored snapshot discloses identically. */
function craftingExcludedNotice(query, result) {
  const line = (Proj && Proj.craftingExcludedLine)
    ? Proj.craftingExcludedLine({ snapshot: result, inputs: query }) : null;
  return line
    ? `<p class="scope-note crafting-excluded-note" role="status">${esc(line)}</p>`
    : "";
}

/** #339 — the augment-ceiling scope disclosure (the shared projection sentence).
 *  The worker result carries no query field, so the in-scope SOLVED query is
 *  forwarded as rec.query — on a fresh solve that is the solve's own query; on a
 *  restored character the wizard passes rec.query (the restored solve's query),
 *  so a pre-ceiling snapshot stays silent without a re-solve. */
function augCeilingNotice(query, result) {
  const line = (Proj && Proj.augCeilingLine)
    ? Proj.augCeilingLine({ snapshot: result, query }) : null;
  return line
    ? `<p class="scope-note aug-ceiling-note" role="status">${esc(line)}</p>`
    : "";
}

/** U6/#249 — the compound-absorption exclusion. Pure (result), and identical on
 *  a restored snapshot, for the same reason the ceiling fact above is.
 *
 *  Reads the SHARED sentences from projection, never a second wording. A notice
 *  phrased once here and once in the exporters is how the app and a shared build
 *  come to disagree about the same solve. */
function absorptionQuarantineNotice(result) {
  const lines = (Proj && Proj.absorptionQuarantineNoticeLines)
    ? Proj.absorptionQuarantineNoticeLines(result) : [];
  return lines.length
    ? `<p class="scope-note absorption-quarantine-note" role="status">${lines.map(esc).join(" ")}</p>`
    : "";
}

/** Stats the equipped items already supply that the player did NOT rank.
 *
 *  KTD5 — the invitation names these rather than a curated suggestion list. A
 *  curated list would have the tool holding an opinion about which gear is good,
 *  which is the thing "invite, don't auto-fill" exists to avoid. These come from
 *  the player's own loadout, so every one is verifiably already in hand.
 *  Ordered by how many equipped items carry it, so the strongest incidental
 *  theme leads.
 */
function incidentalStats(query, result) {
  const ranked = new Set((query && query.targets) || []);
  const counts = new Map();
  for (const c of (result && result.chosen) || []) {
    const seen = new Set();
    for (const a of (c.variant && c.variant.affixes) || []) {
      const n = a && (a.name != null ? a.name : a.stat);
      // Presence-only features have no magnitude to chase, so they make poor
      // suggestions for a player trying to give the solver something to optimize.
      if (!n || ranked.has(n) || seen.has(n) || _isPresence(a)) continue;   // #353: one predicate
      seen.add(n);
      counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).map((e) => e[0]);
}

/** The empty-slot fact, plus the invitation. The invitation is app-only — it
 *  points at the Adjust & re-solve panel already on this screen, which a shared
 *  export does not have. */
function emptySlotNotice(query, result) {
  const lines = (Proj && Proj.emptySlotNoticeLines) ? Proj.emptySlotNoticeLines(result) : [];
  if (!lines.length) return "";
  const names = incidentalStats(query, result).slice(0, 3);
  const invite = names.length
    ? `Rank another stat to put them to work — your gear already carries `
      + `${names.map(esc).join(", ")}.`
    : `Rank another stat to put them to work.`;
  return `<p class="scope-note empty-slot-note" role="status">${lines.map(esc).join(" ")} `
    + `${invite} Open <strong>Adjust &amp; re-solve</strong> below.</p>`;
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
// #345 (U1) — the pool traversal moved to model.js so the SOLVER and the render
// layer share one answer to "what can this pool supply". The solver stamps the
// outbid set onto the result (a restored character has no model to re-derive
// from), and this layer renders it; two implementations would drift.
var _resultsPoolStatNames = (typeof poolStatNames !== "undefined")
  ? poolStatNames
  // eslint-disable-next-line global-require
  : require("./model.js").poolStatNames;

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

/** #346 (U5, R12) — the stat names the current rung actually took out of reach.
 *
 *  Attribution has to be evidence-based, not rung-based: the ladder is one of
 *  several things that can empty a stat's pool, and naming it without checking
 *  produces confidently wrong advice ("raise the ladder") for a stat the ladder
 *  never touched. Covers both halves of the ladder — the craftable option pools
 *  the niche-crafting rung empties, and the augments the two rungs below it gate
 *  — so a Viktranium-only stat is attributed as readily as an augment-only one.
 *
 *  Runs only when a target already came back with no reachable source, which is
 *  rare, so the scan cost never lands on an ordinary solve. */
function _rungRemovedStats(dataset, rung) {
  const out = new Set();
  if (!dataset || !_resultsRungExcludesNicheCrafting(rung)) return out;
  const add = (affixes) => {
    for (const a of affixes || []) {
      const n = a && (a.name != null ? a.name : a.stat);
      if (n) out.add(n);
    }
  };
  // The craftable option families buildModel empties at the niche-crafting rung.
  for (const pool of [dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium,
    dataset.seal, dataset.thunder_forged, dataset.green_steel]) {
    for (const o of pool || []) add(o && (o.affixes || (o.stat ? [o] : [])));
  }
  // #371 — the per-item pools buildModel empties on the same rung; a map of
  // host -> options, so they cannot ride the flat list above.
  for (const opts of Object.values(dataset.nearly_complete_per_item || {})) {
    for (const o of opts || []) add(o && (o.affixes || (o.stat ? [o] : [])));
  }
  for (const defs of [dataset.membership_set_defs, dataset.augment_set_defs]) {
    for (const def of Object.values(defs || {})) {
      for (const t of (def && def.tiers) || []) add(t.affixes);
    }
  }
  // The augments the two lower rungs gate, by the same colour rule model.js uses.
  const allAugs = _resultsRungExcludesAllAugments(rung);
  const solarLunar = _resultsRungExcludesSolarLunar(rung);
  if (allAugs || solarLunar) {
    for (const v of dataset.items || []) {
      if (!v || v.category !== "augment") continue;
      const isSL = _resultsIsSolarLunarColor((v.aug_color || {}).color);
      if (allAugs || isSL) add(v.affixes);
    }
  }
  return out;
}

function zeroSourceNotice(query, result, model, dataset) {
  const entries = zeroSourceNoticeEntries(query, result, model, dataset);
  return entries.length
    ? `<p class="scope-note zero-source-note" role="status">${entries.map((e) => e.sentence).join(" ")}</p>`
    : "";
}

/** U10 — the zero-source facts this solve fired, each carrying its title and
 *  class. The two causes call for two different player actions — one of them for
 *  no action at all — so they are separate entries, never one card. This function
 *  derives them from the pool and the dataset; projection.js owns the sentences. */
function zeroSourceNoticeEntries(query, result, model, dataset) {
  if (!result || result.status !== "optimal") return [];
  const targets = (query && query.targets) || (model && model.targets) || [];
  if (!targets.length || !model) return [];
  const reachable = _resultsPoolStatNames(model);
  // #91 — the Utility sentinel is never a pool stat (poolStatNames only ever
  // collects real affix/scaling names), so without this exclusion every solve
  // with the tier ranked would flag it here — the same false "unsourced"
  // reading the generic stat-card loop already guards against at its own call
  // site (mirrors the `stat === _UTILITY_SENTINEL` exclusion above).
  const unsourced = targets.filter((t) => t !== _UTILITY_SENTINEL && !reachable.has(t));
  if (!unsourced.length) return [];
  // Two causes, two different player actions.
  const absent = [], filtered = [];
  for (const t of unsourced) (datasetHasStat(dataset, t) ? filtered : absent).push(t);
  // The filtered branch deliberately does NOT name a single cause. The pool the
  // solver sees is the product of the ML band, the gear pool, the character gates
  // AND the dominance pre-filter, and this function cannot tell which one removed
  // the last source. Naming "your ML band" was wrong for a verified ML-29 item
  // well inside a cap of 34 that the dominance filter had pruned. Only the
  // owned-pool case is named, because opting into it is an explicit, single,
  // reversible choice.
  const owned = !!(query && query.pool === "owned");
  // #346 (U5, R12) — the ladder joins the owned-pool carve-out for the same
  // reason that one exists: it is an explicit, single, reversible choice the
  // player made, not one of the many filters this function deliberately
  // refuses to guess between. Twenty targetable stats are augment-only
  // (Strikethrough, Sneak Attack Dice, Imbue Dice, ...), so a lowered rung is
  // the likeliest cause of a zero here — and telling that player to widen
  // their ML band is advice that cannot work.
  const rung = _resultsRung(query || {});
  // Blame the rung only on EVIDENCE that it removed a source of one of these
  // stats. Keying on the rung value alone told a player whose stat is missing
  // for ML-band reasons to raise the ladder — wrong advice, and it discarded
  // the correct advice to make room. That is worse than the generic sentence
  // projection.js deliberately falls back to, which is why the fallback stays.
  const removedByRung = _rungRemovedStats(dataset, rung);
  return Proj.zeroSourceNoticeEntries({
    absent,
    filtered,
    owned,
    rungRestricts: filtered.some((s) => removedByRung.has(s)),
    removed: _resultsRungExcludesAllAugments(rung) ? "augments"
      : _resultsRungExcludesSolarLunar(rung) ? "Solar/Lunar Gems" : "niche crafting",
  }, esc);
}

/** #345 (U1, R1/R3/R4) — the targets that were OUTBID: reachable in the active
 *  pool, and still zero, because a higher-ranked priority locked the only slot
 *  that could carry them.
 *
 *  This is deliberately NOT a third branch inside `zeroSourceNotice`. That
 *  function's contract is "no source exists", and its own test pins the opposite
 *  behaviour for this case with the reason stated: a stat that merely lost its
 *  slots "is a different case and must not be conflated". Both hold at once —
 *  the zero-source notice stays silent here, and this one speaks.
 *
 *  A free rider is excluded by construction: it scored above zero, so it never
 *  enters this set. Nothing was spent on it and nothing outbid it. */
function outbidTargets(query, result, model) {
  if (!result || result.status !== "optimal") return [];
  const targets = (query && query.targets) || (model && model.targets) || [];
  if (!targets.length || !model) return [];
  // Same exclusion zeroSourceNotice applies: the Utility sentinel is never a
  // pool stat, so every solve with the tier ranked would otherwise flag here.
  if (Array.isArray(result.outbidReport)) return result.outbidReport;
  const reachable = _resultsPoolStatNames(model);
  const per = (result && result.perTarget) || {};
  // Same exclusion the solver applies: an unmet floor is a failed requirement,
  // and boundNotice already explains it. Two notices for one zero is worse than one.
  const unmet = new Set(((result && result.floorReport) || []).map((f) => f && f.stat));
  // A target ABSENT from perTarget is unknown, not zero. Claiming it was outbid
  // would be inventing a value the solve never reported — the same class of
  // error as naming an unproven binding priority.
  const scoredZero = (t) => Object.prototype.hasOwnProperty.call(per, t) && Number(per[t]) <= 0;
  return targets.filter((t) =>
    t !== _UTILITY_SENTINEL && reachable.has(t) && !unmet.has(t) && scoredZero(t));
}

function outbidNotice(query, result, model, canPrice, canRequire) {
  const names = outbidTargets(query, result, model);
  if (!names.length) return "";
  // Names the targets, never the binding priority — proving which higher-ranked
  // stat bound them costs a solve and belongs to the on-request path (U2/U3).
  // Naming one from rank order alone would be the guess this repo already paid
  // for once in zeroSourceNotice's rung attribution.
  // Projection owns the wording so the panel and all six exports say one thing.
  const lines = (Proj && Proj.outbidNoticeLines) ? Proj.outbidNoticeLines(names) : [];
  if (!lines.length) return "";
  // #345 (U3, R7) — pricing is ON REQUEST. Measured: one attribution costs
  // 28-58% of the solve it follows, and pricing every outbid target costs
  // 111-154% of it (2.6s on an endgame melee build). Automatic would more than
  // double the wait the player already sat through; asked-for is affordable.
  // Absent on a restored character, which carries no solver to probe with.
  const ask = names.map((n) => {
    const price = canPrice
      ? `<button type="button" class="outbid-price" data-stat="${esc(n)}">What would ${esc(n)} cost?</button>` : "";
    // #345 (U4, R9) — requiring needs no solver: it writes a floor and re-solves
    // through the wizard's normal path, so it is offered on a restored character
    // where pricing is not.
    const req = canRequire
      ? `<button type="button" class="outbid-require" data-stat="${esc(n)}">Require ${esc(n)}</button>` : "";
    return price + (price && req ? " " : "") + req;
  }).filter(Boolean).join(" ");
  return `<p class="scope-note outbid-note" role="status">${lines.map(esc).join(" ")}`
    + (ask ? `<span class="outbid-ask">${ask}</span>` : "") + `</p>`;
}

function renderResults(container, { model, result, query, dataset, highs, onAfterRender, onRequire }) {
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
  // #110 (U7/R8) — a solve a block changed is optimal GIVEN the exclusions,
  // which is a different and weaker claim than plain optimality; the banner
  // must not assert the strong one. Keyed off blockReport (blocks that actually
  // removed an eligible candidate) — a blocklist that touched nothing changes
  // no claim and no wording.
  const blockQualified = (optimum.blockReport || []).length > 0;
  const banner = `
    <div class="solve-banner">
      <details class="solve-explain">
        <summary class="solve-verdict"><span class="dot"></span><span class="label">OPTIMAL${blockQualified ? " · GIVEN YOUR EXCLUSIONS" : ""}</span><span class="sub">${blockQualified ? "provably the best build with your blocked gear removed" : "provably the best build, not a guess"}</span><span class="explain-hint" aria-hidden="true">ⓘ</span></summary>
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
    ${staleSnapshotNotice(result)}
    ${boundNotice(query, result)}
    ${zeroSourceNotice(query, result, model, dataset)}
    ${outbidNotice(query, result, model, canPriceOutbid(), typeof onRequire === "function")}
    ${saturationNotice(result)}
    ${emptySlotNotice(query, result)}
    ${absorptionQuarantineNotice(result)}
    ${craftingExcludedNotice(query, result)}
    ${augCeilingNotice(query, result)}
    ${blockNotice(result)}
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

  // #345 (U4, R8/R9) — accepting the trade writes a floor and re-solves. The
  // handler is the wizard's, so the floor goes through the same sanitizer and
  // persisted field the Advanced min input writes; one writer, one clear path.
  for (const btn of container.querySelectorAll(".outbid-require")) {
    btn.addEventListener("click", () => {
      btn.disabled = true;
      if (typeof onRequire === "function") onRequire(btn.dataset.stat);
    });
  }

  // #345 (U3) — price on request. One probe per click, never on the solve path.
  for (const btn of container.querySelectorAll(".outbid-price")) {
    btn.addEventListener("click", () => {
      const stat = btn.dataset.stat;
      btn.disabled = true;
      btn.textContent = `Pricing ${stat}…`;
      // Defer so the label paints before the synchronous probe runs.
      setTimeout(() => {
        let attr = null;
        try {
          attr = attributeOutbid(optimum.program, highs, stat,
            (query && query.targets) || [], optimum.perTarget || {});
        } catch (e) {
          // Fall back to the honest "cannot tell" wording, but never silently:
          // a swallowed probe failure would be indistinguishable from a genuine
          // jointly-bound target, which is the one thing this must not blur.
          attr = null;
          console.error("outbid pricing failed", e);
        }
        const out = document.createElement("span");
        out.className = "outbid-priced";
        out.textContent = attr
          ? `${stat} costs ${attr.cost} ${attr.binding} (${attr.bindingValue} to ${attr.bindingHeld}). `
            + `Set a minimum on ${stat} to require it.`
          : `Could not isolate a single priority holding ${stat} back — more than one is binding it.`;
        btn.replaceWith(out);
      }, 0);
    });
  }
  renderBuild(optimum);

  // Alternatives tab (U4): gated behind an explicit "Run analysis" button (R7) so
  // the base solve stays instant and nothing computes until asked. While it runs,
  // a panel-local .wz-ring swirly shows (R8/KTD4 — the wizard's overlay() is a
  // closure results.js can't reach). Every terminal state replaces the spinner —
  // cards, "none found", an error-with-retry, or solver-unavailable — so it is
  // never left spinning.
  const altState = { list: null, computing: false };
  const altUnavailable = () => typeof generateAlternatives !== "function" || !highs;

  // #345 (U3, KTD4) — same shape as altUnavailable: a capability probe, not an
  // assumption. The restored-character render passes highs: null, so pricing is
  // withheld there and the disclosure still stands on its own.
  function canPriceOutbid() {
    return typeof attributeOutbid === "function" && !!highs && !!(optimum && optimum.program);
  }
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

// #91 (U5, KTD6/R9) — the Utility tier's dedicated priority card. Takes the
// `build` BEING RENDERED (renderBuild is generic over optimum/alternative), so
// selecting an Alternatives entry re-renders receipts from THAT build — it must
// never close over the optimum. Three states, deliberately distinct:
//   1. report-absent (a healed pre-feature restore: the tier is in the priority
//      list but the snapshot predates `utilityReport`) — a re-solve note, NEVER
//      the zero-state, which would be a false claim about an unknown count;
//   2. count-zero — the plain R9 sentence, never an empty receipts list;
//   3. receipts-present — the count plus one "effect — from item" line each,
//      credited by the solver's stated first-carrier rule.
/** #348 (U5, R14) — the container's misses and the priced top miss, as one block
 *  used by BOTH the zero-count and populated states. A player whose container
 *  secured nothing is exactly the one who most needs to know why, so rendering
 *  this only in the populated branch would hide it in the case that matters most.
 *  Sentences come from projection.js — the same strings the exports print. */
function utilityMissBlock(build) {
  const ordered = build && build.utilityOrdered;
  if (!ordered) return "";   // pre-#348 snapshot: say nothing rather than assert an empty container
  const lines = Proj.utilityUnsecuredLines ? Proj.utilityUnsecuredLines(ordered) : [];
  const price = Proj.utilityPriceLine ? Proj.utilityPriceLine(ordered.price) : null;
  if (!lines.length && !price) return "";
  const list = lines.length
    ? `<ul class="utility-unsecured">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
    : "";
  const priceNote = price ? `<p class="utility-note utility-price">${esc(price)}</p>` : "";
  return `<details class="utility-misses"><summary>Not secured (${lines.length})</summary>${list}${priceNote}</details>`;
}

function utilityCard(build, rankIdx) {
  const head = `<div class="stat-head"><span class="stat-rank">${rankIdx + 1}</span>`
    + `<span class="stat-name">${esc(_UTILITY_SENTINEL)}</span></div>`;
  const rep = build ? build.utilityReport : null;
  if (!rep) {
    return `<div class="stat-card utility-card utility-stale">${head}
      <p class="utility-note muted">This saved build predates utility tracking — re-solve to compute utility effects.</p>
    </div>`;
  }
  const effects = rep.effects || [];
  if (!effects.length) {
    // #332 — the zero-count state needs the disclosure too: ranking only weapon
    // procs is exactly how a player reaches a count of zero while their ranked
    // stats are satisfied, which is the most confusing version of this gap.
    const exc0 = Proj.utilityExcludedFor ? Proj.utilityExcludedFor(build) : { line: null };
    return `<div class="stat-card utility-card">${head}
      <div class="stat-value" data-final="0">0</div>
      <p class="utility-note">${esc(Proj.utilityLine(0))}</p>${exc0.line ? `
      <p class="utility-note muted">${esc(exc0.line)}</p>` : ""}
      ${utilityMissBlock(build)}
    </div>`;
  }
  const list = effects.map((e) =>
    `<li class="utility-effect">✓ ${esc(e.name)}${e.item ? ` <span class="attrib-src">— from ${esc(e.item)}</span>` : ""}</li>`).join("");
  // #332 — a ranked presence effect the tier does NOT count is named here, not
  // left as a silent contradiction between a satisfied stat and a count that
  // omits it. Same helper and same sentence the exports use (projection.js owns
  // both), so the shared loadout reads exactly like the one on screen.
  const exc = Proj.utilityExcludedFor ? Proj.utilityExcludedFor(build) : { line: null };
  const excNote = exc.line ? `<p class="utility-note muted">${esc(exc.line)}</p>` : "";
  return `<div class="stat-card utility-card">${head}
    <div class="stat-value" data-final="${esc(effects.length)}">${esc(effects.length)}</div>
    <ul class="attrib utility-receipts">${list}</ul>${excNote}
    ${utilityMissBlock(build)}
  </div>`;
}

// #340 — the Sets tab's bundled-enchantments block (empty string when the
// loadout carries none). Deliberately NOT set-shaped: these are single-source
// enchantments, so the copy says so and no piece count or tier language appears.
// Groups come from the shared projection primitive (`Proj.bundleGroups`), the
// same source the exports render, so the two surfaces cannot drift; `augById`
// is the catalog fallback for placement records saved before they carried
// affixes (the set-like block's own precedent).
function bundlesBlock(build, augById) {
  const groups = Proj.bundleGroups(build, augById);
  if (!groups.length) return "";
  const cards = groups.map((b) =>
    `<li class="set-card bundle"><strong>${esc(b.name)}</strong><div class="set-grants">${esc(b.members.map(affixLabel).join(", "))}</div><div class="set-via">from ${esc(b.carrier)}</div></li>`
  ).join("");
  return `<h3 class="setlike-h" title="one enchantment granting several stats">Bundled enchantments (single-source, not sets)</h3><ul class="sets bundle-list">${cards}</ul>`;
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
  // #278 — a degenerate save (no `effective`) renders zeroed cards behind the
  // stale-save notice instead of throwing and blanking the whole results area.
  const effective = build.effective || {};
  const cards = query.targets.map((stat, i) => {
    // #91 (U5) — the Utility sentinel is EXCLUDED from the generic stat-card
    // body: it is not a stat, has no effective[] entry, and the generic card
    // would render a phantom 0-value row. Its dedicated card renders at the
    // sentinel's rank index instead, so the row sits where the player ranked it.
    if (stat === _UTILITY_SENTINEL) return utilityCard(build, i);
    const total = effective[stat] ?? 0;
    const contribs = attr[stat] || [];
    const cap = build.capped ? build.capped[stat] : null;
    const rawSum = contribs.reduce((s, p) => s + p.value, 0);
    const capNote = (cap != null && rawSum > total)
      ? `<span class="stat-cap" title="raw ${esc(rawSum)} exceeds the cap for this stat">capped at ${esc(total)} · raw ${esc(rawSum)}</span>` : "";
    // #446 U3 (R17b) — one ceiling signal per card, chosen by which data the
    // build actually carries: the fraction when `ceilingReport` has a row for
    // this stat, the legacy chip only when it does not.
    const reach = statReach(build, stat);
    return `<div class="stat-card">
      <div class="stat-head"><span class="stat-rank">${i + 1}</span><span class="stat-name">${esc(stat)}</span></div>
      <div class="stat-value" data-final="${esc(total)}">${esc(total)}</div>
      ${capNote}${(!reach && build.effective) ? ceilingChip(build, stat) : ""}
      ${attributionList(contribs)}
      ${reach}
    </div>`;
  }).join("");
  // #446 U3 (R15) — the FULL statement, once per readout at section level. It
  // carries the qualification the per-card short forms omit: repeated under every
  // card down an eight-priority build it reads as boilerplate and stops being
  // read, which defeats the premise that the sentence is the mitigation. It sits
  // above the cards rather than behind a fold so it is in the same view, not
  // merely reachable. Null (and silent) on a pre-#446 restore.
  const ceilingStatement = (Proj && Proj.ceilingStatement) ? Proj.ceilingStatement(build) : null;
  const cardsHtml = (ceilingStatement ? `<p class="ceiling-statement">${esc(ceilingStatement)}</p>` : "") + cards;

  // Equipped list (prototype layout): a plain stacked list of every slot the
  // model considered, occupied or empty — no humanoid figure, full item names
  // (no truncation). Weapons are folded into the same list in slot order.
  const satisfied = satisfiedSets(build.chosen, build.setsActive, suppressedHostIds(build));   // U6/U7: glow only completed-set pieces, honoring Set-Augment suppression
  // U4/R7 — the set-contributor resolver, computed once and handed to every row: a
  // wildcard/chosen-membership slot feeds a set that appears nowhere in its item data.
  const contributors = Proj.setContributors(build);
  // U2 — resolve an augment's affixes by variant_id (the placed meta carries the
  // id + color but no affixes); model.augments holds the full augment records.
  const augById = new Map((model.augments || []).map((a) => [a.variant_id, a]));
  // U6/U7 — owned-mode signal for the empty-slot note and the recommended-augment
  // marking (view layer). Plumbed on the query at solve time; falls back to
  // non-owned when absent (loaded snapshots, pure-test callers).
  // #359 — `augments` says whether the augment pool was restricted too, which
  // changes what the per-row note can honestly claim.
  const ownedInfo = { mode: !!query.ownedMode, augments: !!query.ownedAugments,
                      slotsCovered: new Set(query.ownedSlotsCovered || []) };
  const rows = [];
  for (const slot of model.worn) {
    const picks = picksBySlot.get(slot.slot) || [];
    const cardinality = slot.cardinality || 1;
    // #335 U4 (KD3) — a duplicate-ring pair is ONE row marked ×2, not two rows.
    // This loop was position-bound (`r < cardinality`) and would otherwise emit a
    // second row for the twin, which reads as the affixes applying twice — the
    // exact misreading the single-row decision exists to prevent. Collapse first,
    // then pad only the positions that are genuinely empty.
    const groups = Proj.collapseTwins(picks.map((p) => ({ slot: slot.slot, variant: p.variant, _pick: p })));
    for (const g of groups) {
      const pick = g.indices.map((i) => picks[i]).filter(Boolean)[0] || null;
      rows.push(equippedRow(slot.slot, pick, query.slotConstraints, satisfied, maps, augById, ownedInfo, contributors,
        { result: build, attr, targets: query.targets, copies: g.count,
          copyPicks: g.indices.map((i) => picks[i]).filter(Boolean) }));
    }
    for (let r = picks.length; r < cardinality; r++) {
      rows.push(equippedRow(slot.slot, null, query.slotConstraints, satisfied, maps, augById, ownedInfo, contributors,
        { result: build, attr, targets: query.targets }));
    }
  }
  const weapons = ""; // weapons are included in the equipped list above

  // Set Bonuses tab (U8): only satisfied sets, each showing its granted affixes
  // and the equipped pieces composing it (grouped by set). No near-miss hints,
  // no non-set items.
  // R10 — every contributing piece is named with the slot it occupies, wildcard and
  // chosen-membership picks included, and an Augment Set names its copies and their
  // hosts. A card that named nothing while stating a tier number told the player a
  // bonus was active and refused to say what produced it; when the resolver truly
  // reports no piece, the card says so rather than going quiet.
  const activeSets = satisfiedSetDetail(build).map((s) => {
    const grants = s.affixes.length ? esc(s.affixes.map(affixLabel).join(", ")) : "bonus active";
    const pieces = s.members.length
      ? `<div class="set-via">pieces: ${esc(s.members.map(Proj.setMemberLabel).join(", "))}</div>`
      : `<div class="set-via muted">no contributing piece reported for this set</div>`;
    return `<li class="set-card"><strong>${esc(s.set)}</strong> <span class="meta">${esc(s.pieces)} pieces</span><div class="set-grants">${grants}</div>${pieces}</li>`;
  }).join("");
  // Set-like bonuses (U8): active non-set solar/lunar-family augment bonuses that
  // occupy their own channels and compete with completing a set. A transparency
  // listing on the Set Bonuses tab — NOT a set-vs-augment comparison or near-miss.
  const setLike = (build.augmentsPlaced || [])
    .map((a) => ({ a, ls: Proj.lunarSolar(a) }))
    .filter((x) => x.ls)
    .map((x) => {
      // Prefer the affixes the placement record now carries; fall back to the
      // catalog by variant_id so a build SAVED BEFORE that fix (its stored
      // `augmentsPlaced` predates the field) still names its numbers on reload.
      // Same augById the paperdoll uses, so the two surfaces can't disagree.
      const from = (x.a.affixes && x.a.affixes.length)
        ? x.a.affixes
        : ((augById.get(x.a.variant_id) || {}).affixes || []);
      const eff = from.length ? esc(from.map(affixLabel).join(", ")) : "";
      const glyph = x.ls === "Lunar" ? "🌙" : "☀️";
      return `<li class="set-card setlike"><strong>${glyph} ${esc(x.ls)}</strong> <span class="meta">${esc(x.a.variant_id)}</span>${eff ? `<div class="set-grants">${eff}</div>` : ""}</li>`;
    }).join("");

  let setsPanel = activeSets
    ? `<ul class="sets">${activeSets}</ul>`
    : `<p class="dd-none muted">No set bonuses are active for this build.</p>`;
  if (setLike) {
    setsPanel += `<h3 class="setlike-h" title="non-set bonuses that occupy their own channels">Other set-like bonuses (compete with sets)</h3><ul class="sets setlike-list">${setLike}</ul>`;
  }
  // #340 — bundled enchantments (third block): each engraved multi-stat bundle
  // on the equipped loadout, named once with its members and carrier.
  setsPanel += bundlesBlock(build, augById);

  return { paperdoll: `<div class="pd-list">${rows.join("")}</div>`, weapons, cards: cardsHtml, setsPanel, deepDive: loadoutDeepDive(build, query, maps, attr) };
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
  module.exports = { renderResults, buildViews, bundlesBlock, utilityCard, renderAltCards, affixLabel, assignAugments, assignDinoInserts, satisfiedSets, slotSetNames, satisfiedSetDetail, attributionByTarget, whyThis, itemContributions, saturatedStats, saturationLineFor, whyThisLine, activeSetDetail, attributionList, coverageNote, slotPosition, paperdollSlot, equippedRow, equippedBody, artifactNotice, artifactNoticeEntries, artifactsIncludedByPin, boundNotice, boundNoticeEntries, zeroSourceNotice, zeroSourceNoticeEntries, outbidNotice, outbidTargets, saturationNotice, staleSnapshotNotice, ceilingChip, emptySlotNotice, absorptionQuarantineNotice, craftingExcludedNotice, augCeilingNotice, blockNotice, incidentalStats, poolStatNames: _resultsPoolStatNames, craftChips, craftSlotChips, loadoutDeepDive, esc, safeUrl };
}
