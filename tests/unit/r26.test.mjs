// R2-6: muebles hechos de piezas, modelos .glb propios (opcionales) y formas genéricas del núcleo.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const validador = createRequire(import.meta.url)('gltf-validator');
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const sala = (muebles) =>
  N.validarOLanzar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', estancias: [{ id: 's', contorno: rect(0, 0, 600, 500) }], muebles }] });

function leerGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const largo = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + largo)));
}

describe('formas genéricas como piezas', () => {
  test('cada tipo del catálogo, con sus medidas y con medidas extremas, da piezas que caben en el mueble', () => {
    const medidas = [null, [20, 20, 12], [300, 250, 240], [45, 12, 30], [11, 11, 11], [3, 60, 200], [21, 60, 200]];
    for (const t of N.CATALOGO) {
      for (const m of medidas) {
        const [ancho, fondo, alto] = m ?? [t.ancho, t.fondo, t.alto];
        const base = { tipo: t.tipo, ancho, fondo, alto, color: t.color, huecoInferior: Math.min(t.huecoInferior, alto - 1) };
        const piezas = N.formaGenerica(base);
        assert.ok(piezas.length >= 1, t.tipo);
        // Validar como si fueran piezas propias: el núcleo exige que quepan.
        const r = N.validar({ formato: 'espacios3d', version: 2, plantas: [{ id: 'pb', estancias: [{ id: 's', contorno: rect(0, 0, 600, 500) }], muebles: [{ id: 'm', ...base, x: 300, y: 250, piezas }] }] });
        assert.ok(r.ok, `${t.tipo} ${ancho}x${fondo}x${alto}: ${JSON.stringify(r.errores?.slice(0, 2))}`);
      }
    }
  });

  test('la cama lleva colchón y almohadas claros; la mesa, tablero y cuatro patas', () => {
    const cama = N.formaGenerica({ tipo: 'cama', ancho: 150, fondo: 200, alto: 50, color: '#c9b79c', huecoInferior: 0 });
    assert.equal(cama.filter((p) => p.color === N.COLOR_CLARO).length, 1);
    // Revisión independiente (F1): las almohadas asoman por encima del colchón y no se salen del mueble.
    const [colchon, ...almohadas] = cama.slice(1);
    assert.equal(almohadas.length, 2);
    for (const p of almohadas) {
      assert.equal(p.color, N.COLOR_ALMOHADA);
      assert.ok(p.z + p.alto > colchon.z + colchon.alto + 2 && p.z + p.alto <= 50, JSON.stringify([colchon, p]));
    }
    const mesa = N.formaGenerica({ tipo: 'mesa', ancho: 140, fondo: 80, alto: 75, color: '#b89a74', huecoInferior: 65 });
    assert.equal(mesa.length, 5);
    assert.deepEqual([mesa[0].z, mesa[0].alto], [65, 10]);
  });

  test('las piezas propias mandan sobre la forma genérica', () => {
    const piezas = [{ forma: 'esfera', x: 0, y: 0, z: 0, ancho: 30, fondo: 30, alto: 30, giro: 0 }];
    assert.deepEqual(N.piezasDe({ tipo: 'cama', ancho: 150, fondo: 200, alto: 50, color: '#c9b79c', huecoInferior: 0, piezas }), piezas);
    assert.equal(N.llevaMarcaDeFrente({ tipo: 'caja', piezas }), false);
    assert.equal(N.llevaMarcaDeFrente({ tipo: 'caja' }), true);
  });

  test('oscurecer multiplica cada canal', () => {
    assert.equal(N.oscurecer('#ff8040', 0.5), '#804020');
    assert.equal(N.oscurecer('#ffffff'), '#c2c2c2', '0,76 en sRGB ≈ 0,55 en lineal (revisión, F2)');
  });
});

