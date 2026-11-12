// R3-1: escaleras de caracol, hueco real en el forjado, lo que cabe y se pasa bajo la escalera,
// escaleras una encima de otra y distribuciones al pasar de una planta a dos.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const validador = createRequire(import.meta.url)('gltf-validator');
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const GRAD = Math.PI / 180;
const areaPol = (p) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0)) / 2;
const areaUnion = (trozos) => N.union(trozos).reduce((s, pol) => s + areaPol(pol.exterior) - pol.agujeros.reduce((t, h) => t + areaPol(h), 0), 0);

/** Casa de varias plantas (a 0, 280, 560…), todas con la misma estancia y techo de 250. */
function casa(escaleras = [[]], { contorno = rect(0, 0, 600, 460), muebles = [] } = {}) {
  return N.validarOLanzar({
    formato: 'espacios3d', version: 2, nombre: 'Casa',
    plantas: escaleras.map((esc, i) => ({
      id: `p${i}`, nivel: 280 * i, estancias: [{ id: `s${i}`, contorno, altura: 250 }], muebles: i === 0 ? muebles : [],
      ...(esc.length ? { escaleras: esc } : {}),
    })),
  });
}
const caracol = (extra = {}) => ({ id: 'c', forma: 'caracol', x: 300, y: 200, ancho: 70, giro: 0, gira: 'derecha', poste: 20, hasta: 'p1', ...extra });
const reglas = (e) => N.analizar(e).filter((i) => i.regla === 'escalera');
const errores = (e) => reglas(e).filter((i) => i.gravedad === 'error');

// Andar en línea recta con pasos de 5 cm, con la colisión y el cambio de planta del núcleo.
function andarA(e, s, p, destino) {
  const d = [destino[0] - p[0], destino[1] - p[1]];
  const n = Math.max(1, Math.ceil(Math.hypot(...d) / 5));
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const antes = p;
    p = N.moverConColision(p, [d[0] / n, d[1] / n], N.obstaculosEn(e, s));
    s = N.pasoEscaleras(e, s, p, antes);
    maxZ = Math.max(maxZ, N.cotaSuelo(e, s, p));
  }
  return { s, p, maxZ };
}
function camino(e, s, p, puntos) {
  let maxZ = -Infinity;
  for (const q of puntos) {
    const r = andarA(e, s, p, q);
    s = r.s;
    p = r.p;
    maxZ = Math.max(maxZ, r.maxZ);
  }
  return { s, p, maxZ };
}

