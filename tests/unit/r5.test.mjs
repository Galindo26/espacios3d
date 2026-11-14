// Ronda 5 (docs/PLAN_R5.md): «abrir» en el CLI y en el MCP, la página con la casa dentro (almacén y
// reconocimiento del archivo), la vinculación que conserva lo pendiente y los planos JPEG en el calco.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import * as N from '../../build/core.mjs';
import { almacenConAbierto, nombreLibre, rutaEnCarpetaElegida } from '../../build/abierto.mjs';
import { decodificarJPEG } from '../../build/jpeg.mjs';
import { codificarPNG } from '../../build/png.mjs';
import { Sincronizador } from '../../build/sincronia.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(RAIZ, 'dist', 'Espacios3D', 'espacios3d.mjs');
const temporales = [];
after(() => {
  for (const t of temporales) rmSync(t, { recursive: true, force: true });
});
const tmp = (p = 'espacios3d-r5-') => {
  const d = mkdtempSync(join(tmpdir(), p));
  temporales.push(d);
  return d;
};
const cli = (args, env = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ESPACIOS3D_NO_LANZAR: '1', ...env } });
  return { codigo: r.status, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })(), salida: r.stdout + r.stderr };
};
const png = (w, h, rgb = [200, 30, 30]) => {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([...rgb, 255], i * 4);
  return codificarPNG(d, w, h);
};
/** Los datos que la página lee de window.__ESPACIOS3D_ABIERTO__. */
const datosDe = (html) => {
  const marca = '<script>window.__ESPACIOS3D_ABIERTO__=';
  assert.equal(html.split(marca).length, 2, 'una sola vez');
  const i = html.indexOf(marca) + marca.length;
  return JSON.parse(html.slice(i, html.indexOf(';</script>', i)));
};

/** Casa en una carpeta: plano de fondo PNG, foto de una estancia y modelo de un mueble. */
function casaConArchivos() {
  const dir = tmp();
  mkdirSync(join(dir, 'planos'));
  mkdirSync(join(dir, 'fotos'));
  mkdirSync(join(dir, 'modelos'));
  writeFileSync(join(dir, 'planos', 'piso.png'), png(40, 30));
  writeFileSync(join(dir, 'fotos', 'salon.png'), png(8, 8, [10, 200, 10]));
  writeFileSync(join(dir, 'modelos', 'sofa.glb'), N.espacioAGLB(N.nuevoEspacio({ ancho: 100, largo: 100 }), 'prueba'));
  const f = join(dir, 'casa.espacio.json');
  for (const a of [
    ['nuevo', f, '--ancho', '400', '--largo', '300', '--nombre', 'Casa'],
    ['fondo', 'poner', f, '--imagen', 'planos/piso.png', '--id', 'plano'],
    ['foto', 'agregar', f, '--para', 'estancia', '--foto', 'fotos/salon.png'],
    ['agregar', f, '--tipo', 'sofa', '--id', 'sofa', '--modelo', 'modelos/sofa.glb'],
  ]) {
    const r = cli([...a, '--json']);
    assert.ok(r.codigo === 0 || r.codigo === 1, `${a.join(' ')}: ${r.salida}`);
  }
  return { dir, f };
}

