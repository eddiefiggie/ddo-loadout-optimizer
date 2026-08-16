// Character persistence store (U2). Saves named characters to localStorage:
// their inputs plus a denormalized snapshot of the solved loadout, so a saved
// build reloads instantly and standalone. Pure logic + a thin storage wrapper,
// dual-exported for Node tests. Namespaced global `CharacterStore` to avoid the
// single-global-scope collision trap (every web/*.js shares one scope).
(function () {
  "use strict";

  const STORE_KEY = "ddo.characters.v1";

  // Panel-consumed subset of the solver result (plan KTD1). `status` is required
  // — renderResults short-circuits to the empty state when it isn't "optimal".
  // `program` (the whole MILP, cyclic + non-JSON) and `model`/`highs` are dropped
  // by omission.
  const RESULT_KEEP = [
    "status", "chosen", "effective", "perTarget", "breakdown", "setsActive",
    "computeScale", "capped", "augmentsPlaced", "dinoPlaced", "ncPlaced",
    "rollPlaced", "vikPlaced", "sealPlaced", "jokerPlaced", "tfPlaced",
    "gsPlaced", "membershipPlaced", "setAugmentsPlaced",
    // U4/U5 — the declared-credit disclosure. Two allowlists, not one: the INPUT
    // list below carries the declaration, this one carries what it DID. Without
    // it the credit still solves correctly on load while the honesty line R9
    // requires goes quiet, because `program` is dropped and KTD6 forbids
    // re-solving a restored character. Plain JSON by construction (see
    // buildCreditReport) precisely so it can live here.
    "creditReport",
    // #239 U1 — the saturation disclosure, for the same reason as creditReport
    // directly above: it is computed from `program.zByBucket`, `program` is
    // dropped by omission, and a restored character is never re-solved. Without
    // it the notice would render on a fresh solve and vanish on load.
    "saturationReport",
    // #239 — same reason: computed from `model.worn`, and `model` is dropped.
    "emptySlots",
    // U6/#249 — the compound-absorption quarantine, read off `model.worn` for the
    // same reason as `emptySlots` directly above. A restored character must
    // disclose the exclusion without re-solving, or a saved build quietly stops
    // saying that an affix was withheld from it.
    "absorptionQuarantine",
    // #110 (U7) — the blocklist attribution, computed off the pre-dominance pool
    // at model-build time. Same restore-without-re-solve contract as the rest.
    "blockReport",
    // #91 (U5, KTD6/R14) — the Utility tier's receipts (count + per-effect
    // credited carrier) and the stage-locked count. Computed from `program`
    // (dropped by omission) at solve time; without these a restored character
    // with the tier ranked could only render the report-absent state, never
    // its actual effects, because KTD6 forbids re-solving on load.
    "utilityReport", "utilityCount",
  ];

  function stripResult(result) {
    const out = {};
    if (!result) return out;
    for (const k of RESULT_KEEP) {
      if (result[k] !== undefined) out[k] = result[k];
    }
    return out;
  }

  // The saved-character input allowlist — the single source of truth for which
  // input fields persist. backup.js imports this so an import round-trip can
  // never silently strip a field the save path keeps (the two lists cannot drift).
  const INPUT_KEYS = [
    "characterName", "ml", "mlFloor", "mlFloorManual", "race", "alignment", "armor", "oath",
    "style", "weaponTypes", "offHand", "offHandWeapons", "twoWeaponFighting",
    "includeArtifact", "excludeCraftingSystems", "blocklist", "ownedSetAugments", "pool", "ownedNames", "priorities", "slotConstraints",
    "targetCaps", "targetFloors",
    // U2/U5 — declared stat credits, keyed `stat||bonusType`. Plain JSON, so it
    // needs no special serialization the way the two Sets above do.
    "declaredCredits",
  ];

  function pickInputs(state, name) {
    const s = state || {};
    const src = Object.assign({}, s, { characterName: String(name) });
    const inputs = {};
    for (const k of INPUT_KEYS) {
      if (k === "ownedNames") {
        // ownedNames is a Set at runtime; JSON can't hold a Set, so store an
        // array and let the loader rebuild the Set.
        inputs.ownedNames = s.ownedNames instanceof Set ? Array.from(s.ownedNames)
          : (Array.isArray(s.ownedNames) ? s.ownedNames : null);
      } else if (k === "ownedSetAugments") {
        // U6 — same Set-as-array precedent as ownedNames: stored as an array, the
        // loader rebuilds the Set. Absent/other -> [] (default: none owned).
        inputs.ownedSetAugments = s.ownedSetAugments instanceof Set ? Array.from(s.ownedSetAugments)
          : (Array.isArray(s.ownedSetAugments) ? s.ownedSetAugments : []);
      } else if (k === "twoWeaponFighting") {
        // plan 003 U1 — always a boolean. A pre-U1 state has no field, and storing
        // `undefined` would drop the key from the JSON entirely, leaving the loader
        // unable to tell "saved as undeclared" from "saved before the feature".
        inputs.twoWeaponFighting = !!s.twoWeaponFighting;
      } else {
        inputs[k] = src[k];
      }
    }
    return inputs;
  }

  // Build a saved-character record from the live wizard state + its last solve.
  // `chosen[]` already holds full item objects (keyed on source_item/variant_id),
  // so the snapshot renders standalone without the live catalog.
  function serializeCharacter(name, state, lastRun, buildId) {
    const run = lastRun || {};
    return {
      name: String(name),
      savedAt: new Date().toISOString(),
      inputs: pickInputs(state, name),
      query: run.query || null,
      snapshot: stripResult(run.result),
      stampedBuildId: buildId || null,
    };
  }

  // ---- storage wrapper ---------------------------------------------------
  function resolveStorage(storage) {
    if (storage) return storage;
    if (typeof localStorage !== "undefined") return localStorage;
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
    return null;
  }

  function readAll(storage) {
    const st = resolveStorage(storage);
    // null-prototype map so a character literally named "__proto__" is stored as
    // an own key (hitting the proto setter would silently drop it and mutate the
    // object's prototype).
    const empty = () => Object.create(null);
    if (!st) return empty();
    try {
      const raw = st.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return (parsed && typeof parsed === "object")
        ? Object.assign(empty(), parsed) : empty();
    } catch (e) {
      return empty();
    }
  }

  function writeAll(obj, storage) {
    const st = resolveStorage(storage);
    if (!st) return { ok: false, error: "no-storage" };
    try {
      st.setItem(STORE_KEY, JSON.stringify(obj));
      return { ok: true };
    } catch (e) {
      const quota = e && (e.name === "QuotaExceededError" || e.code === 22);
      return { ok: false, error: quota ? "quota" : "write" };
    }
  }

  function saveCharacter(record, storage) {
    const all = readAll(storage);
    all[record.name] = record;
    return writeAll(all, storage);
  }

  // Lightweight list for the picker: name + stamp + savedAt, not the full snapshot.
  function listCharacters(storage) {
    const all = readAll(storage);
    return Object.keys(all).map((name) => ({
      name,
      stampedBuildId: all[name] ? all[name].stampedBuildId : null,
      savedAt: all[name] ? all[name].savedAt : null,
    }));
  }

  function loadCharacter(name, storage) {
    const all = readAll(storage);
    return Object.prototype.hasOwnProperty.call(all, name) ? all[name] : null;
  }

  // Full name -> record map, for backup export/import.
  function allCharacters(storage) {
    return readAll(storage);
  }

  function saveMany(records, storage) {
    const all = readAll(storage);
    for (const name of Object.keys(records || {})) all[name] = records[name];
    return writeAll(all, storage);
  }

  function deleteCharacter(name, storage) {
    const all = readAll(storage);
    delete all[name];
    return writeAll(all, storage);
  }

  const api = {
    STORE_KEY, INPUT_KEYS, stripResult, pickInputs, serializeCharacter,
    saveCharacter, listCharacters, loadCharacter, deleteCharacter,
    allCharacters, saveMany,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.CharacterStore = api;
})();
