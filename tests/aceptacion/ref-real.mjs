import { writeFileSync } from 'node:fs';
// Aceptación final (R2-7e): referencia aproximada del plano real (plano-real.jpg, Wikimedia Commons,
// dominio público). Uso: node tests/aceptacion/ref-real.mjs (tras `npm run build`).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';
// Medidas tomadas a mano sobre la imagen (px), escala dada en el encargo: la casa mide 15 m de
// fachada oeste a fachada este por fuera (749 px).
const s = 1500 / 749;
const c = (pts) => pts.map(([x, y]) => [Math.round(x * s * 10) / 10, Math.round(y * s * 10) / 10]);
const r = (x0, y0, x1, y1) => c([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const e = N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'Plano real (referencia aproximada)', plantas: [{ id: 'pb', grosorExterior: 20, estancias: [
  // Puertas medidas en la imagen (px × escala): sólo las cuatro conexiones que se puntúan.
  { id: 'cocina', nombre: 'Eat-in Kitchen', contorno: c([[41, 132], [90, 132], [90, 97], [137, 25], [228, 25], [276, 88], [276, 158], [292, 158], [292, 302], [41, 302]]),
    huecos: [{ id: 'p-cocina', tipo: 'puerta', muro: 8, desde: Math.round(45 * s), ancho: 74 }] },
  { id: 'despensa', nombre: 'Pantry', contorno: r(41, 307, 172, 342) },
  { id: 'lavadero', nombre: 'Laundry Storage', contorno: c([[41, 347], [175, 347], [175, 445], [150, 445], [150, 540], [41, 540]]) },
  { id: 'aseo', nombre: '1/2 Bath', contorno: r(158, 448, 292, 540) },
  { id: 'distribuidor', nombre: 'Distribuidor (sin rótulo)', contorno: r(178, 307, 292, 445) },
  { id: 'salon', nombre: 'Formal Living / Formal Dining', contorno: c([[297, 160], [538, 160], [538, 132], [767, 132], [767, 367], [297, 367]]),
    huecos: [{ id: 'p-salon-recibidor', tipo: 'puerta', muro: 4, desde: Math.round(387 * s), ancho: 130 }, { id: 'p-salon-familia', tipo: 'puerta', muro: 4, desde: Math.round(161 * s), ancho: 80 }] },
  { id: 'recibidor', nombre: 'Entrance', contorno: r(297, 372, 533, 540), huecos: [{ id: 'entrada', tipo: 'puerta', muro: 2, desde: Math.round(88 * s), ancho: 100 }] },
  { id: 'familia', nombre: 'Family', contorno: r(538, 372, 767, 540) },
], muebles: [] }] });
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ref-real.espacio.json'), N.aJSON(e));
console.log(e.plantas[0].estancias.map((x) => { const b = N.cajaContorno(x.contorno); return `${x.id} ${Math.round(b.maxX - b.minX)}x${Math.round(b.maxY - b.minY)}`; }).join('; '));
