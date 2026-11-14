"""VOLTSPIRE enemies - "the Static": black / dark-crimson rogue machines with hot red-orange glows."""
import math
from vs_lib import *


def enemy_model(name):
    return Model(name, {'hull': ('#17181e', 0.6, 0.45), 'paint': '#7a1020', 'trim': ('#565c68', 0.6, 0.4),
                        'glow_main': '#ff3b1f'})


# ------------------------------------------------------------------ 7. grunt
def enemy_grunt():
    m = enemy_model('enemy_grunt')
    b = m.node('body')
    pod = [(-0.24, 0.62), (-0.30, 0.76), (-0.21, 0.94), (0.10, 1.00), (0.27, 0.88), (0.26, 0.66), (0.10, 0.56),
           (-0.12, 0.56)]
    b.prism(pod, 0.36, 'hull', bevel=0.04, plane='yz')
    b.prism([(-0.235, 0.925), (0.10, 0.995), (0.285, 0.87), (0.25, 0.945), (0.10, 1.04), (-0.19, 0.975)], 0.27, 'paint',
            bevel=0.012, plane='yz')
    with b.sym():
        b.prism([(-0.19, 0.66), (-0.235, 0.76), (-0.16, 0.90), (0.08, 0.94), (0.21, 0.86), (0.21, 0.68)], 0.05, 'paint',
                bevel=0.012, plane='yz', at=(0.185, 0, 0))
        # legs (digitigrade)
        H, K, A = (0.20, 0.04, 0.64), (0.26, 0.21, 0.40), (0.24, 0.02, 0.13)
        b.cyl(0.095, 0.08, 'trim', segs=10, bevel=0.015, o='c', rot=RIGHT, at=(0.21, 0.04, 0.64))
        b.limb(H, K, 0.08, 0.058, 'hull', segs=8, power=3)
        b.box((0.04, 0.12, 0.2), 'paint', bevel=0.012, m=aim(H, K, (1, 0, 0)), at=(0, 0.065, 0.15), rot=(0, 0, 90))
        b.cyl(0.062, 0.12, 'trim', segs=8, bevel=0.012, o='c', rot=RIGHT, at=K)
        b.limb(K, A, 0.052, 0.04, 'hull', segs=8, power=3)
        b.prism([(-0.20, 0.0), (-0.17, 0.07), (-0.02, 0.14), (0.07, 0.11), (0.10, 0.0)], 0.15, 'hull', bevel=0.02,
                plane='yz', at=(0.24, 0, 0))
        b.prism([(-0.25, 0.0), (-0.21, 0.055), (-0.13, 0.085), (-0.14, 0.0)], 0.11, 'paint', bevel=0.01, plane='yz',
                at=(0.24, 0, 0))
        # arm guns
        b.box((0.09, 0.22, 0.11), 'hull', bevel=0.02, at=(0.25, -0.02, 0.80))
        b.cyl(0.038, 0.20, 'trim', segs=8, rot=FWD, at=(0.25, -0.12, 0.79))
        b.cyl(0.048, 0.05, 'hull', segs=8, bevel=0.01, rot=FWD, at=(0.25, -0.27, 0.79))
        b.cyl(0.028, 0.012, 'glow_main', segs=8, rot=FWD, at=(0.25, -0.317, 0.79))
        b.box((0.07, 0.02, 0.13), 'glow_main', bevel=0, at=(0.08, 0.268, 0.78))
    # eye
    with b.frames(T(at=(0, -0.255, 0.775), rot=(80, 0, 0))):
        b.cyl(0.125, 0.07, 'trim', segs=12, bevel=0.02, at=(0, 0, -0.02))
        b.sphere(0.088, 'glow_main', segs=12, rings=6, at=(0, 0, 0.035))
    b.box((0.30, 0.10, 0.045), 'paint', bevel=0.012, at=(0, -0.25, 0.915), rot=(-25, 0, 0))
    b.rod((0.10, 0.16, 0.98), (0.13, 0.24, 1.10), 0.010, 'trim', segs=5, r2=0.005)
    b.box((0.2, 0.12, 0.10), 'hull', bevel=0.02, at=(0, 0.02, 0.57))
    # roof ribs, hatch, side vents, exhaust
    for y, z, tilt in ((-0.10, 1.012, -12), (0.02, 1.036, -12)):
        b.box((0.30, 0.035, 0.03), 'hull', bevel=0.008, at=(0, y, z), rot=(tilt, 0, 0))
    b.cyl(0.06, 0.03, 'trim', segs=8, bevel=0.008, at=(-0.05, 0.17, 0.965), rot=(-34, 0, 0))
    with b.sym():
        for i in range(3):
            b.box((0.012, 0.035, 0.10), 'glow_main', bevel=0, at=(0.212, 0.02 + i * 0.06, 0.80), rot=(15, 0, 0))
        b.cyl(0.035, 0.16, 'trim', segs=6, bevel=0.008, at=(0.12, 0.25, 0.84), rot=(-25, 0, 0))
        b.lathe([(0.03, 0.0), (0.0, 0.10)], 'trim', segs=5, m=aim((0.26, 0.21, 0.40), (0.28, 0.36, 0.44)))
    return m


