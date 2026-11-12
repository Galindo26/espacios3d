// Varios muebles a la vez (R2-6, selección múltiple): moverlos, girarlos alrededor de su centro común
// (una mesa con sus sillas gira como un conjunto), duplicarlos y quitarlos. Cada operación es atómica:
// si un mueble no puede (bloqueado, otra planta), no cambia ninguno.
import { buscarMueble } from './espacio.js';
import { normalizarGiro } from './geometria.js';
import { duplicarMueble, editarMueble, quitarMueble } from './operaciones.js';
import type { Espacio, Punto } from './tipos.js';
import { ErrorOperacion } from './tipos.js';

const redondear1 = (n: number): number => Math.round(n * 10) / 10;

function muebles(e: Espacio, ids: readonly string[]) {
  if (!ids.length) throw new ErrorOperacion('No hay muebles elegidos');
  const lista = [...new Set(ids)].map((id) => {
    const r = buscarMueble(e, id);
    if (!r) throw new ErrorOperacion(`No existe el mueble «${id}»`);
    return r;
  });
  if (new Set(lista.map((r) => r.planta.id)).size > 1) throw new ErrorOperacion('Los muebles elegidos están en plantas distintas');
  return lista.map((r) => r.mueble);
}

/** Centro común: el de la caja que contiene los centros de los muebles. */
export function centroGrupo(e: Espacio, ids: readonly string[]): Punto {
  const ms = muebles(e, ids);
  const xs = ms.map((m) => m.x);
  const ys = ms.map((m) => m.y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

export function moverGrupo(e: Espacio, ids: readonly string[], dx: number, dy: number): Espacio {
  return muebles(e, ids).reduce((r, m) => editarMueble(r, m.id, { x: redondear1(m.x + dx), y: redondear1(m.y + dy) }), e);
}

/** Gira el conjunto `grados` (sentido del reloj en planta, como el giro de un mueble) alrededor de su centro. */
export function girarGrupo(e: Espacio, ids: readonly string[], grados: number): Espacio {
  const [cx, cy] = centroGrupo(e, ids);
  const a = (grados * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return muebles(e, ids).reduce((r, m) => {
    const dx = m.x - cx;
    const dy = m.y - cy;
    return editarMueble(r, m.id, { x: redondear1(cx + c * dx - s * dy), y: redondear1(cy + s * dx + c * dy), giro: normalizarGiro(m.giro + grados) });
  }, e);
}

/** Duplica el conjunto desplazado lo mismo que un duplicado suelto; devuelve los ids nuevos en el mismo orden. */
export function duplicarGrupo(e: Espacio, ids: readonly string[], desplazamiento = 20): { espacio: Espacio; ids: string[] } {
  const nuevos: string[] = [];
  let r = e;
  for (const m of muebles(e, ids)) {
    const d = duplicarMueble(r, m.id, desplazamiento);
    r = d.espacio;
    nuevos.push(d.id);
  }
  return { espacio: r, ids: nuevos };
}

export function quitarGrupo(e: Espacio, ids: readonly string[]): Espacio {
  return muebles(e, ids).reduce((r, m) => quitarMueble(r, m.id), e);
}
