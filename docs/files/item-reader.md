# `item_reader.py`

## Current Role

`read_item_graph(data_dir, packages)` reads `$MOD/prototypes/recipe.lua` in package order, parses recipe prototypes, and lets later definitions replace earlier definitions with the same recipe name. It currently uses `normal` when that field is a table, otherwise the top-level recipe.

The reader normalizes item ingredients and outputs, falling back from `results` to `result`/`result_count`. It creates item nodes for both inputs and outputs and attaches a shared recipe record to each output node. Default recipe energy is 0.5 seconds.

## Current Omissions Relevant To Planning

- Does not retain recipe category, enabled/hidden state, or recipe variants beyond `normal`.
- Filters out non-item ingredients/results, so fluid requirements and products disappear.
- Does not read item prototypes, subgroup, technology unlocks, entities, modules, or beacons.
- Does not normalize probability/min-max output ranges or all modern recipe metadata.

The [implementation plan](../crafting-page-plan.md) extends this reader and its source contracts; preserve package ordering and later-definition-wins behavior.