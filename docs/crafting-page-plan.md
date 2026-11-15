# Crafting Page Implementation Plan

This plan keeps the standalone-page design and builds capabilities in dependency order. Data extraction should be validated before the UI starts relying on the new payload.

## Step-By-Step Implementation Sequence

Implement these as small, reviewable increments. Each step adds one usable capability and must pass its listed checks before the next step starts. The sections below remain the detailed behavior specification; resolve any implementation ambiguity against them. Keep fixtures deterministic so tests do not depend on the installed Factorio version. Use the existing Python `unittest` suite for readers and payloads, add a JavaScript unit-test runner for planner logic, and add browser automation for UI workflows. Keep installed-data integration tests as a separate validation layer.

### Step 1: Establish testable planner boundaries (implemented)

**Feature:** Create a test harness for pure planner functions and browser workflows, and define the serialized domain contracts for profiles, malls, materials, recipes, and production nodes. Keep planner calculations outside React components so they can be tested without rendering the page.

**Verify:** `npm test` runs a passing JavaScript unit-test smoke test; `npm run test:e2e` opens the current app in the browser; `python -m unittest discover -s tests -v` still passes. Add contract tests for optional limits (`None` versus `0`), stable IDs, item/fluid material identity, and per-dataset state keys.

**Foundation added:** `src/planner.js` holds React-independent ID, profile-limit, material-identity, and dataset-key helpers. `docs/planner-domain.md` defines the persisted profile, mall, goal, production-node, beacon-node, material, and catalog-recipe shapes for subsequent steps. Node's built-in test runner covers the shared semantics; Playwright opens the Vite app and exercises its current view and dataset switches. The existing crafting assignment store now uses the shared dataset-key helper while retaining its legacy Space Age fallback.

### Step 2: Extract complete recipe and item metadata

**Feature:** Extend the Python readers and JSON payload to retain effective recipe variants, typed ingredients and all results, expected yields and estimate metadata, categories, energy, productivity permission, visibility flags, item subgroup and placeable-entity metadata. Preserve later-package-wins behavior.

**Verify:** Fixture tests cover normal/expensive selection, multiple outputs, probability/range expected yield, fluid typing, hidden flags independent of availability, package overrides, and payload round-tripping. Run Python unit tests and assert old payload consumers still load the new optional fields.

### Step 3: Read production-machine, module, and beacon catalogs

**Feature:** Parse every supported production-machine family required by recipe categories, plus module and beacon prototypes. Include crafting categories/speed, module slots/effects, fluid ports, allowed effects, beacon transmission fields, and rounded-up footprint dimensions. Explicitly label recipe categories unsupported when no compatible machine family is parsed.

**Verify:** Fixture tests assert category matching, input/output fluid-port requirements, allowed effects, module/beacon metadata, and footprint rounding. Installed-data integration checks confirm representative assembler, furnace, chemical plant/refinery, module, and beacon entries where present.

### Step 4: Determine normal-play availability

**Feature:** Build recipe-to-unlocking-technology mappings and mark candidates reachable through enabled-at-start recipes or technology unlocks. Keep visibility metadata separate. Exclude unreachable editor-only products from goal candidates, while allowing hidden but normally reachable products; entity goals require a normally obtainable placeable item.

**Verify:** Fixtures cover enabled recipes, disabled-but-unlocked recipes, hidden reachable items, `hide_from_player_crafting`, unreachable disabled recipes, placeable entity goals, and an `infinity-chest`-style prototype excluded for lack of a normal path. Assert presentation filtering does not alter graph availability.

### Step 5: Build the mall material graph

**Feature:** Implement a pure graph model for selected recipe lines, typed material dependencies, explicit external inputs, and goals. Derive dependency edges rather than allowing edits to them. Support promoting any intermediate to an external input, multiple outputs per recipe, duplicate production across malls, cycle grouping for display, and automatic sink-goal creation after explicit goals are fitted.

**Verify:** Unit tests cover a simple acyclic chain, input promotion removing upstream production, multiple co-products credited from one line, automatic sink goals, persisted goal targets through graph changes, and cyclic cases including kovarex enrichment and the cryogenic-science/fluoroketone dependency described below. Assert internal transfers are not external IO connections.

### Step 6: Calculate rates and recommendations

**Feature:** Calculate craft time from `energy_required / crafting_speed`, per-line and aggregate item/fluid rates, productivity-adjusted expected output, net deficits/surpluses, and deterministic best-fit recipe/machine recommendations. Recommendations explain shared inputs, new inputs, subgroup/function match, machine compatibility, and estimated machine count. Start new nodes without modules.

