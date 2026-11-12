// Paridad entre el esquema JSON de la entrega y validar(): el esquema es el contrato que leen los
// agentes; validar() es la fuente de verdad. Ambos deben coincidir en todo lo estructural.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const esquema = JSON.parse(readFileSync(join(RAIZ, 'entrega', 'esquema', 'espacio.schema.json'), 'utf8'));
// strictRequired se desactiva porque el esquema prohíbe «abre»/«bisagra» fuera de las puertas con
// not/anyOf/required, que es JSON Schema válido pero ajv lo marca en modo estricto.
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
const validarEsquema = ajv.compile(esquema);

const base = () => ({
  formato: 'espacios3d',
  version: 2,
  nombre: 'P',
  plantas: [
    {
      id: 'pb',
      grosorExterior: 10,
      estancias: [{ id: 'cuarto', contorno: [[0, 0], [400, 0], [400, 300], [0, 300]], altura: 250, huecos: [] }],
      muebles: [{ id: 'a', tipo: 'cama', ancho: 150, fondo: 200, alto: 50, x: 100, y: 100 }],
    },
  ],
});
// Accesos cortos a la primera planta y a su primera estancia.
const P = (e) => e.plantas[0];
const E = (e) => e.plantas[0].estancias[0];
const M = (e) => e.plantas[0].muebles;
const con = (f) => {
  const e = base();
  f(e);
  return e;
};

