// Elementos fijos de obra y techo inclinado (R2-4): geometría común al análisis, al dibujo y al 3D.
import { esquinasMueble, muro, normalInterior } from './geometria.js';
import type { Elemento, Estancia, Punto } from './tipos.js';

const SEGMENTOS_CIRCULO = 24;

/** Huella en planta de un elemento (polígono convexo), o null si es un punto en un muro. */
export function huellaElemento(est: Estancia, el: Elemento): Punto[] | null {
  if (el.forma === 'punto') return null;
  if (el.forma === 'exento') {
    if (el.redondo) {
      const r = el.ancho / 2;
      return Array.from({ length: SEGMENTOS_CIRCULO }, (_, i) => {
        const t = (i / SEGMENTOS_CIRCULO) * Math.PI * 2;
        return [el.x + r * Math.cos(t), el.y + r * Math.sin(t)] as Punto;
      });
    }
    return esquinasMueble({ x: el.x, y: el.y, giro: el.giro, ancho: el.ancho, fondo: el.fondo });
  }
  if (el.forma === 'adosado') {
    const [a, b] = muro(est.contorno, el.muro);
    const largo = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t: Punto = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
    const n = normalInterior(est.contorno, el.muro);
    const p0: Punto = [a[0] + t[0] * el.desde, a[1] + t[1] * el.desde];
    const p1: Punto = [p0[0] + t[0] * el.ancho, p0[1] + t[1] * el.ancho];
    return [p0, p1, [p1[0] + n[0] * el.fondo, p1[1] + n[1] * el.fondo], [p0[0] + n[0] * el.fondo, p0[1] + n[1] * el.fondo]];
  }
  // Viga: rectángulo de su ancho a lo largo del segmento.
  const d: Punto = [el.a[0] - el.de[0], el.a[1] - el.de[1]];
  const l = Math.hypot(d[0], d[1]) || 1;
  const m: Punto = [(-d[1] / l) * (el.ancho / 2), (d[0] / l) * (el.ancho / 2)];
  return [
    [el.de[0] + m[0], el.de[1] + m[1]],
    [el.a[0] + m[0], el.a[1] + m[1]],
    [el.a[0] - m[0], el.a[1] - m[1]],
    [el.de[0] - m[0], el.de[1] - m[1]],
  ];
}

/** Alturas (cm) que ocupa un elemento: de su base a su parte de arriba. */
export function rangoAltura(est: Estancia, el: Elemento): [number, number] {
  if (el.forma === 'punto') return [el.altura, el.altura];
  if (el.forma === 'viga') return [est.altura - el.canto, est.altura];
  return [el.elevacion, el.elevacion + (el.alto ?? est.altura - el.elevacion)];
}

/** Punto de un elemento en un muro (para enchufes e interruptores). */
export function puntoEnElMuro(est: Estancia, el: Elemento & { forma: 'punto' }): Punto {
  const [a, b] = muro(est.contorno, el.muro);
  const largo = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [a[0] + ((b[0] - a[0]) / largo) * el.desde, a[1] + ((b[1] - a[1]) / largo) * el.desde];
}

/**
 * Altura del techo (cm) en un punto de la estancia: la de la estancia, salvo bajo un faldón, donde
 * baja en línea recta hasta `alturaEnMuro` junto a su muro. Con varios faldones manda el más bajo.
 */
export function alturaTecho(est: Estancia, p: Punto): number {
  let h = est.altura;
  for (const f of est.faldones ?? []) {
    // Distancia perpendicular a la recta del muro, del lado de dentro y sólo frente a su tramo
    // (un faldón es un plano inclinado sobre su pared, no un cono alrededor de sus extremos).
    const [a, b] = muro(est.contorno, f.muro);
    const largo = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u: Punto = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
    const n = normalInterior(est.contorno, f.muro);
    const a_p: Punto = [p[0] - a[0], p[1] - a[1]];
    const s = a_p[0] * u[0] + a_p[1] * u[1];
    const d = a_p[0] * n[0] + a_p[1] * n[1];
    if (s < -0.1 || s > largo + 0.1 || d < -0.1) continue;
    const t = Math.min(1, Math.max(0, d / f.alcance));
    h = Math.min(h, f.alturaEnMuro + (est.altura - f.alturaEnMuro) * t);
  }
  return h;
}

/** Tipo de un elemento sin tildes ni mayúsculas, para las reglas propias (radiador, escalon…). */
export function tipoNormal(tipo: string): string {
  return tipo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const FEMENINOS = new Set(['columna', 'chimenea', 'toma', 'viga']);
const CON_TILDE: Record<string, string> = { escalon: 'escalón' };

/** Nombre legible con artículo para los mensajes: «la columna «c1»», «el escalón «e»». */
export function nombreElemento(el: Elemento): string {
  const t = tipoNormal(el.tipo);
  return `${FEMENINOS.has(t) ? 'la' : 'el'} ${CON_TILDE[t] ?? el.tipo} «${el.id}»`;
}

/** «de» + nombre, con la contracción «del»: «delante del radiador «r1»». */
export function deElemento(el: Elemento): string {
  const n = nombreElemento(el);
  return n.startsWith('el ') ? `del ${n.slice(3)}` : `de ${n}`;
}