**Verify:** Hand-calculated fixtures validate speed, recipe duration, output quantity, productivity and beacon effects, and expected probabilistic yield. Recommendation tests assert deterministic ordering and reason fields. Verify every machine/recipe/module/count edit changes the calculated rates in the pure model.

### Step 7: Solve machine counts and material balance (implemented)

**Feature:** Integrate `glpk.js` to solve non-negative integer machine counts for saved recipe/machine/module/beacon choices, minimizing total production machines while meeting every goal target. Balance all internal materials, allow only selected external inputs to cover deficits, count net outputs after internal consumption, and report infeasibility or solver failure without stale results. Use deterministic tie-breaking; do not make profile limits solver constraints.

**Verify:** Solver tests cover a single goal, shared inputs, multiple goals, co-products without double-counting a line, selected external inputs, insufficient-input infeasibility, a feasible and infeasible cycle, duplicate products in separate malls, and repeat-run determinism. Include automation science progression (ore, then plate, then gear as promoted inputs), kovarex, and the optional cryogenic plant case: fluoroketone is an output when no cryogenic plant consumes it, and is not an output when one is present.

**Foundation added:** `solveMallProduction` fits non-negative integer machine counts in `src/planner.js`, balances typed internal materials, applies saved module and linked beacon effects, and returns net inputs, outputs, and goal rates. A continuous feasibility preflight detects contradictory cycles before integer optimization; each solve has a bounded time budget, and infeasible or failed solves return no derived counts or rates. Node tests use GLPK's native entry while the browser uses its worker-backed entry.

### Step 8: Add constraint profile management

**Feature:** Implement per-dataset named profiles, `None` assignment, create/edit/delete with validation and reference confirmation, and profile summaries. Profiles carry optional footprint and combined IO limits only; edits affect referencing malls, deletion unassigns them without changing goals/inputs. Calculate advisory IO overage and density, including beacon area.

**Verify:** Unit tests cover non-empty names, non-negative integer limits, unlimited versus zero, combined distinct input/output counting (a type counts once per direction; fluids count equally), profile edits, safe deletion, and no-profile density `None`. Test all density bands at 0.3, 0.4, 0.5, 0.575, and the exact `2/3` ceiling; confirm limits warn and never block edits or solving. Browser tests exercise profile CRUD and referenced-profile confirmation.

### Step 9: Create and edit named malls, goals, and inputs

**Feature:** Replace Mall/Manual as the only grouping model with named malls, stable identity, planned/completed state, explicit goal targets, ranked add/remove suggestions, and selectable external inputs. Retain the manual/unsorted path for products outside malls. Keep the active profile selector and Manage Profiles modal available while planning.

**Verify:** Browser tests create/rename/select a mall, add/remove goals and suggestions, edit targets, promote any item to input, and verify profile switching preserves selections. Confirm suggestion ranking favors shared inputs and that exceeding advisory limits never disables choices.

### Step 10: Add the editable production graph

**Feature:** Add `@xyflow/react` with material and production nodes, derived uneditable material edges, staged recipe/machine/module edits, save-triggered whole-mall rebuild/re-solve, solver-derived machine counts, and cycle-aware initial placement. Permit node movement and auto-place only newly introduced nodes. The graph communicates dependencies, not physical placement.

**Verify:** Browser tests confirm graph creation and defaults, compatible recipe/machine/module options, unsaved edits leave displayed results unchanged, saving updates dependencies and solves the full mall, material edges cannot be edited, cycle grouping renders, moved positions persist through recalculation, and new nodes receive positions.

### Step 11: Add beacon planning and machine effects

**Feature:** Add/remove beacon nodes and manual beacon-to-machine links, applying supported beacon/module effects to linked production lines. Keep link selection explicit and avoid claiming physical range or layout validation. 

**Verify:** Unit tests compare rates with no module/beacon, module-only, and manually linked beacon cases, including disallowed effects and productivity-disabled recipes. Browser tests add/remove a beacon and link/unlink machines; saving the beacon rebuilds and re-solves the mall.

### Step 12: Persist and migrate planner state

**Feature:** Version local-storage data and persist profiles plus mall IDs/names, goals/targets, external inputs, production choices, beacon links, graph positions, profile assignment, status, and active mall, isolated by Base and Space Age. Recalculate derived rates/counts on reload. Safely handle missing profiles and preserve legacy Mall/Manual assignments when mappable.

