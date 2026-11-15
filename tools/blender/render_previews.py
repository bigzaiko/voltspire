"""Import each exported GLB, print stats and render a 640x640 EEVEE preview.

Can be run on its own:  blender -b --python tools/blender/render_previews.py [-- name1,name2]
(the previews are rendered from the GLB files, so they show exactly what the game will load).
"""
import os
import sys
import json
import math
import struct
import subprocess

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MODELS = os.path.join(ROOT, 'public', 'models')
PREVIEWS = os.path.join(ROOT, 'docs', 'previews')

ORDER = ['tower_pulse', 'tower_cryo', 'tower_arc', 'tower_mortar', 'tower_rail', 'tower_beacon',
         'tower_flame', 'tower_lance', 'tower_missile', 'tower_gravity', 'tower_spire',
         'enemy_grunt', 'enemy_runner', 'enemy_drone', 'enemy_brute', 'enemy_shield', 'enemy_boss', 'enemy_wheel',
         'hero', 'core', 'prop_barrier', 'prop_lamp', 'prop_crate']


def glb_json(path):
    with open(path, 'rb') as f:
        f.read(12)
        n, _ = struct.unpack('<II', f.read(8))
        return json.loads(f.read(n))


def glb_stats(path):
    """Authoritative stats read straight from the GLB (glTF space, +Y up)."""
    g = glb_json(path)
    acc = g['accessors']
    tris = 0
    lo = [1e9] * 3
    hi = [-1e9] * 3
    prims = {}

    def walk(i, offset):
        node = g['nodes'][i]
        t = node.get('translation', [0, 0, 0])
        if 'rotation' in node and any(abs(v) > 1e-6 for v in node['rotation'][:3]):
            pass  # bounds of rotated nodes are approximated below by the Blender import
        off = [offset[k] + t[k] for k in range(3)]
        nonlocal tris
        if 'mesh' in node:
            ps = g['meshes'][node['mesh']]['primitives']
            prims[node['name']] = [g['materials'][p['material']]['name'] for p in ps]
            for p in ps:
                tris += acc[p['indices']]['count'] // 3
        for c in node.get('children', []):
            walk(c, off)

    roots = g['scenes'][g.get('scene', 0)]['nodes']
    for r in roots:
        walk(r, [0, 0, 0])
    rootnames = [g['nodes'][r]['name'] for r in roots]
    children = [g['nodes'][c]['name'] for r in roots for c in g['nodes'][r].get('children', [])]
    mats = [m['name'] for m in g.get('materials', [])]
    return dict(tris=tris, roots=rootnames, children=children, materials=mats, prims=prims,
                images=len(g.get('images', [])), anims=len(g.get('animations', [])))


