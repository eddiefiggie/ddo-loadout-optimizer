// #951 — preservation cases: comparison interpretation must not change production totals.
// Source: docs/wiki-evidence/abishai-amplification.md. These intentionally pass
// before the comparison change, using the real dataset and HiGHS solver.
const { atest: test, fail } = require("./_harness");
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '../web');
const D = require(root + '/dataset.js'), M = require(root + '/model.js'), S = require(root + '/solver.js');
const data = D.normalizeDataset(JSON.parse(fs.readFileSync(root + '/data/items.json')));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/natural_armor_sets.json')));
const target = ['Healing Amplification', 'Negative Amplification', 'Repair Amplification'];
const setName = 'Legendary Might of the Abishai';
const item = id => { const v=data.items.find(x=>x.variant_id===id); assert(v,id); return v; };
(async()=>{
  const vendor = root + '/vendor/';
  const highs = await require(vendor + 'highs.js')({locateFile:f=>vendor+f});
  async function solve(name, ids, expected, extras={}, mode='set') {
    const pool=ids.map(item);
    const query={mlCap:36,race:'Human',targets:target,
      slotConstraints:Object.fromEntries(pool.map(v=>[v.slot,{type:'pin',variant_id:v.variant_id}])),...extras};
    const result=await S.solveLexicographic(M.buildModel(pool,query),highs);
    assert.strictEqual(result.status,'optimal',name);
    for(const stat of target){
      const rows=result.breakdown[stat]||[];
      if(mode==='set'){
        const grants=rows.filter(a=>a.sourceKind==='set' && a.bonus_type==='Profane');
        assert.deepStrictEqual(grants.map(a=>a.value),expected?[expected]:[],name+' '+stat);
      }else if(mode==='profane'){
        assert.deepStrictEqual(rows.filter(a=>a.bonus_type==='Profane').map(a=>a.value),[expected[stat]],name+' '+stat);
      }else if(mode==='different-type'){
        assert.deepStrictEqual(rows.filter(a=>a.bonus_type==='Profane').map(a=>a.value),[30],name+' '+stat);
        assert.deepStrictEqual(rows.filter(a=>a.bonus_type==='Artifact').map(a=>a.value),[7],name+' '+stat);
      }
    }
    return result;
  }
  const legendary=fixture.cases.filter(c=>c.name.startsWith('Legendary Might'));
  for(const c of legendary) await test(c.name + ' amplification threshold',
    () => solve(c.name,c.items,c.items.length<3?0:c.items.length<5?10:30));
  for(const prefix of ['', 'Epic '])
    for(const n of [3,5]){
      const c=fixture.cases.find(c=>c.name===prefix+'Might of the Abishai '+n+' pieces');
      assert(c);await test(c.name+' amplification negative', () => solve(c.name,c.items,0));
    }
  for(const count of [3,5]){
    const c=legendary.find(c=>c.items.length===count),base=count===3?10:30;
    for(const value of [base-5,base,base+5]){
      const declaredCredits=Object.fromEntries(target.map(stat=>[stat+'||Profane',{stat,bonus_type:'Profane',value}]));
      await test(count+' pieces with declared '+value+' Profane', () =>
        solve(c.name,c.items,Object.fromEntries(target.map(s=>[s,Math.max(base,value)])),{declaredCredits},'profane'));
    }
  }
  const five=legendary.find(c=>c.items.length===5);
  for(const creditedStat of target){
    const declaredCredits={[creditedStat+'||Profane']:{stat:creditedStat,bonus_type:'Profane',value:35}};
    await test('Independent channel '+creditedStat, () =>
      solve(creditedStat,five.items,Object.fromEntries(target.map(s=>[s,s===creditedStat?35:30])),{declaredCredits},'profane'));
  }
  await test('Different Artifact type coexists', () =>
    solve('Artifact coexistence',five.items,null,{declaredCredits:Object.fromEntries(target.map(stat=>[stat+'||Artifact',{stat,bonus_type:'Artifact',value:7}]))},'different-type'));
  await test('Mixed-tier amplification negative', () =>
    solve('Mixed tiers',['Belt of the Black Abishai','Epic Boots of Corrosion','Legendary Ring of the Black Abishai'],0));
  for(const count of [3,5]){
    const c=legendary.find(c=>c.items.length===count);
    const ids=c.items.slice(0,-1).concat('Legendary Gem of Many Facets');
    await test(count+' piece wildcard amplification', async () => {
      const r=await solve(count+' piece wildcard',ids,count===3?10:30,{pinnedSets:[setName]});
      assert(r.jokerPlaced.some(x=>x.host==='Legendary Gem of Many Facets' && x.set===setName));
    });
  }
  await test('Every production Legendary Abishai carrier retains both typed amplification tiers', () => {
    const carriers=data.items.filter(v=>(v.parsed_set_bonuses||[]).some(t=>t.set===setName));
    assert(carriers.length > 0, 'no Legendary Abishai carriers inspected');
    const carrierRows=carriers.map(v=>({id:v.variant_id,tiers:v.parsed_set_bonuses.filter(t=>t.set===setName).map(t=>({pieces:t.pieces_required,affixes:t.affixes.filter(a=>target.includes(a.stat))}))}));
    for(const c of carrierRows){
      assert.deepStrictEqual(c.tiers.map(t=>t.pieces),[3,5],c.id);
      for(const t of c.tiers) assert.deepStrictEqual(t.affixes.map(a=>[a.stat,a.bonus_type,a.value]),target.map(s=>[s,'Profane',t.pieces===3?10:30]),c.id);
    }
  });
})().catch(e => fail('Abishai amplification fixture setup', e));
