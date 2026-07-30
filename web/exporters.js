// Single-loadout share exporters (U12): a forum-ready Markdown file and a clean
// CSV, both headed with the character name and constraints. The CSV neutralizes
// spreadsheet formula injection. Pure, dual-exported for Node tests. Namespaced
// global `LoadoutExport`.
(function () {
  "use strict";

  // Compact "Stat +Value[%][ Type]" affix label — mirrors results.js affixLabel
  // (kept inline so this module stays self-contained and Node-testable).
  function fmtAffix(a) {
    if (!a) return "";
    if (a.bonus_type === "boolean") return "✓ " + a.stat;
    const type = a.bonus_type && a.bonus_type !== "Enhancement" ? " " + a.bonus_type : "";
    return `${a.stat} +${a.value}${a.unit === "pct" ? "%" : ""}${type}`;
  }

  const ARMOR = { cloth: "Cloth", light: "Light", medium: "Medium", heavy: "Heavy" };
  const WEAPON = { "2h": "Two-handed", swordboard: "One-hand + shield", twf: "Dual-wield", runearm: "One-hand + rune arm" };
  const POOL = { all: "All gear", owned: "Only what I own" };

  // Name + character constraints, the shared header for both exports.
  function constraintPairs(rec) {
    const i = (rec && rec.inputs) || {};
    return [
      ["Character", rec && rec.name],
      ["ML", i.ml == null ? "" : String(i.ml)],
      ["Race", i.race || ""],
      ["Alignment", i.alignment || ""],
      ["Armor", i.armor ? (ARMOR[i.armor] || i.armor) : ""],
      ["Weapon", i.weapon ? (WEAPON[i.weapon] || i.weapon) : ""],
      ["Gear pool", POOL[i.pool] || i.pool || "all"],
      ["Priorities", (i.priorities || []).join(" > ")],
    ].filter(([, v]) => v !== "" && v != null);
  }

  function constraintLines(rec) {
    return constraintPairs(rec).map(([k, v]) => `${k}: ${v}`);
  }

  function mdEsc(s) {
    // Escape HTML (blocks raw <script>/<img>) AND markdown link/emphasis
    // metacharacters, so a name from an imported backup can't inject a live
    // link or formatting into the shared post.
    return String(s == null ? "" : s)
      .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))
      .replace(/[\\[\]()!*_`|]/g, "\\$&");
  }

  function loadoutRows(rec) {
    return ((rec && rec.snapshot && rec.snapshot.chosen) || []).map((c) => {
      const v = c.variant || {};
      return {
        slot: c.slot,
        item: v.variant_id,
        ml: v.minimum_level == null ? "" : v.minimum_level,
        stats: (v.affixes || []).map(fmtAffix).filter(Boolean),
        augs: (v.augment_slots_norm && v.augment_slots_norm.colors) || v.augment_slots || [],
      };
    });
  }

  function toMarkdown(rec) {
    const pairs = constraintPairs(rec);
    let out = `# ${mdEsc(rec && rec.name)}\n\n`;
    out += `_Optimal loadout — built with the DDO Loadout Optimizer._\n\n`;
    out += pairs.slice(1).map(([k, v]) => `**${k}:** ${mdEsc(v)}`).join("  \n") + "\n\n";
    out += `## Loadout\n\n`;
    for (const r of loadoutRows(rec)) {
      out += `- **${mdEsc(r.slot)}** — ${mdEsc(r.item)} (ML ${mdEsc(r.ml || "?")})\n`;
      if (r.stats.length) out += `  - ${r.stats.map(mdEsc).join(", ")}\n`;
      if (r.augs.length) out += `  - Augment slots: ${r.augs.map(mdEsc).join(", ")}\n`;
    }
    const sets = (rec && rec.snapshot && rec.snapshot.setsActive) || [];
    if (sets.length) {
      out += `\n## Set bonuses\n\n`;
      for (const s of sets) out += `- ${mdEsc(typeof s === "string" ? s : (s.set || s.name || ""))}\n`;
    }
    return out;
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

  function toCsv(rec) {
    const rows = [];
    for (const [k, v] of constraintPairs(rec)) rows.push(csvRow([k, v]));
    rows.push("");
    rows.push(csvRow(["Slot", "Item", "ML", "Stats", "Augment slots"]));
    for (const r of loadoutRows(rec)) {
      rows.push(csvRow([r.slot, r.item, r.ml, r.stats.join("; "), r.augs.join(" | ")]));
    }
    return rows.join("\n");
  }

  function htmlEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Print-friendly loadout fragment (name + constraints + table). Escaped HTML;
  // injected into a print container by U13, then window.print().
  function toPrintHtml(rec) {
    const pairs = constraintPairs(rec);
    const rows = loadoutRows(rec);
    let h = `<h1>${htmlEsc(rec && rec.name)}</h1>`;
    h += `<p class="pc">${pairs.slice(1).map(([k, v]) => `<strong>${htmlEsc(k)}:</strong> ${htmlEsc(v)}`).join(" &middot; ")}</p>`;
    h += `<table><thead><tr><th>Slot</th><th>Item</th><th>ML</th><th>Stats</th><th>Augment slots</th></tr></thead><tbody>`;
    for (const r of rows) {
      h += `<tr><td>${htmlEsc(r.slot)}</td><td>${htmlEsc(r.item)}</td><td>${htmlEsc(r.ml)}</td>`
        + `<td>${r.stats.map(htmlEsc).join(", ")}</td><td>${r.augs.map(htmlEsc).join(", ")}</td></tr>`;
    }
    h += `</tbody></table>`;
    return h;
  }

  const api = { toMarkdown, toCsv, toPrintHtml, csvSafe, csvRow, htmlEsc, constraintPairs, constraintLines, fmtAffix };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.LoadoutExport = api;
})();
