// Panel «Planta» (R2-7): elegir la planta que se ve y se edita, añadir una (copiando la huella de la
// activa o con una estancia nueva), cambiar su nombre y su nivel, y quitarla con todo lo suyo.
import type { Espacio } from '../core/index.js';
import { agregarPlanta, editarPlanta, nivelSiguiente, nombreLibre, quitarPlanta } from '../core/index.js';
import { plantaDe } from './plantaActiva.js';
import { $ } from './ui.js';

export interface AnfitrionPlantas {
  esp(): Espacio;
  aplicar(e: Espacio): void;
  /** Pasa a ver y editar otra planta. */
  elegir(id: string): void;
  aviso(texto: string): void;
  confirmar(titulo: string, texto: string, aceptar: string): Promise<boolean>;
  pedir<T>(titulo: string, nodos: Node[], aceptar: string, leer: () => T): Promise<T | null>;
}

function campo(etiqueta: string, input: HTMLInputElement, unidad?: string): HTMLElement {
  const l = document.createElement('label');
  l.className = 'campo';
  const s = document.createElement('span');
  s.textContent = etiqueta;
  const e = document.createElement('span');
  e.className = 'entrada';
  e.append(input);
  if (unidad) {
    const i = document.createElement('i');
    i.textContent = unidad;
    e.append(i);
  }
  l.append(s, e);
  return l;
}

function casilla(texto: string, marcada: boolean): [HTMLElement, HTMLInputElement] {
  const l = document.createElement('label');
  l.className = 'casilla';
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = marcada;
  const s = document.createElement('span');
  s.textContent = texto;
  l.append(c, s);
  return [l, c];
}

const entrada = (tipo: string, valor: string, id: string): HTMLInputElement => {
  const i = document.createElement('input');
  i.type = tipo;
  i.value = valor;
  i.id = id;
  if (tipo === 'number') {
    i.step = '1';
    i.inputMode = 'decimal';
  }
  return i;
};

