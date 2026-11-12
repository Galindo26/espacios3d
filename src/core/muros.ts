// Modelo derivado de una planta (ronda 2): de él salen el 3D, el .glb, las conexiones y el recorrido.
// - La masa de muro se deriva con booleanas: (unión de las estancias desplazadas `grosorExterior`
//   hacia fuera) − (unión de las estancias). Un tabique mide lo que separa de verdad dos estancias.
// - Cada hueco atraviesa la masa desde la cara interior de su estancia hasta salir por el otro lado;
//   lo que hay al otro lado dice con qué conecta (otra estancia o el exterior).
// - Para el 3D, la masa se corta en bandas de altura y en cada banda se restan los huecos activos.
import { areaTotal, diferencia, union, type PoligonoConAgujeros } from './booleanas.js';
import { contornoExterior, puntoEnPoligono } from './geometria.js';
import { geometriaHueco } from './huecos.js';
import type { Hueco, Planta, Punto } from './tipos.js';

/** Un hueco con su paso a través del muro. */
export interface HuecoEnMuro {
  hueco: Hueco;
  /** Estancia en cuyo contorno está definido. */
  estancia: string;
  /** Extremos sobre la cara interior y dirección hacia fuera de su estancia. */
  a: Punto;
  b: Punto;
  fuera: Punto;
  /** Grosor del muro que atraviesa (cm); 0 si ahí no hay muro. Es el mayor de los dos extremos. */
  profundidad: number;
  /** Grosor en el extremo a y en el b (distintos si el muro de enfrente está inclinado). */
  profundidadA: number;
  profundidadB: number;
  /**
   * El hueco no atraviesa un muro limpio: parte de él da a un tabique perpendicular, a una esquina o
   * a dos sitios distintos. El análisis lo avisa.
   */
  dudoso: boolean;
  /** Altura del alféizar y del dintel sobre el suelo de la planta (cm). */
  base: number;
  tope: number;
  /** Estancia al otro lado, o null si da al exterior. */
  da: string | null;
}

/** Puerta o paso que comunica una estancia con otra o con el exterior. */
export interface Conexion {
  hueco: string;
  tipo: Hueco['tipo'];
  de: string;
  a: string;
  /** Grosor del muro que se cruza (cm). */
  grosor: number;
}

/** Masa de muro entre dos alturas, ya sin los huecos que la atraviesan a esa altura. */
export interface BandaMuro {
  y0: number;
  y1: number;
  poligonos: PoligonoConAgujeros[];
}

export interface ModeloPlanta {
  planta: string;
  nivel: number;
  /** Suelo: unión de las estancias. */
  suelo: PoligonoConAgujeros[];
  /** Masa de muro en planta, sin huecos. */
  masa: PoligonoConAgujeros[];
  /** Altura de los muros: la mayor de las estancias de la planta. */
  alturaMuros: number;
  huecos: HuecoEnMuro[];
  conexiones: Conexion[];
  bandas: BandaMuro[];
}

/** Margen (cm) con el que se recortan los huecos para no dejar láminas de redondeo. */
const MARGEN = 0.5;

function dentroDe(p: Punto, ps: readonly PoligonoConAgujeros[]): boolean {
  return ps.some((q) => puntoEnPoligono(p, q.exterior) && !q.agujeros.some((h) => puntoEnPoligono(p, h)));
}

