// R2-2: masa de muros por booleanas, huecos que la atraviesan, conexiones y bandas de altura.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** Piso de prueba: pasillo arriba (800 × 100) y tres estancias debajo, con tabiques de 10 cm. */
export function piso() {
  return N.validarOLanzar({
    formato: 'espacios3d',
    version: 2,
    nombre: 'Piso',
    plantas: [
      {
        id: 'pb',
        grosorExterior: 10,
        estancias: [
          { id: 'pasillo', contorno: rect(0, 0, 800, 100), huecos: [{ id: 'entrada', tipo: 'puerta', muro: 3, desde: 10, ancho: 80 }] },
          {
            id: 'salon',
            contorno: rect(0, 110, 300, 410),
            huecos: [
              { id: 'p-salon', tipo: 'puerta', muro: 0, desde: 100, ancho: 80 },
              { id: 'v-salon', tipo: 'ventana', muro: 2, desde: 100, ancho: 120, antepecho: 90, alto: 120 },
            ],
          },
          { id: 'cocina', contorno: rect(310, 110, 500, 410), huecos: [{ id: 'p-cocina', tipo: 'paso', muro: 0, desde: 50, ancho: 80 }] },
          { id: 'dormitorio', contorno: rect(510, 110, 800, 410), huecos: [{ id: 'p-dormitorio', tipo: 'puerta', muro: 0, desde: 100, ancho: 90 }] },
        ],
        muebles: [],
      },
    ],
  });
}

// Volumen analítico: caja exterior 820 × 430 menos los suelos, por 250 de alto, menos los huecos.
const MASA = 820 * 430 - (800 * 100 + 300 * 300 + 190 * 300 + 290 * 300);
const HUECOS = 80 * 205 * 10 * 3 + 90 * 205 * 10 + 120 * 120 * 10;
const VOLUMEN = MASA * 250 - HUECOS;

describe('muros derivados (R2-2)', () => {
  test('la masa es la caja exterior menos los suelos: tabiques de 10 cm sin contar dos veces', () => {
    const m = N.modeloPlanta(N.planta(piso()));
    assert.ok(Math.abs(N.areaTotal(m.masa) - MASA) < 1, `${N.areaTotal(m.masa)} ≠ ${MASA}`);
    assert.equal(m.masa.length, 1);
    assert.equal(m.masa[0].agujeros.length, 4, 'un agujero por estancia');
  });

  test('cada hueco atraviesa su muro y dice con qué conecta', () => {
    const m = N.modeloPlanta(N.planta(piso()));
    const c = Object.fromEntries(m.conexiones.map((x) => [x.hueco, [x.de, x.a, x.grosor]]));
    assert.deepEqual(c, {
      entrada: ['pasillo', 'exterior', 10],
      'p-salon': ['salon', 'pasillo', 10],
      'p-cocina': ['cocina', 'pasillo', 10],
      'p-dormitorio': ['dormitorio', 'pasillo', 10],
    });
    const v = m.huecos.find((x) => x.hueco.id === 'v-salon');
    assert.deepEqual([v.da, v.profundidad, v.base, v.tope], [null, 10, 90, 210]);
  });

  test('las bandas de altura restan los huecos: volumen = analítico (± 0,1 %)', () => {
    const m = N.modeloPlanta(N.planta(piso()));
    const vol = N.volumenMuros(m);
    assert.ok(Math.abs(vol - VOLUMEN) / VOLUMEN < 0.001, `${vol} ≠ ${VOLUMEN}`);
    assert.deepEqual(m.bandas.map((b) => [b.y0, b.y1]), [[0, 90], [90, 205], [205, 210], [210, 250]]);
  });

  test('estancias separadas más de dos grosores: dos masas; grosor 0: sin muros', () => {
    const e = N.validarOLanzar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'p', estancias: [{ id: 'a', contorno: rect(0, 0, 100, 100) }, { id: 'b', contorno: rect(200, 0, 300, 100) }] }] });
    const m = N.modeloPlanta(N.planta(e));
    assert.equal(m.masa.length, 2);
    assert.ok(Math.abs(N.areaTotal(m.masa) - 2 * (120 * 120 - 100 * 100)) < 1);
    const sin = N.modeloPlanta({ ...N.planta(e), grosorExterior: 0 });
    assert.deepEqual([sin.masa, sin.bandas], [[], []]);
  });

  test('una estancia como en la v1: la masa coincide con el contorno exterior del dibujo', () => {
    const e = N.nuevoEspacio({ ancho: 350, largo: 300 });
    const m = N.modeloPlanta(N.planta(e));
    assert.ok(Math.abs(N.areaTotal(m.masa) - (370 * 320 - 350 * 300)) < 1);
    assert.equal(m.conexiones.length, 0);
  });
});

