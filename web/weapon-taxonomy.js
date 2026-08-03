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
//   - ranged    : Bows only. Both hands occupied, so NO off-hand item.
//   - crossbow  : ALL crossbows (light/heavy/great/repeating). Per the DDO wiki a
//                 rune arm "can be wielded with one-handed weapons and all crossbows",
//                 so the off-hand may hold a RUNE ARM (only) — the artificer style.
//   - unarmed   : Handwraps. An off-hand orb/rune arm is allowed; no second weapon.
(function () {
  "use strict";

  const ONE = "one-hand", THF = "thf", RANGED = "ranged", CROSSBOW = "crossbow", UNARMED = "unarmed",
    SB = "sword-board";

  const STYLES = [
    { id: ONE, label: "One-hand / Dual-wield" },
    { id: SB, label: "Sword & Board" },
    { id: THF, label: "Two Handed Fighting" },
    { id: RANGED, label: "Bow" },
    { id: CROSSBOW, label: "Crossbow + Rune Arm" },
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
    // Ranged (DDO) — bows use both hands (no off-hand)
    "Long Bows": RANGED, "Short Bows": RANGED,
    // Crossbows — per the wiki a rune arm pairs with ALL crossbows (artificer style)
    "Great Crossbows": CROSSBOW, "Heavy Crossbows": CROSSBOW, "Light Crossbows": CROSSBOW,
    "Repeating Heavy Crossbows": CROSSBOW, "Repeating Light Crossbows": CROSSBOW,
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
    // Sword & Board wields a one-handed weapon in the main hand, so it draws from the
    // one-hand bucket for main-hand weapon types (the shield lives in the off hand).
    const bucketStyle = style === SB ? ONE : style;
    const all = Object.keys(STYLE_OF_TYPE).filter((t) => STYLE_OF_TYPE[t] === bucketStyle);
    const list = datasetTypes ? all.filter((t) => datasetTypes.includes(t)) : all;
    return list.sort();
  }

  /** An off-hand ITEM is possible for one-hand, unarmed, and crossbow styles;
   *  two-handed (THF) and bows (ranged) occupy both hands. */
  function offHandEnabledForStyle(style) {
    return style === ONE || style === UNARMED || style === CROSSBOW || style === SB;
  }

  /** The off-hand item types a style permits, or null for "any". A crossbow can
   *  only take a rune arm (per the DDO wiki) — no shield/orb. one-hand/unarmed are
   *  unrestricted (the player's own picks constrain). */
  function offHandTypesForStyle(style) {
    if (style === CROSSBOW) return ["Rune Arms"];
    // Sword & Board = one-handed weapon + a SHIELD. Orbs and rune arms aren't "board",
    // so the off hand is restricted to the four shield types (R5). A dataset off-hand
    // item with an unstamped/unknown type stays eligible (fail-open) since it isn't a
    // positively-identified non-shield.
    if (style === SB) return ["Bucklers", "Small shields", "Large shields", "Tower shields"];
    return null;
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
    styleOfType, weaponTypesForStyle, offHandEnabledForStyle, offHandTypesForStyle,
    twfWeaponAllowedForStyle, offHandWeaponTypes, orphanWeaponTypes,
    ONE_HAND: ONE, THF, RANGED, CROSSBOW, UNARMED,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.WeaponTaxonomy = api;
})();