describe('caracol: geometría', () => {
  test('centro a la mano de giro, radios, pie y llegada (giros 0, 90 y 45)', () => {
    const g = N.geometriaEscalera(caracol(), 280);
    assert.deepEqual(g.caracol.centro.map((v) => Math.round(v * 1e6) / 1e6), [255, 200]);
    assert.equal(g.caracol.rPoste, 10);
    assert.equal(g.caracol.rExt, 80);
    const dist = (p) => Math.hypot(p[0] - 255, p[1] - 200);
    assert.deepEqual(g.pie.map(dist).sort((a, b) => a - b).map(Math.round), [10, 80]);
    // Una vuelta entera: la llegada cae sobre el pie.
    assert.deepEqual(g.llegada.map(dist).sort((a, b) => a - b).map(Math.round), [10, 80]);
    const izq = N.geometriaEscalera(caracol({ gira: 'izquierda' }), 280);
    assert.ok(cerca(izq.caracol.centro[0], 345) && cerca(izq.caracol.centro[1], 200));
    // Con giro 90 se sube hacia −x: la derecha de quien sube es −y.
    const g90 = N.geometriaEscalera(caracol({ giro: 90 }), 280);
    assert.ok(cerca(g90.caracol.centro[0], 300) && cerca(g90.caracol.centro[1], 155), JSON.stringify(g90.caracol.centro));
    const g45 = N.geometriaEscalera(caracol({ giro: 45 }), 280);
    const c = g45.caracol.centro;
    const v = [c[0] - 300, c[1] - 200];
    assert.ok(cerca(Math.hypot(...v), 45, 1e-9));
    assert.ok(cerca(v[0] * g45.entrada[0] + v[1] * g45.entrada[1], 0, 1e-9), 'el centro está de lado, no delante');
  });

  test('media vuelta a la derecha con giro 0: baja por el plano y acaba a la izquierda, saliendo hacia arriba', () => {
    const g = N.geometriaEscalera(caracol({ vuelta: 180 }), 280);
    const xs = g.llegada.map((p) => Math.round(p[0])).sort((a, b) => a - b);
    assert.deepEqual(xs, [175, 245]);
    assert.ok(g.llegada.every((p) => cerca(p[1], 200, 1e-6)));
    assert.ok(cerca(g.salida[0], 0, 1e-9) && cerca(g.salida[1], -1, 1e-9));
    // A un cuarto de vuelta, en la línea de huella, está a media altura y abajo en el plano (y mayor).
    assert.ok(cerca(N.alturaEnEscalera(g, [255, 245]), 140, 1e-6));
  });

  test('huella convexa con el área del círculo, cota por ángulo, peldaños por defecto y piezas', () => {
    const g = N.geometriaEscalera(caracol(), 280);
    assert.equal(g.peldanos, 13);
    assert.ok(Math.abs(areaUnion(g.huella) / (Math.PI * 80 * 80) - 1) < 0.01);
    const g270 = N.geometriaEscalera(caracol({ vuelta: 270 }), 280);
    assert.ok(Math.abs(areaUnion(g270.huella) / (Math.PI * 80 * 80 * 0.75) - 1) < 0.01);
    // Cuarto de vuelta en la línea de huella: 70 cm.
    assert.ok(cerca(N.alturaEnEscalera(g, [255, 245]), 70, 1e-6));
    assert.equal(N.alturaEnEscalera(g, [255, 200]), null, 'el poste no se pisa');
    assert.equal(N.lineasPeldanos(g).length, 12);
    const piezas = N.piezasEscalera(g);
    assert.equal(piezas.filter((p) => p.tipo === 'prisma').length, 14, '13 peldaños y el poste');
    const poste = piezas.find((p) => p.tipo === 'prisma' && p.z0 === 0 && p.z1 === 370);
    assert.ok(poste, 'poste de suelo a llegada + barandilla');
    assert.equal(N.rampasEscalera(g).length, 12);
  });

  test('validación: forma, poste, vuelta y campos de otras formas', () => {
    const mal = (x) => N.validar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [
      { id: 'p0', nivel: 0, estancias: [{ id: 's', contorno: rect(0, 0, 600, 460), altura: 250 }], muebles: [], escaleras: [x] },
      { id: 'p1', nivel: 280, estancias: [{ id: 't', contorno: rect(0, 0, 600, 460), altura: 250 }], muebles: [] }] });
    assert.ok(mal(caracol()).ok);
    assert.match(mal(caracol({ poste: 5 })).errores.join(), /poste/);
    assert.match(mal(caracol({ vuelta: 400 })).errores.join(), /vuelta/);
    assert.match(mal(caracol({ largo: 300 })).errores.join(), /no va en la caracol/);
    assert.match(mal({ id: 'r', x: 300, y: 100, ancho: 90, largo: 300, hasta: 'p1', poste: 20 }).errores.join(), /sólo va en las escaleras «caracol»/);
    assert.match(mal(caracol({ forma: 'espiral' })).errores.join(), /caracol/);
  });

  test('sin incidencias bien puesta; avisos de la caracol (huella a 30 cm del poste, contrahuella, ancho)', () => {
    assert.deepEqual(reglas(casa([[caracol()], []])), []);
    const empinada = reglas(casa([[caracol({ vuelta: 180 })], []]));
    assert.ok(empinada.some((i) => i.gravedad === 'aviso' && /a 30 cm del poste/.test(i.mensaje)), JSON.stringify(empinada));
    assert.ok(reglas(casa([[caracol({ peldanos: 10 })], []])).some((i) => /contrahuellas de 28 cm \(más de 24\)/.test(i.mensaje)));
    assert.ok(reglas(casa([[caracol({ ancho: 62 })], []])).some((i) => /menos de 66/.test(i.mensaje)));
  });

  test('.glb válido con la caracol, su hueco y colisiones', async () => {
    for (const colisiones of [undefined, 'godot']) {
      const bytes = N.espacioAGLB(casa([[caracol()], []]), 'prueba', colisiones ? { colisiones } : {});
      const informe = await validador.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
      assert.equal(informe.issues.numErrors, 0, JSON.stringify(informe.issues.messages.slice(0, 3)));
    }
  });
});

