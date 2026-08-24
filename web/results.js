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
// `equippedBody` runs against the LIVE solve result and has no
// saved record, so they cannot reach the collapse through `Proj.project(rec)`;
// they call the same primitive that builds the content model instead.
const collapseExpansions = Proj.collapseExpansions;
const assignAugments = Proj.assignAugments;
const assignDinoInserts = Proj.assignDinoInserts;
const attributionByTarget = Proj.attributionByTarget;
const whyThis = Proj.whyThis;
var itemContributions = Proj.itemContributions;
// #449 U4 — `saturatedStats` has no caller left in this file: its only one was
// the per-item ceiling marker. The binding stays because it is re-exported
// below, and `tests/projection.test.js` pins that surface against projection's.
// `saturationLineFor` still has a live caller in `ceilingChip`, the old-save
// fallback. Delete either and the parity test turns red, not the renderer.
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
// Used by the Loadout card so every applied bonus is visible. Returns an array.
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

// #472 — `craftSlotChips` and `craftChips` are retired. They rendered this
// item's crafts, augments, wildcard, membership and Set Augment as a run of
// labelled chips, and were the LAST caller of the chip language on an item
// surface: #471 moved the gear card to rows, and #472 moved the Deep Dive — their
// only other consumer — onto the same `augmentSection` / `craftSection` /
// `setMembershipSection`. #498 then retired that tab, leaving the card as the
// single item surface and these three as its only renderers.
//
// What they uniquely knew is preserved, not deleted:
//   - the split labels live in `Proj.craftRowLabel`, beside `craftLabel`;
//   - the Vecna-vs-Dino membership fork still reads the CraftingSystems
//     registry (KTD2), now inside that function, so "Awaken" stays correct for
//     exactly one system;
//   - `Proj.unfilledVikSlots` still supplies the declared-but-empty slots
//     (#370), now via `craftRowsFor`;
//   - the Set Augment's solver-decided host and its once-per-host suppression
//     note still come from `setAugmentsPlaced[].host` (KTD-6), now via
//     `setRowsFor`.

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
// Full affixes/crafts live in the gear card below the doll, not on the cell.
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
  const ctl = `<button class="pd-ctl" data-slot="${esc(label)}" title="constrain this slot" aria-label="constrain ${esc(label)}">&#9881;</button>`;
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
  // #469 — the DISPLAYED name drops the `(level N)` disambiguator when it merely
  // restates the ML this header already carries two lines down. The full
  // `variant_id` stays the row's identity: it is what `data-variant` pins and
  // blocks on below, what the `title` shows on hover, and what every export
  // prints. See `Proj.displayItemName` for why the equality test is the guard.
  const name = locked ? "locked empty" : (v ? esc(Proj.displayItemName(v)) : "empty");
  const nameCls = (!v || locked) ? "pd-rname muted" : "pd-rname";
  // #469 — the header's meta line, rendered on EVERY row so the three header
  // lines (slot, name, meta) sit at the same height on every card in the grid.
  // It was `pd-rfoot`, emitted only for an occupied row; an empty slot then had a
  // two-line header beside its neighbour's three and the two cards' bodies
  // started at different heights. The status badges move up here from the bottom
  // of the card: "pinned" / "locked empty" / "Artifact" describe the slot, not
  // the notes, and leaving them below the craft chips put the card's identity
  // after its detail.
  const mlChip = (v && !locked) ? `<span class="pd-rml">ML ${esc(itemMl(v) ?? "?")}</span>` : "";
  const meta = `<div class="pd-rmeta">${mlChip}${setLine}${artifactBadge}${badge}</div>`;
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
    // #471 — one note family. `pd-rnote` is kept as a second class so the two
    // tests that read it (and any selector that did) still resolve; the
    // presentation comes from `pd-note`, which every foot note now shares.
    reasonNote = `<div class="pd-note pd-rnote is-empty"><span class="pd-note-ico" aria-hidden="true">◇</span><span>${esc(reason)}</span></div>`;
  }
  // U9/U2: per-item stats + assigned augments (with their affixes) + assigned
  // craft slots, shown uniformly on every occupied block (empty blocks stay the
  // same height via the grid stretch + the .pd-row min-height). Assignment data
  // comes from `maps` (keyed by the pick's chosen index); `augById` resolves an
  // augment's affixes by variant_id (the placed meta carries none).
  // #453 U2 (KTD2) — `prioCtx` was already here for the per-item note below;
  // the chips derive "tracked" from the same source rather than a second one.
  const body = (v && !locked) ? equippedBody(v, pick ? pick.idx : -1, maps, augById, owned.mode, owned.augments, prioCtx) : "";
  // #262 — the no-drop-source note on the gear box itself: the moment of seeing
  // the pick is where the player must learn it, not at the wiki after farming.
  // Same shared wording as every export (projection.js).
  const noDropNote = (v && !locked && v.no_drop_source)
    ? `<div class="pd-note pd-rnote pd-nodrop is-source" title="the DDO wiki records no current in-game source for this item — it stays a solver candidate; block it to exclude it"><span class="pd-note-ico" aria-hidden="true">⌖</span><span>${Proj.NO_DROP_SOURCE_WORDING}</span></div>` : "";
  // U3 (plan 2026-08-12-001) — the priority summary sits at the bottom of the
  // box, outside `.pd-rbody` so equippedBody's emptiness guard cannot swallow it.
  // #455 — `pd-prio` is retired. It was a second chip family restating 62% of
  // the stat row (measured, ML34 solve, 21 of 34 chips), and its only unique
  // content — set- and craft-sourced contributions — is now chipped in the row
  // itself. Its two non-chip statements — the #245 craft-carried line and the
  // empty-state — live on in `whyThisNote`; the renderer itself went in #476.
  const prio = (v && !locked && prioCtx && prioCtx.result)
    ? whyThisNote(prioCtx.result, { slot: label, variant_id: v.variant_id }, prioCtx.attr, prioCtx.targets)
    : "";
  const rowCls = `pd-row ${(!v || locked) ? "empty" : "occupied"}${glow ? " is-set" : ""}${isArtifact ? " is-artifact" : ""}${(rowPinned || locked) ? " constrained" : ""}`;
  // #469 — three named regions, in a fixed order, on every card whatever it
  // carries: HEAD (slot, name, ML + status), BODY (the stats / augments / craft
  // sections), FOOT (the notes). The parts were all here already, interleaved as
  // one flat run of siblings — `${foot}${reasonNote}${noDropNote}${body}${prio}`
  // — so a card's notes landed above its stats or below its craft chips
  // depending only on which of them happened to be non-empty, and two cards side
  // by side put the same kind of fact in different places. The regions are what
  // let the CSS pin the head to a fixed height and the notes to the bottom edge,
  // which is what makes a grid row of cards line up rather than merely share a
  // border. `pd-card-foot` is deliberately NOT `pd-rnote*`: that name means "one
  // note" and is matched as such.
  // #471 — the owned-mode disclosure moves out of `pd-rbody` and joins the other
  // three here, so the foot is ONE uniform note family stacked in a fixed order
  // rather than three shapes in two places.
  const rec = (v && !locked)
    ? recNote(owned.mode, owned.augments, hasAugmentSlots(pick ? pick.idx : -1, maps),
        craftRowsFor(v, pick ? pick.idx : -1, maps).length > 0)
    : "";
  const notes = `${reasonNote}${noDropNote}${rec}${prio}`;
  return `<div class="${rowCls}">
    <div class="pd-card-head">
      <div class="pd-rtop"><div class="pd-rlabel">${esc(label)}</div>${ctl}</div>
      <div class="${nameCls}"${v ? ` title="${esc(v.variant_id)}"` : ""}>${name}</div>
      ${meta}
    </div>
    ${body || `<div class="pd-rbody"></div>`}
    <div class="pd-card-foot">${notes}</div>
    ${menu}
  </div>`;
}

/** #453 U2 / #455 — this solve's credited contributions for one item, indexed.
 *
 *  Derived from `itemContributions`, the same function the per-item note reads.
 *  That is the point: deriving "tracked" twice from two sources is how the
 *  card's surfaces come to disagree about what the solver was steering toward.
 *  `prioCtx` is already threaded to `equippedRow`, so this costs one parameter
 *  rather than a new data path.
 *
 *  Deliberately NOT "the stat appears in `targets`". A ranked stat whose bucket
 *  lost to a larger contributor was not credited and is not why this item is
 *  here; claiming otherwise on the chip would make the vivid treatment a lie.
 *  That fact is a solve-level one and `outbidNotice` already names it.
 *
 *  #455 — `byStat` is new. Retiring `pd-prio` moved three qualifiers onto the
 *  chips, and every one of them lives on the CONTRIBUTION, not on the affix:
 *  `(from <stat>)` cross-add, the #88 override disclosure, and `(set)`. Without
 *  the index a chip can say a stat is tracked but not why, and the #88
 *  disclosure would be the thing lost — it exists precisely so a gear box does
 *  not state a bonus type as though the wiki said so. */
function itemContribIndex(prioCtx, variantId) {
  const keys = new Set(), byStat = new Map();
  // #472 — the SETS this item was actually credited through, by name. A "go
  // awaken this set" row is an instruction whose product is set membership, and
  // this is what tells it apart from one that serves nothing the player ranked.
  const creditedSets = new Set();
  if (!prioCtx || !prioCtx.result || !variantId) {
    return { keys, byStat, list: [], creditedSets };
  }
  const list = itemContributions(
    prioCtx.result, { variant_id: variantId }, prioCtx.attr, prioCtx.targets);
  for (const c of list) {
    if (c.viaSet && c.source) creditedSets.add(c.source);
    if (c.stat != null) { keys.add(c.stat); if (!byStat.has(c.stat)) byStat.set(c.stat, c); }
    // The collapsed entry is keyed by `via`, so the enchantment name has to be
    // in the set too or a collapsed bundle never matches (#453 KTD1).
    if (c.via != null) { keys.add(c.via); if (!byStat.has(c.via)) byStat.set(c.via, c); }
  }
  return { keys, byStat, list, creditedSets };
}

/** #453 U2 (KTD3) / #469 — one of FOUR classes, tested in this order.
 *
 *  tracked -> ranked -> utility -> incidental, and the order is load-bearing: a
 *  presence affix the player explicitly ranked is a reason the item was picked,
 *  not a bonus that came along with it, so it must not fall into the utility
 *  bucket.
 *
 *  #469 splits what used to be one question into the two questions it always
 *  was. `tracked` means CREDITED — this stat is why the solver put the item
 *  here. `ranked` means the stat is NAMED IN THE PRIORITY LIST but its points
 *  lost their bucket to a larger contributor elsewhere in the build. Before
 *  this, a ranked-but-outbid stat rendered identically to an affix the player
 *  never asked about, so a card carrying `Melee Power +10` against a #1 Melee
 *  Power priority read as unrelated to the priority list.
 *
 *  They stay two classes rather than one. #453's doc-comment for `tracked` is
 *  unchanged and still true: claiming an outbid stat is why the item is here
 *  would make the vivid treatment a lie. So `ranked` is the weaker treatment —
 *  framed and legible, not filled and bold — and `tracked` keeps its meaning
 *  exactly. `ranked` is empty for any caller that was not told what the player
 *  ranked, so a context-free render still claims nothing. */
function affixChipClass(entry, cover, tracked, ranked) {
  ranked = ranked || _EMPTY_SET;
  const key = Proj.affixCoverageKey(entry);
  const e = (cover && cover.get(key)) || null;
  const stats = e ? e.stats : [];
  if (key != null && tracked.has(key)) return "tracked";
  for (const n of stats) if (tracked.has(n)) return "tracked";
  if (key != null && ranked.has(key)) return "ranked";
  for (const n of stats) if (ranked.has(n)) return "ranked";
  // Read presence off the COVERAGE, not the entry: a collapsed entry carries no
  // bonus type, so `_isPresence` on it is false however presence-typed its
  // members are.
  if ((e && e.presence) || _isPresence(entry)) return "utility";
  return "incidental";
}
const _EMPTY_SET = new Set();

/** #469 — the stats the player actually ranked, as a lookup set.
 *
 *  Read off `prioCtx.targets`, which is `query.targets` — the priority list
 *  itself, not the solve's attribution. The Utility sentinel is dropped: it is
 *  not a stat, nothing on an item is named after it, and the utility class
 *  already carries what it means. Absent context returns an EMPTY set rather
 *  than a permissive one, so a caller with no priority list highlights nothing. */
function rankedStatSet(prioCtx) {
  const targets = (prioCtx && prioCtx.targets) || [];
  return new Set(targets.filter((t) => t !== _UTILITY_SENTINEL));
}

/** #469 — the priority link a WRAPPER inherits from what it grants.
 *
 *  A craft chip ("Slot Melancholic Viktranium augment") and an augment row
 *  ("Solar Gem of Attack") are instructions, not stats — the stats they yield
 *  are chipped separately. Without this the two surfaces the player is sent to
 *  ACT on were the only ones with no link back to the priority list: every
 *  augment and every craft step looked equally worth doing. Returns the
 *  strongest class any of its affixes earns, so a gem granting one tracked stat
 *  among five reads as the one to go slot. */
function grantLinkClass(affixes, contribIdx, ranked) {
  const list = affixes || [];
  if (!list.length) return "";
  const cover = Proj.affixStatCoverage(list);
  const keys = (contribIdx && contribIdx.keys) || _EMPTY_SET;
  let best = "";
  for (const a of list) {
    const cls = affixChipClass(a, cover, keys, ranked);
    if (cls === "tracked") return " is-tracked";
    if (cls === "ranked") best = " is-ranked";
  }
  return best;
}

/** #453 U4 (R9/R10/KTD4) — how many INCIDENTAL chips show at rest.
 *
 *  Measured, not chosen. Grouping the built dataset by `via` exactly as
 *  `collapseExpansions` does, the ML 29-36 band (2,668 records) post-collapse
 *  runs median 4, mean 4.19, max 11 — the collapse is what takes the worst case
 *  from 43 down to 11. A cap of 6 leaves 92.1% of that band showing everything
 *  at rest; 5 leaves 76.1%, 7 leaves 97.8%. Six is the knee.
 *
 *  It bounds INCIDENTAL chips only. Capping the total would hide tracked chips
 *  on exactly the items where they matter most, which R10 forbids. */
const INCIDENTAL_CHIP_CAP = 6;

/** #455 — the qualifiers a chip inherits from its contribution.
 *
 *  All three moved here when `pd-prio` was retired. The #88 override is the one
 *  that must not be dropped: it shipped because a gear box stating a bonus type
 *  without it "states a bonus type as though the wiki said so", and that claim
 *  is exactly as false on a chip as it was on the old row. */
