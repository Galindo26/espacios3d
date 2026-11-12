# Comprobación en Blender del .glb visible de Espacios 3D (tests/motores/comprobar.mjs):
# lo importa con el importador glTF de Blender y escribe una línea «RESULTADO {json}» con los nombres de
# los objetos y las medidas (m) de los que se piden.
# Uso: blender -b --factory-startup --python comprobar.py -- casa.glb sofa
import json
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
ruta, medir = args[0], args[1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=ruta)
objetos = {o.name: o for o in bpy.data.objects}


def medidas(nombre):
    """Caja (m) del objeto y sus hijos, en coordenadas del mundo: ancho (x), fondo (y) y alto (z)."""
    o = objetos.get(nombre)
    if o is None:
        return None
    pts = []
    for x in [o, *o.children_recursive]:
        if x.type == 'MESH':
            pts += [x.matrix_world @ Vector(c) for c in x.bound_box]
    if not pts:
        return None
    return [round(max(p[i] for p in pts) - min(p[i] for p in pts), 3) for i in range(3)]


r = {
    'objetos': sorted(objetos),
    'mallas': sum(1 for o in objetos.values() if o.type == 'MESH'),
    'materiales': sorted(m.name for m in bpy.data.materials),
    'medidas': {n: medidas(n) for n in medir},
}
print('RESULTADO ' + json.dumps(r, ensure_ascii=False))
