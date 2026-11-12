// Plano rasterizado (R2-3): una imagen RGBA del plano de una planta, sin DOM ni dependencias, para
// que un agente con visión vea su resultado (`plano --png`). La transformación cm → píxel es fija y
// se devuelve: px = (x − origen[0]) · pxPorCm, py = (y − origen[1]) · pxPorCm.
import { analizarPlanta } from './analisis.js';
import { planta } from './espacio.js';
import { cajaContorno, esquinasMueble, localAPlanta } from './geometria.js';
import { barridoPuerta, geometriaHueco } from './huecos.js';
import { Lienzo, medirTexto, type Punto2 } from './lienzo.js';
import { modeloPlanta } from './muros.js';
import { fondoAPlanta } from './fondos.js';
import { huellaElemento, puntoEnElMuro, tipoNormal } from './elementos.js';
import { contornosDe, ejeEscalera, escalerasQueLlegan, geometriaDe, lineasPeldanos } from './escaleras.js';
import { muro, normalInterior } from './geometria.js';
import type { Espacio, Punto } from './tipos.js';

export interface OpcionesPlanoPng {
  planta?: string;
  /** Píxeles por cm; por defecto, el que deja el plano en unos 1000 px de ancho (entre 0,5 y 3). */
  pxPorCm?: number;
  /** Rejilla rotulada cada 50 cm (en cm de la planta). */
  rejilla?: boolean;
  /**
   * Imágenes de los fondos de la planta (RGBA ya decodificado, por id): se pintan debajo y el plano
   * encima, semitransparente, para comparar el calco con el original. Sólo fondos sin giro.
   */
  fondos?: Record<string, { rgba: Uint8Array | Uint8ClampedArray; ancho: number; alto: number }>;
}

export interface PlanoPng {
  lienzo: Lienzo;
  pxPorCm: number;
  /** Punto de la planta (cm) que cae en el píxel (0, 0). */
  origen: Punto;
}

const COLOR = {
  fondo: '#fbfaf7',
  suelo: '#efe8dc',
  muro: '#3b4046',
  rejilla: '#d9d1c4',
  rejillaTexto: '#8b8378',
  texto: '#2b2f33',
  error: '#c0392b',
  barrido: '#6b6358',
  cristal: '#7fb3d9',
  frente: '#2b2f33',
} as const;

const MARGEN_PX = 40;
/** Tamaño máximo del PNG por lado: más es inmanejable para un agente y para la memoria. */
const MAXIMO_PX = 4096;