# ------------------------------------------------------------------ 8. runner
def enemy_runner():
    m = enemy_model('enemy_runner')
    b = m.node('body')
    with b.frames(T(scale=(1, 0.86, 1))):
        b.prism([(-0.48, 0.30), (-0.44, 0.42), (-0.08, 0.56), (0.30, 0.52), (0.47, 0.40), (0.42, 0.28), (-0.20, 0.23)],
                0.26, 'hull', bevel=0.035, plane='yz')
        b.prism([(-0.43, 0.415), (-0.08, 0.575), (0.32, 0.535), (0.45, 0.43), (0.30, 0.50), (-0.08, 0.525)], 0.17,
                'paint', bevel=0.012, plane='yz')
        # head wedge
        b.prism([(-0.68, 0.25), (-0.52, 0.41), (-0.38, 0.41), (-0.36, 0.24), (-0.50, 0.19)], 0.21, 'hull', bevel=0.025,
                plane='yz')
        b.prism([(-0.63, 0.325), (-0.52, 0.425), (-0.38, 0.425), (-0.42, 0.39), (-0.52, 0.39)], 0.15, 'paint',
                bevel=0.008, plane='yz')
        b.box((0.225, 0.045, 0.04), 'glow_main', bevel=0.008, at=(0, -0.615, 0.30), rot=(-45, 0, 0))
        with b.sym():
            b.prism([(-0.76, 0.16), (-0.62, 0.25), (-0.50, 0.20)], 0.03, 'trim', bevel=0.006, plane='yz',
                    at=(0.075, 0, 0))
            b.box((0.015, 0.34, 0.028), 'glow_main', bevel=0, at=(0.131, 0.06, 0.40), rot=(4, 0, 0))
            # front leg
            S, E, P = (0.17, -0.30, 0.36), (0.21, -0.17, 0.19), (0.21, -0.33, 0.045)
            b.cyl(0.095, 0.07, 'paint', segs=10, bevel=0.018, o='c', rot=RIGHT, at=S)
            b.limb(S, E, 0.058, 0.042, 'hull', segs=7, power=3)
            b.limb(E, P, 0.04, 0.028, 'trim', segs=7)
            b.prism([(-0.12, 0.0), (-0.08, 0.05), (0.03, 0.065), (0.05, 0.0)], 0.085, 'hull', bevel=0.012, plane='yz',
                    at=(0.21, -0.33, 0))
            # hind leg
            S, E, P = (0.17, 0.30, 0.38), (0.22, 0.46, 0.23), (0.22, 0.34, 0.045)
            b.cyl(0.105, 0.07, 'paint', segs=10, bevel=0.018, o='c', rot=RIGHT, at=S)
            b.limb(S, E, 0.065, 0.045, 'hull', segs=7, power=3)
            b.limb(E, P, 0.042, 0.028, 'trim', segs=7)
            b.prism([(-0.12, 0.0), (-0.08, 0.05), (0.03, 0.065), (0.05, 0.0)], 0.085, 'hull', bevel=0.012, plane='yz',
                    at=(0.22, 0.34, 0))
        # dorsal blades
        for y, z, s in ((-0.10, 0.555, 1.0), (0.08, 0.555, 1.15), (0.26, 0.535, 0.9)):
            b.prism([(0.0, 0.0), (0.12, 0.0), (0.16, 0.115), (0.11, 0.09)], 0.028, 'trim', bevel=0.006, plane='yz',
                    at=(0, y, z), scale=(1, s, s))
        b.box((0.15, 0.02, 0.05), 'glow_main', bevel=0, at=(0, 0.452, 0.36), rot=(-20, 0, 0))
        b.rod((0, 0.42, 0.44), (0, 0.60, 0.69), 0.011, 'trim', segs=5, r2=0.005)
        b.sphere(0.02, 'glow_main', segs=6, rings=4, at=(0, 0.60, 0.69))
    return m


