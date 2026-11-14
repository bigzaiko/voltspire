"""VOLTSPIRE towers: shared hexagonal armoured base, eleven designs, power nodes and upgrade add-ons.

Every tower has 'base' and 'turret' (the spire's turret is a small relay scanner), a 'node' (the power
node the player shoots, centre on the axis at H + 0.48) and 'lvl2' / 'lvl3' (add-on parts the game shows
from that level on; each is one object parented to the part it rides on)."""
import math
from vs_lib import *

HULL = ('#27221e', 0.6, 0.45)      # warm charcoal
TRIM = ('#8c8378', 0.65, 0.42)     # worn warm steel
NODE = '#f0c878'

# accent = TOWERS[type].color in src/game/data.ts
ACCENT = {'pulse': '#e3dc92', 'cryo': '#bfe3ea', 'arc': '#b48cff', 'mortar': '#f68b56', 'rail': '#ff5a3c',
          'beacon': '#9ccf6a', 'flame': '#ffb02e', 'lance': '#ff8fa8', 'missile': '#d9a05b', 'gravity': '#7a8cff',
          'spire': '#6fe0c8'}
# model height before the game's x1.15 (spire: height of the platform floor)
H = {'pulse': 2.40, 'cryo': 2.42, 'arc': 3.22, 'mortar': 2.09, 'rail': 2.81, 'beacon': 3.41, 'flame': 2.26,
     'lance': 3.13, 'missile': 2.61, 'gravity': 2.87, 'spire': 6.50}
HEX = dict(segs=6, phase=30, sharp=30)     # pointy-top: corners to the front and back, flats left and right


def tower_model(key):
    acc = ACCENT[key]
    # 'paint' is a dark, desaturated industrial coat of the accent hue; only the glow strips are bright
    return Model('tower_' + key, {'hull': HULL, 'paint': (industrial(acc), 0.25, 0.6), 'trim': TRIM,
                                  'glow_main': acc, 'glow_node': NODE})


def tower_base(m):
    """Hexagonal armoured plinth, 1.6 across the flats (1.64 with plates and buttresses), deck at z=0.56,
    turret ring top at z=0.62."""
    b = m.node('base')
    b.lathe([(0.90, 0.0), (0.924, 0.03), (0.924, 0.15), (0.83, 0.25), (0.83, 0.34), (0.69, 0.44),
             (0.69, 0.52), (0.65, 0.56)], **HEX)
    # the six faces: armour plate, lit strip, sloped vent panel
    with b.frames(radial(6)):
        b.box((0.03, 0.56, 0.075), 'paint', bevel=0.01, at=(0.803, 0, 0.095))
        b.box((0.02, 0.84, 0.03), 'trim', bevel=0, at=(0.802, 0, 0.018))
        b.box((0.012, 0.30, 0.02), 'glow_main', bevel=0, at=(0.722, 0, 0.295))
        b.box((0.025, 0.42, 0.12), 'paint', bevel=0.01, at=(0.664, 0, 0.394), rot=(0, -50.4, 0))
        for y in (-0.11, 0, 0.11):
            b.box((0.032, 0.055, 0.08), 'hull', bevel=0, at=(0.668, y, 0.397), rot=(0, -50.4, 0))
    # corner buttresses
    with b.frames(radial(6, start=30)):
        b.prism([(0.62, 0.0), (0.90, 0.0), (0.90, 0.10), (0.845, 0.19), (0.62, 0.33)], 0.16, 'hull',
                bevel=0.02, plane='xz')
        b.prism([(0.70, 0.305), (0.84, 0.215), (0.885, 0.14), (0.892, 0.17), (0.85, 0.235), (0.71, 0.335)], 0.10,
                'paint', plane='xz')
        b.box((0.04, 0.17, 0.03), 'trim', bevel=0, at=(0.89, 0, 0.014))
        b.cyl(0.03, 0.03, 'trim', segs=5, at=(0.60, 0, 0.555))
    b.cyl(0.50, 0.06, 'trim', segs=16, bevel=0.015, at=(0, 0, 0.56))
    return b


def power_node(m, key):
    """The power node: a faceted capacitor crystal, 0.42 x 0.5, centre on the axis at H + 0.48.
    Always a child of the root so it never leaves the axis. Returns the centre height."""
    z = H[key] + 0.48
    n = m.node('node', at=(0, 0, z))
    n.lathe([(0.0, -0.25), (0.14, -0.17), (0.21, -0.06), (0.21, 0.06), (0.14, 0.17), (0.0, 0.25)], 'glow_node',
            segs=6, phase=30, sharp=30)
    return z


def cup(p, zc):
    """Three-prong cradle under a node centred at zc (in the space of p, on its axis)."""
    p.cyl(0.085, 0.05, 'trim', segs=8, bevel=0.012, at=(0, 0, zc - 0.31))
    with p.frames(radial(3, start=90)):
        p.prism([(0.05, -0.29), (0.12, -0.29), (0.275, -0.13), (0.275, 0.0), (0.24, 0.0), (0.24, -0.10),
                 (0.10, -0.24), (0.05, -0.24)], 0.04, 'trim', bevel=0.006, plane='xz', at=(0, 0, zc))


def mount(p, z0, zc, r=0.035):
    """Stalk on the axis from z0 up to a cup under the node centre zc."""
    p.cyl(r * 1.9, 0.05, 'trim', segs=8, bevel=0.01, at=(0, 0, z0 - 0.01))
    p.cyl(r, zc - 0.30 - z0, 'hull', segs=8, r2=r * 0.8, at=(0, 0, z0))
    cup(p, zc)


# ------------------------------------------------------------------ 1. pulse
def tower_pulse():
    m = tower_model('pulse')
    b = tower_base(m)
    b.lathe([(0.40, 0.62), (0.40, 0.70), (0.27, 0.82), (0.24, 1.08), (0.34, 1.17), (0.34, 1.24)], segs=12)
    b.ring(0.26, 0.05, 0.07, 'paint', segs=12, bevel=0.012, at=(0, 0, 0.93))
    b.ring(0.255, 0.02, 0.02, 'glow_main', segs=12, at=(0, 0, 1.03))
    with b.sym():
        b.tube([(0.44, 0.2, 0.60), (0.40, 0.24, 0.80), (0.27, 0.22, 0.95), (0.25, 0.2, 1.17)], 0.025, 'trim')
        b.box((0.10, 0.16, 0.14), 'hull', bevel=0.02, at=(0.42, -0.1, 0.68))

    t = m.node('turret', at=(0, 0, 1.24))
    t.cyl(0.40, 0.08, 'trim', segs=16, bevel=0.02)
    body = [(-0.36, 0.14), (-0.42, 0.30), (-0.32, 0.54), (0.22, 0.64), (0.52, 0.52), (0.56, 0.22), (0.38, 0.08),
            (-0.24, 0.08)]
    t.prism(body, 0.46, 'hull', bevel=0.035, plane='yz')
    with t.sym():
        t.prism([(-0.30, 0.20), (-0.33, 0.30), (-0.26, 0.47), (0.18, 0.56), (0.42, 0.46), (0.45, 0.25), (0.34, 0.16)],
                0.06, 'paint', bevel=0.015, plane='yz', at=(0.245, 0, 0))
        t.cyl(0.13, 0.05, 'trim', segs=12, bevel=0.012, rot=RIGHT, at=(0.27, 0.05, 0.34))
        t.cyl(0.06, 0.02, 'glow_main', segs=10, rot=RIGHT, at=(0.32, 0.05, 0.34))
        t.box((0.02, 0.30, 0.03), 'glow_main', bevel=0, at=(0.278, 0.24, 0.47), rot=(-18, 0, 0))
        t.cyl(0.07, 0.20, 'hull', segs=8, rot=FWD, at=(0.125, -0.20, 0.32))      # recoil sleeve
    # twin barrels (own nodes: they recoil alternately)
    for i, x in enumerate((0.125, -0.125)):
        g = m.node(f'barrel_{i + 1}', at=(x, -0.33, 0.32), parent=t)
        with g.frames(T(rot=FWD)):
            g.cyl(0.095, 0.28, 'hull', segs=10, bevel=0.02)
            for z in (0.07, 0.14, 0.21):
                g.cyl(0.108, 0.03, 'trim', segs=10, bevel=0.008, at=(0, 0, z))
            g.cyl(0.055, 0.50, 'trim', segs=10)
            g.cyl(0.078, 0.09, 'hull', segs=10, bevel=0.015, at=(0, 0, 0.42))
            g.cyl(0.05, 0.02, 'glow_main', segs=10, at=(0, 0, 0.497))
            g.ring(0.082, 0.02, 0.02, 'glow_main', segs=10, at=(0, 0, 0.37))
    t.prism([(-0.21, 0.19), (-0.24, 0.32), (-0.20, 0.47), (0.20, 0.47), (0.24, 0.32), (0.21, 0.19)], 0.04, 'paint',
            bevel=0.012, plane='xz', at=(0, -0.385, 0))
    for i in range(3):
        t.box((0.24, 0.035, 0.03), 'hull', bevel=0.008, at=(0, 0.30 + i * 0.06, 0.625 - i * 0.022), rot=(-22, 0, 0))
    # barrel bridge + top sensor + antenna
    t.box((0.34, 0.07, 0.08), 'hull', bevel=0.015, at=(0, -0.52, 0.32))
    t.box((0.20, 0.36, 0.07), 'paint', bevel=0.02, at=(0, -0.12, 0.60), rot=(-10, 0, 0))
    t.box((0.15, 0.22, 0.11), 'hull', bevel=0.025, at=(0.10, 0.18, 0.68))
    t.cyl(0.04, 0.03, 'glow_main', segs=10, rot=FWD, at=(0.10, 0.07, 0.69))
    t.rod((-0.14, 0.34, 0.58), (-0.14, 0.42, 1.12), 0.014, 'trim', segs=6, r2=0.007)
    t.sphere(0.028, 'glow_main', segs=8, rings=5, at=(-0.14, 0.42, 1.135))
    # ammo drum + feed
    t.cyl(0.19, 0.50, 'paint', segs=14, bevel=0.03, o='c', rot=RIGHT, at=(0, 0.50, 0.30))
    t.cyl(0.205, 0.08, 'hull', segs=14, bevel=0.015, o='c', rot=RIGHT, at=(0, 0.50, 0.30))
    with t.sym():
        t.cyl(0.10, 0.03, 'trim', segs=10, bevel=0.01, o='c', rot=RIGHT, at=(0.26, 0.50, 0.30))
        t.tube([(0.14, 0.52, 0.48), (0.14, 0.40, 0.62), (0.14, 0.20, 0.64)], 0.03, 'trim')
    mount(t, 0.62, power_node(m, 'pulse') - 1.24)
    # level 2: outboard gun pods
    u = m.node('lvl2', parent=t)
    with u.sym():
        u.box((0.13, 0.34, 0.17), 'hull', bevel=0.025, at=(0.385, -0.16, 0.30))
        u.box((0.03, 0.30, 0.20), 'paint', bevel=0.01, at=(0.455, -0.16, 0.31))
        u.box((0.15, 0.20, 0.03), 'paint', bevel=0.01, at=(0.385, -0.14, 0.395))
        u.cyl(0.05, 0.50, 'trim', segs=8, rot=FWD, at=(0.385, -0.30, 0.30))
        u.cyl(0.07, 0.10, 'hull', segs=8, bevel=0.015, rot=FWD, at=(0.385, -0.70, 0.30))
        u.cyl(0.04, 0.02, 'glow_main', segs=8, rot=FWD, at=(0.385, -0.787, 0.30))
    # level 3: heavy cannon over the twin guns, armoured drum, second antenna
    u = m.node('lvl3', parent=t)
    u.box((0.22, 0.34, 0.15), 'hull', bevel=0.03, at=(0, -0.30, 0.715))
    u.box((0.16, 0.26, 0.03), 'paint', bevel=0.01, at=(0, -0.30, 0.80))
    u.cyl(0.07, 0.56, 'trim', segs=10, rot=FWD, at=(0, -0.44, 0.715))
    for y in (-0.56, -0.66, -0.76):
        u.cyl(0.085, 0.035, 'hull', segs=10, bevel=0.008, rot=FWD, at=(0, y, 0.715))
    u.cyl(0.10, 0.12, 'hull', segs=10, bevel=0.02, rot=FWD, at=(0, -0.94, 0.715))
    u.ring(0.103, 0.02, 0.02, 'glow_main', segs=10, rot=FWD, at=(0, -1.0, 0.715))
    u.box((0.60, 0.05, 0.34), 'paint', bevel=0.015, at=(0, 0.715, 0.30))
    with u.sym():
        u.box((0.05, 0.30, 0.40), 'hull', bevel=0.015, at=(0.295, 0.56, 0.30))
    u.rod((0.14, 0.34, 0.58), (0.14, 0.40, 0.98), 0.014, 'trim', segs=6, r2=0.007)
    u.sphere(0.026, 'glow_main', segs=8, rings=5, at=(0.14, 0.40, 0.99))
    return m


