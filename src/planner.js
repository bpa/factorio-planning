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

export function normalizeMaterialRef(material) {
  if (!material || !['item', 'fluid'].includes(material.type) || typeof material.name !== 'string' || !material.name.trim()) {
    throw new TypeError('A material requires type "item" or "fluid" and a non-empty name.');
  }
  return { type: material.type, name: material.name };
}

export function materialKey(material) {
  const normalized = normalizeMaterialRef(material);
  return JSON.stringify([normalized.type, normalized.name]);
}

export function normalizeGoal(goal) {
  if (!goal || !goal.material) {
    throw new TypeError('A goal requires a material reference.');
  }
  const material = normalizeMaterialRef(goal.material);
  const targetRate = Number(goal.targetRate ?? 0);
  if (!Number.isFinite(targetRate) || targetRate < 0) {
    throw new TypeError('A goal requires a finite non-negative target rate.');
  }
  return { material, targetRate };
}

export function normalizeProductionNode(node) {
  const recipeName = typeof node?.recipeName === 'string' && node.recipeName ? node.recipeName : (typeof node?.name === 'string' ? node.name : 'unnamed-recipe');
  const normalized = {
    id: typeof node?.id === 'string' && node.id ? node.id : `${recipeName}:${createStableId()}`,
    recipeName,
    machineName: typeof node?.machineName === 'string' ? node.machineName : null,
    modules: Array.isArray(node?.modules) ? node.modules.map((module) => ({
      name: typeof module?.name === 'string' ? module.name : '',
      count: Number(module?.count ?? 0),
    })).filter((module) => module.name && Number.isFinite(module.count) && module.count >= 0) : [],
    beaconIds: Array.isArray(node?.beaconIds) ? node.beaconIds.filter((beaconId) => typeof beaconId === 'string') : [],
    position: node?.position && typeof node.position === 'object' ? { x: Number(node.position.x ?? 0), y: Number(node.position.y ?? 0) } : null,
    ingredients: Array.isArray(node?.ingredients) ? node.ingredients.map(normalizeMaterialRef) : [],
    outputs: Array.isArray(node?.outputs) ? node.outputs.map(normalizeMaterialRef) : [],
  };
  return normalized;
}

export function datasetStorageKey(dataset) {
  if (!DATASETS.includes(dataset)) throw new TypeError(`Unsupported dataset: ${dataset}`);
  return `${CRAFTING_STORAGE_KEY}:${dataset}`;
}

function uniqueMaterials(materials) {
  const seen = new Set();
  const result = [];
  for (const material of materials) {
    const key = materialKey(material);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalizeMaterialRef(material));
  }
  return result;
}

function collectMaterialKeysFromNodes(productionNodes) {
  const result = new Set();
  for (const node of productionNodes) {
    for (const material of node.ingredients) result.add(materialKey(material));
    for (const material of node.outputs) result.add(materialKey(material));
  }
  return result;
}

function buildAdjacency(productionNodes) {
  const adjacency = new Map();
  const materialNames = new Set();
  const ensure = (material) => {
    const key = materialKey(material);
    materialNames.add(key);
    if (!adjacency.has(key)) adjacency.set(key, new Set());
    return key;
  };

  for (const node of productionNodes) {
    const outputs = node.outputs.map((material) => ensure(material));
    const inputs = node.ingredients.map((material) => ensure(material));
    for (const output of outputs) {
      for (const input of inputs) {
        adjacency.get(output)?.add(input);
      }
    }
  }

  return { adjacency, materialNames };
}

function collectCycleGroups(productionNodes) {
  const { adjacency, materialNames } = buildAdjacency(productionNodes);
  const nodes = [...materialNames];
  const index = new Map();
  const lowLink = new Map();
  const stack = [];
  const onStack = new Set();
  const groups = [];
  let visitId = 0;

  function strongConnect(node) {
    index.set(node, visitId);
    lowLink.set(node, visitId);
    visitId += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) || []) {
      if (!index.has(next)) {
        strongConnect(next);
        lowLink.set(node, Math.min(lowLink.get(node), lowLink.get(next)));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node), index.get(next)));
      }
    }

    if (lowLink.get(node) !== index.get(node)) return;

    const group = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      group.push(current);
    } while (current !== node);

    if (group.length > 1) {
      groups.push(group.map((key) => JSON.parse(key)[1]));
    }
  }

  for (const node of nodes) {
    if (!index.has(node)) strongConnect(node);
  }

  return groups;
}

