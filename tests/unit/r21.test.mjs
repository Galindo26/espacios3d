// Regresiones de la revisión independiente de R2-1 (D1–D5): copia .v1 veraz, bisagra al reanclar,
// solape de estancias, estancia/planta en agregar y mover, ids renombrados en la migración.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(RAIZ, 'dist', 'Espacios3D', 'espacios3d.mjs');
const dir = mkdtempSync(join(tmpdir(), 'espacios3d-r21-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const E = (e) => N.estancia(e).estancia;
const renombrar = (archivo, nombre) =>
  spawnSync(process.execPath, [CLI, 'aplicar', archivo, '--ops', '-'], { input: JSON.stringify([{ op: 'renombrar', nombre }]), encoding: 'utf8' });
const v1 = (nombre) =>
  `${JSON.stringify({ formato: 'espacios3d', version: 1, nombre, estancia: { contorno: [[0, 0], [300, 0], [300, 300], [0, 300]] } })}\n`;

describe('D1: la copia de la versión 1 es veraz y no se pisa', () => {
  test('dos archivos v1 con el mismo nombre base no comparten copia', () => {
    const a = join(dir, 'sala.json');
    const b = join(dir, 'sala.espacio.json');
    writeFileSync(a, v1('A'));
    writeFileSync(b, v1('B'));
    assert.match(renombrar(a, 'A2').stdout, /copia de la versión 1 en .*sala\.v1\.espacio\.json/);
    const r = renombrar(b, 'B2');
    assert.match(r.stdout, /sala\.v1-2\.espacio\.json/);
    assert.equal(readFileSync(join(dir, 'sala.v1.espacio.json'), 'utf8'), v1('A'));
    assert.equal(readFileSync(join(dir, 'sala.v1-2.espacio.json'), 'utf8'), v1('B'));
  });

  test('restaurar otro v1 encima y volver a cambiarlo guarda ese original; el mismo original no se duplica', () => {
    const f = join(dir, 'cuarto.espacio.json');
    writeFileSync(f, v1('Primero'));
    renombrar(f, 'x');
    writeFileSync(f, v1('Segundo'));
    assert.match(renombrar(f, 'y').stdout, /cuarto\.v1-2\.espacio\.json/);
    assert.equal(readFileSync(join(dir, 'cuarto.v1-2.espacio.json'), 'utf8'), v1('Segundo'));
    writeFileSync(f, v1('Primero'));
    assert.match(renombrar(f, 'z').stdout, /ya estaba en .*cuarto\.v1\.espacio\.json/);
    assert.ok(!existsSync(join(dir, 'cuarto.v1-3.espacio.json')));
  });
});

describe('D2: reanclar en una pared recorrida al revés conserva la bisagra en su sitio', () => {
  const sala = () =>
    N.validarOLanzar({
      formato: 'espacios3d',
      version: 1,
      estancia: { contorno: [[0, 0], [400, 0], [400, 300], [0, 300]], huecos: [{ id: 'p', tipo: 'puerta', muro: 3, desde: 40, ancho: 80, bisagra: 'inicio' }] },
    });
  const bisagra = (e) => {
    const g = N.geometriaHueco(E(e).contorno, E(e).huecos[0]);
    return N.barridoPuerta(g)[0];
  };
  test('la bisagra queda en el mismo punto y el barrido no cambia', () => {
    const antes = sala();
    const despues = N.cambiarContorno(antes, [[0, 0], [0, 300], [400, 300], [400, 0], [200, 0]]);
    assert.equal(E(despues).huecos[0].bisagra, 'fin');
    assert.deepEqual(bisagra(despues), bisagra(antes));
  });
  test('un ancla de punto en una esquina se queda en la pared con su misma dirección', () => {
    const viejo = [[0, 0], [400, 0], [400, 300], [0, 300]];
    const nuevo = [[0, 0], [200, 0], [400, 0], [400, 300], [0, 300]];
    assert.deepEqual(N.reanclar(viejo, nuevo, [{ muro: 1, desde: 0 }], () => 'x'), [{ muro: 2, desde: 0 }]);
  });
});

describe('D3: estancias que se solapan aunque sus aristas sólo se toquen', () => {
  const dos = (b) => ({
    formato: 'espacios3d',
    version: 2,
    plantas: [{ id: 'pb', estancias: [{ id: 'a', contorno: [[0, 0], [400, 0], [400, 300], [0, 300]] }, { id: 'b', contorno: b }] }],
  });
  test('50 cm de solape con la misma profundidad se rechaza', () => {
    assert.match(N.validar(dos([[350, 0], [700, 0], [700, 300], [350, 300]])).errores.join(), /se solapan/);
  });
  test('estancias contiguas (comparten pared) y una dentro de otra', () => {
    assert.ok(N.validar(dos([[400, 0], [700, 0], [700, 300], [400, 300]])).ok, 'contiguas');
    assert.match(N.validar(dos([[100, 100], [200, 100], [200, 200], [100, 200]])).errores.join(), /se solapan/);
  });
});

describe('D4: estancia y planta en agregar y mover', () => {
  const casa = () =>
    N.validarOLanzar({
      formato: 'espacios3d',
      version: 2,
      plantas: [
        { id: 'pb', estancias: [{ id: 'salon', contorno: [[0, 0], [400, 0], [400, 300], [0, 300]] }, { id: 'cocina', contorno: [[410, 0], [700, 0], [700, 300], [410, 300]] }] },
        { id: 'p1', nivel: 280, estancias: [{ id: 'dormitorio', contorno: [[0, 0], [400, 0], [400, 300], [0, 300]] }] },
      ],
    });
  test('sin posición, el mueble va al centro de la estancia indicada y a su planta', () => {
    const r = N.ejecutarLote(casa(), [{ op: 'agregar', tipo: 'caja', id: 'c', estancia: 'cocina' }]);
    const b = N.buscarMueble(r.espacio, 'c');
    assert.deepEqual([b.planta.id, b.mueble.x, b.mueble.y], ['pb', 555, 150]);
  });
  test('una estancia de otra planta es un error, no un mueble mal puesto', () => {
    assert.throws(() => N.ejecutarLote(casa(), [{ op: 'agregar', tipo: 'caja', planta: 'p1', estancia: 'cocina', muro: 0, desde: 10 }]), /es de la planta «pb», no de «p1»/);
  });
  test('mover con «estancia» y coordenadas se rechaza en vez de ignorarla', () => {
    const e = N.ejecutarLote(casa(), [{ op: 'agregar', tipo: 'caja', id: 'c', estancia: 'cocina' }]).espacio;
    assert.throws(() => N.ejecutarLote(e, [{ op: 'mover', id: 'c', x: 10, y: 10, estancia: 'salon' }]), /«estancia» va con «muro»/);
  });
});

describe('D5: ids renombrados al convertir la v1', () => {
  test('el id nuevo no pasa de 64 caracteres y se avisa del cambio', () => {
    const id = 'x'.repeat(60);
    const r = N.validar({
      formato: 'espacios3d',
      version: 1,
      estancia: { contorno: [[0, 0], [400, 0], [400, 300], [0, 300]], huecos: [{ id, tipo: 'paso', muro: 0, desde: 10, ancho: 80 }] },
      muebles: [{ id, ancho: 50, fondo: 50, alto: 50, x: 100, y: 100 }],
    });
    assert.ok(r.ok, JSON.stringify(r));
    const nuevo = E(r.espacio).huecos[0].id;
    assert.ok(nuevo.length <= 64 && nuevo !== id, nuevo);
    assert.ok(N.validar(JSON.parse(N.aJSON(r.espacio))).ok, 'el resultado se vuelve a leer');
    assert.match(r.avisos.join(), /se renombra a/);
  });
});
