// CLI de Espacios 3D para agentes y personas: node espacios3d.mjs <comando> <archivo> [opciones]
// Sin dependencias (Node >= 18). Escritura atómica: temporal + renombrado con reintentos en Windows,
// y antes de cada intento se comprueba que nadie más ha cambiado el archivo.
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import * as N from '../core/index.js';
import { codificarPNG, decodificarPNG } from './png.js';
import { cabeceraJPEG, decodificarJPEG } from './jpeg.js';
import { servirMCP } from './mcp.js';
import { escribirPagina, lanzar, limpiarCopiasViejas, MARCA_COPIA, nombreSinExtension, paginaConEspacio, recogerArchivos, rutaCopia, rutaPaginaBase, TOPE_INCRUSTADO, type DatosAbierto } from './abrir.js';

declare const __VERSION__: string;

const SALIDA = { OK: 0, INCIDENCIAS: 1, INVALIDO: 2, USO: 3 } as const;

class ErrorSalida extends Error {
  constructor(
    mensaje: string,
    readonly codigo: number,
    readonly detalles: string[] = [],
  ) {
    super(mensaje);
  }
}

const AYUDA = `Espacios 3D ${__VERSION__} — CLI para crear y ordenar espacios (*.espacio.json)

Uso: node espacios3d.mjs <comando> <archivo> [opciones]      (medidas en cm, giros en grados)

Consultar
  resumen <archivo>                 plantas, estancias con sus muros y huecos, conexiones (qué comunica cada
                                    puerta o paso), fondos, muebles e incidencias
  plano <archivo> [--columnas 72]   plano en texto (letras = muebles, # muro, P puerta, V ventana, _ paso)
  plano <archivo> --svg plano.svg   plano en SVG
  plano <archivo> --imprimible plano.html   plano acotado para imprimir o guardar en PDF desde el navegador:
                                    una hoja A4 apaisada por planta, a escala normalizada (1:20, 1:50…)
  plano <archivo> --png plano.png [--px-por-cm 1] [--rejilla] [--sobre-fondo] [--planta pb]   plano como imagen
                                    para mirarlo (agentes con visión); --rejilla rotula cada metro;
                                    --sobre-fondo lo pinta encima del plano de fondo (PNG o JPEG) para comparar el calco
  describir <archivo> [--planta pb] geometría ya calculada: muros con su orientación, qué hay en cada estancia,
                                    a qué pared está pegado cada mueble y espacio libre (mejor con --json)
  abrir [<archivo>] [--no-lanzar] [--salida pagina.html]   abre Espacios3D.html en el navegador para la persona:
                                    con archivo, una copia de la página con ese espacio ya cargado (y sus planos,
                                    fotos y modelos); la persona guarda al pulsar «Abrir su carpeta». Si cambias
                                    más cosas, vuelve a llamar a «abrir». Sin archivo, la página tal cual (puede
                                    ofrecer el borrador de la última sesión o «Continuar con …»)
  exportar <archivo> --glb casa.glb  modelo 3D para Blender, Godot o Unity (metros, y hacia arriba)
          [--colisiones godot|unreal|generico] [--escena escena.json]   (colisiones con los nombres de ese motor;
          la escena, en JSON, para leerla desde el juego)
  analizar <archivo>                incidencias (sale con 1 si hay errores)
  validar <archivo>                 comprueba el formato (sale con 2 si no es válido)
  catalogo                          tipos de mueble y sus medidas por defecto
                                    (cuadro, espejo, television, balda y aplique van en la pared: «agregar --tipo cuadro»
                                    sin posición lo cuelga en la pared libre más cercana; «--elevacion» cambia la altura)
  mcp [--carpeta <ruta>]            servidor MCP (stdio) con nuevo, describir, aplicar, analizar y plano_png
                                    sobre los .espacio.json de la carpeta (por defecto, la de este archivo)
  muebles listar <carpeta|archivo>  «Mis muebles» de la carpeta (mis-muebles.json): medidas, piezas, modelo
  muebles guardar <archivo> --id sofa [--nombre "Sofá en L"]   guarda ese mueble en «Mis muebles»
  muebles quitar <carpeta|archivo> --nombre "Sofá en L"

Crear y cambiar (cada cambio escribe el archivo y muestra las incidencias que resultan)
  nuevo <archivo> --ancho 350 --largo 300 [--alto 250] [--grosor 10] [--nombre "Dormitorio"] [--forzar]
  estancia <archivo> [--ancho 380 --largo 300] [--alto 250] [--grosor 10]   (ancho y largo: sólo rectangulares;
                                    grosor: muros exteriores de la planta) [--estancia cocina] [--nombre "Cocina"]
          [--circulo-de-giro true|false]   (avisa si no cabe un círculo de giro de 150 cm para silla de ruedas)
          [--suelo liso|parquet|baldosa|moqueta] [--color-suelo b98a5a] [--paredes f2e6d0]   (acabados;
          «ninguno» los quita; el color va sin «#» o entre comillas)
  estancia agregar <archivo> --id cocina [--nombre "Cocina"] (--x 310 --y 110 --ancho 190 --largo 300 |
          --contorno "[[0,0],[300,0],[300,200],[0,200]]") [--alto 250] [--planta pb]
          (la esquina x, y es la de arriba a la izquierda; entre estancias, deja el grosor del tabique)
  estancia contorno <archivo> --estancia cocina --contorno "[[0,0],[300,0],[300,200],[0,200]]"
  estancia quitar <archivo> --id cocina
  fondo poner <archivo> --imagen planos/piso.png [--id plano] [--escala 1] [--x 0 --y 0] [--opacidad 0.5]
          (la imagen, dentro de la carpeta del .espacio.json; la ruta vale desde aquí o desde esa carpeta;
          escala = cm por píxel: con 1, recién puesta, cm = píxel)
  fondo calibrar <archivo> --id plano --puntos "x1,y1,x2,y2" --distancia 350 [--en "0,0"]
          (dos puntos de la imagen, en píxeles, que en la realidad están a esa distancia en cm;
          con --en, el primer punto va a ese punto de la planta)
  fondo editar <archivo> --id plano [--x --y --giro --opacidad --escala]    fondo quitar <archivo> --id plano
  renombrar <archivo> --nombre "Dormitorio"
  agregar <archivo> --tipo escritorio [--ancho 120 --fondo 60 --alto 75] [--id mesa] [--nombre "Mesa"]
          (--x 200 --y 40 [--giro 0] | --muro 0 --desde 120 [--separacion 0])
          [--elevacion 0] [--color b89a74] [--bloqueado true] [--holgura-frente 70] [--hueco-inferior 65]
          [--piezas '[{"forma":"caja","ancho":200,"fondo":90,"alto":42}, ...]'] [--modelo modelos/sofa.glb]
          [--mio "Sofá en L"]  (uno de «Mis muebles», con sus medidas, piezas y modelo; lo demás lo cambia)
          (piezas: caja, cilindro, esfera o cuna, en cm del mueble: x a lo ancho, y hacia el frente,
          z hacia arriba, desde el centro de la base; tienen que caber en el mueble)
  mover <archivo> --id cama (--x 175 --y 100 | --dx 10 --dy -5 | --muro 2 --desde 40 [--separacion 0])
  girar <archivo> --id cama (--giro 90 | --sumar 15)
  editar <archivo> --id cama [--nombre --tipo --ancho --fondo --alto --elevacion --color --bloqueado false ...]
          [--piezas '[...]' | --piezas null] [--modelo modelos/cama.glb | '{"archivo":"m.glb","giro":90,"ajuste":"modelo"}' | --modelo ninguno]
  quitar <archivo> --id cama
  pegar-pared <archivo> --id armario [--muro 2]
  planta agregar <archivo> (--copiar-de <id de planta> [--con-ventanas true] | --x 0 --y 0 --ancho 400 --largo 300 | --contorno ...)
          [--id p1] [--nombre "Primera"] [--nivel 280] [--alto 250]   (nivel: cota del suelo en cm; por
          defecto, encima de la más alta con 30 cm de forjado; todas las plantas comparten el origen x, y)
  planta editar <archivo> --id p1 [--nombre --nivel]       planta quitar <archivo> --id p1 (con todo lo suyo)
  escalera agregar <archivo> --x 300 --y 120 --ancho 90 --largo 330 [--giro 0] [--planta pb] [--hasta p1] [--peldanos 16]
          (x, y: centro del borde del pie; giro 0 sube hacia +y; por defecto llega a la planta de encima)
          escalera en L o de dos tramos: --forma L|U --tramos 300,120 --gira derecha|izquierda [--ojo 10]
          (gira: la mano de quien sube; con giro 0, «derecha» es hacia −x en el plano)
          de caracol: --forma caracol --ancho 70 --gira derecha|izquierda [--poste 20] [--vuelta 360]
          (ancho: el del peldaño, del poste a la barandilla; vuelta: grados de pie a llegada; el centro
          queda a la mano de giro). Una escalera puede arrancar en la planta a la que llega otra, encima
          de su hueco (caja de escalera), si el pie da a suelo firme y hay 200 cm libres entre las dos.
          El hueco de arriba es sólo la parte sin 200 cm libres bajo el techo; bajo la parte alta caben
          muebles (si no llegan a la cara inferior) y se pasa por debajo.
  escalera editar <archivo> --id escalera [--x --y --giro --forma --largo --tramos --poste --vuelta ...]   escalera quitar <archivo> --id escalera
  foto agregar|quitar <archivo> --para cama --foto fotos/cama.jpg   (fotos de una estancia o de un mueble,
          relativas al .espacio.json; agregar exige que exista; la página las enseña en su ficha)
  tabique mover <archivo> --estancia salon --muro 1 --distancia 20   (hacia fuera; negativa, hacia dentro;
          mueve también la pared de la estancia vecina que da a ella y el tabique conserva su grosor)
  hueco agregar <archivo> --tipo puerta|ventana|paso --muro 3 --desde 40 --ancho 80 [--alto 205]
          [--antepecho 90] [--abre dentro|fuera|corredera] [--bisagra inicio|fin] [--id puerta]
  hueco quitar <archivo> --id puerta
  elemento agregar <archivo> --forma exento|adosado|punto|viga [--tipo columna] [--id c1] [--estancia salon]
          exento: --x --y --ancho [--fondo] [--giro] [--redondo true] [--alto] [--elevacion]   (columna, escalón…)
          adosado: --muro --desde --ancho --fondo [--alto] [--elevacion]   (pilar, radiador, chimenea…)
          punto: --muro --desde --altura   (enchufe, interruptor, toma)
          viga: --de "0,150" --a "400,150" [--ancho 20] [--canto 25]
          (sin --alto, exentos y adosados llegan al techo; --tipo radiador, enchufe o escalon dan avisos propios)
  elemento editar <archivo> --id c1 [--x --y --ancho ...]      elemento quitar <archivo> --id c1
  faldon poner <archivo> --muro 0 --altura-en-muro 120 --alcance 200 [--estancia buhardilla]
          (techo inclinado: junto a ese muro está a 120 cm y sube hasta la altura de la estancia en 200 cm)
  faldon quitar <archivo> --muro 0 [--estancia buhardilla]
  distribucion guardar|aplicar|quitar <archivo> --nombre "Estudio"
  distribucion listar <archivo>
  aplicar <archivo> --ops ops.json  lote atómico (todo o nada); --ops - lo lee de la entrada estándar
          [{"op":"agregar","tipo":"silla","x":100,"y":80}, {"op":"mover","id":"cama","muro":1,"desde":20}]
          op = agregar, mover, girar, editar, quitar, pegar-pared, hueco-agregar, hueco-quitar,
          distribucion-guardar, distribucion-aplicar, distribucion-quitar, estancia, renombrar;
          claves en camelCase (holguraFrente, huecoInferior, grosorMuros)

Varias estancias o plantas
  --estancia <id> en agregar, mover --muro, hueco agregar y estancia dice de qué estancia se habla
  (sin ella, la primera); --planta <id> en agregar, la planta del mueble. Ids en «resumen».

Versiones del formato
  Un archivo de la versión 1 se lee convertido a la 2. El primer cambio lo escribe en la 2 y deja
  al lado el original como X.v1.espacio.json (o X.v1-2.espacio.json si ya había otra copia distinta).

Opciones comunes
  --json                 salida JSON en ASCII. Recomendado para agentes: en Windows la salida de texto
                         puede verse con caracteres raros según la consola
  --simular              calcula el resultado y las incidencias sin escribir
  --exigir-sin-errores   no escribe si el resultado tiene incidencias de error

Convenciones
  Planta con x a la derecha e y hacia abajo; el contorno es la cara interior de los muros.
  (x, y) es el centro del mueble; con giro 0 su frente mira a +y; el giro es horario visto desde arriba.
  Muro i = del vértice i al i+1 (en la página se llama «Pared i+1»); «desde» = cm desde el vértice
  inicial del muro. Con --muro el mueble queda con la trasera contra ese muro y el frente hacia dentro.
  Textos con tildes: entre comillas dobles. En ops.json, si el editor no guarda en UTF-8, usa \\u00f3.
  El color, sin «#» o entre comillas: --color b89a74 o --color "#b89a74".

Incidencias: «error» es un choque o algo imposible; «aviso», algo a revisar (poco espacio delante de
un mueble, una ventana tapada). «Sin que choque» = sin errores: un aviso no obliga a cambiar lo
pedido; cúmplelo, cuenta el aviso y propone cómo evitarlo.

Salida: 0 bien · 1 el resultado tiene incidencias de error (el cambio se escribe salvo con
--exigir-sin-errores) · 2 archivo no válido · 3 error de uso, de archivo o el archivo cambió mientras
se editaba (vuelve a ejecutar).`;

