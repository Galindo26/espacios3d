// Catálogo de tipos de mueble con medidas por defecto (cm). Un tipo desconocido se trata como
// «caja» con las medidas que traiga.

export interface TipoMueble {
  tipo: string;
  etiqueta: string;
  ancho: number;
  fondo: number;
  alto: number;
  color: string;
  holguraFrente: number;
  huecoInferior: number;
  /** Altura del suelo por defecto (cm): la de lo que se cuelga. */
  elevacion?: number;
  /** Va en la pared: al añadirlo sin posición se cuelga en la más cercana, y avisa si no toca ninguna. */
  pared?: boolean;
}

export const CATALOGO: readonly TipoMueble[] = [
  { tipo: 'cama', etiqueta: 'Cama', ancho: 150, fondo: 200, alto: 50, color: '#c9b79c', holguraFrente: 60, huecoInferior: 0 },
  { tipo: 'armario', etiqueta: 'Armario', ancho: 100, fondo: 60, alto: 200, color: '#a8876a', holguraFrente: 70, huecoInferior: 0 },
  { tipo: 'escritorio', etiqueta: 'Escritorio', ancho: 120, fondo: 60, alto: 75, color: '#b89a74', holguraFrente: 70, huecoInferior: 65 },
  { tipo: 'silla', etiqueta: 'Silla', ancho: 45, fondo: 50, alto: 90, color: '#6f7d8c', holguraFrente: 0, huecoInferior: 0 },
  { tipo: 'mesilla', etiqueta: 'Mesilla', ancho: 45, fondo: 40, alto: 55, color: '#b0916f', holguraFrente: 0, huecoInferior: 0 },
  { tipo: 'estanteria', etiqueta: 'Estantería', ancho: 80, fondo: 30, alto: 180, color: '#9c8064', holguraFrente: 40, huecoInferior: 0 },
  { tipo: 'comoda', etiqueta: 'Cómoda', ancho: 100, fondo: 50, alto: 85, color: '#a58466', holguraFrente: 60, huecoInferior: 0 },
  { tipo: 'sofa', etiqueta: 'Sofá', ancho: 200, fondo: 90, alto: 85, color: '#7d8a7a', holguraFrente: 60, huecoInferior: 0 },
  { tipo: 'mesa', etiqueta: 'Mesa', ancho: 140, fondo: 80, alto: 75, color: '#b89a74', holguraFrente: 60, huecoInferior: 65 },
  { tipo: 'alfombra', etiqueta: 'Alfombra', ancho: 200, fondo: 140, alto: 1, color: '#b9a48a', holguraFrente: 0, huecoInferior: 0 },
  // En la pared: se cuelgan a una altura habitual (el borde de abajo) y miran hacia dentro.
  { tipo: 'cuadro', etiqueta: 'Cuadro', ancho: 60, fondo: 3, alto: 45, color: '#7a5c43', holguraFrente: 0, huecoInferior: 0, elevacion: 140, pared: true },
  { tipo: 'espejo', etiqueta: 'Espejo', ancho: 50, fondo: 3, alto: 90, color: '#9c8f80', holguraFrente: 0, huecoInferior: 0, elevacion: 100, pared: true },
  { tipo: 'television', etiqueta: 'Televisor', ancho: 110, fondo: 6, alto: 65, color: '#2b2f33', holguraFrente: 0, huecoInferior: 0, elevacion: 100, pared: true },
  { tipo: 'balda', etiqueta: 'Balda', ancho: 80, fondo: 25, alto: 20, color: '#b89a74', holguraFrente: 0, huecoInferior: 0, elevacion: 150, pared: true },
  { tipo: 'aplique', etiqueta: 'Aplique', ancho: 20, fondo: 18, alto: 25, color: '#e8dcc2', holguraFrente: 0, huecoInferior: 0, elevacion: 170, pared: true },
  { tipo: 'caja', etiqueta: 'Caja', ancho: 50, fondo: 50, alto: 50, color: '#9aa3ab', holguraFrente: 0, huecoInferior: 0 },
];

export function tipoMueble(tipo: string): TipoMueble {
  return CATALOGO.find((t) => t.tipo === tipo) ?? (CATALOGO.find((t) => t.tipo === 'caja') as TipoMueble);
}
