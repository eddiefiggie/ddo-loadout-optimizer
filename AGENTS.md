# Agent Instructions

DDO Loadout Optimizer — a client-side best-in-slot gear optimizer for Dungeons & Dragons Online. A Python pipeline builds a dataset from wiki-sourced seed data; a static site solves an exact MILP over it in the browser via HiGHS-WASM. Deployed to GitHub Pages from `main`.

See `README.md` for what the tool does and how to run it.

## Institutional knowledge — read before working in a documented area

This repo carries two knowledge stores that exist specifically so problems are not re-solved or re-litigated:

- **`docs/solutions/`** — 32 documented solutions to past problems, organized by category (`conventions/`, `design-patterns/`, `logic-errors/`, `developer-experience/`, `workflow-issues/`, `security-issues/`, `best-practices/`). Each carries YAML frontmatter with `module`, `component`, `problem_type`, `tags`, and `applies_when` — grep those fields to find relevant prior work. Relevant when implementing, debugging, or making a decision in an area these cover.
- **`CONCEPTS.md`** — shared domain vocabulary, 37 entries. Use these names for domain entities and processes rather than inventing synonyms. Relevant when orienting to the codebase or discussing domain concepts.

Two more evidence stores worth knowing:

- **`docs/wiki-evidence/`** — the wiki harvest method and the standing rulings behind contested values. **Read the relevant ruling before re-investigating a value.** Several "obvious" corrections here are recorded as bugs, and at least one value has been ruled on wrongly three times.
- **`docs/plans/`** — the plan behind each milestone. Decision artifacts; progress lives in git, not in the plan body.

## Standing rules

These are non-obvious and each one has cost a real defect.

**Never infer a value.** Every game value traces to the DDO Wiki. If the wiki does not state it outright, it is quarantined and disclosed rather than guessed — a visible gap beats a confident wrong number, because a wrong number is indistinguishable from a right one in a finished loadout. See `docs/solutions/conventions/exclude-until-verified-data-gates.md`.

**A rendered number is not automatically a value.** Some wiki templates render a placeholder when nobody recorded the real number, and a bundled template hides its numbers in the tooltip rather than the visible cell. See `docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md`.

**Prove a guard fails before trusting it.** Corrupt the input a new gate exists to reject and confirm it goes red, then restore. Make it refuse to inspect zero records — and remember that coverage of one data source is not coverage of another. See `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`.

**Prove a new test fails against the pre-change tree.** A fully green suite can cover none of the diff. Export the base commit to a scratch dir, copy the new tests over it, and run them — anything that still passes is covering nothing. Copy the gitignored generated data in first, or the suite crashes and the crash reads as a pass. Deliberate "nothing changed" guards are the exception; every test claiming new behavior is not. See `docs/solutions/conventions/prove-a-test-fails-against-the-pre-change-tree.md`.

**`web/data/items.json` is generated and gitignored.** Edit `build_dataset.py`, `src/`, or the seed data under `data/seed/` — never the JSON.

**gear-planner is the single source of truth for item affixes**, read structurally. Do not re-parse its free text, and do not re-harvest set definitions into a parallel file.

**ddowiki has no server-side transport.** `curl` and WebFetch return empty behind Cloudflare. Harvest only same-origin from a ddowiki tab, pace requests (~1.5s; it throttles persistently after bursts), and strip `| = & ?` from anything returned or the privacy guard blocks the whole result. Full loop in `docs/wiki-evidence/harvest-method.md`.

## Testing

```
python3 tests/run_tests.py                     # Python suite, stdlib-only runner
for t in tests/*.test.js; do node "$t"; done   # JS suite — one file per invocation
```

**Run the JS tests file by file.** `node a.js b.js` executes only the first, which has silently skipped the golden solver check before. CI does this correctly; local sweeps are where it slips.

A golden or parity diff after a data change is sometimes expected rather than a regression — re-ratify it deliberately, never blanket-accept.

## Conventions

- Conventional commit prefixes, classified by intent rather than file type. Data and docs changes that fix broken behavior are `fix:`.
- Work lands through PRs, squash-merged. `main` deploys on every push, so a red build blocks the site.
- Markdown tables are pipe-delimited; no box-drawing characters.
