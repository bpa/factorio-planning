# `technology_costs.py`

## Current Role

This is the generator entry point. It defines the Factorio data directory, ordered `MOD_SETS`, default dataset, and fixed output paths. For each dataset it reads locale, technology, and recipe-derived item data, applies labels, then writes both standalone HTML pages.

Base reads `base`; Space Age reads `base`, `quality`, `elevated-rails`, `recycler`, and `space-age` in that order. Later package definitions win in the relevant readers. The script does not currently load item/entity/module/beacon prototype data for crafting.

## Planned Change Surface

Pass the expanded crafting metadata into `write_crafting_page` without changing the technology page contract. Keep dataset package order and default Base behavior unchanged unless product requirements change.