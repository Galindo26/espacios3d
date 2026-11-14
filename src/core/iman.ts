// Imán: al arrastrar, encaja el mueble a ras de muros y de otros muebles, y alinea sus bordes
// con los de muebles cercanos. Sólo actúa sobre bordes paralelos (±1°).
import { esquinasMueble, muro } from './geometria.js';
import { buscarMueble, planta } from './espacio.js';
import type { Espacio, Mueble, Planta, Punto } from './tipos.js';

export interface Guia {
  a: Punto;
  b: Punto;
}

export interface ResultadoIman {
  x: number;
  y: number;
  guias: Guia[];
}

const PARALELO = Math.sin(1 * (Math.PI / 180));

interface Segmento {
  a: Punto;
  b: Punto;
  muro: boolean;
}

function segmentosObjetivo(p: Planta, excluir: string): Segmento[] {
  const res: Segmento[] = [];
  for (const s of p.estancias) {
    const c = s.contorno;
    for (let i = 0; i < c.length; i++) {
      const [a, b] = muro(c, i);
      res.push({ a, b, muro: true });
    }
  }
  for (const m of p.muebles) {
    if (m.id === excluir) continue;
    const e = esquinasMueble(m);
    for (let i = 0; i < 4; i++) res.push({ a: e[i] as Punto, b: e[(i + 1) % 4] as Punto, muro: false });
  }
  return res;
}

function sub(a: Punto, b: Punto): Punto {
  return [a[0] - b[0], a[1] - b[1]];
}
function dot(a: Punto, b: Punto): number {
  return a[0] * b[0] + a[1] * b[1];
}

/**
 * Ajusta la posición candidata de `mueble` (x, y ya puestos) con un umbral en cm.
 * Devuelve la posición encajada y las guías de los bordes con los que ha encajado.
 */
export function aplicarIman(espacio: Espacio, mueble: Mueble, umbral: number, plantaId?: string): ResultadoIman {
  const esquinas = esquinasMueble(mueble);
  const p = buscarMueble(espacio, mueble.id)?.planta ?? planta(espacio, plantaId);
  const objetivos = segmentosObjetivo(p, mueble.id);
  // Mejor desplazamiento por eje local (u: normal de los lados, v: normal de frente/trasera).
  const mejores: Array<{ d: number; n: Punto; guia: Guia; coste: number } | null> = [null, null];

  for (let i = 0; i < 4; i++) {
    const a = esquinas[i] as Punto;
    const b = esquinas[(i + 1) % 4] as Punto;
    const dir = sub(b, a);
    const largo = Math.hypot(dir[0], dir[1]);
    const t: Punto = [dir[0] / largo, dir[1] / largo];
    // Normal exterior del borde (las esquinas van en sentido horario visual: exterior = (t.y, −t.x)).
    const centro: Punto = [mueble.x, mueble.y];
    let n: Punto = [t[1], -t[0]];
    if (dot(sub(a, centro), n) < 0) n = [-n[0], -n[1]];
    const eje = i % 2; // bordes 0 y 2: trasera/frente (normal ±v); 1 y 3: lados (normal ±u)

    for (const s of objetivos) {
      const ds = sub(s.b, s.a);
      const ls = Math.hypot(ds[0], ds[1]);
      if (ls === 0) continue;
      const ts: Punto = [ds[0] / ls, ds[1] / ls];
      if (Math.abs(t[0] * ts[1] - t[1] * ts[0]) > PARALELO) continue;
      // Solape lateral entre el borde y el segmento objetivo.
      const p0 = dot(sub(s.a, a), t);
      const p1 = dot(sub(s.b, a), t);
      const lo = Math.max(0, Math.min(p0, p1));
      const hi = Math.min(largo, Math.max(p0, p1));
      // Distancia firmada del borde a la línea objetivo, medida donde se solapan y no donde empieza el
      // segmento: con un muro largo que se desvía menos de 1°, su arranque puede quedar a varios cm.
      // De los dos extremos del solape, la menor: al encajar, el borde toca la línea sin atravesarla.
      const ns: Punto = [ts[1], -ts[0]];
      const hasta = (k: number): number => dot(sub(s.a, [a[0] + t[0] * k, a[1] + t[1] * k]), ns) / dot(n, ns);
      const d = Math.min(hasta(Math.min(largo, lo)), hasta(Math.max(0, hi)));
      if (Math.abs(d) > umbral) continue;
      const contacto = hi - lo > 0.5;
      let coste: number;
      if (contacto) coste = Math.abs(d);
      else if (!s.muro && Math.max(lo - hi, 0) <= 60) coste = Math.abs(d) + umbral * 0.5; // alineación con un vecino
      else continue;
      const actual = mejores[eje];
      if (!actual || coste < actual.coste) {
        mejores[eje] = { d, n, guia: { a: s.a, b: s.b }, coste };
      }
    }
  }

  let x = mueble.x;
  let y = mueble.y;
  const guias: Guia[] = [];
  for (const m of mejores) {
    if (!m) continue;
    x += m.n[0] * m.d;
    y += m.n[1] * m.d;
    guias.push(m.guia);
  }
  return { x, y, guias };
}

export function redondear(valor: number, paso: number): number {
  return Math.round(valor / paso) * paso;
}