**Verify:** Storage tests cover round-trip, migration from the current schema, separate Base/Space Age state, missing/deleted profile IDs, active mall restoration, graph position restoration, and recalculation rather than restoring stale derived values. Browser tests reload each dataset and confirm isolation.

### Step 13: Complete the mall list and edit-view summaries

**Feature:** Show one row per mall with per-goal item rates, density, profile, and configured IO total/limit; omit fluids from the list's items/min summary but show fluid IO rates in edit views. Add mutually exclusive input/output search modes and red IO overage presentation. Show all current inputs and outputs with net rates, without supplier-mall identity.

**Verify:** Browser tests assert multi-goal multiline rates, item-only summary, fluid edit rates, net input/output values, no supplier names, profile/density/IO display, red overage, and mutually exclusive input/output search. Confirm dataset selection remains independent from crafting list filters.

### Step 14: Validate generated standalone app end to end

**Feature:** Bundle graph and solver assets locally and complete integration checks across data generation, both datasets, planner workflows, and responsive rendering.

**Verify:** Run Python unit tests and installed-data integration tests, regenerate Base and Space Age JSON, run the browser suite against both datasets, and run `npm run build`. Smoke-check representative known recipes, unlocks, machines, modules, beacons, rate calculations, and rounded footprints. Verify responsive rendering and that the built page makes no runtime network requests for dependencies or planner assets.

## Detailed Behavior Specification

## 1. Define Planner Semantics

- Define reusable named constraint profiles, separate from mall products. Each profile has a stable ID and display name, an optional maximum mall footprint, and an optional maximum combined number of distinct external input and output material connections. There is no machine-count limit. Unset limits mean unlimited, not zero. Each item or fluid connection counts equally; there is no separate fluid allowance. These limits are advisory: overages warn that a build may be infeasible or worth splitting into smaller malls, but never block selection or edits.
- A mall references zero or one profile. An unassigned mall displays `None`, has no active constraints, and shows Density as `None`. Selecting a profile changes guidance for that mall, not its goals or input selections. Editing a profile updates all malls that reference it; deleting one requires confirmation, unassigns those malls, and leaves their goals and inputs intact.
- Model each mall as a directed material/machine graph. Start with raw external inputs feeding the selected recipes for each goal. A player may promote any intermediate material to an external input, which removes its upstream production chain and recalculates the remaining graph. Material-to-machine dependency edges are derived and cannot be edited.
- After fitting the explicitly added goals, every other produced material with no downstream consumer automatically becomes a goal initialized from its current net rate in that baseline solution. Goals are editable target rates, represent surplus after internal consumption, and persist when recipes, machine configurations, or graph rates change. Players may also declare an additional product as a goal even when the mall consumes some of it; its goal and reported output rate are net of that internal consumption.
- In edit views, show every current input in the leftmost column with its current rate per minute. Show every goal/output with its current rate per minute in a dedicated column on the far right. Do not identify which other mall supplies an input. An input rate is the net deficit after internal production; an output rate is the net surplus after internal consumption.
- Support mall-list search by either input or output, with mutually exclusive search modes. Show one row per mall with name, calculated items/min, density rating, and profile name; list multiple products and rates on separate lines within that mall row. Show total IO against the configured IO limit when one exists, and color an overage red.
- For footprint guidance, calculate occupied area from assigned production-machine and beacon counts times their prototype footprints. Density is occupied area divided by the profile's maximum mall footprint; that footprint represents the full area available, including space needed to transport goods. Use color-coded quality-inspired ratings: `Normal` at d <= 0.3, `Uncommon` at 0.3 < d <= 0.4, `Rare` at 0.4 < d <= 0.5, `Epic` at 0.5 < d <= 0.575, `Legendary` at 0.575 < d <= 2/3, and `Unrealistic` above 2/3. The 0.66 reference is rounded; use the exact ceiling: `occupied footprint * 3/2 > constrained footprint` means `Unrealistic`. The ratings are advisory, with typical layouts around 0.3, dense non-logistics layouts around 0.5, and logistics-robot handling reaching 2/3.
- Define normal-play eligibility from reachable production paths: include item products of recipes enabled at game start or unlocked by a technology. Exclude editor-only prototypes that have no normal acquisition, enabled-recipe, or technology-unlock path, such as Base `infinity-chest`. For entity goals, require a placeable item with such a normal path. Treat `hidden` and `hide_from_player_crafting` as visibility metadata, not availability gates. Keep current-save research filtering as a later optional mode.
- Count distinct external input material types plus distinct goal/output material types against the same combined IO limit. Count a material once per direction, so a type used as both an input and an output consumes two connections; internal transfers do not count as external connections.

