"""BEATSPIRE resource deposits: iron boulders, copper lode, coal seam, oil breach (public/models/dep_<kind>.glb).

What src/game/facview.ts reads (it takes the geometry only and instances it, turned by any angle, mirrored and a
little scaled; the node offsets are just there so the preview renders show the variants side by side):
  - nodes 'v0' .. 'v3': four variants of the deposit's body, each inside a circle of radius 0.78 round its own
    origin (the game hides it under a building);
  - node 'rim': low rubble for the whole tile, laid out for the hex (flats at +-X, tile 2.0 across the flats; the game
    turns it by multiples of 60 degrees). Nothing in it is higher than 0.12 inside the building plinth (0.88 to the
    flats), so it stays when a Mine or Pumpjack stands on the tile and shows round the plinth;
  - dep_oil also has 'pool': the tar surface (drawn with the game's oil shader), centred, top at z = POOL_Z.
  - One material, everything else is per vertex:
      COLOR_0.rgb  albedo with baked ambient occlusion
      COLOR_0.a    0 .. 0.5: rock, the value is its weathering (rust / patina / dust, times two);
                   0.75 .. 1: a hard surface (deck plate, steel, timber, paint), the value is how metallic it is
      TEXCOORD_0   u: per kind (iron and copper: how much ore, 1 = a nodule of metal, about 0.6 = an ore-bearing
                   break; coal: the strata coordinate), v: per kind (iron, copper: a fresh break; coal: a glossy
                   cleavage face; hard surfaces: grime, on the oil breach tar). The glTF exporter stores 1 - v.
  - The rock is made the way a sculptor would rough it out: a lumpy mass (noise on a sphere, a groove or two), broken
    by planes at any angle, split along a fracture into pieces that sit a little apart, then decimated to its budget.
    No beds, no parallel slabs.
  - Budget: a body 300 to 420 triangles, the rim about 80 (a full map has up to 85 deposit tiles, about 43k triangles
    in all on the largest).
"""
import math
import random

import bpy
import bmesh
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

from vs_lib import hex_rgb, T, rotz

POOL_Z = 0.034
SLOT = 2.3      # preview spacing of the nodes


