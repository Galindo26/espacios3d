# Ronda 4 — Plan (11/11/2026)

Encargo del autor (11/11/2026): «Empieza la ronda 4 y déjala completa». Alcance: la lista que la ronda 2 dejó fuera (`PLAN_R2.md`, «Alcance: a la ronda 3», y su definición en «Otras mejoras incluidas» y «Fotos de la habitación y de muebles»), sin lo ya hecho en la ronda 3 (mandos táctiles):

1. «¿Cabe por la puerta?»;
2. paso libre de 60 cm desde la puerta hasta cada mueble (rejilla de 10 cm);
3. círculo de giro de 150 cm, opcional;
4. materiales básicos: suelo (liso, parquet, baldosa, moqueta) con color y color de paredes por estancia, con texturas procedurales;
5. PDF del plano acotado con el «Imprimir» del navegador, sin librerías;
6. «Ayuda rápida» animada de 3 pasos;
7. fotos asociadas a estancias y muebles (`fotos/`).

Sigue fuera (decisión de la ronda 2): reconstrucción desde fotos, IA dentro de la herramienta, WebXR, varias personas a la vez, texturas fotográficas y costes.

Formato: `version: 2`. Todos los campos nuevos son opcionales; ningún archivo válido deja de serlo.

## R4-1. Comprobaciones de acceso (núcleo, CLI y página)

### a. «¿Cabe por la puerta?» (regla `acceso`, aviso)
- Un mueble **pasa por un hueco** de ancho libre W y alto H si, con sus medidas ordenadas d1 ≤ d2 ≤ d3, d1 ≤ W y d2 ≤ H, o d1 ≤ H y d2 ≤ W (entra de canto o tumbado; d3 va a lo largo). No se modelan giros en pasillos ni inclinarlo en diagonal: es conservador.
- Ancho libre: puertas, `ancho − 4` (la hoja abierta); pasos, `ancho`. Alto: el del hueco. Escaleras: su `ancho` × 200.
- **Camino**: grafo de estancias con las conexiones del modelo derivado (puertas y pasos, también al exterior) y las escaleras (de la estancia del pie a la de la llegada). Un mueble entra si hay un camino desde el exterior hasta su estancia por huecos por los que pasa.
- Sólo se comprueba si la casa tiene alguna puerta o paso al exterior (si no, no se sabe por dónde se entra). Aviso: «“Sofá” (sofa) no entra hasta “Salón”: mide 220 × 95 × 85 y el camino más ancho deja pasar 76 × 203 (puerta p1)». Las alfombras y lo plano (≤ 3 cm) no se comprueban (se enrollan).
- `entradaMueble(e, id)` da el resultado para la ficha de la página: «Entra por la puerta: sí, de canto» o «no, …».

### b. Paso libre de 60 cm (regla `acceso`, aviso)
- Rejilla de 10 cm por planta. Una celda es libre si una persona de 60 cm (círculo de radio 30) cabe en ella sin cruzar muros (salvo por puertas y pasos), muebles que estorban (los del recorrido: entre 30 y 180 cm) ni obra: se reutilizan los segmentos de `obstaculos` del recorrido y las barreras de las escaleras.
- Se inunda desde las puertas y pasos de la planta y desde las llegadas de las escaleras que llegan.
- Un mueble se alcanza si alguna celda alcanzada está a menos de 30 + 8 cm de su huella. Aviso: «No se llega a “Armario” (armario) con un paso libre de 60 cm desde la puerta». No se comprueba lo plano (alfombras), lo colgado alto (elevación ≥ 180) ni las plantas sin puertas, pasos ni escaleras.

### c. Círculo de giro de 150 cm (regla `giro`, aviso; opcional por estancia)
- Estancia `circuloDeGiro: true`. Se busca en una rejilla de 5 cm un centro a ≥ 75 cm de las paredes de la estancia y de los muebles y la obra que estorban a una silla de ruedas (entre 0 y 180 cm de altura; lo que está por encima de 67 cm con hueco debajo no estorba los pies: `huecoInferior ≥ 67`). Aviso si no hay: «En “Baño” no cabe un círculo de giro de 150 cm».
- `circuloDeGiro(e, estancia)` devuelve el centro encontrado; la página lo dibuja (discontinuo) en planta.
- Página: casilla «Comprobar círculo de giro (150 cm)» en «Estancia». Lote: `estancia {circuloDeGiro}`.

