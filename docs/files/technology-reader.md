# `technology_reader.py`

## Current Role

`read_technologies` loads static `technology` prototypes from each package's `prototypes/technology.lua`, then applies a limited set of direct static assignments from package update files. `build_technology_payload` exposes prerequisites, science cost/time, level information, and research-trigger presence to the technology page.

The browser payload includes `unlockRecipes` derived from statically represented `effects` entries of type `unlock-recipe`. The crafting reader uses the raw technology prototypes to derive effective recipe availability. Static update handling supports direct assignment of `effects` but does not implement arbitrary Lua update code.

Do not conflate technology prerequisites with recipe inputs. Unlock mapping determines availability; the technology page remains the source for science-cost planning.