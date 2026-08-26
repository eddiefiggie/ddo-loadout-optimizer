// Saved-bundle store (plan 2026-08-25-001, U2). A player's own ranking — the
// affixes, their order, and the floor and cap declared for each — kept so it can
// be reused on any character.
//
// NAMED `SavedBundles`, NOT `Bundles`, deliberately. "Bundle" already means two
// unrelated things in this repo and the collision is easy to walk into:
//
//   * BUNDLED ENCHANTMENTS (`bundleGroups`, `bundlesBlock`, `tests/bundles.test.js`)
//     are a multi-stat engraved affix group on an item, rendered on the Sets tab.
//   * PRESET BUNDLES (`PRESET_BUNDLES` in web/wizard.js) are the primer chips on
//     the priority step.
//
// This store is neither. It holds what the PLAYER saved. The plan's U2 named the
// file `bundles-store.js` and its test `bundle-store.test.js`; both are renamed
// here to `saved-bundles` so the module says which of the three it is, and so the
// file and its test agree. Product behavior is unchanged.
//
// Pure logic + a thin storage wrapper, dual-exported for Node tests. Namespaced
// global to avoid the single-global-scope collision trap (every web/*.js shares
// one scope).
(function () {
  "use strict";

  const STORE_KEY = "ddo.bundles.v1";

  // The ONLY keys a stored bundle carries. Everything else is dropped at the
  // write boundary — see `makeBundle`.
  const BUNDLE_KEYS = ["id", "name", "affixes", "floors", "caps", "savedAt"];

  /** A stable id without Date.now()/Math.random(), both of which make a record
   *  unreproducible in a test. Monotonic within a store: one past the highest
   *  numeric suffix present, so ids never collide and never reuse. Mirrors
   *  `nextId` in web/versions.js. */
  function nextId(existing) {
    let max = 0;
    for (const r of existing || []) {
      const m = /^b(\d+)$/.exec(String((r && r.id) || ""));
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `b${max + 1}`;
  }

  /** A bound map cleaned to the same predicate the wizard applies before a solve
   *  (`cleanBoundMap`): finite, non-negative, empty-and-null dropped.
   *
   *  Bounds are additionally restricted to affixes the bundle actually carries.
   *  A floor keyed to an affix that is not in the ranking cannot be applied by
   *  anything that reads this bundle, so storing it would be a value that looks
   *  live and can never take effect — the orphan-bound shape the wizard's own
   *  clean pass exists to prevent. */
  function cleanBounds(map, allowed) {
    const out = {};
    if (!map || typeof map !== "object") return out;
    const keep = allowed instanceof Set ? allowed : new Set(allowed || []);
    for (const [stat, v] of Object.entries(map)) {
      if (!keep.has(stat)) continue;
      if (v === "" || v == null) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) continue;
      out[stat] = n;
    }
    return out;
  }

  /** Build a stored bundle from whatever the caller hands over.
   *
   *  THIS IS THE WRITE BOUNDARY, and it is an allowlist rather than a blocklist.
   *  A bundle must carry the goal (affixes, their order, their bounds) and never
   *  a character-level fact — a declared credit, a crafting rung, an ML cap, a
   *  race, a blocklist. Those describe one character's enhancements and setup, so
   *  a bundle carrying them would silently assert them on the next character the
   *  bundle is applied to, and the solver would act on an assertion the player
   *  never made.
   *
   *  An allowlist is what makes that hold as new character-level state is added:
   *  a blocklist rule would have to be updated to keep excluding things, and
   *  nobody updates a blocklist for a field they did not know existed.
   *
   *  `savedAt` is passed IN rather than stamped here so the caller owns the
   *  clock — same reason `makeVersion` takes it. */
  function makeBundle({ id, name, affixes, floors, caps, savedAt }) {
    const order = [];
    const seen = new Set();
    for (const a of Array.isArray(affixes) ? affixes : []) {
      const s = typeof a === "string" ? a.trim() : "";
      // Sanitize at the write boundary: a hand-edited backup can carry
      // non-strings, and a stored non-string would render as a ghost row that a
      // strict string comparison could never remove.
      if (!s || seen.has(s)) continue;
      seen.add(s);
      order.push(s);
    }
    return {
      id: String(id),
      name: String(name == null ? "" : name).trim(),
      affixes: order,
      floors: cleanBounds(floors, seen),
      caps: cleanBounds(caps, seen),
      savedAt: savedAt || null,
    };
  }

  // ---- storage -------------------------------------------------------------

  function resolveStorage(storage) {
    if (storage) return storage;
    if (typeof localStorage !== "undefined") return localStorage;
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
    return null;
  }

  /** Every stored bundle, newest first. A malformed payload reads as empty rather
   *  than throwing: a corrupt store must not take the priority step down with it.
   *  Mirrors `listVersions`. */
  function listBundles(storage) {
    const st = resolveStorage(storage);
    if (!st) return [];
    let raw = null;
    try { raw = st.getItem(STORE_KEY); } catch (e) { return []; }
    if (!raw) return [];
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => r && typeof r === "object" && r.id);
  }

  /** Write the list back. Returns `{ ok }`, and on a quota failure
   *  `{ ok: false, full: true }` — the one case a caller must surface rather than
   *  swallow. A swallowed failure leaves a bundle on screen that was never
   *  stored, which is worse than a refusal: the player believes their work is
   *  saved. Same contract, and the same generous quota matching, as
   *  `VersionStore.writeAll`. */
  function writeAll(list, storage) {
    const st = resolveStorage(storage);
    if (!st) return { ok: false, full: false };
    try {
      st.setItem(STORE_KEY, JSON.stringify(list));
      return { ok: true, full: false };
    } catch (e) {
      const full = !!e && (e.name === "QuotaExceededError"
        || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
      return { ok: false, full };
    }
  }

  /** Save a bundle, newest first, replacing any record with the same id. The
   *  record is re-made through `makeBundle` here as well as at the call site, so
   *  a caller that hands over a raw object cannot bypass the write boundary. */
  function saveBundle(rec, storage) {
    const clean = makeBundle(rec || {});
    const list = listBundles(storage);
    const next = [clean, ...list.filter((r) => r.id !== clean.id)];
    return Object.assign(writeAll(next, storage), { id: clean.id });
  }

  /** Rename in place, preserving position and every other field. Returns
   *  `{ ok: false, missing: true }` for an unknown id rather than silently
   *  creating one — a rename that invents a record is a save wearing the wrong
   *  name. */
  function renameBundle(id, name, storage) {
    const list = listBundles(storage);
    let found = false;
    const next = list.map((r) => {
      if (r.id !== id) return r;
      found = true;
      return Object.assign({}, r, { name: String(name == null ? "" : name).trim() });
    });
    if (!found) return { ok: false, full: false, missing: true };
    return writeAll(next, storage);
  }

  function deleteBundle(id, storage) {
    return writeAll(listBundles(storage).filter((r) => r.id !== id), storage);
  }

  function clearBundles(storage) { return writeAll([], storage); }

  /** Merge an imported set into the store WITHOUT destroying what is already
   *  here. Returns the store's `{ ok, full }`.
   *
   *  A restore that replaced the store would delete every bundle the player made
   *  since their last export — authored work that exists nowhere else, on the one
   *  path they reach precisely because something already went wrong. The character
   *  half of the same import merges by name, so replacing here also gave one
   *  import two opposite meanings while the status line claimed only one.
   *
   *  Ids collide by construction: `nextId` is per-store monotonic, so two browsers
   *  independently produce `b1`. An incoming record whose id is already taken by a
   *  DIFFERENT bundle (different name) is re-issued a fresh id rather than
   *  overwriting; a matching name is the same bundle coming home, and the incoming
   *  copy wins so a re-import is idempotent rather than duplicating. */
  function mergeIn(incoming, storage) {
    const existing = listBundles(storage);
    const byId = new Map(existing.map((r) => [r.id, r]));
    const out = existing.slice();
    let ids = existing;
    for (const raw of Array.isArray(incoming) ? incoming : []) {
      if (!raw || typeof raw !== "object" || !raw.id) continue;
      const rec = makeBundle(raw);
      const clash = byId.get(rec.id);
      const sameBundle = clash
        && String(clash.name || "").trim().toLowerCase() === String(rec.name || "").trim().toLowerCase();
      if (clash && !sameBundle) {
        rec.id = nextId(ids);
        ids = ids.concat([rec]);
      }
      const at = out.findIndex((r) => r.id === rec.id);
      if (at >= 0) out[at] = rec; else out.unshift(rec);
      byId.set(rec.id, rec);
    }
    return writeAll(out, storage);
  }

  /** Case-insensitive name match against a DIFFERENT bundle. Mirrors the
   *  build-name collision rule: renaming a bundle to the name it already has is
   *  not a collision, or the rename control could never be pressed twice. */
  function nameCollides(name, list, exceptId) {
    const n = String(name == null ? "" : name).trim().toLowerCase();
    if (!n) return false;
    return (list || []).some((r) => r && r.id !== exceptId
      && String(r.name || "").trim().toLowerCase() === n);
  }

  const api = {
    STORE_KEY, BUNDLE_KEYS, nextId, makeBundle, cleanBounds,
    listBundles, writeAll, saveBundle, renameBundle, deleteBundle, clearBundles, mergeIn,
    nameCollides,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.SavedBundles = api;
})();
