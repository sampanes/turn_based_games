# Art prompts

Prompts for image assets, written against what the client draws today (everything is
CSS; the app icon was the only image).

Done so far: sheet 1. Its raw sheet is `art/sheets/01-game-emblems.png`, baked to
`public/art/emblems.png` and shown on the home screen (game picker tiles, saved rows).
Cell 3 was redone as a single icon and pasted into the sheet; ask for a lone icon
whenever one cell of a sheet misses.

Sheet 2 is done too: `art/sheets/02-botty.png`, baked to `public/art/botty.png` (head
and neck only, six frames). Against the computer the face sits in the status banner:
calm on your turn, thinking on its turn, delighted when it wins, rattled when it loses.
The surprised and asleep frames are baked and not used yet. The generator returned a
real transparent background; previews that ignore transparency show a glow that is not
in the picture.

Sheet 3 is done: `art/sheets/03-fleet.png`, baked to `public/art/fleet.png`. Each ship
is scaled to its length in cells and then stretched across the beam into a common range,
which is how the tall carrier and the short destroyer fit their rows. The grids show a
ship one cell at a time; the fleet list shows it whole. Hit cells and the small fleet
tracker strips still use the old look.

Sheet 4 is done: `art/sheets/04-markers.png`, baked to `public/art/markers.png`. In use:
hit and miss on the Battleship grids, the bell, pennant and paper boat in the status
banner of a game with a friend (your turn, win, lose), the bell on a saved game that is
your turn, and the bottle on the invite and share screens. Baked and not used yet:
sunk, aim and draw.

Sheet 5 is done: `art/sheets/05-marks.png`, baked to `public/art/marks.png`. Ultimate
Tic-Tac-Toe cells take one of the three brushed marks by their place on the board, and a
won mini-board takes the heavy one.

Sheet 6 is done: `art/sheets/06-sigils.png`, baked to `public/art/sigils.png`. The
generator drew each sigil white inside a black disc, against the prompt; the bake keeps
the figure and drops the disc (`knockout` in the recipe), so no re-roll was needed. A
seat takes its sigil from the player's name. In use: claimed boxes and the name row in
Dots and Boxes, and the disc faces in Connect Four. Not yet: One Card seat chips, saved
rows.

Sheet 7a is done: `art/sheets/07a-card-symbols.png`, baked to `public/art/cards.png`.
Skip, reverse, draw and wild cards show their stamp in white; +2 and +4 keep the count
as text under it, and the corners keep the words. The tilted oval ring is gone from
every card; a plain round medallion sits behind the number or the stamp.

Sheet 7b is done: `art/sheets/07b-card-back.png` (kept at half size), baked to
`public/art/cardback.png`. The bake drops the painted border, cuts the field to 5 : 7
around the medallion and snaps it to the inks; the page draws the border and corners.
It is the draw pile and the back of a card in flight.

Sheet 8 is done, which is all eight: `art/sheets/08-home-scene.png` (kept at half size),
baked to `public/art/home.png` and shown at the foot of the home card. The bake cuts the
night sky out so the card shows through, adds one ink for the nearest waves, and refills
the lighthouse beam with the page's dim teal: in full sonar teal it was louder than the
buttons above it. Keep a picture sheet with an octree palette; a median-cut palette
dropped the amber and cream.

After the eight sheets, the frames that were baked but unused went to work, with no new
image files. Battleship: a hit leaves the ship drawn under its mark, a sunk ship is its own
outline in coral (`fleet.png` used as a mask), the fleet tracker shows ship pictures, and
the crosshair is the aim stamp. Botty looks surprised at a draw and falls asleep after 45
seconds of waiting; a draw with a friend shows the crossed flags. One Card chips carry the
player sigils. Still unused: the sunk stamp. Still not done: sigils on saved rows.

The three games added next reuse what was there. Reversi and Checkers take cells 7 and 8
of sheet 1 for their emblems, and their pieces are the Connect Four disc with the player
sigil pressed in. A Checkers king wears the crown from emblem 8, which the bake lifts out
on its own as `public/art/crown.png` (`PARTS` in the bake script). Pig is waiting on
sheet 9: until it is made, the page draws the dice and the Pig emblem itself.

## Where art pays, in order

