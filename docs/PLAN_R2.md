# Plan de la ronda 2 de Espacios 3D

> **Estado (11/11/2026):** revisado de forma independiente, «aprobar con cambios». La sección «Cambios tras la revisión independiente» del final **sustituye** a lo que contradiga del borrador: modelo de muros, orden de hitos, formato y alcance.

## Borrador inicial

## Encargo del autor (tras probar la v1)
- La habitación puede no tener sólo 4 vértices: columnas y otros elementos. (La v1 ya admite contornos libres por «Paredes una a una» y «Editar esquinas», pero poco a la vista; no admite elementos interiores.)
- Futuro: videojuegos → **casas enteras**.
- **Recorrido en primera persona** para ver cómo quedaría.
- **Importar fotos y planos** para partir de una base.
- Respuestas a las preguntas:
  - Quiere las cuatro líneas: habitación real, primera persona, importar y casa entera.
  - Importar: imagen de plano, agente con visión, fotos de la habitación y fotos de muebles. Y sobre todo: **«que pueda pasárselo a alguien y que esa persona pueda pasarle planos y fotos a un agente para que use fácilmente la herramienta para hacer habitaciones y muebles y colocar todo; después la persona puede modificar y usar lo que construyó el agente. Es importante que la herramienta tenga todas las vías posibles para que los agentes puedan ayudar a construir».**
  - Motor de juego: aún no lo sabe → `.glb` limpio y agnóstico, sin atarse a un motor.
  - Modelos 3D de muebles: poder usarlos, nunca obligatorio importar nada; las formas genéricas se quedan.

## Restricciones que siguen
- 100 % local en el ordenador del receptor, sin red y sin depender de otros programas.
- HTML único y CLI de un archivo sin dependencias.
- Una sola lógica en `src/core`; cm y grados.
- No pisar a otros escritores.
- Nada personal en la entrega.

## Decisión estructural: formato v2 pensado para casas desde ya
Para no migrar dos veces, la v2 del formato nace con casas, aunque la página las use por fases.
```jsonc
{
  "formato": "espacios3d", "version": 2, "nombre": "Mi piso",
  "plantas": [
    { "id": "p0", "nombre": "Planta baja", "nivel": 0, "altura": 250,   // cota del suelo (cm) y altura libre por defecto
      "estancias": [
        { "id": "dormitorio", "nombre": "Dormitorio", "contorno": [[0,0],[350,0],[350,300],[0,300]],
          "grosorMuros": 10, "altura": 250,
          "techo": null | { "tipo": "inclinado", "muro": 0, "alturaEnMuro": 120, "alturaOpuesta": 250 },
          "huecos": [ /* como v1, por muro de esta estancia */ ],
          "elementos": [ /* fijos de obra: ver abajo */ ],
          "suelo": { "material": "parquet" }, "paredes": { "color": "#f1ede6" } }
      ],
      "muebles": [ /* coordenadas de la planta; cada uno con "estancia" calculada, no guardada */ ],
      "escaleras": [ { "id": "esc1", "x": 0, "y": 0, "ancho": 90, "largo": 300, "giro": 0, "hasta": "p1" } ] }
  ],
  "fondos": [ { "id": "plano", "planta": "p0", "archivo": "planos/piso.png", "escala": 0.5, "x": 0, "y": 0, "giro": 0, "opacidad": 0.5 } ],
  "distribuciones": [], "notas": ""
}
```
- **Migración v1 → v2:** una planta con una estancia y los muebles; el núcleo lee v1 y escribe v2. El CLI y la página avisan de que el archivo se actualiza. Prueba de ida y vuelta.
- **Muros entre estancias:** cada estancia conserva su contorno (cara interior). Al dibujar, dos aristas de estancias distintas que coinciden (paralelas, a una distancia igual a la suma de sus semigrosores y solapadas) forman **un solo muro** con huecos de ambas. Una puerta en ese muro comunica las dos estancias. Así no hay paredes duplicadas en el `.glb`, y cada estancia sigue siendo un polígono simple, editable por tramos y por esquinas como en la v1.
- **Muebles por planta**, no por estancia: se pueden arrastrar de una habitación a otra. El análisis comprueba que cada mueble quede dentro de **alguna** estancia y no cruce un muro.

## Elementos fijos de obra («habitación real»)
`elementos: [{ id, tipo, ... }]` dentro de la estancia. No son muebles: no se arrastran por defecto, se dibujan con el material de pared y el análisis los trata como obstáculos.

| Tipo | Geometría | Análisis |
| :--- | :--- | :--- |
| `columna` | rect o círculo en x, y; alto = techo | solape = error |
| `pilar` | rect adosado a un muro (muro, desde, ancho, fondo) | solape = error |
| `radiador` | en muro (muro, desde, ancho, fondo, alto, elevación) | solape = error; tapado delante (< 10 cm) = aviso |
| `chimenea`, `empotrado` (nicho o armario empotrado) | en muro, hacia dentro (chimenea) o hacia fuera (nicho, que amplía el suelo) | según tipo |
| `viga` | segmento en altura (de un punto a otro, canto y ancho) | mueble más alto que la cara inferior de la viga = error |
| `enchufe`, `interruptor`, `toma` | punto en muro (muro, desde, altura) | tapado por un mueble más alto que su altura y pegado al muro = aviso |
| `escalon` | rect a ras de suelo con alto | aviso si un mueble queda a medias |

