// Comprobaciones de acceso (R4-1): ¿entra el mueble por las puertas hasta su estancia?, ¿se llega a
// él con un paso libre de 60 cm desde la puerta?, ¿cabe un círculo de giro de 150 cm en la estancia?
// Todo son avisos: informan, no impiden.
import { distanciaAlContorno, esquinasMueble, puntoEnPoligono } from './geometria.js';
import { huellaElemento, rangoAltura } from './elementos.js';
import { estanciaDeMueble } from './espacio.js';
import { tipoMueble } from './catalogo.js';
import { modeloPlanta, huellaHueco } from './muros.js';
import { geometriaDe, escalerasQueLlegan, parteBaja, zonaLlegada, zonaPie } from './escaleras.js';
import { obstaculosEn, type Segmento } from './recorrido.js';
import { ErrorGeometria } from './booleanas.js';
import type { Espacio, Estancia, Hueco, Mueble, Planta, Punto } from './tipos.js';

/** Lo que resta la hoja de una puerta abierta al ancho libre (cm). */
export const HOJA_PUERTA = 4;
/** Alto libre que se cuenta en una escalera (cm). */
export const ALTO_ESCALERA = 200;
/** Paso libre hasta los muebles (cm) y rejilla de la búsqueda. */
export const PASO_LIBRE = 60;
const REJILLA_PASO = 10;
/** Diámetro del círculo de giro (cm), rejilla de la búsqueda y altura bajo la que no estorba un tablero. */
export const CIRCULO_GIRO = 150;
const REJILLA_GIRO = 5;
const RODILLAS = 67;
/** El exterior en el grafo de estancias: no puede ser un id (los ids no admiten «:» ni espacios). Revisión independiente (7). */
const EXTERIOR = ':exterior:';
/**
 * Radio de la persona en la rejilla del paso libre: con celdas cada 10 cm, un centro a ≥ 25 cm de los
 * dos lados existe siempre que el paso mida 60 cm o más, se ponga donde se ponga (sólo 50 a 60 cm
 * dependen de la rejilla: se yerra hacia no avisar). Revisión independiente (2).
 */
const RADIO_PASO = (PASO_LIBRE - REJILLA_PASO) / 2;
/** Hasta este alto (cm) es plano: alfombras, que se enrollan y no hace falta alcanzar. */
const PLANO = 3;
/** Por encima de esta elevación (cm) va colgado: no se pasa por la puerta montado ni hace falta llegar. */
const COLGADO = 180;