| # | Sheet | Kind | Replaces / fills |
| --- | --- | --- | --- |
| 1 | Game emblems | stamp | The `<select>` game picker on the home screen, saved-game rows, a per-game notification badge (`sw.js` sets an icon but no badge) |
| 2 | Botty | picture | The computer opponent has a name and no face: opponent rail, saved rows ("vs Botty"), invite and waiting screens |
| 3 | Fleet | stamp | Battleship ships are labeled blue squares, and the fleet list is rows of pips |
| 4 | Markers | stamp | Hit, miss and sunk are a check mark, an x and a red square; win, lose and draw are a colored banner |
| 5 | X and O | stamp | Ultimate Tic-Tac-Toe marks are monospace letters |
| 6 | Player sigils | stamp | Dots and Boxes claimed boxes, Connect Four disc faces, One Card seat chips, saved rows |
| 7 | Card symbols and card back | stamp + picture | One Card faces are a gradient with a tilted oval ring and text; there is no card back art |
| 8 | Home scene | picture | The bottom half of the home screen is empty |
| 9 | Dice | stamp | Pig's dice and its home-screen emblem are drawn by the page |

Leave alone: the Mancala board and stones, the Connect Four board, and the app icon.
They already look good, and art there would add bytes for little gain.

## How these stay light

Two kinds of asset, and the prompt style differs for each.

- **Stamp**: one solid shape, black on white from the generator. Baked to a 1-bit PNG
  (or traced to SVG) and shown through CSS `mask-image` (with the `-webkit-` prefix
  for old Safari), so the color comes from the existing `--sonar` / `--amber` /
  `--fire` variables. One file serves both players, every size, and any future theme.
  A 96 px stamp is a few hundred bytes.
- **Picture**: flat fills in a fixed list of inks, no gradients. Baked to an indexed
  PNG with every pixel snapped to the nearest ink, so the file has 6 to 8 colors
  no matter what the generator did.

Rules for the bake step (`python scripts/bake-art.py`, `--check` to verify; needs
Pillow):

- Raw generator output is kept in `art/sheets/` and is never referenced by the page.
- Slice each sheet by its grid, trim, downscale to 2x the display size, then threshold
  (stamps) or snap to the ink list (pictures). Thresholding after the downscale is what
  removes the gray edge pixels that bloat a PNG.
- Pack each kind into one sprite sheet. Target for everything on this page: about
  50 KB total (an estimate, not measured), against 144 KB for `app.js` today.
- Generators miss exact proportions and exact hex colors. Both are fixed in the bake,
  so judge a sheet on shape and charm, not on color accuracy.

Inks (all already in the page CSS):

| Ink | Hex | Role |
| --- | --- | --- |
| Deep navy | `#06141b` | page background, eyes, darkest shapes |
| Hull | `#11313f` | far waves, quiet fills |
| Slate | `#1d4a5e` | near waves, secondary shapes |
| Sonar teal | `#34e7c4` | you, lights, highlights |
| Amber | `#ffb347` | them, Botty, warm light |
| Dark amber | `#96540f` | the shadow side of anything amber |
| Cream | `#cfe9ec` | stars, glass, paper |
| Coral | `#ff5b51` | tiny accents only |

## How to run them

- One conversation for all eight, so the style carries. Paste the matching style block
  first, then the sheet prompt under it.
- Make sheet 1 first and keep it as the anchor: attach it to later stamp prompts with
  "same style as this sheet".
- Make sheet 2 before sheet 8, and attach sheet 2 to sheet 8 so Botty matches.
- Ask for 1024 x 1024 unless the prompt gives another shape.
- Reject and re-roll on: gradients or gray shading, hairlines, items touching, any
  lettering, the wrong count ("redo with exactly nine icons, three rows of three").

## Style block: stamps

Paste above the prompt for sheets 1, 3, 4, 5, 6, 7a and 9.

```text
STYLE: a sheet of bold rubber-stamp icons. Solid pure black shapes on a pure white background. Two tones only, black and white. No gray, no gradients, no shading, no texture, no thin outline drawings, no text, no letters, no numbers. Chunky rounded shapes with a hand-cut feel, like linocut prints or paper cut-outs. Detail is made by leaving white gaps inside the black shape, never by thin lines. Every gap and every stroke is thick enough to survive shrinking the icon to 24 pixels. Friendly and a little playful, never aggressive. Each icon sits centered in its own invisible square cell with wide empty margins. Icons never touch or overlap. All icons have the same visual weight and fill the same share of their cell.
```

## Style block: pictures

Paste above the prompt for sheets 2, 7b and 8.

```text
STYLE: flat screen-print illustration, like a two-ink enamel pin or a vintage matchbox label. Completely flat fills with hard edges. No gradients, no soft shadows, no glow, no texture, no outlines thinner than a marker stroke, no text, no letters. Use ONLY these colors: deep navy #06141b, dark blue-green #11313f, slate blue #1d4a5e, sonar teal #34e7c4, warm amber #ffb347, dark amber #96540f, cream #cfe9ec, and coral #ff5b51 as a tiny accent. Chunky rounded shapes, simple enough to read at 64 pixels. Warm, cozy and a little funny: family game night in the sonar room of a small submarine.
```

