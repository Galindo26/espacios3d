// Ronda 6: arreglos de una revisión independiente del repositorio. Cada prueba falla sin su arreglo.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import * as N from '../../build/core.mjs';
import { cabeceraJPEG } from '../../build/jpeg.mjs';
import { codificarPNG, decodificarPNG } from '../../build/png.mjs';
import { comprobarGlb } from '../../build/glbEntrada.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'Espacios3D', 'espacios3d.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'espacios3d-r6-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const cli = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: tmp });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
};
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const estancia = (id, contorno, mas = {}) => ({ id, nombre: id, altura: 250, huecos: [], contorno, ...mas });
const planta = (id, nivel, estancias, mas = {}) => ({ id, nombre: id, nivel, grosorExterior: 10, estancias, muebles: [], ...mas });
const casa = (plantas) => N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'Casa', plantas });
const area = (p) => Math.abs(p.reduce((s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0) / 2);

describe('ids de las escaleras', () => {
  const tres = () => casa([0, 280, 560].map((nivel, i) => planta(`p${i}`, nivel, [estancia(`s${i}`, rect(0, 0, 600, 500))])));

  test('la segunda escalera sin id recibe uno libre', () => {
    const a = N.agregarEscalera(tres(), { x: 100, y: 50, ancho: 90, largo: 330 }, 'p0');
    assert.equal(a.id, 'escalera');
    const b = N.agregarEscalera(a.espacio, { x: 400, y: 50, ancho: 90, largo: 330 }, 'p1');
    assert.equal(b.id, 'escalera-2');
    assert.ok(N.idsUsados(b.espacio).has('escalera-2'));
  });

  test('un mueble no puede tomar el id de una escalera, y el error lo dice', () => {
    const a = N.agregarEscalera(tres(), { x: 100, y: 50, ancho: 90, largo: 330 }, 'p0');
    assert.throws(() => N.agregarMueble(a.espacio, { tipo: 'silla', id: 'escalera' }), /Ya existe algo con id «escalera»/);
  });
});

describe('fotos de un mueble', () => {
  const conCama = () => casa([planta('pb', 0, [estancia('s', rect(0, 0, 400, 300))], {
    muebles: [{ id: 'cama', nombre: 'Cama', tipo: 'cama', ancho: 150, fondo: 200, alto: 50, x: 100, y: 120, giro: 0, fotos: ['fotos/cama.jpg'] }],
  })]);

  test('el duplicado las conserva', () => {
    const d = N.duplicarMueble(conCama(), 'cama');
    assert.deepEqual(N.todosLosMuebles(d.espacio).find((m) => m.id === d.id).fotos, ['fotos/cama.jpg']);
  });

  test('uno de «Mis muebles» guardado con fotos se puede añadir con --mio y las trae', () => {
    const f = join(tmp, 'mios.espacio.json');
    writeFileSync(f, N.aJSON(conCama()));
    assert.equal(cli('muebles', 'guardar', f, '--id', 'cama').codigo, 0);
    const r = cli('agregar', f, '--mio', 'Cama', '--id', 'otra', '--x', '300', '--y', '150');
    assert.equal(r.codigo, 0, r.salida);
    const e = JSON.parse(readFileSync(f, 'utf8'));
    assert.deepEqual(e.plantas[0].muebles.find((m) => m.id === 'otra').fotos, ['fotos/cama.jpg']);
  });
});

describe('forjado', () => {
  test('no tapa un patio interior', () => {
    const anillo = (p) => [estancia(`${p}n`, rect(0, 0, 900, 300)), estancia(`${p}s`, rect(0, 600, 900, 900)), estancia(`${p}o`, rect(0, 300, 300, 600)), estancia(`${p}e`, rect(600, 300, 900, 600))];
    const e = casa([planta('pb', 0, anillo('a')), planta('p1', 280, anillo('b'))]);
    const f = N.forjadoDePlanta(e, e.plantas[1]);
    const total = f.poligonos.reduce((s, p) => s + area(p.exterior) - p.agujeros.reduce((t, h) => t + area(h), 0), 0);
    // 920 × 920 de huella menos el patio de 300 × 300 sin sus muros de 10 (280 × 280).
    assert.ok(Math.abs(total - (920 * 920 - 280 * 280)) < 1, `área ${total}`);
  });
});

describe('paredes pintadas bajo un techo inclinado', () => {
  const buhardilla = () => casa([planta('pb', 0, [estancia('s', rect(0, 0, 400, 300), {
    paredes: '#f2e6d0',
    faldones: [{ muro: 1, alturaEnMuro: 120, alcance: 200 }],
    huecos: [{ id: 'paso', tipo: 'paso', muro: 0, desde: 250, ancho: 80, alto: 205 }],
  })])]);

  test('un hueco más alto que el techo no deja cuadros degenerados', () => {
    const e = buhardilla();
    const cuadros = N.revestimiento(e.plantas[0].estancias[0], N.modeloPlanta(e.plantas[0]));
    assert.ok(cuadros.length > 0);
    const { normales } = N.mallaCuadros(cuadros);
    for (let i = 0; i < normales.length; i += 3) {
      const l = Math.hypot(normales[i], normales[i + 1], normales[i + 2]);
      assert.ok(Math.abs(l - 1) < 1e-4, `normal ${i / 3} de longitud ${l}`);
    }
  });

  test('y el .glb se exporta', () => {
    assert.ok(N.espacioAGLB(buhardilla()).byteLength > 1000);
  });
});

describe('recorrer', () => {
  test('una ventana hasta el suelo no se atraviesa', () => {
    for (const antepecho of [90, 0]) {
      const e = casa([planta('pb', 0, [estancia('s', rect(0, 0, 400, 300), { huecos: [{ id: 'v', tipo: 'ventana', muro: 0, desde: 100, ancho: 150, antepecho, alto: 120 }] })])]);
      // De dentro (y = 50) a fuera (y = −50) por el centro de la ventana: algún obstáculo lo corta.
      const cruza = N.obstaculos(e.plantas[0]).some(([a, b]) => Math.min(a[0], b[0]) <= 175 && Math.max(a[0], b[0]) >= 175 && Math.max(a[1], b[1]) <= 50 && Math.min(a[1], b[1]) >= -50 && Math.abs(a[1] - b[1]) < 1);
      assert.ok(cruza, `con antepecho ${antepecho} el muro debe cortar el paso`);
    }
  });

  test('una puerta sigue dejando pasar', () => {
    const e = casa([planta('pb', 0, [estancia('s', rect(0, 0, 400, 300), { huecos: [{ id: 'p', tipo: 'puerta', muro: 0, desde: 100, ancho: 150, alto: 205 }] })])]);
    const cruza = N.obstaculos(e.plantas[0]).some(([a, b]) => Math.min(a[0], b[0]) <= 175 && Math.max(a[0], b[0]) >= 175 && Math.max(a[1], b[1]) <= 50 && Math.min(a[1], b[1]) >= -50 && Math.abs(a[1] - b[1]) < 1);
    assert.ok(!cruza);
  });
});

describe('imágenes dañadas', () => {
  test('un JPEG truncado no es una imagen, sin errores de lectura', () => {
    const exif = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00]);
    const relleno = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, ...Array(12).fill(0xff)]);
    const largoCero = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, ...Array(12).fill(0x00)]);
    for (const b of [exif, relleno, largoCero]) assert.equal(cabeceraJPEG(b), null);
  });

  test('el CLI lo dice en claro', () => {
    const f = join(tmp, 'img.espacio.json');
    assert.equal(cli('nuevo', f, '--ancho', '300', '--largo', '300').codigo, 0);
    writeFileSync(join(tmp, 'roto.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00]));
    const r = cli('fondo', 'poner', f, '--imagen', 'roto.jpg');
    assert.notEqual(r.codigo, 0);
    assert.doesNotMatch(r.salida, /offset|out of range/);
    assert.match(r.salida, /PNG ni un JPEG|no es una imagen/i);
  });

  /** PNG de un píxel cuyo IDAT se descomprime en `bytes` bytes. */
  const pngInflado = (bytes) => {
    const bueno = Buffer.from(codificarPNG(new Uint8Array([1, 2, 3, 255]), 1, 1));
    const crc = (b) => {
      let c = 0xffffffff;
      for (const x of b) {
        c ^= x;
        for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    const trozo = (nombre, datos) => {
      const cuerpo = Buffer.concat([Buffer.from(nombre, 'latin1'), datos]);
      const b = Buffer.alloc(cuerpo.length + 8);
      b.writeUInt32BE(datos.length, 0);
      cuerpo.copy(b, 4);
      b.writeUInt32BE(crc(cuerpo), cuerpo.length + 4);
      return b;
    };
    return Buffer.concat([bueno.subarray(0, 33), trozo('IDAT', deflateSync(Buffer.alloc(bytes))), trozo('IEND', Buffer.alloc(0))]);
  };

  test('un PNG que se descomprime en mucho más de lo que dice su tamaño se rechaza sin inflarlo entero', () => {
    assert.throws(() => decodificarPNG(pngInflado(64 * 1024 * 1024)), /PNG: .*más datos/);
  });

  test('unos bytes de más al final del IDAT se toleran', () => {
    assert.equal(decodificarPNG(pngInflado(5 + 100)).ancho, 1);
  });

  test('un PNG de más de 100 megapíxeles se rechaza antes de reservar memoria', () => {
    const b = pngInflado(5);
    b.writeUInt32BE(20000, 16);
    b.writeUInt32BE(20000, 20);
    // CRC del IHDR rehecho para que el fallo sea el del tamaño.
    let c = 0xffffffff;
    for (const x of b.subarray(12, 29)) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    b.writeUInt32BE((c ^ 0xffffffff) >>> 0, 29);
    assert.throws(() => decodificarPNG(b), /PNG: .*megapíxeles/);
  });
});

describe('modelos .glb', () => {
  const glb = (json) => {
    const t = new TextEncoder().encode(json);
    const b = new ArrayBuffer(20 + t.length);
    const dv = new DataView(b);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, b.byteLength, true);
    dv.setUint32(12, t.length, true);
    dv.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(b, 20).set(t);
    return b;
  };

  test('un JSON que no es un objeto, o con listas que no lo son, es un .glb dañado', () => {
    for (const j of ['null', '[]', '3', '{"images": 5}', '{"extensionsUsed": "x"}', '{mal']) assert.throws(() => comprobarGlb(glb(j)), /el \.glb está dañado/, j);
  });

  test('uno normal se sigue leyendo', () => {
    assert.deepEqual(comprobarGlb(glb('{"asset":{"version":"2.0"},"images":[{"uri":"fuera.png"},{"uri":"data:image/png;base64,AA"}]}')), { raras: [], externas: ['fuera.png'] });
  });
});

describe('ayuda del CLI', () => {
  test('nombra todas las operaciones de «aplicar»', () => {
    const { salida } = cli('ayuda');
    const bloque = salida.slice(salida.indexOf('op = '), salida.indexOf('claves en camelCase'));
    const dichas = new Set(bloque.replace('op = ', '').split(/[,;\s]+/).filter(Boolean));
    assert.deepEqual(N.OPERACIONES.filter((o) => !dichas.has(o)), []);
  });
});

describe('MCP', () => {
  const carpeta = join(tmp, 'mcp');
  let proc;
  let siguiente = 1;
  let salida = '';
  const pendientes = new Map();
  const pedir = (method, params = {}) => {
    const id = siguiente++;
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((res, rej) => {
      // El temporizador se retira al llegar la respuesta: no queda vivo 20 s.
      const t = setTimeout(() => rej(new Error(`sin respuesta a ${method}`)), 20000);
      pendientes.set(id, (m) => (clearTimeout(t), res(m)));
    });
  };
  const llamar = (name, args) => pedir('tools/call', { name, arguments: args }).then((r) => r.result);
  const textoDe = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const arrancar = async () => {
    if (proc) return;
    mkdirSync(join(carpeta, 'planos'), { recursive: true });
    const px = codificarPNG(new Uint8Array(4 * 4 * 4).fill(200), 4, 4);
    writeFileSync(join(carpeta, 'planos', 'baja.png'), px);
    writeFileSync(join(carpeta, 'planos', 'alta.png'), px);
    const fondo = (id, archivo) => ({ id, archivo, anchoPx: 4, altoPx: 4, escala: 100, x: 0, y: 0, giro: 0, opacidad: 0.5 });
    writeFileSync(join(carpeta, 'casa.espacio.json'), N.aJSON(casa([
      planta('pb', 0, [estancia('a', rect(0, 0, 400, 300))], { fondos: [fondo('fb', 'planos/baja.png')] }),
      planta('p1', 280, [estancia('b', rect(0, 0, 400, 300))], { fondos: [fondo('fa', 'planos/alta.png')] }),
    ])));
    proc = spawn(process.execPath, [CLI, 'mcp', '--carpeta', carpeta], { stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => {
      salida += d;
      let i;
      while ((i = salida.indexOf('\n')) >= 0) {
        const l = salida.slice(0, i);
        salida = salida.slice(i + 1);
        if (!l.trim()) continue;
        const m = JSON.parse(l);
        pendientes.get(m.id)?.(m);
        pendientes.delete(m.id);
      }
    });
    await pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '0' } });
  };
  after(() => proc?.stdin.end());

  test('plano_png no guarda encima del plano de fondo de otra planta', async () => {
    await arrancar();
    const antes = readFileSync(join(carpeta, 'planos', 'baja.png'));
    const r = await llamar('plano_png', { archivo: 'casa.espacio.json', planta: 'p1', guardarEn: 'planos/baja.png' });
    assert.equal(r.isError, true, textoDe(r));
    assert.match(textoDe(r), /fondo «fb»/);
    assert.ok(readFileSync(join(carpeta, 'planos', 'baja.png')).equals(antes));
  });

  test('aplicar con exigirSinErrores no escribe un resultado con errores', async () => {
    await arrancar();
    const antes = readFileSync(join(carpeta, 'casa.espacio.json'), 'utf8');
    const ops = [{ op: 'agregar', tipo: 'cama', id: 'c1', x: 200, y: 150 }, { op: 'agregar', tipo: 'cama', id: 'c2', x: 200, y: 150 }];
    const r = await llamar('aplicar', { archivo: 'casa.espacio.json', ops, exigirSinErrores: true });
    const d = JSON.parse(textoDe(r));
    assert.ok(d.errores > 0);
    assert.equal(d.escrito, false);
    assert.equal(readFileSync(join(carpeta, 'casa.espacio.json'), 'utf8'), antes);
    const l = await pedir('tools/list');
    assert.ok('exigirSinErrores' in l.result.tools.find((t) => t.name === 'aplicar').inputSchema.properties);
  });
});

