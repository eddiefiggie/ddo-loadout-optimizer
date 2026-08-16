# Wiki evidence — utility-proc admissions, first batch (#91 Utility tier)

**Verified:** 2026-08-15 (Chrome-MCP, same-origin from a ddowiki tab, paced)
**Shard:** `data/seed/compendium/utility_procs.json` — dispositions are recorded there per name; this doc holds the batch rulings.

The Utility tier counts each admitted name as exactly 1 (presence). Admission asks one question: **is this a player-felt effect, not flavor or a sentence line?** Magnitudes, proc rates, and uptime are out of scope (#331).

## Batch rulings — 24 admitted

| Ruling page | Names admitted | Effect (verbatim gist) |
|---|---|---|
| [Alignment damage (weapon)](https://ddowiki.com/page/Alignment_damage_(weapon)) (the `Holy` redirect) | Holy, Unholy, Anarchic, Axiomatic | 2d6 alignment damage vs opposing alignment on hit; scaling variants (`Holy 3`) deal Xd6 and also hit Neutral enemies |
| [Vampirism](https://ddowiki.com/page/Vampirism) | Vampirism | "drains a tiny portion of the target's life force whenever it does damage" |
| [Chilling](https://ddowiki.com/page/Chilling) | Chilling | "dealing (x)d6 ice damage on each hit" |
| [Maiming](https://ddowiki.com/page/Maiming) | Maiming | extra untyped damage on critical hit, scaling with crit multiplier |
| [Bane (enchantment)](https://ddowiki.com/page/Bane_(enchantment)) | the 17 standard `<Creature> Bane` names (Aberration, Animal, Chaotic Outsider, Construct, Dragon, Elf, Evil Outsider, Giant, Human, Humanoid, Lawful Outsider, Monstrous Humanoid, Ooze, Plant, Reptilian, Undead, Vermin) | "deals an additional Xd10 Bane (untyped) damage to a specific type of creature" |

All are on-hit/on-crit combat effects a player feels — admission is the accurate reading, and the magnitudes stay unmodelled by design.

## Deliberately NOT admitted in this batch

- **Ghostbane, Feybane, Unnatural Bane** — bane-ish names with their own distinct pages/mechanics; the `Bane (enchantment)` ruling does not cover them. They stay quarantined "unreviewed" until read on their own evidence.
- **Lesser Vampirism** — not a current candidate (no un-dispositioned population entry); no entry invented.
- Everything else (104 names) — quarantined with reason "unreviewed"; the build gate surfaces any new candidate a future harvest introduces.

## Method notes

Same-origin harvest from a ddowiki tab, ~2s pacing, `| = & ?` stripped from captured text. `Holy` redirects to the family page `Alignment_damage_(weapon)` — one page rules four names; same pattern for the Bane family (one enchantment page, creature-type parameterized).
