"""VOLTSPIRE objective ("the Heart") and street props."""
import math
from vs_lib import *


# ------------------------------------------------------------------ 14. core
def core():
    m = Model('core', {'hull': ('#262a33', 0.6, 0.45), 'paint': '#2f7fb5', 'trim': ('#9aa3ad', 0.6, 0.4),
                       'glow_core': '#35f0ff'})
    b = m.node('base')
    G = 'glow_core'
    b.lathe([(2.20, 0.0), (2.25, 0.05), (2.25, 0.20), (2.08, 0.34), (1.58, 0.34), (1.46, 0.52), (1.12, 0.52),
             (1.00, 0.38), (0.0, 0.38)], 'hull', segs=24, sharp=30)
    b.ring(1.83, 0.10, 0.03, G, segs=24, at=(0, 0, 0.345))
    b.ring(2.255, 0.03, 0.05, G, segs=24, at=(0, 0, 0.125))
    b.ring(1.29, 0.30, 0.03, 'trim', segs=24, bevel=0.01, at=(0, 0, 0.53))
    with b.frames(radial(8, start=22.5)):
        b.box((0.20, 0.50, 0.14), 'paint', bevel=0.03, at=(2.17, 0, 0.27), rot=(0, -39.5, 0))
        b.box((0.03, 0.26, 0.05), G, bevel=0, at=(2.262, 0, 0.125))
    with b.frames(radial(16, radius=1.98, start=11.25)):
        b.cyl(0.04, 0.03, 'trim', segs=6, bevel=0.008, at=(0, 0, 0.335))
    # emitter pedestal + energy column
    b.lathe([(0.80, 0.38), (0.80, 0.46), (0.52, 0.70), (0.44, 1.10), (0.56, 1.22), (0.56, 1.30), (0.36, 1.40),
             (0.0, 1.40)], 'hull', segs=16)
    for z in (0.80, 0.94, 1.08):
        b.torus(0.50 - (z - 0.8) * 0.2, 0.035, 'trim', segs=16, rsegs=6, at=(0, 0, z))
    b.ring(0.565, 0.03, 0.04, G, segs=16, at=(0, 0, 1.26))
    b.cyl(0.20, 0.52, G, segs=12, r2=0.12, at=(0, 0, 1.38))
    b.sphere(0.95, G, segs=24, rings=14, at=(0, 0, 2.70))
    # claw pylons
    claw = [(2.15, 0.30), (2.20, 1.40), (1.95, 3.00), (1.40, 4.20), (0.70, 4.60), (0.40, 4.15), (0.75, 4.25),
            (1.20, 3.90), (1.62, 2.95), (1.80, 1.50), (1.60, 0.90), (1.55, 0.30)]
    with b.frames(radial(4, start=45)):
        b.prism(claw, 0.36, 'hull', bevel=0.045, plane='xz')
        b.prism([(2.24, 0.50), (2.29, 1.40), (2.03, 3.02), (1.50, 4.16), (1.36, 4.06), (1.87, 2.96), (2.10, 1.40),
                 (2.08, 0.50)], 0.22, 'paint', bevel=0.03, plane='xz')
        b.tube([(1.575, 0, 0.95), (1.775, 0, 1.50), (1.60, 0, 2.95), (1.18, 0, 3.88), (0.76, 0, 4.22)], 0.04, G, segs=6)
        b.lathe([(0.0, 0.0), (0.09, 0.10), (0.06, 0.22)], G, segs=8, m=aim((0.36, 0, 4.06), (0.56, 0, 4.24)))
        with b.frames([Matrix.Identity(4), Matrix.Diagonal((1, -1, 1, 1))]):
            b.box((0.30, 0.04, 0.50), 'trim', bevel=0.012, at=(1.92, 0.185, 1.20), rot=(0, 4, 0))
            b.box((0.10, 0.03, 0.80), G, bevel=0, at=(1.98, 0.19, 2.2), rot=(0, 9, 0))
            b.cyl(0.05, 0.03, 'trim', segs=6, bevel=0.008, rot=(-90, 0, 0), at=(1.20, 0.18, 4.15))
        b.prism([(1.50, 0.34), (2.20, 0.34), (2.20, 0.50), (2.02, 0.70), (1.62, 0.70)], 0.56, 'hull', bevel=0.04,
                plane='xz')
        b.rod((1.02, 0, 4.40), (0.96, 0, 5.0), 0.022, 'trim', segs=6, r2=0.01)
        b.sphere(0.04, G, segs=6, rings=4, at=(0.96, 0, 5.0))
        b.tube([(1.60, 0.10, 0.60), (1.30, 0.12, 0.60), (0.95, 0.10, 0.50), (0.70, 0.06, 0.62)], 0.05, 'trim', segs=6)
    # consoles between the pylons
    with b.frames(radial(4)):
        b.prism([(1.62, 0.34), (2.02, 0.34), (2.02, 0.56), (1.78, 0.78), (1.62, 0.78)], 0.60, 'hull', bevel=0.03,
                plane='xz')
        b.box((0.26, 0.44, 0.02), G, bevel=0, at=(1.905, 0, 0.675), rot=(0, 42.5, 0))
        b.box((0.12, 0.50, 0.05), 'paint', bevel=0.012, at=(1.70, 0, 0.79))

    s1 = m.node('spin_1', at=(0, 0, 2.70), rot=(16, 0, 0))
    s1.ring(1.40, 0.12, 0.16, 'hull', segs=32, bevel=0.03)
    s1.ring(1.335, 0.02, 0.07, G, segs=32)
    with s1.frames(radial(6)):
        s1.box((0.22, 0.30, 0.22), 'paint', bevel=0.04, at=(1.42, 0, 0))
        s1.box((0.03, 0.18, 0.08), G, bevel=0, at=(1.535, 0, 0))
        s1.prism([(-0.06, 0.0), (0.0, 0.16), (0.06, 0.0)], 0.06, 'trim', bevel=0.01, plane='xz', at=(1.40, 0, 0.10))
    s2 = m.node('spin_2', at=(0, 0, 2.70), rot=(-14, 12, 0))
    s2.ring(1.18, 0.07, 0.11, 'trim', segs=32, bevel=0.02)
    s2.ring(1.18, 0.03, 0.125, G, segs=32)
    with s2.frames(radial(3, start=30)):
        s2.box((0.14, 0.34, 0.18), 'hull', bevel=0.03, at=(1.19, 0, 0))
        s2.box((0.10, 0.20, 0.20), 'paint', bevel=0.02, at=(1.21, 0, 0))
        s2.lathe([(0.0, 0.0), (0.05, 0.03), (0.0, 0.18)], G, segs=6, rot=LEFT, at=(1.12, 0, 0))
    return m