/** Distancia desde `o` en la dirección `d` hasta el primer borde de la masa (sin contar t ≈ 0). */
function salida(o: Punto, d: Punto, masa: readonly PoligonoConAgujeros[]): number {
  let mejor = Infinity;
  for (const p of masa) {
    for (const anillo of [p.exterior, ...p.agujeros]) {
      for (let i = 0; i < anillo.length; i++) {
        const a = anillo[i] as Punto;
        const b = anillo[(i + 1) % anillo.length] as Punto;
        const e: Punto = [b[0] - a[0], b[1] - a[1]];
        const den = d[0] * e[1] - d[1] * e[0];
        if (Math.abs(den) < 1e-12) continue;
        const w: Punto = [a[0] - o[0], a[1] - o[1]];
        const t = (w[0] * e[1] - w[1] * e[0]) / den;
        const s = (w[0] * d[1] - w[1] * d[0]) / den;
        // t > 0,01 cm: la masa está ajustada a una rejilla de 0,001 cm y el rayo sale del contorno sin
        // ajustar; un umbral menor tomaría el propio borde interior como la salida del muro.
        if (t > 0.01 && s >= -1e-9 && s <= 1 + 1e-9 && t < mejor) mejor = t;
      }
    }
  }
  return mejor;
}

const r2 = (n: number): number => Math.round(n * 100) / 100 || 0;

/**
 * Grosor del muro detrás del tramo ab, mirando hacia `fuera`. Cinco rayos a lo largo del tramo: los
 * que no tocan masa no cuentan, y los que se alejan de la mediana tampoco (un rayo que cae en un
 * tabique perpendicular lo recorre entero y daría un grosor absurdo que borraría ese tabique). Con
 * los que quedan se ajusta una recta: el grosor en cada extremo (un muro de enfrente inclinado).
 */
function medirGrosor(a: Punto, b: Punto, fuera: Punto, masa: readonly PoligonoConAgujeros[], maximo: number): { a: number; b: number; dudoso: boolean; centro: [Punto, number] | null } {
  const K = [0.02, 0.26, 0.5, 0.74, 0.98];
  const muestras = K.map((k) => {
    const m: Punto = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    const casi: Punto = [m[0] + fuera[0] * 0.05, m[1] + fuera[1] * 0.05];
    const d = dentroDe(casi, masa) ? salida(m, fuera, masa) : NaN;
    return { k, m, d: Number.isFinite(d) ? d : NaN };
  });
  // Un rayo de más de `maximo` no cruza un muro: recorre uno perpendicular (ningún muro recto mide tanto).
  const validas = muestras.filter((x) => !Number.isNaN(x.d) && x.d <= maximo);
  const descartadas = muestras.some((x) => !Number.isNaN(x.d) && x.d > maximo);
  if (!validas.length) return { a: 0, b: 0, dudoso: false, centro: null };
  const orden = validas.map((x) => x.d).sort((p, q) => p - q);
  const mediana = orden[Math.floor((orden.length - 1) / 2)] as number;
  const tol = Math.max(2, mediana * 0.5);
  const buenas = validas.filter((x) => Math.abs(x.d - mediana) <= tol);
  const dudoso = buenas.length < K.length || descartadas;
  // Recta por mínimos cuadrados (con una sola muestra, constante).
  const n = buenas.length;
  const mk = buenas.reduce((s, x) => s + x.k, 0) / n;
  const md = buenas.reduce((s, x) => s + x.d, 0) / n;
  const sxx = buenas.reduce((s, x) => s + (x.k - mk) ** 2, 0);
  const pend = sxx > 1e-12 ? buenas.reduce((s, x) => s + (x.k - mk) * (x.d - md), 0) / sxx : 0;
  const en = (k: number): number => Math.max(0, md + pend * (k - mk));
  const centro = [...buenas].sort((p, q) => Math.abs(p.k - 0.5) - Math.abs(q.k - 0.5))[0]!;
  return { a: r2(en(0)), b: r2(en(1)), dudoso, centro: [centro.m, centro.d] };
}

/** Masa de muro de una planta. */
export function masaDeMuros(p: Planta): { suelo: PoligonoConAgujeros[]; masa: PoligonoConAgujeros[] } {
  const suelo = union(p.estancias.map((s) => s.contorno));
  if (p.grosorExterior <= 0) return { suelo, masa: [] };
  const exterior = union(p.estancias.map((s) => contornoExterior(s.contorno, p.grosorExterior)));
  return { suelo, masa: diferencia(exterior, suelo) };
}