describe('barandillas de las escaleras', () => {
  const conEscalera = (esc) => casa([
    planta('pb', 0, [estancia('a', rect(-600, -600, 1400, 1400))], { escaleras: [{ id: 'esc', x: 400, y: 400, ancho: 90, hasta: 'p1', ...esc }] }),
    planta('p1', 280, [estancia('b', rect(-600, -600, 1400, 1400))]),
  ]);
  /** Cotas de los extremos de los pasamanos (las barras no verticales), ordenadas. */
  const pasamanos = (e) => {
    const geo = N.geometriaDe(e, e.plantas[0], e.plantas[0].escaleras[0]);
    return N.piezasEscalera(geo).filter((p) => p.tipo === 'barra' && Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1]) > 0.5);
  };
  const FORMAS = { recta: { forma: 'recta', largo: 300 }, L: { forma: 'L', tramos: [200, 150], gira: 'derecha' }, U: { forma: 'U', tramos: [200, 150], gira: 'izquierda', ojo: 10 } };

  for (const [nombre, forma] of Object.entries(FORMAS)) {
    test(`${nombre}: el pasamanos no cae al suelo con la escalera girada`, () => {
      const cotas = (giro) => pasamanos(conEscalera({ ...forma, giro })).flatMap((b) => [b.a[2], b.b[2]]).sort((x, y) => x - y);
      const recta = cotas(0);
      for (const giro of [37, 90, 180, 270, 211.5]) {
        const c = cotas(giro);
        assert.equal(c.length, recta.length, `giro ${giro}`);
        c.forEach((z, i) => assert.ok(Math.abs(z - recta[i]) < 1e-6, `giro ${giro}: cota ${z} en vez de ${recta[i]}`));
        for (const b of pasamanos(conEscalera({ ...forma, giro }))) assert.ok(Math.abs(b.a[2] - b.b[2]) <= 25, `giro ${giro}: salto de ${b.a[2]} a ${b.b[2]}`);
      }
    });
  }

  test('caracol de 360°: el pasamanos llega arriba', () => {
    const b = pasamanos(conEscalera({ forma: 'caracol', ancho: 80, giro: 0, vuelta: 360 }));
    for (const x of b) assert.ok(Math.abs(x.a[2] - x.b[2]) <= 25, `salto de ${x.a[2]} a ${x.b[2]}`);
    assert.ok(Math.abs(Math.max(...b.map((x) => x.b[2])) - (280 + 90)) < 1e-6);
  });

  test('colisiones: los paneles siguen la rampa (también girada y en la caracol de 360°) y dejan paso por debajo de la parte alta', () => {
    for (const esc of [{ ...FORMAS.recta, giro: 270 }, { ...FORMAS.U, giro: 37 }, { forma: 'caracol', ancho: 80, giro: 0, vuelta: 360 }]) {
      const e = conEscalera(esc);
      const paneles = N.nodosColision(e, e.plantas[0], 'godot', 0).filter((n) => /^escalera-esc-barandilla-/.test(n.nombre));
      assert.ok(paneles.length > 0);
      const ys = paneles.map((n) => {
        const pos = n.malla.primitivas[0].posiciones;
        const y = [];
        for (let i = 1; i < pos.length; i += 3) y.push(pos[i]);
        return y;
      });
      const tope = Math.max(...ys.flat());
      assert.ok(Math.abs(tope - 3.7) < 1e-3, `${esc.forma}: el panel más alto llega a ${tope} m`);
      for (const y of ys) assert.ok(Math.max(...y) >= 0.9 - 1e-6);
      // La cara de abajo de un panel de la parte alta queda a más de 1 m del suelo (y bien por debajo de su pasamanos).
      assert.ok(ys.some((y) => y.some((v) => v > 1 && v < Math.max(...y) - 0.95)), `${esc.forma}: bajo la parte alta se pasa`);
      assert.ok(ys.some((y) => y.some((v) => v === 0)), `${esc.forma}: y en el arranque llegan al suelo`);
    }
  });
});

