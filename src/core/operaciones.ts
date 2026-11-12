// Operaciones puras sobre un espacio: devuelven un espacio nuevo y validado, sin tocar el original.
// Las que afectan a una estancia o una planta aceptan su id; sin él, usan la primera.
import { tipoMueble } from './catalogo.js';
import { buscarMueble, clonar, estancia, estanciaEnPunto, idsUsados, planta } from './espacio.js';
import { cajaContorno, esquinasMueble, muro, normalInterior, normalizarGiro } from './geometria.js';
import type { Espacio, Estancia, Hueco, Mueble, Punto } from './tipos.js';
import { ErrorOperacion, FORMATO, VERSION } from './tipos.js';
import { validar } from './validar.js';
import { analizarPlanta } from './analisis.js';

function confirmar(e: Espacio): Espacio {
  const r = validar(e);
  if (!r.ok) throw new ErrorOperacion(`El resultado no es válido:\n- ${r.errores.join('\n- ')}`);
  return r.espacio;
}

function buscar(e: Espacio, id: string): Mueble {
  const m = buscarMueble(e, id)?.mueble;
  if (!m) {
    const ids = e.plantas.flatMap((p) => p.muebles.map((x) => x.id));
    throw new ErrorOperacion(`No existe el mueble «${id}». Ids: ${ids.join(', ') || '(ninguno)'}`);
  }
  return m;
}

function exigirLibre(m: Mueble): void {
  if (m.bloqueado) throw new ErrorOperacion(`«${m.nombre}» (${m.id}) está bloqueado; desbloquéalo antes de moverlo o quitarlo`);
}

function redondear1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function nuevoEspacio(opciones: { nombre?: string; ancho: number; largo: number; alto?: number; grosorMuros?: number }): Espacio {
  const { ancho, largo } = opciones;
  for (const [k, v] of [['ancho', ancho], ['largo', largo]] as const) {
    if (!Number.isFinite(v) || v <= 0 || v > 100000) throw new ErrorOperacion(`«${k}» debe ser un número de cm entre 0 y 100 000 (es ${v})`);
  }
  return confirmar({
    formato: FORMATO,
    version: VERSION,
    nombre: opciones.nombre ?? 'Mi habitación',
    plantas: [
      {
        id: 'planta-baja',
        nombre: 'Planta baja',
        nivel: 0,
        grosorExterior: opciones.grosorMuros ?? 10,
        estancias: [{ id: 'estancia', nombre: 'Estancia', contorno: [[0, 0], [ancho, 0], [ancho, largo], [0, largo]], altura: opciones.alto ?? 250, huecos: [] }],
        muebles: [],
      },
    ],
    distribuciones: [],
    notas: '',
  });
}

/** Rectángulo (sin girar): ancho a lo largo de x y largo a lo largo de y. */
export function esRectangular(e: Espacio, estanciaId?: string): { ancho: number; largo: number } | null {
  const c = estancia(e, estanciaId).estancia.contorno;
  if (c.length !== 4) return null;
  const { minX, minY, maxX, maxY } = cajaContorno(c);
  const esquinas = new Set(c.map(([x, y]) => `${x},${y}`));
  for (const k of [`${minX},${minY}`, `${maxX},${minY}`, `${maxX},${maxY}`, `${minX},${maxY}`]) if (!esquinas.has(k)) return null;
  return { ancho: maxX - minX, largo: maxY - minY };
}

/**
 * Cambia las medidas de una estancia rectangular conservando el orden de sus vértices
 * (y por tanto el muro de cada hueco). Los muebles no se mueven.
 */
export function redimensionarRectangulo(e: Espacio, ancho: number, largo: number, altura?: number, estanciaId?: string): Espacio {
  if (!(ancho > 0 && largo > 0)) throw new ErrorOperacion('El ancho y el largo deben ser mayores que 0');
  const rect = esRectangular(e, estanciaId);
  if (!rect) throw new ErrorOperacion('La estancia no es rectangular; edita su contorno');
  const r = clonar(e);
  const s = estancia(r, estanciaId ?? estancia(e).estancia.id).estancia;
  const { minX, minY, maxX, maxY } = cajaContorno(s.contorno);
  s.contorno = s.contorno.map(([x, y]) => [x === maxX ? minX + ancho : x, y === maxY ? minY + largo : y]) as typeof s.contorno;
  if (altura !== undefined) s.altura = altura;
  return confirmar(r);
}

