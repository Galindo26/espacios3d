// Validación y normalización del formato *.espacio.json. Rechaza campos desconocidos (salvo
// `notas`), completa los valores por defecto y devuelve errores con la ruta del campo.
import { ErrorGeometria, seSolapan } from './booleanas.js';
import { tipoMueble } from './catalogo.js';
import { esPoligonoSimple, longitudMuro, muro, normalizarGiro } from './geometria.js';
import type { Distribucion, Elemento, Escalera, Espacio, Estancia, Faldon, Fondo, Hueco, ModeloMueble, Mueble, Pieza, Planta, Posicion, Punto, Suelo } from './tipos.js';
import { FORMATO, TOLERANCIA, VERSION } from './tipos.js';

export type ResultadoValidacion =
  /** `migradoDesde: 1` si el archivo era de la v1: el espacio ya está en v2 y se escribirá así. */
  | { ok: true; espacio: Espacio; avisos: string[]; migradoDesde?: 1 }
  | { ok: false; errores: string[] };

const RE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const RE_COLOR = /^#[0-9a-fA-F]{6}$/;

class Contexto {
  errores: string[] = [];
  avisos: string[] = [];
  error(ruta: string, msg: string): void {
    this.errores.push(`${ruta}: ${msg}`);
  }
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function camposDesconocidos(ctx: Contexto, ruta: string, obj: Record<string, unknown>, permitidos: readonly string[]): void {
  for (const k of Object.keys(obj)) {
    if (!permitidos.includes(k)) ctx.error(ruta, `campo desconocido «${k}» (permitidos: ${permitidos.join(', ')})`);
  }
}

function numero(
  ctx: Contexto,
  ruta: string,
  v: unknown,
  opciones: { defecto?: number; min?: number; minExcl?: number; max?: number; entero?: boolean } = {},
): number {
  if (v === undefined && opciones.defecto !== undefined) return opciones.defecto;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    ctx.error(ruta, v === undefined ? 'falta (número)' : 'debe ser un número');
    return opciones.defecto ?? 0;
  }
  if (opciones.entero && !Number.isInteger(v)) ctx.error(ruta, 'debe ser un número entero');
  if (opciones.min !== undefined && v < opciones.min) ctx.error(ruta, `debe ser ≥ ${opciones.min}`);
  if (opciones.minExcl !== undefined && v <= opciones.minExcl) ctx.error(ruta, `debe ser > ${opciones.minExcl}`);
  if (opciones.max !== undefined && v > opciones.max) ctx.error(ruta, `debe ser ≤ ${opciones.max}`);
  return v;
}

function texto(ctx: Contexto, ruta: string, v: unknown, defecto?: string): string {
  if (v === undefined && defecto !== undefined) return defecto;
  if (typeof v !== 'string') {
    ctx.error(ruta, v === undefined ? 'falta (texto)' : 'debe ser texto');
    return defecto ?? '';
  }
  return v;
}

function opcion<T extends string>(ctx: Contexto, ruta: string, v: unknown, valores: readonly T[], defecto: T): T {
  if (v === undefined) return defecto;
  if (typeof v !== 'string' || !(valores as readonly string[]).includes(v)) {
    ctx.error(ruta, `debe ser uno de: ${valores.join(', ')}`);
    return defecto;
  }
  return v as T;
}

const CAMPOS_ESPACIO_V1 = ['formato', 'version', 'nombre', 'estancia', 'muebles', 'distribuciones', 'notas'] as const;
const CAMPOS_ESTANCIA_V1 = ['contorno', 'altura', 'grosorMuros', 'huecos'] as const;
const CAMPOS_ESPACIO = ['formato', 'version', 'nombre', 'plantas', 'distribuciones', 'notas'] as const;
const CAMPOS_PLANTA = ['id', 'nombre', 'nivel', 'grosorExterior', 'estancias', 'muebles', 'fondos', 'escaleras'] as const;
const CAMPOS_ESCALERA = ['id', 'forma', 'x', 'y', 'ancho', 'giro', 'hasta', 'peldanos', 'largo', 'tramos', 'gira', 'ojo', 'poste', 'vuelta'] as const;
const CAMPOS_FONDO = ['id', 'archivo', 'anchoPx', 'altoPx', 'escala', 'x', 'y', 'giro', 'opacidad'] as const;
const CAMPOS_ESTANCIA = ['id', 'nombre', 'contorno', 'altura', 'huecos', 'elementos', 'faldones', 'circuloDeGiro', 'suelo', 'paredes', 'fotos'] as const;
const CAMPOS_ELEMENTO: Record<Elemento['forma'], readonly string[]> = {
  exento: ['id', 'tipo', 'forma', 'x', 'y', 'ancho', 'fondo', 'giro', 'redondo', 'alto', 'elevacion'],
  adosado: ['id', 'tipo', 'forma', 'muro', 'desde', 'ancho', 'fondo', 'alto', 'elevacion'],
  punto: ['id', 'tipo', 'forma', 'muro', 'desde', 'altura'],
  viga: ['id', 'tipo', 'forma', 'de', 'a', 'ancho', 'canto'],
};
const TIPO_POR_FORMA: Record<Elemento['forma'], string> = { exento: 'columna', adosado: 'pilar', punto: 'enchufe', viga: 'viga' };
const CAMPOS_FALDON = ['muro', 'alturaEnMuro', 'alcance'] as const;
const CAMPOS_HUECO = ['id', 'tipo', 'muro', 'desde', 'ancho', 'alto', 'antepecho', 'abre', 'bisagra'] as const;
const CAMPOS_MUEBLE = [
  'id', 'nombre', 'tipo', 'ancho', 'fondo', 'alto', 'x', 'y', 'giro', 'elevacion', 'color', 'bloqueado',
  'holguraFrente', 'huecoInferior', 'piezas', 'modelo', 'fotos',
] as const;
const CAMPOS_PIEZA = ['forma', 'x', 'y', 'z', 'ancho', 'fondo', 'alto', 'giro', 'color'] as const;
const CAMPOS_MODELO = ['archivo', 'giro', 'ajuste'] as const;
const CAMPOS_DISTRIBUCION = ['nombre', 'posiciones'] as const;
const CAMPOS_POSICION_V1 = ['x', 'y', 'giro'] as const;
const CAMPOS_POSICION = ['x', 'y', 'giro', 'planta'] as const;