# ------------------------------------------------------------------ 2. cryo
def tower_cryo():
    m = tower_model('cryo')
    b = tower_base(m)
    b.lathe([(0.42, 0.62), (0.42, 0.70), (0.30, 0.80), (0.28, 0.94), (0.36, 1.0), (0.36, 1.05)], segs=12)
    for z in (0.82, 0.88):
        b.torus(0.31, 0.03, 'trim', segs=14, rsegs=6, at=(0, 0, z))
    with b.frames(radial(3, start=90)):
        b.box((0.12, 0.2, 0.2), 'hull', bevel=0.025, at=(0.42, 0, 0.70))
        b.box((0.02, 0.12, 0.05), 'glow_main', bevel=0, at=(0.485, 0, 0.72))

    t = m.node('turret', at=(0, 0, 1.05))
    t.cyl(0.42, 0.08, 'trim', segs=16, bevel=0.02)
    t.lathe([(0.30, 0.08), (0.37, 0.16), (0.37, 0.50), (0.30, 0.60), (0.20, 0.64)], segs=12)
    t.ring(0.375, 0.02, 0.04, 'glow_main', segs=12, at=(0, 0, 0.33))
    # coolant tanks (back and sides)
    tank = [(0.0, 0.0), (0.10, 0.015), (0.155, 0.08), (0.155, 0.68), (0.10, 0.745), (0.0, 0.76)]
    for ang, hs, rad in ((90, 1.25, 0.36), (15, 1.0, 0.44), (165, 1.0, 0.44)):
        with t.frames(rotz(ang) @ T(at=(rad, 0, 0.10), scale=(1, 1, hs))):
            t.lathe(tank, 'paint', segs=10)
            for z in (0.16, 0.60):
                t.cyl(0.168, 0.045, 'hull', segs=10, at=(0, 0, z))
            t.ring(0.16, 0.02, 0.03, 'glow_main', segs=10, at=(0, 0, 0.38))
            t.cyl(0.05, 0.06, 'trim', segs=8, bevel=0.01, at=(0, 0, 0.75))
            t.cyl(0.075, 0.025, 'trim', segs=8, bevel=0.008, at=(0, 0, 0.80))
    # vent stack on the centre tank -> total height 2.4
    t.rod((0, 0.36, 1.12), (0, 0.36, 1.33), 0.022, 'trim', segs=6, r2=0.012)
    t.sphere(0.03, 'glow_main', segs=8, rings=5, at=(0, 0.36, 1.33))
    # frost nozzle
    with t.frames(T(at=(0, -0.26, 0.40), rot=(84, 0, 0))):
        t.cyl(0.15, 0.20, 'hull', segs=12, bevel=0.02, at=(0, 0, -0.04))
        for z in (0.03, 0.09):
            t.cyl(0.17, 0.03, 'trim', segs=12, bevel=0.008, at=(0, 0, z))
    d = m.node('dish', at=(0, -0.26, 0.40), parent=t)        # pulses and recoils on every burst
    with d.frames(T(rot=(84, 0, 0))):
        d.lathe([(0.14, 0.14), (0.22, 0.22), (0.40, 0.42), (0.44, 0.43), (0.44, 0.49), (0.40, 0.50),
                 (0.21, 0.31), (0.0, 0.29)], 'paint', segs=16)
        d.ring(0.44, 0.03, 0.05, 'hull', segs=16, bevel=0.008, at=(0, 0, 0.455))
        d.torus(0.385, 0.018, 'glow_main', segs=16, rsegs=6, at=(0, 0, 0.495))
        d.lathe([(0.0, 0.28), (0.15, 0.30), (0.15, 0.325), (0.06, 0.36), (0.035, 0.50), (0.0, 0.53)], 'glow_main', segs=10)
        with d.frames(radial(6)):
            d.box((0.16, 0.02, 0.14), 'trim', bevel=0.005, at=(0.235, 0, 0.21), rot=(0, -42, 0))
    with t.sym():
        t.tube([(0.44, 0.10, 0.92), (0.50, -0.02, 0.98), (0.44, -0.22, 0.78), (0.24, -0.34, 0.52), (0.12, -0.36, 0.45)],
               0.035, 'trim', segs=7)
        t.box((0.10, 0.24, 0.20), 'hull', bevel=0.025, at=(0.33, -0.16, 0.30))
        t.box((0.02, 0.14, 0.04), 'glow_main', bevel=0, at=(0.385, -0.16, 0.32))
    t.tube([(0, 0.36, 1.04), (0, 0.16, 1.02), (0, -0.02, 0.80), (0, -0.14, 0.62)], 0.04, 'trim', segs=7)
    zn = power_node(m, 'cryo') - 1.05
    mount(t, 0.62, zn)
    t.rod((0, 0.36, 1.10), (0, 0.02, 1.34), 0.02, 'trim', segs=6)
    # level 2: two more coolant tanks
    u = m.node('lvl2', parent=t)
    for ang in (50, 130):
        with u.frames(rotz(ang) @ T(at=(0.56, 0, 0.10), scale=(0.9, 0.9, 0.86))):
            u.lathe(tank, 'paint', segs=10)
            for z in (0.16, 0.60):
                u.cyl(0.168, 0.045, 'hull', segs=10, at=(0, 0, z))
            u.ring(0.16, 0.02, 0.03, 'glow_main', segs=10, at=(0, 0, 0.38))
            u.cyl(0.06, 0.07, 'trim', segs=8, bevel=0.01, at=(0, 0, 0.75))
    with u.sym():
        u.tube([(0.36, 0.44, 0.80), (0.26, 0.30, 0.92), (0.10, 0.22, 0.84)], 0.03, 'trim', segs=6)
    # level 3: wide emitter collar with frost prongs round the dish
    u = m.node('lvl3', parent=d)
    with u.frames(T(rot=(84, 0, 0))):
        u.ring(0.52, 0.09, 0.06, 'paint', segs=16, at=(0, 0, 0.44))
        u.ring(0.575, 0.03, 0.09, 'hull', segs=16, at=(0, 0, 0.45))
        with u.frames(radial(6, start=30)):
            u.prism([(0.50, 0.42), (0.60, 0.42), (0.62, 0.62), (0.57, 0.74), (0.53, 0.58)], 0.07, 'hull',
                    bevel=0.01, plane='xz')
            u.box((0.03, 0.03, 0.07), 'glow_main', bevel=0, at=(0.572, 0, 0.71))
    return m


