// R2-3 (CLI): plano como imagen PNG con píxeles en puntos conocidos, `describir` y `exportar --glb`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';
import { decodificarPNG } from '../../build/png.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(RAIZ, 'dist', 'Espacios3D', 'espacios3d.mjs');
const dir = mkdtempSync(join(tmpdir(), 'espacios3d-r23-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function piso() {
  return {
    formato: 'espacios3d',
    version: 2,
    nombre: 'Piso',
    plantas: [
      {
        id: 'pb',
        grosorExterior: 10,
        estancias: [
          { id: 'pasillo', contorno: rect(0, 0, 800, 100), huecos: [{ id: 'entrada', tipo: 'puerta', muro: 3, desde: 10, ancho: 80 }] },
          { id: 'salon', contorno: rect(0, 110, 300, 410), huecos: [{ id: 'p-salon', tipo: 'puerta', muro: 0, desde: 100, ancho: 80 }] },
        ],
        muebles: [
          { id: 'sofa', tipo: 'sofa', ancho: 200, fondo: 90, alto: 85, x: 150, y: 365, giro: 180, color: '#4a7a4a' },
          { id: 'mesa', tipo: 'mesa', ancho: 80, fondo: 80, alto: 75, x: 150, y: 250 },
        ],
      },
    ],
  };
}

describe('plano --png', () => {
  test('píxeles en puntos conocidos: muro, suelo, mueble y fuera, con la transformación que devuelve', () => {
    const f = join(dir, 'piso.espacio.json');
    writeFileSync(f, JSON.stringify(piso()));
    const png = join(dir, 'piso.png');
    const r = cli('plano', f, '--png', png, '--px-por-cm', '1', '--json');
    assert.equal(r.status, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    const img = decodificarPNG(readFileSync(png));
    assert.deepEqual([img.ancho, img.alto], [info.ancho, info.alto]);
    const color = ([x, y]) => {
      const i = (Math.floor((y - info.origen[1]) * info.pxPorCm) * img.ancho + Math.floor((x - info.origen[0]) * info.pxPorCm)) * 4;
      return '#' + [...img.rgba.subarray(i, i + 3)].map((v) => v.toString(16).padStart(2, '0')).join('');
    };
    assert.equal(color([400, -5]), '#3b4046', 'muro exterior de arriba');
    assert.equal(color([50, 105]), '#3b4046', 'tabique entre pasillo y salón');
    assert.equal(color([500, 50]), '#efe8dc', 'suelo del pasillo');
    assert.equal(color([600, 300]), '#fbfaf7', 'fuera de la casa');
    assert.equal(color([140, 105]), '#efe8dc', 'el hueco de la puerta del salón atraviesa el tabique');
    assert.notEqual(color([110, 350]), '#efe8dc', 'el sofá tapa el suelo');
  });
  test('opciones: --px-por-cm y --rejilla sólo con --png; planta inexistente; no sobre el propio archivo', () => {
    const f = join(dir, 'p2.espacio.json');
    writeFileSync(f, JSON.stringify(piso()));
    assert.match(cli('plano', f, '--px-por-cm', '2').stderr, /van con --png/);
    assert.notEqual(cli('plano', f, '--planta', 'nada').status, 0);
    assert.equal(cli('plano', f, '--planta', 'pb').status, 0);
    assert.match(cli('plano', f, '--png', f).stderr, /propio archivo/);
    assert.equal(cli('plano', f, '--png', join(dir, 'r.png'), '--rejilla').status, 0);
  });
});

describe('describir', () => {
  test('lados de los muros, conexiones, estancia de cada mueble, hacia dónde mira y a qué está pegado', () => {
    const d = N.describir(N.validarOLanzar(piso()));
    const p = d.plantas[0];
    const salon = p.estancias.find((s) => s.id === 'salon');
    assert.deepEqual(salon.muros.map((m) => m.lado), ['arriba', 'derecha', 'abajo', 'izquierda']);
    assert.deepEqual(salon.huecos.map((h) => [h.id, h.da_a]), [['p-salon', 'pasillo']]);
    assert.deepEqual(salon.muebles.sort(), ['mesa', 'sofa']);
    const sofa = p.muebles.find((m) => m.id === 'sofa');
    assert.deepEqual([sofa.estancia, sofa.mira], ['salon', 'arriba']);
    assert.deepEqual(sofa.pegadoA.map((x) => [x.muro, x.lado]), [[2, 'abajo']]);
    assert.deepEqual(p.conexiones.map((c) => [c.hueco, c.a]), [['entrada', 'exterior'], ['p-salon', 'pasillo']]);
    assert.ok(salon.sueloLibre_m2 < salon.area_m2);
  });
  test('desde el CLI, en JSON y en texto', () => {
    const f = join(dir, 'd.espacio.json');
    writeFileSync(f, JSON.stringify(piso()));
    const j = JSON.parse(cli('describir', f, '--json').stdout);
    assert.equal(j.plantas[0].estancias.length, 2);
    assert.match(cli('describir', f).stdout, /Mueble sofa .* mira arriba, pegado a muro 2 \(abajo\)/);
  });
});

describe('exportar --glb', () => {
  test('escribe un glTF binario válido desde el CLI', async () => {
    const f = join(dir, 'g.espacio.json');
    writeFileSync(f, JSON.stringify(piso()));
    const glb = join(dir, 'piso.glb');
    const r = cli('exportar', f, '--glb', glb, '--json');
    assert.equal(r.status, 0, r.stderr);
    const bytes = readFileSync(glb);
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'glTF');
    const validador = createRequire(import.meta.url)('gltf-validator');
    const informe = await validador.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
    assert.equal(informe.issues.numErrors, 0, JSON.stringify(informe.issues.messages.slice(0, 3)));
    assert.match(cli('exportar', f).stderr, /necesita --glb/);
  });
});

describe('fondos: poner, calibrar y comparar el calco', async () => {
  const { Lienzo } = await import('../../build/lienzo.mjs');
  const { codificarPNG } = await import('../../build/png.mjs');
  /** Plano sintético: una habitación de 300 x 225 cm dibujada a 2 px por cm, con la esquina en (100, 100) px. */
  function planoSintetico(ruta) {
    const l = new Lienzo(900, 700, '#ffffff');
    const negro = '#111111';
    for (const [a, b] of [[[100, 100], [700, 100]], [[700, 100], [700, 550]], [[700, 550], [100, 550]], [[100, 550], [100, 100]]]) l.linea(a, b, negro, 8);
    writeFileSync(ruta, codificarPNG(l.rgba, l.ancho, l.alto));
  }
  test('del píxel a los cm con error < 1 % tras calibrar con dos puntos; la imagen viaja con el archivo', () => {
    const carpeta = mkdtempSync(join(dir, 'calco-'));
    const f = join(carpeta, 'casa.espacio.json');
    assert.equal(cli('nuevo', f, '--ancho', '100', '--largo', '100').status, 0);
    const planos = join(carpeta, 'planos');
    mkdirSync(planos);
    planoSintetico(join(planos, 'piso.png'));
    const r = cli('fondo', 'poner', f, '--imagen', join(planos, 'piso.png'), '--id', 'plano');
    assert.equal(r.status, 0, r.stderr);
    const fondo = JSON.parse(readFileSync(f, 'utf8')).plantas[0].fondos[0];
    assert.deepEqual([fondo.archivo, fondo.anchoPx, fondo.altoPx], ['planos/piso.png', 900, 700]);
    assert.equal(cli('fondo', 'calibrar', f, '--id', 'plano', '--puntos', '100,100,700,100', '--distancia', '300', '--en', '0,0').status, 0);
    const e = N.validarOLanzar(JSON.parse(readFileSync(f, 'utf8')));
    const fc = N.buscarFondo(e, 'plano').fondo;
    const esquina = N.fondoAPlanta(fc, 700, 550);
    assert.ok(Math.abs(esquina[0] - 300) / 300 < 0.01 && Math.abs(esquina[1] - 225) / 225 < 0.01, `${esquina}`);
    // Calco: la estancia con las esquinas leídas del plano, y comparación sobre el fondo.
    const contorno = [[100, 100], [700, 100], [700, 550], [100, 550]].map(([x, y]) => N.fondoAPlanta(fc, x, y).map((v) => Math.round(v * 10) / 10));
    assert.equal(cli('estancia', 'contorno', f, '--contorno', JSON.stringify(contorno)).status, 0);
    const png = join(carpeta, 'calco.png');
    const rp = cli('plano', f, '--png', png, '--sobre-fondo', '--json');
    assert.equal(rp.status, 0, rp.stderr);
    assert.ok(decodificarPNG(readFileSync(png)).ancho > 0);
  });
  test('la imagen tiene que estar dentro de la carpeta; --sobre-fondo pide un PNG legible', () => {
    const carpeta = mkdtempSync(join(dir, 'fuera-'));
    const f = join(carpeta, 'casa.espacio.json');
    cli('nuevo', f, '--ancho', '100', '--largo', '100');
    const fuera = join(dir, 'fuera.png');
    planoSintetico(fuera);
    assert.match(cli('fondo', 'poner', f, '--imagen', fuera).stderr, /dentro de la carpeta/);
    assert.match(cli('plano', f, '--png', join(carpeta, 'x.png'), '--sobre-fondo').stderr, /no tiene fondos/);
    writeFileSync(join(carpeta, 'roto.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 10]));
    assert.equal(cli('fondo', 'poner', f, '--imagen', join(carpeta, 'roto.png')).status, 0);
    assert.match(cli('plano', f, '--png', join(carpeta, 'x.png'), '--sobre-fondo').stderr, /no se puede pintar/);
  });
  test('lotes: editar y quitar; calibrar con puntos iguales falla', () => {
    let e = N.ponerFondo(N.nuevoEspacio({ ancho: 100, largo: 100 }), { archivo: 'p.png', anchoPx: 10, altoPx: 10 }).espacio;
    assert.throws(() => N.ejecutarLote(e, [{ op: 'fondo-calibrar', id: 'plano', puntos: '1,1,1,1', distancia: 10 }]), /mismo/);
    e = N.ejecutarLote(e, [{ op: 'fondo-editar', id: 'plano', opacidad: 0.8 }, { op: 'fondo-quitar', id: 'plano' }]).espacio;
    assert.equal(N.planta(e).fondos, undefined);
  });
});

describe('fondoAPlanta y plantaAFondo', () => {
  test('son inversas, también con giro y escala', () => {
    const f = { id: 'p', archivo: 'p.png', anchoPx: 10, altoPx: 10, escala: 0.37, x: 12.5, y: -40, giro: 33, opacidad: 0.5 };
    for (const [px, py] of [[0, 0], [100, 0], [37, 250], [-10, 5]]) {
      const [x, y] = N.fondoAPlanta(f, px, py);
      const [qx, qy] = N.plantaAFondo(f, x, y);
      assert.ok(Math.abs(qx - px) < 1e-9 && Math.abs(qy - py) < 1e-9, `${px},${py} -> ${qx},${qy}`);
    }
  });
});
