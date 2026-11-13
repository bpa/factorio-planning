# Crafting Page Implementation Plan

This plan keeps the standalone-page design and builds capabilities in dependency order. Data extraction should be validated before the UI starts relying on the new payload.

## 1. Define Planner Semantics

- Define reusable named constraint configurations, separate from mall products. Each profile has a stable ID and display name, a maximum production-machine count, and an optional maximum combined number of distinct external input and output material connections. An unset connection limit means unlimited, not zero. Each item or fluid connection counts equally; there is no separate fluid allowance. Example: “Early game” with 12 machines and no input/output limit.
- A mall references one active configuration; selecting a different profile changes the guidance for that mall, not its selected products. Profiles are advisory, not global hard requirements. Decide whether future constraints such as footprint belong in this profile schema or remain separate per-mall preferences.
- Define profile edit/delete behavior for malls that reference it. Recommended: edits update all referencing malls; deletion requires confirmation, unassigns the profile, and leaves products intact.
- Define product goals as a target rate or stock amount. Without a target, recipe time can compare speed but cannot determine physical machine count.
- Define mall states and show each mall's state alongside supplier annotations for products with configured production lines; supplier status does not alter input eligibility or connection counts.
- Define normal-play eligibility from reachable production paths: include item products of recipes enabled at game start or unlocked by a technology. Exclude editor-only prototypes that have no normal acquisition, enabled-recipe, or technology-unlock path, such as Base `infinity-chest`. For entity goals, require a placeable item with such a normal path. Treat `hidden` and `hide_from_player_crafting` as visibility metadata, not availability gates. Keep current-save research filtering as a later optional mode.
- Count distinct external input material types plus distinct mall output material types against the same combined limit. Count a material once per direction, so a type used as both an input and an output consumes two connections; internal transfers within the mall do not count as external connections.

## 2. Expand The Static Data Model

- Extend recipe parsing to retain `categories`, `energy_required`, enabled and visibility flags (`hidden`, `hide_from_player_crafting`), `allow_productivity`, typed ingredients/results and amounts, and supported result ranges/probabilities. Preserve recipe identity and all outputs. Choose the effective recipe variant for the loaded game data; do not combine `normal` and `expensive` as if both ran together.
- Read item prototypes and retain subgroup plus hidden/availability metadata needed by the UI. Use subgroup for intermediate-product context, not as the sole productivity eligibility test.
- Preserve recipe unlock effects from technology prototypes and build recipe-to-unlocking-technology mappings. Build the normal-play candidate set from start-enabled recipes plus these unlocks; don't add every parsed entity/item prototype indiscriminately. Include supported static updates and keep the existing later-package-wins behavior.
- Parse `assembling-machine` prototypes from each configured package's `prototypes/entity/entities.lua`; retain name, crafting categories, speed, module slots, allowed effects, fluid-box capabilities, and collision box. Round footprint dimensions upward from the box extents.
- Before calling machine coverage complete, also load production-machine families required by recipe categories (for example furnaces, oil refineries, chemical plants, and centrifuges), or explicitly mark those categories unsupported. Assembler-only coverage omits common recipe families, and assembler 1 cannot handle fluid recipes.
- Locate and parse module and beacon prototypes from their actual package prototype files. Retain module effects, beacon slots/allowed effects/range/transmission fields, and exclude quality from planner calculations.
- Keep fluid inputs/results typed if supported; otherwise visibly mark recipes needing fluid handling instead of silently treating them as item-only.
- Add focused fixtures for static tables, package overrides, recipe unlocks, enabled/hidden combinations, visibility-only flags, productivity permission, multiple outputs, fluid-port compatibility, machine compatibility, and dimensions. Verify availability and presentation filtering independently, including that Base `infinity-chest` is excluded because it has no normal recipe/unlock path while hidden status alone does not exclude otherwise reachable products. Cover unsupported dynamic expressions as documented limitations.

## 3. Build Derived Planning Data

