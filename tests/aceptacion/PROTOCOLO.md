# Aceptación final de la ronda 2 (R2-7e)

Fijado antes de ejecutar nada (este archivo, las imágenes, las referencias y los guiones van en el mismo commit). Lo que mide: que un agente nuevo, sólo con la carpeta de entrega y un plano, construya el piso con la herramienta y sin ayuda.

## Material
| Prueba | Imagen | Referencia | Modo de puntuar | Agente |
| :--- | :--- | :--- | :--- | :--- |
| A | `plano-a.png` (sintético, con las medidas interiores de cada estancia) | `ref-a.espacio.json` | `cotas` | Claude (Sonnet) |
| B | `plano-b.png` (sintético, sin medidas) | `ref-b.espacio.json` | `medida` | Antigravity (Gemini 4 Argon, medio) |
| C | `plano-c.jpg` (sintético con medidas, girado 2,5° y en JPEG: «sucio») | `ref-c.espacio.json` | `cotas` | Claude (Sonnet) |
| R | `plano-real.jpg` (plano real, ver abajo) | `ref-real.espacio.json` | `real` | Antigravity (Gemini 4 Argon, medio) |

- Los planos sintéticos y sus referencias salen de `generar.mjs` y `sucio.py`.
- **Plano real:** «Sample Floorplan.jpg», de Boereck (2006), en Wikimedia Commons, cedido al dominio público por su autor (plantilla PD-self): https://commons.wikimedia.org/wiki/File:Sample_Floorplan.jpg. No tiene cotas generales. La referencia (`ref-real.mjs`) es **aproximada**: la medí sobre la imagen, con una cuadrícula de píxeles, y la escala sale de la medida que se da en el encargo (15 m de fachada a fachada por fuera, 749 px). Por eso la tolerancia es mayor y sólo se puntúan las cuatro estancias grandes.

## Encargos (literales)
Se dan en la carpeta de entrega copiada fuera del proyecto, con la imagen al lado.
- **A:** «Te paso el plano de mi piso: plano.png, en esta carpeta. Hazlo con la herramienta de esta carpeta en espacios/piso.espacio.json, con todas las habitaciones, puertas y ventanas como en el plano.»
- **B:** «Te paso el plano de mi piso: plano.png, en esta carpeta. No tiene medidas, pero el salón mide 520 cm de ancho de pared a pared. Hazlo con la herramienta de esta carpeta en espacios/piso.espacio.json, con todas las habitaciones, puertas y ventanas como en el plano.»
- **C:** igual que A, con `plano.jpg`.
- **R:** «Te paso el plano de una casa: plano.jpg, en esta carpeta. No tiene medidas generales, pero la casa mide 15 m de ancho por fuera, de la fachada oeste a la este. Hazla con la herramienta de esta carpeta en espacios/casa.espacio.json, con todas las estancias, puertas y ventanas de la planta.»

## Qué se puntúa (`puntuar.mjs`, sin nada a ojo)
1. El archivo es válido y `analizar` no da errores.
2. Se alinea por la esquina de la caja de todas las estancias.
3. Cada estancia de la referencia se empareja con la del resultado que más la cubre (al menos el 50 % de su área).
4. **Medidas** (ancho y largo de la caja de cada estancia emparejada):

   | Modo | Tolerancia | Estancias |
   | :--- | :--- | :--- |
   | `cotas` | ≤ máx(2 %, 5 cm) | todas |
   | `medida` | ≤ 10 % | todas |
   | `real` | ≤ 15 % | sólo salón, recibidor, familia y cocina |

5. **Estancias:**
   - sintéticos: ni faltan ni sobran;
   - real: están las siete rotuladas (el distribuidor sin rótulo es opcional y pueden sobrar otras).
6. **Conexiones** (puertas y pasos, y la salida al exterior):
   - sintéticos: las mismas que la referencia;
   - real: salón ↔ recibidor, salón ↔ familia, recibidor ↔ exterior y cocina ↔ distribuidor o recibidor.

Una prueba pasa si pasan todas sus comprobaciones.

