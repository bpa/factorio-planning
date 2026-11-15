# Factorio Planners

A React single-page app combines the technology cost planner and crafting mall planner. Technology plans include prerequisite science and research time; crafting assignments are saved separately for Base and Space Age in browser storage.

## Data And Local Development

Python reads Factorio's prototype and English locale files and writes the app's static datasets to `public/data/technologies.json` and `public/data/crafting.json`. Those JSON files are source inputs for the frontend and should be committed after updating them. The generated `pages/` site is build output and is ignored by git.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe .\technology_costs.py
npm ci
npm run dev
```

The Python generator has no third-party dependencies. Factorio data defaults to `C:\Program Files (x86)\Steam\steamapps\common\Factorio\data`; set `FACTORIO_DATA` to use another installation. `FACTORIO_DATA_DIR` remains supported as a fallback.

Run the parsers and JSON contract tests with:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Run the JavaScript planner contracts with `npm test`. The browser smoke test uses Playwright; install its Chromium runtime once with `npx playwright install chromium`, then run `npm run test:e2e`.

Build the static site into `pages/` with `npm run build`. To publish, configure repository Settings > Pages > Build and deployment > Source as **GitHub Actions**. The workflow builds from the committed JSON and deploys `pages/`; GitHub Pages does not automatically run this React/Vite build when a branch folder is selected.

## Data Sets

The ordered packages are configured in `technology_costs.py`: Base reads `base`; Space Age reads `base`, `quality`, `elevated-rails`, `recycler`, and `space-age`. Later prototype and locale definitions replace earlier definitions.

The parser extracts static Lua tables; it does not run Factorio's data-stage Lua. See [AGENTS.md](AGENTS.md) for parser constraints and project structure.
