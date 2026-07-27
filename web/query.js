// U8 — loadout solver query form + solve orchestration (client-side).

window.App && window.App.ready((dataset) => {
  const root = document.getElementById("solver");
  if (!root) return;

  // Targetable stats: distinct affix stats present in the dataset.
  const statSet = new Set();
  dataset.items.forEach((v) => {
    (v.affixes || []).forEach((a) => statSet.add(a.stat));   // worn + augment affixes
    (v.scaling || []).forEach((s) => statSet.add(s.stat));
    (v.parsed_set_bonuses || []).forEach((tier) =>           // set-bonus threshold stats
      (tier.affixes || []).forEach((a) => statSet.add(a.stat)));
  });
  const allStats = [...statSet].sort();

  const ranked = []; // ordered target stats

  root.innerHTML = `
    <h2>Loadout Solver</h2>
    <div class="controls query-controls">
      <label class="field"><span>ML cap</span><input id="q-ml" type="number" min="1" max="40" value="34"></label>
      <label class="field"><span>Class / race</span><input id="q-class" type="text" placeholder="(optional)"></label>
      <label class="field"><span>Armor</span>
        <select id="q-armor"><option value="">any</option><option>cloth</option><option>light</option><option>medium</option><option>heavy</option></select>
      </label>
      <label class="field"><span>Weapon</span>
        <select id="q-weapon"><option value="">any</option><option value="2h">two-handed</option><option value="swordboard">sword &amp; board</option><option value="twf">two-weapon</option></select>
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
      <span class="rank-name">${esc(s)}</span>
      <span class="rank-ctrl">
        <button data-up="${i}" aria-label="move ${esc(s)} up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button data-down="${i}" aria-label="move ${esc(s)} down" ${i === ranked.length - 1 ? "disabled" : ""}>↓</button>
        <button data-del="${i}" class="del" aria-label="remove ${esc(s)}">✕</button>
      </span></div></li>`).join("");
  }

  function addTarget(stat) {
    stat = (stat || "").trim();
    if (!stat || ranked.includes(stat)) return;
    if (!statSet.has(stat)) { $("q-status").textContent = `"${stat}" isn't a known affix in the dataset.`; return; }
    ranked.push(stat);
    $("q-add").value = "";
    $("q-status").textContent = "";
    renderRanked();
    // confirm the add landed at the bottom of the priority list
    bump($("q-ranked").lastElementChild && $("q-ranked").lastElementChild.querySelector(".rank-item"));
  }

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
        mlCap: Number($("q-ml").value) || 34,
        targets: ranked.slice(),
        armorType: $("q-armor").value || null,
        weaponSetup: $("q-weapon").value || null,
        classRace: $("q-class").value.trim() || null,
      };
      // eslint-disable-next-line no-undef
      const model = buildModel(dataset.items, query, dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium, dataset.seal);
      const t0 = performance.now();
      // eslint-disable-next-line no-undef
      const result = await solveLexicographic(model, h);
      const ms = Math.round(performance.now() - t0);
      if (result.status === "optimal") result.solveMs = ms;
      $("q-status").textContent = result.status === "optimal" ? `Solved in ${ms} ms.` : "";
      // eslint-disable-next-line no-undef
      renderResults($("q-results"), { model, result, query, dataset });
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
