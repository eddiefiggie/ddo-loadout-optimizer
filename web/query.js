// U8 — loadout solver query form + solve orchestration (client-side).

window.App && window.App.ready((dataset) => {
  const root = document.getElementById("solver");
  if (!root) return;

  // Targetable stats (U5): the shared picker vocabulary — the UNION of every affix
  // source (gear, augments, set bonuses, and ALL crafting pools), canonicalized
  // through the alias table and filtered to the rankable ones. This closes the gap
  // where a crafting-only affix could not be selected even though the solver matches
  // it. `known` is the unfiltered union used to validate free-typed input.
  const vocab = (window.DatasetNormalizer && window.DatasetNormalizer.buildPickerVocabulary)
    ? window.DatasetNormalizer.buildPickerVocabulary(dataset)
    : { suggestions: [], known: new Set(), canonical: (n) => n };
  const allStats = vocab.suggestions;

  const ranked = []; // ordered target stats

  root.innerHTML = `
    <h2>Loadout Solver</h2>
    <div class="controls query-controls">
      <label class="field"><span>ML cap</span><input id="q-ml" type="number" min="1" max="40" value="36"></label>
      <label class="field"><span>Items ML ≥</span><input id="q-mlfloor" type="number" min="1" max="40" placeholder="any" title="Only consider items at or above this level (hide low-level gear)"></label>
      <label class="field"><span>Class / race</span><input id="q-class" type="text" placeholder="(optional)"></label>
      <label class="field"><span>Armor</span>
        <select id="q-armor"><option value="">Any</option><option value="cloth">Cloth</option><option value="light">Light</option><option value="medium">Medium</option><option value="heavy">Heavy</option></select>
      </label>
      <label class="field"><span>Weapon</span>
        <select id="q-weapon"><option value="">Any</option><option value="2h">Two-handed</option><option value="swordboard">One-hand + shield</option><option value="twf">Two-weapon (dual-wield)</option></select>
      </label>
    </div>
    <div class="controls q-actions">
      <label class="field grow"><span>Target affix</span>
        <input id="q-add" list="q-stats" placeholder="Add a target affix…" aria-label="Add a target affix">
      </label>
      <datalist id="q-stats">${allStats.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
      <button id="q-add-btn" type="button">Add</button>
      <button id="q-solve" type="button" class="primary">Solve</button>
    </div>
    <ol id="q-ranked" class="ranked"></ol>
    <div id="q-summary" class="q-summary" hidden>
      <span class="q-summary-text"></span>
      <button id="q-edit" type="button" class="q-edit">Edit</button>
    </div>
    <p id="q-status" class="status"></p>
    <div id="q-results"></div>`;

  const $ = (id) => document.getElementById(id);

  // U3: an unmistakable, immediate confirmation that a stepper/reorder registered
  // (the up/down arrows previously gave no visible sign a click worked). Restart
  // the cue on every change so rapid repeated clicks each read clearly; the CSS
  // falls back to a static highlight under prefers-reduced-motion.
  function bump(el) {
    if (!el) return;
    el.classList.remove("bumped");
    void el.offsetWidth; // reflow so the animation restarts on a repeat click
    el.classList.add("bumped");
    setTimeout(() => el.classList.remove("bumped"), 500);
  }

  function renderRanked() {
    const ol = $("q-ranked");
    if (!ranked.length) {
      ol.innerHTML = `<li class="hint">Add at least one target affix, in priority order (arrows to reorder).</li>`;
      return;
    }
    ol.innerHTML = ranked.map((s, i) => `<li><div class="rank-item">
      <span class="rank-order">${i + 1}</span>
      <span class="rank-name">${esc(s)}${vocab.presence && vocab.presence.has(s) ? ` <span class="rank-tag" title="On/off effect — the solver secures an item that has it, in priority order (no magnitude to maximize).">on/off</span>` : ""}</span>
      <span class="rank-ctrl">
        <button data-up="${i}" aria-label="move ${esc(s)} up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button data-down="${i}" aria-label="move ${esc(s)} down" ${i === ranked.length - 1 ? "disabled" : ""}>↓</button>
        <button data-del="${i}" class="del" aria-label="remove ${esc(s)}">✕</button>
      </span></div></li>`).join("");
  }

  function addTarget(stat) {
    // Canonicalize a free-typed value through the alias table (variant->canonical)
    // so it matches the ONE name gear/augments/crafting carry (U5).
    stat = vocab.canonical((stat || "").trim());
    if (!stat || ranked.includes(stat)) return;
    // U1 (#136) — an expanded-away name is still in `known` via the affix registry, so
    // the known-check below would accept a priority no item can ever satisfy. Refuse it
    // and point at the concrete stats it becomes. Must precede the `known` check.
    const DN = window.DatasetNormalizer;
    const awayMsg = (DN && DN.expandedAwayMessage) ? DN.expandedAwayMessage(vocab, stat) : null;
    if (awayMsg) { $("q-status").textContent = awayMsg; return; }
    if (!vocab.known.has(stat)) { $("q-status").textContent = `"${stat}" isn't a known affix in the dataset.`; return; }
    ranked.push(stat);
    $("q-add").value = "";
    $("q-status").textContent = "";
    renderRanked();
    // confirm the add landed at the bottom of the priority list
    bump($("q-ranked").lastElementChild && $("q-ranked").lastElementChild.querySelector(".rank-item"));
  }

  // Collapse the query inputs into a one-line summary after a solve, so the
  // paperdoll and results are front and centre; Edit expands them again.
  function collapseSolver(q) {
    root.querySelector(".q-summary-text").textContent =
      `Solved for ${q.targets.join(", ")} at ML ${q.mlCap}`;
    $("q-summary").hidden = false;
    root.classList.add("q-collapsed");
  }
  $("q-edit").addEventListener("click", () => {
    root.classList.remove("q-collapsed");
    $("q-summary").hidden = true;
  });

  // reflect a stepper change on the ML cap immediately (U3)
  $("q-ml").addEventListener("input", () => bump($("q-ml")));

  $("q-add-btn").addEventListener("click", () => addTarget($("q-add").value));
  $("q-add").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTarget($("q-add").value); } });
  $("q-ranked").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    let flashIdx = null;
    if (b.dataset.del != null) ranked.splice(+b.dataset.del, 1);
    else if (b.dataset.up != null) { const i = +b.dataset.up;[ranked[i - 1], ranked[i]] = [ranked[i], ranked[i - 1]]; flashIdx = i - 1; }
    else if (b.dataset.down != null) { const i = +b.dataset.down;[ranked[i + 1], ranked[i]] = [ranked[i], ranked[i + 1]]; flashIdx = i + 1; }
    renderRanked();
    // flash the row that moved so the reorder is unmistakable
    if (flashIdx != null && $("q-ranked").children[flashIdx]) {
      bump($("q-ranked").children[flashIdx].querySelector(".rank-item"));
    }
  });

  let highs = null;
  async function getHighs() {
    if (highs) return highs;
    $("q-status").textContent = "Loading solver (first run downloads the ~3 MB solver)…";
    // eslint-disable-next-line no-undef
    highs = await Module({ locateFile: (f) => "vendor/" + f });
    return highs;
  }

  let solving = false;
  $("q-solve").addEventListener("click", async () => {
    if (solving) return;
    if (!ranked.length) { $("q-status").textContent = "Add at least one target affix first."; return; }
    solving = true;
    $("q-solve").disabled = true;
    $("q-results").innerHTML = "";
    try {
      const h = await getHighs();
      $("q-status").textContent = "Solving…";
      const query = {
        mlCap: Number($("q-ml").value) || 36,
        mlFloor: Number($("q-mlfloor").value) || null,
        targets: ranked.slice(),
        armorType: $("q-armor").value || null,
        weaponSetup: $("q-weapon").value || null,
        classRace: $("q-class").value.trim() || null,
      };
      // eslint-disable-next-line no-undef
      // #91 (U3, KTD3) — the utility counting set rides as a buildModel ARGUMENT
      // from the in-scope vocabulary (alias-canonicalized dataset metadata),
      // never on the persisted query. Inert until the sentinel is ranked.
      const model = buildModel(dataset.items, query, dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium, dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel, dataset.augment_set_defs, vocab.utilityCounting || null);
      const t0 = performance.now();
      // eslint-disable-next-line no-undef
      const result = await solveLexicographic(model, h);
      const ms = Math.round(performance.now() - t0);
      if (result.status === "optimal") result.solveMs = ms;
      $("q-status").textContent = result.status === "optimal" ? `Solved in ${ms} ms.` : "";
      // eslint-disable-next-line no-undef
      renderResults($("q-results"), { model, result, query, dataset, highs: h });
      // Roll up the query panel so the paperdoll + results are front and centre.
      if (result.status === "optimal") collapseSolver(query);
    } catch (err) {
      $("q-status").textContent = `Solver error: ${err.message}`;
      console.error(err);
    } finally {
      solving = false;
      $("q-solve").disabled = false;
    }
  });

  // On load the results area is empty, which made the page read like a plain
  // form over a table. Show the data-forward design language up front (the solve
  // banner + a preview of the readout/paperdoll) so the new UI is visible before
  // the first solve, with a clear call to action.
  function renderEmptyState() {
    const n = (dataset.items || []).length;
    $("q-results").innerHTML = `
      <div class="readout-intro">
        <div class="solve-banner ghost">
          <div class="solve-verdict"><span class="dot"></span><span class="label">READY</span><span class="sub">· exact MILP solver — provably optimal, not a heuristic</span></div>
          <div class="solve-scale">
            <div class="scale-item"><span class="n">${n.toLocaleString()}</span><span class="k">items indexed</span></div>
            <div class="scale-item"><span class="n">exact</span><span class="k">MILP solve</span></div>
          </div>
        </div>
        <div class="intro-cta">
          <strong>Add target affixes above, in priority order, then Solve.</strong>
          <span class="muted">Your provably-optimal build renders here as a live ranked-target readout — each value broken down by bonus type with set contributions folded in — beside a paperdoll of the chosen loadout.</span>
        </div>
      </div>`;
  }

  renderRanked();
  renderEmptyState();
});