// ---------- Argumentos ----------

const BANDERAS = new Set(['json', 'simular', 'exigir-sin-errores', 'forzar', 'rejilla', 'sobre-fondo', 'no-lanzar', 'ayuda', 'help', 'h']);
const NUMERICAS = new Set([
  'ancho', 'fondo', 'alto', 'x', 'y', 'dx', 'dy', 'giro', 'sumar', 'muro', 'desde', 'separacion', 'elevacion',
  'holguraFrente', 'huecoInferior', 'antepecho', 'largo', 'grosorMuros', 'columnas', 'escala', 'pxPorCm', 'anchoPx', 'altoPx', 'opacidad', 'distancia',
  'altura', 'canto', 'alturaEnMuro', 'alcance', 'nivel', 'peldanos', 'ojo', 'poste', 'vuelta',
]);
const OPCIONES_CLI = new Set(['json', 'simular', 'exigirSinErrores', 'forzar', 'svg', 'png', 'imprimible', 'glb', 'colisiones', 'escena', 'pxPorCm', 'rejilla', 'sobreFondo', 'imagen', 'ops', 'columnas', 'salida', 'noLanzar', 'ayuda', 'help', 'h']);
/** Opciones de CLI que admite cada comando (además de --json); el resto se rechaza. */
const CLI_POR_COMANDO: Record<string, string[]> = {
  nuevo: ['forzar'],
  plano: ['svg', 'png', 'pxPorCm', 'rejilla', 'sobreFondo', 'columnas', 'imprimible'],
  exportar: ['glb', 'colisiones', 'escena'],
  describir: [],
  abrir: ['salida', 'noLanzar', 'forzar'],
  aplicar: ['ops', 'simular', 'exigirSinErrores'],
  mutacion: ['simular', 'exigirSinErrores'],
};
const ALIAS: Record<string, string> = { grosor: 'grosorMuros' };

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

interface Args {
  pos: string[];
  op: Record<string, unknown>;
  cli: Record<string, unknown>;
}

function textoDañado(s: string): boolean {
  return s.includes('�');
}

const PISTA_CODIFICACION =
  'El texto llega con caracteres dañados (�): la consola o el editor no usan UTF-8. Escribe las tildes con escapes \\u00e1 en un ops.json guardado en UTF-8 o usa nombres sin tildes.';

/** Ancho y alto en píxeles de un PNG o un JPEG tal como se ven (con la orientación EXIF aplicada). */
function tamanoImagen(b: Buffer): { ancho: number; alto: number } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
  const j = cabeceraJPEG(b);
  if (!j) return null;
  // Orientaciones 5 a 8: la foto se ve girada 90°, con ancho y alto cambiados.
  return j.orientacion >= 5 && j.orientacion <= 8 ? { ancho: j.alto, alto: j.ancho } : { ancho: j.ancho, alto: j.alto };
}

/** «fondo poner --imagen x»: ruta relativa a la carpeta del .espacio.json y tamaño en píxeles. */
function datosImagen(rutaEspacio: string, imagen: unknown): { archivo: string; anchoPx: number; altoPx: number } {
  if (typeof imagen !== 'string') throw new ErrorSalida('«fondo poner» necesita --imagen planos/piso.png (PNG o JPEG, dentro de la carpeta del .espacio.json)', SALIDA.USO);
  // La ruta vale desde el directorio actual o desde la carpeta del .espacio.json.
  const carpeta = dirname(resolve(rutaEspacio));
  let absoluta = resolve(imagen);
  if (!existsSync(absoluta) && existsSync(join(carpeta, imagen))) absoluta = join(carpeta, imagen);
  // Con las mayúsculas reales del disco: en Linux y en muchos Mac importan.
  try {
    absoluta = realpathSync.native(absoluta);
  } catch {
    /* no existe: el error sale al leerla */
  }
  let base = carpeta;
  try {
    base = realpathSync.native(carpeta);
  } catch {
    /* la carpeta del espacio existe si se pudo leer el espacio */
  }
  const archivo = relative(base, absoluta).split(sep).join('/');
  const malo = N.rutaRelativaValida(archivo);
  if (malo) throw new ErrorSalida(`La imagen tiene que estar dentro de la carpeta del .espacio.json (o en una subcarpeta), para que viaje con él: ${malo}`, SALIDA.USO);
  let bytes: Buffer;
  try {
    bytes = readFileSync(absoluta);
  } catch (e) {
    throw new ErrorSalida(`No se puede leer «${imagen}»: ${(e as Error).message}`, SALIDA.USO);
  }
  const t = tamanoImagen(bytes);
  if (!t) throw new ErrorSalida(`«${imagen}» no es un PNG ni un JPEG`, SALIDA.USO);
  return { archivo, anchoPx: t.ancho, altoPx: t.alto };
}

/** Lee y decodifica los fondos (PNG o JPEG) de una planta para pintarlos debajo del plano. */
function leerFondos(rutaEspacio: string, p: N.Planta): Record<string, { rgba: Uint8Array; ancho: number; alto: number }> {
  if (!p.fondos?.length) throw new ErrorSalida(`La planta «${p.id}» no tiene fondos: ponlo antes con «fondo poner»`, SALIDA.USO);
  const res: Record<string, { rgba: Uint8Array; ancho: number; alto: number }> = {};
  for (const f of p.fondos) {
    const ruta = join(dirname(resolve(rutaEspacio)), ...f.archivo.split('/'));
    let bytes: Buffer;
    try {
      const base = realpathSync.native(dirname(resolve(rutaEspacio)));
      const real = realpathSync.native(ruta);
      if (!real.startsWith(base + sep)) throw new Error('queda fuera de la carpeta del .espacio.json (por un enlace)');
      bytes = readFileSync(real);
    } catch (e) {
      throw new ErrorSalida(`No se puede leer el fondo «${f.id}» (${f.archivo}): ${(e as Error).message}`, SALIDA.USO);
    }
    try {
      res[f.id] = bytes[0] === 0xff && bytes[1] === 0xd8 ? decodificarJPEG(bytes) : decodificarPNG(bytes);
    } catch (e) {
      throw new ErrorSalida(`El fondo «${f.id}» (${f.archivo}) no se puede pintar: ${(e as Error).message}. --sobre-fondo lee PNG de 8 bits y JPEG.`, SALIDA.USO);
    }
  }
  return res;
}

/** Saca «--planta» de las opciones de operación (en plano, describir y exportar no es de mueble). */
function tomarPlanta(op: Record<string, unknown>): string | undefined {
  const v = op.planta;
  delete op.planta;
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new ErrorSalida('--planta necesita el id de una planta', SALIDA.USO);
  return v;
}

