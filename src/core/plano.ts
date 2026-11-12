// Plano en planta como texto (para que un agente «vea» la distribución en la terminal) y como SVG.
import { incidenciasDePlanta, analizarPlanta, chocanEnAltura, esSillaBajo } from './analisis.js';
import { planta } from './espacio.js';
import { ErrorGeometria } from './booleanas.js';
import { modeloPlanta } from './muros.js';
import { huellaElemento, puntoEnElMuro, tipoNormal } from './elementos.js';
import { contornosDe, describirEscalera, ejeEscalera, enHuella, enHueco, escalerasQueLlegan, geometriaDe, lineasPeldanos, type GeometriaEscalera } from './escaleras.js';
import {
  cajaContorno, contornoExterior, distancia, distanciaAlContorno, esquinasMueble, longitudMuro, muro, normalInterior,
  puntoEnPoligono, puntoEstrictamenteEnConvexo,
} from './geometria.js';
import { barridoPuerta, geometriaHueco } from './huecos.js';
import type { Elemento, Espacio, Mueble, Punto } from './tipos.js';

/** Caja que contiene varios polígonos. */
function cajaDe(poligonos: readonly (readonly Punto[])[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return cajaContorno(poligonos.flat() as Punto[]);
}

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function rumbo(giro: number): string {
  if (Math.abs(giro / 90 - Math.round(giro / 90)) > 1e-6) {
    const r = (giro * Math.PI) / 180;
    return `(${r1(-Math.sin(r))}, ${r1(Math.cos(r))}) en x, y`;
  }
  const g = ((Math.round(giro / 90) % 4) + 4) % 4;
  return ['abajo (+y)', 'izquierda (-x)', 'arriba (-y)', 'derecha (+x)'][g] as string;
}

/** ¿El segmento ab cruza el rectángulo [x0, x1] × [y0, y1]? (Liang–Barsky) */
function segmentoEnRect(a: Punto, b: Punto, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Plano ASCII. Cada carácter cubre `celda` cm de ancho y el doble de alto (los caracteres de una
 * terminal son el doble de altos que de anchos). Muebles con letras; «!» donde dos chocan;
 * «#» muro; «P» puerta, «V» ventana, «_» paso; «.» suelo libre.
 */
export function planoTexto(espacio: Espacio, opciones: { columnas?: number; planta?: string } = {}): string {
  const pl = planta(espacio, opciones.planta);
  const grosorMuros = pl.grosorExterior;
  const contornos = pl.estancias.map((s) => s.contorno);
  const caja = cajaDe(contornos.map((c) => contornoExterior(c, grosorMuros)));
  const ancho = caja.maxX - caja.minX;
  const columnas = Math.min(400, Math.max(10, opciones.columnas ?? 72));
  const celda = Math.max(2, Math.ceil(ancho / columnas));
  const alto = celda * 2;
  const cols = Math.ceil(ancho / celda);
  const filas = Math.ceil((caja.maxY - caja.minY) / alto);
  const muebles = pl.muebles.map((m, i) => ({ m, letra: LETRAS[i] ?? '?', esq: esquinasMueble(m) }));
  const geoHuecos = pl.estancias.flatMap((s) => s.huecos.map((h) => ({ h, g: geometriaHueco(s.contorno, h) })));
  // Obra que ocupa suelo (columnas, pilares, radiadores, escalones…); las vigas y los enchufes van en la leyenda.
  const obra = pl.estancias.flatMap((s) => (s.elementos ?? []).filter((el) => el.forma === 'exento' || el.forma === 'adosado').map((el) => huellaElemento(s, el)!));
  // Escaleras que suben desde aquí («=») y huecos de las que llegan («O»).
  const suben = (pl.escaleras ?? []).map((esc) => ({ esc, geo: geometriaDe(espacio, pl, esc) }));
  const llegan = escalerasQueLlegan(espacio, pl.id).map(({ desde, escalera }) => ({ desde, esc: escalera, geo: geometriaDe(espacio, desde, escalera) }));

  const rejilla: string[][] = [];
  for (let f = 0; f < filas; f++) {
    const fila: string[] = [];
    for (let c = 0; c < cols; c++) {
      const x0 = caja.minX + c * celda;
      const y0 = caja.minY + f * alto;
      const p: Punto = [x0 + celda / 2, y0 + alto / 2];
      const dentro = contornos.some((contorno) => puntoEnPoligono(p, contorno));
      // Es muro si la cara interior de alguna estancia cruza la celda (así se dibuja siempre, con
      // cualquier grosor o escala) o si la celda cae fuera, dentro del grosor del muro.
      const cruza = contornos.some((contorno) =>
        contorno.some((_, i) => {
          const [a, b] = muro(contorno, i);
          return segmentoEnRect(a, b, x0, y0, x0 + celda, y0 + alto);
        }),
      );
      if (cruza || (!dentro && contornos.some((contorno) => distanciaAlContorno(p, contorno) <= grosorMuros))) {
        let ch = '#';
        for (const { h, g } of geoHuecos) {
          const s = (p[0] - g.a[0]) * g.t[0] + (p[1] - g.a[1]) * g.t[1];
          const perp = (p[0] - g.a[0]) * g.n[0] + (p[1] - g.a[1]) * g.n[1];
          if (s >= 0 && s <= h.ancho && Math.abs(perp) <= grosorMuros + alto) ch = h.tipo === 'puerta' ? 'P' : h.tipo === 'ventana' ? 'V' : '_';
        }
        fila.push(ch);
        continue;
      }
      if (!dentro) {
        fila.push(' ');
        continue;
      }
      const aqui = muebles.filter((x) => puntoEstrictamenteEnConvexo(p, x.esq, 0));
      if (aqui.length === 0) {
        fila.push(suben.some((x) => enHuella(x.geo, p)) ? '=' : llegan.some((x) => enHueco(x.geo, p)) ? 'O' : obra.some((q) => puntoEstrictamenteEnConvexo(p, q, 0)) ? '%' : '.');
      }
      else if (aqui.length === 1) fila.push(aqui[0]!.letra);
      else {
        // «!» sólo donde el análisis ve un solape (una silla metida bajo la mesa es un aviso, no un choque).
        const choque = aqui.some((a, i) => aqui.some((b, j) => j > i && chocanEnAltura(a.m, b.m) && !esSillaBajo(a.m, b.m) && !esSillaBajo(b.m, a.m)));
        // Si no chocan (uno bajo otro o colgado encima), se ve el de arriba.
        fila.push(choque ? '!' : aqui.reduce((x, y) => (y.m.elevacion + y.m.alto > x.m.elevacion + x.m.alto ? y : x)).letra);
      }
    }
    rejilla.push(fila);
  }
  // Un mueble más pequeño que una celda no cubre ningún centro: se marca al menos en la celda de su centro.
  for (const { m, letra } of muebles) {
    const c = Math.floor((m.x - caja.minX) / celda);
    const f = Math.floor((m.y - caja.minY) / alto);
    if (rejilla[f]?.[c] === '.') rejilla[f]![c] = letra;
  }
  const lineas = rejilla.map((f) => f.join('').replace(/\s+$/, ''));

  const inc = incidenciasDePlanta(espacio, pl.id);
  const sal: string[] = [];
  const varias = espacio.plantas.length > 1;
  const titulo = varias ? `«${espacio.nombre}», ${pl.nombre} (${pl.id})` : `«${espacio.nombre}»`;
  sal.push(`Plano de ${titulo}. 1 carácter = ${celda} cm de ancho x ${alto} cm de alto. x a la derecha, y hacia abajo; origen (${r1(caja.minX)}, ${r1(caja.minY)}) en la esquina superior izquierda del dibujo.`);
  sal.push(...lineas);
  sal.push('');
  sal.push(`Leyenda: # muro, P puerta, V ventana, _ paso, . suelo libre, ! choque${obra.length ? ', % obra (columna, pilar, radiador…)' : ''}${suben.length ? ', = escalera' : ''}${llegan.length ? ', O hueco de una escalera que llega de abajo' : ''}.`);
  for (const { esc, geo } of suben) sal.push(`  ${describirEscalera(esc, geo)}`);
  for (const { esc, desde } of llegan) sal.push(`  hueco de la escalera ${esc.id}, que sube desde ${desde.id}`);
  for (const { m, letra } of muebles) {
    const extra = [m.elevacion > 0 ? `a ${m.elevacion} cm del suelo` : '', m.bloqueado ? 'bloqueado' : ''].filter(Boolean).join(', ');
    sal.push(`  ${letra}  ${m.id} «${m.nombre}» ${m.ancho}x${m.fondo}x${m.alto} cm en (${r1(m.x)}, ${r1(m.y)}), giro ${m.giro}°, frente hacia ${rumbo(m.giro)}${extra ? `, ${extra}` : ''}`);
  }
  const variasEstancias = pl.estancias.length > 1;
  for (const s of pl.estancias) {
    const contorno = s.contorno;
    if (variasEstancias) sal.push(`  estancia ${s.id} «${s.nombre}», alto ${s.altura} cm:`);
    const sangria = variasEstancias ? '    ' : '  ';
    for (let i = 0; i < contorno.length; i++) {
      const [a, b] = muro(contorno, i);
      sal.push(`${sangria}muro ${i}: de (${r1(a[0])}, ${r1(a[1])}) a (${r1(b[0])}, ${r1(b[1])}), ${r1(longitudMuro(contorno, i))} cm`);
    }
  }
  for (const s of pl.estancias) {
    for (const el of s.elementos ?? []) sal.push(`  ${describirElemento(el)}${variasEstancias ? ` (estancia ${s.id})` : ''}`);
    for (const f of s.faldones ?? []) sal.push(`  techo inclinado${variasEstancias ? ` de ${s.id}` : ''}: junto al muro ${f.muro} a ${f.alturaEnMuro} cm, sube hasta ${s.altura} cm en ${f.alcance} cm`);
  }
  for (const { h } of geoHuecos) sal.push(`  ${h.tipo} ${h.id}${variasEstancias ? ` (estancia ${pl.estancias.find((s) => s.huecos.includes(h))?.id})` : ''}: muro ${h.muro}, desde ${h.desde} cm, ${h.ancho} cm de ancho${h.tipo === 'ventana' ? `, antepecho ${h.antepecho} cm` : ''}${h.tipo === 'puerta' ? `, abre ${h.abre}, bisagra ${h.bisagra}` : ''} (zona libre de paso delante: ${h.tipo === 'ventana' ? 'no' : '60 cm'})`);
  if (espacio.plantas.length > 1 && opciones.planta === undefined) sal.push(`Este espacio tiene ${espacio.plantas.length} plantas (${espacio.plantas.map((x) => x.id).join(', ')}); esta es ${pl.id}. Las otras, con --planta <id>.`);
  sal.push(inc.length ? `Incidencias (${inc.length}):` : 'Sin incidencias.');
  for (const i of inc) sal.push(`  [${i.gravedad}] ${i.mensaje}`);
  return `${sal.join('\n')}\n`;
}

/** Una línea para la leyenda: tipo, id, forma y medidas. */
export function describirElemento(el: Elemento): string {
  if (el.forma === 'exento') return `${el.tipo} ${el.id}: ${el.redondo ? `redondo de ${el.ancho} cm` : `${el.ancho}x${el.fondo} cm`} en (${r1(el.x)}, ${r1(el.y)})${el.alto ? `, ${el.alto} cm de alto` : ', hasta el techo'}`;
  if (el.forma === 'adosado') return `${el.tipo} ${el.id}: muro ${el.muro}, desde ${el.desde} cm, ${el.ancho} cm de ancho y ${el.fondo} hacia dentro${el.alto ? `, ${el.alto} cm de alto` : ', hasta el techo'}${el.elevacion ? ` a ${el.elevacion} cm del suelo` : ''}`;
  if (el.forma === 'punto') return `${el.tipo} ${el.id}: muro ${el.muro}, desde ${el.desde} cm, a ${el.altura} cm del suelo`;
  return `${el.tipo} ${el.id}: de (${r1(el.de[0])}, ${r1(el.de[1])}) a (${r1(el.a[0])}, ${r1(el.a[1])}), ${el.ancho} cm de ancho, baja ${el.canto} cm del techo`;
}

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function puntos(p: readonly Punto[]): string {
  return p.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
}

/** Plano SVG autocontenido (unidades en cm), con muros, huecos, muebles, frentes e incidencias. */
/**
 * `fuente`: tamaño de los rótulos (cm del dibujo); por defecto, según el tamaño de la planta.
 * `cotasALoLargo`: las longitudes de las paredes, giradas a lo largo de cada una (el imprimible); el
 * SVG de siempre las deja en horizontal (sus salidas de referencia de la v1 no cambian).
 */
export function planoSVG(
  espacio: Espacio,
  opciones: { planta?: string; fuente?: number; cotasALoLargo?: boolean; incidencias?: ReturnType<typeof incidenciasDePlanta> } = {},
): string {
  const pl = planta(espacio, opciones.planta);
  const grosorMuros = pl.grosorExterior;
  const exteriores = pl.estancias.map((s) => contornoExterior(s.contorno, Math.max(grosorMuros, 1)));
  const caja = cajaDe(exteriores);
  const fuente = opciones.fuente ?? Math.max(8, Math.min(14, (caja.maxX - caja.minX) / 45));
  // Las cotas van fuera de los muros, a un grueso de letra: el margen las deja dentro del dibujo.
  // Con la letra fijada (el imprimible), el margen crece con ella para que las cotas quepan; si no, 40
  // como siempre (revisión independiente, 9: el SVG de «Exportar» y las salidas de la v1 no cambian).
  const margen = opciones.fuente !== undefined ? Math.max(40, grosorMuros + fuente * 2.2) : 40;
  const vb = [caja.minX - margen, caja.minY - margen, caja.maxX - caja.minX + margen * 2, caja.maxY - caja.minY + margen * 2];
  // Quien dibuja varias veces la misma planta (el imprimible) pasa las incidencias ya calculadas.
  const inc = opciones.incidencias ?? incidenciasDePlanta(espacio, pl.id);
  const conError = new Set(inc.filter((i) => i.gravedad === 'error').flatMap((i) => i.muebles));
  const conAviso = new Set(inc.filter((i) => i.gravedad === 'aviso').flatMap((i) => i.muebles));
  const e: string[] = [];
  e.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(r1).join(' ')}" width="${r1(vb[2]! * 2)}" height="${r1(vb[3]! * 2)}" font-family="sans-serif">`);
  e.push(`<title>${xml(espacio.nombre)}</title>`);
  e.push(`<rect x="${r1(vb[0]!)}" y="${r1(vb[1]!)}" width="${r1(vb[2]!)}" height="${r1(vb[3]!)}" fill="#fbfaf7"/>`);
  // Primero todos los exteriores y después todos los suelos: entre estancias contiguas queda el tabique.
  for (const ext of exteriores) e.push(`<polygon points="${puntos(ext)}" fill="#3b4046"/>`);
  for (const s of pl.estancias) e.push(`<polygon points="${puntos(s.contorno)}" fill="#efe8dc"/>`);
  // Huecos: hueco en el muro y, en puertas que abren hacia dentro, el barrido.
  const profundidades = new Map<string, [number, number]>();
  if (pl.estancias.length > 1) {
    try {
      for (const x of modeloPlanta(pl).huecos) if (x.profundidad > 0) profundidades.set(x.hueco.id, [x.profundidadA, x.profundidadB]);
    } catch (err) {
      if (!(err instanceof ErrorGeometria)) throw err;
    }
  }
  for (const { h, contorno } of pl.estancias.flatMap((s) => s.huecos.map((h) => ({ h, contorno: s.contorno })))) {
    const g = geometriaHueco(contorno, h);
    // Con varias estancias, el paso mide lo que el muro de verdad (un tabique puede ser más grueso
    // que los muros exteriores); con una, el grosor de la planta, como siempre.
    const enModelo = profundidades.get(h.id);
    const fondoA = (enModelo?.[0] ?? grosorMuros) + 0.5;
    const fondoB = (enModelo?.[1] ?? grosorMuros) + 0.5;
    const fuera = (p: Punto, d: number): Punto => [p[0] - g.n[0] * d, p[1] - g.n[1] * d];
    const color = h.tipo === 'ventana' ? '#a9c9e8' : '#efe8dc';
    e.push(`<polygon points="${puntos([g.a, g.b, fuera(g.b, fondoB), fuera(g.a, fondoA)])}" fill="${color}"/>`);
    const barrido = barridoPuerta(g);
    if (barrido) e.push(`<polygon points="${puntos(barrido)}" fill="none" stroke="#8b8378" stroke-width="0.8" stroke-dasharray="4 3"/>`);
  }
  // Obra: columnas y pilares en piedra, vigas en piedra translúcida y discontinua, enchufes como un
  // punto en su muro y techo inclinado como una línea discontinua donde ya llega a la altura de la estancia.
  for (const s of pl.estancias) {
    for (const el of s.elementos ?? []) {
      const titulo = `<title>${xml(describirElemento(el))}</title>`;
      if (el.forma === 'punto') {
        const [x, y] = puntoEnElMuro(s, el);
        e.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="4" fill="#d48a00" stroke="#2b2f33" stroke-width="0.6">${titulo}</circle>`);
        continue;
      }
      const q = huellaElemento(s, el)!;
      if (el.forma === 'viga') e.push(`<polygon points="${puntos(q)}" fill="#8d939a" fill-opacity="0.35" stroke="#5b6670" stroke-width="0.8" stroke-dasharray="6 4">${titulo}</polygon>`);
      else e.push(`<polygon points="${puntos(q)}" fill="${tipoNormal(el.tipo) === 'escalon' ? '#c9c2b6' : '#8d939a'}" stroke="#5b6670" stroke-width="0.8">${titulo}</polygon>`);
    }
    for (const f of s.faldones ?? []) {
      const [a, b] = muro(s.contorno, f.muro);
      const n = normalInterior(s.contorno, f.muro);
      const d = f.alcance;
      e.push(`<line x1="${r1(a[0] + n[0] * d)}" y1="${r1(a[1] + n[1] * d)}" x2="${r1(b[0] + n[0] * d)}" y2="${r1(b[1] + n[1] * d)}" stroke="#5b6670" stroke-width="1" stroke-dasharray="3 3"><title>${xml(`techo inclinado: ${f.alturaEnMuro} cm junto al muro ${f.muro}, ${s.altura} cm desde aquí`)}</title></line>`);
    }
  }
  // Escaleras: huella con los cantos de los peldaños y una flecha de subida; huecos de las que llegan,
  // en blanco con borde discontinuo y la flecha de bajada.
  const flecha = (geo: GeometriaEscalera, baja: boolean): void => {
    const eje = ejeEscalera(geo);
    const pts = baja ? [...eje].reverse() : eje;
    e.push(`<polyline points="${puntos(pts)}" fill="none" stroke="#2b2f33" stroke-width="1.2"/>`);
    const [a, b] = [pts[pts.length - 2]!, pts[pts.length - 1]!];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u: Punto = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const t = 12;
    e.push(`<polygon points="${puntos([b, [b[0] - u[0] * t - u[1] * t * 0.5, b[1] - u[1] * t + u[0] * t * 0.5], [b[0] - u[0] * t + u[1] * t * 0.5, b[1] - u[1] * t - u[0] * t * 0.5]])}" fill="#2b2f33"/>`);
  };
  // Primero los huecos: si otra escalera arranca encima (una sobre otra), se ve por encima del hueco.
  for (const { desde, escalera } of escalerasQueLlegan(espacio, pl.id)) {
    const geo = geometriaDe(espacio, desde, escalera);
    e.push(`<g><title>${xml(`hueco de la escalera ${escalera.id}, que sube desde ${desde.id}`)}</title>`);
    for (const r of contornosDe(geo.hueco)) e.push(`<polygon points="${puntos(r)}" fill="#ffffff" stroke="#5b6670" stroke-width="1" stroke-dasharray="5 3"/>`);
    flecha(geo, true);
    e.push('</g>');
  }
  for (const esc of pl.escaleras ?? []) {
    const geo = geometriaDe(espacio, pl, esc);
    e.push(`<g><title>${xml(describirEscalera(esc, geo))}</title>`);
    for (const r of contornosDe(geo.huella)) e.push(`<polygon points="${puntos(r)}" fill="#d9d2c5" stroke="#5b6670" stroke-width="0.8"/>`);
    if (geo.poste) e.push(`<polygon points="${puntos(geo.poste)}" fill="#5b6670"/>`);
    for (const [a, b] of lineasPeldanos(geo)) e.push(`<line x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(b[0])}" y2="${r1(b[1])}" stroke="#8b8378" stroke-width="0.6"/>`);
    flecha(geo, false);
    e.push('</g>');
  }
  // Muebles.
  pl.muebles.forEach((m: Mueble) => {
    const esq = esquinasMueble(m);
    const borde = conError.has(m.id) ? '#c0392b' : conAviso.has(m.id) ? '#d48a00' : '#2b2f33';
    const grosor = conError.has(m.id) || conAviso.has(m.id) ? 2 : 0.8;
    e.push(`<g><title>${xml(`${m.id} «${m.nombre}» ${m.ancho}x${m.fondo}x${m.alto} cm`)}</title>`);
    e.push(`<polygon points="${puntos(esq)}" fill="${m.color}" fill-opacity="${m.elevacion > 0 ? 0.55 : 0.9}" stroke="${borde}" stroke-width="${grosor}"/>`);
    e.push(`<line x1="${r1(esq[3]![0])}" y1="${r1(esq[3]![1])}" x2="${r1(esq[2]![0])}" y2="${r1(esq[2]![1])}" stroke="#2b2f33" stroke-width="3"/>`);
    const ancho = Math.min(m.ancho, m.fondo) > 40 ? fuente : fuente * 0.8;
    e.push(`<text x="${r1(m.x)}" y="${r1(m.y)}" font-size="${r1(ancho)}" text-anchor="middle" dominant-baseline="middle" fill="#2b2f33">${xml(m.nombre)}</text>`);
    e.push('</g>');
  });
  // Longitud de cada muro, por fuera.
  for (const contorno of pl.estancias.map((s) => s.contorno)) for (let i = 0; i < contorno.length; i++) {
    const [a, b] = muro(contorno, i);
    const n = normalInterior(contorno, i);
    const d = grosorMuros + fuente;
    const mx = (a[0] + b[0]) / 2 - n[0] * d;
    const my = (a[1] + b[1]) / 2 - n[1] * d;
    // A lo largo de la pared (girado en las que van más de arriba abajo), para no montarse en el muro.
    let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang <= -90) ang += 180;
    const giro = opciones.cotasALoLargo && Math.abs(ang) > 0.5 ? ` transform="rotate(${r1(ang)} ${r1(mx)} ${r1(my)})"` : '';
    e.push(`<text x="${r1(mx)}" y="${r1(my)}" font-size="${r1(fuente)}" text-anchor="middle" dominant-baseline="middle" fill="#5b6670"${giro}>${r1(distancia(a, b))} cm</text>`);
  }
  e.push('</svg>');
  return `${e.join('\n')}\n`;
}
