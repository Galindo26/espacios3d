// R4-1: comprobaciones de acceso: ¿entra el mueble por las puertas?, paso libre de 60 cm desde la
// puerta y círculo de giro de 150 cm.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const caja = (id, x, y, ancho, fondo, alto, extra = {}) => ({ id, tipo: 'caja', nombre: id, x, y, ancho, fondo, alto, ...extra });
const puerta = (id, muro, desde, ancho = 80) => ({ id, tipo: 'puerta', muro, desde, ancho, alto: 210, abre: 'dentro' });
const paso = (id, muro, desde, ancho) => ({ id, tipo: 'paso', muro, desde, ancho, alto: 210 });

/** Una estancia de 400 × 300 con una puerta al exterior en la pared de arriba (x de 40 a 120). */
function cuarto(muebles, { huecos = [puerta('p', 0, 40)], extra = {} } = {}) {
  return N.validarOLanzar({
    formato: 'espacios3d', version: 2, nombre: 'Cuarto',
    plantas: [{ id: 'pb', nivel: 0, estancias: [{ id: 'sala', nombre: 'Sala', contorno: rect(0, 0, 400, 300), altura: 250, huecos, ...extra }], muebles }],
  });
}
const acceso = (e) => N.analizar(e).filter((i) => i.regla === 'acceso' || i.regla === 'giro');

describe('¿pasa por el hueco?', () => {
  test('de canto, tumbado o no pasa', () => {
    assert.ok(N.pasaPorHueco([100, 60, 200], 76, 206), 'un armario entra de canto');
    assert.ok(N.pasaPorHueco([150, 200, 50], 76, 206), 'una cama tumbada');
    assert.ok(!N.pasaPorHueco([220, 95, 85], 76, 206), 'un sofá de 85 × 95 no pasa por 76 de ancho');
    assert.ok(N.pasaPorHueco([220, 95, 85], 96, 206), 'por una puerta de 100 sí');
    assert.ok(N.pasaPorHueco([90, 70, 300], 206, 76), 'el alto también vale de ancho (tumbado en el otro sentido)');
  });
});

describe('¿entra hasta su estancia?', () => {
  test('el sofá no entra por una puerta de 80; el armario y la cama sí', () => {
    const e = cuarto([caja('sofa', 250, 220, 220, 95, 85), caja('armario', 340, 100, 100, 60, 200, { giro: 90 })]);
    const r = acceso(e);
    assert.ok(r.some((i) => /«sofa» \(sofa\) no entra hasta «Sala»: mide 220 × 95 × 85 cm y no pasa por puerta p \(76 × 210\)/.test(i.mensaje)), JSON.stringify(r));
    assert.ok(!r.some((i) => i.muebles.includes('armario')));
    assert.equal(N.entradaMueble(e, 'armario').estado, 'entra');
    assert.equal(N.entradaMueble(e, 'sofa').estado, 'no-entra');
    assert.ok(r.every((i) => i.gravedad === 'aviso'));
  });

  test('sin puerta al exterior no se comprueba', () => {
    const e = cuarto([caja('sofa', 250, 220, 220, 95, 85)], { huecos: [] });
    assert.equal(N.entradaMueble(e, 'sofa').estado, 'sin-datos');
    assert.deepEqual(acceso(e).filter((i) => /no entra/.test(i.mensaje)), []);
  });

  test('el camino: entra al pasillo por una puerta ancha y no a la sala por un paso estrecho', () => {
    const e = N.validarOLanzar({
      formato: 'espacios3d', version: 2, nombre: 'Piso',
      plantas: [{ id: 'pb', nivel: 0, grosorExterior: 10, estancias: [
        { id: 'pasillo', nombre: 'Pasillo', contorno: rect(0, 0, 400, 150), altura: 250, huecos: [puerta('entrada', 0, 100, 110), paso('arco', 2, 100, 70)] },
        { id: 'sala', nombre: 'Sala', contorno: rect(0, 160, 400, 460), altura: 250, huecos: [] },
      ], muebles: [caja('sofa', 200, 400, 200, 90, 80), caja('mesa', 300, 80, 80, 80, 75)] }],
    });
    const r = acceso(e).filter((i) => /no entra/.test(i.mensaje));
    assert.equal(r.length, 1, JSON.stringify(r));
    assert.match(r[0].mensaje, /«sofa» .*no entra hasta «Sala».*paso arco \(70 × 210\)/);
  });

  test('por la escalera: lo que no cabe por ella no llega a la planta de arriba', () => {
    const e = N.validarOLanzar({
      formato: 'espacios3d', version: 2, nombre: 'Casa',
      plantas: [
        { id: 'pb', nivel: 0, estancias: [{ id: 'abajo', nombre: 'Abajo', contorno: rect(0, 0, 600, 600), altura: 250, huecos: [puerta('entrada', 0, 400, 100)] }], muebles: [],
          escaleras: [{ id: 'esc', x: 100, y: 100, ancho: 70, largo: 360, hasta: 'p1' }] },
        { id: 'p1', nivel: 280, estancias: [{ id: 'arriba', nombre: 'Arriba', contorno: rect(0, 0, 600, 600), altura: 250, huecos: [] }],
          muebles: [caja('armario', 400, 300, 80, 80, 200), caja('silla', 300, 300, 45, 50, 90)] },
      ],
    });
    const r = acceso(e).filter((i) => /no entra/.test(i.mensaje));
    assert.deepEqual(r.map((i) => i.muebles[0]), ['armario'], JSON.stringify(r));
    assert.match(r[0].mensaje, /escalera esc \(70 × 200\)/);
    assert.equal(N.entradaMueble(e, 'silla').estado, 'entra');
  });
});