describe('.glb con piezas y modelo', () => {
  const lampara = {
    id: 'lampara', tipo: 'lampara', ancho: 40, fondo: 40, alto: 160, x: 100, y: 100, color: '#888888',
    piezas: [
      { forma: 'cilindro', ancho: 30, alto: 3 },
      { forma: 'cilindro', z: 3, ancho: 3, alto: 120 },
      { forma: 'esfera', z: 123, ancho: 36, color: '#fff3c4' },
    ],
  };
  const sofa = {
    id: 'sofa', tipo: 'sofa', ancho: 200, fondo: 90, alto: 85, x: 300, y: 300, giro: 90, color: '#7d8a7a',
    piezas: [
      { forma: 'caja', ancho: 200, fondo: 90, alto: 42 },
      { forma: 'cuna', y: -30, z: 42, ancho: 200, fondo: 30, alto: 43 },
    ],
    modelo: { archivo: 'modelos/sofa.glb', giro: 180, ajuste: 'medidas' },
  };

  test('un nodo hijo por pieza, con su forma, en metros y dentro del mueble; glTF válido', async () => {
    const e = sala([lampara, sofa, { id: 'cama', tipo: 'cama', ancho: 150, fondo: 200, alto: 50, x: 450, y: 150 }]);
    const bytes = N.espacioAGLB(e);
    const informe = await validador.validateBytes(new Uint8Array(bytes), { maxIssues: 20 });
    assert.equal(informe.issues.numErrors, 0, JSON.stringify(informe.issues.messages.slice(0, 3)));
    const json = leerGLB(bytes);
    const nodo = (n) => json.nodes.find((x) => x.name === n);
    const hijos = (n) => nodo(n).children.map((i) => json.nodes[i]);
    assert.deepEqual(hijos('lampara').map((h) => h.extras.forma), ['cilindro', 'cilindro', 'esfera']);
    // La esfera empieza a 123 cm: su nodo va a 1,23 m (y arriba) y su malla llega a 1,23 + 0,36.
    const esfera = hijos('lampara')[2];
    assert.ok(Math.abs(esfera.translation[1] - 1.23) < 1e-9);
    const acc = json.accessors[json.meshes[esfera.mesh].primitives[0].attributes.POSITION];
    assert.ok(Math.abs(acc.max[1] - 0.36) < 1e-4 && Math.abs(acc.min[1]) < 1e-4, JSON.stringify(acc));
    // Color propio de la pieza.
    const mat = json.materials[json.meshes[esfera.mesh].primitives[0].material];
    assert.equal(mat.name, 'mueble #fff3c4');
    // La cuña: de 0 en el frente (+z) a su alto detrás.
    const cuna = json.accessors[json.meshes[hijos('sofa')[1].mesh].primitives[0].attributes.POSITION];
    assert.ok(Math.abs(cuna.max[1] - 0.43) < 1e-4);
    // El modelo propio va como referencia en «extras»; la cama genérica también va por piezas.
    assert.deepEqual(nodo('sofa').extras.modelo, { archivo: 'modelos/sofa.glb', giro: 180, ajuste: 'medidas' });
    assert.equal(nodo('sofa').extras.piezasDeReserva, true);
    assert.equal(nodo('lampara').extras.piezasDeReserva, undefined);
    assert.ok(hijos('cama').length >= 4);
  });

  test('cuña y esfera: cerradas y con las caras hacia fuera (volumen con signo = analítico)', async () => {
    const G = await import('../../build/glb.mjs');
    const volumen = ({ posiciones: p, indices: ix }) => {
      let v = 0;
      for (let i = 0; i < ix.length; i += 3) {
        const [a, b, c] = [ix[i] * 3, ix[i + 1] * 3, ix[i + 2] * 3];
        v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
      }
      return v;
    };
    assert.ok(Math.abs(volumen(G.mallaCuna(2, 3, 4)) - 12) < 1e-9);
    const esfera = volumen(G.mallaEsfera(1));
    assert.ok(esfera > 0 && Math.abs(esfera - (4 / 3) * Math.PI) / ((4 / 3) * Math.PI) < 0.05, String(esfera));
  });
});

