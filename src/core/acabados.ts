// Materiales básicos (R4-2): el suelo de cada estancia (liso, parquet, baldosa o moqueta, con color) y
// el color de sus paredes. Las paredes se pintan con un revestimiento fino en su cara interior, del
// suelo al techo (también bajo un techo inclinado), con los huecos de puertas, pasos y ventanas
// recortados, también los que vienen de la estancia vecina en el mismo tabique. Así cada cara de un
// tabique lleva el color de su estancia. La página y el .glb usan las mismas piezas.
import { alturaTecho } from './elementos.js';
import { muro, normalInterior } from './geometria.js';
import type { GeometriaGLB } from './glb.js';
import type { ModeloPlanta } from './muros.js';
import type { Estancia, Punto, Suelo } from './tipos.js';
import type { Punto3 } from './escaleras.js';

/** Color de cada tipo de suelo cuando no se elige otro. */
export const COLOR_SUELO: Record<Suelo['tipo'], string> = { liso: '#e8e1d5', parquet: '#b98a5a', baldosa: '#d6d2ca', moqueta: '#8f877c' };
/** Color de las paredes sin pintar (el de los muros). */
export const COLOR_PAREDES = '#e8e2d6';
/** Separación del revestimiento respecto a la cara del muro (cm), para que no se mezclen al dibujar. */
const SEPARACION = 0.3;
/** Paso (cm) con el que se sigue un techo inclinado a lo largo de la pared. */
const PASO_TECHO = 25;

export function colorSuelo(s: Estancia): string {
  return s.suelo ? (s.suelo.color ?? COLOR_SUELO[s.suelo.tipo]) : COLOR_SUELO.liso;
}

/**
 * Revestimiento de las paredes de una estancia: cuadriláteros (cm: x, y en planta, z altura) en la
 * cara interior de cada muro, partidos en franjas verticales por los bordes de los huecos y por el
 * techo inclinado.
 */
export function revestimiento(s: Estancia, modelo: ModeloPlanta): Punto3[][] {
  return revestimientoPorMuro(s, modelo).flat();
}

/** El revestimiento separado por muro (índice = muro de la estancia): la página oculta los que tapan la cámara. */
export function revestimientoPorMuro(s: Estancia, modelo: ModeloPlanta): Punto3[][][] {
  const todos: Punto3[][][] = [];
  const c = s.contorno;
  for (let i = 0; i < c.length; i++) {
    const res: Punto3[][] = [];
    todos.push(res);
    const [a, b] = muro(c, i);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1) continue;
    const t: Punto = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const n = normalInterior(c, i);
    const en = (u: number): Punto => [a[0] + t[0] * u + n[0] * SEPARACION, a[1] + t[1] * u + n[1] * SEPARACION];
    // Huecos de esta pared: los de la estancia en este muro y los de la vecina que dan a ella.
    const huecos: [number, number, number, number][] = [];
    for (const x of modelo.huecos) {
      const propio = x.estancia === s.id && x.hueco.muro === i;
      const deVecina = x.da === s.id && x.estancia !== s.id;
      if (!propio && !deVecina) continue;
      const lejos = (q: Punto): number => Math.abs((q[0] - a[0]) * t[1] - (q[1] - a[1]) * t[0]);
      if (deVecina && (lejos(x.a) > x.profundidad + 1 || lejos(x.b) > x.profundidad + 1)) continue;
      const u = (q: Punto): number => (q[0] - a[0]) * t[0] + (q[1] - a[1]) * t[1];
      const u0 = Math.max(0, Math.min(u(x.a), u(x.b)));
      const u1 = Math.min(L, Math.max(u(x.a), u(x.b)));
      if (u1 - u0 > 0.5) huecos.push([u0, u1, x.base, x.tope]);
    }
    const cortes = new Set([0, L]);
    for (const [u0, u1] of huecos) cortes.add(u0).add(u1);
    if (s.faldones?.length) for (let u = PASO_TECHO; u < L; u += PASO_TECHO) cortes.add(u);
    const us = [...cortes].sort((x, y) => x - y);
    const techo = (u: number): number => alturaTecho(s, en(Math.min(L - 0.01, Math.max(0.01, u))));
    for (let k = 0; k + 1 < us.length; k++) {
      const ua = us[k]!;
      const ub = us[k + 1]!;
      if (ub - ua < 0.05) continue;
      const ta = techo(ua);
      const tb = techo(ub);
      const tmin = Math.min(ta, tb);
      // Lo que tapan los huecos que cubren esta franja entera.
      const tapados = huecos
        .filter(([u0, u1]) => u0 <= ua + 1e-6 && u1 >= ub - 1e-6)
        .map(([, , z0, z1]) => [Math.max(0, z0), Math.min(tmin, z1)] as [number, number])
        .filter(([z0, z1]) => z1 > z0)
        .sort((x, y) => x[0] - y[0]);
      let z = 0;
      const pa = en(ua);
      const pb = en(ub);
      const tramo = (z0: number, z1a: number, z1b: number): void => {
        if (Math.max(z1a, z1b) - z0 < 0.05) return;
        res.push([[pa[0], pa[1], z0], [pb[0], pb[1], z0], [pb[0], pb[1], z1b], [pa[0], pa[1], z1a]]);
      };
      for (const [z0, z1] of tapados) {
        if (z0 > z) tramo(z, z0, z0);
        z = Math.max(z, z1);
      }
      // Hasta el techo (inclinado, si lo hay): arriba sigue la altura en cada extremo.
      if (z < tmin - 0.05 || z < Math.max(ta, tb) - 0.05) tramo(z, Math.max(z, ta), Math.max(z, tb));
    }
  }
  return todos;
}

/** Cuadriláteros (cm) como malla de dos caras (metros, y hacia arriba), para el .glb y la página. */
export function mallaCuadros(cuadros: readonly Punto3[][]): GeometriaGLB {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const M = 0.01;
  for (const q of cuadros) {
    const v = q.map(([x, y, z]) => [x * M, z * M, y * M] as const);
    const [p0, p1, p2] = v as unknown as [readonly number[], readonly number[], readonly number[]];
    const e1 = [p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!];
    const e2 = [p2[0]! - p0[0]!, p2[1]! - p0[1]!, p2[2]! - p0[2]!];
    let nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
    let ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
    let nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const s of [1, -1]) {
      const base = pos.length / 3;
      for (const p of v) {
        pos.push(p[0]!, p[1]!, p[2]!);
        nor.push(nx * s, ny * s, nz * s);
      }
      if (s === 1) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  return { posiciones: new Float32Array(pos), normales: new Float32Array(nor), indices: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) };
}