function chipQualifiers(contrib) {
  if (!contrib) return "";
  const bits = [];
  // #471 — the `(set)` qualifier is retired for the same reason `pd-src` is: the
  // row's WHERE column already reads "set" on exactly these rows. The two
  // qualifiers below stay, and the #88 one is the load-bearing case — it is the
  // one fact on the card that is NOT the wiki's, and nothing else states it.
  if (contrib.crossAdd) {
    bits.push(`<span class="pd-q pd-q-from" title="${esc(contrib.crossAdd)} fully stacks with this stat — its value adds on top of the stat's own bonuses, so it is counted here.">from ${esc(contrib.crossAdd)}</span>`);
  }
  if (contrib.overriddenFrom) {
    bits.push(`<span class="pd-q pd-q-override" title="You told the optimizer this carries ${esc(contrib.bonus_type)} in game; the catalog records ${esc(contrib.overriddenFrom)}. It is counted in the ${esc(contrib.bonus_type)} bucket on your word, not the wiki's.">your call — catalog says ${esc(contrib.overriddenFrom)}</span>`);
  }
  return bits.length ? `<span class="pd-chip-q">${bits.join("")}</span>` : "";
}

/** #453 U2/U4 (R1/R9/R10) + #455 — the one stat row for an equipped item.
 *
 *  #455 made this the SINGLE stat surface. It was one of two: a chip row for
 *  printed affixes and a separate `pd-prio` row for ranked contributions, and
 *  measured on an ML34 solve 21 of 34 `pd-prio` chips (62%) restated a chip
 *  already in this row. The 13 that did not were exactly the set-sourced and
 *  craft-sourced contributions — which is why retiring that row and chipping
 *  those two sources here is one change and not two.
 *
 *  `entries` is `{ affix, source }`, where source is null for a printed affix
 *  and "set" / "craft" otherwise. Provenance is a TAG rather than a fourth
 *  class: the three classes answer "did I ask for this", the tag answers "where
 *  does it come from", and collapsing two orthogonal questions into one visual
 *  axis is what made the card unreadable in the first place. */
function statChipRow(entries, cover, idx, rank1, ranked) {
  const rows = entries.map((e) => ({
    a: e.affix, source: e.source || null,
    cls: affixChipClass(e.affix, cover, idx.keys, ranked),
  }));
  let seen = 0;
  return rows.map(({ a, cls, source }) => {
    // #469 — the cap still bounds INCIDENTAL chips only, and `ranked` is not
    // incidental: a stat the player named is never the thing collapsed away.
    const over = cls === "incidental" && ++seen > INCIDENTAL_CHIP_CAP;
    const key = Proj.affixCoverageKey(a);
    const contrib = cls === "tracked" ? idx.byStat.get(key) : null;
    // #449 R21 — the rank-1 accent survives the move off `pd-prio`. Matched on
    // the contribution's own stat so a collapsed bundle credited through `via`
    // still lights up.
    // #469 — a rank-1 stat that is on the list but was outbid gets the accent
    // too. It has no contribution to match on, so it matches on the key.
    // #471 — the `pd-src` pill is retired. It named the provenance ("set" /
    // "craft") in a coloured pill AT THE END of the chip; the row language now
    // names it in the WHERE column at the start of every row, which is the
    // column that exists for exactly this fact. Keeping both would print the
    // same word twice on one row — the redundancy #455 removed between
    // `pd-prio` and the stat row, rebuilt inside a single line.
    // #469 — the ranked chip says WHY it is framed but not filled, or the
    // treatment reads as an unexplained second shade of the tracked one.
    const why = cls === "ranked"
      ? "On your priority list — but a larger source elsewhere in this build already fills its bonus-type bucket, so these points are not what the solver credited this item for." : "";
    // #471 — the WHERE column. `source` is the provenance tag #455 introduced;
    // absent it, the affix is printed on the item itself.
    const where = source || "item";
    return stackLine(cls, where,
      `${esc(affixLabel(a, { mark: false }))}${chipQualifiers(contrib)}`,
      // No `rank1`: a row's appearance must not depend on how high its stat sits
      // in the list. The #1 priority used to take a glow (and, before that, a
      // hue) on its marker.
      { overflow: over, title: why });
  }).join("") + overflowToggle(rows);
}

/** #471 — the attribution channels the Loadout card states IN PLACE rather than
 *  in its Stats section. Keys are `sourceKind` on an `itemContributions` row;
 *  the values are the solver's own channel names (projection.js
 *  `CRAFT_FAMILY_LABEL` plus `roll`, which is native-but-chosen). `worn`, `set`
 *  and `declared` are deliberately absent — those have no slot of their own to
 *  be stated beside, so Stats is where they belong. */
const CRAFT_SOURCE_KINDS = new Set(["vik", "seal", "nc", "dino", "tf", "gs", "roll", "augment"]);

/** The card's marker vocabulary: TWO states, and only two.
 *
 *  ON  — a filled diamond, and the row's text bold white.
 *  OFF — a hollow diamond, and the row's text left normal.
 *
 *  ON means the affix is doing something in this build: credited to a ranked
 *  priority, or a utility effect the build secures. Everything else is OFF —
 *  including a stat that IS on the priority list but lost its bucket to a larger
 *  source, which is not doing anything however high it was ranked.
 *
 *  There was a four-step ramp here (filled / hollow / ring / dot) with three text
 *  treatments, which made a row's appearance a function of how high in the
 *  priority list its stat sat. The maintainer ruled that out twice, in these
 *  words: "these little indicators have 2 conditions, off and on". The immediate
 *  symptom was a False Life row on Legendary Hyena Claw Necklace showing a HOLLOW
 *  diamond beside FULL-WHITE text — `ranked` took `#fff` without the weight, so
 *  the mark said off and the text said on.
 *
 *  #469 is what the ramp existed for: a ranked-but-outbid stat rendering
 *  identically to one the player never asked about made a `Melee Power +10`
 *  against a #1 Melee Power priority read as unrelated to the list. That fact is
 *  NOT lost — it rides the row's `title` ("On your priority list — but a larger
 *  source elsewhere…"), which is where the explanation always lived. What is gone
 *  is a second visual shade for it, which is what was asked for.
 *
 *  The four class names survive because they carry a real distinction downstream
 *  (`ranked` earns the tooltip; `utility` reads presence off the coverage). Only
 *  their RENDERING collapses to two. */
const LINE_MARK = { tracked: "◆", ranked: "◇", utility: "◆", incidental: "◇" };

/** #471 — one row of the card's shared row language.
 *
 *  Every fact on the card is the same three columns — a marker, WHERE the fact
 *  comes from, and WHAT it gives — whether it is a printed affix, a set bonus,
 *  an augment or a craft. That is the whole change from the chip families this
 *  replaced: three visual languages (stat pills, augment pips, craft pills)
 *  became one, and the sections differ only in what fills the middle column.
 *
 *  `cls` is the priority class; `mark` overrides the glyph (the augment section
 *  uses the Sun/Moon symbols there). `title` is optional and rides the row. */
function stackLine(cls, where, what, opts) {
  opts = opts || {};
  const extra = `${opts.rank1 ? " is-rank1" : ""}${opts.overflow ? " is-overflow" : ""}${opts.cls ? " " + opts.cls : ""}`;
  const mark = opts.mark != null ? opts.mark : (LINE_MARK[cls] || LINE_MARK.incidental);
  const markCls = opts.markCls ? ` ${opts.markCls}` : "";
  return `<li class="pd-line is-${cls}${extra}"${opts.title ? ` title="${esc(opts.title)}"` : ""}>`
    + `<span class="pd-ln-mark${markCls}" aria-hidden="true">${mark}</span>`
    + `<span class="pd-ln-where">${esc(where)}</span>`
    + `<span class="pd-ln-what">${what}</span></li>`;
}

/** #471 — the class a wrapper's own affixes earn, as a bare class name.
 *  `grantLinkClass` answers the same question for a chip and returns a CSS
 *  fragment (" is-tracked"); the row language needs the word. */
function grantClass(affixes, contribIdx, ranked) {
  const link = grantLinkClass(affixes, contribIdx, ranked);
  return link === " is-tracked" ? "tracked" : link === " is-ranked" ? "ranked" : "incidental";
}

/** #471 — the affixes a gem or craft grants, indented under it.
 *
 *  NOT collapsed: augment affixes are never collapsed
 *  anywhere in the app, because the collapse changes what the player compares
 *  against the in-game tooltip. */
function subLines(affixes, contribIdx, rank1, ranked) {
  const list = affixes || [];
  if (!list.length) return "";
  const cover = Proj.affixStatCoverage(list);
  return `<ul class="pd-sub">${list.map((a) => {
    const cls = affixChipClass(a, cover, contribIdx.keys, ranked);
    const key = Proj.affixCoverageKey(a);
    return `<li class="is-${cls}">${esc(affixLabel(a, { mark: false }))}</li>`;
  }).join("")}</ul>`;
}

/** #453 U4 (R9) — the in-place expander, emitted only when something is hidden. */
function overflowToggle(rows) {
  const hidden = rows.filter((r) => r.cls === "incidental").length - INCIDENTAL_CHIP_CAP;
  return hidden > 0
    ? `<li class="pd-line pd-stat-more"><span class="pd-ln-mark" aria-hidden="true"></span>`
      + `<span class="pd-ln-where"></span><span class="pd-ln-what">`
      + `<button type="button" class="pd-more-btn" data-statmore aria-expanded="false">+${hidden} more</button>`
      + `</span></li>` : "";
}

/** #455 — every stat an equipped item yields, from all three sources, as chip
 *  entries in ONE list so the row can classify and collapse them together.
 *
 *  Printed affixes and craft-granted affixes are collapsed TOGETHER rather than
 *  separately: one enchantment split across a printed affix and a craft would
 *  otherwise collapse twice under the same `via` key and render as two chips
 *  claiming to be the same bundle.
 *
 *  Set contributions are synthesized from the contribution itself — they have no
 *  affix record on the item, which is exactly why `pd-prio` was the only place
 *  they appeared. */
function statChipEntries(v, idx2, maps, contribIdx, craftStated) {
  // #471/#472 — `craftStated` says the caller renders a Craft section, in which
  // every craft states its own affix beside the slot that yields it. When it
  // does, carrying those affixes here as well prints the same point twice.
  //
  // It is a QUESTION ABOUT THE CALLER, not a preference, which is why it is
  // computed (`craftRowsFor(...).length > 0`) rather than chosen. Defaulting it
  // to false is the safe direction: a caller with no craft section — the pure
  // test callers, and any future one — keeps every credited point visible here
  // rather than dropping it into a section that does not exist.
  craftStated = !!craftStated;
  const printed = (v.affixes || []).map((a) => [a, null]);
  const crafted = [];
  if (!craftStated && maps && idx2 != null && idx2 >= 0) {
    const take = (arr) => { for (const o of arr || []) for (const a of Proj.craftAffixRecords(o)) crafted.push([a, "craft"]); };
    take(maps.dinoAssign && maps.dinoAssign.byIndex && maps.dinoAssign.byIndex.get(idx2));
    take(maps.ncByItem && maps.ncByItem.get(v.variant_id));
    take(maps.rollByItem && maps.rollByItem.get(v.variant_id));
    take(maps.vikByItem && maps.vikByItem.get(v.variant_id));
    take(maps.sealByItem && maps.sealByItem.get(v.variant_id));
    take(maps.tfByItem && maps.tfByItem.get(v.variant_id));
    take(maps.gsByItem && maps.gsByItem.get(v.variant_id));
  }
  const raw = [...printed, ...crafted];
  const sourceOf = new Map();
  for (const [a, src] of raw) if (src) sourceOf.set(a, src);
  const collapsed = collapseExpansions(raw.map(([a]) => a));
  const entries = collapsed.map((entry) => {
    // A collapsed group takes its source from any crafted member; `members` is
    // not retained on the collapsed entry, so resolve through the raw list by
    // the same key the collapse filed it under.
    // `affixCoverageKey` resolves a RAW affix to the same key the collapse filed
    // it under (`via`, else its own name), which is exactly the join needed
    // here. Reaching for the raw `via` field instead would need
    // `Proj.PROVENANCE_KEY`, which is module-private — the lookup would silently
    // read `undefined`, fall through to the name, and mis-source every collapsed
    // craft bundle.
    const key = Proj.affixCoverageKey(entry);
    const src = raw.some(([a, s]) => s === "craft" && Proj.affixCoverageKey(a) === key) ? "craft" : null;
    return { affix: entry, source: src };
  });
  // Set-sourced contributions carry no affix record on the item at all — which
  // is exactly why `pd-prio` was the only surface they ever appeared on.
  for (const c of contribIdx.list) {
    if (!c.viaSet) continue;
    entries.push({ affix: { name: c.stat, stat: c.stat, value: c.value, type: c.bonus_type }, source: "set" });
  }
  // RESIDUAL SWEEP. Every credited contribution must reach a chip. The four
  // source kinds are accounted for above — `worn` by the printed affixes,
  // `seal`/`nc`/`roll`/`vik`/`tf`/`gs` by the craft records (all carry
  // `hostIds: [item]`), `set` by the loop above; an augment's contribution is
  // never credited to its host (`hostIds` is null for that kind) and is chipped
  // under the augment instead. So on real data this adds nothing.
  //
  // It exists because the alternative failure is SILENT: retiring `pd-prio`
  // moved every contribution onto a chip derived from an affix record, and a
  // credited point with no such record would simply vanish from the card with
  // nothing to notice it. A visible chip beats an invisible gap. Proven
  // non-vacuous by the legacy-shaped fixture in tests/results.test.js, and
  // asserted to fire zero times against a real solve.
  // `covered` must hold the MEMBER stat names, not just each entry's key. A
  // collapsed bundle is filed under its enchantment (`via`) while the
  // contribution names the member stat, so keying on the entry alone would make
  // every collapsed bundle look uncovered and chip it twice.
  const cover = Proj.affixStatCoverage(raw.map(([a]) => a));
  const covered = new Set();
  for (const e of entries) {
    const key = Proj.affixCoverageKey(e.affix);
    covered.add(key);
    for (const n of ((cover.get(key) || {}).stats || [])) covered.add(n);
  }
  for (const c of contribIdx.list) {
    if (c.viaSet || c.stat == null || covered.has(c.stat)) continue;
    // #471 — with the craft affixes deliberately excluded above, EVERY crafted
    // point is uncovered here, and the sweep would faithfully re-add all of them
    // to the Stats section — restoring the duplication in a form no test that
    // reads the craft list would catch. The sweep's job is "a credited point
    // that reaches no row at all"; a point the Craft section states in place has
    // a row, so it is not residual. Augment-granted points never reach this list
    // (`hostIds` is null for that kind) but are named for the same reason.
    if (craftStated && CRAFT_SOURCE_KINDS.has(c.sourceKind)) continue;
    covered.add(c.stat);
    entries.push({ affix: { name: c.stat, stat: c.stat, value: c.value, type: c.bonus_type }, source: null });
  }
  return { entries, raw: raw.map(([a]) => a) };
}