# ------------------------------------------------------------------ 3. arc
def tower_arc():
    m = tower_model('arc')
    b = tower_base(m)
    b.lathe([(0.40, 0.62), (0.40, 0.70), (0.25, 0.84), (0.15, 2.12), (0.24, 2.20), (0.24, 2.25)], segs=12)
    n = 9
    for i in range(n):
        f = i / (n - 1)
        b.torus(0.30 - 0.10 * f, 0.042, 'trim', segs=12, rsegs=5, at=(0, 0, 0.94 + 1.10 * f))
    for z, r in ((0.88, 0.40), (1.50, 0.33), (2.10, 0.28)):
        b.lathe([(r - 0.10, -0.035), (r, -0.01), (r, 0.01), (r - 0.10, 0.035)], 'paint', segs=16, at=(0, 0, z))
    with b.frames(radial(3, start=30)):
        b.rod((0.50, 0, 0.60), (0.36, 0, 2.08), 0.035, 'hull', segs=6, r2=0.025)
        b.rod((0.455, 0, 0.90), (0.395, 0, 1.75), 0.016, 'glow_main', segs=5)
        b.box((0.16, 0.14, 0.16), 'hull', bevel=0.03, at=(0.50, 0, 0.68))
        b.box((0.10, 0.10, 0.08), 'paint', bevel=0.02, at=(0.37, 0, 2.08))

    t = m.node('turret', at=(0, 0, 2.25))
    t.cyl(0.27, 0.08, 'trim', segs=16, bevel=0.02)
    t.lathe([(0.20, 0.08), (0.14, 0.16), (0.08, 0.22), (0.0, 0.24)], 'hull', segs=12)
    claw = [(0.16, 0.02), (0.30, 0.06), (0.47, 0.38), (0.44, 0.70), (0.25, 0.95), (0.20, 0.92), (0.33, 0.68),
            (0.36, 0.42), (0.25, 0.16), (0.16, 0.14)]
    with t.frames(radial(3, start=90)):
        t.prism(claw, 0.08, 'hull', bevel=0.012, plane='xz')
        t.prism([(0.37, 0.14), (0.50, 0.38), (0.47, 0.70), (0.34, 0.87), (0.42, 0.68), (0.44, 0.40)], 0.11, 'paint',
                bevel=0.01, plane='xz')
        t.sphere(0.035, 'glow_main', segs=8, rings=5, at=(0.215, 0, 0.925))
    o = m.node('orb', at=(0, 0, 0.52), parent=t)             # swells on every discharge
    o.sphere(0.22, 'glow_main', segs=16, rings=10)
    o.torus(0.34, 0.022, 'glow_main', segs=16, rsegs=5, at=(0, 0, -0.10))
    o.torus(0.31, 0.022, 'glow_main', segs=16, rsegs=5, at=(0, 0, 0.14))
    t.torus(0.335, 0.03, 'trim', segs=20, rsegs=6, at=(0, 0, 0.30))
    zn = power_node(m, 'arc') - 2.25
    with t.frames(radial(3, start=90)):
        t.rod((0.215, 0, 0.94), (0.06, 0, 1.15), 0.016, 'trim', segs=5)
    cup(t, zn)
    # level 2: discharge spikes round the coil and capacitor cans on the plinth
    u = m.node('lvl2')
    u.ring(0.36, 0.06, 0.05, 'hull', segs=12, at=(0, 0, 1.50))
    with u.frames(radial(6)):
        u.prism([(0.32, 1.46), (0.66, 1.51), (0.32, 1.56)], 0.05, 'trim', bevel=0.006, plane='xz')
        u.sphere(0.028, 'glow_main', segs=6, rings=4, at=(0.665, 0, 1.51))
    with u.frames(radial(3, start=90)):
        u.cyl(0.085, 0.42, 'paint', segs=8, bevel=0.02, at=(0.50, 0, 0.60))
        u.cyl(0.095, 0.05, 'hull', segs=8, at=(0.50, 0, 0.78))
        u.cyl(0.04, 0.04, 'trim', segs=6, bevel=0.008, at=(0.50, 0, 1.02))
        u.rod((0.50, 0, 1.05), (0.27, 0, 1.22), 0.014, 'trim', segs=5)
    # level 3: a second, wider set of claws and a halo
    u = m.node('lvl3', parent=t)
    with u.frames(radial(3, start=30)):
        u.prism([(0.18, 0.03), (0.42, 0.08), (0.66, 0.38), (0.64, 0.66), (0.50, 0.86), (0.455, 0.82), (0.56, 0.63),
                 (0.57, 0.41), (0.38, 0.19), (0.18, 0.13)], 0.07, 'hull', bevel=0.012, plane='xz')
        u.prism([(0.50, 0.17), (0.69, 0.38), (0.67, 0.67), (0.575, 0.80), (0.63, 0.64), (0.64, 0.41)], 0.10, 'paint',
                bevel=0.01, plane='xz')
        u.sphere(0.035, 'glow_main', segs=8, rings=5, at=(0.47, 0, 0.855))
    u.torus(0.60, 0.022, 'trim', segs=18, rsegs=4, at=(0, 0, 0.52))
    with u.frames(radial(6)):
        u.box((0.05, 0.07, 0.05), 'glow_main', bevel=0, at=(0.60, 0, 0.52))
    return m


# ------------------------------------------------------------------ 4. mortar
def tower_mortar():
    m = tower_model('mortar')
    b = tower_base(m)
    b.lathe([(0.56, 0.62), (0.60, 0.66), (0.60, 0.74), (0.54, 0.80)], segs=16)
    b.ring(0.605, 0.02, 0.03, 'glow_main', segs=16, at=(0, 0, 0.70))

    t = m.node('turret', at=(0, 0, 0.80))
    t.cyl(0.56, 0.10, 'hull', segs=16, bevel=0.025)
    t.cyl(0.46, 0.04, 'trim', segs=16, bevel=0.01, at=(0, 0, 0.10))
    cheek = [(-0.36, 0.10), (-0.40, 0.42), (-0.14, 0.76), (0.16, 0.76), (0.44, 0.46), (0.46, 0.10)]
    with t.sym():
        t.prism(cheek, 0.13, 'hull', bevel=0.03, plane='yz', at=(0.39, 0, 0))
        t.prism([(-0.28, 0.16), (-0.31, 0.40), (-0.11, 0.67), (0.13, 0.67), (0.35, 0.43), (0.37, 0.16)], 0.05, 'paint',
                bevel=0.012, plane='yz', at=(0.465, 0, 0))
        t.cyl(0.14, 0.05, 'trim', segs=12, bevel=0.012, rot=RIGHT, at=(0.47, 0.02, 0.50))
        t.cyl(0.06, 0.02, 'glow_main', segs=8, rot=RIGHT, at=(0.52, 0.02, 0.50))
        t.box((0.02, 0.34, 0.03), 'glow_main', bevel=0, at=(0.492, 0.02, 0.22))
        # recoil piston
        t.rod((0.27, -0.36, 0.16), (0.27, -0.44, 0.78), 0.04, 'trim', segs=8)
        t.rod((0.27, -0.36, 0.14), (0.27, -0.40, 0.48), 0.055, 'hull', segs=8, bevel=0.01)
    # barrel: elevation 58 deg
    cr = m.node('cradle', at=(0, 0.04, 0.50), parent=t)       # pitches at the trunnion
    cr.cyl(0.10, 0.74, 'trim', segs=10, bevel=0.015, o='c', rot=RIGHT)
    g = m.node('barrel', rot=(32, 0, 0), parent=cr)          # slides along its bore (local +Z)
    if True:
        g.lathe([(0.0, -0.36), (0.20, -0.34), (0.31, -0.24), (0.31, 0.02), (0.27, 0.06)], 'hull', segs=16)
        g.cyl(0.27, 0.66, 'hull', segs=16, r2=0.25, at=(0, 0, 0.02))
        g.lathe([(0.26, 0.56), (0.32, 0.60), (0.32, 0.72), (0.28, 0.74), (0.21, 0.74), (0.21, 0.66), (0.0, 0.66)],
                'trim', segs=16)
        g.cyl(0.21, 0.02, 'glow_main', segs=16, at=(0, 0, 0.665))
        for z in (0.14, 0.30, 0.46):
            g.ring(0.275 - z * 0.03, 0.035, 0.022, 'glow_main', segs=16, at=(0, 0, z))
            g.ring(0.285 - z * 0.03, 0.03, 0.022, 'hull', segs=16, at=(0, 0, z + 0.022))
            g.ring(0.285 - z * 0.03, 0.03, 0.022, 'hull', segs=16, at=(0, 0, z - 0.022))
        g.box((0.30, 0.10, 0.44), 'paint', bevel=0.03, at=(0, -0.27, 0.30))
        g.box((0.16, 0.14, 0.2), 'hull', bevel=0.03, at=(0, 0.30, -0.08))
        with g.frames(radial(6, start=30)):
            g.cyl(0.03, 0.03, 'hull', segs=6, at=(0.24, 0, -0.30), rot=(0, 40, 0))
    # shell rack at the rear
    for x in (-0.17, 0, 0.17):
        t.lathe([(0.0, 0.0), (0.075, 0.01), (0.075, 0.20), (0.05, 0.27)], 'paint', segs=10, at=(x, 0.44, 0.14))
        t.lathe([(0.05, 0.27), (0.03, 0.32), (0.0, 0.34)], 'glow_main', segs=10, at=(x, 0.44, 0.14))
    t.box((0.56, 0.20, 0.10), 'hull', bevel=0.025, at=(0, 0.44, 0.18))
    # ranging antenna
    t.rod((-0.42, 0.30, 0.10), (-0.42, 0.34, 0.92), 0.016, 'trim', segs=6, r2=0.008)
    t.sphere(0.03, 'glow_main', segs=8, rings=5, at=(-0.42, 0.34, 0.93))
    # node yoke from the cheeks, clear of the barrel at any elevation
    zn = power_node(m, 'mortar') - 0.80
    with t.sym():
        t.tube([(0.44, 0.10, 0.70), (0.44, 0.12, 1.25), (0.30, 0.07, 1.37), (0.07, 0.0, 1.47)], 0.03, 'hull', segs=6)
        t.cyl(0.05, 0.06, 'trim', segs=8, bevel=0.01, at=(0.44, 0.11, 0.74))
    cup(t, zn)
    # level 2: ammunition racks outboard of the cheeks and a splinter shield
    u = m.node('lvl2', parent=t)
    with u.sym():
        u.box((0.22, 0.52, 0.12), 'hull', bevel=0.025, at=(0.62, 0.08, 0.16))
        u.box((0.03, 0.48, 0.24), 'paint', bevel=0.01, at=(0.735, 0.08, 0.24))
        for y in (-0.08, 0.08, 0.24):
            u.lathe([(0.0, 0.0), (0.07, 0.01), (0.07, 0.20), (0.05, 0.27)], 'paint', segs=8, at=(0.62, y, 0.20))
            u.lathe([(0.05, 0.27), (0.03, 0.32), (0.0, 0.34)], 'glow_main', segs=8, at=(0.62, y, 0.20))
        u.box((0.30, 0.04, 0.34), 'paint', bevel=0.012, at=(0.44, -0.47, 0.30), rot=(-20, 0, -24))
        u.box((0.26, 0.05, 0.03), 'trim', bevel=0.008, at=(0.44, -0.415, 0.46), rot=(-20, 0, -24))
    # level 3: reinforced barrel, sighting spine, muzzle crown
    u = m.node('lvl3', parent=g)
    for z in (0.22, 0.38):
        u.ring(0.283 - z * 0.03, 0.05, 0.075, 'paint', segs=16, bevel=0.012, at=(0, 0, z))
    u.box((0.11, 0.07, 0.56), 'hull', bevel=0.02, at=(0, 0.29, 0.32))
    u.box((0.03, 0.02, 0.40), 'glow_main', bevel=0, at=(0, 0.33, 0.32))
    u.box((0.16, 0.10, 0.12), 'trim', bevel=0.02, at=(0, 0.31, 0.64))
    with u.frames(radial(8)):
        u.prism([(0.25, 0.72), (0.325, 0.72), (0.325, 0.80), (0.29, 0.84), (0.25, 0.78)], 0.09, 'trim',
                bevel=0.008, plane='xz')
    u.box((0.36, 0.20, 0.22), 'hull', bevel=0.04, at=(0, 0.30, -0.14))
    return m


