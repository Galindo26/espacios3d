// Recorrido en primera persona (R2-5): colisión 2D pura, sin three, para poder probarla.
// Un círculo (la persona) se mueve por la planta y choca con los muros (salvo por puertas y pasos),
// con los muebles de más de 30 cm y con la obra que llega al suelo. Se desliza a lo largo de lo que
// toca, y el movimiento se trocea para no atravesar nada aunque el paso sea largo.
import { esquinasMueble, puntoEnPoligono } from './geometria.js';
import { huellaElemento, rangoAltura } from './elementos.js';
import { modeloPlanta } from './muros.js';
import { geometriaHueco } from './huecos.js';
import type { Espacio, Planta, Punto } from './tipos.js';
import { bordesSalvo, enConvexos, enHuella, escalerasQueLlegan, geometriaDe, alturaEnEscalera, parteBaja, type GeometriaEscalera } from './escaleras.js';

/** Radio de la persona (cm). */
export const RADIO_PERSONA = 20;
/** Lo que se puede pasar por encima (cm): alfombras, escalones bajos. */
export const ALTO_PISABLE = 30;
/** Por encima de esto (cm) se pasa por debajo: estantes altos, lámparas de techo. */
export const ALTO_CABEZA = 180;
/*
 * Límites conocidos (escritos a propósito): la persona es un círculo en planta, así que una viga o un
 * techo inclinado más bajos que su cabeza no la paran (sólo lo que ocupa algo entre 30 y 180 cm), y
 * una rendija apenas más estrecha que ella (unos 38 cm) puede colarse. La página avanza en pasos
 * cortos (como mucho un décimo de segundo por fotograma), así que no salta obstáculos finos.
 */

/** ¿Ocupa algo entre lo pisable y la cabeza? (muebles y obra con la misma regla). */
function estorba(z0: number, z1: number): boolean {
  return z0 < ALTO_CABEZA && z1 > ALTO_PISABLE;
}

export type Segmento = [Punto, Punto];

/** Huellas de los muebles y la obra con los que se choca (para no empezar dentro de uno). */
function huellasSolidas(p: Planta): Punto[][] {
  const res: Punto[][] = [];
  for (const mu of p.muebles) if (estorba(mu.elevacion, mu.elevacion + mu.alto)) res.push(esquinasMueble(mu));
  for (const s of p.estancias) {
    for (const el of s.elementos ?? []) {
      if (el.forma !== 'exento' && el.forma !== 'adosado') continue;
      const [z0, z1] = rangoAltura(s, el);
      if (estorba(z0, z1)) res.push(huellaElemento(s, el)!);
    }
  }
  return res;
}

/** Segmentos contra los que se choca en una planta, a la altura de la persona. */
export function obstaculos(p: Planta): Segmento[] {
  const segs: Segmento[] = [];
  const anillo = (r: readonly Punto[]): void => {
    for (let i = 0; i < r.length; i++) segs.push([r[i] as Punto, r[(i + 1) % r.length] as Punto]);
  };
  // Muros: la banda que empieza en el suelo ya tiene restados puertas y pasos (y no las ventanas).
  const m = modeloPlanta(p);
  const suelo = m.bandas.find((b) => b.y0 === 0);
  for (const pol of suelo?.poligonos ?? []) {
    anillo(pol.exterior);
    for (const h of pol.agujeros) anillo(h);
  }
  // Sin grosor de muro no hay masa: se choca con el contorno de cada estancia, menos sus puertas y pasos.
  if (!m.masa.length) {
    // Tramos de puertas y pasos en planta: se restan de cualquier pared en su misma recta (también la
    // de la estancia vecina, que no tiene el hueco definido).
    const puertas = p.estancias.flatMap((s) => s.huecos.filter((h) => h.tipo !== 'ventana').map((h) => geometriaHueco(s.contorno, h)));
    for (const s of p.estancias) {
      for (let i = 0; i < s.contorno.length; i++) {
        const [a, b] = [s.contorno[i] as Punto, s.contorno[(i + 1) % s.contorno.length] as Punto];
        const largo = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (largo <= 0) continue;
        const u: Punto = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
        const huecos = puertas
          .filter((g) => [g.a, g.b].every((q) => Math.abs((q[0] - a[0]) * u[1] - (q[1] - a[1]) * u[0]) <= 1))
          .map((g) => {
            const t0 = (g.a[0] - a[0]) * u[0] + (g.a[1] - a[1]) * u[1];
            const t1 = (g.b[0] - a[0]) * u[0] + (g.b[1] - a[1]) * u[1];
            return [Math.min(t0, t1), Math.max(t0, t1)] as [number, number];
          })
          .sort((x, y) => x[0] - y[0]);
        const en = (t: number): Punto => [a[0] + ((b[0] - a[0]) * t) / largo, a[1] + ((b[1] - a[1]) * t) / largo];
        let t0 = 0;
        for (const [h0, h1] of huecos) {
          if (h0 > t0) segs.push([en(t0), en(h0)]);
          t0 = Math.max(t0, h1);
        }
        if (t0 < largo) segs.push([en(t0), en(largo)]);
      }
    }
  }
  for (const h of huellasSolidas(p)) anillo(h);
  return segs;
}