# --------------------------------------------------------------------------- small maths
def sat(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def sstep(a, b, x):
    t = sat((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def mixc(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def nz(p, f=1.0, o=0.0):
    """Smooth noise 0..1 at a point."""
    return 0.5 + 0.5 * noise.noise(Vector((p[0] * f + o, p[1] * f + o * 1.7, p[2] * f - o * 0.6)))


def hexd(a):
    """Distance from the tile centre to its border in direction a (radians from +X; flats at +-X)."""
    w = (a + math.pi / 6) % (math.pi / 3) - math.pi / 6
    return 1.0 / math.cos(w)


# --------------------------------------------------------------------------- shapes (bmesh)
def hull(pts, dissolve=12.0):
    """Convex polyhedron round a set of points, nearly coplanar triangles merged into facets."""
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    if dissolve:
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(dissolve), verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def cut(bm, co, no, dissolve=12.0):
    """Break off everything on the +no side of a plane and close the break (the shape stays convex)."""
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=co, plane_no=no,
                           clear_outer=True)
    pts = [v.co.copy() for v in bm.verts]
    bm.free()
    return hull(pts, dissolve)


def bevel(bm, off):
    if off > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=off, offset_type='OFFSET', segments=1, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    return bm


def boulder_pts(rng, rx, ry, rz, n=12, jit=0.22):
    pts = []
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - z * z)
        a = i * 2.39996 + rng.uniform(-0.4, 0.4)
        k = 1 + rng.uniform(-jit, jit)
        pts.append((math.cos(a) * r * rx * k, math.sin(a) * r * ry * k, z * rz * k))
    return pts


def slab_pts(rng, rx, ry, th, sides=6, jit=0.2, inset=0.9, zjit=0.08, ajit=0.25):
    """An irregular plate: a polygon at z = 0 and a slightly smaller one at z = th."""
    pts = []
    a0 = rng.uniform(0, math.tau)
    for i in range(sides):
        a = a0 + i * math.tau / sides + rng.uniform(-ajit, ajit)
        k = 1 + rng.uniform(-jit, jit)
        x, y = math.cos(a) * rx * k, math.sin(a) * ry * k
        pts.append((x, y, 0.0))
        pts.append((x * inset, y * inset, th * (1 + rng.uniform(-zjit, zjit))))
    return pts


def box_bm(sx, sy, sz):
    """Plain box standing on z = 0."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z = (v.co.z + 0.5) * sz
    return bm


def cyl_bm(r, h, segs=8, r2=None, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2,
                          depth=h)
    for v in bm.verts:
        v.co.z += h / 2
    return bm


def dome_bm(r, h, segs=6):
    """A low dome: a ring, a smaller ring and a top vertex."""
    bm = bmesh.new()
    lo = [bm.verts.new((math.cos(i * math.tau / segs) * r, math.sin(i * math.tau / segs) * r, 0)) for i in range(segs)]
    mid = [bm.verts.new((math.cos((i + 0.5) * math.tau / segs) * r * 0.66, math.sin((i + 0.5) * math.tau / segs) * r * 0.66,
                         h * 0.72)) for i in range(segs)]
    top = bm.verts.new((0, 0, h))
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((lo[i], lo[j], mid[i]))
        bm.faces.new((lo[j], mid[j], mid[i]))
        bm.faces.new((mid[i], mid[j], top))
    return bm


def disc_bm(r0, r1, segs=6):
    """Flat ring disc (centre fan to r0, annulus to r1) in z = 0, facing +z."""
    bm = bmesh.new()
    c = bm.verts.new((0, 0, 0))
    a = [bm.verts.new((math.cos(i * math.tau / segs) * r0, math.sin(i * math.tau / segs) * r0, 0)) for i in range(segs)]
    b = [bm.verts.new((math.cos(i * math.tau / segs) * r1, math.sin(i * math.tau / segs) * r1, 0)) for i in range(segs)]
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((c, a[i], a[j]))
        bm.faces.new((a[i], b[i], b[j], a[j]))
    return bm


# --------------------------------------------------------------------------- model / parts
class Part:
    """One node: pieces are stamped in with a paint function each; AO and the colours are worked out at the end."""

    def __init__(self, name, at=(0, 0, 0)):
        self.name = name
        self.at = at
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Color')
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.pid = self.bm.faces.layers.int.new('pid')
        self.paints = []
        self.ao_floor = 0.42
        self.sharp = 38.0

    def add(self, bm, M=None, paint=None, ground=True, drop=None):
        """Stamp a piece (bm is freed). ground: cut away what lies under the deck. drop: a direction; faces looking
        that way are left out (undersides resting on another piece)."""
        if M is not None:
            bm.transform(M)
        bm.normal_update()
        if drop is not None:
            d = Vector(drop).normalized()
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.dot(d) > 0.96], context='FACES')
        if ground:
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=(0, 0, -0.004),
                                   plane_no=(0, 0, 1), clear_inner=True)
        self.paints.append(paint)
        k = len(self.paints) - 1
        vmap = {}
        for v in bm.verts:
            vmap[v] = self.bm.verts.new(v.co)
        for f in bm.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.smooth = True
            nf[self.pid] = k
        bm.free()
        return self

    def mesh(self):
        bm = self.bm
        for v in [v for v in bm.verts if not v.link_faces]:
            bm.verts.remove(v)
        bm.normal_update()
        ao = ambient(bm)
        for f in bm.faces:
            paint = self.paints[f[self.pid]]
            for l in f.loops:
                v = l.vert
                o = ao[v.index]
                c = paint(v.co, v.normal, f.normal, o) if paint else (0.5, 0.5, 0.5, 0, 0, 0)
                k = self.ao_floor + (1 - self.ao_floor) * o
                l[self.col] = (c[0] * k, c[1] * k, c[2] * k, sat(c[3]))
                l[self.uv].uv = (c[4], sat(c[5]))
        lim = math.radians(self.sharp)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                e.smooth = e.calc_face_angle(0.0) < lim
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        me.color_attributes.active_color = me.color_attributes['Color']
        me.color_attributes.render_color_index = me.color_attributes.find('Color')
        return me


_DIRS = []
for _i in range(28):
    _z = 0.08 + 0.92 * (_i + 0.5) / 28
    _r = math.sqrt(1 - _z * _z)
    _DIRS.append(Vector((math.cos(_i * 2.39996) * _r, math.sin(_i * 2.39996) * _r, _z)))


def ambient(bm, reach=0.3):
    """Ambient occlusion per vertex (0 buried .. 1 open): rays over the hemisphere against the part and the deck."""
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    tree = BVHTree.FromBMesh(bm, epsilon=0.0)
    out = []
    for v in bm.verts:
        n = v.normal if v.normal.length > 0.5 else Vector((0, 0, 1))
        t = n.orthogonal().normalized()
        b = n.cross(t)
        o = v.co + n * 0.006
        hit = 0.0
        for d in _DIRS:
            w = t * d.x + b * d.y + n * d.z
            if w.z < -0.05 and o.z / -w.z < reach:
                hit += 1 - (o.z / -w.z) / reach * 0.5
                continue
            h = tree.ray_cast(o, w, reach)
            if h[0] is not None:
                hit += 1 - h[3] / reach * 0.6
        out.append(sat(1 - hit / len(_DIRS)) ** 0.85)
    return out


class DepModel:
    export_kw = dict(export_texcoords=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False)

    def __init__(self, name):
        self.name = name
        self.parts = []

    def part(self, name, slot):
        p = Part(name, (slot * SLOT, 0, 0))
        self.parts.append(p)
        return p

    def finish(self):
        col = bpy.context.scene.collection
        root = bpy.data.objects.new(self.name, None)
        col.objects.link(root)
        mat = bpy.data.materials.new('rock')
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        ca = nt.nodes.new('ShaderNodeVertexColor')
        ca.layer_name = 'Color'
        nt.links.new(ca.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.7
        bsdf.inputs['Metallic'].default_value = 0.1
        objs = []
        for p in self.parts:
            me = p.mesh()
            me.materials.append(mat)
            ob = bpy.data.objects.new(p.name, me)
            col.objects.link(ob)
            ob.parent = root
            ob.location = p.at
            mod = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
            mod.keep_sharp = True
            mod.weight = 50
            objs.append(ob)
        print('[dep] %s reach/height: %s' % (self.name, ', '.join('%s %.2f/%.2f' % (ob.name, max(math.hypot(v.co.x, v.co.y) for v in ob.data.vertices), max(v.co.z for v in ob.data.vertices)) for ob in objs)))
        return root, objs


def lin(h):
    return hex_rgb(h)


# --------------------------------------------------------------------------- rock
def rnd_unit(rng):
    while True:
        v = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
        if v.length > 1e-3:
            return v.normalized()


def bm_tris(bm):
    return sum(len(f.verts) - 2 for f in bm.faces)


def decimate(bm, tris):
    """Collapse a bmesh down to about `tris` triangles (bm is replaced)."""
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    n = len(bm.faces)
    if n <= tris:
        return bm
    me = bpy.data.meshes.new('_dec')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('_dec', me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('d', 'DECIMATE')
    mod.ratio = tris / n
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = ob.evaluated_get(dg)
    out = bmesh.new()
    out.from_mesh(ev.to_mesh())
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bmesh.ops.recalc_face_normals(out, faces=out.faces[:])
    return out


def plane_cut(bm, co, no, keep_outer=False):
    """Break off one side of a plane and close the break with a flat face."""
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=co, plane_no=no,
                                 clear_outer=not keep_outer, clear_inner=keep_outer)
    es = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if es:
        bmesh.ops.edgeloop_fill(bm, edges=es)
    return bm


def rock(rng, rx, ry, rz, tris=110, sub=3, lump=0.3, cuts=8, depth=(0.6, 0.95), grooves=1):
    """A fractured mass: a lumpy sphere with a groove or two, broken by planes at any angle, decimated."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    o = Vector((rng.uniform(0, 50), rng.uniform(0, 50), rng.uniform(0, 50)))
    gs = [(rnd_unit(rng), rng.uniform(-0.3, 0.3), rng.uniform(0.1, 0.2), rng.uniform(0.1, 0.16)) for _ in range(grooves)]
    for v in bm.verts:
        d = v.co.normalized()
        k = 1 + 1.6 * lump * noise.noise(d * 1.3 + o) + 0.8 * lump * noise.noise(d * 3.1 + o * 1.7)
        for (gn, g0, gd, gw) in gs:
            e = (d.dot(gn) - g0) / gw
            k -= gd * math.exp(-e * e) * (0.5 + nz(d, 2.0, o.x))
        v.co = d * k
    for i in range(cuts):
        n = rnd_unit(rng)
        if n.z < -0.25:
            n.z = -n.z          # the breaks that show
        plane_cut(bm, n * rng.uniform(*depth), n)
    for v in bm.verts:
        v.co.x *= rx
        v.co.y *= ry
        v.co.z *= rz
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(4), verts=bm.verts[:], edges=bm.edges[:])
    bm = decimate(bm, tris)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(2.5), verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def split(rng, bm, gap=0.016, turn=5.0, at=0.0):
    """Split a mass along a fracture through it: two pieces, a little apart and turned against each other."""
    n = rnd_unit(rng)
    n.z *= 0.35
    n.normalize()
    c = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
    co = c + n * at
    n0 = bm_tris(bm)
    a = bm.copy()
    plane_cut(a, co, n)
    plane_cut(bm, co, n, keep_outer=True)
    out = []
    for piece, s in ((a, -1), (bm, 1)):
        if len(piece.faces) < 4:
            piece.free()
            continue
        pc = sum((v.co for v in piece.verts), Vector()) / len(piece.verts)
        M = Matrix.Translation(pc + n * (s * gap * 0.5) + Vector((0, 0, -rng.uniform(0, 0.012)))) @ \
            T(rot=(rng.uniform(-turn, turn), rng.uniform(-turn, turn), rng.uniform(-turn, turn))) @ Matrix.Translation(-pc)
        piece.transform(M)
        bmesh.ops.dissolve_limit(piece, angle_limit=math.radians(2.5), verts=piece.verts[:], edges=piece.edges[:])
        piece = decimate(piece, max(12, int(n0 * 0.62)))
        out.append(piece)
    return out


def big_face(bm, zmin=0.1, zmax=0.9, toward=None):
    """The normal of the largest break that shows (facing up and out)."""
    best, bn = 0.0, None
    acc = {}
    for f in bm.faces:
        n = f.normal
        if n.z < zmin or n.z > zmax:
            continue
        key = (round(n.x * 12), round(n.y * 12), round(n.z * 12))
        a = f.calc_area() * (1.0 if toward is None else 0.4 + sat(n.dot(toward)))
        acc[key] = (acc.get(key, (0, None))[0] + a, n.copy())
    for a, n in acc.values():
        if a > best:
            best, bn = a, n
    return bn


def surface_hits(part, rng, n, c=(0, 0, 0.1), zmin=0.25, spread=1.0, near=None, cone=0.5):
    """Points on what is already in the part, seen from above and outside: [(point, normal)]."""
    bm = part.bm
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm, epsilon=0.0)
    out = []
    tries = 0
    while len(out) < n and tries < n * 30:
        tries += 1
        if near is not None:
            d = (near + rnd_unit(rng) * cone).normalized()
        else:
            d = rnd_unit(rng)
        if d.z < zmin:
            continue
        tgt = Vector(c) + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.25 * spread
        h = tree.ray_cast(tgt + d * 2.0, -d, 3.0)
        if h[0] is None or h[0].z < 0.04:
            continue
        out.append((h[0], h[1], d))
    return out