// [descripción, datos, válido]
const CORPUS = [
  ['mínimo', { formato: 'espacios3d', version: 2, plantas: [{ id: 'p', estancias: [{ id: 'e', contorno: [[0, 0], [10, 0], [10, 10]] }] }] }, true],
  ['completo', con((e) => {
    E(e).huecos = [
      { id: 'p', tipo: 'puerta', muro: 3, desde: 30, ancho: 80, abre: 'corredera', bisagra: 'fin' },
      { id: 'v', tipo: 'ventana', muro: 0, desde: 100, ancho: 100, antepecho: 95, alto: 110 },
      { id: 's', tipo: 'paso', muro: 1, desde: 10, ancho: 90 },
    ];
    M(e)[0] = { ...M(e)[0], giro: 45, elevacion: 0, color: '#AABBCC', bloqueado: true, holguraFrente: 10, huecoInferior: 0, nombre: 'Mía' };
    P(e).nombre = 'Baja';
    P(e).nivel = 0;
    E(e).nombre = 'Cuarto';
    e.distribuciones = [{ nombre: 'Una', posiciones: { a: { x: 1, y: 2, planta: 'pb' } } }];
    e.notas = 'libre';
  }), true],
  ['salida normalizada de validar()', JSON.parse(N.aJSON(N.validarOLanzar(base()))), true],
  ['sin formato', con((e) => delete e.formato), false],
  ['versión 3', con((e) => (e.version = 3)), false],
  ['mueble con piezas y modelo', con((e) => {
    M(e)[0].piezas = [{ forma: 'caja', x: 0, y: 0, z: 0, ancho: 150, fondo: 200, alto: 30 }, { forma: 'cilindro', x: 60, y: 90, z: 30, ancho: 10, alto: 20, color: '#aabbcc' }, { forma: 'cuna', y: -80, z: 30, ancho: 150, fondo: 40, alto: 20 }];
    M(e)[0].modelo = { archivo: 'modelos/cama.glb', giro: 90, ajuste: 'modelo' };
  }), true],
  ['escalera recta a la planta de encima', con((e) => {
    e.plantas.push({ id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: [[0, 0], [400, 0], [400, 400], [0, 400]] }] });
    e.plantas[0].escaleras = [{ id: 'esc', x: 100, y: 100, ancho: 90, largo: 360, hasta: 'p1' }];
  }), true],
  ['escalera en U', con((e) => {
    e.plantas.push({ id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: [[0, 0], [400, 0], [400, 400], [0, 400]] }] });
    e.plantas[0].escaleras = [{ id: 'esc', forma: 'U', x: 100, y: 100, ancho: 90, tramos: [200, 200], gira: 'izquierda', ojo: 10, hasta: 'p1' }];
  }), true],
  ['escalera recta con tramos', con((e) => {
    e.plantas.push({ id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: [[0, 0], [400, 0], [400, 400], [0, 400]] }] });
    e.plantas[0].escaleras = [{ id: 'esc', x: 100, y: 100, ancho: 90, largo: 300, tramos: [100, 100], hasta: 'p1' }];
  }), false],
  ['escalera en L sin tramos', con((e) => {
    e.plantas.push({ id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: [[0, 0], [400, 0], [400, 400], [0, 400]] }] });
    e.plantas[0].escaleras = [{ id: 'esc', forma: 'L', x: 100, y: 100, ancho: 90, hasta: 'p1' }];
  }), false],
  ['escalera estrecha', con((e) => {
    e.plantas.push({ id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: [[0, 0], [400, 0], [400, 400], [0, 400]] }] });
    e.plantas[0].escaleras = [{ id: 'esc', x: 100, y: 100, ancho: 50, largo: 360, hasta: 'p1' }];
  }), false],
  ['escalera de caracol', con((e) => {
    e.plantas.push({ id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: [[0, 0], [400, 0], [400, 400], [0, 400]] }] });
    e.plantas[0].escaleras = [{ id: 'esc', forma: 'caracol', x: 200, y: 200, ancho: 70, gira: 'izquierda', poste: 16, vuelta: 270, hasta: 'p1' }];
  }), true],
  ['caracol con largo', con((e) => {
    e.plantas.push({ id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: [[0, 0], [400, 0], [400, 400], [0, 400]] }] });
    e.plantas[0].escaleras = [{ id: 'esc', forma: 'caracol', x: 200, y: 200, ancho: 70, largo: 300, hasta: 'p1' }];
  }), false],
  ['caracol de más de una vuelta', con((e) => {
    e.plantas.push({ id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: [[0, 0], [400, 0], [400, 400], [0, 400]] }] });
    e.plantas[0].escaleras = [{ id: 'esc', forma: 'caracol', x: 200, y: 200, ancho: 70, vuelta: 400, hasta: 'p1' }];
  }), false],
  ['recta con poste', con((e) => {
    e.plantas.push({ id: 'p1', nivel: 280, estancias: [{ id: 's1', contorno: [[0, 0], [400, 0], [400, 400], [0, 400]] }] });
    e.plantas[0].escaleras = [{ id: 'esc', x: 100, y: 100, ancho: 90, largo: 360, poste: 20, hasta: 'p1' }];
  }), false],
  ['acabados: parquet con color, paredes y círculo de giro', con((e) => Object.assign(E(e), { suelo: { tipo: 'parquet', color: '#a07050' }, paredes: '#f2e6d0', circuloDeGiro: true })), true],
  ['suelo de mármol', con((e) => (E(e).suelo = { tipo: 'marmol' })), false],
  ['paredes sin #', con((e) => (E(e).paredes = 'f2e6d0')), false],
  ['fotos válidas', con((e) => { E(e).fotos = ['fotos/sala.jpg']; M(e)[0].fotos = ['fotos/cama.webp']; }), true],
  ['foto que sale de la carpeta', con((e) => (M(e)[0].fotos = ['fotos/../../a.jpg'])), false],
  ['foto en internet', con((e) => (M(e)[0].fotos = ['http://x/a.jpg'])), false],
  ['foto que no es imagen', con((e) => (M(e)[0].fotos = ['fotos/a.gif'])), false],
  ['pieza de forma desconocida', con((e) => (M(e)[0].piezas = [{ forma: 'cono', ancho: 10 }])), false],
  ['modelo que no es .glb', con((e) => (M(e)[0].modelo = { archivo: 'modelos/cama.obj' })), false],
  ['modelo con ajuste raro', con((e) => (M(e)[0].modelo = { archivo: 'm.glb', ajuste: 'estirar' })), false],
  ['elementos y faldones válidos', con((e) => {
    E(e).elementos = [
      { id: 'c1', forma: 'exento', x: 100, y: 100, ancho: 30, redondo: true },
      { id: 'r1', forma: 'adosado', tipo: 'radiador', muro: 0, desde: 10, ancho: 80, fondo: 10, alto: 60, elevacion: 15 },
      { id: 'e1', forma: 'punto', muro: 1, desde: 50, altura: 30 },
      { id: 'v1', forma: 'viga', de: [0, 150], a: [400, 150], ancho: 20, canto: 25 },
    ];
    E(e).faldones = [{ muro: 0, alturaEnMuro: 120, alcance: 200 }];
  }), true],
  ['elemento de forma desconocida', con((e) => (E(e).elementos = [{ id: 'x', forma: 'cubo' }])), false],
  ['exento sin x', con((e) => (E(e).elementos = [{ id: 'x', forma: 'exento', y: 1, ancho: 10 }])), false],
  ['punto con ancho (no es suyo)', con((e) => (E(e).elementos = [{ id: 'x', forma: 'punto', muro: 0, desde: 1, ancho: 5 }])), false],
  ['viga con un punto de 3 números', con((e) => (E(e).elementos = [{ id: 'x', forma: 'viga', de: [0, 0, 0], a: [1, 1] }])), false],
  ['faldón sin alcance', con((e) => (E(e).faldones = [{ muro: 0, alturaEnMuro: 100 }])), false],
  ['fondo válido', con((e) => (P(e).fondos = [{ id: 'plano', archivo: 'planos/piso.png', anchoPx: 800, altoPx: 600, escala: 1.25, x: -10, y: -10, giro: 0, opacidad: 0.4 }])), true],
  ['fondo con ruta absoluta', con((e) => (P(e).fondos = [{ id: 'plano', archivo: 'C:/planos/piso.png', anchoPx: 8, altoPx: 6 }])), false],
  ['fondo que sale de la carpeta', con((e) => (P(e).fondos = [{ id: 'plano', archivo: 'planos/../../x.png', anchoPx: 8, altoPx: 6 }])), false],
  ['fondo con barras de Windows', con((e) => (P(e).fondos = [{ id: 'plano', archivo: 'planos\\piso.png', anchoPx: 8, altoPx: 6 }])), false],
  ['fondo sin tamaño', con((e) => (P(e).fondos = [{ id: 'plano', archivo: 'p.png' }])), false],
  ['fondo con opacidad 2', con((e) => (P(e).fondos = [{ id: 'plano', archivo: 'p.png', anchoPx: 8, altoPx: 6, opacidad: 2 }])), false],
  ['sin plantas', con((e) => (e.plantas = [])), false],
  ['planta sin estancias', con((e) => (P(e).estancias = [])), false],
  ['planta sin id', con((e) => delete P(e).id), false],
  ['estancia sin id', con((e) => delete E(e).id), false],
  ['grosorMuros en la estancia (era de la v1)', con((e) => (E(e).grosorMuros = 10)), false],
  ['estancia y muebles en la raíz (forma de la v1 con versión 2)', { ...base(), estancia: E(base()) }, false],
  ['campo desconocido en la raíz', con((e) => (e.extra = 1)), false],
  ['campo desconocido en un mueble', con((e) => (M(e)[0].anchura = 1)), false],
  ['mueble sin x', con((e) => delete M(e)[0].x), false],
  ['ancho 0', con((e) => (M(e)[0].ancho = 0)), false],
  ['ancho como texto', con((e) => (M(e)[0].ancho = '150')), false],
  ['id vacío', con((e) => (M(e)[0].id = '')), false],
  ['id con espacio', con((e) => (M(e)[0].id = 'mi cama')), false],
  ['color corto', con((e) => (M(e)[0].color = '#fff')), false],
  ['elevación negativa', con((e) => (M(e)[0].elevacion = -1)), false],
  ['bloqueado como texto', con((e) => (M(e)[0].bloqueado = 'true')), false],
  ['contorno de 2 puntos', con((e) => (E(e).contorno = [[0, 0], [1, 1]])), false],
  ['punto con 3 números', con((e) => (E(e).contorno[0] = [0, 0, 0])), false],
  ['hueco de tipo raro', con((e) => (E(e).huecos = [{ id: 'x', tipo: 'ventanal', muro: 0, desde: 0, ancho: 10 }])), false],
  ['ventana con abre', con((e) => (E(e).huecos = [{ id: 'v', tipo: 'ventana', muro: 0, desde: 0, ancho: 10, abre: 'dentro' }])), false],
  ['puerta con antepecho', con((e) => (E(e).huecos = [{ id: 'p', tipo: 'puerta', muro: 0, desde: 0, ancho: 80, antepecho: 10 }])), false],
  ['muro con decimales', con((e) => (E(e).huecos = [{ id: 'p', tipo: 'paso', muro: 0.5, desde: 0, ancho: 80 }])), false],
  ['distribución sin posiciones', con((e) => (e.distribuciones = [{ nombre: 'x' }])), false],
  ['posición sin y', con((e) => (e.distribuciones = [{ nombre: 'x', posiciones: { a: { x: 1 } } }])), false],
];

