// Rasterizador mínimo sin DOM ni Node: polígonos, líneas, círculos, texto con una fuente de mapa de bits
// 5×7 propia e imágenes RGBA, sobre un búfer RGBA de 8 bits (no premultiplicado).
// Convención: coordenadas continuas en píxeles; el píxel (i, j) cubre [i, i+1) × [j, j+1) y se pinta si
// su centro (i+0,5, j+0,5) cae dentro de la figura (intervalos semiabiertos: dos figuras que comparten
// un borde no pintan dos veces el mismo píxel). Sin antialias.

export type Punto2 = [number, number];

/** '#rrggbb' → [r, g, b] (0–255). Lanza si el formato no es ese. */
export function leerColor(color: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (!m) throw new Error(`Color no válido: «${color}» (se espera #rrggbb)`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Fuente 5×7: cada entrada es «carácter filas», con 7 filas de 5 columnas ('#' = encendido).
// Las minúsculas con descendente (g j p q y) suben una fila para caber en 7.
const FUENTE: readonly string[] = [
  '  ..... ..... ..... ..... ..... ..... .....',
  '! ..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '" .#.#. .#.#. ..... ..... ..... ..... .....',
  '# .#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  '$ ..#.. .#### #.#.. .###. ..#.# ####. ..#..',
  '% ##... ##..# ...#. ..#.. .#... #..## ...##',
  '& .##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
  "' ..#.. ..#.. ..... ..... ..... ..... .....",
  '( ...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ') .#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  '* ..... ..#.. #.#.# .###. #.#.# ..#.. .....',
  '+ ..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  ', ..... ..... ..... ..... .##.. ..#.. .#...',
  '- ..... ..... ..... ##### ..... ..... .....',
  '. ..... ..... ..... ..... ..... .##.. .##..',
  '/ ..... ....# ...#. ..#.. .#... #.... .....',
  '0 .###. #...# #..## #.#.# ##..# #...# .###.',
  '1 ..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2 .###. #...# ....# ...#. ..#.. .#... #####',
  '3 ##### ...#. ..#.. ...#. ....# #...# .###.',
  '4 ...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5 ##### #.... ####. ....# ....# #...# .###.',
  '6 ..##. .#... #.... ####. #...# #...# .###.',
  '7 ##### ....# ...#. ..#.. .#... .#... .#...',
  '8 .###. #...# #...# .###. #...# #...# .###.',
  '9 .###. #...# #...# .#### ....# ...#. .##..',
  ': ..... .##.. .##.. ..... .##.. .##.. .....',
  '; ..... .##.. .##.. ..... .##.. ..#.. .#...',
  '< ...#. ..#.. .#... #.... .#... ..#.. ...#.',
  '= ..... ..... ##### ..... ##### ..... .....',
  '> .#... ..#.. ...#. ....# ...#. ..#.. .#...',
  '? .###. #...# ....# ...#. ..#.. ..... ..#..',
  '@ .###. #...# ....# .##.# #.#.# #.#.# .###.',
  'A .###. #...# #...# ##### #...# #...# #...#',
  'B ####. #...# #...# ####. #...# #...# ####.',
  'C .###. #...# #.... #.... #.... #...# .###.',
  'D ###.. #..#. #...# #...# #...# #..#. ###..',
  'E ##### #.... #.... ####. #.... #.... #####',
  'F ##### #.... #.... ####. #.... #.... #....',
  'G .###. #...# #.... #.### #...# #...# .####',
  'H #...# #...# #...# ##### #...# #...# #...#',
  'I .###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  'J ..### ...#. ...#. ...#. ...#. #..#. .##..',
  'K #...# #..#. #.#.. ##... #.#.. #..#. #...#',
  'L #.... #.... #.... #.... #.... #.... #####',
  'M #...# ##.## #.#.# #.#.# #...# #...# #...#',
  'N #...# #...# ##..# #.#.# #..## #...# #...#',
  'O .###. #...# #...# #...# #...# #...# .###.',
  'P ####. #...# #...# ####. #.... #.... #....',
  'Q .###. #...# #...# #...# #.#.# #..#. .##.#',
  'R ####. #...# #...# ####. #.#.. #..#. #...#',
  'S .#### #.... #.... .###. ....# ....# ####.',
  'T ##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  'U #...# #...# #...# #...# #...# #...# .###.',
  'V #...# #...# #...# #...# #...# .#.#. ..#..',
  'W #...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  'X #...# #...# .#.#. ..#.. .#.#. #...# #...#',
  'Y #...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  'Z ##### ....# ...#. ..#.. .#... #.... #####',
  '[ .###. .#... .#... .#... .#... .#... .###.',
  '\\ ..... #.... .#... ..#.. ...#. ....# .....',
  '] .###. ...#. ...#. ...#. ...#. ...#. .###.',
  '^ ..#.. .#.#. #...# ..... ..... ..... .....',
  '_ ..... ..... ..... ..... ..... ..... #####',
  '` .#... ..#.. ..... ..... ..... ..... .....',
  'a ..... ..... .###. ....# .#### #...# .####',
  'b #.... #.... #.##. ##..# #...# #...# ####.',
  'c ..... ..... .###. #.... #.... #...# .###.',
  'd ....# ....# .##.# #..## #...# #...# .####',
  'e ..... ..... .###. #...# ##### #.... .###.',
  'f ..##. .#..# .#... ###.. .#... .#... .#...',
  'g ..... .#### #...# #...# .#### ....# .###.',
  'h #.... #.... #.##. ##..# #...# #...# #...#',
  'i ..#.. ..... .##.. ..#.. ..#.. ..#.. .###.',
  'j ...#. ..... ..##. ...#. ...#. #..#. .##..',
  'k #.... #.... #..#. #.#.. ##... #.#.. #..#.',
  'l .##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  'm ..... ..... ##.#. #.#.# #.#.# #...# #...#',
  'n ..... ..... #.##. ##..# #...# #...# #...#',
  'o ..... ..... .###. #...# #...# #...# .###.',
  'p ..... ####. #...# #...# ####. #.... #....',
  'q ..... .#### #...# #...# .#### ....# ....#',
  'r ..... ..... #.##. ##..# #.... #.... #....',
  's ..... ..... .###. #.... .###. ....# ####.',
  't .#... .#... ###.. .#... .#... .#..# ..##.',
  'u ..... ..... #...# #...# #...# #..## .##.#',
  'v ..... ..... #...# #...# #...# .#.#. ..#..',
  'w ..... ..... #...# #...# #.#.# #.#.# .#.#.',
  'x ..... ..... #...# .#.#. ..#.. .#.#. #...#',
  'y ..... #...# #...# #...# .#### ....# .###.',
  'z ..... ..... ##### ...#. ..#.. .#... #####',
  '{ ...#. ..#.. ..#.. .#... ..#.. ..#.. ...#.',
  '| ..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  '} .#... ..#.. ..#.. ...#. ..#.. ..#.. .#...',
  '~ ..... ..... .#... #.#.# ...#. ..... .....',
  'á ...#. ..#.. .###. ....# .#### #...# .####',
  'é ...#. ..#.. .###. #...# ##### #.... .###.',
  'í ...#. ..#.. .##.. ..#.. ..#.. ..#.. .###.',
  'ó ...#. ..#.. .###. #...# #...# #...# .###.',
  'ú ...#. ..#.. #...# #...# #...# #..## .##.#',
  'Á ...#. .###. #...# #...# ##### #...# #...#',
  'É ...#. ##### #.... ####. #.... #.... #####',
  'Í ...#. .###. ..#.. ..#.. ..#.. ..#.. .###.',
  'Ó ...#. .###. #...# #...# #...# #...# .###.',
  'Ú ...#. #...# #...# #...# #...# #...# .###.',
  'ñ .##.# #..#. ..... #.##. ##..# #...# #...#',
  'Ñ .##.# #..#. #...# ##..# #.#.# #..## #...#',
  'ü .#.#. ..... #...# #...# #...# #..## .##.#',
  '¿ ..#.. ..... ..#.. .#... #.... #...# .###.',
  '¡ ..#.. ..... ..#.. ..#.. ..#.. ..#.. ..#..',
  '° .##.. #..#. #..#. .##.. ..... ..... .....',
  '× ..... #...# .#.#. ..#.. .#.#. #...# .....',
  '« ..... ..#.# .#.#. #.#.. .#.#. ..#.# .....',
  '» ..... #.#.. .#.#. ..#.# .#.#. #.#.. .....',
];

