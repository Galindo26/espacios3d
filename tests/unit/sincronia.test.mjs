// Pruebas de la sincronía página↔archivo (build/sincronia.mjs) y del historial (build/estado.mjs).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';
import { Estado } from '../../build/estado.mjs';
import { Sincronizador } from '../../build/sincronia.mjs';

// Muebles de la primera planta (formato v2).
const M = (e) => N.planta(e).muebles;

/** Disco falso con varios archivos y un almacén que se vincula a uno de ellos. */
class Disco {
  constructor() {
    this.archivos = new Map();
    this.lm = 0;
  }
  escribir(nombre, texto) {
    this.archivos.set(nombre, { texto, lm: ++this.lm });
  }
  leer(nombre) {
    const a = this.archivos.get(nombre);
    return a ? { ...a } : null;
  }
}

class AlmacenFalso {
  constructor(disco, nombre = null) {
    this.tipo = 'prueba';
    this.disco = disco;
    this.nombre = nombre;
    this.fallar = 0;
    this.alEscribir = null;
  }
  nombreArchivo() {
    return this.nombre;
  }
  vinculado() {
    return this.nombre !== null;
  }
  async abrir() {
    return null;
  }
  async guardar(texto) {
    if (this.fallar > 0) {
      this.fallar--;
      throw new Error('disco ocupado');
    }
    this.disco.escribir(this.nombre, texto);
    if (this.alEscribir) {
      const f = this.alEscribir;
      this.alEscribir = null;
      await f();
    }
  }
  async guardarComo(texto, sugerido) {
    if (this.cancelarComo) return false;
    this.nombre = sugerido;
    await this.guardar(texto);
    return true;
  }
  async leer() {
    if (this.fallarLeer > 0) {
      this.fallarLeer--;
      throw new Error('archivo ocupado');
    }
    return this.nombre ? this.disco.leer(this.nombre) : null;
  }
}

function montar({ arrastrando = () => false } = {}) {
  const disco = new Disco();
  const almacen = new AlmacenFalso(disco);
  const reg = { estados: [], cargas: [], bloqueos: [], guardados: 0, programados: [] };
  const reloj = {
    poner: (f, ms) => {
      reg.programados.push(ms);
      return f;
    },
    quitar: () => {},
    hora: () => '10:00',
  };
  const sinc = new Sincronizador(
    almacen,
    {
      estado: (t, c) => reg.estados.push([t, c]),
      cargar: (e, m) => reg.cargas.push([e, m]),
      bloqueo: (e) => reg.bloqueos.push(e),
      guardado: () => reg.guardados++,
      arrastrando,
    },
    reloj,
    600,
  );
  return { disco, almacen, sinc, reg };
}

const espacio = (x = 100) => {
  const { espacio: e } = N.agregarMueble(N.nuevoEspacio({ ancho: 300, largo: 300 }), { tipo: 'caja', x, y: 100 });
  return e;
};

async function vinculado(ctx, e = espacio()) {
  ctx.disco.escribir('a.espacio.json', N.aJSON(e));
  ctx.almacen.nombre = 'a.espacio.json';
  ctx.sinc.establecer(e);
  await ctx.sinc.vincular({ texto: N.aJSON(e), nombre: 'a.espacio.json', aceptar: async () => {} }, e);
  return e;
}

const xEnDisco = (ctx, nombre = 'a.espacio.json') => M(JSON.parse(ctx.disco.leer(nombre).texto))[0].x;

