// R2-4: habitación real. Elementos de obra (exento, adosado, punto y viga), techo inclinado (faldones),
// su análisis, su validación y que acompañen a su muro cuando cambia el contorno.
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
const dir = mkdtempSync(join(tmpdir(), 'espacios3d-r24-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const caja = (id, x, y, ancho = 50, fondo = 50, extra = {}) => ({ id, tipo: 'caja', ancho, fondo, alto: 80, x, y, ...extra });
const sala = (elementos = [], muebles = [], extra = {}) =>
  N.validarOLanzar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', estancias: [{ id: 's', contorno: rect(0, 0, 400, 300), elementos, ...extra }], muebles }] });
const reglas = (e) => N.analizar(e).map((i) => `${i.gravedad}:${i.regla}:${i.muebles.join('+')}`).sort();

describe('validación de elementos y faldones', () => {
  test('valores por defecto, tipo por forma y alto opcional (hasta el techo)', () => {
    const e = sala([
      { id: 'c1', forma: 'exento', x: 200, y: 150, ancho: 30, redondo: true },
      { id: 'r1', forma: 'adosado', tipo: 'radiador', muro: 0, desde: 100, ancho: 80, fondo: 10, alto: 60, elevacion: 15 },
      { id: 'e1', forma: 'punto', muro: 2, desde: 50 },
      { id: 'v1', forma: 'viga', de: [0, 150], a: [400, 150] },
    ]);
    const el = Object.fromEntries(N.estancia(e).estancia.elementos.map((x) => [x.id, x]));
    assert.deepEqual([el.c1.tipo, el.c1.fondo, el.c1.alto], ['columna', 30, undefined]);
    assert.deepEqual([el.e1.tipo, el.e1.altura], ['enchufe', 30]);
    assert.deepEqual([el.v1.ancho, el.v1.canto], [20, 25]);
    assert.ok(N.validar(JSON.parse(N.aJSON(e))).ok, 'ida y vuelta');
  });
  test('errores: forma desconocida, muro inexistente, tramo que no cabe, faldón repetido, ids repetidos', () => {
    const v = (elementos, extra = {}) => N.validar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', estancias: [{ id: 's', contorno: rect(0, 0, 400, 300), elementos, ...extra }] }] });
    assert.match(v([{ id: 'x', forma: 'cubo' }]).errores.join(), /exento, adosado, punto o viga/);
    assert.match(v([{ id: 'x', forma: 'adosado', muro: 7, desde: 0, ancho: 10, fondo: 10 }]).errores.join(), /no existe el muro 7/);
    assert.match(v([{ id: 'x', forma: 'adosado', muro: 1, desde: 250, ancho: 80, fondo: 10 }]).errores.join(), /no cabe en el muro 1/);
    assert.match(v([], { faldones: [{ muro: 0, alturaEnMuro: 100, alcance: 100 }, { muro: 0, alturaEnMuro: 120, alcance: 100 }] }).errores.join(), /ya hay un faldón/);
    assert.match(v([{ id: 's', forma: 'exento', x: 1, y: 1, ancho: 10 }]).errores.join(), /repetido/);
    assert.match(v([{ id: 'x', forma: 'exento', x: 1, y: 1, ancho: 10, alto: 300 }]).errores.join(), /alto/);
  });
});

describe('análisis con elementos', () => {
  test('una columna en medio: un mueble encima es un error; al lado, nada', () => {
    const c = { id: 'c1', forma: 'exento', x: 200, y: 150, ancho: 30, redondo: true };
    assert.deepEqual(reglas(sala([c], [caja('m', 200, 150)])), ['error:elemento:m']);
    assert.deepEqual(reglas(sala([c], [caja('m', 100, 150)])), []);
  });
  test('una columna baja (alto 90): un estante colgado encima no choca', () => {
    const c = { id: 'c1', forma: 'exento', x: 200, y: 150, ancho: 30, alto: 90 };
    assert.deepEqual(reglas(sala([c], [caja('m', 200, 150, 50, 50, { elevacion: 120 })])), []);
  });
  test('radiador: encima es error; a menos de 10 cm delante, aviso', () => {
    const r = { id: 'r1', forma: 'adosado', tipo: 'radiador', muro: 0, desde: 100, ancho: 80, fondo: 10, alto: 60, elevacion: 15 };
    assert.deepEqual(reglas(sala([r], [caja('m', 140, 20, 60, 30)])), ['error:elemento:m']);
    assert.deepEqual(reglas(sala([r], [caja('m', 140, 25, 60, 20)])), ['aviso:elemento:m']);
    assert.deepEqual(reglas(sala([r], [caja('m', 140, 60, 60, 30)])), []);
  });
  test('enchufe tapado por un mueble pegado a la pared y más alto que él', () => {
    const en = { id: 'e1', forma: 'punto', muro: 0, desde: 200, altura: 30 };
    assert.deepEqual(reglas(sala([en], [caja('m', 200, 25)])), ['aviso:elemento:m']);
    assert.deepEqual(reglas(sala([en], [caja('m', 200, 25, 50, 50, { alto: 20 })])), [], 'más bajo que el enchufe');
    assert.deepEqual(reglas(sala([en], [caja('m', 300, 25)])), [], 'lejos del enchufe');
  });
  test('viga a 225 cm (canto 25): un armario de 200 pasa por debajo; uno de 240, no', () => {
    const v = { id: 'v1', forma: 'viga', de: [0, 150], a: [400, 150] };
    assert.deepEqual(reglas(sala([v], [caja('a', 200, 150, 100, 60, { alto: 200 })])), []);
    assert.deepEqual(reglas(sala([v], [caja('a', 200, 150, 100, 60, { alto: 240 })])), ['error:elemento:a']);
  });
  test('escalón: apoyado entero, nada; a medias, aviso', () => {
    const s = { id: 'esc', tipo: 'escalon', forma: 'exento', x: 200, y: 150, ancho: 100, fondo: 100, alto: 15 };
    assert.deepEqual(reglas(sala([s], [caja('m', 200, 150)])), []);
    assert.deepEqual(reglas(sala([s], [caja('m', 250, 150)])), ['aviso:elemento:m']);
  });
});

describe('techo inclinado (faldones)', () => {
  const buhardilla = (muebles) => sala([], muebles, { faldones: [{ muro: 0, alturaEnMuro: 100, alcance: 200 }] });
  test('la altura del techo baja hacia el muro del faldón', () => {
    const est = N.estancia(buhardilla([])).estancia;
    assert.equal(N.alturaTecho(est, [200, 0]), 100);
    assert.equal(N.alturaTecho(est, [200, 100]), 175);
    assert.equal(N.alturaTecho(est, [200, 250]), 250);
  });
  test('un armario de 200 cabe en el centro y no junto al muro bajo', () => {
    assert.deepEqual(reglas(buhardilla([caja('a', 200, 250, 100, 60, { alto: 200 })])), []);
    assert.deepEqual(reglas(buhardilla([caja('a', 200, 40, 100, 60, { alto: 200 })])), ['error:altura:a']);
  });
});

describe('elementos y faldones siguen a su muro', () => {
  const conTodo = () =>
    sala([{ id: 'r1', forma: 'adosado', tipo: 'radiador', muro: 0, desde: 250, ancho: 80, fondo: 10 }, { id: 'e1', forma: 'punto', muro: 1, desde: 100 }], [], {
      faldones: [{ muro: 0, alturaEnMuro: 120, alcance: 150 }],
    });
  test('insertar una esquina en el muro 0 antes del radiador: pasa al muro nuevo y el faldón sigue en los dos trozos', () => {
    const e = N.insertarVertice(conTodo(), 0, 100);
    const s = N.estancia(e).estancia;
    const r1 = s.elementos.find((x) => x.id === 'r1');
    const e1 = s.elementos.find((x) => x.id === 'e1');
    assert.deepEqual([r1.muro, r1.desde, e1.muro], [1, 150, 2]);
    assert.deepEqual(s.faldones.map((f) => f.muro), [0, 1]);
    const vuelta = N.estancia(N.quitarVertice(e, 1)).estancia;
    assert.deepEqual([vuelta.elementos[0].muro, vuelta.elementos[0].desde, vuelta.faldones.length], [0, 250, 1]);
  });
  test('cambiar el contorno con otro número de paredes recoloca elementos y faldones (reanclar)', () => {
    const e = N.cambiarContorno(conTodo(), [[0, 0], [200, 0], [400, 0], [400, 300], [0, 300]]);
    const s = N.estancia(e).estancia;
    assert.deepEqual(s.elementos.map((x) => [x.id, x.muro, x.desde]), [['r1', 1, 50], ['e1', 2, 100]]);
    assert.deepEqual(s.faldones.map((f) => f.muro), [0, 1], 'el faldón sigue en los dos trozos del muro (como al insertar una esquina)');
  });
  test('fundir con cambiarContorno dos paredes alineadas que tienen cada una su faldón deja uno (verificación independiente)', () => {
    const cinco = N.cambiarContorno(conTodo(), [[0, 0], [200, 0], [400, 0], [400, 300], [0, 300]]);
    const e = N.cambiarContorno(cinco, rect(0, 0, 400, 300));
    assert.deepEqual(N.estancia(e).estancia.faldones.map((f) => [f.muro, f.alturaEnMuro]), [[0, 120]]);
  });
});

describe('CLI de elementos y faldones', () => {
  test('elemento agregar|editar|quitar y faldon poner|quitar', () => {
    const f = join(dir, 'obra.espacio.json');
    assert.equal(cli('nuevo', f, '--ancho', '400', '--largo', '300').status, 0);
    assert.equal(cli('elemento', 'agregar', f, '--forma', 'exento', '--id', 'c1', '--x', '200', '--y', '150', '--ancho', '30', '--redondo', 'true').status, 0);
    assert.equal(cli('elemento', 'agregar', f, '--forma', 'adosado', '--tipo', 'radiador', '--muro', '0', '--desde', '100', '--ancho', '80', '--fondo', '10', '--alto', '60', '--elevacion', '15').status, 0);
    assert.equal(cli('elemento', 'agregar', f, '--forma', 'viga', '--de', '0,150', '--a', '400,150').status, 0);
    assert.equal(cli('elemento', 'editar', f, '--id', 'c1', '--x', '220').status, 0);
    assert.equal(cli('faldon', 'poner', f, '--muro', '0', '--altura-en-muro', '120', '--alcance', '200').status, 0);
    let s = JSON.parse(readFileSync(f, 'utf8')).plantas[0].estancias[0];
    assert.deepEqual(s.elementos.map((x) => x.id), ['c1', 'radiador', 'viga']);
    assert.equal(s.elementos[0].x, 220);
    assert.deepEqual(s.faldones, [{ muro: 0, alturaEnMuro: 120, alcance: 200 }]);
    assert.equal(cli('elemento', 'quitar', f, '--id', 'viga').status, 0);
    assert.equal(cli('faldon', 'quitar', f, '--muro', '0').status, 0);
    s = JSON.parse(readFileSync(f, 'utf8')).plantas[0].estancias[0];
    assert.deepEqual([s.elementos.length, s.faldones], [2, undefined]);
    assert.match(cli('elemento', 'agregar', f, '--forma', 'cubo').stderr, /exento \(en medio\)/);
  });
});

describe('dibujo y exportación de la obra', () => {
  const conObra = () =>
    sala(
      [
        { id: 'c1', forma: 'exento', x: 200, y: 150, ancho: 40, redondo: true },
        { id: 'r1', forma: 'adosado', tipo: 'radiador', muro: 0, desde: 100, ancho: 80, fondo: 10, alto: 60, elevacion: 15 },
        { id: 'e1', forma: 'punto', muro: 2, desde: 50 },
        { id: 'v1', forma: 'viga', de: [0, 250], a: [400, 250] },
      ],
      [],
      { faldones: [{ muro: 0, alturaEnMuro: 120, alcance: 100 }] },
    );
  test('plano de texto: «%» donde hay obra y una línea por elemento y por faldón', () => {
    const t = N.planoTexto(conObra());
    assert.match(t, /%/);
    assert.match(t, /% obra/);
    assert.match(t, /columna c1: redondo de 40 cm en \(200, 150\), hasta el techo/);
    assert.match(t, /radiador r1: muro 0, desde 100 cm/);
    assert.match(t, /techo inclinado: junto al muro 0 a 120 cm/);
  });
  test('SVG: huellas de la obra, el enchufe y la línea del techo inclinado', () => {
    const s = N.planoSVG(conObra());
    assert.match(s, /<title>columna c1/);
    assert.match(s, /<circle [^>]*fill="#d48a00"/);
    assert.match(s, /stroke-dasharray="6 4"><title>viga v1/);
    assert.match(s, /techo inclinado: 120 cm junto al muro 0/);
  });
  test('PNG: la columna se pinta en piedra en su sitio', () => {
    const r = N.planoPng(conObra(), { pxPorCm: 1 });
    const i = (Math.floor(150 - r.origen[1]) * r.lienzo.ancho + Math.floor(200 - r.origen[0])) * 4;
    assert.deepEqual([...r.lienzo.rgba.subarray(i, i + 3)], [0x8d, 0x93, 0x9a]);
  });
  test('describir: elementos con su frase y faldones; el suelo libre descuenta la obra', () => {
    const d = N.describir(conObra()).plantas[0].estancias[0];
    assert.deepEqual(d.elementos.map((x) => x.id), ['c1', 'r1', 'e1', 'v1']);
    assert.match(d.elementos[0].descripcion, /columna c1/);
    assert.deepEqual(d.faldones, [{ muro: 0, alturaEnMuro: 120, alcance: 100 }]);
    assert.ok(d.sueloLibre_m2 < d.area_m2);
  });
  test('.glb: un nodo por elemento, con su tipo, y glTF válido', async () => {
    const { createRequire } = await import('node:module');
    const validador = createRequire(import.meta.url)('gltf-validator');
    const bytes = N.espacioAGLB(conObra());
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + v.getUint32(12, true))));
    const nodos = Object.fromEntries(json.nodes.filter((n) => n.extras?.elemento).map((n) => [n.name, n.extras.tipo]));
    assert.deepEqual(nodos, { c1: 'columna', r1: 'radiador', e1: 'enchufe', v1: 'viga' });
    const informe = await validador.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
    assert.equal(informe.issues.numErrors, 0, JSON.stringify(informe.issues.messages.slice(0, 3)));
  });
});