def chunk(rng, s, n=7, squash=0.8, jit=0.18):
    return hull(boulder_pts(rng, s * 1.1, s, s * squash, n=n, jit=jit), 0)


def nodule(rng, s, squash=0.8, lump=0.16):
    """A rounded knob of ore (kidney ore): a small lumpy sphere, smooth, its underside (sunk in the rock) left out."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    o = Vector((rng.uniform(0, 50), rng.uniform(0, 50), rng.uniform(0, 50)))
    for v in bm.verts:
        k = 1 + lump * 2.0 * noise.noise(v.co * 1.4 + o)
        v.co = Vector((v.co.x * s * 1.1 * k, v.co.y * s * k, v.co.z * s * squash * k))
    bm.transform(Matrix.Rotation(rng.uniform(0, 6.28), 4, 'Z') @ T(rot=(rng.uniform(-15, 15), rng.uniform(-15, 15), 0)))
    bm.normal_update()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.6 * s * squash], context='VERTS')
    return bm


def onto(p, nrm, sink=0.0, spin=0.0):
    """A frame at a point of a surface: +z along the normal."""
    z = nrm.normalized()
    x = z.orthogonal().normalized()
    y = z.cross(x)
    R = Matrix((x, y, z)).transposed().to_4x4()
    return Matrix.Translation(p - z * sink) @ R @ Matrix.Rotation(spin, 4, 'Z')


# --------------------------------------------------------------------------- hard surfaces
STEEL = lin('#7d8087')
PLATE = lin('#3c3840')
PLATE_LT = lin('#4b464d')
RUSTY = lin('#7a4424')
RUST_LT = lin('#a85a2a')
HAZARD = lin('#d9a21e')
PIPE = lin('#6a4a38')
VALVE = lin('#b5301c')
WOOD = lin('#75603f')
WOOD_DK = lin('#6a5238')


def hard(c, metal=1.0, grime=0.0, seed=0.0, var=0.0, low=0.0):
    """A hard surface: colour, how metallic, how grimy (low: extra grime near the deck)."""
    def f(p, n, fn, ao):
        w = nz(p, 7.0, seed)
        cc = mixc(c, (c[0] * 0.6, c[1] * 0.6, c[2] * 0.6), var * w)
        g = sat(grime + low * sat(1 - p.z * 7.0) + 0.6 * (1 - ao) * (grime + low))
        return (*cc, 0.75 + 0.25 * metal, 0.0, g)
    return f


def plate_paint(seed, stripe=None, tar_r=0.0, grime=0.25):
    """Deck plate: worn metal on top, the torn edge raw and rusting. Grime (tar on the oil breach) creeps up from the
    middle (tar_r: how far out) or lies in patches."""
    def f(p, n, fn, ao):
        r = math.hypot(p.x, p.y)
        w = nz(p, 6.0, seed)
        top = fn.z > 0.6
        c = mixc(PLATE, PLATE_LT, w)
        metal = 0.35
        if not top:
            c = mixc(RUSTY, PLATE, 0.45 + 0.4 * w)
            metal = 0.1
        elif stripe is not None:
            u = p.x * stripe[0] + p.y * stripe[1]
            if int(math.floor(u * 8.0)) % 2 == 0 and stripe[2] < r < stripe[3]:
                c, metal = mixc(HAZARD, PLATE, 0.2 * w), 0.0
        rust = sat((1 - ao) * 0.7 + 0.5 * nz(p, 9, seed + 5) - 0.5)
        c = mixc(c, RUSTY, 0.45 * rust)
        if tar_r > 0:
            g = sat(1.15 - (r - tar_r * 0.75) / (tar_r * 0.5) + 0.5 * (nz(p, 5, seed + 2) - 0.5) - p.z * 2.5)
        else:
            g = sat(grime * (0.4 + 1.2 * nz(p, 7, seed)) + 0.5 * (1 - ao) - 0.1)
        return (*c, 0.75 + 0.25 * metal * (1 - 0.6 * rust), 0.0, g)
    return f


def shard(rng, ro, L, half, th=0.05):
    """A torn piece of deck plate in its own frame: the hinge edge on x = 0 (y from -w to w), the torn point at -x."""
    w = math.sin(half) * ro
    pts2 = [(0, -w * rng.uniform(0.85, 1.0)), (0, w * rng.uniform(0.85, 1.0)),
            (-L * rng.uniform(0.6, 0.95), w * rng.uniform(0.3, 0.75)),
            (-L * rng.uniform(1.0, 1.15), rng.uniform(-0.3, 0.3) * w),
            (-L * rng.uniform(0.6, 0.95), -w * rng.uniform(0.3, 0.75))]
    return hull([(x, y, 0) for x, y in pts2] + [(x * 0.97 - 0.004, y * 0.95, th) for x, y in pts2], 5)


def lifted_deck(part, rng, n, ro=(0.68, 0.77), L=(0.3, 0.42), tilt=(10, 26), seed=0.0, a0=None, arc=math.tau, grime=0.3,
                stripe_at=-1):
    """Deck plates the rock broke through: torn shards hinged on the deck round the body, their points lifted."""
    a0 = rng.uniform(0, math.tau) if a0 is None else a0
    for i in range(n):
        a = a0 + (i + rng.uniform(-0.25, 0.25)) * arc / n
        r = rng.uniform(*ro)
        half = rng.uniform(0.26, 0.4)
        bm = shard(rng, r, rng.uniform(*L), half)
        M = rotz(math.degrees(a)) @ Matrix.Translation((r * math.cos(half), 0, 0)) @ T(rot=(rng.uniform(-6, 6), rng.uniform(*tilt), rng.uniform(-8, 8)))
        st = (math.cos(a + 1.0), math.sin(a + 1.0), 0.0, 9.0) if i == stripe_at else None
        part.add(bm, M, plate_paint(seed + i * 3.1, st, grime=grime), drop=M.to_3x3() @ Vector((0, 0, -1)))


def scatter(part, rng, make, n, lo=0.62, hi=0.96, outer=3):
    """Low rubble round the tile for the 'rim' node: n pieces, the first `outer` right at the border (outside a
    building's plinth), the rest further in and flat. make(rng, size, flat) -> (bmesh, paint)."""
    a0 = rng.uniform(0, math.tau)
    for i in range(n):
        a = a0 + i * math.tau / n + rng.uniform(-0.3, 0.3)
        out = i < outer or i % 3 == 0
        u = rng.uniform(0.9, 0.95) if out else rng.uniform(lo, 0.84)
        r = hexd(a) * u
        size = rng.uniform(0.035, 0.05) if out else rng.uniform(0.05, 0.09)
        bm, paint = make(rng, size, not out)
        M = Matrix.Translation((math.cos(a) * r, math.sin(a) * r, size * rng.uniform(0.15, 0.45))) @ \
            T(rot=(rng.uniform(-25, 25), rng.uniform(-25, 25), rng.uniform(0, 360)))
        part.add(bm, M, paint)


def masses(part, rng, specs, paint, az, grow=1.0, tk=1.0, base=None):
    """Stamp a group of rock masses. specs: (rx, ry, rz, r, da, tris, splits[, kw]) with r, da the place in polar
    form round the body's own direction az. paint(k, bm) -> a paint function. Returns [(centre, radii)]."""
    out = []
    for k, sp in enumerate(specs):
        rx, ry, rz, r, da, tris, splits = sp[:7]
        rx, ry, rz, r = rx * grow, ry * grow, rz * grow, r * (0.72 + 0.28 * grow)
        kw = dict(base or {})
        kw.update(sp[7] if len(sp) > 7 else {})
        bm = rock(rng, rx, ry, rz, tris=int(tris * tk), **kw)
        a = az + da
        c = Vector((math.cos(a) * r, math.sin(a) * r, rz * rng.uniform(0.3, 0.45)))
        bm.transform(Matrix.Translation(c) @ T(rot=(rng.uniform(-16, 16), rng.uniform(-16, 16), rng.uniform(0, 360))))
        pieces = [bm]
        for s in range(splits):
            big = max(pieces, key=lambda b: len(b.faces))
            pieces.remove(big)
            pieces += split(rng, big, at=rng.uniform(-0.3, 0.3) * min(rx, ry))
        for j, pc in enumerate(pieces):
            pc.normal_update()
            part.add(pc, None, paint(k * 7 + j, pc))
        out.append((c, (rx, ry, rz)))
    return out


# --------------------------------------------------------------------------- iron
IR_ROCK = lin('#696b72')
IR_DARK = lin('#46474d')
IR_DUST = lin('#85878d')
IR_ORE = lin('#5586d2')
IR_ORE_HI = lin('#96b6ea')


def iron_paint(seed, oreN=None, rust=1.0, fresh=0.0):
    """a: rust. u: ore (about 0.6 on the ore-bearing break). v: fresh break."""
    def f(p, n, fn, ao):
        w = nz(p, 3.2, seed)
        up = sat(fn.z)
        c = mixc(IR_DARK, IR_ROCK, 0.25 + 0.75 * w)
        c = mixc(c, IR_DUST, 0.4 * up * up)
        ore, fr = 0.0, fresh
        if oreN is not None and fn.dot(oreN) > 0.985:
            ore, fr = 0.62, 1.0
            c = mixc(c, IR_DARK, 0.45)
        r = sat((1 - ao) * 1.5 - 0.35 + 0.8 * (nz(p, 4.5, seed + 9) - 0.5)) * rust
        r = max(r, sat(0.6 - p.z * 5.0) * (1 - up) * sat(nz(p, 5.0, seed + 3) * 1.6 - 0.55) * rust)   # run-off down the flanks
        return (*c, 0.5 * r * 0.75, ore, fr)
    return f


def nodule_paint(seed):
    """A nodule of metallic ore standing out of the rock: steel blue, rusting where it meets the stone."""
    def f(p, n, fn, ao):
        w = nz(p, 13.0, seed)
        c = mixc(IR_ORE, IR_ORE_HI, w * sat(fn.z + 0.4))
        return (*c, 0.5 * sat((1 - ao) * 1.5 - 0.35), 1.0, 1.0)
    return f


# boulders: rounded lumpy masses with a few fracture faces (many flat facets catch the lamps one by one and read as slabs)
IRON_ROCK = dict(cuts=3, depth=(0.7, 0.92), lump=0.36, grooves=2)

IRON_STYLES = [
    # a tall boulder split in two, a shoulder, a cobble
    [(0.36, 0.31, 0.44, 0.13, 3.1, 129, 0), (0.27, 0.23, 0.24, 0.36, 0.5, 72, 0), (0.15, 0.13, 0.13, 0.5, -1.5, 29, 0)],
    # a wide broken back with a leaning shard
    [(0.44, 0.32, 0.32, 0.1, 3.3, 129, 1), (0.2, 0.17, 0.36, 0.3, 0.2, 60, 0, dict(lump=0.25, cuts=5, depth=(0.6, 0.85))), (0.16, 0.13, 0.12, 0.52, 1.9, 29, 0)],
    # three boulders heaped
    [(0.31, 0.28, 0.36, 0.2, 2.4, 94, 0), (0.3, 0.25, 0.28, 0.24, 5.4, 86, 1), (0.22, 0.19, 0.2, 0.36, 0.5, 55, 0)],
    # one block cracked through, pieces fallen away from it
    [(0.42, 0.37, 0.4, 0.06, 3.0, 163, 1), (0.19, 0.16, 0.15, 0.5, 0.3, 39, 0), (0.13, 0.11, 0.1, 0.52, -1.6, 25, 0)],
]


def iron_core(part, seed, style):
    rng = random.Random(seed)
    part.sharp = 50.0
    az = rng.uniform(0, math.tau)
    out = Vector((math.cos(az), math.sin(az), 0.5)).normalized()
    lifted_deck(part, rng, 2, seed=seed, a0=az + rng.uniform(1.6, 2.6), arc=math.tau * 0.6, grime=0.2)
    spots = masses(part, rng, IRON_STYLES[style], lambda k, bm: iron_paint(seed + k, big_face(bm, toward=out) if k % 7 == 0 else None, fresh=0.25), az, 1.4, tk=0.85, base=IRON_ROCK)
    # nodules of ore: two clusters where the rock shows them, and a couple weathered out at its foot
    part.sharp = 50.0
    groups = []
    for ci in range(3):
        c, rad = spots[ci % 2]
        hits = surface_hits(part, rng, 1, c=c, zmin=0.35, spread=0.5)
        if not hits:
            continue
        p0, n0, d0 = hits[0]
        groups.append([(p0, n0)] + [(h[0], h[1]) for h in surface_hits(part, rng, 3, c=c, zmin=0.2, spread=0.3, near=d0, cone=0.26)])
    for ci, group in enumerate(groups):
        for i, (p, nrm) in enumerate(group):
            s = rng.uniform(0.125, 0.15) if i == 0 else rng.uniform(0.075, 0.105)
            part.add(nodule(rng, s), onto(p, nrm, sink=s * 0.3, spin=rng.uniform(0, 6)), nodule_paint(seed + ci * 5 + i), ground=False)
    for i in range(2):
        a = az + rng.uniform(-1.3, 1.3)
        r = rng.uniform(0.6, 0.72)
        s = rng.uniform(0.055, 0.07)
        part.add(nodule(rng, s), Matrix.Translation((math.cos(a) * r, math.sin(a) * r, s * 0.3)), nodule_paint(seed + 20 + i))


def iron_chip(rng, size, flat):
    if rng.random() < 0.14:
        return chunk(rng, size * 0.75, n=6), nodule_paint(rng.uniform(0, 50))
    bm = hull(boulder_pts(rng, size * 1.3, size, size * (0.5 if flat else 0.8), n=6, jit=0.3), 0)
    return bm, iron_paint(rng.uniform(0, 50), None, rust=1.3)


def dep_iron():
    m = DepModel('dep_iron')
    for v, seed in enumerate((11, 23, 37, 52)):
        iron_core(m.part('v%d' % v, v - 2), seed, v)
    scatter(m.part('rim', 2), random.Random(5), iron_chip, 8)
    return m


# --------------------------------------------------------------------------- copper
CU_ROCK = lin('#8a6650')
CU_DARK = lin('#3d2e28')
CU_OX = lin('#8f5a3a')
CU_METAL = lin('#e88a42')
CU_BRIGHT = lin('#ffbe7a')
MALACHITE = lin('#2fa37a')


def copper_paint(seed, oreN=None, pat=1.0, fresh=0.2):
    """a: patina, strongest on sheltered and upward faces. u: ore (about 0.6 on the break the veins show on). v: fresh."""
    def f(p, n, fn, ao):
        w = nz(p, 3.0, seed)
        c = mixc(CU_DARK, CU_ROCK, 0.25 + 0.75 * w)
        c = mixc(c, CU_OX, 0.55 * nz(p, 5.5, seed + 4))
        ore, fr = 0.0, fresh
        if oreN is not None and fn.dot(oreN) > 0.985:
            c = mixc(c, CU_OX, 0.4)
            ore, fr = 0.62, 1.0
        up = sat(n.z * 0.9 + 0.1)
        a = sat(0.7 * up * (0.3 + nz(p, 3.6, seed + 7)) + (1 - ao) * 0.7 - 0.22) * pat
        if ore:
            a *= 0.35
        return (*c, 0.5 * a, ore, fr)
    return f


def nugget_paint(seed):
    """Native copper: metal (u = 1), tarnishing to patina in the hollows and on top."""
    def f(p, n, fn, ao):
        w = nz(p, 14.0, seed)
        c = mixc(CU_METAL, CU_BRIGHT, w * 0.7)
        t = sat((1 - ao) * 1.3 + 0.5 * sat(fn.z) * nz(p, 9.0, seed + 2) - 0.25)
        return (*c, 0.5 * t, 1.0, 1.0)
    return f


def crust_paint(seed):
    """Malachite: all patina."""
    def f(p, n, fn, ao):
        c = mixc(MALACHITE, lin('#7fd9b0'), 0.6 * sat(n.z) * nz(p, 12, seed))
        return (*c, 0.5, 0.0, 0.0)
    return f


COPPER_STYLES = [
    [(0.4, 0.33, 0.33, 0.1, 3.1, 129, 1), (0.27, 0.22, 0.2, 0.4, 0.9, 65, 0), (0.14, 0.12, 0.11, 0.52, -1.4, 25, 0)],
    [(0.36, 0.3, 0.3, 0.14, 2.8, 111, 1), (0.3, 0.24, 0.24, 0.3, 5.6, 77, 0), (0.13, 0.11, 0.1, 0.55, 0.6, 25, 0)],
    [(0.45, 0.34, 0.28, 0.08, 3.2, 146, 2), (0.2, 0.17, 0.3, 0.38, 0.4, 60, 0, dict(lump=0.2, cuts=10, depth=(0.5, 0.8))), (0.13, 0.11, 0.1, 0.5, -2.0, 24, 0)],
    [(0.33, 0.3, 0.4, 0.16, 3.4, 120, 1), (0.28, 0.24, 0.2, 0.34, 0.8, 68, 0), (0.18, 0.15, 0.14, 0.46, -1.2, 34, 0)],
]


def copper_core(part, seed, style):
    rng = random.Random(seed)
    part.sharp = 50.0
    az = rng.uniform(0, math.tau)
    out = Vector((math.cos(az), math.sin(az), 0.5)).normalized()
    lifted_deck(part, rng, 2, seed=seed, a0=az + rng.uniform(1.6, 2.6), arc=math.tau * 0.6, grime=0.2)
    spots = masses(part, rng, COPPER_STYLES[style], lambda k, bm: copper_paint(seed + k, big_face(bm, toward=out) if k % 7 == 0 else None), az, 1.34)
    # native copper: bright nuggets grown out of the break, small ones fallen out in front
    c, rad = spots[0]
    hits = surface_hits(part, rng, 1, c=c, zmin=0.3, spread=0.4, near=out, cone=0.5)
    if hits:
        p0, n0, d0 = hits[0]
        group = [(p0, n0)] + [(h[0], h[1]) for h in surface_hits(part, rng, 3, c=c, zmin=0.2, spread=0.3, near=d0, cone=0.4)]
        for i, (p, nrm) in enumerate(group):
            s = rng.uniform(0.1, 0.125) if i == 0 else rng.uniform(0.06, 0.08)
            part.add(chunk(rng, s, n=8 if i == 0 else 6, squash=0.85), onto(p, nrm, sink=s * 0.25, spin=rng.uniform(0, 6)), nugget_paint(seed + i))
    for i in range(3):
        a = az + rng.uniform(-1.0, 1.0)
        r = rng.uniform(0.48, 0.68)
        s = rng.uniform(0.035, 0.055)
        part.add(chunk(rng, s, n=6), Matrix.Translation((math.cos(a) * r, math.sin(a) * r, s * 0.45)) @ T(rot=(rng.uniform(0, 360), rng.uniform(0, 360), 0)), nugget_paint(seed + 10 + i))
    # malachite: a crust of low green knobs on the lee side
    lee = Vector((-math.cos(az), -math.sin(az), 0.7)).normalized()
    for i, (p, nrm, d) in enumerate(surface_hits(part, rng, 5, c=spots[0][0], zmin=0.3, spread=1.2, near=lee, cone=0.6)):
        s = rng.uniform(0.05, 0.085)
        part.add(dome_bm(s, s * 0.7), onto(p, nrm, sink=s * 0.2, spin=rng.uniform(0, 6)), crust_paint(seed + i), ground=False)


def copper_chip(rng, size, flat):
    if rng.random() < 0.4:
        s = size * 0.7
        return hull(boulder_pts(rng, s * 1.1, s, s * 0.8, n=6, jit=0.3), 0), nugget_paint(rng.uniform(0, 50))
    bm = hull(boulder_pts(rng, size * 1.3, size, size * (0.5 if flat else 0.8), n=6, jit=0.3), 0)
    return bm, copper_paint(rng.uniform(0, 50), None, pat=1.3, fresh=0.6)


def dep_copper():
    m = DepModel('dep_copper')
    for v, seed in enumerate((5, 19, 42, 63)):
        copper_core(m.part('v%d' % v, v - 2), seed, v)
    scatter(m.part('rim', 2), random.Random(8), copper_chip, 8)
    return m


# --------------------------------------------------------------------------- coal
COAL = lin('#131313')
COAL_LT = lin('#222120')
COAL_DUST = lin('#1b1a19')
COAL_SHEEN = lin('#8b8f9a')
RAIL = lin('#8a4a26')
RAIL_TOP = lin('#8f8a86')


def fhash(n, seed):
    h = math.sin(round(n.x * 9) * 12.9898 + round(n.y * 9) * 78.233 + round(n.z * 9) * 37.719 + seed * 3.1) * 43758.5453
    return h - math.floor(h)


def coal_paint(seed, bedN, dust=1.0, gloss=0.55):
    """a: dust lying on it. u: strata coordinate. v: 1 on a glossy cleavage face (about every second break)."""
    def f(p, n, fn, ao):
        up = sat(fn.z)
        glossy = fhash(fn, seed) < gloss and fn.z > -0.3
        c = COAL_SHEEN if glossy else mixc(COAL, COAL_LT, nz(p, 4.0, seed) * 0.7)
        d = sat((0.3 + 0.7 * nz(p, 5.0, seed + 3)) * up * up * 0.8 + (1 - ao) * 0.6 - 0.12 + 0.6 * sat(0.5 - p.z * 6.0)) * dust
        if glossy:
            d *= 0.3
        return (*mixc(c, COAL_DUST, 0.5 * d), 0.5 * d, p.dot(bedN), 1.0 if glossy else 0.2)
    return f


def soot(seed):
    def f(p, n, fn, ao):
        return (*mixc(COAL_DUST, COAL, 0.5 * nz(p, 6, seed)), 0.5, 0.0, 0.0)
    return f


def beam(sx, sy, sz):
    """A timber or rail lying along +x from x = 0, standing on z = 0."""
    bm = box_bm(sx, sy, sz)
    bm.transform(Matrix.Translation((sx / 2, 0, 0)))
    return bm


def track(part, rng, seed, a, r0, r1, gauge=0.15, sleepers=4, skew=1.0, off=0.0):
    """Old mine-cart track from r0 out to r1 in direction a: timber sleepers, two rusty rails with worn tops."""
    Tm = rotz(math.degrees(a)) @ Matrix.Translation((r0, off, 0)) @ T(rot=(0, rng.uniform(-2.5, 1.0), rng.uniform(-4, 4)))
    L = r1 - r0
    wood = hard(WOOD, 0.0, 0.25, seed, var=0.8, low=0.5)
    for i in range(sleepers):
        x = L * (i + 0.5) / sleepers + rng.uniform(-0.02, 0.02)
        part.add(box_bm(0.06, gauge + 0.13, 0.036), Tm @ Matrix.Translation((x, rng.uniform(-0.015, 0.015), 0.0)) @ T(rot=(0, 0, rng.uniform(-9, 9) * skew)),
                 wood, drop=(0, 0, -1))
    for s in (-1, 1):
        ln = L * (rng.uniform(0.72, 0.86) if s * skew > 0.5 else 1.0)
        R = Tm @ Matrix.Translation((0, s * gauge / 2, 0.038)) @ T(rot=(0, 0, rng.uniform(-1.5, 1.5) * skew))
        part.add(beam(ln, 0.03, 0.035), R, lambda p, n, fn, ao: (*(RAIL_TOP if fn.z > 0.7 else RAIL), 0.98 if fn.z > 0.7 else 0.8, 0.0, 0.0 if fn.z > 0.7 else 0.35),
                 ground=False, drop=R.to_3x3() @ Vector((0, 0, -1)))
    return Tm


def adit(part, rng, seed, a, r, h=0.3, w=0.3):
    """A timbered mine mouth facing direction a at radius r: two props, a cap timber over them, black behind."""
    A = rotz(math.degrees(a)) @ Matrix.Translation((r, 0, 0))
    wood = hard(WOOD, 0.0, 0.2, seed + 1, var=0.8, low=0.4)
    for s in (-1, 1):
        part.add(box_bm(0.062, 0.062, h), A @ Matrix.Translation((0, s * w / 2, 0)) @ T(rot=(-s * 5, rng.uniform(-4, 2), 0)), wood, drop=(0, 0, -1))
    part.add(box_bm(0.07, w + 0.2, 0.068), A @ Matrix.Translation((0, 0, h - 0.015)) @ T(rot=(rng.uniform(-4, 4), 0, rng.uniform(-3, 3))), wood, ground=False)
    # the dark of the drift
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in ((-0.03, -w / 2, 0.0), (-0.03, w / 2, 0.0), (-0.03, w / 2, h), (-0.03, -w / 2, h))]
    bm.faces.new(vs)
    part.add(bm, A, lambda p, n, fn, ao: (0.002, 0.002, 0.002, 0.5, 0.0, 0.0), ground=False)


