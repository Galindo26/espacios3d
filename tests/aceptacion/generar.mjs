// Aceptación final (R2-7e): genera las referencias (ref-*.espacio.json) y los planos sintéticos que
// se dan a los agentes. Uso: node tests/aceptacion/generar.mjs (tras `npm run build`).
//   A: piso de 6 estancias con pasillo, con las medidas interiores escritas en cada estancia.
//   B: piso de 5 estancias sin medidas (en el encargo se da una: el salón mide 520 cm de ancho).
//   C: piso de 3 estancias con medidas, que después se gira y se guarda en JPEG («sucio», ver sucio.py).
//   N (ronda 5, tanda 3): casa de dos plantas con medidas, un distribuidor sin rótulo en cada una, un
//   armario empotrado (no es estancia) y una escalera recta. Un plano por planta.
// Uso: node tests/aceptacion/generar.mjs [a b c n]   (sin argumentos, todas; las de la tanda 1 no cambian)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';
import { Lienzo, medirTexto } from '../../build/lienzo.mjs';
import { codificarPNG } from '../../build/png.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const est = (id, nombre, c, huecos = []) => ({ id, nombre, contorno: c, altura: 250, huecos });
const puerta = (id, muro, desde, ancho = 80) => ({ id, tipo: 'puerta', muro, desde, ancho });
const ventana = (id, muro, desde, ancho) => ({ id, tipo: 'ventana', muro, desde, ancho });

export const REFERENCIAS = {
  a: {
    formato: 'espacios3d', version: 2, nombre: 'Piso A',
    plantas: [{ id: 'pb', grosorExterior: 20, estancias: [
      est('salon', 'Salón', rect(0, 0, 480, 360), [ventana('v-salon', 0, 150, 160), puerta('p-salon-pasillo', 1, 230)]),
      est('cocina', 'Cocina', rect(490, 0, 790, 200), [ventana('v-cocina', 0, 100, 100), puerta('p-cocina', 2, 100)]),
      est('pasillo', 'Pasillo', rect(490, 210, 790, 320), [puerta('entrada', 1, 15, 90)]),
      est('dormitorio', 'Dormitorio', rect(490, 330, 790, 620), [puerta('p-dormitorio', 0, 200), ventana('v-dormitorio', 1, 100, 120)]),
      est('bano', 'Baño', rect(0, 370, 240, 620), [puerta('p-bano', 0, 80, 70), ventana('v-bano', 3, 80, 60)]),
      est('estudio', 'Estudio', rect(250, 370, 480, 620), [puerta('p-estudio', 0, 70), ventana('v-estudio', 2, 60, 100)]),
    ], muebles: [] }],
  },
  b: {
    formato: 'espacios3d', version: 2, nombre: 'Piso B',
    plantas: [{ id: 'pb', grosorExterior: 20, estancias: [
      est('salon', 'Salón', rect(0, 0, 520, 400), [puerta('p-cocina', 1, 60), puerta('p-dormitorio', 1, 290), puerta('entrada', 3, 150, 90), ventana('v-salon', 0, 180, 180)]),
      est('cocina', 'Cocina', rect(530, 0, 830, 240), [ventana('v-cocina', 0, 100, 120)]),
      est('dormitorio', 'Dormitorio', rect(530, 250, 830, 560), [ventana('v-dormitorio', 1, 100, 120)]),
      est('bano', 'Baño', rect(0, 410, 260, 560), [puerta('p-bano', 0, 90, 70), ventana('v-bano', 2, 100, 60)]),
      est('dormitorio2', 'Dormitorio 2', rect(270, 410, 520, 560), [puerta('p-dormitorio2', 0, 80), ventana('v-dormitorio2', 2, 80, 100)]),
    ], muebles: [] }],
  },
  c: {
    formato: 'espacios3d', version: 2, nombre: 'Piso C',
    plantas: [{ id: 'pb', grosorExterior: 20, estancias: [
      est('estar', 'Estar', rect(0, 0, 600, 350), [puerta('entrada', 0, 250, 90), ventana('v-estar', 3, 100, 140)]),
      est('cocina', 'Cocina', rect(0, 360, 250, 600), [puerta('p-cocina', 0, 80), ventana('v-cocina', 2, 70, 100)]),
      est('dormitorio', 'Dormitorio', rect(260, 360, 600, 600), [puerta('p-dormitorio', 0, 120), ventana('v-dormitorio', 1, 60, 120)]),
    ], muebles: [] }],
  },
  n: {
    formato: 'espacios3d', version: 2, nombre: 'Casa N',
    plantas: [
      { id: 'pb', nombre: 'Planta baja', nivel: 0, grosorExterior: 20, estancias: [
        est('salon', 'Salón', rect(0, 0, 500, 480), [ventana('v-salon', 0, 150, 180), puerta('entrada', 3, 190, 90), puerta('p-salon-dist', 1, 20)]),
        est('distribuidor', 'Distribuidor', rect(510, 0, 760, 480)),
        est('cocina', 'Cocina', rect(770, 0, 1070, 280), [ventana('v-cocina', 0, 100, 120), puerta('p-cocina', 3, 100)]),
        est('aseo', 'Aseo', rect(770, 290, 1070, 480), [puerta('p-aseo', 3, 40, 70), ventana('v-aseo', 2, 100, 60)]),
      ], muebles: [], escaleras: [{ id: 'escalera', forma: 'recta', x: 680, y: 65, ancho: 90, largo: 350, peldanos: 15, hasta: 'p1' }] },
      { id: 'p1', nombre: 'Planta alta', nivel: 280, grosorExterior: 20, estancias: [
        { ...est('dormitorio', 'Dormitorio', rect(0, 0, 500, 480), [ventana('v-dormitorio', 0, 150, 160), puerta('p-dormitorio', 1, 20)]),
          elementos: [{ id: 'armario', forma: 'adosado', tipo: 'armario', muro: 2, desde: 60, ancho: 220, fondo: 60 }] },
        est('distribuidor-alto', 'Distribuidor', rect(510, 0, 760, 480)),
        est('dormitorio2', 'Dormitorio 2', rect(770, 0, 1070, 280), [ventana('v-dormitorio2', 0, 100, 120), puerta('p-dormitorio2', 3, 100)]),
        est('bano', 'Baño', rect(770, 290, 1070, 480), [puerta('p-bano', 3, 40, 70), ventana('v-bano', 2, 100, 60)]),
      ], muebles: [] },
    ],
  },
};
/** Estancias que el plano dibuja sin rótulo ni medidas (el agente tiene que verlas). */
const SIN_ROTULO = new Set(['distribuidor', 'distribuidor-alto']);

