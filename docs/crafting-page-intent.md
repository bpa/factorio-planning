# Crafting Page Intent

## Purpose

Help a player plan bounded groups of production machines (“malls”) for products they choose to automate. The page should suggest related products, favoring shared inputs over similar function. Product function and intermediate-product subgroup are useful secondary signals, not hard grouping rules.

The planner is for organizing one mall at a time. Per-mall input and machine limits are planning preferences, not global restrictions on what can be produced. A product such as iron gear wheels may belong in more than one mall when that avoids adding another input line. Rare recovery products can still be worthwhile mall outputs even when their demand is low.

## Intended Workflow

1. Choose or create a mall, then select an active named constraint configuration. Open Manage Configurations to create, edit, or delete profiles. A profile can set a maximum production-machine count and an optional combined input/output connection limit; for example, “Early game” can allow 12 machines with no connection cap.
2. Select one or more products as the mall's starting goals.
3. Review suggested products ranked primarily by overlap with those products' inputs, then by compatible production function and subgroup.
4. Add or reject suggestions explicitly. Show why a product was suggested and what it adds to the mall's inputs, machines, and footprint.
5. Treat every item as a valid input. For each input, show which other malls currently produce it and their output rates; this supplier information does not change the item's eligibility or input-connection count.
6. Add or edit a mall's production machines and immediately calculate output rates per minute for each product. Show these rates prominently in the machine editor and as an output-rate column in the mall list.
7. Save the created mall list and each mall's stable identity, name, products, machine assignments, selected configuration, and planned/completed status in browser local storage, separately for Base and Space Age. Restore them when the page is reopened or reloaded and recalculate derived rates.

## Behavior Boundaries

- Suggestions are advisory. A candidate may exceed a configured limit, but the UI should show the overage and the reason rather than silently treating preferences as global bans.
- Constraint profiles are reusable planning presets, not global rules. Selecting a profile applies it to the mall currently being planned; changing profiles must not discard selected products. An unset combined connection limit means unlimited, while zero means no external inputs or outputs are allowed.
- Profile create/edit/delete is available through a modal dialog, with the active profile also selectable from the page. Persist profiles locally per dataset. Editing a profile updates malls that reference it; deleting a referenced profile requires confirmation and leaves those malls' products intact while clearing that profile assignment.
- Capacity is the sum of distinct external input material types and distinct mall output material types. Count a type once in each direction if it is both imported and exported. Cargo items and fluids each count as one connection; do not apply a separate fluid limit or weighting.
- Any item can be selected as an input, whether or not another mall produces it. Show matching producer malls and their rates as information only; do not remove or discount that input from capacity calculations. Only production internal to the same mall satisfies an internal dependency rather than an external input.
- Aggregate each mall's machine output by product in items per minute (or fluid units per minute). Recalculate when machines, counts, recipes, modules, or beacons change. Show the per-machine/product rates prominently while adding or editing a production line, and show each mall's product rates in an output-rate column in the mall list.
- Shared inputs remain the strongest similarity signal for recommendations, even though the capacity limit applies to both inputs and outputs together.
- Products that cannot be hand-crafted or require fluid-capable machinery must not be presented as ordinary manual fallbacks. A product whose category has no parsed compatible machine should be labeled unsupported, not assigned a guessed machine.
- Machines do not automatically craft missing intermediate ingredients. Every dependency must be planned as an explicit production output or treated as an external/available input.
- Count duplicate products across malls independently and list each producing mall as a supplier; do not treat an item produced elsewhere as a different kind of input.
- Show recipe alternatives and compatible machine choices when more than one is valid.
- Preserve the current search and Mall/Manual workflow as a useful fallback while adding named malls and product grouping.
- Omit quality variants and quality effects. Plan around ordinary-quality prototypes.

## Decisions To Confirm During Implementation

- Define which mall states count as current suppliers in the input annotation. Show status clearly; supplier presence must not change input eligibility or connection counting.
- A machine-count limit requires a production target. `energy_required` and machine `crafting_speed` determine time per craft, but not how many machines to build without a target rate or stock goal. Add per-product demand/stock targets or define a deliberate default.
- Treat recipe availability as “normally obtainable in the selected dataset,” including recipes unlocked by technology. A literal `enabled = false` filter would exclude many normal research-gated products in the installed Base data. If the desired filter is instead “unlocked in my current save,” the page also needs selected research state.