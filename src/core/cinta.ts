// Cinta métrica (R2-6): medir entre dos puntos de la planta. El punto se pega (imán) a la esquina
// más cercana de una estancia, un mueble o un elemento de obra y, si no hay ninguna cerca, al punto
// más cercano de una pared; así se mide de pared a mueble o entre esquinas sin apuntar al milímetro.
import { huellaElemento } from './elementos.js';
import { distancia, esquinasMueble, muro } from './geometria.js';
import type { Planta, Punto } from './tipos.js';

export interface PuntoCinta {
  punto: Punto;
  /** A qué se ha pegado: una esquina, una pared o nada. */
  pegado: 'esquina' | 'pared' | null;
}

/** Punto más cercano del segmento ab a p. */
function proyectar(p: Punto, a: Punto, b: Punto): Punto {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

/** Pega p a una esquina (a menos de `umbral` cm) o a una pared; si no, lo deja como está. */
export function imanCinta(pl: Planta, p: Punto, umbral: number): PuntoCinta {
  const esquinas: Punto[] = [
    ...pl.estancias.flatMap((s) => s.contorno),
    ...pl.muebles.flatMap((m) => esquinasMueble(m)),
    ...pl.estancias.flatMap((s) => (s.elementos ?? []).flatMap((el) => huellaElemento(s, el) ?? [])),
  ];
  let mejor: Punto | null = null;
  let d = umbral;
  for (const q of esquinas) {
    const dq = distancia(p, q);
    if (dq <= d) [mejor, d] = [q, dq];
  }
  if (mejor) return { punto: [mejor[0], mejor[1]], pegado: 'esquina' };
  d = umbral;
  for (const s of pl.estancias) {
    for (let i = 0; i < s.contorno.length; i++) {
      const [a, b] = muro(s.contorno, i);
      const q = proyectar(p, a, b);
      const dq = distancia(p, q);
      if (dq <= d) [mejor, d] = [q, dq];
    }
  }
  if (mejor) return { punto: [Math.round(mejor[0] * 10) / 10, Math.round(mejor[1] * 10) / 10], pegado: 'pared' };
  return { punto: [p[0], p[1]], pegado: null };
}

/** Medida de la cinta: distancia total y sus componentes en x e y (cm, con un decimal). */
export function medirCinta(a: Punto, b: Punto): { distancia: number; dx: number; dy: number } {
  const r = (n: number): number => Math.round(n * 10) / 10;
  return { distancia: r(distancia(a, b)), dx: r(Math.abs(b[0] - a[0])), dy: r(Math.abs(b[1] - a[1])) };
}
