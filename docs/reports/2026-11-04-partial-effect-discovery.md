# Imperial Resonance discovery investigation (#928)

Base: released `f443457a2aeca2e580cbd45994adcb0aef647ff5`, build `11042026.4`.

## Contributor provenance

The parent thread identified galvarian's forum post #397, ID458263:
https://forums.ddo.com/index.php?threads/ddo-loadout-optimizer-your-best-in-slot-gear-proven-by-math.29709/page-20#post-458263

Its 2026-11-04 conversation record reports missing partial autocomplete for
Imperial Resonance while the complete name works. This investigation independently
reproduces the application behavior; it does not claim to have reread the original
post. The web reader returned the forum index instead of the requested post.
Suggested future credit, subject to the owner's forum-update review:
“Thanks to galvarian for flagging Imperial Resonance's search visibility.”
No forum message was sent.

## Reproduction and cause

The released catalog carries `Melody: Imperial Resonance` as an eligible Bool
affix on Elyd Charm and Syne, the Way of the Melody. The normalized vocabulary
contains it in `known`, but not `suggestions` or `presence`: `_PRESENCE_NOISE`
rejects every colon. The actual priority datalist has no matching option for
`imperial`; entering the full name and clicking Add succeeds. Utility's search
reports no matching on/off effect.

Issue #928 remains a broader request for a concrete special-effect example. Its
current body has no evidence justifying a general mechanics rewrite. Existing
word-cap decisions (#228/#231) use Wiki-adjudicated presence exceptions; #443
separates that classification from the default Utility counting roster.

## Narrow local candidate

Add this exact existing name to priority suggestions only when the catalog has a
Bool carrier. Do not add it to `PRESENCE_ALLOW`: that would also change on/off
classification, declaration controls and custom Utility-container eligibility.
Keep the colon/noise and compound-stat filters intact. Do not invent a target
when no Bool carrier exists.

The full vocabulary comparison adds exactly one suggestion, removes none, and
leaves every other serialized field identical. Item data, solver rules, default
Utility membership, custom Utility eligibility and existing full-name input
behavior are unchanged. Build `11042026.5` is a local candidate, not deployed.

## Evidence and limits

- New tests: two discovery tests fail on an exported real base; two compatibility
  guards pass. All four pass with the candidate.
- Isolated Chromium drives the real wizard, checks the priority datalist for
  `melody`, `imperial` and `resonance`, confirms exact-name Add still works, and
  confirms Utility search remains unchanged. No user storage is used.
- The proposed correction addresses priority autocomplete only. It does not fix
  Utility search or assert the effect's conditional sonic bonuses.
- Wiki search returned a non-retryable robots restriction. No restricted access
  was bypassed. Presence admission and any numeric mechanics need separately
  obtained direct Wiki/official evidence before expanding this scope.

Keep #928 open: this bounded discovery change cannot close its broader mechanics
question. No remote publication or issue mutation is part of this investigation.
