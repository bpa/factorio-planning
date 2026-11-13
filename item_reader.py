from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from lua_parser import parse_prototypes

MACHINE_TYPES = {
    "assembling-machine",
    "furnace",
    "oil-refinery",
    "chemical-plant",
    "centrifuge",
    "rocket-silo",
    "agricultural-tower",
    "biochamber",
    "electromagnetic-plant",
    "foundry",
    "cryogenic-plant",
    "heating-tower",
    "fluid-mixing-machine",
}


def _sequence(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [
            value[key]
            for key in sorted(value, key=lambda item: (0, int(item)) if str(item).isdigit() else (1, str(item)))
        ]
    return []


def _material(entry: Any, default_type: str = "item") -> dict[str, Any] | None:
    if isinstance(entry, dict):
        name = entry.get("name")
        kind = entry.get("type", default_type)
        amount = entry.get("amount")
        amount_min = entry.get("amount_min", amount if amount is not None else 1)
        amount_max = entry.get("amount_max", amount if amount is not None else amount_min)
        probability = entry.get("probability", 1)
    elif isinstance(entry, list) and entry and isinstance(entry[0], str):
        name = entry[0]
        kind = default_type
        amount_min = entry[1] if len(entry) > 1 else 1
        amount_max = amount_min
        probability = 1
    else:
        return None
    if (
        not isinstance(name, str)
        or kind not in ("item", "fluid")
        or not isinstance(amount_min, (int, float))
        or not isinstance(amount_max, (int, float))
        or not isinstance(probability, (int, float))
    ):
        return None
    return {
        "name": name,
        "type": kind,
        "amount": ((amount_min + amount_max) / 2) * probability,
        "amountMin": amount_min,
        "amountMax": amount_max,
        "probability": probability,
    }


def _materials(value: Any) -> list[dict[str, Any]]:
    materials: list[dict[str, Any]] = []
    for entry in _sequence(value):
        material = _material(entry)
        if material is not None:
            materials.append(material)
    return materials


def _outputs(recipe: dict[str, Any]) -> list[dict[str, Any]]:
    results = recipe.get("results")
    if results is not None:
        return [material for entry in _sequence(results) if (material := _material(entry)) is not None]
    name = recipe.get("result")
    amount = recipe.get("result_count", 1)
    if isinstance(name, str) and isinstance(amount, (int, float)):
        return [_material({"name": name, "amount": amount}) or {}]
    return []


def _prototype_files(package_dir: Path, relative_path: str) -> list[Path]:
    path = package_dir / relative_path
    return [path] if path.is_file() else []


def _read_named_prototypes(
    data_dir: Path,
    packages: tuple[str, ...],
    relative_path: str,
    prototype_types: set[str],
) -> dict[str, dict[str, Any]]:
    prototypes: dict[str, dict[str, Any]] = {}
    for package in packages:
        for path in _prototype_files(data_dir / package, relative_path):
            source = path.read_text(encoding="utf-8-sig")
            for prototype_type in sorted(prototype_types):
                for prototype in parse_prototypes(source, prototype_type):
                    prototypes[prototype["name"]] = prototype
    return prototypes


def _technology_unlocks(technologies: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    unlocks: dict[str, list[str]] = {}
    for technology_name, technology in technologies.items():
        for effect in _sequence(technology.get("effects")):
            if isinstance(effect, dict) and effect.get("type") == "unlock-recipe":
                recipe_name = effect.get("recipe")
                if isinstance(recipe_name, str):
                    unlocks.setdefault(recipe_name, []).append(technology_name)
    return unlocks


def _collision_footprint(value: Any) -> list[int] | None:
    box = _sequence(value)
    if len(box) != 2:
        return None
    corners = [_sequence(point) for point in box]
    if any(len(point) < 2 or not all(isinstance(axis, (int, float)) for axis in point[:2]) for point in corners):
        return None
    return [math.ceil(abs(corners[1][axis] - corners[0][axis])) for axis in range(2)]


def _fluid_capabilities(machine: dict[str, Any]) -> tuple[bool, bool]:
    inputs = False
    outputs = False
    for box in _sequence(machine.get("fluid_boxes")):
        if not isinstance(box, dict):
            continue
        direction = box.get("production_type")
        inputs |= direction in ("input", "input-output")
        outputs |= direction in ("output", "input-output")
    inputs |= isinstance(machine.get("fluid_box"), dict)
    outputs |= isinstance(machine.get("output_fluid_box"), dict)
    return inputs, outputs


def _machine_payload(name: str, prototype: dict[str, Any]) -> dict[str, Any]:
    fluid_input, fluid_output = _fluid_capabilities(prototype)
    return {
        "name": name,
        "type": prototype.get("type"),
        "categories": [value for value in _sequence(prototype.get("crafting_categories")) if isinstance(value, str)],
        "speed": prototype.get("crafting_speed"),
        "moduleSlots": prototype.get("module_slots", 0),
        "allowedEffects": [value for value in _sequence(prototype.get("allowed_effects")) if isinstance(value, str)],
        "fluidInput": fluid_input,
        "fluidOutput": fluid_output,
        "footprint": _collision_footprint(prototype.get("collision_box")),
    }


def _recipe_variant(prototype: dict[str, Any]) -> tuple[dict[str, Any], str]:
    for variant in ("normal", "expensive"):
        if isinstance(prototype.get(variant), dict):
            return prototype[variant], variant
    return prototype, "default"


def _recipe_payload(
    name: str,
    prototype: dict[str, Any],
    unlocks: dict[str, list[str]],
    machines: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    recipe, variant = _recipe_variant(prototype)
    categories = recipe.get("categories", recipe.get("category", prototype.get("categories", prototype.get("category", ["crafting"]))))
    if isinstance(categories, str):
        categories = [categories]
    categories = [value for value in _sequence(categories) if isinstance(value, str)]
    ingredients = _materials(recipe.get("ingredients", prototype.get("ingredients")))
    outputs = _outputs(recipe)
    if not outputs and recipe is not prototype:
        outputs = _outputs(prototype)
    fluid_inputs = any(material["type"] == "fluid" for material in ingredients)
    fluid_outputs = any(material["type"] == "fluid" for material in outputs)
    compatible = [
        machine
        for machine in machines.values()
        if set(categories).intersection(machine["categories"])
        and (not fluid_inputs or machine["fluidInput"])
        and (not fluid_outputs or machine["fluidOutput"])
    ]
    enabled = recipe.get("enabled", prototype.get("enabled", True))
    enabled = enabled if isinstance(enabled, bool) else True
    unlocked_by = unlocks.get(name, [])
    hand_craftable = not (fluid_inputs or fluid_outputs) and bool(set(categories).intersection({"crafting", "hand-crafting"}))
    return {
        "name": name,
        "variant": variant,
        "categories": categories,
        "ingredients": ingredients,
        "outputs": outputs,
        "energy": recipe.get("energy_required", prototype.get("energy_required", 0.5)),
        "enabled": enabled,
        "hidden": bool(recipe.get("hidden", prototype.get("hidden", False))),
        "hideFromPlayerCrafting": bool(recipe.get("hide_from_player_crafting", prototype.get("hide_from_player_crafting", False))),
        "allowProductivity": bool(recipe.get("allow_productivity", prototype.get("allow_productivity", True))),
        "unlockedBy": unlocked_by,
        "compatibleMachines": [machine["name"] for machine in compatible],
        "handCraftable": hand_craftable,
        "available": bool((enabled or unlocked_by) and (compatible or hand_craftable)),
    }


def read_crafting_data(
    data_dir: Path,
    packages: tuple[str, ...],
    technologies: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    recipes_by_name: dict[str, dict[str, Any]] = {}
    for package in packages:
        path = data_dir / package / "prototypes" / "recipe.lua"
        if not path.is_file():
            continue
        for prototype in parse_prototypes(path.read_text(encoding="utf-8-sig"), "recipe"):
            recipes_by_name[prototype["name"]] = prototype

    item_prototypes = _read_named_prototypes(data_dir, packages, "prototypes/item.lua", {"item"})
    machine_prototypes = _read_named_prototypes(
        data_dir, packages, "prototypes/entity/entities.lua", MACHINE_TYPES
    )
    machine_payloads = {
        name: _machine_payload(name, prototype)
        for name, prototype in machine_prototypes.items()
        if prototype.get("crafting_categories")
    }
    module_prototypes = _read_named_prototypes(data_dir, packages, "prototypes/item.lua", {"module"})
    beacon_prototypes = _read_named_prototypes(data_dir, packages, "prototypes/entity/entities.lua", {"beacon"})
    modules = {
        name: {
            "name": name,
            "effects": prototype.get("effect", {}),
            "category": prototype.get("category"),
            "limitations": prototype.get("limitation", []),
        }
        for name, prototype in module_prototypes.items()
    }
    item_prototypes.update(module_prototypes)
    beacons = {
        name: {
            "name": name,
            "moduleSlots": prototype.get("module_slots", 0),
            "allowedEffects": [value for value in _sequence(prototype.get("allowed_effects")) if isinstance(value, str)],
            "supplyAreaDistance": prototype.get("supply_area_distance"),
            "distributionEffectivity": prototype.get("distribution_effectivity"),
        }
        for name, prototype in beacon_prototypes.items()
    }
    unlocks = _technology_unlocks(technologies or {})
    items: dict[str, dict[str, Any]] = {}
    fluid_recipes: list[dict[str, Any]] = []
    for recipe_name, original in recipes_by_name.items():
        recipe_data = _recipe_payload(recipe_name, original, unlocks, machine_payloads)
        item_inputs = [material for material in recipe_data["ingredients"] if material["type"] == "item"]
        item_outputs = [material for material in recipe_data["outputs"] if material["type"] == "item"]
        if any(material["type"] == "fluid" for material in recipe_data["ingredients"] + recipe_data["outputs"]):
            fluid_recipes.append(recipe_data)
        if not item_outputs:
            continue
        for ingredient in item_inputs:
            items.setdefault(ingredient["name"], {"name": ingredient["name"], "recipes": []})
        for output in item_outputs:
            node = items.setdefault(output["name"], {"name": output["name"], "recipes": []})
            node["recipes"].append(recipe_data)
    for name, node in items.items():
        item_prototype = item_prototypes.get(name)
        if item_prototype is not None:
            node.update(
                {
                    "subgroup": item_prototype.get("subgroup"),
                    "hidden": bool(item_prototype.get("hidden", False)),
                    "placeResult": item_prototype.get("place_result"),
                    "stackSize": item_prototype.get("stack_size"),
                    "prototypeType": item_prototype.get("type", "item"),
                }
            )
    return {
        "items": items,
        "catalog": {
            "machines": list(machine_payloads.values()),
            "modules": list(modules.values()),
            "beacons": list(beacons.values()),
            "fluidRecipes": fluid_recipes,
        },
    }


def read_item_graph(data_dir: Path, packages: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    return read_crafting_data(data_dir, packages)["items"]
