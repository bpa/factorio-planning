import GLPK from 'glpk.js';

export const CRAFTING_STORAGE_KEY = 'factorio-crafting-mall-v1';
export const DATASETS = Object.freeze(['base', 'space-age']);

let glpkPromise;

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

function safeNumber(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveMaterialRef(material) {
  if (!material) return null;
  if (typeof material === 'string') return { type: 'item', name: material };
  if (!material.name || typeof material.name !== 'string') return null;
  const type = material.type && ['item', 'fluid'].includes(material.type) ? material.type : 'item';
  return { type, name: material.name };
}

function materialRateMapEntry(material) {
  const resolved = resolveMaterialRef(material);
  if (!resolved) return null;
  return {
    name: resolved.name,
    type: resolved.type,
    key: materialKey(resolved),
  };
}

function assignRateEntry(target, material, value) {
  const entry = materialRateMapEntry(material);
  if (!entry) return target;
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return target;
  target[entry.name] = (target[entry.name] ?? 0) + numeric;
  target[entry.key] = (target[entry.key] ?? 0) + numeric;
  return target;
}

function collectModuleEffect(module, effectName) {
  if (!module) return 0;
  const moduleObject = module.effects || module.effect || module;
  if (moduleObject && typeof moduleObject === 'object' && effectName in moduleObject) {
    const value = moduleObject[effectName];
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object') {
      if (typeof value.bonus === 'number') return value.bonus;
      if (typeof value.value === 'number') return value.value;
    }
  }
  if (typeof module[effectName] === 'number') return module[effectName];
  const name = typeof module.name === 'string' ? module.name.toLowerCase() : '';
  const defaults = {
    'speed-module': { speed: 0.5 },
    'speed-module-2': { speed: 0.6 },
    'speed-module-3': { speed: 0.7 },
    'productivity-module': { productivity: 0.04 },
    'productivity-module-2': { productivity: 0.06 },
    'productivity-module-3': { productivity: 0.08 },
    'efficiency-module': { efficiency: 0.3 },
    'efficiency-module-2': { efficiency: 0.4 },
    'efficiency-module-3': { efficiency: 0.5 },
    'beacon': { speed: 0.05 },
  };
  if (defaults[name]) {
    const effect = defaults[name][effectName];
    if (typeof effect === 'number') return effect;
  }
  return 0;
}

function aggregateModuleEffects(modules = [], beacons = []) {
  const entries = [...modules, ...beacons];
  const totals = { speed: 0, productivity: 0, efficiency: 0 };
  for (const entry of entries) {
    const count = safeNumber(entry?.count ?? entry?.amount ?? 1, 1);
    totals.speed += count * collectModuleEffect(entry, 'speed');
    totals.productivity += count * collectModuleEffect(entry, 'productivity');
    totals.efficiency += count * collectModuleEffect(entry, 'efficiency');
  }
  return totals;
}

function getCraftingSpeed(machine) {
  if (!machine) return 1;
  if (typeof machine.craftingSpeed === 'number') return machine.craftingSpeed;
  if (typeof machine.speed === 'number') return machine.speed;
  return 1;
}

function getRecipeEnergy(recipe) {
  if (!recipe) return 1;
  if (typeof recipe.energyRequired === 'number') return recipe.energyRequired;
  if (typeof recipe.energy === 'number') return recipe.energy;
  if (typeof recipe.time === 'number') return recipe.time;
  return 1;
}

function materialAmountValue(material) {
  if (!material) return 0;
  if (typeof material.amount === 'number' && Number.isFinite(material.amount)) return material.amount;
  const minimum = safeNumber(material.amountMin ?? material.amount ?? 0, 0);
  const maximum = safeNumber(material.amountMax ?? material.amount ?? minimum, minimum);
  const probability = safeNumber(material.probability ?? 1, 1);
  return ((minimum + maximum) / 2) * probability;
}

