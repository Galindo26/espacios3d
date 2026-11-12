// Iconos SVG de un mismo trazo. Los de muebles son su símbolo en planta, vistos desde arriba.
const envolver = (cuerpo: string, vb = 32): string =>
  `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cuerpo}</svg>`;

export const ICONOS_MUEBLE: Record<string, string> = {
  cama: envolver('<rect x="7" y="4" width="18" height="24" rx="1.5"/><rect x="9" y="6.5" width="6" height="4" rx="1"/><rect x="17" y="6.5" width="6" height="4" rx="1"/><path d="M7 14h18"/>'),
  armario: envolver('<rect x="4" y="10" width="24" height="12" rx="1"/><path d="M16 10v12M13.5 18v1.5M18.5 18v1.5"/>'),
  escritorio: envolver('<rect x="3" y="10" width="26" height="12" rx="1"/><path d="M20 10v12M20 16h9"/>'),
  silla: envolver('<rect x="9" y="9" width="14" height="14" rx="2"/><path d="M9 25h14"/>'),
  mesilla: envolver('<rect x="9" y="9" width="14" height="14" rx="1"/><path d="M14 19h4"/>'),
  estanteria: envolver('<rect x="3" y="12" width="26" height="8" rx="1"/><path d="M11.7 12v8M20.3 12v8"/>'),
  comoda: envolver('<rect x="4" y="9" width="24" height="14" rx="1"/><path d="M4 13.7h24M4 18.3h24"/>'),
  sofa: envolver('<path d="M4 10h24v13H4z"/><path d="M4 14h3v9M28 14h-3v9M7 14h18"/><path d="M16 14v9"/>'),
  mesa: envolver('<rect x="7" y="10" width="18" height="12" rx="1"/><path d="M11 6.5h4M17 6.5h4M11 25.5h4M17 25.5h4"/>'),
  alfombra: envolver('<rect x="6" y="9" width="20" height="14" rx="1"/><path d="M4 11v10M28 11v10M10 13h12M10 19h12"/>'),
  // De pared: vistos de frente (en planta serían una raya).
  cuadro: envolver('<rect x="6" y="7" width="20" height="18" rx="1"/><rect x="9.5" y="10.5" width="13" height="11"/><path d="M10 20l4-4 3 3 2-2 3 3"/>'),
  espejo: envolver('<rect x="9" y="4" width="14" height="24" rx="7"/><path d="M13 10l3-3M13 15l6-6"/>'),
  television: envolver('<rect x="4" y="7" width="24" height="15" rx="1.5"/><path d="M12 26h8M16 22v4"/>'),
  balda: envolver('<path d="M4 14h24"/><path d="M8 14v6l4-6M24 14v6l-4-6"/><rect x="9" y="8" width="4" height="6"/><rect x="15" y="10" width="3" height="4"/>'),
  aplique: envolver('<path d="M7 9v14"/><path d="M7 16h7"/><path d="M14 11h10l-2 9h-6z"/>'),
  caja: envolver('<rect x="7" y="7" width="18" height="18" rx="1"/><path d="M7 7l18 18M25 7 7 25"/>'),
};

export const ICONOS = {
  deshacer: envolver('<path d="M9 14H4V9"/><path d="M4.5 13.5A10 10 0 1 1 7 22"/>'),
  rehacer: envolver('<path d="M23 14h5V9"/><path d="M27.5 13.5A10 10 0 1 0 25 22"/>'),
  encuadrar: envolver('<path d="M5 11V5h6M21 5h6v6M27 21v6h-6M11 27H5v-6"/><rect x="11" y="11" width="10" height="10" rx="1"/>'),
  ayuda: envolver('<circle cx="16" cy="16" r="12"/><path d="M12.5 12.5a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3v.5"/><path d="M16 22.5h.01"/>'),
  candado: envolver('<rect x="8" y="14" width="16" height="12" rx="2"/><path d="M11 14v-3a5 5 0 0 1 10 0v3"/>'),
};

export function iconoMueble(tipo: string): string {
  return ICONOS_MUEBLE[tipo] ?? (ICONOS_MUEBLE.caja as string);
}