export class PanelPlantas {
  constructor(private readonly a: AnfitrionPlantas) {
    $('lista-plantas').addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button[data-planta]') as HTMLButtonElement | null;
      if (b?.dataset.planta) a.elegir(b.dataset.planta);
    });
    $('b-planta-mas').addEventListener('click', () => void this.agregar());
    $('b-planta-editar').addEventListener('click', () => void this.editar());
    $('b-planta-quitar').addEventListener('click', () => void this.quitar());
  }

  pintar(): void {
    const e = this.a.esp();
    const activa = plantaDe(e);
    const ul = $('lista-plantas');
    // Las plantas, de la más alta a la más baja, como en un edificio.
    const orden = [...e.plantas].sort((x, y) => y.nivel - x.nivel);
    const firma = JSON.stringify([orden.map((p) => [p.id, p.nombre, p.nivel]), activa.id]);
    if (ul.dataset.firma !== firma) {
      ul.dataset.firma = firma;
      ul.replaceChildren(
        ...orden.map((p) => {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip';
          b.dataset.planta = p.id;
          b.setAttribute('aria-pressed', String(p.id === activa.id));
          b.title = `Nivel ${p.nivel} cm`;
          b.textContent = p.nombre;
          li.append(b);
          return li;
        }),
      );
    }
    ($('b-planta-quitar') as HTMLButtonElement).disabled = e.plantas.length < 2;
  }

  private async agregar(): Promise<void> {
    const e = this.a.esp();
    const base = plantaDe(e);
    const nombre = entrada('text', nombreLibre(e), 'pl-nombre');
    nombre.maxLength = 40;
    const nivel = entrada('number', String(nivelSiguiente(e)), 'pl-nivel');
    const [cCopiar, copiar] = casilla(`Copiar la huella de «${base.nombre}» (sus estancias, sin muebles)`, true);
    const [cVentanas, ventanas] = casilla('Con sus ventanas', true);
    copiar.id = 'pl-copiar';
    ventanas.id = 'pl-ventanas';
    copiar.addEventListener('change', () => (ventanas.disabled = !copiar.checked));
    const ayuda = document.createElement('p');
    ayuda.className = 'ayuda';
    ayuda.textContent = 'El nivel es la altura del suelo de la planta (cm). Por defecto, encima de la más alta con 30 cm de forjado.';
    const datos = await this.a.pedir('Añadir planta', [campo('Nombre', nombre), campo('Nivel del suelo', nivel, 'cm'), cCopiar, cVentanas, ayuda], 'Añadir planta', () => ({
      nombre: nombre.value.trim() || nombreLibre(e),
      nivel: nivel.value.trim() === '' ? NaN : Number(nivel.value.replace(',', '.')),
      copiar: copiar.checked,
      ventanas: ventanas.checked,
    }));
    if (!datos) return;
    try {
      const r = agregarPlanta(this.a.esp(), {
        nombre: datos.nombre,
        ...(Number.isFinite(datos.nivel) ? { nivel: datos.nivel } : {}),
        ...(datos.copiar ? { copiarDe: base.id, conVentanas: datos.ventanas } : { contorno: [[0, 0], [400, 0], [400, 300], [0, 300]] }),
      });
      this.a.aplicar(r.espacio);
      this.a.elegir(r.id);
      this.a.aviso(`Planta «${datos.nombre}» añadida${datos.copiar ? ` con la huella de «${base.nombre}»` : ''}. Ctrl+Z la quita.`);
    } catch (err) {
      this.a.aviso((err as Error).message);
    }
  }

  private async editar(): Promise<void> {
    const p = plantaDe(this.a.esp());
    const nombre = entrada('text', p.nombre, 'pl-nombre');
    nombre.maxLength = 40;
    const nivel = entrada('number', String(p.nivel), 'pl-nivel');
    const datos = await this.a.pedir(`Planta «${p.nombre}»`, [campo('Nombre', nombre), campo('Nivel del suelo', nivel, 'cm')], 'Guardar cambios', () => ({
      nombre: nombre.value.trim(),
      nivel: nivel.value.trim() === '' ? NaN : Number(nivel.value.replace(',', '.')),
    }));
    if (!datos) return;
    try {
      this.a.aplicar(editarPlanta(this.a.esp(), p.id, { ...(datos.nombre ? { nombre: datos.nombre } : {}), ...(Number.isFinite(datos.nivel) ? { nivel: datos.nivel } : {}) }));
    } catch (err) {
      this.a.aviso((err as Error).message);
    }
  }

  private async quitar(): Promise<void> {
    const e = this.a.esp();
    const p = plantaDe(e);
    let r: ReturnType<typeof quitarPlanta>;
    try {
      r = quitarPlanta(e, p.id);
    } catch (err) {
      return this.a.aviso((err as Error).message);
    }
    const q = r.quitado;
    const partes = [`${q.estancias} ${q.estancias === 1 ? 'estancia' : 'estancias'}`, `${q.muebles} ${q.muebles === 1 ? 'mueble' : 'muebles'}`];
    if (q.elementos) partes.push(`${q.elementos} de obra`);
    if (q.fondos) partes.push(`${q.fondos} ${q.fondos === 1 ? 'plano de fondo' : 'planos de fondo'}`);
    if (q.escaleras) partes.push(`${q.escaleras} ${q.escaleras === 1 ? 'escalera' : 'escaleras'}`);
    if (!(await this.a.confirmar(`¿Quitar la planta «${p.nombre}»?`, `Se quitan con ella ${partes.join(', ')}. Se puede deshacer con Ctrl+Z.`, 'Quitar planta'))) return;
    // Con el diálogo abierto pudo cambiar el espacio (un agente): se quita sobre el actual.
    if (!this.a.esp().plantas.some((x) => x.id === p.id)) return this.a.aviso(`«${p.nombre}» ya no está: la ha quitado otro (un agente o el archivo).`);
    try {
      const ahora = quitarPlanta(this.a.esp(), p.id);
      this.a.aplicar(ahora.espacio);
      this.a.elegir(ahora.espacio.plantas[0]!.id);
    } catch (err) {
      this.a.aviso((err as Error).message);
    }
  }
}
