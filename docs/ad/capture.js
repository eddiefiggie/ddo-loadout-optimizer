// Re-shoot the five ad screenshots. Companion to `annotate.py`, which crops and
// annotates what this writes into `raw/`.
//
// #770 — the set went stale because re-shooting them "belonged to nobody": it was
// five hand-taken screenshots with no recipe, so nobody re-took them when the UI
// moved underneath. This is the recipe.
//
// WHY IT SPEAKS CDP DIRECTLY, with no Playwright: in the build container the
// package registries are closed, so `npm i playwright` is not available. Node 22's
// built-in WebSocket is enough to drive Chromium over the DevTools protocol, and
// that keeps this script dependency-free wherever it runs.
//
//   python3 -m http.server 8777 --directory web      # or: .claude/launch.json
//   node docs/ad/capture.js                          # writes docs/ad/raw/*.jpg
//   python3 docs/ad/annotate.py                      # crops + annotates (needs Pillow)
//
// `annotate.py` resolves macOS system fonts, so the annotate step is happiest on a
// Mac; this capture step runs anywhere Chromium does.
//
// CHROME: override with CHROME=/path/to/chrome. The default is the Playwright
// Chromium that ships in the Claude Code container image.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:8777";
const PORT = 9222;
const RAW = path.join(__dirname, "raw");
const WIDTH = 1280;   // the step nav wraps below ~1200 now that "Your data" is in it
const HEIGHT = 1600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browser(run) {
  const proc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu",
    "--hide-scrollbars", `--window-size=${WIDTH},${HEIGHT}`, "--force-device-scale-factor=1",
    "--disable-background-networking", "--disable-component-update", "--no-first-run",
    "--disable-sync", "--disable-default-apps", "--mute-audio", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let err = ""; proc.stderr.on("data", (d) => err += d);

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch {}
  }
  if (!target) { proc.kill(); throw new Error("Chromium never came up:\n" + err.slice(-600)); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method === "Page.javascriptDialogOpening") {
      // a native confirm() blocks the renderer forever in headless
      send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id; pending.set(myId, { res, rej });
    ws.send(JSON.stringify({ id: myId, method, params }));
    setTimeout(() => { if (pending.delete(myId)) rej(new Error("timeout: " + method)); }, 180000);
  });
  await send("Page.enable");

  const b = {
    goto: (url) => send("Page.navigate", { url }),
    eval: async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
      return r.result.value;
    },
    /** Capture `clip` (full-page coords) as a JPEG, matching the existing raws. */
    shot: async (file, clip) => {
      const r = await send("Page.captureScreenshot", {
        format: "jpeg", quality: 88, captureBeyondViewport: true, clip: { ...clip, scale: 1 },
      });
      fs.mkdirSync(RAW, { recursive: true });
      fs.writeFileSync(path.join(RAW, file), Buffer.from(r.data, "base64"));
      console.log("  wrote raw/%s  %dx%d", file, Math.round(clip.width), Math.round(clip.height));
    },
  };
  try { return await run(b); } finally { ws.close(); proc.kill(); }
}

/** Click the first button whose trimmed label matches. Throws rather than
 *  silently shooting the wrong screen — a miss here is how a stale set happens. */
const click = async (b, re, what) => {
  const ok = await b.eval(`(() => {
    const el = [...document.querySelectorAll('button,.btn')].find(x => ${re}.test(x.innerText.trim()));
    if (!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error(`no control matching ${re} (${what})`);
  await sleep(600);
};
const stepName = (b) => b.eval(`(document.querySelector('.wz-step.on span')||{}).innerText||'?'`);
const pageH = (b) => b.eval("document.documentElement.scrollHeight");

/** A full-window clip anchored on `sel`, so the raw stays WIDTH x HEIGHT exactly
 *  as the hand-taken originals were. Cropping is `annotate.py`'s job, not this
 *  script's: keeping the raw a plain window shot means a crop can be re-tuned
 *  later without re-shooting, which is the whole reason the two steps are split.
 *  `bias` lifts the element off the top edge so its heading stays in frame. */
const frame = async (b, sel, bias = 90) => {
  const y = await b.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    return Math.max(0, Math.round(el.getBoundingClientRect().top + scrollY) - ${bias});
  })()`);
  if (y === null) throw new Error("nothing matching " + sel + " to frame");
  const max = Math.max(0, (await pageH(b)) - HEIGHT);
  return { x: 0, y: Math.min(y, max), width: WIDTH, height: HEIGHT };
};

