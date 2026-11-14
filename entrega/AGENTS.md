# Espacios 3D — instrucciones para agentes de IA

Esta carpeta es una herramienta para modelar una estancia (una habitación, un salón…) a medida y colocar y reorganizar sus muebles. Funciona entera en este ordenador, sin conexión.

- La persona usa `Espacios3D.html` (doble clic, en Edge o Chrome).
- Tú (Claude Code, Codex, Cursor, Gemini u otro agente) usas el comando `espacios3d.mjs` sobre los archivos `*.espacio.json`.
- Los dos podéis trabajar a la vez sobre el mismo archivo, si la persona lo abrió en la página («Abrir», «Carpeta…» o «Continuar con …»): la página recoge tus cambios en un segundo y no pisa los tuyos, y el comando no pisa los de la página. La página que abres tú con `abrir` es una copia: no ve tus cambios posteriores hasta que vuelves a llamar a `abrir`, y guarda en el archivo cuando la persona pulsa «Abrir su carpeta».

## Archivos
| Archivo | Para qué |
| :--- | :--- |
| `Espacios3D.html` | La herramienta para personas. **No la edites.** |
| `espacios3d.mjs` | El comando para ti. Necesita Node.js 18 o posterior, sin instalar nada más. |
| `espacios/*.espacio.json` | Los espacios. `espacios/ejemplo-dormitorio.espacio.json` es un ejemplo. |
| `esquema/espacio.schema.json` | El formato (JSON Schema 2020-12). |
| `LEEME.md` | Guía para personas. |
| `guias/desde-un-plano.md` | Cómo construir un espacio a partir de un plano o de fotos: fondo, calibrado, habitaciones, comparación y muebles. Léela si te pasan un plano o fotos. |
| `guias/muebles-a-medida.md` | Muebles con forma propia (piezas), modelos 3D `.glb` y «Mis muebles». Léela si te piden un mueble concreto (un sofá en L, una lámpara) o te pasan fotos o un modelo. |
| `guias/para-juegos.md` | Exportar a un juego: `.glb` con colisiones para Godot, Unreal o Unity y `escena.json`. |
| `mis-muebles.json` | Opcional, junto a los espacios: los muebles guardados para reutilizarlos («Mis muebles»). |

## Cómo trabajar
0. **Si tienes las herramientas MCP de `espacios3d`** (el servidor de esta carpeta: `nuevo`, `describir`, `aplicar`, `analizar`, `plano_png`, `abrir`), **úsalas siempre y no uses la terminal**, ni siquiera para `ayuda`: hacen lo mismo, y una orden de terminal sin permiso puede terminar tu sesión sin aviso (pasa con Antigravity sin interfaz). Todo lo de abajo tiene su equivalente en `aplicar` (sección «Servidor MCP» y `guias/desde-un-plano.md`). Si no las tienes, usa el comando `node espacios3d.mjs …` (lo de abajo); con interfaz (el editor de Antigravity, Claude Code, Codex…), la persona aprueba esas órdenes.
1. `node espacios3d.mjs ayuda`: todos los comandos, convenciones y códigos de salida.
2. Antes de cambiar nada, mira el espacio:
   - `node espacios3d.mjs resumen espacios/X.espacio.json --json`: plantas y estancias (con sus ids, muros con coordenadas y longitud, y huecos), muebles con la estancia en la que están, e incidencias. Con varias estancias, indica `--estancia <id>` al colocar contra un muro o añadir un hueco.
   - `node espacios3d.mjs plano espacios/X.espacio.json`: un dibujo en texto. Cada mueble es una letra y la leyenda da su posición y hacia dónde mira; `#` es muro, `P` puerta, `V` ventana, `!` choque.