**Techo inclinado** (buhardillas): la altura en un punto es la interpolación entre `alturaEnMuro` y `alturaOpuesta`, perpendicular a ese muro. Error si un mueble supera la altura en cualquiera de sus esquinas.

**Hacer visible la forma libre**: en la sección «Estancia», dos pestañas, «Rectangular» y «Forma libre» (tabla de paredes y edición de esquinas). Más una «Ayuda rápida» con una animación de 3 pasos o un GIF incrustado; tamaño a decidir.

## Primera persona
- Modo «Recorrer» (botón y tecla P):
  - cámara a 160 cm (ajustable);
  - **WASD/flechas + ratón** con Pointer Lock;
  - Mayús para correr y Esc para salir.
- Colisiones 2D:
  - un círculo de 20 cm contra muros (salvo en huecos de puerta y paso) y contra muebles más altos de 30 cm;
  - escaleras: transición de planta al recorrerlas.
- Móvil: dos joysticks táctiles (moverse y mirar).
- Muros sin ocultar en este modo, iluminación con sombras y techo visible (gris claro).

## Importación y «todas las vías para agentes»
La pieza clave es una **carpeta de trabajo**. Desde la página se abre una carpeta (File System Access `showDirectoryPicker`; también desde `file://` en Chromium, a comprobar en el hito) en lugar de un solo archivo. Así la página puede leer y escribir el espacio **y los archivos que lo acompañan**: planos (`planos/`), fotos (`fotos/`) y modelos (`modelos/`). El agente usa la misma carpeta. Sin File System Access (Firefox o Safari) los archivos se eligen a mano cada vez y se guardan en IndexedDB.

1. **Plano de fondo y calco** (persona y agente):
   - En la página: «Poner plano de fondo» (PNG/JPG; PDF no, para no meter pdf.js) y «Calibrar»: marcas dos puntos y escribes su distancia real (cm).
   - Opacidad, giro y mover el fondo.
   - Herramienta «Dibujar paredes» en el plano: clic en cada esquina, con imán a 90° y a las líneas del fondo cercanas, y doble clic o Intro para cerrar. Crea la estancia.
   - El CLI hace lo mismo con `fondo poner --imagen planos/x.png --escala ... | --calibrar "x1,y1,x2,y2,distancia"` y `estancia agregar --puntos "..." | --tramos "..."`.
2. **Agente con visión**:
   - El agente mira las imágenes con sus propias capacidades: la herramienta no incluye IA.
   - La herramienta le da todo lo que necesita para construir y comprobar:
     - **Operaciones para todo** lo que hace la página (estancias, contorno, elementos, huecos, muebles, piezas, modelos, fondos, plantas, escaleras, distribuciones) por CLI y por lote.
     - **`plano --png`**: un rasterizador propio sin dependencias (polígonos, líneas, colores y letras de 5×7 px) más el codificador PNG de `zlib` de Node. Así un agente con visión **ve** su resultado. Con `--sobre-fondo` pinta encima del plano de fondo calibrado para comparar; sólo con fondos PNG (decodificador PNG con zlib; JPEG no, salvo convertirlo antes).
     - **`describir --json`**: geometría derivada (muros con normales y longitudes, zonas libres, qué hay en cada estancia) para razonar sin calcular.
     - **Guía en `AGENTS.md`**:
       - Flujo «desde un plano»: leer las cotas o pedir una medida de referencia, construir la estancia, comparar con `plano --png --sobre-fondo` e iterar.
       - Flujo «desde fotos de la habitación»: precisión baja; pedir 1–2 medidas con cinta; dejar `notas` con lo supuesto.
       - Flujo «desde fotos de muebles»: medidas → mueble genérico o con piezas; `.glb` si lo hay.
   - **Servidor MCP opcional en la carpeta** (`espacios3d-mcp.mjs`, stdio, sin dependencias, JSON-RPC escrito a mano). Expone las mismas operaciones como herramientas. Con un `.mcp.json` en la carpeta que Claude Code ofrece activar; otros agentes lo registran a mano. Sigue siendo local.
3. **Fotos de la habitación y de muebles**:
   - La herramienta las guarda en `fotos/` y las enseña junto a la estancia o el mueble (`fotos: ["fotos/cama.jpg"]`), para que persona y agente las tengan a mano.
   - No hay reconstrucción automática: necesita IA pesada.
   - Fotos → 3D (Hunyuan3D o TRELLIS en GPU) queda **fuera de la herramienta**: si alguien genera un `.glb`, se asigna al mueble.

## Muebles: piezas y modelos opcionales
- **Piezas** (para agentes y para juegos, sin importar nada):
  - `piezas: [{ forma: "caja"|"cilindro"|"esfera"|"cuña", x, y, z, ancho, fondo, alto, giro, color }]` en coordenadas locales del mueble, que debe contenerlas.
  - Ejemplos: un sofá en L, un escritorio con cajonera, una lámpara.
  - La forma genérica por tipo sigue siendo la que se usa por defecto.
- **Modelo `.glb` opcional**: `modelo: "modelos/cama.glb"` en la carpeta de trabajo.
  - Se ajusta a ancho × fondo × alto, o se conserva su tamaño con «usar medidas del modelo».
  - Si falta el archivo, se muestra la forma genérica y un aviso.
  - Las colisiones usan siempre las medidas.
  - El `.glb` exportado lo incluye.