/** Id libre en todo el archivo a partir de un texto (sin tildes ni espacios). */
export function idLibre(e: Espacio, base: string): string {
  const limpio =
    base
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'mueble';
  const usados = idsUsados(e);
  if (!usados.has(limpio)) return limpio;
  for (let i = 2; ; i++) if (!usados.has(`${limpio}-${i}`)) return `${limpio}-${i}`;
}

export type DatosMueble = Partial<Omit<Mueble, 'tipo'>> & {
  tipo: string;
  /** Estancia donde aparece si no se da posición (por defecto, la primera de la planta). */
  estancia?: string;
};

/**
 * Sitio para colgar algo de ancho × fondo, entre las alturas z0 y z1, en la pared más cercana al
 * centro de la estancia que tenga un tramo libre de puertas, pasos y ventanas (con 5 cm de margen) y
 * de los muebles que ya ocupan esa pared a esa altura (`otros`): lo más centrado posible en ese
 * tramo, con la trasera contra la pared y el frente hacia dentro. null si no cabe en ninguna.
 */
export function sitioEnPared(
  s: Estancia, ancho: number, fondo: number, otros: readonly Mueble[] = [], z0 = 0, z1 = Infinity,
): { x: number; y: number; giro: number } | null {
  return sitiosEnPared(s, ancho, fondo, otros, z0, z1)[0] ?? null;
}

/**
 * Sitios candidatos para colgar, por orden de preferencia: pared más cercana primero y, en cada tramo
 * libre, del centro hacia fuera cada 20 cm. Quien cuelga prueba cada uno con el análisis (revisión de
 * código, 3): así se evitan también la puerta de la vecina en un tabique, la obra y el techo inclinado.
 */
export function sitiosEnPared(
  s: Estancia, ancho: number, fondo: number, otros: readonly Mueble[] = [], z0 = 0, z1 = Infinity,
): { x: number; y: number; giro: number }[] {
  const res: { x: number; y: number; giro: number }[] = [];
  const c = s.contorno;
  const caja = cajaContorno(c as [number, number][]);
  const centro: Punto = [(caja.minX + caja.maxX) / 2, (caja.minY + caja.maxY) / 2];
  const muros = c.map((_, i) => {
    const [a, b] = muro(c, i);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t: Punto = L > 0 ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : [1, 0];
    const k = Math.max(0, Math.min(L, (centro[0] - a[0]) * t[0] + (centro[1] - a[1]) * t[1]));
    return { i, a, t, L, d: Math.hypot(centro[0] - (a[0] + t[0] * k), centro[1] - (a[1] + t[1] * k)) };
  }).sort((x, y) => x.d - y.d);
  for (const w of muros) {
    // Tramos libres de la pared, sin los huecos (y 5 cm a cada lado).
    let libres: [number, number][] = [[0, w.L]];
    for (const h of s.huecos.filter((x) => x.muro === w.i)) {
      const h0 = h.desde - 5;
      const h1 = h.desde + h.ancho + 5;
      libres = libres.flatMap(([u0, u1]) => [[u0, Math.min(u1, h0)], [Math.max(u0, h1), u1]] as [number, number][]).filter(([u0, u1]) => u1 - u0 > 0.01);
    }
    // Lo que ya está contra esta pared (a menos de `fondo` de ella) a la misma altura.
    const n0 = normalInterior(c, w.i);
    for (const o of otros) {
      if (!(o.elevacion < z1 && o.elevacion + o.alto > z0)) continue;
      const q = esquinasMueble(o);
      const dentro = q.map((p) => (p[0] - w.a[0]) * n0[0] + (p[1] - w.a[1]) * n0[1]);
      if (Math.min(...dentro) >= fondo - 0.1 || Math.max(...dentro) <= 0) continue;
      const us = q.map((p) => (p[0] - w.a[0]) * w.t[0] + (p[1] - w.a[1]) * w.t[1]);
      const o0 = Math.min(...us) - 2;
      const o1 = Math.max(...us) + 2;
      libres = libres.flatMap(([u0, u1]) => [[u0, Math.min(u1, o0)], [Math.max(u0, o1), u1]] as [number, number][]).filter(([u0, u1]) => u1 - u0 > 0.01);
    }
    const medio = w.L / 2;
    const n = normalInterior(c, w.i);
    const giro = normalizarGiro((Math.atan2(-n[0], n[1]) * 180) / Math.PI);
    // En cada tramo libre, la posición más centrada y, alternando, cada 20 cm hacia los extremos.
    const desdes: number[] = [];
    for (const [u0, u1] of libres) {
      if (u1 - u0 < ancho - 0.01) continue;
      const centrado = Math.max(u0, Math.min(u1 - ancho, medio - ancho / 2));
      desdes.push(centrado);
      for (let k = 1; k <= 12; k++) {
        for (const d of [centrado + 20 * k, centrado - 20 * k]) if (d >= u0 - 1e-9 && d <= u1 - ancho + 1e-9) desdes.push(d);
      }
    }
    desdes.sort((p, q) => Math.abs(p + ancho / 2 - medio) - Math.abs(q + ancho / 2 - medio));
    for (const desde of desdes) {
      const sc = desde + ancho / 2;
      res.push({ x: redondear1(w.a[0] + w.t[0] * sc + n[0] * (fondo / 2)), y: redondear1(w.a[1] + w.t[1] * sc + n[1] * (fondo / 2)), giro });
    }
  }
  return res;
}

