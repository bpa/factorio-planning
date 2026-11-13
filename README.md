# Factorio Technology and Crafting Planners

Generate two standalone pages: a technology planner that totals science and research time for selected technologies and prerequisites, and a crafting mall planner that sorts craftable items into permanent mall production or occasional manual builds. Crafting choices are saved in the browser.

For codebase structure, module responsibilities, parser constraints, and validation guidance, see [AGENTS.md](AGENTS.md).

## Setup

Create the project virtual environment once, then use it to run the generator:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe .\technology_costs.py
```

The generator has no third-party Python dependencies. A Lua-runtime check of the project venv found no Lua module. Although packages such as `lupa` can execute Lua, Factorio prototype files depend on Factorio-specific globals, `require` paths, and data-stage initialization; running them in a generic Lua VM would require recreating that environment. The project therefore extracts static prototype tables with its local Lua parser.

## Data Sets

Each generated page embeds both data sets and has a Base/Space Age toggle, so changing the view does not require rerunning the script. Space Age reads Base first, followed by `quality`, `elevated-rails`, `recycler`, and `space-age`; later prototype and locale definitions replace earlier definitions. Base reads only Base.

Run the top-level script without arguments. It defines the package ordering in `MOD_SETS`, generates both pages, and opens them in Base mode every time. The page toggle changes the current view without rerunning the script. The default data path is `C:\Program Files (x86)\Steam\steamapps\common\Factorio\data`; set `FACTORIO_DATA` to use another installation. `FACTORIO_DATA_DIR` remains supported as a fallback.

The outputs are always `factorio-technology-costs.html` and `factorio-crafting.html` in the current directory.

## Modules

- `lua_parser.py` extracts static prototype tables.
- `technology_reader.py` reads technologies and applies static technology updates.
- `item_reader.py` builds item and recipe relationships, unlock availability, and production prototype catalogs.
- `locale_reader.py` loads English item, fluid, entity, and technology labels.
- `technology_page.py` writes the technology cost planner.
- `crafting_page.py` writes the crafting mall planner.
- `technology_costs.py` defines ordered mod sets, defaults, and output paths, then orchestrates generation.

Run `.\.venv\Scripts\python.exe -m unittest discover -s tests -v` to validate parser extraction and generated-page data. The real-data integration test requires a Factorio data directory and fails if it cannot be found; set `FACTORIO_DATA` to its location.