COAL_SHARD = dict(sub=2, lump=0.14, cuts=12, depth=(0.42, 0.72), grooves=0)


def coal_core(part, seed, style):
    rng = random.Random(seed)
    az = rng.uniform(0, math.tau)
    part.ao_floor = 0.5
    dip = math.radians(rng.uniform(18, 32))
    bedN = Vector((-math.cos(az) * math.sin(dip), -math.sin(az) * math.sin(dip), math.cos(dip)))
    # the fines banked up round the foot of the seam: a wide low black skirt
    sk = bmesh.new()
    top = sk.verts.new((0, 0, 0.05))
    N = 11
    a0 = rng.uniform(0, 1)
    ang = [a0 + i * math.tau / N + rng.uniform(-0.2, 0.2) for i in range(N)]
    rad = [rng.uniform(0.44, 0.66) * (0.8 if i % 3 == 1 else 1.0) for i in range(N)]
    mid = [sk.verts.new((math.cos(ang[i]) * rad[i] * 0.55, math.sin(ang[i]) * rad[i] * 0.55, rng.uniform(0.022, 0.036))) for i in range(N)]
    rim = [sk.verts.new((math.cos(ang[i]) * rad[i], math.sin(ang[i]) * rad[i], 0.0)) for i in range(N)]
    for i in range(N):
        j = (i + 1) % N
        sk.faces.new((top, mid[i], mid[j]))
        sk.faces.new((mid[i], rim[i], rim[j], mid[j]))
    part.add(sk, None, soot(seed), ground=False)
    # the outcrop: ONE seam breaking through, a row of big angular blocks shoulder to shoulder along the strike, all
    # leaning the same way with the dip, tallest near the middle: a jagged crest, not a heap
    strike = az + math.pi / 2
    us = ((-0.4, -0.19, 0.19, 0.4), (-0.42, -0.21, 0.0, 0.21, 0.42), (-0.4, -0.19, 0.19, 0.4), (-0.41, -0.2, 0.2, 0.41))[style]
    blocks = [(u, -0.1 - 0.1 * math.cos(u * 3.0), 1.0 - 1.1 * abs(u)) for u in us]
    if len(us) == 4:
        blocks.append((rng.uniform(-0.04, 0.04), -0.3, 1.15))     # the mass the drift or the track runs into
    peak = rng.randrange(len(us))
    for i, (u, back, hk) in enumerate(blocks):
        hk *= 1.2 if i == peak else rng.uniform(0.85, 1.05)
        rx, ry, rz = rng.uniform(0.25, 0.31), rng.uniform(0.2, 0.25), 0.2 + 0.3 * hk
        bm = rock(rng, rx, ry, rz, tris=58 if hk > 0.7 else 44, **COAL_SHARD)
        back += rng.uniform(-0.03, 0.03)
        c = Vector((math.cos(strike) * u * 1.12 + math.cos(az) * back, math.sin(strike) * u * 1.12 + math.sin(az) * back, rz * 0.3))
        M = Matrix.Translation(c) @ rotz(math.degrees(az) + rng.uniform(-13, 13)) @ T(rot=(rng.uniform(-10, 10), -math.degrees(dip) - rng.uniform(0, 16), 0))
        bm.transform(M)
        bm.normal_update()
        part.add(bm, None, coal_paint(seed + i, bedN))
    # a couple of blocks fallen off the face
    for i in range(2):
        s = rng.uniform(0.07, 0.1)
        bm = rock(rng, s * 1.3, s, s * 0.9, tris=16, sub=1, lump=0.1, cuts=5, depth=(0.5, 0.75), grooves=0)
        a = az + rng.choice((-1, 1)) * rng.uniform(0.7, 1.2)
        r = rng.uniform(0.42, 0.62)
        part.add(bm, Matrix.Translation((math.cos(a) * r, math.sin(a) * r, s * 0.35)) @ T(rot=(rng.uniform(-30, 30), rng.uniform(-30, 30), rng.uniform(0, 360))),
                 coal_paint(seed + 9 + i, Vector((0, 0, 1)), dust=0.6, gloss=0.6))
    # what the miners left
    wood = hard(WOOD, 0.0, 0.2, seed + 3, var=0.8, low=0.4)
    if style == 0:
        # a timbered drift into the seam, its track running out of it
        adit(part, rng, seed, az + rng.uniform(-0.08, 0.08), -0.04)
        track(part, rng, seed, az + rng.uniform(-0.08, 0.08), 0.06, 0.76, skew=0.5)
    elif style == 1:
        # a track along the foot of the face
        track(part, rng, seed, strike + rng.uniform(-0.08, 0.08), -0.62, 0.62, sleepers=6, skew=0.5, off=-0.36)
    elif style == 2:
        # a drift, props shoring the face either side of it, a short piece of track
        adit(part, rng, seed, az + rng.uniform(-0.08, 0.08), -0.02, h=0.28, w=0.34)
        for s_ in (-1, 1):
            a = strike if s_ > 0 else strike + math.pi
            P = Matrix.Translation((math.cos(a) * 0.4 + math.cos(az) * 0.06, math.sin(a) * 0.4 + math.sin(az) * 0.06, 0)) @ rotz(math.degrees(az)) @ T(rot=(0, -24 + rng.uniform(-4, 4), 0))
            part.add(box_bm(0.06, 0.06, 0.3), P, wood, drop=(0, 0, -1))
        track(part, rng, seed, az + rng.uniform(-0.1, 0.1), 0.08, 0.74, sleepers=4, skew=0.5)
    else:
        # a track run into the seam, the buffer timbers at its end
        Tm = track(part, rng, seed, az + rng.uniform(-0.15, 0.15), -0.08, 0.76, sleepers=5, skew=0.5)
        for s_ in (-1, 1):
            part.add(box_bm(0.06, 0.06, 0.24), Tm @ Matrix.Translation((0.0, s_ * 0.13, 0)) @ T(rot=(-s_ * 6, 10, 0)), wood, drop=(0, 0, -1))
        part.add(box_bm(0.07, 0.4, 0.07), Tm @ Matrix.Translation((0.02, 0, 0.18)) @ T(rot=(3, 0, 4)), wood, ground=False)