function masCercano(p: Punto, [a, b]: Segmento): Punto {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return [a[0] + dx * t, a[1] + dy * t];
}

/**
 * Mueve un círculo de radio `radio` desde `desde` según `delta` (cm) sin atravesar los segmentos:
 * avanza en pasos de como mucho medio radio y, en cada uno, lo empuja fuera de lo que toca (así se
 * desliza por las paredes en lugar de pararse en seco).
 */
export function moverConColision(desde: Punto, delta: Punto, segs: readonly Segmento[], radio = RADIO_PERSONA): Punto {
  const largo = Math.hypot(delta[0], delta[1]);
  const pasos = Math.max(1, Math.ceil(largo / (radio / 2)));
  let p: Punto = [desde[0], desde[1]];
  for (let k = 0; k < pasos; k++) {
    const previo = p;
    p = [p[0] + delta[0] / pasos, p[1] + delta[1] / pasos];
    for (let it = 0; it < 4; it++) {
      let empujado = false;
      for (const s of segs) {
        const c = masCercano(p, s);
        let dx = p[0] - c[0];
        let dy = p[1] - c[1];
        let d = Math.hypot(dx, dy);
        if (d >= radio - 1e-9) continue;
        if (d < 1e-9) {
          // Justo encima de la línea: hacia el lado del que se venía (antes se dejaba pasar, y en una U se
          // cruzaba de un tramo al otro: revisión independiente de la ronda 3, 1).
          const ux = s[1][0] - s[0][0];
          const uy = s[1][1] - s[0][1];
          const l = Math.hypot(ux, uy);
          if (l < 1e-9) continue;
          const lado = Math.sign(ux * (previo[1] - s[0][1]) - uy * (previo[0] - s[0][0])) || 1;
          dx = (-uy / l) * lado * 1e-6;
          dy = (ux / l) * lado * 1e-6;
          d = 1e-6;
        }
        const empuje = radio - d;
        p = [p[0] + (dx / d) * empuje, p[1] + (dy / d) * empuje];
        empujado = true;
      }
      if (!empujado) break;
    }
  }
  return p;
}

/** Primer punto libre para empezar a recorrer: el centro de la estancia, o cerca de él. */
export function puntoDeSalida(p: Planta, estanciaId?: string, evitar: readonly Punto[][] = []): Punto {
  const s = p.estancias.find((x) => x.id === estanciaId) ?? p.estancias[0]!;
  const xs = s.contorno.map((q) => q[0]);
  const ys = s.contorno.map((q) => q[1]);
  const c: Punto = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  // Si cae dentro de un mueble u obra, se busca alrededor en anillos de 20 cm.
  const segs = obstaculos(p);
  const solidos = huellasSolidas(p);
  for (let r = 0; r <= 300; r += 20) {
    for (let a = 0; a < 16; a++) {
      const q: Punto = r === 0 ? c : [c[0] + r * Math.cos((a / 16) * Math.PI * 2), c[1] + r * Math.sin((a / 16) * Math.PI * 2)];
      const lejos = segs.every((sg) => Math.hypot(q[0] - masCercano(q, sg)[0], q[1] - masCercano(q, sg)[1]) >= RADIO_PERSONA);
      if (lejos && puntoEnPoligono(q, s.contorno) && !solidos.some((h) => puntoEnPoligono(q, h)) && !evitar.some((h) => puntoEnPoligono(q, h))) return q;
      if (r === 0) break;
    }
  }
  return c;
}

