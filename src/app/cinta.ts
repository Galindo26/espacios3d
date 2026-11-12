// Cinta métrica (R2-6): «Medir» (tecla M) y dos pulsaciones en la vista, en planta o en 3D sobre el
// suelo. Cada punto se pega a la esquina más cercana o a una pared (Mayús lo deja libre). La medida
// se queda a la vista hasta la siguiente pulsación; Esc o «Medir» salen. Con el dedo (R3-3), cada
// toque sin arrastrar es un punto (arrastrar sigue moviendo la vista) y el imán llega más lejos.
import type { Espacio, Punto } from '../core/index.js';
import { plantaDe } from './plantaActiva.js';
import { imanCinta, medirCinta } from '../core/index.js';
import { formatoCm, type Escena } from './escena.js';
import { $ } from './ui.js';

export interface AnfitrionCinta {
  esp(): Espacio;
  escena: Escena;
  cmPorPixel(): number;
  aviso(texto: string): void;
  /** Al empezar a medir: los demás modos de pulsar en la vista se cierran (el calco). */
  alEntrar?(): void;
}

/** Distancia (px de pantalla) dentro de la cual el punto se pega a una esquina o a una pared. */
const UMBRAL_PX = 12;
/** Con el dedo, el imán llega más lejos: un dedo tapa más que el puntero del ratón. */
const UMBRAL_PX_DEDO = 24;

export class Cinta {
  activo = false;
  private a: Punto | null = null;
  private b: Punto | null = null;

  constructor(private readonly x: AnfitrionCinta) {
    $('b-medir').addEventListener('click', () => this.alternar());
  }

  alternar(): void {
    if (this.activo) this.salir();
    else this.entrar();
  }

  entrar(): void {
    this.x.alEntrar?.();
    this.activo = true;
    this.a = this.b = null;
    $('b-medir').setAttribute('aria-pressed', 'true');
    document.body.classList.add('midiendo');
    this.x.aviso(
      matchMedia('(pointer: coarse)').matches
        ? 'Medir: toca dos puntos (se pegan a esquinas y paredes). Arrastra para mover la vista y toca «Medir» para terminar.'
        : 'Medir: pulsa dos puntos (se pegan a esquinas y paredes; Mayús los deja libres). Esc sale.',
    );
  }

  salir(): void {
    if (!this.activo) return;
    this.activo = false;
    this.a = this.b = null;
    $('b-medir').setAttribute('aria-pressed', 'false');
    document.body.classList.remove('midiendo');
    this.x.escena.ponerMedida(null, null, '');
  }

  private ajustar(p: Punto, libre: boolean, dedo = false): Punto {
    if (libre) return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    return imanCinta(plantaDe(this.x.esp()), p, (dedo ? UMBRAL_PX_DEDO : UMBRAL_PX) * this.x.cmPorPixel()).punto;
  }

  /** Pulsación en el suelo: primer punto, segundo punto o, con una medida hecha, empezar otra. */
  pulsar(p: Punto, libre: boolean, dedo = false): void {
    const q = this.ajustar(p, libre, dedo);
    if (!this.a || this.b) {
      this.a = q;
      this.b = null;
    } else this.b = q;
    this.pintar(null);
  }

  /** Movimiento del puntero: con el primer punto puesto, medida provisional hasta el puntero. */
  mover(p: Punto, libre: boolean): void {
    if (this.a && !this.b) this.pintar(this.ajustar(p, libre));
  }

  tecla(k: string): boolean {
    if (!this.activo) return false;
    if (k === 'escape' || k === 'm') this.salir();
    else return false;
    return true;
  }

  private pintar(provisional: Punto | null): void {
    const b = this.b ?? provisional;
    if (!this.a || !b) return this.x.escena.ponerMedida(this.a, null, '');
    const m = medirCinta(this.a, b);
    const texto = m.dx && m.dy ? `${formatoCm(m.distancia)} cm (${formatoCm(m.dx)} × ${formatoCm(m.dy)})` : `${formatoCm(m.distancia)} cm`;
    this.x.escena.ponerMedida(this.a, b, texto);
  }

  /** Para las pruebas: los puntos y la medida actuales. */
  estado(): { activo: boolean; a: Punto | null; b: Punto | null; distancia: number | null } {
    return { activo: this.activo, a: this.a, b: this.b, distancia: this.a && this.b ? medirCinta(this.a, this.b).distancia : null };
  }
}
