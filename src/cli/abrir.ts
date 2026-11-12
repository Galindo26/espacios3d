// «abrir»: copia de la página con un espacio dentro, para que el agente se la enseñe a la persona ya
// cargada (ronda 5, docs/PLAN_R5.md). Una página abierta desde el disco no puede leer un archivo sin un
// gesto de la persona, así que el texto del .espacio.json y sus archivos (fondos, modelos y fotos) van
// dentro de la página. La página no lo vincula a ningún archivo hasta que la persona abre su carpeta.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import * as N from '../core/index.js';

/** Marca de plantilla.html donde va el espacio (justo antes del script de la página). */
export const MARCA_ABIERTO = '<!--@@ESPACIOS3D_ABIERTO@@-->';
/** Tope por defecto de los archivos metidos en la página (bytes). */
export const TOPE_INCRUSTADO = 64 * 1024 * 1024;

export interface ArchivoIncrustado {
  tipo: string;
  datos: string;
}
export interface Omitido {
  ruta: string;
  motivo: string;
}
/** Lo que lee la página en window.__ESPACIOS3D_ABIERTO__ (mismo contrato en src/app/abierto.ts). */
export interface DatosAbierto {
  version: 1;
  /** Texto exacto del .espacio.json, para comparar con el del disco al vincular. */
  texto: string;
  nombre: string;
  ruta: string;
  copiadaEn: string;
  archivos: Record<string, ArchivoIncrustado>;
  omitidos: Omitido[];
}

const TIPOS: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', glb: 'model/gltf-binary' };

/** Rutas relativas que usa el espacio, en orden de importancia: fondos, modelos y fotos (sin repetir). */
export function archivosDelEspacio(e: N.Espacio): string[] {
  const fondos: string[] = [];
  const modelos: string[] = [];
  const fotos: string[] = [];
  for (const p of e.plantas) {
    for (const f of p.fondos ?? []) fondos.push(f.archivo);
    for (const s of p.estancias) fotos.push(...(s.fotos ?? []));
    for (const m of p.muebles) {
      if (m.modelo) modelos.push(m.modelo.archivo);
      fotos.push(...(m.fotos ?? []));
    }
  }
  return [...new Set([...fondos, ...modelos, ...fotos])];
}

/**
 * Lee los archivos del espacio que quedan dentro de su carpeta (resueltos enlaces y uniones), hasta el
 * tope; lo demás se omite con su motivo.
 */
export function recogerArchivos(rutaEspacio: string, e: N.Espacio, tope: number): { archivos: Record<string, ArchivoIncrustado>; omitidos: Omitido[] } {
  const base = realpathSync.native(dirname(resolve(rutaEspacio)));
  // En la raíz de una unidad la ruta ya acaba en el separador (C:\).
  const prefijo = base.endsWith(sep) ? base : base + sep;
  const archivos: Record<string, ArchivoIncrustado> = {};
  const omitidos: Omitido[] = [];
  let total = 0;
  for (const ruta of archivosDelEspacio(e)) {
    const malo = N.rutaRelativaValida(ruta);
    if (malo) {
      omitidos.push({ ruta, motivo: malo });
      continue;
    }
    let real: string;
    try {
      real = realpathSync.native(join(base, ...ruta.split('/')));
    } catch {
      omitidos.push({ ruta, motivo: 'no está en la carpeta' });
      continue;
    }
    if (!real.startsWith(prefijo)) {
      omitidos.push({ ruta, motivo: 'queda fuera de la carpeta del .espacio.json (por un enlace)' });
      continue;
    }
    // Una carpeta o un archivo ilegible se omite con su motivo, sin tumbar «abrir» (revisión independiente, 9).
    let datos: Buffer;
    try {
      const st = statSync(real);
      if (!st.isFile()) {
        omitidos.push({ ruta, motivo: 'no es un archivo' });
        continue;
      }
      if (total + st.size > tope) {
        omitidos.push({ ruta, motivo: `no cabe en la página (tope de ${Math.round(tope / 1024 / 1024)} MB entre todos)` });
        continue;
      }
      datos = readFileSync(real);
    } catch (e) {
      omitidos.push({ ruta, motivo: `no se puede leer: ${(e as Error).message}` });
      continue;
    }
    total += datos.length;
    const ext = (ruta.split('.').pop() ?? '').toLowerCase();
    archivos[ruta] = { tipo: TIPOS[ext] ?? 'application/octet-stream', datos: datos.toString('base64') };
  }
  return { archivos, omitidos };
}

