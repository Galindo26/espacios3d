// Edición del contorno de la estancia: por tramos (lo que se mide con cinta: longitud de cada pared
// y el giro hasta la siguiente) y por vértices (insertar, mover y quitar) reasignando los huecos.
import { clonar, estancia } from './espacio.js';
import { distancia, distanciaPuntoSegmento, longitudMuro, muro, GRAD } from './geometria.js';
import type { Elemento, Espacio, Faldon, Hueco, Punto, Suelo } from './tipos.js';
import { ErrorOperacion, TOLERANCIA } from './tipos.js';
import { validar } from './validar.js';

export interface Tramo {
  /** Longitud de la pared (cm, cara interior). */
  longitud: number;
  /** Giro al final de la pared hasta la siguiente, en grados: 90 = esquina normal girando a la derecha vista en planta. */
  giro: number;
}

export interface ResultadoTramos {
  contorno: Punto[];
  /** Distancia (cm) entre el final del último tramo y el punto de partida: lo que no cierra. */
  descuadre: number;
  /** Longitud real de la última pared, que es la que absorbe el descuadre. */
  ultimaReal: number;
}

function r(n: number): number {
  return Math.round(n * 10) / 10 || 0; // sin −0
}

/**
 * Contorno a partir de tramos. Empieza en (0, 0) hacia +x; tras cada pared gira `giro` grados a la
 * derecha (en planta, con y hacia abajo). La última pared se cierra contra el punto de partida y
 * absorbe el descuadre, que se informa para que la persona revise sus medidas.
 */
export function contornoDesdeTramos(tramos: readonly Tramo[], anclaje?: { inicio: Punto; rumbo: number }): ResultadoTramos {
  if (tramos.length < 3) throw new ErrorOperacion('Hacen falta al menos 3 paredes');
  for (const [i, t] of tramos.entries()) {
    if (!(t.longitud > 0)) throw new ErrorOperacion(`Pared ${i + 1}: la longitud debe ser mayor que 0`);
    if (!Number.isFinite(t.giro)) throw new ErrorOperacion(`Pared ${i + 1}: el giro debe ser un número`);
  }
  // Con anclaje se parte del primer vértice y la dirección del primer muro actuales, para que la
  // estancia no se mueva respecto a los muebles; sin él, desde (0, 0) hacia +x.
  let x = anclaje?.inicio[0] ?? 0;
  let y = anclaje?.inicio[1] ?? 0;
  let rumbo = anclaje?.rumbo ?? 0;
  const x0 = x;
  const y0 = y;
  const puntos: Punto[] = [];
  for (const t of tramos) {
    puntos.push([r(x), r(y)]);
    x += Math.cos(rumbo * GRAD) * t.longitud;
    y += Math.sin(rumbo * GRAD) * t.longitud;
    rumbo += t.giro;
  }
  const descuadre = r(Math.hypot(x - x0, y - y0));
  let contorno = puntos;
  if (!anclaje) {
    // Se desplaza para que el contorno quede en coordenadas positivas (más cómodo de leer).
    const minX = Math.min(...puntos.map((p) => p[0]));
    const minY = Math.min(...puntos.map((p) => p[1]));
    contorno = puntos.map(([px, py]) => [r(px - minX), r(py - minY)] as Punto);
  }
  return { contorno, descuadre, ultimaReal: r(distancia(contorno[contorno.length - 1] as Punto, contorno[0] as Punto)) };
}

