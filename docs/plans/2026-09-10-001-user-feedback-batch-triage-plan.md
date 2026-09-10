# 2026-09-10 — user feedback batch: triage, evidence and sequencing

**Issues filed:** #740–#747 (eight).
**Raw reports:** `data/bug_reports.txt`, 2026-09-10 divider.

Deliberately carries no build status. `AGENTS.md`: a plan is a decision
artifact and progress lives in git, not in the plan body — so what has shipped
since is readable from the issues and the log, and this document does not go
stale by standing still.

One forum thread, six items from one player plus a reply from a second. This
plan records what was verified, how, and the order the work should land in.
No design change was made in the same breath as the triage — that was the
explicit ask.

## Verification boundary, stated first

Every claim here was checked against the **built dataset** and, where it was a
claim about behaviour, **reproduced through the real solver** by reusing
`tests/parity/capture_golden.js`'s `solveEnv` / `solveFixture` rather than
reasoning about the code.

**ddowiki was unreachable from the working container** — `curl` returns 202 with
zero bytes, exactly as `AGENTS.md` documents. So nothing in this batch is a wiki
ruling. Two items (#740, #741) and one hypothesis (#746) need a same-origin
harvest per `docs/wiki-evidence/harvest-method.md` before anything is built on
them, and each issue says so rather than substituting a plausible number.

## What the batch turned out to be

Six reports from one player plus a reply from a second became **eight** issues —
the message about a near-miss on PRR also carried the Ghost Touch complaint, and
the two want different things. They sort into four kinds, and the kind decides
the sequencing more than the severity does.

| # | Item | Kind |
|---|---|---|
| #740 | Race-restricted gear never filtered | Data gap — needs a harvest first |
| #741 | `Shadow Striker` credits nothing | Data gap — needs a harvest first |
| #742 | Augments cannot be pinned | Missing capability |
| #743 | No slot-reachability answer | Missing disclosure |
| #744 | Priorities reordering ergonomics | UI, no model change |
| #745 | Priority groups | UI, needs a model change |
| #746 | "Any one of these will do" | Missing capability + a wiki question |
| #747 | Stat cap not discoverable | **Already built** |

The single most useful finding in the batch is the last row. Two experienced
players spent a thread working around a feature that already ships, and neither
found it — one settled on the bonus-type skip grid, the other on inflating a
declared credit. Measured, the cap does exactly what they asked for and buys
seven slots doing it. That is a labelling problem, not a solver problem, and it
is the cheapest real win here.

## Four findings worth keeping regardless of what gets built

**A `Bool` is where magnitudes go to die, and it gates two of these reports.** `Shadow
Striker` (#741) stores a compound enchantment as a bare presence flag while its
four numbers sit in the tooltip — the pattern `AGENTS.md` already warns about.
Isolated measurement puts the loss at +3/+3/+15/+5 on the armor alone. Note the
same shape gates #742: `Deconstructor`'s three affixes are all `Bool`, and the
reason no lever reaches that augment is partly that none of them score.

**An upgrade that renames an affix silently un-ranks itself, 58 times.**
`Wraithborn Emerald` carries `Ethereal`; `Legendary Wraithborn Emerald` carries
`Ghostly` (#746). A player who ranks the name they can see is excluded from the
better item by the act of ranking.

Swept: 58 item families rename a counted presence effect across a tier boundary,
and they split cleanly into a **solved half and an unsolved half**. The
`Blurry` to `Lesser Displacement` families are already harmless, because
`web/dataset.js:216-218` mints `Concealment` from both at different magnitudes —
rank `Concealment` and you get whichever tier is better, without knowing either
name. The `Ethereal` to `Ghostly` families have no such join.

That is the most useful thing this batch found, because **it means #746's answer
is probably not the OR-set the issue first proposed**. If the wiki rules the
ghost-touch names are tiers of one mechanic, the fix is the concealment
treatment: one minted stat, values sourced per tier, which also ranks the tiers
against each other instead of treating them as interchangeable. The wiki ruling
is the gate.

The sweep itself should become a guard — "every presence effect that renames
across a tier boundary has been adjudicated" is a claim about a population fully
readable at build time, and it is about twenty lines to assert.

**A name-similarity detector for unvalued compound Bools does not work.**
Recorded so it is not retried: matching Bool affix names against numeric crafted
options by shared tokens finds two rows and **misses `Shadow Striker`**, the case
that motivated it. `Woeful Shadow` and `Shadow Striker` are not similar enough.
The tier-family sweep above is the signal that works; name similarity is not.

**Two group-shaped requests arrived together and mean opposite things.** #745
wants an **ordered block** where every member counts in a fixed relative order.
#746, taken at face value, wants an **unordered alternative set** where exactly
one member needs to count and the solver chooses which. If they end up sharing UI
affordances they must not share semantics — a player who confuses them gets a
silently different solve.

Worth noting the two may not stay symmetrical: per the finding above, #746 is
likely to resolve into a minted shared stat rather than a group at all, which
would leave #745 as the only genuine grouping feature. Do not build a general
group primitive on the assumption that both need it.

## Sequencing

Ordered by value over cost, not by report order.

**First, and independently shippable — #747 plus the disclosure half of #744.**
Label the `min`/`max` inputs as floor and cap, say what a cap does to the
displayed total, and surface the cap at the moment a solve spends a slot for a
marginal gain. Both live in the same Advanced panel. No harvest, no model change,
and it retires the thread's most-discussed complaint.

**Second — #744's move-to-top/bottom.** Smallest change in the batch, removes the
most clicks, needs no layout work. Unify the swap-vs-splice inconsistency between
the buttons and drag while in there.

**Third — the interim disclosures on #740 and #743.** The race field currently
reads as filtering gear when it only picks docent-vs-armor, and the wizard
already says the equivalent sentence for alignment. Per-effect slot reachability
(#743) is buildable now from data the dataset already stamps. Both stop the
reports recurring while the harvests are scheduled.

**Also third, and cheap — the tier-rename guard.** The 58-family sweep above is
about twenty lines and turns "the next renamed presence effect" from a player
report into a build-time review event. It is independent of every ruling it would
surface, so it can land before any of them.

**Fourth — the harvests: #741, then #740.** `Shadow Striker` is one tooltip on a
known carrier and lands in machinery that already exists (`COMPOSITE_COMPONENTS`,
`affix_tooltip.json`). Race restrictions are a whole population and need a curated
shard, a schema field, a model branch and a guard. Do the small one first; it
also exercises the harvest loop before the large one depends on it.

**Fifth — #742 and #746, the capability work.** Both are real, both are larger
than they look, and both benefit from the disclosure work landing first: a player
who can see that Assassinate is not weapon-shaped (#743) stops trying to pin it
there, and a player who can see the whole Ghost Touch family in the picker (#746's
interim) may not need the OR-set at all.

**Last — #745.** The largest scope, touching every consumer of the flat
`priorities` array plus the migration path for every saved build. The
side-car-view variant described in the issue may deliver the actual ask without
any of that, and should be costed before the full model change is.

## Two things deliberately NOT filed

Neither is backlog and neither should be re-raised.

**Weighted or Pareto trade-off modes.** #747 looks adjacent and is not. A stat cap
is a clamp the player sets; a weighted mode is a trade the solver makes without
asking. The distinction is the product, and it is a standing non-goal.

**Merging the Ghost Touch family into one canonical affix name.** `affix_aliases`
exists for one effect spelled several ways. These are, as far as the catalog
knows, several effects that happen to meet one need — merging them would be a data
error even if the wiki later confirms they are interchangeable in play.
