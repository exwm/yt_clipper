"""Stack `just ui-look` shots into one sheet: a row per step and background, oldest step first, with
1x shots enlarged 4x and 2x shots 2x (nearest neighbor, so each pixel stays visible)."""

import re
import sys
from pathlib import Path

from harness.paths import SANDBOX
from PIL import Image, ImageDraw

LOOK = SANDBOX / "ui-look"
SCALE = {"1x": 4, "2x": 2}
COLUMNS = [("1x", "rest"), ("1x", "hover"), ("2x", "rest"), ("2x", "hover")]
GAP = 10
LABEL_H = 18
BACKGROUND = (40, 40, 40)


def look_folder(scenario: str, selector: str) -> Path:
    return LOOK / scenario / re.sub(r"[^\w-]+", "_", selector).strip("_")


def shot_stem(step: str, style: str, density: int) -> str:
    """`step~style~density`, the name build_sheet reads back, so a step can't contain `~`."""
    if not re.fullmatch(r"[\w.-]+", step) or set(step) == {"."}:
        raise ValueError(f"--look-step {step!r}: use only letters, digits, `.`, `_` and `-`")
    return f"{step}~{style}~{density}x"


def build_sheet(folder: Path) -> Path:
    shots = {tuple(p.stem.split("~")): p for p in folder.glob("*~*~*~*.png")}
    first_seen: dict[tuple[str, str], float] = {}
    for (step, style, _, _), path in shots.items():
        first_seen[step, style] = min(
            first_seen.get((step, style), path.stat().st_mtime), path.stat().st_mtime
        )
    rows = []
    for step, style in sorted(first_seen, key=first_seen.__getitem__):
        tiles = []
        for density, state in COLUMNS:
            path = shots.get((step, style, density, state))
            if path:
                image = Image.open(path).convert("RGB")
                scale = SCALE[density]
                tiles.append(
                    image.resize(
                        (image.width * scale, image.height * scale), Image.Resampling.NEAREST
                    )
                )
        row = Image.new(
            "RGB",
            (sum(t.width + GAP for t in tiles), max(t.height for t in tiles) + LABEL_H),
            BACKGROUND,
        )
        labels = ", ".join(f"{d} {s}" for d, s in COLUMNS if (step, style, d, s) in shots)
        ImageDraw.Draw(row).text((4, 3), f"{step} / {style}   ({labels})", fill="white")
        x = 0
        for tile in tiles:
            row.paste(tile, (x, LABEL_H))
            x += tile.width + GAP
        rows.append(row)
    sheet = Image.new("RGB", (max(r.width for r in rows), sum(r.height for r in rows)), BACKGROUND)
    y = 0
    for row in rows:
        sheet.paste(row, (0, y))
        y += row.height
    path = folder / "sheet.png"
    sheet.save(path)
    return path


if __name__ == "__main__":
    # just ui-look: once, after the runs for every background
    print(build_sheet(look_folder(sys.argv[1], sys.argv[2])))
