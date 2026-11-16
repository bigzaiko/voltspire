"""BEATSPIRE factory buildings that make and keep things: the Fabricator (fab) and the Depot (depot).

Conventions come from fac_common.py: one hex tile, everything within 0.92 of the axis, FRONT / OUTPUT = -Y,
named nodes 'lamp' / 'spin' / 'work' with their origins as pivots, ~3500 tris each.
"""
import math
from fac_common import *

H0 = 0.16          # top of the plinth (fac_base default)


def hazard(n, x0, x1, z0, z1, y, k=4, slant=0.05, depth=0.012):
    """Horizontal hazard band on a face that looks to -Y (front face at y): dark backing, k slanted stripes."""
    n.box((x1 - x0, depth, z1 - z0), 'dark', bevel=0, at=((x0 + x1) / 2, y + depth / 2, (z0 + z1) / 2))
    w = (x1 - x0 - slant) / (2 * k)
    for i in range(k):
        x = x0 + i * 2 * w
        n.prism([(x, z0), (x + w, z0), (x + w + slant, z1), (x + slant, z1)], depth, 'paint', plane='xz',
                at=(0, y + depth / 2 - 0.004, 0))


def hazard_v(n, x, y, z0, z1, w=0.07, k=5, slant=0.04, depth=0.012):
    """Vertical hazard post facing -Y (door jambs): k slanted stripes on a dark backing."""
    n.box((w, depth, z1 - z0), 'dark', bevel=0, at=(x, y + depth / 2, (z0 + z1) / 2))
    step = (z1 - z0 - slant) / (2 * k)
    for i in range(k):
        z = z0 + i * 2 * step
        n.prism([(x - w / 2, z), (x + w / 2, z + slant), (x + w / 2, z + slant + step), (x - w / 2, z + step)],
                depth, 'paint', plane='xz', at=(0, y + depth / 2 - 0.004, 0))


def square(n, s, t, mat='trim', **kw):
    """A flat square steel frame (the game's Frame item): outer side s, bar width and height t."""
    R = (s - t) / 2 / math.cos(math.radians(45))
    n.add(revolve([(R - t * 0.7, -t / 2), (R + t * 0.7, -t / 2), (R + t * 0.7, t / 2), (R - t * 0.7, t / 2)],
                  segs=4, phase=45), mat, sharp=30, **kw)


