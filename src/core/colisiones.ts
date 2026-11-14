// Colisiones para juegos (R2-7, paso d): formas sencillas, sin material visible, para que un motor
// sepa por dónde se puede andar. Muros y suelos (con los umbrales de puertas y pasos), un bloque en
// cada ventana, la caja de cada mueble, la obra, las rampas de las escaleras y sus barandillas.
//
// Nombres según el motor:
// - godot: sufijo «-colonly» (forma cóncava: muros y suelos) o «-convcolonly» (convexa: lo demás).
//   El importador de Godot 4 los convierte en cuerpos estáticos y quita la malla.
// - unreal: «UBX_<malla>_NN» (cajas) y «UCX_<malla>_NN» (convexas), la convención de FBX; con glTF no
//   está comprobada. Muros y suelos no van: en Unreal se usa la colisión compleja de su malla.
// - generico: «COL_<nombre>», con extras.colision = true, para leerlos con un script (Unity).
import { huellaElemento, rangoAltura } from './elementos.js';
import { alturaEnEscalera, bordesSalvo, escalerasQueLlegan, geometriaDe, rampasEscalera, ALTO_BARANDILLA, GROSOR_PELDANO_CARACOL, LOSA_ESCALERA, type GeometriaEscalera } from './escaleras.js';
import { huecosDePlanta, sueloConHuecos } from './suelos.js';
import { mallaCaja, mallaPrisma, mallaPrismaConAgujeros, mallaRampa, type GeometriaGLB, type NodoGLB } from './glb.js';
import { huellaHueco, modeloPlanta } from './muros.js';
import type { Espacio, Planta, Punto } from './tipos.js';

export type ModoColisiones = 'godot' | 'unreal' | 'generico';
export const MODOS_COLISIONES: readonly ModoColisiones[] = ['godot', 'unreal', 'generico'];

const M = 0.01;
const aXZ = (p: readonly Punto[]): [number, number][] => p.map(([x, y]) => [x * M, y * M]);

type Forma = 'concava' | 'convexa' | 'caja';

interface Colision {
  /** Malla visible a la que se refiere (para los nombres de Unreal) y nombre propio. */
  malla: string;
  nombre: string;
  forma: Forma;
  geometria: GeometriaGLB;
  traslacion?: [number, number, number];
  rotacion?: [number, number, number, number];
}

/** Panel de barandilla: base del grosor dado a lo largo del segmento, hasta ALTO_BARANDILLA sobre lo que se pisa. */
function panel(a: Punto, b: Punto, za = 0, zb = 0, grueso = Infinity): GeometriaGLB {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n: Punto = [(-(b[1] - a[1]) / l) * 2, ((b[0] - a[0]) / l) * 2];
  const base: Punto[] = [[a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]];
  const [ha, hb] = [(za + ALTO_BARANDILLA) * M, (zb + ALTO_BARANDILLA) * M];
  // Por abajo llega a la cara inferior de la escalera, no al suelo: bajo la parte alta se pasa también
  // por los lados (con `grueso` infinito, hasta el suelo: la barandilla de un hueco).
  const [ba, bb] = [Math.max(0, za - grueso) * M, Math.max(0, zb - grueso) * M];
  return mallaRampa(aXZ(base), [ha, hb, hb, ha], [ba, bb, bb, ba]);
}