/** Dibuja el plano «como un plano de arquitecto»: muros cortados a 1 m, puertas con su barrido, ventanas, nombres y, si se pide, medidas. */
function dibujar(e, conMedidas, pxPorCm = 1.2, k = 0) {
  const pl = e.plantas[k];
  // Todas las plantas con la misma caja (la de todas): así los planos de una casa se superponen.
  const ext = e.plantas.flatMap((p) => p.estancias.flatMap((s) => N.contornoExterior(s.contorno, p.grosorExterior)));
  const c = N.cajaContorno(ext);
  const margen = 60;
  const ancho = Math.ceil((c.maxX - c.minX) * pxPorCm + margen * 2);
  const alto = Math.ceil((c.maxY - c.minY) * pxPorCm + margen * 2);
  const l = new Lienzo(ancho, alto, '#ffffff');
  const px = ([x, y]) => [(x - c.minX) * pxPorCm + margen, (y - c.minY) * pxPorCm + margen];
  const m = N.modeloPlanta(pl);
  const banda = m.bandas.find((b) => b.y0 <= 100 && b.y1 > 100) ?? m.bandas[0];
  for (const pol of banda.poligonos) l.rellenarPoligonoConAgujeros([pol.exterior.map(px), ...pol.agujeros.map((h) => h.map(px))], '#222222');
  for (const s of pl.estancias) {
    for (const h of s.huecos) {
      const g = N.geometriaHueco(s.contorno, h);
      if (h.tipo === 'ventana') {
        const hh = m.huecos.find((x) => x.hueco.id === h.id);
        const q = (hh ? N.huellaHueco(hh) : [g.a, g.b, g.b, g.a]).map(px);
        l.rellenarPoligono(q, '#ffffff');
        for (let i = 0; i < 4; i++) l.linea(q[i], q[(i + 1) % 4], '#222222', 1);
        l.linea(px(g.a), px(g.b), '#222222', 1);
      } else {
        const arco = N.barridoPuerta(g);
        if (arco) for (let i = 1; i + 1 < arco.length; i++) l.linea(px(arco[i]), px(arco[i + 1]), '#555555', 1);
      }
    }
    for (const el of s.elementos ?? []) {
      const q = N.huellaElemento(s, el);
      if (!q) continue;
      const qp = q.map(px);
      for (let i = 0; i < qp.length; i++) l.linea(qp[i], qp[(i + 1) % qp.length], '#222222', 1);
      l.linea(qp[0], qp[2], '#777777', 1);
      const cq = N.cajaContorno(q);
      const t = el.tipo.toUpperCase();
      const { ancho: w } = medirTexto(t, 1);
      const pc = px([(cq.minX + cq.maxX) / 2, (cq.minY + cq.maxY) / 2]);
      l.texto(Math.round(pc[0] - w / 2), Math.round(pc[1] - 4), t, '#222222', 1);
    }
    if (SIN_ROTULO.has(s.id)) continue;
    const cc = N.cajaContorno(s.contorno);
    const centro = px([(cc.minX + cc.maxX) / 2, (cc.minY + cc.maxY) / 2]);
    const lineas = [s.nombre.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')];
    if (conMedidas) lineas.push(`${cc.maxX - cc.minX} X ${cc.maxY - cc.minY}`);
    lineas.forEach((t, i) => {
      const { ancho: w } = medirTexto(t, 2);
      l.texto(Math.round(centro[0] - w / 2), Math.round(centro[1] - 10 + i * 20), t, '#222222', 2);
    });
  }
  // Escaleras: en la planta de abajo, los tramos con sus peldaños y «SUBE»; arriba, el hueco con una cruz.
  for (const esc of pl.escaleras ?? []) {
    const g = N.geometriaDe(e, pl, esc);
    for (const t of g.tramos) {
      const q = t.rect.map(px);
      for (let i = 0; i < 4; i++) l.linea(q[i], q[(i + 1) % 4], '#222222', 1);
      for (let n = 1; n < t.peldanos; n++) {
        const f = n / t.peldanos;
        const a = [t.rect[0][0] + (t.rect[3][0] - t.rect[0][0]) * f, t.rect[0][1] + (t.rect[3][1] - t.rect[0][1]) * f];
        const b = [t.rect[1][0] + (t.rect[2][0] - t.rect[1][0]) * f, t.rect[1][1] + (t.rect[2][1] - t.rect[1][1]) * f];
        l.linea(px(a), px(b), '#555555', 1);
      }
    }
    const p0 = px([esc.x - 20, esc.y + 20]);
    l.texto(Math.round(p0[0]), Math.round(p0[1]), 'SUBE', '#222222', 1);
  }
  for (const { desde, escalera } of N.escalerasQueLlegan(e, pl.id)) {
    for (const h of N.geometriaDe(e, desde, escalera).hueco) {
      const q = h.map(px);
      for (let i = 0; i < q.length; i++) l.linea(q[i], q[(i + 1) % q.length], '#222222', 1);
      l.linea(q[0], q[2], '#999999', 1);
      l.linea(q[1], q[3], '#999999', 1);
    }
  }
  const titulo = e.plantas.length > 1 ? (pl.nombre ?? pl.id).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
  if (titulo) l.texto(margen, 20, titulo, '#222222', 2);
  if (conMedidas) {
    const nota = 'MEDIDAS INTERIORES EN CM';
    l.texto(margen, alto - 30, nota, '#222222', 2);
  }
  return codificarPNG(l.rgba, l.ancho, l.alto);
}

const pedidas = process.argv.slice(2).map((x) => x.toLowerCase());
for (const [k, e] of Object.entries(REFERENCIAS)) {
  if (pedidas.length && !pedidas.includes(k)) continue;
  const v = N.validarOLanzar(e);
  writeFileSync(join(AQUI, `ref-${k}.espacio.json`), N.aJSON(v));
  if (v.plantas.length === 1) writeFileSync(join(AQUI, `plano-${k}.png`), dibujar(v, k !== 'b'));
  else v.plantas.forEach((p, i) => writeFileSync(join(AQUI, `plano-${k}-${p.id}.png`), dibujar(v, true, 1.2, i)));
  const inc = N.analizar(v);
  console.log(`ref-${k}: ${v.plantas.map((p) => `${p.id} ${p.estancias.length} estancias`).join(', ')}; ${inc.filter((i) => i.gravedad === 'error').length} errores, ${inc.filter((i) => i.gravedad === 'aviso').length} avisos`);
  for (const i of inc) console.log(`  ${i.gravedad}: ${i.mensaje}`);
}
