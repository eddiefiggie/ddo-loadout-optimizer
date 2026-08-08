# Wiki evidence — Speed, Striding, and the alacrities

**Verified:** 2026-08-05 (first pass), **superseded 2026-08-07** (Chrome-MCP, interactive)
**Issues:** #154 (this ruling), #134 and #141 (originating reports)
**Plan:** `docs/plans/2026-08-07-001-fix-speed-split-and-material-gate-plan.md`

## Outcome

The 2026-08-05 ruling concluded the attack-speed magnitude was **not recoverable**
and closed the matter. That conclusion is **wrong and is superseded here.** The
magnitude is fully recoverable; the earlier pass misread the evidence.

| Claim | 2026-08-05 | 2026-08-07 | 2026-08-08 |
|---|---|---|---|
| Speed grants melee/ranged attack speed | confirmed | confirmed | confirmed |
| The magnitude is derivable | **no** | **yes** — see the classifier below | yes |
| `Topaz of Swiftness 15%` grants Melee Alacrity | not confirmed | still not confirmed | **yes — 15%, and 15% ranged too** (§3) |
| §2's nine recorded switch rows are transcribed correctly | — | assumed | **verified against every tooltip** (§3) |

---

## 1. What actually went wrong

Two different things are called "Speed" in our data, and they were never the same
thing.

Upstream gear-planner's `affix-synonyms.json` folds **`Striding` into `Speed`**:

```json
{"name": "Speed", "synonyms": ["Striding", "movement speed"]}
```

(`site/src/assets/affix-synonyms.json`, pinned commit `ec3e595d`; the parser
stamps the Enhancement type at `data-builder/parse_affixes_from_cell.py:371`.)

In game these are distinct enchantments:

- **`{{Striding|N}}`** — `+N%` movement speed. Nothing else.
- **`{{Speed|MAG}}`** — movement speed **and** melee/ranged attack speed.

Both feed the same movement number, so the planner filed them under one name. Our
dataset inherited the fold, and the attack-speed half vanished.

**Why the earlier pass concluded "unrecoverable."** It observed that the stored
values include 7, 8, 9, 11, 12, 14, 16, 17, 18, 19, 21, 22, 23, 26, 27, 28 — none a
multiple of 5 — and reasoned that if the stored number were movement and the wiki's
`5*X` formula held, `X` could not be derived. The inference was backwards. Those odd
numbers are not movement percentages at all: they are **Roman-numeral ranks**
converted to integers. `Goatskin Boots (level 19)` is `{{Speed|XI}}` and renders in
game as **"Speed XI"** — rank 11, not 11% movement.

## 2. The classifier

Verified 2026-08-07 by reading the **rendered output of the wiki's own template
examples** on `Template:Speed`, rather than reverse-engineering the template source.

### Roman-numeral argument — the argument is a RANK

| Wikitext | Renders |
|---|---|
| `{{Speed\|I}}` | +5% movement, **+1%** melee and ranged attack speed |
| `{{Speed\|IV}}` | +20% movement, **+4%** melee and ranged attack speed |
| `{{Speed\|XIX}}` | **+30%** movement, **+19%** melee and ranged attack speed |

So: `movement = min(5 × rank, 30)`, `attack speed = rank%`.

The movement cap does **not** cap attack speed — `Speed XIX` is 30% movement but
19% attack speed. This is the single most important detail, and it is the one an
implementer would most plausibly get wrong by assuming one cap governs both.

### Optional Type parameter — narrows which alacrity applies

| Wikitext | Renders |
|---|---|
| `{{Speed\|XX\|ranged}}` | +30% movement, **+20% ranged attack speed only** |

`Template:Speed` documents the Type parameter as `melee`, `movement`, or `ranged`.
`movement` suppresses the attack-speed component entirely. A harvest that ignores
the second parameter will over-grant melee alacrity on ranged-only items.

### Arabic-integer argument — the argument is the MOVEMENT PERCENTAGE

Attack speed then comes from a **hand-maintained lookup**, not a formula:

| Wikitext | Renders | Source |
|---|---|---|
| `{{Speed\|27}}` | +27% movement, **12%** attack speed | recorded in the switch |
| `{{Speed\|30}}` | +30% movement, **15%** attack speed | recorded in the switch |
| `{{Speed\|15}}` | +15% movement, **5%** attack speed | **the default — not recorded** |

