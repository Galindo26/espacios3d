// R2-7, paso c: servidor MCP dentro del CLI (node espacios3d.mjs mcp). Se lanza como proceso hijo
// sobre una carpeta temporal y se conversa con él por líneas JSON-RPC.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(RAIZ, 'dist', 'Espacios3D', 'espacios3d.mjs');

let carpeta;
let fuera;
let proc;
let salida = '';
let pendientes = new Map();
let siguiente = 1;
const lineas = [];

function pedir(method, params = {}) {
  const id = siguiente++;
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((res, rej) => {
    // El temporizador se retira al llegar la respuesta: no queda vivo 20 s.
    const t = setTimeout(() => rej(new Error(`sin respuesta a ${method}`)), 20000);
    pendientes.set(id, (m) => (clearTimeout(t), res(m)));
  });
}
const llamar = (name, args) => pedir('tools/call', { name, arguments: args }).then((r) => r.result);
const textoDe = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

before(() => {
  carpeta = mkdtempSync(join(tmpdir(), 'espacios3d-mcp-'));
  fuera = mkdtempSync(join(tmpdir(), 'espacios3d-fuera-'));
  mkdirSync(join(carpeta, 'espacios'));
  writeFileSync(join(fuera, 'secreto.espacio.json'), '{"no": "es tuyo"}');
  try {
    symlinkSync(fuera, join(carpeta, 'enlace'), 'junction');
  } catch {
    /* sin permiso para enlaces: esa comprobación se salta */
  }
  proc = spawn(process.execPath, [CLI, 'mcp', '--carpeta', carpeta], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    salida += d;
    let i;
    while ((i = salida.indexOf('\n')) >= 0) {
      const l = salida.slice(0, i);
      salida = salida.slice(i + 1);
      if (!l.trim()) continue;
      lineas.push(l);
      const m = JSON.parse(l);
      pendientes.get(m.id)?.(m);
      pendientes.delete(m.id);
    }
  });
});
after(() => {
  proc?.stdin.end();
  rmSync(carpeta, { recursive: true, force: true });
  rmSync(fuera, { recursive: true, force: true });
});

