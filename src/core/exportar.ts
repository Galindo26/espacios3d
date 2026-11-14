// Exportación a glTF binario (.glb) desde el núcleo, sin three: sirve al CLI y a cualquier motor.
// Metros, y hacia arriba; la planta (x, y) va a (X, Z). Un nodo por planta, con sus suelos, sus muros
// derivados (muros.ts) y un nodo por mueble con su id, su posición y su giro (TRS) y sus piezas.
import { escribirGLB, mallaBarra, mallaCaja, mallaCilindro, mallaCuna, mallaEsfera, mallaPrisma, mallaPrismaConAgujeros, type MaterialGLB, type NodoGLB, type PrimitivaGLB } from './glb.js';
import { contornoExterior, normalInterior, rotacionY } from './geometria.js';
import { huellaElemento, puntoEnElMuro, rangoAltura } from './elementos.js';
import { huellaHueco, masaDeMuros, modeloPlanta } from './muros.js';
import { nodosColision, type ModoColisiones } from './colisiones.js';
import { piezasDe } from './formas.js';
import { diferencia, union, type PoligonoConAgujeros } from './booleanas.js';
import { alturaEscalera, escalerasQueLlegan, geometriaDe, piezasEscalera, piezasHueco, type PiezaEscalera } from './escaleras.js';
import type { GeometriaGLB } from './glb.js';
import { colorSuelo, mallaCuadros, revestimiento } from './acabados.js';
import { huecosDePlanta, sueloConHuecos } from './suelos.js';
import type { Espacio, Pieza, Planta, Punto } from './tipos.js';

const M = 0.01; // cm → m

function colorDe(hex: string, alfa = 1): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alfa];
}

/** Malla de una pieza en sus coordenadas (centrada en x y z, apoyada en y = 0). */
export function mallaPieza(pz: Pieza): GeometriaGLB {
  if (pz.forma === 'esfera') return mallaEsfera((pz.ancho / 2) * M);
  if (pz.forma === 'cilindro') return mallaCilindro((pz.ancho / 2) * M, pz.alto * M);
  if (pz.forma === 'cuna') return mallaCuna(pz.ancho * M, pz.alto * M, pz.fondo * M);
  return mallaCaja(pz.ancho * M, pz.alto * M, pz.fondo * M);
}

const cuaternionY = (giro: number): [number, number, number, number] => {
  const r = rotacionY(giro);
  return [0, Math.sin(r / 2), 0, Math.cos(r / 2)];
};

const aXZ = (p: readonly Punto[]): [number, number][] => p.map(([x, y]) => [x * M, y * M]);

/** Malla (metros, y arriba) de una pieza de escalera o de su hueco; la usan el .glb y la página. */
export function geometriaPieza(pz: PiezaEscalera): GeometriaGLB {
  if (pz.tipo === 'barra') return mallaBarra([pz.a[0] * M, pz.a[2] * M, pz.a[1] * M], [pz.b[0] * M, pz.b[2] * M, pz.b[1] * M], pz.grueso * M);
  return pz.agujeros?.length ? mallaPrismaConAgujeros(aXZ(pz.base), pz.agujeros.map(aXZ), pz.z0 * M, pz.z1 * M) : mallaPrisma(aXZ(pz.base), pz.z0 * M, pz.z1 * M);
}


/**
 * Forjado bajo una planta (R3-2): del techo más alto de la planta de debajo a 2 cm bajo su suelo (los
 * suelos son de 2 cm), sobre sus estancias y sus muros, con los huecos de las escaleras restados. Cotas
 * en cm relativas al suelo de la planta (negativas). null si no hay planta debajo o no queda grosor.
 */
export function forjadoDePlanta(e: Espacio, p: Planta): { poligonos: PoligonoConAgujeros[]; z0: number; z1: number } | null {
  const debajo = e.plantas.filter((x) => x.nivel < p.nivel).sort((a, b) => b.nivel - a.nivel)[0];
  if (!debajo) return null;
  const canto = p.nivel - debajo.nivel - Math.max(0, ...debajo.estancias.map((s) => s.altura));
  if (canto <= 2 + 1e-6) return null;
  // La huella con sus muros, conservando los agujeros: un patio interior no lleva forjado.
  const base = p.grosorExterior > 0 ? union(p.estancias.map((s) => contornoExterior(s.contorno, p.grosorExterior))) : masaDeMuros(p).suelo;
  const huecos = huecosDePlanta(e, p.id).filter((h) => h.length >= 3);
  const poligonos = huecos.length ? diferencia(base, huecos.map((h) => ({ exterior: h, agujeros: [] }))) : base;
  return { poligonos, z0: -canto, z1: -2 };
}

