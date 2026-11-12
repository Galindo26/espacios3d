// Texturas procedurales de los suelos (R4-2): parquet, baldosa y moqueta dibujados en un lienzo, en
// gris claro para que el color del material los tiña. Sin imágenes externas. Una baldosa de textura
// cubre 120 cm y se repite (ver TAMANO_TEXTURA); el dibujo empalma por los bordes.
import * as THREE from 'three';
import type { Suelo } from '../core/index.js';

/** Lo que cubre una repetición de la textura (m). */
export const TAMANO_TEXTURA = 1.2;
const PX = 512;
const cache = new Map<string, THREE.CanvasTexture>();

/** Generador pseudoaleatorio con semilla (mulberry32): la misma textura en cada carga. */
function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gris = (v: number): string => {
  const x = Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${x},${x},${x})`;
};

function parquet(g: CanvasRenderingContext2D): void {
  const r = azar(7);
  const cmPx = PX / 120;
  const fila = 15 * cmPx; // tablas de 15 cm (8 filas en 120 cm)
  const filas = Math.round(PX / fila);
  const alto = PX / filas;
  for (let f = 0; f < filas; f++) {
    let x = -r() * 80 * cmPx;
    while (x < PX) {
      const largo = (60 + r() * 60) * cmPx;
      const v = 205 + r() * 45;
      // Cada tabla se dibuja también desplazada un ancho, para que empalme por el borde.
      for (const dx of [0, -PX, PX]) {
        g.fillStyle = gris(v);
        g.fillRect(x + dx, f * alto, largo, alto);
        // Vetas finas a lo largo de la tabla.
        for (let k = 0; k < 5; k++) {
          g.fillStyle = gris(v - 12 - r() * 10);
          g.fillRect(x + dx, f * alto + r() * alto, largo, 1);
        }
        g.fillStyle = gris(140);
        g.fillRect(x + dx, f * alto, 1.5, alto);
      }
      x += largo;
    }
    g.fillStyle = gris(150);
    g.fillRect(0, f * alto, PX, 1.5);
  }
}

function baldosa(g: CanvasRenderingContext2D): void {
  const r = azar(11);
  const n = 4; // baldosas de 30 cm
  const lado = PX / n;
  g.fillStyle = gris(190);
  g.fillRect(0, 0, PX, PX);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      g.fillStyle = gris(238 + r() * 14);
      g.fillRect(i * lado + 1.5, j * lado + 1.5, lado - 3, lado - 3);
    }
  }
}

function moqueta(g: CanvasRenderingContext2D): void {
  const r = azar(23);
  const img = g.createImageData(PX, PX);
  for (let k = 0; k < PX * PX; k++) {
    const v = 214 + r() * 41;
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = v;
    img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

/** Textura del suelo para el 3D (null para el liso). Se comparte entre estancias: no se libera con ellas. */
export function texturaSuelo(tipo: Suelo['tipo']): THREE.CanvasTexture | null {
  if (tipo === 'liso') return null;
  let t = cache.get(tipo);
  if (t) return t;
  const lienzo = document.createElement('canvas');
  lienzo.width = lienzo.height = PX;
  const g = lienzo.getContext('2d');
  if (!g) return null;
  if (tipo === 'parquet') parquet(g);
  else if (tipo === 'baldosa') baldosa(g);
  else moqueta(g);
  t = new THREE.CanvasTexture(lienzo);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / TAMANO_TEXTURA, 1 / TAMANO_TEXTURA);
  t.anisotropy = 4;
  cache.set(tipo, t);
  return t;
}
