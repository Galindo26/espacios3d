// Plantas y tabiques (R2-7, paso a): añadir una planta (copiando la huella de otra o con una
// estancia nueva), cambiar su nombre o su nivel, quitarla con todo lo suyo, y mover un tabique
// compartido (la pared de una estancia y la de la vecina que da a ella, a la vez).
import { clonar, estancia, idsUsados, planta } from './espacio.js';
import { areaConSigno, distancia, muro, normalInterior } from './geometria.js';
import type { Escalera, Espacio, Estancia, Planta, Punto } from './tipos.js';
import { plantaDeEncima } from './escaleras.js';
import { ErrorOperacion, TOLERANCIA } from './tipos.js';
import { validar } from './validar.js';

function confirmar(e: Espacio): Espacio {
  const r = validar(e);
  if (!r.ok) throw new ErrorOperacion(`El resultado no es válido:\n- ${r.errores.join('\n- ')}`);
  return r.espacio;
}

/** Forjado por defecto entre el techo de una planta y el suelo de la siguiente (cm). */
export const FORJADO = 30;

/** «Planta N» con el primer N que no esté en uso. */
export function nombreLibre(e: Espacio): string {
  let n = e.plantas.length;
  while (e.plantas.some((p) => p.nombre === `Planta ${n}`)) n++;
  return `Planta ${n}`;
}

/** Altura mayor de las estancias de una planta (cm). */
export function alturaPlanta(p: Planta): number {
  return Math.max(0, ...p.estancias.map((s) => s.altura));
}

/** Nivel para una planta nueva encima de todas: la más alta + su altura + el forjado. */
export function nivelSiguiente(e: Espacio): number {
  const alta = e.plantas.reduce((a, p) => (p.nivel > a.nivel ? p : a), e.plantas[0]!);
  return alta.nivel + alturaPlanta(alta) + FORJADO;
}

const limpio = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56) || 'x';

/** Id libre para `base`, teniendo en cuenta también los que se van a crear (`reservados`). */
function libre(usados: Set<string>, base: string): string {
  const b = limpio(base);
  let id = b;
  for (let i = 2; usados.has(id); i++) id = `${b}-${i}`;
  usados.add(id);
  return id;
}

export interface DatosPlanta {
  id?: string;
  nombre?: string;
  nivel?: number;
  /** Copia de esta planta los contornos de sus estancias y su grosor exterior (sin muebles ni obra). */
  copiarDe?: string;
  /** Con `copiarDe`, copia también las ventanas (suelen repetirse de una planta a otra). */
  conVentanas?: boolean;
  /** Sin `copiarDe`: el contorno de la primera estancia. */
  contorno?: Punto[];
  /** Altura de las estancias creadas o copiadas (cm); por defecto, la de las copiadas o 250. */
  alto?: number;
}

/** Añade una planta. Una planta necesita al menos una estancia: se copia la huella de otra o se da un contorno. */
export function agregarPlanta(e: Espacio, d: DatosPlanta): { espacio: Espacio; id: string; estancias: string[] } {
  const usados = idsUsados(e);
  if (d.id !== undefined && usados.has(d.id)) throw new ErrorOperacion(`Ya existe algo con id «${d.id}» (los ids son únicos en todo el archivo)`);
  const id = d.id ?? libre(usados, `planta-${e.plantas.length}`);
  usados.add(id);
  let estancias: Estancia[];
  let grosorExterior = e.plantas[0]?.grosorExterior ?? 10;
  if (d.copiarDe !== undefined) {
    if (d.contorno) throw new ErrorOperacion('Usa «copiarDe» o «contorno», no ambos');
    const src = planta(e, d.copiarDe);
    grosorExterior = src.grosorExterior;
    estancias = src.estancias.map((s) => ({
      // Copia de una copia: «salon-p1» → «salon-p2», no «salon-p1-p2».
      id: libre(usados, `${s.id.endsWith(`-${src.id}`) ? s.id.slice(0, -src.id.length - 1) : s.id}-${id}`),
      nombre: s.nombre,
      contorno: s.contorno.map(([x, y]) => [x, y] as Punto),
      altura: d.alto ?? s.altura,
      huecos: d.conVentanas ? s.huecos.filter((h) => h.tipo === 'ventana').map((h) => ({ ...h, id: libre(usados, `${h.id}-${id}`) })) : [],
    }));
  } else {
    if (!d.contorno) throw new ErrorOperacion('Una planta nueva necesita «copiarDe» (copiar la huella de otra planta) o el contorno de su primera estancia («contorno», o «x», «y», «ancho» y «largo»)');
    if (d.conVentanas) throw new ErrorOperacion('«conVentanas» va con «copiarDe»');
    estancias = [{ id: libre(usados, `estancia-${id}`), nombre: 'Estancia', contorno: d.contorno.map(([x, y]) => [x, y] as Punto), altura: d.alto ?? 250, huecos: [] }];
  }
  if (d.nombre !== undefined && !d.nombre.trim()) throw new ErrorOperacion('El nombre de la planta no puede estar vacío');
  const nueva: Planta = { id, nombre: d.nombre ?? nombreLibre(e), nivel: d.nivel ?? nivelSiguiente(e), grosorExterior, estancias, muebles: [] };
  const r = clonar(e);
  // Al pasar de una planta a dos, las posiciones guardadas sin planta eran de la única que había:
  // se sella, para que aplicar la distribución devuelva a ella un mueble que luego se cambie de planta.
  if (r.plantas.length === 1) {
    const unica = r.plantas[0]!.id;
    for (const dist of r.distribuciones) for (const pos of Object.values(dist.posiciones)) pos.planta ??= unica;
  }
  r.plantas.push(nueva);
  return { espacio: confirmar(r), id, estancias: estancias.map((s) => s.id) };
}

