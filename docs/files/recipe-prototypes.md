# `$MOD/prototypes/recipe.lua`

## Relevant Fields

Recipe prototypes provide `name`, `categories`, `ingredients`, `results` or legacy `result`/`result_count`, `energy_required`, availability field `enabled`, and visibility fields such as `hidden` and `hide_from_player_crafting`. The installed Base recipe file uses plural `categories`. The file contains many `enabled = false` entries; technologies can unlock these via `unlock-recipe` effects.

The crafting reader consumes item and fluid ingredients/results, chooses one effective variant (`normal`, then `expensive`, then top-level), and retains categories, energy, enabled/visibility flags, productivity permission, ranges, and probabilities. Recipe unlocks are joined from technology effects. It retains fluid-only recipes in the prototype catalog and attaches item-producing recipes to item graph nodes.

## Parsing Guidance

Preserve item/fluid type and quantities, all relevant outputs, categories, `energy_required`, `allow_productivity`, availability, and visibility metadata. Recipe time is in seconds at crafting speed 1; an entity's crafting speed scales it. The official API says `hidden` hides a recipe from crafting menus and other recipe-selection lists; it does not mean the recipe or its products are unavailable in normal play. `hide_from_player_crafting` only hides it from the player's crafting screen; machine selection remains available. Determine gameplay availability from startup enabled state, technology unlocks, and a valid production path. A UI may separately choose to omit hidden entries from default suggestions. Fluid recipes cannot be hand-crafted and require a compatible machine with suitable fluid boxes.

When multiple recipes can produce an item, choose one applicable recipe rather than summing its alternatives' inputs. A selected multi-output recipe is one production line; its outputs must be credited jointly toward mall targets. Do not combine old `normal` and `expensive` variants as simultaneous recipes.

References: [RecipePrototype API](https://lua-api.factorio.com/latest/prototypes/RecipePrototype.html), [Crafting](https://wiki.factorio.com/Crafting), and [Time](https://wiki.factorio.com/Time).

Static parser caveat: recipes created through functions or computed expressions may not be fully represented by literal prototype extraction.