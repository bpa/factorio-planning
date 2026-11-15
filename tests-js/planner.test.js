import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertOptionalLimit,
  assertProfile,
  createStableId,
  datasetStorageKey,
  materialKey,
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