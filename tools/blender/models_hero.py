"""VOLTSPIRE hero: "Kestrel", a lean hooded ranger at full draw, aiming to the front (-Y).

Seen in game from behind / above at ~5 m, so the back carries the design: a pointed cloth hood, a
shoulder mantle, a long asymmetric half-cloak over the draw-side shoulder, an exposed armoured spine
with a thin glow line and a back quiver.  Dark layered armour over a navy bodysuit; glow is limited
to the visor slit, the spine, the bracers, the arrow nocks and the bow.
"""
import math
import bmesh
from vs_lib import *

MIRROR_Z = Matrix.Diagonal((1, 1, -1, 1))


def _lerp_keys(keys, t):
    """Piecewise smooth interpolation through (t, value) keys."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            u = (t - t0) / (t1 - t0)
            u = u * u * (3 - 2 * u)
            return v0 + (v1 - v0) * u
    return keys[-1][1]


def _hood():
    """Loose cloth hood: open face with an overhanging brim, a pointed drape falling down the back
    and a flared collar that sinks into the shoulder mantle. Unit-sphere space, front = -Y."""
    bm = sphere(1.0, segs=14, rings=11)
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        if (-c.y > 0.34 and c.z < 0.60 and abs(c.x) < 0.80) or c.z < -0.80:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    tip = Vector((0, 0.93, 0.36)).normalized()
    for v in bm.verts:
        d = v.co.normalized()
        x, y, z = v.co
        # soft cloth creases running front to back
        a = math.atan2(x, z)
        v.co *= 1.0 + 0.055 * math.sin(a * 5.0) * max(0.0, y + 0.2)
        # pointed drape: pull the back of the crown out and let it hang
        w = max(0.0, (d.dot(tip) - 0.50) / 0.50)
        v.co += Vector((0.0, 0.70, -1.75)) * (w ** 1.7) + Vector((0.0, 0.20, 0.0)) * w
        v.co.x *= 1.0 - 0.72 * min(1.0, w * 1.25) ** 1.2          # pinch the drape into a point
        if y > 0.2 and z > -0.2:                                   # centre seam ridge over the crown
            v.co *= 1.0 + 0.05 * max(0.0, 1.0 - abs(x) / 0.22)
        if z > 0.40 and y < 0:          # brim reaching over the face
            v.co.y -= 0.42 * (z - 0.40) * (-y)
            v.co.z -= 0.10 * (z - 0.40) * (-y)
        if y < -0.2 and z <= 0.6:       # cheeks of the opening close in a little
            v.co.x *= 0.94
        if z < -0.25:                   # collar flare
            k = (-z - 0.25)
            v.co.x *= 1.0 + 0.55 * k
            v.co.y *= 1.0 + 0.35 * k
    lay = bm.faces.layers.int.new('band')
    for f in bm.faces:      # hem round the face opening and the collar
        if any(e.is_boundary for e in f.edges):
            f[lay] = 1
    return shell(bm, 0.07)


def _cloth(a0, a1, rows, cols=18, hem=None, hang_from=2, folds=5.0, amp=0.10, jag=0.03, thick=0.012,
           edge_cols=()):
    """Hanging cloth swept round the body. rows = (z, rx, ry, sx, sy): ellipse radii + centre shift.
    Angle 0 = straight back (+Y), positive angles go to the character's left (+X).
    hem: (t, z) keys along the sweep giving the hem height (asymmetric cut)."""
    bm = bmesh.new()
    grid = []
    n = len(rows)
    z_ref = rows[hang_from][0]
    z_end = rows[-1][0]
    for j, (z, rx, ry, sx, sy) in enumerate(rows):
        row = []
        f = j / (n - 1)
        for i in range(cols + 1):
            t = i / cols
            a = math.radians(a0 + (a1 - a0) * t)
            s = math.sin(folds * t * 2 * PI + 1.1 * f + 0.4)
            fold = math.copysign(abs(s) ** 0.75, s) * 0.75 + 0.25 * math.sin(2.3 * folds * t * 2 * PI + 1.0 + 2.0 * f)
            wave = 1.0 + amp * f * fold
            zz = z
            if hem and j > hang_from:
                k = (_lerp_keys(hem, t) - z_ref) / (z_end - z_ref)
                zz = z_ref + (z - z_ref) * k
            if j == n - 1:
                zz += jag * math.sin(i * 12.9898 + 1.7)
            row.append(bm.verts.new((rx * wave * math.sin(a) + sx, ry * wave * math.cos(a) + sy, zz)))
        grid.append(row)
    lay = bm.faces.layers.int.new('band')
    for j, (r0, r1) in enumerate(zip(grid, grid[1:])):
        for i in range(cols):
            f = bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
            if j == n - 2 or i in edge_cols:
                f[lay] = 1
    return shell(bm, thick)


def _hand(b, M, thumb=1, skin='suit', plate='hull'):
    """Gloved hand closed round a bar. Local +Z = forearm direction, +Y = back of the hand,
    the gripped bar runs along local X through HOLD."""
    with b.frames(M):
        b.loft([(-0.035, 0.028, 0.024), (0.0, 0.03, 0.022), (0.02, 0.034, 0.018)], skin, segs=8)     # wrist
        b.box((0.074, 0.028, 0.076), skin, bevel=0.008, at=(0, 0, 0.05))                             # palm
        b.box((0.062, 0.010, 0.052), plate, bevel=0.004, at=(0, 0.018, 0.05))                        # knuckle guard
        for i in range(4):
            x = -0.0276 + 0.0184 * i
            k = 1.0 - 0.10 * abs(i - 1.4)
            b.box((0.0165, 0.018, 0.040 * k), skin, bevel=0, at=(x, -0.003, 0.085 + 0.019 * k), rot=(20, 0, 0))
            b.box((0.0165, 0.038, 0.017), skin, bevel=0, at=(x, -0.028, 0.105 + 0.02 * k))
            b.box((0.0165, 0.016, 0.030), skin, bevel=0, at=(x, -0.050, 0.092 + 0.02 * k), rot=(-15, 0, 0))
        b.box((0.020, 0.020, 0.050), skin, bevel=0.005, at=(0.044 * thumb, -0.016, 0.066), rot=(-35, 0, 0))
        b.box((0.018, 0.034, 0.018), skin, bevel=0.004, at=(0.040 * thumb, -0.040, 0.088))


HOLD = Vector((0.0, -0.028, 0.094))


def hero():
    m = Model('hero', {'hull': ('#23272f', 0.55, 0.45),      # graphite armour
                       'suit': ('#151b2d', 0.10, 0.70),      # deep navy bodysuit
                       'paint': ('#35555a', 0.0, 0.85),      # muted teal cloth (hood, mantle, cloak)
                       'trim': ('#6a6f78', 0.70, 0.40),      # worn steel edges, buckles
                       'leather': ('#3a2f29', 0.0, 0.75),    # straps, quiver, belt
                       'glow_main': '#19e3ff', 'glow_bow': '#19e3ff'})
    b = m.node('body')
    TOR = rotz(-68)      # torso: bow (left) shoulder towards the target
    PEL = rotz(-40)

    def tw(p):
        return tuple(TOR @ Vector(p))

    def pw(p):
        return tuple(PEL @ Vector(p))

    GRIP = Vector((-0.05, -0.74, 1.47))             # bow hand
    NOCK = GRIP + Vector((-0.024, 0.715, 0.055))    # string hand / arrow nock (anchored at the jaw)

    # ---------------------------------------------------------------- pelvis + legs
    with b.frames(PEL):
        b.loft([(0.84, 0.06, 0.06), (0.89, 0.132, 0.092), (0.97, 0.142, 0.098), (1.04, 0.122, 0.086)], 'suit',
               segs=12, power=2.4)
        b.loft([(0.985, 0.149, 0.105), (1.0, 0.153, 0.108), (1.03, 0.14, 0.098)], 'leather', segs=12, power=2.4)
        b.box((0.05, 0.02, 0.04), 'trim', bevel=0.008, at=(0, -0.112, 1.008))
        # front tabard (cloth) and a short rear panel on the uncloaked side
        b.prism([(-0.06, 1.0), (0.06, 1.0), (0.065, 0.78), (0.03, 0.60), (-0.02, 0.66), (-0.055, 0.76)], 0.012,
                'paint', bevel=0.004, plane='xz', at=(0, -0.112, 0), rot=(-7, 0, 0))
        b.prism([(-0.02, 1.0), (0.13, 1.0), (0.14, 0.80), (0.07, 0.68), (0.0, 0.76)], 0.012, 'paint', bevel=0.004,
                plane='xz', at=(0, 0.105, 0), rot=(7, 0, 0))
        with b.sym():   # hip plates (tassets)
            b.box((0.026, 0.13, 0.19), 'hull', bevel=0.010, taper=(1, 0.6), at=(0.158, 0.0, 0.90), rot=(0, 188, 0))
            b.box((0.030, 0.10, 0.02), 'trim', bevel=0.006, at=(0.160, 0.0, 0.985))
        b.box((0.07, 0.05, 0.085), 'leather', bevel=0.014, at=(0.105, 0.10, 0.955), rot=(0, 0, -35))   # belt pouch
        b.box((0.074, 0.054, 0.02), 'hull', bevel=0.006, at=(0.105, 0.10, 0.995), rot=(0, 0, -35))
    feet = {1: ((0.10, -0.25, 0.09), -8), -1: ((-0.13, 0.27, 0.09), -78)}
    for side in (1, -1):
        hip = pw((0.082 * side, 0, 0.92))
        ank, yaw = feet[side]
        fwd = tuple(rotz((yaw - 40) / 2) @ Vector((0, -1, 0)))
        ffwd = tuple(rotz(yaw) @ Vector((0, -1, 0)))
        knee = ik2(hip, ank, 0.45, 0.44, (fwd[0], fwd[1], 0.1))
        with b.frames(aim(hip, knee, fwd)):
            b.loft([(0.0, 0.066, 0.072), (0.06, 0.08, 0.086), (0.22, 0.068, 0.074), (0.38, 0.052, 0.056),
                    (0.45, 0.046, 0.05)], 'suit', segs=10)
            b.loft([(0.07, 0.05, 0.03, 0, 0.058), (0.20, 0.047, 0.03, 0, 0.05), (0.33, 0.034, 0.022, 0, 0.038)],
                   'hull', segs=8, power=3)                                                 # thigh guard (front)
            b.box((0.022, 0.085, 0.16), 'hull', bevel=0.008, at=(0.080 * side, 0.0, 0.17))  # outer plate
            b.loft([(0.285, 0.066, 0.072), (0.31, 0.064, 0.07)], 'leather', segs=10)        # strap
            b.box((0.02, 0.012, 0.03), 'trim', bevel=0.004, at=(0.066 * side, 0.01, 0.297))
        with b.frames(aim(knee, ank, ffwd)):
            b.loft([(-0.045, 0.03, 0.02, 0, 0.045), (0.0, 0.046, 0.03, 0, 0.042), (0.05, 0.036, 0.022, 0, 0.04)],
                   'hull', segs=8, power=2.6)                                               # knee cap
            b.loft([(0.0, 0.05, 0.053), (0.10, 0.057, 0.064, 0, -0.008), (0.30, 0.042, 0.045), (0.44, 0.037, 0.04)],
                   'suit', segs=10)
            b.loft([(0.06, 0.048, 0.03, 0, 0.034), (0.2, 0.05, 0.034, 0, 0.028), (0.40, 0.04, 0.03, 0, 0.02)],
                   'hull', segs=8, power=3)                                                 # greave
            b.box((0.016, 0.012, 0.26), 'trim', bevel=0.004, at=(0, 0.062, 0.23), rot=(-2, 0, 0))
            b.loft([(0.33, 0.05, 0.054), (0.36, 0.05, 0.054)], 'leather', segs=10)
        with b.frames(T(at=(ank[0], ank[1], 0), rot=(0, 0, yaw))):
            b.prism([(-0.185, 0.012), (-0.195, 0.04), (-0.10, 0.082), (0.0, 0.13), (0.065, 0.13), (0.08, 0.05),
                     (0.075, 0.012)], 0.082, 'hull', bevel=0.014, plane='yz')
            b.prism([(-0.20, 0.0), (-0.205, 0.02), (0.085, 0.02), (0.085, 0.0)], 0.09, 'leather', bevel=0.004,
                    plane='yz')                                                             # sole
            b.prism([(-0.20, 0.018), (-0.205, 0.045), (-0.13, 0.078), (-0.11, 0.06), (-0.12, 0.018)], 0.088, 'hull',
                    bevel=0.006, plane='yz')                                                # toe cap
            b.loft([(0.105, 0.05, 0.055, 0, 0.0), (0.15, 0.052, 0.057, 0, 0.004)], 'leather', segs=10)   # cuff

    # ---------------------------------------------------------------- torso
    with b.frames(TOR):
        b.loft([(1.01, 0.12, 0.085), (1.10, 0.106, 0.077), (1.22, 0.134, 0.09), (1.36, 0.165, 0.103),
                (1.44, 0.16, 0.097), (1.49, 0.085, 0.07), (1.53, 0.05, 0.05)], 'suit', segs=14, power=2.3)
        # chest + abdomen plates
        b.loft([(1.21, 0.095, 0.045, 0, -0.052), (1.29, 0.142, 0.068, 0, -0.045), (1.39, 0.156, 0.07, 0, -0.043),
                (1.445, 0.122, 0.052, 0, -0.046)], 'hull', segs=12, power=2.6)
        b.prism([(0.0, 1.40), (0.03, 1.33), (0.0, 1.25), (-0.03, 1.33)], 0.016, 'trim', bevel=0.004, plane='xz',
                at=(0, -0.118, 0))
        for z, w in ((1.15, 0.14), (1.095, 0.12)):
            b.box((w, 0.02, 0.04), 'hull', bevel=0.008, at=(0, -0.078, z))
        # back plate + exposed spine with a thin glow line
        b.loft([(1.12, 0.085, 0.036, 0, 0.05), (1.27, 0.13, 0.055, 0, 0.05), (1.41, 0.148, 0.058, 0, 0.046)],
               'hull', segs=12, power=2.6)
        for i in range(5):
            z = 1.125 + i * 0.068
            b.box((0.05 - 0.003 * i, 0.03, 0.046), 'trim', bevel=0.008, at=(0, 0.104, z), rot=(4, 0, 0))
        b.box((0.011, 0.012, 0.33), 'glow_main', bevel=0, at=(0, 0.121, 1.262))
        # quiver strap: over the draw-side shoulder, down to the left hip
        strap = []
        for i in range(16):
            a = 2 * PI * i / 16
            sa, ca = math.sin(a), math.cos(a)   # tight on the chest, riding over mantle and cloak at the back
            strap.append(((0.250 if sa < 0 else 0.150) * sa, (0.200 if ca > 0 else 0.127) * ca - 0.002,
                          1.25 - 0.17 * sa))
        b.tube(strap, 0.015, 'leather', segs=4, closed=True)
        b.box((0.04, 0.016, 0.035), 'trim', bevel=0.005, at=(-0.05, -0.128, 1.30), rot=(0, 44, 0))
        # shoulder mantle (short cloth cowl, pointed at the back, split at the chest)
        mantle = _cloth(-170, 170, [(1.525, 0.098, 0.092, 0, 0), (1.475, 0.198, 0.142, 0, 0),
                                    (1.41, 0.236, 0.168, 0, 0.004), (1.345, 0.246, 0.18, 0, 0.01),
                                    (1.32, 0.248, 0.182, 0, 0.011)],
                        cols=16, hang_from=1, folds=4.0, amp=0.07, jag=0.010, thick=0.014,
                        hem=[(0.0, 1.40), (0.22, 1.37), (0.5, 1.25), (0.78, 1.37), (1.0, 1.40)])
        b.add(mantle, 'paint', sharp=60, band='suit')
        # long asymmetric half-cloak: draw-side shoulder, round the right flank, ending beside the spine
        cloak = _cloth(-150, -28, [(1.50, 0.092, 0.086, 0.0, 0.0), (1.455, 0.206, 0.142, 0.0, 0.0),
                                  (1.36, 0.226, 0.166, -0.004, 0.004), (1.20, 0.236, 0.186, -0.010, 0.010),
                                  (1.02, 0.252, 0.212, -0.018, 0.018), (0.84, 0.276, 0.242, -0.028, 0.028),
                                  (0.66, 0.302, 0.272, -0.038, 0.040), (0.50, 0.324, 0.298, -0.048, 0.052),
                                  (0.435, 0.334, 0.310, -0.052, 0.058), (0.40, 0.338, 0.314, -0.054, 0.060)],
                       cols=20, folds=3.3, amp=0.30, jag=0.022, thick=0.012, edge_cols=(0, 19),
                       hem=[(0.0, 0.86), (0.25, 0.56), (0.52, 0.36), (0.80, 0.50), (1.0, 0.72)])
        b.add(cloak, 'paint', sharp=38, band='suit')
        b.cyl(0.026, 0.014, 'trim', segs=8, bevel=0.004, rot=FWD, at=(-0.10, -0.142, 1.42))      # cloak clasp
        # back quiver on the bow-side shoulder blade, mouth leaning to the draw hand
        Q0, Q1 = (0.150, 0.155, 1.02), (0.035, 0.215, 1.50)
        with b.frames(aim(Q0, Q1, (0, 1, 0))):
            L = dist(Q0, Q1)
            b.cyl(0.046, L, 'leather', segs=10, r2=0.058, bevel=0.012, scale=(1, 0.8, 1))
            for z in (0.04, L * 0.52, L - 0.05):
                b.cyl(0.054 + 0.012 * z / L, 0.03, 'hull', segs=10, bevel=0.008, at=(0, 0, z), scale=(1, 0.8, 1))
            b.box((0.03, 0.012, L * 0.30), 'trim', bevel=0.004, at=(0, 0.047, L * 0.28))
            for dx, dy, dz in ((0.026, 0.012, 0.17), (-0.024, 0.016, 0.13), (0.0, -0.016, 0.20), (-0.006, 0.02, 0.09),
                               (0.02, -0.01, 0.11)):
                b.cyl(0.006, dz + 0.06, 'trim', segs=5, at=(dx, dy, L - 0.06))
                with b.frames(T(at=(dx, dy, L + dz - 0.065), rot=(0, 0, dx * 1500))):
                    with b.frames(radial(3)):
                        b.prism([(0.004, 0.0), (0.02, 0.008), (0.02, 0.05), (0.004, 0.062)], 0.003, 'hull',
                                plane='xz')
                b.cyl(0.009, 0.014, 'glow_main', segs=5, at=(dx, dy, L + dz - 0.002))               # nock
    # ---------------------------------------------------------------- head (faces the target)
    b.cyl(0.046, 0.09, 'suit', segs=10, at=(0, 0, 1.49))
    with b.frames(T(at=(0, -0.012, 0))):
        b.loft([(1.53, 0.05, 0.055, 0, -0.005), (1.57, 0.076, 0.088), (1.63, 0.09, 0.104), (1.69, 0.086, 0.098),
                (1.722, 0.058, 0.066), (1.735, 0.0, 0.0)], 'hull', segs=14)

        def arc(a0, a1, n, rxo, ryo, rxi, ryi):
            angs = [math.radians(a0 + (a1 - a0) * i / n) for i in range(n + 1)]
            return [(rxo * math.sin(a), -ryo * math.cos(a)) for a in angs] + \
                   [(rxi * math.sin(a), -ryi * math.cos(a)) for a in reversed(angs)]
        b.prism(arc(-44, 44, 6, 0.093, 0.108, 0.06, 0.07), 0.011, 'glow_main', at=(0, 0, 1.648))      # visor slit
        b.prism(arc(-62, 62, 8, 0.098, 0.114, 0.06, 0.07), 0.034, 'hull', bevel=0.006, at=(0, 0, 1.676))   # brow
        b.prism(arc(-52, 52, 6, 0.092, 0.107, 0.05, 0.06), 0.058, 'hull', bevel=0.008, at=(0, 0, 1.585))   # jaw guard
        b.box((0.03, 0.02, 0.035), 'trim', bevel=0.006, at=(0, -0.108, 1.58))
        b.add(_hood(), 'paint', at=(0, 0.024, 1.655), scale=(0.134, 0.146, 0.134), sharp=70, band='suit')
    # ---------------------------------------------------------------- arms
    LS, RS = Vector(tw((0.19, 0, 1.445))), Vector(tw((-0.19, 0, 1.445)))
    # bow hand: back of the hand to the archer's back (+X), thumb up
    HL = aim((0, 0, 0), (GRIP - LS).normalized(), (1, 0, 0))
    lw = GRIP - HL.to_3x3() @ HOLD
    HL.translation = lw
    le = Vector(ik2(LS, lw, 0.27, 0.25, (0.4, 0, -1)))
    # string hand: back of the hand outwards (-X), fingers hooked on the string
    zr = Vector((0.15, -1, 0.0)).normalized()
    for _ in range(2):
        HR = aim((0, 0, 0), zr, (-1, 0, 0))
        rw = NOCK - HR.to_3x3() @ HOLD
        re = Vector(ik2(RS, rw, 0.27, 0.25, (-0.45, 0.85, 0.35)))
        zr = (rw - re).normalized()
    HR.translation = rw
    for side, S, E, W in ((1, LS, le, lw), (-1, RS, re, rw)):
        out = Vector(tw((side, 0, 0)))
        with b.frames(aim(S, E, (0, 0, 1))):
            L = dist(S, E)
            b.loft([(0.0, 0.046, 0.046), (0.06, 0.053, 0.053), (0.20, 0.044, 0.044), (L, 0.038, 0.038)], 'suit',
                   segs=9)
            if side == 1:   # armoured bow arm
                b.loft([(0.09, 0.05, 0.03, 0, 0.03), (0.21, 0.043, 0.026, 0, 0.026)], 'hull', segs=8, power=3)
            else:           # leather wraps on the draw arm
                for z in (0.12, 0.155, 0.19):
                    b.loft([(z, 0.05, 0.05), (z + 0.022, 0.049, 0.049)], 'leather', segs=9)
        b.sphere(0.043, 'hull', segs=9, rings=5, at=E)
        with b.frames(aim(E, W, (0, 0, 1))):
            L = dist(E, W)
            b.loft([(0.0, 0.038, 0.038), (0.07, 0.044, 0.044), (0.2, 0.034, 0.034), (L, 0.029, 0.029)], 'suit',
                   segs=9)
            b.loft([(0.05, 0.047, 0.047), (0.10, 0.051, 0.051), (0.20, 0.041, 0.041), (0.225, 0.037, 0.037)],
                   'hull', segs=9, power=2.8)                                               # bracer
            for z in (0.062, 0.205):
                b.loft([(z, 0.05 - (z - 0.06) * 0.06, 0.05 - (z - 0.06) * 0.06),
                        (z + 0.014, 0.05 - (z - 0.06) * 0.06, 0.05 - (z - 0.06) * 0.06)], 'trim', segs=9, power=2.8)
            b.box((0.009, 0.010, 0.12), 'glow_main', bevel=0, at=(0, 0.049, 0.14), rot=(-3.5, 0, 0))
        # pauldron: layered plates on the bow arm only
        if side == 1:
            pm = aim(S + Vector((0, 0, 0.012)), S + out * 0.55 + Vector((0, 0, 1.0)), (0, 0, 1))
            b.lathe([(0.088, -0.05), (0.092, -0.005), (0.074, 0.042), (0.04, 0.066), (0.0, 0.072)], 'hull',
                    segs=10, m=pm, scale=(1, 1.15, 1))
            b.lathe([(0.099, -0.085), (0.104, -0.05), (0.094, -0.02), (0.07, -0.012)], 'hull', segs=10, m=pm,
                    scale=(1, 1.15, 1))
            b.ring(0.092, 0.012, 0.012, 'trim', segs=10, m=pm, at=(0, 0, -0.012), scale=(1, 1.15, 1))
    _hand(b, HL, thumb=-1)
    _hand(b, HR, thumb=1)

    # ---------------------------------------------------------------- bow (own node, origin at the grip)
    w = m.node('bow', at=tuple(GRIP))
    riser = [(-0.035, -0.17), (-0.062, -0.11), (-0.024, -0.05), (-0.024, 0.05), (-0.062, 0.11), (-0.035, 0.17),
             (0.02, 0.185), (0.03, 0.07), (0.018, 0.0), (0.03, -0.07), (0.02, -0.185)]
    w.prism(riser, 0.034, 'hull', bevel=0.006, plane='yz')
    w.box((0.038, 0.046, 0.085), 'leather', bevel=0.008, at=(0, -0.002, 0.0))      # wrapped grip
    BS = T(scale=(1, 0.92, 0.86))
    with w.frames([BS, MIRROR_Z @ BS]):
        with w.sym():
            w.box((0.008, 0.06, 0.085), 'trim', bevel=0.003, at=(0.019, -0.02, 0.12))
        limb = [(0, -0.01, 0.165), (0, 0.0, 0.30), (0, 0.04, 0.44), (0, 0.10, 0.56), (0, 0.15, 0.64), (0, 0.14, 0.70)]
        w.tube(limb, [0.020, 0.019, 0.017, 0.014, 0.012, 0.010], 'hull', segs=6, scale=(1.7, 1, 1))
        w.tube([(0, p[1] - 0.016, p[2]) for p in limb[:5]], 0.0055, 'glow_bow', segs=4)
        for k in (1, 3):
            w.box((0.05 - 0.005 * k, 0.04, 0.03), 'trim', bevel=0.006, at=limb[k], rot=(-12 * k, 0, 0))
        w.cyl(0.036, 0.032, 'hull', segs=10, bevel=0.008, o='c', rot=RIGHT, at=(0, 0.142, 0.675))
        w.cyl(0.016, 0.038, 'glow_bow', segs=8, o='c', rot=RIGHT, at=(0, 0.142, 0.675))
        w.prism([(0.12, 0.69), (0.15, 0.70), (0.105, 0.765)], 0.018, 'trim', bevel=0.004, plane='yz')
    nock = NOCK - GRIP
    w.tube([(0, 0.142 * 0.92, 0.70 * 0.86), tuple(nock), (0, 0.142 * 0.92, -0.70 * 0.86)], 0.0038, 'glow_bow', segs=4)
    # nocked arrow: dark shaft, lit head and nock
    w.rod((nock.x, nock.y + 0.02, nock.z), (nock.x, -0.24, nock.z), 0.0065, 'trim', segs=5)
    w.lathe([(0.0, -0.01), (0.022, 0.0), (0.006, 0.05), (0.0, 0.095)], 'glow_bow', segs=4, rot=FWD,
            at=(nock.x, -0.24, nock.z))
    w.cyl(0.009, 0.018, 'glow_bow', segs=5, rot=FWD, at=(nock.x, nock.y + 0.025, nock.z))
    with w.frames(T(at=(nock.x, nock.y - 0.075, nock.z))):
        for r in (0, 120, 240):
            w.box((0.003, 0.075, 0.022), 'hull', bevel=0, m=T(rot=(0, r, 0)) @ T(at=(0, 0, 0.013)))
    # stabiliser + sight ring
    w.rod((0, -0.04, -0.10), (0, -0.27, -0.125), 0.010, 'hull', segs=6)
    w.cyl(0.017, 0.05, 'trim', segs=6, bevel=0.005, rot=FWD, at=(0, -0.26, -0.124))
    w.cyl(0.009, 0.010, 'glow_bow', segs=6, rot=FWD, at=(0, -0.31, -0.124))
    w.torus(0.022, 0.004, 'trim', segs=10, rsegs=4, rot=FWD, at=(0.034, -0.05, 0.10))
    w.box((0.02, 0.01, 0.01), 'hull', bevel=0, at=(0.022, -0.05, 0.10))
    return m


HERO = [hero]
