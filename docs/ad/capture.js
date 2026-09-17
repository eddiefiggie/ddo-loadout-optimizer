// Re-shoot the five ad screenshots, annotated and cropped, ready to publish.
//
// #770 — the set went stale because re-taking it "belonged to nobody": five
// hand-taken screenshots and a renderer that only ran on one machine. So this
// does the whole job in one command, on any machine with Chromium:
//
//   python3 -m http.server 8777 --directory web     # or: .claude/launch.json
//   node docs/ad/capture.js
//
// It writes `raw/*.jpg` (the unannotated window shots, kept so a crop can be
// re-aimed without re-shooting) and `web/screenshots/ad/*.png` (what `ad.txt`
// links). It replaces the old `annotate.py`, whose Pillow dependency and macOS
// font paths meant it could not run in CI or in a build container — half the
// reason nobody re-ran it. Callouts are drawn as DOM over the live page and
// captured by the browser, so they use the same font stack the app itself does.
//
// CHROME: override with CHROME=/path/to/chrome. ORIGIN: override the server.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:8777";
const PORT = 9222;
const RAW = path.join(__dirname, "raw");
const OUT = path.join(__dirname, "..", "..", "web", "screenshots", "ad");
const WIDTH = 1280;   // the step nav wraps below ~1200 now that "Your data" is in it
const HEIGHT = 1600;


// The callouts and crops, in each RAW's own coordinate space (1280x1600).
// A crop is (left, top, right, bottom); a callout is placed at `xy` with an
// arrow to `target`, and must sit INSIDE its crop or it is cut off.
const SHOTS = {
  "1-character": {
    crop: [128, 0, 1180, 450],
    calls: [["Lock in how you actually play — level cap, race, armor proficiency, then combat style below, down to a dual-wield off-hand.", [700, 120], [400, 372], 300]],
  },
  "2-priorities": {
    crop: [105, 110, 890, 1320],
    calls: [["Rank what matters. The solver maxes #1, then #2 without giving up any of #1 — that order IS the objective.", [516, 700], [189, 985], 330]],
  },
  "3-loadout": {
    crop: [128, 660, 1180, 1170],
    calls: [["Exact crafting steps per slot — every augment, gem and seal needed to build it.", [900, 700], [700, 1120], 250]],
  },
  "4-proof": {
    crop: [128, 690, 900, 1170],
    calls: [["It shows its work: every point traced to the exact item and bonus type, against the ceiling it could reach.", [140, 850], [600, 820], 300]],
  },
  "5-upgrades": {
    crop: [128, 80, 1180, 385],
    calls: [["You set what a suggestion may cost — free upgrades only, by default. Your ranking is never traded away behind your back.", [880, 110], [700, 212], 270]],
  },
};

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

  const api = {
    goto: (url) => send("Page.navigate", { url }),
    eval: async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
      return r.result.value;
    },
    /** The raw: a plain window shot, kept so a crop can be re-aimed later. */
    raw: async (file, clip) => {
      const r = await send("Page.captureScreenshot", {
        format: "jpeg", quality: 88, captureBeyondViewport: true, clip: { ...clip, scale: 1 },
      });
      fs.mkdirSync(RAW, { recursive: true });
      fs.writeFileSync(path.join(RAW, file + ".jpg"), Buffer.from(r.data, "base64"));
    },
    /** The published PNG: draw this shot's callouts over the live page, capture
     *  the crop, then take the overlay back down so it cannot leak into the next
     *  shot. Coordinates in SHOTS are raw-space; `frameY` maps them onto the page. */
    annotated: async (name, frameY) => {
      const { crop, calls } = SHOTS[name];
      await api.eval(`(() => {
        const ACCENT = "#639bff", BG = "rgba(11,17,33,0.94)", FG = "#eef2fa";
        const host = document.createElement("div");
        host.id = "__ad_overlay";
        host.style.cssText = "position:absolute;left:0;top:0;width:100%;height:0;z-index:2147483647;pointer-events:none";
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("style", "position:absolute;left:0;top:0;overflow:visible");
        svg.setAttribute("width", "1"); svg.setAttribute("height", "1");
        host.appendChild(svg);
        for (const [text, xy, target, maxw] of ${JSON.stringify(calls)}) {
          const x = xy[0], y = xy[1] + ${frameY};
          const tx = target[0], ty = target[1] + ${frameY};
          const box = document.createElement("div");
          box.style.cssText = "position:absolute;box-sizing:border-box;left:" + x + "px;top:" + y +
            "px;max-width:" + maxw + "px;background:" + BG + ";border:3px solid " + ACCENT +
            ";border-radius:11px;padding:13px;color:" + FG +
            ";font:400 21px/28px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
          box.textContent = text;
          host.appendChild(box);
          document.body.appendChild(host);
          // the arrow starts at the box edge facing the target
          const r = box.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + scrollY + r.height / 2;
          const ang = Math.atan2(ty - cy, tx - cx);
          const sx = cx + (r.width / 2 + 2) * Math.cos(ang), sy = cy + (r.height / 2 + 2) * Math.sin(ang);
          const line = document.createElementNS(svgNS, "line");
          line.setAttribute("x1", sx); line.setAttribute("y1", sy);
          line.setAttribute("x2", tx); line.setAttribute("y2", ty);
          line.setAttribute("stroke", ACCENT); line.setAttribute("stroke-width", "4");
          svg.appendChild(line);
          const ah = 15;
          const head = document.createElementNS(svgNS, "polygon");
          head.setAttribute("points", [
            tx + "," + ty,
            (tx - ah * Math.cos(ang - 0.5)) + "," + (ty - ah * Math.sin(ang - 0.5)),
            (tx - ah * Math.cos(ang + 0.5)) + "," + (ty - ah * Math.sin(ang + 0.5)),
          ].join(" "));
          head.setAttribute("fill", ACCENT);
          svg.appendChild(head);
        }
        document.body.appendChild(host);
        return 1; })()`);
      await sleep(250);
      const r = await send("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: true,
        clip: { x: crop[0], y: crop[1] + frameY, width: crop[2] - crop[0], height: crop[3] - crop[1], scale: 1 },
      });
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.data, "base64"));
      await api.eval(`(() => { const o = document.getElementById("__ad_overlay"); if (o) o.remove(); return 1; })()`);
      console.log("  %s.png  %dx%d   (raw/%s.jpg)", name, crop[2] - crop[0], crop[3] - crop[1], name);
    },
  };
  try { return await run(api); } finally { ws.close(); proc.kill(); }
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

