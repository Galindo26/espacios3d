// Geometría de puertas, ventanas y pasos sobre los muros, y zonas que deben quedar libres.
import { esquinasMueble, muro, normalInterior } from './geometria.js';
import type { Hueco, Mueble, Punto } from './tipos.js';

/** Fondo de la franja de paso delante de puertas y pasos (cm). */
export const FRANJA_PASO = 60;
/** Distancia al muro dentro de la cual un mueble «tapa» una ventana (cm). */
export const FONDO_VENTANA = 10;
const SEGMENTOS_ARCO = 12;

export interface GeometriaHueco {
  hueco: Hueco;
  /** Extremos del hueco sobre la cara interior del muro (de `desde` a `desde + ancho`). */
  a: Punto;
  b: Punto;
  /** Dirección unitaria del muro y normal hacia el interior. */
  t: Punto;
  n: Punto;
}

/** Geometría de un hueco sobre el contorno de su estancia. */
export function geometriaHueco(contorno: readonly Punto[], h: Hueco): GeometriaHueco {
  const c = contorno;
  const [p, q] = muro(c, h.muro);
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const t: Punto = [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
  const n = normalInterior(c, h.muro);
  const a: Punto = [p[0] + t[0] * h.desde, p[1] + t[1] * h.desde];
  const b: Punto = [a[0] + t[0] * h.ancho, a[1] + t[1] * h.ancho];
  return { hueco: h, a, b, t, n };
}

/** Rectángulo (polígono) que arranca en el segmento ab y entra `fondo` cm hacia n. */
function franja(a: Punto, b: Punto, n: Punto, fondo: number): Punto[] {
  return [a, b, [b[0] + n[0] * fondo, b[1] + n[1] * fondo], [a[0] + n[0] * fondo, a[1] + n[1] * fondo]];
}

/**
 * Barrido de una puerta que abre hacia dentro: cuarto de círculo con centro en la bisagra y radio
 * igual al ancho de la hoja. Polígono convexo (bisagra + arco).
 */
export function barridoPuerta(g: GeometriaHueco): Punto[] | null {
  const h = g.hueco;
  if (h.tipo !== 'puerta' || h.abre !== 'dentro') return null;
  const bisagra = h.bisagra === 'inicio' ? g.a : g.b;
  // Hoja cerrada: de la bisagra hacia el otro extremo; abierta: perpendicular al muro, hacia dentro.
  const cerrada: Punto = h.bisagra === 'inicio' ? g.t : [-g.t[0], -g.t[1]];
  const pts: Punto[] = [bisagra];
  for (let i = 0; i <= SEGMENTOS_ARCO; i++) {
    const ang = (i / SEGMENTOS_ARCO) * (Math.PI / 2);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const d: Punto = [cerrada[0] * c + g.n[0] * s, cerrada[1] * c + g.n[1] * s];
    pts.push([bisagra[0] + d[0] * h.ancho, bisagra[1] + d[1] * h.ancho]);
  }
  return pts;
}

/** Franja de paso delante de una puerta o un paso. */
export function franjaPaso(g: GeometriaHueco): Punto[] | null {
  if (g.hueco.tipo === 'ventana') return null;
  return franja(g.a, g.b, g.n, FRANJA_PASO);
}

/** Banda pegada a una ventana: lo que esté ahí y sea más alto que el antepecho la tapa. */
export function bandaVentana(g: GeometriaHueco): Punto[] | null {
  if (g.hueco.tipo !== 'ventana') return null;
  return franja(g.a, g.b, g.n, FONDO_VENTANA);
}

/** Zona libre que el mueble necesita delante (ancho × holguraFrente desde su frente). */
export function zonaFrente(m: Mueble): Punto[] | null {
  if (m.holguraFrente <= 0) return null;
  const e = esquinasMueble(m);
  const fi = e[3] as Punto; // frontal izquierda
  const fd = e[2] as Punto; // frontal derecha
  const v: Punto = [-Math.sin((m.giro * Math.PI) / 180), Math.cos((m.giro * Math.PI) / 180)];
  return franja(fi, fd, v, m.holguraFrente);
}