# ------------------------------------------------------------------ 5. rail
def tower_rail():
    m = tower_model('rail')
    b = tower_base(m)
    b.lathe([(0.38, 0.62), (0.38, 0.70), (0.22, 0.84), (0.17, 1.22), (0.28, 1.32), (0.28, 1.38)], segs=12)
    b.ring(0.21, 0.04, 0.06, 'paint', segs=12, bevel=0.01, at=(0, 0, 1.0))
    with b.frames(radial(4, start=45)):
        b.prism([(0.20, 0.62), (0.52, 0.62), (0.52, 0.70), (0.26, 1.14), (0.18, 1.14)], 0.07, 'hull', bevel=0.012,
                plane='xz')
        b.rod((0.44, 0, 0.74), (0.265, 0, 1.06), 0.014, 'glow_main', segs=5)

    t = m.node('turret', at=(0, 0, 1.38))
    t.cyl(0.33, 0.07, 'trim', segs=16, bevel=0.018)
    t.stack.append([T(scale=(1.3, 1.0, 1.14))])
    with t.sym():
        t.prism([(-0.16, 0.06), (-0.12, 0.34), (0.12, 0.34), (0.20, 0.06)], 0.07, 'hull', bevel=0.015, plane='yz',
                at=(0.19, 0, 0))
        t.cyl(0.085, 0.03, 'trim', segs=10, bevel=0.008, rot=RIGHT, at=(0.225, 0, 0.28))
    Z = 0.30   # gun axis height above swivel
    body = [(-0.52, Z - 0.12), (-0.62, Z - 0.03), (-0.62, Z + 0.05), (-0.50, Z + 0.15), (0.34, Z + 0.19),
            (0.66, Z + 0.10), (0.72, Z - 0.08), (0.52, Z - 0.20), (-0.30, Z - 0.20)]
    t.prism(body, 0.26, 'hull', bevel=0.03, plane='yz')
    t.prism([(-0.48, Z + 0.15), (0.30, Z + 0.19), (0.52, Z + 0.13), (0.30, Z + 0.225), (-0.44, Z + 0.185)], 0.14,
            'paint', bevel=0.01, plane='yz')
    # rails + emitter: one sliding assembly
    g = m.node('barrel', parent=t)
    g.stack.append([T(scale=(1.3, 1.0, 1.14))])
    with g.frames([Matrix.Identity(4), T(at=(0, 0, 2 * Z)) @ Matrix.Diagonal((1, 1, -1, 1))]):
        g.prism([(-0.50, Z + 0.035), (-1.50, Z + 0.035), (-1.58, Z + 0.06), (-1.52, Z + 0.10), (-0.95, Z + 0.13),
                 (-0.50, Z + 0.17)], 0.085, 'trim', bevel=0.012, plane='yz')
        g.prism([(-0.60, Z + 0.14), (-0.95, Z + 0.115), (-1.40, Z + 0.09), (-1.40, Z + 0.115), (-0.95, Z + 0.15),
                 (-0.60, Z + 0.19)], 0.05, 'paint', bevel=0.006, plane='yz')
    g.box((0.03, 1.02, 0.03), 'glow_main', bevel=0, at=(0, -1.03, Z))
    for y in (-0.72, -1.00, -1.28):
        with g.sym():
            g.box((0.022, 0.07, 0.30 - (-y - 0.72) * 0.12), 'hull', bevel=0.006, at=(0.052, y, Z))
        g.box((0.05, 0.03, 0.05), 'glow_main', bevel=0.008, at=(0, y, Z))
    g.lathe([(0.0, 0.0), (0.04, 0.02), (0.02, 0.10), (0.0, 0.12)], 'glow_main', segs=8, rot=FWD, at=(0, -1.46, Z))
    # capacitor fins + cells
    with t.sym():
        for i in range(6):
            t.box((0.13, 0.03, 0.26 - 0.012 * i), 'paint', bevel=0.008, at=(0.185, -0.36 + i * 0.085, Z - 0.01))
        t.box((0.02, 0.50, 0.03), 'glow_main', bevel=0, at=(0.136, -0.15, Z - 0.01))
        t.cyl(0.07, 0.44, 'trim', segs=10, bevel=0.015, rot=FWD, at=(0.19, 0.60, Z - 0.09))
        t.cyl(0.045, 0.02, 'glow_main', segs=10, rot=BACK, at=(0.19, 0.60, Z - 0.09))
        t.cyl(0.078, 0.05, 'hull', segs=10, bevel=0.01, rot=FWD, at=(0.19, 0.42, Z - 0.09))
    # scope
    t.cyl(0.05, 0.36, 'hull', segs=10, bevel=0.012, rot=FWD, at=(0, 0.10, Z + 0.29))
    t.cyl(0.062, 0.07, 'hull', segs=10, bevel=0.012, rot=FWD, at=(0, -0.22, Z + 0.29))
    t.cyl(0.045, 0.012, 'glow_main', segs=10, rot=FWD, at=(0, -0.288, Z + 0.29))
    for y in (-0.10, 0.04):
        t.box((0.04, 0.05, 0.08), 'hull', bevel=0.008, at=(0, y, Z + 0.22))
    # tail: power pack, fin, antenna (total height 2.8)
    t.box((0.22, 0.20, 0.26), 'hull', bevel=0.035, at=(0, 0.70, Z))
    t.prism([(0.40, Z + 0.16), (0.70, Z + 0.08), (0.86, Z + 0.62), (0.76, Z + 0.66), (0.60, Z + 0.30)], 0.035, 'paint',
            bevel=0.01, plane='yz')
    t.rod((0, 0.74, Z + 0.50), (0, 0.80, Z + 0.93), 0.012, 'trim', segs=6, r2=0.006)
    t.sphere(0.025, 'glow_main', segs=8, rings=5, at=(0, 0.80, Z + 0.93))
    t.tube([(0.08, 0.66, Z - 0.13), (0.10, 0.50, Z - 0.26), (0.06, 0.20, Z - 0.24), (0.05, 0.1, Z - 0.2)], 0.022,
           'trim')
    t.stack.pop()
    g.stack.pop()
    # node yoke straddling the scope
    zn = power_node(m, 'rail') - 1.38
    with t.sym():
        t.tube([(0.155, 0.06, 0.50), (0.155, 0.05, 0.86), (0.0, 0.0, 1.06)], 0.028, 'hull', segs=6)
    mount(t, 1.04, zn)
    ZA = Z * 1.14      # gun axis in turret space
    # level 2: a second pair of rails left and right of the bore
    u = m.node('lvl2', parent=g)
    with u.sym():
        u.prism([(0.075, -0.52), (0.075, -1.46), (0.10, -1.54), (0.135, -1.48), (0.16, -0.95), (0.21, -0.52)], 0.09,
                'trim', bevel=0.012, at=(0, 0, ZA))
        u.prism([(0.175, -0.62), (0.15, -0.95), (0.125, -1.36), (0.15, -1.36), (0.185, -0.95), (0.22, -0.62)], 0.05,
                'paint', bevel=0.006, at=(0, 0, ZA))
        u.box((0.02, 0.80, 0.02), 'glow_main', bevel=0, at=(0.068, -0.98, ZA))
    # level 3: capacitor banks and a taller cooling fin
    u = m.node('lvl3', parent=t)
    with u.sym():
        u.cyl(0.115, 0.66, 'paint', segs=12, bevel=0.025, rot=FWD, at=(0.43, 0.66, ZA - 0.02))
        for y in (0.56, 0.34, 0.12):
            u.cyl(0.128, 0.05, 'hull', segs=12, bevel=0.01, rot=FWD, at=(0.43, y, ZA - 0.02))
        u.cyl(0.07, 0.02, 'glow_main', segs=10, rot=FWD, at=(0.43, 0.0, ZA - 0.02))
        u.box((0.16, 0.10, 0.08), 'hull', bevel=0.02, at=(0.32, 0.30, ZA - 0.02))
        u.tube([(0.43, 0.60, ZA + 0.09), (0.36, 0.66, ZA + 0.20), (0.12, 0.72, ZA + 0.12)], 0.025, 'trim', segs=6)
    with u.sym():
        u.prism([(0.16, ZA + 0.20), (0.52, ZA + 0.14), (0.64, ZA + 0.50), (0.52, ZA + 0.54), (0.30, ZA + 0.36)], 0.035,
                'paint', bevel=0.01, plane='yz', at=(0.11, 0, 0), rot=(0, 14, 0))
    return m


