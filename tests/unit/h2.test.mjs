// Pruebas de H2: huecos y sus reglas, colocación contra muros, lotes de operaciones, planos y CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as N from '../../build/core.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(RAIZ, 'dist', 'Espacios3D', 'espacios3d.mjs');

// Accesos v2: primera estancia de la primera planta y sus muebles.
const E = (e) => N.estancia(e).estancia;
const M = (e) => N.planta(e).muebles;
function sala(huecos = [], muebles = []) {
  return N.validarOLanzar({
    formato: 'espacios3d',
    version: 1,
    nombre: 'Prueba',
    estancia: { contorno: [[0, 0], [400, 0], [400, 300], [0, 300]], altura: 250, grosorMuros: 10, huecos },
    muebles,
  });
}
const caja = (id, x, y, ancho = 50, fondo = 50, extra = {}) => ({ id, tipo: 'caja', ancho, fondo, alto: 80, x, y, ...extra });
const reglas = (e) => N.analizar(e).map((i) => `${i.regla}:${i.muebles.join('+')}`).sort();

describe('huecos y reglas de paso', () => {
  // Puerta en el muro 3 (x = 0, de y 300 a y 0): desde 40 → ocupa y de 260 a 180, bisagra en y = 260.
  const puerta = { id: 'p', tipo: 'puerta', muro: 3, desde: 40, ancho: 80 };

  test('barrido de una puerta que abre hacia dentro: cuarto de círculo desde la bisagra', () => {
    const g = N.geometriaHueco(E(sala([puerta])).contorno, E(sala([puerta])).huecos[0]);
    assert.deepEqual(g.a, [0, 260]);
    assert.deepEqual(g.b, [0, 180]);
    const b = N.barridoPuerta(g);
    const xs = b.map((p) => p[0]);
    assert.ok(Math.max(...xs) > 79.9 && Math.min(...xs) > -0.01, 'entra 80 cm hacia dentro (x > 0)');
  });

  test('mueble en el barrido es error; fuera del barrido pero en la franja de paso también; más allá, nada', () => {
    assert.deepEqual(reglas(sala([puerta], [caja('a', 30, 220)])), ['puerta:a']);
    assert.deepEqual(reglas(sala([puerta], [caja('a', 30, 150)])), [], 'junto a la puerta, fuera del hueco: libre');
    const corredera = { ...puerta, abre: 'corredera' };
    assert.deepEqual(reglas(sala([corredera], [caja('a', 30, 220)])), ['paso:a'], 'sin barrido, la franja de 60 cm sigue');
    assert.deepEqual(reglas(sala([corredera], [caja('a', 90, 220)])), [], 'a más de 60 cm del muro');
  });

  test('una puerta que abre hacia fuera no barre la estancia', () => {
    // A ras de la franja de paso (x 60) pero dentro del radio de 80 cm de la hoja.
    assert.deepEqual(reglas(sala([puerta], [caja('a', 85, 220)])), ['puerta:a'], 'hacia dentro, sí estorba');
    assert.deepEqual(reglas(sala([{ ...puerta, abre: 'fuera' }], [caja('a', 85, 220)])), []);
  });

  test('lo que cuelga por encima del dintel no estorba a la puerta', () => {
    assert.deepEqual(reglas(sala([puerta], [caja('a', 30, 220, 50, 50, { elevacion: 210, alto: 30 })])), []);
  });

  test('ventana: tapa si es más alto que el antepecho y está pegado al muro', () => {
    const ventana = { id: 'v', tipo: 'ventana', muro: 0, desde: 150, ancho: 100, antepecho: 90 };
    assert.deepEqual(reglas(sala([ventana], [caja('alto', 200, 25, 50, 50, { alto: 180 })])), ['ventana:alto']);
    assert.deepEqual(reglas(sala([ventana], [caja('bajo', 200, 25, 50, 50, { alto: 75 })])), []);
    assert.deepEqual(reglas(sala([ventana], [caja('lejos', 200, 60, 50, 50, { alto: 180 })])), []);
  });

  test('holgura frontal: otro mueble delante es aviso, una silla no; contra un muro, aviso', () => {
    const armario = { id: 'armario', tipo: 'armario', ancho: 100, fondo: 60, alto: 200, x: 100, y: 30 }; // holgura 70 → y de 60 a 130
    assert.deepEqual(reglas(sala([], [armario, caja('cosa', 100, 100)])), ['holgura:armario+cosa']);
    assert.deepEqual(reglas(sala([], [armario, { ...caja('s', 100, 100), tipo: 'silla' }])), []);
    assert.deepEqual(reglas(sala([], [{ ...armario, y: 270, giro: 0 }])), ['holgura:armario'], 'mirando a la pared de enfrente sin sitio');
  });
});

