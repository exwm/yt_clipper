"""Stack `just ui-look` shots into one sheet: a row per step and background, oldest step first, with
1x shots enlarged 4x and 2x shots 2x (nearest neighbor, so each pixel stays visible)."""

import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SCALE = {"1x": 4, "2x": 2}
COLUMNS = [("1x", "rest"), ("1x", "hover"), ("2x", "rest"), ("2x", "hover")]
GAP = 10
LABEL_H = 18
BACKGROUND = (40, 40, 40)


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
    # Saved under a temporary name first: parallel workers each rebuild the sheet after their shots.
    path = folder / "sheet.png"
    partial = folder / f"sheet.{os.getpid()}.partial.png"
    sheet.save(partial)
    partial.replace(path)
    return path


if __name__ == "__main__":
    print(build_sheet(Path(sys.argv[1])))
