# Ronda 3 — Plan (11/11/2026)

Encargo del autor (11/11/2026): «Ronda 3 completa»:
1. escaleras de caracol y escaleras una encima de otra;
2. ver la casa entera con todas las plantas apiladas;
3. mandos táctiles y «Medir» en el móvil.

La lista de la ronda 3 anotada en las notas del proyecto añade dos puntos pequeños que entran también:
4. aprovechar el hueco bajo la escalera;
5. sellar `planta` en las distribuciones al pasar a dos plantas.

Fuera de esta ronda (lista antigua de `PLAN_R2.md`, «Alcance: a la ronda 3», que no está en esas notas): círculo de giro, «¿cabe por la puerta?», paso libre en rejilla, materiales, PDF, «Ayuda rápida» animada y fotos asociadas. Se quedan anotados para una ronda 4.

Formato: sigue siendo `version: 2`. Los campos nuevos son opcionales y los archivos de R2 se leen igual; ningún archivo válido de R2 pasa a ser inválido (sí pueden cambiar avisos y la geometría del hueco, ver R3-1 b).

## R3-1. Núcleo: escaleras (caracol, hueco real, bajo la escalera, apiladas) y distribuciones

### a. Caracol
- **Formato:** `forma: "caracol"`, con los campos comunes `x`, `y`, `ancho`, `giro`, `hasta`, `peldanos?` y además:
  - `gira`: mano de quien sube, como en L y U; `derecha` (por defecto, como en L y U) = sentido horario visto en planta;
  - `poste?`: diámetro del poste central (cm), 20 por defecto, entre 8 y 60;
  - `vuelta?`: grados que gira de pie a llegada, 360 por defecto, entre 90 y 360.
  - `largo`, `tramos` y `ojo` no van (error, como hoy entre formas).
- **Geometría** (mismo marco local que las demás: origen en el centro del borde del pie, F = sentido de subida, R = derecha de quien sube):
  - `ancho` es el ancho del peldaño (del poste a la barandilla). Radio exterior `Re = poste/2 + ancho`; diámetro total `2·Re`.
  - El centro está a la mano de giro: `C = pie + s·R·(poste/2 + ancho/2)`, con s = +1 para `derecha` y −1 para `izquierda`. El pie es el radio del ángulo de salida, del poste al borde.
  - Peldaños: N cuñas iguales de `vuelta/N` grados; llegada = el radio del ángulo final; `salida` = tangente en la llegada en el sentido de giro.
  - **Huella**: las cuñas desde el centro (incluido el poste), cada una troceada en polígonos convexos de ≤ 10° de arco, para que todo lo que hoy recorre `huella` (convexos) siga valiendo.
  - **Altura del suelo**: rampa por ángulo (`z = altura · θ/vuelta`, θ desde el pie en el sentido de giro, en [0, vuelta)). Es la misma función `alturaEnEscalera` (una sola lógica para recorrido, colisiones y pruebas).
  - Peldaños por defecto: `round(altura / 21)` (las de caracol se construyen con contrahuellas algo mayores).
- **Avisos propios** (los de la caracol siguen las cifras habituales de las de caracol, p. ej. el código IRC de EE. UU. R311.7.10.1; no las de una escalera recta): huella medida a 30 cm del poste menor de 17 cm; contrahuella mayor de 24 cm; ancho menor de 66 cm. Error por debajo de 60 cm de ancho, como las demás.
- **Zonas libres** de pie y llegada: en la caracol, 60 cm de fondo en tangente sobre los 40 cm exteriores del peldaño (por donde se pasa; junto al poste no se pisa). En las demás formas no cambian.
- **Piezas**: peldaños volados (cuñas de 5 cm de grueso, sin macizo debajo), poste de suelo a llegada + 90 cm, barandilla por el borde exterior (segmentos cortos que siguen la rampa) y, como en las demás, barandilla alrededor del hueco salvo la llegada.
- **Dibujo** (planta, texto, SVG, PNG, página): círculo exterior, poste, líneas radiales de los peldaños y flecha por la línea de huella (arco). Sale solo si las funciones genéricas (`huella`, `lineasPeldanos`, `ejeEscalera`) devuelven lo de la caracol.
- `describir`: «de caracol de 160 cm de diámetro, gira a la derecha, 360°, poste de 20 cm».

