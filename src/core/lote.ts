// Operaciones descritas como datos ({"op": "agregar", ...}): las usan el CLI y `aplicar --ops`.
// Son estrictas con las claves para que una errata de un agente falle en vez de ignorarse.
import { tipoMueble } from './catalogo.js';
import { pegarAPared, posicionContraMuro } from './colocar.js';
import { cambiarContorno, editarEstancia } from './contorno.js';
import { calibrarFondo, editarFondo, ponerFondo, quitarFondo } from './fondos.js';
import { agregarElemento, editarElemento, ponerFaldon, quitarElemento, quitarFaldon } from './obra.js';
import { agregarEscalera, agregarPlanta, editarEscalera, editarPlanta, moverTabique, quitarEscalera, quitarPlanta, type DatosEscalera } from './plantas.js';
import { cajaContorno } from './geometria.js';
import { buscarMueble, estancia, estanciaDeMueble, planta } from './espacio.js';
import {
  agregarHueco, agregarMueble, aplicarDistribucion, cambiarTipo, editarMueble, esRectangular, girarMueble, guardarDistribucion,
  agregarEstancia, moverMueble, quitarDistribucion, quitarEstancia, quitarHueco, quitarMueble, redimensionarRectangulo, renombrarEspacio,
  renombrarEstancia,
  type DatosHueco, type DatosMueble,
} from './operaciones.js';
import type { Espacio, Mueble, Punto, Suelo } from './tipos.js';
import { ErrorOperacion } from './tipos.js';
import { agregarFoto, quitarFoto } from './fotos.js';

export type Op = { op: string } & Record<string, unknown>;

const CLAVES: Record<string, readonly string[]> = {
  agregar: ['planta', 'estancia', 'tipo', 'id', 'nombre', 'ancho', 'fondo', 'alto', 'x', 'y', 'muro', 'desde', 'separacion', 'giro', 'elevacion', 'color', 'bloqueado', 'holguraFrente', 'huecoInferior', 'piezas', 'modelo'],
  mover: ['id', 'x', 'y', 'dx', 'dy', 'muro', 'desde', 'separacion', 'estancia'],
  girar: ['id', 'giro', 'sumar'],
  editar: ['id', 'nombre', 'tipo', 'ancho', 'fondo', 'alto', 'x', 'y', 'giro', 'elevacion', 'color', 'bloqueado', 'holguraFrente', 'huecoInferior', 'piezas', 'modelo'],
  quitar: ['id'],
  'pegar-pared': ['id', 'muro'],
  'hueco-agregar': ['estancia', 'tipo', 'id', 'muro', 'desde', 'ancho', 'alto', 'antepecho', 'abre', 'bisagra'],
  'hueco-quitar': ['id'],
  'distribucion-guardar': ['nombre'],
  'distribucion-aplicar': ['nombre'],
  'distribucion-quitar': ['nombre'],
  estancia: ['estancia', 'nombre', 'ancho', 'largo', 'alto', 'grosorMuros', 'circuloDeGiro', 'suelo', 'colorSuelo', 'paredes'],
  'estancia-agregar': ['planta', 'id', 'nombre', 'contorno', 'x', 'y', 'ancho', 'largo', 'alto'],
  'estancia-quitar': ['id'],
  'estancia-contorno': ['estancia', 'contorno'],
  'fondo-poner': ['planta', 'id', 'archivo', 'anchoPx', 'altoPx', 'escala', 'x', 'y', 'giro', 'opacidad'],
  'fondo-calibrar': ['id', 'puntos', 'distancia', 'en'],
  'fondo-editar': ['id', 'escala', 'x', 'y', 'giro', 'opacidad'],
  'fondo-quitar': ['id'],
  'elemento-agregar': ['estancia', 'id', 'tipo', 'forma', 'x', 'y', 'ancho', 'fondo', 'giro', 'redondo', 'alto', 'elevacion', 'muro', 'desde', 'altura', 'de', 'a', 'canto'],
  'elemento-editar': ['id', 'tipo', 'x', 'y', 'ancho', 'fondo', 'giro', 'redondo', 'alto', 'elevacion', 'muro', 'desde', 'altura', 'de', 'a', 'canto'],
  'elemento-quitar': ['id'],
  'faldon-poner': ['estancia', 'muro', 'alturaEnMuro', 'alcance'],
  'faldon-quitar': ['estancia', 'muro'],
  renombrar: ['nombre'],
  'planta-agregar': ['id', 'nombre', 'nivel', 'copiarDe', 'conVentanas', 'contorno', 'x', 'y', 'ancho', 'largo', 'alto'],
  'planta-editar': ['id', 'nombre', 'nivel'],
  'planta-quitar': ['id'],
  'tabique-mover': ['estancia', 'muro', 'distancia'],
  'escalera-agregar': ['planta', 'id', 'forma', 'x', 'y', 'ancho', 'giro', 'hasta', 'peldanos', 'largo', 'tramos', 'gira', 'ojo', 'poste', 'vuelta'],
  'escalera-editar': ['id', 'forma', 'x', 'y', 'ancho', 'giro', 'hasta', 'peldanos', 'largo', 'tramos', 'gira', 'ojo', 'poste', 'vuelta'],
  'escalera-quitar': ['id'],
  'foto-agregar': ['para', 'foto'],
  'foto-quitar': ['para', 'foto'],
};