- **Catálogo «Mis muebles»**: guardar un mueble (medidas, piezas, modelo) como plantilla reutilizable en `catalogo.json` de la carpeta de trabajo.

## Otras mejoras incluidas
- **Selección múltiple**: Mayús+clic o recuadro, para mover, girar y duplicar en grupo.
- **Cinta métrica**: medir entre dos puntos cualquiera.
- **Comprobaciones nuevas**:
  - «¿Cabe por la puerta?»: el mueble cabe por algún hueco de paso girándolo; se informa, no es error;
  - paso libre de 60 cm desde la puerta hasta cada mueble, con búsqueda en rejilla de 10 cm;
  - círculo de giro de 150 cm, opcional.
- **Materiales básicos**: suelo (parquet, baldosa, moqueta o color) y color de paredes por estancia; sin texturas externas, sólo procedurales.
- **PDF del plano acotado**: con el «Imprimir» del navegador sobre el SVG en una ventana; sin librerías.
- **Exportación para juegos agnóstica**:
  - `.glb` con suelo, muros, techo opcional, muebles y piezas con nombre;
  - `extras` con tipo, medidas y estancia;
  - una malla de colisión simplificada (cajas) como nodos `COL_*` aparte;
  - un archivo `escena.json` con estancias, puertas y su conexión, y puntos de interés para importarlo en cualquier motor.

## Fuera de la ronda 2
Reconstrucción automática desde fotos, IA dentro de la herramienta, realidad virtual (WebXR), varias personas a la vez en línea, texturas fotográficas y costes o listas de compra.

## Hitos propuestos (con revisión independiente de cada uno)
| Hito | Contenido | Aceptación |
| :--- | :--- | :--- |
| R2-1 | Formato v2 (plantas, estancias, elementos, techo, fondos, piezas, modelo) con migración desde v1; núcleo, CLI y página leen y escriben v2 con una estancia | Ida y vuelta de v1 a v2; todas las pruebas de la v1 adaptadas y en verde |
| R2-2 | Habitación real: elementos fijos, techo inclinado y viga en el análisis y el dibujo; pestañas Rectangular / Forma libre | Pruebas del núcleo de cada elemento y del techo; e2e: columna en medio y radiador |
| R2-3 | Primera persona: teclado, ratón y táctil, colisiones con muros y muebles, paso por puertas | e2e: andar hasta un muro no lo atraviesa; cruzar una puerta; captura |
| R2-4 | Carpeta de trabajo, plano de fondo, calibrado, dibujar paredes; CLI `fondo`, `estancia agregar`, `plano --png [--sobre-fondo]`, `describir` | e2e: calcar un plano sintético de medidas conocidas con error < 1 %; PNG legible |
| R2-5 | Piezas, modelos `.glb` opcionales, catálogo «Mis muebles», selección múltiple y cinta | e2e: mueble con piezas y con modelo; un modelo que falta no rompe nada |
| R2-6 | Casa entera: varias estancias por planta, muros compartidos, puertas que comunican, plantas y escaleras; recorrido entre estancias y plantas | e2e: piso de 3 estancias con pasillo; 2 plantas con escalera; `.glb` sin muros duplicados |
| R2-7 | Vías para agentes: servidor MCP, guías de `AGENTS.md` (plano, fotos, muebles), exportación para juegos con colisiones y `escena.json` | Aceptación: un agente nuevo, sólo con la carpeta, una imagen de plano sintético y 2 fotos de muebles, construye el piso y amuebla una habitación; comprobado con `analizar` y con medidas frente al plano |

## Riesgos y supuestos
- [Suposición] `showDirectoryPicker` funciona desde `file://` en Edge/Chrome; se comprueba al empezar R2-4. Si no, el plan B es elegir los archivos a mano y guardarlos en IndexedDB.
- **Tamaño**: el rasterizador PNG, el decodificador PNG y el MCP van en el CLI, no en el HTML. El HTML crece con la primera persona y la casa: objetivo de menos de 1,2 MB.
- **Muros compartidos**: la parte con más riesgo geométrico (aristas casi coincidentes, grosores distintos, huecos en el muro común). Se decide la tolerancia y se prueba con casos borde.
- **MCP**: protocolo implementado a mano. Probar con Claude Code real en la carpeta.
- La comodidad de la primera persona y del calco la juzga el autor.

## Cambios tras la revisión independiente (vigentes)

### Comprobado en la revisión (Edge 157 headless sobre file://, Node 24, Claude Code 2.1.322)
- `showDirectoryPicker` existe y `isSecureContext` es true; elegir una carpeta real se comprueba a mano.
- Archivos hermanos sin manejador: `<img>` se ve, pero el canvas queda contaminado y `fetch` bloqueado. Fondos y `.glb` sólo entran por manejador → Blob.
- OPFS no funciona en `file://`; IndexedDB sí.
- Pointer Lock se concede tras un clic.
- PNG con zlib a mano: ida y vuelta exacta.
- MCP stdio a mano funciona con Claude Code. Hay que responder −32601 a lo desconocido y devolver la versión de protocolo pedida.