function isCompatibleMachine(machine, recipe) {
  if (!machine || !recipe) return false;
  const machineCategories = new Set(Array.isArray(machine.craftingCategories) ? machine.craftingCategories : []);
  const recipeCategories = new Set(Array.isArray(recipe.categories) ? recipe.categories : []);
  const overlaps = [...recipeCategories].some((category) => machineCategories.has(category));
  if (Array.isArray(machine.craftingCategories) && machine.craftingCategories.length && !overlaps) return false;
  const recipeIngredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const recipeOutputs = Array.isArray(recipe.outputs) ? recipe.outputs : [];
  const usesFluid = recipeIngredients.some((ingredient) => (ingredient?.type ?? 'item') === 'fluid') || recipeOutputs.some((output) => (output?.type ?? 'item') === 'fluid');
  if (!usesFluid) return true;
  if (typeof machine.fluidInput === 'boolean' || typeof machine.fluidOutput === 'boolean') {
    const needsAnyFluidPort = recipeIngredients.some((ingredient) => (ingredient?.type ?? 'item') === 'fluid') || recipeOutputs.some((output) => (output?.type ?? 'item') === 'fluid');
    if (needsAnyFluidPort && machine.fluidInput === false && machine.fluidOutput === false) return false;
  }
  return true;
}

function materialNameForKey(material) {
  const resolved = resolveMaterialRef(material);
  return resolved ? resolved.name : null;
}

export function calculateCraftDuration(recipe, machine = {}) {
  const energy = getRecipeEnergy(recipe);
  const speed = getCraftingSpeed(machine);
  return energy / speed;
}

export function calculateProductionRate(options = {}) {
  const {
    recipe = {},
    machine = {},
    modules = [],
    beacons = [],
    machineCount = 1,
    moduleCatalog = [],
    beaconCatalog = [],
  } = options;

  const machineSpeed = getCraftingSpeed(machine);
  const energyRequired = getRecipeEnergy(recipe);
  const moduleEffects = aggregateModuleEffects(modules, beacons);
  const speedMultiplier = 1 + moduleEffects.speed;
  const productivityBonus = recipe.allowProductivity || recipe.allow_productivity ? (1 + moduleEffects.productivity) : 1;
  const effectiveSpeed = machineSpeed * speedMultiplier;
  const craftDuration = energyRequired / effectiveSpeed;
  const totalOutputRate = {};
  const totalInputRate = {};

  const outputs = Array.isArray(recipe.outputs) ? recipe.outputs : [];
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

  for (const output of outputs) {
    const material = resolveMaterialRef(output) || { type: 'item', name: output?.name || output?.material || 'unknown' };
    const outputAmount = materialAmountValue(output) * productivityBonus;
    if (outputAmount <= 0) continue;
    const rate = safeNumber(machineCount, 1) * outputAmount * effectiveSpeed / energyRequired * 60;
    assignRateEntry(totalOutputRate, material, rate);
  }

  for (const ingredient of ingredients) {
    const material = resolveMaterialRef(ingredient) || { type: 'item', name: ingredient?.name || ingredient?.material || 'unknown' };
    const amount = materialAmountValue(ingredient);
    if (amount <= 0) continue;
    const rate = safeNumber(machineCount, 1) * amount * effectiveSpeed / energyRequired * 60;
    assignRateEntry(totalInputRate, material, rate);
  }

  return {
    craftDuration,
    machineSpeed,
    effectiveSpeed,
    productivityBonus,
    totalOutputRate,
    totalInputRate,
    outputRate: totalOutputRate,
    inputRate: totalInputRate,
    recipeName: recipe.name || recipe.recipeName || '',
    machineName: machine.name || machine.machineName || '',
    machineCount: safeNumber(machineCount, 1),
    moduleEffects,
    moduleCatalog,
    beaconCatalog,
  };
}

function normalizeRecipeCandidate(recipe) {
  return {
    name: recipe?.name || recipe?.recipeName || 'unknown-recipe',
    categories: Array.isArray(recipe?.categories) ? recipe.categories : [],
    allowProductivity: Boolean(recipe?.allowProductivity ?? recipe?.allow_productivity ?? false),
    ingredients: Array.isArray(recipe?.ingredients) ? recipe.ingredients : [],
    outputs: Array.isArray(recipe?.outputs) ? recipe.outputs : [],
    energyRequired: safeNumber(recipe?.energyRequired ?? recipe?.energy ?? recipe?.time ?? 1, 1),
  };
}

