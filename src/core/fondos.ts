// Planos de fondo para calcar (R2-3): poner, calibrar con dos puntos y una distancia real, mover y
// quitar. La imagen no está en el JSON: sólo su ruta relativa y su tamaño en píxeles.
import { clonar, idsUsados, planta } from './espacio.js';
import { GRAD } from './geometria.js';
import { idLibre } from './operaciones.js';
import type { Espacio, Fondo, Planta, Punto } from './tipos.js';
import { ErrorOperacion } from './tipos.js';
import { validar } from './validar.js';

function confirmar(e: Espacio): Espacio {
  const r = validar(e);
  if (!r.ok) throw new ErrorOperacion(`El resultado no es válido:\n- ${r.errores.join('\n- ')}`);
  return r.espacio;
}

/** Punto de la planta (cm) al que corresponde el píxel (px, py) de la imagen. */
export function fondoAPlanta(f: Fondo, px: number, py: number): Punto {
  const [c, s] = [Math.cos(f.giro * GRAD), Math.sin(f.giro * GRAD)];
  const u = px * f.escala;
  const v = py * f.escala;
  return [f.x + u * c - v * s, f.y + u * s + v * c];
}

export function buscarFondo(e: Espacio, id: string): { planta: Planta; fondo: Fondo } {
  for (const p of e.plantas) {
    const f = (p.fondos ?? []).find((x) => x.id === id);
    if (f) return { planta: p, fondo: f };
  }
  const todos = e.plantas.flatMap((p) => (p.fondos ?? []).map((f) => f.id));
  throw new ErrorOperacion(`No existe el fondo «${id}»${todos.length ? `. Fondos: ${todos.join(', ')}` : ' (no hay ninguno)'}`);
}

export type DatosFondo = Pick<Fondo, 'archivo' | 'anchoPx' | 'altoPx'> & Partial<Omit<Fondo, 'archivo' | 'anchoPx' | 'altoPx'>>;

export function ponerFondo(e: Espacio, datos: DatosFondo, plantaId?: string): { espacio: Espacio; id: string } {
  const p0 = planta(e, plantaId);
  const id = datos.id ?? idLibre(e, 'plano');
  if (idsUsados(e).has(id)) throw new ErrorOperacion(`Ya existe algo con id «${id}» (los ids son únicos en todo el archivo)`);
  const r = clonar(e);
  const p = planta(r, p0.id);
  p.fondos = [...(p.fondos ?? []), { escala: 1, x: 0, y: 0, giro: 0, opacidad: 0.5, ...datos, id }];
  return { espacio: confirmar(r), id };
}

export function editarFondo(e: Espacio, id: string, cambios: Partial<Omit<Fondo, 'id'>>): Espacio {
  buscarFondo(e, id);
  const r = clonar(e);
  Object.assign(buscarFondo(r, id).fondo, cambios);
  return confirmar(r);
}

export function quitarFondo(e: Espacio, id: string): Espacio {
  const { planta: p } = buscarFondo(e, id);
  const r = clonar(e);
  const pr = planta(r, p.id);
  pr.fondos = (pr.fondos ?? []).filter((f) => f.id !== id);
  if (!pr.fondos.length) delete pr.fondos;
  return confirmar(r);
}

/**
 * Calibra un fondo: dos puntos de la imagen (en píxeles) que en la realidad están a `distancia` cm.
 * Cambia la escala dejando el punto 1 donde estaba; con `en`, lo lleva a ese punto de la planta.
 */
export function calibrarFondo(e: Espacio, id: string, p1: Punto, p2: Punto, distancia: number, en?: Punto): Espacio {
  const { fondo: f } = buscarFondo(e, id);
  const dpx = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  if (!(dpx > 0)) throw new ErrorOperacion('Los dos puntos de la imagen son el mismo: marca dos puntos distintos');
  if (!(distancia > 0)) throw new ErrorOperacion('La distancia real debe ser mayor que 0 cm');
  const escala = distancia / dpx;
  // El punto 1 se queda donde estaba (o va a «en»): se recoloca la esquina de la imagen.
  const destino = en ?? fondoAPlanta(f, p1[0], p1[1]);
  const conEscala: Fondo = { ...f, escala, x: 0, y: 0 };
  const desde = fondoAPlanta(conEscala, p1[0], p1[1]);
  const r1 = (n: number): number => Math.round(n * 1000) / 1000 || 0;
  return editarFondo(e, id, { escala: Math.round(escala * 1e6) / 1e6, x: r1(destino[0] - desde[0]), y: r1(destino[1] - desde[1]) });
}

/** Píxel de la imagen (puede tener decimales o caer fuera) que corresponde a un punto de la planta (cm). */
export function plantaAFondo(f: Fondo, x: number, y: number): Punto {
  const [c, s] = [Math.cos(f.giro * GRAD), Math.sin(f.giro * GRAD)];
  const dx = x - f.x;
  const dy = y - f.y;
  return [(dx * c + dy * s) / f.escala, (-dx * s + dy * c) / f.escala];
}
