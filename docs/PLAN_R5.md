# Ronda 5: de un plano a la casa, guardar y abrir (pedido por el autor el 12/11/2026)

El autor quiere:
1. abrir el proyecto con Antigravity, pasarle el plano de una casa completa y que la construya en Espacios 3D;
2. que la casa, cualquier cuarto y los planos se guarden bien y se puedan abrir en el futuro;
3. que el agente le abra el programa con la casa ya cargada;
4. que el agente le abra el programa en blanco para cargar él lo que quiera.

Punto de partida comprobado:
- (1) Claude y Codex pasaron 3 de 3 planos sintéticos. Con el plano real, Codex unió el distribuidor sin rótulo al recibidor. Antigravity, lanzado sin interfaz, falló: quiso usar la terminal, se le denegó y la sesión terminó. Ya se había ensayado que sí usa el MCP si se le pide.
- (2) Hay un formato v2 con migración desde la v1. Los fondos, las fotos y los modelos van al lado, con rutas relativas. Falta una prueba de ida y vuelta con una casa que lo tenga todo.
- (3) No existe. Una página abierta desde el disco no puede leer un archivo sin un gesto de la persona.
- (4) Ya funciona con doble clic en `Espacios3D.html`; falta una orden para el agente.

## Revisión independiente del plan (12/11/2026): aprobado con cambios
Todo lo que sigue ya incorpora sus hallazgos (B1–B3 bloqueantes, I4–I8 importantes, M9–M16 menores).

## R5-1. `abrir` en el CLI y en el MCP
- `node espacios3d.mjs abrir`, sin archivo, abre `Espacios3D.html` tal cual. Puede mostrar el borrador de la última sesión o «Continuar con …»; la ayuda lo dice (M15).
- `node espacios3d.mjs abrir espacios/casa.espacio.json [--salida pagina.html] [--no-lanzar] [--json]`:
  - lee el **texto exacto** del archivo y lo valida (código 2 si no es válido). No convierte nada en disco aunque sea v1 (M13);
  - escribe una copia de la página con el texto y sus archivos dentro, en `os.tmpdir()/espacios3d/<nombre saneado>-<hash>.html`:
    - el nombre saneado sólo lleva `[a-z0-9_-]`;
    - el hash se calcula sobre la ruta real normalizada, en minúsculas en Windows (M10);
    - se escribe con temporal y renombrado (M9);
  - inserta con una marca única y `split/join`, no con `replace` (`$&` intacto). Si `Espacios3D.html` falta o no lleva la marca, da un error claro (M9);
  - el JSON metido escapa `<`, `>`, `&`, U+2028 y U+2029, así que `</script>` y `<!--` no rompen la página;
  - mete dentro los fondos, los modelos y las fotos del espacio, en ese orden, con un tope de 64 MB que se puede cambiar para las pruebas (`ESPACIOS3D_TOPE_INCRUSTADO`):
    - sólo los que, resueltos enlaces y uniones, quedan dentro de la carpeta del `.espacio.json`;
    - lo que se omite sale en `omitidos` con su motivo, y la página lo dice (M11);
    - «Mis muebles» no va dentro (I6): los muebles ya colocados llevan sus piezas y su modelo;
  - lanza el navegador con `%SystemRoot%\explorer.exe` (ruta absoluta) por `spawn`, sin shell, con `stdio: 'ignore'`, `detached` y `unref` (I4). `open` y `xdg-open` en macOS y Linux, declarados sin verificar;
  - salida JSON: `{ pagina, archivo, copiadaEn, lanzado, incluidos, omitidos, aviso }`. El aviso dice: «no puedo comprobar que el navegador se abrió; la página está en …»;
  - con `--no-lanzar` o `ESPACIOS3D_NO_LANZAR=1` sólo escribe.
