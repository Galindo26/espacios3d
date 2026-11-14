// Acceso a plantas, estancias y muebles de un espacio v2, por id o por defecto (la primera).
// Las operaciones reciben ids opcionales: sin ellos actúan sobre la primera planta y estancia,
// que es lo que hace una casa de una sola habitación.
import { esquinasMueble, puntoDentroOBorde, puntoEnPoligono } from './geometria.js';
import type { Espacio, Estancia, Mueble, Planta, Punto } from './tipos.js';
import { ErrorOperacion } from './tipos.js';

export function planta(e: Espacio, id?: string): Planta {
  if (id === undefined) {
    const p = e.plantas[0];
    if (!p) throw new ErrorOperacion('El espacio no tiene plantas');
    return p;
  }
  const p = e.plantas.find((x) => x.id === id);
  if (!p) throw new ErrorOperacion(`No existe la planta «${id}». Plantas: ${e.plantas.map((x) => x.id).join(', ')}`);
  return p;
}

/** Estancia por id (en cualquier planta) o la primera de la planta indicada. */
export function estancia(e: Espacio, id?: string, plantaId?: string): { planta: Planta; estancia: Estancia } {
  if (id !== undefined) {
    for (const p of e.plantas) {
      const s = p.estancias.find((x) => x.id === id);
      if (s) return { planta: p, estancia: s };
    }
    const todas = e.plantas.flatMap((p) => p.estancias.map((s) => s.id));
    throw new ErrorOperacion(`No existe la estancia «${id}». Estancias: ${todas.join(', ')}`);
  }
  const p = planta(e, plantaId);
  const s = p.estancias[0];
  if (!s) throw new ErrorOperacion(`La planta «${p.id}» no tiene estancias`);
  return { planta: p, estancia: s };
}

export function buscarMueble(e: Espacio, id: string): { planta: Planta; mueble: Mueble } | null {
  for (const p of e.plantas) {
    const m = p.muebles.find((x) => x.id === id);
    if (m) return { planta: p, mueble: m };
  }
  return null;
}

export function todosLosMuebles(e: Espacio): Mueble[] {
  return e.plantas.flatMap((p) => p.muebles);
}

/** Todos los ids del archivo (plantas, estancias, huecos, elementos, muebles, fondos y escaleras): son únicos. */
export function idsUsados(e: Espacio): Set<string> {
  const s = new Set<string>();
  for (const p of e.plantas) {
    s.add(p.id);
    for (const est of p.estancias) {
      s.add(est.id);
      for (const h of est.huecos) s.add(h.id);
      for (const el of est.elementos ?? []) s.add(el.id);
    }
    for (const m of p.muebles) s.add(m.id);
    for (const f of p.fondos ?? []) s.add(f.id);
    for (const esc of p.escaleras ?? []) s.add(esc.id);
  }
  return s;
}

/** Estancia que contiene el punto (dentro o en el borde), o null. */
export function estanciaEnPunto(p: Planta, punto: Punto): Estancia | null {
  return p.estancias.find((s) => puntoEnPoligono(punto, s.contorno)) ?? p.estancias.find((s) => puntoDentroOBorde(punto, s.contorno)) ?? null;
}

/**
 * Estancia a la que pertenece un mueble: la que contiene su centro; si su centro cae fuera de
 * todas, la que contiene alguna de sus esquinas; si no, ninguna.
 */
export function estanciaDeMueble(p: Planta, m: Mueble): Estancia | null {
  const centro = estanciaEnPunto(p, [m.x, m.y]);
  if (centro) return centro;
  for (const q of esquinasMueble(m)) {
    const s = estanciaEnPunto(p, q);
    if (s) return s;
  }
  return null;
}

export function clonar<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
