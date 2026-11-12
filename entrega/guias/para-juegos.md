# Usar un espacio en un juego

Para agentes de IA y para quien prepare un juego. Todo con `node espacios3d.mjs exportar`.

```
node espacios3d.mjs exportar espacios/casa.espacio.json --glb casa.glb --colisiones godot --escena escena.json
```

## El modelo (`--glb`)
- glTF binario, en metros, con y hacia arriba. La planta (x, y) del archivo pasa a (X, Z).
- Un nodo por planta (`planta-<id>`, a su `nivel`). Dentro:
  - `suelo-<estancia>` (con el hueco de las escaleras que llegan de abajo) y `umbral-<puerta>` (el suelo en el grueso del muro);
  - `muros-<planta>` (ya con los huecos de puertas y ventanas);
  - la obra (`<id>`);
  - `escalera-<id>` (peldaños, meseta y barandillas) y `hueco-<id>` (canto del forjado y barandilla arriba);
  - `forjado-<planta>` (el grueso entre el techo de la planta de abajo y el suelo de esta, con los huecos de las escaleras);
  - un nodo por mueble (`<id>`, con su posición y su giro), con un hijo por pieza. Si el mueble tiene un modelo propio, su ruta va en `extras.modelo` y las piezas son la forma de reserva (`extras.piezasDeReserva`).

## Colisiones (`--colisiones`)
Son formas sencillas, sin malla visible que importe, para saber por dónde se anda:
- muros y suelos;
- un bloque en cada ventana;
- la caja de cada mueble y la obra;
- una rampa por tramo de escalera, más la meseta (no los peldaños, para no tropezar); en la de caracol, una rampa por cada trozo de 30° y el poste;
- las barandillas.

Llevan `extras.colision: true` y `extras.de` (la malla visible a la que acompañan).

| Motor | Opción | Qué hacer |
| :--- | :--- | :--- |
| Godot 4 | `godot` | Nada: los nodos `…-colonly` (muros y suelos) y `…-convcolonly` (lo demás) se importan como cuerpos estáticos y su malla desaparece. Comprobado con Godot 4.7.2: un personaje (`CharacterBody3D` de 1,75 m) sube andando una escalera en L hasta la planta de arriba. |
| Unreal | `unreal` | Cajas `UBX_<malla>_00` y formas convexas `UCX_<malla>_00`, la convención de FBX. **Con glTF no está comprobado**: si no las reconoce, activa «Use Complex Collision As Simple». Ojo: las cajas de los muebles (`UBX_<mueble>_00`) se refieren al nodo del mueble, y sus mallas están en los hijos `<mueble>-pieza-N`, así que es probable que Unreal no las asocie solas. Muros y suelos no llevan colisión propia: usa la colisión compleja de su malla. |
| Unity u otro | `generico` | Nodos `COL_<nombre>`. Al importar, añade un `MeshCollider` a cada uno y quítale el `MeshRenderer` (ver el script de abajo). |

Script de importación para Unity (ponlo en `Assets/Editor/`):
```csharp
using UnityEditor;
using UnityEngine;

public class ColisionesEspacios3D : AssetPostprocessor
{
    void OnPostprocessModel(GameObject raiz)
    {
        foreach (var t in raiz.GetComponentsInChildren<Transform>(true))
        {
            if (!t.name.StartsWith("COL_")) continue;
            var filtro = t.GetComponent<MeshFilter>();
            if (filtro == null) continue;
            var c = t.gameObject.AddComponent<MeshCollider>();
            c.sharedMesh = filtro.sharedMesh;
            Object.DestroyImmediate(t.GetComponent<MeshRenderer>());
        }
    }
}
```

## La escena (`--escena`)
`escena.json` es lo mismo que `describir --json`:
- estancias con sus muros, sus huecos y a qué da cada uno;
- muebles con su posición, hacia dónde miran y a qué muros están pegados;
- escaleras con su pie, su llegada y las estancias que unen;
- conexiones entre estancias.

Sirve para colocar cosas o generar recorridos desde el juego sin leer el `.glb`.

## Límites
- Las colisiones de los muebles son su caja (sus medidas), no la forma de sus piezas ni la de su modelo.
- Las texturas y los materiales son colores lisos: cámbialos en el motor.
