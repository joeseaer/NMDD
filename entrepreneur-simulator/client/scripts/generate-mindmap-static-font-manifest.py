"""Generate the pinned mind-map export font manifest from installed WOFF2 files.

The output is committed so normal builds do not need Python/fontTools. Run this
script only when deliberately updating one of the exact Fontsource versions.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from fontTools.ttLib import TTFont


CLIENT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = (
    CLIENT_ROOT
    / "src"
    / "features"
    / "mindmap"
    / "export"
    / "staticFontManifest.generated.ts"
)
EXPECTED_VERSION = "5.3.0"

FONT_SOURCES = (
    {
        "package": "@fontsource-variable/noto-sans-sc",
        "slug": "noto-sans-sc",
        "kind": "sans",
        "variant": "wght-normal",
        "stretch_min": 100,
        "stretch_max": 100,
        "weight_min": 100,
        "weight_max": 900,
    },
    {
        "package": "@fontsource-variable/noto-emoji",
        "slug": "noto-emoji",
        "kind": "emoji",
        "variant": "wght-normal",
        "stretch_min": 100,
        "stretch_max": 100,
        "weight_min": 300,
        "weight_max": 700,
    },
    {
        "package": "@fontsource-variable/noto-sans-mono",
        "slug": "noto-sans-mono",
        "kind": "mono",
        # The standard variable files carry both wght and wdth axes. The
        # default wght-only files cannot produce the fixed 0.5em Latin grid.
        "variant": "standard-normal",
        "stretch_min": 62.5,
        "stretch_max": 100,
        "weight_min": 100,
        "weight_max": 900,
    },
)


def compressed_ranges(code_points: list[int]) -> str:
    if not code_points:
        raise RuntimeError("A pinned font shard has no Unicode cmap entries.")
    result: list[str] = []
    start = previous = code_points[0]
    for code_point in code_points[1:]:
        if code_point == previous + 1:
            previous = code_point
            continue
        result.append(f"{start:x}" if start == previous else f"{start:x}-{previous:x}")
        start = previous = code_point
    result.append(f"{start:x}" if start == previous else f"{start:x}-{previous:x}")
    return ",".join(result)


def actual_cmap_ranges(path: Path) -> str:
    font = TTFont(path, lazy=False)
    try:
        code_points: set[int] = set()
        for table in font["cmap"].tables:
            if table.isUnicode():
                code_points.update(table.cmap.keys())
        return compressed_ranges(sorted(code_points))
    finally:
        font.close()


def quoted(value: str) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def normalized_declared_ranges(value: str) -> str:
    result: list[str] = []
    for raw_token in value.split(","):
        token = raw_token.strip().lower()
        if not token.startswith("u+"):
            raise RuntimeError(f"Invalid Fontsource unicode-range token: {raw_token!r}")
        token = token[2:]
        parts = token.split("-", 1)
        if any(not part or any(character not in "0123456789abcdef" for character in part) for part in parts):
            raise RuntimeError(f"Invalid Fontsource unicode-range token: {raw_token!r}")
        result.append(token)
    return ",".join(result)


def main() -> None:
    imports: list[str] = []
    rows: list[str] = []
    ordinal = 0

    for source in FONT_SOURCES:
        package_root = CLIENT_ROOT / "node_modules" / source["package"]
        package_json = json.loads((package_root / "package.json").read_text(encoding="utf-8"))
        if package_json.get("version") != EXPECTED_VERSION:
            raise RuntimeError(
                f"{source['package']} must be pinned to {EXPECTED_VERSION}; "
                f"found {package_json.get('version')!r}."
            )
        unicode_map = json.loads(
            (package_root / "unicode.json").read_text(encoding="utf-8"),
            object_pairs_hook=dict,
        )
        for key in unicode_map:
            token = key[1:-1] if key.startswith("[") and key.endswith("]") else key
            file_name = f"{source['slug']}-{token}-{source['variant']}.woff2"
            font_path = package_root / "files" / file_name
            if not font_path.is_file():
                raise RuntimeError(f"Pinned font file is missing: {font_path}")
            import_name = f"fontAsset{ordinal}Url"
            import_path = f"{source['package']}/files/{file_name}?url"
            imports.append(
                f"import {import_name} from "
                f"{quoted(import_path)};"
            )
            digest = hashlib.sha256(font_path.read_bytes()).hexdigest()
            rows.append(
                "  Object.freeze({"
                f"cmapRanges:{quoted(actual_cmap_ranges(font_path))},"
                f"declaredRanges:{quoted(normalized_declared_ranges(unicode_map[key]))},"
                f"fileName:{quoted(file_name)},"
                f"kind:{quoted(source['kind'])} as const,"
                f"sha256:{quoted(digest)},"
                f"stretchMax:{source['stretch_max']},"
                f"stretchMin:{source['stretch_min']},"
                f"url:{import_name},"
                f"weightMax:{source['weight_max']},"
                f"weightMin:{source['weight_min']}"
                "}),"
            )
            ordinal += 1

    generated = "\n".join(
        [
            "/* eslint-disable */",
            "// This file is generated by scripts/generate-mindmap-static-font-manifest.py.",
            "// Do not edit it by hand; all three Fontsource packages are exact-version inputs.",
            *imports,
            "",
            f"export const MIND_MAP_STATIC_FONT_SOURCE_VERSION = {quoted(EXPECTED_VERSION)};",
            "",
            "export const MIND_MAP_STATIC_FONT_FACE_ASSETS = Object.freeze([",
            *rows,
            "]);",
            "",
        ]
    )
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(generated, encoding="utf-8", newline="\n")
    print(f"generated {ordinal} pinned font faces at {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
