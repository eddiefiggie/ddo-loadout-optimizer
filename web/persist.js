// Character persistence store (U2). Saves named characters to localStorage:
// their inputs plus a denormalized snapshot of the solved loadout, so a saved
// build reloads instantly and standalone. Pure logic + a thin storage wrapper,
// dual-exported for Node tests. Namespaced global `CharacterStore` to avoid the
// single-global-scope collision trap (every web/*.js shares one scope).
(function () {
  "use strict";

  const STORE_KEY = "ddo.characters.v1";

  // #346 — the ladder's normalizer, over the cross-runtime bridge the rest of
  // web/*.js uses (model.js loads first in the browser; node resolves the
  // require). Persistence must sanitize at the write boundary too: a hand-edited
  // backup can carry anything, and a bad rung stored back into localStorage
  // would outlive the session that produced it.
  const _rungOf = (typeof normalizeRung !== "undefined")
    ? normalizeRung
    // eslint-disable-next-line global-require
    : require("./model.js").normalizeRung;
  const _rungExcludesNiche = (typeof rungExcludesNicheCrafting !== "undefined")
    ? rungExcludesNicheCrafting
    // eslint-disable-next-line global-require
    : require("./model.js").rungExcludesNicheCrafting;

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
    // #339 — augCeiling is the mlFloor precedent: a plain nullable scalar, no
    // save marker, no healing. Absent on a pre-feature save -> loads unrestricted.
    "characterName", "ml", "mlFloor", "mlFloorManual", "augCeiling", "race", "alignment", "armor", "oath",
    "style", "weaponTypes", "offHand", "offHandWeapons", "twoWeaponFighting",
    // #346 — the crafting/augment ladder. `excludeCraftingSystems` stays on the
    // allowlist as a READ-ONLY legacy key: saves written before the ladder carry
    // it, and the wizard's load path derives the rung from it (a total mapping —
    // absent/false -> top rung, true -> no-niche-crafting). pickInputs no longer
    // writes it, so it ages out of the corpus on the next save of each character.
    "includeArtifact", "craftingRung", "excludeCraftingSystems", "blocklist", "ownedSetAugments", "pool", "ownedNames", "priorities", "slotConstraints",
    "targetCaps", "targetFloors",
    // U2/U5 — declared stat credits, keyed `stat||bonusType`. Plain JSON, so it
    // needs no special serialization the way the two Sets above do.
    "declaredCredits",
    // #91 (U4/KTD8) — the Utility-tier save marker. Every save this code writes
    // is by definition post-feature, so pickInputs stamps it `true` uncondition-
    // ally; a save that LACKS it is pre-feature and the wizard's load path heals
    // it by appending the tier. It must live on THIS allowlist: a marker outside
    // it would be silently stripped on save, every record would read pre-feature,
    // and a player's removal of the tier would resurrect on every load. backup.js
    // imports this list, so the export/import round-trip carries it for free.
    "utility_tier_aware",
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
      } else if (k === "utility_tier_aware") {
        // #91 (U4/KTD8) — always `true`, never read from state: the marker means
        // "this record was written by tier-aware code", which is a property of
        // the CODE doing the saving, not of the character. Reading it from state
        // (where nothing sets it) would store `undefined`, JSON would drop the
        // key, and every save would masquerade as pre-feature — re-appending a
        // tier the player deliberately removed, on every single load.
        inputs.utility_tier_aware = true;
      } else if (k === "twoWeaponFighting") {
        // plan 003 U1 — always a boolean. A pre-U1 state has no field, and storing
        // `undefined` would drop the key from the JSON entirely, leaving the loader
        // unable to tell "saved as undeclared" from "saved before the feature".
        inputs.twoWeaponFighting = !!s.twoWeaponFighting;
      } else if (k === "craftingRung") {
        // #346 (U3) — always written, always one of the four rungs, because the
        // loader must be able to tell "saved at the top rung" from "saved before
        // the ladder existed". Storing `undefined` would drop the key and make a
        // post-ladder save indistinguishable from a legacy one, sending it down
        // the boolean-derivation path forever.
        inputs.craftingRung = _rungOf(s.craftingRung);
      } else if (k === "excludeCraftingSystems") {
        // #346 (U3) — the legacy key is DERIVED from the rung, not read from
        // state. Writing it back is a downgrade bridge: this app deploys
        // continuously to Pages with best-effort cache-busting, so a player can
        // hand-export a backup from the new build and re-import it into an older
        // one still sitting in their browser cache. That build reads no
        // `craftingRung`, and without this key it would silently restore a
        // restricted character as fully unrestricted.
        //
        // Deriving rather than storing is what makes this safe: the value is a
        // function of the rung, so the two can never contradict each other, and
        // every reader already prefers a stored rung over the boolean. It
        // degrades to the closest legal older state — any restrictive rung
        // becomes the old "don't build around niche crafting" — instead of to
        // nothing. Drop it once older builds can no longer be in circulation.
        inputs.excludeCraftingSystems = _rungExcludesNiche(_rungOf(s.craftingRung));
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
