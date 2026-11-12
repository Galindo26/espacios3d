// Forma de un mueble hecha de piezas (R2-6): las suyas si las trae y, si no, una forma genérica
// reconocible según el tipo (cama, silla, armario, mesa…). La usan la página y el .glb del CLI, así
// que los dos dibujan lo mismo. Las piezas genéricas caben siempre en ancho × fondo × alto.
import type { Mueble, Pieza } from './tipos.js';

/** Color de la ropa de cama y de lo claro de las formas genéricas. */
export const COLOR_CLARO = '#f4f0e8';

/** Color de las almohadas: un blanco algo distinto del colchón para que se distingan. */
export const COLOR_ALMOHADA = '#fdfcf9';

/**
 * El color multiplicado por k (0–1) en sRGB, para patas, tiradores y cabeceros. 0,76 en sRGB es
 * el 0,55 en lineal con el que la página oscurecía antes estas partes.
 */
export function oscurecer(hex: string, k = 0.76): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number): string => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
}

type Medidas = Pick<Mueble, 'tipo' | 'ancho' | 'fondo' | 'alto' | 'color' | 'huecoInferior'>;

const caja = (x: number, y: number, z: number, ancho: number, fondo: number, alto: number, color?: string): Pieza => ({
  forma: 'caja', x, y, z, ancho, fondo, alto, giro: 0, ...(color ? { color } : {}),
});

