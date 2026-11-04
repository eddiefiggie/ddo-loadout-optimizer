// Import merges must never turn an unreadable existing store into an empty one.
const assert = require('assert');
const { test } = require("./_harness");
const C = require('../web/persist.js');
const B = require('../web/saved-bundles.js');
const V = require('../web/versions.js');
const F = require('../web/farming.js');
const stores = [
  { name: 'characters', key: C.STORE_KEY, merge: C.saveMany,
    existing: { Keeper: C.serializeCharacter('Keeper', { ml: 30, priorities: ['Constitution'] }) },
    incoming: { New: C.serializeCharacter('New', { ml: 20 }) }, empty: {}, wrong: '[]' },
  { name: 'bundles', key: B.STORE_KEY, merge: B.mergeIn,
    existing: [B.makeBundle({ id: 'b1', name: 'Keeper', priorities: ['Constitution'] })],
    incoming: [B.makeBundle({ id: 'b2', name: 'New', priorities: ['Strength'] })], empty: [], wrong: '{}' },
  { name: 'versions', key: V.STORE_KEY, merge: V.mergeIn,
    existing: [V.makeVersion({ id: 'v1', kind: 'named', name: 'Keeper' })],
    incoming: [V.makeVersion({ id: 'v2', kind: 'named', name: 'New' })], empty: [], wrong: '{}' },
  { name: 'farming', key: F.PROGRESS_KEY, merge: F.mergeProgress,
    existing: { Keeper: { 'Kept item': true } }, incoming: { New: { 'New item': true } }, empty: {}, wrong: '[]' },
];
for (const store of stores) {
  for (const scenario of ['read throws', 'invalid JSON', 'wrong container', 'empty string']) {
    test(`${store.name}: import refuses when ${scenario} without replacing stored bytes`, () => {
      let raw = scenario === 'invalid JSON' ? '{"Keeper":' : scenario === 'wrong container' ? store.wrong
        : scenario === 'empty string' ? '' : JSON.stringify(store.existing);
      const before = raw;
      let writes = 0;
      const storage = {
        getItem(key) { assert.equal(key, store.key); if (scenario === 'read throws') throw new Error('read failed'); return raw; },
        setItem(key, value) { assert.equal(key, store.key); writes++; raw = value; },
      };
      const result = store.merge(store.incoming, storage);
      assert.equal(writes, 0, 'unreadable data must never be overwritten');
      assert.equal(raw, before);
      assert.equal(result.ok, false);
      assert.equal(result.error, 'read');
    });
  }
  test(`${store.name}: import refuses inaccessible browser storage`, () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage denied'); } });
    try { assert.deepEqual(store.merge(store.incoming), { ok: false, error: 'read', ...(store.name === 'bundles' || store.name === 'versions' ? { full: false } : {}) }); }
    finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else delete globalThis.localStorage;
    }
  });
  test(`${store.name}: readable, empty and absent stores still merge normally`, () => {
    for (const initial of [null, JSON.stringify(store.empty), JSON.stringify(store.existing)]) {
      let raw = initial;
      const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
      assert.equal(store.merge(store.incoming, storage).ok, true);
      const parsed = JSON.parse(raw);
      assert.ok(JSON.stringify(parsed).includes('New'));
      if (initial === JSON.stringify(store.existing)) assert.ok(JSON.stringify(parsed).includes('Keeper'));
    }
  });
  test(`${store.name}: failed write still preserves readable stored bytes`, () => {
    const raw = JSON.stringify(store.existing);
    const storage = { getItem: () => raw, setItem() { const error = new Error('full'); error.name = 'QuotaExceededError'; throw error; } };
    assert.equal(store.merge(store.incoming, storage).ok, false);
    assert.equal(storage.getItem(), raw);
  });
}
