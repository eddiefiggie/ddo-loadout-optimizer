Refactor the crafting and upgrade terminology throughout the DDO Loadout
Optimizer repository.
PROBLEM
The application currently uses “awaken,” “awakened,” and “awakening” as
umbrella terms for several unrelated DDO crafting and customization systems.
That is not accurate DDO terminology.
“Awaken Set Bonus” is official player-facing terminology for Vecna Unleashed
Lost Purpose recipes at the Cannith Repurposing Station. It also appears on
some older, specific Cannith Reforging set-bonus recipes.
It must not be used as the generic term for Dinosaur Bone augments,
Viktranium augments, Sun/Moon augments, Nearly Finished choices, or
Nearly Completed choices.
GOAL
Preserve all solver behavior, mathematical constraints, selectable-set
membership logic, datasets, and optimization results.
Refactor the data model and player-facing language so that each crafting
system uses its correct DDO terminology.
CANONICAL PLAYER-FACING TERMINOLOGY
1. Masterminds of Sharn
System:
- Nearly Finished
- Cannith Reforging Station
Use:
- “Apply Nearly Finished option: {effect}”
- “Finish item with: {effect}”
- “Selected Nearly Finished option”
Do not use:
- Awaken
- Awakened affix
- Awakened item
Use “Unlock Set Bonus” only for an individual recipe that explicitly unlocks
a set bonus. Do not use it for ordinary Sharn selectable-stat upgrades.
2. Vecna Unleashed
System:
- Lost Purpose
- Cannith Repurposing Station
Use the official language:
- “Awaken Set Bonus: {set_name}”
- “Awakened Set Bonus”
- “Change Awakened Set Bonus”
This is the primary modern system where “awaken” should remain.
3. Isle of Dread
System:
- Dinosaur Bone Crafting
- Dinosaur Bone augments
- Scale, Fang, Claw, Horn, and Set Bonus slots
Use:
- “Craft Dinosaur Bone augment”
- “Slot {slot_type} augment: {effect}”
- “Slot Set Bonus augment: {set_name}”
- “Dinosaur Bone Set Bonus augment”
Do not use:
- “Awaken Dino set”
- “Awakened Dino set”
- “Dino awakening”
A Dinosaur Bone host does not awaken a set. It receives a crafted Set Bonus
augment in its Set Bonus slot.
4. The Chill of Ravenloft / Lamordia
System:
- Viktranium Experiment Crafting
- Lamordia augments
- Melancholic, Dolorous, Miserable, and Woeful slots
Use:
- “Craft Viktranium augment”
- “Slot {Melancholic|Dolorous|Miserable|Woeful} augment: {effect}”
- “Viktranium crafting option”
Do not use “awaken.”
5. Magic of Myth Drannor
System:
- Sun and Moon Augments
- Sun and Moon Augment Slots
Use:
- “Slot Sun Augment: {effect}”
- “Slot Moon Augment: {effect}”
- “Replace Sun/Moon augment”
Do not describe these as awakened sets. Although these augments often provide
Artifact or Profane bonuses comparable to old set bonuses, they are augments
and are slotted like augments.
6. Terror of Demogorgon
Use the exact system name:
- “Nearly Completed,” not “Nearly Complete”
Nearly Completed use:
- “Apply Nearly Completed option: {effect}”
- “Select fourth affix: {effect}”
- “Completed with: {effect}”
Catalyst Crafting use:
- “Catalyst Crafting”
- “Create Catalyst version: {result_item}”
- “Required Catalyst: {catalyst_name}”
Do not use “awaken.”
INTERNAL MODEL
Keep the solver’s underlying primitive expansion-neutral.
The current chosen-set-membership mechanism can remain conceptually intact,
but do not call the generic primitive “awakening.”
Prefer neutral internal names such as:
- selectable_option
- selected_option
- selectable_set_membership
- chosen_set_membership
- customization_choice
- crafting_application
- item_transformation
- augment_assignment
Separate the mathematical mechanism from the player-facing crafting language.
For example, Vecna Lost Purpose and an Isle of Dread Set Bonus augment may use
similar solver constraints, but their display actions must be different:
- Vecna: “Awaken Set Bonus: Vol’s Influence”
- Isle of Dread: “Slot Set Bonus augment: The Legendary Dread Isle’s Curse”
CENTRALIZED TERMINOLOGY
Create or extend a centralized crafting-system metadata registry rather than
hardcoding terminology throughout results.js, solver.js, browse.js, and the
UI.
Each customization source should be able to provide metadata similar to:
{
  system_id,
  system_name,
  expansion,
  mechanism_kind,
  action_label,
  result_label,
  slot_type,
  station_name
}
Suggested mechanism kinds:
- selectable_affix
- selectable_set_membership
- augment_assignment
- set_bonus_augment_assignment
- item_transformation
- set_bonus_unlock
The renderer should derive player-facing instructions from this metadata.
REPOSITORY AUDIT
Search the entire repository for:
- awaken
- awakened
- awakening
- awakenable
- chosen-set
- set-crafting
- Nearly Complete
- Nearly Completed
Review:
- web/solver.js
- web/model.js
- web/results.js
- web/alternatives.js
- web/browse.js
- src/
- build_dataset.py
- data/seed/
- tests/
- README and documentation
- coverage disclosures
- Loadout Deep Dive instructions
- paperdoll badges
- Alternatives descriptions
- Item Browser filters and labels
Do not directly edit web/data/items.json. It is generated. Make all schema and
terminology changes in the source pipeline and regenerate the artifact.
BACKWARD COMPATIBILITY
If existing source records use keys such as:
- awakenable_sets
- awakened_set
- awaken_set
- awakening_station
either migrate them to neutral names or support them temporarily through a
normalization layer.
Do not silently break old seed shards, tests, or imported gear-planner data.
DISPLAY EXAMPLES
Correct:
- Awaken Set Bonus: Legendary Vol’s Influence
- Apply Nearly Finished option: Insightful Intelligence +6
- Slot Set Bonus augment: The Legendary Dread Isle’s Curse
- Slot Melancholic Viktranium augment: Constitution +15
- Slot Sun Augment: Artifact Universal Spell Power
- Apply Nearly Completed option: Quality Charisma +4
- Catalyst Crafting: Create Legendary {item_name}
Incorrect:
- Awaken Dino Set Bonus
- Awaken Viktranium effect
- Awaken Sun augment
- Awaken Sharn stat
- Awaken Nearly Completed option
README COPY CHANGE
Replace language similar to:
“Which set bonus to awaken on a Vecna Lost Purpose item at the Cannith
Repurposing Station, or on a Dinosaur Bone host.”
With:
“Which set bonus to awaken on a Vecna Lost Purpose item at the Cannith
Repurposing Station, or which Dinosaur Bone Set Bonus augment to craft and
slot on an Isle of Dread host.”
Replace:
“Dino Set-Bonus: awaken 1 of 6 sets”
With:
“Dino Set-Bonus: craft and slot 1 of 6 Set Bonus augments”
TESTS AND ACCEPTANCE CRITERIA
Add or update tests proving that:
1. Vecna Lost Purpose results render “Awaken Set Bonus.”
2. Isle of Dread results render “Slot Set Bonus augment.”
3. Lamordia results render “Slot Viktranium augment.”
4. Myth Drannor results render “Slot Sun Augment” or “Slot Moon Augment.”
5. Sharn results render “Apply Nearly Finished option.”
6. Terror of Demogorgon results use “Nearly Completed.”
7. Catalyst items render as Catalyst Crafting transformations.
8. No non-Vecna modern system displays “awaken,” “awakened,” or “awakening.”
9. Solver selections and objective values are identical before and after the
   terminology refactor.
10. The complete Python and JavaScript test suites pass.
After implementation, provide:
- a list of renamed fields and compatibility aliases;
- a summary of every player-facing label changed;
- test results;
- confirmation that optimization behavior did not change.