describe('análisis: alturas de la obra y de los muebles', () => {
  const errores = (e) => N.analizar(e).filter((i) => i.gravedad === 'error').map((i) => i.mensaje);
  const avisos = (e) => N.analizar(e).filter((i) => i.gravedad === 'aviso').map((i) => i.mensaje);
  const conEscalera = (elementos) => casa([
    planta('pb', 0, [estancia('a', rect(0, 0, 800, 800), { elementos })], { escaleras: [{ id: 'esc', forma: 'recta', x: 400, y: 250, ancho: 90, largo: 330, giro: 0, hasta: 'p1' }] }),
    planta('p1', 280, [estancia('b', rect(0, 0, 800, 800))]),
  ]);
  const viga = (y) => [{ id: 'v', forma: 'viga', de: [0, y], a: [800, y], ancho: 20, canto: 25 }];

  test('una viga de techo no tapa el pie de una escalera ni «no cabe debajo» de ella', () => {
    assert.deepEqual(errores(conEscalera([])), []);
    assert.deepEqual(errores(conEscalera(viga(200))), [], 'ante el pie, a 225 cm del suelo');
    assert.deepEqual(errores(conEscalera(viga(262))), [], 'sobre los primeros peldaños quedan más de 200 cm');
  });

  test('si deja menos de 200 cm sobre la rampa, el error lo dice así', () => {
    const r = errores(conEscalera(viga(400)));
    assert.equal(r.length, 1, r.join(' | '));
    assert.match(r[0], /«esc».*v queda a \d+(\.\d)? cm sobre la escalera \(hacen falta 200\)/);
    assert.doesNotMatch(r[0], /debajo hay/);
  });

  test('una columna sí tapa el pie y sí choca', () => {
    const col = (y) => [{ id: 'col', tipo: 'columna', forma: 'exento', x: 400, y, ancho: 30, fondo: 30 }];
    assert.ok(errores(conEscalera(col(220))).some((m) => /delante del pie está tapado por col/.test(m)));
    assert.ok(errores(conEscalera(col(400))).some((m) => /choca con obra: col/.test(m)));
  });

  test('obra por encima del dintel no tapa la puerta; en el suelo, sí', () => {
    const con = (elevacion, alto) => casa([planta('pb', 0, [estancia('a', rect(0, 0, 400, 300), {
      huecos: [{ id: 'p', tipo: 'puerta', muro: 0, desde: 100, ancho: 80, alto: 205 }],
      elementos: [{ id: 'e1', tipo: 'pilar', forma: 'adosado', muro: 0, desde: 110, ancho: 60, fondo: 20, elevacion, alto }],
    })])]);
    assert.deepEqual(errores(con(215, 25)), []);
    assert.ok(errores(con(0, 100)).some((m) => /tapa el paso de «p»/.test(m)));
  });

  test('una columna en la estancia vecina impide abrir la puerta que abre hacia ella', () => {
    const con = (x, abre) => casa([planta('pb', 0, [
      estancia('a', rect(0, 0, 400, 300), { huecos: [{ id: 'p', tipo: 'puerta', muro: 1, desde: 100, ancho: 80, alto: 205, abre }] }),
      estancia('b', rect(410, 0, 800, 300), { elementos: [{ id: 'col', tipo: 'columna', forma: 'exento', x, y: 140, ancho: 30, fondo: 30 }] }),
    ])]);
    assert.ok(errores(con(440, 'fuera')).some((m) => /col.*barrido de la puerta «p»/.test(m)), errores(con(440, 'fuera')).join(' | '));
    assert.ok(errores(con(440, 'dentro')).some((m) => /col.*tapa el paso de «p» por el lado de b/.test(m)), errores(con(440, 'dentro')).join(' | '));
    assert.deepEqual(errores(con(700, 'fuera')), []);
  });

  test('un mueble ancho bajo un techo inclinado que sólo le cae en el centro', () => {
    const c = [[0, 0], [150, 0], [150, -50], [250, -50], [250, 0], [400, 0], [400, 300], [0, 300]];
    const con = (alto) => casa([planta('pb', 0, [estancia('a', c, { faldones: [{ muro: 2, alturaEnMuro: 120, alcance: 200 }] })], {
      muebles: [{ id: 'arm', nombre: 'Armario', tipo: 'armario', ancho: 200, fondo: 60, alto, x: 200, y: 40, giro: 0 }],
    })]);
    assert.ok(errores(con(240)).some((m) => /no cabe bajo el techo inclinado/.test(m)));
    assert.deepEqual(errores(con(120)), []);
  });

  test('una puerta con una jamba bajo el techo inclinado', () => {
    // Faldón sobre el muro 1 (x = 400): en el muro 0 el techo baja de 250 (x = 200) a 120 (x = 400).
    const e = casa([planta('pb', 0, [estancia('a', rect(0, 0, 400, 300), {
      faldones: [{ muro: 1, alturaEnMuro: 120, alcance: 200 }],
      huecos: [{ id: 'p', tipo: 'paso', muro: 0, desde: 180, ancho: 100, alto: 205 }],
    })])]);
    // En el centro (x = 230) el techo está a 230,5; en la jamba de x = 280, a 198.
    assert.ok(avisos(e).some((m) => /«p» mide 205 cm de alto y ahí el techo inclinado está a 198 cm/.test(m)), avisos(e).join(' | '));
  });

  test('un taburete bajo un radiador alto no le quita calor; un mueble a su altura, sí', () => {
    const con = (alto) => casa([planta('pb', 0, [estancia('a', rect(0, 0, 400, 300), {
      elementos: [{ id: 'rad', tipo: 'radiador', forma: 'adosado', muro: 0, desde: 100, ancho: 60, fondo: 10, elevacion: 110, alto: 100 }],
    })], { muebles: [{ id: 'tab', nombre: 'Taburete', tipo: 'silla', ancho: 40, fondo: 40, alto, x: 130, y: 35, giro: 0 }] })]);
    assert.deepEqual(avisos(con(45)).filter((m) => /calentará/.test(m)), []);
    assert.equal(avisos(con(150)).filter((m) => /calentará/.test(m)).length, 1);
  });
});