describe('MCP de Espacios 3D', () => {
  test('initialize y tools/list: seis herramientas con su esquema (abrir desde la ronda 5)', async () => {
    const r = await pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '0' } });
    assert.equal(r.result.protocolVersion, '2025-06-18');
    assert.match(r.result.instructions, /AGENTS\.md/);
    const l = await pedir('tools/list');
    assert.deepEqual(l.result.tools.map((t) => t.name), ['nuevo', 'describir', 'aplicar', 'abrir', 'analizar', 'plano_png']);
    for (const t of l.result.tools) assert.equal(t.inputSchema.type, 'object');
    assert.equal((await pedir('no/existe')).error.code, -32601);
  });

  test('nuevo, aplicar (todas o ninguna), describir y analizar', async () => {
    let r = await llamar('nuevo', { archivo: 'espacios/casa.espacio.json', ancho: 400, largo: 300, nombre: 'Casa' });
    assert.ok(!r.isError, textoDe(r));
    assert.ok(existsSync(join(carpeta, 'espacios', 'casa.espacio.json')));
    r = await llamar('nuevo', { archivo: 'espacios/casa.espacio.json', ancho: 1, largo: 1 });
    assert.ok(r.isError && /ya existe/.test(textoDe(r)));
    r = await llamar('aplicar', { archivo: 'espacios/casa.espacio.json', ops: [{ op: 'agregar', tipo: 'cama', id: 'cama', x: 120, y: 150 }] });
    const res = JSON.parse(textoDe(r));
    assert.equal(res.escrito, true, textoDe(r));
    r = await llamar('aplicar', { archivo: 'espacios/casa.espacio.json', ops: [{ op: 'agregar', tipo: 'silla', id: 'silla' }, { op: 'mover', id: 'nada', x: 1, y: 1 }] });
    assert.ok(r.isError && /No se ha aplicado nada/.test(textoDe(r)));
    assert.equal(JSON.parse(readFileSync(join(carpeta, 'espacios', 'casa.espacio.json'), 'utf8')).plantas[0].muebles.length, 1);
    r = await llamar('aplicar', { archivo: 'espacios/casa.espacio.json', ops: [{ op: 'agregar', tipo: 'silla' }], simular: true });
    assert.equal(JSON.parse(textoDe(r)).escrito, false);
    const d = JSON.parse(textoDe(await llamar('describir', { archivo: 'espacios/casa.espacio.json' })));
    assert.equal(d.plantas[0].muebles[0].id, 'cama');
    const a = JSON.parse(textoDe(await llamar('analizar', { archivo: 'espacios/casa.espacio.json' })));
    assert.equal(typeof a.errores, 'number');
  });

  test('plano_png: imagen con su escala y origen, con tope de tamaño, y guardarEn', async () => {
    const r = await llamar('plano_png', { archivo: 'espacios/casa.espacio.json', pxPorCm: 10, guardarEn: 'plano.png' });
    assert.ok(!r.isError, textoDe(r));
    const img = r.content.find((c) => c.type === 'image');
    const png = Buffer.from(img.data, 'base64');
    assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
    const ancho = png.readUInt32BE(16);
    const alto = png.readUInt32BE(20);
    assert.ok(Math.max(ancho, alto) <= 1500, `${ancho} x ${alto}`);
    assert.match(textoDe(r), /px por cm; el píxel \(0, 0\) es el punto/);
    assert.ok(existsSync(join(carpeta, 'plano.png')));
  });

  test('rutas: nada fuera de la carpeta (absolutas, «..», otra extensión ni enlaces)', async () => {
    for (const archivo of [join(fuera, 'secreto.espacio.json'), '../secreto.espacio.json', 'espacios/casa.json', 'enlace/secreto.espacio.json']) {
      if (archivo.startsWith('enlace') && !existsSync(join(carpeta, 'enlace'))) continue;
      const r = await llamar('describir', { archivo });
      assert.ok(r.isError, `${archivo}: ${textoDe(r)}`);
      assert.doesNotMatch(textoDe(r), /no es tuyo/);
    }
    const r = await llamar('plano_png', { archivo: 'espacios/casa.espacio.json', guardarEn: '../fuera.png' });
    assert.ok(r.isError);
  });

  // Revisión independiente de R2-7c (12/11/2026).
  test('5 y 6: ni guardarEn ni un fondo salen de la carpeta por un enlace', async () => {
    if (!existsSync(join(carpeta, 'enlace'))) return;
    // PNG de 1 × 1 px fuera de la carpeta.
    writeFileSync(join(fuera, 'privado.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64'));
    await llamar('nuevo', { archivo: 'espacios/enl.espacio.json', ancho: 300, largo: 300 });
    let r = await llamar('plano_png', { archivo: 'espacios/enl.espacio.json', guardarEn: 'enlace/robado.png' });
    assert.ok(r.isError, textoDe(r));
    assert.ok(!existsSync(join(fuera, 'robado.png')), 'no escribe fuera');
    r = await llamar('aplicar', { archivo: 'espacios/enl.espacio.json', ops: [{ op: 'fondo-poner', archivo: '../enlace/privado.png', anchoPx: 1, altoPx: 1, escala: 1, x: 0, y: 0 }] });
    assert.ok(r.isError, `el fondo por el enlace se rechaza: ${textoDe(r)}`);
  });

  test('7 y 8: plano_png de un espacio de 41 m y errores sin rutas absolutas ni rutas con «:»', async () => {
    let r = await llamar('nuevo', { archivo: 'espacios/largo.espacio.json', ancho: 4100, largo: 300 });
    assert.ok(!r.isError, textoDe(r));
    r = await llamar('plano_png', { archivo: 'espacios/largo.espacio.json' });
    assert.ok(!r.isError, textoDe(r));
    r = await llamar('nuevo', { archivo: 'no-existe/a.espacio.json', ancho: 300, largo: 300 });
    assert.ok(r.isError);
    assert.ok(!textoDe(r).includes(carpeta) && !/ENOENT/.test(textoDe(r)), textoDe(r));
    r = await llamar('nuevo', { archivo: 'espacios/a.espacio.json:b.espacio.json', ancho: 300, largo: 300 });
    assert.ok(r.isError);
    r = await llamar('nuevo', { archivo: 'espacios/negativo.espacio.json', ancho: -5, largo: 300 });
    assert.ok(r.isError, 'un ancho negativo no vale');
  });

  test('8: mcp --carpeta inexistente sale con mensaje y código 3', async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [CLI, 'mcp', '--carpeta', join(fuera, 'no-hay')], { encoding: 'utf8', input: '' });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /No existe la carpeta/);
    assert.doesNotMatch(r.stderr, /    at /);
    const s = spawnSync(process.execPath, [CLI, 'mcp', '--carpeta'], { encoding: 'utf8', input: '' });
    assert.equal(s.status, 3, s.stderr);
  });

  test('en la salida estándar sólo hay mensajes JSON-RPC', () => {
    assert.ok(lineas.length > 5);
    for (const l of lineas) assert.equal(JSON.parse(l).jsonrpc, '2.0');
  });
});
