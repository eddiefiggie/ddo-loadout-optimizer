---
title: Deploying a build-step static site to GitHub Pages (web/ as site root)
module: deploy
date: 2026-07-25
problem_type: developer_experience
component: tooling
severity: medium
tags:
  - github-pages
  - deployment
  - static-site
  - github-actions
  - ddo
applies_when:
  - "Deploying a static site to GitHub Pages, especially one with a generate/build step"
  - "A subdirectory (not the repo root) holds the deployable site"
  - "Vendored WASM/binary assets or generated data need to reach the live site"
---

# Deploying a build-step static site to GitHub Pages (web/ as site root)

## Context

The DDO Loadout Optimizer is a static site under `web/` whose dataset is *generated* by a Python step (`build_dataset.py` → `web/data/items.json`), and it vendors a 3.4 MB WASM solver. It ships to GitHub Pages and must redeploy on every push to `main`. This note captures the working setup and the one non-obvious gotcha that cost real debugging time.

## Guidance

**1. Make the deployable directory self-contained, then upload only that directory.** Generate data *into* `web/` (the dataset writes to `web/data/items.json`, `build_dataset.py:OUT_PATH`) and fetch it with a **page-relative** URL — `web/app.js` requests the dataset relative to the served page (resolving to `web/data/items.json` locally and to the site root on Pages), never reaching up out of the deployable directory. Then the site root is `web/`, and the same directory serves identically under a local `python3 -m http.server` (open `/web/`) and on Pages (where it *is* `/`).

**2. Use an Actions Pages workflow that builds, tests, then deploys.** `.github/workflows/deploy.yml`: `actions/checkout` → `actions/setup-python` → run the generator → run tests → `actions/configure-pages` → `actions/upload-pages-artifact` with `path: web` → `actions/deploy-pages`. Trigger on `push: branches: [main]` plus `workflow_dispatch`; grant `pages: write` + `id-token: write`.

**3. Enable Pages with the Actions source explicitly** — creating the repo does not enable Pages, and the first deploy fails without it: `gh api -X POST /repos/<owner>/<repo>/pages -f build_type=workflow` (do it after `gh repo create`, before or right after the first push; re-run the workflow once enabled).

**4. THE GOTCHA — uploading `web/` makes `web/` the site ROOT, so live paths drop the uploaded-dir prefix.** A file at `web/model.js` in the repo serves at `https://<user>.github.io/<repo>/model.js` — **not** `.../web/model.js`. Likewise `web/data/items.json` → `.../data/items.json`. Verifying the live site by curling `/web/...` returns 404s and looks like a broken deploy when it is fine.

**5. Commit vendored binaries; you may gitignore generated data.** The vendored `web/vendor/highs.wasm` (3.4 MB) is committed so it lands in the artifact. `web/data/items.json` is gitignored because CI regenerates it every run (`edit the pipeline, not the JSON`).

## Why This Matters

The `web/`-as-root path resolution (#4) is invisible in the repo layout and silently shifts every asset URL. Without knowing it, a green deploy reads as broken because the paths you'd guess (`/web/foo.js`) 404. Getting #1 right — a self-contained directory fetched relatively — is what lets local dev and Pages share one directory with zero path branching.

## When to Apply

Any GitHub Pages deploy where the site lives in a subdirectory and/or needs a generate/build step. The self-contained-directory + upload-that-directory pattern generalizes to any static host that serves an uploaded folder as root.

## Examples

The workflow (`.github/workflows/deploy.yml`), abridged:

```yaml
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: python3 build_dataset.py        # writes web/data/items.json
      - run: python3 tests/run_tests.py
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: web }                  # <-- web/ becomes the site ROOT
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: github-pages   # (the actions/deploy-pages step also exposes a page_url output)
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Enable Pages once, then push:

```
gh api -X POST /repos/<owner>/<repo>/pages -f build_type=workflow
git push origin main    # triggers build + deploy
```

Live path mapping (repo path → live URL under `https://<user>.github.io/<repo>/`):

```
web/index.html        -> /
web/model.js          -> /model.js          (NOT /web/model.js)
web/vendor/highs.wasm -> /vendor/highs.wasm
web/data/items.json   -> /data/items.json
```
