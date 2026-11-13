from __future__ import annotations

from pathlib import Path


def read_locale(data_dir: Path, packages: tuple[str, ...]) -> dict[str, dict[str, str]]:
    sections: dict[str, dict[str, str]] = {
        "item-name": {},
        "fluid-name": {},
        "entity-name": {},
        "technology-name": {},
    }
    for package in packages:
        locale_dir = data_dir / package / "locale" / "en"
        for path in sorted(locale_dir.glob("*.cfg")):
            section = ""
            for line in path.read_text(encoding="utf-8-sig").splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith((";", "#")):
                    continue
                if stripped.startswith("[") and stripped.endswith("]"):
                    section = stripped[1:-1].strip()
                    continue
                if section not in sections or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if key:
                    sections[section][key] = value.strip()
    return sections