/** Lee un .glb: JSON y binario. */
function leerGLB(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const largoJson = v.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + largoJson)));
  const bin = bytes.subarray(20 + largoJson + 8);
  return { json, bin };
}

/** Volumen (m³) de la malla de un nodo, por el teorema de la divergencia (malla cerrada y orientada). */
function volumenNodo({ json, bin }, nombre) {
  const nodo = json.nodes.find((n) => n.name === nombre);
  assert.ok(nodo, `no hay nodo «${nombre}»`);
  const leer = (i, Tipo) => {
    const acc = json.accessors[i];
    const vista = json.bufferViews[acc.bufferView];
    const n = acc.count * (acc.type === 'VEC3' ? 3 : 1);
    return new Tipo(bin.buffer.slice(bin.byteOffset + vista.byteOffset, bin.byteOffset + vista.byteOffset + n * Tipo.BYTES_PER_ELEMENT));
  };
  let vol = 0;
  for (const prim of json.meshes[nodo.mesh].primitives) {
    const pos = leer(prim.attributes.POSITION, Float32Array);
    const ind = leer(prim.indices, json.accessors[prim.indices].componentType === 5123 ? Uint16Array : Uint32Array);
    for (let i = 0; i < ind.length; i += 3) {
      const [a, b, c] = [ind[i] * 3, ind[i + 1] * 3, ind[i + 2] * 3];
      vol += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
    }
  }
  return vol;
}

describe('.glb del núcleo (R2-2)', () => {
  const validador = createRequire(import.meta.url)('gltf-validator');
  test('volumen de muros leído del .glb = analítico ± 1 %, sin muros duplicados, y glTF válido', async () => {
    const bytes = N.espacioAGLB(piso());
    const glb = leerGLB(bytes);
    const vol = volumenNodo(glb, 'muros-pb') * 1e6; // m³ → cm³
    assert.ok(Math.abs(vol - VOLUMEN) / VOLUMEN < 0.01, `${vol} ≠ ${VOLUMEN}`);
    const informe = await validador.validateBytes(new Uint8Array(bytes), { maxIssues: 50 });
    assert.equal(informe.issues.numErrors, 0, JSON.stringify(informe.issues.messages.slice(0, 5)));
    const nombres = glb.json.nodes.map((n) => n.name);
    for (const n of ['planta-pb', 'suelo-pasillo', 'suelo-salon', 'suelo-cocina', 'suelo-dormitorio', 'muros-pb']) assert.ok(nombres.includes(n), n);
    assert.deepEqual(glb.json.nodes.find((n) => n.name === 'muros-pb').extras.conexiones.map((c) => c.hueco).sort(), ['entrada', 'p-cocina', 'p-dormitorio', 'p-salon']);
  });

  test('un mueble es un nodo con su id, posición en metros y giro', () => {
    const e = N.ejecutarLote(piso(), [{ op: 'agregar', tipo: 'cama', id: 'cama', estancia: 'dormitorio', x: 650, y: 260, giro: 90 }]).espacio;
    const { json } = leerGLB(N.espacioAGLB(e));
    const n = json.nodes.find((x) => x.name === 'cama');
    assert.deepEqual(n.translation.map((v) => Math.round(v * 100) / 100), [6.5, 0, 2.6]);
    assert.ok(Math.abs(n.rotation[1] - Math.sin(-Math.PI / 4)) < 1e-6 && Math.abs(n.rotation[3] - Math.cos(Math.PI / 4)) < 1e-6);
    assert.equal(n.extras.tipo, 'cama');
  });
});