// Lo que sólo comprueba validar(): el esquema lo admite y la herramienta no.
const SEMANTICO = [
  ['contorno que se cruza', con((e) => (E(e).contorno = [[0, 0], [10, 10], [10, 0], [0, 10]]))],
  ['ids repetidos', con((e) => M(e).push({ ...M(e)[0] }))],
  ['hueco que no cabe en su muro', con((e) => (E(e).huecos = [{ id: 'p', tipo: 'puerta', muro: 0, desde: 350, ancho: 80 }]))],
  ['muro inexistente', con((e) => (E(e).huecos = [{ id: 'p', tipo: 'puerta', muro: 9, desde: 0, ancho: 80 }]))],
  ['hueco inferior mayor que el alto', con((e) => (M(e)[0].huecoInferior = 60))],
  ['ids repetidos entre un hueco y un mueble', con((e) => (E(e).huecos = [{ id: 'a', tipo: 'paso', muro: 0, desde: 10, ancho: 80 }]))],
  ['id de estancia igual al de la planta', con((e) => (E(e).id = 'pb'))],
  ['adosado que no cabe en su muro', con((e) => (E(e).elementos = [{ id: 'x', forma: 'adosado', muro: 1, desde: 250, ancho: 80, fondo: 10 }]))],
  ['faldón en un muro inexistente', con((e) => (E(e).faldones = [{ muro: 9, alturaEnMuro: 100, alcance: 100 }]))],
  ['pieza que se sale del mueble', con((e) => (M(e)[0].piezas = [{ forma: 'caja', x: 100, ancho: 100, fondo: 10, alto: 10 }]))],
  ['id de fondo igual al de un mueble', con((e) => (P(e).fondos = [{ id: 'a', archivo: 'p.png', anchoPx: 8, altoPx: 6 }]))],
  ['estancias que se solapan', con((e) => P(e).estancias.push({ id: 'otra', contorno: [[100, 100], [500, 100], [500, 400], [100, 400]] }))],
  ['distribución con una planta que no existe', con((e) => (e.distribuciones = [{ nombre: 'x', posiciones: { a: { x: 1, y: 2, planta: 'nada' } } }]))],
];

