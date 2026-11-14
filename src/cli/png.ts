// PNG sin dependencias para el CLI (Node >= 18): codifica RGBA de 8 bits y decodifica los PNG de 8 bits
// por canal más comunes (gris, RGB, paleta con tRNS, gris con alfa y RGBA; los 5 filtros).
// CRC32 con tabla propia: zlib.crc32 no existe en Node 18.
import { deflateSync, inflateSync } from 'node:zlib';

const FIRMA = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (ISO 3309 / PNG) de los bytes dados. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

function trozo(tipo: string, datos: Uint8Array): Buffer {
  const b = Buffer.alloc(12 + datos.length);
  b.writeUInt32BE(datos.length, 0);
  b.write(tipo, 4, 'latin1');
  b.set(datos, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + datos.length)), 8 + datos.length);
  return b;
}

/** Codifica píxeles RGBA de 8 bits (fila a fila, sin premultiplicar) como PNG de color tipo 6, filtro 0. */
export function codificarPNG(rgba: Uint8Array | Uint8ClampedArray, ancho: number, alto: number): Buffer {
  if (!Number.isInteger(ancho) || !Number.isInteger(alto) || ancho <= 0 || alto <= 0) {
    throw new Error(`PNG: tamaño no válido ${ancho}×${alto} (enteros positivos)`);
  }
  if (rgba.length !== ancho * alto * 4) {
    throw new Error(`PNG: ${rgba.length} bytes no son ${ancho}×${alto} píxeles RGBA (${ancho * alto * 4})`);
  }
  const fila = ancho * 4;
  const crudo = Buffer.alloc(alto * (fila + 1));
  for (let y = 0; y < alto; y++) {
    crudo[y * (fila + 1)] = 0; // filtro «ninguno»
    crudo.set(rgba.subarray(y * fila, (y + 1) * fila), y * (fila + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  // compresión 0, filtro 0, sin entrelazado
  return Buffer.concat([
    Buffer.from(FIRMA),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(crudo)),
    trozo('IEND', new Uint8Array(0)),
  ]);
}

const CANALES: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Tope de tamaño al decodificar (como jpeg.ts) y bytes de más que se toleran tras la imagen. */
const MAX_MEGAPIXELES = 100;
const HOLGURA_IDAT = 65536;

/** Decodifica un PNG de 8 bits por canal (tipos de color 0, 2, 3, 4 y 6) a RGBA de 8 bits. */
export function decodificarPNG(bytes: Uint8Array): { ancho: number; alto: number; rgba: Uint8Array } {
  if (bytes.length < 8 || FIRMA.some((v, i) => bytes[i] !== v)) throw new Error('PNG: firma no válida (no es un PNG)');
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let ancho = 0;
  let alto = 0;
  let tipo = -1;
  let paleta: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let fin = false;
  for (let p = 8; !fin; ) {
    if (p + 12 > bytes.length) throw new Error('PNG: archivo truncado (falta IEND)');
    const largo = vista.getUint32(p);
    if (p + 12 + largo > bytes.length) throw new Error('PNG: trozo truncado');
    const nombre = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const datos = bytes.subarray(p + 8, p + 8 + largo);
    if (crc32(bytes.subarray(p + 4, p + 8 + largo)) !== vista.getUint32(p + 8 + largo)) {
      throw new Error(`PNG: CRC incorrecto en el trozo ${nombre}`);
    }
    if (p === 8 && nombre !== 'IHDR') throw new Error('PNG: el primer trozo no es IHDR');
    switch (nombre) {
      case 'IHDR': {
        if (largo !== 13) throw new Error('PNG: IHDR de tamaño incorrecto');
        ancho = vista.getUint32(p + 8);
        alto = vista.getUint32(p + 12);
        const bits = datos[8]!;
        tipo = datos[9]!;
        if (!(tipo in CANALES)) throw new Error(`PNG: tipo de color ${tipo} no válido`);
        if (bits !== 8) throw new Error(`PNG: profundidad de ${bits} bits no admitida (sólo 8 bits por canal)`);
        if (datos[10] !== 0 || datos[11] !== 0) throw new Error('PNG: método de compresión o de filtro desconocido');
        if (datos[12] !== 0) throw new Error('PNG: imagen entrelazada (Adam7) no admitida');
        if (ancho === 0 || alto === 0) throw new Error('PNG: tamaño cero');
        // El mismo tope que los JPEG, antes de reservar nada.
        if (ancho * alto > MAX_MEGAPIXELES * 1e6) throw new Error(`PNG: ${ancho} × ${alto} px son más de ${MAX_MEGAPIXELES} megapíxeles`);
        break;
      }
      case 'PLTE':
        paleta = datos;
        break;
      case 'tRNS':
        trns = datos;
        break;
      case 'IDAT':
        idat.push(datos);
        break;
      case 'IEND':
        fin = true;
        break;
      default:
        // Trozo crítico desconocido (primera letra en mayúscula): no se puede ignorar.
        if (nombre.charCodeAt(0) < 97) throw new Error(`PNG: trozo crítico desconocido ${nombre}`);
    }
    p += 12 + largo;
  }
  if (tipo === 3 && (!paleta || paleta.length % 3 !== 0)) throw new Error('PNG: falta la paleta (PLTE)');
  if (idat.length === 0) throw new Error('PNG: sin datos de imagen (IDAT)');

  const canales = CANALES[tipo]!;
  const fila = ancho * canales;
  let crudo: Uint8Array;
  const esperado = alto * (fila + 1);
  try {
    // Con tope: un IDAT pequeño puede descomprimirse en gigas. Se toleran unos bytes de más al final.
    crudo = inflateSync(Buffer.concat(idat), { maxOutputLength: esperado + HOLGURA_IDAT });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new Error('PNG: trae muchos más datos de imagen de los que caben en su tamaño');
    throw new Error(`PNG: datos comprimidos dañados (${(e as Error).message})`);
  }
  if (crudo.length < esperado) throw new Error('PNG: datos de imagen incompletos');

  // Deshacer filtros, fila a fila, sobre un búfer sin los bytes de filtro.
  const px = new Uint8Array(alto * fila);
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (fila + 1)]!;
    const origen = y * (fila + 1) + 1;
    const o = y * fila;
    for (let x = 0; x < fila; x++) {
      const v = crudo[origen + x]!;
      const a = x >= canales ? px[o + x - canales]! : 0;
      const b = y > 0 ? px[o - fila + x]! : 0;
      const c = x >= canales && y > 0 ? px[o - fila + x - canales]! : 0;
      let r: number;
      switch (filtro) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: throw new Error(`PNG: filtro ${filtro} no válido en la fila ${y}`);
      }
      px[o + x] = r & 0xff;
    }
  }

  const rgba = new Uint8Array(ancho * alto * 4);
  const n = ancho * alto;
  // Color transparente de tRNS para gris (2 bytes) y RGB (6 bytes): valor de 16 bits, a 8 bits = byte bajo.
  const clave = trns && (tipo === 0 || tipo === 2) ? Array.from({ length: trns.length / 2 }, (_, i) => trns![i * 2 + 1]!) : null;
  for (let i = 0; i < n; i++) {
    const s = i * canales;
    const d = i * 4;
    switch (tipo) {
      case 0: {
        const g = px[s]!;
        rgba[d] = rgba[d + 1] = rgba[d + 2] = g;
        rgba[d + 3] = clave && clave[0] === g ? 0 : 255;
        break;
      }
      case 2:
        rgba[d] = px[s]!;
        rgba[d + 1] = px[s + 1]!;
        rgba[d + 2] = px[s + 2]!;
        rgba[d + 3] = clave && clave[0] === px[s] && clave[1] === px[s + 1] && clave[2] === px[s + 2] ? 0 : 255;
        break;
      case 3: {
        const k = px[s]!;
        if (k * 3 + 2 >= paleta!.length) throw new Error(`PNG: índice de paleta ${k} fuera de la paleta`);
        rgba[d] = paleta![k * 3]!;
        rgba[d + 1] = paleta![k * 3 + 1]!;
        rgba[d + 2] = paleta![k * 3 + 2]!;
        rgba[d + 3] = trns && k < trns.length ? trns[k]! : 255;
        break;
      }
      case 4:
        rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]!;
        rgba[d + 3] = px[s + 1]!;
        break;
      default:
        rgba.set(px.subarray(s, s + 4), d);
    }
  }
  return { ancho, alto, rgba };
}
