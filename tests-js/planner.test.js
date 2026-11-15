import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertOptionalLimit,
  assertProfile,
  buildMallGraph,
  createStableId,
  datasetStorageKey,
  materialKey,
  promoteMaterialToInput,
} from '../src/planner.js';

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