// ---------- Escaleras (R2-7, R3-1) ----------

/** Dónde está quien recorre: en qué planta y, si está en una escalera, en cuál. */
export interface EstadoRecorrido {
  planta: string;
  escalera: string | null;
}

interface EscaleraEn {
  desde: Planta;
  hasta: Planta;
  geo: GeometriaEscalera;
  id: string;
}

function escaleraPorId(e: Espacio, id: string): EscaleraEn | null {
  for (const p of e.plantas) {
    const esc = (p.escaleras ?? []).find((x) => x.id === id);
    const hasta = esc && e.plantas.find((x) => x.id === esc.hasta);
    if (esc && hasta) return { desde: p, hasta, geo: geometriaDe(e, p, esc), id: esc.id };
  }
  return null;
}

const anilloDe = (r: readonly Punto[]): Segmento[] => r.map((q, i) => [q, r[(i + 1) % r.length]!] as Segmento);

/** Escaleras que suben desde una planta y las que llegan a ella. */
function escalerasDe(e: Espacio, p: Planta): { suben: EscaleraEn[]; llegan: EscaleraEn[] } {
  const suben = (p.escaleras ?? []).map((x) => escaleraPorId(e, x.id)).filter((x): x is EscaleraEn => !!x);
  const llegan = escalerasQueLlegan(e, p.id).map((x) => escaleraPorId(e, x.escalera.id)).filter((x): x is EscaleraEn => !!x);
  return { suben, llegan };
}

/**
 * Contra qué se choca en ese estado. En una escalera, sólo con sus barandillas y su poste (la
 * validación ya asegura que dentro no hay nada más). Fuera, con la planta y, además, con el borde de
 * la parte baja de las escaleras que suben (por debajo de la parte alta se pasa) y del hueco de las
 * que llegan, todo junto (una escalera puede estar sobre el hueco de otra), salvo los pies de las que
 * suben y las llegadas de las que llegan; y con el poste de las de caracol.
 */
export function obstaculosEn(e: Espacio, estado: EstadoRecorrido): Segmento[] {
  if (estado.escalera) {
    const x = escaleraPorId(e, estado.escalera);
    if (x) return [...x.geo.barandillas.map(([a, b]) => [a, b] as Segmento), ...(x.geo.poste ? anilloDe(x.geo.poste) : [])];
  }
  const p = e.plantas.find((x) => x.id === estado.planta) ?? e.plantas[0]!;
  const segs = obstaculos(p);
  const { suben, llegan } = escalerasDe(e, p);
  const zonas = [...suben.flatMap((x) => parteBaja(x.geo)), ...llegan.flatMap((x) => x.geo.hueco)];
  const abiertos = [...suben.map((x) => x.geo.pie), ...llegan.map((x) => x.geo.llegada)];
  segs.push(...bordesSalvo(zonas, abiertos));
  // Las barandillas que arrancan en un borde abierto (la separación entre tramos de una U, que parte la
  // abertura en dos en una caja de escalera), en sus primeros 60 cm: así no se entra a caballo entre dos
  // escaleras (revisión independiente de la ronda 3, 1).
  for (const [x, abierto] of [...suben.map((x) => [x, x.geo.pie] as const), ...llegan.map((x) => [x, x.geo.llegada] as const)]) {
    for (const [a, b] of x.geo.barandillas) {
      const desdeA = distSeg(a, abierto) < 1;
      if (!desdeA && distSeg(b, abierto) >= 1) continue;
      const [p, q] = desdeA ? [a, b] : [b, a];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l < 1e-6) continue;
      const k = Math.min(1, 60 / l);
      segs.push([p, [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]]);
    }
  }
  for (const x of suben) if (x.geo.poste) segs.push(...anilloDe(x.geo.poste));
  return segs;
}

