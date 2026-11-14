"""VOLTSPIRE hero: "Kestrel", stylised cyber-archer at full draw, aiming to the front (-Y)."""
import math
import bmesh
from vs_lib import *

MIRROR_Z = Matrix.Diagonal((1, 1, -1, 1))


def _hood():
    """Open-faced hood: a shell cut from a sphere, with a peaked back and a small brim."""
    bm = sphere(1.0, segs=14, rings=10)
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        if (-c.y > 0.30 and c.z < 0.62) or c.z < -0.78:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    for v in bm.verts:
        x, y, z = v.co
        if y > 0:                       # pointed, slightly drooping back
            v.co.y = y * (1.0 + 0.95 * y * max(0.0, 1 - abs(z - 0.35)))
            v.co.z = z - 0.10 * y * y
        if z > 0.45 and y < 0:          # brim over the visor
            v.co.y = y - 0.30 * (z - 0.45) * (-y)
        if z < -0.3:                    # flare towards the shoulders
            v.co.x *= 1.0 + 0.5 * (-z - 0.3)
            v.co.y *= 1.0 + 0.3 * (-z - 0.3)
    return shell(bm, 0.09)


def _cape(a0, a1, rows, cols=10, jag=0.04):
    """Half cape: grid swept around the back. rows = (z, rx, ry, yshift). Angle 0 = straight back (+Y),
    positive angles go to the character's left (+X)."""
    bm = bmesh.new()
    grid = []
    hem = []
    for j, (z, rx, ry, ys) in enumerate(rows):
        row = []
        last = j == len(rows) - 1
        f = j / (len(rows) - 1)
        for i in range(cols + 1):
            a = math.radians(a0 + (a1 - a0) * i / cols)
            wave = 1.0 + 0.07 * f * math.sin(a * 4.0 + 0.6)
            zz = z + (jag * (1 if i % 2 else -1) if last else 0.0)
            p = (rx * wave * math.sin(a), ry * wave * math.cos(a) + ys, zz)
            row.append(bm.verts.new(p))
            if last:
                hem.append(p)
        grid.append(row)
    for r0, r1 in zip(grid, grid[1:]):
        for i in range(cols):
            bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
    return shell(bm, 0.014), hem


def fat(rings, k, kz=1.0):
    return [(r[0] * kz, r[1] * k, r[2] * k) + tuple(v * k for v in r[3:]) for r in rings]


