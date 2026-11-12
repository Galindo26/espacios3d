// Pruebas de H3 en el núcleo: contorno por tramos y edición de vértices con reasignación de huecos.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const L = [
  { longitud: 300, giro: 90 },
  { longitud: 100, giro: 90 },
  { longitud: 200, giro: -90 },
  { longitud: 200, giro: 90 },
  { longitud: 100, giro: 90 },
  { longitud: 300, giro: 90 },
];

// Accesos v2: primera estancia de la primera planta y sus muebles.
const E = (e) => N.estancia(e).estancia;
const M = (e) => N.planta(e).muebles;
describe('contorno por tramos', () => {
  test('rectángulo: igual que una estancia nueva y sin descuadre', () => {
    const r = N.contornoDesdeTramos([
      { longitud: 350, giro: 90 },
      { longitud: 300, giro: 90 },
      { longitud: 350, giro: 90 },
      { longitud: 300, giro: 90 },
    ]);
    assert.deepEqual(r.contorno, E(N.nuevoEspacio({ ancho: 350, largo: 300 })).contorno);
    assert.equal(r.descuadre, 0);
  });

  test('estancia en L con un giro a la izquierda (−90°)', () => {
    const r = N.contornoDesdeTramos(L);
    assert.deepEqual(r.contorno, [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]]);
    assert.equal(r.descuadre, 0);
    assert.ok(N.validar({ formato: 'espacios3d', version: 1, estancia: { contorno: r.contorno } }).ok);
  });

  test('medidas que no cierran: se informa el descuadre y la última pared lo absorbe', () => {
    const r = N.contornoDesdeTramos([
      { longitud: 350, giro: 90 },
      { longitud: 300, giro: 90 },
      { longitud: 352, giro: 90 },
      { longitud: 300, giro: 90 },
    ]);
    assert.equal(r.descuadre, 2);
    assert.ok(Math.abs(r.ultimaReal - 300) < 0.1, `última pared ${r.ultimaReal}`);
  });

  test('ida y vuelta contorno → tramos → contorno', () => {
    const c = N.contornoDesdeTramos(L).contorno;
    const t = N.tramosDesdeContorno(c);
    assert.deepEqual(t.map((x) => x.longitud), [300, 100, 200, 200, 100, 300]);
    assert.deepEqual(N.contornoDesdeTramos(t).contorno, c);
  });

  test('anclado al contorno actual: ida y vuelta exacta aunque sea antihorario o no empiece en el origen', () => {
    for (const c of [
      [[0, 0], [0, 300], [400, 300], [400, 0]],
      [[50, 20], [450, 20], [450, 320], [50, 320]],
      [[120, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300], [0, 140]],
    ]) {
      const r = N.contornoDesdeTramos(N.tramosDesdeContorno(c), N.anclajeDe(c));
      assert.deepEqual(r.contorno, c);
      assert.equal(r.descuadre, 0);
    }
  });

  test('menos de 3 paredes o longitudes no positivas fallan', () => {
    assert.throws(() => N.contornoDesdeTramos([{ longitud: 1, giro: 90 }, { longitud: 1, giro: 90 }]), /al menos 3/);
    assert.throws(() => N.contornoDesdeTramos([{ longitud: 1, giro: 90 }, { longitud: 0, giro: 90 }, { longitud: 1, giro: 90 }]), /Pared 2/);
  });
});