def coal_chip(rng, size, flat):
    s = size
    bm = rock(rng, s * 1.3, s, s * (0.6 if flat else 1.0), tris=10, sub=1, lump=0.1, cuts=4, depth=(0.5, 0.75), grooves=0)
    return bm, coal_paint(rng.uniform(0, 50), Vector((0, 0, 1)), dust=0.5, gloss=0.6)


def dep_coal():
    m = DepModel('dep_coal')
    for v, seed in enumerate((4, 17, 29, 46)):
        coal_core(m.part('v%d' % v, v - 2), seed, v)
    scatter(m.part('rim', 2), random.Random(3), coal_chip, 8)
    return m


# --------------------------------------------------------------------------- oil
def pipe_paint(seed, c0=PIPE, metal=0.55, tar_to=0.12):
    """Old pipework: rusty, tar up to tar_to above the deck."""
    def f(p, n, fn, ao):
        c = mixc(c0, RUST_LT, 0.7 * nz(p, 9, seed))
        tar = sat(1.0 - p.z / tar_to + 0.5 * (nz(p, 8, seed) - 0.5)) + 0.35 * sat(nz(p, 4.0, seed + 6) * 2.0 - 1.1)
        return (*c, 0.75 + 0.25 * metal, 0.0, sat(tar))
    return f


