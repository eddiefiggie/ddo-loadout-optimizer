// Guided-wizard flow controller (U1). Replaces the two-tab shell + the old
// query form: one linear flow (intro -> character -> gear pool -> priorities ->
// solve -> results) that drives the EXISTING engine (buildModel / solveLexicographic
// / renderResults) with the character gate (U2), Trove import (U5), and per-slot
// constraints (U6) wired in. Pure step helpers are exported for node tests; all
// DOM wiring is guarded so Node can require this file.

// ---- pure step machine (tested in tests/wizard.test.js) --------------------
const WIZARD_STEPS = ["intro", "character", "pool", "priorities", "results"];
const FORGED = new Set(["warforged", "bladeforged", "battleforged"]);

/** Can the flow advance FROM `stepId` given the collected state? Gates the
 *  Continue/Solve buttons. Unknown steps are permissive. */
function canAdvance(stepId, state) {
  if (stepId === "character") return !!state.race && Number(state.ml) > 0;
  if (stepId === "pool") return state.pool !== "owned" || !!state.ownedNames;
  if (stepId === "priorities") return (state.priorities || []).length > 0;
  return true;
}
/** Next step id after advancing from `stepId` (clamped at results). */
function nextStep(stepId, steps = WIZARD_STEPS) {
  const i = steps.indexOf(stepId);
  if (i < 0) return stepId;
  return steps[Math.min(i + 1, steps.length - 1)];
}
/** Previous step id (clamped at intro). */
function prevStep(stepId, steps = WIZARD_STEPS) {
  const i = steps.indexOf(stepId);
  if (i <= 0) return steps[0];
  return steps[i - 1];
}
const wizIsForged = (race) => FORGED.has(String(race || "").toLowerCase());