### Modelo de muros (sustituye a «muros compartidos por coincidencia de aristas»)
- Estancias = polígonos de cara interior (se conservan los tramos, la cinta y la edición de la v1).
- La **masa de muro se deriva** con booleanas: (unión de estancias desplazada `grosorExterior` hacia fuera) − (unión de estancias). El grosor de un tabique interior es la separación real entre estancias. `grosorExterior` va en la planta.
- Una puerta comunica con la estancia que tenga enfrente a ≤ N cm; si no da a nada, aviso.
- Booleanas con una librería de recorte con enteros (MIT), empaquetada como three; nada a mano.
  - **Cambio al implementarlo (R2-2, 11/11/2026):** `clipper2-js` 1.2.4 falla (`executePolyTree` devuelve vacío por un error interno; `Union` repite vértices). Se usa `polygon-clipping` 0.15.7 (MIT, coma flotante con predicados robustos) sobre una rejilla de 0,001 cm, que en la verificación independiente no falló en 40 000 casos. Si reaparecen fallos, evaluar `clipper-lib` 6.4.2 (enteros), que dio los mismos resultados en la prueba inicial.
- Un único **modelo derivado** en el núcleo (muros, suelo transitable, conexiones, piezas) del que salen el dibujo, el `.glb` (también desde el CLI), el PNG, el análisis, el recorrido y `describir`.

### Formato v2
- Ids únicos en todo el archivo. `planta` en las posiciones de las distribuciones.
- `fondos` dentro de la planta, con `anchoPx`/`altoPx` y origen declarado.
- Techo como `faldones: [{ancla, alturaEnMuro, alcance}]`, con altura = mínimo de los faldones (una pendiente con tramo plano, dos aguas…).
- Elementos con 4 geometrías (exento, adosado, punto en muro, viga) y el tipo como etiqueta. Sin `empotrado` hacia fuera: eso es contorno + armario bloqueado.
- **Ancla común** `{muro, desde}` para huecos, elementos y faldones, con una sola reindexación. `cambiarContorno` con distinto número de paredes la usa en lugar de rechazar.
- `modelo: {archivo, giro, ajuste}`. Un `.glb` con Draco, meshopt o KTX2 da aviso y se muestra la forma genérica.
- `escaleras` entra con su hito (sentido de subida, hueco en el forjado, tipos).
- **El formato se congela al cerrar la ronda**: cada hito añade sus campos.
- Migración: salidas de referencia (incidencias, plano en texto, SVG) generadas con la v1 y exigidas idénticas tras migrar. Se escribe v2 sólo tras un cambio del usuario y con copia `.v1` al lado.
- Rutas relativas al JSON, validadas en el núcleo (sin absolutas ni `..`).

### Vías para agentes (además del borrador)
- **Chat sin disco** (apps de ChatGPT, Claude o Gemini):
  - guía de un solo archivo para subirla junto a `espacios3d.mjs`;
  - en la página, «Importar o pegar JSON/lote» con errores copiables;
  - en la página, «Copiar para el agente» (descripción + PNG).
- **`exportar --glb` en el CLI**:
  - las formas genéricas por tipo pasan a ser `piezas` del núcleo;
  - el escritor de `.glb` es propio, sin three;
  - `escena.json` = `describir --json`.
- **MCP dentro del CLI** (`espacios3d.mjs mcp`): 4 herramientas (describir, aplicar lote, analizar, plano como imagen) generadas de la tabla de operaciones.
- **`--rejilla` rotulada** sobre el fondo (px antes de calibrar, cm después).
- **Importar fondos en la página**: JPEG → PNG reducido, y pegar con Ctrl+V (capturas de un PDF).
- `entrega/AGENTS.md` corto, con guías por flujo en archivos aparte.

### Alcance: a la ronda 3
Joysticks táctiles, círculo de giro, «¿cabe por la puerta?», paso libre en rejilla, materiales, PDF, «Ayuda rápida» animada y fotos asociadas a estancias o muebles (salvo lo que pida la guía de agentes).

### Hitos vigentes
| Hito | Contenido | Aceptación |
| :--- | :--- | :--- |
| R2-0 | Arreglos de la prueba del autor con la v1; comprobación manual de disco y de carpeta real; salidas de referencia de la v1 | Lista de lo que el autor señale, cerrada; selectores reales comprobados |
| R2-1 | Esqueleto v2 y migración (una planta, una estancia, ancla común) | Salidas de referencia idénticas; copia `.v1`; ida y vuelta |
| R2-2 | Núcleo de varias estancias en una planta: muros derivados con booleanas, conexiones, análisis por estancias, dibujo y edición | e2e: piso de 3 estancias con pasillo; `.glb` leído en `node:test` con volumen de muros = analítico ± 1 % y sin duplicados |
| R2-3 | Carpeta de trabajo, fondo, calibrado, calco, `plano --png [--sobre-fondo] [--rejilla]`, `describir`, `exportar --glb`, guía «desde plano», vías de chat, y una mini aceptación con un agente | Calco de un plano sintético con error < 1 %; PNG con píxeles en puntos conocidos y decodificado en Edge; un agente reproduce un plano con cotas ≤ 2 % o 5 cm |
| R2-4 | Habitación real: elementos, faldones y vigas | Pruebas del núcleo por geometría; e2e de columna, radiador y buhardilla |
| R2-5 | Primera persona (teclado y ratón; colisión pura en el núcleo, con pruebas), recorrido entre estancias | Pruebas del núcleo de la colisión; e2e por teclado: no se atraviesa un muro y se cruza una puerta |
| R2-6 | Piezas, modelos `.glb` opcionales, catálogo «Mis muebles», selección múltiple, cinta | e2e: mueble con piezas y con modelo; un modelo que falta no rompe nada |
| R2-7 | Plantas y escaleras, MCP, exportación para juegos (`COL_*`), aceptación final | 3 ejecuciones con 2 agentes distintos y sin intervención: plano con cotas (≤ 2 % o 5 cm), plano sin cotas con una medida (≤ 10 %), un plano real; conexiones iguales a las reales; e2e de «la persona retoca» (mover un muro compartido y guardar) |

