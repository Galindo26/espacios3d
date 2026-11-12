// Fotos de estancias y muebles (R4-3): rutas relativas a la carpeta del .espacio.json (normalmente
// «fotos/…»), para que la persona y el agente tengan a mano las fotos que se usaron para medir o
// para elegir. La herramienta no reconstruye nada a partir de ellas.
import { clonar } from './espacio.js';
import type { Espacio, Estancia, Mueble } from './tipos.js';
import { ErrorOperacion } from './tipos.js';
import { rutaRelativaValida, validar } from './validar.js';

/** Extensiones de imagen admitidas. */
export const RE_FOTO = /\.(jpe?g|png|webp)$/i;

/** Problema de una ruta de foto (null si vale). */
export function fotoInvalida(foto: string): string | null {
  const malo = rutaRelativaValida(foto);
  if (malo) return malo;
  return RE_FOTO.test(foto) ? null : 'debe ser una imagen .jpg, .jpeg, .png o .webp';
}

function confirmar(e: Espacio): Espacio {
  const r = validar(e);
  if (!r.ok) throw new ErrorOperacion(`El resultado no es válido:\n- ${r.errores.join('\n- ')}`);
  return r.espacio;
}

/** La estancia o el mueble con ese id (en cualquier planta). */
function destino(e: Espacio, id: string): Estancia | Mueble {
  for (const p of e.plantas) {
    const x = p.estancias.find((s) => s.id === id) ?? p.muebles.find((m) => m.id === id);
    if (x) return x;
  }
  throw new ErrorOperacion(`No hay ninguna estancia ni mueble con id «${id}»`);
}

/** Asocia una foto a una estancia o a un mueble (una vez: repetirla no la duplica). */
export function agregarFoto(e: Espacio, para: string, foto: string): Espacio {
  const malo = fotoInvalida(foto);
  if (malo) throw new ErrorOperacion(`La foto «${foto}» ${malo}`);
  destino(e, para);
  const r = clonar(e);
  const x = destino(r, para);
  if (!(x.fotos ?? []).includes(foto)) x.fotos = [...(x.fotos ?? []), foto];
  return confirmar(r);
}

/** Quita una foto de una estancia o de un mueble (el archivo no se borra). */
export function quitarFoto(e: Espacio, para: string, foto: string): Espacio {
  const x0 = destino(e, para);
  if (!(x0.fotos ?? []).includes(foto)) throw new ErrorOperacion(`«${para}» no tiene la foto «${foto}». Tiene: ${(x0.fotos ?? []).join(', ') || '(ninguna)'}`);
  const r = clonar(e);
  const x = destino(r, para);
  x.fotos = x.fotos!.filter((f) => f !== foto);
  if (!x.fotos.length) delete x.fotos;
  return confirmar(r);
}

/** Todas las fotos del espacio, sin repetir. */
export function fotosDe(e: Espacio): string[] {
  return [...new Set(e.plantas.flatMap((p) => [...p.estancias, ...p.muebles].flatMap((x) => x.fotos ?? [])))];
}