# ------------------------------------------------------------------ 6. beacon
def tower_beacon():
    m = tower_model('beacon')
    b = tower_base(m)
    b.lathe([(0.34, 0.62), (0.34, 0.70), (0.17, 0.88), (0.11, 2.06), (0.16, 2.12), (0.16, 2.16)], segs=12)
    with b.frames(radial(3, start=90)):
        b.prism([(0.14, 0.62), (0.50, 0.62), (0.50, 0.70), (0.19, 1.50), (0.12, 1.50)], 0.06, 'paint', bevel=0.012,
                plane='xz')
        b.prism([(0.32, 0.70), (0.44, 0.70), (0.21, 1.30), (0.17, 1.30)], 0.075, 'hull', bevel=0.008, plane='xz')
    for z, r in ((1.12, 0.36), (1.50, 0.30), (1.86, 0.25)):
        b.torus(r, 0.022, 'glow_main', segs=20, rsegs=6, at=(0, 0, z))
        b.cyl(0.02 + (2.2 - z) * 0.085 + 0.06, 0.05, 'trim', segs=12, bevel=0.012, at=(0, 0, z - 0.025))
        with b.frames(radial(3, start=30)):
            b.rod((0.10, 0, z), (r, 0, z), 0.012, 'trim', segs=5)

    t = m.node('turret', at=(0, 0, 2.16))
    t.lathe([(0.13, 0.0), (0.22, 0.06), (0.22, 0.20), (0.15, 0.27), (0.10, 0.31)], segs=12)
    t.ring(0.222, 0.02, 0.05, 'paint', segs=12, at=(0, 0, 0.13))
    with t.frames(radial(4, start=-90)):
        t.cyl(0.045, 0.03, 'trim', segs=8, bevel=0.008, rot=RIGHT, at=(0.21, 0, 0.13))
        t.cyl(0.03, 0.012, 'glow_main', segs=8, rot=RIGHT, at=(0.24, 0, 0.13))
    with t.sym():
        t.rod((0.20, 0.06, 0.20), (0.36, 0.10, 0.62), 0.01, 'trim', segs=5, r2=0.005)
        t.sphere(0.02, 'glow_main', segs=6, rings=4, at=(0.36, 0.10, 0.63))

    s = m.node('spin_1', at=(0, 0, 2.48))
    s.cyl(0.085, 0.10, 'trim', segs=12, bevel=0.015)
    s.cyl(0.05, 0.30, 'hull', segs=10, at=(0, 0, 0.08))
    s.lathe([(0.05, 0.36), (0.09, 0.40), (0.09, 0.46), (0.03, 0.52)], 'paint', segs=10)
    s.rod((0, 0, 0.50), (0, 0, 1.11), 0.016, 'trim', segs=6, r2=0.012)
    s.cyl(0.03, 0.04, 'hull', segs=8, bevel=0.008, at=(0, 0, 0.89))
    cup(s, power_node(m, 'beacon') - 2.48)
    # holo ring with spokes
    s.torus(0.50, 0.02, 'glow_main', segs=24, rsegs=6, at=(0, 0, 0.14))
    with s.frames(radial(3, start=60)):
        s.rod((0.06, 0, 0.14), (0.50, 0, 0.14), 0.014, 'trim', segs=5)
        s.box((0.07, 0.10, 0.06), 'hull', bevel=0.012, at=(0.50, 0, 0.14))
    # radar dish
    with s.frames(T(at=(0.10, 0, 0.30), rot=(0, 62, 0))):
        s.lathe([(0.0, 0.10), (0.10, 0.105), (0.24, 0.15), (0.36, 0.24), (0.375, 0.27), (0.24, 0.185), (0.10, 0.14),
                 (0.0, 0.135)], 'paint', segs=16)
        s.torus(0.37, 0.016, 'hull', segs=16, rsegs=5, at=(0, 0, 0.26))
        s.cyl(0.05, 0.12, 'hull', segs=8, bevel=0.01)
        s.rod((0, 0, 0.13), (0, 0, 0.36), 0.012, 'trim', segs=5)
        s.sphere(0.035, 'glow_main', segs=8, rings=5, at=(0, 0, 0.37))
        with s.frames(radial(3)):
            s.rod((0.30, 0, 0.21), (0.02, 0, 0.35), 0.007, 'trim', segs=4)
    # counterweight emitter opposite the dish
    s.box((0.20, 0.12, 0.10), 'hull', bevel=0.02, at=(-0.20, 0, 0.30))
    s.box((0.03, 0.14, 0.12), 'paint', bevel=0.01, at=(-0.31, 0, 0.30))
    s.box((0.015, 0.09, 0.05), 'glow_main', bevel=0, at=(-0.33, 0, 0.30))
    # level 2: second dish and an outer relay ring
    u = m.node('lvl2', parent=s)
    with u.frames(T(at=(-0.12, 0, 0.56), rot=(0, -58, 0), scale=0.85)):
        u.lathe([(0.0, 0.10), (0.10, 0.105), (0.24, 0.15), (0.36, 0.24), (0.375, 0.27), (0.24, 0.185), (0.10, 0.14),
                 (0.0, 0.135)], 'paint', segs=16)
        u.torus(0.37, 0.016, 'hull', segs=16, rsegs=5, at=(0, 0, 0.26))
        u.cyl(0.05, 0.12, 'hull', segs=8, bevel=0.01)
        u.rod((0, 0, 0.13), (0, 0, 0.36), 0.012, 'trim', segs=5)
        u.sphere(0.035, 'glow_main', segs=8, rings=5, at=(0, 0, 0.37))
    u.torus(0.68, 0.016, 'trim', segs=28, rsegs=5, at=(0, 0, 0.14))
    with u.frames(radial(3, start=60)):
        u.rod((0.50, 0, 0.14), (0.68, 0, 0.14), 0.012, 'trim', segs=5)
    with u.frames(radial(6, start=30)):
        u.box((0.06, 0.09, 0.05), 'hull', bevel=0.012, at=(0.68, 0, 0.14))
        u.box((0.02, 0.05, 0.02), 'glow_main', bevel=0, at=(0.715, 0, 0.14))
    # level 3: three outrigger emitters on the mast
    u = m.node('lvl3')
    u.cyl(0.19, 0.07, 'trim', segs=12, bevel=0.015, at=(0, 0, 1.64))
    with u.frames(radial(3, start=30)):
        u.prism([(0.12, 1.62), (0.60, 1.70), (0.66, 1.70), (0.66, 1.78), (0.12, 1.72)], 0.05, 'hull', bevel=0.01,
                plane='xz')
        u.cyl(0.035, 0.62, 'paint', segs=8, bevel=0.01, at=(0.64, 0, 1.48))
        u.cyl(0.05, 0.05, 'hull', segs=8, bevel=0.01, at=(0.64, 0, 1.72))
        u.rod((0.64, 0, 2.10), (0.64, 0, 2.34), 0.012, 'trim', segs=5, r2=0.006)
        u.sphere(0.035, 'glow_main', segs=8, rings=5, at=(0.64, 0, 2.36))
        u.box((0.02, 0.05, 0.22), 'glow_main', bevel=0, at=(0.678, 0, 1.92))
    return m


