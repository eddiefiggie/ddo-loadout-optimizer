// Shared content projection (U1 of the universal-exports plan). The single source
// that turns a solved build — live (`build.*`) or a saved record's snapshot
// (`rec.snapshot.*`) — into the resolved content model every surface renders from:
// the loadout (worn affixes + assigned augments + crafting upgrades), the completed
// set bonuses, and the priority-stat attribution. `results.js` binds the pure
// primitives from here (so the live views and the exports can't drift); `exporters.js`
// calls `project(rec)` for all five outputs. Pure data — no HTML, no solve. IIFE with
// a namespaced global `Projection`, dual-exported for Node tests.
(function () {
  "use strict";

  // Crafting-system label registry (single source of truth for the membership fork).
  // Global in the browser (loaded before projection.js); require()'d in Node tests.
  const Craft = (typeof CraftingSystems !== "undefined") ? CraftingSystems
    : (typeof require !== "undefined" ? require("./crafting-systems.js") : null);

  // ---- pure primitives (moved verbatim from results.js so there is one definition) ----

  // Shared affix formatter. Reads NAME/TYPE native-first (`{name,type}`) with the
  // legacy `{stat,bonus_type}` fallback, because it formats native item affixes AND
  // the not-yet-native crafting-pool / set-bonus / Dino affixes (and any pre-overhaul
  // persisted item).
  function affixLabel(a) {
    if (!a) return "";
    const name = a.name != null ? a.name : a.stat;
    const bt = a.type != null ? a.type : a.bonus_type;
    if (bt === "boolean") return `✓ ${name}`;
    const type = bt && bt !== "Enhancement" ? ` ${bt}` : "";
    return `${name} +${a.value}${a.unit === "pct" ? "%" : ""}${type}`;
  }

  // Item-level ML read native-first (`ml`), legacy `minimum_level` fallback.
  function itemMl(v) { return (v && v.ml != null) ? v.ml : (v && v.minimum_level); }

  /** Which of a variant's affixes hit the query targets (for the "why" column). */
  function contributingAffixes(variant, targets) {
    const t = new Set(targets);
    return (variant.affixes || []).filter((a) => t.has(a.name != null ? a.name : a.stat));
  }

  /** Reconstruct a concrete augment->item assignment from the solver's aggregate
   *  per-color-capacity placements. Walk equipped items in order and drop each placed
   *  augment into the first item with remaining open capacity of the slot color it
   *  consumed. Returns { byIndex, unplaced, freeByIndex }. */
  function assignAugments(chosen, augmentsPlaced, setAugmentsPlaced) {
    const remaining = chosen.map((c) => {
      const m = new Map();
      for (const col of ((c.variant.augment_slots_norm || {}).colors) || []) m.set(col, (m.get(col) || 0) + 1);
      return m;
    });
    // Reserve the Colorless slots the solver already filled with set-augment copies
    // (setAugmentsPlaced[].host is a variant_id) BEFORE greedily assigning ordinary
    // augments, or an item whose only Colorless slot holds a set copy would be
    // double-booked (ordinary augment attributed to a full slot) and reported as free.
    for (const sa of setAugmentsPlaced || []) {
      const i = chosen.findIndex((c) => c.variant && c.variant.variant_id === sa.host);
      if (i >= 0 && (remaining[i].get("Colorless") || 0) > 0) remaining[i].set("Colorless", remaining[i].get("Colorless") - 1);
    }
    const byIndex = new Map();
    const unplaced = [];
    for (const aug of augmentsPlaced || []) {
      const want = aug.slot_color || aug.color;
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
    const freeByIndex = new Map();
    remaining.forEach((m, i) => {
      const cols = [];
      for (const [col, n] of m) for (let k = 0; k < n; k++) cols.push(col);
      if (cols.length) freeByIndex.set(i, cols);
    });
    return { byIndex, unplaced, freeByIndex };
  }

  /** Dino-insert -> item assignment (mirrors assignAugments). Slots keyed by
   *  `dino_type||category`. */
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

  /** Per-target contributor attribution. Reads the solver's breakdown (host slot for
   *  worn + item-crafts, yielding slots for sets) and fills the augment host slot from
   *  the augment reconstruction. Returns { stat: [{ bonus_type, value, source,
   *  sourceKind, slots, hostIds, isSet }], ... } — presentation only. */
  function attributionByTarget(result, augAssign) {
    const breakdown = result.breakdown || {};
    augAssign = augAssign || assignAugments(result.chosen, result.augmentsPlaced, result.setAugmentsPlaced);
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

  /** Which ranked targets a specific equipped item wins, and by how much. `item` is
   *  { slot, variant_id }. Returns [{ stat, value, viaSet, boolean }], highest first;
   *  empty for a filler/tie-break pick. */
  function whyThis(result, item, attr) {
    attr = attr || attributionByTarget(result);
    const wins = [];
    for (const stat of Object.keys(attr)) {
      let val = 0, viaSet = false, boolean = false;
      for (const p of attr[stat]) {
        if ((p.hostIds || []).includes(item.variant_id)) {
          val += p.value;
          if (p.isSet) viaSet = true;
          if (p.bonus_type === "boolean") boolean = true;
        }
      }
      if (val > 0) wins.push({ stat, value: val, viaSet, boolean });
    }
    wins.sort((a, b) => b.value - a.value);
    return wins;
  }

  /** Variant_ids of host items that carry a solver-placed Set Augment. A Set Augment
   *  overrides ("suppresses") the host item's OWN named set(s) — the solver already
   *  dropped that set from setsActive/totals, so the set-satisfaction primitives must
   *  not re-count the suppressed host's intrinsic membership (U7). Hosts are read from
   *  `setAugmentsPlaced[].host` (solver-DECIDED, not greedily reconstructed, KTD-6). */
  function suppressedHostIds(build) {
    const s = new Set();
    for (const sa of (build && build.setAugmentsPlaced) || []) if (sa.host) s.add(sa.host);
    return s;
  }

  /** Sets actually complete in the equipped loadout — the glow signal. Union of
   *  (1) a static set whose equipped piece count meets its lowest piece-threshold tier
   *  and (2) `setsActive` (runtime joker/membership completions). A host carrying a
   *  placed Set Augment does not count toward its own intrinsic set (U7 suppression);
   *  pass `suppressed` (a Set of host variant_ids) to honor it. */
  function satisfiedSets(chosen, setsActive, suppressed) {
    suppressed = suppressed || new Set();
    const counts = new Map();
    const minReq = new Map();
    for (const c of chosen || []) {
      const isSuppressed = suppressed.has(c.variant.variant_id);
      for (const sb of c.variant.set_bonus || []) {
        if (sb.set && !isSuppressed) counts.set(sb.set, (counts.get(sb.set) || 0) + 1);
      }
      for (const tier of c.variant.parsed_set_bonuses || []) {
        if (tier.pieces_required == null) continue;
        const cur = minReq.get(tier.set);
        if (cur == null || tier.pieces_required < cur) minReq.set(tier.set, tier.pieces_required);
      }
    }
    const out = new Set();
    for (const [set, need] of minReq) if ((counts.get(set) || 0) >= need) out.add(set);
    for (const s of setsActive || []) if (s.set) out.add(s.set);
    return out;
  }

  /** The set(s) an equipped piece belongs to. When `satisfied` is passed, only
   *  actually-complete sets are returned. */
  function slotSetNames(v, satisfied) {
    const names = [...new Set((v.set_bonus || []).map((s) => s.set).filter(Boolean))];
    return satisfied ? names.filter((n) => satisfied.has(n)) : names;
  }

  /** Active set bonuses with the stats they grant and the slots that yield them. */
  function activeSetDetail(result) {
    const yields = new Map();
    const tierAffixes = new Map();
    for (const c of result.chosen || []) {
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
      affixes: tierAffixes.get(`${s.set}||${s.pieces_required}`) || s.affixes || [],
    }));
  }

  /** Every set complete in the build: granted affixes + composing member item names. */
  function satisfiedSetDetail(build) {
    const counts = new Map();
    const members = new Map();
    const tiers = new Map();
    const suppressed = suppressedHostIds(build);   // U7 — a Set-Augment host doesn't count toward its own set
    for (const c of build.chosen || []) {
      const isSuppressed = suppressed.has(c.variant.variant_id);
      for (const sb of c.variant.set_bonus || []) {
        if (!sb.set || isSuppressed) continue;
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
      let best = null;
      for (const [n, affixes] of byN) if (n <= have && (best == null || n > best.pieces)) best = { pieces: n, affixes };
      if (best) bySet.set(set, { set, pieces: best.pieces, affixes: best.affixes, members: members.get(set) || [] });
    }
    for (const s of activeSetDetail(build)) {
      if (bySet.has(s.set)) continue;
      bySet.set(s.set, { set: s.set, pieces: s.pieces, affixes: s.affixes, members: members.get(s.set) || [] });
    }
    return [...bySet.values()];
  }

  // ---- craft maps + the single label function (KTD6) ----

  // Group placement lists by their host item, keyed by variant_id (nc/roll/vik/seal/
  // tf/gs) or host (joker/membership); dino/aug come pre-assigned by index. Extracted
  // verbatim from results.js buildViews so results.js and the exports share one builder.
  function buildCraftMaps(build, augAssign, dinoAssign) {
    augAssign = augAssign || assignAugments(build.chosen, build.augmentsPlaced, build.setAugmentsPlaced);
    dinoAssign = dinoAssign || assignDinoInserts(build.chosen, build.dinoPlaced);
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
    const membershipByHost = new Map();
    for (const m of build.membershipPlaced || []) {
      if (!membershipByHost.has(m.host)) membershipByHost.set(m.host, []);
      membershipByHost.get(m.host).push(m);
    }
    // Placed Set Augments, grouped by their solver-DECIDED host variant_id (KTD-6:
    // read `setAugmentsPlaced[].host` verbatim — do NOT run them through the greedy
    // augment reconstruction, whose host could disagree with the item the solver
    // actually suppressed).
    const setAugByHost = new Map();
    for (const s of build.setAugmentsPlaced || []) {
      if (!setAugByHost.has(s.host)) setAugByHost.set(s.host, []);
      setAugByHost.get(s.host).push(s);
    }
    return {
      augAssign, dinoAssign,
      ncByItem: byItemMap(build.ncPlaced), rollByItem: byItemMap(build.rollPlaced),
      vikByItem: byItemMap(build.vikPlaced), sealByItem: byItemMap(build.sealPlaced),
      tfByItem: byItemMap(build.tfPlaced), gsByItem: byItemMap(build.gsPlaced), jokerByHost,
      membershipByHost, setAugByHost,
    };
  }

  // One craft option's value label (e.g. "Constitution +15") — the unit inside a
  // family label. Mirrors results.js craftLbl minus its esc() wrapper (callers escape).
  function craftValue(o) {
    return affixLabel({ stat: o.stat, bonus_type: o.bonus_type, value: o.value, unit: o.unit || "flat" });
  }

  // The single, unescaped label for one crafting placement (KTD6). Membership routes
  // through the CraftingSystems registry (Vecna "Awaken" vs Dino "Slot Set Bonus");
  // every other family keeps its literal template, moved verbatim from
  // results.js craftSlotChips so results.js stays byte-identical when it wraps this in
  // a single esc(). `results.js` re-applies esc(); each text exporter applies its own
  // escaper — this function never escapes.
  function craftLabel(o, family) {
    switch (family) {
      case "dino": {
        const affixes = (o.affixes && o.affixes.length) ? o.affixes : [o];
        const label = affixes.map(craftValue).join(", ");
        return `${o.dino_type}: ${o.name ? o.name + ", " : ""}${label}`;
      }
      case "nc": return `Nearly Completed: ${craftValue(o)}`;
      case "roll": return `Choice: ${craftValue(o)}`;
      case "vik": return `Slot ${o.slot_type} Viktranium augment: ${craftValue(o)}`;
      case "seal": return `Sealed in ${o.seal_type}: ${craftValue(o)}`;
      case "tf": return `Thunder-Forged T${o.tier}: ${craftValue(o)}`;
      case "gs": return `Green Steel: ${craftValue(o)}`;
      case "joker": return `Wildcard set: ${o.set}`;
      case "augmentset": {
        // A solver-placed Set Augment (host is solver-DECIDED, read from
        // setAugmentsPlaced — never greedily reconstructed, KTD-6). When the host
        // item is itself a member of a named set, that own set is suppressed while
        // the augment occupies it (the solver already dropped it from setsActive),
        // so name the suppression inline — carrying it into every text export.
        const supp = (o.suppresses && o.suppresses.length) ? ` (suppresses ${o.suppresses.join(", ")})` : "";
        return `Set Augment: ${o.set}${supp}`;
      }
      case "membership": {
        const sysId = (Craft && Craft.systemForStation(o.station)) || "isle-of-dread-set-bonus";
        return Craft ? Craft.actionLabel(sysId, { set_name: o.set }) : `Slot Set Bonus augment: ${o.set}`;
      }
      default: return craftValue(o);
    }
  }

  // Is a placed augment a Lunar or Solar (Sun/Moon) augment? Presence-only, detected
  // from the augment's color/slot/name; returns null when no signal (no fabrication).
  function lunarSolar(aug) {
    const s = `${aug.slot_color || ""} ${aug.color || ""} ${aug.variant_id || ""}`;
    if (/\b(lunar|moon)\b/i.test(s)) return "Lunar";
    if (/\b(solar|sun)\b/i.test(s)) return "Solar";
    return null;
  }

  // ---- character-constraint helpers (moved from exporters.js; exporters delegates back) ----

  const ARMOR = { cloth: "Cloth", light: "Light", medium: "Medium", heavy: "Heavy" };
  const STYLE = { "one-hand": "One-hand / Dual-wield", thf: "Two Handed Fighting", ranged: "Bow", crossbow: "Crossbow + Rune Arm", unarmed: "Unarmed" };
  const OATH = { druid: "Druid — no metal (cloth/light approx.)" };
  const POOL = { all: "All gear", owned: "Only what I own" };

  function weaponLine(i) {
    const style = STYLE[i.style] || i.style || "";
    const types = Array.isArray(i.weaponTypes) ? i.weaponTypes : [];
    if (!style && !types.length) return "";
    if (style && types.length) return `${style}: ${types.join(", ")}`;
    return style || types.join(", ");
  }
  function offHandLine(i) {
    const set = Array.isArray(i.offHand) ? i.offHand : [];
    return set.map((t) => (t === "empty" ? "Empty" : t)).join(", ");
  }
  function offHandWeaponLine(i) {
    return (Array.isArray(i.offHandWeapons) ? i.offHandWeapons : []).join(", ");
  }

  // Name + character constraints as [label, value] pairs — the shared export header.
  function constraintPairs(rec) {
    const i = (rec && rec.inputs) || {};
    return [
      ["Character", rec && rec.name],
      ["ML", i.ml == null ? "" : String(i.ml)],
      ["Race", i.race || ""],
      ["Alignment", i.alignment || ""],
      ["Armor", i.armor ? (ARMOR[i.armor] || i.armor) : ""],
      ["Oath", OATH[i.oath] || ""],
      ["Weapon", weaponLine(i)],
      ["Off hand", offHandLine(i)],
      ["Off-hand weapon", offHandWeaponLine(i)],
      // plan 003 U1 (R9) — the Two Weapon Fighting declaration travels with a shared
      // loadout. Empty string when undeclared, so the trailing filter drops the line
      // rather than printing "Two Weapon Fighting: No" on every non-dual-wield build.
      ["Two Weapon Fighting", i.twoWeaponFighting ? "Declared" : ""],
      ["Gear pool", POOL[i.pool] || i.pool || "all"],
      ["Priorities", (i.priorities || []).join(" > ")],
    ].filter(([, v]) => v !== "" && v != null);
  }
  function constraintLines(rec) {
    return constraintPairs(rec).map(([k, v]) => `${k}: ${v}`);
  }

  // ---- the resolved-view assembler ----

  // One placed augment as a resolved-view entry: its slot color, Lunar/Solar cue,
  // name, and granted affixes.
  function augView(aug) {
    return {
      color: aug.color || null,
      slotColor: aug.slot_color || null,
      lunarSolar: lunarSolar(aug),
      name: aug.variant_id,
      affixes: aug.affixes || [],
    };
  }

  // The crafting upgrades applied to one equipped item, each with its family + label.
  function craftingForItem(v, idx, maps) {
    const out = [];
    for (const d of maps.dinoAssign.byIndex.get(idx) || []) out.push({ family: "dino", label: craftLabel(d, "dino") });
    for (const n of maps.ncByItem.get(v.variant_id) || []) out.push({ family: "nc", label: craftLabel(n, "nc") });
    for (const r of maps.rollByItem.get(v.variant_id) || []) out.push({ family: "roll", label: craftLabel(r, "roll") });
    for (const n of maps.vikByItem.get(v.variant_id) || []) out.push({ family: "vik", label: craftLabel(n, "vik") });
    for (const n of maps.sealByItem.get(v.variant_id) || []) out.push({ family: "seal", label: craftLabel(n, "seal") });
    for (const n of maps.tfByItem.get(v.variant_id) || []) out.push({ family: "tf", label: craftLabel(n, "tf") });
    for (const n of maps.gsByItem.get(v.variant_id) || []) out.push({ family: "gs", label: craftLabel(n, "gs") });
    for (const j of maps.jokerByHost.get(v.variant_id) || []) out.push({ family: "joker", label: craftLabel(j, "joker") });
    for (const m of maps.membershipByHost.get(v.variant_id) || []) out.push({ family: "membership", label: craftLabel(m, "membership"), station: m.station || null });
    // Solver-placed Set Augments on this host (KTD-6: host read from the solve, not
    // reconstructed). Each of the (up to 3) copies lives on a different item, so a
    // host shows its one copy. The host's own named set is suppressed once — annotate
    // it on the first copy so the note isn't repeated when a host carries several.
    const setAugs = (maps.setAugByHost && maps.setAugByHost.get(v.variant_id)) || [];
    const suppresses = setAugs.length ? slotSetNames(v) : [];
    setAugs.forEach((s, i) => out.push({
      family: "augmentset",
      label: craftLabel({ set: s.set, suppresses: i === 0 ? suppresses : [] }, "augmentset"),
      set: s.set, host: s.host, wiki_url: s.wiki_url || null,
      suppresses: i === 0 ? suppresses : [],
    }));
    return out;
  }

  /** Turn a saved record into the resolved content model every output renders from.
   *  Header from `rec.name`/`rec.inputs`; loadout/sets/attribution from `rec.snapshot`.
   *  Attribution covers the ranked priority stats only (in priority order). */
  function project(rec) {
    const snap = (rec && rec.snapshot) || {};
    const chosen = snap.chosen || [];
    const augAssign = assignAugments(chosen, snap.augmentsPlaced, snap.setAugmentsPlaced);
    const dinoAssign = assignDinoInserts(chosen, snap.dinoPlaced);
    const maps = buildCraftMaps(snap, augAssign, dinoAssign);
    const attr = attributionByTarget(snap, augAssign);
    const priorities = (rec && rec.inputs && rec.inputs.priorities) || [];

    const suppressed = suppressedHostIds(snap);
    const loadout = chosen.map((c, idx) => {
      const v = c.variant || {};
      return {
        slot: c.slot,
        item: v.variant_id,
        ml: itemMl(v),
        affixes: v.affixes || [],
        augments: (augAssign.byIndex.get(idx) || []).map(augView),
        crafting: craftingForItem(v, idx, maps),
        // The item's own named set(s) suppressed because it hosts a placed Set Augment
        // (empty otherwise). The placement + this suppression also ride in `crafting`
        // (family "augmentset") so every text export surfaces them without change.
        suppressedSets: suppressed.has(v.variant_id) ? slotSetNames(v) : [],
      };
    });

    const sets = satisfiedSetDetail(snap).map((s) => ({ set: s.set, pieces: s.pieces, affixes: s.affixes }));

    const attribution = {};
    for (const stat of priorities) {
      const total = (snap.effective && snap.effective[stat] != null) ? snap.effective[stat] : 0;
      const cap = (snap.capped && snap.capped[stat] != null) ? snap.capped[stat] : null;
      const sources = (attr[stat] || []).map((p) => ({
        source: p.source, kind: p.sourceKind, value: p.value,
        bonusType: p.bonus_type, slots: p.slots, viaSet: p.isSet,
      }));
      attribution[stat] = { total, cap, sources };
    }

    return {
      character: { name: rec && rec.name, constraints: constraintPairs(rec),
        // U4 (R9) — the declared-credit qualifier travels with the shared
        // content model, so every export renders it from the same source the
        // app's bound notice does. Empty array when nothing was declared.
        creditNotice: creditNoticeLines(snap) },
      loadout, sets, attribution,
    };
  }

  /** U4 (R9, R10) — the declared-credit qualifier, as plain sentences.
   *
   *  ONE source for the app notice and every export. `boundNotice` returns HTML
   *  from results.js and is not part of this content model, so a qualifier written
   *  only there would be solve-visible but share-invisible: a recipient would see
   *  a build asserting an optimal loadout with a player-typed number folded into
   *  its totals and nothing saying the number was unverified. That is the failure
   *  mode this repo holds as a standing invariant.
   *
   *  Reads `creditReport` (plain JSON on the result), never the live program, so a
   *  restored character discloses identically without re-solving (KTD6).
   */
  function creditNoticeLines(result) {
    const report = (result && result.creditReport) || [];
    if (!report.length) return [];
    const lines = [];
    const label = (c) => `${c.value} ${c.bonus_type} ${c.stat}`;

    lines.push(`You declared ${report.map(label).join(", ")} as already held. ` +
      `The optimizer did not verify ${report.length > 1 ? "those numbers" : "that number"} — ` +
      `${report.length > 1 ? "they are" : "it is"} yours, and the loadout below is optimal given ` +
      `${report.length > 1 ? "them" : "it"}.`);

    // R10, narrowed per A3: name the best gear the credit beat, read off the solve
    // already run rather than a second credit-free solve. "In your pool" rather
    // than "available" — the value is the best the build could field, and saying
    // more than that would overclaim.
    for (const c of report) {
      if (c.beatGear != null) {
        // No parentheses: markdown escapes them, so raw text people paste into
        // forums reads "your gear pool \(5\)". Same trap as DECLARED_LABEL.
        lines.push(`Your declared ${c.bonus_type} ${c.stat} of ${c.value} beat your best ` +
          `${c.bonus_type} ${c.stat} gear, which is ${c.beatGear}, so that slot went to another priority.`);
      }
    }
    // R9's floor half. Grouped by STAT, not per credit: two credits on one stat
    // each carry the same floor, and one sentence per credit would read as two
    // independent explanations of the same verdict.
    //
    // The claim is ATTRIBUTION, not necessity. Saying "your gear alone reaches N"
    // would assert what a credit-free solve produces, which A3 forbids computing —
    // and that solve is free to pick different gear entirely, so the assertion was
    // demonstrably false. What the data supports is what the shown loadout's gear
    // supplies, with the declaration counted alongside it.
    const byStat = new Map();
    for (const c of report) {
      if (c.floor == null) continue;
      if (!byStat.has(c.stat)) byStat.set(c.stat, []);
      byStat.get(c.stat).push(c);
    }
    for (const [stat, cs] of byStat) {
      const declared = cs.map((c) => `${c.value} ${c.bonus_type}`).join(" and ");
      lines.push(`Your floor of ${cs[0].floor} ${stat} counts the declared ${declared} — ` +
        `the gear in this loadout supplies ${cs[0].gearInLoadout}.`);
    }
    return lines;
  }

  const api = {
    // resolved-view assembler
    project, creditNoticeLines,
    // pure primitives (results.js binds these; single definition, no drift)
    affixLabel, itemMl, contributingAffixes, assignAugments, dinoInsertKey, assignDinoInserts,
    attributionByTarget, whyThis, satisfiedSets, suppressedHostIds, slotSetNames, activeSetDetail, satisfiedSetDetail,
    // craft + cue helpers
    buildCraftMaps, craftLabel, craftValue, lunarSolar,
    // constraint header helpers (exporters delegates to these)
    constraintPairs, constraintLines,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Projection = api;
})();
