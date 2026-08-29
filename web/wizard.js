// Guided-wizard flow controller (U1). Replaces the two-tab shell + the old
// query form: one linear flow (intro -> character -> gear pool -> priorities ->
// solve -> results) that drives the EXISTING engine (buildModel / solveLexicographic
// / renderResults) with the character gate (U2), Trove import (U5), and per-slot
// constraints (U6) wired in. Pure step helpers are exported for node tests; all
// DOM wiring is guarded so Node can require this file.

// ---- pure step machine (tested in tests/wizard.test.js) --------------------
const WIZARD_STEPS = ["intro", "character", "pool", "priorities", "results"];
const FORGED = new Set(["warforged", "bladeforged"]);

/** Can the flow advance FROM `stepId` given the collected state? Gates the
 *  Continue/Solve buttons. Unknown steps are permissive.
 *
 *  #91 (review fix) — the priorities gate must not count the Utility sentinel:
 *  a fresh list is BORN carrying it (`newPriorityList`), so `length > 0` alone
 *  passes for a player who ranked nothing at all, letting them advance and
 *  solve with an empty ask. The sentinel-only query is still valid for the
 *  solver (programmatic callers may pass it), so the fix lives here in the
 *  wizard's gate, not in the solver. */
function canAdvance(stepId, state) {
  if (stepId === "character") return missingRequired(state).length === 0;
  if (stepId === "pool") return state.pool !== "owned" || !!state.ownedNames;
  if (stepId === "priorities") return (state.priorities || []).some((p) => p !== _utilitySentinel);
  return true;
}
/** Next step id after advancing from `stepId` (clamped at results). */
function nextStep(stepId, steps = WIZARD_STEPS) {
  const i = steps.indexOf(stepId);
  if (i < 0) return stepId;
  return steps[Math.min(i + 1, steps.length - 1)];
}
/** Previous step id (clamped at intro). */
function prevStep(stepId, steps = WIZARD_STEPS) {
  const i = steps.indexOf(stepId);
  if (i <= 0) return steps[0];
  return steps[i - 1];
}
const wizIsForged = (race) => FORGED.has(String(race || "").toLowerCase());

/** #428 U6 (R2a) — the character step's required fields, in the order they are
 *  asked. `label` is what the message and the field marker both read from, so
 *  the two cannot name the same field differently. */
const CHARACTER_REQUIRED = [
  { key: "name", label: "Build name" },
  { key: "ml", label: "Minimum level (ML) cap" },
  { key: "race", label: "Race" },
  { key: "armor", label: "Armor type" },
];

/** #428 U6 (R7/R12/KD6) — which required fields are unanswered, in field order.
 *
 *  Armor joins the required set under KD6, which makes this a GATE change: it is
 *  what `canAdvance("character")` now asks. The Forged exemption is load-bearing
 *  rather than a nicety — Warforged and Bladeforged wear a docent, the armor
 *  control renders disabled, and the race handler clears `state.armor`, so
 *  requiring it of them would be a gate no player could ever satisfy.
 *
 *  A build LOADED with all three answered returns [] and is therefore marked
 *  nowhere (R12); a build saved before KD6 carries no armor and is marked here
 *  rather than blocking silently somewhere else (AE3a). Pure; unit-tested. */
function missingRequired(state) {
  const s = state || {};
  const out = [];
  // #431 U1 (KTD1) — pushed FIRST so the name leads both the message and the
  // scroll-to-first-missing order, matching its position in the group. Trimmed:
  // a name of spaces is not a name, and CharacterStore keys records by it.
  if (!String(s.characterName || "").trim()) out.push("name");
  if (!(Number(s.ml) > 0)) out.push("ml");
  if (!s.race) out.push("race");
  if (!s.armor && !wizIsForged(s.race)) out.push("armor");
  return out;
}

/** #431 U4 — "no-name" is reachable from the character step's own save
 *  button, where the field it names is on screen beside it. The guard no
 *  longer produces this error at all: it omits Save instead. */
function saveErrorText(error) {
  if (error === "no-name") return "Name this build first.";
  // #548 — the old wording was "Storage full — remove some saves." It named
  // the wrong thing: a player with four saved builds is holding ~150 KB of a
  // ~5 MB budget, about 3% of it, while the version store had grown without a
  // cap. Following that instruction deleted deliberate work and freed almost
  // nothing, and the player hit the wall again immediately.
  //
  // By the time this text is reached the auto snapshots have ALREADY been
  // reclaimed and the save retried, so what remains really is deliberate:
  // saved builds, named versions, imported ones, bundles. Point at the place
  // that can show all of them rather than guessing which is largest.
  if (error === "quota") {
    return "Storage is full, even after clearing unsaved version history. "
      + "Open Your data to see what is stored and remove something.";
  }
  return "Could not save.";
}

/** #548 — what a successful save says. Normally just the name; when the save
 *  only succeeded because auto snapshots were reclaimed, it says so.
 *
 *  Silently shortening the player's history would be the same class of defect
 *  as the message this change replaced: something happened to their data and
 *  nothing told them. Pure and exported so the wording is testable without a
 *  storage stub or a DOM.
 */
function saveOkText(name, reclaimed) {
  const n = Number(reclaimed) || 0;
  if (n <= 0) return `Saved \u201C${name}\u201D.`;
  return `Saved \u201C${name}\u201D \u2014 storage was full, so ${n} `
    + `automatic version snapshot${n === 1 ? "" : "s"} `
    + `${n === 1 ? "was" : "were"} cleared to make room. `
    + "Named versions were kept.";
}

/** #431 U3 (KTD5) — ONE renderer owns the save control everywhere it appears.
 *  Hand-writing the button into each bar invites drift, so each bar interpolates
 *  this instead and a guard pins the call-site count. The status line is part of
 *  the control: a save reports beside the button that was pressed, not in a panel
 *  the player is no longer looking at. */
function saveControl(cls) {
  return `<button class="btn ${cls}" id="wz-save" type="button">Save progress</button>`
    + `<span class="wz-savestat" id="wz-savestat" aria-live="polite"></span>`;
}

/** #432 — WHICH re-solve banner holds primacy at RENDER time, or null when none
 *  is showing. The three raise from independent flags and can co-show: a loaded
 *  build that both predates the catalog and migrated its TWF declaration raises
 *  the first two on the same paint, and a later pin adds the third. Returning the
 *  earliest one in document order is what keeps "exactly one primary" true — the
 *  rest render ghost.
 *
 *  The four `migrationBanner` notices share the `wz-cbar` class but their buttons
 *  are ghosts, so they do not contend and must NOT be counted here — keying this
 *  on the class instead of the three flags would ghost save behind a "Got it".
 *
 *  State-derived, so it is right only while state and DOM agree — which is true at
 *  render time and not after. Once handlers start hiding banners in place,
 *  `refreshResultsEmphasis` re-ranks on actual visibility instead. Pure; unit-tested. */
function resolveBannerPrimary(state) {
  const s = state || {};
  if (staleNote(s)) return "wz-stale";
  if (s.twfMigrated) return "wz-twfmig";
  if (s.constraintsDirty) return "wz-cbar";
  return null;
}

function resolveBannerShowing(state) {
  return resolveBannerPrimary(state) !== null;
}

/** #428 U6 (R10) — ONE message naming every unanswered required field, or null.
 *  Not one message per field: the plan's complaint is that the step says nothing
 *  at all, and three separate lines would be the same problem inverted. */