## Reglas
- **Un intento por prueba.** Se cuentan todos los intentos y no se elige ninguno.
- **Plazo:** 30 minutos por prueba. Plazo agotado, permiso denegado o resultado distinto de un éxito cuentan como fallo.
- **Ayuda:** cualquier mensaje de ayuda durante la ejecución es un fallo. El agente no recibe nada más que el encargo.
- **Guía congelada:** si tras un fallo se cambia la guía o la herramienta, se repiten todas desde cero y se informa de las dos tandas.
- **Transcripciones:** se guardan enteras (`resultados/<prueba>/transcripcion.jsonl`). La carpeta `resultados/` no se versiona (desde el 12/11/2026): las transcripciones llevan rutas del ordenador donde se ejecutaron; lo que se publica es este protocolo con sus tablas de resultados. Se revisan por si el agente leyó fuera de su carpeta o usó otros servidores MCP; eso invalida el intento.
- **Claude:**
  - `claude -p` en la carpeta copiada, `--model sonnet`, `--strict-mcp-config` (sin servidores MCP), `--permission-mode acceptEdits` y sólo `node` en la terminal, sin `ANTHROPIC_API_KEY` en el entorno.
  - Carga las instrucciones globales del usuario (`~/.claude/CLAUDE.md`), que no hablan de esta herramienta. Se declara en vez de quitarlas.
  - **Corrección (12/11/2026, revisión independiente):** «sólo `node` en la terminal» no fue así. `--allowedTools` (en `ejecutar.py`) preaprueba `node`, pero no restringe otras órdenes ni las rutas de `Read` y `Write`: las transcripciones muestran órdenes de PowerShell (`New-Item`, `Copy-Item`, bucles) y de Bash (`cd`, `head`), y la sesión cargó las skills, los plugins y los agentes del usuario. Revisadas de nuevo, todas las llamadas de A y C quedaron dentro de su carpeta, sin skills ni MCP, así que no invalida esos intentos. Si se repite la aceptación, hay que restringir herramientas y fuentes de ajustes de verdad.
- **Antigravity:**
  - `agy -p` en la carpeta copiada, `--model gemini-4-argon-medium`, `--sandbox` y `--mode accept-edits`. En sandbox no puede ejecutar órdenes, así que usa la herramienta por su MCP (`espacios3d.mjs mcp`).
  - El MCP se registra con `agy mcp add` antes y se quita con `agy mcp remove` al terminar (autorizado por el autor). Sus permisos van en `--settings` sólo para esa sesión.
  - Antes, comprobar `useG1Credits = false`.
  - Antes, un **ensayo que no cuenta**: leer el número de una imagen ajena al encargo, para saber si ve un PNG de la carpeta. Si no puede, la prueba se hace con **Codex** (sustituto fijado de antemano).

## Tanda 1 (11/11/2026)
| Prueba | Agente | Resultado |
| :--- | :--- | :--- |
| A | Claude Sonnet | **Pasa** en 53 s: 6 estancias, 12 medidas dentro de tolerancia, conexiones iguales, 0 errores |
| C | Claude Sonnet | **Pasa** en 46 s, con el plano girado en JPEG: 3 estancias, 6 medidas, conexiones iguales, 0 errores |
| B | Antigravity (Gemini 4 Argon) | **Falla**: leyó la guía y el plano, quiso ejecutar `node espacios3d.mjs ayuda`, el permiso se denegó y la sesión terminó sin archivo |
| R | Antigravity (Gemini 4 Argon) | **Falla** por lo mismo |

- Las transcripciones de Claude no muestran lecturas fuera de su carpeta ni uso de otros servidores MCP.
- **Por qué falla Antigravity.**
  - Sin interfaz, sólo admite órdenes de terminal preaprobadas al pie de la letra (`command(node --version)`), y fuera de `--sandbox`. Lo comprobé en ensayos que no cuentan.
  - El agente lanza órdenes `node espacios3d.mjs …` distintas cada vez, y la primera denegación termina el turno.
  - El ensayo previo comprobó que ve las imágenes y que usa el MCP, pero no que el agente, por su cuenta, iría al MCP en vez de a la terminal.