export function planoPng(e: Espacio, opciones: OpcionesPlanoPng = {}): PlanoPng {
  const pl = planta(e, opciones.planta);
  const m = modeloPlanta(pl);
  // Con --sobre-fondo el lienzo abarca también los fondos: si no, el agente no vería lo que le falta por calcar.
  const esquinasFondos = opciones.fondos
    ? (pl.fondos ?? []).filter((f) => opciones.fondos![f.id]).flatMap((f) => ([[0, 0], [f.anchoPx, 0], [f.anchoPx, f.altoPx], [0, f.altoPx]] as Punto[]).map(([u, v]) => fondoAPlanta(f, u, v)))
    : [];
  const puntos = [...m.masa.flatMap((p) => p.exterior), ...pl.estancias.flatMap((s) => s.contorno), ...esquinasFondos];
  const caja = cajaContorno(puntos.length ? puntos : [[0, 0], [100, 100]]);
  const anchoCm = Math.max(1, caja.maxX - caja.minX);
  const altoCm = Math.max(1, caja.maxY - caja.minY);
  const pxPorCm = opciones.pxPorCm ?? Math.min(3, Math.max(0.5, Math.round((1000 / anchoCm) * 100) / 100));
  if (!(pxPorCm > 0) || pxPorCm > 10) throw new Error(`Escala no válida: ${pxPorCm} px/cm (entre 0 y 10)`);
  const anchoPx = Math.ceil(anchoCm * pxPorCm + 2 * MARGEN_PX);
  const altoPx = Math.ceil(altoCm * pxPorCm + 2 * MARGEN_PX);
  if (anchoPx > MAXIMO_PX || altoPx > MAXIMO_PX) throw new Error(`El plano saldría de ${anchoPx} x ${altoPx} px (máximo ${MAXIMO_PX} por lado): baja --px-por-cm`);
  const origen: Punto = [caja.minX - MARGEN_PX / pxPorCm, caja.minY - MARGEN_PX / pxPorCm];
  const lienzo = new Lienzo(anchoPx, altoPx, COLOR.fondo);
  const px = ([x, y]: readonly [number, number]): Punto2 => [(x - origen[0]) * pxPorCm, (y - origen[1]) * pxPorCm];
  const escalaTexto = pxPorCm >= 1.5 ? 2 : 1;
  const sobreFondo = opciones.fondos !== undefined;
  if (sobreFondo) {
    for (const f of pl.fondos ?? []) {
      const img = opciones.fondos![f.id];
      if (!img) continue;
      if (f.giro !== 0) throw new Error(`El fondo «${f.id}» está girado (${f.giro}°): --sobre-fondo sólo pinta fondos sin giro`);
      if (img.ancho !== f.anchoPx || img.alto !== f.altoPx) throw new Error(`La imagen de «${f.id}» mide ${img.ancho} x ${img.alto} px y el archivo dice ${f.anchoPx} x ${f.altoPx}: vuelve a ponerla con «fondo poner»`);
      const [x, y] = px([f.x, f.y]);
      lienzo.imagen(img.rgba, img.ancho, img.alto, x, y, Math.max(f.opacidad, 0.6), f.escala * pxPorCm);
    }
  }
  // Sobre un fondo, muros y suelos dejan ver lo que hay debajo.
  const alfaMuro = sobreFondo ? 0.55 : 1;
  const alfaSuelo = sobreFondo ? 0.25 : 1;

  // Masa de muros (exteriores oscuros; los agujeros que no son estancias, como un patio, se vacían)
  // y encima los suelos de las estancias.
  for (const p of m.masa) {
    if (sobreFondo) {
      // Con fondo no se tapa el agujero: la masa se pinta como diferencia, trozo a trozo, con alfa.
      lienzo.rellenarPoligonoConAgujeros([p.exterior.map(px), ...p.agujeros.map((h) => h.map(px))], COLOR.muro, alfaMuro);
      continue;
    }
    lienzo.rellenarPoligono(p.exterior.map(px), COLOR.muro);
    for (const h of p.agujeros) lienzo.rellenarPoligono(h.map(px), COLOR.fondo);
  }
  for (const s of pl.estancias) lienzo.rellenarPoligono(s.contorno.map(px), COLOR.suelo, alfaSuelo);

  // Rejilla encima de suelos y muros (si no, dentro de la casa no se vería) y debajo de los muebles.
  if (opciones.rejilla) {
    // Cada 50 cm, con la medida rotulada en el borde de arriba y en el de la izquierda.
    for (let x = Math.ceil(origen[0] / 50) * 50; px([x, 0])[0] < lienzo.ancho; x += 50) {
      lienzo.linea(px([x, origen[1]]), px([x, origen[1] + lienzo.alto / pxPorCm]), COLOR.rejilla, x % 100 === 0 ? 1 : 0.5);
      if (x % 100 === 0) lienzo.texto(px([x, 0])[0] + 2, 2, String(x), COLOR.rejillaTexto);
    }
    for (let y = Math.ceil(origen[1] / 50) * 50; px([0, y])[1] < lienzo.alto; y += 50) {
      lienzo.linea(px([origen[0], y]), px([origen[0] + lienzo.ancho / pxPorCm, y]), COLOR.rejilla, y % 100 === 0 ? 1 : 0.5);
      if (y % 100 === 0) lienzo.texto(2, px([0, y])[1] + 2, String(y), COLOR.rejillaTexto);
    }
  }

  // Huecos: el paso a través del muro, el barrido de las puertas y el cristal de las ventanas.
  for (const h of m.huecos) {
    const f = h.fuera;
    const d = h.profundidad + 0.5;
    const paso: Punto[] = [h.a, h.b, [h.b[0] + f[0] * d, h.b[1] + f[1] * d], [h.a[0] + f[0] * d, h.a[1] + f[1] * d]];
    lienzo.rellenarPoligono(paso.map(px), h.hueco.tipo === 'ventana' ? COLOR.cristal : COLOR.suelo);
    if (h.hueco.tipo === 'puerta') {
      const s = pl.estancias.find((x) => x.id === h.estancia)!;
      const arco = barridoPuerta(geometriaHueco(s.contorno, h.hueco));
      if (arco) for (let i = 1; i + 1 < arco.length; i++) lienzo.linea(px(arco[i]!), px(arco[i + 1]!), COLOR.barrido, 1);
    }
  }

  // Huecos de las escaleras que llegan (en blanco) y, encima, las que suben (huella, peldaños y eje
  // de subida): así se ve una escalera que arranca sobre el hueco de otra.
  const poligono = (r: Punto[], relleno: string): void => {
    const q = r.map(px);
    lienzo.rellenarPoligono(q, relleno, 1);
    for (let i = 0; i < q.length; i++) lienzo.linea(q[i]!, q[(i + 1) % q.length]!, '#5b6670', 1);
  };
  for (const { desde, escalera } of escalerasQueLlegan(e, pl.id)) for (const r of contornosDe(geometriaDe(e, desde, escalera).hueco)) poligono(r, '#ffffff');
  for (const esc of pl.escaleras ?? []) {
    const geo = geometriaDe(e, pl, esc);
    for (const r of contornosDe(geo.huella)) poligono(r, '#d9d2c5');
    if (geo.poste) lienzo.rellenarPoligono(geo.poste.map(px), '#5b6670', 1);
    for (const [a, b] of lineasPeldanos(geo)) lienzo.linea(px(a), px(b), '#8b8378', 1);
    const eje = ejeEscalera(geo).map(px);
    for (let i = 0; i + 1 < eje.length; i++) lienzo.linea(eje[i]!, eje[i + 1]!, '#2b2f33', 2);
  }

  // Obra: columnas, pilares y radiadores en piedra; vigas translúcidas; enchufes como un punto; techo
  // inclinado como una línea discontinua donde el techo ya tiene la altura de la estancia.
  for (const s of pl.estancias) {
    for (const el of s.elementos ?? []) {
      if (el.forma === 'punto') {
        lienzo.circulo(px(puntoEnElMuro(s, el)), Math.max(3, 3 * pxPorCm), '#d48a00', true);
        continue;
      }
      const q = huellaElemento(s, el)!.map(px);
      lienzo.rellenarPoligono(q, tipoNormal(el.tipo) === 'escalon' ? '#c9c2b6' : '#8d939a', el.forma === 'viga' ? 0.4 : 1);
      for (let i = 0; i < q.length; i++) lienzo.linea(q[i]!, q[(i + 1) % q.length]!, '#5b6670', 1);
    }
    for (const f of s.faldones ?? []) {
      const [a, b] = muro(s.contorno, f.muro);
      const n = normalInterior(s.contorno, f.muro);
      const pa: Punto = [a[0] + n[0] * f.alcance, a[1] + n[1] * f.alcance];
      const pb: Punto = [b[0] + n[0] * f.alcance, b[1] + n[1] * f.alcance];
      // Discontinua: tramos de 10 cm.
      const largo = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      for (let t = 0; t < largo; t += 20) {
        const t1 = Math.min(largo, t + 10);
        lienzo.linea(px([pa[0] + ((pb[0] - pa[0]) * t) / largo, pa[1] + ((pb[1] - pa[1]) * t) / largo]), px([pa[0] + ((pb[0] - pa[0]) * t1) / largo, pa[1] + ((pb[1] - pa[1]) * t1) / largo]), '#5b6670', 1);
      }
    }
  }

  // Muebles: huella con su color, frente marcado y el id; los que tienen errores, con borde rojo.
  const conError = new Set(analizarPlanta(pl).filter((i) => i.gravedad === 'error').flatMap((i) => i.muebles));
  for (const mu of pl.muebles) {
    const esq = esquinasMueble(mu).map(px);
    lienzo.rellenarPoligono(esq, mu.color, 0.85);
    const borde = conError.has(mu.id) ? COLOR.error : COLOR.texto;
    const grosor = conError.has(mu.id) ? 3 : 1;
    for (let i = 0; i < esq.length; i++) lienzo.linea(esq[i]!, esq[(i + 1) % esq.length]!, borde, grosor);
    const fa = localAPlanta(mu, -mu.ancho / 2 + 4, mu.fondo / 2 - 4);
    const fb = localAPlanta(mu, mu.ancho / 2 - 4, mu.fondo / 2 - 4);
    lienzo.linea(px(fa), px(fb), COLOR.frente, 2);
    const t = medirTexto(mu.id, escalaTexto);
    const c = px([mu.x, mu.y]);
    lienzo.rellenarPoligono([[c[0] - t.ancho / 2 - 2, c[1] - t.alto / 2 - 2], [c[0] + t.ancho / 2 + 2, c[1] - t.alto / 2 - 2], [c[0] + t.ancho / 2 + 2, c[1] + t.alto / 2 + 2], [c[0] - t.ancho / 2 - 2, c[1] + t.alto / 2 + 2]], COLOR.fondo, 0.8);
    lienzo.texto(c[0] - t.ancho / 2, c[1] - t.alto / 2, mu.id, COLOR.texto, escalaTexto);
  }

  // Nombres de las estancias, arriba a la izquierda de cada una.
  for (const s of pl.estancias) {
    const cc = cajaContorno(s.contorno);
    const [x, y] = px([cc.minX, cc.minY]);
    lienzo.texto(x + 6, y + 6, s.nombre, COLOR.rejillaTexto, escalaTexto);
  }
  return { lienzo, pxPorCm, origen };
}
