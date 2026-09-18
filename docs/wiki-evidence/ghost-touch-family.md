# Wiki evidence — the Ghost Touch family: what is one mechanic, and what is not (#746)

**Harvest:** in-app Browser pane, same-origin read of ddowiki, 2026-09-18.
**Snippet:** `scripts/browser/read_ghost_touch_family_pages.js`, plus reads of
`Incorporeal` and `Miss chance`.
**Pages:** `Ghost Touch`, `Ghostly`, `Ethereal`, `Ghostbane` (all four returned;
none missing, none carrying tooltip-hidden values — these are plain enchantment
pages and the numbers are in the visible text).

---

## The ruling, in one line

**The mint the issue proposed is REFUSED. A narrower one is licensed, and the
issue's own third open question is answered.**

The four names are not tiers of one mechanic at different magnitudes — the shape
`Blurry`/`Lesser Displacement` -> `Concealment` has. They share one component and
differ in kind beyond it.

---

## What each page says

| | Verbatim effect |
|---|---|
| `Ghost Touch` | "An [[incorporeal]] creature's 50% chance to avoid damage does not apply to attacks with ghost touch weapons or ammunition." |
| `Ethereal` | "Equipping this item causes your hands and weapons to become partially [[incorporeal]]. Your melee attacks do not roll a miss chance for Incorporeal targets." Note: "although the tooltip says 'melee attacks', it also affects ranged attacks as well. Tested as of [[Update 74]]." |
| `Ghostly` | "This property makes the wielder's melee and ranged attacks able to hit [[Incorporeal]] targets. **Additionally, enemies suffer a 10% [[miss chance]] against the wielder** due to [[incorporeal]]ity. **The wielder also gains +5 [[enhancement bonus]] to [[Hide]] and [[Move Silently]] skills** (stacks with [[competence bonus]])." |
| `Enhanced Ghostly` | As `Ghostly`, with **15%** in place of 10%. Same +5 Hide / Move Silently. |
| `Ghostbane` | "Passive: Attacks from this weapon bypass the [[miss chance]] of [[incorporeal]] creatures". **Plus** "On hit: Additional Xd10 damage vs. Undead" (and vs. Incorporeal pre-U45). |

**Shared by all four:** your attacks bypass the incorporeal miss chance.
**`Ghostly` alone adds:** a 10% (15% enhanced) incorporeal miss chance *for you*,
and +5 enhancement Hide / Move Silently.
**`Ghostbane` alone adds:** on-hit damage dice vs. Undead.

There is also a **scope** difference the prose makes explicit: `Ghost Touch` and
`Ghostbane` are *weapon* enchantments and bypass "with ghost touch weapons or
ammunition"; `Ethereal` and `Ghostly` are worn items letting "any of their
weapons defeat Incorporeal."

## Why the proposed mint is refused

Minting one shared stat at per-tier magnitudes asserts the names are the same
effect measured differently. `Blurry` (20) and `Lesser Displacement` (25) are that
— one mechanic, two numbers. These four are not: `Ghostly` is strictly more than
`Ethereal`, `Ghostbane` is strictly more than `Ghost Touch`, and two of the four
are weapon-scoped. A single stat would erase all of it.

The issue's own 2026-09-11 sweep called minting "a *stronger* claim than the
satisfy-any set, not a weaker one." That is right, and the claim does not hold.

## What IS licensed: the bypass is one mechanic, and the wiki says so in one place

`Incorporeal`, section **"Bypassing the incorporeal miss chance"**, lists every
gear source of the mechanic in one hub section:

> * [[Ghost Touch]] and [[Ghostbane]] weapons bypass the Incorporeal penalty.
> * Players can wear an [[Ethereal]] or [[Ghostly]] item to have any of their weapons defeat Incorporeal.
> * Named Augments: ML1 (Red) Ruby of Ghostbane; ML8 (Green) Wraithborn Emerald; ML30 (Green) Legendary Wraithborn Emerald

This is the same shape as the `Helpless` hub page that licensed #305 — a single
page listing every source of one mechanic, which is the equivalence statement a
mint needs. So:

- **All four names belong to the bypass family.** `Ghostbane` was an open question
  in the issue; it is in, for the bypass.
- **The reporter's worked example is wiki-confirmed.** `Wraithborn Emerald` (ML 8)
  and `Legendary Wraithborn Emerald` (ML 30) are listed side by side as sources of
  the same mechanic, which is exactly the "free upgrade" they described.

### And the same section states an EXCLUSION

> **Tip**: Incorporeal Bane items increase the damage dealt to incorporeal enemies,
> regardless of their race. However, **in itself, this enchantment does not allow a
> weapon to bypass incorporeal miss chance.**