// The stats / augment / craft body of an equipped block. Projects the variant's
// own affixes, then the augments actually slotted (with the affixes they add,
// resolved by variant_id via `augById`) alongside any still-open augment slots,
// and the item's assigned craft-upgrade slots (U2). `maps` (and the pick's `idx`)
// are always supplied on the render path (buildViews -> equippedRow); a maps-less
// call (only the pure test callers) simply renders no augment/craft section.
function equippedBody(v, idx, maps, augById, ownedMode, ownedAugments, prioCtx) {
  // U8/R8 — the Loadout block collapses each expansion to its enchantment because
  // that is what the player compares against the in-game tooltip.
  // #455 — ONE stat surface. Printed affixes, craft-granted affixes and
  // set-sourced contributions all become chips in the same row; `pd-prio` is
  // retired rather than left beside it restating 62% of what it says.
  const contribIdx = itemContribIndex(prioCtx, v.variant_id);
  // #471 — craft-granted affixes are EXCLUDED whenever the Craft section below
  // will state them in place, beside the slot that yields them; carrying them
  // here as well put `Melee Power +8` twice on one card. Augment-granted affixes
  // were never in this list (never credited to the host) and are stated under
  // their gem.
  const { entries, raw } = statChipEntries(v, idx, maps, contribIdx,
    craftRowsFor(v, idx, maps).length > 0);
  // #453 U2 — classify against the RAW affixes, render from the collapsed ones.
  // The collapse is what makes the card readable and is also what destroys the
  // stat names classification needs, so the two run side by side (KTD1).
  const cover = Proj.affixStatCoverage(raw);
  const rank1 = (prioCtx && prioCtx.targets && prioCtx.targets.length) ? prioCtx.targets[0] : null;
  // #469 — the priority list itself, for the `ranked` chip class.
  const ranked = rankedStatSet(prioCtx);
  // #469 — the stats block is now a NAMED section like the two below it, so the
  // body reads as three labelled parts in a fixed order rather than an unlabelled
  // run of chips with two labelled rows hanging off the bottom.
  const stats = entries.length
    ? `<div class="pd-sec pd-sec-stats"><span class="pd-slabel">Stats</span>`
      + `<ul class="pd-lines">${statChipRow(entries, cover, contribIdx, rank1, ranked)}</ul></div>` : "";

  const augs = augmentSection(v, idx, maps, augById, contribIdx, rank1, ranked);
  const crafts = craftSection(v, idx, maps, contribIdx, rank1, ranked);

  if (!stats && !augs && !crafts) return "";
  return `<div class="pd-rbody">${stats}${augs}${crafts}</div>`;
}

/** #471 — the owned-inventory disclosure, as one of the card's foot notes.
 *
 *  It used to sit INSIDE `pd-rbody`, between the Stats section and the Augments
 *  one, which is why `.pd-sec ~ .pd-sec` had to be a general sibling selector.
 *  It is a statement about the whole pick — "these augments are recommendations,
 *  not your inventory" — which is what the foot is for, and putting it in the
 *  body made it the one note whose position depended on which sections rendered.
 *
 *  R7/AE6 — in owned-inventory mode the base item is yours, but augments and
 *  crafting are RECOMMENDATIONS from the full catalog, not your inventory.
 *  #359 — the wording tracks which pool the augments actually came from. With
 *  the augment restriction ON they are drawn from `owned UNION acquirable`, so
 *  "not owned" would overstate: every augment shown is either in the player's
 *  export or one anyone can buy. Crafting is full-catalog either way, which is
 *  why the restricted wording still says so. */
function recNote(ownedMode, ownedAugments, hasAug, hasCraft) {
  if (!ownedMode || !(hasAug || hasCraft)) return "";
  return ownedAugments
    ? `<div class="pd-note is-owned" title="Augments are limited to your imported inventory plus augments anyone can buy or trade for; crafting still comes from the full catalog"><span class="pd-note-ico" aria-hidden="true">◈</span><span>Owned or buyable${hasCraft ? " · crafting recommended" : ""}</span></div>`
    : `<div class="pd-note is-owned" title="Augments and crafting always come from the full catalog, not your imported inventory"><span class="pd-note-ico" aria-hidden="true">◈</span><span>Recommended (not owned)</span></div>`;
}

/** #471 — the Sun/Moon glyphs, the SAME pair the Set Bonuses tab prints for a
 *  set-like Lunar/Solar bonus. Those two slots belong to a separate gem system
 *  that accepts no standard augment (wiki-ruled), and on the card they were
 *  previously a coloured dot indistinguishable from a Red or a Green one. Two
 *  surfaces naming the same system with different symbols is the drift this
 *  repo files as a defect, so the glyph is shared rather than re-chosen. */
const SUN_MOON_GLYPH = { sun: "☀\uFE0F", moon: "🌙" };

/** #471 — every augment slot the item declares, filled or not, in place.
 *
 *  The open slots were already rendered (AE2) but only as a bare coloured pip
 *  reading "open Blue slot", which said a slot existed and nothing about why it
 *  was not used. Both states are now the same row: marker, colour, and what is
 *  in it — a gem with the stats it grants, or "empty".
 *
 *  The empty wording is SHORT on purpose. "no augment in this colour adds to
 *  your ranked stats" is a full clause, and an item with four open colours spent
 *  eight wrapped lines saying nothing happened four times. The sentence rides
 *  the row's `title`; the row says "empty". */
function augmentSection(v, idx, maps, augById, contribIdx, rank1, ranked) {
  if (!(maps && maps.augAssign && idx != null && idx >= 0)) return "";
  // `freeByIndex` is optional: a caller that never computed the OPEN slots still
  // has placements to show. Pure-test callers have carried that shape since long
  // before this section existed (#472).
  const placed = (maps.augAssign.byIndex && maps.augAssign.byIndex.get(idx)) || [];
  const open = (maps.augAssign.freeByIndex && maps.augAssign.freeByIndex.get(idx)) || [];
  if (!placed.length && !open.length) return "";
  const mark = (color) => SUN_MOON_GLYPH[String(color || "").toLowerCase()] || null;
  const filled = placed.map((p) => {
    const meta = augById && augById.get(p.variant_id);
    // #453 U3 (R6/KD3) — the augment's granted stats stay NESTED under the gem
    // rather than merging into a card-level row. The loadout is a shopping list:
    // "which gem do I actually go slot" has to survive.
    const augAffixes = (meta && meta.affixes) || [];
    const col = String(p.color || "").toLowerCase();
    const where = p.slot_color && p.slot_color !== p.color
      ? `${p.color} in ${p.slot_color} slot` : `${p.color || ""} slot`;
    // #469 — the gem row inherits the strongest class its affixes earn, so the
    // one to go slot is findable without reading every nested line.
    return stackLine(grantClass(augAffixes, contribIdx, ranked), p.color || "—",
      `<span class="aug-name">${esc(p.variant_id)}</span>${subLines(augAffixes, contribIdx, rank1, ranked)}`,
      // A slotted augment is filled like every other live thing on the card, in
      // the one filled colour. The augment's own colour is NOT carried by the
      // marker any more: it is already the row's WHERE column, in words, and a
      // marker that encodes both liveness and colour makes colour look like a
      // priority ranking.
      //
      // Sun/Moon keep their emoji glyphs, and that is a RULING, not an omission.
      // #487 originally asked for outline-when-idle / filled-when-used variants of
      // those two symbols to match the diamond language; the maintainer declined it
      // — an emoji cannot be restyled or hollowed, so honouring it would mean
      // hand-drawing both as inline SVG, and the pair is a distinct gem system that
      // reads fine as itself. Recorded here so a later sweep does not re-raise it.
      { cls: `aug-filled aug-${esc(col)}`, mark: mark(p.color) || "◆",
        markCls: mark(p.color) ? `aug-mark aug-${esc(col)}` : "", title: where });
  });
  const openRows = open.map((c) => {
    const col = String(c).toLowerCase();
    return stackLine("empty", c, "empty", {
      cls: `aug-open aug-${esc(col)}`,
      mark: mark(c) || "◇", markCls: `aug-mark aug-${esc(col)}`,
      title: `open ${c} augment slot — no augment in this colour adds to your ranked stats`,
    });
  });
  return `<div class="pd-sec pd-sec-aug"><span class="pd-slabel">Augments</span>`
    + `<ul class="pd-lines pd-auglist">${filled.join("")}${openRows.join("")}</ul></div>`;
}

/** #471 — the craft rows for one item: every assigned craft across every family,
 *  plus the Viktranium slots the item declares that the solve left empty.
 *
 *  Split out from `craftSection` because `equippedRow` needs to know whether the
 *  section exists before it renders the foot (the owned-mode note only fires
 *  when there is an augment or craft recommendation to qualify), and sniffing
 *  the rendered HTML for a class name would make that note depend on markup. */
function craftRowsFor(v, idx, maps) {
  if (!(maps && idx != null && idx >= 0)) return [];
  const rows = [];
  const push = (arr, family) => { for (const o of arr || []) rows.push({ family, o }); };
  push(maps.dinoAssign && maps.dinoAssign.byIndex && maps.dinoAssign.byIndex.get(idx), "dino");
  push(maps.ncByItem && maps.ncByItem.get(v.variant_id), "nc");
  push(maps.rollByItem && maps.rollByItem.get(v.variant_id), "roll");
  // #370 — a Lamordia slot the item DECLARES but the solve left empty keeps its
  // row. The slot is part of the item's identity: an item that ships with four
  // slots must never read as a three-slot item.
  // #484 — and the filled and empty rows are ONE list in in-game slot order, not
  // two blocks. Sorting each block separately and concatenating them is not the
  // same as sorting the whole, which is how an item with two Melancholic slots
  // came to render `Melancholic, Dolorous, Melancholic` and read as a duplicate.
  for (const r of Proj.vikSlotRows(v, (maps.vikByItem && maps.vikByItem.get(v.variant_id)) || [])) {
    rows.push(r.placement
      ? { family: "vik", o: r.placement }
      : { family: "vikEmpty", o: { slot_type: r.slot_type, category: r.category }, empty: true });
  }
  push(maps.sealByItem && maps.sealByItem.get(v.variant_id), "seal");
  push(maps.tfByItem && maps.tfByItem.get(v.variant_id), "tf");
  push(maps.gsByItem && maps.gsByItem.get(v.variant_id), "gs");
  return rows;
}

/** #472 — the set-membership rows for one item: a wildcard (Gem of Many Facets),
 *  a chosen membership (Vecna "Awaken" / Isle-of-Dread "Set Bonus"), and any
 *  solver-placed Set Augment hosted here.
 *
 *  These three were the open question on #472. They are not a slot with a stat
 *  in it — they wrap a SET — so it was not obvious what the row's middle column
 *  should say. It turns out they have the same shape one level up: the WHERE is
 *  the mechanism you go and use, the WHAT is the membership you get for it.
 *
 *  They earn their own section rather than joining Craft, because the thing they
 *  yield is a different kind: a set, whose points are credited to the whole
 *  build, not an affix on this item. And they earn a place at all — even though
 *  the `Part of set:` line above already names the set — because that line says
 *  you ARE in the set and says nothing about the trip to the station that puts
 *  you there. The set line is state; these are instructions. */
function setRowsFor(v, maps) {
  if (!maps) return [];
  const rows = [];
  for (const j of (maps.jokerByHost && maps.jokerByHost.get(v.variant_id)) || []) {
    rows.push({ family: "joker", o: j, set: j.set });
  }
  for (const m of (maps.membershipByHost && maps.membershipByHost.get(v.variant_id)) || []) {
    rows.push({ family: "membership", o: m, set: m.set });
  }
  // U7 (KTD-6) — attributed to the solver-DECIDED host, read from
  // setAugmentsPlaced[].host, never greedily reconstructed. Only the FIRST copy
  // on a host carries the suppression note: a host suppresses its own set once.
  ((maps.setAugByHost && maps.setAugByHost.get(v.variant_id)) || []).forEach((sa, i) => {
    rows.push({ family: "augmentset", set: sa.set,
      o: { set: sa.set, slot_color: sa.slot_color, suppresses: i === 0 ? slotSetNames(v) : [] } });
  });
  return rows;
}

function setMembershipSection(v, maps, contribIdx) {
  const rows = setRowsFor(v, maps);
  if (!rows.length) return "";
  const credited = (contribIdx && contribIdx.creditedSets) || _EMPTY_SET;
  const lines = rows.map((r) => {
    const parts = Proj.craftRowLabel(r.o, r.family);
    // Matched on the SET NAME, not on "this item has some set contribution":
    // an item feeding two sets and credited for one of them must not light up
    // the row for the other. That is the same rule `tracked` has carried since
    // #453 — the vivid treatment says "this is why the item is here", and it has
    // to be true of the row it is drawn on.
    const cls = credited.has(r.set) ? "tracked" : "incidental";
    // The STATION stays visible, not just on hover. It is the one part of a
    // membership row the player has to act on — "awaken this set" is useless
    // without "at the Cannith Repurposing Station" — and the chip this replaced
    // printed it. `craftRowLabel` returns plain text for every caller, so the
    // markup for it belongs here rather than inside the label.
    const station = (r.family === "membership" && r.o.station)
      ? ` <span class="muted">· ${esc(r.o.station)}</span>` : "";
    // Same blanking rule the Craft section uses: a family whose mechanism has no
    // name distinct from its system returns the system as its `where`, and the
    // value column already carries it. A membership row is exactly that case —
    // its value IS the registry's action label, which names the system and the
    // set — and "Dinosaur Bone Set Bonus" in a 6.7em uppercase column truncates
    // to "DINOSAUR B…", which is worse than saying nothing.
    const where = parts.where === parts.system ? "" : parts.where;
    return stackLine(cls, where, `${esc(parts.what)}${station}`, {
      cls: `pd-set-line set-${esc(r.family)}`, title: parts.title,
    });
  });
  return `<div class="pd-sec pd-sec-sets"><span class="pd-slabel">Set membership</span>`
    + `<ul class="pd-lines pd-setlist">${lines.join("")}</ul></div>`;
}

/** #471 — does this item declare any augment slot at all, filled or open? */
function hasAugmentSlots(idx, maps) {
  if (!(maps && maps.augAssign && idx != null && idx >= 0)) return false;
  return !!(((maps.augAssign.byIndex && maps.augAssign.byIndex.get(idx)) || []).length
    || ((maps.augAssign.freeByIndex && maps.augAssign.freeByIndex.get(idx)) || []).length);
}

/** #471 — every craft slot on the item, filled or not, with the affix it applies
 *  stated beside it.
 *
 *  This is the section that made de-duplicating Stats possible: before it, a
 *  craft row was an instruction with no value ("Slot Dolorous Viktranium
 *  augment") and the value lived only in the Stats section, so the two had to be
 *  read together. Now the row carries both, and Stats carries neither.
 *
 *  The caption names the crafting system when every row on the item belongs to
 *  one — which is the overwhelmingly common case, and it is what tells the
 *  player which station to walk to. A mixed-family item says just "Craft":
 *  naming one of two systems above rows from both would be false. */
