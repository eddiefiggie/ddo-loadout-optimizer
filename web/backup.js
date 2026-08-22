// Versioned backup of all saved characters (U5). Round-trips the character
// store through a single JSON file under a backward-compatibility contract:
// migrate any file within the last 3 schema versions, refuse older or
// newer-than-app files, and refuse structurally-invalid, oversized, or
// prototype-polluting payloads — always a full refusal, never a partial import.
// Pure, dual-exported for Node tests. Namespaced global `BackupIO`.
(function () {
  "use strict";

  const CURRENT_SCHEMA = 1;   // v1 baseline — the window holds only v1 today
  const WINDOW = 3;           // migrate the last 3 schema versions up to current
  const MAX_CHARS = 5000000;  // ~5MB, matched to the localStorage budget

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

  function serializeAll(characters, opts) {
    const o = opts || {};
    return {
      schema_version: CURRENT_SCHEMA,
      exported_at: new Date().toISOString(),
      app_build_id: o.buildId || null,
      characters: characters || {},
    };
  }

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
  function parseBackup(text, opts) {
    const o = opts || {};
    const current = o.current != null ? o.current : CURRENT_SCHEMA;
    const window = o.window != null ? o.window : WINDOW;
    const maxChars = o.maxChars != null ? o.maxChars : MAX_CHARS;

    if (typeof text !== "string" || text.length > maxChars) {
      return { ok: false, error: "oversized", message: "Backup file is too large to import." };
    }

    let data;
    try {
      data = JSON.parse(text, safeReviver);
    } catch (e) {
      return { ok: false, error: "invalid", message: "This file is not valid backup JSON." };
    }
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

    const migrated = migrate(data, v, current, o.migrations);
    const clean = Object.create(null);
    for (const name of Object.keys(migrated.characters)) {
      if (isPollutionKey(name)) continue;   // never a real character key
      const c = sanitizeCharacter(migrated.characters[name]);
      if (!c) {
        return { ok: false, error: "invalid", message: "This backup contains a malformed character; nothing was imported." };
      }
      clean[name] = c;
    }
    return { ok: true, characters: clean, schemaVersion: current };
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
    CURRENT_SCHEMA, WINDOW, MAX_CHARS,
    serializeAll, parseBackup, mergeInto, migrate, sanitizeCharacter,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.BackupIO = api;
})();