### b. Hueco real en el forjado (todas las formas)
Hoy el hueco de arriba es la huella entera («se pierde algo de suelo que una obra real taparía», límite escrito en R2). Para la caracol de 360° no vale: la llegada cae encima de los primeros peldaños y, con el hueco entero, no habría suelo al llegar. Cambio:
- **Hueco** = la parte de la huella donde quien sube no tendría 200 cm libres bajo el forjado: puntos donde `z > techo − 200`, con `techo` la altura de la estancia de abajo que contiene la escalera. Si `techo − 200 ≤ 0`, la huella entera (como hoy).
  - Recta, L y U: el tramo 1 se corta en perpendicular a su eje; la meseta y lo que viene después van enteros; el ojo de la U, entero.
  - Caracol: las cuñas desde el ángulo de corte hasta la llegada.
- Lo que queda fuera del hueco es suelo de la planta de arriba (se puede pisar y amueblar).
- `geo.hueco` (polígonos convexos) sustituye a `geo.huella` en todo lo que hoy es «el hueco de arriba»: validación arriba, techo de la planta de abajo, suelo de arriba, canto y barandilla, colisiones, recorrido arriba, planos de la planta de arriba y `huellasEscaleras`. `geo.huella` sigue siendo lo que la escalera ocupa abajo.
- Constante única `ALTURA_LIBRE = 200`.

### c. Bajo la escalera (punto 4)
- **Peldaños con losa**, no macizos hasta el suelo: en recta, L y U cada peldaño baja hasta `max(0, cota de su frente − 20)` (losa de 20 cm); la meseta, losa de 20 cm. La caracol, peldaños de 5 cm.
- Función única `bajoEscalera(geo, p)`: cota de la cara inferior en p (null fuera de la huella; el poste de la caracol cuenta como macizo hasta arriba).
- **Muebles y obra bajo la escalera**: dejan de ser error si caben (su parte de arriba ≤ `bajoEscalera` en toda su huella, comprobado en una rejilla de 5 cm más sus esquinas, con tolerancia). Si no caben: error «no cabe bajo la escalera: tiene X cm y hay Y». En las zonas libres sigue siendo error.
- **Pasar por debajo en el recorrido**: en la planta de abajo, la barrera de una escalera es el borde de su «parte baja» (donde `bajoEscalera < 200`), salvo el pie; por debajo de la parte alta se anda. El poste de la caracol es un obstáculo.
- `.glb`: las piezas nuevas; las rampas de colisión no cambian (siguen la cara de arriba).

### d. Escaleras una encima de otra (apiladas)
- Se quita el error «las escaleras apiladas aún no se admiten». Una escalera puede estar sobre el hueco de la que llega a su planta (caja de escalera).
- Errores nuevos:
  - el pie y su zona libre no pueden caer sobre el hueco de otra escalera (se arrancaría en el aire);
  - la escalera no puede tapar la zona libre de llegada de la que llega a su planta;
  - **altura libre**: donde una escalera pasa por encima de otra, entre la cara de arriba de la de abajo y la cara inferior de la de arriba tiene que haber 200 cm (muestreo de 10 cm sobre la intersección de las dos huellas);
  - dos escaleras de la misma planta no pueden solaparse.
- **Recorrido** (estado: planta y escalera, como hoy):
  - Fuera de las escaleras, la barrera es el borde de la unión de las partes bajas de las que suben y los huecos de las que llegan, salvo los pies de las que suben y las llegadas de las que llegan.
  - **Entrar**: si el punto está en varias a la vez (la de arriba sobre el hueco de la de abajo), se entra en la de borde abierto más cercano.
  - **Salir**: al cruzar el pie o la llegada (segmento entre la posición anterior y la nueva). Si coinciden (caracol de 360°), decide la cota de la que se viene: en la mitad alta, se llega arriba. Si sale de la huella sin cruzar ninguno, el más cercano (como hoy). `pasoEscaleras` recibe la posición anterior (opcional, para no romper llamadas).
- Dibujo: la planta del medio muestra el hueco de la de abajo (trazos) y la que sube (peldaños) encima.

### e. Distribuciones (punto 5)
- Al pasar de una planta a dos (`planta-agregar` sobre un archivo de una), las posiciones guardadas sin `planta` reciben la id de la única planta. Así, aplicar una distribución antigua devuelve a su planta un mueble que luego se movió a la nueva.

### f. Lote, CLI, MCP, esquema y guías
- `escalera-agregar|editar` admiten `poste` y `vuelta` (y `forma: "caracol"`); esquema y paridad.
- Ayuda del CLI, `entrega/AGENTS.md`, `entrega/LEEME.md` y las guías: caracol, hueco real, bajo la escalera y apiladas. Se retira el límite escrito de R2 sobre el hueco entero y las apiladas.