function colisionesPlanta(e: Espacio, p: Planta): Colision[] {
  const res: Colision[] = [];
  const m = modeloPlanta(p);
  const prim = (malla: string, nombre: string, forma: Forma, geometria: GeometriaGLB): void => void res.push({ malla, nombre, forma, geometria });
  // Muros (con los huecos ya restados) y suelos.
  m.bandas.forEach((b, i) => b.poligonos.forEach((pol, j) => prim(`muros-${p.id}`, `muros-${p.id}-${i}-${j}`, 'concava', mallaPrismaConAgujeros(aXZ(pol.exterior), pol.agujeros.map(aXZ), b.y0 * M, b.y1 * M))));
  // Suelos con el hueco de las escaleras que llegan, como el visible (si no, el suelo invisible tapa el
  // hueco y no se puede subir: revisión independiente de R2-7d, 1).
  const huecos = huecosDePlanta(e, p.id);
  for (const s of p.estancias) {
    sueloConHuecos(s.contorno, huecos).forEach((pol, k) =>
      prim(`suelo-${s.id}`, k === 0 ? `suelo-${s.id}` : `suelo-${s.id}-${k + 1}`, 'concava', mallaPrismaConAgujeros(aXZ(pol.exterior), pol.agujeros.map(aXZ), -0.02, 0)),
    );
  }
  // Umbrales de puertas y pasos (suelo en el grueso del muro) y un bloque en cada ventana.
  for (const h of m.huecos) {
    if (h.profundidad <= 0) continue;
    const q = huellaHueco(h);
    if (h.hueco.tipo === 'ventana') {
      const alto = p.estancias.find((s) => s.id === h.estancia)?.altura ?? 250;
      prim(`muros-${p.id}`, `ventana-${h.hueco.id}`, 'convexa', mallaPrisma(aXZ(q), 0, alto * M));
    } else prim(`umbral-${h.hueco.id}`, `umbral-${h.hueco.id}`, 'convexa', mallaPrisma(aXZ(q), -0.02, 0));
  }
  // Muebles: su caja (las colisiones son las medidas del mueble, no su forma).
  for (const mu of p.muebles) {
    const g = (-mu.giro * Math.PI) / 180;
    res.push({ malla: mu.id, nombre: mu.id, forma: 'caja', geometria: mallaCaja(mu.ancho * M, mu.alto * M, mu.fondo * M), traslacion: [mu.x * M, mu.elevacion * M, mu.y * M], rotacion: [0, Math.sin(g / 2), 0, Math.cos(g / 2)] });
  }
  // Obra que ocupa sitio.
  for (const s of p.estancias) {
    for (const el of s.elementos ?? []) {
      if (el.forma === 'punto') continue;
      const q = huellaElemento(s, el);
      if (!q) continue;
      const [z0, z1] = rangoAltura(s, el);
      prim(el.id, el.id, 'convexa', mallaPrisma(aXZ(q), z0 * M, z1 * M));
    }
  }
  // Escaleras: una rampa por tramo y la meseta, y los paneles de las barandillas; arriba, la barandilla del hueco.
  for (const esc of p.escaleras ?? []) {
    const geo = geometriaDe(e, p, esc);
    // Losas, no macizos desde el suelo: bajo la parte alta se pasa, como en la página (revisión independiente de
    // la ronda 3, 3). El grueso es el de la cara inferior: losa (o peldaño volado) más una contrahuella.
    const grueso = (geo.caracol ? GROSOR_PELDANO_CARACOL : LOSA_ESCALERA) + geo.altura / geo.peldanos;
    rampasEscalera(geo).forEach((r, k) =>
      prim(`escalera-${esc.id}`, `escalera-${esc.id}-rampa-${k + 1}`, 'convexa', mallaRampa(aXZ(r.base), r.alturas.map((z) => Math.max(z, 0.5) * M), r.alturas.map((z) => Math.max(0, z - grueso) * M))),
    );
    geo.pasamanos.forEach((s, k) => prim(`escalera-${esc.id}`, `escalera-${esc.id}-barandilla-${k + 1}`, 'convexa', panel(s.a, s.b, s.za, s.zb, grueso)));
    if (geo.poste) prim(`escalera-${esc.id}`, `escalera-${esc.id}-poste`, 'convexa', mallaPrisma(aXZ(geo.poste), 0, (geo.altura + ALTO_BARANDILLA) * M));
  }
  for (const { desde, escalera } of escalerasQueLlegan(e, p.id)) {
    const geo = geometriaDe(e, desde, escalera);
    // Un panel por lado del hueco, salvo la llegada (antes, uno por cada trozo de 20 cm: revisión independiente, 4).
    bordesSalvo(geo.hueco, [geo.llegada]).forEach(([a, b], k) => prim(`hueco-${escalera.id}`, `hueco-${escalera.id}-barandilla-${k + 1}`, 'convexa', panel(a, b)));
  }
  return res;
}

/** Nodos de colisión de una planta con los nombres del motor; `material` es el índice del material «colisión». */
export function nodosColision(e: Espacio, p: Planta, modo: ModoColisiones, material: number): NodoGLB[] {
  const cuenta = new Map<string, number>();
  const res: NodoGLB[] = [];
  for (const c of colisionesPlanta(e, p)) {
    let nombre: string;
    if (modo === 'godot') nombre = `${c.nombre}${c.forma === 'concava' ? '-colonly' : '-convcolonly'}`;
    else if (modo === 'unreal') {
      if (c.forma === 'concava') continue; // colisión compleja de la malla visible
      const n = cuenta.get(c.malla) ?? 0;
      cuenta.set(c.malla, n + 1);
      nombre = `${c.forma === 'caja' ? 'UBX' : 'UCX'}_${c.malla}_${String(n).padStart(2, '0')}`;
    } else nombre = `COL_${c.nombre}`;
    res.push({
      nombre,
      ...(c.traslacion ? { traslacion: c.traslacion } : {}),
      ...(c.rotacion ? { rotacion: c.rotacion } : {}),
      malla: { primitivas: [{ ...c.geometria, material }] },
      extras: { colision: true, forma: c.forma, de: c.malla },
    });
  }
  return res;
}
