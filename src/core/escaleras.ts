// Escaleras (R2-7, paso b; R3-1): geometría de las cuatro formas (recta, L, U y caracol), altura del
// suelo sobre ellas, cara inferior (lo que cabe debajo), hueco en el forjado de la planta de arriba
// (sólo donde hace falta altura libre), barandillas y análisis en las dos plantas, también con
// escaleras una encima de otra.
//
// Marco local: origen en el centro del borde del pie, F = sentido de subida del primer tramo y
// R = derecha de quien sube. Con +y hacia abajo en el plano, quien sube hacia +y tiene −x a su
// derecha: R = (−F.y, F.x). Un punto local (a, b) es pie + a·R + b·F.
import { alturaTecho, huellaElemento, rangoAltura } from './elementos.js';
import { contornoExterior, convexoDentroDePoligono, solapeConvexos, esquinasMueble, puntoEnPoligono } from './geometria.js';
import { union } from './booleanas.js';
import type { Escalera, Espacio, Planta, Punto } from './tipos.js';
import { TOLERANCIA } from './tipos.js';

const GRAD = Math.PI / 180;
/** Paso libre al pie y en la llegada (cm), como el de una puerta. */
export const ZONA_LIBRE_ESCALERA = 60;
/** Altura de la barandilla (cm). */
export const ALTO_BARANDILLA = 90;
/** Altura libre (cm) que necesita quien sube o pasa por debajo: la usan el hueco, el recorrido y las apiladas. */
export const ALTURA_LIBRE = 200;
/** Losa bajo los peldaños y la meseta de las escaleras recta, L y U (cm). */
export const LOSA_ESCALERA = 20;
/** Grueso de los peldaños volados de la caracol (cm). */
export const GROSOR_PELDANO_CARACOL = 5;
/** Caracol: diámetro del poste y vuelta por defecto. */
export const POSTE_CARACOL = 20;
export const VUELTA_CARACOL = 360;
/** Caracol: ancho de paso (cm) de las zonas libres, por la parte exterior del peldaño. */
export const PASO_CARACOL = 40;

export interface TramoEscalera {
  /** Rectángulo en planta (4 esquinas). */
  rect: Punto[];
  /** Contrahuellas del tramo. */
  peldanos: number;
  /** Cota (cm, desde el suelo de abajo) al empezar y al acabar el tramo. */
  z0: number;
  z1: number;
  /** Eje de subida: punto de arranque (centro del borde de abajo), dirección y largo. */
  inicio: Punto;
  dir: Punto;
  largo: number;
}

/** Caracol: centro, radios, ángulo del pie (rad, atan2 en el plano), sentido (+1 = horario en el plano) y vuelta (rad). */
export interface DatosCaracol {
  centro: Punto;
  rPoste: number;
  rExt: number;
  a0: number;
  s: 1 | -1;
  vuelta: number;
}

export interface GeometriaEscalera {
  forma: Escalera['forma'];
  tramos: TramoEscalera[];
  /** Meseta (L y U), a la cota del final del tramo 1. */
  meseta: { rect: Punto[]; z: number } | null;
  /** Franja del ojo de la U (no se pisa; es hueco arriba). */
  ojo: Punto[] | null;
  /** La caracol (null en las demás). */
  caracol: DatosCaracol | null;
  /** Poste de la caracol (polígono), macizo de suelo a llegada. */
  poste: Punto[] | null;
  /** Polígonos convexos que forman la huella (lo que ocupa abajo): tramos, meseta y ojo, o las cuñas de la caracol. */
  huella: Punto[][];
  /** Polígonos convexos del hueco en el forjado de arriba: la parte de la huella sin altura libre bajo el techo. */
  hueco: Punto[][];
  /** Techo (cm desde el suelo de abajo) con el que se cortó el hueco (Infinity: sin dato, hueco = huella). */
  techo: number;
  pie: [Punto, Punto];
  llegada: [Punto, Punto];
  /** Hacia dónde se sale al llegar arriba (unitario). */
  salida: Punto;
  /** Hacia dónde se entra por el pie (unitario, F). */
  entrada: Punto;
  /** Barandillas: bordes de la huella que no son pie ni llegada, y la separación entre tramos de la U; el arco exterior en la caracol. */
  barandillas: [Punto, Punto][];
  /**
   * Las mismas barandillas en 3D: tramos rectos con la cota del suelo que se pisa (cm) en cada extremo.
   * Se anota al construirlas: deducirla después del punto en planta fallaba en los bordes de una
   * escalera girada (coma flotante) y al cerrar la vuelta de una caracol de 360°.
   */
  pasamanos: Pasamanos[];
  altura: number;
  peldanos: number;
  /** Ancho de cada tramo (cm). */
  ancho: number;
}

/** Tramo recto de barandilla: extremos en planta y cota del suelo que se pisa en cada uno (cm). */
export interface Pasamanos {
  a: Punto;
  b: Punto;
  za: number;
  zb: number;
}

export function peldanosPorDefecto(altura: number, forma: Escalera['forma'] = 'recta'): number {
  return Math.max(1, Math.round(altura / (forma === 'caracol' ? 21 : 18)));
}

/** Reparto de las N contrahuellas entre dos tramos, en proporción a su largo (al menos una en cada uno). */
export function repartirPeldanos(n: number, l1: number, l2: number): [number, number] {
  const n1 = Math.min(n - 1, Math.max(1, Math.round((n * l1) / (l1 + l2))));
  return [n1, n - n1];
}

const mas = (p: Punto, d: Punto, k: number): Punto => [p[0] + d[0] * k, p[1] + d[1] * k];
const r1 = (n: number): number => Math.round(n * 10) / 10;

// ---------- Caracol: puntos por radio y ángulo recorrido ----------

const enCaracol = (c: DatosCaracol, r: number, phi: number): Punto => [c.centro[0] + r * Math.cos(c.a0 + c.s * phi), c.centro[1] + r * Math.sin(c.a0 + c.s * phi)];