function craftSection(v, idx, maps, contribIdx, rank1, ranked) {
  const rows = craftRowsFor(v, idx, maps);
  if (!rows.length) return "";
  const parted = rows.map((r) => ({ r, parts: Proj.craftRowLabel(r.o, r.family) }));
  const systems = new Set(parted.map(({ parts }) => parts.system).filter(Boolean));
  const one = systems.size === 1 ? [...systems][0] : null;
  const lines = parted.map(({ r, parts }) => {
    const cls = r.empty ? "empty" : grantClass(Proj.craftAffixRecords(r.o), contribIdx, ranked);
    const key = r.empty ? null : Proj.affixCoverageKey(Proj.craftAffixRecords(r.o)[0]);
    // A family whose slot has no name of its own (Green Steel) returns the system
    // as its `where`; when the caption already says it, blank the column rather
    // than print the same word twice on one row.
    const where = (one && parts.where === one) ? "" : parts.where;
    // #484 — the slot category, muted, in the same idiom the membership row uses
    // for its station: a qualifier the row needs but which must not compete with
    // the value for attention.
    const note = parts.note ? ` <span class="muted">· ${esc(parts.note)}</span>` : "";
    return stackLine(cls, where, `${esc(parts.what)}${note}`, {
      cls: `craft-${esc(r.family)}`,
      mark: r.empty ? "◇" : LINE_MARK[cls],
      title: parts.title,
    });
  });
  const caption = one ? `Craft · ${one}` : "Craft";
  return `<div class="pd-sec pd-sec-craft"><span class="pd-slabel">${esc(caption)}</span>`
    + `<ul class="pd-lines pd-craftlist">${lines.join("")}</ul></div>`;
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
/** #455 — the two statements the per-item summary makes that are NOT chips.
 *
 *  `whyThisLine` did three jobs: an empty-state, the #245 craft-carried line,
 *  and a chip row. The chip row was retired in #455 — it restated the stat row —
 *  and the renderer itself in #476. These two are different kinds of statement,
 *  not a list of contributions, and neither belonged in the chip language:
 *
 *    - the empty-state says the item earned its slot on no ranked stat at all;
 *    - #245 says every ranked point here is CONDITIONAL on crafting, which is a
 *      claim about the pick, not about any one stat.
 *
 *  #476 — `whyThisLine` is gone. Retiring the row from the gear box was a
 *  render decision and not by itself a reason to delete a tested function, so it
 *  was left in place; what settled it is that the surviving justification turned
 *  out to be a claim about a caller that never existed. */
function whyThisNote(result, item, attr, targets) {
  attr = attr || attributionByTarget(result);
  const contribs = itemContributions(result, item, attr, targets);
  // #471 — both statements join the card's one foot-note family. They were the
  // two shapes the user named: a warn-coloured text line and a muted one, sitting
  // beside a third (`pd-rnote`) and a fourth (`pd-rec-note`) that looked like
  // neither. `pd-why` / `pd-carried` are kept as second classes because the tests
  // read these names.
  //
  // #475/#476 — the claim that "the Alternatives tab reads `whyThisLine`'s
  // markup" was false; #475 removed it and #476 removed the function. This note
  // is now the only surviving statement of the two non-chip forms, which is what
  // it always was in substance. (#499 then retired that tab outright.)
  if (!contribs.length) {
    return `<div class="pd-note pd-why muted"><span class="pd-note-ico" aria-hidden="true">·</span><span>included to complete the loadout</span></div>`;
  }
  const carried = Proj.craftCarried(result, item, attr);
  if (!carried) return "";
  const txt = carried.slice(0, 3).map((p) =>
    `${esc(p.stat)} +${esc(p.value)} (${esc(p.family)})`).join(", ");
  return `<div class="pd-note pd-why pd-carried is-craft" title="Nothing printed on this item advances your priorities — its value here depends entirely on crafting it. The Upgrades note above searches for builds that avoid the craft."><span class="pd-note-ico" aria-hidden="true">⚒</span><span><b>Here only for its crafts.</b> ${txt}</span></div>`;
}

// #476 — `whyThisLine` is deleted. It rendered the gear box's per-item
// contribution row and became dead in #455, when `pd-prio` was retired and its
// two non-chip statements moved into `whyThisNote`. From then on nothing called
// it; roughly thirty tests across three files were its only consumer, and the
// doc-comment justifying that said the Alternatives tab read it — which was
// false, and was corrected in #475. (#499 retired the tab itself.)
//
// Nothing it asserted is lost. Each behaviour it encoded is now covered on a
// surface that actually renders: presence-not-+1, the cross-add label and the
// rank-1 accent by the stat row; the absent at-ceiling marker by the two
// #449 U4 guards on `equippedRow`; contribution ordering
// by `itemContributions`' own tests in projection.test.js; and the four that had
// NO live guard — the untyped bucket (#227), the craft-carried note's content
// (#245), the filler empty-state, and the #88 override disclosure driven through
// the whole chain — by the tests added under #476, each proven to fail when its
// own behaviour is broken.
//
// The `.pd-chip` / `.pd-prio` CSS family went with it; `.pd-chip-q` did not, and
// is still what `chipQualifiers` emits on the live row.

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
  // #453 U5 (R11/R12/R13) — the stat NAME is what the player is scanning for, so
  // it carries the emphasis and the total stays in body treatment. The green is
  // `--optimal`, reused rather than minted: `.stat-ceiling` and
  // `.stat-reach.is-maxed` already are that colour and `.pd-chip-check` already
  // uses it to mean "achieved" inside the chip family. Weight rides alongside
  // the colour so the distinction survives a colour-vision difference or a
  // monochrome print export (R13).
  const list = report.map((e) =>
    `<span class="sat-stat">${esc(e.stat)}</span> ${esc(e.total)}`).join(", ");
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
 *  #449 U3 (R17b) — RETAINED ONLY AS THE FALLBACK. A result carrying
 *  `ceilingReport` renders `statReach` instead and never this chip; a build
 *  saved before #449 shipped has no such report, and deleting the chip would
 *  leave it with no ceiling signal at all from data its save still contains.
 *  The card picks one or the other on `statReach` being empty, so the two are
 *  mutually exclusive by construction rather than by two agreeing predicates. */
function ceilingChip(result, stat) {
  const line = (Proj && Proj.saturationLineFor) ? Proj.saturationLineFor(result, stat) : null;
  return line ? `<span class="stat-ceiling at-ceiling" title="${esc(line)}">at ceiling</span>` : "";
}

/** #449 U3 (R11-R16, R29, R30, R33) — the ranked card's achieved/ceiling box.
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
 *  Empty string when `ceilingFor` returns null (no row for the stat — a pre-#449
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

/** #499 — the upgrades notice: the surface that replaced the Alternatives tab.
 *
 *  The tab generated candidates on five axes and showed the best five whatever
 *  they cost, which is how it came to offer +1 of a low-ranked affix for 5
 *  points of a higher-ranked one. The generator is unchanged; what changed is
 *  that nothing reaches the player without clearing the bar in alternatives.js,
 *  and the bar ships at free-only.
 *
 *  This renders the OFFER, not the answer. The search re-solves several times
 *  and must never run on the solve path, so the card carries its own control and
 *  the click handler in renderResults fills it in — the same shape `outbidNotice`
 *  has used for on-request pricing since #345.
 *
 *  Classed INFORMATIONAL rather than actionable on purpose. An un-run search has
 *  found nothing yet, and marking every solve "needs attention" for an offer
 *  would inflate the pill that exists to mean something is wrong. */
function upgradeNotice(canUpgrade, bar) {
  if (!canUpgrade) return "";
  const pct = Math.max(0, Number(bar) || 0);
  const opt = (v, label) => `<option value="${esc(v)}"${v === pct ? " selected" : ""}>${esc(label)}</option>`;
  return `<p class="notice-sentence">Your ranked priorities are already locked in. Some builds reach the same
    totals while completing another set, freeing a slot, taking fewer crafting steps, or picking up a stat you
    never ranked — search for the ones that cost you nothing.</p>
  <div class="upg-controls">
    <label class="upg-bar">Willing to give up
      <select class="upgrade-bar" aria-label="Most a suggestion may cost any ranked priority">
        ${opt(0, "nothing — free upgrades only")}
        ${opt(2, "up to 2% of a priority")}
        ${opt(5, "up to 5% of a priority")}
        ${opt(10, "up to 10% of a priority")}
      </select>
    </label>
    <button class="btn primary upgrade-run" type="button">Find upgrades</button>
  </div>
  <p class="upg-fineprint muted">A suggestion must clear the bar twice: the loss must be small as a share of that
    priority's total, <em>and</em> what it buys must outweigh it once your ranking is taken into account. A point
    of your first priority is worth far more than a point of your last.</p>
  <div class="upg-out"></div>`;
}

// ---- #449 U5 — the notices panel -------------------------------------------
//
// Eleven notices rendered as flat siblings under the OPTIMAL banner, some as
// `<details>` and some as bare `<p>`, so the ones that fold gave no sign they
// could be opened. They are now one collapsed panel of classified sub-cards.

const NOTICE_ACTIONABLE = Proj.NOTICE_ACTIONABLE;
const NOTICE_QUALIFYING = Proj.NOTICE_QUALIFYING;
const NOTICE_INFORMATIONAL = Proj.NOTICE_INFORMATIONAL;

// R28 — the non-colour carrier. Its own element beside the title, never
// concatenated into it: a title prefix produced ~40-character uppercase strings
// that wrapped at phone width and buried the distinguishing word at the far
// right. (KTD5's closing line still describes the prefix form it replaced.)
const NOTICE_CLASS_TAG = {
  [NOTICE_ACTIONABLE]: "Needs attention",
  [NOTICE_QUALIFYING]: "Qualifies",
  [NOTICE_INFORMATIONAL]: "Note",
};
// R5 — actionable, then qualifying, then informational.
const NOTICE_CLASS_ORDER = [NOTICE_ACTIONABLE, NOTICE_QUALIFYING, NOTICE_INFORMATIONAL];

/** #449 U5 (KTD5) — the settled classification of the nine single-fact notices.
 *
 *  Keyed by the notice's function name, which is also what the render array
 *  carries, so the completeness assertion can compare the two directly. The
 *  notice functions keep owning their sentences; this table owns only the card
 *  chrome around them — title, class, and where an actionable one is resolved.
 *
 *  `jump: null` on an actionable notice means it already carries its OWN
 *  in-card resolution control (R6's amendment). `outbidNotice` renders Require
 *  and price buttons; adding a jump beside them would offer a second, worse
 *  route to the fix the player is already looking at.
 *
 *  A `jumpTarget` is a wizard step id plus an optional anchor selector, handed
 *  to the caller's `onJump` seam. results.js never reaches into wizard state:
 *  `step: null` means "this screen", where the wizard scrolls the anchor into
 *  view and focuses it instead of changing step.
 *
 *  DEFERRED — this table is a second place that must be edited whenever a notice
 *  is added, and the two can drift: a new notice with no row here renders
 *  "unclassified" until someone looks. The fix is to give each notice function
 *  its own descriptor and a uniform signature, so classification lives beside
 *  the notice rather than in a parallel lookup. Tracked as **#448**; the
 *  completeness assertion in `tests/results.test.js` is what holds the seam
 *  until then. */
const NOTICE_TABLE = {
  // #453 U6 (R18/KD6) — labelled for what it does. The control opens the adjust
  // panel; the player presses `Re-solve ⚡` inside it. "Re-solve now" promised an
  // action the jump never performed, which is half of why the inert jump read as
  // broken rather than as a mis-scoped label.
  staleSnapshotNotice: { id: "stale-snapshot", title: "STALE SNAPSHOT", subject: "stale snapshot", cls: NOTICE_ACTIONABLE,
    jump: { label: "Adjust & re-solve →", step: null, anchor: "#wz-adjust-slot" } },
  emptySlotNotice: { id: "empty-slot", title: "EMPTY SLOT", subject: "empty slot", cls: NOTICE_ACTIONABLE,
    jump: { label: "Adjust & re-solve →", step: null, anchor: "#wz-adjust-slot" } },
  craftingExcludedNotice: { id: "crafting-opt-out", title: "EXCLUDED BY CRAFTING OPT-OUT", subject: "crafting opt-out", cls: NOTICE_ACTIONABLE,
    jump: { label: "Change crafting opt-out →", step: "character", anchor: 'input[name="wz-crafting-rung"]' } },
  blockNotice: { id: "blocked-gear", title: "BLOCKED GEAR", subject: "blocked gear", cls: NOTICE_ACTIONABLE,
    jump: { label: "Review block list →", step: "pool", anchor: null } },
  augCeilingNotice: { id: "augment-ceiling", title: "AUGMENT POOL NARROWED", subject: "augment ceiling", cls: NOTICE_ACTIONABLE,
    jump: { label: "Change augment ceiling →", step: "character", anchor: "#wz-augceiling" } },
  // Fires only when the player set the ceiling themselves — the same shape as
  // the crafting opt-out, which is why both are actionable rather than
  // qualifying.
  outbidNotice: { id: "priority-scored-0", title: "PRIORITY SCORED 0", subject: "priority scored 0", cls: NOTICE_ACTIONABLE, jump: null },
  absorptionQuarantineNotice: { id: "affix-withheld", title: "AFFIX WITHHELD", subject: "affix withheld", cls: NOTICE_QUALIFYING, jump: null },
  // R35 — already returns its own `<details>`. Unwrapped inside the panel so the
  // panel stays the only fold.
  saturationNotice: { id: "at-ceiling", title: "AT CEILING", subject: "at ceiling", cls: NOTICE_INFORMATIONAL, jump: null, unwrap: true },
  // #499 — `jump: null` for the same reason `outbidNotice` carries one: the card
  // already holds the control that resolves it, and a jump beside it would offer
  // a second, worse route to the thing the player is looking straight at.
  upgradeNotice: { id: "upgrades", title: "UPGRADES", subject: "upgrades", cls: NOTICE_INFORMATIONAL, jump: null },
};

/** #449 U6 (R26) — the short subject each card contributes to the qualifying
 *  marker, for the cards U10 split out. The marker NAMES what qualifies rather
 *  than counting it: a bare count says something exists, it does not say the
 *  headline totals rest on unverified input, which is the fact being disclosed.
 *
 *  Curated rather than derived from the title, because lowercasing produces
 *  "gear ml floor" and "declared credit applied" where the settled copy is
 *  "gear ML floor" and "declared credit". A U6 test asserts every entry a
 *  notice can mint has a subject, so the curation cannot silently fall behind
 *  projection.js the way an uncovered map would. */
const NOTICE_ENTRY_SUBJECTS = {
  "artifact-unavailable": "artifact unavailable",
  "artifact-pinned-in": "artifact pinned in",
  "stat-not-in-data": "stat not in data",
  "stat-filtered-out": "stat filtered out",
  "gear-ml-floor": "gear ML floor",
  "floor-not-reached": "floor not reached",
  "held-at-your-cap": "held at your cap",
  "declared-credit": "declared credit",
  "bonus-type-override": "bonus type overridden",
  "re-solve-to-apply": "re-solve to apply",
  "off-hand-excluded": "off-hand excluded",
};

/** #449 U5 (KTD5, second table) — resolution routes for the cards U10 split out
 *  of the three multi-fact notices. Keyed by the entry `id` projection.js mints,
 *  because those entries carry their own title and class already; only the route
 *  is a render-side concern. An actionable entry with no row here renders
 *  without a control, which the U5 test catches. */
const NOTICE_ENTRY_JUMPS = {
  "artifact-pinned-in": { label: "Review pins →", step: "pool", anchor: null },
  "stat-filtered-out": { label: "Change character filters →", step: "character", anchor: null },
  "floor-not-reached": { label: "Edit priorities →", step: "priorities", anchor: null },
  "re-solve-to-apply": { label: "Re-solve now", step: null, anchor: "#wz-adjust-slot" },
};

/** Strip one wrapping `<details>` down to the parts a card needs (R35): the
 *  summary text becomes the card's sentence body, and the inner content renders
 *  open beneath it. A fold inside a fold, under a card title that already
 *  restates the fact, is three statements of one thing. */
function _unwrapDetails(html) {
  const sm = html.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
  if (!sm) return html;
  const inner = html.replace(/^[\s\S]*?<\/summary>/i, "").replace(/<\/details>\s*$/i, "");
  return `<p class="notice-sentence">${sm[1]}</p>${inner}`;
}

/** #449 U5 — the render array as descriptors: one per CARD, not one per notice
 *  function. The three multi-fact notices contribute one descriptor per fired
 *  branch (U10); the other nine contribute at most one each, and none when the
 *  notice returns empty.
 *
 *  `name` is the notice function's name for the nine, and the source function's
 *  name for a split entry — so the completeness assertion covers both tables
 *  from one array. */
function noticeDescriptors(ctx) {
  const { result, query, model, dataset, canPrice, canRequire } = ctx;
  const out = [];
  const push = (name, html, over) => {
    if (!html) return;                       // R4/R27 — an empty return is not a card
    const t = NOTICE_TABLE[name];
    out.push(Object.assign({ name, html, unclassified: !t },
      t || { id: `unclassified-${name}`, title: name.toUpperCase(), cls: NOTICE_QUALIFYING, jump: null },
      over || {}));
  };
  // The split notices first: each fired branch becomes its own card, carrying the
  // title and class projection.js minted for it and the route from the second table.
  const split = (name, entries) => {
    for (const e of entries) {
      out.push({ name, id: e.id, title: e.title, cls: e.class, unclassified: false,
        jump: NOTICE_ENTRY_JUMPS[e.id] || null,
        // A missing subject falls back to the lowercased title rather than to
        // nothing: the marker must never name fewer subjects than it counts.
        subject: NOTICE_ENTRY_SUBJECTS[e.id] || String(e.title || "").toLowerCase(),
        html: `<p class="notice-sentence">${e.sentence}</p>` });
    }
  };
  split("artifactNotice", artifactNoticeEntries(result, query));
  split("boundNotice", boundNoticeEntries(query, result));
  split("zeroSourceNotice", zeroSourceNoticeEntries(query, result, model, dataset));

  push("staleSnapshotNotice", staleSnapshotNotice(result));
  push("outbidNotice", outbidNotice(query, result, model, canPrice, canRequire));
  push("saturationNotice", saturationNotice(result));
  push("emptySlotNotice", emptySlotNotice(query, result));
  push("absorptionQuarantineNotice", absorptionQuarantineNotice(result));
  push("craftingExcludedNotice", craftingExcludedNotice(query, result));
  push("augCeilingNotice", augCeilingNotice(query, result));
  push("blockNotice", blockNotice(result));
  push("upgradeNotice", upgradeNotice(ctx.canUpgrade, ctx.upgradeBar));

  const rank = (d) => {
    const i = NOTICE_CLASS_ORDER.indexOf(d.cls);
    return i < 0 ? NOTICE_CLASS_ORDER.length : i;      // an unmapped class sorts last, visibly
  };
  return out.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map((x) => x.d);
}

/** #449 U6 (R7, R26) — the two summary markers, both read off the SAME
 *  descriptor array the cards render from, so a count can never disagree with
 *  what is inside the fold.
 *
 *  The pill counts actionable cards that ACTUALLY RENDERED — a notice returning
 *  empty contributes no descriptor, so it cannot be counted. The qualifying
 *  marker names its subjects up to two and falls back to a bare count past
 *  that, which is where naming stops being an aid and becomes a wall of text. */
function noticeSummaryMarkers(descriptors, latched) {
  const act = descriptors.filter((d) => d.cls === NOTICE_ACTIONABLE);
  const qual = descriptors.filter((d) => d.cls === NOTICE_QUALIFYING);
  let out = "";
  if (act.length) {
    // R9 — the pulse is a decoration over a static amber fill, never the sole
    // carrier: the repo kills all animation under prefers-reduced-motion, so a
    // motion-only signal would be invisible to exactly the players who opted out.
    // R8/KTD3 — the latch is stamped at BUILD time. Keying the pulse on [open]
    // would re-arm it on every collapse and on every renderResults call.
    out += `<span class="notes-pill">${esc(act.length)} need${act.length === 1 ? "s" : ""} attention</span>`;
  }
  if (qual.length) {
    const named = qual.length <= 2
      ? `: ${qual.map((d) => esc(d.subject)).join(", ")}`
      : "";
    out += `<span class="notes-qualify">${esc(qual.length)} qualif${qual.length === 1 ? "ies" : "y"}${named}</span>`;
  }
  return out;
}

/** #449 U5 (R1-R4, R27, R28, R35) + U6 (R7-R10, R26) — the panel. Returns ""
 *  when nothing fired: R27 wants no empty fold, no zero count and no chevron on
 *  a clean solve.
 *
 *  `latched` is the session flag from KTD3, stamped onto the freshly built panel
 *  as an attribute so the one-way latch survives the rebuild. This is not the
 *  anti-pattern in `a-state-derived-predicate-cannot-rank-a-dom-its-handlers-mutate.md`:
 *  that forbids a state-derived predicate RANKING an element its own handlers
 *  mutate. This flag is write-once, read only by CSS, and is the render-time
 *  input — which is exactly the moment that learning assigns to state. */
function noticePanel(descriptors, opts) {
  if (!descriptors.length) return "";
  const latched = !!(opts && opts.latched);
  const cards = descriptors.map((d) => {
    const body = d.unwrap ? _unwrapDetails(d.html) : d.html;
    // A jump control changes wizard state, so it is a button rather than a link.
    // The step and anchor ride as data so the click handler stays one listener
    // over the panel instead of one closure per card.
    const ctl = d.jump
      ? `<button class="notice-jump" type="button" data-step="${esc(d.jump.step || "")}"`
        + ` data-anchor="${esc(d.jump.anchor || "")}">${esc(d.jump.label)}</button>`
      : "";
    return `<div class="notice-card is-${esc(d.cls)}${d.unclassified ? " is-unclassified" : ""}" data-notice="${esc(d.id)}">`
      + `<div class="notice-head"><span class="notice-title">${esc(d.title)}</span>`
      + `<span class="notice-tag">${esc(NOTICE_CLASS_TAG[d.cls] || "Unclassified")}</span></div>`
      + `<div class="notice-body">${body}</div>${ctl}</div>`;
  }).join("");
  const n = descriptors.length;
  return `<details class="notes-panel"${latched ? " data-notes-seen" : ""}><summary class="notes-summary">`
    + `<span class="notes-chevron" aria-hidden="true">▸</span>`
    + `<span class="notes-label">Notes on this solve</span>`
    + `<span class="notes-count">${esc(n)} ${n === 1 ? "note" : "notes"}</span>`
    + noticeSummaryMarkers(descriptors, latched)
    + `</summary><div class="notes-body">${cards}</div></details>`;
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

function renderResults(container, { model, result, query, dataset, highs, onAfterRender, onRequire, onJump, notesSeen, onNotesOpen, upgradeBar, onUpgradeBar, versions, characterName }) {
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
  // #499 — the upgrade bar: the most a suggestion may cost any one ranked
  // priority, as a percentage of that priority's total. Ships at
  // `DEFAULT_LOSS_PCT` (0 — free upgrades only). Held as a `let` because the
  // card's select writes it back and the search reads it on the next run; the
  // caller's `onUpgradeBar` seam is how it outlives this render.
  let barPct = Math.max(0, Number(upgradeBar) || 0);
  // #500/#501 — declared HERE, above `renderBuild`, because `renderBuild` now
  // refreshes the Versions and Farming panels and therefore reads both on the
  // very first call at `renderBuild(optimum)`. Left further down beside their own
  // wiring they would be in the temporal dead zone at that moment, and a `const`
  // read before its initializer throws rather than reading undefined.
  //
  // `verApi` is the caller's Versions seam: the comparison candidates it can
  // offer, plus what to do when the player saves one. Absent (a pure-test render,
  // or a host that stores nothing) means the panel renders its empty state —
  // never a control that cannot work, the rule the outbid pricing, the concession
  // probe and the upgrades search all follow.
  const verApi = versions || {};
  // The name the farming ticks are filed under. Its own option rather than read
  // off `query`, which does not carry it: farming progress belongs to a
  // character, and an unnamed build has nowhere to file it — which the panel says
  // out loud instead of dropping the tick on the floor.
  const farmCharacter = String(characterName || "").trim();
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

  // #449 U5 — the notices, contained (#499 made them twelve). Built once so the panel, the
  // summary counts (U6) and the live announcement all read the same array
  // rather than three independent recomputations of "what fired".
  const notices = noticeDescriptors({ result, query, model, dataset,
    canPrice: canPriceOutbid(), canRequire: typeof onRequire === "function",
    canUpgrade: canFindUpgrades(), upgradeBar: barPct });
  container.innerHTML = `
    ${banner}
    ${noticePanel(notices, { latched: !!notesSeen })}
    <div class="active-build-bar" hidden>
      <span class="active-build-msg"></span>
      <button class="return-optimum" type="button">Return to optimum</button>
    </div>
    <div class="readout-analysis">
      <p class="readout-header">Your build, tab by tab — <strong>Loadout</strong> is your equipped gear, item by item,
        with its stats, augments and crafting steps; the other tabs break down priorities and set bonuses. Use
        <strong>Adjust &amp; re-solve</strong> below to change priorities or the gear pool: each adjustment shows what you
        gain and what you lose, then updates the loadout here.</p>
      <div class="result-tabs" role="tablist" aria-label="Result details">
        <button class="rtab" role="tab" id="rt-loadout" aria-controls="rp-loadout" aria-selected="true" tabindex="0" type="button">Loadout</button>
        <button class="rtab" role="tab" id="rt-ranked" aria-controls="rp-ranked" aria-selected="false" tabindex="-1" type="button">Ranked Priorities</button>
        <button class="rtab" role="tab" id="rt-sets" aria-controls="rp-sets" aria-selected="false" tabindex="-1" type="button">Set Bonuses</button>
        <button class="rtab" role="tab" id="rt-versions" aria-controls="rp-versions" aria-selected="false" tabindex="-1" type="button">Adjustment Studio</button>
        <button class="rtab" role="tab" id="rt-farming" aria-controls="rp-farming" aria-selected="false" tabindex="-1" type="button">Farming List</button>
        <button class="rtab" role="tab" id="rt-share" aria-controls="rp-share" aria-selected="false" tabindex="-1" type="button">Share</button>
      </div>
      <div class="wz-adjust-slot" id="wz-adjust-slot"></div>
      <section id="rp-loadout" class="rpanel" role="tabpanel" aria-labelledby="rt-loadout" tabindex="0">
        <div class="readout-doll"><div class="pd-equipped" id="rp-doll"></div><div id="rp-weapons"></div></div>
      </section>
      <section id="rp-ranked" class="rpanel" role="tabpanel" aria-labelledby="rt-ranked" tabindex="0" hidden><div class="targets" id="rp-cards"></div></section>
      <section id="rp-sets" class="rpanel" role="tabpanel" aria-labelledby="rt-sets" tabindex="0" hidden><div id="rp-setspanel"></div></section>
      <section id="rp-versions" class="rpanel" role="tabpanel" aria-labelledby="rt-versions" tabindex="0" hidden><div id="rp-versionspanel"></div></section>
      <section id="rp-farming" class="rpanel" role="tabpanel" aria-labelledby="rt-farming" tabindex="0" hidden><div id="rp-farmingpanel"></div></section>
      <section id="rp-share" class="rpanel" role="tabpanel" aria-labelledby="rt-share" tabindex="0" hidden><div id="rp-sharepanel"></div></section>
    </div>
    <div class="sr-only" aria-live="polite" id="rp-live"></div>`;

  const q = (s) => container.querySelector(s);
  // #499/#500/#501 — THE BUILD EVERY PANEL DESCRIBES. Selecting an upgrade card
  // swaps the whole readout to that candidate, not just the paperdoll, so this is
  // the one place that answers "which build is on screen".
  //
  // It exists because the answer used to be split. `renderBuild` refreshed the
  // doll, weapons, ranked cards and set panel; the Farming List and Versions tabs
  // were filled once from the optimum and never again. A player who clicked an
  // upgrade got a paperdoll showing the candidate, a banner saying "Viewing
  // upgrade", and a farming list for a DIFFERENT set of items — and the farming
  // list is the surface that sends them out of the app for an evening.
  let activeBuild = optimum;

  // Render every panel that describes one build. The three template-driven
  // panels come from `buildViews`; the Farming List and the Versions diff read
  // `activeBuild` through `liveRecord()`, so they must be refreshed here rather
  // than only at first render.
  function renderBuild(build) {
    activeBuild = build;
    const v = buildViews(build, model, query, { concessions: build === optimum && canProbeConcession() });
    q("#rp-doll").innerHTML = v.paperdoll;
    q("#rp-weapons").innerHTML = v.weapons;
    q("#rp-cards").innerHTML = v.cards;
    q("#rp-setspanel").innerHTML = v.setsPanel;
    // Both tolerate being called before their own wiring exists: the initial
    // `renderBuild(optimum)` runs ahead of the panel setup further down, and each
    // is a no-op until its host is in the DOM.
    fillFarmingPanel();
    renderVersionDiff(false);
    animateCounters(container);
  }
  function setActive(build, isAlt, label) {
    renderBuild(build);
    q(".active-build-bar").hidden = !isAlt;
    if (isAlt) q(".active-build-msg").textContent = `Viewing upgrade — ${label}`;
    // Returning to the optimum: clear any card's selected state so the listbox does not
    // report a selection while the optimum (not that upgrade) is shown. The list now
    // lives in the upgrades notice, which may not be on screen at all.
    if (!isAlt) {
      const out = container.querySelector(".upg-out");
      if (out) out.querySelectorAll('.alt-card[aria-selected="true"]')
        .forEach((c) => c.setAttribute("aria-selected", "false"));
    }
    q("#rp-live").textContent = isAlt ? `Now viewing upgrade: ${label}` : "Now viewing the optimal build";
  }
  q(".return-optimum").addEventListener("click", () => setActive(optimum, false));

  // #345 (U4, R8/R9) — accepting the trade writes a floor and re-solves. The
  // handler is the wizard's, so the floor goes through the same sanitizer and
  // persisted field the Advanced min input writes; one writer, one clear path.
  // #449 U6 (R8/KTD3) — the one-way latch. Stamped on the live element the
  // moment it opens, so the pulse stops now rather than at the next render, and
  // reported to the caller so the flag outlives this panel: renderResults
  // destroys and rebuilds the whole container on every solve, load and per-slot
  // constraint change. Never cleared — a collapse does not re-arm it.
  const panelEl = container.querySelector(".notes-panel");
  if (panelEl) {
    panelEl.addEventListener("toggle", () => {
      if (!panelEl.open || panelEl.hasAttribute("data-notes-seen")) return;
      panelEl.setAttribute("data-notes-seen", "");
      if (typeof onNotesOpen === "function") onNotesOpen();
    });
  }

  // #449 U5 (KTD5) — the jump seam. One listener over the panel rather than one
  // closure per card, and results.js hands the caller a target instead of
  // reaching into wizard state: a step id (null meaning "this screen") plus an
  // optional anchor selector. The panel stays open on return because nothing
  // here closes it.
  for (const btn of container.querySelectorAll(".notice-jump")) {
    btn.addEventListener("click", () => {
      if (typeof onJump !== "function") return;
      onJump({ step: btn.dataset.step || null, anchor: btn.dataset.anchor || null });
    });
  }

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

  // #499 — the upgrades search, hosted by the notice card. Gated behind an
  // explicit button (R7 of the tab this replaced) so the base solve stays
  // instant and nothing computes until asked: the search re-solves several
  // times. While it runs, a card-local .wz-ring swirly shows (KTD4 — the
  // wizard's overlay() is a closure results.js can't reach). Every terminal
  // state replaces the spinner — cards, "none found", or an error-with-retry —
  // so it is never left spinning.
  //
  // `probed` holds concession candidates the player priced from a stat card
  // (#481). Kept SEPARATE from `list` so the two states stay distinguishable:
  // `list === null` still means "the search has not been run", which is what
  // keeps the Find-upgrades affordance on screen after a probe has already put a
  // card there. A probe is also EXEMPT from the bar — the player named that
  // trade and asked what it costs, and answering a direct question is not the
  // same act as volunteering a suggestion.
  const altState = { list: null, probed: [], computing: false };

  // #345 (U3, KTD4) — a capability probe, not an assumption. The restored-character
  // render passes highs: null, so pricing is withheld there and the disclosure
  // still stands on its own.
  function canPriceOutbid() {
    return typeof attributeOutbid === "function" && !!highs && !!(optimum && optimum.program);
  }
  // #481 — same shape, same reason: a restored character renders with `highs: null`
  // and no program, so the control is WITHHELD rather than offered and then failing.
  function canProbeConcession() {
    return typeof probeConcession === "function" && !!highs && !!(optimum && optimum.program);
  }
  // #499 — same shape again. The notice does not render at all without this, so a
  // restored character never sees a button that cannot work.
  function canFindUpgrades() {
    return typeof generateAlternatives === "function" && typeof filterUpgrades === "function"
      && !!highs && !!(optimum && optimum.chosen && optimum.chosen.length);
  }

  /** The card's output region. Absent whenever the notice did not render (no
   *  solver) or the panel was rebuilt, so every caller tolerates null. */
  function upgOut() { return container.querySelector(".upg-out"); }

  /** Render whatever cards exist, from either source, as ONE listbox.
   *
   *  Probed concessions come first: the player asked for those by name. When the
   *  search has not run, the Find-upgrades affordance stays in place above rather
   *  than being replaced — a probe answering one question must not look like it
   *  answered all of them.
   *
   *  Cards are wrapped in a fresh element each render and wired on THAT, because
   *  `wireAltCards` binds click/keydown to the element it is handed; wiring the
   *  long-lived region repeatedly would stack a listener per render and select
   *  once per stacked copy. */
  function renderUpgrades() {
    const out = upgOut();
    if (!out) return false;
    const list = [...altState.probed, ...(altState.list || [])];
    if (!list.length) return false;
    out.innerHTML = `<div class="alt-wrap">${renderAltCards(list)}</div>`;
    wireAltCards(out.querySelector(".alt-wrap"), list, setActive);
    return true;
  }
  /** A terminal message in the output region, with the button left usable. */
  function upgMessage(msg) {
    const out = upgOut();
    if (out) out.innerHTML = `<p class="dd-none muted">${esc(msg)}</p>`;
  }
  function runUpgrades() {
    const out = upgOut();
    if (!out || altState.computing) return;
    altState.computing = true;
    out.innerHTML = `<div class="alt-computing"><div class="wz-ring"></div><p class="muted">Searching for upgrades…</p></div>`;
    q("#rp-live").textContent = "Searching for upgrades…";
    // Defer so the spinner paints before the synchronous re-solves run.
    setTimeout(() => {
      // If a re-render (e.g. a per-slot constraint change) replaced this card
      // while we waited, abandon: don't run the stale solve or write cards/aria
      // into the fresh closure's live region.
      if (upgOut() !== out) { altState.computing = false; return; }
      try {
        const raw = generateAlternatives(optimum, model, highs);
        const analyzed = raw.map((c) => analyzeAlternative(optimum, c, query));
        // #499 — filter BEFORE ranking. `rankAlternatives` caps at five, so
        // filtering after it would let five rejected candidates crowd out a free
        // upgrade sitting sixth and report "none found" against a list that had
        // one. The bar decides what is eligible; the ranking orders what is left.
        const kept = filterUpgrades(analyzed, optimum, query,
          { lossPct: barPct, utilitySentinel: _UTILITY_SENTINEL });
        const ranked = rankAlternatives(kept, optimum, {});
        altState.list = ranked;
        if (!renderUpgrades()) {
          upgMessage(barPct === 0
            ? "No free upgrade found — every improvement here would cost you a ranked priority. Widen the bar above to see what those trades buy."
            : "No upgrade clears your bar — the optimum is hard to beat for these priorities.");
        }
        q("#rp-live").textContent = ranked.length
          ? `${ranked.length} upgrade${ranked.length === 1 ? "" : "s"} found.`
          : "No upgrade cleared the bar.";
      } catch (e) {
        console.error(e);
        altState.list = null;   // let a retry recompute cleanly
        upgMessage("Could not search for upgrades. Press Find upgrades to try again.");
        q("#rp-live").textContent = "Could not search for upgrades.";
      }
      altState.computing = false;
    }, 20);
  }

  // The card's two controls. Delegated on `container` — the notice panel is part
  // of THIS render's innerHTML, so a listener here lives exactly as long as the
  // card does and cannot stack across renders.
  const runBtn = container.querySelector(".upgrade-run");
  if (runBtn) runBtn.addEventListener("click", () => { altState.list = null; runUpgrades(); });
  const barSel = container.querySelector(".upgrade-bar");
  if (barSel) {
    barSel.addEventListener("change", () => {
      barPct = Math.max(0, Number(barSel.value) || 0);
      if (typeof onUpgradeBar === "function") onUpgradeBar(barPct);
      // A changed bar invalidates the answer, never the question: the probed
      // concessions stay (the player asked for those), the searched list goes.
      altState.list = null;
      const out = upgOut();
      if (out && !renderUpgrades()) out.innerHTML = "";
    });
  }
  // #481 (U4) — price a concession on request. One probe per click, never on the
  // solve path. Delegated on the container rather than wired per button, because
  // `renderBuild` replaces the whole ranked-cards block on every selection and a
  // per-button wiring would be lost with it.
  // Delegated on `#rp-cards`, NOT on `container`: `container` outlives this call,
  // so a listener bound there would stack one copy per solve and fire the probe
  // once per stacked copy. `#rp-cards` is minted by this render's template and
  // survives `renderBuild`'s innerHTML swaps, which is exactly the lifetime wanted.
  q("#rp-cards").addEventListener("click", (e) => {
    const btn = e.target.closest(".concession-probe");
    if (!btn || btn.disabled) return;
    const stat = btn.dataset.stat;
    btn.disabled = true;                                   // one probe per click
    btn.textContent = `Pricing ${stat}…`;
    // Defer so the label paints before the probe's solves, which are synchronous
    // inside it however many `await`s it is written with.
    setTimeout(() => {
      Promise.resolve()
        .then(() => probeConcession(model, optimum.program, highs, stat,
          (query && query.targets) || [], optimum.perTarget || optimum.effective || {},
          { utilityCount: optimum.utilityReport ? optimum.utilityReport.count : null }))
        .then((res) => showConcession(btn, stat, res))
        .catch((err) => {
          // Never silently: a swallowed failure is indistinguishable from a genuine
          // "nothing found", and those two must not blur — one means the trade does
          // not exist, the other means we did not look.
          console.error("concession probe failed", err);
          replaceControl(btn, `Could not price a concession on ${esc(stat)} — the probe did not run.`);
        });
    }, 0);
  });

  function replaceControl(btn, html) {
    const out = document.createElement("p");
    out.className = "concession-priced";
    out.innerHTML = html;
    btn.replaceWith(out);
    return out;
  }

  /** The three terminal states of a probe, kept deliberately distinct (R5). */
  function showConcession(btn, stat, res) {
    if (!res) {
      const v = Number((optimum.effective || {})[stat]) || 0;
      const w = Math.min(concessionWindow(v), v);
      replaceControl(btn, `No concession of up to ${esc(w)} ${esc(stat)} changes anything ranked beneath it.`);
      q("#rp-live").textContent = `No concession on ${stat} changes anything beneath it.`;
      return;
    }
    const runOf = (ds, sign) => ds.map((d) => `${sign}${Math.abs(d.delta)} ${d.stat}`).join(", ");
    const gains = res.deltas.filter((d) => d.delta > 0);
    const losses = res.deltas.filter((d) => d.delta < 0 && d.stat !== stat);
    // Losses are stated in the same breath as the gain, never as a footnote: per
    // `lexicographic-descent-bounds-the-vector-not-each-stat.md` the priority after
    // the one that rises can genuinely fall, and a sentence that mentions only the
    // gain would advertise a trade while hiding its price.
    const plain = `Giving up ${res.concession} ${stat} buys ${runOf(gains, "+")}`
      + (losses.length ? ` and costs ${runOf(losses, "−")}` : "")
      + `. Set Max ${res.cap} on ${stat} to take it.`;
    const out = replaceControl(btn,
      `${esc(plain)} <button class="btn ghost concession-view" type="button">See this build</button>`);
    q("#rp-live").textContent = plain;      // the sentence itself, never its escaped form
    out.querySelector(".concession-view").addEventListener("click", () => {
      const cand = analyzeAlternative(optimum,
        { sol: res.sol, gainAxis: "concession", meta: { stat, cap: res.cap, concession: res.concession } },
        query);
      if (!altState.probed.some((c) => c.key === cand.key)) altState.probed.unshift(cand);
      // #499 — the probe's answer lands in the upgrades card, which is where every
      // candidate build now lives. It is placed there WITHOUT consulting the bar:
      // the player named this trade and asked what it costs, and answering the
      // question they asked is not the same act as volunteering a suggestion.
      renderUpgrades();
      // Select through the CARD rather than calling setActive directly, so the
      // listbox's own aria-selected/roving-tabindex state matches what is on screen.
      // A build shown with no card marked selected reads as an unrelated render.
      const out = upgOut();
      const card = out && out.querySelector('.alt-card[data-idx="0"]');
      if (card) card.click(); else setActive(res.sol, true, cand.gainText);
    });
  }

  // #500 — the Versions tab. `versions` is the caller's seam: the comparison
  // candidates it can offer, plus what to do when the player saves one. Absent
  // (a pure-test render, or a host that stores nothing) means the panel simply
  // renders its empty state — never a control that cannot work, the same rule
  // the outbid pricing, the concession probe and the upgrades search follow.
  function verRecords() {
    return typeof verApi.records === "function" ? (verApi.records() || []) : (verApi.records || []);
  }
  /** The build ON SCREEN, in the shape `diffVersions` and `farmingPlan` consume.
   *
   *  Reads `activeBuild`, NOT `optimum`: after an upgrade card is selected the
   *  readout describes that candidate, and a farming list or a comparison still
   *  answering for the optimum would be describing gear the player is not
   *  looking at.
   *
   *  The snapshot is the LIVE solve rather than a stripped one, which
   *  `Proj.project` reads identically — a saved character's snapshot IS this
   *  shape minus the fields persist.js drops. */
  function liveRecord() {
    return { id: "__current__", name: "This build", kind: "named",
      query, inputs: { priorities: (query && query.targets) || [] }, snapshot: activeBuild };
  }
  /** Re-run the comparison for whatever the picker currently holds.
   *
   *  Deliberately separate from `fillVersionsPanel`: a build swap has to re-diff
   *  against the NEW active build, and rebuilding the panel to do it would reset
   *  the picker — discarding the player's chosen comparison at the exact moment
   *  they changed what is being compared. This touches only `.ver-diff`.
   *
   *  A no-op until the panel has been built, which is what lets `renderBuild`
   *  call it on the very first render before `fillVersionsPanel` has run.
   *
   *  `announce` is false on a build swap: the live region is already saying which
   *  build is now shown, and a second message about the comparison on top of it
   *  is two announcements for one action. */
  function renderVersionDiff(announce) {
    const host = q("#rp-versionspanel");
    if (!host) return;
    const pick = host.querySelector(".ver-pick");
    const out = host.querySelector(".ver-diff");
    if (!pick || !out) return;
    const rec = verRecords().find((r) => String(r.id) === pick.value);
    if (!rec) { out.innerHTML = ""; return; }
    // The diff runs over the two records, never over the rendered HTML: the
    // labels below are presentation, the comparison is data.
    const d = (typeof VersionStore !== "undefined" && VersionStore.diffVersions)
      ? VersionStore.diffVersions(liveRecord(), rec.record || rec) : null;
    out.innerHTML = versionDiffView(d, { a: "This build", b: rec.label });
    if (announce) {
      q("#rp-live").textContent = d && d.identical
        ? `This build is identical to ${rec.label}.`
        : `Comparison with ${rec.label} ready.`;
    }
  }
  function fillVersionsPanel(note) {
    const host = q("#rp-versionspanel");
    if (!host) return;
    host.innerHTML = versionsPanel(verRecords(), { note: note || "" });
    const pick = host.querySelector(".ver-pick");
    if (pick) {
      pick.addEventListener("change", () => renderVersionDiff(true));
      // Open on the last change rather than on an empty picker. The seam decides
      // WHICH record that is, because only the caller knows which stored snapshot
      // belongs to the build already on screen — comparing against that one would
      // greet every solve with "these two builds are identical".
      const def = typeof verApi.defaultCompare === "function" ? verApi.defaultCompare() : null;
      if (def && [...pick.options].some((o) => o.value === String(def))) {
        pick.value = String(def);
        renderVersionDiff(false);
      }
    }
    const save = host.querySelector(".ver-save");
    if (save) {
      save.addEventListener("click", () => {
        if (typeof verApi.save !== "function") {
          fillVersionsPanel("Saving is unavailable on this screen.");
          return;
        }
        const res = verApi.save() || {};
        // The quota case is the ONE failure that must be said out loud. Snapshots
        // carry full item objects and auto-snapshots accumulate on every solve,
        // so a full store is a matter of when. Swallowing it would stop recording
        // history while the tab kept implying it was still saving.
        fillVersionsPanel(res.ok
          ? "Saved. Solve again and compare this against what you get."
          : res.full
            ? "Your browser's storage for this site is full, so this version was not saved. Delete a version you no longer need, then try again."
            : "That version could not be saved.");
      });
    }
  }
  fillVersionsPanel(typeof verApi.note === "function" ? verApi.note() : verApi.note);

  // #501 — the Farming List. `character` names whose progress is being ticked;
  // without one the list still renders and the ticks simply have nowhere to go,
  // which is stated rather than silently discarded.
  function currentPlan() {
    return (typeof FarmingList !== "undefined" && FarmingList.farmingPlan)
      ? FarmingList.farmingPlan(liveRecord()) : null;
  }
  /** Rebuild the panel's CONTENT only. Wiring lives outside this function on
   *  purpose — see the delegation block below. */
  function fillFarmingPanel(note) {
    const host = q("#rp-farmingpanel");
    if (!host) return;
    const acquired = (typeof FarmingList !== "undefined" && FarmingList.loadProgress)
      ? FarmingList.loadProgress(farmCharacter) : {};
    host.innerHTML = farmingPanel(currentPlan(), acquired, { note: note || "" });
  }
  /** Print the farming list alone.
   *
   *  Scoped with a body class and cleared on `afterprint`, exactly as the Share
   *  tab's `printLoadout` does. The rules were unscoped at first, which meant a
   *  player pressing Ctrl+P anywhere in the app got the farming list instead of
   *  the page — or a blank sheet, since `#rp-farming` still carries `hidden`
   *  whenever another tab is active.
   *
   *  The class also has to suppress `#wz-printarea`. That container is created by
   *  the Share tab's print, is never removed from the DOM afterwards, and its own
   *  `@media print` rule forces it visible by ID — so without an explicit
   *  override a farming printout that followed a Share printout carried the
   *  previous loadout table along with it. */
  function printFarmingList() {
    document.body.classList.add("farming-printing");
    const cleanup = () => {
      document.body.classList.remove("farming-printing");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }
  function farmNote(msg) {
    const el = container.querySelector(".farm-note");
    if (el) el.textContent = msg;
  }

  // Wired ONCE, on the long-lived panel host.
  //
  // `#rp-farmingpanel` is minted by THIS render's container template and then only
  // ever has its innerHTML replaced, so it outlives every `fillFarmingPanel` call.
  // Wiring inside that function therefore stacked one listener per call: a tick on
  // an unnamed build re-rendered with a message and added a second handler, and the
  // next tick ran both — each flipping `box.checked`, so the box landed back where
  // it started and two more handlers were added. Delegation on the host is what
  // makes the wiring independent of how often the content is rebuilt, which it now
  // is on every build swap as well.
  const farmHost = q("#rp-farmingpanel");
  if (farmHost) {
    farmHost.addEventListener("change", (e) => {
      const box = e.target.closest(".farm-tick");
      if (!box) return;
      if (!farmCharacter) {
        // A tick with nowhere to go is put back rather than left looking saved.
        box.checked = !box.checked;
        fillFarmingPanel("Name this build in the character step to save what you have collected.");
        return;
      }
      const res = FarmingList.toggleAcquired(farmCharacter, box.dataset.item);
      if (!res.ok) {
        box.checked = !box.checked;
        fillFarmingPanel("That could not be saved — your browser's storage for this site may be full.");
        return;
      }
      box.closest(".farm-item").classList.toggle("is-got", !!res.acquired[box.dataset.item]);
    });
    // Both buttons are rebuilt with the content, so they are reached by delegation
    // too rather than re-bound per fill. The plan is recomputed at click time
    // instead of captured, so a build swap cannot leave a stale list behind the
    // Copy button.
    farmHost.addEventListener("click", (e) => {
      if (e.target.closest(".farm-print")) { printFarmingList(); return; }
      if (!e.target.closest(".farm-copy")) return;
      const plan = currentPlan();
      if (!plan) return;
      const text = FarmingList.farmingMarkdown(plan, { character: farmCharacter });
      // The clipboard API is permissioned and absent over plain http on some
      // browsers, so a failure is reported rather than swallowed — a Copy button
      // that silently does nothing is worse than one that says it did not.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(() => farmNote("Copied."))
          .catch(() => farmNote("Could not reach the clipboard — use Print instead."));
      } else {
        farmNote("This browser will not let the page reach the clipboard — use Print instead.");
      }
    });
  }

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
// selecting an upgrade card re-renders receipts from THAT build — it must
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
  // The `✓` is gone: a secured effect is filled, in the same mark and the same
  // colour as a satisfied affix, because that is what it is. A check mark was a
  // second vocabulary for one fact, and it read as a form being ticked off
  // rather than as a stat the build holds.
  const list = effects.map((e) =>
    `<li class="utility-effect"><span class="utility-mark" aria-hidden="true">${LINE_MARK.utility}</span> ${esc(e.name)}${e.item ? ` <span class="attrib-src">— from ${esc(e.item)}</span>` : ""}</li>`).join("");
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
/** #485/#488 — the block renders the credit; it no longer computes it.
 *
 *  `bundleGroups` annotates every group and member with `live` (and `null` when
 *  there is no build to judge against), so the app and every export read the same
 *  fact from one place. Computing it here was what left the exports listing a
 *  superseded bundle as though the build were getting it.
 *
 *  Nothing is hidden. A superseded bundle keeps its card and says why: the player
 *  owns that item, and "the enchantment is on it and doing nothing" is a different
 *  fact from "the enchantment is absent". */
function bundlesBlock(build, augById) {
  const groups = Proj.bundleGroups(build, augById);
  if (!groups.length) return "";
  const cards = groups.map((b) => {
    const members = b.members || [];
    // ONLY `superseded` is struck. `unranked` means the player never asked for that
    // stat — nothing is competing for its bucket — and marking it dead would claim
    // a competitor that does not exist. `null` means there was no build to judge
    // against, so nothing is claimed either way; that also keeps the member run
    // contiguous, which is what lets the export-parity test compare the app's line
    // against the share's character for character.
    const grants = members.map((m) => {
      const label = esc(affixLabel(m));
      return m.state === "superseded" ? `<span class="bundle-dead">${label}</span>` : label;
    }).join(", ");
    // The whole-bundle case gets a sentence rather than only a shade: "this item
    // has it and you are not getting it" is not something a reader should have to
    // infer from a colour. Wording deliberately matches the per-chip `ranked`
    // explanation on the gear cards — one fact, said the same way twice.
    const dead = b.state === "superseded";
    const note = dead ? `<div class="set-via bundle-note">A larger source elsewhere in this build already fills these bonus-type buckets, so this copy adds nothing.</div>` : "";
    return `<li class="set-card bundle${dead ? " is-incidental" : ""}"><strong>${esc(b.name)}</strong>`
      + `<div class="set-grants">${grants}</div>`
      + `<div class="set-via">from ${esc(b.carrier)}</div>${note}</li>`;
  }).join("");
  return `<h3 class="setlike-h" title="one enchantment granting several stats">Bundled enchantments (single-source, not sets)</h3><ul class="sets bundle-list">${cards}</ul>`;
}

/** #481 (U4) — the concession control: "what would less of this buy?", asked from
 *  the priority it is about.
 *
 *  Rendered only where the question has an answer to give. A priority with nothing
 *  ranked beneath it has nothing to buy, and a stat sitting at zero has nothing to
 *  concede; offering the control there and then reporting "nothing found" would
 *  teach the player that the control is noise. The caller's `opts.concessions` gate
 *  carries the other half — solver availability, and that the build on screen is
 *  the OPTIMUM. A selected alternative must not offer it: the probe is defined
 *  against the optimum's program, so pricing from an alternative's card would
 *  answer a question about a build the player is not looking at.
 */
function concessionControl(stat, i, total, query, opts) {
  if (!(opts && opts.concessions)) return "";
  const targets = (query && query.targets) || [];
  if (i >= targets.length - 1) return "";      // nothing ranked beneath it
  if (!(Number(total) > 0)) return "";         // nothing to concede
  return `<button class="btn ghost concession-probe" type="button" data-stat="${esc(stat)}">`
    + `What would less of this buy?</button>`;
}

// Compute the per-build view HTML (paperdoll, weapon row, ranked cards, set panel)
// for ANY result-shaped build — the optimum or a selected alternative,
// which carry the same fields (chosen, effective, breakdown, capped, setsActive,
// the *Placed lists). Reused by renderBuild for select-to-inspect (U5).
function buildViews(build, model, query, opts) {
  // The craft-placement maps (augment/dino assignments + per-item craft groupings)
  // come from the shared projection so the gear cards and the exports read from
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
    // #449 U3 (R17b) — one ceiling signal per card, chosen by which data the
    // build actually carries: the fraction when `ceilingReport` has a row for
    // this stat, the legacy chip only when it does not.
    const reach = statReach(build, stat);
    return `<div class="stat-card">
      <div class="stat-head"><span class="stat-rank">${i + 1}</span><span class="stat-name">${esc(stat)}</span></div>
      <div class="stat-value" data-final="${esc(total)}">${esc(total)}</div>
      ${capNote}${(!reach && build.effective) ? ceilingChip(build, stat) : ""}
      ${attributionList(contribs)}
      ${reach}
      ${concessionControl(stat, i, total, query, opts)}
    </div>`;
  }).join("");
  // #449 U3 (R15) — the FULL statement, once per readout at section level. It
  // carries the qualification the per-card short forms omit: repeated under every
  // card down an eight-priority build it reads as boilerplate and stops being
  // read, which defeats the premise that the sentence is the mitigation. It sits
  // above the cards rather than behind a fold so it is in the same view, not
  // merely reachable. Null (and silent) on a pre-#449 restore.
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
      // #471 — ONE source for the pair. The Loadout card marks a Sun/Moon augment
      // slot with these too, and the user reported the two surfaces naming the
      // same gem system with different symbols; a shared constant is what stops
      // them drifting again.
      const glyph = x.ls === "Lunar" ? SUN_MOON_GLYPH.moon : SUN_MOON_GLYPH.sun;
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

  return { paperdoll: `<div class="pd-list">${rows.join("")}</div>`, weapons, cards: cardsHtml, setsPanel };
}

// Alternative cards (U4): compact trade-off summary + gain tags, as a single-select
// listbox (R10, card a11y).
function renderAltCards(ranked) {
  return `<ul class="alt-list" role="listbox" aria-label="Alternative loadouts">${ranked.map((a, i) => `
    <li class="alt-card" role="option" id="alt-opt-${i}" aria-selected="false" tabindex="${i === 0 ? 0 : -1}" data-idx="${i}">
      <div class="alt-head">
        <div class="alt-axis">${altAxisLabel(a.tags)}</div>
        <div class="alt-headline">${esc(a.gainText)}</div>
      </div>
      <div class="alt-body">${altGainSection(a)}${altCostSection(a)}</div>
      <div class="alt-foot">${altFootNote(a)}</div>
    </li>`).join("")}</ul>`;
}

/** #475 — the trade's axis, as the card's HEAD LABEL.
 *
 *  These were `alt-tag` pills — rounded, tinted, bordered — the last of the chip
 *  idiom #471 and #472 retired from every other surface. They are not chips of
 *  data: "set bonus" is what KIND of trade this is, which is the same job the
 *  slot name does on a gear card, so it takes the same small-caps treatment.
 *
 *  The separator is a span rather than a literal " · " so it can be dimmed; a
 *  full-strength dot between two labels reads as a third label. */
function altAxisLabel(tags) {
  return (tags || []).map(esc).join(`<span class="sep">·</span>`);
}

/** #475 — what an alternative GAINS, as rows.
 *
 *  Built from the structured fields `analyzeAlternative` already returns, never
 *  by re-splitting `gainText`: that string is a headline ("+18 Melee Power"),
 *  and re-parsing a rendered sentence back into data is how two surfaces come to
 *  disagree about a number.
 *
 *  A set is expanded to the affixes it grants through the same `activeSetDetail`
 *  the build sheet uses (U7) — an alternative that says only "activates X" makes
 *  the player go and look up what X does. */
function altGainSection(a) {
  const rows = [];
  const detail = (a.activatedSets && a.activatedSets.length && a.sol) ? activeSetDetail(a.sol) : [];
  for (const setName of a.activatedSets || []) {
    const d = detail.find((s) => s.set === setName);
    for (const affix of (d && d.affixes) || []) {
      rows.push({ where: "set", what: affixLabel(affix) });
    }
  }
  for (const g of a.gains || []) rows.push({ where: "stat", what: `${g.stat} +${g.delta}` });
  // Deliberately NO row for the crafts and unranked axes. Their whole gain is
  // already the headline — "6 fewer crafting steps", "free +Dodge" — and there
  // is no structured detail underneath it to list. The head/body relationship on
  // these cards is summary-then-detail (the gear card does the same with its set
  // name); repeating the summary verbatim as its own detail row is not that.
  if (!rows.length) return "";
  const lines = rows.map((r) => stackLine("gain", r.where, esc(r.what), { mark: "▲" })).join("");
  return `<div class="pd-sec alt-sec-gain"><span class="pd-slabel">Gains</span>`
    + `<ul class="pd-lines">${lines}</ul></div>`;
}

/** #475 — what it COSTS, as rows in the same language.
 *
 *  `is-cost` is the one class this card adds to the row family, and `▼` against
 *  the gain's `▲` is why: the direction of a trade is the single most important
 *  thing on this card, and every other class on these surfaces carries its
 *  meaning as a shape before a colour. Amber alone would fail in monochrome.
 *
 *  A shed utility effect gets a row per effect rather than one comma-run: #348
 *  ruled that a trade must NAME what it sheds ("gives up Blunt Trauma") rather
 *  than count it, and a row each is that ruling carried into the row language. */
function altCostSection(a) {
  const rows = (a.cost || []).map((c) => ({ where: "stat", what: `${c.stat} ${c.delta}` }));
  for (const name of a.shedEffects || []) rows.push({ where: "utility", what: `gives up ${name}` });
  if (!rows.length) return "";
  const lines = rows.map((r) => stackLine("cost", r.where, esc(r.what), { mark: "▼" })).join("");
  return `<div class="pd-sec alt-sec-cost"><span class="pd-slabel">Costs</span>`
    + `<ul class="pd-lines">${lines}</ul></div>`;
}

/** #475 — a candidate that costs nothing says so in the foot, in the shared note
 *  family, rather than rendering an empty Costs section. "Nothing you ranked
 *  goes down" is a claim about the whole trade, not a row of it — the same
 *  reason the craft-carried and no-drop-source statements live down there. */
function altFootNote(a) {
  const free = !(a.cost || []).length && !(a.shedEffects || []).length;
  if (!free) return "";
  return `<div class="pd-note is-free"><span class="pd-note-ico" aria-hidden="true">✓</span>`
    + `<span><b>No priority cost.</b> Nothing you ranked goes down to get this.</span></div>`;
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

/** #500 — the Adjustment Studio.
 *
 *  NAMING, deliberately split rather than drifted: the SURFACE is the Adjustment
 *  Studio, because what a player does here is see what their adjustments did. The
 *  STORE underneath is still versions — `VersionStore`, `versions.js`, `rt-versions`
 *  — because what it stores really is point-in-time versions of a build, and the
 *  Studio is one reading of them rather than the only possible one. Renaming the
 *  store to match the tab would claim the two are the same thing.
 *
 *  Answers a question the app could not answer at all: *how does this build
 *  differ from the one I had before?* Saving a character overwrites what was
 *  there, so nothing recorded what changed or what it cost.
 *
 *  The build on screen is always the LEFT side. The tab lives inside the results
 *  readout, so there is always a live subject and a free two-sided picker would
 *  be reachable only after a solve anyway.
 *
 *  `records` are comparison candidates: stored versions and saved characters
 *  alike, already normalised by the caller into `{ id, label, group }`. */
function versionsPanel(records, opts) {
  const o = opts || {};
  const list = records || [];
  const groups = [];
  for (const r of list) {
    let g = groups.find((x) => x.name === (r.group || "Saved"));
    if (!g) { g = { name: r.group || "Saved", items: [] }; groups.push(g); }
    g.items.push(r);
  }
  const picker = list.length
    ? `<label class="ver-pick-label">Compare against
        <select class="ver-pick" aria-label="Build to compare against">
          <option value="">Choose a saved build…</option>
          ${groups.map((g) => `<optgroup label="${esc(g.name)}">`
            + g.items.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join("")
            + `</optgroup>`).join("")}
        </select>
      </label>`
    : `<p class="dd-none muted">Nothing to compare against yet — this is the first build of the session.
       Adjust something and re-solve, and this tab will open on exactly what moved.</p>`;
  return `<p class="wz-help">What your adjustments did. The build on screen, against the one you had before —
      or any build you saved. Every difference is reported, <strong>including stats you never ranked</strong>,
      because a swap that quietly cost you 40 HP is exactly the thing you would not have gone looking for.</p>
    <div class="ver-controls">
      ${picker}
      <button class="btn ghost ver-save" type="button">Save this build as a version</button>
    </div>
    <p class="ver-note" role="status">${o.note ? esc(o.note) : ""}</p>
    <div class="ver-diff"></div>`;
}

/** One rendered comparison. `labels` names the two sides so every row can say
 *  which build it is talking about rather than relying on left/right. */
function versionDiffView(diff, labels) {
  if (!diff) return `<p class="dd-none muted">That build could not be read for comparison.</p>`;
  const A = (labels && labels.a) || "this build";
  const B = (labels && labels.b) || "the saved build";
  if (diff.identical) {
    return `<p class="ver-same">These two builds are identical — same gear, same crafts, same totals.</p>`;
  }
  const sign = (n) => `${n > 0 ? "+" : "−"}${Math.abs(n)}`;
  const statRow = (d) => `<li class="ver-stat ${d.delta > 0 ? "is-up" : "is-down"}${d.ranked ? " is-ranked" : ""}">
      <span class="ver-stat-name">${esc(d.stat)}</span>
      <span class="ver-stat-delta">${esc(sign(d.delta))}</span>
      <span class="ver-stat-detail">${esc(d.a)} vs ${esc(d.b)}</span>
    </li>`;
  const ranked = diff.stats.filter((d) => d.ranked);
  const rest = diff.stats.filter((d) => !d.ranked);
  const statsBlock = `
    ${ranked.length ? `<section class="ver-sec"><h4>Your ranked priorities</h4><ul class="ver-stats">${ranked.map(statRow).join("")}</ul></section>` : ""}
    ${rest.length ? `<section class="ver-sec"><h4>Everything else that moved</h4>
        <p class="ver-sec-note muted">You did not rank these, so the solver never protected them. This is where a
          swap quietly costs you something.</p>
        <ul class="ver-stats">${rest.map(statRow).join("")}</ul></section>` : ""}
    ${diff.stats.length ? "" : `<section class="ver-sec"><h4>Totals</h4><p class="muted">No stat differs between these builds.</p></section>`}`;

  const setsBlock = (diff.sets.gained.length || diff.sets.lost.length)
    ? `<section class="ver-sec"><h4>Set bonuses</h4><ul class="ver-sets">
        ${diff.sets.gained.map((x) => `<li class="is-up"><span class="ver-tag">gained</span>${esc(x)}</li>`).join("")}
        ${diff.sets.lost.map((x) => `<li class="is-down"><span class="ver-tag">lost</span>${esc(x)}</li>`).join("")}
      </ul></section>` : "";

  const changed = diff.slots.filter((s) => s.changed);
  // The two builds are named ONCE, here, instead of on every slot row.
  //
  // Repeating them per row is what wrecked this layout: the right-hand label is a
  // version name like "Melee Power, Doublestrike +6 more · 2026-08-24 14:28" —
  // measured at 321px against a ~350px column, with `flex: none` — so it consumed
  // the row and left 19px for the item, which then broke one character per line
  // and read as if the name had been transposed on its side. A label that can be
  // longer than the value it labels does not belong on every row.
  //
  // The rows now carry fixed two-word captions, and those captions are only there
  // to say WHICH side you are reading on a narrow screen where the two stack.
  const legend = `<div class="ver-legend">
      <span class="ver-legend-side"><span class="ver-legend-key is-a"></span>${esc(A)}</span>
      <span class="ver-legend-side"><span class="ver-legend-key is-b"></span>${esc(B)}</span>
    </div>`;
  const slotRow = (s) => {
    const crafts = [
      ...s.craftsAdded.map((c) => `<li class="is-up"><span class="ver-tag">added</span>${esc(c)}</li>`),
      ...s.craftsRemoved.map((c) => `<li class="is-down"><span class="ver-tag">dropped</span>${esc(c)}</li>`),
    ].join("");
    // `title` carries the full name of each side, so the fixed caption never
    // costs the reader the detail the legend states in full above.
    return `<li class="ver-slot">
      <div class="ver-slot-head"><span class="ver-slot-name">${esc(s.slot)}</span></div>
      <div class="ver-slot-body">
        <div class="ver-side is-a" title="${esc(A)}"><span class="ver-side-label">This build</span><span class="ver-side-item">${s.a ? esc(s.a.item) : "empty"}</span></div>
        <div class="ver-side is-b" title="${esc(B)}"><span class="ver-side-label">Compared with</span><span class="ver-side-item">${s.b ? esc(s.b.item) : "empty"}</span></div>
      </div>
      ${crafts ? `<ul class="ver-crafts">${crafts}</ul>` : ""}
    </li>`;
  };
  const slotsBlock = `<section class="ver-sec"><h4>Slot by slot</h4>
    ${changed.length ? legend : ""}
    ${changed.length
      ? `<ul class="ver-slots">${changed.map(slotRow).join("")}</ul>`
      : `<p class="muted">Every slot holds the same item, with the same crafts.</p>`}
    ${changed.length && changed.length < diff.slots.length
      ? `<p class="ver-sec-note muted">${diff.slots.length - changed.length} unchanged slot${diff.slots.length - changed.length === 1 ? " is" : "s are"} not listed.</p>`
      : ""}</section>`;

  return `${statsBlock}${setsBlock}${slotsBlock}`;
}

/** #501 — the Farming List tab: where the gear actually comes from.
 *
 *  Grouped by SOURCE, ordered by how many of your items each one yields. That
 *  ordering is the whole value: "these three drop in Gianthold Tor" turns
 *  thirteen lookups into one run, and it is the only thing this list can tell a
 *  player that the Loadout tab cannot.
 *
 *  Adventure-pack-first is the intended grouping — "do I even own this pack" is
 *  the first question — and it waits on the curated mapping in #495, because the
 *  pack is not in the dataset and is not upstream in gear-planner either. The
 *  gap is STATED here rather than papered over by guessing a pack from a quest
 *  name: "The Twilight Forge" is a quest and "Ritual Table" is a crafting
 *  station, and no pattern separates them reliably. */
function farmingPanel(plan, acquired, opts) {
  if (!plan) return `<p class="dd-none muted">No build to plan a farming run for.</p>`;
  const o = opts || {};
  const got = acquired || {};
  const c = plan.counts;
  const tick = (i) => {
    const on = !!got[i.item];
    return `<li class="farm-item${on ? " is-got" : ""}">
      <label class="farm-check">
        <input type="checkbox" class="farm-tick" data-item="${esc(i.item)}"${on ? " checked" : ""} />
        <span class="farm-item-name">${esc(i.item)}${i.copies > 1 ? ` <span class="farm-copies">×${esc(i.copies)}</span>` : ""}</span>
      </label>
      <span class="farm-item-meta">${esc(i.slots.join(", "))}${i.ml != null ? ` · ML ${esc(i.ml)}` : ""}</span>
      ${i.noDropSource ? `<span class="farm-nodrop">${esc(Proj.NO_DROP_SOURCE_WORDING)}</span>` : ""}
    </li>`;
  };
  const sourceBlock = (s) => `<section class="farm-source">
    <h4 class="farm-source-name">${esc(s.name)}
      <span class="farm-source-count">${esc(s.itemCount)} item${s.itemCount === 1 ? "" : "s"}</span></h4>
    <p class="farm-pack muted">Adventure pack not recorded</p>
    <ul class="farm-items">${s.items.map(tick).join("")}</ul>
  </section>`;

  const unsourced = plan.unsourced.length
    ? `<section class="farm-source is-gap">
        <h4 class="farm-source-name">Source not recorded
          <span class="farm-source-count">${esc(plan.unsourced.length)} item${plan.unsourced.length === 1 ? "" : "s"}</span></h4>
        <p class="farm-pack muted">The dataset has no location for these. That is a gap in the data, not a claim
          that they cannot be found.</p>
        <ul class="farm-items">${plan.unsourced.map(tick).join("")}</ul>
      </section>` : "";

  // Augments get their own section and an explicit disclaimer, because the
  // dataset carries acquisition data for exactly none of them. Listing them
  // beside the quests would imply a source this list does not have.
  const augs = plan.augments.length
    ? `<section class="farm-source is-gap">
        <h4 class="farm-source-name">Augments to slot
          <span class="farm-source-count">${esc(plan.augments.length)}</span></h4>
        <p class="farm-pack muted">No augment in the dataset carries acquisition data, so this says which augment
          goes where — not where to find it.</p>
        <ul class="farm-items">${plan.augments.map((a) => `<li class="farm-item farm-plain">
          <span class="farm-item-name">${esc(a.name)}</span>
          <span class="farm-item-meta">→ ${esc(a.host)}</span></li>`).join("")}</ul>
      </section>` : "";

  const crafts = plan.crafts.length
    ? `<section class="farm-source">
        <h4 class="farm-source-name">Crafting steps
          <span class="farm-source-count">${esc(plan.crafts.length)}</span></h4>
        <p class="farm-pack muted">Do these once you have the item in hand.</p>
        <ul class="farm-items">${plan.crafts.map((x) => `<li class="farm-item farm-plain">
          <span class="farm-item-name">${esc(x.label)}</span>
          <span class="farm-item-meta">→ ${esc(x.host)}</span></li>`).join("")}</ul>
      </section>` : "";

  return `<p class="wz-help">Everything this build needs, grouped by where it comes from and ordered by how much
      each place gives you — so the run at the top is the one worth doing first. Tick things off as you get them;
      the ticks are saved with this character.</p>
    <div class="farm-summary">
      <span><strong>${esc(c.items)}</strong> items</span>
      <span><strong>${esc(c.sources)}</strong> sources</span>
      ${c.unsourced ? `<span><strong>${esc(c.unsourced)}</strong> without a recorded source</span>` : ""}
      ${c.crafts ? `<span><strong>${esc(c.crafts)}</strong> crafting steps</span>` : ""}
    </div>
    <p class="farm-disclosure">Adventure pack is not in the dataset yet, so these are grouped by the source name the
      DDO wiki records — a quest, a raid, a vendor, a crafting station or an event, in its own words. Nothing here
      guesses which pack a quest belongs to.</p>
    <div class="farm-actions">
      <button class="btn ghost farm-copy" type="button">Copy as Markdown</button>
      <button class="btn ghost farm-print" type="button">Print</button>
      <span class="farm-note" role="status">${o.note ? esc(o.note) : ""}</span>
    </div>
    <div class="farm-groups">${plan.sources.map(sourceBlock).join("")}${unsourced}${augs}${crafts}</div>`;
}

// Wire the result sub-tabs (Ranked / Sets / …). Re-run on every render.
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
  module.exports = { renderResults, buildViews, bundlesBlock, utilityCard, renderAltCards, affixLabel, assignAugments, assignDinoInserts, satisfiedSets, slotSetNames, satisfiedSetDetail, attributionByTarget, whyThis, itemContributions, saturatedStats, saturationLineFor, whyThisNote, activeSetDetail, attributionList, coverageNote, slotPosition, paperdollSlot, equippedRow, equippedBody, artifactNotice, artifactNoticeEntries, artifactsIncludedByPin, boundNotice, boundNoticeEntries, zeroSourceNotice, zeroSourceNoticeEntries, outbidNotice, outbidTargets, saturationNotice, staleSnapshotNotice, ceilingChip, emptySlotNotice, absorptionQuarantineNotice, craftingExcludedNotice, augCeilingNotice, blockNotice, upgradeNotice, versionsPanel, versionDiffView, farmingPanel, noticeDescriptors, noticePanel, noticeSummaryMarkers, NOTICE_TABLE, NOTICE_ENTRY_JUMPS, NOTICE_ENTRY_SUBJECTS, NOTICE_CLASS_TAG, NOTICE_CLASS_ORDER, incidentalStats, poolStatNames: _resultsPoolStatNames, affixChipClass, rankedStatSet, grantLinkClass, esc, safeUrl,
    // #471 — the card's row language: the three-column row itself, the two
    // in-place slot sections, and the foot-note family.
    stackLine, subLines, augmentSection, craftSection, craftRowsFor, hasAugmentSlots, recNote, LINE_MARK, SUN_MOON_GLYPH,
    // #472 — the set-yielding families, rendered on the card.
    setMembershipSection, setRowsFor,
    // #472 — exported so a test can build the same credited-set index the
    // renderers read, rather than hand-rolling its shape and drifting from it.
    itemContribIndex, bundlesBlock,
    // #481 — the concession control's render gate, exported so a test can prove
    // WHERE it appears without driving a DOM.
    concessionControl };
}