export function editarPlanta(e: Espacio, id: string, cambios: { nombre?: string; nivel?: number }): Espacio {
  planta(e, id);
  if (cambios.nombre === undefined && cambios.nivel === undefined) throw new ErrorOperacion('«planta-editar» necesita «nombre» o «nivel»');
  const r = clonar(e);
  const p = planta(r, id);
  if (cambios.nombre !== undefined) {
    if (!cambios.nombre.trim()) throw new ErrorOperacion('El nombre de la planta no puede estar vacío');
    p.nombre = cambios.nombre;
  }
  if (cambios.nivel !== undefined) p.nivel = cambios.nivel;
  return confirmar(r);
}

export interface Quitado {
  estancias: number;
  muebles: number;
  elementos: number;
  fondos: number;
  /** Escaleras que salían de la planta o llegaban a ella. */
  escaleras: number;
}

/**
 * Quita una planta con todo lo suyo (estancias, muebles, obra y fondos) y limpia las posiciones de
 * las distribuciones que eran de ella. No se puede quitar la única planta.
 */
export function quitarPlanta(e: Espacio, id: string): { espacio: Espacio; quitado: Quitado } {
  const p = planta(e, id);
  if (e.plantas.length === 1) throw new ErrorOperacion(`«${id}» es la única planta: cambia sus estancias en vez de quitarla`);
  const muebles = new Set(p.muebles.map((m) => m.id));
  const r = clonar(e);
  r.plantas = r.plantas.filter((x) => x.id !== id);
  // Las escaleras que llegaban a ella se van también (no tendrían destino).
  let llegaban = 0;
  for (const o of r.plantas) {
    const antes = o.escaleras?.length ?? 0;
    o.escaleras = (o.escaleras ?? []).filter((x) => x.hasta !== id);
    llegaban += antes - o.escaleras.length;
    if (!o.escaleras.length) delete o.escaleras;
  }
  for (const d of r.distribuciones) {
    for (const [mid, pos] of Object.entries(d.posiciones)) if (pos.planta === id || muebles.has(mid)) delete d.posiciones[mid];
  }
  return {
    espacio: confirmar(r),
    quitado: { estancias: p.estancias.length, muebles: p.muebles.length, elementos: p.estancias.reduce((n, s) => n + (s.elementos?.length ?? 0), 0), fondos: p.fondos?.length ?? 0, escaleras: (p.escaleras?.length ?? 0) + llegaban },
  };
}

/** Una pared en los mensajes: como la ve la persona (pared 1…) y como la nombra la operación (muro 0…). Revisión independiente (9). */
const nombrePared = (k: number): string => `pared ${k + 1} (muro ${k})`;

/** Separación máxima (cm) para considerar que dos paredes paralelas forman un tabique. */
export const TABIQUE_MAX = 60;

