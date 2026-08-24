// Farming list (#501). Turns a solved loadout into the question the optimizer
// leaves unanswered: *where do I actually go to get this?* The app names
// thirteen items and the crafts to apply to them, then leaves the player to
// look each one up by hand.
//
// Pure logic, dual-exported for Node tests. Namespaced global `FarmingList` to
// avoid the single-global-scope collision trap (every web/*.js shares one scope).
(function () {
  "use strict";

  const PROGRESS_KEY = "ddo.farming.v1";

  const _Proj = (typeof Projection !== "undefined") ? Projection
    // eslint-disable-next-line global-require
    : (typeof require !== "undefined" ? require("./projection.js") : null);

  // What the dataset records about where a thing comes from, and — just as
  // importantly — what it does not.
  //
  //   * GEAR carries `location_quest`, a single free-text string naming a quest,
  //     a raid, an NPC vendor, a crafting station, a seasonal event, the DDO
  //     Store, or occasionally something that is not a place at all
  //     ("Advance to level 15"). 7,836 of 8,047 gear variants have one; 211 do
  //     not. Those 211 are a visible group here, never a silent omission.
  //
  //   * AUGMENTS carry NOTHING. Not a sparse field — zero of 1,063 augment
  //     records have any acquisition data at all. So this list can tell a player
  //     which augment to slot and must not pretend to tell them where to find it.
  //
  //   * ADVENTURE PACK is not in the dataset in any form, and is not upstream in
  //     gear-planner either. Pack-first grouping is the intended shape (it is
  //     the first question a player asks — do I even own this?), and it waits on
  //     the curated mapping in #495. Until then this groups by the source name
  //     the wiki records, verbatim, and says outright that the pack is unknown.
  //     Nothing here guesses a pack from a quest name.
  const NO_SOURCE = null;

  /** Every equipped item, with its recorded source and how many copies the build
   *  wears. Copies matter: a build wearing two of the same ring needs two, and a
   *  farming list that says "1" has told the player to stop too early. */
  function equippedEntries(snapshot) {
    const out = new Map();
    for (const c of (snapshot && snapshot.chosen) || []) {
      const v = c.variant || {};
      const id = v.variant_id;
      if (!id) continue;
      const prev = out.get(id);
      if (prev) { prev.copies += 1; prev.slots.push(c.slot); continue; }
      out.set(id, {
        item: id,
        slots: [c.slot],
        copies: 1,
        ml: v.minimum_level ?? v.ml ?? null,
        source: v.location_quest || NO_SOURCE,
        wikiUrl: v.wiki_url || null,
        // #262 — an item the wiki records no live source for. It is still a
        // solver candidate, and a farming list that silently lists it as
        // something to go and get would be the worst possible place to omit that.
        noDropSource: !!v.no_drop_source,
      });
    }
    return [...out.values()];
  }

  /** The augments and craft steps the build prescribes, per host item. Read
   *  through `Proj.project` — the ONE content model every export renders from —
   *  so a craft is described here in the same words the Share tab prints. */
  function prescriptions(rec) {
    const augments = [], crafts = [];
    if (!_Proj || typeof _Proj.project !== "function") return { augments, crafts };
    const view = _Proj.project({ name: rec.name, inputs: rec.inputs || {}, snapshot: rec.snapshot || {} });
    for (const row of (view.loadout) || []) {
      for (const a of row.augments || []) {
        augments.push({ host: row.item, name: a.name || a.item || a.variant_id || "?", color: a.color || null });
      }
      for (const c of row.crafting || []) {
        crafts.push({ host: row.item, label: c.label || String(c.family || ""), family: c.family || null });
      }
    }
    return { augments, crafts };
  }

  /** The plan.
   *
   *  `sources` are ordered by how many of YOUR items each one yields, biggest
   *  first — that ordering is the whole point of grouping. "These three items
   *  all drop in Gianthold Tor" turns thirteen lookups into one run, and it is
   *  the only thing this list can tell a player that the Loadout tab cannot. */
  function farmingPlan(rec) {
    const snapshot = (rec && rec.snapshot) || {};
    const entries = equippedEntries(snapshot);
    const bySource = new Map();
    const unsourced = [];
    for (const e of entries) {
      if (!e.source) { unsourced.push(e); continue; }
      if (!bySource.has(e.source)) bySource.set(e.source, []);
      bySource.get(e.source).push(e);
    }
    const sources = [...bySource.entries()]
      .map(([name, items]) => ({
        name,
        // Explicitly null rather than absent: the farming view renders the gap
        // as a stated fact, and an absent key would let it render as nothing.
        adventurePack: NO_SOURCE,
        items: items.slice().sort((a, b) => a.item.localeCompare(b.item)),
        itemCount: items.reduce((n, i) => n + i.copies, 0),
      }))
      .sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name));
    unsourced.sort((a, b) => a.item.localeCompare(b.item));

    const { augments, crafts } = prescriptions(rec || {});
    return {
      sources,
      unsourced,
      augments,
      crafts,
      counts: {
        items: entries.reduce((n, e) => n + e.copies, 0),
        distinctItems: entries.length,
        sources: sources.length,
        unsourced: unsourced.length,
        augments: augments.length,
        crafts: crafts.length,
      },
    };
  }

  // ---- progress ------------------------------------------------------------
  //
  // Ticked-off items, per character. Keyed by character name because the list is
  // about one character's gearing; a second character farming the same item has
  // not got it just because the first did.

  function resolveStorage(storage) {
    if (storage) return storage;
    if (typeof localStorage !== "undefined") return localStorage;
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
    return null;
  }

  function readProgress(storage) {
    const st = resolveStorage(storage);
    if (!st) return {};
    let raw = null;
    try { raw = st.getItem(PROGRESS_KEY); } catch (e) { return {}; }
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) { return {}; }
  }

  /** The acquired set for one character, as a plain object of `item -> true`. */
  function loadProgress(character, storage) {
    const all = readProgress(storage);
    const one = all[String(character || "")];
    return (one && typeof one === "object") ? one : {};
  }

  /** Toggle one item. Returns the character's new acquired map, and whether the
   *  write landed — a failed write must not leave a ticked box on screen
   *  claiming a state that was never stored. */
  function toggleAcquired(character, item, storage) {
    const key = String(character || "");
    const all = readProgress(storage);
    const one = Object.assign({}, all[key] || {});
    if (one[item]) delete one[item]; else one[item] = true;
    all[key] = one;
    const st = resolveStorage(storage);
    if (!st) return { ok: false, acquired: one };
    try {
      st.setItem(PROGRESS_KEY, JSON.stringify(all));
      return { ok: true, acquired: one };
    } catch (e) {
      return { ok: false, acquired: loadProgress(key, storage) };
    }
  }

  // ---- text export ---------------------------------------------------------

  /** The list as plain Markdown, for a forum post or a second monitor. Carries
   *  the same disclosures the on-screen list does: a farming list that drops the
   *  "no known source" flag or the unknown-pack caveat on its way out would let
   *  a player go hunting for something the wiki records no source for. */
  function farmingMarkdown(plan, opts) {
    const o = opts || {};
    const lines = [];
    lines.push(`# Farming list${o.character ? ` — ${o.character}` : ""}`);
    lines.push("");
    lines.push(`${plan.counts.items} items across ${plan.counts.sources} source${plan.counts.sources === 1 ? "" : "s"}.`);
    lines.push("");
    lines.push("> Adventure pack is not recorded in the dataset yet, so sources are listed by the name the DDO wiki gives them.");
    lines.push("");
    for (const s of plan.sources) {
      lines.push(`## ${s.name}`);
      for (const i of s.items) {
        lines.push(`- ${i.item}${i.copies > 1 ? ` ×${i.copies}` : ""} — ${i.slots.join(", ")}${i.ml != null ? ` (ML ${i.ml})` : ""}`
          // The ONE shared wording (projection.js), never a per-surface respelling.
          // It matters more on THIS surface than anywhere else in the app: this is
          // the list that sends a player out to hunt for the thing.
          + (i.noDropSource ? ` — **${(_Proj && _Proj.NO_DROP_SOURCE_WORDING) || ""}**` : ""));
      }
      lines.push("");
    }
    if (plan.unsourced.length) {
      lines.push("## Source not recorded");
      lines.push("");
      lines.push("The dataset has no location for these. That is a gap in the data, not a claim that they cannot be found.");
      for (const i of plan.unsourced) {
        lines.push(`- ${i.item}${i.copies > 1 ? ` ×${i.copies}` : ""} — ${i.slots.join(", ")}`);
      }
      lines.push("");
    }
    if (plan.augments.length) {
      lines.push("## Augments to slot");
      lines.push("");
      lines.push("No augment in the dataset carries acquisition data, so this says which to slot and where it goes — not where to get it.");
      for (const a of plan.augments) lines.push(`- ${a.name} → ${a.host}`);
      lines.push("");
    }
    if (plan.crafts.length) {
      lines.push("## Crafting steps");
      lines.push("");
      for (const c of plan.crafts) lines.push(`- ${c.host}: ${c.label}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  const api = {
    PROGRESS_KEY, farmingPlan, equippedEntries, prescriptions,
    loadProgress, toggleAcquired, readProgress, farmingMarkdown,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.FarmingList = api;
})();