- **Decisión**, conforme a la regla del protocolo: B y R se repiten con el sustituto fijado, **Codex**.
  - Configuración: `codex exec` en la carpeta copiada, `--sandbox workspace-write` y la cuenta de ChatGPT.
  - Modelo `gpt-6-luna`, el más reciente que ofrece la cuenta; `gpt-6-astra` y `gpt-6.1-sol` dan «no soportado».
  - Ensayo previo con Codex: lee el número de una imagen y ejecuta el comando.
  - No cambian ni la guía ni la herramienta, así que A y C siguen valiendo.
  - Los resultados de Antigravity se conservan y se informan.

## Tanda 2: B y R con Codex (11/11/2026)
| Prueba | Agente | Resultado |
| :--- | :--- | :--- |
| B | Codex (`gpt-6-luna`) | **Pasa**: 5 estancias, 10 medidas dentro del 10 %, conexiones iguales, 0 errores |
| R | Codex (`gpt-6-luna`) | **Falla** en «medidas»: unió el distribuidor sin rótulo al recibidor, cuya caja sale de 712 × 454 cm (referencia 473 × 336). Lo demás pasa: las siete estancias rotuladas, las otras tres grandes dentro del 15 %, las conexiones exigidas y 0 errores |

- El ejecutor falló al copiar los dos resultados: el sandbox de Codex en Windows deja los archivos que crea sin permiso de lectura para el usuario. Los agentes ya habían terminado. Se leyeron desde ese mismo sandbox (`codex sandbox`) y se puntuaron sin repetir nada (`ejecutar.py recuperar`).
- Las 58 órdenes de Codex no usan otros servidores MCP. **Corrección (12/11/2026, revisión independiente):** no todas se quedan en su carpeta. En R, Codex copió 11 recortes de la imagen a la raíz de `%TEMP%`, los miró desde allí y los borró, para rodear los permisos de su sandbox. Son recortes suyos y R ya cuenta como fallo. Los registros de `B-codex` y `R-codex` no tienen inicio, duración ni código porque se recuperaron después.
- **Sobre R:** que el distribuidor sea parte del recibidor es una lectura defendible del plano, porque se comunican sin puerta. Aun así, el criterio estaba fijado antes y no se cambia: cuenta como fallo.

## Resumen
- Planos sintéticos (A con cotas, B sin cotas con una medida, C «sucio»): **3 de 3 pasan**, con dos agentes distintos (Claude Sonnet y Codex). B pasa en su segundo intento, con el agente sustituto (Codex), después de que Antigravity no pudiera hacerlo (ver la tanda 1).
- **Lo que no acredita** (revisión independiente, 12/11/2026):
  - `puntuar.mjs` no mira las ventanas ni la posición o el ancho de los huecos, sólo las conexiones; y mide la caja de cada estancia, no sus lados (estaba fijado antes; no es un cambio de criterio). Los resultados coinciden además en número de ventanas (5/5, 3/3, 5/5).
  - Los planos sintéticos son fáciles: están dibujados con el motor de la propia herramienta, limpios y con medidas redondas, y en A los 11 huecos coinciden al centímetro. No hay indicios de filtración (ninguna lectura fuera de la carpeta). El dato con más valor es el plano real, que falla.
- Plano real: **falla** por una estancia que el agente interpretó de otra forma.
- Antigravity: **no puede hacer el encargo sin interfaz**. No ejecuta órdenes no preaprobadas al pie de la letra, y la primera denegación termina la sesión. Ensayado: sí ve imágenes y usa el MCP si se le pide.

## Tanda 3 (ronda 5, 12/11/2026): fijada antes de ejecutar
Cambió la guía (`entrega/AGENTS.md`, `guias/desde-un-plano.md`: estancias sin rótulo, armarios, varias plantas, lista final, `abrir`, MCP cuando no hay terminal) y la herramienta (`abrir`, planos JPEG en `--sobre-fondo`). Por la regla de la guía congelada se repiten **todas** desde cero, y se añade una casa nueva.

