// The wiki-delta snippet (scripts/browser/harvest_wiki_delta.js) under a throttled wiki.
// Run: node tests/wiki-delta-snippet.test.js
//
// On 2026-10-24 ddowiki throttled the snippet's first RecentChanges read (HTTP 202,
// empty body). The old `api()` swallowed it as `{}`, the loop saw no changes, and
// the run finished `done: true` with 0 items, a clean-looking delta that had read
// nothing. These tests run the snippet in a browser-shaped vm context against a
// fake wiki and pin three rules: a throttled read refreshes clearance and retries,
// an unreadable RecentChanges never reports done, and neither does an empty one.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { atest } = require("./_harness");

const SRC = fs.readFileSync(path.join(__dirname, "..", "scripts", "browser", "harvest_wiki_delta.js"), "utf8");

/** Run the snippet against `respond(params, call)`, which returns a response body
 *  string ("" is a throttled answer). Timers fire at once. */
async function run(respond) {
  const seen = { iframes: 0, calls: 0 };
  const ctx = vm.createContext({
    console: { log() {} },
    URLSearchParams,
    setTimeout: (fn) => setImmediate(fn),
    fetch: async (url, opts) => {
      const params = Object.fromEntries(opts.body);
      const body = respond(params, seen.calls++);
      return { status: body ? 200 : 202, text: async () => body };
    },
    document: {
      createElement: () => ({ style: {}, remove() {} }),
      body: { appendChild(f) { seen.iframes++; setImmediate(() => f.onload && f.onload()); } },
    },
    DOMParser: class { parseFromString() { return { querySelectorAll: () => [] }; } },
  });
  ctx.window = ctx;
  await vm.runInContext(SRC, ctx);
  return { D: ctx.window.__delta, seen };
}

const RC = (titles) => JSON.stringify({ query: { recentchanges: titles.map((t) => ({ type: "edit", title: "Item:" + t })) } });
const PAGE = JSON.stringify({ query: { pages: { 1: { revisions: [{ slots: { main: { "*": "{{Named item\n| minimum level = 20\n}}" } } }] } } } });
const PARSE = JSON.stringify({ parse: { text: { "*": "<p></p>" } } });
const wiki = (rc) => (p) => (p.list === "recentchanges" ? rc : p.action === "parse" ? PARSE : PAGE);

(async () => {
  await atest("a RecentChanges read that stays throttled never reports done", async () => {
    const { D, seen } = await run(() => "");
    assert.strictEqual(D.done, false);
    assert.match(D.state, /RecentChanges unreadable/);
    assert.strictEqual(Object.keys(D.items).length, 0);
    assert.ok(seen.iframes >= 1, "each throttled attempt should refresh clearance");
    assert.strictEqual(D.summaryText, undefined, "no summary is offered for a failed run");
  });

  await atest("a throttled RecentChanges read refreshes clearance, retries and finishes", async () => {
    const answer = wiki(RC(["Hexblood Crown", "Spectral Dagger (level 36)"]));
    const { D, seen } = await run((p, n) => (n === 0 ? "" : answer(p)));
    assert.strictEqual(D.done, true);
    assert.strictEqual(D.state, "done");
    assert.strictEqual(D.throttles, 1);
    assert.strictEqual(seen.iframes, 1);
    assert.deepStrictEqual(Object.keys(D.items).sort(), ["Hexblood Crown", "Spectral Dagger (level 36)"]);
    assert.strictEqual(D.items["Hexblood Crown"].missing, false);
    assert.strictEqual(D.items["Hexblood Crown"].ml, "20");
  });

  await atest("a readable but empty RecentChanges never reports done", async () => {
    const { D } = await run(wiki(RC([])));
    assert.strictEqual(D.done, false);
    assert.match(D.state, /0 Item: pages/);
  });
})();
