import assert from 'node:assert/strict';
import test from 'node:test';
import GLPK from 'glpk.js/node';

import {
  assertOptionalLimit,
  assertProfile,
  buildMallGraph,
  calculateCraftDuration,
  calculateMallRates,
  calculateProductionRate,
  calculateProfileDensity,
  calculateProfileIO,
  createProfile,
  createMall,
  createStableId,
  datasetStorageKey,
  deleteProfile,
  materialKey,
  promoteMaterialToInput,
  rankGoalSuggestions,
  recommendProductionOptions,
  solveMallProduction,
  updateProfile,
} from '../src/planner.js';

let glpk;

async function solve(config) {
  glpk ||= await GLPK();
  return solveMallProduction(config, { glpk });
}

test('optional profile limits distinguish unlimited from zero', () => {
  assert.doesNotThrow(() => assertOptionalLimit(null, 'maxFootprint'));
  assert.doesNotThrow(() => assertOptionalLimit(0, 'maxFootprint'));
  assert.doesNotThrow(() => assertOptionalLimit(null, 'maxIO', true));
  assert.doesNotThrow(() => assertOptionalLimit(0, 'maxIO', true));
  assert.throws(() => assertOptionalLimit(-1, 'maxFootprint'), TypeError);
  assert.throws(() => assertOptionalLimit(1.5, 'maxIO', true), TypeError);

  assert.doesNotThrow(() => assertProfile({ id: createStableId(), name: 'Unlimited', maxFootprint: null, maxIO: null }));
  assert.doesNotThrow(() => assertProfile({ id: createStableId(), name: 'Closed', maxFootprint: 0, maxIO: 0 }));
});

