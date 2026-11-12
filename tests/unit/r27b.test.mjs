// R2-7, paso b: escaleras recta, en L y de dos tramos (U): geometría, validación, análisis en las
// dos plantas, operaciones, .glb y recorrido que sube y baja.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const validador = createRequire(import.meta.url)('gltf-validator');
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const caja = (pts) => {
  const xs = pts.flat().map((p) => p[0]);
  const ys = pts.flat().map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 1e6) / 1e6);
};

/** Casa de dos plantas (pb a 0, p1 a 280) con una escalera en la planta baja. */
function casa(escalera, { abajo = rect(0, 0, 600, 460), arriba = rect(0, 0, 600, 700), muebles = [], mueblesArriba = [] } = {}) {
  return N.validarOLanzar({
    formato: 'espacios3d', version: 2, nombre: 'Casa',
    plantas: [
      { id: 'pb', nivel: 0, estancias: [{ id: 'salon', contorno: abajo, altura: 250 }], muebles, ...(escalera ? { escaleras: [escalera] } : {}) },
      { id: 'p1', nivel: 280, estancias: [{ id: 'arriba', contorno: arriba, altura: 250 }], muebles: mueblesArriba },
    ],
  });
}
// 16 peldaños de 17,5 cm y huellas de 22,5: cómoda. La llegada (y = 460) cae sobre la pared de abajo.
const recta = (extra = {}) => ({ id: 'esc', x: 500, y: 100, ancho: 90, largo: 360, hasta: 'p1', ...extra });

describe('geometría', () => {
  test('recta con giro 0: sube hacia +y desde el pie; con giro 90, hacia −x', () => {
    const g = N.geometriaEscalera({ id: 'e', forma: 'recta', x: 300, y: 100, ancho: 90, largo: 300, giro: 0, hasta: 'p1' }, 280);
    assert.deepEqual(caja(g.huella), [255, 100, 345, 400]);
    assert.deepEqual(g.pie.map((p) => p[1]), [100, 100]);
    assert.deepEqual(g.llegada.map((p) => p[1]), [400, 400]);
    assert.equal(g.peldanos, 16);
    assert.ok(cerca(N.alturaEnEscalera(g, [300, 250]), 140));
    const g90 = N.geometriaEscalera({ id: 'e', forma: 'recta', x: 300, y: 100, ancho: 90, largo: 300, giro: 90, hasta: 'p1' }, 280);
    assert.deepEqual(caja(g90.huella), [0, 55, 300, 145]);
  });

  test('«gira» es la mano de quien sube: L con giro 0 y «derecha» tiene el tramo 2 en x menores (revisión, E1)', () => {
    const base = { id: 'e', forma: 'L', x: 300, y: 100, ancho: 90, giro: 0, hasta: 'p1', tramos: [200, 150] };
    const der = N.geometriaEscalera({ ...base, gira: 'derecha' }, 280);
    assert.ok(Math.max(...der.tramos[1].rect.map((p) => p[0])) <= Math.min(...der.tramos[0].rect.map((p) => p[0])) + 1e-6);
    assert.deepEqual(caja(der.huella), [105, 100, 345, 390]);
    assert.deepEqual(caja([der.llegada]), [105, 300, 105, 390]);
    const izq = N.geometriaEscalera({ ...base, gira: 'izquierda' }, 280);
    assert.deepEqual(caja(izq.huella), [255, 100, 495, 390]);
    // Meseta a la cota del final del tramo 1.
    const [n1] = N.repartirPeldanos(der.peldanos, 200, 150);
    assert.ok(cerca(N.alturaEnEscalera(der, [300, 345]), (n1 * 280) / der.peldanos));
  });

  test('U: pie y llegada en el mismo lado, ojo que no se pisa y barrera entre tramos', () => {
    const g = N.geometriaEscalera({ id: 'e', forma: 'U', x: 300, y: 100, ancho: 90, giro: 0, hasta: 'p1', tramos: [200, 200], gira: 'derecha', ojo: 10 }, 280);
    assert.deepEqual(caja([g.llegada]), [155, 100, 245, 100]);
    assert.deepEqual(caja(g.huella), [155, 100, 345, 390]);
    assert.ok(N.enHuella(g, [250, 200]) && !N.sobreEscalera(g, [250, 200]), 'el ojo es huella (hueco arriba) pero no se pisa');
    assert.ok(g.barandillas.some(([a, b]) => cerca(a[0], 255) && cerca(b[0], 255)), 'barrera en el lado interior del tramo 1');
    assert.ok(cerca(N.alturaEnEscalera(g, [200, 101]), 280, 3), 'al final del tramo 2 se llega arriba');
  });

  test('reparto de peldaños: al menos uno por tramo', () => {
    assert.deepEqual(N.repartirPeldanos(15, 300, 10), [14, 1]);
    assert.deepEqual(N.repartirPeldanos(16, 200, 200), [8, 8]);
  });
});