export interface OpcionesGLB {
  /** Añade nodos de colisión con los nombres de ese motor (ver colisiones.ts). */
  colisiones?: ModoColisiones;
}

export function espacioAGLB(e: Espacio, generador = 'Espacios 3D', opciones: OpcionesGLB = {}): Uint8Array {
  const materiales: MaterialGLB[] = [
    { nombre: 'muro', color: colorDe('#e8e2d6'), metalico: 0, rugosidad: 0.9 },
    { nombre: 'suelo', color: colorDe('#c8b89a'), metalico: 0, rugosidad: 0.8 },
  ];
  const materialColision = opciones.colisiones ? materiales.push({ nombre: 'colision', color: colorDe('#e05a3a', 0.25), metalico: 0, rugosidad: 1, transparente: true }) - 1 : -1;
  const porColor = new Map<string, number>();
  const materialMueble = (color: string): number => {
    let i = porColor.get(color);
    if (i === undefined) {
      i = materiales.push({ nombre: `mueble ${color}`, color: colorDe(color), metalico: 0, rugosidad: 0.7 }) - 1;
      porColor.set(color, i);
    }
    return i;
  };

  // Acabados (R4-2): un material por color de suelo o de pared, sin texturas.
  const porAcabado = new Map<string, number>();
  const materialAcabado = (nombre: string, color: string): number => {
    let i = porAcabado.get(nombre);
    if (i === undefined) {
      i = materiales.push({ nombre, color: colorDe(color), metalico: 0, rugosidad: 0.85 }) - 1;
      porAcabado.set(nombre, i);
    }
    return i;
  };

  const nodos: NodoGLB[] = e.plantas.map((p) => {
    const m = modeloPlanta(p);
    // Suelos, con el hueco de las escaleras que llegan a esta planta restado.
    const huecos = huecosDePlanta(e, p.id);
    const suelos: NodoGLB[] = p.estancias.map((s) => ({
      nombre: `suelo-${s.id}`,
      malla: { primitivas: sueloConHuecos(s.contorno, huecos).map((pol) => ({ ...mallaPrismaConAgujeros(aXZ(pol.exterior), pol.agujeros.map(aXZ), -0.02, 0), material: s.suelo ? materialAcabado(`suelo ${s.suelo.tipo} ${colorSuelo(s)}`, colorSuelo(s)) : 1 })) },
      extras: { estancia: s.id, nombre: s.nombre, altura: s.altura, ...(s.suelo ? { suelo: { tipo: s.suelo.tipo, color: colorSuelo(s) } } : {}) },
    }));
    const primitivasMuro: PrimitivaGLB[] = m.bandas.flatMap((b) =>
      b.poligonos.map((pol) => ({ ...mallaPrismaConAgujeros(aXZ(pol.exterior), pol.agujeros.map(aXZ), b.y0 * M, b.y1 * M), material: 0 })),
    );
    const hijos: NodoGLB[] = [...suelos];
    // Paredes pintadas: el revestimiento de la cara interior de cada estancia con color.
    for (const s of p.estancias) {
      if (!s.paredes) continue;
      const cuadros = revestimiento(s, m);
      if (cuadros.length) hijos.push({ nombre: `paredes-${s.id}`, malla: { primitivas: [{ ...mallaCuadros(cuadros), material: materialAcabado(`pared ${s.paredes}`, s.paredes) }] }, extras: { estancia: s.id, paredes: s.paredes } });
    }
    const forjado = forjadoDePlanta(e, p);
    if (forjado) {
      hijos.push({
        nombre: `forjado-${p.id}`,
        malla: { primitivas: forjado.poligonos.map((pol) => ({ ...mallaPrismaConAgujeros(aXZ(pol.exterior), pol.agujeros.map(aXZ), forjado.z0 * M, forjado.z1 * M), material: 0 })) },
        extras: { forjado: p.id, canto: -forjado.z0 },
      });
    }
    if (primitivasMuro.length) hijos.push({ nombre: `muros-${p.id}`, malla: { primitivas: primitivasMuro }, extras: { conexiones: m.conexiones } });
    // Obra: columnas, pilares y radiadores como prismas de su huella; vigas bajo el techo; los puntos
    // (enchufes) como una placa pequeña en su muro. Material de muro, con su tipo e id en «extras».
    for (const s of p.estancias) {
      for (const el of s.elementos ?? []) {
        let geo;
        if (el.forma === 'punto') {
          const [x, y] = puntoEnElMuro(s, el);
          const n = normalInterior(s.contorno, el.muro);
          const q: Punto[] = [[x - n[1] * 4 + n[0] * 0.5, y + n[0] * 4 + n[1] * 0.5], [x + n[1] * 4 + n[0] * 0.5, y - n[0] * 4 + n[1] * 0.5], [x + n[1] * 4 + n[0] * 1.5, y - n[0] * 4 + n[1] * 1.5], [x - n[1] * 4 + n[0] * 1.5, y + n[0] * 4 + n[1] * 1.5]];
          geo = mallaPrisma(aXZ(q), (el.altura - 4) * M, (el.altura + 4) * M);
        } else {
          const [z0, z1] = rangoAltura(s, el);
          geo = mallaPrisma(aXZ(huellaElemento(s, el)!), z0 * M, z1 * M);
        }
        hijos.push({ nombre: el.id, malla: { primitivas: [{ ...geo, material: 0 }] }, extras: { elemento: el.id, tipo: el.tipo, forma: el.forma, estancia: s.id } });
      }
    }
    // Umbrales: suelo en el grueso del muro de puertas y pasos (si no, queda una rendija entre estancias).
    for (const h of m.huecos) {
      if (h.hueco.tipo === 'ventana' || h.profundidad <= 0) continue;
      hijos.push({ nombre: `umbral-${h.hueco.id}`, malla: { primitivas: [{ ...mallaPrisma(aXZ(huellaHueco(h)), -0.02, 0), material: 1 }] }, extras: { umbral: h.hueco.id } });
    }
    // Escaleras que suben desde esta planta (peldaños, meseta y barandillas) y, de las que llegan, el
    // canto del forjado y la barandilla alrededor del hueco.
    for (const esc of p.escaleras ?? []) {
      const geo = geometriaDe(e, p, esc);
      hijos.push({
        nombre: `escalera-${esc.id}`,
        malla: { primitivas: piezasEscalera(geo).map((pz) => ({ ...geometriaPieza(pz), material: 0 })) },
        extras: { escalera: esc.id, forma: esc.forma, hasta: esc.hasta, peldanos: geo.peldanos },
      });
    }
    for (const { desde, escalera } of escalerasQueLlegan(e, p.id)) {
      const geo = geometriaDe(e, desde, escalera);
      const techoAbajo = Math.max(0, ...desde.estancias.map((s) => s.altura));
      const canto = Math.max(2, p.nivel - desde.nivel - techoAbajo);
      hijos.push({
        nombre: `hueco-${escalera.id}`,
        malla: { primitivas: piezasHueco(geo, canto).piezas.map((pz) => ({ ...geometriaPieza(pz), material: 0 })) },
        extras: { hueco: escalera.id, desde: desde.id },
      });
    }
    // Muebles: un nodo por mueble y un hijo por pieza (las suyas o la forma genérica de su tipo). Un
    // modelo .glb propio no se incrusta: queda su ruta en «extras.modelo» para que el motor lo cargue.
    for (const mu of p.muebles) {
      hijos.push({
        nombre: mu.id,
        traslacion: [mu.x * M, mu.elevacion * M, mu.y * M],
        rotacion: cuaternionY(mu.giro),
        hijos: piezasDe(mu).map((pz, i) => ({
          nombre: `${mu.id}-pieza-${i + 1}`,
          traslacion: [pz.x * M, pz.z * M, pz.y * M] as [number, number, number],
          ...(pz.giro ? { rotacion: cuaternionY(pz.giro) } : {}),
          malla: { primitivas: [{ ...mallaPieza(pz), material: materialMueble(pz.color ?? mu.color) }] },
          extras: { pieza: i + 1, forma: pz.forma },
        })),
        extras: {
          id: mu.id, tipo: mu.tipo, nombre: mu.nombre, ancho: mu.ancho, fondo: mu.fondo, alto: mu.alto,
          // Con modelo, los hijos «-pieza-» son la forma de reserva: un motor que cargue el modelo los oculta.
          ...(mu.modelo ? { modelo: mu.modelo, piezasDeReserva: true } : {}),
        },
      });
    }
    if (opciones.colisiones) hijos.push(...nodosColision(e, p, opciones.colisiones, materialColision));
    return { nombre: `planta-${p.id}`, traslacion: [0, p.nivel * M, 0], hijos, extras: { planta: p.id, nombre: p.nombre } };
  });
  return escribirGLB({ nombreEscena: e.nombre, nodos, materiales, generador });
}