function parsear(argv: string[]): Args {
  const pos: string[] = [];
  const op: Record<string, unknown> = {};
  const cli: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (textoDañado(a)) throw new ErrorSalida(PISTA_CODIFICACION, SALIDA.USO);
    if (!a.startsWith('--') && a !== '-h') {
      pos.push(a);
      continue;
    }
    let nombre = a.replace(/^-+/, '');
    let enLinea: string | undefined;
    const igual = nombre.indexOf('=');
    if (igual > 0) {
      enLinea = nombre.slice(igual + 1);
      nombre = nombre.slice(0, igual);
    }
    const clave = ALIAS[camel(nombre)] ?? camel(nombre);
    let valor: unknown = true;
    if (!BANDERAS.has(nombre)) {
      const v = enLinea ?? argv[++i];
      if (v === undefined || (enLinea === undefined && v.startsWith('--'))) {
        const pista = clave === 'color' ? ' (¿«#» sin comillas? En bash y PowerShell «#» empieza un comentario: usa --color b89a74 o --color "#b89a74")' : '';
        throw new ErrorSalida(`Falta el valor de --${nombre}${pista}`, SALIDA.USO);
      }
      if (NUMERICAS.has(clave)) {
        const n = Number(v.replace(',', '.'));
        if (!Number.isFinite(n) || v.trim() === '') throw new ErrorSalida(`--${nombre} debe ser un número (recibido «${v}»)`, SALIDA.USO);
        valor = n;
      } else if (clave === 'bloqueado' || clave === 'redondo' || clave === 'conVentanas' || clave === 'circuloDeGiro') {
        if (v !== 'true' && v !== 'false') throw new ErrorSalida(`--${nombre} debe ser true o false`, SALIDA.USO);
        valor = v === 'true';
      } else if ((clave === 'color' || clave === 'colorSuelo' || clave === 'paredes') && /^[0-9a-fA-F]{6}$/.test(v)) valor = `#${v}`;
      else if ((clave === 'suelo' || clave === 'colorSuelo' || clave === 'paredes') && v === 'ninguno') valor = null;
      else if (clave === 'tramos') {
        // --tramos 300,200 (o [300,200]): los largos de los dos tramos de una escalera en L o en U.
        const ns = v.replace(/[[\]\s]/g, '').split(/[,;]/).map((x) => Number(x));
        if (ns.length !== 2 || ns.some((n) => !Number.isFinite(n))) throw new ErrorSalida(`--tramos necesita dos números: --tramos 300,200 (recibido «${v}»)`, SALIDA.USO);
        valor = ns;
      } else if (clave === 'piezas' || (clave === 'modelo' && /^\s*[{\[]|^(null|ninguno)$/.test(v))) {
        // --piezas '[{"forma":"caja",...}]' (o null); --modelo modelos/sofa.glb, '{"archivo":...}' o ninguno.
        if (v === 'ninguno' || v === 'null') valor = null;
        else {
          try {
            valor = JSON.parse(v);
          } catch (e) {
            throw new ErrorSalida(`--${nombre} no es JSON válido: ${(e as Error).message}. En PowerShell, ponlo entre comillas simples o pásalo en un lote (--ops archivo.json)`, SALIDA.USO);
          }
        }
      } else valor = v;
    } else if (enLinea !== undefined) throw new ErrorSalida(`--${nombre} no lleva valor`, SALIDA.USO);
    (OPCIONES_CLI.has(clave) ? cli : op)[clave] = valor;
  }
  return { pos, op, cli };
}

function exigirArgumentos(pos: string[], n: number, uso: string): void {
  if (pos.length > n) {
    throw new ErrorSalida(
      `Sobra «${pos.slice(n).join(' ')}». Uso: ${uso}. Si es un texto con espacios, ponlo entre comillas dobles (en cmd las simples no agrupan).`,
      SALIDA.USO,
    );
  }
}

function exigirOpcionesCli(cli: Record<string, unknown>, permitidas: string[], comando: string): void {
  for (const k of Object.keys(cli)) {
    if (k !== 'json' && !permitidas.includes(k)) throw new ErrorSalida(`«${comando}» no admite --${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, SALIDA.USO);
  }
}

// ---------- Archivo ----------

/** Decodifica según la marca de orden de bytes (UTF-8, UTF-16 LE/BE); sin marca, UTF-8. */
function decodificar(b: Buffer): string {
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b[0] === 0xfe && b[1] === 0xff) {
    const c = Buffer.from(b.subarray(2));
    c.swap16();
    return c.toString('utf16le');
  }
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  return b.toString('utf8');
}

interface Leido {
  espacio: N.Espacio;
  /** Bytes tal cual se leyeron: antes de escribir se comprueba que siguen igual. */
  original: Buffer;
  /** El archivo era de la v1: al escribir se convierte a v2 y se deja una copia de la v1. */
  migradoDesde?: 1;
  /** Avisos de la lectura (p. ej., ids renombrados al convertir la v1). */
  avisos: string[];
}

function leerBytes(ruta: string): Buffer {
  try {
    return readFileSync(ruta);
  } catch (e) {
    throw new ErrorSalida(`No se puede leer «${ruta}»: ${(e as Error).message}`, SALIDA.USO);
  }
}

function leer(ruta: string): Leido {
  const original = leerBytes(ruta);
  const texto = decodificar(original);
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch (e) {
    throw new ErrorSalida(`«${ruta}» no es JSON válido: ${(e as Error).message}`, SALIDA.INVALIDO);
  }
  const r = N.validar(datos);
  if (!r.ok) throw new ErrorSalida(`«${ruta}» no es un espacio válido`, SALIDA.INVALIDO, r.errores);
  return { espacio: r.espacio, original, avisos: r.avisos, ...(r.migradoDesde ? { migradoDesde: r.migradoDesde } : {}) };
}

function esperar(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function conflicto(ruta: string): ErrorSalida {
  return new ErrorSalida(`«${ruta}» cambió mientras se editaba (¿la página u otro agente?). No se ha escrito nada: vuelve a ejecutar el comando.`, SALIDA.USO);
}

/**
 * Escritura atómica: temporal en la misma carpeta y renombrado. Antes de cada intento de
 * renombrado se comprueba que el contenido sigue siendo el que se leyó (`original`; null si el
 * archivo es nuevo y no debe existir).
 */
function escribir(ruta: string, texto: string, original: Buffer | null): void {
  const tmp = `${ruta}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, texto, 'utf8');
  try {
    for (let intento = 0; ; intento++) {
      let ahora: Buffer | null;
      try {
        ahora = existsSync(ruta) ? readFileSync(ruta) : null;
      } catch (e) {
        const codigo = (e as NodeJS.ErrnoException).code;
        if ((codigo === 'EPERM' || codigo === 'EBUSY' || codigo === 'EACCES') && intento < 20) {
          esperar(100);
          continue;
        }
        throw new ErrorSalida(`No se puede leer «${ruta}» para comprobarlo: ${(e as Error).message}`, SALIDA.USO);
      }
      if (original === null ? ahora !== null && intento > 0 : !ahora || !ahora.equals(original)) throw conflicto(ruta);
      try {
        renameSync(tmp, ruta);
        return;
      } catch (e) {
        const codigo = (e as NodeJS.ErrnoException).code;
        // En Windows la página, el antivirus o el indexador pueden tener el archivo abierto un instante.
        if ((codigo === 'EPERM' || codigo === 'EBUSY' || codigo === 'EACCES') && intento < 20) {
          esperar(100);
          continue;
        }
        throw new ErrorSalida(`No se pudo escribir «${ruta}»: ${(e as Error).message}`, SALIDA.USO);
      }
    }
  } finally {
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp);
      } catch {
        /* temporal huérfano: no afecta al archivo */
      }
    }
  }
}

// ---------- Salida ----------

function ascii(obj: unknown): string {
  return JSON.stringify(obj, null, 2).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function lineasIncidencias(inc: readonly N.Incidencia[]): string[] {
  if (!inc.length) return ['Sin incidencias.'];
  return [`Incidencias (${inc.length}):`, ...inc.map((i) => `  [${i.gravedad}] ${i.mensaje}`)];
}

function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Puertas y pasos de una planta con lo que comunican (otra estancia o el exterior), del modelo de muros. */
function conexionesDe(p: N.Planta): N.Conexion[] {
  try {
    return N.modeloPlanta(p).conexiones;
  } catch (e) {
    if (e instanceof N.ErrorGeometria) return [];
    throw e;
  }
}

function resumenJSON(e: N.Espacio): Record<string, unknown> {
  return {
    nombre: e.nombre,
    version: e.version,
    plantas: e.plantas.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      nivel: p.nivel,
      grosorExterior: p.grosorExterior,
      estancias: p.estancias.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        altura: s.altura,
        area_m2: Math.round(N.area(s.contorno) / 100) / 100,
        muros: s.contorno.map((_, i) => {
          const [a, b] = N.muro(s.contorno, i);
          return { muro: i, de: a, a: b, longitud: redondear(N.longitudMuro(s.contorno, i)) };
        }),
        huecos: s.huecos,
        elementos: s.elementos ?? [],
        faldones: s.faldones ?? [],
      })),
      muebles: p.muebles.map((m) => ({ ...m, estancia: N.estanciaDeMueble(p, m)?.id ?? null })),
      conexiones: conexionesDe(p),
      fondos: p.fondos ?? [],
    })),
    distribuciones: e.distribuciones.map((d) => d.nombre),
    incidencias: N.analizar(e),
  };
}