describe('geometría', () => {
  test('insertarVertice rechaza un muro que no existe en vez de mover los huecos de pared', () => {
    const e = casa([planta('pb', 0, [estancia('a', rect(0, 0, 400, 300), { huecos: [{ id: 'p', tipo: 'puerta', muro: 0, desde: 100, ancho: 80, alto: 205 }] })])]);
    for (const i of [-2, 4, 1.5, NaN]) assert.throws(() => N.insertarVertice(e, i, 50), (err) => err instanceof N.ErrorOperacion && /no tiene el muro/.test(err.message), `muro ${i}`);
    assert.equal(N.insertarVertice(e, 2, 50).plantas[0].estancias[0].contorno.length, 5);
  });

  test('en una esquina muy aguda el muro exterior no se queda sin grosor', () => {
    const c = [[0, 0], [1000, 0], [1000, 100]];
    const ext = N.contornoExterior(c, 15);
    assert.ok(Math.abs(Math.hypot(ext[0][0], ext[0][1]) - 60) < 1e-6, `el vértice exterior queda a ${Math.hypot(ext[0][0], ext[0][1])} cm (límite de inglete: 4 × 15)`);
    assert.ok(ext[0][0] < 0, 'hacia fuera de la punta');
    // Los demás vértices, con su inglete normal.
    assert.deepEqual(ext[1].map((v) => Math.round(v * 100) / 100), [1015, -15]);
  });
});

