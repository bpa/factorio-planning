from __future__ import annotations

from pathlib import Path
from typing import Any

from lua_parser import TableReader, matching_braces, parse_prototypes, tokenize

DIRECT_FIELDS = {"prerequisites", "unit", "max_level", "level", "research_trigger", "effects"}


def _static_member(tokens: list[tuple[str, str]], position: int) -> tuple[str, int] | None:
    if position >= len(tokens):
        return None
    kind, value = tokens[position]
    if kind == "identifier":
        return value, position + 1
    if value == "[" and position + 2 < len(tokens) and tokens[position + 1][0] == "string" and tokens[position + 2][1] == "]":
        return tokens[position + 1][1], position + 3
    return None


def _apply_updates(data_dir: Path, packages: tuple[str, ...], technologies: dict[str, dict[str, Any]]) -> None:
    for package in packages:
        package_dir = data_dir / package
        paths = sorted((*package_dir.glob("base-data-updates.lua"), *package_dir.glob("data-updates.lua")))
        for path in paths:
            tokens = tokenize(path.read_text(encoding="utf-8-sig"))
            matching, _ = matching_braces(tokens)
            position = 0
            while position < len(tokens):
                if tokens[position] != ("identifier", "data"):
                    position += 1
                    continue
                cursor = position + 1
                expected = (("symbol", "."), ("identifier", "raw"), ("symbol", "."))
                if cursor + len(expected) > len(tokens) or tuple(tokens[cursor : cursor + 3]) != expected:
                    position += 1
                    continue
                member = _static_member(tokens, cursor + 3)
                if member is None or member[0] != "technology":
                    position += 1
                    continue
                cursor = member[1]
                if cursor < len(tokens) and tokens[cursor][1] == ".":
                    technology_member = _static_member(tokens, cursor + 1)
                else:
                    technology_member = _static_member(tokens, cursor)
                if technology_member is None:
                    position += 1
                    continue
                name, cursor = technology_member
                field_path: list[str] = []
                while cursor < len(tokens):
                    if tokens[cursor][1] == ".":
                        field = _static_member(tokens, cursor + 1)
                    elif tokens[cursor][1] == "[":
                        field = _static_member(tokens, cursor)
                    else:
                        break
                    if field is None:
                        break
                    field_path.append(field[0])
                    cursor = field[1]
                if not field_path or cursor >= len(tokens) or tokens[cursor][1] != "=":
                    position += 1
                    continue
                value_position = cursor + 1
                if value_position >= len(tokens):
                    position += 1
                    continue
                reader = TableReader(tokens, matching)
                reader.position = value_position
                value = reader.read_value()
                if tokens[value_position][1] not in ("{",) and tokens[value_position][0] not in ("string", "number") and tokens[value_position][1] not in ("true", "false", "nil"):
                    position += 1
                    continue
                technology = technologies.get(name)
                if technology is not None:
                    if len(field_path) == 1 and field_path[0] in DIRECT_FIELDS:
                        if value is None:
                            technology.pop(field_path[0], None)
                        else:
                            technology[field_path[0]] = value
                    elif len(field_path) == 2 and field_path[0] == "unit":
                        unit = technology.setdefault("unit", {})
                        if not isinstance(unit, dict):
                            unit = {}
                            technology["unit"] = unit
                        if value is None:
                            unit.pop(field_path[1], None)
                        else:
                            unit[field_path[1]] = value
                position = max(reader.position, position + 1)


def read_technologies(data_dir: Path, packages: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    technologies: dict[str, dict[str, Any]] = {}
    found_files = 0
    for package in packages:
        for path in sorted((data_dir / package).glob("prototypes/technology.lua")):
            found_files += 1
            for technology in parse_prototypes(path.read_text(encoding="utf-8-sig"), "technology"):
                technologies[technology["name"]] = technology
    if not found_files:
        raise FileNotFoundError(f"No technology.lua prototype files found for {', '.join(packages)} under {data_dir}")
    _apply_updates(data_dir, packages, technologies)
    return technologies


def build_technology_payload(prototypes: dict[str, dict[str, Any]], localized_names: dict[str, str]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, prototype in prototypes.items():
        unit = prototype.get("unit")
        unit = unit if isinstance(unit, dict) else {}
        count = unit.get("count")
        count_formula = unit.get("count_formula")
        time = unit.get("time")
        max_level = prototype.get("max_level", 1)
        initial_level = prototype.get("level", 1)
        prerequisites = prototype.get("prerequisites", [])
        if not isinstance(prerequisites, list):
            prerequisites = []
        ingredients: list[dict[str, Any]] = []
        raw_ingredients = unit.get("ingredients", [])
        if isinstance(raw_ingredients, list):
            for ingredient in raw_ingredients:
                if isinstance(ingredient, list) and ingredient and isinstance(ingredient[0], str):
                    amount = ingredient[1] if len(ingredient) > 1 else 1
                    ingredient_name = ingredient[0]
                elif isinstance(ingredient, dict):
                    ingredient_name = ingredient.get("name")
                    amount = ingredient.get("amount", 1)
                else:
                    continue
                if isinstance(ingredient_name, str) and isinstance(amount, (int, float)):
                    ingredients.append({"name": ingredient_name, "amount": amount})
        if not isinstance(initial_level, (int, float)):
            initial_level = 1
        effects = prototype.get("effects", [])
        if isinstance(effects, dict):
            effects = [effects[key] for key in sorted(effects, key=lambda value: str(value))]
        unlock_recipes = [
            effect["recipe"]
            for effect in effects
            if isinstance(effects, list)
            and isinstance(effect, dict)
            and effect.get("type") == "unlock-recipe"
            and isinstance(effect.get("recipe"), str)
        ] if isinstance(effects, list) else []
        result[name] = {
            "name": name,
            "label": localized_names.get(name, name),
            "prerequisites": [item for item in prerequisites if isinstance(item, str)],
            "ingredients": ingredients,
            "count": count if isinstance(count, (int, float)) else None,
            "countFormula": count_formula if isinstance(count_formula, str) else None,
            "initialLevel": initial_level,
            "time": time if isinstance(time, (int, float)) else None,
            "maxLevel": max_level,
            "hasResearchTrigger": isinstance(prototype.get("research_trigger"), dict),
            "unlockRecipes": unlock_recipes,
        }
    return result