The recorded table is `18,19→6 · 20→7 · 21→8 · 22,23→9 · 24→10 · 25→11 · 26,27→12 ·
28→13 · 30→15`, everything else `#default→5`.

`Template:Speed` states this outright:

> the formula by which the attack speed percentage of this enchantment is
> calculated is unknown, so it must be added to the template manually for new
> values. If no value has been recorded for an integer, the percentage defaults
> to 5%.

**So a 5% reading is not evidence of a 5% bonus.** Any Arabic magnitude outside the
recorded table is `provenance: defaulted` and must be quarantined — the item keeps
its movement bonus and contributes nothing to alacrity. This is the exclude-until-
verified rule doing exactly its job: the wiki does not know, so neither do we.

The two branches are **not contradictory** — they are two input conventions in one
template, selected by the argument's numeral system.

## 3. Topaz of Swiftness 15% — SUPERSEDED 2026-08-08: it grants 15%

**This section previously ruled that the augment grants no Melee Alacrity and is
"strictly dominated by the 10%". Both claims are wrong.** The augment grants 15%
melee AND 15% ranged attack speed, and it beats the 10% rather than being
dominated by it. Issue #134 was closed on that bad ruling and a player reported
the same defect a third time.

Authoritative source is `Raw data/Item augments`, the page gear-planner scrapes:

| Augment | ML | Wiki effect cell | Links to | Attack speed |
|---|---|---|---|---|
| Topaz of Swiftness 5% | 12 | `Striding +30% Melee Alacrity 5%` | Striding | none |
| Topaz of Swiftness 10% | 16 | `Striding +30% Melee Alacrity 10%` | Striding | none |
| Topaz of Swiftness 15% | 20 | `Speed +30%` | **Speed** | **15%** |

The cell text was read correctly. The mistake was stopping there. The 15% row is
the only one using the `{{Speed}}` template, and its rendered tooltip states the
magnitude outright:

> `Speed +30%`: +30% enhancement bonus to movement speed, **15% bonus to attack
> speed.**

That is `{{Speed|30}}`, and 30 is a **recorded** row in §2's switch table
(`30 -> 15`). §2 already contained everything needed to reach the right answer;
this section simply failed to apply it to itself. "Attack speed" is unqualified —
no Type parameter narrows it — so both melee and ranged.

**The method error, which is the durable lesson.** A wiki effect cell has two
layers. The visible text names the enchantment; the tooltip behind it carries the
numbers. When a template bundles several stats under one name, reading only the
visible layer silently drops every stat not spelled out in the cell. Upstream
gear-planner scrapes the visible layer, which is why its catalog cannot settle
this and why `{{Speed}}` items lost their attack-speed half in the first place.
See `CONCEPTS.md` -> Rendered-value authority.

**Also corrected here:** the 2026-08-05 pass cited an empty `insource:` search as
evidence of absence. That check is unreliable — `insource:` is **disabled** on
this wiki and returns empty even for strings demonstrably present (`"Topaz of
Striding"` is on a live page and returns nothing). It should not have been cited
either time.

### Verified 2026-08-08 — the switch table needs no correction

All 30 distinct invocations in the shard were rendered in one `action=parse` call
and stored as snapshots. Every one of §2's nine recorded Arabic rows matched its
tooltip, as did every Roman rank and the ranged-only Type parameter. The
transcription in §2 is correct as written.

`speed_split.check_against_snapshots()` now asserts this on every build, so a
future divergence between our derived values and the wiki's rendered text fails
loudly instead of waiting for a third player report.

## 4. Consequences

- `Speed` in our dataset is the **movement** stat. It is correctly not satisfying
  alacrity targets; the bug is that items with the real Speed enchantment lost their
  attack-speed half, and that the name invites the wrong expectation.
- Renaming is warranted: `Striding` and `Movement Speed` are the same stat and should
  alias; `Speed` is not a stat at all but an enchantment granting three of them, which
  is the umbrella case `src/umbrella.py` already handles.
- A harvest must capture **both** template parameters, not just the magnitude.