# ------------------------------------------------------------------ 15. barrier
def prop_barrier():
    m = Model('prop_barrier', {'hull': ('#2a2e37', 0.5, 0.55), 'paint': '#ffb31a', 'trim': ('#8a9099', 0.6, 0.4),
                               'glow_main': '#19e3ff'})
    b = m.node('body')
    prof = [(-0.26, 0.0), (-0.26, 0.10), (-0.12, 0.30), (-0.085, 0.70), (0.085, 0.70), (0.12, 0.30), (0.26, 0.10),
            (0.26, 0.0)]
    b.prism(prof, 1.74, 'hull', bevel=0.02, plane='yz')
    cap = [(-0.275, 0.0), (-0.275, 0.11), (-0.135, 0.31), (-0.10, 0.715), (0.10, 0.715), (0.135, 0.31), (0.275, 0.11),
           (0.275, 0.0)]
    with b.sym():
        b.prism(cap, 0.10, 'trim', bevel=0.012, plane='yz', at=(0.85, 0, 0))
        b.prism(cap, 0.07, 'paint', bevel=0.01, plane='yz', at=(0.30, 0, 0), scale=(1, 0.99, 0.985))
        b.box((0.012, 0.10, 0.22), 'glow_main', bevel=0, at=(0.90, 0, 0.48))
        b.box((0.22, 0.56, 0.035), 'hull', bevel=0.01, at=(0.55, 0, 0.018))
    b.box((1.50, 0.10, 0.02), 'paint', bevel=0.006, at=(0, 0, 0.705))
    for side in (0, 180):
        with b.frames(rotz(side)):
            # slanted neon chevrons on the upper face, neon line on the skirt
            for i, x in enumerate((-0.62, -0.47, -0.12, 0.03, 0.18, 0.53, 0.68)):
                b.prism([(-0.075, -0.15), (-0.005, -0.15), (0.075, 0.15), (0.005, 0.15)], 0.014, 'glow_main',
                        plane='xz', at=(x, -0.103, 0.50), rot=(-5, 0, 0))
            b.box((1.50, 0.014, 0.026), 'glow_main', bevel=0, at=(0, -0.262, 0.06))
            for x in (-0.80, -0.35, 0.35, 0.80):
                b.cyl(0.022, 0.02, 'trim', segs=6, rot=FWD, at=(x, -0.185, 0.2), bevel=0.005)
    return m


