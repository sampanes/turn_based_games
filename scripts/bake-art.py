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
colors whatever the generator painted. A card back is a picture with no
transparency.
"""
import io
import os
import sys

from PIL import Image, ImageDraw

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
    # hit, miss, sunk, aim, win, lose, draw, your turn, invite
    "markers.png": {
        "sheet": "04-markers.png",
        "cols": 3,
        "rows": 3,
        "cell": 96,       # shown at 12 to 44 CSS px
        "margin": 0.04,
    },
    # three brushed X, one heavy X, three brushed O, one heavy O
    "marks.png": {
        "sheet": "05-marks.png",
        "cols": 4,
        "rows": 2,
        "cell": 96,       # shown at 24 to 80 CSS px
        "margin": 0.03,
    },
    # anchor, compass star, whale, lighthouse, octopus, sailboat, shell,
    # crab, ship wheel
    "sigils.png": {
        "sheet": "06-sigils.png",
        "cols": 3,
        "rows": 3,
        "cell": 96,       # shown at 16 to 56 CSS px
        "margin": 0.03,
        # The sheet came back as black discs with the figure left white.
        # Keep the figure and drop the disc.
        "knockout": True,
    },
    # skip (leaping fish), reverse (two arrows), draw (two cards and a plus),
    # wild (a compass star in four quarters)
    "cards.png": {
        "sheet": "07a-card-symbols.png",
        "cols": 2,
        "rows": 2,
        "cell": 160,      # shown at 30 to 70 CSS px
        "margin": 0.03,
    },
}
# One figure lifted out of a stamp cell that holds two: the ink joined to the
# cell's topmost point. The checkers emblem is a piece with a crown resting on
# it; the crown alone marks a king on the board.
PARTS = {
    "crown.png": {
        "sheet": "01-game-emblems.png",
        "cols": 3,
        "rows": 3,
        "index": 7,       # the cell, counted from 0 in reading order
        "cell": 64,       # shown at 14 to 36 CSS px
        "margin": 0.04,
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
# A card back fills its sheet. The page draws the card's own border and round
# corners, so the bake drops the painted border, cuts the field to the card's
# shape around its center and snaps it to the inks.
CARDS = {
    "cardback.png": {
        "sheet": "07b-card-back.png",
        "size": (200, 280),           # baked pixels, 5 : 7; shown 58 to 118 CSS px wide
        "border": (0xCF, 0xE9, 0xEC),  # the ink the painted border snaps to
    },
}
# A scene is one wide picture. Its night sky is the darkest ink; the bake
# makes the sky transparent so the page shows through and the picture has
# no top edge.
SCENES = {
    "home.png": {
        "sheet": "08-home-scene.png",
        "width": 720,                 # baked pixels; shown 290 to 620 CSS px wide
        "keep": (0.0, 0.05, 1.0, 1.0),  # share of the sheet kept: left, top, right, bottom
        # The nearest band of waves, a step lighter than slate, and the dim
        # teal of the page (--sonar-dim).
        "extra_inks": [(0x1C, 0x53, 0x6B), (0x1F, 0x8A, 0x78)],
        # The lighthouse beam came back in full sonar teal, louder than the
        # page's own buttons. Refill the flat region at this point (as a
        # share of the baked picture) with the dim teal.
        "refill": [((0.8, 0.3), (0x1F, 0x8A, 0x78))],
    },
}


def ink_mask(image):
    """Black ink on white paper -> L image, 255 where there is ink."""
    return image.convert("L").point(lambda p: 255 if p < 128 else 0)


def knockout_mask(image):
    """A white figure inside a black disc -> L image, 255 on the figure."""
    paper = image.convert("L").point(lambda p: 255 if p >= 128 else 0)
    # A white frame joins the paper outside the disc into one region; filling
    # it from a corner leaves only the white that the disc encloses.
    framed = Image.new("L", (paper.size[0] + 2, paper.size[1] + 2), 255)
    framed.paste(paper, (1, 1))
    ImageDraw.floodfill(framed, (0, 0), 0)
    return framed.crop((1, 1, paper.size[0] + 1, paper.size[1] + 1))


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
        ink = knockout_mask(piece) if spec.get("knockout") else ink_mask(piece)
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


def bake_part(spec):
    sheet = Image.open(os.path.join(SHEETS, spec["sheet"]))
    ink = ink_mask(list(cells(sheet, spec["cols"], spec["rows"]))[spec["index"]])
    bounds = ink.getbbox()
    if not bounds:
        raise SystemExit(f"{spec['sheet']}: cell {spec['index'] + 1} is empty")
    top = ink.crop((0, bounds[1], ink.size[0], bounds[1] + 1)).getbbox()
    ImageDraw.floodfill(ink, ((top[0] + top[2]) // 2, bounds[1]), 128)
    figure = ink.point(lambda p: 255 if p == 128 else 0)
    figure = figure.crop(figure.getbbox())
    cell = spec["cell"]
    scale = cell * (1 - 2 * spec["margin"]) / max(figure.size)
    size = (max(1, round(figure.size[0] * scale)), max(1, round(figure.size[1] * scale)))
    figure = figure.resize(size, Image.LANCZOS)
    out = Image.new("L", (cell, cell), 0)
    out.paste(figure, ((cell - size[0]) // 2, (cell - size[1]) // 2))
    bits = out.point(lambda p: 1 if p >= 128 else 0).convert("P")
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


def border_run(strip, ink):
    """Index just past the first run of `ink` in a 1-pixel strip of palette indexes."""
    values = list(strip.tobytes())
    start = values.index(ink)
    end = start
    while end < len(values) and values[end] == ink:
        end += 1
    return end


def bake_card(spec):
    sheet = Image.open(os.path.join(SHEETS, spec["sheet"])).convert("RGB")
    width, height = sheet.size
    snapped = sheet.quantize(palette=ink_palette(), dither=Image.NONE)
    ink = INKS.index(spec["border"])
    # Walk in from each edge a quarter of the way along it, clear of the
    # medallion, to find where the painted border ends.
    row = snapped.crop((0, height // 4, width, height // 4 + 1))
    column = snapped.crop((width // 4, 0, width // 4 + 1, height))
    left = border_run(row, ink)
    right = width - border_run(row.transpose(Image.FLIP_LEFT_RIGHT), ink)
    top = border_run(column, ink)
    bottom = height - border_run(column.transpose(Image.FLIP_TOP_BOTTOM), ink)
    pad = 4  # soft pixels where the border meets the field
    left, top, right, bottom = left + pad, top + pad, right - pad, bottom - pad
    out_w, out_h = spec["size"]
    keep_h = round((right - left) * out_h / out_w)
    if keep_h > bottom - top:
        raise SystemExit(f"{spec['sheet']}: field is too short for the card shape")
    middle = (top + bottom) // 2
    field = sheet.crop((left, middle - keep_h // 2, right, middle - keep_h // 2 + keep_h))
    small = field.resize((out_w, out_h), Image.LANCZOS)
    baked = small.quantize(palette=ink_palette(), dither=Image.NONE)
    # The palette is padded with black past the inks; fold any such pixel
    # back onto the darkest ink.
    baked = baked.point(lambda p: p if p < len(INKS) else 0)
    buffer = io.BytesIO()
    baked.save(buffer, "PNG", optimize=True, bits=4)
    return buffer.getvalue()


def bake_scene(spec):
    sheet = Image.open(os.path.join(SHEETS, spec["sheet"])).convert("RGB")
    width, height = sheet.size
    left, top, right, bottom = spec["keep"]
    sheet = sheet.crop((round(left * width), round(top * height), round(right * width), round(bottom * height)))
    out_w = spec["width"]
    out_h = round(sheet.size[1] * out_w / sheet.size[0])
    small = sheet.resize((out_w, out_h), Image.LANCZOS)
    inks = INKS + spec.get("extra_inks", [])
    clear = len(inks)
    flat = [channel for ink in inks for channel in ink]
    holder = Image.new("P", (1, 1))
    holder.putpalette(flat + flat[:3] * (256 - len(inks)))
    baked = small.quantize(palette=holder, dither=Image.NONE).point(lambda p: p if p < clear else 0)
    # The sky is the darkest ink where it is joined to the top edge. A row of
    # sky added above lets one fill reach it all, however the picture is cut.
    framed = Image.new("P", (out_w, out_h + 1), 0)
    framed.paste(baked, (0, 1))
    ImageDraw.floodfill(framed, (0, 0), clear)
    baked = framed.crop((0, 1, out_w, out_h + 1))
    for (x, y), ink in spec.get("refill", []):
        ImageDraw.floodfill(baked, (round(x * out_w), round(y * out_h)), inks.index(ink))
    baked.putpalette(flat + [0, 0, 0] * (256 - len(inks)))
    buffer = io.BytesIO()
    baked.save(buffer, "PNG", optimize=True, bits=4, transparency=clear)
    return buffer.getvalue()


def main():
    check = "--check" in sys.argv[1:]
    stale = []
    os.makedirs(OUT, exist_ok=True)
    jobs = [(name, bake_stamps, spec) for name, spec in STAMPS.items()]
    jobs += [(name, bake_part, spec) for name, spec in PARTS.items()]
    jobs += [(name, bake_fleet, spec) for name, spec in FLEET.items()]
    jobs += [(name, bake_pictures, spec) for name, spec in PICTURES.items()]
    jobs += [(name, bake_card, spec) for name, spec in CARDS.items()]
    jobs += [(name, bake_scene, spec) for name, spec in SCENES.items()]
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
