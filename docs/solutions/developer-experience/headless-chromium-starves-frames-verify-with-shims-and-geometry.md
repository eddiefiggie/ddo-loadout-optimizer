---
module: tests
component: browser verification harness
problem_type: false-negative
tags: [headless-chromium, virtual-time, requestAnimationFrame, scroll-event, elementFromPoint, browser-verify]
applies_when: >
  Driving the real app in headless Chromium with --dump-dom and
  --virtual-time-budget to verify anything that depends on a rendering frame:
  requestAnimationFrame loops, scroll events, IntersectionObserver, or hit-testing
  with elementFromPoint.
---

# Headless Chromium under virtual time never runs a frame — shim what needs one, and check your geometry before blaming it

## The problem

The browser-verification loop this repo relies on runs headless Chromium with
`--virtual-time-budget` and reads the DOM back. Timers advance; **the
update-the-rendering step never runs.** Three things that live in that step
therefore never happen, and each one first read as a product bug:

| what | how it looked | what it was |
|---|---|---|
| `requestAnimationFrame` | `yieldToPaint` waited exactly `PAINT_STALL_FALLBACK_MS`; an autoscroll loop scrolled one frame and stopped | rAF callbacks are never delivered (#578 already documents the hidden-tab form of this) |
| `scroll` events | `window.scrollBy` moved the page 104px and a `scroll` listener never fired — a wheel-follow handler "did nothing" | scroll events are dispatched from the rendering step; `scrollY` still changes |
| `elementFromPoint` | returned `null` for every row; a drop indicator never appeared and drops never committed | **not** the environment: the rows were 1100px down the document after a `scrollTo(0,0)`, and `elementFromPoint` is `null` outside the viewport *by spec* |

The third is the trap inside the trap. Two real environment limits made the
third look like one too, and "headless is flaky" would have stopped the
investigation at a wrong answer. `elementFromPoint(1, 1)` returning `HEADER`
was what showed hit-testing works — the harness was asking about points it had
scrolled off screen.

## The method

1. **Prove which it is before touching the code.** Count the primitive directly:
   add a bare `scroll` listener and report the count; call `elementFromPoint` on
   a static element that is certainly on screen; report `getBoundingClientRect`
   and `innerHeight` next to every hit-tested point. One run, one answer.
2. **Shim what the rendering step owns**, so the code path is *observed* rather
   than reasoned about: replace `requestAnimationFrame`/`cancelAnimationFrame`
   with `setTimeout(fn, 16)` on the app window; after a programmatic scroll,
   `dispatchEvent(new Event("scroll"))`. The app resolves these from the global at
   call time, so a shim installed after load reaches closure code.
3. **Fix the geometry**: `scrollIntoView` the element under test before
   hit-testing, and re-do it before every scenario that scrolls.
4. **State the boundary in the PR.** With the shims, the handler's behaviour is
   observed; that the browser *produces* the frame, the event, or the callback is
   relied on from the spec. Say which is which — "verified in Chromium" without
   that sentence overclaims.

Tried and not needed: `--run-all-compositor-stages-before-draw` and
`--headless=new` changed nothing for hit-testing, which was correct all along.

## A harness trap that is not about the browser

`pkill -f "http.server 8771"` matches the command line of the shell running the
script that contains it, and kills that shell — everything after the `pkill`
silently never runs, and the tool reports exit 144. It truncated three
compound commands in one session before it was noticed; `; true` does not help
because the shell is gone. Kill by port (`fuser -k 8771/tcp`) or anchor the
pattern to the interpreter (`pkill -f "^python3 -m http.server"`).