describe('piezas y modelo por el lote y el CLI', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'Espacios3D', 'espacios3d.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'espacios3d-r26-'));
  // Se limpia al acabar el grupo, también si una prueba falla antes.
  after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
  const PIEZAS = [{ forma: 'caja', ancho: 200, fondo: 90, alto: 42 }, { forma: 'cuna', y: -30, z: 42, ancho: 200, fondo: 30, alto: 43 }];

  test('agregar y editar con piezas y modelo; null los quita', () => {
    let e = sala([]);
    e = N.ejecutarLote(e, [{ op: 'agregar', tipo: 'sofa', id: 'sofa', ancho: 200, fondo: 90, alto: 85, piezas: PIEZAS, modelo: 'modelos/sofa.glb' }]).espacio;
    let m = e.plantas[0].muebles[0];
    assert.equal(m.piezas.length, 2);
    assert.deepEqual(m.piezas[1], { forma: 'cuna', x: 0, y: -30, z: 42, ancho: 200, fondo: 30, alto: 43, giro: 0 });
    assert.deepEqual(m.modelo, { archivo: 'modelos/sofa.glb', giro: 0, ajuste: 'medidas' });
    e = N.ejecutarLote(e, [{ op: 'editar', id: 'sofa', modelo: { archivo: 'modelos/sofa.glb', giro: 90, ajuste: 'modelo' } }]).espacio;
    assert.deepEqual(e.plantas[0].muebles[0].modelo, { archivo: 'modelos/sofa.glb', giro: 90, ajuste: 'modelo' });
    e = N.ejecutarLote(e, [{ op: 'editar', id: 'sofa', piezas: null, modelo: null }]).espacio;
    m = e.plantas[0].muebles[0];
    assert.equal(m.piezas, undefined);
    assert.equal(m.modelo, undefined);
  });

  test('una pieza que no cabe o un modelo fuera de la carpeta se rechazan con su ruta', () => {
    const e = sala([{ id: 'm', tipo: 'caja', ancho: 50, fondo: 50, alto: 50, x: 100, y: 100 }]);
    assert.throws(() => N.ejecutarLote(e, [{ op: 'editar', id: 'm', piezas: [{ forma: 'esfera', ancho: 60 }] }]), /piezas\[0\].*se sale del mueble/);
    assert.throws(() => N.ejecutarLote(e, [{ op: 'editar', id: 'm', modelo: '../fuera.glb' }]), /modelo\.archivo/);
    assert.throws(() => N.ejecutarLote(e, [{ op: 'editar', id: 'm', piezas: 'caja' }]), /lista de piezas/);
    assert.throws(() => N.ejecutarLote(e, [{ op: 'editar', id: 'm', modelo: { archivo: 'm.glb', giro: 45 } }]), /modelo\.giro: debe ser 0, 90, 180 o 270/);
  });

  test('CLI: --piezas en JSON, --modelo con ruta y --modelo ninguno', () => {
    const f = join(dir, 'p.espacio.json');
    assert.equal(cli('nuevo', f, '--ancho', '400', '--largo', '300').status, 0);
    let r = cli('agregar', f, '--tipo', 'sofa', '--id', 'sofa', '--piezas', JSON.stringify(PIEZAS), '--modelo', 'modelos/sofa.glb');
    assert.equal(r.status, 0, r.stderr);
    let m = JSON.parse(readFileSync(f, 'utf8')).plantas[0].muebles[0];
    assert.equal(m.piezas.length, 2);
    assert.equal(m.modelo.archivo, 'modelos/sofa.glb');
    r = cli('editar', f, '--id', 'sofa', '--modelo', 'ninguno', '--piezas', 'null');
    assert.equal(r.status, 0, r.stderr);
    m = JSON.parse(readFileSync(f, 'utf8')).plantas[0].muebles[0];
    assert.equal(m.piezas, undefined);
    assert.equal(m.modelo, undefined);
    r = cli('editar', f, '--id', 'sofa', '--piezas', '[{forma:caja}]');
    assert.equal(r.status, 3, 'error de uso');
    assert.match(r.stderr, /--piezas no es JSON válido/);
  });
});