describe('validación y análisis', () => {
  test('destino: que exista, que esté encima y que sea la planta inmediatamente superior', () => {
    const v = (esc, plantasExtra = []) => N.validar({ formato: 'espacios3d', version: 2, plantas: [
      { id: 'pb', nivel: 0, estancias: [{ id: 's', contorno: rect(0, 0, 600, 400) }], escaleras: [esc] },
      { id: 'p1', nivel: 280, estancias: [{ id: 't', contorno: rect(0, 0, 600, 400) }] }, ...plantasExtra] });
    assert.match(v(recta({ hasta: 'nada' })).errores.join(), /no existe la planta «nada»/);
    assert.match(v(recta({ hasta: 'pb' })).errores.join(), /no está por encima/);
    assert.match(v(recta(), [{ id: 'medio', nivel: 140, estancias: [{ id: 'm', contorno: rect(0, 0, 10, 10) }] }]).errores.join(), /inmediatamente superior/);
    assert.match(v(recta({ ancho: 50 })).errores.join(), /al menos 60 cm/);
    assert.match(v({ ...recta(), largo: undefined, forma: 'L', tramos: [200, 100], peldanos: 1 }).errores.join(), /al menos 2 contrahuellas/);
    assert.match(v(recta({ gira: 'derecha' })).errores.join(), /sólo va en las escaleras «L» y «U»/);
    assert.ok(v(recta()).ok);
  });

  test('sin incidencias si está bien puesta; muebles encima o sobre el hueco, y pasos tapados, son error', () => {
    const reglas = (e) => N.analizar(e).filter((i) => i.regla === 'escalera');
    assert.deepEqual(reglas(casa(recta())), []);
    const mueble = (id, x, y) => ({ id, tipo: 'caja', ancho: 50, fondo: 50, alto: 50, x, y });
    let r = reglas(casa(recta(), { muebles: [mueble('m1', 500, 200)] }));
    assert.ok(r.some((i) => i.gravedad === 'error' && /muebles encima/.test(i.mensaje) && i.planta === 'pb'));
    r = reglas(casa(recta(), { mueblesArriba: [mueble('m2', 500, 250)] }));
    assert.ok(r.some((i) => /sobre el hueco/.test(i.mensaje) && i.planta === 'p1'));
    r = reglas(casa(recta(), { muebles: [mueble('m3', 500, 70)] }));
    assert.ok(r.some((i) => /delante del pie está tapado/.test(i.mensaje)));
    r = reglas(casa(recta({ y: 20 })));
    assert.ok(r.some((i) => /arranca contra una pared/.test(i.mensaje)));
  });

  test('el hueco tiene que caer en una estancia de arriba; avisos de escalera empinada', () => {
    // Arriba, dos estancias separadas justo por donde cae el hueco.
    const e = N.validarOLanzar({ formato: 'espacios3d', version: 2, plantas: [
      { id: 'pb', nivel: 0, estancias: [{ id: 'salon', contorno: rect(0, 0, 600, 600) }], escaleras: [recta()] },
      { id: 'p1', nivel: 280, estancias: [{ id: 'a', contorno: rect(0, 0, 600, 250) }, { id: 'b', contorno: rect(0, 260, 600, 700) }] }] });
    assert.ok(N.analizar(e).some((i) => /no cae entero en el suelo de una estancia/.test(i.mensaje)));
    const corta = N.analizar(casa(recta({ largo: 150 })));
    assert.ok(corta.some((i) => i.gravedad === 'aviso' && /muy empinada/.test(i.mensaje)));
    const pocos = N.analizar(casa(recta({ peldanos: 10 })));
    assert.ok(pocos.some((i) => /contrahuellas de 28 cm/.test(i.mensaje)));
  });
});