# ------------------------------------------------------------------ 7. flame
def tower_flame():
    """Flame Projector: squat, a pressure tank on the axis, two feed tanks, a wide flared nozzle."""
    m = tower_model('flame')
    b = tower_base(m)
    b.lathe([(0.50, 0.62), (0.55, 0.66), (0.55, 0.76), (0.47, 0.84)], segs=12)
    b.ring(0.555, 0.02, 0.025, 'glow_main', segs=12, at=(0, 0, 0.71))

    t = m.node('turret', at=(0, 0, 0.84))
    t.cyl(0.50, 0.09, 'trim', segs=16, bevel=0.02)
    t.prism([(-0.42, 0.09), (-0.48, 0.30), (-0.32, 0.52), (0.32, 0.56), (0.50, 0.40), (0.52, 0.09)], 0.56, 'hull',
            bevel=0.04, plane='yz')
    with t.sym():
        t.prism([(-0.34, 0.14), (-0.39, 0.30), (-0.27, 0.45), (0.28, 0.48), (0.42, 0.36), (0.44, 0.14)], 0.05, 'paint',
                bevel=0.012, plane='yz', at=(0.285, 0, 0))
        # feed tanks at the rear corners
        with t.frames(T(at=(0.34, 0.30, 0.42))):
            t.lathe([(0.0, 0.0), (0.12, 0.015), (0.17, 0.07), (0.17, 0.50), (0.12, 0.57), (0.0, 0.59)], 'paint', segs=12)
            for z in (0.13, 0.44):
                t.cyl(0.182, 0.04, 'hull', segs=12, bevel=0.01, at=(0, 0, z))
            t.cyl(0.05, 0.06, 'trim', segs=8, bevel=0.01, at=(0, 0, 0.58))
        t.tube([(0.34, 0.30, 1.04), (0.30, 0.22, 1.14), (0.20, 0.10, 1.10)], 0.028, 'trim', segs=6)
        t.tube([(0.16, -0.20, 1.00), (0.20, -0.40, 0.92), (0.17, -0.50, 0.62), (0.10, -0.46, 0.42)], 0.03, 'trim',
               segs=6)
        t.box((0.02, 0.22, 0.03), 'glow_main', bevel=0, at=(0.312, -0.06, 0.40))
    # pressure tank on the axis
    t.lathe([(0.0, 0.50), (0.27, 0.52), (0.29, 0.60), (0.29, 1.12), (0.23, 1.24), (0.10, 1.31), (0.0, 1.32)], 'paint',
            segs=14)
    for z in (0.66, 1.04):
        t.cyl(0.305, 0.05, 'hull', segs=14, bevel=0.012, at=(0, 0, z))
    t.box((0.10, 0.03, 0.16), 'hull', bevel=0.01, at=(0, -0.295, 0.86))
    t.box((0.06, 0.012, 0.03), 'glow_main', bevel=0, at=(0, -0.313, 0.89))
    t.cyl(0.07, 0.08, 'trim', segs=8, bevel=0.012, at=(0, 0, 1.30))
    t.torus(0.11, 0.016, 'trim', segs=12, rsegs=5, at=(0, 0, 1.40))
    with t.frames(radial(3)):
        t.rod((0, 0, 1.40), (0.11, 0, 1.40), 0.01, 'trim', segs=4)
    # pump and exhaust at the rear
    t.box((0.40, 0.18, 0.30), 'hull', bevel=0.04, at=(0, 0.50, 0.30))
    with t.sym():
        t.cyl(0.04, 0.34, 'trim', segs=7, bevel=0.008, at=(0.12, 0.54, 0.40))
    zn = power_node(m, 'flame') - 0.84
    mount(t, 1.38, zn)

    g = m.node('barrel', at=(0, -0.40, 0.34), parent=t)
    g.cyl(0.13, 0.20, 'hull', segs=12, bevel=0.02, rot=FWD, at=(0, 0.06, 0))
    g.cyl(0.15, 0.04, 'trim', segs=12, bevel=0.01, rot=FWD, at=(0, -0.08, 0))
    with g.frames(T(rot=FWD, scale=(1.3, 0.75, 1.0))):
        g.lathe([(0.11, 0.10), (0.15, 0.22), (0.30, 0.52), (0.33, 0.54), (0.33, 0.58), (0.29, 0.58), (0.13, 0.26),
                 (0.0, 0.24)], 'hull', segs=14)
        g.ring(0.335, 0.03, 0.03, 'trim', segs=14, at=(0, 0, 0.56))
        with g.frames(radial(5, start=54, sweep=90)):
            g.box((0.012, 0.035, 0.20), 'trim', bevel=0, at=(0.262, 0, 0.40), rot=(0, 26.5, 0))
    # pilot light under the mouth
    g.rod((0, -0.02, -0.14), (0, -0.60, -0.30), 0.018, 'trim', segs=6)
    g.cyl(0.03, 0.05, 'hull', segs=6, bevel=0.008, rot=FWD, at=(0, -0.58, -0.30))
    g.sphere(0.03, 'glow_main', segs=8, rings=5, at=(0, -0.645, -0.30))
    # level 2: side jets and a heat shield over the nozzle
    u = m.node('lvl2', parent=g)
    for sgn in (1, -1):
        with u.frames(T(at=(0.19 * sgn, 0.02, 0.02), rot=(90, 0, 24 * sgn))):
            u.cyl(0.06, 0.26, 'hull', segs=8, bevel=0.012)
            u.lathe([(0.055, 0.22), (0.075, 0.30), (0.15, 0.48), (0.165, 0.50), (0.165, 0.53), (0.14, 0.53),
                     (0.06, 0.32), (0.0, 0.31)], 'hull', segs=10, scale=(1.0, 0.8, 1.0))
            u.ring(0.168, 0.02, 0.025, 'trim', segs=10, at=(0, 0, 0.515), scale=(1.0, 0.8, 1.0))
    with u.frames(T(rot=FWD, scale=(1.3, 0.75, 1.0))):
        u.add(revolve([(0.175, 0.16), (0.365, 0.54), (0.39, 0.54), (0.20, 0.16)], segs=8, phase=30, arc=120), 'paint')
        u.add(revolve([(0.37, 0.50), (0.41, 0.50), (0.41, 0.56), (0.37, 0.56)], segs=8, phase=26, arc=128), 'trim')
    # level 3: two more tanks in armoured guards, taller stacks
    u = m.node('lvl3', parent=t)
    with u.sym():
        with u.frames(T(at=(0.60, -0.04, 0.22))):
            u.lathe([(0.0, 0.0), (0.11, 0.015), (0.15, 0.07), (0.15, 0.62), (0.11, 0.69), (0.0, 0.71)], 'paint', segs=12)
            for z in (0.16, 0.54):
                u.cyl(0.162, 0.04, 'hull', segs=12, bevel=0.01, at=(0, 0, z))
            u.cyl(0.05, 0.05, 'trim', segs=8, bevel=0.01, at=(0, 0, 0.70))
            u.ring(0.152, 0.02, 0.025, 'glow_main', segs=12, at=(0, 0, 0.35))
        u.box((0.03, 0.40, 0.46), 'hull', bevel=0.012, at=(0.775, -0.04, 0.42))
        u.box((0.22, 0.30, 0.10), 'hull', bevel=0.02, at=(0.52, -0.04, 0.20))
        u.tube([(0.60, -0.04, 0.95), (0.52, 0.0, 1.06), (0.26, 0.0, 0.98)], 0.026, 'trim', segs=6)
        u.cyl(0.05, 0.36, 'hull', segs=7, bevel=0.008, at=(0.12, 0.54, 0.72))
        u.cyl(0.035, 0.02, 'glow_main', segs=7, at=(0.12, 0.54, 1.07))
    return m


# ------------------------------------------------------------------ 8. lance
def tower_lance():
    """Lance Emitter: a tall backbone that hooks over a stack of focusing lenses."""
    m = tower_model('lance')
    b = tower_base(m)
    b.lathe([(0.42, 0.62), (0.42, 0.70), (0.26, 0.86), (0.20, 1.20), (0.30, 1.30), (0.30, 1.36)], segs=12)
    b.ring(0.235, 0.04, 0.06, 'paint', segs=12, bevel=0.01, at=(0, 0, 1.02))
    with b.frames(radial(3, start=90)):
        b.prism([(0.20, 0.62), (0.54, 0.62), (0.54, 0.70), (0.28, 1.16), (0.20, 1.16)], 0.07, 'hull', bevel=0.012,
                plane='xz')
        b.rod((0.46, 0, 0.74), (0.285, 0, 1.08), 0.014, 'glow_main', segs=5)

    t = m.node('turret', at=(0, 0, 1.36))
    t.cyl(0.32, 0.07, 'trim', segs=16, bevel=0.018)
    t.prism([(-0.30, 0.07), (-0.34, 0.30), (-0.20, 0.46), (0.30, 0.46), (0.42, 0.30), (0.38, 0.07)], 0.40, 'hull',
            bevel=0.035, plane='yz')
    with t.sym():
        t.prism([(-0.24, 0.12), (-0.27, 0.29), (-0.17, 0.40), (0.27, 0.40), (0.35, 0.28), (0.32, 0.12)], 0.05, 'paint',
                bevel=0.012, plane='yz', at=(0.205, 0, 0))
        t.cyl(0.08, 0.03, 'trim', segs=10, bevel=0.008, rot=RIGHT, at=(0.225, 0.02, 0.26))
    # backbone: rises at the rear and hooks forward over the axis
    spine = [(0.14, 0.40), (0.42, 0.40), (0.47, 0.90), (0.39, 1.38), (0.14, 1.70), (-0.08, 1.77), (-0.08, 1.64),
             (0.07, 1.60), (0.24, 1.36), (0.31, 0.90), (0.24, 0.62)]
    t.prism(spine, 0.15, 'hull', bevel=0.02, plane='yz')
    t.prism(slab([(0.44, 0.46), (0.495, 0.90), (0.41, 1.39), (0.16, 1.72)], 0.03), 0.10, 'paint', bevel=0.008,
            plane='yz')
    t.box((0.03, 0.012, 0.55), 'glow_main', bevel=0, at=(0, 0.262, 1.02), rot=(-7, 0, 0))
    for z in (0.66, 0.90, 1.14):
        t.box((0.20, 0.08, 0.05), 'trim', bevel=0.012, at=(0, 0.36, z))
    # two prongs reaching forward over the lens stack
    with t.sym():
        t.prism([(-0.06, 1.68), (-0.48, 1.34), (-0.56, 1.10), (-0.50, 1.12), (-0.42, 1.28), (-0.06, 1.56)], 0.04,
                'paint', bevel=0.01, plane='yz', at=(0.10, 0, 0))
        t.sphere(0.028, 'glow_main', segs=6, rings=4, at=(0.10, -0.545, 1.09))
    t.cyl(0.10, 0.08, 'trim', segs=10, bevel=0.015, at=(0, 0, 1.69))
    zn = power_node(m, 'lance') - 1.36
    mount(t, 1.76, zn)

    g = m.node('barrel', at=(0, 0.12, 0.80), parent=t)
    with g.frames(T(rot=FWD)):
        g.cyl(0.16, 0.30, 'hull', segs=12, bevel=0.025, at=(0, 0, -0.06))
        g.cyl(0.18, 0.05, 'trim', segs=12, bevel=0.012, at=(0, 0, 0.16))
        g.cyl(0.04, 1.02, 'trim', segs=8)
        for z, R in ((0.34, 0.27), (0.60, 0.21), (0.84, 0.15)):
            g.ring(R, 0.05, 0.045, 'trim', segs=16, bevel=0.01, at=(0, 0, z))
            g.ring(R - 0.045, 0.04, 0.02, 'paint', segs=16, at=(0, 0, z))
            with g.frames(radial(3, start=30)):
                g.rod((0.04, 0, z), (R - 0.02, 0, z), 0.009, 'hull', segs=4)
        with g.frames(radial(3, start=90)):
            g.rod((0.16, 0, 0.18), (0.27, 0, 0.34), 0.012, 'hull', segs=5)
            g.rod((0.27, 0, 0.34), (0.15, 0, 0.84), 0.012, 'hull', segs=5)
        g.ring(0.15, 0.015, 0.02, 'glow_main', segs=16, at=(0, 0, 0.872))
        g.lathe([(0.04, 1.0), (0.065, 1.04), (0.04, 1.16), (0.0, 1.22)], 'glow_main', segs=8)
    # level 2: a wide collecting lens at the back and focusing prongs at the tip
    u = m.node('lvl2', parent=g)
    with u.frames(T(rot=FWD)):
        u.ring(0.36, 0.06, 0.05, 'trim', segs=18, bevel=0.012, at=(0, 0, 0.20))
        u.ring(0.31, 0.05, 0.02, 'paint', segs=18, at=(0, 0, 0.20))
        u.ring(0.385, 0.012, 0.02, 'glow_main', segs=18, at=(0, 0, 0.226))
        with u.frames(radial(3, start=30)):
            u.rod((0.17, 0, 0.14), (0.34, 0, 0.20), 0.012, 'hull', segs=5)
            u.prism([(0.13, 0.80), (0.19, 0.82), (0.13, 1.10), (0.07, 1.20), (0.085, 1.06)], 0.035, 'hull',
                    bevel=0.008, plane='xz')
            u.sphere(0.024, 'glow_main', segs=6, rings=4, at=(0.07, 0, 1.20))
    # level 3: radiator vanes on the backbone and a second emitter under the main one
    u = m.node('lvl3', parent=t)
    with u.sym():
        for i in range(4):
            u.box((0.36, 0.022, 0.15), 'paint', bevel=0.008, at=(0.24, 0.41 - i * 0.012, 0.66 + i * 0.22),
                  rot=(0, -20, 14))
        u.box((0.06, 0.07, 0.86), 'hull', bevel=0.012, at=(0.085, 0.42, 0.98), rot=(-6, 0, 0))
        u.cyl(0.05, 0.40, 'hull', segs=8, bevel=0.01, rot=FWD, at=(0.27, -0.10, 0.30))
        u.lathe([(0.03, 0.0), (0.045, 0.03), (0.03, 0.10), (0.0, 0.14)], 'glow_main', segs=6, rot=FWD,
                at=(0.27, -0.50, 0.30))
        u.box((0.10, 0.22, 0.12), 'paint', bevel=0.02, at=(0.27, 0.0, 0.30))
    return m


