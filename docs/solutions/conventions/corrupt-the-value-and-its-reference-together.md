---
title: "Corrupt the value and its reference together — an isolated corruption only tests the comparison"
module: build-pipeline
date: 2026-08-08
problem_type: convention
component: tooling
severity: high
tags:
  - ddo
  - build-gate
  - integrity-gate
  - verification
  - negative-test
  - snapshot-verification
  - self-consistency
  - data-pipeline
applies_when:
  - "Writing the negative test that proves a new build gate or integrity check actually fails"
  - "A guard asserts a derived value against a captured reference — a snapshot, fixture, golden file, or cached render"
  - "A reference is stored keyed by an identity (an invocation, id, or version) that nothing in the guard re-derives"
  - "A batch of corruption tests all went red and that is being treated as proof of coverage"
  - "Reviewing a guard whose branches are asymmetric in what they assert against"
---

# An isolated corruption tests the comparison; only a consistent one tests the binding

## Context

This repo already has a rule for new build gates:
`docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md`. Corrupt the input
the gate exists to reject, confirm it goes red, restore, confirm it goes green again. #169
followed that rule as diligently as it has ever been followed here — its PR records **eight
corruptions of the real shards, eight red builds, restored green and byte-identical**.

The guard in question is `check_against_snapshots` in `src/parrying_split.py:152`. It exists
because `Parrying` is a folded enchantment name, not a stat, and its stored magnitude is not
always the granted amount: `{{Parrying|N}}` grants N, while `{{Parrying|R}}` is a *rank* —
I grants 1, IV grants 2, VIII grants 4. Nineteen items store the number `4` and one of them
is Roman IV. So every derived value is asserted, on each build, against a stored verbatim
snapshot of the wiki's own rendered tooltip for that invocation.

An adversarial code-review pass then constructed a ninth scenario that none of the eight
covered, and it was real.

The Arabic branch read the derived value and the snapshot's tooltip and compared them
(`src/parrying_split.py:238-245`):

```python
if value.get("armor_class") != stated_ac:
    problems.append(
        f"{title}: derived armor_class={value.get('armor_class')!r} but the "
        f"tooltip states {stated_ac!r} for {raw!r}")
```

Nothing checked that the snapshot belonged to the invocation it was filed under. For an
Arabic invocation the guard therefore proved *our number equals the number written in this
tooltip* — internal consistency, not correctness. Reproduced by running the pre-fix code
against a shard where `{{Parrying|4}}` is filed with the tooltip for `Parrying +6` and the
derived value is 6:

```
{'checked': 1, 'compared': 1, 'problems': []}
```

Clean. A 6 ships to every Parrying-4 item and the build stays green.

The sibling **Roman** branch did not have the hole, and it did not have it by accident of
design rather than by intent. It asserts against an independent lookup
(`ROMAN_MAGNITUDE = {"I": 1, "IV": 2, "VIII": 4}`, `src/parrying_split.py:66`, consumed at
`:265`), which binds the magnitude to the version identity. That lookup exists because a
Roman rank does *not* state its own magnitude — not because anyone was thinking about
mis-filed snapshots. The Arabic branch had no external anchor for the opposite reason:
Arabic looks self-describing. `{{Parrying|4}}` obviously means 4, so nobody wrote the
assertion that says so.

**Why eight red builds were not proof.** Every one of the eight corruptions broke a single
field in isolation — a value moved without its tooltip, or a tooltip moved without its
value. Any value-versus-reference comparison catches that *by construction*: the two sides
disagree because only one of them moved. What the eight never did was move the value and its
reference **together**.

## Guidance

**1. Say out loud what your comparison proves.** A guard that compares a derived value
against a captured reference proves the two agree. It proves the value is *correct* only if
something independently binds the reference to the identity it is filed under. Write that
sentence about your own guard before you trust it; if you cannot name the binding, there
isn't one.

**2. Include at least one consistent corruption in the negative-test set.** Ask "what if the
reference itself was captured wrong?" and corrupt both sides together. That is not an exotic
adversarial case — it is what a real mis-harvest looks like. A bad harvest writes the value
and the snapshot from the same wrong source, so they agree with each other and disagree with
reality. The isolated corruptions are the artificial shape; the consistent one is the
realistic shape.