/** Arco de radio r entre phi0 y phi1, con segmentos de como mucho 5°. */
function arco(c: DatosCaracol, r: number, phi0: number, phi1: number): Punto[] {
  const n = Math.max(1, Math.ceil(Math.abs(phi1 - phi0) / (5 * GRAD) - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => enCaracol(c, r, phi0 + ((phi1 - phi0) * i) / n));
}

/** Cuñas convexas desde el centro entre phi0 y phi1 (troceadas a como mucho 45°). */
function cunas(c: DatosCaracol, phi0: number, phi1: number): Punto[][] {
  if (phi1 <= phi0 + 1e-9) return [];
  const n = Math.max(1, Math.ceil((phi1 - phi0) / (45 * GRAD) - 1e-9));
  return Array.from({ length: n }, (_, i) => [c.centro, ...arco(c, c.rExt, phi0 + ((phi1 - phi0) * i) / n, phi0 + ((phi1 - phi0) * (i + 1)) / n)]);
}

/** Radio y ángulo recorrido desde el pie (en [0, 2π)) de un punto respecto a la caracol. */
export function faseCaracol(c: DatosCaracol, p: Punto): { r: number; phi: number } {
  const dx = p[0] - c.centro[0];
  const dy = p[1] - c.centro[1];
  const r = Math.hypot(dx, dy);
  let phi = (c.s * (Math.atan2(dy, dx) - c.a0)) % (2 * Math.PI);
  if (phi < 0) phi += 2 * Math.PI;
  if (phi > 2 * Math.PI - 1e-9) phi = 0;
  return { r, phi };
}

export function geometriaEscalera(esc: Escalera, altura: number, techo = Infinity): GeometriaEscalera {
  const g = esc.giro * GRAD;
  // Con giro 0, F = (0, 1); el giro es horario en planta con y hacia abajo (como ejesMueble).
  const F: Punto = [-Math.sin(g), Math.cos(g)];
  const R: Punto = [-F[1], F[0]];
  const pie0: Punto = [esc.x, esc.y];
  const P = (a: number, b: number): Punto => [pie0[0] + a * R[0] + b * F[0], pie0[1] + a * R[1] + b * F[1]];
  const rect = (a0: number, a1: number, b0: number, b1: number): Punto[] => [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)];
  const w = esc.ancho;
  const h = w / 2;
  const N = esc.peldanos ?? peldanosPorDefecto(altura, esc.forma);
  const tramos: TramoEscalera[] = [];
  let meseta: GeometriaEscalera['meseta'] = null;
  let ojo: Punto[] | null = null;
  let caracol: DatosCaracol | null = null;
  let poste: Punto[] | null = null;
  let huella: Punto[][] | null = null;
  let llegada: [Punto, Punto];
  let salida: Punto;
  const bar: [Punto, Punto][] = [];
  const lado = (a0: number, b0: number, a1: number, b1: number): void => {
    bar.push([P(a0, b0), P(a1, b1)]);
  };
  const pas: Pasamanos[] = [];
  const lado3 = (a0: number, b0: number, a1: number, b1: number, za: number, zb: number): void => {
    pas.push({ a: P(a0, b0), b: P(a1, b1), za, zb });
  };
  if (esc.forma === 'recta') {
    const L = esc.largo ?? 0;
    lado3(-h, 0, -h, L, 0, altura);
    lado3(h, 0, h, L, 0, altura);
    tramos.push({ rect: rect(-h, h, 0, L), peldanos: N, z0: 0, z1: altura, inicio: P(0, 0), dir: F, largo: L });
    llegada = [P(-h, L), P(h, L)];
    salida = F;
    lado(-h, 0, -h, L);
    lado(h, 0, h, L);
  } else if (esc.forma === 'caracol') {
    // El centro, a la mano de giro; el pie es el radio del ángulo de salida, del poste al borde.
    const s: 1 | -1 = esc.gira === 'izquierda' ? -1 : 1;
    const rPoste = (esc.poste ?? POSTE_CARACOL) / 2;
    const centro = P(s * (rPoste + h), 0);
    // Del centro al pie: −s·R. Con s = +1 el ángulo crece hacia F (horario en el plano, y hacia abajo).
    const a0 = Math.atan2(-s * R[1], -s * R[0]);
    const vuelta = (esc.vuelta ?? VUELTA_CARACOL) * GRAD;
    caracol = { centro, rPoste, rExt: rPoste + w, a0, s, vuelta };
    const c = caracol;
    huella = cunas(c, 0, vuelta);
    llegada = [enCaracol(c, c.rExt, vuelta), enCaracol(c, rPoste, vuelta)];
    const af = a0 + s * vuelta;
    salida = [-s * Math.sin(af), s * Math.cos(af)];
    const ext = arco(c, c.rExt, 0, vuelta);
    for (let i = 0; i + 1 < ext.length; i++) {
      bar.push([ext[i]!, ext[i + 1]!]);
      pas.push({ a: ext[i]!, b: ext[i + 1]!, za: (altura * i) / (ext.length - 1), zb: (altura * (i + 1)) / (ext.length - 1) });
    }
    poste = Array.from({ length: 24 }, (_, i) => [centro[0] + rPoste * Math.cos((i / 24) * 2 * Math.PI), centro[1] + rPoste * Math.sin((i / 24) * 2 * Math.PI)] as Punto);
  } else {
    const [l1, l2] = esc.tramos ?? [0, 0];
    const s = esc.gira === 'izquierda' ? -1 : 1;
    const [n1, n2] = repartirPeldanos(N, l1, l2);
    const zm = (n1 * altura) / N;
    tramos.push({ rect: rect(-h, h, 0, l1), peldanos: n1, z0: 0, z1: zm, inicio: P(0, 0), dir: F, largo: l1 });
    if (esc.forma === 'L') {
      meseta = { rect: rect(-h, h, l1, l1 + w), z: zm };
      // Tramo 2 hacia s·R desde el borde lateral de la meseta.
      const a0 = s * h;
      const a1 = s * (h + l2);
      tramos.push({ rect: rect(Math.min(a0, a1), Math.max(a0, a1), l1, l1 + w), peldanos: n2, z0: zm, z1: altura, inicio: P(a0, l1 + h), dir: [s * R[0], s * R[1]], largo: l2 });
      llegada = [P(a1, l1), P(a1, l1 + w)];
      salida = [s * R[0], s * R[1]];
      // Barandillas: lado exterior del tramo 1 y de la meseta, fondo de la meseta y los dos lados del tramo 2.
      lado(-s * h, 0, -s * h, l1 + w);
      lado(-s * h, l1 + w, a1, l1 + w);
      lado(s * h, 0, s * h, l1);
      lado(a0, l1, a1, l1);
      lado3(-s * h, 0, -s * h, l1, 0, zm);
      lado3(-s * h, l1, -s * h, l1 + w, zm, zm);
      lado3(-s * h, l1 + w, s * h, l1 + w, zm, zm);
      lado3(s * h, l1 + w, a1, l1 + w, zm, altura);
      lado3(s * h, 0, s * h, l1, 0, zm);
      lado3(a0, l1, a1, l1, zm, altura);
    } else {
      const o = esc.ojo ?? 0;
      const ancho2 = 2 * w + o;
      // Meseta de lado a lado y tramo 2 de vuelta (hacia −F) al otro lado del ojo.
      const am0 = s < 0 ? -h - o - w : -h;
      meseta = { rect: rect(am0, am0 + ancho2, l1, l1 + w), z: zm };
      const c2 = s * (w + o); // centro del tramo 2
      tramos.push({ rect: rect(c2 - h, c2 + h, l1 - l2, l1), peldanos: n2, z0: zm, z1: altura, inicio: P(c2, l1), dir: [-F[0], -F[1]], largo: l2 });
      if (o > 0) ojo = rect(Math.min(s * h, s * (h + o)), Math.max(s * h, s * (h + o)), Math.max(0, l1 - l2), l1);
      llegada = [P(c2 - h, l1 - l2), P(c2 + h, l1 - l2)];
      salida = [-F[0], -F[1]];
      // Barandillas: exterior del tramo 1, fondo y lados de la meseta, exterior del tramo 2 y la
      // separación entre tramos (aunque el ojo sea 0, el desnivel llega a la altura entera).
      lado(-s * h, 0, -s * h, l1 + w);
      lado(-s * h, l1 + w, s * (h + o + w), l1 + w);
      lado(s * (h + o + w), l1 + w, s * (h + o + w), l1 - l2);
      lado(s * h, 0, s * h, l1);
      lado(s * (h + o), l1 - l2, s * (h + o), l1);
      lado3(-s * h, 0, -s * h, l1, 0, zm);
      lado3(-s * h, l1, -s * h, l1 + w, zm, zm);
      lado3(-s * h, l1 + w, s * (h + o + w), l1 + w, zm, zm);
      lado3(s * (h + o + w), l1 + w, s * (h + o + w), l1, zm, zm);
      lado3(s * (h + o + w), l1, s * (h + o + w), l1 - l2, zm, altura);
      lado3(s * h, 0, s * h, l1, 0, zm);
      lado3(s * (h + o), l1 - l2, s * (h + o), l1, altura, zm);
    }
  }
  huella ??= [...tramos.map((t) => t.rect), ...(meseta ? [meseta.rect] : []), ...(ojo ? [ojo] : [])];
  const geo: GeometriaEscalera = { forma: esc.forma, tramos, meseta, ojo, caracol, poste, huella, hueco: huella, techo, pie: [P(-h, 0), P(h, 0)], llegada, salida, entrada: F, barandillas: bar, pasamanos: pas, altura, peldanos: N, ancho: w };
  geo.hueco = huecoEscalera(geo, techo);
  return geo;
}

