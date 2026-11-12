# Espacios 3D

Modela tu habitación, tu piso o tu casa con sus medidas reales, amuéblala y prueba distribuciones en planta, en 3D y andando por dentro. Funciona entera en tu ordenador, sin conexión y sin cuentas: el resultado es una carpeta con una página (`Espacios3D.html`) que se abre con doble clic.

Está pensada para usarla de dos maneras a la vez:

- **Tú**, en la página: dibujas estancias, arrastras muebles, mides y recorres la casa.
- **Un agente de IA** (Claude Code, Codex, Gemini, Antigravity, Cursor…), con un comando o un servidor MCP: le das un plano o unas fotos y construye el modelo inicial; le pides «pon un escritorio de 120 × 60 junto a la ventana sin que choque» y lo coloca. Los dos trabajáis sobre el mismo archivo `.espacio.json`.

## Para qué sirve
- Ver si un mueble cabe antes de comprarlo o moverlo: avisa de choques, puertas que no abren, ventanas tapadas, muebles que no entran por la puerta y pasos de menos de 60 cm.
- Probar varias distribuciones de la misma habitación y compararlas.
- Levantar una casa entera a partir de su plano: varias estancias y plantas, tabiques, escaleras (rectas, en L, de dos tramos y de caracol), columnas, vigas, radiadores y techos inclinados.
- Imprimir el plano acotado a escala o guardarlo en PDF.
- Exportar a `.glb` con colisiones para Godot, Unreal, Unity o Blender.

## Empezar
Hace falta [Node.js](https://nodejs.org) 24 para compilar (para usar el comando ya compilado basta la 18).

```
git clone <dirección de este repositorio>
cd espacios3d
npm install
npm run build
```

La compilación deja la herramienta en `dist/Espacios3D/` y en `dist/Espacios3D.zip`. **Copia `dist/Espacios3D` a una carpeta tuya fuera del repositorio** (por ejemplo `Documentos/MiCasa`) y trabaja ahí: `dist/` se borra en cada compilación.

En esa carpeta:
- abre `Espacios3D.html` con doble clic (mejor en Edge o Chrome; en Firefox y Safari se guarda por descarga);
- `LEEME.md` explica el uso a mano, paso a paso;
- `AGENTS.md` y `guias/` son las instrucciones para tu agente.

## Construir el modelo inicial con un agente
Abre tu agente de programación **en tu carpeta de trabajo** (la copia de `dist/Espacios3D`). Lee solo el `AGENTS.md` de esa carpeta; no hace falta explicarle la herramienta. Te pedirá permiso para ejecutar órdenes `node espacios3d.mjs …`.

### A partir de un plano
1. Copia la imagen del plano dentro de la carpeta, por ejemplo en `espacios/planos/`. Vale un PNG o un JPEG: un plano de la inmobiliaria, una captura de pantalla o la foto de un plano en papel. Si la casa tiene varias plantas, una imagen por planta.
2. Pídeselo con tus palabras: «Construye la casa de este plano en Espacios 3D y ábremela».
3. **Dale una medida real si el plano no tiene cotas** (el ancho de una puerta, el largo de una pared). El agente la usa para calibrar la imagen; sin ella, las medidas son una suposición.

Lo que hace el agente (detalle en `guias/desde-un-plano.md`):
1. pone la imagen como plano de fondo y la calibra con dos puntos y su distancia real;
2. crea una estancia por cada espacio cerrado, con puertas, ventanas y pasos, y las plantas y la escalera si las hay;
3. pinta su calco encima del plano, lo compara y corrige hasta que las paredes coinciden;
4. comprueba el resultado y te abre la página con la casa cargada.

Después lo retocas tú en la página: mueves un tabique, cambias una medida, añades muebles.

### A partir de fotos
Las fotos de una habitación no dan medidas por sí solas. Sirven para dos cosas:
- **Saber qué hay y dónde**: el agente identifica los muebles y su colocación, y estima tamaños a partir de algo conocido que salga en la foto (una puerta, un enchufe). Te dirá qué medidas son estimadas; si le das las reales (o la ficha del producto), usa esas.
- **Tenerlas a mano**: las guarda en `fotos/` y las asocia a su estancia o mueble, y tú las ves en la ficha al revisar.

Lo que mejor funciona es combinar: el plano para las paredes y las fotos para los muebles. Un mueble con forma propia (un sofá en L, una lámpara de pie) el agente lo construye con piezas, o usa un modelo `.glb` si tienes uno (`guias/muebles-a-medida.md`).

### Sin terminal
Si tu agente no puede ejecutar órdenes, regístrale el servidor MCP de la carpeta (orden `node`, argumentos `espacios3d.mjs mcp`); Claude Code lo ofrece solo al abrir la carpeta. Si usas un asistente en el navegador (ChatGPT, Claude, Gemini), la página tiene **Copiar para el asistente** y **Pegar cambios…**.

## Límites
- No reconoce un plano por sí misma: lo interpreta el agente que uses, y su acierto depende del modelo y de la calidad de la imagen. Revisa siempre el calco sobre el plano.
- Las medidas sacadas de fotos son estimaciones.
- Está en español: interfaz, comandos, guías y código.

## Desarrollo
`AGENTS.md` (en la raíz) recoge la estructura, los comandos y las reglas para cambiar el código. En corto:

```
npm run typecheck    comprobación de tipos
npm test             compila y pasa las pruebas unitarias
npm run e2e          prueba de extremo a extremo (Python 3 con Playwright y Edge)
npm run check        las tres
npm run motores      el .glb en Godot 4 y Blender
```

Las decisiones de diseño están en `docs/` (un plan por ronda) y las pruebas con agentes, en `tests/aceptacion/PROTOCOLO.md`.

## Licencia
MIT (ver `LICENSE`). Incluye three.js (MIT), IBM Plex Sans (SIL OFL 1.1), polygon-clipping y splaytree (MIT), robust-predicates (Unlicense), earcut (ISC) y jpeg-js (BSD-3-Clause); sus avisos van dentro de los archivos generados.