describe('hueco real en el forjado', () => {
  test('recta: sólo la parte sin 200 cm libres; techo bajo, la huella entera', () => {
    const recta = { id: 'r', forma: 'recta', x: 500, y: 100, ancho: 90, largo: 360, giro: 0, hasta: 'p1' };
    const e = casa([[recta], []]);
    const g = N.geometriaDe(e, e.plantas[0], recta);
    assert.equal(g.techo, 250);
    assert.ok(cerca(areaUnion(g.hueco), 90 * (360 - (360 * 50) / 280), 1));
    assert.ok(cerca(areaUnion(N.geometriaEscalera(recta, 280, 190).hueco), 90 * 360, 1));
  });

  test('L: el tramo 1 se corta; meseta y tramo 2 enteros', () => {
    const l = { id: 'l', forma: 'L', x: 300, y: 100, ancho: 90, giro: 0, hasta: 'p1', tramos: [200, 150], gira: 'derecha' };
    const g = N.geometriaEscalera(l, 280, 250);
    const [n1] = N.repartirPeldanos(16, 200, 150);
    const zm = (n1 * 280) / 16;
    const corte = (50 / zm) * 200;
    assert.ok(cerca(areaUnion(g.hueco), 90 * (200 - corte) + 90 * 90 + 90 * 150, 1));
  });

  test('caracol de una vuelta: el hueco empieza donde la rampa pasa de techo − 200', () => {
    const g = N.geometriaEscalera(caracol(), 280, 250);
    assert.ok(Math.abs(areaUnion(g.hueco) / (Math.PI * 80 * 80 * (1 - 50 / 280)) - 1) < 0.01);
    // Sobre los primeros peldaños hay suelo arriba.
    assert.ok(!N.enHueco(g, [300, 230]));
    assert.ok(N.enHueco(g, [210, 200]));
  });
});