/** Centro de la huella (media de sus vértices): cae dentro de la escalera. */
function centroHuella(geo: GeometriaEscalera): Punto {
  const v = geo.huella.flat();
  return [v.reduce((s, q) => s + q[0], 0) / v.length, v.reduce((s, q) => s + q[1], 0) / v.length];
}

/** Estancia de abajo que contiene la escalera (por el centro de su huella; si no, la del pie). */
export function estanciaDeEscalera(desde: Planta, esc: Escalera, geo: GeometriaEscalera): Planta['estancias'][number] | null {
  const c = centroHuella(geo);
  return desde.estancias.find((x) => puntoEnPoligono(c, x.contorno)) ?? desde.estancias.find((x) => puntoEnPoligono([esc.x, esc.y], x.contorno)) ?? null;
}

/**
 * Techo (cm) de la estancia de abajo que contiene la escalera (revisión independiente de la ronda 3, 5: antes
 * era la del punto del pie, que puede caer en la linde con otra), o el más alto de la planta.
 */
export function techoEscalera(desde: Planta, esc: Escalera, geo?: GeometriaEscalera): number {
  const s = geo ? estanciaDeEscalera(desde, esc, geo) : desde.estancias.find((x) => puntoEnPoligono([esc.x, esc.y], x.contorno));
  return s?.altura ?? Math.max(0, ...desde.estancias.map((x) => x.altura));
}

/** Geometría de una escalera de un espacio: con su altura (la de su destino) y el techo de abajo (para el hueco). */
export function geometriaDe(e: Espacio, desde: Planta, esc: Escalera): GeometriaEscalera {
  const altura = alturaEscalera(e, desde, esc);
  return geometriaEscalera(esc, altura, techoEscalera(desde, esc, geometriaEscalera(esc, altura)));
}

/** Rectángulo de un tramo entre las distancias s0 y s1 de su eje. */
function trozoTramo(t: TramoEscalera, ancho: number, s0: number, s1: number): Punto[] {
  const perp: Punto = [-t.dir[1], t.dir[0]];
  const c0 = mas(t.inicio, t.dir, s0);
  const c1 = mas(t.inicio, t.dir, s1);
  return [mas(c0, perp, -ancho / 2), mas(c0, perp, ancho / 2), mas(c1, perp, ancho / 2), mas(c1, perp, -ancho / 2)];
}

/**
 * Hueco del forjado de arriba: la parte de la huella donde quien sube no tendría ALTURA_LIBRE bajo el
 * techo de abajo (cota de la rampa > techo − ALTURA_LIBRE). Sin techo conocido, o si el corte queda
 * en el suelo, la huella entera.
 */
export function huecoEscalera(geo: GeometriaEscalera, techo: number): Punto[][] {
  // Un techo de abajo más alto que la planta de arriba (pisos que se pisan) no deja el hueco vacío
  // (revisión independiente de la ronda 3, 6).
  const zc = Math.min(techo, geo.altura) - ALTURA_LIBRE;
  if (!Number.isFinite(zc) || zc <= 0) return geo.huella;
  if (geo.caracol) {
    const c = geo.caracol;
    return cunas(c, Math.min(c.vuelta, Math.max(0, (zc / (geo.altura || 1)) * c.vuelta)), c.vuelta);
  }
  const res: Punto[][] = [];
  for (const t of geo.tramos) {
    if (t.z1 <= zc + 1e-9) continue;
    const s0 = t.z0 >= zc ? 0 : ((zc - t.z0) / (t.z1 - t.z0)) * t.largo;
    res.push(s0 <= 1e-9 ? t.rect : trozoTramo(t, geo.ancho, s0, t.largo));
  }
  if (geo.meseta && geo.meseta.z > zc) {
    res.push(geo.meseta.rect);
    if (geo.ojo) res.push(geo.ojo);
  }
  return res;
}

// ---------- Pertenencia y cotas ----------

/** Dentro de un polígono convexo (cualquier orientación), con tolerancia en los lados. */
const dentroConvexo = (p: Punto, r: readonly Punto[], tol = 0): boolean => {
  let signo = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-9) continue;
    const d = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / l;
    if (Math.abs(d) <= tol) continue;
    const s = Math.sign(d);
    if (signo && s !== signo) return false;
    signo = s;
  }
  return true;
};

/** ¿Está p sobre la escalera (tramos, meseta o peldaños de la caracol; el ojo y el poste no se pisan)? */
export function sobreEscalera(geo: GeometriaEscalera, p: Punto, tol = 0): boolean {
  if (geo.caracol) {
    const c = geo.caracol;
    const { r, phi } = faseCaracol(c, p);
    return r >= c.rPoste - tol && r <= c.rExt + tol && phi <= c.vuelta + 1e-9;
  }
  return geo.tramos.some((t) => dentroConvexo(p, t.rect, tol)) || (!!geo.meseta && dentroConvexo(p, geo.meseta.rect, tol));
}

/** ¿Está p dentro de la huella (con el ojo y el poste)? */
export function enHuella(geo: GeometriaEscalera, p: Punto, tol = 0): boolean {
  return geo.huella.some((r) => dentroConvexo(p, r, tol));
}

/** ¿Está p dentro del hueco de arriba? */
export function enHueco(geo: GeometriaEscalera, p: Punto, tol = 0): boolean {
  return geo.hueco.some((r) => dentroConvexo(p, r, tol));
}

/** ¿Está p dentro de alguno de los polígonos convexos? */
export function enConvexos(pols: readonly Punto[][], p: Punto, tol = 0): boolean {
  return pols.some((r) => dentroConvexo(p, r, tol));
}

/**
 * Cota del suelo (cm, desde el suelo de abajo) en p: rampa lineal en cada tramo según su eje, meseta
 * plana y, en la caracol, rampa por el ángulo. null si p no está sobre la escalera. La usan el
 * recorrido, las rampas de colisión y las pruebas.
 */
