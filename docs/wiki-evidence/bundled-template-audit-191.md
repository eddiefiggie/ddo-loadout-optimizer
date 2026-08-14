# The four unresolved bundled templates — dispositions (#191)

**Ruled:** 2026-08-13. The 2026-08-08 audit (`docs/plans/2026-08-08-002`) left
four name-intersection hits unclassifiable because each template needs a
type/element argument to render. All four are now settled from carrier
invocations + `action=parse` renders of every distinct invocation, tooltips
read per `bundled-template-values-live-in-the-tooltip-not-the-cell.md`.

| Template | Disposition | Evidence |
|---|---|---|
| `Elemental Resistance` | **DEFECT — bundled compound, now expanded.** | `elemental-resistance.md` (the full ruling + census) |
| `Combustion` | **CLEAN — never invoked on items.** | Item pages carry `{{SpellPower\|Combustion\|N[\|Type]}}` (also spelled `{{Spell Power\|...}}`), whose tooltip states exactly one stat: `Combustion +168: Passive: +168 Equipment bonus to Fire Spell Power.` / `Quality Combustion +39: +39 Quality bonus to Fire Spell Power.` No bundling; sampled values match stored (Theurgy of Summer 168, Legendary Burning Longsword/Manacles 156, Legendary Scarletscale Boots 159, Legendary Memento of Flame Quality 39, The Demon Engine Insight 79). Items whose dataset Combustion is the Potency same-type expansion (Legendary Occultic Circlet, Demogorgon's Reign) carry `{{SpellPower\|Potency\|...}}` on-page — synthetic channel, out of template scope. |
| `Search` | **CLEAN — never invoked on items.** | Item pages carry `{{Skills\|Search\|N[\|Type\|prefix=...]}}`, a single-stat skill bonus; `Search +21: Passive: +21 Competence bonus to the Search skill.` The "Search and Spot" gems carry two separate `{{Skills}}` lines, one per skill. Sampled values match stored (Snakeskin Vest/Sandstorm Glasses/Mind Flayer Nickels 21, Lenses of Logic Insight 11, Keylock Ring 20, Tunneler's Toolkit Quality 5). |
| `Enhancement Bonus` | **RULED — polysemous, stored faithfully, no correction.** | `{{Enhancement bonus\|CODE\|N[\|ML]}}` renders three different grants by type code: `a` -> `+11 Enhancement Bonus: +11 enhancement bonus to Armor Class.`; `w` -> `+9 Enhancement Bonus: +9 enhancement bonus to attack and damage rolls.`; `i` -> `Spellcasting Implement +ML: +ML Implement bonus to Universal Spell Power.` The two stored carriers are both orbs: Thunder-Forged Orb (`\|w\|9` — weapon enh) and Sphere of Waves (`\|i\|15\|28`). Sphere of Waves already carries `Universal Spell Power Implement 28` and `Cold Resistance Enhancement 51` as separate gear-planner affixes, so nothing is missing — its `Enhancement Bonus 15` is the orb's own enhancement bonus, exactly as printed. Most weapons' enhancement bonuses are not stored as affixes at all, so these two records are a gear-planner passthrough inconsistency, not a value defect; deliberately left as stored. |

**Standing caution.** The audit's name-intersection method flags a template
whose NAME matches a stored affix; Combustion and Search show the flag can be a
false positive when items never invoke that template (their values arrive via
`SpellPower`/`Skills`). A future audit hit should check carrier invocations
before assuming the flagged template is the value's source.