function validarContorno(ctx: Contexto, ruta: string, v: unknown): Punto[] {
  if (!Array.isArray(v) || v.length < 3) {
    ctx.error(ruta, 'debe ser una lista de al menos 3 puntos [x, y]');
    return [];
  }
  const puntos: Punto[] = [];
  v.forEach((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((c) => typeof c === 'number' && Number.isFinite(c))) {
      ctx.error(`${ruta}[${i}]`, 'debe ser [x, y] con dos números');
    } else {
      puntos.push([p[0] as number, p[1] as number]);
    }
  });
  if (puntos.length === v.length && !esPoligonoSimple(puntos)) {
    ctx.error(ruta, 'el contorno no es una estancia válida: se cruza o se toca a sí mismo, repite vértices, vuelve sobre una arista o no tiene área');
  }
  return puntos;
}

function validarHueco(ctx: Contexto, ruta: string, v: unknown, contorno: Punto[], altura: number): Hueco | null {
  if (!esObjeto(v)) {
    ctx.error(ruta, 'debe ser un objeto');
    return null;
  }
  camposDesconocidos(ctx, ruta, v, CAMPOS_HUECO);
  const id = texto(ctx, `${ruta}.id`, v.id);
  if (typeof v.id === 'string' && !RE_ID.test(id)) ctx.error(`${ruta}.id`, 'no vacío; sólo letras sin tilde, números, «_», «-» y «.» (máx. 64)');
  if (v.tipo === undefined) ctx.error(`${ruta}.tipo`, 'falta (puerta, ventana o paso)');
  const tipo = opcion(ctx, `${ruta}.tipo`, v.tipo, ['puerta', 'ventana', 'paso'] as const, 'puerta');
  const nMuros = contorno.length;
  const muro = numero(ctx, `${ruta}.muro`, v.muro, { min: 0, max: Math.max(0, nMuros - 1), entero: true });
  const desde = numero(ctx, `${ruta}.desde`, v.desde, { min: 0 });
  const ancho = numero(ctx, `${ruta}.ancho`, v.ancho, { minExcl: 0 });
  const defectoAlto = tipo === 'ventana' ? 120 : 205;
  const alto = numero(ctx, `${ruta}.alto`, v.alto, { minExcl: 0, defecto: defectoAlto });
  const antepecho = numero(ctx, `${ruta}.antepecho`, v.antepecho, { min: 0, defecto: tipo === 'ventana' ? 90 : 0 });
  if (tipo !== 'ventana' && antepecho !== 0) ctx.error(`${ruta}.antepecho`, 'sólo las ventanas tienen antepecho');
  if (tipo !== 'puerta' && (v.abre !== undefined || v.bisagra !== undefined)) {
    ctx.error(ruta, '«abre» y «bisagra» sólo valen para puertas');
  }
  const abre = opcion(ctx, `${ruta}.abre`, v.abre, ['dentro', 'fuera', 'corredera'] as const, 'dentro');
  const bisagra = opcion(ctx, `${ruta}.bisagra`, v.bisagra, ['inicio', 'fin'] as const, 'inicio');
  if (nMuros >= 3 && Number.isInteger(muro) && muro >= 0 && muro < nMuros) {
    const largo = longitudMuro(contorno, muro);
    if (desde + ancho > largo + TOLERANCIA) {
      ctx.error(ruta, `no cabe en el muro ${muro} (pared ${muro + 1} en la página): desde ${desde} + ancho ${ancho} > ${round1(largo)} cm`);
    }
  }
  if (antepecho + alto > altura + TOLERANCIA) ctx.error(ruta, `antepecho + alto (${antepecho + alto}) supera la altura de la estancia (${altura})`);
  // abre y bisagra sólo existen en las puertas: en otro tipo no se escriben (si no, al releer serían un error).
  return tipo === 'puerta' ? { id, tipo, muro, desde, ancho, alto, antepecho, abre, bisagra } : { id, tipo, muro, desde, ancho, alto, antepecho };
}

/** Contorno, altura y huecos de una estancia (común a v1 y v2), con rutas a partir de `ruta`. */
function validarCuerpoEstancia(ctx: Contexto, ruta: string, v: Record<string, unknown>, ids: Set<string>): Pick<Estancia, 'contorno' | 'altura' | 'huecos'> {
  const contorno = validarContorno(ctx, `${ruta}.contorno`, v.contorno);
  const altura = numero(ctx, `${ruta}.altura`, v.altura, { minExcl: 0, defecto: 250 });
  const huecos: Hueco[] = [];
  if (v.huecos !== undefined && !Array.isArray(v.huecos)) ctx.error(`${ruta}.huecos`, 'debe ser una lista');
  const lista = Array.isArray(v.huecos) ? v.huecos : [];
  lista.forEach((h, i) => {
    const hueco = validarHueco(ctx, `${ruta}.huecos[${i}]`, h, contorno, altura);
    if (!hueco) return;
    if (ids.has(hueco.id)) ctx.error(`${ruta}.huecos[${i}].id`, `«${hueco.id}» repetido`);
    ids.add(hueco.id);
    huecos.push(hueco);
  });
  // Huecos del mismo muro que se pisan.
  for (let i = 0; i < huecos.length; i++) {
    for (let j = i + 1; j < huecos.length; j++) {
      const a = huecos[i] as Hueco;
      const b = huecos[j] as Hueco;
      if (a.muro === b.muro && a.desde < b.desde + b.ancho - TOLERANCIA && b.desde < a.desde + a.ancho - TOLERANCIA) {
        ctx.error(`${ruta}.huecos`, `«${a.id}» y «${b.id}» se pisan en el muro ${a.muro}`);
      }
    }
  }
  return { contorno, altura, huecos };
}

function punto2(ctx: Contexto, ruta: string, v: unknown): Punto {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    ctx.error(ruta, 'debe ser un punto [x, y] en cm');
    return [0, 0];
  }
  return [v[0] as number, v[1] as number];
}

/** Muro y tramo de un elemento anclado: el muro existe y el tramo cabe en él. */
function anclaEnMuro(ctx: Contexto, ruta: string, contorno: readonly Punto[], muro: number, desde: number, ancho: number): void {
  if (!contorno.length) return;
  if (!Number.isInteger(muro) || muro < 0 || muro >= contorno.length) {
    ctx.error(`${ruta}.muro`, `no existe el muro ${muro} (hay ${contorno.length}: 0 a ${contorno.length - 1})`);
    return;
  }
  const largo = longitudMuro(contorno, muro);
  if (desde + ancho > largo + TOLERANCIA) ctx.error(ruta, `no cabe en el muro ${muro} (mide ${round1(largo)} cm)`);
}