# ------------------------------------------------------------------ 9. missile
def _launcher(n, rows, tips=True):
    """Box launcher centred on the origin of the current frame, tubes to the front (-Y). rows = tube rows."""
    hz = 0.11 * rows
    n.box((0.44, 0.92, hz * 2 + 0.02), 'hull', bevel=0.03)
    n.box((0.36, 0.66, 0.03), 'paint', bevel=0.01, at=(0, 0.02, hz + 0.01))
    n.box((0.46, 0.06, hz * 2 + 0.04), 'trim', bevel=0.012, at=(0, -0.435, 0))
    for i in range(rows):
        z = (i - (rows - 1) / 2) * 0.20
        for x in (-0.105, 0.105):
            n.cyl(0.086, 0.03, 'hull', segs=10, rot=FWD, at=(x, -0.455, z))
            if tips:
                n.lathe([(0.066, 0.0), (0.066, 0.03), (0.035, 0.09), (0.0, 0.115)], 'paint', segs=8, rot=FWD,
                        at=(x, -0.46, z))
                n.sphere(0.016, 'glow_main', segs=6, rings=4, at=(x, -0.578, z))
    with n.sym():
        n.box((0.02, 0.50, 0.03), 'trim', bevel=0.006, at=(0.225, 0.0, 0.0))
    n.box((0.34, 0.03, hz * 2 - 0.12), 'trim', bevel=0.008, at=(0, 0.465, 0))


def tower_missile():
    """Missile Battery: two box launchers on an elevating cradle, search radar on the axis."""
    m = tower_model('missile')
    b = tower_base(m)
    b.lathe([(0.44, 0.62), (0.47, 0.66), (0.47, 0.80), (0.35, 0.90), (0.35, 1.0)], segs=12)
    b.ring(0.475, 0.02, 0.025, 'glow_main', segs=12, at=(0, 0, 0.73))

    t = m.node('turret', at=(0, 0, 1.0))
    t.cyl(0.37, 0.08, 'trim', segs=16, bevel=0.02)
    t.box((0.26, 0.40, 0.62), 'hull', bevel=0.04, taper=(0.8, 0.7), o='b', at=(0, 0.05, 0.07))
    with t.sym():
        t.box((0.03, 0.30, 0.36), 'paint', bevel=0.01, at=(0.125, 0.05, 0.30), rot=(0, -3, 0))
    t.box((0.30, 0.16, 0.26), 'hull', bevel=0.03, at=(0, 0.30, 0.22))
    # sensor mast on the axis
    t.lathe([(0.10, 0.66), (0.10, 0.74), (0.06, 0.82), (0.045, 1.46), (0.07, 1.50)], segs=8)
    t.box((0.36, 0.07, 0.11), 'paint', bevel=0.02, at=(0, -0.02, 1.50))
    t.box((0.26, 0.012, 0.03), 'glow_main', bevel=0, at=(0, -0.058, 1.50))
    t.cyl(0.06, 0.06, 'trim', segs=8, bevel=0.012, at=(0, 0, 1.55))
    zn = power_node(m, 'missile') - 1.0
    mount(t, 1.60, zn)

    cr = m.node('cradle', at=(0, 0, 0.60), parent=t)          # pitches at the trunnion
    cr.cyl(0.07, 0.56, 'trim', segs=10, bevel=0.015, o='c', rot=RIGHT)
    TILT = (-24, 0, 0)
    for i, x in enumerate((0.40, -0.40)):
        g = m.node(f'barrel_{i + 1}', at=(x, 0, 0), parent=cr)      # the launchers kick back alternately
        with g.frames(T(at=(0, -0.04, 0.06), rot=TILT)):
            _launcher(g, 2)
        g.cyl(0.12, 0.05, 'trim', segs=10, bevel=0.012, o='c', rot=RIGHT, at=(-0.235 * (1 if x > 0 else -1), 0, 0))
    # level 2: a third tube row on each launcher
    u = m.node('lvl2', parent=cr)
    with u.sym():
        with u.frames(T(at=(0.40, -0.04, 0.06), rot=TILT) @ T(at=(0, 0, 0.355))):
            _launcher(u, 1)
    # level 3: search radar, reload rack at the rear, armour skirts
    u = m.node('lvl3', parent=t)
    with u.frames(T(at=(0, -0.10, 1.20), rot=(66, 0, 0), scale=0.80)):
        u.lathe([(0.0, 0.0), (0.12, 0.01), (0.26, 0.07), (0.28, 0.10), (0.12, 0.045), (0.0, 0.035)], 'paint', segs=14)
        u.torus(0.275, 0.014, 'hull', segs=14, rsegs=5, at=(0, 0, 0.09))
        u.rod((0, 0, 0.03), (0, 0, 0.20), 0.012, 'trim', segs=5)
        u.sphere(0.03, 'glow_main', segs=8, rings=5, at=(0, 0, 0.21))
    u.box((0.08, 0.12, 0.08), 'hull', bevel=0.015, at=(0, -0.06, 1.20))
    u.box((0.50, 0.20, 0.14), 'hull', bevel=0.03, at=(0, 0.50, 0.15))
    for x in (-0.16, 0, 0.16):
        u.lathe([(0.0, 0.0), (0.062, 0.01), (0.062, 0.34), (0.032, 0.42), (0.0, 0.45)], 'paint', segs=8,
                at=(x, 0.50, 0.20))
        u.sphere(0.016, 'glow_main', segs=6, rings=4, at=(x, 0.50, 0.655))
    u.box((0.54, 0.03, 0.26), 'paint', bevel=0.01, at=(0, 0.615, 0.26))
    with u.sym():
        u.box((0.04, 0.44, 0.22), 'paint', bevel=0.012, at=(0.185, -0.02, 0.20), rot=(0, 10, 0))
    return m


# ------------------------------------------------------------------ 10. gravity
def tower_gravity():
    """Graviton Well: three arms hold a heavy ring housing; a dark core floats in it inside a tilted ring."""
    m = tower_model('gravity')
    b = tower_base(m)
    b.lathe([(0.50, 0.62), (0.53, 0.66), (0.53, 0.78), (0.41, 0.88), (0.41, 0.94)], segs=12)
    b.ring(0.535, 0.02, 0.025, 'glow_main', segs=12, at=(0, 0, 0.72))

    t = m.node('turret', at=(0, 0, 0.94))
    t.cyl(0.43, 0.08, 'trim', segs=16, bevel=0.02)
    t.lathe([(0.36, 0.08), (0.40, 0.14), (0.40, 0.26), (0.26, 0.36), (0.12, 0.38), (0.0, 0.36)], 'hull', segs=14)
    t.cyl(0.09, 0.02, 'glow_main', segs=10, at=(0, 0, 0.37))
    ZR = 1.00      # ring housing height
    t.ring(0.61, 0.20, 0.22, 'hull', segs=18, bevel=0.045, at=(0, 0, ZR))
    t.ring(0.505, 0.02, 0.035, 'glow_main', segs=18, at=(0, 0, ZR))
    with t.frames(radial(3, start=30)):
        t.ring(0.675, 0.09, 0.27, 'paint', segs=6, bevel=0.02, arc=64, phase=-32, at=(0, 0, ZR))
        t.box((0.03, 0.30, 0.03), 'trim', bevel=0.008, at=(0.725, 0, ZR + 0.15))
    with t.frames(radial(3, start=90)):
        t.prism([(0.30, 0.10), (0.46, 0.10), (0.74, 0.84), (0.74, 1.14), (0.60, 1.14), (0.60, 0.88)], 0.13, 'hull',
                bevel=0.02, plane='xz')
        t.prism([(0.56, 1.10), (0.73, 1.10), (0.71, 1.38), (0.48, 1.72), (0.11, 1.90), (0.0, 1.90), (0.0, 1.80),
                 (0.09, 1.80), (0.39, 1.62), (0.57, 1.34)], 0.09, 'hull', bevel=0.015, plane='xz')
        t.prism([(0.70, 0.72), (0.775, 0.84), (0.775, 1.16), (0.74, 1.40), (0.71, 1.38), (0.74, 1.14), (0.74, 0.84)],
                0.15, 'paint', bevel=0.012, plane='xz')
        t.box((0.02, 0.04, 0.20), 'glow_main', bevel=0, at=(0.782, 0, ZR))
        t.cyl(0.05, 0.16, 'trim', segs=8, bevel=0.01, o='c', rot=(90, 0, 0), at=(0.66, 0, 1.12))
    t.cyl(0.11, 0.07, 'trim', segs=10, bevel=0.015, at=(0, 0, 1.86))
    zn = power_node(m, 'gravity') - 0.94
    mount(t, 1.92, zn)

    o = m.node('orb', at=(0, 0, ZR), parent=t)                # swells when the well pulses
    o.sphere(0.21, 'hull', segs=14, rings=8)
    o.torus(0.212, 0.02, 'glow_main', segs=16, rsegs=4)
    o.torus(0.212, 0.02, 'glow_main', segs=16, rsegs=4, rot=(90, 0, 0))
    o.torus(0.212, 0.02, 'glow_main', segs=16, rsegs=4, rot=(0, 90, 0))

    s = m.node('spin_1', at=(0, 0, ZR), rot=(20, 0, 0), parent=t)
    s.ring(0.36, 0.035, 0.05, 'trim', segs=24, bevel=0.01)
    with s.frames(radial(3)):
        s.box((0.08, 0.11, 0.08), 'paint', bevel=0.015, at=(0.36, 0, 0))
        s.box((0.02, 0.05, 0.03), 'glow_main', bevel=0, at=(0.405, 0, 0))
    # level 2: field emitter blocks on the housing between the arms
    u = m.node('lvl2', parent=t)
    with u.frames(radial(3, start=30)):
        u.box((0.15, 0.36, 0.32), 'hull', bevel=0.03, at=(0.765, 0, ZR))
        u.box((0.03, 0.26, 0.20), 'paint', bevel=0.01, at=(0.845, 0, ZR))
        u.box((0.012, 0.18, 0.03), 'glow_main', bevel=0, at=(0.862, 0, ZR))
        u.prism([(0.70, -0.16), (0.82, -0.16), (0.76, -0.46)], 0.10, 'trim', bevel=0.01, plane='xz', at=(0, 0, ZR))
        u.prism([(0.70, 0.16), (0.82, 0.16), (0.76, 0.40)], 0.10, 'trim', bevel=0.01, plane='xz', at=(0, 0, ZR))
    # level 3: a second, larger ring round the core and fins on the arms
    u = m.node('lvl3', parent=t)
    with u.frames(radial(3, start=90)):
        u.prism([(0.71, 1.16), (0.86, 1.34), (0.80, 1.66), (0.56, 1.80), (0.50, 1.72), (0.68, 1.56), (0.70, 1.38)],
                0.05, 'paint', bevel=0.01, plane='xz')
        u.sphere(0.03, 'glow_main', segs=6, rings=4, at=(0.80, 0, 1.68))
    s2 = m.node('spin_2', at=(0, 0, ZR), rot=(-22, 14, 0), parent=u)
    s2.ring(0.445, 0.03, 0.045, 'trim', segs=24)
    s2.ring(0.445, 0.012, 0.055, 'glow_main', segs=24)
    with s2.frames(radial(4, start=45)):
        s2.box((0.07, 0.10, 0.075), 'hull', bevel=0.015, at=(0.445, 0, 0))
    return m