## 2. Expand The Static Data Model

- Extend recipe parsing to retain `categories`, `energy_required`, enabled and visibility flags (`hidden`, `hide_from_player_crafting`), `allow_productivity`, typed ingredients/results and amounts, and supported result ranges/probabilities. Preserve recipe identity and all outputs. Calculate expected yields from supported ranges/probabilities and label resulting rates as estimates. Choose the effective recipe variant for the loaded game data; do not combine `normal` and `expensive` as if both ran together.
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
- When creating a production node, preselect the best-fit compatible recipe/machine pair using shared mall inputs, new external inputs, subgroup/function match, machine support, and estimated machine count. Start with no modules. The player can change the recipe, machine, and compatible modules before saving the node.
- Compute base craft duration as `energy_required / crafting_speed`; this is the recipe's speed-1 time divided by machine speed. Calculate output rate from output quantity and apply the chosen module/beacon preset using supported prototype effects.
- Derive each production line's output rate per product in units per minute from recipe output quantity, effective machine speed, productivity effects, and assigned machine count. Aggregate rates for each product across lines in a mall and recalculate after any machine, count, recipe, module, or beacon edit.
- Build the production model from saved recipe/machine nodes, configured modules, beacon links, and product goals. Solve non-negative integer machine counts so every goal's net output rate is at least its target, minimizing the total number of production machines. Machine type, recipe, module choices, and beacon links are inputs to the solve, not solver-selected alternatives. Saving an edited goal, input, production, or beacon node rebuilds affected material dependencies and re-solves the entire mall graph; unsaved edits do not change calculated results. Machine counts are derived and cannot be manually overridden. Use deterministic tie-breaking for equally optimal solutions. Profile footprint and IO limits remain advisory and never constrain the solve.
- Calculate each material's net flow from recipe-line production minus internal recipe consumption. Only selected external-input nodes may supply net deficits, and their rates are reported; other intermediate materials must balance internally or the solve is infeasible. Goal material surpluses become output rates. Count distinct selected external input types plus distinct goal/output types against the active profile's IO limit. Item and fluid types each contribute one connection; connection count is separate from rates. Supplier identity does not affect input eligibility or connection counts.
- Support recipe cycles in both calculations and visualization. Solve cyclic material balances with the same integer optimizer; group strongly connected graph nodes for initial layout while retaining derived material edges. Surface an infeasible goal set instead of returning a partial or misleading solution.
- Derive the density ratio from occupied machine-and-beacon area and the configured mall footprint maximum, and apply the specified color-coded density bands and exact 2/3 ceiling. Do not impose profile limits as hard caps. Without an assigned profile or footprint maximum, density is `None`.
- Produce explanations for recommendations: shared inputs from selected recipes, new input lines, intermediate subgroup/function match, compatible machines including fluid support, estimated machines, and any limit overage.
- Keep duplicate product production legal across malls; report it as an intentional duplicate rather than deduplicating it globally.

## 4. Evolve The Crafting UI And Persistence