describe('casos de la revisión de H2', () => {
  const cuarto = (contorno, huecos = [], muebles = []) =>
    N.validarOLanzar({ formato: 'espacios3d', version: 1, estancia: { contorno, huecos }, muebles });

  test('contorno en sentido inverso: mismas reglas de puerta', () => {
    const inverso = [[0, 0], [0, 300], [400, 300], [400, 0]]; // muro 0 = pared izquierda, de arriba abajo
    const e = cuarto(inverso, [{ id: 'p', tipo: 'puerta', muro: 0, desde: 40, ancho: 80 }], [caja('a', 30, 80)]);
    assert.deepEqual(reglas(e), ['puerta:a']);
    assert.deepEqual(reglas(cuarto(inverso, [{ id: 'p', tipo: 'puerta', muro: 0, desde: 40, ancho: 80 }], [caja('a', 30, 160)])), []);
  });

  test('bisagra al final: el barrido sale del otro extremo', () => {
    const p = { id: 'p', tipo: 'puerta', muro: 0, desde: 100, ancho: 80, bisagra: 'fin' }; // hueco x 100–180, bisagra en x 180
    assert.deepEqual(reglas(cuarto([[0, 0], [400, 0], [400, 300], [0, 300]], [p], [caja('a', 165, 40, 20, 20)])), ['puerta:a']);
    assert.deepEqual(reglas(cuarto([[0, 0], [400, 0], [400, 300], [0, 300]], [{ ...p, bisagra: 'inicio' }], [caja('a', 165, 70, 20, 20)])), []);
  });

  test('puerta en un muro diagonal', () => {
    const diag = [[0, 0], [300, 0], [400, 100], [400, 300], [0, 300]];
    const e = cuarto(diag, [{ id: 'p', tipo: 'puerta', muro: 1, desde: 20, ancho: 80 }], [caja('a', 320, 60, 20, 20)]);
    assert.deepEqual(reglas(e), ['puerta:a']);
  });

  test('zona frontal con giro de 90°', () => {
    const armario = { id: 'armario', tipo: 'armario', ancho: 100, fondo: 60, alto: 200, x: 370, y: 150, giro: 90 }; // frente hacia −x
    assert.deepEqual(reglas(cuarto([[0, 0], [400, 0], [400, 300], [0, 300]], [], [armario, caja('cosa', 300, 150)])), ['holgura:armario+cosa']);
  });

  test('alfombras: no chocan, no estorban a puertas ni a la holgura', () => {
    const p = { id: 'p', tipo: 'puerta', muro: 3, desde: 40, ancho: 80 };
    const cama = { id: 'cama', tipo: 'cama', ancho: 150, fondo: 200, alto: 50, x: 200, y: 100 };
    const alfombra = { id: 'alf', tipo: 'alfombra', ancho: 200, fondo: 140, alto: 1, x: 200, y: 150 };
    const felpudo = { id: 'fel', tipo: 'alfombra', ancho: 60, fondo: 40, alto: 1, x: 30, y: 220 };
    assert.deepEqual(reglas(cuarto([[0, 0], [400, 0], [400, 300], [0, 300]], [p], [cama, alfombra, felpudo])), []);
  });

  test('aplicar una distribución respeta los bloqueados y los informa', () => {
    let e = cuarto([[0, 0], [400, 0], [400, 300], [0, 300]], [], [caja('a', 100, 100), { ...caja('b', 200, 100), bloqueado: true }]);
    e = N.guardarDistribucion(e, 'X');
    e = N.editarMueble(e, 'b', { bloqueado: false, x: 300 });
    e = N.editarMueble(e, 'b', { bloqueado: true });
    e = N.moverMueble(e, 'a', 50, 50);
    const r = N.ejecutarOp(e, { op: 'distribucion-aplicar', nombre: 'X' });
    assert.equal(M(r.espacio)[0].x, 100);
    assert.equal(M(r.espacio)[1].x, 300, 'el bloqueado no se mueve');
    assert.match(r.nota, /bloqueados \(no se mueven\): b/);
  });

  test('mover sólo en x y editar tipo con medidas', () => {
    let e = cuarto([[0, 0], [400, 0], [400, 300], [0, 300]], [], [caja('a', 100, 100)]);
    e = N.ejecutarOp(e, { op: 'mover', id: 'a', x: 150 }).espacio;
    assert.deepEqual([M(e)[0].x, M(e)[0].y], [150, 100]);
    e = N.ejecutarOp(e, { op: 'editar', id: 'a', tipo: 'escritorio', alto: 75 }).espacio;
    assert.deepEqual([M(e)[0].tipo, M(e)[0].alto, M(e)[0].huecoInferior], ['escritorio', 75, 65]);
  });

  test('plano en texto: L, muros finos o sin grosor y muebles pequeños', () => {
    const L = [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]];
    for (const grosor of [0, 5, 10]) {
      for (const ancho of [400, 720, 1100]) {
        const e = N.validarOLanzar({
          formato: 'espacios3d', version: 1,
          estancia: { contorno: [[0, 0], [ancho, 0], [ancho, 300], [0, 300]], grosorMuros: grosor, huecos: [{ id: 'v', tipo: 'ventana', muro: 0, desde: 100, ancho: 120 }] },
          muebles: [caja('m', 50, 290, 8, 8)],
        });
        const filas = N.planoTexto(e).split('\n');
        assert.match(filas[1], /#.*V/, `grosor ${grosor}, ancho ${ancho}: muro superior con ventana`);
        assert.ok(filas.some((f) => f.includes('A')), `grosor ${grosor}, ancho ${ancho}: la caja de 8×8 se ve`);
      }
    }
    const tL = N.planoTexto(N.validarOLanzar({ formato: 'espacios3d', version: 1, estancia: { contorno: L } }));
    const filasL = tL.split('\n').slice(1, 17);
    assert.ok(filasL.some((f) => /^#+\.{15,25}#+\s*$/.test(f)), 'el brazo vertical de la L (100 cm, unos 20 caracteres) se dibuja estrecho');
  });
});

describe('colocación contra muros', () => {
  test('giro desde cada muro: el frente mira hacia dentro', () => {
    const e = sala();
    assert.deepEqual([0, 1, 2, 3].map((i) => N.giroDesdeMuro(e, i)), [0, 90, 180, 270]);
  });

  test('posición contra el muro 1 (derecho), empezando a 75 cm de su vértice inicial', () => {
    const p = N.posicionContraMuro(sala(), { ancho: 150, fondo: 200 }, 1, 75);
    assert.deepEqual(p, { x: 300, y: 150, giro: 90 });
    assert.throws(() => N.posicionContraMuro(sala(), { ancho: 150, fondo: 200 }, 1, 200), /No cabe/);
    assert.throws(() => N.posicionContraMuro(sala(), { ancho: 50, fondo: 50 }, 7, 0), /No existe el muro 7/);
  });

  test('pegar a la pared más cercana conserva la posición a lo largo del muro', () => {
    const e = sala([], [caja('a', 120, 40, 100, 50)]);
    const r = N.pegarAPared(e, 'a');
    const m = M(r)[0];
    assert.deepEqual([m.x, m.y, m.giro], [120, 25, 0]);
    assert.deepEqual(reglas(r), []);
  });
});

describe('lotes de operaciones', () => {
  test('aplica todas o ninguna, y señala cuál falló', () => {
    const e = sala();
    const ok = N.ejecutarLote(e, [
      { op: 'hueco-agregar', tipo: 'ventana', muro: 0, desde: 150, ancho: 100 },
      { op: 'agregar', tipo: 'escritorio', muro: 0, desde: 140 },
      { op: 'agregar', tipo: 'silla', id: 'silla', x: 200, y: 80 },
      { op: 'girar', id: 'silla', sumar: 180 },
    ]);
    assert.equal(M(ok.espacio).length, 2);
    assert.equal(M(ok.espacio)[1].giro, 180);
    assert.equal(ok.notas.length, 4);
    assert.throws(() => N.ejecutarLote(e, [{ op: 'agregar', tipo: 'silla' }, { op: 'mover', id: 'nada', x: 1, y: 1 }]), /Operación 1 .*No se ha aplicado ninguna/s);
  });

  test('es estricto con las claves y los tipos', () => {
    const e = sala();
    assert.throws(() => N.ejecutarOp(e, { op: 'agregar', tipo: 'silla', anchura: 40 }), /no admite «anchura»/);
    assert.throws(() => N.ejecutarOp(e, { op: 'agregar', tipo: 'silla', x: '10', y: 10 }), /«x» debe ser un número/);
    assert.throws(() => N.ejecutarOp(e, { op: 'volar' }), /Operación desconocida/);
    assert.throws(() => N.ejecutarOp(e, { op: 'agregar', tipo: 'silla', x: 10 }), /«x» e «y» juntos/);
  });

  test('distribuciones: guardar, mover y volver; ids desaparecidos y nuevos se informan', () => {
    let e = sala([], [caja('a', 100, 100), caja('b', 200, 100)]);
    e = N.guardarDistribucion(e, 'Inicial');
    e = N.moverMueble(e, 'a', 300, 200);
    e = N.quitarMueble(e, 'b');
    e = N.agregarMueble(e, { tipo: 'caja', id: 'c', x: 50, y: 50 }).espacio;
    const r = N.ejecutarOp(e, { op: 'distribucion-aplicar', nombre: 'Inicial' });
    const a = M(r.espacio).find((m) => m.id === 'a');
    assert.deepEqual([a.x, a.y], [100, 100]);
    assert.match(r.nota, /ignorados \(ya no existen\): b/);
    assert.match(r.nota, /sin posición en ella \(no se mueven\): c/);
  });
});

describe('planos', () => {
  const e = sala(
    [
      { id: 'p', tipo: 'puerta', muro: 3, desde: 40, ancho: 80 },
      { id: 'v', tipo: 'ventana', muro: 0, desde: 150, ancho: 100 },
    ],
    [caja('a', 100, 100, 100, 60), caja('b', 140, 100, 100, 60)],
  );

  test('texto: letras, choque, muros, huecos, leyenda e incidencias, todo en ASCII salvo nombres', () => {
    const t = N.planoTexto(e);
    const filas = t.split('\n');
    assert.match(filas[1], /^#+V+#+$/, 'el muro superior lleva la ventana');
    assert.ok(t.includes('A') && t.includes('B') && t.includes('!'), 'muebles y choque');
    assert.ok(filas.some((f) => f.startsWith('P')), 'la puerta en el muro izquierdo');
    assert.match(t, /A {2}a «Caja» 100x60x80 cm en \(100, 100\)/);
    assert.match(t, /\[error\] «Caja» \(a\) y «Caja» \(b\) se solapan/);
  });

  test('SVG bien formado con un polígono por mueble y el barrido de la puerta', () => {
    const s = N.planoSVG(e);
    assert.match(s, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.equal((s.match(/<g><title>/g) || []).length, 2);
    assert.match(s, /stroke-dasharray/, 'barrido de la puerta');
    assert.match(s, /stroke="#c0392b"/, 'muebles con error en rojo');
    assert.ok(s.trim().endsWith('</svg>'));
  });
});

describe('CLI (subproceso contra dist/)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e3d-cli-'));
  const f = join(dir, 'sala.espacio.json');
  after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    return { codigo: r.status, out: r.stdout, err: r.stderr };
  };
  const json = (...args) => {
    const r = cli(...args, '--json');
    return { ...r, datos: JSON.parse(r.out) };
  };

  test('ayuda y comando desconocido', () => {
    assert.equal(cli('ayuda').codigo, 0);
    assert.match(cli('ayuda').out, /Salida: 0 bien/);
    assert.equal(cli().codigo, 3);
    assert.equal(cli('volar', f).codigo, 3);
  });

  test('flujo completo con códigos de salida y JSON ASCII', () => {
    assert.equal(cli('nuevo', f, '--ancho', '380', '--largo', '300', '--nombre', 'Habitación').codigo, 0);
    assert.equal(cli('nuevo', f, '--ancho', '1', '--largo', '1').codigo, 3, 'no sobrescribe sin --forzar');
    assert.equal(cli('hueco', 'agregar', f, '--tipo', 'puerta', '--muro', '3', '--desde', '30', '--ancho', '80').codigo, 0);
    const r = json('agregar', f, '--tipo', 'escritorio', '--muro', '0', '--desde', '130');
    assert.equal(r.codigo, 0);
    assert.equal(r.datos.escrito, true);
    assert.match(r.out, /^[\x00-\x7f]*$/, 'salida JSON sólo ASCII');
    const resumen = json('resumen', f);
    assert.equal(resumen.datos.nombre, 'Habitación');
    assert.equal(resumen.datos.plantas[0].muebles[0].giro, 0);
    assert.equal(resumen.datos.plantas[0].estancias[0].muros.length, 4);
    // Un armario en el barrido de la puerta: se escribe pero sale con 1 y lo dice en el JSON.
    const conError = json('agregar', f, '--tipo', 'armario', '--id', 'arm', '--x', '50', '--y', '230');
    assert.equal(conError.codigo, 1);
    assert.deepEqual([conError.datos.ok, conError.datos.escrito, conError.datos.errores], [false, true, 1]);
    assert.equal(cli('analizar', f).codigo, 1);
    // Con --exigir-sin-errores no se escribe y sale con 1.
    const antes = readFileSync(f, 'utf8');
    assert.equal(cli('mover', f, '--id', 'arm', '--dx', '5', '--exigir-sin-errores').codigo, 1);
    assert.equal(readFileSync(f, 'utf8'), antes);
    // --simular no escribe.
    assert.equal(cli('quitar', f, '--id', 'arm', '--simular').codigo, 0);
    assert.equal(readFileSync(f, 'utf8'), antes);
    assert.equal(cli('quitar', f, '--id', 'arm').codigo, 0);
    assert.equal(cli('analizar', f).codigo, 0);
    assert.match(cli('plano', f).out, /P/);
    const svg = join(dir, 'p.svg');
    assert.equal(cli('plano', f, '--svg', svg).codigo, 0);
    assert.match(readFileSync(svg, 'utf8'), /<svg/);
  });

  test('errores de uso y archivo inválido', () => {
    assert.equal(cli('mover', f, '--id', 'nada', '--x', '1', '--y', '1').codigo, 3);
    assert.equal(cli('mover', f, '--id', 'escritorio', '--x', 'diez').codigo, 3);
    assert.equal(cli('agregar', f, '--tipo', 'silla', '--anchura', '40').codigo, 3);
    const malo = join(dir, 'malo.espacio.json');
    writeFileSync(malo, '{"formato":"espacios3d","version":1,"cosa":1}');
    const r = json('validar', malo);
    assert.equal(r.codigo, 2);
    assert.equal(r.datos.ok, false);
    assert.ok(r.datos.detalles.some((d) => d.includes('cosa')));
    writeFileSync(malo, 'no json');
    assert.equal(cli('resumen', malo).codigo, 2);
  });

  test('lote atómico desde archivo', () => {
    const ops = join(dir, 'ops.json');
    writeFileSync(ops, JSON.stringify([{ op: 'agregar', tipo: 'silla', id: 'silla', x: 190, y: 90 }, { op: 'girar', id: 'silla', giro: 180 }]));
    const r = json('aplicar', f, '--ops', ops);
    assert.equal(r.codigo, 0);
    assert.equal(r.datos.cambios.length, 2);
    writeFileSync(ops, JSON.stringify([{ op: 'quitar', id: 'silla' }, { op: 'quitar', id: 'nada' }]));
    const antes = readFileSync(f, 'utf8');
    assert.equal(cli('aplicar', f, '--ops', ops).codigo, 3);
    assert.equal(readFileSync(f, 'utf8'), antes, 'nada aplicado');
  });

  test('escritura atómica: sin temporales huérfanos y el archivo siempre es JSON válido', () => {
    for (let i = 0; i < 5; i++) assert.equal(cli('mover', f, '--id', 'silla', '--dx', '1').codigo, 0);
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
    assert.ok(N.validar(JSON.parse(readFileSync(f, 'utf8'))).ok);
  });

  // Un proceso hijo con una precarga que intercepta fs simula a la página escribiendo a la vez.
  const conPrecarga = (codigoPrecarga, ...args) => {
    const precarga = join(dir, `precarga-${Math.random().toString(36).slice(2)}.cjs`);
    writeFileSync(precarga, codigoPrecarga);
    return spawnSync(process.execPath, ['--require', precarga, CLI, ...args], { encoding: 'utf8' });
  };
  const PAGINA = JSON.stringify('{"escrito":"por la página"}');

  test('si el archivo cambia entre la lectura y el renombrado, no se escribe', () => {
    writeFileSync(join(dir, 'copia.json'), readFileSync(f));
    const r = conPrecarga(
      `const fs=require('fs');const o=fs.writeFileSync;fs.writeFileSync=function(p,...a){const r=o.call(this,p,...a);if(String(p).endsWith('.tmp'))o.call(this,${JSON.stringify(f)},${PAGINA});return r;};`,
      'mover', f, '--id', 'silla', '--dx', '1',
    );
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /cambió mientras se editaba/);
    assert.equal(readFileSync(f, 'utf8'), JSON.parse(PAGINA), 'se conserva lo que escribió la página');
    assert.ok(!readdirSync(dir).some((n) => n.endsWith('.tmp')));
    writeFileSync(f, readFileSync(join(dir, 'copia.json')));
  });

  test('renombrado bloqueado (EPERM): reintenta; si entretanto la página escribe, no la pisa', () => {
    writeFileSync(join(dir, 'copia.json'), readFileSync(f));
    const antes = readFileSync(f, 'utf8');
    // 1) EPERM una vez y nada más: el reintento escribe.
    const ok = conPrecarga(
      `const fs=require('fs');const o=fs.renameSync;let n=0;fs.renameSync=function(...a){if(n++===0){const e=new Error('ocupado');e.code='EPERM';throw e;}return o.apply(this,a);};`,
      'mover', f, '--id', 'silla', '--dx', '1',
    );
    assert.equal(ok.status, 0, ok.stderr);
    assert.notEqual(readFileSync(f, 'utf8'), antes);
    // 2) EPERM porque la página está escribiendo: al reintentar ve el cambio y se detiene.
    const choque = conPrecarga(
      `const fs=require('fs');const o=fs.renameSync;let n=0;fs.renameSync=function(...a){if(n++===0){fs.writeFileSync(${JSON.stringify(f)},${PAGINA});const e=new Error('ocupado');e.code='EBUSY';throw e;}return o.apply(this,a);};`,
      'mover', f, '--id', 'silla', '--dx', '1',
    );
    assert.equal(choque.status, 3, choque.stderr);
    assert.equal(readFileSync(f, 'utf8'), JSON.parse(PAGINA));
    assert.ok(!readdirSync(dir).some((n) => n.endsWith('.tmp')));
    writeFileSync(f, readFileSync(join(dir, 'copia.json')));
    void utimesSync;
    void statSync;
    void existsSync;
  });

  test('un cambio que no cambia nada no reescribe el archivo', () => {
    const antes = statSync(f).mtimeMs;
    const r = json('mover', f, '--id', 'silla', '--dx', '0');
    assert.equal(r.datos.sinCambios, true);
    assert.equal(r.datos.escrito, false);
    assert.equal(statSync(f).mtimeMs, antes);
  });

  test('argumentos de más, opciones que no aplican y formas alternativas', () => {
    assert.match(cli('agregar', f, 'escritorio', '--tipo', 'cama').err, /Sobra «escritorio»/);
    assert.match(cli('agregar', f, '--tipo', 'silla', '--nombre', "'Mi", "silla'").err, /comillas dobles/);
    assert.match(cli('nuevo', join(dir, 'otro.json'), '--ancho', '100', '--largo', '100', '--simular').err, /no admite --simular/);
    assert.equal(cli('agregar', f, '--tipo=caja', '--id=c1', '--x=50', '--y=50', '--color', 'aabbcc').codigo, 0);
    assert.equal(M(JSON.parse(readFileSync(f, 'utf8'))).find((m) => m.id === 'c1').color, '#aabbcc');
    assert.match(cli('editar', f, '--id', 'c1', '--color').err, /comentario/);
    assert.equal(cli('estancia', f, '--grosor', '20').codigo, 0);
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).plantas[0].grosorExterior, 20);
    assert.match(cli('plano', f, '--svg', f).err, /propio archivo/);
    assert.equal(cli('plano', f, '--columnas', '0').codigo, 3);
    assert.match(json('plano', f).datos.texto, /Leyenda/);
  });

  test('ops en UTF-16 con marca, por la entrada estándar, y texto dañado', () => {
    const ops16 = join(dir, 'ops16.json');
    writeFileSync(ops16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify([{ op: 'renombrar', nombre: 'Salón' }]), 'utf16le')]));
    assert.equal(cli('aplicar', f, '--ops', ops16).codigo, 0);
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).nombre, 'Salón');
    const r = spawnSync(process.execPath, [CLI, 'aplicar', f, '--ops', '-'], { input: JSON.stringify([{ op: 'renombrar', nombre: 'Cuarto' }]), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).nombre, 'Cuarto');
    const malo = join(dir, 'ops-malo.json');
    writeFileSync(malo, JSON.stringify([{ op: 'renombrar', nombre: 'Sal�n' }]));
    assert.match(cli('aplicar', f, '--ops', malo).err, /caracteres dañados/);
  });

  test('mover contra un muro y combinaciones contradictorias', () => {
    const r = json('mover', f, '--id', 'silla', '--muro', '2', '--desde', '100');
    assert.equal(r.codigo === 0 || r.codigo === 1, true, r.out);
    const s = M(JSON.parse(readFileSync(f, 'utf8'))).find((m) => m.id === 'silla');
    assert.equal(s.giro, 180, 'mira hacia dentro desde el muro inferior');
    assert.match(cli('mover', f, '--id', 'silla', '--x', '10', '--dx', '5').err, /no los dos/);
    assert.match(cli('agregar', f, '--tipo', 'silla', '--muro', '0', '--desde', '10', '--giro', '90').err, /el giro lo da la pared/);
  });
});
