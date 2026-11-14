"""VOLTSPIRE towers: shared octagonal armoured base + six turret designs."""
import math
from vs_lib import *

HULL = ('#262a33', 0.6, 0.45)
TRIM = ('#9aa3ad', 0.6, 0.4)
DARK = ('#0f1116', 0.6, 0.45)


def tower_model(name, accent):
    return Model(name, {'hull': HULL, 'paint': accent, 'trim': TRIM, 'glow_main': accent})


def tower_base(m):
    """Octagonal armoured plinth, 1.66 m across flats, deck at z=0.56, turret ring top at z=0.62."""
    b = m.node('base')
    b.lathe([(0.86, 0.0), (0.90, 0.04), (0.90, 0.15), (0.80, 0.25), (0.80, 0.34), (0.66, 0.44),
             (0.66, 0.52), (0.62, 0.56)], segs=8, phase=22.5, sharp=30)
    # neon band round the waist
    b.ring(0.80, 0.035, 0.035, 'glow_main', segs=8, phase=22.5, at=(0, 0, 0.295), sharp=30)
    b.ring(0.905, 0.03, 0.05, 'trim', segs=8, phase=22.5, at=(0, 0, 0.095), sharp=30)
    # diagonal stabiliser feet
    with b.frames(radial(4, start=45)):
        b.prism([(0.60, 0.0), (1.05, 0.0), (1.05, 0.08), (0.96, 0.17), (0.60, 0.32)], 0.30, 'hull',
                bevel=0.02, plane='xz')
        b.prism([(0.70, 0.30), (0.93, 0.205), (0.99, 0.15), (1.0, 0.185), (0.95, 0.235), (0.72, 0.335)], 0.20, 'paint',
                bevel=0.008, plane='xz')
        b.cyl(0.035, 0.03, 'trim', segs=8, at=(1.0, 0, 0.075), bevel=0.008)
        b.box((0.012, 0.16, 0.05), 'glow_main', bevel=0, at=(1.052, 0, 0.045))
    # cardinal armour plates + sloped panels
    with b.frames(radial(4)):
        b.box((0.03, 0.44, 0.075), 'paint', bevel=0.01, at=(0.835, 0, 0.095))
        b.box((0.03, 0.36, 0.13), 'paint', bevel=0.01, at=(0.685, 0, 0.395), rot=(0, -54.5, 0))
        for y in (-0.1, 0, 0.1):
            b.box((0.036, 0.05, 0.085), 'hull', bevel=0.006, at=(0.69, y, 0.398), rot=(0, -54.5, 0))
    # turret ring + bolts
    b.cyl(0.50, 0.06, 'trim', segs=16, bevel=0.015, at=(0, 0, 0.56))
    with b.frames(radial(8, radius=0.575, start=22.5)):
        b.cyl(0.028, 0.03, 'trim', segs=6, at=(0, 0, 0.555), bevel=0.006)
    return b


# ------------------------------------------------------------------ 1. pulse
def tower_pulse():
    m = tower_model('tower_pulse', '#19e3ff')
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
        # barrels
        with t.frames(T(at=(0.125, -0.33, 0.32), rot=FWD)):
            t.cyl(0.095, 0.28, 'hull', segs=10, bevel=0.02)
            for z in (0.07, 0.14, 0.21):
                t.cyl(0.108, 0.03, 'trim', segs=10, bevel=0.008, at=(0, 0, z))
            t.cyl(0.055, 0.50, 'trim', segs=10)
            t.cyl(0.078, 0.09, 'hull', segs=10, bevel=0.015, at=(0, 0, 0.42))
            t.cyl(0.05, 0.02, 'glow_main', segs=10, at=(0, 0, 0.497))
            t.ring(0.082, 0.02, 0.02, 'glow_main', segs=10, at=(0, 0, 0.37))
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
    return m