export interface IncidenciaAcceso {
  regla: 'acceso' | 'giro';
  mensaje: string;
  muebles: string[];
  planta: string;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * ¿Pasa una caja de medidas a × b × c por un hueco de ancho libre W y alto H? Ordenadas d1 ≤ d2 ≤ d3,
 * la medida mayor va a lo largo y las otras dos tienen que caber en el hueco, de pie o tumbadas.
 * No se cuenta inclinarla en diagonal ni los giros en un pasillo (es conservador).
 */
export function pasaPorHueco(medidas: [number, number, number], W: number, H: number): boolean {
  const [d1, d2] = [...medidas].sort((x, y) => x - y) as [number, number, number];
  return (d1 <= W + 0.1 && d2 <= H + 0.1) || (d1 <= H + 0.1 && d2 <= W + 0.1);
}

interface Paso {
  de: string;
  a: string;
  ancho: number;
  alto: number;
  nombre: string;
}

/** Huecos de paso de todo el espacio como aristas entre estancias (y «exterior»), con su ancho y alto libres. */
function pasosDe(e: Espacio): Paso[] {
  const res: Paso[] = [];
  for (const p of e.plantas) {
    const huecos = new Map<string, Hueco>(p.estancias.flatMap((s) => s.huecos.map((h) => [h.id, h] as [string, Hueco])));
    let enMuros;
    try {
      enMuros = modeloPlanta(p).huecos.filter((x) => x.hueco.tipo !== 'ventana');
    } catch (err) {
      if (err instanceof ErrorGeometria) continue;
      throw err;
    }
    for (const c of enMuros.map((x) => ({ hueco: x.hueco.id, de: x.estancia, a: x.da ?? EXTERIOR }))) {
      const h = huecos.get(c.hueco);
      if (!h) continue;
      res.push({ de: c.de, a: c.a, ancho: h.tipo === 'puerta' ? h.ancho - HOJA_PUERTA : h.ancho, alto: h.alto, nombre: `${h.tipo === 'puerta' ? 'puerta' : 'paso'} ${h.id}` });
    }
    for (const esc of p.escaleras ?? []) {
      const dest = e.plantas.find((x) => x.id === esc.hasta);
      if (!dest) continue;
      const geo = geometriaDe(e, p, esc);
      const centro = (z: Punto[]): Punto => [z.reduce((s, q) => s + q[0], 0) / z.length, z.reduce((s, q) => s + q[1], 0) / z.length];
      const de = p.estancias.find((s) => puntoEnPoligono(centro(zonaPie(geo)), s.contorno));
      const a = dest.estancias.find((s) => puntoEnPoligono(centro(zonaLlegada(geo)), s.contorno));
      if (de && a) res.push({ de: de.id, a: a.id, ancho: esc.ancho, alto: ALTO_ESCALERA, nombre: `escalera ${esc.id}` });
    }
  }
  return res;
}

/** Estancias a las que se llega desde el exterior por los pasos que cumplen `vale`. */
function alcanzables(pasos: Paso[], vale: (p: Paso) => boolean): Set<string> {
  const vistos = new Set([EXTERIOR]);
  const cola = [EXTERIOR];
  while (cola.length) {
    const x = cola.pop()!;
    for (const p of pasos) {
      if (!vale(p)) continue;
      const otro = p.de === x ? p.a : p.a === x ? p.de : null;
      if (otro && !vistos.has(otro)) {
        vistos.add(otro);
        cola.push(otro);
      }
    }
  }
  return vistos;
}

const medidas = (m: Mueble): [number, number, number] => [m.ancho, m.fondo, m.alto];

export interface Entrada {
  /** entra: hay camino desde el exterior; no-entra: no pasa por algún hueco del camino; sin-datos: no hay puerta al exterior o la estancia no está comunicada. */
  estado: 'entra' | 'no-entra' | 'sin-datos';
  /** Huecos por los que no pasa, en el borde de lo que se alcanza. */
  noPasa: { nombre: string; ancho: number; alto: number }[];
}

function estanciaDe(p: Planta, m: Mueble): Estancia | null {
  return estanciaDeMueble(p, m) ?? (p.estancias.length === 1 ? p.estancias[0]! : null);
}

function entradaCon(pasos: Paso[], m: Mueble, destino: string): Entrada {
  if (!pasos.some((p) => p.de === EXTERIOR || p.a === EXTERIOR)) return { estado: 'sin-datos', noPasa: [] };
  if (!alcanzables(pasos, () => true).has(destino)) return { estado: 'sin-datos', noPasa: [] };
  const d = medidas(m);
  const llega = alcanzables(pasos, (p) => pasaPorHueco(d, p.ancho, p.alto));
  if (llega.has(destino)) return { estado: 'entra', noPasa: [] };
  const noPasa = pasos
    .filter((p) => llega.has(p.de) !== llega.has(p.a) && !pasaPorHueco(d, p.ancho, p.alto))
    .map((p) => ({ nombre: p.nombre, ancho: r1(p.ancho), alto: r1(p.alto) }));
  return { estado: 'no-entra', noPasa };
}

/** ¿Entra el mueble desde el exterior hasta su estancia por las puertas, los pasos y las escaleras? */
export function entradaMueble(e: Espacio, id: string): Entrada {
  for (const p of e.plantas) {
    const m = p.muebles.find((x) => x.id === id);
    if (!m) continue;
    const s = estanciaDe(p, m);
    if (!s || m.alto <= PLANO) return { estado: 'sin-datos', noPasa: [] };
    return entradaCon(pasosDe(e), m, s.id);
  }
  return { estado: 'sin-datos', noPasa: [] };
}

const distSeg = (p: Punto, [a, b]: Segmento): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
};
const distPol = (p: Punto, pol: readonly Punto[]): number => (puntoEnPoligono(p, pol) ? 0 : distanciaAlContorno(p, pol));

