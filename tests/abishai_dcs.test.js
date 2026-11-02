// #951: preserve current production focus behavior during comparison-only work.
// Three-piece scope remains unverified by the retained Wiki wording. These are
// unchanged-behavior checks, not a new ruling about those game mechanics.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { atest: test, fail } = require("./_harness");
const D = require('../web/dataset.js'), M = require('../web/model.js'), S = require('../web/solver.js');
const data = D.normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, '../web/data/items.json'))));
const fixture = require('./fixtures/natural_armor_sets.json');
const vendor = path.join(__dirname, '../web/vendor') + '/';
const schools = ['Abjuration Focus', 'Conjuration Focus', 'Enchantment Focus', 'Evocation Focus',
  'Illusion Focus', 'Necromancy Focus', 'Transmutation Focus'];
const excluded = ['Stunning', 'Vertigo', 'Shatter', 'Assassinate', 'Rune Arm Focus'];
const targets = [...schools, ...excluded];
const item = id => { const v = data.items.find(x => x.variant_id === id); assert(v, id); return v; };
const typed = (r, stat) => (r.breakdown[stat] || []).filter(a => a.bonus_type === 'Profane');
function currentAmount(c) {
  const n = c.items.length;
  return n < 3 ? 0 : c.name.startsWith('Legendary') ? (n === 5 ? 3 : 2)
    : c.name.startsWith('Epic') ? 2 : (n === 5 ? 2 : 1);
}
(async () => {
  const highs = await require(vendor + 'highs.js')({ locateFile: f => vendor + f });
  async function solve(ids, extra = {}) {
    const pool = ids.map(item), query = { mlCap: 36, race: 'Human', targets,
      slotConstraints: Object.fromEntries(pool.map(v => [v.slot, { type: 'pin', variant_id: v.variant_id }])),
      ...extra };
    const r = await S.solveLexicographic(M.buildModel(pool, query), highs);
    assert.strictEqual(r.status, 'optimal');
    return r;
  }
  for (const c of fixture.cases.filter(c => c.name.includes('Abishai'))) {
    await test('#951 preserve production school focus: ' + c.name, async () => {
      const r = await solve(c.items), expected = currentAmount(c);
      for (const stat of targets) {
        const grants = (r.breakdown[stat] || []).filter(a => a.sourceKind === 'set');
        assert.deepStrictEqual(grants.map(a => [a.bonus_type, a.value]),
          !excluded.includes(stat) && expected ? [['Profane', expected]] : [], stat);
      }
    });
  }
  for (const c of fixture.cases.filter(c => c.name.includes('Abishai') && c.name.endsWith('5 pieces'))) {
    const base = currentAmount(c);
    for (const value of [base - 1, base, base + 5]) {
      await test('#951 five-piece same-type maximum: ' + c.name + ', declared ' + value, async () => {
        const declaredCredits = Object.fromEntries(schools.map(stat =>
          [stat + '||Profane', { stat, bonus_type: 'Profane', value }]));
        const r = await solve(c.items, { declaredCredits });
        for (const stat of schools) {
          const rows = typed(r, stat);
          assert.strictEqual(rows.length, 1);
          assert.strictEqual(rows[0].value, Math.max(base, value));
        }
      });
    }
  }
  await test('#951 mixed Abishai tiers supply no direct school or tactical set bonus', async () => {
    const r = await solve(['Belt of the Black Abishai', 'Epic Boots of Corrosion', 'Legendary Ring of the Black Abishai']);
    for (const stat of targets)
      assert.strictEqual((r.breakdown[stat] || []).filter(a => a.sourceKind === 'set').length, 0);
  });
  for (const prefix of ['', 'Epic ', 'Legendary ']) {
    await test('#951 preserve five-piece wildcard focus: ' + (prefix || 'Heroic'), async () => {
      const ids = ['Belt of the Black Abishai', 'Boots of Corrosion', 'Ring of the Black Abishai',
        'Pendant of the Black Abishai'].map(n => prefix + n);
      const set = prefix + 'Might of the Abishai', gem = prefix + 'Gem of Many Facets';
      ids.push(gem);
      // Epic focus is +2 at both counts. AC makes assigning the fifth piece
      // observable; focus alone must not be claimed to require that assignment.
      const r = await solve(ids, { pinnedSets: [set], targets: [...targets, 'Armor Class'] });
      const expected = prefix === 'Legendary ' ? 3 : 2;
      for (const stat of schools) {
        const grants = (r.breakdown[stat] || []).filter(a => a.sourceKind === 'set');
        assert.deepStrictEqual(grants.map(a => [a.bonus_type, a.value]), [['Profane', expected]]);
      }
      assert(r.jokerPlaced.some(a => a.host === gem && a.set === set));
    });
  }
})().catch(e => fail('#951 Abishai preservation fixture initialization', e));