export function alturaEnEscalera(geo: GeometriaEscalera, p: Punto): number | null {
  if (geo.caracol) {
    const c = geo.caracol;
    const { r, phi } = faseCaracol(c, p);
    if (r < c.rPoste - 1e-6 || r > c.rExt + 1e-6 || phi > c.vuelta + 1e-9) return null;
    return (geo.altura * phi) / c.vuelta;
  }
  if (geo.meseta && dentroConvexo(p, geo.meseta.rect)) return geo.meseta.z;
  for (const t of geo.tramos) {
    if (!dentroConvexo(p, t.rect)) continue;
    const s = ((p[0] - t.inicio[0]) * t.dir[0] + (p[1] - t.inicio[1]) * t.dir[1]) / (t.largo || 1);
    return t.z0 + Math.max(0, Math.min(1, s)) * (t.z1 - t.z0);
  }
  return null;
}

/**
 * Cara inferior de la escalera en p (cm desde el suelo de abajo): lo que cabe debajo. 0 donde es
 * maciza (los primeros peldaños, el poste); null fuera de la huella. En el ojo de la U, la altura entera.
 */
export function bajoEscalera(geo: GeometriaEscalera, p: Punto): number | null {
  if (geo.caracol) {
    const c = geo.caracol;
    const { r, phi } = faseCaracol(c, p);
    if (r > c.rExt + 1e-6 || phi > c.vuelta + 1e-9) return null;
    if (r < c.rPoste) return 0;
    const k = Math.min(geo.peldanos - 1, Math.floor((phi / c.vuelta) * geo.peldanos));
    return Math.max(0, ((k + 1) * geo.altura) / geo.peldanos - GROSOR_PELDANO_CARACOL);
  }
  for (const t of geo.tramos) {
    if (!dentroConvexo(p, t.rect, 1e-6)) continue;
    const s = (p[0] - t.inicio[0]) * t.dir[0] + (p[1] - t.inicio[1]) * t.dir[1];
    const k = Math.max(0, Math.min(t.peldanos - 1, Math.floor((s / (t.largo || 1)) * t.peldanos)));
    return Math.max(0, t.z0 + (k * (t.z1 - t.z0)) / t.peldanos - LOSA_ESCALERA);
  }
  if (geo.meseta && dentroConvexo(p, geo.meseta.rect, 1e-6)) return Math.max(0, geo.meseta.z - LOSA_ESCALERA);
  if (geo.ojo && dentroConvexo(p, geo.ojo, 1e-6)) return geo.altura;
  return null;
}

/**
 * Parte baja de la huella: donde la cara inferior queda por debajo de ALTURA_LIBRE (no se pasa por
 * debajo). En la planta de abajo es la barrera de la escalera, salvo el pie.
 */
export function parteBaja(geo: GeometriaEscalera): Punto[][] {
  if (geo.caracol) {
    const c = geo.caracol;
    const ch = geo.altura / geo.peldanos;
    let k = 0;
    while (k < geo.peldanos && (k + 1) * ch - GROSOR_PELDANO_CARACOL < ALTURA_LIBRE - 1e-9) k++;
    return cunas(c, 0, (k / geo.peldanos) * c.vuelta);
  }
  const res: Punto[][] = [];
  for (const t of geo.tramos) {
    const ch = (t.z1 - t.z0) / t.peldanos;
    let k = 0;
    while (k < t.peldanos && t.z0 + k * ch - LOSA_ESCALERA < ALTURA_LIBRE - 1e-9) k++;
    if (k >= t.peldanos) res.push(t.rect);
    else if (k > 0) res.push(trozoTramo(t, geo.ancho, 0, (k * t.largo) / t.peldanos));
  }
  if (geo.meseta && geo.meseta.z - LOSA_ESCALERA < ALTURA_LIBRE) res.push(geo.meseta.rect);
  if (geo.ojo && geo.altura < ALTURA_LIBRE) res.push(geo.ojo);
  return res;
}

/** Tramo del borde por el que se pasa en la caracol: los PASO_CARACOL cm exteriores (junto al poste no se pisa). */
function bordeDePaso(c: DatosCaracol, phi: number): [Punto, Punto] {
  return [enCaracol(c, c.rExt, phi), enCaracol(c, Math.max(c.rPoste, c.rExt - PASO_CARACOL), phi)];
}

/** Zona libre de 60 cm delante del pie (rectángulo, hacia fuera de la escalera). */
export function zonaPie(geo: GeometriaEscalera): Punto[] {
  const [a, b] = geo.caracol ? bordeDePaso(geo.caracol, 0) : geo.pie;
  const [ex, ey] = geo.entrada;
  const d = ZONA_LIBRE_ESCALERA;
  return [[a[0] - ex * d, a[1] - ey * d], [b[0] - ex * d, b[1] - ey * d], b, a];
}

/** Zona libre de 60 cm al llegar arriba. */
export function zonaLlegada(geo: GeometriaEscalera): Punto[] {
  const [a, b] = geo.caracol ? bordeDePaso(geo.caracol, geo.caracol.vuelta) : geo.llegada;
  const [sx, sy] = geo.salida;
  const d = ZONA_LIBRE_ESCALERA;
  return [a, b, [b[0] + sx * d, b[1] + sy * d], [a[0] + sx * d, a[1] + sy * d]];
}

/** Altura que salva una escalera (cm): la diferencia de niveles con su planta de destino. */
export function alturaEscalera(e: Espacio, desde: Planta, esc: Escalera): number {
  const dest = e.plantas.find((p) => p.id === esc.hasta);
  return dest ? dest.nivel - desde.nivel : 0;
}

/** Escaleras que llegan a una planta, con su planta de origen. */
export function escalerasQueLlegan(e: Espacio, plantaId: string): { desde: Planta; escalera: Escalera }[] {
  return e.plantas.flatMap((p) => (p.escaleras ?? []).filter((x) => x.hasta === plantaId).map((x) => ({ desde: p, escalera: x })));
}

/** Planta inmediatamente superior a `p` por nivel (null si no hay). */
export function plantaDeEncima(e: Espacio, p: Planta): Planta | null {
  const arriba = e.plantas.filter((x) => x.nivel > p.nivel).sort((a, b) => a.nivel - b.nivel);
  return arriba[0] ?? null;
}

export interface IncidenciaEscalera {
  gravedad: 'error' | 'aviso';
  mensaje: string;
  planta: string;
  escalera: string;
  muebles: string[];
}

/** ¿Están todos los polígonos dentro del suelo de una sola estancia de la planta? */
function enUnaEstancia(p: Planta, rs: Punto[][]): boolean {
  return p.estancias.some((s) => rs.every((r) => convexoDentroDePoligono(r, s.contorno)));
}

const solapa = (a: readonly Punto[][], b: readonly Punto[][]): boolean => a.some((r) => b.some((q) => r.length >= 3 && q.length >= 3 && solapeConvexos(r, q) > TOLERANCIA));

