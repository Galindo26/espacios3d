// Migración v1 → v2: con los archivos de referencia de la v1 (tests/referencia_v1, generados con el
// CLI de la v1 por scripts/referencias_v1.mjs) la v2 debe dar exactamente las mismas salidas de
// `analizar --json`, `plano` y `plano --svg`, antes y después de convertir el archivo, y dejar una
// copia intacta de la v1 al escribir.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(RAIZ, 'dist', 'Espacios3D', 'espacios3d.mjs');
const REF = join(RAIZ, 'tests', 'referencia_v1');
const dir = mkdtempSync(join(tmpdir(), 'espacios3d-migracion-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const correr = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });

function salidas(archivo, svg) {
  const analizar = correr('analizar', archivo, '--json');
  const plano = correr('plano', archivo);
  const rs = correr('plano', archivo, '--svg', svg);
  assert.ok(analizar.status === 0 || analizar.status === 1, analizar.stderr);
  assert.equal(plano.status, 0, plano.stderr);
  assert.equal(rs.status, 0, rs.stderr);
  return { analizar: analizar.stdout, plano: plano.stdout, svg: readFileSync(svg, 'utf8') };
}

function comparar(caso, s) {
  // Los archivos de referencia pueden haberse guardado con CRLF en Windows: se compara el texto.
  const ref = (n) => readFileSync(join(REF, caso, n), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(s.analizar.replace(/\r\n/g, '\n'), ref('analizar.json'), `${caso}: analizar`);
  assert.equal(s.plano.replace(/\r\n/g, '\n'), ref('plano.txt'), `${caso}: plano`);
  assert.equal(s.svg.replace(/\r\n/g, '\n'), ref('plano.svg'), `${caso}: svg`);
}

const casos = readdirSync(REF);

describe('migración v1 → v2 frente a las salidas de la v1', () => {
  test('hay casos de referencia', () => assert.ok(casos.length >= 6, casos.join()));

  for (const caso of casos) {
    test(`${caso}: mismas salidas al leer la v1, al convertirla y tras la ida y vuelta`, () => {
      const v1 = join(REF, caso, 'espacio.v1.json');
      const archivo = join(dir, `${caso}.espacio.json`);
      copyFileSync(v1, archivo);
      comparar(caso, salidas(archivo, join(dir, `${caso}-a.svg`)));
      assert.equal(JSON.parse(readFileSync(archivo, 'utf8')).version, 1, 'leer no convierte el archivo');

      // Una modificación lo convierte a v2 y deja la copia de la v1; se deshace para comparar.
      const nombre = JSON.parse(readFileSync(v1, 'utf8')).nombre;
      const r1 = spawnSync(process.execPath, [CLI, 'aplicar', archivo, '--ops', '-'], { input: JSON.stringify([{ op: 'renombrar', nombre: 'Otro' }]), encoding: 'utf8' });
      assert.ok(r1.status === 0 || r1.status === 1, r1.stderr);
      assert.match(r1.stdout, /convertido al formato v2/);
      const copia = join(dir, `${caso}.v1.espacio.json`);
      assert.ok(existsSync(copia), 'copia de la v1');
      assert.deepEqual(readFileSync(copia), readFileSync(v1), 'la copia es el original byte a byte');
      const r2 = spawnSync(process.execPath, [CLI, 'aplicar', archivo, '--ops', '-'], { input: JSON.stringify([{ op: 'renombrar', nombre }]), encoding: 'utf8' });
      assert.ok(r2.status === 0 || r2.status === 1, r2.stderr);
      assert.doesNotMatch(r2.stdout, /convertido/, 'un archivo ya v2 no se vuelve a convertir');
      const v2 = JSON.parse(readFileSync(archivo, 'utf8'));
      assert.equal(v2.version, 2);
      comparar(caso, salidas(archivo, join(dir, `${caso}-b.svg`)));
    });
  }
});