# ------------------------------------------------------------------ 2. cryo
def tower_cryo():
    m = tower_model('tower_cryo', '#9fd8ff')
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
            t.lathe(tank, 'paint', segs=12)
            for z in (0.16, 0.60):
                t.cyl(0.168, 0.045, 'hull', segs=12, bevel=0.01, at=(0, 0, z))
            t.ring(0.16, 0.02, 0.03, 'glow_main', segs=12, at=(0, 0, 0.38))
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
        t.lathe([(0.14, 0.14), (0.22, 0.22), (0.40, 0.42), (0.44, 0.43), (0.44, 0.49), (0.40, 0.50),
                 (0.21, 0.31), (0.0, 0.29)], 'paint', segs=16)
        t.ring(0.44, 0.03, 0.05, 'hull', segs=16, bevel=0.008, at=(0, 0, 0.455))
        t.torus(0.385, 0.018, 'glow_main', segs=16, rsegs=6, at=(0, 0, 0.495))
        t.lathe([(0.0, 0.28), (0.15, 0.30), (0.15, 0.325), (0.06, 0.36), (0.035, 0.50), (0.0, 0.53)], 'glow_main', segs=10)
        with t.frames(radial(6)):
            t.box((0.16, 0.02, 0.14), 'trim', bevel=0.005, at=(0.235, 0, 0.21), rot=(0, -42, 0))
    with t.sym():
        t.tube([(0.44, 0.10, 0.92), (0.50, -0.02, 0.98), (0.44, -0.22, 0.78), (0.24, -0.34, 0.52), (0.12, -0.36, 0.45)],
               0.035, 'trim', segs=7)
        t.box((0.10, 0.24, 0.20), 'hull', bevel=0.025, at=(0.33, -0.16, 0.30))
        t.box((0.02, 0.14, 0.04), 'glow_main', bevel=0, at=(0.385, -0.16, 0.32))
    t.tube([(0, 0.36, 1.04), (0, 0.16, 1.02), (0, -0.02, 0.80), (0, -0.14, 0.62)], 0.04, 'trim', segs=7)
    return m


# ------------------------------------------------------------------ 3. arc
def tower_arc():
    m = tower_model('tower_arc', '#a35bff')
    b = tower_base(m)
    b.lathe([(0.40, 0.62), (0.40, 0.70), (0.25, 0.84), (0.15, 2.12), (0.24, 2.20), (0.24, 2.25)], segs=12)
    n = 9
    for i in range(n):
        f = i / (n - 1)
        b.torus(0.30 - 0.10 * f, 0.042, 'trim', segs=16, rsegs=6, at=(0, 0, 0.94 + 1.10 * f))
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
    t.sphere(0.22, 'glow_main', segs=16, rings=10, at=(0, 0, 0.52))
    t.torus(0.34, 0.03, 'glow_main', segs=20, rsegs=6, at=(0, 0, 0.42))
    t.torus(0.31, 0.03, 'glow_main', segs=20, rsegs=6, at=(0, 0, 0.66))
    t.torus(0.335, 0.03, 'trim', segs=20, rsegs=6, at=(0, 0, 0.30))
    return m


