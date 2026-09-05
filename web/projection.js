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

  // #91 (U6) — the Utility tier's display name, read from model.js (single
  // definition). Browser global; Node require — the same bridge results.js uses.
  const UTILITY_NAME = (typeof UTILITY_SENTINEL !== "undefined") ? UTILITY_SENTINEL
    : (typeof require !== "undefined" ? require("./model.js").UTILITY_SENTINEL : "Utility effects");

  // #335 U4 — the duplicate-ring id helpers, same bridge as above: browser global
  // when model.js is loaded ahead of this file, require()'d under node.
  function _modelModule() {
    if (typeof isTwinId !== "undefined") return { isTwinId, originalIdOf };
    if (typeof require !== "undefined") { try { return require("./model.js"); } catch (e) { /* absent */ } }
    return null;
  }

  // #346 (U4) — the ladder's normalizer, over the same bridge. Fails open to the
  // top rung so a hand-edited backup produces a wrong-but-harmless notice rather
  // than throwing inside the projection every surface reads from.
  const _rungOf = (typeof craftingRung !== "undefined") ? craftingRung
    : (typeof require !== "undefined" ? require("./model.js").craftingRung : () => "everything");
  // #683 — the disclosed-name-split lookup, over the same bridge. Fails open to
  // "no family" so a hand-edited backup renders no notice rather than throwing
  // inside the projection every surface reads from.
  const _splitMechanicFor = (typeof splitMechanicFor !== "undefined") ? splitMechanicFor
    : (typeof require !== "undefined" ? require("./model.js").splitMechanicFor
      : () => null);

  const _isSolarLunarColor = (typeof isSolarLunarColor !== "undefined") ? isSolarLunarColor
    : (typeof require !== "undefined" ? require("./model.js").isSolarLunarColor
      : (c) => c === "Sun" || c === "Moon");

  /** Size of a collection that reaches this layer as a Set (live query) or an
   *  array (saved record). Returns 0 for absent/unrecognized shapes rather than
   *  throwing — a projection feeding five surfaces must not die on a hand-edited
   *  backup. */
  function _countOf(c) {
    if (!c) return 0;
    if (typeof c.size === "number") return c.size;      // Set / Map
    if (Array.isArray(c)) return c.length;
    return 0;
  }

  // ---- pure primitives (moved verbatim from results.js so there is one definition) ----

  // The key each expansion family stamps on every affix it emits, naming the
  // enchantment the affix came from. Spelled once here and imported from
  // `src/spell_focus.py`'s `PROVENANCE_KEY` on the build side — a respelling on
  // either side would silently stop grouping and quietly restore the expanded shape.
  const PROVENANCE_KEY = "via";

  // #353 — the ONE presence predicate. Every surface used to inline
  // `=== "boolean"` and the pipeline only ever emits `"Bool"`, so the presence
  // branch was dead everywhere at once: Browse, Results attribution, and every
  // export rendered `Ghostly +1 Bool` instead of `✓ Ghostly`. Five tests pinned
  // the correct output and passed, each on a hand-built fixture typed
  // `"boolean"` — a value no writer produces.
  //
  // Both spellings are accepted rather than one being canonicalized at the
  // seam: `"Bool"` is what the gear-planner catalog types and what the solver
  // carries, while `"boolean"` is what `src/affix_parser.py`'s curated
  // allowlist path would emit if the build ever installed one (it does not
  // today, so that path is inert). Canonicalizing in `normalizeAffix` would
  // reach stored and exported shapes; a predicate does not. Reads TYPE
  // native-first with the legacy `bonus_type` fallback, exactly as
  // `affixLabel` does, so it accepts an item affix, a solver contribution, or
  // a pool option interchangeably.
  const PRESENCE_TYPES = ["Bool", "boolean"];
  function isPresenceType(bt) { return PRESENCE_TYPES.indexOf(bt) !== -1; }
  function isPresence(a) {
    if (!a) return false;
    return isPresenceType(a.type != null ? a.type : a.bonus_type);
  }

  // Shared affix formatter. Reads NAME/TYPE native-first (`{name,type}`) with the
  // legacy `{stat,bonus_type}` fallback, because it formats native item affixes AND
  // the not-yet-native crafting-pool / set-bonus / Dino affixes (and any pre-overhaul
  // persisted item).
  function affixLabel(a, opts) {
    if (!a) return "";
    const name = a.name != null ? a.name : a.stat;
    // A COLLAPSED expansion whose members do not share one magnitude (see
    // `collapseExpansions`). `parts` holds the member labels this same function
    // already produced, so the enchantment is named once and its members are
    // listed rather than reduced to a number the data does not have.
    if (Array.isArray(a.parts) && a.parts.length) return `${name}: ${a.parts.join(", ")}`;
    const bt = a.type != null ? a.type : a.bonus_type;
    // A presence affix has no magnitude, so the label carries a mark instead of a
    // number — otherwise an export renders `Ghostly +1 Bool`, which is the bug the
    // note above records. `opts.mark: false` omits it for the ONE surface that
    // already has a marker column: the card's rows draw a filled diamond in the
    // gutter, and printing a check beside it says "present" twice, in two
    // vocabularies, for one fact. Every export keeps the mark, because there is no
    // gutter there to carry it.
    if (isPresenceType(bt)) return (opts && opts.mark === false) ? name : `✓ ${name}`;
    const type = bt && bt !== "Enhancement" ? ` ${bt}` : "";
    return `${name} +${a.value}${a.unit === "pct" ? "%" : ""}${type}`;
  }

  /** U8 (R8) — collapse each EXPANSION back to the enchantment it came from.
   *
   *  One enchantment expands into several concrete affixes so the solver can match
   *  a ranked stat: a universal spell focus becomes seven schools, the ability
   *  umbrella becomes six abilities. That shape is a solver convenience, and it
   *  leaked — a Woeful Viktranium craft reported "+2 Enchantment" on one item and
   *  "+2 Necromancy" on the off-hand, which is ONE craft described by whichever
   *  school happened to be ranked. On an item-centric surface the player must read
   *  the name engraved on the item.
   *
   *  Members are grouped by `PROVENANCE_KEY`; an affix without one is a native
   *  effect already engraved under its own name and passes through BY IDENTITY.
   *  Each group collapses in place, at its first member's position, so unrelated
   *  affixes keep their order.
   *
   *  Two shapes come out, and the difference is deliberate. Where the members
   *  share one magnitude (spell focus, the ability umbrella) the entry carries
   *  that value. Where they do NOT — `Parrying` grants Armor Class at one
   *  magnitude and three saves at another; `Speed` and the boolean composites are
   *  the same — the entry lists its members via `parts` instead. Reducing those to
   *  a single number would publish a value the data never stated, which is the one
   *  thing this repo refuses to do.
   *
   *  NOT for Ranked Priorities (R11). That surface answers "where did this point
   *  come from" and must keep crediting the ranked stat individually; it names the
   *  enchantment through the attribution's own `via` field instead.
   */
  function collapseExpansions(affixes) {
    const out = [];
    const groupAt = new Map();
    for (const a of affixes || []) {
      const via = a && a[PROVENANCE_KEY];
      if (!via) { out.push(a); continue; }
      if (groupAt.has(via)) { out[groupAt.get(via)].members.push(a); continue; }
      groupAt.set(via, out.length);
      out.push({ via, members: [a] });
    }
    if (!groupAt.size) return out;
    // A group's magnitude is (value, unit, bonus type). Type is part of it on
    // purpose: two members at the same value but different bonus types are not
    // interchangeable, and naming one number for both would overclaim.
    const magnitude = (a) => `${a.value}||${a.unit || "flat"}||${a.type != null ? a.type : a.bonus_type}`;
    return out.map((e) => {
      if (!e || !e.members) return e;
      const ms = e.members;
      const uniform = ms.every((m) => magnitude(m) === magnitude(ms[0]));
      // `stat` as well as `name` so the legacy-shaped readers (craftValue and any
      // pre-overhaul persisted surface) resolve the enchantment name too. No
      // bonus type is emitted: it is already spoken by names like "Sacred Spell
      // Focus Mastery", and appending it would render the type twice.
      const base = { name: e.via, stat: e.via, [PROVENANCE_KEY]: e.via, collapsed: ms.length };
      return uniform
        ? { ...base, value: ms[0].value, unit: ms[0].unit || "flat" }
        : { ...base, parts: ms.map(affixLabel) };
    });
  }

  /** #340 (KTD5) — the equipped loadout's bundled enchantments: each engraved
   *  multi-stat bundle, named once per carrier occurrence.
   *
   *  Scans each chosen item's affixes AND each placed augment's affixes (augment
   *  affixes are never collapsed anywhere else), groups by the same
   *  `PROVENANCE_KEY` `collapseExpansions` groups by, and keeps ONLY groups with
   *  2+ members — the `via` key is also stamped by single-stat renames (the
   *  Legendary fold, DR qualifier retypes), and a one-line "bundle" would be a
   *  lie. Cross-added universals need no exclusion branch: cross-add lives in
   *  `metadata.cross_add` and on attribution parts, never on item/augment affix
   *  arrays, so the input excludes it by construction (a test guards that).
   *
   *  Emits its OWN entry shape carrying the full member list — per-member stat
   *  name, value, and bonus type — because `collapseExpansions`' collapsed
   *  entries deliberately drop those and cannot back a display row. Members are
   *  affix-shaped, so `affixLabel` renders them; per that function's rule, no
   *  group-level magnitude is ever fabricated. NOT derived from
   *  `attributionByTarget` — that map is rank-keyed and drops unranked members.
   *
   *  `augLookup` (optional Map variant_id -> augment record) resolves affixes
   *  for a placement record saved before placements carried them — the same
   *  fallback the set-like block uses.
   *
   *  `carrierKind` ("item" | "augment" | "craft") is external-facing metadata: no
   *  app surface reads it, but it rides the portable ddo-loadout/v1 JSON so a
   *  consumer can tell a worn carrier from a slotted one — not dead code.
   *
   *  #370 — the CRAFTED channels are scanned too. A bundle earned by crafting is
   *  the same engraved multi-stat enchantment as one printed on the item, and 43
   *  crafted options across three pools carry `via` (24 Viktranium, 12 Nearly
   *  Complete, 7 Dino inserts) — every one of them was invisible here, which is
   *  the "solve-visible but share-invisible" shape this repo has ruled against.
   *  Only the multi-affix channels are scanned: `rollPlaced`/`sealPlaced`/
   *  `lgsPlaced` entries are flat single-affix records with no `affixes` array,
   *  so they cannot reach the 2+ member floor by construction. Add them here if
   *  they ever gain multi-affix options — do not add them speculatively, or the
   *  coverage would be a claim no fixture can fail.
   *
   *  A crafted carrier renders as `host (source)` so the "from X" grammar every
   *  export already prints stays correct with no per-format edit; the machine
   *  -readable split rides alongside as `host`/`craftFamily`/`craftName`.
   */
  function craftBundleSource(o, family) {
    if (family === "vik") return `Slot ${o.slot_type} Viktranium augment`;
    // #371 — the per-item pools are a different in-game system from the category
    // menu, and `pool` is what separates them. Same fork `craftLabel` makes.
    if (family === "nc") return o.pool || "Nearly Completed";
    if (family === "dino") return `${o.dino_type} insert`;
    // Unreachable from the table below; named rather than silently interpolating
    // an undefined field into player-facing text if a channel is added carelessly.
    return "crafted";
  }

  /** #453 U1 (R7/R8/KTD1) — which stat names does each displayed affix cover?
   *
   *  `collapseExpansions` folds an expansion back to the ENCHANTMENT it came
   *  from, and its entries deliberately carry no member list: reducing
   *  non-uniform members to one magnitude "would publish a value the data never
   *  stated". That is right, and it is also exactly why a collapsed entry cannot
   *  be classified. Its `stat` is an enchantment name; the ranked targets are
   *  solver stat names. Matching them directly would file every collapsed bundle
   *  as incidental — including one carrying the player's rank-1 stat, silently,
   *  on a card that looks fine.
   *
   *  So this emits its OWN shape rather than widening the collapse. A Map from the
   *  key `collapseExpansions` uses (`via`, else the affix's own name) to the set
   *  of stat names underneath it. Callers ask "does this entry cover a ranked
   *  stat" instead of comparing labels.
   *
   *  This keeps groups of ONE: a single-stat rename still needs its real stat
   *  name to classify, and there is no "a one-line group would be a lie" hazard
   *  here because nothing is displayed from it.
   *
   *  `presence` rides along for the same reason `stats` does. A collapsed entry
   *  carries no bonus type at all — `collapseExpansions` drops it deliberately,
   *  since names like "Sacred Spell Focus Mastery" already speak it — so
   *  `isPresence` reads false on the ENTRY however presence-typed its members
   *  are. Boolean composites do collapse (they are the non-uniform `parts`
   *  case), so without this a collapsed Ghostly-style bundle would classify as
   *  incidental rather than utility.
   *
   *  Pure; unit-tested in tests/projection.test.js. */
  function affixStatCoverage(affixes) {
    const cover = new Map();
    for (const a of affixes || []) {
      if (!a) continue;
      // #626 — the PRODUCER now goes through the shared helper too. It carried a
      // second copy of the key rule inline, directly under a comment claiming one
      // helper existed "so the producer and every consumer cannot disagree about
      // it" — so the two could drift, and a fix applied to one would miss the other.
      const key = affixCoverageKey(a);
      if (key == null) continue;
      const own = affixOwnName(a);
      if (!cover.has(key)) cover.set(key, { stats: [], presence: false });
      const e = cover.get(key);
      if (own != null && e.stats.indexOf(own) === -1) e.stats.push(own);
      if (isPresence(a)) e.presence = true;
    }
    return cover;
  }

  /** #453 U1 — the key `affixStatCoverage` filed a DISPLAYED entry under.
   *  One helper so the producer and every consumer cannot disagree about it.
   *
   *  #626 — `stat` is preferred over `name`, and the order is the whole fix. On a
   *  WORN affix `name` IS the stat and there is no `stat` field, so nothing
   *  changes there. On a flat CRAFTING placement the two are different things:
   *  `name` is the menu option, `stat` is what it grants —
   *
   *      { name: "Essence Crafting: Charisma", stat: "Charisma", ... }
   *
   *  — and the contribution index every consumer tests against is keyed by STAT.
   *  Reading `name` first made the lookup miss, so a credited essence craft
   *  classified as `incidental` and drew the hollow ◇ on the card while actually
   *  paying into the player's top priority.
   *
   *  Measured across the four flat pools: `essence_crafting` (25) and `seal` (48)
   *  were broken; the two Legendary Green Steel pools (36 and 108, unified by #687) were correct only
   *  because their `name` happens to EQUAL their `stat`. Preferring `stat` fixes
   *  the first two and leaves the second two keyed identically, so they no longer
   *  depend on that coincidence holding.
   *
   *  The empty-string guard is its own half of the bug: all 48 seal records carry
   *  `name: ""`, and `"" != null` is true, so an empty name outranked a real stat.
   *  A blank is absence, not a key. */
  function affixCoverageKey(entry) {
    if (!entry) return null;
    return entry[PROVENANCE_KEY] || affixOwnName(entry);
  }

  /** #626 — an entry's OWN stat name, with NO provenance override applied.
   *
   *  Distinct from `affixCoverageKey` and the distinction is load-bearing: an
   *  expanded affix is FILED under its `via` (so the whole bundle classifies as
   *  one) but LISTS its members by their own names, and `affixStatCoverage` needs
   *  both at once — `{name: "Abjuration", via: "Sacred Spell Focus Mastery"}` keys
   *  to the mastery and reports the school. */
  function affixOwnName(entry) {
    if (!entry) return null;
    const pick = (x) => (x != null && x !== "") ? x : null;
    return pick(entry.stat) != null ? entry.stat : pick(entry.name);
  }

  // Item-level ML read native-first (`ml`), legacy `minimum_level` fallback.
  function itemMl(v) { return (v && v.ml != null) ? v.ml : (v && v.minimum_level); }

  /** #681 — `variant_id` -> the ML that host is CRAFTED at, for the hosts a build
   *  can only use by crafting them below their printed level.
   *
   *  Read from `essenceReport.craftedDown`, which the SOLVER already computes and
   *  which `essenceNoticeLines` already explains in prose. Deliberately not a
   *  second computation of `min(ml, cap)`: the render layer has neither the cap nor
   *  the crafting rung, the rule is inert unless the rung keeps the essence pool
   *  alive, and #611 already put the answer on the result. The bug this fixes was
   *  never a missing calculation — it was every per-item surface ignoring one the
   *  solve had already made. */
  function craftedMlIndex(result) {
    const idx = new Map();
    const r = result && result.essenceReport;
    for (const c of (r && r.craftedDown) || []) {
      if (c && c.item != null && c.craftedMl != null) idx.set(c.item, c.craftedMl);
    }
    return idx;
  }

  /** #681 — the ML a chosen item is actually WORN at, given that index.
   *
   *  For every ordinary item this is `itemMl(v)`. For an essence host crafted down
   *  it is the crafted level — which is also the level whose row of the effect
   *  curve the solve read, so the number shown and the numbers computed agree.
   *
   *  `browse.js` keeps showing native ML and should: browsing the catalog has no
   *  solve, no cap, and nothing to craft against. */
  function wornMl(v, craftedIdx) {
    const native = itemMl(v);
    if (!craftedIdx || !v) return native;
    const id = v.variant_id || v.source_item;
    const c = craftedIdx.get(id);
    return (c != null) ? c : native;
  }

  /** #469 — the name a gear card SHOWS, which is not the item's identity.
   *
   *  `variant_id` is the identity: the pin/block key, the export column, and the
   *  string a player pastes into the wiki. It keeps its `(level N)`
   *  disambiguator, because that is what separates the six catalog rows a
   *  multi-level item mints. The card is a different surface — it already
   *  carries an ML field two lines down, so repeating the same number inside the
   *  name is the card stating one fact twice in two formats.
   *
   *  Stripped ONLY when the parenthetical equals the item's own ML. Measured
   *  against the built dataset: all 1,326 `(level N)` / `(Level N)` variant ids
   *  match their own `ml` exactly and all sit at the end (optionally before a
   *  `[Crafted]` tag), so the equality test drops every one of them today — and
   *  a future id whose parenthetical means something else survives untouched
   *  rather than being silently rewritten. Every OTHER parenthetical the catalog
   *  carries is meaningful (`(Heroic)`, `(Legendary)`, `(legacy)`, `(2d6)`,
   *  `(round)`) and is left alone; this is not a general suffix stripper. */
  function displayItemName(v) {
    const id = String((v && (v.variant_id || v.source_item)) || "");
    const ml = itemMl(v);
    if (ml == null || !id) return id;
    return id.replace(/\s*\([Ll]evel\s+(\d+)\)/g,
      (whole, n) => (Number(n) === Number(ml) ? "" : whole)).trim();
  }

  /** Which of a variant's affixes hit the query targets (for the "why" column). */
  function contributingAffixes(variant, targets) {
    const t = new Set(targets);
    return (variant.affixes || []).filter((a) => t.has(a.name != null ? a.name : a.stat));
  }

  /** Reconstruct a concrete augment->item assignment from the solver's aggregate
   *  per-color-capacity placements. Walk equipped items in order and drop each placed
   *  augment into the first item with remaining open capacity of the slot color it
   *  consumed. Returns { byIndex, unplaced, freeByIndex }. */
  /** Per-item open-slot counts by color — shared by assignAugments and the
   *  canonicalization feasibility check, so the two can never drift. */
  /** #335 U4 (KTD7) — the ×2 collapse, as a RENDER-layer pass over already-assigned
   *  data. It deliberately does not touch the chosen list the data path uses.
   *
   *  Augment and insert assignment fills by chosen INDEX (`slotCountsByItem`,
   *  `assignAugments`, `assignDinoInserts`) and set-augment reservation matches on
   *  `host === variant_id`. The twin's distinct id is exactly what gives it its own
   *  index and its own physical slot supply, so collapsing before assignment would
   *  halve the ring's slots and orphan every twin-keyed record. Renderers call this
   *  last, and look per-copy records up by the indices it carries.
   *
   *  Returns one entry per DISPLAYED item: `{ slot, variant, count, indices }`,
   *  where `variant` is always the original (never the suffixed twin) and
   *  `indices` lists every chosen index the entry covers, in order, so a caller
   *  can still reach each copy's own augments. */
  function collapseTwins(chosen) {
    const M = _modelModule();
    const out = [];
    const byOriginal = new Map();      // original id -> entry in `out`
    (chosen || []).forEach((c, i) => {
      const id = (c.variant && (c.variant.variant_id || c.variant.source_item)) || "";
      const isTwin = M && M.isTwinId ? M.isTwinId(id) : false;
      const originalId = (M && M.originalIdOf) ? M.originalIdOf(id) : id;
      const key = c.slot + "||" + originalId;
      if (isTwin && byOriginal.has(key)) {
        const e = byOriginal.get(key);
        e.count += 1;
        e.indices.push(i);
        return;
      }
      const entry = { slot: c.slot, variant: c.variant, count: 1, indices: [i] };
      out.push(entry);
      if (!isTwin) byOriginal.set(key, entry);
      return;
    });
    return out;
  }

  /** #335 U4 (R6) — what a second copy actually contributes, derived rather than
   *  fixed. Stating "set membership and its own augments" as a constant sentence
   *  happens to be true only because no allowlisted ring currently carries a craft
   *  slot; deriving it keeps the receipt honest if one ever does. */
  function secondCopyContribution(entry, build) {
    if (!entry || entry.count < 2) return null;
    const parts = [];
    const id = (entry.variant && (entry.variant.variant_id || entry.variant.source_item)) || "";
    const sets = (entry.variant.set_bonus || []).map((sb) => sb && sb.set).filter(Boolean);
    if (sets.length) parts.push("counts as a second piece toward " + sets.join(" / "));
    const colors = ((entry.variant.augment_slots_norm || {}).colors) || [];
    if (colors.length) parts.push("carries its own augment slots");
    if (!parts.length) parts.push("counts as a second equipped copy");
    return "The second copy " + parts.join(" and ")
      + " — it does not apply this item's own affixes a second time.";
  }

  function slotCountsByItem(chosen) {
    return chosen.map((c) => {
      const m = new Map();
      for (const col of ((c.variant.augment_slots_norm || {}).colors) || []) m.set(col, (m.get(col) || 0) + 1);
      return m;
    });
  }

  function assignAugments(chosen, augmentsPlaced, setAugmentsPlaced) {
    const remaining = slotCountsByItem(chosen);
    // Reserve the slots the solver already filled with set-augment copies
    // (setAugmentsPlaced[].host is a variant_id) BEFORE greedily assigning ordinary
    // augments, or an item whose only compatible slot holds a set copy would be
    // double-booked (ordinary augment attributed to a full slot) and reported as
    // free. #316 — the reservation decrements the color the copy actually consumed
    // (slot_color); a placement saved before slot_color existed can only have been
    // Colorless, so that is the legacy default (an undefined lookup would silently
    // no-op the reservation and re-offer the slot).
    for (const sa of setAugmentsPlaced || []) {
      const i = chosen.findIndex((c) => c.variant && c.variant.variant_id === sa.host);
      const col = (sa && sa.slot_color) || "Colorless";
      if (i >= 0 && (remaining[i].get(col) || 0) > 0) remaining[i].set(col, remaining[i].get(col) - 1);
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

  /** #316 — the canonical set-augment placement list every consumer reads.
   *
   *  Returns a NEW list (the persisted snapshot is never mutated; persist.js
   *  stores `setAugmentsPlaced` verbatim) in which each copy carries a
   *  `slot_color` and, where a Colorless recolor is genuinely free, the copy is
   *  re-reported as Colorless. Runs unconditionally — projection has no
   *  solve-path flag, and on a tie-broken primary solve the pass is idempotent
   *  (the Colorless-first stage already landed every free copy Colorless).
   *
   *  The guard is a trial-assignment check, not a copy-only ledger: a candidate
   *  recolor is accepted only when (a) the host itself exposes a Colorless slot
   *  (never a color absent from the host, R2), (b) every copy's reservation
   *  still fits its host's physical slots, and (c) re-running the full ordinary-
   *  augment reconstruction does not grow `unplaced` — a pre-assignment ledger
   *  sees only other copies and would steal a Colorless slot ordinary demand
   *  needs. Legacy placements without `slot_color` default to Colorless (the
   *  only color a pre-#316 solve could consume). Memoized per build object.
   */
  const _canonSetAug = (typeof WeakMap !== "undefined") ? new WeakMap() : null;
  function canonicalSetAugments(build) {
    if (!build) return [];
    if (_canonSetAug && _canonSetAug.has(build)) return _canonSetAug.get(build);
    const chosen = build.chosen || [];
    const list = (build.setAugmentsPlaced || [])
      .map((sa) => ({ ...sa, slot_color: (sa && sa.slot_color) || "Colorless" }));
    const idxByHost = new Map();
    chosen.forEach((c, i) => {
      const id = c.variant && c.variant.variant_id;
      if (id != null && !idxByHost.has(id)) idxByHost.set(id, i);
    });
    const hostIdx = (id) => (idxByHost.has(id) ? idxByHost.get(id) : -1);
    // Per-host physical feasibility of a candidate list: every copy must reserve
    // a real slot of its color on its own host.
    const reservationsFit = (l) => {
      const rem = slotCountsByItem(chosen);
      for (const s of l) {
        const i = hostIdx(s.host);
        if (i < 0) continue; // host not in chosen (partial snapshot) — nothing to reserve
        const have = rem[i].get(s.slot_color) || 0;
        if (!have) return false;
        rem[i].set(s.slot_color, have - 1);
      }
      return true;
    };
    if (list.length && reservationsFit(list)) {
      // The guard compares WHICH augments sit unplaced, not just how many: with
      // a drifted restored snapshot (base unplaced > 0) an equal COUNT can still
      // swap which augment lost its seat, and re-reporting a different eviction
      // than the saved build showed is a display lie.
      const unplacedIdsOf = (l) => assignAugments(chosen, build.augmentsPlaced, l).unplaced
        .map((a) => a.variant_id).sort();
      let base = unplacedIdsOf(list);
      for (let k = 0; k < list.length; k++) {
        if (list[k].slot_color === "Colorless") continue;
        const i = hostIdx(list[k].host);
        if (i < 0) continue;
        const cols = ((chosen[i].variant.augment_slots_norm || {}).colors) || [];
        if (!cols.includes("Colorless")) continue;               // host-bounded (R2)
        const trial = list.map((s, j) => (j === k ? { ...s, slot_color: "Colorless" } : s));
        if (!reservationsFit(trial)) continue;                   // no free Colorless on the host
        const u = unplacedIdsOf(trial);
        const sameSet = u.length === base.length && u.every((id, x) => id === base[x]);
        if (u.length < base.length || sameSet) { list[k] = trial[k]; base = u; }
      }
    }
    if (_canonSetAug) _canonSetAug.set(build, list);
    return list;
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
    augAssign = augAssign || assignAugments(result.chosen, result.augmentsPlaced, canonicalSetAugments(result));
    const augSlot = new Map(), augHost = new Map();
    for (const [idx, augs] of augAssign.byIndex) {
      const host = result.chosen[idx];
      for (const a of augs) {
        augSlot.set(a.variant_id, host && host.slot);
        augHost.set(a.variant_id, host && host.variant && host.variant.variant_id);
      }
    }
    // U4 (R9) — the runtime half of a set's sources. `setYieldingSlots` comes from
    // the solver's `realPieces`, which are x-var (intrinsic) pieces only: a wildcard
    // or chosen-membership pick has no x-var, so the very piece that completed the
    // set was missing from its source list and the player saw "via Ring" alone.
    // Union the resolver's non-intrinsic contributors in; the intrinsic ones the
    // solver already named are left to it, so an ordinary build is untouched.
    const runtimeBySet = new Map();
    const contributors = setContributors(result);
    for (const c of (result && result.chosen) || []) {
      for (const e of contributorsFor(contributors, c.slot, c.variant.variant_id)) {
        if (e.kind === "intrinsic") continue;
        if (!runtimeBySet.has(e.set)) runtimeBySet.set(e.set, []);
        runtimeBySet.get(e.set).push({ slot: c.slot, host: c.variant.variant_id });
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
        if (p.sourceKind === "set") {
          for (const r of runtimeBySet.get(p.source) || []) {
            if (hostIds.includes(r.host)) continue;   // already credited for this set
            slots.push(r.slot);
            hostIds.push(r.host);
          }
        }
        return {
          bonus_type: p.bonus_type, value: p.value, source: p.source,
          sourceKind: p.sourceKind, slots, hostIds, isSet: p.sourceKind === "set",
          // #205 — when this contribution came from a universal spell-DC
          // enchantment, the name the player will find on the item. Null for a
          // native affix, whose own stat name is already what is engraved.
          via: p.via || null,
          // U3 (#290/#291) — when this part was cross-added from a fully-
          // stacking universal stat (Universal Spell Power under an element
          // spellpower; Spell Lore / Universal Spell Lore under an element
          // lore), the SOURCE stat's name. Null on the target's own parts.
          // Stays FLAT beside them — never grouped the way via-expansions
          // collapse on the item surfaces: the source stat IS the name
          // engraved on the item. Renders as "from <source stat>".
          crossAdd: p.crossAdd || null,
          // #88 U8 (R13/R16) — the type the CATALOG recorded, when the player
          // overrode it. Threaded EXPLICITLY, like `via` and `crossAdd` above:
          // this function rebuilds every contributor as a fresh object with a
          // fixed field list, and results.js renders only from that shape — so a
          // correct solver-side marker that is not named here renders nowhere.
          overriddenFrom: p.overriddenFrom || null,
        };
      });
    }
    return out;
  }

  /** Which ranked targets a specific equipped item wins, and by how much. `item` is
   *  { slot, variant_id }. Returns [{ stat, value, viaSet, boolean }], highest first;
   *  empty for a filler/tie-break pick.
   *
   *  #476 — NO IN-APP CALLER, DELIBERATELY. This is a data API on the projection
   *  export surface, exercised by `tests/attribution.test.js` and pinned by the
   *  re-export guard in `tests/projection.test.js`. Nothing in `web/` calls it,
   *  and that is not a defect to clean up.
   *
   *  The note is here because a dead-code sweep will find it and it looks exactly
   *  like `whyThisLine`, which #476 deleted for being uncalled — and which cost a
   *  twelve-behaviour audit to remove safely. The two are not the same case:
   *  `whyThisLine` was a RENDERER that rendered on no surface, so its tests
   *  covered nothing a player could see; this is a pure function over the
   *  attribution model, and its tests cover the model. `itemContributions` is
   *  what the surfaces read, and it is deliberately a different shape — it keeps
   *  each contribution separate and carries the bonus type, where this one sums
   *  per stat and drops it.
   *
   *  Ruled on 2026-08-23 and not filed as an issue, because filing it re-raises
   *  exactly what this note exists to prevent. */
  function whyThis(result, item, attr) {
    attr = attr || attributionByTarget(result);
    const wins = [];
    for (const stat of Object.keys(attr)) {
      let val = 0, viaSet = false, boolean = false;
      for (const p of attr[stat]) {
        if ((p.hostIds || []).includes(item.variant_id)) {
          val += p.value;
          if (p.isSet) viaSet = true;
          if (isPresence(p)) boolean = true;
        }
      }
      if (val > 0) wins.push({ stat, value: val, viaSet, boolean });
    }
    wins.sort((a, b) => b.value - a.value);
    return wins;
  }

  /** Per-item ranked contributions with the bonus type kept (plan 2026-08-12-001 U1).
   *
   *  `whyThis` sums per stat and drops `bonus_type`, so it cannot render
   *  "Intelligence +22 Insight". This walks the same attribution rows with the
   *  same host-variant_id match (the rings gotcha: never by slot), but keeps
   *  each contribution separate — a host and its slotted augment feeding the
   *  same stat are two entries, because merging them would erase the bonus-type
   *  fact the gear-box summary exists to show.
   *
   *  Order: the caller's ranked `targets` first, value-descending within a
   *  stat. Zero and negative values are dropped unless the row is a boolean
   *  presence affix, mirroring `whyThis`'s positive guard. */
  function itemContributions(result, item, attr, targets) {
    attr = attr || attributionByTarget(result);
    const order = (targets && targets.length) ? targets : Object.keys(attr);
    const out = [];
    for (const stat of order) {
      const rows = [];
      for (const p of attr[stat] || []) {
        if (!(p.hostIds || []).includes(item.variant_id)) continue;
        const boolean = isPresence(p);
        if (!boolean && !(p.value > 0)) continue;
        rows.push({ stat, value: p.value, bonus_type: p.bonus_type,
          viaSet: !!p.isSet, boolean, via: p.via || null,
          // #471 — WHICH channel credited this point. The Loadout card stopped
          // restating craft- and augment-granted stats in its Stats section (they
          // are now stated in place, beside the slot that yields them), and its
          // residual sweep — the guard that chips any credited contribution no
          // other row covers — needs to tell "nothing rendered this" apart from
          // "the Craft section rendered this". Without the kind here the sweep
          // re-adds every crafted point to Stats and the de-duplication is inert.
          sourceKind: p.sourceKind || null,
          // #472 — WHAT credited it, by name. For a set contribution this is the
          // set's name, which is the only thing that can link a "go awaken this
          // set" row to the points the solver actually credited. Matching on
          // `viaSet` alone would over-claim on an item that feeds two sets and is
          // credited for one of them.
          source: p.source || null,
          // U3 (#290/#291) — the cross-add source stat rides with the row so the
          // per-item why-this can label the credit "from <source stat>".
          crossAdd: p.crossAdd || null,
          // #88 U8 (R13/R16) — the override marker rides here for the same reason
          // crossAdd does: the per-item why-this renders from THIS shape, not from
          // attributionByTarget's, so a marker named there and not here is correct
          // in the solver and invisible in the gear box.
          overriddenFrom: p.overriddenFrom || null });
      }
      rows.sort((a, b) => b.value - a.value);
      for (const r of rows) out.push(r);
    }
    return out;
  }

  /** The stats whose every live bonus-type bucket is filled — membership in
   *  `saturationReport`. Reads plain JSON on the result (never the live
   *  program), so a restored character colors identically without re-solving;
   *  a pre-#239 snapshot with no report renders neutral, not broken. */
  function saturatedStats(result) {
    const s = new Set();
    for (const e of (result && result.saturationReport) || []) {
      if (e && e.stat) s.add(e.stat);
    }
    return s;
  }

  // #245 — the crafted-contribution channels, and what a player calls each one.
  // `worn` is the item's own printed affixes; `roll` is an intrinsic choice slot
  // (#257 ruled its options the item's own engraved enchantment), so both count
  // as native. `set` is neither: an item there to complete a set is not
  // craft-carried. `declared` has no host and never reaches this test.
  const CRAFT_FAMILY_LABEL = {
    augment: "augments", vik: "Viktranium", seal: "seal crafting",
    nc: "Nearly Completed", dino: "Dino crafting",
    // #194/#653 — both halves are Legendary Green Steel: `tf` is the pool's
    // legacy key for the WEAPON recipes, `gs` the accessory ones.
    tf: "Legendary Green Steel", gs: "Legendary Green Steel",
  };
  const NATIVE_KINDS = new Set(["worn", "roll"]);

  // #262 — the no-drop-source disclosure wording, EXACTLY this phrase everywhere
  // it renders (gear box, browse/wizard rows, coverage note, all six
  // exports). The wiki proves its page records no source — that is the claim the
  // evidence supports, and nothing stronger is ever printed (R5). ONE spelling,
  // exported for every surface; a per-surface respelling is the drift this
  // constant exists to forbid.
  const NO_DROP_SOURCE_WORDING = "no known live drop source";

  // #614 — the penalty disclosure. It began life saying penalties were NOT
  // counted, because they were not: the solver discarded every negative affix and
  // an item was scored on its upside alone, so a penalty landing on a ranked stat
  // made that total wrong-high with nothing saying so.
  //
  // The solver now subtracts them. The wiki's stacking page ruled the open
  // question — "Penalties always stack" — so they are forced, additive terms, and
  // each one appears in the breakdown with its own source. This note therefore
  // states the opposite of what it first shipped, and its weight dropped from a
  // warning to a plain remark: nothing on the card is wrong any more, and the note
  // is here so a player reading an item's upside is not surprised by its cost.
  //
  // ONE spelling, here, for the same reason NO_DROP_SOURCE_WORDING is.
  const PENALTY_COUNTED_WORDING = "subtracted, not ignored";

  /** #614 — an equipped item's signed penalties, as [{stat, value}], worst first.
   *  Values are coerced because the raw catalog stores them as strings. */
  function itemPenalties(v) {
    return ((v && v.affixes) || [])
      .filter((a) => a && a.type === "Penalty" && Number(a.value) < 0)
      .map((a) => ({ stat: a.name, value: Number(a.value) }))
      .sort((x, y) => x.value - y.value);
  }

  /** #614 — the disclosure sentence for one item, or "" when it carries none.
   *
   *  Two shapes, because the two cases differ in whether a displayed number is
   *  wrong. A penalty on a RANKED stat makes that stat's total optimistic and
   *  says so by name; a penalty on an unranked stat is information about the item
   *  with no number to correct, and claiming otherwise would overstate. */
  function penaltyDisclosure(v, targets) {
    const pens = itemPenalties(v);
    if (!pens.length) return "";
    const ranked = new Set(targets || []);
    const hit = pens.filter((p) => ranked.has(p.stat));
    const list = pens.map((p) => `${p.value} ${p.stat}`).join(", ");
    if (!hit.length) {
      return `Carries ${list} \u2014 ${PENALTY_COUNTED_WORDING}.`
        + ` ${pens.length > 1 ? "None are" : "It is not"} among your priorities.`;
    }
    const names = hit.map((p) => p.stat);
    const named = names.length === 1 ? names[0]
      : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    return `Carries ${list} \u2014 ${PENALTY_COUNTED_WORDING}.`
      + ` ${named} ${names.length === 1 ? "is" : "are"} ranked, so`
      + ` ${names.length === 1 ? "the total" : "those totals"} above already`
      + ` ${names.length === 1 ? "accounts for it" : "account for them"}.`;
  }

  /** #245 — is this equipped item picked ONLY for its craftable options?
   *
   *  A craftable option slot makes its host a wildcard for every rankable stat,
   *  so under strict lexicographic priority it can displace a genuinely richer
   *  item by a single crafted point. The math is correct; what was missing is
   *  the player being told. Returns the crafted contributions ([{stat, value,
   *  family}], highest first) when the item's native (worn/choice-slot) and set
   *  contributions to the RANKED targets are both zero and at least one crafted
   *  channel contributes — and null otherwise, including for a filler pick that
   *  contributes nothing at all (that is `whyThisNote`'s "included to complete
   *  the loadout", not a craft story). */
  function craftCarried(result, item, attr) {
    attr = attr || attributionByTarget(result);
    let native = 0, viaSet = 0;
    const parts = [];
    for (const stat of Object.keys(attr)) {
      for (const p of attr[stat]) {
        if (!(p.hostIds || []).includes(item.variant_id)) continue;
        if (NATIVE_KINDS.has(p.sourceKind)) native += p.value;
        else if (p.sourceKind === "set") viaSet += p.value;
        else if (CRAFT_FAMILY_LABEL[p.sourceKind]) {
          // #371 — the `nc` kind now carries TWO crafting systems (the category
          // menu and the per-item Nearly Finished / Almost There pools). `source`
          // is the gate's own label, which is the pool name for a per-item craft
          // and "Nearly Completed" for the category path, so preferring it here
          // names the right system and leaves the category path byte-identical.
          const family = (p.sourceKind === "nc" && p.source)
            ? p.source : CRAFT_FAMILY_LABEL[p.sourceKind];
          parts.push({ stat, value: p.value, family });
        }
      }
    }
    if (native > 0 || viaSet > 0 || !parts.length) return null;
    parts.sort((a, b) => b.value - a.value || (a.stat < b.stat ? -1 : 1));
    return parts;
  }

  /** #110 (U7) — the blocklist disclosure, as plain sentences. ONE source for
   *  the app notice and every export. Reads `blockReport` (plain JSON on the
   *  result, computed at model-build time against the PRE-dominance pool), never
   *  the live program, so a restored character discloses without re-solving.
   *
   *  KTD9 — attribution, never counterfactual: the sentences state what was
   *  excluded and, only where the comparator proved it against every survivor
   *  in the pool, that the blocked variant out-valued the rest. Nothing here
   *  claims what a block-free solve would have produced. */
  function blockNoticeLines(result) {
    const report = (result && result.blockReport) || [];
    if (!report.length) return [];
    const names = report.map((e) => e.name);
    const lines = [
      `Your blocklist excluded ${report.length === 1 ? "one candidate" : `${report.length} candidates`} `
      + `from this solve: ${names.join(", ")}. The result is optimal given those exclusions.`,
    ];
    for (const e of report) {
      if (e.bestAvailable) {
        lines.push(`${e.name} out-valued every remaining ${e.pool} candidate under your `
          + "priorities before it was excluded.");
      }
    }
    return lines;
  }

  /** What the excluded-sets filter removed.
   *
   *  Names the sets rather than counting them: "3 sets" tells a player something was
   *  narrowed, not which of their own choices did it. The count of items is what makes
   *  the size of the narrowing legible — excluding two large sets can take 146 variants
   *  out of the pool, which is worth seeing before reading the build as unconstrained.
   */
  function setFilterNoticeLines(result) {
    const f = result && result.setFilter;
    if (!f || !f.excluded) return [];
    const n = f.sets.length;
    return [`You excluded ${n} ${n === 1 ? "set" : "sets"} (${f.sets.join(", ")}), `
      + `which removed ${f.excluded} ${f.excluded === 1 ? "item" : "items"} from this solve. `
      + "The result is optimal given those exclusions."];
  }

  /** #246 — what the content-ownership filter removed, and what it could not check.
   *
   *  BOTH halves are said, and the second is the one that matters. The filter can
   *  only exclude gear whose adventure pack the wiki states; crafting, vendor, event
   *  and Store gear is not pack-gated at all, and 33 source values carry no pack the
   *  harvest could source. Those are KEPT — dropping them would narrow the pool on a
   *  guess — so a build solved with the filter on may still contain something the
   *  player cannot get. Reporting the exclusions alone would read as a complete
   *  answer to "only show me what I can farm" when it is a partial one.
   */
  /** #193/#599 — what Essence Crafting offered this solve, and what it did not.
   *
   *  Said whenever a crafting host was a CANDIDATE, not only when something was
   *  crafted, because both halves are news. A player who sees three crafted
   *  effects should know the menu they came from is a fifth of the game's, and a
   *  player who sees none should know the menu was short rather than assume the
   *  solver judged every option useless.
   *
   *  The heroic Gem gets a third sentence: its Extra menu looks empty for a
   *  sourced reason (Insight effects need ML 10+), not because we lack the data.
   */
  function essenceNoticeLines(result) {
    const r = result && result.essenceReport;
    if (!r) return [];
    const lines = [];
    const n = (r.placed || []).length;
    if (n) {
      const what = r.placed.map((p) => `${p.menu}: ${p.effect} +${p.value}`).join(", ");
      lines.push(`Essence Crafting placed ${n} ${n === 1 ? "effect" : "effects"} (${what}). `
        + "Crafting these destroys them if the item is later upgraded or its sets rerolled.");
    }
    if (r.offered != null && r.total != null) {
      lines.push(`The solver chose from ${r.offered} of the ${r.total} effects these menus offer in game. `
        + "The rest are not modelled: an effect is only offered once its placement, its bonus type and "
        + "its level curve are all sourced from the wiki, and most are missing the bonus type — "
        + "without which a crafted effect would either double-count against your gear or wrongly "
        + "replace it.");
    }
    // #611 — the build is assuming a crafting step the player has not done, on an
    // item whose printed ML is ABOVE their cap. Said before the Insight line
    // because it is what explains it: the same crafting-down that admits the item
    // is what can drop it under the Insight gate.
    for (const c of r.craftedDown || []) {
      lines.push(`${c.item} is minimum level ${c.nativeMl}, above your cap, and this build assumes you `
        + `disjunct it and craft it at minimum level ${c.craftedMl}. Its effect values are read at `
        + `${c.craftedMl}, not ${c.nativeMl}. The minimum level of an Essence Crafted item is set by the `
        + "shard you apply, and shards exist for levels 1-36; an item cannot be crafted ABOVE its own "
        + "level, which is why crafting down is the only direction offered. That an item can be crafted "
        + "below its printed level follows from the general rule rather than from a sentence about this "
        + "item, so it is stated here rather than assumed silently.");
    }
    if (r.insightGated && r.insightMinMl) {
      lines.push(`This host is below minimum level ${r.insightMinMl}, so the Insightful effects in the `
        + "Extra menu are unavailable to it in game — that menu is short for a game reason, not a data one.");
    }
    return lines;
  }

  /** #194 — what Legendary Green Steel did in this build, and what it cannot do.
   *
   *  Said only when a Legendary Green Steel blank is EQUIPPED (48 blanks are
   *  candidates on every ML 26+ solve, so "was a candidate" would fire on
   *  nearly every result and stop being read). Three facts, each its own line:
   *  what was crafted and where, which declared altars were left empty and why,
   *  and the standing scope limit — a matched tier combination's aspect bonus
   *  (Dominion / Opposition / Ethereal / Material) is not modelled, which is
   *  AGENTS.md's non-goal stated at the one place a player would otherwise
   *  assume it was counted.
   */
  function greenSteelNoticeLines(result) {
    const r = result && result.greenSteelReport;
    if (!r || !r.hosts) return [];
    const lines = [];
    const placed = r.placed || [];
    if (placed.length) {
      const byItem = new Map();
      for (const p of placed) {
        if (!byItem.has(p.item)) byItem.set(p.item, []);
        byItem.get(p.item).push(p);
      }
      const what = [...byItem.entries()].map(([item, ps]) =>
        `${item} (${ps.slice().sort((a, b) => a.tier - b.tier)
          .map((p) => `T${p.tier} ${p.name}`).join(", ")})`).join("; ");
      lines.push(`Legendary Green Steel: this build crafts ${placed.length} `
        + `${placed.length === 1 ? "effect" : "effects"} at the Legendary Altars — ${what}. `
        + "Each tier is chosen on its own for what it adds to your ranked stats.");
    }
    const empty = r.unfilled || [];
    if (empty.length) {
      const what = empty.map((u) => `${u.item} T${u.tier}`).join(", ");
      lines.push(`${empty.length} declared ${empty.length === 1 ? "tier was" : "tiers were"} left empty `
        + `because no option there adds to your ranked stats (${what}).`);
    }
    lines.push("The bonus a matched tier combination unlocks — the Dominion, Opposition, Ethereal "
      + "and Material aspects — is not modelled, by design: only each tier's own effect is "
      + "offered, so a build that also matches its aspects may be worth more than shown here.");
    return lines;
  }

  function packFilterNoticeLines(result) {
    const f = result && result.packFilter;
    if (!f) return [];
    const lines = [];
    if (f.excluded) {
      const n = f.packsExcluded.length;
      lines.push(`Content you have not marked as owned excluded ${f.excluded} `
        + `${f.excluded === 1 ? "item" : "items"} from this solve, across `
        + `${n} ${n === 1 ? "pack" : "packs"}: ${f.packsExcluded.join(", ")}. `
        + "The result is optimal given those exclusions.");
    }
    if (f.uncheckable) {
      lines.push(`${f.uncheckable} candidates could not be checked against your `
        + "content — they are crafted, bought, event or Store gear, or the wiki records "
        + "no adventure pack for their source. They were kept rather than dropped on a "
        + "guess, so this build may still include something you cannot get.");
    }
    return lines;
  }

  /** #539 — what the player's set pins did, as plain sentences.
   *
   *  Every verdict is said out loud, including the ones that landed. A pin that
   *  WORKED is worth a line because the whole point of a pin is that the player
   *  is trading something for it — silence would leave them unable to tell a
   *  delivered pin from one the solver happened to want anyway.
   */
  function setPinNoticeLines(result) {
    const report = (result && result.setPinReport) || [];
    if (!report.length) return [];
    const by = (v) => report.filter((e) => e.verdict === v).map((e) => e.set);
    const lines = [];
    const listOf = (a) => a.join(", ");

    const delivered = by("pinned");
    if (delivered.length) {
      lines.push(`You required ${delivered.length === 1 ? "this set" : "these sets"}, and the `
        + `solve delivered ${delivered.length === 1 ? "it" : "them"}: ${listOf(delivered)}. `
        + "Everything below is the best build that keeps that requirement.");
    }
    const conflict = by("conflict");
    if (conflict.length) {
      lines.push(`These sets cannot all be delivered together — there are not enough slots `
        + `for every piece: ${listOf(conflict)}. They were dropped so a build could still be `
        + "solved. Remove one and solve again.");
    }
    for (const e of report) {
      if (e.verdict === "not-owned") {
        lines.push(`${e.set} was not required: it is a Set Augment you have not marked as owned. `
          + "Tick it under Set Augments I own, or remove the requirement.");
      } else if (e.verdict === "unreachable") {
        lines.push(`${e.set} was not required: ${e.why}. Raising the level cap or widening the `
          + "pool may bring it back.");
      } else if (e.verdict === "unknown") {
        lines.push(`${e.set} was not required: ${e.why}.`);
      }
    }
    return lines;
  }

  /** #245 — the niche-crafting opt-out, as a plain sentence for the notice
   *  surface and every export. Reads the solved query's flag off the snapshot
   *  (and the saved inputs as the restore-path fallback), never the live
   *  program, so a restored character discloses identically without re-solving. */
  function craftingExcludedLine(rec) {
    const snap = (rec && rec.snapshot) || rec || {};
    const q = (rec && rec.query) || snap.query || {};
    const inputs = (rec && rec.inputs) || {};
    // #346 (U4) — one shared precedence for the whole app (model.js): a stored
    // rung wins wherever it lives, and the legacy boolean speaks only when no
    // rung exists. Reading the solved query first and the saved inputs second is
    // this caller's shape; the RULE is not restated here.
    const rung = _rungOf(q, inputs);

    // #346 (U5, R11) — a mechanic the rung made UNREACHABLE is named, not
    // silently omitted. Augment Sets are the motivating case: they are set-bonus
    // crafting, so every rung from no-niche-crafting down clears them. A player
    // who never marked one owned would not miss them, so this only speaks to a
    // player whose own opt-in was overridden by the rung.
    // Count through one shape-tolerant helper. `ownedSetAugments` is a Set on the
    // LIVE path (results.js forwards the solved query straight in as `inputs`)
    // and a plain array on the SAVED path (pickInputs converts it for JSON). An
    // array-only `.length` read made this clause render in every export and never
    // in the app — R11 half-shipped, with the tests exercising only the saved
    // shape they were written from.
    const ownedSets = _countOf(inputs.ownedSetAugments) || _countOf(q.ownedSetAugments);
    const setsClause = ownedSets
      ? ` The ${ownedSets === 1 ? "Augment Set you marked as owned was" : `${ownedSets} Augment Sets you marked as owned were`} unavailable at this setting, not merely outscored.`
      : "";

    if (rung === "no-niche-crafting") {
      return "Niche crafting was excluded from this solve: Viktranium experiments, "
        + "Sealed-in-X seals, Nearly Completed, Dinosaur Bone crafting, and "
        + "set-bonus crafting were not considered. Augments still were." + setsClause;
    }
    if (rung === "no-solar-lunar") {
      return "Niche crafting and Solar/Lunar Gems were excluded from this solve. "
        + "Ordinary colour augments were still considered." + setsClause;
    }
    if (rung === "printed-only") {
      return "This solve used nothing beyond what is printed on each item: no "
        + "niche crafting and no augments of any colour were considered." + setsClause;
    }
    // Top rung. R9 — the notice is the discovery path for the control, so it
    // speaks here too rather than staying silent. It reports what the loadout
    // LEANS ON that a lower rung would take away, which is a fact about the
    // solve and not about the query — hence the snapshot read.
    const augs = (snap.augmentsPlaced || []).length;
    // R9 — the notice is the discovery path for the control, so it has to count
    // everything a lower rung would take away, not just augments. A build leaning
    // entirely on Viktranium or seals is exactly the player who most needs to know
    // the ladder exists, and counting augments alone left them with no notice.
    const crafts = ["vikPlaced", "sealPlaced", "ncPlaced", "dinoPlaced", "lgsPlaced",
      "essPlaced", "membershipPlaced", "setAugmentsPlaced"]
      .reduce((n, k) => n + ((snap[k] || []).length), 0);
    if (!augs && !crafts) return null;   // nothing to give up; no advice worth crowding the results with
    const gems = (snap.augmentsPlaced || [])
      .filter((a) => a && _isSolarLunarColor(a.color)).length;
    const parts = [];
    if (gems) parts.push(`${gems} Solar/Lunar Gem${gems === 1 ? "" : "s"}`);
    // "other" only earns its place once the gems have been named — with no gems
    // in the sentence there is nothing for these to be other THAN.
    const rest = augs - gems;
    if (rest) parts.push(`${rest} ${gems ? "other " : ""}augment${rest === 1 ? "" : "s"}`);
    if (crafts) parts.push(`${crafts} crafted option${crafts === 1 ? "" : "s"}`);
    const listed = parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
      : parts[0];
    const lead = gems ? `This loadout leans on ${listed}` : `This loadout uses ${listed}`;
    return `${lead}. If you would rather not craft or buy them, lower "What may the `
      + `solver assume beyond the printed item?" and re-solve.`;
  }

  /** #339 — the augment-ceiling scope disclosure (null when unrestricted). Reads
   *  the SOLVED query only, never the saved inputs: the ceiling that shaped this
   *  result is the only honest claim, and a restored pre-ceiling snapshot must
   *  stay silent even if the player has since typed a ceiling — that solve was
   *  not restricted. buildQuery already re-normalized a stale ceiling to null,
   *  so a value here is always a live restriction.
   *
   *  The solved query lives at rec.query on saved records (serializeCharacter
   *  stores it as a SIBLING of the snapshot) and is forwarded there by the live
   *  render (the worker result carries no query field); snap.query is only a
   *  legacy/synthetic-shape fallback. rec.query wins when both exist. */
  function augCeilingLine(rec) {
    const snap = (rec && rec.snapshot) || rec || {};
    const q = (rec && rec.query) || snap.query || {};
    const n = Number(q.augCeiling) || null;
    if (n == null) return null;
    return `Augments were restricted to ML ${n} and below for this solve; `
      + "higher-ML augments were not considered.";
  }

  /** #573 — the Max Dex Bonus gap, disclosed because it cannot be modelled.
   *
   *  DDO reduces Maximum Dodge Bonus to the lowest Maximum Dexterity Bonus among the
   *  equipped armor and tower shields. That is a real constraint and we do NOT model
   *  it: Max Dex Bonus is a property of the individual armor, the dataset carries no
   *  such field, and gear-planner has none to read (only two augments mention Max Dex
   *  Bonus at all, and both RAISE it). So the Dodge total this solve reports is the
   *  gear sum, un-reduced.
   *
   *  It used to be "modelled" by `ARMOR_DODGE_CAP`, four unsourced numbers keyed to
   *  armor CATEGORY — the wrong granularity by the wiki's own wording, and a clamp
   *  #199 had already refused to record. Removing it makes the gap real, so it has to
   *  be spoken: an un-reduced number nobody flags is the failure this repo's
   *  never-infer rule exists to prevent, and silence would simply move the wrong
   *  answer from "too low" to "too high".
   *
   *  Silent once the player sets a Max on Dodge themselves — at that point they have
   *  told us their limit, `boundNotice` reports it when it binds, and repeating the
   *  invitation would ask for something already supplied. */
  function dodgeMaxDexLine(rec) {
    const snap = (rec && rec.snapshot) || rec || {};
    const q = (rec && rec.query) || snap.query || {};
    const armor = q.armorType;
    if (!armor) return null;
    const targets = Array.isArray(q.targets) ? q.targets : [];
    if (!targets.includes("Dodge")) return null;
    const caps = q.targetCaps || {};
    if (caps.Dodge != null) return null;
    return `You chose ${armor} armor and ranked Dodge. In game, your armor's Maximum `
      + "Dexterity Bonus can reduce your Maximum Dodge Bonus \u2014 but that limit belongs to "
      + "the individual armor, not to its category, and the wiki does not state it per "
      + "item, so this solve does not apply it. The Dodge total above is the gear sum, "
      + "not reduced by your armor. If you know your armor's limit, set it as the Max on "
      + "your Dodge priority.";
  }

  /** #663 — the Jump soft cap, DISCLOSED rather than clamped.
   *
   *  Jump is the only ceiling in `docs/wiki-evidence/intrinsic-stat-caps.md` that
   *  gear alone can exceed: the built catalog reaches 46 against a soft cap of 40,
   *  so a ranked Jump can spend slots on points that buy nothing WITHOUT any
   *  declared credit involved. Every other recorded ceiling sits far above gear.
   *
   *  It is nonetheless not an entry in `intrinsic_stat_caps.json`, because the wiki
   *  states three escapes from 40 in the same breath and a constant can express
   *  none of them:
   *
   *    1. Fall-damage reduction keeps scaling past 40 ("This reduction is not
   *       capped at 40 the way that jump height is"), so the excess is dead for
   *       HEIGHT and live for FALLING.
   *    2. Sneak applies -20, moving the useful target to 60.
   *    3. Armor check penalty eats into it, and armor and shield ACP stack.
   *
   *  So a clamp at 40 would truncate a real stat for anyone sneaking, anyone in ACP
   *  gear, and anyone who cares about falling. The player is told instead, and left
   *  to set their own Max — the same shape as `dodgeMaxDexLine` above and for the
   *  same underlying reason: the limit is real, and it is not ours to guess.
   *
   *  Fires only when the solve actually cleared 40. Below it nothing is wasted and
   *  the sentence is boilerplate; the repeated-notice failure #449 R15 records is
   *  that a line under every card stops being read. */
  function jumpSoftCapLine(rec) {
    const snap = (rec && rec.snapshot) || rec || {};
    const q = (rec && rec.query) || snap.query || {};
    const targets = Array.isArray(q.targets) ? q.targets : [];
    if (!targets.includes("Jump")) return null;
    const caps = q.targetCaps || {};
    if (caps.Jump != null) return null;              // they supplied their own limit
    const total = (snap.effective && snap.effective.Jump != null) ? snap.effective.Jump : 0;
    if (!(total > 40)) return null;                  // nothing is being wasted yet
    return `This build reaches Jump ${total}, and jump HEIGHT stops improving at 40 — `
      + `the ${total - 40} above that buys no extra height. It is not necessarily wasted: `
      + "falling damage keeps decreasing past 40, Sneak applies −20 so a sneaking "
      + "character needs 60 for the same height, and armor check penalty (armor and shield "
      + "stack, plus −3 medium or −6 heavy encumbrance) is subtracted before the cap "
      + "applies. If none of those apply to you, set a Max of 40 on your Jump priority and "
      + "the slots spent above it will go to your next priority.";
  }

  /** #701 — the armor-keyed Magical Resistance Rating ceiling, DISCLOSED, not
   *  clamped. Same family as the two notices above it, and the reason it cannot be
   *  a cap entry is the Dodge reason and the Jump reason at once: the ceiling
   *  depends on the declared armor (cloth 50, light 100, medium and heavy none),
   *  and the wiki lists raisers the app cannot see — enhancement-tree tiers,
   *  stances — beside the gear ones it can (`Magical Sheltering Cap`, the stat the
   *  wiki calls MRR Cap). A clamp would truncate a real total for every character
   *  with a tree bonus. The numbers come from ONE table in model.js
   *  (`MRR_CAP_BY_ARMOR`), which the Advanced-panel hint reads too.
   *
   *  Fires only when the solve's Magical Sheltering total actually clears the
   *  ceiling the app CAN see: the armor's base cap plus whatever Magical Sheltering
   *  Cap this loadout carries (read from `effective`, so only when that stat is
   *  ranked — an unranked cap bonus is not credited and is not quoted). Under it,
   *  nothing is wasted and the line is boilerplate (#449 R15). Silent for medium
   *  and heavy (no ceiling), silent with no armor declared, and silent once the
   *  player set a Max on Magical Sheltering — they have supplied their limit. */
  function mrrCapLine(rec) {
    const snap = (rec && rec.snapshot) || rec || {};
    const q = (rec && rec.query) || snap.query || {};
    const M = _modelModule();
    const table = (M && M.MRR_CAP_BY_ARMOR) || { cloth: 50, light: 100 };
    const armor = q.armorType;
    if (!armor || table[armor] == null) return null;
    const targets = Array.isArray(q.targets) ? q.targets : [];
    if (!targets.includes("Magical Sheltering")) return null;
    const caps = q.targetCaps || {};
    if (caps["Magical Sheltering"] != null) return null;
    const eff = snap.effective || {};
    const total = Number(eff["Magical Sheltering"]) || 0;
    const raise = targets.includes("Magical Sheltering Cap") ? (Number(eff["Magical Sheltering Cap"]) || 0) : 0;
    const base = table[armor];
    const ceiling = base + raise;
    if (!(total > ceiling)) return null;
    const armorWord = armor === "cloth" ? "cloth (or no armor)" : `${armor} armor`;
    return `This build reaches Magical Sheltering ${total}, and in ${armorWord} the game caps `
      + `Magical Resistance Rating at ${base}`
      + (raise ? ` — raised to ${ceiling} by the ${raise} Magical Sheltering Cap this loadout carries` : "")
      + `. The ${total - ceiling} above that buys nothing unless an enhancement tree or stance raises `
      + "your cap further, which this solve cannot see. If nothing does, set a Max of "
      + `${ceiling} on your Magical Sheltering priority and the slots spent above it go to your next `
      + "priority"
      + (raise ? "." : " — or rank Magical Sheltering Cap (the wiki's MRR Cap) to raise the ceiling instead.");
  }

  /** #713 (#214 Option C) — a ranked stat whose harvested wiki tooltip states a
   *  condition, ruled `disclose` in conditional_adjudications.json: the credit
   *  stands, and the result says when it applies. One line per such ranked stat,
   *  quoting the ruling's own sentence, so the app and every export carry the
   *  same words. Reads the map dataset.js installed into model.js at load
   *  (`conditionalDisclosureFor`), which is the build's rulings and nothing
   *  inferred here. Silent when no ranked stat carries a disclosure — the
   *  ordinary case, and the #449 R15 rule against boilerplate. */
  function conditionalNoticeLines(rec) {
    const snap = (rec && rec.snapshot) || rec || {};
    const q = (rec && rec.query) || snap.query || {};
    const targets = Array.isArray(q.targets) ? q.targets : [];
    const M = _modelModule();
    const forStat = (M && M.conditionalDisclosureFor) ? M.conditionalDisclosureFor : null;
    if (!forStat) return [];
    const out = [];
    for (const stat of targets) {
      const d = forStat(stat);
      if (!d || !d.sentence) continue;
      const eff = snap.effective || {};
      const total = (eff[stat] != null) ? ` (${eff[stat]} here)` : "";
      out.push(`${stat}${total} is credited at its full value, but the game grants it ${d.sentence}. `
        + `The wiki's own words: \u201C${d.tooltip || d.label || stat}\u201D`);
    }
    return out;
  }

  /** #459 — where a capped stat's surplus is, and which picks carry it.
   *
   *  A stat held at a cap credits nothing past that point, so gear supplying more
   *  than the cap is farm effort for no displayed value. The existing `.stat-cap`
   *  chip already shows THAT there is a surplus ("capped at 20 · raw 24"); this
   *  names the picks carrying it, which is what a player needs to act.
   *
   *  STATED OVER THE SET, NEVER PER PICK — this is the whole correctness story.
   *  `docs/solutions/design-patterns/redundancy-under-a-shared-cap-must-be-judged-
   *  set-consistently.md` records the same test going wrong twice in one day at two
   *  aggregation levels: contributors that are each individually slack against the
   *  intact total can be jointly necessary. Measured here, at cap 20 with 24
   *  supplied by 15 + 9, NEITHER pick is individually droppable (15 alone and 9
   *  alone both fall under 20) and yet 4 points really are wasted. A per-pick
   *  sentence would have to say either "drop this" (false for both) or nothing
   *  (false about the surplus).
   *
   *  So the sentence quotes ONE number — the total surplus — and says any mix of
   *  reductions up to that total still reaches the cap. That is correct by
   *  construction for every combination, which is exactly what a per-item claim
   *  cannot be.
   *
   *  Uses the SAME sum the chip does (the attribution list, which
   *  `breakdownByTarget` has already stripped of cap-clamped invisible placements),
   *  so the notice and the chip cannot quote different numbers at the player.
   *
   *  Not blocked on an intrinsic cap. Measured 2026-09-02: neither confirmed
   *  intrinsic ceiling is reachable from gear (Doublestrike tops out near 48 against
   *  100, Strikethrough near 15 against 400), so a player-set Max is the only cap
   *  that binds anything today. This reads whichever cap is in force, so it covers
   *  that case now and an intrinsic one for free if a ceiling ever becomes
   *  reachable. */
  function capSurplusLines(rec) {
    const snap = (rec && rec.snapshot) || rec || {};
    const q = (rec && rec.query) || snap.query || {};
    const targets = Array.isArray(q.targets) ? q.targets : [];
    const capped = snap.capped || {};
    const intrinsic = snap.intrinsicCaps || {};
    const effective = snap.effective || {};
    // Cheap exits BEFORE attribution: no ranked stat carries a cap, or the record
    // has no loadout to attribute (a hand-edited backup, a partial snapshot).
    //
    // The `chosen` check is a readable fast path for the shape we EXPECT to hit;
    // the try/catch below it is what actually makes this fail open, and mutation
    // testing says so — removing the check alone changes nothing, removing both
    // turns a partial record into a throw. `attributionByTarget` walks `chosen`,
    // and a throw here would take down the projection every surface reads from,
    // the failure mode the `_rungOf` and `_splitMechanicFor` bridges are each
    // written to avoid.
    const cappedRanked = targets.filter((t) => capped[t] != null);
    if (!cappedRanked.length || !Array.isArray(snap.chosen)) return [];
    let attr;
    try { attr = attributionByTarget(snap); } catch (e) { return []; }
    const out = [];
    for (const stat of cappedRanked) {
      const cap = capped[stat];
      const parts = attr[stat] || [];
      if (!parts.length) continue;
      const rawSum = parts.reduce((n, p) => n + (p.value || 0), 0);
      const shown = effective[stat];
      if (shown == null || !(rawSum > shown)) continue;   // no surplus to report
      const surplus = rawSum - shown;
      const byGame = intrinsic[stat] != null && intrinsic[stat] === cap;
      // Deterministic order, and the biggest carriers first: a player scanning
      // this wants the pick with the most room to give.
      const named = parts.slice()
        .sort((a, b) => (b.value - a.value) || String(a.source).localeCompare(String(b.source)))
        .map((p) => {
          const where = (p.slots && p.slots.length) ? ` \u2014 ${p.slots.join(", ")}` : "";
          return `${p.source} (+${p.value}${where})`;
        });
      out.push(`${stat} is ${byGame ? "capped by the game" : "capped by you"} at ${shown}, `
        + `and your picks supply ${rawSum} \u2014 a surplus of ${surplus} that buys nothing. `
        + `Carried by: ${named.join("; ")}. `
        + `Any mix of lower tiers giving up ${surplus} in TOTAL still reaches ${shown} `
        + `\u2014 stated as a total because no single one of these is necessarily `
        + `droppable on its own. Check your other priorities first: a pick may be `
        + `carrying them too.`);
    }
    return out;
  }

  /** #683 — one mechanic, two wiki spellings, stacking unsettled.
   *
   *  Fires when the player has ranked at least one spelling of a disclosed family.
   *  Deliberately changes NO number: folding the spellings into one bucket would
   *  take the max (asserting they do not stack) and cross-adding them would sum
   *  (asserting they do). The wiki states both readings on two different pages,
   *  so the split is disclosed rather than resolved — the same conservative
   *  direction #573 took for the armor Dodge limit and #663 for the Jump soft cap.
   *
   *  Reads the stamped family, never a hardcoded name or count: the counts are
   *  quoted to the player, so a refresh that adds a granting set must move this
   *  sentence. `src/split_mechanics.py`'s population guard fails the build if the
   *  data moves without the declaration following it. */
  function splitMechanicLine(rec) {
    const snap = (rec && rec.snapshot) || rec || {};
    const q = (rec && rec.query) || snap.query || {};
    const targets = Array.isArray(q.targets) ? q.targets : [];
    if (!targets.length) return null;

    for (const stat of targets) {
      const fam = _splitMechanicFor(stat);
      if (!fam) continue;
      const spellings = Array.isArray(fam.spellings) ? fam.spellings : [];
      const per = fam.sets_per_spelling || {};
      const total = fam.total_sets || 0;
      const others = spellings.filter((s) => s !== stat);
      if (!others.length) continue;
      const bothRanked = spellings.every((s) => targets.includes(s));
      const mine = per[stat];
      // A family whose counts did not ship is not disclosable: the sentence quotes
      // them, and "granted by undefined of the 0 sets" is worse than silence.
      if (typeof mine !== "number" || !(total > 0)) continue;
      if (others.some((s) => typeof per[s] !== "number")) continue;
      const otherList = others
        .map((s) => `"${s}" (${per[s]} of them)`)
        .join(", ");
      return `The DDO wiki writes this mechanic two ways, and this app keeps both `
        + `exactly as the wiki has them. "${stat}" is granted by ${mine} of the `
        + `${total} sets carrying this mechanic; the rest carry ${otherList}. `
        + (bothRanked
          ? `You have ranked both, so this solve ADDS them. `
          : `You have ranked one, so this solve reaches only those ${mine}. `)
        + `Which is right is unverified: ${fam.contested_summary}. Rather than guess, `
        + `the app leaves the two names separate and tells you. `
        + (bothRanked
          ? `If they turn out not to stack, this build is counting the same bonus more than once.`
          : `If they turn out to stack, ranking the other name too would reach the remaining sets.`);
    }
    return null;
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

  /** Every set each equipped slot contributes to — the SET CONTRIBUTOR resolver.
   *
   *  `CONCEPTS.md` names three kinds and only the first lives in item data: an
   *  intrinsic member (`set_bonus` at rest), a chosen-membership host (Vecna Lost
   *  Purpose, Cannith Repurposing Station, Dino Set-Bonus), and a wildcard piece
   *  (the Gem of Many Facets family). The latter two are solver decisions reported
   *  in `membershipPlaced` / `jokerPlaced` and appear nowhere in the catalog —
   *  deliberately, since writing a runtime pick into item data would make the
   *  catalog assert something untrue. A display that reads `set_bonus` alone omits
   *  a piece the solve counted.
   *
   *  Returns a Map keyed `${slot}||${variant_id}` -> [{set, kind}]. A LIST, because
   *  a Gem takes one membership from each of two independent pools, so one slot
   *  commonly feeds two sets at once.
   *
   *  Suppression applies to the INTRINSIC component only. A Set Augment slotted
   *  into an item suppresses that item's own sets, and the solver has already
   *  dropped them; re-adding them here would resurrect a piece the solve removed.
   *  A runtime pick on a suppressed host is a separate decision and survives.
   *
   *  Duplicate-variant caveat: runtime picks key on host variant_id, not slot, so
   *  when one variant occupies two slots the pick is attributed to the first of
   *  them. The pick exists once and is reported once — never on both slots. */
  function setContributors(build) {
    const suppressed = suppressedHostIds(build);
    const out = new Map();
    const keyOf = (c) => contributorKey(c.slot, c.variant.variant_id);
    for (const c of (build && build.chosen) || []) {
      const list = [];
      if (!suppressed.has(c.variant.variant_id)) {
        for (const sb of c.variant.set_bonus || []) {
          if (sb.set && !list.some((e) => e.set === sb.set)) list.push({ set: sb.set, kind: "intrinsic" });
        }
      }
      out.set(keyOf(c), list);
    }
    // Attach each runtime pick to the first equipped slot holding its host.
    const attach = (placed, kind) => {
      for (const pick of placed || []) {
        if (!pick || !pick.set || !pick.host) continue;
        const c = ((build && build.chosen) || []).find((x) => x.variant.variant_id === pick.host);
        if (!c) continue;
        const list = out.get(keyOf(c));
        if (list && !list.some((e) => e.set === pick.set && e.kind === kind)) list.push({ set: pick.set, kind });
      }
    };
    attach(build && build.membershipPlaced, "membership");
    attach(build && build.jokerPlaced, "wildcard");
    return out;
  }

  /** The `setContributors` map key. Private format, one definition: a display that
   *  hand-rolled `${slot}||${id}` would silently miss every lookup the day the key
   *  changes, and a missed lookup here reads as "this slot feeds no set". */
  function contributorKey(slot, variantId) { return `${slot}||${variantId}`; }

  /** The contributor entries for one equipped slot — `[{set, kind}]`, never null. */
  function contributorsFor(contributors, slot, variantId) {
    return (contributors && contributors.get(contributorKey(slot, variantId))) || [];
  }

  /** One Set-Bonuses member as plain text: the piece, the slot it occupies, and how
   *  it contributes (U4/R10). ONE definition so the app card and every export name a
   *  piece identically. Never escapes — each caller applies its own escaper.
   *
   *  A wildcard or chosen-membership pick is named as such (R8): it counts toward
   *  the set exactly as an intrinsic member does, but the two are not
   *  interchangeable and the text must not imply they are. An Augment Set has no
   *  worn member at all — its copies are named by the item each sits in. */
  function setMemberLabel(m) {
    const where = m.slot ? ` (${m.slot})` : "";
    if (m.kind === "augmentset") return `Set Augment in ${m.item}${where}`;
    if (m.kind === "wildcard") return `${m.item}${where} — wildcard`;
    if (m.kind === "membership") return `${m.item}${where} — set-bonus pick`;
    return `${m.item}${where}`;
  }

  /** Active set bonuses with the stats they grant and the slots that yield them.
   *
   *  U4 (R7, R9) — the yielding slots come from the SET-CONTRIBUTOR resolver, not
   *  from `set_bonus`. A wildcard/chosen-membership slot completes a set without
   *  carrying it in item data, so reading the static field alone dropped the piece
   *  that made the bonus happen out of every source list. */
  function activeSetDetail(result) {
    const contributors = setContributors(result);
    const yields = new Map();
    const tierAffixes = new Map();
    for (const c of (result && result.chosen) || []) {
      for (const e of contributorsFor(contributors, c.slot, c.variant.variant_id)) {
        if (!yields.has(e.set)) yields.set(e.set, []);
        yields.get(e.set).push(c.slot);
      }
      for (const t of c.variant.parsed_set_bonuses || []) {
        if (t.pieces_required == null) continue;
        const k = `${t.set}||${t.pieces_required}`;
        if (!tierAffixes.has(k) && (t.affixes || []).length) tierAffixes.set(k, t.affixes);
      }
    }
    return ((result && result.setsActive) || []).map((s) => ({
      set: s.set, pieces: s.pieces_required,
      slots: yields.get(s.set) || [],
      // #252 — collapsed HERE, at the producer, so all four reading surfaces get the
      // engraved name from one call: the Set Bonuses panel, the alternatives cards,
      // the projected content model, and every export that reads it.
      affixes: collapseExpansions(
        tierAffixes.get(`${s.set}||${s.pieces_required}`) || s.affixes || []),
    }));
  }

  /** Every set complete in the build: granted affixes + the pieces composing it.
   *
   *  U4 (R10) — a member is `{slot, item, kind}`, not a bare variant_id, and the
   *  list comes from the SET-CONTRIBUTOR resolver so a wildcard/chosen-membership
   *  piece is named alongside the intrinsic ones. An AUGMENT SET has no worn member
   *  whatsoever: it is named by its placed copies and the item each occupies, read
   *  verbatim from `setAugmentsPlaced[].host` (KTD-6). Without that, its card showed
   *  a tier number and named nothing at all.
   *
   *  `counts` stays STATIC-only on purpose: it selects which tier is satisfied, and
   *  the tab's "N pieces" is that tier THRESHOLD, not a count of equipped items.
   *  R10 adds the member list; it does not redefine that number. */
  function satisfiedSetDetail(build) {
    build = build || {};
    const contributors = setContributors(build);
    const counts = new Map();
    const members = new Map();
    const tiers = new Map();
    const suppressed = suppressedHostIds(build);   // U7 — a Set-Augment host doesn't count toward its own set
    const addMember = (set, m) => {
      if (!members.has(set)) members.set(set, []);
      members.get(set).push(m);
    };
    const countedRuntime = new Set();
    for (const c of build.chosen || []) {
      const isSuppressed = suppressed.has(c.variant.variant_id);
      for (const sb of c.variant.set_bonus || []) {
        if (!sb.set || isSuppressed) continue;
        counts.set(sb.set, (counts.get(sb.set) || 0) + 1);
      }
      for (const e of contributorsFor(contributors, c.slot, c.variant.variant_id)) {
        addMember(e.set, { slot: c.slot, item: c.variant.variant_id, kind: e.kind });
        // A runtime pick counts toward the threshold exactly as an intrinsic piece
        // does — the solver already counted it. Leaving `counts` static-only made
        // the tier disagree with the member list it sits beside: a set completed BY
        // a wildcard reported the LOWER tier's grant while naming enough pieces for
        // the higher one, and every export printed that contradiction. Deduped per
        // (set, host) so one host holding two picks for the same set counts once.
        if (e.kind === "intrinsic") continue;
        const ck = `${e.set}||${c.variant.variant_id}`;
        if (countedRuntime.has(ck)) continue;
        countedRuntime.add(ck);
        counts.set(e.set, (counts.get(e.set) || 0) + 1);
      }
      for (const t of c.variant.parsed_set_bonuses || []) {
        if (t.pieces_required == null) continue;
        if (!tiers.has(t.set)) tiers.set(t.set, new Map());
        const byN = tiers.get(t.set);
        if (!byN.has(t.pieces_required)) byN.set(t.pieces_required, t.affixes || []);
      }
    }
    // Augment Set copies: the set's only "pieces". Host read verbatim from the
    // placement (KTD-6); the slot is the host's worn slot, or null when the host
    // isn't in `chosen` (never fabricated).
    const slotOfHost = new Map();
    for (const c of build.chosen || []) {
      const id = c.variant && c.variant.variant_id;
      if (id != null && !slotOfHost.has(id)) slotOfHost.set(id, c.slot);
    }
    for (const sa of build.setAugmentsPlaced || []) {
      if (!sa || !sa.set) continue;
      addMember(sa.set, { slot: slotOfHost.get(sa.host) || null, item: sa.host, kind: "augmentset" });
    }
    const bySet = new Map();
    for (const [set, byN] of tiers) {
      const have = counts.get(set) || 0;
      let best = null;
      for (const [n, affixes] of byN) if (n <= have && (best == null || n > best.pieces)) best = { pieces: n, affixes };
      if (best) bySet.set(set, { set, pieces: best.pieces, affixes: collapseExpansions(best.affixes), members: members.get(set) || [] });
    }
    for (const s of activeSetDetail(build)) {
      if (bySet.has(s.set)) continue;
      bySet.set(s.set, { set: s.set, pieces: s.pieces, affixes: collapseExpansions(s.affixes || []), members: members.get(s.set) || [] });
    }
    return [...bySet.values()];
  }

  // ---- craft maps + the single label function (KTD6) ----

  // Group placement lists by their host item, keyed by variant_id (nc/roll/vik/seal/
  // tf/gs) or host (joker/membership); dino/aug come pre-assigned by index. Extracted
  // verbatim from results.js buildViews so results.js and the exports share one builder.
  function buildCraftMaps(build, augAssign, dinoAssign) {
    augAssign = augAssign || assignAugments(build.chosen, build.augmentsPlaced, canonicalSetAugments(build));
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
    for (const s of canonicalSetAugments(build)) {           // #316 — canonical colors
      if (!setAugByHost.has(s.host)) setAugByHost.set(s.host, []);
      setAugByHost.get(s.host).push(s);
    }
    // Viktranium crafts render in their in-game slot order (R16: Melancholic,
    // Dolorous, Miserable, Woeful) wherever more than one lands on the same host,
    // not the alphabetical order that falls out of solver-emission grouping. The
    // order is already declared on the registry entry — sort each host's list by it
    // rather than duplicating the sequence here.
    const vikByItem = byItemMap(build.vikPlaced);
    const vikOrder = Craft && Craft.get("viktranium") && Craft.get("viktranium").slot_types;
    if (vikOrder && vikOrder.length) {
      const rank = new Map(vikOrder.map((s, i) => [s, i]));
      const rankOf = (slot_type) => (rank.has(slot_type) ? rank.get(slot_type) : vikOrder.length);
      for (const list of vikByItem.values()) list.sort((a, b) => rankOf(a.slot_type) - rankOf(b.slot_type));
    }
    return {
      augAssign, dinoAssign,
      ncByItem: byItemMap(build.ncPlaced), rollByItem: byItemMap(build.rollPlaced),
      vikByItem, sealByItem: byItemMap(build.sealPlaced),
      lgsByItem: byItemMap(build.lgsPlaced),
      essByItem: byItemMap(build.essPlaced), jokerByHost,
      membershipByHost, setAugByHost,
    };
  }

  /** #370 — the Viktranium slots an equipped item DECLARES but the solve left
   *  empty, in the same in-game slot order `buildCraftMaps` sorts placements by.
   *
   *  A Lamordia slot is part of the item's identity, not a discretionary
   *  placement: the item ships with all four whether or not an option in the pool
   *  advances your priorities. Rendering only the placements made a 4-slot item
   *  read as a 3-slot item, which is indistinguishable from "the tool does not
   *  know that slot exists" — and that is exactly how #365 was reported ("it
   *  didn't put anything in the Woeful slot"). So the empty slot is DISCLOSED
   *  rather than dropped.
   *
   *  Multiset difference, not a set difference: an item may declare two slots of
   *  one type, and filling one must not silently account for both.
   *
   *  Shared by the app chips and `craftingForItem` (every export), so the two
   *  surfaces cannot disagree about how many slots an item has.
   */
  function vikSlotRows(variant, placed) {
    const declared = (variant && variant.lamordia_slots) || [];
    const list = (placed || []).slice();
    const asRow = (p) => ({ slot_type: p.slot_type, category: p.category || null, placement: p });
    if (!declared.length) return list.map(asRow);

    const order = (Craft && Craft.get("viktranium") && Craft.get("viktranium").slot_types) || [];
    const rank = new Map(order.map((s, i) => [s, i]));
    const rankOf = (s) => (rank.has(s) ? rank.get(s) : order.length);
    // Sorted ONCE, here, so the pairing below runs in the order the rows render.
    // The tie-break on declaration index keeps two slots of one type in the order
    // the item declares them, which is the only order there is a reason to prefer.
    const slots = declared
      .map((s, i) => ({ slot_type: s.type, category: s.category || null, i }))
      .sort((a, b) => rankOf(a.slot_type) - rankOf(b.slot_type) || a.i - b.i);

    const used = new Set();
    const take = (pred) => {
      for (let k = 0; k < list.length; k++) if (!used.has(k) && pred(list[k])) { used.add(k); return list[k]; }
      return null;
    };
    const rows = slots.map((s) => ({ slot_type: s.slot_type, category: s.category, placement: null }));
    // TWO passes, and the order matters. Exact (type, category) matches are claimed
    // for EVERY slot first; only then do the leftovers get paired by type alone.
    // Interleaving the two — trying exact then falling back per slot — lets the
    // first slot of a type grab a placement that exactly belongs to the second,
    // which on Legendary Frozen Contraption told the player to craft a Weapon
    // option in the Armor slot, whose pool does not offer it.
    for (const r of rows) r.placement = take((p) => p.slot_type === r.slot_type && (p.category || null) === r.category);
    // The type-only pass exists for a restored snapshot saved before the category
    // rode along on `vikMeta`. Pairing something beats showing a filled slot as
    // empty, and it degrades to the pre-#484 behaviour rather than inventing a
    // category the snapshot never carried.
    for (const r of rows) if (!r.placement) r.placement = take((p) => p.slot_type === r.slot_type);
    // A placement matching no declared slot is still reported. It should not
    // happen, but dropping a craft the solve told the player to apply is the one
    // outcome worse than an odd-looking row.
    for (let k = 0; k < list.length; k++) if (!used.has(k)) rows.push(asRow(list[k]));
    return rows;
  }

  /** The declared-but-empty subset, kept as its own name because it reads at the
   *  call sites that only care about the gap. Derived from `vikSlotRows` so the
   *  two can never disagree about which slot is empty. */
  function unfilledVikSlots(variant, placed) {
    return vikSlotRows(variant, placed)
      .filter((r) => !r.placement)
      .map((r) => ({ slot_type: r.slot_type, category: r.category }));
  }

  /** #194 — one row per DECLARED Legendary Green Steel tier, filled or empty, in
   *  tier order: the `vikSlotRows` rule applied to the per-slot marker
   *  (`legendary_green_steel_tiers`, one list for both blank classes since #687).
   *  Pairing is a multiset difference on `tier`, so an odd
   *  snapshot declaring two slots of one tier still shows one open after one
   *  craft lands. A placement matching no declared tier is still reported, for
   *  the reason `vikSlotRows` gives: dropping a craft the solve prescribed is the
   *  one outcome worse than an odd-looking row. */
  function tierSlotRows(declared, placed) {
    const list = (placed || []).slice();
    const asRow = (p) => ({ tier: p.tier, placement: p });
    const slots = (declared || []).map((s) => s.tier).filter((t) => t != null).sort((a, b) => a - b);
    if (!slots.length) return list.map(asRow);
    const used = new Set();
    const rows = slots.map((tier) => ({ tier, placement: null }));
    for (const r of rows) {
      for (let k = 0; k < list.length; k++) {
        if (!used.has(k) && list[k].tier === r.tier) { used.add(k); r.placement = list[k]; break; }
      }
    }
    for (let k = 0; k < list.length; k++) if (!used.has(k)) rows.push(asRow(list[k]));
    return rows;
  }

  // One craft option's value label (e.g. "Constitution +15") — the unit inside a
  // family label. Mirrors results.js craftLbl minus its esc() wrapper (callers escape).
  function craftValue(o) {
    return affixLabel({ stat: o.stat, bonus_type: o.bonus_type, value: o.value, unit: o.unit || "flat" });
  }

  // U8 (R9) — the affixes a crafted option grants, collapsed so an option whose
  // affixes come from one expansion reads as the enchantment rather than as
  // whichever member the solve happened to rank. A crafted choice-slot option is a
  // DIFFERENT render path from a worn affix, and it is the one the bug was reported
  // from. `o.affixes || [o]` resolves the atomic multi-affix shape with the flat
  // single-affix record as the fallback; for a flat record with no provenance this
  // is `craftValue(o)` exactly, so every unexpanded craft label is byte-identical.
  function craftAffixes(o) {
    return collapseExpansions((o.affixes && o.affixes.length) ? o.affixes : [o]).map(affixLabel).join(", ");
  }

  // The single, unescaped label for one crafting placement (KTD6). Membership routes
  // through the CraftingSystems registry (Vecna "Awaken" vs Dino "Slot Set Bonus");
  // every other family keeps its literal template, moved verbatim from
  // the retired results.js craftSlotChips (#472), which is why it stays byte-identical
  // to those inline templates when a caller wraps it in
  // a single esc(). `results.js` re-applies esc(); each text exporter applies its own
  // escaper — this function never escapes.
  /** #455 — the crafting STEP alone, with no affix list.
   *
   *  `craftLabel` answers two questions at once: "what do I go do" and "what do
   *  I get for it". On the Loadout card the second half is now a stat chip in
   *  the shared chip language, so restating it inside the instruction is the
   *  redundancy #455 reports, in smaller form. This is the instruction half.
   *
   *  A SEPARATE function rather than a flag on `craftLabel`, because that one is
   *  what every text exporter renders from and what the export goldens pin — a
   *  parameter there is one defaulted argument away from moving five formats at
   *  once. The value is not lost by trimming: the gear card's Craft rows state
   *  it beside the slot that yields it (#472).
   *
   *  Families with no affix list to trim (`joker`, `augmentset`, `vikEmpty`)
   *  fall through to `craftLabel` unchanged — `vikEmpty` in particular is not an
   *  instruction at all but a disclosure that a declared slot went unfilled, and
   *  shortening it would turn "no option helps you" into a craft to go apply. */
  function craftStepLabel(o, family) {
    switch (family) {
      case "dino": return `${o.dino_type}${o.name ? ": " + o.name : ""}`;
      case "nc": return `${o.pool || "Nearly Completed"}${o.name ? ": " + o.name : ""}`;
      case "roll": return "Choice slot";
      case "vik": return `Slot ${o.slot_type} Viktranium augment`;
      case "seal": return `Sealed in ${o.seal_type}`;
      // #194 — the tier IS the slot: a Legendary Green Steel blank takes one
      // effect at each of three altars.
      case "lgs": return `Legendary Green Steel T${o.tier}`;
      // #193/#599 — the menu is named because the Gem has three of them and they
      // are spent independently; "Essence Crafting" alone would read as one craft.
      case "essence": return `Essence Crafting ${o.menu}`;
      default: return craftLabel(o, family);
    }
  }

  /** #471 — one craft placement split into the three parts the Loadout card's
   *  row language needs: WHERE the craft goes, WHAT it grants, and the system it
   *  belongs to.
   *
   *  `craftLabel` fuses all three into one sentence ("Slot Dolorous Viktranium
   *  augment: Melee Power +8 Profane"). That is right for a text export, which
   *  has one column; the card now has three, and splitting the sentence at
   *  render time by looking for the colon would break on `craftValue` output
   *  that contains one. So the split lives HERE, beside the fused label, and
   *  both are generated from the same fields — which is what keeps them from
   *  drifting (KTD6).
   *
   *  `craftLabel` is deliberately left alone: every text exporter renders from
   *  it and the export goldens pin it, so this is a third label function rather
   *  than a flag on that one — the same reasoning `craftStepLabel` records.
   *
   *  `vikEmpty` is the one family whose `what` is SHORTER here than in
   *  `craftLabel`. The full sentence ("left empty — no option adds to your
   *  ranked stats") is a whole clause, and at 375px it wrapped to two lines on
   *  every declared-but-unfilled slot — three of them on a Ravenloft accessory,
   *  six lines of card spent saying nothing happened. The card shows "left
   *  empty" and carries the full sentence as the row's `title`; every export
   *  keeps the full sentence via `craftLabel`, unchanged. */
  function craftRowLabel(o, family) {
    const sys = (f) => (o && o.pool) || CRAFT_SECTION_LABEL[f] || "";
    switch (family) {
      case "dino": return { where: o.dino_type, what: `${o.name ? o.name + ", " : ""}${craftAffixes(o)}`,
        system: sys(family), title: "Isle of Dread insert" };
      // #371 — the per-item pools are a DIFFERENT crafting system with a different
      // in-game name, carried on `pool`. It is the SYSTEM here (it captions the
      // section), which frees the where-column to name the option the solve chose
      // — the fact a player standing at the station actually needs.
      case "nc": return { where: o.name || sys(family), what: craftAffixes(o),
        system: sys(family),
        title: o.pool ? `${o.pool} — per-item upgrade slot` : "Terror of Demogorgon — Nearly Completed" };
      case "roll": return { where: "Choice", what: craftValue(o), system: sys(family),
        title: "choice slot, best option selected" };
      // #484 — the slot CATEGORY rides as a note rather than joining the where
      // column, which is 6.7em and already truncates "Melancholic". It is not
      // decoration: the option pool for a Lamordia slot is keyed by (type,
      // category), so `Melancholic (Armor)` and `Melancholic (Weapon)` offer
      // different crafts, and an item declaring both renders two rows that are
      // otherwise identical.
      case "vik": return { where: o.slot_type, what: craftAffixes(o), note: o.category || null,
        system: sys(family), title: "The Chill of Ravenloft — Viktranium Experiment crafting" };
      case "vikEmpty": return { where: o.slot_type, what: "left empty", note: o.category || null,
        system: sys(family), title: craftLabel(o, "vikEmpty") };
      case "seal": return { where: o.seal_type, what: craftValue(o), system: sys(family),
        title: "unseal one effect at the crafting table" };
      // #194 — Legendary Green Steel tier rows (both blank classes, one family
      // since #687), and the declared tiers the solve left empty (same identity
      // rule as `vikEmpty`: a blank that ships with three altars must never read
      // as a two-altar item).
      case "lgs": return { where: `Tier ${o.tier}`, what: craftValue(o), system: sys(family),
        title: `Legendary Green Steel ${o.item_class || "blank"} tier — craft at the Legendary Altar` };
      case "lgsEmpty": return { where: `Tier ${o.tier}`, what: "left empty",
        system: sys(family), title: craftLabel(o, family) };
      case "essence": return { where: `${o.menu} menu`, what: craftValue(o), system: sys(family),
        title: `Essence Crafting ${o.menu}: ${o.effect}` };
      // #472 — the three families that yield a SET rather than an affix. They were
      // the open question on that issue: a wildcard, a chosen membership and a Set
      // Augment wrap a set, not a slot with a stat in it, so it was not obvious
      // what their middle column should say.
      //
      // The answer is that they have the same shape after all, one level up. Every
      // row on the card answers "where does this come from" and "what does it
      // give"; for these three the WHERE is the mechanism you go and use, and the
      // WHAT is the set membership you get for it. That is exactly the actionable
      // half the `Part of set:` line above them does NOT carry — that line says you
      // are in the set, and says nothing about the trip to the Cannith Repurposing
      // Station that puts you there.
      case "joker": return { where: "Wildcard", what: o.set, system: sys(family),
        title: "a Gem of Many Facets slotted here counts this item as a member of the set" };
      case "membership": {
        // KTD2 — Vecna Lost Purpose and the Isle-of-Dread Set Bonus flow through
        // ONE solver primitive and must read differently; the fork is the station,
        // and the wording comes from the CraftingSystems registry rather than a
        // literal here, so a terminology edit there reaches this row. "Awaken" is
        // correct only for Vecna.
        const sysId = (Craft && Craft.systemForStation(o.station)) || "isle-of-dread-set-bonus";
        const isVecna = sysId === "vecna-lost-purpose";
        const reg = Craft && Craft.get(sysId);
        // BOTH columns come from the registry, and that is the point. Splitting
        // the label into `Awaken` + the set name would have read better and would
        // have put a hardcoded "Awaken" back in the renderer — the exact drift
        // KTD2 removed when it routed this fork through `crafting-systems.js`.
        // So the value column stays the registry's own action label, byte-identical
        // to what every export prints, and the where column is the registry's
        // system name. A terminology edit there still reaches this row.
        return {
          where: (reg && reg.system_name) || CRAFT_SECTION_LABEL[family] || "",
          what: craftLabel(o, "membership"),
          system: (reg && reg.system_name) || CRAFT_SECTION_LABEL[family] || "",
          title: isVecna
            ? `awaken this set at the ${o.station || "Cannith Repurposing Station"}`
            : `slot a Dinosaur Bone Set Bonus augment at ${o.station || "Dinosaur Bone crafting"}`,
        };
      }
      case "augmentset": {
        // #316 — a Set Augment consumes a coloured slot, and an unnamed colour
        // reads as Colorless, so the colour IS the where. The suppression note
        // rides the `what`: it is what the augment COST, and a host that gave up
        // its own set without saying so is the misreading U7 shipped to prevent.
        const supp = (o.suppresses && o.suppresses.length)
          ? ` (suppresses ${o.suppresses.join(", ")})` : "";
        return { where: o.slot_color || "Colorless", what: `${o.set}${supp}`,
          system: sys(family),
          title: (o.suppresses && o.suppresses.length)
            ? `Set Augment — overrides this item's own set bonus (${o.suppresses.join(", ")})`
            : "solver-placed Set Augment" };
      }
      default: return { where: "", what: craftLabel(o, family), system: "", title: "" };
    }
  }

  /** #471 — the crafting system a family belongs to, for the Craft section's
   *  caption. Rendered only when every craft row on an item shares one family;
   *  a mixed-family item says just "Craft", because naming one of two systems
   *  in the caption would be a false claim about the rows under it.
   *
   *  Separate from `CRAFT_FAMILY_LABEL`, which `craftCarried` reads: that map is
   *  keyed by attribution `sourceKind` and reads mid-sentence ("its value here
   *  depends on augments"), while this one is a section heading. `roll` is in
   *  this map and deliberately absent from that one — a choice slot is native
   *  (#257), so it is never craft-CARRIED, but it is still a thing you go and
   *  pick, so it earns a caption. */
  const CRAFT_SECTION_LABEL = {
    vik: "Viktranium", vikEmpty: "Viktranium", nc: "Nearly Completed",
    dino: "Dino crafting", seal: "Seal crafting", lgs: "Legendary Green Steel",
    lgsEmpty: "Legendary Green Steel", roll: "Choice slots", essence: "Essence Crafting",
    // #472 — the set-yielding families. `membership` is a fallback only: that case
    // reads its system name from the CraftingSystems registry, because the two
    // stations behind the one primitive are two different systems.
    joker: "Gem of Many Facets", membership: "Set membership", augmentset: "Set Augment",
  };

  /** #455 — the affixes a placed craft actually grants, as affix records.
   *
   *  `craftAffixes` renders them to a string; this returns the records so the
   *  Loadout card can chip them in the same language as a printed affix. Same
   *  `o.affixes || [o]` resolution, so the atomic multi-affix shape and the flat
   *  single-affix record both work, and NOT collapsed — the caller collapses
   *  alongside the item's own affixes so one enchantment split across a printed
   *  affix and a craft does not collapse twice under two different keys. */
  function craftAffixRecords(o) {
    return (o && o.affixes && o.affixes.length) ? o.affixes : (o ? [o] : []);
  }

  // #484 — a Lamordia slot's full name. Two slots of one type on an item differ
  // only by category, so every text surface has to carry it or the two rows read
  // as one craft reported twice.
  function vikSlotName(o) {
    return o && o.category ? `${o.slot_type} (${o.category})` : (o && o.slot_type) || "";
  }

  function craftLabel(o, family) {
    switch (family) {
      case "dino": return `${o.dino_type}: ${o.name ? o.name + ", " : ""}${craftAffixes(o)}`;
      // #211 — ATOMIC like vik/dino: a Skill-menu option grants six skills, so
      // the label renders the option's whole affix list (craftAffixes falls
      // back to the flat single-affix shape byte-identically).
      // #371 — the per-item pools (`Nearly Finished` / `Almost There`) ride this
      // same channel, and they are a DIFFERENT crafting system with a different
      // in-game name. `pool` carries it; the category path has none and keeps
      // "Nearly Completed" byte-identically.
      case "nc": return `${o.pool || "Nearly Completed"}: ${o.name ? o.name + ", " : ""}${craftAffixes(o)}`;
      case "roll": return `Choice: ${craftValue(o)}`;
      case "vik": return `Slot ${vikSlotName(o)} Viktranium augment: ${craftAffixes(o)}`;
      // #370 — a declared slot the solve left empty. Says why, so the player can
      // tell "no option helps your priorities" apart from "this tool has no data
      // for that slot" — the two look identical when the slot simply vanishes.
      // Deliberately NOT given an export cue (`CUE.craft` in exporters.js): a cue
      // would file an empty slot under a crafting family in the legend and read as
      // a craft to go apply. The label stands alone on every surface instead.
      case "vikEmpty": return `Slot ${vikSlotName(o)} Viktranium augment: left empty — no option adds to your ranked stats`;
      case "seal": return `Sealed in ${o.seal_type}: ${craftValue(o)}`;
      // #194 — a Legendary Green Steel craft names its tier: the tier is the
      // altar the player goes to, and each altar takes exactly one effect.
      case "lgs": return `Legendary Green Steel T${o.tier}: ${craftValue(o)}`;
      // A declared tier the solve left empty — same disclosure as `vikEmpty`, and
      // for the same reason: an empty altar must not vanish from the item.
      case "lgsEmpty":
        return `Legendary Green Steel T${o.tier}: left empty — no option adds to your ranked stats`;
      // #193 — the EFFECT is named whenever it differs from the stat, because
      // that name is the shard the player has to go and make: `Insightful
      // Constitution` is a different recipe from `Constitution`, and a shared
      // build that printed only "Constitution +6 Insight" would leave a recipient
      // deriving which of the two to craft. Same "name, then affixes" idiom the
      // dino and Nearly Complete rows use.
      case "essence": return `Essence Crafting ${o.menu}: `
        + (o.effect && o.effect !== o.stat ? `${o.effect}, ` : "") + craftValue(o);
      case "joker": return `Wildcard set: ${o.set}`;
      case "augmentset": {
        // A solver-placed Set Augment (host is solver-DECIDED, read from
        // setAugmentsPlaced — never greedily reconstructed, KTD-6). When the host
        // item is itself a member of a named set, that own set is suppressed while
        // the augment occupies it (the solver already dropped it from setsActive),
        // so name the suppression inline — carrying it into every text export.
        // #316 — the consumed slot color rides on the label the same way: copies
        // may land in colored slots now, and an unnamed color reads as Colorless.
        const where = o.slot_color ? ` — in ${o.slot_color} slot` : "";
        const supp = (o.suppresses && o.suppresses.length) ? ` (suppresses ${o.suppresses.join(", ")})` : "";
        return `Set Augment: ${o.set}${where}${supp}`;
      }
      case "membership": {
        const sysId = (Craft && Craft.systemForStation(o.station)) || "isle-of-dread-set-bonus";
        return Craft ? Craft.actionLabel(sysId, { set_name: o.set }) : `Slot Set Bonus augment: ${o.set}`;
      }
      default: return craftValue(o);
    }
  }

  /** #316/R8 — the set-augment placement rule, derived from the ACTUAL defs
   *  (never a hardcoded claim about the tool's own output): reports whether the
   *  baked matrix covers the seven standard colors on every def, and whether any
   *  def includes Lunar/Solar (Moon/Sun). The one predicate every disclosure
   *  surface reads, so the app notice and the exports cannot disagree. Returns
   *  null when the dataset carries no defs (nothing to disclose). */
  function setAugmentSlotRule(dataset) {
    const defs = (dataset && dataset.augment_set_defs) || {};
    const names = Object.keys(defs);
    if (!names.length) return null;
    const STANDARD = ["Blue", "Colorless", "Green", "Orange", "Purple", "Red", "Yellow"];
    let anyStandardColor = true, moonSunIncluded = false;
    for (const n of names) {
      const f = new Set(defs[n].fits_slots || []);
      if (!STANDARD.every((c) => f.has(c))) anyStandardColor = false;
      if (f.has("Moon") || f.has("Sun")) moonSunIncluded = true;
    }
    return { anyStandardColor, moonSunIncluded };
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
  /** U6 — the credits that ACTUALLY APPLIED, as one readable line, or "" when
   *  none did.
   *
   *  Reads `creditReport` — the solver's own output — deliberately, NOT the saved
   *  `inputs.declaredCredits` map. Those two disagree, and the disagreement is
   *  routine rather than exotic: the wizard keeps a half-typed credit row in state
   *  on purpose so it does not vanish under the cursor, `pickInputs` saves the raw
   *  map verbatim, and the query seam then drops anything blank, zero,
   *  non-integer, out-of-vocabulary, or on a presence stat. Rendering the input
   *  map published a credit the solve refused — with no accompanying qualifier,
   *  since U4's notice reads the report — so a recipient was told the sender holds
   *  a bonus that contributed nothing to the build they were handed. R12 exists so
   *  a recipient can REPRODUCE the solve; only the applied set can do that.
   *
   *  Sorted, so two exports of the same build compare byte-for-byte regardless of
   *  the order the player declared them in. */
  function declaredCreditsLine(creditReport) {
    const rows = (creditReport || []).filter(Boolean);
    if (!rows.length) return "";
    return rows
      .map((c) => `${c.stat} +${c.value} ${c.bonus_type}`)
      .sort()
      .join("; ");
  }

  /** #88 U9 (R15) — the overrides in force, as one readable line, or "" when none
   *  were. The sibling of `declaredCreditsLine` directly above and it reads the
   *  same way and for the same reason: `overrideReport` is the SOLVER's own output,
   *  so a suspended, unmatched, or ineligible override — present in the player's
   *  saved list and doing nothing — never renders as though it applied (KTD6).
   *
   *  Both types are named (R16), because the point of shipping this line is that a
   *  recipient can tell which numbers rest on the wiki and which rest on the
   *  sender's word. Sorted, so two exports of the same build compare byte-for-byte
   *  regardless of declaration order. */
  function overridesLine(overrideReport) {
    const rows = ((overrideReport && overrideReport.inForce) || []).filter(Boolean);
    if (!rows.length) return "";
    return rows
      // No parentheses: markdown escapes them, so text pasted into a forum reads
      // "Insight \(catalog: Enhancement\)". The same trap DECLARED_LABEL and the
      // credit notice already carry — found in the browser pass, not by a test,
      // because every suite compares the string it was given.
      .map((o) => `${o.name} on ${o.variant_id || "a crafting option"}: ${o.to} — catalog says ${o.from}`)
      .sort()
      .join("; ");
  }

  /** #88 U12 (R16-R19) — the catalog-correction report.
   *
   *  Generated text, never a network call (KTD10): this app is client-side and
   *  stays that way, so the route out of the browser is the player pasting this
   *  somewhere a maintainer reads. That sets the bar — it must identify its
   *  subject to someone who has never seen the player's screen.
   *
   *  It says plainly that the claim has no wiki backing. That is not a hedge, it
   *  is the point: `affix_type_corrections.json`'s evidence rule requires a
   *  rendered tooltip, and an override exists precisely for the case where the
   *  wiki and the game disagree — so a report that implied a citation would be
   *  asking a maintainer to record something the wiki cannot support.
   *
   *  A pool-keyed override omits the URL line ENTIRELY rather than printing an
   *  empty one: no crafted row carries a `wiki_url` — `seal`, `nearly_complete`,
   *  `viktranium` and `dino_inserts` all store an empty string and
   *  `legendary_green_steel` has no such key — so the key's own channel
   *  and discriminators are what identify it instead. An empty "Wiki:" label
   *  would read as a missing value rather than an absent concept. */
  function correctionReport(override, catalogRow) {
    const o = override || {};
    const lines = [];
    const isPool = !!o.pool_key;
    lines.push("Bonus-type correction — player observation, no wiki backing");
    lines.push("");
    if (isPool) {
      // channel||disc…||stat||type||value — the discriminators are everything
      // between the channel and the trailing stat/type/value triple.
      const parts = String(o.pool_key).split("||");
      lines.push(`Crafting pool: ${parts[0]}`);
      const disc = parts.slice(1, Math.max(1, parts.length - 3)).filter(Boolean);
      if (disc.length) lines.push(`Entry: ${disc.join(" / ")}`);
    } else {
      lines.push(`Item: ${o.variant_id || "(unnamed)"}`);
    }
    lines.push(`Affix: ${o.name}${o.value != null && o.value !== "" ? ` ${o.value}` : ""}`);
    lines.push(`Catalog records: ${o.from}`);
    lines.push(`Observed in game: ${o.to}`);
    const url = !isPool && catalogRow && catalogRow.wiki_url;
    if (url) lines.push(`Wiki: ${url}`);
    if (o.note) lines.push(`Note: ${o.note}`);
    lines.push("");
    lines.push("This is an in-game observation reported by a player. It is not backed by "
      + "the wiki, which is why it was entered as a personal override rather than a "
      + "catalog correction.");
    return lines.join("\n");
  }

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
      // U6 (R12) — the declared credits themselves, so a recipient can reproduce
      // the solve. Distinct from U4's qualifier, which says a number was declared
      // and unverified; this is the number. Same omit-when-unset idiom as the Two
      // Weapon Fighting line above — the trailing filter drops it when nothing is
      // declared, so an undeclared build's exports are unchanged (R3).
      ["Already have", declaredCreditsLine(((rec && rec.snapshot) || {}).creditReport)],
      // #88 U9 (R15) — the bonus-type overrides, beside the declared credits for
      // the same reason: they are the other input a recipient cannot infer from
      // the loadout, and without them the shared build cannot be reproduced. Same
      // omit-when-unset idiom, so a build with no overrides exports unchanged.
      ["Bonus types you corrected", overridesLine(((rec && rec.snapshot) || {}).overrideReport)],
      ["Gear pool", POOL[i.pool] || i.pool || "all"],
      // #110 (U9/R6) — the exclusions travel with the shared build, beside the
      // priorities and pins, so a reader re-solving reaches the same answer.
      // Count-prefixed so a long list reads as a list, not an anonymous blob;
      // the omit-when-unset filter drops the line entirely when nothing is
      // blocked, so a blockless build's exports are unchanged.
      ["Blocked", (Array.isArray(i.blocklist) && i.blocklist.length)
        ? `${i.blocklist.length} — ${i.blocklist.join("; ")}` : ""],
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
    // #370 — the declared-but-empty Lamordia slots ride the same resolved view,
    // so every export states the item's real slot count (R6: never app-visible
    // but share-invisible).
    // #484 — ONE pass over the declared slots in in-game order, filled and empty
    // interleaved. Emitting every placement and then every gap produced two
    // independently-sorted blocks whose concatenation was not slot order, so a
    // 3-slot item read `Melancholic, Dolorous, Melancholic`.
    for (const r of vikSlotRows(v, maps.vikByItem.get(v.variant_id) || [])) {
      out.push(r.placement
        ? { family: "vik", label: craftLabel(r.placement, "vik") }
        : { family: "vikEmpty", label: craftLabel(r, "vikEmpty"), slot_type: r.slot_type, category: r.category });
    }
    for (const n of maps.sealByItem.get(v.variant_id) || []) out.push({ family: "seal", label: craftLabel(n, "seal") });
    // #194 — declared Legendary Green Steel tiers, filled and empty, in tier order
    // (the #370/#484 rule the Viktranium rows above follow).
    for (const r of tierSlotRows(v.legendary_green_steel_tiers, maps.lgsByItem.get(v.variant_id) || [])) {
      out.push(r.placement
        ? { family: "lgs", label: craftLabel(r.placement, "lgs") }
        : { family: "lgsEmpty", label: craftLabel(r, "lgsEmpty"), tier: r.tier });
    }
    for (const n of (maps.essByItem && maps.essByItem.get(v.variant_id)) || []) out.push({ family: "essence", label: craftLabel(n, "essence") });
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
      // #316 — slot_color rides into the label AND the entry, so every export
      // (which renders cr.label verbatim) carries the consumed-slot attribution
      // the app chip shows. R6: never solve-visible but share-invisible.
      label: craftLabel({ set: s.set, slot_color: s.slot_color, suppresses: i === 0 ? suppresses : [] }, "augmentset"),
      set: s.set, host: s.host, slot_color: s.slot_color || null, wiki_url: s.wiki_url || null,
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
    const augAssign = assignAugments(chosen, snap.augmentsPlaced, canonicalSetAugments(snap));
    const dinoAssign = assignDinoInserts(chosen, snap.dinoPlaced);
    const maps = buildCraftMaps(snap, augAssign, dinoAssign);
    const attr = attributionByTarget(snap, augAssign);
    const priorities = (rec && rec.inputs && rec.inputs.priorities) || [];

    const suppressed = suppressedHostIds(snap);
    const craftedIdx = craftedMlIndex(snap);
    const loadout = chosen.map((c, idx) => {
      const v = c.variant || {};
      return {
        slot: c.slot,
        item: v.variant_id,
        // #681 — the level this item is WORN at. For an essence host crafted below
        // its native ML that is the crafted level, and every export inherits it
        // because they all read this one field.
        ml: wornMl(v, craftedIdx),
        ...(wornMl(v, craftedIdx) !== itemMl(v)
          ? { nativeMl: itemMl(v),
              craftedNote: `Essence Crafted at ML ${wornMl(v, craftedIdx)}, below its printed `
                         + `ML ${itemMl(v)} — its effect values are read at the crafted level.` }
          : {}),
        // U8 (R10) — collapsed HERE, in the single content source every export
        // reads, so no export can print the expanded shape while the app prints
        // the collapsed one. `results.js` calls the same primitive on its own
        // live-result render paths (it has no `rec` to project).
        affixes: collapseExpansions(v.affixes || []),
        augments: (augAssign.byIndex.get(idx) || []).map(augView),
        crafting: craftingForItem(v, idx, maps),
        // The item's own named set(s) suppressed because it hosts a placed Set Augment
        // (empty otherwise). The placement + this suppression also ride in `crafting`
        // (family "augmentset") so every text export surfaces them without change.
        suppressedSets: suppressed.has(v.variant_id) ? slotSetNames(v) : [],
        // #245 — non-null when this item is here ONLY for its craftable options:
        // [{stat, value, family}], highest first. Rides the shared content model
        // so no export can show the pick without the reason (the standing
        // solve-visible-but-share-invisible invariant).
        craftCarried: craftCarried(snap, { slot: c.slot, variant_id: v.variant_id }, attr),
        // #262 — the wiki-confirmed no-drop-source flag, carried as the ONE
        // shared wording so every export prints the identical phrase (and the
        // portable JSON inherits it verbatim). Only-when-set, mirroring the
        // dataset field: an unverified item carries no key at all, so no
        // surface can render a note the wiki evidence lacks (R2/R5).
        ...(v.no_drop_source ? { noDropSource: NO_DROP_SOURCE_WORDING } : {}),
        // #614 — signed penalties the solver discarded, carried as the shared
        // content model so no export can show the pick without the caveat. Same
        // only-when-set shape as noDropSource above: an item with no penalty
        // carries no key, so no surface can print a note the data lacks.
        ...(itemPenalties(v).length
          ? { penalties: itemPenalties(v), penaltyNote: penaltyDisclosure(v, priorities) } : {}),
      };
    });

    // U5 (R11) — `members` rides along, so every export can name the pieces that
    // composed the set and the portable JSON inherits them for free. Dropping it
    // here made a wildcard/chosen-membership piece solve-visible but
    // share-invisible: the recipient of a Gem-completed set saw the bonus and no
    // way to learn which item produced it. Each renderer must still print it —
    // carrying it through the model is necessary, not sufficient.
    const sets = satisfiedSetDetail(snap).map((s) => ({ set: s.set, pieces: s.pieces, affixes: s.affixes, members: s.members || [] }));

    const attribution = {};
    for (const stat of priorities) {
      // #91 (U6) — the Utility sentinel is EXCLUDED from the generic per-priority
      // attribution: it is not a stat, has no effective[]/breakdown entry, and the
      // generic path would emit a phantom zero-total row for it. Its content is the
      // dedicated `utility` block below (mirroring results.js, which excludes it
      // from the generic stat cards and renders utilityCard instead).
      if (stat === UTILITY_NAME) continue;
      const total = (snap.effective && snap.effective[stat] != null) ? snap.effective[stat] : 0;
      const cap = (snap.capped && snap.capped[stat] != null) ? snap.capped[stat] : null;
      const sources = (attr[stat] || []).map((p) => ({
        source: p.source, kind: p.sourceKind, value: p.value,
        bonusType: p.bonus_type, slots: p.slots, viaSet: p.isSet,
        // #205 — carried into every export, not just the live panel: a shared
        // build must name the enchantment the reader will look for on the item.
        viaAffix: p.via || null,
        // U3 (#290/#291) — the cross-add source stat, RAW, so the portable JSON
        // inherits it unchanged and every text export can say "from <source>".
        // A cross-added credit that solves visibly but shares invisibly is the
        // standing failure this repo forbids.
        crossAdd: p.crossAdd || null,
      }));
      // #449 (U2, R15/R18) — the achieved/ceiling fraction rides the shared
      // content model beside the total it qualifies, so every export renders the
      // same numbers and the same wording the card does. Null on a pre-#449
      // restore; each renderer must still print it — carrying it here is
      // necessary, not sufficient.
      attribution[stat] = { total, cap, sources, ceiling: ceilingFor(snap, stat) };
    }

    // #91 (U6/R10) — the Utility tier's content block, read from the snapshot's
    // `utilityReport` (plain JSON, written by the solve and kept by RESULT_KEEP),
    // never the live program, so a restored character exports identically without
    // re-solving. ABSENT when the snapshot carries no report (a healed pre-feature
    // restore): the count is then UNKNOWN, and every export omits the section
    // rather than asserting a zero nobody computed — the same three-state rule
    // results.js utilityCard holds. `line` is the one canonical sentence every
    // surface prints (surfaces may shape around it, never re-write it).
    const rep = snap.utilityReport;
    // #332 — one shared narrowing (see utilityExcludedFor): the solver's list is
    // every ranked non-counted stat; only the presence ones belong in the sentence.
    const { names: excluded } = utilityExcludedFor(snap);
    const utility = rep ? {
      count: rep.count != null ? rep.count : (rep.effects || []).length,
      effects: (rep.effects || []).map((e) => ({ name: e.name, item: e.item != null ? e.item : null })),
      line: utilityLine(rep.count != null ? rep.count : (rep.effects || []).length),
      // #332 — the names and the one canonical sentence. Empty array + null line
      // when nothing was ranked-but-uncounted, so a surface can test either.
      excluded,
      excludedLine: utilityExcludedLine(excluded),
      // #348 (U3/R14) — the ordered secured/unsecured split and the priced top
      // miss. Absent on a snapshot written before #348 (KTD6 forbids re-solving on
      // load), so every consumer must treat these as optional rather than assuming
      // an ordered container behind every saved character.
      ordered: snap.utilityOrdered || null,
      unsecuredLines: utilityUnsecuredLines(snap.utilityOrdered),
      priceLine: utilityPriceLine(snap.utilityOrdered && snap.utilityOrdered.price),
    } : null;

    return {
      ...(utility ? { utility } : {}),
      character: { name: rec && rec.name, constraints: constraintPairs(rec),
        // U4 (R9) — the declared-credit qualifier travels with the shared
        // content model, so every export renders it from the same source the
        // app's bound notice does. Empty array when nothing was declared.
        creditNotice: creditNoticeLines(snap),
        // #239 — the saturation and free-slot disclosures travel with the shared
        // content model for the same reason the credit qualifier does: a
        // recipient who cannot re-solve would otherwise get a build asserting an
        // optimal loadout with no way to learn that a stat was already at its
        // ceiling, or that slots were tie-broken rather than chosen.
        saturationNotice: saturationNoticeLines(snap),
        emptySlotNotice: emptySlotNoticeLines(snap),
        // #345 (U1, R5) — reads the solver-stamped set, so a shared build
        // discloses the outbid targets without the recipient re-solving.
        outbidNotice: outbidNoticeLines(snap && snap.outbidReport),
        // U6/#249 — same channel, same reason: a recipient who cannot re-solve
        // would otherwise get a build asserting an optimal loadout with no way
        // to learn that an item's absorption enchantment was withheld from it.
        absorptionQuarantineNotice: absorptionQuarantineNoticeLines(snap),
        // #245 — the niche-crafting opt-out disclosure (null when off): a
        // recipient must not compare this build against a full-crafting one
        // without being told the pools differed.
        craftingExcludedNotice: craftingExcludedLine(rec),
        // #339 — the augment-ceiling scope disclosure (null when unrestricted):
        // a recipient must not compare this build against an unrestricted one
        // without being told the augment pool was narrower.
        augCeilingNotice: augCeilingLine(rec),
        // #573 — the unmodelled armor Max Dex Bonus reduction (null unless an armor
        // type was chosen AND Dodge ranked AND no Max set). Same channel and same
        // reason as the two above: a recipient must not read a Dodge total as
        // in-game-accurate when the reduction was never applied to it.
        dodgeMaxDexNotice: dodgeMaxDexLine(rec),
        // #663 — the Jump soft cap (null unless Jump was ranked, no Max was set,
        // and the solve cleared 40). Same channel and same reason: a recipient must
        // not read a Jump total as all-useful when part of it buys no height.
        jumpSoftCapNotice: jumpSoftCapLine(rec),
        // #701 — the armor-keyed MRR ceiling (null unless cloth or light was
        // declared, Magical Sheltering ranked with no Max, and the solve cleared
        // the cap the app can see). Same channel and same reason as the two above.
        mrrCapNotice: mrrCapLine(rec),
        // #713 — ranked stats the wiki states as conditional, ruled `disclose`.
        // Same channel and same reason: a recipient must not read the total as
        // always-on when the tooltip says when it applies.
        conditionalNotice: conditionalNoticeLines(rec),
        // #683 — the disclosed name split (null unless a spelling of a disclosed
        // family was ranked). Same channel and same reason as the two above: a
        // recipient must not read the mechanic's total as settled when the wiki
        // states two readings and this app committed to neither.
        splitMechanicNotice: splitMechanicLine(rec),
        // #459 — where a capped stat's surplus is and which picks carry it. Empty
        // array when no ranked stat is over its cap. Same channel and same reason:
        // a recipient reading a shared build cannot otherwise tell that some of the
        // gear it prescribes is buying nothing.
        capSurplusNotice: capSurplusLines(rec),
        // #110 (U7/U9) — the blocklist disclosure: empty array when no block
        // touched the solve. A shared build asserting optimality with silent
        // exclusions is the solve-visible-but-share-invisible failure.
        blockNotice: blockNoticeLines(snap),
        // #246 — same channel and same reason: a recipient must not read a build as
        // a full-roster optimum when a content filter narrowed the pool.
        packFilterNotice: packFilterNoticeLines(snap),
        setFilterNotice: setFilterNoticeLines(snap),
        essenceNotice: essenceNoticeLines(snap),
        // #194 — the Legendary Green Steel disclosure rides the same channel.
        greenSteelNotice: greenSteelNoticeLines(snap),
        setPinNotice: setPinNoticeLines(snap),
        // #449 (U2, R15) — the ONE full statement that qualifies every fraction
        // in the document. Rendered once per export, never per stat: repeated
        // under each of eight priorities it reads as boilerplate and stops being
        // read. Null when no stat carries a ceiling row.
        ceilingStatement: ceilingStatement(snap) },
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
  /** #239 — the saturation disclosure as plain sentences.
   *
   *  The single WORDING source, the same contract `creditNoticeLines` holds:
   *  every export prints these sentences, and the app's per-stat tooltips reuse
   *  them verbatim via `saturationLineFor`. The app's notice line itself is the
   *  compact count/list in `results.js saturationNotice` (plan 2026-08-12-001)
   *  — a different SHAPE derived from the same `saturationReport` rows, never a
   *  second sentence corpus that can drift. Reads `saturationReport` (plain
   *  JSON on the result), never the live program, so a restored character
   *  discloses identically without re-solving.
   *
   *  KTD6 — facts only. It names which bonus types carry the stat and that they
   *  are filled. It attributes no cause: the pool is the product of the ML band,
   *  the gear pool, the character gates AND the dominance pre-filter, and naming
   *  one was already wrong once. The unused-source count is deliberately not
   *  spoken — it counts affix instances rather than items, so "56 unused
   *  sources" would read as alarming and mean something other than it says. It
   *  stays on the report for the portable export.
   */
  function saturationSentence(e) {
    const types = e.bonusTypes || [];
    const art = (t) => `${/^[aeiou]/i.test(t) ? "an" : "a"} ${t} bonus`;
    const named = types.length === 1
      ? art(types[0])
      : `${types.slice(0, -1).map(art).join(", ")} and ${art(types[types.length - 1])}`;
    const verb = types.length === 1 ? "it is filled"
      : types.length === 2 ? "both are filled" : "all of them are filled";
    return `${e.stat} is at its ceiling of ${e.total} — it reaches you as ${named}, and ${verb}, `
      + `so no other item in your pool can raise it.`;
  }

  function saturationNoticeLines(result) {
    const report = (result && result.saturationReport) || [];
    return report.map(saturationSentence);
  }

  /** The one saturation sentence for a single stat — the per-span tooltip
   *  source. Keyed by stat, never by array index, so a future filtered report
   *  cannot misalign sentences to stats. Null when the stat is not saturated. */
  function saturationLineFor(result, stat) {
    const e = ((result && result.saturationReport) || []).find((r) => r && r.stat === stat);
    return e ? saturationSentence(e) : null;
  }

  /** #449 U2 — the achieved/ceiling fraction as SHARED CONTENT: the numbers, the
   *  state, and the wording, in one place, so the ranked-priority card and all
   *  five exports cannot drift. Keyed by stat, never by array index, for the same
   *  reason `saturationLineFor` is: a future filtered report cannot misalign a
   *  sentence to a stat.
   *
   *  Reads `ceilingReport` (plain JSON on the result, kept by RESULT_KEEP) and
   *  `capped`, never the live program, so a restored character reads identically
   *  without re-solving. Returns null when the stat has no row — the pre-#449
   *  restore path — and every surface must render nothing rather than a zero
   *  nobody computed.
   *
   *  KTD2 — `ceilingUpperBound` is an UPPER BOUND, not a target. Σ best sums each
   *  bonus-type bucket's best source independently, and those sources may be one
   *  item, may compete for one slot, or may contradict a chosen set, so a stat can
   *  read 30 / 50 where no legal loadout reaches 50. The field is NAMED for that
   *  scope — the portable `ddo-loadout/v1` envelope inherits `project()` verbatim,
   *  so a third-party consumer reads the same name the app does, and a plain
   *  `ceiling` would invite exactly the attainable-target reading. No sentence
   *  below asserts what a different solve would have produced, and none attributes
   *  the shortfall to a cause: no such solve is run
   *  (`docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md`).
   *
   *  KTD7 — `capBound` is its own state and forces `maxed` false. Both sides of
   *  the fraction are clamped to the stat's cap by `buildCeilingReport`, so a
   *  cap-bound stat would otherwise satisfy `achieved === ceiling` and inherit the
   *  maxed sentence — which claims no other item in the pool can raise the stat.
   *  When the cap is what holds the number, that claim is false and contradicts
   *  the `capNote` ("capped at N · raw M") rendered inches away. It also collapses
   *  at-cap-with-headroom (the player has slack) into at-pool-maximum (none).
   */
  const CEILING_FULL_STATEMENT =
    "Each priority below shows what this loadout holds against a ceiling — the sum of the best "
    + "source in each bonus type that carries the stat. Those sources may compete for one slot, "
    + "so the ceiling is an upper bound and no loadout is claimed to reach it.";

  function ceilingShortForm(s) {
    if (s.capBound) {
      return `clamped to your cap of ${s.cap}: the cap, not the gear pool, is what this fraction measures against.`;
    }
    if (s.zeroCeiling) {
      return "this solve found nothing reachable that carries this stat.";
    }
    if (s.maxed) {
      return "at the ceiling: every bonus type carrying this stat holds its best available source, "
        + "so no other item in your pool raises it.";
    }
    // A capped stat still SHORT of its cap. `ceilingUpperBound === cap` means
    // min(cap, Σ best) picked the cap, i.e. Σ best >= cap — so the denominator on
    // screen is the cap, NOT the summed per-bucket best. The plain shortfall
    // wording below would name the wrong source for its own number. We say only
    // that the ceiling IS the cap: the clamped report cannot distinguish
    // "Σ best exceeded the cap" from "Σ best landed exactly on it", so claiming
    // the pool could go higher would be an inference the data does not carry.
    if (s.cap != null && s.ceilingUpperBound === s.cap) {
      return `the ceiling here is your cap of ${s.cap}.`;
    }
    return "the ceiling sums the best source in each bonus type that carries this stat.";
  }

  function ceilingFor(result, stat) {
    const row = ((result && result.ceilingReport) || []).find((r) => r && r.stat === stat);
    if (!row) return null;
    const achieved = row.achieved || 0;
    const ceilingUpperBound = row.ceiling || 0;
    // #645 — an INVERTED row is not renderable. A ceiling below the achieved
    // value contradicts KTD2's whole premise, and every sentence below would be
    // built on it: `maxed` goes false, so the card states a shortfall against a
    // number smaller than the one printed beside it. A live solve cannot produce
    // this (a bucket's taken never exceeds its best, and worn penalties only
    // lower the numerator) — but a SAVED one can, because ceilingReport is
    // persisted JSON and a restored character is never re-solved (KTD6). Builds
    // saved before the penalty fix carry it permanently: the report that found
    // this shipped a snapshot reading 37 / 36. Returning null routes the card to
    // the legacy chip, which is the same path a pre-#449 restore already takes.
    if (achieved > ceilingUpperBound) return null;
    const capped = (result && result.capped) || {};
    const cap = capped[stat] != null ? capped[stat] : null;
    // Both sides are already clamped, so `achieved === cap` IS "the cap is the
    // denominator". Tested BEFORE `maxed` — see KTD7 above.
    const capBound = cap != null && achieved >= cap;
    const zeroCeiling = !capBound && ceilingUpperBound === 0;
    const maxed = !capBound && !zeroCeiling && achieved === ceilingUpperBound;
    const s = { stat, achieved, ceilingUpperBound, cap, capBound, zeroCeiling, maxed };
    s.fraction = `${achieved} / ${ceilingUpperBound}`;
    s.short = ceilingShortForm(s);
    s.line = `${s.fraction} — ${s.short}`;
    return s;
  }

  /** The ONE full statement, rendered once per readout and once per export
   *  document (R15). It carries the qualification the short forms deliberately
   *  omit: repeated under every card down an eight-priority build it reads as
   *  boilerplate and stops being read. Null when no stat has a row, so a
   *  pre-#449 restore prints no orphan sentence.
   */
  function ceilingStatement(result) {
    return ((result && result.ceilingReport) || []).length ? CEILING_FULL_STATEMENT : null;
  }

  /** #239 — the empty-slot disclosure as plain sentences.
   *
   *  Reads `emptySlots` (plain JSON on the result) rather than deriving it, for
   *  the same reason the saturation line does: the worn-slot list lives on the
   *  model, which a restored character no longer has.
   *
   *  States the fact only. The invitation to add priorities is app-side — a
   *  shared export has no Adjust & re-solve panel, and pointing a reader at a
   *  control that is not in front of them is worse than saying nothing.
   */
  function emptySlotNoticeLines(result) {
    const e = (result && result.emptySlots) || { count: 0, slots: [] };
    const lines = [];
    if (e.count) {
      const isOne = e.count === 1;
      lines.push(`${e.count} ${isOne ? "slot is" : "slots are"} empty (${(e.slots || []).join(", ")}) — `
        + `nothing available for ${isOne ? "it" : "them"} improves these priorities.`);
    }
    // #110 (U8/R10) — a slot the player's own exclusions emptied is a different
    // fact from a slot with nothing worth wearing, and reads as one.
    const b = e.blockedSlots || [];
    if (b.length) {
      lines.push(`${b.join(", ")} ${b.length === 1 ? "is" : "are"} empty because your blocklist `
        + `removed every eligible candidate — unblock something or the slot${b.length === 1 ? "" : "s"} will stay bare.`);
    }
    return lines;
  }

  /** U6/#249 — the compound-absorption quarantine as plain sentences.
   *
   *  ONE source for the app notice and every export, the contract
   *  `saturationNoticeLines` holds. Reads `absorptionQuarantine` (plain JSON on
   *  the result), never the pool, so a restored character discloses identically
   *  without re-solving.
   *
   *  Wording rule: `docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md`.
   *  Each sentence states three things, all verifiable from the data that
   *  produced it — which affix was removed, from which item, and which stats it
   *  was therefore not credited to. It says nothing about what the build WOULD
   *  have scored with the carrier included: that is a solve nobody ran, and for
   *  an unconfirmed carrier the element set is precisely what is unknown, so
   *  even the direction of the difference is unknowable.
   */
  function absorptionQuarantineNoticeLines(result) {
    const report = (result && result.absorptionQuarantine) || [];
    return report.map((e) => {
      // Branch on BOTH reasons by name, never on one with the other as an else.
      // A third reason shipping from `src/absorption_split.py` would otherwise be
      // silently rendered as "no wiki record", which is a different — and
      // possibly false — claim about why the affix was dropped. An unrecognized
      // reason says only what is certain.
      const why = e.reason === "unconfirmed"
        ? `the wiki record of which elements it covers is not confirmed`
        : e.reason === "absent"
          ? `there is no wiki record of which elements it covers`
          : `which elements it covers is not established`;
      const to = (e.components || []);
      const named = to.length > 1
        ? `${to.slice(0, -1).join(", ")} or ${to[to.length - 1]}`
        : (to[0] || "any element");
      return `${e.stat} on ${e.item} was excluded from this build because ${why}, `
        + `so it was not credited to ${named}.`;
    });
  }

  /** #91 (U6/R9/R10) — the ONE canonical utility sentence.
   *
   *  Single wording source, the contract `saturationNoticeLines` holds: every
   *  export prints this sentence; a surface may add its own section framing
   *  ("Utility effects (N)") but never a second sentence corpus that can drift.
   *  The zero-state wording matches results.js's utilityCard verbatim — R9 says
   *  a zero count is stated plainly, never rendered as an empty receipts list.
   */
  /** #348 (U5, R14) — the ONE canonical sentence for the priced top miss.
   *
   *  Three outcomes, three sentences, because they are three different facts and
   *  only one of them is a price:
   *
   *  - give > 0   the effect is reachable, and this is what it costs on the top
   *               priority. Lower priorities are left free by the probe, so it is a
   *               LOWER BOUND and says so — never presented as the whole bill.
   *  - give === 0 securing it costs nothing on the top priority. This is not "free":
   *               the container solves last, so an unsecured effect is always
   *               blocked by something, and a zero only locates the block below
   *               priority 1. Measured on the parity set this is the most common
   *               outcome (7 of 17), which is exactly why it gets its own wording
   *               instead of rendering as "costs 0".
   *  - infeasible no solution secures it at any price on the top priority, either
   *               because a higher-ordered container effect holds the slot or
   *               because nothing equippable can carry it here.
   *
   *  Returns null when nothing was outbid — the caller renders nothing at all. */
  function utilityPriceLine(price) {
    if (!price || !price.name) return null;
    const what = price.name;
    if (price.infeasible) {
      return price.blockedByHigherOrder
        ? `${what} could not be secured at any cost here — an effect you placed above it holds the slot.`
        : `${what} could not be secured at any cost here — nothing you can equip carries it alongside this build.`;
    }
    if (price.free) {
      return `${what} costs nothing on ${price.stat} — it is competing with your lower-ranked priorities, `
        + "so moving it up your list or relaxing one of those is what would win it.";
    }
    return `${what} is reachable: it would cost at least ${price.give} ${price.stat}. `
      + "Lower priorities may pay as well — this is the give on your top priority alone.";
  }

  /** #348 (U3, R14) — the container's misses, in the player's order, each with the
   *  reason it was missed. One line per effect so a surface can list them; the
   *  priced sentence above covers only the top one. */
  function utilityUnsecuredLines(ordered) {
    const list = (ordered && ordered.unsecured) || [];
    return list.map((u) => (u.reason === "unreachable"
      ? `${u.name} — nothing in your gear pool carries it at this level.`
      : `${u.name} — carried by gear you could equip, but it lost the slot.`));
  }

  function utilityLine(count) {
    if (!count) return "0 utility effects on this loadout — no counted on/off effects are present.";
    return `${count} utility ${count === 1 ? "effect" : "effects"} on this loadout`;
  }

  // #332 — the ranked-but-uncounted disclosure. THE gap it closes: rank Undead
  // Bane with the tier on and the solve reports it satisfied at 13 while the
  // utility card says 11 effects without it. Both statements are true and nothing
  // reconciled them; #343 took this from 0 names to 24 by removing the reviewed
  // weapon procs from the count while leaving them rankable.
  //
  // `names` is already narrowed to PRESENCE effects by the caller — a ranked
  // magnitude like Melee Power is not something a player would expect the utility
  // count to include, so naming it here would be noise. One sentence, every
  // surface (the app card and all five exports render this string).
  // #332 — the narrowing, extracted so the app card and the exports cannot drift.
  // Accepts either a snapshot or a live solve result: both carry `utilityReport`
  // and `breakdown`. Returns { names, line } with an empty array and a null line
  // when nothing qualifies, so a caller can test either shape.
  function utilityExcludedFor(snapOrResult) {
    const s = snapOrResult || {};
    const rep = s.utilityReport;
    if (!rep) return { names: [], line: null };
    // The solve already narrowed this to the reviewed weapon procs (see
    // web/solver.js's utilityRankedNotCounted). Do NOT re-filter on affix type: an
    // earlier draft required every contribution to be presence-typed, which
    // silently emptied the list — these procs are UNTYPED magnitudes (Undead Bane
    // reads bonus_type "Untyped"/null with a real value), not Bool presences. The
    // only remaining condition is that the loadout actually carries the stat,
    // since "not counted" is a confusing thing to say about a stat with no sources.
    const names = ((rep.rankedNotCounted) || []).filter((stat) => {
      const parts = (s.breakdown && s.breakdown[stat]) || [];
      return parts.length > 0;
    });
    return { names, line: utilityExcludedLine(names) };
  }

  function utilityExcludedLine(names) {
    const list = (names || []).filter(Boolean);
    if (!list.length) return null;
    const which = list.length === 1 ? `${list[0]} is` : `${list.join(", ")} are`;
    return `${which} ranked as ${list.length === 1 ? "its own priority" : "their own priorities"} and `
      + `${list.length === 1 ? "is" : "are"} not part of this count — `
      + "weapon procs are ranked individually rather than counted by the Utility effects priority.";
  }

  /** #345 (U1, R5) — the outbid sentence, owned here so the results panel and
   *  all six exports render one wording. Reads the names the solver stamped;
   *  a restored character has no model and cannot re-derive them. */
  function outbidNoticeLines(names) {
    const list = (names || []).filter(Boolean);
    if (!list.length) return [];
    const many = list.length > 1;
    return [`Your gear can supply ${list.join(", ")}, but ${many ? "they" : "it"} scored 0 — `
      + `a higher-ranked priority took the ${many ? "slots" : "slot"}. `
      + `Ranking ${many ? "them" : "it"} higher only helps once ${many ? "they rank" : "it ranks"} `
      + `above whatever outbid ${many ? "them" : "it"}; setting a minimum makes `
      + `${many ? "them" : "it"} a requirement instead.`];
  }

  /** #88 U8 (R14/R16) — the optimality qualifier for a solve that ran under one or
   *  more player bonus-type overrides. The sibling of `creditNoticeLines` below,
   *  and the same class of statement: part of the answer rests on something the
   *  player asserted and the tool did not verify.
   *
   *  It qualifies on `inForce`, not on what was picked. The proof is about a model
   *  built from an overridden catalog, so an override that changed which item lost
   *  its slot has shaped the result just as surely as one whose affix is in the
   *  loadout. (#416 is open on whether the narrower reading is wanted; this one can
   *  only over-disclose, which is the safe direction for a claim of optimality.)
   *
   *  Contributions are named separately when there are any, because "one of your
   *  corrections is in this build" is a materially stronger statement than "one was
   *  in force", and R16 says both types are named wherever a correction shows. */
  function overrideNoticeLines(result) {
    const report = (result && result.overrideReport) || null;
    const inForce = (report && report.inForce) || [];
    if (!inForce.length) return [];
    const lines = [];
    const many = inForce.length > 1;
    lines.push(`You corrected the bonus type of ${inForce.length} ` +
      `${many ? "affixes" : "affix"}. The optimizer solved with ` +
      `${many ? "those types" : "that type"} in place on your word — the wiki records ` +
      `${many ? "different ones" : "a different one"} — so the loadout below is optimal ` +
      `given ${many ? "them" : "it"}, not proven against the catalog.`);
    const contribs = (report && report.contributions) || [];
    for (const c of contribs) {
      lines.push(`${c.stat} on ${c.host || "a crafting option"} is counted as ${c.to} ` +
        `because you said so; the catalog records ${c.from}.`);
    }
    return lines;
  }

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

  /* ---- U10 (plan 2026-08-22-001) — the three multi-fact notices, one entry per
   *  FIRED branch -------------------------------------------------------------
   *
   *  `artifactNotice`, `boundNotice` and `zeroSourceNotice` each bundled several
   *  independent facts into one paragraph. Those facts classify differently, so a
   *  single title over the bundle would assert something the solve did not
   *  establish: "DECLARED CREDIT APPLIED" over a `boundNotice` that fired for its
   *  ML-floor branch claims a declared credit on a solve that declared none. That
   *  is instance 3 in
   *  `docs/solutions/conventions/never-infer-a-claim-about-your-own-results.md` —
   *  a disclosure channel is itself a claim.
   *
   *  So each branch gets its own addressable entry: `{ id, title, class, sentence }`.
   *  `class` is `"actionable"` (the player has a control that resolves it) or
   *  `"qualifying"` (it changes how the numbers should be read, with no resolution
   *  path). The titles and classes are KTD5's settled table, not a local choice.
   *
   *  The WORDING lives here, with every other notice's, so the app and all five
   *  share exports cannot drift. The FACTS are derived by the caller: these three
   *  read the model, the dataset and the slot pins, which live on the results
   *  side, and re-deriving them here would be a second source for the same fact.
   *
   *  `esc` is the caller's escaper, applied at exactly the interpolation points
   *  the pre-split render escaped — so an HTML surface passes `esc` and gets
   *  byte-identical markup, and a text surface passes nothing and gets the plain
   *  sentence. The literal template text is never escaped, which is why this stays
   *  a wording source rather than an HTML producer.
   */
  const NOTICE_ACTIONABLE = "actionable";
  const NOTICE_QUALIFYING = "qualifying";
  // #449 U5 (KTD6) — the third class. No entry function mints it today (every
  // split branch is actionable or qualifying), but the name lives beside its two
  // siblings so results.js has ONE place to read the vocabulary from rather than
  // two constants here and a bare string there.
  const NOTICE_INFORMATIONAL = "informational";
  function _asText(s) { return String(s == null ? "" : s); }

  /** #369 + U5/R6 — the two Artifact facts. They are mutually exclusive by
   *  construction (the none-flagged branch needs the opt-in ON, the pin branch
   *  needs it OFF), and must never share a card: "no Artifact could be included"
   *  printed over a named, included Artifact is a flat contradiction.
   *  `facts`: `{ missing, pinnedArtifacts }`. */
  function artifactNoticeEntries(facts, esc) {
    const e = esc || _asText;
    const f = facts || {};
    if (f.missing) {
      return [{ id: "artifact-unavailable", title: "ARTIFACT UNAVAILABLE", class: NOTICE_QUALIFYING,
        sentence: "No Artifact could be included — none is flagged in the current data." }];
    }
    const names = (f.pinnedArtifacts || []).filter(Boolean);
    if (!names.length) return [];
    const one = names.length === 1;
    return [{ id: "artifact-pinned-in", title: "ARTIFACT PINNED IN", class: NOTICE_ACTIONABLE,
      sentence: `${e(names.join(", "))} ${one ? "is an Artifact and was" : "are Artifacts and were"}`
        + ` included because you pinned ${one ? "it" : "them"}, even though "Include an Artifact" is off.`
        + ` Unpin to exclude ${one ? "it" : "them"}.` }];
  }

  /** U3 (plan 2026-08-05-001) — the two zero-source causes. Two different player
   *  actions, so two entries: a stat no data carries has no resolution path, and a
   *  stat the filters removed does. `facts`: `{ absent, filtered, owned,
   *  rungRestricts, removed }`, where the last three are the filtered branch's
   *  evidence-based cause attribution (results.js derives it from the dataset). */
  function zeroSourceNoticeEntries(facts, esc) {
    const e = esc || _asText;
    const f = facts || {};
    const absent = f.absent || [];
    const filtered = f.filtered || [];
    const entries = [];
    if (absent.length) {
      entries.push({ id: "stat-not-in-data", title: "STAT NOT IN DATA", class: NOTICE_QUALIFYING,
        sentence: `Nothing in the current data carries ${absent.map((s) => e(s)).join(", ")}`
          + " — ranking it can't change your build." });
    }
    if (filtered.length) {
      // Deliberately does NOT name a single cause unless there is evidence for
      // one: the pool the solver sees is the product of the ML band, the gear
      // pool, the character gates AND the dominance pre-filter. Only the
      // owned-pool and the crafting-rung cases are named, because each is an
      // explicit, single, reversible choice the player made.
      const where = f.owned ? "your owned-gear pool"
        : f.rungRestricts ? `your current filters, which exclude ${f.removed}` : "your current filters";
      const fix = f.owned ? "the full catalog may have one"
        : f.rungRestricts ? `raising "What may the solver assume beyond the printed item?" may reach `
          + (filtered.length > 1 ? "them" : "it")
          : "widening the ML band or character filters may reach " + (filtered.length > 1 ? "them" : "it");
      entries.push({ id: "stat-filtered-out", title: "STAT FILTERED OUT", class: NOTICE_ACTIONABLE,
        sentence: `No source of ${filtered.map((s) => e(s)).join(", ")} is available in ${where} — ${fix}.` });
    }
    return entries;
  }

  /** U5/U4/#88 U8/plan-003 U6 — how the solve was bounded, as one entry per fired
   *  branch. `facts`: `{ mlFloor, floorReport, heldCaps, creditLines,
   *  overrideLines, offHand }`. `heldCaps` is `[{ stat, cap }]`; `offHand` is
   *  null unless the Two Weapon Fighting exclusion actually fired, and otherwise
   *  `{ mode: "none" | "pinned" | "stale", name }` — the caller reads the same
   *  authority the off-hand pool used and the actual pin, never inferring either.
   *
   *  `creditLines` and `overrideLines` come from `creditNoticeLines` /
   *  `overrideNoticeLines` above: each is several sentences about ONE fact, so
   *  each stays one entry rather than becoming N cards under a repeated title.
   *
   *  The off-hand entry carries two sentences — the exclusion (in whichever of its
   *  three forms applies) and the unscored-penalty caveat that always accompanies
   *  it. KTD5's table has no row for the caveat; it is kept with the sentence it
   *  qualifies rather than given an invented title of its own. */
  function boundNoticeEntries(facts, esc) {
    const e = esc || _asText;
    const f = facts || {};
    const entries = [];
    // #508 — the declaration was made and the style cannot honour it, so Two Weapon
    // Fighting changed NOTHING: no off-hand item was excluded, and no second weapon
    // was offered either. First, because a player who declared a feat and got a
    // shield needs to know why before they read anything else about this build.
    //
    // ACTIONABLE, not qualifying: unlike a declared credit or a held cap, there is a
    // control that fixes it. And it reports a consequence rather than a mistake —
    // declaring before choosing a style is a state the wizard supports on purpose.
    //
    // The two forms mirror the wizard's own inert notice (`wz-twf-inert`), which
    // distinguishes "no style yet" from "a style that doesn't dual-wield", because
    // the next action differs: pick one, versus switch the one you have.
    const twf = f.twfInert;
    if (twf) {
      // DELIBERATELY NOT the exclusion's vocabulary. "shields, orbs, and rune arms"
      // is reserved for the sentence that says they LEFT candidacy, and a U6/003
      // test asserts no other notice borrows it — a build under Sword & Board would
      // otherwise read as though something had been excluded when nothing was.
      // This notice's job is the opposite claim, so it needs its own words.
      const what = twf.name
        ? `, and ${e(twf.name)} is in your off hand`
        : " — no off-hand item was excluded, and no second weapon was offered";
      entries.push({ id: "twf-not-applied", title: "TWO WEAPON FIGHTING NOT APPLIED",
        class: NOTICE_ACTIONABLE,
        sentence: (twf.style
          ? `You declared Two Weapon Fighting, but ${e(twf.styleLabel || twf.style)} doesn't wield`
            + ` a second weapon, so it changed nothing${what}.`
          : `You declared Two Weapon Fighting, but no combat style is set, so it changed nothing${what}.`)
          + " Pick One-hand / Dual-wield and re-solve to apply it." });
    }
    const floor = Number(f.mlFloor);
    if (floor) {
      entries.push({ id: "gear-ml-floor", title: "GEAR ML FLOOR", class: NOTICE_QUALIFYING,
        sentence: `Considered gear ML ≥ ${e(floor)} (your floor).` });
    }
    const misses = f.floorReport || [];
    if (misses.length) {
      entries.push({ id: "floor-not-reached", title: "FLOOR NOT REACHED", class: NOTICE_ACTIONABLE,
        sentence: misses.map((m) => `Couldn't reach your floor of ${e(m.floor)} ${e(m.stat)}`
          + ` — best achievable was ${e(m.achieved)}.`).join(" ") });
    }
    const held = f.heldCaps || [];
    if (held.length) {
      entries.push({ id: "held-at-your-cap", title: "HELD AT YOUR CAP", class: NOTICE_QUALIFYING,
        sentence: `Held at your cap: ${held.map((h) => `${e(h.stat)} ${e(h.cap)}`).join(", ")}.` });
    }
    const credits = f.creditLines || [];
    if (credits.length) {
      entries.push({ id: "declared-credit", title: "DECLARED CREDIT APPLIED", class: NOTICE_QUALIFYING,
        sentence: credits.map((l) => e(l)).join(" ") });
    }
    const overrides = f.overrideLines || [];
    if (overrides.length) {
      entries.push({ id: "bonus-type-override", title: "BONUS TYPE OVERRIDDEN", class: NOTICE_QUALIFYING,
        sentence: overrides.map((l) => e(l)).join(" ") });
    }
    const off = f.offHand;
    if (off) {
      const caveat = "The optimizer doesn't score the Two Weapon Fighting penalty (or a shield's"
        + " defense), so the off-hand pick was compared on ranked-stat value alone.";
      const name = e(off.name);
      if (off.mode === "stale") {
        // The one off-hand case with a resolution path: the shown build predates
        // the declaration, and re-solving applies it.
        entries.push({ id: "re-solve-to-apply", title: "RE-SOLVE TO APPLY", class: NOTICE_ACTIONABLE,
          sentence: "You declared Two Weapon Fighting, so shields, orbs, and rune arms leave off-hand"
            + ` candidacy — but this build still shows ${name} in the off hand, so it was solved`
            + ` before the declaration. Re-solve to apply it. ${caveat}` });
      } else {
        entries.push({ id: "off-hand-excluded", title: "OFF-HAND EXCLUDED", class: NOTICE_QUALIFYING,
          sentence: (off.mode === "pinned"
            ? "You declared Two Weapon Fighting, so shields, orbs, and rune arms left off-hand"
              + ` candidacy — your pinned ${name} overrode that and is equipped.`
            : "You declared Two Weapon Fighting, so shields, orbs, and rune arms left off-hand"
              + " candidacy — pin one to bring it back.") + ` ${caveat}` });
      }
    }
    return entries;
  }

  const api = {
    // #335 U4 — the render-layer ×2 collapse and its derived receipt line.
    collapseTwins, secondCopyContribution,
    // resolved-view assembler
    project, creditNoticeLines, saturationNoticeLines, emptySlotNoticeLines,
    absorptionQuarantineNoticeLines, declaredCreditsLine, overridesLine, overrideNoticeLines,
    correctionReport,
    // #91 (U6) — the one utility sentence + the tier's display name (from
    // model.js; re-exported so exporters can recognize the sentinel row)
    utilityLine, utilityPriceLine, utilityUnsecuredLines, UTILITY_SENTINEL: UTILITY_NAME,
    // pure primitives (results.js binds these; single definition, no drift)
    affixLabel, isPresence, isPresenceType, utilityExcludedLine, utilityExcludedFor, outbidNoticeLines, collapseExpansions, affixStatCoverage, affixCoverageKey, affixOwnName, craftStepLabel, craftAffixRecords, itemMl, wornMl, craftedMlIndex, displayItemName, contributingAffixes, assignAugments, canonicalSetAugments, dinoInsertKey, assignDinoInserts,
    attributionByTarget, whyThis, itemContributions, saturatedStats, saturationLineFor,
    // #449 (U2) — the achieved/ceiling fraction: numbers, state and wording from
    // one place, plus the once-per-document full statement.
    ceilingFor, ceilingStatement, CEILING_FULL_STATEMENT,
    satisfiedSets, suppressedHostIds, slotSetNames,
    setContributors, contributorsFor, setMemberLabel, activeSetDetail, satisfiedSetDetail,
    // craft + cue helpers
    buildCraftMaps, craftLabel, craftValue, unfilledVikSlots, vikSlotRows, tierSlotRows, lunarSolar, setAugmentSlotRule,
    // #471 — the split craft label + section caption for the Loadout card's row
    // language. Generated from the same fields as craftLabel, beside it (KTD6).
    craftRowLabel, CRAFT_SECTION_LABEL,
    // #245 — craft-carried disclosure + the opt-out notice line
    craftCarried, craftingExcludedLine,
    // #339 — the augment-ceiling scope disclosure line
    augCeilingLine, dodgeMaxDexLine, jumpSoftCapLine, mrrCapLine, conditionalNoticeLines, splitMechanicLine, capSurplusLines, packFilterNoticeLines, setFilterNoticeLines,
    essenceNoticeLines, greenSteelNoticeLines,
    // #262 — the one no-drop-source disclosure wording (results/browse/wizard
    // and every exporter read it from here; never respell it)
    NO_DROP_SOURCE_WORDING,
    // #614 — the one unmodelled-penalty disclosure wording + its two helpers
    // (results card and every exporter read them from here; never respell)
    PENALTY_COUNTED_WORDING, itemPenalties, penaltyDisclosure,
    // #110 — the blocklist disclosure sentences
    blockNoticeLines, setPinNoticeLines,
    // U10 — the three multi-fact notices, one addressable entry per fired branch
    artifactNoticeEntries, zeroSourceNoticeEntries, boundNoticeEntries,
    NOTICE_ACTIONABLE, NOTICE_QUALIFYING, NOTICE_INFORMATIONAL,
    // constraint header helpers (exporters delegates to these)
    constraintPairs, constraintLines,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Projection = api;
})();
