# `$MOD/prototypes/entity/entities.lua`

## Requested Machine Data

Select prototypes with `type = "assembling-machine"` and retain `name`, `crafting_categories`, `crafting_speed`, `module_slots`, `allowed_effects`, `fluid_boxes`, and `collision_box`. The recipe category must intersect the machine's crafting categories, and fluid inputs/outputs must be compatible with the machine's fluid boxes. Missing module slots should be treated as zero unless the effective prototype data provides a value.

For collision box corners `({x1, y1}, {x2, y2})`, the requested rounded-up dimensions are `ceil(abs(x2 - x1))` by `ceil(abs(y2 - y1))`. For example, the installed Base assembler box from -1.2 to 1.2 yields 3 by 3. Keep raw bounds as well as derived dimensions.

## Current Data And Limits

The installed Base file contains literal assembling-machine prototypes. Assembler 1 has categories and speed but no explicit `module_slots`; assembler 2 has `module_slots = 2`, a broader category list, and a higher speed. This demonstrates why machine options must be per prototype rather than inferred from a single default.

The project does not currently read entity prototypes. The static parser cannot evaluate computed fields or runtime-generated prototypes, and this requested file may not cover every machine declared by mods. Moreover, assembling machines alone do not cover all recipe categories: furnaces, oil refineries, chemical plants, centrifuges, and other production entities have their own categories and capabilities. Begin with this file as requested, then load needed machine families or report recipe categories without any parsed compatible machine.

Do not treat every entity prototype as a normal-play mall product. An entity candidate needs a placeable item and a normal acquisition path for that item (for example, an enabled recipe or a technology-unlocked recipe). Base `infinity-chest` is declared as a hidden `infinity-container`, has no matching recipe or technology unlock in the installed Base prototypes, and should not enter the normal-play candidate set. Its hidden flag is supporting visibility metadata, not the general exclusion rule.