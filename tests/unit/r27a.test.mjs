// R2-7, paso a: plantas (añadir copiando o con una estancia, editar, quitar con todo lo suyo),
// avisos de niveles y mover un tabique compartido.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(RAIZ, 'dist', 'Espacios3D', 'espacios3d.mjs');
const dir = mkdtempSync(join(tmpdir(), 'espacios3d-r27a-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Piso: salón (0..400) y dormitorio (410..710) con tabique de 10, puerta en el tabique y una ventana. */
const piso = () =>
  N.validarOLanzar({
    formato: 'espacios3d', version: 2, nombre: 'Piso',
    plantas: [{ id: 'pb', nombre: 'Planta baja', grosorExterior: 15, estancias: [
      { id: 'salon', contorno: rect(0, 0, 400, 300), altura: 260, huecos: [
        { id: 'p-dorm', tipo: 'puerta', muro: 1, desde: 100, ancho: 80 },
        { id: 'v-salon', tipo: 'ventana', muro: 0, desde: 100, ancho: 120 },
        { id: 'entrada', tipo: 'puerta', muro: 2, desde: 50, ancho: 90 },
      ] },
      { id: 'dorm', contorno: rect(410, 0, 710, 300), altura: 260, huecos: [{ id: 'v-dorm', tipo: 'ventana', muro: 2, desde: 100, ancho: 100 }] },
    ], muebles: [{ id: 'sofa', tipo: 'sofa', ancho: 200, fondo: 90, alto: 85, x: 200, y: 150 }] }],
    distribuciones: [{ nombre: 'Una', posiciones: { sofa: { x: 180, y: 150, giro: 0 } } }],
  });
const S = (e, id) => N.estancia(e, id).estancia;

describe('plantas', () => {
  test('agregar copiando la huella: contornos, grosor, ids <estancia>-<planta>, ventanas sí y puertas no; nivel por defecto', () => {
    const r = N.agregarPlanta(piso(), { id: 'p1', nombre: 'Primera', copiarDe: 'pb', conVentanas: true });
    const p = N.planta(r.espacio, 'p1');
    assert.deepEqual(r.estancias, ['salon-p1', 'dorm-p1']);
    assert.equal(p.nivel, 260 + N.FORJADO);
    assert.equal(p.grosorExterior, 15);
    assert.deepEqual(p.estancias.map((s) => s.contorno), [rect(0, 0, 400, 300), rect(410, 0, 710, 300)]);
    assert.deepEqual(p.estancias.flatMap((s) => s.huecos.map((h) => h.id)), ['v-salon-p1', 'v-dorm-p1']);
    assert.equal(p.muebles.length, 0);
    // Sin ventanas, ningún hueco.
    const sin = N.agregarPlanta(piso(), { copiarDe: 'pb' });
    assert.equal(N.planta(sin.espacio, sin.id).estancias.flatMap((s) => s.huecos).length, 0);
    assert.equal(sin.id, 'planta-1');
  });

  test('agregar sin copiar necesita el contorno de la primera estancia', () => {
    assert.throws(() => N.agregarPlanta(piso(), { id: 'p1' }), /copiarDe.*contorno/);
    const r = N.agregarPlanta(piso(), { id: 'sotano', nivel: -280, contorno: rect(0, 0, 300, 300), alto: 230 });
    const p = N.planta(r.espacio, 'sotano');
    assert.deepEqual([p.nivel, p.estancias[0].altura, p.estancias[0].id], [-280, 230, 'estancia-sotano']);
  });

  test('editar nombre y nivel; avisos de niveles iguales o que se pisan; una planta: salida de siempre', () => {
    let e = N.agregarPlanta(piso(), { id: 'p1', copiarDe: 'pb' }).espacio;
    assert.equal(N.analizar(e).filter((i) => i.regla === 'niveles').length, 0);
    assert.ok(N.analizar(e).every((i) => i.planta), 'con varias plantas cada incidencia dice la suya');
    e = N.editarPlanta(e, 'p1', { nivel: 200 });
    assert.match(N.analizar(e).find((i) => i.regla === 'niveles').mensaje, /los pisos se pisan/);
    e = N.editarPlanta(e, 'p1', { nivel: 0, nombre: 'Gemela' });
    assert.match(N.analizar(e).find((i) => i.regla === 'niveles').mensaje, /mismo nivel/);
    assert.equal(N.planta(e, 'p1').nombre, 'Gemela');
    assert.ok(N.analizar(piso()).every((i) => i.planta === undefined));
  });

  test('quitar se lleva lo suyo y limpia las distribuciones; no la única', () => {
    let e = N.agregarPlanta(piso(), { id: 'p1', copiarDe: 'pb' }).espacio;
    assert.throws(() => N.quitarPlanta(piso(), 'pb'), /única planta/);
    const r = N.quitarPlanta(e, 'pb');
    assert.deepEqual(r.quitado, { estancias: 2, muebles: 1, elementos: 0, fondos: 0, escaleras: 0 });
    assert.deepEqual(r.espacio.distribuciones[0].posiciones, {});
    assert.deepEqual(r.espacio.plantas.map((p) => p.id), ['p1']);
  });
});

describe('mover un tabique compartido', () => {
  test('el tabique se mueve entero: crece una estancia lo que encoge la otra y conserva su grosor y su puerta', () => {
    const r = N.moverTabique(piso(), 'salon', 1, 50);
    assert.deepEqual(r.vecinas, [{ estancia: 'dorm', muro: 3 }]);
    assert.deepEqual(S(r.espacio, 'salon').contorno, rect(0, 0, 450, 300));
    assert.deepEqual(S(r.espacio, 'dorm').contorno, rect(460, 0, 710, 300));
    const p = S(r.espacio, 'salon').huecos.find((h) => h.id === 'p-dorm');
    assert.deepEqual([p.muro, p.desde], [1, 100]);
    // La puerta sigue comunicando las dos estancias.
    const con = N.modeloPlanta(N.planta(r.espacio)).conexiones.find((c) => c.hueco === 'p-dorm');
    assert.deepEqual([con.de, con.a].sort(), ['dorm', 'salon']);
    assert.equal(con.grosor, 10, 'el tabique conserva su grosor');
  });

  test('una pared que va de la esquina movida: su ventana se queda en su sitio (se corrige «desde»)', () => {
    // Mover la pared 3 (izquierda, x = 0) 40 cm hacia fuera: la pared 0 empieza ahora en x = −40.
    const r = N.moverTabique(piso(), 'salon', 3, 40);
    assert.deepEqual(r.vecinas, []);
    const s = S(r.espacio, 'salon');
    assert.deepEqual(s.contorno, [[-40, 0], [400, 0], [400, 300], [-40, 300]]);
    assert.equal(s.huecos.find((h) => h.id === 'v-salon').desde, 140, 'la ventana sigue en x = 100..220');
  });

  test('hacia dentro, y errores claros', () => {
    const r = N.moverTabique(piso(), 'dorm', 3, -30);
    assert.deepEqual(r.vecinas.map((x) => x.estancia), ['salon']);
    assert.deepEqual(S(r.espacio, 'salon').contorno, rect(0, 0, 430, 300));
    assert.throws(() => N.moverTabique(piso(), 'salon', 9, 10), /no tiene el muro 9/);
    assert.throws(() => N.moverTabique(piso(), 'salon', 1, 400), /llegaría hasta la de enfrente|no es válido/);
  });

  // Revisión independiente del paso a (T1–T5).
  const casa = (estancias) => N.validarOLanzar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', estancias }] });
  test('T1: una pared que da a dos estancias las mueve a las dos y los tabiques conservan su grosor', () => {
    const e = casa([{ id: 's', nombre: 'Salón', contorno: rect(0, 0, 600, 300) }, { id: 'd1', contorno: rect(0, 310, 300, 600) }, { id: 'd2', contorno: rect(310, 310, 600, 600) }]);
    for (const d of [30, 5, -30]) {
      const r = N.moverTabique(e, 's', 2, d);
      assert.deepEqual(r.vecinas.map((x) => x.estancia).sort(), ['d1', 'd2']);
      assert.equal(S(r.espacio, 'd1').contorno[0][1] - S(r.espacio, 's').contorno[2][1], 10);
      assert.equal(S(r.espacio, 'd2').contorno[0][1] - S(r.espacio, 's').contorno[2][1], 10);
    }
  });
  test('T2: si la pared de enfrente es más larga, no se mueve en parte y se dice desde dónde', () => {
    const e = casa([{ id: 's', nombre: 'Salón', contorno: rect(0, 0, 600, 300) }, { id: 'b', nombre: 'Baño', contorno: rect(0, 310, 200, 500) }]);
    assert.throws(() => N.moverTabique(e, 'b', 0, 40), /más larga.*desde «Salón»/);
    const r = N.moverTabique(e, 's', 2, 20);
    assert.deepEqual(S(r.espacio, 'b').contorno, rect(0, 330, 200, 500));
  });
  test('T3: una pared no puede llegar a la de enfrente (la estancia se daría la vuelta)', () => {
    assert.throws(() => N.moverTabique(piso(), 'salon', 1, -405), /llegaría hasta la de enfrente/);
    assert.throws(() => N.moverTabique(piso(), 'salon', 1, 305), /llegaría hasta la de enfrente/);
  });
  test('T4: una pared en línea con la contigua no se mueve en parte', () => {
    const e = casa([{ id: 's', nombre: 'Salón', contorno: [[0, 0], [400, 0], [400, 300], [200, 300], [0, 300]] }]);
    assert.throws(() => N.moverTabique(e, 's', 2, 50), /sigue en línea/);
  });
  test('T5: lo que se queda fuera de su pared se nombra', () => {
    const e = casa([{ id: 's', nombre: 'Salón', contorno: rect(0, 0, 400, 300), huecos: [{ id: 'v1', tipo: 'ventana', muro: 0, desde: 300, ancho: 80 }] }]);
    assert.throws(() => N.moverTabique(e, 's', 1, -40), /La ventana «v1» de «Salón» se quedaría fuera de la pared 1/);
  });
});

describe('CLI y lote', () => {
  test('planta agregar|editar|quitar y tabique mover', () => {
    const f = join(dir, 'casa.espacio.json');
    assert.equal(cli('nuevo', f, '--ancho', '400', '--largo', '300').status, 0);
    const pb = JSON.parse(readFileSync(f, 'utf8')).plantas[0].id;
    let r = cli('planta', 'agregar', f, '--copiar-de', pb, '--id', 'p1', '--nombre', 'Primera');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /añadida la planta p1 a nivel/);
    r = cli('planta', 'editar', f, '--id', 'p1', '--nivel', '300');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).plantas[1].nivel, 300);
    const est = JSON.parse(readFileSync(f, 'utf8')).plantas[1].estancias[0].id;
    r = cli('tabique', 'mover', f, '--estancia', est, '--muro', '1', '--distancia', '25');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no da a otra estancia/);
    r = cli('planta', 'quitar', f, '--id', 'p1');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /quitada la planta p1 con 1 estancias/);
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).plantas.length, 1);
  });

  test('C1 y C2: plano y describir de una planta muestran sus avisos de niveles; resumen da el id de la única planta', () => {
    const e = N.agregarPlanta(piso(), { id: 'p1', copiarDe: 'pb', nivel: 100 }).espacio;
    assert.match(N.planoTexto(e, { planta: 'p1' }), /los pisos se pisan/);
    assert.ok(N.describir(e, 'p1').incidencias.some((i) => i.regla === 'niveles'));
    assert.match(N.planoTexto(e), /tiene 2 plantas \(pb, p1\)/);
    const f = join(dir, 'una.espacio.json');
    assert.equal(cli('nuevo', f, '--ancho', '300', '--largo', '300').status, 0);
    assert.match(cli('resumen', f).stdout, /para «planta agregar --copiar-de /);
  });

  test('menores: nombre libre, nombre vacío y sufijos de copias', () => {
    let e = N.agregarPlanta(piso(), { copiarDe: 'pb' }).espacio;
    e = N.agregarPlanta(e, { copiarDe: 'planta-1' }).espacio;
    assert.ok(N.planta(e, 'planta-2').estancias.some((s) => s.id === 'salon-planta-2'), 'copia de una copia sin sufijos acumulados');
    e = N.quitarPlanta(e, 'planta-1').espacio;
    const nombres = N.agregarPlanta(e, { copiarDe: 'pb' }).espacio.plantas.map((p) => p.nombre);
    assert.equal(new Set(nombres).size, nombres.length, nombres.join());
    assert.throws(() => N.editarPlanta(e, 'planta-2', { nombre: '  ' }), /no puede estar vacío/);
  });

  test('lote: planta con rectángulo y tabique', () => {
    const r = N.ejecutarLote(piso(), [
      { op: 'planta-agregar', id: 'p1', x: 0, y: 0, ancho: 400, largo: 300 },
      { op: 'tabique-mover', estancia: 'salon', muro: 1, distancia: -20 },
    ]);
    assert.equal(N.planta(r.espacio, 'p1').estancias.length, 1);
    assert.deepEqual(S(r.espacio, 'dorm').contorno, rect(390, 0, 710, 300));
    assert.match(r.notas[1], /con la pared 3 de dorm/);
  });
});

