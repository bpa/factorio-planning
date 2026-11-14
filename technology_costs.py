#!/usr/bin/env python3
"""Build the Factorio technology-cost and crafting mall planning pages."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from data_writer import write_crafting_data, write_technology_data
from item_reader import read_crafting_data
from locale_reader import read_locale
from technology_reader import build_technology_payload, read_technologies

DEFAULT_DATA_DIR = Path(r"C:\Program Files (x86)\Steam\steamapps\common\Factorio\data")
FACTORIO_DATA = Path(os.environ.get("FACTORIO_DATA", os.environ.get("FACTORIO_DATA_DIR", str(DEFAULT_DATA_DIR))))
MOD_SETS = {
    "base": ("base",),
    "space-age": ("base", "quality", "elevated-rails", "recycler", "space-age"),
}
DATA_OUTPUT = Path(__file__).parent / "public" / "data"
TECHNOLOGY_OUTPUT = DATA_OUTPUT / "technologies.json"
CRAFTING_OUTPUT = DATA_OUTPUT / "crafting.json"


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
            crafting_data = read_crafting_data(FACTORIO_DATA, packages, technology_prototypes)
            items = crafting_data["items"]
            if not items:
                raise ValueError(f"No recipe item graph found for {mod_name} under {FACTORIO_DATA}")
            for name, item in items.items():
                item["label"] = localized["item-name"].get(name, name)
            catalog = crafting_data["catalog"]
            for machine in catalog["machines"]:
                machine["label"] = localized["entity-name"].get(machine["name"], machine["name"])
            for module in catalog["modules"]:
                module["label"] = localized["item-name"].get(module["name"], module["name"])
            for beacon in catalog["beacons"]:
                beacon["label"] = localized["entity-name"].get(beacon["name"], beacon["name"])
            fluid_names = {
                material["name"]
                for recipe in catalog["fluidRecipes"]
                for material in recipe["ingredients"] + recipe["outputs"]
                if material["type"] == "fluid"
            }
            catalog["fluidLabels"] = {
                name: localized["fluid-name"].get(name, name) for name in fluid_names
            }
            unlocked_names = {
                technology_name
                for item in items.values()
                for recipe in item["recipes"]
                for technology_name in recipe["unlockedBy"]
            }
            unlocked_names.update(
                technology_name
                for recipe in catalog["fluidRecipes"]
                for technology_name in recipe["unlockedBy"]
            )
            catalog["technologyLabels"] = {
                name: technology_datasets[mod_name][name]["label"]
                for name in unlocked_names
                if name in technology_datasets[mod_name]
            }
            item_datasets[mod_name] = crafting_data

        write_technology_data(technology_datasets, TECHNOLOGY_OUTPUT)
        write_crafting_data(item_datasets, CRAFTING_OUTPUT)
    except (OSError, UnicodeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(f"Created {TECHNOLOGY_OUTPUT.resolve()} with {len(technology_datasets['base'])} Base and {len(technology_datasets['space-age'])} Space Age technologies.")
    print(f"Created {CRAFTING_OUTPUT.resolve()} with {sum(bool(item['recipes']) for item in item_datasets['base']['items'].values())} Base and {sum(bool(item['recipes']) for item in item_datasets['space-age']['items'].values())} Space Age craftable items.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
