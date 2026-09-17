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
  var AFFIX_MAX = 12;

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
  function validateEntry(entry, ctx) {
    var e = entry || {};
    var c = ctx || {};
    var vocab = c.vocab || { known: new Set(), canonical: function (s) { return s; } };
    var canonical = (typeof vocab.canonical === "function") ? vocab.canonical : function (s) { return s; };
    var errors = [];

    var name = String(e.name == null ? "" : e.name).trim();
    if (!name) errors.push("Give the item a name — it is how the build, the pin list and every export refer to it.");
    else if (name.length > NAME_MAX) errors.push("The name is longer than " + NAME_MAX + " characters.");
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
    if (!rawAffixes.length) {
      errors.push("Add at least one effect — an item with no effects can never be worth a slot.");
    } else if (rawAffixes.length > AFFIX_MAX) {
      errors.push("An item may carry at most " + AFFIX_MAX + " effects.");
    }
    for (const raw of rawAffixes.slice(0, AFFIX_MAX)) {
      var a = raw || {};
      var stat = canonical(String(a.stat == null ? "" : a.stat).trim());
      var bt = String(a.bonus_type == null ? "" : a.bonus_type).trim();
      var val = _num(a.value);
      if (!stat) { errors.push("Every effect needs a stat."); continue; }
      if (!vocab.known || !vocab.known.has(stat)) {
        errors.push("“" + stat + "” is not a stat this build knows, so nothing could ever rank it. "
          + "Pick the name from the list.");
        continue;
      }
      // #774 — the on/off branch. A presence-only effect (Ghost Touch, True
      // Seeing, Freedom of Movement) is a FLAG: it has no typed bucket, so it
      // takes no bonus type and no number, and `toVariant` mints it as a `Bool`
      // exactly as the catalog carries it. It then counts for the Utility tier
      // through the ordinary bucket machinery, with no special case anywhere —
      // and because a custom item's name carries the `(yours)` suffix, the
      // tier's own receipt already credits it as the player's. Both facts were
      // measured through the real solver before this branch was written; see
      // tests/custom-items-solve.test.js.
      //
      // The player's typed bonus type and value are DROPPED rather than refused:
      // the form stops offering them once it knows the stat is on/off, so a
      // leftover value is stale UI state rather than something they asked for.
      if (_isPresenceOnly(stat, vocab, c)) {
        affixes.push({ stat: stat, presence: true });
        continue;
      }
      // Neither a flag nor a typed magnitude: a real number carried untyped on
      // every source (`Enhanced Ki`). There is no bonus type to pick and no
      // bucket the gear would join, so it is refused by name rather than guessed.
      if (!_canDeclare(stat, vocab, c)) {
        errors.push("“" + stat + "” carries no bonus type anywhere in the game data, so there is no "
          + "stacking bucket for a value on it to join. Custom items cannot supply it.");
        continue;
      }
      if (types.length && types.indexOf(bt) < 0) {
        errors.push("“" + stat + "” needs a bonus type from the list — that is what decides whether it "
          + "stacks with your other gear or is overwritten by it.");
        continue;
      }
      if (!isFinite(val) || val <= 0) { errors.push("“" + stat + "” needs a value above zero."); continue; }
      if (val > VALUE_MAX) { errors.push("“" + stat + "” is above the " + VALUE_MAX + " ceiling."); continue; }
      affixes.push({ stat: stat, bonus_type: bt, value: val });
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
  function toVariant(entry) {
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
      affixes: (Array.isArray(e.affixes) ? e.affixes : []).map(function (a) {
        return a && a.presence
          ? { name: a.stat, type: "Bool", value: "1", eligible: true }
          : { name: a.stat, type: a.bonus_type, value: String(a.value), eligible: true };
      }),
      eligible_affix_count: (Array.isArray(e.affixes) ? e.affixes.length : 0),
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
    var D = _dataset();
    var taken = new Set();
    for (const raw of (Array.isArray(list) ? list : []).slice(0, CUSTOM_LIMIT)) {
      // `otherNames` accumulates as we go, so the FIRST entry with a name keeps
      // it and a later duplicate is the one reported. Deterministic, and it
      // matches what the panel shows: the duplicate is the row just added.
      var v = validateEntry(raw, Object.assign({}, ctx || {}, { otherNames: taken }));
      if (!v.ok) { rejected.push({ entry: raw, errors: v.errors }); continue; }
      taken.add(v.entry.name);
      var rec = toVariant(v.entry);
      // The same normalizer the fetched catalog goes through, for the same
      // reason: it parses affix values into numbers, attaches units, and expands
      // the composite affixes the bucket model depends on. A record that skipped
      // it would be a subtly different shape from every other variant in the pool
      // — and normalizeItem is idempotent, so running it here is safe.
      if (D && D.normalizeItem) D.normalizeItem(rec);
      out.push(rec);
    }
    return { variants: out, rejected: rejected };
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
    validateEntry: validateEntry, toVariant: toVariant, customPool: customPool,
    playerAuthoredNotice: playerAuthoredNotice,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.CustomItems = api;
})();
