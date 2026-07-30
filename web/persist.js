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
    "gsPlaced", "membershipPlaced",
  ];

  function stripResult(result) {
    const out = {};
    if (!result) return out;
    for (const k of RESULT_KEEP) {
      if (result[k] !== undefined) out[k] = result[k];
    }
    return out;
  }

  // Build a saved-character record from the live wizard state + its last solve.
  // `chosen[]` already holds full item objects (keyed on source_item/variant_id),
  // so the snapshot renders standalone without the live catalog.
  function serializeCharacter(name, state, lastRun, buildId) {
    const s = state || {};
    const run = lastRun || {};
    return {
      name: String(name),
      savedAt: new Date().toISOString(),
      inputs: {
        characterName: String(name),
        ml: s.ml,
        race: s.race,
        alignment: s.alignment,
        armor: s.armor,
        weapon: s.weapon,
        includeArtifact: s.includeArtifact,
        pool: s.pool,
        ownedNames: s.ownedNames,
        priorities: s.priorities,
        slotConstraints: s.slotConstraints,
      },
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
    if (!st) return {};
    try {
      const raw = st.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return (parsed && typeof parsed === "object") ? parsed : {};
    } catch (e) {
      return {};
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

  function deleteCharacter(name, storage) {
    const all = readAll(storage);
    delete all[name];
    return writeAll(all, storage);
  }

  const api = {
    STORE_KEY, stripResult, serializeCharacter,
    saveCharacter, listCharacters, loadCharacter, deleteCharacter,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.CharacterStore = api;
})();
