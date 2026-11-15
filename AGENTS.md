# Agent Handoff

## Project Goal

This project reads Factorio prototype and English locale data into static JSON, then builds a React single-page app in the ignored `pages/` directory. The app combines the technology cost planner and crafting mall planner. Mall/Manual choices are stored in browser local storage separately for each dataset.

## Start Here

On Windows, run from the project directory to refresh the checked-in JSON source data:

```powershell
.\.venv\Scripts\python.exe .\technology_costs.py
```

There are no CLI options or third-party Python dependencies. The script writes `public/data/technologies.json` and `public/data/crafting.json`. Commit these JSON files after updating them. Use `FACTORIO_DATA` to point to a different Factorio `data` directory; `FACTORIO_DATA_DIR` is a supported fallback. The default is the Steam installation path in `technology_costs.py`.

If the venv is missing:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe .\technology_costs.py
```

## Data Flow

`technology_costs.py` is the configuration and orchestration entry point. Its `MOD_SETS` dictionary is the source of truth for package membership and order:

- `base`: `base`
- `space-age`: `base`, `quality`, `elevated-rails`, `recycler`, `space-age`

Readers process those packages in order. Later prototypes and locale labels override earlier definitions. `DEFAULT_MOD` controls the initial dataset embedded by each page and should remain `base` unless the product requirement changes.

Data generation flow:

1. `locale_reader.py` reads English `[item-name]` and `[technology-name]` sections.
2. `technology_reader.py` loads `prototypes/technology.lua` and applies static technology assignments from package update files.
3. `item_reader.py` loads each package's `prototypes/recipe.lua`, replaces recipes with later definitions of the same name, and builds item-to-recipe relationships.
4. `data_writer.py` serializes technology and crafting payloads to `public/data/*.json`.
5. Vite copies `public/` into the production site and builds the React app to `pages/`.

## File Ownership

- `technology_costs.py`: data path, ordered mod sets, default dataset, fixed output names, orchestration.
- `lua_parser.py`: tokenizer and static Lua table extraction shared by prototype readers.
- `technology_reader.py`: technology prototypes, recognized static updates, and browser payload conversion.
- `item_reader.py`: recipe ingredient/output normalization and item graph.
- `locale_reader.py`: ordered English locale merging.
- `data_writer.py`: static JSON serialization for frontend consumption.
- `src/App.jsx`: planner views, dataset toggle, and browser persistence.
- `vite.config.js`: React build configuration; `pages/` is generated output and ignored.
- `.github/workflows/pages.yml`: builds and deploys the site with GitHub Actions.
- `README.md`: user setup and behavior overview.

Update the React source under `src/` for UI changes. Rerun the Python generator and commit `public/data/*.json` whenever Factorio data changes. Build output in `pages/` is not committed; GitHub Actions deploys it from the committed JSON.

## Constraints And Caveats

- `lua_parser.py` is not a Lua interpreter. It extracts static tables; computed expressions and Factorio runtime behavior are not evaluated. Factorio files can use `data`, `require`, functions, loops, and helper-generated prototypes. When a prototype is missing, first check whether it is dynamically generated or lives outside the configured recipe, item, or entity prototype files.
- The crafting reader reads `prototypes/recipe.lua`, `prototypes/item.lua`, and `prototypes/entity/entities.lua` from each configured package. Preserve package ordering and later-definition-wins behavior.
- The technology update reader supports a limited set of direct static assignments. Do not assume it applies arbitrary Lua update code.
- Locale support is English only and merges `[item-name]`, `[fluid-name]`, `[entity-name]`, and `[technology-name]`.
- Browser tests should exercise both datasets. In particular, keep the dataset-toggle selectors separate from the crafting list-filter selectors.
- Factorio installation files are inputs only; do not modify them.

## Validation

Run parser and JSON contract tests:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Run JavaScript planner contract tests with `npm test`. Browser smoke tests use Playwright; install Chromium once with `npx playwright install chromium`, then run `npm run test:e2e`.

The suite includes required integration tests against the configured Factorio data directory. They fail when the data directory is unavailable; set `FACTORIO_DATA` when the installation is not at the default path. The Python generator should report Base and Space Age technology/item counts and create both JSON files. Run `npm ci` and `npm run build` to create the ignored Pages output.

For a UI smoke check, run `npm run dev` and verify:

- the app opens in Base mode and the tabs switch between planners;
- the dataset toggle changes planner results to Space Age;
- crafting search and list filters work, and Mall/Manual choices remain isolated by dataset.

Current counts depend on the installed Factorio version. With the installation used during authoring, generation reported 193/273 technologies and 182/271 craftable items for Base/Space Age respectively.
