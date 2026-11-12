# Guía para agentes: construir un espacio a partir de un plano o de fotos

Úsala cuando la persona te pase un plano (imagen o captura), fotos de las habitaciones o de los muebles y te pida montar el espacio. Lo que construyas, la persona lo abre en `Espacios3D.html`, lo retoca y lo usa.

## 1. Prepara la carpeta
- Copia las imágenes **dentro** de la carpeta del `.espacio.json`, por ejemplo en `espacios/planos/`. Así viajan con él. Una imagen de fuera no se acepta.
- Si no existe el espacio, créalo con la primera habitación: `node espacios3d.mjs nuevo espacios/casa.espacio.json --ancho 400 --largo 300 --nombre "Casa" --json`.

## 2. Pon el plano de fondo y calíbralo (siempre, en cada planta)
No te saltes este paso, tampoco por MCP: sin el plano de fondo calibrado no puedes comparar tu calco con el plano (paso 4 y lista final) y las medidas que no están escritas quedan a ojo.

1. `node espacios3d.mjs fondo poner espacios/casa.espacio.json --imagen espacios/planos/piso.png --id plano --json`.
2. Busca en la imagen dos puntos cuya distancia real conozcas: una cota del plano o una medida que te dé la persona. Si no hay ninguna, **pide una**, por ejemplo el ancho de una puerta o de una pared. Sin una medida real, el resultado es una suposición; dilo.
3. Anota sus coordenadas en píxeles (x a la derecha, y hacia abajo, desde la esquina de arriba a la izquierda de la imagen). Ayuda: recién puesto, el fondo tiene escala 1 y la esquina en (0, 0), así que cm = píxel. `plano espacios/casa.espacio.json --png espacios/planos/rejilla.png --sobre-fondo --rejilla` te da la imagen con una rejilla rotulada en píxeles para leerlos.
4. `node espacios3d.mjs fondo calibrar espacios/casa.espacio.json --id plano --puntos "x1,y1,x2,y2" --distancia 350 --en "0,0" --json`. El primer punto queda en (0, 0) cm de la planta y la escala sale de la distancia.
5. Para pasar cualquier punto de la imagen a cm de la planta: x_cm = x_fondo + px × escala, y_cm = y_fondo + py × escala. Los valores de x_fondo, y_fondo y escala salen en `resumen --json`, en `plantas[].fondos`. La fórmula vale con el fondo sin girar (`giro` 0, como queda al ponerlo); si lo giras, gira también los puntos.

## 3. Construye las habitaciones
- **Qué es una estancia:** cada espacio cerrado por paredes en el que se entra o se está, **tenga rótulo o no**: distribuidor, pasillo, recibidor, despensa, vestidor, aseo. Un hueco sin rótulo entre dos habitaciones suele ser un distribuidor: no lo juntes con la de al lado. Un armario empotrado o un patinillo (hueco de instalaciones) **no** son estancias: van como `elemento agregar --forma adosado` (o como obra) dentro de la estancia a la que dan.
- Una estancia por habitación, con la **cara interior** de sus paredes:
  - rectangular: `estancia agregar ... --id cocina --nombre "Cocina" --x 310 --y 110 --ancho 190 --largo 300`;
  - otra forma: `--contorno "[[x,y],...]"`, en el sentido de las agujas del reloj.