const resta = (a: Punto, b: Punto): Punto => [a[0] - b[0], a[1] - b[1]];
const punto = (a: Punto, b: Punto): number => a[0] * b[0] + a[1] * b[1];
const cruz = (a: Punto, b: Punto): number => a[0] * b[1] - a[1] * b[0];
const unit = (a: Punto, b: Punto): Punto => {
  const l = distancia(a, b) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};

/** Intersección de la recta p + t·u con la recta q + s·w (null si son paralelas). */
function cortar(p: Punto, u: Punto, q: Punto, w: Punto): Punto | null {
  const c = cruz(u, w);
  if (Math.abs(c) < 1e-9) return null;
  const t = cruz(resta(q, p), w) / c;
  return [p[0] + t * u[0], p[1] + t * u[1]];
}

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * Desplaza el muro i de una estancia el vector v: sus dos extremos se deslizan por las paredes
 * contiguas (que conservan su dirección). Lo que va sujeto a las paredes afectadas (huecos, obra)
 * se queda en su sitio: se corrige su «desde» con lo que se ha movido el vértice inicial. Lanza un
 * error claro si la forma no lo admite (pared contigua en línea, estancia que se da la vuelta, un
 * hueco o un elemento que se queda fuera de su pared).
 */
function desplazarMuro(s: Estancia, i: number, v: Punto): void {
  const n = s.contorno.length;
  const c = s.contorno;
  const [a, b] = muro(c, i);
  const u = unit(a, b);
  const a2: Punto = [a[0] + v[0], a[1] + v[1]];
  const prev = c[(i - 1 + n) % n]!;
  const sig = c[(i + 2) % n]!;
  const na = cortar(a2, u, prev, unit(prev, a));
  const nb = cortar(a2, u, b, unit(b, sig));
  if (!na || !nb) {
    const k = !na ? (i - 1 + n) % n : (i + 1) % n;
    throw new ErrorOperacion(`La ${nombrePared(k)} de «${s.nombre}» sigue en línea con la ${nombrePared(i)}: no se puede mover sólo un trozo; quita la esquina que las separa o mueve las dos a la vez`);
  }
  const nuevo = c.map((q) => [q[0], q[1]] as Punto);
  nuevo[i] = [r4(na[0]), r4(na[1])];
  nuevo[(i + 1) % n] = [r4(nb[0]), r4(nb[1])];
  // La estancia no puede darse la vuelta: las paredes contiguas conservan su sentido y el área su signo.
  const sentido = (k: number, pts: Punto[]): Punto => resta(pts[(k + 1) % n]!, pts[k]!);
  for (const k of [(i - 1 + n) % n, (i + 1) % n]) {
    if (punto(sentido(k, nuevo), sentido(k, c)) <= 0) throw new ErrorOperacion(`La ${nombrePared(i)} de «${s.nombre}» llegaría hasta la de enfrente: muévela menos`);
  }
  if (Math.sign(areaConSigno(nuevo)) !== Math.sign(areaConSigno(c)) || Math.abs(areaConSigno(nuevo)) < 1) {
    throw new ErrorOperacion(`La ${nombrePared(i)} de «${s.nombre}» llegaría hasta la de enfrente: muévela menos`);
  }
  // Cuánto se ha corrido el inicio de cada pared afectada a lo largo de ella misma.
  const corrimiento = new Map<number, number>([
    [i, punto(resta(nuevo[i]!, a), u)],
    [(i + 1) % n, punto(resta(nuevo[(i + 1) % n]!, b), unit(b, sig))],
  ]);
  const corregir = <T extends { muro: number; desde: number }>(x: T): T => {
    const d = corrimiento.get(x.muro);
    return d ? { ...x, desde: r4(x.desde - d) } : x;
  };
  s.contorno = nuevo;
  s.huecos = s.huecos.map(corregir);
  if (s.elementos) s.elementos = s.elementos.map((el) => (el.forma === 'adosado' || el.forma === 'punto' ? corregir(el) : el));
  // Lo sujeto a las paredes afectadas tiene que seguir cabiendo en ellas.
  for (const k of [(i - 1 + n) % n, i, (i + 1) % n]) {
    const largo = distancia(nuevo[k]!, nuevo[(k + 1) % n]!);
    for (const h of s.huecos.filter((x) => x.muro === k)) {
      if (h.desde < -TOLERANCIA || h.desde + h.ancho > largo + TOLERANCIA) throw new ErrorOperacion(`${h.tipo === 'ventana' ? 'La ventana' : h.tipo === 'puerta' ? 'La puerta' : 'El paso'} «${h.id}» de «${s.nombre}» se quedaría fuera de la ${nombrePared(k)}: muévela o quítala antes`);
    }
    for (const el of s.elementos ?? []) {
      if ((el.forma !== 'adosado' && el.forma !== 'punto') || el.muro !== k) continue;
      const ancho = el.forma === 'adosado' ? el.ancho : 0;
      if (el.desde < -TOLERANCIA || el.desde + ancho > largo + TOLERANCIA) throw new ErrorOperacion(`«${el.id}» de «${s.nombre}» se quedaría fuera de la ${nombrePared(k)}: muévelo o quítalo antes`);
    }
  }
}

