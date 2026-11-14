// Dónde se guarda el espacio. Tres implementaciones con la misma interfaz:
//  - disco: File System Access (Chrome/Edge), escribe en el archivo elegido; el manejador se
//    recuerda en IndexedDB para «Continuar con …» tras volver a abrir la página.
//  - descarga: <input type=file> para abrir y descarga para guardar (Firefox/Safari).
//  - prueba: objeto inyectado por las pruebas automáticas en window.__ESPACIOS3D_ALMACEN__.

import { rutaRelativaValida } from '../core/index.js';
export interface Leido {
  texto: string;
  nombre: string;
  /**
   * Vincula el archivo leído como destino del guardado. Se llama sólo si su contenido es válido:
   * un archivo con errores no debe quedar vinculado, porque el autoguardado lo sobrescribiría.
   */
  aceptar(): Promise<void>;
}

export interface Instantanea {
  texto: string;
  lm: number;
}

export interface Almacen {
  readonly tipo: 'disco' | 'descarga' | 'prueba';
  nombreArchivo(): string | null;
  /** Hay un archivo vinculado en el que se puede escribir directamente. */
  vinculado(): boolean;
  abrir(): Promise<Leido | null>;
  guardar(texto: string): Promise<void>;
  guardarComo(texto: string, sugerido: string): Promise<boolean>;
  /** Texto y fecha del archivo vinculado, de la misma lectura; null si no hay archivo. */
  leer(): Promise<Instantanea | null>;
  /** Nombre del último archivo recordado que se puede reabrir con un gesto. */
  recordado?(): Promise<string | null>;
  continuar?(): Promise<Leido | null>;
  /** Vincular un archivo soltado sobre la página. */
  vincularSoltado?(item: DataTransferItem): Promise<Leido | null>;
  /**
   * Carpeta de trabajo (ronda 2): se elige una carpeta y se trabaja con los .espacio.json que
   * contiene; así la página puede leer y guardar junto al archivo sus planos de fondo.
   */
  abrirCarpeta?(): Promise<{ nombre: string; archivos: string[] } | null>;
  /** La última carpeta de trabajo recordada, sin selector (pide permiso si hace falta); null si no hay. */
  abrirCarpetaRecordada?(nombreValido?: (nombre: string) => boolean): Promise<{ nombre: string; archivos: string[] } | null>;
  abrirDeCarpeta?(ruta: string): Promise<Leido | null>;
  /** Crea un .espacio.json nuevo en la carpeta de trabajo (la ruta puede llevar subcarpetas) con este texto y lo deja vinculado. */
  crearEnCarpeta?(nombre: string, texto: string): Promise<Leido | null>;
  /** Nombre de la carpeta de trabajo y ruta del archivo vinculado dentro de ella (si se abrió así). */
  carpeta?(): { nombre: string; archivo: string | null } | null;
  /**
   * Número de la vinculación actual: cambia cada vez que se vincula un archivo, aunque se llame igual
   * y esté en una carpeta con el mismo nombre. Las cachés de fondos y modelos lo llevan en su clave.
   */
  vinculacion?(): number;
  /** Lee un archivo relativo a la carpeta del .espacio.json vinculado (null si no existe; lanza si falla al leer). */
  leerRelativo?(ruta: string): Promise<Blob | null>;
  /** Escribe un archivo relativo a la carpeta del .espacio.json vinculado, creando subcarpetas. */
  escribirRelativo?(ruta: string, datos: Blob): Promise<void>;
}

