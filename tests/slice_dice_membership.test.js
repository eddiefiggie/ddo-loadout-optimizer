// #953/#951 — real catalog, real HiGHS; only the Wiki-verified paired Seeker bonus.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { atest: test, fail } = require("./_harness");
const M = require('../web/model.js'), S = require('../web/solver.js');
const D = require('../web/dataset.js'), P = require('../web/projection.js');
const R = require('../web/results.js');
const E = require('../web/exporters.js');
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../web/data/items.json')));
const data = D.normalizeDataset(raw);
const vendor = path.join(__dirname, '../web/vendor') + '/';
const Highs = require(vendor + 'highs.js');
const clone = x => JSON.parse(JSON.stringify(x));
const item = id => clone(data.items.find(v => v.variant_id === id));
const isSlice = s => s.set === "Slice 'n Dice" || s.set === "Epic Slice 'n Dice";
const active = r => r.setsActive.filter(isSlice);
const setGrant = r => (r.breakdown.Seeker || []).filter(a => a.sourceKind === 'set');
function query(ids, extra = {}) {
  return Object.assign({ mlCap: 28, targets: ['Seeker', 'Armor-Piercing', 'Deception'], style: 'one-hand',
    twoWeaponFighting: true, weaponTypes: ['Daggers'], offHandWeapons: ['Daggers'],
    slotConstraints: {'Main Hand': {type:'pin', variant_id:ids[0]},
      'Off Hand': ids[1] ? {type:'pin', variant_id:ids[1]} : {type:'empty'}} }, extra);
}
function assertPins(r, ids) {
  for(const [slot,id] of [['Main Hand',ids[0]],['Off Hand',ids[1]]]) {
    const got=r.chosen.filter(c=>c.slot===slot).map(c=>M.originalIdOf(c.variant.variant_id));
    assert.deepStrictEqual(got,id?[id]:[]);
  }
}
function assertMembership(v) {
  const name=v.variant_id.startsWith('Epic ')?"Epic Slice 'n Dice":"Slice 'n Dice";
  assert((v.set_bonus||[]).some(s=>s.set===name), 'real catalog must carry the reviewed membership');
}
(async()=>{
  const highs=await Highs({locateFile:f=>vendor+f});
  async function solve(ids, extra={}, pool=null) {
    const r=await S.solveLexicographic(M.buildModel(pool||[...new Set(ids)].map(item),query(ids,extra)),highs);
    assert.strictEqual(r.status,'optimal'); assertPins(r,ids); return r;
  }
  for(const [prefix,insight,quality,deception,ap] of [['',3,1,2,15],['Epic ',6,2,6,20]]) {
    const a=prefix+'Slice', b=prefix+'Dice';
    for(const ids of [[a,b],[b,a]]) await test(`#953 paired Seeker: ${ids.join(' + ')}`,async()=>{
      const r=await solve(ids);
      assert.strictEqual(r.perTarget.Seeker,insight+quality);
      assert.strictEqual(r.perTarget.Deception,deception,'ambiguous set line must add nothing');
      assert.strictEqual(r.perTarget['Armor-Piercing'],ap);
      assert.strictEqual(active(r).length,1);
      assert.deepStrictEqual(setGrant(r).map(x=>[x.value,x.bonus_type]),[[quality,'Quality']]);
      assert(P.satisfiedSetDetail(r).some(isSlice));
    });
    for(const value of [quality-1,quality,quality+3]) await test(`#953 Quality maximum: ${prefix||'Heroic '}${value}`,async()=>{
      const credits=value?{'Seeker||Quality':{stat:'Seeker',bonus_type:'Quality',value}}:{};
      const r=await solve([a,b],{declaredCredits:credits});
      assert.strictEqual(r.perTarget.Seeker,insight+Math.max(quality,value));
      assert.strictEqual((r.breakdown.Seeker||[]).filter(x=>x.bonus_type==='Quality').length,1);
      assert(P.satisfiedSetDetail(r).some(isSlice),'completed pair remains visible when a stronger Quality source wins');
    });
    for(const ids of [[a],[b],[a,a],[b,b]]) await test(`#953 no unsupported set credit: ${ids.join(' + ')}`,async()=>{
      ids.forEach(id=>assertMembership(item(id))); // non-vacuous against the shipped data
      const r=await solve(ids);
      assert.strictEqual(r.perTarget.Seeker,ids.includes(a)?insight:0);
      assert.strictEqual(active(r).length,0);
      assert.strictEqual(setGrant(r).length,0);
      assert(!P.satisfiedSetDetail(r).some(isSlice));
      assert(![...P.satisfiedSets(r.chosen,r.setsActive)].some(x=>x.includes('Slice')));
    });
    await test(`#953 unpinned search preserves both ${prefix||'Heroic '}members`,async()=>{
      const q=query([a,b],{slotConstraints:{},targets:['Seeker']});
      const r=await S.solveLexicographic(M.buildModel([item(a),item(b)],q),highs);
      assert.strictEqual(r.perTarget.Seeker,insight+quality);
      assert.deepStrictEqual(r.chosen.map(c=>M.originalIdOf(c.variant.variant_id)).sort(),[a,b].sort());
    });
  }
  for(const ids of [['Slice','Epic Dice'],['Epic Slice','Dice']]) await test(`#953 mixed tiers: ${ids.join(' + ')}`,async()=>{
    ids.forEach(id=>assertMembership(item(id)));
    const r=await solve(ids);
    assert.strictEqual(r.perTarget.Seeker,ids[0]==='Slice'?3:6);
    assert.strictEqual(active(r).length,0);
    assert(!P.satisfiedSetDetail(r).some(isSlice));
  });
  await test('#953 real paired set pins are reachable; missing required item is disclosed',async()=>{
    const name="Slice 'n Dice";
    const q=query(['Slice','Dice'],{pinnedSets:[name],targets:['Armor-Piercing']});
    const model=M.buildModel([item('Slice'),item('Dice')],q);
    const r=await S.solveLexicographic(model,highs);
    assert.strictEqual(r.status,'optimal'); assert.strictEqual(active(r).length,1);
    const missing=M.classifySetPins({pinnedSets:[name]},[item('Slice')],{},{});
    assert.strictEqual(missing.report[0].verdict,'unreachable');
    assert(missing.report[0].why.includes('Slice + Dice'));
  });
  await test('#953 a set pin cannot override duplicate dagger pins',async()=>{
    const name="Slice 'n Dice";
    const r=await solve(['Slice','Slice'],{pinnedSets:[name]},[item('Slice'),item('Dice')]);
    assert.strictEqual(r.perTarget.Seeker,3);
    assert.strictEqual(active(r).length,0);
    assert(r.setPinReport.some(p=>p.set===name&&p.verdict==='conflict'));
  });
  await test('#953 reviewed requirements constrain duplicate activation independently of item ingestion',async()=>{
    // Synthetic interface fixture: no claim about a further DDO set.
    const v=item('Slice');
    v.set_bonus=[{set:'Reviewed pair',required_items:['Slice','Dice']}];
    v.parsed_set_bonuses=[{set:'Reviewed pair',pieces_required:2,pieces_label:'2 Pieces',required_items:['Slice','Dice'],
      affixes:[{stat:'Seeker',bonus_type:'Quality',value:1}]}];
    const r=await solve(['Slice','Slice'],{},[v]);
    assert.strictEqual(r.perTarget.Seeker,3);
    assert.strictEqual(r.setsActive.length,0);
    assert.strictEqual(P.satisfiedSetDetail(r).length,0);
    assert.strictEqual(P.satisfiedSets(r.chosen,r.setsActive).size,0);
  });
  await test('#953 shared projection discloses excluded effects in result and exports',async()=>{
    const r=await solve(['Slice','Dice']);
    const lines=P.conditionalNoticeLines({snapshot:r,query:query(['Slice','Dice'])});
    assert.strictEqual(lines.filter(x=>x.includes("Slice 'n Dice:")).length,1,'deduplicate two members');
    assert(lines.some(x=>x.includes('Sneak Attack bonus is excluded')));
    assert(lines.some(x=>x.includes('Two copies of one dagger')));
    assert(R.conditionalNotice(query(['Slice','Dice']),r).includes('Sneak Attack bonus is excluded'));
    assert.strictEqual(R.NOTICES.find(n=>n.name==='conditionalNotice').title,'EFFECT CONDITIONS AND LIMITS');
    const rec={name:'Pair verification',inputs:{ml:28,priorities:['Seeker'],style:'one-hand'},
      query:query(['Slice','Dice']),snapshot:r};
    for(const format of ['toMarkdown','toCsv','toPrintHtml','toBBCode']) {
      assert(E[format](rec).includes('Sneak Attack bonus is excluded'),format+' must disclose the same limitation');
    }
    assert(JSON.stringify(E.toPortableJSON(rec)).includes('Sneak Attack bonus is excluded'));
    const copy=clone(r);
    assert.deepStrictEqual(P.conditionalNoticeLines({snapshot:copy,query:query(['Slice','Dice'])}),lines,'saved snapshots keep the evidence boundary');
    assert.deepStrictEqual(P.conditionalNoticeLines({snapshot:{chosen:[]},query:{targets:[]}}),[],'no unrelated boilerplate');
  });
  await test('#953 other-set preservation: both daggers still count toward Devils Handiwork',async()=>{
    const ids=['Slice','Dice'], other=["Barbette's Bracers","Eagle's Eye","Lion's Mane"];
    const q=query(ids,{targets:['Seeker','Strength']});
    for(const id of other){const v=item(id);q.slotConstraints[v.slot]={type:'pin',variant_id:id};}
    const r=await S.solveLexicographic(M.buildModel([...ids,...other].map(item),q),highs);
    assert.strictEqual(r.status,'optimal');
    assert.deepStrictEqual(setGrant(r).map(x=>[x.value,x.bonus_type]),[[1,'Quality']]);
    const devil=r.setsActive.find(s=>s.set==="The Devil's Handiwork");
    assert(devil&&devil.pieces_required===5);
    assert((r.breakdown.Strength||[]).some(a=>a.sourceKind==='set'&&a.bonus_type==='Quality'&&a.value===2));
  });
  await test('#953 set-augment display suppression also removes the required member',async()=>{
    const r=await solve(['Slice','Dice']);
    assert(P.satisfiedSetDetail(r).some(isSlice),'verify the pair completes before suppressing a member');
    r.setsActive=[];
    r.setAugmentsPlaced=[{set:'Synthetic augment set',host:'Dice'}];
    assert(!P.satisfiedSetDetail(r).some(isSlice));
    assert(!P.satisfiedSets(r.chosen,[],P.suppressedHostIds(r)).has("Slice 'n Dice"));
  });
})().catch(e=>fail('#953 fixture initialization',e));
