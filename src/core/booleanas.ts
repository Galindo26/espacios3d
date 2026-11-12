// Booleanas de polígonos (unión, diferencia e intersección) con polygon-clipping (MIT), que admite
// polígonos con agujeros y aristas compartidas. Nada de esto se escribe a mano (plan de la ronda 2).
// Se probó antes clipper2-js 1.2.4: sus operaciones con árbol fallan por dentro y devuelven vacío.
//
// polygon-clipping trabaja en coma flotante y, con aristas casi colineales sin redondear, puede
// lanzar («Unable to complete output ring»). Por eso las coordenadas se ajustan a una rejilla
// (0,001 cm) y, si aun así falla, se reintenta con rejillas más gruesas antes de rendirse con un
// error claro (medido en la revisión de R2-1: 0 fallos en 40 000 casos con 0,001 cm).
import pc from 'polygon-clipping';
import { areaConSigno } from './geometria.js';
import type { Punto } from './tipos.js';

/** Polígono con agujeros, sin repetir el primer punto al final. */
export interface PoligonoConAgujeros {
  exterior: Punto[];
  agujeros: Punto[][];
}

/** Fallo de una operación geométrica incluso tras ajustar a todas las rejillas. */
export class ErrorGeometria extends Error {}

type Anillo = [number, number][];
type Multi = Anillo[][];

/** Rejillas (cm) a las que se ajusta, de la más fina a la más gruesa (la precisión de la herramienta). */
const REJILLAS = [0.001, 0.01, 0.1];

function ajustar(v: number, rejilla: number): number {
  return Math.round(v / rejilla) * rejilla || 0;
}

function cerrar(p: readonly Punto[], rejilla: number): Anillo {
  const r = p.map(([x, y]) => [ajustar(x, rejilla), ajustar(y, rejilla)] as [number, number]);
  if (r.length) r.push([r[0]![0], r[0]![1]]);
  return r;
}

function abrir(r: Anillo): Punto[] {
  const p = r.map(([x, y]) => [x, y] as Punto);
  const [a, b] = [p[0], p[p.length - 1]];
  if (p.length > 1 && a && b && a[0] === b[0] && a[1] === b[1]) p.pop();
  return p;
}

function aMulti(ps: readonly PoligonoConAgujeros[], rejilla: number): Multi {
  return ps.map((p) => [cerrar(p.exterior, rejilla), ...p.agujeros.map((h) => cerrar(h, rejilla))]);
}

function deMulti(m: Multi): PoligonoConAgujeros[] {
  return m.map(([ext, ...hs]) => ({ exterior: abrir(ext ?? []), agujeros: hs.map(abrir) }));
}

/** Ejecuta la operación con la rejilla más fina que no falle. */
function conRejilla(que: string, f: (rejilla: number) => Multi): PoligonoConAgujeros[] {
  let ultimo: unknown;
  for (const rejilla of REJILLAS) {
    try {
      return deMulti(f(rejilla));
    } catch (e) {
      ultimo = e;
    }
  }
  throw new ErrorGeometria(`No se pudo calcular ${que} (${ultimo instanceof Error ? ultimo.message : String(ultimo)}). Redondea las coordenadas a 0,1 cm.`);
}

/** Unión de polígonos simples (en cualquier sentido de giro). */
export function union(poligonos: readonly (readonly Punto[])[]): PoligonoConAgujeros[] {
  const validos = poligonos.filter((p) => p.length >= 3);
  if (!validos.length) return [];
  return conRejilla('la unión de polígonos', (g) => {
    const [primero, ...resto] = validos.map((p) => [cerrar(p, g)]);
    return pc.union(primero!, ...resto);
  });
}

/** a − b. */
export function diferencia(a: readonly PoligonoConAgujeros[], b: readonly PoligonoConAgujeros[]): PoligonoConAgujeros[] {
  if (!a.length) return [];
  if (!b.length) return a.map((p) => ({ exterior: [...p.exterior], agujeros: p.agujeros.map((h) => [...h]) }));
  return conRejilla('la diferencia de polígonos', (g) => pc.difference(aMulti(a, g), aMulti(b, g)));
}

/** Área (cm², positiva) de polígonos con agujeros. */
export function areaTotal(ps: readonly PoligonoConAgujeros[]): number {
  return ps.reduce((s, p) => s + Math.abs(areaConSigno(p.exterior)) - p.agujeros.reduce((t, a) => t + Math.abs(areaConSigno(a)), 0), 0);
}

function perimetro(p: readonly Punto[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as Punto;
    const b = p[(i + 1) % p.length] as Punto;
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

/**
 * ¿Se solapan dos polígonos simples más que la tolerancia lineal? Cada trozo de la intersección
 * cuenta si su grosor medio (área / semiperímetro) pasa de `tolerancia` cm: así tocarse a ras o
 * una lámina de redondeo en una pared inclinada no es solape, y un solape de verdad sí.
 */
export function seSolapan(a: readonly Punto[], b: readonly Punto[], tolerancia: number): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const inter = conRejilla('el solape entre estancias', (g) => pc.intersection([cerrar(a, g)], [cerrar(b, g)]));
  return inter.some((p) => {
    const area = areaTotal([p]);
    const semi = (perimetro(p.exterior) + p.agujeros.reduce((s, h) => s + perimetro(h), 0)) / 2;
    return semi > 0 && area / semi > tolerancia;
  });
}