function validarElementos(ctx: Contexto, ruta: string, v: unknown, contorno: readonly Punto[], altura: number, ids: Set<string>): Elemento[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    ctx.error(ruta, 'debe ser una lista');
    return [];
  }
  const res: Elemento[] = [];
  v.forEach((x, i) => {
    const r = `${ruta}[${i}]`;
    if (!esObjeto(x)) {
      ctx.error(r, 'debe ser un objeto');
      return;
    }
    const forma = x.forma;
    if (forma !== 'exento' && forma !== 'adosado' && forma !== 'punto' && forma !== 'viga') {
      ctx.error(`${r}.forma`, 'debe ser exento, adosado, punto o viga');
      return;
    }
    camposDesconocidos(ctx, r, x, CAMPOS_ELEMENTO[forma]);
    const id = validarId(ctx, `${r}.id`, x.id, ids);
    const tipo = texto(ctx, `${r}.tipo`, x.tipo, TIPO_POR_FORMA[forma]);
    const alto = (): { alto?: number } => (x.alto === undefined ? {} : { alto: numero(ctx, `${r}.alto`, x.alto, { minExcl: 0, max: altura }) });
    if (forma === 'exento') {
      let redondo = false;
      if (x.redondo !== undefined) {
        if (typeof x.redondo !== 'boolean') ctx.error(`${r}.redondo`, 'debe ser true o false');
        else redondo = x.redondo;
      }
      const elev = numero(ctx, `${r}.elevacion`, x.elevacion, { min: 0, defecto: 0 });
      if (typeof x.alto === 'number' && elev + x.alto > altura + TOLERANCIA) ctx.error(r, `elevación + alto (${elev + x.alto}) supera la altura de la estancia (${altura})`);
      if (x.alto === undefined && elev >= altura - TOLERANCIA) ctx.error(`${r}.elevacion`, `debe ser menor que la altura de la estancia (${altura}): sin «alto», llega hasta el techo`);
      res.push({
        id, tipo, forma,
        x: numero(ctx, `${r}.x`, x.x), y: numero(ctx, `${r}.y`, x.y),
        ancho: numero(ctx, `${r}.ancho`, x.ancho, { minExcl: 0 }), fondo: numero(ctx, `${r}.fondo`, x.fondo, { minExcl: 0, defecto: typeof x.ancho === 'number' ? x.ancho : undefined }),
        giro: normalizarGiro(numero(ctx, `${r}.giro`, x.giro, { defecto: 0 })), redondo, ...alto(),
        elevacion: numero(ctx, `${r}.elevacion`, x.elevacion, { min: 0, defecto: 0 }),
      });
    } else if (forma === 'adosado') {
      const muro = numero(ctx, `${r}.muro`, x.muro, { min: 0, entero: true });
      const desde = numero(ctx, `${r}.desde`, x.desde, { min: 0 });
      const ancho = numero(ctx, `${r}.ancho`, x.ancho, { minExcl: 0 });
      anclaEnMuro(ctx, r, contorno, muro, desde, ancho);
      const elev = numero(ctx, `${r}.elevacion`, x.elevacion, { min: 0, defecto: 0 });
      if (typeof x.alto === 'number' && elev + x.alto > altura + TOLERANCIA) ctx.error(r, `elevación + alto (${elev + x.alto}) supera la altura de la estancia (${altura})`);
      if (x.alto === undefined && elev >= altura - TOLERANCIA) ctx.error(`${r}.elevacion`, `debe ser menor que la altura de la estancia (${altura}): sin «alto», llega hasta el techo`);
      res.push({ id, tipo, forma, muro, desde, ancho, fondo: numero(ctx, `${r}.fondo`, x.fondo, { minExcl: 0 }), ...alto(), elevacion: elev });
    } else if (forma === 'punto') {
      const muro = numero(ctx, `${r}.muro`, x.muro, { min: 0, entero: true });
      const desde = numero(ctx, `${r}.desde`, x.desde, { min: 0 });
      anclaEnMuro(ctx, r, contorno, muro, desde, 0);
      res.push({ id, tipo, forma, muro, desde, altura: numero(ctx, `${r}.altura`, x.altura, { min: 0, max: altura, defecto: 30 }) });
    } else {
      const de = punto2(ctx, `${r}.de`, x.de);
      const a = punto2(ctx, `${r}.a`, x.a);
      if (Math.hypot(a[0] - de[0], a[1] - de[1]) < TOLERANCIA) ctx.error(r, 'la viga necesita dos puntos distintos');
      res.push({ id, tipo, forma, de, a, ancho: numero(ctx, `${r}.ancho`, x.ancho, { minExcl: 0, defecto: 20 }), canto: numero(ctx, `${r}.canto`, x.canto, { minExcl: 0, max: altura, defecto: 25 }) });
    }
  });
  return res;
}

function validarFaldones(ctx: Contexto, ruta: string, v: unknown, contorno: readonly Punto[], altura: number): Faldon[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    ctx.error(ruta, 'debe ser una lista');
    return [];
  }
  const res: Faldon[] = [];
  const muros = new Set<number>();
  v.forEach((x, i) => {
    const r = `${ruta}[${i}]`;
    if (!esObjeto(x)) {
      ctx.error(r, 'debe ser un objeto');
      return;
    }
    camposDesconocidos(ctx, r, x, CAMPOS_FALDON);
    const muro = numero(ctx, `${r}.muro`, x.muro, { min: 0, entero: true });
    anclaEnMuro(ctx, r, contorno, muro, 0, 0);
    if (muros.has(muro)) ctx.error(`${r}.muro`, `ya hay un faldón en el muro ${muro}`);
    muros.add(muro);
    res.push({ muro, alturaEnMuro: numero(ctx, `${r}.alturaEnMuro`, x.alturaEnMuro, { minExcl: 0, max: altura }), alcance: numero(ctx, `${r}.alcance`, x.alcance, { minExcl: 0 }) });
  });
  return res;
}