describe('abrir en el CLI', () => {
  test('sin archivo: la página de la entrega tal cual, sin lanzar el navegador', () => {
    const r = cli(['abrir', '--json']);
    assert.equal(r.codigo, 0, r.salida);
    assert.equal(r.json.pagina, join(RAIZ, 'dist', 'Espacios3D', 'Espacios3D.html'));
    assert.equal(r.json.lanzado, false);
    assert.equal(r.json.archivo, null);
  });

  test('con archivo: una copia con el texto exacto y los archivos (fondos, modelos y fotos) dentro', () => {
    const { f } = casaConArchivos();
    const texto = readFileSync(f, 'utf8');
    const r = cli(['abrir', f, '--no-lanzar', '--json'], { ESPACIOS3D_NO_LANZAR: '' });
    assert.equal(r.codigo, 0, r.salida);
    assert.equal(r.json.lanzado, false);
    assert.deepEqual(r.json.incluidos, ['planos/piso.png', 'modelos/sofa.glb', 'fotos/salon.png']);
    assert.deepEqual(r.json.omitidos, []);
    assert.match(r.json.pagina, /espacios3d[\\/]casa-[0-9a-f]{12}\.html$/);
    const html = readFileSync(r.json.pagina, 'utf8');
    const d = datosDe(html);
    assert.equal(d.texto, texto, 'el texto tal cual está en el disco');
    assert.equal(d.nombre, 'casa.espacio.json');
    assert.ok(Buffer.from(d.archivos['planos/piso.png'].datos, 'base64').equals(readFileSync(join(dirname(f), 'planos', 'piso.png'))));
    assert.equal(d.archivos['modelos/sofa.glb'].tipo, 'model/gltf-binary');
    assert.equal(readFileSync(f, 'utf8'), texto, 'no toca el archivo');
    // La misma casa vuelve a la misma copia (no se llena la carpeta temporal).
    assert.equal(cli(['abrir', f, '--json']).json.pagina, r.json.pagina);
  });

  test('un nombre con </script>, <!-- y $& no rompe la página', () => {
    const dir = tmp();
    const f = join(dir, 'raro.espacio.json');
    const nombre = 'Casa </script><!-- $& $1 \u2028 ñ';
    assert.equal(cli(['nuevo', f, '--ancho', '300', '--largo', '300', '--nombre', nombre, '--json']).codigo, 0);
    const r = cli(['abrir', f, '--json']);
    const html = readFileSync(r.json.pagina, 'utf8');
    const d = datosDe(html);
    assert.equal(JSON.parse(d.texto).nombre, nombre);
    const i = html.indexOf('window.__ESPACIOS3D_ABIERTO__=');
    const trozo = html.slice(i, html.indexOf(';</script>', i));
    assert.ok(!/[<>\u2028]/.test(trozo), 'sin < ni > ni U+2028 en el script');
  });

  test('tope de tamaño y enlaces que salen de la carpeta: se omiten con su motivo', () => {
    const { dir, f } = casaConArchivos();
    const r = cli(['abrir', f, '--json'], { ESPACIOS3D_TOPE_INCRUSTADO: '2000' });
    assert.ok(r.json.incluidos.length < 3, JSON.stringify(r.json));
    assert.ok(r.json.omitidos.some((o) => /no cabe/.test(o.motivo)), JSON.stringify(r.json.omitidos));
    // Un fondo que apunta a una unión hacia fuera de la carpeta.
    const fuera = tmp('espacios3d-fuera-');
    writeFileSync(join(fuera, 'secreto.png'), png(4, 4));
    try {
      symlinkSync(fuera, join(dir, 'enlace'), 'junction');
    } catch {
      return; // sin permiso para enlaces: esta parte se salta
    }
    const e = JSON.parse(readFileSync(f, 'utf8'));
    e.plantas[0].fondos[0].archivo = 'enlace/secreto.png';
    writeFileSync(f, JSON.stringify(e));
    const r2 = cli(['abrir', f, '--json']);
    assert.equal(r2.codigo, 0, r2.salida);
    assert.ok(!r2.json.incluidos.includes('enlace/secreto.png'));
    assert.match(r2.json.omitidos.find((o) => o.ruta === 'enlace/secreto.png').motivo, /fuera de la carpeta/);
  });

  test('v1: se abre sin convertir nada en el disco; inválido: código 2; --salida', () => {
    const dir = tmp();
    const f = join(dir, 'viejo.espacio.json');
    copyFileSync(join(RAIZ, 'tests', 'referencia_v1', 'rectangular', 'espacio.v1.json'), f);
    const antes = readFileSync(f);
    const salida = join(dir, 'ver.html');
    const r = cli(['abrir', f, '--salida', salida, '--json']);
    assert.equal(r.codigo, 0, r.salida);
    assert.equal(r.json.pagina, salida);
    assert.ok(existsSync(salida));
    assert.ok(readFileSync(f).equals(antes), 'el v1 sigue igual');
    assert.deepEqual(readdirSync(dir).sort(), ['ver.html', 'viejo.espacio.json'], 'sin copia .v1 ni nada más');
    writeFileSync(join(dir, 'malo.espacio.json'), '{"formato": "espacios3d", "version": 2}');
    assert.equal(cli(['abrir', join(dir, 'malo.espacio.json'), '--json']).codigo, 2);
    assert.equal(cli(['abrir', f, '--salida', 'x.txt', '--json']).codigo, 3);
  });

  test('sin Espacios3D.html junto al CLI, o de otra versión: error claro (código 3)', () => {
    const dir = tmp();
    copyFileSync(CLI, join(dir, 'espacios3d.mjs'));
    const f = join(dir, 'c.espacio.json');
    writeFileSync(f, N.aJSON(N.nuevoEspacio({ ancho: 300, largo: 300 })));
    const correr = (a) => spawnSync(process.execPath, [join(dir, 'espacios3d.mjs'), ...a], { encoding: 'utf8', env: { ...process.env, ESPACIOS3D_NO_LANZAR: '1' } });
    let r = correr(['abrir', f, '--json']);
    assert.equal(r.status, 3);
    assert.match(r.stdout + r.stderr, /Espacios3D\.html/);
    writeFileSync(join(dir, 'Espacios3D.html'), '<!doctype html><title>vieja</title><script></script>');
    r = correr(['abrir', f, '--json']);
    assert.equal(r.status, 3);
    assert.match(r.stdout + r.stderr, /no es de esta versi/);
  });
});

