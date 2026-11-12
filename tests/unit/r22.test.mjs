// Regresiones de la revisión independiente de R2-2: profundidad de los huecos junto a esquinas y tabiques
// (D1), rayos con coordenadas sin redondear (D2), análisis al otro lado de la puerta (D5) y fondo del
// hueco en el SVG con tabiques más gruesos que los muros (D6).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const unaPlanta = (estancias, muebles = [], grosorExterior = 10) =>
  N.validarOLanzar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', grosorExterior, estancias, muebles }] });
const caja = (id, x, y, ancho = 40, fondo = 40) => ({ id, tipo: 'caja', ancho, fondo, alto: 80, x, y });
/** Área de muro bajo el dintel (banda que empieza en el suelo). */
const muroBajo = (m) => N.areaTotal(m.bandas[0].poligonos);

describe('D1: profundidad de los huecos junto a esquinas y tabiques', () => {
  test('L con la puerta a ras de la esquina entrante: atraviesa sólo su muro (10 cm) y se avisa', () => {
    const L = [[0, 0], [400, 0], [400, 150], [200, 150], [200, 300], [0, 300]];
    for (const desde of [60, 115, 120]) {
      const m = N.modeloPlanta(N.planta(unaPlanta([{ id: 'l', contorno: L, huecos: [{ id: 'p', tipo: 'puerta', muro: 2, desde, ancho: 80 }] }])));
      const h = m.huecos[0];
      assert.deepEqual([h.profundidadA, h.profundidadB], [10, 10], `desde ${desde}`);
      assert.ok(Math.abs(muroBajo(m) - (N.areaTotal(m.masa) - 80 * 10)) < 10, `desde ${desde}: sólo se quita el hueco (± el margen de 0,5 cm)`);
    }
    const e = unaPlanta([{ id: 'l', contorno: L, huecos: [{ id: 'p', tipo: 'puerta', muro: 2, desde: 120, ancho: 80 }] }]);
    assert.ok(N.analizar(e).some((i) => i.regla === 'hueco'), 'a ras de la esquina se avisa');
    const limpio = unaPlanta([{ id: 'l', contorno: L, huecos: [{ id: 'p', tipo: 'puerta', muro: 2, desde: 60, ancho: 80 }] }]);
    assert.ok(!N.analizar(limpio).some((i) => i.regla === 'hueco'), 'en mitad del muro no');
  });

  test('puerta del pasillo que pisa el tabique entre salón y cocina: conecta con el salón y no borra el tabique', () => {
    const e = unaPlanta([
      { id: 'pasillo', contorno: rect(0, 0, 800, 100), huecos: [{ id: 'p', tipo: 'puerta', muro: 2, desde: 495, ancho: 80 }] },
      { id: 'salon', contorno: rect(0, 110, 300, 410) },
      { id: 'cocina', contorno: rect(310, 110, 500, 410) },
    ]);
    const m = N.modeloPlanta(N.planta(e));
    assert.deepEqual(m.conexiones.map((c) => [c.hueco, c.a, c.grosor]), [['p', 'salon', 10]]);
    assert.ok(Math.abs(muroBajo(m) - (N.areaTotal(m.masa) - 80 * 10)) < 10, `${muroBajo(m)}`);
    assert.ok(N.analizar(e).some((i) => i.regla === 'hueco'));
  });

  test('puerta que pasa del final de la estancia vecina: no borra el muro de abajo de la vecina', () => {
    const e = unaPlanta([
      { id: 'a', contorno: rect(0, 0, 300, 300), huecos: [{ id: 'p', tipo: 'puerta', muro: 1, desde: 110, ancho: 90 }] },
      { id: 'b', contorno: rect(310, 0, 600, 150) },
    ]);
    const m = N.modeloPlanta(N.planta(e));
    const h = m.huecos[0];
    assert.ok(h.profundidadA <= 10.01 && h.profundidadB <= 10.01, `${h.profundidadA}, ${h.profundidadB}`);
    assert.ok(Math.abs(muroBajo(m) - (N.areaTotal(m.masa) - 90 * 10)) < 10, `${muroBajo(m)}`);
  });

  test('pared de enfrente inclinada: trapecio con el grosor de cada extremo', () => {
    // Muros exteriores de 20 cm (la masa entre las dos es continua) y la vecina con la pared izquierda
    // inclinada: de x = 310 arriba a x = 325 abajo, así que el muro mide 10 + 15·y/300 cm.
    const e = unaPlanta(
      [
        { id: 'a', contorno: rect(0, 0, 300, 300), huecos: [{ id: 'p', tipo: 'paso', muro: 1, desde: 100, ancho: 100 }] },
        { id: 'b', contorno: [[310, 0], [600, 0], [600, 300], [325, 300]] },
      ],
      [],
      20,
    );
    const h = N.modeloPlanta(N.planta(e)).huecos[0];
    assert.ok(Math.abs(h.profundidadA - 15) < 0.3 && Math.abs(h.profundidadB - 20) < 0.3, `${h.profundidadA}, ${h.profundidadB}`);
    assert.equal(h.dudoso, false);
  });
});

