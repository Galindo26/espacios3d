// Tipos del formato *.espacio.json (versión 2; la 1 se convierte al leer, en validar.ts). Medidas en cm y giros en grados.
// Convenciones (docs/PLAN.md): planta con x a la derecha e y hacia abajo; el contorno es la
// cara interior de los muros; con giro 0 el frente del mueble mira a +y; giro en grados
// horarios vistos desde arriba.

export type Punto = [number, number];

export type TipoHueco = 'puerta' | 'ventana' | 'paso';
export type Apertura = 'dentro' | 'fuera' | 'corredera';
export type Bisagra = 'inicio' | 'fin';

export interface Hueco {
  id: string;
  tipo: TipoHueco;
  /** Índice de la arista contorno[muro] → contorno[muro + 1]. */
  muro: number;
  /** cm desde el vértice inicial del muro hasta el borde del hueco. */
  desde: number;
  ancho: number;
  alto: number;
  /** Altura del borde inferior sobre el suelo (0 en puertas y pasos). */
  antepecho: number;
  /** Sólo puertas (el validador lo completa con «dentro»). */
  abre?: Apertura;
  /** Sólo puertas: extremo del hueco donde está la bisagra (por defecto «inicio»). */
  bisagra?: Bisagra;
}

export interface Estancia {
  id: string;
  nombre: string;
  contorno: Punto[];
  altura: number;
  huecos: Hueco[];
  /** Elementos fijos de obra (columnas, radiadores, enchufes, vigas…); sólo si hay alguno. */
  elementos?: Elemento[];
  /** Techo inclinado: un faldón por muro bajo el que baja el techo (buhardillas); sólo si hay alguno. */
  faldones?: Faldon[];
  /** Comprobar que cabe un círculo de giro de 150 cm (silla de ruedas); sólo si se pide. */
  circuloDeGiro?: boolean;
  /** Suelo (R4-2); sin él, liso del color de siempre. */
  suelo?: Suelo;
  /** Color de las paredes por dentro (#rrggbb); sin él, el de los muros. */
  paredes?: string;
  /** Fotos de la estancia (R4-3): rutas relativas a la carpeta del .espacio.json. */
  fotos?: string[];
}

/** Acabado del suelo de una estancia: tipo y, si se quiere, otro color que el del tipo. */
export interface Suelo {
  tipo: 'liso' | 'parquet' | 'baldosa' | 'moqueta';
  color?: string;
}

/**
 * Elemento fijo de obra. La forma dice cómo es; el tipo es una etiqueta (columna, pilar, radiador,
 * chimenea, enchufe, interruptor, toma, escalon, viga u otra) que el análisis usa para algunos avisos.
 * Sin `alto`, los exentos y adosados llegan hasta el techo.
 */
export type Elemento = ElementoExento | ElementoAdosado | ElementoPunto | ElementoViga;

/** En medio de la estancia: rectángulo (o círculo con `redondo`) centrado en (x, y). */
export interface ElementoExento {
  id: string;
  tipo: string;
  forma: 'exento';
  x: number;
  y: number;
  ancho: number;
  fondo: number;
  giro: number;
  redondo: boolean;
  alto?: number;
  elevacion: number;
}

/** Contra un muro, hacia dentro: de `desde` a `desde + ancho` a lo largo del muro y `fondo` hacia la estancia. */
export interface ElementoAdosado {
  id: string;
  tipo: string;
  forma: 'adosado';
  muro: number;
  desde: number;
  ancho: number;
  fondo: number;
  alto?: number;
  elevacion: number;
}

/** Un punto en un muro (enchufe, interruptor, toma) a una altura. */
export interface ElementoPunto {
  id: string;
  tipo: string;
  forma: 'punto';
  muro: number;
  desde: number;
  altura: number;
}

/** Viga bajo el techo, de un punto a otro de la planta, con su ancho y su canto (lo que baja). */
export interface ElementoViga {
  id: string;
  tipo: string;
  forma: 'viga';
  de: Punto;
  a: Punto;
  ancho: number;
  canto: number;
}

/**
 * Faldón de techo inclinado: junto al muro el techo está a `alturaEnMuro` y sube en línea recta hasta
 * la altura de la estancia a `alcance` cm del muro. Con varios, en cada punto manda el más bajo.
 */
export interface Faldon {
  muro: number;
  alturaEnMuro: number;
  alcance: number;
}