# ------------------------------------------------------------------ 9. drone (origin = its own centre)
def enemy_drone():
    m = enemy_model('enemy_drone')
    b = m.node('body')
    sc = (0.85, 1.22, 1)
    b.lathe([(0.0, -0.15), (0.12, -0.13), (0.20, -0.05), (0.21, 0.02), (0.15, 0.085), (0.0, 0.10)], 'hull', segs=10,
            scale=sc)
    b.lathe([(0.165, 0.065), (0.13, 0.115), (0.0, 0.135)], 'paint', segs=10, scale=sc)
    b.ring(0.212, 0.02, 0.03, 'trim', segs=10, scale=sc, at=(0, 0, 0.0))
    R = 0.40
    with b.frames(radial(4, start=45)):
        b.box((0.28, 0.055, 0.04), 'hull', bevel=0.012, at=(0.24, 0, 0.03))
        b.box((0.12, 0.062, 0.02), 'paint', bevel=0.006, at=(0.22, 0, 0.055))
        b.cyl(0.05, 0.11, 'trim', segs=8, bevel=0.012, at=(R, 0, -0.03))
        b.torus(0.17, 0.016, 'hull', segs=12, rsegs=4, at=(R, 0, 0.085))
        b.ring(0.172, 0.022, 0.05, 'paint', segs=6, arc=110, phase=-55, at=(R, 0, 0.085))
        b.cyl(0.02, 0.03, 'glow_main', segs=6, at=(R, 0, -0.055))
    for i, ang in enumerate((45, 135, 225, 315)):
        a = math.radians(ang)
        s = m.node(f'spin_{i + 1}', at=(R * math.cos(a), R * math.sin(a), 0.085))
        s.cyl(0.03, 0.045, 'trim', segs=8, bevel=0.008)
        with s.frames(radial(3)):
            s.box((0.125, 0.036, 0.008), 'trim', bevel=0, at=(0.088, 0, 0.025), rot=(14, 0, 0))
    # underslung eye
    b.cyl(0.085, 0.07, 'trim', segs=10, bevel=0.015, at=(0, -0.07, -0.215))
    b.torus(0.092, 0.018, 'paint', segs=12, rsegs=5, at=(0, -0.07, -0.235))
    b.sphere(0.082, 'glow_main', segs=12, rings=6, at=(0, -0.075, -0.245))
    with b.sym():
        b.cyl(0.02, 0.18, 'trim', segs=6, rot=FWD, at=(0.12, -0.14, -0.08))
        b.cyl(0.013, 0.012, 'glow_main', segs=6, rot=FWD, at=(0.12, -0.32, -0.08))
        b.box((0.05, 0.12, 0.05), 'hull', bevel=0.01, at=(0.12, -0.10, -0.075))
        b.rod((0.07, 0.20, 0.05), (0.12, 0.33, 0.26), 0.008, 'trim', segs=4, r2=0.004)
    b.box((0.17, 0.02, 0.04), 'glow_main', bevel=0, at=(0, 0.255, 0.0))
    return m


