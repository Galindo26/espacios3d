// Pruebas del núcleo (se ejecutan contra build/core.mjs, que genera scripts/build.mjs).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as N from '../../build/core.mjs';

const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const cercaP = (p, q, tol = 1e-6) => {
  cerca(p[0], q[0], tol);
  cerca(p[1], q[1], tol);
};

function base(muebles = [], extra = {}) {
  return {
    formato: 'espacios3d',
    version: 1,
    nombre: 'Prueba',
    estancia: { contorno: [[0, 0], [400, 0], [400, 300], [0, 300]], altura: 250, grosorMuros: 10, huecos: [] },
    muebles,
    ...extra,
  };
}
// Accesos v2: primera estancia de la primera planta y sus muebles (base() es un archivo de la v1
// a propósito: validar() lo convierte, así que todas estas pruebas cubren también la migración).
const E = (e) => N.estancia(e).estancia;
const M = (e) => N.planta(e).muebles;
const mueble = (id, x, y, ancho = 100, fondo = 50, extra = {}) => ({ id, tipo: 'caja', ancho, fondo, alto: 80, x, y, ...extra });

describe('geometría', () => {
  test('área con signo y normal interior en ambos sentidos', () => {
    const horario = [[0, 0], [400, 0], [400, 300], [0, 300]];
    const anti = [...horario].reverse();
    assert.ok(N.areaConSigno(horario) > 0);
    assert.ok(N.areaConSigno(anti) < 0);
    // El muro superior (y = 0) tiene el interior hacia +y en los dos sentidos.
    cercaP(N.normalInterior(horario, 0), [0, 1]);
    const iSup = anti.findIndex((p, i) => p[1] === 0 && anti[(i + 1) % 4][1] === 0);
    cercaP(N.normalInterior(anti, iSup), [0, 1]);
  });

  test('esquinas y frente de un mueble asimétrico (giro 0 → frente a +y; 90 → frente a −x)', () => {
    const m = { x: 100, y: 100, giro: 0, ancho: 100, fondo: 40 };
    const e0 = N.esquinasMueble(m);
    cercaP(e0[0], [50, 80]);
    cercaP(e0[2], [150, 120]);
    cercaP(N.ejesMueble(0).v, [0, 1]);
    // Giro horario de 90° visto desde arriba (y hacia abajo): el frente pasa de abajo a la izquierda.
    cercaP(N.ejesMueble(90).v, [-1, 0]);
    const e90 = N.esquinasMueble({ ...m, giro: 90 });
    const xs = e90.map((p) => p[0]);
    const ys = e90.map((p) => p[1]);
    cerca(Math.max(...xs) - Math.min(...xs), 40);
    cerca(Math.max(...ys) - Math.min(...ys), 100);
  });

  test('conversión a three.js: el frente girado coincide con rotation.y', () => {
    for (const giro of [0, 30, 90, 180, 270]) {
      const r = N.rotacionY(giro);
      // Vector local (0, 0, 1) de three rotado alrededor de Y: (sin r, 0, cos r).
      const frenteTres = [Math.sin(r), Math.cos(r)];
      const { v } = N.ejesMueble(giro);
      const vTres = N.aTres(v[0], v[1]);
      cercaP(frenteTres, [vTres.X * 100, vTres.Z * 100]);
    }
  });

  test('solape: a ras no cuenta, metido sí, y con giro 45°', () => {
    const a = N.esquinasMueble({ x: 50, y: 50, giro: 0, ancho: 100, fondo: 100 });
    const ras = N.esquinasMueble({ x: 150, y: 50, giro: 0, ancho: 100, fondo: 100 });
    const dentro = N.esquinasMueble({ x: 140, y: 50, giro: 0, ancho: 100, fondo: 100 });
    assert.equal(N.solapeConvexos(a, ras), 0);
    cerca(N.solapeConvexos(a, dentro), 10);
    const rombo = N.esquinasMueble({ x: 160, y: 50, giro: 45, ancho: 30, fondo: 30 });
    assert.equal(N.solapeConvexos(a, rombo), 0); // su vértice izquierdo queda en x ≈ 138,8
  });

  test('contenido en estancia en L: el vértice reentrante cuenta', () => {
    const L = [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]];
    assert.ok(N.convexoDentroDePoligono(N.esquinasMueble({ x: 50, y: 150, giro: 0, ancho: 100, fondo: 300 }), L));
    // Cubre el hueco de la L: sus esquinas caen dentro pero el vértice (100,100) se mete.
    const tapa = N.esquinasMueble({ x: 150, y: 150, giro: 0, ancho: 300, fondo: 100 });
    assert.equal(N.convexoDentroDePoligono(tapa, L), false);
  });

  test('contenido en estancia en U: atravesar el hueco central sin esquinas fuera no cuenta como dentro', () => {
    const U = [[0, 0], [300, 0], [300, 300], [200, 300], [200, 100], [100, 100], [100, 300], [0, 300]];
    // Esquinas en los dos brazos de la U; el tramo central cruza el exterior.
    const puente = N.esquinasMueble({ x: 150, y: 200, giro: 0, ancho: 200, fondo: 50 });
    assert.ok(puente.every((p) => N.puntoDentroOBorde(p, U)), 'las cuatro esquinas están dentro');
    assert.equal(N.convexoDentroDePoligono(puente, U), false);
    assert.ok(N.convexoDentroDePoligono(N.esquinasMueble({ x: 50, y: 200, giro: 0, ancho: 100, fondo: 100 }), U), 'a ras del brazo sí cabe');
  });

  test('contención frente a muestreo de puntos en una U (300 casos con semilla fija)', () => {
    const U = [[0, 0], [300, 0], [300, 300], [200, 300], [200, 100], [100, 100], [100, 300], [0, 300]];
    let s = 12345;
    const azar = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    let dentros = 0;
    for (let k = 0; k < 300; k++) {
      const m = { x: azar() * 300, y: azar() * 300, giro: azar() * 360, ancho: 10 + azar() * 150, fondo: 10 + azar() * 80 };
      if (!N.convexoDentroDePoligono(N.esquinasMueble(m), U)) continue;
      dentros++;
      // Todo punto de la huella debe estar dentro o a menos de 1 cm del borde.
      for (let i = 0; i <= 10; i++) {
        for (let j = 0; j <= 10; j++) {
          const p = N.localAPlanta(m, (i / 10 - 0.5) * m.ancho, (j / 10 - 0.5) * m.fondo);
          assert.ok(N.puntoEnPoligono(p, U) || N.distanciaAlContorno(p, U) < 1, `caso ${k}: punto ${p} fuera`);
        }
      }
    }
    assert.ok(dentros > 10, `hay suficientes casos dentro (${dentros})`);
  });

  test('límite de inglete en ángulos muy agudos', () => {
    const aguja = [[0, 0], [400, 0], [0, 10]];
    for (const p of N.contornoExterior(aguja, 10)) assert.ok(Math.hypot(p[0], p[1] - 5) < 450, `vértice exterior disparado: ${p}`);
  });

  test('contorno exterior de los muros con inglete', () => {
    const ext = N.contornoExterior([[0, 0], [400, 0], [400, 300], [0, 300]], 10);
    cercaP(ext[0], [-10, -10]);
    cercaP(ext[2], [410, 310]);
  });

  test('polígono simple', () => {
    assert.ok(N.esPoligonoSimple([[0, 0], [10, 0], [10, 10], [0, 10]]));
    assert.equal(N.esPoligonoSimple([[0, 0], [10, 10], [10, 0], [0, 10]]), false);
  });
});

