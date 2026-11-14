from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from data_writer import build_crafting_payload, write_crafting_data
from item_reader import read_crafting_data
from technology_reader import build_technology_payload, read_technologies


def write_fixture(root: Path) -> None:
    base = root / "base" / "prototypes"
    (base / "entity").mkdir(parents=True)
    (base / "recipe.lua").write_text(
        '''data:extend({
  {type = "recipe", name = "fluid-product", category = "chemistry",
    ingredients = {{type = "fluid", name = "water", amount = 10}, {"iron-plate", 2}},
    results = {{type = "fluid", name = "steam", amount_min = 1, amount_max = 3, probability = 0.5}, {type = "item", name = "gear", amount = 2}},
    energy_required = 2, enabled = false, hidden = true, hide_from_player_crafting = true, allow_productivity = false},
  {type = "recipe", name = "variant-product", category = "crafting",
    normal = {ingredients = {{"iron-plate", 1}}, result = "normal-output"},
    expensive = {ingredients = {{"iron-plate", 5}}, result = "expensive-output"}},
  {type = "recipe", name = "unavailable-product", category = "smelting",
        ingredients = {{"iron-plate", 1}}, result = "unavailable-output", enabled = false},
    {type = "recipe", name = "fluid-only", category = "chemistry",
        ingredients = {{type = "fluid", name = "water", amount = 1}},
        results = {{type = "fluid", name = "steam", amount = 1}}}
})
''',
        encoding="utf-8",
    )
    (base / "item.lua").write_text(
        '''data:extend({
  {type = "item", name = "gear", subgroup = "intermediate", hidden = true, place_result = "gear-entity", stack_size = 100},
  {type = "item", name = "iron-plate", subgroup = "raw-material", stack_size = 100},
  {type = "module", name = "speed-module", effect = {speed = {bonus = 0.2}}, category = "speed"}
})
''',
        encoding="utf-8",
    )
    (base / "entity" / "entities.lua").write_text(
        '''data:extend({
  {type = "assembling-machine", name = "dry-chemical-machine", crafting_categories = {"chemistry"}, crafting_speed = 1, module_slots = 2, allowed_effects = {"speed"}, collision_box = {{-1.2, -1.2}, {1.2, 1.2}}},
    {type = "assembling-machine", name = "input-only-chemical-machine", crafting_categories = {"chemistry"}, crafting_speed = 1, fluid_boxes = {{production_type = "input"}}},
  {type = "chemical-plant", name = "chemical-plant", crafting_categories = {"chemistry"}, crafting_speed = 2, module_slots = 3, allowed_effects = {"speed", "productivity"}, fluid_boxes = {{production_type = "input"}, {production_type = "output"}}, collision_box = {{-1.2, -1.2}, {1.2, 1.2}}},
  {type = "beacon", name = "beacon", module_slots = 2, allowed_effects = {"speed"}, supply_area_distance = 3, distribution_effectivity = 0.5}
})
''',
        encoding="utf-8",
    )
    (base / "technology.lua").write_text(
        '''data:extend({
  {type = "technology", name = "chemical-tech", effects = {{type = "unlock-recipe", recipe = "fluid-product"}}}
})
''',
        encoding="utf-8",
    )


class CraftingDataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        write_fixture(self.root)
        self.technologies = {
            "chemical-tech": {"effects": [{"type": "unlock-recipe", "recipe": "fluid-product"}]}
        }

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def read_data(self) -> dict:
        return read_crafting_data(self.root, ("base",), self.technologies)

    @staticmethod
    def recipe_index(data: dict) -> dict[str, dict]:
        return {
            recipe["name"]: recipe
            for item in data["items"].values()
            for recipe in item["recipes"]
        }

    def test_recipe_metadata_fluids_and_unlock_availability(self) -> None:
        data = self.read_data()
        recipe = self.recipe_index(data)["fluid-product"]

        self.assertEqual(recipe["categories"], ["chemistry"])
        self.assertEqual(recipe["energy"], 2)
        self.assertFalse(recipe["enabled"])
        self.assertTrue(recipe["hidden"])
        self.assertTrue(recipe["hideFromPlayerCrafting"])
        self.assertFalse(recipe["allowProductivity"])
        self.assertEqual(recipe["unlockedBy"], ["chemical-tech"])
        self.assertTrue(recipe["available"])
        self.assertEqual(recipe["compatibleMachines"], ["chemical-plant"])
        self.assertEqual([material["type"] for material in recipe["ingredients"]], ["fluid", "item"])
        self.assertEqual([(material["type"], material["name"]) for material in recipe["outputs"]], [("fluid", "steam"), ("item", "gear")])
        steam = next(output for output in recipe["outputs"] if output["name"] == "steam")
        self.assertEqual((steam["amountMin"], steam["amountMax"], steam["probability"], steam["amount"]), (1, 3, 0.5, 1.0))

    def test_item_machine_module_and_beacon_metadata(self) -> None:
        data = self.read_data()
        gear = data["items"]["gear"]
        catalog = data["catalog"]
        machines = {machine["name"]: machine for machine in catalog["machines"]}

        self.assertEqual(gear["subgroup"], "intermediate")
        self.assertTrue(gear["hidden"])
        self.assertEqual(gear["placeResult"], "gear-entity")
        self.assertEqual(data["items"]["iron-plate"]["subgroup"], "raw-material")
        self.assertIn("fluid-only", {recipe["name"] for recipe in catalog["fluidRecipes"]})
        self.assertEqual(machines["chemical-plant"]["footprint"], [3, 3])
        self.assertEqual(machines["chemical-plant"]["moduleSlots"], 3)
        self.assertTrue(machines["chemical-plant"]["fluidInput"])
        self.assertTrue(machines["chemical-plant"]["fluidOutput"])
        self.assertEqual(catalog["modules"][0]["effects"]["speed"]["bonus"], 0.2)
        self.assertEqual(catalog["beacons"][0]["distributionEffectivity"], 0.5)

    def test_normal_variant_is_selected_instead_of_combining_difficulties(self) -> None:
        data = self.read_data()

        self.assertEqual(data["items"]["normal-output"]["recipes"][0]["variant"], "normal")
        self.assertNotIn("expensive-output", data["items"])

    def test_later_package_recipe_replaces_earlier_definition(self) -> None:
        addon = self.root / "addon" / "prototypes"
        addon.mkdir(parents=True)
        (addon / "recipe.lua").write_text(
            'data:extend({{type = "recipe", name = "variant-product", category = "crafting", result = "addon-output"}})',
            encoding="utf-8",
        )

        data = read_crafting_data(self.root, ("base", "addon"), self.technologies)

        self.assertIn("addon-output", data["items"])
        self.assertNotIn("normal-output", data["items"])


    def test_disabled_recipe_without_unlock_is_not_available(self) -> None:
        recipe = self.recipe_index(self.read_data())["unavailable-product"]

        self.assertFalse(recipe["available"])
        self.assertEqual(recipe["compatibleMachines"], [])

    def test_technology_payload_retains_recipe_unlocks(self) -> None:
        (self.root / "base" / "data-updates.lua").write_text(
            'data.raw.technology["chemical-tech"].effects = {{type = "unlock-recipe", recipe = "updated-recipe"}}',
            encoding="utf-8",
        )
        technologies = read_technologies(self.root, ("base",))
        payload = build_technology_payload(technologies, {})

        self.assertEqual(payload["chemical-tech"]["unlockRecipes"], ["updated-recipe"])

    def test_crafting_json_contains_data_labels_and_catalog_indexes(self) -> None:
        data = self.read_data()
        data["catalog"]["fluidLabels"] = {"water": "Water", "steam": "Steam"}
        data["catalog"]["technologyLabels"] = {"chemical-tech": "Chemical technology"}
        for machine in data["catalog"]["machines"]:
            machine["label"] = machine["name"]
        with tempfile.TemporaryDirectory() as output_dir:
            output = Path(output_dir) / "crafting.json"
            write_crafting_data({"base": data}, output)
            payload = json.loads(output.read_text(encoding="utf-8"))

        self.assertTrue(any(
            recipe["name"] == "fluid-product"
            for item in payload["datasets"]["base"].values()
            for recipe in item["recipes"]
        ))
        self.assertTrue(payload["datasets"]["base"]["gear"]["recipes"][0]["hideFromPlayerCrafting"])
        self.assertIn("chemical-plant", payload["catalogs"]["base"]["machineByName"])
        self.assertEqual(payload["catalogs"]["base"]["fluidLabels"]["water"], "Water")
        self.assertEqual(payload["catalogs"]["base"]["technologyLabels"]["chemical-tech"], "Chemical technology")
        self.assertEqual(payload["labels"]["base"]["gear"], "gear")
        self.assertNotIn("__prototype_catalog__", payload["datasets"]["base"])

    def test_crafting_payload_has_expected_sections(self) -> None:
        payload = build_crafting_payload({"base": self.read_data()})

        self.assertEqual(set(payload), {"datasets", "catalogs", "labels"})


