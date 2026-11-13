from __future__ import annotations

from pathlib import Path
from typing import Any

from lua_parser import parse_prototypes


def _sequence(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value[key] for key in sorted(value, key=lambda item: int(item) if str(item).isdigit() else str(item))]
    return []


def _ingredients(value: Any) -> list[dict[str, Any]]:
    ingredients: list[dict[str, Any]] = []
    for entry in _sequence(value):
        if isinstance(entry, dict):
            name = entry.get("name")
            kind = entry.get("type", "item")
            amount = entry.get("amount", entry.get("amount_min", 1))
        elif isinstance(entry, list) and entry and isinstance(entry[0], str):
            name = entry[0]
            kind = "item"
            amount = entry[1] if len(entry) > 1 else 1
        else:
            continue
        if kind == "item" and isinstance(name, str) and isinstance(amount, (int, float)):
            ingredients.append({"name": name, "amount": amount})
    return ingredients


def _outputs(recipe: dict[str, Any]) -> list[dict[str, Any]]:
    results = recipe.get("results")
    if results is not None:
        outputs: list[dict[str, Any]] = []
        for entry in _sequence(results):
            if isinstance(entry, dict):
                name = entry.get("name")
                kind = entry.get("type", "item")
                amount = entry.get("amount", entry.get("amount_min", 1))
            elif isinstance(entry, list) and entry and isinstance(entry[0], str):
                name = entry[0]
                kind = "item"
                amount = entry[1] if len(entry) > 1 else 1
            else:
                continue
            if kind == "item" and isinstance(name, str) and isinstance(amount, (int, float)):
                outputs.append({"name": name, "amount": amount})
        return outputs
    name = recipe.get("result")
    amount = recipe.get("result_count", 1)
    if isinstance(name, str) and isinstance(amount, (int, float)):
        return [{"name": name, "amount": amount}]
    return []


def read_item_graph(data_dir: Path, packages: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    recipes_by_name: dict[str, dict[str, Any]] = {}
    for package in packages:
        path = data_dir / package / "prototypes" / "recipe.lua"
        if not path.is_file():
            continue
        for prototype in parse_prototypes(path.read_text(encoding="utf-8-sig"), "recipe"):
            recipes_by_name[prototype["name"]] = prototype

    items: dict[str, dict[str, Any]] = {}
    for recipe_name, original in recipes_by_name.items():
        recipe = original.get("normal") if isinstance(original.get("normal"), dict) else original
        inputs = _ingredients(recipe.get("ingredients"))
        outputs = _outputs(recipe)
        if not outputs:
            continue
        recipe_data = {
            "name": recipe_name,
            "ingredients": inputs,
            "outputs": outputs,
            "energy": recipe.get("energy_required", original.get("energy_required", 0.5)),
        }
        for ingredient in inputs:
            items.setdefault(ingredient["name"], {"name": ingredient["name"], "recipes": []})
        for output in outputs:
            node = items.setdefault(output["name"], {"name": output["name"], "recipes": []})
            node["recipes"].append(recipe_data)
    return items