### Pruebas (R4-1)
Núcleo: pasar por huecos (de canto, tumbado, no pasa), camino con un pasillo estrecho, sin puerta al exterior no se comprueba, por la escalera; paso libre (cama que encierra una mesilla, mueble alcanzable, alfombra ignorada); círculo de giro (cabe, no cabe por un mueble, sin la opción no se mira). El ejemplo de la entrega sigue sin incidencias.

## R4-2. Materiales

- Estancia `suelo: {tipo: "liso"|"parquet"|"baldosa"|"moqueta", color?}` y `paredes: "#rrggbb"`. Lote y CLI: `estancia {suelo, colorSuelo, paredes}` (`null` quita).
- Página: en «Estancia», «Suelo» (desplegable y color) y «Paredes» (color). En 3D, texturas procedurales dibujadas en un lienzo (vetas de tablas, juntas de baldosa, grano de moqueta), a escala real; en el plano, el color liso (para que se lean las cotas y la rejilla).
- Paredes: un revestimiento fino (0,5 cm) en la cara interior de cada pared de la estancia, del suelo al techo, con los huecos de puertas, pasos y ventanas recortados (también los que vienen de la estancia vecina en el mismo tabique). Así cada lado de un tabique tiene el color de su estancia.
- `.glb`: el suelo con el color del material y `extras.suelo`; las paredes con su revestimiento como nodo `paredes-<estancia>`. Sin texturas (el `.glb` no lleva imágenes).

### Pruebas (R4-2)
Validación y paridad del esquema; `.glb` válido con los materiales; e2e: cambiar suelo y paredes desde la ficha, captura en 3D.

## R4-3. Fotos

- `fotos: ["fotos/cama.jpg", …]` en estancias y muebles: rutas relativas como las de los fondos (sin «..»), `.jpg`, `.jpeg`, `.png` o `.webp`.
- Lote: `foto-agregar {para, foto}` y `foto-quitar {para, foto}` (para = id de estancia o de mueble). CLI: `foto agregar|quitar <archivo> --para cama --foto fotos/cama.jpg` (agregar exige que el archivo exista). `describir` y `resumen` las listan.
- Página: «Fotos» en la ficha del mueble y en «Estancia», con miniaturas leídas de la carpeta de trabajo (URL de objeto, sin red), ampliar al pulsar, «Añadir foto…» (se copia a `fotos/`, con nombre libre) y quitar. Sin carpeta de trabajo, el botón pide abrirla, como los modelos y los fondos. Una foto que falta se ve como «no está».
- Guía de la entrega: «desde fotos» (asociar las fotos que se usaron para medir).

### Pruebas (R4-3)
Validación (rutas, extensiones, campo desconocido), lote, CLI (archivo inexistente); e2e con el disco falso: añadir una foto a un mueble, miniatura, ampliar, quitar.

## R4-4. Imprimir y ayuda

### a. PDF del plano acotado
- Núcleo `planoImprimible(e)`: un HTML con una hoja A4 apaisada por planta, el SVG acotado de cada una a **escala normalizada** (1:20, 1:25, 1:50, 1:75, 1:100, 1:200… la mayor que quepa), el nombre, la planta, la escala y la fecha. Medidas en mm en el SVG, para que impreso al 100 % la escala sea real.
- Página: «Imprimir o PDF» en «Exportar»: abre una ventana con ese HTML y el diálogo de impresión del navegador («Guardar como PDF»).
- CLI: `plano <archivo> --imprimible plano.html` escribe el mismo HTML para abrirlo e imprimirlo.

### b. «Ayuda rápida»
- En el diálogo de ayuda («?») y en la invitación del principio: tres pasos animados con SVG y CSS (medidas y forma libre; muebles y arrastre con imán; 3D y Recorrer). Con `prefers-reduced-motion`, cuadros quietos.

### Pruebas (R4-4)
Núcleo: HTML con una hoja por planta, escala elegida, ancho en mm coherente con la escala; CLI. e2e: «Imprimir o PDF» con `window.open` simulado (HTML escrito y `print` llamado), ayuda rápida visible con sus tres pasos.

## Orden, revisiones y cierre
- R4-1 → R4-2 → R4-3 → R4-4, con commit por paso (`R4-1: …`), `npm run check` en cada uno y capturas revisadas a ojo.
- Revisión independiente del plan y de cada paso, cuando tenga cuota.
- Documentación del proyecto al día.

## Estado al cierre de la ronda 4 (12/11/2026)