/** Puntos de un polígono convexo para muestrear: rejilla de `paso` cm y bordes, un poco hacia dentro. */
function muestras(pol: readonly Punto[], paso: number): Punto[] {
  const xs = pol.map((q) => q[0]);
  const ys = pol.map((q) => q[1]);
  const res: Punto[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs) + 1e-9; x += paso) {
    for (let y = Math.min(...ys); y <= Math.max(...ys) + 1e-9; y += paso) if (dentroConvexo([x, y], pol, 1e-6)) res.push([x, y]);
  }
  for (let i = 0; i < pol.length; i++) {
    const a = pol[i]!;
    const b = pol[(i + 1) % pol.length]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / paso));
    for (let k = 0; k < n; k++) res.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  // Un poco hacia dentro (0,5 mm), para que tocar a ras no cuente como estar debajo.
  const cx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const cy = ys.reduce((s, v) => s + v, 0) / ys.length;
  return res.map(([x, y]) => {
    const l = Math.hypot(cx - x, cy - y) || 1;
    return [x + ((cx - x) / l) * 0.05, y + ((cy - y) / l) * 0.05] as Punto;
  });
}

/** Menor cara inferior de la escalera sobre un polígono convexo (null si no pasa por encima de él). */
export function bajoMinimo(geo: GeometriaEscalera, pol: readonly Punto[]): number | null {
  let min: number | null = null;
  // Además de la rejilla del mueble, las esquinas de la escalera que caen dentro de él (una esquina de la
  // meseta que muerde 1 cm no la ve una rejilla de 5 cm: revisión independiente de la ronda 3, 7).
  const esquinas: Punto[] = [];
  for (const r of geo.huella) {
    const cx = r.reduce((s, q) => s + q[0], 0) / r.length;
    const cy = r.reduce((s, q) => s + q[1], 0) / r.length;
    for (const v of r) if (dentroConvexo(v, pol, 1e-6)) esquinas.push([v[0] + (cx - v[0]) * 1e-3, v[1] + (cy - v[1]) * 1e-3]);
  }
  for (const q of [...muestras(pol, 5), ...esquinas]) {
    if (!enHuella(geo, q)) continue;
    const b = bajoEscalera(geo, q);
    if (b !== null && (min === null || b < min)) min = b;
  }
  return min;
}

/** Mayor cota de la rampa sobre un polígono convexo (null si no pisa la escalera: sólo el ojo o el poste). */
export function cimaMaxima(geo: GeometriaEscalera, pol: readonly Punto[]): number | null {
  let max: number | null = null;
  const esquinas: Punto[] = [];
  for (const r of geo.huella) {
    const cx = r.reduce((s, q) => s + q[0], 0) / r.length;
    const cy = r.reduce((s, q) => s + q[1], 0) / r.length;
    for (const v of r) if (dentroConvexo(v, pol, 1e-6)) esquinas.push([v[0] + (cx - v[0]) * 1e-3, v[1] + (cy - v[1]) * 1e-3]);
  }
  for (const q of [...muestras(pol, 5), ...esquinas]) {
    const z = alturaEnEscalera(geo, q);
    if (z !== null && (max === null || z > max)) max = z;
  }
  return max;
}

/**
 * Altura libre (cm) entre una escalera de abajo y otra que pasa por encima de ella: lo menos que hay
 * entre la rampa de la de abajo y la cara inferior de la de arriba, muestreando cada 10 cm donde se
 * cruzan. `dz` es el nivel de la planta de la de arriba menos el de la de abajo. null si no se cruzan.
 */
export function alturaLibreEntre(abajo: GeometriaEscalera, arriba: GeometriaEscalera, dz: number): number | null {
  let min: number | null = null;
  for (const r of arriba.huella) {
    if (!abajo.huella.some((q) => solapeConvexos(r, q) > TOLERANCIA)) continue;
    for (const q of muestras(r, 10)) {
      const z = alturaEnEscalera(abajo, q);
      const b = bajoEscalera(arriba, q);
      if (z === null || b === null) continue;
      const libre = dz + b - z;
      if (min === null || libre < min) min = libre;
    }
  }
  return min;
}

