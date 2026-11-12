// Suelos con los huecos de las escaleras que llegan restados. Lo usan el .glb visible, sus colisiones
// y la página (revisión independiente de R2-7d: el suelo de colisión de arriba tapaba el hueco).
import { diferencia } from './booleanas.js';
import { escalerasQueLlegan, geometriaDe } from './escaleras.js';
import type { Espacio, Punto } from './tipos.js';

/** Huecos (cm) de las escaleras que llegan a una planta, para restarlos de sus suelos. */
export function huecosDePlanta(e: Espacio, plantaId: string): Punto[][] {
  return escalerasQueLlegan(e, plantaId).flatMap(({ desde, escalera }) => geometriaDe(e, desde, escalera).hueco);
}

/** Suelo de una estancia con los huecos de escalera restados (polígonos con agujeros, cm). */
export function sueloConHuecos(contorno: Punto[], huecos: Punto[][]): { exterior: Punto[]; agujeros: Punto[][] }[] {
  if (!huecos.length) return [{ exterior: contorno, agujeros: [] }];
  return diferencia([{ exterior: contorno, agujeros: [] }], huecos.map((h) => ({ exterior: h, agujeros: [] })));
}