/** Añade un mueble a una planta (por defecto la primera); sin posición, en el centro de su primera estancia. */
export function agregarMueble(e: Espacio, datos: DatosMueble, plantaId?: string): { espacio: Espacio; id: string } {
  const base = tipoMueble(datos.tipo);
  const p0 = planta(e, plantaId);
  const est = datos.estancia !== undefined ? p0.estancias.find((s) => s.id === datos.estancia) : p0.estancias[0];
  if (datos.estancia !== undefined && !est) throw new ErrorOperacion(`La estancia «${datos.estancia}» no es de la planta «${p0.id}»`);
  const caja = cajaContorno((est ?? { contorno: [[0, 0]] }).contorno as [number, number][]);
  // Lo de pared, sin posición, se cuelga en la pared más cercana con sitio (si no, en el centro).
  const elev = datos.elevacion ?? base.elevacion ?? 0;
  const candidatos =
    base.pared && est && datos.x === undefined && datos.y === undefined
      ? sitiosEnPared(est, datos.ancho ?? base.ancho, datos.fondo ?? base.fondo, p0.muebles, elev, elev + (datos.alto ?? base.alto))
      : [];
  const colgado = candidatos[0] ?? null;
  const id = datos.id ?? idLibre(e, datos.tipo);
  if (idsUsados(e).has(id)) throw new ErrorOperacion(`Ya existe algo con id «${id}» (los ids son únicos en todo el archivo)`);
  const alto = datos.alto ?? base.alto;
  const mueble: Mueble = {
    id,
    nombre: datos.nombre ?? base.etiqueta,
    tipo: datos.tipo,
    ancho: datos.ancho ?? base.ancho,
    fondo: datos.fondo ?? base.fondo,
    alto,
    x: datos.x ?? colgado?.x ?? redondear1((caja.minX + caja.maxX) / 2),
    y: datos.y ?? colgado?.y ?? redondear1((caja.minY + caja.maxY) / 2),
    giro: normalizarGiro(datos.giro ?? colgado?.giro ?? 0),
    elevacion: datos.elevacion ?? base.elevacion ?? 0,
    color: datos.color ?? base.color,
    bloqueado: datos.bloqueado ?? false,
    holguraFrente: datos.holguraFrente ?? base.holguraFrente,
    huecoInferior: datos.huecoInferior ?? (base.huecoInferior < alto ? base.huecoInferior : 0),
    ...(datos.piezas?.length ? { piezas: datos.piezas } : {}),
    ...(datos.modelo ? { modelo: datos.modelo } : {}),
  };
  // De los sitios en la pared, el primero donde el análisis no da ningún error con él (los 80 primeros).
  for (const c of candidatos.slice(0, 80)) {
    const prueba = { ...p0, muebles: [...p0.muebles, { ...mueble, ...c }] };
    if (!analizarPlanta(prueba).some((i) => i.gravedad === 'error' && i.muebles.includes(id))) {
      Object.assign(mueble, c);
      break;
    }
  }
  const r = clonar(e);
  planta(r, p0.id).muebles.push(mueble);
  return { espacio: confirmar(r), id };
}

