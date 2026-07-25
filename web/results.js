// U8 — render a solved loadout as a full build sheet. Display-only; the
// optimization happens in the solver (U1/U3/U5). Set bonuses and augments are
// now optimized and prescribed here; crafting/upgrade paths are a pending
// follow-up, surfaced honestly in the coverage disclosure.

function affixLabel(a) {
  const type = a.bonus_type && a.bonus_type !== "Enhancement" ? ` ${a.bonus_type}` : "";
  return `${a.stat} +${a.value}${a.unit === "pct" ? "%" : ""}${type}`;
}

/** Which of a variant's affixes hit the query targets (for the "why" column). */
function contributingAffixes(variant, targets) {
  const t = new Set(targets);
  return (variant.affixes || []).filter((a) => t.has(a.stat));
}

/** Reconstruct a concrete augment->item assignment from the solver's aggregate
 *  per-color placements (KTD2). Deterministic: walk equipped items in order and
 *  drop each placed augment into the first equipped item with remaining open
 *  capacity of its color. Returns { byIndex: Map(chosenIndex -> [aug]), unplaced }. */
function assignAugments(chosen, augmentsPlaced) {
  // remaining open capacity per (chosen index, color)
  const remaining = chosen.map((c) => {
    const m = new Map();
    for (const col of ((c.variant.augment_slots_norm || {}).colors) || []) m.set(col, (m.get(col) || 0) + 1);
    return m;
  });
  const byIndex = new Map();
  const unplaced = [];
  for (const aug of augmentsPlaced || []) {
    let placed = false;
    for (let i = 0; i < chosen.length; i++) {
      if ((remaining[i].get(aug.color) || 0) > 0) {
        remaining[i].set(aug.color, remaining[i].get(aug.color) - 1);
        if (!byIndex.has(i)) byIndex.set(i, []);
        byIndex.get(i).push(aug);
        placed = true;
        break;
      }
    }
    if (!placed) unplaced.push(aug);
  }
  return { byIndex, unplaced };
}

/** Reconstruct a concrete Dino-insert -> item assignment from the solver's
 *  aggregate per-type placements (mirrors assignAugments). Walk equipped items
 *  in order and drop each placed insert into the first equipped item with a
 *  remaining open Dino slot of its type. */
function assignDinoInserts(chosen, dinoPlaced) {
  const remaining = chosen.map((c) => {
    const m = new Map();
    for (const t of c.variant.dino_slots_norm || []) m.set(t, (m.get(t) || 0) + 1);
    return m;
  });
  const byIndex = new Map();
  const unplaced = [];
  for (const ins of dinoPlaced || []) {
    let placed = false;
    for (let i = 0; i < chosen.length; i++) {
      if ((remaining[i].get(ins.dino_type) || 0) > 0) {
        remaining[i].set(ins.dino_type, remaining[i].get(ins.dino_type) - 1);
        if (!byIndex.has(i)) byIndex.set(i, []);
        byIndex.get(i).push(ins);
        placed = true;
        break;
      }
    }
    if (!placed) unplaced.push(ins);
  }
  return { byIndex, unplaced };
}

/** Sets you are exactly one piece short of, whose next tier would advance a
 *  target. Display-only nudge; never changes the computed optimum. */
function nearMissSetHints(chosen, targets) {
  const t = new Set(targets);
  const counts = new Map();       // set name -> equipped piece count
  const tiersBySet = new Map();   // set name -> Map(pieces_label -> tier)
  for (const c of chosen) {
    for (const sb of c.variant.set_bonus || []) {
      if (sb.set) counts.set(sb.set, (counts.get(sb.set) || 0) + 1);
    }
    for (const tier of c.variant.parsed_set_bonuses || []) {
      if (tier.pieces_required == null || !(tier.affixes || []).length) continue;
      if (!tiersBySet.has(tier.set)) tiersBySet.set(tier.set, new Map());
      const byLabel = tiersBySet.get(tier.set);
      if (!byLabel.has(tier.pieces_label)) byLabel.set(tier.pieces_label, tier);
    }
  }
  const hints = [];
  for (const [setName, byLabel] of tiersBySet) {
    const have = counts.get(setName) || 0;
    for (const [, tier] of byLabel) {
      if (tier.pieces_required !== have + 1) continue;
      const adv = tier.affixes.filter((a) => t.has(a.stat) && a.value > 0);
      if (adv.length) {
        hints.push({ set: setName, have, need: tier.pieces_required, affixes: adv });
      }
    }
  }
  return hints;
}