# ------------------------------------------------------------------ 10. brute
def enemy_brute():
    m = enemy_model('enemy_brute')
    b = m.node('body')
    b.box((0.50, 0.36, 0.28), 'hull', bevel=0.05, taper=(1.25, 1.1), at=(0, 0.02, 0.80))
    b.prism([(-0.14, 0.62), (-0.2, 0.86), (0.2, 0.86), (0.14, 0.62)], 0.06, 'paint', bevel=0.015, plane='xz',
            at=(0, -0.19, 0))
    torso = [(-0.30, 0.92), (-0.54, 1.25), (-0.52, 1.58), (-0.26, 1.76), (0.26, 1.76), (0.52, 1.58), (0.54, 1.25),
             (0.30, 0.92)]
    b.prism(torso, 0.54, 'hull', bevel=0.06, plane='xz', at=(0, 0.04, 0))
    b.prism([(-0.22, 1.02), (-0.42, 1.27), (-0.40, 1.56), (-0.22, 1.69), (0.22, 1.69), (0.40, 1.56), (0.42, 1.27),
             (0.22, 1.02)], 0.10, 'paint', bevel=0.025, plane='xz', at=(0, -0.24, 0))
    # chest core
    with b.frames(T(at=(0, -0.29, 1.36), rot=FWD)):
        b.cyl(0.19, 0.06, 'trim', segs=14, bevel=0.018)
        b.sphere(0.135, 'glow_main', segs=14, rings=6, at=(0, 0, 0.03), scale=(1, 1, 0.5))
        with b.frames(radial(4, start=45)):
            b.box((0.09, 0.035, 0.035), 'hull', bevel=0.008, at=(0.155, 0, 0.06))
    # head
    b.box((0.24, 0.26, 0.19), 'hull', bevel=0.04, taper=(0.8, 0.8), at=(0, -0.10, 1.84))
    b.box((0.20, 0.03, 0.04), 'glow_main', bevel=0.008, at=(0, -0.232, 1.83))
    b.prism([(-0.02, 1.90), (0.16, 1.92), (0.22, 2.0), (0.02, 1.95)], 0.04, 'paint', bevel=0.008, plane='yz')
    with b.sym():
        # legs
        H, K, A = (0.27, 0.02, 0.78), (0.35, -0.10, 0.44), (0.35, 0.05, 0.14)
        b.cyl(0.15, 0.12, 'trim', segs=10, bevel=0.02, o='c', rot=RIGHT, at=(0.30, 0.02, 0.78))
        b.limb(H, K, 0.16, 0.13, 'hull', segs=8, power=3)
        b.box((0.24, 0.10, 0.22), 'paint', bevel=0.03, at=(0.35, -0.2, 0.47), rot=(15, 0, 0))
        b.limb(K, A, 0.14, 0.13, 'hull', segs=8, power=3.5)
        b.prism([(-0.34, 0.0), (-0.30, 0.12), (-0.08, 0.22), (0.16, 0.20), (0.22, 0.0)], 0.30, 'hull', bevel=0.03,
                plane='yz', at=(0.35, 0, 0))
        b.prism([(-0.37, 0.0), (-0.33, 0.09), (-0.20, 0.145), (-0.22, 0.0)], 0.24, 'paint', bevel=0.012, plane='yz',
                at=(0.35, 0, 0))
        # shoulders
        b.lathe([(0.27, -0.04), (0.29, 0.06), (0.24, 0.20), (0.12, 0.29), (0.0, 0.31)], 'paint', segs=10,
                at=(0.56, 0.02, 1.50), rot=(0, 18, 0))
        b.ring(0.275, 0.05, 0.07, 'hull', segs=10, bevel=0.012, at=(0.56, 0.02, 1.47), rot=(0, 18, 0))
        b.lathe([(0.05, 0.0), (0.0, 0.14)], 'trim', segs=6, at=(0.67, 0.02, 1.78), rot=(0, 30, 0))
        # arms
        S, E, W = (0.60, 0.02, 1.44), (0.66, 0.04, 1.02), (0.63, -0.16, 0.66)
        b.limb(S, E, 0.13, 0.11, 'hull', segs=8, power=3)
        b.cyl(0.12, 0.2, 'trim', segs=8, bevel=0.02, o='c', rot=RIGHT, at=E)
        b.limb(E, W, 0.14, 0.17, 'hull', segs=8, power=4, bulge=1.05)
        b.box((0.07, 0.24, 0.30), 'paint', bevel=0.02, m=aim(E, W, (1, 0, 0)), at=(0, 0.14, 0.24), rot=(0, 0, 90))
        b.box((0.02, 0.05, 0.22), 'glow_main', bevel=0, m=aim(E, W, (1, 0, 0)), at=(0, 0.176, 0.24), rot=(0, 0, 90))
        # fists
        b.box((0.30, 0.32, 0.28), 'hull', bevel=0.06, at=(0.63, -0.23, 0.49), rot=(25, 0, 0))
        for dx in (-0.09, 0.0, 0.09):
            b.box((0.075, 0.10, 0.10), 'trim', bevel=0.02, at=(0.63 + dx, -0.37, 0.40), rot=(25, 0, 0))
        # exhaust stacks
        b.cyl(0.07, 0.36, 'trim', segs=8, bevel=0.012, at=(0.22, 0.30, 1.62), rot=(-8, 0, 0))
        b.cyl(0.05, 0.02, 'glow_main', segs=8, at=(0.22, 0.352, 1.975), rot=(-8, 0, 0))
        b.box((0.03, 0.02, 0.16), 'glow_main', bevel=0, at=(0.12, 0.318, 1.32))
    b.box((0.44, 0.16, 0.50), 'hull', bevel=0.05, at=(0, 0.33, 1.35))
    b.box((0.26, 0.03, 0.05), 'glow_main', bevel=0, at=(0, 0.412, 1.50))
    b.box((0.30, 0.04, 0.22), 'paint', bevel=0.012, at=(0, 0.405, 1.28))
    return m


