// Geometría 2D en planta (cm). Sin dependencias.
import type { Mueble, Punto } from './tipos.js';
import { TOLERANCIA } from './tipos.js';

export const GRAD = Math.PI / 180;

export function areaConSigno(poligono: readonly Punto[]): number {
  let suma = 0;
  for (let i = 0; i < poligono.length; i++) {
    const [x1, y1] = poligono[i] as Punto;
    const [x2, y2] = poligono[(i + 1) % poligono.length] as Punto;
    suma += x1 * y2 - x2 * y1;
  }
  return suma / 2;
}

export function area(poligono: readonly Punto[]): number {
  return Math.abs(areaConSigno(poligono));
}

export function distancia(a: Punto, b: Punto): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Arista i del contorno: [inicio, fin]. */
export function muro(contorno: readonly Punto[], i: number): [Punto, Punto] {
  const n = contorno.length;
  return [contorno[((i % n) + n) % n] as Punto, contorno[(((i + 1) % n) + n) % n] as Punto];
}

export function longitudMuro(contorno: readonly Punto[], i: number): number {
  const [a, b] = muro(contorno, i);
  return distancia(a, b);
}

/**
 * Normal unitaria del muro i que apunta hacia el interior de la estancia.
 * Funciona con contornos en ambos sentidos (se usa el signo del área).
 */
export function normalInterior(contorno: readonly Punto[], i: number): Punto {
  const [a, b] = muro(contorno, i);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  // Con área positiva (antihorario en ejes matemáticos) el interior queda a la izquierda: (-dy, dx).
  const s = areaConSigno(contorno) >= 0 ? 1 : -1;
  return [(-dy / l) * s, (dx / l) * s];
}

export function distanciaPuntoSegmento(p: Punto, a: Punto, b: Punto): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distanciaAlContorno(p: Punto, poligono: readonly Punto[]): number {
  let min = Infinity;
  for (let i = 0; i < poligono.length; i++) {
    const [a, b] = muro(poligono, i);
    min = Math.min(min, distanciaPuntoSegmento(p, a, b));
  }
  return min;
}

/** Punto estrictamente dentro (regla par-impar). Los puntos del borde dan un resultado cualquiera. */
export function puntoEnPoligono(p: Punto, poligono: readonly Punto[]): boolean {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i] as Punto;
    const [xj, yj] = poligono[j] as Punto;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Dentro o a menos de `tol` del borde. */
export function puntoDentroOBorde(p: Punto, poligono: readonly Punto[], tol = TOLERANCIA): boolean {
  return puntoEnPoligono(p, poligono) || distanciaAlContorno(p, poligono) <= tol;
}