function resumenTexto(e: N.Espacio): string[] {
  const l: string[] = [];
  const variasPlantas = e.plantas.length > 1;
  l.push(`«${e.nombre}»: ${e.plantas.length} planta${variasPlantas ? 's' : ''}, ${e.plantas.reduce((n, p) => n + p.estancias.length, 0)} estancias`);
  if (!variasPlantas) l.push(`Planta ${e.plantas[0]!.id} «${e.plantas[0]!.nombre}» (para «planta agregar --copiar-de ${e.plantas[0]!.id}»)`);
  for (const p of e.plantas) {
    if (variasPlantas) l.push(`Planta ${p.id} «${p.nombre}» (nivel ${p.nivel} cm):`);
    for (const s of p.estancias) {
      const c = s.contorno;
      const caja = N.cajaContorno(c);
      const rect = N.esRectangular(e, s.id);
      l.push(`Estancia ${s.id} «${s.nombre}»: ${rect ? `${rect.ancho} x ${rect.largo} cm` : `contorno de ${c.length} muros (caja ${caja.maxX - caja.minX} x ${caja.maxY - caja.minY} cm)`}, alto ${s.altura} cm, ${Math.round(N.area(c) / 100) / 100} m2`);
      c.forEach((_, i) => {
        const [a, b] = N.muro(c, i);
        l.push(`  muro ${i}: (${a[0]}, ${a[1]}) -> (${b[0]}, ${b[1]}), ${redondear(N.longitudMuro(c, i))} cm`);
      });
      for (const el of s.elementos ?? []) l.push(`  ${N.describirElemento(el)}`);
      for (const f of s.faldones ?? []) l.push(`  techo inclinado: junto al muro ${f.muro} a ${f.alturaEnMuro} cm, sube hasta ${s.altura} cm en ${f.alcance} cm`);
      for (const h of s.huecos) {
        l.push(`  ${h.tipo} «${h.id}»: muro ${h.muro}, desde ${h.desde}, ancho ${h.ancho}${h.tipo === 'ventana' ? `, antepecho ${h.antepecho}` : ''}${h.tipo === 'puerta' ? `, abre ${h.abre}, bisagra ${h.bisagra}` : ''}`);
      }
    }
    const conexiones = conexionesDe(p);
    if (conexiones.length) l.push(`Conexiones: ${conexiones.map((c) => `${c.hueco} (${c.tipo}) ${c.de} <-> ${c.a}`).join('; ')}`);
    l.push(`Muebles (${p.muebles.length}):`);
    for (const m of p.muebles) {
      const est = N.estanciaDeMueble(p, m);
      l.push(`  ${m.id} «${m.nombre}» ${m.tipo} ${m.ancho}x${m.fondo}x${m.alto} en (${m.x}, ${m.y}) giro ${m.giro}°${m.elevacion ? ` elevación ${m.elevacion}` : ''}${m.bloqueado ? ' [bloqueado]' : ''}${p.estancias.length > 1 ? ` en ${est?.id ?? '(fuera)'}` : ''}`);
    }
  }
  if (e.distribuciones.length) l.push(`Distribuciones: ${e.distribuciones.map((d) => `«${d.nombre}»`).join(', ')}`);
  l.push(...lineasIncidencias(N.analizar(e)));
  return l;
}

// ---------- Comandos ----------

function archivoDe(pos: string[], i: number, comando: string): string {
  const a = pos[i];
  if (!a) throw new ErrorSalida(`«${comando}» necesita la ruta del archivo .espacio.json`, SALIDA.USO);
  return a;
}

function sinOpcionesDeMueble(op: Record<string, unknown>, comando: string): void {
  const sobra = Object.keys(op);
  if (sobra.length) throw new ErrorSalida(`«${comando}» no admite --${sobra.join(', --')}`, SALIDA.USO);
}

/**
 * Copia del original de la v1 junto al archivo: «X.v1.espacio.json» o, si ya hay una copia distinta
 * con ese nombre, «X.v1-2.espacio.json» y siguientes. Devuelve la frase para el usuario.
 */
function guardarCopiaV1(ruta: string, original: Buffer): string {
  const base = ruta.replace(/(\.espacio)?\.json$/i, '');
  for (let i = 1; ; i++) {
    const copia = `${base}.v1${i === 1 ? '' : `-${i}`}.espacio.json`;
    if (!existsSync(copia)) {
      writeFileSync(copia, original, { flag: 'wx' });
      return `copia de la versión 1 en ${copia}`;
    }
    if (readFileSync(copia).equals(original)) return `la copia de la versión 1 ya estaba en ${copia}`;
  }
}

/** Aplica una mutación y escribe (salvo --simular, --exigir-sin-errores con errores o sin cambios). */
interface ResultadoMutacion {
  escrito: boolean;
  sinCambios: boolean;
  bloquear: boolean;
  errores: number;
  notas: string[];
  incidencias: N.Incidencia[];
}

/** Aplica un cambio al archivo con la escritura segura (sin imprimir nada: lo usan el CLI y el MCP). */
function mutarArchivo(ruta: string, opciones: { simular?: boolean; exigirSinErrores?: boolean }, f: (e: N.Espacio) => { espacio: N.Espacio; notas: string[] }): ResultadoMutacion {
  const { espacio, original, migradoDesde, avisos } = leer(ruta);
  let r: { espacio: N.Espacio; notas: string[] };
  try {
    r = f(espacio);
  } catch (e) {
    if (e instanceof N.ErrorOperacion) throw new ErrorSalida(e.message, SALIDA.USO);
    throw e;
  }
  const inc = N.analizar(r.espacio);
  const errores = inc.filter((i) => i.gravedad === 'error').length;
  const bloquear = errores > 0 && opciones.exigirSinErrores === true;
  const texto = N.aJSON(r.espacio);
  const sinCambios = texto === N.aJSON(espacio);
  const escrito = !opciones.simular && !bloquear && !sinCambios;
  if (escrito && migradoDesde === 1) {
    // Antes de convertir a v2 se guarda el original tal cual (las versiones anteriores de la
    // herramienta no leen la v2), sin pisar nunca otra copia distinta.
    r.notas.push(`archivo convertido al formato v2; ${guardarCopiaV1(ruta, original)}`, ...avisos);
  } else if (migradoDesde === 1) {
    // Sin escribir (--simular, sin cambios o bloqueado): se avisa de lo que pasará al escribir.
    r.notas.push('el archivo es de la versión 1: al escribir se convertirá al formato v2 (con copia de la versión 1)', ...avisos);
  }
  if (escrito) escribir(ruta, texto, original);
  return { escrito, sinCambios, bloquear, errores, notas: r.notas, incidencias: inc };
}

function mutar(ruta: string, cli: Record<string, unknown>, f: (e: N.Espacio) => { espacio: N.Espacio; notas: string[] }): number {
  const { escrito, sinCambios, bloquear, errores, notas, incidencias: inc } = mutarArchivo(ruta, { simular: cli.simular === true, exigirSinErrores: cli.exigirSinErrores === true }, f);
  const r = { notas };
  if (cli.json) {
    console.log(ascii({ ok: errores === 0, escrito, sinCambios, archivo: ruta, cambios: r.notas, errores, incidencias: inc }));
  } else {
    for (const n of r.notas) console.log(n);
    console.log(lineasIncidencias(inc).join('\n'));
    console.log(
      escrito
        ? `Guardado en ${ruta}.${errores ? ` Quedan ${errores} incidencias de error.` : ''}`
        : sinCambios
          ? 'Sin cambios: no se ha escrito nada.'
          : bloquear
            ? 'No se ha escrito: el resultado tiene errores (--exigir-sin-errores).'
            : 'Simulación: no se ha escrito nada.',
    );
  }
  return errores ? SALIDA.INCIDENCIAS : SALIDA.OK;
}

function leerOps(fuente: string): unknown {
  let texto: string;
  try {
    texto = decodificar(fuente === '-' ? readFileSync(0) : readFileSync(fuente));
  } catch (e) {
    throw new ErrorSalida(`No se pueden leer las operaciones: ${(e as Error).message}`, SALIDA.USO);
  }
  if (textoDañado(texto)) throw new ErrorSalida(PISTA_CODIFICACION, SALIDA.USO);
  try {
    return JSON.parse(texto);
  } catch (e) {
    throw new ErrorSalida(`Las operaciones no son JSON válido: ${(e as Error).message}. Guarda el archivo en UTF-8 (o UTF-16 con marca).`, SALIDA.USO);
  }
}

/** Carpeta de «Mis muebles»: la indicada o la del archivo indicado (que tienen que existir). */
function carpetaDe(ruta: string): string {
  if (!existsSync(ruta)) throw new ErrorSalida(`No existe «${ruta}»: indica la carpeta de trabajo o un .espacio.json de ella`, SALIDA.USO);
  return /\.json$/i.test(ruta) ? dirname(resolve(ruta)) : ruta;
}

/**
 * «agregar» con `mio`: parte del mueble guardado en «Mis muebles» de la carpeta; lo demás de la
 * operación lo cambia. Sirve para el CLI (--mio), los lotes (aplicar --ops) y el MCP.
 */
function expandirMios(ops: unknown, carpeta: string, enLote = true): unknown {
  if (!Array.isArray(ops) || !ops.some((o) => o && typeof o === 'object' && 'mio' in o)) return ops;
  const { lista } = leerMisMuebles(carpeta);
  const donde = (i: number): string => (enLote ? `Operación ${i}: ` : '');
  return ops.map((o, i) => {
    if (!o || typeof o !== 'object' || !('mio' in o)) return o;
    const { mio, ...resto } = o as Record<string, unknown>;
    if (resto.op !== 'agregar' || typeof mio !== 'string') throw new ErrorSalida(`${donde(i)}«mio» va con «agregar» y el nombre de uno de «Mis muebles»`, SALIDA.USO);
    const g = N.buscarEnMisMuebles(lista, mio);
    if (!g) throw new ErrorSalida(`${donde(i)}${enLote ? 'no' : 'No'} hay «${mio}» en «Mis muebles». Hay: ${lista.muebles.map((x) => x.nombre).join(', ') || '(ninguno)'}`, SALIDA.USO);
    return { ...g, ...resto };
  });
}

/** Avisos de modelos .glb que no están junto al archivo (el espacio es válido, pero se verá la forma genérica). */
function avisosModelos(e: N.Espacio, ruta: string): string[] {
  const dir = dirname(resolve(ruta));
  const faltan = new Set<string>();
  for (const p of e.plantas) for (const m of p.muebles) if (m.modelo && !existsSync(join(dir, m.modelo.archivo))) faltan.add(m.modelo.archivo);
  return [...faltan].map((a) => `aviso: no existe ${a} junto al archivo; hasta que esté, se verá la forma genérica`);
}

/** Fotos asociadas que no están junto al archivo (R4-3): se avisa, no se impide. */
function avisosFotos(e: N.Espacio, ruta: string): string[] {
  const dir = dirname(resolve(ruta));
  return N.fotosDe(e).filter((f) => !existsSync(join(dir, f))).map((f) => `aviso: no existe ${f} junto al archivo; la foto se verá como «no está»`);
}

function leerMisMuebles(carpeta: string): { lista: N.MisMuebles; ruta: string; original: Buffer | null } {
  const ruta = join(carpeta, N.ARCHIVO_MIS_MUEBLES);
  if (!existsSync(ruta)) return { lista: N.misMueblesVacio(), ruta, original: null };
  const original = readFileSync(ruta);
  let datos: unknown;
  try {
    datos = JSON.parse(decodificar(original));
  } catch (e) {
    throw new ErrorSalida(`«${ruta}» no es JSON válido: ${(e as Error).message}`, SALIDA.INVALIDO);
  }
  const r = N.validarMisMuebles(datos);
  if (!r.ok) throw new ErrorSalida(`«${ruta}» tiene errores`, SALIDA.INVALIDO, r.errores);
  return { lista: r.misMuebles, ruta, original };
}

