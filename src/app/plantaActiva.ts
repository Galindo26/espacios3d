// Planta activa de la página (R2-7): la que se ve y se edita. Toda la página pide la planta con
// `plantaDe(e)`, que da la activa o, si ya no existe (deshacer, un agente la quitó), la primera.
import type { Espacio, Planta } from '../core/index.js';

let activa: string | null = null;

export function ponerPlantaActiva(id: string | null): void {
  activa = id;
}

/** Id de la planta activa en este espacio (la primera si la elegida no está). */
export function plantaActivaId(e: Espacio): string {
  return plantaDe(e).id;
}

export function plantaDe(e: Espacio): Planta {
  return e.plantas.find((p) => p.id === activa) ?? e.plantas[0]!;
}
