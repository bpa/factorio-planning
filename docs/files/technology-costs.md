# `technology_costs.py`

## Current Role

This is the generator entry point. It defines the Factorio data directory, ordered `MOD_SETS`, default dataset, and JSON output paths. For each dataset it reads locale, technology, and recipe-derived item data, applies labels, then writes static JSON for the React app.

Base reads `base`; Space Age reads `base`, `quality`, `elevated-rails`, `recycler`, and `space-age` in that order. Later package definitions win in the relevant readers. The script does not currently load item/entity/module/beacon prototype data for crafting.

## Planned Change Surface

`data_writer.py` serializes the technology and crafting data contracts consumed by `src/App.jsx`. Keep dataset package order and default Base behavior unchanged unless product requirements change.