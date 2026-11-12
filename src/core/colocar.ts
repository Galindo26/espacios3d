// Colocación relativa a los muros: lo que un agente o una persona dice con palabras
// («contra el muro 2, a 40 cm de la esquina») traducido a x, y y giro.
// Los muros son los de una estancia (por defecto la primera, o la del mueble).
import { buscarMueble, estancia, estanciaDeMueble } from './espacio.js';
import { distanciaPuntoSegmento, longitudMuro, muro, normalInterior, normalizarGiro } from './geometria.js';
import { editarMueble } from './operaciones.js';
import type { Espacio, Mueble, Punto } from './tipos.js';
import { ErrorOperacion } from './tipos.js';

function contornoDe(e: Espacio, estanciaId?: string): readonly Punto[] {
  return estancia(e, estanciaId).estancia.contorno;
}

/** Giro con el que el frente del mueble mira hacia el interior desde el muro i. */
export function giroDesdeMuro(espacio: Espacio, i: number, estanciaId?: string): number {
  const n = normalInterior(contornoDe(espacio, estanciaId), i);
  // Frente con giro g: (−sen g, cos g) = n.
  return normalizarGiro((Math.atan2(-n[0], n[1]) * 180) / Math.PI);
}

/**
 * Posición con la trasera contra el muro i: el borde del mueble empieza a `desde` cm del vértice
 * inicial del muro (como los huecos) y se separa `separacion` cm de la pared.
 */
export function posicionContraMuro(
  espacio: Espacio,
  m: Pick<Mueble, 'ancho' | 'fondo'>,
  i: number,
  desde: number,
  separacion = 0,
  estanciaId?: string,
): { x: number; y: number; giro: number } {
  const c = contornoDe(espacio, estanciaId);
  if (!Number.isInteger(i) || i < 0 || i >= c.length) throw new ErrorOperacion(`No existe el muro ${i}: hay ${c.length} (0–${c.length - 1})`);
  const largo = longitudMuro(c, i);
  if (desde < 0 || desde + m.ancho > largo + 0.1) {
    throw new ErrorOperacion(`No cabe en el muro ${i}: desde ${desde} + ancho ${m.ancho} > ${Math.round(largo * 10) / 10} cm`);
  }
  const [a, b] = muro(c, i);
  const t: Punto = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
  const n = normalInterior(c, i);
  const s = desde + m.ancho / 2;
  const f = separacion + m.fondo / 2;
  return {
    x: Math.round((a[0] + t[0] * s + n[0] * f) * 10) / 10,
    y: Math.round((a[1] + t[1] * s + n[1] * f) * 10) / 10,
    giro: giroDesdeMuro(espacio, i, estanciaId),
  };
}

/** Muro más cercano a un punto, en una estancia. */
export function muroMasCercano(espacio: Espacio, x: number, y: number, estanciaId?: string): number {
  const c = contornoDe(espacio, estanciaId);
  let mejor = 0;
  let dist = Infinity;
  for (let i = 0; i < c.length; i++) {
    const [a, b] = muro(c, i);
    const d = distanciaPuntoSegmento([x, y], a, b);
    if (d < dist) {
      dist = d;
      mejor = i;
    }
  }
  return mejor;
}

/**
 * Lleva el mueble contra el muro más cercano de su estancia (o el indicado), mirando hacia
 * dentro, sin moverlo a lo largo del muro.
 */
export function pegarAPared(espacio: Espacio, id: string, i?: number): Espacio {
  const encontrado = buscarMueble(espacio, id);
  if (!encontrado) throw new ErrorOperacion(`No existe el mueble «${id}»`);
  const { mueble: m, planta: p } = encontrado;
  const sid = (estanciaDeMueble(p, m) ?? p.estancias[0])?.id;
  const c = contornoDe(espacio, sid);
  const k = i ?? muroMasCercano(espacio, m.x, m.y, sid);
  const [a, b] = muro(c, k);
  const largo = longitudMuro(c, k);
  const t: Punto = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
  const s = (m.x - a[0]) * t[0] + (m.y - a[1]) * t[1];
  const desde = Math.min(Math.max(s - m.ancho / 2, 0), Math.max(largo - m.ancho, 0));
  const pos = posicionContraMuro(espacio, m, k, Math.round(desde * 10) / 10, 0, sid);
  return editarMueble(espacio, id, pos);
}
