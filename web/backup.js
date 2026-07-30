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

  const POLLUTION_KEYS = { __proto__: true, constructor: true, prototype: true };

  // Reviver drops prototype-pollution keys at every nesting level during parse,
  // so a hostile backup can never reach Object.prototype (defense in depth
  // alongside the field allowlist below).
  function safeReviver(key, value) {
    if (Object.prototype.hasOwnProperty.call(POLLUTION_KEYS, key)) return undefined;
    return value;
  }

  const INPUT_KEYS = [
    "characterName", "ml", "race", "alignment", "armor", "weapon",
    "includeArtifact", "pool", "ownedNames", "priorities", "slotConstraints",
  ];

  // Rebuild a character from an allowlist of known fields so no unexpected key
  // (including a pollution key that slipped a reviver) rides along. The snapshot
  // and query are app-produced data already cleaned by the reviver.
  function sanitizeCharacter(raw) {
    if (!raw || typeof raw !== "object") return null;
    const inputs = {};
    const rawInputs = (raw.inputs && typeof raw.inputs === "object") ? raw.inputs : {};
    for (const k of INPUT_KEYS) {
      if (rawInputs[k] !== undefined) inputs[k] = rawInputs[k];
    }
    return {
      name: String(raw.name),
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : null,
      inputs,
      query: raw.query || null,
      snapshot: (raw.snapshot && typeof raw.snapshot === "object") ? raw.snapshot : {},
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

    const migrated = migrate(data, v, current, o.migrations);
    const clean = {};
    for (const name of Object.keys(migrated.characters)) {
      const c = sanitizeCharacter(migrated.characters[name]);
      if (c) clean[name] = c;
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