describe('la página con la casa dentro (sin DOM)', () => {
  const datos = { version: 1, texto: '{}', nombre: 'casa.espacio.json', ruta: 'C:\\Users\\X\\Espacios3D\\espacios\\casa.espacio.json', copiadaEn: '', archivos: { 'planos/p.png': { tipo: 'image/png', datos: Buffer.from([1, 2, 3]).toString('base64') } }, omitidos: [] };

  test('reconoce el archivo por el final de su ruta, nunca sólo por el nombre', () => {
    assert.equal(rutaEnCarpetaElegida(datos, { nombre: 'espacios', archivos: ['casa.espacio.json', 'otra.espacio.json'] }), 'casa.espacio.json');
    assert.equal(rutaEnCarpetaElegida(datos, { nombre: 'Espacios3D', archivos: ['espacios/casa.espacio.json'] }), 'espacios/casa.espacio.json');
    assert.equal(rutaEnCarpetaElegida(datos, { nombre: 'Otra', archivos: ['casa.espacio.json'] }), null, 'homónimo en otra carpeta');
    assert.equal(rutaEnCarpetaElegida(datos, { nombre: 'Espacios3D', archivos: ['casa.espacio.json'] }), null, 'mismo nombre, otra subcarpeta');
    assert.equal(rutaEnCarpetaElegida({ ...datos, ruta: '/home/x/espacios/casa.espacio.json' }, { nombre: 'espacios', archivos: ['casa.espacio.json'] }), 'casa.espacio.json');
  });

  test('nombre libre para «guardar lo mío en otro archivo»', () => {
    assert.equal(nombreLibre('casa.espacio.json', ['casa.espacio.json']), 'casa-mio.espacio.json');
    assert.equal(nombreLibre('casa.espacio.json', ['casa-mio.espacio.json', 'Casa-Mio-2.espacio.json']), 'casa-mio-3.espacio.json');
  });

  test('almacén: los archivos relativos salen de la página hasta vincular; después, del almacén real', async () => {
    let vinculado = false;
    const real = {
      tipo: 'prueba',
      vinculado: () => vinculado,
      nombreArchivo() {
        return this === real ? 'real' : 'otro this';
      },
      leerRelativo: async () => 'del disco',
    };
    const a = almacenConAbierto(real, datos);
    const b = await a.leerRelativo('planos/p.png');
    assert.deepEqual([...new Uint8Array(await b.arrayBuffer())], [1, 2, 3]);
    assert.equal(b.type, 'image/png');
    assert.equal(await a.leerRelativo('no/esta.png'), null);
    assert.equal(a.nombreArchivo(), 'real', 'los métodos van con su almacén');
    assert.equal(a.carpeta, undefined, 'sin carpeta: nada cree que puede escribir junto al espacio');
    vinculado = true;
    assert.equal(await a.leerRelativo('planos/p.png'), 'del disco');
  });
});