So `Greater Incorporeal Bane` (2 carriers) and `Lesser Incorporeal Bane` (1) must
**not** join the family, despite reading like they belong. Recorded because a
name-similarity sweep would have pulled them in; the wiki rules them out by name.

## The issue's third open question, answered

The 2026-09-11 sweep flagged a third case and left it open:

> "`Dusk` to `Lesser Displacement` is a third case worth its own look. `Dusk` is in
> the counting set and mints nothing... Whether `Dusk` is a lower concealment tier
> is, again, a wiki question."

`Miss chance` answers it, in the same list that states the two magnitudes already
shipped:

> Concealment — [[Dusk]] 10%, [[Blurry]] 20%, [[Lesser Displacement]] 25%,
> [[Displacement]]/[[Shadow Walk]]/Blindness 50%

**`Dusk` is Concealment 10%.** It is the same mechanic as the two already minted,
at a lower magnitude, so it takes the identical treatment under the identical
Concealment-page sentence about bonus type. Nothing new is inferred.

## Incorporeal is its own miss-chance axis, not Concealment

Worth pinning, because treating `Ghostly`'s 10% as Concealment would be wrong and
is the obvious mistake:

> The following game mechanics grant you a miss chance: [[Dodge bonus]],
> [[Incorporeal]]ity, [[Concealment]], [[Missile Deflection]]
> Your miss chance is always checked in order of Dodge, then Incorporeal, then
> finally Concealment.
> D   (100-Dodge)/100 · C   (100-Concealment)/100 · I   (100-Incorporeal)/100
> ∴ Miss chance %   (1-(D*C*I))*100

Three separate multiplicative axes. `Ghostly` is listed under **Incorporeality**
(10%), `Enhanced Ghostly` under 15%. The `Ghostly` page agrees: its 10% "stacks
with Concealment" but, per the Update 14 developer note, no longer stacks with
other sources of incorporeal miss chance — one bucket among incorporeal sources,
separate from the Concealment bucket.

---

## What shipped from this ruling

Two composite entries, both with value AND bonus type stated verbatim by the wiki:

- **`Dusk` -> `Concealment 10 Enhancement`** — 24 carriers, previously crediting
  nothing, and the third of the three concealment tiers.
- **`Ghostly` / `Enhanced Ghostly` -> `Hide +5 Enhancement`, `Move Silently +5
  Enhancement`** — 112 carriers previously crediting nothing.

The `(stacks with competence bonus)` parenthetical is a live cross-check, not
prose: `Hide` and `Move Silently` carry Competence on 62 and 59 records and no
Enhancement at all, so minting Enhancement opens a fresh bucket that stacks beside
Competence — what the wiki says happens, and wrong under any other type.

This alone repairs the reporter's worked example without any interchangeability
claim: once `Ghostly` credits two skills the `Ethereal` carrier does not, the ML 30
Legendary Wraithborn Emerald wins on its own merits rather than being excluded by a
name.

## What is NOT shipped, and exactly what each one needs

Both are real, both are wiki-stated, and each needs a modelling decision this
ruling does not make. **Do not "complete" the composite entry by picking a value
or a type the wiki does not state.**

1. **`Ghostly` 10% / `Enhanced Ghostly` 15% incorporeal miss chance.** The
   magnitude is stated; the **bonus type is not**, anywhere. `Concealment` got
   `Enhancement` from an explicit sentence on its own page ("almost all of them use
   the same bonus type - enhancement"); `Incorporeal` has no counterpart sentence.
   The stat would also be new and need minting into the picker vocabulary the way
   `Concealment` was (KTD4b, `CORE_STATS` union in `build_dataset.py`).

2. **A shared bypass stat across all four names.** Licensed in principle by the hub
   section above, but the component machinery is typed and valued
   (`COMPOSITE_COMPONENT_TYPES`, and the expansion compares `c.value`), while the
   bypass is a **presence with no magnitude**. Encoding it as `value: 1` invents a
   number; adding a `Bool` component type opens a stacking-disposition question,
   since `bonus_type_dispositions.json` carries no `Bool` ruling. The
   `Unconsciousness Range` precedent (#649) is the closest shape — the wiki's own
   phrase, "Incorporeal bypass", appears in the Reaper passage — but that one was a
   rename, and a rename here would destroy the very distinctions this ruling
   establishes.

Until (2) lands, the shipped #752 picker hint remains the disclosure: typing
`ghost` surfaces all four names with carrier counts, stating facts about the
catalog without claiming interchangeability.
