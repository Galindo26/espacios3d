// R4-2: materiales básicos: suelo (tipo y color) y color de las paredes por estancia; revestimiento
// de las paredes con los huecos recortados; .glb con los acabados.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const validador = createRequire(import.meta.url)('gltf-validator');
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const cerca = (a, b, tol) => Math.abs(a - b) <= tol;
/** Área de unos cuadriláteros 3D (dos triángulos cada uno). */
const area = (cuadros) => cuadros.reduce((s, q) => {
  const tri = (a, b, c) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  };
  return s + tri(q[0], q[1], q[2]) + tri(q[0], q[2], q[3]);
}, 0);

function piso({ salon = {}, cuarto = {} } = {}) {
  return N.validarOLanzar({
    formato: 'espacios3d', version: 2, nombre: 'Piso',
    plantas: [{ id: 'pb', nivel: 0, grosorExterior: 10, estancias: [
      { id: 'salon', nombre: 'Salón', contorno: rect(0, 0, 400, 300), altura: 250, huecos: [
        { id: 'entrada', tipo: 'puerta', muro: 0, desde: 40, ancho: 80, alto: 210 },
        { id: 'v1', tipo: 'ventana', muro: 3, desde: 100, ancho: 120, alto: 110, antepecho: 90 },
        { id: 'p-cuarto', tipo: 'puerta', muro: 1, desde: 100, ancho: 80, alto: 210 },
      ], ...salon },
      { id: 'cuarto', nombre: 'Cuarto', contorno: rect(410, 0, 700, 300), altura: 250, huecos: [], ...cuarto },
    ], muebles: [] }],
  });
}

describe('acabados en el formato', () => {
  test('suelo y paredes válidos; tipo, color o campo desconocido, errores', () => {
    const e = piso({ salon: { suelo: { tipo: 'parquet' }, paredes: '#f2e6d0' } });
    assert.deepEqual(e.plantas[0].estancias[0].suelo, { tipo: 'parquet' });
    assert.equal(N.colorSuelo(e.plantas[0].estancias[0]), N.COLOR_SUELO.parquet);
    const mal = (salon) => N.validar(JSON.parse(JSON.stringify({ ...piso(), plantas: [{ ...piso().plantas[0], estancias: [{ ...piso().plantas[0].estancias[0], ...salon }] }] }))).errores.join(' | ');
    assert.match(mal({ suelo: { tipo: 'marmol' } }), /suelo\.tipo/);
    assert.match(mal({ suelo: { tipo: 'baldosa', color: 'rojo' } }), /suelo\.color/);
    assert.match(mal({ suelo: { tipo: 'baldosa', brillo: 1 } }), /brillo/);
    assert.match(mal({ paredes: 'blanco' }), /paredes/);
  });

  test('lote: poner tipo, color y paredes; cambiar de tipo vuelve a su color; null quita', () => {
    let e = N.ejecutarLote(piso(), [{ op: 'estancia', estancia: 'salon', suelo: 'baldosa', colorSuelo: '#aabbcc', paredes: '#ffeedd' }]).espacio;
    let s = e.plantas[0].estancias[0];
    assert.deepEqual([s.suelo, s.paredes], [{ tipo: 'baldosa', color: '#aabbcc' }, '#ffeedd']);
    e = N.ejecutarLote(e, [{ op: 'estancia', estancia: 'salon', colorSuelo: '#112233' }]).espacio;
    assert.deepEqual(e.plantas[0].estancias[0].suelo, { tipo: 'baldosa', color: '#112233' }, 'sólo el color: conserva el tipo');
    e = N.ejecutarLote(e, [{ op: 'estancia', estancia: 'salon', suelo: 'moqueta' }]).espacio;
    assert.deepEqual(e.plantas[0].estancias[0].suelo, { tipo: 'moqueta' }, 'otro tipo: su color');
    e = N.ejecutarLote(e, [{ op: 'estancia', estancia: 'salon', suelo: null, paredes: null }]).espacio;
    s = e.plantas[0].estancias[0];
    assert.deepEqual([s.suelo, s.paredes], [undefined, undefined]);
    assert.throws(() => N.ejecutarLote(e, [{ op: 'estancia', estancia: 'salon', suelo: 'marmol' }]), /suelo/);
  });

  test('describir da el suelo y las paredes', () => {
    const d = N.describir(piso({ salon: { suelo: { tipo: 'parquet', color: '#a07050' }, paredes: '#ffffff' } }));
    const s = d.plantas[0].estancias.find((x) => x.id === 'salon');
    assert.deepEqual([s.suelo, s.paredes], [{ tipo: 'parquet', color: '#a07050' }, '#ffffff']);
  });
});

describe('revestimiento de las paredes', () => {
  test('cubre las paredes salvo sus huecos y la puerta de la vecina en el tabique', () => {
    const e = piso();
    const m = N.modeloPlanta(e.plantas[0]);
    const [salon, cuarto] = e.plantas[0].estancias;
    // Salón: perímetro 1400 × 250, menos la puerta de entrada, la del cuarto y la ventana.
    const esperado = 1400 * 250 - 80 * 210 - 80 * 210 - 120 * 110;
    assert.ok(cerca(area(N.revestimiento(salon, m)), esperado, 5), `${area(N.revestimiento(salon, m))} frente a ${esperado}`);
    // Cuarto: la puerta la define el salón, pero también se abre en el lado del cuarto.
    assert.ok(cerca(area(N.revestimiento(cuarto, m)), 1180 * 250 - 80 * 210, 5), String(area(N.revestimiento(cuarto, m))));
    // Por muro: el 1 del salón tiene la puerta del cuarto.
    const porMuro = N.revestimientoPorMuro(salon, m);
    assert.equal(porMuro.length, 4);
    assert.ok(cerca(area(porMuro[1]), 300 * 250 - 80 * 210, 5));
  });

  test('bajo un techo inclinado, la pintura llega hasta él', () => {
    const e = piso({ cuarto: { faldones: [{ muro: 2, alturaEnMuro: 150, alcance: 150 }] } });
    const cuarto = e.plantas[0].estancias[1];
    const q = N.revestimiento(cuarto, N.modeloPlanta(e.plantas[0]));
    // Ningún punto de la pintura queda por encima del techo en su sitio.
    for (const c of q) for (const p of c) assert.ok(p[2] <= N.alturaTecho(cuarto, [p[0], p[1]]) + 1, JSON.stringify(p));
    assert.ok(area(q) < 1180 * 250 - 1, 'menos que con el techo plano');
  });
});

describe('.glb con acabados', () => {
  test('válido, con el color del suelo y las paredes pintadas', async () => {
    const e = piso({ salon: { suelo: { tipo: 'parquet' }, paredes: '#f2e6d0' } });
    const bytes = N.espacioAGLB(e);
    const informe = await validador.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
    assert.equal(informe.issues.numErrors, 0, JSON.stringify(informe.issues.messages.slice(0, 3)));
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
    assert.ok(json.nodes.some((n) => n.name === 'paredes-salon'));
    assert.ok(!json.nodes.some((n) => n.name === 'paredes-cuarto'));
    const suelo = json.nodes.find((n) => n.name === 'suelo-salon');
    assert.deepEqual(suelo.extras.suelo, { tipo: 'parquet', color: N.COLOR_SUELO.parquet });
    assert.ok(json.materials.some((m) => m.name === `suelo parquet ${N.COLOR_SUELO.parquet}`));
  });
});