## 1. Game emblems (stamp, 3 x 3)

Six for the games that exist, three for the next ones on the build list. Shown at about
48 px in a picker tile and 28 px in a saved-game row.

```text
A 3 by 3 grid of nine game emblems, one per cell, reading left to right, top to bottom:
1. Sea battle: a small toy warship seen from the side on two scalloped waves, with a round crosshair ring over its middle.
2. Four in a row: an upright rack with a grid of round holes, four of the holes filled solid in a diagonal line.
3. Dots and boxes: a 3 by 3 arrangement of fat round dots, with thick bars joining some of them so that exactly one square is fully closed and filled solid.
4. Mancala: a long rounded board seen from above with two rows of oval pits and a few round pebbles in the pits.
5. Nested tic-tac-toe: a bold tic-tac-toe grid of four thick bars, and inside its center cell a tiny second tic-tac-toe grid.
6. Card game: three playing cards fanned out like a hand, the front card showing one four-pointed star.
7. Reversi: two overlapping round discs, one solid black and one white with a thick black rim.
8. Checkers: one thick checker piece seen at a slight angle with a small crown resting on top.
9. Five in a row: a crossing of thick grid lines with five round stones sitting on the crossings in a straight line.
```

## 2. Botty (picture, 3 x 2)

The frames are swapped in place, so the body must not move between cells. The One Card
bots (Blue, Green, Gold) are made in the bake by swapping the two amber inks.

```text
A character sheet, 3 columns by 2 rows, showing six head-and-shoulders portraits of the same small robot, Botty. The robot is identical in size, position and angle in every cell so the frames can be swapped like animation frames. Only the face changes.

Botty is a round little sonar-buoy robot. A dome head shaped like a brass diving bell, amber, with one darker amber band around it and two round rivets at the sides. One big round porthole on the front holds a deep navy screen, and the face is drawn on that screen in sonar teal: two simple dot eyes and a small mouth. A short antenna on top ends in a round light. A short ringed neck sits on the top edge of a rounded body. A thin cream glint on the porthole glass, drawn as one flat hard-edged shape.

The six faces, left to right:
Top row: 1. calm and friendly, small smile. 2. thinking: eyes looking up and to one side, mouth a small flat line, antenna light lit teal. 3. delighted: eyes as happy upward arcs, wide open smile.
Bottom row: 4. oops: one eye bigger than the other, wavy mouth. 5. surprised: wide round eyes, small round mouth. 6. asleep: eyes as two flat lines, tiny mouth, antenna light dark.

Transparent background, nothing else in the image.
```

## 3. Fleet (stamp, five rows)

Drawn bow to the right, which is the default East heading; the page rotates them for
vertical placement. The bake stretches each ship to exactly 5, 4, 3, 3 and 2 cells, so
approximate lengths are fine.

```text
Five toy warships seen from directly above, bows pointing right, stacked one above the other in five rows, all left-aligned, with clear white space between rows. Every hull is the same width across the beam. Their lengths are in the proportion 5, 4, 3, 3, 2. Each hull is a rounded bath-toy shape with a pointed bow and a blunt stern.

Top to bottom:
1. Aircraft carrier, the longest: a flat deck with one long runway stripe and a small control tower set to one side.
2. Battleship: three round gun turrets in a line and a block bridge in the middle.
3. Cruiser: two round turrets and a central bridge.
4. Submarine, same length as the cruiser: a smooth cigar-shaped hull, a small oval conning tower, no turrets.
5. Destroyer, the shortest: one turret and one round funnel.

Deck details are white cut-outs inside the solid black hull.
```

## 4. Markers (stamp, 3 x 3)

Shot results sit inside a grid cell about 32 px wide; the result emblems sit beside the
status banner.

```text
A 3 by 3 grid of nine icons, one per cell, reading left to right, top to bottom:
1. Hit: a chunky starburst explosion with a small flame shape cut out of its center.
2. Miss: a water splash seen from the side, a short crown of three fat droplets rising from a ripple ring.
3. Sunk: the stern of a toy ship tipping down under two scalloped waves, with three round bubbles rising.
4. Aim: a thick crosshair ring with four short ticks and a small center dot.
5. Win: a pennant flag flying from a short pole, with a four-pointed star cut out of the flag.
6. Lose: a little folded paper boat sitting low between two waves.
7. Draw: two matching pennant flags on crossed poles.
8. Your turn: a ship's bell swinging to one side, with two short motion marks beside it.
9. Invite a friend: a corked bottle floating at a tilt with a rolled note inside it.
```

## 5. X and O (stamp, 4 x 2)

Three variants of each so nine cells in a row never look cloned, plus one heavy
version of each for a mini-board that has been won.