/**
 * Mueve la pared `muro` de una estancia `distancia` cm hacia fuera (negativa, hacia dentro) y, con
 * ella, las paredes de **todas** las estancias de enfrente que forman tabique con ella (paralelas, a
 * menos de TABIQUE_MAX cm y solapadas): cada tabique conserva su grosor y lo que crece una lo encogen
 * las otras. Si la pared de una vecina es más larga que esta (sobresale más que el tabique), no se
 * puede mover sólo en parte: se rechaza y se dice desde qué estancia hacerlo.
 */
export function moverTabique(e: Espacio, estanciaId: string, i: number, d: number): { espacio: Espacio; vecinas: { estancia: string; muro: number }[] } {
  const { planta: p, estancia: s } = estancia(e, estanciaId);
  if (!Number.isInteger(i) || i < 0 || i >= s.contorno.length) throw new ErrorOperacion(`«${estanciaId}» no tiene el muro ${i} (tiene ${s.contorno.length}, del 0 al ${s.contorno.length - 1})`);
  if (!Number.isFinite(d) || d === 0) throw new ErrorOperacion('Indica cuántos cm se mueve la pared (distinto de 0)');
  const [a, b] = muro(s.contorno, i);
  const u = unit(a, b);
  const nIn = normalInterior(s.contorno, i);
  const fuera: Punto = [-nIn[0], -nIn[1]];
  const largo = distancia(a, b);
  const vecinas: { s: Estancia; j: number; sep: number }[] = [];
  for (const o of p.estancias) {
    if (o.id === s.id) continue;
    for (let j = 0; j < o.contorno.length; j++) {
      const [c, dd] = muro(o.contorno, j);
      if (Math.abs(cruz(u, unit(c, dd))) > 1e-6) continue;
      const n2 = normalInterior(o.contorno, j);
      if (punto(n2, nIn) > -0.99) continue;
      const sep = punto(resta(c, a), fuera);
      if (sep < -TOLERANCIA || sep > TABIQUE_MAX) continue;
      const t0 = Math.min(punto(resta(c, a), u), punto(resta(dd, a), u));
      const t1 = Math.max(punto(resta(c, a), u), punto(resta(dd, a), u));
      if (Math.min(t1, largo) - Math.max(t0, 0) <= TOLERANCIA) continue;
      // Una pared de enfrente más larga que esta (más allá del grosor del tabique) no se mueve en parte.
      if (t0 < -sep - TOLERANCIA || t1 > largo + sep + TOLERANCIA) {
        // Si además esta pared sobresale de la de enfrente, sólo se solapan en parte: moverlo desde la otra
        // daría el mismo error (revisión independiente, 10).
        if (t0 > sep + TOLERANCIA || t1 < largo - sep - TOLERANCIA) {
          throw new ErrorOperacion(`La ${nombrePared(i)} de «${s.nombre}» y la ${nombrePared(j)} de «${o.nombre}» sólo se solapan en parte: el tabique no se puede mover desde ninguna de las dos; cambia antes las esquinas de una de ellas`);
        }
        throw new ErrorOperacion(`La ${nombrePared(j)} de «${o.nombre}», al otro lado del tabique, es más larga que la ${nombrePared(i)} de «${s.nombre}» y no se puede mover sólo en parte: mueve el tabique desde «${o.nombre}» o, si da a más estancias, cambia antes las esquinas`);
      }
      vecinas.push({ s: o, j, sep });
    }
  }
  const v: Punto = [fuera[0] * d, fuera[1] * d];
  const r = clonar(e);
  desplazarMuro(estancia(r, s.id).estancia, i, v);
  for (const x of vecinas) desplazarMuro(estancia(r, x.s.id).estancia, x.j, v);
  return { espacio: confirmar(r), vecinas: vecinas.map((x) => ({ estancia: x.s.id, muro: x.j })) };
}