/** Campos de una escalera en una operación (los comprueba la validación del espacio). */
function datosEscalera(op: Op): DatosEscalera {
  const tramos = op.tramos;
  if (tramos !== undefined && (!Array.isArray(tramos) || tramos.length !== 2 || tramos.some((x) => typeof x !== 'number'))) {
    throw new ErrorOperacion('«tramos» debe ser [largo del tramo 1, largo del tramo 2] (cm)');
  }
  const forma = txt(op, 'forma');
  if (forma !== undefined && forma !== 'recta' && forma !== 'L' && forma !== 'U' && forma !== 'caracol') throw new ErrorOperacion('«forma» debe ser «recta», «L», «U» o «caracol»');
  const gira = txt(op, 'gira');
  if (gira !== undefined && gira !== 'derecha' && gira !== 'izquierda') throw new ErrorOperacion('«gira» debe ser «derecha» o «izquierda» (la mano de quien sube)');
  return sinIndefinidos({
    id: txt(op, 'id'), forma, x: num(op, 'x'), y: num(op, 'y'), ancho: num(op, 'ancho'), giro: num(op, 'giro'), hasta: txt(op, 'hasta'),
    peldanos: num(op, 'peldanos'), largo: num(op, 'largo'), tramos: tramos as [number, number] | undefined, gira, ojo: num(op, 'ojo'),
    poste: num(op, 'poste'), vuelta: num(op, 'vuelta'),
  }) as DatosEscalera;
}

export const OPERACIONES = Object.keys(CLAVES);

/** Primera estancia de una planta (o de la primera planta). */
function estanciaDePlanta(e: Espacio, plantaId?: string): string | undefined {
  return planta(e, plantaId).estancias[0]?.id;
}

/** Estancia que contiene al mueble (o la primera de su planta). */
function estanciaDelMueble(e: Espacio, id: string): string | undefined {
  const b = buscarMueble(e, id);
  if (!b) return undefined;
  return (estanciaDeMueble(b.planta, b.mueble) ?? b.planta.estancias[0])?.id;
}

/** Lista de números «a,b,c,...» (o una lista JSON) con la cantidad pedida. */
function numeros(op: Op, k: string, cuantos: number, ejemplo: string): number[] {
  const v = op[k];
  const lista = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',').map((s) => Number(s.trim())) : null;
  if (!lista || lista.length !== cuantos || !lista.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new ErrorOperacion(`«${k}» debe ser ${cuantos} números separados por comas, p. ej. «${ejemplo}»`);
  }
  return lista as number[];
}

/** Contorno como lista [[x, y], ...] (o ese JSON en texto, como llega desde el CLI). */
function contornoDe(op: Op): Punto[] {
  let v = op.contorno;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      throw new ErrorOperacion('«contorno» debe ser una lista JSON de puntos: [[0,0],[300,0],[300,200],[0,200]]');
    }
  }
  if (!Array.isArray(v) || v.length < 3 || !v.every((q) => Array.isArray(q) && q.length === 2 && q.every((n) => typeof n === 'number' && Number.isFinite(n)))) {
    throw new ErrorOperacion('«contorno» debe ser una lista de al menos 3 puntos [x, y] en cm: [[0,0],[300,0],[300,200],[0,200]]');
  }
  return v as Punto[];
}