export function calculateMallRates(config = {}) {
  const goals = Array.isArray(config.goals) ? config.goals : [];
  const inputs = Array.isArray(config.inputs) ? config.inputs : [];
  const productionNodes = Array.isArray(config.productionNodes) ? config.productionNodes : [];
  const recipeCatalog = Array.isArray(config.recipeCatalog) ? config.recipeCatalog : [];
  const machineCatalog = Array.isArray(config.machineCatalog) ? config.machineCatalog : [];
  const totalOutput = {};
  const totalInput = {};
  const netFlow = {};
  const lineRates = [];

  for (const node of productionNodes) {
    const recipeLookup = recipeCatalog.find((candidate) => candidate?.name === node?.recipeName || candidate?.recipeName === node?.recipeName);
    const machineLookup = machineCatalog.find((candidate) => candidate?.name === node?.machineName || candidate?.machineName === node?.machineName);
    const recipe = normalizeRecipeCandidate(node?.recipe || node?.recipeDetails || recipeLookup || {
      name: node?.recipeName,
      categories: node?.categories,
      allowProductivity: node?.allowProductivity,
      energyRequired: node?.energyRequired ?? node?.energy,
      ingredients: node?.ingredients,
      outputs: node?.outputs,
    });
    const machine = {
      name: node?.machineName || node?.machine || machineLookup?.name || '',
      craftingSpeed: node?.craftingSpeed ?? node?.speed ?? machineLookup?.craftingSpeed ?? machineLookup?.speed ?? 1,
      craftingCategories: Array.isArray(node?.craftingCategories) ? node?.craftingCategories : (Array.isArray(node?.machineCategories) ? node?.machineCategories : (Array.isArray(machineLookup?.craftingCategories) ? machineLookup.craftingCategories : [])),
      fluidInput: node?.fluidInput ?? machineLookup?.fluidInput,
      fluidOutput: node?.fluidOutput ?? machineLookup?.fluidOutput,
    };
    const line = calculateProductionRate({
      recipe,
      machine,
      modules: Array.isArray(node?.modules) ? node.modules : [],
      beacons: Array.isArray(node?.beacons) ? node.beacons : [],
      machineCount: safeNumber(node?.machineCount ?? node?.count ?? 1, 1),
    });
    lineRates.push({
      id: node?.id || node?.recipeName || recipe.name,
      recipeName: recipe.name,
      machineName: machine.name,
      ...line,
    });
    for (const [materialKeyName, value] of Object.entries(line.totalOutputRate)) {
      const numeric = Number(value ?? 0);
      if (!Number.isFinite(numeric)) continue;
      if (materialKeyName in totalOutput) totalOutput[materialKeyName] += numeric;
      else totalOutput[materialKeyName] = numeric;
      const materialName = materialKeyName.includes(':') ? materialKeyName.split(':').slice(1).join(':') : materialKeyName;
      if (materialName && !(materialName in totalOutput)) totalOutput[materialName] = numeric;
    }
    for (const [materialKeyName, value] of Object.entries(line.totalInputRate)) {
      const numeric = Number(value ?? 0);
      if (!Number.isFinite(numeric)) continue;
      if (materialKeyName in totalInput) totalInput[materialKeyName] += numeric;
      else totalInput[materialKeyName] = numeric;
      const materialName = materialKeyName.includes(':') ? materialKeyName.split(':').slice(1).join(':') : materialKeyName;
      if (materialName && !(materialName in totalInput)) totalInput[materialName] = numeric;
    }
  }

  for (const material of inputs) {
    const key = materialRateMapEntry(material)?.key;
    if (key && !(key in totalInput)) totalInput[key] = 0;
  }

  for (const goal of goals) {
    const material = goal?.material || goal;
    const entry = materialRateMapEntry(material);
    if (!entry) continue;
    const outputRate = Number(totalOutput[entry.key] ?? totalOutput[entry.name] ?? 0);
    const inputRate = Number(totalInput[entry.key] ?? totalInput[entry.name] ?? 0);
    netFlow[entry.key] = outputRate - inputRate;
    netFlow[entry.name] = outputRate - inputRate;
  }

  for (const [key, value] of Object.entries(totalOutput)) {
    const inputValue = Number(totalInput[key] ?? 0);
    netFlow[key] = (netFlow[key] ?? 0) + value - inputValue;
  }
  for (const [key, value] of Object.entries(totalInput)) {
    netFlow[key] = (netFlow[key] ?? 0) + 0 - value;
  }

  return {
    totalOutput,
    totalInput,
    netFlow,
    goals,
    inputs,
    lineRates,
    totalGoalTarget: goals.reduce((sum, goal) => sum + safeNumber(goal?.targetRate ?? goal?.rate ?? 0, 0), 0),
  };
}