function describirGuardado(m: N.MuebleGuardado): string {
  const extra = [m.piezas?.length ? `${m.piezas.length} piezas` : '', m.modelo ? `modelo ${m.modelo.archivo}` : ''].filter(Boolean).join(', ');
  return `«${m.nombre}» ${m.tipo} ${m.ancho}x${m.fondo}x${m.alto} cm ${m.color}${extra ? `, ${extra}` : ''}`;
}

function principal(argv: string[]): number {
  const { pos, op, cli } = parsear(argv);
  const comando = pos[0];
  if (!comando || cli.ayuda || cli.help || cli.h || comando === 'ayuda') {
    console.log(AYUDA);
    return comando || cli.ayuda || cli.help || cli.h ? SALIDA.OK : SALIDA.USO;
  }
  // «estancia agregar|quitar|contorno <archivo>» son subórdenes; «estancia <archivo> --ancho ...» edita una estancia.
  const subEstancia = comando === 'estancia' && ['agregar', 'quitar', 'contorno'].includes(pos[1] ?? '');
  switch (subEstancia ? 'estancia-sub' : comando) {
    case 'version':
    case 'catalogo': {
      exigirArgumentos(pos, 1, comando);
      exigirOpcionesCli(cli, [], comando);
      sinOpcionesDeMueble(op, comando);
      if (comando === 'version') console.log(cli.json ? ascii({ version: __VERSION__ }) : __VERSION__);
      else if (cli.json) console.log(ascii(N.CATALOGO));
      else for (const t of N.CATALOGO) console.log(`${t.tipo.padEnd(11)} ${t.etiqueta.padEnd(11)} ${t.ancho}x${t.fondo}x${t.alto} cm  holgura delante ${t.holguraFrente}${t.huecoInferior ? `  hueco inferior ${t.huecoInferior}` : ''}${t.pared ? `  en la pared, a ${t.elevacion} cm del suelo` : ''}`);
      return SALIDA.OK;
    }
    case 'nuevo': {
      exigirArgumentos(pos, 2, 'nuevo <archivo> --ancho --largo ...');
      exigirOpcionesCli(cli, CLI_POR_COMANDO.nuevo!, comando);
      const ruta = archivoDe(pos, 1, comando);
      if (existsSync(ruta) && !cli.forzar) throw new ErrorSalida(`«${ruta}» ya existe; usa --forzar para sustituirlo`, SALIDA.USO);
      const { ancho, largo, alto, nombre, grosorMuros, ...resto } = op;
      sinOpcionesDeMueble(resto, comando);
      if (typeof ancho !== 'number' || typeof largo !== 'number') throw new ErrorSalida('«nuevo» necesita --ancho y --largo (cm)', SALIDA.USO);
      let e: N.Espacio;
      try {
        e = N.nuevoEspacio({ ancho, largo, alto: alto as number | undefined, grosorMuros: grosorMuros as number | undefined, nombre: nombre as string | undefined });
      } catch (err) {
        throw new ErrorSalida((err as Error).message, SALIDA.USO);
      }
      escribir(ruta, N.aJSON(e), cli.forzar && existsSync(ruta) ? leerBytes(ruta) : null);
      if (cli.json) console.log(ascii({ ok: true, escrito: true, archivo: ruta }));
      else console.log(`Creado ${ruta}: «${e.nombre}» de ${ancho} x ${largo} cm.`);
      return SALIDA.OK;
    }
    case 'resumen':
    case 'validar':
    case 'analizar': {
      exigirArgumentos(pos, 2, `${comando} <archivo>`);
      exigirOpcionesCli(cli, [], comando);
      sinOpcionesDeMueble(op, comando);
      const { espacio, migradoDesde, avisos } = leer(archivoDe(pos, 1, comando));
      // Un archivo de la v1 se lee convertido; se dice para que nadie se sorprenda al escribir.
      const conversion = migradoDesde
        ? [`El archivo es de la versión ${migradoDesde}: se lee convertido a la ${N.VERSION} y se guardará así (con copia de la versión ${migradoDesde}) en el primer cambio.`, ...avisos]
        : avisos;
      if (comando === 'resumen') {
        console.log(cli.json ? ascii({ ...resumenJSON(espacio), versionEnDisco: migradoDesde ?? N.VERSION, avisos: conversion }) : [...resumenTexto(espacio), ...conversion].join('\n'));
        return SALIDA.OK;
      }
      if (comando === 'validar') {
        console.log(cli.json ? ascii({ ok: true, errores: [], versionEnDisco: migradoDesde ?? N.VERSION, avisos: conversion }) : ['Válido.', ...conversion].join('\n'));
        return SALIDA.OK;
      }
      const inc = N.analizar(espacio);
      console.log(cli.json ? ascii({ ok: !N.hayErrores(inc), incidencias: inc }) : lineasIncidencias(inc).join('\n'));
      return N.hayErrores(inc) ? SALIDA.INCIDENCIAS : SALIDA.OK;
    }
    case 'plano': {
      exigirArgumentos(pos, 2, 'plano <archivo> [--svg salida.svg | --png salida.png] [--columnas 72]');
      exigirOpcionesCli(cli, CLI_POR_COMANDO.plano!, comando);
      const plantaId = tomarPlanta(op);
      sinOpcionesDeMueble(op, comando);
      const ruta = archivoDe(pos, 1, comando);
      const { espacio } = leer(ruta);
      if (plantaId !== undefined) N.planta(espacio, plantaId);
      if ((cli.pxPorCm !== undefined || cli.rejilla !== undefined || cli.sobreFondo !== undefined) && typeof cli.png !== 'string') throw new ErrorSalida('--px-por-cm, --rejilla y --sobre-fondo van con --png', SALIDA.USO);
      if (typeof cli.imprimible === 'string') {
        if (typeof cli.png === 'string' || typeof cli.svg === 'string') throw new ErrorSalida('Usa --imprimible, --png o --svg, de uno en uno', SALIDA.USO);
        if (resolve(cli.imprimible) === resolve(ruta)) throw new ErrorSalida('--imprimible no puede ser el propio archivo del espacio', SALIDA.USO);
        const r = N.planoImprimible(espacio, plantaId !== undefined ? { planta: plantaId } : {});
        writeFileSync(cli.imprimible, r.html);
        const datos = { ok: true, imprimible: cli.imprimible, hojas: r.hojas };
        console.log(cli.json ? ascii(datos) : `Plano para imprimir en ${cli.imprimible}: ${r.hojas.map((h) => `${h.planta} a 1:${h.escala}`).join(', ')}. Ábrelo en el navegador e imprímelo a tamaño real (100 %) o guárdalo como PDF.`);
        return SALIDA.OK;
      }
      if (typeof cli.png === 'string') {
        if (typeof cli.svg === 'string') throw new ErrorSalida('Usa --png o --svg, no los dos', SALIDA.USO);
        if (resolve(cli.png) === resolve(ruta)) throw new ErrorSalida('--png no puede ser el propio archivo del espacio', SALIDA.USO);
        // Tampoco la imagen de un fondo: se perdería el plano original.
        const destino = resolve(cli.png).toLowerCase();
        const pisado = espacio.plantas.flatMap((p) => p.fondos ?? []).find((f) => join(dirname(resolve(ruta)), ...f.archivo.split('/')).toLowerCase() === destino);
        if (pisado) throw new ErrorSalida(`--png no puede ser la imagen del fondo «${pisado.id}» (${pisado.archivo}): escribe el calco en otro archivo`, SALIDA.USO);
        const fondos = cli.sobreFondo === true ? leerFondos(ruta, N.planta(espacio, plantaId)) : undefined;
        let r: N.PlanoPng;
        try {
          r = N.planoPng(espacio, { planta: plantaId, pxPorCm: cli.pxPorCm as number | undefined, rejilla: cli.rejilla === true, fondos });
        } catch (e) {
          throw new ErrorSalida((e as Error).message, SALIDA.USO);
        }
        writeFileSync(cli.png, codificarPNG(r.lienzo.rgba, r.lienzo.ancho, r.lienzo.alto));
        const datos = { ok: true, png: cli.png, ancho: r.lienzo.ancho, alto: r.lienzo.alto, pxPorCm: r.pxPorCm, origen: r.origen };
        console.log(cli.json ? ascii(datos) : `Plano PNG en ${cli.png} (${r.lienzo.ancho} x ${r.lienzo.alto} px, ${r.pxPorCm} px por cm; el píxel (0, 0) es el punto (${r.origen.join(', ')}) cm).`);
        return SALIDA.OK;
      }
      if (cli.columnas !== undefined && (typeof cli.columnas !== 'number' || cli.columnas < 10 || cli.columnas > 400)) {
        throw new ErrorSalida('--columnas debe estar entre 10 y 400', SALIDA.USO);
      }
      if (typeof cli.svg === 'string') {
        if (resolve(cli.svg) === resolve(ruta)) throw new ErrorSalida('--svg no puede ser el propio archivo del espacio', SALIDA.USO);
        writeFileSync(cli.svg, N.planoSVG(espacio, { planta: plantaId }), 'utf8');
        console.log(cli.json ? ascii({ ok: true, svg: cli.svg }) : `Plano SVG en ${cli.svg}.`);
      } else {
        const texto = N.planoTexto(espacio, { columnas: cli.columnas as number | undefined, planta: plantaId });
        console.log(cli.json ? ascii({ ok: true, texto }) : texto.trimEnd());
      }
      return SALIDA.OK;
    }
    case 'exportar': {
      exigirArgumentos(pos, 2, 'exportar <archivo> --glb salida.glb [--colisiones godot|unreal|generico] [--escena escena.json]');
      exigirOpcionesCli(cli, CLI_POR_COMANDO.exportar!, comando);
      sinOpcionesDeMueble(op, comando);
      const ruta = archivoDe(pos, 1, comando);
      if (typeof cli.glb !== 'string' && typeof cli.escena !== 'string') throw new ErrorSalida('«exportar» necesita --glb salida.glb, --escena escena.json o los dos', SALIDA.USO);
      for (const k of ['glb', 'escena'] as const) {
        if (typeof cli[k] === 'string' && resolve(cli[k] as string) === resolve(ruta)) throw new ErrorSalida(`--${k} no puede ser el propio archivo del espacio`, SALIDA.USO);
      }
      if (cli.colisiones !== undefined && !N.MODOS_COLISIONES.includes(cli.colisiones as N.ModoColisiones)) throw new ErrorSalida(`--colisiones debe ser ${N.MODOS_COLISIONES.join(', ')}`, SALIDA.USO);
      if (cli.colisiones !== undefined && typeof cli.glb !== 'string') throw new ErrorSalida('--colisiones va con --glb', SALIDA.USO);
      const { espacio } = leer(ruta);
      const salida: Record<string, unknown> = { ok: true };
      const frases: string[] = [];
      if (typeof cli.glb === 'string') {
        const bytes = N.espacioAGLB(espacio, `Espacios 3D ${__VERSION__}`, { colisiones: cli.colisiones as N.ModoColisiones | undefined });
        writeFileSync(cli.glb, bytes);
        Object.assign(salida, { glb: cli.glb, bytes: bytes.length, colisiones: cli.colisiones ?? null });
        frases.push(`Modelo 3D en ${cli.glb} (${bytes.length} bytes): metros, y hacia arriba, un nodo por planta, suelos, muros, escaleras y un nodo por mueble con su id${cli.colisiones ? `, con colisiones para ${cli.colisiones}` : ''}.`);
      }
      if (typeof cli.escena === 'string') {
        writeFileSync(cli.escena, `${JSON.stringify(N.describir(espacio), null, 1)}\n`, 'utf8');
        salida.escena = cli.escena;
        frases.push(`Escena en ${cli.escena}: lo mismo que «describir --json» (estancias, muros, huecos, muebles, escaleras y conexiones).`);
      }
      console.log(cli.json ? ascii(salida) : frases.join('\n'));
      return SALIDA.OK;
    }
    case 'abrir': {
      if (pos.length > 2) throw new ErrorSalida('Uso: abrir [<archivo>] [--salida pagina.html] [--no-lanzar]', SALIDA.USO);
      exigirOpcionesCli(cli, CLI_POR_COMANDO.abrir!, comando);
      sinOpcionesDeMueble(op, comando);
      if (cli.salida !== undefined && (typeof cli.salida !== 'string' || !/\.html?$/i.test(cli.salida))) throw new ErrorSalida('--salida debe ser un archivo .html', SALIDA.USO);
      if (cli.salida !== undefined && pos[1] === undefined) throw new ErrorSalida('--salida va con un archivo: abrir <archivo> --salida pagina.html', SALIDA.USO);
      const r = abrirPagina(pos[1], { salida: cli.salida as string | undefined, noLanzar: cli.noLanzar === true, forzar: cli.forzar === true });
      console.log(cli.json ? ascii(r) : `${r.archivo ? `Página con «${r.archivo}» dentro` : 'Página en blanco'}: ${r.pagina}\n${r.aviso}${r.omitidos.length ? `\nNo van dentro: ${r.omitidos.map((o) => `${o.ruta} (${o.motivo})`).join('; ')}` : ''}`);
      return SALIDA.OK;
    }
    case 'describir': {
      exigirArgumentos(pos, 2, 'describir <archivo>');
      exigirOpcionesCli(cli, CLI_POR_COMANDO.describir!, comando);
      const plantaId = tomarPlanta(op);
      sinOpcionesDeMueble(op, comando);
      const { espacio } = leer(archivoDe(pos, 1, comando));
      const d = N.describir(espacio, plantaId);
      console.log(cli.json ? ascii(d) : N.describirTexto(d).join('\n'));
      return SALIDA.OK;
    }
    case 'aplicar': {
      exigirArgumentos(pos, 2, 'aplicar <archivo> --ops ops.json');
      exigirOpcionesCli(cli, CLI_POR_COMANDO.aplicar!, comando);
      sinOpcionesDeMueble(op, comando);
      const ruta = archivoDe(pos, 1, comando);
      if (typeof cli.ops !== 'string') throw new ErrorSalida('«aplicar» necesita --ops archivo.json (o --ops - para leer de la entrada estándar)', SALIDA.USO);
      const ops = leerOps(cli.ops);
      const conMios = expandirMios(ops, dirname(resolve(ruta)));
      return mutar(ruta, cli, (e) => {
        const r = N.ejecutarLote(e, conMios);
        return { ...r, notas: [...r.notas, ...avisosModelos(r.espacio, ruta), ...avisosFotos(r.espacio, ruta)] };
      });
    }
    case 'muebles': {
      const sub = pos[1];
      if (!sub || !['listar', 'guardar', 'quitar'].includes(sub)) throw new ErrorSalida('Uso: muebles listar|guardar|quitar <carpeta|archivo> ...', SALIDA.USO);
      exigirArgumentos(pos, 3, `muebles ${sub} <${sub === 'guardar' ? 'archivo' : 'carpeta|archivo'}>`);
      exigirOpcionesCli(cli, sub === 'listar' ? ['json'] : ['json', 'simular'], `muebles ${sub}`);
      const destino = pos[2] as string;
      const { lista, ruta, original } = leerMisMuebles(carpetaDe(destino));
      if (sub === 'listar') {
        sinOpcionesDeMueble(op, 'muebles listar');
        console.log(cli.json ? ascii(lista) : lista.muebles.length ? lista.muebles.map(describirGuardado).join('\n') : 'No hay muebles guardados en esta carpeta.');
        return SALIDA.OK;
      }
      const { id, nombre, ...resto } = op;
      sinOpcionesDeMueble(resto, `muebles ${sub}`);
      let nueva: N.MisMuebles;
      let nota: string;
      if (sub === 'guardar') {
        if (typeof id !== 'string') throw new ErrorSalida('«muebles guardar» necesita --id del mueble', SALIDA.USO);
        const m = N.buscarMueble(leer(destino).espacio, id)?.mueble;
        if (!m) throw new ErrorSalida(`No existe el mueble «${id}» en «${destino}»`, SALIDA.USO);
        if (nombre !== undefined && (typeof nombre !== 'string' || !nombre.trim())) throw new ErrorSalida('--nombre necesita un texto', SALIDA.USO);
        const g = N.guardadoDeMueble(m, typeof nombre === 'string' ? nombre.trim() : m.nombre);
        const habia = lista.muebles.some((x) => x.nombre === g.nombre);
        nueva = N.guardarEnMisMuebles(lista, g);
        nota = `${habia ? 'sustituido' : 'guardado'} ${describirGuardado(g)}`;
      } else {
        if (typeof nombre !== 'string') throw new ErrorSalida('«muebles quitar» necesita --nombre', SALIDA.USO);
        const g = N.buscarEnMisMuebles(lista, nombre);
        if (!g) throw new ErrorSalida(`No hay «${nombre}» en «Mis muebles». Hay: ${lista.muebles.map((x) => x.nombre).join(', ') || '(ninguno)'}`, SALIDA.USO);
        nueva = N.quitarDeMisMuebles(lista, g.nombre);
        nota = `quitado «${g.nombre}»`;
      }
      const v = N.validarMisMuebles(nueva);
      if (!v.ok) throw new ErrorSalida('El resultado no es válido', SALIDA.INVALIDO, v.errores);
      if (!cli.simular) escribir(ruta, N.misMueblesAJSON(v.misMuebles), original);
      console.log(cli.json ? ascii({ ok: true, archivo: ruta, notas: [nota], simulado: !!cli.simular }) : `${cli.simular ? '(simulado) ' : ''}${nota} en ${ruta}`);
      return SALIDA.OK;
    }
    case 'estancia-sub':
    case 'planta':
    case 'tabique':
    case 'escalera':
    case 'fondo':
    case 'elemento':
    case 'faldon':
    case 'hueco':
    case 'foto':
    case 'distribucion': {
      const sub = pos[1];
      const ruta = archivoDe(pos, 2, `${comando} ${sub ?? ''}`.trim());
      exigirArgumentos(pos, 3, `${comando} ${sub ?? '<accion>'} <archivo> ...`);
      if (comando === 'distribucion' && sub === 'listar') {
        exigirOpcionesCli(cli, [], 'distribucion listar');
        sinOpcionesDeMueble(op, 'distribucion listar');
        const { espacio } = leer(ruta);
        const lista = espacio.distribuciones.map((d) => ({ nombre: d.nombre, muebles: Object.keys(d.posiciones).length }));
        console.log(cli.json ? ascii(lista) : lista.length ? lista.map((d) => `«${d.nombre}» (${d.muebles} muebles)`).join('\n') : 'No hay distribuciones guardadas.');
        return SALIDA.OK;
      }
      const validos =
        comando === 'hueco' ? ['agregar', 'quitar'] : comando === 'estancia' ? ['agregar', 'quitar', 'contorno'] : comando === 'fondo' ? ['poner', 'calibrar', 'editar', 'quitar']
          : comando === 'planta' ? ['agregar', 'editar', 'quitar'] : comando === 'tabique' ? ['mover'] : comando === 'escalera' ? ['agregar', 'editar', 'quitar']
          : comando === 'elemento' ? ['agregar', 'editar', 'quitar'] : comando === 'faldon' ? ['poner', 'quitar'] : comando === 'foto' ? ['agregar', 'quitar'] : ['guardar', 'aplicar', 'quitar'];
      if (!sub || !validos.includes(sub)) throw new ErrorSalida(`Uso: ${comando} ${validos.join('|')}${comando === 'distribucion' ? '|listar' : ''} <archivo> ...`, SALIDA.USO);
      exigirOpcionesCli(cli, comando === 'fondo' && sub === 'poner' ? [...CLI_POR_COMANDO.mutacion!, 'imagen'] : CLI_POR_COMANDO.mutacion!, `${comando} ${sub}`);
      if (comando === 'fondo' && sub === 'poner') Object.assign(op, datosImagen(ruta, cli.imagen));
      // Una foto se asocia si está junto al archivo (la de un agente que se equivoca de ruta no se pierde en silencio).
      if (comando === 'foto' && sub === 'agregar' && typeof op.foto === 'string' && !existsSync(join(dirname(resolve(ruta)), op.foto))) {
        throw new ErrorSalida(`No existe ${op.foto} junto a ${ruta}: copia antes la foto (normalmente a fotos/) y usa la ruta relativa al .espacio.json`, SALIDA.USO);
      }
      return mutar(ruta, cli, (e) => {
        const r = N.ejecutarOp(e, { ...op, op: `${comando}-${sub}` });
        return { espacio: r.espacio, notas: [r.nota] };
      });
    }
    default: {
      if (!N.OPERACIONES.includes(comando)) throw new ErrorSalida(`Comando desconocido «${comando}». Ejecuta «node espacios3d.mjs ayuda».`, SALIDA.USO);
      exigirArgumentos(pos, 2, `${comando} <archivo> --opciones`);
      exigirOpcionesCli(cli, CLI_POR_COMANDO.mutacion!, comando);
      const ruta = archivoDe(pos, 1, comando);
      if (op.mio !== undefined) {
        // «agregar --mio "Sofá en L"»: parte del mueble guardado; lo que se indique además lo cambia.
        if (comando !== 'agregar') throw new ErrorSalida('--mio va con «agregar» y el nombre de uno de «Mis muebles»', SALIDA.USO);
        const [x] = expandirMios([{ ...op, op: comando }], dirname(resolve(ruta)), false) as Record<string, unknown>[];
        for (const k of Object.keys(op)) delete op[k];
        Object.assign(op, x);
        delete op.op;
      }
      return mutar(ruta, cli, (e) => {
        const r = N.ejecutarOp(e, { ...op, op: comando });
        return { espacio: r.espacio, notas: [r.nota, ...(op.modelo !== undefined ? avisosModelos(r.espacio, ruta) : [])] };
      });
    }
  }
}

