// #951: production data + real HiGHS, flat AC only; no substituted set definitions.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { atest: test, fail } = require("./_harness");
const M = require('../web/model.js'), S = require('../web/solver.js');
const D = require('../web/dataset.js'), P = require('../web/projection.js');
const E = require('../web/exporters.js');
const fixture = require('./fixtures/natural_armor_sets.json');
const data = D.normalizeDataset(JSON.parse(fs.readFileSync(path.join(__dirname, '../web/data/items.json'))));
const vendor = path.join(__dirname, '../web/vendor') + '/';
const Highs = require(vendor + 'highs.js');
const clone = x => JSON.parse(JSON.stringify(x));
const item = id => { const v=data.items.find(v=>v.variant_id===id); assert(v,id); return clone(v); };
const setAC = r => (r.breakdown['Armor Class']||[]).filter(a=>a.sourceKind==='set');
const typed = (r,ty) => (r.breakdown['Armor Class']||[]).filter(a=>a.bonus_type===ty);
function query(ids, extra={}) {
  const pool=ids.map(item);
  return Object.assign({mlCap:36,race:'Human',targets:['Armor Class','Constitution'],
    slotConstraints:Object.fromEntries(pool.map(v=>[v.slot,{type:'pin',variant_id:v.variant_id}]))},extra);
}
function credit(ty,value) {return {[`Armor Class||${ty}`]:{stat:'Armor Class',bonus_type:ty,value}};}
(async()=>{
  const highs=await Highs({locateFile:f=>vendor+f});
  async function solve(ids,extra={},augments=[]) {
    const r=await S.solveLexicographic(M.buildModel([...ids,...augments].map(item),query(ids,extra)),highs);
    assert.strictEqual(r.status,'optimal');
    assert.deepStrictEqual(r.chosen.map(c=>M.originalIdOf(c.variant.variant_id)).sort(),[...ids].sort());
    return r;
  }
  for(const c of fixture.cases) await test(`#951 production thresholds: ${c.name}`,async()=>{
    const r=await solve(c.items);
    assert.strictEqual(r.perTarget['Armor Class'],c.required_correct_gear_ac);
    const ty=c.name.includes('Abishai')?'Profane':'Artifact';
    assert.deepStrictEqual(setAC(r).map(a=>[a.bonus_type,a.value]),c.required_set_ac?[[ty,c.required_set_ac]]:[]);
    if(c.required_set_ac) {
      assert.strictEqual(typed(r,ty).length,1,'two active thresholds must credit only the stronger one');
      assert(P.satisfiedSetDetail(r).some(s=>s.set.includes(c.name.includes('Abishai')?'Abishai':'Wayward')));
    }
  });
  for(const c of fixture.cases.filter(c=>c.name.endsWith('5 pieces')||c.name.endsWith('pair'))) {
    const ty=c.name.includes('Abishai')?'Profane':'Artifact';
    for(const amount of [c.required_set_ac-1,c.required_set_ac,c.required_set_ac+7]) {
      await test(`#951 same-type maximum: ${c.name}, ${amount} ${ty}`,async()=>{
        const r=await solve(c.items,{declaredCredits:credit(ty,amount)});
        assert.strictEqual(r.perTarget['Armor Class'],c.required_correct_gear_ac-c.required_set_ac+Math.max(amount,c.required_set_ac));
        assert.strictEqual(typed(r,ty).length,1);
        assert.strictEqual(typed(r,ty)[0].value,Math.max(amount,c.required_set_ac));
        const active=P.satisfiedSetDetail(r).filter(s=>s.set.includes(c.name.includes('Abishai')?'Abishai':'Wayward'));
        assert(active.length,'a stronger same-type source must not hide the completed set');
      });
    }
    await test(`#951 plain Natural coexists: ${c.name}`,async()=>{
      const baseline=await solve(c.items), oldNatural=typed(baseline,'Natural').reduce((s,a)=>s+a.value,0);
      const r=await solve(c.items,{declaredCredits:credit('Natural',30)});
      assert.strictEqual(r.perTarget['Armor Class'],c.required_correct_gear_ac-oldNatural+30);
      assert.deepStrictEqual(setAC(r).map(a=>[a.bonus_type,a.value]),[[ty,c.required_set_ac]]);
      assert.strictEqual(typed(r,'Natural')[0].value,30);
    });
  }
  for(const [prefix,bonus3,bonus5] of [['',3,5],['Epic ',5,8],['Legendary ',10,10]]) {
    for(const [count,bonus] of [[2,bonus3],[4,bonus5]]) await test(`#951 wildcard ${prefix||'Heroic '}Gem completes ${count+1} pieces`,async()=>{
      const names=['Belt of the Black Abishai','Boots of Corrosion','Ring of the Black Abishai','Pendant of the Black Abishai'].slice(0,count).map(n=>prefix+n);
      const name=prefix+'Might of the Abishai', gem=prefix+'Gem of Many Facets';
      assert(item(gem).joker_set_groups.some(g=>g.includes(name)));
      const r=await solve([...names,gem],{pinnedSets:[name]});
      assert.deepStrictEqual(setAC(r).map(a=>[a.bonus_type,a.value]),[['Profane',bonus]]);
      assert(r.jokerPlaced.some(p=>p.host===gem&&p.set===name));
      assert(P.satisfiedSetDetail(r).some(s=>s.set===name));
    });
  }
  await test('#951 mixed Abishai tiers do not combine to meet a threshold',async()=>{
    const r=await solve(['Belt of the Black Abishai','Epic Boots of Corrosion','Legendary Ring of the Black Abishai']);
    assert.strictEqual(r.perTarget['Armor Class'],0);
    assert.strictEqual(setAC(r).length,0);
  });
  await test('#951 Profane and Artifact coexist with Natural in a real seven-piece loadout',async()=>{
    const c=fixture.cases.find(c=>c.name==='Legendary Might of the Abishai 5 pieces');
    const r=await solve([...c.items,"Legendary Giant's Platter",'Legendary Scales of the Exile']);
    assert.strictEqual(r.perTarget['Armor Class'],107);
    assert.deepStrictEqual(setAC(r).map(a=>[a.bonus_type,a.value]).sort(),[['Artifact',5],['Profane',10]]);
    assert.strictEqual(typed(r,'Natural')[0].value,13);
  });
  await test('#951 existing Lunar gems share the canonical Profane maximum',async()=>{
    // Real, previously supported Moon host and augments; preserve their existing
    // Profane Natural -> Profane equivalence when the set competes with them.
    for(const name of ['Might of the Abishai 5 pieces','Epic Might of the Abishai 5 pieces']) {
      const c=fixture.cases.find(c=>c.name===name);
      for(const [tier,amount] of [['Heroic',5],['Legendary',10]]) {
        const r=await solve([...c.items,'Balorskin Gauntlets'],{},[`Lunar Gem of Natural Armor (${tier})`]);
        assert.strictEqual(r.perTarget['Armor Class'],c.current_observed_gear_ac+Math.max(c.required_set_ac,amount));
        assert.strictEqual(typed(r,'Profane').length,1);
      }
    }
  });
  await test('#951 set pin without sufficient pieces cannot create AC',async()=>{
    const c=fixture.cases[0],r=await solve(c.items,{pinnedSets:['Might of the Abishai']});
    assert.strictEqual(r.perTarget['Armor Class'],0);
    assert.strictEqual(setAC(r).length,0);
    assert(r.setPinReport.some(p=>p.set==='Might of the Abishai'&&p.verdict==='unreachable'));
  });
  await test('#951 shared projection and saved exports preserve AC attribution',async()=>{
    const c=fixture.cases.find(c=>c.name==='Wayward Warrior (Legendary) pair'),r=await solve(c.items);
    assert.strictEqual(r.perTarget['Armor Class'],97);
    assert.deepStrictEqual(setAC(r).map(a=>[a.bonus_type,a.value]),[['Artifact',5]]);
    const saved=clone(r);
    assert.deepStrictEqual(setAC(saved),setAC(r));
    assert(P.satisfiedSetDetail(saved).some(s=>s.set==='Wayward Warrior (Legendary)'));
    const rec={name:'Natural Armor verification',inputs:{ml:36,priorities:['Armor Class']},query:query(c.items),snapshot:saved};
    for(const format of ['toMarkdown','toCsv','toPrintHtml','toBBCode']) {
      const text=E[format](rec);
      assert(text.includes('Armor Class')&&text.includes('97'),format);
    }
    assert(JSON.stringify(E.toPortableJSON(rec)).includes('Artifact'));
  });
  await test('#951 display suppression removes a replaced native set member',async()=>{
    const c=fixture.cases.find(c=>c.name==='Might of the Abishai 3 pieces'),r=await solve(c.items);
    assert.deepStrictEqual(setAC(r).map(a=>a.value),[3]);
    r.setsActive=[];
    r.setAugmentsPlaced=[{set:'Synthetic display fixture',host:c.items[0]}];
    assert(!P.satisfiedSetDetail(r).some(s=>s.set==='Might of the Abishai'));
  });
})().catch(e=>fail('#951 fixture initialization',e));