/**
 * Muebles de una planta a los que no se llega con un paso libre de 60 cm desde sus puertas, pasos o
 * llegadas de escalera: inundación en una rejilla de 10 cm con la persona como un círculo de radio 30
 * contra los mismos obstáculos que el recorrido. null si la planta no tiene por dónde entrar.
 */
export function mueblesSinPaso(e: Espacio, p: Planta): string[] | null {
  // Lo colgado en la pared (cuadros, baldas…) no hace falta alcanzarlo andando.
  const objetivo = p.muebles.filter((m) => m.alto > PLANO && m.elevacion < COLGADO && !(tipoMueble(m.tipo).pared && m.elevacion > 0));
  if (!objetivo.length) return [];
  let segs: Segmento[];
  let modelo;
  try {
    segs = obstaculosEn(e, { planta: p.id, escalera: null });
    modelo = modeloPlanta(p);
  } catch (err) {
    if (err instanceof ErrorGeometria) return null;
    throw err;
  }
  const umbrales = modelo.huecos.filter((x) => x.hueco.tipo !== 'ventana').map((x) => ({ x, poligono: huellaHueco(x) }));
  // Semillas: a 31 cm de cada puerta o paso por los dos lados, y en la llegada de las escaleras que llegan.
  const semillas: Punto[] = [];
  for (const { x } of umbrales) {
    const c: Punto = [(x.a[0] + x.b[0]) / 2, (x.a[1] + x.b[1]) / 2];
    const d = PASO_LIBRE / 2 + 1;
    semillas.push([c[0] - x.fuera[0] * d, c[1] - x.fuera[1] * d], [c[0] + x.fuera[0] * (x.profundidad + d), c[1] + x.fuera[1] * (x.profundidad + d)]);
  }
  for (const { desde, escalera } of escalerasQueLlegan(e, p.id)) {
    const z = zonaLlegada(geometriaDe(e, desde, escalera));
    semillas.push([z.reduce((s, q) => s + q[0], 0) / 4, z.reduce((s, q) => s + q[1], 0) / 4]);
  }
  if (!semillas.length) return null;
  const xs = p.estancias.flatMap((s) => s.contorno.map((q) => q[0]));
  const ys = p.estancias.flatMap((s) => s.contorno.map((q) => q[1]));
  const x0 = Math.min(...xs) - 60;
  const y0 = Math.min(...ys) - 60;
  const nx = Math.ceil((Math.max(...xs) + 60 - x0) / REJILLA_PASO) + 1;
  const ny = Math.ceil((Math.max(...ys) + 60 - y0) / REJILLA_PASO) + 1;
  const centro = (i: number, j: number): Punto => [x0 + i * REJILLA_PASO, y0 + j * REJILLA_PASO];
  // Cada celda mira sólo los segmentos de su cubeta de 100 cm (cada segmento va a las cubetas que toca
  // ampliadas 30 cm): así el coste no crece con el número de muros y muebles de toda la planta.
  const CUBETA = 100;
  const cx = Math.ceil((nx * REJILLA_PASO) / CUBETA) + 1;
  const cy = Math.ceil((ny * REJILLA_PASO) / CUBETA) + 1;
  const cubetas: Segmento[][] = Array.from({ length: cx * cy }, () => []);
  const margen = RADIO_PASO;
  for (const sg of segs) {
    const i0 = Math.max(0, Math.floor((Math.min(sg[0][0], sg[1][0]) - margen - x0) / CUBETA));
    const i1 = Math.min(cx - 1, Math.floor((Math.max(sg[0][0], sg[1][0]) + margen - x0) / CUBETA));
    const j0 = Math.max(0, Math.floor((Math.min(sg[0][1], sg[1][1]) - margen - y0) / CUBETA));
    const j1 = Math.min(cy - 1, Math.floor((Math.max(sg[0][1], sg[1][1]) + margen - y0) / CUBETA));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cubetas[j * cx + i]!.push(sg);
  }
  const cerca = (q: Punto): Segmento[] => cubetas[Math.floor((q[1] - y0) / CUBETA) * cx + Math.floor((q[0] - x0) / CUBETA)] ?? [];
  const estado = new Int8Array(nx * ny); // 0 sin mirar, 1 libre, 2 ocupada
  const libre = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    const k = j * nx + i;
    if (!estado[k]) {
      const q = centro(i, j);
      const dentro = p.estancias.some((s) => puntoEnPoligono(q, s.contorno)) || umbrales.some((u) => puntoEnPoligono(q, u.poligono));
      estado[k] = dentro && cerca(q).every((s) => distSeg(q, s) >= RADIO_PASO - 1e-6) ? 1 : 2;
    }
    return estado[k] === 1;
  };
  const alcanzada = new Uint8Array(nx * ny);
  const cola: number[] = [];
  for (const s of semillas) {
    const i = Math.round((s[0] - x0) / REJILLA_PASO);
    const j = Math.round((s[1] - y0) / REJILLA_PASO);
    // La celda de la semilla o una vecina libre (la semilla puede caer entre dos).
    for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (libre(i + di, j + dj) && !alcanzada[(j + dj) * nx + i + di]) {
        alcanzada[(j + dj) * nx + i + di] = 1;
        cola.push((j + dj) * nx + i + di);
      }
    }
  }
  while (cola.length) {
    const k = cola.pop()!;
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const kk = (j + dj) * nx + i + di;
      if (libre(i + di, j + dj) && !alcanzada[kk]) {
        alcanzada[kk] = 1;
        cola.push(kk);
      }
    }
  }
  // La primera celda libre delante de un mueble queda a menos de RADIO_PASO + una celda de él
  // (revisión independiente, 1); sólo se miran las celdas de su caja ampliada (5).
  const alcance = RADIO_PASO + REJILLA_PASO + 0.5;
  return objetivo.filter((m) => {
    const pol = esquinasMueble(m);
    const xs = pol.map((q) => q[0]);
    const ys = pol.map((q) => q[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - alcance - x0) / REJILLA_PASO));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(...xs) + alcance - x0) / REJILLA_PASO));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - alcance - y0) / REJILLA_PASO));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(...ys) + alcance - y0) / REJILLA_PASO));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (alcanzada[j * nx + i] && distPol(centro(i, j), pol) <= alcance) return false;
    return true;
  }).map((m) => m.id);
}