describe('operaciones', () => {
  test('agregar con destino por defecto, cambiar de forma, quitar; quitar la planta de arriba se lleva la escalera', () => {
    let e = casa(null);
    const r = N.agregarEscalera(e, { x: 500, y: 100, ancho: 90, largo: 300 }, 'pb');
    e = r.espacio;
    assert.equal(N.planta(e, 'pb').escaleras[0].hasta, 'p1');
    e = N.editarEscalera(e, r.id, { forma: 'L', tramos: [150, 150] });
    const esc = N.planta(e, 'pb').escaleras[0];
    assert.deepEqual([esc.forma, esc.largo, esc.gira], ['L', undefined, 'derecha']);
    assert.throws(() => N.agregarEscalera(casa(null), { x: 1, y: 1, ancho: 90, largo: 300 }, 'p1'), /No hay ninguna planta encima/);
    const q = N.quitarPlanta(e, 'p1');
    assert.equal(q.quitado.escaleras, 1);
    assert.equal(N.planta(q.espacio, 'pb').escaleras, undefined);
    assert.equal(N.planta(N.quitarEscalera(e, r.id), 'pb').escaleras, undefined);
  });

  test('lote: escalera-agregar en U', () => {
    const r = N.ejecutarLote(casa(null), [{ op: 'escalera-agregar', planta: 'pb', id: 'u', forma: 'U', x: 400, y: 100, ancho: 90, tramos: [200, 200], gira: 'izquierda', ojo: 10 }]);
    assert.equal(N.planta(r.espacio, 'pb').escaleras[0].forma, 'U');
    assert.throws(() => N.ejecutarLote(casa(null), [{ op: 'escalera-agregar', planta: 'pb', x: 1, y: 1, ancho: 90, tramos: [1] }]), /tramos/);
  });
});

describe('.glb', () => {
  test('peldaños abajo, hueco restado del suelo de arriba y glTF válido', async () => {
    const bytes = N.espacioAGLB(casa(recta()));
    const informe = await validador.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
    assert.equal(informe.issues.numErrors, 0, JSON.stringify(informe.issues.messages.slice(0, 3)));
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
    const nombres = json.nodes.map((n) => n.name);
    assert.ok(nombres.includes('escalera-esc') && nombres.includes('hueco-esc'));
    // Suelo de arriba: 600 × 700 menos el hueco. Desde R3-1 el hueco es sólo la parte sin 200 cm
    // libres bajo el techo de abajo (250): la rampa pasa de 50 cm a 50/280 del largo de 360.
    const suelo = N.sueloConHuecos(rect(0, 0, 600, 700), N.huecosDePlanta(casa(recta()), 'p1'));
    assert.ok(cerca(N.areaTotal(suelo), 600 * 700 - 90 * (360 - (360 * 50) / 280), 1));
  });
});

describe('recorrido por la escalera', () => {
  // Andar en línea recta con pasos de 10 cm, con la colisión y el cambio de planta del núcleo.
  function andar(e, estado, pos, dir, pasos) {
    let p = pos;
    let s = estado;
    let maxZ = -Infinity;
    for (let i = 0; i < pasos; i++) {
      p = N.moverConColision(p, [dir[0] * 10, dir[1] * 10], N.obstaculosEn(e, s));
      s = N.pasoEscaleras(e, s, p);
      maxZ = Math.max(maxZ, N.cotaSuelo(e, s, p));
    }
    return { p, s, maxZ };
  }

  test('sube por una escalera recta cuya llegada está sobre la pared de abajo (revisión, E2) y baja', () => {
    const e = casa(recta());
    let r = andar(e, { planta: 'pb', escalera: null }, [500, 50], [0, 1], 50);
    assert.equal(r.s.planta, 'p1', JSON.stringify(r));
    assert.ok(r.p[1] > 460 && r.maxZ >= 279, JSON.stringify(r));
    r = andar(e, r.s, r.p, [0, -1], 50);
    assert.equal(r.s.planta, 'pb');
    assert.ok(r.p[1] < 100);
  });

  test('desde abajo no se entra por un lado ni por la llegada (revisión, E3); arriba el hueco es barandilla', () => {
    const e = casa(recta());
    let r = andar(e, { planta: 'pb', escalera: null }, [380, 250], [1, 0], 20);
    assert.equal(r.s.escalera, null);
    assert.ok(r.p[0] < 455 - 19, `se para contra el lado (${r.p})`);
    const u = casa({ id: 'u', forma: 'U', x: 300, y: 120, ancho: 90, giro: 0, hasta: 'p1', tramos: [200, 200], gira: 'derecha', ojo: 10 });
    r = andar(u, { planta: 'pb', escalera: null }, [200, 60], [0, 1], 10);
    assert.equal(r.s.escalera, null, 'la llegada de la U, junto al pie, no deja entrar desde abajo');
    r = andar(e, { planta: 'p1', escalera: null }, [380, 250], [1, 0], 20);
    assert.equal(r.s.escalera, null, 'arriba, el lado del hueco es barandilla');
  });

  test('puntoDeSalida no cae sobre una escalera', () => {
    const e = casa(recta({ x: 300, y: 70 }));
    const pl = N.planta(e, 'pb');
    const p = N.puntoDeSalida(pl, 'salon', N.huellasEscaleras(e, 'pb'));
    const g = N.geometriaEscalera(pl.escaleras[0], 280);
    assert.ok(!N.enHuella(g, p), JSON.stringify(p));
  });
});
