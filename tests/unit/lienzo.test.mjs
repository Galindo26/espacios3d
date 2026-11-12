// Pruebas del rasterizador sin DOM (build/lienzo.mjs).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FUENTE_ALTO, FUENTE_ANCHO, Lienzo, leerColor, medirTexto, tieneGlifo } from '../../build/lienzo.mjs';

const BLANCO = '#ffffff';
const pixel = (l, x, y) => Array.from(l.rgba.subarray((y * l.ancho + x) * 4, (y * l.ancho + x) * 4 + 4));
/** Coordenadas de los píxeles que ya no son del color de fondo [r, g, b]. */
const pintados = (l, fondo = [255, 255, 255]) => {
  const r = [];
  for (let y = 0; y < l.alto; y++) {
    for (let x = 0; x < l.ancho; x++) {
      const [pr, pg, pb] = pixel(l, x, y);
      if (pr !== fondo[0] || pg !== fondo[1] || pb !== fondo[2]) r.push(`${x},${y}`);
    }
  }
  return r;
};
const rejilla = (l) => {
  const filas = [];
  for (let y = 0; y < l.alto; y++) {
    let f = '';
    for (let x = 0; x < l.ancho; x++) f += pixel(l, x, y)[0] === 255 ? '.' : '#';
    filas.push(f);
  }
  return filas;
};

