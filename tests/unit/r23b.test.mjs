// Regresiones de la verificación de R2-2 (R1, R2) y de la revisión de la parte del CLI de R2-3 (C1–C8).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';
import { Lienzo } from '../../build/lienzo.mjs';
import { codificarPNG, decodificarPNG } from '../../build/png.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(RAIZ, 'dist', 'Espacios3D', 'espacios3d.mjs');
const dir = mkdtempSync(join(tmpdir(), 'espacios3d-r23b-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const unaPlanta = (estancias, muebles = []) => N.validarOLanzar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', grosorExterior: 10, estancias, muebles }] });
const png = (ancho, alto) => {
  const l = new Lienzo(ancho, alto, '#ffffff');
  return codificarPNG(l.rgba, l.ancho, l.alto);
};
/** Carpeta con un espacio y, si se pide, una imagen en planos/. */
function carpeta(nombreImagen, bytes) {
  const c = mkdtempSync(join(dir, 'c-'));
  const f = join(c, 'casa.espacio.json');
  cli('nuevo', f, '--ancho', '400', '--largo', '300');
  if (nombreImagen) {
    mkdirSync(join(c, 'planos'));
    writeFileSync(join(c, 'planos', nombreImagen), bytes);
  }
  return { c, f };
}

describe('R1 y R2: grosor de los huecos', () => {
  test('R1: un paso entre dos estancias que se tocan (tabique 0) conecta y se analiza el otro lado', () => {
    const e = unaPlanta(
      [{ id: 'a', contorno: rect(0, 0, 300, 300), huecos: [{ id: 'p', tipo: 'paso', muro: 1, desde: 100, ancho: 80 }] }, { id: 'b', contorno: rect(300, 0, 600, 300) }],
      [{ id: 'caja', tipo: 'caja', ancho: 40, fondo: 40, alto: 80, x: 325, y: 140 }],
    );
    assert.deepEqual(N.modeloPlanta(N.planta(e)).conexiones.map((c) => [c.de, c.a]), [['a', 'b']]);
    assert.ok(N.analizar(e).some((i) => i.regla === 'paso' && i.muebles.includes('caja')));
  });
  test('R2: ventana frente a un tabique de 20 cm donde la mayoría de los rayos caen en el tabique', () => {
    const e = unaPlanta([
      { id: 'pasillo', contorno: rect(0, 0, 800, 100), huecos: [{ id: 'v', tipo: 'ventana', muro: 2, desde: 470, ancho: 40 }] },
      { id: 'salon', contorno: rect(0, 110, 300, 410) },
      { id: 'cocina', contorno: rect(320, 110, 600, 410) },
    ]);
    const h = N.modeloPlanta(N.planta(e)).huecos[0];
    assert.ok(h.profundidadA <= 40 && h.profundidadB <= 40 && h.dudoso, JSON.stringify([h.profundidadA, h.profundidadB, h.dudoso]));
  });
});