### Pruebas (R3-1)
- Caracol: centro, radios, pie y llegada con `gira` a los dos lados y giros 0, 90 y 45; huella convexa y su área frente a π·Re²·vuelta/360 (±1 %); altura por ángulo; peldaños por defecto; avisos; validación (poste, vuelta, campos de otras formas).
- Hueco: área frente a la analítica en recta, L, U y caracol; sin corte cuando el techo es bajo.
- Bajo la escalera: mueble que cabe (sin error), que no cabe (error con cifras), en la zona libre (error); `bajoEscalera` en peldaños y meseta.
- Apiladas: caja de escalera de dos U (sin errores); pie sobre el hueco, llegada tapada, altura libre insuficiente y solape en la misma planta (errores).
- Recorrido: subir una caracol de 360° de abajo arriba y bajar; subir dos tramos apilados P0→P1→P2 y bajar; pasar por debajo de una recta por su parte alta y no por la baja.
- Distribuciones: guardar con una planta, añadir otra, mover un mueble a ella, aplicar → vuelve.
- `.glb` de cada forma validado con gltf-validator.

## R3-2. Página: escaleras y casa entera

### a. Escaleras en la página
- Ficha «Escalera»: forma «De caracol» con Poste y Vuelta; ancho, gira y peldaños como las demás.
- Recorrido: el de la R3-1 (entrar y salir por borde cruzado).
- Dibujo en planta y 3D con las piezas nuevas.

### b. Casa entera (punto 2)
- En 3D, un interruptor **«Casa entera»** junto a «Plano / 3D» (sólo con más de una planta).
- Con él, se dibujan todas las plantas a su `nivel`: las de debajo de la activa, opacas; las de encima, en transparente (para ver y editar la activa desde arriba). Se edita sólo la activa, como hoy.
- **Forjado**: entre plantas se rellena el forjado (de `techo` de la de abajo al suelo de la de arriba, sobre la huella de las estancias más el muro exterior, con los huecos). Función del núcleo `forjados(e, planta)`, que usa también el `.glb` (hoy el forjado no se rellena).
- Encuadrar (F) abarca la casa.
- **Recorrer**: se dibujan siempre todas las plantas (sin transparencia). Sustituye a la «planta vecina» con histéresis de R2-7b (que sólo veía una; con escaleras apiladas hacen falta dos).
- Se recuerda (`localStorage`, con try/catch) si estaba puesta.

### Pruebas (R3-2)
- e2e: ficha de caracol; subir por una caracol con el teclado; subir dos plantas por una caja de escalera; «Casa entera» con tres plantas (número de plantas dibujadas y transparencia de la de arriba); editar un mueble de la activa con ella puesta; sin red.

## R3-3. Móvil: mandos táctiles y «Medir» (punto 3)

- En pantallas estrechas (≤ 900 px) vuelven **Recorrer** y **Medir**, en la fila de botones del móvil (o en un menú si no caben: se decide con la skill `diseno-de-interfaces` y capturas a 360 px).
- **Recorrer con el dedo** (cuando el puntero es táctil, `pointer: coarse` o se ha tocado la pantalla):
  - joystick a la izquierda: andar y moverse de lado, con velocidad proporcional (empujar a fondo corre);
  - arrastrar en el resto de la vista: mirar;
  - botón «Salir» visible (no hay Esc);
  - sin Pointer Lock con el dedo;
  - multitáctil: un dedo en el joystick y otro mirando a la vez (por `pointerId`).
- **Medir con el dedo**: tocar el primer punto y el segundo; mientras el dedo está apoyado, la medida provisional lo sigue; imán a esquinas y paredes con un umbral mayor (24 px) que con ratón; el aviso dice «toca» en vez de «pulsa» y que «Medir» sale. Medir no mueve la cámara ni arrastra muebles.
- Objetivos táctiles de al menos 44 px.

### Pruebas (R3-3)
- e2e con Edge emulando un móvil (viewport de 390 × 844, `has_touch`, `is_mobile`): Recorrer y Medir visibles; andar con el joystick (eventos táctiles) atravesando una puerta; mirar arrastrando; dos dedos a la vez; Salir; medir una pared con dos toques (± 1 cm con imán); capturas a 360 y 390 px.
- Sin verificar hasta que el autor lo pruebe: el tacto real en su móvil (la emulación no es un dedo).

## Orden, revisiones y cierre
- R3-1 → R3-2 → R3-3, con commit por paso (`R3-1: …`) y revisión independiente de este plan y de cada paso, como en R2.
- Comprobaciones al cierre de cada paso: `npm run check` (tipos, unitarias, e2e) y el tamaño de la página (objetivo: menos de 1,2 MB).
- Documentación del proyecto al día (estado, formato y uso por agentes).

