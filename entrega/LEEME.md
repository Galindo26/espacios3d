# Espacios 3D

Modela tu habitación con sus medidas reales y prueba distribuciones de muebles en planta y en 3D. Funciona sin conexión y sin instalar nada: todo está en esta carpeta.

## Empezar
1. Abre **`Espacios3D.html`** con doble clic. Mejor en Edge o Chrome. En Firefox o Safari también funciona, pero guarda descargando el archivo.
2. Mide la habitación con una cinta, de pared a pared por dentro.
   - **Rectangular**: escribe ancho, largo y alto a la izquierda.
   - **Con otra forma** (en L, con un entrante…): abre «Paredes una a una» y apunta la longitud de cada pared y el giro hasta la siguiente. El giro es 90 en una esquina normal y −90 si la pared vuelve hacia dentro. Si las medidas no cierran, te dice por cuántos centímetros.
   - Para retocar a mano, marca «Editar esquinas en el plano»: arrastra las esquinas, haz doble clic en una pared para añadir una esquina y pulsa Supr para quitar la seleccionada.
3. Añade puertas, ventanas y pasos. Ajusta en su ficha la pared, la distancia a la esquina, el ancho y hacia dónde abre. En el plano puedes arrastrarlos por su pared.
4. Añade muebles desde el catálogo, cambia sus medidas en la ficha de la derecha y arrástralos a su sitio.
   - **Varias habitaciones** (un piso, una casa): pulsa «Añadir estancia». Para editar una, pulsa su nombre arriba a la izquierda o su suelo en el plano; sus medidas, paredes, puertas y ventanas son las que cambias. Entre dos habitaciones deja el grosor del tabique.
5. Pulsa **Guardar como…** y elige un nombre, por ejemplo dentro de `espacios/`. Desde entonces se guarda solo en ese archivo. La próxima vez, el botón «Continuar con …» lo vuelve a abrir.

## Mover muebles con comodidad
| Acción | Cómo |
| :--- | :--- |
| Mover | Arrastrar. Se pega a las paredes y a otros muebles; con Mayús, sin imán. |
| Girar | R gira 15°; Mayús+R, 90°. También mientras arrastras. |
| Ajuste fino | Las flechas mueven 1 cm; con Mayús, 10 cm. |
| Quitar, duplicar | Supr quita; Ctrl+D duplica. |
| Varios a la vez | Ctrl+clic (en la vista o en la lista) elige varios; arrastrar, R, las flechas, Ctrl+D y Supr actúan sobre todos. Al girarlos, giran juntos alrededor de su centro. |
| Medir | **Medir** (o M) y pulsa dos puntos: se pegan a esquinas y paredes (con Mayús, no). Esc deja de medir. En el móvil, toca dos puntos (arrastrar mueve la vista) y toca **Medir** otra vez para terminar. |
| Deshacer, rehacer | Ctrl+Z y Ctrl+Y. |
| Cambiar de vista | V alterna entre plano y 3D; F encuadra la estancia. |
| Colgar en la pared | En «Añadir», **Cuadro**, **Espejo**, **Televisor**, **Balda** y **Aplique** se cuelgan solos en la pared libre más cercana, a una altura habitual que cambias en **Altura del suelo**. Arrástralos por la pared como cualquier mueble; si alguno se queda sin tocar la pared, las incidencias lo avisan. |
| Suelo y paredes | En «Estancia», **Suelo** (liso, parquet, baldosa o moqueta) y su color, y el **Color de las paredes**. En 3D se ven con su dibujo; **Sin acabados** los quita. |
| Fotos | En la ficha del mueble y en «Estancia», **Añadir foto…** copia la foto a `fotos/` junto al espacio (hace falta trabajar en una carpeta) y la deja a mano; pulsa la miniatura para verla en grande o quitarla. |
| Imprimir o PDF | En «Exportar», **Imprimir o PDF** abre el plano acotado de cada planta en una hoja A4, a escala (1:20, 1:30, 1:50…), y el diálogo de imprimir del navegador; ahí puedes elegir «Guardar como PDF». Imprime a tamaño real (100 %): la barra mide 1 m. |
| Ayuda | **?** (o la tecla ?) abre la ayuda rápida en tres pasos y los atajos. |
| Ver toda la casa | Con varias plantas, **Casa entera** las apila en 3D: las de encima de la que editas se ven en transparente. Se sigue editando la planta elegida en «Planta». |
| Andar por dentro | **Recorrer** (o P): W A S D para andar, Mayús para correr, las flechas para mirar (← → a los lados, ↑ ↓ arriba y abajo) o el ratón (pulsa en la vista), y Esc para salir. No se atraviesan paredes ni muebles; por las puertas sí, y por las escaleras se sube y se baja de planta. En el móvil, el mando redondo de la izquierda anda (empujado a fondo, corre), arrastrar en la vista mira y **Salir** termina. |

Las líneas amarillas con números son las distancias libres del mueble seleccionado a lo que tiene alrededor.

