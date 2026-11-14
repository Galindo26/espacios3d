// JPEG en el CLI: tamaño, orientación EXIF y decodificación a RGBA (ronda 5: --sobre-fondo y plano_png
// con planos JPEG). La página no lo usa: el navegador decodifica sus imágenes.
import { decode as decodificarJPEGCrudo } from 'jpeg-js';

/** Orientación EXIF (1–8) de un segmento APP1 «Exif», o 1 si no la tiene. */
function orientacionExif(b: Buffer, inicio: number, fin: number): number {
  if (b.toString('latin1', inicio, inicio + 6) !== 'Exif\0\0') return 1;
  const t = inicio + 6;
  const le = b.toString('latin1', t, t + 2) === 'II';
  const u16 = (o: number): number => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o: number): number => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  // Cabecera TIFF entera (8 bytes) dentro del segmento, y el IFD detrás de ella y también dentro.
  if (t + 8 > fin) return 1;
  const desplazamiento = u32(t + 4);
  const ifd = t + desplazamiento;
  if (desplazamiento < 8 || ifd + 2 > fin) return 1;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > fin) break;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return 1;
}

/** Ancho y alto guardados en un JPEG y su orientación EXIF (1 si no tiene). */
export function cabeceraJPEG(b: Buffer): { ancho: number; alto: number; orientacion: number } | null {
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    let orientacion = 1;
    // Un archivo truncado o con longitudes falsas no es una imagen: nunca se lee fuera del búfer.
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return null;
      // Bytes de relleno 0xFF antes de un marcador (legales en JPEG).
      while (i + 1 < b.length && b[i + 1] === 0xff) i++;
      if (i + 4 > b.length) return null;
      const marca = b[i + 1]!;
      // Marcadores sin longitud: TEM y RST0–RST7. Con SOI repetido, EOI o SOS ya no hay cabecera que leer.
      if (marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marca === 0xd8 || marca === 0xd9 || marca === 0xda) return null;
      const largo = b.readUInt16BE(i + 2);
      if (largo < 2) return null;
      if (marca === 0xe1) orientacion = Math.max(orientacion, orientacionExif(b, i + 4, Math.min(b.length, i + 2 + largo)));
      // SOF0–SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
      if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
        if (i + 9 > b.length) return null;
        return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7), orientacion };
      }
      i += 2 + largo;
    }
  }
  return null;
}

/**
 * Decodifica un JPEG a RGBA tal como se ve: con la orientación EXIF aplicada, igual que la página
 * (ronda 5: los planos reales suelen ser JPEG y un agente sólo con MCP no puede convertirlos).
 */
export function decodificarJPEG(bytes: Buffer): { rgba: Uint8Array; ancho: number; alto: number } {
  const cab = cabeceraJPEG(bytes);
  if (!cab) throw new Error('no es un JPEG');
  const crudo = decodificarJPEGCrudo(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 100, maxMemoryUsageInMB: 1024 });
  const w = crudo.width;
  const h = crudo.height;
  const o = cab.orientacion >= 2 && cab.orientacion <= 8 ? cab.orientacion : 1;
  if (o === 1) return { rgba: crudo.data, ancho: w, alto: h };
  const girada = o >= 5;
  const W = girada ? h : w;
  const H = girada ? w : h;
  const res = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Píxel (x, y) de la imagen vista → píxel (sx, sy) de la guardada, según la orientación EXIF.
      let sx: number;
      let sy: number;
      switch (o) {
        case 2: sx = w - 1 - x; sy = y; break;
        case 3: sx = w - 1 - x; sy = h - 1 - y; break;
        case 4: sx = x; sy = h - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = h - 1 - x; break;
        case 7: sx = w - 1 - y; sy = h - 1 - x; break;
        default: sx = w - 1 - y; sy = x; break; // 8
      }
      const d = (y * W + x) * 4;
      const s = (sy * w + sx) * 4;
      res[d] = crudo.data[s]!;
      res[d + 1] = crudo.data[s + 1]!;
      res[d + 2] = crudo.data[s + 2]!;
      res[d + 3] = crudo.data[s + 3]!;
    }
  }
  return { rgba: res, ancho: W, alto: H };
}