/** Estancia de la v1 (sin id ni nombre, con grosorMuros). */
function validarEstanciaV1(ctx: Contexto, v: unknown, ids: Set<string>): { cuerpo: Pick<Estancia, 'contorno' | 'altura' | 'huecos'>; grosorMuros: number } {
  if (!esObjeto(v)) {
    ctx.error('estancia', v === undefined ? 'falta' : 'debe ser un objeto');
    return { cuerpo: { contorno: [], altura: 250, huecos: [] }, grosorMuros: 10 };
  }
  camposDesconocidos(ctx, 'estancia', v, CAMPOS_ESTANCIA_V1);
  const cuerpo = validarCuerpoEstancia(ctx, 'estancia', v, ids);
  const grosorMuros = numero(ctx, 'estancia.grosorMuros', v.grosorMuros, { min: 0, defecto: 10 });
  return { cuerpo, grosorMuros };
}

function validarId(ctx: Contexto, ruta: string, v: unknown, ids: Set<string>, defecto?: string): string {
  const id = texto(ctx, ruta, v, defecto);
  if (v === undefined && defecto === undefined) return id; // ya se informó de que falta
  if (typeof id === 'string' && !RE_ID.test(id)) ctx.error(ruta, 'no vacío; sólo letras sin tilde, números, «_», «-» y «.» (máx. 64)');
  else if (ids.has(id)) ctx.error(ruta, `«${id}» repetido (los ids son únicos en todo el archivo)`);
  ids.add(id);
  return id;
}

function validarPlanta(ctx: Contexto, ruta: string, v: unknown, ids: Set<string>, indice: number): Planta | null {
  if (!esObjeto(v)) {
    ctx.error(ruta, 'debe ser un objeto');
    return null;
  }
  camposDesconocidos(ctx, ruta, v, CAMPOS_PLANTA);
  const id = validarId(ctx, `${ruta}.id`, v.id, ids);
  const nombre = texto(ctx, `${ruta}.nombre`, v.nombre, indice === 0 ? 'Planta baja' : `Planta ${indice}`);
  const nivel = numero(ctx, `${ruta}.nivel`, v.nivel, { defecto: 0 });
  const grosorExterior = numero(ctx, `${ruta}.grosorExterior`, v.grosorExterior, { min: 0, defecto: 10 });
  const estancias: Estancia[] = [];
  if (!Array.isArray(v.estancias) || v.estancias.length === 0) ctx.error(`${ruta}.estancias`, 'debe ser una lista con al menos una estancia');
  (Array.isArray(v.estancias) ? v.estancias : []).forEach((e, i) => {
    const r = `${ruta}.estancias[${i}]`;
    if (!esObjeto(e)) {
      ctx.error(r, 'debe ser un objeto');
      return;
    }
    camposDesconocidos(ctx, r, e, CAMPOS_ESTANCIA);
    const eid = validarId(ctx, `${r}.id`, e.id, ids);
    const enombre = texto(ctx, `${r}.nombre`, e.nombre, eid);
    const cuerpo = validarCuerpoEstancia(ctx, r, e, ids);
    const elementos = validarElementos(ctx, `${r}.elementos`, e.elementos, cuerpo.contorno, cuerpo.altura, ids);
    const faldones = validarFaldones(ctx, `${r}.faldones`, e.faldones, cuerpo.contorno, cuerpo.altura);
    if (e.circuloDeGiro !== undefined && typeof e.circuloDeGiro !== 'boolean') ctx.error(`${r}.circuloDeGiro`, 'debe ser true o false');
    let suelo: Suelo | undefined;
    if (e.suelo !== undefined) {
      if (!esObjeto(e.suelo)) ctx.error(`${r}.suelo`, 'debe ser un objeto {tipo, color?}');
      else {
        camposDesconocidos(ctx, `${r}.suelo`, e.suelo, ['tipo', 'color']);
        const tipo = e.suelo.tipo;
        if (tipo !== 'liso' && tipo !== 'parquet' && tipo !== 'baldosa' && tipo !== 'moqueta') ctx.error(`${r}.suelo.tipo`, 'debe ser «liso», «parquet», «baldosa» o «moqueta»');
        else suelo = { tipo };
        if (e.suelo.color !== undefined) {
          if (typeof e.suelo.color !== 'string' || !RE_COLOR.test(e.suelo.color)) ctx.error(`${r}.suelo.color`, 'debe ser #rrggbb');
          else if (suelo) suelo.color = e.suelo.color;
        }
      }
    }
    if (e.paredes !== undefined && (typeof e.paredes !== 'string' || !RE_COLOR.test(e.paredes))) ctx.error(`${r}.paredes`, 'debe ser un color #rrggbb');
    estancias.push({
      id: eid, nombre: enombre, ...cuerpo, ...(elementos.length ? { elementos } : {}), ...(faldones.length ? { faldones } : {}),
      ...(e.circuloDeGiro === true ? { circuloDeGiro: true } : {}), ...(suelo ? { suelo } : {}), ...(typeof e.paredes === 'string' && RE_COLOR.test(e.paredes) ? { paredes: e.paredes } : {}),
      ...conFotos(ctx, `${r}.fotos`, e.fotos),
    });
  });
  for (let i = 0; i < estancias.length; i++) {
    for (let j = i + 1; j < estancias.length; j++) {
      const a = estancias[i] as Estancia;
      const b = estancias[j] as Estancia;
      // Sólo con contornos válidos (los demás ya tienen su error); tocarse a ras no es solaparse.
      if (!esPoligonoSimple(a.contorno) || !esPoligonoSimple(b.contorno)) continue;
      try {
        if (seSolapan(a.contorno, b.contorno, TOLERANCIA)) {
          ctx.error(`${ruta}.estancias`, `«${a.nombre}» (${a.id}) y «${b.nombre}» (${b.id}) se solapan: dos estancias no pueden ocupar el mismo suelo`);
        }
      } catch (e) {
        if (!(e instanceof ErrorGeometria)) throw e;
        ctx.error(`${ruta}.estancias`, `«${a.id}» y «${b.id}»: ${e.message}`);
      }
    }
  }
  const muebles = validarMuebles(ctx, `${ruta}.muebles`, v.muebles, ids);
  const fondos = validarFondos(ctx, `${ruta}.fondos`, v.fondos, ids);
  const escaleras = validarEscaleras(ctx, `${ruta}.escaleras`, v.escaleras, ids);
  return { id, nombre, nivel, grosorExterior, estancias, muebles, ...(fondos.length ? { fondos } : {}), ...(escaleras.length ? { escaleras } : {}) };
}

