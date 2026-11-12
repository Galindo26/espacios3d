// Pruebas del escritor de .glb (build/glb.mjs): estructura leída a mano, validación con el glTF-Validator
// oficial de Khronos (0 errores) y geometría de las mallas (normales unitarias y hacia fuera, sentido de
// giro coherente con la normal y tapas que cubren el área de la base).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import { escribirGLB, mallaCaja, mallaCilindro, mallaPrisma, srgbALineal, triangularPoligono } from '../../build/glb.mjs';

const validador = createRequire(import.meta.url)('gltf-validator');

/** Lee un .glb: cabecera, trozos y JSON; comprueba alineaciones y rellenos. */
function leerGLB(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(v.getUint32(0, true), 0x46546c67, 'magia glTF');
  assert.equal(v.getUint32(4, true), 2, 'versión 2');
  assert.equal(v.getUint32(8, true), bytes.length, 'longitud total');
  const largoJson = v.getUint32(12, true);
  assert.equal(v.getUint32(16, true), 0x4e4f534a, 'trozo JSON');
  assert.equal(largoJson % 4, 0);
  const textoJson = new TextDecoder().decode(bytes.subarray(20, 20 + largoJson));
  assert.match(textoJson, /^\{.*\} *$/s, 'relleno con espacios');
  const json = JSON.parse(textoJson);
  let bin = null;
  const p = 20 + largoJson;
  if (p < bytes.length) {
    const largoBin = v.getUint32(p, true);
    assert.equal(v.getUint32(p + 4, true), 0x004e4942, 'trozo BIN');
    assert.equal(largoBin % 4, 0);
    assert.equal(p + 8 + largoBin, bytes.length);
    bin = bytes.subarray(p + 8, p + 8 + largoBin);
  }
  return { json, bin };
}

const leerAccesor = (json, bin, i) => {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const Tipo = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
  const n = a.count * (a.type === 'VEC3' ? 3 : 1);
  return new Tipo(bin.slice(bv.byteOffset + (a.byteOffset ?? 0), bv.byteOffset + (a.byteOffset ?? 0) + n * Tipo.BYTES_PER_ELEMENT).buffer);
};

async function validar(bytes) {
  const informe = await validador.validateBytes(new Uint8Array(bytes), { maxIssues: 100 });
  const errores = informe.issues.messages.filter((m) => m.severity === 0);
  assert.equal(informe.issues.numErrors, 0, `errores del validador: ${JSON.stringify(errores, null, 1)}`);
  return informe;
}

/** Comprueba en una geometría: normales unitarias y triángulos girados según su normal (cruz · n > 0). */
function comprobarGeometria(g) {
  const { posiciones: P, normales: N, indices: I } = g;
  assert.equal(P.length, N.length);
  assert.equal(I.length % 3, 0);
  for (let i = 0; i < N.length; i += 3) assert.ok(Math.abs(Math.hypot(N[i], N[i + 1], N[i + 2]) - 1) < 1e-6);
  let area = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
    const u = [P[b * 3] - pa[0], P[b * 3 + 1] - pa[1], P[b * 3 + 2] - pa[2]];
    const w = [P[c * 3] - pa[0], P[c * 3 + 1] - pa[1], P[c * 3 + 2] - pa[2]];
    const cruz = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const largo = Math.hypot(...cruz);
    assert.ok(largo > 1e-9, `triángulo ${t / 3} degenerado`);
    area += largo / 2;
    for (const k of [a, b, c]) {
      const d = (cruz[0] * N[k * 3] + cruz[1] * N[k * 3 + 1] + cruz[2] * N[k * 3 + 2]) / largo;
      assert.ok(d > 0.999, `triángulo ${t / 3}: giro o normal plana incoherente (${d})`);
    }
  }
  return area;
}

/** Suma de áreas de los triángulos cuya normal es (0, ny, 0). */
const areaTapa = (g, ny) => {
  const { posiciones: P, normales: N, indices: I } = g;
  let area = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t];
    if (Math.abs(N[a * 3 + 1] - ny) > 1e-6) continue;
    const [b, c] = [I[t + 1], I[t + 2]];
    area += Math.abs((P[b * 3] - P[a * 3]) * (P[c * 3 + 2] - P[a * 3 + 2]) - (P[c * 3] - P[a * 3]) * (P[b * 3 + 2] - P[a * 3 + 2])) / 2;
  }
  return area;
};