- Replace the single Mall/Manual assignment as the only grouping model with named malls, per-mall settings, an editable production graph, and planned/completed state. Retain a simple manual/unsorted path for products outside malls.
- Use a graph editor with material and production-machine nodes. Initially order dependency layers as material inputs, machines, and material outputs; arrange independent machines in the same layer. Material dependency edges are generated by recipes and are not user-editable. Group cycles for initial placement. Players may move nodes; persist moved positions and preserve them when recalculating, auto-placing only new nodes. The graph is a planning view, not a physical factory layout.
- Keep every item selectable as an external input. Promoting an intermediate item removes its upstream production chain. In mall editing, list all current inputs and outputs with current net rates per minute in a separate column, without naming supplier malls.
- Add an active-profile selector for the mall being planned and a Manage Profiles action that opens a modal dialog. The dialog supports create, edit, and delete, validates a non-empty name and non-negative integer limits, and represents unlimited footprint and IO limits distinctly from zero.
- Show each profile's name and constraint summary, including optional footprint and IO limits, in the selector/dialog. Include `None` for an unassigned mall. Changing the active profile updates density and overage guidance without clearing or silently removing products. Confirm deletion when malls reference a profile, unassign those malls, and preserve their product selections.
- Add goal creation and ranked suggestions with explicit add/remove controls. Allow any item to be promoted to an external input. Preselected recipe and machine defaults remain editable. Show limits as planning guidance, not disabled choices.
- Keep dataset filters independent from item/list filters. Provide mutually exclusive input and output search modes.
- Let players edit a production node's recipe, compatible machine, and compatible modules; new nodes default to the best-fit recipe/machine pair with no modules. Node edits are staged until saved. Saving any graph node rebuilds material dependencies and re-solves the full mall graph. Machine counts are solver-derived. Let players add/remove beacon nodes and manually add/remove beacon-to-machine effect links; saving a beacon node also re-solves. Material-flow edges remain derived and uneditable. Show effects and resulting per-line rates. Show each mall's name, per-goal item rates on separate lines, density rating, profile name, and (when configured) total IO/IO limit. Exclude fluids from the mall-list `Items/min` summary, but show fluid input/output rates in the edit view. Clearly label solver infeasibility and unsupported recipe cases.
- Version and migrate the local-storage schema. Save the created mall collection and each mall's stable ID, name, goals and target rates, external input selections, recipe/machine/module configuration, beacon nodes and manual links, node positions, selected profile ID, and planned/completed status in browser `localStorage`, isolated by Base and Space Age, alongside profiles. Machine counts and rates are derived and recalculated after reload. Restore the active mall and graph positions; handle missing/deleted profile IDs safely. Preserve existing Mall/Manual assignments where they can be mapped safely.
- Use `@xyflow/react` for the graph editor and `glpk.js` for browser-side mixed-integer optimization. Bundle their runtime assets locally so the generated site has no runtime network dependency.

## 5. Final Regression Checklist

Run this aggregate regression checklist after the step-specific tests pass; it does not replace the verification gate for each implementation step.

- Run the generator against Base and Space Age and validate representative counts plus known recipes, unlocks, machines, modules, and beacons.
- Add browser checks for profile CRUD, unlimited versus zero footprint/IO limits, item/fluid equal IO counting, active-profile switching, referenced-profile edit/delete and unassignment, `None` profile behavior, graph creation with best-fit recipe/machine defaults and no modules, compatible module selection, unsaved edits leaving results unchanged, saving a node rebuilding dependencies and re-solving the whole graph, automatic sink goals and target persistence, input promotion removing upstream dependencies, net flow/rate accounting, minimum-machine goal fitting, cyclic and infeasible solver cases, manual beacon links, node movement and position persistence, newly auto-placed nodes, mutually exclusive input/output search, per-goal multi-line mall rates, all density labels and thresholds (0.3, 0.4, 0.5, 0.575) plus the exact `2/3` `Unrealistic` boundary including beacon footprint, IO overage coloring, advisory limits, duplicate products, and Base/Space Age isolation.
- Smoke-check recipe timing, machine category compatibility, rounded footprints, and module/beacon estimates against hand-calculated examples.
- Verify responsive rendering and that the generated HTML remains standalone with no runtime network dependency.
- Add tests specifically for cyclic recipes like kovarex-enrichment-process that produce outputs that are also inputs. Also check the cryogenic-science-pack recipe, which produces an output that another machine can convert into one of its inputs. The cryogenic plant is optional, but if it exists in the mall, the output does not exist. If it does not exist, the fluoroketone must be an output.
- Add tests for easier malls like automation science packs taking copper & iron ore, then replacing the ore with plate, and finally the iron plate with iron gear wheel
- Add tests for modules and beacons

## Main Risks And Limitations
- Recipe `enabled = false` commonly means “unlocked by research,” not “not part of the game.” Filtering on the raw boolean would remove ordinary recipes.
- Hidden recipe/item visibility, gameplay availability, selectable goals, and internal dependency use are different decisions. Do not infer availability from visibility flags.
- Alternative recipes and co-products change shared material balances; ensure the solver counts each production line once and credits all co-products without double-counting machines.
- The graph is not a physical factory layout. Beacon links express player-declared effects; do not claim spatial placement or coverage validation.
- Integer optimization can be expensive or infeasible for complex cyclic graphs. Validate solve time on realistic data and report solver failure/infeasibility explicitly without presenting stale counts as current.
- Hand crafting is performed at speed 1 and cannot process fluid recipes. The page's Manual classification is a planning choice, not proof that every recipe is hand-craftable.
- Probabilistic outputs are expected rates; realized production can vary from the displayed estimate.