A la derecha, **Incidencias** avisa:
- **en rojo, de lo que no puede ser**: un mueble que se sale, choca con otro, impide abrir una puerta o tapa el paso;
- **en ámbar, de lo que conviene revisar**: una ventana tapada, poco espacio delante de un armario, un mueble que no entra por la puerta hasta su habitación o al que no se llega con un paso de 60 cm desde alguna puerta. En «Estancia», **Comprobar el círculo de giro** avisa si no cabe uno de 150 cm para una silla de ruedas y lo dibuja donde cabe. La ficha del mueble dice si entra por la puerta.

## Columnas, radiadores y techo inclinado
En «Obra», añade lo que no se mueve: columnas, pilares, radiadores, enchufes, vigas, escalones o un techo inclinado (buhardilla). Elige uno en la lista para cambiar sus medidas. Los muebles avisan si chocan con ello, si tapan un radiador o un enchufe, o si no caben bajo el techo inclinado.

## Muebles a tu gusto
En la ficha del mueble:
- **Modelo 3D…** usa un modelo `.glb` tuyo (por ejemplo, descargado o hecho en Blender) en lugar de la forma genérica. Se copia a `modelos/` junto al espacio, así que hace falta trabajar en una carpeta (**Carpeta…**). «A las medidas» lo estira al tamaño del mueble; «Tamaño real» lo deja como es, y **Medidas del modelo** da al mueble ese tamaño.
- **Guardar en Mis muebles** lo guarda para usarlo en otros espacios de la carpeta: aparece en «Mis muebles», a la izquierda; púlsalo para añadirlo.

Si un modelo no se encuentra o no se puede leer, el mueble se ve con su forma de siempre y la ficha dice por qué. Los muebles hechos de piezas (un sofá en L, una lámpara) los puede hacer un asistente de IA (ver más abajo).

## Calcar un plano
1. En Edge o Chrome, pulsa **Carpeta…** y elige la carpeta donde quieres guardar el espacio (por ejemplo, `espacios`). Abre uno de sus espacios o guarda ahí el actual.
2. En «Plano de fondo», pulsa **Poner plano…** y elige la imagen (PNG o JPEG), o pega una captura con Ctrl+V. Se guarda en `planos/` junto al archivo.
3. **Calibra**: pulsa dos puntos del plano cuya distancia conozcas (una cota o una pared medida) y escribe esa distancia en cm.
4. **Dibujar estancia**: pulsa en cada esquina. Doble clic, Intro o volver a la primera esquina la cierra; Esc cancela. Repite con cada habitación, dejando el tabique entre ellas.

## Con un asistente en el chat
Si usas ChatGPT, Claude o Gemini en el navegador, pulsa **Copiar para el asistente** y pégaselo junto con tu petición. Cuando te devuelva los cambios, pulsa **Pegar cambios…** y pégalos: se aplican todos o ninguno, y se pueden deshacer.

## Pasarlo a otra persona
Copia la carpeta entera, por ejemplo comprimida en un ZIP. La otra persona sólo tiene que abrir `Espacios3D.html`; sus espacios son los archivos `.espacio.json` que guarde.

Los archivos hechos con la primera versión se abren igual. La página avisa antes, porque al guardar el primer cambio quedan en el formato nuevo, que la primera versión ya no abre. Si quieres conservar el original, cópialo antes.

## Con un asistente de IA
Si usas Antigravity, Claude Code, Codex, Cursor u otro agente de programación, ábrelo en esta carpeta. Las instrucciones para él están en `AGENTS.md`. Necesita Node.js 18 o posterior.
- Puedes pedirle cosas como «coloca un escritorio de 120×60 junto a la ventana sin que choque con nada» mientras tienes la página abierta: verás el cambio en un segundo.
- **Una casa a partir de un plano:** copia el plano (o un plano por planta) dentro de esta carpeta, por ejemplo en `espacios/planos/`, y pídele «construye la casa de este plano en Espacios 3D y ábremela». Si el plano no tiene cotas, dale una medida real (el ancho de la fachada o de una puerta). Al terminar, te abrirá la página con la casa cargada.
- **La página que te abre el agente es una copia:** los cambios que hagas ahí se guardan cuando pulsas **Abrir su carpeta** y eliges la carpeta del archivo (la ruta sale en el aviso de abajo). Si el agente y tú cambiasteis cosas a la vez, la página te pregunta qué hacer y por defecto guarda lo tuyo en otro archivo, sin tocar el del agente.
- También puede abrirte la página en blanco para que cargues lo que quieras.
- Te pedirá permiso para ejecutar órdenes `node espacios3d.mjs …`: apruébalas. Si tu agente no puede ejecutar órdenes, regístrale el servidor MCP de esta carpeta (orden `node`, argumentos `espacios3d.mjs mcp`); hace lo mismo.

## Licencias
Espacios 3D incluye three.js (licencia MIT), la letra IBM Plex Sans (SIL Open Font License 1.1) y las librerías de geometría polygon-clipping y splaytree (MIT), robust-predicates (Unlicense) y earcut (ISC). Los avisos están dentro de `Espacios3D.html` y, los de las librerías de geometría, también al principio de `espacios3d.mjs`, que lleva además jpeg-js (BSD-3-Clause) para leer planos JPEG.
