# `technology_reader.py`

## Current Role

`read_technologies` loads static `technology` prototypes from each package's `prototypes/technology.lua`, then applies a limited set of direct static assignments from package update files. `build_technology_payload` exposes prerequisites, science cost/time, level information, and research-trigger presence to the technology page.

The raw prototype dictionaries include parsed fields not included in the browser payload, including `effects` when statically represented. Technology prototypes use `effects` entries of type `unlock-recipe` with a `recipe` name; the crafting pipeline can use that raw data to derive effective recipe availability. Current static update handling does not implement arbitrary technology effect mutations.

Do not conflate technology prerequisites with recipe inputs. Unlock mapping determines availability; the technology page remains the source for science-cost planning.