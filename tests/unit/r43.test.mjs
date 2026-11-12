// R4-3: fotos de estancias y muebles: formato, operaciones, describir y CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(RAIZ, 'dist', 'Espacios3D', 'espacios3d.mjs');
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const base = (extra = {}) => ({
  formato: 'espacios3d', version: 2, nombre: 'Con fotos',
  plantas: [{ id: 'pb', nivel: 0, estancias: [{ id: 'cuarto', contorno: rect(0, 0, 400, 300), altura: 250, huecos: [], ...(extra.estancia ?? {}) }],
    muebles: [{ id: 'cama', tipo: 'cama', ancho: 150, fondo: 200, alto: 50, x: 200, y: 150, ...(extra.mueble ?? {}) }] }],
});

describe('fotos en el formato', () => {
  test('rutas relativas de imágenes, sin repetir', () => {
    const e = N.validarOLanzar(base({ estancia: { fotos: ['fotos/cuarto.jpg'] }, mueble: { fotos: ['fotos/cama.webp', 'fotos/cama-2.PNG'] } }));
    assert.deepEqual(e.plantas[0].estancias[0].fotos, ['fotos/cuarto.jpg']);
    assert.deepEqual(e.plantas[0].muebles[0].fotos, ['fotos/cama.webp', 'fotos/cama-2.PNG']);
    const err = (extra) => N.validar(base(extra)).errores.join(' | ');
    assert.match(err({ mueble: { fotos: ['../fuera.jpg'] } }), /fotos\[0\]/);
    assert.match(err({ mueble: { fotos: ['C:/fotos/cama.jpg'] } }), /relativa/);
    assert.match(err({ mueble: { fotos: ['fotos/cama.gif'] } }), /\.jpg, \.jpeg, \.png o \.webp/);
    assert.match(err({ estancia: { fotos: ['a.jpg', 'a.jpg'] } }), /repetida/);
    assert.match(err({ estancia: { fotos: 'a.jpg' } }), /lista/);
    assert.equal(N.validarOLanzar(base({ mueble: { fotos: [] } })).plantas[0].muebles[0].fotos, undefined, 'una lista vacía no deja campo');
  });

  test('operaciones: agregar (sin duplicar), quitar y errores', () => {
    let e = N.validarOLanzar(base());
    e = N.ejecutarLote(e, [{ op: 'foto-agregar', para: 'cama', foto: 'fotos/cama.jpg' }, { op: 'foto-agregar', para: 'cama', foto: 'fotos/cama.jpg' }, { op: 'foto-agregar', para: 'cuarto', foto: 'fotos/cuarto.png' }]).espacio;
    assert.deepEqual(e.plantas[0].muebles[0].fotos, ['fotos/cama.jpg']);
    assert.deepEqual(e.plantas[0].estancias[0].fotos, ['fotos/cuarto.png']);
    assert.deepEqual(N.fotosDe(e).sort(), ['fotos/cama.jpg', 'fotos/cuarto.png']);
    assert.deepEqual(N.describir(e).plantas[0].muebles[0].fotos, ['fotos/cama.jpg']);
    assert.deepEqual(N.describir(e).plantas[0].estancias[0].fotos, ['fotos/cuarto.png']);
    e = N.ejecutarLote(e, [{ op: 'foto-quitar', para: 'cama', foto: 'fotos/cama.jpg' }]).espacio;
    assert.equal(e.plantas[0].muebles[0].fotos, undefined);
    assert.throws(() => N.ejecutarLote(e, [{ op: 'foto-agregar', para: 'nadie', foto: 'fotos/x.jpg' }]), /ninguna estancia ni mueble con id «nadie»/);
    assert.throws(() => N.ejecutarLote(e, [{ op: 'foto-agregar', para: 'cama', foto: 'fotos/x.bmp' }]), /\.webp/);
    assert.throws(() => N.ejecutarLote(e, [{ op: 'foto-quitar', para: 'cama', foto: 'fotos/x.jpg' }]), /no tiene la foto/);
  });
});

describe('fotos por el CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e3d-fotos-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const f = join(dir, 'cuarto.espacio.json');
  writeFileSync(f, JSON.stringify(base()));
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

  test('agregar exige que la foto exista; con ella, se asocia; quitar', () => {
    let r = cli('foto', 'agregar', f, '--para', 'cama', '--foto', 'fotos/cama.jpg');
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /No existe fotos\/cama\.jpg/);
    mkdirSync(join(dir, 'fotos'));
    writeFileSync(join(dir, 'fotos', 'cama.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    r = cli('foto', 'agregar', f, '--para', 'cama', '--foto', 'fotos/cama.jpg');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')).plantas[0].muebles[0].fotos, ['fotos/cama.jpg']);
    r = cli('foto', 'quitar', f, '--para', 'cama', '--foto', 'fotos/cama.jpg');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).plantas[0].muebles[0].fotos, undefined);
  });

  test('un lote con una foto que no está la asocia y avisa', () => {
    const ops = join(dir, 'ops.json');
    writeFileSync(ops, JSON.stringify([{ op: 'foto-agregar', para: 'cuarto', foto: 'fotos/no-esta.jpg' }]));
    const r = cli('aplicar', f, '--ops', ops);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /aviso: no existe fotos\/no-esta\.jpg/);
  });
});
