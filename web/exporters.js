// Single-loadout share exporters. Four presentation formats (forum-ready Markdown
// and BBCode, a spreadsheet CSV, a print-friendly HTML fragment) plus a portable
// JSON envelope, all rendered from ONE shared content model — `Projection.project(rec)`
// — so their content never drifts (U4). Each item shows its worn affixes, assigned
// augments (with color + Lunar/Solar cues), and crafting upgrades; every build lists
// its completed set bonuses and a priority-stat attribution section. The portable JSON
// (U5) carries the proven save-snapshot `core` verbatim plus the resolved view, so it
// can be re-imported later. User-derived text stays escaped/neutralized per format
// (formula-injection for CSV, tag-stripping for BBCode, entity-escaping for MD/HTML).
// Pure, dual-exported for Node tests. Namespaced global `LoadoutExport`.
(function () {
  "use strict";

  // The shared content projection (loaded before exporters.js in the browser;
  // require()'d in Node tests). Sole source of the resolved content model.
  const Proj = (typeof Projection !== "undefined") ? Projection
    : (typeof require !== "undefined" ? require("./projection.js") : null);

  // Affix label + character-constraint helpers now live in projection.js (single
  // definition). Kept here as named delegates so the public API and the Node tests
  // that reference them keep resolving.
  const fmtAffix = Proj.affixLabel;
  const constraintPairs = Proj.constraintPairs;
  const constraintLines = Proj.constraintLines;

  // ---- escapers (one per format, each self-contained) ----

  function mdEsc(s) {
    // Escape HTML (blocks raw <script>/<img>) AND markdown link/emphasis
    // metacharacters, so a name from an imported backup can't inject a live
    // link or formatting into the shared post.
    return String(s == null ? "" : s)
      .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))
      .replace(/[\\[\]()!*_`|]/g, "\\$&");
  }

  // Prefix a leading formula trigger so a spreadsheet treats the cell as text,
  // then apply RFC-4180 quoting for commas/quotes/newlines.
  function csvSafe(field) {
    let s = field == null ? "" : String(field);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csvRow(cells) { return cells.map(csvSafe).join(","); }

  function htmlEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Escape BBCode metacharacters in user-derived text so a name from an imported
  // backup can't inject forum tags. Brackets are stripped (BBCode has no portable
  // escape for a literal '['), which is safe for item/affix/character names.
  function bbEsc(s) { return String(s == null ? "" : s).replace(/[[\]]/g, ""); }

  // ---- visual-cue vocabulary (U3): emoji + word, one legend per document ----

  // [emoji, word] per cue key. Content is identical across formats; only BBCode
  // additionally wraps a color word in a real [color] tag (see cue()).
  const CUE = {
    color: {
      red: ["🔴", "Red"], yellow: ["🟡", "Yellow"], blue: ["🔵", "Blue"],
      green: ["🟢", "Green"], orange: ["🟠", "Orange"], purple: ["🟣", "Purple"],
      colorless: ["⚪", "Colorless"], clear: ["⚪", "Colorless"],
    },
    moon: { Lunar: ["🌙", "Lunar"], Solar: ["☀️", "Solar"] },
    craft: {
      dino: ["🦴", "Dino Bone"], nc: ["✨", "Nearly Completed"], roll: ["🎲", "Choice"],
      vik: ["⚗️", "Viktranium"], seal: ["🔮", "Sealed"], tf: ["⚡", "Thunder-Forged"],
      gs: ["💠", "Green Steel"], joker: ["🃏", "Wildcard set"], membership: ["🔗", "Set craft"],
    },
  };
  // BBCode named colors for the augment-color words (real color, per KTD5).
  const BB_COLOR = {
    red: "red", yellow: "olive", blue: "blue", green: "green",
    orange: "orange", purple: "purple", colorless: "gray", clear: "gray",
  };

  function cueParts(kind, key) {
    const map = CUE[kind] || {};
    return map[key] || map[String(key).toLowerCase()] || null;
  }
  // A rendered cue: "🔴 Red" (text formats) or "🔴 [color=red]Red[/color]" (BBCode,
  // color kind only). Cue markup is trusted (never escaped); callers escape the
  // user-derived text around it.
  function cue(kind, key, fmt) {
    const p = cueParts(kind, key);
    if (!p) return "";
    const emoji = p[0], word = p[1];
    if (fmt === "bb" && kind === "color" && BB_COLOR[String(key).toLowerCase()]) {
      return `${emoji} [color=${BB_COLOR[String(key).toLowerCase()]}]${word}[/color]`;
    }
    return `${emoji} ${word}`;
  }

  // The one-time cue legend. `wrap` styles the whole line per format.
  function legendText(fmt) {
    const colors = ["red", "yellow", "blue", "green", "orange", "purple", "colorless"]
      .map((k) => cue("color", k, fmt)).join("  ");
    const moon = ["Lunar", "Solar"].map((k) => cue("moon", k, fmt)).join("  ");
    const craft = ["dino", "nc", "roll", "vik", "seal", "tf", "gs", "joker", "membership"]
      .map((k) => cue("craft", k, fmt)).join("  ");
    return `Legend — augment slots: ${colors} · ${moon} · crafting: ${craft}`;
  }

  // ---- per-format content helpers (operate on the resolved view; escape user text) ----

  function affixList(affixes, esc) {
    return (affixes || []).map((a) => esc(fmtAffix(a))).filter(Boolean).join(", ");
  }

  // One placed augment: color cue [· Lunar/Solar cue]: name [— granted affixes].
  function augStr(aug, esc, fmt) {
    const head = [];
    const c = cue("color", aug.slotColor || aug.color, fmt);
    if (c) head.push(c);
    if (aug.lunarSolar) { const m = cue("moon", aug.lunarSolar, fmt); if (m) head.push(m); }
    const lead = head.join(" · ");
    const eff = affixList(aug.affixes, esc);
    return `${lead ? lead + ": " : ""}${esc(aug.name)}${eff ? " — " + eff : ""}`;
  }

  // One crafting upgrade: craft-family cue: label.
  function craftStr(cr, esc, fmt) {
    const c = cue("craft", cr.family, fmt);
    return `${c ? c + ": " : ""}${esc(cr.label)}`;
  }

  // One attribution source line: "Type +Value — Source [ (set)] [ via slots]".
  function sourceStr(p, esc) {
    const isBool = p.bonusType === "boolean";
    const type = isBool ? "feature" : esc(p.bonusType);
    const val = isBool ? "✓" : "+" + esc(p.value);
    const slots = (p.slots && p.slots.length) ? ` via ${p.slots.map(esc).join(", ")}` : "";
    const tag = p.viaSet ? " (set)" : "";
    // U3 (R8) — a declared credit carries its own label and no slot, so a shared
    // loadout shows which numbers the recipient's own gear produces and which one
    // the sender asserted. The label comes from the solver, so the app and every
    // export format cannot drift apart.
    return `${type} ${val} — ${esc(p.source)}${tag}${slots}`;
  }

  // The cap note for a priority stat, matching results.js: shown only when a cap is
  // set AND the raw contribution sum exceeds the achieved total (i.e. it clamped).
  function capNote(a, esc) {
    const raw = a.sources.reduce((s, p) => s + (p.value || 0), 0);
    return (a.cap != null && raw > a.total) ? ` (capped at ${esc(a.total)} · raw ${esc(raw)})` : "";
  }

  // ---- Markdown ----

  function toMarkdown(rec) {
    const view = Proj.project(rec);
    let out = `# ${mdEsc(view.character.name)}\n\n`;
    out += `_Optimal loadout — built with the DDO Loadout Optimizer._\n\n`;
    // U4 (R9) — the qualifier must ride with the claim it qualifies. A shared build
    // asserting an optimal loadout, with a player-typed number folded into its
    // totals and no statement that it was unverified, is exactly the
    // solve-visible-but-share-invisible failure this repo forbids.
    for (const line of view.character.creditNotice || []) out += `> ${mdEsc(line)}\n\n`;
    out += view.character.constraints.filter(([k]) => k !== "Character").map(([k, v]) => `**${mdEsc(k)}:** ${mdEsc(v)}`).join("  \n") + "\n\n";
    out += `_${mdEsc(legendText("md"))}_\n\n`;
    out += `## Loadout\n\n`;
    for (const it of view.loadout) {
      out += `- **${mdEsc(it.slot)}** — ${mdEsc(it.item)} (ML ${mdEsc(it.ml == null ? "?" : it.ml)})\n`;
      const aff = affixList(it.affixes, mdEsc);
      if (aff) out += `  - ${aff}\n`;
      for (const aug of it.augments) out += `  - ${augStr(aug, mdEsc, "md")}\n`;
      for (const cr of it.crafting) out += `  - ${craftStr(cr, mdEsc, "md")}\n`;
    }
    if (view.sets.length) {
      out += `\n## Set bonuses\n\n`;
      for (const s of view.sets) {
        out += `- **${mdEsc(s.set)}**${s.pieces ? ` (${mdEsc(s.pieces)} pieces)` : ""}\n`;
        const aff = affixList(s.affixes, mdEsc);
        if (aff) out += `  - ${aff}\n`;
      }
    }
    const stats = Object.keys(view.attribution);
    if (stats.length) {
      out += `\n## Stat breakdown\n\n`;
      for (const stat of stats) {
        const a = view.attribution[stat];
        out += `- **${mdEsc(stat)}** → +${mdEsc(a.total)}${capNote(a, mdEsc)}\n`;
        for (const p of a.sources) out += `  - ${sourceStr(p, mdEsc)}\n`;
      }
    }
    return out;
  }

  // ---- BBCode ----

  function toBBCode(rec) {
    const view = Proj.project(rec);
    let out = `[b]${bbEsc(view.character.name)}[/b]\n`;
    out += `[i]Optimal loadout — built with the DDO Loadout Optimizer.[/i]\n\n`;
    for (const line of view.character.creditNotice || []) out += `[i]${bbEsc(line)}[/i]\n\n`;
    out += view.character.constraints.filter(([k]) => k !== "Character").map(([k, v]) => `[b]${bbEsc(k)}:[/b] ${bbEsc(v)}`).join(" | ") + "\n\n";
    out += `[i]${legendText("bb")}[/i]\n\n`;
    out += `[b]Loadout[/b]\n[list]\n`;
    for (const it of view.loadout) {
      out += `[*][b]${bbEsc(it.slot)}[/b] — ${bbEsc(it.item)} (ML ${bbEsc(it.ml == null ? "?" : it.ml)})`;
      const aff = affixList(it.affixes, bbEsc);
      if (aff) out += `: ${aff}`;
      for (const aug of it.augments) out += `\n  [*]${augStr(aug, bbEsc, "bb")}`;
      for (const cr of it.crafting) out += `\n  [*]${craftStr(cr, bbEsc, "bb")}`;
      out += `\n`;
    }
    out += `[/list]\n`;
    if (view.sets.length) {
      out += `\n[b]Set bonuses[/b]\n[list]\n`;
      for (const s of view.sets) {
        out += `[*][b]${bbEsc(s.set)}[/b]${s.pieces ? ` (${bbEsc(s.pieces)} pieces)` : ""}`;
        const aff = affixList(s.affixes, bbEsc);
        if (aff) out += `: ${aff}`;
        out += `\n`;
      }
      out += `[/list]\n`;
    }
    const stats = Object.keys(view.attribution);
    if (stats.length) {
      out += `\n[b]Stat breakdown[/b]\n[list]\n`;
      for (const stat of stats) {
        const a = view.attribution[stat];
        out += `[*][b]${bbEsc(stat)}[/b] → +${bbEsc(a.total)}${capNote(a, bbEsc)}`;
        for (const p of a.sources) out += `\n  [*]${sourceStr(p, bbEsc)}`;
        out += `\n`;
      }
      out += `[/list]\n`;
    }
    return out;
  }

  // ---- CSV ----

  function toCsv(rec) {
    const view = Proj.project(rec);
    const rows = [];
    for (const [k, v] of view.character.constraints) rows.push(csvRow([k, v]));
    for (const line of view.character.creditNotice || []) rows.push(csvRow(["Declared", line]));
    rows.push("");
    rows.push(csvRow(["Legend", legendText("csv")]));
    rows.push("");
    rows.push(csvRow(["Slot", "Item", "ML", "Affixes", "Augments", "Crafting"]));
    for (const it of view.loadout) {
      rows.push(csvRow([
        it.slot, it.item, it.ml,
        affixListCsv(it.affixes),
        it.augments.map((aug) => augStr(aug, (s) => s, "csv")).join(" | "),
        it.crafting.map((cr) => craftStr(cr, (s) => s, "csv")).join(" | "),
      ]));
    }
    if (view.sets.length) {
      rows.push("");
      rows.push(csvRow(["Set bonus", "Pieces", "Grants"]));
      for (const s of view.sets) rows.push(csvRow([s.set, s.pieces == null ? "" : s.pieces, affixListCsv(s.affixes)]));
    }
    const stats = Object.keys(view.attribution);
    if (stats.length) {
      rows.push("");
      rows.push(csvRow(["Stat", "Total", "Capped", "Sources"]));
      for (const stat of stats) {
        const a = view.attribution[stat];
        const raw = a.sources.reduce((s, p) => s + (p.value || 0), 0);
        const capped = (a.cap != null && raw > a.total) ? `capped at ${a.total} (raw ${raw})` : "";
        rows.push(csvRow([stat, a.total, capped, a.sources.map((p) => sourceStr(p, (s) => s)).join(" | ")]));
      }
    }
    return rows.join("\n");
  }
  // csvSafe quotes the whole cell, so affix separators inside a cell are literal.
  function affixListCsv(affixes) { return (affixes || []).map(fmtAffix).filter(Boolean).join("; "); }

  // ---- print-friendly HTML fragment ----

  function toPrintHtml(rec) {
    const view = Proj.project(rec);
    let h = `<h1>${htmlEsc(view.character.name)}</h1>`;
    h += `<p class="pc">${view.character.constraints.filter(([k]) => k !== "Character").map(([k, v]) => `<strong>${htmlEsc(k)}:</strong> ${htmlEsc(v)}`).join(" &middot; ")}</p>`;
    for (const line of view.character.creditNotice || []) h += `<p class="declared-note"><em>${htmlEsc(line)}</em></p>`;
    h += `<p class="legend">${htmlEsc(legendText("md"))}</p>`;
    h += `<table><thead><tr><th>Slot</th><th>Item</th><th>ML</th><th>Affixes</th><th>Augments</th><th>Crafting</th></tr></thead><tbody>`;
    for (const it of view.loadout) {
      h += `<tr><td>${htmlEsc(it.slot)}</td><td>${htmlEsc(it.item)}</td><td>${htmlEsc(it.ml)}</td>`
        + `<td>${affixList(it.affixes, htmlEsc)}</td>`
        + `<td>${it.augments.map((aug) => augStr(aug, htmlEsc, "md")).join("<br>")}</td>`
        + `<td>${it.crafting.map((cr) => craftStr(cr, htmlEsc, "md")).join("<br>")}</td></tr>`;
    }
    h += `</tbody></table>`;
    if (view.sets.length) {
      h += `<h2>Set bonuses</h2><ul>`;
      for (const s of view.sets) {
        const aff = affixList(s.affixes, htmlEsc);
        h += `<li><strong>${htmlEsc(s.set)}</strong>${s.pieces ? ` (${htmlEsc(s.pieces)} pieces)` : ""}${aff ? ` — ${aff}` : ""}</li>`;
      }
      h += `</ul>`;
    }
    const stats = Object.keys(view.attribution);
    if (stats.length) {
      h += `<h2>Stat breakdown</h2><ul>`;
      for (const stat of stats) {
        const a = view.attribution[stat];
        h += `<li><strong>${htmlEsc(stat)}</strong> → +${htmlEsc(a.total)}${capNote(a, htmlEsc)}<ul>`;
        for (const p of a.sources) h += `<li>${sourceStr(p, htmlEsc)}</li>`;
        h += `</ul></li>`;
      }
      h += `</ul>`;
    }
    return h;
  }

  // ---- portable JSON (U5) ----

  // A versioned, re-importable envelope: the opaque `core` is the verbatim saved
  // record (the shape backup.js already round-trips), and `resolved` is the shared
  // content projection for later compare/diff. `format` carries the identifier so a
  // future import reader can tell a portable loadout from a plain backup file.
  // WRITE-ONCE: `core` aliases the live record and `resolved` shares its affix arrays
  // by reference. The only caller stringifies immediately (safe). The future
  // import/compare effort MUST deep-clone (or treat the envelope as read-only) before
  // retaining or mutating it, or it would edit the user's saved build in place.
  function toPortableJSON(rec, nowIso) {
    return {
      format: "ddo-loadout/v1",
      schema_version: 1,
      exported_at: nowIso || (typeof Date !== "undefined" ? new Date().toISOString() : null),
      app_build_id: (rec && rec.stampedBuildId) || null,
      core: rec,
      resolved: Proj.project(rec),
    };
  }

  // ---- DDOBuilderV2 .gearset (U1-U3) ----

  // App slot -> DDOBuilderV2 file-grammar label, in the order the file emits them.
  // `Ring` appears twice because DDOBuilder names the two ring slots separately;
  // the two chosen Ring rows are consumed in solver order. Slots absent from this
  // table (Quiver, Rune Arm) have no file-grammar label and go to the record block.
  // `Main Hand` MUST render as `Weapon` — the parser tests `Hand:` before
  // `Weapon:`, so emitting the app's own label would file a weapon under Gloves.
  const GEARSET_SLOTS = [
    ["Goggles", "Eye"], ["Helmet", "Head"], ["Necklace", "Neck"], ["Trinket", "Trinket"],
    ["Armor", "Body"], ["Cloak", "Back"], ["Bracers", "Wrist"], ["Belt", "Waist"],
    ["Ring", "Finger1"], ["Boots", "Feet"], ["Gloves", "Hand"], ["Ring", "Finger2"],
    ["Main Hand", "Weapon"], ["Off Hand", "Offhand"],
  ];

  // Collapse any user-derived text to a single physical line. The record block
  // prefixes every line to read as commentary; a value carrying a newline would
  // otherwise split into an unprefixed second line. Today that line still sits
  // below the terminator and is inert, but the invariant is what keeps it inert
  // if the record block ever moves.
  //
  // Deliberately does NOT trim. An item name is compared by DDOBuilder with ==
  // against a catalog built from the same Gear Planner source ours is, so any
  // whitespace a name carries is carried on BOTH sides — trimming ours would turn
  // a match into a miss, which is the exact failure the verbatim-name rule exists
  // to prevent. Trimming also flattened the record block's indentation.
  function gsInline(s) { return String(s == null ? "" : s).replace(/[\r\n]+/g, " "); }

  // One placed augment as a brace entry: bonus type, stat, value, lowercased.
  // DDOBuilder splits on whitespace and requires EVERY token to appear in the
  // candidate augment's description text, placing one augment per entry — so a
  // multi-affix gem gets ONE entry built from its first affix, whose tokens all
  // appear in that gem's single combined description.
  function gearsetAug(aug) {
    const a = (aug.affixes || [])[0];
    if (!a || a.value == null) return "";
    const name = a.name != null ? a.name : a.stat;
    const type = a.type != null ? a.type : a.bonus_type;
    if (!name || !type) return "";
    return `{${String(type).toLowerCase()} ${String(name).toLowerCase()} ${a.value}}`;
  }

  // The importable half plus the record half, split by a single blank line —
  // DDOBuilder's file parser stops at the first empty line, so everything below
  // is invisible to it and fully visible to a reader.
  function toGearset(rec) {
    const view = Proj.project(rec);
    const inputs = (rec && rec.inputs) || {};

    // Group chosen items by app slot so the two Ring rows can be consumed in order.
    const bySlot = new Map();
    for (const it of view.loadout) {
      if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
      bySlot.get(it.slot).push(it);
    }
    const gear = [];
    const placed = new Set();
    for (const [appSlot, label] of GEARSET_SLOTS) {
      const row = (bySlot.get(appSlot) || []).shift();
      if (!row) continue;                       // slot left empty -> no line at all
      placed.add(row);
      const augs = (row.augments || []).map(gearsetAug).filter(Boolean).join("");
      gear.push(`${label}:${gsInline(row.item)}${augs}`);
    }
    const unmapped = view.loadout.filter((it) => !placed.has(it));

    // ---- the record block: commentary only, never parsed ----
    const rl = [];
    // Right-trim only, so intentional leading indentation survives.
    const say = (s) => rl.push(`# ${gsInline(s)}`.replace(/\s+$/, ""));
    say(`${view.character.name} — DDO Loadout Optimizer`);
    say("Everything below this point is ignored by DDOBuilderV2's importer.");
    rl.push("#");
    say("Solve inputs");
    const ml = inputs.ml == null ? null : inputs.ml;
    if (ml != null) say(`  ML ${ml}${inputs.mlFloor == null ? "" : ` (floor ${inputs.mlFloor})`}`);
    for (const [k, v] of view.character.constraints) {
      if (k === "Character" || k === "ML" || k === "Priorities") continue;
      say(`  ${k}: ${v}`);
    }
    for (const [slot, c] of Object.entries(inputs.slotConstraints || {})) {
      if (!c || !c.type) continue;
      const what = c.type === "empty" ? "locked empty"
        : c.type === "pin" ? `pinned to ${[].concat(c.variant || c.variantIds || c.pinnedVariantIds || []).join(", ")}`
          : c.type;
      say(`  ${slot} — ${what}`);
    }

    const priorities = (inputs.priorities || []);
    if (priorities.length) {
      rl.push("#");
      say("Ranked priorities and achieved values");
      priorities.forEach((stat, i) => {
        const a = view.attribution[stat] || {};
        const bounds = [];
        if ((inputs.targetFloors || {})[stat] != null) bounds.push(`min ${inputs.targetFloors[stat]}`);
        if ((inputs.targetCaps || {})[stat] != null) bounds.push(`max ${inputs.targetCaps[stat]}`);
        const cap = (a.cap != null && a.total != null) ? ` (capped at ${a.cap})` : "";
        say(`  ${i + 1}. ${stat}  ${a.total == null ? "-" : a.total}${cap}${bounds.length ? ` [${bounds.join(", ")}]` : ""}`);
      });
    }

    const augLines = [];
    const craftLines = [];
    for (const it of view.loadout) {
      for (const aug of it.augments || []) {
        const eff = affixList(aug.affixes, (s) => s);
        augLines.push(`  ${it.slot} (${it.item}) — ${aug.name}${eff ? `: ${eff}` : ""}`);
      }
      for (const cr of it.crafting || []) craftLines.push(`  ${it.slot} (${it.item}) — ${cr.label}`);
    }
    // Augments are listed here as well as on the gear lines: DDOBuilder matches an
    // augment by scanning its own description text, and our affix vocabulary does
    // not always agree with that prose, so a placement can silently no-op. This
    // listing is what makes an unplaced augment recoverable by hand.
    if (augLines.length) {
      rl.push("#");
      say("Augments (also emitted above; re-enter by hand if one did not import)");
      augLines.forEach(say);
    }
    // Crafting NEVER appears above the split. As a brace entry it would consume a
    // real augment slot and produce a build that differs from the solved one while
    // reporting success.
    if (craftLines.length) {
      rl.push("#");
      say("Crafting (not importable — apply these by hand)");
      craftLines.forEach(say);
    }
    if (unmapped.length) {
      rl.push("#");
      say("Not importable — no DDOBuilderV2 file-grammar slot label");
      for (const it of unmapped) say(`  ${it.slot} (${it.item})`);
    }
    if (view.sets.length) {
      rl.push("#");
      say("Set bonuses active");
      for (const s of view.sets) {
        const eff = affixList(s.affixes, (s2) => s2);
        say(`  ${s.set}${s.pieces ? ` (${s.pieces} pieces)` : ""}${eff ? `: ${eff}` : ""}`);
      }
    }
    return `${gear.join("\n")}\n\n${rl.join("\n")}\n`;
  }

  // ---- back-compat: the active set-bonus summary in the old string-affix shape ----

  function setBonusDetail(rec) {
    return Proj.satisfiedSetDetail((rec && rec.snapshot) || {}).map((s) => ({
      set: s.set, pieces: s.pieces, affixes: (s.affixes || []).map(fmtAffix).filter(Boolean),
    }));
  }

  const api = {
    toMarkdown, toCsv, toPrintHtml, toBBCode, toPortableJSON, toGearset,
    setBonusDetail, csvSafe, csvRow, htmlEsc, bbEsc, mdEsc,
    constraintPairs, constraintLines, fmtAffix, cue, legendText,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.LoadoutExport = api;
})();