```text
A grid of 4 columns by 2 rows.

Top row: four letter-X marks. The first three are painted with a fat round brush in two quick confident strokes, each one slightly different in angle and in how the stroke ends taper. The fourth is a much heavier, bolder X with blunt rounded ends.

Bottom row: four ring marks, the letter O. The first three are painted with the same fat round brush in one quick loop, each closing a little differently, one with a small overlap where the stroke ends meet. The fourth is a much heavier, bolder ring.

Dry-brush nicks at the stroke ends are welcome, but only as hard-edged white gaps. These are hand-painted marks, not typed letters.
```

## 6. Player sigils (stamp, 3 x 3)

One per seat, so a glance says whose box, whose disc, whose turn. Each fits a circle so
it can sit on a Connect Four disc.

```text
A 3 by 3 grid of nine round badge emblems, one per cell. Each emblem is drawn to fit neatly inside a circle, with no ring or border around it. Reading left to right, top to bottom:
1. An anchor.
2. A four-pointed compass star.
3. A round smiling whale with a small spout.
4. A stubby lighthouse with two beams.
5. A friendly octopus with curled arms.
6. A small sailboat with one sail.
7. A scallop seashell.
8. A crab with raised claws.
9. A ship's steering wheel.
```

## 7a. Card symbols (stamp, 2 x 2)

Stamped in white on the card color; numbers and "+2" / "+4" stay as page text. These
replace the tilted oval ring, which is another game's look, with a mark of our own.

```text
A 2 by 2 grid of four playing-card action symbols, one per cell:
1. Skip: a fat little fish leaping in an arc over a single scalloped wave.
2. Reverse: two thick curved arrows chasing each other around a circle, like a whirlpool.
3. Draw: two blank playing cards, one overlapping the other, with a bold plus sign beside them.
4. Wild: a four-pointed compass star cut into four separate quarters with a clear gap between each quarter.
```

## 7b. Card back (picture, portrait)

```text
One playing-card back, portrait, 5 wide by 7 tall, filling the whole image edge to edge. A deep navy field covered by a neat repeating pattern of small fish-scale wave arcs in slate blue. In the center, a round amber medallion with a dark amber rim holds one cream four-pointed compass star. A bold cream border line runs just inside the card edge with rounded corners. The design is symmetric top to bottom, so the card looks the same upside down. Four colors only: deep navy, slate blue, amber with its dark amber rim, cream.
```

## 8. Home scene (picture, wide)

Sits at the bottom of the home screen. The top of the image is the page color, so it
has no visible edge. Attach sheet 2 so Botty matches.

```text
A wide illustration, twice as wide as it is tall. Night at sea. The whole top half is flat deep navy #06141b and completely empty.

Along the bottom, a calm sea made of three overlapping bands of scalloped waves: the farthest band dark blue-green #11313f, the nearer bands slate blue #1d4a5e.

On the left, a small stubby lighthouse on a rounded rock, with one amber window and one flat teal wedge of light sweeping to the right across the sky.

Right of center, Botty the robot from the attached sheet bobs in the water like a buoy, antenna light teal, with three thin-but-bold teal sonar rings spreading on the water around it.

On the far right, a tiny folded paper boat in cream.

A few small cream stars, drawn as simple four-pointed shapes. No moon, no clouds, no fading or soft edges anywhere.
```

## 9. Dice (stamp, 3 x 3)

For Pig. The one face is the pig, since rolling it loses the pot. Dice show at 68 to 104
px, the piggy bank and the pig's head beside the buttons and the last-roll line, and
cell 9 is the game's emblem (pasted into cell 9 of sheet 1, over the five-in-a-row
emblem nothing uses). Attach sheet 1 as the style reference. Check the pip counts before
accepting the sheet; a wrong face can be rebuilt in the bake from the pips of a good one.

```text
A 3 by 3 grid of nine icons, one per cell, reading left to right, top to bottom. Cells 1 to 6 are the six faces of one chunky toy die, each seen flat from the front: a solid black square with generously rounded corners, the same size in every cell. The marks on each face are white cut-outs.
1. The one face, which in this game is a pig: instead of a pip, one big white oval pig snout in the middle of the face, with two solid black nostrils inside the oval.
2. Exactly two round white pips, on one diagonal.
3. Exactly three round white pips, in a diagonal line.
4. Exactly four round white pips, one near each corner.
5. Exactly five round white pips, one near each corner and one in the center.
6. Exactly six round white pips, in two columns of three.
7. A round piggy bank seen from the side, with a coin dropping into the slot on its back.
8. A cheeky pig's head seen from the front: round, floppy ears, a big snout, and its tongue sticking out.
9. Two chunky dice tumbling, one tilted and overlapping the other, showing three pips and five pips.
```
