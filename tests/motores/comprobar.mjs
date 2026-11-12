// Comprobación del .glb de Espacios 3D en un motor y en un programa 3D reales. No forma parte de
// «npm run check» porque necesita Godot y Blender instalados en el ordenador. Uso: npm run motores
// - Godot 4: importa el .glb exportado con --colisiones godot, cuenta cuerpos y formas de colisión y lanza
//   rayos hacia abajo: el suelo de arriba frena y por el hueco de la escalera se cae sobre ella. Luego un
//   personaje de 1,75 m sube andando la escalera hasta la planta de arriba y, de control, uno de 2,4 m
//   (no cabe bajo el forjado) se queda atascado: así se ve que la prueba también sabe fallar.
// - Blender: importa el .glb visible y comprueba nombres de nodos, medidas del sofá y materiales.
// Rutas: GODOT y BLENDER en el entorno o, si no, las de una instalación con winget.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLI = join(AQUI, '..', '..', 'dist', 'Espacios3D', 'espacios3d.mjs');
const N = await import(pathToFileURL(join(AQUI, '..', '..', 'build', 'core.mjs')).href);
const local = process.env.LOCALAPPDATA ?? '';

function enCarpeta(dir, re) {
  try {
    const f = readdirSync(dir).find((x) => re.test(x));
    return f ? join(dir, f) : null;
  } catch {
    return null;
  }
}
function buscar(variable, candidatos) {
  if (process.env[variable] && existsSync(process.env[variable])) return process.env[variable];
  return candidatos.find((c) => c && existsSync(c)) ?? null;
}
const godot = buscar('GODOT', [enCarpeta(join(local, 'Microsoft', 'WinGet', 'Packages', 'GodotEngine.GodotEngine_Microsoft.Winget.Source_8wekyb3d8bbwe'), /_console\.exe$/)]);
const carpetaBlender = enCarpeta('C:\\Program Files\\Blender Foundation', /^Blender/);
const blender = buscar('BLENDER', [carpetaBlender && join(carpetaBlender, 'blender.exe')]);

let fallos = 0;
const comprobar = (ok, mensaje) => {
  console.log(`${ok ? '  ok   ' : '  FALLO'} ${mensaje}`);
  if (!ok) fallos++;
};
const ejecutar = (exe, args) => {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 300000, windowsHide: true });
  const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const linea = salida.split(/\r?\n/).find((l) => l.startsWith('RESULTADO '));
  return { estado: r.status, salida, resultado: linea ? JSON.parse(linea.slice('RESULTADO '.length)) : null };
};

// Casa de dos plantas con una escalera en L, un sofá, una ventana y una puerta (la de r27d).
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const casa = {
  formato: 'espacios3d', version: 2, nombre: 'Casa',
  plantas: [
    { id: 'pb', nivel: 0, grosorExterior: 15, estancias: [
      { id: 'salon', contorno: rect(0, 0, 400, 460), altura: 260, huecos: [{ id: 'pta', tipo: 'puerta', muro: 1, desde: 100, ancho: 80 }, { id: 'v1', tipo: 'ventana', muro: 0, desde: 100, ancho: 120 }] },
      { id: 'cocina', contorno: rect(410, 0, 700, 460), altura: 260 },
    ], muebles: [{ id: 'sofa', tipo: 'sofa', ancho: 200, fondo: 90, alto: 85, x: 150, y: 200 }],
    escaleras: [{ id: 'esc', forma: 'L', x: 600, y: 60, ancho: 90, tramos: [250, 120], gira: 'derecha', hasta: 'p1' }] },
    { id: 'p1', nivel: 290, grosorExterior: 15, estancias: [{ id: 'arriba', contorno: rect(0, 0, 700, 460), altura: 250 }], muebles: [] },
  ],
};

