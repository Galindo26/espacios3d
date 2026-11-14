// Booleanas (R2-2) y hallazgos N1–N2 de la verificación independiente: polygon-clipping puede lanzar con
// aristas casi colineales sin redondear (se ajusta a una rejilla) y el solape tiene que respetar la
// tolerancia lineal (estancias giradas que se tocan no se solapan).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const v2 = (a, b) => ({ formato: 'espacios3d', version: 2, plantas: [{ id: 'p', estancias: [{ id: 'a', contorno: a }, { id: 'b', contorno: b }] }] });

/** Generador con semilla (mulberry32), para repetir los casos. */
function azar(semilla) {
  return () => {
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dos rectángulos contiguos (comparten pared, tabique 0), girados y trasladados. */
function contiguas(r, redondeo) {
  const ang = r() * Math.PI * 2;
  const [c, s] = [Math.cos(ang), Math.sin(ang)];
  const [w1, w2, h] = [100 + r() * 400, 100 + r() * 400, 100 + r() * 400];
  const [ox, oy] = [r() * 1000 - 500, r() * 1000 - 500];
  const t = ([x, y]) => [ox + x * c - y * s, oy + x * s + y * c].map((v) => (redondeo ? Math.round(v / redondeo) * redondeo : v));
  return [[[0, 0], [w1, 0], [w1, h], [0, h]].map(t), [[w1, 0], [w1 + w2, 0], [w1 + w2, h], [w1, h]].map(t)];
}

describe('booleanas robustas (N1)', () => {
  test('el caso de la revisión no lanza y devuelve errores de validación, no excepciones', () => {
    const a = [[0, 0], [-232.5465438464428, 63.27009518780942], [-289.5158826670015, -146.1182866158341], [-56.96933882055869, -209.3883818036435]];
    const b = [[-248.56096627987174, 4.409766662361243], [-668.3026533056088, 118.61097581878073], [-719.496298789521, -69.54909077896343], [-299.75461176378394, -183.75029993538294]];
    assert.doesNotThrow(() => N.validar(v2(a, b)));
    assert.doesNotThrow(() => N.union([a, b]));
  });
  test('2000 pares girados sin redondear: ni validar ni la masa de muros lanzan', () => {
    const r = azar(7);
    for (let i = 0; i < 2000; i++) {
      const [a, b] = contiguas(r, 0);
      const res = N.validar(v2(a, b));
      // Todos son válidos: si validar los rechazara por otra causa, la masa de muros se quedaría sin probar.
      assert.ok(res.ok, `caso ${i}: ${(res.errores ?? []).join('; ')}`);
      assert.doesNotThrow(() => N.modeloPlanta(N.planta(res.espacio)), `caso ${i}`);
    }
  });
});

describe('solape con la tolerancia lineal (N2)', () => {
  test('2000 pares girados y contiguos, redondeados a 0,1 cm: ninguno se solapa', () => {
    const r = azar(11);
    let malos = 0;
    for (let i = 0; i < 2000; i++) {
      const [a, b] = contiguas(r, 0.1);
      const res = N.validar(v2(a, b));
      if (!res.ok) malos++;
    }
    assert.equal(malos, 0);
  });
  test('una lámina de 0,05 cm no es solape; una de 0,5 cm sí', () => {
    const a = [[0, 0], [400, 0], [400, 300], [0, 300]];
    assert.ok(N.validar(v2(a, [[399.95, 0], [700, 0], [700, 300], [399.95, 300]])).ok);
    assert.match(N.validar(v2(a, [[399.5, 0], [700, 0], [700, 300], [399.5, 300]])).errores.join(), /se solapan/);
  });
});
