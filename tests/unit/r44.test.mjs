// R4-4: plano acotado para imprimir o guardar en PDF: una hoja A4 apaisada por planta a escala normalizada.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'Espacios3D', 'espacios3d.mjs');
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const casa = (plantas) => N.validarOLanzar({
  formato: 'espacios3d', version: 2, nombre: 'Casa <de prueba>',
  plantas: plantas.map(([ancho, largo], i) => ({ id: `p${i}`, nombre: `Planta ${i}`, nivel: 280 * i, estancias: [{ id: `s${i}`, contorno: rect(0, 0, ancho, largo), altura: 250, huecos: [] }], muebles: [] })),
});

describe('escala normalizada', () => {
  test('la mayor que cabe en la hoja (273 × 160 mm de dibujo)', () => {
    assert.equal(N.escalaPara(400, 300), 20, '400 cm a 1:20 son 200 mm');
    assert.equal(N.escalaPara(600, 300), 25, '600 cm a 1:20 serían 300 mm: no cabe; a 1:25, 240');
    assert.equal(N.escalaPara(1200, 900), 75, '900 cm de alto a 1:50 serían 180 mm');
    assert.equal(N.escalaPara(2400, 1500), 100);
  });
});

describe('HTML imprimible', () => {
  test('una hoja por planta, el SVG en mm a su escala, barra de 1 m y nada de fuera', () => {
    const e = casa([[400, 300], [1200, 800]]);
    const { html, hojas } = N.planoImprimible(e, { fecha: '2026-11-12' });
    assert.equal(hojas.length, 2);
    assert.equal((html.match(/<section class="hoja">/g) ?? []).length, 2);
    for (const h of hojas) {
      // El dibujo (con 40 cm de margen alrededor de los muros) a 1:N.
      assert.ok(h.anchoMm <= 273 && h.altoMm <= 160, JSON.stringify(h));
      assert.ok(html.includes(`width="${h.anchoMm}mm" height="${h.altoMm}mm"`), `SVG en mm de ${h.planta}`);
      assert.ok(html.includes(`Escala 1:${h.escala}`));
      assert.ok(html.includes(`style="width:${Math.round((1000 / h.escala) * 100) / 100}mm"`), 'barra de 1 m a escala');
    }
    const svgP0 = N.planoSVG(e, { planta: 'p0', fuente: (N.LETRA_MM * hojas[0].escala) / 10, cotasALoLargo: true });
    const vb = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svgP0);
    assert.ok(Math.abs(hojas[0].anchoMm - (Number(vb[1]) * 10) / hojas[0].escala) < 0.06, 'ancho en mm = ancho en cm × 10 / N');
    assert.match(html, /@page \{ size: A4 landscape/);
    assert.match(html, /Casa &lt;de prueba&gt;/, 'el nombre va escapado');
    assert.match(html, /2026-11-12/);
    assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/, 'sin recursos de fuera');
  });

  test('CLI: plano --imprimible escribe el HTML', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e3d-impr-'));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const f = join(dir, 'casa.espacio.json');
    writeFileSync(f, JSON.stringify(casa([[400, 300]])));
    const salida = join(dir, 'plano.html');
    const r = spawnSync(process.execPath, [CLI, 'plano', f, '--imprimible', salida, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).hojas.map((h) => h.escala), [25], 'con muros y margen el dibujo mide 500 × 400 cm');
    assert.match(readFileSync(salida, 'utf8'), /Imprimir o guardar en PDF/);
    // Revisión independiente (10): --planta se respeta.
    writeFileSync(f, JSON.stringify(casa([[400, 300], [500, 300]])));
    const una = spawnSync(process.execPath, [CLI, 'plano', f, '--imprimible', salida, '--planta', 'p1', '--json'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(una.stdout).hojas.map((h) => h.planta), ['p1'], una.stdout + una.stderr);
    const mal = spawnSync(process.execPath, [CLI, 'plano', f, '--imprimible', f], { encoding: 'utf8' });
    assert.equal(mal.status, 3);
  });
});

describe('revisión independiente: rendimiento y SVG de siempre', () => {
  test('9: el SVG por defecto de una planta ancha conserva el margen de 40 cm', () => {
    const e = casa([[800, 500]]);
    assert.match(N.planoSVG(e), /viewBox="-50 -50 900 600"/);
  });
  test('4: el imprimible de tres plantas grandes no repite el análisis por escala (menos de 1,5 s)', () => {
    const e0 = casa([[1600, 1200], [1600, 1200], [1600, 1200]]);
    // 48 muebles por planta, como en el caso medido en la revisión.
    for (const p of e0.plantas) p.estancias[0].huecos.push({ id: `puerta-${p.id}`, tipo: 'puerta', muro: 0, desde: 700, ancho: 90, alto: 210 });
    for (const p of e0.plantas) for (let k = 0; k < 48; k++) p.muebles.push({ id: `${p.id}-m${k}`, tipo: 'caja', x: 100 + (k % 8) * 180, y: 100 + Math.floor(k / 8) * 180, ancho: 60, fondo: 60, alto: 80 });
    const e = N.validarOLanzar(e0);
    const t = performance.now();
    N.planoImprimible(e);
    assert.ok(performance.now() - t < 1500, `${Math.round(performance.now() - t)} ms`);
  });
});