## R2-7 en detalle (11/11/2026, con la revisión independiente y las decisiones del autor aplicadas)

Orden: a → b → c → d → e. Cada paso con pruebas y revisión independiente; R2-7 se cierra con la aceptación (e). Antes de a, se cierran S1–S4 de la revisión de R2-6.

Correcciones de premisas tras la revisión:
- La página usa la primera planta en unas 46 llamadas, no 24 (revisión: `main.ts` 20, `ui.ts` 9, `escena.ts` 6, `calco.ts` 6, `recorrer.ts` 3, `modelos.ts` 1, `cinta.ts` 1).
- `Planta` no tiene `altura` (la tienen las estancias) y una planta sin estancias no es válida.
- El MCP ya está escrito (`src/cli/mcp.ts`, `tests/unit/mcp.test.mjs`): el paso c es cablearlo al CLI.
- No existe ninguna operación que mueva un tabique compartido: se añade en a.

### Convenciones comunes
- **Todas las plantas comparten origen** de coordenadas (x, y); `nivel` es la cota del suelo (cm).
- **Forjado:** lo que hay entre el techo más alto de una planta y el suelo de la siguiente. Con `nivel` de arriba menor que `nivel` de abajo + la altura mayor de sus estancias, **aviso** (los pisos se pisarían). En el `.glb` del núcleo el forjado no se rellena en esta ronda: suelos de 2 cm por estancia, como hoy.
- `nivel` por defecto de una planta nueva: el de la más alta + su altura mayor + 30 cm de forjado.

### a. Plantas y tabiques
- Lote y CLI:
  - `planta-agregar {id?, nombre?, nivel?, copiarDe?, conVentanas?, ancho?, largo?, contorno?, alto?}`. Con `copiarDe`, copia los contornos de las estancias y el `grosorExterior` (y sus ventanas con `conVentanas`; las puertas no, que no suelen repetirse), sin muebles ni obra; ids nuevos `<estancia>-<planta>`. Sin `copiarDe`, crea una primera estancia (`ancho` y `largo` o `contorno`). `alto` es la altura de las estancias creadas o copiadas.
  - `planta-editar {id, nombre?, nivel?}`: rechaza un `nivel` que deje una escalera con destino más bajo que su origen.
  - `planta-quitar {id}`: rechaza la última planta; se lleva sus estancias, muebles, obra, fondos y las escaleras que salen de ella o llegan a ella, y limpia las posiciones de distribución de esa planta (si no, el archivo queda inválido). La nota dice cuántas cosas se han ido; la página lo confirma con esas cifras.
  - `tabique-mover {estancia, muro, distancia}`: mueve una pared y, con ella, la de la estancia vecina que da a ella (la que está a la distancia del tabique y paralela), conservando el grosor. Huecos, obra y faldones se reanclan como en `cambiarContorno`.
- Validación: `nivel` repetido es **aviso** (incidencia), no error, para no invalidar archivos v2 que hoy lo son.
- Página: pastillas de planta encima de las de estancia, «+ Planta» (pregunta si copia la huella y las ventanas), renombrar, nivel y quitar. **Planta activa** en `main.ts`, usada en todas esas llamadas. Al cambiar de planta se sueltan selección, grupo, cinta, calco y recorrido. Si un agente quita la planta activa, se pasa a la primera. Las incidencias se rotulan con su planta y se filtran a la activa con un contador de las demás. El plano y el 3D muestran sólo la planta activa; la casa entera apilada queda para la ronda 3.
- Pruebas: núcleo (operaciones, copia con ids, quitar con distribuciones, tabique con huecos en las dos estancias, avisos de nivel) y e2e (planta alta copiando, cambiar de planta, mueble en ella, deshacer, mover un tabique compartido).

### b. Escaleras: recta, en L y de dos tramos (decisión del autor, 11/11/2026; revisión independiente aplicada)
- **Formato**, en la planta de abajo: `escaleras: [{id, forma, x, y, ancho, giro, hasta, peldanos?, ...}]`.
  - (x, y) es el **centro del borde del pie** (donde se empieza a subir).
  - `giro` es el sentido de subida del primer tramo: 0 sube hacia +y y el giro es horario, como los muebles. Admite cualquier valor, como los muebles.
  - `ancho` es la anchura de cada tramo: error por debajo de 60 cm, aviso por debajo de 80 (la persona del recorrido ocupa 40).
  - Anclar en el pie hace que editar `tramos`, `gira`, `ojo` o `forma` no despegue la escalera de donde arranca. `describir` da `pie`, `llegada`, `caja` y la huella, también en palabras del plano («pie arriba, llegada a la izquierda del plano»).