| Prueba | Imágenes | Referencia | Modo | Agente |
| :--- | :--- | :--- | :--- | :--- |
| A | `plano-a.png` | `ref-a.espacio.json` | `cotas` | Claude (Sonnet) |
| B | `plano-b.png` | `ref-b.espacio.json` | `medida` | Antigravity (Gemini 4 Argon, medio), por MCP |
| C | `plano-c.jpg` | `ref-c.espacio.json` | `cotas` | Claude (Sonnet) |
| R | `plano-real.jpg` | `ref-real.espacio.json` | `real` | Antigravity, por MCP |
| R-claude | `plano-real.jpg` | `ref-real.espacio.json` | `real` | Claude (Sonnet) |
| N | `plano-n-pb.png` → `planta-baja.png`, `plano-n-p1.png` → `planta-alta.png` | `ref-n.espacio.json` | `cotas` | Antigravity, por MCP |
| N-claude | igual | igual | `cotas` | Claude (Sonnet) |

- **Casa N (nueva, no vista por ningún agente ni usada para escribir la guía):** dos plantas de 4 estancias, con medidas interiores escritas, un distribuidor **sin rótulo ni medidas** en cada planta, un armario empotrado rotulado «ARMARIO» en el dormitorio (no es una estancia) y una escalera recta que sube del distribuidor de abajo al de arriba (arriba se ve su hueco). Sale de `generar.mjs n`; A, B y C no cambian (regenerarlas da los mismos bytes).
- **Encargos:** A, B, C y R, literales de la tanda 1. N: «Te paso los planos de mi casa, que tiene dos plantas: planta-baja.png y planta-alta.png, en esta carpeta. Hazla con la herramienta de esta carpeta en espacios/casa.espacio.json, con las dos plantas, todas las estancias, puertas, ventanas y la escalera, como en los planos. Cuando termines, ábremela para verla.»
- **Puntuación:** `puntuar.mjs` con el mismo criterio. Para varias plantas: mismo número de plantas, las comprobaciones de la tanda 1 planta por planta (emparejadas por nivel, con una sola alineación, la de la planta de abajo) y, por cada escalera de la referencia, una del resultado en la misma planta que llega a la de encima y cubre al menos el 50 % de su huella. Comprobado antes de ejecutar: cada referencia pasa contra sí misma; los resultados ya puntuados (A, B-codex, C, R-codex) dan el mismo informe que entonces; y N suspende si se une el distribuidor al salón, si el armario es una estancia, si la escalera está en otro sitio o si falta una planta.
- **Se anota además** si el agente llamó a `abrir` (`registro.json`, `abrir`); con `ESPACIOS3D_NO_LANZAR=1` no abre ventanas. No cuenta para pasar, salvo en N, donde el encargo lo pide (se informa aparte).
- **Claude, restringido de verdad** (pendiente de la tanda 1): `--tools Bash,Read,Write,Edit,Glob,Grep`, `--setting-sources project,local` (sin ajustes, plugins ni agentes del usuario), `--disable-slash-commands` (sin skills), `--strict-mcp-config` (sin MCP), `--permission-mode acceptEdits` y sólo `node` preaprobado en la terminal: en modo `-p` lo demás se deniega. `Read` y `Write` siguen sin límite de ruta: se revisan las transcripciones como antes. `--bare` no se usa porque exige una clave de API (de pago).
- **Antigravity:** como en la tanda 1 (`--sandbox`, `--mode accept-edits`, MCP registrado con `agy mcp add` y quitado al terminar, permisos sólo de sus herramientas, ahora seis). `useG1Credits` no está en sus ajustes: vale `false`, su valor por defecto. Sin sustituto: si Antigravity no puede, cuenta como fallo suyo, y R y N los hace también Claude.
- **Reglas:** las de siempre (un intento, 30 minutos, sin ayuda, transcripción entera). Resultados en `resultados/t3/<prueba>/`. Uso: `python -I tests/aceptacion/ejecutar.py t3 <prueba>`.
- **Añadido antes de la tanda 4 (revisión independiente, 14):** con varias plantas, cada planta de arriba debe estar en su sitio: la esquina de la caja de sus estancias, con la alineación de la planta de abajo, dentro de la tolerancia de medidas del modo. Es más estricto, no más laxo, y no afecta a las pruebas de una planta.
- **Lo que no prueba:** Antigravity **con interfaz** (el editor, con la persona aprobando órdenes), que es lo que pidió el autor. No lo puedo lanzar yo: queda el guion `GUION_PRUEBA_MANUAL.md` y la pregunta sigue sin verificar hasta su prueba.

