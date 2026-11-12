// R2-7, paso d: exportación para juegos. Umbrales en el suelo, colisiones con los nombres de cada
// motor (Godot, Unreal, genérico), rampas en las escaleras y escena.json.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';

const validador = createRequire(import.meta.url)('gltf-validator');
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(RAIZ, 'dist', 'Espacios3D', 'espacios3d.mjs');
const dir = mkdtempSync(join(tmpdir(), 'espacios3d-r27d-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

const casa = () =>
  N.validarOLanzar({
    formato: 'espacios3d', version: 2, nombre: 'Casa',
    plantas: [
      { id: 'pb', nivel: 0, grosorExterior: 15, estancias: [
        { id: 'salon', contorno: rect(0, 0, 400, 460), altura: 260, huecos: [{ id: 'pta', tipo: 'puerta', muro: 1, desde: 100, ancho: 80 }, { id: 'v1', tipo: 'ventana', muro: 0, desde: 100, ancho: 120 }],
          elementos: [{ id: 'col', forma: 'exento', x: 200, y: 400, ancho: 30, redondo: true }] },
        { id: 'cocina', contorno: rect(410, 0, 700, 460), altura: 260 },
      ], muebles: [{ id: 'sofa', tipo: 'sofa', ancho: 200, fondo: 90, alto: 85, x: 150, y: 200 }],
      escaleras: [{ id: 'esc', forma: 'L', x: 600, y: 60, ancho: 90, tramos: [250, 120], gira: 'derecha', hasta: 'p1' }] },
      { id: 'p1', nivel: 290, grosorExterior: 15, estancias: [{ id: 'arriba', contorno: rect(0, 0, 700, 460), altura: 250 }] },
    ],
  });

function leer(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
}

describe('exportación para juegos', () => {
  test('umbral de suelo en las puertas (no queda rendija) y sin colisiones por defecto', () => {
    const json = leer(N.espacioAGLB(casa()));
    const nombres = json.nodes.map((n) => n.name);
    assert.ok(nombres.includes('umbral-pta'));
    assert.ok(!nombres.some((n) => n.endsWith('-colonly') || n.startsWith('COL_') || n.startsWith('UCX_')));
  });

  for (const modo of ['godot', 'unreal', 'generico']) {
    test(`colisiones ${modo}: glTF válido y nombres de ese motor`, async () => {
      const bytes = N.espacioAGLB(casa(), 'prueba', { colisiones: modo });
      const informe = await validador.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
      assert.equal(informe.issues.numErrors, 0, JSON.stringify(informe.issues.messages.slice(0, 3)));
      const col = leer(bytes).nodes.filter((n) => n.extras?.colision);
      const nombres = col.map((n) => n.name);
      if (modo === 'godot') {
        assert.ok(nombres.includes('suelo-salon-colonly') && nombres.includes('sofa-convcolonly') && nombres.includes('ventana-v1-convcolonly'));
        assert.ok(nombres.includes('escalera-esc-rampa-1-convcolonly') && nombres.includes('escalera-esc-rampa-3-convcolonly'), 'dos tramos y la meseta');
        assert.ok(nombres.some((n) => /^hueco-esc-barandilla-\d+-convcolonly$/.test(n)));
      } else if (modo === 'unreal') {
        assert.ok(nombres.includes('UBX_sofa_00') && nombres.includes('UCX_escalera-esc_00') && nombres.includes('UCX_col_00'));
        assert.ok(!nombres.some((n) => n.startsWith('UCX_muros-') && !n.includes('_0')), nombres.join());
        assert.ok(!col.some((n) => n.extras.forma === 'concava'), 'muros y suelos: colisión compleja de la malla');
      } else {
        assert.ok(nombres.every((n) => n.startsWith('COL_')) && nombres.includes('COL_umbral-pta'));
      }
    });
  }

  test('rampas: suben de 0 a la meseta y de la meseta a la planta de arriba', () => {
    const e = casa();
    const pb = N.planta(e, 'pb');
    const geo = N.geometriaEscalera(pb.escaleras[0], 290);
    const r = N.rampasEscalera(geo);
    assert.equal(r.length, 3);
    assert.deepEqual([Math.min(...r[0].alturas), Math.max(...r[0].alturas)], [0, geo.meseta.z]);
    assert.ok(Math.abs(Math.max(...r[1].alturas) - 290) < 1e-6);
    assert.ok(r[2].alturas.every((z) => z === geo.meseta.z));
  });

  test('CLI: --colisiones y --escena', () => {
    const f = join(dir, 'casa.espacio.json');
    writeFileSync(f, N.aJSON(casa()));
    let r = spawnSync(process.execPath, [CLI, 'exportar', f, '--glb', join(dir, 'casa.glb'), '--colisiones', 'godot', '--escena', join(dir, 'escena.json'), '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const escena = JSON.parse(readFileSync(join(dir, 'escena.json'), 'utf8'));
    assert.equal(escena.plantas[0].escaleras[0].id, 'esc');
    assert.ok(escena.plantas[0].conexiones.length >= 1);
    r = spawnSync(process.execPath, [CLI, 'exportar', f, '--glb', join(dir, 'x.glb'), '--colisiones', 'roblox'], { encoding: 'utf8' });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /godot, unreal, generico/);
  });
});

// Revisión independiente de R2-7d (12/11/2026): volúmenes y áreas de las colisiones frente a las medidas.
describe('revisión independiente: colisiones que cuadran con lo visible', () => {
  /** Área (m²) de las caras de una malla que miran hacia arriba. */
  const areaArriba = (g) => {
    let a = 0;
    for (let t = 0; t < g.indices.length; t += 3) {
      const [p, q, r] = [0, 1, 2].map((k) => [0, 1, 2].map((c) => g.posiciones[g.indices[t + k] * 3 + c]));
      const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n);
      if (l > 0 && Math.abs(n[1]) / l > 0.99 && p[1] > -0.001) a += l / 2;
    }
    return a;
  };
  test('1: el suelo de colisión de arriba tiene el hueco de la escalera (godot y genérico)', () => {
    const e = casa();
    const p1 = e.plantas[1];
    const visible = N.areaTotal(N.sueloConHuecos(p1.estancias[0].contorno, N.huecosDePlanta(e, 'p1'))) / 1e4;
    assert.ok(visible < 7 * 4.6 - 1, 'hay hueco');
    for (const modo of ['godot', 'generico']) {
      const suelos = N.nodosColision(e, p1, modo, 0).filter((n) => /suelo-arriba/.test(n.nombre));
      const area = suelos.reduce((s, n) => s + areaArriba(n.malla.primitivas[0]), 0);
      assert.ok(Math.abs(area - visible) < 0.01, `${modo}: ${area.toFixed(3)} m² frente a ${visible.toFixed(3)}`);
    }
  });
  test('2: la caja del sofá mide lo que el sofá', () => {
    const e = casa();
    const sofa = N.nodosColision(e, e.plantas[0], 'godot', 0).find((n) => /^sofa/.test(n.nombre));
    const pos = sofa.malla.primitivas[0].posiciones;
    const medida = (c) => { let lo = Infinity; let hi = -Infinity; for (let i = c; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); } return Math.round((hi - lo) * 1000) / 1000; };
    assert.deepEqual([medida(0), medida(1), medida(2)], [2, 0.85, 0.9], 'ancho, alto y fondo del sofá (m)');
    assert.deepEqual(sofa.traslacion, [1.5, 0, 2], 'en su sitio');
  });
  test('4: la barandilla del hueco va en un panel por lado, no en trozos de 20 cm', () => {
    const e = casa();
    const n = N.nodosColision(e, e.plantas[1], 'godot', 0).filter((x) => /^hueco-esc-barandilla/.test(x.nombre)).length;
    assert.ok(n >= 1 && n <= 8, `${n} paneles`);
  });
});