function missingRequiredMessage(state) {
  const miss = missingRequired(state);
  if (!miss.length) return null;
  const labels = CHARACTER_REQUIRED.filter((f) => miss.indexOf(f.key) >= 0).map((f) => f.label);
  const list = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${list} ${labels.length === 1 ? "is" : "are"} still needed before you can continue.`;
}

/** #428 U6 (R6a) — what a COLLAPSED weapon group says about itself.
 *
 *  A group that hides its contents must not also hide whether it has any, or an
 *  unopened group is indistinguishable from an empty one. The style is named by
 *  its LABEL, passed in, because the taxonomy owns that mapping and this helper
 *  must stay pure. Unit-tested. */
function weaponGroupSummary(state, styleLabel) {
  const s = state || {};
  const bits = [];
  if (s.twoWeaponFighting) bits.push("Two Weapon Fighting");
  if (s.style) bits.push(String(styleLabel || s.style));
  const wt = (s.weaponTypes || []).length;
  if (wt) bits.push(`${wt} weapon type${wt === 1 ? "" : "s"}`);
  const oh = (s.offHand || []).length + (s.offHandWeapons || []).length;
  if (oh) bits.push(`${oh} off-hand pick${oh === 1 ? "" : "s"}`);
  return bits.length ? bits.join(" · ") : "nothing set";
}

/** U1 (R1) — where loading a saved character lands. A snapshot that solved
 *  optimally goes straight to "results" (no pool/priorities detour); anything
 *  else (missing snapshot, or a non-optimal status) falls back to "priorities"
 *  so the user can re-solve, never a blank results view. Pure; unit-tested. */
function stepAfterLoad(snapshot) {
  return snapshot && snapshot.status === "optimal" ? "results" : "priorities";
}

/** #428 U4 (KTD1) — the step a record explicitly recorded, or null.
 *
 *  A record written before this feature carries no `step`; its ABSENCE is the
 *  signal, which is why an unknown or non-string value reads as absent too
 *  rather than being coerced. Pure; unit-tested. */
function savedStep(inputs, steps = WIZARD_STEPS) {
  const s = inputs && inputs.step;
  return (typeof s === "string" && steps.indexOf(s) >= 0) ? s : null;
}

/** #428 U4 (R16) — where loading a saved record lands.
 *
 *  A record that recorded its step resumes there; a pre-feature record falls
 *  back to `stepAfterLoad`, unchanged. The one exception is a saved "results":
 *  every other step renders from inputs alone, but results renders from a solved
 *  snapshot, so honouring it without one would restore the blank results view
 *  `stepAfterLoad` exists to prevent. Pure; unit-tested. */
function stepOnLoad(inputs, snapshot, steps = WIZARD_STEPS) {
  const s = savedStep(inputs, steps);
  return (s && s !== "results") ? s : stepAfterLoad(snapshot);
}

/** #429 review #2 — may this live `lastRun` be attributed to the record being
 *  saved under `name`?
 *
 *  `state` is one long-lived closure object that outlives any character, and
 *  `lastRun` is the heaviest thing on it. A run is THIS save's only when it was
 *  just solved (`fresh`), or when the name being written is the record it was
 *  loaded from. Without that second clause: load A (which sets `lastRun`), step
 *  back, rename to B, save — and B is written with A's snapshot, A's query and
 *  A's build stamp, so it also never raises the staleness banner. Pure. */
function runBelongsTo(run, name, loadedName) {
  if (!run) return false;
  if (run.fresh === true) return true;
  const nm = String(name || "").trim();
  return !!nm && nm === String(loadedName || "").trim();
}

/** #429 review #1 — the overwrite confirm's wording.
 *
 *  Takes the two facts rather than looking them up, so the sentence the player
 *  reads and the write that follows cannot disagree about what is at stake.
 *  An in-progress save over a solved record KEEPS that loadout (see
 *  saveCurrentCharacter); the old wording said only "Update saved build", which
 *  read as an update while the write replaced the record wholesale. Pure. */
/** plan U7 — everything stored locally, grouped by kind.
 *
 *  PURE: it takes the four lists rather than reading the stores, so what the panel
 *  claims is stored is testable without a browser and without localStorage.
 *
 *  A KIND WITH NOTHING IN IT STILL APPEARS. Omitting an empty group would make
 *  "what is stored" and "what this panel shows" two different questions, and the
 *  player would have no way to tell an empty store from one the panel forgot. It
 *  is also the honest answer to the storage-full message that sends them here.
 *
 *  Versions carry no owner, so they are their own group rather than nested under a
 *  build — see the plan's Risks. Presenting them under a build would imply a
 *  relationship the data does not record and would leave the auto-snapshots,
 *  which is most of them, with nowhere to appear. */
function storedItemsModel({ builds, bundles, versions, farming } = {}) {
  const b = Array.isArray(builds) ? builds : [];
  const bu = Array.isArray(bundles) ? bundles : [];
  const v = Array.isArray(versions) ? versions : [];
  const f = (farming && typeof farming === "object") ? farming : {};
  return [
    { kind: "builds", label: "Builds", empty: "No saved builds.",
      items: b.map((c) => ({ id: String(c.name || c), label: String(c.name || c),
        note: c.savedAt ? String(c.savedAt).slice(0, 10) : "" })) },
    { kind: "bundles", label: "Saved bundles", empty: "No saved bundles.",
      items: bu.map((x) => {
        const n = (x.affixes || []).length;
        return { id: String(x.id), label: String(x.name || "Untitled"),
          note: `${n} ${n === 1 ? "stat" : "stats"}` };
      }) },
    { kind: "versions", label: "Version snapshots", empty: "No version snapshots.",
      items: v.map((x) => ({ id: String(x.id), label: String(x.name || x.id),
        note: x.kind === "auto" ? "auto" : String(x.kind || "") })) },
    // #518 — farming progress is filed under whatever name was in the build-name
    // field when the tick was made, and that field is live: it does not have to
    // name a SAVED build. So entries accrue under names that were typed and never
    // saved, and nothing else ever collects them — deleting a build cascades its
    // own progress, but an entry that was never a build has no delete to ride on.
    //
    // Marking them is the fix that fits what the data actually supports. A saved
    // build has no id: `persist.js` keys the store by name, so the name IS the
    // identity — settled by #518 rather than deferred by it, because every store
    // already keys that way and the rename it shipped moves a build and its
    // progress together. What a player needs HERE is to tell the two apart, which
    // this does without pretending an ownership link exists.
    //
    // These rows are no longer the only thing standing between an orphan and a
    // build that inherits it: saving a build under a name that already carries
    // ticks discloses the count and offers to clear them (`farmingTakeover`).
    // This list stays the place they can be found and removed at any other time.
    { kind: "farming", label: "Farming progress", empty: "No farming progress.",
      items: Object.keys(f).map((name) => {
        const n = Object.keys(f[name] || {}).length;
        const known = b.some((c) => String(c.name || c) === name);
        return { id: name, label: name,
          note: `${n} ${n === 1 ? "tick" : "ticks"}${known ? "" : " · no saved build"}`,
          orphan: !known };
      }) },
  ];
}

/** plan U7 — the stored-items list. Every row carries a delete, because a list
 *  that shows what is stored and cannot remove it is the state the storage-full
 *  message already put the player in. */
function storedItemsHTML(model, ns) {
  const e = _escAttr;
  const groups = Array.isArray(model) ? model : [];
  return `<div class="wz-stored" id="wz-stored-${e(ns)}">
    ${groups.map((g) => `<section class="wz-stored-group" data-kind="${e(g.kind)}">
      <h4 class="wz-stored-head">${e(g.label)} <span class="wz-stored-count">${g.items.length}</span></h4>
      ${g.items.length
        ? `<ul class="wz-stored-list">${g.items.map((it) => `<li>
            <span class="wz-stored-name">${e(it.label)}</span>
            ${it.note ? `<span class="wz-stored-note${it.orphan ? " is-orphan" : ""}">${e(it.note)}</span>` : ""}
            <button type="button" class="wz-stored-del" data-del-kind="${e(g.kind)}"
              data-del-id="${e(it.id)}" aria-label="Delete ${e(it.label)}" title="Delete">\u2715</button>
          </li>`).join("")}</ul>`
        : `<p class="wz-help wz-stored-empty">${e(g.empty)}</p>`}
    </section>`).join("")}
  </div>`;
}

/** plan U6 — what deleting a build takes with it, said before it happens.
 *
 *  Names the farming count when there is one, because that is work the player did
 *  by hand and nothing else holds a copy of it. Says nothing about version
 *  snapshots: they are one global list with no owner, so deleting a build neither
 *  removes them nor orphans them, and claiming either would be false.
 *
 *  Pure and beside `overwriteConfirmText` for the same reason — the sentence is
 *  the product, so it is testable without a browser. */
function deleteBuildConfirmText(name, impact, editingThis) {
  const nm = String(name || "");
  const n = (impact && Number(impact.farming)) || 0;
  const head = editingThis
    ? `Delete saved build \u201C${nm}\u201D? You have unsaved changes to it, and this removes the only saved copy.`
    : `Delete saved build \u201C${nm}\u201D?`;
  if (!n) return head;
  return `${head} Its ${n} farming ${n === 1 ? "tick" : "ticks"} ${n === 1 ? "goes" : "go"} with it.`;
}

/** plan 2026-08-25-002 U3 (#518) — why a rename did not happen.
 *
 *  Pure and beside `overwriteConfirmText` for the same stated reason: the
 *  sentence IS the product, so it is testable without a browser.
 *
 *  Every branch but one ends in "Nothing was changed", because every branch but
 *  one is a clean refusal. The exception is a failed build write whose rollback
 *  ALSO failed: the progress has moved and the build has not, so claiming a
 *  clean failure would be a lie about the player's data. That case names where
 *  the ticks ended up and where they can be cleared — the entry is already
 *  marked in "Your data" as belonging to no saved build. */
function renameRefusalText(res) {
  const r = res || {};
  const from = String(r.from || "");
  const to = String(r.to || "");
  if (r.reason === "empty") return "A build needs a name. Nothing was changed.";
  if (r.reason === "collision") {
    return `Another saved build is already called \u201C${to}\u201D. Nothing was changed.`;
  }
  if (r.reason === "missing") {
    return `\u201C${from}\u201D is no longer saved. Nothing was changed.`;
  }
  if (r.stage === "build" && r.rolledBack === false) {
    return `\u201C${from}\u201D could not be renamed, and its farming progress is now filed `
      + `under \u201C${to}\u201D, which has no build. You can clear it under Your data.`;
  }
  return `\u201C${from}\u201D could not be renamed. Nothing was changed.`;
}

/** plan 2026-08-25-002 U4 (#518) — how many ticks this save is taking over.
 *
 *  Farming progress is keyed by the LIVE build-name field, which does not have
 *  to name a saved build. So a name can carry ticks before any build is saved
 *  under it, and the build that lands there inherits them looking exactly like
 *  its own work. Three paths produce that: a backup restore, whose farming map
 *  is keyed independently of the characters in the same file; a save that failed
 *  on quota after a tick succeeded; and progress recorded before delete began
 *  cascading. Delete-then-recreate is NOT among them — the cascade clears.
 *
 *  Takes the facts rather than looking them up, the `overwriteConfirmText`
 *  precedent, so the number the player reads and the entry that gets cleared
 *  cannot disagree.
 *
 *  `prevExisted` is what separates a takeover from an ordinary update: a name
 *  that was already a saved build owns its ticks. Without that clause this would
 *  fire on every autosave of every build that has ever farmed anything.
 *
 *  `disclosed` is warn-once. A build is saved on every navigation, so a
 *  per-save disclosure is a per-navigation disclosure. */
function farmingTakeover(name, prevExisted, tickCount, disclosed) {
  const nm = String(name || "").trim();
  if (!nm || prevExisted || disclosed) return 0;
  const n = Number(tickCount) || 0;
  return n > 0 ? n : 0;
}

/** The sentence for the above. Pure, for the same reason its siblings are.
 *
 *  It states what is true and stops: these ticks were not made on this build.
 *  It does NOT tell the player they are wrong — the entry may well be their own
 *  work from a build that failed to save — so clearing is offered, never urged,
 *  and keeping them is the default that needs no action. */
function farmingTakeoverText(name, count) {
  const n = Number(count) || 0;
  return `\u201C${String(name || "")}\u201D already had ${n} farming `
    + `${n === 1 ? "tick" : "ticks"} recorded under that name, which were not made on `
    + `this saved build.`;
}

function overwriteConfirmText(name, prevHasLoadout, savingSolved) {
  const nm = String(name || "");
  if (!prevHasLoadout) return `Update saved build \u201C${nm}\u201D?`;
  return savingSolved
    ? `Update saved build \u201C${nm}\u201D? Its saved loadout is replaced by the one on screen.`
    : `Update saved build \u201C${nm}\u201D? Its saved loadout is kept \u2014 only the character and priorities you have on screen are updated.`;
}

/** #452 U2 (R5/R6/KTD1) — does saving under `nm` overwrite a DIFFERENT build?
 *
 *  This is the gate that makes autosave-on-Continue viable. `trySave` used to
 *  confirm whenever ANY record carried the name, the build being edited
 *  included. That was harmless while saving was a deliberate press: you pressed
 *  Save, you got one question. Under #452 the forward path saves, so the same
 *  predicate would fire a native window.confirm on every step change of every
 *  build saved even once — strictly worse than the dialog #452 removes, and it
 *  would read as the feature failing rather than as the gate being mis-scoped.
 *
 *  Three clauses, each load-bearing:
 *
 *    prev                    there is something to overwrite at all
 *    nm !== loadedName       re-saving the build you are editing is not an
 *                            overwrite of anyone's work, however many times
 *    nameReconciled !== nm   R6's warn-once, set when the player accepts
 *
 *  Pure, so the gate is testable without a dialog — the same reason
 *  `overwriteConfirmText` beside it is pure. A predicate living inside
 *  `trySave` would only be reachable by source-text assertion, and this one is
 *  too important to test that way. Unit-tested in tests/wizard.test.js. */
function nameCollides(state, nm, prev) {
  const s = state || {};
  const name = String(nm || "").trim();
  if (!name || !prev) return false;
  if (name === String(s.loadedName || "").trim()) return false;
  if (String(s.nameReconciled || "") === name) return false;
  return true;
}

/** #428 U3 (R13/R14/R17/R20/R21) — the save rail's model.
 *
 *  The rail is the flow's ONE save surface, rendered beside every step (KTD4),
 *  so what it shows has to be derivable rather than accumulated: `loaded` is a
 *  function of the store still holding the loaded name, not a second flag every
 *  delete path has to remember to clear. Deleting the build you are editing
 *  therefore returns the rail to its empty state for free.
 *
 *  `saved` is filtered rather than trusted: the store is localStorage, which a
 *  player can hand-edit, and a nameless entry would render an unloadable row.
 *  Pure; unit-tested in tests/wizard.test.js. */
function railModel(state, saved) {
  const s = state || {};
  const list = (Array.isArray(saved) ? saved : [])
    .filter((c) => c && typeof c === "object" && typeof c.name === "string" && c.name);
  const names = list.map((c) => c.name);
  const loadedName = String(s.loadedName || "");
  const loaded = !!loadedName && names.indexOf(loadedName) >= 0;
  // #431 U2 (KTD10) — `name`, `canSave` and `overwrites` existed only to drive
  // the rail's input and button, both of which have moved. The overwrite confirm
  // keeps deriving its own answer in trySave.
  return {
    loaded,
    loadedName: loaded ? loadedName : "",
    saved: names,
    empty: names.length === 0,
  };
}

/** Is this stat on/off ONLY — no magnitude to floor, cap, or declare?
 *
 *  `vocab.presence` alone is the wrong test. It means "appears as Bool on at
 *  least one item", and four stats are in it while also carrying a real typed
 *  magnitude elsewhere: Deception, Smoke Screen, Protection from Evil, and
 *  Underwater Action. Gating on `presence` alone hid the min/max control for
 *  those four AND stripped any floor already set on them — a bound the player
 *  could no longer see, clear, or re-enter, on a stat that genuinely has one.
 *
 *  A vocab without `magnitude` (hand-built test fixtures, older cached shape)
 *  falls back to the bare presence test, which is the prior behavior. */
function isPresenceOnly(stat, vocab) {
  if (!vocab || !vocab.presence || typeof vocab.presence.has !== "function") return false;
  if (!vocab.presence.has(stat)) return false;
  return !(vocab.magnitude && typeof vocab.magnitude.has === "function" && vocab.magnitude.has(stat));
}

/** #235 — does this stat carry a real magnitude but NO bonus type anywhere?
 *  `Enhanced Ki` is the first such stat to reach the picker.
 *
 *  A vocab without `untypedOnly` (hand-built fixtures, older cached shape) returns
 *  false, which is the prior behavior. */
function isUntypedOnly(stat, vocab) {
  return !!(vocab && vocab.untypedOnly && typeof vocab.untypedOnly.has === "function"
    && vocab.untypedOnly.has(stat));
}

/** #235 — may this stat be given a declared "I already have this" credit?
 *
 *  No for an on/off effect (a declared magnitude satisfies a floor without the
 *  item that grants it), and no for an untyped-only stat: the credit control asks
 *  the player to pick a BONUS TYPE, and this stat has none. Every choice is wrong
 *  — `Untyped` keys a bucket the gear cannot join, so the two would sum into a
 *  double-count, and any other type names a bucket nothing in the game supplies.
 *
 *  Floors and caps stay available on these stats; only the credit is refused. A
 *  bound is a working constraint on any bucket, typed or not. */
function canDeclareCredit(stat, vocab) {
  return !isPresenceOnly(stat, vocab) && !isUntypedOnly(stat, vocab);
}

// #91 (U4) — the Utility tier's sentinel priority name, resolved once across
// runtimes (browser global from model.js; Node require) exactly as the shared
// constants below are. One authority: the wizard must seed, accept, render, and
// suppress EXACTLY the name the solver stage keys on, or the tier drifts into a
// zero-scoring phantom priority.
var _utilitySentinel = (typeof UTILITY_SENTINEL !== "undefined")
  ? UTILITY_SENTINEL
  // eslint-disable-next-line global-require
  : require("./model.js").UTILITY_SENTINEL;

// #346 (U1) — the ladder's vocabulary, over the same cross-runtime bridge the
// sentinel above uses: model.js loads first in the browser, so the `var`s are
// globals here; under node the require resolves them. The rank table stays in
// model.js so the ladder's ordering is stated exactly once.
var _normalizeRung = (typeof normalizeRung !== "undefined")
  ? normalizeRung
  // eslint-disable-next-line global-require
  : require("./model.js").normalizeRung;
var _craftingRung = (typeof craftingRung !== "undefined")
  ? craftingRung
  // eslint-disable-next-line global-require
  : require("./model.js").craftingRung;
var _rungExcludesNicheCrafting = (typeof rungExcludesNicheCrafting !== "undefined")
  ? rungExcludesNicheCrafting
  // eslint-disable-next-line global-require
  : require("./model.js").rungExcludesNicheCrafting;
var _rungExcludesAllAugments = (typeof rungExcludesAllAugments !== "undefined")
  ? rungExcludesAllAugments
  // eslint-disable-next-line global-require
  : require("./model.js").rungExcludesAllAugments;
/** #346 (U3, KTD3) — which rung a saved character loads at.
 *
 *  Extracted and exported because this is the highest-consequence line in the
 *  feature: a wrong derivation silently changes the loadout of every saved
 *  character, and the player gets no signal that anything moved. It is a pure
 *  function of the saved inputs so it can be tested directly rather than through
 *  the render path.
 *
 *  The legacy `excludeCraftingSystems` boolean is a TOTAL function onto the
 *  ladder — absent or false meant "nothing excluded" (top rung), true meant
 *  exactly the niche-crafting rung — so no save marker is needed here. The
 *  Utility tier needed one because "never had it" and "player removed it" were
 *  indistinguishable; these two states are not. A stored rung always wins, so
 *  the derivation fires only when the rung is genuinely absent. */
function rungFromInputs(inputs) {
  return _craftingRung(inputs);
}

/** #88 U5 (R20/R21/R23) — the saved override list, restored at the load boundary.
 *
 *  Pure, and exported, for the same reason `rungFromInputs` is: it is a function of
 *  the saved inputs, so it is tested directly rather than through the render path.
 *
 *  Two rules, each of which has cost a defect elsewhere in this file. The caller
 *  ALWAYS assigns the result — `state` outlives a character, so an override left
 *  live from the previous one would silently retype this build's gear (the
 *  `augCeiling` and `declaredCredits` precedents). And entries are sanitized here
 *  rather than trusted: a hand-edited backup can carry rows no reader could act
 *  on, which would render as ghosts and re-persist on every save (the `blocklist`
 *  precedent). Copies, never references — an edit to live state must not reach
 *  back into the saved record. */
function restoreOverrides(inputs) {
  const list = inputs && inputs.overrides;
  if (!Array.isArray(list)) return [];
  const O = _overridesModule();
  return list
    .filter((o) => (O ? O.isWellFormed(o) : (o && typeof o === "object")))
    .slice(0, OVERRIDE_LIMIT)
    .map((o) => Object.assign({}, o));
}

// review #9 — read from overrides.js, never re-declared: the save boundary in
// persist.js applies the same ceiling, and a constant copied into two files
// measures the copy rather than the original.
var OVERRIDE_LIMIT = (function () {
  var O = _overridesModule();
  return (O && O.OVERRIDE_LIMIT) || 200;
})();

/** #88 U10 (R31/R32) — add a correction to the list in force.
 *
 *  Pure and exported like every sibling helper here: the DOM wrappers do two
 *  things only, assign the result to state and re-apply the overlay, so the
 *  semantics below are tested directly rather than through the render path.
 *
 *  A second correction on the same affix REPLACES the first rather than
 *  appending. Two overrides on one affix are not two facts — the second is the
 *  player changing their mind — and `applyOverrides` would apply only whichever
 *  matched the catalog type, silently ignoring the other while it sat in the
 *  manager looking live.
 *
 *  Returns `{ ok, list, error }` rather than throwing, because every caller is a
 *  UI surface that has to say something specific when a correction is refused. */
function addOverrideTo(list, key, to, note) {
  const current = Array.isArray(list) ? list : [];
  const O = _overridesModule();
  const o = Object.assign({}, key, { to: String(to == null ? "" : to),
                                     note: note ? String(note) : "" });
  if (O && !O.isWellFormed(o)) return { ok: false, list: current, error: "malformed" };
  const at = current.findIndex((x) => x && sameOverrideTarget(x, o));
  if (at < 0 && current.length >= OVERRIDE_LIMIT) {
    return { ok: false, list: current, error: "limit" };
  }
  const next = current.slice();
  if (at >= 0) next[at] = o; else next.push(o);
  return { ok: true, list: next, error: null };
}

/** The override in `list` that addresses the same affix as `key`, or null.
 *
 *  A named function rather than an inline predicate because the inline one was
 *  wrong in a way that reads as correct: `o.variant_id === key.variant_id ||
 *  o.pool_key === key.pool_key` collapses for two ITEM overrides, since neither
 *  carries a pool_key and `undefined === undefined` satisfies the second clause.
 *  Any override sharing the affix name and recorded type then matched, from a
 *  different item entirely. `sameOverrideTarget`'s truthiness guard is what stops
 *  that, so the lookup routes through it rather than restating the comparison. */
function findOverrideFor(list, key) {
  const current = Array.isArray(list) ? list : [];
  if (!key) return null;
  return current.find((o) => o && sameOverrideTarget(o, key)) || null;
}

function sameOverrideTarget(a, b) {
  const target = (a.variant_id && a.variant_id === b.variant_id)
    || (a.pool_key && a.pool_key === b.pool_key);
  return !!target && a.name === b.name && String(a.from) === String(b.from)
    && String(a.value) === String(b.value);
}

/** U11 (R34) — withdraw one correction. Returns a new list; the input is not
 *  mutated, because the caller still holds it while deciding what to render. */
function removeOverrideAt(list, i) {
  const current = Array.isArray(list) ? list : [];
  if (!(i >= 0 && i < current.length)) return current;
  return current.slice(0, i).concat(current.slice(i + 1));
}

/** U11 (R35/KTD9) — re-anchor a drift-suspended correction to what upstream now
 *  says, keeping the override's identity and its note. Replacing it instead would
 *  discard the note and reset the creation provenance, which is the record of why
 *  the player disagreed in the first place.
 *
 *  Refused when there is no type to anchor to (a retired target), and refused
 *  when the new anchor IS the player's own replacement — that would make the
 *  override satisfied by construction, which is a state the catalog earns rather
 *  than something re-confirm can manufacture. */
function reconfirmOverrideAt(list, i, now) {
  const current = Array.isArray(list) ? list : [];
  if (!(i >= 0 && i < current.length)) return { ok: false, list: current, error: "range" };
  if (now == null || now === "") return { ok: false, list: current, error: "no-anchor" };
  const o = current[i];
  if (String(now) === String(o.to)) return { ok: false, list: current, error: "would-satisfy" };
  const next = current.slice();
  next[i] = Object.assign({}, o, { from: String(now) });
  return { ok: true, list: next, error: null };
}

function _overridesModule() {
  if (typeof require !== "undefined") { try { return require("./overrides.js"); } catch (e) { /* absent */ } }
  return (typeof window !== "undefined") ? window.Overrides : null;
}

/** Clean a stat->value bound map (caps/floors): keep only entries whose value is a
 *  finite number >= 0. Blank, null, negative, or non-numeric entries are dropped so
 *  a stray input never reaches the solver as a cap/floor.
 *
 *  Takes no vocab. An earlier revision refused bounds on presence stats here;
 *  that was reverted because a floor on a Bool bucket is a WORKING constraint —
 *  `min 1 Ghostly` forces the solver to equip an item carrying the effect, since
 *  the Bool bucket is part of the stat's solver expression. Pure; unit-tested. */
function cleanBoundMap(m) {
  const out = {};
  if (m && typeof m === "object") {
    for (const [stat, v] of Object.entries(m)) {
      if (v === "" || v == null) continue;
      // #91 (U4/R15) — the Utility tier carries no bounds in v1. The UI never
      // renders min/max inputs for the sentinel row, so this is the defensive
      // second gate for a hand-edited backup or a stale map: a bound keyed to
      // the sentinel must never reach the solver, where it would constrain a
      // count the player was told has no Advanced controls.
      if (stat === _utilitySentinel) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) continue;
      // Deliberately NOT canonicalized, unlike cleanCreditMap. Bound keys come
      // from `state.priorities`, which addPriority already canonicalized, so a
      // rewrite here buys nothing — and it is not free: buildModel derives solver
      // targets from bound-map keys, so rewriting a stale non-canonical key
      // would resurrect a dead orphan bound AND mint a target the player never
      // ranked. Credits have no such path, which is why they canonicalize.
      out[stat] = n;
    }
  }
  return out;
}

// U2 (declared stat credits) — the curated bonus-type vocabulary and the shared
// sanitizer, resolved across runtimes (browser global from model.js; Node
// require) exactly as the pin helpers below are. The wizard must offer and accept
// precisely what the solver will honor: a selector built from a second list would
// drift, and a near-miss type is silently WRONG rather than rejected — it forms
// its own bucket, so the credit stops competing with gear and adds to it instead.
var _creditBonusTypes = (typeof CREDIT_BONUS_TYPES !== "undefined")
  ? CREDIT_BONUS_TYPES
  // eslint-disable-next-line global-require
  : require("./model.js").CREDIT_BONUS_TYPES;
var _maxCreditValue = (typeof MAX_CREDIT_VALUE !== "undefined")
  ? MAX_CREDIT_VALUE
  // eslint-disable-next-line global-require
  : require("./model.js").MAX_CREDIT_VALUE;
var _normalizeCreditsW = (typeof normalizeCredits !== "undefined")
  ? normalizeCredits
  // eslint-disable-next-line global-require
  : require("./model.js").normalizeCredits;

/** The state key for a credit. `(stat, bonus type)` is the uniqueness key (A2),
 *  so a stat-keyed map cannot express R2's "more than one credit on one stat". */
function creditKey(stat, bonusType) {
  return `${String(stat == null ? "" : stat).trim()}||${String(bonusType == null ? "" : bonusType).trim()}`;
}

/** Clean a declared-credit map on the way to the query, mirroring `cleanBoundMap`.
 *
 *  Canonicalizes the stat through the picker vocabulary first (KTD4): the solver
 *  matches a bucket's stat half by EXACT string and applies no aliasing, so a
 *  non-canonical name does not error — it forms an orphan bucket that silently
 *  contributes nothing. Validation itself is delegated to the same
 *  `normalizeCredits` the solver uses, so the wizard cannot accept a credit the
 *  solver would drop, or vice versa. Pure; unit-tested. */
function cleanCreditMap(m, vocab) {
  const canonical = vocab && typeof vocab.canonical === "function" ? vocab.canonical : (s) => s;
  // #211 — a credit on a name a family has since expanded away (a Battle
  // Trance's Insight Combat Mastery) splits into per-component credits at full
  // magnitude, through the SAME map the priority picker and saved-character
  // load use. Without this the credit's bucket is one no target or affix
  // feeds, and the declared buff silently stops counting.
  const _dn = _datasetNormalizer();
  const _migrateCredits = _dn && _dn.migrateCredits;
  if (m && typeof m === "object" && typeof _migrateCredits === "function") {
    m = _migrateCredits(m, vocab).credits;
  }
  const rows = [];
  if (m && typeof m === "object") {
    for (const row of Object.values(m)) {
      if (!row) continue;
      const stat = canonical(String(row.stat == null ? "" : row.stat).trim()) || row.stat;
      // #91 (U4/R15) — no declared credits on the Utility tier either, for the
      // same defensive reason as cleanBoundMap's sentinel gate: the UI offers no
      // credit control on that row, so any such entry is corrupt or hand-made.
      if (stat === _utilitySentinel) continue;
      // A presence (on/off) stat has no magnitude to declare. Its gear lands in a
      // `stat||boolean` bucket, and the curated vocabulary has no boolean member,
      // so a magnitude credit would occupy a SEPARATE bucket and stack additively:
      // a declared Insight 3 on Blurry reported Blurry 4, and with a floor set the
      // meaningless magnitude satisfied it, so the solver stopped securing the item
      // that actually grants the feature. The UI does not offer the control here;
      // this is the second gate, for a credit that predates it or arrives restored.
      // Presence-ONLY, not merely presence-flagged: a stat with a real magnitude
      // bucket can carry a credit that competes in that bucket correctly. The
      // defect above is specific to a stat whose ONLY bucket is `stat||boolean`.
      if (!canDeclareCredit(stat, vocab)) continue;
      rows.push({ stat, bonus_type: row.bonus_type, value: row.value });
    }
  }
  const out = {};
  for (const c of _normalizeCreditsW(rows)) out[creditKey(c.stat, c.bonus_type)] = c;
  return out;
}

/** The count phrase on a collapsed row's Advanced summary — "" when nothing is
 *  set. Pure and exported so the initial render and the in-place refresh below
 *  cannot word it differently, and so R5's pluralization is unit-tested. */
function advancedBadgeText(n) {
  if (!n) return "";
  return `· ${n} ${n === 1 ? "setting" : "settings"}`;
}

/** Is a declared credit's typed value one the solver will actually honor?
 *
 *  Hoisted to module scope so the row model below and the row markup share ONE
 *  predicate. They must agree: the badge counts a credit as an applied setting
 *  and the markup dims it as incomplete, and a row reading "1" whose only credit
 *  the solver drops is exactly the kind of claim this repo refuses to make. Lives
 *  beside `_maxCreditValue`, which is already resolved at module scope. Pure. */
function creditIsUsable(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= _maxCreditValue;
}

/** What one ranked row's Advanced panel holds, as plain data (no DOM).
 *
 *  Exists so R5's collapsed badge and R6's presence-row rule are unit-testable:
 *  `rankedHTML` and `renderRankedList` live inside the wizard's DOM closure and
 *  are not exported, and this suite has no jsdom, so behavior asserted only
 *  through them cannot be tested at all. The markup renders FROM this; it does
 *  not re-derive any of it.
 *
 *  `badgeCount` counts applied settings — a floor, a cap, and each USABLE credit
 *  — so a half-typed credit row does not inflate the badge. Pure; unit-tested. */
function advancedRowModel(stat, state, vocab) {
  const s = state || {};
  // #91 (U4/R15) — the Utility tier row renders NO Advanced panel at all: no
  // caps, no floors, no declared credits in v1. `suppressed` is the render gate
  // (rankedHTML skips advancedHTML entirely), and the empty model beneath it
  // keeps every consumer of this shape (badge, credits list) inert, so a stale
  // bound in state can never surface a live-looking control on this row.
  if (stat === _utilitySentinel) {
    return { suppressed: true, canCredit: false, floor: null, cap: null, credits: [], badgeCount: 0 };
  }
  // R6 as planned said an on/off row gets no control at all, on the premise that
  // a bound on a binary stat is meaningless. That premise is FALSE: the Bool
  // bucket is part of the stat's solver expression, so `min 1 Ghostly` is a
  // working hard constraint that forces the solver to equip an item carrying the
  // effect. Those rows keep their min/max. Only CREDITS are refused there, which
  // is the documented U2/U3 defect — a declared magnitude on a Bool-only stat
  // forms a separate additive bucket and satisfies the floor without the item.
  // #345 (U5, R10) — a floor is what makes an effect non-negotiable, so the row
  // says so without the player opening Advanced. Derived, never a second stored
  // flag: one representation, so it cannot disagree with the bound the solve got.
  const pick = (map) => {
    if (!map || typeof map !== "object") return null;
    // hasOwnProperty, not `map[stat] != null`: a stat named "__proto__" would
    // otherwise resolve to Object.prototype and read as a set bound.
    if (!Object.prototype.hasOwnProperty.call(map, stat)) return null;
    const v = map[stat];
    if (v == null || v === "") return null;
    // Same predicate cleanBoundMap applies. Otherwise an imported backup holding
    // `{Dodge: -5}` renders a live-looking min box and counts "1 setting" for a
    // bound the query drops — a row asserting a constraint the solve never got.
    const n = Number(v);
    return (Number.isFinite(n) && n >= 0) ? n : null;
  };
  const floor = pick(s.targetFloors);
  const cap = pick(s.targetCaps);
  // Credits stay refused on an on/off-only stat even though bounds do not: a
  // declared magnitude there forms a SEPARATE additive bucket and satisfies a
  // floor without the item that grants the effect (the documented U2/U3 defect,
  // reproduced end-to-end against HiGHS during review).
  const all = (canDeclareCredit(stat, vocab) && s.declaredCredits && typeof s.declaredCredits === "object")
    ? s.declaredCredits : {};
  const credits = Object.entries(all)
    .filter(([, c]) => c && c.stat === stat)
    .map(([key, c]) => ({
      key, stat: c.stat, bonus_type: c.bonus_type, value: c.value, usable: creditIsUsable(c.value),
    }));
  const badgeCount = (floor != null ? 1 : 0) + (cap != null ? 1 : 0)
    + credits.filter((c) => c.usable).length;
  // `canCredit` drives the AFFORDANCE, not just the list. Suppressing the rows
  // while still rendering "+ already have" left a button that silently wrote
  // state the query then discarded: clicking it on an on/off row produced no
  // visible row, no error, and one more orphan entry per click.
  return { canCredit: canDeclareCredit(stat, vocab), floor, cap, credits, badgeCount, required: floor != null && Number(floor) > 0 };
}

// U3 — the Advanced panel's prose, defined ONCE here and interpolated per row.
//
// It renders once per magnitude row by design: the panel is closed by default and
// a player opens one at a time, so the explanation lands next to the inputs it
// describes instead of stranded at the bottom of the list. "Appears exactly once"
// is therefore a claim about this source, not about the rendered DOM — a twelve-
// row list has twelve copies in the markup and one definition here.
//
// `lead` states the default first (R4). Most solves want neither bound, and an
// empty box reads as unfinished, which invites players to constrain a solve they
// had no reason to constrain.
const ADVANCED_PANEL_HELP = {
  lead: "<strong>Nothing set is the default.</strong> With no min and no max, the solver takes as much of this stat as it can fit without giving up anything ranked above it. Leave both blank unless you have a specific number in mind.",
  min: "<strong>Min is a hard floor.</strong> The solver sacrifices your lower priorities to reach it, and if it can't, it chases that stat above everything else. Use it only for a number you truly must hit (e.g. a survivability threshold like PRR).",
  max: "<strong>Max is a cap.</strong> Stop valuing a stat past a breakpoint you know is real (e.g. 100% doublestrike). The tool can't verify in-game caps for you — set one only when you know the breakpoint.",
  // R7 — the sources this covers, on screen rather than only in a tooltip. The
  // feature exists because these bonuses are invisible to the tool, so a label
  // that does not name them cannot be found by the player who needs it.
  credit: "<strong>Already have some of this?</strong> Character effects the tool can't see — trances, enhancements, epic destinies, past lives, filigrees, ship buffs — won't be found in your gear. Declare the amount and the solver stops spending a slot to beat it.",
};

// U2/KTD1 — which rows currently have their Advanced panel open.
//
// `renderRankedList` rebuilds the whole list with `ol.innerHTML = rankedHTML()`,
// and every credit mutation (add, remove, retype) plus reorder and drop calls
// `rerender()`. A `<details open>` would therefore snap shut the instant the
// player clicks "+ already have" INSIDE the panel they just opened — the single
// most likely interaction. So the open set lives out here, survives the rebuild,
// and the markup sets `open` from it.
//
// Keyed by STAT NAME, not row index: reordering changes indices, and a panel
// should follow its stat up and down the list rather than staying at position 3.
//
// Ephemeral by design — never enters `state`, `INPUT_KEYS`, or the query. Module
// scope (not the DOM closure) so the sweep semantics are unit-testable at all;
// the Priorities step and the in-results Adjust panel share one set, which is
// correct because the same stat in both is the same stat and they are never
// visible at once.
const openPanels = new Set();
/** Record a panel's open state. Pure w.r.t. everything but the module set. */
function openPanelToggle(stat, isOpen) {
  if (isOpen) openPanels.add(stat); else openPanels.delete(stat);
  return openPanels;
}
/** Drop one stat's entry — called when its priority is removed, so a deleted
 *  stat leaves nothing behind (mirrors the bounds/credits cleanup beside it). */
function openPanelSweep(stat) {
  openPanels.delete(stat);
  return openPanels;
}
/** Reset every entry — called on character load, where the whole priority list
 *  is replaced and any carried-over open row would belong to the old build. */
function openPanelClear() {
  openPanels.clear();
  return openPanels;
}
/** The `open` attribute text for one row's panel — the READ side of the set.
 *  Exported so the read seam is covered by behavior rather than by a regex over
 *  the markup: deleting the read is the mutation that silently reverts KTD1
 *  entirely (every panel renders closed, so the panel snaps shut on the click
 *  it exists to survive) while a source assertion on the surrounding template
 *  still passes. */
function panelOpenAttr(stat) {
  return openPanels.has(stat) ? " open" : "";
}

/** Pure state -> solver query mapping (no DOM). Exported for unit tests.
 *  `vocab` is the picker vocabulary; callers inside the wizard closure pass it so
 *  a declared credit's stat is canonicalized to the ONE name gear carries (KTD4)
 *  and a presence stat is refused. Omitted in unit tests that supply already-
 *  canonical stats. */
/** #339 — the ONE ceiling-clamp rule both layers share: a ceiling counts only
 *  when positive and STRICTLY below the cap; blank/absent/at-or-above-cap all
 *  mean null (unrestricted). buildQuery's call is the authoritative clamp
 *  (evaluated against the effective cap at query time, so a ceiling saved above
 *  a later-lowered cap re-normalizes to unrestricted instead of going stale);
 *  the input handler's call is display-layer convenience on top of it. */
function clampAugCeiling(raw, cap) {
  const n = Number(raw);
  return (raw !== "" && raw != null && n > 0 && n < cap) ? n : null;
}

function buildQuery(state, vocab) {
  const forged = wizIsForged(state.race);
  const mlCap = Number(state.ml) || 36;
  const rung = _normalizeRung(state.craftingRung);
  return {
    mlCap,
    mlFloor: Number(state.mlFloor) || null,   // optional item-level floor (hide low-ML gear)
    // #346 (U1, KTD4) — a rung that excludes augments forces the ceiling to null
    // in the SOLVED query. The control keeps the player's typed value so it comes
    // back when they climb the ladder again (U2), but a solve that placed no
    // augments must not carry a restriction the results would then report: the
    // ceiling notice reads the solved query, and "augments were restricted to
    // ML N" on an augment-free loadout is a claim about nothing.
    augCeiling: _rungExcludesAllAugments(rung) ? null : clampAugCeiling(state.augCeiling, mlCap),
    targets: state.priorities.slice(),
    armorType: forged ? null : (state.armor || null),   // equippability + #573 disclosure
    // U4 — armor eligibility gate (R7). A druidic oath now drives TWO independent
    // things (#162): proficiency (light + medium body armor, non-Tower shields) via
    // armorTypes here, and a metal restriction via `oath` + the wiki-sourced material
    // map below. This replaces the old cloth+light approximation, which wrongly
    // excluded every medium armor including non-metal ones. Forged wear docents, so
    // the gate is moot for them (docent handling lives in the R6 branch).
    armorTypes: forged ? undefined
      : (state.oath === "druid" ? ["cloth", "light", "medium"]
        : (state.armor ? [state.armor] : undefined)),
    oath: forged ? null : (state.oath || null),
    // U3 — combat-style / weapon-type / off-hand constraints (replaces the inert
    // coarse `weaponSetup`). Empty arrays / unset style => unconstrained.
    style: state.style || null,
    weaponTypes: Array.isArray(state.weaponTypes) ? state.weaponTypes.slice() : [],
    offHand: Array.isArray(state.offHand) ? state.offHand.slice() : [],
    offHandWeapons: Array.isArray(state.offHandWeapons) ? state.offHandWeapons.slice() : [],
    // plan 003 U1 — the Two Weapon Fighting declaration (R1). Dual-wield used to
    // switch on as a side effect of picking an off-hand weapon type, which nothing
    // signposted; it is now an explicit character-level feat declaration. Always a
    // boolean, never undefined, so a pre-U1 state resolves to undeclared rather
    // than to a stray truthy value downstream.
    twoWeaponFighting: !!state.twoWeaponFighting,
    race: state.race || null,
    alignment: state.alignment || null,
    includeArtifact: !!state.includeArtifact,           // U4 — Artifact opt-in
    // #346 (U1) — the crafting/augment ladder that replaced #245's boolean. Each
    // rung removes strictly more than the one above; buildModel empties the
    // craftable option pools at the niche-crafting rung and gates augments in
    // eligible() at the two below it.
    craftingRung: rung,
    // #110 (U1) — the blocklist, copied so the solve reads a snapshot rather
    // than the live state array. Absent (pre-feature state) reads as empty.
    blocklist: Array.isArray(state.blocklist) ? state.blocklist.slice() : [],
    // #539 — the set pins, copied so the solve reads a snapshot rather than live
    // state, exactly as the blocklist above does.
    pinnedSets: Array.isArray(state.pinnedSets) ? state.pinnedSets.slice() : [],
    // U6 — set-augment ownership gate. A Set of owned set-augment `set` names;
    // empty => none of the 21 set augments are considered (default off).
    ownedSetAugments: state.ownedSetAugments instanceof Set
      ? new Set(state.ownedSetAugments)
      : new Set(Array.isArray(state.ownedSetAugments) ? state.ownedSetAugments : []),
    slotConstraints: state.slotConstraints,
    // U1/U4 — per-priority stat caps (max) and floors (min), stat-keyed. Only clean,
    // non-negative entries are emitted; empty maps mean "no caps/floors" (default).
    targetCaps: cleanBoundMap(state.targetCaps),
    targetFloors: cleanBoundMap(state.targetFloors),
    // U2 — declared stat credits, `(stat, bonus type)`-keyed. Always emitted; an
    // empty map is inert, because buildModel normalizes it to no credits — so an
    // undeclared build solves exactly as it did before this feature (R3). The key
    // is present either way, so the query object is not byte-identical to a
    // pre-feature one; nothing hashes or diffs it.
    declaredCredits: cleanCreditMap(state.declaredCredits, vocab),
    // #88 U8 (R14/KTD6) — the overrides actually IN FORCE for this solve, which is
    // the overlay's APPLY REPORT, never the player's saved declaration. The two
    // differ exactly where it matters: a suspended, unmatched, or ineligible
    // override is in the declaration and did nothing, and rendering it as applied
    // is the defect KTD6 was written about. `state.overrideApplied` is written by
    // applyOverrideOverlay, the single place the overlay is (re-)built.
    overrides: Array.isArray(state.overrideApplied) ? state.overrideApplied.slice() : [],
  };
}

// U3 — the shared pin-normalize path, resolved once across runtimes (browser
// global from model.js; Node require). So the wizard reads a list-shaped Ring pin
// exactly as the solver does.
var _pinnedVariantIds = (typeof pinnedVariantIds !== "undefined")
  ? pinnedVariantIds
  // eslint-disable-next-line global-require
  : require("./model.js").pinnedVariantIds;

// R4a — same cross-runtime resolve for the legality gate (browser global vs Node
// require), so reconcilePinLegality works in tests and in the app.
var _pinConflict = (typeof pinConflict !== "undefined")
  ? pinConflict
  // eslint-disable-next-line global-require
  : require("./model.js").pinConflict;

// R12 — the both-hands classifier, for the dual-pin aggregate warning.
var _isBothHandsWeapon = (typeof isBothHandsWeapon !== "undefined")
  ? isBothHandsWeapon
  // eslint-disable-next-line global-require
  : require("./model.js").isBothHandsWeapon;

// plan 003 U5/KTD6 — the SLOT-AWARE pin predicate, resolved the same way. Layered on
// top of _pinConflict rather than folded into it: see model.js for why the shield
// exclusion must stay out of variantConflict.
var _pinSlotConflict = (typeof pinSlotConflict !== "undefined")
  ? pinSlotConflict
  // eslint-disable-next-line global-require
  : require("./model.js").pinSlotConflict;
// plan 003 U5 — U2's exported advisory predicate, so the R8 override flag and the
// U6 results notice read ONE authority and cannot drift.
var _offHandItemsExcluded = (typeof offHandItemsExcluded !== "undefined")
  ? offHandItemsExcluded
  // eslint-disable-next-line global-require
  : require("./model.js").offHandItemsExcluded;
// plan 003 U5 — handedness, for the pin flow's hand target.
function _weaponTaxonomy() {
  if (typeof WeaponTaxonomy !== "undefined") return WeaponTaxonomy;
  if (typeof require !== "undefined") {
    try { return require("./weapon-taxonomy.js"); } catch (e) { /* absent */ }
  }
  return null;
}

// U3 — pure pin-mutation core (exported for tests; the wizard closure wraps these
// with its live cardinality lookup). A pin forces an item into its WORN-slot label
// (KTD4): a weapon's `variant.slot` is "Weapon", but the solver groups pick-vars by
// "Main Hand", so pinning by the raw slot would silently no-op. `cardOf(slot)` gives
// the slot cardinality (Ring = 2, else 1): a full single slot replaces, a full Ring
// keeps the newest two; a duplicate variant is ignored.
//
// plan 003 U5 (R6, KTD5) — the hand target. This line used to send EVERY weapon to
// "Main Hand" unconditionally, so an off-hand weapon pin could not be expressed at
// all: a longsword pinned as a second weapon silently landed in the main hand. That
// is the second, independent half of the reported bug (U2 fixed the first). `hand`
// is honored only for weapons; a shield or a ring keeps its own worn slot whatever
// is passed. Absent `hand` => Main Hand, so every existing call site is unchanged.
function pinWornSlotOf(v, hand) {
  if (v.category !== "weapon") return v.slot;
  return hand === "Off Hand" ? "Off Hand" : "Main Hand";
}
/** The worn slots a pinnable item can be pinned to, in offer order. Only a
 *  ONE-HANDED weapon offers a choice; everything else has exactly one home.
 *  An untyped weapon host has unknown handedness — it could be crafted two-handed,
 *  which cannot be dual-wielded — so it is not offered as an off-hand pin, matching
 *  offHandWeaponOk's "concrete type match required" rule in model.js. */
function pinHandsFor(v) {
  if (!v || v.category !== "weapon") return [v ? v.slot : null];
  const T = _weaponTaxonomy();
  const oneHanded = !!T && v.type != null && T.styleOfType(v.type) === T.ONE_HAND;
  return oneHanded ? ["Main Hand", "Off Hand"] : ["Main Hand"];
}
/** plan 003 U4 (R9) — does this saved character need the Two Weapon Fighting
 *  migration? True only for a save written BEFORE U1: no `twoWeaponFighting` field
 *  at all, but a non-empty `offHandWeapons` list, which was the old opt-in trigger.
 *  Those characters had dual-wield ON; leaving them undeclared would silently put a
 *  shield back in their off hand on the next solve.
 *
 *  Idempotent by construction: persist.js coerces the field to a boolean on every
 *  save, so its PRESENCE means the player has a stored choice — including an explicit
 *  `false`, which is honored rather than overwritten. */
function twfMigrationNeeded(inputs) {
  const i = inputs || {};
  if (i.twoWeaponFighting !== undefined) return false;
  return Array.isArray(i.offHandWeapons) && i.offHandWeapons.length > 0;
}
function pinIdOf(v) { return v.variant_id || v.source_item; }

// plan 2026-08-12-003 (U4, #262) — the no-drop-source disclosure at pick time.
// The wording is owned by projection.js (NO_DROP_SOURCE_WORDING: one constant,
// every surface); bridged browser-global-first, require() under node. `var` for
// the shared browser global scope (browse.js bridges the same constant under its
// own name — a `const` collision there would be a SyntaxError). The literal
// fallback only covers a stale cached projection.js that predates the constant.
var _wzNoDropWording = (function () {
  const P = (typeof Projection !== "undefined") ? Projection
    : (typeof require !== "undefined" ? require("./projection.js") : null);
  return (P && P.NO_DROP_SOURCE_WORDING) || "no known live drop source";
})();

/** Per-row disclosure note for the pin/block search results — the moment of
 *  choosing an item is where this matters most. Shaped like the existing state
 *  notes (" · pinned", " · blocked") so it appends beside them; "" when unset
 *  (only-when-set: absence of the flag is the default). Pure; unit-tested. */
function noDropNote(v) {
  return (v && v.no_drop_source === true) ? ` · ${_wzNoDropWording}` : "";
}
// Pin one variant id into a known worn slot (used both by the Gear-pool search,
// via applyPin, and by the results Deep-Dive per-row pin action). A full single
// slot replaces; a full Ring keeps the newest two; a duplicate is ignored.
function applyPinId(slotConstraints, slot, id, cardOf) {
  const card = (cardOf && cardOf(slot)) || 1;
  const c = slotConstraints[slot];
  const existing = (c && c.type === "pin") ? _pinnedVariantIds(c) : [];
  if (existing.includes(id)) return slotConstraints;              // no duplicate variant
  let next = existing.concat(id);
  if (next.length > card) next = next.slice(next.length - card);  // single replaces; Ring keeps newest 2
  slotConstraints[slot] = card > 1 ? { type: "pin", variant_ids: next } : { type: "pin", variant_id: next[0] };
  return slotConstraints;
}
function applyPin(slotConstraints, v, cardOf, hand) {
  return applyPinId(slotConstraints, pinWornSlotOf(v, hand), pinIdOf(v), cardOf);
}
function removePinFrom(slotConstraints, slot, id, cardOf) {
  const c = slotConstraints[slot];
  if (!c || c.type !== "pin") return slotConstraints;
  const remaining = _pinnedVariantIds(c).filter((x) => x !== id);
  const card = (cardOf && cardOf(slot)) || 1;
  if (!remaining.length) delete slotConstraints[slot];
  else if (card > 1) slotConstraints[slot] = { type: "pin", variant_ids: remaining };
  else slotConstraints[slot] = { type: "pin", variant_id: remaining[0] };
  return slotConstraints;
}

/** #539 — every set a player could pin, from the dataset's own definitions.
 *
 *  Three sources, because a set reaches the solve three ways: Set Augments
 *  (`augment_set_defs`), craftable memberships (`membership_set_defs`), and
 *  ordinary gear sets, which are only discoverable from the items that carry a
 *  parsed tier. Deduped and sorted; the picker filters it by typed text.
 */
function pinnableSets(dataset) {
  const out = new Set();
  for (const k of Object.keys((dataset && dataset.augment_set_defs) || {})) out.add(k);
  for (const k of Object.keys((dataset && dataset.membership_set_defs) || {})) out.add(k);
  for (const it of (dataset && dataset.items) || []) {
    for (const t of it.parsed_set_bonuses || []) {
      if (t && t.set && t.pieces_required != null && (t.affixes || []).length) out.add(t.set);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

// #539 (U3/U4) — the set-pin mutation core. Pure and exported for the same reason
// the blocklist's is: the add and remove paths are the whole contract, and testing
// them through the DOM would test the renderer instead.

/** Add set names to the pin list, ignoring duplicates. Returns the new list plus
 *  what was actually added, so the caller can report rather than re-derive. */
function addSetPins(pinnedSets, names) {
  const have = new Set(pinnedSets || []);
  const added = [];
  for (const n of names || []) {
    if (typeof n !== "string" || !n || have.has(n)) continue;
    have.add(n);
    added.push(n);
  }
  return { list: (pinnedSets || []).concat(added), added };
}

function removeSetPin(pinnedSets, name) {
  return (pinnedSets || []).filter((x) => x !== name);
}

/** #539 — pins naming a set this dataset no longer defines. Labelled rather than
 *  dropped, the same contract `blockStale` has: an upstream rename must not
 *  silently delete a constraint the player set. */
function setPinStale(pinnedSets, dataset) {
  if (!Array.isArray(pinnedSets) || !pinnedSets.length) return [];
  const known = new Set(pinnableSets(dataset));
  return pinnedSets.filter((n) => !known.has(n));
}

/** #539 — the solve-time warning. Pinning Set Augments makes the program much
 *  harder: measured at ~41s for four against a ~6.5s unpinned baseline, because
 *  each pinned set adds a few hundred placement binaries. A player who is about
 *  to wait that long should be told BEFORE they press Solve, not left wondering
 *  whether the tab has hung.
 *
 *  Keyed on the count of pinned AUGMENT sets, which is what actually drives the
 *  cost — a pinned gear set is nearly free (6.5s measured), because its pieces
 *  are items the pool already carries rather than copies minted per host. */
function setPinSlowNotice(pinnedSets, dataset) {
  const augs = new Set(Object.keys((dataset && dataset.augment_set_defs) || {}));
  const n = (pinnedSets || []).filter((x) => augs.has(x)).length;
  if (n < 2) return "";
  return `Solving with ${n} pinned Set Augments takes noticeably longer — `
    + "each one adds hundreds of placements for the solver to consider. "
    + "Expect the solve to run for a while; it has not stalled.";
}

// #110 (U3/U4/U5) — the blocklist mutation core. Pure and exported: the add and
// remove DECISIONS live here so they are unit-testable; the renderers are
// DOM-bound. One identity handle covers items and augments (pinIdOf — the same
// variant_id||source_item the solver's variantKey reads).

/** The worn slot holding a pin on this id, or null. A Ring pin holding two
 *  variants conflicts only on the id actually being blocked. */
function blockPinSlotOf(slotConstraints, id) {
  for (const [slot, c] of Object.entries(slotConstraints || {})) {
    if (c && c.type === "pin" && _pinnedVariantIds(c).includes(id)) return slot;
  }
  return null;
}

/** #110 (U4/KTD5) — one block action over the ids the player selected. Dedupes
 *  against the existing list AND within the staged set, and refuses any id that
 *  is currently pinned (U5/R4) — the refusal names the pin's slot so the message
 *  can state the conflict. Returns { list, added, refused }; never mutates. */
function addBlocks(blocklist, ids, slotConstraints) {
  const have = new Set(blocklist || []);
  const added = [];
  const refused = [];
  for (const id of ids || []) {
    if (!id || have.has(id)) continue;
    const slot = blockPinSlotOf(slotConstraints, id);
    if (slot) { refused.push({ id, slot }); continue; }
    have.add(id);
    added.push(id);
  }
  return { list: (blocklist || []).concat(added), added, refused };
}

/** #110 (U3/R3) — remove one entry, leaving the rest intact. */
function removeBlock(blocklist, id) {
  return (blocklist || []).filter((x) => x !== id);
}

/** #110 (U5/R4) — the symmetric refusal: is this id blocked, so pinning it must
 *  be refused? An absent blocklist never conflicts. */
function pinBlockedConflict(blocklist, id) {
  return Array.isArray(blocklist) && blocklist.includes(id);
}

/** #110 (U5) — ids holding BOTH states, for the load-path migration report. A
 *  hand-edited or corrupted import can carry both; the solve itself is
 *  well-defined (the block wins candidacy, U2), so the overlap is reported to
 *  the player rather than silently resolved. */
function blockPinOverlap(blocklist, slotConstraints) {
  return (blocklist || []).filter((id) => blockPinSlotOf(slotConstraints, id) != null);
}

/** #110 (U6/KTD8) — blocked ids that resolve to NOTHING in the current roster.
 *  Works on a copy by construction (filter), never mutating the saved list —
 *  mutating while deciding is the shape that once left a character
 *  half-rewritten. Resolution is against the FULL roster, deliberately not the
 *  ML- or character-gated pool: a variant above the ML cap is merely
 *  inapplicable right now and stays blocked silently; only an id no variant
 *  carries (renamed or removed upstream) is stale. A stale entry is KEPT — it
 *  blocks something that no longer exists, which is harmless — and reported;
 *  dropping it would silently un-block if the name comes back. */
function blockStale(blocklist, items) {
  if (!Array.isArray(blocklist) || !blocklist.length) return [];
  const ids = new Set();
  for (const v of items || []) {
    if (v) ids.add(v.variant_id || v.source_item);
  }
  return blocklist.filter((id) => !ids.has(id));
}

/** #110 (U5/U6) — the load-path disclosure sentence, or null when clean. One
 *  sentence for both facts, mirroring the priorities-migration message shape:
 *  computed pure here, rendered by the banner. */
function blockLoadMessage(blocklist, slotConstraints, items) {
  const parts = [];
  const overlap = blockPinOverlap(blocklist, slotConstraints);
  if (overlap.length) {
    parts.push(`${overlap.join(", ")} ${overlap.length > 1 ? "are" : "is"} both pinned and `
      + "blocked — a block wins, so the pin will not be honored. Remove one of the two.");
  }
  const stale = blockStale(blocklist, items);
  if (stale.length) {
    parts.push(`Blocked ${stale.length > 1 ? "entries" : "entry"} ${stale.join(", ")} no longer `
      + "match anything in the current data (renamed or removed upstream). "
      + "They stay blocked and can be removed in the gear-pool step.");
  }
  return parts.length ? parts.join(" ") : null;
}

/** #88 U7 (R25/R27/R28) — what the load has to tell the player about their
 *  overrides. Takes `Overrides.resolveOverrides`' output and returns one line per
 *  override whose state is news, or null when every one is still active.
 *
 *  Active is deliberately silent: R24 says an override whose target still carries
 *  the recorded type applies without prompting. Everything else is a change the
 *  player did not make to a character they saved, which is exactly the class of
 *  thing this app discloses rather than absorbing — the priority-migration and
 *  blocklist notices beside it exist for the same reason.
 *
 *  Named from the override's own fields, never from a variant lookup: a crafted
 *  override has no item name, and a retired-target override has no row left to
 *  read one from. */
function overrideLoadMessage(resolved) {
  const list = Array.isArray(resolved) ? resolved : [];
  const parts = [];
  for (const r of list) {
    if (!r || r.state === "active") continue;
    const o = r.override || {};
    const where = o.variant_id ? `${o.variant_id}` : "a crafting option";
    const what = `${o.name} on ${where}`;
    if (r.state === "satisfied") {
      parts.push(`The catalog now records ${what} as ${o.to}, which is what you said — `
        + "your override is kept in case that changes back, but it is no longer doing anything.");
    } else if (r.reason === "drift") {
      parts.push(`${what} is now recorded as ${r.now} rather than ${o.from}, so your `
        + `${o.to} override is suspended. Re-confirm it against ${r.now} or delete it.`);
    } else if (r.reason === "retired-target") {
      parts.push(`${what} is no longer in the data (renamed or removed upstream), so your `
        + `${o.to} override is suspended. There is nothing left to confirm it against.`);
    } else if (r.reason === "ineligible") {
      parts.push(`${what} is no longer an affix the item itself carries, so your `
        + `${o.to} override is suspended and can only be deleted.`);
    }
  }
  return parts.length ? parts.join(" ") : null;
}

/** #88 U8 (R30) — why the build on screen is stale, or null when it is current.
 *
 *  Two causes share one banner and one Re-solve button, because they are the same
 *  statement to the player: what you are looking at was solved under conditions
 *  that no longer hold. Neither re-solves automatically — a displayed loadout
 *  changing itself while the player reads it is worse than a stale one that says
 *  so, and re-solve here is view-only until an explicit Save.
 *
 *  The override cause compares what the SOLVE ran under (carried on its own query)
 *  against what is in force now. That catches all three ways the set can move: the
 *  player created or deleted one, and — the case a restored character hits — an
 *  override that applied when the build was solved has since suspended, so it is
 *  absent from today's applied list. */
function staleNote(state) {
  const s = state || {};
  const O = _overridesModule();
  const then = (s.lastRun && s.lastRun.query && s.lastRun.query.overrides) || [];
  const now = s.overrideApplied || [];
  // #429 review #4 (KTD5) — the causes ACCUMULATE rather than short-circuit. A
  // build can predate both the catalog and the armor requirement, and reporting
  // only the first would hide the one the player can act on.
  const notes = [];
  if (s.lastRun && O && !O.sameOverrideSet(then, now)) {
    notes.push("The build shown was solved with a different set of bonus-type corrections "
      + "than you have in force now.");
  }
  if (s.loadedStale) notes.push("This saved build predates the current gear catalog.");
  // KTD5 — a build saved before armor joined the required set carries none, and
  // an optimal snapshot routes it straight to Results, so it never meets the
  // character step's Continue press that would mark the field. The banner is the
  // only surface that reaches it. Gated on a build being ON SCREEN (`lastRun`):
  // with nothing displayed there is nothing to call stale.
  // Gated on `s.race` as well as `s.lastRun`: a build that actually solved
  // necessarily had a race, so requiring one keeps this off partial states that
  // are not characters at all (the override-staleness fixtures, for one).
  if (s.lastRun && s.race && missingRequired(s).indexOf("armor") >= 0) {
    notes.push("Armor type is now required and this build carries none \u2014 set it on the "
      + "character step and re-solve, or the loadout may include body armor you cannot wear.");
  }
  return notes.length ? notes.join(" ") : null;
}

// R12 — a pinned two-handed (both-hands) main-hand weapon and a pinned off-hand item
// are mutually exclusive under the hand mutex: each passes its own per-item legality,
// so the conflict is the COMBINATION and needs an aggregate check. `pins` is the
// [{slot, id}] list from currentPins; `itemByPinId` resolves an id to its variant.
// Exported so the aggregate warning is unit-tested (renderPinList is DOM-bound).
function dualPinMutexConflict(pins, itemByPinId) {
  let bothHandsMain = false, offHand = false;
  for (const p of pins) {
    const it = itemByPinId(p.id);
    if (!it) continue;
    if (p.slot === "Main Hand" && _isBothHandsWeapon(it)) bothHandsMain = true;
    if (p.slot === "Off Hand") offHand = true;
  }
  return bothHandsMain && offHand;
}

// R4a — pre-solve pin-legality reconciliation. The post-solve "landed" sweep can't
// catch a forced-in illegal pin: a pinned item is forced to x=1, so it always lands.
// Drop any pin illegal for the current character config BEFORE building the model,
// mirroring the pin-list advisory (pinConflict) but acting on it so R1 holds under
// pinning. Mutates slotConstraints through the tested removePinFrom core; returns
// the dropped {slot, id} entries for disclosure. `itemByPinId` resolves a pin id to
// its variant. Not a solver constraint (KTD1) — the pool is reconciled instead.
function reconcilePinLegality(slotConstraints, itemByPinId, query, cardOf) {
  const dropped = [];
  Object.entries(slotConstraints).forEach(([slot, c]) => {
    if (!c || c.type !== "pin") return;
    _pinnedVariantIds(c).forEach((vid) => {
      const it = itemByPinId(vid);
      // plan 003 U5/KTD6 — two authorities, both consulted. `_pinConflict` is the
      // per-variant gate list; `_pinSlotConflict` adds the slot-aware layer, which is
      // what makes R7 real: an off-hand weapon pin without the declaration is dropped
      // here instead of surviving into the solve as a constraint on a variant that is
      // absent from its own pool (a no-build). It deliberately returns null for a
      // pinned shield on a declared build, so the escape hatch is never swept.
      if (it && (_pinConflict(it, query) !== null || _pinSlotConflict(it, slot, query) !== null)) {
        removePinFrom(slotConstraints, slot, vid, cardOf);
        dropped.push({ slot, id: vid });
      }
    });
  });
  return dropped;
}

// Resolve the shared picker-vocabulary builder across both runtimes: Node (require
// the dataset module the tests use) and browser (the global the scripts share).
function _datasetNormalizer() {
  if (typeof require !== "undefined") { try { return require("./dataset.js"); } catch (e) { /* absent */ } }
  return (typeof window !== "undefined") ? window.DatasetNormalizer : null;
}

/** Priority-picker affix vocabulary (U5): the UNION of every affix source (gear,
 * augments, set bonuses, and ALL crafting pools), canonicalized through the alias
 * table and filtered to the rankable ones — so a crafting-only affix is selectable
 * and one target matches gear/augments/crafting by one canonical name. Returns
 * { suggestions, known, canonical }. Falls back to a present-affix scan only when
 * the shared builder is unavailable. Gates *suggestions* only — free-typed input
 * (validated against `known`, canonicalized) still accepts any real affix. */
function pickerVocabulary(dataset) {
  const N = _datasetNormalizer();
  if (N && N.buildPickerVocabulary) return N.buildPickerVocabulary(dataset);
  const set = new Set();
  (dataset.items || []).forEach((v) => {
    (v.affixes || []).forEach((a) => set.add(a.name != null ? a.name : a.stat));
    (v.scaling || []).forEach((s) => set.add(s.stat));
    (v.parsed_set_bonuses || []).forEach((t) => (t.affixes || []).forEach((a) => set.add(a.stat)));
  });
  return { suggestions: [...set].sort(), known: set, canonical: (n) => String(n == null ? "" : n).trim() };
}

/** Back-compat: the sorted suggestion list (used by the datalist + tests). */
function curatedStats(dataset) {
  return pickerVocabulary(dataset).suggestions;
}

// ---- #91 (U4) — the Utility tier's wizard-side lifecycle ---------------------
//
// The tier's position/presence lives in the persisted priority-list state, never
// closure state (docs/solutions/logic-errors/closure-scoped-ui-state-must-reset-
// on-character-load.md): everything below is a pure list transform the state
// init, add paths, and load path call, so the drag/remove/persist machinery
// needs no sentinel-specific branches at all.

/** #91 (U4/R1) — a freshly born priority list: empty of ranked stats, with the
 *  Utility tier seeded at the bottom, on by default. Every place a NEW list is
 *  created uses this (today: the wizard state init); a RESTORED list never does
 *  — load-path presence is `healUtilityTier`'s decision (KTD8). Pure. */
function newPriorityList() {
  return [_utilitySentinel];
}

/** #91 (U4/R1) — where a newly added stat lands. While the Utility tier sits at
 *  the very bottom (its seeded default), new stats slide in ABOVE it, so the
 *  default experience stays "everything I ranked beats utility" no matter how
 *  many stats are added after the seed. Once the player has dragged the tier
 *  anywhere else — or removed it — adds append at the true bottom, exactly as
 *  before the feature. Pure — returns a new array. */
function insertAboveTrailingSentinel(ranked, stat) {
  const out = (Array.isArray(ranked) ? ranked : []).slice();
  const at = (out.length && out[out.length - 1] === _utilitySentinel) ? out.length - 1 : out.length;
  out.splice(at, 0, stat);
  return out;
}

// ---- #348 (U6) — the Utility CONTAINER's pure logic ------------------------
//
// Everything below is pure so the row's behavior is unit-testable; the DOM closure
// holds only rendering and event wiring.

/** #348 (U6/R5, KTD1) — the container cap. Set by the U1 encoding gate, not by UI
 *  taste: the single-stage weighted objective gives effect i a coefficient of
 *  2^(k-1-i), so the span grows exponentially with size and the cap is wherever
 *  that stops reproducing the sequential reference exactly. The gate measured clean
 *  equivalence at every size through 20 across all 17 sentinel-ranking fixtures
 *  (tests/encoding_equivalence.js), covering the whole default roster. Widening the
 *  roster (#349) must re-run that gate before raising this number. */
// #349 — 28, not 20. The cap is whatever the encoding-equivalence gate has
// PROVEN, minus a margin: `tests/encoding_equivalence.js` now measures exact
// agreement with the sequential reference at every size through 32, so 28
// leaves four sizes of headroom. It was 20 only because 20 was the largest
// size anyone had measured, never a UI or product limit.
var UTILITY_CONTAINER_CAP = 28;

/** #348 (U6, KTD3) — the effective container: the player's curated list, or the
 *  dataset's declared default when they have never touched it.
 *
 *  `null` is not "empty" — it means "follow the current default roster and order",
 *  so a player who never opens the panel picks up a later roster revision instead
 *  of being frozen at whatever shipped the day they saved. An empty ARRAY is a
 *  real, deliberate state: a container the player emptied (KTD10). Pure. */
function containerList(state, vocab) {
  const cur = state && state.utilityContainer;
  if (Array.isArray(cur)) return cur.slice();
  return ((vocab && vocab.utilityOrder) || []).slice();
}

/** #348 (U6/R4, KTD9) — the addable population: every targetable presence effect,
 *  minus what the container already holds. ~838 names, which is a search problem
 *  rather than a menu — `query` filters, and an empty query returns the default
 *  roster as suggestions so the panel is useful before the player types. Pure. */
function containerAddable(vocab, held, query, limit) {
  const have = new Set(held || []);
  const q = String(query == null ? "" : query).trim().toLowerCase();
  const all = [...((vocab && vocab.presence) || [])]
    .filter((n) => isPresenceOnly(n, vocab) && !have.has(n));
  const pool = q
    ? all.filter((n) => n.toLowerCase().includes(q))
    : ((vocab && vocab.utilityOrder) || []).filter((n) => !have.has(n));
  return pool.sort((a, b) => {
    if (!q) return 0;                                   // suggestions keep declared order
    const ai = a.toLowerCase().indexOf(q), bi = b.toLowerCase().indexOf(q);
    return ai - bi || a.localeCompare(b);               // prefix matches first
  }).slice(0, limit == null ? 12 : limit);
}

/** #348 (U6) — one container mutation. Returns `{ ok, list, message }`; the caller
 *  owns state and disclosure, mirroring `resolvePriorityAdd`. Pure.
 *
 *  R5 — an add beyond the cap is REFUSED WITH A REASON, never silently dropped and
 *  never silently accepted into a solve the gate never validated. */
function containerEdit(list, action, arg) {
  const out = (Array.isArray(list) ? list : []).slice();
  if (action === "add") {
    if (!arg || out.includes(arg)) return { ok: false, list: out, message: null };
    if (out.length >= UTILITY_CONTAINER_CAP) {
      return { ok: false, list: out,
        message: `The container holds at most ${UTILITY_CONTAINER_CAP} effects — remove one to add another. `
          + "The limit is what the solver can pursue in strict order without losing the guarantee." };
    }
    out.push(arg);
    return { ok: true, list: out, message: null };
  }
  const i = typeof arg === "number" ? arg : out.indexOf(arg);
  if (i < 0 || i >= out.length) return { ok: false, list: out, message: null };
  if (action === "remove") { out.splice(i, 1); return { ok: true, list: out, message: null }; }
  if (action === "up" && i > 0) { [out[i - 1], out[i]] = [out[i], out[i - 1]]; return { ok: true, list: out, message: null }; }
  if (action === "down" && i < out.length - 1) { [out[i + 1], out[i]] = [out[i], out[i + 1]]; return { ok: true, list: out, message: null }; }
  return { ok: false, list: out, message: null };
}

/** #348 (U6/R5, browser-verified) — what to say when the suggestion list is empty.
 *
 *  Found by actually opening the panel: the DEFAULT container holds 20 effects and
 *  the cap is 20, so a player who has never curated opens a panel that is already
 *  full, with an empty suggestion list. The first copy said "Every default effect
 *  is already in your container" — true, useless, and it left the ~818 other
 *  addable effects undiscoverable and the cap unexplained.
 *
 *  Three distinct dead ends, three answers. Pure. */
function containerAddHint(list, query, hasHits) {
  if (hasHits) return null;
  const q = String(query == null ? "" : query).trim();
  if (q) return "No on/off effect matches that.";
  if ((list || []).length >= UTILITY_CONTAINER_CAP) {
    return `Your container is full (${UTILITY_CONTAINER_CAP}/${UTILITY_CONTAINER_CAP}). `
      + "Remove an effect to make room, or reorder what is already here — the order is what decides which ones you actually get.";
  }
  return "Search to add any other on/off effect — the defaults are only a starting point.";
}

/** #348 (U6/R3, KTD10) — the collapsed row's one-line summary, so a player who
 *  never opens the panel still sees the contents. An empty container is a DISTINCT
 *  state from a removed row and says so: removing the row means "do not pursue
 *  utility at all", an empty container means "pursue it, but I have not chosen
 *  what". Pure. */
function containerSummary(list) {
  const l = Array.isArray(list) ? list : [];
  if (!l.length) return "Empty — nothing will fill your leftover slots. Add effects, or remove this row entirely.";
  const shown = l.slice(0, 3).join(", ");
  return l.length <= 3 ? shown : `${shown} +${l.length - 3} more`;
}

/** #509 — the Set Augment panel's summary label. Extracted because the string was
 *  spelled in two places already (the markup and the change handler, which updates
 *  it inline rather than re-rendering) and a bulk control makes it three. Two
 *  spellings of one label is a drift waiting to happen, and this one carries a
 *  count, so a drifted copy reads as a wrong number rather than as a typo. Pure. */
function setAugSummaryLabel(n) {
  const count = Number(n) || 0;
  return `Set Augments I own${count ? ` · ${count} selected` : ""}`;
}

/** #91 (U4/KTD8) — the load-path healing rule, beside `migratePriorities` in
 *  spirit and in call site. `marked` is the save's `utility_tier_aware` flag:
 *
 *  - Marked (post-feature) save: restore VERBATIM — a player's removal or
 *    dragged position is their decision and persists.
 *  - Unmarked (pre-feature) save: the character "never had" the tier, so heal
 *    by appending the sentinel at the bottom — the same zero-cost default a new
 *    list gets — unless it is somehow already present (never duplicate).
 *
 *  Pure — returns a new array; an empty pre-feature list heals to just the
 *  sentinel, which is a valid list. */
function healUtilityTier(priorities, marked) {
  const list = (Array.isArray(priorities) ? priorities : []).slice();
  if (marked) return list;
  if (!list.includes(_utilitySentinel)) list.push(_utilitySentinel);
  return list;
}

/** #348 (U7, R12/R13, KTD4) — the SECOND-generation heal, beside its predecessor
 *  because they repair the same list at the same boundary.
 *
 *  There are now THREE distinguishable generations of saved character, and the
 *  #91 marker only separates the first:
 *
 *    pre-tier      no `utility_tier_aware`      -> healUtilityTier appends the row
 *    pre-container `utility_tier_aware` only    -> THIS heals: pin the row to the
 *                                                 bottom, seed the container
 *    post-#348     `utility_container_aware`    -> restore verbatim, always
 *
 *  Seeding is free rather than written: a save with no `utilityContainer` key
 *  loads as `null`, which KTD3 defines as "follow the current default roster and
 *  order". So this only has to move the row and say what happened.
 *
 *  A player who REMOVED the row keeps it removed — that was their decision, and
 *  there is nothing to tell them. Pure; returns a new list.
 *  Returns `{ priorities, moved, seeded, message }`. */
function healUtilityContainer(priorities, containerMarked) {
  const list = (Array.isArray(priorities) ? priorities : []).slice();
  if (containerMarked) return { priorities: list, moved: false, seeded: false, message: null };
  const at = list.indexOf(_utilitySentinel);
  if (at < 0) return { priorities: list, moved: false, seeded: false, message: null };
  const moved = at !== list.length - 1;
  if (moved) { list.splice(at, 1); list.push(_utilitySentinel); }
  return {
    priorities: list, moved, seeded: true,
    // R13 — BOTH facts in one sentence, and the third fact the player needs most:
    // nothing re-solves until they ask, so the loadout on screen is still the one
    // they saved. A notice that omitted that would read as "your build changed".
    message: (moved
      ? `"${_utilitySentinel}" is now a pinned container at the bottom of your priorities — it moved there from where you had it, `
      : `"${_utilitySentinel}" is now a pinned container at the bottom of your priorities — `)
      + "and it holds a default set of nice-to-have effects you can reorder or replace under Curate. "
      + "Your saved loadout is unchanged until you re-solve.",
  };
}

/** #91 (review fix, beside healUtilityTier for the same reason) — the
 *  RENDER-ONLY query for a restored record. `healUtilityTier` heals
 *  `state.priorities` so the ranked list displays the tier, but `query` (the
 *  record that was ACTUALLY solved, `rec.query`) is a separate object and a
 *  healed-unmarked restore's query still lacks the sentinel — rendering it
 *  verbatim skips right past `utilityCard`'s report-absent branch, so the "this
 *  saved build predates utility tracking" disclosure never shows even though
 *  the priority list now displays the tier.
 *
 *  Returns a NEW object with the sentinel appended to a copy of `targets` when
 *  healing applies (unmarked AND the sentinel isn't already present); returns
 *  `query` itself, same reference, otherwise. Pure — never mutates `query`,
 *  so the caller's `query` (what actually reaches `buildModel`, `state.lastRun`,
 *  and a later Save) stays exactly the solved record. A genuine re-solve goes
 *  through `solve()`, which rebuilds the query from live (healed) state and
 *  produces the real report. */
function restoredRenderQuery(query, marked) {
  const targets = (query && query.targets) || [];
  if (marked || targets.includes(_utilitySentinel)) return query;
  return Object.assign({}, query, { targets: targets.concat([_utilitySentinel]) });
}

/** #91 (U4/R15) — the datalist option list for both add-a-stat inputs
 *  (`wz-stats`, `wz-stats2`): the picker vocabulary's suggestions plus the
 *  Utility sentinel's display name. Seeded HERE and not into the vocabulary
 *  itself: the sentinel is not an affix — it must never join `known` (free-typed
 *  validation) or the canonical map, only the autocomplete, so a removed tier is
 *  re-addable as a first-class entry rather than type-it-blind. Pure. */
function datalistStats(vocab) {
  const out = (vocab && Array.isArray(vocab.suggestions)) ? vocab.suggestions.slice() : [];
  if (!out.includes(_utilitySentinel)) out.push(_utilitySentinel);
  return out;
}

/** U11 (R15) — decide what adding `name` to `priorities` should produce. Pure: the
 *  caller owns the DOM and the rest of `state`, so this half is unit-testable while
 *  `addPriority` (inside the window-gated IIFE) stays a thin wrapper.
 *
 *  Returns `{ ok, priorities, substitutions, message }`.
 *
 *  Three outcomes, in the order they are decided:
 *
 *  1. An ALIASED enchantment name — one of the provenance labels the item surfaces
 *     display ("Sacred Spell Focus Mastery", "Parrying") — substitutes into the stats
 *     it becomes, as consecutive priorities in the expansion's declared order.
 *     Delegated to `migratePriorities`, the SAME function the saved-character load
 *     path uses: it preserves rank position, inserts in declared order, and dedupes
 *     across families, so ranking two names that both grant Armor Class yields one.
 *
 *     The components occupy SEPARATE lexicographic ranks and are never fused into one
 *     combined objective term. A weighted sum is the trade-off mode the Non-goals list
 *     declines: priority 2 is maximized without surrendering a point of priority 1,
 *     and folding seven schools into a single term would silently trade the player's
 *     top stat away. The consequence is real and is why the caller must disclose it —
 *     one alias resolving to seven stats takes seven ranks, so ranking `Sacred Spell
 *     Focus Mastery` first puts the player's second priority at rank eight.
 *
 *  2. An expanded-away name NO surface displays as an origin (`Well Rounded`, whose
 *     Enhancement variant is engraved "Enhancement Well Rounded", so the bare name
 *     appears on nothing) keeps removal-and-redirect: there is no printed name to make
 *     actionable, and ranking it would score zero.
 *
 *  3. Anything else behaves exactly as before — canonicalize, validate against the
 *     unfiltered `known` set, ignore a duplicate. */
function resolvePriorityAdd(name, vocab, priorities) {
  const DN = _datasetNormalizer();
  const ranked = Array.isArray(priorities) ? priorities.slice() : [];
  const raw = String(name == null ? "" : name).trim();
  // #91 (U4/R15) — the Utility tier is a first-class add even though it is not a
  // vocab stat (it deliberately never joins `known`). Case-insensitive match on
  // the display name, BEFORE canonicalization: the alias table knows nothing
  // about it. A duplicate is a silent no-op, exactly like a duplicate stat; a
  // re-add lands at the bottom — the tier's seeded default position.
  if (raw.toLowerCase() === _utilitySentinel.toLowerCase()) {
    if (ranked.includes(_utilitySentinel)) return { ok: false, priorities: ranked, substitutions: [] };
    return { ok: true, priorities: ranked.concat([_utilitySentinel]), substitutions: [] };
  }
  const v = vocab.canonical(raw);
  if (!v) return { ok: false, priorities: ranked, substitutions: [] };

  const to = (DN && DN.expandedAwayFor) ? DN.expandedAwayFor(vocab, v) : null;
  if (to) {
    if (!(DN.isProvenanceLabel && DN.isProvenanceLabel(vocab, v))) {
      return { ok: false, priorities: ranked, substitutions: [],
               message: DN.expandedAwayMessage(vocab, v) };
    }
    // Append then migrate the WHOLE list: the alias lands at its rank and expands in
    // place, so anything ranked below it is pushed down rather than dropped.
    // (#91 U4/R1: "its rank" is above a bottom-seated Utility tier, which stays last.)
    const proposed = insertAboveTrailingSentinel(ranked, v);
    const migrated = DN.migratePriorities(proposed, vocab);
    return { ok: true, priorities: migrated.priorities, substitutions: migrated.substitutions };
  }

  // #381 — a RETIRED label is refused, never added: it is the same enchantment under
  // a name the game data stopped using, so nothing carries it and ranking it would
  // score zero. Refusing it is what keeps the migration one-way — a retired label is
  // repaired on load and can never re-enter the priority list. It only needs a better
  // sentence than the generic unknown-affix one below, which would leave the player
  // hunting for a name that reads correct off their own gear.
  const retiredMsg = (DN && DN.retiredLabelMessage) ? DN.retiredLabelMessage(vocab, v) : null;
  if (retiredMsg) return { ok: false, priorities: ranked, substitutions: [], message: retiredMsg };

  if (!vocab.known.has(v)) {
    return { ok: false, priorities: ranked, substitutions: [],
             message: `"${v}" isn't a known affix in the dataset.` };
  }
  if (ranked.includes(v)) return { ok: false, priorities: ranked, substitutions: [] };
  // #91 (U4/R1) — a new stat lands above a bottom-seated Utility tier.
  const next = insertAboveTrailingSentinel(ranked, v);
  // #404 — ADVISORY only: a companion stat is a second, differently-named source
  // of the same in-game number. Unlike the expanded-away branch above, this does
  // NOT touch the list — both names score, they are simply not the same stat, so
  // ranking the companion is the player's call. Computed against `next` so a
  // companion the player just added is not suggested back to them.
  const companionHint = (DN && DN.companionHintFor) ? DN.companionHintFor(v, next) : null;
  return { ok: true, priorities: next, substitutions: [],
           ...(companionHint ? { companionHint } : {}) };
}