const dentroPoligono = ([x, z], pol) => {
  let dentro = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const [xi, zi] = pol[i];
    const [xj, zj] = pol[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) dentro = !dentro;
  }
  return dentro;
};

/** Las caras laterales de un prisma: desde el centro de cada una, un paso por la normal sale del polígono. */
function lateralesHaciaFuera(g, base) {
  const { posiciones: P, normales: N, indices: I } = g;
  let laterales = 0;
  for (let t = 0; t < I.length; t += 3) {
    const k = [I[t], I[t + 1], I[t + 2]];
    if (Math.abs(N[k[0] * 3 + 1]) > 1e-6) continue;
    laterales++;
    const cx = (P[k[0] * 3] + P[k[1] * 3] + P[k[2] * 3]) / 3;
    const cz = (P[k[0] * 3 + 2] + P[k[1] * 3 + 2] + P[k[2] * 3 + 2]) / 3;
    const e = 1e-3;
    assert.ok(!dentroPoligono([cx + N[k[0] * 3] * e, cz + N[k[0] * 3 + 2] * e], base), 'hacia fuera');
    assert.ok(dentroPoligono([cx - N[k[0] * 3] * e, cz - N[k[0] * 3 + 2] * e], base), 'el interior detrás');
  }
  return laterales;
}

const areaPoligono = (p) => Math.abs(p.reduce((s, [x, z], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * z, 0)) / 2;

const MATERIALES = [
  { nombre: 'Madera', color: [0.72, 0.6, 0.45, 1], metalico: 0, rugosidad: 0.8 },
  { nombre: 'Cristal', color: [0.8, 0.9, 1, 0.3], metalico: 0, rugosidad: 0.1, transparente: true },
];

function escenaEjemplo() {
  const L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]];
  return {
    nombreEscena: 'Dormitorio',
    generador: 'Espacios 3D (pruebas)',
    materiales: MATERIALES,
    nodos: [
      {
        nombre: 'Estancia',
        extras: { formato: 'espacios3d', version: 1 },
        hijos: [
          { nombre: 'Muro en L', malla: { primitivas: [{ ...mallaPrisma(L, 0, 2.5), material: 0 }] } },
          {
            nombre: 'Mesa',
            traslacion: [2, 0, 1.5],
            rotacion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
            escala: [1, 1, 1],
            extras: { id: 'mesa', tipo: 'escritorio' },
            malla: { primitivas: [{ ...mallaCaja(1.2, 0.75, 0.6), material: 0 }, { ...mallaCilindro(0.1, 0.3), material: 1 }] },
          },
        ],
      },
      { nombre: 'Vacío' },
    ],
  };
}