/** Anclaje del contorno actual: su primer vértice y el rumbo (grados) de su primer muro. */
export function anclajeDe(contorno: readonly Punto[]): { inicio: Punto; rumbo: number } {
  const [a, b] = muro(contorno, 0);
  return { inicio: [a[0], a[1]], rumbo: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
}

/** Tramos de un contorno existente (para mostrarlo en la tabla de paredes). */
export function tramosDesdeContorno(contorno: readonly Punto[]): Tramo[] {
  return contorno.map((_, i) => {
    const [a, b] = muro(contorno, i);
    const [, c] = muro(contorno, i + 1);
    const r1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const r2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let g = ((r2 - r1) / GRAD) % 360;
    if (g > 180) g -= 360;
    if (g <= -180) g += 360;
    return { longitud: r(longitudMuro(contorno, i)), giro: Math.round(g * 100) / 100 };
  });
}

function confirmar(e: Espacio): Espacio {
  const v = validar(e);
  if (!v.ok) throw new ErrorOperacion(`El resultado no es válido:\n- ${v.errores.join('\n- ')}`);
  return v.espacio;
}

/**
 * Ancla común de lo que va sujeto a un muro: huecos ahora y, más adelante, elementos y faldones.
 * `desde` son cm desde el vértice inicial del muro; `ancho` el tramo que ocupa (0 si es un punto).
 */
export interface Ancla {
  muro: number;
  desde: number;
  ancho?: number;
}

/** Distancia máxima (cm) entre un tramo anclado y la pared nueva que lo recoge. */
const TOLERANCIA_ANCLA = 1;

/**
 * Recoloca anclas de un contorno en otro con distinto número de paredes: cada una pasa a la pared
 * nueva que contiene su tramo (a ≤ 1 cm). Es la única reindexación: la usan todos los anclados.
 * Lanza, nombrándolo, si alguno se queda sin pared. Si la pared nueva va en sentido contrario,
 * `alInvertir` ajusta lo que dependa del sentido (la bisagra de una puerta). En una esquina, un ancla
 * de punto se queda en la pared con la misma dirección que tenía.
 */
export function reanclar<T extends Ancla>(
  viejo: readonly Punto[],
  nuevo: readonly Punto[],
  anclas: readonly T[],
  nombre: (a: T) => string,
  alInvertir: (a: T) => T = (a) => a,
): T[] {
  return anclas.map((an) => {
    const [a, b] = muro(viejo, an.muro);
    const largo = longitudMuro(viejo, an.muro);
    const u: Punto = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
    const extremos: Punto[] = [an.desde, an.desde + (an.ancho ?? 0)].map((t) => [a[0] + u[0] * t, a[1] + u[1] * t] as Punto);
    let mejor: { muro: number; desde: number; dist: number; dir: number } | null = null;
    for (let j = 0; j < nuevo.length; j++) {
      const [c, d] = muro(nuevo, j);
      const l = longitudMuro(nuevo, j);
      if (l < TOLERANCIA) continue;
      const w: Punto = [(d[0] - c[0]) / l, (d[1] - c[1]) / l];
      const t = extremos.map((p) => (p[0] - c[0]) * w[0] + (p[1] - c[1]) * w[1]);
      const dist = Math.max(...extremos.map((p) => Math.abs((p[0] - c[0]) * w[1] - (p[1] - c[1]) * w[0])));
      if (dist > TOLERANCIA_ANCLA || Math.min(...t) < -TOLERANCIA || Math.max(...t) > l + TOLERANCIA) continue;
      const dir = u[0] * w[0] + u[1] * w[1];
      // Gana la pared más cercana; a igual distancia (esquinas), la de dirección más parecida.
      // En una esquina, la pared con la misma dirección (o la misma al revés) gana a una perpendicular.
      if (!mejor || dist < mejor.dist - 1e-9 || (Math.abs(dist - mejor.dist) <= 1e-9 && Math.abs(dir) > Math.abs(mejor.dir))) {
        mejor = { muro: j, desde: r(Math.max(0, Math.min(...t))), dist, dir };
      }
    }
    if (!mejor) throw new ErrorOperacion(`«${nombre(an)}» se queda sin pared con la forma nueva: muévelo o quítalo antes`);
    const movido = { ...an, muro: mejor.muro, desde: mejor.desde };
    return mejor.dir < 0 ? alInvertir(movido) : movido;
  });
}

/**
 * Cambia el contorno de una estancia. Con el mismo número de paredes, los huecos conservan su pared
 * y su distancia; con otro número, se recolocan en la pared que los contiene (`reanclar`).
 */
export function cambiarContorno(e: Espacio, contorno: Punto[], estanciaId?: string): Espacio {
  const est = estancia(e, estanciaId).estancia;
  // La bisagra («inicio»/«fin») se mide en el sentido del muro: si la pared nueva va al revés, cambia de nombre.
  const girarBisagra = (h: Hueco): Hueco => (h.tipo === 'puerta' ? { ...h, bisagra: (h.bisagra ?? 'inicio') === 'inicio' ? 'fin' : 'inicio' } : h);
  const igual = contorno.length === est.contorno.length;
  const huecos = igual ? est.huecos : reanclar(est.contorno, contorno, est.huecos, (h) => h.id, girarBisagra);
  // Elementos anclados a un muro (adosados y puntos) y faldones: la misma reindexación.
  const elementos = (est.elementos ?? []).map((el): Elemento => {
    if (igual || (el.forma !== 'adosado' && el.forma !== 'punto')) return el;
    const [x] = reanclar(est.contorno, contorno, [{ muro: el.muro, desde: el.desde, ancho: el.forma === 'adosado' ? el.ancho : 0 }], () => el.id);
    return { ...el, muro: x!.muro, desde: x!.desde };
  });
  // Un faldón pasa a todas las paredes nuevas que caen sobre su muro (si se parte, sigue en los trozos).
  const faldones = igual
    ? (est.faldones ?? [])
    : (est.faldones ?? []).flatMap((f): Faldon[] => {
        const [a, b] = muro(est.contorno, f.muro);
        const sobre = contorno
          .map((_, j) => j)
          .filter((j) => {
            // En la misma recta que el muro viejo y solapándose con él (dentro, o conteniéndolo).
            const [c, d] = muro(contorno, j);
            if (distancia(c, d) <= TOLERANCIA) return false;
            const largo = distancia(a, b) || 1;
            const u: Punto = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
            const fuera = (q: Punto): number => Math.abs((q[0] - a[0]) * u[1] - (q[1] - a[1]) * u[0]);
            if (fuera(c) > 1 || fuera(d) > 1) return false;
            const s0 = (c[0] - a[0]) * u[0] + (c[1] - a[1]) * u[1];
            const s1 = (d[0] - a[0]) * u[0] + (d[1] - a[1]) * u[1];
            return Math.min(Math.max(s0, s1), largo) - Math.max(Math.min(s0, s1), 0) > TOLERANCIA;
          });
        if (!sobre.length) throw new ErrorOperacion(`El techo inclinado del muro ${f.muro} se queda sin pared con la forma nueva: quítalo antes`);
        return sobre.map((j) => ({ ...f, muro: j }));
      })
      // Dos faldones que caen en la misma pared nueva (al fundir dos alineadas): se queda el primero, como en quitarVertice.
      .filter((f, i, todos) => todos.findIndex((x) => x.muro === f.muro) === i);
  const r2 = clonar(e);
  const est2 = estancia(r2, est.id).estancia;
  est2.contorno = contorno;
  est2.huecos = huecos;
  if (elementos.length) est2.elementos = elementos;
  if (faldones.length) est2.faldones = faldones;
  return confirmar(r2);
}

/**
 * Inserta un vértice en el muro i, a `d` cm de su inicio. El muro se parte en i e i+1; los huecos
 * de después del corte pasan al nuevo muro y los de los muros siguientes suben un índice.
 */
export function insertarVertice(e: Espacio, i: number, d: number, estanciaId?: string): Espacio {
  const est = estancia(e, estanciaId).estancia;
  const c = est.contorno;
  const largo = longitudMuro(c, i);
  if (!(d > TOLERANCIA && d < largo - TOLERANCIA)) throw new ErrorOperacion(`Ahí ya hay una esquina: elige un punto dentro del muro ${i} (pared ${i + 1} en la página)`);
  const [a, b] = muro(c, i);
  const p: Punto = [r(a[0] + ((b[0] - a[0]) * d) / largo), r(a[1] + ((b[1] - a[1]) * d) / largo)];
  // Lo anclado al muro i: lo que queda antes del corte se queda; lo de después pasa al muro nuevo.
  const partir = <T extends { muro: number; desde: number }>(x: T, ancho: number, nombre: string): T => {
    if (x.muro > i) return { ...x, muro: x.muro + 1 };
    if (x.muro < i) return x;
    if (x.desde + ancho <= d + TOLERANCIA) return x;
    if (x.desde >= d - TOLERANCIA) return { ...x, muro: i + 1, desde: r(x.desde - d) };
    throw new ErrorOperacion(`No se puede partir el muro por ahí: cae dentro de «${nombre}»`);
  };
  const huecos: Hueco[] = est.huecos.map((h) => partir(h, h.ancho, h.id));
  const elementos = (est.elementos ?? []).map((el) => (el.forma === 'adosado' || el.forma === 'punto' ? partir(el, el.forma === 'adosado' ? el.ancho : 0, el.id) : el));
  // Un faldón sigue en los dos trozos del muro partido (el techo baja igual a lo largo de toda la pared).
  const faldones = (est.faldones ?? []).flatMap((f) => (f.muro > i ? [{ ...f, muro: f.muro + 1 }] : f.muro === i ? [f, { ...f, muro: i + 1 }] : [f]));
  const r2 = clonar(e);
  const est2 = estancia(r2, est.id).estancia;
  est2.contorno = [...c.slice(0, i + 1), p, ...c.slice(i + 1)] as Punto[];
  est2.huecos = huecos;
  if (elementos.length) est2.elementos = elementos;
  if (faldones.length) est2.faldones = faldones;
  return confirmar(r2);
}

/** Alto de una estancia y grosor de los muros exteriores de su planta. */
export interface CambiosEstancia {
  altura?: number;
  grosorMuros?: number;
  circuloDeGiro?: boolean;
  /** Acabados (R4-2): null quita el suelo o el color de las paredes. */
  suelo?: Suelo | null;
  paredes?: string | null;
}

/** Alto, grosor de los muros exteriores, círculo de giro y acabados de una estancia. */
export function editarEstancia(e: Espacio, cambios: CambiosEstancia, estanciaId?: string): Espacio {
  const est = estancia(e, estanciaId).estancia;
  const r2 = clonar(e);
  if (cambios.altura !== undefined) estancia(r2, est.id).estancia.altura = cambios.altura;
  if (cambios.suelo !== undefined || cambios.paredes !== undefined) {
    const s = estancia(r2, est.id).estancia;
    if (cambios.suelo === null) delete s.suelo;
    else if (cambios.suelo !== undefined) s.suelo = { ...cambios.suelo };
    if (cambios.paredes === null) delete s.paredes;
    else if (cambios.paredes !== undefined) s.paredes = cambios.paredes;
  }
  if (cambios.circuloDeGiro !== undefined) {
    const s = estancia(r2, est.id).estancia;
    if (cambios.circuloDeGiro) s.circuloDeGiro = true;
    else delete s.circuloDeGiro;
  }
  if (cambios.grosorMuros !== undefined) estancia(r2, est.id).planta.grosorExterior = cambios.grosorMuros;
  return confirmar(r2);
}

const ANCHO_HUECO: Record<Hueco['tipo'], number> = { puerta: 80, ventana: 120, paso: 90 };

/**
 * Datos para un hueco nuevo del tipo dado, centrado en la primera pared (de la más larga a la más
 * corta) donde cabe sin pisar otros huecos.
 */
export function huecoNuevo(
  e: Espacio,
  tipo: Hueco['tipo'],
  estanciaId?: string,
): { tipo: Hueco['tipo']; muro: number; desde: number; ancho: number; alto: number; antepecho?: number } {
  const est = estancia(e, estanciaId).estancia;
  const c = est.contorno;
  // Alturas que caben bajo cualquier techo (en techos bajos, puertas y ventanas más bajas).
  const altura = est.altura;
  const antepecho = tipo === 'ventana' ? Math.round(Math.min(90, altura * 0.35)) : undefined;
  const alto = tipo === 'ventana' ? Math.max(10, Math.round(Math.min(120, altura - (antepecho ?? 0) - 20))) : Math.max(10, Math.round(Math.min(205, altura - 10)));
  const extra = tipo === 'ventana' ? { alto, antepecho } : { alto };
  const orden = c.map((_, i) => i).sort((x, y) => longitudMuro(c, y) - longitudMuro(c, x));
  for (const i of orden) {
    const largo = longitudMuro(c, i);
    const ancho = Math.min(ANCHO_HUECO[tipo], Math.floor(largo - 10));
    if (ancho < 30) continue;
    const ocupados = est.huecos.filter((h) => h.muro === i).map((h) => [h.desde, h.desde + h.ancho] as const);
    // Prueba centrado y luego en pasos de 10 cm desde el centro hacia los lados.
    const centro = Math.round((largo - ancho) / 2);
    for (let paso = 0; paso <= largo; paso += 10) {
      for (const desde of [centro + paso, centro - paso]) {
        if (desde < 5 || desde + ancho > largo - 5) continue;
        if (ocupados.every(([a, b]) => desde + ancho <= a - 5 || desde >= b + 5)) return { tipo, muro: i, desde, ancho, ...extra };
      }
    }
  }
  throw new ErrorOperacion('No queda sitio libre en ninguna pared para otro hueco de ese tamaño');
}

export function editarHueco(e: Espacio, id: string, cambios: Partial<Omit<Hueco, 'id' | 'tipo'>>): Espacio {
  const r2 = clonar(e);
  const h = r2.plantas.flatMap((p) => p.estancias.flatMap((s) => s.huecos)).find((x) => x.id === id);
  if (!h) throw new ErrorOperacion(`No existe el hueco «${id}»`);
  Object.assign(h, cambios);
  return confirmar(r2);
}

/** Punto de muro más cercano a (x, y): índice, distancia desde el inicio del muro y distancia al punto. */
export function puntoEnMuro(e: Espacio, x: number, y: number, estanciaId?: string): { muro: number; d: number; distancia: number } {
  const c = estancia(e, estanciaId).estancia.contorno;
  let mejor = { muro: 0, d: 0, distancia: Infinity };
  for (let i = 0; i < c.length; i++) {
    const [a, b] = muro(c, i);
    const largo = longitudMuro(c, i);
    const t = Math.max(0, Math.min(largo, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / largo));
    const px = a[0] + ((b[0] - a[0]) * t) / largo;
    const py = a[1] + ((b[1] - a[1]) * t) / largo;
    const dist = Math.hypot(x - px, y - py);
    if (dist < mejor.distancia) mejor = { muro: i, d: t, distancia: dist };
  }
  return mejor;
}

/** Mueve el vértice k. Los huecos conservan su muro y su `desde`; si dejan de caber, falla. */
export function moverVertice(e: Espacio, k: number, x: number, y: number, estanciaId?: string): Espacio {
  const r2 = clonar(e);
  const est2 = estancia(r2, estancia(e, estanciaId).estancia.id).estancia;
  if (!est2.contorno[k]) throw new ErrorOperacion(`No existe la esquina ${k}`);
  est2.contorno[k] = [r(x), r(y)];
  return confirmar(r2);
}

/**
 * Quita el vértice k (une los muros k−1 y k). Se admite si esos dos muros no tienen huecos, o si
 * son colineales (entonces los huecos del muro k pasan al k−1 sumando su longitud).
 */
export function quitarVertice(e: Espacio, k: number, estanciaId?: string): Espacio {
  const est = estancia(e, estanciaId).estancia;
  const c = est.contorno;
  const n = c.length;
  if (n <= 3) throw new ErrorOperacion('Una estancia necesita al menos 3 esquinas');
  if (!c[k]) throw new ErrorOperacion(`No existe la esquina ${k}`);
  const previo = (k - 1 + n) % n;
  const [a, b] = muro(c, previo);
  const [, d] = muro(c, k);
  // Colineal si la esquina queda a menos de 0,2 cm de la recta entre sus vecinas (y entre ellas):
  // así una esquina insertada en un muro diagonal, redondeada a 0,1 cm, se puede volver a quitar.
  const ad = distancia(a, d) || 1;
  const alRecta = Math.abs((d[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (d[1] - a[1])) / ad;
  const entre = (b[0] - a[0]) * (d[0] - a[0]) + (b[1] - a[1]) * (d[1] - a[1]) > 0 && (b[0] - d[0]) * (a[0] - d[0]) + (b[1] - d[1]) * (a[1] - d[1]) > 0;
  const colineal = alRecta <= 0.2 && entre;
  const anclados = (est.elementos ?? []).filter((el) => el.forma === 'adosado' || el.forma === 'punto') as (Elemento & { muro: number; desde: number })[];
  const afectados = [...est.huecos, ...anclados].filter((h) => h.muro === previo || h.muro === k).map((h) => `«${h.id}»`);
  if ((est.faldones ?? []).some((f) => f.muro === previo || f.muro === k)) afectados.push('el techo inclinado de esa pared');
  if (afectados.length && !colineal) {
    throw new ErrorOperacion(`Quita o mueve antes ${afectados.join(', ')}: la esquina une dos paredes que no están alineadas`);
  }
  const lPrevio = longitudMuro(c, previo);
  // Índice nuevo de cada muro: el k desaparece (se funde con el k−1) y los siguientes bajan uno.
  const nuevoIndice = (m: number): number => {
    if (m === k) return k === 0 ? n - 2 : k - 1;
    if (k === 0) return m - 1;
    return m > k ? m - 1 : m;
  };
  const mover = <T extends { muro: number; desde: number }>(h: T): T => (h.muro === k ? { ...h, muro: nuevoIndice(k), desde: r(h.desde + lPrevio) } : { ...h, muro: nuevoIndice(h.muro) });
  const huecos = est.huecos.map(mover);
  const elementos = (est.elementos ?? []).map((el) => (el.forma === 'adosado' || el.forma === 'punto' ? mover(el) : el));
  // Dos faldones que acaban en el mismo muro (al fundir dos alineados): se queda el primero.
  const faldones: Faldon[] = [];
  for (const f of est.faldones ?? []) {
    const m = nuevoIndice(f.muro);
    if (!faldones.some((x) => x.muro === m)) faldones.push({ ...f, muro: m });
  }
  const r2 = clonar(e);
  const est2 = estancia(r2, est.id).estancia;
  est2.contorno = c.filter((_, i) => i !== k);
  est2.huecos = huecos;
  if (elementos.length) est2.elementos = elementos;
  if (faldones.length) est2.faldones = faldones;
  return confirmar(r2);
}