// Composable affix BUNDLES — modelled on the DDO gear planner's "packages" (its
// "pick a bundle of affixes to save time"). Picking a bundle APPENDS its affixes
// to the priority list (deduped, in the bundle's order); the user then reorders /
// adds / removes. Additive + layered, NOT one-shot archetype templates:
//   * top packages: Basic / Melee / Ranged / Caster / Trapping / Warlock
//
// EVERY ROW IS VISIBLE AT ALL TIMES — deliberate, not an oversight. This once
// described Melee revealing TACTICS and Caster revealing SCHOOLS + SPELL POWER,
// but that disclosure never actually worked: `.wz-bundle-row { display: flex }`
// is a class rule and beat the UA stylesheet's `[hidden] { display: none }`, so
// the rows always rendered. Making it work removed three rows players had been
// using for the life of the feature, and the flat layout is the chosen behavior.
// Do not reinstate the reveal. (The `.wz-bundle-row[hidden]` CSS rule stays — it
// is correct, and a row marked hidden in future should hide.)
// Affix lists are the gear planner's, verbatim; resolveBundle canonicalizes,
// MIGRATES expanded-away labels into the stats they stand for, and drops any our
// dataset doesn't carry.
//
// This comment used to end "so a bundle can never inject a dead target." That
// sentence was false for the life of the feature and is why the gap survived
// review: it reads as a guarantee, and the `vocab.known` filter looks like it
// delivers one. It does not — `known` is a registry of NAMES, not a population of
// CARRIERS. See resolveBundle's own header (#507) for what actually enforces it,
// and `tests/wizard.test.js` for the guard that now asserts carriers rather than
// registry membership.
const PRESET_BUNDLES = {
  // Order within a bundle is the order it lands in the priority list, and #1 is
  // maximized first — so a bundle's lead affixes are a real recommendation, not
  // cosmetics. Basic and Ranged lead with what players actually want first.
  Basic: ["Constitution", "Healing Amplification", "Physical Sheltering", "Magical Sheltering", "Dodge", "Fortification", "False Life", "Resistance", "Freedom of Movement", "Blurry", "Ghostly", "Blindness Immunity"],
  Melee: ["Melee Power", "Doublestrike", "Melee Alacrity", "Accuracy", "Deadly", "Seeker", "Armor-Piercing", "Armor Class"],
  Ranged: ["Ranged Power", "Doubleshot", "Deadly", "Armor-Piercing", "Ranged Alacrity", "Accuracy"],
  Caster: ["Universal Spell Power", "Universal Spell Lore", "Spell Penetration", "Spell Focus Mastery", "Wizardry", "Spellcraft"],
  Trapping: ["Open Lock", "Disable Device", "Spot", "Search"],
  // Warlock is the one class-named package: its damage identity is pact dice and
  // eldritch blast rather than a role the other packages already cover. Blast
  // damage type is set by pact, so all three families ship together and the
  // player drops the two that don't apply.
  // The two warlock-mechanic stats the catalog actually carries as rankable.
  // There is no third: every other "Blast" affix is a weapon proc, not a pact
  // mechanic. An earlier revision padded this with generic caster stats and three
  // elemental families rather than reporting that the list is short.
  Warlock: ["Power in Pact", "Eldritch Blast Dice"],
  // The six ability scores, as one click. Its own row above Tactics — always
  // visible, revealed by nothing, since every build wants some of these.
  // One bundle per ability score, not a batch. These exist to save typing a stat
  // the player always wants — ranking all six at once is not something anyone asks
  // for, so each button adds exactly itself (same shape as the tactics singles).
  Strength: ["Strength"], Dexterity: ["Dexterity"], Constitution: ["Constitution"],
  Intelligence: ["Intelligence"], Wisdom: ["Wisdom"], Charisma: ["Charisma"],
  // tactics (revealed by Melee) — each is a single presence affix
  Stunning: ["Stunning"], Sundering: ["Sundering"], Vertigo: ["Vertigo"],
  // spell schools (revealed by Caster) — the button label is the school, the affix is "<School> Focus"
  Evocation: ["Evocation Focus"], Transmutation: ["Transmutation Focus"], Abjuration: ["Abjuration Focus"],
  Conjuration: ["Conjuration Focus"], Enchantment: ["Enchantment Focus"], Illusion: ["Illusion Focus"], Necromancy: ["Necromancy Focus"],
  // damage-type spell power (revealed by Caster) — power + lore + intensity per element
  Healing: ["Devotion", "Healing Lore", "Healing Intensity", "Heal"],
  Kinetic: ["Impulse", "Kinetic Lore", "Kinetic Intensity"],
  Fire: ["Combustion", "Fire Lore", "Fire Intensity"],
  Cold: ["Glaciation", "Ice Lore", "Ice Intensity"],
  Electric: ["Magnetism", "Lightning Lore", "Lightning Intensity"],
  Acid: ["Corrosion", "Acid Lore", "Acid Intensity"],
  Sonic: ["Resonance", "Sonic Lore", "Sonic Intensity"],
  Negative: ["Nullification", "Void Lore", "Void Intensity"],
  Light: ["Radiance", "Radiance Lore", "Radiance Intensity"],
  Repair: ["Repair Spell Power", "Repair Lore", "Repair Intensity", "Repair"],
  Poison: ["Poison Spell Power", "Poison Lore", "Void Intensity"],
};
// UI groupings + progressive disclosure (which top package reveals which extra row).
const BUNDLE_GROUPS = {
  packages: ["Basic", "Melee", "Ranged", "Caster", "Trapping", "Warlock"],
  attributes: ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"],
  tactics: ["Stunning", "Sundering", "Vertigo"],
  schools: ["Evocation", "Transmutation", "Abjuration", "Conjuration", "Enchantment", "Illusion", "Necromancy"],
  spellpower: ["Healing", "Kinetic", "Fire", "Cold", "Electric", "Acid", "Sonic", "Negative", "Light", "Repair", "Poison"],
};

/** The saved-bundle store, resolved at CALL time rather than load time.
 *  `saved-bundles.js` loads after this file in Node's require graph and before it
 *  in the browser, so a load-time binding would be correct in exactly one of the
 *  two. Same shape as persist.js's `overrides.js` bridge. */
function _savedBundles() {
  if (typeof window !== "undefined" && window.SavedBundles) return window.SavedBundles;
  if (typeof require !== "undefined") { try { return require("./saved-bundles.js"); } catch (e) { /* absent */ } }
  return null;
}

/** Module-scope output encoding, for the exported renderers below.
 *
 *  The wizard's `esc` is declared inside the browser block, so a pure function
 *  exported for Node tests cannot reach it — it would throw on the first render
 *  outside a browser. Same 5-character escape as the browser one's fallback
 *  (including the apostrophe an older local helper missed), and it prefers the
 *  global from results.js when that has loaded, so there is one encoding in the
 *  page and not two that could diverge. */