export function editarMueble(e: Espacio, id: string, cambios: Partial<Omit<Mueble, 'id'>>): Espacio {
  const actual = buscar(e, id);
  const mueve = ['x', 'y', 'giro'].some((k) => k in cambios && (cambios as Record<string, unknown>)[k] !== (actual as unknown as Record<string, unknown>)[k]);
  if (mueve && actual.bloqueado && cambios.bloqueado !== false) exigirLibre(actual);
  const r = clonar(e);
  const m = buscar(r, id);
  Object.assign(m, cambios);
  if (cambios.giro !== undefined) m.giro = normalizarGiro(cambios.giro);
  return confirmar(r);
}

export function moverMueble(e: Espacio, id: string, x: number, y: number): Espacio {
  return editarMueble(e, id, { x: redondear1(x), y: redondear1(y) });
}

/** Pasa un mueble a otra planta (en la misma posición x, y salvo que se indique otra). */
export function cambiarDePlanta(e: Espacio, id: string, plantaId: string, x?: number, y?: number): Espacio {
  const actual = buscar(e, id);
  exigirLibre(actual);
  planta(e, plantaId);
  const r = clonar(e);
  const origen = buscarMueble(r, id)!;
  origen.planta.muebles = origen.planta.muebles.filter((m) => m.id !== id);
  planta(r, plantaId).muebles.push({ ...origen.mueble, x: x ?? origen.mueble.x, y: y ?? origen.mueble.y });
  return confirmar(r);
}

export function girarMueble(e: Espacio, id: string, giro: number): Espacio {
  return editarMueble(e, id, { giro });
}

/**
 * Cambia el tipo y actualiza lo que seguía en los valores por defecto del tipo anterior
 * (nombre, color, holgura y hueco inferior). Las medidas se conservan: son las reales.
 */
export function cambiarTipo(e: Espacio, id: string, tipo: string): Espacio {
  const m = buscar(e, id);
  const viejo = tipoMueble(m.tipo);
  const nuevo = tipoMueble(tipo);
  const cambios: Partial<Mueble> = { tipo };
  if (m.nombre === viejo.etiqueta) cambios.nombre = nuevo.etiqueta;
  if (m.color === viejo.color) cambios.color = nuevo.color;
  if (m.holguraFrente === viejo.holguraFrente) cambios.holguraFrente = nuevo.holguraFrente;
  if (m.huecoInferior === viejo.huecoInferior) cambios.huecoInferior = nuevo.huecoInferior < m.alto ? nuevo.huecoInferior : 0;
  return editarMueble(e, id, cambios);
}

export function quitarMueble(e: Espacio, id: string): Espacio {
  exigirLibre(buscar(e, id));
  const r = clonar(e);
  const p = buscarMueble(r, id)!.planta;
  p.muebles = p.muebles.filter((m) => m.id !== id);
  return confirmar(r);
}