describe('vincularConservando', () => {
  function montar(textoDisco) {
    const disco = { texto: textoDisco, lm: 1, escrituras: 0 };
    let nombre = null;
    const almacen = {
      tipo: 'prueba',
      nombreArchivo: () => nombre,
      vinculado: () => nombre !== null,
      guardar: async (t) => {
        disco.texto = t;
        disco.lm++;
        disco.escrituras++;
      },
      leer: async () => (nombre ? { texto: disco.texto, lm: disco.lm } : null),
    };
    const reg = { programados: [], guardados: 0, estados: [] };
    const reloj = { poner: (f, ms) => (reg.programados.push(ms), f), quitar: () => {}, hora: () => '10:00' };
    const sinc = new Sincronizador(almacen, { estado: (t) => reg.estados.push(t), cargar: () => {}, bloqueo: () => {}, guardado: () => reg.guardados++, arrastrando: () => false }, reloj, 600);
    const leido = { texto: textoDisco, nombre: 'casa.espacio.json', aceptar: async () => void (nombre = 'casa.espacio.json') };
    return { disco, sinc, reg, leido };
  }
  const e1 = N.nuevoEspacio({ ancho: 300, largo: 300, nombre: 'Uno' });
  const e2 = N.nuevoEspacio({ ancho: 300, largo: 300, nombre: 'Dos' });

  test('sin cambios: vincula sin escribir', async () => {
    const c = montar(N.aJSON(e1));
    c.sinc.establecer(e1);
    await c.sinc.vincularConservando(c.leido);
    assert.equal(c.sinc.pendiente, false);
    assert.equal(c.disco.escrituras, 0);
    assert.equal(c.reg.guardados, 1);
  });

  test('con cambios: los conserva y los guarda sobre el archivo (vincular() los descartaría)', async () => {
    const c = montar(N.aJSON(e1));
    c.sinc.establecer(e1);
    c.sinc.cambioLocal(e2);
    await c.sinc.vincularConservando(c.leido);
    assert.equal(c.sinc.pendiente, true, 'lo pendiente sigue');
    assert.deepEqual(c.reg.programados.slice(-1), [0], 'guardado programado en seguida');
    await c.sinc.guardarAhora();
    assert.equal(JSON.parse(c.disco.texto).nombre, 'Dos');
    assert.equal(c.sinc.pendiente, false);
  });

  test('si el disco cambia entre vincular y guardar, gana el disco como siempre', async () => {
    const c = montar(N.aJSON(e1));
    c.sinc.establecer(e1);
    c.sinc.cambioLocal(e2);
    await c.sinc.vincularConservando(c.leido);
    c.disco.texto = N.aJSON(N.nuevoEspacio({ ancho: 300, largo: 300, nombre: 'Agente' }));
    c.disco.lm++;
    await c.sinc.guardarAhora();
    assert.equal(JSON.parse(c.disco.texto).nombre, 'Agente', 'no se pisa al agente');
  });
});

