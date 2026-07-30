// Centralized crafting-system metadata registry (U1). One source of truth for
// each DDO crafting system's player-facing labels, so the renderer derives
// instructions from metadata instead of hardcoded strings. "Awaken" is correct
// ONLY for Vecna Unleashed Lost Purpose — every other system uses its own
// terminology. Pure data + accessors, no solver contact. Dual-exported;
// namespaced global `CraftingSystems`.
(function () {
  "use strict";

  // action_label templates use {set_name}, {slot_type}, {effect} placeholders the
  // renderer fills. slot_types lists the valid slot names where a system has them.
  const SYSTEMS = {
    "nearly-finished": {
      system_id: "nearly-finished", system_name: "Nearly Finished",
      expansion: "Masterminds of Sharn", mechanism_kind: "selectable_affix",
      action_label: "Apply Nearly Finished option: {effect}",
      result_label: "Selected Nearly Finished option",
      slot_type: null, station_name: "Cannith Reforging Station",
    },
    "vecna-lost-purpose": {
      system_id: "vecna-lost-purpose", system_name: "Lost Purpose",
      expansion: "Vecna Unleashed", mechanism_kind: "selectable_set_membership",
      action_label: "Awaken Set Bonus: {set_name}",
      result_label: "Awakened Set Bonus",
      slot_type: null, station_name: "Cannith Repurposing Station",
    },
    "isle-of-dread-set-bonus": {
      system_id: "isle-of-dread-set-bonus", system_name: "Dinosaur Bone Set Bonus",
      expansion: "Isle of Dread", mechanism_kind: "set_bonus_augment_assignment",
      action_label: "Slot Set Bonus augment: {set_name}",
      result_label: "Dinosaur Bone Set Bonus augment",
      slot_type: "Set Bonus", station_name: "Dinosaur Bone crafting",
    },
    "isle-of-dread-augment": {
      system_id: "isle-of-dread-augment", system_name: "Dinosaur Bone augment",
      expansion: "Isle of Dread", mechanism_kind: "augment_assignment",
      action_label: "Slot {slot_type} augment: {effect}",
      result_label: "Dinosaur Bone augment",
      slot_types: ["Scale", "Fang", "Claw", "Horn"], station_name: "Dinosaur Bone crafting",
    },
    "viktranium": {
      system_id: "viktranium", system_name: "Viktranium Experiment",
      expansion: "The Chill of Ravenloft", mechanism_kind: "augment_assignment",
      action_label: "Slot {slot_type} Viktranium augment: {effect}",
      result_label: "Viktranium crafting option",
      slot_types: ["Melancholic", "Dolorous", "Miserable", "Woeful"],
      station_name: "Viktranium Experiment",
    },
    "sun-moon": {
      system_id: "sun-moon", system_name: "Sun and Moon Augments",
      expansion: "Magic of Myth Drannor", mechanism_kind: "augment_assignment",
      action_label: "Slot {slot_type} Augment: {effect}",
      result_label: "Sun/Moon augment",
      slot_types: ["Sun", "Moon"], station_name: null,
    },
    "nearly-completed": {
      system_id: "nearly-completed", system_name: "Nearly Completed",
      expansion: "Terror of Demogorgon", mechanism_kind: "selectable_affix",
      action_label: "Apply Nearly Completed option: {effect}",
      result_label: "Completed with: {effect}",
      slot_type: null, station_name: null,
    },
    "catalyst": {
      system_id: "catalyst", system_name: "Catalyst Crafting",
      expansion: "Terror of Demogorgon", mechanism_kind: "item_transformation",
      action_label: "Catalyst Crafting: Create Catalyst version: {result_item}",
      result_label: "Catalyst version",
      slot_type: null, station_name: null,
    },
  };

  // The two membership stations both flow through one solver primitive but must
  // render different labels (KTD2) — the renderer forks on m.station, keyed here.
  const STATION_TO_SYSTEM = {
    "Cannith Repurposing Station": "vecna-lost-purpose",
    "Dinosaur Bone crafting": "isle-of-dread-set-bonus",
  };

  function get(systemId) {
    return Object.prototype.hasOwnProperty.call(SYSTEMS, systemId) ? SYSTEMS[systemId] : null;
  }

  function systemForStation(station) {
    return STATION_TO_SYSTEM[String(station)] || null;
  }

  // Fill an action_label template with the supplied values; leaves unknown
  // placeholders untouched so a missing value is visible, not silently blank.
  function actionLabel(systemId, values) {
    const s = get(systemId);
    if (!s) return "";
    const v = values || {};
    return s.action_label.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? String(v[key]) : m));
  }

  const api = { SYSTEMS, STATION_TO_SYSTEM, get, systemForStation, actionLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.CraftingSystems = api;
})();
