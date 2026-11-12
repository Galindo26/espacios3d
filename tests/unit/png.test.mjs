// Pruebas del códec PNG (build/png.mjs). Los PNG de tipos y filtros variados se fabrican aquí con un
// codificador de prueba independiente (filtros hacia delante) para comprobar el decodificador.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { codificarPNG, crc32, decodificarPNG } from '../../build/png.mjs';

const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const trozo = (tipo, datos) => {
  const b = Buffer.alloc(12 + datos.length);
  b.writeUInt32BE(datos.length, 0);
  b.write(tipo, 4, 'latin1');
  Buffer.from(datos).copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + datos.length)), 8 + datos.length);
  return b;
};
const paeth = (a, b, c) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
/** PNG de prueba: muestras de 8 bits por canal, filtro elegido por fila (o fijo). */
function fabricarPNG({ ancho, alto, tipo, muestras, filtros, plte, trns, bits = 8, entrelazado = 0 }) {
  const canales = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[tipo];
  const fila = ancho * canales;
  const crudo = [];
  for (let y = 0; y < alto; y++) {
    const f = filtros[y % filtros.length];
    crudo.push(f);
    for (let x = 0; x < fila; x++) {
      const v = muestras[y * fila + x];
      const a = x >= canales ? muestras[y * fila + x - canales] : 0;
      const b = y > 0 ? muestras[(y - 1) * fila + x] : 0;
      const c = x >= canales && y > 0 ? muestras[(y - 1) * fila + x - canales] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      crudo.push((v - pred) & 0xff);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = bits;
  ihdr[9] = tipo;
  ihdr[12] = entrelazado;
  return Buffer.concat([
    FIRMA,
    trozo('IHDR', ihdr),
    ...(plte ? [trozo('PLTE', plte)] : []),
    ...(trns ? [trozo('tRNS', trns)] : []),
    trozo('tEXt', Buffer.from('Comment\0prueba', 'latin1')), // auxiliar: se ignora
    trozo('IDAT', deflateSync(Buffer.from(crudo))),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}
/** Ruido determinista: bytes pseudoaleatorios con algo de estructura para que los filtros importen. */
const ruido = (n, semilla = 7) => {
  let s = semilla;
  return Array.from({ length: n }, (_, i) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (i * 3 + (s >> 16)) & 0xff;
  });
};

describe('PNG', () => {
  test('CRC-32 de referencia', () => {
    assert.equal(crc32(Buffer.from('123456789', 'latin1')), 0xcbf43926);
    assert.equal(crc32(new Uint8Array(0)), 0);
  });

  test('codificar → decodificar devuelve los mismos píxeles; estructura del archivo', () => {
    const [ancho, alto] = [7, 5];
    const rgba = Uint8Array.from(ruido(ancho * alto * 4));
    const png = codificarPNG(rgba, ancho, alto);
    assert.ok(Buffer.isBuffer(png));
    assert.deepEqual(png.subarray(0, 8), FIRMA);
    assert.equal(png.toString('latin1', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), ancho);
    assert.equal(png[24], 8);
    assert.equal(png[25], 6);
    assert.equal(png.toString('latin1', png.length - 8, png.length - 4), 'IEND');
    const r = decodificarPNG(png);
    assert.equal(r.ancho, ancho);
    assert.equal(r.alto, alto);
    assert.deepEqual(Array.from(r.rgba), Array.from(rgba));
    // También desde un Uint8ClampedArray y desde un subarray con desplazamiento.
    const desplazado = new Uint8Array(png.length + 3);
    desplazado.set(png, 3);
    assert.deepEqual(Array.from(decodificarPNG(desplazado.subarray(3)).rgba), Array.from(rgba));
    assert.deepEqual(codificarPNG(new Uint8ClampedArray(rgba), ancho, alto), png);
    assert.throws(() => codificarPNG(rgba, ancho, alto + 1), /bytes/);
  });

  const [ancho, alto] = [6, 5];
  const filtros = [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]];
  for (const f of filtros) {
    test(`tipos de color 0, 2, 3, 4 y 6 con filtro(s) ${f.join(',')}`, () => {
      // Gris.
      const gris = ruido(ancho * alto, 1);
      let r = decodificarPNG(fabricarPNG({ ancho, alto, tipo: 0, muestras: gris, filtros: f }));
      assert.deepEqual(Array.from(r.rgba), gris.flatMap((g) => [g, g, g, 255]));
      // RGB.
      const rgb = ruido(ancho * alto * 3, 2);
      r = decodificarPNG(fabricarPNG({ ancho, alto, tipo: 2, muestras: rgb, filtros: f }));
      assert.deepEqual(Array.from(r.rgba), Array.from({ length: ancho * alto }, (_, i) => [...rgb.slice(i * 3, i * 3 + 3), 255]).flat());
      // Paleta de 4 colores con tRNS parcial (2 entradas).
      const plte = [10, 20, 30, 40, 50, 60, 70, 80, 90, 200, 210, 220];
      const indices = ruido(ancho * alto, 3).map((v) => v % 4);
      r = decodificarPNG(fabricarPNG({ ancho, alto, tipo: 3, muestras: indices, filtros: f, plte, trns: [0, 128] }));
      assert.deepEqual(
        Array.from(r.rgba),
        indices.flatMap((k) => [...plte.slice(k * 3, k * 3 + 3), [0, 128][k] ?? 255]),
      );
      // Gris con alfa.
      const ga = ruido(ancho * alto * 2, 4);
      r = decodificarPNG(fabricarPNG({ ancho, alto, tipo: 4, muestras: ga, filtros: f }));
      assert.deepEqual(Array.from(r.rgba), Array.from({ length: ancho * alto }, (_, i) => [ga[i * 2], ga[i * 2], ga[i * 2], ga[i * 2 + 1]]).flat());
      // RGBA.
      const rgba = ruido(ancho * alto * 4, 5);
      r = decodificarPNG(fabricarPNG({ ancho, alto, tipo: 6, muestras: rgba, filtros: f }));
      assert.deepEqual(Array.from(r.rgba), rgba);
      assert.equal(r.ancho, ancho);
      assert.equal(r.alto, alto);
    });
  }

  test('tRNS con color clave en gris y RGB', () => {
    const gris = [0, 50, 100, 50];
    let r = decodificarPNG(fabricarPNG({ ancho: 2, alto: 2, tipo: 0, muestras: gris, filtros: [0], trns: [0, 50] }));
    assert.deepEqual(Array.from(r.rgba).filter((_, i) => i % 4 === 3), [255, 0, 255, 0]);
    const rgb = [1, 2, 3, 4, 5, 6];
    r = decodificarPNG(fabricarPNG({ ancho: 2, alto: 1, tipo: 2, muestras: rgb, filtros: [0], trns: [0, 4, 0, 5, 0, 6] }));
    assert.deepEqual(Array.from(r.rgba), [1, 2, 3, 255, 4, 5, 6, 0]);
  });

  test('rechazos con mensaje claro: 16 bits, entrelazado, CRC, firma, paleta y filtro', () => {
    const base = { ancho: 2, alto: 2, tipo: 0, muestras: [1, 2, 3, 4], filtros: [0] };
    assert.throws(() => decodificarPNG(fabricarPNG({ ...base, bits: 16 })), /16 bits no admitida/);
    assert.throws(() => decodificarPNG(fabricarPNG({ ...base, bits: 4 })), /4 bits no admitida/);
    assert.throws(() => decodificarPNG(fabricarPNG({ ...base, entrelazado: 1 })), /entrelazada/);
    const roto = fabricarPNG(base);
    roto[20] ^= 1; // dentro de los datos de IHDR
    assert.throws(() => decodificarPNG(roto), /CRC incorrecto en el trozo IHDR/);
    assert.throws(() => decodificarPNG(Buffer.from('no es un png')), /firma/);
    assert.throws(() => decodificarPNG(fabricarPNG({ ...base, tipo: 3 })), /paleta/);
    assert.throws(() => decodificarPNG(fabricarPNG({ ...base, filtros: [5] })), /filtro 5/);
    const corto = fabricarPNG(base);
    assert.throws(() => decodificarPNG(corto.subarray(0, corto.length - 12)), /truncado|IEND/);
  });
});