describe('sincronía con el archivo', () => {
  test('autoguarda un cambio y deja de estar pendiente', async () => {
    const c = montar();
    await vinculado(c);
    c.sinc.cambioLocal(espacio(150));
    assert.ok(c.sinc.pendiente);
    await c.sinc.guardarAhora();
    assert.equal(xEnDisco(c), 150);
    assert.equal(c.sinc.pendiente, false);
    assert.ok(c.reg.guardados >= 1);
  });

  test('conflicto: el archivo cambió fuera con cambios pendientes → gana el archivo y se avisa', async () => {
    const c = montar();
    await vinculado(c);
    c.sinc.cambioLocal(espacio(150));
    c.disco.escribir('a.espacio.json', N.aJSON(espacio(222))); // el agente
    await c.sinc.guardarAhora();
    assert.equal(xEnDisco(c), 222, 'no se pisa al agente');
    assert.equal(c.reg.cargas.length, 1);
    assert.match(c.reg.cargas[0][1], /descartado/);
    assert.equal(c.sinc.pendiente, false);
  });

  test('cambio de fecha sin cambio de contenido no es conflicto', async () => {
    const c = montar();
    const e = await vinculado(c);
    c.disco.escribir('a.espacio.json', N.aJSON(e)); // mismo texto, otra fecha
    c.sinc.cambioLocal(espacio(150));
    await c.sinc.guardarAhora();
    assert.equal(xEnDisco(c), 150);
    assert.equal(c.reg.cargas.length, 0);
  });

  test('archivo cambiado fuera con errores: bloquea el autoguardado hasta que se arregla', async () => {
    const c = montar();
    await vinculado(c);
    c.disco.escribir('a.espacio.json', '{"formato":"espacios3d","version":1,"raro":1}');
    await c.sinc.sondear();
    assert.ok(c.sinc.bloqueadoPor && c.sinc.bloqueadoPor.length > 0);
    assert.ok(c.reg.bloqueos.at(-1));
    c.sinc.cambioLocal(espacio(150));
    await c.sinc.guardarAhora();
    assert.match(c.disco.leer('a.espacio.json').texto, /raro/, 'no se escribe encima del archivo con errores');
    c.disco.escribir('a.espacio.json', N.aJSON(espacio(260))); // el agente lo arregla
    await c.sinc.sondear();
    assert.equal(c.sinc.bloqueadoPor, null);
    assert.equal(c.reg.bloqueos.at(-1), null);
    assert.equal(M(c.reg.cargas.at(-1)[0])[0].x, 260);
  });

  test('«Guardar mi versión» escribe encima aunque esté bloqueado', async () => {
    const c = montar();
    await vinculado(c);
    c.disco.escribir('a.espacio.json', 'no es json');
    await c.sinc.sondear();
    c.sinc.cambioLocal(espacio(150));
    await c.sinc.guardarAhora(true);
    assert.equal(xEnDisco(c), 150);
    assert.equal(c.sinc.bloqueadoPor, null);
  });

  test('un fallo de escritura se reintenta con espera creciente', async () => {
    const c = montar();
    await vinculado(c);
    c.almacen.fallar = 2;
    c.sinc.cambioLocal(espacio(150));
    c.reg.programados.length = 0;
    await c.sinc.guardarAhora();
    await c.sinc.guardarAhora();
    assert.deepEqual(c.reg.programados, [1000, 2000]);
    assert.ok(c.sinc.pendiente);
    await c.sinc.guardarAhora();
    assert.equal(xEnDisco(c), 150);
    assert.equal(c.sinc.pendiente, false);
  });

  test('un cambio durante la escritura queda pendiente y se vuelve a programar', async () => {
    const c = montar();
    await vinculado(c);
    c.sinc.cambioLocal(espacio(150));
    c.almacen.alEscribir = async () => c.sinc.cambioLocal(espacio(160));
    await c.sinc.guardarAhora();
    assert.ok(c.sinc.pendiente, 'el 160 aún no está en el archivo');
    await c.sinc.guardarAhora();
    assert.equal(xEnDisco(c), 160);
  });

  test('un agente que escribe justo después de nuestra escritura no queda absorbido', async () => {
    const c = montar();
    await vinculado(c);
    c.sinc.cambioLocal(espacio(150));
    c.almacen.alEscribir = async () => c.disco.escribir('a.espacio.json', N.aJSON(espacio(275)));
    await c.sinc.guardarAhora();
    await c.sinc.sondear();
    assert.equal(M(c.reg.cargas.at(-1)[0])[0].x, 275);
  });

  test('en pleno arrastre el sondeo no cambia el espacio; después sí', async () => {
    let arr = true;
    const c = montar({ arrastrando: () => arr });
    await vinculado(c);
    c.disco.escribir('a.espacio.json', N.aJSON(espacio(222)));
    await c.sinc.sondear();
    assert.equal(c.reg.cargas.length, 0);
    arr = false;
    await c.sinc.sondear();
    assert.equal(c.reg.cargas.length, 1);
  });

  test('«Guardar como» desde un archivo vinculado no carga el contenido viejo del destino', async () => {
    const c = montar();
    await vinculado(c);
    c.disco.escribir('b.espacio.json', N.aJSON(espacio(10))); // contenido viejo de B
    c.sinc.cambioLocal(espacio(150));
    const como = c.sinc.guardarComo('b.espacio.json');
    const sondeo = c.sinc.sondear(); // intenta colarse en mitad
    assert.equal(await como, true);
    await sondeo;
    await c.sinc.sondear();
    assert.equal(xEnDisco(c, 'b.espacio.json'), 150);
    assert.equal(c.reg.cargas.length, 0);
    assert.equal(c.sinc.pendiente, false);
  });

  test('«Guardar como» cancelado vuelve a programar el guardado pendiente en el archivo vinculado (N1)', async () => {
    const c = montar();
    await vinculado(c);
    c.sinc.cambioLocal(espacio(150));
    c.almacen.cancelarComo = true;
    c.reg.programados.length = 0;
    assert.equal(await c.sinc.guardarComo('b.espacio.json'), false);
    assert.deepEqual(c.reg.programados, [600], 'se reprograma el autoguardado');
    await c.sinc.guardarAhora();
    assert.equal(xEnDisco(c), 150);
    assert.equal(c.sinc.pendiente, false);
  });

  test('si el archivo no se puede leer justo después de escribir, no se toma la escritura propia por externa (N2)', async () => {
    const c = montar();
    await vinculado(c);
    c.sinc.cambioLocal(espacio(150));
    c.almacen.alEscribir = async () => {
      c.almacen.fallarLeer = 1;
    };
    await c.sinc.guardarAhora();
    assert.equal(c.sinc.pendiente, false);
    await c.sinc.sondear(); // relee: es nuestro texto
    c.sinc.cambioLocal(espacio(160));
    await c.sinc.guardarAhora();
    assert.equal(xEnDisco(c), 160, 'el siguiente cambio se guarda');
    assert.equal(c.reg.cargas.length, 0, 'sin cargas falsas');
  });

  test('si falla la lectura al vincular, lo leído al abrir cuenta como conocido (N2)', async () => {
    const c = montar();
    const e = espacio();
    c.disco.escribir('a.espacio.json', N.aJSON(e));
    c.almacen.nombre = 'a.espacio.json';
    c.almacen.fallarLeer = 1;
    await c.sinc.vincular({ texto: N.aJSON(e), nombre: 'a.espacio.json', aceptar: async () => {} }, e);
    c.sinc.cambioLocal(espacio(150));
    await c.sinc.guardarAhora();
    assert.equal(xEnDisco(c), 150);
    assert.equal(c.reg.cargas.length, 0);
  });

  test('los cambios hechos mientras el archivo tenía errores se descartan con aviso explícito', async () => {
    const c = montar();
    await vinculado(c);
    c.disco.escribir('a.espacio.json', 'roto');
    await c.sinc.sondear();
    c.sinc.cambioLocal(espacio(150));
    c.disco.escribir('a.espacio.json', N.aJSON(espacio(260)));
    await c.sinc.sondear();
    assert.match(c.reg.cargas.at(-1)[1], /descartado los cambios que hiciste mientras tenía errores/);
  });

  test('sin archivo vinculado nada se escribe y queda pendiente', async () => {
    const c = montar();
    c.sinc.establecer(espacio());
    c.sinc.cambioLocal(espacio(150));
    await c.sinc.guardarAhora();
    assert.equal(c.disco.archivos.size, 0);
    assert.ok(c.sinc.pendiente);
    assert.match(c.reg.estados.at(-1)[0], /Guardar como/);
  });
});