describe('bajo la escalera', () => {
  const recta = { id: 'r', forma: 'recta', x: 500, y: 100, ancho: 90, largo: 360, giro: 0, hasta: 'p1' };
  test('cara inferior: macizo al principio, losa de 20 cm bajo el frente de cada peldaño', () => {
    const g = N.geometriaEscalera(recta, 280);
    assert.equal(N.bajoEscalera(g, [500, 110]), 0);
    assert.ok(cerca(N.bajoEscalera(g, [500, 100 + 22.5 * 5 + 1]), 5 * 17.5 - 20));
    assert.equal(N.bajoEscalera(g, [400, 200]), null);
    const u = N.geometriaEscalera({ id: 'u', forma: 'U', x: 300, y: 100, ancho: 90, giro: 0, hasta: 'p1', tramos: [200, 200], gira: 'derecha', ojo: 10 }, 280);
    assert.ok(cerca(N.bajoEscalera(u, [300, 340]), u.meseta.z - 20), 'meseta');
    const c = N.geometriaEscalera(caracol(), 280);
    assert.equal(N.bajoEscalera(c, [255, 200]), 0, 'poste');
    assert.ok(cerca(N.bajoEscalera(c, [255, 245]), (Math.floor(13 / 4) + 1) * (280 / 13) - 5), 'peldaño volado de 5 cm');
  });

  test('un mueble que cabe debajo no es error; uno que no cabe, sí, con las cifras', () => {
    // Peldaños 7 y 8 (desde y = 257,5): cara inferior de 102,5 cm.
    const armario = (alto) => ({ id: 'armario', tipo: 'caja', ancho: 80, fondo: 40, alto, x: 500, y: 100 + 22.5 * 7 + 21 });
    // Arriba hace falta suelo tras la llegada (y = 460): la casa tiene 700 de largo.
    const alta = { contorno: rect(0, 0, 600, 700) };
    assert.deepEqual(errores(casa([[recta], []], { ...alta, muebles: [armario(100)] })), []);
    const r = errores(casa([[recta], []], { ...alta, muebles: [armario(110)] }));
    assert.ok(r.some((i) => /muebles encima: armario \(no caben debajo: armario llega a 110 cm y debajo hay 102\.5\)/.test(i.mensaje)), JSON.stringify(r));
    // En la zona libre del pie sigue siendo error aunque sea bajo.
    assert.ok(errores(casa([[recta], []], { ...alta, muebles: [{ id: 'm', tipo: 'caja', ancho: 40, fondo: 40, alto: 10, x: 500, y: 70 }] })).some((i) => /delante del pie está tapado/.test(i.mensaje)));
  });

  test('recorrido: se pasa por debajo de la parte alta, no por la baja', () => {
    const e = casa([[recta], []]);
    // La parte alta (peldaños 13 a 15) empieza en y = 392,5.
    let r = andarA(e, { planta: 'p0', escalera: null }, [400, 430], [580, 430]);
    assert.ok(r.p[0] > 570 && r.s.escalera === null, JSON.stringify(r));
    r = andarA(e, { planta: 'p0', escalera: null }, [400, 300], [580, 300]);
    assert.ok(r.p[0] < 455 - 19, JSON.stringify(r));
  });
});

describe('caracol: recorrido', () => {
  test('se entra pasando bajo su parte alta, se sube una vuelta entera, se llega arriba y se baja', () => {
    const e = casa([[caracol()], []]);
    assert.deepEqual(errores(e), []);
    const C = [255, 200];
    const en = (grados, r = 45) => [C[0] + r * Math.cos(grados * GRAD), C[1] + r * Math.sin(grados * GRAD)];
    // Desde fuera, por debajo de los últimos peldaños, hasta el pie.
    let r = camino(e, { planta: 'p0', escalera: null }, [300, 90], [[300, 170], en(10)]);
    assert.equal(r.s.escalera, 'c', JSON.stringify(r));
    // Una vuelta entera por la línea de huella, cruzando la llegada (sobre el pie).
    const vuelta = [];
    for (let a = 20; a <= 350; a += 10) vuelta.push(en(a));
    r = camino(e, r.s, r.p, [...vuelta, en(370)]);
    assert.deepEqual(r.s, { planta: 'p1', escalera: null }, JSON.stringify(r));
    assert.ok(r.maxZ >= 270);
    assert.equal(N.cotaSuelo(e, r.s, r.p), 280);
    // Bajar: atrás por la llegada, la vuelta al revés y fuera por el pie.
    r = camino(e, r.s, r.p, [en(350), ...[...vuelta].reverse(), en(5), en(-10)]);
    assert.deepEqual(r.s, { planta: 'p0', escalera: null }, JSON.stringify(r));
    assert.equal(N.cotaSuelo(e, r.s, r.p), 0);
  });

  test('el poste es un obstáculo y desde abajo no se sube por el lado bajo', () => {
    const e = casa([[caracol()], []]);
    // Por el costado de los primeros peldaños (a 90°, fuera del círculo) no se entra.
    const r = andarA(e, { planta: 'p0', escalera: null }, [255, 330], [255, 200]);
    assert.equal(r.s.escalera, null);
    assert.ok(Math.hypot(r.p[0] - 255, r.p[1] - 200) >= 80 + 19, `se queda fuera del círculo (${r.p})`);
    const segs = N.obstaculosEn(e, { planta: 'p0', escalera: 'c' });
    const p = N.moverConColision([255, 240], [0, -40], segs);
    assert.ok(Math.hypot(p[0] - 255, p[1] - 200) >= 10 + 20 - 0.5, 'no atraviesa el poste');
  });
});