/** Escaleras de una planta: forma y medidas (el destino se comprueba con todas las plantas). */
function validarEscaleras(ctx: Contexto, ruta: string, v: unknown, ids: Set<string>): Escalera[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    ctx.error(ruta, 'debe ser una lista');
    return [];
  }
  const res: Escalera[] = [];
  v.forEach((x, i) => {
    const r = `${ruta}[${i}]`;
    if (!esObjeto(x)) {
      ctx.error(r, 'debe ser un objeto');
      return;
    }
    camposDesconocidos(ctx, r, x, CAMPOS_ESCALERA);
    const id = validarId(ctx, `${r}.id`, x.id, ids);
    const forma = x.forma === undefined ? 'recta' : x.forma;
    if (forma !== 'recta' && forma !== 'L' && forma !== 'U' && forma !== 'caracol') {
      ctx.error(`${r}.forma`, 'debe ser «recta», «L», «U» (dos tramos con media vuelta) o «caracol»');
      return;
    }
    const ancho = numero(ctx, `${r}.ancho`, x.ancho, { minExcl: 0 });
    if (ancho > 0 && ancho < 60 - TOLERANCIA) ctx.error(`${r}.ancho`, `mide ${ancho} cm: una escalera necesita al menos 60 cm de ancho para pasar`);
    const esc: Escalera = {
      id, forma, ancho,
      x: numero(ctx, `${r}.x`, x.x),
      y: numero(ctx, `${r}.y`, x.y),
      giro: normalizarGiro(numero(ctx, `${r}.giro`, x.giro, { defecto: 0 })),
      hasta: texto(ctx, `${r}.hasta`, x.hasta),
    };
    if (x.peldanos !== undefined) {
      const n = numero(ctx, `${r}.peldanos`, x.peldanos, { min: 1 });
      if (!Number.isInteger(n)) ctx.error(`${r}.peldanos`, 'debe ser un número entero de contrahuellas');
      esc.peldanos = n;
    }
    if (forma !== 'caracol') for (const k of ['poste', 'vuelta']) if (x[k] !== undefined) ctx.error(`${r}.${k}`, 'sólo va en las escaleras «caracol»');
    if (forma === 'recta') {
      for (const k of ['tramos', 'gira', 'ojo']) if (x[k] !== undefined) ctx.error(`${r}.${k}`, 'sólo va en las escaleras «L» y «U»; la recta usa «largo»');
      esc.largo = numero(ctx, `${r}.largo`, x.largo, { minExcl: 0 });
    } else if (forma === 'caracol') {
      for (const k of ['largo', 'tramos', 'ojo']) if (x[k] !== undefined) ctx.error(`${r}.${k}`, 'no va en la caracol: usa «ancho» (del peldaño), «poste», «vuelta» y «gira»');
      const gira = x.gira === undefined ? 'derecha' : x.gira;
      if (gira !== 'izquierda' && gira !== 'derecha') ctx.error(`${r}.gira`, 'debe ser «derecha» o «izquierda» (la mano de quien sube)');
      esc.gira = gira === 'izquierda' ? 'izquierda' : 'derecha';
      if (x.poste !== undefined) {
        const v = numero(ctx, `${r}.poste`, x.poste);
        if (v < 8 - TOLERANCIA || v > 60 + TOLERANCIA) ctx.error(`${r}.poste`, `mide ${v} cm: el poste de una caracol va de 8 a 60 cm de diámetro`);
        esc.poste = v;
      }
      if (x.vuelta !== undefined) {
        const v = numero(ctx, `${r}.vuelta`, x.vuelta);
        if (v < 90 - TOLERANCIA || v > 360 + TOLERANCIA) ctx.error(`${r}.vuelta`, `son ${v}°: una caracol gira entre 90 y 360 grados de pie a llegada`);
        esc.vuelta = v;
      }
      if (esc.peldanos !== undefined && esc.peldanos < 2) ctx.error(`${r}.peldanos`, 'una caracol necesita al menos 2 contrahuellas');
    } else {
      if (x.largo !== undefined) ctx.error(`${r}.largo`, `la escalera «${forma}» usa «tramos»: [largo del tramo 1, largo del tramo 2]`);
      if (!Array.isArray(x.tramos) || x.tramos.length !== 2) ctx.error(`${r}.tramos`, 'debe ser [largo del tramo 1, largo del tramo 2] (cm)');
      else esc.tramos = [numero(ctx, `${r}.tramos[0]`, x.tramos[0], { minExcl: 0 }), numero(ctx, `${r}.tramos[1]`, x.tramos[1], { minExcl: 0 })];
      const gira = x.gira === undefined ? 'derecha' : x.gira;
      if (gira !== 'izquierda' && gira !== 'derecha') ctx.error(`${r}.gira`, 'debe ser «derecha» o «izquierda» (la mano de quien sube)');
      esc.gira = gira === 'izquierda' ? 'izquierda' : 'derecha';
      if (forma === 'U') esc.ojo = numero(ctx, `${r}.ojo`, x.ojo, { min: 0, defecto: 0 });
      else if (x.ojo !== undefined) ctx.error(`${r}.ojo`, 'sólo va en las escaleras «U»');
      if (esc.peldanos !== undefined && esc.peldanos < 2) ctx.error(`${r}.peldanos`, 'una escalera de dos tramos necesita al menos 2 contrahuellas');
    }
    res.push(esc);
  });
  return res;
}

/**
 * Ruta de un archivo junto al .espacio.json: relativa, con «/», sin «..» ni unidad. Así la carpeta
 * se puede pasar a otra persona y el archivo sigue apuntando a su sitio.
 */
export function rutaRelativaValida(archivo: string): string | null {
  if (!archivo.trim()) return 'no puede estar vacía';
  if (/^[a-zA-Z]:|^[\\/]|^~/.test(archivo)) return 'debe ser relativa a la carpeta del .espacio.json (sin «C:», «/» ni «~» al principio)';
  if (archivo.includes('\\')) return 'usa «/» para separar carpetas, no «\\»';
  if (archivo.split('/').some((s) => s === '..' || s === '')) return 'no puede salir de la carpeta del .espacio.json («..») ni tener «//»';
  return null;
}