/**
 * Centro del mayor círculo de giro de 150 cm que cabe en la estancia (rejilla de 5 cm), lejos de sus
 * paredes y de lo que estorba a una silla de ruedas; null si no cabe.
 */
export function circuloDeGiro(p: Planta, s: Estancia, e?: Espacio): { centro: Punto; holgura: number } | null {
  const r = CIRCULO_GIRO / 2;
  const obstaculos: Punto[][] = [];
  for (const m of p.muebles) {
    if (m.alto <= PLANO || m.elevacion >= COLGADO) continue;
    // Un tablero con hueco debajo (mesa, lavabo) deja pasar los pies y las rodillas.
    if (m.elevacion + m.huecoInferior >= RODILLAS && m.huecoInferior > 0) continue;
    if (m.elevacion >= RODILLAS) continue;
    obstaculos.push(esquinasMueble(m));
  }
  for (const est of p.estancias) {
    for (const el of est.elementos ?? []) {
      if (el.forma !== 'exento' && el.forma !== 'adosado') continue;
      const [z0, z1] = rangoAltura(est, el);
      if (z0 < RODILLAS && z1 > PLANO) obstaculos.push(huellaElemento(est, el)!);
    }
  }
  // Las escaleras: su parte baja (las que suben) y su hueco (las que llegan) no se pisan.
  if (e) {
    for (const esc of p.escaleras ?? []) if (e.plantas.some((x) => x.id === esc.hasta)) obstaculos.push(...parteBaja(geometriaDe(e, p, esc)));
    for (const { desde, escalera } of escalerasQueLlegan(e, p.id)) obstaculos.push(...geometriaDe(e, desde, escalera).hueco);
  }
  const xs = s.contorno.map((q) => q[0]);
  const ys = s.contorno.map((q) => q[1]);
  let mejor: { centro: Punto; holgura: number } | null = null;
  for (let x = Math.min(...xs) + r; x <= Math.max(...xs) - r + 1e-9; x += REJILLA_GIRO) {
    for (let y = Math.min(...ys) + r; y <= Math.max(...ys) - r + 1e-9; y += REJILLA_GIRO) {
      const c: Punto = [x, y];
      if (!puntoEnPoligono(c, s.contorno)) continue;
      let h = distanciaAlContorno(c, s.contorno);
      if (h < r - 1e-6) continue;
      for (const o of obstaculos) {
        h = Math.min(h, distPol(c, o));
        if (h < r - 1e-6) break;
      }
      if (h >= r - 1e-6 && (!mejor || h > mejor.holgura)) mejor = { centro: c, holgura: h };
    }
  }
  return mejor;
}

