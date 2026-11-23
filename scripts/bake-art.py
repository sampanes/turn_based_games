"""Bake generated art sheets into the tiny files the page loads.

    python scripts/bake-art.py            write public/art/*
    python scripts/bake-art.py --check    exit 1 if a baked file is stale

Raw sheets live in art/sheets/ and are never loaded by the page. See
docs/ART_PROMPTS.md for how the sheets are made. Needs Pillow.

A stamp sheet is black ink on white. Each cell becomes a 1-bit mask with a
transparent background; the page shows it through CSS mask-image, so the
color comes from the page, not from the file.

A picture sheet is flat color on a transparent background. Every pixel is
snapped to the nearest ink below, so the baked file holds at most eight
colors whatever the generator painted.
"""
import io
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEETS = os.path.join(ROOT, "art", "sheets")
OUT = os.path.join(ROOT, "public", "art")

# The page's own colors (the :root variables in public/index.html).
INKS = [
    (0x06, 0x14, 0x1B),  # deep navy
    (0x11, 0x31, 0x3F),  # hull
    (0x1D, 0x4A, 0x5E),  # slate
    (0x34, 0xE7, 0xC4),  # sonar teal
    (0xFF, 0xB3, 0x47),  # amber
    (0x96, 0x54, 0x0F),  # dark amber
    (0xCF, 0xE9, 0xEC),  # cream
    (0xFF, 0x5B, 0x51),  # coral
]
CLEAR = len(INKS)  # palette index used for transparent pixels

# One strip per sheet: cells left to right, in sheet reading order. The page
# addresses a cell by its index, so the order here is a contract with the
# .emblem and .botty rules in public/index.html.
STAMPS = {
    "emblems.png": {
        "sheet": "01-game-emblems.png",
        "cols": 3,
        "rows": 3,
        "cell": 128,      # baked pixels per side; shown at 24 to 48 CSS px
        "margin": 0.04,   # empty border inside each baked cell
    },
}
# Ships are not on a grid: each is one band of ink, top to bottom, bow to
# the right. Baked as a 10 x 5 block of square cells: the left 5 x 5 holds
# the ships lying east (row = ship, column = cell from the stern), the right
# 5 x 5 holds them heading south (column = ship, row = cell from the stern).
FLEET = {
    "fleet.png": {
        "sheet": "03-fleet.png",
        "lengths": [5, 4, 3, 3, 2],   # cells per ship, in sheet order
        "cell": 64,                   # baked pixels per grid cell
        "end_gap": 0.07,              # clear water at bow and stern, in cells
        # A ship scaled to its length may be too tall or too slight for its
        # row; it is stretched across the beam into this range (in cells).
        "beam": (0.76, 0.92),
        "ink": (0xBF, 0xE6, 0xEC),
    },
}
PICTURES = {
    "botty.png": {
        "sheet": "02-botty.png",
        "cols": 3,
        "rows": 2,
        "height": 132,    # baked pixels tall; shown at 36 to 64 CSS px
        # Keep only the top of each cell (head and neck), as a share of the
        # cell's inked height. The shoulders are dark and vanish on the page.
        "keep": 0.8,
    },
}


def ink_mask(image):
    """Black ink on white paper -> L image, 255 where there is ink."""
    return image.convert("L").point(lambda p: 255 if p < 128 else 0)