describe('lienzo', () => {
  test('fondo por defecto, opaco, y tamaños o colores no válidos', () => {
    const l = new Lienzo(3, 2);
    assert.equal(l.rgba.length, 3 * 2 * 4);
    assert.ok(l.rgba instanceof Uint8ClampedArray);
    assert.deepEqual(pixel(l, 2, 1), [0xfb, 0xfa, 0xf7, 255]);
    assert.throws(() => new Lienzo(0, 5), /Tamaño/);
    assert.throws(() => new Lienzo(2.5, 5), /Tamaño/);
    assert.throws(() => new Lienzo(2, 2, 'rojo'), /Color no válido/);
    assert.throws(() => new Lienzo(2, 2, '#fff'), /Color no válido/);
    assert.deepEqual(leerColor('#1A2b3C'), [0x1a, 0x2b, 0x3c]);
  });

  test('rectángulo de esquinas enteras: exactamente sus píxeles', () => {
    const l = new Lienzo(10, 8, BLANCO);
    l.rellenarPoligono([[2, 2], [6, 2], [6, 5], [2, 5]], '#000000');
    const p = pintados(l);
    assert.equal(p.length, 4 * 3);
    assert.ok(p.includes('2,2') && p.includes('5,4') && !p.includes('6,4') && !p.includes('5,5'));
  });

  test('polígono cóncavo (U): la muesca queda sin pintar y el área cuadra', () => {
    const l = new Lienzo(12, 12, BLANCO);
    // U de 9×8 con una muesca de 3×5 desde arriba: área 72 − 15 = 57.
    l.rellenarPoligono([[1, 1], [4, 1], [4, 6], [7, 6], [7, 1], [10, 1], [10, 9], [1, 9]], '#000000');
    const p = pintados(l);
    assert.equal(p.length, 57);
    for (const muesca of ['4,1', '5,3', '6,5']) assert.ok(!p.includes(muesca), `muesca ${muesca}`);
    assert.ok(p.includes('3,1') && p.includes('7,1') && p.includes('5,6'));
    // El sentido de giro no cambia nada.
    const l2 = new Lienzo(12, 12, BLANCO);
    l2.rellenarPoligono([[1, 9], [10, 9], [10, 1], [7, 1], [7, 6], [4, 6], [4, 1], [1, 1]].reverse(), '#000000');
    assert.deepEqual(pintados(l2), p);
  });

  test('mezcla alfa: 50 % de rojo sobre blanco y dos triángulos con lado común sin doble mezcla', () => {
    const l = new Lienzo(8, 8, BLANCO);
    l.rellenarPoligono([[0, 0], [4, 0], [4, 4], [0, 4]], '#ff0000', 0.5);
    assert.deepEqual(pixel(l, 1, 1), [255, 128, 128, 255]);
    // Cuadrado diagonalmente partido en dos triángulos semitransparentes: color uniforme.
    const m = new Lienzo(8, 8, BLANCO);
    m.rellenarPoligono([[0, 0], [8, 0], [8, 8]], '#0000ff', 0.5);
    m.rellenarPoligono([[0, 0], [8, 8], [0, 8]], '#0000ff', 0.5);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) assert.deepEqual(pixel(m, x, y), [128, 128, 255, 255], `${x},${y}`);
    // Encima de algo ya pintado se mezcla con lo que hay.
    l.rellenarPoligono([[0, 0], [4, 0], [4, 4], [0, 4]], '#0000ff', 0.5);
    // (0, 0, 255)·0,5 + (255, 128, 128)·0,5 = (127,5; 64; 191,5) → Uint8ClampedArray redondea al par.
    assert.deepEqual(pixel(l, 1, 1), [128, 64, 192, 255]);
    // alfa 0 no pinta.
    const n = new Lienzo(4, 4, BLANCO);
    n.rellenarPoligono([[0, 0], [4, 0], [4, 4]], '#000000', 0);
    assert.equal(pintados(n).length, 0);
  });

  test('líneas: grosor y continuidad en diagonal', () => {
    const l = new Lienzo(20, 20, BLANCO);
    l.linea([2, 10], [18, 10], '#000000', 3);
    const p = pintados(l);
    assert.equal(p.length, 16 * 3, 'horizontal de 16 × 3');
    assert.ok(p.includes('2,8') && p.includes('17,10') && !p.includes('2,11'));
    const d = new Lienzo(30, 30, BLANCO);
    d.linea([1, 2], [28, 17], '#000000');
    const pd = pintados(d);
    for (let x = 2; x < 28; x++) assert.ok(pd.some((c) => c.startsWith(`${x},`)), `columna ${x} sin píxel`);
    assert.ok(pd.length < 27 * 2, 'línea fina');
    const punto = new Lienzo(10, 10, BLANCO);
    punto.linea([5, 5], [5, 5], '#000000', 4);
    assert.ok(pintados(punto).length > 8, 'segmento nulo = punto redondo');
    assert.throws(() => l.linea([0, 0], [1, 1], '#000000', 0), /Grosor/);
  });

  test('círculos relleno y contorno', () => {
    const l = new Lienzo(41, 41, BLANCO);
    l.circulo([20.5, 20.5], 15, '#000000');
    const area = pintados(l).length;
    assert.ok(Math.abs(area - Math.PI * 225) < 0.03 * Math.PI * 225, `área ${area}`);
    const c = new Lienzo(41, 41, BLANCO);
    c.circulo([20.5, 20.5], 15, '#000000', false);
    const p = pintados(c);
    assert.ok(!p.includes('20,20'), 'hueco en el centro');
    assert.ok(p.includes('35,20') && p.includes('20,5'), 'pasa por el radio');
    assert.ok(Math.abs(p.length - 2 * Math.PI * 15) < 12, `perímetro ${p.length}`);
  });

  test('texto: glifo «A» exacto, escala, «?» para lo desconocido y medidas', () => {
    const l = new Lienzo(7, 9, BLANCO);
    l.texto(1, 1, 'A', '#000000');
    assert.deepEqual(rejilla(l), [
      '.......',
      '..###..',
      '.#...#.',
      '.#...#.',
      '.#####.',
      '.#...#.',
      '.#...#.',
      '.#...#.',
      '.......',
    ]);
    const doble = new Lienzo(12, 16, BLANCO);
    doble.texto(0, 0, 'A', '#000000', 2);
    assert.equal(pintados(doble).length, 4 * pintados(l).length);
    const desconocido = new Lienzo(7, 9, BLANCO);
    desconocido.texto(1, 1, '€', '#000000');
    const interrogacion = new Lienzo(7, 9, BLANCO);
    interrogacion.texto(1, 1, '?', '#000000');
    assert.deepEqual(rejilla(desconocido), rejilla(interrogacion));
    assert.deepEqual(medirTexto('Hola'), { ancho: 23, alto: 7 });
    assert.deepEqual(medirTexto('ab\nc', 2), { ancho: 22, alto: 32 });
    assert.equal(FUENTE_ANCHO, 5);
    assert.equal(FUENTE_ALTO, 7);
    // Dos caracteres seguidos con un punto de separación: la «I» empieza 6 px a la derecha.
    const dos = new Lienzo(12, 7, BLANCO);
    dos.texto(0, 0, 'II', '#000000');
    assert.deepEqual(rejilla(dos)[0], '.###...###..');
  });

  test('la fuente cubre ASCII 32–126 y los caracteres del español pedidos, todos distintos de «?»', () => {
    const pedidos = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), ...'áéíóúÁÉÍÓÚñÑü¿¡°×«»'];
    const vistos = new Map();
    for (const c of pedidos) {
      assert.ok(tieneGlifo(c), `falta el glifo de «${c}»`);
      const l = new Lienzo(5, 7, BLANCO);
      l.texto(0, 0, c, '#000000');
      const huella = rejilla(l).join('/');
      if (c !== ' ') assert.ok(huella.includes('#'), `«${c}» vacío`);
      assert.ok(!vistos.has(huella), `«${c}» igual que «${vistos.get(huella)}»`);
      vistos.set(huella, c);
    }
    assert.ok(!tieneGlifo('€'));
  });

  test('imagen: alfa por píxel, opacidad, escala por vecino y recorte en los bordes', () => {
    const img = Uint8Array.from([
      255, 0, 0, 255, /**/ 0, 255, 0, 255,
      0, 0, 255, 255, /**/ 0, 0, 0, 0,
    ]);
    const l = new Lienzo(6, 6, BLANCO);
    l.imagen(img, 2, 2, 1, 1, 1, 2);
    assert.deepEqual(pixel(l, 1, 1), [255, 0, 0, 255]);
    assert.deepEqual(pixel(l, 2, 2), [255, 0, 0, 255]);
    assert.deepEqual(pixel(l, 3, 1), [0, 255, 0, 255]);
    assert.deepEqual(pixel(l, 1, 4), [0, 0, 255, 255]);
    assert.deepEqual(pixel(l, 4, 4), [255, 255, 255, 255], 'transparente no pinta');
    assert.equal(pintados(l).length, 12);
    const o = new Lienzo(2, 2, BLANCO);
    o.imagen(img, 2, 2, 0, 0, 0.5);
    assert.deepEqual(pixel(o, 0, 0), [255, 128, 128, 255]);
    const borde = new Lienzo(3, 3, BLANCO);
    borde.imagen(img, 2, 2, -1, 2, 1, 1);
    assert.deepEqual(pintados(borde), ['0,2']);
    assert.deepEqual(pixel(borde, 0, 2), [0, 255, 0, 255]);
    assert.throws(() => l.imagen(img, 3, 2, 0, 0), /bytes/);
  });
});