describe('planos JPEG en el calco', () => {
  /** JPEG de 32 × 16: mitad izquierda roja, derecha azul; con orientación EXIF si se pide. */
  const jpg = (orientacion) => {
    const w = 32;
    const h = 16;
    const d = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(x < w / 2 ? [220, 20, 20, 255] : [20, 20, 220, 255], (y * w + x) * 4);
    const b = jpeg.encode({ data: d, width: w, height: h }, 95).data;
    if (!orientacion) return b;
    // APP1 «Exif» mínimo (TIFF big-endian, un IFD con la etiqueta 0x0112) justo detrás de SOI.
    const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientacion, 0, 0, 0, 0, 0, 0, 0, 0]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0, tiff.length + 8]), Buffer.from('Exif\0\0', 'latin1'), tiff]);
    return Buffer.concat([b.subarray(0, 2), app1, b.subarray(2)]);
  };
  const color = (r, x, y) => Array.from(r.rgba.subarray((y * r.ancho + x) * 4, (y * r.ancho + x) * 4 + 3));
  const rojo = (c) => c[0] > 150 && c[2] < 100;
  const azul = (c) => c[2] > 150 && c[0] < 100;

  test('se decodifica tal como se ve, con la orientación EXIF aplicada', () => {
    const r0 = decodificarJPEG(jpg(0));
    assert.deepEqual([r0.ancho, r0.alto], [32, 16]);
    assert.ok(rojo(color(r0, 4, 8)) && azul(color(r0, 28, 8)));
    // 6: girar 90° a la derecha para verla: la mitad izquierda (roja) queda arriba.
    const r6 = decodificarJPEG(jpg(6));
    assert.deepEqual([r6.ancho, r6.alto], [16, 32]);
    assert.ok(rojo(color(r6, 8, 4)) && azul(color(r6, 8, 28)), `${color(r6, 8, 4)} / ${color(r6, 8, 28)}`);
    // 8: girar 90° a la izquierda: la roja queda abajo.
    const r8 = decodificarJPEG(jpg(8));
    assert.ok(azul(color(r8, 8, 4)) && rojo(color(r8, 8, 28)));
    // 3: media vuelta: la roja queda a la derecha.
    const r3 = decodificarJPEG(jpg(3));
    assert.ok(azul(color(r3, 4, 8)) && rojo(color(r3, 28, 8)));
  });

  test('plano --png --sobre-fondo con un fondo JPEG (antes pedía convertirlo a PNG)', () => {
    const dir = tmp();
    const f = join(dir, 'c.espacio.json');
    writeFileSync(join(dir, 'plano.jpg'), jpg(6));
    assert.equal(cli(['nuevo', f, '--ancho', '300', '--largo', '300', '--json']).codigo, 0);
    assert.equal(cli(['fondo', 'poner', f, '--imagen', 'plano.jpg', '--id', 'p', '--json']).codigo, 0);
    const r = cli(['plano', f, '--png', join(dir, 'calco.png'), '--sobre-fondo', '--json']);
    assert.equal(r.codigo, 0, r.salida);
    assert.ok(existsSync(join(dir, 'calco.png')));
  });
});

describe('abrir por MCP', () => {
  test('herramienta «abrir»: con archivo, en blanco y fuera de la carpeta; la salida estándar es sólo JSON-RPC', async () => {
    const { dir } = casaConArchivos();
    const proc = spawn(process.execPath, [CLI, 'mcp', '--carpeta', dir], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ESPACIOS3D_NO_LANZAR: '1' } });
    let resto = '';
    const respuestas = new Map();
    const noJSON = [];
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => {
      resto += d;
      let i;
      while ((i = resto.indexOf('\n')) >= 0) {
        const l = resto.slice(0, i);
        resto = resto.slice(i + 1);
        if (!l.trim()) continue;
        try {
          const m = JSON.parse(l);
          respuestas.get(m.id)?.(m);
        } catch {
          noJSON.push(l);
        }
      }
    });
    let id = 0;
    const pedir = (method, params = {}) =>
      new Promise((res, rej) => {
        const n = ++id;
        // El temporizador se retira al llegar la respuesta: no queda vivo 20 s.
        const t = setTimeout(() => rej(new Error(`sin respuesta a ${method}`)), 20000);
        respuestas.set(n, (m) => (clearTimeout(t), res(m)));
        proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
      });
    try {
      await pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '0' } });
      const herramientas = (await pedir('tools/list')).result.tools;
      assert.ok(herramientas.some((t) => t.name === 'abrir' && !t.inputSchema.required));
      const conCasa = await pedir('tools/call', { name: 'abrir', arguments: { archivo: 'casa.espacio.json' } });
      const r = JSON.parse(conCasa.result.content[0].text);
      assert.equal(r.lanzado, false);
      assert.deepEqual(r.incluidos, ['planos/piso.png', 'modelos/sofa.glb', 'fotos/salon.png']);
      assert.equal(datosDe(readFileSync(r.pagina, 'utf8')).nombre, 'casa.espacio.json');
      const enBlanco = JSON.parse((await pedir('tools/call', { name: 'abrir', arguments: {} })).result.content[0].text);
      assert.match(enBlanco.pagina, /Espacios3D\.html$/);
      const fuera = await pedir('tools/call', { name: 'abrir', arguments: { archivo: '../otra.espacio.json' } });
      assert.ok(fuera.result.isError, JSON.stringify(fuera));
      assert.deepEqual(noJSON, [], 'nada que no sea JSON-RPC en la salida estándar');
    } finally {
      proc.stdin.end();
      proc.kill();
    }
  });
});

