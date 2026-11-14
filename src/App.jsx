import { useEffect, useState } from 'react';

const DATA_URL = `${import.meta.env.BASE_URL}data/`;
const STORAGE_KEY = 'factorio-crafting-mall-v1';
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
      const saved = localStorage.getItem(`${STORAGE_KEY}:${mod}`)
        || (mod === 'space-age' ? localStorage.getItem(STORAGE_KEY) : null);
      setAssignments(JSON.parse(saved || '{}') || {});
    } catch {
      setAssignments({});
    }
  }, [mod]);

  const technologies = data?.technologies[mod] || {};
  const crafting = data?.crafting;
  const items = crafting?.datasets[mod] || {};
  const labels = crafting?.labels[mod] || {};
  const catalog = crafting?.catalogs[mod] || {};
  const itemName = (name, type = 'item') => (type === 'fluid' ? catalog.fluidLabels?.[name] : labels[name]) || name;

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
    try { localStorage.setItem(`${STORAGE_KEY}:${mod}`, JSON.stringify(next)); } catch { /* Storage can be disabled. */ }
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

  function renderCrafting() {
    const query = search.trim().toLocaleLowerCase();
    const names = Object.keys(items).filter((name) => items[name].recipes.some((recipe) => recipe.available)
      && (!query || itemName(name).toLocaleLowerCase().includes(query) || name.toLowerCase().includes(query)))
      .filter((name) => filter === 'all' || (filter === 'unassigned' ? !assignments[name] : assignments[name] === filter))
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
    return <>
      <div className="craft-toolbar">
        <div className="search-control"><label htmlFor="item-search">Search items</label><input id="item-search" type="search" placeholder="Name or internal ID" value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" /></div>
        <div className="segmented" role="group" aria-label="Show items">{[['all', 'All'], ['unassigned', 'Unsorted'], ['mall', 'Mall'], ['manual', 'Manual']].map(([value, title]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{title}</button>)}</div>
      </div>
      <div className="craft-counts"><span><strong>{Object.values(assignments).filter((value) => value === 'mall').length}</strong> mall</span><span><strong>{Object.values(assignments).filter((value) => value === 'manual').length}</strong> manual</span></div>
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
          <div className="item-actions">{[['mall', 'Mall'], ['manual', 'Build as needed']].map(([state, title]) => <button className="choice" data-state={assignments[name] === state ? state : ''} aria-pressed={assignments[name] === state} key={state} onClick={() => updateAssignment(name, state)}>{title}</button>)}</div>
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