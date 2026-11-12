// Genera las salidas de referencia de la v1 para exigir que la migración a v2
// no cambie nada: por cada caso, el espacio v1 y lo que dan `analizar --json`, `plano` y `plano --svg`.
// Uso (una sola vez, con el CLI de la v1 en dist/): node scripts/referencias_v1.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(raiz, 'dist', 'Espacios3D', 'espacios3d.mjs');
const destino = join(raiz, 'tests', 'referencia_v1');

const caja = (id, x, y, ancho, fondo, extra = {}) => ({ id, tipo: 'caja', ancho, fondo, alto: 80, x, y, ...extra });
const casos = {
  rectangular: {
    estancia: { contorno: [[0, 0], [380, 0], [380, 320], [0, 320]], huecos: [
      { id: 'puerta', tipo: 'puerta', muro: 3, desde: 20, ancho: 80 },
      { id: 'ventana', tipo: 'ventana', muro: 0, desde: 140, ancho: 120, antepecho: 95, alto: 110 },
    ] },
    muebles: [
      { id: 'cama', tipo: 'cama', ancho: 150, fondo: 200, alto: 50, x: 280, y: 120, giro: 90 },
      { id: 'escritorio', tipo: 'escritorio', ancho: 120, fondo: 60, alto: 75, x: 60, y: 30 },
      { id: 'silla', tipo: 'silla', ancho: 45, fondo: 50, alto: 90, x: 60, y: 70, giro: 180 },
      { id: 'armario', tipo: 'armario', ancho: 100, fondo: 60, alto: 200, x: 40, y: 230 },
      { id: 'alfombra', tipo: 'alfombra', ancho: 140, fondo: 100, alto: 1, x: 190, y: 200 },
    ],
  },
  ele: {
    estancia: { contorno: [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]], grosorMuros: 15, huecos: [
      { id: 'paso', tipo: 'paso', muro: 1, desde: 10, ancho: 80 },
    ] },
    muebles: [caja('a', 150, 50, 100, 60), caja('b', 50, 200, 60, 100, { giro: 90 }), caja('fuera', 150, 150, 50, 50)],
  },
  diagonal: {
    estancia: { contorno: [[0, 0], [300, 0], [400, 137], [400, 300], [0, 300]], altura: 240, huecos: [
      { id: 'p', tipo: 'puerta', muro: 1, desde: 20, ancho: 80, bisagra: 'fin', abre: 'dentro' },
    ] },
    muebles: [caja('m', 320, 60, 20, 20), { ...caja('alto', 200, 200, 50, 50), alto: 260 }],
  },
  inverso: {
    estancia: { contorno: [[0, 0], [0, 300], [400, 300], [400, 0]], huecos: [{ id: 'p', tipo: 'puerta', muro: 0, desde: 40, ancho: 80, abre: 'fuera' }] },
    muebles: [caja('a', 30, 80, 50, 50), { id: 'arm', tipo: 'armario', ancho: 100, fondo: 60, alto: 200, x: 370, y: 150, giro: 90 }, caja('cosa', 300, 150, 50, 50)],
  },
  vacio: { estancia: { contorno: [[0, 0], [250, 0], [250, 250], [0, 250]] }, muebles: [] },
  distribuciones: {
    estancia: { contorno: [[0, 0], [400, 0], [400, 300], [0, 300]] },
    muebles: [caja('a', 100, 100, 50, 50), { ...caja('b', 200, 100, 50, 50), bloqueado: true }],
    distribuciones: [{ nombre: 'Una', posiciones: { a: { x: 120, y: 100, giro: 90 }, b: { x: 200, y: 100, giro: 0 } } }],
    notas: 'caso de referencia',
  },
};

rmSync(destino, { recursive: true, force: true });
for (const [nombre, datos] of Object.entries(casos)) {
  const dir = join(destino, nombre);
  mkdirSync(dir, { recursive: true });
  const archivo = join(dir, 'espacio.v1.json');
  writeFileSync(archivo, `${JSON.stringify({ formato: 'espacios3d', version: 1, nombre: `Caso ${nombre}`, ...datos }, null, 2)}\n`);
  const correr = (...a) => spawnSync(process.execPath, [cli, ...a], { encoding: 'utf8' });
  const analizar = correr('analizar', archivo, '--json');
  const plano = correr('plano', archivo);
  const svg = join(dir, 'plano.svg');
  const rs = correr('plano', archivo, '--svg', svg);
  if (plano.status !== 0 || rs.status !== 0 || (analizar.status !== 0 && analizar.status !== 1)) throw new Error(`${nombre}: ${analizar.stderr}${plano.stderr}${rs.stderr}`);
  writeFileSync(join(dir, 'analizar.json'), analizar.stdout);
  writeFileSync(join(dir, 'plano.txt'), plano.stdout);
  console.log(`${nombre}: analizar=${analizar.status}`);
}