function validarFondos(ctx: Contexto, ruta: string, v: unknown, ids: Set<string>): Fondo[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    ctx.error(ruta, 'debe ser una lista');
    return [];
  }
  const res: Fondo[] = [];
  v.forEach((f, i) => {
    const r = `${ruta}[${i}]`;
    if (!esObjeto(f)) {
      ctx.error(r, 'debe ser un objeto');
      return;
    }
    camposDesconocidos(ctx, r, f, CAMPOS_FONDO);
    const id = validarId(ctx, `${r}.id`, f.id, ids);
    const archivo = texto(ctx, `${r}.archivo`, f.archivo);
    const malo = typeof f.archivo === 'string' ? rutaRelativaValida(archivo) : null;
    if (malo) ctx.error(`${r}.archivo`, malo);
    res.push({
      id,
      archivo,
      anchoPx: numero(ctx, `${r}.anchoPx`, f.anchoPx, { minExcl: 0, entero: true }),
      altoPx: numero(ctx, `${r}.altoPx`, f.altoPx, { minExcl: 0, entero: true }),
      escala: numero(ctx, `${r}.escala`, f.escala, { minExcl: 0, defecto: 1 }),
      x: numero(ctx, `${r}.x`, f.x, { defecto: 0 }),
      y: numero(ctx, `${r}.y`, f.y, { defecto: 0 }),
      giro: normalizarGiro(numero(ctx, `${r}.giro`, f.giro, { defecto: 0 })),
      opacidad: numero(ctx, `${r}.opacidad`, f.opacidad, { min: 0, max: 1, defecto: 0.5 }),
    });
  });
  return res;
}

function validarMuebles(ctx: Contexto, ruta: string, v: unknown, ids: Set<string>): Mueble[] {
  const muebles: Mueble[] = [];
  if (v !== undefined && !Array.isArray(v)) ctx.error(ruta, 'debe ser una lista');
  (Array.isArray(v) ? v : []).forEach((m, i) => {
    const mueble = validarMueble(ctx, `${ruta}[${i}]`, m);
    if (!mueble) return;
    if (ids.has(mueble.id)) ctx.error(`${ruta}[${i}].id`, `«${mueble.id}» repetido (los ids son únicos en todo el archivo)`);
    ids.add(mueble.id);
    muebles.push(mueble);
  });
  return muebles;
}

function validarMueble(ctx: Contexto, ruta: string, v: unknown): Mueble | null {
  if (!esObjeto(v)) {
    ctx.error(ruta, 'debe ser un objeto');
    return null;
  }
  camposDesconocidos(ctx, ruta, v, CAMPOS_MUEBLE);
  const id = texto(ctx, `${ruta}.id`, v.id);
  if (typeof v.id === 'string' && !RE_ID.test(id)) ctx.error(`${ruta}.id`, 'no vacío; sólo letras sin tilde, números, «_», «-» y «.» (máx. 64)');
  const tipo = texto(ctx, `${ruta}.tipo`, v.tipo, 'caja');
  const base = tipoMueble(tipo);
  const nombre = texto(ctx, `${ruta}.nombre`, v.nombre, base.etiqueta);
  const ancho = numero(ctx, `${ruta}.ancho`, v.ancho, { minExcl: 0 });
  const fondo = numero(ctx, `${ruta}.fondo`, v.fondo, { minExcl: 0 });
  const alto = numero(ctx, `${ruta}.alto`, v.alto, { minExcl: 0 });
  const x = numero(ctx, `${ruta}.x`, v.x);
  const y = numero(ctx, `${ruta}.y`, v.y);
  const giro = normalizarGiro(numero(ctx, `${ruta}.giro`, v.giro, { defecto: 0 }));
  const elevacion = numero(ctx, `${ruta}.elevacion`, v.elevacion, { min: 0, defecto: 0 });
  const color = texto(ctx, `${ruta}.color`, v.color, base.color);
  if (!RE_COLOR.test(color)) ctx.error(`${ruta}.color`, 'debe ser #rrggbb');
  let bloqueado = false;
  if (v.bloqueado !== undefined) {
    if (typeof v.bloqueado !== 'boolean') ctx.error(`${ruta}.bloqueado`, 'debe ser true o false');
    else bloqueado = v.bloqueado;
  }
  const holguraFrente = numero(ctx, `${ruta}.holguraFrente`, v.holguraFrente, { min: 0, defecto: base.holguraFrente });
  const huecoInferior = numero(ctx, `${ruta}.huecoInferior`, v.huecoInferior, {
    min: 0,
    defecto: v.alto === undefined || base.huecoInferior < alto ? base.huecoInferior : 0,
  });
  if (huecoInferior >= alto && alto > 0) ctx.error(`${ruta}.huecoInferior`, `debe ser menor que el alto (${alto})`);
  const piezas = validarPiezas(ctx, `${ruta}.piezas`, v.piezas, ancho, fondo, alto);
  const modelo = validarModelo(ctx, `${ruta}.modelo`, v.modelo);
  return {
    id, nombre, tipo, ancho, fondo, alto, x, y, giro, elevacion, color: color.toLowerCase(), bloqueado, holguraFrente, huecoInferior,
    ...(piezas.length ? { piezas } : {}), ...(modelo ? { modelo } : {}), ...conFotos(ctx, `${ruta}.fotos`, v.fotos),
  };
}

/** Fotos (R4-3): lista de rutas relativas de imágenes, sin repetir; vacía o ausente, sin campo. */
function conFotos(ctx: Contexto, ruta: string, v: unknown): { fotos?: string[] } {
  if (v === undefined) return {};
  if (!Array.isArray(v)) {
    ctx.error(ruta, 'debe ser una lista de rutas de imágenes («fotos/cama.jpg»)');
    return {};
  }
  const res: string[] = [];
  v.forEach((f, i) => {
    if (typeof f !== 'string') return ctx.error(`${ruta}[${i}]`, 'debe ser una ruta de imagen');
    const malo = rutaRelativaValida(f) ?? (/\.(jpe?g|png|webp)$/i.test(f) ? null : 'debe ser una imagen .jpg, .jpeg, .png o .webp');
    if (malo) return ctx.error(`${ruta}[${i}]`, malo);
    if (res.includes(f)) return ctx.error(`${ruta}[${i}]`, `«${f}» repetida`);
    res.push(f);
  });
  return res.length ? { fotos: res } : {};
}