export function duplicarMueble(e: Espacio, id: string, desplazamiento = 20): { espacio: Espacio; id: string } {
  const m = buscar(e, id);
  const p = buscarMueble(e, id)!.planta;
  const { id: _viejo, ...resto } = m;
  // Lo colgado se duplica en la misma pared, al lado (a lo ancho del mueble): si no, se despegaría de
  // ella (revisión independiente, 12).
  const g = (m.giro * Math.PI) / 180;
  const [dx, dy] = tipoMueble(m.tipo).pared && m.elevacion > 0 ? [Math.cos(g) * (m.ancho + 5), Math.sin(g) * (m.ancho + 5)] : [desplazamiento, desplazamiento];
  return agregarMueble(
    e,
    { ...resto, id: idLibre(e, m.id.replace(/-\d+$/, '')), x: redondear1(m.x + dx), y: redondear1(m.y + dy), bloqueado: false },
    p.id,
  );
}

// ---------- Huecos ----------

export type DatosHueco = Partial<Hueco> & Pick<Hueco, 'tipo' | 'muro' | 'desde' | 'ancho'>;

/** Añade un hueco a una estancia (por defecto la primera). */
export function agregarHueco(e: Espacio, datos: DatosHueco, estanciaId?: string): { espacio: Espacio; id: string } {
  const usados = idsUsados(e);
  let id = datos.id ?? datos.tipo;
  if (datos.id === undefined) for (let i = 2; usados.has(id); i++) id = `${datos.tipo}-${i}`;
  if (usados.has(id)) throw new ErrorOperacion(`Ya existe algo con id «${id}» (los ids son únicos en todo el archivo)`);
  const r = clonar(e);
  const s = estancia(r, estanciaId ?? estancia(e).estancia.id).estancia;
  const h: Record<string, unknown> = { id, tipo: datos.tipo, muro: datos.muro, desde: datos.desde, ancho: datos.ancho };
  for (const k of ['alto', 'antepecho', 'abre', 'bisagra'] as const) if (datos[k] !== undefined) h[k] = datos[k];
  s.huecos.push(h as unknown as Hueco);
  return { espacio: confirmar(r), id };
}

/** Estancia que tiene el hueco `id`. */
export function estanciaDeHueco(e: Espacio, id: string): string {
  for (const p of e.plantas) for (const s of p.estancias) if (s.huecos.some((h) => h.id === id)) return s.id;
  const ids = e.plantas.flatMap((p) => p.estancias.flatMap((s) => s.huecos.map((h) => h.id)));
  throw new ErrorOperacion(`No existe el hueco «${id}». Ids: ${ids.join(', ') || '(ninguno)'}`);
}

export function quitarHueco(e: Espacio, id: string): Espacio {
  const sid = estanciaDeHueco(e, id);
  const r = clonar(e);
  const s = estancia(r, sid).estancia;
  s.huecos = s.huecos.filter((h) => h.id !== id);
  return confirmar(r);
}

// ---------- Distribuciones ----------

/** Guarda (o sustituye) la posición, el giro y la planta actuales de todos los muebles con un nombre. */
export function guardarDistribucion(e: Espacio, nombre: string): Espacio {
  if (!nombre.trim()) throw new ErrorOperacion('La distribución necesita un nombre');
  const r = clonar(e);
  const variasPlantas = r.plantas.length > 1;
  const posiciones = Object.fromEntries(
    r.plantas.flatMap((p) => p.muebles.map((m) => [m.id, { x: m.x, y: m.y, giro: m.giro, ...(variasPlantas ? { planta: p.id } : {}) }])),
  );
  r.distribuciones = [...r.distribuciones.filter((d) => d.nombre !== nombre), { nombre, posiciones }];
  return confirmar(r);
}

/**
 * Coloca los muebles como en la distribución. Los ids que ya no existen se ignoran y se informan;
 * los muebles que no aparecen en ella no se mueven. Los bloqueados tampoco.
 */