## Estado al cierre de la ronda 3 (11/11/2026)

| Paso | Comprobación | Revisión independiente |
| :--- | :--- | :--- |
| Plan | — | Pendiente (HTTP 429 al pedirla) |
| R3-1 Núcleo | 19 pruebas nuevas en `tests/unit/r31.test.mjs` (el commit decía 23 por error) y 4 casos de paridad del esquema | Revisado (12/11), ver abajo |
| R3-2 Página | e2e: ficha de caracol, casa entera con tres plantas, subir dos plantas por una caja de escalera | Pendiente |
| R3-3 Móvil | e2e en Edge emulando un móvil (390 × 844 y 360 × 740, táctil): mando, mirar, dos dedos, Salir, medir con dos toques e imán, arrastrar sin poner punto | Pendiente |

**Comprobaciones** (`npm run check` con `PYTHONIOENCODING=utf-8`): 375 unitarias, 244 comprobaciones e2e, cero peticiones de red y cero errores de consola. HTML de 1117 KB (objetivo: menos de 1,2 MB); CLI de 396 KB.

**Desviaciones del plan:**
- `gira` de la caracol tiene valor por defecto (`derecha`), como en L y U; el plan decía obligatorio.
- Con la caja de escalera, el gancho de pruebas `colocar` deducía mal la escalera sobre la meseta (estaban una sobre otra); ahora conserva la escalera en la que ya se está. Andando no pasaba: el estado se arrastra paso a paso.
- En las otras plantas («Casa entera» y al recorrer) no se dibujan los enchufes ni el techo inclinado, que son ayudas de la planta que se edita; la obra con volumen sí.
- Con el dedo, Medir no muestra la medida provisional mientras se arrastra (arrastrar mueve la vista); el punto se pone al levantar el dedo sin haber arrastrado.

**Sin verificar:**
- el tacto real en un móvil y el rendimiento de «Casa entera» con muchas plantas y modelos en un móvil;
- la caracol subida a pie en la página (la subida de una vuelta entera está probada en el núcleo; en la página, la recta y la caja de escalera);
- la comodidad, que juzga el autor.

## Revisión independiente de la ronda 3 (12/11/2026)
Sin bloqueantes; «Listo con arreglos» en los cuatro commits. Arreglado, con prueba que falla antes y pasa después:
- **1 (importante):** en una caja de escalera (dos U con ojo 0) se podía saltar de la planta del medio a la de abajo o a la de arriba entrando en diagonal junto a la barandilla central. Ahora se sale de una escalera según la cota de la que se viene, no según el borde que se cruza; fuera de ella, los primeros 60 cm de las barandillas que arrancan en un borde abierto son obstáculo; y la colisión ya no deja pasar a quien está justo encima de una línea (lo empuja hacia el lado del que venía).
- **2 (importante):** dos caracoles de 360° una encima de otra eran casi imposibles («tapa la llegada» miraba la huella entera de la de arriba). Ahora mira su parte baja, como el pie. Con el mismo centro, girada 60° ya vale (antes no valía ningún giro), y el mensaje lo sugiere.
- **3 (importante):** las rampas de colisión eran macizas desde el suelo: en un juego no se pasaba bajo la parte alta ni se llegaba al pie de una caracol de 360°. Ahora son losas del grueso de la cara inferior. (El suelo de colisión sin hueco ya se había arreglado con la revisión de R2-7d.)
- **4 (importante):** la escalera no tenía en cuenta el techo inclinado. Ahora avisa si pasa bajo uno con menos de 200 cm libres, o si lo hay sobre la llegada.
- **5 a 7:** el techo para el hueco es el de la estancia que contiene la escalera (no la del pie); el corte del hueco nunca queda por encima de la escalera; y un mueble que muerde 1 cm la esquina de la meseta se detecta (se muestrean también los vértices de la huella).
- **8:** pruebas del área del hueco en U, de una caracol a izquierdas subida y bajada, del forjado (y su nodo en el `.glb`) y del poste y las rampas de colisión de la caracol; el forjado figura en la guía para juegos.
- **9:** «Casa entera» rehace sólo las plantas que cambian (al mover un mueble, sólo la activa).
- **10 y 11:** «Medir» no pone un punto con un pellizco ni con un arrastre que vuelve al sitio; el mando y la vista no ceden su dedo a un segundo dedo, y al salir el mando se suelta.
- **12:** el canto del hueco y el forjado, del mismo color (comparten pared; con colores distintos podían parpadear).
