// `describir` (R2-3): la geometría ya calculada, para que un agente razone sin hacer cuentas: en qué
// lado del plano está cada muro, qué conecta cada puerta, en qué estancia está cada mueble, a qué
// pared está pegado y hacia dónde mira, y cuánto suelo queda libre. `escena.json` = `describir --json`.
import { analizar, analizarPlanta, esPlano, type Incidencia } from './analisis.js';
import { estanciaDeMueble, planta as plantaDe } from './espacio.js';
import { area, cajaContorno, distanciaPuntoSegmento, esquinasMueble, localAPlanta, longitudMuro, muro, normalInterior, puntoEnPoligono } from './geometria.js';
import { modeloPlanta } from './muros.js';
import { esRectangular } from './operaciones.js';
import type { Elemento, Espacio, Estancia, Faldon, Punto } from './tipos.js';
import { describirElemento } from './plano.js';
import { huellaElemento, tipoNormal } from './elementos.js';
import { colorSuelo } from './acabados.js';
import { alturaEscalera, describirEscalera, escalerasQueLlegan, geometriaDe, zonaLlegada, zonaPie } from './escaleras.js';

/** Suelo (cm²) que ocupa la obra a ras de suelo: columnas, pilares, radiadores bajos… */
function obra(s: Estancia): number {
  return (s.elementos ?? [])
    .filter((el) => (el.forma === 'exento' || el.forma === 'adosado') && el.elevacion === 0 && tipoNormal(el.tipo) !== 'escalon')
    .reduce((t, el) => t + area(huellaElemento(s, el)!), 0);
}

export type LadoPlano = 'arriba' | 'abajo' | 'izquierda' | 'derecha' | 'diagonal';

/** Lado del plano (x a la derecha, y hacia abajo) al que apunta una dirección; «diagonal» si no es clara. */
function lado([dx, dy]: Punto): LadoPlano {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < 0.92 * Math.hypot(dx, dy)) return 'diagonal';
  return ay > ax ? (dy > 0 ? 'abajo' : 'arriba') : dx > 0 ? 'derecha' : 'izquierda';
}

const r1 = (n: number): number => Math.round(n * 10) / 10 || 0;

/** Distancia (cm) a la que un mueble cuenta como pegado a una pared. */
const PEGADO = 2;

export interface Descripcion {
  nombre: string;
  convenciones: string;
  plantas: {
    id: string;
    nombre: string;
    nivel: number;
    grosorExterior: number;
    estancias: {
      id: string;
      nombre: string;
      altura: number;
      area_m2: number;
      caja: { x: number; y: number; ancho: number; largo: number };
      rectangular: boolean;
      muros: { muro: number; de: Punto; a: Punto; longitud: number; lado: LadoPlano; huecos: string[] }[];
      huecos: { id: string; tipo: string; muro: number; desde: number; ancho: number; da_a: string }[];
      muebles: string[];
      sueloLibre_m2: number;
      /** Elementos de obra con una frase que los describe. */
      elementos: (Elemento & { descripcion: string })[];
      faldones: Faldon[];
      /** Acabados (R4-2) y comprobación del círculo de giro (R4-1), si los tiene. */
      suelo?: { tipo: string; color: string };
      paredes?: string;
      circuloDeGiro?: boolean;
      fotos?: string[];
    }[];
    muebles: {
      id: string;
      nombre: string;
      tipo: string;
      ancho: number;
      fondo: number;
      alto: number;
      x: number;
      y: number;
      giro: number;
      estancia: string | null;
      mira: LadoPlano;
      pegadoA: { estancia: string; muro: number; lado: LadoPlano; distancia: number }[];
      fotos?: string[];
    }[];
    conexiones: { hueco: string; tipo: string; de: string; a: string }[];
    /** Escaleras que suben desde esta planta. */
    escaleras: {
      id: string;
      forma: string;
      hasta: string;
      peldanos: number;
      contrahuella: number;
      pie: { x: number; y: number };
      llegada: { x: number; y: number };
      /** Hacia qué lado del plano se sube al empezar y hacia cuál se sale al llegar. */
      sube: LadoPlano;
      sale: LadoPlano;
      caja: { x: number; y: number; ancho: number; largo: number };
      /** Estancia de abajo donde está y estancia de arriba a la que se llega. */
      de: string | null;
      a: string | null;
      descripcion: string;
    }[];
    /** Huecos en el suelo de esta planta por escaleras que llegan de abajo. */
    huecosEscalera: { escalera: string; desde: string }[];
  }[];
  incidencias: Incidencia[];
}