- **Formas**:
  - `forma: "recta"` (por defecto): `largo`.
  - `forma: "L"`: `tramos: [l1, l2]` y `gira`. Tramo 1 de `l1`, meseta cuadrada de `ancho` × `ancho` y tramo 2 de `l2`.
  - `forma: "U"` (dos tramos con media vuelta): `tramos: [l1, l2]`, `gira` y `ojo?` (0 por defecto). Tramo 1 de `l1`, meseta de (2 × `ancho` + `ojo`) × `ancho` y tramo 2 de `l2` de vuelta, al lado. Pie y llegada quedan en el mismo lado.
  - **`gira` es la mano de quien sube**: `derecha` gira en el sentido horario. Con `giro` 0 (subiendo hacia +y, que en el plano es hacia abajo), `derecha` lleva el tramo 2 hacia −x y `izquierda` hacia +x. Una prueba fija que una L con giro 0 y `gira: "derecha"` tiene el tramo 2 en x menores que el tramo 1. Ojo: la izquierda de quien sube no es la izquierda del plano.
- **Peldaños**:
  - `hasta` es la planta **inmediatamente superior** por `nivel`: error si hay otra en medio o si su `nivel` no es mayor.
  - `peldanos` son contrahuellas; por defecto `round(altura / 18)`. En L y U: `n1 = clamp(round(N · l1 / (l1 + l2)), 1, N − 1)` y `n2 = N − n1`, con la meseta a `n1 · altura / N`; error si N < 2.
  - Aviso **por tramo** si la huella (`li / ni`) baja de 22 cm, y si la contrahuella (`altura / N`) pasa de 20 cm.
- **Validación en las dos plantas** (errores):
  - abajo:
    - la huella cae dentro del suelo de una estancia sin cruzar tabiques;
    - no hay obra dentro;
    - no hay ningún mueble encima;
    - la zona libre de 60 cm del pie está dentro del suelo y sin muebles ni obra;
  - arriba:
    - el hueco (la huella entera, con la franja del `ojo` de la U, que no es pisable) cae entero en el suelo de **una** estancia (tocar su muro vale): earcut no recorta un hueco que cruza el contorno;
    - no hay muebles ni obra encima;
    - la zona libre de 60 cm de la llegada está dentro del suelo y despejada.
- **Límites escritos en la guía**:
  - escalera que desemboca directamente en una puerta: no se comprueba;
  - escaleras apiladas: una escalera no puede arrancar sobre el hueco de otra (decisión del autor, 11/11/2026: a la ronda 3);
  - el hueco es la huella entera, así que arriba se pierde algo de suelo que una obra real taparía;
  - caracol, ronda 3.
- **Altura del suelo por regiones**: rampa lineal en cada tramo según la coordenada de su eje y meseta plana. Es una sola función del núcleo, que usan el recorrido, las rampas de colisión del `.glb` (una por tramo y la meseta) y las pruebas.
- **Recorrido**:
  - La persona tiene estado: planta actual y escalera en curso.
    - En la planta de abajo, toda la huella es barrera salvo el pie.
    - En la de arriba, todo el hueco es barrera salvo la llegada.
    - Dentro de la huella sólo se choca con sus barandillas, incluida en la U una barrera entre tramos aunque el `ojo` sea 0.
  - La planta activa cambia al cruzar el borde de llegada o el de pie, **sin soltar el recorrido** (es la excepción a «al cambiar de planta se sueltan…» de a). Al salir de «Recorrer» queda activa la planta en la que se está.
  - Los ojos van 160 cm por encima del suelo de la escalera, y sobre ella el techo es el de la planta de arriba (con sus faldones) relativo a la escalera.
  - `puntoDeSalida` no cae en una huella ni en un hueco.
- **Dibujo**:
  - En las dos plantas: abajo, peldaños y flecha de subida; arriba, el hueco con flecha de bajada. Va en planta, texto, SVG y PNG.
  - La barandilla se dibuja (barras finas): no se choca contra nada invisible.
  - Las caras del canto del forjado alrededor del hueco se dibujan en la página y en el `.glb`, para que al subir no se vea el vacío.
  - Las dos plantas que une la escalera se dibujan (la de arriba a su `nivel`) cuando se está en la estancia que tiene la escalera o su hueco, o en su zona libre, con histéresis; no sólo al pisarla. La otra planta se construye antes de llegar, porque los modelos `.glb` cargan sin esperar.
- `resumen` y `describir` la dan como conexión entre plantas.
- **Lote y CLI**: `escalera-agregar|editar|quitar`, con esquema y paridad. En la página, «Escalera» en «Obra» con su ficha; si no hay planta de arriba, ofrece crearla copiando la huella.
- **Pruebas**, para las tres formas:
  - huella y caja de L y U a derecha e izquierda, con giros 0, 90 y 45;
  - reparto de peldaños, incluido el caso 300/10;
  - validación en las dos plantas: destino, nivel, peldaños, ancho, huella, hueco y zonas libres;
  - altura del suelo por regiones;
  - recorrido que sube y baja por una escalera recta pegada a la pared;
  - no entrar por la llegada desde abajo;
  - e2e por teclado;
  - `.glb` validado y hueco con el área correcta.

