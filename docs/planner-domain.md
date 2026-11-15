# Planner Domain Contracts

These are the serialized planner contracts for the JavaScript planning layer. They are separate from the generated Factorio catalog in `public/data/crafting.json`: catalog recipes describe game data, while planner records describe a player's saved choices. IDs are UUIDs created once and retained when a record is renamed or otherwise edited. Calculated rates, machine counts, graph edges, density, and IO totals are derived and are not persisted.

## Shared Values

`MaterialRef` is `{ "type": "item" | "fluid", "name": string }`. Its identity is the pair of type and prototype name; an item and fluid with the same name are different materials. Material amounts in the game catalog additionally carry `amountMin`, `amountMax`, `amount`, and `probability`.

An unset optional limit is JSON `null` and means unlimited. Numeric `0` is a configured hard-zero advisory limit, not an unset value. `maxFootprint` is a finite non-negative number; `maxIO` is a non-negative integer.

## Persisted Records

```js
Profile = {
  id: string,                    // stable UUID
  name: string,
  maxFootprint: number | null,
  maxIO: number | null
}

Goal = { material: MaterialRef, targetRate: number } // per minute

ProductionNode = {
  id: string,                    // stable UUID
  recipeName: string,
  machineName: string,
  modules: Array<{ name: string, count: number }>,
  beaconIds: string[],           // explicit links to beacon nodes
  position: { x: number, y: number } | null
}

BeaconNode = {
  id: string,                    // stable UUID
  name: string,                  // beacon prototype name
  modules: Array<{ name: string, count: number }>,
  position: { x: number, y: number } | null
}

Mall = {
  id: string,                    // stable UUID
  name: string,
  status: "planned" | "completed",
  profileId: string | null,
  goals: Goal[],
  inputs: MaterialRef[],
  productionNodes: ProductionNode[],
  beaconNodes: BeaconNode[]
}

DatasetState = {
  version: number,
  profiles: Profile[],
  malls: Mall[],
  activeMallId: string | null
}
```

`recipeName` identifies the effective recipe variant already selected in the static catalog. The catalog recipe contract remains the generated shape: `name`, `variant`, `categories`, `energy`, availability/visibility/productivity flags, typed `ingredients` and `outputs`, `unlockedBy`, `compatibleMachines`, and `handCraftable`. Each material amount has `type`, `name`, `amountMin`, `amountMax`, `amount`, and `probability`. Future reader work may add optional metadata without changing saved planner records.

## Storage

The current assignment store retains its `factorio-crafting-mall-v1` namespace. Dataset state keys are formed with `datasetStorageKey(dataset)`, producing `factorio-crafting-mall-v1:base` or `factorio-crafting-mall-v1:space-age`. Dataset state must never be shared across those keys. The versioned profile/mall migration is reserved for step 12; this contract establishes its record shapes now.

## Boundaries

Pure domain functions belong in `src/planner.js` and must not import React or browser UI modules. `src/App.jsx` owns rendering and interaction. Python remains responsible for extracting the static game catalog. JavaScript unit tests use Node's built-in test runner; browser workflow tests use Playwright against the Vite dev server.

## Decision Source

When the earlier `docs/crafting-page-intent.md` differs from the detailed behavior specification in `docs/crafting-page-plan.md`, use the plan as the current implementation authority. In particular, profiles have footprint and combined-IO advisory limits only (no machine-count limit); mall edit views report material names and net rates without supplier-mall identity; and explicit goal target rates determine production requirements.