- Herramienta MCP `abrir { archivo? }`, con las mismas comprobaciones de ruta. Su salida estándar sigue siendo JSON-RPC limpio.
- **Prueba real del lanzamiento (I4):** desde el CLI y desde el MCP, con una carpeta con espacios y tildes. Evidencia: una ventana de Edge cuyo título lleva el nombre de la casa.

## R5-2. La página con la casa dentro
- Al arrancar, lo incrustado **gana al borrador** (B3). Mientras siga sin vincular, no se escribe ni se borra el borrador, no se toca «Continuar con …» y no hay autoguardado. El `beforeunload` ya avisa de lo pendiente.
- Un almacén envoltorio sirve los archivos relativos desde lo incrustado mientras no hay archivo vinculado:
  - `carpeta()` devuelve null, así que las guardas de escritura siguen negando (I6);
  - al vincular, delega en el almacén real.
- Aviso fijo: «Abierta por un agente a las HH:MM: casa.espacio.json (ruta). Es una copia: los cambios posteriores del agente no se ven y los tuyos no se guardan hasta que abras su carpeta». Debajo, lo omitido. Botón **Abrir su carpeta** (I5):
  - si ya hay una carpeta recordada, la reutiliza con un permiso;
  - si no, abre el selector.
- **Reconciliación única (B1, B2).** «Abrir su carpeta», «Guardar», Ctrl+S, «Carpeta…» eligiendo ese archivo y «Continuar con …» de ese archivo pasan todos por ella:
  - el archivo se reconoce por el sufijo de su ruta absoluta (nombre de carpeta y ruta relativa) y se confirma por contenido. Nada de casar sólo por el nombre;
  - comparación con el texto incrustado exacto:

    | Disco frente a lo incrustado | Sin cambios en la página | Con cambios en la página |
    | :--- | :--- | :--- |
    | Igual | vincular | vincular y guardar sin preguntar |
    | Distinto | cargar el del disco y avisar | conflicto: «Guardar lo mío en otro archivo» (por defecto), «Quedarme con el del disco» o «Guardar encima» (dice que se pierde lo cambiado en el disco) |
    | Con errores o ilegible | no se vincula; se informa | igual |
    | No encontrado o selector cancelado | sigue la copia, con un aviso | igual |

  - `Sincronizador.vincularConservando()` es nuevo: vincula sin borrar lo pendiente. Tiene pruebas unitarias propias.
- «Guardar como…» en ese modo es una copia explícita y avisa de que no lleva planos, fotos ni modelos.
- «Carpeta…» normal pasa por `antesDeReemplazar`. Arregla el hueco que ya existe: descartaba cambios sin preguntar.
- El aviso desaparece al vincular, con Nuevo, Abrir, soltar un archivo o «Continuar con …» de otro archivo (M14).
- Firefox y Safari: el aviso dice que «Guardar» descarga una copia.

## R5-3. Guardar y abrir en el futuro
- **Casa completa congelada** en `tests/referencia_v2/` (I7). Es una v2 con:
  - 2 plantas, tabiques, puertas, ventanas y pasos, escalera en L;
  - muebles con piezas y uno con modelo, un objeto colgado, elementos, faldón, acabados;
  - fondo calibrado (PNG) y foto, y una distribución.
  - Con ella, su `resumen` esperado y su `.glb` validado.
  - Una prueba lee la referencia con el código actual y compara `resumen`. `aJSON(validar(texto))` debe dar el mismo texto.
- e2e con la referencia:
  - por «Carpeta…» se ve todo;
  - un cambio y su inverso guardados dejan el archivo igual byte a byte, porque `guardarAhora` no escribe sin pendientes;
  - un cambio real lo lee y valida el CLI.
- e2e de `abrir`:
  - los cuatro casos de la tabla, más selector cancelado, no encontrado y homónimo distinto;
  - «Guardar», «Carpeta…» y «Continuar con …» del mismo archivo pasan por la reconciliación;
  - sin red, `localStorage` intacto antes de vincular y el borrador viejo no gana;
  - nombres con `</script>`, `<!--`, `$&` y tildes;
  - el tope con un límite pequeño, con lo omitido a la vista;
  - unión que apunta fuera de la carpeta: omitida con motivo.