def tube_bm(r, h, segs=8, r2=None, bottom=False, top=True):
    bm = cyl_bm(r, h, segs, r2)
    kill = [f for f in bm.faces if len(f.verts) > 4 and ((not bottom and f.calc_center_median().z < h * 0.5) or (not top and f.calc_center_median().z > h * 0.5))]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    return bm


def wheel(part, M, r, seed):
    """A valve handwheel: a red rim, a hub."""
    red = hard(VALVE, 0.0, 0.1, seed, var=0.5)
    part.add(tube_bm(r, 0.022, 8, bottom=True), M, red, ground=False)
    part.add(tube_bm(0.014, 0.07, 4), M @ Matrix.Translation((0, 0, -0.07)), hard(STEEL, 0.9, 0.3), ground=False)


def oil_core(part, seed, well='tree'):
    rng = random.Random(seed)
    part.ao_floor = 0.5
    # the deck burst open round the pool: torn plates hinged on the deck, their points lifted; one blown clear
    n = 6
    a0 = rng.uniform(0, math.tau)
    gone = rng.randrange(n)
    stripe_at = (gone + 3) % n
    wa = a0 + gone * math.tau / n
    for i in range(n):
        a = a0 + i * math.tau / n
        half = math.pi / n - 0.05
        ro = rng.uniform(0.72, 0.77)
        L = rng.uniform(0.2, 0.3)
        bm = shard(rng, ro, L, half)
        if i == gone:
            M = rotz(math.degrees(a) + rng.uniform(-18, 18)) @ Matrix.Translation((0.5, 0, 0.0)) @ T(rot=(rng.uniform(-5, 5), rng.uniform(-4, 4), rng.uniform(40, 140))) @ Matrix.Translation((L * 0.5, 0, 0))
            M = M @ Matrix.Diagonal((0.7, 0.55, 1, 1))
        else:
            M = rotz(math.degrees(a)) @ Matrix.Translation((ro * math.cos(half), 0, 0.0)) @ T(rot=(rng.uniform(-6, 6), rng.uniform(10, 34), rng.uniform(-4, 4)))
        sd = (math.cos(a + 1.0), math.sin(a + 1.0), 0.0, 9.0) if i == stripe_at else None
        part.add(bm, M, plate_paint(seed + i, sd, tar_r=0.62), drop=M.to_3x3() @ Vector((0, 0, -1)))
    # the old wellhead standing in the tar where the plate went: it gives the tile its silhouette
    a = wa + rng.uniform(-0.15, 0.15)
    r = 0.43
    W = Matrix.Translation((math.cos(a) * r, math.sin(a) * r, 0)) @ rotz(math.degrees(a) + 90 + rng.uniform(-40, 40)) @ T(rot=(rng.uniform(-7, 7), rng.uniform(-7, 7), 0)) @ Matrix.Scale(1.4, 4)
    steel = lambda s: pipe_paint(seed + s, STEEL, 0.9, 0.05)
    if well == 'tree':
        # casing, flange, a valve tree with two handwheels
        h = 0.4
        part.add(tube_bm(0.085, h, 8, top=False), W, pipe_paint(seed, tar_to=0.2))
        part.add(tube_bm(0.125, 0.035, 8, bottom=True), W @ Matrix.Translation((0, 0, h - 0.04)), steel(2), ground=False)
        part.add(tube_bm(0.06, 0.2, 6), W @ Matrix.Translation((0, 0, h - 0.005)), pipe_paint(seed + 3, tar_to=0.01), ground=False)
        part.add(tube_bm(0.045, 0.34, 6, bottom=True), W @ Matrix.Translation((-0.17, 0, h + 0.09)) @ T(rot=(0, 90, 0)), pipe_paint(seed + 4, tar_to=0.01), ground=False)
        wheel(part, W @ Matrix.Translation((0.2, 0, h + 0.09)) @ T(rot=(0, 90, 0)), 0.085, seed)
        wheel(part, W @ Matrix.Translation((0, 0, h + 0.27)), 0.075, seed + 1)
    elif well == 'stub':
        # sheared off and bent over, the open end black inside; a second pipe beside it
        part.add(tube_bm(0.09, 0.24, 8, top=False), W, pipe_paint(seed, tar_to=0.2))
        part.add(tube_bm(0.125, 0.035, 8, bottom=True), W @ Matrix.Translation((0, 0, 0.06)), steel(2), ground=False)
        W2 = W @ Matrix.Translation((0, 0, 0.22)) @ T(rot=(0, 34, 0))
        part.add(tube_bm(0.088, 0.3, 8, top=False), W2, pipe_paint(seed + 1, tar_to=0.01), ground=False)
        part.add(disc_bm(0.055, 0.088, 8), W2 @ Matrix.Translation((0, 0, 0.3)), lambda p, n, fn, ao: (0.004, 0.004, 0.005, 0.8, 0, 1.0), ground=False)
        part.add(tube_bm(0.05, 0.36, 6), W @ Matrix.Translation((-0.06, 0.17, 0)) @ T(rot=(8, -6, 0)), pipe_paint(seed + 5, tar_to=0.15))
        wheel(part, W @ Matrix.Translation((-0.085, 0.2, 0.4)) @ T(rot=(8, -6, 0)), 0.07, seed)
    elif well == 'cap':
        # capped: a blind flange bolted on, a gauge pipe with its wheel, a warning post
        h = 0.3
        part.add(tube_bm(0.1, h, 8, top=False), W, pipe_paint(seed, tar_to=0.2))
        part.add(tube_bm(0.14, 0.05, 8, bottom=True), W @ Matrix.Translation((0, 0, h - 0.02)), steel(2), ground=False)
        part.add(tube_bm(0.035, 0.24, 5), W @ Matrix.Translation((0.03, 0.0, h + 0.02)), pipe_paint(seed + 3, tar_to=0.01), ground=False)
        wheel(part, W @ Matrix.Translation((0.03, 0, h + 0.3)), 0.08, seed)
        part.add(tube_bm(0.045, 0.3, 6, bottom=True), W @ Matrix.Translation((-0.13, 0, h * 0.55)) @ T(rot=(0, -90, 0)), pipe_paint(seed + 4, tar_to=0.01), ground=False)
    else:
        # two risers joined by a cross pipe, one valve
        h = 0.36
        for s, hh in ((-1, h), (1, h * 0.78)):
            part.add(tube_bm(0.07, hh, 7), W @ Matrix.Translation((0, s * 0.13, 0)) @ T(rot=(s * 4, 0, 0)), pipe_paint(seed + s, tar_to=0.2))
            part.add(tube_bm(0.1, 0.03, 7, bottom=True), W @ Matrix.Translation((0, s * 0.13, hh * 0.45)), steel(3 + s), ground=False)
        part.add(tube_bm(0.04, 0.26, 6, bottom=True, top=False), W @ Matrix.Translation((0, -0.13, h * 0.7)) @ T(rot=(-90, 0, 0)), pipe_paint(seed + 6, tar_to=0.01), ground=False)
        wheel(part, W @ Matrix.Translation((0, -0.13, h + 0.08)), 0.08, seed)