describe('paso libre de 60 cm', () => {
  // Un mueble largo de lado a lado que deja un hueco a la derecha; detrás, un sillón.
  const conBarrera = (largo) => cuarto([caja('barrera', largo / 2, 170, largo, 40, 100), caja('sillon', 200, 260, 70, 60, 80), caja('alfombra', 200, 100, 120, 80, 1)]);

  test('con un hueco de 40 cm no se llega al sillón; con uno de 70, sí', () => {
    let r = acceso(conBarrera(360));
    assert.deepEqual(N.analizar(conBarrera(360)).filter((i) => i.gravedad === 'error'), []);
    assert.ok(r.some((i) => /No se llega a «sillon» \(sillon\) con un paso libre de 60 cm desde la puerta/.test(i.mensaje)), JSON.stringify(r));
    assert.ok(!r.some((i) => i.muebles.includes('barrera')), 'a la barrera se llega por delante');
    assert.ok(!r.some((i) => i.muebles.includes('alfombra')), 'la alfombra no cuenta');
    r = acceso(conBarrera(330));
    assert.deepEqual(r, []);
  });

  test('en una planta con errores no se mira (primero hay que arreglarlos)', () => {
    const e = cuarto([caja('tapon', 80, 40, 100, 60, 100), caja('sillon', 300, 250, 70, 60, 80)]);
    assert.ok(N.analizar(e).some((i) => i.gravedad === 'error'));
    assert.ok(!acceso(e).some((i) => /No se llega/.test(i.mensaje)));
  });

  test('desde la llegada de una escalera en una planta sin puertas', () => {
    const e = N.validarOLanzar({
      formato: 'espacios3d', version: 2, nombre: 'Casa',
      plantas: [
        { id: 'pb', nivel: 0, estancias: [{ id: 'abajo', contorno: rect(0, 0, 600, 600), altura: 250, huecos: [] }], muebles: [caja('mesa', 400, 400, 80, 80, 75)],
          escaleras: [{ id: 'esc', x: 100, y: 100, ancho: 90, largo: 360, hasta: 'p1' }] },
        { id: 'p1', nivel: 280, estancias: [{ id: 'arriba', contorno: rect(0, 0, 600, 600), altura: 250, huecos: [] }], muebles: [caja('cama', 400, 300, 150, 200, 50)] },
      ],
    });
    assert.deepEqual(N.mueblesSinPaso(e, e.plantas[1]), []);
    assert.equal(N.mueblesSinPaso(e, e.plantas[0]), null, 'abajo no hay por dónde entrar: no se comprueba');
  });
});

