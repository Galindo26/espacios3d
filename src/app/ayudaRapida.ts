// «Ayuda rápida» (R4-4): tres pasos con un dibujo animado cada uno (SVG y CSS, sin imágenes): medir la
// estancia (o darle forma libre), poner y arrastrar muebles con imán, y verla en 3D o recorrerla. Con
// «reducir movimiento» los dibujos se quedan quietos en su último cuadro (estilos.css).

const PASOS: { titulo: string; texto: string; svg: string }[] = [
  {
    titulo: '1. Las medidas',
    texto: 'Escribe ancho, largo y alto en «Estancia». Si no es un rectángulo, «Paredes una a una» o «Editar esquinas en el plano».',
    svg: `<rect class="ar-pared" x="14" y="14" width="92" height="52" rx="1"/>
<rect class="ar-crece" x="14" y="14" width="92" height="52" rx="1"/>
<path class="ar-cota" d="M14 8h92M14 5v6M106 5v6"/>`,
  },
  {
    titulo: '2. Los muebles',
    texto: 'Elige uno en «Añadir» y arrástralo: se pega a las paredes y a los demás. R lo gira; las incidencias avisan de lo que choca.',
    svg: `<rect class="ar-pared" x="14" y="14" width="92" height="52" rx="1"/>
<rect class="ar-mueble" x="50" y="34" width="22" height="14" rx="1.5"/>
<path class="ar-iman" d="M44 18h34"/>`,
  },
  {
    titulo: '3. En 3D y por dentro',
    texto: '«3D» para verla desde fuera; «Recorrer» para andar dentro (teclado, ratón o el mando en el móvil). «Medir» mide entre dos puntos.',
    svg: `<path class="ar-pared" d="M20 56 60 70 100 56 100 22 60 36 20 22Z"/>
<path class="ar-pared" d="M60 36v34"/>
<g class="ar-persona"><circle cx="0" cy="0" r="3.2"/><path d="M0 0 12 -5 12 5Z"/></g>`,
  },
];

/** Lista con los tres pasos, para el diálogo de ayuda. */
export function ayudaRapida(): HTMLElement {
  const ol = document.createElement('ol');
  ol.className = 'ayuda-rapida';
  ol.setAttribute('aria-label', 'Ayuda rápida en tres pasos');
  for (const p of PASOS) {
    const li = document.createElement('li');
    li.innerHTML = `<svg viewBox="0 0 120 80" aria-hidden="true" focusable="false">${p.svg}</svg><div><strong></strong><p></p></div>`;
    li.querySelector('strong')!.textContent = p.titulo;
    li.querySelector('p')!.textContent = p.texto;
    ol.append(li);
  }
  return ol;
}