// ---------- Servidor MCP (R2-7, paso c) ----------

/** Lado largo máximo (px) y tamaño máximo (bytes) de una imagen devuelta por el MCP. */
interface ResultadoAbrir {
  ok: true;
  pagina: string;
  archivo: string | null;
  copiadaEn: string | null;
  lanzado: boolean;
  incluidos: string[];
  omitidos: { ruta: string; motivo: string }[];
  aviso: string;
}

/**
 * «abrir»: sin archivo, la página tal cual; con archivo, una copia de la página con el espacio y sus
 * archivos dentro (docs/PLAN_R5.md, R5-1). La lanza con el navegador predeterminado salvo noLanzar.
 */
function abrirPagina(archivo: string | undefined, opciones: { salida?: string; noLanzar?: boolean; forzar?: boolean }): ResultadoAbrir {
  const base = rutaPaginaBase();
  if (!existsSync(base)) throw new ErrorSalida(`No encuentro Espacios3D.html junto a espacios3d.mjs (${base}): usa los dos archivos de la misma carpeta de entrega`, SALIDA.USO);
  let pagina = base;
  let copiadaEn: string | null = null;
  let incluidos: string[] = [];
  let omitidos: { ruta: string; motivo: string }[] = [];
  if (archivo !== undefined) {
    const ruta = resolve(archivo);
    // Lee y valida sin escribir nada: aunque sea de la v1, el disco no se toca (M13).
    const { espacio, original } = leer(ruta);
    // La página lee los archivos como UTF-8: una copia en UTF-16 no se podría unir luego a su archivo.
    if ((original[0] === 0xff && original[1] === 0xfe) || (original[0] === 0xfe && original[1] === 0xff)) {
      throw new ErrorSalida(`«${archivo}» está guardado en UTF-16 y la página sólo lee UTF-8: guárdalo en UTF-8 (cualquier cambio con este comando lo reescribe así) y vuelve a abrirlo`, SALIDA.USO);
    }
    const tope = Number(process.env.ESPACIOS3D_TOPE_INCRUSTADO) > 0 ? Number(process.env.ESPACIOS3D_TOPE_INCRUSTADO) : TOPE_INCRUSTADO;
    const rec = recogerArchivos(ruta, espacio, tope);
    copiadaEn = new Date().toISOString();
    const datos: DatosAbierto = { version: 1, texto: decodificar(original), nombre: basename(ruta), ruta: realpathSync.native(ruta), copiadaEn, archivos: rec.archivos, omitidos: rec.omitidos };
    let html: string;
    try {
      html = paginaConEspacio(readFileSync(base, 'utf8'), datos);
    } catch (e) {
      throw new ErrorSalida((e as Error).message, SALIDA.USO);
    }
    if (opciones.salida) {
      pagina = resolve(opciones.salida);
      // Ni la propia página de la entrega ni un .html ajeno (revisión independiente, 5).
      const igual = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
      const real = existsSync(pagina) ? realpathSync.native(pagina) : pagina;
      if (igual(real, realpathSync.native(base))) throw new ErrorSalida('--salida no puede ser Espacios3D.html: es la página de la entrega', SALIDA.USO);
      if (existsSync(pagina) && !opciones.forzar && !readFileSync(pagina, 'utf8').includes(MARCA_COPIA)) {
        throw new ErrorSalida(`«${opciones.salida}» ya existe y no es una página hecha por «abrir»: elige otro nombre o usa --forzar`, SALIDA.USO);
      }
    } else {
      limpiarCopiasViejas();
      pagina = rutaCopia(ruta, nombreSinExtension(ruta));
    }
    escribirPagina(pagina, html);
    incluidos = Object.keys(rec.archivos);
    omitidos = rec.omitidos;
  }
  // explorer.exe toma las comas de la ruta como separadores: se lanza una copia sin comas.
  let paraLanzar = pagina;
  if (!opciones.noLanzar && process.platform === 'win32' && pagina.includes(',')) {
    paraLanzar = join(tmpdir(), 'espacios3d', `${basename(pagina).replace(/,/g, '_')}`);
    escribirPagina(paraLanzar, readFileSync(pagina, 'utf8'));
  }
  const lanzado = opciones.noLanzar ? false : lanzar(paraLanzar);
  const aviso = lanzado
    ? `Se ha pedido a Windows (o al sistema) que abra la página con su programa predeterminado; no puedo comprobar que se abrió. Si no aparece, abre a mano ${pagina}.`
    : `No se ha lanzado el navegador${opciones.noLanzar || process.env.ESPACIOS3D_NO_LANZAR === '1' ? ' (pedido así)' : ''}: abre ${pagina} con doble clic.`;
  return {
    ok: true,
    pagina,
    archivo: archivo === undefined ? null : archivo,
    copiadaEn,
    lanzado,
    incluidos,
    omitidos,
    aviso: archivo === undefined
      ? aviso
      : `${aviso} Es una copia: lo que cambies después en «${basename(archivo)}» no se ve en esa página; vuelve a llamar a «abrir» para enseñarlo. La persona guarda sus cambios al pulsar «Abrir su carpeta».`,
  };
}

