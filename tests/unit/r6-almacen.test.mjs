// Ronda 6: el almacén de disco real (File System Access) con manejadores y una IndexedDB de mentira.
// «Guardar como» no cambia de archivo hasta haber escrito, y la carpeta de trabajo sigue al archivo nuevo.
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

const bd = new Map();
const control = { abrir: null, guardar: null, carpeta: null };

globalThis.indexedDB = {
  open() {
    const r = {};
    const base = {
      createObjectStore() {},
      close() {},
      transaction() {
        const t = {
          objectStore: () => ({
            put(v, k) {
              bd.set(k, v);
              queueMicrotask(() => t.oncomplete?.());
            },
            get(k) {
              const q = {};
              queueMicrotask(() => {
                q.result = bd.get(k);
                q.onsuccess?.();
              });
              return q;
            },
          }),
        };
        return t;
      },
    };
    queueMicrotask(() => {
      r.result = base;
      r.onsuccess?.();
    });
    return r;
  },
};
globalThis.window = {
  showOpenFilePicker: async () => [control.abrir],
  showSaveFilePicker: async () => control.guardar,
  showDirectoryPicker: async () => control.carpeta,
};

const { crearAlmacen } = await import('../../build/almacen.mjs');

/** Archivo de mentira; con `falla`, escribir en él da error. */
function archivo(nombre, texto = '', falla = false) {
  const h = {
    kind: 'file',
    name: nombre,
    texto,
    getFile: async () => ({ text: async () => h.texto, lastModified: 1 }),
    createWritable: async () => {
      if (falla) throw new Error('disco lleno');
      let nuevo = '';
      return { write: async (d) => void (nuevo = d), close: async () => void (h.texto = nuevo) };
    },
  };
  return h;
}

/** Carpeta de mentira a partir de {nombre: archivo | {…subcarpeta}}. */
function carpeta(nombre, contenido) {
  const hijos = new Map(Object.entries(contenido).map(([n, v]) => [n, v.kind ? v : carpeta(n, v)]));
  const noEsta = () => Object.assign(new Error('no existe'), { name: 'NotFoundError' });
  const d = {
    kind: 'directory',
    name: nombre,
    getFileHandle: async (n) => (hijos.get(n)?.kind === 'file' ? hijos.get(n) : Promise.reject(noEsta())),
    getDirectoryHandle: async (n) => (hijos.get(n)?.kind === 'directory' ? hijos.get(n) : Promise.reject(noEsta())),
    async *values() {
      yield* hijos.values();
    },
    resolve: async (h) => {
      for (const [n, v] of hijos) {
        if (v === h) return [n];
        if (v.kind === 'directory') {
          const r = await v.resolve(h);
          if (r) return [n, ...r];
        }
      }
      return null;
    },
  };
  return d;
}

beforeEach(() => bd.clear());

describe('«Guardar como» en disco', () => {
  test('si no se puede escribir, sigue vinculado el archivo de antes', async () => {
    const a = archivo('a.espacio.json', '{"a":1}');
    const alm = crearAlmacen();
    control.abrir = a;
    await (await alm.abrir()).aceptar();
    control.guardar = archivo('b.espacio.json', '{"b":2}', true);
    await assert.rejects(alm.guardarComo('{"nuevo":3}', 'b.espacio.json'), /disco lleno/);
    assert.equal(alm.nombreArchivo(), 'a.espacio.json');
    assert.equal((await alm.leer()).texto, '{"a":1}');
    assert.equal(bd.get('ultimo'), a);
  });

  test('fuera de la carpeta de trabajo, deja de haberla (también al continuar otro día)', async () => {
    const casa = archivo('casa.espacio.json', '{}');
    const dir = carpeta('casa', { 'casa.espacio.json': casa, planos: { 'p.png': archivo('p.png', 'PNG') } });
    const alm = crearAlmacen();
    control.carpeta = dir;
    await alm.abrirCarpeta();
    await (await alm.abrirDeCarpeta('casa.espacio.json')).aceptar();
    assert.ok(await alm.leerRelativo('planos/p.png'));
    const antes = alm.vinculacion();
    const copia = archivo('copia.espacio.json');
    control.guardar = copia;
    assert.equal(await alm.guardarComo('{"c":1}', 'copia.espacio.json'), true);
    assert.equal(copia.texto, '{"c":1}');
    assert.equal(alm.nombreArchivo(), 'copia.espacio.json');
    assert.equal(alm.carpeta(), null);
    assert.equal(await alm.leerRelativo('planos/p.png'), null);
    assert.ok(alm.vinculacion() > antes, 'es otra vinculación: lo cargado del archivo anterior no vale');
    const otroDia = crearAlmacen();
    await (await otroDia.continuar()).aceptar();
    assert.equal(otroDia.nombreArchivo(), 'copia.espacio.json');
    assert.equal(otroDia.carpeta(), null);
  });

  test('dentro de la carpeta de trabajo, sigue siéndolo con la ruta del archivo nuevo', async () => {
    const casa = archivo('casa.espacio.json', '{}');
    const copia = archivo('copia.espacio.json');
    const dir = carpeta('casa', { 'casa.espacio.json': casa, copias: { 'copia.espacio.json': copia, 'p.png': archivo('p.png', 'PNG') } });
    const alm = crearAlmacen();
    control.carpeta = dir;
    await alm.abrirCarpeta();
    await (await alm.abrirDeCarpeta('casa.espacio.json')).aceptar();
    control.guardar = copia;
    assert.equal(await alm.guardarComo('{"c":1}', 'copia.espacio.json'), true);
    assert.deepEqual(alm.carpeta(), { nombre: 'casa', archivo: 'copias/copia.espacio.json' });
    assert.ok(await alm.leerRelativo('p.png'), 'lo relativo se busca junto al archivo nuevo');
    assert.deepEqual(bd.get('carpeta'), { dir, ruta: 'copias/copia.espacio.json' });
  });
});