describe('validar', () => {
  test('rellena valores por defecto y normaliza el giro', () => {
    const r = N.validar(base([{ id: 'cama', tipo: 'cama', ancho: 150, fondo: 200, alto: 50, x: 200, y: 150, giro: -90 }]));
    assert.ok(r.ok, JSON.stringify(r));
    const m = M(r.espacio)[0];
    assert.equal(m.giro, 270);
    assert.equal(m.nombre, 'Cama');
    assert.equal(m.holguraFrente, 60);
    assert.equal(m.elevacion, 0);
    assert.deepEqual(r.espacio.distribuciones, []);
  });

  test('rechaza campos desconocidos con su ruta', () => {
    const r = N.validar(base([{ ...mueble('a', 100, 100), color2: '#fff' }]));
    assert.equal(r.ok, false);
    assert.match(r.errores.join('\n'), /muebles\[0\]: campo desconocido «color2»/);
  });

  test('versión más nueva, formato erróneo e ids repetidos', () => {
    assert.match(N.validar({ ...base(), version: 3 }).errores.join(), /versión más nueva/);
    assert.match(N.validar({ ...base(), formato: 'x' }).errores.join(), /formato/);
    assert.match(N.validar(base([mueble('a', 100, 100), mueble('a', 200, 100)])).errores.join(), /«a» repetido/);
  });

  test('contorno que se cruza y hueco que no cabe', () => {
    const e = base();
    e.estancia.contorno = [[0, 0], [10, 10], [10, 0], [0, 10]];
    assert.match(N.validar(e).errores.join(), /se cruza/);
    const h = base();
    h.estancia.huecos = [{ id: 'p', tipo: 'puerta', muro: 0, desde: 350, ancho: 80 }];
    assert.match(N.validar(h).errores.join(), /no cabe en el muro 0/);
  });

  test('ids vacíos y contornos degenerados', () => {
    assert.match(N.validar(base([{ ...mueble('a', 100, 100), id: '' }])).errores.join(), /muebles\[0\]\.id: no vacío/);
    const c = (contorno) => {
      const e = base();
      e.estancia.contorno = contorno;
      return N.validar(e).ok;
    };
    assert.equal(c([[0, 0], [100, 0], [200, 0]]), false, 'área 0');
    assert.equal(c([[0, 0], [100, 0], [100, 100], [100, 50], [0, 100]]), false, 'espiga');
    assert.equal(c([[0, 0], [200, 0], [200, 200], [100, 0.0], [0, 200]].map((p, i) => (i === 3 ? [100, 0] : p))), false, 'vértice que toca otra arista');
    assert.equal(c([[0, 0], [100, 0], [100, 100], [0, 100]]), true);
  });

  test('ida y vuelta aJSON → validar, con puerta, ventana y paso', () => {
    const e = N.validarOLanzar(
      base([mueble('a', 100, 100), { ...mueble('b', 250, 100), giro: 33.5, elevacion: 10 }], {
        distribuciones: [{ nombre: 'Una', posiciones: { a: { x: 1, y: 2, giro: 0 } } }],
      }),
    );
    E(e).huecos = [
      { id: 'p', tipo: 'puerta', muro: 3, desde: 30, ancho: 80 },
      { id: 'v', tipo: 'ventana', muro: 0, desde: 130, ancho: 120 },
      { id: 's', tipo: 'paso', muro: 1, desde: 10, ancho: 90 },
    ];
    const norm = N.validarOLanzar(e);
    assert.equal(E(norm).huecos[1].abre, undefined, 'una ventana no lleva «abre»');
    assert.deepEqual(N.validarOLanzar(JSON.parse(N.aJSON(norm))), norm);
  });

  test('el hueco inferior debe ser menor que el alto', () => {
    assert.match(N.validar(base([mueble('m', 100, 100, 100, 50, { huecoInferior: 80 })])).errores.join(), /huecoInferior/);
  });
});

