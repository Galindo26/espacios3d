// Aceptación final (R2-7e): puntúa el espacio que hizo un agente frente a la referencia, sin nada a ojo.
// Uso: node tests/aceptacion/puntuar.mjs <referencia.espacio.json> <resultado.espacio.json> --modo cotas|medida|real
//
// 1. El resultado es válido y `analizar` no da errores.
// 2. Se alinea por la esquina superior izquierda de la caja de todas las estancias (el agente elige su origen).
// 3. Cada estancia de la referencia se empareja con la del resultado que más la cubre (≥ 50 % de su área).
// 4. Medidas: ancho y largo de la caja de cada estancia emparejada.
//    cotas: error ≤ máx(2 %, 5 cm); medida: ≤ 10 %; real: ≤ 15 % y sólo las cuatro grandes.
// 5. Estancias: synthetic, ni faltan ni sobran; real, las siete rotuladas (el distribuidor es opcional y puede sobrar alguna).
// 6. Conexiones (puertas y pasos, con «exterior»): sintéticos, las mismas que la referencia; real, las cuatro de la lista.
// 7. Ronda 5: con varias plantas, lo mismo planta por planta (por nivel), con la misma alineación, y cada
//    escalera de la referencia tiene una en el resultado que llega arriba y cubre >= 50 % de su huella.
import { readFileSync } from 'node:fs';
import * as N from '../../build/core.mjs';

const [refRuta, resRuta, , modoArg] = process.argv.slice(2);
const modo = modoArg ?? 'cotas';
if (!refRuta || !resRuta || !['cotas', 'medida', 'real'].includes(modo)) {
  console.error('Uso: node puntuar.mjs <referencia> <resultado> --modo cotas|medida|real');
  process.exit(3);
}
const leer = (r) => JSON.parse(readFileSync(r, 'utf8'));
const ref = N.validarOLanzar(leer(refRuta));
const v = N.validar(leer(resRuta));
const informe = { modo, comprobaciones: [], ok: false };
const comprobar = (nombre, ok, detalle) => informe.comprobaciones.push({ nombre, ok, detalle });
if (!v.ok) {
  comprobar('válido', false, v.errores.slice(0, 5));
  console.log(JSON.stringify(informe, null, 1));
  process.exit(1);
}
const res = v.espacio;
comprobar('válido', true);
const errores = N.analizar(res).filter((i) => i.gravedad === 'error');
comprobar('analizar sin errores', errores.length === 0, errores.map((i) => i.mensaje));

// Plantas: las de la referencia y las del resultado, por nivel (ronda 5: casas de varias plantas). Con una
// planta, todo es como en la tanda 1 (mismos nombres de comprobación).
const porNivel = (e) => [...e.plantas].sort((a, b) => (a.nivel ?? 0) - (b.nivel ?? 0));
const plantasRef = porNivel(ref);
const plantasRes = porNivel(res);
const varias = plantasRef.length > 1;
if (varias) comprobar('plantas', plantasRes.length === plantasRef.length, { referencia: plantasRef.length, resultado: plantasRes.length });
const caja = (ps) => N.cajaContorno(ps.flatMap((s) => s.contorno));
// Alineación por la caja de la planta de abajo; la misma para todas (comparten el origen x, y).
const cr = caja(plantasRef[0].estancias);
const cs = caja(plantasRes[0].estancias);
const dx = cr.minX - cs.minX;
const dy = cr.minY - cs.minY;
const mover = (c) => c.map(([x, y]) => [x + dx, y + dy]);
const area = (c) => N.areaTotal([{ exterior: c, agujeros: [] }]);
const interseccion = (a, b) => area(a) - N.areaTotal(N.diferencia([{ exterior: a, agujeros: [] }], [{ exterior: b, agujeros: [] }]));
const grandes = ['salon', 'recibidor', 'familia', 'cocina'];