// Revisión independiente de 4504034 (12/11/2026).
describe('revisión independiente: mensajes de tabique-mover', () => {
  const dos = (b) => N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [{ id: 'pb', estancias: [
    { id: 'salon', nombre: 'Salón', contorno: [[0, 0], [300, 0], [300, 300], [0, 300]], altura: 250, huecos: [{ id: 'v', tipo: 'ventana', muro: 0, desde: 200, ancho: 90 }] },
    { id: 'otra', nombre: 'Otra', contorno: b, altura: 250, huecos: [] },
  ], muebles: [] }] });
  test('9: los errores dicen el muro como la operación (base 0)', () => {
    const e = dos([[310, 0], [600, 0], [600, 300], [310, 300]]);
    assert.throws(() => N.moverTabique(e, 'salon', 3, -250), /\(muro 0\)/);
  });
  test('10: con paredes que sólo se solapan en parte no manda de una a otra', () => {
    const e = dos([[310, 150], [600, 150], [600, 450], [310, 450]]);
    for (const [est, muro] of [['salon', 1], ['otra', 3]]) {
      assert.throws(() => N.moverTabique(e, est, muro, 10), (err) => /sólo se solapan en parte/.test(err.message) && !/mueve el tabique desde/.test(err.message), `${est}`);
    }
  });
});
