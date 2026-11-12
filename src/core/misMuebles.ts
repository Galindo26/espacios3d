// «Mis muebles» (R2-6): los muebles que la persona (o un agente) guarda para reutilizarlos en otros
// espacios de la misma carpeta, con sus medidas, su color, sus piezas y su modelo. Se guardan en
// `mis-muebles.json`, junto a los .espacio.json; las rutas de los modelos son relativas a esa carpeta.
import type { Mueble } from './tipos.js';
import { validar } from './validar.js';

export const ARCHIVO_MIS_MUEBLES = 'mis-muebles.json';

/** Un mueble guardado: todo lo del mueble salvo su id, su posición y su estado en un espacio. */
export type MuebleGuardado = Omit<Mueble, 'id' | 'x' | 'y' | 'giro' | 'elevacion' | 'bloqueado'>;

export interface MisMuebles {
  formato: 'espacios3d-muebles';
  version: 1;
  muebles: MuebleGuardado[];
}

export function misMueblesVacio(): MisMuebles {
  return { formato: 'espacios3d-muebles', version: 1, muebles: [] };
}

export function guardadoDeMueble(m: Mueble, nombre = m.nombre): MuebleGuardado {
  const { id: _id, x: _x, y: _y, giro: _g, elevacion: _e, bloqueado: _b, ...resto } = m;
  return { ...resto, nombre };
}

/**
 * Valida `mis-muebles.json` con las mismas reglas que un mueble de un espacio (piezas que caben,
 * modelo .glb con ruta relativa…). Los errores llevan la ruta dentro del archivo (muebles[2].alto).
 */
export function validarMisMuebles(datos: unknown): { ok: true; misMuebles: MisMuebles } | { ok: false; errores: string[] } {
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) return { ok: false, errores: ['debe ser un objeto {formato, version, muebles}'] };
  const d = datos as Record<string, unknown>;
  const errores: string[] = [];
  if (d.formato !== 'espacios3d-muebles') errores.push('formato: debe ser «espacios3d-muebles»');
  if (d.version !== 1) errores.push('version: debe ser 1');
  for (const k of Object.keys(d)) if (!['formato', 'version', 'muebles'].includes(k)) errores.push(`${k}: campo desconocido`);
  if (!Array.isArray(d.muebles)) errores.push('muebles: debe ser una lista');
  if (errores.length) return { ok: false, errores };
  const lista = d.muebles as unknown[];
  for (const [i, x] of lista.entries()) {
    if (typeof x !== 'object' || x === null || Array.isArray(x)) errores.push(`muebles[${i}]: debe ser un objeto`);
    else for (const k of ['id', 'x', 'y', 'giro', 'elevacion', 'bloqueado']) if (k in x) errores.push(`muebles[${i}].${k}: no se guarda (depende de dónde se coloque)`);
  }
  if (errores.length) return { ok: false, errores };
  // Cada mueble se valida dentro de un espacio de prueba, con id y posición propios.
  const prueba = {
    formato: 'espacios3d',
    version: 2,
    plantas: [{ id: 'p', estancias: [{ id: 's', contorno: [[0, 0], [1, 0], [1, 1], [0, 1]] }], muebles: lista.map((x, i) => ({ ...(x as object), id: `m${i}`, x: 0, y: 0 })) }],
  };
  const r = validar(prueba);
  if (!r.ok) {
    return { ok: false, errores: r.errores.map((e) => e.replace(/^plantas\[0\]\.muebles\[(\d+)\]/, 'muebles[$1]')) };
  }
  const nombres = new Set<string>();
  for (const [i, m] of r.espacio.plantas[0]!.muebles.entries()) {
    if (nombres.has(m.nombre)) errores.push(`muebles[${i}].nombre: ya hay otro «${m.nombre}» (los nombres no se repiten)`);
    nombres.add(m.nombre);
  }
  if (errores.length) return { ok: false, errores };
  return { ok: true, misMuebles: { formato: 'espacios3d-muebles', version: 1, muebles: r.espacio.plantas[0]!.muebles.map((m) => guardadoDeMueble(m)) } };
}

/** Guarda (o sustituye, si ya hay uno con ese nombre) un mueble en la lista. */
export function guardarEnMisMuebles(lista: MisMuebles, m: MuebleGuardado): MisMuebles {
  const i = lista.muebles.findIndex((x) => x.nombre === m.nombre);
  const muebles = [...lista.muebles];
  if (i >= 0) muebles[i] = m;
  else muebles.push(m);
  return { ...lista, muebles };
}

export function quitarDeMisMuebles(lista: MisMuebles, nombre: string): MisMuebles {
  return { ...lista, muebles: lista.muebles.filter((x) => x.nombre !== nombre) };
}

export function buscarEnMisMuebles(lista: MisMuebles, nombre: string): MuebleGuardado | undefined {
  return lista.muebles.find((x) => x.nombre === nombre) ?? lista.muebles.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase());
}

export function misMueblesAJSON(lista: MisMuebles): string {
  return `${JSON.stringify(lista, null, 2)}\n`;
}
