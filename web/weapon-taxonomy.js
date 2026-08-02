// U1 — weapon/off-hand taxonomy: the single source for combat-style handedness
// and the off-hand type list. Consumed by the wizard (to render the picker) and
// the solver (to constrain Main Hand / Off Hand eligibility). Pure, dual-exported
// for Node tests. Namespaced global `WeaponTaxonomy`.
//
// Handedness is the DDO-authoritative "by handedness (aka size)" taxonomy from the
// DDO wiki (Category:Basic weapons by handedness), collapsed into the four fighting
// styles the picker offers:
//   - one-hand  : One-handed + Light + Thrown (all wield in one hand -> an off-hand
//                 is allowed: a shield/orb/rune arm, OR a second weapon for TWF).
//   - thf       : Two Handed Fighting — two-handed melee. No off-hand.
//   - ranged    : Bows + ALL crossbows (light/heavy included). Both hands occupied,
//                 so NO off-hand item (a crossbow + shield is an illegal loadout).
//   - unarmed   : Handwraps. An off-hand orb/rune arm is allowed; no second weapon.
(function () {
  "use strict";

  const ONE = "one-hand", THF = "thf", RANGED = "ranged", UNARMED = "unarmed";

  const STYLES = [
    { id: ONE, label: "One-hand / Dual-wield" },
    { id: THF, label: "Two Handed Fighting" },
    { id: RANGED, label: "Ranged" },
    { id: UNARMED, label: "Unarmed" },
  ];

  // type string -> combat style. All 40 dataset weapon types, keyed to the DDO
  // wiki handedness categories (One-handed + Light + Thrown -> one-hand).
  const STYLE_OF_TYPE = {
    // One-handed (DDO) — wield in one hand
    "Bastard Swords": ONE, "Battle Axes": ONE, "Clubs": ONE, "Dwarven War Axes": ONE,
    "Heavy Maces": ONE, "Heavy Picks": ONE, "Khopeshes": ONE, "Long Swords": ONE,
    "Morningstars": ONE, "War Hammers": ONE,
    // Light (DDO) — also one-handed
    "Daggers": ONE, "Hand Axes": ONE, "Kamas": ONE, "Kukris": ONE, "Light Hammers": ONE,
    "Light Maces": ONE, "Light Picks": ONE, "Rapiers": ONE, "Scimitars": ONE,
    "Short Swords": ONE, "Sickles": ONE,
    // Thrown (DDO) — one-handed thrown
    "Darts": ONE, "Shurikens": ONE, "Throwing Axes": ONE, "Throwing Daggers": ONE,
    "Throwing Hammers": ONE,
    // Two-handed melee (DDO)
    "Falchions": THF, "Great Axes": THF, "Great Clubs": THF, "Great Swords": THF,
    "Mauls": THF, "Quarterstaffs": THF,
    // Ranged (DDO) — bows + ALL crossbows
    "Long Bows": RANGED, "Short Bows": RANGED, "Great Crossbows": RANGED,
    "Heavy Crossbows": RANGED, "Light Crossbows": RANGED,
    "Repeating Heavy Crossbows": RANGED, "Repeating Light Crossbows": RANGED,
    // Unarmed
    "Handwraps": UNARMED,
  };

  // Canonical off-hand item types (dataset `type` strings for slot "Off Hand").
  const OFF_HAND_TYPES = [
    "Orbs", "Rune Arms", "Bucklers", "Small shields", "Large shields", "Tower shields",
  ];
  // The explicit "no off-hand item" option. Not a dataset type.
  const OFF_HAND_EMPTY = "empty";

  /** The combat style of one weapon type, or undefined for an unknown type. */
  function styleOfType(type) {
    return STYLE_OF_TYPE[type];
  }

  /** Weapon types for a style. When `datasetTypes` is supplied, return the
   *  intersection with what the dataset actually carries (never offer a type the
   *  dataset lacks; drift is observable). Sorted. */
  function weaponTypesForStyle(style, datasetTypes) {
    const all = Object.keys(STYLE_OF_TYPE).filter((t) => STYLE_OF_TYPE[t] === style);
    const list = datasetTypes ? all.filter((t) => datasetTypes.includes(t)) : all;
    return list.sort();
  }

  /** An off-hand ITEM (shield/orb/rune arm/empty) is possible for one-hand and
   *  unarmed styles; two-handed and ranged occupy both hands. */
  function offHandEnabledForStyle(style) {
    return style === ONE || style === UNARMED;
  }

  /** A second WEAPON in the off-hand (two-weapon fighting) is possible only in the
   *  one-hand style (both weapons must be one-handed). */
  function twfWeaponAllowedForStyle(style) {
    return style === ONE;
  }

  /** Weapon types eligible as a TWF off-hand weapon — every one-handed type (the
   *  one-hand style bucket), intersected with the dataset when supplied. */
  function offHandWeaponTypes(datasetTypes) {
    return weaponTypesForStyle(ONE, datasetTypes);
  }

  /** Dataset weapon types that carry no style assignment (drift detector). */
  function orphanWeaponTypes(datasetTypes) {
    return (datasetTypes || []).filter((t) => STYLE_OF_TYPE[t] == null);
  }

  const api = {
    STYLES, STYLE_OF_TYPE, OFF_HAND_TYPES, OFF_HAND_EMPTY,
    styleOfType, weaponTypesForStyle, offHandEnabledForStyle,
    twfWeaponAllowedForStyle, offHandWeaponTypes, orphanWeaponTypes,
    ONE_HAND: ONE, THF, RANGED, UNARMED,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.WeaponTaxonomy = api;
})();