export function aplicarDistribucion(e: Espacio, nombre: string): { espacio: Espacio; ignorados: string[]; sinPosicion: string[]; bloqueados: string[] } {
  const d = e.distribuciones.find((x) => x.nombre === nombre);
  if (!d) throw new ErrorOperacion(`No existe la distribución «${nombre}». Hay: ${e.distribuciones.map((x) => x.nombre).join(', ') || '(ninguna)'}`);
  const r = clonar(e);
  const todos = r.plantas.flatMap((p) => p.muebles.map((m) => ({ p, m })));
  const ids = new Set(todos.map((x) => x.m.id));
  const ignorados = Object.keys(d.posiciones).filter((id) => !ids.has(id));
  const sinPosicion = todos.filter(({ m }) => !(m.id in d.posiciones)).map(({ m }) => m.id);
  const bloqueados: string[] = [];
  for (const { p, m } of todos) {
    const pos = d.posiciones[m.id];
    if (!pos) continue;
    const otraPlanta = pos.planta !== undefined && pos.planta !== p.id;
    if (m.bloqueado && (pos.x !== m.x || pos.y !== m.y || pos.giro !== m.giro || otraPlanta)) {
      bloqueados.push(m.id);
      continue;
    }
    Object.assign(m, { x: pos.x, y: pos.y, giro: pos.giro });
    if (otraPlanta && r.plantas.some((x) => x.id === pos.planta)) {
      p.muebles = p.muebles.filter((x) => x.id !== m.id);
      planta(r, pos.planta).muebles.push(m);
    }
  }
  return { espacio: confirmar(r), ignorados, sinPosicion, bloqueados };
}

export function quitarDistribucion(e: Espacio, nombre: string): Espacio {
  if (!e.distribuciones.some((d) => d.nombre === nombre)) throw new ErrorOperacion(`No existe la distribución «${nombre}»`);
  const r = clonar(e);
  r.distribuciones = r.distribuciones.filter((d) => d.nombre !== nombre);
  return confirmar(r);
}

export function renombrarEspacio(e: Espacio, nombre: string): Espacio {
  const r = clonar(e);
  r.nombre = nombre;
  return confirmar(r);
}

/** Estancia (id) que contiene un punto de una planta, o null. */
export function estanciaEn(e: Espacio, x: number, y: number, plantaId?: string): string | null {
  return estanciaEnPunto(planta(e, plantaId), [x, y])?.id ?? null;
}

// ---------- Estancias (ronda 2: varias por planta) ----------

export interface DatosEstancia {
  id?: string;
  nombre?: string;
  contorno: Punto[];
  altura?: number;
}

/** Añade una estancia a una planta. No puede solaparse con otra (lo comprueba la validación). */
export function agregarEstancia(e: Espacio, datos: DatosEstancia, plantaId?: string): { espacio: Espacio; id: string } {
  const p0 = planta(e, plantaId);
  const id = datos.id ?? idLibre(e, datos.nombre ?? 'estancia');
  if (idsUsados(e).has(id)) throw new ErrorOperacion(`Ya existe algo con id «${id}» (los ids son únicos en todo el archivo)`);
  const altura = datos.altura ?? p0.estancias[0]?.altura ?? 250;
  const r = clonar(e);
  planta(r, p0.id).estancias.push({ id, nombre: datos.nombre ?? id, contorno: datos.contorno.map(([x, y]) => [x, y] as Punto), altura, huecos: [] });
  return { espacio: confirmar(r), id };
}

/**
 * Quita una estancia con sus puertas y ventanas. Los muebles son de la planta y se quedan donde
 * estaban (el análisis dirá si quedan fuera). No se puede quitar la última estancia de una planta.
 */
export function quitarEstancia(e: Espacio, id: string): { espacio: Espacio; mueblesDentro: string[] } {
  const { planta: p, estancia: s } = estancia(e, id);
  if (p.estancias.length === 1) throw new ErrorOperacion(`«${id}» es la única estancia de la planta «${p.id}»: cambia su forma en vez de quitarla`);
  const dentro = p.muebles.filter((m) => estanciaEnPunto(p, [m.x, m.y])?.id === s.id).map((m) => m.id);
  const r = clonar(e);
  const pr = planta(r, p.id);
  pr.estancias = pr.estancias.filter((x) => x.id !== id);
  return { espacio: confirmar(r), mueblesDentro: dentro };
}

export function renombrarEstancia(e: Espacio, id: string, nombre: string): Espacio {
  estancia(e, id);
  const r = clonar(e);
  estancia(r, id).estancia.nombre = nombre;
  return confirmar(r);
}