describe('escaleras una encima de otra', () => {
  // Caja de escalera: dos U iguales, una en cada planta.
  const u = (id, hasta, extra = {}) => ({ id, forma: 'U', x: 200, y: 100, ancho: 100, giro: 0, gira: 'derecha', tramos: [240, 240], hasta, ...extra });
  const tres = (extra = {}) => casa([[u('u0', 'p1')], [u('u1', 'p2', extra)], []], { contorno: rect(0, 0, 600, 700) });

  test('una caja de escalera de dos U no tiene errores', () => {
    assert.deepEqual(errores(tres()), []);
  });

  test('errores: arrancar sobre el hueco, tapar la llegada, sin altura libre y solaparse en la misma planta', () => {
    assert.ok(errores(tres({ y: 200 })).some((i) => /arranca sobre el hueco de «u0»/.test(i.mensaje)));
    const tapa = casa([[u('u0', 'p1')], [{ id: 'r1', x: 100, y: 30, ancho: 90, largo: 300, hasta: 'p2' }], []], { contorno: rect(0, 0, 600, 700) });
    assert.ok(errores(tapa).some((i) => /«r1» tapa la llegada de «u0»/.test(i.mensaje)), JSON.stringify(errores(tapa)));
    const ida = { id: 'ida', x: 200, y: 100, ancho: 90, largo: 360, hasta: 'p1' };
    const vuelta = { id: 'vuelta', x: 200, y: 600, ancho: 90, largo: 360, giro: 180, hasta: 'p2' };
    const baja = errores(casa([[ida], [vuelta], []], { contorno: rect(0, 0, 600, 700) }));
    assert.ok(baja.some((i) => /«vuelta» pasa por encima de «ida» con \d+(\.\d)? cm libres \(hacen falta 200\)/.test(i.mensaje)), JSON.stringify(baja));
    const dos = errores(casa([[ida, { ...ida, id: 'otra', x: 260 }], []], { contorno: rect(0, 0, 600, 700) }));
    assert.ok(dos.some((i) => /«ida» y «otra» se solapan|«otra» y «ida» se solapan/.test(i.mensaje)));
  });

  test('recorrido: de la planta baja a la segunda por la caja de escalera, y vuelta', () => {
    const e = tres();
    // u0: tramo 1 por x = 200 hacia +y, meseta y tramo 2 por x = 100 de vuelta; llega a y = 100.
    const subirU = [[200, 380], [100, 380], [100, 60]];
    let r = camino(e, { planta: 'p0', escalera: null }, [200, 60], subirU);
    assert.deepEqual(r.s, { planta: 'p1', escalera: null }, JSON.stringify(r));
    // En la planta 1, al pie de u1 (junto a la llegada de u0) y arriba otra vez.
    r = camino(e, r.s, r.p, [[200, 60], ...subirU]);
    assert.deepEqual(r.s, { planta: 'p2', escalera: null }, JSON.stringify(r));
    assert.ok(r.maxZ >= 559);
    // Bajar las dos.
    const bajarU = [[100, 380], [200, 380], [200, 60]];
    r = camino(e, r.s, r.p, [[100, 60], ...bajarU]);
    assert.deepEqual(r.s, { planta: 'p1', escalera: null }, JSON.stringify(r));
    r = camino(e, r.s, r.p, [[100, 60], ...bajarU]);
    assert.deepEqual(r.s, { planta: 'p0', escalera: null }, JSON.stringify(r));
  });

  test('.glb válido con escaleras apiladas', async () => {
    const informe = await validador.validateBytes(new Uint8Array(N.espacioAGLB(tres())), { maxIssues: 20 });
    assert.equal(informe.issues.numErrors, 0, JSON.stringify(informe.issues.messages.slice(0, 3)));
  });
});

