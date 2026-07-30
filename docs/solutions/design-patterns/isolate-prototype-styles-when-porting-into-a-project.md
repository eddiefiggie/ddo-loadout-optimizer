---
title: "Porting a self-contained prototype into an app needs style isolation (global rules + hardcoded colors)"
module: web-ui
date: 2026-07-29
problem_type: design_pattern
component: ui
severity: medium
tags:
  - ddo
  - css
  - prototype
  - design-tokens
  - specificity
  - style-isolation
applies_when:
  - "porting a standalone HTML/CSS prototype into an app with an existing global stylesheet"
  - "retuning a palette via design tokens and expecting the whole app to follow"
---

# Porting a self-contained prototype into an app needs style isolation

## Context

The guided-wizard flow was designed as a self-contained prototype file (its own clean CSS, no inherited rules) and then ported into the live app, which already ships a broad global stylesheet (`web/styles.css`) and the existing `results.js` renderer. In isolation the prototype looked crisp; inside the project it looked "off" — most visibly, the 1–5 stepper circles rendered as **ovals**, and the results surface showed a **mixed palette** after a design-token retune. Both are the same underlying cause: prototype markup now inherits project styling the prototype never had.

## Guidance

When bringing a self-contained prototype into an app with an existing stylesheet, isolate it deliberately on two axes:

1. **Global element rules leak into ported components.** A broad `button { min-height: 44px; padding: 0 16px }` (a touch-target default) applies to every ported `<button>`. Class selectors *win* over element selectors (`.wz-dot` at specificity `(0,1,0)` beats `button` at `(0,0,1)`), so the fix is to make each small component class **explicitly own** the properties the global element rule sets aggressively — set `min-height: 0; padding: 0` (and flex-center) on the small buttons rather than trying to out-specify or `!important` the global. Audit every ported button/input against the global element rules for exactly these size-forcing props.

2. **Hardcoded color literals are unreachable by a token retune.** Driving the palette through CSS custom properties (`--accent`, etc.) only recolors what *references the token*. Any `rgba(...)`/hex **literal** baked into the older stylesheet (glows, gradients, badge backgrounds) is invisible to a `:root` retune and leaves a mixed palette. When retuning, grep the stylesheet for the *old* literal color values and convert them to the token (or the new literal) so the retune reaches everything.

## Why This Matters

A prototype's cleanliness comes partly from having *no* ambient styles; that guarantee evaporates the moment it enters a project. The two symptoms look like unrelated visual bugs but share one root — inherited/parallel styling the prototype was never exposed to — so the durable fix is isolation discipline, not one-off nudges:

- **Oval circles:** `.wz-dot { width:26px; height:26px }` inherited the global `min-height:44px`, forcing 26×44. Same for the 32×32 priority `↑ ↓ ✕` controls. Overriding `min-height`/`padding` on those classes restored true circles/squares (PR #45).
- **Mixed palette:** `results.js`'s CSS hardcoded the app's old cyan `rgba(76,194,255,…)` and violet `rgba(167,139,250,…)` in ~13 places, so retuning `--accent` to the prototype blue left results half-cyan/violet. Converting the literals to the new blue unified it (PR #46).

## When to Apply

- Any time a prototype (or any HTML authored against its own reset) is merged into a codebase with a shared global stylesheet — audit ported controls against global element rules first.
- Any palette/theme change driven through design tokens — first grep for hardcoded occurrences of the *outgoing* color values; the token change will not reach them.

## Examples

Global leak and the class-level fix:

```css
/* global (project) — a touch-target default the prototype never had */
button { min-height: 44px; padding: 0 16px; }

/* ported component: 26x26 intended, but min-height:44px wins on height -> 26x44 oval */
.wz-dot { width: 26px; height: 26px; border-radius: 50%; }

/* fix: the class owns the size-forcing props (class beats element selector) */
.wz-dot { width: 26px; height: 26px; min-height: 0; padding: 0;
  display: flex; align-items: center; justify-content: center; }
```

Token retune misses literals:

```css
:root { --accent: #5b8cff; }              /* retuned cyan -> prototype blue */
.badge { box-shadow: 0 0 12px rgba(76,194,255,0.5); }  /* still cyan — literal, not the token */
/* fix: grep the OLD value and convert */
.badge { box-shadow: 0 0 12px rgba(91,140,255,0.5); }
```

Related: [browse-visibility-for-separate-source-pools](browse-visibility-for-separate-source-pools.md) (another web-ui projection concern).
