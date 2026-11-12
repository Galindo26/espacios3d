// R2-5: recorrido en primera persona. Colisión pura del núcleo: muros (salvo puertas y pasos),
// muebles de más de 30 cm y obra; deslizamiento y sin atravesar con pasos largos.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const piso = (muebles = [], elementos = []) =>
  N.planta(
    N.validarOLanzar({
      formato: 'espacios3d',
      version: 2,
      plantas: [
        {
          id: 'pb',
          grosorExterior: 10,
          estancias: [
            { id: 'pasillo', contorno: rect(0, 0, 800, 100) },
            { id: 'salon', contorno: rect(0, 110, 300, 410), huecos: [{ id: 'p', tipo: 'puerta', muro: 0, desde: 100, ancho: 80 }, { id: 'v', tipo: 'ventana', muro: 3, desde: 100, ancho: 100 }], elementos },
          ],
          muebles,
        },
      ],
    }),
  );
const cerca = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

describe('colisión del recorrido', () => {
  const p = piso();
  const segs = N.obstaculos(p);
  test('andar contra un muro se para a un radio de él', () => {
    const q = N.moverConColision([50, 50], [0, 200], segs);
    assert.ok(cerca(q[1], 100 - N.RADIO_PERSONA) && cerca(q[0], 50), `${q}`);
  });
  test('por la puerta se pasa del pasillo al salón', () => {
    const q = N.moverConColision([140, 50], [0, 200], segs);
    assert.ok(cerca(q[0], 140) && cerca(q[1], 250), `${q}`);
    assert.equal(N.estanciaEnPunto(p, q)?.id, 'salon');
  });
  test('por una ventana no se pasa', () => {
    const q = N.moverConColision([150, 260], [-300, 0], segs);
    assert.ok(cerca(q[0], N.RADIO_PERSONA), `${q}`);
  });
  test('en diagonal contra un muro, se desliza a lo largo de él', () => {
    const q = N.moverConColision([300, 50], [200, 200], segs);
    assert.ok(cerca(q[1], 80) && q[0] > 450, `${q}`);
  });
  test('un paso enorme no atraviesa el muro', () => {
    const q = N.moverConColision([50, 50], [0, 5000], segs);
    assert.ok(q[1] < 100, `${q}`);
  });
  test('un sofá corta el paso; una alfombra no; una columna sí', () => {
    const conSofa = N.obstaculos(piso([{ id: 's', tipo: 'sofa', ancho: 200, fondo: 90, alto: 85, x: 150, y: 260 }]));
    assert.ok(N.moverConColision([150, 150], [0, 200], conSofa)[1] < 215 - N.RADIO_PERSONA + 1);
    const conAlfombra = N.obstaculos(piso([{ id: 'a', tipo: 'alfombra', ancho: 200, fondo: 90, alto: 1, x: 150, y: 260 }]));
    assert.ok(cerca(N.moverConColision([150, 150], [0, 150], conAlfombra)[1], 300));
    // Una columna cuadrada de frente para; contra una redonda se desliza alrededor (como una persona).
    const conColumna = N.obstaculos(piso([], [{ id: 'c', forma: 'exento', x: 150, y: 260, ancho: 40 }]));
    assert.ok(N.moverConColision([150, 150], [0, 200], conColumna)[1] < 240 - N.RADIO_PERSONA + 1);
    const conRedonda = N.obstaculos(piso([], [{ id: 'c', forma: 'exento', x: 150, y: 260, ancho: 40, redondo: true }]));
    const q = N.moverConColision([150, 150], [0, 200], conRedonda);
    assert.ok(Math.hypot(q[0] - 150, q[1] - 260) >= 20 + N.RADIO_PERSONA - 1, `${q}`);
  });
  test('punto de salida libre: el centro, o cerca si hay un mueble', () => {
    assert.deepEqual(N.puntoDeSalida(p, 'salon'), [150, 260]);
    const conMesa = piso([{ id: 'm', tipo: 'mesa', ancho: 100, fondo: 100, alto: 75, x: 150, y: 260 }]);
    const q = N.puntoDeSalida(conMesa, 'salon');
    assert.ok(Math.hypot(q[0] - 150, q[1] - 260) >= 70, `${q}`);
  });
});

describe('revisión del núcleo de R2-5 (H1, H2)', () => {
  test('H1: misma regla para muebles y obra: ocupa algo entre 30 y 180 cm', () => {
    const estante = N.obstaculos(piso([{ id: 'e', tipo: 'estanteria', ancho: 200, fondo: 30, alto: 60, elevacion: 100, x: 150, y: 260 }]));
    assert.ok(N.moverConColision([150, 150], [0, 200], estante)[1] < 245 - N.RADIO_PERSONA + 1, 'un estante a la altura del pecho para');
    const lampara = N.obstaculos(piso([{ id: 'l', tipo: 'caja', ancho: 50, fondo: 50, alto: 20, elevacion: 200, x: 150, y: 260 }]));
    assert.ok(N.moverConColision([150, 150], [0, 150], lampara)[1] > 295, 'lo que está por encima de la cabeza no para');
  });
  test('H2: sin grosor de muro se choca con el contorno, salvo en las puertas', () => {
    const p = N.planta(
      N.validarOLanzar({
        formato: 'espacios3d',
        version: 2,
        plantas: [{ id: 'pb', grosorExterior: 0, estancias: [{ id: 'a', contorno: rect(0, 0, 300, 300), huecos: [{ id: 'p', tipo: 'puerta', muro: 1, desde: 100, ancho: 80 }] }, { id: 'b', contorno: rect(300, 0, 600, 300) }] }],
      }),
    );
    const segs = N.obstaculos(p);
    assert.ok(N.moverConColision([150, 50], [-300, 0], segs)[0] >= N.RADIO_PERSONA - 0.5, 'no se sale por la pared');
    assert.ok(N.moverConColision([250, 140], [200, 0], segs)[0] > 400, 'por la puerta se pasa a la otra estancia');
  });
  test('un biombo de 4 cm no se atraviesa ni con pasos largos', () => {
    const b = N.obstaculos(piso([{ id: 'b', tipo: 'caja', ancho: 300, fondo: 4, alto: 170, x: 150, y: 260 }]));
    for (const paso of [5, 30, 150]) {
      let q = [150, 150];
      for (let i = 0; i < 20; i++) q = N.moverConColision(q, [0, paso], b);
      assert.ok(q[1] < 260, `paso ${paso}: ${q}`);
    }
  });
});