### Resultados de la tanda 3 (12/11/2026)
| Prueba | Agente | Resultado | `abrir` | Tiempo |
| :--- | :--- | :--- | :--- | :--- |
| A | Claude (Sonnet) | **Pasa** | no (no se pedía; la primera detección dio «sí» por la orden escrita en su mensaje final, corregida) | 64 s |
| B | Antigravity | **Falla**: no crea el archivo | no | 29 s |
| C | Claude (Sonnet) | **Pasa** | no (no se pedía) | 67 s |
| R | Antigravity | **Falla**: no crea el archivo | no | 32 s |
| R-claude | Claude (Sonnet) | **Pasa** (el plano real; con Codex fallaba) | sí (no se pedía) | 104 s |
| N | Antigravity | **Falla**: no crea el archivo | no | 21 s |
| N-claude | Claude (Sonnet) | **Pasa**: dos plantas, distribuidores sin rótulo como estancias, armario fuera de las estancias, escalera | sí (se pedía) | 72 s |

- **Antigravity** falla las tres igual que en la tanda 1. Lee la guía y los planos, prueba `node espacios3d.mjs ayuda` en la terminal, el modo sin interfaz deniega la orden y la sesión termina (`denied_actions: command`). La guía decía «si no puedes ejecutar órdenes, usa el MCP», pero el agente no sabe que no puede hasta la denegación, y la denegación termina la sesión. Arreglo: el paso 0 de `entrega/AGENTS.md` y `GEMINI.md` dicen ahora «si tienes las herramientas MCP de `espacios3d`, úsalas siempre y no uses la terminal». Como cambia la guía, va la **tanda 4** con todas desde cero.
- **Transcripciones de Claude:**
  - ninguna usa MCP ni skills;
  - A, C y N no tocan nada fuera de su carpeta. R-claude escribió y leyó archivos auxiliares propios en `%TEMP%\gen` (un generador de operaciones) y C, un `/tmp/ops.json`. Ninguno leyó nada ajeno. Lo declaro como desviación; no lo cuento como lectura de información de fuera;
  - **la restricción no fue completa:**
    - `acceptEdits` aprobó solo órdenes de archivos (`mkdir`, `cp`, `cat > …`, `rm` de su `ops`), así que «sólo `node`» tampoco se cumplió;
    - `--setting-sources project,local` no evitó que se cargaran 4 plugins del usuario (sin skills ni MCP).

## Tanda 4 (12/11/2026): fijada antes de ejecutar
- **Qué cambió desde la tanda 3:**
  - el paso 0 de `entrega/AGENTS.md` y `GEMINI.md`: si el agente tiene las herramientas MCP de `espacios3d`, las usa siempre y no usa la terminal;
  - los arreglos de la revisión de código independiente;
  - la comprobación de posición de las plantas de arriba en `puntuar.mjs`;
  - la detección de `abrir` sólo por llamadas reales.
- **Qué se repite:** las mismas siete pruebas, encargos, agentes y condiciones que la tanda 3, desde cero (`python -I tests/aceptacion/ejecutar.py t4 <prueba>`, resultados en `resultados/t4/`).
- **Se informa de las dos tandas.**

