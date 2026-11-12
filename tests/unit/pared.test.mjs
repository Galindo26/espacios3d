// Cosas en la pared: cuadro, espejo, televisor, balda y aplique. Altura por defecto, colgar en la
// pared más cercana con sitio, aviso si no tocan la pared y convivencia con muebles y ventanas.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const validador = createRequire(import.meta.url)('gltf-validator');
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const PARED = ['cuadro', 'espejo', 'television', 'balda', 'aplique'];

/** Cuarto de 400 × 300 con una puerta en el centro de la pared de arriba y una ventana abajo. */
function cuarto(muebles = [], extra = []) {
  return N.validarOLanzar({
    formato: 'espacios3d', version: 2, nombre: 'Cuarto',
    plantas: [{ id: 'pb', nivel: 0, estancias: [
      { id: 'sala', nombre: 'Sala', contorno: rect(0, 0, 400, 300), altura: 250, huecos: [
        { id: 'puerta', tipo: 'puerta', muro: 0, desde: 160, ancho: 80, alto: 210 },
        { id: 'ventana', tipo: 'ventana', muro: 2, desde: 140, ancho: 120, alto: 110, antepecho: 90 },
      ] },
      ...extra,
    ], muebles }],
  });
}
const incid = (e, regla) => N.analizar(e).filter((i) => !regla || i.regla === regla);

describe('catálogo de pared', () => {
  test('cinco tipos colgados, con su altura del suelo', () => {
    for (const t of PARED) {
      const c = N.tipoMueble(t);
      assert.equal(c.tipo, t);
      assert.ok(c.pared && c.elevacion > 0, t);
    }
    assert.equal(N.tipoMueble('cuadro').elevacion, 140);
    assert.ok(!N.tipoMueble('armario').pared);
  });

  test('al añadirlo sin posición se cuelga en la pared más cercana, evitando la puerta', () => {
    const r = N.agregarMueble(cuarto(), { tipo: 'cuadro' });
    const m = r.espacio.plantas[0].muebles[0];
    // Pared de arriba (la más cercana, empatada con la de abajo); su centro tiene la puerta: va al lado.
    assert.deepEqual([m.x, m.y, m.giro, m.elevacion], [125, 1.5, 0, 140]);
    assert.deepEqual(incid(r.espacio), []);
  });

  test('varios seguidos no se montan: buscan otro tramo u otra pared', () => {
    let e = cuarto();
    for (let k = 0; k < 6; k++) e = N.agregarMueble(e, { tipo: 'cuadro' }).espacio;
    for (const t of ['television', 'balda', 'aplique', 'espejo']) e = N.agregarMueble(e, { tipo: t }).espacio;
    assert.deepEqual(incid(e).filter((i) => i.gravedad === 'error'), []);
    assert.deepEqual(incid(e, 'pared'), []);
    // Un armario alto contra la pared ocupa ese tramo también para lo colgado.
    const armario = { id: 'armario', tipo: 'armario', x: 60, y: 30, ancho: 100, fondo: 60, alto: 200 };
    const r = N.agregarMueble(cuarto([armario]), { tipo: 'cuadro' }).espacio;
    assert.deepEqual(incid(r).filter((i) => i.gravedad === 'error'), []);
  });

  test('en otra estancia indicada (lote), en una de sus paredes', () => {
    const e = cuarto([], [{ id: 'cuarto2', nombre: 'Dormitorio', contorno: rect(410, 0, 700, 300), altura: 250, huecos: [] }]);
    const r = N.ejecutarLote(e, [{ op: 'agregar', tipo: 'television', estancia: 'cuarto2' }]).espacio;
    const tv = r.plantas[0].muebles[0];
    assert.equal(N.estanciaDeMueble(r.plantas[0], tv).id, 'cuarto2');
    assert.deepEqual(incid(r, 'pared'), []);
    assert.equal(tv.elevacion, 100);
  });

  test('sobre un sofá y por encima de la ventana no estorba; delante de la ventana, la tapa', () => {
    const sofa = { id: 'sofa', tipo: 'sofa', x: 100, y: 255, ancho: 180, fondo: 90, alto: 85, giro: 180 };
    let e = N.ejecutarLote(cuarto([sofa]), [{ op: 'agregar', tipo: 'cuadro', id: 'c1', muro: 2, desde: 270, elevacion: 140 }]).espacio;
    assert.deepEqual(incid(e).filter((i) => i.muebles.includes('c1')), []);
    e = N.ejecutarLote(cuarto(), [{ op: 'agregar', tipo: 'cuadro', id: 'c2', muro: 2, desde: 170 }]).espacio;
    assert.ok(incid(e, 'ventana').some((i) => i.muebles.includes('c2')), 'delante del cristal');
    e = N.ejecutarLote(cuarto(), [{ op: 'agregar', tipo: 'balda', id: 'b', muro: 2, desde: 160, elevacion: 205 }]).espacio;
    assert.deepEqual(incid(e).filter((i) => i.muebles.includes('b')), [], 'encima de la ventana');
  });

  test('aviso si va colgado y no toca la pared; en el suelo, no', () => {
    let e = cuarto([{ id: 'cuadro', tipo: 'cuadro', x: 200, y: 150, ancho: 60, fondo: 3, alto: 45, elevacion: 140 }]);
    assert.ok(incid(e, 'pared').some((i) => /no toca la pared/.test(i.mensaje)));
    e = N.pegarAPared(e, 'cuadro');
    assert.deepEqual(incid(e, 'pared'), []);
    e = cuarto([{ id: 'espejo', tipo: 'espejo', x: 200, y: 150, ancho: 50, fondo: 3, alto: 160, elevacion: 0 }]);
    assert.deepEqual(incid(e, 'pared'), [], 'un espejo de pie, apoyado en el suelo');
  });

  test('formas que se ven como lo que son y .glb válido', async () => {
    let e = cuarto();
    for (const t of PARED) e = N.agregarMueble(e, { tipo: t }).espacio;
    assert.deepEqual(incid(e, 'pared'), []);
    for (const m of e.plantas[0].muebles) assert.ok(N.formaGenerica(m).length >= 2, `${m.tipo} lleva más de una pieza`);
    const informe = await validador.validateBytes(new Uint8Array(N.espacioAGLB(e)), { maxIssues: 20 });
    assert.equal(informe.issues.numErrors, 0, JSON.stringify(informe.issues.messages.slice(0, 3)));
  });
});