# ================================================================== fabricator
def fab():
    m = fac_model('fab', '#d9a05b')
    b = fac_base(m)
    G, W = 'glow_main', 'glow_work'
    XH = 0.56                 # hall half width
    YF, YB = -0.46, 0.60      # hall front / back face
    ZR = 1.12                 # roof deck
    yc = (YF + YB) / 2
    # ---- hall: footing, body, corner pilasters, parapet
    b.box((2 * XH + 0.06, YB - YF + 0.06, 0.07), 'trim', bevel=0, o='b', at=(0, yc, H0))
    b.box((2 * XH, YB - YF, ZR - H0), 'hull', bevel=0.035, o='b', at=(0, yc, H0))
    with b.frames([T(at=(sx * XH, y, 0)) for sx in (-1, 1) for y in (YF, YB)]):
        b.box((0.11, 0.11, ZR - H0 + 0.02), 'hull', bevel=0.025, o='b', at=(0, 0, H0 + 0.02))
    b.box((2 * XH + 0.05, YB - YF + 0.05, 0.06), 'trim', bevel=0.018, o='b', at=(0, yc, ZR - 0.02))
    # accent band + lit strip under the eaves (sides and back), kick band at the foot
    with b.sym():
        b.box((0.025, YB - YF - 0.14, 0.12), 'paint', bevel=0, at=(XH + 0.01, yc, ZR - 0.13))
        b.box((0.012, YB - YF - 0.20, 0.022), G, bevel=0, at=(XH + 0.025, yc, ZR - 0.13))
        b.box((0.02, YB - YF - 0.14, 0.05), 'paint', bevel=0, at=(XH + 0.01, yc, H0 + 0.11))
    b.box((2 * XH - 0.14, 0.025, 0.12), 'paint', bevel=0.008, at=(0, YB + 0.01, ZR - 0.13))
    b.box((2 * XH - 0.24, 0.012, 0.022), G, bevel=0, at=(0, YB + 0.025, ZR - 0.13))

    # ---- +X side: the big assembly window (glow_work) with frame and mullions
    wy0, wy1, wz0, wz1 = -0.30, 0.46, 0.42, 0.88
    wyc, wzc = (wy0 + wy1) / 2, (wz0 + wz1) / 2
    b.box((0.03, wy1 - wy0 + 0.08, wz1 - wz0 + 0.08), 'trim', bevel=0.012, at=(XH + 0.008, wyc, wzc))
    b.box((0.02, wy1 - wy0, wz1 - wz0), W, bevel=0, at=(XH + 0.02, wyc, wzc))
    for i in range(1, 4):
        b.box((0.03, 0.025, wz1 - wz0), 'hull', bevel=0, at=(XH + 0.03, wy0 + (wy1 - wy0) * i / 4, wzc))
    b.box((0.03, wy1 - wy0, 0.025), 'hull', bevel=0, at=(XH + 0.03, wyc, wz0 + (wz1 - wz0) * 0.62))
    b.box((0.09, wy1 - wy0 + 0.12, 0.035), 'trim', bevel=0.01, at=(XH + 0.04, wyc, wz1 + 0.06))    # hood
    b.box((0.06, wy1 - wy0 + 0.08, 0.03), 'hull', bevel=0, at=(XH + 0.03, wyc, wz0 - 0.055))     # sill

    # ---- -X side: air handler + a duct that climbs to the roof
    b.box((0.16, 0.44, 0.40), 'hull', bevel=0.03, o='b', at=(-XH - 0.07, 0.06, H0 + 0.05))
    b.box((0.02, 0.36, 0.30), 'dark', bevel=0, at=(-XH - 0.155, 0.06, H0 + 0.25))
    for z in (0.31, 0.39, 0.47, 0.55):
        b.box((0.025, 0.36, 0.02), 'trim', bevel=0, at=(-XH - 0.16, 0.06, z))
    b.box((0.17, 0.46, 0.04), 'paint', bevel=0, o='b', at=(-XH - 0.07, 0.06, H0 + 0.45))
    b.box((0.14, 0.16, 0.48), 'paint', bevel=0.02, o='b', at=(-XH - 0.07, 0.40, H0 + 0.44))     # riser duct
    b.box((0.155, 0.175, 0.035), 'trim', bevel=0, at=(-XH - 0.07, 0.40, H0 + 0.66))
    b.box((0.19, 0.24, 0.16), 'hull', bevel=0.025, o='b', at=(-XH - 0.085, 0.40, H0 + 0.90))     # intake head
    b.box((0.02, 0.18, 0.10), 'dark', bevel=0, at=(-XH - 0.18, 0.40, H0 + 0.98))
    for z in (H0 + 0.95, H0 + 1.01):
        b.box((0.025, 0.18, 0.015), 'trim', bevel=0, at=(-XH - 0.185, 0.40, z))
    b.box((0.21, 0.26, 0.025), 'paint', bevel=0, o='b', at=(-XH - 0.085, 0.40, H0 + 1.06))
    b.box((0.012, 0.30, 0.02), G, bevel=0, at=(-XH - 0.008, -0.20, 0.62))
    b.box((0.012, 0.30, 0.02), G, bevel=0, at=(-XH - 0.008, -0.20, 0.68))

    # ---- back: service door, pipes, a painted panel with a lit plate
    b.box((0.36, 0.02, 0.50), 'paint', bevel=0, o='b', at=(0.27, YB + 0.008, H0 + 0.14))
    b.box((0.14, 0.012, 0.06), G, bevel=0, at=(0.27, YB + 0.02, H0 + 0.24))
    b.box((0.30, 0.03, 0.48), 'dark', bevel=0, o='b', at=(-0.22, YB + 0.01, H0 + 0.05))
    b.box((0.36, 0.05, 0.04), 'trim', bevel=0, at=(-0.22, YB + 0.02, H0 + 0.56))
    b.box((0.08, 0.012, 0.02), G, bevel=0, at=(-0.22, YB + 0.03, H0 + 0.62))
    b.tube([(0.20, YB + 0.05, H0 + 0.06), (0.20, YB + 0.05, 0.86), (0.20, YB - 0.05, ZR + 0.08)], 0.035, 'trim', segs=6)
    b.tube([(0.34, YB + 0.05, H0 + 0.06), (0.34, YB + 0.05, 0.80), (0.34, YB - 0.10, ZR + 0.08)], 0.028, 'paint', segs=6)
    for x in (0.20, 0.34):
        b.box((0.06, 0.06, 0.03), 'hull', bevel=0, at=(x, YB + 0.04, 0.55))

    # ---- FRONT (-Y): roller door portal with hazard trim, roller housing, apron
    dx, dz = 0.34, 0.80                       # door half width, door top
    b.box((2 * dx + 0.24, 0.10, 0.12), 'hull', bevel=0.025, at=(0, YF - 0.03, dz + 0.10))         # lintel block
    with b.sym():
        b.box((0.12, 0.10, dz - H0 + 0.05), 'hull', bevel=0.025, o='b', at=(dx + 0.06, YF - 0.03, H0))
        hazard_v(b, dx + 0.06, YF - 0.08 - 0.012, H0 + 0.06, dz - 0.02, k=4)
    b.box((2 * dx, 0.02, dz - H0), 'dark', bevel=0, o='b', at=(0, YF - 0.005, H0))
    for i in range(7):                         # roller door slats
        z = H0 + 0.08 + i * (dz - H0 - 0.08) / 6.6
        b.box((2 * dx - 0.02, 0.025, 0.045), 'hull', bevel=0, at=(0, YF - 0.02, z))
    b.box((2 * dx - 0.02, 0.03, 0.05), 'trim', bevel=0.01, at=(0, YF - 0.025, H0 + 0.035))        # bottom bar
    b.box((0.24, 0.012, 0.022), G, bevel=0, at=(0, YF - 0.04, H0 + 0.035))
    b.cyl(0.085, 2 * dx + 0.20, 'paint', segs=10, o='c', rot=RIGHT, at=(0, YF - 0.12, dz + 0.10), bevel=0.02)
    for sx in (-1, 1):
        b.cyl(0.092, 0.03, 'trim', segs=10, o='c', rot=RIGHT, at=(sx * (dx + 0.10), YF - 0.12, dz + 0.10))
    hazard(b, -dx - 0.12, dx + 0.12, dz + 0.20, dz + 0.27, YF - 0.12 - 0.012)
    b.box((2 * dx + 0.24, 0.06, 0.03), 'trim', bevel=0.01, at=(0, YF - 0.10, dz + 0.285))
    # apron down to the plinth edge, with a lit lane
    b.prism([(YF - 0.30, H0), (YF, H0), (YF, H0 + 0.035), (YF - 0.24, H0 + 0.035)], 2 * dx, 'trim', plane='yz')
    with b.sym():
        b.box((0.05, 0.30, 0.04), 'hull', bevel=0, at=(dx + 0.025, YF - 0.15, H0 + 0.02))
        b.box((0.015, 0.20, 0.012), G, bevel=0, at=(dx - 0.05, YF - 0.16, H0 + 0.038))
        b.cyl(0.035, 0.18, 'paint', segs=6, at=(dx + 0.14, YF - 0.20, H0))                          # bollard

    # ---- roof: front hood with louvres, assembly bay in the middle, services along the back
    r = m.node('roof')
    r.box((2 * XH - 0.12, 0.36, 0.14), 'hull', bevel=0.03, o='b', at=(0, YF + 0.22, ZR + 0.04), taper=(0.96, 0.72),
          shift=(0, 0.04))
    for i in range(5):
        r.box((0.13, 0.20, 0.025), 'trim', bevel=0, at=(-0.36 + i * 0.18, YF + 0.25, ZR + 0.185))
    # assembly bay: coaming around a lit floor, grating at the edges
    by0, by1, bx = -0.08, 0.44, 0.44
    byc = (by0 + by1) / 2
    r.box((2 * bx, by1 - by0, 0.02), W, bevel=0, at=(0, byc, ZR + 0.045))
    with r.sym():
        r.box((0.06, by1 - by0 + 0.06, 0.09), 'paint', bevel=0.015, at=(bx + 0.03, byc, ZR + 0.07))
        r.box((0.012, by1 - by0 - 0.06, 0.02), G, bevel=0, at=(bx + 0.064, byc, ZR + 0.08))
    for y in (by0 - 0.03, by1 + 0.03):
        r.box((2 * bx + 0.12, 0.06, 0.09), 'paint', bevel=0, at=(0, y, ZR + 0.07))
    for x in (-0.30, 0.30):
        r.box((0.025, by1 - by0, 0.02), 'dark', bevel=0, at=(x, byc, ZR + 0.06))
    # services on the back strip: duct with a fan housing, two exhaust stacks
    r.cyl(0.06, 0.60, 'trim', segs=8, o='c', rot=RIGHT, at=(0.0, YB - 0.06, ZR + 0.08))
    r.cyl(0.12, 0.10, 'hull', segs=12, at=(0.40, YB - 0.08, ZR + 0.03))
    r.cyl(0.095, 0.012, 'dark', segs=12, at=(0.40, YB - 0.08, ZR + 0.125))
    with r.frames([T(at=(0.40, YB - 0.08, ZR + 0.135)) @ rotz(a) for a in (20, 140, 260)]):
        r.box((0.09, 0.025, 0.01), 'trim', bevel=0, at=(0.045, 0, 0))
    for x, hgt in ((-0.42, 0.40), (-0.29, 0.30)):
        r.cyl(0.05, hgt, 'hull', segs=8, at=(x, YB - 0.07, ZR + 0.04))
        r.cyl(0.06, 0.04, 'trim', segs=8, at=(x, YB - 0.07, ZR + 0.04 + hgt - 0.03))
    # lamp mast at the front-left
    r.rod((-0.42, YF + 0.14, ZR + 0.04), (-0.42, YF + 0.14, ZR + 0.42), 0.022, 'trim', segs=6)
    r.box((0.10, 0.10, 0.04), 'hull', bevel=0, at=(-0.42, YF + 0.14, ZR + 0.06))
    status_lamp(m, at=(-0.42, YF + 0.14, ZR + 0.50))

    # ---- the robot arm on its turntable ('spin', turns about its own Z while working)
    s = m.node('spin', at=(0, byc, ZR + 0.055))
    s.cyl(0.17, 0.05, 'trim', segs=12, bevel=0.012)
    s.cyl(0.11, 0.14, 'paint', segs=10, r2=0.09, at=(0, 0, 0.05))
    sh = (0.0, 0.0, 0.25)                    # shoulder
    el = (-0.10, 0.0, 0.66)                  # elbow
    wr = (0.30, 0.0, 0.50)                   # wrist
    with s.sym():
        s.box((0.04, 0.12, 0.16), 'hull', bevel=0.012, at=(0.075, 0, 0.24))
    s.cyl(0.065, 0.19, 'trim', segs=8, o='c', rot=RIGHT, at=sh)
    s.limb(sh, el, 0.075, 0.055, 'paint', segs=6, power=3.0, flat=0.8, up=(1, 0, 0))
    s.cyl(0.06, 0.15, 'trim', segs=8, o='c', rot=RIGHT, at=el)
    s.limb(el, wr, 0.05, 0.04, 'hull', segs=6, power=3.0, flat=0.8, up=(1, 0, 0))
    s.box((0.03, 0.012, 0.22), G, bevel=0, at=(-0.05, -0.045, 0.45), rot=(0, -14, 0))
    s.box((0.03, 0.012, 0.22), G, bevel=0, at=(-0.05, 0.045, 0.45), rot=(0, -14, 0))
    s.tube([(-0.05, 0.06, 0.12), (-0.08, 0.06, 0.45), (-0.06, 0.05, 0.64), (0.10, 0.05, 0.62)], 0.012, 'dark', segs=4)
    s.cyl(0.045, 0.08, 'trim', segs=8, o='c', at=(wr[0], 0, wr[2] - 0.03))
    s.cyl(0.05, 0.03, 'dark', segs=8, o='c', at=(wr[0], 0, wr[2] - 0.08))
    with s.sym():
        s.box((0.02, 0.05, 0.10), 'trim', bevel=0, at=(wr[0] + 0.03, 0, wr[2] - 0.14), rot=(0, 8, 0))
    # the frame it is assembling, held in the gripper
    square(s, 0.22, 0.03, 'trim', at=(wr[0], 0, wr[2] - 0.20))
    s.box((0.05, 0.05, 0.035), G, bevel=0, at=(wr[0], 0, wr[2] - 0.20))
    return m