export function describir(e: Espacio, plantaId?: string): Descripcion {
  const plantas = plantaId !== undefined ? [plantaDe(e, plantaId)] : e.plantas;
  return {
    nombre: e.nombre,
    convenciones: 'cm y grados; x a la derecha, y hacia abajo («arriba» = y menor); el muro i va del vértice i al i+1; «lado» de un muro = lado del plano en el que está respecto a su estancia; «mira» = hacia dónde da el frente del mueble',
    plantas: plantas.map((p) => {
      const m = modeloPlanta(p);
      const daA = new Map(m.huecos.map((h) => [h.hueco.id, h.da ?? 'exterior']));
      const estanciaDe = new Map(p.muebles.map((mu) => [mu.id, estanciaDeMueble(p, mu)?.id ?? null]));
      return {
        id: p.id,
        nombre: p.nombre,
        nivel: p.nivel,
        grosorExterior: p.grosorExterior,
        estancias: p.estancias.map((s) => {
          const c = cajaContorno(s.contorno);
          const dentro = p.muebles.filter((mu) => estanciaDe.get(mu.id) === s.id);
          const ocupado = dentro.filter((mu) => mu.elevacion === 0 && !esPlano(mu)).reduce((t, mu) => t + mu.ancho * mu.fondo, 0);
          return {
            id: s.id,
            nombre: s.nombre,
            altura: s.altura,
            area_m2: Math.round(area(s.contorno) / 100) / 100,
            caja: { x: r1(c.minX), y: r1(c.minY), ancho: r1(c.maxX - c.minX), largo: r1(c.maxY - c.minY) },
            rectangular: esRectangular(e, s.id) !== null,
            muros: s.contorno.map((_, i) => {
              const [a, b] = muro(s.contorno, i);
              const n = normalInterior(s.contorno, i);
              return { muro: i, de: a, a: b, longitud: r1(longitudMuro(s.contorno, i)), lado: lado([-n[0], -n[1]]), huecos: s.huecos.filter((h) => h.muro === i).map((h) => h.id) };
            }),
            huecos: s.huecos.map((h) => ({ id: h.id, tipo: h.tipo, muro: h.muro, desde: h.desde, ancho: h.ancho, da_a: daA.get(h.id) ?? 'exterior' })),
            muebles: dentro.map((mu) => mu.id),
            sueloLibre_m2: Math.max(0, Math.round((area(s.contorno) - ocupado - obra(s)) / 100) / 100),
            elementos: (s.elementos ?? []).map((el) => ({ ...el, descripcion: describirElemento(el) })),
            faldones: s.faldones ?? [],
            ...(s.suelo ? { suelo: { tipo: s.suelo.tipo, color: colorSuelo(s) } } : {}),
            ...(s.paredes ? { paredes: s.paredes } : {}),
            ...(s.circuloDeGiro ? { circuloDeGiro: true } : {}),
            ...(s.fotos ? { fotos: s.fotos } : {}),
          };
        }),
        muebles: p.muebles.map((mu) => {
          const est = estanciaDe.get(mu.id) ?? null;
          const s = p.estancias.find((x) => x.id === est);
          const esq = esquinasMueble(mu);
          const frente = localAPlanta(mu, 0, 1);
          const pegadoA = s
            ? s.contorno.flatMap((_, i) => {
                const [a, b] = muro(s.contorno, i);
                const d = Math.min(...esq.map((q) => distanciaPuntoSegmento(q, a, b)));
                if (d > PEGADO) return [];
                const n = normalInterior(s.contorno, i);
                return [{ estancia: s.id, muro: i, lado: lado([-n[0], -n[1]]), distancia: r1(d) }];
              })
            : [];
          return {
            id: mu.id,
            nombre: mu.nombre,
            tipo: mu.tipo,
            ancho: mu.ancho,
            fondo: mu.fondo,
            alto: mu.alto,
            x: mu.x,
            y: mu.y,
            giro: mu.giro,
            estancia: est,
            mira: lado([frente[0] - mu.x, frente[1] - mu.y]),
            pegadoA,
            ...(mu.fotos ? { fotos: mu.fotos } : {}),
          };
        }),
        conexiones: m.conexiones.map((c) => ({ hueco: c.hueco, tipo: c.tipo, de: c.de, a: c.a })),
        escaleras: (p.escaleras ?? []).map((esc) => {
          const geo = geometriaDe(e, p, esc);
          const medio = ([a, b]: [Punto, Punto]): Punto => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const pie = medio(geo.pie);
          const lle = medio(geo.llegada);
          const c = cajaContorno(geo.huella.flat());
          const dest = e.plantas.find((x) => x.id === esc.hasta);
          const zp = zonaPie(geo);
          const zl = zonaLlegada(geo);
          const centro = (z: Punto[]): Punto => [(z[0]![0] + z[2]![0]) / 2, (z[0]![1] + z[2]![1]) / 2];
          return {
            id: esc.id,
            forma: esc.forma,
            hasta: esc.hasta,
            peldanos: geo.peldanos,
            contrahuella: r1(geo.altura / geo.peldanos),
            pie: { x: r1(pie[0]), y: r1(pie[1]) },
            llegada: { x: r1(lle[0]), y: r1(lle[1]) },
            sube: lado(geo.entrada),
            sale: lado(geo.salida),
            caja: { x: r1(c.minX), y: r1(c.minY), ancho: r1(c.maxX - c.minX), largo: r1(c.maxY - c.minY) },
            de: p.estancias.find((s) => puntoEnPoligono(centro(zp), s.contorno))?.id ?? null,
            a: dest?.estancias.find((s) => puntoEnPoligono(centro(zl), s.contorno))?.id ?? null,
            descripcion: describirEscalera(esc, geo),
          };
        }),
        huecosEscalera: escalerasQueLlegan(e, p.id).map(({ desde, escalera }) => ({ escalera: escalera.id, desde: desde.id })),
      };
    }),
    incidencias: plantaId !== undefined ? analizar(e).filter((i) => i.planta === undefined || i.planta === plantaId) : analizar(e),
  };
}

