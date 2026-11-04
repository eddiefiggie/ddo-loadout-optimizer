// Exercise the real classic-script bridges and data-panel handlers without CommonJS.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { test } = require("./_harness");
const web = path.join(__dirname, "..", "web");
function browser() {
  const values = new Map();
  const elements = Object.fromEntries(["wz-export-panel", "wz-import-label-panel", "wz-import-panel", "wz-data-stat-panel", "wz-stored-host-panel"].map(id => [id, {}]));
  const buttons = ["named", "import", "auto"].map(kind => ({ dataset: { delKind: "versions", delId: kind } }));
  elements["wz-stored-host-panel"].querySelectorAll = () => buttons;
  const ctx = vm.createContext({ console, localStorage: { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) },
    document: { getElementById: id => elements[id] },
    storedItemsHTML: () => "", storedItemsModel: value => value, renderRail() {}, currentBuildId: () => "fixture",
    FileReader: class { readAsText(file) { this.result = file.text; this.onload(); } },
  });
  ctx.window = ctx;
  const scripts = ["weapon-taxonomy.js", "cross-add.js", "model.js", "crafting-systems.js", "projection.js", "persist.js", "backup.js", "versions.js", "saved-bundles.js", "farming.js"];
  const index = fs.readFileSync(path.join(web, "index.html"), "utf8");
  scripts.sort((a,b) => index.indexOf(`src="${a}?`) - index.indexOf(`src="${b}?`));
  for (const file of scripts) {
    assert.ok(index.includes(`src="${file}?`), `${file} is on the page`);
    vm.runInContext(fs.readFileSync(path.join(web,file), "utf8"),ctx,{filename:file});
  }
  assert.equal(vm.runInContext("typeof require",ctx), "undefined");
  assert.equal(vm.runInContext("typeof Versions",ctx), "undefined", "no invented alias may mask the defect");
  ctx._savedBundles = () => ctx.SavedBundles;
  ctx.downloadFile = (_,text) => { ctx.downloaded = text; };
  ctx.confirm = text => { ctx.confirmation = text; return false; };
  // Run the actual handler, not a copy of its export/import/delete logic.
  const source = fs.readFileSync(path.join(web,"wizard.js"), "utf8");
  const start = source.indexOf("    function wireDataManagement(ns) {");
  const end = source.indexOf("    // ---- on-demand Item Browser", start);
  assert.ok(start >= 0 && end > start, "production handler boundaries resolve");
  vm.runInContext(source.slice(start,end),ctx);
  vm.runInContext(`
    const records = ["named", "import", "auto"].map(kind => VersionStore.makeVersion({
      id:kind,kind,name:kind,savedAt:"2026-01-01",buildId:"original-catalog",inputs:{ml:20},query:{targets:["Constitution"]},
      result:{status:"optimal",chosen:[],effective:{Constitution:7}}
    }));
    for (const record of records) VersionStore.saveVersion(record);
    wireDataManagement("panel");
  `,ctx);
  return { ctx, elements, buttons, values };
}
const plain = value => JSON.parse(JSON.stringify(value));

test("browser backup parser retains named and imported history through the real global", () => {
  const {ctx} = browser();
  const result = vm.runInContext(`BackupIO.parseAny(JSON.stringify(BackupIO.serializeAll({}, { versions:records })))`,ctx);
  assert.equal(result.ok,true);
  assert.deepEqual(plain(result.versions).map(v=>v.kind).sort(),["import","named"]);
  assert.equal(result.versions[0].snapshot.effective.Constitution,7);
  assert.equal(result.versions[0].stampedBuildId,"original-catalog");
});
test("browser Export all carries authored history and excludes automatic snapshots", () => {
  const {ctx,elements} = browser();
  elements["wz-export-panel"].onclick();
  const exported = JSON.parse(ctx.downloaded);
  assert.deepEqual(exported.versions.map(v=>v.kind).sort(),["import","named"]);
  assert.deepEqual(exported.versions,plain(ctx.VersionStore.authoredVersions()));
});
test("browser import handler restores authored snapshots and reports their actual count", () => {
  const {ctx,elements,values} = browser();
  const file = vm.runInContext(`JSON.stringify(BackupIO.serializeAll({}, {versions:records}))`,ctx);
  values.clear();
  elements["wz-import-panel"].onchange({target:{files:[{name:"backup.json",text:file}]}});
  assert.deepEqual(plain(ctx.VersionStore.listVersions()).map(v=>v.kind).sort(),["import","named"]);
  assert.match(elements["wz-data-stat-panel"].textContent,/2 version snapshots/);
  // Restoring the same file twice must retain the store's existing idempotence.
  elements["wz-import-panel"].onchange({target:{files:[{name:"backup.json",text:file}]}});
    const restored = plain(ctx.VersionStore.listVersions());
  assert.equal(restored.length,2);
  for (const record of restored) {
    assert.equal(record.snapshot.effective.Constitution,7);
    assert.equal(record.stampedBuildId,"original-catalog");
    assert.deepEqual(record.inputs,{ml:20});
    assert.deepEqual(record.query,{targets:["Constitution"]});
  }
});
for (const kind of ["named","import"]) {
  test(`browser deletion warning recognizes ${kind} history as backed up`, () => {
    const {ctx,buttons} = browser();
    buttons.find(b=>b.dataset.delId===kind).onclick();
    assert.match(ctx.confirmation,/restore it from a backup taken while it still existed/);
    assert.equal(ctx.VersionStore.listVersions().length,3,"declining leaves storage untouched");
  });
}
test("browser auto deletion warning and legacy backups remain compatible", () => {
  const {ctx,buttons} = browser();
  buttons.find(b=>b.dataset.delId==="auto").onclick();
  assert.match(ctx.confirmation,/captured automatically.*cannot be restored/);
  for (const schema_version of [1,2]) {
    const result = ctx.BackupIO.parseAny(JSON.stringify({schema_version,characters:{}}));
    assert.equal(result.ok,true);
    assert.equal(result.versions.length,0);
  }
});

test("browser import reports a failed version write rather than a successful restore", () => {
  const {ctx,elements,values} = browser();
  const file = vm.runInContext(`JSON.stringify(BackupIO.serializeAll({}, {versions:records}))`,ctx);
  values.clear();
  const setItem = ctx.localStorage.setItem;
  ctx.localStorage.setItem = (key,value) => {
    if (key === ctx.VersionStore.STORE_KEY) { const error = new Error("full"); error.name = "QuotaExceededError"; throw error; }
    setItem(key,value);
  };
  elements["wz-import-panel"].onchange({target:{files:[{name:"backup.json",text:file}]}});
  assert.match(elements["wz-data-stat-panel"].textContent,/version snapshots could not be saved/);
  assert.match(elements["wz-data-stat-panel"].className,/warn/);
  assert.equal(ctx.VersionStore.listVersions().length,0);
});