const MCP_PX = 1500;
const MCP_BYTES = 3_000_000;

/** Ruta de un .espacio.json dentro de la carpeta del servidor; rechaza lo de fuera (también por enlaces). */
function rutaEnCarpeta(carpeta: string, archivo: unknown, debeExistir = true, extension: { re: RegExp; nombre: string } = { re: /\.espacio\.json$/i, nombre: '.espacio.json' }): string {
  if (typeof archivo !== 'string' || !archivo.trim()) throw new Error(`Hace falta la ruta de un ${extension.nombre} relativa a la carpeta (p. ej. espacios/casa${extension.nombre})`);
  if (isAbsolute(archivo) || N.rutaRelativaValida(archivo.replace(/\\/g, '/'))) throw new Error(`«${archivo}»: usa una ruta relativa a la carpeta de la herramienta, sin «..»`);
  // «:» abre flujos alternativos en Windows (archivo:otro): no se admite en ninguna parte de la ruta.
  if (archivo.includes(':')) throw new Error(`«${archivo}»: la ruta no puede llevar «:»`);
  if (!extension.re.test(archivo)) throw new Error(`«${archivo}» no es un ${extension.nombre}`);
  const base = realpathSync.native(carpeta);
  const ruta = resolve(base, archivo);
  // Los enlaces y uniones se resuelven antes de comparar (también los de las carpetas de por medio).
  if (!existsSync(ruta) && !existsSync(dirname(ruta))) throw new Error(`No existe la carpeta «${relative(base, dirname(ruta)) || '.'}» dentro de la carpeta de la herramienta: créala antes`);
  const real = existsSync(ruta) ? realpathSync.native(ruta) : join(realpathSync.native(dirname(ruta)), basename(ruta));
  if (real !== base && !real.startsWith(base + sep)) throw new Error(`«${archivo}» queda fuera de la carpeta de la herramienta`);
  if (debeExistir && !existsSync(real)) throw new Error(`No existe «${archivo}». Crea uno con la herramienta «nuevo».`);
  return real;
}

/** Lo que el CLI lanza como ErrorSalida, para el MCP es un mensaje (con sus detalles). */
function mensajeMCP(e: unknown): string {
  if (e instanceof ErrorSalida) return [e.message, ...e.detalles.map((d) => `- ${d}`)].join('\n');
  return e instanceof Error ? e.message : String(e);
}

