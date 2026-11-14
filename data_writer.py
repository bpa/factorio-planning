from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def write_technology_data(datasets: dict[str, dict[str, Any]], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(datasets, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build_crafting_payload(datasets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    page_datasets: dict[str, dict[str, Any]] = {}
    catalogs: dict[str, dict[str, Any]] = {}
    labels: dict[str, dict[str, str]] = {}
    for mod, data in datasets.items():
        page_datasets[mod] = data["items"]
        catalogs[mod] = dict(data["catalog"])
        catalogs[mod]["machineByName"] = {
            machine["name"]: machine for machine in catalogs[mod]["machines"]
        }
        labels[mod] = {name: item.get("label", name) for name, item in data["items"].items()}
    return {"datasets": page_datasets, "catalogs": catalogs, "labels": labels}


def write_crafting_data(datasets: dict[str, dict[str, Any]], output: Path) -> None:
    payload = build_crafting_payload(datasets)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")