test('stable IDs are unique UUIDs and remain unchanged when serialized', () => {
  const profile = { id: createStableId(), name: 'Early game' };
  const mall = { id: createStableId(), name: 'Science' };
  assert.match(profile.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(profile.id, mall.id);
  profile.name = 'Updated name';
  assert.equal(JSON.parse(JSON.stringify(profile)).id, profile.id);
});

test('named malls normalize stable identity, status, goals, and unique inputs', () => {
  const mall = createMall('Science', {
    goals: [{ material: { type: 'item', name: 'automation-science-pack' }, targetRate: 60 }],
    inputs: [{ type: 'item', name: 'iron-plate' }, { type: 'item', name: 'iron-plate' }],
  });
  assert.match(mall.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(mall.name, 'Science');
  assert.equal(mall.status, 'planned');
  assert.equal(mall.goals[0].targetRate, 60);
  assert.deepEqual(mall.inputs, [{ type: 'item', name: 'iron-plate' }]);
  assert.throws(() => createMall('   '), TypeError);
});

test('goal suggestions rank products that share current inputs first', () => {
  const suggestions = rankGoalSuggestions({
    items: {
      'copper-cable': { recipes: [{ available: true, ingredients: [{ type: 'item', name: 'copper-plate' }] }] },
      'steel-plate': { recipes: [{ available: true, ingredients: [{ type: 'item', name: 'iron-plate' }, { type: 'item', name: 'coal' }] }] },
      'unavailable-item': { recipes: [{ available: false, ingredients: [{ type: 'item', name: 'iron-plate' }] }] },
    },
    goals: [],
    inputs: [{ type: 'item', name: 'iron-plate' }],
  });
  assert.equal(suggestions[0].material.name, 'steel-plate');
  assert.deepEqual(suggestions[0].sharedInputs, [{ type: 'item', name: 'iron-plate' }]);
  assert.equal(suggestions.some((entry) => entry.material.name === 'unavailable-item'), false);
});

test('material identity includes the item or fluid type', () => {
  assert.equal(materialKey({ type: 'item', name: 'water' }), materialKey({ type: 'item', name: 'water' }));
  assert.notEqual(materialKey({ type: 'item', name: 'water' }), materialKey({ type: 'fluid', name: 'water' }));
  assert.throws(() => materialKey({ type: 'entity', name: 'water' }), TypeError);
});

test('dataset state keys are isolated and validated', () => {
  assert.notEqual(datasetStorageKey('base'), datasetStorageKey('space-age'));
  assert.match(datasetStorageKey('base'), /:base$/);
  assert.match(datasetStorageKey('space-age'), /:space-age$/);
  assert.throws(() => datasetStorageKey('unknown'), TypeError);
});

test('mall graphs preserve explicit goals and auto-sink goals for co-products', () => {
  const graph = buildMallGraph({
    goals: [{ material: { type: 'item', name: 'gear' }, targetRate: 10 }],
    inputs: [{ type: 'item', name: 'iron-ore' }],
    productionNodes: [
      { id: 'smelt-iron', recipeName: 'smelt-iron', outputs: [{ type: 'item', name: 'iron-plate' }], ingredients: [{ type: 'item', name: 'iron-ore' }] },
      { id: 'make-gear', recipeName: 'make-gear', outputs: [{ type: 'item', name: 'gear' }], ingredients: [{ type: 'item', name: 'iron-plate' }] },
      { id: 'side-product', recipeName: 'iron-plate-sulfur', outputs: [{ type: 'item', name: 'iron-plate' }, { type: 'item', name: 'sulfur' }], ingredients: [{ type: 'item', name: 'iron-ore' }] },
    ],
  });

  assert.equal(graph.goals.find((goal) => goal.material.name === 'gear')?.targetRate, 10);
  const autoSinks = graph.autoSinkGoals.map((goal) => goal.material.name).sort();
  assert.deepEqual(autoSinks, ['sulfur']);
});

test('promoting an intermediate input removes its upstream production', () => {
  const graph = buildMallGraph({
    goals: [{ material: { type: 'item', name: 'gear' }, targetRate: 10 }],
    inputs: [],
    productionNodes: [
      { id: 'smelt-iron', recipeName: 'smelt-iron', outputs: [{ type: 'item', name: 'iron-plate' }], ingredients: [{ type: 'item', name: 'iron-ore' }] },
      { id: 'make-gear', recipeName: 'make-gear', outputs: [{ type: 'item', name: 'gear' }], ingredients: [{ type: 'item', name: 'iron-plate' }] },
    ],
  });

  const promoted = promoteMaterialToInput(graph, { type: 'item', name: 'iron-plate' });
  assert.deepEqual(
    promoted.productionNodes.map((node) => node.recipeName).sort(),
    ['make-gear'],
  );
  assert.equal(promoted.inputs.some((material) => material.name === 'iron-plate'), true);
});

test('cycle groups are reported as strongly connected components', () => {
  const graph = buildMallGraph({
    goals: [{ material: { type: 'item', name: 'product' }, targetRate: 1 }],
    productionNodes: [
      { id: 'a', recipeName: 'a', ingredients: [{ type: 'item', name: 'feed' }], outputs: [{ type: 'item', name: 'product' }] },
      { id: 'b', recipeName: 'b', ingredients: [{ type: 'item', name: 'product' }], outputs: [{ type: 'item', name: 'feed' }] },
    ],
  });

  assert.ok(graph.cycleGroups.some((group) => group.includes('product') && group.includes('feed')));
});

test('step 6 calculates craft time, throughput, and output rates with deterministic recommendations', () => {
  const recipe = {
    name: 'gear-making',
    energyRequired: 0.5,
    allowProductivity: true,
    ingredients: [{ type: 'item', name: 'iron-plate', amount: 1 }],
    outputs: [{ type: 'item', name: 'gear', amount: 1 }],
  };
  const machine = { name: 'assembling-machine-2', craftingSpeed: 1.5 };

  const craftDuration = calculateCraftDuration(recipe, machine);
  assert.ok(Math.abs(craftDuration - 1 / 3) < 1e-9);

  const line = calculateProductionRate({
    recipe,
    machine,
    machineCount: 2,
    modules: [{ name: 'productivity-module', productivity: 0.05, count: 1 }],
  });
  assert.ok(Math.abs(line.craftDuration - 1 / 3) < 1e-9);
  assert.ok(Math.abs(line.totalOutputRate['gear'] - 378) < 1e-6);

  const mallRates = calculateMallRates({
    goals: [{ material: { type: 'item', name: 'gear' }, targetRate: 100 }],
    inputs: [{ type: 'item', name: 'iron-plate' }],
    recipeCatalog: [{
      name: 'gear-making',
      categories: ['crafting'],
      energyRequired: 0.5,
      allowProductivity: true,
      ingredients: [{ type: 'item', name: 'iron-plate', amount: 1 }],
      outputs: [{ type: 'item', name: 'gear', amount: 1 }],
    }],
    machineCatalog: [{
      name: 'assembling-machine-2',
      craftingSpeed: 1.5,
      craftingCategories: ['crafting'],
    }],
    productionNodes: [{
      id: 'gear-node',
      recipeName: 'gear-making',
      machineName: 'assembling-machine-2',
      machineCount: 2,
      ingredients: [{ type: 'item', name: 'iron-plate', amount: 1 }],
      outputs: [{ type: 'item', name: 'gear', amount: 1 }],
      modules: [{ name: 'productivity-module', productivity: 0.05, count: 1 }],
    }],
  });

  assert.ok(mallRates.totalOutput['gear'] > 300);
  assert.ok(mallRates.netFlow['gear'] > 0);
  assert.ok(mallRates.netFlow['iron-plate'] < 0);

  const recommendations = recommendProductionOptions({
    goals: [{ material: { type: 'item', name: 'gear' }, targetRate: 100 }],
    inputs: [{ type: 'item', name: 'iron-plate' }],
    recipeCatalog: [
      { name: 'gear-making', categories: ['crafting'], allowProductivity: true, ingredients: [{ type: 'item', name: 'iron-plate', amount: 1 }], outputs: [{ type: 'item', name: 'gear', amount: 1 }] },
      { name: 'plate-making', categories: ['smelting'], ingredients: [{ type: 'item', name: 'iron-ore', amount: 1 }], outputs: [{ type: 'item', name: 'iron-plate', amount: 1 }] },
    ],
    machineCatalog: [
      { name: 'assembling-machine-2', craftingSpeed: 1.5, craftingCategories: ['crafting'] },
      { name: 'blast-furnace', craftingSpeed: 1, craftingCategories: ['smelting'] },
    ],
  });

  assert.equal(recommendations[0].recipeName, 'gear-making');
  assert.ok(recommendations[0].reasons.some((reason) => reason.includes('iron-plate')));
});

test('step 8 validates profiles, densities, IO counts, and safe CRUD operations', () => {
  const profile = createProfile({ name: 'Compact', maxFootprint: 100, maxIO: 3 });
  assert.equal(profile.name, 'Compact');
  assert.equal(profile.maxFootprint, 100);
  assert.equal(profile.maxIO, 3);

  assert.throws(() => createProfile({ name: '   ', maxFootprint: 10 }), TypeError);
  assert.throws(() => createProfile({ name: 'Bad', maxIO: -1 }), TypeError);
  assert.throws(() => createProfile({ name: 'Bad', maxIO: 1.5 }), TypeError);

  const normal = calculateProfileDensity(profile, 30);
  assert.equal(normal.rating, 'Normal');
  assert.equal(normal.ratio, 0.3);
  assert.equal(calculateProfileDensity(profile, 40).rating, 'Uncommon');
  assert.equal(calculateProfileDensity(profile, 50).rating, 'Rare');
  assert.equal(calculateProfileDensity(profile, 55).rating, 'Epic');
  assert.equal(calculateProfileDensity(profile, 58).rating, 'Legendary');
  assert.equal(calculateProfileDensity(profile, 70).rating, 'Unrealistic');
  assert.equal(calculateProfileDensity({ ...profile, maxFootprint: null }, 10).density, null);

  const io = calculateProfileIO(profile, [{ type: 'item', name: 'iron-ore' }], [{ type: 'item', name: 'iron-ore' }, { type: 'fluid', name: 'water' }]);
  assert.equal(io.inputCount, 1);
  assert.equal(io.outputCount, 2);
  assert.equal(io.total, 3);
  assert.equal(io.overage, false);
  assert.equal(calculateProfileIO(profile, [{ type: 'item', name: 'iron-ore' }, { type: 'fluid', name: 'water' }], [{ type: 'item', name: 'iron-ore' }, { type: 'fluid', name: 'water' }, { type: 'item', name: 'gear' }]).overage, true);

  const updated = updateProfile(profile, { maxIO: 5, name: 'Updated' });
  assert.equal(updated.name, 'Updated');
  assert.equal(updated.maxIO, 5);

  const afterDelete = deleteProfile([profile, updateProfile(profile, { id: 'next-profile', name: 'Second', maxIO: 2 })], profile.id);
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].name, 'Second');
});