// Tipos mínimos de File System Access (no están en lib.dom).
interface ManejadorArchivo {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: string | Blob): Promise<void>; close(): Promise<void> }>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
}
interface ManejadorCarpeta {
  kind: 'directory';
  name: string;
  getFileHandle(nombre: string, o?: { create?: boolean }): Promise<ManejadorArchivo>;
  getDirectoryHandle(nombre: string, o?: { create?: boolean }): Promise<ManejadorCarpeta>;
  values(): AsyncIterable<ManejadorArchivo | ManejadorCarpeta>;
  /** Ruta de un archivo dentro de esta carpeta, por partes, o null si está fuera. */
  resolve?(h: ManejadorArchivo): Promise<string[] | null>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
}
interface VentanaFSA {
  showOpenFilePicker(o?: unknown): Promise<ManejadorArchivo[]>;
  showSaveFilePicker(o?: unknown): Promise<ManejadorArchivo>;
  showDirectoryPicker?(o?: unknown): Promise<ManejadorCarpeta>;
}

/** Partes de una ruta relativa «a/b/c.png» (sin vacías ni «..», ya validada por el núcleo). */
function partes(ruta: string): string[] {
  return ruta.split('/').filter((s) => s && s !== '.');
}

/** Une la carpeta de un archivo («espacios/casa.espacio.json» → «espacios») con una ruta relativa. */
function junto(archivo: string | null, ruta: string): string[] {
  const dir = archivo ? partes(archivo).slice(0, -1) : [];
  return [...dir, ...partes(ruta)];
}

const TIPOS = [{ description: 'Espacio 3D', accept: { 'application/json': ['.json'] } }];