def factorio_data_path() -> Path:
    configured = os.environ.get("FACTORIO_DATA", os.environ.get("FACTORIO_DATA_DIR"))
    return Path(configured) if configured else Path(r"C:\Program Files (x86)\Steam\steamapps\common\Factorio\data")


class InstalledFactorioDataTests(unittest.TestCase):
    def test_base_data_has_fluid_recipes_unlocks_and_machine_catalog(self) -> None:
        root = factorio_data_path()
        if not root.is_dir():
            self.fail(f"Factorio data directory is required for integration tests: {root}")
        technologies = read_technologies(root, ("base",))
        data = read_crafting_data(root, ("base",), technologies)
        recipes = {
            recipe["name"]: recipe
            for item in data["items"].values()
            for recipe in item["recipes"]
        }
        recipes.update({recipe["name"]: recipe for recipe in data["catalog"]["fluidRecipes"]})

        self.assertTrue(any(material["type"] == "fluid" for material in recipes["plastic-bar"]["ingredients"]))
        self.assertTrue(recipes["rocket-part"]["hideFromPlayerCrafting"])
        self.assertTrue(recipes["rocket-part"]["unlockedBy"])
        self.assertIn("assembling-machine-2", {machine["name"] for machine in data["catalog"]["machines"]})
        self.assertTrue(data["catalog"]["modules"])
        self.assertTrue(data["catalog"]["beacons"])

        advanced_oil = recipes["advanced-oil-processing"]
        self.assertTrue(all(material["type"] == "fluid" for material in advanced_oil["ingredients"]))
        self.assertCountEqual(
            [material["name"] for material in advanced_oil["outputs"]],
            ["heavy-oil", "light-oil", "petroleum-gas"],
        )
        self.assertEqual(advanced_oil["compatibleMachines"], ["oil-refinery"])

        solid_fuel = recipes["solid-fuel-from-petroleum-gas"]
        self.assertEqual(
            [(material["type"], material["name"]) for material in solid_fuel["ingredients"]],
            [("fluid", "petroleum-gas")],
        )
        self.assertEqual(
            [(material["type"], material["name"]) for material in solid_fuel["outputs"]],
            [("item", "solid-fuel")],
        )
        self.assertIn("chemical-plant", solid_fuel["compatibleMachines"])

    def test_space_age_foundry_and_sulfur_recipes_keep_all_materials(self) -> None:
        root = factorio_data_path()
        if not root.is_dir():
            self.fail(f"Factorio data directory is required for integration tests: {root}")
        packages = ("base", "quality", "elevated-rails", "recycler", "space-age")
        technologies = read_technologies(root, packages)
        data = read_crafting_data(root, packages, technologies)
        recipes = {
            recipe["name"]: recipe
            for item in data["items"].values()
            for recipe in item["recipes"]
        }
        recipes.update({recipe["name"]: recipe for recipe in data["catalog"]["fluidRecipes"]})

        lava_smelting = recipes["molten-iron-from-lava"]
        self.assertEqual(
            [(material["type"], material["name"]) for material in lava_smelting["ingredients"]],
            [("fluid", "lava"), ("item", "calcite")],
        )
        self.assertEqual(
            [(material["type"], material["name"]) for material in lava_smelting["outputs"]],
            [("fluid", "molten-iron"), ("item", "stone")],
        )
        self.assertEqual(lava_smelting["compatibleMachines"], ["foundry"])

        sulfur = recipes["sulfur"]
        self.assertTrue(all(material["type"] == "fluid" for material in sulfur["ingredients"]))
        self.assertEqual([(material["type"], material["name"]) for material in sulfur["outputs"]], [("item", "sulfur")])
        self.assertIn("chemical-plant", sulfur["compatibleMachines"])

        sulfuric_acid = recipes["sulfuric-acid"]
        self.assertCountEqual([material["type"] for material in sulfuric_acid["ingredients"]], ["fluid", "item", "item"])
        self.assertEqual([(material["type"], material["name"]) for material in sulfuric_acid["outputs"]], [("fluid", "sulfuric-acid")])
        self.assertIn("chemical-plant", sulfuric_acid["compatibleMachines"])
        self.assertNotIn("sulfuric-acid", data["items"])
        self.assertIn("sulfuric-acid", {recipe["name"] for recipe in data["catalog"]["fluidRecipes"]})


if __name__ == "__main__":
    unittest.main()