const distSeg = (p: Punto, [a, b]: [Punto, Punto]): number => {
  const q = masCercano(p, [a, b]);
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
};

/** ¿Cruza el paso de `a` a `b` el segmento [c, d]? */
function cruza(a: Punto, b: Punto, [c, d]: [Punto, Punto]): boolean {
  const o = (p: Punto, q: Punto, r: Punto): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0) || (d1 !== 0 && d2 === 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Tras moverse de `a` a `b`: si se entra en una escalera o se sale de ella, el estado cambia (y la
 * planta, al llegar arriba o abajo). Se sale al cruzar el pie (abajo) o la llegada (arriba); si
 * coinciden (caracol de una vuelta entera), decide la cota de la que se viene. Sin `a`, o si se sale
 * de la huella sin cruzar ninguno, por el borde más cercano. Al entrar, si el punto está en varias a
 * la vez (una sobre el hueco de otra), en la del borde abierto más cercano.
 */
export function pasoEscaleras(e: Espacio, estado: EstadoRecorrido, b: Punto, a?: Punto): EstadoRecorrido {
  if (estado.escalera) {
    const x = escaleraPorId(e, estado.escalera);
    if (!x) return { planta: estado.planta, escalera: null };
    const arriba = { planta: x.hasta.id, escalera: null };
    const abajo = { planta: x.desde.id, escalera: null };
    // Se sale por arriba o por abajo según la cota de la que se viene, no según el borde que se cruza: en
    // una caja de escalera el pie de una y la llegada de la otra están en línea y juntos (revisión independiente
    // de la ronda 3, 1). Sin posición anterior, por el borde más cercano.
    const porCota = (): EstadoRecorrido => {
      const z = a ? alturaEnEscalera(x.geo, a) : null;
      if (z !== null) return z >= x.geo.altura / 2 ? arriba : abajo;
      return distSeg(b, x.geo.llegada) < distSeg(b, x.geo.pie) ? arriba : abajo;
    };
    if (a && (cruza(a, b, x.geo.llegada) || cruza(a, b, x.geo.pie))) return porCota();
    if (enHuella(x.geo, b, 0.01)) return estado;
    return porCota();
  }
  const p = e.plantas.find((x) => x.id === estado.planta);
  if (!p) return estado;
  const { suben, llegan } = escalerasDe(e, p);
  const candidatas = [
    ...suben.filter((x) => enConvexos(parteBaja(x.geo), b)).map((x) => ({ id: x.id, d: distSeg(b, x.geo.pie) })),
    ...llegan.filter((x) => enConvexos(x.geo.hueco, b)).map((x) => ({ id: x.id, d: distSeg(b, x.geo.llegada) })),
  ].sort((u, v) => u.d - v.d);
  return candidatas[0] ? { planta: estado.planta, escalera: candidatas[0].id } : estado;
}

/** Cota absoluta del suelo (cm) donde se pisa: la de la planta o, en una escalera, la de su rampa. */
export function cotaSuelo(e: Espacio, estado: EstadoRecorrido, p: Punto): number {
  if (estado.escalera) {
    const x = escaleraPorId(e, estado.escalera);
    if (x) {
      const z = alturaEnEscalera(x.geo, p);
      if (z !== null) return x.desde.nivel + z;
      // Sobre el ojo o en el borde: la cota más cercana a lo que se pisa.
      return x.desde.nivel + (distSeg(p, x.geo.llegada) < distSeg(p, x.geo.pie) ? x.geo.altura : 0);
    }
  }
  return (e.plantas.find((x) => x.id === estado.planta) ?? e.plantas[0]!).nivel;
}

/** Huellas de las escaleras de una planta y huecos de las que llegan a ella (para no aparecer encima). */
export function huellasEscaleras(e: Espacio, plantaId: string): Punto[][] {
  const p = e.plantas.find((x) => x.id === plantaId);
  if (!p) return [];
  const { suben, llegan } = escalerasDe(e, p);
  return [...suben.flatMap((x) => x.geo.huella), ...llegan.flatMap((x) => x.geo.hueco)];
}