test('step 7 fits integer machine counts to goal rates and reports net material rates', async () => {
  const result = await solve({
    goals: [{ material: { type: 'item', name: 'gear' }, targetRate: 121 }],
    inputs: [{ type: 'item', name: 'iron-plate' }],
    recipeCatalog: [{
      name: 'gear-making',
      energyRequired: 1,
      ingredients: [{ type: 'item', name: 'iron-plate', amount: 1 }],
      outputs: [{ type: 'item', name: 'gear', amount: 1 }],
    }],
    machineCatalog: [{ name: 'assembler', craftingSpeed: 1 }],
    productionNodes: [{ id: 'gear-line', recipeName: 'gear-making', machineName: 'assembler' }],
  });

  assert.equal(result.status, 'optimal');
  assert.equal(result.machineCounts['gear-line'], 3);
  assert.equal(result.totalMachines, 3);
  assert.equal(result.goalRates[0].rate, 180);
  assert.equal(result.inputRates[0].rate, 180);
  assert.equal(result.outputRates.find((entry) => entry.material.name === 'gear').rate, 180);
});

test('step 7 credits co-products once while satisfying multiple goals and shared inputs', async () => {
  const result = await solve({
    goals: [
      { material: { type: 'item', name: 'gear' }, targetRate: 60 },
      { material: { type: 'item', name: 'plate' }, targetRate: 60 },
    ],
    inputs: [{ type: 'item', name: 'ore' }],
    recipeCatalog: [{
      name: 'co-product-recipe',
      energyRequired: 1,
      ingredients: [{ type: 'item', name: 'ore', amount: 1 }],
      outputs: [
        { type: 'item', name: 'gear', amount: 1 },
        { type: 'item', name: 'plate', amount: 1 },
      ],
    }],
    machineCatalog: [{ name: 'machine', craftingSpeed: 1 }],
    productionNodes: [{ id: 'shared-line', recipeName: 'co-product-recipe', machineName: 'machine' }],
  });

  assert.equal(result.status, 'optimal');
  assert.equal(result.totalMachines, 1);
  assert.equal(result.machineCounts['shared-line'], 1);
  assert.equal(result.outputRates.length, 2);
  assert.equal(result.inputRates[0].rate, 60);
});