describe('ronda 6, página y pruebas: la puntuación de la aceptación', () => {
  const PUNTUAR = join(dirname(fileURLToPath(import.meta.url)), '..', 'aceptacion', 'puntuar.mjs');
  const REF = join(dirname(PUNTUAR), 'ref-a.espacio.json');
  const puntuar = (res) => {
    const r = spawnSync(process.execPath, [PUNTUAR, REF, res, '--modo', 'cotas'], { encoding: 'utf8' });
    return { codigo: r.status, informe: JSON.parse(r.stdout) };
  };
  test('8: una planta de más no pasa aunque la referencia tenga una sola', () => {
    const ref = JSON.parse(readFileSync(REF, 'utf8'));
    assert.equal(ref.plantas.length, 1);
    assert.equal(puntuar(REF).codigo, 0, 'la referencia contra sí misma pasa');
    const res = structuredClone(ref);
    res.plantas.push({ id: 'inventada', nombre: 'Inventada', nivel: 300, estancias: [{ id: 'inventada-1', contorno: [[0, 0], [300, 0], [300, 300], [0, 300]] }], muebles: [] });
    N.validarOLanzar(res);
    const f = join(tmp, 'planta-de-mas.espacio.json');
    writeFileSync(f, JSON.stringify(res));
    const r = puntuar(f);
    assert.notEqual(r.codigo, 0);
    assert.equal(r.informe.ok, false);
    assert.deepEqual(r.informe.comprobaciones.find((c) => c.nombre === 'plantas'), { nombre: 'plantas', ok: false, detalle: { referencia: 1, resultado: 2 } });
  });
});