describe('círculo de giro de 150 cm', () => {
  const bano = (muebles, giro = true) => N.validarOLanzar({
    formato: 'espacios3d', version: 2, nombre: 'Baño',
    plantas: [{ id: 'pb', nivel: 0, estancias: [{ id: 'bano', nombre: 'Baño', contorno: rect(0, 0, 170, 170), altura: 250, huecos: [], ...(giro ? { circuloDeGiro: true } : {}) }], muebles }],
  });

  test('cabe en vacío; con un mueble en una esquina, no; sin la opción, no se mira', () => {
    const vacio = bano([]);
    assert.deepEqual(acceso(vacio), []);
    const c = N.circuloDeGiro(vacio.plantas[0], vacio.plantas[0].estancias[0]);
    assert.ok(c && Math.abs(c.centro[0] - 85) <= 5 && Math.abs(c.centro[1] - 85) <= 5, JSON.stringify(c));
    const lleno = bano([caja('mueble', 25, 25, 50, 50, 85)]);
    assert.ok(acceso(lleno).some((i) => i.regla === 'giro' && /En «Baño» \(bano\) no cabe un círculo de giro de 150 cm/.test(i.mensaje)));
    assert.deepEqual(acceso(bano([caja('mueble', 25, 25, 50, 50, 85)], false)), []);
  });

  test('un lavabo con hueco debajo para las rodillas no estorba', () => {
    assert.deepEqual(acceso(bano([caja('lavabo', 30, 25, 60, 50, 85, { huecoInferior: 70 })])), []);
  });

  test('validación y lote', () => {
    const r = N.validar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [{ id: 'pb', estancias: [{ id: 's', contorno: rect(0, 0, 200, 200), circuloDeGiro: 'sí' }], muebles: [] }] });
    assert.match(r.errores.join(), /circuloDeGiro/);
    let e = bano([], false);
    e = N.ejecutarLote(e, [{ op: 'estancia', estancia: 'bano', circuloDeGiro: true }]).espacio;
    assert.equal(e.plantas[0].estancias[0].circuloDeGiro, true);
    e = N.ejecutarLote(e, [{ op: 'estancia', estancia: 'bano', circuloDeGiro: false }]).espacio;
    assert.equal(e.plantas[0].estancias[0].circuloDeGiro, undefined);
  });
});

// Revisión independiente de la ronda 4 (12/11/2026).
describe('revisión independiente: paso libre sin falsos avisos', () => {
  const sala = (muebles, ancho = 300, largo = 400) => N.validarOLanzar({
    formato: 'espacios3d', version: 2, nombre: 'x',
    plantas: [{ id: 'pb', nivel: 0, estancias: [{ id: 's', nombre: 'S', contorno: rect(0, 0, ancho, largo), altura: 250, huecos: [puerta('p', 0, 110)] }], muebles }],
  });
  test('F1: a un armario de pared a pared se llega con cualquier fondo (60 a 71 cm)', () => {
    for (let fondo = 60; fondo <= 71; fondo += 0.5) {
      const e = sala([caja('armario', 150, 400 - fondo / 2, 300, fondo, 200)]);
      assert.deepEqual(acceso(e).filter((i) => /No se llega/.test(i.mensaje)), [], `fondo ${fondo}`);
    }
  });
  test('F2: un hueco de 60 cm o más entre dos muebles deja pasar, esté donde esté', () => {
    for (let dx = 0; dx < 10; dx += 1) {
      // Dos muebles que dejan 65 cm entre sí a la altura y = 200, con un sillón detrás.
      const e = sala([caja('a', (100 + dx) / 2, 200, 100 + dx, 40, 100), caja('b', 165 + dx + (135 - dx) / 2, 200, 135 - dx, 40, 100), caja('sillon', 150, 330, 70, 60, 80)]);
      assert.deepEqual(acceso(e).filter((i) => /No se llega/.test(i.mensaje)), [], `desplazado ${dx} cm`);
    }
  });
});

describe('revisión independiente: círculo de giro y exterior', () => {
  test('6: el círculo de giro no cae sobre una escalera', () => {
    const e = N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [
      { id: 'pb', nivel: 0, estancias: [{ id: 's', contorno: rect(0, 0, 400, 400), altura: 250, huecos: [], circuloDeGiro: true }], muebles: [],
        escaleras: [{ id: 'esc', x: 185, y: 100, ancho: 150, largo: 280, hasta: 'p1' }] },
      { id: 'p1', nivel: 280, estancias: [{ id: 't', contorno: rect(0, 0, 400, 400), altura: 250, huecos: [] }], muebles: [] },
    ] });
    const c = N.circuloDeGiro(e.plantas[0], e.plantas[0].estancias[0], e);
    const geo = N.geometriaDe(e, e.plantas[0], e.plantas[0].escaleras[0]);
    if (c) for (const r of N.parteBaja(geo)) assert.ok(N.distanciaAlContorno(c.centro, r) >= 75 - 0.01 && !N.puntoEnPoligono(c.centro, r), JSON.stringify(c));
  });
  test('7: una estancia llamada «exterior» no es la calle', () => {
    const e = N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [{ id: 'pb', estancias: [
      { id: 'exterior', nombre: 'Patio', contorno: rect(0, 0, 300, 300), altura: 250, huecos: [paso('arco', 1, 100, 70)] },
      { id: 'sala', nombre: 'Sala', contorno: rect(310, 0, 600, 300), altura: 250, huecos: [] },
    ], muebles: [caja('sofa', 450, 150, 200, 90, 80)] }] });
    assert.equal(N.entradaMueble(e, 'sofa').estado, 'sin-datos');
  });
});