def pool_part(part):
    """The tar surface: a lobed puddle with a rounded edge running down to the deck."""
    bm = bmesh.new()
    N = 18
    c = bm.verts.new((0, 0, POOL_Z))
    rad = lambda i: 0.56 + 0.05 * math.sin(3 * i * math.tau / N + 0.6) + 0.03 * math.sin(5 * i * math.tau / N + 2.1)
    ring = lambda k, zz: [bm.verts.new((math.cos(i * math.tau / N) * k * rad(i), math.sin(i * math.tau / N) * k * rad(i), zz)) for i in range(N)]
    a = ring(0.93, POOL_Z)
    b = ring(1.0, POOL_Z * 0.55)
    d = ring(1.035, -0.002)
    for i in range(N):
        j = (i + 1) % N
        bm.faces.new((c, a[i], a[j]))
        bm.faces.new((a[i], b[i], b[j], a[j]))
        bm.faces.new((b[i], d[i], d[j], b[j]))
    part.add(bm, None, lambda p, n, fn, ao: (0.01, 0.009, 0.012, 1.0, 0.0, 1.0), ground=False)
    part.ao_floor = 1.0


def oil_chip(rng, size, flat):
    if rng.random() < 0.55:
        s = size * 1.25
        bm = hull(slab_pts(rng, s * 1.3, s, 0.03, sides=4, jit=0.25, inset=0.95, zjit=0.0, ajit=0.3), 0)
        bm.transform(Matrix.Translation((0, 0, -size * 0.2)))
        return bm, plate_paint(rng.uniform(0, 50), None, grime=0.5)
    s = size * 0.9
    return dome_bm(s * 1.5, s * 0.45, 6), lambda p, n, fn, ao: (0.012, 0.01, 0.014, 0.8, 0.0, 1.0)


def dep_oil():
    m = DepModel('dep_oil')
    for v, (seed, well) in enumerate(((6, 'tree'), (15, 'stub'), (31, 'cap'), (44, 'twin'))):
        oil_core(m.part('v%d' % v, v - 2.5), seed, well)
    scatter(m.part('rim', 1.5), random.Random(12), oil_chip, 8)
    pool_part(m.part('pool', 2.5))
    return m


DEPOSITS = [dep_iron, dep_copper, dep_coal, dep_oil]