describe('ronda 6, aplazados del núcleo', () => {
  test('imán: con un muro casi paralelo, el mueble se pega a la pared donde está, no donde empieza el muro', () => {
    // La pared de arriba baja 7,85 cm en 500 (menos de 1°): junto a su final queda en y ≈ 7,1–7,9.
    const e = N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [{ id: 'pb', estancias: [{ id: 's', contorno: [[0, 0], [500, 7.85], [500, 300], [0, 300]], altura: 250, huecos: [] }],
      muebles: [{ id: 'm', tipo: 'caja', x: 250, y: 150, ancho: 50, fondo: 40, alto: 80, giro: 0 }] }] });
    const pared = (x) => (7.85 * x) / 500;
    const m = e.plantas[0].muebles[0];
    // Su trasera (y − 20) a 9: a poco más de 1 cm de la pared. Antes se «pegaba» a y = 0, 7 cm dentro del muro.
    let r = N.aplicarIman(e, { ...m, x: 460, y: 29 }, 10);
    assert.ok(r.y - 20 >= pared(485) - 0.05, `no entra en la pared (trasera en ${r.y - 20}, pared en ${pared(485)})`);
    assert.ok(r.y - 20 <= pared(485) + 0.5, `y queda pegado a ella (trasera en ${r.y - 20})`);
    // A 12 del arranque del muro pero a unos 4,5 de la pared: está dentro del umbral y se pega.
    r = N.aplicarIman(e, { ...m, x: 460, y: 32 }, 10);
    assert.ok(Math.abs(r.y - 20 - pared(485)) <= 0.5, `se pega desde 4,5 cm (trasera en ${r.y - 20})`);
    // Y a más de 10 cm de la pared, no.
    r = N.aplicarIman(e, { ...m, x: 460, y: 20 + pared(485) + 11 }, 10);
    assert.equal(r.y, 20 + pared(485) + 11);
  });

  test('escalera en L: la estancia que la contiene no es la que ocupa su rincón interior', () => {
    const e = N.validarOLanzar({ formato: 'espacios3d', version: 2, nombre: 'x', plantas: [
      { id: 'pb', nivel: 0, estancias: [{ id: 's', contorno: rect(0, 0, 900, 900), altura: 250, huecos: [] }], muebles: [],
        escaleras: [{ id: 'esc', forma: 'L', x: 300, y: 200, ancho: 90, tramos: [300, 300], gira: 'derecha', hasta: 'p1' }] },
      { id: 'p1', nivel: 280, estancias: [{ id: 't', contorno: rect(0, 0, 900, 900), altura: 250, huecos: [] }], muebles: [] },
    ] });
    const pb = e.plantas[0];
    const geo = N.geometriaDe(e, pb, pb.escaleras[0]);
    // La media de los vértices de la huella cae en el rincón interior de la L, fuera de la escalera.
    const v = geo.huella.flat();
    const c = [v.reduce((s, q) => s + q[0], 0) / v.length, v.reduce((s, q) => s + q[1], 0) / v.length];
    assert.ok(!geo.huella.some((r) => N.puntoEnPoligono(c, r)), 'el caso es el del rincón');
    // Un aseo en ese rincón (va primero en la lista) y el distribuidor alrededor.
    const aseo = { id: 'aseo', contorno: rect(c[0] - 15, c[1] - 15, c[0] + 15, c[1] + 15), altura: 220, huecos: [] };
    const planta = { ...pb, estancias: [aseo, pb.estancias[0]] };
    assert.equal(N.estanciaDeEscalera(planta, pb.escaleras[0], geo).id, 's');
    assert.equal(N.techoEscalera(planta, pb.escaleras[0], geo), 250);
  });
});