describe('distribuciones al pasar a dos plantas', () => {
  test('lo guardado con una planta se sella con ella: aplicar devuelve el mueble a su planta', () => {
    let e = casa([[]], { muebles: [{ id: 'mesa', tipo: 'caja', ancho: 80, fondo: 80, alto: 75, x: 200, y: 200 }] });
    e = N.guardarDistribucion(e, 'Antes');
    assert.equal(e.distribuciones[0].posiciones.mesa.planta, undefined);
    e = N.agregarPlanta(e, { copiarDe: 'p0' }).espacio;
    assert.equal(e.distribuciones[0].posiciones.mesa.planta, 'p0');
    e = N.cambiarDePlanta(e, 'mesa', e.plantas[1].id);
    assert.equal(e.plantas[0].muebles.length, 0);
    e = N.aplicarDistribucion(e, 'Antes').espacio;
    assert.deepEqual(e.plantas.map((p) => p.muebles.map((m) => m.id)), [['mesa'], []]);
  });
});

// Revisión independiente de la ronda 3 (12/11/2026).
describe('revisión independiente: ronda 3', () => {
  const u = (id, hasta) => ({ id, forma: 'U', x: 200, y: 100, ancho: 100, giro: 0, gira: 'derecha', tramos: [240, 240], hasta });
  const caja = () => casa([[u('u0', 'p1')], [u('u1', 'p2')], []], { contorno: rect(0, 0, 600, 700) });

  test('1: en la caja de escalera no se salta de planta al entrar en diagonal junto a la barandilla central', () => {
    const e = caja();
    const pasos = [[[0, 5], [20, -8]], [[0, 5], [-20, -8]], [[0, 6], [-10, 4]], [[3, 5], [-6, -6]]];
    for (let x = 146; x <= 154; x += 1) {
      for (const seq of pasos) {
        let s = { planta: 'p1', escalera: null };
        let p = [x, 96];
        let z = N.cotaSuelo(e, s, p);
        for (const d of seq) {
          const antes = p;
          p = N.moverConColision(p, d, N.obstaculosEn(e, s));
          s = N.pasoEscaleras(e, s, p, antes);
          const z2 = N.cotaSuelo(e, s, p);
          assert.ok(Math.abs(z2 - z) <= 40, `x ${x}, ${JSON.stringify(seq)}: de ${z} a ${z2} (${JSON.stringify(s)})`);
          if (!s.escalera) assert.equal(s.planta, 'p1', `x ${x}, ${JSON.stringify(seq)}`);
          z = z2;
        }
      }
    }
  });

  test('3: las rampas de colisión dejan pasar por debajo de la parte alta', () => {
    const recta = { id: 'r', x: 500, y: 100, ancho: 90, largo: 360, hasta: 'p1' };
    const e = casa([[recta], []], { contorno: rect(0, 0, 600, 700) });
    const rampa = N.nodosColision(e, e.plantas[0], 'godot', 0).find((n) => /rampa-1/.test(n.nombre));
    const pos = rampa.malla.primitivas[0].posiciones;
    // Los vértices del final del tramo (z ≈ 4,6 m): ni la base llega al suelo.
    for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] > 4.55) assert.ok(pos[i + 1] >= 2.0, `vértice a ${pos[i + 1]} m`);
  });

  test('4: la escalera bajo un techo inclinado, abajo o al llegar arriba, avisa', () => {
    const recta = { id: 'r', forma: 'recta', x: 500, y: 100, ancho: 90, largo: 360, giro: 0, hasta: 'p1' };
    const conFaldon = (abajo, arriba) => N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [
      { id: 'p0', nivel: 0, estancias: [{ id: 's0', contorno: rect(0, 0, 600, 700), altura: 250, huecos: [], ...(abajo ? { faldones: [abajo] } : {}) }], muebles: [], escaleras: [recta] },
      { id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: rect(0, 0, 600, 700), altura: 250, huecos: [], ...(arriba ? { faldones: [arriba] } : {}) }], muebles: [] },
    ] });
    const avisa = (e) => N.analizar(e).some((i) => i.regla === 'escalera' && /techo inclinado/.test(i.mensaje));
    assert.ok(!avisa(conFaldon(null, null)));
    assert.ok(avisa(conFaldon({ muro: 1, alturaEnMuro: 100, alcance: 250 }, null)), 'abajo');
    assert.ok(avisa(conFaldon(null, { muro: 1, alturaEnMuro: 100, alcance: 250 })), 'arriba, sobre la llegada');
  });

  test('5: el techo para el hueco es el de la estancia de la escalera, no el de la del pie', () => {
    const e = N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [
      { id: 'p0', nivel: 0, estancias: [
        { id: 'a', contorno: rect(0, 0, 300, 400), altura: 220, huecos: [] },
        { id: 'b', contorno: rect(0, 400, 300, 700), altura: 250, huecos: [] },
      ], muebles: [], escaleras: [{ id: 'r', x: 150, y: 400, ancho: 90, largo: 340, giro: 180, hasta: 'p1' }] },
      { id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: rect(0, 0, 300, 700), altura: 250, huecos: [] }], muebles: [] },
    ] });
    assert.equal(N.geometriaDe(e, e.plantas[0], e.plantas[0].escaleras[0]).techo, 220);
  });

  test('6: con el techo de abajo por encima de la planta de arriba, el hueco no queda vacío', () => {
    const recta = { id: 'r', x: 500, y: 100, ancho: 90, largo: 360, hasta: 'p1' };
    const e = N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [
      { id: 'p0', nivel: 0, estancias: [{ id: 's0', contorno: rect(0, 0, 600, 700), altura: 480, huecos: [] }], muebles: [], escaleras: [recta] },
      { id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: rect(0, 0, 600, 700), altura: 250, huecos: [] }], muebles: [] },
    ] });
    assert.ok(areaUnion(N.geometriaDe(e, e.plantas[0], e.plantas[0].escaleras[0]).hueco) > 1000);
  });

  test('7: un mueble alto que muerde 1,5 cm la esquina de la meseta es error', () => {
    const uu = { id: 'u', forma: 'U', x: 300, y: 100, ancho: 90, giro: 0, gira: 'derecha', tramos: [200, 200], ojo: 10, hasta: 'p1' };
    const armario = { id: 'armario', tipo: 'caja', ancho: 60, fondo: 60, alto: 200, giro: 45, x: 345 + 28.5 / Math.SQRT2, y: 390 + 28.5 / Math.SQRT2 };
    const e = casa([[uu], []], { contorno: rect(0, 0, 600, 700), muebles: [armario] });
    assert.ok(errores(e).some((i) => /muebles encima: armario/.test(i.mensaje)), JSON.stringify(errores(e)));
  });
});