function getCatalogEntry(catalog, name) {
  return catalog.find((entry) => entry?.name === name || entry?.machineName === name);
}

function resolveModuleChoice(choice, moduleCatalog) {
  const name = typeof choice?.name === 'string' ? choice.name : '';
  const catalogModule = getCatalogEntry(moduleCatalog, name);
  return { ...catalogModule, ...choice, name, count: safeNumber(choice?.count ?? 0) };
}

function resolveNodeEffects(node, config) {
  const moduleCatalog = Array.isArray(config.moduleCatalog) ? config.moduleCatalog : [];
  const beaconCatalog = Array.isArray(config.beaconCatalog) ? config.beaconCatalog : [];
  const beaconNodes = Array.isArray(config.beaconNodes) ? config.beaconNodes : [];
  const modules = (Array.isArray(node?.modules) ? node.modules : []).map((choice) => resolveModuleChoice(choice, moduleCatalog));
  const beacons = [...(Array.isArray(node?.beacons) ? node.beacons : [])];

  for (const beaconId of Array.isArray(node?.beaconIds) ? node.beaconIds : []) {
    const beaconNode = beaconNodes.find((candidate) => candidate?.id === beaconId);
    if (!beaconNode) continue;
    const prototype = getCatalogEntry(beaconCatalog, beaconNode.name) || {};
    const effectivity = safeNumber(prototype.distributionEffectivity ?? prototype.distribution_effectivity ?? 0.5, 0.5);
    const allowed = prototype.allowedEffects ?? prototype.allowed_effects;
    const allowedEffects = Array.isArray(allowed) ? new Set(allowed) : null;

    for (const choice of Array.isArray(beaconNode.modules) ? beaconNode.modules : []) {
      const module = resolveModuleChoice(choice, moduleCatalog);
      const effects = {};
      for (const effectName of ['speed', 'productivity', 'efficiency']) {
        if (allowedEffects && !allowedEffects.has(effectName)) continue;
        const effect = collectModuleEffect(module, effectName);
        if (effect) effects[effectName] = effect;
      }
      beacons.push({ name: beaconNode.name, count: module.count * effectivity, effects });
    }
  }

  return { modules, beacons };
}

function resolveSolverProductionLine(node, index, config) {
  const recipeCatalog = Array.isArray(config.recipeCatalog) ? config.recipeCatalog : [];
  const machineCatalog = Array.isArray(config.machineCatalog) ? config.machineCatalog : [];
  const recipeLookup = getCatalogEntry(recipeCatalog, node?.recipeName);
  const machineLookup = getCatalogEntry(machineCatalog, node?.machineName);
  const recipe = normalizeRecipeCandidate(node?.recipe || node?.recipeDetails || recipeLookup || {
    name: node?.recipeName,
    categories: node?.categories,
    allowProductivity: node?.allowProductivity,
    energyRequired: node?.energyRequired ?? node?.energy,
    ingredients: node?.ingredients,
    outputs: node?.outputs,
  });
  const machine = {
    name: node?.machineName || node?.machine || machineLookup?.name || '',
    craftingSpeed: node?.craftingSpeed ?? node?.speed ?? machineLookup?.craftingSpeed ?? machineLookup?.speed ?? 1,
  };
  const id = typeof node?.id === 'string' && node.id ? node.id : `${recipe.name}:${index}`;
  const effects = resolveNodeEffects(node, config);
  const line = calculateProductionRate({
    recipe,
    machine,
    modules: effects.modules,
    beacons: effects.beacons,
    machineCount: 1,
  });
  const inputKeys = new Set(recipe.ingredients.map((material) => materialKey(resolveMaterialRef(material))));
  const outputKeys = new Set(recipe.outputs.map((material) => materialKey(resolveMaterialRef(material))));
  const inputRates = new Map([...inputKeys].map((key) => [key, line.totalInputRate[key] || 0]));
  const outputRates = new Map([...outputKeys].map((key) => [key, line.totalOutputRate[key] || 0]));

  if (!(Number.isFinite(line.craftDuration) && line.craftDuration > 0)
    || [...inputRates.values(), ...outputRates.values()].some((rate) => !Number.isFinite(rate) || rate < 0)) {
    throw new TypeError(`Production node ${id} has invalid recipe or machine rates.`);
  }

  return { id, recipe, machine, effects, line, inputRates, outputRates };
}