3. Cambia con comandos, no editando el JSON a mano: validan, escriben de forma segura y te dicen las incidencias que resultan.
   - Para colocar algo contra una pared usa `--muro` y `--desde`: el mueble queda con la trasera contra ese muro y el frente hacia dentro, sin calcular giros. Ejemplos (los números dependen de cada estancia):
     ```
     node espacios3d.mjs agregar espacios/X.espacio.json --tipo estanteria --ancho 80 --fondo 30 --muro 2 --desde 35 --json
     node espacios3d.mjs mover espacios/X.espacio.json --id cama --muro 1 --desde 20 --json
     ```
   - «Junto a una ventana» o «al lado de la puerta»: busca ese hueco en `resumen` (su `muro`, `desde` y `ancho`) y calcula tú el `--desde` del mueble para que quede delante o al lado, sin pisar el tramo de una puerta. Un mueble más alto que el `antepecho` de la ventana la tapa (aviso).
   - Sin `--x/--y` ni `--muro/--desde`, `agregar` lo pone en el centro de la estancia.
   - Para un piso o una casa, añade cada habitación con `estancia agregar` (rectángulo con `--x --y --ancho --largo`, o `--contorno`). Deja entre dos estancias la separación real del tabique (por ejemplo 10 cm): los muros se calculan solos, sin duplicar el tabique. Las puertas entre estancias se ponen en una de ellas (`hueco agregar --estancia salon ...`); `resumen` dice en `conexiones` qué comunica cada puerta.
   - Para que la persona imprima el plano o lo guarde en PDF: `plano espacios/X.espacio.json --imprimible plano.html` (una hoja A4 por planta, a escala) y que lo abra en el navegador. Si la persona te da fotos (de la habitación o de un mueble), cópialas a `fotos/` junto al `.espacio.json` y asócialas: `foto agregar --para cama --foto fotos/cama.jpg` (estancia o mueble); así las tiene a mano en la ficha. Cosas de pared (`cuadro`, `espejo`, `television`, `balda`, `aplique`): `agregar --tipo cuadro [--estancia salon]` sin posición lo cuelga en la pared libre más cercana a su altura habitual (`catalogo` la da); con `--muro --desde` va donde digas y `--elevacion` cambia la altura. Se pueden poner encima de un sofá o una cómoda: el análisis mira las alturas. Si uno colgado no toca la pared, hay un aviso. Acabados de una estancia: `estancia --estancia salon --suelo parquet|baldosa|moqueta|liso [--color-suelo b98a5a] [--paredes f2e6d0]` («ninguno» los quita); el `.glb` los lleva como color. Una casa de varias plantas: `planta agregar --copiar-de <planta> [--con-ventanas true]` crea la de arriba con la misma huella (todas comparten el origen x, y; `nivel` es la cota del suelo en cm). Indica `--planta <id>` al añadir muebles o estancias en ella. Una escalera sube desde su planta a la de encima: `escalera agregar --x --y --ancho 90 --largo 360` (x, y: centro del borde del pie; `giro` 0 sube hacia +y), o en L o de dos tramos con `--forma L|U --tramos 300,120 --gira derecha|izquierda` (la mano de quien sube), o de caracol con `--forma caracol --ancho 70 --gira derecha [--poste 20] [--vuelta 360]` (ancho del peldaño; el centro queda a la mano de giro). Abre el hueco en el suelo de arriba (sólo donde quien sube no tendría 200 cm libres) y `analizar` comprueba que quepa y que no tape nada. Bajo la parte alta de una escalera caben muebles que no lleguen a su cara inferior. Una escalera puede arrancar sobre el hueco de la que llega a su planta (caja de escalera) si su pie da a suelo firme y quedan 200 cm libres entre las dos. Para agrandar una estancia a costa de la de al lado, `tabique mover --estancia salon --muro 1 --distancia 20` mueve la pared de las dos y conserva el tabique.
   - Lo que no se mueve (columnas, pilares, radiadores, enchufes, vigas, escalones) va con `elemento agregar --forma exento|adosado|punto|viga --tipo ...`, y una buhardilla con `faldon poner --muro N --altura-en-muro 120 --alcance 200`. Los muebles no pueden chocar con ellos ni pasar del techo inclinado.
   - Un mueble con forma propia lleva `piezas` (cajas, cilindros, esferas y cuñas dentro de su caja) y, si la persona tiene uno, un `modelo` `.glb`; los guardados en «Mis muebles» se usan con `agregar --mio "Nombre"`. Todo eso está en `guias/muebles-a-medida.md`.
   - Para varios cambios a la vez, usa un lote que se aplica entero o nada: `aplicar --ops ops.json`. Pruébalo antes con `--simular`.
4. Comprueba al terminar: `node espacios3d.mjs analizar espacios/X.espacio.json --json` debe salir con código 0. Si construiste a partir de un plano, sigue además la lista final de `guias/desde-un-plano.md` (estancias, conexiones y calco). Si la persona pidió «sin colisiones», usa `--exigir-sin-errores` en los cambios (con MCP, `exigirSinErrores: true` en `aplicar`). Esa opción sólo frena los errores: revisa también los avisos y cuéntaselos a la persona.
5. **Enséñaselo**: `node espacios3d.mjs abrir espacios/X.espacio.json --json` abre la página en su navegador con el espacio ya cargado (con sus planos, fotos y modelos). Es una copia: si cambias algo más, vuelve a llamar a `abrir`. Para seguir retocándolo y guardar, la persona pulsa «Abrir su carpeta» y elige la carpeta del archivo; si había cambios a la vez en el archivo y en la página, la página le pregunta. `abrir` sin archivo abre la página en blanco. No puedes comprobar que la ventana se abrió: di a la persona la ruta de `pagina` por si no aparece.
6. Lo que pide la persona manda. «Sin que choque» se refiere a las incidencias de **error**. Un **aviso** (por ejemplo, poco espacio delante de otro mueble) no impide cumplir la petición: cúmplela tal cual, di qué avisos quedan y propón cómo evitarlos (mover otro mueble, otra posición). Cambia lo pedido, por ejemplo poniéndolo en otro sitio, sólo si hacerlo tal cual da un error.