describe('revisión independiente: ronda 3 (2 y 8)', () => {
  const caracolEn = (id, t, hasta) => {
    const g = (t * Math.PI) / 180;
    return { id, forma: 'caracol', x: 255 + 45 * Math.cos(g), y: 200 + 45 * Math.sin(g), ancho: 70, giro: t, gira: 'derecha', poste: 20, hasta };
  };
  test('2: una caracol de 360° encima de otra, girada 60°, vale; idéntica, arranca sobre el hueco', () => {
    const conDos = (t) => casa([[caracolEn('c0', 0, 'p1')], [caracolEn('c1', t, 'p2')], []]);
    assert.deepEqual(errores(conDos(60)), []);
    assert.ok(errores(conDos(0)).some((i) => /arranca sobre el hueco/.test(i.mensaje)));
  });
  test('8: área del hueco de una U', () => {
    const uu = { id: 'u', forma: 'U', x: 300, y: 100, ancho: 90, giro: 0, gira: 'derecha', tramos: [200, 200], ojo: 10 };
    const g = N.geometriaEscalera({ ...uu, hasta: 'p1' }, 280, 250);
    const [n1] = N.repartirPeldanos(16, 200, 200);
    const zm = (n1 * 280) / 16;
    // Tramo 1 cortado a partir de 50 cm de cota, meseta (190 × 90), ojo y tramo 2 enteros.
    const esperado = 90 * (200 - (50 / zm) * 200) + 190 * 90 + 10 * 200 + 90 * 200;
    assert.ok(Math.abs(areaUnion(g.hueco) - esperado) < 1, `${areaUnion(g.hueco)} frente a ${esperado}`);
  });
  test('8: una caracol a izquierdas se sube y se baja', () => {
    const c = { id: 'c', forma: 'caracol', x: 300, y: 200, ancho: 70, giro: 0, gira: 'izquierda', poste: 20, hasta: 'p1' };
    const e = casa([[c], []]);
    assert.deepEqual(errores(e), []);
    const C = [345, 200];
    // A izquierdas el ángulo recorrido va en sentido antihorario en el plano: desde 180° hacia 180° − vuelta.
    const en = (grados, r = 45) => [C[0] + r * Math.cos((180 - grados) * GRAD), C[1] + r * Math.sin((180 - grados) * GRAD)];
    let r = camino(e, { planta: 'p0', escalera: null }, [290, 90], [[290, 170], en(10)]);
    assert.equal(r.s.escalera, 'c', JSON.stringify(r));
    const vuelta = [];
    for (let a = 20; a <= 350; a += 10) vuelta.push(en(a));
    r = camino(e, r.s, r.p, [...vuelta, en(370)]);
    assert.deepEqual(r.s, { planta: 'p1', escalera: null }, JSON.stringify(r));
    r = camino(e, r.s, r.p, [en(350), ...[...vuelta].reverse(), en(5), en(-10)]);
    assert.deepEqual(r.s, { planta: 'p0', escalera: null }, JSON.stringify(r));
  });
  test('8: forjado bajo la planta de arriba (y su nodo en el .glb); poste y rampas de colisión de la caracol', () => {
    const e = casa([[caracol()], []]);
    const f = N.forjadoDePlanta(e, e.plantas[1]);
    assert.ok(f && Math.abs(f.z0 + 30) < 1e-9 && f.z1 === -2, JSON.stringify(f && [f.z0, f.z1]));
    // Su planta es la huella de la estancia con los muros, menos el hueco de la caracol.
    const g = N.geometriaDe(e, e.plantas[0], e.plantas[0].escaleras[0]);
    const huella = 620 * 480 - areaUnion(g.hueco);
    assert.ok(Math.abs(N.areaTotal(f.poligonos) - huella) / huella < 0.01, `${N.areaTotal(f.poligonos)} frente a ${huella}`);
    assert.equal(N.forjadoDePlanta(e, e.plantas[0]), null);
    const bytes = N.espacioAGLB(e);
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
    assert.ok(json.nodes.some((n) => n.name === 'forjado-p1'));
    const col = N.nodosColision(e, e.plantas[0], 'godot', 0).map((n) => n.nombre);
    assert.ok(col.includes('escalera-c-poste-convcolonly'), col.join(', '));
    assert.equal(col.filter((n) => /^escalera-c-rampa-/.test(n)).length, 12);
  });
});
