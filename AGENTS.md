# Agent Handoff

## Project Goal

This project reads Factorio prototype and English locale data, then generates two standalone HTML tools:

- `factorio-technology-costs.html` calculates science and research time for selected technologies and prerequisites.
- `factorio-crafting.html` lists recipe-produced items and lets players classify them as Mall or Manual builds.

The generated pages embed both Base and Space Age data. Each page opens in Base mode and can switch datasets in the browser without rerunning Python. Mall/Manual choices are stored in browser local storage separately for each dataset.

## Start Here

On Windows, run from the project directory:

```powershell
.\.venv\Scripts\python.exe .\technology_costs.py
```

There are no CLI options or third-party Python dependencies. The script overwrites both generated HTML files in the current directory. Use `FACTORIO_DATA` to point to a different Factorio `data` directory; `FACTORIO_DATA_DIR` is a supported fallback. The default is the Steam installation path in `technology_costs.py`.

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

Generation flow:

1. `locale_reader.py` reads English `[item-name]` and `[technology-name]` sections.
2. `technology_reader.py` loads `prototypes/technology.lua` and applies static technology assignments from package update files.
3. `item_reader.py` loads each package's `prototypes/recipe.lua`, replaces recipes with later definitions of the same name, and builds item-to-recipe relationships.
4. `technology_page.py` and `crafting_page.py` serialize both datasets into their standalone HTML templates.

## File Ownership

- `technology_costs.py`: data path, ordered mod sets, default dataset, fixed output names, orchestration.
- `lua_parser.py`: tokenizer and static Lua table extraction shared by prototype readers.
- `technology_reader.py`: technology prototypes, recognized static updates, and browser payload conversion.
- `item_reader.py`: recipe ingredient/output normalization and item graph.
- `locale_reader.py`: ordered English locale merging.
- `technology_page.py`: technology planner HTML, styles, and client-side behavior.
- `crafting_page.py`: mall planner HTML, styles, dataset toggle, and local persistence.
- `README.md`: user setup and behavior overview.

Edit the Python templates rather than generated HTML; rerun the top-level script to refresh both outputs.

## Constraints And Caveats

- `lua_parser.py` is not a Lua interpreter. It extracts static tables; computed expressions and Factorio runtime behavior are not evaluated. Factorio files can use `data`, `require`, functions, loops, and helper-generated prototypes. When a prototype is missing, first check whether it is dynamically generated or lives outside the configured recipe, item, or entity prototype files.
- The crafting reader reads `prototypes/recipe.lua`, `prototypes/item.lua`, and `prototypes/entity/entities.lua` from each configured package. Preserve package ordering and later-definition-wins behavior.
- The technology update reader supports a limited set of direct static assignments. Do not assume it applies arbitrary Lua update code.
- Locale support is English only and merges `[item-name]`, `[fluid-name]`, `[entity-name]`, and `[technology-name]`.
- Browser tests should exercise both datasets. In particular, keep the dataset-toggle selectors separate from the crafting list-filter selectors.
- Factorio installation files are inputs only; do not modify them.

## Validation

Run the parser and generated-page tests first:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

The suite includes a required integration test against the configured Factorio data directory. It fails when the data directory is unavailable; set `FACTORIO_DATA` when the installation is not at the default path. Then run the generator command above. It should report Base and Space Age technology/item counts and create both pages.

For a UI smoke check, open both generated HTML files and verify:

- each opens in Base mode;
- each toggle switches to Space Age without regenerating;
- the technology search/results change with the selected dataset;
- crafting switches between the expected item sets, and Mall/Manual choices remain isolated by dataset.

Current counts depend on the installed Factorio version. With the installation used during authoring, generation reported 193/273 technologies and 182/271 craftable items for Base/Space Age respectively.