# ------------------------------------------------------------------ 11. shield unit
def enemy_shield():
    m = enemy_model('enemy_shield')
    b = m.node('body')
    b.lathe([(0.0, 0.36), (0.18, 0.38), (0.33, 0.50), (0.36, 0.66), (0.30, 0.84), (0.20, 0.90), (0.0, 0.90)], 'hull',
            segs=12)
    b.ring(0.355, 0.03, 0.05, 'glow_main', segs=12, at=(0, 0, 0.64))
    b.lathe([(0.31, 0.72), (0.34, 0.74), (0.285, 0.875), (0.21, 0.925), (0.19, 0.91)], 'paint', segs=12)
    # tripod legs
    with b.frames(radial(3, start=90)):
        Hh, K, F = (0.27, 0, 0.56), (0.60, 0, 0.74), (0.72, 0, 0.06)
        b.cyl(0.10, 0.16, 'trim', segs=8, bevel=0.02, o='c', rot=(90, 0, 0), at=(0.31, 0, 0.56))
        b.limb(Hh, K, 0.075, 0.06, 'hull', segs=7, power=3, up=(0, 0, 1))
        b.cyl(0.08, 0.14, 'trim', segs=8, bevel=0.015, o='c', rot=(90, 0, 0), at=K)
        b.prism([(0.54, 0.80), (0.68, 0.76), (0.78, 0.10), (0.74, 0.0), (0.66, 0.0), (0.62, 0.40)], 0.09, 'hull',
                bevel=0.018, plane='xz')
        b.prism([(0.60, 0.84), (0.72, 0.78), (0.80, 0.34), (0.755, 0.34)], 0.12, 'paint', bevel=0.012, plane='xz')
        b.box((0.015, 0.03, 0.26), 'glow_main', bevel=0, at=(0.785, 0, 0.52), rot=(0, 9, 0))
        b.prism([(0.60, 0.0), (0.64, 0.07), (0.80, 0.07), (0.88, 0.0)], 0.16, 'trim', bevel=0.012, plane='xz')
    # armour skirts between legs
    with b.frames(radial(3, start=30)):
        b.box((0.05, 0.30, 0.20), 'paint', bevel=0.02, at=(0.36, 0, 0.52), rot=(0, 12, 0))
        b.box((0.02, 0.16, 0.03), 'glow_main', bevel=0, at=(0.392, 0, 0.50), rot=(0, 12, 0))
    # eye (front = -Y)
    b.cyl(0.085, 0.05, 'trim', segs=10, bevel=0.012, rot=FWD, at=(0, -0.335, 0.72))
    b.sphere(0.06, 'glow_main', segs=10, rings=5, at=(0, -0.385, 0.72))
    # emitter column
    b.cyl(0.11, 0.26, 'trim', segs=10, bevel=0.015, at=(0, 0, 0.90))
    for z in (0.97, 1.04, 1.11):
        b.ring(0.115, 0.03, 0.03, 'glow_main', segs=10, at=(0, 0, z))
    b.cyl(0.15, 0.04, 'hull', segs=10, bevel=0.01, at=(0, 0, 1.15))

    s = m.node('spin_1', at=(0, 0, 1.20))
    s.cyl(0.10, 0.07, 'hull', segs=10, bevel=0.015)
    s.lathe([(0.06, 0.07), (0.03, 0.14), (0.0, 0.20)], 'glow_main', segs=8)
    s.ring(0.44, 0.07, 0.06, 'hull', segs=24, bevel=0.015, at=(0, 0, 0.04))
    s.ring(0.44, 0.03, 0.02, 'glow_main', segs=24, at=(0, 0, 0.075))
    with s.frames(radial(3, start=30)):
        s.box((0.36, 0.045, 0.03), 'trim', bevel=0.008, at=(0.25, 0, 0.04))
    with s.frames(radial(6)):
        s.box((0.10, 0.12, 0.10), 'paint', bevel=0.02, at=(0.455, 0, 0.04))
        s.prism([(0.0, 0.0), (0.05, 0.0), (0.03, 0.12), (0.0, 0.10)], 0.05, 'glow_main', bevel=0.006, plane='xz',
                at=(0.44, 0, 0.08))
    return m