describe('historial', () => {
  const e0 = espacio(100);
  const e1 = espacio(110);
  const e2 = espacio(120);
  const e3 = espacio(130);

  test('aplicar, deshacer y rehacer', () => {
    const h = new Estado(e0);
    h.aplicar(e1);
    h.aplicar(e2);
    h.deshacer();
    assert.equal(h.espacio, e1);
    h.rehacer();
    assert.equal(h.espacio, e2);
    h.deshacer();
    h.aplicar(e3);
    assert.equal(h.puedeRehacer(), false, 'un cambio nuevo borra lo rehacible');
  });

  test('un cambio idéntico no entra en el historial', () => {
    const h = new Estado(e0);
    h.aplicar(JSON.parse(JSON.stringify(e0)));
    assert.equal(h.puedeDeshacer(), false);
  });

  test('cambios fusionados cuentan como uno; cortar la fusión separa', () => {
    const h = new Estado(e0);
    h.aplicar(e1, 'empujar:caja');
    h.aplicar(e2, 'empujar:caja');
    h.aplicar(e3, 'empujar:caja');
    h.deshacer();
    assert.equal(h.espacio, e0, 'una sola entrada para la flecha mantenida');
    h.rehacer();
    h.cortarFusion();
    h.aplicar(e1, 'empujar:caja');
    h.deshacer();
    assert.equal(h.espacio, e3);
  });

  test('reemplazar (archivo) borra el historial y corrige la selección', () => {
    const h = new Estado(e0);
    h.aplicar(e1);
    h.seleccionar('caja');
    h.reemplazar(N.nuevoEspacio({ ancho: 100, largo: 100 }));
    assert.equal(h.puedeDeshacer(), false);
    assert.equal(h.seleccion, null);
  });
});