function buildMaterialMap(productionNodes) {
  const map = new Map();
  for (const node of productionNodes) {
    for (const material of [...node.ingredients, ...node.outputs]) {
      const key = materialKey(material);
      if (!map.has(key)) {
        map.set(key, { material: normalizeMaterialRef(material), key, upstream: [], downstream: [] });
      }
    }
  }

  for (const node of productionNodes) {
    for (const ingredient of node.ingredients) {
      const ingredientKey = materialKey(ingredient);
      const nodeKey = node.id;
      if (!map.has(ingredientKey)) map.set(ingredientKey, { material: normalizeMaterialRef(ingredient), key: ingredientKey, upstream: [], downstream: [] });
      map.get(ingredientKey).downstream.push(nodeKey);
      if (!map.has(nodeKey)) map.set(nodeKey, { material: null, key: nodeKey, upstream: [], downstream: [] });
    }
    for (const output of node.outputs) {
      const outputKey = materialKey(output);
      const nodeKey = node.id;
      if (!map.has(outputKey)) map.set(outputKey, { material: normalizeMaterialRef(output), key: outputKey, upstream: [], downstream: [] });
      map.get(outputKey).upstream.push(nodeKey);
      if (!map.has(nodeKey)) map.set(nodeKey, { material: null, key: nodeKey, upstream: [], downstream: [] });
    }
  }

  return map;
}

function determineAutoSinkGoals(goals, inputs, productionNodes) {
  const goalKeys = new Set(goals.map((goal) => materialKey(goal.material)));
  const inputKeys = new Set(inputs.map((material) => materialKey(material)));
  const materialMap = buildMaterialMap(productionNodes);
  const downstream = new Map();

  for (const node of productionNodes) {
    for (const output of node.outputs) {
      const outputKey = materialKey(output);
      const dependsOn = new Set(node.ingredients.map((ingredient) => materialKey(ingredient)));
      downstream.set(outputKey, dependsOn);
    }
  }

  const sinkGoals = [];
  for (const [key, record] of materialMap.entries()) {
    if (!record.material) continue;
    if (goalKeys.has(key) || inputKeys.has(key)) continue;
    const outputUses = productionNodes.filter((node) => node.outputs.some((material) => materialKey(material) === key));
    if (!outputUses.length) continue;
    const usedByRecipe = productionNodes.some((node) => node.ingredients.some((material) => materialKey(material) === key));
    const isSink = !usedByRecipe;
    if (!isSink) continue;
    const currentRate = outputUses.length ? outputUses.reduce((sum, node) => sum + node.outputs.filter((material) => materialKey(material) === key).length, 0) : 1;
    sinkGoals.push({ material: record.material, targetRate: currentRate });
  }

  return sinkGoals;
}

export function buildMallGraph(config = {}) {
  const goals = (config.goals || []).map(normalizeGoal);
  const inputs = uniqueMaterials((config.inputs || []).map(normalizeMaterialRef));
  const productionNodes = (config.productionNodes || []).map(normalizeProductionNode);
  const autoSinkGoals = determineAutoSinkGoals(goals, inputs, productionNodes);
  const cycleGroups = collectCycleGroups(productionNodes);

  const materialNodes = [...new Set([
    ...collectMaterialKeysFromNodes(productionNodes),
    ...goals.map((goal) => materialKey(goal.material)),
    ...inputs.map((material) => materialKey(material)),
  ])].map((key) => {
    const material = JSON.parse(key);
    return { type: material[0], name: material[1], key };
  });

  return {
    goals,
    inputs,
    productionNodes,
    autoSinkGoals,
    cycleGroups,
    materialNodes,
    nodeCount: productionNodes.length,
    externalInputKeys: new Set(inputs.map((material) => materialKey(material))),
    goalKeys: new Set(goals.map((goal) => materialKey(goal.material))),
  };
}

export function deriveMallGraph(config = {}) {
  return buildMallGraph(config);
}

export function resolveMaterialGraph(config = {}) {
  return buildMallGraph(config);
}

export function promoteMaterialToInput(graph, material) {
  const target = normalizeMaterialRef(material);
  const targetKey = materialKey(target);
  const queue = [targetKey];
  const removeRecipeIds = new Set();

  while (queue.length) {
    const currentKey = queue.pop();
    for (const node of graph.productionNodes) {
      if (node.outputs.some((candidate) => materialKey(candidate) === currentKey)) {
        removeRecipeIds.add(node.id);
        for (const ingredient of node.ingredients) {
          queue.push(materialKey(ingredient));
        }
      }
    }
  }

  const nextProductionNodes = graph.productionNodes.filter((node) => !removeRecipeIds.has(node.id));
  const nextInputs = uniqueMaterials([...graph.inputs, target]);
  return buildMallGraph({
    goals: graph.goals,
    inputs: nextInputs,
    productionNodes: nextProductionNodes,
  });
}

export function promoteInputToExternal(graph, material) {
  return promoteMaterialToInput(graph, material);
}

export function deriveAutoSinkGoals(graph) {
  return determineAutoSinkGoals(graph.goals, graph.inputs, graph.productionNodes);
}

export function autoSinkGoals(graph) {
  return deriveAutoSinkGoals(graph);
}

export function findCycleGroups(graph) {
  return graph.cycleGroups || collectCycleGroups(graph.productionNodes || []);
}

export function collectDecisionCycles(graph) {
  return findCycleGroups(graph);
}
