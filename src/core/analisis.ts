// Análisis de la distribución: incidencias con gravedad.
//  error: fuera de la estancia, más alto que el techo (también inclinado), solape, barrido de puerta,
//         franja de paso, choque con un elemento de obra o con una viga.
//  aviso: silla bajo mesa, ventana tapada, holgura frontal invadida, radiador o enchufe tapados,
//         mueble a medias sobre un escalón, hueco que no atraviesa un muro limpio.
import { convexoDentroDePoligono, esquinasMueble, muro, normalInterior, solapeConvexos } from './geometria.js';
import { bandaVentana, barridoPuerta, FRANJA_PASO, franjaPaso, geometriaHueco, zonaFrente, type GeometriaHueco } from './huecos.js';
import { ErrorGeometria } from './booleanas.js';
import { modeloPlanta, type ModeloPlanta } from './muros.js';
import { alturaTecho, deElemento, huellaElemento, nombreElemento, puntoEnElMuro, rangoAltura, tipoNormal } from './elementos.js';
import { estanciaDeMueble } from './espacio.js';
import { tipoMueble } from './catalogo.js';
import { distanciaAlContorno, localAPlanta } from './geometria.js';
import { analizarEscaleras } from './escaleras.js';
import { analizarAcceso } from './acceso.js';
import type { Espacio, Estancia, Mueble, Planta, Punto } from './tipos.js';
import { TOLERANCIA } from './tipos.js';

export type Gravedad = 'error' | 'aviso';

export type Regla = 'fuera' | 'altura' | 'solape' | 'silla-bajo' | 'puerta' | 'paso' | 'ventana' | 'holgura' | 'hueco' | 'elemento' | 'niveles' | 'escalera' | 'acceso' | 'giro' | 'pared';

export interface Incidencia {
  gravedad: Gravedad;
  regla: Regla;
  mensaje: string;
  muebles: string[];
  huecos?: string[];
  /** Planta de la incidencia (sólo en espacios de varias plantas). */
  planta?: string;
  /** Escaleras afectadas. */
  escaleras?: string[];
}

function nombre(m: Mueble): string {
  return `«${m.nombre}» (${m.id})`;
}

/**
 * ¿b cabe en el hueco inferior de a? Por altura y además con su huella entera bajo la de a: una
 * cama baja que asoma por debajo de un escritorio choca con sus patas o su borde.
 */
function cabeDebajo(a: Mueble, b: Mueble): boolean {
  return (
    a.huecoInferior > 0 &&
    b.elevacion >= a.elevacion - TOLERANCIA &&
    b.elevacion + b.alto <= a.elevacion + a.huecoInferior + TOLERANCIA &&
    convexoDentroDePoligono(esquinasMueble(b), esquinasMueble(a))
  );
}

/**
 * Una silla metida bajo una mesa o escritorio: el asiento cabe en el hueco pero el respaldo no.
 * No es un choque seguro (se mete hasta que el respaldo toca el tablero): se avisa, no se marca error.
 */
export function esSillaBajo(silla: Mueble, mesa: Mueble): boolean {
  return silla.tipo === 'silla' && mesa.huecoInferior > 0 && silla.elevacion < mesa.elevacion + mesa.huecoInferior;
}

/** Alto máximo (cm) de lo que se considera plano en el suelo: alfombras, felpudos. */
export const ALTO_PLANO = 3;

/** Alfombras y similares: van debajo de todo y no estorban a puertas ni al paso. */
export function esPlano(m: Mueble): boolean {
  return m.alto <= ALTO_PLANO && m.elevacion <= TOLERANCIA;
}

/** Los intervalos de altura de a y b se cruzan (y ninguno cabe bajo el otro). */
export function chocanEnAltura(a: Mueble, b: Mueble): boolean {
  if (esPlano(a) || esPlano(b)) return false;
  const cruce = Math.min(a.elevacion + a.alto, b.elevacion + b.alto) - Math.max(a.elevacion, b.elevacion);
  if (cruce <= TOLERANCIA) return false;
  return !cabeDebajo(a, b) && !cabeDebajo(b, a);
}