# ------------------------------------------------------------------ 12. boss
def enemy_boss():
    m = enemy_model('enemy_boss')
    b = m.node('body')
    # main hull (elongated front-back)
    b.loft([(1.18, 0.0, 0.0), (1.22, 0.55, 0.75), (1.45, 1.04, 1.24), (1.72, 1.15, 1.36), (1.98, 1.04, 1.25),
            (2.14, 0.62, 0.92), (2.16, 0.0, 0.0)], 'hull', segs=12, power=2.6, sharp=40)
    b.loft([(1.69, 1.17, 1.38), (1.76, 1.18, 1.39), (1.83, 1.14, 1.34)], 'trim', segs=12, power=2.6)
    b.loft([(2.00, 0.90, 1.20), (2.16, 0.60, 0.90), (2.20, 0.40, 0.66), (2.20, 0.0, 0.0)], 'paint', segs=12, power=2.6,
           at=(0, 0, 0.012))
    # belly reactor vents + belly gun
    b.lathe([(0.30, 1.22), (0.34, 1.12), (0.24, 1.02), (0.0, 1.0)], 'trim', segs=10)
    b.ring(0.30, 0.05, 0.03, 'glow_main', segs=10, at=(0, 0, 1.10))
    with b.sym():
        for y in (-0.5, 0.0, 0.5):
            b.box((0.03, 0.26, 0.07), 'glow_main', bevel=0, at=(1.11 - abs(y) * 0.14, y, 1.58), rot=(0, -20, 0))
    # legs
    hip = [(1.30, 0, 1.70), (1.52, 0, 2.52), (2.0, 0, 0.0)]
    frames = [rotz(a) @ T(at=(-0.20, 0, 0)) for a in (-48, 0, 48, 132, 180, 228)]
    with b.frames(frames):
        Hh, K, _ = hip
        b.sphere(0.24, 'trim', segs=10, rings=6, at=Hh)
        b.limb(Hh, K, 0.21, 0.18, 'hull', segs=8, power=3, up=(0, 0, 1))
        b.prism([(1.22, 1.98), (1.50, 2.44), (1.40, 2.66), (1.10, 2.16)], 0.36, 'paint', bevel=0.02, plane='xz')
        b.cyl(0.24, 0.40, 'trim', segs=10, bevel=0.03, o='c', rot=(90, 0, 0), at=K)
        b.cyl(0.10, 0.02, 'glow_main', segs=8, o='c', rot=(90, 0, 0), at=(K[0], -0.205, K[2]))
        b.cyl(0.10, 0.02, 'glow_main', segs=8, o='c', rot=(90, 0, 0), at=(K[0], 0.205, K[2]))
        b.prism([(1.36, 2.64), (1.70, 2.56), (2.08, 0.34), (2.05, 0.10), (1.88, 0.10), (1.72, 1.00), (1.40, 2.28)],
                0.30, 'hull', bevel=0.03, plane='xz')
        b.prism([(1.60, 2.74), (1.78, 2.58), (2.13, 0.80), (2.06, 0.74), (1.72, 2.30)], 0.38, 'paint', bevel=0.02,
                plane='xz')
        b.box((0.03, 0.07, 0.80), 'glow_main', bevel=0, at=(2.0, 0, 1.42), rot=(0, 11.2, 0))
        b.lathe([(0.25, 0.36), (0.28, 0.24), (0.13, 0.06), (0.0, 0.0)], 'trim', segs=8, at=(1.97, 0, 0))
        b.rod((0.95, 0, 2.02), (1.30, 0, 2.36), 0.045, 'trim', segs=6)
    # reactor (rear top)
    RC = (0, 0.42, 2.52)
    b.lathe([(0.60, 2.10), (0.64, 2.16), (0.56, 2.26), (0.40, 2.30), (0.0, 2.30)], 'trim', segs=14, at=(0, 0.42, 0))
    b.sphere(0.46, 'glow_main', segs=16, rings=10, at=RC)
    with b.frames(T(at=RC) @ rotz(45)):
        with b.frames(radial(4)):
            b.prism([(0.42, -0.30), (0.58, -0.28), (0.66, 0.10), (0.52, 0.48), (0.20, 0.64), (0.16, 0.56),
                     (0.44, 0.40), (0.55, 0.08), (0.50, -0.20)], 0.09, 'hull', bevel=0.015, plane='xz')
    b.cyl(0.20, 0.10, 'hull', segs=10, bevel=0.02, at=(0, 0.42, 3.06))
    b.cyl(0.10, 0.03, 'glow_main', segs=10, at=(0, 0.42, 3.16))
    s = m.node('spin_1', at=RC)
    s.ring(0.80, 0.10, 0.12, 'hull', segs=24, bevel=0.025)
    s.ring(0.745, 0.02, 0.05, 'glow_main', segs=24)
    with s.frames(radial(4)):
        s.box((0.20, 0.22, 0.20), 'paint', bevel=0.035, at=(0.84, 0, 0))
        s.box((0.03, 0.12, 0.08), 'glow_main', bevel=0, at=(0.945, 0, 0))
        s.prism([(0.0, 0.08), (0.10, 0.08), (0.02, 0.34)], 0.05, 'trim', bevel=0.008, plane='xz', at=(0.78, 0, 0))
    # side armour + rear abdomen
    with b.frames([rotz(a) for a in (-24, 24, 156, 204)]):
        b.box((0.12, 0.50, 0.36), 'paint', bevel=0.04, at=(1.17, 0, 1.76), rot=(0, -6, 0))
        b.lathe([(0.07, 0.0), (0.0, 0.22)], 'trim', segs=6, rot=RIGHT, at=(1.2, 0, 1.80))
    b.sphere(1.0, 'hull', segs=12, rings=7, at=(0, 1.35, 1.72), scale=(0.66, 0.62, 0.50))
    b.sphere(1.0, 'paint', segs=12, rings=7, at=(0, 1.40, 1.86), scale=(0.52, 0.50, 0.40))
    # head
    HC = T(at=(0, -1.5, 1.7)) @ T(scale=1.22) @ T(at=(0, 1.5, -1.7))
    b.stack.append([f @ HC for f in b.stack[-1]])
    head = [(-1.86, 1.50), (-1.92, 1.66), (-1.74, 1.92), (-1.20, 2.02), (-1.10, 1.40), (-1.50, 1.32)]
    b.prism(head, 0.80, 'hull', bevel=0.06, plane='yz')
    b.prism([(-1.93, 1.68), (-1.74, 1.95), (-1.22, 2.05), (-1.24, 1.97), (-1.70, 1.86), (-1.84, 1.68)], 0.66, 'paint',
            bevel=0.02, plane='yz')
    with b.sym():
        b.sphere(0.085, 'glow_main', segs=10, rings=5, at=(0.20, -1.86, 1.62), scale=(1.3, 0.6, 0.8))
        b.sphere(0.05, 'glow_main', segs=8, rings=4, at=(0.34, -1.80, 1.74), scale=(1.2, 0.6, 0.8))
        b.prism([(-2.14, 1.22), (-1.86, 1.50), (-1.60, 1.40), (-1.66, 1.30), (-1.84, 1.34)], 0.07, 'trim', bevel=0.012,
                plane='yz', at=(0.22, 0, 0))
        b.box((0.06, 0.40, 0.30), 'paint', bevel=0.02, at=(0.42, -1.48, 1.68), rot=(0, 0, 4))
    b.stack.pop()
    with b.sym():
        # rear pylons with glow tips (total height 3.4)
        b.prism([(1.00, 1.90), (1.30, 1.80), (1.50, 2.90), (1.44, 3.24), (1.36, 2.90), (1.14, 2.14)], 0.10, 'hull',
                bevel=0.02, plane='yz', at=(0.62, 0.15, 0))
        b.prism([(1.32, 1.84), (1.54, 2.90), (1.49, 2.94), (1.25, 1.90)], 0.14, 'paint', bevel=0.012, plane='yz',
                at=(0.62, 0.15, 0))
        b.box((0.26, 0.5, 0.3), 'hull', bevel=0.05, at=(0.62, 1.12, 1.82))
        b.rod((0.62, 1.59, 3.18), (0.62, 1.62, 3.38), 0.016, 'trim', segs=5, r2=0.008)
        b.sphere(0.035, 'glow_main', segs=6, rings=4, at=(0.62, 1.62, 3.38))
        b.box((0.20, 0.04, 0.10), 'glow_main', bevel=0, at=(0.24, 1.915, 1.70))
    # head cannon
    b.box((0.56, 0.70, 0.36), 'hull', bevel=0.07, at=(0, -1.10, 2.14))
    b.box((0.40, 0.50, 0.06), 'paint', bevel=0.02, at=(0, -1.08, 2.34))
    with b.frames(T(at=(0, -1.36, 2.16), rot=(93, 0, 0), scale=(1.3, 1.3, 1.0))):
        b.cyl(0.17, 0.40, 'trim', segs=12, bevel=0.03)
        b.cyl(0.12, 1.10, 'hull', segs=12)
        for z in (0.52, 0.66, 0.80):
            b.ring(0.125, 0.04, 0.05, 'glow_main', segs=12, at=(0, 0, z))
        b.lathe([(0.12, 1.02), (0.19, 1.06), (0.19, 1.24), (0.15, 1.26), (0.10, 1.26), (0.10, 1.18), (0.0, 1.18)],
                'trim', segs=12)
        b.cyl(0.10, 0.02, 'glow_main', segs=12, at=(0, 0, 1.185))
        with b.sym():
            b.box((0.05, 0.05, 0.60), 'paint', bevel=0.012, at=(0.15, 0, 0.64))
    return m


ENEMIES = [enemy_grunt, enemy_runner, enemy_drone, enemy_brute, enemy_shield, enemy_boss]