/** JSON que se puede poner dentro de <script> sin cerrarlo ni abrir comentarios HTML. */
export function jsonParaScript(v: unknown): string {
  return JSON.stringify(v).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** La página con el espacio dentro (la plantilla debe llevar la marca una sola vez). */
export function paginaConEspacio(html: string, datos: DatosAbierto): string {
  const trozos = html.split(MARCA_ABIERTO);
  if (trozos.length !== 2) throw new Error('Espacios3D.html no es de esta versión de la herramienta (falta la marca para abrir con un espacio): usa los dos archivos de la misma carpeta de entrega');
  return trozos.join(`<script>window.__ESPACIOS3D_ABIERTO__=${jsonParaScript(datos)};</script>`);
}

/** Dónde va la copia: una por archivo (por su ruta real), que se sobrescribe al volver a abrirlo. */
export function rutaCopia(rutaEspacio: string, nombre: string): string {
  let real = realpathSync.native(resolve(rutaEspacio));
  if (process.platform === 'win32') real = real.toLowerCase();
  const hash = createHash('sha256').update(real).digest('hex').slice(0, 12);
  const limpio = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'espacio';
  return join(tmpdir(), 'espacios3d', `${limpio}-${hash}.html`);
}

/** Marca de las páginas que hace «abrir» (para no pisar un .html ajeno con --salida). */
export const MARCA_COPIA = '__ESPACIOS3D_ABIERTO__';

/** Borra las copias de más de 7 días de la carpeta temporal (llevan el plano, las fotos y la ruta). */
export function limpiarCopiasViejas(): void {
  const dir = join(tmpdir(), 'espacios3d');
  const limite = Date.now() - 7 * 24 * 3600 * 1000;
  try {
    for (const n of readdirSync(dir)) {
      if (!/\.html(\.\d+\.tmp)?$/i.test(n)) continue;
      try {
        if (statSync(join(dir, n)).mtimeMs < limite) unlinkSync(join(dir, n));
      } catch {
        /* en uso o ya borrada */
      }
    }
  } catch {
    /* sin carpeta todavía */
  }
}

/** Escribe con un temporal y renombra: nunca queda una página a medias. */
export function escribirPagina(destino: string, html: string): void {
  mkdirSync(dirname(destino), { recursive: true });
  const tmp = `${destino}.${process.pid}.tmp`;
  writeFileSync(tmp, html, 'utf8');
  renameSync(tmp, destino);
}

/**
 * Abre un archivo con el programa predeterminado (el navegador para un .html), sin consola ni shell.
 * Devuelve si se pudo lanzar el proceso; no puede comprobar que la ventana se abrió.
 */
export function lanzar(pagina: string): boolean {
  if (process.env.ESPACIOS3D_NO_LANZAR === '1') return false;
  let exe: string;
  if (process.platform === 'win32') exe = join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe');
  else if (process.platform === 'darwin') exe = '/usr/bin/open';
  else exe = 'xdg-open';
  try {
    const p = spawn(exe, [pagina], { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
    p.on('error', () => undefined);
    p.unref();
    return true;
  } catch {
    return false;
  }
}

/** Ruta de Espacios3D.html: junto a este espacios3d.mjs. */
export function rutaPaginaBase(): string {
  return join(dirname(realpathSync.native(process.argv[1]!)), 'Espacios3D.html');
}

export function nombreSinExtension(ruta: string): string {
  return basename(ruta).replace(/\.espacio\.json$/i, '');
}