/** Incidencias de todas las plantas. */
export function analizar(espacio: Espacio): Incidencia[] {
  // Con una sola planta, la salida es la de siempre (sin «planta»): la v1 da exactamente la misma.
  // Acceso (R4-1): entrar por las puertas, paso libre y círculo de giro; avisos, al final.
  if (espacio.plantas.length === 1) {
    const base = analizarPlanta(espacio.plantas[0]!);
    const errores = new Set(base.some((i) => i.gravedad === 'error') ? [espacio.plantas[0]!.id] : []);
    return [...base, ...analizarAcceso(espacio, errores).map((i): Incidencia => ({ gravedad: 'aviso', regla: i.regla, mensaje: i.mensaje, muebles: i.muebles }))];
  }
  const escaleras: Incidencia[] = analizarEscaleras(espacio).map((i) => ({ gravedad: i.gravedad, regla: 'escalera', mensaje: i.mensaje, muebles: i.muebles, planta: i.planta, escaleras: [i.escalera] }));
  const base = [...analizarNiveles(espacio), ...escaleras, ...espacio.plantas.flatMap((p) => analizarPlanta(p).map((i) => ({ ...i, planta: p.id })))];
  const errores = new Set(base.filter((i) => i.gravedad === 'error' && i.planta).map((i) => i.planta!));
  return [
    ...base,
    ...analizarAcceso(espacio, errores).map((i): Incidencia => ({ gravedad: 'aviso', regla: i.regla, mensaje: i.mensaje, muebles: i.muebles, planta: i.planta })),
  ];
}

/** Incidencias de una planta en su espacio: las suyas, las de niveles y las de escaleras que la tocan. */
export function incidenciasDePlanta(e: Espacio, plantaId: string): Incidencia[] {
  if (e.plantas.length === 1) return analizar(e);
  return analizar(e).filter((i) => i.planta === plantaId).map(({ planta: _p, ...i }) => i);
}

/** Niveles de las plantas: dos al mismo nivel, o una que empieza antes de que acabe la de debajo. */
function analizarNiveles(e: Espacio): Incidencia[] {
  const res: Incidencia[] = [];
  const orden = [...e.plantas].sort((a, b) => a.nivel - b.nivel);
  for (let k = 1; k < orden.length; k++) {
    const abajo = orden[k - 1]!;
    const arriba = orden[k]!;
    const techo = abajo.nivel + Math.max(0, ...abajo.estancias.map((s) => s.altura));
    if (arriba.nivel === abajo.nivel) {
      res.push({ gravedad: 'aviso', regla: 'niveles', mensaje: `Las plantas «${abajo.nombre}» (${abajo.id}) y «${arriba.nombre}» (${arriba.id}) están al mismo nivel (${arriba.nivel} cm): cambia el «nivel» de una`, muebles: [], planta: arriba.id });
    } else if (arriba.nivel < techo - TOLERANCIA) {
      res.push({ gravedad: 'aviso', regla: 'niveles', mensaje: `La planta «${arriba.nombre}» (${arriba.id}) empieza a ${arriba.nivel} cm y el techo de «${abajo.nombre}» (${abajo.id}) llega a ${techo} cm: los pisos se pisan`, muebles: [], planta: arriba.id });
    }
  }
  return res;
}

/**
 * Incidencias de una planta. Cada mueble se comprueba contra la estancia que lo contiene (su
 * centro): debe quedar entero dentro de ella y bajo su techo. Solapes, puertas y holguras se
 * comprueban con todos los muebles de la planta.
 */
/** Fondo (cm) delante de un radiador que conviene dejar libre para que caliente. */
const DELANTE_RADIADOR = 10;
/** Tramo (cm) alrededor de un enchufe o interruptor que un mueble pegado a la pared tapa. */
const LADO_ENCHUFE = 5;