/** Ancho y alto de la celda de un carácter (en píxeles a escala 1) y avance entre caracteres y líneas. */
export const FUENTE_ANCHO = 5;
export const FUENTE_ALTO = 7;
const AVANCE = FUENTE_ANCHO + 1;
const INTERLINEA = FUENTE_ALTO + 2;

/** Glifos: carácter → 7 máscaras de fila (bit 4 = columna izquierda). */
const GLIFOS: ReadonlyMap<string, readonly number[]> = (() => {
  const m = new Map<string, number[]>();
  for (const entrada of FUENTE) {
    const caracter = entrada[0]!;
    const filas = entrada.slice(2).split(' ');
    if (filas.length !== FUENTE_ALTO || filas.some((f) => f.length !== FUENTE_ANCHO) || m.has(caracter)) {
      throw new Error(`Glifo mal definido: «${caracter}»`);
    }
    m.set(caracter, filas.map((f) => [...f].reduce((acc, c) => acc * 2 + (c === '#' ? 1 : 0), 0)));
  }
  return m;
})();

/** ¿Tiene la fuente un glifo propio para este carácter? (si no, se dibuja «?»). */
export function tieneGlifo(caracter: string): boolean {
  return GLIFOS.has(caracter);
}

/** Medidas en píxeles de una cadena dibujada con texto() (admite saltos de línea). */
export function medirTexto(cadena: string, escala = 1): { ancho: number; alto: number } {
  const lineas = cadena.split('\n');
  const maximo = Math.max(...lineas.map((l) => [...l].length));
  return {
    ancho: maximo > 0 ? (maximo * AVANCE - 1) * escala : 0,
    alto: (lineas.length * INTERLINEA - (INTERLINEA - FUENTE_ALTO)) * escala,
  };
}