/** Forma genérica del tipo, en coordenadas del mueble (x a lo ancho, y hacia el frente, z hacia arriba). */
export function formaGenerica(m: Medidas): Pieza[] {
  const { ancho: a, fondo: f, alto: h } = m;
  const oscuro = oscurecer(m.color);
  const patas = (alto: number, lado: number): Pieza[] =>
    [-1, 1].flatMap((sx) => [-1, 1].map((sy) => caja(sx * (a / 2 - lado / 2), sy * (f / 2 - lado / 2), 0, lado, lado, alto, oscuro)));
  if (m.tipo === 'cama' && a > 20 && f > 40 && h > 10) {
    const cabecero = h > 70 ? Math.min(6, f * 0.05) : 0;
    const alto = Math.min(10, h * 0.15);
    // Sin cabecero, el colchón baja lo justo para que las almohadas asomen sin salirse del mueble.
    const colchonArriba = cabecero ? Math.min(55, h) : h - alto * 0.6;
    const base = colchonArriba * 0.55;
    const res = [
      caja(0, cabecero / 2, 0, a, f - cabecero, base),
      caja(0, cabecero / 2, base, a - 3, f - cabecero - 3, colchonArriba - base, COLOR_CLARO),
    ];
    if (cabecero) res.push(caja(0, -f / 2 + cabecero / 2, 0, a, cabecero, h));
    const n = a > 110 ? 2 : 1;
    const ancho = Math.min(60, (a - 10) / n - 4);
    const fondo = Math.min(35, f * 0.18);
    // La almohada se hunde un poco en el colchón, asoma por encima y no se sale del mueble.
    const z = Math.min(colchonArriba - alto * 0.4, h - alto);
    for (let i = 0; i < n && ancho > 1; i++) res.push(caja(n === 1 ? 0 : (i === 0 ? -1 : 1) * (a / 4), -f / 2 + cabecero + fondo / 2 + 4, z, ancho, fondo, alto, COLOR_ALMOHADA));
    return res;
  }
  if (m.tipo === 'silla' && h > 10) {
    const asiento = Math.min(46, h * 0.52);
    const lado = Math.min(3.5, a / 8, f / 8);
    const respaldo = Math.min(3.5, f * 0.1);
    return [...patas(asiento - 3, lado), caja(0, 0, asiento - 3, a, f, 3), caja(0, -f / 2 + respaldo / 2, asiento, a, respaldo, h - asiento)];
  }
  if (m.tipo === 'armario' && f > 10 && a > 20) {
    // Cuerpo y, en los 2 cm del frente, las juntas entre puertas y los tiradores.
    const res = [caja(0, -1, 0, a, f - 2, h)];
    const puertas = Math.max(1, Math.round(a / 50));
    for (let i = 1; i < puertas; i++) res.push(caja(-a / 2 + (a * i) / puertas, f / 2 - 1.7, h * 0.02, 0.6, 0.6, h * 0.96, oscuro));
    const alto = Math.min(20, h * 0.12);
    for (let i = 0; i < puertas; i++) {
      const x = -a / 2 + (a * (i + 0.5)) / puertas + (i % 2 === 0 ? 1 : -1) * Math.min(8, a / puertas / 3);
      res.push(caja(x, f / 2 - 1, h * 0.52 - alto / 2, 1.5, 2, alto, oscuro));
    }
    return res;
  }
  // Lo que se cuelga en la pared (la trasera, y = −f/2, va contra ella).
  if ((m.tipo === 'cuadro' || m.tipo === 'espejo') && f > 1.5 && a > 8 && h > 8) {
    // Marco y, delante, el lienzo o el cristal.
    const marco = Math.min(4, a * 0.12, h * 0.12);
    const frente = m.tipo === 'cuadro' ? '#d9cbb0' : '#dfe8ee';
    return [caja(0, -0.3, 0, a, f - 0.6, h), caja(0, f / 2 - 0.3, marco, a - 2 * marco, 0.6, h - 2 * marco, frente)];
  }
  if (m.tipo === 'television' && f > 2 && a > 8 && h > 8) {
    const borde = Math.min(2, a * 0.05, h * 0.05);
    return [caja(0, -0.5, 0, a, f - 1, h), caja(0, f / 2 - 0.5, borde, a - 2 * borde, 1, h - 2 * borde, '#14171a')];
  }
  if (m.tipo === 'balda' && f > 6 && a > 24 && h > 6) {
    // Tabla arriba y dos escuadras contra la pared.
    const tabla = Math.min(3, h * 0.3);
    return [caja(0, 0, h - tabla, a, f, tabla), ...[-1, 1].map((sx) => caja(sx * (a / 2 - 10), -f / 2 + f * 0.35, 0, 2, f * 0.7, h - tabla, oscuro))];
  }
  if (m.tipo === 'aplique' && a > 6 && f > 6 && h > 8) {
    // Placa en la pared, brazo y pantalla.
    const d = Math.min(a, f) * 0.85;
    const largo = f - d / 2;
    return [
      caja(0, -f / 2 + 1, h * 0.3, Math.min(a, 8), 2, h * 0.4, oscuro),
      caja(0, -f / 2 + largo / 2, h * 0.48, 1.5, largo, 1.5, oscuro),
      { forma: 'cilindro', x: 0, y: f / 2 - d / 2, z: h * 0.2, ancho: d, fondo: d, alto: h * 0.6, giro: 0, color: COLOR_CLARO },
    ];
  }
  const hueco = Math.min(m.huecoInferior, h - 1);
  if (hueco > 0) {
    // Tablero y cuatro patas: lo que quepa en el hueco se ve debajo.
    return [caja(0, 0, hueco, a, f, h - hueco), ...patas(hueco, Math.min(4, a / 4, f / 4))];
  }
  return [caja(0, 0, 0, a, f, h)];
}

/** Piezas con las que se dibuja el mueble: las suyas o la forma genérica de su tipo. */
export function piezasDe(m: Medidas & Pick<Mueble, 'piezas'>): Pieza[] {
  return m.piezas?.length ? m.piezas : formaGenerica(m);
}

/** ¿Lleva la marca de frente en pantalla? Sólo las formas genéricas que no dejan ver cuál es el frente. */
export function llevaMarcaDeFrente(m: Medidas & Pick<Mueble, 'piezas'>): boolean {
  return !m.piezas?.length && !['cama', 'silla', 'armario', 'cuadro', 'espejo', 'television', 'balda', 'aplique'].includes(m.tipo);
}
