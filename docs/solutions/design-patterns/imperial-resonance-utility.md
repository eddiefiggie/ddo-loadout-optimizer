---
module: Utility
component: presence eligibility and scoring
problem_type: design decision
tags: [utility, imperial-resonance, opt-in]
applies_when: changing Imperial Resonance discovery or Utility eligibility
---

# Imperial Resonance: opt-in carrier preference

Ed approved favoring gear carrying `Melody: Imperial Resonance`, without assigning
numerical or conditional sonic benefits. This is a product decision about an
existing catalog Bool marker, not a new mechanics adjudication. Item records,
sonic stats, and conditional rules are unchanged. Direct Wiki access was blocked;
no new Wiki evidence is asserted by this change.

The original discovery report is attributed to galvarian, forum post #397,
ID458263, in [the Optimizer thread](https://forums.ddo.com/index.php?threads/ddo-loadout-optimizer-your-best-in-slot-gear-proven-by-math.29709/page-20#post-458263).
Autocomplete was separately repaired by #998. This change supports adding the
named effect to the Utility container and pursuing its existing Bool presence.
It does not resolve the broader mechanics discussion in #928.

Admission requires both the mirrored presence allow lists and the curated counting
rosters. The default order explicitly excludes this opt-in name. `buildModel`
also removes it from runtime counting unless the supplied container selects it,
before dominance and candidate filtering: otherwise incidental carriers would
change default receipts even when the default order did not include the name.
The shared stamped set is never mutated. Existing defaults, empty containers,
and unrelated saved custom containers retain their behavior. Explicit ordinary
priority targeting remains available.

Tests exercise the actual catalog, model, and HiGHS solver, including both carriers,
deduplication, missing carriers, default-program compatibility and absence of added
sonic buckets. Colon noise and compound-stat exclusions remain intact.
