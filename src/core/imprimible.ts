// Plano acotado para imprimir o guardar en PDF (R4-4) con el «Imprimir» del navegador, sin librerías:
// un HTML con una hoja A4 apaisada por planta, el SVG acotado de cada una a una escala normalizada
// (la mayor que quepa) con sus medidas en mm, el nombre, la planta, la escala, una barra de 1 m para
// comprobarla al imprimir y la fecha. Impreso al 100 % («tamaño real»), la escala es la del rótulo.
import { planoSVG } from './plano.js';
import { incidenciasDePlanta } from './analisis.js';
import type { Espacio } from './tipos.js';

/** Escalas normalizadas (1:N), de más grande a más pequeña. */
export const ESCALAS = [10, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 500, 1000];
/** Alto de los rótulos en el papel (mm): unos 8 puntos, se lea a la escala que sea. */
export const LETRA_MM = 2.8;
/** Zona del dibujo en una A4 apaisada con márgenes de 12 mm y la cabecera (mm). */
export const DIBUJO_MM: [number, number] = [273, 160];

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface HojaImprimible {
  planta: string;
  escala: number;
  /** Tamaño del dibujo en el papel (mm). */
  anchoMm: number;
  altoMm: number;
}

/** La escala normalizada mayor con la que un dibujo de ancho × alto cm cabe en la hoja. */
export function escalaPara(anchoCm: number, altoCm: number): number {
  return ESCALAS.find((n) => (anchoCm * 10) / n <= DIBUJO_MM[0] + 1e-9 && (altoCm * 10) / n <= DIBUJO_MM[1] + 1e-9) ?? ESCALAS[ESCALAS.length - 1]!;
}

/** HTML para imprimir el plano acotado de todas las plantas, y lo que lleva cada hoja. */
export function planoImprimible(e: Espacio, opciones: { fecha?: string; planta?: string } = {}): { html: string; hojas: HojaImprimible[] } {
  const hoy = new Date();
  const fecha = opciones.fecha ?? `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const hojas: HojaImprimible[] = [];
  const plantas = opciones.planta !== undefined ? e.plantas.filter((p) => p.id === opciones.planta) : e.plantas;
  if (!plantas.length) throw new Error(`No existe la planta «${opciones.planta}»`);
  const cuerpos = plantas.map((p) => {
    // El análisis, una vez por planta (no en cada escala que se prueba: revisión independiente, 4).
    const incidencias = incidenciasDePlanta(e, p.id);
    // Cada escala, de mayor a menor, con los rótulos a LETRA_MM en el papel: la primera que cabe.
    const medir = (svg: string): [number, number] => {
      const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
      return vb ? [Number(vb[3]), Number(vb[4])] : [100, 100];
    };
    let n = ESCALAS[ESCALAS.length - 1]!;
    let svg = '';
    for (const k of ESCALAS) {
      svg = planoSVG(e, { planta: p.id, fuente: (LETRA_MM * k) / 10, cotasALoLargo: true, incidencias });
      n = k;
      if (escalaPara(...medir(svg)) <= k) break;
    }
    const [ancho, alto] = medir(svg);
    const anchoMm = Math.round(((ancho * 10) / n) * 10) / 10;
    const altoMm = Math.round(((alto * 10) / n) * 10) / 10;
    hojas.push({ planta: p.id, escala: n, anchoMm, altoMm });
    // El SVG pasa a medir en mm: impreso al 100 %, 1 cm del espacio son 10/N mm del papel.
    const enMm = svg.replace(/(<svg\b[^>]*?) width="[^"]*" height="[^"]*"/, `$1 width="${anchoMm}mm" height="${altoMm}mm"`);
    const titulo = e.plantas.length > 1 ? `${xml(p.nombre)} · nivel ${p.nivel} cm` : '';
    return `<section class="hoja">
<header><div><h1>${xml(e.nombre)}</h1>${titulo ? `<p>${titulo}</p>` : ''}</div>
<div class="escala"><p>Escala 1:${n} · medidas en cm · ${xml(fecha)}</p><p><span class="barra" style="width:${Math.round((1000 / n) * 100) / 100}mm"></span> 1 m</p></div></header>
<div class="dibujo">${enMm}</div>
</section>`;
  });
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${xml(e.nombre)} · plano</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "IBM Plex Sans", system-ui, sans-serif; color: #1e2125; }
h1 { font-size: 14pt; margin: 0; }
header { display: flex; justify-content: space-between; align-items: flex-start; height: 20mm; gap: 8mm; }
header p { margin: 1mm 0 0; font-size: 9pt; color: #3b4046; }
.escala { text-align: right; }
.barra { display: inline-block; height: 2mm; vertical-align: middle; background: repeating-linear-gradient(90deg, #1e2125 0 50%, #ffffff 50% 100%); border: 0.3mm solid #1e2125; }
.dibujo { display: flex; justify-content: center; align-items: flex-start; height: ${DIBUJO_MM[1]}mm; }
.dibujo svg { display: block; }
.hoja { break-after: page; page-break-after: always; }
.hoja:last-of-type { break-after: auto; page-break-after: auto; }
.mandos { display: none; }
@media screen {
  body { background: #e6e2db; padding: 16px; }
  .hoja { background: #ffffff; width: 297mm; min-height: 210mm; padding: 12mm; margin: 0 auto 16px; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
  .mandos { display: flex; justify-content: center; gap: 12px; margin-bottom: 16px; font-size: 14px; }
  .mandos button { font: inherit; padding: 8px 16px; min-height: 44px; border-radius: 6px; border: 1px solid #3b4046; background: #f2c14e; cursor: pointer; }
}
</style></head>
<body>
<div class="mandos"><button type="button" onclick="print()">Imprimir o guardar en PDF</button><p>Imprime a «tamaño real» (100 %) para que la escala sea la del rótulo; la barra mide 1 m.</p></div>
${cuerpos.join('\n')}
</body></html>
`;
  return { html, hojas };
}
