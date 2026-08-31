// Versioned backup of all saved characters (U5). Round-trips the character
// store through a single JSON file under a backward-compatibility contract:
// migrate any file within the last 3 schema versions, refuse older or
// newer-than-app files, and refuse structurally-invalid, oversized, or
// prototype-polluting payloads — always a full refusal, never a partial import.
// Pure, dual-exported for Node tests. Namespaced global `BackupIO`.
(function () {
  "use strict";

  // plan 2026-08-25-001 U8 — v2 adds the player's OTHER authored work to the
  // payload. v1 files still import: `migrate` fills the new keys with empties, so
  // an older backup restores its builds and simply carries no bundles or farming
  // progress. Refusing them would break the promise this panel makes.
  // #530 — v3 adds the player's AUTHORED version history (`named` and `import`,
  // never `auto`). v1 and v2 files still import: `migrate` fills the new key with
  // an empty list, so an older backup restores everything it carried and simply
  // has no version history, which is what it actually had.
  const CURRENT_SCHEMA = 3;
  const WINDOW = 3;           // migrate the last 3 schema versions up to current
  const MAX_CHARS = 5000000;  // ~5MB, matched to the localStorage budget

  // #190 — the PORTABLE single-build envelope `exporters.toPortableJSON` writes.
  // A different file from a backup and read differently: a backup is your whole
  // store coming home, a portable file is ONE build, usually from someone else.
  //
  // `format` is what tells them apart, and it exists for exactly this — the
  // exporter's own comment said "a future import reader can tell a portable
  // loadout from a plain backup file". This is that reader.
  const PORTABLE_FORMAT = "ddo-loadout/v1";
  const PORTABLE_SCHEMA = 1;
  const PORTABLE_WINDOW = 3;

  // NB: written as an explicit comparison, NOT an object literal — `{ __proto__: … }`
  // is prototype-setter syntax, so a literal would define no own "__proto__" key
  // and silently fail to match the single most important pollution key.
  function isPollutionKey(key) {
    return key === "__proto__" || key === "constructor" || key === "prototype";
  }

  // Reviver drops prototype-pollution keys at every nesting level during parse,
  // so a hostile backup can never reach Object.prototype (defense in depth
  // alongside the field allowlist below).
  function safeReviver(key, value) {
    if (isPollutionKey(key)) return undefined;
    return value;
  }

  // Input allowlist — sourced from persist.js so it can never drift from the
  // save path (adding a saved input there automatically survives an import here).
  //
  // #420 — RESOLVED PER CALL, and with no fallback list. Two reasons, neither
  // visible while the lookup happens to succeed:
  //
  //   * The browser branch reads `window.CharacterStore`, which exists only
  //     because persist.js sits above this file in web/index.html. Capturing at
  //     script-eval time made that ordering load-bearing and silent; resolving
  //     at call time does not care when this file was evaluated.
  //   * The old fallback was a second copy of a production constant, and it had
  //     drifted — 11 keys against persist.js's 32, still naming the retired
  //     `weapon`. A failed capture would have kept those 11 and silently dropped
  //     every other saved input on import: the blocklist, declared credits, the
  //     Utility container, target caps and floors, and the player's bonus-type
  //     overrides. No error, no warning — the character just comes back simpler
  //     than it was exported. See
  //     docs/solutions/conventions/a-guard-that-copies-its-parameter-measures-the-copy.md.
  //
  // An import that cannot resolve the allowlist refuses the file rather than
  // returning a reduced character.
  function inputKeys() {
    const p = (typeof require !== "undefined" && typeof module !== "undefined")
      ? require("./persist.js")
      : (typeof window !== "undefined" ? window.CharacterStore : null);
    const keys = p && p.INPUT_KEYS;
    return (Array.isArray(keys) && keys.length) ? keys : null;
  }

  // Recursively strip pollution keys from app-produced data (snapshot/query)
  // that the allowlist passes through by reference, so no inert own "__proto__"
  // property is smuggled into stored state.
  function scrub(value) {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") {
      const out = {};
      for (const k of Object.keys(value)) {
        if (!isPollutionKey(k)) out[k] = scrub(value[k]);
      }
      return out;
    }
    return value;
  }

  // Rebuild a character from an allowlist of known fields so no unexpected key
  // (including a pollution key that slipped a reviver) rides along. Returns null
  // for a structurally-invalid record (missing/non-string name), which the caller
  // treats as a full-file refusal.
  function sanitizeCharacter(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.name !== "string" || raw.name === "") return null;
    // #420 — no allowlist, no rebuild. Returning a partial character here is the
    // silent-data-loss path this guard exists to close.
    const keys = inputKeys();
    if (!keys) return null;
    const inputs = {};
    const rawInputs = (raw.inputs && typeof raw.inputs === "object") ? raw.inputs : {};
    for (const k of keys) {
      if (!isPollutionKey(k) && rawInputs[k] !== undefined) inputs[k] = scrub(rawInputs[k]);
    }
    return {
      name: String(raw.name),
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : null,
      inputs,
      query: raw.query ? scrub(raw.query) : null,
      snapshot: (raw.snapshot && typeof raw.snapshot === "object") ? scrub(raw.snapshot) : {},
      stampedBuildId: raw.stampedBuildId || null,
    };
  }

  /** plan U8 — the backup carries AUTHORED work, and not auto-captured
   *  byproducts.
   *
   *  Builds, saved bundles and farming progress are things a player made: losing
   *  them loses work that exists nowhere else.
   *
   *  #530 — version snapshots are NOT one thing, and treating them as one dropped
   *  authored work under a principle written to preserve it. `auto` snapshots are
   *  taken on every solve without being asked for, are the largest thing in
   *  storage, and are the store with the known growth problem (#502); copying
   *  those into a file meant to move between devices would move the problem with
   *  them, so they stay out. A `named` snapshot is one the player pressed save on
   *  and typed a name for, and an `import` is one they carried in from a file.
   *
   *  `versions.js` already draws exactly this line and has since before this
   *  payload existed: `pruneAutoList` refuses to reclaim a `named` or an `import`
   *  at any rung of the ladder, on the stated grounds that they are work a player
   *  cannot reproduce. So the omission here contradicted the STORE's own policy,
   *  not merely the panel's wording — which is why the fix is to carry them
   *  rather than to reword the panel. The predicate is imported from that store
   *  (`authoredVersions`) instead of restated, so the two cannot drift. */
  function serializeAll(characters, opts) {
    const o = opts || {};
    return {
      schema_version: CURRENT_SCHEMA,
      exported_at: new Date().toISOString(),
      app_build_id: o.buildId || null,
      characters: characters || {},
      bundles: Array.isArray(o.bundles) ? o.bundles : [],
      farming: (o.farming && typeof o.farming === "object") ? o.farming : {},
      versions: Array.isArray(o.versions) ? o.versions : [],
    };
  }

  /** Step migrations, keyed by the version they produce. v2 adds two keys, so the
   *  step supplies empties — a v1 backup is not missing data, it is a file from
   *  before those things could be saved. */
  const MIGRATIONS = {
    2: (data) => Object.assign({}, data, {
      bundles: Array.isArray(data.bundles) ? data.bundles : [],
      farming: (data.farming && typeof data.farming === "object") ? data.farming : {},
    }),
    // #530 — same shape as the v2 step: a v2 file is not missing version history,
    // it is a file from before the backup could carry any.
    3: (data) => Object.assign({}, data, {
      versions: Array.isArray(data.versions) ? data.versions : [],
    }),
  };

  // Apply step migrations from `from` up to `to`. At the v1 baseline there are
  // no migrations, so this is identity; the machinery exists so future versions
  // register a `migrations[n]` step and the window logic keeps working.
  function migrate(data, from, to, migrations) {
    let cur = data;
    for (let v = from + 1; v <= to; v++) {
      const step = migrations && migrations[v];
      if (typeof step === "function") cur = step(cur);
    }
    return cur;
  }

  // Parse + validate a backup file. Returns { ok:true, characters, schemaVersion }
  // or { ok:false, error, message } — never throws.
  /** #530 — the version store, resolved at call time for the same reason the
   *  saved-bundle store is: it may be absent in a test harness, and the restore
   *  path must sanitize through the store that OWNS the shape rather than trust a
   *  hand-edited file. */
  function _versions() {
    if (typeof globalThis !== "undefined" && globalThis.Versions) return globalThis.Versions;
    if (typeof require !== "undefined") { try { return require("./versions.js"); } catch (e) { /* absent */ } }
    return null;
  }

  /** The saved-bundle store, resolved at call time — `saved-bundles.js` loads
   *  after this file in the browser. Same bridge shape used elsewhere. */
  function _savedBundles() {
    if (typeof window !== "undefined" && window.SavedBundles) return window.SavedBundles;
    if (typeof require !== "undefined") { try { return require("./saved-bundles.js"); } catch (e) { /* absent */ } }
    return null;
  }

  /** Text -> object, with the two guards every file share: a size cap and the
   *  prototype-pollution reviver. Returns `{ok:false,…}` in the same typed shape
   *  the parsers return, so a caller can pass it straight back.
   *
   *  Split out for #190 so the portable envelope cannot end up with weaker
   *  handling than a backup by being written later and separately. */
  function readFile(text, maxChars, noun) {
    if (typeof text !== "string" || text.length > maxChars) {
      // #530 — a backup can now carry named and imported version snapshots, each
      // holding a full solved loadout, so this limit is reachable in a way it was
      // not before. The refusal was already visible (#528); it was not actionable,
      // and a player told only "too large" cannot tell which of their saves to
      // thin. Named to the one thing that grows without bound, and only for a
      // backup — a portable file is a single build and can never hit this.
      const hint = noun === "Backup"
        ? " If you have many named version snapshots, delete some under Your data and export again."
        : "";
      return { ok: false, error: "oversized",
               message: `${noun} file is too large to import.${hint}` };
    }
    try {
      return { ok: true, data: JSON.parse(text, safeReviver) };
    } catch (e) {
      return { ok: false, error: "invalid", message: `This file is not valid ${noun.toLowerCase()} JSON.` };
    }
  }

  function parseBackup(text, opts) {
    const o = opts || {};
    const current = o.current != null ? o.current : CURRENT_SCHEMA;
    const window = o.window != null ? o.window : WINDOW;
    const maxChars = o.maxChars != null ? o.maxChars : MAX_CHARS;

    const read = readFile(text, maxChars, "Backup");
    if (!read.ok) return read;
    const data = read.data;
    if (!data || typeof data !== "object"
        || typeof data.schema_version !== "number"
        || !data.characters || typeof data.characters !== "object") {
      return { ok: false, error: "invalid", message: "This file is not a recognized backup." };
    }

    const v = data.schema_version;
    const oldest = current - (window - 1);
    if (v > current) {
      return { ok: false, error: "newer", message: "This backup was made by a newer version of the app." };
    }
    if (v < oldest) {
      return { ok: false, error: "too-old", message: "This backup is too old to import; export again from a newer build." };
    }

    // #420 — check once, up front, so the refusal names the real reason rather
    // than reporting every character as malformed.
    if (!inputKeys()) {
      return { ok: false, error: "no-allowlist",
        message: "The app could not read its saved-input list, so nothing was imported." };
    }

    const migrated = migrate(data, v, current, o.migrations || MIGRATIONS);
    const clean = Object.create(null);
    for (const name of Object.keys(migrated.characters)) {
      if (isPollutionKey(name)) continue;   // never a real character key
      const c = sanitizeCharacter(migrated.characters[name]);
      if (!c) {
        return { ok: false, error: "invalid", message: "This backup contains a malformed character; nothing was imported." };
      }
      clean[name] = c;
    }
    // The new payload is sanitized through the stores that own each shape rather
    // than trusted from the file: a hand-edited backup can carry anything, and
    // these two are the newest and least-guarded surfaces in it.
    const SB = _savedBundles();
    const bundles = SB
      ? (Array.isArray(migrated.bundles) ? migrated.bundles : [])
        .filter((b) => b && typeof b === "object" && b.id)
        .map((b) => SB.makeBundle(b))
      : [];
    const farming = Object.create(null);
    const rawFarm = (migrated.farming && typeof migrated.farming === "object") ? migrated.farming : {};
    for (const key of Object.keys(rawFarm)) {
      if (isPollutionKey(key)) continue;
      const one = rawFarm[key];
      if (!one || typeof one !== "object") continue;
      const acquired = Object.create(null);
      for (const item of Object.keys(one)) if (one[item]) acquired[item] = true;
      farming[key] = acquired;
    }
    // #530 — sanitized through `versions.js` and re-filtered to the authored
    // kinds. Re-filtering on the way IN as well as on the way out is deliberate:
    // the file is editable, and an `auto` smuggled into the payload would restore
    // as history the player never asked for, into the one store with a known
    // growth problem. `makeVersion` also normalizes an unknown `kind` to `auto`,
    // so a made-up kind is dropped here rather than silently protected from the
    // reclaim ladder forever.
    const V = _versions();
    const versions = V
      ? (Array.isArray(migrated.versions) ? migrated.versions : [])
        .filter((r) => r && typeof r === "object" && r.id)
        .map((r) => V.makeVersion(r))
        .filter((r) => V.isAuthoredKind(r))
      : [];
    return { ok: true, characters: clean, bundles, farming, versions,
             schemaVersion: current };
  }

  /** #190 — read the portable single-build envelope.
   *
   *  The export has been write-only since it shipped: `toPortableJSON` stamps
   *  `format: "ddo-loadout/v1"` so a reader could tell it apart, and no reader was
   *  ever written. A player could hand the file to someone else and neither of them
   *  could load it, so the round trip the versioned format exists to enable never
   *  closed. This closes it.
   *
   *  Reads `core` ONLY. `resolved` is `project(core)` — derived, and re-derived on
   *  render from whatever dataset the reader has. Trusting the sender's copy would
   *  install a stale rendering of a build against a newer catalog, which is the
   *  same solve-visible-but-share-invisible failure in reverse: the file would say
   *  one thing and a re-solve another, with nothing to say which was current.
   *
   *  `core` is sanitized through `sanitizeCharacter`, the same gate a backup's
   *  characters pass — it IS a saved record, so it gets the record's own scrubbing
   *  and the input allowlist rather than being trusted because it arrived alone.
   */
  function parsePortable(text, opts) {
    const o = opts || {};
    const current = o.portableCurrent != null ? o.portableCurrent : PORTABLE_SCHEMA;
    const window = o.portableWindow != null ? o.portableWindow : PORTABLE_WINDOW;
    const maxChars = o.maxChars != null ? o.maxChars : MAX_CHARS;

    const read = readFile(text, maxChars, "Loadout");
    if (!read.ok) return read;
    const data = read.data;

    if (!data || typeof data !== "object" || data.format !== PORTABLE_FORMAT) {
      return { ok: false, error: "invalid", message: "This file is not a shared loadout." };
    }
    if (typeof data.schema_version !== "number") {
      return { ok: false, error: "invalid", message: "This shared loadout has no version and cannot be read." };
    }
    const v = data.schema_version;
    if (v > current) {
      return { ok: false, error: "newer", message: "This loadout was exported by a newer version of the app." };
    }
    if (v < current - (window - 1)) {
      return { ok: false, error: "too-old", message: "This loadout is too old to import; export it again from a newer build." };
    }
    if (!inputKeys()) {
      return { ok: false, error: "no-allowlist",
        message: "The app could not read its saved-input list, so nothing was imported." };
    }
    const character = sanitizeCharacter(data.core);
    if (!character) {
      return { ok: false, error: "invalid", message: "This shared loadout carries no readable build." };
    }
    return { ok: true, kind: "portable", character, name: character.name,
             exportedAt: typeof data.exported_at === "string" ? data.exported_at : null,
             appBuildId: data.app_build_id || null };
  }

  /** #190 — one entry point for "the player picked a .json file".
   *
   *  A player handed a file should not have to know which kind it is, and does not
   *  have to: `format` distinguishes them, which is what it was added for. Anything
   *  without it is read as a backup, so the existing message for a wrong file is
   *  unchanged rather than replaced by a vaguer one about two formats.
   */
  function parseAny(text, opts) {
    const maxChars = (opts && opts.maxChars != null) ? opts.maxChars : MAX_CHARS;
    const read = readFile(text, maxChars, "Backup");
    if (!read.ok) return read;
    return (read.data && typeof read.data === "object" && read.data.format === PORTABLE_FORMAT)
      ? parsePortable(text, opts)
      : parseBackup(text, opts);
  }

  /** A name that does not collide with one already saved, for #190's import.
   *
   *  The store has NO stable build id — `persist.js` keys by name and says so — so
   *  an incoming build named "Caster" is indistinguishable from your own "Caster".
   *  Overwriting is therefore not an option a portable import may take: the file
   *  usually came from somebody else, and the collision is likely to be two
   *  different builds sharing an obvious name rather than the same build returning.
   *
   *  So it never overwrites. It renames, and the caller reports the rename — a
   *  silent one would leave the player looking for a name that is not there.
   *  Case-insensitive, matching every other name comparison in the app.
   */
  function uniqueName(desired, taken) {
    const base = String(desired == null ? "" : desired).trim() || "Imported build";
    const have = new Set((taken || []).map((n) => String(n).trim().toLowerCase()));
    if (!have.has(base.toLowerCase())) return base;
    const withSuffix = `${base} (imported)`;
    if (!have.has(withSuffix.toLowerCase())) return withSuffix;
    for (let i = 2; i < 1000; i++) {
      const n = `${base} (imported ${i})`;
      if (!have.has(n.toLowerCase())) return n;
    }
    return `${base} (imported ${Date.now()})`;
  }

  // Per-name merge (default): colliding names update, new names add, others stay.
  // "replace" wipes existing and installs only the incoming set.
  function mergeInto(existing, incoming, mode) {
    if (mode === "replace") return Object.assign(Object.create(null), incoming);
    const out = Object.assign(Object.create(null), existing || {});
    for (const name of Object.keys(incoming || {})) out[name] = incoming[name];
    return out;
  }

  const api = {
    CURRENT_SCHEMA, WINDOW, MAX_CHARS, MIGRATIONS,
    PORTABLE_FORMAT, PORTABLE_SCHEMA, PORTABLE_WINDOW,
    parsePortable, parseAny, uniqueName,
    serializeAll, parseBackup, mergeInto, migrate, sanitizeCharacter,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.BackupIO = api;
})();
