// U1 — weapon/off-hand taxonomy: the single source for combat-style handedness
// and the off-hand type list. Consumed by the wizard (to render the
// handedness-gated picker) and the solver (to constrain Main Hand / Off Hand
// eligibility). Pure, dual-exported for Node tests. Namespaced global
// `WeaponTaxonomy`.
//
// KTD1 — the map is keyed by the exact dataset `type` strings (slot "Weapon").
// Ranged (bows/crossbows) buckets under two-hand: a bow/crossbow occupies both
// hands, so no off-hand item is possible (the Quiver is a separate worn slot,
// unaffected). Thrown weapons bucket under one-hand (an off-hand stays free).
// Bastard Swords and Dwarven War Axes are feat-dependent two-hand-capable but
// one-handed with proficiency, so they keep the off-hand available -> one-hand.
// Handwraps are the unarmed case.
(function () {
  "use strict";

  const ONE = "one-hand", TWO = "two-hand", UNARMED = "unarmed";

  const STYLES = [
    { id: ONE, label: "One-hand" },
    { id: TWO, label: "Two-hand" },
    { id: UNARMED, label: "Unarmed" },
  ];

  // type string -> combat style. All 40 dataset weapon types.
  const STYLE_OF_TYPE = {
    // one-hand melee
    "Battle Axes": ONE, "Clubs": ONE, "Daggers": ONE, "Hand Axes": ONE,
    "Heavy Maces": ONE, "Heavy Picks": ONE, "Kamas": ONE, "Khopeshes": ONE,
    "Kukris": ONE, "Light Hammers": ONE, "Light Maces": ONE, "Light Picks": ONE,
    "Long Swords": ONE, "Morningstars": ONE, "Rapiers": ONE, "Scimitars": ONE,
    "Short Swords": ONE, "Sickles": ONE, "War Hammers": ONE,
    // thrown (one-handed, off-hand stays available)
    "Darts": ONE, "Shurikens": ONE, "Throwing Axes": ONE, "Throwing Daggers": ONE,
    "Throwing Hammers": ONE,
    // feat-dependent one-handed (Bastard Sword / Dwarven Axe proficiency)
    "Bastard Swords": ONE, "Dwarven War Axes": ONE,
    // two-hand melee
    "Falchions": TWO, "Great Axes": TWO, "Great Clubs": TWO, "Great Swords": TWO,
    "Mauls": TWO, "Quarterstaffs": TWO,
    // ranged (two-handed for off-hand purposes)
    "Long Bows": TWO, "Short Bows": TWO, "Great Crossbows": TWO,
    "Heavy Crossbows": TWO, "Light Crossbows": TWO,
    "Repeating Heavy Crossbows": TWO, "Repeating Light Crossbows": TWO,
    // unarmed
    "Handwraps": UNARMED,
  };

  // Canonical off-hand item types (dataset `type` strings for slot "Off Hand").
  const OFF_HAND_TYPES = [
    "Orbs", "Rune Arms", "Bucklers", "Small shields", "Large shields", "Tower shields",
  ];
  // The explicit "no off-hand item" option (B4/KTD4). Not a dataset type.
  const OFF_HAND_EMPTY = "empty";

  /** The combat style of one weapon type, or undefined for an unknown type. */
  function styleOfType(type) {
    return STYLE_OF_TYPE[type];
  }

  /** Weapon types for a style. When `datasetTypes` is supplied (KTD6), return the
   *  intersection with what the dataset actually carries — so a chip list never
   *  offers a type the dataset lacks, and drift is observable. Sorted. */
  function weaponTypesForStyle(style, datasetTypes) {
    const all = Object.keys(STYLE_OF_TYPE).filter((t) => STYLE_OF_TYPE[t] === style);
    const list = datasetTypes ? all.filter((t) => datasetTypes.includes(t)) : all;
    return list.sort();
  }

  /** Off-hand items are possible for every style except two-hand (B5). An unset
   *  style is permissive (off-hand allowed). */
  function offHandEnabledForStyle(style) {
    return style !== TWO;
  }

  /** Dataset weapon types that carry no style assignment (KTD6 drift detector). */
  function orphanWeaponTypes(datasetTypes) {
    return (datasetTypes || []).filter((t) => STYLE_OF_TYPE[t] == null);
  }

  const api = {
    STYLES, STYLE_OF_TYPE, OFF_HAND_TYPES, OFF_HAND_EMPTY,
    styleOfType, weaponTypesForStyle, offHandEnabledForStyle, orphanWeaponTypes,
    ONE_HAND: ONE, TWO_HAND: TWO, UNARMED,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.WeaponTaxonomy = api;
})();