export function modeloPlanta(p: Planta): ModeloPlanta {
  const { suelo, masa } = masaDeMuros(p);
  const alturaMuros = Math.max(0, ...p.estancias.map((s) => s.altura));
  const huecos: HuecoEnMuro[] = [];
  for (const s of p.estancias) {
    for (const h of s.huecos) {
      const g = geometriaHueco(s.contorno, h);
      const fuera: Punto = [-g.n[0], -g.n[1]];
      const base = h.tipo === 'ventana' ? h.antepecho : 0;
      const grosor = medirGrosor(g.a, g.b, fuera, masa, 4 * Math.max(p.grosorExterior, 1));
      // Lo que hay al otro lado, desde la muestra válida más cercana al centro.
      let da: string | null = null;
      {
        // Sin muro detrás (tabique 0 o grosor 0) se mira justo al otro lado del centro del hueco.
        const [c, d] = grosor.centro ?? [[(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2] as Punto, 0];
        const mas: Punto = [c[0] + fuera[0] * (d + MARGEN), c[1] + fuera[1] * (d + MARGEN)];
        da = p.estancias.find((o) => o.id !== s.id && puntoEnPoligono(mas, o.contorno))?.id ?? null;
      }
      huecos.push({
        hueco: h,
        estancia: s.id,
        a: g.a,
        b: g.b,
        fuera,
        profundidad: Math.max(grosor.a, grosor.b),
        profundidadA: grosor.a,
        profundidadB: grosor.b,
        dudoso: grosor.dudoso,
        base,
        tope: base + h.alto,
        da,
      });
    }
  }
  const conexiones: Conexion[] = huecos
    .filter((x) => x.hueco.tipo !== 'ventana')
    .map((x) => ({ hueco: x.hueco.id, tipo: x.hueco.tipo, de: x.estancia, a: x.da ?? 'exterior', grosor: Math.round(x.profundidad * 10) / 10 }));
  return { planta: p.id, nivel: p.nivel, suelo, masa, alturaMuros, huecos, conexiones, bandas: bandas(masa, huecos, alturaMuros) };
}

/** Trapecio que un hueco recorta en la masa: de la cara interior hasta atravesar el muro en cada extremo. */
export function huellaHueco(x: HuecoEnMuro): Punto[] {
  const { a, b, fuera: f } = x;
  const dentro = MARGEN;
  const fa = x.profundidadA + MARGEN;
  const fb = x.profundidadB + MARGEN;
  return [
    [a[0] - f[0] * dentro, a[1] - f[1] * dentro],
    [b[0] - f[0] * dentro, b[1] - f[1] * dentro],
    [b[0] + f[0] * fb, b[1] + f[1] * fb],
    [a[0] + f[0] * fa, a[1] + f[1] * fa],
  ];
}

function bandas(masa: PoligonoConAgujeros[], huecos: HuecoEnMuro[], alto: number): BandaMuro[] {
  if (!masa.length || alto <= 0) return [];
  const cortes = new Set<number>([0, alto]);
  const conMuro = huecos.filter((x) => x.profundidad > 0);
  for (const x of conMuro) for (const y of [x.base, x.tope]) if (y > 0 && y < alto) cortes.add(y);
  const ys = [...cortes].sort((p, q) => p - q);
  const res: BandaMuro[] = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const y0 = ys[i] as number;
    const y1 = ys[i + 1] as number;
    const activos = conMuro.filter((x) => x.base <= y0 + 1e-9 && x.tope >= y1 - 1e-9);
    const poligonos = activos.length ? diferencia(masa, union(activos.map(huellaHueco))) : masa;
    if (poligonos.length) res.push({ y0, y1, poligonos });
  }
  return res;
}

/** Volumen de muro (cm³) del modelo: suma de las bandas. */
export function volumenMuros(m: ModeloPlanta): number {
  return m.bandas.reduce((s, b) => s + areaTotal(b.poligonos) * (b.y1 - b.y0), 0);
}
