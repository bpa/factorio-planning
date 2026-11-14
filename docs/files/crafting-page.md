# Crafting Data Payload

## Current Role

`data_writer.py` serializes item datasets, localized labels, and production catalogs into `public/data/crafting.json`. The React app supports Base/Space Age switching, search, All/Unsorted/Mall/Manual filters, and per-dataset `localStorage` assignments. The list displays available recipes and their inputs, outputs, unlocks, and compatible machines.

## Current Limits

The page has no named malls, per-mall settings, recipe or machine selection, suggestions, output availability, machine counts, footprint, module/beacon controls, or effective recipe availability. Its payload is whatever the current item reader builds.

Future state must remain dataset-isolated and versioned. Existing Mall/Manual choices should be migrated when the new mall model can represent them; otherwise keep them accessible as unassigned legacy classifications.