### c. MCP dentro del CLI
- `node espacios3d.mjs mcp [--carpeta <ruta>]`: por defecto, la carpeta donde está `espacios3d.mjs`, no la de lanzamiento.
- Rutas: relativas a esa carpeta, terminadas en `.espacio.json`, resueltas con `realpath` antes de comparar; se rechaza lo de fuera.
- Herramientas:
  - `nuevo {archivo, ancho, largo, alto?, nombre?}`;
  - `describir {archivo, planta?}`;
  - `aplicar {archivo, ops, simular?}`, con `mio` y con el tamaño de las imágenes de `fondo-poner` leído como en el CLI;
  - `analizar {archivo}`;
  - `plano_png {archivo, planta?, pxPorCm?, sobreFondo?, rejilla?, guardarEn?}`, como mucho 1 500 px en el lado largo y con tope de bytes. Siempre con un texto que da `pxPorCm` y el origen, para pasar de píxel a cm.
- `aplicar` usa la misma escritura atómica con detección de conflicto que el CLI. En modo `mcp` nada escribe en la salida estándar salvo los mensajes del protocolo.
- `entrega/.mcp.json`; en `AGENTS.md`, cómo registrarlo en otros agentes. El CLI sigue siendo la vía principal.
- Pruebas: `node:test` por stdio (initialize, tools/list, cada herramienta, −32601, rutas de fuera y enlaces, imagen con tope) y una comprobación con Claude Code real en la carpeta de entrega.

### d. Exportación para juegos
- Antes, en el modelo del núcleo:
  - suelo en los umbrales de puertas y pasos (hoy queda una rendija);
  - colisión en las ventanas (si no, se sale por ellas);
  - rampas de colisión en la escalera (una por tramo y la meseta, con la misma función de altura que el recorrido), no los peldaños.
- `exportar --glb casa.glb --colisiones godot|unreal|generico`:
  - `godot`: nodos con sufijo `-colonly` (muros, suelos, rampas) y `-convcolonly` (cajas de muebles y obra), que Godot 4 convierte en colisiones sin tocar nada;
  - `unreal`: `UBX_<malla>_00` y `UCX_<malla>_00`, avisando de que con glTF no está comprobado (la documentación es del flujo FBX);
  - `generico`: `COL_<nombre>` con `extras.colision: true`, y en la guía un script de importación para Unity.
- `exportar --escena escena.json`: lo mismo que `describir --json`, con las escaleras.
- Pruebas: gltf-validator; nombres y volúmenes de las colisiones frente a las medidas; umbral, ventana y rampa presentes.

### e. Aceptación final (honesta)
- **Antes de ejecutar, en un commit:**
  - el encargo literal que se dará, como lo escribiría una persona y sin pistas;
  - las imágenes;
  - la solución de referencia;
  - el guion que puntúa;
  - el número de intentos (uno por ejecución).
- **Qué se mide:**
  - en cada estancia, sus lados (≤ 2 % o 5 cm con cotas; ≤ 10 % sin cotas con una medida);
  - estancias que faltan o sobran;
  - conexiones iguales a las reales;
  - `analizar` con 0 errores.

  Puntúa el guion; nada a ojo.
- **Ejecuciones**, cada una sólo con la carpeta de entrega copiada fuera del proyecto y la imagen:
  1. plano sintético con cotas;
  2. plano sintético sin cotas con una medida conocida;
  3. un plano real de **dominio público** (decisión del autor: Wikimedia Commons, con licencia y origen anotados junto al encargo);
  4. además, un plano sintético «sucio» (JPEG, algo girado).
- **Agentes:** Claude y **Antigravity** (decisión del autor), cada uno en su propia sesión y con suscripción. Antigravity hace al menos dos ejecuciones: el plano real y uno sintético. Sus condiciones (revisión independiente):
  - Sin intervención, Antigravity no puede ejecutar órdenes de terminal (se lanza con `--sandbox --mode accept-edits`): sólo podría usar la herramienta por el **MCP del paso c, preaprobado** en su configuración global. El autor lo autoriza (11/11/2026): durante la prueba se preaprueba el MCP de Espacios 3D en `~/.gemini/antigravity-cli/settings.json`; el cambio se anota y se retira al terminar.
  - Modelo **Gemini** fijado con `--model` y anotado (con un modelo Claude no cuenta como otra casa); `useG1Credits=false` comprobado antes.
  - Un turno por proceso con un plazo fijado antes. Continuar la conversación es intervención; plazo agotado, permiso denegado o resultado distinto de `SUCCESS` son intento fallido.
  - Transcripción `stream-json` guardada entera.
  - Ensayo previo, que no cuenta, con una imagen ajena al encargo, para saber si ve un PNG de la carpeta.
  - Aislamiento: sin otros servidores MCP ni skills globales en la sesión (o declarado); una llamada a otro servidor MCP invalida el intento. Lo mismo para Claude (instrucciones globales, memoria, MCP).
  - Sustituto declarado de antemano si no se puede lanzar sin intervención: **Codex**.
- **Reglas:**
  - cualquier mensaje de ayuda durante la ejecución cuenta como fallo;
  - se cuentan todos los intentos;
  - si tras un fallo se cambia la guía o la herramienta, se repiten todas desde cero y se informa de las dos tandas;
  - se revisan las transcripciones por si el agente leyó fuera de su carpeta (el aislamiento no está forzado).