function solverFailure(status, message) {
  return {
    status,
    message,
    machineCounts: {},
    totalMachines: null,
    materialRates: [],
    inputRates: [],
    outputRates: [],
    goalRates: [],
    lineRates: [],
  };
}

function materialFromKey(key) {
  const [type, name] = JSON.parse(key);
  return { type, name };
}

function buildSolverModel(glpk, lines, goals, inputs) {
  const materialMap = new Map();
  const selectedInputs = new Set(inputs.map((material) => materialKey(material)));
  const goalTargets = new Map();

  for (const goal of goals) {
    const normalized = normalizeGoal(goal);
    const key = materialKey(normalized.material);
    goalTargets.set(key, Math.max(goalTargets.get(key) || 0, normalized.targetRate));
    if (!materialMap.has(key)) materialMap.set(key, { material: normalized.material, coefficients: Array(lines.length).fill(0) });
  }

  lines.forEach((line, index) => {
    for (const [key, rate] of line.outputRates) {
      const entry = materialMap.get(key) || { material: materialFromKey(key), coefficients: Array(lines.length).fill(0) };
      entry.coefficients[index] += rate;
      materialMap.set(key, entry);
    }
    for (const [key, rate] of line.inputRates) {
      const entry = materialMap.get(key) || { material: materialFromKey(key), coefficients: Array(lines.length).fill(0) };
      entry.coefficients[index] -= rate;
      materialMap.set(key, entry);
    }
  });

  const subjectTo = [];
  let constraintIndex = 0;
  for (const [key, entry] of [...materialMap.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const target = goalTargets.get(key);
    if (target === undefined && selectedInputs.has(key)) continue;
    const coefficients = entry.coefficients
      .map((coef, index) => ({ name: `machines_${index}`, coef }))
      .filter((variable) => variable.coef !== 0);
    const lowerBound = target ?? 0;
    subjectTo.push({
      name: `material_${constraintIndex++}`,
      vars: coefficients,
      bnds: { type: glpk.GLP_LO, lb: lowerBound, ub: 0 },
    });
  }

  return { subjectTo, materialMap, goalTargets, selectedInputs };
}

async function solveSolverModel(glpk, name, variables, subjectTo, objectiveVariables, timeLimitSeconds, integer = true) {
  const model = {
    name,
    objective: { direction: glpk.GLP_MIN, name: 'minimize_machines', vars: objectiveVariables },
    subjectTo,
    bounds: variables.map((variable) => ({ name: variable, type: glpk.GLP_LO, lb: 0, ub: 0 })),
  };
  if (integer) model.generals = variables;
  return await glpk.solve(model, { msglev: glpk.GLP_MSG_OFF, presol: integer, tmlim: timeLimitSeconds });
}

function isOptimalResult(glpk, result) {
  return result?.result?.status === glpk.GLP_OPT;
}

export async function solveMallProduction(config = {}, options = {}) {
  let glpk;
  try {
    const timeLimitSeconds = Number(options.timeLimitSeconds ?? 10);
    if (!Number.isFinite(timeLimitSeconds) || timeLimitSeconds <= 0) {
      throw new TypeError('timeLimitSeconds must be a positive finite number.');
    }
    const deadline = Date.now() + timeLimitSeconds * 1000;
    const solveWithRemainingTime = (name, variables, subjectTo, objectiveVariables, integer = true) => {
      const remainingSeconds = (deadline - Date.now()) / 1000;
      if (remainingSeconds <= 0) return null;
      return solveSolverModel(glpk, name, variables, subjectTo, objectiveVariables, remainingSeconds, integer);
    };
    glpk = options.glpk || await (glpkPromise ||= GLPK());
    const goals = Array.isArray(config.goals) ? config.goals : [];
    const inputs = (Array.isArray(config.inputs) ? config.inputs : []).map(normalizeMaterialRef);
    const productionNodes = Array.isArray(config.productionNodes) ? config.productionNodes : [];
    const lines = productionNodes.map((node, index) => resolveSolverProductionLine(node, index, config));
    const ids = lines.map((line) => line.id);
    if (new Set(ids).size !== ids.length) {
      return solverFailure('solver-failure', 'Production node IDs must be unique.');
    }

    const variables = lines.map((_, index) => `machines_${index}`);
    const { subjectTo, materialMap, goalTargets, selectedInputs } = buildSolverModel(glpk, lines, goals, inputs);
    if (!variables.length) {
      if ([...goalTargets.values()].some((target) => target > 0)) {
        return solverFailure('infeasible', 'No production nodes can meet the requested goal rates.');
      }
      return {
        status: 'optimal',
        message: null,
        machineCounts: {},
        totalMachines: 0,
        materialRates: [],
        inputRates: [],
        outputRates: [],
        goalRates: [...goalTargets].map(([key, targetRate]) => ({ material: materialFromKey(key), targetRate, rate: 0 })),
        lineRates: [],
      };
    }

    const objective = variables.map((name) => ({ name, coef: 1 }));
    const relaxation = await solveWithRemainingTime('mall_material_feasibility', variables, subjectTo, objective, false);
    if (!relaxation) return solverFailure('solver-failure', 'The production solve exceeded its time limit.');
    if (relaxation.result.status === glpk.GLP_NOFEAS || relaxation.result.status === glpk.GLP_INFEAS) {
      return solverFailure('infeasible', 'The selected production choices cannot satisfy all material balances and goals.');
    }
    if (relaxation.result.status !== glpk.GLP_OPT) {
      return solverFailure('solver-failure', 'The solver could not verify material feasibility.');
    }

    const initial = await solveWithRemainingTime('mall_machine_counts', variables, subjectTo, objective);
    if (!initial) return solverFailure('solver-failure', 'The production solve exceeded its time limit.');
    if (!isOptimalResult(glpk, initial)) {
      const infeasible = initial?.result?.status === glpk.GLP_NOFEAS || initial?.result?.status === glpk.GLP_INFEAS;
      return solverFailure(infeasible ? 'infeasible' : 'solver-failure', infeasible ? 'The selected production choices cannot satisfy all material balances and goals.' : 'The production solver did not return an optimal solution.');
    }

    const totalMachines = Math.round(initial.result.z);
    const tiedSubjectTo = [...subjectTo, {
      name: 'minimum_total_machines',
      vars: variables.map((name) => ({ name, coef: 1 })),
      bnds: { type: glpk.GLP_FX, lb: totalMachines, ub: totalMachines },
    }];
    const tieBreakOrder = lines.map((line, index) => ({ id: line.id, index })).sort((left, right) => left.id.localeCompare(right.id));
    let finalResult = initial;
    for (const { index } of tieBreakOrder) {
      finalResult = await solveWithRemainingTime('mall_deterministic_tie_break', variables, tiedSubjectTo, [{ name: variables[index], coef: 1 }]);
      if (!finalResult) return solverFailure('solver-failure', 'The production solve exceeded its time limit during deterministic tie-breaking.');
      if (!isOptimalResult(glpk, finalResult)) {
        return solverFailure('solver-failure', 'The solver failed while applying deterministic tie-breaking.');
      }
      const count = Math.round(finalResult.result.vars[variables[index]] || 0);
      tiedSubjectTo.push({
        name: `fixed_tie_${index}`,
        vars: [{ name: variables[index], coef: 1 }],
        bnds: { type: glpk.GLP_FX, lb: count, ub: count },
      });
    }

    const machineCounts = {};
    const lineRates = [];
    const materialBalances = new Map([...materialMap].map(([key, entry]) => [key, { material: entry.material, productionRate: 0, consumptionRate: 0 }]));
    lines.forEach((line, index) => {
      const count = Math.round(finalResult.result.vars[variables[index]] || 0);
      machineCounts[line.id] = count;
      const calculated = calculateProductionRate({
        recipe: line.recipe,
        machine: line.machine,
        modules: line.effects.modules,
        beacons: line.effects.beacons,
        machineCount: count,
      });
      lineRates.push({ id: line.id, recipeName: line.recipe.name, machineName: line.machine.name, ...calculated });
      for (const [key, rate] of line.outputRates) materialBalances.get(key).productionRate += rate * count;
      for (const [key, rate] of line.inputRates) materialBalances.get(key).consumptionRate += rate * count;
    });

    const materialRates = [...materialBalances.values()].map((entry) => ({
      ...entry,
      netRate: entry.productionRate - entry.consumptionRate,
    })).sort((left, right) => materialKey(left.material).localeCompare(materialKey(right.material)));
    const inputRates = materialRates
      .filter((entry) => selectedInputs.has(materialKey(entry.material)) && entry.netRate < -1e-8)
      .map((entry) => ({ material: entry.material, rate: -entry.netRate }));
    const outputRates = materialRates
      .filter((entry) => entry.netRate > 1e-8)
      .map((entry) => ({ material: entry.material, rate: entry.netRate }));
    const goalRates = [...goalTargets].map(([key, targetRate]) => ({
      material: materialFromKey(key),
      targetRate,
      rate: materialBalances.get(key)?.productionRate - materialBalances.get(key)?.consumptionRate || 0,
    }));

    return { status: 'optimal', message: null, machineCounts, totalMachines, materialRates, inputRates, outputRates, goalRates, lineRates };
  } catch (error) {
    return solverFailure('solver-failure', error instanceof Error ? error.message : 'The production solver failed.');
  }
}

export function recommendProductionOptions(options = {}) {
  const goals = Array.isArray(options.goals) ? options.goals : [];
  const inputs = Array.isArray(options.inputs) ? options.inputs : [];
  const recipeCatalog = Array.isArray(options.recipeCatalog) ? options.recipeCatalog : [];
  const machineCatalog = Array.isArray(options.machineCatalog) ? options.machineCatalog : [];
  const eligibleRecipes = recipeCatalog.length ? recipeCatalog : [];
  const goalKeys = new Set(goals.map((goal) => materialKey(goal.material || goal)));
  const inputKeys = new Set(inputs.map((material) => materialKey(material)));

  const candidates = eligibleRecipes.map((recipe) => {
    const normalized = normalizeRecipeCandidate(recipe);
    const compatibleMachines = machineCatalog.filter((machine) => isCompatibleMachine(machine, normalized));
    const bestMachine = compatibleMachines[0] || null;
    const machineName = bestMachine ? (bestMachine.name || bestMachine.machineName || '') : 'unsupported';
    const matchingOutputs = normalized.outputs.filter((output) => goalKeys.has(materialKey(resolveMaterialRef(output))));
    const sharedInputs = normalized.ingredients.filter((ingredient) => inputKeys.has(materialKey(resolveMaterialRef(ingredient))));
    const newInputs = normalized.ingredients.filter((ingredient) => !inputKeys.has(materialKey(resolveMaterialRef(ingredient))));
    const line = bestMachine ? calculateProductionRate({ recipe: normalized, machine: bestMachine, machineCount: 1 }) : { totalOutputRate: {} };
    const outputRate = Object.values(line.totalOutputRate).reduce((sum, value) => sum + Number(value ?? 0), 0);
    let score = matchingOutputs.length * 100 + sharedInputs.length * 25 - newInputs.length * 5 + (bestMachine ? 10 : -50);
    if (normalized.categories.length && bestMachine) score += 5;
    const reasons = [];
    if (matchingOutputs.length) reasons.push(`matches target output ${matchingOutputs.map((output) => output.name || output.material || 'unknown').join(', ')}`);
    if (sharedInputs.length) reasons.push(`shares input ${sharedInputs.map((ingredient) => ingredient.name || ingredient.material || 'unknown').join(', ')}`);
    if (newInputs.length) reasons.push(`adds ${newInputs.length} new external input${newInputs.length === 1 ? '' : 's'}`);
    if (bestMachine) reasons.push(`compatible machine: ${machineName}`);
    else reasons.push('no compatible machine parsed for this recipe');
    return {
      recipeName: normalized.name,
      recipe: normalized,
      machineName,
      machine: bestMachine,
      score,
      outputRate,
      estimatedMachineCount: outputRate > 0 ? Math.ceil((goals[0]?.targetRate ?? 1) / Math.max(outputRate, 1e-6)) : 1,
      sharedInputs,
      newInputs,
      reasons,
    };
  });

  return candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return (left.recipeName || '').localeCompare(right.recipeName || '');
  });
}

export function recommendBestProductionOptions(options = {}) {
  return recommendProductionOptions(options);
}

export function findBestProductionRecommendation(options = {}) {
  return recommendProductionOptions(options);
}

export function buildRecommendation(options = {}) {
  return recommendProductionOptions(options);
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
