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
      <input id="q-add" list="q-stats" placeholder="Add a target affix…" aria-label="Add a target affix">
      <datalist id="q-stats">${allStats.map((s) => `<option value="${s}">`).join("")}</datalist>
      <button id="q-add-btn" type="button">Add</button>
      <button id="q-solve" type="button" class="primary">Solve</button>
    </div>
    <ol id="q-ranked" class="ranked"></ol>
    <p id="q-status" class="status"></p>
    <div id="q-results"></div>`;

  const $ = (id) => document.getElementById(id);

  function renderRanked() {
    const ol = $("q-ranked");
    if (!ranked.length) {
      ol.innerHTML = `<li class="hint">Add at least one target affix, in priority order (arrows to reorder).</li>`;
      return;
    }
    ol.innerHTML = ranked.map((s, i) => `<li><div class="rank-item">
      <span class="rank-order">${i + 1}</span>
      <span class="rank-name">${s}</span>
      <span class="rank-ctrl">
        <button data-up="${i}" aria-label="move ${s} up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button data-down="${i}" aria-label="move ${s} down" ${i === ranked.length - 1 ? "disabled" : ""}>↓</button>
        <button data-del="${i}" class="del" aria-label="remove ${s}">✕</button>
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
  }

  $("q-add-btn").addEventListener("click", () => addTarget($("q-add").value));
  $("q-add").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTarget($("q-add").value); } });
  $("q-ranked").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.del != null) ranked.splice(+b.dataset.del, 1);
    else if (b.dataset.up != null) { const i = +b.dataset.up;[ranked[i - 1], ranked[i]] = [ranked[i], ranked[i - 1]]; }
    else if (b.dataset.down != null) { const i = +b.dataset.down;[ranked[i + 1], ranked[i]] = [ranked[i], ranked[i + 1]]; }
    renderRanked();
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

  renderRanked();
});