def hero():
    m = Model('hero', {'hull': ('#1c2a52', 0.45, 0.5), 'paint': '#d8fff6', 'glow_main': '#19e3ff',
                       'glow_bow': '#19e3ff'})
    b = m.node('body')
    TOR = rotz(-70)      # torso: left shoulder towards the target
    PEL = rotz(-40)

    def tw(p):
        return tuple(TOR @ Vector(p))

    def pw(p):
        return tuple(PEL @ Vector(p))

    GRIP = Vector((-0.05, -0.74, 1.47))             # bow hand
    NOCK = GRIP + Vector((-0.024, 0.715, 0.055))    # string hand / arrow nock

    # ---------------------------------------------------------------- pelvis + legs
    with b.frames(PEL):
        b.loft([(0.84, 0.07, 0.07), (0.89, 0.145, 0.10), (0.97, 0.155, 0.108), (1.03, 0.135, 0.095)], 'hull', segs=12,
               power=2.4)
        b.loft([(0.985, 0.163, 0.116), (1.005, 0.169, 0.121), (1.045, 0.150, 0.106)], 'paint', segs=12, power=2.4)
        b.box((0.06, 0.03, 0.05), 'glow_main', bevel=0.01, at=(0, -0.122, 1.012))
        b.prism([(-0.065, 1.0), (0.065, 1.0), (0.05, 0.74), (0.0, 0.67), (-0.05, 0.74)], 0.018, 'paint', bevel=0.006,
                plane='xz', at=(0, -0.118, 0), rot=(-5, 0, 0))
        b.prism([(-0.02, 0.96), (0.02, 0.96), (0.015, 0.78), (0.0, 0.75), (-0.015, 0.78)], 0.012, 'glow_main',
                plane='xz', at=(0, -0.131, 0), rot=(-5, 0, 0))
        b.prism([(-0.08, 1.0), (0.08, 1.0), (0.06, 0.70), (0.0, 0.62), (-0.06, 0.70)], 0.018, 'hull', bevel=0.006,
                plane='xz', at=(0, 0.105, 0), rot=(6, 0, 0))
        with b.sym():
            b.box((0.03, 0.14, 0.21), 'paint', bevel=0.012, taper=(1, 0.6), at=(0.168, 0.0, 0.90), rot=(0, 188, 0))
    feet = {1: ((0.10, -0.25, 0.09), -8), -1: ((-0.13, 0.27, 0.09), -78)}
    for side in (1, -1):
        hip = pw((0.085 * side, 0, 0.92))
        ank, yaw = feet[side]
        knee = ik2(hip, ank, 0.45, 0.44, (0.15 * side, -1, 0.1))
        up = (0, -1, 0)
        with b.frames(aim(hip, knee, up)):
            b.loft(fat([(0.0, 0.07, 0.075), (0.06, 0.086, 0.092), (0.22, 0.076, 0.082), (0.38, 0.058, 0.062),
                        (0.45, 0.05, 0.054)], 1.14), 'hull', segs=10)
            b.box((0.024, 0.10, 0.17), 'paint', bevel=0.008, at=(0.094 * side, 0.0, 0.17))
            b.box((0.10, 0.02, 0.035), 'paint', bevel=0.006, at=(0, 0.088, 0.30))
        with b.frames(aim(knee, ank, up)):
            b.box((0.095, 0.055, 0.12), 'paint', bevel=0.02, at=(0, 0.052, 0.0))
            b.loft(fat([(0.0, 0.054, 0.057), (0.10, 0.062, 0.07, 0, -0.008), (0.30, 0.045, 0.048),
                        (0.44, 0.04, 0.043)], 1.14), 'hull', segs=10)
            b.loft(fat([(0.06, 0.05, 0.03, 0, 0.036), (0.2, 0.052, 0.034, 0, 0.03), (0.41, 0.042, 0.03, 0, 0.022)],
                       1.14), 'paint', segs=8, power=3)
            b.box((0.014, 0.012, 0.22), 'glow_main', bevel=0, at=(0, 0.071, 0.23), rot=(-2, 0, 0))
        with b.frames(T(at=(ank[0], ank[1], 0), rot=(0, 0, yaw))):
            b.prism([(-0.19, 0.0), (-0.20, 0.035), (-0.10, 0.085), (0.0, 0.135), (0.07, 0.135), (0.085, 0.05),
                     (0.08, 0.0)], 0.09, 'hull', bevel=0.015, plane='yz')
            b.prism([(-0.205, 0.0), (-0.215, 0.04), (-0.12, 0.092), (-0.09, 0.075), (-0.12, 0.0)], 0.098, 'paint',
                    bevel=0.008, plane='yz')
            b.box((0.10, 0.03, 0.06), 'paint', bevel=0.01, at=(0, 0.085, 0.07))

    # ---------------------------------------------------------------- torso
    with b.frames(TOR):
        b.loft([(1.01, 0.13, 0.092), (1.10, 0.118, 0.085), (1.22, 0.15, 0.10), (1.36, 0.185, 0.115),
                (1.44, 0.175, 0.105), (1.49, 0.09, 0.075), (1.53, 0.055, 0.055)], 'hull', segs=14, power=2.3)
        b.loft([(1.20, 0.10, 0.05, 0, -0.058), (1.28, 0.16, 0.075, 0, -0.052), (1.38, 0.176, 0.08, 0, -0.05),
                (1.445, 0.14, 0.06, 0, -0.052)], 'paint', segs=12, power=2.6)
        b.prism([(0.0, 1.375), (0.036, 1.325), (0.0, 1.27), (-0.036, 1.325)], 0.02, 'glow_main', plane='xz',
                at=(0, -0.134, 0))
        for z, w in ((1.145, 0.15), (1.09, 0.13)):
            b.box((w, 0.02, 0.036), 'paint', bevel=0.008, at=(0, -0.083, z))
        # cowl round the neck / shoulders
        b.loft([(1.435, 0.205, 0.135), (1.475, 0.17, 0.125), (1.52, 0.115, 0.105), (1.555, 0.095, 0.10)], 'paint',
               segs=12, power=2.2)
        # half cape over the bow-arm shoulder
        cape, hem = _cape(-55, 100, [(1.50, 0.10, 0.09, 0.0), (1.44, 0.215, 0.15, 0.0), (1.32, 0.235, 0.175, 0.01),
                                     (1.15, 0.25, 0.20, 0.03), (0.98, 0.27, 0.235, 0.06), (0.83, 0.30, 0.27, 0.10)])
        b.add(cape, 'hull', sharp=75)
        mantle, _ = _cape(-62, 106, [(1.51, 0.105, 0.095, 0.0), (1.455, 0.222, 0.156, 0.0), (1.36, 0.245, 0.182, 0.008),
                                     (1.30, 0.25, 0.19, 0.012)], jag=0.018)
        b.add(mantle, 'paint', sharp=75)
        b.tube([(p[0] * 1.02, p[1] * 1.02, p[2]) for p in hem], 0.009, 'glow_main', segs=4)
        # quiver across the back (worn over the cape, top above the right shoulder)
        Q0, Q1 = (0.10, 0.25, 1.02), (-0.15, 0.24, 1.50)
        with b.frames(aim(Q0, Q1, (0, 1, 0))):
            L = dist(Q0, Q1)
            b.cyl(0.058, L, 'paint', segs=10, bevel=0.012)
            for z in (0.05, L - 0.08):
                b.cyl(0.065, 0.045, 'hull', segs=10, bevel=0.01, at=(0, 0, z))
            b.box((0.016, 0.012, L * 0.5), 'glow_main', bevel=0, at=(0, 0.058, L * 0.5))
            for dx, dy, dz in ((0.022, 0.015, 0.16), (-0.02, 0.02, 0.13), (0.0, -0.022, 0.18), (-0.01, 0.0, 0.10)):
                b.cyl(0.007, dz + 0.05, 'hull', segs=5, at=(dx, dy, L - 0.05))
                b.box((0.03, 0.006, 0.055), 'glow_main', bevel=0, at=(dx, dy, L + dz - 0.03), rot=(0, 0, dx * 2000))
        b.box((0.09, 0.05, 0.12), 'hull', bevel=0.015, at=(-0.03, 0.2, 1.28))
    # ---------------------------------------------------------------- head (faces the target)
    b.cyl(0.05, 0.09, 'hull', segs=10, at=(0, 0, 1.49))
    with b.frames(T(at=(0, -0.012, 0))):
        b.loft([(1.53, 0.05, 0.055, 0, -0.005), (1.57, 0.08, 0.09), (1.63, 0.095, 0.108), (1.69, 0.09, 0.102),
                (1.725, 0.06, 0.07), (1.74, 0.0, 0.0)], 'hull', segs=14)

        def arc(a0, a1, n, rxo, ryo, rxi, ryi):
            angs = [math.radians(a0 + (a1 - a0) * i / n) for i in range(n + 1)]
            return [(rxo * math.sin(a), -ryo * math.cos(a)) for a in angs] + \
                   [(rxi * math.sin(a), -ryi * math.cos(a)) for a in reversed(angs)]
        b.prism(arc(-68, 68, 8, 0.104, 0.119, 0.07, 0.08), 0.042, 'glow_main', bevel=0.006, at=(0, 0, 1.64))
        b.prism(arc(-50, 50, 6, 0.093, 0.107, 0.06, 0.07), 0.055, 'paint', bevel=0.008, at=(0, 0, 1.582))
        b.add(_hood(), 'paint', at=(0, 0.022, 1.652), scale=(0.132, 0.142, 0.132), sharp=75)
    # ---------------------------------------------------------------- arms
    LS, RS = Vector(tw((0.20, 0, 1.445))), Vector(tw((-0.20, 0, 1.445)))
    dl = (GRIP - LS).normalized()
    lw = LS + dl * 0.505
    le = Vector(ik2(LS, lw, 0.265, 0.25, (0.4, 0, -1)))
    rw = NOCK + Vector((-0.012, 0.045, 0.0))
    re = Vector(ik2(RS, rw, 0.27, 0.25, (-0.7, 0.8, 0.4)))
    for side, S, E, W in ((1, LS, le, lw), (-1, RS, re, rw)):
        out = Vector(tw((side, 0, 0)))
        with b.frames(aim(S, E, (0, 0, 1))):
            b.loft(fat([(0.0, 0.048, 0.048), (0.06, 0.056, 0.056), (0.20, 0.047, 0.047), (dist(S, E), 0.04, 0.04)],
                       1.12), 'hull', segs=9)
            b.loft(fat([(0.10, 0.052, 0.03, 0, 0.03), (0.21, 0.045, 0.026, 0, 0.026)], 1.12), 'paint', segs=8, power=3)
        b.sphere(0.05, 'hull', segs=9, rings=5, at=E)
        with b.frames(aim(E, W, (0, 0, 1))):
            L = dist(E, W)
            b.loft(fat([(0.0, 0.04, 0.04), (0.07, 0.047, 0.047), (0.2, 0.036, 0.036), (L, 0.03, 0.03)], 1.12), 'hull',
                   segs=9)
            b.loft(fat([(0.045, 0.049, 0.049), (0.10, 0.055, 0.055), (0.20, 0.043, 0.043), (0.22, 0.038, 0.038)],
                       1.13), 'paint', segs=9, power=2.8)
            b.box((0.014, 0.012, 0.11), 'glow_main', bevel=0, at=(0, 0.057, 0.14), rot=(-4, 0, 0))
        # pauldron (bigger, layered on the bow arm)
        k = 1.0 if side == 1 else 0.8
        pm = aim(S + Vector((0, 0, -0.005)), S + out * 0.6 + Vector((0, 0, 1.0)), (0, 0, 1))
        b.lathe([(0.088 * k, -0.045), (0.094 * k, 0.0), (0.075 * k, 0.05), (0.04 * k, 0.078), (0.0, 0.086)], 'paint',
                segs=10, m=pm)
        if side == 1:
            b.lathe([(0.10, -0.075), (0.108, -0.04), (0.10, -0.01), (0.07, 0.0)], 'hull', segs=10, m=pm)
            b.sphere(0.018, 'glow_main', segs=6, rings=4, m=pm, at=(0, 0, 0.086))
    # hands
    b.box((0.06, 0.055, 0.09), 'hull', bevel=0.016, at=tuple(GRIP))
    b.box((0.066, 0.03, 0.05), 'paint', bevel=0.01, at=tuple(GRIP + Vector((0, -0.022, 0.012))))
    b.box((0.045, 0.085, 0.06), 'hull', bevel=0.014, at=tuple(NOCK + Vector((-0.012, 0.015, -0.005))))
    b.box((0.05, 0.04, 0.035), 'paint', bevel=0.008, at=tuple(NOCK + Vector((-0.014, 0.03, 0.022))))

    # ---------------------------------------------------------------- bow (own node, origin at the grip)
    w = m.node('bow', at=tuple(GRIP))
    riser = [(-0.035, -0.17), (-0.062, -0.11), (-0.024, -0.05), (-0.024, 0.05), (-0.062, 0.11), (-0.035, 0.17),
             (0.02, 0.185), (0.03, 0.07), (0.018, 0.0), (0.03, -0.07), (0.02, -0.185)]
    w.prism(riser, 0.036, 'hull', bevel=0.006, plane='yz')
    BS = T(scale=(1, 0.92, 0.86))
    with w.frames([BS, MIRROR_Z @ BS]):
        with w.sym():
            w.box((0.008, 0.06, 0.085), 'paint', bevel=0.003, at=(0.02, -0.02, 0.12))
        limb = [(0, -0.01, 0.165), (0, 0.0, 0.30), (0, 0.04, 0.44), (0, 0.10, 0.56), (0, 0.15, 0.64), (0, 0.14, 0.70)]
        w.tube(limb, [0.021, 0.02, 0.018, 0.015, 0.013, 0.011], 'paint', segs=6, scale=(1.7, 1, 1))
        w.tube([(0, p[1] - 0.018, p[2]) for p in limb[:5]], 0.0075, 'glow_bow', segs=4)
        w.cyl(0.038, 0.034, 'hull', segs=10, bevel=0.008, o='c', rot=RIGHT, at=(0, 0.142, 0.675))
        w.cyl(0.02, 0.042, 'glow_bow', segs=8, o='c', rot=RIGHT, at=(0, 0.142, 0.675))
        w.prism([(0.12, 0.69), (0.15, 0.70), (0.105, 0.775)], 0.02, 'glow_bow', bevel=0.004, plane='yz')
    nock = NOCK - GRIP
    w.tube([(0, 0.142 * 0.92, 0.70 * 0.86), tuple(nock), (0, 0.142 * 0.92, -0.70 * 0.86)], 0.005, 'glow_bow', segs=4)
    w.rod((nock.x, nock.y + 0.02, nock.z), (nock.x, -0.24, nock.z), 0.0075, 'glow_bow', segs=5)
    w.lathe([(0.0, -0.01), (0.024, 0.0), (0.0, 0.09)], 'glow_bow', segs=6, rot=FWD, at=(nock.x, -0.24, nock.z))
    with w.frames(T(at=(nock.x, nock.y - 0.07, nock.z))):
        w.box((0.004, 0.07, 0.04), 'glow_bow', bevel=0, rot=(0, 45, 0))
        w.box((0.004, 0.07, 0.04), 'glow_bow', bevel=0, rot=(0, -45, 0))
    w.rod((0, -0.04, -0.10), (0, -0.27, -0.125), 0.011, 'hull', segs=6)
    w.cyl(0.018, 0.05, 'paint', segs=6, bevel=0.005, rot=FWD, at=(0, -0.26, -0.124))
    w.cyl(0.012, 0.012, 'glow_bow', segs=6, rot=FWD, at=(0, -0.31, -0.124))
    w.torus(0.022, 0.005, 'paint', segs=10, rsegs=4, rot=FWD, at=(0.034, -0.05, 0.10))
    w.box((0.02, 0.01, 0.01), 'hull', bevel=0, at=(0.022, -0.05, 0.10))
    return m


HERO = [hero]