describe('casa de referencia v2 congelada (abrirla en el futuro)', () => {
  const DIR = join(RAIZ, 'tests', 'referencia_v2');
  const CASA = join(DIR, 'casa', 'casa.espacio.json');
  const esperado = (n) => JSON.parse(readFileSync(join(DIR, 'esperado', `${n}.json`), 'utf8'));

  test('tiene de todo: dos plantas, escalera en L, piezas, modelo, colgado, obra, faldón, acabados, fondo, foto y distribución', () => {
    const e = JSON.parse(readFileSync(CASA, 'utf8'));
    const [pb, p1] = e.plantas;
    assert.equal(e.plantas.length, 2);
    assert.equal(pb.escaleras[0].forma, 'L');
    assert.ok(pb.muebles.some((m) => m.piezas) && pb.muebles.some((m) => m.modelo) && pb.muebles.some((m) => m.elevacion > 0));
    assert.ok(pb.estancias.some((s) => s.elementos?.length) && p1.estancias.some((s) => s.faldones?.length));
    assert.ok(pb.estancias.some((s) => s.suelo) && pb.fondos?.length === 1 && pb.estancias.some((s) => s.fotos?.length));
    assert.equal(e.distribuciones.length, 1);
  });

  test('el código actual la lee igual: mismo texto al volver a escribirla, mismo resumen, análisis y descripción', () => {
    const texto = readFileSync(CASA, 'utf8');
    const r = N.validar(JSON.parse(texto));
    assert.ok(r.ok, JSON.stringify(r.errores));
    assert.equal(r.migradoDesde, undefined);
    assert.equal(N.aJSON(r.espacio), texto, 'guardarla sin cambios no la cambia');
    for (const c of ['resumen', 'analizar', 'describir']) {
      const s = cli([c, CASA, '--json']);
      assert.ok(s.codigo === 0, `${c}: ${s.salida}`);
      assert.deepEqual(s.json, esperado(c), `${c} igual que el congelado`);
    }
  });

  test('se exporta a .glb válido y se abre con sus tres archivos dentro', async () => {
    const validador = createRequire(import.meta.url)('gltf-validator');
    const bytes = N.espacioAGLB(N.validar(JSON.parse(readFileSync(CASA, 'utf8'))).espacio, 'prueba', { colisiones: 'godot' });
    const informe = await validador.validateBytes(new Uint8Array(bytes), { maxIssues: 100 });
    assert.equal(informe.issues.numErrors, 0, JSON.stringify(informe.issues.messages.slice(0, 3)));
    const r = cli(['abrir', CASA, '--salida', join(tmp(), 'ver.html'), '--json']);
    assert.deepEqual(r.json.incluidos, ['planos/plano.png', 'modelos/sillon.glb', 'fotos/salon.png']);
  });
});