- Un cuarto suelto y un fondo JPEG también pasan.
- Unitarias de `abrir` y del MCP, con la salida estándar limpia.

## R5-4. Agentes con el plano de una casa
- `--sobre-fondo` y `plano_png` leen también JPEG (I8), con `jpeg-js` dentro del CLI, sin instalar nada en la entrega.
- Guías (`entrega/AGENTS.md`, `GEMINI.md`, `guias/desde-un-plano.md`, `LEEME.md`):
  - con interfaz (el editor de Antigravity, Claude Code, Codex), terminal y la persona aprueba. Sin terminal, el MCP: `aplicar` tiene todas las operaciones de casa;
  - estancia = espacio de paso o de estar cerrado por paredes, tenga rótulo o no (distribuidor, pasillo, despensa). Los armarios empotrados y los patinillos no lo son: van como `elemento` u obra (acotado, I8);
  - lista final: estancias del plano frente a las tuyas, `conexiones`, `--sobre-fondo` y `analizar`;
  - al terminar, `abrir`, y volver a llamarlo tras cambiar más cosas;
  - corregir «cinco herramientas» (M16) y «la página recoge tus cambios en un segundo», que no vale para la copia (I5).
- **Aceptación, tanda 3.** El protocolo se escribe antes de ejecutar. Como la guía cambia, se repiten **todas** desde cero (`PROTOCOLO.md` §48):
  - A y C con Claude Sonnet; B con Antigravity; R con Antigravity y con Claude;
  - plano **N**, nuevo y no visto: casa de **dos plantas** con distribuidor sin rótulo, armario empotrado y escalera. Lo hacen Antigravity y Claude. Su referencia se fija antes;
  - `puntuar.mjs` con el mismo criterio, ampliado a varias plantas y escaleras sin aflojar tolerancias. Se anota si el agente llamó a `abrir`, con `ESPACIOS3D_NO_LANZAR=1`.
- **Sin verificar, declarado:** Antigravity con interfaz. Queda el guion de pasos para el autor en `tests/aceptacion/GUION_PRUEBA_MANUAL.md`; la pregunta 1 del autor sigue «no verificada» hasta su prueba. Tampoco está restringida de verdad la lista de herramientas de Claude (ya anotado en el protocolo).

## R5-5. Cierre
- `npm run check` y `npm run motores`.
- Aserción de tamaño en el build: HTML ≤ 1 258 291 bytes (1,2 MiB) (M12).
- Ayuda del CLI, `entrega/AGENTS.md`, `LEEME.md` y esquema al día.
- Revisión independiente del código al final.
- Documentación del proyecto en el mismo pase.

## Riesgos y decisiones
- La copia duplica los datos hasta que se vincula. Por eso el aviso es fijo, hay reconciliación con conflicto explícito y no se escribe nada en ningún sitio.
- Un servidor local daría guardado directo, pero añade un proceso, superficie de seguridad y choca con «sin red». Se descarta.
- `jpeg-js` (BSD-3, sin dependencias) se fija a una versión exacta. Justificación: casi todos los planos reales son JPEG, y un agente sólo con MCP no puede convertirlos.

## Revisión independiente del código (12/11/2026): aprobado con cambios
Sin bloqueantes. Cómo quedó cada hallazgo:

| N.º | Hallazgo | Resuelto |
| :--- | :--- | :--- |
| 1 | Vincular con una lectura vieja: tras el diálogo de conflicto, un cambio de la persona pisaba lo que el agente escribió entretanto | `Sincronizador.conocerLeido`: lo conocido es el texto mostrado y, si el disco ya difiere, lm NaN para que el sondeo lo recoja. `reconciliar` relee tras el diálogo y, si cambió, reconcilia otra vez. Unitaria roja → verde (`vincular` y `vincularConservando`) y e2e |
| 2 | «Otro archivo» se creaba en la raíz de la carpeta elegida | Se crea junto al original, en su subcarpeta (`crearEnCarpeta` admite subcarpetas), con un nombre libre entre sus hermanos. e2e con `espacios/casa.espacio.json` |
| 3 | Una v1 abierta con `abrir` se guardaba convertida sin aviso | Confirmación como al abrirla, y el aviso fijo lo dice. e2e: al cancelar, el v1 sigue intacto |
| 4 | La carpeta recordada se usaba sin selector y sólo por el sufijo | Sólo si su nombre está en la ruta (se mira antes de pedir permiso) y su archivo es idéntico a la copia; si no, selector. La siguiente pulsación va siempre al selector. Disco falso con carpeta recordada y e2e de los dos casos. **Sin verificar en Edge real:** el gesto tras pedir permiso |
| 5 | `--salida` podía pisar `Espacios3D.html` o un `.html` ajeno | Se rechaza la página de la entrega, y un `.html` que no hizo `abrir` sin `--forzar`. Unitaria roja → verde |
| 6 | `registro.abrir` daba «sí» por una orden escrita en el mensaje final | Se analizan sólo las llamadas a herramientas. Dato de A corregido. La forma de una llamada MCP de Antigravity es una suposición (no hay ninguna real) |
| 7 | Fallos de lectura o creación sin mensaje | Capturados, con aviso «sigues con la copia» |
| 8 | Avisos que mentían si se cancelaba | `usarLeido` devuelve si abrió; «disco» ya no borra lo pendiente antes |
| 9 | Un fondo que es una carpeta tumbaba `abrir`; en la raíz de una unidad se omitía todo | Se omite con su motivo; el prefijo de la raíz se trata. Unitaria roja → verde |
| 10 | En Firefox y Safari el envoltorio servía lo incrustado a otro espacio | Sólo mientras la página siga con la copia. Unitaria roja → verde |
| 11 | UTF-16 | `abrir` lo rechaza con un motivo claro. Unitaria roja → verde |
| 12 | Lanzamiento: comas, `lanzado`, copias que no se limpian | Toda ruta con coma se lanza desde una copia sin comas; el aviso dice que sólo se pidió abrirla; las copias de más de 7 días se borran. Se queda `explorer.exe`, porque `rundll32 url.dll` tampoco se puede comprobar aquí |
| 13 | Pruebas débiles | EXIF con cuatro cuadrantes y las ocho orientaciones; el calco JPEG mira los píxeles; e2e de la foto servida desde la página y del fondo tras unirse a la carpeta |
| 14 | `puntuar.mjs` no veía una planta de arriba desplazada | Comprobación «planta k: posición», fijada antes de la tanda 4 (más estricta) |
| 15 | «Guardar como…» sobre el mismo archivo lo pisa sin reconciliar | Se queda así: lo confirma el sistema y la página ya avisa de que es una copia aparte. Probabilidad baja |

Cambio respecto al plan: «Continuar con …» no pasa por la reconciliación. Mientras se ve la copia se oculta, que es más seguro.

## Lanzamiento real (12/11/2026)
[Verificado por el autor] `abrir` lanzado desde la terminal del agente (`explorer.exe` por ruta absoluta) abre en su Edge la pestaña «PRUEBA DE ABRIR 1 · Espacios 3D» con el aviso «Abierta por un agente…». Antes había parecido que no se abría: el agente buscaba procesos y ventanas nuevas de Edge, pero Edge abre la pestaña dentro del navegador que ya está en marcha, sin ninguna ventana nueva que se vea desde fuera. Sin probar aparte: el mismo lanzamiento desde la herramienta MCP (es la misma función `lanzar`).

