// Owner-approved carrier preference: no inferred numerical sonic mechanics.
const assert = require('assert');
const {test} = require("./_harness");
const D = require('../web/dataset');
const M = require('../web/model');
const S = require('../web/solver');
const W = require('../web/wizard');
const NAME = 'Melody: Imperial Resonance';
const ds = D.normalizeDataset(require('../web/data/items.json'));
const v = D.buildPickerVocabulary(ds);
const carriers = ds.items.filter(i => i.affixes.some(a => a.name === NAME && a.type === 'Bool'));
const model = (items, order, targets = ['Utility effects'], counting = v.utilityCounting) =>
  M.buildModel(items, {mlCap:34, targets, includeArtifact:true}, [], [], [], ds.seal, {}, [], {},
    {counting, notCounted:v.utilityNotCounted, order});
const names = p => [...p.utilityMeta.values()].map(m => m.name);

test('Imperial Utility: selected catalog carriers reach a real scoring indicator', () => {
  assert.strictEqual(carriers.length, 2);
  const p = S.buildProgram(model(carriers, [NAME]));
  assert.ok(names(p).includes(NAME));
  assert.deepStrictEqual(p.utilityUnreachable, []);
  assert.deepStrictEqual(p.utilityOrderVars.map(x => x.name), [NAME]);
});

test('Imperial Utility compatibility: default and saved containers retain base programs', () => {
  const oldCounting = new Set(v.utilityCounting); oldCounting.delete(NAME);
  for (const order of [v.utilityOrder, [], ['Ghostly'], null]) {
    const current = model(carriers, order), old = model(carriers, order, ['Utility effects'], oldCounting);
    assert.ok(!current.utilityCountingSet.has(NAME));
    assert.deepStrictEqual(S.buildProgram(current), S.buildProgram(old));
  }
  assert.ok(v.utilityCounting.has(NAME), 'shared stamp is never mutated');
  const explicit = S.buildProgram(model(carriers, v.utilityOrder, [NAME]));
  assert.ok(explicit.targetList.includes(NAME), 'ordinary priority still works');
});

test('Imperial Utility: real solves secure either carrier once without sonic credit', async () => {
  const highs = await require('../web/vendor/highs.js')({locateFile:f => require('path').join(__dirname,'../web/vendor',f)});
  for (const items of [[carriers[0]], [carriers[1]], carriers]) {
    const result = await S.solveLexicographic(model(items, [NAME]), highs);
    assert.strictEqual(result.status, 'optimal');
    assert.deepStrictEqual(result.utilityOrdered.secured, [NAME]);
    assert.strictEqual(result.utilityCount, 1, 'two carriers never count twice');
    assert.ok(result.chosen.some(c => c.variant.affixes.some(a => a.name === NAME)));

  }
  // Real numeric control competes in Elyd's slot. Presence must never imply
  // sonic magnitude, or sacrifice the ranked Resonance value for this choice.
  const control = ds.items.find(i => i.source_item === "Epic Siren's Charm");
  assert.ok(control.affixes.some(a => a.name === 'Resonance' && a.value === 111));
  const pool = [carriers[0], control];
  const ranked = await S.solveLexicographic(model(pool, [NAME], ['Resonance','Utility effects']), highs);
  const baseline = await S.solveLexicographic(model(pool, [], ['Resonance','Utility effects']), highs);
  assert.strictEqual(ranked.perTarget.Resonance, 111);
  assert.strictEqual(ranked.perTarget.Resonance, baseline.perTarget.Resonance);
  assert.deepStrictEqual(ranked.utilityOrdered.secured, []);
  assert.deepStrictEqual(ranked.utilityOrdered.unsecured, [{name:NAME, reason:'outbid'}]);
  assert.ok(ranked.chosen.some(c => c.variant.source_item === control.source_item));
  // A filtered pool with ordinary gear but no carrier.
  const ordinary = ds.items.find(i => i.slot === 'Necklace' && !i.artifact && i.ml <= 34 && !i.affixes.some(a => a.name === NAME));
  assert.ok(ordinary);
  const missing = await S.solveLexicographic(model([ordinary], [NAME]), highs);
  assert.deepStrictEqual(missing.utilityOrdered.unsecured, [{name:NAME, reason:'unreachable'}]);
});


test('Imperial Utility compatibility: saved selection survives real serialization and loading', () => {
  const P = require('../web/persist');
  const values = new Map();
  const storage = {getItem:k => values.get(k) || null, setItem:(k,x) => values.set(k,x)};
  for (const utilityContainer of [null, [], ['Ghostly'], [NAME]]) {
    const record = P.serializeCharacter('Isolated test', {utilityContainer}, null, 'test');
    assert.ok(P.saveCharacter(record, storage).ok);
    const restored = P.loadCharacter(record.name, storage);
    assert.deepStrictEqual(restored.inputs.utilityContainer, utilityContainer);
    const m = model(carriers, W.containerList(restored.inputs, v));
    assert.strictEqual(m.utilityCountingSet.has(NAME), !!utilityContainer?.includes(NAME));
  }
});