describe('GLB', () => {
  test('estructura: cabecera, trozos, nodos TRS, mallas y materiales con nombre, extras', () => {
    const { json, bin } = leerGLB(escribirGLB(escenaEjemplo()));
    assert.equal(json.asset.version, '2.0');
    assert.equal(json.asset.generator, 'Espacios 3D (pruebas)');
    assert.equal(json.scene, 0);
    assert.equal(json.scenes[0].name, 'Dormitorio');
    assert.deepEqual(json.scenes[0].nodes.map((i) => json.nodes[i].name), ['Estancia', 'Vacío']);
    const raiz = json.nodes[json.scenes[0].nodes[0]];
    assert.deepEqual(raiz.extras, { formato: 'espacios3d', version: 1 });
    const [muro, mesa] = raiz.children.map((i) => json.nodes[i]);
    assert.equal(json.meshes[muro.mesh].name, 'Muro en L');
    assert.equal(json.meshes[mesa.mesh].name, 'Mesa');
    assert.equal(json.meshes[mesa.mesh].primitives.length, 2);
    assert.deepEqual(mesa.translation, [2, 0, 1.5]);
    assert.ok(Math.abs(mesa.rotation[1] - Math.SQRT1_2) < 1e-12);
    assert.deepEqual(mesa.scale, [1, 1, 1]);
    assert.equal(mesa.matrix, undefined);
    assert.deepEqual(mesa.extras, { id: 'mesa', tipo: 'escritorio' });
    assert.equal(json.nodes.find((n) => n.name === 'Vacío').mesh, undefined);
    // Materiales: nombre, color en lineal, alfa intacto, BLEND sólo si es transparente.
    assert.deepEqual(json.materials.map((m) => m.name), ['Madera', 'Cristal']);
    const f = json.materials[0].pbrMetallicRoughness.baseColorFactor;
    assert.ok(Math.abs(f[0] - srgbALineal(0.72)) < 1e-12 && Math.abs(f[0] - 0.4769) < 1e-3, `lineal ${f[0]}`);
    assert.equal(json.materials[1].pbrMetallicRoughness.baseColorFactor[3], 0.3);
    assert.equal(json.materials[0].alphaMode, undefined);
    assert.equal(json.materials[1].alphaMode, 'BLEND');
    assert.equal(json.materials[0].pbrMetallicRoughness.roughnessFactor, 0.8);
    assert.ok(Math.abs(srgbALineal(0.02) - 0.02 / 12.92) < 1e-12);
    // bufferViews alineados y con target; accesores con min/max en POSITION que cuadran con los datos.
    assert.equal(json.buffers[0].byteLength, bin.length);
    for (const bv of json.bufferViews) {
      assert.equal(bv.byteOffset % 4, 0);
      assert.ok(bv.target === 34962 || bv.target === 34963);
    }
    for (const malla of json.meshes) {
      for (const p of malla.primitives) {
        assert.equal(json.bufferViews[json.accessors[p.indices].bufferView].target, 34963);
        const a = json.accessors[p.attributes.POSITION];
        const pos = leerAccesor(json, bin, p.attributes.POSITION);
        for (let k = 0; k < 3; k++) {
          const eje = Array.from(pos).filter((_, i) => i % 3 === k);
          assert.equal(a.min[k], Math.min(...eje));
          assert.equal(a.max[k], Math.max(...eje));
        }
      }
    }
    const caja = json.meshes[mesa.mesh].primitives[0];
    assert.deepEqual(json.accessors[caja.attributes.POSITION].min.map((x) => Math.round(x * 1000) / 1000), [-0.6, 0, -0.3]);
    assert.deepEqual(Array.from(leerAccesor(json, bin, caja.indices)), Array.from(mallaCaja(1.2, 0.75, 0.6).indices));
  });

  test('el glTF-Validator de Khronos no encuentra errores (ni avisos)', async () => {
    const informe = await validar(escribirGLB(escenaEjemplo()));
    assert.equal(informe.issues.numWarnings, 0, JSON.stringify(informe.issues.messages));
    assert.equal(informe.info.version, '2.0');
    assert.equal(informe.info.hasDefaultScene, true);
    assert.equal(informe.info.drawCallCount, 3);
    assert.equal(informe.info.materialCount, 2);
    // Control: el validador sí detecta un GLB estropeado (POSITION declarado VEC2).
    const roto = Buffer.from(escribirGLB(escenaEjemplo()));
    roto.write('"VEC2"', roto.toString('latin1').indexOf('"VEC3"'), 'latin1');
    assert.ok((await validador.validateBytes(new Uint8Array(roto))).issues.numErrors > 0, 'el validador no detecta nada');
    // Escena sin mallas (sin BIN) y escena vacía.
    await validar(escribirGLB({ nombreEscena: 'Sólo nodos', generador: 'x', materiales: [], nodos: [{ nombre: 'a', traslacion: [1, 2, 3] }] }));
    await validar(escribirGLB({ nombreEscena: 'Vacía', generador: 'x', materiales: [], nodos: [] }));
  });

  test('índices Uint32 cuando se pasan así, y se valida', async () => {
    const g = mallaCaja(1, 1, 1);
    const glb = escribirGLB({
      nombreEscena: 'U32',
      generador: 'x',
      materiales: [MATERIALES[0]],
      nodos: [{ nombre: 'caja', malla: { primitivas: [{ ...g, indices: Uint32Array.from(g.indices), material: 0 }] } }],
    });
    const { json } = leerGLB(glb);
    assert.equal(json.accessors[json.meshes[0].primitives[0].indices].componentType, 5125);
    await validar(glb);
  });

  test('mallas: caja, cilindro y prismas cóncavos en ambos sentidos', () => {
    const caja = mallaCaja(2, 3, 4);
    assert.equal(caja.posiciones.length / 3, 24);
    assert.equal(caja.indices.length, 36);
    assert.ok(caja.indices instanceof Uint16Array);
    assert.ok(Math.abs(comprobarGeometria(caja) - 2 * (2 * 3 + 2 * 4 + 3 * 4)) < 1e-5);
    // Caja convexa: cada normal apunta en el sentido de su vértice desde el centro.
    for (let i = 0; i < 24; i++) {
      const P = caja.posiciones, N = caja.normales;
      const d = N[i * 3] * P[i * 3] + N[i * 3 + 1] * (P[i * 3 + 1] - 1.5) + N[i * 3 + 2] * P[i * 3 + 2];
      assert.ok(d > 0, 'normal hacia fuera');
    }
    const cil = mallaCilindro(0.5, 2);
    comprobarGeometria(cil);
    const area24 = 0.5 * 24 * 0.25 * Math.sin((2 * Math.PI) / 24);
    assert.ok(Math.abs(areaTapa(cil, 1) - area24) < 1e-5 && Math.abs(areaTapa(cil, -1) - area24) < 1e-5);
    assert.equal(mallaCilindro(1, 1, 6).posiciones.length / 3, 6 * 4 + 6 * 2);
    for (const base of [
      [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]], // L
      [[0, 0], [0, 3], [1, 3], [1, 1], [4, 1], [4, 0]], // L al revés
      [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]], // U
      [[0, 0], [2, 0], [4, 0], [4, 2], [0, 2]], // con un vértice alineado
    ]) {
      const g = mallaPrisma(base, 0.1, 2.6);
      comprobarGeometria(g);
      const area = areaPoligono(base);
      assert.ok(Math.abs(areaTapa(g, 1) - area) < 1e-5, `tapa superior ${areaTapa(g, 1)} ≠ ${area}`);
      assert.ok(Math.abs(areaTapa(g, -1) - area) < 1e-5);
      assert.equal(lateralesHaciaFuera(g, base), base.length * 2);
      const ys = Array.from(g.posiciones).filter((_, i) => i % 3 === 1);
      assert.ok(Math.abs(Math.min(...ys) - 0.1) < 1e-6 && Math.abs(Math.max(...ys) - 2.6) < 1e-6);
    }
    assert.equal(triangularPoligono([[0, 0], [1, 0], [1, 1], [0, 1]]).length, 2);
  });

  test('errores claros en entradas no válidas', () => {
    const caja = { ...mallaCaja(1, 1, 1), material: 0 };
    const con = (nodo, materiales = MATERIALES) => () => escribirGLB({ nombreEscena: 'e', generador: 'g', materiales, nodos: [nodo] });
    assert.throws(con({ nombre: 'a', malla: { primitivas: [{ ...caja, material: 5 }] } }), /material 5 inexistente/);
    assert.throws(con({ nombre: 'a', rotacion: [0, 0, 0, 2] }), /cuaternión unitario/);
    assert.throws(con({ nombre: 'a', traslacion: [0, NaN, 0] }), /no finitos/);
    assert.throws(con({ nombre: 'a', malla: { primitivas: [{ ...caja, indices: Uint16Array.of(0, 1, 99) }] } }), /índice 99/);
    assert.throws(con({ nombre: 'a', malla: { primitivas: [{ ...caja, normales: new Float32Array(caja.posiciones.length) }] } }), /no unitaria/);
    assert.throws(con({ nombre: 'a' }, [{ nombre: 'm', color: [2, 0, 0, 1], metalico: 0, rugosidad: 1 }]), /fuera de 0–1/);
    assert.throws(() => mallaPrisma([[0, 0], [2, 2], [2, 0], [0, 2]], 0, 1), /se corta a sí misma/);
    assert.throws(() => mallaPrisma([[0, 0], [1, 0], [1, 0], [0, 1]], 0, 1), /repetidos/);
    assert.throws(() => mallaPrisma([[0, 0], [1, 0], [2, 0]], 0, 1), /área/);
    assert.throws(() => mallaPrisma([[0, 0], [1, 0], [0, 1]], 1, 1), /y1 > y0/);
    assert.throws(() => mallaCaja(0, 1, 1), /positivo/);
    assert.throws(() => mallaCilindro(1, 1, 2), /segmentos/);
  });
});