export function describirTexto(d: Descripcion): string[] {
  const l: string[] = [`«${d.nombre}». ${d.convenciones}.`];
  for (const p of d.plantas) {
    if (d.plantas.length > 1) l.push(`Planta ${p.id} «${p.nombre}» (nivel ${p.nivel} cm)`);
    for (const s of p.estancias) {
      l.push(`Estancia ${s.id} «${s.nombre}»: ${s.caja.ancho} x ${s.caja.largo} cm${s.rectangular ? '' : ' (caja; forma libre)'}, ${s.area_m2} m2, alto ${s.altura}, suelo libre aprox. ${s.sueloLibre_m2} m2`);
      for (const w of s.muros) l.push(`  muro ${w.muro} (${w.lado}): ${w.longitud} cm${w.huecos.length ? `; huecos: ${w.huecos.join(', ')}` : ''}`);
      for (const h of s.huecos) l.push(`  ${h.tipo} ${h.id}: muro ${h.muro}, desde ${h.desde}, ancho ${h.ancho}, da a ${h.da_a}`);
      for (const el of s.elementos) l.push(`  ${el.descripcion}`);
      for (const f of s.faldones) l.push(`  techo inclinado: junto al muro ${f.muro} a ${f.alturaEnMuro} cm, sube hasta ${s.altura} cm en ${f.alcance} cm`);
      if (s.muebles.length) l.push(`  muebles: ${s.muebles.join(', ')}`);
    }
    for (const m of p.muebles) {
      const pegado = m.pegadoA.length ? `, pegado a ${m.pegadoA.map((x) => `muro ${x.muro} (${x.lado})`).join(' y ')}` : '';
      l.push(`Mueble ${m.id} «${m.nombre}» ${m.ancho}x${m.fondo}x${m.alto} en (${m.x}, ${m.y}), en ${m.estancia ?? '(fuera)'}, mira ${m.mira}${pegado}`);
    }
    if (p.conexiones.length) l.push(`Conexiones: ${p.conexiones.map((c) => `${c.hueco}: ${c.de} <-> ${c.a}`).join('; ')}`);
    for (const x of p.escaleras) l.push(`${x.descripcion}; sube hacia ${x.sube} del plano y se sale hacia ${x.sale}; une ${x.de ?? '(fuera)'} con ${x.a ?? '(fuera)'} de ${x.hasta}`);
    for (const h of p.huecosEscalera) l.push(`Hueco en el suelo de la escalera ${h.escalera}, que sube desde ${h.desde}`);
  }
  l.push(d.incidencias.length ? `Incidencias: ${d.incidencias.length} (${d.incidencias.filter((i) => i.gravedad === 'error').length} de error)` : 'Sin incidencias.');
  return l;
}
