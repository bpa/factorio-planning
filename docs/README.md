# Crafting Planner Documentation

These documents describe the current data pipeline and the intended evolution of the crafting page.

- [Crafting page intent](crafting-page-intent.md): user workflow, scope, and configuration semantics.
- [Data relationships](data-relationships.md): how items, recipes, technologies, machines, modules, and beacons relate.
- [Implementation plan](crafting-page-plan.md): an incremental plan for the missing planner capabilities.
- [Source and input file notes](files/): one document per relevant reader or prototype input.

The codebase uses a static Lua-table extractor, not Factorio's data-stage runtime. Parsed values are only as complete as the static prototype tables the parser can recognize. Factorio installation data is read-only input.