/** Piezas de un mueble: formas conocidas, medidas positivas y dentro de la caja del mueble. */
function validarPiezas(ctx: Contexto, ruta: string, v: unknown, ancho: number, fondo: number, alto: number): Pieza[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    ctx.error(ruta, 'debe ser una lista');
    return [];
  }
  const res: Pieza[] = [];
  v.forEach((x, i) => {
    const r = `${ruta}[${i}]`;
    if (!esObjeto(x)) {
      ctx.error(r, 'debe ser un objeto');
      return;
    }
    camposDesconocidos(ctx, r, x, CAMPOS_PIEZA);
    const forma = x.forma;
    if (forma !== 'caja' && forma !== 'cilindro' && forma !== 'esfera' && forma !== 'cuna') {
      ctx.error(`${r}.forma`, 'debe ser caja, cilindro, esfera o cuna');
      return;
    }
    const pa = numero(ctx, `${r}.ancho`, x.ancho, { minExcl: 0 });
    const redonda = forma === 'esfera' || forma === 'cilindro';
    const pf = numero(ctx, `${r}.fondo`, x.fondo, { minExcl: 0, defecto: redonda ? pa : undefined });
    const ph = numero(ctx, `${r}.alto`, x.alto, { minExcl: 0, defecto: forma === 'esfera' ? pa : undefined });
    const pieza: Pieza = {
      forma,
      x: numero(ctx, `${r}.x`, x.x, { defecto: 0 }),
      y: numero(ctx, `${r}.y`, x.y, { defecto: 0 }),
      z: numero(ctx, `${r}.z`, x.z, { min: 0, defecto: 0 }),
      ancho: pa,
      fondo: redonda ? pa : pf,
      alto: forma === 'esfera' ? pa : ph,
      giro: normalizarGiro(numero(ctx, `${r}.giro`, x.giro, { defecto: 0 })),
    };
    if (x.color !== undefined) {
      const c = texto(ctx, `${r}.color`, x.color);
      if (!RE_COLOR.test(c)) ctx.error(`${r}.color`, 'debe ser #rrggbb');
      else pieza.color = c.toLowerCase();
    }
    // Dentro de la caja del mueble (con su giro, por su caja envolvente).
    const g = (pieza.giro * Math.PI) / 180;
    const ex = (Math.abs(Math.cos(g)) * pieza.ancho + Math.abs(Math.sin(g)) * pieza.fondo) / 2;
    const ey = (Math.abs(Math.sin(g)) * pieza.ancho + Math.abs(Math.cos(g)) * pieza.fondo) / 2;
    if (Math.abs(pieza.x) + ex > ancho / 2 + TOLERANCIA || Math.abs(pieza.y) + ey > fondo / 2 + TOLERANCIA || pieza.z + pieza.alto > alto + TOLERANCIA) {
      ctx.error(r, `se sale del mueble (${ancho} x ${fondo} x ${alto} cm): las piezas tienen que caber dentro`);
    }
    res.push(pieza);
  });
  return res;
}

function validarModelo(ctx: Contexto, ruta: string, v: unknown): ModeloMueble | null {
  if (v === undefined) return null;
  if (!esObjeto(v)) {
    ctx.error(ruta, 'debe ser un objeto {archivo, giro, ajuste}');
    return null;
  }
  camposDesconocidos(ctx, ruta, v, CAMPOS_MODELO);
  const archivo = texto(ctx, `${ruta}.archivo`, v.archivo);
  const malo = typeof v.archivo === 'string' ? rutaRelativaValida(archivo) : null;
  if (malo) ctx.error(`${ruta}.archivo`, malo);
  else if (typeof v.archivo === 'string' && !/\.glb$/i.test(archivo)) ctx.error(`${ruta}.archivo`, 'debe ser un .glb');
  const ajuste = v.ajuste === undefined ? 'medidas' : v.ajuste;
  if (ajuste !== 'medidas' && ajuste !== 'modelo') ctx.error(`${ruta}.ajuste`, 'debe ser «medidas» (se estira a las medidas del mueble) o «modelo» (conserva su tamaño)');
  const giro = normalizarGiro(numero(ctx, `${ruta}.giro`, v.giro, { defecto: 0 }));
  if (giro % 90 !== 0) ctx.error(`${ruta}.giro`, 'debe ser 0, 90, 180 o 270 (para girar el mueble entero, usa su «giro»)');
  return { archivo, giro, ajuste: ajuste === 'modelo' ? 'modelo' : 'medidas' };
}

function validarPosicion(ctx: Contexto, ruta: string, v: unknown, v1: boolean): Posicion | null {
  if (!esObjeto(v)) {
    ctx.error(ruta, 'debe ser un objeto {x, y, giro}');
    return null;
  }
  camposDesconocidos(ctx, ruta, v, v1 ? CAMPOS_POSICION_V1 : CAMPOS_POSICION);
  const pos: Posicion = {
    x: numero(ctx, `${ruta}.x`, v.x),
    y: numero(ctx, `${ruta}.y`, v.y),
    giro: normalizarGiro(numero(ctx, `${ruta}.giro`, v.giro, { defecto: 0 })),
  };
  if (v.planta !== undefined) pos.planta = texto(ctx, `${ruta}.planta`, v.planta);
  return pos;
}

function validarDistribuciones(ctx: Contexto, v: unknown, v1 = false): Distribucion[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    ctx.error('distribuciones', 'debe ser una lista');
    return [];
  }
  const nombres = new Set<string>();
  const res: Distribucion[] = [];
  v.forEach((d, i) => {
    const ruta = `distribuciones[${i}]`;
    if (!esObjeto(d)) {
      ctx.error(ruta, 'debe ser un objeto');
      return;
    }
    camposDesconocidos(ctx, ruta, d, CAMPOS_DISTRIBUCION);
    const nombre = texto(ctx, `${ruta}.nombre`, d.nombre);
    if (nombres.has(nombre)) ctx.error(`${ruta}.nombre`, `«${nombre}» repetido`);
    nombres.add(nombre);
    const posiciones: Record<string, Posicion> = {};
    if (!esObjeto(d.posiciones)) ctx.error(`${ruta}.posiciones`, 'debe ser un objeto {id: {x, y, giro}}');
    else {
      for (const [id, p] of Object.entries(d.posiciones)) {
        const pos = validarPosicion(ctx, `${ruta}.posiciones.${id}`, p, v1);
        if (pos) posiciones[id] = pos;
      }
    }
    res.push({ nombre, posiciones });
  });
  return res;
}

/**
 * Valida un archivo de la v1 (una estancia) y lo convierte a v2: una planta con esa estancia y
 * sus muebles. En la v1 los ids de huecos y muebles eran espacios separados: un hueco con el id
 * de un mueble se renombra.
 */
