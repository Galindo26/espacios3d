# Plan de Espacios 3D (v2, 11/11/2026)

Revisado de forma independiente sobre la v1: «aprobar con cambios». Esta v2 incorpora esos cambios. Cada hito se revisa de forma independiente antes de pasar al siguiente.

## Encargo
- Herramienta para crear espacios 3D y ordenarlos rápida y cómodamente. Primer objetivo: una habitación a medida con sus muebles, fáciles de reorganizar.
- La usan personas y cualquier agente de IA. Si en el futuro sirve para juegos 3D, mejor.
- Se entrega como una carpeta y funciona **100 % en el ordenador del receptor**, sin conexión y sin nada de su autor.
- Las medidas se meten desde la interfaz.

## Decisiones
| Tema | Decisión | Motivo |
| :--- | :--- | :--- |
| Base | Herramienta propia (no Pascal Editor ni Sweet Home 3D) | Portabilidad por carpeta, uso por agentes y camino a juegos |
| Página | Un único `Espacios3D.html` con todo el JS incrustado (IIFE) | Desde `file://` los módulos ES externos se bloquean por CORS (comprobado en Edge 157) |
| 3D | three.js vanilla (sin React) | Menos peso y menos piezas en un archivo único |
| Lógica | Núcleo TypeScript puro (sin DOM ni three) compartido por la página y el CLI | Una sola implementación de validación, geometría y análisis |
| Agentes | `AGENTS.md` de la carpeta + esquema JSON + `espacios3d.mjs` (Node ≥ 18, sin dependencias) | Funciona por sí sola; cualquier agente la usa igual |
| Unidades | cm y grados en el JSON; metros en three.js | Lo que mide una persona con cinta |

## Convenciones geométricas
- Planta: `x` hacia la derecha, `y` hacia abajo del plano, en cm. En three.js: `X = x/100`, `Z = y/100`, `Y` hacia arriba, suelo en `Y = 0`.
- El contorno es la **cara interior** de los muros. Se aceptan los dos sentidos de giro; el interior se deduce por el área con signo y no se reordena.
- Mueble: `(x, y)` es el centro de la huella. `ancho` va a lo largo del frente y `fondo` hacia atrás. Con `giro = 0` el frente mira a `+y`. `giro` está en grados horarios vistos desde arriba, y en three.js `rotation.y = -giro·π/180`. Una única función hace la conversión, con una prueba que usa un mueble asimétrico.
- Hueco (puerta/ventana/paso): `muro = i` es la arista `contorno[i] → contorno[i+1]`. `desde` son los cm desde el vértice inicial hasta el borde del hueco. Insertar o quitar un vértice reasigna `muro` y `desde` en el núcleo, con su prueba.
- Tolerancia geométrica de 0,1 cm: tocar a ras no es solape.

## Formato `*.espacio.json` (versión 1)
```json
{
  "formato": "espacios3d", "version": 1, "nombre": "Dormitorio",
  "estancia": {
    "contorno": [[0,0],[350,0],[350,300],[0,300]],
    "altura": 250, "grosorMuros": 10,
    "huecos": [
      {"id":"puerta","tipo":"puerta","muro":3,"desde":40,"ancho":80,"alto":205,"abre":"dentro","bisagra":"inicio"},
      {"id":"ventana","tipo":"ventana","muro":0,"desde":120,"ancho":120,"alto":110,"antepecho":95}
    ]
  },
  "muebles": [
    {"id":"cama","nombre":"Cama","tipo":"cama","ancho":150,"fondo":200,"alto":50,
     "x":175,"y":120,"giro":0,"elevacion":0,"color":"#c8b49a","bloqueado":false,
     "holguraFrente":60,"huecoInferior":0}
  ],
  "distribuciones": [{"nombre":"Estudio","posiciones":{"cama":{"x":175,"y":120,"giro":0}}}],
  "notas": ""
}
```
- Se rechazan los campos desconocidos, salvo `notas`, que es texto libre.
- `abre`: `dentro` | `fuera` | `corredera`. `bisagra`: `inicio` | `fin`. `tipo` de hueco: `puerta` | `ventana` | `paso`.
- `holguraFrente` es el espacio libre que necesita delante (con un valor por defecto según el tipo). `huecoInferior` es la altura libre por debajo: una silla de 45 cm cabe bajo un escritorio con hueco de 70.
- Distribuciones: al aplicarlas, los ids ausentes se ignoran y se informan, y los muebles que no aparecen en ellas no se mueven.
- El esquema JSON (`esquema/espacio.schema.json`) se comprueba con una prueba de paridad contra `validar()` sobre un corpus de casos válidos e inválidos. Ajv sólo se usa en desarrollo.

## Reglas de análisis
| Regla | Gravedad |
| :--- | :--- |
| Mueble fuera de la estancia o atravesando un muro | error |
| Solape entre muebles cuyas alturas se cruzan (teniendo en cuenta `elevacion` y `huecoInferior`) | error |
| Mueble en el barrido de una puerta o en la franja de paso de una puerta o un paso (60 cm de fondo) | error |
| Zona `holguraFrente` de un mueble invadida por otro mueble o por un muro | aviso |
| Mueble más alto que el antepecho delante de una ventana (a menos de 10 cm del muro) | aviso |