async function main() {
  await browser(async (b) => {
    await b.goto(ORIGIN + "/");
    await sleep(3000);
    await click(b, /^get started/i, "intro");

    // --- a representative endgame build -------------------------------------
    await b.eval(`(() => {
      const set = (id, v) => { const e = document.getElementById(id); if (!e) return;
        e.value = v; e.dispatchEvent(new Event('change', {bubbles:true})); e.dispatchEvent(new Event('input', {bubbles:true})); };
      set('wz-buildname', 'Sook — Reaper'); set('wz-ml', '36');
      const r = document.getElementById('wz-race');
      const o = r && [...r.options].find(o => /^Elf$/i.test(o.text));
      if (o) { r.value = o.value; r.dispatchEvent(new Event('change', {bubbles:true})); }
      return 1; })()`);
    await click(b, /^Medium$/, "armor");
    await click(b, /One-hand/i, "combat style");
    await b.eval(`(() => {
      const sels = [...document.querySelectorAll('select')].filter(s => /^Add/i.test(s.options[0]?.text || ''));
      const pick = (s, re) => { const o = s && [...s.options].find(o => re.test(o.text));
        if (o) { s.value = o.value; s.dispatchEvent(new Event('change', {bubbles:true})); } };
      pick(sels[0], /Daggers/); pick(sels[1], /Short Swords/); return 1; })()`);
    await sleep(800);

    console.log("1 · character");
    await b.shot("1-character.jpg", await frame(b, "#wz-ml", 260));

    await click(b, /^Continue/i, "character -> pool");
    await click(b, /^Continue/i, "pool -> priorities");
    if (await stepName(b) !== "Priorities") throw new Error("did not reach the priorities step");

    // --- rank four stats ----------------------------------------------------
    for (const stat of ["Constitution", "Physical Sheltering", "Dodge", "Doublestrike"]) {
      const added = await b.eval(`(() => {
        const inp = document.getElementById('wz-add'); if (!inp) return false;
        inp.value = ${JSON.stringify(stat)};
        inp.dispatchEvent(new Event('input', {bubbles:true})); inp.dispatchEvent(new Event('change', {bubbles:true}));
        const add = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Add');
        if (!add) return false; add.click(); return true; })()`);
      if (!added) throw new Error("could not rank " + stat);
      await sleep(600);
    }
    console.log("2 · priorities");
    await b.shot("2-priorities.jpg", await frame(b, ".wz-ranked", 320));

    // --- solve --------------------------------------------------------------
    await click(b, /^Solve/i, "solve");
    for (let i = 0; i < 90; i++) { await sleep(1000); if (await stepName(b) === "Results") break; }
    if (await stepName(b) !== "Results") throw new Error("solve never produced results");
    await sleep(2500);

    console.log("3 · loadout");
    await b.shot("3-loadout.jpg", await frame(b, ".pd-grid, .paperdoll, .wz-card", 150));

    const tab = async (name) => {
      const ok = await b.eval(`(() => { const t = [...document.querySelectorAll('button,[role=tab],a')]
        .find(x => x.innerText.trim() === ${JSON.stringify(name)}); if (!t) return false; t.click(); return true; })()`);
      if (!ok) throw new Error("no tab named " + name);
      await sleep(2500);
    };
    await tab("Ranked Priorities");
    console.log("4 · proof");
    await b.shot("4-proof.jpg", await frame(b, ".wz-card, .wz-panel, main", 120));

    // --- 5: the Upgrades search (#499 retired the Alternatives tab) ----------
    await tab("Loadout");
    await b.eval("document.querySelectorAll('details').forEach(d => d.open = true); true");
    await sleep(1200);
    if (!await b.eval("!!document.querySelector('.upgrade-run')")) throw new Error("the Upgrades notice did not render");
    await b.eval("document.querySelector('.upgrade-run').click(); true");
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      if (await b.eval("!!(document.querySelector('.upg-out')||{}).innerText?.trim()")) break;
    }
    console.log("   upgrades says:", (await b.eval("(document.querySelector('.upg-out')||{}).innerText?.replace(/\\s+/g,' ').trim()||''")).slice(0, 120));
    console.log("5 · upgrades");
    await b.shot("5-upgrades.jpg", await frame(b, ".upg-controls", 190));
  });
  console.log("\nnow run:  python3 docs/ad/annotate.py");
}

main().catch((e) => { console.error("capture failed:", e.message); process.exit(1); });