function puntuarPlanta(pRef, pRes, prefijo) {
  const nombre = (n) => (prefijo ? `${prefijo}: ${n}` : n);
  // Emparejamiento: por cada estancia de la referencia, la del resultado que más la cubre.
  const pares = [];
  for (const s of pRef.estancias) for (const t of pRes.estancias) {
    const f = interseccion(s.contorno, mover(t.contorno)) / area(s.contorno);
    if (f > 0) pares.push({ ref: s.id, res: t.id, f });
  }
  pares.sort((a, b) => b.f - a.f);
  const deRef = new Map();
  const deRes = new Map();
  for (const p of pares) {
    if (p.f < 0.5 || deRef.has(p.ref) || deRes.has(p.res)) continue;
    deRef.set(p.ref, p.res);
    deRes.set(p.res, p.ref);
  }
  const faltan = pRef.estancias.map((s) => s.id).filter((id) => !deRef.has(id));
  const sobran = pRes.estancias.map((s) => s.id).filter((id) => !deRes.has(id));
  if (modo === 'real') {
    const obligatorias = faltan.filter((id) => id !== 'distribuidor');
    comprobar(nombre('estancias rotuladas'), obligatorias.length === 0, { faltan, sobran });
  } else comprobar(nombre('estancias'), faltan.length === 0 && sobran.length === 0, { faltan, sobran });

  // Medidas de la caja de cada estancia emparejada.
  const medidas = [];
  for (const s of pRef.estancias) {
    const id = deRef.get(s.id);
    if (!id || (modo === 'real' && !grandes.includes(s.id))) continue;
    const t = pRes.estancias.find((x) => x.id === id);
    const a = N.cajaContorno(s.contorno);
    const b = N.cajaContorno(t.contorno);
    for (const [eje, r, o] of [['ancho', a.maxX - a.minX, b.maxX - b.minX], ['largo', a.maxY - a.minY, b.maxY - b.minY]]) {
      const tol = modo === 'cotas' ? Math.max(0.02 * r, 5) : modo === 'medida' ? 0.1 * r : 0.15 * r;
      medidas.push({ estancia: s.id, eje, referencia: Math.round(r), resultado: Math.round(o), error: Math.round(Math.abs(o - r) * 10) / 10, tolerancia: Math.round(tol * 10) / 10, ok: Math.abs(o - r) <= tol });
    }
  }
  comprobar(nombre('medidas'), medidas.length > 0 && medidas.every((m) => m.ok), medidas.filter((m) => !m.ok).length ? medidas.filter((m) => !m.ok) : `${medidas.length} medidas dentro de tolerancia`);

  // Conexiones.
  const conexiones = (p, mapa) => new Set(N.modeloPlanta(p).conexiones.map((c) => [mapa(c.de), mapa(c.a)].sort().join(' <-> ')));
  const enRes = conexiones(pRes, (id) => (id === 'exterior' ? 'exterior' : (deRes.get(id) ?? `?${id}`)));
  if (modo === 'real') {
    const hall = (x) => enRes.has(x);
    const pide = [['recibidor', 'salon'], ['familia', 'salon'], ['exterior', 'recibidor']].map((p) => p.sort().join(' <-> '));
    const cocina = hall(['cocina', 'distribuidor'].sort().join(' <-> ')) || hall(['cocina', 'recibidor'].sort().join(' <-> '));
    const faltanC = pide.filter((x) => !enRes.has(x));
    if (!cocina) faltanC.push('cocina <-> distribuidor o recibidor');
    comprobar(nombre('conexiones'), faltanC.length === 0, { faltan: faltanC, resultado: [...enRes] });
  } else {
    const enRef = conexiones(pRef, (id) => id);
    const faltanC = [...enRef].filter((x) => !enRes.has(x));
    const sobranC = [...enRes].filter((x) => !enRef.has(x));
    comprobar(nombre('conexiones'), faltanC.length === 0 && sobranC.length === 0, { faltan: faltanC, sobran: sobranC });
  }
}

plantasRef.forEach((p, k) => {
  if (plantasRes[k]) puntuarPlanta(p, plantasRes[k], varias ? `planta ${k}` : '');
});

// Posición de cada planta de arriba respecto a la de abajo (revisión independiente de la ronda 5, 14): la esquina
// de la caja de sus estancias, con la alineación de la planta de abajo, dentro de la tolerancia de medidas.
plantasRef.forEach((p, k) => {
  if (k === 0 || !plantasRes[k]) return;
  const a = caja(p.estancias);
  const b = N.cajaContorno(plantasRes[k].estancias.flatMap((s) => mover(s.contorno)));
  const desvio = [];
  for (const [eje, ra, rb, dim] of [['x', a.minX, b.minX, a.maxX - a.minX], ['y', a.minY, b.minY, a.maxY - a.minY]]) {
    const tol = modo === 'cotas' ? Math.max(0.02 * dim, 5) : modo === 'medida' ? 0.1 * dim : 0.15 * dim;
    desvio.push({ eje, error: Math.round(Math.abs(rb - ra) * 10) / 10, tolerancia: Math.round(tol * 10) / 10, ok: Math.abs(rb - ra) <= tol });
  }
  comprobar(`planta ${k}: posición`, desvio.every((d) => d.ok), desvio);
});

// Escaleras (ronda 5): cada escalera de la referencia tiene en el resultado, en la misma planta, una que
// llega a la planta de encima y cuya huella cubre al menos el 50 % de la suya.
plantasRef.forEach((pRef, k) => {
  for (const er of pRef.escaleras ?? []) {
    const pRes = plantasRes[k];
    const arriba = plantasRes[k + 1];
    const huellaRef = N.geometriaDe(ref, pRef, er).huella;
    const aRef = huellaRef.reduce((t, h) => t + area(h), 0);
    let mejor = 0;
    for (const es of pRes?.escaleras ?? []) {
      if (!arriba || (es.hasta ?? arriba.id) !== arriba.id) continue;
      const huellaRes = N.geometriaDe(res, pRes, es).huella.map(mover);
      let cubierto = 0;
      for (const h of huellaRef) for (const g of huellaRes) cubierto += interseccion(h, g);
      mejor = Math.max(mejor, cubierto / aRef);
    }
    comprobar(`escalera ${er.id}`, mejor >= 0.5, { cubre: Math.round(mejor * 100) / 100 });
  }
});
informe.ok = informe.comprobaciones.every((c) => c.ok);
console.log(JSON.stringify(informe, null, 1));
process.exit(informe.ok ? 0 : 1);