describe('D2: coordenadas sin redondear', () => {
  test('dos estancias giradas con tabique de 10 y una puerta entre ellas: grosor 10 y conexión en todos los ángulos', () => {
    let malos = 0;
    for (let i = 0; i < 120; i++) {
      const ang = (i / 120) * Math.PI * 2 + 0.0123;
      const [c, s] = [Math.cos(ang), Math.sin(ang)];
      const t = ([x, y]) => [x * c - y * s + 37.123456, x * s + y * c - 11.987654];
      const e = unaPlanta([
        { id: 'a', contorno: rect(0, 0, 300, 300).map(t), huecos: [{ id: 'p', tipo: 'puerta', muro: 1, desde: 100, ancho: 80 }] },
        { id: 'b', contorno: rect(310, 0, 600, 300).map(t) },
      ]);
      const h = N.modeloPlanta(N.planta(e)).huecos[0];
      if (h.da !== 'b' || Math.abs(h.profundidad - 10) > 0.05) malos++;
    }
    assert.equal(malos, 0);
  });
});

describe('D5: el otro lado de una puerta entre estancias', () => {
  const piso = (muebles, abre = 'dentro') =>
    unaPlanta(
      [
        { id: 'pasillo', contorno: rect(0, 0, 800, 100) },
        { id: 'salon', contorno: rect(0, 110, 300, 410), huecos: [{ id: 'p', tipo: 'puerta', muro: 0, desde: 100, ancho: 80, abre }] },
      ],
      muebles,
    );
  test('una caja en el pasillo pegada a la puerta del salón tapa el paso', () => {
    const inc = N.analizar(piso([caja('c', 140, 70)]));
    assert.ok(inc.some((i) => i.regla === 'paso' && i.huecos.includes('p') && /lado de salon|por el lado/.test(i.mensaje)), JSON.stringify(inc));
    assert.ok(!N.analizar(piso([caja('c', 500, 50)])).some((i) => i.gravedad === 'error'), 'lejos de la puerta, nada');
  });
  test('una puerta que abre hacia el pasillo: lo que hay en su barrido es un error', () => {
    const inc = N.analizar(piso([caja('c', 150, 60, 30, 30)], 'fuera'));
    assert.ok(inc.some((i) => i.regla === 'puerta' && /abre hacia pasillo/.test(i.mensaje)), JSON.stringify(inc));
  });
});

describe('D6: el hueco en el SVG atraviesa el tabique entero', () => {
  test('tabique de 20 cm con grosor exterior 10: el paso se pinta 20 cm', () => {
    const e = unaPlanta([
      { id: 'a', contorno: rect(0, 0, 300, 300), huecos: [{ id: 'p', tipo: 'paso', muro: 1, desde: 100, ancho: 80 }] },
      { id: 'b', contorno: rect(320, 0, 600, 300) },
    ]);
    assert.match(N.planoSVG(e), /<polygon points="300,100 300,180 320\.5,180 320\.5,100" fill="#efe8dc"\/>/);
  });
});