describe('operaciones', () => {
  test('nuevo espacio rectangular y redimensionado conservando el orden de vértices', () => {
    const e = N.nuevoEspacio({ ancho: 350, largo: 300 });
    assert.deepEqual(N.esRectangular(e), { ancho: 350, largo: 300 });
    const r = N.redimensionarRectangulo(e, 380, 290, 260);
    assert.deepEqual(E(r).contorno, [[0, 0], [380, 0], [380, 290], [0, 290]]);
    assert.equal(E(r).altura, 260);
    assert.deepEqual(E(e).contorno[1], [350, 0], 'no muta el original');
  });

  test('agregar genera ids libres y usa el catálogo', () => {
    let e = N.nuevoEspacio({ ancho: 350, largo: 300 });
    const a = N.agregarMueble(e, { tipo: 'silla' });
    const b = N.agregarMueble(a.espacio, { tipo: 'silla' });
    assert.equal(a.id, 'silla');
    assert.equal(b.id, 'silla-2');
    e = b.espacio;
    assert.equal(M(e)[0].ancho, 45);
    assert.deepEqual([M(e)[0].x, M(e)[0].y], [175, 150]);
  });

  test('mover un mueble bloqueado falla; desbloquearlo y moverlo a la vez no', () => {
    const { espacio } = N.agregarMueble(N.nuevoEspacio({ ancho: 350, largo: 300 }), { tipo: 'cama', bloqueado: true });
    assert.throws(() => N.moverMueble(espacio, 'cama', 10, 10), /bloqueado/);
    const r = N.editarMueble(espacio, 'cama', { bloqueado: false, x: 100 });
    assert.equal(M(r)[0].x, 100);
  });

  test('duplicar desplaza y no copia el bloqueo; quitar un id inexistente lista los ids', () => {
    const { espacio } = N.agregarMueble(N.nuevoEspacio({ ancho: 350, largo: 300 }), { tipo: 'mesilla', bloqueado: true });
    const d = N.duplicarMueble(espacio, 'mesilla');
    assert.equal(d.id, 'mesilla-2');
    const copia = M(d.espacio)[1];
    assert.equal(copia.x, M(espacio)[0].x + 20);
    assert.equal(copia.bloqueado, false);
    assert.throws(() => N.quitarMueble(espacio, 'nada'), /Ids: mesilla/);
  });

  test('quitar un mueble bloqueado falla', () => {
    const { espacio } = N.agregarMueble(N.nuevoEspacio({ ancho: 350, largo: 300 }), { tipo: 'cama', bloqueado: true });
    assert.throws(() => N.quitarMueble(espacio, 'cama'), /bloqueado/);
  });

  test('cambiar de tipo actualiza lo que estaba por defecto y conserva medidas y lo personalizado', () => {
    let { espacio } = N.agregarMueble(N.nuevoEspacio({ ancho: 350, largo: 300 }), { tipo: 'caja', ancho: 120, fondo: 60, alto: 75 });
    espacio = N.cambiarTipo(espacio, 'caja', 'escritorio');
    let m = M(espacio)[0];
    assert.deepEqual([m.tipo, m.nombre, m.ancho, m.huecoInferior, m.color], ['escritorio', 'Escritorio', 120, 65, '#b89a74']);
    espacio = N.editarMueble(espacio, 'caja', { nombre: 'Mi mesa' });
    espacio = N.cambiarTipo(espacio, 'caja', 'mesa');
    m = M(espacio)[0];
    assert.equal(m.nombre, 'Mi mesa', 'un nombre propio no se toca');
  });

  test('idLibre limpia tildes y espacios', () => {
    assert.equal(N.idLibre(N.nuevoEspacio({ ancho: 100, largo: 100 }), 'Estantería grande'), 'estanteria-grande');
  });
});

