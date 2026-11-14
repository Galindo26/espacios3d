// Pruebas del servidor MCP por stdio (build/mcp.mjs): se lanza un servidor de ejemplo con dos herramientas
// como proceso hijo y se conversa con él por líneas JSON-RPC.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULO = pathToFileURL(join(RAIZ, 'build', 'mcp.mjs')).href;

const SERVIDOR = `
import { servirMCP } from ${JSON.stringify(MODULO)};
console.error('servidor de ejemplo arrancado');
await servirMCP({
  nombre: 'ejemplo',
  version: '1.2.3',
  instrucciones: 'Suma números.',
  herramientas: [
    {
      nombre: 'sumar',
      descripcion: 'Suma a y b',
      esquemaEntrada: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
      async ejecutar(args) {
        if (typeof args.a !== 'number' || typeof args.b !== 'number') throw new Error('a y b deben ser números');
        await new Promise((r) => setTimeout(r, 20));
        return { contenido: [{ type: 'text', text: String(args.a + args.b) }] };
      },
    },
    {
      nombre: 'imagen',
      descripcion: 'Devuelve un píxel PNG o un error controlado',
      esquemaEntrada: { type: 'object', properties: { fallar: { type: 'boolean' } } },
      async ejecutar(args) {
        if (args.fallar) return { contenido: [{ type: 'text', text: 'no hay imagen' }], esError: true };
        return { contenido: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }] };
      },
    },
  ],
});
console.error('servidor de ejemplo terminado');
`;

