# `locale_reader.py`

## Current Role

`read_locale` merges English `.cfg` files under each package's `locale/en` directory and currently retains only `[item-name]` and `[technology-name]`. Later packages overwrite earlier labels. Missing labels fall back to internal prototype names in the page writers.

The crafting planner may later need localized machine, recipe, module, and beacon labels. Extend the allowed sections deliberately and keep localization presentation separate from internal IDs used for graph identity and persistence.