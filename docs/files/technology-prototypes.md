# `$MOD/prototypes/technology.lua` And Updates

Technology prototypes hold `effects`, including `unlock-recipe` entries with recipe names. They also carry prerequisite and research-cost fields consumed by the existing technology planner. The current technology payload does not expose effects, although statically parsed raw prototypes retain them.

For crafting eligibility, derive a recipe-to-technology index from raw effects and merge it in package order. Keep the existing supported static technology update behavior. Update scripts can contain arbitrary Lua; the current reader only applies a narrow set of direct static assignments, so unsupported modifications must remain documented rather than being assumed evaluated.