/** Choques de un mueble con los elementos de obra de su estancia (R2-4). */
function choquesConElementos(est: Estancia, m: Mueble, e: Punto[]): Incidencia[] {
  const res: Incidencia[] = [];
  const arriba = m.elevacion + m.alto;
  // Lo que cabe en el hueco inferior del mueble (un radiador bajo un escritorio) no choca.
  const bajoElHueco = (z1: number): boolean => m.huecoInferior > 0 && z1 <= m.elevacion + m.huecoInferior + TOLERANCIA;
  for (const el of est.elementos ?? []) {
    const tipo = tipoNormal(el.tipo);
    if (el.forma === 'punto') {
      // Enchufe, interruptor o toma tapados: un mueble pegado a la pared delante y más alto que él.
      const [a, b] = muro(est.contorno, el.muro);
      const largo = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u: Punto = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
      const n = normalInterior(est.contorno, el.muro);
      const c = puntoEnElMuro(est, el);
      const zona: Punto[] = [
        [c[0] - u[0] * LADO_ENCHUFE, c[1] - u[1] * LADO_ENCHUFE],
        [c[0] + u[0] * LADO_ENCHUFE, c[1] + u[1] * LADO_ENCHUFE],
        [c[0] + u[0] * LADO_ENCHUFE + n[0] * 10, c[1] + u[1] * LADO_ENCHUFE + n[1] * 10],
        [c[0] - u[0] * LADO_ENCHUFE + n[0] * 10, c[1] - u[1] * LADO_ENCHUFE + n[1] * 10],
      ];
      if (arriba > el.altura && m.elevacion < el.altura + 10 && !bajoElHueco(el.altura) && solapeConvexos(e, zona) > 0) {
        res.push({ gravedad: 'aviso', regla: 'elemento', mensaje: `${nombre(m)} tapa ${nombreElemento(el)} (está a ${el.altura} cm del suelo)`, muebles: [m.id] });
      }
      continue;
    }
    const huella = huellaElemento(est, el)!;
    const [z0, z1] = rangoAltura(est, el);
    const seCruzan = solapeConvexos(e, huella) > 0;
    if (el.forma === 'viga') {
      if (seCruzan && arriba > z0 + TOLERANCIA) {
        res.push({ gravedad: 'error', regla: 'elemento', mensaje: `${nombre(m)} choca con ${nombreElemento(el)}, que baja hasta ${Math.round(z0)} cm`, muebles: [m.id] });
      }
      continue;
    }
    if (tipo === 'escalon') {
      // Un mueble apoyado entero en el escalón vale; a medias, cojea.
      if (seCruzan && !convexoDentroDePoligono(e, huella)) {
        res.push({ gravedad: 'aviso', regla: 'elemento', mensaje: `${nombre(m)} queda a medias sobre ${nombreElemento(el)}`, muebles: [m.id] });
      }
      continue;
    }
    if (seCruzan && m.elevacion < z1 - TOLERANCIA && arriba > z0 + TOLERANCIA && !bajoElHueco(z1)) {
      res.push({ gravedad: 'error', regla: 'elemento', mensaje: `${nombre(m)} choca con ${nombreElemento(el)}`, muebles: [m.id] });
    } else if (el.forma === 'adosado' && tipo === 'radiador' && !bajoElHueco(z1)) {
      const n = normalInterior(est.contorno, el.muro);
      const delante = [huella[3]!, huella[2]!, [huella[2]![0] + n[0] * DELANTE_RADIADOR, huella[2]![1] + n[1] * DELANTE_RADIADOR] as Punto, [huella[3]![0] + n[0] * DELANTE_RADIADOR, huella[3]![1] + n[1] * DELANTE_RADIADOR] as Punto];
      if (solapeConvexos(e, delante) > 0 && m.elevacion < z1) {
        res.push({ gravedad: 'aviso', regla: 'elemento', mensaje: `${nombre(m)} está a menos de ${DELANTE_RADIADOR} cm delante ${deElemento(el)}: no calentará bien`, muebles: [m.id] });
      }
    }
  }
  return res;
}