describe('revisión independiente de R2-4 (E1–E8)', () => {
  const L = [[0, 0], [400, 0], [400, 150], [200, 150], [200, 300], [0, 300]];
  const enL = (faldones, elementos = [], muebles = []) =>
    N.validarOLanzar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', estancias: [{ id: 'l', contorno: L, faldones, elementos }], muebles }] });
  test('E1: el techo inclinado no forma un cono alrededor de los extremos del muro', () => {
    const est = N.estancia(enL([{ muro: 2, alturaEnMuro: 100, alcance: 150 }])).estancia;
    assert.equal(Math.round(N.alturaTecho(est, [300, 140])), 110);
    assert.equal(N.alturaTecho(est, [190, 160]), 250, 'en la otra pata, fuera del tramo del muro');
    assert.equal(N.alturaTecho(est, [100, 150]), 250, 'sobre la recta del muro pero lejos de su tramo');
  });
  test('E2: al cambiar el contorno, el faldón pasa a todos los trozos de su muro', () => {
    const e = sala([], [], { faldones: [{ muro: 0, alturaEnMuro: 120, alcance: 200 }] });
    const r = N.cambiarContorno(e, [[0, 0], [150, 0], [400, 0], [400, 300], [0, 300]]);
    const s = N.estancia(r).estancia;
    assert.deepEqual(s.faldones.map((f) => f.muro), [0, 1]);
    assert.equal(Math.round(N.alturaTecho(s, [50, 10])), Math.round(N.alturaTecho(N.estancia(e).estancia, [50, 10])));
  });
  test('E3: el tipo se compara sin tildes ni mayúsculas', () => {
    const esc = { id: 'esca', tipo: 'Escalón', forma: 'exento', x: 200, y: 150, ancho: 100, fondo: 100, alto: 15 };
    assert.deepEqual(reglas(sala([esc], [caja('m', 200, 150)])), []);
    const rad = { id: 'r', tipo: 'Radiador', forma: 'adosado', muro: 0, desde: 100, ancho: 80, fondo: 10, alto: 60, elevacion: 15 };
    assert.deepEqual(reglas(sala([rad], [caja('m', 140, 25, 60, 20)])), ['aviso:elemento:m']);
  });
  test('E4: un escritorio sobre un radiador bajo cabe por su hueco inferior', () => {
    const rad = { id: 'r', tipo: 'radiador', forma: 'adosado', muro: 0, desde: 100, ancho: 80, fondo: 10, alto: 60, elevacion: 0 };
    const esc = { id: 'esc', tipo: 'escritorio', ancho: 120, fondo: 60, alto: 75, huecoInferior: 65, x: 140, y: 30 };
    assert.deepEqual(reglas(sala([rad], [esc])), []);
  });
  test('E5: un enchufe en la esquina se queda en su pared aunque la nueva vaya al revés', () => {
    const e = sala([{ id: 'en', forma: 'punto', muro: 0, desde: 400, altura: 30 }]);
    const r = N.cambiarContorno(e, [[0, 0], [0, 300], [400, 300], [400, 0], [200, 0]]);
    const en = N.estancia(r).estancia.elementos[0];
    const [a, b] = N.muro(N.estancia(r).estancia.contorno, en.muro);
    assert.ok(a[1] === 0 && b[1] === 0, `el enchufe sigue en la pared de arriba (muro ${en.muro})`);
  });
  test('E6: textos («del radiador», «el escalón») y viga sin «de» con un error claro', () => {
    const rad = { id: 'r', tipo: 'radiador', forma: 'adosado', muro: 0, desde: 100, ancho: 80, fondo: 10, alto: 60, elevacion: 15 };
    assert.match(N.analizar(sala([rad], [caja('m', 140, 25, 60, 20)]))[0].mensaje, /delante del radiador «r»/);
    const esc = { id: 'esca', tipo: 'escalon', forma: 'exento', x: 200, y: 150, ancho: 100, fondo: 100, alto: 15 };
    assert.match(N.analizar(sala([esc], [caja('m', 250, 150)]))[0].mensaje, /el escalón «esca»/);
    assert.throws(() => N.ejecutarLote(sala(), [{ op: 'elemento-agregar', forma: 'viga', a: '400,150' }]), /necesita «de» y «a»/);
  });
  test('E7: obra fuera de su estancia (aviso), delante de una puerta (error) y que se sale por el techo (inválida)', () => {
    assert.ok(N.analizar(sala([{ id: 'c', forma: 'exento', x: 1000, y: 1000, ancho: 30 }])).some((i) => /fuera de su estancia/.test(i.mensaje)));
    const conPuerta = N.validarOLanzar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', estancias: [{ id: 's', contorno: rect(0, 0, 400, 300), huecos: [{ id: 'p', tipo: 'puerta', muro: 0, desde: 100, ancho: 80 }], elementos: [{ id: 'c', forma: 'exento', x: 140, y: 40, ancho: 30 }] }] }] });
    assert.ok(N.analizar(conPuerta).some((i) => i.gravedad === 'error' && /tapa el paso de «p»/.test(i.mensaje)));
    assert.match(N.validar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', estancias: [{ id: 's', contorno: rect(0, 0, 400, 300), elementos: [{ id: 'c', forma: 'exento', x: 1, y: 1, ancho: 10, elevacion: 200, alto: 100 }] }] }] }).errores.join(), /supera la altura/);
  });
  test('E8: resumen enseña elementos y faldones', () => {
    const f = join(dir, 'resumen-obra.espacio.json');
    cli('nuevo', f, '--ancho', '400', '--largo', '300');
    cli('elemento', 'agregar', f, '--forma', 'exento', '--id', 'c1', '--x', '200', '--y', '150', '--ancho', '30');
    cli('faldon', 'poner', f, '--muro', '0', '--altura-en-muro', '120', '--alcance', '200');
    const r = JSON.parse(cli('resumen', f, '--json').stdout).plantas[0].estancias[0];
    assert.deepEqual([r.elementos.map((x) => x.id), r.faldones.length], [['c1'], 1]);
    assert.match(cli('resumen', f).stdout, /columna c1: 30x30 cm/);
  });
});

describe('revisión del dibujo de R2-4 (G1, G7) y restos', () => {
  test('G1: sin «alto», la elevación tiene que quedar por debajo del techo (y exportar no se rompe)', () => {
    assert.match(N.validar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', estancias: [{ id: 's', contorno: rect(0, 0, 400, 300), elementos: [{ id: 'c', forma: 'exento', x: 100, y: 100, ancho: 30, elevacion: 250 }] }] }] }).errores.join(), /elevacion: debe ser menor que la altura/);
    assert.ok(N.espacioAGLB(sala([{ id: 'c', forma: 'exento', x: 100, y: 100, ancho: 30, elevacion: 240 }])).length > 0);
  });
  test('G7: el escalón con tilde se pinta claro y no descuenta suelo libre', () => {
    const e = sala([{ id: 'esca', tipo: 'Escalón', forma: 'exento', x: 200, y: 150, ancho: 200, fondo: 300, alto: 15 }]);
    assert.match(N.planoSVG(e), /fill="#c9c2b6"/);
    const d = N.describir(e).plantas[0].estancias[0];
    assert.equal(d.sueloLibre_m2, d.area_m2);
  });
  test('resto de E2: una pared nueva que contiene a la vieja hereda su faldón', () => {
    const e = sala([], [], { faldones: [{ muro: 0, alturaEnMuro: 120, alcance: 200 }] });
    const largo = N.cambiarContorno(e, [[-100, 0], [400, 0], [400, 300], [0, 300], [0, 100], [-100, 100]]);
    assert.deepEqual(N.estancia(largo).estancia.faldones.map((f) => f.muro), [0]);
  });
  test('una puerta más alta que el techo inclinado sobre ella da un aviso', () => {
    const e = N.validarOLanzar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', estancias: [{ id: 's', contorno: rect(0, 0, 400, 300), huecos: [{ id: 'p', tipo: 'puerta', muro: 0, desde: 100, ancho: 80 }], faldones: [{ muro: 0, alturaEnMuro: 120, alcance: 200 }] }] }] });
    assert.ok(N.analizar(e).some((i) => i.regla === 'hueco' && /techo inclinado está a 121/.test(i.mensaje)), JSON.stringify(N.analizar(e)));
  });
});
