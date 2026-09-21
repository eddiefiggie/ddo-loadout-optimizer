// #830 — every CSS custom property the stylesheet USES is one it DEFINES.
//
// `var(--line)` appeared six times and `--line` was never defined; `var(--fg)`
// twice, likewise. CSS does not fall back to the previous rule here: a `var()`
// naming an undefined property is invalid at computed-value time, so the whole
// DECLARATION computes to its initial value (or, for an inherited property like
// `color`, to the inherited one). Two `:hover` rules did nothing, two bar tracks
// rendered transparent, two borders did not exist, and two colours silently
// inherited.
//
// None of it looked wrong in the source, which is the point. The rules were
// added at different times by people reading their neighbours — which is exactly
// how a seventh `var(--line)` got written while building #828.
//
// A `var(--x, fallback)` is NOT flagged: the fallback makes it well-defined
// whether or not the token exists. Flagging those would be a false positive, and
// a guard that cries wolf is one somebody turns off.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { test } = require("./_harness");

const CSS_DIR = path.join(__dirname, "..", "web");
const FILES = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith(".css")).sort();

/** `{defined, bare, withFallback}` for one stylesheet. */
function scan(file) {
  const src = fs.readFileSync(path.join(CSS_DIR, file), "utf-8");
  const defined = new Set();
  for (const m of src.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[1]);
  const bare = new Map(), withFallback = new Map();
  for (const m of src.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g)) {
    const into = m[2] ? withFallback : bare;
    into.set(m[1], (into.get(m[1]) || 0) + 1);
  }
  return { file, src, defined, bare, withFallback };
}

const SHEETS = FILES.map(scan);

test("#830: the scan reads real stylesheets", () => {
  assert.ok(FILES.length, "no .css files found — every check below would pass over nothing");
  for (const s of SHEETS) {
    assert.ok(s.defined.size, `${s.file} defines no custom properties — the regex stopped matching`);
    assert.ok(s.bare.size + s.withFallback.size,
      `${s.file} uses no custom properties — the regex stopped matching`);
  }
});

test("#830: every bare var() names a property the stylesheet defines", () => {
  const broken = [];
  for (const s of SHEETS) {
    for (const [tok, n] of s.bare) {
      if (!s.defined.has(tok)) broken.push(`${s.file}: ${tok} (${n} use${n > 1 ? "s" : ""})`);
    }
  }
  assert.deepStrictEqual(broken.sort(), [],
    "bare var() reference(s) to an undefined custom property. CSS computes the whole "
    + "DECLARATION to its initial value, so the rule silently does nothing — a border "
    + "that is not drawn, a hover that does not highlight. Either define the token or "
    + "name the one that was meant.");
});

test("#830: the tokens this repo actually lost are named", () => {
  // Regression-by-name, so a revert of the fix fails as itself rather than as an
  // anonymous set difference.
  for (const s of SHEETS) {
    for (const gone of ["--line", "--fg"]) {
      assert.ok(!s.bare.has(gone),
        `${s.file} uses bare var(${gone}) again — that token has never been defined `
        + "in this repo. Lines take --border, surfaces take --elev, text takes --text.");
    }
  }
});

test("#830: a var() WITH a fallback is allowed, defined or not", () => {
  // Documenting the deliberate hole so nobody closes it by accident: the fallback
  // is what makes these well-defined, and several are load-bearing.
  const s = SHEETS.find((x) => x.file === "styles.css");
  assert.ok(s, "styles.css must exist");
  const undefinedButSafe = [...s.withFallback.keys()].filter((t) => !s.defined.has(t));
  for (const t of undefinedButSafe) {
    assert.ok(new RegExp(`var\\(\\s*${t}\\s*,`).test(s.src),
      `${t} was counted as having a fallback but none is written`);
  }
});