- **«La persona retoca»:** e2e que mueve en la página un tabique compartido del piso que hizo el agente (con `tabique-mover`) y guarda.

### Lo que también entra
- Esquema y paridad para `escaleras` y las operaciones nuevas.
- Guías de la entrega para plantas, escaleras, MCP y colisiones.
- El error de `mio` en un lote numera desde 0, como los demás errores de lote.

## Estado al cierre de la ronda 2 (11/11/2026)

| Hito | Revisión independiente |
| :--- | :--- |
| R2-1 Formato v2 y migración | Listo |
| R2-2 Varias estancias, muros derivados | Listo |
| R2-3 Carpeta, fondo, calco, PNG, describir, `.glb` del CLI | Listo, con mini aceptación superada |
| R2-4 Obra y techo inclinado | Listo |
| R2-5 Primera persona | Listo (Pointer Lock sin probar en Edge real) |
| R2-6 Piezas, modelos, Mis muebles, selección múltiple, cinta | Listo |
| R2-7a Plantas y tabiques | Revisado; arreglos sin verificar |
| R2-7b Escaleras | Pendiente |
| R2-7c MCP en el CLI | Pendiente (comprobado con Claude Code real) |
| R2-7d Exportación para juegos | Pendiente (no probado en ningún motor) |
| R2-7e Aceptación final | Pendiente |

El revisor se quedó sin cuota el 11/11 por la tarde. Sin compras (regla de cero pagos): las revisiones pendientes se piden cuando vuelva.

**Aceptación** (`tests/aceptacion/PROTOCOLO.md`, protocolo fijado antes de ejecutar):
- **Sintéticos, 3 de 3 pasan:**
  - A, con cotas: Claude Sonnet, 53 s;
  - B, sin cotas con una medida: Codex `gpt-6-luna`;
  - C, girado y en JPEG: Claude Sonnet, 46 s.
- **Plano real de dominio público:** falla con Codex. Unió el distribuidor sin rótulo al recibidor (caja de 712 × 454 frente a 473 × 336); lo demás pasa.
- **Antigravity:** no puede hacer el encargo sin interfaz. Sólo ejecuta órdenes preaprobadas al pie de la letra y la primera denegación termina la sesión. Se sustituyó por Codex según la regla del protocolo.
- **«La persona retoca»:** e2e que mueve un tabique compartido del piso que hizo Claude y lo guarda.

**Comprobaciones:**
- 352 pruebas unitarias en verde y 219 comprobaciones e2e en Edge.
- HTML de 1130 KB (objetivo: menos de 1,2 MB), CLI de 379 KB y ZIP de 458 KB.

**Sin verificar:**
- selectores nativos y guardado en disco real;
- Pointer Lock en Edge real;
- fallos pasajeros de lectura del disco real (M5);
- colisiones dentro de Unreal o Unity (Godot 4.7.2 comprobado el 12/11/2026 con `npm run motores`: cuerpos, rayos y un personaje que sube andando una escalera en L);
- la comodidad, que juzga el autor.

## Revisión independiente de R2-7 a (arreglos), c, d y e (12/11/2026)
- R2-7a aprobado; R2-7c aprobado con cambios; R2-7d no aprobado hasta arreglar el suelo de colisión; aceptación honesta en lo esencial, con dos correcciones de texto.
- Arreglado, con prueba que falla antes y pasa después:
  - **Bloqueante (d, 1):** el suelo de colisión de la planta de arriba tapaba el hueco de la escalera (en Godot o en el modo genérico no se podía subir). Ahora resta los huecos como el visible (`src/core/suelos.ts`, común al `.glb` y a las colisiones), con una prueba de área. También hay una prueba de las medidas de la caja de un mueble (2) y la barandilla del hueco va en un panel por lado (4).
  - **MCP (c, 5 y 6):** `plano_png.guardarEn` y los fondos de `fondo-poner` (con `anchoPx` y `altoPx` dados) podían salir de la carpeta por un enlace; ahora pasan por la misma comprobación que los `.espacio.json` y `leerFondos` resuelve los enlaces.
  - **MCP (c, 7 y 8):** `plano_png` funciona con espacios de más de 40 m. Las carpetas que faltan dan un mensaje sin la ruta absoluta. Se rechazan las rutas con «:» y las medidas negativas o desmesuradas en `nuevo`. `mcp --carpeta` sin valor o con una carpeta inexistente sale con un mensaje y código 3.
  - **a (9 y 10):** los mensajes de `tabique-mover` dicen «pared N (muro N−1)», como la página y como la operación; y con paredes que sólo se solapan en parte ya no mandan de una a otra.
  - **e (11 a 14):** correcciones en `tests/aceptacion/PROTOCOLO.md`: las condiciones reales de Claude, las órdenes de Codex fuera de su carpeta, B en su segundo intento y lo que la aceptación no acredita.
  - **3:** la guía para juegos avisa de que en Unreal las cajas de los muebles apuntan al nodo y no a sus piezas.
- Pendiente para la revisión de escaleras de la ronda 3: las rampas y barandillas de colisión son macizas desde el suelo, así que en un juego no se pasa bajo la escalera, aunque la página lo permite.