test('step 7 permits deficits only for selected external inputs', async () => {
  const config = {
    goals: [{ material: { type: 'item', name: 'gear' }, targetRate: 60 }],
    recipeCatalog: [{
      name: 'gear-making',
      energyRequired: 1,
      ingredients: [{ type: 'item', name: 'copper-plate', amount: 1 }],
      outputs: [{ type: 'item', name: 'gear', amount: 1 }],
    }],
    machineCatalog: [{ name: 'machine', craftingSpeed: 1 }],
    productionNodes: [{ id: 'gear-line', recipeName: 'gear-making', machineName: 'machine' }],
  };

  const withoutInput = await solve(config);
  assert.equal(withoutInput.status, 'infeasible');
  assert.deepEqual(withoutInput.machineCounts, {});
  assert.deepEqual(withoutInput.lineRates, []);

  const withInput = await solve({ ...config, inputs: [{ type: 'item', name: 'copper-plate' }] });
  assert.equal(withInput.status, 'optimal');
  assert.equal(withInput.inputRates[0].rate, 60);
});

test('step 7 solves a kovarex-style material cycle and rejects an infeasible cycle', async () => {
  const kovarex = await solve({
    goals: [{ material: { type: 'item', name: 'uranium-235' }, targetRate: 60 }],
    inputs: [{ type: 'item', name: 'uranium-238' }],
    recipeCatalog: [{
      name: 'kovarex-enrichment-process',
      energyRequired: 1,
      ingredients: [
        { type: 'item', name: 'uranium-235', amount: 40 },
        { type: 'item', name: 'uranium-238', amount: 5 },
      ],
      outputs: [
        { type: 'item', name: 'uranium-235', amount: 41 },
        { type: 'item', name: 'uranium-238', amount: 2 },
      ],
    }],
    machineCatalog: [{ name: 'centrifuge', craftingSpeed: 1 }],
    productionNodes: [{ id: 'kovarex', recipeName: 'kovarex-enrichment-process', machineName: 'centrifuge' }],
  });
  assert.equal(kovarex.status, 'optimal');
  assert.equal(kovarex.machineCounts.kovarex, 1);
  assert.equal(kovarex.inputRates[0].rate, 180);

  const cycle = (aOutput) => ({
    goals: [{ material: { type: 'item', name: 'a' }, targetRate: 60 }],
    recipeCatalog: [
      { name: 'make-a', energyRequired: 1, ingredients: [{ type: 'item', name: 'b', amount: 1 }], outputs: [{ type: 'item', name: 'a', amount: aOutput }] },
      { name: 'make-b', energyRequired: 1, ingredients: [{ type: 'item', name: 'a', amount: 1 }], outputs: [{ type: 'item', name: 'b', amount: 1 }] },
    ],
    machineCatalog: [{ name: 'machine', craftingSpeed: 1 }],
    productionNodes: [
      { id: 'a-line', recipeName: 'make-a', machineName: 'machine' },
      { id: 'b-line', recipeName: 'make-b', machineName: 'machine' },
    ],
  });
  assert.equal((await solve(cycle(2))).status, 'optimal');
  const infeasibleCycle = await solve(cycle(1));
  assert.equal(infeasibleCycle.status, 'infeasible');
  assert.deepEqual(infeasibleCycle.machineCounts, {});
});