describe('imán', () => {
  const e = N.validarOLanzar(base([mueble('vecino', 300, 30, 100, 50)]));

  test('encaja la trasera contra el muro y el lateral contra un vecino', () => {
    // Candidato con la trasera a 4 cm del muro superior y el lado derecho a 3 cm del vecino (x 250).
    const m = { ...M(N.validarOLanzar(base([mueble('m', 0, 0)])))[0], x: 197, y: 29 };
    const r = N.aplicarIman(e, m, 8);
    cerca(r.x, 200);
    cerca(r.y, 25);
    assert.equal(r.guias.length, 2);
  });

  test('con giro 90° encaja la trasera (que mira a +x) contra el muro derecho', () => {
    const m = { ...M(N.validarOLanzar(base([mueble('m', 0, 0, 100, 50, { giro: 90 })])))[0], x: 372, y: 150 };
    const r = N.aplicarIman(N.validarOLanzar(base()), m, 8);
    cerca(r.x, 375);
    cerca(r.y, 150);
  });

  test('girado 30° no encaja con muros a escuadra', () => {
    const m = { ...M(N.validarOLanzar(base([mueble('m', 0, 0, 100, 50, { giro: 30 })])))[0], x: 200, y: 52 };
    const r = N.aplicarIman(N.validarOLanzar(base()), m, 8);
    assert.deepEqual([r.x, r.y, r.guias.length], [200, 52, 0]);
  });

  test('alinea el frente con el de un vecino cercano aunque no se toquen', () => {
    const e2 = N.validarOLanzar(base([mueble('vecino', 300, 150, 60, 50)])); // frente en y = 175
    const m = { ...M(N.validarOLanzar(base([mueble('m', 0, 0, 80, 50)])))[0], x: 200, y: 147 }; // frente en 172, a 30 cm a su izquierda
    const r = N.aplicarIman(e2, m, 8);
    cerca(r.y, 150);
    cerca(r.x, 200);
  });

  test('fuera del umbral no toca nada', () => {
    const m = { ...M(N.validarOLanzar(base([mueble('m', 0, 0)])))[0], x: 150, y: 150 };
    const r = N.aplicarIman(e, m, 8);
    assert.deepEqual([r.x, r.y, r.guias.length], [150, 150, 0]);
  });
});

