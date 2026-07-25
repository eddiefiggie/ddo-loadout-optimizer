// U8 — render a solved loadout. Display-only; the optimization happens in U6/U7.

function affixLabel(a) {
  const type = a.bonus_type && a.bonus_type !== "Enhancement" ? ` ${a.bonus_type}` : "";
  return `${a.stat} +${a.value}${a.unit === "pct" ? "%" : ""}${type}`;
}

/** Which of a variant's affixes hit the query targets (for the "why" column). */
function contributingAffixes(variant, targets) {
  const t = new Set(targets);
  return (variant.affixes || []).filter((a) => t.has(a.stat));
}

function renderResults(container, { model, result, query }) {
  if (result.status !== "optimal") {
    container.innerHTML = `<div class="empty">No set satisfies these constraints${result.reason ? ` — ${result.reason}` : ""}. Loosen the ML cap, armor/class filters, or targets.</div>`;
    return;
  }

  // effective stats, in priority order
  const stats = query.targets.map((s, i) =>
    `<tr><td class="num">${i + 1}</td><td>${s}</td><td class="num">${result.effective[s] ?? 0}</td></tr>`).join("");

  // filled slots
  const chosenBySlot = new Map();
  result.chosen.forEach((c) => {
    if (!chosenBySlot.has(c.slot)) chosenBySlot.set(c.slot, []);
    chosenBySlot.get(c.slot).push(c.variant);
  });

  const rows = [];
  for (const slot of model.worn) {
    const picks = chosenBySlot.get(slot.slot) || [];
    if (picks.length === 0) {
      rows.push(`<tr class="empty-slot"><td>${slot.slot}</td><td colspan="4"><span class="muted">— no target-relevant item —</span></td></tr>`);
      continue;
    }
    for (const v of picks) {
      const contrib = contributingAffixes(v, query.targets).map((a) => `<span class="chip">${affixLabel(a)}</span>`).join(" ") || `<span class="muted">—</span>`;
      const sets = (v.set_bonus || []).map((s) => s.set).filter(Boolean);
      const setBadge = sets.length ? `<span class="muted" title="set membership (display-only in v1)">set: ${sets.join(", ")}</span>` : "";
      const augBadge = (v.augment_slots || []).length ? `<span class="muted" title="augment slots (not yet optimized)">aug: ${v.augment_slots.join("/")}</span>` : "";
      const link = v.wiki_url ? `<a href="${v.wiki_url}" target="_blank" rel="noopener">wiki</a>` : "";
      rows.push(`<tr>
        <td>${slot.slot}</td>
        <td>${v.variant_id}</td>
        <td class="num">${v.minimum_level ?? "—"}</td>
        <td>${contrib} ${setBadge} ${augBadge}</td>
        <td>${link}</td>
      </tr>`);
    }
  }

  container.innerHTML = `
    <div class="result-grid">
      <div>
        <h3>Achieved (priority order)</h3>
        <table class="items"><thead><tr><th>#</th><th>Affix</th><th class="num">Value</th></tr></thead><tbody>${stats}</tbody></table>
      </div>
      <div>
        <h3>Loadout</h3>
        <div style="overflow-x:auto"><table class="items">
          <thead><tr><th>Slot</th><th>Item</th><th class="num">ML</th><th>Contributes / notes</th><th>Src</th></tr></thead>
          <tbody>${rows.join("")}</tbody></table></div>
      </div>
    </div>
    <p class="scope-note">Provably optimal over <strong>verified worn-item affixes</strong> under DDO's bonus-type stacking and the armor dodge cap. <strong>Set bonuses and augments are shown but not yet optimized</strong> (their bonuses are still free text in the dataset) — a planned follow-up. Slots marked "no target-relevant item" carry nothing that advances your targets, so they're yours to fill freely.</p>`;
}

if (typeof module !== "undefined" && module.exports) module.exports = { renderResults, affixLabel };