test('step 7 includes module effects and deterministic duplicate production choices', async () => {
  const config = {
    goals: [{ material: { type: 'item', name: 'product' }, targetRate: 120 }],
    inputs: [{ type: 'item', name: 'ore' }],
    recipeCatalog: [{
      name: 'make-product',
      energyRequired: 1,
      ingredients: [{ type: 'item', name: 'ore', amount: 1 }],
      outputs: [{ type: 'item', name: 'product', amount: 1 }],
    }],
    machineCatalog: [{ name: 'machine', craftingSpeed: 1 }],
    productionNodes: [{
      id: 'module-line',
      recipeName: 'make-product',
      machineName: 'machine',
      modules: [{ name: 'speed-module', speed: 1, count: 1 }],
      beacons: [{ speed: 1, count: 1 }],
    }],
  };
  const effected = await solve(config);
  assert.equal(effected.status, 'optimal');
  assert.equal(effected.machineCounts['module-line'], 1);
  assert.equal(effected.lineRates[0].totalOutputRate.product, 180);

  const duplicate = {
    ...config,
    productionNodes: [
      { id: 'a-line', recipeName: 'make-product', machineName: 'machine' },
      { id: 'b-line', recipeName: 'make-product', machineName: 'machine' },
    ],
  };
  const first = await solve(duplicate);
  const second = await solve(duplicate);
  assert.deepEqual(first.machineCounts, { 'a-line': 0, 'b-line': 2 });
  assert.deepEqual(second.machineCounts, first.machineCounts);
  assert.equal(first.totalMachines, 2);
});

test('step 7 resolves manually linked beacon modules into production rates', async () => {
  const result = await solve({
    goals: [{ material: { type: 'item', name: 'product' }, targetRate: 90 }],
    inputs: [{ type: 'item', name: 'ore' }],
    recipeCatalog: [{
      name: 'make-product',
      energyRequired: 1,
      ingredients: [{ type: 'item', name: 'ore', amount: 1 }],
      outputs: [{ type: 'item', name: 'product', amount: 1 }],
    }],
    machineCatalog: [{ name: 'machine', craftingSpeed: 1 }],
    moduleCatalog: [{ name: 'speed-module', effects: { speed: 1 } }],
    beaconCatalog: [{ name: 'beacon', distributionEffectivity: 0.5, allowedEffects: ['speed'] }],
    beaconNodes: [{ id: 'beacon-1', name: 'beacon', modules: [{ name: 'speed-module', count: 1 }] }],
    productionNodes: [{ id: 'linked-line', recipeName: 'make-product', machineName: 'machine', beaconIds: ['beacon-1'] }],
  });

  assert.equal(result.status, 'optimal');
  assert.equal(result.machineCounts['linked-line'], 1);
  assert.equal(result.lineRates[0].totalOutputRate.product, 90);
});