- Build an item-to-recipe graph and recipe-to-compatible-machine mapping by intersecting recipe categories with machine crafting categories and checking fluid-port compatibility.
- Keep visibility flags separate from eligibility and graph construction. Hidden status alone neither disables a recipe nor proves that its output is unobtainable; use enabled/unlock state and compatible production paths for availability. Any default suppression of hidden entries belongs to presentation logic.
- Select one recipe/variant for each planned production line. For multi-output recipes, count the machine line once and credit its outputs together toward all matching targets; expose resulting surplus rather than double-counting producers.
- Compute base craft duration as `energy_required / crafting_speed`; this is the recipe's speed-1 time divided by machine speed. Calculate output rate from output quantity and apply the chosen module/beacon preset using supported prototype effects.
- Derive each production line's output rate per product in units per minute from recipe output quantity, effective machine speed, productivity effects, and assigned machine count. Aggregate rates for each product across lines in a mall and recalculate after any machine, count, recipe, module, or beacon edit.
- Estimate producer count from each product target, then total production machines for a mall. Count distinct external input types after subtracting only outputs produced inside the same mall, add distinct mall output types, and compare the combined count with the active configuration. Outputs from other malls may be shown as suppliers but do not invalidate or discount an input connection. Item and fluid types each contribute one connection.
- Produce explanations for recommendations: shared inputs from selected recipes, new input lines, intermediate subgroup/function match, compatible machines including fluid support, estimated machines, and any limit overage.
- Keep duplicate product production legal across malls; report it as an intentional duplicate rather than deduplicating it globally.

## 4. Evolve The Crafting UI And Persistence

- Replace the single Mall/Manual assignment as the only grouping model with named malls, per-mall settings, selected products, and planned/completed state. Retain a simple manual/unsorted path for products outside malls.
- Keep every item selectable as a production input. Annotate an input with all other malls that produce that item and their output rates; supplier annotations are informational and do not alter input treatment or connection accounting. Only an output produced within the same mall removes an external dependency.
- Add an active-configuration selector for the mall being planned and a Manage Configurations action that opens a modal dialog. The dialog supports create, edit, and delete, validates a non-empty name and non-negative integer limits, and represents an unlimited combined input/output cap distinctly from zero.
- Show each profile's name and constraint summary in the selector/dialog. Changing the active profile updates fit guidance and overage indicators without clearing or silently removing products. Confirm deletion when malls reference a profile and preserve their product selections.
- Add a product selection flow and ranked suggestions with explicit add/remove controls. Show limits as planning guidance, not disabled choices.
- Show supplier malls and their per-product rates for each input. Keep dataset filters independent from item/list filters.
- Add machine and module/beacon options with comparable craft times, footprints, and estimated counts. Show each production line's output rate prominently while adding or editing its machine assignment; show aggregated per-product outputs per minute in an output-rate column in the mall list. Clearly label assumptions and unsupported recipe cases.
- Version and migrate the local-storage schema. Save the created mall collection and each mall's stable ID, name, selected products, machine/production-line assignments and counts, selected profile ID, and planned/completed status in browser `localStorage`, isolated by Base and Space Age, alongside configuration profiles. Restore mall records and the active mall after reload; recalculate derived output rates and handle missing/deleted profile IDs safely. Preserve existing Mall/Manual assignments where they can be mapped safely.

## 5. Verify End To End

- Run the generator against Base and Space Age and validate representative counts plus known recipes, unlocks, machines, modules, and beacons.
- Add browser checks for configuration CRUD, unlimited versus zero combined connection limits, item/fluid equal counting, active-profile switching, referenced-profile edit/delete, create/configure malls, adding a seed product, any-item input selection, supplier annotations without input-count changes, saving/restoring malls and machine assignments after reload, output-rate calculation and recalculation after machine edits, mall-list output rates, suggestion ranking, limit overages, duplicate products, and Base/Space Age isolation.
- Smoke-check recipe timing, machine category compatibility, rounded footprints, and module/beacon estimates against hand-calculated examples.
- Verify responsive rendering and that the generated HTML remains standalone with no runtime network dependency.

## Main Risks And Open Questions

- Static extraction cannot evaluate computed Lua prototypes; broaden file coverage only where required and report missing/dynamic prototypes clearly.
- Recipe `enabled = false` commonly means “unlocked by research,” not “not part of the game.” Filtering on the raw boolean would remove ordinary recipes.
- Hidden recipe/item visibility, gameplay availability, selectable goals, and internal dependency use are different decisions. Do not infer availability from visibility flags.
- Alternative recipes and co-products change both input unions and machine counts; estimates are invalid until recipe choice and shared-output accounting are explicit.
- Demand targets, definition of “machine count,” what qualifies as an exposed mall output, and completion semantics must be settled before capacity numbers can be trusted.
- Beacon placement is spatial and effect strength depends on overlap; initial estimates should avoid claiming layout optimality.
- Hand crafting is performed at speed 1 and cannot process fluid recipes. The page's Manual classification is a planning choice, not proof that every recipe is hand-craftable.
- Recipe variants and probabilistic outputs require an explicit selection/normalization policy.