def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for b in list(coll):
            coll.remove(b)


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = sc.render.resolution_y = 640
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.film_transparent = False
    try:
        sc.eevee.taa_render_samples = 32
    except Exception:
        pass
    for vt in ('Standard', 'Filmic', 'AgX'):
        try:
            sc.view_settings.view_transform = vt
            break
        except Exception:
            continue
    try:
        sc.view_settings.look = 'None'
    except Exception:
        pass
    # world: dim blue ambient for lighting/reflections, near-black for the camera
    w = bpy.data.worlds.new('preview_world')
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    mix = nt.nodes.new('ShaderNodeMixShader')
    lp = nt.nodes.new('ShaderNodeLightPath')
    amb = nt.nodes.new('ShaderNodeBackground')
    cam = nt.nodes.new('ShaderNodeBackground')
    amb.inputs[0].default_value = (0.30, 0.28, 0.26, 1)
    amb.inputs[1].default_value = 0.8
    cam.inputs[0].default_value = (0.016, 0.014, 0.012, 1)
    nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs[0])
    nt.links.new(amb.outputs[0], mix.inputs[1])
    nt.links.new(cam.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    sc.world = w
    # bloom through the compositor (EEVEE has no built-in bloom any more)
    try:
        ng = bpy.data.node_groups.new('preview_comp', 'CompositorNodeTree')
        ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        rl = ng.nodes.new('CompositorNodeRLayers')
        gl = ng.nodes.new('CompositorNodeGlare')
        go = ng.nodes.new('NodeGroupOutput')
        gl.inputs['Type'].default_value = 'Bloom'
        gl.inputs['Threshold'].default_value = 1.0
        gl.inputs['Strength'].default_value = 0.6
        gl.inputs['Size'].default_value = 0.45
        ng.links.new(rl.outputs['Image'], gl.inputs['Image'])
        ng.links.new(gl.outputs['Image'], go.inputs[0])
        sc.compositing_node_group = ng
        sc.render.use_compositing = True
    except Exception as e:  # pragma: no cover
        print('[preview] bloom unavailable:', e)


def add_light(kind, loc, target, energy, color, size=1.0):
    li = bpy.data.lights.new(kind.lower(), kind)
    li.energy = energy
    li.color = color
    if kind == 'AREA':
        li.size = size
    elif kind == 'SUN':
        li.angle = math.radians(8)
    ob = bpy.data.objects.new(li.name, li)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob


VIEWS = {'hero': (-0.85, -1.0, 0.45), 'enemy_drone': (0.72, -1.0, 0.45)}


# add-on groups: the plain previews show level 1 / tier 1, so these are hidden unless asked for
ADDONS = ('lvl2', 'lvl3', 'tier2', 'tier3', 'tier4', 'tier5')


def addon_of(ob):
    while ob is not None:
        for a in ADDONS:
            if ob.name.startswith(a):
                return a
        ob = ob.parent
    return None


def render_one(name, view=None, out=None, show=()):
    """show: add-on group names (see ADDONS) to keep; all others are hidden but still count for the framing."""
    view = view or VIEWS.get(name, (0.72, -1.0, 0.62))
    clear()
    path = os.path.join(MODELS, name + '.glb')
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    hidden = [ob for ob in bpy.context.scene.objects if (addon_of(ob) or 'x') not in ('x',) + tuple(show)]
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    pts = []
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        for v in ob.data.vertices:
            p = ob.matrix_world @ v.co
            pts.append(p)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    size = hi - lo
    c = (lo + hi) / 2
    R = size.length / 2
    for ob in hidden:
        ob.hide_render = True
    st = glb_stats(path)
    kb = os.path.getsize(path) / 1024
    print(f'[stats] {name:14s} tris={st["tris"]:6d} {kb:6.1f}KB  size(x,y,z)=({size.x:.2f},{size.y:.2f},{size.z:.2f}) '
          f'z=[{lo.z:.2f},{hi.z:.2f}] y=[{lo.y:.2f},{hi.y:.2f}] root={st["roots"]} children={st["children"]} '
          f'mats={st["materials"]} prims={ {k: len(v) for k, v in st["prims"].items()} } '
          f'images={st["images"]} anims={st["anims"]}')
    # ground
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    bs = gm.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (0.010, 0.009, 0.008, 1)
    bs.inputs['Roughness'].default_value = 1.0
    bs.inputs['Specular IOR Level'].default_value = 0.0
    bpy.ops.mesh.primitive_plane_add(size=max(60.0, R * 40), location=(c.x, c.y, lo.z - (0.0 if lo.z > -0.01 else R * 0.6)))
    bpy.context.object.data.materials.append(gm)
    # camera
    cam = bpy.data.cameras.new('cam')
    cam.lens = 70
    cam.sensor_width = 36
    cam.clip_start = 0.05
    cam.clip_end = 500
    co = bpy.data.objects.new('cam', cam)
    bpy.context.scene.collection.objects.link(co)
    d = Vector(view).normalized()
    half = math.atan(18 / cam.lens)
    quat = (-d).to_track_quat('-Z', 'Y')
    inv = quat.to_matrix().inverted()
    # frame on the real vertices: centre their camera-space extent, then find the smallest distance
    # that keeps every vertex inside 88 % of the frame
    rel = [inv @ (p - c) for p in pts]
    mx = (min(r.x for r in rel) + max(r.x for r in rel)) / 2
    my = (min(r.y for r in rel) + max(r.y for r in rel)) / 2
    k = math.tan(half) * 0.88
    dist = max(max(abs(r.x - mx), abs(r.y - my)) / k + r.z for r in rel)
    co.location = c + d * dist + quat @ Vector((mx, my, 0))
    co.rotation_euler = quat.to_euler()
    bpy.context.scene.camera = co
    # lights
    s = max(R, 0.5)
    add_light('SUN', c + Vector((2.5, -3.0, 4.0)), c, 2.6, (1.0, 0.96, 0.9))
    add_light('SUN', c + Vector((-3.0, 3.5, 2.2)), c, 3.0, (0.75, 0.82, 1.0))
    add_light('AREA', c + Vector((-2.2, -2.0, 0.6)) * s, c, 60 * s * s, (0.8, 0.85, 1.0), size=2.5 * s)
    bpy.context.scene.render.filepath = out or os.path.join(PREVIEWS, name + '.png')
    bpy.ops.render.render(write_still=True)


# extra angles for close inspection (written to docs/previews/angles/<name>_<tag>.png)
ANGLES = {
    'hero': {'back': (-0.25, 1.0, 0.5), 'backleft': (0.9, 0.8, 0.35), 'backright': (-1.0, 0.45, 0.3),
             'front': (-0.3, -1.0, 0.25), 'side': (-1.0, -0.15, 0.2), 'top': (0.2, 0.5, 1.0)},
    'enemy_grunt': {'front': (0.15, -1.0, 0.25), 'side': (1.0, -0.05, 0.2), 'back': (-0.6, 1.0, 0.45),
                    'top': (0.3, -0.5, 1.0)},
    'enemy_boss': {'front': (0.2, -1.0, 0.3), 'side': (1.0, -0.1, 0.25), 'back': (-0.6, 1.0, 0.5),
                   'top': (0.3, -0.5, 1.0)},
}
for _n in ('tower_flame', 'tower_lance', 'tower_missile', 'tower_gravity'):
    ANGLES[_n] = {'back': (-0.6, 1.0, 0.5), 'top': (0.3, -0.5, 1.0), 'side': (1.0, -0.1, 0.3)}
ANGLES['tower_spire'] = {'back': (-0.6, 1.0, 0.5), 'top': (0.3, -0.5, 1.0), 'side': (1.0, -0.1, 0.12),
                         'low': (0.7, -1.0, -0.12)}
DEFAULT_ANGLES = {'back': (-0.6, 1.0, 0.5), 'top': (0.3, -0.5, 1.0)}


def render_angles(names):
    out = os.path.join(PREVIEWS, 'angles')
    os.makedirs(out, exist_ok=True)
    setup_render()
    for n in names:
        for tag, view in ANGLES.get(n, DEFAULT_ANGLES).items():
            render_one(n, view=view, out=os.path.join(out, f'{n}_{tag}.png'))


LEVELS = (('1', ()), ('2', ('lvl2', 'tier2')), ('3', ('lvl2', 'lvl3', 'tier2', 'tier3')),
          ('4', ('tier2', 'tier3', 'tier4')), ('5', ('tier2', 'tier3', 'tier4', 'tier5')))


def render_levels(names, views=None):
    """Side by side comparison of the upgrade levels (towers: 1-3, hero: bow tiers 1-5) from two angles,
    written to docs/previews/levels/<name>.png."""
    out = os.path.join(PREVIEWS, 'levels')
    os.makedirs(out, exist_ok=True)
    setup_render()
    for n in names:
        lv = LEVELS if n == 'hero' else LEVELS[:3]
        vs = views or ({'a': (-0.9, -0.8, 0.4), 'b': (0.5, 0.9, 0.5)} if n == 'hero' else
                       {'a': (0.72, -1.0, 0.62), 'top': (0.25, -0.45, 1.0)})
        rows = []
        for tag, view in vs.items():
            files = []
            for k, show in lv:
                f = os.path.join(out, f'_{n}_{tag}_{k}.png')
                render_one(n, view=view, out=f, show=show)
                files.append(f)
            row = os.path.join(out, f'_{n}_{tag}.png')
            subprocess.run(['magick', *files, '+append', row], check=True)
            for f in files:
                os.remove(f)
            rows.append(row)
        subprocess.run(['magick', *rows, '-append', os.path.join(out, n + '.png')], check=True)
        for f in rows:
            os.remove(f)


def contact_sheet():
    files = [os.path.join(PREVIEWS, n + '.png') for n in ORDER if os.path.exists(os.path.join(PREVIEWS, n + '.png'))]
    out = os.path.join(PREVIEWS, 'contact_sheet.png')
    try:
        subprocess.run(['magick', 'montage', '-label', '%t', *files, '-tile', '7x4', '-geometry', '320x320+3+3',
                        '-background', '#100e0c', '-fill', '#d8cfc0', '-pointsize', '15', '-depth', '8', '-strip', out], check=True)
    except Exception as e:
        print('[preview] montage with labels failed, using ffmpeg tile:', e)
        lst = os.path.join(PREVIEWS, '_list.txt')
        with open(lst, 'w') as f:
            for p in files:
                f.write(f"file '{p}'\n")
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-vf',
                        'scale=320:320,tile=7x4:padding=4:color=0x0b0c12', '-frames:v', '1', out], check=True)
        os.remove(lst)
    print('[preview] contact sheet ->', out)


def render_all(names=None, sheet=True):
    os.makedirs(PREVIEWS, exist_ok=True)
    setup_render()
    for n in (names or ORDER):
        if os.path.exists(os.path.join(MODELS, n + '.glb')):
            render_one(n)
    if sheet:
        contact_sheet()


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = [a for a in argv if not a.startswith('--')]
    if '--angles' in argv:
        render_angles(names[0].split(',') if names else list(ANGLES))
    elif '--levels' in argv:
        render_levels(names[0].split(',') if names else [n for n in ORDER if n.startswith('tower_')] + ['hero'])
    else:
        render_all(names[0].split(',') if names else None, sheet=not names)
