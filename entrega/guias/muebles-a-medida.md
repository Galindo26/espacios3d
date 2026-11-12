# Muebles a medida: piezas, modelos 3D y «Mis muebles»

Para agentes de IA. Todo con `node espacios3d.mjs`; medidas en cm.

## Lo que choca y lo que se ve
- Lo que choca (incidencias, recorrido en primera persona) es siempre la **caja del mueble**: `ancho` × `fondo` × `alto`, con su `elevacion` y su `huecoInferior`. Pon medidas reales.
- Lo que se ve es, por orden: su **modelo** `.glb` si lo tiene y se puede leer; si no, sus **piezas**; si no, la forma genérica de su `tipo`.

## Piezas
Una forma hecha de piezas sencillas, en coordenadas del mueble:
- origen en el centro de la base; `x` a lo largo del ancho, `y` hacia el **frente**, `z` hacia arriba;
- `forma`: `caja`, `cilindro`, `esfera` o `cuna` (rampa que sube de 0 en el frente a su `alto` detrás: respaldos, tejadillos);
- `ancho`, `fondo` y `alto`; en la esfera y el cilindro, `ancho` es el diámetro;
- opcionales: `x`, `y`, `z` (0), `giro` (grados) y `color` (`#rrggbb`; si no, el del mueble);
- cada pieza tiene que **caber dentro del mueble**; si no, la orden falla y dice cuál.

Ejemplo, un sofá con respaldo inclinado y dos cojines (frente hacia +y):
```
node espacios3d.mjs agregar espacios/X.espacio.json --tipo sofa --id sofa --ancho 200 --fondo 90 --alto 85 --piezas '[
  {"forma":"caja","ancho":200,"fondo":90,"alto":42},
  {"forma":"cuna","y":-30,"z":42,"ancho":200,"fondo":30,"alto":43},
  {"forma":"caja","x":-50,"y":5,"z":42,"ancho":90,"fondo":55,"alto":12,"color":"#d8d2c4"},
  {"forma":"caja","x":50,"y":5,"z":42,"ancho":90,"fondo":55,"alto":12,"color":"#d8d2c4"}]'
```
En PowerShell, el JSON entre comillas simples; si da guerra, ponlo en un lote (`aplicar --ops ops.json` con `"piezas": [...]`). `editar --id sofa --piezas null` vuelve a la forma genérica.

## Desde fotos
1. Pide o estima las medidas (ancho del frente, fondo y alto); una foto no da escala si no hay una medida conocida.
2. Piensa el mueble en 3 a 8 piezas: cuerpo, respaldo, patas, tablero, pantalla de una lámpara…
3. Pon el frente hacia +y y comprueba que cada pieza cabe.

## Modelo 3D propio (.glb)
- Va en la carpeta del espacio, por ejemplo `modelos/sofa.glb`, con ruta relativa: `agregar ... --modelo modelos/sofa.glb` o `editar --id sofa --modelo '{"archivo":"modelos/sofa.glb","giro":90,"ajuste":"modelo"}'`. `--modelo ninguno` lo quita.
- `ajuste`: `medidas` (por defecto) lo estira a la caja del mueble; `modelo` conserva su tamaño (glTF va en metros). `giro`: 0, 90, 180 o 270, para que su frente mire a +y.
- Tiene que ser un `.glb` **con todo dentro**: sin compresión Draco, meshopt ni KTX2 y sin imágenes o búferes en archivos o direcciones aparte. Si no se puede leer o no está, se ve la forma de reserva y la página lo avisa; el comando avisa si el archivo no existe.
- No hace falta: sin modelo, las piezas o la forma genérica bastan.

## «Mis muebles»
Muebles guardados en `mis-muebles.json`, junto a los espacios, para usarlos en otros espacios de la carpeta:
```
node espacios3d.mjs muebles guardar espacios/X.espacio.json --id sofa --nombre "Sofá del salón"
node espacios3d.mjs muebles listar espacios
node espacios3d.mjs agregar espacios/Y.espacio.json --mio "Sofá del salón" --muro 0 --desde 40
node espacios3d.mjs muebles quitar espacios --nombre "Sofá del salón"
```
En un lote: `{"op": "agregar", "mio": "Sofá del salón", "x": 200, "y": 150}`. Lo que indiques además (medidas, color) cambia lo guardado sólo en ese espacio.

## El .glb exportado
- `exportar --glb` (el comando): un nodo por mueble con un hijo por pieza (`<id>-pieza-N`). Si el mueble tiene modelo, el modelo no va dentro: su ruta va en `extras.modelo` y las piezas son la forma de reserva (`extras.piezasDeReserva: true`). Un motor que cargue el modelo oculta esos hijos.
- El botón de la página exporta lo que se ve, con el modelo dentro.