**3. Bind the reference to the identity.** The fix (`src/parrying_split.py:247-259`) is four
lines and an explanation of why they exist:

```python
if version.isdigit():
    # Arabic states its own magnitude: `{{Parrying|4}}` renders "+4". Tie
    # the two together, or the guard only proves a tooltip agrees with
    # itself. Without this, a snapshot harvested under the wrong key —
    # `{{Parrying|4}}` paired with the +6 tooltip — compares clean and
    # ships 6 to every Parrying-4 item with the build green.
    if stated_ac != int(version):
        problems.append(
            f"{title}: {raw!r} is Arabic, so it must state +{version}, but "
            f"its tooltip states +{stated_ac} armor class — the snapshot is "
            "paired with the wrong invocation")
```

**4. Pair the unit test with a whole-shard invariant.** The unit test
(`tests/test_parrying_split.py:377`) proves the branch fires on a fabricated mis-pairing.
The invariant (`tests/test_parrying_split.py:391`) walks every shipped Arabic snapshot and
asserts it states its own version, so the property holds over real data rather than over one
constructed example.

**5. The tell: an anchored branch beside an unanchored sibling.** If one branch of a guard
compares against an external anchor — a lookup table, a checksum, a name embedded in the
payload — and a sibling branch does not, the unanchored branch is where this hole lives. The
anchored branch usually got its anchor for an unrelated reason, which is exactly why the
asymmetry does not read as suspicious at review time. It should.

**6. This extends the prove-a-guard rule; it does not replace it.** Following that rule was
necessary and it was not sufficient. All four of its existing rules were satisfied here: the
guard was watched failing (rule 1), it refuses to inspect nothing and reports `compared`
separately from `checked` so a shard that resolved no snapshots cannot pass
(`src/parrying_split.py:278-287`, rule 2), the two-representation trap was documented, and
each shard the guard covers was wired and confirmed non-zero (rule 4). The eight red builds
were real red builds. The addition is about the *shape* of the corruptions, not their count:
**a corruption set made entirely of isolated breaks tests only the comparison.**

## Why This Matters

The failure mode is green, and green is the dangerous colour. A mis-filed snapshot does not
produce a gap, a parse error, or a disagreement anyone can see — it produces a confident
number, and on a tool whose promise is "provably the best loadout" a wrong number is
indistinguishable from a right one once it is sitting in a finished gear set.

The blast radius is larger than one item because of a design choice that is otherwise
correct. `bundled-template-values-live-in-the-tooltip-not-the-cell.md` establishes that
snapshots are taken **per invocation, not per item** — the tooltip is a pure function of the
wikitext, and collapsing many items onto few invocations is what makes re-checking
affordable against a source that throttles after roughly eight rapid calls. The same
collapse means one snapshot filed under the wrong key is wrong for every item sharing that
invocation. Parrying covers 139 items.

There is also a process observation worth keeping, because it is the second time in two days
it has held. The hole was found by an adversarial reviewer, not by the author — the same as
the structural-representation miss recorded as the second case study in
`prove-a-guard-fails-before-trusting-it.md`. Author-side, the consistent corruption is the
one you are least likely to invent, because you are the person who believes the reference is
right. That belief is precisely what the corruption is testing.

## When to Apply

- Writing or reviewing any guard that compares a derived value against a captured reference:
  a snapshot, a golden file, a fixture, a vendored upstream table, a cached response.
- Designing the negative-test set for such a guard. Enumerate what each corruption moves —
  value only, reference only, both — and refuse to sign off on a set whose "both" column is
  empty.
- Reviewing a guard whose branches are asymmetric in what they assert against. Ask why the
  anchored branch has its anchor; if the answer is unrelated to correctness (a rank table, a
  unit conversion), the sibling branch is probably unprotected.
- Any time a source is described as "self-describing" or "obviously states its own value."
  That is the argument that stops the assertion from being written, and it is an argument
  about the *content* of the reference, not about whether the reference is filed correctly.
- Adding a second artifact that records a fact an existing artifact already records — the
  standing cross-check rule from the bundled-template doc, of which this is the guard-side
  case.

## Examples

**The eight versus the ninth.** Grouping the corruptions run for #169 by what each one moved:

| Corruption | Value | Reference | Caught by |
|---|---|---|---|
| Alter a derived value away from its tooltip | moved | unchanged | value-vs-tooltip compare |
| Drop a shard entry | moved | unchanged | coverage / compare |
| Downgrade a provenance label | moved | unchanged | quarantine branch |
| Swap a version, leave the magnitude behind | moved | unchanged | version-vs-invocation check |
| Make the whole shard `unsourced` | moved | unchanged | `compared == 0` refusal |
| Reword a tooltip into an unknown dialect | unchanged | moved | dialect parse returns None |
| Retype a provenance string by one character | moved | unchanged | unknown-provenance branch |
| Retype one item out of the Insight bucket | moved | unchanged | pinned solver assertion |
| **File `{{Parrying|4}}` with the `+6` tooltip, derive 6** | **moved** | **moved together** | **nothing — passed clean** |

Every row above the rule is caught by construction. The last row is the only one where the
two sides still agree with each other, and it is the only one that reached the shipped data.

**The failure, reproduced.** Running the pre-fix Arabic branch against the mis-paired shard
returns `{'checked': 1, 'compared': 1, 'problems': []}`. Note that `compared` is 1, not 0 —
the vacuous-pass tripwire added in the same PR (`src/parrying_split.py:285`) is satisfied.
The guard genuinely compared something. It compared the wrong two things. With the fix in
place the same shard now yields two problems, both naming the mis-pairing explicitly, and
`compared` stays at 1 — the entry is reported, not skipped, which is what
`tests/test_parrying_split.py:388` pins.

**An open instance of the same shape, verified against the current tree (2026-08-08).** The
sibling module `src/heightened_awareness.py` shipped in the same PR and has the unanchored
Arabic shape with no Roman branch beside it to make the asymmetry visible. Its comparison at
`src/heightened_awareness.py:158-170` is derived-value-versus-tooltip only, and every shipped
invocation is Arabic with the magnitude embedded in the key
(`{{heightened awareness|4}}` → "You gain a +4 Insight bonus to AC"). Running its guard over
a shard where `{{Heightened Awareness|4}}` is filed with a `+6` tooltip and the derived value
is 6 returns:

```
{'checked': 1, 'compared': 1, 'problems': []}
```

There is no equivalent of `tests/test_parrying_split.py:391` in
`tests/test_heightened_awareness.py`. This is a different gap from the tracked #170, which is
about Speed's guard counting `checked` rather than `compared` and so being able to pass
having verified nothing at all; this one compares, and compares the wrong pair. The fix is
the same four lines and the same whole-shard invariant.

**What the Roman branch was doing right, and why it does not generalize for free.** The
anchor at `src/parrying_split.py:264-273` is deliberately a three-entry lookup and not a
formula, because I → 1 breaks every ratio that fits IV → 2 and VIII → 4, and a fitted ratio
would silently produce a number for a numeral nobody checked. That reasoning is about
extrapolation, not about snapshot filing — the mis-pairing protection is a side effect. When
you copy a pattern from an anchored branch, copy the *binding*, not just the branch.

## Related

- `docs/solutions/conventions/prove-a-guard-fails-before-trusting-it.md` — the parent rule this
  extends. Its rules govern **vacuity** (a guard that inspects nothing, or points at the wrong
  source); this one governs **binding** (a guard that inspects the right number of things and
  compares the wrong pair). Following it was necessary and not sufficient.
- `docs/solutions/conventions/bundled-template-values-live-in-the-tooltip-not-the-cell.md` — the
  nearest prior gesture at cross-checking two records of one fact, and the source of the
  per-invocation snapshot design that gives a mis-filed snapshot its blast radius. Note the
  limit it implies: two records **co-derived from the same harvest** do not cross-check each
  other, which is the whole problem here.
- `docs/wiki-evidence/parrying-versions.md` — why the Roman mapping is a lookup and not a
  formula, which is the unrelated reason that branch was accidentally protected.
- `docs/wiki-evidence/speed-tooltip-tracker.md` — the two-link chain (wiki -> snapshot ->
  derived value). A consistent corruption enters at link 1 and is invisible to link 2, which
  is the only link that runs on every build.
- GitHub #170 — the same guard family's *vacuity* twin: Speed counts `checked` rather than
  `compared`, so it can pass having verified nothing at all.