describe('C1–C8: CLI de fondos y plano --png', () => {
  test('C1: --escala en fondo poner y fondo editar (cm por píxel)', () => {
    const { c, f } = carpeta('p.png', png(40, 30));
    assert.equal(cli('fondo', 'poner', f, '--imagen', join(c, 'planos', 'p.png'), '--escala', '0.5').status, 0);
    assert.equal(cli('fondo', 'editar', f, '--id', 'plano', '--escala', '2').status, 0);
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).plantas[0].fondos[0].escala, 2);
  });
  test('C2: con --sobre-fondo el lienzo abarca el fondo entero', () => {
    const { c, f } = carpeta('grande.png', png(1200, 900));
    cli('fondo', 'poner', f, '--imagen', 'planos/grande.png');
    const r = JSON.parse(cli('plano', f, '--png', join(c, 'o.png'), '--sobre-fondo', '--json').stdout);
    assert.ok(r.origen[0] <= 0 && r.origen[1] <= 0 && r.origen[0] + r.ancho / r.pxPorCm >= 1200 && r.origen[1] + r.alto / r.pxPorCm >= 900, JSON.stringify(r));
  });
  test('C3: la rejilla se ve dentro de la casa', () => {
    const { c, f } = carpeta();
    const salida = join(c, 'r.png');
    const r = JSON.parse(cli('plano', f, '--png', salida, '--rejilla', '--px-por-cm', '1', '--json').stdout);
    const img = decodificarPNG(readFileSync(salida));
    const y = Math.floor(150 - r.origen[1]);
    const colores = [-1, 0, 1].map((d) => {
      const x = Math.floor(100 - r.origen[0]) + d;
      const i = (y * img.ancho + x) * 4;
      return [...img.rgba.subarray(i, i + 3)].map((v) => v.toString(16).padStart(2, '0')).join('');
    });
    assert.ok(colores.includes('d9d1c4'), `línea de la rejilla en x = 100 sobre el suelo: ${colores}`);
  });
  test('C4 y C8: JPEG con orientación EXIF 6 y con bytes de relleno', () => {
    // SOI, APP1 «Exif» (II, IFD0 con Orientation = 6), relleno FF FF y SOF0 de 900 de alto por 1200 de ancho.
    const exif = Buffer.concat([Buffer.from('Exif\0\0II', 'latin1'), Buffer.from([0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0])]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]);
    const sof = Buffer.from([0xff, 0xff, 0xff, 0xc0, 0, 11, 8, 0x03, 0x84, 0x04, 0xb0, 1, 1, 0x11, 0]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xd9])]);
    const { c, f } = carpeta('foto.jpg', jpeg);
    const r = cli('fondo', 'poner', f, '--imagen', join(c, 'planos', 'foto.jpg'));
    assert.equal(r.status, 0, r.stderr);
    const fondo = JSON.parse(readFileSync(f, 'utf8')).plantas[0].fondos[0];
    assert.deepEqual([fondo.anchoPx, fondo.altoPx], [900, 1200], 'girada 90°: se ve de 900 x 1200');
  });
  test('C5: el archivo se anota con las mayúsculas reales del disco', { skip: process.platform !== 'win32' && process.platform !== 'darwin' ? 'sólo en sistemas que no distinguen mayúsculas' : false }, () => {
    const { c, f } = carpeta('Mayus.PNG', png(10, 10));
    assert.equal(cli('fondo', 'poner', f, '--imagen', join(c, 'planos', 'MAYUS.png')).status, 0);
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).plantas[0].fondos[0].archivo, 'planos/Mayus.PNG');
  });
  test('C6: --png no puede escribir encima de la imagen de un fondo', () => {
    const { c, f } = carpeta('p.png', png(40, 30));
    cli('fondo', 'poner', f, '--imagen', join(c, 'planos', 'p.png'));
    assert.match(cli('plano', f, '--png', join(c, 'planos', 'p.png'), '--sobre-fondo').stderr, /imagen del fondo/);
  });
  test('C7: describir --planta sólo da las incidencias de esa planta', () => {
    const e = N.validarOLanzar({
      formato: 'espacios3d',
      version: 2,
      plantas: [
        { id: 'pb', estancias: [{ id: 'a', contorno: rect(0, 0, 100, 100) }], muebles: [{ id: 'fuera', ancho: 50, fondo: 50, alto: 50, x: 500, y: 500 }] },
        { id: 'p1', nivel: 280, estancias: [{ id: 'b', contorno: rect(0, 0, 100, 100) }] },
      ],
    });
    assert.equal(N.describir(e, 'p1').incidencias.length, 0);
    assert.ok(N.describir(e).incidencias.length > 0);
  });
  test('tope de tamaño: un PNG de más de 4096 px por lado se rechaza con un error claro', () => {
    const c = mkdtempSync(join(dir, 'g-'));
    const f = join(c, 'grande.espacio.json');
    cli('nuevo', f, '--ancho', '3000', '--largo', '2000');
    assert.match(cli('plano', f, '--png', join(c, 'g.png'), '--px-por-cm', '10').stderr, /máximo 4096/);
  });
  test('--imagen también vale relativa a la carpeta del .espacio.json', () => {
    const { f } = carpeta('rel.png', png(20, 20));
    assert.equal(cli('fondo', 'poner', f, '--imagen', 'planos/rel.png').status, 0);
  });
});