export function analizarPlanta(p: Planta): Incidencia[] {
  const res: Incidencia[] = [];
  const esquinas = new Map(p.muebles.map((m) => [m.id, esquinasMueble(m)]));
  // Con una sola estancia, todo pertenece a ella aunque esté fuera (así el techo y la holgura se comprueban igual).
  const unica = p.estancias.length === 1 ? (p.estancias[0] as Estancia) : null;
  const estanciaDe = new Map(p.muebles.map((m) => [m.id, estanciaDeMueble(p, m) ?? unica]));

  for (const m of p.muebles) {
    const est = estanciaDe.get(m.id) ?? null;
    if (!est || !convexoDentroDePoligono(esquinas.get(m.id)!, est.contorno)) {
      res.push({ gravedad: 'error', regla: 'fuera', mensaje: `${nombre(m)} se sale de la estancia o atraviesa un muro`, muebles: [m.id] });
    }
    if (est && m.elevacion + m.alto > est.altura + TOLERANCIA) {
      res.push({ gravedad: 'error', regla: 'altura', mensaje: `${nombre(m)} supera la altura del techo (${m.elevacion + m.alto} > ${est.altura} cm)`, muebles: [m.id] });
    } else if (est?.faldones?.length) {
      // Techo inclinado: el mueble tiene que caber en su esquina más baja.
      const techo = Math.min(...esquinas.get(m.id)!.map((q) => alturaTecho(est, q)));
      if (m.elevacion + m.alto > techo + TOLERANCIA) {
        res.push({ gravedad: 'error', regla: 'altura', mensaje: `${nombre(m)} no cabe bajo el techo inclinado (mide ${m.elevacion + m.alto} cm y en su esquina más baja el techo está a ${Math.round(techo)} cm)`, muebles: [m.id] });
      }
    }
    if (est?.elementos?.length && !esPlano(m)) res.push(...choquesConElementos(est, m, esquinas.get(m.id)!));
  }

  const ms = p.muebles;
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i] as Mueble;
      const b = ms[j] as Mueble;
      if (!chocanEnAltura(a, b)) continue;
      const pen = solapeConvexos(esquinas.get(a.id)!, esquinas.get(b.id)!);
      if (pen <= 0) continue;
      const silla = esSillaBajo(a, b) ? a : esSillaBajo(b, a) ? b : null;
      if (silla) {
        const mesa = silla === a ? b : a;
        // Una silla que cabe por altura bajo el tablero puede asomar por delante: es lo normal.
        if (silla.elevacion + silla.alto <= mesa.elevacion + mesa.huecoInferior + TOLERANCIA) continue;
        res.push({
          gravedad: 'aviso',
          regla: 'silla-bajo',
          mensaje: `${nombre(silla)} entra bajo ${nombre(mesa)}; el respaldo es más alto que el hueco (${mesa.huecoInferior} cm): comprueba que cabe como la dejas`,
          muebles: [silla.id, mesa.id],
        });
      } else {
        res.push({ gravedad: 'error', regla: 'solape', mensaje: `${nombre(a)} y ${nombre(b)} se solapan (${Math.round(pen * 10) / 10} cm)`, muebles: [a.id, b.id] });
      }
    }
  }

  // Lo que va en la pared (cuadros, espejos, baldas…) y se ha quedado sin tocar ninguna: su trasera
  // tiene que estar contra la pared de su estancia (o casi: 2 cm).
  for (const m of p.muebles) {
    if (!tipoMueble(m.tipo).pared || m.elevacion <= 0) continue;
    const est = estanciaDe.get(m.id);
    if (!est) continue;
    const traseraA = localAPlanta(m, -m.ancho / 2 + 1, -m.fondo / 2);
    const traseraB = localAPlanta(m, m.ancho / 2 - 1, -m.fondo / 2);
    if (Math.max(distanciaAlContorno(traseraA, est.contorno), distanciaAlContorno(traseraB, est.contorno)) > 2) {
      res.push({ gravedad: 'aviso', regla: 'pared', mensaje: `${nombre(m)} va colgado y no toca la pared: arrímalo con su trasera contra ella («pegar-pared»)`, muebles: [m.id] });
    }
  }

  // Puertas, pasos y ventanas de todas las estancias de la planta.
  for (const { h, contorno } of p.estancias.flatMap((s) => s.huecos.map((h) => ({ h, contorno: s.contorno })))) {
    const g = geometriaHueco(contorno, h);
    const barrido = barridoPuerta(g);
    const paso = franjaPaso(g);
    const banda = bandaVentana(g);
    for (const m of ms) {
      if (esPlano(m)) continue;
      const e = esquinas.get(m.id)!;
      const debajoDelDintel = m.elevacion < h.antepecho + h.alto - TOLERANCIA;
      if (barrido && debajoDelDintel && solapeConvexos(e, barrido) > 0) {
        res.push({ gravedad: 'error', regla: 'puerta', mensaje: `${nombre(m)} está en el barrido de la puerta «${h.id}»: no se podría abrir del todo`, muebles: [m.id], huecos: [h.id] });
      } else if (paso && debajoDelDintel && solapeConvexos(e, paso) > 0) {
        res.push({ gravedad: 'error', regla: 'paso', mensaje: `${nombre(m)} tapa el paso de «${h.id}» (deja libres ${FRANJA_PASO} cm delante)`, muebles: [m.id], huecos: [h.id] });
      }
      if (banda && m.elevacion + m.alto > h.antepecho + TOLERANCIA && m.elevacion < h.antepecho + h.alto && solapeConvexos(e, banda) > 0) {
        res.push({ gravedad: 'aviso', regla: 'ventana', mensaje: `${nombre(m)} tapa la ventana «${h.id}» (mide ${m.elevacion + m.alto} cm y el antepecho está a ${h.antepecho})`, muebles: [m.id], huecos: [h.id] });
      }
    }
  }

  // El otro lado de cada puerta o paso entre dos estancias (ronda 2): su barrido, si abre hacia
  // allí, y la franja de paso, al otro lado del muro. Y los huecos que no atraviesan un muro limpio.
  let modelo: ModeloPlanta | null = null;
  try {
    modelo = modeloPlanta(p);
  } catch (e) {
    if (!(e instanceof ErrorGeometria)) throw e;
  }
  for (const x of modelo?.huecos ?? []) {
    const h = x.hueco;
    if (x.dudoso) {
      res.push({ gravedad: 'aviso', regla: 'hueco', mensaje: `«${h.id}» no atraviesa un muro limpio: parte da a un tabique, a una esquina o a dos sitios distintos; comprueba que se puede pasar`, muebles: [], huecos: [h.id] });
    }
    if (h.tipo === 'ventana' || x.da === null) continue;
    const f = x.fuera;
    const d = (x.profundidadA + x.profundidadB) / 2;
    // La misma puerta vista desde el otro lado: su cara es la del otro lado del muro y «dentro» es hacia allí.
    const otroLado: GeometriaHueco = {
      hueco: { ...h, abre: h.abre === 'fuera' ? 'dentro' : h.abre === 'dentro' ? 'fuera' : h.abre },
      a: [x.a[0] + f[0] * d, x.a[1] + f[1] * d],
      b: [x.b[0] + f[0] * d, x.b[1] + f[1] * d],
      t: [(x.b[0] - x.a[0]) / Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]), (x.b[1] - x.a[1]) / Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1])],
      n: f,
    };
    const barrido = barridoPuerta(otroLado);
    const paso = franjaPaso(otroLado);
    for (const m of ms) {
      if (esPlano(m)) continue;
      const e = esquinas.get(m.id)!;
      if (m.elevacion >= h.antepecho + h.alto - TOLERANCIA) continue;
      if (barrido && solapeConvexos(e, barrido) > 0) {
        res.push({ gravedad: 'error', regla: 'puerta', mensaje: `${nombre(m)} está en el barrido de la puerta «${h.id}», que abre hacia ${x.da}: no se podría abrir del todo`, muebles: [m.id], huecos: [h.id] });
      } else if (paso && solapeConvexos(e, paso) > 0) {
        res.push({ gravedad: 'error', regla: 'paso', mensaje: `${nombre(m)} tapa el paso de «${h.id}» por el lado de ${x.da} (deja libres ${FRANJA_PASO} cm delante)`, muebles: [m.id], huecos: [h.id] });
      }
    }
  }

  // Puertas y pasos más altos que el techo inclinado sobre ellos (en 3D atravesarían el techo).
  for (const s of p.estancias) {
    if (!s.faldones?.length) continue;
    for (const h of s.huecos) {
      if (h.tipo === 'ventana') continue;
      const g = geometriaHueco(s.contorno, h);
      const centro: Punto = [(g.a[0] + g.b[0]) / 2 + g.n[0], (g.a[1] + g.b[1]) / 2 + g.n[1]];
      const techo = alturaTecho(s, centro);
      if (h.alto > techo + TOLERANCIA) res.push({ gravedad: 'aviso', regla: 'hueco', mensaje: `«${h.id}» mide ${h.alto} cm de alto y ahí el techo inclinado está a ${Math.round(techo)} cm`, muebles: [], huecos: [h.id] });
    }
  }

  // La obra también tiene que dejar abrir y pasar por las puertas, y quedar dentro de su estancia.
  for (const s of p.estancias) {
    for (const el of s.elementos ?? []) {
      if (el.forma !== 'exento' && el.forma !== 'adosado') continue;
      const huella = huellaElemento(s, el)!;
      if (!convexoDentroDePoligono(huella, s.contorno)) {
        res.push({ gravedad: 'aviso', regla: 'elemento', mensaje: `${nombreElemento(el)} queda fuera de su estancia (${s.nombre}): revisa su posición`, muebles: [] });
      }
      if (tipoNormal(el.tipo) === 'escalon') continue;
      for (const h of s.huecos) {
        if (h.tipo === 'ventana') continue;
        const g = geometriaHueco(s.contorno, h);
        const barrido = barridoPuerta(g);
        const paso = franjaPaso(g);
        if ((barrido && solapeConvexos(huella, barrido) > 0) || (paso && solapeConvexos(huella, paso) > 0)) {
          res.push({ gravedad: 'error', regla: 'paso', mensaje: `${nombreElemento(el)} tapa el paso de «${h.id}»`, muebles: [], huecos: [h.id] });
        }
      }
    }
  }

  // Espacio libre delante de cada mueble (para abrir puertas y cajones o sentarse).
  for (const m of ms) {
    const zona = zonaFrente(m);
    if (!zona) continue;
    const est = estanciaDe.get(m.id);
    if (est && !convexoDentroDePoligono(zona, est.contorno)) {
      res.push({ gravedad: 'aviso', regla: 'holgura', mensaje: `delante de ${nombre(m)} no caben los ${m.holguraFrente} cm libres que necesita: hay un muro`, muebles: [m.id] });
      continue;
    }
    for (const o of ms) {
      // Las sillas se apartan, y lo que cuelga por encima de 180 cm no estorba al paso.
      if (o.id === m.id || o.tipo === 'silla' || o.elevacion >= 180 || esPlano(o)) continue;
      if (solapeConvexos(esquinas.get(o.id)!, zona) > 0) {
        res.push({ gravedad: 'aviso', regla: 'holgura', mensaje: `${nombre(o)} invade los ${m.holguraFrente} cm libres que necesita ${nombre(m)} delante`, muebles: [m.id, o.id] });
      }
    }
  }
  return res;
}

export function hayErrores(incidencias: readonly Incidencia[]): boolean {
  return incidencias.some((i) => i.gravedad === 'error');
}