### Resultados de la tanda 4 (12/11/2026)
| Prueba | Agente | Resultado | `abrir` | Tiempo |
| :--- | :--- | :--- | :--- | :--- |
| A | Claude (Sonnet) | **Pasa** | sí | 59 s |
| B | Antigravity, por MCP | **Pasa** (la primera vez que Antigravity completa un encargo) | sí | 625 s |
| C | Claude (Sonnet) | **Pasa** | no (no se pedía) | 45 s |
| R | Antigravity | **Sin resultado**: el entorno detuvo la cadena por falta de memoria del sistema a mitad de la prueba (149 eventos en la transcripción, sin archivo). No es un fallo del agente ni cuenta como intento suyo | — | — |
| R-claude | Claude (Sonnet) | **Pasa** | sí | 135 s |
| N | Antigravity | **No ejecutada** (iba después de R) | — | — |
| N-claude | Claude (Sonnet) | **Pasa** (dos plantas, con la posición de la planta alta) | sí | 66 s |

- **Antigravity en B:** 16 llamadas al MCP `espacios3d` (`nuevo` 2, `aplicar` 6, `plano_png` 5, `describir`, `analizar` y `abrir`), ninguna orden de terminal ni denegaciones, ningún uso de otros servidores MCP. Lo que leyó fuera de su carpeta son archivos de su propia sesión (las imágenes que guarda de `plano_png` en `~/.gemini/antigravity-cli/brain/…` y el esquema de la herramienta `abrir`), no información ajena.
- Tras el corte, el MCP `espacios3d` quedó registrado en Antigravity, porque el paso de limpieza no llegó a ejecutarse. Se quitó a mano con `agy mcp remove espacios3d`.
- **Claude:** lo mismo que en la tanda 3. Sin MCP ni skills, con 4 plugins cargados y órdenes de archivos aprobadas por `acceptEdits`; nada ajeno leído. R-claude escribió su generador en la carpeta temporal de la prueba, por encima de `Espacios3D`.
- **Pendiente:** R y N con Antigravity, cuando haya memoria libre y el autor lo pida (no se relanzan solas).
- **Relanzadas (12/11/2026, pedido del autor):** R y N con Antigravity, con 9,9 GB de memoria libre. La transcripción del intento cortado de R queda en `resultados/t4/R-interrumpida/` (sin resultado; no cuenta como intento del agente).

### Resultados de R y N con Antigravity, relanzadas (tanda 4, 12/11/2026)
| Prueba | Resultado | `abrir` | Tiempo |
| :--- | :--- | :--- | :--- |
| R (plano real) | **Pasa**: todas las comprobaciones | sí | 1061 s |
| N (casa de dos plantas) | **Falla** por una medida: el distribuidor de cada planta, la estancia sin rótulo ni medidas, sale de 240 cm de ancho frente a 250 (tolerancia con cotas: 5 cm). Lo demás pasa: plantas, estancias (distribuidores incluidos y armario fuera), las otras medidas, conexiones, posición de la planta alta y escalera | sí | 857 s |

- Las dos sólo usan el MCP `espacios3d`: R hace 22 llamadas y N 12, `abrir` incluido. Ninguna orden de terminal, ninguna denegación, nada de otros servidores MCP y nada leído fuera de su carpeta o de su propia sesión.
- **Resumen de la tanda 4:** Claude pasa 4 de 4 (A, C, R y N). Antigravity, sin interfaz y por MCP, pasa 2 de 3 (B y R) y falla N por 10 cm en la estancia que tiene que deducir.
- El criterio no se cambia después de ver el resultado: N cuenta como fallo.

## Tanda 5 (12/11/2026): fijada antes de ejecutar
- **Qué cambió desde la tanda 4:** sólo `entrega/guias/desde-un-plano.md`, por el fallo de Antigravity en N, que no puso el plano de fondo en ninguna planta (su resultado no tiene `fondos`) y estimó las coordenadas a ojo:
  - el paso 2 (plano de fondo y calibrado) es obligatorio en cada planta, también por MCP;
  - las coordenadas salen del plano calibrado y no se encadenan sumando anchos; una estancia sin medidas se mide en el plano;
  - en la lista final, comprobar que cada planta tiene su fondo y que el ancho y el largo totales coinciden con el plano.