function orientacion(a: Punto, b: Punto, c: Punto): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Cruce propio de segmentos (no cuenta tocarse en un extremo ni ser colineales). */
export function segmentosSeCruzan(a: Punto, b: Punto, c: Punto, d: Punto): boolean {
  const o1 = orientacion(a, b, c);
  const o2 = orientacion(a, b, d);
  const o3 = orientacion(c, d, a);
  const o4 = orientacion(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * Contorno simple: área no nula, sin vértices repetidos, sin espigas (arista que vuelve sobre la
 * anterior), sin aristas que se crucen y sin vértices que toquen una arista no contigua.
 */
export function esPoligonoSimple(poligono: readonly Punto[]): boolean {
  const n = poligono.length;
  if (n < 3) return false;
  if (area(poligono) < 1) return false;
  for (let i = 0; i < n; i++) {
    const a = poligono[(i - 1 + n) % n] as Punto;
    const b = poligono[i] as Punto;
    const c = poligono[(i + 1) % n] as Punto;
    if (distancia(b, c) < TOLERANCIA) return false;
    const d1: Punto = [b[0] - a[0], b[1] - a[1]];
    const d2: Punto = [c[0] - b[0], c[1] - b[1]];
    const cruz = d1[0] * d2[1] - d1[1] * d2[0];
    const punto = d1[0] * d2[0] + d1[1] * d2[1];
    if (Math.abs(cruz) < 1e-9 * Math.hypot(...d1) * Math.hypot(...d2) && punto < 0) return false; // espiga
  }
  for (let i = 0; i < n; i++) {
    const [a, b] = muro(poligono, i);
    for (let j = i + 1; j < n; j++) {
      if ((j + 1) % n === i || (i + 1) % n === j) continue;
      const [c, d] = muro(poligono, j);
      if (segmentosSeCruzan(a, b, c, d)) return false;
    }
    // Un vértice no contiguo sobre esta arista: el contorno se toca a sí mismo.
    for (let k = 0; k < n; k++) {
      if (k === i || k === (i + 1) % n) continue;
      if (distanciaPuntoSegmento(poligono[k] as Punto, a, b) < TOLERANCIA) return false;
    }
  }
  return true;
}

/** Ejes locales del mueble en planta: u = hacia su derecha (a lo largo del frente), v = hacia su frente. */
export function ejesMueble(giro: number): { u: Punto; v: Punto } {
  const c = Math.cos(giro * GRAD);
  const s = Math.sin(giro * GRAD);
  // Rotación horaria en planta con y hacia abajo = matriz de rotación estándar.
  return { u: [c, s], v: [-s, c] };
}

/** Local (lx a lo largo del ancho, ly hacia el frente) → planta. */
export function localAPlanta(m: Pick<Mueble, 'x' | 'y' | 'giro'>, lx: number, ly: number): Punto {
  const { u, v } = ejesMueble(m.giro);
  return [m.x + lx * u[0] + ly * v[0], m.y + lx * u[1] + ly * v[1]];
}

/** Esquinas de la huella: trasera-izq, trasera-der, frontal-der, frontal-izq (vistas desde el frente hacia +v). */
export function esquinasMueble(m: Pick<Mueble, 'x' | 'y' | 'giro' | 'ancho' | 'fondo'>): Punto[] {
  const a = m.ancho / 2;
  const f = m.fondo / 2;
  return [localAPlanta(m, -a, -f), localAPlanta(m, a, -f), localAPlanta(m, a, f), localAPlanta(m, -a, f)];
}

function proyeccion(poligono: readonly Punto[], eje: Punto): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poligono) {
    const d = p[0] * eje[0] + p[1] * eje[1];
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

function ejesSAT(poligono: readonly Punto[]): Punto[] {
  const ejes: Punto[] = [];
  for (let i = 0; i < poligono.length; i++) {
    const [a, b] = muro(poligono, i);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l > 0) ejes.push([-dy / l, dx / l]);
  }
  return ejes;
}

/**
 * Solapamiento de dos polígonos convexos (teorema del eje separador).
 * Devuelve la penetración mínima en cm (0 si no se solapan más que `tol`).
 */
export function solapeConvexos(a: readonly Punto[], b: readonly Punto[], tol = TOLERANCIA): number {
  let minimo = Infinity;
  for (const eje of [...ejesSAT(a), ...ejesSAT(b)]) {
    const [amin, amax] = proyeccion(a, eje);
    const [bmin, bmax] = proyeccion(b, eje);
    const solape = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (solape <= tol) return 0;
    minimo = Math.min(minimo, solape);
  }
  return minimo;
}

/**
 * Longitud del tramo del segmento ab que queda dentro del convexo encogido `tol` (Cyrus–Beck).
 * 0 si no lo atraviesa.
 */
export function tramoDentroDeConvexo(a: Punto, b: Punto, convexo: readonly Punto[], tol = TOLERANCIA): number {
  const s = areaConSigno(convexo) >= 0 ? 1 : -1;
  let t0 = 0;
  let t1 = 1;
  const d: Punto = [b[0] - a[0], b[1] - a[1]];
  for (let i = 0; i < convexo.length; i++) {
    const [p, q] = muro(convexo, i);
    const l = distancia(p, q) || 1;
    // Normal interior del lado (área positiva → interior a la izquierda).
    const n: Punto = [(-(q[1] - p[1]) / l) * s, ((q[0] - p[0]) / l) * s];
    const f = (a[0] - p[0]) * n[0] + (a[1] - p[1]) * n[1] - tol; // > 0: a dentro del semiplano encogido
    const g = d[0] * n[0] + d[1] * n[1];
    if (Math.abs(g) < 1e-12) {
      if (f <= 0) return 0;
      continue;
    }
    const t = -f / g;
    if (g > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return 0;
  }
  return (t1 - t0) * Math.hypot(d[0], d[1]);
}

/**
 * Polígono convexo contenido en un polígono simple (convexo o no), con tolerancia: todas sus
 * esquinas dentro y ninguna arista del contorno atravesando su interior.
 */
export function convexoDentroDePoligono(convexo: readonly Punto[], poligono: readonly Punto[], tol = TOLERANCIA): boolean {
  for (const p of convexo) if (!puntoDentroOBorde(p, poligono, tol)) return false;
  for (let i = 0; i < poligono.length; i++) {
    const [a, b] = muro(poligono, i);
    if (tramoDentroDeConvexo(a, b, convexo, tol) > 1e-6) return false;
  }
  return true;
}

/** Punto dentro de un convexo a más de `tol` de sus lados. */
export function puntoEstrictamenteEnConvexo(p: Punto, convexo: readonly Punto[], tol = TOLERANCIA): boolean {
  const s = areaConSigno(convexo) >= 0 ? 1 : -1;
  for (let i = 0; i < convexo.length; i++) {
    const [a, b] = muro(convexo, i);
    const l = distancia(a, b) || 1;
    if ((s * orientacion(a, b, p)) / l <= tol) return false;
  }
  return true;
}

/**
 * Contorno exterior de los muros: cada arista desplazada `grosor` hacia fuera, con inglete.
 * Devuelve un punto exterior por vértice del contorno interior.
 */
export function contornoExterior(contorno: readonly Punto[], grosor: number): Punto[] {
  const n = contorno.length;
  const res: Punto[] = [];
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const nA = normalInterior(contorno, prev);
    const nB = normalInterior(contorno, i);
    const p = contorno[i] as Punto;
    // Líneas desplazadas hacia fuera (−normal interior).
    const [a0, a1] = muro(contorno, prev);
    const [b0, b1] = muro(contorno, i);
    const pa: Punto = [a0[0] - nA[0] * grosor, a0[1] - nA[1] * grosor];
    const da: Punto = [a1[0] - a0[0], a1[1] - a0[1]];
    const pb: Punto = [b0[0] - nB[0] * grosor, b0[1] - nB[1] * grosor];
    const db: Punto = [b1[0] - b0[0], b1[1] - b0[1]];
    const cruz = da[0] * db[1] - da[1] * db[0];
    if (Math.abs(cruz) < 1e-9) {
      res.push([p[0] - nB[0] * grosor, p[1] - nB[1] * grosor]);
      continue;
    }
    const t = ((pb[0] - pa[0]) * db[1] - (pb[1] - pa[1]) * db[0]) / cruz;
    const inglete: Punto = [pa[0] + t * da[0], pa[1] + t * da[1]];
    // Límite de inglete: en ángulos muy agudos el vértice exterior se dispararía. Se recorta sobre la
    // misma línea del inglete, a 4 grosores de la esquina (sumar las dos normales, casi opuestas, dejaba
    // el vértice pegado a ella y el muro sin grosor).
    const lejos = distancia(inglete, p);
    if (lejos > grosor * 4) res.push([p[0] + ((inglete[0] - p[0]) * grosor * 4) / lejos, p[1] + ((inglete[1] - p[1]) * grosor * 4) / lejos]);
    else res.push(inglete);
  }
  return res;
}

/**
 * Única conversión planta → three.js: X = x/100, Z = y/100 (metros), Y hacia arriba.
 * El giro horario en planta equivale a rotation.y = −giro (en radianes).
 */
export function aTres(x: number, y: number): { X: number; Z: number } {
  return { X: x / 100, Z: y / 100 };
}

export function rotacionY(giro: number): number {
  return -giro * GRAD;
}

export function normalizarGiro(giro: number): number {
  const g = ((giro % 360) + 360) % 360;
  const r = Math.round(g * 1000) / 1000;
  return r === 360 ? 0 : r;
}

export function cajaContorno(poligono: readonly Punto[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poligono) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}
