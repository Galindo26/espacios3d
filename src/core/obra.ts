// Operaciones sobre elementos de obra y techo inclinado (R2-4): agregar, editar y quitar elementos;
// poner y quitar faldones. Validan con el núcleo y fallan con un mensaje claro.
import { clonar, estancia, idsUsados } from './espacio.js';
import { idLibre } from './operaciones.js';
import type { Elemento, Espacio, Estancia, Faldon } from './tipos.js';
import { ErrorOperacion } from './tipos.js';
import { validar } from './validar.js';

function confirmar(e: Espacio): Espacio {
  const r = validar(e);
  if (!r.ok) throw new ErrorOperacion(`El resultado no es válido:\n- ${r.errores.join('\n- ')}`);
  return r.espacio;
}

export function buscarElemento(e: Espacio, id: string): { estancia: Estancia; elemento: Elemento } {
  for (const p of e.plantas) {
    for (const s of p.estancias) {
      const el = (s.elementos ?? []).find((x) => x.id === id);
      if (el) return { estancia: s, elemento: el };
    }
  }
  const todos = e.plantas.flatMap((p) => p.estancias.flatMap((s) => (s.elementos ?? []).map((x) => x.id)));
  throw new ErrorOperacion(`No existe el elemento «${id}»${todos.length ? `. Elementos: ${todos.join(', ')}` : ' (no hay ninguno)'}`);
}

export function agregarElemento(e: Espacio, datos: Record<string, unknown> & { forma: Elemento['forma'] }, estanciaId?: string): { espacio: Espacio; id: string } {
  const est = estancia(e, estanciaId).estancia;
  const base = typeof datos.tipo === 'string' ? datos.tipo : datos.forma === 'punto' ? 'enchufe' : datos.forma === 'viga' ? 'viga' : datos.forma === 'adosado' ? 'pilar' : 'columna';
  const id = typeof datos.id === 'string' ? datos.id : idLibre(e, base);
  if (idsUsados(e).has(id)) throw new ErrorOperacion(`Ya existe algo con id «${id}» (los ids son únicos en todo el archivo)`);
  const r = clonar(e);
  const s = estancia(r, est.id).estancia;
  s.elementos = [...(s.elementos ?? []), { ...datos, id, tipo: base } as unknown as Elemento];
  return { espacio: confirmar(r), id };
}

export function editarElemento(e: Espacio, id: string, cambios: Record<string, unknown>): Espacio {
  const { elemento } = buscarElemento(e, id);
  if (cambios.forma !== undefined && cambios.forma !== elemento.forma) throw new ErrorOperacion(`No se puede cambiar la forma de «${id}»: quítalo y añade otro`);
  const r = clonar(e);
  Object.assign(buscarElemento(r, id).elemento, cambios);
  return confirmar(r);
}

export function quitarElemento(e: Espacio, id: string): Espacio {
  const { estancia: est } = buscarElemento(e, id);
  const r = clonar(e);
  const s = estancia(r, est.id).estancia;
  s.elementos = (s.elementos ?? []).filter((x) => x.id !== id);
  if (!s.elementos.length) delete s.elementos;
  return confirmar(r);
}

/** Pone (o cambia) el faldón de un muro: techo inclinado que baja hasta `alturaEnMuro` junto a ese muro. */
export function ponerFaldon(e: Espacio, faldon: Faldon, estanciaId?: string): Espacio {
  const est = estancia(e, estanciaId).estancia;
  const r = clonar(e);
  const s = estancia(r, est.id).estancia;
  s.faldones = [...(s.faldones ?? []).filter((f) => f.muro !== faldon.muro), faldon].sort((a, b) => a.muro - b.muro);
  return confirmar(r);
}

export function quitarFaldon(e: Espacio, muro: number, estanciaId?: string): Espacio {
  const est = estancia(e, estanciaId).estancia;
  if (!(est.faldones ?? []).some((f) => f.muro === muro)) throw new ErrorOperacion(`La estancia «${est.id}» no tiene techo inclinado en el muro ${muro}`);
  const r = clonar(e);
  const s = estancia(r, est.id).estancia;
  s.faldones = (s.faldones ?? []).filter((f) => f.muro !== muro);
  if (!s.faldones.length) delete s.faldones;
  return confirmar(r);
}
