"""BEATSPIRE factory pieces, transit group: the Belt Splitter (splitter), the Belt Tunnel end (tunnel) and the
Pipe Tunnel shaft (ptunnel).

These three join the belts and pipes the game draws itself (src/game/facview.ts), so they follow the belt and pipe
sections rather than the hex plinth of the buildings:
  - belt: tread surface at z = 0.155, rail tops at 0.215, the rails 0.365 .. 0.475 from the belt's axis;
  - pipe: axis at z = 0.40, glass radius 0.105.
Blender -Y is the model's FRONT (three.js +Z). Hex side d of the game (0 = east, clockwise on screen) is the
direction -60 d degrees about Blender Z.

splitter: a hex sorting table whose flats (0.727 from the axis) each take a belt stub; the corner posts stand where
  the rails of two neighbouring stubs meet and cap their ends. Nodes: 'turn' (the turntable, the game spins it),
  'spin' (the diverter head on the gantry: its pointer faces -Y, the game turns it to the side served next),
  'gate0'..'gate5' (the kerb closing side d: the game hides the ones a belt joins).
tunnel: the ENTRANCE end, items running toward -Y: the game lays its ramp from the back edge (y = +1) down to
  y = -0.3; the mouth is at y = +0.10, the hood runs back to y = -0.76 and sinks as it goes. The exit is the same
  model turned half round. Nodes: 'mouth' (the lights inside the mouth, glow_work: the game flares them as an item
  passes), 'arrow_in' / 'arrow_out' (roof chevrons for the entrance / the exit: the game shows one of them).
  Material 'void' is the black inside: the game swaps it for an unlit black.
ptunnel: the shaft a pipe dives into: a kerbed pit, the riser, a hex manifold with a port on each side (the game's
  glass arms plug into them at 0.29 from the axis) and the cage of the sight glass on top (the game draws the glass
  and the fluid in it, y 0.60 .. 0.76, radius 0.17). glow_work = the light in the pit (tinted with the fluid).
"""
import math
import bmesh
from vs_lib import *
from fac_common import HULL, TRIM, DARK, HEX

AMBER = '#f2a54a'
Y_SURF, Y_RAIL = 0.155, 0.215


def transit_model(name, work='#ffb44a'):
    return Model('fac_' + name, {'hull': HULL, 'paint': (industrial(AMBER), 0.3, 0.55), 'trim': TRIM, 'dark': DARK,
                                 'warn': ('#c8892a', 0.25, 0.6), 'void': ('#050404', 0.0, 1.0),
                                 # big flat plates (the tunnel hood's roof): matt, or the whole plane mirrors the key light and blooms white
                                 'plate': ('#2a2420', 0.15, 0.85),
                                 'glow_main': AMBER, 'glow_work': work})


