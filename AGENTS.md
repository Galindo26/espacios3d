# Espacios 3D — instrucciones para agentes de IA (repositorio)

Este repositorio es el código fuente de **Espacios 3D**: una herramienta local para modelar habitaciones, pisos y casas a medida, amueblarlos y verlos en planta y en 3D. `CLAUDE.md` y `GEMINI.md` remiten a este archivo.

Hay dos formas de trabajar aquí. Averigua cuál quiere la persona antes de empezar:

| La persona quiere… | Qué haces |
| :--- | :--- |
| **Usar la herramienta**: construir su casa a partir de un plano o de fotos, colocar muebles, exportar | Sección 1. No tocas el código. |
| **Cambiar la herramienta**: arreglar un fallo, añadir una función | Sección 2. |

## 1. Usar la herramienta

### 1.1. Preparar la carpeta de trabajo (una vez)
1. Hace falta Node.js 18 o posterior (24 para compilar). En la raíz del repositorio: `npm install` y `npm run build`.
2. La compilación deja la herramienta en `dist/Espacios3D/` (y en `dist/Espacios3D.zip`). **No trabajes dentro de `dist/`: cada compilación la borra entera.** Copia `dist/Espacios3D` a una carpeta propia de la persona, fuera del repositorio (por ejemplo `Documentos/MiCasa`), y trabaja ahí.
3. Esa carpeta trae su propio `AGENTS.md` con todos los comandos, y guías en `guias/`. A partir de aquí manda ese archivo: léelo entero. Si la persona puede abrir el agente directamente en esa carpeta, mejor.

Las mismas instrucciones están en el repositorio, por si quieres leerlas antes de compilar: `entrega/AGENTS.md`, `entrega/guias/desde-un-plano.md`, `entrega/guias/muebles-a-medida.md` y `entrega/guias/para-juegos.md`.

### 1.2. Construir el modelo a partir de un plano
Resumen de `guias/desde-un-plano.md`; sigue la guía completa, no este resumen.
1. Copia la imagen del plano (PNG o JPEG, una por planta) **dentro** de la carpeta de trabajo, por ejemplo en `espacios/planos/`. Una imagen de fuera no se acepta.
2. Crea el espacio (`nuevo`) y pon el plano de fondo (`fondo poner`).
3. **Calíbralo con una medida real**: dos puntos de la imagen y su distancia en cm (`fondo calibrar`). Si el plano no tiene cotas, pide una medida a la persona (el ancho de una puerta, el largo de una pared). Sin ella el resultado es una suposición: dilo.
4. Añade una estancia por cada espacio cerrado, también los que no tienen rótulo (pasillo, distribuidor), leyendo las coordenadas en el plano calibrado; después puertas, ventanas, pasos y, si hay varias plantas, las plantas y la escalera.
5. Pinta tu calco encima del plano (`plano --png … --sobre-fondo --rejilla`), míralo y corrige hasta que las paredes coincidan.
6. Pasa la lista final de la guía, comprueba con `analizar --json` (código 0) y enséñaselo con `abrir`.

### 1.3. Usar fotos
- **Fotos de un plano en papel o capturas de pantalla** sirven como plano de fondo, igual que arriba.
- **Fotos de habitaciones o de muebles** no se miden solas: sirven para identificar qué hay y estimar tamaños a partir de algo conocido (una puerta mide unos 80 × 205 cm). Usa las medidas que dé la persona cuando existan y dile cuáles son estimadas.
- Guarda las fotos en `fotos/` junto al espacio y asócialas a su estancia o mueble (`foto agregar`): la persona las ve en la ficha.
- Un mueble con forma propia (un sofá en L, una lámpara) se hace con piezas o con un modelo `.glb`: `guias/muebles-a-medida.md`.

### 1.4. Reglas al usarla
- Cambia los `.espacio.json` con los comandos (o con las herramientas MCP del servidor `espacios3d`, si las tienes), no editando el JSON a mano.
- No des nada por hecho sin `analizar`. Un aviso no es un error: cuéntaselo a la persona.
- No edites `Espacios3D.html` ni `espacios3d.mjs` de la carpeta de trabajo: se generan.

## 2. Cambiar la herramienta

### 2.1. Estructura
```
src/core/     núcleo puro (sin DOM ni three): tipos, validación, geometría, análisis, operaciones, planos, muros, escaleras, exportación
src/app/      la página: plantilla.html, estilos.css, escena (three.js), interfaz, estado, sincronía con el archivo
src/cli/      el comando y el servidor MCP (→ dist/Espacios3D/espacios3d.mjs)
entrega/      se copia tal cual a dist/Espacios3D: AGENTS.md, guías, esquema y ejemplo para quien usa la herramienta
scripts/      build.mjs: genera build/ (para las pruebas) y dist/
tests/unit/   node:test sobre el núcleo, el CLI y el MCP
tests/e2e/    Playwright con Edge sobre file://
tests/aceptacion/   pruebas con agentes: planos, referencias y protocolo
tests/motores/      el .glb en Godot y en Blender
docs/         planes de cada ronda, con las decisiones de diseño
```

### 2.2. Comandos
```
npm install          dependencias de desarrollo, con versión exacta
npm run build        compila build/ y dist/
npm run typecheck    tsc --noEmit
npm test             compila y pasa las pruebas unitarias
npm run e2e          compila y pasa la prueba de extremo a extremo (Python 3 con Playwright y Edge instalado)
npm run check        las tres anteriores
npm run motores      comprueba el .glb en Godot 4 y Blender (necesita los dos instalados, o las variables GODOT y BLENDER)
```
Todo comando de comprobación devuelve un código distinto de 0 si falla.

### 2.3. Invariantes
1. **Sin red:** `Espacios3D.html` no hace ninguna petición http(s)/ws ni carga recursos externos. La e2e falla si registra alguna.
2. **Una sola lógica:** validación, geometría, análisis y operaciones viven sólo en `src/core/`; la página y el CLI la reutilizan.
3. **El formato es contrato:** `formato: "espacios3d"`, `version: 2`. Se rechazan campos desconocidos (salvo `notas`). Un cambio incompatible sube la versión y añade migración y pruebas; la v1 se sigue leyendo.
4. **No pisar a otros escritores:** la página no escribe si el archivo cambió desde su última lectura, y un archivo con errores nunca queda vinculado para guardar.
5. **Entrega sin dependencias ni datos de nadie:** `dist/Espacios3D` funciona sin instalar nada y no lleva rutas, nombres ni datos del ordenador donde se compiló.

### 2.4. Convenciones
- Español en interfaz, documentación, comentarios e identificadores (`agregarMueble`, `contorno`, `giro`).
- TypeScript estricto. El núcleo devuelve espacios nuevos validados y no toca el DOM ni three.
- Geometría (no cambiar sin migración de formato): cm y grados; planta con x a la derecha e y hacia abajo; el contorno es la cara interior de los muros; con giro 0 el frente mira a +y; giro horario visto desde arriba; tolerancia de 0,1 cm.
- Si cambias el CLI o el formato, actualiza a la vez la ayuda del CLI, `entrega/AGENTS.md`, `entrega/LEEME.md`, las guías y el esquema.
- Cada arreglo lleva una prueba que falla sin él. No des un cambio por bueno sin haber ejecutado las comprobaciones; lo que sólo se ve en pantalla, míralo.
- Dependencias nuevas: sólo con motivo, con versión exacta y con su aviso de licencia en `scripts/build.mjs`.