/** Pure state -> solver query mapping (no DOM). Exported for unit tests. */
function buildQuery(state) {
  const forged = wizIsForged(state.race);
  return {
    mlCap: Number(state.ml) || 34,
    targets: state.priorities.slice(),
    armorType: forged ? null : (state.armor || null),   // dodge-cap input
    armorTypes: forged || !state.armor ? undefined : [state.armor], // gate (U2)
    weaponSetup: state.weapon || null,
    race: state.race || null,
    alignment: state.alignment || null,
    includeArtifact: !!state.includeArtifact,           // U4 — Artifact opt-in
    slotConstraints: state.slotConstraints,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { WIZARD_STEPS, canAdvance, nextStep, prevStep, wizIsForged, buildQuery };
}

// ---- browser flow ----------------------------------------------------------
if (typeof window !== "undefined" && window.App) {
  const RACES = ["Human", "Elf", "Half-Elf", "Dwarf", "Halfling", "Gnome", "Half-Orc",
    "Drow", "Aasimar", "Tiefling", "Dragonborn", "Shifter", "Tabaxi", "Warforged", "Bladeforged"];
  const ALIGNMENTS = ["Lawful Good", "Neutral Good", "Chaotic Good",
    "Lawful Neutral", "True Neutral", "Chaotic Neutral"];
  const ARMOR = [["cloth", "Cloth"], ["light", "Light"], ["medium", "Medium"], ["heavy", "Heavy"]];
  const WEAPONS = [["2h", "Two-handed"], ["swordboard", "One-hand + shield"],
    ["twf", "Dual-wield"], ["runearm", "One-hand + rune arm"]];
  const STEP_LABELS = { intro: "Start", character: "Character", pool: "Gear pool", priorities: "Priorities", results: "Results" };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  window.App.ready((dataset) => {
    const root = document.getElementById("wizard");
    if (!root) return;

    // Targetable affix stats present in the dataset (mirrors the old query form).
    const statSet = new Set();
    dataset.items.forEach((v) => {
      (v.affixes || []).forEach((a) => statSet.add(a.stat));
      (v.scaling || []).forEach((s) => statSet.add(s.stat));
      (v.parsed_set_bonuses || []).forEach((t) => (t.affixes || []).forEach((a) => statSet.add(a.stat)));
    });
    const allStats = [...statSet].sort();

    const state = { step: "intro", ml: 34, race: "", alignment: "", armor: "", weapon: "",
      includeArtifact: false,
      pool: "all", ownedNames: null, priorities: [], slotConstraints: {}, constraintsDirty: false, lastRun: null,
      characterName: "", loadedStale: false };

    let highs = null;
    async function getHighs() {
      if (highs) return highs;
      // eslint-disable-next-line no-undef
      highs = await Module({ locateFile: (f) => "vendor/" + f });
      return highs;
    }

    // ---- stepper -----------------------------------------------------------
    function renderStepper() {
      const done = (id) => WIZARD_STEPS.indexOf(id) < WIZARD_STEPS.indexOf(state.step);
      return `<ol class="wz-steps">${WIZARD_STEPS.map((id) => {
        const cls = done(id) ? "done" : (id === state.step ? "on" : "");
        const n = WIZARD_STEPS.indexOf(id) + 1;
        return `<li class="wz-step ${cls}"><button class="wz-dot" data-goto="${id}" ${done(id) ? "" : "disabled"}>${done(id) ? "✓" : n}</button><span>${STEP_LABELS[id]}</span></li>`;
      }).join("")}</ol>`;
    }

    // ---- steps -------------------------------------------------------------
    function stepIntro() {
      const n = (dataset.items || []).length;
      return `<section class="wz-card">
        <p class="wz-eyebrow">What this does</p>
        <h2>Find your provably-best gear — not a guess.</h2>
        <p class="wz-lead">Tell us about your character and rank the stats you care about. We search every
          wiki-sourced item, augment, set bonus, and crafting option (${n.toLocaleString()} indexed) and return the
          <strong>single loadout that is mathematically optimal</strong> for your priorities — slot by slot,
          with the exact crafting steps to build it.</p>
        <p class="wz-lead">Four short steps, then the answer. No account; it runs entirely in your browser.</p>
        <div class="wz-actions"><button class="btn primary" data-next>Get started →</button></div>
      </section>`;
    }

    function stepCharacter() {
      const forged = wizIsForged(state.race);
      return `<section class="wz-card">
        <p class="wz-eyebrow">Step 1 of 4 · Your character</p>
        <h2>A few basics so we only show gear you can use</h2>
        <p class="wz-lead">These filter out anything you can't equip before we optimize — no wasted results.</p>
        <div class="wz-form">
          <label class="wz-field"><span class="wz-label">Minimum level (ML) cap</span>
            <span class="wz-help">Highest item level you can equip. Gear above this is excluded.</span>
            <input id="wz-ml" class="wz-ml" type="number" min="1" max="40" value="${esc(state.ml)}"></label>
          <div class="wz-pair">
            <label class="wz-field"><span class="wz-label">Race</span>
              <span class="wz-help">Determines body-slot and race-locked gear.</span>
              <select id="wz-race"><option value="">Select a race…</option>
                ${RACES.map((r) => `<option ${state.race === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>
            <label class="wz-field"><span class="wz-label">Alignment</span>
              <span class="wz-help">Some gear requires or forbids an alignment.</span>
              <select id="wz-align"><option value="">Select an alignment…</option>
                ${ALIGNMENTS.map((a) => `<option ${state.alignment === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
          </div>
          <div class="wz-field"><span class="wz-label">Armor type ${forged ? '<span class="wz-sub">· docent (Forged race)</span>' : ""}</span>
            <span class="wz-help">Your proficiency — sets the dodge cap and eligible body armor.</span>
            <div class="wz-seg" id="wz-armor">${ARMOR.map(([v, l]) => `<button class="wz-chip ${state.armor === v ? "on" : ""}" data-armor="${v}" ${forged ? "disabled" : ""}>${l}</button>`).join("")}</div></div>
          <div class="wz-field"><span class="wz-label">Weapon setup <span class="wz-sub">· optional</span></span>
            <span class="wz-help">Shapes which weapon / off-hand combinations we consider.</span>
            <div class="wz-seg" id="wz-weapon">${WEAPONS.map(([v, l]) => `<button class="wz-chip ${state.weapon === v ? "on" : ""}" data-weapon="${v}">${l}</button>`).join("")}</div></div>
          <label class="wz-check"><input type="checkbox" id="wz-artifact"${state.includeArtifact ? " checked" : ""}>
            <span class="wz-check-body"><span class="wz-label">Include an Artifact</span>
            <span class="wz-help">Build around your one equippable Artifact — the optimizer picks the best-scoring one and tags its slot. Off by default.</span></span></label>
          <label class="wz-field"><span class="wz-label">Character name <span class="wz-sub">· optional</span></span>
            <span class="wz-help">Name this character to save its build and reload it later. Saved only in this browser
              (no account, cleared if you clear browser data) — use Export &amp; Data Management to move a copy between devices.</span>
            <input id="wz-charname" type="text" value="${esc(state.characterName)}" placeholder="e.g. Sook - Reaper"></label>
        </div>
        <div class="wz-saved" id="wz-saved"></div>
        <div class="wz-actions"><button class="btn ghost" data-back>← Back</button><span class="wz-spacer"></span>
          <button class="btn primary" data-next>Continue →</button></div>
      </section>`;
    }

    function stepPool() {
      const owned = state.pool === "owned";
      return `<section class="wz-card">
        <p class="wz-eyebrow">Step 2 of 4 · Which gear should we search?</p>
        <h2>Optimize over everything, or only what you own</h2>
        <p class="wz-lead">Augments and crafting options always come from the full catalog — owned mode only
          restricts the base gear.</p>
        <div class="wz-seg wz-pool">
          <button class="wz-chip big ${!owned ? "on" : ""}" data-pool="all"><strong>All gear in the game</strong><small>Every wiki-sourced named item — theoretical best-in-slot.</small></button>
          <button class="wz-chip big ${owned ? "on" : ""}" data-pool="owned"><strong>Only what I own</strong><small>Upload your Trove inventory export.</small></button>
        </div>
        <div id="wz-upload" class="${owned ? "" : "wz-hidden"}">
          <label class="wz-field"><span class="wz-label">Import your inventory (CSV)</span>
            <span class="wz-help">Export from Trove. Your file never leaves your browser; account columns are ignored.</span>
            <input id="wz-file-label" type="text" readonly placeholder="Click to choose a .csv file…" class="wz-file">
            <input id="wz-file" type="file" accept=".csv" class="wz-hidden"></label>
          <div id="wz-file-stat" class="wz-filestat"></div>
        </div>
        <div class="wz-actions"><button class="btn ghost" data-back>← Back</button><span class="wz-spacer"></span>
          <button class="btn primary" data-next>Continue →</button></div>
      </section>`;
    }

    function stepPriorities() {
      return `<section class="wz-card">
        <p class="wz-eyebrow">Step 3 of 4 · What matters most?</p>
        <h2>Rank the stats you care about</h2>
        <p class="wz-lead">Add stats and order them — #1 is maximized first, then #2 without giving up any of #1,
          and so on. This ordering <em>is</em> the objective the solver optimizes.</p>
        <div class="wz-addrow">
          <input id="wz-add" list="wz-stats" placeholder="Add a stat — e.g. Constitution, Dodge, Melee Power…">
          <datalist id="wz-stats">${allStats.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
          <button class="btn ghost" id="wz-add-btn">Add</button>
        </div>
        <ol class="wz-ranked" id="wz-ranked"></ol>
        <p class="wz-draghelp">Drag the ⋮⋮ handle to reorder, or use the ↑ ↓ buttons (they work on touch and keyboard).</p>
        <p id="wz-status" class="wz-status"></p>
        <div class="wz-actions"><button class="btn ghost" data-back>← Back</button><span class="wz-spacer"></span>
          <button class="btn primary" data-solve>Solve ⚡</button></div>
      </section>`;
    }

    function stepResults() {
      return `<section class="wz-card wz-results">
        <div class="wz-results-head">
          <div><p class="wz-eyebrow">Your optimal loadout</p></div>
          <span class="wz-spacer"></span>
          <button class="btn ghost" data-goto="priorities">← Adjust priorities</button>
          <button class="btn ghost" data-goto="character">Edit character</button>
        </div>
        <div class="wz-save" id="wz-save">
          <input id="wz-savename" type="text" value="${esc(state.characterName)}" placeholder="Name this character…">
          <button class="btn primary" id="wz-savebtn">Save character</button>
          <span class="wz-savestat" id="wz-savestat" aria-live="polite"></span>
        </div>
        <div id="wz-stale" class="wz-cbar wz-hidden">
          This saved build predates the current gear catalog. <button class="btn primary" id="wz-staleresolve">Re-solve ⚡</button>
        </div>
        <div id="wz-cbar" class="wz-cbar${state.constraintsDirty ? "" : " wz-hidden"}">
          Slot constraints changed. <button class="btn primary" id="wz-cresolve">Re-solve ⚡</button>
        </div>
        <div id="wz-results"></div>
        <details class="wz-adjust" id="wz-adjust">
          <summary>Adjust &amp; re-solve</summary>
          <div class="wz-adjust-body">
            <p class="wz-help" style="margin:0 0 var(--sp-3)">Refine priorities, flip the gear pool, then re-solve — no need to step back.</p>
            <div class="wz-addrow">
              <input id="wz-radd" list="wz-stats2" placeholder="Add a stat…">
              <datalist id="wz-stats2">${allStats.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
              <button class="btn ghost" id="wz-radd-btn">Add</button>
            </div>
            <ol class="wz-ranked" id="wz-rranked"></ol>
            <div class="wz-adjust-row">
              <span class="wz-help" style="margin:0">Gear pool:</span>
              <span class="wz-toggle">
                <button data-rpool="all" class="${state.pool === "all" ? "on" : ""}">All gear</button>
                <button data-rpool="owned" class="${state.pool === "owned" ? "on" : ""}">What I own</button>
              </span>
              <button class="btn primary" id="wz-radjust-solve">Re-solve ⚡</button>
            </div>
          </div>
        </details>
      </section>`;
    }

    // ---- priorities editor (pure array ops + drag/buttons) -----------------
    function rankedHTML() {
      if (!state.priorities.length) return `<li class="wz-hint">Add at least one stat to optimize for.</li>`;
      return state.priorities.map((p, i) => `<li data-i="${i}" draggable="true">
        <span class="wz-grip" title="drag to reorder">⋮⋮</span>
        <span class="wz-rk">${i + 1}</span><span class="wz-nm">${esc(p)}</span>
        <span class="wz-ctl"><button data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="move up">↑</button>
          <button data-down="${i}" ${i === state.priorities.length - 1 ? "disabled" : ""} aria-label="move down">↓</button>
          <button data-del="${i}" aria-label="remove">✕</button></span></li>`).join("");
    }
    // Generic ranked-list renderer: reused by the priorities step and the
    // in-results "Adjust & re-solve" panel (U8). `rerender` re-renders that
    // same list after a mutation.
    function renderRankedList(ol, rerender) {
      if (!ol) return;
      ol.innerHTML = rankedHTML();
      ol.querySelectorAll("button").forEach((b) => b.onclick = () => {
        if (b.dataset.up != null) { const i = +b.dataset.up;[state.priorities[i - 1], state.priorities[i]] = [state.priorities[i], state.priorities[i - 1]]; }
        else if (b.dataset.down != null) { const i = +b.dataset.down;[state.priorities[i + 1], state.priorities[i]] = [state.priorities[i], state.priorities[i + 1]]; }
        else if (b.dataset.del != null) state.priorities.splice(+b.dataset.del, 1);
        rerender();
      });
      let from = null;
      ol.querySelectorAll("li[draggable]").forEach((li) => {
        li.ondragstart = (e) => { from = +li.dataset.i; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); };
        li.ondragend = () => { li.classList.remove("dragging"); from = null; };
        li.ondragover = (e) => e.preventDefault();
        li.ondrop = (e) => { e.preventDefault(); const to = +li.dataset.i; if (from === null || to === from) return; const m = state.priorities.splice(from, 1)[0]; state.priorities.splice(to, 0, m); from = null; rerender(); };
      });
    }
    function renderRanked() { renderRankedList(document.getElementById("wz-ranked"), renderRanked); }
    function renderAdjustRanked() { renderRankedList(document.getElementById("wz-rranked"), renderAdjustRanked); }
    /** Add a target affix; returns true if it landed (caller re-renders the list). */
    function addPriority(v) {
      v = (v || "").trim(); const status = document.getElementById("wz-status");
      if (!v) return false;
      if (!statSet.has(v)) { if (status) status.textContent = `"${v}" isn't a known affix in the dataset.`; return false; }
      if (state.priorities.includes(v)) return false;
      state.priorities.push(v); if (status) status.textContent = ""; return true;
    }

    // ---- solve (real engine) ----------------------------------------------
    function candidateItems() {
      if (state.pool === "owned" && state.ownedNames) {
        // owned base items + full-catalog augments (KTD4/R13)
        return dataset.items.filter((v) => v.category === "augment"
          || state.ownedNames.has(v.source_item || v.variant_id));
      }
      return dataset.items;
    }
    function overlay(on, title, sub) {
      let el = document.getElementById("wz-solve-overlay");
      if (!el && on) {
        el = document.createElement("div"); el.id = "wz-solve-overlay"; el.className = "wz-overlay";
        el.innerHTML = `<div class="wz-overlay-box"><div class="wz-ring"></div><h3 id="wz-ov-title"></h3><p id="wz-ov-sub" class="wz-ov-sub"></p><p class="wz-ov-foot">Exact optimization — the provably best answer, not a guess.</p></div>`;
        document.body.appendChild(el);
      }
      if (el) {
        if (on) { el.querySelector("#wz-ov-title").textContent = title; el.querySelector("#wz-ov-sub").textContent = sub || ""; el.classList.add("on"); }
        else el.classList.remove("on");
      }
    }

    let solving = false;
    async function solve(firstRun) {
      if (solving) return;
      if (!state.priorities.length) return;
      solving = true;
      const n = candidateItems().length;
      overlay(true, "Solving your loadout…", firstRun ? `searching ${n.toLocaleString()} eligible items · exact MILP` : "re-solving…");
      try {
        const h = await getHighs();
        const query = buildQuery(state);
        // eslint-disable-next-line no-undef
        const model = buildModel(candidateItems(), query, dataset.dino_inserts, dataset.nearly_complete,
          dataset.viktranium, dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel);
        const t0 = performance.now();
        // eslint-disable-next-line no-undef
        const result = await solveLexicographic(model, h);
        if (result.status === "optimal") result.solveMs = Math.round(performance.now() - t0);
        // R17 pin-invalidation: a pinned item that didn't land (e.g. a gate change
        // made it ineligible) is dropped to "free" so its badge never lies.
        Object.entries(state.slotConstraints).forEach(([slot, c]) => {
          if (c && c.type === "pin" &&
              !(result.chosen || []).some((ch) => ch.slot === slot && ch.variant.variant_id === c.variant_id)) {
            delete state.slotConstraints[slot];
            query.slotConstraints = { ...state.slotConstraints };
          }
        });
        state.constraintsDirty = false;
        state.lastRun = { model, result, query };
        state.step = "results";
        render();
        const box = document.getElementById("wz-results");
        // eslint-disable-next-line no-undef
        if (box) renderResults(box, { model, result, query, dataset, highs: h });
      } catch (err) {
        state.step = "results"; render();
        const box = document.getElementById("wz-results");
        if (box) box.innerHTML = `<p class="wz-status">Solver error: ${esc(err.message)}</p>`;
        console.error(err);
      } finally {
        overlay(false); solving = false;
      }
    }

    // ---- character persistence (U3/U4) ------------------------------------
    function currentBuildId() {
      return (dataset && dataset.metadata && dataset.metadata.build_id) || null;
    }

    function saveCurrentCharacter(name) {
      const nm = (name || "").trim();
      if (!nm) return { ok: false, error: "no-name" };
      if (!state.lastRun || !state.lastRun.result || state.lastRun.result.status !== "optimal") {
        return { ok: false, error: "no-build" };
      }
      state.characterName = nm;
      // eslint-disable-next-line no-undef
      const rec = CharacterStore.serializeCharacter(nm, state, state.lastRun, currentBuildId());
      // eslint-disable-next-line no-undef
      return CharacterStore.saveCharacter(rec);
    }

    // Load a saved character: restore inputs, rebuild the model scaffold WITHOUT
    // solving (KTD2), and render Results from the stored snapshot. renderResults
    // only needs `highs` for the Alternatives tab, which degrades gracefully when
    // absent, so a loaded build shows instantly.
    function loadCharacter(name) {
      // eslint-disable-next-line no-undef
      const rec = CharacterStore.loadCharacter(name);
      if (!rec) return;
      const i = rec.inputs || {};
      state.characterName = rec.name;
      state.ml = i.ml; state.race = i.race; state.alignment = i.alignment;
      state.armor = i.armor; state.weapon = i.weapon;
      state.includeArtifact = !!i.includeArtifact;
      state.pool = i.pool || "all";
      state.ownedNames = Array.isArray(i.ownedNames) ? new Set(i.ownedNames) : null;
      state.priorities = Array.isArray(i.priorities) ? i.priorities.slice() : [];
      state.slotConstraints = i.slotConstraints || {};
      const snap = rec.snapshot;
      if (snap && snap.status === "optimal") {
        const query = rec.query || buildQuery(state);
        // eslint-disable-next-line no-undef
        const model = buildModel(candidateItems(), query, dataset.dino_inserts, dataset.nearly_complete,
          dataset.viktranium, dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel);
        state.lastRun = { model, result: snap, query };
        state.loadedStale = !!(rec.stampedBuildId && currentBuildId() && rec.stampedBuildId !== currentBuildId());
        state.step = "results";
        render();
        const box = document.getElementById("wz-results");
        // eslint-disable-next-line no-undef
        if (box) renderResults(box, { model, result: snap, query, dataset, highs: null });
        const stale = document.getElementById("wz-stale");
        if (stale) stale.classList.toggle("wz-hidden", !state.loadedStale);
      } else {
        go("priorities");
      }
    }

    function renderSavedPicker() {
      const host = document.getElementById("wz-saved");
      if (!host) return;
      // eslint-disable-next-line no-undef
      const chars = CharacterStore.listCharacters();
      if (!chars.length) {
        host.innerHTML = `<p class="wz-help wz-saved-empty">No saved characters yet — solve a build, name it, and Save it from the results.</p>`;
        return;
      }
      host.innerHTML = `<p class="wz-label">Saved characters</p><ul class="wz-charlist">` +
        chars.map((c) => `<li><span class="wz-charnm">${esc(c.name)}</span>
          <span class="wz-ctl"><button type="button" data-load="${esc(c.name)}">Load →</button>
          <button type="button" data-del="${esc(c.name)}" aria-label="delete ${esc(c.name)}">✕</button></span></li>`).join("") +
        `</ul>`;
    }

    // ---- on-demand Item Browser (U9) --------------------------------------
    // Reference-only roster search; not a competing top-level tab (R23). Reuses
    // browse.js's initBrowse over a panel this opens on demand.
    function openBrowser() {
      let ov = document.getElementById("wz-browse-overlay");
      if (!ov) {
        ov = document.createElement("div"); ov.id = "wz-browse-overlay"; ov.className = "wz-browse-overlay";
        ov.innerHTML = `<div class="wz-browse-panel">
          <div class="wz-browse-head"><h2>Item Browser</h2><button class="btn ghost" id="wz-browse-close">Close ✕</button></div>
          <p class="wz-help">Search and filter the full indexed roster — reference only; it doesn't change your solve.</p>
          <div id="browse-controls" class="controls"></div>
          <p id="browse-status" class="status"></p>
          <div id="browse-results"></div>
        </div>`;
        document.body.appendChild(ov);
        ov.querySelector("#wz-browse-close").onclick = () => ov.classList.remove("on");
        ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("on"); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") ov.classList.remove("on"); });
        // eslint-disable-next-line no-undef
        if (window.ItemBrowser) window.ItemBrowser.initBrowse(dataset);
      }
      ov.classList.add("on");
    }

    // ---- master render + wiring -------------------------------------------
    function render() {
      const bodies = { intro: stepIntro, character: stepCharacter, pool: stepPool, priorities: stepPriorities, results: stepResults };
      root.innerHTML = `<div class="wz-topbar">${renderStepper()}<button class="btn ghost wz-browse-btn" data-browse type="button">Browse items</button></div>`
        + (bodies[state.step] || stepIntro)();
      wire();
    }
    function go(step) { state.step = step; render(); }

    function wire() {
      root.querySelectorAll("[data-browse]").forEach((b) => b.onclick = openBrowser);
      root.querySelectorAll("[data-goto]").forEach((b) => b.onclick = () => { if (!b.disabled) go(b.dataset.goto); });
      root.querySelectorAll("[data-back]").forEach((b) => b.onclick = () => go(prevStep(state.step)));
      root.querySelectorAll("[data-next]").forEach((b) => b.onclick = () => {
        if (!canAdvance(state.step, state)) { flashBlock(); return; }
        go(nextStep(state.step));
      });
      root.querySelectorAll("[data-solve]").forEach((b) => b.onclick = () => {
        if (!canAdvance("priorities", state)) { const s = document.getElementById("wz-status"); if (s) s.textContent = "Add at least one stat to optimize for."; return; }
        solve(true);
      });

      if (state.step === "character") {
        document.getElementById("wz-ml").oninput = (e) => state.ml = e.target.value;
        document.getElementById("wz-race").onchange = (e) => { state.race = e.target.value; if (wizIsForged(state.race)) state.armor = ""; render(); };
        document.getElementById("wz-align").onchange = (e) => state.alignment = e.target.value;
        document.getElementById("wz-artifact").onchange = (e) => state.includeArtifact = e.target.checked;
        root.querySelectorAll("#wz-armor .wz-chip").forEach((c) => c.onclick = () => {
          if (c.disabled) return; state.armor = state.armor === c.dataset.armor ? "" : c.dataset.armor;
          root.querySelectorAll("#wz-armor .wz-chip").forEach((x) => x.classList.toggle("on", x.dataset.armor === state.armor));
        });
        root.querySelectorAll("#wz-weapon .wz-chip").forEach((c) => c.onclick = () => {
          state.weapon = state.weapon === c.dataset.weapon ? "" : c.dataset.weapon;
          root.querySelectorAll("#wz-weapon .wz-chip").forEach((x) => x.classList.toggle("on", x.dataset.weapon === state.weapon));
        });
        const cn = document.getElementById("wz-charname");
        if (cn) cn.oninput = (e) => state.characterName = e.target.value;
        renderSavedPicker();
        const saved = document.getElementById("wz-saved");
        if (saved) saved.onclick = (e) => {
          const b = e.target.closest("button"); if (!b) return;
          if (b.dataset.load != null) loadCharacter(b.dataset.load);
          else if (b.dataset.del != null && window.confirm(`Delete saved character "${b.dataset.del}"?`)) {
            // eslint-disable-next-line no-undef
            CharacterStore.deleteCharacter(b.dataset.del);
            renderSavedPicker();
          }
        };
      }
      if (state.step === "pool") {
        root.querySelectorAll(".wz-chip[data-pool]").forEach((c) => c.onclick = () => {
          state.pool = c.dataset.pool;
          document.getElementById("wz-upload").classList.toggle("wz-hidden", state.pool !== "owned");
          root.querySelectorAll(".wz-chip[data-pool]").forEach((x) => x.classList.toggle("on", x.dataset.pool === state.pool));
        });
        const disp = document.getElementById("wz-file-label"), real = document.getElementById("wz-file");
        if (disp) {
          disp.onclick = () => real.click();
          real.onchange = (e) => {
            const f = e.target.files[0]; if (!f) return; disp.value = f.name;
            const reader = new FileReader();
            reader.onload = () => {
              const stat = document.getElementById("wz-file-stat");
              try {
                // eslint-disable-next-line no-undef
                const { ownedNames, rowCount } = TroveImport.parseTroveCsv(reader.result);
                state.ownedNames = ownedNames;
                // eslint-disable-next-line no-undef
                const m = TroveImport.ownedMatch(ownedNames, dataset.items);
                stat.className = "wz-filestat" + (m.matched ? "" : " warn");
                stat.innerHTML = `✓ Parsed <strong>${rowCount.toLocaleString()}</strong> entries · <strong>${m.ownedCount}</strong> distinct names · matched <strong>${m.matched}</strong> in the dataset (${m.unrecognized} unrecognized).`;
              } catch (err) {
                state.ownedNames = null;
                stat.className = "wz-filestat warn";
                stat.textContent = `Couldn't read that file: ${err.message}`;
              }
            };
            reader.readAsText(f);
          };
        }
      }
      if (state.step === "priorities") {
        const add = document.getElementById("wz-add");
        document.getElementById("wz-add-btn").onclick = () => { if (addPriority(add.value)) renderRanked(); add.value = ""; add.focus(); };
        add.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); if (addPriority(add.value)) renderRanked(); add.value = ""; } };
        renderRanked();
      }
      if (state.step === "results") {
        const box = document.getElementById("wz-results");
        const cbar = document.getElementById("wz-cbar");
        // Save the current character (U3): inputs + solved snapshot.
        const savename = document.getElementById("wz-savename");
        const savebtn = document.getElementById("wz-savebtn");
        const savestat = document.getElementById("wz-savestat");
        if (savename) savename.oninput = (e) => state.characterName = e.target.value;
        if (savebtn) savebtn.onclick = () => {
          const res = saveCurrentCharacter(savename ? savename.value : state.characterName);
          if (!savestat) return;
          if (res.ok) savestat.textContent = `Saved “${state.characterName}”.`;
          else if (res.error === "no-name") savestat.textContent = "Enter a name to save.";
          else if (res.error === "no-build") savestat.textContent = "Solve a build first.";
          else if (res.error === "quota") savestat.textContent = "Storage full — export and remove old saves.";
          else savestat.textContent = "Could not save.";
        };
        // Staleness note (U4): re-solve is view-only — it refreshes the shown
        // build but does not overwrite the saved snapshot until an explicit Save.
        const staleBtn = document.getElementById("wz-staleresolve");
        if (staleBtn) staleBtn.onclick = () => {
          state.loadedStale = false;
          const stale = document.getElementById("wz-stale");
          if (stale) stale.classList.add("wz-hidden");
          solve(false);
        };
        // Per-slot constraint controls (U6), wired by delegation so they survive
        // renderResults re-rendering the box contents.
        if (box) box.addEventListener("click", (e) => {
          const ctl = e.target.closest(".pd-ctl");
          if (ctl) {
            const menu = ctl.closest(".pd-row").querySelector(".pd-menu");
            const willOpen = menu.hidden;
            box.querySelectorAll(".pd-menu").forEach((m) => { m.hidden = true; });
            menu.hidden = !willOpen;
            return;
          }
          const act = e.target.closest(".pd-menu button");
          if (!act || act.disabled) return;
          const slot = act.dataset.slot;
          if (act.dataset.act === "free") delete state.slotConstraints[slot];
          else if (act.dataset.act === "empty") state.slotConstraints[slot] = { type: "empty" };
          else if (act.dataset.act === "pin" && act.dataset.variant) state.slotConstraints[slot] = { type: "pin", variant_id: act.dataset.variant };
          state.constraintsDirty = true;
          // refresh the equipped-list badges in place (no re-solve yet)
          if (state.lastRun) {
            state.lastRun.query.slotConstraints = { ...state.slotConstraints };
            // eslint-disable-next-line no-undef
            renderResults(box, { model: state.lastRun.model, result: state.lastRun.result, query: state.lastRun.query, dataset, highs });
          }
          if (cbar) cbar.classList.remove("wz-hidden");
        });
        const cres = document.getElementById("wz-cresolve");
        if (cres) cres.onclick = () => { if (state.priorities.length) solve(false); };

        // Adjust & re-solve panel (U8): inline priority editor + pool flip + re-solve.
        renderAdjustRanked();
        const radd = document.getElementById("wz-radd");
        if (radd) {
          document.getElementById("wz-radd-btn").onclick = () => { if (addPriority(radd.value)) renderAdjustRanked(); radd.value = ""; radd.focus(); };
          radd.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); if (addPriority(radd.value)) renderAdjustRanked(); radd.value = ""; } };
        }
        root.querySelectorAll(".wz-toggle button[data-rpool]").forEach((b) => b.onclick = () => {
          if (b.dataset.rpool === "owned" && !state.ownedNames) { go("pool"); return; } // AE8: route to upload
          state.pool = b.dataset.rpool;
          root.querySelectorAll(".wz-toggle button[data-rpool]").forEach((x) => x.classList.toggle("on", x.dataset.rpool === state.pool));
        });
        const rsolve = document.getElementById("wz-radjust-solve");
        if (rsolve) rsolve.onclick = () => { if (state.priorities.length) solve(false); };
      }
    }
    function flashBlock() {
      const btn = root.querySelector("[data-next]"); if (!btn) return;
      btn.classList.remove("wz-nudge"); void btn.offsetWidth; btn.classList.add("wz-nudge");
    }

    render();
  });
}