/** Análisis de las escaleras de un espacio, en la planta de abajo y en la de arriba. */
export function analizarEscaleras(e: Espacio): IncidenciaEscalera[] {
  const res: IncidenciaEscalera[] = [];
  const geos = new Map<string, GeometriaEscalera>();
  const origen = new Map<string, Planta>();
  for (const p of e.plantas) {
    for (const esc of p.escaleras ?? []) {
      if (!e.plantas.some((x) => x.id === esc.hasta)) continue;
      geos.set(esc.id, geometriaDe(e, p, esc));
      origen.set(esc.id, p);
    }
  }
  const obraEn = (pl: Planta): { id: string; huella: Punto[]; base: number; tope: number }[] =>
    pl.estancias.flatMap((s) =>
      (s.elementos ?? []).flatMap((el) => {
        const hh = huellaElemento(s, el);
        const [base, tope] = rangoAltura(s, el);
        return hh && hh.length >= 3 ? [{ id: el.id, huella: hh, base, tope }] : [];
      }),
    );
  for (const p of e.plantas) {
    for (const esc of p.escaleras ?? []) {
      const dest = e.plantas.find((x) => x.id === esc.hasta);
      const geo = geos.get(esc.id);
      if (!dest || !geo) continue; // lo dice la validación
      const n = `La escalera «${esc.id}»`;
      const err = (planta: Planta, mensaje: string, muebles: string[] = []): void => void res.push({ gravedad: 'error', mensaje, planta: planta.id, escalera: esc.id, muebles });
      const aviso = (planta: Planta, mensaje: string): void => void res.push({ gravedad: 'aviso', mensaje, planta: planta.id, escalera: esc.id, muebles: [] });
      const choca = (pl: Planta, zona: Punto[][]): { muebles: string[]; obra: string[] } => ({
        // Lo que empieza por encima de la altura libre (una viga de techo, algo colgado alto) no tapa el paso.
        muebles: pl.muebles.filter((m) => m.elevacion < ALTURA_LIBRE - TOLERANCIA && solapa([esquinasMueble(m)], zona)).map((m) => m.id),
        obra: obraEn(pl).filter((o) => o.base < ALTURA_LIBRE - TOLERANCIA && solapa([o.huella], zona)).map((o) => o.id),
      });
      // Abajo: la huella en el suelo de una estancia; debajo, sólo lo que quepa bajo la cara inferior.
      if (!enUnaEstancia(p, geo.huella)) err(p, `${n} no cabe entera en el suelo de una estancia (se sale o cruza un tabique)`);
      // Lo que va de `base` a `tope` sobre la huella: o cabe debajo de la escalera, o queda por encima
      // de quien sube con la altura libre (una viga de techo, algo colgado alto), o estorba.
      const noCabe = (pol: Punto[], base: number, tope: number, id: string): string | null => {
        if (!solapa([pol], geo.huella)) return null;
        const bajo = bajoMinimo(geo, pol);
        if (bajo === null || tope <= bajo + TOLERANCIA) return null;
        const cima = cimaMaxima(geo, pol);
        if (cima !== null && base >= cima - TOLERANCIA) {
          if (base >= cima + ALTURA_LIBRE - TOLERANCIA) return null;
          return `!${id} queda a ${r1(base - cima)} cm sobre la escalera (hacen falta ${ALTURA_LIBRE})`;
        }
        return `${id} llega a ${r1(tope)} cm y debajo hay ${r1(bajo)}`;
      };
      const mu = p.muebles.map((m) => ({ id: m.id, d: noCabe(esquinasMueble(m), m.elevacion, m.elevacion + m.alto, m.id) })).filter((x) => x.d);
      const ob = obraEn(p).map((o) => ({ id: o.id, d: noCabe(o.huella, o.base, o.tope, o.id) })).filter((x) => x.d);
      // Con «!» delante, lo que queda por encima sin altura libre; sin él, lo que no cabe debajo.
      const detalle = (xs: { d: string | null }[], debajo: string): string => {
        const bajo = xs.filter((x) => !x.d!.startsWith('!')).map((x) => x.d);
        const sobre = xs.filter((x) => x.d!.startsWith('!')).map((x) => x.d!.slice(1));
        return [...(bajo.length ? [`${debajo}: ${bajo.join('; ')}`] : []), ...sobre].join('; ');
      };
      if (ob.length) err(p, `${n} choca con obra: ${ob.map((x) => x.id).join(', ')} (${detalle(ob, 'no cabe debajo')})`);
      if (mu.length) err(p, `${n} tiene muebles encima: ${mu.map((x) => x.id).join(', ')} (${detalle(mu, 'no caben debajo')})`, mu.map((x) => x.id));
      const pie = zonaPie(geo);
      if (!p.estancias.some((s) => convexoDentroDePoligono(pie, s.contorno))) err(p, `${n}: delante del pie no hay ${ZONA_LIBRE_ESCALERA} cm de suelo libre (arranca contra una pared)`);
      let c = choca(p, [pie]);
      if (c.muebles.length || c.obra.length) err(p, `${n}: el paso de ${ZONA_LIBRE_ESCALERA} cm delante del pie está tapado por ${[...c.muebles, ...c.obra].join(', ')}`, c.muebles);
      if (solapa([pie], parteBaja(geo))) err(p, `${n}: delante del pie está la propia escalera, sin altura para pasar por debajo (dale menos vuelta o más diámetro)`);
      // Abajo, con las demás: no se solapan en la misma planta, ni se arranca sobre un hueco.
      for (const o of p.escaleras ?? []) {
        const go = geos.get(o.id);
        if (!go || o.id === esc.id) continue;
        if (o.id > esc.id && solapa(geo.huella, go.huella)) err(p, `Las escaleras «${esc.id}» y «${o.id}» se solapan`);
        if (solapa([pie], parteBaja(go))) err(p, `${n}: delante del pie está la escalera «${o.id}»`);
      }
      for (const { escalera: o } of escalerasQueLlegan(e, p.id)) {
        const go = geos.get(o.id);
        const po = origen.get(o.id);
        if (!go || !po) continue;
        if (solapa([pie], go.hueco)) err(p, `${n} arranca sobre el hueco de «${o.id}»: el pie tiene que dar a suelo firme`);
        // Sólo tapa la llegada su parte baja: bajo la alta se pasa (revisión independiente de la ronda 3, 2).
        if (solapa([zonaLlegada(go)], parteBaja(geo))) err(p, `${n} tapa la llegada de «${o.id}»${geo.caracol && go.caracol ? ' (gira la de arriba unos 60° más para dejarla libre)' : ''}`);
        // Una encima de otra: altura libre entre la de abajo (que llega aquí) y esta.
        const libre = alturaLibreEntre(go, geo, p.nivel - po.nivel);
        if (libre !== null && libre < ALTURA_LIBRE - TOLERANCIA) err(p, `${n} pasa por encima de «${o.id}» con ${r1(libre)} cm libres (hacen falta ${ALTURA_LIBRE})`);
      }
      // Arriba: el hueco en el suelo de una estancia, sin nada encima; la llegada con su paso libre.
      if (!enUnaEstancia(dest, geo.hueco)) err(dest, `El hueco de ${n.toLowerCase()} no cae entero en el suelo de una estancia de «${dest.nombre}»`);
      c = choca(dest, geo.hueco);
      if (c.obra.length) err(dest, `El hueco de ${n.toLowerCase()} choca con obra: ${c.obra.join(', ')}`);
      if (c.muebles.length) err(dest, `Hay muebles sobre el hueco de ${n.toLowerCase()}: ${c.muebles.join(', ')}`, c.muebles);
      const lle = zonaLlegada(geo);
      if (!dest.estancias.some((s) => convexoDentroDePoligono(lle, s.contorno))) err(dest, `${n}: al llegar arriba no hay ${ZONA_LIBRE_ESCALERA} cm de suelo libre`);
      c = choca(dest, [lle]);
      if (c.muebles.length || c.obra.length) err(dest, `${n}: el paso de ${ZONA_LIBRE_ESCALERA} cm al llegar arriba está tapado por ${[...c.muebles, ...c.obra].join(', ')}`, c.muebles);
      if (solapa([lle], geo.hueco)) err(dest, `${n}: al llegar arriba, el paso de ${ZONA_LIBRE_ESCALERA} cm cae sobre su propio hueco (dale más vuelta o más diámetro)`);
      for (const { escalera: o } of escalerasQueLlegan(e, dest.id)) {
        const go = geos.get(o.id);
        if (o.id !== esc.id && go && solapa([lle], go.hueco)) err(dest, `${n}: al llegar arriba, el paso cae sobre el hueco de «${o.id}»`);
      }
      // Techo inclinado (revisión independiente de la ronda 3, 4): sobre la rampa, abajo, y en la llegada, arriba.
      const sAbajo = estanciaDeEscalera(p, esc, geo);
      if (sAbajo?.faldones?.length) {
        let libre = Infinity;
        for (const r of geo.huella) for (const q of muestras(r, 10)) {
          const z = alturaEnEscalera(geo, q);
          if (z !== null) libre = Math.min(libre, alturaTecho(sAbajo, q) - z);
        }
        if (libre < ALTURA_LIBRE - TOLERANCIA) aviso(p, `${n} pasa bajo el techo inclinado de «${sAbajo.nombre}» con ${r1(libre)} cm libres (hacen falta ${ALTURA_LIBRE})`);
      }
      const sArriba = dest.estancias.find((x) => convexoDentroDePoligono(lle, x.contorno));
      if (sArriba?.faldones?.length) {
        const techo = Math.min(...muestras(lle, 10).map((q) => alturaTecho(sArriba, q)));
        if (techo < ALTURA_LIBRE - TOLERANCIA) aviso(dest, `${n}: al llegar arriba, el techo inclinado de «${sArriba.nombre}» está a ${r1(techo)} cm (hacen falta ${ALTURA_LIBRE})`);
      }
      // Comodidad: huella de cada peldaño y contrahuella.
      const ch = geo.altura / geo.peldanos;
      if (geo.caracol) {
        const hu = (Math.min(geo.caracol.rPoste + 30, geo.caracol.rExt) * geo.caracol.vuelta) / geo.peldanos;
        if (hu < 17 - TOLERANCIA) aviso(p, `${n} tiene peldaños de ${r1(hu)} cm de huella a 30 cm del poste (menos de 17): es muy empinada; dale más vuelta, más diámetro o menos peldaños`);
        if (ch > 24 + TOLERANCIA) aviso(p, `${n} tiene contrahuellas de ${r1(ch)} cm (más de 24): pon más peldaños`);
        if (esc.ancho < 66 - TOLERANCIA) aviso(p, `${n} tiene peldaños de ${esc.ancho} cm de ancho (menos de 66): es estrecha`);
      } else {
        for (const [i, t] of geo.tramos.entries()) {
          const hu = t.largo / t.peldanos;
          if (hu < 22 - TOLERANCIA) aviso(p, `${n}${geo.tramos.length > 1 ? `, tramo ${i + 1},` : ''} tiene peldaños de ${r1(hu)} cm de huella (menos de 22): es muy empinada; alárgala o pon menos peldaños`);
        }
        if (ch > 20 + TOLERANCIA) aviso(p, `${n} tiene contrahuellas de ${r1(ch)} cm (más de 20): pon más peldaños`);
        if (esc.ancho < 80 - TOLERANCIA) aviso(p, `${n} mide ${esc.ancho} cm de ancho (menos de 80): es estrecha`);
      }
    }
  }
  return res;
}

