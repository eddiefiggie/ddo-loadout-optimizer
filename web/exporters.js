// Single-loadout share exporters. Four presentation formats (forum-ready Markdown
// and BBCode, a spreadsheet CSV, a print-friendly HTML fragment) plus a portable
// JSON envelope, all rendered from ONE shared content model — `Projection.project(rec)`
// — so their content never drifts (U4). Each item shows its worn affixes, assigned
// augments (with color + Lunar/Solar cues), and crafting upgrades; every build lists
// its completed set bonuses — with the pieces that composed them, wildcard and
// chosen-membership picks included — and a priority-stat attribution section. The portable JSON
// (U5) carries the proven save-snapshot `core` verbatim plus the resolved view, so it
// can be re-imported later. User-derived text stays escaped/neutralized per format
// (formula-injection for CSV, tag-stripping for BBCode, entity-escaping for MD/HTML).
// Pure, dual-exported for Node tests. Namespaced global `LoadoutExport`.
(function () {
  "use strict";


// #353 — the presence predicate from projection.js (one definition app-wide);
// browser-global-first, require() under node.
const _expIsPresenceType = (typeof Projection !== "undefined" && Projection.isPresenceType)
  ? Projection.isPresenceType
  : (typeof require !== "undefined" ? require("./projection.js").isPresenceType : null);
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
      // #193 — without an entry here `craftStr` renders the row bare, so an
      // Essence craft read as an ordinary affix line in every text export while
      // its siblings carried a cue. The legend below lists it for the same reason.
      essence: ["🔧", "Essence Crafting"],
      // #603 — a placed Set Augment used to render bare, because a family with no
      // entry here gets no cue at all. It is the family that needs one most: the
      // augment carries the set, and the host item's own data says nothing about
      // it, so a recipient of a shared build cannot re-derive the placement.
      augmentset: ["🧩", "Set Augment"],
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
    const craft = ["dino", "nc", "roll", "vik", "seal", "tf", "gs", "essence", "joker",
      "membership", "augmentset"]
      .map((k) => cue("craft", k, fmt)).join("  ");
    return `Legend — augment slots: ${colors} · ${moon} · crafting: ${craft}`;
  }

  // ---- per-format content helpers (operate on the resolved view; escape user text) ----

  function affixList(affixes, esc) {
    return (affixes || []).map((a) => esc(fmtAffix(a))).filter(Boolean).join(", ");
  }

  // U5 (R11) — the pieces that composed one set, rendered through projection's
  // SINGLE member label (`Proj.setMemberLabel`) so the Set Bonuses card and all
  // five text formats name a piece identically. A wildcard or chosen-membership
  // pick carries the set in no item data whatsoever, so a format that printed only
  // the set name told a recipient a bonus was active and refused to say what
  // produced it — solve-visible but share-invisible.
  //
  // Only the user-derived item/slot text is escaped; the label's own punctuation is
  // structural and trusted, exactly as cue markup is. Escaping the finished label
  // would turn markdown's "(Trinket)" into a literal "\(Trinket\)".
  function memberList(members, esc) {
    return (members || []).map((m) => Proj.setMemberLabel({
      item: esc(m.item), slot: m.slot == null ? null : esc(m.slot), kind: m.kind,
    })).join(", ");
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

  // One crafting upgrade: craft-family cue, then the label.
  //
  // #603 — the cue's WORD is dropped when the label already opens with it, so the
  // system is named once instead of twice. Every family used to stutter:
  //
  //   before   💠 Green Steel: Green Steel: Constitution +6 Insight
  //   after    💠 Green Steel: Constitution +6 Insight
  //
  // The emoji is always kept, so the legend still explains every marker in the
  // body. Trimming the LABEL instead is not an option: `toGearset` prints
  // `cr.label` with no cue at all, so it has to stay self-describing on its own.
  //
  // A family whose label does not open with its system name is untouched — `dino`
  // leads with the insert type (`Claw: …`), which the cue does not duplicate.
  function craftStr(cr, esc, fmt) {
    const parts = cueParts("craft", cr.family);
    const label = String(cr.label == null ? "" : cr.label);
    if (!parts) return esc(label);
    const [emoji, word] = parts;
    const opensWithWord = label.toLowerCase().startsWith(word.toLowerCase());
    if (opensWithWord) return `${emoji} ${esc(label)}`;
    return `${cue("craft", cr.family, fmt)}: ${esc(label)}`;
  }

  // One attribution source line: "Type +Value — Source [ (set)] [ via slots]".
  function sourceStr(p, esc) {
    // #353 — the shared predicate; this shape names the field `bonusType`
    // (camelCase) rather than `bonus_type`, so probe it explicitly.
    const isBool = _expIsPresenceType(p.bonusType);
    // #227 — an adjudicated untyped affix has no bonus type; without this every
    // share format printed the literal "null". Matches the label results.js uses,
    // so a shared loadout reads the same as the one on screen.
    const type = isBool ? "feature"
      : esc(p.bonusType == null || p.bonusType === "" ? "untyped" : p.bonusType);
    const val = isBool ? "✓" : "+" + esc(p.value);
    const slots = (p.slots && p.slots.length) ? ` via ${p.slots.map(esc).join(", ")}` : "";
    const tag = p.viaSet ? " (set)" : "";
    // U3 (R8) — a declared credit carries its own label and no slot, so a shared
    // loadout shows which numbers the recipient's own gear produces and which one
    // the sender asserted. The label comes from the solver, so the app and every
    // export format cannot drift apart.
    // #205 — a universal spell-DC enchantment is credited to the ranked school but
    // printed on the item under its own name. Naming it here means a shared build
    // tells the reader what to look for on the item, in every export format.
    const via = p.viaAffix ? ` as ${esc(p.viaAffix)}` : "";
    // U3 (#290/#291) — a cross-added credit names its fully-stacking SOURCE stat
    // ("from Universal Spell Power"), the same wording the app's receipts use.
    // One clause in the one shared sourceStr, so every format carries it.
    const from = p.crossAdd ? ` from ${esc(p.crossAdd)}` : "";
    return `${type} ${val} — ${esc(p.source)}${tag}${slots}${via}${from}`;
  }

  // The cap note for a priority stat, matching results.js: shown only when a cap is
  // set AND the raw contribution sum exceeds the achieved total (i.e. it clamped).
  function capNote(a, esc) {
    const raw = a.sources.reduce((s, p) => s + (p.value || 0), 0);
    return (a.cap != null && raw > a.total) ? ` (capped at ${esc(a.total)} · raw ${esc(raw)})` : "";
  }

  // #245 — the craft-carried disclosure, ONE wording for every export. `it` is a
  // projected loadout entry; empty string when the item earns its slot natively.
  function carriedStr(it, esc2) {
    const parts = it.craftCarried || [];
    if (!parts.length) return "";
    const txt = parts.map((p) => `${esc2(p.stat)} +${esc2(p.value)} (${esc2(p.family)})`).join(", ");
    return `Picked only for its crafts: ${txt}`;
  }

  // #91 (U6/R10) — one utility-effect receipt, ONE shape for every text format:
  // "effect — from item" (the item clause omitted when the credited carrier is
  // unknown, mirroring results.js's receipts). Only user-derived text is escaped.
  function utilityEffectStr(e, esc) {
    return `${esc(e.name)}${e.item ? ` — from ${esc(e.item)}` : ""}`;
  }

  // #262 — the no-drop-source disclosure, ONE wording for every export. The
  // projected entry carries the shared phrase itself (projection.js
  // NO_DROP_SOURCE_WORDING, only-when-set), so every format — and the portable
  // JSON, which inherits the resolved view verbatim — prints the identical
  // sentence or nothing. Trusted constant text, no user-derived parts, so no
  // per-format escaping is needed.
  function noDropStr(it) { return it.noDropSource || ""; }

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
    // #239 — same channel as the credit qualifier: solve-visible must not mean
    // share-invisible. Carrying them through the model is necessary, not
    // sufficient; each renderer has to print them.
    for (const line of view.character.saturationNotice || []) out += `> ${mdEsc(line)}\n\n`;
    for (const line of view.character.outbidNotice || []) out += `> ${mdEsc(line)}\n\n`;
    for (const line of view.character.emptySlotNotice || []) out += `> ${mdEsc(line)}\n\n`;
    // U6/#249 — the third disclosure on the same channel.
    for (const line of view.character.absorptionQuarantineNotice || []) out += `> ${mdEsc(line)}\n\n`;
    // #245 — the opt-out scope disclosure rides with the claim it scopes.
    if (view.character.craftingExcludedNotice) out += `> ${mdEsc(view.character.craftingExcludedNotice)}\n\n`;
    // #339 — the augment-ceiling scope disclosure, same channel and reason.
    if (view.character.augCeilingNotice) out += `> ${mdEsc(view.character.augCeilingNotice)}\n\n`;
    // #110 (U7) — the blocklist disclosure: exclusions qualify the optimality claim.
    for (const line of view.character.blockNotice || []) out += `> ${mdEsc(line)}\n\n`;
    out += view.character.constraints.filter(([k]) => k !== "Character").map(([k, v]) => `**${mdEsc(k)}:** ${mdEsc(v)}`).join("  \n") + "\n\n";
    out += `_${mdEsc(legendText("md"))}_\n\n`;
    out += `## Loadout\n\n`;
    for (const it of view.loadout) {
      out += `- **${mdEsc(it.slot)}** — ${mdEsc(it.item)} (ML ${mdEsc(it.ml == null ? "?" : it.ml)})\n`;
      const aff = affixList(it.affixes, mdEsc);
      if (aff) out += `  - ${aff}\n`;
      for (const aug of it.augments) out += `  - ${augStr(aug, mdEsc, "md")}\n`;
      for (const cr of it.crafting) out += `  - ${craftStr(cr, mdEsc, "md")}\n`;
      const carried = carriedStr(it, mdEsc);
      if (carried) out += `  - ⚒ ${carried}\n`;
      // #262 — the disclosure rides with the item it qualifies, in every format.
      const nd = noDropStr(it);
      if (nd) out += `  - ⚠ ${nd}\n`;
    }
    if (view.sets.length) {
      out += `\n## Set bonuses\n\n`;
      for (const s of view.sets) {
        out += `- **${mdEsc(s.set)}**${s.pieces ? ` (${mdEsc(s.pieces)} pieces)` : ""}\n`;
        const aff = affixList(s.affixes, mdEsc);
        if (aff) out += `  - ${aff}\n`;
        const mem = memberList(s.members, mdEsc);
        if (mem) out += `  - Pieces: ${mem}\n`;
      }
    }
    const stats = Object.keys(view.attribution);
    if (stats.length) {
      out += `\n## Stat breakdown\n\n`;
      // #449 (U2, R15/R18) — the achieved/ceiling fraction, in every format.
      // The full statement prints ONCE per document; each stat carries only the
      // short form naming what its denominator is. Carrying the fields on the
      // projection puts them in ZERO exports — the bundle is content, not a
      // renderer — so this site, and the three below it, are what make the
      // fraction shared rather than app-only.
      if (view.character.ceilingStatement) out += `_${mdEsc(view.character.ceilingStatement)}_\n\n`;
      for (const stat of stats) {
        const a = view.attribution[stat];
        out += `- **${mdEsc(stat)}** → +${mdEsc(a.total)}${capNote(a, mdEsc)}\n`;
        if (a.ceiling) out += `  - Ceiling: ${mdEsc(a.ceiling.line)}\n`;
        for (const p of a.sources) out += `  - ${sourceStr(p, mdEsc)}\n`;
      }
    }
    // #91 (U6/R10) — the Utility tier's section. ABSENT report (view.utility
    // missing — a healed pre-feature restore) renders nothing; zero-count prints
    // the canonical zero-state line rather than an empty list (R9).
    if (view.utility) {
      out += `\n## Utility effects (${mdEsc(view.utility.count)})\n\n`;
      out += `_${mdEsc(view.utility.line)}_\n\n`;
      for (const e of view.utility.effects) out += `- ${utilityEffectStr(e, mdEsc)}\n`;
      // #332 — the ranked-but-uncounted disclosure travels with every export, not
      // just the app card: a shared loadout must read the same as the one on screen.
      if (view.utility.excludedLine) out += `\n_${mdEsc(view.utility.excludedLine)}_\n`;
      // #348 (U5/R14) — what the container could not secure, and the price of the
      // top miss. Same single-source contract as every other line here: the
      // sentences come from projection.js, never re-worded per format.
      if ((view.utility.unsecuredLines || []).length) {
        out += `\n**Not secured**\n\n`;
        for (const l of view.utility.unsecuredLines) out += `- ${mdEsc(l)}\n`;
      }
      if (view.utility.priceLine) out += `\n_${mdEsc(view.utility.priceLine)}_\n`;
    }
    return out;
  }

  // ---- BBCode ----

  function toBBCode(rec) {
    const view = Proj.project(rec);
    let out = `[b]${bbEsc(view.character.name)}[/b]\n`;
    out += `[i]Optimal loadout — built with the DDO Loadout Optimizer.[/i]\n\n`;
    for (const line of view.character.creditNotice || []) out += `[i]${bbEsc(line)}[/i]\n\n`;
    for (const line of view.character.saturationNotice || []) out += `[i]${bbEsc(line)}[/i]\n\n`;
    for (const line of view.character.outbidNotice || []) out += `[i]${bbEsc(line)}[/i]\n\n`;
    for (const line of view.character.emptySlotNotice || []) out += `[i]${bbEsc(line)}[/i]\n\n`;
    for (const line of view.character.absorptionQuarantineNotice || []) out += `[i]${bbEsc(line)}[/i]\n\n`;
    if (view.character.craftingExcludedNotice) out += `[i]${bbEsc(view.character.craftingExcludedNotice)}[/i]\n\n`;
    if (view.character.augCeilingNotice) out += `[i]${bbEsc(view.character.augCeilingNotice)}[/i]\n\n`;
    for (const line of view.character.blockNotice || []) out += `[i]${bbEsc(line)}[/i]\n\n`;
    out += view.character.constraints.filter(([k]) => k !== "Character").map(([k, v]) => `[b]${bbEsc(k)}:[/b] ${bbEsc(v)}`).join(" | ") + "\n\n";
    out += `[i]${legendText("bb")}[/i]\n\n`;
    out += `[b]Loadout[/b]\n[list]\n`;
    for (const it of view.loadout) {
      out += `[*][b]${bbEsc(it.slot)}[/b] — ${bbEsc(it.item)} (ML ${bbEsc(it.ml == null ? "?" : it.ml)})`;
      const aff = affixList(it.affixes, bbEsc);
      if (aff) out += `: ${aff}`;
      for (const aug of it.augments) out += `\n  [*]${augStr(aug, bbEsc, "bb")}`;
      for (const cr of it.crafting) out += `\n  [*]${craftStr(cr, bbEsc, "bb")}`;
      const carried = carriedStr(it, bbEsc);
      if (carried) out += `\n  [*]${carried}`;
      // #262 — the disclosure rides with the item it qualifies, in every format.
      const nd = noDropStr(it);
      if (nd) out += `\n  [*]⚠ ${nd}`;
      out += `\n`;
    }
    out += `[/list]\n`;
    if (view.sets.length) {
      out += `\n[b]Set bonuses[/b]\n[list]\n`;
      for (const s of view.sets) {
        out += `[*][b]${bbEsc(s.set)}[/b]${s.pieces ? ` (${bbEsc(s.pieces)} pieces)` : ""}`;
        const aff = affixList(s.affixes, bbEsc);
        if (aff) out += `: ${aff}`;
        const mem = memberList(s.members, bbEsc);
        if (mem) out += `\n  [*]Pieces: ${mem}`;
        out += `\n`;
      }
      out += `[/list]\n`;
    }
    const stats = Object.keys(view.attribution);
    if (stats.length) {
      out += `\n[b]Stat breakdown[/b]\n`;
      // #449 (U2) — same two writes as the Markdown site: statement once, short
      // form per stat.
      if (view.character.ceilingStatement) out += `[i]${bbEsc(view.character.ceilingStatement)}[/i]\n`;
      out += `[list]\n`;
      for (const stat of stats) {
        const a = view.attribution[stat];
        out += `[*][b]${bbEsc(stat)}[/b] → +${bbEsc(a.total)}${capNote(a, bbEsc)}`;
        if (a.ceiling) out += `\n  [*]Ceiling: ${bbEsc(a.ceiling.line)}`;
        for (const p of a.sources) out += `\n  [*]${sourceStr(p, bbEsc)}`;
        out += `\n`;
      }
      out += `[/list]\n`;
    }
    // #91 (U6/R10) — same three-state rule as the Markdown section.
    if (view.utility) {
      out += `\n[b]Utility effects (${bbEsc(view.utility.count)})[/b]\n`;
      out += `[i]${bbEsc(view.utility.line)}[/i]\n`;
      if (view.utility.effects.length) {
        out += `[list]\n`;
        for (const e of view.utility.effects) out += `[*]${utilityEffectStr(e, bbEsc)}\n`;
        out += `[/list]\n`;
      }
      if (view.utility.excludedLine) out += `[i]${bbEsc(view.utility.excludedLine)}[/i]\n`;   // #332
      if ((view.utility.unsecuredLines || []).length) {                                        // #348
        out += `[b]Not secured[/b]\n[list]\n`;
        for (const l of view.utility.unsecuredLines) out += `[*]${bbEsc(l)}\n`;
        out += `[/list]\n`;
      }
      if (view.utility.priceLine) out += `[i]${bbEsc(view.utility.priceLine)}[/i]\n`;          // #348
    }
    return out;
  }

  // ---- CSV ----

  function toCsv(rec) {
    const view = Proj.project(rec);
    const rows = [];
    for (const [k, v] of view.character.constraints) rows.push(csvRow([k, v]));
    for (const line of view.character.creditNotice || []) rows.push(csvRow(["Declared", line]));
    for (const line of view.character.saturationNotice || []) rows.push(csvRow(["Saturated", line]));
    for (const line of view.character.outbidNotice || []) rows.push(csvRow(["Outbid", line]));
    for (const line of view.character.emptySlotNotice || []) rows.push(csvRow(["Free slots", line]));
    for (const line of view.character.absorptionQuarantineNotice || []) rows.push(csvRow(["Excluded", line]));
    if (view.character.craftingExcludedNotice) rows.push(csvRow(["Scope", view.character.craftingExcludedNotice]));
    if (view.character.augCeilingNotice) rows.push(csvRow(["Scope", view.character.augCeilingNotice]));
    for (const line of view.character.blockNotice || []) rows.push(csvRow(["Blocked", line]));
    rows.push("");
    rows.push(csvRow(["Legend", legendText("csv")]));
    rows.push("");
    rows.push(csvRow(["Slot", "Item", "ML", "Affixes", "Augments", "Crafting"]));
    for (const it of view.loadout) {
      // #245 — the craft-carried note joins the Crafting cell: it is a fact
      // about why the crafts matter, and a new column would break header pins.
      // #262 — the no-drop note joins the same notes cell for the same reason.
      const craftCell = it.crafting.map((cr) => craftStr(cr, (s) => s, "csv"))
        .concat(carriedStr(it, (s) => s) || [])
        .concat(noDropStr(it) || [])
        .join(" | ");
      rows.push(csvRow([
        it.slot, it.item, it.ml,
        affixListCsv(it.affixes),
        it.augments.map((aug) => augStr(aug, (s) => s, "csv")).join(" | "),
        craftCell,
      ]));
    }
    if (view.sets.length) {
      rows.push("");
      // "Pieces" is the satisfied TIER THRESHOLD; "From" names the actual items.
      // Distinct columns on purpose — they are different facts and a build can
      // complete a 3-piece tier with two worn items and one wildcard pick.
      rows.push(csvRow(["Set bonus", "Pieces", "Grants", "From"]));
      for (const s of view.sets) {
        rows.push(csvRow([s.set, s.pieces == null ? "" : s.pieces, affixListCsv(s.affixes),
          memberList(s.members, (x) => x)]));
      }
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
    // #449 (U2, R15/R18) — the achieved/ceiling fraction. Its OWN section, in the
    // Utility section's shape (banner row, header row, one row per entry), rather
    // than two more columns on the stat table: the same reason #245/#262 folded
    // their per-item notes into an existing cell — a new column breaks every
    // consumer pinned to the four-column stat header. Emitted only for stats that
    // carry a row, so a pre-#449 restore prints no section at all.
    const withCeiling = Object.keys(view.attribution).filter((s) => view.attribution[s].ceiling);
    if (withCeiling.length) {
      rows.push("");
      rows.push(csvRow(["Ceiling basis", view.character.ceilingStatement]));
      rows.push(csvRow(["Stat", "Achieved / ceiling", "Ceiling note"]));
      for (const stat of withCeiling) {
        const c = view.attribution[stat].ceiling;
        rows.push(csvRow([stat, c.fraction, c.short]));
      }
    }
    // #91 (U6/R10) — the Utility section: the canonical line, then one row per
    // receipt. ABSENT report emits nothing; zero-count emits the line alone.
    if (view.utility) {
      rows.push("");
      rows.push(csvRow(["Utility effects", view.utility.line]));
      if (view.utility.effects.length) {
        rows.push(csvRow(["Utility effect", "From"]));
        for (const e of view.utility.effects) rows.push(csvRow([e.name, e.item == null ? "" : e.item]));
      }
      if (view.utility.excludedLine) rows.push(csvRow(["Utility exclusion", view.utility.excludedLine]));   // #332
      for (const l of (view.utility.unsecuredLines || [])) rows.push(csvRow(["Utility not secured", l]));   // #348
      if (view.utility.priceLine) rows.push(csvRow(["Utility price", view.utility.priceLine]));             // #348
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
    for (const line of view.character.saturationNotice || []) h += `<p class="declared-note"><em>${htmlEsc(line)}</em></p>`;
    for (const line of view.character.outbidNotice || []) h += `<p class="declared-note"><em>${htmlEsc(line)}</em></p>`;
    for (const line of view.character.emptySlotNotice || []) h += `<p class="declared-note"><em>${htmlEsc(line)}</em></p>`;
    for (const line of view.character.absorptionQuarantineNotice || []) h += `<p class="declared-note"><em>${htmlEsc(line)}</em></p>`;
    if (view.character.craftingExcludedNotice) h += `<p class="declared-note"><em>${htmlEsc(view.character.craftingExcludedNotice)}</em></p>`;
    if (view.character.augCeilingNotice) h += `<p class="declared-note"><em>${htmlEsc(view.character.augCeilingNotice)}</em></p>`;
    for (const line of view.character.blockNotice || []) h += `<p class="declared-note"><em>${htmlEsc(line)}</em></p>`;
    h += `<p class="legend">${htmlEsc(legendText("md"))}</p>`;
    h += `<table><thead><tr><th>Slot</th><th>Item</th><th>ML</th><th>Affixes</th><th>Augments</th><th>Crafting</th></tr></thead><tbody>`;
    for (const it of view.loadout) {
      const carried = carriedStr(it, htmlEsc);
      const nd = noDropStr(it);
      // #245 + #262 — both per-item notes join the Crafting cell (same reason as
      // the CSV: it is the per-item notes column, and a new column breaks pins).
      const craftCell = it.crafting.map((cr) => craftStr(cr, htmlEsc, "md"))
        .concat(carried ? [`⚒ ${carried}`] : [])
        .concat(nd ? [`⚠ ${nd}`] : [])
        .join("<br>");
      h += `<tr><td>${htmlEsc(it.slot)}</td><td>${htmlEsc(it.item)}</td><td>${htmlEsc(it.ml)}</td>`
        + `<td>${affixList(it.affixes, htmlEsc)}</td>`
        + `<td>${it.augments.map((aug) => augStr(aug, htmlEsc, "md")).join("<br>")}</td>`
        + `<td>${craftCell}</td></tr>`;
    }
    h += `</tbody></table>`;
    if (view.sets.length) {
      h += `<h2>Set bonuses</h2><ul>`;
      for (const s of view.sets) {
        const aff = affixList(s.affixes, htmlEsc);
        const mem = memberList(s.members, htmlEsc);
        h += `<li><strong>${htmlEsc(s.set)}</strong>${s.pieces ? ` (${htmlEsc(s.pieces)} pieces)` : ""}${aff ? ` — ${aff}` : ""}`
          + `${mem ? `<div class="set-via">Pieces: ${mem}</div>` : ""}</li>`;
      }
      h += `</ul>`;
    }
    const stats = Object.keys(view.attribution);
    if (stats.length) {
      h += `<h2>Stat breakdown</h2>`;
      // #449 (U2) — same two writes as the Markdown site: statement once, short
      // form per stat.
      if (view.character.ceilingStatement) h += `<p class="declared-note"><em>${htmlEsc(view.character.ceilingStatement)}</em></p>`;
      h += `<ul>`;
      for (const stat of stats) {
        const a = view.attribution[stat];
        h += `<li><strong>${htmlEsc(stat)}</strong> → +${htmlEsc(a.total)}${capNote(a, htmlEsc)}<ul>`;
        if (a.ceiling) h += `<li>Ceiling: ${htmlEsc(a.ceiling.line)}</li>`;
        for (const p of a.sources) h += `<li>${sourceStr(p, htmlEsc)}</li>`;
        h += `</ul></li>`;
      }
      h += `</ul>`;
    }
    // #91 (U6/R10) — the Utility section, styled like the other sections.
    if (view.utility) {
      h += `<h2>Utility effects (${htmlEsc(view.utility.count)})</h2>`;
      h += `<p class="declared-note"><em>${htmlEsc(view.utility.line)}</em></p>`;
      if (view.utility.effects.length) {
        h += `<ul>`;
        for (const e of view.utility.effects) h += `<li>${utilityEffectStr(e, htmlEsc)}</li>`;
        h += `</ul>`;
      }
      if ((view.utility.unsecuredLines || []).length) {   // #348
        h += `<p class="declared-note"><strong>Not secured:</strong></p><ul>`;
        for (const l of view.utility.unsecuredLines) h += `<li>${htmlEsc(l)}</li>`;
        h += `</ul>`;
      }
      if (view.utility.priceLine) {                       // #348
        h += `<p class="declared-note"><em>${htmlEsc(view.utility.priceLine)}</em></p>`;
      }
      if (view.utility.excludedLine) {   // #332
        h += `<p class="declared-note"><em>${htmlEsc(view.utility.excludedLine)}</em></p>`;
      }
    }
    return h;
  }

  // ---- portable JSON (U5) ----

  // A versioned, re-importable envelope: the opaque `core` is the verbatim saved
  // record (the shape backup.js already round-trips), and `resolved` is the shared
  // content projection for later compare/diff. `format` carries the identifier so a
  // future import reader can tell a portable loadout from a plain backup file.
  // #91 (U6/R10) — the Utility tier rides as `resolved.utility` ({count, effects,
  // line}, plus #332's {excluded, excludedLine}: the ranked procs the count leaves
  // out and the one sentence naming them, plus #348's {ordered, unsecuredLines,
  // priceLine}: the container's order, what it could not secure and why, and the
  // priced top miss — all inherited from Proj.project, so the envelope needs no
  // per-field wiring) and verbatim in `core`'s snapshot
  // (`utilityReport`); a report-less snapshot carries neither, never a zero.
  // #449 (U2, R18) — the achieved/ceiling fraction rides as
  // `resolved.attribution[stat].ceiling`, inherited from Proj.project so the
  // envelope needs no per-field wiring. The denominator is named
  // `ceilingUpperBound`, not `ceiling`: Σ best sums each bonus-type bucket's best
  // source independently, those sources may compete for one slot, and a
  // third-party consumer of `ddo-loadout/v1` must not read the number as an
  // attainable target (KTD2). `format`/`schema_version` are UNCHANGED — the
  // envelope's contract is additive-optional (`utility`, `ordered`, `noDropSource`
  // all arrived the same way), and a reader written against v1 keeps parsing every
  // field it knew. A bump would falsely signal that the old shape no longer holds.
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
        // #91 (U6) — the Utility sentinel has no attribution entry; its achieved
        // value is the effect count, read from the projected block. A report-less
        // snapshot (healed pre-feature restore) falls through to "-": unknown,
        // never a fabricated zero.
        if (stat === Proj.UTILITY_SENTINEL && view.utility) {
          say(`  ${i + 1}. ${stat}  ${view.utility.count}`);
          return;
        }
        const a = view.attribution[stat] || {};
        const bounds = [];
        if ((inputs.targetFloors || {})[stat] != null) bounds.push(`min ${inputs.targetFloors[stat]}`);
        if ((inputs.targetCaps || {})[stat] != null) bounds.push(`max ${inputs.targetCaps[stat]}`);
        const cap = (a.cap != null && a.total != null) ? ` (capped at ${a.cap})` : "";
        say(`  ${i + 1}. ${stat}  ${a.total == null ? "-" : a.total}${cap}${bounds.length ? ` [${bounds.join(", ")}]` : ""}`);
      });
    }

    // #345 (U1, R5) — the outbid disclosure reaches THIS export too. It is the
    // sixth writer, and the one #332 missed: a recipient reading a priority
    // sitting at 0 with a source in their own gear otherwise has no way to learn
    // that a higher-ranked priority took the slot rather than the data lacking it.
    for (const line of view.character.outbidNotice || []) {
      rl.push("#");
      say("Priorities a higher-ranked one outbid (informational)");
      say(`  ${line}`);
    }

    const augLines = [];
    const craftLines = [];
    const noDropLines = [];
    for (const it of view.loadout) {
      for (const aug of it.augments || []) {
        const eff = affixList(aug.affixes, (s) => s);
        augLines.push(`  ${it.slot} (${it.item}) — ${aug.name}${eff ? `: ${eff}` : ""}`);
      }
      for (const cr of it.crafting || []) craftLines.push(`  ${it.slot} (${it.item}) — ${cr.label}`);
      // #262 — the projected entry carries the shared wording itself; the line
      // below the split is where a gearset can say it (the importable half must
      // stay a pure gear list).
      if (it.noDropSource) noDropLines.push(`  ${it.slot} (${it.item}) — ${it.noDropSource}`);
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
    // #262 — commentary only, one physical line per item via say/gsInline. The
    // heading deliberately does not repeat the phrase: the per-item line IS the
    // one shared wording, printed exactly once per flagged item.
    if (noDropLines.length) {
      rl.push("#");
      say("Drop-source disclosure (per the DDO wiki)");
      noDropLines.forEach(say);
    }
    if (unmapped.length) {
      rl.push("#");
      say("Not importable — no DDOBuilderV2 file-grammar slot label");
      for (const it of unmapped) say(`  ${it.slot} (${it.item})`);
    }
    // #91 (U6/R10) — the Utility tier, commentary only, under the same
    // not-importable split as crafting: DDOBuilder has no grammar for an on/off
    // proc, so the recipient learns the effects here and applies nothing. The
    // canonical line leads; zero-count is that line alone; a report-less
    // snapshot (view.utility absent) emits no section at all.
    if (view.utility) {
      rl.push("#");
      say("Utility effects (not importable — informational)");
      say(`  ${view.utility.line}`);
      for (const e of view.utility.effects) {
        say(`  ${utilityEffectStr(e, (s) => s)}`);
      }
      // #332 — the ranked-but-uncounted disclosure reaches THIS export too. It is the
      // sixth surface, and the easiest to forget: the other five are text/JSON shares,
      // this one is a .gearset download (wired at web/wizard.js). "Never solve-visible
      // but share-invisible" counts it.
      if (view.utility.excludedLine) say(`  ${view.utility.excludedLine}`);
      for (const l of (view.utility.unsecuredLines || [])) say(`  not secured: ${l}`);   // #348
      if (view.utility.priceLine) say(`  ${view.utility.priceLine}`);                    // #348
    }
    if (view.sets.length) {
      rl.push("#");
      say("Set bonuses active");
      for (const s of view.sets) {
        const eff = affixList(s.affixes, (s2) => s2);
        say(`  ${s.set}${s.pieces ? ` (${s.pieces} pieces)` : ""}${eff ? `: ${eff}` : ""}`);
        // Indented under its set. A wildcard piece is unimportable by definition —
        // DDOBuilder has no grammar for a runtime set pick — so naming it here is
        // the only way the recipient learns to reproduce the set by hand.
        const mem = memberList(s.members, (s2) => s2);
        if (mem) say(`    Pieces: ${mem}`);
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
