"""Bake generated art sheets into the tiny files the page loads.

    python scripts/bake-art.py            write public/art/*
    python scripts/bake-art.py --check    exit 1 if a baked file is stale

Raw sheets live in art/sheets/ and are never loaded by the page. See
docs/ART_PROMPTS.md for how the sheets are made. Needs Pillow.

A stamp sheet is black ink on white. Each cell becomes a 1-bit mask with a
transparent background; the page shows it through CSS mask-image, so the
color comes from the page, not from the file.
"""
import io
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEETS = os.path.join(ROOT, "art", "sheets")
OUT = os.path.join(ROOT, "public", "art")

# One strip per stamp sheet: cells left to right, in sheet reading order.
# The page addresses a cell by its index, so the order here is a contract
# with the .emblem rules in public/index.html.
STAMPS = {
    "emblems.png": {
        "sheet": "01-game-emblems.png",
        "cols": 3,
        "rows": 3,
        "cell": 128,      # baked pixels per side; shown at 28 to 48 CSS px
        "margin": 0.04,   # empty border inside each baked cell
    },
}


def ink_mask(image):
    """Black ink on white paper -> L image, 255 where there is ink."""
    return image.convert("L").point(lambda p: 255 if p < 128 else 0)


def bake_stamps(spec):
    sheet = Image.open(os.path.join(SHEETS, spec["sheet"]))
    width, height = sheet.size
    cols, rows, cell = spec["cols"], spec["rows"], spec["cell"]
    strip = Image.new("L", (cell * cols * rows, cell), 0)
    inner = round(cell * (1 - 2 * spec["margin"]))
    for index in range(cols * rows):
        col, row = index % cols, index // cols
        box = (col * width // cols, row * height // rows,
               (col + 1) * width // cols, (row + 1) * height // rows)
        ink = ink_mask(sheet.crop(box))
        bounds = ink.getbbox()
        if not bounds:
            raise SystemExit(f"{spec['sheet']}: cell {index + 1} is empty")
        ink = ink.crop(bounds)
        scale = inner / max(ink.size)
        size = (max(1, round(ink.size[0] * scale)), max(1, round(ink.size[1] * scale)))
        ink = ink.resize(size, Image.LANCZOS)
        strip.paste(ink, (index * cell + (cell - size[0]) // 2, (cell - size[1]) // 2))
    # Threshold after the downscale: no gray edge pixels, so the file is 1-bit.
    bits = strip.point(lambda p: 1 if p >= 128 else 0).convert("P")
    bits.putpalette([0, 0, 0, 255, 255, 255])
    buffer = io.BytesIO()
    bits.save(buffer, "PNG", optimize=True, bits=1, transparency=0)
    return buffer.getvalue()


def main():
    check = "--check" in sys.argv[1:]
    stale = []
    os.makedirs(OUT, exist_ok=True)
    for name, spec in STAMPS.items():
        data = bake_stamps(spec)
        path = os.path.join(OUT, name)
        current = None
        if os.path.exists(path):
            with open(path, "rb") as handle:
                current = handle.read()
        if current == data:
            continue
        if check:
            stale.append(name)
            continue
        with open(path, "wb") as handle:
            handle.write(data)
        print(f"wrote public/art/{name} ({len(data)} bytes)")
    if stale:
        print("stale: " + ", ".join(stale) + " (run python scripts/bake-art.py)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
