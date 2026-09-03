// #683 — the disclosed name split. Run: node tests/split-mechanic.test.js
//
// One wiki mechanic under two spellings, where one wiki page says the sources
// stack and another types them so they cannot. The app resolves NEITHER reading
// and discloses the split instead, so these tests are mostly about what the
// notice does NOT do: it must not change a number, and it must not render at all
// when the family is not installed.
const assert = require("assert");
const Model = require("../web/model.js");
const Proj = require("../web/projection.js");
const fs = require("fs");
const path = require("path");

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; }
}

const FAMILY = {
  mechanic: "Critical Multiplier on a 19-20",
  spellings: ["Critical Multiplier on a 19-20", "Critical Multiplier on a roll of 19-20"],
  sets_per_spelling: {
    "Critical Multiplier on a 19-20": 2,
    "Critical Multiplier on a roll of 19-20": 3,
  },
  total_sets: 5,
  contested_summary: "one wiki page says these stack, another types them so they cannot",
  wiki_url: "https://ddowiki.com/page/Critical_hit_multiplier",
  issue: 683,
};
const A = FAMILY.spellings[0];
const B = FAMILY.spellings[1];

const line = (targets) => Proj.splitMechanicLine({ snapshot: {}, query: { targets } });

// ------------------------------------------------------------ uninstalled state

test("#683 renders nothing when no family is installed (older cached dataset)", () => {
  Model.setSplitMechanics([]);
  assert.strictEqual(line([A]), null,
    "a dataset predating the disclosure must render no notice, not a broken one");
  assert.strictEqual(Model.splitMechanicFor(A), null);
});

test("#683 the lookup survives junk without throwing", () => {
  Model.setSplitMechanics(null);
  assert.strictEqual(Model.splitMechanicFor(A), null);
  Model.setSplitMechanics([{ mechanic: "x" }]);          // no spellings array
  assert.strictEqual(Model.splitMechanicFor(A), null);
  assert.strictEqual(Model.splitMechanicFor(null), null);
});

// ---------------------------------------------------------------- the sentence

test("#683 one spelling ranked names its own count and the other spelling's", () => {
  Model.setSplitMechanics([FAMILY]);
  const s = line([A]);
  assert.ok(s, "ranking a disclosed spelling must disclose the split");
  assert.ok(s.includes(`"${A}" is granted by 2 of the 5`), s);
  assert.ok(s.includes(`"${B}" (3 of them)`), s);
  assert.ok(/reaches only those 2/.test(s), s);
});

test("#683 the other spelling gets its own counts, not the first one's", () => {
  Model.setSplitMechanics([FAMILY]);
  const s = line([B]);
  assert.ok(s.includes(`"${B}" is granted by 3 of the 5`), s);
  assert.ok(s.includes(`"${A}" (2 of them)`), s);
});

test("#683 ranking BOTH says the solve adds them, and names the risk", () => {
  Model.setSplitMechanics([FAMILY]);
  const s = line([A, B]);
  assert.ok(/ranked both, so this solve ADDS them/.test(s), s);
  assert.ok(/counting the same bonus more than once/.test(s), s);
  assert.ok(!/reaches only those/.test(s), s);
});

test("#683 the contested wording comes from the DATA, not from projection.js", () => {
  // A second family must not inherit this family's reasoning. Install a different
  // summary and require it to appear verbatim.
  Model.setSplitMechanics([{ ...FAMILY, contested_summary: "SENTINEL REASONING" }]);
  assert.ok(line([A]).includes("SENTINEL REASONING"), line([A]));
  assert.ok(!/Artifact/.test(line([A])),
    "projection.js must carry no family-specific wiki reasoning of its own");
});

test("#683 stays silent when the family shipped without its counts", () => {
  // The sentence QUOTES the counts, so a family missing them must render nothing
  // rather than "granted by undefined of the 0 sets".
  Model.setSplitMechanics([{ ...FAMILY, sets_per_spelling: {}, total_sets: 0 }]);
  assert.strictEqual(line([A]), null);
  Model.setSplitMechanics([{ ...FAMILY, sets_per_spelling: { [A]: 2 } }]);
  assert.strictEqual(line([A]), null, "a count missing for the OTHER spelling is equally unquotable");
});

test("#683 stays silent for unrelated priorities and for an empty query", () => {
  Model.setSplitMechanics([FAMILY]);
  assert.strictEqual(line(["Doublestrike"]), null);
  assert.strictEqual(line([]), null);
  assert.strictEqual(line(undefined), null);
});

// ------------------------------------------------------------- the disclosure's
// whole premise: it must not become a modelled value

test("#683 the installed family carries no value or bonus type", () => {
  Model.setSplitMechanics([FAMILY]);
  const fam = Model.splitMechanicFor(A);
  assert.ok(fam, "the family must be findable by either spelling");
  assert.strictEqual(fam.value, undefined,
    "a value here is how an unsettled question quietly becomes a modelled one");
  assert.strictEqual(fam.bonus_type, undefined);
});

test("#683 both spellings resolve to the SAME family", () => {
  Model.setSplitMechanics([FAMILY]);
  assert.strictEqual(Model.splitMechanicFor(A), Model.splitMechanicFor(B));
});

// ------------------------------------------------------------------ the wiring

test("#683 the notice reaches the shared content model every export reads", () => {
  Model.setSplitMechanics([FAMILY]);
  const rec = {
    name: "t", inputs: { ml: 34, priorities: [A] },
    query: { targets: [A] },
    snapshot: { status: "optimal", chosen: [], setsActive: [], query: { targets: [A] },
      effective: {}, breakdown: {} },
  };
  const model = Proj.project(rec);
  assert.ok(model.character.splitMechanicNotice,
    "a shared build must carry the caveat; #668 is the precedent for it not doing so");
  assert.strictEqual(model.character.splitMechanicNotice, line([A]),
    "the export and the app must read ONE wording");
});

test("#683 the exporter roster carries the notice", () => {
  const { CHARACTER_NOTICES } = require("../web/exporters.js");
  assert.ok(CHARACTER_NOTICES.some((n) => n.key === "splitMechanicNotice"),
    "#668 — a notice absent from the roster reaches none of the four surfaces");
});

test("#683 results.js registers the notice for the app surface", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "web", "results.js"), "utf8");
  assert.ok(/name: "splitMechanicNotice"/.test(src),
    "the notice must be registered, or it renders in exports and not in the app");
});

// ------------------------------------------------- the shipped dataset, if built

test("#683 the built dataset installs a family whose counts sum to its total", () => {
  const p = path.join(__dirname, "..", "web", "data", "items.json");
  if (!fs.existsSync(p)) { console.log("  (dataset absent — skipped)"); return; }
  const meta = JSON.parse(fs.readFileSync(p, "utf8")).metadata;
  const fams = meta.split_mechanic_disclosures || [];
  assert.ok(fams.length, "the disclosure never reached the dataset");
  for (const fam of fams) {
    const sum = Object.values(fam.sets_per_spelling).reduce((a, b) => a + b, 0);
    assert.strictEqual(fam.total_sets, sum, JSON.stringify(fam));
    assert.ok(fam.spellings.length >= 2, JSON.stringify(fam));
    assert.ok((fam.contested_summary || "").length > 0,
      "the player-facing reason must ship with the family");
  }
  Model.setSplitMechanics(fams);
  assert.ok(line([fams[0].spellings[0]]), "the shipped family must produce a sentence");
});

console.log(`\n${passed} passed`);
