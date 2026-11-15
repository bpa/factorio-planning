import '@xyflow/react/dist/style.css';
import { Background, Controls, Handle, Position, ReactFlow } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import {
  CRAFTING_STORAGE_KEY,
  calculateProfileDensity,
  createMall,
  createProfile,
  datasetStorageKey,
  deleteProfile,
  getProfileSummary,
  normalizeBeaconNode,
  normalizeMall,
  normalizeMaterialRef,
  normalizeProfile,
  normalizeProductionNode,
  rankGoalSuggestions,
  recommendProductionOptions,
  toggleProductionNodeBeacon,
  updateProfile,
} from './planner.js';

const DATA_URL = `${import.meta.env.BASE_URL}data/`;
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function parseFormula(formula, level) {
  const tokens = formula.match(/\s*(?:\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|L|[()+\-*/^])/gy)?.map((token) => token.trim());
  if (!tokens || tokens.join('') !== formula.replace(/\s/g, '')) throw new Error('Unsupported count formula');
  let position = 0;
  function primary() {
    const token = tokens[position++];
    if (token === '(') {
      const value = expression();
      if (tokens[position++] !== ')') throw new Error('Unclosed formula');
      return value;
    }
    if (token === 'L') return level;
    if (token && /^\d/.test(token)) return Number(token);
    throw new Error('Unsupported count formula');
  }
  function power() {
    const value = primary();
    return tokens[position] === '^' ? (position++, value ** unary()) : value;
  }
  function unary() {
    if (tokens[position] === '+') { position++; return unary(); }
    if (tokens[position] === '-') { position++; return -unary(); }
    return power();
  }
  function product() {
    let value = unary();
    while (tokens[position] === '*' || tokens[position] === '/') {
      const operator = tokens[position++];
      const right = unary();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }
  function expression() {
    let value = product();
    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position++];
      const right = product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }
  const value = expression();
  if (position !== tokens.length || !Number.isFinite(value) || value < 0) throw new Error('Invalid formula');
  return value;
}

function isInfinite(technology) {
  return technology.maxLevel === 'infinite' || technology.countFormula !== null;
}

function technologyCount(technology, levels) {
  if (technology.countFormula) {
    let total = 0;
    for (let level = technology.initialLevel; level < technology.initialLevel + levels; level++) {
      total += parseFormula(technology.countFormula, level);
    }
    return total;
  }
  if (technology.count === null) return 0;
  return typeof technology.maxLevel === 'number' ? technology.count * technology.maxLevel : technology.count;
}

function ProductionNodeCard({ data }) {
  return <div className={`graph-node ${data?.selected ? 'selected' : ''}`}>
    <Handle type="target" position={Position.Left} />
    <div className="graph-node-header">{data?.label || 'Recipe'}</div>
    <div className="graph-node-body">{data?.subtitle || 'Machine'}</div>
    <Handle type="source" position={Position.Right} />
  </div>;
}

function MaterialNodeCard({ data }) {
  return <div className={`graph-node material-node ${data?.selected ? 'selected' : ''}`}>
    <Handle type="target" position={Position.Left} />
    <div className="graph-node-header">{data?.label || 'Material'}</div>
    <div className="graph-node-body">{data?.kind || 'material'} · {data?.subtitle || 'item'}</div>
    <Handle type="source" position={Position.Right} />
  </div>;
}

const productionNodeTypes = {
  production: ProductionNodeCard,
  material: MaterialNodeCard,
};