function coverageNote(dataset) {
  const m = (dataset && dataset.metadata) || {};
  const aug = (m.color_coverage || {}).augments_placeable;
  const setAff = (m.set_coverage || {}).set_affixes_parsed;
  const dc = m.dino_coverage || {};
  const dinoElig = dc.inserts_eligible;
  const parts = [
    "<strong>Optimized:</strong> worn affixes, augments" +
      (aug != null ? ` (${aug} placeable)` : "") +
      ", set bonuses" + (setAff != null ? ` (${setAff} threshold effects)` : "") +
      ", and Isle of Dread Dino crafting" + (dinoElig != null ? ` (${dinoElig} Accessory inserts)` : ""),
    "<strong>Coverage:</strong> results reflect only verified, wiki-sourced data; ambiguous effects are quarantined and excluded",
    "<strong>Pending:</strong> Dino Weapon/Armor/Raid/Set-Bonus insert pools (and other expansion crafting systems) are not yet sourced, so they do not yet contribute",
  ];
  return `<p class="scope-note">${parts.join(". ")}. All optimized values are wiki-traceable.</p>`;
}

function renderResults(container, { model, result, query, dataset }) {
  if (result.status !== "optimal") {
    container.innerHTML = `<div class="empty">No set satisfies these constraints${result.reason ? ` — ${result.reason}` : ""}. Loosen the ML cap, armor/class filters, or targets.</div>`;
    return;
  }

  const stats = query.targets.map((s, i) =>
    `<tr><td class="num">${i + 1}</td><td>${s}</td><td class="num">${result.effective[s] ?? 0}</td></tr>`).join("");

  // group equipped picks by slot, preserving a flat index for augment assignment
  const augAssign = assignAugments(result.chosen, result.augmentsPlaced);
  const dinoAssign = assignDinoInserts(result.chosen, result.dinoPlaced);
  const rowsBySlot = new Map();
  result.chosen.forEach((c, idx) => {
    if (!rowsBySlot.has(c.slot)) rowsBySlot.set(c.slot, []);
    rowsBySlot.get(c.slot).push({ variant: c.variant, idx });
  });

  const rows = [];
  for (const slot of model.worn) {
    const picks = rowsBySlot.get(slot.slot) || [];
    if (picks.length === 0) {
      rows.push(`<tr class="empty-slot"><td>${slot.slot}</td><td colspan="4"><span class="muted">— no target-relevant item —</span></td></tr>`);
      continue;
    }
    for (const { variant: v, idx } of picks) {
      const contrib = contributingAffixes(v, query.targets).map((a) => `<span class="chip">${affixLabel(a)}</span>`).join(" ") || `<span class="muted">—</span>`;
      const augs = (augAssign.byIndex.get(idx) || [])
        .map((a) => `<span class="chip aug" title="augment slotted (${a.color})">${a.variant_id} <span class="muted">(${a.color})</span></span>`).join(" ");
      const dinos = (dinoAssign.byIndex.get(idx) || [])
        .map((d) => `<span class="chip dino" title="Isle of Dread ${d.dino_type} insert">${d.dino_type}: ${affixLabel({ stat: d.stat, bonus_type: d.bonus_type, value: d.value, unit: "flat" })}</span>`).join(" ");
      const link = v.wiki_url ? `<a href="${v.wiki_url}" target="_blank" rel="noopener">wiki</a>` : "";
      rows.push(`<tr>
        <td>${slot.slot}</td>
        <td>${v.variant_id}</td>
        <td class="num">${v.minimum_level ?? "—"}</td>
        <td>${contrib} ${augs} ${dinos}</td>
        <td>${link}</td>
      </tr>`);
    }
  }

  // active sets + near-miss nudges
  const active = (result.setsActive || []).map((s) => `<li><strong>${s.set}</strong> — ${s.pieces_required}-piece bonus active</li>`).join("");
  const nearMiss = nearMissSetHints(result.chosen, query.targets)
    .map((h) => `<li>One piece from <strong>${h.set}</strong> (${h.have}/${h.need}) → ${h.affixes.map(affixLabel).join(", ")}</li>`).join("");
  const setsBlock = (active || nearMiss) ? `
      <div>
        <h3>Set bonuses</h3>
        <ul class="sets">${active}${nearMiss}</ul>
      </div>` : "";

  container.innerHTML = `
    <div class="result-grid">
      <div>
        <h3>Achieved (priority order)</h3>
        <table class="items"><thead><tr><th>#</th><th>Affix</th><th class="num">Value</th></tr></thead><tbody>${stats}</tbody></table>
      </div>
      <div>
        <h3>Loadout</h3>
        <div style="overflow-x:auto"><table class="items">
          <thead><tr><th>Slot</th><th>Item</th><th class="num">ML</th><th>Contributes / augments</th><th>Src</th></tr></thead>
          <tbody>${rows.join("")}</tbody></table></div>
      </div>
      ${setsBlock}
    </div>
    ${coverageNote(dataset)}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderResults, affixLabel, assignAugments, assignDinoInserts, nearMissSetHints, coverageNote };
}