export interface Mueble {
  id: string;
  nombre: string;
  tipo: string;
  ancho: number;
  fondo: number;
  alto: number;
  x: number;
  y: number;
  giro: number;
  elevacion: number;
  color: string;
  bloqueado: boolean;
  /** Espacio libre que necesita delante (cm). */
  holguraFrente: number;
  /** Altura libre por debajo (cm): lo que mida menos cabe debajo. */
  huecoInferior: number;
  /** Forma hecha de piezas (un sofá en L, una lámpara…), en lugar de la genérica del tipo. */
  piezas?: Pieza[];
  /** Modelo 3D propio (.glb) en la carpeta de trabajo; si falta, se ve la forma genérica. */
  modelo?: ModeloMueble;
  /** Fotos del mueble (R4-3): rutas relativas a la carpeta del .espacio.json. */
  fotos?: string[];
}

/**
 * Pieza de un mueble, en coordenadas del mueble: origen en el centro de su huella y a ras de su base;
 * x a lo largo del ancho, y hacia el frente, z hacia arriba. Tiene que caber dentro del mueble.
 * Esfera y cilindro usan `ancho` como diámetro; la cuña sube de 0 en el frente a `alto` detrás.
 */
export interface Pieza {
  forma: 'caja' | 'cilindro' | 'esfera' | 'cuna';
  x: number;
  y: number;
  z: number;
  ancho: number;
  fondo: number;
  alto: number;
  giro: number;
  color?: string;
}

/** Modelo .glb propio: «medidas» lo estira a ancho × fondo × alto; «modelo» conserva su tamaño. */
export interface ModeloMueble {
  archivo: string;
  giro: number;
  ajuste: 'medidas' | 'modelo';
}

export interface Posicion {
  x: number;
  y: number;
  giro: number;
  /** Planta del mueble en esa distribución (si se cambió de planta). */
  planta?: string;
}

export interface Distribucion {
  nombre: string;
  posiciones: Record<string, Posicion>;
}

/**
 * Planta de la casa: sus estancias (polígonos de cara interior) y sus muebles (en coordenadas de
 * la planta; cada mueble pertenece a la estancia que contiene su centro, que no se guarda).
 */
export interface Planta {
  id: string;
  nombre: string;
  /** Cota del suelo (cm) respecto a la planta baja. */
  nivel: number;
  /** Grosor de los muros exteriores (cm). Los tabiques interiores son la separación real entre estancias. */
  grosorExterior: number;
  estancias: Estancia[];
  muebles: Mueble[];
  /** Planos o fotos de fondo para calcar (sólo si hay alguno). */
  fondos?: Fondo[];
  /** Escaleras que suben desde esta planta (sólo si hay alguna). */
  escaleras?: Escalera[];
}

/**
 * Escalera que sube desde su planta a la inmediatamente superior (`hasta`). (x, y) es el centro del
 * borde del pie; con `giro` 0 el primer tramo sube hacia +y (giro horario, como los muebles).
 * - recta: `largo`.
 * - L: `tramos` [l1, l2] y `gira` (mano de quien sube: «derecha» = sentido horario): tramo 1,
 *   meseta de ancho × ancho y tramo 2 hacia ese lado.
 * - U: `tramos`, `gira` y `ojo` (hueco entre tramos): tramo 1, meseta y tramo 2 de vuelta, al lado.
 * - caracol: `gira`, `poste` (diámetro del poste, 20 por defecto) y `vuelta` (grados, 360 por
 *   defecto); `ancho` es el del peldaño, del poste a la barandilla, y el centro queda a la mano de giro.
 * `peldanos` son contrahuellas; por defecto round(altura / 18) (round(altura / 21) en la caracol).
 */
export interface Escalera {
  id: string;
  forma: 'recta' | 'L' | 'U' | 'caracol';
  x: number;
  y: number;
  ancho: number;
  giro: number;
  hasta: string;
  peldanos?: number;
  largo?: number;
  tramos?: [number, number];
  gira?: 'izquierda' | 'derecha';
  ojo?: number;
  poste?: number;
  vuelta?: number;
}

/**
 * Imagen de fondo de una planta (un plano para calcar). El píxel (0, 0) —esquina de arriba a la
 * izquierda— cae en (x, y) cm; cada píxel mide `escala` cm; `giro` en grados, horario, alrededor
 * de esa esquina. `archivo` es relativo a la carpeta del .espacio.json (sin «..» ni rutas absolutas).
 */
export interface Fondo {
  id: string;
  archivo: string;
  anchoPx: number;
  altoPx: number;
  escala: number;
  x: number;
  y: number;
  giro: number;
  opacidad: number;
}

/** Formato v2: una casa de una o varias plantas. La v1 (una estancia) se migra al leerla. */
export interface Espacio {
  formato: 'espacios3d';
  version: 2;
  nombre: string;
  plantas: Planta[];
  distribuciones: Distribucion[];
  notas: string;
}

export const FORMATO = 'espacios3d';
export const VERSION = 2;
/** Tolerancia geométrica en cm: tocar a ras no es solape ni salirse. */
export const TOLERANCIA = 0.1;

export class ErrorOperacion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorOperacion';
  }
}
