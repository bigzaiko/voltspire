"""Shared parts of the factory buildings (see models_factory.py): palette, the hex plinth every building
stands on, and the conventions the game relies on.

Conventions (src/game/facview.ts reads these):
  - One building per hex tile. The tile is 2.0 across the flats; keep everything within 0.92 of the axis
    (the plinth is 1.76 across the flats), so neighbours never touch. Model units = game units (no scaling).
  - Blender +Z is up. The building's FRONT / OUTPUT side faces Blender -Y (three.js +Z after export): the
    game draws the output arrow and turns the whole model to the output direction the player chooses.
  - Materials: 'hull' (dark gunmetal), 'trim' (worn steel), 'paint' (the building's accent, kept dark and
    desaturated: the game tunes it further), 'glow_main' (accent light strips, always lit), 'glow_work'
    (lights that show the building is working: the game dims them while it idles), 'glow_lamp' (only on the
    status lamp, recoloured green / amber / red by the game).
  - Named nodes: 'lamp' = the status lamp (a small sphere, radius ~0.08, on top or on a mast where it reads
    from above); 'spin' = a part the game turns about its own Z axis while the building works (drill head,
    gear, turbine fan); 'arm' = a part the game rocks about its own X axis (the pumpjack beam); 'work' = an
    optional part the game bobs up and down a little while it works. Node origins are the pivots.
  - Tri budget about 3500 per building (poles 1200). No textures: geometry, bevels and materials only.
"""
from vs_lib import *

HULL = ('#27221e', 0.6, 0.45)
TRIM = ('#8c8378', 0.65, 0.42)
DARK = ('#1c1916', 0.5, 0.6)
HEX = dict(segs=6, phase=30, sharp=30)     # pointy-top hex like the deck tiles


def fac_model(name, accent, work='#ffd27a'):
    return Model('fac_' + name, {'hull': HULL, 'paint': (industrial(accent), 0.3, 0.55), 'trim': TRIM, 'dark': DARK,
                                 'glow_main': accent, 'glow_work': work, 'glow_lamp': '#8fe07a'})


def fac_base(m, h=0.16):
    """Hex plinth 1.76 across the flats, top at z=h, with a trim edge, a lit seam and corner feet.
    Returns the 'base' node; build the rest of the building on top of z=h."""
    b = m.node('base')
    r = 0.88 / 0.8660254   # circumradius for 0.88 to the flats
    b.lathe([(r, 0.0), (r + 0.01, 0.02), (r + 0.01, h - 0.05), (r - 0.04, h), (0.0, h)], 'hull', **HEX)
    b.ring(r - 0.06, 0.03, 0.02, 'trim', segs=6, phase=30, at=(0, 0, h - 0.005))
    with b.frames(radial(6)):
        b.box((0.02, 0.62, 0.025), 'glow_main', bevel=0, at=(0.885, 0, h * 0.45))
    with b.frames(radial(6, start=30)):
        b.box((0.12, 0.14, h + 0.02), 'trim', bevel=0.015, at=(r - 0.07, 0, (h + 0.02) / 2))
    return b


def status_lamp(m, at, parent=None):
    """The status lamp the game recolours: a small glowing sphere on a short stem."""
    n = m.node('lamp', at=at, parent=parent)
    n.sphere(0.08, 'glow_lamp', segs=10, rings=6)
    n.ring(0.085, 0.02, 0.04, 'trim', segs=10, at=(0, 0, -0.06))
    return n