test('step 7 rebalances automation production as ore, plate, and gear become inputs', async () => {
  const base = {
    goals: [{ material: { type: 'item', name: 'automation-science-pack' }, targetRate: 60 }],
    recipeCatalog: [
      { name: 'iron-smelting', energyRequired: 1, ingredients: [{ type: 'item', name: 'iron-ore', amount: 1 }], outputs: [{ type: 'item', name: 'iron-plate', amount: 1 }] },
      { name: 'copper-smelting', energyRequired: 1, ingredients: [{ type: 'item', name: 'copper-ore', amount: 1 }], outputs: [{ type: 'item', name: 'copper-plate', amount: 1 }] },
      { name: 'gear-making', energyRequired: 1, ingredients: [{ type: 'item', name: 'iron-plate', amount: 2 }], outputs: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }] },
      { name: 'automation-science', energyRequired: 1, ingredients: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }, { type: 'item', name: 'copper-plate', amount: 1 }], outputs: [{ type: 'item', name: 'automation-science-pack', amount: 1 }] },
    ],
    machineCatalog: [{ name: 'machine', craftingSpeed: 1 }],
    productionNodes: [
      { id: 'iron-smelter', recipeName: 'iron-smelting', machineName: 'machine' },
      { id: 'copper-smelter', recipeName: 'copper-smelting', machineName: 'machine' },
      { id: 'gear-line', recipeName: 'gear-making', machineName: 'machine' },
      { id: 'science-line', recipeName: 'automation-science', machineName: 'machine' },
    ],
  };

  const oreInputs = await solve({ ...base, inputs: [{ type: 'item', name: 'iron-ore' }, { type: 'item', name: 'copper-ore' }] });
  assert.equal(oreInputs.totalMachines, 5);
  assert.equal(oreInputs.machineCounts['iron-smelter'], 2);
  assert.equal(oreInputs.machineCounts['copper-smelter'], 1);

  const plateInputs = await solve({ ...base, inputs: [{ type: 'item', name: 'iron-plate' }, { type: 'item', name: 'copper-plate' }] });
  assert.equal(plateInputs.totalMachines, 2);
  assert.equal(plateInputs.machineCounts['iron-smelter'], 0);
  assert.equal(plateInputs.machineCounts['copper-smelter'], 0);
  assert.equal(plateInputs.inputRates.find((entry) => entry.material.name === 'iron-plate').rate, 120);

  const gearInputs = await solve({ ...base, inputs: [{ type: 'item', name: 'iron-gear-wheel' }, { type: 'item', name: 'copper-plate' }] });
  assert.equal(gearInputs.totalMachines, 1);
  assert.equal(gearInputs.machineCounts['gear-line'], 0);
  assert.equal(gearInputs.inputRates.find((entry) => entry.material.name === 'iron-gear-wheel').rate, 60);
});

test('step 7 reports co-product fluoroketone only when no selected line consumes it', async () => {
  const config = {
    goals: [{ material: { type: 'item', name: 'cryogenic-science-pack' }, targetRate: 60 }],
    inputs: [{ type: 'item', name: 'ice' }],
    recipeCatalog: [
      { name: 'cryogenic-science', energyRequired: 1, ingredients: [{ type: 'item', name: 'ice', amount: 1 }], outputs: [{ type: 'item', name: 'cryogenic-science-pack', amount: 1 }, { type: 'fluid', name: 'fluoroketone', amount: 1 }] },
      { name: 'cryogenic-processing', energyRequired: 1, ingredients: [{ type: 'fluid', name: 'fluoroketone', amount: 1 }], outputs: [{ type: 'fluid', name: 'cryogenic-fluid', amount: 1 }] },
    ],
    machineCatalog: [{ name: 'machine', craftingSpeed: 1 }],
    productionNodes: [
      { id: 'science-line', recipeName: 'cryogenic-science', machineName: 'machine' },
      { id: 'cryogenic-plant', recipeName: 'cryogenic-processing', machineName: 'machine' },
    ],
  };

  const noPlantGoal = await solve(config);
  assert.equal(noPlantGoal.outputRates.find((entry) => entry.material.name === 'fluoroketone').rate, 60);

  const withPlantGoal = await solve({
    ...config,
    goals: [...config.goals, { material: { type: 'fluid', name: 'cryogenic-fluid' }, targetRate: 60 }],
  });
  assert.equal(withPlantGoal.machineCounts['cryogenic-plant'], 1);
  assert.equal(withPlantGoal.outputRates.some((entry) => entry.material.name === 'fluoroketone'), false);
});

test('step 7 allows the same product to be solved independently in separate malls', async () => {
  const makeMall = (id) => ({
    goals: [{ material: { type: 'item', name: 'gear' }, targetRate: 60 }],
    inputs: [{ type: 'item', name: 'iron-plate' }],
    recipeCatalog: [{ name: 'gear-making', energyRequired: 1, ingredients: [{ type: 'item', name: 'iron-plate', amount: 1 }], outputs: [{ type: 'item', name: 'gear', amount: 1 }] }],
    machineCatalog: [{ name: 'machine', craftingSpeed: 1 }],
    productionNodes: [{ id, recipeName: 'gear-making', machineName: 'machine' }],
  });
  const [mallOne, mallTwo] = await Promise.all([solve(makeMall('mall-one-line')), solve(makeMall('mall-two-line'))]);

  assert.equal(mallOne.status, 'optimal');
  assert.equal(mallTwo.status, 'optimal');
  assert.equal(mallOne.machineCounts['mall-one-line'], 1);
  assert.equal(mallTwo.machineCounts['mall-two-line'], 1);
});