function num(op: Op, k: string, obligatorio = false): number | undefined {
  const v = op[k];
  if (v === undefined) {
    if (obligatorio) throw new ErrorOperacion(`«${op.op}» necesita «${k}» (número)`);
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ErrorOperacion(`«${k}» debe ser un número`);
  return v;
}

function txt(op: Op, k: string, obligatorio = false): string | undefined {
  const v = op[k];
  if (v === undefined) {
    if (obligatorio) throw new ErrorOperacion(`«${op.op}» necesita «${k}» (texto)`);
    return undefined;
  }
  if (typeof v !== 'string') throw new ErrorOperacion(`«${k}» debe ser texto`);
  return v;
}

function boo(op: Op, k: string): boolean | undefined {
  const v = op[k];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new ErrorOperacion(`«${k}» debe ser true o false`);
  return v;
}

function sinIndefinidos<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function datosMueble(op: Op): Partial<Mueble> {
  return sinIndefinidos({
    nombre: txt(op, 'nombre'),
    ancho: num(op, 'ancho'),
    fondo: num(op, 'fondo'),
    alto: num(op, 'alto'),
    x: num(op, 'x'),
    y: num(op, 'y'),
    giro: num(op, 'giro'),
    elevacion: num(op, 'elevacion'),
    color: txt(op, 'color'),
    bloqueado: boo(op, 'bloqueado'),
    holguraFrente: num(op, 'holguraFrente'),
    huecoInferior: num(op, 'huecoInferior'),
    ...piezasYModelo(op),
  });
}

/**
 * «piezas» (lista; [] o null vuelve a la forma genérica) y «modelo» (ruta de un .glb o
 * {archivo, giro, ajuste}; null lo quita). Las comprueba la validación del espacio.
 */
function piezasYModelo(op: Op): Partial<Mueble> {
  const res: Partial<Mueble> = {};
  if (op.piezas !== undefined) {
    if (op.piezas !== null && !Array.isArray(op.piezas)) throw new ErrorOperacion('«piezas» debe ser una lista de piezas (o null para volver a la forma genérica)');
    res.piezas = (op.piezas ?? []) as Mueble['piezas'];
  }
  if (op.modelo !== undefined) {
    const v = op.modelo;
    if (v !== null && typeof v !== 'string' && (typeof v !== 'object' || Array.isArray(v))) throw new ErrorOperacion('«modelo» debe ser la ruta de un .glb, un objeto {archivo, giro, ajuste} o null para quitarlo');
    res.modelo = (typeof v === 'string' ? { archivo: v } : (v ?? undefined)) as Mueble['modelo'];
  }
  return res;
}

function buscar(e: Espacio, id: string): Mueble {
  const m = buscarMueble(e, id)?.mueble;
  if (!m) throw new ErrorOperacion(`No existe el mueble «${id}». Ids: ${e.plantas.flatMap((p) => p.muebles.map((x) => x.id)).join(', ') || '(ninguno)'}`);
  return m;
}

export interface ResultadoOp {
  espacio: Espacio;
  nota: string;
}

export function ejecutarOp(e: Espacio, op: Op): ResultadoOp {
  const claves = CLAVES[op.op];
  if (!claves) throw new ErrorOperacion(`Operación desconocida «${op.op}». Operaciones: ${OPERACIONES.join(', ')}`);
  for (const k of Object.keys(op)) {
    if (k !== 'op' && !claves.includes(k)) throw new ErrorOperacion(`«${op.op}» no admite «${k}». Admite: ${claves.join(', ')}`);
  }
  switch (op.op) {
    case 'agregar': {
      const tipo = txt(op, 'tipo', true) as string;
      const datos: DatosMueble = { tipo, ...datosMueble(op), ...sinIndefinidos({ id: txt(op, 'id') }) };
      const muro = num(op, 'muro');
      // Estancia y planta de destino: la estancia manda y debe ser de la planta indicada.
      const estId = txt(op, 'estancia');
      let plantaId = txt(op, 'planta');
      if (estId !== undefined) {
        const { planta: pe, estancia: est } = estancia(e, estId);
        if (plantaId !== undefined && pe.id !== plantaId) throw new ErrorOperacion(`La estancia «${estId}» es de la planta «${pe.id}», no de «${plantaId}»`);
        plantaId = pe.id;
        if (muro === undefined && datos.x === undefined && datos.y === undefined) {
          // Lo de pared se cuelga en una pared de esa estancia; lo demás, en su centro.
          if (tipoMueble(tipo).pared) datos.estancia = est.id;
          else {
            const c = cajaContorno(est.contorno);
            Object.assign(datos, { x: Math.round(((c.minX + c.maxX) / 2) * 10) / 10, y: Math.round(((c.minY + c.maxY) / 2) * 10) / 10 });
          }
        }
      }
      if (muro !== undefined) {
        if (datos.x !== undefined || datos.y !== undefined) throw new ErrorOperacion('Usa «x» e «y» o «muro» y «desde», no ambos');
        if (datos.giro !== undefined) throw new ErrorOperacion('Con «muro» el giro lo da la pared (el frente mira hacia dentro); quita «giro» o colócalo con «x» e «y»');
        const base = tipoMueble(tipo);
        const medidas = { ancho: datos.ancho ?? base.ancho, fondo: datos.fondo ?? base.fondo };
        const p = posicionContraMuro(e, medidas, muro, num(op, 'desde', true) as number, num(op, 'separacion') ?? 0, estId ?? estanciaDePlanta(e, plantaId));
        Object.assign(datos, { x: p.x, y: p.y, giro: datos.giro ?? p.giro });
      } else if (op.desde !== undefined || op.separacion !== undefined) throw new ErrorOperacion('«desde» y «separacion» van con «muro»');
      else if ((datos.x === undefined) !== (datos.y === undefined)) throw new ErrorOperacion('Indica «x» e «y» juntos');
      const r = agregarMueble(e, datos, plantaId);
      const m = buscar(r.espacio, r.id);
      return { espacio: r.espacio, nota: `añadido ${r.id} (${m.ancho}x${m.fondo}x${m.alto} cm) en (${m.x}, ${m.y}), giro ${m.giro}°` };
    }
    case 'mover': {
      const id = txt(op, 'id', true) as string;
      const m = buscar(e, id);
      const muro = num(op, 'muro');
      if (muro !== undefined) {
        if (['x', 'y', 'dx', 'dy'].some((k) => op[k] !== undefined)) throw new ErrorOperacion('Usa «muro» y «desde» o coordenadas, no ambos');
        const estId = txt(op, 'estancia');
        if (estId !== undefined) {
          // Mover no cambia de planta: el muro tiene que ser de una estancia de la planta del mueble.
          const pm = buscarMueble(e, id)!.planta.id;
          const pe = estancia(e, estId).planta.id;
          if (pe !== pm) throw new ErrorOperacion(`La estancia «${estId}» es de la planta «${pe}» y «${id}» está en «${pm}»: mover no cambia de planta`);
        }
        const p = posicionContraMuro(e, m, muro, num(op, 'desde', true) as number, num(op, 'separacion') ?? 0, estId ?? estanciaDelMueble(e, id));
        const r = editarMueble(e, id, p);
        return { espacio: r, nota: `movido ${id} contra el muro ${muro} en (${p.x}, ${p.y}), giro ${p.giro}°` };
      }
      if (op.desde !== undefined || op.separacion !== undefined) throw new ErrorOperacion('«desde» y «separacion» van con «muro»');
      if (op.estancia !== undefined) throw new ErrorOperacion('«estancia» va con «muro» (dice de qué estancia es el muro); con «x»/«y» no hace falta');
      const dx = num(op, 'dx');
      const dy = num(op, 'dy');
      if ((op.x !== undefined && dx !== undefined) || (op.y !== undefined && dy !== undefined)) throw new ErrorOperacion('Usa «x» o «dx» (e «y» o «dy»), no los dos para el mismo eje');
      if (op.x === undefined && op.y === undefined && dx === undefined && dy === undefined) throw new ErrorOperacion('«mover» necesita «x»/«y», «dx»/«dy» o «muro»/«desde»');
      const x = num(op, 'x') ?? m.x + (dx ?? 0);
      const y = num(op, 'y') ?? m.y + (dy ?? 0);
      const r = moverMueble(e, id, x, y);
      const n = buscar(r, id);
      return { espacio: r, nota: `movido ${id} a (${n.x}, ${n.y})` };
    }
    case 'girar': {
      const id = txt(op, 'id', true) as string;
      const m = buscar(e, id);
      const giro = num(op, 'giro');
      const sumar = num(op, 'sumar');
      if ((giro === undefined) === (sumar === undefined)) throw new ErrorOperacion('«girar» necesita «giro» (absoluto) o «sumar» (relativo), uno de los dos');
      const r = girarMueble(e, id, giro ?? m.giro + (sumar as number));
      return { espacio: r, nota: `girado ${id} a ${buscar(r, id).giro}°` };
    }
    case 'editar': {
      const id = txt(op, 'id', true) as string;
      let r = e;
      // Primero las medidas y luego el tipo: así los valores por defecto del tipo nuevo (p. ej. el
      // hueco inferior de un escritorio) se calculan con el alto nuevo.
      const cambios = datosMueble(op);
      if (op.modelo === null) cambios.modelo = undefined;
      if (Object.keys(cambios).length) r = editarMueble(r, id, cambios);
      const tipo = txt(op, 'tipo');
      if (tipo !== undefined) r = cambiarTipo(r, id, tipo);
      if (r === e) throw new ErrorOperacion('«editar» sin cambios: indica algún campo');
      return { espacio: r, nota: `editado ${id}` };
    }
    case 'quitar': {
      const id = txt(op, 'id', true) as string;
      return { espacio: quitarMueble(e, id), nota: `quitado ${id}` };
    }
    case 'pegar-pared': {
      const id = txt(op, 'id', true) as string;
      const r = pegarAPared(e, id, num(op, 'muro'));
      const m = buscar(r, id);
      return { espacio: r, nota: `${id} contra la pared en (${m.x}, ${m.y}), giro ${m.giro}°` };
    }
    case 'hueco-agregar': {
      const tipo = txt(op, 'tipo', true) as DatosHueco['tipo'];
      const datos: DatosHueco = {
        tipo,
        muro: num(op, 'muro', true) as number,
        desde: num(op, 'desde', true) as number,
        ancho: num(op, 'ancho', true) as number,
        ...sinIndefinidos({
          id: txt(op, 'id'),
          alto: num(op, 'alto'),
          antepecho: num(op, 'antepecho'),
          abre: txt(op, 'abre') as DatosHueco['abre'],
          bisagra: txt(op, 'bisagra') as DatosHueco['bisagra'],
        }),
      };
      const r = agregarHueco(e, datos, txt(op, 'estancia'));
      return { espacio: r.espacio, nota: `añadido hueco ${r.id} (${tipo}) en el muro ${datos.muro}` };
    }
    case 'hueco-quitar': {
      const id = txt(op, 'id', true) as string;
      return { espacio: quitarHueco(e, id), nota: `quitado hueco ${id}` };
    }
    case 'distribucion-guardar': {
      const nombre = txt(op, 'nombre', true) as string;
      return { espacio: guardarDistribucion(e, nombre), nota: `guardada la distribución «${nombre}»` };
    }
    case 'distribucion-aplicar': {
      const nombre = txt(op, 'nombre', true) as string;
      const r = aplicarDistribucion(e, nombre);
      const extra = [
        r.ignorados.length ? `ignorados (ya no existen): ${r.ignorados.join(', ')}` : '',
        r.sinPosicion.length ? `sin posición en ella (no se mueven): ${r.sinPosicion.join(', ')}` : '',
        r.bloqueados.length ? `bloqueados (no se mueven): ${r.bloqueados.join(', ')}` : '',
      ].filter(Boolean);
      return { espacio: r.espacio, nota: `aplicada la distribución «${nombre}»${extra.length ? `; ${extra.join('; ')}` : ''}` };
    }
    case 'distribucion-quitar': {
      const nombre = txt(op, 'nombre', true) as string;
      return { espacio: quitarDistribucion(e, nombre), nota: `quitada la distribución «${nombre}»` };
    }
    case 'estancia': {
      const ancho = num(op, 'ancho');
      const largo = num(op, 'largo');
      const alto = num(op, 'alto');
      const grosor = num(op, 'grosorMuros');
      const nombre = txt(op, 'nombre');
      const giro = op.circuloDeGiro;
      if (giro !== undefined && typeof giro !== 'boolean') throw new ErrorOperacion('«circuloDeGiro» debe ser true o false');
      // Acabados (R4-2): «suelo» (tipo o null), «colorSuelo» (#rrggbb o null: el del tipo) y «paredes» (#rrggbb o null).
      let acabados: { suelo?: Suelo | null; paredes?: string | null } = {};
      if (op.suelo !== undefined || op.colorSuelo !== undefined || op.paredes !== undefined) {
        const actual = estancia(e, txt(op, 'estancia')).estancia.suelo;
        if (op.suelo === null) acabados.suelo = null;
        else if (op.suelo !== undefined || op.colorSuelo !== undefined) {
          const tipo = op.suelo === undefined ? (actual?.tipo ?? 'liso') : op.suelo;
          if (typeof tipo !== 'string') throw new ErrorOperacion('«suelo» debe ser «liso», «parquet», «baldosa», «moqueta» o null');
          const color = op.colorSuelo === undefined ? (op.suelo === undefined ? actual?.color : undefined) : op.colorSuelo;
          if (color !== undefined && color !== null && typeof color !== 'string') throw new ErrorOperacion('«colorSuelo» debe ser #rrggbb o null');
          acabados.suelo = { tipo: tipo as Suelo['tipo'], ...(typeof color === 'string' ? { color } : {}) };
        }
        if (op.paredes !== undefined) {
          if (op.paredes !== null && typeof op.paredes !== 'string') throw new ErrorOperacion('«paredes» debe ser #rrggbb o null');
          acabados.paredes = op.paredes as string | null;
        }
      }
      if ([ancho, largo, alto, grosor, nombre, giro, op.suelo, op.colorSuelo, op.paredes].every((v) => v === undefined)) throw new ErrorOperacion('«estancia» necesita «ancho»/«largo», «alto», «grosor», «nombre», «circuloDeGiro», «suelo», «colorSuelo» o «paredes»');
      let r = e;
      if (nombre !== undefined) r = renombrarEstancia(r, txt(op, 'estancia') ?? estancia(e).estancia.id, nombre);
      if (ancho !== undefined || largo !== undefined) {
        const rect = esRectangular(e, txt(op, 'estancia'));
        if (!rect) throw new ErrorOperacion('Ancho y largo sólo valen para estancias rectangulares; cambia sus paredes una a una');
        r = redimensionarRectangulo(r, ancho ?? rect.ancho, largo ?? rect.largo, undefined, txt(op, 'estancia'));
      }
      if (alto !== undefined || grosor !== undefined || giro !== undefined) r = editarEstancia(r, sinIndefinidos({ altura: alto, grosorMuros: grosor, circuloDeGiro: giro as boolean | undefined }), txt(op, 'estancia'));
      if (Object.keys(acabados).length) r = editarEstancia(r, acabados, txt(op, 'estancia'));
      return { espacio: r, nota: 'estancia cambiada' };
    }
    case 'estancia-agregar': {
      const rect = ['x', 'y', 'ancho', 'largo'].map((k) => num(op, k));
      let contorno: Punto[];
      if (op.contorno !== undefined) {
        if (rect.some((v) => v !== undefined)) throw new ErrorOperacion('Usa «contorno» o «x», «y», «ancho» y «largo», no ambos');
        contorno = contornoDe(op);
      } else {
        if (rect.some((v) => v === undefined)) throw new ErrorOperacion('«estancia-agregar» necesita «contorno» o «x», «y», «ancho» y «largo» (esquina superior izquierda y medidas, en cm)');
        const [x, y, an, la] = rect as number[];
        contorno = [[x!, y!], [x! + an!, y!], [x! + an!, y! + la!], [x!, y! + la!]];
      }
      const r = agregarEstancia(e, { contorno, ...sinIndefinidos({ id: txt(op, 'id'), nombre: txt(op, 'nombre'), altura: num(op, 'alto') }) }, txt(op, 'planta'));
      return { espacio: r.espacio, nota: `añadida la estancia ${r.id}` };
    }
    case 'estancia-quitar': {
      const id = txt(op, 'id', true) as string;
      const r = quitarEstancia(e, id);
      return { espacio: r.espacio, nota: `quitada la estancia ${id}${r.mueblesDentro.length ? `; sus muebles (${r.mueblesDentro.join(', ')}) siguen en la planta, ahora fuera de toda estancia` : ''}` };
    }
    case 'estancia-contorno': {
      const id = txt(op, 'estancia') ?? estancia(e).estancia.id;
      return { espacio: cambiarContorno(e, contornoDe(op), id), nota: `contorno de ${id} cambiado` };
    }
    case 'fondo-poner': {
      const datos = {
        archivo: txt(op, 'archivo', true) as string,
        anchoPx: num(op, 'anchoPx', true) as number,
        altoPx: num(op, 'altoPx', true) as number,
        ...sinIndefinidos({ id: txt(op, 'id'), escala: num(op, 'escala'), x: num(op, 'x'), y: num(op, 'y'), giro: num(op, 'giro'), opacidad: num(op, 'opacidad') }),
      };
      const r = ponerFondo(e, datos, txt(op, 'planta'));
      return { espacio: r.espacio, nota: `puesto el fondo ${r.id} (${datos.archivo})` };
    }
    case 'fondo-calibrar': {
      const id = txt(op, 'id', true) as string;
      const [x1, y1, x2, y2] = numeros(op, 'puntos', 4, '120,80,940,80');
      const en = op.en !== undefined ? (numeros(op, 'en', 2, '0,0') as [number, number]) : undefined;
      const r = calibrarFondo(e, id, [x1!, y1!], [x2!, y2!], num(op, 'distancia', true) as number, en);
      const f = r.plantas.flatMap((p) => p.fondos ?? []).find((x) => x.id === id)!;
      return { espacio: r, nota: `fondo ${id} calibrado: ${f.escala} cm por píxel; su esquina está en (${f.x}, ${f.y}) cm` };
    }
    case 'fondo-editar': {
      const id = txt(op, 'id', true) as string;
      const cambios = sinIndefinidos({ escala: num(op, 'escala'), x: num(op, 'x'), y: num(op, 'y'), giro: num(op, 'giro'), opacidad: num(op, 'opacidad') });
      if (!Object.keys(cambios).length) throw new ErrorOperacion('«fondo-editar» necesita «escala», «x», «y», «giro» u «opacidad»');
      return { espacio: editarFondo(e, id, cambios), nota: `fondo ${id} cambiado` };
    }
    case 'fondo-quitar': {
      const id = txt(op, 'id', true) as string;
      return { espacio: quitarFondo(e, id), nota: `quitado el fondo ${id}` };
    }
    case 'elemento-agregar':
    case 'elemento-editar': {
      // Sólo las claves que vienen; números, «redondo» (sí/no) y los puntos «de» y «a» de las vigas.
      const datos: Record<string, unknown> = {};
      for (const k of ['x', 'y', 'ancho', 'fondo', 'giro', 'alto', 'elevacion', 'muro', 'desde', 'altura', 'canto']) {
        const v = num(op, k);
        if (v !== undefined) datos[k] = v;
      }
      for (const k of ['de', 'a']) if (op[k] !== undefined) datos[k] = numeros(op, k, 2, '0,120');
      const redondo = boo(op, 'redondo');
      if (redondo !== undefined) datos.redondo = redondo;
      const tipo = txt(op, 'tipo');
      if (tipo !== undefined) datos.tipo = tipo;
      if (op.op === 'elemento-editar') {
        const id = txt(op, 'id', true) as string;
        if (!Object.keys(datos).length) throw new ErrorOperacion('«elemento-editar» necesita algo que cambiar');
        return { espacio: editarElemento(e, id, datos), nota: `elemento ${id} cambiado` };
      }
      const forma = txt(op, 'forma', true) as string;
      if (!['exento', 'adosado', 'punto', 'viga'].includes(forma)) throw new ErrorOperacion('«forma» debe ser exento (en medio), adosado (contra un muro), punto (en un muro) o viga');
      if (forma === 'viga' && (op.de === undefined || op.a === undefined)) throw new ErrorOperacion('Una viga necesita «de» y «a»: los dos puntos de la planta entre los que va, p. ej. --de "0,150" --a "400,150"');
      if ((forma === 'adosado' || forma === 'punto') && (op.muro === undefined || op.desde === undefined)) throw new ErrorOperacion(`Un elemento ${forma} necesita «muro» y «desde» (dónde está en la pared)`);
      if (forma === 'exento' && (op.x === undefined || op.y === undefined)) throw new ErrorOperacion('Un elemento exento necesita «x» e «y» (su centro)');
      const id = txt(op, 'id');
      const r = agregarElemento(e, { ...datos, forma: forma as 'exento', ...(id !== undefined ? { id } : {}) }, txt(op, 'estancia'));
      return { espacio: r.espacio, nota: `añadido el elemento ${r.id} (${forma})` };
    }
    case 'elemento-quitar': {
      const id = txt(op, 'id', true) as string;
      return { espacio: quitarElemento(e, id), nota: `quitado el elemento ${id}` };
    }
    case 'faldon-poner': {
      const muro = num(op, 'muro', true) as number;
      const f = { muro, alturaEnMuro: num(op, 'alturaEnMuro', true) as number, alcance: num(op, 'alcance', true) as number };
      return { espacio: ponerFaldon(e, f, txt(op, 'estancia')), nota: `techo inclinado sobre el muro ${muro}: ${f.alturaEnMuro} cm junto a él, sube en ${f.alcance} cm` };
    }
    case 'faldon-quitar': {
      const muro = num(op, 'muro', true) as number;
      return { espacio: quitarFaldon(e, muro, txt(op, 'estancia')), nota: `quitado el techo inclinado del muro ${muro}` };
    }
    case 'foto-agregar': {
      const para = txt(op, 'para', true) as string;
      const foto = txt(op, 'foto', true) as string;
      return { espacio: agregarFoto(e, para, foto), nota: `foto ${foto} en ${para}` };
    }
    case 'foto-quitar': {
      const para = txt(op, 'para', true) as string;
      const foto = txt(op, 'foto', true) as string;
      return { espacio: quitarFoto(e, para, foto), nota: `quitada la foto ${foto} de ${para}` };
    }
    case 'renombrar': {
      const nombre = txt(op, 'nombre', true) as string;
      return { espacio: renombrarEspacio(e, nombre), nota: `renombrado a «${nombre}»` };
    }
    case 'planta-agregar': {
      const rect = ['x', 'y', 'ancho', 'largo'].map((k) => num(op, k));
      let contorno: Punto[] | undefined;
      if (op.contorno !== undefined) {
        if (rect.some((v) => v !== undefined)) throw new ErrorOperacion('Usa «contorno» o «x», «y», «ancho» y «largo», no ambos');
        contorno = contornoDe(op);
      } else if (rect.some((v) => v !== undefined)) {
        if (rect.some((v) => v === undefined)) throw new ErrorOperacion('Indica «x», «y», «ancho» y «largo» juntos (la primera estancia de la planta)');
        const [x, y, an, la] = rect as number[];
        contorno = [[x!, y!], [x! + an!, y!], [x! + an!, y! + la!], [x!, y! + la!]];
      }
      const r = agregarPlanta(e, {
        ...sinIndefinidos({ id: txt(op, 'id'), nombre: txt(op, 'nombre'), nivel: num(op, 'nivel'), copiarDe: txt(op, 'copiarDe'), conVentanas: boo(op, 'conVentanas'), alto: num(op, 'alto') }),
        ...(contorno ? { contorno } : {}),
      });
      const p = planta(r.espacio, r.id);
      return { espacio: r.espacio, nota: `añadida la planta ${r.id} a nivel ${p.nivel} cm con ${r.estancias.length === 1 ? 'la estancia' : 'las estancias'} ${r.estancias.join(', ')}` };
    }
    case 'planta-editar': {
      const id = txt(op, 'id', true) as string;
      return { espacio: editarPlanta(e, id, sinIndefinidos({ nombre: txt(op, 'nombre'), nivel: num(op, 'nivel') })), nota: `editada la planta ${id}` };
    }
    case 'planta-quitar': {
      const id = txt(op, 'id', true) as string;
      const r = quitarPlanta(e, id);
      const q = r.quitado;
      return { espacio: r.espacio, nota: `quitada la planta ${id} con ${q.estancias} estancias, ${q.muebles} muebles, ${q.elementos} elementos de obra, ${q.fondos} fondos y ${q.escaleras} escaleras` };
    }
    case 'escalera-agregar': {
      const r = agregarEscalera(e, datosEscalera(op), txt(op, 'planta'));
      return { espacio: r.espacio, nota: `añadida la escalera ${r.id}` };
    }
    case 'escalera-editar': {
      const id = txt(op, 'id', true) as string;
      const { id: _id, ...cambios } = datosEscalera(op);
      if (!Object.keys(cambios).length) throw new ErrorOperacion('«escalera-editar» sin cambios: indica algún campo');
      return { espacio: editarEscalera(e, id, cambios), nota: `editada la escalera ${id}` };
    }
    case 'escalera-quitar': {
      const id = txt(op, 'id', true) as string;
      return { espacio: quitarEscalera(e, id), nota: `quitada la escalera ${id}` };
    }
    case 'tabique-mover': {
      const est = txt(op, 'estancia') ?? estancia(e).estancia.id;
      const muro = num(op, 'muro', true) as number;
      const d = num(op, 'distancia', true) as number;
      const r = moverTabique(e, est, muro, d);
      const con = r.vecinas.map((x) => `la pared ${x.muro} de ${x.estancia}`).join(' y ');
      return {
        espacio: r.espacio,
        nota: `movida la pared ${muro} de ${est} ${Math.abs(d)} cm hacia ${d >= 0 ? 'fuera' : 'dentro'}${con ? ` con ${con} (los tabiques conservan su grosor)` : ' (no da a otra estancia)'}`,
      };
    }
  }
  throw new ErrorOperacion(`Operación sin implementar «${op.op}»`);
}

/** Aplica todas las operaciones o ninguna. */
export function ejecutarLote(e: Espacio, ops: unknown): { espacio: Espacio; notas: string[] } {
  if (!Array.isArray(ops)) throw new ErrorOperacion('Las operaciones deben ser una lista JSON: [{"op": "agregar", ...}, ...]');
  let actual = e;
  const notas: string[] = [];
  ops.forEach((op, i) => {
    if (typeof op !== 'object' || op === null || typeof (op as Op).op !== 'string') throw new ErrorOperacion(`Operación ${i}: debe ser un objeto con «op»`);
    try {
      const r = ejecutarOp(actual, op as Op);
      actual = r.espacio;
      notas.push(r.nota);
    } catch (err) {
      throw new ErrorOperacion(`Operación ${i} («${(op as Op).op}»): ${err instanceof Error ? err.message : String(err)}. No se ha aplicado ninguna.`);
    }
  });
  return { espacio: actual, notas };
}