describe('«Mis muebles»', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'Espacios3D', 'espacios3d.mjs');
  const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });

  test('validación: reglas del mueble, rutas dentro del archivo y nombres sin repetir', () => {
    const ok = N.validarMisMuebles({ formato: 'espacios3d-muebles', version: 1, muebles: [{ nombre: 'Lámpara', tipo: 'lampara', ancho: 40, fondo: 40, alto: 160, piezas: [{ forma: 'esfera', z: 120, ancho: 40 }] }] });
    assert.ok(ok.ok);
    assert.equal(ok.misMuebles.muebles[0].piezas[0].alto, 40);
    assert.equal(ok.misMuebles.muebles[0].color, '#9aa3ab', 'color por defecto del tipo desconocido (caja)');
    const mal = N.validarMisMuebles({ formato: 'espacios3d-muebles', version: 1, muebles: [{ nombre: 'A', tipo: 'caja', ancho: -1 }, { nombre: 'B', tipo: 'caja', x: 3 }] });
    assert.ok(!mal.ok);
    assert.match(mal.errores.join('\n'), /muebles\[1\]\.x: no se guarda/);
    const malo2 = N.validarMisMuebles({ formato: 'espacios3d-muebles', version: 1, muebles: [{ nombre: 'A', tipo: 'caja', ancho: -1 }] });
    assert.match(malo2.errores.join('\n'), /^muebles\[0\]\.ancho/m);
    const rep = N.validarMisMuebles({ formato: 'espacios3d-muebles', version: 1, muebles: [{ nombre: 'A', tipo: 'caja', ancho: 10, fondo: 10, alto: 10 }, { nombre: 'A', tipo: 'silla', ancho: 40, fondo: 40, alto: 80 }] });
    assert.match(rep.errores.join(), /ya hay otro «A»/);
    assert.ok(!N.validarMisMuebles({ formato: 'otro', version: 1, muebles: [] }).ok);
  });

  test('CLI: guardar un mueble con piezas, listarlo, usarlo en otro espacio de la carpeta y quitarlo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'espacios3d-mm-'));
    try {
      const a = join(dir, 'a.espacio.json');
      const b = join(dir, 'b.espacio.json');
      assert.equal(cli('nuevo', a, '--ancho', '400', '--largo', '300').status, 0);
      assert.equal(cli('nuevo', b, '--ancho', '500', '--largo', '400').status, 0);
      const piezas = JSON.stringify([{ forma: 'caja', ancho: 200, fondo: 90, alto: 42 }, { forma: 'cuna', y: -30, z: 42, ancho: 200, fondo: 30, alto: 43 }]);
      assert.equal(cli('agregar', a, '--tipo', 'sofa', '--id', 'sofa', '--color', '445566', '--piezas', piezas).status, 0);
      let r = cli('muebles', 'guardar', a, '--id', 'sofa', '--nombre', 'Sofá rinconero');
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(join(dir, 'mis-muebles.json')));
      r = cli('muebles', 'listar', dir, '--json');
      const lista = JSON.parse(r.stdout);
      assert.deepEqual(lista.muebles.map((m) => [m.nombre, m.color, m.piezas.length]), [['Sofá rinconero', '#445566', 2]]);
      assert.match(cli('muebles', 'listar', b).stdout, /«Sofá rinconero» sofa 200x90x85 cm #445566, 2 piezas/);
      r = cli('agregar', b, '--mio', 'sofá rinconero', '--x', '250', '--y', '200', '--giro', '90');
      assert.equal(r.status, 0, r.stderr);
      const m = JSON.parse(readFileSync(b, 'utf8')).plantas[0].muebles[0];
      assert.deepEqual([m.nombre, m.color, m.piezas.length, m.x, m.giro], ['Sofá rinconero', '#445566', 2, 250, 90]);
      assert.match(cli('agregar', b, '--mio', 'Butaca').stderr, /No hay «Butaca».*Sofá rinconero/);
      // Revisión independiente (M7): «mio» también en los lotes; aviso si el modelo no está; carpeta que no existe.
      const ops = join(dir, 'ops.json');
      writeFileSync(ops, JSON.stringify([{ op: 'agregar', mio: 'Sofá rinconero', id: 'otro', x: 100, y: 100 }]));
      r = cli('aplicar', b, '--ops', ops);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(readFileSync(b, 'utf8')).plantas[0].muebles.find((x) => x.id === 'otro').piezas.length, 2);
      r = cli('agregar', b, '--tipo', 'caja', '--id', 'con-modelo', '--modelo', 'modelos/no-esta.glb', '--x', '450', '--y', '350');
      assert.ok([0, 1].includes(r.status), r.stderr); // 1 = el espacio tiene incidencias (el sofá «otro»), no un fallo de la orden
      assert.match(r.stdout, /aviso: no existe modelos\/no-esta\.glb/);
      r = cli('muebles', 'listar', join(dir, 'no-existe'));
      assert.equal(r.status, 3);
      assert.match(r.stderr, /No existe/);
      // Guardar con el mismo nombre sustituye.
      assert.match(cli('muebles', 'guardar', a, '--id', 'sofa', '--nombre', 'Sofá rinconero').stdout, /sustituido/);
      assert.equal(cli('muebles', 'quitar', b, '--nombre', 'Sofá rinconero').status, 0);
      assert.equal(JSON.parse(readFileSync(join(dir, 'mis-muebles.json'), 'utf8')).muebles.length, 0);
      // Un mis-muebles.json estropeado se rechaza con la ruta del error.
      writeFileSync(join(dir, 'mis-muebles.json'), JSON.stringify({ formato: 'espacios3d-muebles', version: 1, muebles: [{ nombre: 'X', tipo: 'caja', alto: 0 }] }));
      r = cli('muebles', 'listar', dir);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /muebles\[0\]\.alto/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('varios muebles a la vez', () => {
  const tres = () =>
    sala([
      { id: 'mesa', tipo: 'mesa', ancho: 140, fondo: 80, alto: 75, x: 300, y: 250 },
      { id: 's1', tipo: 'silla', ancho: 45, fondo: 50, alto: 90, x: 300, y: 190, giro: 180 },
      { id: 's2', tipo: 'silla', ancho: 45, fondo: 50, alto: 90, x: 300, y: 310 },
    ]);
  const pos = (e, id) => { const m = e.plantas[0].muebles.find((x) => x.id === id); return [m.x, m.y, m.giro]; };

  test('girar 90° el conjunto alrededor de su centro: la mesa gira en su sitio y las sillas la rodean', () => {
    const e = N.girarGrupo(tres(), ['mesa', 's1', 's2'], 90);
    assert.deepEqual(pos(e, 'mesa'), [300, 250, 90]);
    assert.deepEqual(pos(e, 's1'), [360, 250, 270]);
    assert.deepEqual(pos(e, 's2'), [240, 250, 90]);
    // Cuatro giros de 90° lo dejan como estaba.
    let r = e;
    for (let i = 0; i < 3; i++) r = N.girarGrupo(r, ['mesa', 's1', 's2'], 90);
    assert.deepEqual(['mesa', 's1', 's2'].map((id) => pos(r, id)), ['mesa', 's1', 's2'].map((id) => pos(tres(), id)));
  });

  test('mover, duplicar y quitar el conjunto; con uno bloqueado no cambia ninguno', () => {
    let e = N.moverGrupo(tres(), ['s1', 's2'], 10, -5);
    assert.deepEqual([pos(e, 's1').slice(0, 2), pos(e, 's2').slice(0, 2), pos(e, 'mesa').slice(0, 2)], [[310, 185], [310, 305], [300, 250]]);
    const d = N.duplicarGrupo(e, ['mesa', 's1']);
    assert.deepEqual(d.ids, ['mesa-2', 's1-2']);
    assert.deepEqual(pos(d.espacio, 'mesa-2').slice(0, 2), [320, 270]);
    e = N.quitarGrupo(d.espacio, ['mesa-2', 's1-2']);
    assert.equal(e.plantas[0].muebles.length, 3);
    const bloq = N.ejecutarLote(tres(), [{ op: 'editar', id: 's2', bloqueado: true }]).espacio;
    assert.throws(() => N.moverGrupo(bloq, ['s1', 's2'], 10, 0), /bloqueado/);
    assert.throws(() => N.girarGrupo(bloq, ['s1', 's2'], 90), /bloqueado/);
    assert.throws(() => N.moverGrupo(tres(), [], 1, 1), /No hay muebles/);
  });
});

describe('cinta métrica', () => {
  const e = sala([{ id: 'mesa', tipo: 'mesa', ancho: 100, fondo: 60, alto: 75, x: 300, y: 250 }]);
  const pl = e.plantas[0];
  test('se pega a la esquina más cercana (estancia o mueble), si no a la pared, y si no queda libre', () => {
    assert.deepEqual(N.imanCinta(pl, [3, 4], 10), { punto: [0, 0], pegado: 'esquina' });
    assert.deepEqual(N.imanCinta(pl, [254, 224], 10), { punto: [250, 220], pegado: 'esquina' }, 'esquina de la mesa');
    assert.deepEqual(N.imanCinta(pl, [120, 6], 10), { punto: [120, 0], pegado: 'pared' });
    assert.deepEqual(N.imanCinta(pl, [120, 60], 10), { punto: [120, 60], pegado: null });
  });
  test('medida: distancia y componentes', () => {
    assert.deepEqual(N.medirCinta([0, 0], [300, 400]), { distancia: 500, dx: 300, dy: 400 });
  });
});