function validarV1(ctx: Contexto, entrada: Record<string, unknown>): Espacio {
  camposDesconocidos(ctx, '(raíz)', entrada, CAMPOS_ESPACIO_V1);
  const nombre = texto(ctx, 'nombre', entrada.nombre, 'Espacio sin nombre');
  const idsHuecos = new Set<string>();
  const { cuerpo, grosorMuros } = validarEstanciaV1(ctx, entrada.estancia, idsHuecos);
  const idsMuebles = new Set<string>();
  const muebles = validarMuebles(ctx, 'muebles', entrada.muebles, idsMuebles);
  const distribuciones = validarDistribuciones(ctx, entrada.distribuciones, true);
  const notas = texto(ctx, 'notas', entrada.notas, '');
  const usados = new Set<string>(idsMuebles);
  // Ids libres de 64 caracteres como mucho (el límite de RE_ID), recortando la base si hace falta.
  const libre = (base: string): string => {
    for (let i = 1; ; i++) {
      const sufijo = i === 1 ? '' : `-${i}`;
      const id = base.slice(0, 64 - sufijo.length) + sufijo;
      if (!usados.has(id)) {
        usados.add(id);
        return id;
      }
    }
  };
  const huecos = cuerpo.huecos.map((h) => {
    if (!usados.has(h.id)) {
      usados.add(h.id);
      return h;
    }
    const id = libre(`${h.id}-hueco`);
    ctx.avisos.push(`estancia.huecos: «${h.id}» se renombra a «${id}» porque en la versión 2 los ids son únicos en todo el archivo y ya lo usa un mueble`);
    return { ...h, id };
  });
  const planta: Planta = {
    id: libre('planta-baja'),
    nombre: 'Planta baja',
    nivel: 0,
    grosorExterior: grosorMuros,
    estancias: [{ id: libre('estancia'), nombre: 'Estancia', contorno: cuerpo.contorno, altura: cuerpo.altura, huecos }],
    muebles,
  };
  return { formato: FORMATO, version: VERSION, nombre, plantas: [planta], distribuciones, notas };
}

function validarV2(ctx: Contexto, entrada: Record<string, unknown>): Espacio {
  camposDesconocidos(ctx, '(raíz)', entrada, CAMPOS_ESPACIO);
  const nombre = texto(ctx, 'nombre', entrada.nombre, 'Espacio sin nombre');
  const ids = new Set<string>();
  const plantas: Planta[] = [];
  if (!Array.isArray(entrada.plantas) || entrada.plantas.length === 0) ctx.error('plantas', 'debe ser una lista con al menos una planta');
  (Array.isArray(entrada.plantas) ? entrada.plantas : []).forEach((p, i) => {
    const planta = validarPlanta(ctx, `plantas[${i}]`, p, ids, i);
    if (planta) plantas.push(planta);
  });
  const distribuciones = validarDistribuciones(ctx, entrada.distribuciones);
  const idsPlantas = new Set(plantas.map((p) => p.id));
  // Destino de las escaleras: la planta inmediatamente superior por nivel.
  plantas.forEach((p, i) => {
    (p.escaleras ?? []).forEach((esc, j) => {
      const r = `plantas[${i}].escaleras[${j}].hasta`;
      const dest = plantas.find((x) => x.id === esc.hasta);
      if (!dest) return ctx.error(r, `no existe la planta «${esc.hasta}»`);
      if (dest.nivel <= p.nivel) return ctx.error(r, `«${esc.hasta}» (nivel ${dest.nivel}) no está por encima de «${p.id}» (nivel ${p.nivel})`);
      const medio = plantas.find((x) => x.nivel > p.nivel && x.nivel < dest.nivel);
      if (medio) return ctx.error(r, `entre «${p.id}» y «${esc.hasta}» está «${medio.id}»: la escalera tiene que llegar a la planta inmediatamente superior`);
      const n = esc.peldanos ?? Math.max(1, Math.round((dest.nivel - p.nivel) / (esc.forma === 'caracol' ? 21 : 18)));
      if (esc.forma !== 'recta' && n < 2) ctx.error(`plantas[${i}].escaleras[${j}]`, `una escalera ${esc.forma === 'caracol' ? 'de caracol' : 'de dos tramos'} necesita al menos 2 contrahuellas`);
    });
  });
  distribuciones.forEach((d, i) => {
    for (const [id, pos] of Object.entries(d.posiciones)) {
      if (pos.planta !== undefined && !idsPlantas.has(pos.planta)) ctx.error(`distribuciones[${i}].posiciones.${id}.planta`, `no existe la planta «${pos.planta}»`);
    }
  });
  const notas = texto(ctx, 'notas', entrada.notas, '');
  return { formato: FORMATO, version: VERSION, nombre, plantas, distribuciones, notas };
}

export function validar(entrada: unknown): ResultadoValidacion {
  const ctx = new Contexto();
  if (!esObjeto(entrada)) return { ok: false, errores: ['(raíz): debe ser un objeto JSON'] };
  if (entrada.formato !== FORMATO) ctx.error('formato', `debe ser "${FORMATO}"`);
  let espacio: Espacio | null = null;
  let migradoDesde: 1 | undefined;
  if (typeof entrada.version === 'number' && entrada.version > VERSION) {
    ctx.error('version', `el archivo es de una versión más nueva (${entrada.version}) que esta herramienta (${VERSION})`);
  } else if (entrada.version === 1) {
    espacio = validarV1(ctx, entrada);
    migradoDesde = 1;
  } else if (entrada.version === VERSION) espacio = validarV2(ctx, entrada);
  else ctx.error('version', `debe ser ${VERSION} (o 1, que se convierte)`);
  if (ctx.errores.length || !espacio) return { ok: false, errores: ctx.errores };
  return { ok: true, espacio, avisos: ctx.avisos, ...(migradoDesde ? { migradoDesde } : {}) };
}

/** Valida y lanza con todos los errores juntos. Para código que ya espera un espacio correcto. */
export function validarOLanzar(entrada: unknown): Espacio {
  const r = validar(entrada);
  if (!r.ok) throw new Error(`Espacio no válido:\n- ${r.errores.join('\n- ')}`);
  return r.espacio;
}

export function aJSON(espacio: Espacio): string {
  return `${JSON.stringify(espacio, null, 2)}\n`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