const dir = mkdtempSync(join(tmpdir(), 'espacios3d-motores-'));
try {
  writeFileSync(join(dir, 'casa.espacio.json'), JSON.stringify(casa));
  for (const [extra, nombre] of [[['--colisiones', 'godot'], 'casa-godot.glb'], [[], 'casa.glb']]) {
    const r = spawnSync(process.execPath, [CLI, 'exportar', join(dir, 'casa.espacio.json'), '--glb', join(dir, nombre), ...extra], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`exportar ${nombre}: ${r.stdout}${r.stderr}`);
  }

  console.log(`Godot: ${godot ?? 'no encontrado'}`);
  if (!godot) comprobar(false, 'Godot está instalado (o GODOT apunta a él)');
  else {
    const proyecto = join(dir, 'godot');
    mkdirSync(proyecto);
    for (const f of ['project.godot', 'comprobar.gd']) copyFileSync(join(AQUI, 'godot', f), join(proyecto, f));
    copyFileSync(join(dir, 'casa-godot.glb'), join(proyecto, 'casa.glb'));
    const imp = ejecutar(godot, ['--headless', '--path', proyecto, '--import']);
    comprobar(existsSync(join(proyecto, '.godot', 'imported')), `Godot importa el .glb (código ${imp.estado})`);
    // Rayos [nombre, X, Z] en metros (la planta (x, y) cm va a (X, Z) m), desde 20 m hacia abajo.
    const rayos = [['suelo_arriba', 1.0, 3.0], ['hueco_escalera', 6.0, 3.55]];
    // Camino del personaje (m), sacado de la geometría de la escalera: delante del pie, cada tramo, la
    // meseta y, tras la llegada, 80 cm ya en la planta de arriba.
    const e = N.validarOLanzar(casa);
    const geo = N.geometriaDe(e, e.plantas[0], e.plantas[0].escaleras[0]);
    const [t1, t2] = geo.tramos;
    const fin = (t) => [t.inicio[0] + t.dir[0] * t.largo, t.inicio[1] + t.dir[1] * t.largo];
    const centro = (r) => [r.reduce((a, q) => a + q[0], 0) / r.length, r.reduce((a, q) => a + q[1], 0) / r.length];
    const llegada = fin(t2);
    const camino = [
      [t1.inicio[0] - geo.entrada[0] * 25, t1.inicio[1] - geo.entrada[1] * 25], t1.inicio, fin(t1), centro(geo.meseta.rect), t2.inicio, llegada,
      [llegada[0] + geo.salida[0] * 80, llegada[1] + geo.salida[1] * 80],
    ].map(([x, y]) => [x / 100, y / 100]);
    const andar = { camino, altos: [1.75, 2.4] };
    const r = ejecutar(godot, ['--headless', '--fixed-fps', '60', '--path', proyecto, '--script', 'res://comprobar.gd', '--', `--rayos=${JSON.stringify(rayos)}`, `--andar=${JSON.stringify(andar)}`]);
    const res = r.resultado;
    comprobar(!!res, `Godot carga la escena y ejecuta la comprobación${res ? '' : `: ${r.salida.slice(-600)}`}`);
    if (res) {
      comprobar(res.cuerpos >= 10, `crea cuerpos estáticos a partir de los sufijos (${res.cuerpos})`);
      comprobar(res.concavas >= 4 && res.convexas >= 4, `con formas cóncavas (muros y suelos: ${res.concavas}) y convexas (rampas, muebles, barandillas: ${res.convexas})`);
      const y = res.rayos;
      comprobar(typeof y.suelo_arriba === 'number' && Math.abs(y.suelo_arriba - 2.9) < 0.03, `un rayo sobre la planta de arriba choca con su suelo (${y.suelo_arriba} m)`);
      comprobar(typeof y.hueco_escalera === 'number' && y.hueco_escalera > 0.5 && y.hueco_escalera < 2.8, `por el hueco de la escalera se llega a ella, no al suelo de arriba (${y.hueco_escalera} m)`);
      const [bajo, alto] = res.personajes ?? [];
      const zMeseta = geo.meseta.z / 100;
      comprobar(!!bajo && bajo.llega && bajo.en_suelo && Math.abs(bajo.final[1] - 2.9) < 0.05,
        `un personaje de 1,75 m sube andando la escalera y acaba de pie en la planta de arriba (${JSON.stringify(bajo)})`);
      comprobar(!!bajo && typeof bajo.alturas[2] === 'number' && Math.abs(bajo.alturas[2] - zMeseta) < 0.05, `pasa por el centro de la meseta a su altura (${bajo?.alturas[2]} m, la meseta está a ${zMeseta} m)`);
      comprobar(!!alto && !alto.llega && alto.final[1] < 1.5, `de control, uno de 2,4 m no cabe bajo el forjado y se queda abajo (${JSON.stringify(alto)})`);
    }
  }

  console.log(`Blender: ${blender ?? 'no encontrado'}`);
  if (!blender) comprobar(false, 'Blender está instalado (o BLENDER apunta a él)');
  else {
    const r = ejecutar(blender, ['-b', '--factory-startup', '--python', join(AQUI, 'blender', 'comprobar.py'), '--', join(dir, 'casa.glb'), 'sofa']);
    const res = r.resultado;
    comprobar(!!res, `Blender importa el .glb${res ? '' : `: ${r.salida.slice(-600)}`}`);
    if (res) {
      for (const n of ['planta-pb', 'planta-p1', 'suelo-salon', 'muros-pb', 'escalera-esc', 'hueco-esc', 'forjado-p1', 'sofa']) comprobar(res.objetos.includes(n), `tiene el objeto «${n}»`);
      const s = res.medidas.sofa;
      comprobar(!!s && Math.abs(s[0] - 2) < 0.01 && Math.abs(s[1] - 0.9) < 0.01 && Math.abs(s[2] - 0.85) < 0.01, `el sofá mide 2 × 0,9 × 0,85 m en Blender (${JSON.stringify(s)})`);
      comprobar(res.materiales.length >= 2, `con sus materiales (${res.materiales.length})`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(fallos ? `\nFALLAN ${fallos}` : '\nTODO BIEN');
process.exit(fallos ? 1 : 0);