describe('esquema JSON frente a validar()', () => {
  for (const [nombre, datos, valido] of CORPUS) {
    test(`${valido ? 'válido' : 'inválido'}: ${nombre}`, () => {
      assert.equal(validarEsquema(datos), valido, `esquema: ${JSON.stringify(validarEsquema.errors)}`);
      const r = N.validar(datos);
      assert.equal(r.ok, valido, `validar(): ${JSON.stringify(r.errores)}`);
    });
  }
  for (const [nombre, datos] of SEMANTICO) {
    test(`sólo validar() lo rechaza: ${nombre}`, () => {
      assert.equal(validarEsquema(datos), true, JSON.stringify(validarEsquema.errors));
      assert.equal(N.validar(datos).ok, false);
    });
  }
});

describe('archivos de la versión 1', () => {
  // El esquema describe sólo lo que se escribe (v2); la herramienta lee también la v1 y la convierte.
  const v1 = {
    formato: 'espacios3d',
    version: 1,
    estancia: { contorno: [[0, 0], [400, 0], [400, 300], [0, 300]], grosorMuros: 12, huecos: [{ id: 'a', tipo: 'paso', muro: 0, desde: 10, ancho: 80 }] },
    muebles: [{ id: 'a', ancho: 50, fondo: 50, alto: 50, x: 100, y: 100 }],
  };
  test('validar() la convierte y el resultado cumple el esquema v2', () => {
    assert.equal(validarEsquema(v1), false);
    const r = N.validar(v1);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.migradoDesde, 1);
    const datos = JSON.parse(N.aJSON(r.espacio));
    assert.equal(validarEsquema(datos), true, JSON.stringify(validarEsquema.errors));
    assert.equal(datos.plantas[0].grosorExterior, 12);
    assert.equal(datos.plantas[0].estancias[0].huecos[0].id, 'a-hueco', 'un hueco con el id de un mueble se renombra');
  });
});