# ------------------------------------------------------------------ 11. uplink spire
def tower_spire():
    """Uplink Spire: a lattice relay mast. Kestrel stands on the railed hexagonal platform; its floor is
    flat at z = 6.5 (x1.15 = sim TOWER_H.spire 7.475) and nothing rises above it near the axis.
    The 'turret' is only a small relay scanner inside the lattice."""
    m = tower_model('spire')
    b = tower_base(m)
    ZT = 5.72                                    # top of the legs

    def leg(z):                                  # leg radius at height z
        return 0.76 - 0.46 * (z - 0.56) / (ZT - 0.56)

    # trunk
    b.lathe([(0.36, 0.62), (0.36, 0.74), (0.24, 1.00), (0.19, 3.30), (0.15, 5.55), (0.21, 5.74), (0.21, 5.86)],
            segs=6, sharp=30)
    LV = (1.60, 2.80, 3.90, 4.90)
    with b.frames(radial(3, start=90)):
        b.rod((leg(0.56), 0, 0.56), (leg(ZT), 0, ZT), 0.04, 'hull', segs=6, r2=0.03)
        b.prism([(0.58, 0.56), (0.86, 0.56), (0.86, 0.66), (0.76, 0.80), (0.60, 0.86)], 0.16, 'hull', bevel=0.02,
                plane='xz')
        b.rod((leg(0.80), 0, 0.80), (leg(1.55), 0, 1.55), 0.058, 'paint', segs=6, bevel=0.01)
        b.box((0.012, 0.03, 0.9), 'glow_main', bevel=0, at=(0.172, 0, 3.35))
        for z in LV:
            b.rod((0.16, 0, z), (leg(z), 0, z), 0.02, 'trim', segs=5)
            b.cyl(0.055, 0.07, 'trim', segs=6, bevel=0.012, o='c', at=(leg(z), 0, z))
    for z in LV:
        r = leg(z)
        pts = [(r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), z) for a in (90, 210, 330)]
        for i in range(3):
            b.rod(pts[i], pts[(i + 1) % 3], 0.018, 'trim', segs=5)
        b.cyl(0.25 - (z - 1.6) * 0.012, 0.08, 'trim', segs=6, bevel=0.015, at=(0, 0, z - 0.04))
    # relay vanes under the platform
    with b.frames(radial(3, start=30)):
        b.prism([(0.18, 5.42), (0.58, 5.70), (0.62, 5.82), (0.18, 5.82)], 0.04, 'paint', bevel=0.008, plane='xz')
    # platform: brace cone and a flat hexagonal floor (top exactly at 6.5), 1.4 across the flats
    b.lathe([(0.21, 5.86), (0.32, 6.04), (0.64, 6.36), (0.79, 6.40), (0.81, 6.44), (0.81, 6.50), (0.0, 6.50)], **HEX)
    with b.frames(radial(6)):
        b.prism([(0.30, 6.05), (0.60, 6.37), (0.52, 6.37), (0.27, 6.11)], 0.05, 'hull', bevel=0.008, plane='xz')
    # open railing: six corner posts, top rail at waist height, a thinner mid rail
    RP = 0.775
    corners = [(RP * math.cos(math.radians(a)), RP * math.sin(math.radians(a))) for a in range(30, 390, 60)]
    for x, y in corners:
        b.cyl(0.018, 0.42, 'hull', segs=5, at=(x, y, 6.50))
    for i in range(6):
        (x0, y0), (x1, y1) = corners[i], corners[(i + 1) % 6]
        b.rod((x0, y0, 6.92), (x1, y1, 6.92), 0.018, 'trim', segs=5)
        b.rod((x0, y0, 6.71), (x1, y1, 6.71), 0.011, 'hull', segs=4)
    # guide lights on the outside of the floor edge, one per corner
    with b.frames(radial(6, start=30)):
        b.box((0.03, 0.10, 0.035), 'glow_main', bevel=0, at=(0.80, 0, 6.42))
        b.sphere(0.024, 'trim', segs=6, rings=4, at=(RP, 0, 6.93))
    # antenna cluster outside the rail at the back-left corner
    with b.frames(rotz(150)):
        b.box((0.14, 0.16, 0.10), 'hull', bevel=0.02, at=(0.88, 0, 6.44))
        b.rod((0.90, -0.04, 6.48), (0.94, -0.05, 7.52), 0.012, 'trim', segs=5, r2=0.005)
        b.rod((0.90, 0.05, 6.48), (0.93, 0.08, 7.18), 0.010, 'trim', segs=5, r2=0.005)
        b.rod((0.94, 0.0, 6.48), (1.02, 0.0, 6.96), 0.009, 'trim', segs=5, r2=0.004)
        b.sphere(0.02, 'glow_main', segs=6, rings=4, at=(0.94, -0.05, 7.53))
        b.box((0.10, 0.012, 0.05), 'trim', bevel=0, at=(0.93, 0.08, 7.0))

    # relay scanner: a collar on the trunk, well inside the legs
    t = m.node('turret', at=(0, 0, 4.40))
    t.ring(0.205, 0.07, 0.12, 'trim', segs=12, bevel=0.015)
    t.box((0.12, 0.10, 0.10), 'hull', bevel=0.02, at=(0, -0.26, 0))
    t.cyl(0.035, 0.012, 'glow_main', segs=8, rot=FWD, at=(0, -0.312, 0))
    t.box((0.08, 0.06, 0.06), 'paint', bevel=0.012, at=(0, 0.25, 0))

    # level 2: cross bracing between the legs, an antenna ring under the platform, post lamps
    u = m.node('lvl2')
    bays = (0.80,) + LV + (ZT - 0.10,)
    for k, (z0, z1) in enumerate(zip(bays, bays[1:])):
        for i, a in enumerate((90, 210, 330)):
            a0, a1 = (a, a + 120) if (k + i) % 2 == 0 else (a + 120, a)
            p0 = (leg(z0) * math.cos(math.radians(a0)), leg(z0) * math.sin(math.radians(a0)), z0)
            p1 = (leg(z1) * math.cos(math.radians(a1)), leg(z1) * math.sin(math.radians(a1)), z1)
            u.rod(p0, p1, 0.024, 'trim', segs=4)
    u.ring(0.50, 0.03, 0.03, 'trim', segs=18, at=(0, 0, 6.14))
    with u.frames(radial(6)):
        u.rod((0.50, 0, 6.14), (1.00, 0, 6.06), 0.018, 'trim', segs=5, r2=0.010)
        u.rod((1.00, 0, 5.82), (1.00, 0, 6.28), 0.014, 'trim', segs=4)
        u.box((0.05, 0.08, 0.06), 'paint', bevel=0, at=(1.00, 0, 6.06))
    with u.frames(radial(3, start=90)):
        u.rod((leg(1.7), 0, 1.7), (leg(2.7), 0, 2.7), 0.06, 'paint', segs=6, bevel=0.01)
    with u.frames(radial(6, start=30)):
        u.sphere(0.03, 'glow_main', segs=6, rings=4, at=(RP, 0, 6.945))
    # level 3: outriggers with relay paddles, lit strips up the legs, a lit band under the floor
    u = m.node('lvl3')
    with u.frames(radial(3, start=90)):
        u.rod((leg(1.3) + 0.045, 0, 1.3), (leg(4.3) + 0.042, 0, 4.3), 0.011, 'glow_main', segs=4)
        u.prism([(leg(5.25), 5.20), (1.04, 5.36), (1.10, 5.36), (1.10, 5.46), (leg(5.25), 5.34)], 0.05, 'hull',
                bevel=0.01, plane='xz')
        u.rod((1.07, 0, 4.96), (1.07, 0, 5.92), 0.018, 'trim', segs=5)
        u.box((0.04, 0.34, 0.44), 'paint', bevel=0.012, at=(1.07, 0, 5.62))
        u.box((0.012, 0.06, 0.28), 'glow_main', bevel=0, at=(1.093, 0, 5.62))
        u.rod((leg(4.5), 0, 4.50), (1.04, 0, 5.34), 0.012, 'hull', segs=4)
    u.ring(0.34, 0.02, 0.03, 'glow_main', segs=18, at=(0, 0, 6.10))
    return m


TOWERS = [tower_pulse, tower_cryo, tower_arc, tower_mortar, tower_rail, tower_beacon, tower_flame, tower_lance,
          tower_missile, tower_gravity, tower_spire]
