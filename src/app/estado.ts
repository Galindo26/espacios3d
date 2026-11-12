// Estado de la página: espacio actual, selección e historial para deshacer/rehacer.
import type { Espacio } from '../core/index.js';
import { todosLosMuebles } from '../core/index.js';

export type Origen = 'usuario' | 'archivo' | 'historial' | 'inicio';

export interface Cambio {
  origen: Origen;
  /** true si cambió el espacio (no sólo la selección). */
  espacio: boolean;
}

type Oyente = (c: Cambio) => void;

const LIMITE = 300;

export class Estado {
  espacio: Espacio;
  seleccion: string | null = null;
  private pasado: Espacio[] = [];
  private futuro: Espacio[] = [];
  private oyentes: Oyente[] = [];
  private ultimaClave: string | undefined;

  constructor(inicial: Espacio) {
    this.espacio = inicial;
  }

  escuchar(f: Oyente): void {
    this.oyentes.push(f);
  }

  private emitir(c: Cambio): void {
    for (const f of this.oyentes) f(c);
  }

  /**
   * Cambio hecho por la persona: entra en el historial. Con `fusionar`, cambios seguidos con la
   * misma clave (p. ej. una flecha mantenida sobre el mismo mueble) cuentan como uno solo.
   */
  aplicar(nuevo: Espacio, fusionar?: string): void {
    if (JSON.stringify(nuevo) === JSON.stringify(this.espacio)) return;
    const fusiona = fusionar !== undefined && fusionar === this.ultimaClave && this.pasado.length > 0;
    this.ultimaClave = fusionar;
    if (!fusiona) this.pasado.push(this.espacio);
    if (this.pasado.length > LIMITE) this.pasado.shift();
    this.futuro = [];
    this.espacio = nuevo;
    this.corregirSeleccion();
    this.emitir({ origen: 'usuario', espacio: true });
  }

  /** Espacio que llega de un archivo: reinicia el historial. */
  reemplazar(nuevo: Espacio, origen: Origen = 'archivo'): void {
    this.ultimaClave = undefined;
    this.pasado = [];
    this.futuro = [];
    this.espacio = nuevo;
    this.corregirSeleccion();
    this.emitir({ origen, espacio: true });
  }

  /** El próximo cambio no se fusiona con el anterior aunque lleve la misma clave. */
  cortarFusion(): void {
    this.ultimaClave = undefined;
  }

  puedeDeshacer(): boolean {
    return this.pasado.length > 0;
  }

  puedeRehacer(): boolean {
    return this.futuro.length > 0;
  }

  deshacer(): void {
    const previo = this.pasado.pop();
    if (!previo) return;
    this.ultimaClave = undefined;
    this.futuro.push(this.espacio);
    this.espacio = previo;
    this.corregirSeleccion();
    // Para el guardado cuenta como cambio de la persona.
    this.emitir({ origen: 'historial', espacio: true });
  }

  rehacer(): void {
    const siguiente = this.futuro.pop();
    if (!siguiente) return;
    this.ultimaClave = undefined;
    this.pasado.push(this.espacio);
    this.espacio = siguiente;
    this.corregirSeleccion();
    this.emitir({ origen: 'historial', espacio: true });
  }

  seleccionar(id: string | null): void {
    if (id === this.seleccion) return;
    this.seleccion = id;
    this.emitir({ origen: 'usuario', espacio: false });
  }

  private corregirSeleccion(): void {
    if (this.seleccion && !todosLosMuebles(this.espacio).some((m) => m.id === this.seleccion)) this.seleccion = null;
  }
}