describe('vértices y huecos', () => {
  const sala = () =>
    N.validarOLanzar({
      formato: 'espacios3d',
      version: 1,
      estancia: {
        contorno: [[0, 0], [400, 0], [400, 300], [0, 300]],
        huecos: [
          { id: 'v', tipo: 'ventana', muro: 0, desde: 250, ancho: 100 },
          { id: 'p', tipo: 'puerta', muro: 3, desde: 40, ancho: 80 },
        ],
      },
    });

  test('insertar un vértice parte el muro y reasigna los huecos', () => {
    const e = N.insertarVertice(sala(), 0, 200);
    assert.deepEqual(E(e).contorno, [[0, 0], [200, 0], [400, 0], [400, 300], [0, 300]]);
    const v = E(e).huecos.find((h) => h.id === 'v');
    const p = E(e).huecos.find((h) => h.id === 'p');
    assert.deepEqual([v.muro, v.desde], [1, 50], 'la ventana pasa al tramo nuevo');
    assert.equal(p.muro, 4, 'la puerta del último muro sube un índice');
  });

  test('no se puede partir por dentro de un hueco', () => {
    assert.throws(() => N.insertarVertice(sala(), 0, 300), /cae dentro de «v»/);
  });

  test('quitar el vértice insertado (colineal) devuelve la estancia original con sus huecos', () => {
    const e = N.insertarVertice(sala(), 0, 200);
    assert.deepEqual(N.quitarVertice(e, 1), sala());
  });

  test('quitar una esquina real con huecos en sus paredes falla; sin huecos se puede', () => {
    assert.throws(() => N.quitarVertice(sala(), 0), /«v», «p»/);
    const sinHuecos = sala();
    E(sinHuecos).huecos = [];
    assert.equal(E(N.quitarVertice(sinHuecos, 2)).contorno.length, 3);
  });

  test('quitar la esquina 0 colineal reasigna bien los índices', () => {
    const e = N.validarOLanzar({
      formato: 'espacios3d',
      version: 1,
      estancia: {
        contorno: [[100, 0], [400, 0], [400, 300], [0, 300], [0, 0]],
        huecos: [
          { id: 'a', tipo: 'paso', muro: 4, desde: 10, ancho: 50 }, // de (0,0) a (100,0)
          { id: 'b', tipo: 'paso', muro: 0, desde: 10, ancho: 50 }, // de (100,0) a (400,0)
          { id: 'c', tipo: 'paso', muro: 2, desde: 10, ancho: 50 },
        ],
      },
    });
    const r = N.quitarVertice(e, 0);
    assert.deepEqual(E(r).contorno, [[400, 0], [400, 300], [0, 300], [0, 0]]);
    const h = Object.fromEntries(E(r).huecos.map((x) => [x.id, [x.muro, x.desde]]));
    assert.deepEqual(h, { a: [3, 10], b: [3, 110], c: [1, 10] });
  });

  test('mover una esquina que deja un hueco sin sitio falla', () => {
    assert.throws(() => N.moverVertice(sala(), 1, 300, 0), /no cabe en el muro 0/);
    assert.equal(E(N.moverVertice(sala(), 2, 420, 300)).contorno[2][0], 420);
  });

  test('hueco nuevo: centrado en la pared más larga libre y, si está ocupada, al lado', () => {
    const e = sala();
    const p = N.huecoNuevo(e, 'puerta');
    // Muro 0 (400 cm): centrada (160–240) no pisa la ventana (250–350) y deja 10 cm.
    assert.deepEqual([p.muro, p.desde], [0, 160]);
    const e2 = N.agregarHueco(e, p).espacio;
    const q = N.huecoNuevo(e2, 'puerta');
    assert.deepEqual([q.muro, q.desde], [0, 70], 'la segunda se aparta hacia la izquierda');
    assert.ok(E(N.agregarHueco(e2, q).espacio).huecos.length === 4);
  });

  test('editar un hueco y la estancia valida el resultado', () => {
    assert.equal(E(N.editarHueco(sala(), 'v', { desde: 10 })).huecos[0].desde, 10);
    assert.throws(() => N.editarHueco(sala(), 'v', { desde: 350 }), /no cabe/);
    assert.throws(() => N.editarEstancia(sala(), { altura: 100 }), /supera la altura/);
    assert.equal(N.planta(N.editarEstancia(sala(), { grosorMuros: 20 })).grosorExterior, 20, 'en v2 el grosor exterior es de la planta');
  });

  test('una esquina insertada en un muro diagonal con ventana se puede volver a quitar', () => {
    const e = N.validarOLanzar({
      formato: 'espacios3d', version: 1,
      estancia: { contorno: [[0, 0], [300, 0], [400, 137], [400, 300], [0, 300]], huecos: [{ id: 'v', tipo: 'ventana', muro: 1, desde: 100, ancho: 50 }] },
    });
    const con = N.insertarVertice(e, 1, 33);
    assert.equal(E(con).contorno.length, 6);
    const sin = N.quitarVertice(con, 2);
    assert.equal(E(sin).contorno.length, 5);
    assert.ok(Math.abs(E(sin).huecos[0].desde - 100) < 0.2, `la ventana vuelve a su sitio (${E(sin).huecos[0].desde})`);
  });

  test('con el techo bajo, las puertas y ventanas nuevas caben', () => {
    const bajo = N.editarEstancia(N.validarOLanzar({ formato: 'espacios3d', version: 1, estancia: { contorno: [[0, 0], [400, 0], [400, 300], [0, 300]] } }), { altura: 200 });
    for (const tipo of ['puerta', 'ventana', 'paso']) {
      const h = N.huecoNuevo(bajo, tipo);
      assert.ok(N.agregarHueco(bajo, h).espacio, `${tipo} cabe con 200 cm de techo`);
    }
  });

  test('punto de muro más cercano', () => {
    assert.deepEqual(N.puntoEnMuro(sala(), 120, 6), { muro: 0, d: 120, distancia: 6 });
  });

  test('cambiar el contorno con otro número de paredes recoloca los huecos (ancla común) o nombra el que se queda sin pared', () => {
    // La ventana (x 250–350 en y = 0) no cabe en la L, cuyo muro superior acaba en x = 300.
    assert.throws(() => N.cambiarContorno(sala(), N.contornoDesdeTramos(L).contorno), /«v» se queda sin pared/);
    // Empezando en otro vértice y con una esquina más en el muro superior: cada hueco va a la pared que lo contiene.
    const r = N.cambiarContorno(sala(), [[400, 0], [400, 300], [0, 300], [0, 0], [200, 0]]);
    const h = Object.fromEntries(E(r).huecos.map((x) => [x.id, [x.muro, x.desde]]));
    assert.deepEqual(h, { v: [4, 50], p: [2, 40] });
    // Una pared recorrida al revés: «desde» se mide desde su nuevo vértice inicial.
    const inv = N.cambiarContorno(sala(), [[0, 0], [0, 300], [400, 300], [400, 0], [200, 0]]);
    const hi = Object.fromEntries(E(inv).huecos.map((x) => [x.id, [x.muro, x.desde]]));
    assert.deepEqual(hi, { v: [3, 50], p: [0, 180] });
  });

  test('reanclar es la reindexación común: anclas de punto (ancho 0) y tolerancia de 1 cm', () => {
    const viejo = [[0, 0], [400, 0], [400, 300], [0, 300]];
    const nuevo = [[0, 0.8], [200, 0.8], [400, 0.8], [400, 300], [0, 300]];
    assert.deepEqual(N.reanclar(viejo, nuevo, [{ muro: 0, desde: 300 }], () => 'x'), [{ muro: 1, desde: 100 }]);
    assert.throws(() => N.reanclar(viejo, [[0, 2], [400, 2], [400, 300], [0, 300], [0, 150]], [{ muro: 0, desde: 300 }], () => 'faldón'), /«faldón»/);
  });
});
