// Página abierta por un agente con «abrir» (docs/PLAN_R5.md, R5-2): el espacio y sus archivos vienen
// dentro de la página (window.__ESPACIOS3D_ABIERTO__, ver src/cli/abrir.ts). Es una copia: no se vincula
// a ningún archivo hasta que la persona abre su carpeta, y entonces se reconcilia con el del disco.
import type { Almacen } from './almacen.js';

export interface DatosAbierto {
  version: 1;
  /** Texto exacto del .espacio.json cuando el agente abrió la página. */
  texto: string;
  /** Nombre del archivo (casa.espacio.json). */
  nombre: string;
  /** Ruta absoluta del archivo en el ordenador del agente. */
  ruta: string;
  /** Fecha ISO de la copia. */
  copiadaEn: string;
  archivos: Record<string, { tipo: string; datos: string }>;
  omitidos: { ruta: string; motivo: string }[];
}

/** Los datos incrustados, si la página los trae y tienen la forma esperada. */
export function leerAbierto(): DatosAbierto | null {
  const d = (globalThis as { __ESPACIOS3D_ABIERTO__?: unknown }).__ESPACIOS3D_ABIERTO__ as Partial<DatosAbierto> | undefined;
  if (!d || typeof d !== 'object' || d.version !== 1 || typeof d.texto !== 'string' || typeof d.nombre !== 'string' || typeof d.ruta !== 'string') return null;
  return {
    version: 1,
    texto: d.texto,
    nombre: d.nombre,
    ruta: d.ruta,
    copiadaEn: typeof d.copiadaEn === 'string' ? d.copiadaEn : '',
    archivos: d.archivos && typeof d.archivos === 'object' ? d.archivos : {},
    omitidos: Array.isArray(d.omitidos) ? d.omitidos : [],
  };
}

function blobDe(a: { tipo: string; datos: string }): Blob {
  const bin = atob(a.datos);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: a.tipo });
}

/**
 * El almacén real, pero mientras no haya archivo vinculado los archivos relativos (fondos, modelos y
 * fotos) salen de lo incrustado. Lo demás es del almacén real, también los métodos opcionales: así
 * «carpeta()» sigue siendo null y nada cree que puede escribir junto al espacio.
 */
export function almacenConAbierto(real: Almacen, datos: DatosAbierto, activo: () => boolean = () => true): Almacen {
  const cache = new Map<string, Blob>();
  const incrustado = async (ruta: string): Promise<Blob | null> => {
    const a = datos.archivos[ruta];
    if (!a) return null;
    if (!cache.has(ruta)) cache.set(ruta, blobDe(a));
    return cache.get(ruta)!;
  };
  return new Proxy(real, {
    get(obj, prop, receptor) {
      // Sólo mientras se ve la copia: en Firefox y Safari nunca hay vinculación, y otro espacio con la
      // misma ruta relativa no debe ver el plano de la casa del agente (revisión independiente, 10).
      if (prop === 'leerRelativo' && activo() && !obj.vinculado()) return incrustado;
      const v = Reflect.get(obj, prop, receptor);
      return typeof v === 'function' ? v.bind(obj) : v;
    },
  });
}

/** Ruta con «/» y en minúsculas, para comparar rutas de Windows y de los demás sistemas. */
export const normalRuta = (s: string): string => s.replace(/\\/g, '/').toLowerCase();
const normal = normalRuta;

/**
 * Ruta (relativa a la carpeta elegida) del archivo que abrió el agente: la que, con el nombre de la
 * carpeta delante, es el final de su ruta absoluta. Sin coincidencia, null (nunca por el nombre solo).
 */
export function rutaEnCarpetaElegida(datos: DatosAbierto, carpeta: { nombre: string; archivos: string[] }): string | null {
  const destino = normal(datos.ruta);
  const c = carpeta.archivos.find((r) => destino.endsWith(`/${normal(carpeta.nombre)}/${normal(r)}`));
  return c ?? null;
}

/** Un nombre de archivo que no esté en la lista: casa-mio.espacio.json, casa-mio-2.espacio.json… */
export function nombreLibre(nombre: string, ocupados: readonly string[]): string {
  const base = nombre.replace(/\.espacio\.json$/i, '');
  const usados = new Set(ocupados.map((x) => x.toLowerCase()));
  for (let k = 1; ; k++) {
    const n = `${base}-mio${k > 1 ? `-${k}` : ''}.espacio.json`;
    if (!usados.has(n.toLowerCase())) return n;
  }
}