const proporcion = (valor: number, nombre: string): number => {
  if (!Number.isFinite(valor)) throw new Error(`${nombre} no es un número finito`);
  return Math.min(1, Math.max(0, valor));
};

export class Lienzo {
  readonly ancho: number;
  readonly alto: number;
  /** Píxeles RGBA de 8 bits, fila a fila desde arriba a la izquierda (no premultiplicados). */
  readonly rgba: Uint8ClampedArray;

  constructor(ancho: number, alto: number, fondo = '#fbfaf7') {
    if (!Number.isInteger(ancho) || !Number.isInteger(alto) || ancho <= 0 || alto <= 0) {
      throw new Error(`Tamaño de lienzo no válido: ${ancho}×${alto} (enteros positivos)`);
    }
    this.ancho = ancho;
    this.alto = alto;
    this.rgba = new Uint8ClampedArray(ancho * alto * 4);
    const [r, g, b] = leerColor(fondo);
    for (let i = 0; i < this.rgba.length; i += 4) {
      this.rgba[i] = r;
      this.rgba[i + 1] = g;
      this.rgba[i + 2] = b;
      this.rgba[i + 3] = 255;
    }
  }

  /** Mezcla «fuente sobre destino» de un color con opacidad a (0–1) en el píxel de índice i (×4). */
  private mezclar(i: number, r: number, g: number, b: number, a: number): void {
    if (a <= 0) return;
    const d = this.rgba;
    if (a >= 1) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
      return;
    }
    const resto = (d[i + 3]! / 255) * (1 - a);
    const salida = a + resto;
    d[i] = (r * a + d[i]! * resto) / salida;
    d[i + 1] = (g * a + d[i + 1]! * resto) / salida;
    d[i + 2] = (b * a + d[i + 2]! * resto) / salida;
    d[i + 3] = salida * 255;
  }

  /** Pinta en la fila j los píxeles cuyo centro está en [xa, xb). */
  private tramo(j: number, xa: number, xb: number, r: number, g: number, b: number, a: number): void {
    if (j < 0 || j >= this.alto) return;
    const desde = Math.max(0, Math.ceil(xa - 0.5));
    const hasta = Math.min(this.ancho, Math.ceil(xb - 0.5));
    for (let x = desde; x < hasta; x++) this.mezclar((j * this.ancho + x) * 4, r, g, b, a);
  }

  /** Filas cuyo centro está en [ya, yb), recortadas al lienzo. */
  private filas(ya: number, yb: number): [number, number] {
    return [Math.max(0, Math.ceil(ya - 0.5)), Math.min(this.alto, Math.ceil(yb - 0.5))];
  }

  /** Rellena un polígono simple (cóncavo o convexo) con la regla par-impar por línea de barrido. */
  rellenarPoligono(puntos: Punto2[], color: string, alfa = 1): void {
    const [r, g, b] = leerColor(color);
    const a = proporcion(alfa, 'alfa');
    if (puntos.length < 3 || a === 0) return;
    for (const [x, y] of puntos) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Punto de polígono no finito');
    }
    const ys = puntos.map((p) => p[1]);
    const [j0, j1] = this.filas(Math.min(...ys), Math.max(...ys));
    const cortes: number[] = [];
    for (let j = j0; j < j1; j++) {
      const yc = j + 0.5;
      cortes.length = 0;
      for (let k = 0; k < puntos.length; k++) {
        const [xa, ya] = puntos[k]!;
        const [xb, yb] = puntos[(k + 1) % puntos.length]!;
        // Semiabierto en y: cada vértice cuenta una sola vez y los lados horizontales no cortan.
        if ((ya <= yc && yc < yb) || (yb <= yc && yc < ya)) cortes.push(xa + ((yc - ya) / (yb - ya)) * (xb - xa));
      }
      cortes.sort((p, q) => p - q);
      for (let k = 0; k + 1 < cortes.length; k += 2) this.tramo(j, cortes[k]!, cortes[k + 1]!, r, g, b, a);
    }
  }

  /** Rellena varios anillos a la vez con la regla par-impar: un exterior con sus agujeros sin tapar lo de debajo. */
  rellenarPoligonoConAgujeros(anillos: Punto2[][], color: string, alfa = 1): void {
    const [r, g, b] = leerColor(color);
    const a = proporcion(alfa, 'alfa');
    const validos = anillos.filter((x) => x.length >= 3);
    if (!validos.length || a === 0) return;
    const ys = validos.flat().map((p) => p[1]);
    const [j0, j1] = this.filas(Math.min(...ys), Math.max(...ys));
    const cortes: number[] = [];
    for (let j = j0; j < j1; j++) {
      const yc = j + 0.5;
      cortes.length = 0;
      for (const puntos of validos) {
        for (let k = 0; k < puntos.length; k++) {
          const [xa, ya] = puntos[k]!;
          const [xb, yb] = puntos[(k + 1) % puntos.length]!;
          if ((ya <= yc && yc < yb) || (yb <= yc && yc < ya)) cortes.push(xa + ((yc - ya) / (yb - ya)) * (xb - xa));
        }
      }
      cortes.sort((p, q) => p - q);
      for (let k = 0; k + 1 < cortes.length; k += 2) this.tramo(j, cortes[k]!, cortes[k + 1]!, r, g, b, a);
    }
  }

  /** Segmento de a a b con el grosor dado (extremos rectos). Un segmento de longitud 0 es un punto redondo. */
  linea(a: Punto2, b: Punto2, color: string, grosor = 1): void {
    if (!(grosor > 0) || !Number.isFinite(grosor)) throw new Error(`Grosor de línea no válido: ${grosor}`);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const largo = Math.hypot(dx, dy);
    if (largo < 1e-9) {
      this.circulo(a, grosor / 2, color, true);
      return;
    }
    const nx = (-dy / largo) * (grosor / 2);
    const ny = (dx / largo) * (grosor / 2);
    this.rellenarPoligono(
      [
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ],
      color,
    );
  }

  /** Círculo relleno o, con relleno = false, su contorno de 1 px de grosor centrado en el radio. */
  circulo(centro: Punto2, radio: number, color: string, relleno = true): void {
    if (!(radio >= 0) || !Number.isFinite(radio)) throw new Error(`Radio no válido: ${radio}`);
    const [r, g, b] = leerColor(color);
    const [cx, cy] = centro;
    const exterior = relleno ? radio : radio + 0.5;
    const interior = relleno ? 0 : Math.max(0, radio - 0.5);
    const [j0, j1] = this.filas(cy - exterior, cy + exterior);
    for (let j = j0; j < j1; j++) {
      const dy = j + 0.5 - cy;
      if (Math.abs(dy) > exterior) continue;
      const he = Math.sqrt(exterior * exterior - dy * dy);
      if (Math.abs(dy) >= interior) {
        this.tramo(j, cx - he, cx + he, r, g, b, 1);
      } else {
        const hi = Math.sqrt(interior * interior - dy * dy);
        this.tramo(j, cx - he, cx - hi, r, g, b, 1);
        this.tramo(j, cx + hi, cx + he, r, g, b, 1);
      }
    }
  }

  /**
   * Texto con la fuente 5×7 (esquina superior izquierda en x, y; escala = tamaño de cada punto en píxeles).
   * Avance de 6 puntos por carácter y de 9 por línea («\n»). Los caracteres sin glifo se dibujan como «?».
   */
  texto(x: number, y: number, cadena: string, color: string, escala = 1): void {
    if (!(escala > 0) || !Number.isFinite(escala)) throw new Error(`Escala de texto no válida: ${escala}`);
    const [r, g, b] = leerColor(color);
    let cx = x;
    let cy = y;
    for (const caracter of cadena) {
      if (caracter === '\n') {
        cx = x;
        cy += INTERLINEA * escala;
        continue;
      }
      const glifo = GLIFOS.get(caracter) ?? GLIFOS.get('?')!;
      for (let fila = 0; fila < FUENTE_ALTO; fila++) {
        const mascara = glifo[fila]!;
        if (mascara === 0) continue;
        const [j0, j1] = this.filas(cy + fila * escala, cy + (fila + 1) * escala);
        for (let col = 0; col < FUENTE_ANCHO; col++) {
          if (!(mascara & (1 << (FUENTE_ANCHO - 1 - col)))) continue;
          const xa = cx + col * escala;
          for (let j = j0; j < j1; j++) this.tramo(j, xa, xa + escala, r, g, b, 1);
        }
      }
      cx += AVANCE * escala;
    }
  }

  /**
   * Dibuja una imagen RGBA (no premultiplicada) con su esquina superior izquierda en (x, y), redondeada
   * al píxel, escalada por vecino más próximo y mezclada con su alfa multiplicado por la opacidad.
   */
  imagen(
    rgba: Uint8Array | Uint8ClampedArray,
    ancho: number,
    alto: number,
    x: number,
    y: number,
    opacidad = 1,
    escala = 1,
  ): void {
    if (!Number.isInteger(ancho) || !Number.isInteger(alto) || ancho < 0 || alto < 0) {
      throw new Error(`Tamaño de imagen no válido: ${ancho}×${alto}`);
    }
    if (rgba.length !== ancho * alto * 4) {
      throw new Error(`La imagen tiene ${rgba.length} bytes y ${ancho}×${alto} RGBA exige ${ancho * alto * 4}`);
    }
    if (!(escala > 0) || !Number.isFinite(escala)) throw new Error(`Escala de imagen no válida: ${escala}`);
    const o = proporcion(opacidad, 'opacidad');
    if (o === 0 || ancho === 0 || alto === 0) return;
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const anchoDestino = Math.round(ancho * escala);
    const altoDestino = Math.round(alto * escala);
    for (let dy = 0; dy < altoDestino; dy++) {
      const j = y0 + dy;
      if (j < 0 || j >= this.alto) continue;
      const sy = Math.min(alto - 1, Math.floor((dy + 0.5) / escala));
      for (let dx = 0; dx < anchoDestino; dx++) {
        const i = x0 + dx;
        if (i < 0 || i >= this.ancho) continue;
        const sx = Math.min(ancho - 1, Math.floor((dx + 0.5) / escala));
        const s = (sy * ancho + sx) * 4;
        this.mezclar((j * this.ancho + i) * 4, rgba[s]!, rgba[s + 1]!, rgba[s + 2]!, (rgba[s + 3]! / 255) * o);
      }
    }
  }
}