// ---------- IndexedDB mínima para recordar el manejador ----------
function abrirBD(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('espacios3d', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('manejadores');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function bdPoner(clave: string, valor: unknown): Promise<void> {
  try {
    const bd = await abrirBD();
    await new Promise<void>((res, rej) => {
      const t = bd.transaction('manejadores', 'readwrite');
      t.objectStore('manejadores').put(valor, clave);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
    bd.close();
  } catch {
    /* sin IndexedDB no se recuerda el archivo; no impide trabajar */
  }
}
async function bdLeer<T>(clave: string): Promise<T | undefined> {
  try {
    const bd = await abrirBD();
    const v = await new Promise<T | undefined>((res, rej) => {
      const r = bd.transaction('manejadores').objectStore('manejadores').get(clave);
      r.onsuccess = () => res(r.result as T | undefined);
      r.onerror = () => rej(r.error);
    });
    bd.close();
    return v;
  } catch {
    return undefined;
  }
}

async function escribirEn(h: ManejadorArchivo, texto: string): Promise<void> {
  const w = await h.createWritable();
  await w.write(texto);
  await w.close();
}

function esCancelacion(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

class AlmacenDisco implements Almacen {
  readonly tipo = 'disco' as const;
  private manejador: ManejadorArchivo | null = null;
  private dir: ManejadorCarpeta | null = null;
  /** Carpeta recién elegida: no pasa a ser la de trabajo hasta que se abre o se crea un archivo en ella. */
  private dirElegida: ManejadorCarpeta | null = null;
  /** Ruta del archivo vinculado dentro de la carpeta de trabajo (null si se abrió de otra forma). */
  private rutaEnCarpeta: string | null = null;

  nombreArchivo(): string | null {
    return this.manejador?.name ?? null;
  }
  vinculado(): boolean {
    return this.manejador !== null;
  }
  private async vincular(h: ManejadorArchivo, rutaEnCarpeta: string | null = null, dir: ManejadorCarpeta | null = null): Promise<Leido> {
    const f = await h.getFile();
    return {
      texto: await f.text(),
      nombre: h.name,
      aceptar: async () => {
        this.gen = ++vinculaciones;
        this.manejador = h;
        this.rutaEnCarpeta = rutaEnCarpeta;
        // Sólo un archivo abierto desde una carpeta la convierte en la carpeta de trabajo.
        this.dir = rutaEnCarpeta ? dir : null;
        await bdPoner('ultimo', h);
        await bdPoner('carpeta', rutaEnCarpeta && dir ? { dir, ruta: rutaEnCarpeta } : null);
      },
    };
  }

  async abrirCarpeta(): Promise<{ nombre: string; archivos: string[] } | null> {
    const ventana = window as unknown as VentanaFSA;
    if (!ventana.showDirectoryPicker) return null;
    try {
      const d = await ventana.showDirectoryPicker({ mode: 'readwrite' });
      this.dirElegida = d;
      return { nombre: d.name, archivos: await this.listar(d, '', 0) };
    } catch (e) {
      if (esCancelacion(e)) return null;
      throw e;
    }
  }

  async abrirCarpetaRecordada(nombreValido?: (nombre: string) => boolean): Promise<{ nombre: string; archivos: string[] } | null> {
    const c = await bdLeer<{ dir: ManejadorCarpeta; ruta: string } | null>('carpeta');
    // Sin pedir permiso sobre una carpeta que no puede ser la buscada (revisión independiente, 4).
    if (!c?.dir || (nombreValido && !nombreValido(c.dir.name))) return null;
    const p = (await c.dir.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (p !== 'granted' && (await c.dir.requestPermission?.({ mode: 'readwrite' })) !== 'granted') return null;
    this.dirElegida = c.dir;
    return { nombre: c.dir.name, archivos: await this.listar(c.dir, '', 0) };
  }

  /** .espacio.json de la carpeta y de sus subcarpetas (hasta dos niveles). */
  private async listar(d: ManejadorCarpeta, prefijo: string, nivel: number): Promise<string[]> {
    const res: string[] = [];
    for await (const h of d.values()) {
      if (h.kind === 'file' && /\.espacio\.json$/i.test(h.name) && !/\.v1(-\d+)?\.espacio\.json$/i.test(h.name)) res.push(prefijo + h.name);
      else if (h.kind === 'directory' && nivel < 2 && !h.name.startsWith('.')) res.push(...(await this.listar(h, `${prefijo}${h.name}/`, nivel + 1)));
    }
    return res.sort((a, b) => a.localeCompare(b));
  }

  private async carpetaDe(trozos: string[], crear: boolean, raiz: ManejadorCarpeta | null = this.dir): Promise<ManejadorCarpeta> {
    let d = raiz!;
    for (const t of trozos) d = await d.getDirectoryHandle(t, { create: crear });
    return d;
  }

  async abrirDeCarpeta(ruta: string): Promise<Leido | null> {
    const d = this.dirElegida ?? this.dir;
    if (!d) return null;
    const t = partes(ruta);
    const h = await (await this.carpetaDe(t.slice(0, -1), false, d)).getFileHandle(t[t.length - 1]!);
    return this.vincular(h, ruta, d);
  }

  async crearEnCarpeta(nombre: string, texto: string): Promise<Leido | null> {
    const d = this.dirElegida ?? this.dir;
    if (!d) return null;
    const t = partes(nombre);
    const h = await (await this.carpetaDe(t.slice(0, -1), false, d)).getFileHandle(t[t.length - 1]!, { create: true });
    const w = await h.createWritable();
    await w.write(texto);
    await w.close();
    // Como al abrir: la página lo valida y lo vincula (el sincronizador parte de este texto).
    return this.vincular(h, nombre, d);
  }

  carpeta(): { nombre: string; archivo: string | null } | null {
    return this.dir ? { nombre: this.dir.name, archivo: this.rutaEnCarpeta } : null;
  }

  private gen = 0;
  vinculacion(): number {
    return this.gen;
  }

  async leerRelativo(ruta: string): Promise<Blob | null> {
    if (!this.dir || !this.rutaEnCarpeta) return null;
    const t = junto(this.rutaEnCarpeta, ruta);
    try {
      const h = await (await this.carpetaDe(t.slice(0, -1), false)).getFileHandle(t[t.length - 1]!);
      return await h.getFile();
    } catch (e) {
      // Sólo «no existe» es null; un fallo pasajero (el CLI renombrando su temporal, permisos) se
      // propaga para que nadie lo tome por un archivo que no está y escriba encima.
      const n = (e as DOMException).name;
      if (n === 'NotFoundError' || n === 'TypeMismatchError') return null;
      throw e;
    }
  }

  async escribirRelativo(ruta: string, datos: Blob): Promise<void> {
    if (!this.dir || !this.rutaEnCarpeta) throw new Error('Abre la carpeta de trabajo para guardar archivos junto al espacio');
    const t = junto(this.rutaEnCarpeta, ruta);
    const h = await (await this.carpetaDe(t.slice(0, -1), true)).getFileHandle(t[t.length - 1]!, { create: true });
    const w = await h.createWritable();
    await w.write(datos);
    await w.close();
  }
  async abrir(): Promise<Leido | null> {
    try {
      const [h] = await (window as unknown as VentanaFSA).showOpenFilePicker({ types: TIPOS, multiple: false });
      return h ? await this.vincular(h) : null;
    } catch (e) {
      if (esCancelacion(e)) return null;
      throw e;
    }
  }
  async guardar(texto: string): Promise<void> {
    if (!this.manejador) throw new Error('No hay archivo vinculado');
    await escribirEn(this.manejador, texto);
  }
  async guardarComo(texto: string, sugerido: string): Promise<boolean> {
    try {
      const h = await (window as unknown as VentanaFSA).showSaveFilePicker({ types: TIPOS, suggestedName: sugerido });
      // Primero se escribe: si falla, sigue vinculado el archivo de antes y no se lee el nuevo como
      // si fuera un cambio hecho fuera.
      await escribirEn(h, texto);
      // La carpeta de trabajo sigue al archivo: si el nuevo está dentro, con su ruta; si está fuera,
      // deja de haberla (sus planos, fotos y modelos no están junto a él).
      let ruta: string | null = null;
      try {
        ruta = this.dir ? ((await this.dir.resolve?.(h))?.join('/') ?? null) : null;
      } catch {
        ruta = null;
      }
      this.gen = ++vinculaciones;
      this.manejador = h;
      this.rutaEnCarpeta = ruta;
      if (!ruta) this.dir = null;
      await bdPoner('ultimo', h);
      await bdPoner('carpeta', ruta && this.dir ? { dir: this.dir, ruta } : null);
      return true;
    } catch (e) {
      if (esCancelacion(e)) return false;
      throw e;
    }
  }
  async leer(): Promise<Instantanea | null> {
    if (!this.manejador) return null;
    const f = await this.manejador.getFile();
    return { texto: await f.text(), lm: f.lastModified };
  }
  async recordado(): Promise<string | null> {
    if (this.manejador) return null;
    const h = await bdLeer<ManejadorArchivo>('ultimo');
    return h?.name ?? null;
  }
  async continuar(): Promise<Leido | null> {
    const h = await bdLeer<ManejadorArchivo>('ultimo');
    if (!h) return null;
    const permiso = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (permiso !== 'granted' && (await h.requestPermission?.({ mode: 'readwrite' })) !== 'granted') return null;
    const c = await bdLeer<{ dir: ManejadorCarpeta; ruta: string } | null>('carpeta');
    if (c?.dir) {
      const pc = (await c.dir.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
      if (pc === 'granted' || (await c.dir.requestPermission?.({ mode: 'readwrite' })) === 'granted') {
        this.dir = c.dir;
        return this.vincular(h, c.ruta, c.dir);
      }
    }
    return this.vincular(h);
  }
  async vincularSoltado(item: DataTransferItem): Promise<Leido | null> {
    const conManejador = item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<ManejadorArchivo | null> };
    const h = await conManejador.getAsFileSystemHandle?.();
    if (!h || h.kind !== 'file') return null;
    const permiso = (await h.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (permiso !== 'granted') return null;
    return this.vincular(h);
  }
}

class AlmacenDescarga implements Almacen {
  readonly tipo = 'descarga' as const;
  private nombre: string | null = null;

  nombreArchivo(): string | null {
    return this.nombre;
  }
  vinculado(): boolean {
    return false;
  }
  abrir(): Promise<Leido | null> {
    return new Promise((res) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return res(null);
        res({
          texto: await f.text(),
          nombre: f.name,
          aceptar: async () => {
            this.nombre = f.name;
          },
        });
      });
      input.addEventListener('cancel', () => res(null));
      input.click();
    });
  }
  async guardar(texto: string): Promise<void> {
    descargar(texto, this.nombre ?? 'espacio.espacio.json');
  }
  async guardarComo(texto: string, sugerido: string): Promise<boolean> {
    this.nombre = sugerido;
    descargar(texto, sugerido);
    return true;
  }
  async leer(): Promise<Instantanea | null> {
    return null;
  }
}

function descargar(texto: string, nombre: string): void {
  const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Copia un archivo junto al espacio vinculado, en `subcarpeta` (planos/, modelos/), sin pisar otro
 * distinto con el mismo nombre: plano.png, plano-2.png… Si ya hay uno con el mismo contenido, se
 * reutiliza. Devuelve la ruta relativa. Lanza un Error si no hay carpeta o el nombre no vale.
 */
export async function copiarJuntoAlEspacio(alm: Almacen, subcarpeta: string, nombre: string, extension: string, datos: Blob, porDefecto: string): Promise<string> {
  if (!alm.escribirRelativo || !alm.leerRelativo) throw new Error('no hay carpeta de trabajo');
  const base =
    nombre
      .replace(/\.[^.]*$/, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || porDefecto;
  const bytes = new Uint8Array(await datos.arrayBuffer());
  for (let n = 1; ; n++) {
    const candidata = `${subcarpeta}/${base}${n === 1 ? '' : `-${n}`}.${extension}`;
    if (rutaRelativaValida(candidata)) throw new Error('nombre de archivo no válido');
    const existente = await alm.leerRelativo(candidata);
    if (!existente) {
      await alm.escribirRelativo(candidata, datos);
      return candidata;
    }
    if (igualBytes(new Uint8Array(await existente.arrayBuffer()), bytes)) return candidata;
  }
}

function igualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Contador de vinculaciones de toda la página (también entre almacenes nuevos). */
let vinculaciones = 0;

export function crearAlmacen(): Almacen {
  // Las pruebas inyectan una fábrica: cada llamada da un almacén nuevo sin archivo, como en disco.
  const fabrica = (window as unknown as { __ESPACIOS3D_ALMACEN__?: () => Almacen }).__ESPACIOS3D_ALMACEN__;
  if (typeof fabrica === 'function') return fabrica();
  if ('showOpenFilePicker' in window && 'showSaveFilePicker' in window) return new AlmacenDisco();
  return new AlmacenDescarga();
}

// ---------- Borrador de recuperación en localStorage ----------
// Todos los HTML abiertos desde file:// comparten origen en Chromium: claves con prefijo y nombre.
const PREFIJO = 'espacios3d:borrador:';

export function guardarBorrador(nombre: string, texto: string): void {
  try {
    const anterior = localStorage.getItem(`${PREFIJO}@ultimo`);
    if (anterior && anterior !== nombre) localStorage.removeItem(PREFIJO + anterior);
    localStorage.setItem(PREFIJO + nombre, texto);
    localStorage.setItem(`${PREFIJO}@ultimo`, nombre);
  } catch {
    /* sin almacenamiento local: el borrador no es imprescindible */
  }
}

/** Al quedar todo en un archivo, el borrador sobra: si no, al reabrir se cargaría algo viejo. */
export function borrarBorrador(): void {
  try {
    const nombre = localStorage.getItem(`${PREFIJO}@ultimo`);
    if (nombre) localStorage.removeItem(PREFIJO + nombre);
    localStorage.removeItem(`${PREFIJO}@ultimo`);
  } catch {
    /* nada que borrar */
  }
}

export function leerUltimoBorrador(): string | null {
  try {
    const nombre = localStorage.getItem(`${PREFIJO}@ultimo`);
    return nombre ? localStorage.getItem(PREFIJO + nombre) : null;
  } catch {
    return null;
  }
}
