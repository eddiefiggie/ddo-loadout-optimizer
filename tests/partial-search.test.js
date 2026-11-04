// #928: discovery of an existing exact-name target must not reclassify effects.
const assert = require('assert');
const { test } = require("./_harness");
const D = require('../web/dataset.js');
const W = require('../web/wizard.js');
const NAME = 'Melody: Imperial Resonance';
const fixture = (affixes) => ({ items: [{ affixes }], metadata: { rankable_affixes: ['Strength'] } });

test('partial discovery: the existing Bool target appears in priority autocomplete', () => {
  const v = D.buildPickerVocabulary(fixture([{ name: NAME, type: 'Bool', value: 1 }]));
  for (const query of ['melody', 'imperial', 'resonance']) {
    assert.ok(W.datalistStats(v).filter(n => n.toLowerCase().includes(query)).includes(NAME), query);
  }
});

test('partial discovery: absence and non-Bool records cannot manufacture a suggestion', () => {
  for (const affixes of [[], [{name: NAME, type: 'Equipment', value: 30}]]) {
    assert.ok(!D.buildPickerVocabulary(fixture(affixes)).suggestions.includes(NAME));
  }
});

test('partial discovery: colon noise and parsed compound names remain excluded', () => {
  const blocked = ['Clicky: Haste', 'See: Eveningstar Challenge Pack', 'Spell Power: Fire', 'Melody: Imperial Resonance +30'];
  const v = D.buildPickerVocabulary(fixture(blocked.map(name => ({name, type:'Bool', value:1}))));
  for (const name of blocked) assert.ok(!v.suggestions.includes(name), name);
});

test('partial discovery: the shipped target is discoverable without changing classification', () => {
  const raw = require('../web/data/items.json');
  const ds = D.normalizeDataset(JSON.parse(JSON.stringify(raw)));
  const before = JSON.stringify(ds);
  const v = D.buildPickerVocabulary(ds);
  assert.ok(ds.items.some(it => it.affixes.some(a => a.name === NAME && a.type === 'Bool')));
  assert.ok(v.suggestions.includes(NAME));
  assert.ok(v.known.has(NAME));
  assert.ok(!v.presence.has(NAME));
  assert.ok(!v.magnitude.has(NAME));
  assert.ok(!v.utilityCounting.has(NAME));
  assert.ok(!v.utilityNotCounted.has(NAME));
  assert.ok(!v.utilityOrder.includes(NAME));
  assert.deepStrictEqual(W.containerAddable(v, [], 'imperial'), []);
  assert.ok(W.resolvePriorityAdd(NAME, v, []).ok);
  assert.strictEqual(JSON.stringify(ds), before, 'vocabulary construction does not mutate item data');
});
