#!/usr/bin/env python3
"""Build the Factorio technology-cost and crafting mall planning pages."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from crafting_page import write_crafting_page
from item_reader import read_item_graph
from locale_reader import read_locale
from technology_page import write_technology_page
from technology_reader import build_technology_payload, read_technologies

DEFAULT_DATA_DIR = Path(r"C:\Program Files (x86)\Steam\steamapps\common\Factorio\data")
FACTORIO_DATA = Path(os.environ.get("FACTORIO_DATA", os.environ.get("FACTORIO_DATA_DIR", str(DEFAULT_DATA_DIR))))
MOD_SETS = {
    "base": ("base",),
    "space-age": ("base", "quality", "elevated-rails", "recycler", "space-age"),
}
DEFAULT_MOD = "base"
TECHNOLOGY_OUTPUT = Path.cwd() / "factorio-technology-costs.html"
CRAFTING_OUTPUT = Path.cwd() / "factorio-crafting.html"


def main() -> int:
    if not FACTORIO_DATA.is_dir():
        print(f"Error: Factorio data directory does not exist: {FACTORIO_DATA}", file=sys.stderr)
        return 1
    try:
        technology_datasets = {}
        item_datasets = {}
        for mod_name, packages in MOD_SETS.items():
            missing = [package for package in packages if not (FACTORIO_DATA / package).is_dir()]
            if missing:
                raise ValueError(f"Missing {mod_name} data packages under {FACTORIO_DATA}: {', '.join(missing)}")
            localized = read_locale(FACTORIO_DATA, packages)
            technology_prototypes = read_technologies(FACTORIO_DATA, packages)
            if not technology_prototypes:
                raise ValueError(f"No technology prototypes found for {mod_name} under {FACTORIO_DATA}")
            technology_datasets[mod_name] = build_technology_payload(technology_prototypes, localized["technology-name"])
            items = read_item_graph(FACTORIO_DATA, packages)
            if not items:
                raise ValueError(f"No recipe item graph found for {mod_name} under {FACTORIO_DATA}")
            for name, item in items.items():
                item["label"] = localized["item-name"].get(name, name)
            item_datasets[mod_name] = items

        for output in (TECHNOLOGY_OUTPUT, CRAFTING_OUTPUT):
            output.parent.mkdir(parents=True, exist_ok=True)
        write_technology_page(technology_datasets, TECHNOLOGY_OUTPUT, DEFAULT_MOD)
        write_crafting_page(item_datasets, CRAFTING_OUTPUT, DEFAULT_MOD)
    except (OSError, UnicodeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(f"Created {TECHNOLOGY_OUTPUT.resolve()} with {len(technology_datasets['base'])} Base and {len(technology_datasets['space-age'])} Space Age technologies.")
    print(f"Created {CRAFTING_OUTPUT.resolve()} with {sum(bool(item['recipes']) for item in item_datasets['base'].values())} Base and {sum(bool(item['recipes']) for item in item_datasets['space-age'].values())} Space Age craftable items.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
