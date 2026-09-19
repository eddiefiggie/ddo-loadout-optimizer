// #773 — player-authored items: validation, identity, and the catalog-shaped
// record the solver reads. Pure, dual-exported for Node tests. Namespaced global
// `CustomItems`, mirroring the no-DOM shape of overrides.js and weapon-taxonomy.js.
//
// A custom item is a player assertion that they own a piece of gear this catalog
// does not carry — a Cannith-crafted ring, an Essence-crafted weapon, anything
// the wiki harvest has no record of. It is the same family as a declared credit
// (`web/model.js` normalizeCredits) and a bonus-type override (`web/overrides.js`):
// the player supplies a number the wiki did not, and every surface that reports
// the build says so.
//
// That last clause is the whole reason this file can exist at all. `AGENTS.md`
// says never infer a value, and this tool's claim is that its answer is provable.
// A player-authored number does not weaken that claim, because the tool is not the
// one asserting it — but only for as long as the disclosure is unconditional.
// `playerAuthoredNotice` and the `player_authored` marker below are load-bearing,
// not decoration.
//
// Four decisions here were each settled against an alternative that looked easier:
//
//  - **The record is minted into the catalog's own shape**, not carried as a new
//    kind of thing the solver has to learn. Everything downstream — the dominance
//    filter, the worn-slot pick vars, pinning, the Main/Off Hand split, augment
//    capacity, the results card, all six exports — already works on that shape, so
//    a custom item inherits every one of them for free. A parallel "wildcard item"
//    solver primitive was the 2026-07-25 crafting-roadmap proposal; it is a much
//    larger change and it answers a DIFFERENT question (let the solver FABRICATE
//    an item), which stays out of scope. See docs/plans/2026-09-16-001.
//
//  - **Stats and bonus types come from the vocabularies that already exist**,
//    never free text. A name outside the picker vocabulary cannot be ranked, so an
//    item carrying it would be admitted, score nothing, and read as the tool
//    ignoring the item the player just typed in. Refusing at entry, naming the
//    reason, is the `exclude-until-verified` convention applied to player input.
//
//  - **The id IS the name, suffixed `(yours)`.** The first cut used an opaque
//    `custom:<uid>`, which is the safer-looking choice and was wrong: this app
//    treats `variant_id` as BOTH identity and display text (the catalog's own ids
//    are human-readable, like `Hydra's Heart (Tier 3)`), so an opaque id rendered
//    the player's dagger as the literal string `custom:1` on the results card and
//    in every export. Patching fifteen display sites to special-case one record
//    shape would have been the larger and far more fragile change.
//
//    The suffix does two jobs. It makes a catalog collision impossible by
//    CONSTRUCTION — no catalog name contains `(yours)`, which a test asserts
//    against the built roster — and it makes the disclosure STRUCTURAL: every
//    surface that prints an item name prints the provenance with it, including
//    the ones written before this feature existed and the ones written after it
//    that forget to ask. `player_authored` stays as the machine-readable marker
//    the notice and the export phrase key on.
//
//    The cost is that a rename moves the id, which would strand a pin. That is
//    handled where the rename happens (wizard.js migrates the pin on edit),
//    because a visible, tested migration is better than a permanently unreadable
//    label on every surface a player looks at.
//
//  - **`verification` is stamped `"verified"`, and that is not a claim.** It is
//    the solver's own eligibility gate (`web/model.js`: a variant whose
//    verification is not "verified" is refused with "this item isn't verified"),
//    so a custom item must carry it to be placeable at all. The honesty marker is
//    the SEPARATE `player_authored` field, which no catalog record carries and
//    every disclosure surface reads. Conflating the two would have meant either a
//    custom item that can never be placed, or a widened core gate.
(function () {
  "use strict";

  /** The suffix that turns a player's name into a pool identity.
   *
   *  Asserted collision-free against the built catalog by
   *  `tests/custom-items.test.js`, and it is why `validateEntry` refuses a name
   *  that already contains it: "My ring (yours)" would otherwise mint
   *  "My ring (yours) (yours)" today, and an ambiguous id the day anything parses
   *  the suffix back off. */
  var CUSTOM_SUFFIX = " (yours)";

  /** How many custom items one character may carry.
   *
   *  A sanity ceiling, not a product limit, and it exists for the reason
   *  `OVERRIDE_LIMIT` does: a saved character is not only what this app writes.
   *  `backup.js` accepts an imported file up to its own size cap, and every custom
   *  item is concatenated into the candidate pool on every solve and every pin
   *  search. The reporter asked for "a few of our own items"; a player with fifty
   *  is describing a catalog gap rather than a personal one. */
  var CUSTOM_LIMIT = 12;

  var NAME_MAX = 80;
  var ML_MIN = 1, ML_MAX = 36;
  /** Values are bounded for exactly the reason `MAX_CREDIT_VALUE` is, and to the
   *  same number deliberately: a player-typed magnitude is not wiki-traceable, and
   *  above ~1e15 it stringifies into LP text HiGHS refuses to parse, which THROWS
   *  out of the solver instead of returning an infeasible status. Bounded here so
   *  the refusal is a message next to the field rather than a crash on Solve. */
  var VALUE_MAX = 9999;
  /** Affixes per custom item. A real DDO item tops out well below this; the cap is
   *  here so one hand-edited backup entry cannot make the dominance filter's
   *  per-variant work unbounded. */
  /** An Essence Crafted item carries at most one enchantment per menu, so the
   *  ceiling is the menu count, not a sanity cap. `AFFIX_MAX` is kept as a real
   *  cap too, so a hand-edited backup still cannot make the dominance filter's
   *  per-variant work unbounded, but placement is what actually binds.
   *
   *  #795 shipped this rule UNSOURCED, from prose in a plan doc, and said in the
   *  comment here that it was wiki-stated. #797 harvested it. Three slots, one
   *  effect each:
   *
   *    "Each craftable item has a prefix and a suffix enchantment slot."
   *    "A Mark of House Cannith can be used to add a third extra enchantment
   *     slot."                                      - `Essence Crafting`
   *
   *  and the strongest form the wiki offers, the game refusing the action:
   *
   *    "(An error will pop up if you already have a Suffix, Prefix, or Insightful
   *     bonus and are trying to install a second one.)"
   *                                                 - `Essence Crafting steps`
   *
   *  KNOWN GAP, disclosed rather than hidden by the phrasing: a **combined
   *  prefix** is one shard carrying TWO effects, so one-per-SLOT holds while
   *  one-per-EFFECT does not. The bench cannot express one. See
   *  `docs/wiki-evidence/essence-crafting.md` and #800. */
  var MENUS = ["Prefix", "Suffix", "Extra"];

  /** #815 — what to CALL each menu to a player.
   *
   *  `Extra` is `table 1b`'s own column name, and it is the right data key. It is
   *  the wrong word to show: the wiki calls that third slot the **Mark of House
   *  Cannith Slot**, and a player looking for it on the bench could not find it.
   *
   *      "If the item is ML 10 or greater, it has a 'Mark of House Cannith Slot',
   *       where another effect can be applied (Insightful Strength, Insightful
   *       Accuracy, etc.)"                          - `Essence Crafting steps`
   *
   *  Display only. Nothing keys on these, and `MENUS` is unchanged, so the data
   *  and the label cannot drift into two vocabularies. */
  var MENU_LABELS = {
    "Prefix": "Prefix",
    "Suffix": "Suffix",
    "Extra": "Mark of House Cannith",
  };

  function menuLabel(menu) { return MENU_LABELS[menu] || menu; }
  var AFFIX_MAX = 3;

  // Worn slots + the two hands. `Weapon` is the catalog's own slot label for a
  // wielded weapon (model.js builds Main Hand / Off Hand pick vars from it
  // dynamically, which is why neither is in WORN_SLOTS); `Off Hand` is the label
  // the catalog uses for shields, orbs and rune arms.
  var SLOTS = [
    "Armor", "Helmet", "Goggles", "Necklace", "Trinket", "Cloak",
    "Belt", "Ring", "Gloves", "Boots", "Bracers", "Quiver",
    "Weapon", "Off Hand",
  ];

  // The augment colors the solver's per-colour capacity model knows. Anything
  // else would be counted into no colour and silently grant nothing.
  var COLORS = ["Colorless", "Blue", "Green", "Yellow", "Red", "Orange", "Purple"];

  // Resolved PER CALL rather than captured at script-eval time, for the reason
  // overrides.js documents: capturing binds to whatever the global happened to be
  // when this file's script tag ran — correct today, but a load-order change
  // would leave it null forever, in the browser only, where no Node test can see
  // it. `model.js` publishes bare globals rather than a namespace (it is loaded
  // first as a plain script), so its bridge tests the identifier directly, the
  // same shape wizard.js uses for the constants it shares.
  function _mod(globalName, path) {
    if (typeof window !== "undefined" && window[globalName]) return window[globalName];
    // eslint-disable-next-line global-require
    if (typeof require !== "undefined") { try { return require(path); } catch (e) { /* absent */ } }
    return null;
  }
  function _dataset() { return _mod("DatasetNormalizer", "./dataset.js"); }
  function _taxonomy() { return _mod("WeaponTaxonomy", "./weapon-taxonomy.js"); }

  /** The bonus types a player may put on a custom affix.
   *
   *  Deliberately the SAME list a declared credit and a bonus-type override draw
   *  from (`CREDIT_BONUS_TYPES`), not a new one: all three are the player naming a
   *  stacking bucket, and a second list would drift from `equivType` the moment
   *  the first one was maintained. It is also already checked against the wiki's
   *  own Category:Bonus types on every build. */
  function bonusTypes() {
    // eslint-disable-next-line no-undef
    if (typeof CREDIT_BONUS_TYPES !== "undefined") return CREDIT_BONUS_TYPES.slice();
    // eslint-disable-next-line global-require
    if (typeof require !== "undefined") { try { return require("./model.js").CREDIT_BONUS_TYPES.slice(); } catch (e) { /* absent */ } }
    return [];
  }

  function customSlots() { return SLOTS.slice(); }
  function augmentColors() { return COLORS.slice(); }

  /** The `type` values legal for a slot, or null when the slot takes none.
   *
   *  Handedness is read from the shared taxonomy rather than restated: the same
   *  table decides which combat style a weapon belongs to and whether the wizard
   *  offers it an Off Hand pin, so a custom `Daggers` must be the same `Daggers`
   *  the picker means. A type this build's taxonomy does not know would leave the
   *  item wieldable under no style at all. */
  function typesForSlot(slot) {
    var tax = _taxonomy();
    if (!tax) return null;
    if (slot === "Weapon") return Object.keys(tax.STYLE_OF_TYPE || {}).sort();
    if (slot === "Off Hand") {
      return (tax.OFF_HAND_TYPES || []).slice().sort();
    }
    return null;
  }

  // ------------------------------------------------------------------
  // #795 — Essence Crafting placement rules.
  //
  // Essence Crafting IS Cannith Crafting (the U79 rename; see the shard's
  // `_meta.note`), which is why this serves the only player report on file: "a
  // couple of CC rings".
  //
  // The dataset publishes the placement table (`essence_placements`), so nothing
  // here re-derives which effects an item type can host. What this file owns is
  // the join from the slot/type a player picks to the table's own group name,
  // and the two ML-10 gates.
  // ------------------------------------------------------------------

  /** Off-hand dataset type -> placement group. Explicit, never derived: the four
   *  shield types collapse to one group and the other two do not. */
  var OFF_HAND_GROUP = {
    "Orbs": "Orbs",
    "Rune Arms": "Rune Arms",
    "Bucklers": "Shields",
    "Small shields": "Shields",
    "Large shields": "Shields",
    "Tower shields": "Shields",
  };

  /** #804 — which of `table 1b`'s two weapon groups a type belongs to.
   *
   *  The table names `Melee weapons` and `Ranged weapons` and never says which
   *  DDO weapon types are in each. #795 wrote the mapping by hand from
   *  `WeaponTaxonomy.STYLE_OF_TYPE`, whose axis is HANDEDNESS, and labelled it a
   *  construction. It is now sourced on one side and a labelled inference on the
   *  other, and the split is read from the published table rather than restated
   *  here:
   *
   *  RANGED is ENUMERATED. `Ranged weapons` carries `Table: Basic Ranged Weapons`
   *  — nine rows, bows and crossbows. Those nine map onto exactly the seven types
   *  the handedness construction already called Ranged, which is what retires it:
   *  it was right, and `tests/custom-items.test.js` now asserts that agreement so
   *  a future divergence goes red instead of passing quietly.
   *
   *  UNPLACED is a refusal with evidence rather than silence. The five thrown
   *  types are ABSENT from that enumeration, and `Thrown weapons` lists
   *  `Ranged weapons` under See also — a sibling, never a parent. `Handwrap`
   *  never calls them either way and says handwraps "are not programmed as
   *  weapons by design". So the wiki places neither, and neither is offered.
   *
   *  MELEE IS THE COMPLEMENT, and that is the one inference left in this model.
   *  There is no `Melee weapons` article and no category for it. Everything the
   *  taxonomy knows that is not sourced-ranged and not unplaced is treated as
   *  melee. Disclosed here rather than hidden, in the form the evidence doc uses
   *  for its ML-floor reasoning. A guard asserts the three sets are total and
   *  disjoint over `STYLE_OF_TYPE`, so the complement can never silently swallow
   *  a type the wiki actually placed.
   */
  function _weaponSplit(ctx) {
    var table = _placements(ctx);
    return (table && table.weapon_split) || null;
  }

  /** The placement table as published by the build.
   *
   *  Passed in on `ctx`, never reached for through a global. This module is
   *  dual-exported and pure, and a table fetched from the window would make the
   *  Node tests and the browser read different data — which is exactly the shape
   *  of bug the placement rules exist to prevent. `window.__essencePlacements` is
   *  the browser's one concession, set by the loader beside the dataset, so a
   *  caller that forgets `ctx.placements` still gets the real table rather than
   *  silently validating against an empty one. */
  function _placements(ctx) {
    var c = ctx || {};
    if (c.placements) return c.placements;
    if (typeof window !== "undefined" && window.__essencePlacements) {
      return window.__essencePlacements;
    }
    return null;
  }

  /** Which placement group an item of this slot/type is, or why it is none.
   *
   *  Returns `{ group }` or `{ refused: "<player-readable reason>" }`. Never
   *  guesses: every refusal names what is missing. */
  function essenceGroupFor(slot, type, ctx) {
    var table = _placements(ctx);
    var map = (table && table.slot_groups) || {};
    var groups = map[slot];
    if (!groups) return { refused: "“" + slot + "” is not a slot this build knows." };
    if (!groups.length) {
      // Quiver. The empty list is the sourced statement, not an omission.
      return { refused: "A " + slot.toLowerCase() + " cannot be Essence Crafted — the crafting "
        + "table has no enchantment list for it." };
    }
    if (groups.length === 1) return { group: groups[0] };

    // Ambiguous slot: the type decides.
    var t = String(type == null ? "" : type).trim();
    if (!t) {
      return { refused: "Choose what kind of item it is — the enchantments you can craft "
        + "differ between " + groups.join(", ") + "." };
    }
    if (slot === "Off Hand") {
      var g = OFF_HAND_GROUP[t];
      return g ? { group: g }
               : { refused: "“" + t + "” is not an off-hand type this build knows." };
    }
    // The taxonomy still decides whether this is a weapon type at all; the SPLIT
    // is what moved off it. Checked first so an unknown name is refused as
    // unknown rather than swept into the melee complement.
    var tax = _taxonomy();
    var known = tax && tax.STYLE_OF_TYPE
      && Object.prototype.hasOwnProperty.call(tax.STYLE_OF_TYPE, t);
    if (!known) return { refused: "“" + t + "” is not a weapon type this build knows." };

    var split = _weaponSplit(ctx);
    if (!split) return { refused: "The weapon split has not loaded yet." };
    if ((split.unplaced_types || []).indexOf(t) >= 0) {
      return { refused: "The crafting table lists “Melee weapons” and “Ranged weapons” and does "
        + "not say which one " + t.toLowerCase() + " belong to — the wiki’s list of ranged "
        + "weapons leaves them out without putting them anywhere else — so this build will "
        + "not guess. Pick another weapon type, or add the effects as a declared credit instead." };
    }
    if ((split.ranged_types || []).indexOf(t) >= 0) return { group: "Ranged weapons" };
    // The complement. See `_weaponSplit` for why this is an inference and what
    // keeps it honest.
    return { group: "Melee weapons" };
  }

  /** The menus an item of this group and ML may carry.
   *
   *  Extra is gated on the item's ML, not on the effect's: "Extra enchantment
   *  slots are not available on items under minimum level 10" (Essence Crafting,
   *  Components). Kept separate from the Insight rule below, which gates EFFECTS
   *  in any menu — the two coincide today only by accident. */
  function menusFor(group, ml, ctx) {
    var table = _placements(ctx);
    var groups = (table && table.groups) || {};
    if (!groups[group]) return [];
    var min = (table && table.extra_slot_min_ml) || 10;
    var n = Number(ml);
    return MENUS.filter(function (m) {
      if (!(groups[group][m] || []).length) return false;
      return m !== "Extra" || (isFinite(n) && n >= min);
    });
  }

  /** The effects offerable in one menu of one group at this ML.
   *
   *  Three filters, each with a reason the player can be told:
   *   - `rankable`: the effect's stat is not one the catalog uses, so nothing
   *     could ever rank it (the data layer decided this; see essence_placements).
   *   - the vocabulary gate the form already applies to any stat — a stat that
   *     can carry neither a typed magnitude nor an on/off flag is refused on
   *     entry, so offering it would be a picker that leads to a refusal.
   *   - `min_ml`: an Insight-typed effect needs ML 10, stated by the wiki for
   *     insight bonuses specifically. */
  function effectsFor(group, menu, ml, ctx) {
    var table = _placements(ctx);
    var groups = (table && table.groups) || {};
    var rows = (groups[group] && groups[group][menu]) || [];
    var c = ctx || {};
    var vocab = c.vocab;
    var n = Number(ml);
    return rows.filter(function (r) {
      if (!r.rankable) return false;
      if (isFinite(n) && n < (r.min_ml || 1)) return false;
      if (!vocab) return true;
      return _canDeclare(r.stat, vocab, c) || _isPresenceOnly(r.stat, vocab, c);
    });
  }

  /** One placement row by effect name, or null. */
  function placementFor(group, menu, effect, ctx) {
    var table = _placements(ctx);
    var groups = (table && table.groups) || {};
    var rows = (groups[group] && groups[group][menu]) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].effect === effect) return rows[i];
    }
    return null;
  }

  /** The magnitude a SOURCED placement has at this ML, or null.
   *
   *  Read from the wiki's own curve, never interpolated: `values_by_ml` is 36
   *  entries, one per ML, and an ML outside 1..36 has no row rather than a
   *  nearest one. */
  function sourcedValueAt(row, ml) {
    // #810 — keyed on `magnitude_sourced`, not on `sourced`. The two facts come
    // from different harvests: the wiki publishes a magnitude for far more
    // effects than it publishes a bonus type for, and requiring both before
    // using either made the player type 339 numbers the wiki states.
    if (!row || !row.magnitude_sourced || !Array.isArray(row.values_by_ml)) return null;
    var n = Number(ml);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > row.values_by_ml.length) return null;
    var v = Number(row.values_by_ml[n - 1]);
    return isFinite(v) ? v : null;
  }

  /** #800 — the combined prefixes offerable in one group's Prefix menu.
   *
   *  A combined prefix is ONE shard granting TWO effects into the single prefix
   *  slot. It is offered beside the ordinary prefixes and, if chosen, takes the
   *  slot instead of one.
   *
   *  Gated on the item's ML 20 floor, which is a THIRD ML gate: the Extra-slot
   *  rule gates a menu, the Insight rule gates an effect, and this gates the
   *  OPTION. A combined prefix is simply not craftable below 20. */
  function combinedOptions(group, ml, ctx) {
    var table = _placements(ctx);
    var c = table && table.combined;
    if (!c) return [];
    // `ml == null` means "do not filter by level" - `combinedFor` looks a recipe
    // up by name and has no level to apply. Written as an explicit null check
    // rather than leaning on Number(): `Number(null)` is 0, which read as an
    // ML-0 item and silently returned NOTHING for every lookup.
    if (ml != null && String(ml).trim() !== "") {
      var n = Number(ml);
      if (isFinite(n) && n < (c.min_ml || 20)) return [];
    }
    return (c.recipes || []).filter(function (r) {
      return r.groups.indexOf(group) >= 0;
    });
  }

  /** One combined recipe by name, for a group, or null. */
  function combinedFor(group, name, ctx) {
    var opts = combinedOptions(group, null, ctx);
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].name === name) return opts[i];
    }
    return null;
  }

  /** #799 — the bonuses Essence Crafting applies with the Minimum Level shard.
   *
   *  Deliberately NOT part of `entry.affixes`. That list is menu-keyed and capped
   *  at the menu count, and a test derives the cap FROM the menu list (#797); an
   *  automatic bonus is not an enchantment, occupies no menu, and would break both
   *  the cap and the meaning of the list. The player did not choose it, so it does
   *  not belong in the record of what they chose.
   *
   *  It is minted in `toVariant` instead, where the question is what the ITEM
   *  carries rather than what the player picked.
   *
   *  Returns `[]` for any group the wiki does not name — jewellery, clothing, and
   *  deliberately Orbs and Rune Arms.
   */
  function automaticAffixes(entry, ctx) {
    var e = entry || {};
    var table = _placements(ctx);
    var auto = table && table.automatic;
    var eb = auto && auto.enhancement_bonus;
    if (!eb) return [];
    var info = essenceGroupFor(e.slot, e.type, ctx);
    var stat = info.group && eb.groups[info.group];
    if (!stat) return [];
    var ml = Number(e.ml);
    if (!isFinite(ml) || Math.floor(ml) !== ml || ml < 1 || ml > eb.values_by_ml.length) return [];
    var v = Number(eb.values_by_ml[ml - 1]);
    if (!isFinite(v) || v <= 0) return [];
    return [{
      stat: stat, bonus_type: eb.bonus_type, value: v,
      automatic: true, sourced: true,
    }];
  }

  /** #799 — what this bench knows the game grants and cannot model, for the
   *  player to be told. Disclosure, not decoration: the form otherwise looks
   *  complete while granting nothing.
   *
   *  Filtered to the item at hand — telling a ring owner about a weapon dice
   *  multiplier is noise, and noise is how a real disclosure gets ignored. */
  function unmodelledAutomatic(entry, ctx) {
    var e = entry || {};
    var table = _placements(ctx);
    var rows = (table && table.automatic && table.automatic.unmodelled) || [];
    var info = essenceGroupFor(e.slot, e.type, ctx);
    var group = info.group;
    if (!group) return [];
    var isWeapon = group === "Melee weapons" || group === "Ranged weapons";
    var isShield = group === "Shields";
    return rows.filter(function (r) {
      if (r.row === "Weapon dice mult*") return isWeapon;
      return isWeapon || isShield;      // the implement bonus
    });
  }

  /** #815 — the tool's own label for a crafted item, derived from what is on it.
   *
   *  The bench stopped asking for a name: you do not name a crafted item, the
   *  game does. But the name cannot simply be dropped — #773 made it the
   *  `variant_id`, and that issue's own negative result records why an opaque id
   *  was wrong: this app treats `variant_id` as BOTH identity and display text,
   *  so an opaque one rendered the player's dagger as `custom:1` on the paperdoll
   *  and in all six exports.
   *
   *  So it is derived. THIS IS THE TOOL'S LABEL, NOT THE GAME'S. The wiki states
   *  no naming convention for crafted items — `Essence Crafting steps` was read
   *  for one — so this deliberately does not mimic one. It names the slot and
   *  what is on it, which is what a player needs to tell two of their own rings
   *  apart in a result list.
   *
   *  `taken` dedupes within one character's items, because two entries sharing a
   *  name would share an id and a pin on one would equip the other.
   */
  function deriveName(entry, ctx, taken) {
    var e = entry || {};
    var slot = String(e.slot || "").trim() || "item";
    // In MENU order, not the order they were added: an item is known by its
    // prefix first. Picking whichever row the player happened to fill in first
    // named a ring after its Mark slot.
    var lead = "";
    var rows = Array.isArray(e.affixes) ? e.affixes : [];
    for (var mi = 0; mi < MENUS.length && !lead; mi++) {
      for (const a of rows) {
        if (!a || a.menu !== MENUS[mi]) continue;
        // A combined shard HAS a printed name; a single one is known by its effect.
        var label = a.combined || a.effect || a.stat;
        if (label) { lead = String(label); break; }
      }
    }
    var base = (lead ? lead + " " + slot : "Essence Crafted " + slot).trim();
    if (!taken || !taken.size) return base;
    if (!taken.has(base)) return base;
    for (var n = 2; n < 100; n++) {
      var candidate = base + " " + n;
      if (!taken.has(candidate)) return candidate;
    }
    return base;
  }

  function isCustomId(id) {
    return typeof id === "string" && id.length > CUSTOM_SUFFIX.length
      && id.slice(-CUSTOM_SUFFIX.length) === CUSTOM_SUFFIX;
  }

  /** Is this variant player-authored? Reads the MARKER, never the id shape.
   *
   *  The two agree on everything this file mints, but the marker is what the
   *  disclosure surfaces key on, and a record that carried a `custom:` id without
   *  the marker would be the one case that must not slip through silently — it
   *  would solve, place, and export as if the catalog had vouched for it. */
  function isCustomVariant(v) {
    return !!(v && v.player_authored === true);
  }

  /** The pool identity for an entry, which is also its display name everywhere.
   *
   *  Takes the ENTRY, not a uid: the id is derived from the name, so a caller
   *  holding only a number cannot compute one, and a signature that let them
   *  would invite exactly the stale-id bug the rename migration exists to
   *  prevent. */
  function customId(entry) {
    var n = String((entry && entry.name) == null ? "" : entry.name).trim();
    return n ? n + CUSTOM_SUFFIX : "";
  }

  function _num(x) {
    if (typeof x === "number") return x;
    var s = String(x == null ? "" : x).trim();
    if (!s) return NaN;
    return Number(s);
  }

  /** May this stat carry a typed magnitude on a custom item?
   *
   *  The rule is `wizard.js`'s `canDeclareCredit`, and the caller INJECTS it
   *  (`ctx.canDeclare`) rather than this file reaching for it. wizard.js requires
   *  this module, so requiring wizard.js back would be a cycle whose Node-side
   *  symptom is a partially-populated exports object — a fallback that silently
   *  admits everything, in exactly the runtime the tests use.
   *
   *  The no-ctx path reads the same two vocabulary sets `canDeclareCredit` reads,
   *  so it is the same rule and not a second one. That claim is asserted rather
   *  than asserted-in-prose: `tests/custom-items.test.js` runs both over the real
   *  vocabulary and requires them to agree on every name. */
  function _canDeclare(stat, vocab, ctx) {
    if (ctx && typeof ctx.canDeclare === "function") return ctx.canDeclare(stat, vocab);
    var presence = vocab && vocab.presence;
    var magnitude = vocab && vocab.magnitude;
    var untyped = vocab && vocab.untypedOnly;
    // `presence.has(stat)` ALONE is the wrong test, and the reason is written up
    // in wizard.js's `isPresenceOnly`: it means "appears as Bool on at least one
    // item", and four stats are in it while carrying a real typed magnitude
    // elsewhere — Deception, Smoke Screen, Protection from Evil and Underwater
    // Action. Gating on presence alone would refuse a value on exactly those
    // four, which do have one. The `magnitude` clause is what the earlier version
    // of this fallback was missing, and the agreement test caught it.
    if (presence && typeof presence.has === "function" && presence.has(stat)
      && !(magnitude && typeof magnitude.has === "function" && magnitude.has(stat))) return false;
    if (untyped && typeof untyped.has === "function" && untyped.has(stat)) return false;
    return true;
  }

  /** Is this stat an ON/OFF effect — carried as a flag, with no magnitude?
   *
   *  Injected like `_canDeclare` above and for the same cycle reason, with the
   *  same fallback contract: it reads exactly the two vocabulary sets
   *  `wizard.js`'s `isPresenceOnly` reads, and `tests/custom-items.test.js`
   *  asserts the two agree over every name in the real vocabulary.
   *
   *  The distinction matters because it decides which of THREE outcomes a stat
   *  gets. A stat with a typed bucket takes a bonus type and a number. A
   *  presence-only stat takes neither and is minted as a `Bool`. A stat that is
   *  untyped-only — a real magnitude carried untyped on every source, as
   *  `Enhanced Ki` is — is refused: it is neither a flag nor a thing with a
   *  bucket to name, and guessing `Untyped` for it would key a bucket the gear
   *  cannot join. */
  function _isPresenceOnly(stat, vocab, ctx) {
    if (ctx && typeof ctx.isPresenceOnly === "function") return ctx.isPresenceOnly(stat, vocab);
    var presence = vocab && vocab.presence;
    var magnitude = vocab && vocab.magnitude;
    if (!presence || typeof presence.has !== "function" || !presence.has(stat)) return false;
    return !(magnitude && typeof magnitude.has === "function" && magnitude.has(stat));
  }

  /** Validate one player-entered item against the live vocabularies.
   *
   *  Returns `{ ok, errors: [sentence], entry }` — `entry` is the CLEANED copy
   *  (trimmed name, canonicalized stat names, numeric values), and is only
   *  meaningful when `ok`. Errors are whole sentences naming the field and the
   *  reason, because they are rendered next to the form and a player reading
   *  "invalid" learns nothing.
   *
   *  `ctx` is `{ vocab, catalogNames }`. `catalogNames` is a Set of the catalog's
   *  display names; a collision is REFUSED rather than allowed, because the
   *  results card, the browse link and all six exports identify an item by name,
   *  and two different items reading identically there is the honesty failure this
   *  whole feature is built to avoid. */
  /** #795 — carry a pre-refactor custom item into the placement model.
   *
   *  Saved entries from #773/#774 are free-form: `{stat, bonus_type, value}` with
   *  no menu and no effect, and nothing checked whether the stat could be crafted
   *  onto that item at all. Most will map; some cannot.
   *
   *  Three outcomes, and the UI must show all three, because each is a change to
   *  a build the player already saved:
   *
   *   - `placed`   — the stat is a real placement for this item's group, so it
   *                  keeps its value and gains the menu it must have belonged to.
   *   - `revalued` — it maps onto a SOURCED placement, so the wiki's own
   *                  magnitude at this ML replaces the number they typed. This is
   *                  the one that must never be silent: their build's total moves.
   *   - `dropped`  — no menu of this item's group can host it. Reported by name
   *                  rather than removed quietly; a vanished effect reads as the
   *                  tool losing their data.
   *
   *  A legacy affix already carrying a `menu` is left alone — re-migrating one
   *  would re-apply the sourced value and re-report a change that already
   *  happened. */
  function migrateLegacyEntry(entry, ctx) {
    var e = entry || {};
    var c = ctx || {};
    var out = { placed: [], revalued: [], dropped: [], entry: e };
    var list = Array.isArray(e.affixes) ? e.affixes : [];
    if (!list.length || list.every(function (a) { return a && a.menu; })) return out;

    var info = essenceGroupFor(e.slot, e.type, c);
    if (!info.group) {
      out.dropped = list.map(function (a) { return String((a && a.stat) || ""); }).filter(Boolean);
      out.entry = _assign({}, e, { affixes: [] });
      out.refused = info.refused;
      return out;
    }
    var ml = _num(e.ml);
    var menus = menusFor(info.group, ml, c);
    var used = Object.create(null);
    var next = [];
    for (const raw of list) {
      var a = raw || {};
      if (a.menu) { next.push(a); used[a.menu] = true; continue; }
      var stat = String(a.stat == null ? "" : a.stat).trim();
      if (!stat) continue;
      var hit = null;
      for (var i = 0; i < menus.length && !hit; i++) {
        if (used[menus[i]]) continue;
        var rows = effectsFor(info.group, menus[i], ml, c);
        for (var j = 0; j < rows.length; j++) {
          if (rows[j].stat === stat) { hit = { menu: menus[i], row: rows[j] }; break; }
        }
      }
      if (!hit) { out.dropped.push(stat); continue; }
      used[hit.menu] = true;
      if (hit.row.sourced) {
        var sv = sourcedValueAt(hit.row, ml);
        if (sv == null) { out.dropped.push(stat); continue; }
        if (Number(a.value) !== sv) {
          out.revalued.push({ stat: stat, from: _num(a.value), to: sv, menu: hit.menu });
        }
        next.push({ menu: hit.menu, effect: hit.row.effect, stat: stat,
                    bonus_type: hit.row.bonus_type, value: sv,
                    unit: hit.row.unit || "flat", sourced: true });
      } else {
        next.push(_assign({}, a, { menu: hit.menu, effect: hit.row.effect,
                                   stat: stat, sourced: false }));
      }
      out.placed.push({ stat: stat, menu: hit.menu, effect: hit.row.effect });
    }
    out.entry = _assign({}, e, { affixes: next });
    return out;
  }

  /** Object.assign, but this file targets the same baseline the rest of web/ does. */
  function _assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i] || {};
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  function validateEntry(entry, ctx) {
    var e = entry || {};
    var c = ctx || {};
    var vocab = c.vocab || { known: new Set(), canonical: function (s) { return s; } };
    var canonical = (typeof vocab.canonical === "function") ? vocab.canonical : function (s) { return s; };
    var errors = [];

    // #815 — a missing name is DERIVED, not refused. The bench no longer asks for
    // one; an entry saved before that still carries whatever the player typed, and
    // keeping it is what stops this rename stranding their pins.
    var name = String(e.name == null ? "" : e.name).trim();
    if (!name) name = deriveName(e, c, c.otherNames);
    if (name.length > NAME_MAX) errors.push("The name is longer than " + NAME_MAX + " characters.");
    else if (name.indexOf("(yours)") >= 0) {
      errors.push("Leave “(yours)” out of the name — it is added for you, so your item is marked "
        + "as your own everywhere it appears.");
    } else if (c.catalogNames && c.catalogNames.has(name)) {
      errors.push("“" + name + "” is already the name of an item in the catalog. "
        + "Pick a different one, so your build never shows two different items under one name.");
    } else if (c.otherNames && c.otherNames.has(name)) {
      // Two of the player's own items sharing a name would share an id, and a pin
      // on one would silently equip the other.
      errors.push("You already have an item of your own called “" + name + "”.");
    }

    var slot = String(e.slot == null ? "" : e.slot).trim();
    if (SLOTS.indexOf(slot) < 0) errors.push("Choose a slot the item is worn or wielded in.");

    var legalTypes = typesForSlot(slot);
    var type = String(e.type == null ? "" : e.type).trim();
    if (legalTypes) {
      if (!type) errors.push("Choose what kind of " + (slot === "Weapon" ? "weapon" : "off-hand item") + " it is — "
        + "the combat style, and whether it can go in your off hand, are decided by the type.");
      else if (legalTypes.indexOf(type) < 0) errors.push("“" + type + "” is not a type this build knows.");
    } else if (type) {
      // Not an error the player can see coming, so it is silently dropped rather
      // than refused: a worn slot has no `type` and carrying one would put an
      // unreadable field on the record.
      type = "";
    }

    var ml = _num(e.ml);
    if (!isFinite(ml) || Math.floor(ml) !== ml || ml < ML_MIN || ml > ML_MAX) {
      errors.push("Minimum level must be a whole number from " + ML_MIN + " to " + ML_MAX + ".");
    }

    var colors = [];
    for (const raw of (Array.isArray(e.augments) ? e.augments : [])) {
      var col = String(raw == null ? "" : raw).trim();
      if (!col) continue;
      if (COLORS.indexOf(col) < 0) { errors.push("“" + col + "” is not an augment slot colour."); continue; }
      colors.push(col);
    }

    var types = bonusTypes();
    var affixes = [];
    var rawAffixes = Array.isArray(e.affixes) ? e.affixes : [];

    // #795 — placement comes first. Every enchantment below is judged against the
    // group this item IS, so an effect that cannot be crafted onto this item type
    // is refused here rather than accepted and silently scored.
    var groupInfo = essenceGroupFor(slot, type, c);
    var group = groupInfo.group || null;
    if (groupInfo.refused && SLOTS.indexOf(slot) >= 0) errors.push(groupInfo.refused);

    var availableMenus = group ? menusFor(group, ml, c) : [];
    var seenMenus = Object.create(null);

    if (!rawAffixes.length) {
      errors.push("Add at least one enchantment — an item with no effects can never be worth a slot.");
    } else if (rawAffixes.length > AFFIX_MAX) {
      errors.push("An Essence Crafted item carries at most one enchantment per menu — "
        + MENUS.join(", ") + ".");
    }

    for (const raw of rawAffixes.slice(0, AFFIX_MAX)) {
      var a = raw || {};
      var menu = String(a.menu == null ? "" : a.menu).trim();
      var effect = String(a.effect == null ? "" : a.effect).trim();

      if (MENUS.indexOf(menu) < 0) {
        errors.push("Every enchantment needs a menu — " + MENUS.join(", ") + ".");
        continue;
      }
      if (seenMenus[menu]) {
        errors.push("Two enchantments are both in the " + menu + " menu. An item carries one each.");
        continue;
      }
      seenMenus[menu] = true;
      if (!group) continue;      // the slot/type error above already says why
      if (availableMenus.indexOf(menu) < 0) {
        if (menu === "Extra") {
          errors.push("The Extra menu is not available below minimum level "
            + ((_placements(c) || {}).extra_slot_min_ml || 10) + ".");
        } else {
          errors.push("A " + group.toLowerCase().replace(/s$/, "") + " has no " + menu + " menu.");
        }
        continue;
      }
      // #800 — the combined branch. `combined` is a SEPARATE field from `effect`,
      // not an overload of it: a recipe name and an effect name live in different
      // vocabularies, and although none collide today one recipe named after an
      // effect would make an overloaded field ambiguous forever.
      //
      // The pair is validated and emitted as ONE row carrying `parts`. Emitting
      // two rows would put two enchantments in one menu — which the duplicate
      // check above would then refuse on the next round-trip — and would make the
      // halves independently removable, the exact fan-out `container_registry`
      // refuses. They travel together or not at all.
      var combinedName = String(a.combined == null ? "" : a.combined).trim();
      if (combinedName) {
        if (menu !== MENUS[0]) {
          errors.push("A combined shard is a PREFIX; it cannot go in the " + menu + " menu.");
          continue;
        }
        var recipe = group && combinedFor(group, combinedName, c);
        if (!recipe) {
          errors.push("“" + combinedName + "” is not a combined prefix this item type can take.");
          continue;
        }
        var floor = ((_placements(c) || {}).combined || {}).min_ml || 20;
        if (isFinite(ml) && ml < floor) {
          errors.push("Combined shards need minimum level " + floor + ".");
          continue;
        }
        var parts = [], bad = false;
        for (var pi = 0; pi < recipe.effects.length; pi++) {
          var pe = recipe.effects[pi];
          var pstat = canonical(pe.stat);
          var supplied = (Array.isArray(a.parts) && a.parts[pi]) || {};
          if (!vocab.known || !vocab.known.has(pstat)) {
            errors.push("“" + pe.effect + "” resolves to “" + pstat + "”, which this build cannot rank.");
            bad = true; break;
          }
          if (_isPresenceOnly(pstat, vocab, c)) {
            parts.push({ effect: pe.effect, stat: pstat, presence: true });
            continue;
          }
          // #812 — a combined shard's halves scale with ML too: "Combined Shards
          // also use this scaling for their individual effects." Filled where the
          // existing join resolves the name; asked for where it does not, because
          // the recipe table names effects `table 1b` does not carry.
          var pval;
          if (pe.magnitude_sourced) {
            pval = sourcedValueAt(pe, ml);
            if (pval == null) {
              errors.push("“" + pe.effect + "” has no published magnitude at minimum level " + e.ml + ".");
              bad = true; break;
            }
          } else {
            pval = _num(supplied.value);
            if (!isFinite(pval) || pval <= 0) {
              errors.push("“" + pe.effect + "” needs a value above zero."); bad = true; break;
            }
            if (pval > VALUE_MAX) {
              errors.push("“" + pe.effect + "” is above the " + VALUE_MAX + " ceiling."); bad = true; break;
            }
          }
          var pbt = String(supplied.bonus_type == null ? "" : supplied.bonus_type).trim();
          if (types.length && types.indexOf(pbt) < 0) {
            errors.push("“" + pe.effect + "” needs the bonus type your item shows \u2014 the crafting table does not publish this one.");
            bad = true; break;
          }
          parts.push({ effect: pe.effect, stat: pstat, bonus_type: pbt, value: pval,
                       magnitude_sourced: !!pe.magnitude_sourced });
        }
        if (bad) continue;
        affixes.push({ menu: menu, combined: recipe.name, parts: parts, sourced: false });
        continue;
      }

      if (!effect) { errors.push("Choose an enchantment for the " + menu + " menu."); continue; }

      var row = placementFor(group, menu, effect, c);
      if (!row) {
        errors.push("“" + effect + "” cannot be crafted into the " + menu + " menu of a "
          + group.toLowerCase().replace(/s$/, "") + ".");
        continue;
      }
      if (!row.rankable) {
        errors.push("“" + effect + "” is not a stat this build can rank, so nothing could score it.");
        continue;
      }
      if (isFinite(ml) && ml < (row.min_ml || 1)) {
        errors.push("“" + effect + "” needs minimum level " + row.min_ml
          + " — insight bonuses cannot be crafted below that.");
        continue;
      }

      var stat = canonical(row.stat);
      if (!vocab.known || !vocab.known.has(stat)) {
        errors.push("“" + effect + "” resolves to “" + stat + "”, which is not a stat this build knows.");
        continue;
      }

      // #774's on/off branch, unchanged in meaning: a presence-only stat is a FLAG
      // with no typed bucket, so it takes neither a bonus type nor a number.
      if (_isPresenceOnly(stat, vocab, c)) {
        affixes.push({ menu: menu, effect: effect, stat: stat, presence: true, sourced: !!row.sourced });
        continue;
      }
      if (!_canDeclare(stat, vocab, c)) {
        errors.push("“" + effect + "” carries no bonus type anywhere in the game data, so there is "
          + "no stacking bucket for a value on it to join.");
        continue;
      }

      // #795/#810 — the two halves are filled INDEPENDENTLY. Whatever the wiki
      // publishes is taken from it and locked; whatever it does not is asked of
      // the player and disclosed as theirs. Anything the entry carries for a
      // filled half is ignored rather than refused: it is stale UI state, not a
      // request, because the form stops offering that control.
      var bt, val;

      if (row.magnitude_sourced) {
        val = sourcedValueAt(row, ml);
        if (val == null) {
          errors.push("“" + effect + "” has no published magnitude at minimum level " + e.ml + ".");
          continue;
        }
      } else {
        val = _num(a.value);
        if (!isFinite(val) || val <= 0) { errors.push("“" + effect + "” needs a value above zero."); continue; }
        if (val > VALUE_MAX) { errors.push("“" + effect + "” is above the " + VALUE_MAX + " ceiling."); continue; }
      }

      if (row.type_sourced) {
        bt = row.bonus_type;
      } else {
        bt = String(a.bonus_type == null ? "" : a.bonus_type).trim();
        if (types.length && types.indexOf(bt) < 0) {
          errors.push("“" + effect + "” needs the bonus type your item shows. The crafting "
            + "table does not publish it for this enchantment, and it is what decides whether the "
            + "effect stacks with your other gear or is overwritten by it.");
          continue;
        }
      }

      affixes.push({ menu: menu, effect: effect, stat: stat, bonus_type: bt, value: val,
                     unit: row.unit || "flat",
                     magnitude_sourced: !!row.magnitude_sourced,
                     type_sourced: !!row.type_sourced,
                     sourced: !!(row.magnitude_sourced && row.type_sourced) });
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      entry: {
        uid: e.uid, name: name, slot: slot, type: type,
        ml: isFinite(ml) ? ml : null, augments: colors, affixes: affixes,
      },
    };
  }

  /** Mint the catalog-shaped record the rest of the app reads.
   *
   *  Every field the pipeline stamps is written explicitly, including the ones
   *  that are empty. An ABSENT field and an empty one are not the same to several
   *  readers — `augment_slots_norm` absent throws in the capacity walk, a missing
   *  `parsed_set_bonuses` reads as "not yet parsed" rather than "belongs to no
   *  set" — and a record assembled by spreading a catalog item would inherit
   *  whatever that item happened to carry. */
  function toVariant(entry, ctx) {
    var e = entry || {};
    var id = customId(e);
    var colors = Array.isArray(e.augments) ? e.augments.slice() : [];
    var ml = Number(e.ml) || 1;
    return {
      // BOTH carry the suffixed name, deliberately. Different readers reach for
      // different fields — `variant_id` on the paperdoll and in the exports,
      // `source_item || variant_id` in the pin list and the owned-gear match —
      // and a record that answered one with the provenance and the other without
      // it would show "(yours)" on some surfaces and not others. The player's
      // clean name is kept on the ENTRY, which is what the panel edits.
      source_item: id,
      variant_id: id,
      tier_label: null,
      // Read off the catalog rather than reasoned about: all 3,316 records in
      // slot `Weapon` are category `weapon`, and all 592 in slot `Off Hand` —
      // shields, orbs and rune arms — are category `item`. A second dagger for
      // the off hand is slot `Weapon` too; which HAND it goes in is a pin, not a
      // property of the record (see `pinWornSlotOf`).
      category: e.slot === "Weapon" ? "weapon" : "item",
      slot: e.slot,
      minimum_level: ml,
      ml: ml,
      type: e.type || null,
      crafting: [],
      sets: [],
      artifact: false,
      binding: null,
      location_quest: null,
      location_pack: null,
      location_kind: "unknown",
      wiki_url: null,
      augment_slots: colors.slice(),
      augment_slots_norm: { colors: colors.slice(), quarantined: [] },
      set_bonus: [],
      parsed_set_bonuses: [],
      // #774 — an on/off effect is minted as `Bool` with value 1, which is
      // exactly how the catalog carries `Ghost Touch` and its peers. Nothing
      // downstream needs to know it came from a player: the bucket machinery,
      // the Utility tier's indicator and its receipt all read the same shape.
      // #799 — the player's chosen enchantments, PLUS what the Minimum Level
      // shard applies on its own. The second list is derived from the item's
      // group and ML, never stored on the entry, so it cannot drift out of date
      // when the player edits the level.
      // #800 — a combined row expands to its two effects HERE, at the point the
      // record is minted, so the entry keeps one row per menu and the item
      // carries what it actually grants.
      affixes: (Array.isArray(e.affixes) ? e.affixes : []).reduce(function (out, a) {
        var list = (a && Array.isArray(a.parts)) ? a.parts : [a];
        list.forEach(function (x) {
          out.push(x && x.presence
            ? { name: x.stat, type: "Bool", value: "1", eligible: true }
            : { name: x.stat, type: x.bonus_type, value: String(x.value), eligible: true });
        });
        return out;
      }, []).concat(automaticAffixes(e, ctx).map(function (a) {
        return { name: a.stat, type: a.bonus_type, value: String(a.value), eligible: true };
      })),
      eligible_affix_count: (Array.isArray(e.affixes) ? e.affixes : []).reduce(
          function (n, a) { return n + ((a && Array.isArray(a.parts)) ? a.parts.length : 1); }, 0)
        + automaticAffixes(e, ctx).length,
      scaling: [],
      roll_groups: [],
      flagged: [],
      armor_type: null,
      material: null,
      tier_values_incomplete: false,
      tier_ml_list: null,
      nearly_complete: null,
      nc_tier: null,
      lamordia_slots: null,
      seal_slots: null,
      lost_purpose: null,
      legendary_green_steel_tiers: null,
      slavers_slots: null,
      slavers_set_bonus: null,
      essence_slots: null,
      // See the file header: this is the solver's eligibility gate, not a claim
      // about sourcing. `player_authored` is the claim, and it is the opposite one.
      verification: "verified",
      verification_reasons: [],
      // The item is in the player's hands by construction, so it is never part of
      // the "no drop source recorded" triage population and never farmable.
      no_drop_source: false,
      player_authored: true,
    };
  }

  /** The solve-ready pool for a character's saved list.
   *
   *  Entries that no longer validate are SEPARATED, never dropped: a build saved
   *  against an older vocabulary can carry a stat name this build retired, and
   *  silently solving without an item the player can still see in their list is
   *  the failure mode every other list in this app (blocklist, set pins, augment
   *  pins) is explicitly written to avoid. The caller reports `rejected`. */
  function customPool(list, ctx) {
    var out = [];
    var rejected = [];
    var migrated = [];
    var D = _dataset();
    var taken = new Set();
    for (const raw of (Array.isArray(list) ? list : []).slice(0, CUSTOM_LIMIT)) {
      // `otherNames` accumulates as we go, so the FIRST entry with a name keeps
      // it and a later duplicate is the one reported. Deterministic, and it
      // matches what the panel shows: the duplicate is the row just added.
      // #795 — a saved item from before the placement model reaches the solver
      // here without anyone opening the editor. Migrate it on the way through, or
      // every pre-refactor custom item would be rejected on load and the player's
      // build would silently lose gear it had been solving with for days.
      //
      // The migration is applied to a COPY: `state.customItems` keeps the saved
      // shape until the player opens and saves the item, so nothing is rewritten
      // under them by the act of solving.
      var mig = migrateLegacyEntry(raw, ctx || {});
      var v = validateEntry(mig.entry || raw, Object.assign({}, ctx || {}, { otherNames: taken }));
      if (!v.ok) { rejected.push({ entry: raw, errors: v.errors }); continue; }
      if ((mig.dropped || []).length || (mig.revalued || []).length) {
        migrated.push({ entry: raw, dropped: mig.dropped, revalued: mig.revalued });
      }
      taken.add(v.entry.name);
      var rec = toVariant(v.entry, ctx);
      // The same normalizer the fetched catalog goes through, for the same
      // reason: it parses affix values into numbers, attaches units, and expands
      // the composite affixes the bucket model depends on. A record that skipped
      // it would be a subtly different shape from every other variant in the pool
      // — and normalizeItem is idempotent, so running it here is safe.
      if (D && D.normalizeItem) D.normalizeItem(rec);
      out.push(rec);
    }
    return { variants: out, rejected: rejected, migrated: migrated };
  }

  /** The unconditional disclosure sentence, or null when the build uses none.
   *
   *  Takes the CHOSEN loadout rather than the declared list on purpose: a custom
   *  item the player defined but the solver did not pick has not influenced the
   *  answer, and saying it did would be its own inaccuracy. */
  function playerAuthoredNotice(chosen) {
    var names = [];
    var seen = Object.create(null);
    for (const c of (Array.isArray(chosen) ? chosen : [])) {
      var v = (c && c.variant) || c;
      if (!isCustomVariant(v)) continue;
      var nm = v.source_item || v.variant_id;
      if (seen[nm]) continue;
      seen[nm] = 1;
      names.push(nm);
    }
    if (!names.length) return null;
    var many = names.length > 1;
    return "This build uses " + names.length + " item" + (many ? "s" : "") + " you entered yourself: "
      + names.map(function (n) { return "“" + n + "”"; }).join(", ") + ". "
      + (many ? "Their numbers are" : "Its numbers are") + " your own, not wiki-sourced, so the result is "
      + "only as right as what you typed. Everything else in this loadout is sourced as usual.";
  }

  var api = {
    CUSTOM_SUFFIX: CUSTOM_SUFFIX, CUSTOM_LIMIT: CUSTOM_LIMIT,
    NAME_MAX: NAME_MAX, ML_MIN: ML_MIN, ML_MAX: ML_MAX, VALUE_MAX: VALUE_MAX, AFFIX_MAX: AFFIX_MAX,
    customSlots: customSlots, augmentColors: augmentColors, typesForSlot: typesForSlot,
    bonusTypes: bonusTypes,
    customId: customId, isCustomId: isCustomId, isCustomVariant: isCustomVariant,
    isPresenceEffect: function (stat, vocab, ctx) { return _isPresenceOnly(stat, vocab, ctx); },
    MENUS: MENUS.slice(), menuLabel: menuLabel, deriveName: deriveName,
    weaponSplit: function (ctx) { return _weaponSplit(ctx); },
    essenceGroupFor: essenceGroupFor, menusFor: menusFor, effectsFor: effectsFor,
    automaticAffixes: automaticAffixes, unmodelledAutomatic: unmodelledAutomatic,
    combinedOptions: combinedOptions, combinedFor: combinedFor,
    placementFor: placementFor, sourcedValueAt: sourcedValueAt,
    migrateLegacyEntry: migrateLegacyEntry,
    validateEntry: validateEntry, toVariant: toVariant, customPool: customPool,
    playerAuthoredNotice: playerAuthoredNotice,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.CustomItems = api;
})();
