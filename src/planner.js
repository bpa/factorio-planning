export const CRAFTING_STORAGE_KEY = 'factorio-crafting-mall-v1';
export const DATASETS = Object.freeze(['base', 'space-age']);

export function createStableId() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('A secure UUID generator is required to create planner IDs.');
  }
  return globalThis.crypto.randomUUID();
}

export function assertOptionalLimit(value, name, integer = false) {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new TypeError(`${name} must be null or a non-negative${integer ? ' integer' : ' number'}.`);
  }
}

export function assertProfile(profile) {
  if (!profile || typeof profile.id !== 'string' || !profile.id || typeof profile.name !== 'string' || !profile.name.trim()) {
    throw new TypeError('A profile requires a stable ID and a non-empty name.');
  }
  assertOptionalLimit(profile.maxFootprint, 'maxFootprint');
  assertOptionalLimit(profile.maxIO, 'maxIO', true);
  return profile;
}

export function materialKey(material) {
  if (!material || !['item', 'fluid'].includes(material.type) || typeof material.name !== 'string' || !material.name) {
    throw new TypeError('A material requires type "item" or "fluid" and a non-empty name.');
  }
  return JSON.stringify([material.type, material.name]);
}

export function datasetStorageKey(dataset) {
  if (!DATASETS.includes(dataset)) throw new TypeError(`Unsupported dataset: ${dataset}`);
  return `${CRAFTING_STORAGE_KEY}:${dataset}`;
}