# ------------------------------------------------------------------ 16. lamp
def prop_lamp():
    m = Model('prop_lamp', {'hull': ('#262a33', 0.6, 0.45), 'paint': '#1f8f9a', 'trim': ('#8a9099', 0.6, 0.4),
                            'glow_main': '#ff2bd6'})
    b = m.node('body')
    b.lathe([(0.25, 0.0), (0.25, 0.06), (0.17, 0.16), (0.13, 0.50), (0.09, 0.58)], 'hull', segs=8, phase=22.5, sharp=30)
    with b.frames(radial(4, radius=0.20, start=45)):
        b.cyl(0.022, 0.03, 'trim', segs=6, at=(0, 0, 0.055), bevel=0.005)
    b.box((0.16, 0.03, 0.2), 'paint', bevel=0.01, at=(0, -0.132, 0.34), rot=(-5, 0, 0))
    b.box((0.08, 0.02, 0.03), 'glow_main', bevel=0, at=(0, -0.146, 0.38), rot=(-5, 0, 0))
    b.cyl(0.07, 2.25, 'hull', segs=8, r2=0.05, at=(0, 0, 0.55))
    for z in (1.15, 2.05):
        b.cyl(0.078, 0.07, 'trim', segs=8, bevel=0.012, at=(0, 0, z))
    # goose-neck arm reaching to the front
    arm = [(0, 0, 2.75), (0, 0, 2.96), (0, -0.10, 3.10), (0, -0.30, 3.16), (0, -0.92, 3.13)]
    b.tube(arm, [0.05, 0.05, 0.048, 0.045, 0.04], 'hull', segs=8)
    b.prism([(-0.03, 2.55), (-0.03, 2.85), (-0.34, 3.12), (-0.40, 3.10)], 0.035, 'paint', bevel=0.008, plane='yz')
    b.box((0.22, 0.66, 0.07), 'hull', bevel=0.02, at=(0, -0.68, 3.085), rot=(-2.8, 0, 0))
    b.box((0.14, 0.58, 0.03), 'glow_main', bevel=0.006, at=(0, -0.68, 3.045), rot=(-2.8, 0, 0))
    with b.sym():
        b.box((0.02, 0.60, 0.045), 'paint', bevel=0.006, at=(0.112, -0.68, 3.09), rot=(-2.8, 0, 0))
    b.tube([(0.0, 0.05, 2.5), (0.0, 0.11, 2.8), (0.0, 0.04, 3.1), (0, -0.12, 3.2), (0, -0.4, 3.2)], 0.014, 'trim',
           segs=5)
    b.rod((0, 0.0, 2.96), (0, 0.07, 3.20), 0.012, 'trim', segs=5, r2=0.006)
    # holo sign on the pole
    b.box((0.06, 0.05, 0.05), 'trim', bevel=0.01, at=(0.08, 0, 1.92))
    b.box((0.035, 0.30, 0.44), 'hull', bevel=0.012, at=(0.14, 0, 1.75))
    b.box((0.02, 0.22, 0.14), 'glow_main', bevel=0, at=(0.155, 0, 1.86))
    b.box((0.02, 0.22, 0.05), 'paint', bevel=0, at=(0.155, 0, 1.72))
    b.box((0.02, 0.22, 0.05), 'glow_main', bevel=0, at=(0.155, 0, 1.62))
    b.box((0.02, 0.22, 0.14), 'glow_main', bevel=0, at=(0.125, 0, 1.86))
    b.box((0.02, 0.22, 0.05), 'glow_main', bevel=0, at=(0.125, 0, 1.62))
    return m


# ------------------------------------------------------------------ 17. crate
def prop_crate():
    m = Model('prop_crate', {'hull': ('#2a2e37', 0.6, 0.45), 'paint': '#3d5a40', 'trim': ('#8a9099', 0.6, 0.4),
                             'glow_main': '#ffd23f'})
    b = m.node('body')
    b.box((0.84, 0.84, 0.56), 'hull', bevel=0.04, o='b', at=(0, 0, 0.03))
    b.box((0.84, 0.84, 0.25), 'hull', bevel=0.04, o='b', at=(0, 0, 0.63))
    b.box((0.78, 0.78, 0.06), 'glow_main', bevel=0, o='b', at=(0, 0, 0.58))
    for z in (0.11, 0.79):
        with b.frames([T(at=(sx * 0.345, sy * 0.345, z)) for sx in (-1, 1) for sy in (-1, 1)]):
            b.box((0.21, 0.21, 0.22), 'trim', bevel=0.035)
    with b.frames(radial(4)):
        b.box((0.03, 0.44, 0.30), 'paint', bevel=0.012, at=(0.425, 0, 0.36))
        for y in (-0.12, 0, 0.12):
            b.box((0.036, 0.05, 0.20), 'hull', bevel=0, at=(0.427, y, 0.36))
        b.box((0.035, 0.44, 0.10), 'paint', bevel=0.012, at=(0.425, 0, 0.77))
        b.box((0.05, 0.12, 0.16), 'trim', bevel=0.015, at=(0.415, 0, 0.61))
        b.box((0.012, 0.05, 0.035), 'glow_main', bevel=0, at=(0.443, 0, 0.61))
    b.box((0.50, 0.50, 0.03), 'paint', bevel=0.012, at=(0, 0, 0.88))
    b.box((0.26, 0.07, 0.014), 'glow_main', bevel=0, at=(0, 0, 0.893))
    with b.sym():
        b.tube([(0.16, -0.12, 0.885), (0.16, -0.12, 0.905), (0.16, 0.12, 0.905), (0.16, 0.12, 0.885)], 0.011, 'trim',
               segs=5)
    return m


MISC = [core, prop_barrier, prop_lamp, prop_crate]