## Convenciones (importan)
- Medidas en **cm** y giros en **grados**.
- Planta con **x hacia la derecha e y hacia abajo**.
- El contorno es la cara interior de las paredes.
- Muro `i` va del vértice `i` al `i+1`. La página lo llama «Pared i+1».
- `desde`: cm desde el vértice inicial del muro.
- Mueble:
  - `(x, y)` es el centro de su huella.
  - `ancho` va a lo largo del frente y `fondo` hacia atrás.
  - Con `giro` 0 el frente mira a +y (hacia abajo en el plano).
  - El giro es horario visto desde arriba: 90 mira a −x, 180 a −y y 270 a +x.
- `elevacion`: altura de la base sobre el suelo (para lo colgado). `huecoInferior`: altura libre por debajo (una silla cabe bajo un escritorio).

## Incidencias
| Gravedad | Cuándo |
| :--- | :--- |
| `error` | Se sale de la estancia, supera el techo, se solapa con otro mueble, está en el barrido de una puerta o en los 60 cm de paso delante de una puerta o un paso (a los dos lados, si la puerta comunica dos estancias), choca con obra (columna, pilar, viga…) o no cabe bajo el techo inclinado. |
| `aviso` | Tapa una ventana, invade el espacio libre que otro mueble necesita delante (`holguraFrente`), o es una silla bajo una mesa con el respaldo más alto que el hueco. También una puerta, ventana o paso que no atraviesa un muro limpio (da en parte a un tabique o a una esquina), un radiador o un enchufe tapados y un mueble a medias sobre un escalón. Y el acceso: un mueble que no entra por las puertas (o la escalera) hasta su estancia, uno al que no se llega con un paso libre de 60 cm desde alguna puerta, paso o llegada de escalera de su planta (sólo en plantas sin errores) y, en las estancias con `circuloDeGiro: true` (`estancia --circulo-de-giro true`), que no quepa un círculo de giro de 150 cm para silla de ruedas. |

Las alfombras (3 cm o menos) no chocan con nada.

## Servidor MCP (opcional)
Si tu agente usa MCP, `node espacios3d.mjs mcp` da seis herramientas sobre los `.espacio.json` de esta carpeta: `nuevo`, `describir`, `aplicar` (las mismas operaciones que `aplicar --ops`, todas o ninguna: también `estancia-agregar`, `hueco-agregar`, `planta-agregar`, `escalera-agregar`, `fondo-poner` y `fondo-calibrar` para una casa entera; con `simular: true` no escribe y con `exigirSinErrores: true` no escribe si el resultado tiene errores), `analizar`, `plano_png` (la planta como imagen, con su escala en px por cm y su origen; con `sobreFondo`, encima del plano PNG o JPEG) y `abrir` (la página en el navegador de la persona, con el espacio cargado o en blanco).
- Claude Code lo ofrece al abrir la carpeta, por `.mcp.json`.
- En otro agente, regístralo como servidor por stdio con la orden `node` y los argumentos `["<ruta de esta carpeta>/espacios3d.mjs", "mcp"]`.
- Sólo trabaja con archivos de esta carpeta (rutas relativas, sin `..`). Si puedes ejecutar órdenes, el CLI hace lo mismo y más.

## Códigos de salida
| Código | Significado |
| :--- | :--- |
| 0 | Bien. |
| 1 | El resultado tiene incidencias de error. El cambio se ha escrito, salvo con `--exigir-sin-errores`. |
| 2 | El archivo no es válido (el JSON trae la lista de errores). |
| 3 | Error de uso o de archivo, o el archivo cambió mientras se editaba (la página lo guardó a la vez): vuelve a ejecutar el comando. |

## Windows y texto
- Usa siempre `--json`: la salida va en ASCII y no se estropea en ninguna consola.
- Pon los textos con espacios o tildes **entre comillas dobles**; en `cmd` las simples no agrupan.
- El color, sin `#` (`--color b89a74`) o entre comillas (`--color "#b89a74"`): en bash y PowerShell, `#` empieza un comentario.
- Guarda los `ops.json` en UTF-8. Si dudas, escribe las tildes con escapes (`"Sal\u00f3n"`).

## Si no hay Node.js
Edita el `*.espacio.json` siguiendo `esquema/espacio.schema.json` y conserva `"formato": "espacios3d"` y `"version": 2`: plantas (`plantas[]`), cada una con sus estancias (`estancias[]`, con `id` y `contorno`) y sus muebles (`muebles[]`); los ids son únicos en todo el archivo. Los archivos de la versión 1 (con `estancia` y `muebles` en la raíz) se siguen leyendo y se convierten al guardar, dejando una copia `*.v1.espacio.json`. Si el archivo tiene errores, la página no lo carga ni escribe encima, y muestra cuáles son al abrirlo.