| Paso | Comprobación | Revisión independiente |
| :--- | :--- | :--- |
| Plan | — | Pendiente (HTTP 429 al pedirla) |
| R4-1 Acceso | `tests/unit/r41.test.mjs` (13) y e2e: aviso del sofá, ficha «Entra por la puerta», círculo dibujado | Pendiente |
| R4-2 Materiales | `tests/unit/r42.test.mjs` (6), 3 casos de paridad y e2e con captura 32 | Pendiente |
| R4-3 Fotos | `tests/unit/r43.test.mjs` (5, CLI por subproceso) y e2e con el disco falso (captura 33) | Pendiente |
| R4-4 Imprimir y ayuda | `tests/unit/r44.test.mjs` (3) y e2e: `window.open` simulado, ayuda con y sin «reducir movimiento» (captura 34) | Pendiente |

**Comprobaciones** (`npm run check` con `PYTHONIOENCODING=utf-8`): 402 unitarias, 258 comprobaciones e2e, cero peticiones de red y cero errores de consola. HTML de 1148 KB (objetivo: menos de 1,2 MB); CLI de 428 KB. Las salidas de referencia de la v1 no cambian.

**Desviaciones del plan:**
- El paso libre de 60 cm **no se comprueba en plantas que ya tienen errores**: un mueble que tapa una puerta dejaba «sin paso» a todos los demás y repetía el problema en cada mueble (y cambiaba las salidas de referencia de la v1).
- Para que el paso libre no ralentice la página, los segmentos se reparten en cubetas de 100 cm (de unos 40 a unos 15 ms en una planta de 12 × 8 m con 24 muebles).
- Escalas normalizadas con 1:30 y 1:40 además de 1:20, 1:25, 1:50…: con sólo 1:25 y 1:50, un dormitorio quedaba en un tercio de la hoja. Los rótulos del imprimible miden 2,8 mm en el papel a cualquier escala, el margen del SVG crece con ellos y las cotas van a lo largo de cada pared; el SVG de «Exportar» no cambia (sus salidas de referencia de la v1 se conservan).
- Las fotos que no están: el CLI rechaza `foto agregar` si no existe el archivo, y un lote (CLI o MCP) la asocia y avisa, como con los modelos.
- El `.glb` lleva el color de suelos y paredes, sin texturas (no lleva imágenes).

**Revisión independiente (12/11/2026)** de la ronda 4 y de «cosas en la pared»: sin bloqueantes; veredictos «Listo con arreglos» (R4-1, R4-2, R4-4 y pared) y «Listo» (R4-3). Arreglado, con prueba que falla antes y pasa después:
- 1 y 2: el paso libre daba «No se llega» falsos según el fondo de un mueble o 1 cm de desplazamiento: radio de la rejilla `(60 − 10) / 2` y alcance coherente; sólo se miran las celdas de la caja de cada mueble (5).
- 3: el colgado automático podía quedar sobre la puerta de la vecina, contra un pilar o bajo un techo inclinado: cada sitio candidato se prueba con el análisis.
- 4: el imprimible repetía el análisis por cada escala (5,2 s → 0,11 s en tres plantas grandes); la ventana se abre antes de calcular.
- 6: el círculo de giro no contaba las escaleras. 7: una estancia con id «exterior» se tomaba por la calle. 8: suelos con dibujo sin coordenadas de textura en las otras plantas. 9: el SVG por defecto cambiaba el margen en plantas anchas (ya no). 10: la prueba del ancho en mm, el esquema de fotos («..», «http://») y `--planta` con `--imprimible`. 11: ayuda de las esquinas junto a su casilla, animaciones de una sola vez (menos de 5 s), fotos «Cargando…», foco tras quitar, reintento de las que faltaban y resalte de la estancia elegida con acabado. 12: duplicar algo colgado lo deja en la pared; «Mis muebles» va a la estancia elegida.
- Quedan sin cambiar: las URL de objeto de las fotos no se revocan (sólo crecen al abrir otros espacios); el paso libre siembra en todas las puertas, así que no detecta un pasillo taponado entre la entrada y un cuarto con otra puerta (conforme al plan; el aviso dice «desde alguna puerta»); y, como en la ronda 3, los campos nuevos siguen en `version: 2`: una entrega anterior rechazaría archivos que los usen.

**Sin verificar:**
- imprimir en papel a tamaño real y medir la barra de 1 m (en pantalla el SVG mide lo que dice; la impresora y el «ajustar a la página» del navegador pueden cambiarlo);
- el diálogo de imprimir real del navegador (la e2e simula `window.open`);
- elegir una foto con el selector nativo de un móvil;
- si los avisos de acceso resultan útiles o pesados en casas reales: lo juzga el autor.