// ---------- Piezas para dibujar (la página y el .glb usan las mismas) ----------

export type Punto3 = [number, number, number];

export type PiezaEscalera =
  | { tipo: 'prisma'; base: Punto[]; agujeros?: Punto[][]; z0: number; z1: number }
  /** Barra de b0 a b1 (cm, z desde el suelo de la planta), de sección `grueso` × `grueso`. */
  | { tipo: 'barra'; a: Punto3; b: Punto3; grueso: number };

/** Barandilla sobre un segmento: pasamanos a ALTO_BARANDILLA sobre el suelo que pisa, en trozos, y postes en los extremos. */
function barandilla(a: Punto, b: Punto, suelo: (p: Punto) => number, postes = true): PiezaEscalera[] {
  const largo = Math.hypot(b[0] - a[0], b[1] - a[1]);
  // Con holgura: el largo de un tramo girado no es exacto y no debe cambiar el número de trozos.
  const n = Math.max(1, Math.ceil(largo / 20 - 1e-6));
  const res: PiezaEscalera[] = [];
  const q = (k: number): Punto => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
  for (let k = 0; k < n; k++) {
    const p0 = q(k);
    const p1 = q(k + 1);
    res.push({ tipo: 'barra', a: [p0[0], p0[1], suelo(p0) + ALTO_BARANDILLA], b: [p1[0], p1[1], suelo(p1) + ALTO_BARANDILLA], grueso: 4 });
  }
  if (postes) for (const p of [a, b]) res.push({ tipo: 'barra', a: [p[0], p[1], suelo(p)], b: [p[0], p[1], suelo(p) + ALTO_BARANDILLA], grueso: 4 });
  return res;
}

/**
 * Peldaños, meseta, poste y barandillas, en la planta de abajo. En la recta, la L y la U, cada peldaño
 * baja hasta una losa de LOSA_ESCALERA bajo su frente (macizo al principio, volado después); en la
 * caracol, peldaños volados de GROSOR_PELDANO_CARACOL alrededor del poste.
 */
export function piezasEscalera(geo: GeometriaEscalera): PiezaEscalera[] {
  const res: PiezaEscalera[] = [];
  if (geo.caracol) {
    const c = geo.caracol;
    const d = c.vuelta / geo.peldanos;
    const ch = geo.altura / geo.peldanos;
    for (let k = 0; k < geo.peldanos; k++) {
      const base = [...arco(c, c.rExt, k * d, (k + 1) * d), ...arco(c, c.rPoste, k * d, (k + 1) * d).reverse()];
      const z1 = (k + 1) * ch;
      res.push({ tipo: 'prisma', base, z0: Math.max(0, z1 - GROSOR_PELDANO_CARACOL), z1 });
      // Pasamanos por el borde exterior siguiendo la rampa, con un poste al empezar cada peldaño.
      // La cota sale del ángulo recorrido, no del punto: al cerrar una vuelta de 360° el punto final
      // coincide en planta con el del pie.
      const ext = arco(c, c.rExt - 2, k * d, (k + 1) * d);
      const z = (i: number): number => (k + i / (ext.length - 1)) * ch;
      for (let i = 0; i + 1 < ext.length; i++) {
        res.push({ tipo: 'barra', a: [ext[i]![0], ext[i]![1], z(i) + ALTO_BARANDILLA], b: [ext[i + 1]![0], ext[i + 1]![1], z(i + 1) + ALTO_BARANDILLA], grueso: 4 });
      }
      const p0 = ext[0]!;
      res.push({ tipo: 'barra', a: [p0[0], p0[1], z1], b: [p0[0], p0[1], z(0) + ALTO_BARANDILLA], grueso: 4 });
    }
    const pf = enCaracol(c, c.rExt - 2, c.vuelta);
    res.push({ tipo: 'barra', a: [pf[0], pf[1], geo.altura], b: [pf[0], pf[1], geo.altura + ALTO_BARANDILLA], grueso: 4 });
    if (geo.poste) res.push({ tipo: 'prisma', base: geo.poste, z0: 0, z1: geo.altura + ALTO_BARANDILLA });
    return res;
  }
  for (const t of geo.tramos) {
    const ch = (t.z1 - t.z0) / t.peldanos;
    for (let k = 0; k < t.peldanos; k++) {
      const base = trozoTramo(t, geo.ancho, (t.largo * k) / t.peldanos, (t.largo * (k + 1)) / t.peldanos);
      res.push({ tipo: 'prisma', base, z0: Math.max(0, t.z0 + k * ch - LOSA_ESCALERA), z1: t.z0 + (k + 1) * ch });
    }
  }
  if (geo.meseta) res.push({ tipo: 'prisma', base: geo.meseta.rect, z0: Math.max(0, geo.meseta.z - LOSA_ESCALERA), z1: geo.meseta.z });
  for (const s of geo.pasamanos) {
    const l2 = (s.b[0] - s.a[0]) ** 2 + (s.b[1] - s.a[1]) ** 2 || 1;
    const cota = (p: Punto): number => s.za + ((s.zb - s.za) * ((p[0] - s.a[0]) * (s.b[0] - s.a[0]) + (p[1] - s.a[1]) * (s.b[1] - s.a[1]))) / l2;
    res.push(...barandilla(s.a, s.b, cota));
  }
  return res;
}

/** Tramos de `a`-`b` que no caen dentro del segmento colineal `c`-`d`. */
export function restarSegmento(a: Punto, b: Punto, c: Punto, d: Punto): [Punto, Punto][] {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (l < 1e-9) return [];
  const u: Punto = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  const fuera = (p: Punto): number => Math.abs((p[0] - a[0]) * u[1] - (p[1] - a[1]) * u[0]);
  if (fuera(c) > 0.5 || fuera(d) > 0.5) return [[a, b]];
  const t = (p: Punto): number => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
  const t0 = Math.max(0, Math.min(t(c), t(d)));
  const t1 = Math.min(l, Math.max(t(c), t(d)));
  if (t1 <= t0 + 1e-6) return [[a, b]];
  const res: [Punto, Punto][] = [];
  if (t0 > 1e-6) res.push([a, mas(a, u, t0)]);
  if (t1 < l - 1e-6) res.push([mas(a, u, t1), b]);
  return res;
}