- **Qué se repite:** las mismas siete pruebas, encargos, agentes, condiciones y criterio de puntuación que en la tanda 4, desde cero (`python -I tests/aceptacion/ejecutar.py t5 <prueba>`, resultados en `resultados/t5/`). Un intento por prueba.
- **Lo que hay que tener en cuenta:** la casa N ya no es «no vista» para quien escribe la guía, porque el cambio sale de su fallo. Las reglas añadidas son generales (calibrar, no encadenar y comprobar el total) y no mencionan N ni sus medidas. Un acierto de Antigravity en N con esta guía no demuestra que fuera a acertar en una casa nueva.
- **Se informa de todas las tandas.**

### Resultados de la tanda 5 (12/11/2026)
| Prueba | Agente | Resultado | `abrir` | Tiempo |
| :--- | :--- | :--- | :--- | :--- |
| A | Claude (Sonnet) | **Pasa** | sí | 57 s |
| B | Antigravity, por MCP | **Pasa** | sí | 739 s |
| C | Claude (Sonnet) | **Pasa** | no (no se pedía) | 65 s |
| R | Antigravity, por MCP | **Pasa** | sí | 1193 s |
| R-claude | Claude (Sonnet) | **Falla** en medidas: une el pasillo sin rótulo y la entrada en una sola estancia, y el recibidor de la referencia sale de 706 × 460 frente a 473 × 336 | sí | 160 s |
| N | Antigravity, por MCP | **Pasa** todo, también las dos medidas que fallaba en la tanda 4: plano de fondo calibrado en las dos plantas y el distribuidor de 510 a 760 en las dos | sí | 1107 s |
| N-claude | Claude (Sonnet) | **Pasa** | sí | 83 s |

- **Resumen:** Antigravity, sin interfaz y por MCP, pasa 3 de 3. Claude pasa 3 de 4.
- **R-claude:** el agente justifica la unión en su respuesta: «en el plano no hay pared entre el pasillo sin rótulo y "Entrance"». En el plano real la pared entre los dos no llega al muro del aseo y deja un paso abierto, así que la lectura es defendible. La referencia los separa, como hizo Claude en las tandas 3 y 4. El criterio no se cambia después de ver el resultado: cuenta como fallo. La guía ya decía «no lo juntes con la de al lado»; el cambio de esta tanda no toca esa parte. [Probable] Es la variación del agente entre ejecuciones, no un efecto de la guía nueva.
- **Contaminación en R-claude:** escribió sus archivos auxiliares en `%TEMP%\gen` (en Git Bash, `/tmp/gen`), la misma carpeta que usó R-claude en la tanda 3. Su `Write` sobre `ops.json` falló porque el archivo ya existía. Entonces listó la carpeta y **leyó el `ops.json` de la tanda 3**, que tiene los huecos del mismo plano. Después escribió su propio `huecos-casa.json`. El fallo está en las estancias, no en los huecos, así que esa lectura no le dio un aprobado. Arreglo hecho después de la tanda 5 (pedido del autor), para las próximas:
  - `ejecutar.py` da a Claude su propia `TEMP`, `TMP` y `TMPDIR`, junto a la copia de la prueba.
  - El `/tmp` de Git Bash **no** se puede aislar: su `fstab` lo fija en la carpeta temporal de todo el sistema, aunque cambie `TEMP` (comprobado con `cygpath -w /tmp`). Por eso `registro.json` anota en `rutas_fuera` cada ruta fuera de la carpeta de la prueba que Claude pone en sus herramientas. Con las transcripciones de la tanda 5, sólo marca R-claude.
  - Antigravity no se toca: trabaja en su sandbox y una `TEMP` fuera de él podría romperle lo que ya funciona.
  - Las carpetas de las tandas 3, 4 y 5 y `%TEMP%\gen` se han borrado; sus resultados ya estaban en `resultados/`.
- **Transcripciones:**
  - Antigravity sólo usa el MCP `espacios3d` (B 38, R 70 y N 70 eventos de llamada), sin terminal, sin denegaciones y sin otros servidores MCP. Fuera de su carpeta sólo lee los esquemas de las herramientas y su propia sesión (`brain`). El MCP `espacios3d` quedó quitado al terminar.
  - Claude no usa MCP ni skills. A, C y N-claude no tocan nada fuera de su carpeta. R-claude, lo dicho arriba.