- **Saca las coordenadas del plano calibrado, no las vayas sumando.** Lee cada pared en la rejilla (`plano_png` o `plano --sobre-fondo --rejilla`). Si encadenas anchos y tabiques de izquierda a derecha, un tabique mal supuesto desplaza todas las estancias siguientes, y el error acaba en la que no tiene medidas. Una estancia sin medidas escritas (un distribuidor, un pasillo) se mide también en el plano calibrado, de pared a pared.
- Deja entre dos habitaciones el grosor del tabique que se ve en el plano, normalmente 7 a 12 cm. Los muros se calculan solos y un tabique no se duplica.
- La primera habitación (la que creó `nuevo`) se reajusta con `estancia contorno --estancia estancia --contorno "..."` y se renombra con `estancia --estancia estancia --nombre "Salón"`.
- Puertas, ventanas y pasos: `hueco agregar --estancia salon --tipo puerta --muro 0 --desde 100 --ancho 80`. `resumen --json` da los muros de cada estancia y su longitud. Una puerta entre dos habitaciones se pone en una de ellas; `conexiones` dice qué comunica.
- **Varias plantas:** un plano por planta. Crea la de arriba con `planta agregar --copiar-de <planta> --id p1 --nombre "Primera"` (misma huella; ajusta luego sus estancias) o con su contorno, pon su plano con `fondo poner --planta p1 ...` y calíbralo con los mismos puntos de referencia que la de abajo (por ejemplo, la misma esquina exterior) para que queden alineadas. Añade la escalera en la planta de abajo con `escalera agregar ... --hasta p1`.
- **Sin terminal (sólo MCP):** las mismas operaciones van en `aplicar` como lista: `{"op": "estancia-agregar", "id": "cocina", "x": 310, "y": 110, "ancho": 190, "largo": 300}`, `{"op": "hueco-agregar", "estancia": "salon", "tipo": "puerta", "muro": 0, "desde": 100, "ancho": 80}`, `{"op": "planta-agregar", "copiarDe": "planta-baja", "id": "p1"}`, `{"op": "escalera-agregar", ...}`, `{"op": "fondo-poner", "archivo": "planos/piso.jpg", "id": "plano"}`, `{"op": "fondo-calibrar", "id": "plano", "puntos": "x1,y1,x2,y2", "distancia": 350}`. Mira el resultado con `plano_png` (con `sobreFondo: true` y `rejilla: true`).

## 4. Compara con el plano e itera
- `node espacios3d.mjs plano espacios/casa.espacio.json --png espacios/planos/calco.png --sobre-fondo --json` pinta tu calco semitransparente encima del plano. Míralo. Si una pared no coincide, corrige su contorno y repite.
- `--rejilla` añade una rejilla rotulada cada metro. `describir --json` da lo que ya está calculado: en qué lado está cada muro, qué conecta cada puerta y qué hay en cada habitación.
- `--sobre-fondo` lee PNG de 8 bits por canal y JPEG (con su orientación). `--px-por-cm` cambia el tamaño de la imagen (por defecto, unos 1000 px de ancho; como mucho 4096).

## 5. Muebles desde fotos o medidas
- Con medidas (de la persona o de una ficha de producto), usa esas.
- Guarda las fotos que te pasen en `fotos/` y asócialas a su estancia o mueble (`foto agregar --para cama --foto fotos/cama.jpg`): la persona las verá en la ficha al revisar lo que hiciste.
- Con sólo una foto, estima a partir de algo de tamaño conocido (una puerta mide unos 80 × 205 cm; un enchufe está a unos 30 cm del suelo) y dile a la persona que son estimaciones.
- Coloca con `agregar --estancia salon --tipo sofa --muro 2 --desde 50`. Comprueba con `analizar --json`.

## 6. Lista final (antes de decir que está hecho)
1. **Cuenta las estancias** del plano, planta por planta, incluidas las que no tienen rótulo (distribuidor, pasillo), y compáralas con las de `resumen --json`. Si te falta o te sobra alguna, corrígelo.
2. **Conexiones:** cada puerta o paso del plano une en `conexiones` (de `resumen` o `describir`) las mismas dos estancias que en el plano.
3. **Calco sobre el plano calibrado, en cada planta:**
   - Cada planta debe tener su plano de fondo calibrado. Con la terminal, `resumen --json` lo muestra en `plantas[].fondos`; por MCP, `plano_png` con `sobreFondo: true` da error si la planta no lo tiene. Si falta, ponlo y calíbralo antes de seguir.
   - Saca `plano ... --png calco.png --sobre-fondo` (o `plano_png` con `sobreFondo`) y míralo: las paredes caen sobre las del plano, también las de las estancias sin medidas.
   - Comprueba el ancho y el largo totales de cada planta: mide en el plano calibrado de la primera pared a la última y compáralo con la caja de tus estancias. Si difieren en más de 5 cm, hay alguna estancia desplazada.
4. `analizar --json` sale con 0, o explicas cada aviso que quede.
5. Enséñaselo: `abrir espacios/casa.espacio.json --json` (o la herramienta MCP `abrir`) le abre la página con la casa cargada. Dile que, para retocarla y guardar, pulse «Abrir su carpeta».

## 7. Entrega
- Cuenta qué medidas son del plano, cuáles te dio la persona y cuáles estimaste.
- La persona puede abrir `Espacios3D.html`, cargar el archivo y retocar lo que quiera.
