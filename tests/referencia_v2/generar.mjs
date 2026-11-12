// Genera la casa de referencia v2 (ronda 5, R5-3) con el CLI. Se ejecutó una vez (12/11/2026) y su
// resultado está congelado en esta carpeta: las pruebas comprueban que las versiones futuras la siguen
// leyendo igual (tests/unit/r5.test.mjs). No regenerar salvo que cambie el formato a propósito.
// Uso: node tests/referencia_v2/generar.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';
import { codificarPNG } from '../../build/png.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLI = join(AQUI, '..', '..', 'dist', 'Espacios3D', 'espacios3d.mjs');
const casa = join(AQUI, 'casa', 'casa.espacio.json');
const cli = (...a) => {
  const r = spawnSync(process.execPath, [CLI, ...a, '--json'], { encoding: 'utf8', cwd: dirname(casa) });
  if (r.status !== 0 && r.status !== 1) throw new Error(`${a.join(' ')}: ${r.stdout}${r.stderr}`);
  return JSON.parse(r.stdout);
};

rmSync(join(AQUI, 'casa'), { recursive: true, force: true });
for (const d of ['planos', 'fotos', 'modelos']) mkdirSync(join(AQUI, 'casa', d), { recursive: true });
// Plano de fondo: 200 × 160 px, marco oscuro sobre blanco. Foto: 16 × 16 verde. Modelo: un .glb pequeño.
const plano = new Uint8Array(200 * 160 * 4).fill(255);
for (let y = 0; y < 160; y++) for (let x = 0; x < 200; x++) if (x < 3 || y < 3 || x > 196 || y > 156) plano.set([30, 30, 30, 255], (y * 200 + x) * 4);
writeFileSync(join(AQUI, 'casa', 'planos', 'plano.png'), codificarPNG(plano, 200, 160));
const foto = new Uint8Array(16 * 16 * 4);
for (let i = 0; i < 256; i++) foto.set([40, 160, 70, 255], i * 4);
writeFileSync(join(AQUI, 'casa', 'fotos', 'salon.png'), codificarPNG(foto, 16, 16));
writeFileSync(join(AQUI, 'casa', 'modelos', 'sillon.glb'), N.espacioAGLB(N.nuevoEspacio({ ancho: 80, largo: 80 }), 'referencia'));

const f = 'casa.espacio.json';
cli('nuevo', f, '--ancho', '450', '--largo', '380', '--nombre', 'Casa de referencia');
cli('estancia', f, '--estancia', 'estancia', '--nombre', 'Salón', '--suelo', 'parquet', '--color-suelo', 'b98a5a', '--paredes', 'f2e6d0');
cli('estancia', 'agregar', f, '--id', 'cocina', '--nombre', 'Cocina', '--x', '460', '--y', '0', '--ancho', '300', '--largo', '380');
cli('estancia', 'agregar', f, '--id', 'pasillo', '--nombre', 'Pasillo', '--x', '0', '--y', '390', '--ancho', '760', '--largo', '120');
cli('estancia', f, '--estancia', 'cocina', '--suelo', 'baldosa');
cli('hueco', 'agregar', f, '--estancia', 'estancia', '--tipo', 'ventana', '--muro', '0', '--desde', '100', '--ancho', '120', '--id', 'ventana-salon');
cli('hueco', 'agregar', f, '--estancia', 'estancia', '--tipo', 'puerta', '--muro', '1', '--desde', '40', '--ancho', '80', '--id', 'puerta-cocina');
cli('hueco', 'agregar', f, '--estancia', 'estancia', '--tipo', 'paso', '--muro', '2', '--desde', '300', '--ancho', '90', '--id', 'paso-salon');
cli('hueco', 'agregar', f, '--estancia', 'pasillo', '--tipo', 'puerta', '--muro', '3', '--desde', '20', '--ancho', '90', '--id', 'entrada');
cli('agregar', f, '--estancia', 'estancia', '--tipo', 'sofa', '--id', 'sofa', '--muro', '3', '--desde', '80');
cli('agregar', f, '--estancia', 'estancia', '--tipo', 'mesa', '--id', 'mesa', '--x', '250', '--y', '200', '--ancho', '120', '--fondo', '80', '--alto', '75',
  '--piezas', JSON.stringify([{ forma: 'caja', ancho: 120, fondo: 80, alto: 4, z: 71 }, { forma: 'cilindro', ancho: 8, fondo: 8, alto: 71, x: -50, y: -30 }, { forma: 'cilindro', ancho: 8, fondo: 8, alto: 71, x: 50, y: 30 }]));
cli('agregar', f, '--estancia', 'estancia', '--tipo', 'cuadro', '--id', 'cuadro');
cli('agregar', f, '--estancia', 'estancia', '--tipo', 'butaca', '--id', 'sillon', '--x', '380', '--y', '300', '--modelo', 'modelos/sillon.glb');
cli('elemento', 'agregar', f, '--estancia', 'estancia', '--forma', 'adosado', '--tipo', 'radiador', '--muro', '0', '--desde', '300', '--ancho', '80', '--fondo', '10', '--alto', '60', '--elevacion', '15', '--id', 'radiador');
cli('elemento', 'agregar', f, '--estancia', 'pasillo', '--forma', 'punto', '--tipo', 'enchufe', '--muro', '0', '--desde', '300', '--altura', '30', '--id', 'enchufe');
cli('planta', 'agregar', f, '--copiar-de', 'planta-baja', '--id', 'p1', '--nombre', 'Primera', '--con-ventanas', 'true');
cli('escalera', 'agregar', f, '--planta', 'planta-baja', '--forma', 'L', '--x', '700', '--y', '70', '--ancho', '80', '--tramos', '230,120', '--gira', 'derecha', '--id', 'escalera', '--hasta', 'p1');
const r = cli('resumen', f);
const arriba = r.plantas.find((p) => p.id === 'p1').estancias[0].id;
cli('faldon', 'poner', f, '--estancia', arriba, '--muro', '0', '--altura-en-muro', '150', '--alcance', '150');
cli('fondo', 'poner', f, '--imagen', 'planos/plano.png', '--id', 'plano');
cli('fondo', 'calibrar', f, '--id', 'plano', '--puntos', '0,0,200,0', '--distancia', '770', '--en', '-5,-5');
cli('foto', 'agregar', f, '--para', 'estancia', '--foto', 'fotos/salon.png');
cli('distribucion', 'guardar', f, '--nombre', 'Base');
const inc = cli('analizar', f);
console.log(`Hecha: ${r.plantas.length} plantas; incidencias: ${inc.incidencias.length} (${inc.incidencias.filter((x) => x.gravedad === 'error').length} errores)`);
for (const x of inc.incidencias) console.log(`  ${x.gravedad}: ${x.mensaje}`);
// Lo que las versiones futuras deben seguir dando con esta casa.
mkdirSync(join(AQUI, 'esperado'), { recursive: true });
writeFileSync(join(AQUI, 'esperado', 'resumen.json'), `${JSON.stringify(cli('resumen', f), null, 1)}\n`);
writeFileSync(join(AQUI, 'esperado', 'analizar.json'), `${JSON.stringify(inc, null, 1)}\n`);
writeFileSync(join(AQUI, 'esperado', 'describir.json'), `${JSON.stringify(cli('describir', f), null, 1)}\n`);