/**
 * Avisos de acceso de todo el espacio: entrada por las puertas, paso libre y círculo de giro. El paso
 * libre no se mira en las plantas que ya tienen errores (`conErrores`): si algo tapa una puerta o se
 * sale, lo primero es arreglar eso, y el aviso sólo repetiría el problema en cada mueble.
 */
export function analizarAcceso(e: Espacio, conErrores: ReadonlySet<string> = new Set()): IncidenciaAcceso[] {
  const res: IncidenciaAcceso[] = [];
  const pasos = pasosDe(e);
  for (const p of e.plantas) {
    for (const m of p.muebles) {
      const s = estanciaDe(p, m);
      if (!s || m.alto <= PLANO) continue;
      const x = entradaCon(pasos, m, s.id);
      if (x.estado !== 'no-entra') continue;
      const lista = x.noPasa.map((h) => `${h.nombre} (${h.ancho} × ${h.alto})`).join(', ');
      res.push({ regla: 'acceso', mensaje: `«${m.nombre}» (${m.id}) no entra hasta «${s.nombre}»: mide ${m.ancho} × ${m.fondo} × ${m.alto} cm y no pasa por ${lista || 'ningún hueco del camino'}`, muebles: [m.id], planta: p.id });
    }
    const sinPaso = conErrores.has(p.id) ? [] : (mueblesSinPaso(e, p) ?? []);
    for (const id of sinPaso) {
      const m = p.muebles.find((x) => x.id === id)!;
      res.push({ regla: 'acceso', mensaje: `No se llega a «${m.nombre}» (${m.id}) con un paso libre de ${PASO_LIBRE} cm desde la puerta`, muebles: [id], planta: p.id });
    }
    for (const s of p.estancias) {
      if (!s.circuloDeGiro) continue;
      if (!circuloDeGiro(p, s, e)) res.push({ regla: 'giro', mensaje: `En «${s.nombre}» (${s.id}) no cabe un círculo de giro de ${CIRCULO_GIRO} cm (silla de ruedas)`, muebles: [], planta: p.id });
    }
  }
  return res;
}