/** Contornos exteriores de la unión de unos trozos convexos (para dibujar la huella o el hueco sin las juntas). */
export function contornosDe(trozos: readonly Punto[][]): Punto[][] {
  const validos = trozos.filter((p) => p.length >= 3);
  return validos.length ? union(validos).map((p) => p.exterior) : [];
}

/** Bordes de la unión de unos polígonos salvo los tramos que coinciden con `abiertos`. */
export function bordesSalvo(poligonos: readonly Punto[][], abiertos: readonly [Punto, Punto][]): [Punto, Punto][] {
  const validos = poligonos.filter((p) => p.length >= 3);
  if (!validos.length) return [];
  const res: [Punto, Punto][] = [];
  for (const pol of union(validos)) {
    for (const r of [pol.exterior, ...pol.agujeros]) {
      for (let i = 0; i < r.length; i++) {
        let trozos: [Punto, Punto][] = [[r[i]!, r[(i + 1) % r.length]!]];
        for (const [c, d] of abiertos) trozos = trozos.flatMap(([a, b]) => restarSegmento(a, b, c, d));
        res.push(...trozos);
      }
    }
  }
  return res;
}

/**
 * El hueco en la planta de arriba: su contorno (unión de los trozos del hueco), el canto del forjado
 * alrededor (de `-canto` a 0) y la barandilla por todo el borde salvo la llegada.
 */
export function piezasHueco(geo: GeometriaEscalera, canto: number): { contornos: Punto[][]; piezas: PiezaEscalera[] } {
  if (!geo.hueco.length) return { contornos: [], piezas: [] };
  const u = union(geo.hueco);
  const contornos = u.map((p) => p.exterior);
  const piezas: PiezaEscalera[] = [];
  if (canto > 0) for (const c of contornos) piezas.push({ tipo: 'prisma', base: contornoExterior(c, 2), agujeros: [c], z0: -canto, z1: 0 });
  for (const [p, q] of bordesSalvo(geo.hueco, [geo.llegada])) piezas.push(...barandilla(p, q, () => 0));
  return { contornos, piezas };
}

/** Líneas de los peldaños (cantos), para dibujar en planta. */
export function lineasPeldanos(geo: GeometriaEscalera): [Punto, Punto][] {
  const res: [Punto, Punto][] = [];
  if (geo.caracol) {
    const c = geo.caracol;
    for (let k = 1; k < geo.peldanos; k++) {
      const phi = (k * c.vuelta) / geo.peldanos;
      res.push([enCaracol(c, c.rPoste, phi), enCaracol(c, c.rExt, phi)]);
    }
    return res;
  }
  for (const t of geo.tramos) {
    const perp: Punto = [-t.dir[1], t.dir[0]];
    for (let k = 1; k < t.peldanos; k++) {
      const c = mas(t.inicio, t.dir, (t.largo * k) / t.peldanos);
      res.push([mas(c, perp, -geo.ancho / 2), mas(c, perp, geo.ancho / 2)]);
    }
  }
  return res;
}

/** Eje de subida: del centro del pie al centro de la llegada, pasando por la meseta (o por la línea de huella de la caracol). */
export function ejeEscalera(geo: GeometriaEscalera): Punto[] {
  const medio = ([a, b]: [Punto, Punto]): Punto => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (geo.caracol) {
    const c = geo.caracol;
    return arco(c, (c.rPoste + c.rExt) / 2, 0, c.vuelta);
  }
  const pts: Punto[] = [medio(geo.pie)];
  if (geo.meseta && geo.tramos.length > 1) {
    const [t1, t2] = geo.tramos as [TramoEscalera, TramoEscalera];
    const h = geo.ancho / 2;
    // Centro de la meseta sobre el tramo 1 y punto de la meseta en el eje del tramo 2.
    pts.push(mas(t1.inicio, t1.dir, t1.largo + h), mas(t2.inicio, t2.dir, -h));
  }
  pts.push(medio(geo.llegada));
  return pts;
}

/** Una línea para el plano en texto y la leyenda: forma, peldaños, destino, pie y llegada. */
export function describirEscalera(esc: Escalera, geo: GeometriaEscalera): string {
  const medio = ([a, b]: [Punto, Punto]): Punto => [r1((a[0] + b[0]) / 2), r1((a[1] + b[1]) / 2)];
  const c = geo.caracol;
  const forma =
    esc.forma === 'recta'
      ? `recta de ${esc.largo} cm`
      : c
        ? `de caracol de ${r1(2 * c.rExt)} cm de diámetro (centro en (${r1(c.centro[0])}, ${r1(c.centro[1])})), gira a la ${esc.gira ?? 'derecha'}, ${esc.vuelta ?? VUELTA_CARACOL}°, poste de ${esc.poste ?? POSTE_CARACOL} cm`
        : `${esc.forma === 'L' ? 'en L' : 'de dos tramos (U)'} de ${esc.tramos![0]} y ${esc.tramos![1]} cm, gira a la ${esc.gira}${esc.forma === 'U' && esc.ojo ? `, ojo de ${esc.ojo} cm` : ''}`;
  const [px, py] = medio(geo.pie);
  const [lx, ly] = medio(geo.llegada);
  return `escalera ${esc.id} ${forma}, ${esc.ancho} cm de ancho, ${geo.peldanos} peldaños de ${r1(geo.altura / geo.peldanos)} cm, sube ${r1(geo.altura)} cm a ${esc.hasta}: pie en (${px}, ${py}), llegada en (${lx}, ${ly})`;
}

/** Rampas de colisión (una por tramo, la meseta plana y, en la caracol, una por trozo de ≤ 30°): base en planta y cota de cada esquina (cm). */
export function rampasEscalera(geo: GeometriaEscalera): { base: Punto[]; alturas: number[] }[] {
  if (geo.caracol) {
    const c = geo.caracol;
    const n = Math.max(1, Math.ceil(c.vuelta / (30 * GRAD) - 1e-9));
    return Array.from({ length: n }, (_, i) => {
      const a = (c.vuelta * i) / n;
      const b = (c.vuelta * (i + 1)) / n;
      const za = (geo.altura * a) / c.vuelta;
      const zb = (geo.altura * b) / c.vuelta;
      return { base: [enCaracol(c, c.rPoste, a), enCaracol(c, c.rExt, a), enCaracol(c, c.rExt, b), enCaracol(c, c.rPoste, b)], alturas: [za, za, zb, zb] };
    });
  }
  const res = geo.tramos.map((t) => ({
    base: t.rect,
    alturas: t.rect.map((p) => {
      const s = ((p[0] - t.inicio[0]) * t.dir[0] + (p[1] - t.inicio[1]) * t.dir[1]) / (t.largo || 1);
      return t.z0 + Math.max(0, Math.min(1, s)) * (t.z1 - t.z0);
    }),
  }));
  if (geo.meseta) res.push({ base: geo.meseta.rect, alturas: geo.meseta.rect.map(() => geo.meseta!.z) });
  return res;
}