describe('cotas', () => {
  test('distancias a los cuatro lados contra muros y un vecino', () => {
    const e = N.validarOLanzar(base([mueble('a', 100, 100, 100, 50), mueble('b', 300, 100, 50, 50)]));
    const c = Object.fromEntries(N.cotas(e, 'a').map((x) => [x.lado, x]));
    // giro 0: trasera hacia −y (muro y = 0), frente hacia +y (muro y = 300).
    assert.equal(c.trasera.distancia, 75);
    assert.equal(c.frente.distancia, 175);
    assert.equal(c.izquierda.distancia, 50);
    assert.equal(c.derecha.distancia, 125); // borde derecho en x 150, vecino desde x 275
    assert.equal(c.derecha.contra, 'b');
    assert.equal(c.trasera.contra, null);
  });

  test('un borde que sobresale menos que la tolerancia sigue midiendo 0 contra ese muro', () => {
    const e = N.validarOLanzar(base([mueble('a', 100, 24.95, 100, 50)])); // trasera en y = −0,05
    const c = Object.fromEntries(N.cotas(e, 'a').map((x) => [x.lado, x]));
    assert.equal(c.trasera?.distancia, 0);
  });
});

describe('análisis', () => {
  const reglas = (e) => N.analizar(N.validarOLanzar(e)).map((i) => i.regla).sort();

  test('a ras de muro y de otro mueble no hay incidencias', () => {
    assert.deepEqual(reglas(base([mueble('a', 50, 25), mueble('b', 150, 25)])), []);
  });

  test('se sale, se solapa y supera el techo', () => {
    assert.deepEqual(reglas(base([mueble('a', 40, 25)])), ['fuera']);
    assert.deepEqual(reglas(base([mueble('a', 100, 100), mueble('b', 150, 100)])), ['solape']);
    assert.deepEqual(reglas(base([mueble('a', 100, 100, 100, 50, { alto: 300 })])), ['altura']);
  });

  test('silla bajo el escritorio y estante colgado sobre él no chocan', () => {
    const escritorio = { id: 'escritorio', tipo: 'escritorio', ancho: 120, fondo: 60, alto: 75, x: 100, y: 30, huecoInferior: 65 };
    const silla = { id: 'silla', tipo: 'silla', ancho: 45, fondo: 50, alto: 60, x: 100, y: 40 };
    const estante = { id: 'estante', tipo: 'caja', ancho: 100, fondo: 25, alto: 30, x: 100, y: 12.5, elevacion: 120 };
    assert.deepEqual(reglas(base([escritorio, silla, estante])), []);
    // Una silla con respaldo más alto que el hueco: aviso (se mete hasta que el respaldo toca), no error.
    const inc = N.analizar(N.validarOLanzar(base([escritorio, { ...silla, alto: 90 }])));
    assert.deepEqual(inc.map((i) => [i.regla, i.gravedad]), [['silla-bajo', 'aviso']]);
    // Una cama baja que sólo entra en parte bajo el escritorio choca (antes «cabía» por altura).
    const cama = { id: 'cama', tipo: 'cama', ancho: 150, fondo: 200, alto: 50, x: 260, y: 120, giro: 90 }; // x 160–360, y 45–195
    const escr = { ...escritorio, x: 200, y: 30 }; // x 140–260, y 0–60
    assert.ok(reglas(base([escr, cama])).includes('solape'), 'la cama que asoma bajo el escritorio se solapa');
    // Otra cosa más alta que el hueco sí choca (y además ocupa el espacio libre delante del escritorio).
    assert.deepEqual(reglas(base([escritorio, { ...silla, tipo: 'caja', alto: 90 }])), ['holgura', 'solape']);
  });
});