def cells(sheet, cols, rows):
    width, height = sheet.size
    for index in range(cols * rows):
        col, row = index % cols, index // cols
        yield sheet.crop((col * width // cols, row * height // rows,
                          (col + 1) * width // cols, (row + 1) * height // rows))


def bake_stamps(spec):
    sheet = Image.open(os.path.join(SHEETS, spec["sheet"]))
    cols, rows, cell = spec["cols"], spec["rows"], spec["cell"]
    strip = Image.new("L", (cell * cols * rows, cell), 0)
    inner = round(cell * (1 - 2 * spec["margin"]))
    for index, piece in enumerate(cells(sheet, cols, rows)):
        ink = ink_mask(piece)
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


def ink_bands(ink):
    """Rows of a sheet that hold ink, as (top, bottom) runs."""
    width, height = ink.size
    bands, start = [], None
    for y in range(height + 1):
        inked = y < height and ink.crop((0, y, width, y + 1)).getbbox() is not None
        if inked and start is None:
            start = y
        if not inked and start is not None:
            if y - start > 20:
                bands.append((start, y))
            start = None
    return bands


def bake_fleet(spec):
    ink = ink_mask(Image.open(os.path.join(SHEETS, spec["sheet"])))
    bands = ink_bands(ink)
    lengths, cell = spec["lengths"], spec["cell"]
    if len(bands) != len(lengths):
        raise SystemExit(f"{spec['sheet']}: found {len(bands)} ships, expected {len(lengths)}")
    longest = max(lengths)
    east = Image.new("L", (cell * longest, cell * len(lengths)), 0)
    low, high = spec["beam"]
    for row, ((top, bottom), length) in enumerate(zip(bands, lengths)):
        ship = ink.crop((0, top, ink.size[0], bottom))
        ship = ship.crop(ship.getbbox())
        out_w = round((length - 2 * spec["end_gap"]) * cell)
        beam = ship.size[1] * out_w / ship.size[0] / cell
        out_h = round(min(max(beam, low), high) * cell)
        ship = ship.resize((out_w, out_h), Image.LANCZOS)
        east.paste(ship, ((length * cell - out_w) // 2, row * cell + (cell - out_h) // 2))
    south = east.transpose(Image.ROTATE_270).transpose(Image.FLIP_LEFT_RIGHT)
    block = Image.new("L", (east.size[0] + south.size[0], max(east.size[1], south.size[1])), 0)
    block.paste(east, (0, 0))
    block.paste(south, (east.size[0], 0))
    bits = block.point(lambda p: 1 if p >= 128 else 0).convert("P")
    bits.putpalette([0, 0, 0] + list(spec["ink"]))
    buffer = io.BytesIO()
    bits.save(buffer, "PNG", optimize=True, bits=1, transparency=0)
    return buffer.getvalue()


def ink_palette():
    flat = [channel for ink in INKS for channel in ink]
    holder = Image.new("P", (1, 1))
    holder.putpalette(flat + [0] * (768 - len(flat)))
    return holder


def snap_to_inks(image):
    """RGBA -> P image: nearest ink where opaque, CLEAR where transparent."""
    image = image.convert("RGBA")
    solid = image.getchannel("A").point(lambda p: 255 if p >= 128 else 0)
    snapped = image.convert("RGB").quantize(palette=ink_palette(), dither=Image.NONE)
    snapped.paste(CLEAR, mask=solid.point(lambda p: 255 - p))
    return snapped


def bake_pictures(spec):
    sheet = Image.open(os.path.join(SHEETS, spec["sheet"])).convert("RGBA")
    frames = []
    for index, piece in enumerate(cells(sheet, spec["cols"], spec["rows"])):
        bounds = piece.getchannel("A").point(lambda p: 255 if p >= 128 else 0).getbbox()
        if not bounds:
            raise SystemExit(f"{spec['sheet']}: cell {index + 1} is empty")
        frames.append(piece.crop(bounds))
    # Every frame gets the same box, measured from its own top-left corner, so
    # the frames register when the page swaps one for another.
    width = min(frame.size[0] for frame in frames)
    height = round(min(frame.size[1] for frame in frames) * spec["keep"])
    out_h = spec["height"]
    out_w = round(width * out_h / height)
    strip = Image.new("P", (out_w * len(frames), out_h), CLEAR)
    strip.putpalette(ink_palette().getpalette())
    for index, frame in enumerate(frames):
        frame = frame.crop((0, 0, width, height))
        # Transparent pixels can hold any leftover color; clear them before the
        # downscale so it does not bleed into the edge.
        clean = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        clean.paste(frame, mask=frame.getchannel("A").point(lambda p: 255 if p >= 128 else 0))
        small = clean.convert("RGBa").resize((out_w, out_h), Image.LANCZOS).convert("RGBA")
        strip.paste(snap_to_inks(small), (index * out_w, 0))
    buffer = io.BytesIO()
    strip.save(buffer, "PNG", optimize=True, bits=4, transparency=CLEAR)
    return buffer.getvalue()


def main():
    check = "--check" in sys.argv[1:]
    stale = []
    os.makedirs(OUT, exist_ok=True)
    jobs = [(name, bake_stamps, spec) for name, spec in STAMPS.items()]
    jobs += [(name, bake_fleet, spec) for name, spec in FLEET.items()]
    jobs += [(name, bake_pictures, spec) for name, spec in PICTURES.items()]
    for name, bake, spec in jobs:
        data = bake(spec)
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