describe('revisión independiente del código de la ronda 5', () => {
  // 1. Vincular con una lectura vieja: el disco cambió entre leerlo y vincular (p. ej. mientras la persona
  // leía el diálogo de conflicto). Lo conocido debe ser lo que se ve, no la lectura nueva: así el sondeo
  // trae la versión del agente y nadie la pisa.
  function montar(textoVisto) {
    const disco = { texto: textoVisto, lm: 1 };
    let nombre = null;
    const almacen = {
      tipo: 'prueba',
      nombreArchivo: () => nombre,
      vinculado: () => nombre !== null,
      guardar: async (t) => {
        disco.texto = t;
        disco.lm++;
      },
      leer: async () => (nombre ? { texto: disco.texto, lm: disco.lm } : null),
    };
    const cargas = [];
    const reloj = { poner: (f) => f, quitar: () => {}, hora: () => '10:00' };
    const sinc = new Sincronizador(almacen, { estado: () => {}, cargar: (e) => cargas.push(e.nombre), bloqueo: () => {}, guardado: () => {}, arrastrando: () => false }, reloj, 600);
    const leido = { texto: textoVisto, nombre: 'casa.espacio.json', aceptar: async () => void (nombre = 'casa.espacio.json') };
    return { disco, sinc, cargas, leido };
  }
  const visto = N.nuevoEspacio({ ancho: 300, largo: 300, nombre: 'Visto' });
  const agente = N.aJSON(N.nuevoEspacio({ ancho: 300, largo: 300, nombre: 'Agente' }));

  for (const metodo of ['vincular', 'vincularConservando']) {
    test(`1 (${metodo}): el agente escribe antes de vincular → el sondeo trae su versión y no se pisa`, async () => {
      const c = montar(N.aJSON(visto));
      c.sinc.establecer(visto);
      c.disco.texto = agente;
      c.disco.lm++;
      if (metodo === 'vincular') await c.sinc.vincular(c.leido, visto);
      else await c.sinc.vincularConservando(c.leido);
      await c.sinc.sondear();
      assert.deepEqual(c.cargas, ['Agente'], 'se carga la versión del agente');
      c.sinc.cambioLocal(N.nuevoEspacio({ ancho: 300, largo: 300, nombre: 'Persona' }));
      await c.sinc.guardarAhora();
      assert.equal(JSON.parse(c.disco.texto).nombre, 'Persona', 'y el cambio siguiente de la persona va sobre ella, no sobre la vieja');
    });
  }

  test('5: --salida no puede pisar Espacios3D.html ni un .html ajeno (salvo --forzar)', () => {
    const { dir, f } = casaConArchivos();
    const base = join(RAIZ, 'dist', 'Espacios3D', 'Espacios3D.html');
    const antes = readFileSync(base);
    assert.equal(cli(['abrir', f, '--salida', base, '--json']).codigo, 3);
    assert.ok(readFileSync(base).equals(antes), 'la página de la entrega sigue igual');
    const ajeno = join(dir, 'mio.html');
    writeFileSync(ajeno, '<p>mío</p>');
    assert.equal(cli(['abrir', f, '--salida', ajeno, '--json']).codigo, 3);
    assert.equal(readFileSync(ajeno, 'utf8'), '<p>mío</p>');
    assert.equal(cli(['abrir', f, '--salida', ajeno, '--forzar', '--json']).codigo, 0);
    // Una copia hecha antes por «abrir» sí se puede sustituir sin --forzar.
    assert.equal(cli(['abrir', f, '--salida', ajeno, '--json']).codigo, 0);
  });

  test('9: un fondo que es una carpeta se omite con su motivo (no tumba «abrir»)', () => {
    const { dir, f } = casaConArchivos();
    mkdirSync(join(dir, 'raro.png'));
    const e = JSON.parse(readFileSync(f, 'utf8'));
    e.plantas[0].fondos[0].archivo = 'raro.png';
    writeFileSync(f, JSON.stringify(e));
    const r = cli(['abrir', f, '--json']);
    assert.equal(r.codigo, 0, r.salida);
    assert.match(r.json.omitidos.find((o) => o.ruta === 'raro.png').motivo, /no es un archivo/);
  });

  test('11: un .espacio.json en UTF-16 se rechaza con un motivo claro (la página sólo lee UTF-8)', () => {
    const dir = tmp();
    const f = join(dir, 'u16.espacio.json');
    writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(N.aJSON(N.nuevoEspacio({ ancho: 300, largo: 300 })), 'utf16le')]));
    const r = cli(['abrir', f, '--json']);
    assert.equal(r.codigo, 3, r.salida);
    assert.match(r.salida, /UTF-16/);
  });

  test('10: el almacén deja de servir lo incrustado cuando la página deja la copia (también sin vincular)', async () => {
    let activo = true;
    const real = { tipo: 'descarga', vinculado: () => false, nombreArchivo: () => null };
    const a = almacenConAbierto(real, { version: 1, texto: '{}', nombre: 'c', ruta: 'c', copiadaEn: '', archivos: { 'p.png': { tipo: 'image/png', datos: 'AQID' } }, omitidos: [] }, () => activo);
    assert.ok(await a.leerRelativo('p.png'));
    activo = false;
    assert.equal(a.leerRelativo, undefined, 'otro espacio no ve el plano de la casa del agente');
  });

  test('13: las ocho orientaciones EXIF, con una imagen de cuatro cuadrantes', () => {
    const w = 32;
    const h = 16;
    const d = Buffer.alloc(w * h * 4);
    const col = { R: [220, 20, 20], G: [20, 200, 20], B: [20, 20, 220], Y: [230, 230, 20] };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([...col[y < h / 2 ? (x < w / 2 ? 'R' : 'G') : x < w / 2 ? 'B' : 'Y'], 255], (y * w + x) * 4);
    const base = jpeg.encode({ data: d, width: w, height: h }, 95).data;
    const con = (o) => {
      const t = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
      return Buffer.concat([base.subarray(0, 2), Buffer.from([0xff, 0xe1, 0, t.length + 8]), Buffer.from('Exif\0\0', 'latin1'), t, base.subarray(2)]);
    };
    const nombre = (c) => Object.entries(col).sort((a, b) => Math.hypot(...a[1].map((v, i) => v - c[i])) - Math.hypot(...b[1].map((v, i) => v - c[i])))[0][0];
    // Esquinas vistas [arriba izq., arriba der., abajo izq., abajo der.] según la especificación EXIF.
    const esperado = { 1: 'RGBY', 2: 'GRYB', 3: 'YBGR', 4: 'BYRG', 5: 'RBGY', 6: 'BRYG', 7: 'YGBR', 8: 'GYRB' };
    for (let o = 1; o <= 8; o++) {
      const r = decodificarJPEG(con(o));
      const px = (x, y) => nombre(Array.from(r.rgba.subarray((y * r.ancho + x) * 4, (y * r.ancho + x) * 4 + 3)));
      assert.equal([px(2, 2), px(r.ancho - 3, 2), px(2, r.alto - 3), px(r.ancho - 3, r.alto - 3)].join(''), esperado[o], `orientación ${o}`);
      assert.deepEqual([r.ancho, r.alto], o >= 5 ? [16, 32] : [32, 16]);
    }
  });

  test('13: el calco sobre un fondo JPEG pinta el plano (no sólo crea el PNG)', async () => {
    const { decodificarPNG } = await import('../../build/png.mjs');
    const dir = tmp();
    const f = join(dir, 'c.espacio.json');
    const w = 300;
    const h = 300;
    const d = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) d.set([210, 30, 30, 255], i * 4);
    writeFileSync(join(dir, 'rojo.jpg'), jpeg.encode({ data: d, width: w, height: h }, 90).data);
    assert.equal(cli(['nuevo', f, '--ancho', '300', '--largo', '300', '--json']).codigo, 0);
    assert.equal(cli(['fondo', 'poner', f, '--imagen', 'rojo.jpg', '--id', 'p', '--json']).codigo, 0);
    assert.equal(cli(['plano', f, '--png', join(dir, 'calco.png'), '--sobre-fondo', '--json']).codigo, 0);
    const img = decodificarPNG(readFileSync(join(dir, 'calco.png')));
    let rojos = 0;
    for (let i = 0; i < img.ancho * img.alto; i++) if (img.rgba[i * 4] > img.rgba[i * 4 + 2] + 60) rojos++;
    assert.ok(rojos > img.ancho * img.alto * 0.2, `el fondo rojo se ve debajo del calco (${rojos} píxeles rojizos)`);
  });
});