def band_loft(secs):
    """A closed solid swept through sections [(y, outer, inner)]: outer and inner are (x, z) outlines with the same
    number of points; the section is the band between them (an arch frame, a hollow hood)."""
    bm = bmesh.new()
    loops = []
    for y, o, i in secs:
        loops.append([bm.verts.new((p[0], y, p[1])) for p in o] + [bm.verts.new((p[0], y, p[1])) for p in reversed(i)])
    n = len(loops[0])
    for a, b in zip(loops, loops[1:]):
        for k in range(n):
            l = (k + 1) % n
            bm.faces.new((a[k], a[l], b[l], b[k]))
    for loop in (loops[0], loops[-1]):
        for k in range(n // 2 - 1):
            bm.faces.new((loop[k], loop[k + 1], loop[n - 2 - k], loop[n - 1 - k]))
    return bm


def solid_loft(secs):
    """A closed solid through sections [(y, outline)] of (x, z) points."""
    bm = bmesh.new()
    loops = [[bm.verts.new((p[0], y, p[1])) for p in o] for y, o in secs]
    n = len(loops[0])
    for a, b in zip(loops, loops[1:]):
        for k in range(n):
            l = (k + 1) % n
            bm.faces.new((a[k], a[l], b[l], b[k]))
    bm.faces.new(loops[0])
    bm.faces.new(loops[-1])
    return bm


def chevron(w, d, t):
    """A flat V in the xy plane pointing to -Y: half width w, depth d of each leg along y, t thick along y."""
    return [(-w, d / 2), (0, -d / 2), (w, d / 2), (w, d / 2 - t), (0, -d / 2 - t), (-w, d / 2 - t)]


def stripes(n, y0, y1, z0, z1, x, k=4, slant=0.05, depth=0.008):
    """Hazard stripes on a face that looks to local +X at x, between y0..y1 and z0..z1."""
    w = (y1 - y0 - slant) / (2 * k - 1)
    for i in range(k):
        y = y0 + i * 2 * w
        n.prism([(y, z0), (y + w, z0), (y + w + slant, z1), (y + slant, z1)], depth, 'warn', plane='yz', at=(x, 0, 0))


# ================================================================== belt splitter
def splitter():
    m = transit_model('splitter')
    b = m.node('base')
    R = 0.84                      # corner radius: where the rails of two neighbouring stubs cross
    A = R * math.cos(math.radians(30))   # 0.727 to the flats
    ZT = 0.150                    # table top, a hair under the tread

    # --- the table: a hex block with a foot band, dark panels with hazard stripes on the flats (a belt stub hides its side)
    b.lathe([(R, 0.0), (R, ZT), (0.0, ZT)], 'hull', **HEX)
    b.lathe([(R + 0.025, 0.0), (R + 0.025, 0.045), (R, 0.06)], 'trim', **HEX)
    with b.frames(radial(6)):
        b.box((0.012, 0.66, 0.085), 'dark', bevel=0, at=(A + 0.004, 0, 0.098))
        stripes(b, -0.30, 0.30, 0.066, 0.130, A + 0.012, k=4, slant=0.045)
        # transfer rollers across each lane, between the stub and the turntable
        for r in (0.545, 0.615, 0.685):
            b.cyl(0.021, 0.52, 'trim', segs=5, o='c', at=(r, 0, ZT - 0.006), rot=(90, 0, 0))
        b.box((0.20, 0.56, 0.006), 'dark', bevel=0, at=(0.615, 0, ZT + 0.001))
    with b.frames(radial(6, start=30)):
        b.box((0.25, 0.04, 0.03), 'trim', bevel=0, at=(0.655, 0, ZT + 0.008))     # ribs between the lanes
    # the turntable's seat: a steel bearing ring and the amber working light round it
    b.ring(0.458, 0.036, 0.03, 'trim', segs=24, at=(0, 0, ZT + 0.001))
    b.ring(0.495, 0.03, 0.02, 'glow_work', segs=24, at=(0, 0, ZT + 0.006))

    # --- corner posts (they cap the stubs' rail ends), every second one carries a gantry arm
    with b.frames(radial(6, radius=R, start=30)):
        b.cyl(0.066, 0.36, 'hull', segs=6)
        b.cyl(0.08, 0.035, 'trim', segs=6, at=(0, 0, 0.20))
        b.cyl(0.08, 0.03, 'trim', segs=6, at=(0, 0, 0.345))
    with b.frames(radial(3, radius=R, start=90)):
        b.cyl(0.04, 0.03, 'glow_main', segs=6, at=(0, 0, 0.375))
    arm = slab([(0.40, 0.835), (0.70, 0.79), (0.85, 0.62), (0.85, 0.30)], 0.075)
    with b.frames(radial(3, start=30)):
        b.prism(arm, 0.07, 'hull', bevel=0.012, plane='xz', sharp=25)
        b.box((0.03, 0.085, 0.16), 'trim', bevel=0, at=(0.845, 0, 0.47))          # strap round the arm
        b.box((0.20, 0.014, 0.02), 'glow_main', bevel=0, at=(0.56, -0.04, 0.778), rot=(0, 8.5, 0))
        b.box((0.20, 0.014, 0.02), 'glow_main', bevel=0, at=(0.56, 0.04, 0.778), rot=(0, 8.5, 0))
    ZG = 0.80                     # the gantry ring the head turns in
    b.ring(0.425, 0.075, 0.07, 'trim', segs=18, at=(0, 0, ZG))
    with b.frames(radial(9, radius=0.425, start=20)):
        b.box((0.03, 0.03, 0.02), 'hull', bevel=0, at=(0, 0, ZG + 0.04))

    # --- the kerbs that close a side no belt joins
    for d in range(6):
        g = m.node('gate%d' % d, rot=(0, 0, -60 * d))
        g.box((0.055, 0.60, 0.075), 'trim', bevel=0, o='b', at=(A - 0.04, 0, ZT - 0.005))
        for s in (-1, 1):
            g.box((0.075, 0.05, 0.095), 'trim', bevel=0, o='b', at=(A - 0.04, s * 0.20, ZT - 0.005))

    # --- the turntable: a dark disc with slats and three hazard marks, so its turning shows
    t = m.node('turn', at=(0, 0, ZT))
    t.cyl(0.44, 0.012, 'dark', segs=24)
    with t.frames(radial(12)):
        t.box((0.27, 0.03, 0.005), 'hull', bevel=0, at=(0.265, 0, 0.0125))
    with t.frames(radial(3, start=15)):
        t.box((0.06, 0.10, 0.005), 'warn', bevel=0, at=(0.385, 0, 0.0128))
    t.cyl(0.085, 0.016, 'trim', segs=10)

    # --- the diverter head: slew ring, a boom with a lit pointer at the front and a plough hanging at the back
    s = m.node('spin', at=(0, 0, ZG))
    s.ring(0.335, 0.095, 0.05, 'hull', segs=18)
    s.box((0.11, 0.70, 0.055), 'paint', bevel=0.014)
    s.box((0.58, 0.06, 0.04), 'hull', bevel=0.01)
    s.cyl(0.105, 0.10, 'trim', segs=10, bevel=0.012, at=(0, 0, -0.03))
    s.box((0.13, 0.17, 0.07), 'hull', bevel=0.015, o='b', at=(0, 0.15, 0.03))          # drive
    s.cyl(0.03, 0.05, 'trim', segs=6, at=(0, 0.15, 0.10))
    s.prism(chevron(0.115, 0.11, 0.065), 0.022, 'glow_work', at=(0, -0.245, 0.04))
    s.box((0.05, 0.10, 0.02), 'glow_work', bevel=0, at=(0, -0.09, 0.03))
    for x in (-0.11, 0.11):
        s.cyl(0.014, 0.17, 'trim', segs=5, at=(x, 0.255, -0.18))
    for sx in (-1, 1):
        s.box((0.21, 0.028, 0.15), 'paint', bevel=0.008, at=(sx * 0.095, 0.275, -0.165), rot=(0, 0, -sx * 20))
        s.box((0.21, 0.034, 0.035), 'warn', bevel=0, at=(sx * 0.095, 0.275, -0.238), rot=(0, 0, -sx * 20))
    return m


# ================================================================== belt tunnel
T_Y0, T_Y1 = 0.10, -0.76          # the mouth and the back of the hood


def t_outer(y, grow=0.0):
    """The hood's outline at y: a chamfered arch, lower toward the back (the hood dives into the deck)."""
    k = (T_Y0 - y) / (T_Y0 - T_Y1)
    top, wall, hw, cx = 0.60 - 0.30 * k, 0.34 - 0.18 * k, 0.60, 0.34
    g = grow
    return [(-hw - g, 0.0), (-hw - g, wall + g * 0.4), (-cx - g * 0.4, top + g), (cx + g * 0.4, top + g),
            (hw + g, wall + g * 0.4), (hw + g, 0.0)]


def t_inner(y, inset=0.0):
    """The cavity's outline at y (the belt's frame is 0.475 to either side)."""
    k = (T_Y0 - y) / (T_Y0 - T_Y1)
    top, wall, hw, cx = 0.51 - 0.30 * k, 0.26 - 0.18 * k, 0.50, 0.27
    s = inset
    return [(-hw + s, 0.0), (-hw + s, wall - s * 0.4), (-cx + s * 0.4, top - s), (cx - s * 0.4, top - s),
            (hw - s, wall - s * 0.4), (hw - s, 0.0)]


def t_top(y):
    return 0.60 - 0.30 * (T_Y0 - y) / (T_Y0 - T_Y1)


def tunnel():
    m = transit_model('tunnel')
    b = m.node('body')
    YV = -0.17                    # the black inside starts here (the game's items vanish at y = -0.12)
    SH = dict(sharp=20)
    slope = math.degrees(math.atan2(0.30, T_Y0 - T_Y1))

    # --- the hood: hollow at the mouth, solid behind the void; a dark lining inside
    b.add(band_loft([(T_Y0, t_outer(T_Y0), t_inner(T_Y0)), (YV, t_outer(YV), t_inner(YV))]), 'plate', **SH)
    b.add(solid_loft([(YV, t_outer(YV)), (T_Y1, t_outer(T_Y1))]), 'plate', **SH)
    b.add(band_loft([(T_Y0 - 0.015, t_inner(T_Y0), t_inner(T_Y0, 0.014)), (YV, t_inner(YV), t_inner(YV, 0.014))]), 'dark', **SH)
    b.add(solid_loft([(YV + 0.012, t_inner(YV, 0.005)), (YV, t_inner(YV, 0.005))]), 'void', **SH)
    # the portal frame: a heavy steel surround standing proud of the hood
    b.add(band_loft([(T_Y0 + 0.07, t_outer(T_Y0, 0.055), t_inner(T_Y0)), (T_Y0 - 0.06, t_outer(T_Y0, 0.055), t_inner(T_Y0))]), 'trim', **SH)
    # warning chevrons across the lintel, pointing down at the mouth
    yf = T_Y0 + 0.07
    b.box((0.60, 0.012, 0.105), 'dark', bevel=0, at=(0, yf + 0.004, 0.583))
    for i in range(5):
        b.prism([(-0.045, 0.036), (0.0, -0.004), (0.045, 0.036), (0.045, 0.002), (0.0, -0.038), (-0.045, 0.002)], 0.008, 'warn',
                plane='xz', at=((i - 2) * 0.115, yf + 0.012, 0.583))
    # hazard blocks down the portal's legs and a lamp housing on each
    for sx in (-1, 1):
        for i, z in enumerate((0.05, 0.13, 0.21)):
            b.box((0.085, 0.01, 0.045), 'warn' if i % 2 == 0 else 'dark', bevel=0, at=(sx * 0.605, yf + 0.004, z + 0.02))
        b.box((0.07, 0.05, 0.09), 'hull', bevel=0.012, at=(sx * 0.605, yf + 0.02, 0.33))
        b.box((0.045, 0.012, 0.06), 'glow_main', bevel=0, at=(sx * 0.605, yf + 0.048, 0.33))
    # bolt heads round the portal frame, a beacon on each shoulder, a junction box low on each flank
    for sx in (-1, 1):
        for bx, bz in ((0.50, 0.40), (0.40, 0.50), (0.335, 0.583)):
            b.cyl(0.017, 0.012, 'hull', segs=6, at=(sx * bx, yf + 0.006, bz), rot=(-90, 0, 0))
        with b.frames(T(at=(sx * 0.50, T_Y0 + 0.005, 0.50), rot=(0, sx * 45, 0))):
            b.cyl(0.036, 0.03, 'trim', segs=6)
            b.cyl(0.025, 0.035, 'glow_main', segs=6, at=(0, 0, 0.03))
        b.box((0.07, 0.11, 0.10), 'hull', bevel=0.012, at=(sx * 0.63, -0.70, 0.075))
        b.box((0.012, 0.07, 0.06), 'paint', bevel=0, at=(sx * 0.668, -0.70, 0.075))
    # ribs round the hood, a lit seam low on each flank between them
    for y in (-0.30, -0.58):
        b.add(band_loft([(y + 0.035, t_outer(y + 0.035, 0.028), t_outer(y + 0.035, -0.01)),
                         (y - 0.035, t_outer(y - 0.035, 0.028), t_outer(y - 0.035, -0.01))]), 'trim', **SH)
    for sx in (-1, 1):
        for y in (-0.105, -0.44):
            b.box((0.02, 0.17, 0.024), 'glow_main', bevel=0, at=(sx * 0.605, y, 0.075))
        for y in (-0.16, -0.44, -0.69):                 # rivets on the roof's chamfers
            k = (T_Y0 - y) / (T_Y0 - T_Y1)
            b.box((0.03, 0.03, 0.02), 'trim', bevel=0, at=(sx * 0.47, y, 0.47 - 0.24 * k + 0.012), rot=(0, sx * 45, 0))
    # the back: a bulkhead with a service hatch, a vent on the roof
    b.box((0.44, 0.03, 0.15), 'trim', bevel=0.012, at=(0, T_Y1 - 0.012, 0.12))
    b.box((0.34, 0.012, 0.085), 'dark', bevel=0, at=(0, T_Y1 - 0.03, 0.12))
    b.box((0.10, 0.02, 0.02), 'trim', bevel=0, at=(0, T_Y1 - 0.04, 0.12))
    b.box((0.30, 0.012, 0.02), 'glow_main', bevel=0, at=(0, T_Y1 - 0.006, 0.225))
    b.box((0.26, 0.10, 0.05), 'hull', bevel=0.012, at=(0, -0.68, t_top(-0.68) + 0.015), rot=(slope, 0, 0))
    for x in (-0.07, 0.0, 0.07):
        b.box((0.035, 0.07, 0.012), 'dark', bevel=0, at=(x, -0.68, t_top(-0.68) + 0.044), rot=(slope, 0, 0))
    # ground plate under it all
    b.box((1.36, 0.90, 0.022), 'dark', bevel=0, o='b', at=(0, -0.33, 0))

    # --- wing walls beside the ramp, falling toward the back edge, with a lit capping that leads into the mouth
    wall = [(0.94, 0.0), (0.94, 0.12), (0.84, 0.165), (T_Y0 + 0.05, 0.37), (T_Y0 + 0.05, 0.0)]
    a = math.degrees(math.atan2(0.37 - 0.165, 0.84 - T_Y0 - 0.05))
    for sx in (-1, 1):
        x = sx * 0.565
        b.prism(wall, 0.09, 'hull', bevel=0.012, plane='yz', at=(x, 0, 0), sharp=20)
        # (a painted capping with three short lamps: one long strip on a steel cap read as a blown-out white tube in the game)
        b.box((0.11, 0.70, 0.03), 'paint', bevel=0.008, at=(x, 0.495, 0.277), rot=(-a, 0, 0))
        for i in range(3):
            yy = 0.27 + i * 0.225
            b.box((0.05, 0.10, 0.012), 'dark', bevel=0, at=(x, yy, 0.37 - (yy - 0.15) * math.tan(math.radians(a)) + 0.016))
            b.box((0.022, 0.075, 0.012), 'glow_main', bevel=0, at=(x, yy, 0.37 - (yy - 0.15) * math.tan(math.radians(a)) + 0.02))
        b.box((0.11, 0.07, 0.15), 'trim', bevel=0.012, o='b', at=(x, 0.905, 0))                  # end post
        with b.frames(T(rot=(0, 0, 0 if sx > 0 else 180))):
            stripes(b, sx * 0.46 - 0.16, sx * 0.46 + 0.16, 0.03, 0.115, 0.612, k=3, slant=0.04)

    # --- the lights inside the mouth: two frames, the second deeper in
    g = m.node('mouth')
    for y, s in ((0.045, 0.014), (-0.095, 0.014)):
        g.add(band_loft([(y, t_inner(y, s), t_inner(y, s + 0.03)), (y - 0.022, t_inner(y, s), t_inner(y, s + 0.03))]), 'glow_work', **SH)
    # and a lit lip round the opening itself, flush with the portal frame: the one that shows from the bird view
    yl = T_Y0 + 0.076
    g.add(band_loft([(yl, t_inner(T_Y0, 0.0), t_inner(T_Y0, 0.022)), (yl - 0.03, t_inner(T_Y0, 0.0), t_inner(T_Y0, 0.022))]), 'glow_work', **SH)

    # --- roof chevrons: the way the items run (into the ground at an entrance, out of it at an exit)
    for name, turn in (('arrow_in', 0), ('arrow_out', 180)):
        n = m.node(name)
        for y in (-0.115, -0.44):
            n.prism(chevron(0.20, 0.12, 0.075), 0.012, 'glow_main', at=(0, y, t_top(y) + 0.006), rot=(slope, 0, turn))
    return m


# ================================================================== pipe tunnel
def ptunnel():
    m = transit_model('ptunnel', work='#ffc27a')
    b = m.node('body')
    PY = 0.40
    # --- the pit: a hex kerb with hazard stripes on its flats, a dark floor, a light down in it and a grating over it
    b.lathe([(0.67, 0.0), (0.68, 0.015), (0.68, 0.085), (0.645, 0.115), (0.50, 0.115), (0.50, 0.028), (0.0, 0.028)], 'hull', **HEX)
    b.cyl(0.495, 0.005, 'dark', segs=6, phase=30, at=(0, 0, 0.028))
    b.ring(0.47, 0.035, 0.022, 'glow_work', segs=6, phase=30, at=(0, 0, 0.045))
    with b.frames(radial(6)):
        stripes(b, -0.27, 0.27, 0.022, 0.08, 0.68 * 0.8660254 + 0.002, k=5, slant=0.04)
    with b.frames(radial(6, start=30)):
        b.box((0.11, 0.13, 0.14), 'trim', bevel=0.014, o='b', at=(0.635, 0, 0))
    for y in (-0.36, -0.24, -0.12, 0.12, 0.24, 0.36):
        hx = min(0.433, (0.5 - abs(y)) * 1.732) - 0.005
        b.box((2 * hx, 0.022, 0.016), 'trim', bevel=0, at=(0, y, 0.104))
    for x in (-0.25, 0.25):
        b.box((0.022, 0.70, 0.014), 'trim', bevel=0, at=(x, 0, 0.106))
    # --- the riser going down: a painted pipe with a bolted flange
    b.cyl(0.15, 0.25, 'paint', segs=12, at=(0, 0, 0.028))
    b.cyl(0.215, 0.035, 'trim', segs=12, bevel=0.006, at=(0, 0, 0.145))
    b.cyl(0.20, 0.03, 'hull', segs=12, at=(0, 0, 0.18))
    with b.frames(radial(8, radius=0.182, start=22.5)):
        b.box((0.028, 0.028, 0.026), 'trim', bevel=0, at=(0, 0, 0.212))
    # --- the manifold: a hex body with a flanged port on every side (the game's glass arms plug in)
    b.lathe([(0.20, 0.235), (0.30, 0.27), (0.30, 0.51), (0.265, 0.545), (0.0, 0.545)], 'hull', **HEX)
    with b.frames(radial(6)):
        with b.frames(T(at=(0.258, 0, PY), rot=RIGHT)):
            b.cyl(0.148, 0.04, 'trim', segs=10, bevel=0.006)
            b.cyl(0.108, 0.012, 'dark', segs=10, at=(0, 0, 0.034))
            with b.frames(radial(6, radius=0.128, start=30)):
                b.box((0.022, 0.022, 0.016), 'hull', bevel=0, at=(0, 0, 0.044))
    # gusset fins from the kerb up to the manifold, on every second corner; a marker light on the others
    fin = [(0.285, 0.30), (0.285, 0.52), (0.33, 0.52), (0.64, 0.14), (0.64, 0.10), (0.52, 0.10)]
    with b.frames(radial(3, start=30)):
        b.prism(fin, 0.04, 'hull', bevel=0.008, plane='xz', sharp=25)
        b.box((0.20, 0.05, 0.014), 'paint', bevel=0, at=(0.485, 0, 0.345), rot=(0, 50.8, 0))
    with b.frames(radial(3, radius=0.635, start=90)):
        b.cyl(0.035, 0.03, 'glow_main', segs=6, at=(0, 0, 0.14))
    # --- the cap: a bolted lid, the cage of the sight glass, a handwheel
    b.cyl(0.31, 0.04, 'trim', segs=12, bevel=0.008, at=(0, 0, 0.545))
    with b.frames(radial(6, radius=0.265, start=30)):
        b.box((0.03, 0.03, 0.02), 'hull', bevel=0, at=(0, 0, 0.592))
    b.ring(0.19, 0.045, 0.03, 'hull', segs=12, at=(0, 0, 0.598))
    with b.frames(radial(4, radius=0.193, start=45)):
        b.cyl(0.013, 0.16, 'trim', segs=4, at=(0, 0, 0.605))
    b.cyl(0.215, 0.032, 'trim', segs=12, bevel=0.006, at=(0, 0, 0.762))
    b.cyl(0.02, 0.075, 'trim', segs=5, at=(0, 0, 0.79))
    b.torus(0.095, 0.015, 'paint', segs=10, rsegs=4, at=(0, 0, 0.865))
    b.box((0.19, 0.018, 0.014), 'paint', bevel=0, at=(0, 0, 0.865))
    b.box((0.018, 0.19, 0.014), 'paint', bevel=0, at=(0, 0, 0.865))
    return m


MODELS = [splitter, tunnel, ptunnel]
