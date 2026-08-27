// Version store + diff engine (#500). Keeps point-in-time snapshots of solved
// loadouts so a player can answer the question the app could not answer at all:
// *how does this build differ from the one I had before?* Saving a character
// overwrites what was there, so until now nothing recorded what changed or what
// it cost.
//
// Pure logic + a thin storage wrapper, dual-exported for Node tests. Namespaced
// global `VersionStore` to avoid the single-global-scope collision trap (every
// web/*.js shares one scope).
(function () {
  "use strict";

  const STORE_KEY = "ddo.versions.v1";

  // The shared projection. In the browser projection.js loads first; Node
  // resolves the require. Same bridge the rest of web/*.js uses.
  const _Proj = (typeof Projection !== "undefined") ? Projection
    // eslint-disable-next-line global-require
    : (typeof require !== "undefined" ? require("./projection.js") : null);

  // The saved-character store, for `stripResult` — a version's snapshot must be
  // the SAME shape a saved character's is, or the two could not be compared
  // against each other and `Proj.project` would need a second input shape.
  const _Chars = (typeof CharacterStore !== "undefined") ? CharacterStore
    // eslint-disable-next-line global-require
    : (typeof require !== "undefined" ? require("./persist.js") : null);

  // ---- records -------------------------------------------------------------

  /** Version kinds, and what each one means about how it got here.
   *
   *  `auto`   — taken on a solve, without being asked for. The only kind that
   *             accumulates on its own, and so the only one a full store is
   *             ever really about.
   *  `named`  — the player pressed save and typed a name. Deliberate.
   *  `import` — arrived as Portable JSON, from this player or another.
   *
   *  A saved CHARACTER is not a kind. Characters are compared straight out of
   *  their own store (their snapshots already render standalone), which is what
   *  "fresh start" means: version history begins empty, and nothing rewrites
   *  what is already saved. */
  const KINDS = ["auto", "named", "import"];

  /** A stable id without Date.now()/Math.random(), both of which make a record
   *  unreproducible in a test. Monotonic within a store: one past the highest
   *  numeric suffix present, so ids never collide and never reuse. */
  function nextId(existing) {
    let max = 0;
    for (const r of existing || []) {
      const m = /^v(\d+)$/.exec(String((r && r.id) || ""));
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `v${max + 1}`;
  }

  /** Build a version record from a live run. `savedAt` is passed IN rather than
   *  stamped here so the caller owns the clock — the same reason the workflow
   *  scripts in this repo take timestamps as input. */
  function makeVersion({ id, name, kind, query, result, inputs, buildId, savedAt }) {
    return {
      id: String(id),
      name: String(name || ""),
      kind: KINDS.includes(kind) ? kind : "auto",
      savedAt: savedAt || null,
      query: query || null,
      inputs: inputs || null,
      snapshot: _Chars ? _Chars.stripResult(result) : (result || {}),
      stampedBuildId: buildId || null,
    };
  }

  // ---- storage -------------------------------------------------------------

  function resolveStorage(storage) {
    if (storage) return storage;
    if (typeof localStorage !== "undefined") return localStorage;
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
    return null;
  }

  /** Every stored version, newest first. A malformed payload reads as empty
   *  rather than throwing: a corrupt store must not take the results screen
   *  down with it. */
  function listVersions(storage) {
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

  /** Write the list back.
   *
   *  Returns `{ ok }`, and on a quota failure `{ ok: false, full: true }` — the
   *  ONE case the caller must surface rather than swallow. Snapshots carry full
   *  item objects (`stripResult` keeps `chosen[]` with the item bodies so a
   *  saved build renders standalone), so they are not small, and auto-snapshots
   *  accumulate on every solve. The interview settled retention as "grow until
   *  storage complains, then warn and let the player prune" — which makes THIS
   *  return value the whole retention policy. A swallowed quota error would
   *  silently stop recording history while the tab kept claiming to save it. */
  function writeAll(list, storage) {
    const st = resolveStorage(storage);
    if (!st) return { ok: false, full: false };
    try {
      st.setItem(STORE_KEY, JSON.stringify(list));
      return { ok: true, full: false };
    } catch (e) {
      // Quota is the expected failure and the one worth naming. Browsers do not
      // agree on the name or code, so match generously and treat anything else
      // as a plain failure rather than mislabelling it "full".
      const full = !!e && (e.name === "QuotaExceededError"
        || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
      return { ok: false, full };
    }
  }

  /** Bytes this store occupies. ITS OWN KEY ONLY — each store accounts for
   *  itself and the orchestrator composes them, because no store should have to
   *  know the others exist to report its own size. */
  function usageBytes(storage) {
    const st = resolveStorage(storage);
    if (!st) return 0;
    let raw = "";
    try { raw = st.getItem(STORE_KEY) || ""; } catch (e) { return 0; }
    // Browsers bill localStorage in UTF-16 code units, so a character is 2
    // bytes. Reporting `length` would understate the store by half and make a
    // "this is what filled your storage" claim quietly wrong.
    return raw.length * 2;
  }

  function countByKind(storage) {
    const out = { auto: 0, named: 0, import: 0 };
    for (const r of listVersions(storage)) {
      const k = KINDS.includes(r && r.kind) ? r.kind : "auto";
      out[k] += 1;
    }
    return out;
  }

  /** Keep the newest `keep` AUTO records; drop the rest. Pure, so the policy is
   *  testable without a storage stub.
   *
   *  `named` and `import` are never dropped, at any rung. They are authored work
   *  — someone pressed save and typed a name, or carried a file in — and #530 is
   *  the standing reminder that treating them as reclaimable loses exactly what a
   *  player cannot reproduce. Autos are the only kind that accumulates unbidden,
   *  which is what makes them the only kind safe to reclaim.
   *
   *  The list is newest-first (`saveVersion` prepends), so "oldest" is the tail.
   */
  function pruneAutoList(list, keep) {
    let seen = 0;
    return (list || []).filter((r) => {
      const kind = KINDS.includes(r && r.kind) ? r.kind : "auto";
      if (kind !== "auto") return true;
      seen += 1;
      return seen <= keep;
    });
  }

  function pruneAuto(keep, storage) {
    const list = listVersions(storage);
    const kept = pruneAutoList(list, keep);
    const dropped = list.length - kept.length;
    if (!dropped) return { ok: true, dropped: 0 };
    return Object.assign(writeAll(kept, storage), { dropped });
  }

  /** How far to fall back when the store will not take another record. Each rung
   *  gives up more history for the same reason: an unsaved build is worse than a
   *  shortened one. The last rung keeps ONE auto — the build being written — so
   *  the write can still succeed when nothing else will let it.
   *
   *  Stopping at 2 rather than 1 would preserve the Adjustment Studio's default
   *  comparison, and deliberately is not the last rung: at that point the choice
   *  is between losing a diff and losing the build, and the build wins.
   */
  const RECLAIM_LADDER = [10, 3, 1];

  /** #548 — `auto` snapshots are taken on EVERY solve, carry full item bodies
   *  (~38 KB each), and had no cap: the documented policy was "grow until storage
   *  complains, then warn and let the player prune". The warning half worked. What
   *  it did not anticipate is that this store shares one origin budget with the
   *  saved characters, the bundles and the farming progress — so the store that
   *  grows unbidden evicts the three that hold deliberate work, and the failure
   *  surfaces on whichever of them happens to be written next.
   *
   *  So the policy still grows freely, but a full store now reclaims its OWN
   *  unbidden history and retries instead of failing. `reclaimed` reports how many
   *  records that cost, so the caller can say so rather than silently shortening
   *  the player's history.
   */
  function saveVersion(rec, storage) {
    const list = listVersions(storage);
    const next = [rec, ...list.filter((r) => r.id !== rec.id)];
    let res = writeAll(next, storage);
    if (res.ok || !res.full) return Object.assign(res, { id: rec.id, reclaimed: 0 });
    for (const keep of RECLAIM_LADDER) {
      const kept = pruneAutoList(next, keep);
      if (kept.length === next.length) continue;   // nothing left to give at this rung
      res = writeAll(kept, storage);
      if (res.ok) {
        return Object.assign(res, { id: rec.id, reclaimed: next.length - kept.length });
      }
    }
    // Still full with one auto left: what remains is named and imported work, and
    // dropping that is the player's call, not this function's.
    return Object.assign(res, { id: rec.id, reclaimed: 0 });
  }

  function deleteVersion(id, storage) {
    return writeAll(listVersions(storage).filter((r) => r.id !== id), storage);
  }

  function clearVersions(storage) { return writeAll([], storage); }

  // ---- diff ----------------------------------------------------------------

  /** Both sides projected through `Proj.project`, the ONE content model every
   *  export already renders from. The diff therefore cannot disagree with what
   *  the Share tab prints about either build — a second reconstruction here is
   *  exactly the two-implementations-that-agree-today problem #457 and #469 each
   *  had to re-fix. */
  function projectSide(rec) {
    if (!rec) return null;
    if (!_Proj || typeof _Proj.project !== "function") return null;
    return _Proj.project({ name: rec.name, inputs: rec.inputs || {}, snapshot: rec.snapshot || {} });
  }

  /** A multiset key for one equipped item. Slot alone is not enough: a build can
   *  wear two Rings, and comparing by slot name would call a swap of one ring a
   *  change of both. */
  function slotKey(row, n) { return `${row.slot}#${n}`; }

  function indexLoadout(view) {
    const seen = new Map(), out = new Map();
    for (const row of (view && view.loadout) || []) {
      const n = (seen.get(row.slot) || 0);
      seen.set(row.slot, n + 1);
      out.set(slotKey(row, n), row);
    }
    return out;
  }

  /** The craft prescriptions on one item, as comparable strings. Reads the
   *  labels the exports print, so "what changed in crafting" is stated in the
   *  same words the player would copy into a forum post. */
  function craftStrings(row) {
    return [
      ...((row.augments) || []).map((a) => `Augment: ${a.name || a.item || a.variant_id || "?"}`),
      ...((row.crafting) || []).map((c) => c.label || `${c.family}`),
    ];
  }

  /** Diff two version records.
   *
   *  `a` is the LEFT side — in the app, always the build on screen. `b` is what
   *  the player picked to compare it against.
   *
   *  Every differing stat is reported, ranked or not. A swap that quietly cost
   *  40 HP has to say so even when HP was never a priority: the whole reason to
   *  compare two builds is to find what you did not ask about. */
  function diffVersions(a, b) {
    const va = projectSide(a), vb = projectSide(b);
    if (!va || !vb) return null;

    // --- stats ---------------------------------------------------------------
    const ea = (a.snapshot && a.snapshot.effective) || {};
    const eb = (b.snapshot && b.snapshot.effective) || {};
    const rankedA = new Set(((a.query && a.query.targets) || []));
    const rankedB = new Set(((b.query && b.query.targets) || []));
    const statNames = [...new Set([...Object.keys(ea), ...Object.keys(eb)])].sort();
    const stats = [];
    for (const stat of statNames) {
      const x = Number(ea[stat]) || 0, y = Number(eb[stat]) || 0;
      if (x === y) continue;
      stats.push({ stat, a: x, b: y, delta: x - y, ranked: rankedA.has(stat) || rankedB.has(stat) });
    }
    // Ranked first (in the left side's priority order, which is the order the
    // player arranged), then everything else by size of change — the incidental
    // losses worth noticing are the big ones.
    const order = (a.query && a.query.targets) || [];
    const rank = (s) => { const i = order.indexOf(s); return i < 0 ? Infinity : i; };
    stats.sort((p, q) => (p.ranked === q.ranked ? 0 : p.ranked ? -1 : 1)
      || rank(p.stat) - rank(q.stat)
      || Math.abs(q.delta) - Math.abs(p.delta)
      || p.stat.localeCompare(q.stat));

    // --- slots ---------------------------------------------------------------
    const ia = indexLoadout(va), ib = indexLoadout(vb);
    const slotKeys = [...new Set([...ia.keys(), ...ib.keys()])].sort();
    const slots = [];
    for (const key of slotKeys) {
      const ra = ia.get(key) || null, rb = ib.get(key) || null;
      const nameA = ra ? ra.item : null, nameB = rb ? rb.item : null;
      const ca = ra ? craftStrings(ra) : [], cb = rb ? craftStrings(rb) : [];
      const craftsAdded = ca.filter((s) => !cb.includes(s));
      const craftsRemoved = cb.filter((s) => !ca.includes(s));
      const changed = nameA !== nameB || craftsAdded.length > 0 || craftsRemoved.length > 0;
      slots.push({
        slot: (ra || rb).slot, key,
        a: ra ? { item: nameA, ml: ra.ml } : null,
        b: rb ? { item: nameB, ml: rb.ml } : null,
        itemChanged: nameA !== nameB,
        craftsAdded, craftsRemoved, changed,
      });
    }

    // --- sets ----------------------------------------------------------------
    const setsA = new Set(((va.sets) || []).map((s) => s.set));
    const setsB = new Set(((vb.sets) || []).map((s) => s.set));
    const sets = {
      gained: [...setsA].filter((s) => !setsB.has(s)).sort(),
      lost: [...setsB].filter((s) => !setsA.has(s)).sort(),
      kept: [...setsA].filter((s) => setsB.has(s)).sort(),
    };

    return {
      stats,
      slots,
      sets,
      identical: stats.length === 0 && slots.every((s) => !s.changed)
        && sets.gained.length === 0 && sets.lost.length === 0,
    };
  }

  const api = {
    STORE_KEY, KINDS, nextId, makeVersion,
    listVersions, saveVersion, deleteVersion, clearVersions, writeAll,
    usageBytes, countByKind, pruneAuto, pruneAutoList, RECLAIM_LADDER,
    diffVersions, projectSide, craftStrings, indexLoadout,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.VersionStore = api;
})();