// Revisión independiente (12/11/2026), hallazgo 3: el colgado automático no deja errores.
describe('revisión independiente: colgar sin errores', () => {
  const errores = (e) => N.analizar(e).filter((i) => i.gravedad === 'error');
  test('ni sobre la puerta que define la estancia vecina en el tabique', () => {
    let e = N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [{ id: 'pb', estancias: [
      { id: 'salon', contorno: rect(0, 0, 300, 300), altura: 250, huecos: [] },
      { id: 'cocina', contorno: rect(310, 0, 600, 300), altura: 250, huecos: [{ id: 'pc', tipo: 'puerta', muro: 3, desde: 110, ancho: 80, alto: 210, abre: 'fuera' }] },
    ], muebles: [] }] });
    for (let k = 0; k < 5; k++) e = N.ejecutarLote(e, [{ op: 'agregar', tipo: 'cuadro', estancia: 'salon' }]).espacio;
    assert.deepEqual(errores(e), []);
  });
  test('ni contra un pilar ni bajo un techo inclinado', () => {
    const e0 = N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [{ id: 'pb', estancias: [
      { id: 's', contorno: rect(0, 0, 400, 300), altura: 250, huecos: [],
        elementos: [{ id: 'pilar', tipo: 'pilar', forma: 'adosado', muro: 0, desde: 170, ancho: 60, fondo: 30 }],
        faldones: [{ muro: 2, alturaEnMuro: 120, alcance: 150 }] },
    ], muebles: [] }] });
    let e = e0;
    for (let k = 0; k < 4; k++) e = N.agregarMueble(e, { tipo: 'cuadro' }).espacio;
    assert.deepEqual(errores(e), []);
  });
});

describe('revisión independiente: duplicar lo colgado', () => {
  test('12: la copia de un cuadro colgado sigue en la pared, al lado', () => {
    for (const muro of [0, 1]) {
      let e = N.ejecutarLote(cuarto(), [{ op: 'agregar', tipo: 'cuadro', id: 'c', muro, desde: 20 }]).espacio;
      e = N.duplicarMueble(e, 'c').espacio;
      assert.equal(e.plantas[0].muebles.length, 2);
      assert.deepEqual(incid(e).filter((i) => i.regla === 'pared' || i.gravedad === 'error'), [], `muro ${muro}`);
    }
  });
});