function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState('technology');
  const [mod, setMod] = useState('base');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [levels, setLevels] = useState(1);
  const [filter, setFilter] = useState('all');
  const [assignments, setAssignments] = useState({});
  const [malls, setMalls] = useState([]);
  const [activeMallId, setActiveMallId] = useState(null);
  const [newMallName, setNewMallName] = useState('');
  const [mallNameDraft, setMallNameDraft] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ id: null, name: '', maxFootprint: '', maxIO: '' });
  const [profileError, setProfileError] = useState('');
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState(null);
  const [selectedBeaconId, setSelectedBeaconId] = useState(null);
  const [graphDraft, setGraphDraft] = useState({ recipeName: '', machineName: '', modules: [] });
  const [beaconDraft, setBeaconDraft] = useState({ name: '', modules: [] });

  useEffect(() => {
    Promise.all([
      fetch(`${DATA_URL}technologies.json`).then((response) => {
        if (!response.ok) throw new Error('Could not load technology data.');
        return response.json();
      }),
      fetch(`${DATA_URL}crafting.json`).then((response) => {
        if (!response.ok) throw new Error('Could not load crafting data.');
        return response.json();
      }),
    ]).then(([technologies, crafting]) => setData({ technologies, crafting }))
      .catch((error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(datasetStorageKey(mod))
        || (mod === 'space-age' ? localStorage.getItem(CRAFTING_STORAGE_KEY) : null);
      const parsed = saved ? JSON.parse(saved) : {};
      const state = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ('assignments' in parsed || 'profiles' in parsed || 'activeProfileId' in parsed || 'malls' in parsed || 'activeMallId' in parsed)
        ? parsed
        : { assignments: parsed || {}, profiles: [], activeProfileId: null };
      const restoredAssignments = state.assignments || {};
      let restoredMalls = Array.isArray(state.malls) ? state.malls.map(normalizeMall) : [];
      if (!restoredMalls.length) {
        const legacyGoals = Object.entries(restoredAssignments)
          .filter(([, assignment]) => assignment === 'mall')
          .map(([name]) => ({ material: { type: 'item', name }, targetRate: 1 }));
        if (legacyGoals.length) {
          restoredMalls = [createMall('Mall', { profileId: state.activeProfileId || null, goals: legacyGoals })];
        }
      }
      const selectedMall = restoredMalls.find((mall) => mall.id === state.activeMallId) || restoredMalls[0] || null;
      setAssignments(restoredAssignments);
      setMalls(restoredMalls);
      setActiveMallId(selectedMall?.id || null);
      setProfiles(Array.isArray(state.profiles) ? state.profiles : []);
      setActiveProfileId(selectedMall ? selectedMall.profileId : (typeof state.activeProfileId === 'string' ? state.activeProfileId : null));
    } catch {
      setAssignments({});
      setMalls([]);
      setActiveMallId(null);
      setProfiles([]);
      setActiveProfileId(null);
    }
  }, [mod]);

  useEffect(() => {
    setMallNameDraft(malls.find((mall) => mall.id === activeMallId)?.name || '');
  }, [activeMallId, malls]);

  function persistDatasetState(nextAssignments = assignments, nextProfiles = profiles, nextActiveProfileId = activeProfileId, nextMalls = malls, nextActiveMallId = activeMallId) {
    try {
      const payload = {
        version: 1,
        assignments: nextAssignments || {},
        profiles: nextProfiles || [],
        activeProfileId: nextActiveProfileId || null,
        malls: nextMalls || [],
        activeMallId: nextActiveMallId || null,
      };
      localStorage.setItem(datasetStorageKey(mod), JSON.stringify(payload));
    } catch {
      // Storage can be disabled.
    }
  }

  const technologies = data?.technologies[mod] || {};
  const crafting = data?.crafting;
  const items = crafting?.datasets[mod] || {};
  const labels = crafting?.labels[mod] || {};
  const catalog = crafting?.catalogs[mod] || {};
  const activeMall = malls.find((mall) => mall.id === activeMallId) || null;
  const itemName = (name, type = 'item') => (type === 'fluid' ? catalog.fluidLabels?.[name] : labels[name]) || name;

  function persistMalls(nextMalls, nextActiveMallId = activeMallId) {
    const nextActiveMall = nextMalls.find((mall) => mall.id === nextActiveMallId) || null;
    const nextActiveProfileId = nextActiveMall ? nextActiveMall.profileId : activeProfileId;
    setMalls(nextMalls);
    setActiveMallId(nextActiveMallId);
    if (nextActiveMall) setActiveProfileId(nextActiveProfileId);
    persistDatasetState(assignments, profiles, nextActiveProfileId, nextMalls, nextActiveMallId);
  }

  function updateActiveMall(updates) {
    if (!activeMall) return;
    persistMalls(malls.map((mall) => mall.id === activeMall.id ? normalizeMall({ ...mall, ...updates }) : mall));
  }

  function addMall() {
    const name = newMallName.trim();
    if (!name) return;
    const mall = createMall(name, { profileId: activeProfileId });
    setNewMallName('');
    persistMalls([...malls, mall], mall.id);
  }

  function selectMall(mallId) {
    const selectedMall = malls.find((mall) => mall.id === mallId) || null;
    setActiveMallId(selectedMall?.id || null);
    const nextActiveProfileId = selectedMall?.profileId || null;
    setActiveProfileId(nextActiveProfileId);
    persistDatasetState(assignments, profiles, nextActiveProfileId, malls, selectedMall?.id || null);
  }

  function saveMallName() {
    const name = mallNameDraft.trim();
    if (!name || !activeMall) return;
    updateActiveMall({ name });
  }

  function deleteActiveMall() {
    if (!activeMall || !window.confirm(`Delete mall “${activeMall.name}”? Its goals and inputs will be removed.`)) return;
    const remaining = malls.filter((mall) => mall.id !== activeMall.id);
    persistMalls(remaining, remaining[0]?.id || null);
  }

  function toggleMallGoal(name) {
    if (!activeMall) return;
    const exists = activeMall.goals.some((goal) => goal.material.type === 'item' && goal.material.name === name);
    const goals = exists
      ? activeMall.goals.filter((goal) => !(goal.material.type === 'item' && goal.material.name === name))
      : [...activeMall.goals, { material: { type: 'item', name }, targetRate: 1 }];
    updateActiveMall({ goals });
  }

  function setGoalTarget(name, value) {
    if (!activeMall) return;
    const targetRate = Number(value);
    if (!Number.isFinite(targetRate) || targetRate < 0) return;
    updateActiveMall({
      goals: activeMall.goals.map((goal) => goal.material.type === 'item' && goal.material.name === name ? { ...goal, targetRate } : goal),
    });
  }

  function toggleMallInput(name) {
    if (!activeMall) return;
    const exists = activeMall.inputs.some((material) => material.type === 'item' && material.name === name);
    const inputs = exists
      ? activeMall.inputs.filter((material) => !(material.type === 'item' && material.name === name))
      : [...activeMall.inputs, { type: 'item', name }];
    updateActiveMall({ inputs });
  }

  function changeMod(next) {
    setMod(next);
    setSelected((current) => current.filter((name) => data?.technologies[next]?.[name]));
    setSearch('');
  }

  function updateAssignment(name, state) {
    const next = { ...assignments };
    if (next[name] === state) delete next[name];
    else next[name] = state;
    setAssignments(next);
    persistDatasetState(next, profiles, activeProfileId);
  }

  function openProfileEditor(profile = null) {
    setProfileDraft({
      id: profile?.id || null,
      name: profile?.name || '',
      maxFootprint: profile?.maxFootprint ?? '',
      maxIO: profile?.maxIO ?? '',
    });
    setProfileError('');
    setProfileEditorOpen(true);
  }

  function saveProfile() {
    const name = profileDraft.name.trim();
    if (!name) {
      setProfileError('Profile names must not be empty.');
      return;
    }
    const maxFootprintValue = profileDraft.maxFootprint === '' || profileDraft.maxFootprint === null ? null : Number(profileDraft.maxFootprint);
    if (profileDraft.maxFootprint !== '' && (!Number.isFinite(maxFootprintValue) || maxFootprintValue < 0)) {
      setProfileError('Maximum footprint must be a non-negative number or left blank.');
      return;
    }
    const maxIOValue = profileDraft.maxIO === '' || profileDraft.maxIO === null ? null : Number(profileDraft.maxIO);
    if (profileDraft.maxIO !== '' && (!Number.isFinite(maxIOValue) || maxIOValue < 0 || !Number.isInteger(maxIOValue))) {
      setProfileError('Maximum IO must be a non-negative integer or left blank.');
      return;
    }
    const normalized = normalizeProfile({
      id: profileDraft.id || crypto.randomUUID(),
      name,
      maxFootprint: maxFootprintValue,
      maxIO: maxIOValue,
    });
    const nextProfiles = [...profiles.filter((profile) => profile.id !== normalized.id), normalized].sort((left, right) => left.name.localeCompare(right.name));
    const nextActiveProfileId = profileDraft.id ? activeProfileId : normalized.id;
    const nextMalls = !profileDraft.id && activeMall
      ? malls.map((mall) => mall.id === activeMall.id ? { ...mall, profileId: normalized.id } : mall)
      : malls;
    setProfiles(nextProfiles);
    setMalls(nextMalls);
    setActiveProfileId(nextActiveProfileId);
    setProfileEditorOpen(false);
    persistDatasetState(assignments, nextProfiles, nextActiveProfileId, nextMalls, activeMallId);
  }

  function deleteSelectedProfile(profile) {
    if (!profile) return;
    const existingReferences = malls.some((mall) => mall.profileId === profile.id) || Object.values(assignments).some((value) => value === profile.id);
    const confirmMessage = existingReferences ? `Delete profile “${profile.name}”? It will be removed from linked assignments.` : `Delete profile “${profile.name}”?`;
    if (!window.confirm(confirmMessage)) return;
    const nextProfiles = deleteProfile(profiles, profile.id);
    const nextMalls = malls.map((mall) => mall.profileId === profile.id ? { ...mall, profileId: null } : mall);
    setProfiles(nextProfiles);
    setMalls(nextMalls);
    if (activeProfileId === profile.id) setActiveProfileId(null);
    persistDatasetState(assignments, nextProfiles, activeProfileId === profile.id ? null : activeProfileId, nextMalls, activeMallId);
  }

  function getTechnologyPlan() {
    const names = new Set();
    function visit(name) {
      if (names.has(name)) return;
      names.add(name);
      technologies[name]?.prerequisites.forEach(visit);
    }
    selected.forEach(visit);
    const included = [...names].filter((name) => technologies[name])
      .sort((left, right) => technologies[left].label.localeCompare(technologies[right].label));
    const infinite = included.some((name) => isInfinite(technologies[name]));
    const science = new Map();
    let seconds = 0;
    for (const name of included) {
      const technology = technologies[name];
      const count = technologyCount(technology, isInfinite(technology) ? levels : 1);
      for (const ingredient of technology.ingredients) {
        science.set(ingredient.name, (science.get(ingredient.name) || 0) + ingredient.amount * count);
      }
      if (technology.time !== null) seconds += technology.time * count;
    }
    return { included, infinite, science, seconds };
  }

  function renderTechnology() {
    const query = search.trim().toLocaleLowerCase();
    const matches = Object.values(technologies)
      .filter((technology) => !selected.includes(technology.name)
        && (!query || technology.label.toLocaleLowerCase().includes(query) || technology.name.toLowerCase().includes(query)))
      .sort((left, right) => left.label.localeCompare(right.label)).slice(0, 40);
    const plan = getTechnologyPlan();
    return <div className="planner-grid">
      <section className="pane">
        <h2>Find a technology</h2>
        <label htmlFor="tech-search">Technology name</label>
        <input id="tech-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" />
        <div className="results" aria-live="polite">
          {matches.length ? matches.map((technology) => <button className="result" key={technology.name} onClick={() => { setSelected([...selected, technology.name]); setSearch(''); }}>
            <span>{technology.label}</span><small>{technology.name}</small>
          </button>) : <p className="empty">{query ? 'No matching technologies.' : 'Type to search available technologies.'}</p>}
        </div>
      </section>
      <section className="pane">
        <h2>Your plan</h2>
        <div className="selected-list">{selected.map((name) => <span className="chip" key={name}>{technologies[name]?.label || name}<button type="button" aria-label={`Remove ${technologies[name]?.label || name}`} onClick={() => setSelected(selected.filter((item) => item !== name))}>×</button></span>)}</div>
        {plan.infinite && <label className="level-field">Levels for each infinite technology<input type="number" min="1" max="1000" value={levels} onChange={(event) => setLevels(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))} /></label>}
        {!selected.length ? <p className="empty">Add one or more technologies to see their total cost.</p> : <>
          <div className="summary-grid">
            <Summary value={numberFormat.format([...plan.science.values()].reduce((sum, amount) => sum + amount, 0))} label="Total science packs" />
            <Summary value={`${numberFormat.format(plan.seconds)} s`} label="Research time" />
            <Summary value={plan.included.length} label="Technologies including prerequisites" />
          </div>
          {!!plan.science.size && <table><thead><tr><th>Science pack</th><th>Quantity</th></tr></thead><tbody>
            {[...plan.science].sort(([left], [right]) => left.localeCompare(right)).map(([name, amount]) => <tr key={name}><td>{itemName(name)}</td><td>{numberFormat.format(amount)}</td></tr>)}
          </tbody></table>}
          <h3>Included technologies</h3><ul className="included">{plan.included.map((name) => <li key={name}>{technologies[name].label}</li>)}</ul>
        </>}
      </section>
    </div>;
  }

  const recipeCatalog = useMemo(() => Object.values(items || {}).flatMap((item) => (item.recipes || []).filter((recipe) => recipe.available).map((recipe) => ({ ...recipe, itemName: item.name }))), [items]);
  const machineCatalog = useMemo(() => catalog?.machines || [], [catalog]);

  useEffect(() => {
    if (!activeMall) {
      setSelectedGraphNodeId(null);
      setGraphDraft({ recipeName: '', machineName: '', modules: [] });
      return;
    }
    if (!selectedGraphNodeId || !activeMall.productionNodes.some((node) => node.id === selectedGraphNodeId)) {
      setSelectedGraphNodeId(activeMall.productionNodes[0]?.id || null);
    }
  }, [activeMall, selectedGraphNodeId]);

  useEffect(() => {
    const selectedNode = activeMall?.productionNodes.find((node) => node.id === selectedGraphNodeId) || null;
    if (!selectedNode) {
      setGraphDraft({ recipeName: '', machineName: '', modules: [] });
      return;
    }
    setGraphDraft({
      recipeName: selectedNode.recipeName || '',
      machineName: selectedNode.machineName || '',
      modules: Array.isArray(selectedNode.modules) ? selectedNode.modules.map((module) => ({ ...module })) : [],
    });
  }, [activeMall, selectedGraphNodeId]);

  useEffect(() => {
    if (!activeMall) {
      setSelectedBeaconId(null);
      setBeaconDraft({ name: '', modules: [] });
      return;
    }
    if (!selectedBeaconId || !activeMall.beaconNodes.some((beacon) => beacon.id === selectedBeaconId)) {
      setSelectedBeaconId(activeMall.beaconNodes[0]?.id || null);
    }
  }, [activeMall, selectedBeaconId]);

  useEffect(() => {
    const selectedBeacon = activeMall?.beaconNodes.find((beacon) => beacon.id === selectedBeaconId) || null;
    if (!selectedBeacon) {
      setBeaconDraft({ name: '', modules: [] });
      return;
    }
    setBeaconDraft({
      name: selectedBeacon.name || '',
      modules: Array.isArray(selectedBeacon.modules) ? selectedBeacon.modules.map((module) => ({ ...module })) : [],
    });
  }, [activeMall, selectedBeaconId]);

  const graphNodes = useMemo(() => {
    if (!activeMall) return [];
    const materialByKey = new Map();
    const materialOrder = [];
    const addMaterial = (material) => {
      if (!material || !material.name) return;
      const normalized = normalizeMaterialRef(material);
      const key = `${normalized.type}:${normalized.name}`;
      if (!materialByKey.has(key)) {
        materialByKey.set(key, normalized);
        materialOrder.push(key);
      }
    };
    for (const goal of activeMall.goals) addMaterial(goal.material);
    for (const input of activeMall.inputs) addMaterial(input);
    for (const node of activeMall.productionNodes) {
      for (const ingredient of node.ingredients || []) addMaterial(ingredient);
      for (const output of node.outputs || []) addMaterial(output);
    }
    const materialNodes = materialOrder.map((key, index) => {
      const material = materialByKey.get(key);
      const isOutput = activeMall.goals.some((goal) => goal.material && goal.material.type === material.type && goal.material.name === material.name);
      return {
        id: `material-${key}`,
        type: 'material',
        data: { label: itemName(material.name, material.type), kind: isOutput ? 'goal' : 'material', subtitle: material.type },
        position: { x: 60 + (index % 4) * 180, y: 140 + Math.floor(index / 4) * 120 },
      };
    });
    const productionNodes = activeMall.productionNodes.map((node, index) => ({
      id: `production-${node.id}`,
      type: 'production',
      position: node.position || { x: 260 + (index % 3) * 260, y: 180 + Math.floor(index / 3) * 170 },
      data: {
        label: node.recipeName || 'Recipe',
        subtitle: node.machineName || 'Machine',
        selected: selectedGraphNodeId === node.id,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: true,
    }));
    return [...materialNodes, ...productionNodes];
  }, [activeMall, itemName, selectedGraphNodeId]);

  const graphEdges = useMemo(() => {
    if (!activeMall) return [];
    const edges = [];
    for (const node of activeMall.productionNodes) {
      for (const ingredient of node.ingredients || []) {
        const ingredientName = normalizeMaterialRef(ingredient);
        const sourceId = `material-${ingredientName.type}:${ingredientName.name}`;
        const targetId = `production-${node.id}`;
        edges.push({ id: `${sourceId}->${targetId}`, source: sourceId, target: targetId, type: 'smoothstep', animated: false, label: '', style: { stroke: '#5a6d66' } });
      }
      for (const output of node.outputs || []) {
        const outputName = normalizeMaterialRef(output);
        const sourceId = `production-${node.id}`;
        const targetId = `material-${outputName.type}:${outputName.name}`;
        edges.push({ id: `${sourceId}->${targetId}`, source: sourceId, target: targetId, type: 'smoothstep', animated: true, style: { stroke: '#277a55' } });
      }
    }
    return edges;
  }, [activeMall]);

  function handleGraphNodesChange(changes) {
    if (!activeMall) return;
    const nextMalls = malls.map((mall) => {
      if (mall.id !== activeMall.id) return mall;
      const nextProductionNodes = [...mall.productionNodes];
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue;
        const productionId = change.id.replace(/^production-/, '');
        const index = nextProductionNodes.findIndex((node) => node.id === productionId);
        if (index === -1) continue;
        nextProductionNodes[index] = { ...nextProductionNodes[index], position: { x: Number(change.position.x), y: Number(change.position.y) } };
      }
      return { ...mall, productionNodes: nextProductionNodes };
    });
    persistMalls(nextMalls, activeMall.id);
  }

  function handleGraphNodeSelection(nodeId) {
    const productionId = String(nodeId || '').replace(/^production-/, '');
    setSelectedGraphNodeId(productionId || null);
  }

  function addProductionNode() {
    if (!activeMall) return;
    const candidateRecipes = recipeCatalog.filter((recipe) => recipe.compatibleMachines && recipe.compatibleMachines.length);
    const recommendation = recommendProductionOptions({
      goals: activeMall.goals,
      inputs: activeMall.inputs,
      recipeCatalog: candidateRecipes,
      machineCatalog,
    })[0];
    const recipe = candidateRecipes.find((entry) => entry.name === recommendation?.recipeName) || candidateRecipes[0];
    if (!recipe) return;
    const machineName = recommendation?.machineName || recipe.compatibleMachines[0];
    const nextNode = normalizeProductionNode({
      id: crypto.randomUUID(),
      recipeName: recipe.name,
      machineName,
      modules: [],
      ingredients: recipe.ingredients || [],
      outputs: recipe.outputs || [],
      position: { x: 260 + (activeMall.productionNodes.length % 3) * 260, y: 180 + Math.floor(activeMall.productionNodes.length / 3) * 190 },
    });
    updateActiveMall({ productionNodes: [...activeMall.productionNodes, nextNode] });
    setSelectedGraphNodeId(nextNode.id);
  }

  function saveGraphNode() {
    if (!activeMall || !selectedGraphNodeId) return;
    const activeNode = activeMall.productionNodes.find((node) => node.id === selectedGraphNodeId);
    if (!activeNode) return;
    const recipe = recipeCatalog.find((entry) => entry.name === graphDraft.recipeName) || recipeCatalog[0];
    const machineName = graphDraft.machineName || (recipe?.compatibleMachines?.[0] || activeNode.machineName || '');
    const normalizedModules = (graphDraft.modules || []).map((module) => ({
      name: typeof module.name === 'string' ? module.name : '',
      count: Number(module.count ?? 0),
    })).filter((module) => module.name && Number.isFinite(module.count) && module.count > 0);
    const nextProductionNodes = activeMall.productionNodes.map((node) => {
      if (node.id !== selectedGraphNodeId) return node;
      return normalizeProductionNode({
        ...node,
        recipeName: recipe ? recipe.name : node.recipeName,
        machineName,
        modules: normalizedModules,
        ingredients: recipe?.ingredients || node.ingredients || [],
        outputs: recipe?.outputs || node.outputs || [],
      });
    });
    updateActiveMall({ productionNodes: nextProductionNodes });
  }

  function addBeaconNode() {
    if (!activeMall) return;
    const beaconName = catalog?.beacons?.[0]?.name || 'beacon';
    const nextBeacon = normalizeBeaconNode({
      id: crypto.randomUUID(),
      name: beaconName,
      modules: [],
      position: { x: 0, y: 0 },
    });
    const nextMalls = malls.map((mall) => mall.id === activeMall.id ? { ...mall, beaconNodes: [...(mall.beaconNodes || []), nextBeacon] } : mall);
    persistMalls(nextMalls, activeMall.id);
    setSelectedBeaconId(nextBeacon.id);
  }

  function saveBeaconNode() {
    if (!activeMall || !selectedBeaconId) return;
    const selectedBeacon = activeMall.beaconNodes.find((beacon) => beacon.id === selectedBeaconId);
    if (!selectedBeacon) return;
    const normalizedModules = (beaconDraft.modules || []).map((module) => ({
      name: typeof module.name === 'string' ? module.name : '',
      count: Number(module.count ?? 0),
    })).filter((module) => module.name && Number.isFinite(module.count) && module.count > 0);
    const nextBeacon = normalizeBeaconNode({
      ...selectedBeacon,
      name: typeof beaconDraft.name === 'string' && beaconDraft.name.trim() ? beaconDraft.name.trim() : selectedBeacon.name,
      modules: normalizedModules,
    });
    const nextMalls = malls.map((mall) => mall.id === activeMall.id ? {
      ...mall,
      beaconNodes: (mall.beaconNodes || []).map((beacon) => beacon.id === nextBeacon.id ? nextBeacon : beacon),
    } : mall);
    persistMalls(nextMalls, activeMall.id);
  }

  function deleteBeaconNode(beaconId) {
    if (!activeMall || !beaconId) return;
    const nextMalls = malls.map((mall) => {
      if (mall.id !== activeMall.id) return mall;
      const nextBeaconNodes = (mall.beaconNodes || []).filter((beacon) => beacon.id !== beaconId);
      const nextProductionNodes = (mall.productionNodes || []).map((node) => ({
        ...node,
        beaconIds: (node.beaconIds || []).filter((id) => id !== beaconId),
      }));
      return { ...mall, beaconNodes: nextBeaconNodes, productionNodes: nextProductionNodes };
    });
    persistMalls(nextMalls, activeMall.id);
    if (selectedBeaconId === beaconId) setSelectedBeaconId(nextMalls.find((mall) => mall.id === activeMall.id)?.beaconNodes[0]?.id || null);
  }

  function handleBeaconLinkToggle(beaconId) {
    if (!activeMall || !selectedGraphNodeId) return;
    const selectedNode = activeMall.productionNodes.find((node) => node.id === selectedGraphNodeId);
    if (!selectedNode) return;
    const nextProductionNodes = activeMall.productionNodes.map((node) => node.id === selectedGraphNodeId ? toggleProductionNodeBeacon(node, beaconId) : node);
    updateActiveMall({ productionNodes: nextProductionNodes });
  }

  function renderCrafting() {
    const query = search.trim().toLocaleLowerCase();
    const selectedProfileId = activeMall ? activeMall.profileId : activeProfileId;
    const activeProfile = profiles.find((profile) => profile.id === selectedProfileId) || null;
    const density = activeProfile ? calculateProfileDensity(activeProfile, 0) : { density: null, ratio: null, rating: 'None' };
    const mallItemNames = new Set(malls.flatMap((mall) => mall.goals.map((goal) => goal.material.name)));
    const goalSuggestions = activeMall ? rankGoalSuggestions({ items, goals: activeMall.goals, inputs: activeMall.inputs, limit: 5 }) : [];
    const names = Object.keys(items).filter((name) => items[name].recipes.some((recipe) => recipe.available)
      && (!query || itemName(name).toLocaleLowerCase().includes(query) || name.toLowerCase().includes(query)))
      .filter((name) => filter === 'all'
        || (filter === 'unassigned' ? !mallItemNames.has(name) && assignments[name] !== 'manual' : filter === 'mall' ? mallItemNames.has(name) : assignments[name] === 'manual'))
      .sort((left, right) => itemName(left).localeCompare(itemName(right)));
    const materialText = (material) => {
      const amount = material.amountMin === material.amountMax ? material.amountMin : `${material.amountMin}-${material.amountMax}`;
      const chance = material.probability < 1 ? ` @ ${Math.round(material.probability * 100)}%` : '';
      return `${itemName(material.name, material.type)} × ${amount}${chance}`;
    };
    const machineText = (machine) => {
      const footprint = machine.footprint ? `${machine.footprint[0]}x${machine.footprint[1]} tiles` : 'footprint unavailable';
      const fluids = [machine.fluidInput ? 'fluid input' : '', machine.fluidOutput ? 'fluid output' : ''].filter(Boolean).join(', ') || 'no fluid ports';
      return `${machine.label || machine.name} (speed ${machine.speed ?? 'unknown'}, ${machine.moduleSlots} module slots, ${footprint}, ${fluids}; effects: ${machine.allowedEffects.join(', ') || 'none'})`;
    };
    const catalogMachineByName = catalog.machineByName || {};
    const selectedNode = activeMall?.productionNodes.find((node) => node.id === selectedGraphNodeId) || null;
    const graphRecipeOptions = recipeCatalog.filter((recipe) => recipe.available !== false && recipe.compatibleMachines?.length);
    const selectedRecipe = graphRecipeOptions.find((recipe) => recipe.name === graphDraft.recipeName) || graphRecipeOptions[0] || null;
    const graphMachineOptions = selectedRecipe?.compatibleMachines || (selectedNode?.machineName ? [selectedNode.machineName] : []);
    const graphModuleOptions = catalog.modules || [];
    return <>
      <div className="craft-toolbar">
        <div className="search-control"><label htmlFor="item-search">Search items</label><input id="item-search" type="search" placeholder="Name or internal ID" value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" /></div>
        <div className="profile-controls">
          <label htmlFor="profile-select">Profile</label>
          <div className="profile-row">
            <select id="profile-select" value={selectedProfileId || 'none'} onChange={(event) => {
              const nextProfileId = event.target.value === 'none' ? null : event.target.value;
              if (activeMall) {
                persistMalls(malls.map((mall) => mall.id === activeMall.id ? { ...mall, profileId: nextProfileId } : mall));
              } else {
                setActiveProfileId(nextProfileId);
                persistDatasetState(assignments, profiles, nextProfileId);
              }
            }}>
              <option value="none">None</option>
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
            <button type="button" className="profile-button" onClick={() => openProfileEditor()}>Manage Profiles</button>
          </div>
        </div>
        <div className="segmented" role="group" aria-label="Show items">{[['all', 'All'], ['unassigned', 'Unsorted'], ['mall', 'In malls'], ['manual', 'Manual']].map(([value, title]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{title}</button>)}</div>
      </div>
      <section className="mall-workspace" aria-label="Mall planning">
        <div className="mall-toolbar">
          <div>
            <label htmlFor="active-mall">Active mall</label>
            <select id="active-mall" value={activeMallId || ''} onChange={(event) => selectMall(event.target.value)}>
              <option value="">No mall selected</option>
              {malls.map((mall) => <option key={mall.id} value={mall.id}>{mall.name}</option>)}
            </select>
          </div>
          <form className="new-mall-form" onSubmit={(event) => { event.preventDefault(); addMall(); }}>
            <label htmlFor="new-mall-name">Create mall</label>
            <div className="mall-inline-control">
              <input id="new-mall-name" value={newMallName} onChange={(event) => setNewMallName(event.target.value)} placeholder="Mall name" />
              <button type="submit" className="profile-button">Create</button>
            </div>
          </form>
        </div>
        {activeMall ? <>
          <div className="mall-settings">
            <form className="mall-rename-form" onSubmit={(event) => { event.preventDefault(); saveMallName(); }}>
              <label htmlFor="mall-name">Name</label>
              <div className="mall-inline-control">
                <input id="mall-name" value={mallNameDraft} onChange={(event) => setMallNameDraft(event.target.value)} />
                <button type="submit" className="profile-button">Save name</button>
              </div>
            </form>
            <div>
              <label htmlFor="mall-status">Status</label>
              <select id="mall-status" value={activeMall.status} onChange={(event) => updateActiveMall({ status: event.target.value })}>
                <option value="planned">Planned</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <button type="button" className="danger mall-delete" onClick={deleteActiveMall}>Delete mall</button>
          </div>
          <div className="mall-columns">
            <section className="mall-block" aria-label="Mall goals">
              <h2>Goals</h2>
              {activeMall.goals.length ? <ul className="mall-material-list">{activeMall.goals.map((goal) => <li key={`${goal.material.type}:${goal.material.name}`}>
                <span>{itemName(goal.material.name, goal.material.type)}</span>
                <label>Target/min <input type="number" min="0" step="any" aria-label={`${itemName(goal.material.name, goal.material.type)} target per minute`} value={goal.targetRate} onChange={(event) => setGoalTarget(goal.material.name, event.target.value)} /></label>
                <button type="button" className="choice" aria-label={`Remove ${itemName(goal.material.name, goal.material.type)} goal`} onClick={() => toggleMallGoal(goal.material.name)}>Remove</button>
              </li>)}</ul> : <p className="empty">Add a goal from the item list or suggestions.</p>}
              <h3>Suggested goals</h3>
              {goalSuggestions.length ? <ul className="suggestion-list" aria-label="Ranked goal suggestions">{goalSuggestions.map((suggestion) => <li key={suggestion.material.name}>
                <span>{itemName(suggestion.material.name)}<small>{suggestion.sharedInputs.length ? `Shares ${suggestion.sharedInputs.map((material) => itemName(material.name, material.type)).join(', ')}` : 'No shared inputs'}</small></span>
                <button type="button" className="choice" aria-label={`Add ${itemName(suggestion.material.name)} goal`} onClick={() => toggleMallGoal(suggestion.material.name)}>Add</button>
              </li>)}</ul> : <p className="empty">No goal suggestions available.</p>}
            </section>
            <section className="mall-block" aria-label="External inputs">
              <h2>External inputs</h2>
              {activeMall.inputs.length ? <ul className="mall-material-list">{activeMall.inputs.map((material) => <li key={`${material.type}:${material.name}`}>
                <span>{itemName(material.name, material.type)}</span>
                <button type="button" className="choice" aria-label={`Remove ${itemName(material.name, material.type)} input`} onClick={() => toggleMallInput(material.name)}>Remove</button>
              </li>)}</ul> : <p className="empty">Promote any item from the list to an external input.</p>}
            </section>
          </div>
          <div className="production-graph-panel">
            <div className="graph-toolbar">
              <h2>Production graph</h2>
              <button type="button" className="choice" onClick={addProductionNode}>Add node</button>
            </div>
            {activeMall.productionNodes.length ? (
              <div className="graph-shell">
                <ReactFlow
                  nodes={graphNodes}
                  edges={graphEdges}
                  nodeTypes={productionNodeTypes}
                  fitView
                  onNodesChange={handleGraphNodesChange}
                  onNodeClick={(_, node) => handleGraphNodeSelection(node.id)}
                  nodesDraggable
                  nodesConnectable={false}
                  elementsSelectable
                  edgesFocusable={false}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={18} size={1} color="#d8e0d6" />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </div>
            ) : <p className="empty">No production nodes yet. Add one to build the mall dependency graph.</p>}
            {selectedNode && (
              <div className="graph-editor">
                <h3>Edit selected production node</h3>
                <label htmlFor="graph-recipe">Recipe</label>
                <select id="graph-recipe" value={graphDraft.recipeName} onChange={(event) => setGraphDraft((current) => ({ ...current, recipeName: event.target.value, machineName: current.machineName || '' }))}>
                  {graphRecipeOptions.map((recipe) => <option key={recipe.name} value={recipe.name}>{recipe.name}</option>)}
                </select>
                <label htmlFor="graph-machine">Machine</label>
                <select id="graph-machine" value={graphDraft.machineName || ''} onChange={(event) => setGraphDraft((current) => ({ ...current, machineName: event.target.value }))}>
                  {graphMachineOptions.map((machineName) => <option key={machineName} value={machineName}>{machineName}</option>)}
                </select>
                <label htmlFor="graph-module">Module</label>
                <select id="graph-module" value="" onChange={(event) => {
                  const moduleName = event.target.value;
                  if (!moduleName) return;
                  setGraphDraft((current) => ({
                    ...current,
                    modules: [...current.modules.filter((module) => module.name !== moduleName), { name: moduleName, count: 1 }],
                  }));
                  event.target.value = '';
                }}>
                  <option value="">Add a module</option>
                  {graphModuleOptions.map((module) => <option key={module.name} value={module.name}>{module.name}</option>)}
                </select>
                {graphDraft.modules.length ? <ul className="graph-module-list">
                  {graphDraft.modules.map((module, index) => <li key={`${module.name}-${index}`}>
                    <span>{module.name}</span>
                    <input type="number" min="0" step="1" value={module.count} onChange={(event) => setGraphDraft((current) => ({ ...current, modules: current.modules.map((item, itemIndex) => itemIndex === index ? { ...item, count: Number(event.target.value) || 0 } : item) }))} />
                    <button type="button" className="danger" onClick={() => setGraphDraft((current) => ({ ...current, modules: current.modules.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>
                  </li>)}
                </ul> : <p className="empty">No modules assigned.</p>}
                <h3>Beacon links</h3>
                {activeMall.beaconNodes.length ? <ul className="graph-module-list">
                  {activeMall.beaconNodes.map((beacon) => {
                    const linked = (selectedNode?.beaconIds || []).includes(beacon.id);
                    return <li key={beacon.id}>
                      <span>{beacon.name}</span>
                      <button type="button" className="choice" aria-pressed={linked} onClick={() => handleBeaconLinkToggle(beacon.id)}>{linked ? 'Unlink' : 'Link'}</button>
                    </li>;
                  })}
                </ul> : <p className="empty">No beacons configured for this mall.</p>}
                <h3>Beacon planning</h3>
                <div className="mall-inline-control">
                  <button type="button" className="choice" onClick={addBeaconNode}>Add beacon</button>
                </div>
                {activeMall.beaconNodes.length ? <>
                  <ul className="graph-module-list">
                    {activeMall.beaconNodes.map((beacon) => <li key={beacon.id}>
                      <button type="button" className="choice" aria-pressed={selectedBeaconId === beacon.id} onClick={() => setSelectedBeaconId(beacon.id)}>{beacon.name}</button>
                    </li>)}
                  </ul>
                  <label htmlFor="beacon-name">Beacon</label>
                  <select id="beacon-name" value={beaconDraft.name || ''} onChange={(event) => setBeaconDraft((current) => ({ ...current, name: event.target.value }))}>
                    <option value="">Select a beacon</option>
                    {(catalog.beacons || []).map((beacon) => <option key={beacon.name} value={beacon.name}>{beacon.label || beacon.name}</option>)}
                  </select>
                  <label htmlFor="beacon-module">Module</label>
                  <select id="beacon-module" value="" onChange={(event) => {
                    const moduleName = event.target.value;
                    if (!moduleName) return;
                    setBeaconDraft((current) => ({
                      ...current,
                      modules: [...current.modules.filter((module) => module.name !== moduleName), { name: moduleName, count: 1 }],
                    }));
                    event.target.value = '';
                  }}>
                    <option value="">Add a beacon module</option>
                    {(catalog.modules || []).map((module) => <option key={module.name} value={module.name}>{module.label || module.name}</option>)}
                  </select>
                  {beaconDraft.modules.length ? <ul className="graph-module-list">
                    {beaconDraft.modules.map((module, index) => <li key={`${module.name}-${index}`}>
                      <span>{module.name}</span>
                      <input type="number" min="0" step="1" value={module.count} onChange={(event) => setBeaconDraft((current) => ({ ...current, modules: current.modules.map((item, itemIndex) => itemIndex === index ? { ...item, count: Number(event.target.value) || 0 } : item) }))} />
                      <button type="button" className="danger" onClick={() => setBeaconDraft((current) => ({ ...current, modules: current.modules.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>
                    </li>)}
                  </ul> : <p className="empty">No beacon modules assigned.</p>}
                  <div className="graph-actions">
                    <button type="button" className="primary" onClick={saveBeaconNode}>Save beacon</button>
                    {selectedBeaconId && <button type="button" className="danger" onClick={() => deleteBeaconNode(selectedBeaconId)}>Delete beacon</button>}
                  </div>
                </> : null}
                <div className="graph-actions">
                  <button type="button" className="primary" onClick={saveGraphNode}>Save node</button>
                </div>
              </div>
            )}
          </div>
        </> : <p className="empty mall-empty">Create a mall to add goals and external inputs.</p>}
      </section>
      <div className="profile-summary-wrap">
        <div className="summary-card compact"><strong>{activeProfile ? getProfileSummary(activeProfile) : 'None'}</strong><span>Active profile</span></div>
        <div className="summary-card compact"><strong>{density.rating}</strong><span>Density {density.density === null ? 'None' : `${density.density.toFixed(2)} / ${activeProfile?.maxFootprint ?? '∞'}`}</span></div>
      </div>
      <div className="craft-counts"><span><strong>{mallItemNames.size}</strong> mall goals</span><span><strong>{Object.values(assignments).filter((value) => value === 'manual').length}</strong> manual</span></div>
      <div className="items" aria-live="polite">{names.length ? names.map((name) => {
        const node = items[name];
        return <article className="item-row" key={name}>
          <div className="item-name">{itemName(name)}<small>{[name, node.subgroup, node.hidden ? 'hidden' : null].filter(Boolean).join(' · ')}</small></div>
          <div className="recipes">{node.recipes.filter((recipe) => recipe.available).map((recipe, index) => {
            const machines = recipe.compatibleMachines.map((machine) => catalogMachineByName[machine]).filter(Boolean);
            return <details className="recipe" key={`${recipe.name}-${index}`}>
              <summary>{recipe.categories.join(', ')} | {recipe.energy}s | {recipe.ingredients.length ? recipe.ingredients.map(materialText).join(' + ') : 'No ingredients'} → {recipe.outputs.map(materialText).join(' + ')}</summary>
              <div className="recipe-info">
                <p><b>Variant:</b> {recipe.variant}</p>
                <p><b>Available in normal progression:</b> {recipe.available ? 'yes' : 'no'}</p>
                <p><b>Visibility:</b> {recipe.hidden ? 'hidden recipe' : 'visible recipe'}; {recipe.hideFromPlayerCrafting ? 'hidden from player crafting' : 'player-crafting visibility unchanged'}</p>
                <p><b>Productivity:</b> {recipe.allowProductivity ? 'allowed' : 'not allowed'}</p>
                {node.subgroup && <p><b>Item subgroup:</b> {node.subgroup}</p>}
                {recipe.unlockedBy.length > 0 && <p><b>Unlocked by:</b> {recipe.unlockedBy.map((technology) => catalog.technologyLabels?.[technology] || technology).join(', ')}</p>}
                {machines.length > 0 && <p><b>Compatible machines:</b> {machines.map(machineText).join('; ')}</p>}
                {!machines.length && recipe.handCraftable && <p><b>Production method:</b> Hand crafting</p>}
              </div>
            </details>;
          })}</div>
          <div className="item-actions">
            <button className="choice" data-state={activeMall?.goals.some((goal) => goal.material.type === 'item' && goal.material.name === name) ? 'mall' : ''} aria-pressed={activeMall?.goals.some((goal) => goal.material.type === 'item' && goal.material.name === name) || false} aria-label={`${activeMall?.goals.some((goal) => goal.material.type === 'item' && goal.material.name === name) ? 'Remove' : 'Add'} ${itemName(name)} goal`} disabled={!activeMall} onClick={() => toggleMallGoal(name)}>{activeMall?.goals.some((goal) => goal.material.type === 'item' && goal.material.name === name) ? 'Remove goal' : 'Add goal'}</button>
            <button className="choice" data-state={activeMall?.inputs.some((material) => material.type === 'item' && material.name === name) ? 'input' : ''} aria-pressed={activeMall?.inputs.some((material) => material.type === 'item' && material.name === name) || false} aria-label={`${activeMall?.inputs.some((material) => material.type === 'item' && material.name === name) ? 'Remove' : 'Add'} ${itemName(name)} input`} disabled={!activeMall} onClick={() => toggleMallInput(name)}>{activeMall?.inputs.some((material) => material.type === 'item' && material.name === name) ? 'Remove input' : 'Add input'}</button>
            <button className="choice" data-state={assignments[name] === 'manual' ? 'manual' : ''} aria-pressed={assignments[name] === 'manual'} onClick={() => updateAssignment(name, 'manual')}>Build as needed</button>
          </div>
        </article>;
      }) : <p className="empty">No matching craftable items.</p>}</div>
      <details className="catalog">
        <summary>Production prototype reference</summary>
        <div className="catalog-grid">
          <CatalogSection title={`Machines (${catalog.machines?.length || 0})`} entries={catalog.machines || []} format={machineText} />
          <CatalogSection title={`Modules (${catalog.modules?.length || 0})`} entries={catalog.modules || []} format={(module) => `${module.label || module.name}: ${Object.entries(module.effects || {}).map(([effect, value]) => `${effect} ${value.bonus > 0 ? '+' : ''}${value.bonus}`).join(', ') || 'no parsed effects'}${module.category ? ` (${module.category})` : ''}`} />
          <CatalogSection title={`Beacons (${catalog.beacons?.length || 0})`} entries={catalog.beacons || []} format={(beacon) => `${beacon.label || beacon.name}: ${beacon.moduleSlots} slots, range ${beacon.supplyAreaDistance ?? 'unknown'}, transmission ${beacon.distributionEffectivity ?? 'unknown'}, effects ${beacon.allowedEffects.join(', ') || 'none'}`} />
          <CatalogSection title={`Fluid recipes (${catalog.fluidRecipes?.length || 0})`} entries={catalog.fluidRecipes || []} format={(recipe) => `${recipe.name}: ${recipe.ingredients.map(materialText).join(' + ') || 'no inputs'} → ${recipe.outputs.map(materialText).join(' + ')}; machines ${recipe.compatibleMachines.join(', ') || 'none'}`} />
        </div>
      </details>
      {profileEditorOpen && <div className="profile-modal-backdrop" onClick={() => setProfileEditorOpen(false)}>
        <div className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title" onClick={(event) => event.stopPropagation()}>
          <h2 id="profile-dialog-title">{profileDraft.id ? 'Edit profile' : 'Create profile'}</h2>
          <label htmlFor="profile-name">Name</label>
          <input id="profile-name" type="text" value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} />
          <label htmlFor="profile-footprint">Maximum footprint</label>
          <input id="profile-footprint" type="number" min="0" step="0.1" value={profileDraft.maxFootprint} onChange={(event) => setProfileDraft({ ...profileDraft, maxFootprint: event.target.value })} placeholder="Optional" />
          <label htmlFor="profile-io">Maximum combined IO</label>
          <input id="profile-io" type="number" min="0" step="1" value={profileDraft.maxIO} onChange={(event) => setProfileDraft({ ...profileDraft, maxIO: event.target.value })} placeholder="Optional" />
          {profileError && <p className="error inline-error">{profileError}</p>}
          <div className="profile-modal-actions">
            {profileDraft.id && <button type="button" className="danger" onClick={() => { deleteSelectedProfile(profiles.find((profile) => profile.id === profileDraft.id)); setProfileEditorOpen(false); }}>Delete</button>}
            <button type="button" onClick={() => setProfileEditorOpen(false)}>Cancel</button>
            <button type="button" className="primary" onClick={saveProfile}>Save</button>
          </div>
        </div>
      </div>}
    </>;
  }

  if (loadError) return <main className="app-shell"><p className="error">{loadError} Run the Python data generator and rebuild the app.</p></main>;
  if (!data) return <main className="app-shell"><p className="empty">Loading Factorio data…</p></main>;

  return <main className="app-shell">
    <header className="app-header">
      <div><p className="eyebrow">FACTORIO PLANNING TOOLS</p><h1>{view === 'technology' ? 'Technology costs' : 'Crafting planner'}</h1></div>
      <div className="header-controls">
        <nav className="view-tabs" aria-label="Planner"><button aria-current={view === 'technology' ? 'page' : undefined} onClick={() => { setView('technology'); setSearch(''); }}>Technology</button><button aria-current={view === 'crafting' ? 'page' : undefined} onClick={() => { setView('crafting'); setSearch(''); }}>Crafting</button></nav>
        <div className="segmented dataset-switch" role="group" aria-label="Factorio data set"><button aria-pressed={mod === 'base'} onClick={() => changeMod('base')}>Base</button><button aria-pressed={mod === 'space-age'} onClick={() => changeMod('space-age')}>Space Age</button></div>
      </div>
    </header>
    <p className="intro">{view === 'technology' ? 'Build a research plan and total the science and time for its prerequisites.' : 'Sort recipe-produced items into permanent mall production or occasional manual builds.'}</p>
    {view === 'technology' ? renderTechnology() : renderCrafting()}
  </main>;
}

function Summary({ value, label }) {
  return <div className="summary-card"><strong>{value}</strong><span>{label}</span></div>;
}

function CatalogSection({ title, entries, format }) {
  return <section><h2>{title}</h2><ul>{entries.map((entry) => <li key={entry.name}>{format(entry)}</li>)}</ul></section>;
}

export default App;