// U1 parity-baseline capture (the U8 safety net's BEFORE image).
//
// Run against the CURRENT build BEFORE the native-schema overhaul touches the
// reader/solver, then again AFTER, comparing the two snapshots (U8). It records
// three things the overhaul must preserve:
//   1. roster      — the set of gear-planner source-item names present
//   2. affixes     — each variant's effective affix set, normalized to schema-
//                    neutral [name, type, value] triples so the legacy
//                    {stat,bonus_type} and the native {name,type} compare equal
//   3. solves      — per character fixture, the staged-lexicographic perTarget
//                    values, the effective per-target values, and the chosen
//                    loadout's variant ids (the behavioral signature)
//
// Usage:
//   node tests/parity/capture_baseline.js            # -> tests/parity/baseline.json
//   node tests/parity/capture_baseline.js --out FILE # -> FILE (e.g. after.json)
"use strict";
const path = require("path");
const fs = require("fs");
const { buildModel } = require("../../web/model.js");
const { solveLexicographic } = require("../../web/solver.js");
const { normalizeDataset } = require("../../web/dataset.js");

const ROOT = path.join(__dirname, "..", "..");
const DATASET = path.join(ROOT, "web", "data", "items.json");
const FIXTURES = path.join(__dirname, "fixtures.json");

// Read an affix's name/type/value across BOTH schemas: legacy {stat,bonus_type}
// and native {name,type}. `value` is coerced to a signed number where possible
// (native carries strings like "3"/"9%") so equal magnitudes compare equal.
function affixTriple(a) {
  const name = a.name != null ? a.name : a.stat;
  const type = a.type != null ? a.type : a.bonus_type;
  let value = a.value;
  if (typeof value === "string") {
    const n = parseInt(value.replace(/%$/, ""), 10);
    value = Number.isNaN(n) ? value : n;
  }
  return [name, type, value];
}

// An affix counts as effective unless it was explicitly marked ineligible by the
// legacy verify pass. Native records carry no `eligible` flag, so absence == kept.
function isEffective(a) { return a.eligible !== false; }

function tripleKey(t) { return JSON.stringify(t); }

function chosenId(c) {
  const v = c && c.variant;
  if (!v) return null;
  return v.variant_id || v.source_item || (typeof v === "string" ? v : JSON.stringify(v));
}

async function main() {
  const outArg = process.argv.indexOf("--out");
  const outPath = outArg > -1 ? process.argv[outArg + 1] : path.join(__dirname, "baseline.json");

  const Highs = require(path.join(ROOT, "web", "vendor", "highs.js"));
  const highs = await Highs({ locateFile: (f) => path.join(ROOT, "web", "vendor", f) });

  // U3 — items.json is near-native at rest; apply the load-time normalizer so
  // this harness sees the same numeric value/unit + legacy aliases the web load
  // path produces. (The frozen baseline.json was captured pre-U3; native "10"
  // parses to 10, so the affix triples compare equal.)
  const dataset = normalizeDataset(JSON.parse(fs.readFileSync(DATASET, "utf8")));
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES, "utf8"));

  // 1. roster
  const roster = [...new Set(dataset.items.map((it) => it.source_item))].sort();

  // 2. per-variant effective affix set (sorted neutral triples)
  const affixes = {};
  for (const it of dataset.items) {
    const triples = (it.affixes || []).filter(isEffective).map(affixTriple);
    triples.sort((x, y) => tripleKey(x).localeCompare(tripleKey(y)));
    affixes[it.variant_id] = triples;
  }

  // 3. behavioral solves
  const solves = {};
  for (const fx of fixtures) {
    const model = buildModel(
      dataset.items, fx.query,
      dataset.dino_inserts, dataset.nearly_complete, dataset.viktranium,
      dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel,
    );
    const r = await solveLexicographic(model, highs);
    const chosen = (r.chosen || [])
      .map((c) => ({ slot: c.slot, variant: chosenId(c) }))
      .sort((a, b) => (a.slot + a.variant).localeCompare(b.slot + b.variant));
    solves[fx.name] = {
      status: r.status,
      perTarget: r.perTarget || null,
      effective: r.effective || null,
      chosen,
    };
    console.log(`  solved ${fx.name}: ${r.status}`);
  }

  const snapshot = {
    schema_note: "schema-neutral parity snapshot; affix triples are [name,type,value]",
    dataset_item_count: dataset.items.length,
    roster_size: roster.length,
    roster,
    affixes,
    solves,
  };
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 1));
  console.log(`baseline: ${roster.length} roster names, ${Object.keys(affixes).length} variants, ${Object.keys(solves).length} fixtures -> ${path.relative(ROOT, outPath)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