/** Proceso hijo con el servidor y utilidades para hablar con él. */
class Cliente {
  constructor(archivo) {
    this.hijo = spawn(process.execPath, [archivo], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.lineas = [];
    this.esperas = [];
    this.stderr = '';
    let resto = '';
    this.hijo.stdout.setEncoding('utf8');
    this.hijo.stdout.on('data', (trozo) => {
      resto += trozo;
      let i;
      while ((i = resto.indexOf('\n')) >= 0) {
        const linea = resto.slice(0, i);
        resto = resto.slice(i + 1);
        this.lineas.push(linea);
        const mensaje = JSON.parse(linea); // falla la prueba si algo no es JSON
        const k = this.esperas.findIndex((e) => e.id === mensaje.id);
        if (k >= 0) this.esperas.splice(k, 1)[0].resolver(mensaje);
        else this.sueltos.push(mensaje);
      }
    });
    this.sueltos = [];
    this.hijo.stderr.setEncoding('utf8');
    this.hijo.stderr.on('data', (t) => (this.stderr += t));
    this.salida = new Promise((r) => this.hijo.on('exit', (codigo) => r(codigo)));
  }
  escribir(texto) {
    this.hijo.stdin.write(`${texto}\n`);
  }
  /** Envía una petición y espera su respuesta (por id). */
  pedir(id, method, params) {
    // Antes de crear la espera: si no, su temporizador rechazaría más tarde una promesa que nadie mira.
    if (this.sueltos.some((m) => m.id === id)) throw new Error('id repetido en la prueba');
    const p = new Promise((resolver, rechazar) => {
      const t = setTimeout(() => rechazar(new Error(`sin respuesta a ${method} (${id})`)), 5000);
      this.esperas.push({ id, resolver: (m) => (clearTimeout(t), resolver(m)) });
    });
    this.escribir(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }));
    return p;
  }
  /** Espera la siguiente respuesta con id null (errores de parseo). */
  async siguienteNula() {
    for (let i = 0; i < 100; i++) {
      const k = this.sueltos.findIndex((m) => m.id === null);
      if (k >= 0) return this.sueltos.splice(k, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('sin respuesta de error');
  }
}

describe('servidor MCP por stdio', () => {
  let carpeta;
  let archivo;
  before(() => {
    carpeta = mkdtempSync(join(tmpdir(), 'e3d-mcp-'));
    archivo = join(carpeta, 'servidor.mjs');
    writeFileSync(archivo, SERVIDOR);
  });
  after(() => rmSync(carpeta, { recursive: true, force: true }));

  test('conversación completa', async () => {
    const c = new Cliente(archivo);
    try {
      // initialize con una versión conocida → la misma.
      const ini = await c.pedir(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'prueba', version: '0' } });
      assert.equal(ini.jsonrpc, '2.0');
      assert.deepEqual(ini.result, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'ejemplo', version: '1.2.3' },
        instructions: 'Suma números.',
      });
      // Versión desconocida → la más nueva.
      const otra = await c.pedir('ini-2', 'initialize', { protocolVersion: '2099-01-01' });
      assert.equal(otra.result.protocolVersion, '2025-11-25');
      // Notificación: sin respuesta (la siguiente línea es la del ping).
      const antes = c.lineas.length;
      c.escribir(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
      c.escribir(JSON.stringify({ jsonrpc: '2.0', method: 'metodo/inexistente' }));
      const ping = await c.pedir(2, 'ping');
      assert.deepEqual(ping.result, {});
      assert.equal(c.lineas.length, antes + 1, 'las notificaciones no tienen respuesta');
      // tools/list.
      const lista = await c.pedir(3, 'tools/list', {});
      assert.deepEqual(lista.result.tools.map((t) => t.name), ['sumar', 'imagen']);
      assert.equal(lista.result.tools[0].description, 'Suma a y b');
      assert.deepEqual(lista.result.tools[0].inputSchema.required, ['a', 'b']);
      // tools/call: éxito, imagen, error controlado y excepción dentro de la herramienta.
      const suma = await c.pedir(4, 'tools/call', { name: 'sumar', arguments: { a: 2, b: 40 } });
      assert.deepEqual(suma.result, { content: [{ type: 'text', text: '42' }], isError: false });
      const img = await c.pedir(5, 'tools/call', { name: 'imagen' });
      assert.deepEqual(img.result.content, [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }]);
      const controlado = await c.pedir(6, 'tools/call', { name: 'imagen', arguments: { fallar: true } });
      assert.deepEqual(controlado.result, { content: [{ type: 'text', text: 'no hay imagen' }], isError: true });
      const excepcion = await c.pedir(7, 'tools/call', { name: 'sumar', arguments: { a: 'x' } });
      assert.equal(excepcion.error, undefined, 'el fallo de una herramienta no es un error JSON-RPC');
      assert.deepEqual(excepcion.result, { content: [{ type: 'text', text: 'a y b deben ser números' }], isError: true });
      // Herramienta desconocida y argumentos mal formados: errores de protocolo (−32602).
      assert.equal((await c.pedir(8, 'tools/call', { name: 'restar', arguments: {} })).error.code, -32602);
      assert.equal((await c.pedir(9, 'tools/call', { name: 'sumar', arguments: [1, 2] })).error.code, -32602);
      // Método desconocido con id → −32601.
      const desconocido = await c.pedir(10, 'resources/list', {});
      assert.equal(desconocido.error.code, -32601);
      assert.equal(desconocido.id, 10);
      // JSON roto → −32700 con id null; el servidor sigue atendiendo.
      c.escribir('{"jsonrpc": "2.0", "id": 11, "method": ');
      const roto = await c.siguienteNula();
      assert.equal(roto.error.code, -32700);
      // Peticiones en paralelo: cada respuesta lleva su id.
      const [r1, r2] = await Promise.all([
        c.pedir(12, 'tools/call', { name: 'sumar', arguments: { a: 1, b: 1 } }),
        c.pedir(13, 'tools/call', { name: 'sumar', arguments: { a: 2, b: 2 } }),
      ]);
      assert.equal(r1.result.content[0].text, '2');
      assert.equal(r2.result.content[0].text, '4');
      // Fin de la entrada: el servidor termina limpio; stdout sólo tuvo mensajes JSON-RPC y los registros fueron a stderr.
      c.hijo.stdin.end();
      assert.equal(await c.salida, 0);
      assert.ok(c.lineas.every((l) => JSON.parse(l).jsonrpc === '2.0'));
      assert.match(c.stderr, /arrancado/);
      assert.match(c.stderr, /terminado/);
      assert.match(c.stderr, /error en sumar/);
    } finally {
      if (c.hijo.exitCode === null) c.hijo.kill();
    }
  });

  test('una petición pendiente se responde aunque la entrada se cierre antes', async () => {
    const c = new Cliente(archivo);
    try {
      const p = c.pedir(1, 'tools/call', { name: 'sumar', arguments: { a: 3, b: 4 } });
      c.hijo.stdin.end();
      assert.equal((await p).result.content[0].text, '7');
      assert.equal(await c.salida, 0);
    } finally {
      if (c.hijo.exitCode === null) c.hijo.kill();
    }
  });
});