const _escAttr = (s) => ((typeof window !== "undefined" && typeof window.esc === "function")
  ? window.esc(s)
  : String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

/** plan 2026-08-25-001 U1 — the containers, in render order, with the heading each
 *  one shows. Derived from BUNDLE_GROUPS rather than duplicating its keys: a group
 *  added there and not listed here renders nowhere, which a test catches, and the
 *  reverse cannot happen because the renderer reads the group's own contents.
 *
 *  `packages` gains a heading it never had. It shipped as an untagged row above
 *  four tagged ones, so it read as loose chips rather than as a group, which is
 *  half of why the area looked unstructured. */
const BUNDLE_CONTAINERS = [
  { group: "packages", label: "Starting points" },
  { group: "attributes", label: "Ability scores" },
  { group: "tactics", label: "Tactics" },
  { group: "spellpower", label: "Spell power" },
  { group: "schools", label: "Spell schools (DC)" },
];

/** One bundle container: a heading, a count, and the group's chips.
 *
 *  NO DISCLOSURE CONTROL, and this is deliberate rather than an omission. The
 *  progressive disclosure that once hid these rows was removed after it took
 *  three rows players had been using for the life of the feature, and the flat
 *  layout is the chosen behavior — see the note above PRESET_BUNDLES. Containment
 *  here is visual only; nothing collapses, and no rule may hide a container body.
 *
 *  The COUNT is load-bearing, not decoration. It is what lets a container holding
 *  nothing read as information rather than as an empty broken box — which is the
 *  state the player's own saved bundles will start in.
 *
 *  Sizing is CSS: the grid fits as many columns as the width allows and each
 *  container grows to its contents, so volume and viewport drive the layout with
 *  no JavaScript measuring anything. */
function bundleBoxHTML(group, label, count, bodyHTML) {
  const e = _escAttr;
  return `<section class="wz-bundle-box" data-group="${e(group)}">
    <header class="wz-bundle-head">
      <span class="wz-bundle-tag">${e(label)}</span>
      <span class="wz-bundle-count" data-count="${e(group)}">${Number(count) || 0}</span>
    </header>
    <div class="wz-bundle-body">${bodyHTML}</div>
  </section>`;
}

function bundleContainerHTML(group, label, keys) {
  const e = _escAttr;
  const list = Array.isArray(keys) ? keys : [];
  return bundleBoxHTML(group, label, list.length, `<div class="wz-bundle-row">
        ${list.map((k) => `<button type="button" class="wz-bundle" data-bundle="${e(k)}">${e(k)}</button>`).join("")}
      </div>`);
}

/** plan U3 — the player's own saved rankings, in the same container chrome as the
 *  presets (`bundleBoxHTML`), because they belong to the same shelf. One chrome,
 *  two bodies: a second box implementation is how the two would drift apart.
 *
 *  The EMPTY STATE is a requirement, not a nicety. A container that renders zero
 *  chips and nothing else reads as broken rather than as empty, and this is the
 *  state every player sees before they have saved anything — so it carries the
 *  explanation and the save action rather than an apology.
 *
 *  The save action is always present, empty or not: it is the only way a bundle
 *  gets created, and hiding it behind a populated container would make the
 *  feature unreachable exactly when it is needed. */
function savedBundlesHTML(bundles) {
  const e = _escAttr;
  const list = Array.isArray(bundles) ? bundles : [];
  const chips = list.length
    ? `<div class="wz-bundle-row">${list.map((b) => {
      const n = (b.affixes || []).length;
      // Rename and delete ride WITH the chip and exist only here. A preset chip
      // renders none of them, and the handlers refuse a preset key anyway — an
      // absent control is a UI state, not a guarantee.
      return `<span class="wz-saved-chip">
        <button type="button" class="wz-bundle wz-bundle-mine" data-saved-bundle="${e(b.id)}"
          title="Apply \u2014 ${e(n)} ${n === 1 ? "stat" : "stats"}">${e(b.name || "Untitled")}</button>
        <button type="button" class="wz-saved-act" data-rename-bundle="${e(b.id)}"
          aria-label="Rename ${e(b.name || "Untitled")}" title="Rename">\u270e</button>
        <button type="button" class="wz-saved-act" data-delete-bundle="${e(b.id)}"
          aria-label="Delete ${e(b.name || "Untitled")}" title="Delete">\u2715</button>
      </span>`;
    }).join("")}</div>`
    : `<p class="wz-help wz-bundle-empty">Rank the stats you want, then save that order as a bundle you can reuse on any character.</p>`;
  return bundleBoxHTML("mine", "My bundles", list.length, `${chips}
      <div class="wz-bundle-save">
        <input type="text" id="wz-bundle-name" data-nodirty maxlength="60"
          placeholder="Name this ranking…" aria-label="Name for the saved bundle">
        <button type="button" class="btn ghost" id="wz-bundle-save">Save current ranks</button>
      </div>
      <p class="wz-bundle-msg" id="wz-bundle-msg" role="status" aria-live="polite"></p>`);
}

/** plan U4 — the ranking a saved bundle restores, and what it preserves.
 *
 *  REPLACE, not append. A saved ranking is a complete recipe whose #1 is the
 *  decision that mattered; appending it onto a non-empty list would demote that
 *  #1 to rank six and hand back a build the player never saved. Presets keep
 *  appending — they are building blocks, and `addBundle` is untouched.
 *
 *  THE UTILITY TIER IS NOT ONE OF THE RANKED STATS, so a bundle does not carry
 *  one and applying a bundle must not remove one. `newPriorityList` seeds the
 *  sentinel into every ranking, so a wholesale replace would silently delete a
 *  tier-level setting the player never asked to change. Presence is preserved and
 *  the tier lands at the bottom — its seeded default. Its exact former position
 *  is deliberately NOT preserved: the player may have dragged it to rank 3 of a
 *  ten-stat list, and rank 3 of a different list is not the same decision.
 *
 *  Bounds come from the bundle alone. Carrying the old ranking's floors forward
 *  would leave bounds keyed to stats the new ranking no longer has — the orphan
 *  the store's own write boundary refuses. */
function applySavedBundle(bundle, ranked) {
  const b = bundle || {};
  const cur = Array.isArray(ranked) ? ranked : [];
  const keepTier = cur.includes(_utilitySentinel);
  const stats = (Array.isArray(b.affixes) ? b.affixes : [])
    .filter((a) => typeof a === "string" && a && a !== _utilitySentinel);
  return {
    priorities: keepTier ? [...stats, _utilitySentinel] : stats,
    targetFloors: Object.assign({}, b.floors || {}),
    targetCaps: Object.assign({}, b.caps || {}),
  };
}

/** plan U4 — what the player is asked before a replace discards their work.
 *  Named the way `overwriteConfirmText` is, and pure for the same reason: the
 *  sentence is the product, so it is testable without a browser. */
function applyBundleConfirmText(name, rankedCount) {
  const n = Number(rankedCount) || 0;
  return `Replace your current ranking with \u201C${String(name || "")}\u201D?`
    + ` The ${n} ${n === 1 ? "stat" : "stats"} you have ranked now, and their floors and caps, are discarded.`;
}

/** plan U5 — the delete confirmation. A bundle is authored work and nothing else
 *  in the app holds a copy of it, so the sentence says what is lost rather than
 *  asking a bare "are you sure". */
function deleteBundleConfirmText(name, statCount) {
  const n = Number(statCount) || 0;
  return `Delete the saved bundle \u201C${String(name || "")}\u201D?`
    + ` Its ${n} ranked ${n === 1 ? "stat" : "stats"} and ${n === 1 ? "its" : "their"} bounds are removed.`
    + " Your builds are not affected.";
}

/** plan U3 — the bundle a save would produce, from the live ranking.
 *
 *  Pure, and it takes the ranking and the two bound maps rather than reading
 *  `state`, so what a save captures is testable without a browser. The store's
 *  own write boundary re-derives the same shape; this is the caller side of that
 *  contract, not a second implementation of it — bounds for affixes that are not
 *  ranked, and every character-level field, are dropped there. */
function bundleFromRanking(id, name, priorities, floors, caps, savedAt) {
  const B = _savedBundles();
  const ranked = (Array.isArray(priorities) ? priorities : [])
    .filter((p) => typeof p === "string" && p && p !== _utilitySentinel);
  return B
    ? B.makeBundle({ id, name, affixes: ranked, floors, caps, savedAt: savedAt || null })
    : { id, name, affixes: ranked, floors: {}, caps: {}, savedAt: savedAt || null };
}

/** Resolve a bundle key to a canonicalized, migrated, dataset-filtered, deduped
 *  affix list. Unknown key -> []. Pure.
 *
 *  #507 — THE MIGRATION IS NOT OPTIONAL. `vocab.known` is a registry of NAMES, not
 *  a population of CARRIERS: it is built from `metadata.affix_registry`, which
 *  includes provenance labels for enchantments that expand away. So an
 *  expanded-away name passes the `known` filter and lands as a priority no item can
 *  ever satisfy — a silent zero, indistinguishable from a stat that scored badly.
 *
 *  Two bundles shipped that way. `Basic` ranked `Resistance` (zero carriers; it is
 *  the SOURCE of 621 Fortitude/Reflex/Will Save affixes) and `Caster` ranked
 *  `Spell Focus Mastery` (zero carriers; the seven school focuses) — the latter
 *  being the exact name #250 was written about. Ranked alone, `Resistance` returned
 *  an EMPTY loadout reported as optimal.
 *
 *  This is the third add-a-priority path, and the other two already handled it:
 *  `query.js addTarget` REFUSES an expanded-away name and points at its components
 *  (#136), and `wizard.js resolvePriorityAdd` EXPANDS it. This one did neither.
 *  Route through the same `migratePriorities` they use rather than expanding here,
 *  so the rule stays in one place — that also picks up RETIRED labels (#381), which
 *  a bundle could carry for the same reason and with the same silent result.
 *
 *  ORDER MATTERS: migrate BEFORE filtering on `known`. Filtering first would drop an
 *  expanded-away name that is absent from the registry before it ever got the chance
 *  to become the live stats it stands for. */
function resolveBundle(key, vocab) {
  const affixes = PRESET_BUNDLES[key];
  if (!affixes) return [];
  // Canonicalize first, so the migration sees the one name gear/augments carry.
  const canon = [];
  for (const name of affixes) {
    const c = vocab && vocab.canonical ? vocab.canonical(name) : name;
    if (c) canon.push(c);
  }
  const DN = _datasetNormalizer();
  const migrated = (DN && DN.migratePriorities)
    ? DN.migratePriorities(canon, vocab).priorities
    : canon;
  const out = [];
  for (const c of migrated) {
    if (c && (!vocab || !vocab.known || vocab.known.has(c)) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Append a bundle's resolved affixes to an existing priority list, skipping any
 *  already present (order preserved: existing first, then the bundle's new ones).
 *  Pure — returns a new array. This is the "place the picked selection into the
 *  priority order, then let the user adjust" step. */
function addBundle(key, current, vocab) {
  // #91 (U4/R1) — bundle affixes land above a bottom-seated Utility tier, same
  // rule as a single add: the seeded default keeps every ranked stat above it.
  let next = (current || []).slice();
  for (const affix of resolveBundle(key, vocab)) {
    if (!next.includes(affix)) next = insertAboveTrailingSentinel(next, affix);
  }
  return next;
}

/** U1 (#218) — wait for the overlay to actually render before synchronous work runs.
 *
 *  `solve()` sets the overlay and then awaits HiGHS. On the FIRST solve the WASM
 *  module load is genuinely async, so the browser gets a turn and the overlay
 *  appears. On every re-solve `getHighs()` returns the cached module, so that
 *  await resolves as a microtask — and microtasks drain BEFORE paint — after which
 *  the synchronous MILP blocks the main thread. The overlay sat in the DOM with
 *  its `on` class set and never rendered, so a re-solve looked frozen.
 *
 *  **Never a microtask.** `queueMicrotask` or `await Promise.resolve()` reads like
 *  the same fix and changes nothing, because they resolve in the drain that
 *  already runs before paint — the very mechanism that hid the overlay. That
 *  equivalence is the trap this helper exists to make untrappable: it is exported
 *  solely so `tests/wizard-yield.test.js` fails when a microtask is substituted.
 *
 *  `web/results.js` defers the upgrades-search spinner for the same reason,
 *  though with a timer rather than frames. */
// #578 — how long the nested-frame path may stall before the timer takes over.
// Only ever reached when frames stop arriving to a tab that still reports itself
// visible (heavy throttling, or an occlusion the page has not been told about), so
// it costs nothing on the ordinary path and is deliberately generous: two frames
// are ~33 ms at 60 Hz, so 2 s is ~60x headroom and cannot pre-empt a slow paint.
var PAINT_STALL_FALLBACK_MS = 2000;

function yieldToPaint() {
  return new Promise((resolve) => {
    // Two nested frames, not a bare `setTimeout(0)`. A timer yields the task queue
    // but promises nothing about rendering: the browser paints on its own
    // schedule, so a solve that starts before the next frame can block straight
    // through it. Nested frames are the actual guarantee — the first callback runs
    // before a paint, the second only after that frame has been rendered — so by
    // the time this resolves the overlay is on screen, not merely in the DOM.
    //
    // #578 — but a frame is a PREFERENCE, never a precondition. Browsers stop
    // delivering rAF to a hidden, minimized, or occluded tab, so the nested-frame
    // contract above simply never completes there and every caller awaiting it
    // parks forever. That is the whole of the reported hang: `solve()` had already
    // raised the overlay, `overlay(false)` lives in the `finally` it never reaches,
    // and the player got an unbounded spinner with no cancel — on a main thread
    // that was IDLE, not busy. Nothing about the solve was slow; HiGHS was never
    // even instantiated. It was reported as a solver defect specific to ranking a
    // stat with no reachable source, and it is neither: ranking `Melee Power`
    // alone — the issue's own passing control — hangs identically in a hidden tab,
    // and the same ranking that "never returns" completes in ~1.1 s once frames
    // are delivered. The stat was a coincidence of which run happened to be
    // backgrounded.
    //
    // `animateCounters` in web/results.js already carries this exact lesson
    // ("rAF pauses entirely in a backgrounded/throttled tab and can fire once then
    // stall") for a cosmetic count-up. The solve gate — where the cost is the
    // entire result rather than an animation — never got it.
    //
    // So: skip the frames outright when the tab already reports itself hidden
    // (there is no paint to wait for), and otherwise race them against a timer so
    // a stall degrades to "solve without the paint guarantee" instead of "never
    // solve". Resolution is latched, so whichever arrives first wins exactly once.
    let settled = false;
    const done = () => { if (settled) return; settled = true; resolve(); };
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (typeof requestAnimationFrame !== "function" || hidden) {
      // Node has no frames; the macrotask contract is what the tests pin. A hidden
      // tab has none either, and waiting on one is how the hang happened.
      setTimeout(done, 0);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(done));
    setTimeout(done, PAINT_STALL_FALLBACK_MS);
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { WIZARD_STEPS, canAdvance, nextStep, prevStep, wizIsForged, buildQuery, cleanBoundMap, cleanCreditMap, creditKey, creditIsUsable, isPresenceOnly, isUntypedOnly, canDeclareCredit, advancedRowModel, advancedBadgeText, openPanels, openPanelToggle, openPanelSweep, openPanelClear, panelOpenAttr, stepAfterLoad, savedStep, stepOnLoad, nameCollides, runBelongsTo, overwriteConfirmText, renameRefusalText, farmingTakeover, farmingTakeoverText, deleteBuildConfirmText, storedItemsModel, storedItemsHTML, railModel, saveControl, saveOkText, saveErrorText, resolveBannerShowing, resolveBannerPrimary, CHARACTER_REQUIRED, missingRequired, missingRequiredMessage, weaponGroupSummary, curatedStats, pickerVocabulary, setAugSummaryLabel, PRESET_BUNDLES, BUNDLE_GROUPS, BUNDLE_CONTAINERS, bundleContainerHTML, bundleBoxHTML, savedBundlesHTML, bundleFromRanking, applySavedBundle, applyBundleConfirmText, deleteBundleConfirmText, resolveBundle, addBundle, twfMigrationNeeded, pinWornSlotOf, pinHandsFor, pinIdOf, applyPin, applyPinId, removePinFrom, reconcilePinLegality, dualPinMutexConflict, yieldToPaint, PAINT_STALL_FALLBACK_MS, resolvePriorityAdd, newPriorityList, insertAboveTrailingSentinel, healUtilityTier, healUtilityContainer, restoredRenderQuery, datalistStats, addBlocks, removeBlock, pinBlockedConflict,
    pinnableSets, addSetPins, removeSetPin, setPinStale, setPinSlowNotice, blockPinOverlap, blockPinSlotOf, blockStale, blockLoadMessage, noDropNote, rungFromInputs, restoreOverrides, OVERRIDE_LIMIT, overrideLoadMessage, staleNote, addOverrideTo, removeOverrideAt, reconfirmOverrideAt, findOverrideFor,
    // #348 (U6) — the Utility container's pure logic.
    UTILITY_CONTAINER_CAP, containerList, containerAddable, containerEdit, containerSummary, containerAddHint };
}

// ---- browser flow ----------------------------------------------------------
if (typeof window !== "undefined" && window.App) {
  // Race lists sourced from the DDO wiki (ddowiki.com/page/Races): 30 playable
  // races = 18 basic + 12 Iconic Heroes. Do not add unlisted races (there is no
  // "Battleforged" race — Warforged and its Iconic, Bladeforged, are the two Forged).
  const RACES_BASIC = ["Aasimar", "Dhampir", "Dragonborn", "Drow", "Duergar", "Dwarf",
    "Eladrin", "Elf", "Gnome", "Halfling", "Half-Elf", "Half-Orc", "Human",
    "Shifter", "Tabaxi", "Tiefling", "Warforged", "Wood Elf"];
  const RACES_ICONIC = ["Aasimar Scourge", "Bladeforged", "Deep Gnome", "Dhampir Dark Bargainer",
    "Duergar Mindcleaver", "Eladrin Chaosmancer", "Sun Elf (Morninglord)", "Purple Dragon Knight",
    "Razorclaw Shifter", "Shadar-kai", "Tabaxi Trailblazer", "Tiefling Scoundrel"];
  const ALIGNMENTS = ["Lawful Good", "Neutral Good", "Chaotic Good",
    "Lawful Neutral", "True Neutral", "Chaotic Neutral"];
  const ARMOR = [["cloth", "Cloth"], ["light", "Light"], ["medium", "Medium"], ["heavy", "Heavy"]];
  const WT = (typeof window !== "undefined" && window.WeaponTaxonomy) || null; // U1 taxonomy
  const STEP_LABELS = { intro: "Start", character: "Character", pool: "Gear pool", priorities: "Priorities", results: "Results" };

  // U7 / KTD6: standardize output-encoding on the global esc from results.js
  // (escapes & < > " ' — the apostrophe the old local helper missed). Fall back
  // to a full 5-char escape if results.js somehow hasn't loaded, so a saved or
  // imported character name can never inject markup.
  const esc = (typeof window !== "undefined" && typeof window.esc === "function")
    ? window.esc
    : (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  window.App.ready((dataset) => {
    const root = document.getElementById("wizard");
    if (!root) return;

    // Targetable affix stats for the priority picker (U5): the shared picker
    // vocabulary — the UNION of every affix source (gear, augments, set bonuses, and
    // ALL crafting pools), canonicalized through the alias table and filtered to the
    // rankable ones (so a crafting-only affix is selectable). `known` validates
    // free-typed input; `canonical` maps a typed value to the name gear carries. The
    // solver still accepts any typed affix — this gates suggestions, not input.
    const vocab = pickerVocabulary(dataset);
    // #91 (U4/R15) — suggestions plus the Utility tier's display name, so both
    // add-a-stat datalists offer the removed tier back as a first-class entry.
    const allStats = datalistStats(vocab);

    // U3 — distinct weapon `type` values the dataset actually carries, so the
    // handedness-gated chip list never offers a type with no items (KTD6).
    const weaponTypesInData = [...new Set((dataset.items || [])
      .filter((v) => v.slot === "Weapon" && v.type).map((v) => v.type))];

    // #339 — augCeiling: the augment-only ML ceiling. null = unrestricted (the
    // default: augments follow the item cap); a number strictly below the cap
    // restricts augment tiers only. buildQuery owns the clamp.
    const state = { step: "intro", ml: 36, mlFloor: 31, mlFloorManual: false, augCeiling: null,
      // #348 (U3, KTD3) — the Utility container. `null` means "follow the current
      // default roster and order", so a player who never opens the curation panel
      // picks up a later roster revision (#349) instead of being frozen at whatever
      // the roster was the day they saved. An ARRAY means the player curated it, and
      // is frozen against roster changes on purpose — their list is theirs.
      utilityContainer: null,
      // #348 (U6) — transient panel state: the search box's text and the last
      // refusal message. Deliberately NOT persisted — neither is part of the build.
      utilityQuery: "", utilityStatus: "",
      race: "", alignment: "", armor: "", oath: "",
      style: "", weaponTypes: [], offHand: [], offHandWeapons: [],
      // plan 003 U1 — the Two Weapon Fighting declaration. Character state, not gear
      // state: the combat-style handler clears weaponTypes/offHand/offHandWeapons but
      // must never clear this (R2).
      twoWeaponFighting: false,
      includeArtifact: false,
      // #346 — the crafting/augment ladder (replaced #245's boolean). Defaults to
      // the top rung: the full min-max solve is the product, and the lower rungs
      // are the "items must win on what is printed on them" modes for players who
      // won't grind the crafts or buy the augments.
      craftingRung: "everything",
      // #110 (U1/KTD6) — the blocklist: variant ids the solver must never place.
      // An ARRAY of id strings, never an object keyed by names — item names are
      // untrusted data, and a name-keyed object lands in the prototype-pollution
      // surface the backup reviver guards (a priority named `constructor` once
      // made a character permanently unloadable).
      blocklist: [],
      pinnedSets: [],
      // #428 U3 (R20) — the name of the saved build currently being edited, or
      // "" for an unsaved one. Transient by design: it is NOT on INPUT_KEYS,
      // because which record you loaded is a fact about this session, not about
      // the build. railModel treats it as loaded only while the store still
      // holds that name, so a delete needs no second clear.
      loadedName: "",
      // #428 U5 (KTD3) — raised by any write to a build input, cleared by save
      // and by load. A single flag rather than a diff against the last save: it
      // cannot drift from what the player actually changed the way a diff over a
      // large state object can, and it costs nothing per keystroke.
      inputsDirty: false,
      // #452 U2 (R6/R7) — the name whose overwrite the player has already
      // accepted, or null. Lives in `state`, never in the record: it is a UI
      // acknowledgement, and persisting it would carry a meaningless field into
      // every shared and exported build — and past `sanitizeCharacter`'s
      // allowlist, which #420 hardened to refuse rather than silently reduce.
      // Deliberately does not survive a reload; a reload re-establishes the same
      // facts and asking once more is correct rather than annoying (R7).
      nameReconciled: null,
      // #428 U6 — the weapon fold's open state. Persisted on state because half
      // the character step's handlers re-render the whole step, and a fold that
      // snapped shut mid-edit would be worse than not folding at all.
      weaponsOpen: false,
      // #428 U6 (R8) — whether a blocked Continue has already asked. Until it
      // has, nothing is marked as needing an answer (R12); after it has, the
      // marks are re-applied on every render for whatever is STILL missing, so
      // they persist until answered and clear the moment they are.
      requiredShown: false,
      // U6 — set-augment availability. A Set of owned set-augment `set` names;
      // empty by default so the set-augment family stays inert until opted in.
      ownedSetAugments: new Set(),
      // U1/U4 — per-priority stat caps (max) and floors (min), keyed by stat name so
      // they survive priority reordering.
      targetCaps: {}, targetFloors: {},
      // U2 — declared stat credits, keyed `stat||bonusType` so a stat can carry
      // more than one and reordering priorities cannot mis-associate them.
      declaredCredits: {},
      // #88 U5 (R20) — the player's bonus-type overrides, in declaration order.
      // Empty by default, so the overlay is inert until the player asserts one.
      overrides: [],
      // #88 U7 — set on load when a saved override drifted, was adopted upstream,
      // or lost its target. Dismissible, like its three sibling load notices.
      overrideNotice: null,
      // #91 (U4/R1) — a NEW list is born with the Utility tier seeded at the
      // bottom, on by default. Seeding happens only here (list birth), never on
      // load — load-path presence is healUtilityTier's decision (KTD8).
      pool: "all", ownedNames: null, ownedAugments: false, priorities: newPriorityList(), slotConstraints: {}, constraintsDirty: false, lastRun: null,
      characterName: "", loadedStale: false,
      // plan 003 U4 — set on load when a pre-U1 save is migrated to declared.
      twfMigrated: false,
      // #169 — set on load when a saved character ranked an expanded-away name;
      // holds the disclosure sentence, or null when nothing was substituted.
      expandedAwayMigrated: null };

    let highs = null;
    async function getHighs() {
      if (highs) return highs;
      // eslint-disable-next-line no-undef
      highs = await Module({ locateFile: (f) => "vendor/" + f });
      return highs;
    }

    // ---- stepper -----------------------------------------------------------
    function renderStepper() {
      const done = (id) => WIZARD_STEPS.indexOf(id) < WIZARD_STEPS.indexOf(state.step);
      return `<ol class="wz-steps">${WIZARD_STEPS.map((id) => {
        const cls = done(id) ? "done" : (id === state.step ? "on" : "");
        const n = WIZARD_STEPS.indexOf(id) + 1;
        return `<li class="wz-step ${cls}"><button class="wz-dot" data-goto="${id}" ${done(id) ? "" : "disabled"}>${done(id) ? "✓" : n}</button><span>${STEP_LABELS[id]}</span></li>`;
      }).join("")}</ol>`;
    }

    // ---- steps -------------------------------------------------------------
    function stepIntro() {
      // #428 U1 (R26) — the opening line describes what the tool DOES. It used to
      // interpolate the catalog size, which reads as a boast about the repository
      // rather than anything a player can act on; per-solve coverage still
      // discloses what a given answer searched (R27, results.js coverageNote).
      return `<section class="wz-card">
        <p class="wz-eyebrow">What this does</p>
        <h2>Find your provably-best gear — not a guess.</h2>
        <p class="wz-lead">Tell us about your character and rank the stats you care about. We search every
          wiki-sourced item, augment, set bonus, and crafting option and return the
          <strong>single loadout that is mathematically optimal</strong> for your priorities — slot by slot,
          with the exact crafting steps to build it.</p>
        <p class="wz-lead">Four short steps, then the answer. No account; it runs entirely in your browser.</p>
        <div class="wz-actions"><span class="wz-spacer"></span><button class="btn primary" data-next>Get started →</button></div>
      </section>`;
    }

    function stepCharacter() {
      const forged = wizIsForged(state.race);
      // #428 U6 (R6a) — the weapon group is the one that collapses, so it has to
      // say whether it holds anything. The style's LABEL comes from the shipped
      // taxonomy, never re-derived here.
      const styleLabel = (WT && state.style)
        ? ((WT.STYLES.find((x) => x.id === state.style) || {}).label || state.style) : "";
      const weaponsSet = weaponGroupSummary(state, styleLabel);
      return `<section class="wz-card">
        <p class="wz-eyebrow">Step 1 of 4 · Your character</p>
        <h2>A few basics so we only show gear you can use</h2>
        <p class="wz-lead">These filter out anything you can't equip before we optimize — no wasted results.</p>
        <div class="wz-form">
          <!-- #428 U6 (R1/R2/R4) — three labelled containers, required first.
               The step used to be nine controls in one flat card with nothing on
               screen saying which of them Continue was waiting for. -->
          <fieldset class="wz-group" data-group="required">
            <legend class="wz-group-legend">Required
              <span class="wz-sub">· ${forged ? "your race wears a docent, so armor is settled" : "all four are needed to continue"}</span></legend>
            <div class="wz-grid">
              <!-- #431 U2 (R1/R2/KTD2) — the build name is a required build input,
                   asked here rather than in the rail. BOUND to state.characterName:
                   render() runs on every navigation, so an unbound field would blank
                   the name each time and block the player on their own gate. -->
              <label class="wz-field wz-span" data-req="name"><span class="wz-label"><span class="wz-req-mark" aria-hidden="true">*</span> Build name</span>
              <span class="wz-help">Names this build so you can save it and come back to it.</span>
              <input id="wz-buildname" type="text" value="${esc(state.characterName)}" placeholder="e.g. Sook — Reaper"></label>
              <label class="wz-field" data-req="ml"><span class="wz-label"><span class="wz-req-mark" aria-hidden="true">*</span> Minimum level (ML) cap</span>
              <span class="wz-help">Highest item level you can equip. Gear above this is excluded.</span>
              <input id="wz-ml" class="wz-ml" type="number" min="1" max="40" value="${esc(state.ml)}"></label>
            <label class="wz-field" data-req="race"><span class="wz-label"><span class="wz-req-mark" aria-hidden="true">*</span> Race</span>
              <span class="wz-help">Determines body-slot and race-locked gear.</span>
              <select id="wz-race"><option value="">Select a race…</option>
                <optgroup label="Basic races">${RACES_BASIC.map((r) => `<option ${state.race === r ? "selected" : ""}>${r}</option>`).join("")}</optgroup>
                <optgroup label="Iconic heroes">${RACES_ICONIC.map((r) => `<option ${state.race === r ? "selected" : ""}>${r}</option>`).join("")}</optgroup></select></label>
            <div class="wz-field wz-span" data-req="armor"><span class="wz-label"><span class="wz-req-mark" aria-hidden="true">*</span> Armor type ${forged ? '<span class="wz-sub">· docent (Forged race)</span>' : ""}</span>
            <span class="wz-help">Your proficiency — sets which body armor you can equip.</span>
            <div class="wz-seg" id="wz-armor">${ARMOR.map(([v, l]) => `<button class="wz-chip ${state.armor === v ? "on" : ""}" data-armor="${v}" ${forged ? "disabled" : ""}>${l}</button>`).join("")}</div></div>
            </div>
          </fieldset>
          <fieldset class="wz-group" data-group="restrictions">
            <legend class="wz-group-legend">Restrictions <span class="wz-sub">· all optional — leave them alone for a full search</span></legend>
            <div class="wz-grid">
              <label class="wz-field"><span class="wz-label">Only items ML ≥ <span id="wz-mlfloor-auto" class="wz-sub"${state.mlFloorManual ? " hidden" : ""}>· auto (cap − 5)</span></span>
              <span class="wz-help">Hide low-level gear — the solver ignores items below this. Defaults to your ML cap − 5 and follows the cap until you set it yourself; lower it to consider more gear.</span>
              <input id="wz-mlfloor" class="wz-ml" type="number" min="1" max="40" value="${state.mlFloor ? esc(state.mlFloor) : ""}"></label>
          <label class="wz-field"><span class="wz-label">Alignment</span>
              <span class="wz-help">No alignment-gated gear is in the verified dataset yet, so this won't change results.</span>
              <select id="wz-align"><option value="">Select an alignment…</option>
                ${ALIGNMENTS.map((a) => `<option ${state.alignment === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
          <div class="wz-field wz-span"><span class="wz-label">Oath / anathema</span>
            <span class="wz-help">A class oath that forbids certain armor. Approximated by armor type — see the note when on.</span>
            <div class="wz-seg" id="wz-oath"><button class="wz-chip ${state.oath === "druid" ? "on" : ""}" data-oath="druid" ${forged ? "disabled" : ""}>Druid — no metal</button></div>
            ${state.oath === "druid" && !forged ? `<p class="wz-help wz-note">Druidic oath: no metal body armor, no metal shield, no rune arm — matched against each item's wiki-sourced material. Proficiency also limits you to light and medium armor and non-tower shields. A few items whose material the wiki doesn't state are left available rather than excluded on a guess.</p>` : ""}</div>
          <label class="wz-check"><input type="checkbox" id="wz-artifact"${state.includeArtifact ? " checked" : ""}>
            <span class="wz-check-body"><span class="wz-label">Include an Artifact</span>
            <span class="wz-help">Build around your one equippable Artifact — the optimizer picks the best-scoring one and tags its slot. Off by default.</span></span></label>
          ${(() => {
            // #346 (U2) — the crafting/augment ladder. A radio group, not a
            // select: four rungs is few enough to show at once, and the whole
            // point is that the player can SEE what each step gives up.
            // Ordered top (least restrictive) to bottom, matching the rank table.
            const rung = _normalizeRung(state.craftingRung);
            const RUNGS = [
              ["everything", "Everything",
                "Craftable options and every augment are on the table. This is the default."],
              ["no-niche-crafting", "No niche crafting",
                "Exclude Viktranium experiments, Sealed-in-X seals, Nearly Completed, Dinosaur Bone crafting, and set-bonus crafting. Augments still count."],
              ["no-solar-lunar", "No niche crafting or Solar/Lunar gems",
                "Also exclude Solar and Lunar Gems. Ordinary colour augments — rubies, sapphires, topazes, diamonds — still count."],
              ["printed-only", "No crafting or augments at all",
                "Every item wins on what is actually printed on it. Pick this when you won't spend crafting mats on gear you'll replace while levelling."],
            ];
            return `<fieldset class="wz-ladder">
              <legend class="wz-label">What may the solver assume beyond the printed item?</legend>
              <!-- #343 — this used to read "Lower rungs mean smaller numbers you
                   can actually reach", which is false per stat. Under strict
                   lexicographic priority a smaller pool that lowers a HIGH
                   priority relaxes every later stage, so a lower priority can
                   genuinely rise: measured ML15/THF, stepping to "No niche
                   crafting" takes Seeker 12 -> 10 and Armor-Piercing 17 -> 22.
                   What is guaranteed is the pool nesting and the top priority. -->
              <span class="wz-help">Each step down removes more than the one above it, so your top priority can only stay the same or get smaller. Priorities below it may shift either way as the solver re-optimises around what is left.</span>
              ${RUNGS.map(([val, label, help]) => `<label class="wz-check">
                <input type="radio" name="wz-crafting-rung" value="${esc(val)}"${rung === val ? " checked" : ""}>
                <span class="wz-check-body"><span class="wz-label">${esc(label)}</span>
                <span class="wz-help">${esc(help)}</span></span></label>`).join("")}
            </fieldset>
            <label class="wz-field" id="wz-augceiling-field"><span class="wz-label">Augments up to ML</span>
              <span class="wz-help" id="wz-augceiling-help">${_rungExcludesAllAugments(rung)
                ? "Not applicable — the rung you chose solves without augments, so there is no augment tier to restrict. Your value is kept for when you move back up."
                : "Restrict augments to tiers you can realistically obtain — items still follow the ML cap. Defaults to your cap (no restriction); lower it to exclude higher augment tiers from the solve."}</span>
              <input id="wz-augceiling" class="wz-ml" type="number" min="1" max="40"${_rungExcludesAllAugments(rung) ? " disabled" : ""} value="${state.augCeiling != null ? esc(state.augCeiling) : esc(state.ml)}"></label>`;
          })()}
          ${(() => {
            // U6 — Set Augment availability. The 21 set-augment names come from the
            // dataset's augment_set_defs (single source of truth). A checked name is
            // added to state.ownedSetAugments; only owned set augments are considered
            // by the solver. Collapsed by default so it stays out of the way.
            const setNames = Object.keys(dataset.augment_set_defs || {}).sort();
            if (!setNames.length) return "";
            const owned = state.ownedSetAugments instanceof Set ? state.ownedSetAugments : new Set();
            const n = owned.size;
            // #346 (U2) — a Set Augment is set-bonus crafting, so every rung from
            // no-niche-crafting down clears the whole family. Leaving this picker
            // live there would let the player tick boxes the solve cannot honour —
            // exactly the contradictory-but-permitted state the ladder's own rule
            // exists to prevent, and the same treatment the augment ML ceiling gets.
            // Ticks are kept on state so they return when the player climbs back.
            const setAugInert = _rungExcludesNicheCrafting(_normalizeRung(state.craftingRung));
            return `<details class="wz-data" id="wz-setaug">
              <summary>${esc(setAugSummaryLabel(n))}</summary>
              <div class="wz-data-body">
                <p class="wz-help">${setAugInert
                  ? "Not applicable — the rung you chose excludes set-bonus crafting, so no Augment Set can activate. Your selections are kept for when you move back up."
                  : "Check the <strong>Set Augments</strong> you own. Only checked ones are considered — each grants its bonus once 3 pieces of its set are equipped. None are considered by default."}</p>
                <div class="wz-setaug-bulk" id="wz-setaug-bulk">
                  <button type="button" class="btn ghost" id="wz-setaug-all"${setAugInert ? " disabled" : ""}>Select all ${setNames.length}</button>
                  <button type="button" class="btn ghost" id="wz-setaug-none"${setAugInert ? " disabled" : ""}>Clear all</button>
                </div>
                <div class="wz-seg wz-setaug-list" id="wz-setaug-list">${setNames.map((s) =>
                  `<label class="wz-check wz-check-inline"><input type="checkbox" data-setaug="${esc(s)}"${owned.has(s) ? " checked" : ""}${setAugInert ? " disabled" : ""}>
                    <span class="wz-check-body"><span class="wz-label">${esc(s)}</span></span></label>`).join("")}</div>
              </div>
            </details>`;
          })()}
            </div>
          </fieldset>
          <details class="wz-group wz-group-fold" data-group="weapons" id="wz-weapons"${state.weaponsOpen ? " open" : ""}>
            <summary class="wz-group-legend">Weapon setup <span class="wz-sub">· ${esc(weaponsSet)}</span></summary>
            <div class="wz-grid">
              ${(() => {
            // plan 003 U3 (R4) — three style states, and the control ACCEPTS INPUT in
            // all three. "Inert" here means the declaration currently has no effect and
            // says so; it is deliberately NOT `disabled`, for two reasons: a player must
            // be able to declare before choosing a style or while on another one (AE3
            // declares, then switches), and a disabled control reads as "your character
            // can't have this feat" rather than "this style doesn't use it".
            //
            // Which styles permit a second weapon is the shipped taxonomy's call, not a
            // new list here (KTD2) — twfWeaponAllowedForStyle is true for `one-hand` only.
            const twfActive = !!(WT && WT.twfWeaponAllowedForStyle(state.style));
            const styleLabel = (WT && state.style)
              ? ((WT.STYLES.find((s) => s.id === state.style) || {}).label || state.style) : "";
            const inert = state.twoWeaponFighting && !twfActive
              ? (state.style
                ? `<p class="wz-help wz-note wz-twf-inert">Declared, but it has no effect under <strong>${esc(styleLabel)}</strong> — that style doesn't wield a second weapon. Your declaration is kept; switch to One-hand / Dual-wield to use it.</p>`
                : `<p class="wz-help wz-note wz-twf-inert">Declared. It has no effect until you pick a combat style that wields a second weapon.</p>`)
              : "";
            return `<div class="wz-field wz-span"><span class="wz-label">Two Weapon Fighting</span>
            <span class="wz-help">Declare the feat if your character fights with a weapon in each hand. Dual-wielding used to switch on only when you added a second weapon type below — declaring it here is the explicit way.</span>
            <div class="wz-seg" id="wz-twf"><button class="wz-chip ${state.twoWeaponFighting ? "on" : ""}" data-twf="1" aria-pressed="${state.twoWeaponFighting ? "true" : "false"}">Two Weapon Fighting</button></div>
            ${inert}</div>`;
          })()}
          ${(() => {
            const styles = WT ? WT.STYLES : [];
            const wtypes = (WT && state.style) ? WT.weaponTypesForStyle(state.style, weaponTypesInData) : [];
            const ohOn = WT ? WT.offHandEnabledForStyle(state.style) : false;
            const twfOn = WT ? WT.twfWeaponAllowedForStyle(state.style) : false;
            const ohTypes = WT ? ((state.style && WT.offHandTypesForStyle(state.style)) || WT.OFF_HAND_TYPES) : [];
            const offWeaponTypes = twfOn ? WT.offHandWeaponTypes(weaponTypesInData) : [];
            // A dropdown pick-list: choose an option to add; picked options show as
            // removable tags. The dropdown offers only the not-yet-picked ones. `o.lbl`
            // maps a value to its display label; `o.add` is the placeholder.
            const pickList = (id, opts, sel, o = {}) => {
              const lbl = o.lbl || ((t) => t), add = o.add || "Add a type…";
              const avail = opts.filter((t) => !sel.includes(t));
              return `<div class="wz-picklist">
              <select class="wz-pl-select" data-plsel="${id}"${avail.length ? "" : " disabled"}>
                <option value="">${avail.length ? esc(add) : "All added"}</option>
                ${avail.map((t) => `<option value="${esc(t)}">${esc(lbl(t))}</option>`).join("")}
              </select>
              <div class="wz-pl-tags" data-pltags="${id}">${sel.map((t) => `<button class="wz-tag" data-pltag="${id}" data-val="${esc(t)}">${esc(lbl(t))}<span class="wz-tag-x" aria-hidden="true">×</span></button>`).join("")}</div></div>`;
            };
            return `<div class="wz-field wz-span"><span class="wz-label">Combat style</span>
            <span class="wz-help">Pick a style to narrow the weapon and off-hand. Click the selected style again to switch. Each list below is optional — add types to narrow it; add nothing and any is allowed.</span>
            <div class="wz-seg" id="wz-style">${(state.style ? styles.filter((s) => s.id === state.style) : styles).map((s) => `<button class="wz-chip ${state.style === s.id ? "on" : ""}" data-style="${s.id}">${esc(s.label)}</button>`).join("")}</div>
            ${state.style ? `<div class="wz-subseg">
              <span class="wz-sublabel">Weapon type <span class="wz-sub">· optional — add none for any</span></span>
              ${pickList("weptypes", wtypes, state.weaponTypes)}
              ${ohOn ? (() => {
                // One "Off hand" dropdown holding both off-hand ITEMS and (dual-wield)
                // a second WEAPON. Selections route to state.offHand vs state.offHandWeapons.
                const ohLbl = (t) => t === "empty" ? "Empty (no off-hand)" : t;
                const itemAvail = ["empty", ...ohTypes].filter((t) => !state.offHand.includes(t));
                const wpnAvail = twfOn ? offWeaponTypes.filter((t) => !state.offHandWeapons.includes(t)) : [];
                const any = itemAvail.length + wpnAvail.length;
                return `<span class="wz-sublabel">Off hand <span class="wz-sub">· optional — add none for any${twfOn ? "; a shield, orb, rune arm, or a second weapon (dual-wield)" : ""}</span></span>
              <div class="wz-picklist">
                <select class="wz-pl-select" data-plsel="offhand"${any ? "" : " disabled"}>
                  <option value="">${any ? "Add…" : "All added"}</option>
                  ${itemAvail.length ? `<optgroup label="Off-hand item">${itemAvail.map((t) => `<option value="${esc(t)}">${esc(ohLbl(t))}</option>`).join("")}</optgroup>` : ""}
                  ${wpnAvail.length ? `<optgroup label="Second weapon (dual-wield)">${wpnAvail.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>` : ""}
                </select>
                <div class="wz-pl-tags" data-pltags="offhand">${state.offHand.map((t) => `<button class="wz-tag" data-pltag="offhand" data-arr="offHand" data-val="${esc(t)}">${esc(ohLbl(t))}<span class="wz-tag-x" aria-hidden="true">×</span></button>`).join("")}${state.offHandWeapons.map((t) => `<button class="wz-tag" data-pltag="offhand" data-arr="offHandWeapons" data-val="${esc(t)}">${esc(t)}<span class="wz-tag-x" aria-hidden="true">×</span></button>`).join("")}</div>
              </div>`;
              })() : `<p class="wz-help wz-note">${state.style === "ranged" ? "Bows use both hands — no off-hand item." : "Two-handed weapons use both hands — no off-hand item."}</p>`}
            </div>` : ""}</div>`;
          })()}
            </div>
          </details>
        </div>
        <p class="wz-status wz-reqmsg" id="wz-charmsg" role="status" aria-live="polite"></p>
        <div class="wz-actions"><button class="btn ghost" data-back>← Back</button><span class="wz-spacer"></span>
          ${saveControl("ghost")}<button class="btn primary" data-next>Continue →</button></div>
      </section>`;
    }

    function stepPool() {
      const owned = state.pool === "owned";
      return `<section class="wz-card">
        <p class="wz-eyebrow">Step 2 of 4 · Which gear should we search?</p>
        <h2>Optimize over everything, or only what you own</h2>
        <p class="wz-lead">Crafting options always come from the full catalog. Owned mode restricts your base
          gear, and — if you turn it on below — your augments too.</p>
        <div class="wz-seg wz-pool">
          <button class="wz-chip big ${!owned ? "on" : ""}" data-pool="all"><strong>All gear in the game</strong><small>Every wiki-sourced named item — theoretical best-in-slot.</small></button>
          <button class="wz-chip big ${owned ? "on" : ""}" data-pool="owned"><strong>Only what I own</strong><small>Upload your Trove inventory export.</small></button>
        </div>
        <div id="wz-upload" class="${owned ? "" : "wz-hidden"}">
          <label class="wz-field"><span class="wz-label">Import your inventory (CSV)</span>
            <span class="wz-help">Export from Trove. Your file never leaves your browser; account columns are ignored.</span>
            <input id="wz-file-label" type="text" readonly placeholder="Click to choose a .csv file…" class="wz-file">
            <input id="wz-file" type="file" accept=".csv" class="wz-hidden"></label>
          <div id="wz-file-stat" class="wz-filestat"></div>
          <!-- #359 — the augment half of inventory mode, OPT-IN and default off.
               Off is today's shipped behavior, so no saved character changes what it
               solves until the player asks. "Acquirable" is not a guess about the
               player: the wiki classifies every augment by rarity, and the 675
               Common/Uncommon/Rare ones are bought from vendors or traded for
               Mysterious Remnants rather than farmed. Restricting to the export
               alone would delete ~88% of the pool, most of it augments nobody hunts. -->
          <label class="wz-check wz-ownedaug"><input id="wz-owned-augments" type="checkbox"${state.ownedAugments ? " checked" : ""}>
            <span><strong>Also restrict augments</strong>
              <small>Use only augments your export lists, plus the ones anyone can buy or trade for.
                Off by default — augments otherwise come from the full catalog.</small></span></label>
        </div>
        <div class="wz-pinbox">
          <span class="wz-label">Pin specific items <span class="wz-sub">· optional · force gear you've already decided on into the build</span></span>
          <div class="wz-addrow">
            <input id="wz-pin-search" data-nodirty type="text" placeholder="Search an item by name — e.g. Hydra's Heart…" autocomplete="off">
          </div>
          <div id="wz-pin-results" class="wz-pin-results"></div>
          <div id="wz-pin-list" class="wz-pin-list"></div>
        </div>
        <div class="wz-pinbox wz-blockbox">
          <span class="wz-label">Block items or augments <span class="wz-sub">· optional · gear the solver must never recommend</span></span>
          <div class="wz-addrow">
            <input id="wz-block-search" data-nodirty type="text" placeholder="Search anything placeable — e.g. Lunar Gem of Abjuration…" autocomplete="off">
          </div>
          <div id="wz-block-results" class="wz-pin-results"></div>
          <div id="wz-block-stage" class="wz-block-stage"></div>
          <div id="wz-block-list" class="wz-pin-list"></div>
        </div>
        <div class="wz-pinbox wz-setpinbox">
          <span class="wz-label">Require a set <span class="wz-sub">· optional · the solve must deliver these, or say why it cannot</span></span>
          <p class="wz-adv-note">Ranking the stats a set grants does not force it — the solver takes those
            stats from wherever they are cheapest. Pin the set instead and it has to appear.</p>
          <div class="wz-addrow">
            <input id="wz-setpin-search" data-nodirty type="text" placeholder="Search a set by name — e.g. Cruel Cut, Legendary Shaman's Fury…" autocomplete="off">
          </div>
          <div id="wz-setpin-results" class="wz-pin-results"></div>
          <div id="wz-setpin-list" class="wz-pin-list"></div>
          <p id="wz-setpin-slow" class="wz-pin-mutexwarn" hidden></p>
        </div>
        <div class="wz-pinbox wz-overridebox">
          <span class="wz-label">Bonus types you have corrected <span class="wz-sub">· optional · when the game disagrees with the wiki</span></span>
          <p class="wz-adv-note">Add these from an item's card in the results, or from Browse. They are your
            observations, not wiki-sourced — a solve that uses one says so, and so does every export.</p>
          <div id="wz-override-list" class="wz-pin-list"></div>
        </div>
        <div class="wz-actions"><button class="btn ghost" data-back>← Back</button><span class="wz-spacer"></span>
          ${saveControl("ghost")}<button class="btn primary" data-next>Continue →</button></div>
      </section>`;
    }

    // U3 — pre-solve item pinning helpers. A pin forces an item into its WORN slot
    // (the label the solver groups pick-vars by — model.js builds Main/Off Hand
    // dynamically, so those aren't in WORN_SLOTS). Ring is cardinality 2 (two rings);
    // every other slot holds one pin. All state.slotConstraints reads route through
    // the shared pinnedVariantIds so single- and list-shaped pins stay consistent.
    // eslint-disable-next-line no-undef
    const _WORN = (typeof WORN_SLOTS !== "undefined") ? WORN_SLOTS
      : ["Armor", "Helmet", "Goggles", "Necklace", "Trinket", "Cloak", "Belt", "Ring", "Gloves", "Boots", "Bracers", "Quiver"];
    // eslint-disable-next-line no-undef
    const _CARD = (typeof SLOT_CARDINALITY !== "undefined") ? SLOT_CARDINALITY : { Ring: 2 };
    const PIN_WORN_LABELS = new Set([..._WORN, "Main Hand", "Off Hand"]);
    const PIN_CAP = 30;
    const isPinnable = (v) => PIN_WORN_LABELS.has(pinWornSlotOf(v)) && v.category !== "augment";
    const slotCardOf = (slot) => _CARD[slot] || 1;
    const itemByPinId = (id) => dataset.items.find((v) => pinIdOf(v) === id) || null;

    function currentPins() {
      const out = [];
      Object.entries(state.slotConstraints || {}).forEach(([slot, c]) => {
        if (!c || c.type !== "pin") return;
        _pinnedVariantIds(c).forEach((id) => out.push({ slot, id }));
      });
      return out;
    }

    // Thin wrappers over the exported pure core; they add the live cardinality
    // lookup and the constraintsDirty flag (so a re-solve is offered).
    function addPin(v, hand) {
      // #110 (U5/R4) — the symmetric refusal, enforced at the mutation path and
      // not only in the (disabled) row: a blocked variant cannot be pinned.
      if (pinBlockedConflict(state.blocklist, pinIdOf(v))) return;
      applyPin(state.slotConstraints, v, slotCardOf, hand); state.constraintsDirty = true; markDirty();
    }
    function removePin(slot, id) { removePinFrom(state.slotConstraints, slot, id, slotCardOf); state.constraintsDirty = true; markDirty(); }

    // KTD3 — name-only match (filterVariants also matches stats/ids, so post-filter
    // to a name substring), verified + pinnable only, exact/prefix first, capped
    // with a truncation notice so a target ranked past the cap isn't silently absent.
    function renderPinResults() {
      const box = document.getElementById("wz-pin-results");
      const input = document.getElementById("wz-pin-search");
      if (!box || !input) return;
      const q = (input.value || "").trim();
      if (!q) { box.innerHTML = `<p class="wz-pin-hint">Type an item name to search the catalog.</p>`; return; }
      const ql = q.toLowerCase();
      // eslint-disable-next-line no-undef
      const verified = filterVariants(dataset.items, { verification: "verified" });
      const matches = verified.filter((v) => isPinnable(v)
        && `${v.source_item || ""} ${v.variant_id || ""}`.toLowerCase().includes(ql));
      const rank = (v) => { const n = (v.source_item || v.variant_id || "").toLowerCase(); return n === ql ? 0 : n.startsWith(ql) ? 1 : 2; };
      matches.sort((a, b) => rank(a) - rank(b) || (a.source_item || "").localeCompare(b.source_item || ""));
      if (!matches.length) { box.innerHTML = `<p class="wz-pin-hint">No items match “${esc(q)}”.</p>`; return; }
      const pinned = new Set(currentPins().map((p) => p.id));
      // #110 (U5/R4) — a blocked variant cannot be pinned; its row says why.
      const blockedIds = new Set(state.blocklist || []);
      const shown = matches.slice(0, PIN_CAP);
      box.innerHTML = shown.map((v) => {
        const id = pinIdOf(v), already = pinned.has(id) || blockedIds.has(id), name = v.source_item || v.variant_id;
        // #262 (U4) — the no-drop-source note rides the same state-note string, so
        // it renders beside " · pinned"/" · blocked" (or alone) in the slot span.
        const stateNote = (pinned.has(pinIdOf(v)) ? " · pinned" : blockedIds.has(pinIdOf(v)) ? " · blocked" : "") + noDropNote(v);
        // plan 003 U5 (R6) — one action per hand the item can go to. For every item
        // but a one-handed weapon that is still exactly one action labelled with its
        // worn slot, so nothing changes; a one-handed weapon gets Main hand FIRST
        // (the default, preserving existing muscle memory) plus an Off hand action.
        const hands = pinHandsFor(v);
        const acts = hands.map((h, i) => `<button type="button" class="wz-pin-hit${i ? " wz-pin-hit-alt" : ""}"
            data-pin-id="${esc(id)}" data-pin-hand="${esc(h)}"${already ? " disabled" : ""}
            aria-label="Pin ${esc(name)} to ${esc(h)}">
            ${i ? "" : `<span class="wz-pin-hit-name">${esc(name)}</span>`}
            <span class="wz-pin-hit-slot">${esc(h)}${!i ? stateNote : ""}</span></button>`).join("");
        return hands.length > 1 ? `<div class="wz-pin-hit-pair">${acts}</div>` : acts;
      }).join("")
        + (matches.length > PIN_CAP ? `<p class="wz-pin-more">Showing top ${PIN_CAP} of ${matches.length.toLocaleString()} — refine your search.</p>` : "");
      box.querySelectorAll(".wz-pin-hit[data-pin-id]").forEach((b) => b.onclick = () => {
        const it = itemByPinId(b.dataset.pinId);
        if (it) { addPin(it, b.dataset.pinHand); renderPinList(); renderPinResults(); }
      });
    }

    // Pinned-items list: name + worn slot + inline conflict reason (B4) + remove.
    function renderPinList() {
      const box = document.getElementById("wz-pin-list");
      if (!box) return;
      const pins = currentPins();
      if (!pins.length) { box.innerHTML = `<p class="wz-pin-empty">No pinned items yet — search above to force a specific item into the build.</p>`; return; }
      const query = buildQuery(state, vocab);
      // Aggregate guard: a character equips at most ONE Artifact, but each pin is
      // honored, so pinning 2+ Artifacts with the opt-in on would force an illegal
      // multi-Artifact build. Warn (don't block — the pins are the player's choice).
      const artCount = pins.map((p) => itemByPinId(p.id)).filter((it) => it && it.artifact).length;
      const artWarn = (query.includeArtifact && artCount > 1)
        ? `<p class="wz-pin-artwarn">⚠ You've pinned ${artCount} Artifacts, but a character can equip only one — the solver honors every pin, so this forces an illegal build. Remove all but one.</p>`
        : "";
      // R12 — dual-pin hand-mutex guard. Detection is the exported dualPinMutexConflict
      // core (unit-tested); renderPinList only renders the warning.
      const mutexWarn = dualPinMutexConflict(pins, itemByPinId)
        ? `<p class="wz-pin-mutexwarn">⚠ You've pinned a two-handed weapon and an off-hand item, but a two-handed weapon uses both hands — the solver can't equip both. Unpin one.</p>`
        : "";
      box.innerHTML = mutexWarn + artWarn + pins.map(({ slot, id }) => {
        const it = itemByPinId(id);
        const name = it ? (it.source_item || it.variant_id) : id;
        // plan 003 U5 — three states, in precedence order. The per-variant gate list
        // first, then the slot-aware layer (R7: this pin will be dropped from the
        // solve), then the R8 note that an honored pin overrode the declaration's
        // off-hand rule. The override reads U2's exported predicate, not a copy.
        // eslint-disable-next-line no-undef
        const why = it ? (pinConflict(it, query) || _pinSlotConflict(it, slot, query)) : "not in the current catalog";
        const overrides = !why && it && slot === "Off Hand" && it.category !== "weapon"
          && _offHandItemsExcluded(query);
        const flag = why
          ? `<span class="wz-pin-warn">⚠ ${esc(why)} — this pin is dropped from the solve</span>`
          : (overrides
            ? `<span class="wz-pin-note">Overrides your Two Weapon Fighting off-hand rule — equipped because you pinned it</span>`
            : "");
        return `<div class="wz-pin-row"><span class="wz-pin-name">${esc(name)}</span><span class="wz-pin-slot">${esc(slot)}</span>${flag}<button type="button" class="wz-pin-x" data-unpin-slot="${esc(slot)}" data-unpin-id="${esc(id)}" aria-label="Remove ${esc(name)}">×</button></div>`;
      }).join("");
      box.querySelectorAll(".wz-pin-x").forEach((b) => b.onclick = () => {
        removePin(b.dataset.unpinSlot, b.dataset.unpinId); renderPinList(); renderPinResults();
      });
    }

    // #110 (U3/U4) — the blocklist picker. Candidates come from the browse-side
    // filterVariants over dataset.items — NOT browsableItems(dataset), whose 464
    // display-only pseudo-variants (Dino/NC/Viktranium options, compendium rows)
    // carry synthetic ids that never reach a solver pool, so blocking one would
    // store an id U6 reports stale on every load. The verified restriction is
    // inherited from the pin picker deliberately: 1 record of 9,108 is
    // quarantined, and the two pickers should disagree about nothing.
    // Selection STAGES across searches (U4/KTD5): no single query returns the
    // motivating 28 gems, so the player narrows, ticks, re-searches, and one
    // `Block selected (N)` action adds exactly the accumulated set.
    const blockStage = new Set();   // UI-transient; never persisted
    const BLOCK_CAP = 30;

    function renderBlockStage() {
      const box = document.getElementById("wz-block-stage");
      if (!box) return;
      const n = blockStage.size;
      // The count lives OUTSIDE the result list so it survives a search that
      // displays none of the ticked rows.
      box.innerHTML = n
        ? `<button type="button" class="btn primary wz-block-commit" id="wz-block-commit">Block selected (${n})</button>
           <button type="button" class="btn ghost wz-block-clear" id="wz-block-clear">Clear selection</button>`
        : "";
      const commit = document.getElementById("wz-block-commit");
      if (commit) commit.onclick = () => {
        const r = addBlocks(state.blocklist, [...blockStage], state.slotConstraints);
        state.blocklist = r.list;
        state.constraintsDirty = true; markDirty();
        blockStage.clear();
        if (r.refused.length) {
          state.blockRefusedMsg = r.refused.map((x) =>
            `${x.id} is pinned to ${x.slot} — unpin it before blocking it.`).join(" ");
        }
        renderBlockStage(); renderBlockList(); renderBlockResults(); renderPinResults();
      };
      const clear = document.getElementById("wz-block-clear");
      if (clear) clear.onclick = () => { blockStage.clear(); renderBlockStage(); renderBlockResults(); };
    }

    function renderBlockResults() {
      const box = document.getElementById("wz-block-results");
      const input = document.getElementById("wz-block-search");
      if (!box || !input) return;
      const q = (input.value || "").trim();
      if (!q) { box.innerHTML = `<p class="wz-pin-hint">Type a name to search everything the solver can place — items and augments.</p>`; renderBlockStage(); return; }
      // eslint-disable-next-line no-undef
      const matches = filterVariants(dataset.items, { verification: "verified", query: q });
      const rank = (v) => { const n = (v.source_item || v.variant_id || "").toLowerCase(); const ql = q.toLowerCase(); return n === ql ? 0 : n.startsWith(ql) ? 1 : 2; };
      matches.sort((a, b) => rank(a) - rank(b) || (a.source_item || "").localeCompare(b.source_item || ""));
      if (!matches.length) { box.innerHTML = `<p class="wz-pin-hint">Nothing matches “${esc(q)}”.</p>`; renderBlockStage(); return; }
      const blockedSet = new Set(state.blocklist || []);
      const shown = matches.slice(0, BLOCK_CAP);
      box.innerHTML = shown.map((v) => {
        const id = pinIdOf(v), name = v.source_item || v.variant_id;
        const already = blockedSet.has(id);
        const pinSlot = blockPinSlotOf(state.slotConstraints, id);
        // #262 (U4) — same disclosure in the block picker's rows.
        const note = (already ? " · blocked" : pinSlot ? ` · pinned to ${esc(pinSlot)}` : "") + noDropNote(v);
        return `<label class="wz-block-hit${already || pinSlot ? " wz-block-hit-off" : ""}">
          <input type="checkbox" data-block-id="${esc(id)}"${blockStage.has(id) ? " checked" : ""}${already || pinSlot ? " disabled" : ""}>
          <span class="wz-pin-hit-name">${esc(name)}</span>
          <span class="wz-pin-hit-slot">${esc(v.category === "augment" ? ((v.aug_color || {}).color || "augment") + " augment" : v.slot || "")}${note}</span></label>`;
      }).join("")
        + (matches.length > BLOCK_CAP ? `<p class="wz-pin-more">Showing top ${BLOCK_CAP} of ${matches.length.toLocaleString()} — refine and tick; your selection keeps across searches.</p>` : "");
      box.querySelectorAll("input[data-block-id]").forEach((cb) => cb.onchange = () => {
        if (cb.checked) blockStage.add(cb.dataset.blockId);
        else blockStage.delete(cb.dataset.blockId);
        renderBlockStage();
      });
      renderBlockStage();
    }

    // #539 — the set-pin picker. Same three-part shape as the block picker above
    // (search -> results -> list), and deliberately so: a player who has used one
    // already knows how this one behaves. No staging step, because the list here
    // is short and one click is enough.
    const SETPIN_CAP = 25;

    function renderSetPinResults() {
      const box = document.getElementById("wz-setpin-results");
      const input = document.getElementById("wz-setpin-search");
      if (!box || !input) return;
      const q = (input.value || "").trim();
      if (!q) {
        box.innerHTML = `<p class="wz-pin-hint">Type a set name — Set Augments, craftable memberships and ordinary gear sets are all pinnable.</p>`;
        return;
      }
      const ql = q.toLowerCase();
      const all = pinnableSets(dataset);
      const have = new Set(state.pinnedSets || []);
      const owned = state.ownedSetAugments instanceof Set ? state.ownedSetAugments : new Set();
      const augs = new Set(Object.keys(dataset.augment_set_defs || {}));
      const matches = all.filter((n) => n.toLowerCase().includes(ql))
        .sort((a, b) => {
          const rank = (n) => (n.toLowerCase() === ql ? 0 : n.toLowerCase().startsWith(ql) ? 1 : 2);
          return rank(a) - rank(b) || a.localeCompare(b);
        });
      if (!matches.length) { box.innerHTML = `<p class="wz-pin-hint">No set matches “${esc(q)}”.</p>`; return; }
      box.innerHTML = matches.slice(0, SETPIN_CAP).map((n) => {
        const already = have.has(n);
        // A Set Augment the player has not marked owned is offered but labelled:
        // the solve will suppress the pin and say so, and telling them here is
        // cheaper than letting them find out after a 40-second solve.
        const notOwned = augs.has(n) && !owned.has(n);
        const note = already ? " · required" : notOwned ? " · you have not marked this owned" : "";
        const kind = augs.has(n) ? "Set Augment"
          : (dataset.membership_set_defs || {})[n] ? "craftable membership" : "gear set";
        return `<button type="button" class="wz-pin-hit${already ? " wz-block-hit-off" : ""}" data-setpin="${esc(n)}"${already ? " disabled" : ""}>
          <span class="wz-pin-hit-name">${esc(n)}</span>
          <span class="wz-pin-hit-slot">${esc(kind)}${esc(note)}</span></button>`;
      }).join("")
        + (matches.length > SETPIN_CAP ? `<p class="wz-pin-more">Showing top ${SETPIN_CAP} of ${matches.length} — refine your search.</p>` : "");
      box.querySelectorAll("button[data-setpin]").forEach((b) => b.onclick = () => {
        state.pinnedSets = addSetPins(state.pinnedSets, [b.dataset.setpin]).list;
        state.constraintsDirty = true; markDirty();
        renderSetPinList(); renderSetPinResults();
      });
    }

    function renderSetPinList() {
      const box = document.getElementById("wz-setpin-list");
      if (!box) return;
      const entries = state.pinnedSets || [];
      if (!entries.length) {
        box.innerHTML = `<p class="wz-pin-empty">No set required — the solver will use a set only when it wins on your priorities.</p>`;
      } else {
        const staleSet = new Set(setPinStale(entries, dataset));
        box.innerHTML = entries.map((n) => {
          const stale = staleSet.has(n)
            ? `<span class="wz-pin-flag" title="No set by that name is defined in the current data — it may have been renamed upstream. The pin still saves; it just matches nothing right now.">no longer matches anything</span>`
            : "";
          return `<div class="wz-pin-row"><span class="wz-pin-name">${esc(n)}</span>${stale}<button type="button" class="wz-pin-x" data-unsetpin="${esc(n)}" aria-label="Stop requiring ${esc(n)}">×</button></div>`;
        }).join("");
        box.querySelectorAll(".wz-pin-x[data-unsetpin]").forEach((b) => b.onclick = () => {
          state.pinnedSets = removeSetPin(state.pinnedSets, b.dataset.unsetpin);
          state.constraintsDirty = true; markDirty();
          renderSetPinList(); renderSetPinResults();
        });
      }
      // The solve-time cost, said BEFORE the player presses Solve.
      const warn = document.getElementById("wz-setpin-slow");
      if (warn) {
        const msg = setPinSlowNotice(state.pinnedSets, dataset);
        warn.textContent = msg ? `⏱ ${msg}` : "";
        warn.hidden = !msg;
      }
    }

    function renderBlockList() {
      const box = document.getElementById("wz-block-list");
      if (!box) return;
      const refusal = state.blockRefusedMsg
        ? `<p class="wz-pin-mutexwarn">⚠ ${esc(state.blockRefusedMsg)}</p>` : "";
      state.blockRefusedMsg = null;
      const entries = state.blocklist || [];
      if (!entries.length) { box.innerHTML = refusal + `<p class="wz-pin-empty">Nothing blocked — search above to forbid gear the solver keeps recommending.</p>`; return; }
      // U6 — stale entries (no longer resolving to any roster variant) are
      // labelled by name rather than silently kept or dropped.
      const staleSet = new Set(blockStale(entries, dataset.items));
      box.innerHTML = refusal + entries.map((id) => {
        const stale = staleSet.has(id)
          ? `<span class="wz-pin-flag" title="No current item or augment carries this id — it may have been renamed upstream. The entry still saves; it just matches nothing right now.">no longer matches anything</span>`
          : "";
        return `<div class="wz-pin-row"><span class="wz-pin-name">${esc(id)}</span>${stale}<button type="button" class="wz-pin-x" data-unblock-id="${esc(id)}" aria-label="Unblock ${esc(id)}">×</button></div>`;
      }).join("");
      box.querySelectorAll(".wz-pin-x[data-unblock-id]").forEach((b) => b.onclick = () => {
        state.blocklist = removeBlock(state.blocklist, b.dataset.unblockId);
        state.constraintsDirty = true; markDirty();
        renderBlockList(); renderBlockResults(); renderPinResults();
      });
    }

    function stepPriorities() {
      return `<section class="wz-card">
        <p class="wz-eyebrow">Step 3 of 4 · What matters most?</p>
        <h2>Rank the stats you care about</h2>
        <p class="wz-lead">Add stats and order them — #1 is maximized first, then #2 without giving up any of #1,
          and so on. This ordering <em>is</em> the objective the solver optimizes.</p>
        <div class="wz-bundles">
          <span class="wz-label">Start from a bundle <span class="wz-sub">· optional · adds to your list — reorder or edit after</span></span>
          <div class="wz-bundle-grid">
            ${BUNDLE_CONTAINERS.map((g) => bundleContainerHTML(g.group, g.label, BUNDLE_GROUPS[g.group] || [])).join("")}
            ${savedBundlesHTML(_savedBundles() ? _savedBundles().listBundles() : [])}
          </div>
        </div>
        <div class="wz-addrow">
          <input id="wz-add" data-nodirty list="wz-stats" placeholder="Add a stat — e.g. Constitution, Dodge, Melee Power…">
          <datalist id="wz-stats">${allStats.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
          <button class="btn ghost" id="wz-add-btn">Add</button>
        </div>
        <ol class="wz-ranked" id="wz-ranked"></ol>
        <p class="wz-draghelp">Drag the ⋮⋮ handle to reorder, or use the ↑ ↓ buttons (they work on touch and keyboard).</p>
        <p id="wz-status" class="wz-status"></p>
        <div class="wz-actions"><button class="btn ghost" data-back>← Back</button><span class="wz-spacer"></span>
          ${saveControl("ghost")}<button class="btn primary" data-solve>Solve ⚡</button></div>
      </section>`;
    }

    function stepResults() {
      return `<section class="wz-card wz-results">
        <div class="wz-results-head">
          <div><p class="wz-eyebrow">Your optimal loadout</p></div>
        </div>
        <div id="wz-stale" class="wz-cbar${staleNote(state) ? "" : " wz-hidden"}">
          <span id="wz-stalewhy">${esc(staleNote(state) || "This saved build predates the current gear catalog.")}</span>
          <button class="btn ${resolveBannerPrimary(state) === "wz-stale" ? "primary" : "ghost"}" id="wz-staleresolve">Re-solve ⚡</button>
        </div>
        <div id="wz-twfmig" class="wz-cbar${state.twfMigrated ? "" : " wz-hidden"}">
          This character had off-hand weapon types picked, which is how dual-wielding used to switch on — so
          <strong>Two Weapon Fighting</strong> is now declared on the character step. The build below was solved
          under the old rules; re-solve to apply it, or turn the declaration off.
          <button class="btn ${resolveBannerPrimary(state) === "wz-twfmig" ? "primary" : "ghost"}" id="wz-twfmigresolve">Re-solve ⚡</button>
        </div>
        <div id="wz-cbar" class="wz-cbar${state.constraintsDirty ? "" : " wz-hidden"}">
          Slot constraints changed. <button class="btn ${resolveBannerPrimary(state) === "wz-cbar" ? "primary" : "ghost"}" id="wz-cresolve">Re-solve ⚡</button>
        </div>
        <div id="wz-results"></div>
        <div class="wz-actions"><button class="btn ghost" data-goto="priorities">← Adjust priorities</button>
          <button class="btn ghost" data-goto="character">Edit character</button><span class="wz-spacer"></span>
          ${saveControl(resolveBannerShowing(state) ? "ghost" : "primary")}</div>
      </section>`;
    }

    // U3/R6 — the Adjust & re-solve fold-up. Emitted by renderResults into the
    // #wz-adjust-slot directly under the tab bar (so it shows on every tab and is
    // never buried), then populated + wired by the KTD3 post-render callback
    // (fillAdjustSlot) on every render. Collapsed by default.
    function adjustPanelHTML() {
      return `<details class="wz-adjust" id="wz-adjust">
          <summary>Adjust &amp; re-solve</summary>
          <div class="wz-adjust-body">
            <p class="wz-help" style="margin:0 0 var(--sp-3)">Refine priorities, flip the gear pool, then re-solve — no need to step back.</p>
            <div class="wz-addrow">
              <input id="wz-radd" data-nodirty list="wz-stats2" placeholder="Add a stat…">
              <datalist id="wz-stats2">${allStats.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
              <button class="btn ghost" id="wz-radd-btn">Add</button>
            </div>
            <p id="wz-radd-status" class="wz-status"></p>
            <ol class="wz-ranked" id="wz-rranked"></ol>
            <div class="wz-adjust-row">
              <span class="wz-help" style="margin:0">Gear pool:</span>
              <span class="wz-toggle">
                <button data-rpool="all" class="${state.pool === "all" ? "on" : ""}">All gear</button>
                <button data-rpool="owned" class="${state.pool === "owned" ? "on" : ""}">What I own</button>
              </span>
              <button class="btn primary" id="wz-radjust-solve">Re-solve ⚡</button>
            </div>
          </div>
        </details>`;
    }

    // KTD3 post-render callback — runs after every renderResults (solve, load,
    // per-slot constraint change) to (re)populate + (re)wire the Adjust panel in
    // its renderer-emitted slot. The priorities drag/reorder + button handlers are
    // direct (not delegable), so they must be re-bound on each render.
    function fillAdjustSlot() {
      const slot = document.getElementById("wz-adjust-slot");
      if (!slot) return;
      slot.innerHTML = adjustPanelHTML();
      renderAdjustRanked();
      const radd = document.getElementById("wz-radd");
      if (radd) {
        document.getElementById("wz-radd-btn").onclick = () => { if (addPriority(radd.value)) renderAdjustRanked(); radd.value = ""; radd.focus(); };
        radd.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); if (addPriority(radd.value)) renderAdjustRanked(); radd.value = ""; } };
      }
      slot.querySelectorAll(".wz-toggle button[data-rpool]").forEach((b) => b.onclick = () => {
        if (b.dataset.rpool === "owned" && !state.ownedNames) { go("pool"); return; } // route to upload
        state.pool = b.dataset.rpool;
        slot.querySelectorAll(".wz-toggle button[data-rpool]").forEach((x) => x.classList.toggle("on", x.dataset.rpool === state.pool));
      });
      const rsolve = document.getElementById("wz-radjust-solve");
      if (rsolve) rsolve.onclick = () => { if (canAdvance("priorities", state)) solve(false); };
      // #431 U3 (KTD7/R6) — opening the fold puts a second primary on screen, so
      // save yields while it is open and takes primacy back when it closes.
      const fold = document.getElementById("wz-adjust");
      if (fold) fold.ontoggle = refreshResultsEmphasis;
    }

    // U5/R9-R11 — the Share tab's content: pick a saved loadout, export it as a
    // forum-ready Markdown post / CSV / print page. Copy states this is for
    // sharing with OTHERS, distinct from the Character step's personal-build
    // management (KD3). Lives inside #wz-results, so it is (re)wired by the
    // post-render callback like the Adjust panel.
    function sharePanelHTML() {
      return `<div class="wz-share">
          <p class="wz-help">Share <strong>this loadout with others</strong> — a forum-ready Markdown or BBCode post, a clean
            CSV of the full detail, a print-friendly page, or a <strong>portable JSON</strong> file built to be re-imported and
            compared later. Each carries the character name, constraints, the equipped items with their augments and crafting
            upgrades, the active set bonuses with the affixes they grant, and a stat-by-stat breakdown of where each point comes
            from. Backing up <em>every</em> build you own is a different job, and it is directly below.</p>
          <div class="wz-share-pick">
            <label class="wz-label" for="wz-share-sel">Loadout</label>
            <select id="wz-share-sel"></select>
          </div>
          <div class="wz-share-btns">
            <button class="btn ghost" id="wz-share-md" type="button">Markdown</button>
            <button class="btn ghost" id="wz-share-bb" type="button">BBCode</button>
            <button class="btn ghost" id="wz-share-csv" type="button">CSV</button>
            <button class="btn ghost" id="wz-share-print" type="button">Print</button>
            <button class="btn ghost" id="wz-share-json" type="button" title="A portable file that captures this build exactly — designed to be re-imported and compared later.">Portable JSON</button>
            <button class="btn ghost" id="wz-share-gearset" type="button" title="A .gearset file DDOBuilderV2 can import directly (Gear → Import). Crafting and your solve inputs ride below the import, as notes.">DDOBuilderV2</button>
          </div>
          <div id="wz-share-stat" class="wz-filestat"></div>
          ${dataBlockHTML("share")}
        </div>`;
    }

    // Wire the Share tab's picker + MD/CSV/print buttons (U5). Reuses the global
    // LoadoutExport + downloadFile/printLoadout, and guards a record with no
    // solved loadout so a share never produces a misleading empty file.
    function wireShareExports() {
      const shareSel = document.getElementById("wz-share-sel");
      if (!shareSel) return;
      renderSharePicker();
      const selected = () => {
        const n = shareSel.value;
        let rec;
        if (n === "__current__") {
          // Serialize the just-solved build on the fly (no save required).
          if (!(state.lastRun && state.lastRun.result && state.lastRun.result.status === "optimal")) {
            const s = document.getElementById("wz-share-stat");
            if (s) { s.className = "wz-filestat warn"; s.textContent = "Solve a build first, then export it here."; }
            return null;
          }
          const nm = ((state.characterName || "").trim()) || "Loadout";
          // eslint-disable-next-line no-undef
          rec = CharacterStore.serializeCharacter(nm, state, state.lastRun, currentBuildId());
        } else {
          // eslint-disable-next-line no-undef
          rec = n ? CharacterStore.loadCharacter(n) : null;
        }
        if (rec && !(rec.snapshot && (rec.snapshot.chosen || []).length)) {
          const s = document.getElementById("wz-share-stat");
          if (s) { s.className = "wz-filestat warn"; s.textContent = `“${rec.name}” has no solved loadout to share.`; }
          return null;
        }
        return rec;
      };
      const mdBtn = document.getElementById("wz-share-md");
      const bbBtn = document.getElementById("wz-share-bb");
      const csvBtn = document.getElementById("wz-share-csv");
      const printBtn = document.getElementById("wz-share-print");
      const jsonBtn = document.getElementById("wz-share-json");
      const gearsetBtn = document.getElementById("wz-share-gearset");
      if (mdBtn) mdBtn.onclick = () => { const rec = selected(); if (rec) downloadFile(`${slug(rec.name)}.md`, LoadoutExport.toMarkdown(rec), "text/markdown"); };
      if (csvBtn) csvBtn.onclick = () => { const rec = selected(); if (rec) downloadFile(`${slug(rec.name)}.csv`, LoadoutExport.toCsv(rec), "text/csv"); };
      if (printBtn) printBtn.onclick = () => { const rec = selected(); if (rec) printLoadout(rec); };
      // Portable JSON (U5): the versioned ddo-loadout/v1 envelope — the proven save
      // snapshot as an opaque `core` plus the resolved view — designed to be
      // re-imported and compared later. Pretty-printed for readability.
      if (jsonBtn) jsonBtn.onclick = () => { const rec = selected(); if (rec) downloadFile(`${slug(rec.name)}.json`, JSON.stringify(LoadoutExport.toPortableJSON(rec), null, 2), "application/json"); };
      // DDOBuilderV2: the `.gearset` extension is what its file picker filters on
      // (Gear Planner Files (*.gearset)), so the download must carry it or the user
      // has to switch the dialog to "All files" to see their own export.
      if (gearsetBtn) gearsetBtn.onclick = () => { const rec = selected(); if (rec) downloadFile(`${slug(rec.name)}.gearset`, LoadoutExport.toGearset(rec), "text/plain"); };
      // BBCode is meant to be pasted into a forum post — copy to clipboard (with a
      // .txt download fallback if the clipboard API is blocked), and confirm.
      if (bbBtn) bbBtn.onclick = () => {
        const rec = selected(); if (!rec) return;
        const bb = LoadoutExport.toBBCode(rec);
        const s = document.getElementById("wz-share-stat");
        const ok = () => { if (s) { s.className = "wz-filestat"; s.textContent = "BBCode copied — paste it into your forum post."; } };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(bb).then(ok, () => downloadFile(`${slug(rec.name)}.bbcode.txt`, bb, "text/plain"));
        } else {
          downloadFile(`${slug(rec.name)}.bbcode.txt`, bb, "text/plain");
        }
      };
    }

    // Populate + wire the Share tab panel (inside #wz-results, rebuilt every render).
    function fillSharePanel() {
      const panel = document.getElementById("rp-sharepanel");
      if (!panel) return;
      panel.innerHTML = sharePanelHTML();
      wireShareExports();
      // #428 U7 (KTD6) — the Your data block inherits fillSharePanel's lifecycle
      // (re-populated and re-wired on every results render) rather than needing
      // one of its own.
      wireDataManagement("share");
    }

    // The KTD3 post-render callback: (re)populate + (re)wire every wizard-owned
    // panel that lives inside #wz-results (Adjust — U3, Share — U5) on each render.
    function afterResultsRender() {
      fillAdjustSlot();
      fillSharePanel();
    }

    // ---- priorities editor (pure array ops + drag/buttons) -----------------
    function rankedHTML() {
      if (!state.priorities.length) return `<li class="wz-hint">Add at least one stat to optimize for.</li>`;
      return state.priorities.map((p, i) => {
        // U1 — the row's optional settings as data. The markup renders FROM this
        // and re-derives none of it, so the badge and the presence rule are the
        // same decision the unit tests assert.
        // #348 (U6/R1) — the container row is PINNED: no drag handle, no drag
        // attribute, no reorder buttons. It stays removable through the same ✕ every
        // row has, because "do not pursue utility at all" is still a choice.
        if (p === _utilitySentinel) return utilityRowHTML(i);
        const adv = advancedRowModel(p, state, vocab);
        return `<li data-i="${i}" draggable="true">
        <span class="wz-grip" title="drag to reorder">⋮⋮</span>
        <span class="wz-rk">${i + 1}</span><span class="wz-nm">${esc(p)}${isPresenceOnly(p, vocab) ? ` <span class="rank-tag" title="On/off effect — the solver secures an item that has it. A min of 1 makes it a hard requirement; there is no magnitude to maximize.">on/off</span>` : ""}</span>
        ${adv.suppressed ? "" : advancedHTML(p, i, adv)}
        <span class="wz-ctl"><button data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="move up">↑</button>
          <button data-down="${i}" ${(i === state.priorities.length - 1
            // #348 (U6/R1) — also disabled when the NEXT row is the pinned container:
            // a swap there would push a ranked stat below it, the exact displacement
            // pinning exists to prevent.
            || state.priorities[i + 1] === _utilitySentinel) ? "disabled" : ""} aria-label="move down">↓</button>
          <button data-del="${i}" aria-label="remove">✕</button></span></li>`;
      }).join("");
    }

    // #348 (U6) — the pinned container row. Distinct from every ranked row: no rank
    // number (it is not ranked), no drag affordance, and a panel that is a LIST
    // MANAGER rather than the numeric-bounds panel the others carry. R2's copy states
    // what the row is for, so a player does not put a must-have in it.
    function utilityRowHTML(i) {
      const list = containerList(state, vocab);
      return `<li data-i="${i}" class="wz-utility-row">
        <span class="wz-grip wz-grip-pinned" title="Pinned to the bottom" aria-hidden="true">📌</span>
        <span class="wz-rk wz-rk-pinned" title="Not ranked — pursued only after every stat above">·</span>
        <span class="wz-nm">${esc(_utilitySentinel)} <span class="rank-tag" title="Pursued only if there is room, after every ranked stat is locked. Anything you actually need belongs in the list above, not here.">nice to have</span>
          <span class="wz-util-summary">${esc(containerSummary(list))}</span></span>
        ${containerPanelHTML(list)}
        <span class="wz-ctl"><button data-del="${i}" aria-label="remove">✕</button></span></li>`;
    }

    function containerSuggHTML(list, q) {
      const sugg = containerAddable(vocab, list, q, 12);
      if (sugg.length) return sugg.map((n) => `<button type="button" class="wz-util-add" data-uadd="${esc(n)}">+ ${esc(n)}</button>`).join("");
      return `<span class="wz-hint">${esc(containerAddHint(list, q, false))}</span>`;
    }

    /** #348 (U6/R4, KTD9) — the curation panel. A list manager, sharing only the name
     *  with the numeric Advanced panel: reorder, remove, and a search-first add over
     *  every targetable presence effect. */
    function containerPanelHTML(list) {
      const q = state.utilityQuery || "";
      const rows = list.length
        ? list.map((n, j) => `<li class="wz-util-item"><span class="wz-util-pos">${j + 1}</span>
            <span class="wz-util-name">${esc(n)}</span>
            <span class="wz-ctl"><button type="button" data-uup="${j}" ${j === 0 ? "disabled" : ""} aria-label="move ${esc(n)} up">↑</button>
              <button type="button" data-udown="${j}" ${j === list.length - 1 ? "disabled" : ""} aria-label="move ${esc(n)} down">↓</button>
              <button type="button" data-udel="${j}" aria-label="remove ${esc(n)}">✕</button></span></li>`).join("")
        : `<li class="wz-hint">${esc(containerSummary([]))}</li>`;
      return `<details class="wz-adv wz-util-panel" data-adv="${esc(_utilitySentinel)}"${panelOpenAttr(_utilitySentinel)}>
        <summary>Curate (${list.length}/${UTILITY_CONTAINER_CAP})</summary>
        <div class="wz-adv-body">
          <p class="wz-help">These are pursued in this order, after every stat above is locked. The first one is secured before the second is attempted.</p>
          <ol class="wz-util-list">${rows}</ol>
          <label class="wz-util-search">Add an effect
            <input type="search" data-usearch value="${esc(q)}" placeholder="search on/off effects" aria-label="search effects to add">
          </label>
          <div class="wz-util-sugg">${containerSuggHTML(list, q)}</div>
          <p class="wz-util-status" role="status">${esc(state.utilityStatus || "")}</p>
        </div></details>`;
    }

    // U2/U3 — one row's Advanced panel: everything optional, behind one closed
    // disclosure, so the default row is just rank, name, and reorder (R1).
    //
    // `<details>`/`<summary>` rather than a button plus a hidden div: keyboard
    // operation and AT semantics come free, and `toggle` is the write point for
    // the open set (KTD1). A presence row renders `.wz-adv-none` instead — R6
    // gives it no control. The placeholder is a zero-width marker, NOT a reserved
    // column — `.wz-adv-none` is display:none, and R2's alignment comes from
    // `.wz-nm` being the flex-grow element (see styles.css).
    //
    // The badge is part of the summary's TEXT, not a visual-only chip: R5 is
    // about not losing a setting when the panel closes, and a purely visual mark
    // would lose it for screen-reader users instead of for everyone.
    // One definition of the summary's contents, used by the initial render AND by
    // the in-place refresh in renderRankedList. Two copies would drift, and the
    // drift is silent: a badge that words the same state differently depending on
    // whether the list was rebuilt or patched.
    function advSummaryHTML(adv) {
      const t = advancedBadgeText(adv.badgeCount);
      // #345 (U5) — "Required" is part of the summary TEXT, not a visual-only
      // chip, for the reason the settings badge is: a purely visual mark loses
      // the state for screen-reader users instead of for everyone.
      const req = adv.required ? ` <span class="wz-adv-req">· Required</span>` : "";
      return `Advanced${req}${t ? ` <span class="wz-adv-badge">${esc(t)}</span>` : ""}`;
    }

    function advancedHTML(stat, i, adv) {
      return `<details class="wz-adv" data-adv="${esc(stat)}"${panelOpenAttr(stat)}>
        <summary>${advSummaryHTML(adv)}</summary>
        <div class="wz-adv-body">
          <p class="wz-adv-lead">${ADVANCED_PANEL_HELP.lead}</p>
          <span class="wz-bounds">
            <input class="wz-bound" type="number" min="0" step="1" inputmode="numeric" data-min="${i}" value="${esc(adv.floor == null ? "" : adv.floor)}" placeholder="min" aria-label="${esc(stat)} minimum (floor)" draggable="false">
            <input class="wz-bound" type="number" min="0" step="1" inputmode="numeric" data-max="${i}" value="${esc(adv.cap == null ? "" : adv.cap)}" placeholder="max" aria-label="${esc(stat)} maximum (cap)" draggable="false"></span>
          ${adv.required ? `<p class="wz-adv-req-note">This effect is required: the solve must include it, giving up higher-ranked stats if that is what it takes. <button type="button" class="wz-clear-req" data-clearreq="${i}">Clear requirement</button></p>` : ""}
          <p class="wz-adv-note">${ADVANCED_PANEL_HELP.min}</p>
          <p class="wz-adv-note">${ADVANCED_PANEL_HELP.max}</p>
          ${adv.canCredit ? `<p class="wz-adv-note">${ADVANCED_PANEL_HELP.credit}</p>
          ${creditsHTML(stat, adv)}` : ""}
        </div></details>`;
    }

    // U2 — the declared-credit sub-rows for one priority. Repeatable, unlike the
    // fixed min/max pair: R2 allows more than one credit on a stat when the bonus
    // types differ, and A2 makes `(stat, bonus type)` the uniqueness key. Each row
    // carries its own key so editing the TYPE is a rekey rather than an edit in
    // place; a rekey onto an existing pair replaces it rather than duplicating.
    function creditsHTML(stat, adv) {
      // A row whose value the solver would drop must not READ as declared, and must
      // not reserve its bonus type against its siblings — otherwise a "have: 0" or
      // an over-range magnitude looks like a live declaration, silently contributes
      // nothing, and blocks the type it is occupying. `creditIsUsable` is the same
      // module-scope predicate the badge counts with, so the two cannot disagree.
      const mine = (adv || advancedRowModel(stat, state, vocab)).credits;
      const usedTypes = new Set(mine.filter((c) => c.usable).map((c) => c.bonus_type));
      const rows = mine.map(({ key, ...c }) => {
        const opts = _creditBonusTypes.map((t) =>
          `<option value="${esc(t)}"${t === c.bonus_type ? " selected" : ""}${(t !== c.bonus_type && usedTypes.has(t)) ? " disabled" : ""}>${esc(t)}</option>`).join("");
        return `<span class="wz-credit${c.usable ? "" : " is-incomplete"}">
          <input class="wz-credit-val" type="number" min="1" step="1" max="${esc(_maxCreditValue)}" inputmode="numeric" data-cval="${esc(key)}"
            value="${esc(c.value)}" placeholder="have" aria-label="${esc(stat)} ${esc(c.bonus_type)} bonus you already have" draggable="false">
          <select class="wz-credit-type" data-ctype="${esc(key)}" aria-label="${esc(stat)} credit bonus type" draggable="false">${opts}</select>
          <button type="button" data-crem="${esc(key)}" aria-label="remove ${esc(stat)} ${esc(c.bonus_type)} credit">✕</button></span>`;
      }).join("");
      // Offer the add affordance only while an unused bonus type remains, so the
      // UI cannot produce the duplicate `(stat, type)` pair A2 forbids.
      const free = _creditBonusTypes.find((t) => !usedTypes.has(t));
      const add = free
        ? `<button type="button" class="wz-credit-add" data-cadd="${esc(stat)}"
             aria-label="add a non-gear bonus you already have for ${esc(stat)}"
             title="Already have this from a trance, enhancement, epic destiny, past life, filigree, or ship buff? Declare it and the solver stops spending a slot on gear that cannot beat it.">+ already have</button>`
        : "";
      return `<span class="wz-credits">${rows}${add}</span>`;
    }
    // Generic ranked-list renderer: reused by the priorities step and the
    // in-results "Adjust & re-solve" panel (U3). `rerender` re-renders that
    // same list after a mutation.
    function renderRankedList(ol, rerender) {
      if (!ol) return;
      ol.innerHTML = rankedHTML();
      // U2/KTD1 — the open set is the only thing that carries panel state across
      // the `innerHTML` rebuild above, so bind the write point on every render.
      ol.querySelectorAll("details.wz-adv").forEach((d) => {
        d.ontoggle = () => openPanelToggle(d.dataset.adv, d.open);
      });
      // D1 — the rebuild destroys the focused element. Without restoring focus, a
      // player who clicks "+ already have" gets the panel they expect but a caret
      // nowhere: focus falls to <body> and they must re-find the field by mouse or
      // tab from the top of the list. Re-query AFTER the rebuild, by data
      // attribute rather than a built selector, so a stat name never needs escaping.
      const focusCreditValue = (key) => ol.querySelectorAll("input.wz-credit-val")
        .forEach((el) => { if (el.dataset.cval === key) el.focus(); });
      const focusSummary = (stat) => ol.querySelectorAll("details.wz-adv")
        .forEach((d) => { if (d.dataset.adv === stat) { const s = d.querySelector("summary"); if (s) s.focus(); } });
      // R5 — the bound and credit-value inputs deliberately do NOT rerender: a
      // rebuild mid-keystroke would destroy the field under the caret. But the
      // badge is computed during the rebuild, so without this it stays one render
      // behind — a player types a floor, collapses the row, and sees nothing.
      // Patch just the summary instead, from the same model the render uses.
      const refreshBadge = (stat) => ol.querySelectorAll("details.wz-adv").forEach((d) => {
        if (d.dataset.adv !== stat) return;
        const s = d.querySelector("summary");
        if (s) s.innerHTML = advSummaryHTML(advancedRowModel(stat, state, vocab));
      });

      ol.querySelectorAll("button").forEach((b) => b.onclick = () => {
        markDirty();   // #428 U5 — every ranked-list button mutates the build
        let after = null;
        if (b.dataset.up != null) { const i = +b.dataset.up;[state.priorities[i - 1], state.priorities[i]] = [state.priorities[i], state.priorities[i - 1]]; }
        else if (b.dataset.down != null) { const i = +b.dataset.down;[state.priorities[i + 1], state.priorities[i]] = [state.priorities[i], state.priorities[i + 1]]; }
        else if (b.dataset.del != null) {
          const p = state.priorities[+b.dataset.del];
          state.priorities.splice(+b.dataset.del, 1);
          if (state.targetCaps) delete state.targetCaps[p];   // drop the removed stat's bounds
          if (state.targetFloors) delete state.targetFloors[p];
          // U2 / AE5 — drop EVERY credit on that stat, not one: a stat can carry
          // several, and a keyed input that outlives its row is the orphaned-bound
          // defect this repo already recorded. A1 resolves "a credit on an unranked
          // stat" by removal, which is exactly this branch.
          if (state.declaredCredits) {
            for (const [k, c] of Object.entries(state.declaredCredits)) {
              if (c && c.stat === p) delete state.declaredCredits[k];
            }
          }
          openPanelSweep(p);   // KTD1 — and its open-panel entry, for the same reason
        }
        else if (b.dataset.cadd != null) {
          const stat = b.dataset.cadd;
          const map = state.declaredCredits || (state.declaredCredits = {});
          const used = new Set(Object.values(map).filter((c) => c && c.stat === stat).map((c) => c.bonus_type));
          const type = _creditBonusTypes.find((t) => !used.has(t));
          if (type) {
            const key = creditKey(stat, type);
            map[key] = { stat, bonus_type: type, value: "" };
            after = () => focusCreditValue(key);   // land the caret in the new field
          }
        }
        else if (b.dataset.crem != null) {
          const gone = (state.declaredCredits || {})[b.dataset.crem];
          const stat = gone && gone.stat;
          if (state.declaredCredits) delete state.declaredCredits[b.dataset.crem];
          if (stat) after = () => focusSummary(stat);   // the removed control is gone; go up a level
        }
        rerender();
        if (after) after();
      });

      // #348 (U6) — the curation panel's controls, wired AFTER the generic button
      // sweep above. Assigning `onclick` again on the same elements replaces the
      // generic handler for exactly these buttons, so the container needs no
      // early-return branches inside the priority handler.
      //
      // Placement is load-bearing for a second reason: `containerApply` contains a
      // `rerender()`, and the D1 focus guard slices the wiring source from the
      // credit-remove marker to the FIRST `rerender();` it finds. Defining this
      // above the sweep put an earlier one in the file, inverted that slice, and
      // failed a guard about focus that has nothing to do with the container.
      const containerApply = (action, arg) => {
        const res = containerEdit(containerList(state, vocab), action, arg);
        state.utilityStatus = res.message || "";
        if (res.ok) state.utilityContainer = res.list;   // KTD3 — curating materializes the list
        openPanelToggle(_utilitySentinel, true);         // keep the panel open across the rebuild
        rerender();
      };
      const wireAddButtons = (root) => root.querySelectorAll("button[data-uadd]").forEach((b) => {
        b.onclick = () => containerApply("add", b.dataset.uadd);
      });
      wireAddButtons(ol);
      ol.querySelectorAll("button[data-udel]").forEach((b) => { b.onclick = () => containerApply("remove", +b.dataset.udel); });
      ol.querySelectorAll("button[data-uup]").forEach((b) => { b.onclick = () => containerApply("up", +b.dataset.uup); });
      ol.querySelectorAll("button[data-udown]").forEach((b) => { b.onclick = () => containerApply("down", +b.dataset.udown); });
      ol.querySelectorAll("input[data-usearch]").forEach((el) => {
        // Deliberately does NOT rerender per keystroke — a rebuild would destroy the
        // field under the caret, the same rule the bound/credit inputs follow. The
        // suggestion list is patched in place from the same builder the render uses.
        el.oninput = () => {
          state.utilityQuery = el.value;
          const body = el.closest(".wz-adv-body");
          const box = body && body.querySelector(".wz-util-sugg");
          if (!box) return;
          box.innerHTML = containerSuggHTML(containerList(state, vocab), el.value);
          wireAddButtons(box);
        };
      });

      // #345 (U5, R10) — clear a requirement from the row that shows it. Deletes
      // the floor through the same map the min input writes, then rerenders so
      // the summary marker goes with it; no second flag to fall out of step.
      ol.querySelectorAll("button.wz-clear-req").forEach((btn) => {
        btn.onpointerdown = (e) => e.stopPropagation();
        btn.onclick = (e) => {
          e.preventDefault();
          const p = state.priorities[+btn.dataset.clearreq];
          if (!p || !state.targetFloors) return;
          delete state.targetFloors[p];
          rerender();
          if (after) after();
        };
      });
      // U4 — min/max bound inputs. Write to the stat-keyed maps (clamped to a
      // non-negative integer); a blank clears the bound. Stop pointer propagation so
      // focusing/typing never starts a row drag.
      ol.querySelectorAll("input.wz-bound").forEach((inp) => {
        inp.onpointerdown = (e) => e.stopPropagation();
        inp.oninput = () => {
          const isMax = inp.dataset.max != null;
          const i = +(isMax ? inp.dataset.max : inp.dataset.min);
          const p = state.priorities[i];
          if (!p) return;
          const map = isMax ? (state.targetCaps || (state.targetCaps = {})) : (state.targetFloors || (state.targetFloors = {}));
          if (inp.value === "") { delete map[p]; refreshBadge(p); return; }
          const num = Number(inp.value);
          if (!Number.isFinite(num)) { delete map[p]; refreshBadge(p); return; }
          map[p] = Math.max(0, Math.floor(num));
          refreshBadge(p);
        };
      });
      // U2 — the credit value field. Blank or unusable clears the VALUE but keeps
      // the row, so a half-typed entry does not vanish under the cursor; the
      // shared normalizeCredits then drops it on the way to the query.
      ol.querySelectorAll("input.wz-credit-val").forEach((inp) => {
        inp.onpointerdown = (e) => e.stopPropagation();
        inp.oninput = () => {
          const c = (state.declaredCredits || {})[inp.dataset.cval];
          if (!c) return;
          if (inp.value === "") { c.value = ""; refreshBadge(c.stat); return; }
          const num = Number(inp.value);
          c.value = Number.isFinite(num) ? Math.max(0, Math.floor(num)) : "";
          refreshBadge(c.stat);
        };
      });
      // U2 — changing the bonus type REKEYS the entry, because the key is
      // `(stat, bonus type)`. Landing on a pair that already exists replaces it
      // rather than duplicating (A2). The add affordance disables used types, so
      // this is reachable only via keyboard on a stale render.
      ol.querySelectorAll("select.wz-credit-type").forEach((sel) => {
        sel.onpointerdown = (e) => e.stopPropagation();
        sel.onchange = () => {
          const map = state.declaredCredits || {};
          const oldKey = sel.dataset.ctype;
          const c = map[oldKey];
          if (!c) return;
          const next = creditKey(c.stat, sel.value);
          delete map[oldKey];
          map[next] = { stat: c.stat, bonus_type: sel.value, value: c.value };
          rerender();
          // D1 — the rekey rebuilds the list too; put focus back on the selector
          // the player just changed rather than dropping it to <body>.
          ol.querySelectorAll("select.wz-credit-type")
            .forEach((el) => { if (el.dataset.ctype === next) el.focus(); });
        };
      });
      let from = null;
      ol.querySelectorAll("li[draggable]").forEach((li) => {
        // The tagName test is the part that actually suppresses the drag —
        // `draggable="false"` on a child does not stop the nearest draggable
        // ancestor from becoming the drag source, and stopPropagation on
        // pointerdown does not suppress the native drag either. U2 adds a
        // <select>, which `tagName === "INPUT"` does not match, so match both.
        // U2/KTD6 adds a subtree clause. The tagName test alone is not enough once
        // the panel exists: a click on the count badge inside the <summary> has
        // `tagName === "SPAN"`, and a drag on the relocated explainer prose has
        // "P", so both would start a row reorder instead of toggling or selecting.
        // Anything inside the panel is panel interaction, never a drag handle.
        li.ondragstart = (e) => { const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || (t.closest && t.closest("details.wz-adv")))) { e.preventDefault(); return; } from = +li.dataset.i; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); };
        li.ondragend = () => { li.classList.remove("dragging"); from = null; };
        li.ondragover = (e) => e.preventDefault();
        li.ondrop = (e) => {
          e.preventDefault();
          let to = +li.dataset.i;
          if (from === null || to === from) return;
          // #348 (U6/R1) — the pinned row is not draggable, but it is still a DROP
          // TARGET, and dropping onto it would splice a ranked stat below it. Clamp
          // to the last position above the container rather than ignoring the drop:
          // ignoring reads as a broken drag, clamping does what the player meant.
          const pin = state.priorities.indexOf(_utilitySentinel);
          if (pin >= 0 && to >= pin) to = Math.max(0, pin - 1);
          if (to === from) return;
          const m = state.priorities.splice(from, 1)[0];
          state.priorities.splice(to, 0, m);
          from = null; rerender();
        };
      });
    }
    function renderRanked() { renderRankedList(document.getElementById("wz-ranked"), renderRanked); }
    function renderAdjustRanked() { renderRankedList(document.getElementById("wz-rranked"), renderAdjustRanked); }
    /** The inline status line of whichever picker is on screen. The priorities STEP
     *  and the results-page Adjust panel each host an add-a-stat row wired to
     *  `addPriority`, and only the step had a status element — so every message the
     *  add path produces (an unknown affix, and now a substitution disclosure) was
     *  silently dropped when it came from the Adjust panel. */
    function pickerStatusEl() {
      return document.getElementById("wz-status") || document.getElementById("wz-radd-status");
    }

    /** Add a target affix; returns true if it landed (caller re-renders the list). */
    function addPriority(v) {
      markDirty();
      const status = pickerStatusEl();
      const _dn = _datasetNormalizer();
      // U11 (R15) — the decision (canonicalize, alias-substitute, validate, dedupe)
      // lives in the shared pure resolver; this wrapper owns state + disclosure.
      const res = resolvePriorityAdd(v, vocab, state.priorities);
      if (!res.ok) {
        // `message` is absent for a duplicate or a blank entry — say nothing, as before.
        if (status && res.message != null) status.textContent = res.message;
        return false;
      }
      state.priorities = res.priorities;
      if (!res.substitutions.length) {
        // #404 — the one case where a SUCCESSFUL add still has something to say.
        // Clearing the line here is what left two reporters hunting for a stat
        // whose name the picker never mentioned.
        if (status) status.textContent = res.companionHint || "";
        return true;
      }

      // A bound or a declared credit keyed to the alias is now stranded: the name has
      // left the priority list, `model.js` still unions it into the target set, and the
      // UI offers no row to delete it (bounds are only removable through their priority
      // row). Mirrors the saved-character load path, deliberately — DROPPED, never
      // remapped. "min 4 Parrying" is not "min 4 Armor Class", and copying it onto four
      // stats would invent four constraints the player never set.
      const droppedBounds = [];
      const droppedCredits = [];
      for (const sub of res.substitutions) {
        for (const map of [state.targetCaps, state.targetFloors]) {
          if (map && map[sub.from] != null) { droppedBounds.push(sub.from); delete map[sub.from]; }
        }
        // Credits key on stat PLUS bonus type (`stat||bonusType`), so the stat-keyed
        // loop above cannot reach them. Match on the entry's own stat.
        if (state.declaredCredits) {
          for (const [k, c] of Object.entries(state.declaredCredits)) {
            if (c && c.stat === sub.from) { droppedCredits.push(sub.from); delete state.declaredCredits[k]; }
          }
        }
      }
      // Disclosed INLINE at the picker, not silently: the player picked one name and
      // got several priorities, and each one costs a lexicographic rank.
      if (status && _dn && _dn.migrationMessage) {
        status.textContent = _dn.migrationMessage(res.substitutions, droppedBounds, droppedCredits,
                                                  { lead: "picker" }) || "";
      }
      return true;
    }

    // ---- solve (real engine) ----------------------------------------------
    // #88 U5 (R23/KTD1) — rebuild the override overlay over the loaded pool.
    //
    // The single place the overlay is (re-)applied, so every caller inherits the
    // same guarantee. `applyOverrides` withdraws every stamp before matching, so
    // this is a full rebuild rather than an increment: calling it with an empty
    // list is how the previous character's overrides come OFF the shared pool.
    // R23 lists the moments the set in force changes — character load and switch
    // (wired here), and override create, delete, and re-confirm (the creation
    // surfaces, which call this same function).
    //
    // Returns the apply report (applied / unmatched / ineligible) so a caller can
    // disclose what actually took effect. It is deliberately NOT stashed on
    // `state` as the disclosure source: KTD6 says every rendered disclosure reads
    // the SOLVE's report, because an override that applied to the pool still may
    // not have contributed to the loadout.
    function applyOverrideOverlay() {
      const O = _overridesModule();
      if (!O || !dataset) { state.overrideApplied = []; return null; }
      const report = O.applyOverrides(dataset, state.overrides || []);
      // KTD6 — what APPLIED, kept for buildQuery to hand the solver. Assigned on
      // every call including the empty one, so a character switch cannot leave the
      // previous character's applied list feeding this one's optimality claim.
      state.overrideApplied = report.applied.slice();
      return report;
    }

    // #88 U10/U11 — the three ways the set in force can change. Every one of them
    // routes through applyOverrideOverlay rather than reimplementing the withdraw-
    // then-apply sequence: R23 names create, delete and re-confirm alongside
    // character load, and the overlay is what keeps `state.overrideApplied` (and
    // therefore the R14 qualifier and R30 staleness) in step with the pool.
    function commitOverrides(list) {
      state.overrides = list;
      applyOverrideOverlay();
      state.constraintsDirty = true; markDirty();
      renderOverrideManager();
      refreshStaleBanner();
    }

    /** R30/AE22 — the displayed result is a claim about one set of corrections, so
     *  changing the set makes it stale. `staleNote` decided that correctly from the
     *  first, but nothing re-rendered the banner outside the character-load path:
     *  creating an override from the results card left a build on screen still
     *  presenting itself as current. Same refresh, lifted so both paths share it. */
    function refreshStaleBanner() {
      const bar = document.getElementById("wz-stale");
      if (!bar) return;
      const why = staleNote(state);
      bar.classList.toggle("wz-hidden", !why);
      const w = document.getElementById("wz-stalewhy");
      if (w && why) w.textContent = why;
      refreshResultsEmphasis();
    }

    function createOverride(key, to, note) {
      const r = addOverrideTo(state.overrides || [], key, to, note);
      if (!r.ok) return r;
      commitOverrides(r.list);
      // The created entry by identity, not by position: addOverrideTo REPLACES a
      // correction on the same affix rather than appending, so "the last one" is
      // wrong exactly when the player is changing their mind.
      return { ok: true, list: r.list, override: findOverrideFor(r.list, key), error: null };
    }

    function deleteOverride(i) {
      commitOverrides(removeOverrideAt(state.overrides || [], i));
    }

    function reconfirmOverride(i, now) {
      const r = reconfirmOverrideAt(state.overrides || [], i, now);
      if (r.ok) commitOverrides(r.list);
      return r;
    }

    /** U11 (R34/R35) — the manager. Rows and their action sets come from
     *  `Overrides.managerRows`, so the view never decides what a state allows. */
    function renderOverrideManager() {
      const box = document.getElementById("wz-override-list");
      if (!box) return;
      const O = _overridesModule();
      const list = state.overrides || [];
      if (!list.length) {
        box.innerHTML = `<p class="wz-pin-empty">Nothing corrected — the solve uses the catalog's bonus types.</p>`;
        return;
      }
      const rows = (O && dataset) ? O.managerRows(O.resolveOverrides(dataset, list)) : [];
      box.innerHTML = rows.map((r, i) => {
        const o = r.override;
        const where = o.variant_id || "a crafting option";
        const act = (name, label, cls) => r.actions.includes(name)
          ? `<button type="button" class="btn ghost wz-ov-${name}" data-ov${name}="${i}">${label}</button>` : "";
        return `<div class="wz-pin-row wz-ov-row is-${esc(r.state)}">
          <span class="wz-pin-name">${esc(o.name)} on ${esc(where)}</span>
          <span class="wz-ov-state">${esc(r.label)}</span>
          ${act("reconfirm", "Re-confirm")}${act("report", "Report")}${act("delete", "Remove")}
          <div class="wz-ov-report wz-hidden" id="wz-ov-report-${i}"></div>
        </div>`;
      }).join("");
      box.querySelectorAll("[data-ovdelete]").forEach((b) => b.onclick = () => {
        deleteOverride(Number(b.dataset.ovdelete));
      });
      box.querySelectorAll("[data-ovreconfirm]").forEach((b) => b.onclick = () => {
        const i = Number(b.dataset.ovreconfirm);
        const r = reconfirmOverride(i, rows[i] && rows[i].now);
        if (!r.ok) renderOverrideManager();
      });
      box.querySelectorAll("[data-ovreport]").forEach((b) => b.onclick = () => {
        const i = Number(b.dataset.ovreport);
        showCorrectionReport(document.getElementById(`wz-ov-report-${i}`), rows[i].override);
      });
    }

    /** U12 (R17/R18) — the report, rendered as selectable text rather than pushed
     *  anywhere. KTD10: generated text, never a network call. */
    function showCorrectionReport(host, override) {
      if (!host) return;
      // eslint-disable-next-line no-undef
      const P = (typeof Projection !== "undefined") ? Projection : null;
      if (!P || !P.correctionReport) return;
      const row = override.variant_id
        ? (dataset.items || []).find((v) => (v.variant_id || v.source_item) === override.variant_id)
        : null;
      host.classList.remove("wz-hidden");
      host.innerHTML = `<textarea class="wz-ov-reporttext" rows="10" readonly>${esc(P.correctionReport(override, row))}</textarea>`;
      const ta = host.querySelector("textarea");
      if (ta) { ta.focus(); ta.select(); }
    }

    /** #88 U10 (R3/R4/R33) — the creation picker, rendered in place under the row
     *  or Browse entry the player is questioning.
     *
     *  Rows come from `Overrides.pickerEntries`, the SAME builder Browse renders
     *  from: two surfaces disagreeing about which affixes are overridable would be
     *  indistinguishable, from the player's side, from the catalog being
     *  inconsistent. The replacement is a closed vocabulary (R4) — the shared list
     *  declared credits already renders — because free text would let a player
     *  invent a bonus type nothing in the game supplies.
     *
     *  R33: the three causes are named here rather than in a help page, because
     *  checking the wiki first is what separates a maintainer-side data defect
     *  (which a correction report can fix for everyone) from a genuine
     *  wiki-versus-game disagreement (which only an override can hold). */
    function openOverridePicker(host, variantId, row) {
      if (!host) return;
      const O = _overridesModule();
      const existing = host.querySelector(".pd-override");
      if (existing) { existing.remove(); return; }          // toggle
      // #426 — two ways to reach the affixes, one picker. A crafted row is a
      // display projection that resolves against no item, so it is addressed by
      // the provenance it carries; the entries it yields are pool_key-shaped and
      // flow through createOverride unchanged, because isWellFormed has always
      // accepted both target shapes.
      const crafted = row && row.pool_provenance;
      const v = crafted ? null
        : (dataset.items || []).find((x) => (x.variant_id || x.source_item) === variantId);
      const entries = !O ? []
        : crafted ? O.poolPickerEntriesFor(dataset, row, state.overrides || [])
        : (v ? O.pickerEntries(v, state.overrides || []) : []);
      const box = document.createElement("div");
      box.className = "pd-override";
      if (!entries.length) {
        // AE20 — no control at all, rather than an empty picker inviting a
        // decision the player cannot make on this item.
        box.innerHTML = `<p class="pd-override-empty">Nothing on this item carries a bonus type you can correct —
          its effects are either presence-only, penalties, or granted by the catalog rather than engraved on the item.</p>`;
        host.appendChild(box);
        return;
      }
      const opts = _creditBonusTypes.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
      box.innerHTML = `
        <p class="pd-override-lead">Correct a bonus type on <strong>${esc(variantId)}</strong>.
          Three things cause a wrong one: the wiki is right and our catalog copied it wrong, the wiki itself is
          wrong, or the game changed and neither caught up. <strong>Check the wiki page first</strong> — that is
          what tells you whether this is worth reporting for everyone or is yours to hold.</p>
        ${entries.map((e, i) => `<div class="pd-override-row">
          <span class="pd-override-affix">${esc(e.name)} +${esc(e.value)} ${esc(e.from)}${e.count > 1 ? ` <span class="pd-override-count">×${esc(e.count)}</span>` : ""}</span>
          ${e.overriddenTo
            ? `<span class="pd-override-set">already corrected to ${esc(e.overriddenTo)}</span>`
            : `<select class="pd-override-type" data-ovtype="${i}" aria-label="corrected bonus type for ${esc(e.name)}">${opts}</select>
               <input class="pd-override-note" data-ovnote="${i}" type="text" placeholder="note — optional" aria-label="note for ${esc(e.name)}">
               <button type="button" class="btn ghost" data-ovadd="${i}">Correct it</button>`}
        </div>`).join("")}
        <p class="pd-override-status" role="status"></p>`;
      host.appendChild(box);
      box.querySelectorAll("[data-ovadd]").forEach((b) => b.onclick = () => {
        const i = Number(b.dataset.ovadd);
        const to = box.querySelector(`[data-ovtype="${i}"]`).value;
        const note = box.querySelector(`[data-ovnote="${i}"]`).value;
        const r = createOverride(entries[i].key, to, note);
        const status = box.querySelector(".pd-override-status");
        if (!r.ok) {
          status.textContent = r.error === "limit"
            ? `You already have ${OVERRIDE_LIMIT} corrections — remove one first.`
            : "That correction could not be applied.";
          return;
        }
        // U12/R18 — the report is offered AT CREATION, not only from the manager,
        // because creation is the moment the player still has the evidence in
        // front of them and knows what they observed.
        status.textContent = "Corrected. Re-solve to use it.";
        const rep = box.querySelector(".pd-override-report")
          || box.appendChild(Object.assign(document.createElement("div"), { className: "pd-override-report" }));
        showCorrectionReport(rep, r.override);
        b.disabled = true;
      });
    }

    function candidateItems() {
      if (state.pool === "owned" && state.ownedNames) {
        // Base items: always restricted to the export (KTD4/R13).
        // Augments: full catalog UNLESS the player opted in (#359), in which case
        // `owned UNION acquirable` — what their export lists, plus what the wiki
        // classifies Common/Uncommon/Rare (vendor / Mysterious Remnant / generic
        // loot). Strict-to-the-export would cut 1,063 augments to ~123 and delete
        // gear nobody farms, which reads as the tool being broken.
        // #408 — ownership is tested through TroveImport's shared predicate, never
        // a bare Set.has here. Trove writes a STACKED item's name in the plural
        // ("Solar Gems of Constitution (Legendary)") while the catalog stores the
        // singular, so a raw membership test silently drops gear the player owns.
        // This path bypassed filterItemsToOwned, which is exactly how it kept its
        // own copy of the rule — one predicate now, so the pool and the import
        // disclosure cannot disagree about what "owned" means.
        const owns = (v) => (typeof TroveImport !== "undefined" && TroveImport.ownedHasCatalogName)
          ? TroveImport.ownedHasCatalogName(state.ownedNames, v.source_item || v.variant_id)
          : state.ownedNames.has(v.source_item || v.variant_id);
        return dataset.items.filter((v) => (v.category === "augment"
          ? (!state.ownedAugments || v.acquirable === true || owns(v))
          : owns(v)));
      }
      return dataset.items;
    }
    function overlay(on, title, sub) {
      let el = document.getElementById("wz-solve-overlay");
      if (!el && on) {
        el = document.createElement("div"); el.id = "wz-solve-overlay"; el.className = "wz-overlay";
        // #582 — the Stop control. Built once with the overlay and shown per-run,
        // because a solve is the only thing this overlay ever covers.
        el.innerHTML = `<div class="wz-overlay-box"><div class="wz-ring"></div><h3 id="wz-ov-title"></h3><p id="wz-ov-sub" class="wz-ov-sub"></p>`
          + `<button type="button" id="wz-ov-stop" class="btn wz-ov-stop">Stop</button>`
          + `<p class="wz-ov-foot">Exact optimization — the provably best answer, not a guess.</p></div>`;
        document.body.appendChild(el);
        el.querySelector("#wz-ov-stop").addEventListener("click", requestAbandon);
      }
      if (el) {
        if (on) {
          el.querySelector("#wz-ov-title").textContent = title;
          el.querySelector("#wz-ov-sub").textContent = sub || "";
          // Re-arm for this run: the button is only meaningful while a solve is
          // actually in flight, and a previous run may have left it pressed.
          const stop = el.querySelector("#wz-ov-stop");
          if (stop) { stop.disabled = false; stop.textContent = "Stop"; stop.hidden = false; }
          el.classList.add("on");
        } else el.classList.remove("on");
      }
    }

    let solving = false;
    // #582 — the abandon latch. Set by the overlay's Stop control, read by the
    // solver at each stage boundary, and cleared at the START of every solve so a
    // stop can never leak into the next run. Deliberately NOT on `state`: it is
    // in-flight control, not something a saved character should carry.
    let abandonRequested = false;
    function requestAbandon() {
      if (!solving || abandonRequested) return;
      abandonRequested = true;
      // Say what the promise actually is. A HiGHS call already in flight cannot be
      // preempted, so "stopping" is honest and "stopped" would not be.
      const el = document.getElementById("wz-solve-overlay");
      if (el) {
        const sub = el.querySelector("#wz-ov-sub");
        if (sub) sub.textContent = "stopping after the current pass…";
        const stop = el.querySelector("#wz-ov-stop");
        if (stop) { stop.disabled = true; stop.textContent = "Stopping…"; }
      }
    }
    // #449 U6 (KTD3) — the notices-panel latch: pulse the attention pill until
    // the player first opens the panel, then never again this session. Session-
    // scoped on purpose, and deliberately NOT on `state`: it is a presentation
    // fact about this sitting, not part of the build, so it must not reach the
    // save record. renderResults destroys and rebuilds the panel on every solve,
    // load and per-slot constraint change, which is why the flag lives out here
    // and is stamped back in at build time rather than read off `[open]`.
    let notesSeen = false;
    // #499 — the upgrade bar: the most a suggestion may cost any one ranked
    // priority, as a percentage. Session-scoped for exactly `notesSeen`'s reason
    // — it is how this player wants to be shown suggestions right now, not part
    // of the build — so it does not reach the save record. It DOES have to
    // outlive the panel, which renderResults destroys and rebuilds on every
    // solve, load and per-slot constraint change; hence out here rather than
    // read back off the select.
    let upgradeBar = 0;
    const rememberUpgradeBar = (pct) => { upgradeBar = pct; };

    // #500 — the Versions seam. Two sources of comparison candidates, and they
    // stay two sources on purpose:
    //
    //   * STORED VERSIONS — auto-snapshots taken on each solve, plus anything
    //     the player named. This store starts EMPTY ("fresh start"): existing
    //     saved characters are not rewritten into history they never had.
    //   * SAVED CHARACTERS — still comparable, because their snapshots already
    //     render standalone. They are offered as candidates without being
    //     migrated, which is exactly what fresh-start means.
    //
    // Auto-snapshots are named for the priorities that produced them rather than
    // numbered, because "Melee Power, Doublestrike +2 more" is what a player
    // recognises three solves later and "Version 4" is not.
    function versionLabel(q) {
      const t = ((q && q.targets) || []).filter((x) => x !== UTILITY_SENTINEL);
      if (!t.length) return "no ranked priorities";
      return t.slice(0, 2).join(", ") + (t.length > 2 ? ` +${t.length - 2} more` : "");
    }
    function versionRecords() {
      const out = [];
      for (const v of VersionStore.listVersions()) {
        out.push({ id: `ver:${v.id}`, group: v.kind === "named" ? "Saved versions" : "Automatic snapshots",
          label: v.name || versionLabel(v.query), record: v });
      }
      for (const name of CharacterStore.listCharacters()) {
        const rec = CharacterStore.loadCharacter(name);
        if (!rec || !rec.snapshot || !(rec.snapshot.chosen || []).length) continue;
        out.push({ id: `char:${name}`, group: "Saved builds", label: name,
          record: { name, query: rec.query, inputs: rec.inputs, snapshot: rec.snapshot } });
      }
      return out;
    }
    /** Write one version. `kind` is what distinguishes the snapshot nobody asked
     *  for from the one the player pressed save on — and it is the auto kind that
     *  accumulates, so it is the one a full store is really about. Returns the
     *  store's `{ ok, full }` verbatim: the quota case has to reach the player. */
    function saveVersion(kind) {
      const run = state.lastRun;
      if (!run || !run.result) return { ok: false, full: false };
      const list = VersionStore.listVersions();
      const stamp = new Date().toISOString();
      const base = versionLabel(run.query);
      const rec = VersionStore.makeVersion({
        id: VersionStore.nextId(list), kind,
        name: kind === "named"
          ? `${state.characterName || "Build"} — ${base}`
          : `${base} · ${stamp.slice(0, 16).replace("T", " ")}`,
        query: run.query, inputs: { priorities: (run.query && run.query.targets) || [] },
        result: run.result, buildId: currentBuildId(), savedAt: stamp,
      });
      return VersionStore.saveVersion(rec);
    }
    // The auto-snapshot. Deliberately fire-and-forget on the SOLVE path except
    // for one thing: a full store is remembered, so the next render of the tab
    // can say so rather than leaving the player to notice history stopped.
    let versionsFull = false;
    // #500 — the id of the snapshot taken for the build currently on screen.
    //
    // `autoSnapshot` runs on the solve path, BEFORE the results render, so by the
    // time the Adjustment Studio opens the newest stored version IS the build the
    // player is looking at. Defaulting the comparison to it would open the tab on
    // "these two builds are identical" after every single solve. What the player
    // wants to see is what the re-solve CHANGED, so the default skips this one and
    // lands on the build they had before it.
    let currentAutoId = null;
    function autoSnapshot() {
      const res = saveVersion("auto");
      if (res.ok) currentAutoId = res.id;
      if (!res.ok && res.full) versionsFull = true;
    }
    /** The record the Studio should open on: the newest stored version that is not
     *  the snapshot of the build already on screen. Null on a first-ever solve,
     *  where there is genuinely nothing to compare against yet. */
    function defaultCompareId() {
      const rec = versionRecords().find((r) => r.id !== `ver:${currentAutoId}`);
      return rec ? rec.id : null;
    }
    const versionsSeam = {
      records: versionRecords,
      defaultCompare: defaultCompareId,
      save: () => saveVersion("named"),
      // A store that filled up during an automatic snapshot has to say so on the
      // next render. The alternative is history quietly stopping while the tab
      // goes on implying every solve is being recorded.
      note: () => (versionsFull
        ? "Your browser's storage for this site is full, so recent solves were not snapshotted. Delete a version you no longer need to start recording again."
        : ""),
    };
    // #345 (U4, R9/R10) — accept an outbid trade: require the effect, then
    // re-solve. Writes through the SAME state field and sanitizer the Advanced
    // min input writes (cleanBoundMap on the way to the query, targetFloors in
    // persist.js), so the requirement survives a save and shows on the row
    // without a second representation to keep in sync.
    function requireOutbidStat(stat) {
      if (!stat) return;
      const map = state.targetFloors || (state.targetFloors = {});
      map[stat] = Math.max(1, Number(map[stat]) || 0);
      if (canAdvance("priorities", state)) solve(false);
    }

    // #449 U5 (KTD5) — the notice-panel jump seam. results.js hands over a target
    // and nothing more; the step change and the scroll live here, where wizard
    // state actually is. `step: null` means "this screen": scroll the anchor into
    // view and focus it rather than re-rendering, which would collapse the panel
    // the player just opened.
    //
    // The anchor is looked up AFTER any step change, and a miss scrolls nothing
    // rather than throwing — a route whose anchor was renamed must not take the
    // results screen down with it.
    function jumpFromNotice(target) {
      if (!target) return;
      const land = () => {
        if (!target.anchor) return;
        const el = document.querySelector(target.anchor);
        if (!el) return;
        el.scrollIntoView({ block: "center" });
        // #453 U6 (R15/R16/KTD5) — scrolling to a COLLAPSED panel and stopping
        // there is indistinguishable from a control that failed, which is what
        // was reported. Two faults compounded: nothing opened the fold, and
        // `#wz-adjust-slot` is the wrapper div, so the `.focus()` below was a
        // no-op on it even though the code guarded for the method.
        //
        // Set `open` as a PROPERTY so `ontoggle` fires and refreshResultsEmphasis
        // runs — opening the panel puts a second primary on screen and Save must
        // yield to it exactly as it does when the player opens the fold by hand
        // (#431 U3 KTD7/R6). Assigning the attribute would skip that.
        const fold = el.matches && el.matches("details") ? el : el.querySelector("details");
        if (fold && !fold.open) fold.open = true;
        const first = (fold || el).querySelector("input, select, button, textarea, [tabindex]");
        if (first && typeof first.focus === "function") { first.focus({ preventScroll: true }); return; }
        if (typeof el.focus === "function") el.focus({ preventScroll: true });
      };
      if (target.step && target.step !== state.step) { go(target.step); requestAnimationFrame(land); }
      else land();
    }

    async function solve(firstRun) {
      if (solving) return;
      if (!canAdvance("priorities", state)) return;
      solving = true;
      abandonRequested = false;   // #582 — a stop never leaks into the next run
      const n = candidateItems().length;
      overlay(true, "Solving your loadout…", firstRun ? `searching ${n.toLocaleString()} eligible items · exact MILP` : "re-solving…");
      try {
        // #218 — give the browser a turn to paint the overlay before anything
        // blocking runs. Only the FIRST solve got one for free, from the async WASM
        // load; on a re-solve HiGHS is cached, so without this the synchronous MILP
        // blocks the main thread and the overlay never renders. Inside the try so
        // the `finally` still clears `solving` and the overlay if it ever rejects —
        // outside it, a rejection would wedge the UI with the guard stuck on.
        await yieldToPaint();
        const h = await getHighs();
        const query = buildQuery(state, vocab);
        // R4a — suppress pins illegal for THIS config from the solve WITHOUT mutating
        // persistent state: reconcile a COPY, so an illegal pin is only dropped for the
        // current (illegal) solve and is honored again once the config makes it legal
        // (a race/alignment/floor toggle-and-revert must never silently erase a pin).
        // The pin-list advisory already shows the conflict via pinConflict.
        query.slotConstraints = { ...state.slotConstraints };
        reconcilePinLegality(query.slotConstraints, itemByPinId, query, slotCardOf);
        // U6/U7 — owned-mode signal for the empty-slot note + recommended-augment
        // marking (view layer). Which worn slots the owned base pool covers, so an empty
        // slot can distinguish "you own no item for this slot" from "owned items don't
        // improve it". A weapon can serve either hand (TWF off-hand), so it covers BOTH
        // "Main Hand" and "Off Hand" — never collapse it to main-hand-only (that's right
        // for pinning, wrong for coverage), else an owned dual-wield weapon would falsely
        // read "you own no item" on an empty Off Hand. Plain/serializable (no Set saved).
        query.ownedMode = state.pool === "owned" && !!state.ownedNames;
        // #359 — rides the SOLVED query (not just live state) so a restored
        // character discloses the pool it actually solved, per the saved-query rule.
        query.ownedAugments = query.ownedMode && !!state.ownedAugments;
        query.ownedSlotsCovered = query.ownedMode
          ? [...new Set(dataset.items
              .filter((v) => v.category !== "augment" && state.ownedNames.has(v.source_item || v.variant_id))
              .flatMap((v) => v.category === "weapon" ? ["Main Hand", "Off Hand"] : [v.slot]))]
          : [];
        // #91 (U3, KTD3) — the utility counting set rides as a buildModel
        // ARGUMENT from the in-scope vocabulary, never on the persisted query.
        // eslint-disable-next-line no-undef
        const model = buildModel(candidateItems(), query, dataset.dino_inserts, dataset.nearly_complete,
          dataset.viktranium, dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel, dataset.augment_set_defs,
          // #332 — BOTH sets: the counting roster the tier scores, and the admitted
          // procs it deliberately does not, so the result can name a ranked-but-
          // uncounted proc on every surface including exports. THIS file is the live
          // solve path — web/query.js is not loaded by web/index.html at all.
          // Gate on SIZE, not truthiness: an empty stamped counting set is truthy, and
          // threading it would make the card and all six exports assert "weapon procs
          // are ranked individually rather than counted" while the tier counts nothing
          // at all. web/browse.js:373 already gates its markers this way; these sites
          // were the other half of the same asymmetry.
          vocab.utilityCounting && vocab.utilityCounting.size
            ? { counting: vocab.utilityCounting, notCounted: vocab.utilityNotCounted || new Set(),
                // #348 (U3) — the container's ORDER rides with its contents. Without
                // it the solver falls back to alphabetical, which is not a product
                // decision and would pursue Blindness Immunity before Ghostly.
                order: state.utilityContainer || vocab.utilityOrder || null }
            : null,
          // #371 — the per-item Nearly Complete pools ("Nearly Finished" /
          // "Almost There"), keyed by host name. Threaded as an ARGUMENT like
          // every other pool; the solver reaches a host's options through its
          // own `nc_per_item_slots` marker.
          dataset.nearly_complete_per_item);
        const t0 = performance.now();
        // #582 — the abandon predicate. Supplying it is what turns on the solver's
        // stage-boundary yields; every other caller omits it and runs unchanged.
        // eslint-disable-next-line no-undef
        const result = await solveLexicographic(model, h, { abandon: () => abandonRequested });
        if (result.status === "optimal") result.solveMs = Math.round(performance.now() - t0);
        // #582 — an abandoned run is not a result. Return to where the player was
        // with NOTHING touched: no `lastRun`, no auto-snapshot, no step change, no
        // pin pruning (the pin-invalidation pass below reads `result.chosen`, which
        // an abandoned run does not have, and would read every pin as stale).
        // Leaving the previous build intact is the whole point of "abandon".
        if (result.status === "abandoned") return;
        // R17 pin-invalidation: prune a pin that didn't land ONLY when its item is
        // genuinely gone from the catalog (itemByPinId === null) — a stale reference
        // whose badge would otherwise lie. A pin merely illegal for the current config
        // (item present, suppressed pre-solve by R4a) is KEPT: its conflict shows in the
        // pin list, and it is honored again once the config makes it legal, so a
        // transient illegal config never silently erases a legal pin. For a list-shaped
        // Ring pin, prune only the missing members; drop the whole slot only when none
        // survive. Id resolution matches the solver (variant_id || source_item).
        Object.entries(state.slotConstraints).forEach(([slot, c]) => {
          if (!c || c.type !== "pin") return;
          const landed = (vid) => (result.chosen || []).some(
            (ch) => ch.slot === slot && (ch.variant.variant_id || ch.variant.source_item) === vid);
          const stale = _pinnedVariantIds(c).filter((vid) => !landed(vid) && !itemByPinId(vid));
          if (!stale.length) return;                               // all landed -> unchanged
          // Prune each stale member through the tested pin-mutation core (one
          // shape-writer, cardinality-based predicate) — drops the slot when none survive.
          stale.forEach((vid) => removePinFrom(state.slotConstraints, slot, vid, slotCardOf));
          query.slotConstraints = { ...state.slotConstraints };
        });
        state.constraintsDirty = false;
        // review #8 — the build on screen was just solved against the CURRENT
        // catalog, so the catalog-age staleness is discharged by definition. It
        // used to be cleared only by the stale banner's own Re-solve button,
        // which was harmless while that banner rendered hidden and was revealed
        // imperatively; once #88 U8 made it render from `staleNote(state)`, any
        // re-solve reached another way (Adjust, a priority edit, the ordinary
        // Solve button) re-drew "this saved build predates the current gear
        // catalog" over a build that does not. Nothing else reads the flag —
        // saveCurrentCharacter keys its re-stamp off `lastRun.fresh`.
        state.loadedStale = false;
        // fresh:true — this build was solved against the current catalog, so a
        // subsequent Save stamps the current build id (see saveCurrentCharacter).
        state.lastRun = { model, result, query, fresh: true };
        // #500 — the automatic snapshot, taken here because this is the one place
        // a NEW build exists. A load or a restore re-renders an old build and must
        // not mint a version for it.
        autoSnapshot();
        state.step = "results";
        render();
        const box = document.getElementById("wz-results");
        // eslint-disable-next-line no-undef
        if (box) renderResults(box, { model, result, query, dataset, highs: h, onAfterRender: afterResultsRender, onRequire: requireOutbidStat, onJump: jumpFromNotice, notesSeen, onNotesOpen: () => { notesSeen = true; }, upgradeBar, onUpgradeBar: rememberUpgradeBar, versions: versionsSeam, characterName: state.characterName });
      } catch (err) {
        state.step = "results"; render();
        const box = document.getElementById("wz-results");
        if (box) box.innerHTML = `<p class="wz-status">Solver error: ${esc(err.message)}</p>`;
        console.error(err);
      } finally {
        overlay(false); solving = false;
      }
    }

    // ---- character persistence (U3/U4) ------------------------------------
    function currentBuildId() {
      return (dataset && dataset.metadata && dataset.metadata.build_id) || null;
    }

    function downloadFile(filename, text, mime) {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }

    function slug(s) {
      return String(s || "loadout").trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "loadout";
    }

    // Print a single loadout via a body-level print container isolated by the
    // @media print rules — avoids popup-blocked window.open and needs no new tab.
    function printLoadout(rec) {
      let area = document.getElementById("wz-printarea");
      if (!area) { area = document.createElement("div"); area.id = "wz-printarea"; document.body.appendChild(area); }
      // eslint-disable-next-line no-undef
      area.innerHTML = LoadoutExport.toPrintHtml(rec);
      document.body.classList.add("printing");
      const cleanup = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", cleanup); };
      window.addEventListener("afterprint", cleanup);
      window.print();
    }

    function saveCurrentCharacter(name) {
      const nm = (name || "").trim();
      if (!nm) return { ok: false, error: "no-name" };
      // #428 U4 (R15) — a save is no longer gated on a solved run. What is saved
      // is the in-progress state of every step completed so far; a record written
      // AFTER a solve additionally carries the loadout. Without this, the rail on
      // the character step could offer a Save that always refused.
      state.characterName = nm;
      // Stamp with the current build only for a freshly-solved run. Saving a
      // LOADED-but-not-resolved build (e.g. after a rename) must preserve its
      // original stamp, or a stale build would re-stamp itself current and the
      // staleness warning would be silenced forever.
      // #429 review #2 — attribute the live run before writing it. `state` outlives
      // any one character, so a run left over from the PREVIOUS build would
      // otherwise be serialized into this record.
      const run = runBelongsTo(state.lastRun, nm, state.loadedName) ? state.lastRun : null;
      const stamp = (run && run.fresh === false && run.stampedBuildId)
        ? run.stampedBuildId : currentBuildId();
      // eslint-disable-next-line no-undef
      const prev = CharacterStore.loadCharacter(nm);
      // eslint-disable-next-line no-undef
      const rec = CharacterStore.serializeCharacter(nm, state, run, stamp);
      // #429 review #1 — saveCharacter REPLACES by name. Without this, saving an
      // in-progress build under the name of a solved one destroyed that record's
      // loadout, query and build stamp with no undo — the data-loss guard the
      // removed "solve first" refusal had been performing without saying so.
      // Preserve rather than replace: the record keeps the loadout it was solved
      // with, exactly as it already did when a loaded build was re-saved without
      // re-solving. The overwrite confirm says which of the two is happening.
      if (!run && prev) {
        rec.snapshot = prev.snapshot;
        rec.query = prev.query;
        rec.stampedBuildId = prev.stampedBuildId || null;
      }
      // eslint-disable-next-line no-undef
      const res = CharacterStore.saveCharacter(rec);
      // plan 2026-08-25-002 U4 (#518) — did this save just adopt ticks recorded
      // under this name before any build held it? Read AFTER the write and only
      // when `prev` was absent, which is what makes it a takeover rather than an
      // ordinary update. Reported through the rail on the next render; nothing
      // here blocks, because this runs on the autosave path and a dialog during
      // a step change is the defect autosave removed.
      if (res && res.ok && !prev) {
        // eslint-disable-next-line no-undef
        const F = (typeof FarmingList !== "undefined") ? FarmingList : null;
        const ticks = F ? Object.keys(F.loadProgress(nm) || {}).length : 0;
        const seen = (state.farmingDisclosed || []).indexOf(nm) >= 0;
        const n = farmingTakeover(nm, false, ticks, seen);
        if (n) {
          state.farmingTakeover = { name: nm, count: n };
          state.farmingDisclosed = (state.farmingDisclosed || []).concat(nm);
        }
      }
      // #428 U5 (KTD3) — a save is the point of the flag. Cleared only on
      // SUCCESS: a quota failure leaves the work unsaved and still at risk.
      if (res && res.ok) state.inputsDirty = false;
      return res;
    }

    // Load a saved character: restore inputs, rebuild the model scaffold WITHOUT
    // solving (KTD2), and render Results from the stored snapshot. renderResults
    // only needs `highs` for the upgrades search and the concession probe, both of
    // which withhold their controls when it is absent, so a loaded build shows
    // instantly.
    function loadCharacter(name) {
      // eslint-disable-next-line no-undef
      const rec = CharacterStore.loadCharacter(name);
      if (!rec) return;
      const i = rec.inputs || {};
      state.characterName = rec.name;
      // #428 U3 (R20) — the rail shows which saved build is being edited.
      state.loadedName = rec.name;
      // #428 U5 (KTD3) — a freshly loaded build is not unsaved work. Cleared at
      // the TOP of the load, before the restore writes below can raise it again.
      state.inputsDirty = false;
      // #452 U2 (R7) — a freshly loaded build has reconciled nothing. Cleared
      // here for the same reason and in the same breath: carrying the previous
      // build's accepted overwrite forward would let the next Continue silently
      // replace a record this player never agreed to replace.
      state.nameReconciled = null;
      // #518 U4 — the takeover notice is per-character too. `state` outlives any
      // one build, so a notice raised when A was saved would still be on screen
      // under B, naming A — which reads as B having inherited A's ticks. Reset
      // unconditionally, like every field above it.
      state.farmingTakeover = null;
      // #428 U6 (AE3) — a loaded build has not been blocked yet, so nothing is
      // marked as needing an answer. A build saved before KD6 carries no armor
      // and will be marked the moment Continue is pressed (AE3a).
      state.requiredShown = false;
      state.ml = i.ml;
      // U3 — restore the ML floor + its manual/auto flag. A pre-U3 save has no
      // mlFloor: default to cap − 5 in auto mode. A saved explicit floor loads as manual.
      var savedFloor = (i.mlFloor != null && i.mlFloor !== "") ? i.mlFloor : Math.max(1, (Number(i.ml) || 36) - 5);
      state.mlFloor = savedFloor;
      state.mlFloorManual = i.mlFloorManual != null ? !!i.mlFloorManual : (i.mlFloor != null && i.mlFloor !== "");
      // #339 — restore the augment-only ML ceiling. Absent on a pre-feature save
      // -> null (unrestricted). ALWAYS assign: the state object outlives a
      // character, so a ceiling left over from the previous one would silently
      // restrict this build's augments. The visible input re-renders from state.
      state.augCeiling = (i.augCeiling != null && i.augCeiling !== "") ? Number(i.augCeiling) : null;
      state.race = i.race; state.alignment = i.alignment;
      state.armor = i.armor; state.oath = i.oath || "";
      // U5 — combat constraints. A pre-migration save carries the inert `weapon`
      // flag and none of these; it loads unconstrained (Settled Decision 5), so an
      // old build re-solves identically. The stale `weapon` value is simply dropped.
      state.style = i.style || "";
      state.weaponTypes = Array.isArray(i.weaponTypes) ? i.weaponTypes.slice() : [];
      state.offHand = Array.isArray(i.offHand) ? i.offHand.slice() : [];
      state.offHandWeapons = Array.isArray(i.offHandWeapons) ? i.offHandWeapons.slice() : [];
      // plan 003 U1 — the Two Weapon Fighting declaration (R9). A pre-U1 save has no
      // field; `!!` loads it as undeclared.
      // plan 003 U4 — …unless the save used the OLD opt-in (off-hand weapon types
      // picked, no declaration field), in which case dual-wield was already on for
      // that character and staying undeclared would silently put a shield back in
      // their off hand. Migrate, and record it so the load discloses it: a feat must
      // never appear on a character sheet without the player being told.
      state.twfMigrated = twfMigrationNeeded(i);
      state.twoWeaponFighting = state.twfMigrated || !!i.twoWeaponFighting;
      state.includeArtifact = !!i.includeArtifact;
      state.craftingRung = rungFromInputs(i);   // #346 (U3, KTD3) — see the helper
      // #110 (U1/KTD7) — restore the blocklist with an explicit absent-to-default
      // branch, and ALWAYS assign: the state object outlives a character, so a
      // field not reset on load stays live from the previous one.
      // review fix — sanitize elements at the load boundary: a hand-edited backup
      // can carry non-strings, which render as ghost rows removeBlock's strict
      // string comparison could never remove and every save would re-persist.
      state.pinnedSets = Array.isArray(i.pinnedSets)
        ? i.pinnedSets.filter((x) => typeof x === "string" && x) : [];
      state.blocklist = Array.isArray(i.blocklist)
        ? i.blocklist.filter((x) => typeof x === "string" && x)
        : [];
      // review fix — the STAGED selection is per-character UI state too: ticks
      // staged on the previous character must not commit into this one.
      blockStage.clear();
      state.blockRefusedMsg = null;
      // U6 — restore owned set augments (stored as an array; rebuilt as a Set).
      state.ownedSetAugments = Array.isArray(i.ownedSetAugments) ? new Set(i.ownedSetAugments) : new Set();
      state.pool = i.pool || "all";
      state.ownedNames = Array.isArray(i.ownedNames) ? new Set(i.ownedNames) : null;
      state.ownedAugments = !!i.ownedAugments;   // #359 — absent on a pre-feature save = off
      state.priorities = Array.isArray(i.priorities) ? i.priorities.slice() : [];
      // U4 — restore per-priority caps/floors (absent on pre-U4 saves -> empty).
      state.targetCaps = (i.targetCaps && typeof i.targetCaps === "object") ? { ...i.targetCaps } : {};
      state.targetFloors = (i.targetFloors && typeof i.targetFloors === "object") ? { ...i.targetFloors } : {};
      // U2 — declared credits are per-character state and must be reset here like
      // every sibling map above. `state` is long-lived, so without this a credit
      // declared on the previous character stays live: the initial render uses the
      // stored query and looks right, then the first Re-solve reads live state and
      // silently solves the loaded character with a bonus nobody declared for it.
      // (U5 will populate this from the save; the RESET is what makes it safe, and
      // is correct now because nothing writes declaredCredits into `inputs` yet.)
      state.declaredCredits = (i.declaredCredits && typeof i.declaredCredits === "object") ? { ...i.declaredCredits } : {};
      // #88 U5 (R20/R21/R23) — the saved overrides, then the overlay rebuilt over
      // the shared pool. ALWAYS assigned and ALWAYS re-applied, in that order: the
      // pool is one object shared by every character, so the previous character's
      // stamps have to come off it before this one's go on. applyOverrideOverlay
      // withdraws first, so switching A -> B leaves nothing of A behind even
      // though B declares nothing. A pre-feature save restores [] and the apply
      // becomes a no-op that still performs the withdrawal.
      state.overrides = restoreOverrides(i);
      // U7 (R25/R27/R28) — resolve the lifecycle BEFORE applying, and disclose it.
      // Resolution reads through the stamp so it is independent of the pool's
      // applied state, but running it first keeps the reported states about the
      // catalog the player is loading against rather than about our own overlay.
      const _ovMod = _overridesModule();
      state.overrideNotice = (_ovMod && dataset)
        ? overrideLoadMessage(_ovMod.resolveOverrides(dataset, state.overrides)) : null;
      applyOverrideOverlay();
      // KTD1 — the whole priority list is being replaced, so any row left open
      // belongs to the build being discarded. Ephemeral state, cleared not restored.
      openPanelClear();
      // #169 — a saved character may rank a name that has since been EXPANDED
      // AWAY (`Speed`, `Parrying`, `Heightened Awareness`, the umbrella ability
      // names). The add-a-priority paths refuse those, but this one restored them
      // verbatim: the priority would load looking normal and score zero forever,
      // indistinguishable from a target no item happens to carry. Substitute the
      // stats it actually became, and disclose it — a silent rewrite of someone's
      // saved character is the same defect in a different coat.
      //
      // Runs AFTER the bound maps are restored, because it has to clean them: a
      // cap or floor keyed to the old name is stranded once that name leaves the
      // priority list. `model.js` still unions it into the target set and the
      // solver reports a floor it can never satisfy, while the UI offers no row
      // to delete it — bounds are only removable through their priority row.
      // They are DROPPED rather than remapped: "min 4 Parrying" is not
      // "min 4 Armor Class", and copying it onto four stats would invent four
      // constraints the player never set.
      const _dnMig = _datasetNormalizer();
      state.expandedAwayMigrated = null;
      if (_dnMig && _dnMig.migratePriorities) {
        const migrated = _dnMig.migratePriorities(state.priorities, pickerVocabulary(dataset));
        const _retiredSubs = migrated.retired || [];
        if (migrated.substitutions.length || _retiredSubs.length) {
          state.priorities = migrated.priorities;
          const droppedBounds = [];
          const droppedCredits = [];
          // #381 — a retired label strands bounds and credits by the same mechanism,
          // so it walks the same loop, and they are DROPPED rather than remapped for
          // the same reason: "min 4 Legendary Accuracy" bounded only the
          // Legendary-typed carriers, and `Accuracy` is a broader population.
          for (const sub of migrated.substitutions.concat(_retiredSubs)) {
            for (const map of [state.targetCaps, state.targetFloors]) {
              if (map && map[sub.from] != null) { droppedBounds.push(sub.from); delete map[sub.from]; }
            }
            // U5 — credits are keyed `stat||bonusType`, not by stat, so the
            // stat-keyed loop above cannot reach them. A credit whose priority the
            // migration substitutes away would otherwise survive as an orphan:
            // still in the query, still competing in a bucket, for a stat the
            // player can no longer see or remove. Match on the entry's own stat.
            if (state.declaredCredits) {
              for (const [k, c] of Object.entries(state.declaredCredits)) {
                if (c && c.stat === sub.from) { droppedCredits.push(sub.from); delete state.declaredCredits[k]; }
              }
            }
          }
          state.expandedAwayMigrated = _dnMig.migrationMessage(
            migrated.substitutions, droppedBounds, droppedCredits, { retired: _retiredSubs });
        }
      }
      // #91 (U4/KTD8) — pre-feature save healing, beside the priority migration
      // above for the same reason: both repair a restored list at the load
      // boundary. An UNMARKED save (no `utility_tier_aware` in inputs — saved
      // before the tier existed, or imported from a pre-feature backup) gets the
      // Utility sentinel appended at the bottom, the same zero-cost default a new
      // list is born with. A MARKED save restores verbatim: the player's removal
      // or dragged position is their decision and persists. Never duplicates.
      state.priorities = healUtilityTier(state.priorities, !!i.utility_tier_aware);
      // #348 (U7, R12/R13) — the second generation. Runs AFTER the #91 heal so a
      // pre-tier save gets its row appended first and then lands already pinned.
      // KTD3 — `undefined` (a save with no container key) becomes `null`, which
      // means "follow the current default", NOT an empty container.
      state.utilityContainer = Array.isArray(i.utilityContainer) ? i.utilityContainer.slice() : null;
      const _uHeal = healUtilityContainer(state.priorities, !!i.utility_container_aware);
      state.priorities = _uHeal.priorities;
      state.utilityHealNotice = _uHeal.message;
      state.slotConstraints = i.slotConstraints || {};
      state.constraintsDirty = false;   // loaded constraints are the saved state, not a pending change
      // #110 (U5/U6) — the load-path blocklist reconciliation: a save holding a
      // pin+block overlap (hand-edited/corrupted import) or a stale blocked id
      // (renamed upstream) is REPORTED, never silently resolved or dropped. The
      // helper works on copies; nothing here rewrites the saved arrays.
      state.blockLoadNotice = blockLoadMessage(state.blocklist, state.slotConstraints, dataset.items);
      // U5, Part C — one-time load migration: a PRE-OVERHAUL saved snapshot embedded
      // its chosen items with only the legacy `stat`/`bonus_type`/`minimum_level`
      // fields; upgrade them so the native-first readers (affixLabel/itemMl) render.
      const _norm = _datasetNormalizer();
      const snap = (_norm && _norm.migrateLoadout) ? _norm.migrateLoadout(rec.snapshot) : rec.snapshot;
      // #428 U4 (R16) — a record that recorded its step resumes there; a
      // pre-feature record keeps the original routing (an optimal snapshot lands
      // on Results, anything else on priorities to re-solve — never a blank
      // results view).
      const _target = stepOnLoad(i, snap);
      if (_target === "results") {
        const query = rec.query || buildQuery(state, vocab);
        // #91 (U3, KTD3) — same counting-set threading as the solve path above.
        // eslint-disable-next-line no-undef
        const model = buildModel(candidateItems(), query, dataset.dino_inserts, dataset.nearly_complete,
          dataset.viktranium, dataset.seal, dataset.membership_set_defs, dataset.thunder_forged, dataset.green_steel, dataset.augment_set_defs,
          // #332 — BOTH sets: the counting roster the tier scores, and the admitted
          // procs it deliberately does not, so the result can name a ranked-but-
          // uncounted proc on every surface including exports. THIS file is the live
          // solve path — web/query.js is not loaded by web/index.html at all.
          // Gate on SIZE, not truthiness: an empty stamped counting set is truthy, and
          // threading it would make the card and all six exports assert "weapon procs
          // are ranked individually rather than counted" while the tier counts nothing
          // at all. web/browse.js:373 already gates its markers this way; these sites
          // were the other half of the same asymmetry.
          vocab.utilityCounting && vocab.utilityCounting.size
            ? { counting: vocab.utilityCounting, notCounted: vocab.utilityNotCounted || new Set(),
                // #348 (U3) — the container's ORDER rides with its contents. Without
                // it the solver falls back to alphabetical, which is not a product
                // decision and would pursue Blindness Immunity before Ghostly.
                order: state.utilityContainer || vocab.utilityOrder || null }
            : null,
          // #371 — the per-item Nearly Complete pools ("Nearly Finished" /
          // "Almost There"), keyed by host name. Threaded as an ARGUMENT like
          // every other pool; the solver reaches a host's options through its
          // own `nc_per_item_slots` marker.
          dataset.nearly_complete_per_item);
        // fresh:false + the original stamp so a later Save preserves staleness (see saveCurrentCharacter).
        state.lastRun = { model, result: snap, query, fresh: false, stampedBuildId: rec.stampedBuildId || null };
        state.loadedStale = !!(rec.stampedBuildId && currentBuildId() && rec.stampedBuildId !== currentBuildId());
        state.step = "results";
        render();
        const box = document.getElementById("wz-results");
        // #91 (review fix) — see restoredRenderQuery: a healed-unmarked restore
        // renders from a sentinel-appended COPY, never `query` itself, so the
        // report-absent utility card is reachable without touching the solved record.
        const renderQuery = restoredRenderQuery(query, !!i.utility_tier_aware);
        // eslint-disable-next-line no-undef
        if (box) renderResults(box, { model, result: snap, query: renderQuery, dataset, highs: null, onAfterRender: afterResultsRender, onRequire: requireOutbidStat, onJump: jumpFromNotice, notesSeen, onNotesOpen: () => { notesSeen = true; }, upgradeBar, onUpgradeBar: rememberUpgradeBar, versions: versionsSeam, characterName: state.characterName });
        // #88 U8 (R30/AE9) — either cause shows the banner, and the text says which.
        refreshStaleBanner();
      } else {
        // #429 review #2 — this branch never SETS lastRun, so it must clear it:
        // the previous character's run is still live on `state`, and a save from
        // here would write that build's loadout into this record.
        state.lastRun = null;
        state.loadedStale = false;
        go(_target);
        // The "no solved build" line is an explanation for a FALLBACK, so it is
        // shown only when one happened. A build deliberately saved mid-flow
        // resumes where it stopped and needs no apology for not being solved.
        //
        // #429 review #7 — the test is whether the target DIFFERS from what the
        // record asked for, not merely whether it recorded one. `solve()` sets
        // step "results" on the infeasible and catch paths too, so a save there
        // records "results" with no optimal snapshot; keying on absence alone
        // suppressed the very message this branch exists to give.
        if (savedStep(i) !== _target) {
          const s = document.getElementById("wz-status");
          if (s) s.textContent = `"${rec.name}" has no solved build saved — adjust priorities and re-solve.`;
        }
      }
    }

    // #428 U3 (R13/R14/R17/R20/R21) — the save rail. It renders from render()
    // beside every step body (KTD4), which is why it cannot be a step template:
    // Save and Load have to be reachable wherever the player is. It replaces
    // BOTH prior surfaces — the character step's "Character name" field with its
    // saved-characters list, and the results step's second name input beside a
    // "Save character" button.
    function railHTML() {
      // eslint-disable-next-line no-undef
      const m = railModel(state, CharacterStore.listCharacters());
      const list = m.empty
        ? `<p class="wz-help">Nothing saved yet.</p>`
        : `<ul class="wz-charlist">${m.saved.map((n) => `<li${n === m.loadedName ? ` class="on"` : ""}>
            <span class="wz-charnm">${esc(n)}</span>
            <span class="wz-ctl"><button type="button" data-railload="${esc(n)}">Load →</button>
            <button type="button" data-railrename="${esc(n)}" aria-label="rename ${esc(n)}" title="Rename">\u270e</button>
            <button type="button" data-raildel="${esc(n)}" aria-label="delete ${esc(n)}">✕</button></span></li>`).join("")}</ul>`;
      // #518 U4 — the takeover notice. Rendered here rather than as a dialog: it
      // is raised by a save, and saves happen on every navigation.
      const take = state.farmingTakeover;
      const takeNote = take
        ? `<p class="wz-rail-note" role="status">${esc(farmingTakeoverText(take.name, take.count))}
            <span class="wz-ctl"><button type="button" data-railkeepfarm="${esc(take.name)}">Keep them</button>
            <button type="button" data-railclearfarm="${esc(take.name)}">Clear them</button></span></p>`
        : "";
      return `<aside class="wz-rail" id="wz-rail" aria-label="Your build">
        <p class="wz-rail-head">Your build</p>
        ${takeNote}
        <p class="wz-rail-loaded">${m.loaded
          ? `Editing <strong>${esc(m.loadedName)}</strong>`
          : `<span class="wz-sub">Unsaved build</span>`}</p>
        <p class="wz-help">Saves automatically as you go — in this browser only, with no account, and cleared if you clear browser data.</p>
        <div class="wz-rail-list">
          <p class="wz-label">Saved builds</p>
          ${list}
        </div>
      </aside>`;
    }

    // Re-render the rail in place. Used after a save, a delete, or an import —
    // anything that changes the store without changing the step.
    function renderRail() {
      const host = document.getElementById("wz-rail");
      if (!host) return;
      host.outerHTML = railHTML();
      wireRail();
    }

    /** #428 U3/U5 — the one save transaction. Both surfaces that can save (the
     *  rail's button and the guard's "Save and continue") go through it, so an
     *  overwrite confirm cannot be enforced on one and skipped on the other.
     *  Returns the store's result, or null when the player declined the
     *  overwrite. */
    function trySave(nm) {
      // #548 — cleared per attempt. The flag says "THIS save cost history"; left
      // standing it would attach an earlier save's reclaim to a later message.
      state.storageReclaimed = 0;
      // eslint-disable-next-line no-undef
      const prev = nm ? CharacterStore.loadCharacter(nm) : null;
      // #452 U2 (KTD1) — `prev` alone is NOT the gate. It is true for the build
      // being edited, and under autosave that means a native confirm on every
      // step change. `nameCollides` narrows it to a genuine overwrite of someone
      // else's record, once.
      if (nameCollides(state, nm, prev)) {
        const prevHasLoadout = !!(prev.snapshot && prev.snapshot.status === "optimal");
        const savingSolved = runBelongsTo(state.lastRun, nm, state.loadedName);
        if (!window.confirm(overwriteConfirmText(nm, prevHasLoadout, savingSolved))) return null;
        // R6 — remembered for this build, so a second Continue is silent.
        state.nameReconciled = nm;
      }
      let res = saveCurrentCharacter(nm);
      // #548 — a quota failure here is almost never THIS build's fault. Four
      // stores share one origin budget and only the version store grows unbidden
      // (an `auto` snapshot per solve, ~38 KB each, no cap), so the save that
      // fails is usually just the next write after that store filled the space.
      // Reclaim its own unbidden history and try once more before telling the
      // player anything: a build they deliberately saved must not be lost to
      // history they never asked to keep. Named and imported versions are never
      // touched — `pruneAuto` cannot reach them.
      if (res && res.error === "quota") {
        const freed = reclaimAutoVersions();
        if (freed > 0) {
          res = saveCurrentCharacter(nm);
          if (res.ok) state.storageReclaimed = freed;
        }
      }
      // #452 R-d — autosave depends on this. Without it the next Continue sees a
      // name that is not `loadedName`, `nameCollides` returns true again, and the
      // confirm comes back on the build we just wrote.
      if (res.ok) state.loadedName = nm;
      return res;
    }

    /** #548 — give back the space the version store took without being asked.
     *  Returns how many auto snapshots were dropped (0 when the store is absent
     *  or had nothing reclaimable). */
    function reclaimAutoVersions() {
      const V = (typeof VersionStore !== "undefined") ? VersionStore : null;
      if (!V || typeof V.pruneAuto !== "function") return 0;
      let dropped = 0;
      for (const keep of (V.RECLAIM_LADDER || [10, 3, 1])) {
        const r = V.pruneAuto(keep) || {};
        dropped += r.dropped || 0;
        if (dropped > 0) break;   // one rung is enough to retry on
      }
      return dropped;
    }

    /** #431 U3 (R5/R7) — the one save handler, for the one rendered button. Only
     *  one step body renders at a time, so `#wz-save` is unique per render. */
    function wireSave() {
      const btn = document.getElementById("wz-save");
      if (!btn) return;
      btn.onclick = () => {
        const nm = (state.characterName || "").trim();
        const res = trySave(nm);
        if (!res) return;   // overwrite declined
        // renderRail() refreshes the saved-builds list. It replaces #wz-rail only,
        // and the status span now lives in the step body, so it survives — but
        // render() must NOT be used here: on results it would blank #wz-results.
        renderRail();
        const stat = document.getElementById("wz-savestat");
        if (stat) {
          stat.textContent = res.ok
            ? saveOkText(nm, state.storageReclaimed)
            : saveErrorText(res.error);
        }
        // Reported once, on the save it belongs to.
        state.storageReclaimed = 0;
      };
    }

    /** #431 U3 (KTD7) / #432 — ONE owner for every primary on the results step.
     *  Banner visibility is mutated imperatively, with no re-render, so classes
     *  assigned at render time would never flip; every site that shows or hides a
     *  re-solve banner calls this. */
    function refreshResultsEmphasis() {
      if (state.step !== "results") return;   // save is ghost on every other bar
      // #432 — rank the banners first: the earliest one ACTUALLY ON SCREEN keeps
      // `primary`, the rest go ghost. They raise independently and can co-show, so
      // without this the step can carry three primaries at once.
      //
      // Ranked on `wz-hidden`, not on `resolveBannerPrimary(state)`. The two agree
      // at render time and part company afterwards: the stale banner's dismissal
      // clears `state.loadedStale` and hides the element, but `staleNote` also
      // accumulates an override-set cause and a missing-armor cause, so a build
      // loaded without armor keeps it truthy. Ranking from state there would hand
      // `primary` to the button just hidden and ghost everything visible, leaving
      // the step with no primary at all.
      let claimed = false;
      for (const [barId, btnId] of [["wz-stale", "wz-staleresolve"],
                                    ["wz-twfmig", "wz-twfmigresolve"],
                                    ["wz-cbar", "wz-cresolve"]]) {
        const bar = document.getElementById(barId);
        const b = document.getElementById(btnId);
        if (!b) continue;
        const showing = !!bar && !bar.classList.contains("wz-hidden");
        const primary = showing && !claimed;
        b.classList.toggle("primary", primary);
        b.classList.toggle("ghost", !primary);
        if (showing) claimed = true;
      }
      const btn = document.getElementById("wz-save");
      if (!btn) return;
      // The Adjust & re-solve fold-up carries a fourth `Re-solve ⚡` primary. It is
      // collapsed on every render, so the initial class needs only the banner
      // check — but once the player opens it, its button is on screen and save
      // must yield to it exactly as it does to a banner. Read from the DOM: the
      // fold has no state field, by design.
      const fold = document.getElementById("wz-adjust");
      const primary = !claimed && !(fold && fold.open);
      btn.classList.toggle("primary", primary);
      btn.classList.toggle("ghost", !primary);
    }

    function wireRail() {
      const rail = document.getElementById("wz-rail");
      if (rail) rail.onclick = (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.railload != null) { requestLoad(b.dataset.railload); return; }
        if (b.dataset.railkeepfarm != null) {
          // Keeping is doing nothing. The entry may well be the player's own work
          // from a build that failed to save, so this is the default answer and
          // it only dismisses the notice.
          state.farmingTakeover = null;
          renderRail();
          return;
        }
        if (b.dataset.railclearfarm != null) {
          // Through the module that owns the key, never a hand-rolled write of a
          // blob only farming.js documents.
          // eslint-disable-next-line no-undef
          const cleared = (typeof FarmingList !== "undefined")
            ? FarmingList.clearProgress(b.dataset.railclearfarm) : { ok: false };
          state.farmingTakeover = null;
          renderRail();
          const st2 = document.getElementById("wz-savestat");
          if (st2) {
            st2.textContent = (cleared && cleared.ok)
              ? "Those farming ticks were cleared."
              : "Those ticks could not be cleared \u2014 your browser's storage for this site may be full.";
          }
          return;
        }
        if (b.dataset.railrename != null) {
          // plan 2026-08-25-002 U3 (#518) — the rename the app never had.
          //
          // A prompt is fine HERE and would not be on the save path: the player
          // asked for this, which is the whole objection KTD6 records against a
          // dialog during autosave. Same shape the bundle rename already uses.
          const from = b.dataset.railrename;
          const next = window.prompt("Rename this build:", from);
          if (next === null) return;              // dismissed — nothing to do
          const to = String(next).trim();
          // eslint-disable-next-line no-undef
          const res = CharacterStore.renameBuild(from, to);
          const stat = document.getElementById("wz-savestat");
          if (!res.ok) {
            if (stat) stat.textContent = renameRefusalText(res);
            return;
          }
          // The load-boundary discipline, at a boundary that did not exist until
          // now: every per-character field a stale value could leak through has
          // to move with the build. Solve attribution is NOT among them —
          // `runBelongsTo` derives it from `loadedName` at save time rather than
          // from a name stored on the run, so moving `loadedName` carries it.
          if (from === state.loadedName) {
            state.loadedName = res.to;
            state.characterName = res.to;
            // The warn-once overwrite flag would otherwise still be holding the
            // OLD name, so the next genuine collision under the new one would
            // pass unwarned.
            state.nameReconciled = (state.nameReconciled === from) ? res.to : state.nameReconciled;
          }
          renderRail();
          renderSharePicker();
          if (stat) stat.textContent = res.unchanged
            ? `\u201C${res.to}\u201D keeps its name.`
            : `Renamed to \u201C${res.to}\u201D.`;
          return;
        }
        if (b.dataset.raildel != null) {
          // #429 review #3 — deleting the build you are EDITING removes the only
          // stored copy while the unsaved edits stay in memory with nothing left
          // to save them back to. The confirm says so rather than reading like an
          // ordinary delete.
          const nm = b.dataset.raildel;
          const editingThis = state.inputsDirty && nm === state.loadedName;
          // plan U6 — read what goes WITH the build before asking, so the question
          // names the loss while it is still a question. Read after the delete and
          // it always reports zero.
          // eslint-disable-next-line no-undef
          const impact = CharacterStore.deletionImpact(nm);
          const msg = deleteBuildConfirmText(nm, impact, editingThis);
          if (!window.confirm(msg)) return;
          // eslint-disable-next-line no-undef
          const del = CharacterStore.deleteBuildAndDependents(nm);
          if (!del.ok) {
            // A partial cascade is worse than none: the build is removed LAST, so
            // a failure here means nothing was removed and the player can retry.
            window.alert("That build could not be deleted. Nothing was removed.");
            return;
          }
          renderRail();
        }
      };
    }

    // Keep the share dropdown (U5) in sync with the store — called on render and
    // after any in-panel save/delete/import so it never lists a stale name.
    function renderSharePicker() {
      const shareSel = document.getElementById("wz-share-sel");
      if (!shareSel) return;
      // The build the user just solved is exportable WITHOUT saving it first — list
      // it as the default option; saved characters follow. (The prior version only
      // listed saved characters, so a fresh unsaved solve had nothing to export.)
      const hasCurrent = !!(state.lastRun && state.lastRun.result && state.lastRun.result.status === "optimal");
      // eslint-disable-next-line no-undef
      const names = CharacterStore.listCharacters().map((c) => c.name);
      const prev = shareSel.value;
      const opts = [];
      if (hasCurrent) {
        const nm = (state.characterName || "").trim();
        opts.push(`<option value="__current__">${esc(nm ? `${nm} (current build)` : "Current build")}</option>`);
      }
      for (const n of names) opts.push(`<option value="${esc(n)}">${esc(n)}</option>`);
      shareSel.innerHTML = opts.length ? opts.join("") : `<option value="">No solved or saved loadout</option>`;
      if (prev && [...shareSel.options].some((o) => o.value === prev)) shareSel.value = prev;
      else if (hasCurrent) shareSel.value = "__current__";
    }

    // #428 U7 (R22/R23/KD2/KTD6) — the "Your data" block: export every saved
    // build to a file, or restore from one. This is BACKUP, a different job from
    // the Share tab's five loadout formats directly above it, and the two are
    // stated once side by side rather than explained twice.
    //
    // It left the wizard's step flow (R23) and is rendered by TWO hosts: the
    // Share panel, and the on-demand panel below. `ns` namespaces every id
    // because both can be in the DOM at once — the Share panel lives inside the
    // results view while the on-demand panel is an overlay over it.
    function dataBlockHTML(ns) {
      // The on-demand panel already carries "Your data" as its own heading; the
      // Share panel does not, so the block supplies one there.
      return `<div class="wz-data-block">
          ${ns === "share" ? `<p class="wz-label">Your data</p>` : ""}
          <p class="wz-help">Back up <strong>everything you have made</strong> — your builds, your saved bundles, and your
            farming progress — to a file, or restore from one. This is how you move your work to another device, and the only way
            back if you clear your browser data. <strong>Version snapshots are not included:</strong> they are taken automatically
            on every solve and would make this file far larger, so clearing your browser loses your version history and keeps
            everything you wrote. Backups stay compatible across the last 3 data versions; a file older than that, or made by a
            newer version of the app, is declined so a bad import can't corrupt your saves.</p>
          <div class="wz-data-row">
            <button class="btn ghost" id="wz-export-${ns}" type="button">Export all (.json)</button>
            <input id="wz-import-label-${ns}" type="text" readonly placeholder="Import a backup (.json)…" class="wz-file">
            <input id="wz-import-${ns}" type="file" accept=".json,application/json" class="wz-hidden">
          </div>
          <div id="wz-data-stat-${ns}" class="wz-filestat"></div>
          <hr class="wz-data-sep">
          <p class="wz-label">What is stored on this device</p>
          <p class="wz-help">Everything below lives in this browser only. Remove anything you no longer need \u2014 this is
            also where to free space when the app says storage is full.</p>
          <div id="wz-stored-host-${ns}"></div>
        </div>`;
    }

    // The on-demand host (KD2's reachability cost). The Share tab follows a
    // solve, so on its own it strands a player who holds saves but has not
    // solved this session — and it makes a FIRST restore, into an empty store on
    // a fresh browser, impossible. Opened from the topbar the way the Item
    // Browser is: a surface reached on demand, not a step.
    function openDataPanel() {
      let ov = document.getElementById("wz-data-overlay");
      if (!ov) {
        ov = document.createElement("div"); ov.id = "wz-data-overlay"; ov.className = "wz-browse-overlay";
        document.body.appendChild(ov);
      }
      ov.innerHTML = `<div class="wz-browse-panel wz-data-panel">
        <div class="wz-browse-head"><h2>Your data</h2><button class="btn ghost" id="wz-data-close">Close ✕</button></div>
        ${dataBlockHTML("panel")}
      </div>`;
      ov.classList.add("on");
      document.getElementById("wz-data-close").onclick = () => { ov.classList.remove("on"); };
      // Restoring a backup changes which builds exist; the import handler's own
      // renderRail() call keeps the rail behind this overlay in step.
      wireDataManagement("panel");
    }

    function wireDataManagement(ns) {
      // plan U7 — the stored-items list. Rendered and re-rendered here rather than
      // in the block template, because a delete has to refresh it in place: the
      // panel is an overlay and a full wizard render would close it.
      function renderStored() {
        const host = document.getElementById(`wz-stored-host-${ns}`);
        if (!host) return;
        const SB = _savedBundles();
        host.innerHTML = storedItemsHTML(storedItemsModel({
          // eslint-disable-next-line no-undef
          builds: CharacterStore.listCharacters(),
          bundles: SB ? SB.listBundles() : [],
          // eslint-disable-next-line no-undef
          versions: (typeof VersionStore !== "undefined") ? VersionStore.listVersions() : [],
          // eslint-disable-next-line no-undef
          farming: (typeof FarmingList !== "undefined") ? FarmingList.readProgress() : {},
        }), ns);
        host.querySelectorAll("[data-del-kind]").forEach((btn) => {
          btn.onclick = () => {
            const kind = btn.dataset.delKind;
            const id = btn.dataset.delId;
            if (kind === "builds") {
              // Routed through the coordinator so the confirmation names what goes
              // with it, and so this delete cannot skip the cascade.
              // eslint-disable-next-line no-undef
              const impact = CharacterStore.deletionImpact(id);
              if (!window.confirm(deleteBuildConfirmText(id, impact, false))) return;
              // eslint-disable-next-line no-undef
              const r = CharacterStore.deleteBuildAndDependents(id);
              if (!r.ok) { window.alert("That build could not be deleted. Nothing was removed."); return; }
              renderRail();
            } else if (kind === "bundles") {
              const SBx = _savedBundles();
              if (!SBx) return;
              const rec = SBx.listBundles().find((x) => x.id === id);
              if (!rec) { renderStored(); return; }
              if (!window.confirm(deleteBundleConfirmText(rec.name, (rec.affixes || []).length))) return;
              SBx.deleteBundle(id);
            } else if (kind === "versions") {
              // #502 — the storage-full message has always told players to delete a
              // version. deleteVersion has existed in versions.js since #500 with no
              // caller anywhere; this is that caller.
              if (!window.confirm("Delete this version snapshot? It cannot be restored from a backup \u2014 backups do not carry version history.")) return;
              // eslint-disable-next-line no-undef
              VersionStore.deleteVersion(id);
            } else if (kind === "farming") {
              if (!window.confirm(`Clear the farming progress recorded for \u201C${id}\u201D?`)) return;
              // eslint-disable-next-line no-undef
              FarmingList.clearProgress(id);
            }
            renderStored();
          };
        });
      }
      renderStored();

      const exportBtn = document.getElementById(`wz-export-${ns}`);
      if (exportBtn) exportBtn.onclick = () => {
        // eslint-disable-next-line no-undef
        const SB = _savedBundles();
        const payload = BackupIO.serializeAll(CharacterStore.allCharacters(), {
          buildId: currentBuildId(),
          bundles: SB ? SB.listBundles() : [],
          // eslint-disable-next-line no-undef
          farming: (typeof FarmingList !== "undefined") ? FarmingList.readProgress() : {},
        });
        downloadFile(`ddo-characters-${new Date().toISOString().slice(0, 10)}.json`,
          JSON.stringify(payload, null, 2), "application/json");
      };

      const impLabel = document.getElementById(`wz-import-label-${ns}`);
      const impFile = document.getElementById(`wz-import-${ns}`);
      const stat = () => document.getElementById(`wz-data-stat-${ns}`);
      if (impLabel && impFile) {
        impLabel.onclick = () => impFile.click();
        impFile.onchange = (e) => {
          const f = e.target.files[0]; if (!f) return;
          impLabel.value = f.name;
          const reader = new FileReader();
          reader.onload = () => {
            const s = stat();
            // eslint-disable-next-line no-undef
            const res = BackupIO.parseBackup(reader.result);
            if (!res.ok) { s.className = "wz-filestat warn"; s.textContent = res.message || "Import failed."; return; }
            // saveMany already merges by name into the existing store, so pass the
            // imported set directly — no separate mergeInto pass needed for "merge".
            // eslint-disable-next-line no-undef
            const w = CharacterStore.saveMany(res.characters);
            const n = Object.keys(res.characters).length;
            // plan U8 — the rest of the authored work. Restored only when the
            // characters landed: a half-applied import is harder to reason about
            // than one that did not happen.
            //
            // MERGED, not replaced. Replacing deleted every bundle and every tick
            // the player had made since their last export — authored work that
            // exists nowhere else — on the one path they reach precisely because
            // something already went wrong. The character half above merges by
            // name, so replacing here also gave one import two opposite meanings
            // while the status line claimed only one.
            let extra = "";
            const failed = [];
            if (w.ok) {
              const SB = _savedBundles();
              if (SB && (res.bundles || []).length) {
                const r = SB.mergeIn(res.bundles);
                if (r.ok) extra += `, ${res.bundles.length} bundle${res.bundles.length === 1 ? "" : "s"}`;
                else failed.push("saved bundles");
              }
              // eslint-disable-next-line no-undef
              if (typeof FarmingList !== "undefined" && Object.keys(res.farming || {}).length) {
                // eslint-disable-next-line no-undef
                const r = FarmingList.mergeProgress(res.farming);
                if (r.ok) extra += ", farming progress";
                else failed.push("farming progress");
              }
            }
            s.className = "wz-filestat" + (w.ok && !failed.length ? "" : " warn");
            // A failed dependent write must not read as a successful restore. This
            // is the one path where the player's original data is already gone, so
            // a false success is the failure they cannot recover from.
            s.textContent = !w.ok
              ? (w.error === "quota" ? "Storage full — remove some saves and try again." : "Could not save the import.")
              : failed.length
                ? `Imported ${n} character${n === 1 ? "" : "s"}${extra}, but ${failed.join(" and ")} could not be saved — your storage may be full.`
                : `Imported ${n} character${n === 1 ? "" : "s"}${extra} (merged).`;
            renderRail();
            renderStored();
          };
          reader.readAsText(f);
        };
      }
    }

    // ---- on-demand Item Browser (U9) --------------------------------------
    // Reference-only roster search; not a competing top-level tab (R23). Reuses
    // browse.js's initBrowse over a panel this opens on demand.
    function openBrowser() {
      let ov = document.getElementById("wz-browse-overlay");
      if (!ov) {
        ov = document.createElement("div"); ov.id = "wz-browse-overlay"; ov.className = "wz-browse-overlay";
        ov.innerHTML = `<div class="wz-browse-panel">
          <div class="wz-browse-head"><h2>Item Browser</h2><button class="btn ghost" id="wz-browse-close">Close ✕</button></div>
          <p class="wz-help">Search and filter the full indexed roster — reference only; it doesn't change your solve.</p>
          <div id="browse-controls" class="controls"></div>
          <p id="browse-status" class="status"></p>
          <div id="browse-results"></div>
        </div>`;
        document.body.appendChild(ov);
        ov.querySelector("#wz-browse-close").onclick = () => ov.classList.remove("on");
        ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("on"); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") ov.classList.remove("on"); });
        // eslint-disable-next-line no-undef
        // #332 — pass the picker vocabulary so Browse can mark which presence
        // effects the Utility tier counts. Same builder the priorities picker
        // uses, so the two surfaces cannot disagree about membership.
        if (window.ItemBrowser) {
          // #88 U10 (R32) — the SAME picker the results card opens. Browse owns no
          // copy of the predicate; it hands back a variant id and a host element.
          // #426 — every provenance token with at least one ELIGIBLE crafted affix
          // behind it, built once. The alternative is walking the pool for each of
          // the 472 synthesized rows Browse renders.
          const _OV = _overridesModule();
          const _craftedIndex = _OV ? _OV.poolAddressable(dataset) : null;
          window.ItemBrowser.initBrowse(dataset, pickerVocabulary(dataset), {
            onOverride: (variantId, host, row) => openOverridePicker(host, variantId, row),
            // Browse's table mixes item variants with synthesized crafted rows, and
            // the two are addressed differently: an item by its id against the
            // catalog, a crafted row by the provenance it carries. #426 gave the
            // crafted half a creation surface; before that the control was hidden
            // on those 472 rows because nothing could open for them.
            canOverride: (v) => !!(v && ((dataset.items || []).some(
              (x) => (x.variant_id || x.source_item) === v.variant_id)
              || (_OV && _OV.isPoolAddressable(_craftedIndex, v)))),
          });
        }
      }
      ov.classList.add("on");
    }

    // ---- master render + wiring -------------------------------------------
    // #169 — the load-time priority substitution notice. Rendered ABOVE the step
    // body rather than inside the results card, because a loaded character routes
    // to either results or priorities depending on its snapshot, and the player
    // needs to be told their ranking changed on both paths.
    function migrationBanner() {
      let out = "";
      if (state.expandedAwayMigrated) {
        out += `<div id="wz-awaymig" class="wz-cbar">${esc(state.expandedAwayMigrated)}
        <button class="btn ghost" id="wz-awaymig-ok" type="button">Got it</button></div>`;
      }
      // #348 (U7, R13) — the container heal rides the same channel, for the same
      // reason: a loaded character lands on either results or priorities and must
      // be told on both paths. Fires exactly once, because the next Save stamps
      // `utility_container_aware` and the heal then restores verbatim.
      if (state.utilityHealNotice) {
        out += `<div id="wz-utilmig" class="wz-cbar">${esc(state.utilityHealNotice)}
        <button class="btn ghost" id="wz-utilmig-ok" type="button">Got it</button></div>`;
      }
      // #110 (U5/U6) — the blocklist load report rides the same channel: above
      // the step body, because a loaded character routes to either results or
      // priorities and the player must be told on both paths.
      if (state.blockLoadNotice) {
        out += `<div id="wz-blockmig" class="wz-cbar">${esc(state.blockLoadNotice)}
        <button class="btn ghost" id="wz-blockmig-ok" type="button">Got it</button></div>`;
      }
      // #88 U7 (R25/R27/R28) — the override lifecycle report rides the same
      // channel as its three siblings above, for the same reason: a loaded
      // character lands on either results or priorities and must be told on both.
      if (state.overrideNotice) {
        out += `<div id="wz-ovmig" class="wz-cbar">${esc(state.overrideNotice)}
        <button class="btn ghost" id="wz-ovmig-ok" type="button">Got it</button></div>`;
      }
      return out;
    }

    function render() {
      const bodies = { intro: stepIntro, character: stepCharacter, pool: stepPool, priorities: stepPriorities, results: stepResults };
      // #428 U3 (KTD4) — the step body and the save rail sit side by side in one
      // shell. The rail is emitted HERE rather than by any step template, which
      // is what makes Save and Load reachable from every step (R14).
      root.innerHTML = `<div class="wz-topbar">${renderStepper()}<button class="btn ghost wz-browse-btn" data-browse type="button">Browse items</button><button class="btn ghost wz-browse-btn" data-yourdata type="button">Your data</button></div>`
        + migrationBanner()
        + `<div class="wz-shell"><div class="wz-body">`
        + (bodies[state.step] || stepIntro)()
        + `</div>` + railHTML() + `</div>`;
      wire();
    }
    function go(step) { state.step = step; render(); }

    // #428 U5 (KTD3) — one flag, raised by any write to a build input. Cleared
    // by save and by load.
    //
    // #452 U3 — it used to be cleared by a third path, the player choosing to
    // leave without saving. That dialog is gone: navigation saves now, so the
    // only way the flag survives a navigation is a save that FAILED, which is
    // exactly what it should mean. Do not repurpose it into an "autosave
    // needed" skip — a clear flag means the last write succeeded, not that the
    // record matches the current step, and the step itself is saved state.
    function markDirty() {
      state.inputsDirty = true;
      // #428 U6 (R8) — the marks must clear the moment a field is answered, and
      // half the required controls (the armor chips, the ML input) update in
      // place rather than re-rendering. Hanging the refresh off the same signal
      // that says "an input changed" is what makes that true of ALL of them
      // rather than of whichever handlers someone remembered.
      if (state.requiredShown && state.step === "character") applyRequiredMarks();
    }

    /** Player-initiated navigation. `go` stays raw on purpose: solving and
     *  loading move the player deliberately, and a guard on those would fire on
     *  the very action that is about to produce the thing worth saving. */
    function navigate(step) {
      if (step === state.step) return;
      autosaveThen(step);
    }

    /** #452 U1/U4 (R1/R11/R12) — the forward path saves, then moves.
     *
     *  This replaces the unsaved-changes guard rather than reusing it. #431 made
     *  the build name a required field that `canAdvance` blocks on, so by the
     *  time a player can leave the character step the name exists — which is
     *  what makes an unprompted save well-defined and left the guard with
     *  nothing to ask.
     *
     *  Direction-agnostic on purpose: `navigate` serves Continue, Back and the
     *  stepper rail alike, so all three save. Excluding Back would cost a branch
     *  and leave one forward-path reflex behaving differently from the other.
     *
     *  Exactly one path does not advance — a DECLINED overwrite. That is not the
     *  guard returning under another name: it is the player choosing to go
     *  rename the build, which is the only answer that still has work to do. */
    function autosaveThen(step) {
      const nm = String(state.characterName || "").trim();
      // `data-back` navigates without consulting canAdvance, so Back from the
      // character step can still arrive unnamed. Nothing to save then — move,
      // rather than manufacturing a "Name this build first" the player did not
      // ask for by pressing Back.
      if (!nm) { go(step); return; }
      const res = trySave(nm);
      if (res === null) return;   // R5 — overwrite declined; stay and rename
      go(step);
      if (!res.ok) {
        // R11/R12 — reported where the press happened, never as a modal, and
        // never blocking. `saveCurrentCharacter` leaves `inputsDirty` raised on
        // failure, so the next navigation retries rather than assuming the work
        // is safe. Written AFTER `go`, which re-renders the step body the status
        // span lives in.
        const stat = document.getElementById("wz-savestat");
        if (stat) stat.textContent = saveErrorText(res.error);
      } else if (state.storageReclaimed) {
        // #548 — an autosave normally says nothing, and still says nothing here
        // unless storage was full and history was dropped to fit. That is a
        // change to the player's stored data, so it is reported where it
        // happened rather than left to surface on some later explicit save.
        const stat = document.getElementById("wz-savestat");
        if (stat) stat.textContent = saveOkText(nm, state.storageReclaimed);
        state.storageReclaimed = 0;
      }
    }

    /** #452 U3 (R9) — loading a saved build goes straight there.
     *
     *  #429 review #3 routed this through the unsaved-changes guard because a
     *  load "discards MORE than a step change does: it replaces the whole
     *  in-memory build". That hazard is gone: every navigation now saves
     *  (`autosaveThen`), so the build being replaced is already on disk under
     *  its own name and loading another costs nothing. A guard whose
     *  precondition can no longer occur is dead UI, and dead UI is worse than
     *  dead logic — it can still be reached by a state nobody predicted. */
    function requestLoad(name) {
      loadCharacter(name);
    }

    function wire() {
      const awayOk = document.getElementById("wz-awaymig-ok");
      if (awayOk) awayOk.onclick = () => {
        state.expandedAwayMigrated = null;
        const bar = document.getElementById("wz-awaymig");
        if (bar) bar.remove();
      };
      // #348 (U7) — dismiss the container heal notice the same way as its siblings.
      const utilOk = document.getElementById("wz-utilmig-ok");
      if (utilOk) utilOk.onclick = () => {
        state.utilityHealNotice = null;
        const bar = document.getElementById("wz-utilmig");
        if (bar) bar.remove();
      };
      const blockOk = document.getElementById("wz-blockmig-ok");
      if (blockOk) blockOk.onclick = () => {
        state.blockLoadNotice = null;
        const bar = document.getElementById("wz-blockmig");
        if (bar) bar.remove();
      };
      const ovOk = document.getElementById("wz-ovmig-ok");
      if (ovOk) ovOk.onclick = () => {
        state.overrideNotice = null;
        const bar = document.getElementById("wz-ovmig");
        if (bar) bar.remove();
      };
      // #428 U3 — the rail is on every step, so it wires on every render.
      wireRail();
      // #431 U3 — and so is the save control, on every step but intro.
      wireSave();
      // #428 U5 (KTD3) — every native control inside the step body is a build
      // input, so one delegated pair covers text, number, select, checkbox and
      // radio without a markDirty() call in each of their handlers. #431 U2
      // (KTD9) — this now covers the build name too: it is a required build
      // input like race, so typing one arms the guard.
      const body = root.querySelector(".wz-body");
      if (body) {
        // …except surfaces that LOOK things up rather than change them: the
        // Share panel (which picks what to export) and the search / add fields
        // marked `data-nodirty` at their declaration. #429 review #6 — typing a
        // query into the block search and clearing it used to arm the guard, so
        // the next Continue warned about a build byte-identical to the one the
        // player arrived with. Opting out at the declaration rather than by a
        // list here means the next search box inherits the right behaviour.
        const onEdit = (e) => {
          const t = e.target;
          if (t && t.closest && t.closest("[data-nodirty], .wz-share")) return;
          markDirty();
        };
        body.addEventListener("input", onEdit);
        body.addEventListener("change", onEdit);
      }
      root.querySelectorAll("[data-browse]").forEach((b) => b.onclick = openBrowser);
      root.querySelectorAll("[data-yourdata]").forEach((b) => b.onclick = openDataPanel);
      root.querySelectorAll("[data-goto]").forEach((b) => b.onclick = () => { if (!b.disabled) navigate(b.dataset.goto); });
      root.querySelectorAll("[data-back]").forEach((b) => b.onclick = () => navigate(prevStep(state.step)));
      root.querySelectorAll("[data-next]").forEach((b) => b.onclick = () => {
        if (!canAdvance(state.step, state)) { blockFeedback(); return; }
        navigate(nextStep(state.step));
      });
      root.querySelectorAll("[data-solve]").forEach((b) => b.onclick = () => {
        if (!canAdvance("priorities", state)) { const s = document.getElementById("wz-status"); if (s) s.textContent = "Add at least one stat to optimize for."; return; }
        solve(true);
      });

      if (state.step === "character") {
        // #428 U6 (R8) — re-apply the marks for whatever is STILL missing, so
        // they survive the re-renders half this step's handlers trigger and
        // disappear the moment the field is answered. Silent until the player
        // has actually been blocked once (R12).
        if (state.requiredShown) applyRequiredMarks();
        const fold = document.getElementById("wz-weapons");
        if (fold) fold.ontoggle = () => { state.weaponsOpen = fold.open; };
        // U3/R7 — the ML floor defaults to cap − 5 and follows the cap until the
        // user edits it. Clearing the floor re-enables auto-follow. Updates are made
        // directly (no re-render) so typing keeps focus.
        // #431 U2 (KTD9) — updated in place, no re-render, so typing keeps focus.
        // The delegated .wz-body listener marks the build dirty on the same event,
        // after this handler has written the value.
        const nameInput = document.getElementById("wz-buildname");
        if (nameInput) nameInput.oninput = (e) => { state.characterName = e.target.value; };
        var floorAutoHint = () => { var h = document.getElementById("wz-mlfloor-auto"); if (h) h.hidden = !!state.mlFloorManual; };
        document.getElementById("wz-ml").oninput = (e) => {
          state.ml = e.target.value;
          if (!state.mlFloorManual) {
            state.mlFloor = Math.max(1, (Number(e.target.value) || 0) - 5);
            var fi = document.getElementById("wz-mlfloor"); if (fi) fi.value = state.mlFloor;
          }
          // #339 — an unset ceiling displays the cap, so it follows the cap live
          // (mirrors the floor's auto-follow wiring above). state.augCeiling stays
          // null: "unrestricted" tracks the cap by meaning, not by value.
          if (state.augCeiling == null) {
            var ci = document.getElementById("wz-augceiling"); if (ci) ci.value = e.target.value;
          }
        };
        // #339 — the ceiling input. Display-layer only: blank or at/above the cap
        // stores null (unrestricted) and the blur handler snaps the DISPLAYED value
        // back to the cap; buildQuery re-clamps authoritatively at query time.
        var ceilInput = document.getElementById("wz-augceiling");
        ceilInput.oninput = (e) => {
          state.augCeiling = clampAugCeiling(e.target.value, Number(state.ml) || 36);
        };
        ceilInput.onblur = (e) => {
          if (state.augCeiling == null) e.target.value = state.ml;
        };
        document.getElementById("wz-mlfloor").oninput = (e) => {
          if (e.target.value === "") {
            state.mlFloorManual = false;
            state.mlFloor = Math.max(1, (Number(state.ml) || 0) - 5);
            e.target.value = state.mlFloor;
          } else {
            state.mlFloor = e.target.value;
            state.mlFloorManual = true;
          }
          floorAutoHint();
        };
        document.getElementById("wz-race").onchange = (e) => { state.race = e.target.value; if (wizIsForged(state.race)) { state.armor = ""; state.oath = ""; } render(); };
        document.getElementById("wz-align").onchange = (e) => state.alignment = e.target.value;
        document.getElementById("wz-artifact").onchange = (e) => state.includeArtifact = e.target.checked;
        // #346 (U2) — the ladder. Re-render on change so the augment-ceiling
        // control's enabled/disabled state and its reason line follow the rung
        // in one place rather than being toggled by hand here (the two would
        // drift). The typed ceiling value lives on state and is untouched, so
        // climbing back up restores it — R6.
        for (const el of document.querySelectorAll('input[name="wz-crafting-rung"]')) {
          el.onchange = (e) => { if (e.target.checked) { state.craftingRung = _normalizeRung(e.target.value); render(); } };
        }
        // U6 — set-augment availability checkboxes write into state.ownedSetAugments (a Set).
        //
        // #509 — every write goes through ONE sync, because a full render() is not
        // available here: `#wz-setaug` does not persist its open state, so
        // re-rendering would close the panel under the player mid-edit. That is why
        // the original handler patched the summary inline, and why a bulk control
        // has to patch the boxes too. Doing it in one place keeps the three
        // surfaces (boxes, summary, bulk buttons) from disagreeing.
        const setAugBoxes = () => root.querySelectorAll("#wz-setaug-list input[data-setaug]");
        const syncSetAug = () => {
          const owned = state.ownedSetAugments;
          for (const cb of setAugBoxes()) cb.checked = owned.has(cb.getAttribute("data-setaug"));
          const sum = document.querySelector("#wz-setaug > summary");
          if (sum) sum.textContent = setAugSummaryLabel(owned.size);
          // A bulk button that cannot change anything is disabled rather than a
          // no-op click — the same courtesy the picklists get when "All added".
          // Inertness is re-read rather than inferred from the button's CURRENT
          // disabled state: inferring it made "disabled because everything is
          // already ticked" indistinguishable from "disabled because the rung
          // excludes the family", and unticking one box would then re-enable a
          // control the rung is supposed to hold shut.
          const inert = _rungExcludesNicheCrafting(_normalizeRung(state.craftingRung));
          const total = setAugBoxes().length;
          const all = document.getElementById("wz-setaug-all");
          const none = document.getElementById("wz-setaug-none");
          if (all) all.disabled = inert || owned.size === total;
          if (none) none.disabled = inert || owned.size === 0;
        };
        setAugBoxes().forEach((cb) => cb.onchange = (e) => {
          if (!(state.ownedSetAugments instanceof Set)) state.ownedSetAugments = new Set();
          const name = e.target.getAttribute("data-setaug");
          if (e.target.checked) state.ownedSetAugments.add(name);
          else state.ownedSetAugments.delete(name);
          syncSetAug();
        });
        // #509 — the bulk pair. Both respect the inert rung by being rendered
        // `disabled` there, and NEITHER writes state when inert: the ladder keeps a
        // player's ticks so they return when they climb back up (#346 U2), and a
        // Clear that fired anyway would destroy exactly what that rule preserves.
        const setAugBulk = (fill) => () => {
          if (_rungExcludesNicheCrafting(_normalizeRung(state.craftingRung))) return;
          if (!(state.ownedSetAugments instanceof Set)) state.ownedSetAugments = new Set();
          state.ownedSetAugments = fill
            ? new Set([...setAugBoxes()].map((cb) => cb.getAttribute("data-setaug")))
            : new Set();
          syncSetAug();
        };
        const setAugAll = document.getElementById("wz-setaug-all");
        const setAugNone = document.getElementById("wz-setaug-none");
        if (setAugAll) setAugAll.onclick = setAugBulk(true);
        if (setAugNone) setAugNone.onclick = setAugBulk(false);
        if (setAugAll || setAugNone) syncSetAug();
        root.querySelectorAll("#wz-armor .wz-chip").forEach((c) => c.onclick = () => {
          if (c.disabled) return;
          state.armor = state.armor === c.dataset.armor ? "" : c.dataset.armor;
          root.querySelectorAll("#wz-armor .wz-chip").forEach((x) => x.classList.toggle("on", x.dataset.armor === state.armor));
          // markDirty AFTER the write: it refreshes the required marks, and armor
          // is one of the fields those marks are about — refreshing first would
          // read the value the player just replaced.
          markDirty();
        });
        // plan 003 U1 — the Two Weapon Fighting declaration: a plain toggle. It is
        // character state, so nothing else resets it (R2) — in particular the style
        // handler above clears the gear picks and deliberately leaves this alone.
        root.querySelectorAll("#wz-twf .wz-chip").forEach((c) => c.onclick = () => {
          markDirty();
          state.twoWeaponFighting = !state.twoWeaponFighting;
          render();
        });
        // U4 — oath: single-select; toggling shows/hides the approximation note.
        root.querySelectorAll("#wz-oath .wz-chip").forEach((c) => c.onclick = () => {
          if (c.disabled) return;
          markDirty();
          state.oath = state.oath === c.dataset.oath ? "" : c.dataset.oath;
          render();
        });
        // Combat style: single-select; changing it swaps which weapon-type / off-hand
        // chips are shown and resets any prior sub-picks, so a full re-render.
        root.querySelectorAll("#wz-style .wz-chip").forEach((c) => c.onclick = () => {
          markDirty();
          const next = state.style === c.dataset.style ? "" : c.dataset.style;
          state.style = next; state.weaponTypes = []; state.offHand = []; state.offHandWeapons = [];
          render();
        });
        // Dropdown pick-lists. `data-plsel` names the list -> backing state array.
        // The "offhand" dropdown is combined: an off-hand ITEM goes to state.offHand,
        // a second WEAPON (dual-wield) to state.offHandWeapons — routed by whether the
        // value is a one-handed weapon type. Tags carry `data-arr` naming their array.
        const PL = { weptypes: "weaponTypes" };
        const offWeaponSet = (WT && WT.twfWeaponAllowedForStyle(state.style)) ? WT.offHandWeaponTypes(weaponTypesInData) : [];
        root.querySelectorAll(".wz-pl-select").forEach((sel) => sel.onchange = () => {
          const id = sel.dataset.plsel, val = sel.value;
          if (!val) return;
          markDirty();
          const key = id === "offhand" ? (offWeaponSet.includes(val) ? "offHandWeapons" : "offHand") : PL[id];
          if (!key) return;
          if (!state[key].includes(val)) state[key] = [...state[key], val];
          render();
        });
        root.querySelectorAll(".wz-pl-tags .wz-tag").forEach((tag) => tag.onclick = () => {
          const key = tag.dataset.arr || PL[tag.dataset.pltag]; if (!key) return;
          markDirty();
          state[key] = state[key].filter((x) => x !== tag.dataset.val);
          render();
        });
      }
      if (state.step === "pool") {
        root.querySelectorAll(".wz-chip[data-pool]").forEach((c) => c.onclick = () => {
          markDirty();
          state.pool = c.dataset.pool;
          document.getElementById("wz-upload").classList.toggle("wz-hidden", state.pool !== "owned");
          root.querySelectorAll(".wz-chip[data-pool]").forEach((x) => x.classList.toggle("on", x.dataset.pool === state.pool));
        });
        // #359 — the opt-in augment restriction. Plain state, no re-render: the
        // control's own checked attribute is the display, and nothing else on this
        // step depends on it.
        const oaug = document.getElementById("wz-owned-augments");
        if (oaug) oaug.onchange = (e) => { state.ownedAugments = e.target.checked; };
        const disp = document.getElementById("wz-file-label"), real = document.getElementById("wz-file");
        if (disp) {
          disp.onclick = () => real.click();
          real.onchange = (e) => {
            const f = e.target.files[0]; if (!f) return; disp.value = f.name;
            const reader = new FileReader();
            reader.onload = () => {
              const stat = document.getElementById("wz-file-stat");
              try {
                // eslint-disable-next-line no-undef
                const { ownedNames, rowCount } = TroveImport.parseTroveCsv(reader.result);
                state.ownedNames = ownedNames;
                // eslint-disable-next-line no-undef
                const m = TroveImport.ownedMatch(ownedNames, dataset.items);
                stat.className = "wz-filestat" + (m.matched ? "" : " warn");
                // #408 — the bare count read as breakage. Measured against a real
                // export, ~75% of unmatched names are out of scope BY DESIGN
                // (filigrees, collectables, consumables, randomly-generated loot)
                // because this is a named-gear catalog, not an inventory. Saying so
                // turns an alarming number into an expected one; saying nothing left
                // a player to conclude the import had failed.
                stat.innerHTML = `✓ Parsed <strong>${rowCount.toLocaleString()}</strong> entries · <strong>${m.ownedCount}</strong> distinct names · matched <strong>${m.matched}</strong> named items.`
                  + (m.unrecognized
                    ? ` <span class="wz-sub">The other ${m.unrecognized.toLocaleString()} are mostly things this tool doesn't optimize over — filigrees, collectables, consumables and randomly-generated loot. Only named gear is searched.</span>`
                    : "");
              } catch (err) {
                state.ownedNames = null;
                stat.className = "wz-filestat warn";
                stat.textContent = `Couldn't read that file: ${err.message}`;
              }
            };
            reader.readAsText(f);
          };
        }
        // U3 — pre-solve item pinning: search + pinned list live under the pool pick.
        const psearch = document.getElementById("wz-pin-search");
        if (psearch) {
          psearch.oninput = () => renderPinResults();
          renderPinResults();
          renderPinList();
        }
        // #110 (U3) — the blocklist picker, wired the same way.
        const bsearch = document.getElementById("wz-block-search");
        if (bsearch) {
          bsearch.oninput = () => renderBlockResults();
          renderBlockResults();
          renderBlockList();
        }
        // #539 — the set-pin picker, wired the same way.
        const spsearch = document.getElementById("wz-setpin-search");
        if (spsearch) {
          spsearch.oninput = () => renderSetPinResults();
          renderSetPinResults();
          renderSetPinList();
        }
        // #88 U11 — the override manager renders from state alone; there is no
        // search box, because corrections are created where the player notices
        // the problem (the results card and Browse), not hunted for here.
        renderOverrideManager();
      }
      if (state.step === "priorities") {
        const add = document.getElementById("wz-add");
        // Composable bundle buttons: append the bundle's affixes to the priority
        // list (deduped); the picked selection lands in the priority order, editable
        // after. Every row is on screen from the start, so nothing reveals anything.
        root.querySelectorAll(".wz-bundle[data-bundle]").forEach((btn) => {
          btn.onclick = () => {
            markDirty();
            state.priorities = addBundle(btn.dataset.bundle, state.priorities, vocab);
            renderRanked();
          };
        });

        // plan U3 — saving the current ranking as a reusable bundle.
        //
        // NO PENDING STATE IS HELD. The name lives in the DOM input until the
        // moment of save and nowhere else: not on `state`, not in a closure. That
        // is deliberate rather than incidental. `state` outlives a character, so a
        // field not reset on load stays live from the previous one — and a closure
        // variable is worse, because it escapes both that convention and the tests
        // that grep the load path for `state.*` resets. A staged block-selection Set
        // already fell through exactly that gap. Loading a character re-renders this
        // step, which clears the input, so there is nothing to reset and nothing to
        // forget to reset.
        const bundleBox = () => root.querySelector('.wz-bundle-box[data-group="mine"]');
        function renderSavedBundles() {
          // Replace the container in place rather than re-rendering the step: a
          // full render would rebuild the ranked list and the add row the player is
          // working in. Same reason the Set Augment panel patches itself.
          const box = bundleBox();
          const B = _savedBundles();
          if (!box || !B) return;
          const wrap = document.createElement("div");
          wrap.innerHTML = savedBundlesHTML(B.listBundles());
          box.replaceWith(wrap.firstElementChild);
          wireSavedBundles();
        }
        function bundleMsg(text) {
          const el = document.getElementById("wz-bundle-msg");
          if (el) el.textContent = text || "";
        }
        function wireSavedBundles() {
          const saveBtn = document.getElementById("wz-bundle-save");
          const nameEl = document.getElementById("wz-bundle-name");
          if (!saveBtn || !nameEl) return;
          saveBtn.onclick = () => {
            const B = _savedBundles();
            if (!B) return;
            const ranked = (state.priorities || []).filter((p) => p && p !== _utilitySentinel);
            if (!ranked.length) { bundleMsg("Rank at least one stat before saving a bundle."); return; }
            const name = String(nameEl.value || "").trim();
            if (!name) { bundleMsg("Give the bundle a name so you can find it again."); return; }
            const list = B.listBundles();
            if (B.nameCollides(name, list)) { bundleMsg(`You already have a bundle called "${name}".`); return; }
            const rec = bundleFromRanking(B.nextId(list), name, ranked, state.targetFloors, state.targetCaps,
              new Date().toISOString());
            const r = B.saveBundle(rec);
            if (!r.ok) {
              // A failed write must never leave a bundle on screen claiming to be
              // saved — the player would rely on work that was never stored.
              bundleMsg(r.full
                ? "Your browser's storage for this site is full, so this bundle was not saved. Delete something from Your data, then try again."
                : "That bundle could not be saved.");
              return;
            }
            nameEl.value = "";
            renderSavedBundles();
            const n = rec.affixes.length;
            bundleMsg(`Saved "${name}" — ${n} ${n === 1 ? "stat" : "stats"}.`);
          };
          nameEl.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); saveBtn.click(); } };

          // plan U4 — apply. REPLACES, unlike a preset, and confirms first when
          // there is work to lose. `data-saved-bundle` is the only selector these
          // handlers accept, so a preset chip cannot reach them.
          root.querySelectorAll("[data-saved-bundle]").forEach((chip) => {
            chip.onclick = () => {
              const B = _savedBundles();
              if (!B) return;
              const rec = B.listBundles().find((x) => x.id === chip.dataset.savedBundle);
              if (!rec) { bundleMsg("That bundle is no longer saved."); renderSavedBundles(); return; }
              const ranked = (state.priorities || []).filter((p) => p && p !== _utilitySentinel);
              if (ranked.length && !window.confirm(applyBundleConfirmText(rec.name, ranked.length))) return;
              const next = applySavedBundle(rec, state.priorities);
              markDirty();
              state.priorities = next.priorities;
              state.targetFloors = next.targetFloors;
              state.targetCaps = next.targetCaps;
              renderRanked();
              bundleMsg(`Applied \u201C${rec.name}\u201D.`);
            };
          });

          // plan U5 — rename and delete, on saved bundles only.
          root.querySelectorAll("[data-rename-bundle]").forEach((btn) => {
            btn.onclick = () => {
              const B = _savedBundles();
              if (!B) return;
              const id = btn.dataset.renameBundle;
              const rec = B.listBundles().find((x) => x.id === id);
              if (!rec) { bundleMsg("That bundle is no longer saved."); renderSavedBundles(); return; }
              const next = window.prompt("Rename this bundle:", rec.name);
              if (next == null) return;                       // cancelled, not an empty name
              const nm = String(next).trim();
              if (!nm) { bundleMsg("A bundle needs a name."); return; }
              if (nm === rec.name) return;
              // Same collision rule as saving, excepting this bundle so a rename
              // that only changes case is not refused against itself.
              if (B.nameCollides(nm, B.listBundles(), id)) {
                bundleMsg(`You already have a bundle called "${nm}".`); return;
              }
              const r = B.renameBundle(id, nm);
              if (!r.ok) { bundleMsg("That bundle could not be renamed."); return; }
              renderSavedBundles();
              bundleMsg(`Renamed to \u201C${nm}\u201D.`);
            };
          });

          root.querySelectorAll("[data-delete-bundle]").forEach((btn) => {
            btn.onclick = () => {
              const B = _savedBundles();
              if (!B) return;
              const id = btn.dataset.deleteBundle;
              const rec = B.listBundles().find((x) => x.id === id);
              if (!rec) { renderSavedBundles(); return; }
              if (!window.confirm(deleteBundleConfirmText(rec.name, (rec.affixes || []).length))) return;
              const r = B.deleteBundle(id);
              if (!r.ok) { bundleMsg("That bundle could not be deleted."); return; }
              renderSavedBundles();
              bundleMsg(`Deleted \u201C${rec.name}\u201D.`);
            };
          });
        }
        wireSavedBundles();
        document.getElementById("wz-add-btn").onclick = () => { if (addPriority(add.value)) renderRanked(); add.value = ""; add.focus(); };
        add.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); if (addPriority(add.value)) renderRanked(); add.value = ""; } };
        renderRanked();
      }
      if (state.step === "results") {
        const box = document.getElementById("wz-results");
        const cbar = document.getElementById("wz-cbar");
        // #428 U3 — saving moved to the rail, which renders beside EVERY step
        // (R14). The results step no longer carries a name input or a Save button
        // of its own: one concept, one input (R17).
        // Staleness note (U4): re-solve is view-only — it refreshes the shown
        // build but does not overwrite the saved snapshot until an explicit Save.
        const staleBtn = document.getElementById("wz-staleresolve");
        if (staleBtn) staleBtn.onclick = () => {
          state.loadedStale = false;
          const stale = document.getElementById("wz-stale");
          if (stale) stale.classList.add("wz-hidden");
          refreshResultsEmphasis();
          solve(false);
        };
        // plan 003 U4 — same view-only re-solve for the TWF migration notice. The
        // restored snapshot was solved under the OLD rules, so its off hand may still
        // hold a shield the declaration would now exclude; re-solving is what makes the
        // shown build agree with the declaration the load just turned on.
        const migBtn = document.getElementById("wz-twfmigresolve");
        if (migBtn) migBtn.onclick = () => {
          state.twfMigrated = false;
          const bar = document.getElementById("wz-twfmig");
          if (bar) bar.classList.add("wz-hidden");
          refreshResultsEmphasis();
          solve(false);
        };
        // Per-slot constraint controls (U6), wired by delegation so they survive
        // renderResults re-rendering the box contents.
        if (box) box.addEventListener("click", (e) => {
          // #453 U4 (R9) — the affix-chip overflow expands IN PLACE. Delegated
          // here with the slot controls, and for the same reason: renderResults
          // re-renders the box contents, so a per-element handler would not
          // survive a re-solve.
          const more = e.target.closest("[data-statmore]");
          if (more) {
            // #471 — the stat row is `pd-lines` now (the chip family it replaced
            // was `pd-stats`); the expander is otherwise unchanged.
            const list = more.closest(".pd-lines");
            const open = list && list.classList.toggle("is-expanded");
            more.setAttribute("aria-expanded", open ? "true" : "false");
            if (open) more.textContent = "show less";
            return;
          }
          const ctl = e.target.closest(".pd-ctl");
          if (ctl) {
            const menu = ctl.closest(".pd-row").querySelector(".pd-menu");
            const willOpen = menu.hidden;
            box.querySelectorAll(".pd-menu").forEach((m) => { m.hidden = true; });
            menu.hidden = !willOpen;
            return;
          }
          const act = e.target.closest(".pd-menu button");
          if (!act || act.disabled) return;
          const slot = act.dataset.slot, variant = act.dataset.variant;
          const cur = state.slotConstraints[slot];
          if (act.dataset.act === "free") {
            // Free THIS row: for a list-shaped Ring pin, prune only this row's
            // member (the other ring survives); otherwise clear the whole slot.
            if (cur && cur.type === "pin" && variant) removePin(slot, variant);
            else delete state.slotConstraints[slot];
          } else if (act.dataset.act === "empty") {
            state.slotConstraints[slot] = { type: "empty" };   // slot-level lock clears any pins
          } else if (act.dataset.act === "override" && variant) {
            // #88 U10 (R31) — corrections are created where the player NOTICES the
            // wrong total, which is this row. The picker renders in place rather
            // than navigating away, so the loadout they are questioning stays on
            // screen beside it.
            act.closest(".pd-menu").hidden = true;
            openOverridePicker(act.closest(".pd-row"), variant);
            return;
          } else if (act.dataset.act === "pin" && variant) {
            // #110 (U5/R4) — the deep-dive pin surface refuses a blocked variant
            // too, with the reason inline (no browser dialog: those block the tab).
            if (pinBlockedConflict(state.blocklist, variant)) {
              act.textContent = "Blocked — unblock it first";
              act.disabled = true;
              return;
            }
            applyPinId(state.slotConstraints, slot, variant, slotCardOf); // append (Ring) / replace (single)
          }
          state.constraintsDirty = true; markDirty();
          // refresh the equipped-list badges in place (no re-solve yet)
          if (state.lastRun) {
            state.lastRun.query.slotConstraints = { ...state.slotConstraints };
            // eslint-disable-next-line no-undef
            renderResults(box, { model: state.lastRun.model, result: state.lastRun.result, query: state.lastRun.query, dataset, highs, onAfterRender: afterResultsRender, onRequire: requireOutbidStat, onJump: jumpFromNotice, notesSeen, onNotesOpen: () => { notesSeen = true; }, upgradeBar, onUpgradeBar: rememberUpgradeBar, versions: versionsSeam, characterName: state.characterName });
          }
          if (cbar) cbar.classList.remove("wz-hidden");
          refreshResultsEmphasis();
        });
        const cres = document.getElementById("wz-cresolve");
        if (cres) cres.onclick = () => { if (canAdvance("priorities", state)) solve(false); };
        // The Adjust & re-solve panel (U3/R6) now lives inside #wz-results, under
        // the tab bar, so it is populated + wired by fillAdjustSlot on every
        // renderResults call — not once here (it would not exist yet).
      }
    }
    /** #428 U6 (KTD2) — the generic Continue handler became step-aware rather
     *  than being rewritten. The character step gets the field treatment R7-R11
     *  specify; the pool and priorities steps keep the nudge, because replacing
     *  feedback on steps this plan does not restructure is a change nobody
     *  asked for. */
    function blockFeedback() {
      if (state.step !== "character") { flashBlock(); return; }
      state.requiredShown = true;
      showMissingRequired();
    }

    /** #428 U6 (R8/R10/R11) — outline every unanswered required field and render
     *  ONE message naming them all. Returns the first missing field's host.
     *
     *  Deliberately does NOT scroll or focus: this runs on every render and on
     *  every input while the marks are showing, so stealing focus here would
     *  fight the player mid-edit. R9's scroll-and-focus belongs to the blocked
     *  Continue press alone, which is what `showMissingRequired` adds.
     *
     *  No motion, ever: KD4 replaced the repeating flash the requirements
     *  originally specified because repeated flashing is bounded by WCAG 2.3.1
     *  and is a documented trigger for photosensitive and vestibular conditions. */
    function applyRequiredMarks() {
      const miss = missingRequired(state);
      const msgEl = document.getElementById("wz-charmsg");
      if (msgEl) msgEl.textContent = missingRequiredMessage(state) || "";
      root.querySelectorAll("[data-req]").forEach((el) => el.classList.remove("wz-invalid"));
      let first = null;
      for (const key of miss) {
        const host = root.querySelector(`[data-req="${key}"]`);
        if (!host) continue;
        host.classList.add("wz-invalid");
        if (!first) first = host;
      }
      return first;
    }

    /** #428 U6 (R9) — the blocked-Continue treatment: mark them all, then scroll
     *  the first into view and focus it. */
    function showMissingRequired() {
      const first = applyRequiredMarks();
      if (!first) return;
      if (first.scrollIntoView) first.scrollIntoView({ behavior: "smooth", block: "center" });
      const focusable = first.querySelector("input, select, button:not([disabled])");
      if (focusable && focusable.focus) focusable.focus();
    }

    function flashBlock() {
      const btn = root.querySelector("[data-next]"); if (!btn) return;
      btn.classList.remove("wz-nudge"); void btn.offsetWidth; btn.classList.add("wz-nudge");
    }

    render();
  });
}