// ---------- Escaleras ----------

export type DatosEscalera = Partial<Omit<Escalera, 'id'>> & { id?: string };

const CAMPOS_FORMA = { recta: ['largo'], L: ['tramos', 'gira'], U: ['tramos', 'gira', 'ojo'], caracol: ['gira', 'poste', 'vuelta'] } as const;

function buscarEscalera(e: Espacio, id: string): { planta: Planta; escalera: Escalera } {
  for (const p of e.plantas) {
    const x = (p.escaleras ?? []).find((s) => s.id === id);
    if (x) return { planta: p, escalera: x };
  }
  const ids = e.plantas.flatMap((p) => (p.escaleras ?? []).map((s) => s.id));
  throw new ErrorOperacion(`No existe la escalera «${id}». Escaleras: ${ids.join(', ') || '(ninguna)'}`);
}

/** Añade una escalera que sube desde `plantaId` (por defecto la primera) a la planta de encima. */
export function agregarEscalera(e: Espacio, d: DatosEscalera, plantaId?: string): { espacio: Espacio; id: string } {
  const p = planta(e, plantaId);
  const usados = idsUsados(e);
  if (d.id !== undefined && usados.has(d.id)) throw new ErrorOperacion(`Ya existe algo con id «${d.id}» (los ids son únicos en todo el archivo)`);
  const id = d.id ?? libre(usados, 'escalera');
  const arriba = plantaDeEncima(e, p);
  if (d.hasta === undefined && !arriba) throw new ErrorOperacion(`No hay ninguna planta encima de «${p.nombre}» (${p.id}): añádela antes (planta agregar --copiar-de ${p.id})`);
  const forma = d.forma ?? 'recta';
  const esc = { ...d, id, forma, giro: d.giro ?? 0, hasta: d.hasta ?? arriba!.id } as Escalera;
  if (forma === 'recta' && esc.largo === undefined) throw new ErrorOperacion('Una escalera recta necesita «largo» (cm)');
  if (forma !== 'recta' && forma !== 'caracol' && esc.tramos === undefined) throw new ErrorOperacion(`Una escalera «${forma}» necesita «tramos»: [largo del tramo 1, largo del tramo 2] (cm)`);
  const r = clonar(e);
  const pr = planta(r, p.id);
  pr.escaleras = [...(pr.escaleras ?? []), esc];
  return { espacio: confirmar(r), id };
}

/** Cambia una escalera. Al cambiar de forma se quitan los campos que la nueva no usa. */
export function editarEscalera(e: Espacio, id: string, cambios: DatosEscalera): Espacio {
  buscarEscalera(e, id);
  if (cambios.id !== undefined && cambios.id !== id) throw new ErrorOperacion('El id de una escalera no se cambia');
  const r = clonar(e);
  const { planta: p, escalera } = buscarEscalera(r, id);
  const nueva = { ...escalera, ...cambios } as Escalera & Record<string, unknown>;
  for (const k of ['largo', 'tramos', 'gira', 'ojo', 'poste', 'vuelta'] as const) if (!(CAMPOS_FORMA[nueva.forma] as readonly string[]).includes(k)) delete nueva[k];
  if (nueva.forma !== 'recta') nueva.gira ??= 'derecha';
  if (nueva.forma === 'recta' && nueva.largo === undefined) throw new ErrorOperacion('Al pasar a recta, indica «largo» (cm)');
  if (nueva.forma !== 'recta' && nueva.forma !== 'caracol' && nueva.tramos === undefined) throw new ErrorOperacion(`Al pasar a «${nueva.forma}», indica «tramos»: [largo del tramo 1, largo del tramo 2]`);
  p.escaleras = p.escaleras!.map((x) => (x.id === id ? nueva : x));
  return confirmar(r);
}

export function quitarEscalera(e: Espacio, id: string): Espacio {
  buscarEscalera(e, id);
  const r = clonar(e);
  const { planta: p } = buscarEscalera(r, id);
  p.escaleras = p.escaleras!.filter((x) => x.id !== id);
  if (!p.escaleras.length) delete p.escaleras;
  return confirmar(r);
}
