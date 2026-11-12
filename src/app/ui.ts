// Paneles laterales: estancia (medidas, paredes una a una, esquinas), puertas y ventanas,
// catálogo, lista de muebles, ficha del seleccionado e incidencias.
import type { Espacio, Hueco, Incidencia, Mueble, Suelo, Tramo } from '../core/index.js';
import { plantaDe } from './plantaActiva.js';
import { CATALOGO, COLOR_PAREDES, colorSuelo, contornoDesdeTramos, entradaMueble, esRectangular, estancia as estanciaDe, longitudMuro, tramosDesdeContorno } from '../core/index.js';
import { formatoCm } from './escena.js';
import { iconoMueble, ICONOS } from './iconos.js';

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id}`);
  return el;
}
export function $in(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement;
}

export interface AccionesUI {
  estancia(ancho: number, largo: number, alto: number): void;
  altoYGrosor(cambios: { altura?: number; grosorMuros?: number; circuloDeGiro?: boolean; suelo?: Suelo | null; paredes?: string | null }): void;
  paredes(tramos: Tramo[]): void;
  editarEsquinas(activo: boolean): void;
  agregarHueco(tipo: Hueco['tipo']): void;
  seleccionarHueco(id: string | null): void;
  editarHueco(id: string, cambios: Partial<Hueco>): void;
  quitarHueco(id: string): void;
  seleccionarEstancia(id: string): void;
  agregarEstancia(): void;
  quitarEstancia(): void;
  renombrarEstancia(nombre: string): void;
  guardarDistribucion(nombre: string): void;
  aplicarDistribucion(nombre: string): void;
  quitarDistribucion(nombre: string): void;
  exportar(formato: 'svg' | 'png' | 'glb'): void;
  imprimir(): void;
  agregar(tipo: string): void;
  seleccionar(id: string): void;
  /** Ctrl+clic: añade o quita el mueble de la selección. */
  alternar(id: string): void;
  editar(id: string, cambios: Partial<Mueble>): void;
  cambiarTipo(id: string, tipo: string): void;
  girar90(): void;
  duplicar(): void;
  quitar(): void;
}

const CAMPOS_NUM = ['ancho', 'fondo', 'alto', 'x', 'y', 'giro', 'elevacion'] as const;

export class Paneles {
  private espacio: Espacio | null = null;
  private seleccion: string | null = null;
  /** Muebles elegidos además del principal (selección múltiple). */
  grupo: ReadonlySet<string> = new Set();
  private huecoSel: string | null = null;
  /** Estancia que se edita en el panel (la seleccionada en la página). */
  private estanciaSel: string | undefined;
  /** La tabla de paredes tiene cambios sin aplicar: no se repinta desde el espacio. */
  private tablaSucia = false;
  private firmaContorno = '';
  /** Campo en el que la persona está escribiendo: no se repinta hasta que confirme. */
  private editando: EventTarget | null = null;

  constructor(private readonly acciones: AccionesUI) {
    document.addEventListener('input', (ev) => (this.editando = ev.target));
    // Valor al entrar en un campo: Esc lo restaura (y así no salta «change»).
    document.addEventListener('focusin', (ev) => {
      if (ev.target instanceof HTMLInputElement) ev.target.dataset.original = ev.target.value;
    });
    // En captura: se limpia antes de que el manejador del campo aplique el cambio y se repinte.
    document.addEventListener('change', () => (this.editando = null), true);
    document.addEventListener('focusout', () => (this.editando = null), true);
    const cat = $('catalogo');
    for (const t of CATALOGO) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tipo = t.tipo;
      b.title = `Añadir ${t.etiqueta.toLowerCase()} (${t.ancho}×${t.fondo}×${t.alto} cm)`;
      b.innerHTML = `${iconoMueble(t.tipo)}<span>${t.etiqueta}</span>`;
      b.addEventListener('click', () => acciones.agregar(t.tipo));
      cat.append(b);
    }
    const sel = $('m-tipo') as HTMLSelectElement;
    for (const t of CATALOGO) sel.add(new Option(t.etiqueta, t.tipo));

    // Estancia: se aplica al confirmar (Intro o salir del campo).
    for (const id of ['e-ancho', 'e-largo']) {
      $in(id).addEventListener('change', () => {
        const n = (k: string): number => Number($in(k).value);
        acciones.estancia(n('e-ancho'), n('e-largo'), n('e-alto'));
      });
    }
    // Un campo vacío no es 0: se deja como estaba.
    $in('e-alto').addEventListener('change', () => ($in('e-alto').value.trim() ? acciones.altoYGrosor({ altura: Number($in('e-alto').value) }) : this.pintarEstancia($in('editar-esquinas').checked)));
    $in('e-grosor').addEventListener('change', () => ($in('e-grosor').value.trim() ? acciones.altoYGrosor({ grosorMuros: Number($in('e-grosor').value) }) : this.pintarEstancia($in('editar-esquinas').checked)));

    // Paredes una a una.
    const tabla = $('tabla-paredes');
    tabla.addEventListener('input', () => {
      this.tablaSucia = true;
      this.pintarDescuadre();
    });
    tabla.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button[data-quitar]') as HTMLButtonElement | null;
      if (!b) return;
      const filas = this.leerTabla();
      filas.splice(Number(b.dataset.quitar), 1);
      this.tablaSucia = true;
      this.pintarTabla(filas);
    });
    $('b-pared-mas').addEventListener('click', () => {
      this.tablaSucia = true;
      this.pintarTabla([...this.leerTabla(), { longitud: 100, giro: 90 }]);
    });
    $('b-paredes-aplicar').addEventListener('click', () => acciones.paredes(this.leerTabla()));
    $('b-paredes-descartar').addEventListener('click', () => {
      this.tablaSucia = false;
      if (this.espacio) this.pintarTabla(tramosDesdeContorno(estanciaDe(this.espacio, this.estanciaSel).estancia.contorno));
    });
    $in('editar-esquinas').addEventListener('change', () => acciones.editarEsquinas($in('editar-esquinas').checked));
    $in('e-giro').addEventListener('change', () => acciones.altoYGrosor({ circuloDeGiro: $in('e-giro').checked }));
    // Acabados: cambiar el tipo de suelo vuelve al color de ese tipo; el color se cambia aparte.
    const tipoSuelo = (): Suelo['tipo'] => ($('e-suelo') as HTMLSelectElement).value as Suelo['tipo'];
    $('e-suelo').addEventListener('change', () => acciones.altoYGrosor({ suelo: { tipo: tipoSuelo() } }));
    $in('e-color-suelo').addEventListener('change', () => acciones.altoYGrosor({ suelo: { tipo: tipoSuelo(), color: $in('e-color-suelo').value } }));
    $in('e-paredes').addEventListener('change', () => acciones.altoYGrosor({ paredes: $in('e-paredes').value }));
    $('b-acabados-quitar').addEventListener('click', () => acciones.altoYGrosor({ suelo: null, paredes: null }));

    // Estancias de la planta: elegir cuál se edita, añadir, quitar y renombrar.
    $('lista-estancias').addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button[data-estancia]') as HTMLButtonElement | null;
      if (b?.dataset.estancia) acciones.seleccionarEstancia(b.dataset.estancia);
    });
    $('b-estancia-mas').addEventListener('click', () => acciones.agregarEstancia());
    $('b-estancia-quitar').addEventListener('click', () => acciones.quitarEstancia());
    $in('e-nombre').addEventListener('change', () => {
      const v = $in('e-nombre').value.trim();
      if (v) acciones.renombrarEstancia(v);
      else this.pintarEstancia($in('editar-esquinas').checked);
    });

    // Puertas, ventanas y pasos.
    for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-hueco]')) {
      b.addEventListener('click', () => acciones.agregarHueco(b.dataset.hueco as Hueco['tipo']));
    }
    for (const k of ['desde', 'ancho', 'alto', 'antepecho'] as const) {
      $in(`h-${k}`).addEventListener('change', (ev) => {
        const v = (ev.target as HTMLInputElement).value;
        if (this.huecoSel && v.trim() !== '') acciones.editarHueco(this.huecoSel, { [k]: Number(v) });
        else this.pintarHuecos();
      });
    }
    for (const k of ['abre', 'bisagra'] as const) {
      const s = $(`h-${k}`) as HTMLSelectElement;
      s.addEventListener('change', () => this.huecoSel && acciones.editarHueco(this.huecoSel, { [k]: s.value }));
    }
    // Al cambiar de pared, el hueco se recoloca para que quepa (centrado si su posición no sirve).
    $('h-muro').addEventListener('change', () => {
      const h = (this.espacio && estanciaDe(this.espacio, this.estanciaSel).estancia)?.huecos.find((x) => x.id === this.huecoSel);
      if (!h || !this.espacio) return;
      const muro = Number(($('h-muro') as HTMLSelectElement).value);
      const largo = longitudMuro(estanciaDe(this.espacio, this.estanciaSel).estancia.contorno, muro);
      const desde = h.desde + h.ancho <= largo ? h.desde : Math.max(0, Math.round((largo - h.ancho) / 2));
      acciones.editarHueco(h.id, { muro, desde });
    });
    $('h-quitar').addEventListener('click', () => this.huecoSel && acciones.quitarHueco(this.huecoSel));

    // Distribuciones y exportación.
    $('form-distribucion').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const nombre = $in('d-nombre').value.trim();
      if (!nombre) {
        $in('d-nombre').focus();
        return;
      }
      acciones.guardarDistribucion(nombre);
      $in('d-nombre').value = '';
    });
    $('x-svg').addEventListener('click', () => acciones.exportar('svg'));
    $('x-imprimir').addEventListener('click', () => acciones.imprimir());
    $('x-png').addEventListener('click', () => acciones.exportar('png'));
    $('x-glb').addEventListener('click', () => acciones.exportar('glb'));
    $('ficha-hueco').addEventListener('submit', (ev) => ev.preventDefault());

    // Ficha del mueble.
    for (const k of CAMPOS_NUM) {
      $in(`m-${k}`).addEventListener('change', (ev) => {
        const v = Number((ev.target as HTMLInputElement).value);
        if (this.seleccion && (ev.target as HTMLInputElement).value.trim() !== '') acciones.editar(this.seleccion, { [k]: v });
        else this.pintarFicha();
      });
    }
    $in('m-nombre').addEventListener('change', () => {
      const v = $in('m-nombre').value.trim();
      if (this.seleccion && v) acciones.editar(this.seleccion, { nombre: v });
      else this.pintarFicha();
    });
    sel.addEventListener('change', () => this.seleccion && acciones.cambiarTipo(this.seleccion, sel.value));
    $in('m-color').addEventListener('change', () => this.seleccion && acciones.editar(this.seleccion, { color: $in('m-color').value }));
    $in('m-bloqueado').addEventListener('change', () => this.seleccion && acciones.editar(this.seleccion, { bloqueado: $in('m-bloqueado').checked }));
    $('ficha').addEventListener('submit', (ev) => ev.preventDefault());
    $('m-girar').addEventListener('click', () => acciones.girar90());
    $('m-duplicar').addEventListener('click', () => acciones.duplicar());
    $('m-eliminar').addEventListener('click', () => acciones.quitar());
  }

  pintar(espacio: Espacio, seleccion: string | null, incidencias: readonly Incidencia[], huecoSel: string | null, editandoEsquinas: boolean, estanciaSel?: string): void {
    this.espacio = espacio;
    this.estanciaSel = estanciaSel;
    this.seleccion = seleccion;
    this.huecoSel = huecoSel;
    this.pintarEstancia(editandoEsquinas);
    this.pintarHuecos();
    this.pintarDistribuciones();
    this.pintarLista();
    this.pintarFicha();
    this.pintarIncidencias(incidencias);
    $('invitacion').hidden = plantaDe(espacio).muebles.length > 0;
  }

  private pintarEstancia(editandoEsquinas: boolean): void {
    const e = this.espacio!;
    const rect = esRectangular(e, this.estanciaSel);
    this.pintarEstancias();
    $('campo-ancho').hidden = !rect;
    $('campo-largo').hidden = !rect;
    $('ayuda-rect').hidden = !rect;
    $('estancia-libre').hidden = !!rect;
    const poner = (id: string, v: number): void => {
      const el = $in(id);
      if (this.editando !== el) el.value = String(v);
    };
    if (rect) {
      poner('e-ancho', rect.ancho);
      poner('e-largo', rect.largo);
    }
    poner('e-alto', estanciaDe(e, this.estanciaSel).estancia.altura);
    poner('e-grosor', plantaDe(e).grosorExterior);
    const nombre = $in('nombre-espacio');
    if (this.editando !== nombre) nombre.value = e.nombre;
    $in('editar-esquinas').checked = editandoEsquinas;
    const est = estanciaDe(e, this.estanciaSel).estancia;
    $in('e-giro').checked = !!est.circuloDeGiro;
    ($('e-suelo') as HTMLSelectElement).value = est.suelo?.tipo ?? 'liso';
    if (this.editando !== $in('e-color-suelo')) $in('e-color-suelo').value = colorSuelo(est);
    if (this.editando !== $in('e-paredes')) $in('e-paredes').value = est.paredes ?? COLOR_PAREDES;
    ($('b-acabados-quitar') as HTMLButtonElement).disabled = !est.suelo && !est.paredes;
    $('ayuda-esquinas').hidden = !editandoEsquinas;
    $('n-paredes').textContent = String(estanciaDe(e, this.estanciaSel).estancia.contorno.length);
    // Si el contorno cambia (esquinas, deshacer, un agente, Nuevo…) la tabla se rehace; si tenía
    // cambios sin aplicar, se avisa de que se han descartado, para no aplicar luego medidas viejas.
    const firma = JSON.stringify([this.estanciaSel ?? '', estanciaDe(e, this.estanciaSel).estancia.contorno]);
    if (firma !== this.firmaContorno) {
      const descartados = this.tablaSucia && this.firmaContorno !== '';
      this.tablaSucia = false;
      this.pintarTabla(tramosDesdeContorno(estanciaDe(e, this.estanciaSel).estancia.contorno));
      if (descartados) {
        $('descuadre').textContent = 'La estancia ha cambiado: la tabla muestra sus paredes actuales y se han descartado los cambios que no habías aplicado.';
        $('descuadre').className = 'ayuda fallo';
      }
    }
    this.firmaContorno = firma;
  }

  /** Lista de estancias de la planta, con la seleccionada marcada, su nombre y quitar. */
  private pintarEstancias(): void {
    const pl = plantaDe(this.espacio!);
    const sel = estanciaDe(this.espacio!, this.estanciaSel).estancia;
    const ul = $('lista-estancias');
    const firma = JSON.stringify([pl.estancias.map((s) => [s.id, s.nombre]), sel.id]);
    if (ul.dataset.firma !== firma) {
      ul.dataset.firma = firma;
      ul.replaceChildren(
        ...pl.estancias.map((s) => {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip';
          b.dataset.estancia = s.id;
          b.setAttribute('aria-pressed', String(s.id === sel.id));
          b.textContent = s.nombre;
          li.append(b);
          return li;
        }),
      );
    }
    const nombre = $in('e-nombre');
    if (this.editando !== nombre) nombre.value = sel.nombre;
    ($('b-estancia-quitar') as HTMLButtonElement).disabled = pl.estancias.length < 2;
  }

  /** Marca la tabla como aplicada (tras aplicar con éxito). */
  tablaAplicada(): void {
    this.tablaSucia = false;
    this.firmaContorno = '';
    if (this.espacio) this.pintarEstancia($in('editar-esquinas').checked);
  }

  private leerTabla(): Tramo[] {
    return [...$('tabla-paredes').querySelectorAll('tr')].map((tr) => ({
      longitud: Number((tr.querySelector('input[data-campo="longitud"]') as HTMLInputElement).value),
      giro: Number((tr.querySelector('input[data-campo="giro"]') as HTMLInputElement).value),
    }));
  }

  private pintarTabla(tramos: Tramo[]): void {
    $('tabla-paredes').replaceChildren(
      ...tramos.map((t, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${i + 1}</td>
          <td><input type="number" inputmode="decimal" step="1" min="1" data-campo="longitud" aria-label="Longitud de la pared ${i + 1} en cm"></td>
          <td><input type="number" inputmode="decimal" step="15" data-campo="giro" aria-label="Giro al final de la pared ${i + 1} en grados"></td>
          <td><button type="button" data-quitar="${i}" title="Quitar la pared ${i + 1}" aria-label="Quitar la pared ${i + 1}">×</button></td>`;
        (tr.querySelector('[data-campo="longitud"]') as HTMLInputElement).value = String(t.longitud);
        (tr.querySelector('[data-campo="giro"]') as HTMLInputElement).value = String(t.giro);
        return tr;
      }),
    );
    this.pintarDescuadre();
  }

  private pintarDescuadre(): void {
    const el = $('descuadre');
    try {
      const r = contornoDesdeTramos(this.leerTabla());
      const cierra = r.descuadre <= 0.5;
      el.textContent = cierra ? 'Las paredes cierran.' : `No cierran por ${formatoCm(r.descuadre)} cm: la última pared medirá ${formatoCm(r.ultimaReal)} cm. Revisa las medidas.`;
      el.className = cierra ? 'ayuda' : 'ayuda fallo';
    } catch (e) {
      el.textContent = e instanceof Error ? e.message : String(e);
      el.className = 'ayuda fallo';
    }
  }

  private pintarDistribuciones(): void {
    const ds = this.espacio!.distribuciones;
    $('contador-distribuciones').textContent = ds.length ? String(ds.length) : '';
    $('ayuda-distribuciones').hidden = ds.length > 0;
    $('lista-distribuciones').replaceChildren(
      ...ds.map((d) => {
        const li = document.createElement('li');
        const aplicar = document.createElement('button');
        aplicar.type = 'button';
        aplicar.dataset.distribucion = d.nombre;
        aplicar.title = `Colocar los muebles como en «${d.nombre}»`;
        const izq = document.createElement('span');
        izq.textContent = d.nombre;
        const der = document.createElement('span');
        der.className = 'medida';
        der.textContent = 'Aplicar';
        aplicar.append(izq, der);
        aplicar.addEventListener('click', () => this.acciones.aplicarDistribucion(d.nombre));
        const quitar = document.createElement('button');
        quitar.type = 'button';
        quitar.className = 'quitar';
        quitar.textContent = '×';
        quitar.title = `Borrar la distribución «${d.nombre}»`;
        quitar.setAttribute('aria-label', `Borrar la distribución ${d.nombre}`);
        quitar.addEventListener('click', () => this.acciones.quitarDistribucion(d.nombre));
        li.append(aplicar, quitar);
        return li;
      }),
    );
  }

  pintarHuecos(): void {
    const e = this.espacio;
    if (!e) return;
    const hs = estanciaDe(e, this.estanciaSel).estancia.huecos;
    const nombre = (h: Hueco): string => (h.tipo === 'puerta' ? 'Puerta' : h.tipo === 'ventana' ? 'Ventana' : 'Paso');
    $('contador-huecos').textContent = hs.length ? String(hs.length) : '';
    $('ayuda-huecos').hidden = hs.length === 0;
    $('lista-huecos').replaceChildren(
      ...hs.map((h) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.hueco = h.id;
        b.setAttribute('aria-current', String(h.id === this.huecoSel));
        const izq = document.createElement('span');
        izq.textContent = `${nombre(h)} · pared ${h.muro + 1}`;
        const der = document.createElement('span');
        der.className = 'medida';
        der.textContent = `${formatoCm(h.ancho)} cm`;
        b.append(izq, der);
        b.addEventListener('click', () => this.acciones.seleccionarHueco(h.id === this.huecoSel ? null : h.id));
        li.append(b);
        return li;
      }),
    );
    const h = hs.find((x) => x.id === this.huecoSel);
    $('ficha-hueco').hidden = !h;
    if (!h) return;
    const muros = $('h-muro') as HTMLSelectElement;
    const c = estanciaDe(e, this.estanciaSel).estancia.contorno;
    if (muros.options.length !== c.length || muros.dataset.firma !== JSON.stringify(c)) {
      muros.replaceChildren(...c.map((_, i) => new Option(`Pared ${i + 1} (${formatoCm(longitudMuro(c, i))} cm)`, String(i))));
      muros.dataset.firma = JSON.stringify(c);
    }
    muros.value = String(h.muro);
    const poner = (id: string, v: number): void => {
      const el = $in(id);
      if (this.editando !== el) el.value = String(v);
    };
    poner('h-desde', h.desde);
    poner('h-ancho', h.ancho);
    poner('h-alto', h.alto);
    poner('h-antepecho', h.antepecho);
    $('campo-antepecho').hidden = h.tipo !== 'ventana';
    $('campos-puerta').hidden = h.tipo !== 'puerta';
    if (h.tipo === 'puerta') {
      ($('h-abre') as HTMLSelectElement).value = h.abre ?? 'dentro';
      ($('h-bisagra') as HTMLSelectElement).value = h.bisagra ?? 'inicio';
    }
  }

  private pintarLista(): void {
    const ul = $('lista-muebles');
    const ms = plantaDe(this.espacio!).muebles;
    $('contador').textContent = ms.length ? String(ms.length) : '';
    $('lista-vacia').hidden = ms.length > 0;
    const enfocado = (document.activeElement as HTMLElement | null)?.dataset?.id;
    ul.replaceChildren(
      ...ms.map((m) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.id = m.id;
        b.setAttribute('aria-current', String(m.id === this.seleccion || this.grupo.has(m.id)));
        const izq = document.createElement('span');
        const muestra = document.createElement('span');
        muestra.className = 'muestra';
        muestra.style.background = m.color;
        izq.append(muestra, m.nombre);
        if (m.bloqueado) {
          const c = document.createElement('span');
          c.className = 'candado';
          c.title = 'Bloqueado';
          c.innerHTML = ` ${ICONOS.candado.replace('<svg ', '<svg width="12" height="12" ')}`;
          izq.append(c);
        }
        const der = document.createElement('span');
        der.className = 'medida';
        der.textContent = `${formatoCm(m.ancho)}×${formatoCm(m.fondo)}`;
        b.append(izq, der);
        b.addEventListener('click', (ev) => (ev.ctrlKey || ev.metaKey ? this.acciones.alternar(m.id) : this.acciones.seleccionar(m.id)));
        li.append(b);
        return li;
      }),
    );
    if (enfocado) (ul.querySelector(`[data-id="${CSS.escape(enfocado)}"]`) as HTMLElement | null)?.focus();
  }

  pintarFicha(): void {
    const m = (this.espacio && plantaDe(this.espacio).muebles)?.find((x) => x.id === this.seleccion);
    $('ficha').hidden = !m;
    $('sin-seleccion').hidden = !!m;
    if (!m) return;
    const poner = (id: string, v: string): void => {
      const el = $in(id);
      if (this.editando !== el) el.value = v;
    };
    poner('m-nombre', m.nombre);
    ($('m-tipo') as HTMLSelectElement).value = CATALOGO.some((t) => t.tipo === m.tipo) ? m.tipo : 'caja';
    for (const k of CAMPOS_NUM) poner(`m-${k}`, String(m[k]));
    poner('m-color', m.color);
    $in('m-bloqueado').checked = m.bloqueado;
    $('m-entra').textContent = this.textoEntrada(m.id, m);
  }

  /** «Entra por la puerta»: se calcula sólo cuando cambian sus medidas o la casa (puertas, escaleras). */
  private firmaEntrada = '';
  private textoEntradaCache = '';
  private textoEntrada(id: string, m: { ancho: number; fondo: number; alto: number }): string {
    const e = this.espacio;
    if (!e) return '';
    const firma = JSON.stringify([id, m.ancho, m.fondo, m.alto, e.plantas.map((p) => [p.estancias, p.escaleras ?? null, p.muebles.find((x) => x.id === id) ? [p.id] : null])]);
    if (firma === this.firmaEntrada) return this.textoEntradaCache;
    this.firmaEntrada = firma;
    let r: ReturnType<typeof entradaMueble>;
    try {
      r = entradaMueble(e, id);
    } catch {
      r = { estado: 'sin-datos', noPasa: [] };
    }
    this.textoEntradaCache =
      r.estado === 'entra' ? 'Entra por la puerta hasta su estancia.'
      : r.estado === 'no-entra' ? `No entra por la puerta hasta su estancia: no pasa por ${r.noPasa.map((h) => `${h.nombre} (${h.ancho} × ${h.alto} cm)`).join(', ')}.`
      : '';
    return this.textoEntradaCache;
  }

  private pintarIncidencias(incidencias: readonly Incidencia[]): void {
    const ul = $('lista-incidencias');
    $('contador-incidencias').textContent = incidencias.length ? String(incidencias.length) : '';
    $('sin-incidencias').hidden = incidencias.length > 0;
    ul.replaceChildren(
      ...incidencias.map((i) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = i.gravedad === 'error' ? 'error-i' : 'aviso-i';
        b.textContent = i.mensaje;
        b.addEventListener('click', () => i.muebles[0] && this.acciones.seleccionar(i.muebles[0]));
        li.append(b);
        return li;
      }),
    );
  }

  mostrarError(id: 'e-error' | 'm-error' | 'h-error', mensaje: string | null): void {
    const el = $(id);
    el.hidden = !mensaje;
    el.textContent = mensaje ?? '';
  }
}