async function servirEspaciosMCP(argv: string[]): Promise<void> {
  const i = argv.indexOf('--carpeta');
  if (i >= 0 && (!argv[i + 1] || argv[i + 1]!.startsWith('--'))) throw new ErrorSalida('--carpeta necesita una ruta: mcp --carpeta <carpeta>', SALIDA.USO);
  const carpeta = resolve(i >= 0 ? argv[i + 1]! : dirname(realpathSync.native(process.argv[1]!)));
  if (!existsSync(carpeta)) throw new ErrorSalida(`No existe la carpeta «${carpeta}»`, SALIDA.USO);
  const texto = (s: string): { contenido: { type: 'text'; text: string }[] } => ({ contenido: [{ type: 'text', text: s }] });
  const archivo = { type: 'string', description: 'Ruta del .espacio.json relativa a la carpeta de la herramienta (p. ej. espacios/casa.espacio.json)' };
  return servirMCP({
    nombre: 'espacios3d',
    version: __VERSION__,
    instrucciones: 'Espacios 3D: crear y ordenar estancias, casas y muebles en archivos .espacio.json (cm, x a la derecha, y hacia abajo). Lee AGENTS.md y las guías de la carpeta. Cambia con «aplicar» (lista de operaciones, todas o ninguna) y comprueba con «analizar» y «plano_png».',
    herramientas: [
      {
        nombre: 'nuevo',
        descripcion: 'Crea un .espacio.json con una estancia rectangular de ancho × largo cm. No sustituye uno que exista.',
        esquemaEntrada: { type: 'object', properties: { archivo, ancho: { type: 'number' }, largo: { type: 'number' }, alto: { type: 'number' }, nombre: { type: 'string' } }, required: ['archivo', 'ancho', 'largo'], additionalProperties: false },
        async ejecutar(a) {
          const ruta = rutaEnCarpeta(carpeta, a.archivo, false);
          if (existsSync(ruta)) throw new Error(`«${String(a.archivo)}» ya existe: cámbialo con «aplicar»`);
          if (typeof a.ancho !== 'number' || typeof a.largo !== 'number') throw new Error('«ancho» y «largo» (cm) son números');
          const e = N.nuevoEspacio({ ancho: a.ancho, largo: a.largo, alto: typeof a.alto === 'number' ? a.alto : undefined, nombre: typeof a.nombre === 'string' ? a.nombre : undefined });
          escribir(ruta, N.aJSON(e), null);
          return texto(`Creado ${String(a.archivo)}: ${N.describirTexto(N.describir(e)).join('\n')}`);
        },
      },
      {
        nombre: 'describir',
        descripcion: 'Describe el espacio para razonar sin calcular: plantas, estancias (muros con longitud y lado, huecos y a qué dan), muebles (dónde están, hacia dónde miran, a qué muros están pegados), escaleras, conexiones e incidencias. En JSON.',
        esquemaEntrada: { type: 'object', properties: { archivo, planta: { type: 'string', description: 'id de una planta (por defecto, todas)' } }, required: ['archivo'], additionalProperties: false },
        async ejecutar(a) {
          const { espacio } = leer(rutaEnCarpeta(carpeta, a.archivo));
          return texto(JSON.stringify(N.describir(espacio, typeof a.planta === 'string' ? a.planta : undefined), null, 1));
        },
      },
      {
        nombre: 'aplicar',
        descripcion: 'Aplica una lista de operaciones (las de «node espacios3d.mjs aplicar»: agregar, mover, girar, editar, quitar, estancia-agregar, hueco-agregar, elemento-agregar, planta-agregar, escalera-agregar, tabique-mover, fondo-poner…), todas o ninguna, y devuelve las notas y las incidencias. Con simular: true no escribe. En «agregar», «mio» usa uno de «Mis muebles». En «fondo-poner» basta «archivo» (la imagen, relativa al .espacio.json): el tamaño se lee de ella.',
        esquemaEntrada: { type: 'object', properties: { archivo, ops: { type: 'array', items: { type: 'object' } }, simular: { type: 'boolean' } }, required: ['archivo', 'ops'], additionalProperties: false },
        async ejecutar(a) {
          const ruta = rutaEnCarpeta(carpeta, a.archivo);
          if (!Array.isArray(a.ops)) throw new Error('«ops» debe ser una lista de operaciones');
          const ops = (expandirMios(a.ops, dirname(ruta)) as Record<string, unknown>[]).map((op) => {
            // Siempre por datosImagen, también con anchoPx y altoPx: comprueba que la imagen esté dentro
            // de la carpeta tras resolver los enlaces y lee su tamaño real (revisión independiente, 6).
            if (op && op.op === 'fondo-poner' && typeof op.archivo === 'string') {
              return { ...op, ...datosImagen(ruta, join(dirname(ruta), op.archivo)) };
            }
            return op;
          });
          let r: ResultadoMutacion;
          try {
            r = mutarArchivo(ruta, { simular: a.simular === true }, (e) => {
              const x = N.ejecutarLote(e, ops);
              return { ...x, notas: [...x.notas, ...avisosModelos(x.espacio, ruta), ...avisosFotos(x.espacio, ruta)] };
            });
          } catch (e) {
            return { contenido: [{ type: 'text', text: `No se ha aplicado nada: ${mensajeMCP(e)}` }], esError: true };
          }
          return texto(JSON.stringify({ escrito: r.escrito, sinCambios: r.sinCambios, simulado: a.simular === true, notas: r.notas, errores: r.errores, incidencias: r.incidencias }, null, 1));
        },
      },
      {
        nombre: 'abrir',
        descripcion: 'Abre Espacios 3D en el navegador de la persona para que vea y retoque el espacio. Con «archivo», la página se abre con ese espacio ya cargado (una copia: si cambias más cosas, vuelve a llamar a «abrir»); sin «archivo», en blanco. No puede comprobar que la ventana se abrió.',
        esquemaEntrada: { type: 'object', properties: { archivo: { ...archivo, description: `${archivo.description}. Sin él, la página en blanco` } }, additionalProperties: false },
        async ejecutar(a) {
          const ruta = a.archivo === undefined ? undefined : rutaEnCarpeta(carpeta, a.archivo);
          return texto(JSON.stringify(abrirPagina(ruta, {}), null, 1));
        },
      },
      {
        nombre: 'analizar',
        descripcion: 'Incidencias del espacio: errores (algo se sale, choca, tapa una puerta o el paso) y avisos (ventana tapada, poco sitio delante).',
        esquemaEntrada: { type: 'object', properties: { archivo }, required: ['archivo'], additionalProperties: false },
        async ejecutar(a) {
          const { espacio } = leer(rutaEnCarpeta(carpeta, a.archivo));
          const inc = N.analizar(espacio);
          return texto(JSON.stringify({ errores: inc.filter((x) => x.gravedad === 'error').length, avisos: inc.filter((x) => x.gravedad === 'aviso').length, incidencias: inc }, null, 1));
        },
      },
      {
        nombre: 'plano_png',
        descripcion: `Dibuja una planta como imagen PNG (como mucho ${MCP_PX} px en el lado largo), para ver el resultado y compararlo con un plano. Devuelve también la escala (px por cm) y el origen, para pasar de píxel a cm. Con sobreFondo pinta encima del plano de fondo calibrado; con rejilla, una cuadrícula rotulada. Con guardarEn la deja además en ese archivo .png de la carpeta.`,
        esquemaEntrada: {
          type: 'object',
          properties: { archivo, planta: { type: 'string' }, pxPorCm: { type: 'number' }, sobreFondo: { type: 'boolean' }, rejilla: { type: 'boolean' }, guardarEn: { type: 'string', description: 'Ruta .png relativa a la carpeta' } },
          required: ['archivo'],
          additionalProperties: false,
        },
        async ejecutar(a) {
          const ruta = rutaEnCarpeta(carpeta, a.archivo);
          const { espacio } = leer(ruta);
          const plantaId = typeof a.planta === 'string' ? a.planta : undefined;
          const pl = N.planta(espacio, plantaId);
          const fondos = a.sobreFondo === true ? leerFondos(ruta, pl) : undefined;
          const dibujar = (pxPorCm: number | undefined): N.PlanoPng => N.planoPng(espacio, { planta: plantaId, pxPorCm, rejilla: a.rejilla === true, fondos });
          // Se mide a 0,1 px por cm (un espacio de 40 m a 1 px por cm ya no cabe: revisión independiente, 7) y se
          // elige la escala para no pasar de MCP_PX en el lado largo; el bucle de abajo la ajusta.
          const medida = dibujar(0.1);
          const tope = Math.floor(((MCP_PX * 0.1) / Math.max(medida.lienzo.ancho, medida.lienzo.alto)) * 1000) / 1000;
          const pedida = typeof a.pxPorCm === 'number' && a.pxPorCm > 0 ? Math.min(10, a.pxPorCm) : undefined;
          let r = dibujar(pedida === undefined ? (medida.lienzo.ancho > MCP_PX || medida.lienzo.alto > MCP_PX ? tope : undefined) : Math.min(pedida, tope));
          // A lo sumo MCP_PX en el lado largo y MCP_BYTES: si no, se reduce la escala.
          let png = codificarPNG(r.lienzo.rgba, r.lienzo.ancho, r.lienzo.alto);
          for (let k = 0; k < 4 && (Math.max(r.lienzo.ancho, r.lienzo.alto) > MCP_PX || png.length > MCP_BYTES); k++) {
            const f = Math.min(MCP_PX / Math.max(r.lienzo.ancho, r.lienzo.alto), png.length > MCP_BYTES ? Math.sqrt(MCP_BYTES / png.length) * 0.9 : 1);
            r = dibujar(Math.round(r.pxPorCm * f * 1000) / 1000);
            png = codificarPNG(r.lienzo.rgba, r.lienzo.ancho, r.lienzo.alto);
          }
          let guardado = '';
          if (a.guardarEn !== undefined) {
            // La misma comprobación que los .espacio.json: enlaces resueltos y nada fuera (revisión independiente, 5).
            const destino = rutaEnCarpeta(carpeta, a.guardarEn, false, { re: /\.png$/i, nombre: '.png' });
            const fondo = pl.fondos?.find((x) => join(dirname(ruta), ...x.archivo.split('/')).toLowerCase() === destino.toLowerCase());
            if (fondo) throw new Error(`«guardarEn» no puede ser la imagen del fondo «${fondo.id}»`);
            writeFileSync(destino, png);
            guardado = ` Guardado en ${a.guardarEn}.`;
          }
          return {
            contenido: [
              { type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
              { type: 'text', text: `Planta ${pl.id}: ${r.lienzo.ancho} x ${r.lienzo.alto} px, ${r.pxPorCm} px por cm; el píxel (0, 0) es el punto (${r.origen.join(', ')}) cm (x a la derecha, y hacia abajo).${guardado}` },
            ],
          };
        },
      },
    ],
  });
}

if (process.argv[2] === 'mcp') {
  // Servidor MCP por stdio: en la salida estándar sólo van los mensajes del protocolo.
  servirEspaciosMCP(process.argv.slice(3)).then(
    () => process.exit(0),
    (e: unknown) => {
      process.stderr.write(`Error: ${mensajeMCP(e)}\n`);
      process.exit(SALIDA.USO);
    },
  );
} else {
  ejecutarCLI();
}

function ejecutarCLI(): void {
let codigo: number;
const json = process.argv.includes('--json');
try {
  codigo = principal(process.argv.slice(2));
} catch (e) {
  const err = e instanceof ErrorSalida ? e : new ErrorSalida(e instanceof Error ? e.message : String(e), SALIDA.USO);
  if (json) console.log(ascii({ ok: false, error: err.message, detalles: err.detalles }));
  else {
    console.error(`Error: ${err.message}`);
    for (const d of err.detalles) console.error(`  - ${d}`);
  }
  codigo = err.codigo;
}
process.exitCode = codigo;
}