Cada mutación devuelve las incidencias que resultan de ella.

## Guardado y sincronía
- La página usa una interfaz de almacén con las operaciones abrir, leer, escribir y `lastModified`, y tres implementaciones:
  - (a) File System Access (Chrome/Edge), con el manejador guardado en IndexedDB y un botón «Continuar con X» (el permiso exige un gesto), y arrastrar un `.espacio.json` a la página;
  - (b) `<input type=file>` para abrir y descarga para guardar (Firefox/Safari);
  - (c) un manejador falso inyectado en las pruebas automáticas.
- Protocolo de concurrencia:
  - La página guarda sólo tras un cambio del usuario, con un retardo de unos 600 ms.
  - Antes de escribir, relee `lastModified`. Si el archivo cambió fuera, recarga y descarta lo pendiente con un aviso.
  - No se recarga por su propia escritura.
  - Sondea cada segundo para recoger los cambios de los agentes.
- Escritura del CLI: archivo temporal y renombrado, con reintentos durante unos 2 s ante `EPERM`/`EBUSY`, borrando el temporal. Justo antes de renombrar comprueba que la fecha y el tamaño del destino no han cambiado desde que lo leyó.
- Recuperación en `localStorage` con claves que llevan el prefijo de la herramienta y el nombre del espacio, porque todos los HTML locales comparten el origen `file://`. Nunca es el almacén principal.
- La ruta real a disco con los selectores nativos no se puede automatizar (en modo headless dan `AbortError`). Se comprueba a mano y se declara como tal.

## CLI `espacios3d.mjs` (subcomandos ASCII)
```
nuevo <archivo> --ancho 350 --largo 300 [--alto 250]
resumen <archivo> [--json]
validar <archivo>
analizar <archivo> [--json]
agregar <archivo> --tipo cama --ancho 150 --fondo 200 --alto 50 (--x --y | --muro i --desde d) [--giro] [--id] [--nombre]
mover|girar|editar|quitar|pegar-pared <archivo> --id ...
hueco agregar|quitar <archivo> ...
distribucion guardar|aplicar|listar <archivo> ...
aplicar <archivo> --ops ops.json [--simular]    # lote atómico; devuelve las incidencias
plano <archivo> --texto | --svg salida.svg
```
- Códigos de salida: 0 bien, 1 hay incidencias de gravedad error, 2 archivo inválido, 3 error de uso o de E/S.
- `--json` escribe en ASCII con escapes.

## Hitos
| Hito | Contenido | Aceptación |
| :--- | :--- | :--- |
| H0 | Proyecto, Git, `AGENTS.md`, *build* mínimo | El HTML único abre desde `file://` en Edge, sin errores de consola y sin ninguna petición http(s)/ws |
| H1 | Primera versión mínima usable: estancia rectangular (ancho×largo×alto), muebles caja con marca de frente, arrastrar sobre el suelo, girar (R / Mayús+R), empujar con las flechas, imán a muros y bordes (Mayús lo desactiva), Supr, Ctrl+D, Ctrl+Z/Y, vistas Plano/3D, abrir y guardar | Pruebas `node:test` del núcleo, más una prueba de extremo a extremo con Playwright y Edge (almacén falso) y capturas revisadas a ojo; **el autor la prueba y opina** |
| H2 | Análisis completo, CLI, plano en texto y en SVG, esquema con prueba de paridad | Pruebas del CLI por subproceso, incluidos la escritura atómica y los reintentos |
| H3 | Estancia por tramos (longitud + giro) con aviso de descuadre, edición de vértices, huecos, 3–4 formas (cama, armario, escritorio, silla) además de la caja, sincronía en vivo, cotas | Prueba de extremo a extremo con almacén falso: un cambio externo se refleja; comprobación manual de disco real |
| H4 | Distribuciones, exportación `.glb` (nodos con nombre igual al id, origen en el centro del suelo, `MeshStandardMaterial`), PNG y SVG, `dist/Espacios3D` + zip | Copia en un directorio temporal: abre sin peticiones de red y el CLI funciona desde allí. Una sesión nueva de un agente sin contexto cumple «añade un escritorio de 120×60 junto a la ventana» sólo con el `AGENTS.md` de la carpeta: `analizar` sale con 0 y el escritorio queda a ≤ 30 cm del muro de la ventana y solapando su tramo |

Fuera de v1: modelos `.glb` propios por mueble, varias estancias, herramienta MCP dentro de otro asistente, física y modo juego, `node espacios3d.mjs servir`.

## Riesgos
- [Suposición] El ordenador de los agentes del receptor tiene Node ≥ 18. Si no lo tiene, el agente edita el JSON siguiendo el esquema y la página lo valida al abrirlo.
- [Suposición] Chromium ve el archivo reemplazado por el renombrado del CLI. Se comprueba a mano en H3.
- [No verificado] Que el permiso de File System Access persista entre sesiones.
- La comodidad no se mide con pruebas: la juzga el autor al final de H1.
