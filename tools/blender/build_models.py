"""VOLTSPIRE model builder.

    blender -b --python tools/blender/build_models.py [-- --only a,b,c] [--no-render] [--angles]

Builds every model procedurally, exports public/models/<name>.glb and (unless
--no-render) renders docs/previews/<name>.png plus contact_sheet.png.
"""
import os
import sys
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'public', 'models')
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
import vs_lib  # noqa: E402
import models_towers, models_enemies, models_hero, models_misc  # noqa: E402

for mod in (vs_lib, models_towers, models_enemies, models_hero, models_misc):
    importlib.reload(mod)

BUILDERS = models_towers.TOWERS + models_enemies.ENEMIES + models_hero.HERO + models_misc.MISC

BUDGET = {'enemy_grunt': 2500, 'enemy_runner': 2500, 'enemy_drone': 2500, 'enemy_brute': 4000, 'enemy_shield': 4000,
          'enemy_boss': 10000, 'hero': 9000, 'core': 12000}


def budget(name):
    if name in BUDGET:
        return BUDGET[name]
    return 8000 if name.startswith('tower_') else 1500


def tri_count(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    for ob in objs:
        me = ob.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
    return total


def build(fn):
    vs_lib.clear_scene()
    model = fn()
    root, objs = model.finish()
    bpy.context.view_layer.update()
    tris = tri_count(objs)
    for ob in bpy.context.scene.objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    path = os.path.join(OUT, model.name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=False, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_cameras=False, export_lights=False, export_animations=False, export_skins=False,
        export_morph=False, export_extras=False, export_attributes=False)
    kb = os.path.getsize(path) / 1024
    flag = '' if tris <= budget(model.name) and kb <= 400 else '   <-- OVER BUDGET'
    print(f'[build] {model.name:14s} tris={tris:6d}/{budget(model.name):<6d} {kb:7.1f} KB  '
          f'nodes={[o.name for o in objs]}{flag}')
    return model.name


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = None
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    os.makedirs(OUT, exist_ok=True)
    names = []
    for fn in BUILDERS:
        if only and fn.__name__ not in only and ('enemy_' + fn.__name__) not in only:
            continue
        names.append(build(fn))
    vs_lib.clear_scene()
    if '--no-render' not in argv:
        import render_previews
        importlib.reload(render_previews)
        render_previews.render_all(names, sheet=only is None)
        if '--angles' in argv:
            render_previews.render_angles(names)


main()