/** Frame the shot, write its raw, then write the annotated PNG from the same frame. */
const shoot = async (b, name, sel, bias) => {
  const f = await frame(b, sel, bias);
  await b.raw(name, f);
  await b.annotated(name, f.y);
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
    await shoot(b, "1-character", "#wz-ml", 260);

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
    await shoot(b, "2-priorities", ".wz-ranked", 320);

    // --- solve --------------------------------------------------------------
    await click(b, /^Solve/i, "solve");
    for (let i = 0; i < 90; i++) { await sleep(1000); if (await stepName(b) === "Results") break; }
    if (await stepName(b) !== "Results") throw new Error("solve never produced results");
    await sleep(2500);

    console.log("3 · loadout");
    await shoot(b, "3-loadout", ".pd-grid, .paperdoll, .wz-card", 150);

    const tab = async (name) => {
      const ok = await b.eval(`(() => { const t = [...document.querySelectorAll('button,[role=tab],a')]
        .find(x => x.innerText.trim() === ${JSON.stringify(name)}); if (!t) return false; t.click(); return true; })()`);
      if (!ok) throw new Error("no tab named " + name);
      await sleep(2500);
    };
    await tab("Ranked Priorities");
    console.log("4 · proof");
    await shoot(b, "4-proof", ".wz-card, .wz-panel, main", 120);

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
    await shoot(b, "5-upgrades", ".upg-controls", 190);
  });
  console.log("\nwrote web/screenshots/ad/*.png — what ad.txt links.");
}

main().catch((e) => { console.error("capture failed:", e.message); process.exit(1); });
