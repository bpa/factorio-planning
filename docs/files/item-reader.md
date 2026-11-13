# `item_reader.py`

## Current Role

`read_crafting_data(data_dir, packages, technologies)` reads recipe, item, production-machine, module, and beacon prototypes in package order. Later definitions replace earlier definitions with the same name. The reader selects `normal`, then `expensive`, then top-level recipe data without combining variants.

The reader normalizes item and fluid ingredients/results, legacy `result`/`result_count`, ranges, probabilities, categories, recipe flags, and energy. It maps technology unlocks, computes normal-progression availability from enabled/unlocked state plus hand crafting or a compatible machine, and keeps visibility separate from availability. Item subgroup/visibility metadata and fluid-only recipes are retained. The catalog contains machine categories, speed, module/effect limits, fluid ports, rounded collision-box footprint, module effects, and beacon transmission fields. `read_item_graph` remains as an item-only compatibility wrapper.

## Current Boundaries

- Static extraction does not execute Lua functions, `require`, loops, or computed prototype values.
- Machine coverage is limited to the supported families and configured `prototypes/entity/entities.lua` path.
- The page displays production metadata but does not yet calculate machine counts, output rates, module/beacon bonuses, or fluid connection budgets.

The [implementation plan](../crafting-page-plan.md) tracks remaining planner work; preserve package ordering and later-definition-wins behavior.