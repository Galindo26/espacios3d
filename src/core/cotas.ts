// Cotas en vivo: distancia libre desde el centro de cada lado del mueble, hacia fuera, hasta el
// primer muro u otro mueble que se cruce. Sirven para la interfaz y para informar a los agentes.
import { chocanEnAltura } from './analisis.js';
import { buscarMueble, planta } from './espacio.js';
import { esquinasMueble, muro } from './geometria.js';
import type { Espacio, Mueble, Punto } from './tipos.js';
import { TOLERANCIA } from './tipos.js';

export type Lado = 'trasera' | 'derecha' | 'frente' | 'izquierda';

export interface Cota {
  lado: Lado;
  desde: Punto;
  hasta: Punto;
  /** cm, redondeado a 0,1. */
  distancia: number;
  /** Id del mueble alcanzado, o null si es un muro. */
  contra: string | null;
}

const LADOS: Lado[] = ['trasera', 'derecha', 'frente', 'izquierda'];
const ALCANCE = 2000;

/** Intersección del rayo p + t·d (t ≥ 0) con el segmento ab; devuelve t o null. */
function rayoSegmento(p: Punto, d: Punto, a: Punto, b: Punto): number | null {
  const e: Punto = [b[0] - a[0], b[1] - a[1]];
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return null;
  const w: Punto = [a[0] - p[0], a[1] - p[1]];
  const t = (w[0] * e[1] - w[1] * e[0]) / den;
  const s = (w[0] * d[1] - w[1] * d[0]) / den;
  // Un borde que sobresale menos que la tolerancia (está «a ras») sigue midiendo contra ese muro.
  if (t < -2 * TOLERANCIA || s < -1e-9 || s > 1 + 1e-9) return null;
  return Math.max(0, t);
}

export function cotas(espacio: Espacio, id: string, mueble?: Mueble): Cota[] {
  const encontrado = buscarMueble(espacio, id);
  const m = mueble ?? encontrado?.mueble;
  if (!m) return [];
  const p = encontrado?.planta ?? planta(espacio);
  const esq = esquinasMueble(m);
  const objetivos: Array<{ a: Punto; b: Punto; contra: string | null }> = [];
  for (const s of p.estancias) {
    const c = s.contorno;
    for (let i = 0; i < c.length; i++) {
      const [a, b] = muro(c, i);
      objetivos.push({ a, b, contra: null });
    }
  }
  for (const o of p.muebles) {
    if (o.id === m.id || !chocanEnAltura(m, o)) continue;
    const e = esquinasMueble(o);
    for (let i = 0; i < 4; i++) objetivos.push({ a: e[i] as Punto, b: e[(i + 1) % 4] as Punto, contra: o.id });
  }
  const res: Cota[] = [];
  for (let i = 0; i < 4; i++) {
    const a = esq[i] as Punto;
    const b = esq[(i + 1) % 4] as Punto;
    const medio: Punto = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let d: Punto = [medio[0] - m.x, medio[1] - m.y];
    const l = Math.hypot(d[0], d[1]) || 1;
    d = [d[0] / l, d[1] / l];
    let mejor: { t: number; contra: string | null } | null = null;
    for (const s of objetivos) {
      const t = rayoSegmento(medio, d, s.a, s.b);
      if (t !== null && t <= ALCANCE && (!mejor || t < mejor.t)) mejor = { t, contra: s.contra };
    }
    if (!mejor) continue;
    res.push({
      lado: LADOS[i] as Lado,
      desde: medio,
      hasta: [medio[0] + d[0] * mejor.t, medio[1] + d[1] * mejor.t],
      distancia: Math.round(mejor.t * 10) / 10,
      contra: mejor.contra,
    });
  }
  return res;
}
