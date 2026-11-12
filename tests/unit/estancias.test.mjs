// R2-2: varias estancias por planta desde los lotes y el CLI (agregar, quitar, contorno, renombrar),
// conexiones en el resumen y el resto de D4 (mover contra el muro de una estancia de otra planta).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(RAIZ, 'dist', 'Espacios3D', 'espacios3d.mjs');
const dir = mkdtempSync(join(tmpdir(), 'espacios3d-estancias-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
const ids = (e) => N.planta(e).estancias.map((s) => s.id);

describe('estancias en lotes', () => {
  const base = () => N.nuevoEspacio({ ancho: 800, largo: 100 });
  test('agregar por rectángulo o por contorno, sin solapes', () => {
    const r = N.ejecutarLote(base(), [
      { op: 'estancia-agregar', id: 'salon', nombre: 'Salón', x: 0, y: 110, ancho: 300, largo: 300 },
      { op: 'estancia-agregar', id: 'cocina', contorno: [[310, 110], [500, 110], [500, 410], [310, 410]], alto: 240 },
    ]).espacio;
    assert.deepEqual(ids(r), ['estancia', 'salon', 'cocina']);
    assert.equal(N.estancia(r, 'cocina').estancia.altura, 240);
    assert.throws(() => N.ejecutarLote(r, [{ op: 'estancia-agregar', id: 'x', x: 250, y: 300, ancho: 100, largo: 100 }]), /se solapan/);
    assert.throws(() => N.ejecutarLote(r, [{ op: 'estancia-agregar', id: 'x', x: 0, y: 500, ancho: 100 }]), /necesita «contorno» o «x», «y», «ancho» y «largo»/);
    assert.throws(() => N.ejecutarLote(r, [{ op: 'estancia-agregar', id: 'x', contorno: [[0, 0], [1, 1]] }]), /al menos 3 puntos/);
  });
  test('quitar: la última de la planta no; con muebles dentro, se dice cuáles quedan fuera', () => {
    assert.throws(() => N.ejecutarLote(base(), [{ op: 'estancia-quitar', id: 'estancia' }]), /única estancia/);
    const r = N.ejecutarLote(base(), [
      { op: 'estancia-agregar', id: 'salon', x: 0, y: 110, ancho: 300, largo: 300 },
      { op: 'agregar', tipo: 'caja', id: 'c', estancia: 'salon' },
      { op: 'estancia-quitar', id: 'salon' },
    ]);
    assert.deepEqual(ids(r.espacio), ['estancia']);
    assert.match(r.notas.at(-1), /c\) siguen en la planta/);
    assert.ok(N.analizar(r.espacio).some((i) => i.regla === 'fuera' && i.muebles.includes('c')));
  });
  test('cambiar el contorno y el nombre de una estancia concreta', () => {
    const r = N.ejecutarLote(base(), [
      { op: 'estancia-agregar', id: 'salon', x: 0, y: 110, ancho: 300, largo: 300 },
      { op: 'estancia-contorno', estancia: 'salon', contorno: '[[0,110],[300,110],[300,410],[0,410],[0,300]]' },
      { op: 'estancia', estancia: 'salon', nombre: 'Salón' },
    ]).espacio;
    const s = N.estancia(r, 'salon').estancia;
    assert.deepEqual([s.contorno.length, s.nombre], [5, 'Salón']);
    assert.equal(N.estancia(r, 'estancia').estancia.contorno.length, 4, 'la otra estancia no cambia');
  });
});

describe('D4 (resto): mover contra el muro de una estancia de otra planta', () => {
  test('se rechaza: mover no cambia de planta', () => {
    const e = N.validarOLanzar({
      formato: 'espacios3d',
      version: 2,
      plantas: [
        { id: 'pb', estancias: [{ id: 'cocina', contorno: [[0, 0], [400, 0], [400, 300], [0, 300]] }] },
        { id: 'p1', estancias: [{ id: 'dormitorio', contorno: [[0, 0], [400, 0], [400, 300], [0, 300]] }], muebles: [{ id: 'cama', ancho: 150, fondo: 200, alto: 50, x: 200, y: 150 }] },
      ],
    });
    assert.throws(() => N.ejecutarLote(e, [{ op: 'mover', id: 'cama', muro: 0, desde: 10, estancia: 'cocina' }]), /mover no cambia de planta/);
    assert.ok(N.ejecutarLote(e, [{ op: 'mover', id: 'cama', muro: 0, desde: 10, estancia: 'dormitorio' }]).espacio);
  });
});

describe('estancias desde el CLI', () => {
  test('estancia agregar|contorno|quitar, hueco por estancia y conexiones en el resumen', () => {
    const f = join(dir, 'piso.espacio.json');
    assert.equal(cli('nuevo', f, '--ancho', '800', '--largo', '100').status, 0);
    assert.equal(cli('estancia', 'agregar', f, '--id', 'salon', '--x', '0', '--y', '110', '--ancho', '300', '--largo', '300').status, 0);
    assert.equal(cli('estancia', 'agregar', f, '--id', 'cocina', '--contorno', '[[310,110],[500,110],[500,410],[310,410]]').status, 0);
    assert.equal(cli('hueco', 'agregar', f, '--estancia', 'salon', '--tipo', 'puerta', '--id', 'p-salon', '--muro', '0', '--desde', '100', '--ancho', '80').status, 0);
    assert.equal(cli('hueco', 'agregar', f, '--estancia', 'estancia', '--tipo', 'puerta', '--id', 'entrada', '--muro', '3', '--desde', '10', '--ancho', '80').status, 0);
    const r = JSON.parse(cli('resumen', f, '--json').stdout);
    assert.deepEqual(r.plantas[0].conexiones.map((c) => [c.hueco, c.de, c.a]), [['entrada', 'estancia', 'exterior'], ['p-salon', 'salon', 'estancia']]);
    assert.equal(cli('estancia', 'contorno', f, '--estancia', 'cocina', '--contorno', '[[310,110],[500,110],[500,300],[310,300]]').status, 0);
    assert.equal(cli('estancia', 'quitar', f, '--id', 'cocina').status, 0);
    assert.deepEqual(JSON.parse(cli('resumen', f, '--json').stdout).plantas[0].estancias.map((s) => s.id), ['estancia', 'salon']);
    // «estancia <archivo> --alto» sigue editando la estancia, y una suborden desconocida no se confunde con un archivo.
    assert.equal(cli('estancia', f, '--alto', '260').status, 0);
    assert.notEqual(cli('estancia', 'mover', f).status, 0);
  });
});