# ================================================================== depot
def depot():
    m = fac_model('depot', '#e3dc92')
    b = fac_base(m)
    G = 'glow_main'
    Z1 = H0 + 0.03
    # ---- yard deck: steel floor plate, painted bay lines
    b.cyl(0.80 / 0.8660254, 0.03, 'dark', segs=6, phase=30, at=(0, 0, H0))
    # ---- shed at the back: four posts, a roof sloping down to the back, open on every side
    py0, py1, px = 0.10, 0.56, 0.56
    zf, zb = 1.36, 1.24
    for sx in (-1, 1):
        for y, zt in ((py0, zf), (py1, zb)):
            b.box((0.12, 0.12, 0.04), 'trim', bevel=0, o='b', at=(sx * px, y, Z1))
            b.box((0.07, 0.07, zt - Z1), 'hull', bevel=0.012, o='b', at=(sx * px, y, Z1))
            b.box((0.075, 0.075, 0.16), 'paint', bevel=0, o='b', at=(sx * px, y, Z1 + 0.05))
        b.rod((sx * px, py0, zf - 0.03), (sx * px, py1, zb - 0.03), 0.03, 'trim', segs=6)
        b.rod((sx * px, py0 + 0.03, zf - 0.28), (sx * px, py0 + 0.22, zf - 0.06), 0.016, 'trim', segs=4)
        b.rod((sx * px, py1 - 0.03, zb - 0.28), (sx * px, py1 - 0.22, zb - 0.06), 0.016, 'trim', segs=4)
    for y, zt in ((py0, zf), (py1, zb)):
        b.box((2 * px + 0.08, 0.07, 0.07), 'hull', bevel=0.012, at=(0, y, zt - 0.03))
    # back wall: ribbed panels between the back posts, a lit strip along the top
    b.box((2 * px - 0.04, 0.04, zb - Z1 - 0.10), 'hull', bevel=0.01, o='b', at=(0, py1 + 0.02, Z1))
    for x in (-0.37, 0.0, 0.37):
        b.box((0.30, 0.02, 0.62), 'paint', bevel=0, o='b', at=(x, py1 - 0.005, Z1 + 0.10))
    for x in (-0.185, 0.185):
        b.box((0.04, 0.03, zb - Z1 - 0.10), 'trim', bevel=0, o='b', at=(x, py1 - 0.01, Z1))
    b.box((2 * px - 0.12, 0.012, 0.022), G, bevel=0, at=(0, py1 - 0.008, Z1 + 0.80))
    b.box((2 * px - 0.04, 0.02, 0.46), 'paint', bevel=0, o='b', at=(0, py1 + 0.045, Z1 + 0.06))
    for x in (-0.37, 0.0, 0.37):
        b.box((0.035, 0.03, zb - Z1 - 0.14), 'trim', bevel=0, o='b', at=(x, py1 + 0.055, Z1 + 0.04))
    b.box((2 * px - 0.12, 0.012, 0.022), G, bevel=0, at=(0, py1 + 0.058, Z1 + 0.62))
    b.box((2 * px - 0.10, 0.03, 0.03), 'glow_work', bevel=0, at=(0, py0 + 0.05, zf - 0.08))   # under-roof light bar
    roof = m.node('canopy')
    ang = math.degrees(math.atan2(zf - zb, py1 - py0))
    ry0, ry1 = py0 - 0.12, py1 + 0.08
    rl = (ry1 - ry0) / math.cos(math.radians(ang))
    with roof.frames(T(at=(0, (ry0 + ry1) / 2, (zf + zb) / 2 + 0.02), rot=(ang, 0, 0))):
        roof.box((2 * px + 0.16, rl, 0.05), 'hull', bevel=0.012)
        with roof.sym():
            roof.box((0.03, rl, 0.08), 'trim', bevel=0, at=(px + 0.085, 0, -0.005))                # fascia
        for i in range(5):                                                    # corrugation ribs
            roof.box((0.06, rl - 0.04, 0.025), 'paint', bevel=0, at=(-px + 0.12 + i * (2 * px - 0.24) / 4, 0, 0.035))
        roof.box((0.40, 0.04, 0.12), 'paint', bevel=0.01, at=(0, -rl / 2 + 0.06, 0.08), rot=(-ang, 0, 0))   # sign
        roof.box((0.30, 0.012, 0.035), G, bevel=0, at=(0, -rl / 2 + 0.035, 0.085), rot=(-ang, 0, 0))
        roof.box((2 * px + 0.20, 0.05, 0.06), 'trim', bevel=0.012, at=(0, -rl / 2, 0.0))   # front eave
        roof.box((2 * px + 0.10, 0.012, 0.022), G, bevel=0, at=(0, -rl / 2 - 0.028, -0.005))

    # ---- crates (left) and stacked frame bundles (right) under the shed and in the yard
    def crate(n, at, s=0.24, h=0.20, rot=0.0):
        with n.frames(T(at=at, rot=(0, 0, rot))):
            n.box((s, s, h), 'paint', bevel=0.02, o='b')
            n.box((s + 0.012, s + 0.012, 0.03), 'trim', bevel=0, at=(0, 0, h * 0.72))

    def bundle(n, at, k=4, s=0.30, t=0.035, rot=0.0):
        with n.frames(T(at=at, rot=(0, 0, rot))):
            n.box((s * 0.9, 0.05, 0.03), 'hull', bevel=0, at=(0, -s / 3, 0.015))    # skids
            n.box((s * 0.9, 0.05, 0.03), 'hull', bevel=0, at=(0, s / 3, 0.015))
            for j in range(k):
                square(n, s, t, 'trim', at=(0, 0, 0.03 + j * (t + 0.006) + t / 2))
            hh = k * (t + 0.006)
            n.box((0.02, s + 0.012, hh + 0.012), G, bevel=0, at=(0, 0, 0.03 + hh / 2))   # lit strap
        return 0.03 + k * (t + 0.006)

    c = m.node('stock')
    crate(c, (-0.38, 0.40, Z1))
    crate(c, (-0.12, 0.40, Z1), rot=-3)
    crate(c, (-0.38, 0.40, Z1 + 0.20), rot=7)
    crate(c, (-0.40, 0.40, Z1 + 0.40), s=0.20, h=0.16, rot=-10)
    # front-left of the yard: a pallet of frames waiting for the forklift
    bundle(c, (-0.52, -0.42, Z1), k=3, s=0.26, rot=30)
    z = bundle(c, (0.30, 0.38, Z1), k=5)
    bundle(c, (0.30, 0.38, Z1 + z), k=4, rot=10)
    bundle(c, (0.36, -0.08, Z1), k=3, rot=-6)

    # ---- FRONT (-Y): intake roller conveyor stub from the plinth edge into the yard
    cx, cy0, cy1, cz = 0.0, -0.88, -0.30, 0.30
    for sx in (-1, 1):
        b.box((0.035, cy1 - cy0, 0.06), 'hull', bevel=0.01, at=(cx + sx * 0.16, (cy0 + cy1) / 2, cz))
        b.box((0.01, cy1 - cy0 - 0.06, 0.016), G, bevel=0, at=(cx + sx * 0.18, (cy0 + cy1) / 2, cz + 0.005))
        for y in (cy0 + 0.08, cy1 - 0.06):
            b.box((0.04, 0.04, cz - Z1), 'trim', bevel=0, o='b', at=(cx + sx * 0.16, y, Z1))
    for i in range(7):
        y = cy0 + 0.05 + i * (cy1 - cy0 - 0.10) / 6
        b.cyl(0.024, 0.30, 'trim', segs=6, o='c', rot=RIGHT, at=(cx, y, cz + 0.005))
    b.box((0.38, 0.06, 0.10), 'paint', bevel=0.015, at=(cx, cy1 + 0.03, cz + 0.02))       # end stop
    b.box((0.30, 0.012, 0.02), G, bevel=0, at=(cx, cy1, cz + 0.04))
    square(b, 0.22, 0.03, 'paint', at=(cx, cy0 + 0.24, cz + 0.045))                       # a frame arriving

    # ---- gantry crane over the conveyor end, the hoist block on 'work'
    gy, gz = -0.36, 0.86
    gx0, gx1 = -0.28, 0.30
    for x in (gx0, gx1):
        b.box((0.10, 0.24, 0.04), 'trim', bevel=0, o='b', at=(x, gy, Z1))
        b.rod((x, gy - 0.10, Z1 + 0.04), (x, gy, gz - 0.04), 0.024, 'paint', segs=5)
        b.rod((x, gy + 0.10, Z1 + 0.04), (x, gy, gz - 0.04), 0.024, 'paint', segs=5)
        b.box((0.03, 0.12, 0.025), 'hull', bevel=0, at=(x, gy, Z1 + 0.32))
    b.box((gx1 - gx0 + 0.12, 0.08, 0.09), 'hull', bevel=0.015, at=((gx0 + gx1) / 2, gy, gz))
    b.box((gx1 - gx0 + 0.04, 0.085, 0.02), 'paint', bevel=0, at=((gx0 + gx1) / 2, gy, gz + 0.05))
    b.box((gx1 - gx0 - 0.10, 0.012, 0.02), G, bevel=0, at=((gx0 + gx1) / 2, gy - 0.046, gz))
    b.box((0.12, 0.13, 0.08), 'trim', bevel=0.015, at=(cx, gy, gz - 0.07))                # trolley
    b.rod((gx0, gy, gz + 0.04), (gx0, gy, gz + 0.34), 0.016, 'trim', segs=5)
    status_lamp(m, at=(gx0, gy, gz + 0.40))
    w = m.node('work', at=(cx, gy, gz - 0.11))
    w.rod((-0.02, 0, 0), (-0.02, 0, -0.12), 0.008, 'dark', segs=4)
    w.rod((0.02, 0, 0), (0.02, 0, -0.12), 0.008, 'dark', segs=4)
    w.box((0.08, 0.06, 0.08), 'paint', bevel=0.012, at=(0, 0, -0.15))
    w.box((0.28, 0.03, 0.025), 'trim', bevel=0, at=(0, 0, -0.20))
    for x in (-0.12, 0.12):
        w.rod((x, 0, -0.20), (x, 0, -0.30), 0.006, 'dark', segs=3)
    square(w, 0.26, 0.03, 'trim', at=(0, 0, -0.32))
    square(w, 0.26, 0.03, 'trim', at=(0, 0, -0.356))

    # ---- forklift in the left of the yard, a crate on its forks
    f = m.node('forklift', at=(-0.42, 0.02, Z1))
    f.box((0.18, 0.24, 0.10), 'paint', bevel=0.02, o='b', at=(0, 0.03, 0.04))
    f.box((0.18, 0.07, 0.10), 'hull', bevel=0.015, o='b', at=(0, 0.14, 0.10))         # counterweight
    for sx in (-1, 1):
        for y in (-0.06, 0.10):
            f.cyl(0.04, 0.03, 'dark', segs=6, o='c', rot=RIGHT, at=(sx * 0.095, y, 0.04))
        f.rod((sx * 0.07, -0.04, 0.14), (sx * 0.07, 0.03, 0.30), 0.01, 'trim', segs=4)
        f.rod((sx * 0.07, 0.10, 0.14), (sx * 0.07, 0.10, 0.30), 0.01, 'trim', segs=4)
        f.box((0.02, 0.03, 0.34), 'trim', bevel=0, o='b', at=(sx * 0.06, -0.12, 0.02))         # mast
        f.box((0.03, 0.15, 0.012), 'trim', bevel=0, at=(sx * 0.045, -0.20, 0.10))              # forks
    f.box((0.17, 0.17, 0.012), 'hull', bevel=0, at=(0, 0.03, 0.30))                           # cab roof
    f.box((0.07, 0.06, 0.05), 'dark', bevel=0, at=(0, 0.06, 0.165))                           # seat
    f.box((0.04, 0.03, 0.02), G, bevel=0, at=(0, 0.03, 0.315))                                # beacon
    crate(f, (0, -0.21, 0.106), s=0.16, h=0.13)
    return m


MODELS = [fab, depot]