# ------------------------------------------------------------------ 4. mortar
def tower_mortar():
    m = tower_model('tower_mortar', '#ff8a1f')
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
    with t.frames(T(at=(0, 0.04, 0.50), rot=(32, 0, 0))):
        t.lathe([(0.0, -0.36), (0.20, -0.34), (0.31, -0.24), (0.31, 0.02), (0.27, 0.06)], 'hull', segs=16)
        t.cyl(0.27, 0.66, 'hull', segs=16, r2=0.25, at=(0, 0, 0.02))
        t.lathe([(0.26, 0.56), (0.32, 0.60), (0.32, 0.72), (0.28, 0.74), (0.21, 0.74), (0.21, 0.66), (0.0, 0.66)],
                'trim', segs=16)
        t.cyl(0.21, 0.02, 'glow_main', segs=16, at=(0, 0, 0.665))
        for z in (0.14, 0.30, 0.46):
            t.ring(0.275 - z * 0.03, 0.035, 0.05, 'glow_main', segs=16, at=(0, 0, z))
            t.ring(0.285 - z * 0.03, 0.03, 0.022, 'hull', segs=16, at=(0, 0, z + 0.036))
            t.ring(0.285 - z * 0.03, 0.03, 0.022, 'hull', segs=16, at=(0, 0, z - 0.036))
        t.box((0.30, 0.10, 0.44), 'paint', bevel=0.03, at=(0, -0.27, 0.30))
        t.box((0.16, 0.14, 0.2), 'hull', bevel=0.03, at=(0, 0.30, -0.08))
        with t.frames(radial(6, start=30)):
            t.cyl(0.03, 0.03, 'hull', segs=6, at=(0.24, 0, -0.30), rot=(0, 40, 0))
    # shell rack at the rear
    for x in (-0.17, 0, 0.17):
        t.lathe([(0.0, 0.0), (0.075, 0.01), (0.075, 0.20), (0.05, 0.27)], 'paint', segs=10, at=(x, 0.44, 0.14))
        t.lathe([(0.05, 0.27), (0.03, 0.32), (0.0, 0.34)], 'glow_main', segs=10, at=(x, 0.44, 0.14))
    t.box((0.56, 0.20, 0.10), 'hull', bevel=0.025, at=(0, 0.44, 0.18))
    # ranging antenna
    t.rod((-0.42, 0.30, 0.10), (-0.42, 0.34, 0.92), 0.016, 'trim', segs=6, r2=0.008)
    t.sphere(0.03, 'glow_main', segs=8, rings=5, at=(-0.42, 0.34, 0.93))
    return m


# ------------------------------------------------------------------ 5. rail
def tower_rail():
    m = tower_model('tower_rail', '#ff2bd6')
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
    # rails
    with t.frames([Matrix.Identity(4), T(at=(0, 0, 2 * Z)) @ Matrix.Diagonal((1, 1, -1, 1))]):
        t.prism([(-0.50, Z + 0.035), (-1.50, Z + 0.035), (-1.58, Z + 0.06), (-1.52, Z + 0.10), (-0.95, Z + 0.13),
                 (-0.50, Z + 0.17)], 0.085, 'trim', bevel=0.012, plane='yz')
        t.prism([(-0.60, Z + 0.14), (-0.95, Z + 0.115), (-1.40, Z + 0.09), (-1.40, Z + 0.115), (-0.95, Z + 0.15),
                 (-0.60, Z + 0.19)], 0.05, 'paint', bevel=0.006, plane='yz')
    t.box((0.03, 1.02, 0.03), 'glow_main', bevel=0, at=(0, -1.03, Z))
    for y in (-0.72, -1.00, -1.28):
        with t.sym():
            t.box((0.022, 0.07, 0.30 - (-y - 0.72) * 0.12), 'hull', bevel=0.006, at=(0.052, y, Z))
        t.box((0.05, 0.03, 0.05), 'glow_main', bevel=0.008, at=(0, y, Z))
    t.lathe([(0.0, 0.0), (0.04, 0.02), (0.02, 0.10), (0.0, 0.12)], 'glow_main', segs=8, rot=FWD, at=(0, -1.46, Z))
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
    return m


# ------------------------------------------------------------------ 6. beacon
def tower_beacon():
    m = tower_model('tower_beacon', '#5dff8f')
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
    s.rod((0, 0, 0.50), (0, 0, 0.90), 0.014, 'trim', segs=6, r2=0.006)
    s.sphere(0.03, 'glow_main', segs=8, rings=5, at=(0, 0, 0.90))
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
    return m


TOWERS = [tower_pulse, tower_cryo, tower_arc, tower_mortar, tower_rail, tower_beacon]
