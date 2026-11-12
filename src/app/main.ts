// Controlador de la página: une estado, escena, paneles, interacción y sincronía con el archivo.
import * as THREE from 'three';
import type { DatosMueble, Espacio, Guia, Incidencia, Mueble, Punto } from '../core/index.js';
import { plantaActivaId, plantaDe, ponerPlantaActiva } from './plantaActiva.js';
import { PanelPlantas } from './plantas.js';
import {
  agregarEstancia, estanciaDeHueco, quitarEstancia, renombrarEstancia,
  estancia as estanciaDe,
  aJSON, agregarHueco, agregarMueble, anclajeDe, analizar, aplicarDistribucion, aplicarIman, guardarDistribucion, planoSVG, quitarDistribucion, cajaContorno, cambiarContorno, cambiarTipo, contornoDesdeTramos, cotas,
  duplicarMueble, editarEstancia, editarHueco, editarMueble, girarMueble, huecoNuevo, insertarVertice, longitudMuro, moverMueble,
  duplicarGrupo, girarGrupo, moverGrupo, quitarGrupo,
  moverVertice, muro, normalizarGiro, nuevoEspacio, puntoEnMuro, quitarHueco, quitarMueble, quitarVertice, redimensionarRectangulo,
  renombrarEspacio, validar, moverTabique, planoImprimible } from '../core/index.js';
import { borrarBorrador, crearAlmacen, guardarBorrador, leerUltimoBorrador, type Leido } from './almacen.js';
import { almacenConAbierto, leerAbierto, nombreLibre, normalRuta, rutaEnCarpetaElegida, type DatosAbierto } from './abierto.js';
import { Calco } from './calco.js';
import { PanelObra } from './obra.js';
import { Recorrido } from './recorrer.js';
import { Modelos } from './modelos.js';
import { Cinta } from './cinta.js';
import { Fotos } from './fotos.js';
import { ayudaRapida } from './ayudaRapida.js';
import { Escena, formatoCm, type EstadoEdicion, type Vista } from './escena.js';
import { Estado } from './estado.js';
import { ICONOS } from './iconos.js';
import { Sincronizador } from './sincronia.js';
import { $, $in, Paneles } from './ui.js';

declare const __VERSION__: string;

const SONDEO = 1000;
const UMBRAL_IMAN_PX = 10;

interface Arrastre {
  id: string;
  original: Mueble;
  /** Los demás muebles elegidos, tal como estaban: se mueven con el arrastrado (selección múltiple). */
  otros: Mueble[];
  actual: Mueble;
  desfase: Punto;
  /** Altura (cm) del punto agarrado: el plano de arrastre pasa por ahí para que no haya paralaje en 3D. */
  altura: number;
  inicio: Punto;
  ultimo: Punto | null;
  sinIman: boolean;
  movido: boolean;
  puntero: number;
}

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function nombreArchivo(nombre: string): string {
  const base = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${base || 'espacio'}.espacio.json`;
}

function espacioPorDefecto(): Espacio {
  return nuevoEspacio({ nombre: 'Mi habitación', ancho: 350, largo: 300, alto: 250 });
}

/** Campos donde las teclas se escriben, no son atajos. */
function esCampoDeTexto(t: EventTarget | null): boolean {
  if (t instanceof HTMLTextAreaElement) return true;
  return t instanceof HTMLInputElement && ['text', 'number', 'search', 'email', 'url', 'tel', ''].includes(t.type);
}

class App {
  private readonly estado: Estado;
  private readonly escena: Escena;
  private readonly paneles: Paneles;
  private readonly sinc: Sincronizador;
  private incidencias: Incidencia[] = [];
  private arrastre: Arrastre | null = null;
  /** Muebles elegidos con Ctrl+clic además del principal (estado.seleccion). */
  private grupo = new Set<string>();
  /** Arrastre de una esquina o de un hueco: vista previa sin tocar el historial hasta soltar. */
  private arrastreEstancia: {
    tipo: 'vertice' | 'hueco';
    k: number;
    id: string;
    puntero: number;
    inicio: Punto;
    previa: Espacio | null;
    agarre: number;
    /** Último destino válido: al soltar se aplica sobre el espacio de ese momento, por si cambió mientras tanto. */
    destino: { x: number; y: number } | { desde: number } | null;
    /** Número de esquinas al empezar. */
    esquinas: number;
  } | null = null;
  private edicion: EstadoEdicion = { editando: false, vertice: null, hueco: null, estancia: null };
  private pulsacionVacia: Punto | null = null;
  /** Midiendo con el dedo: dónde empezó el toque (si se arrastra, no es un punto de la cinta). */
  private toqueCinta: { id: number; x: number; y: number; anulado: boolean } | null = null;
  /** Dedos apoyados ahora en la página (para no tomar por segundo dedo uno que ya se levantó). */
  private readonly dedos = new Set<number>();
  private calco: Calco | null = null;
  private obra: PanelObra | null = null;
  private recorrido: Recorrido | null = null;
  private modelos: Modelos | null = null;
  private fotos: Fotos | null = null;
  private cinta: Cinta | null = null;
  private plantas: PanelPlantas | null = null;
  private temporizadorAviso: number | undefined;
  /** Página abierta por un agente con la casa dentro y aún sin vincular (ronda 5); null si no. */
  private abierto: DatosAbierto | null = leerAbierto();
  /**
   * Una página abierta por un agente no escribe ni borra el borrador de recuperación en toda su vida:
   * es de otra sesión y se perdería (revisión independiente del plan R5, B3).
   */
  private readonly sinBorrador = this.abierto !== null;
  /** La copia es de un archivo de la versión 1 (se avisa: al guardar se convierte). */
  private abiertoV1 = false;
  /** La carpeta recordada ya se probó: la siguiente pulsación de «Abrir su carpeta» abre el selector. */
  private sinRecordada = false;

  constructor() {
    const { espacio, recuperado } = this.espacioInicial();
    this.estado = new Estado(espacio);
    this.escena = new Escena($('lienzo'));
    this.sinc = new Sincronizador(this.abierto ? almacenConAbierto(crearAlmacen(), this.abierto, () => this.abierto !== null) : crearAlmacen(), {
      estado: (t, c) => this.ponerEstado(t, c),
      cargar: (e, msg) => {
        this.estado.reemplazar(e, 'archivo');
        this.aviso(msg);
      },
      bloqueo: (errores) => this.mostrarBloqueo(errores),
      guardado: () => {
        if (!this.sinBorrador) borrarBorrador();
      },
      // También al arrastrar una esquina o un hueco: si no, un cambio externo cargado en mitad
      // quedaría pisado al soltar por la vista previa calculada sobre el espacio anterior.
      arrastrando: () => this.arrastre !== null || this.arrastreEstancia !== null,
    });
    this.paneles = new Paneles({
      estancia: (a, l, h) => this.intentar('e-error', () => this.estado.aplicar(redimensionarRectangulo(this.esp, a, l, h, this.estSel))),
      altoYGrosor: (c) => this.intentar('e-error', () => this.estado.aplicar(editarEstancia(this.esp, c, this.estSel))),
      paredes: (tramos) => void this.aplicarParedes(tramos),
      editarEsquinas: (activo) => {
        this.edicion = { ...this.edicion, editando: activo, vertice: null };
        if (activo) this.ponerVista('plano');
        this.alCambiar(false, false);
      },
      agregarHueco: (tipo) =>
        this.intentar('h-error', () => {
          const r = agregarHueco(this.esp, huecoNuevo(this.esp, tipo, this.estSel), this.estSel);
          this.estado.aplicar(r.espacio);
          this.seleccionarHueco(r.id);
        }),
      seleccionarHueco: (id) => this.seleccionarHueco(id),
      editarHueco: (id, c) => this.intentar('h-error', () => this.estado.aplicar(editarHueco(this.esp, id, c))),
      quitarHueco: (id) => this.intentar('h-error', () => this.estado.aplicar(quitarHueco(this.esp, id))),
      seleccionarEstancia: (id) => this.seleccionarEstancia(id),
      agregarEstancia: () => this.agregarEstanciaNueva(),
      quitarEstancia: () => void this.quitarEstanciaSel(),
      renombrarEstancia: (nombre) => this.intentar('e-error', () => this.estado.aplicar(renombrarEstancia(this.esp, this.estSel, nombre))),
      guardarDistribucion: (nombre) => {
        try {
          const existe = this.esp.distribuciones.some((d) => d.nombre === nombre);
          this.estado.aplicar(guardarDistribucion(this.esp, nombre));
          this.aviso(existe ? `Distribución «${nombre}» actualizada con la colocación actual.` : `Distribución «${nombre}» guardada.`);
        } catch (e) {
          this.aviso(mensajeDe(e));
        }
      },
      aplicarDistribucion: (nombre) => {
        try {
          const r = aplicarDistribucion(this.esp, nombre);
          this.estado.aplicar(r.espacio);
          const notas = [
            r.ignorados.length ? `ya no existen: ${r.ignorados.join(', ')}` : '',
            r.sinPosicion.length ? `no estaban en ella y no se mueven: ${r.sinPosicion.join(', ')}` : '',
            r.bloqueados.length ? `bloqueados, no se mueven: ${r.bloqueados.join(', ')}` : '',
          ].filter(Boolean);
          this.aviso(`Aplicada «${nombre}» (Ctrl+Z para volver).${notas.length ? ` ${notas.join('; ')}.` : ''}`);
        } catch (e) {
          this.aviso(mensajeDe(e));
        }
      },
      quitarDistribucion: (nombre) => {
        void this.confirmar(`¿Borrar la distribución «${nombre}»?`, 'Los muebles no se mueven; sólo se olvida esa colocación guardada.', 'Borrar distribución').then((ok) => {
          if (ok) this.estado.aplicar(quitarDistribucion(this.esp, nombre));
        });
      },
      exportar: (formato) => void this.exportar(formato),
      imprimir: () => this.imprimir(),
      agregar: (tipo) => this.agregar({ tipo }),
      seleccionar: (id) => this.seleccionar(id),
      alternar: (id) => this.alternar(id),
      editar: (id, c) => this.intentar('m-error', () => this.estado.aplicar(editarMueble(this.esp, id, c))),
      cambiarTipo: (id, tipo) => this.intentar('m-error', () => this.estado.aplicar(cambiarTipo(this.esp, id, tipo))),
      girar90: () => this.girar(90),
      duplicar: () => this.duplicar(),
      quitar: () => this.quitar(),
    });
    this.calco = new Calco({
      esp: () => this.esp,
      aplicar: (e) => this.estado.aplicar(e),
      almacen: () => this.sinc.almacen,
      escena: this.escena,
      aviso: (t) => this.aviso(t),
      informar: (t, x, l) => this.informar(t, x, l),
      confirmar: (t, x, a) => this.confirmar(t, x, a),
      pedir: (t, n, a, leer) => this.dialogo(t, n, a, true).then((ok) => (ok ? leer() : null)),
      elegirEstancia: (id) => this.seleccionarEstancia(id),
      cmPorPixel: () => this.cmPorPixel(),
      usarLeido: async (l) => void (await this.usarLeido(l)),
      usarDeCarpeta: (c, ruta) => this.usarDeCarpeta(c, ruta),
      alEmpezarModo: () => this.cinta?.salir(),
    });
    this.recorrido = new Recorrido({
      esp: () => this.esp,
      estancia: () => this.estSel,
      escena: this.escena,
      ponerVista: (v) => this.ponerVista(v),
      aviso: (t) => this.aviso(t),
      cambiarPlanta: (id) => this.pasarDePlantaRecorriendo(id),
    });
    this.plantas = new PanelPlantas({
      esp: () => this.esp,
      aplicar: (e) => this.estado.aplicar(e),
      elegir: (id) => this.elegirPlanta(id),
      aviso: (t) => this.aviso(t),
      confirmar: (t, x, a) => this.confirmar(t, x, a),
      pedir: (t, n, a, leer) => this.dialogo(t, n, a, true).then((ok) => (ok ? leer() : null)),
    });
    this.cinta = new Cinta({ esp: () => this.esp, escena: this.escena, cmPorPixel: () => this.cmPorPixel(), aviso: (t) => this.aviso(t), alEntrar: () => this.calco?.cancelar() });
    this.fotos = new Fotos({
      esp: () => this.esp,
      aplicar: (e) => this.estado.aplicar(e),
      seleccion: () => this.estado.seleccion,
      estancia: () => this.estSel ?? null,
      almacen: () => this.sinc.almacen,
      aviso: (t) => this.aviso(t),
      informar: async (t, x) => void (await this.informar(t, x)),
    });
    this.modelos = new Modelos({
      esp: () => this.esp,
      aplicar: (e) => this.estado.aplicar(e),
      seleccion: () => this.estado.seleccion,
      almacen: () => this.sinc.almacen,
      escena: this.escena,
      aviso: (t) => this.aviso(t),
      informar: (t, x, l) => this.informar(t, x, l),
      confirmar: (t, x, a) => this.confirmar(t, x, a),
      pedir: (t, n, a, leer) => this.dialogo(t, n, a, true).then((ok) => (ok ? leer() : null)),
      agregar: (datos) => this.agregar(datos),
      repintar: () => this.alCambiar(false, false),
    });
    this.obra = new PanelObra({ esp: () => this.esp, aplicar: (e) => this.estado.aplicar(e), estancia: () => this.estSel, aviso: (t) => this.aviso(t), confirmar: (t, x, a) => this.confirmar(t, x, a) });
    this.estado.escuchar((c) => this.alCambiar(c.espacio, c.origen === 'usuario' || c.origen === 'historial'));
    this.conectarBarra();
    this.conectarPuntero();
    this.conectarTeclado();
    this.conectarSoltar();
    if (this.abierto) {
      this.sinc.establecer(espacio);
      this.mostrarAbierto();
    } else if (recuperado) {
      this.sinc.cambioLocal(espacio);
      this.ponerEstado('Borrador recuperado de la última sesión: no está en ningún archivo · Guardar como…', 'pendiente');
    } else this.sinc.establecer(espacio);
    this.alCambiar(true, false);
    this.ponerVista('plano');
    if (!this.abierto) void this.ofrecerContinuar();
    window.setInterval(() => void this.sinc.sondear(), SONDEO);
    this.exponerParaPruebas();
  }

  private get esp(): Espacio {
    return this.estado.espacio;
  }

  /** Estancia que se edita: la elegida si sigue existiendo; si no, la primera de la planta. */
  private get estSel(): string {
    const pl = plantaDe(this.esp);
    const id = this.edicion.estancia;
    return id !== null && pl.estancias.some((s) => s.id === id) ? id : (pl.estancias[0]?.id ?? '');
  }

  /** Subiendo o bajando una escalera: la planta activa cambia sin salir del recorrido ni mover la cámara. */
  private pasarDePlantaRecorriendo(id: string): void {
    this.cinta?.salir();
    this.calco?.cancelar();
    ponerPlantaActiva(id);
    this.edicion = { ...this.edicion, estancia: null, vertice: null, hueco: null, editando: false };
    this.seleccionar(null);
    this.alCambiar(false, false);
  }

  /** Pasa a ver y editar otra planta: se suelta lo que estaba a medias (selección, cinta, calco, recorrido). */
  private elegirPlanta(id: string): void {
    if (id === plantaActivaId(this.esp) || !this.esp.plantas.some((p) => p.id === id)) {
      this.alCambiar(false, false);
      return;
    }
    this.recorrido?.salir();
    this.cinta?.salir();
    this.calco?.cancelar();
    ponerPlantaActiva(id);
    this.edicion = { ...this.edicion, estancia: null, vertice: null, hueco: null, editando: false };
    this.seleccionar(null);
    this.escena.reencuadrar();
    this.alCambiar(false, false);
  }

  /**
   * «Mover pared…»: una pared de la estancia elegida, hacia fuera o hacia dentro. Si da a otra
   * estancia (un tabique), se mueve también la pared de la vecina y el tabique conserva su grosor.
   */
  private async moverPared(): Promise<void> {
    const est = estanciaDe(this.esp, this.estSel).estancia;
    const sel = document.createElement('select');
    sel.id = 'mp-pared';
    est.contorno.forEach((_, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `Pared ${i + 1} (${formatoCm(longitudMuro(est.contorno, i))} cm)`;
      sel.append(o);
    });
    const d = document.createElement('input');
    d.type = 'number';
    d.id = 'mp-distancia';
    d.step = '1';
    d.value = '10';
    d.inputMode = 'decimal';
    const fila = (texto: string, el: HTMLElement, unidad?: string): HTMLElement => {
      const l = document.createElement('label');
      l.className = 'campo';
      const s = document.createElement('span');
      s.textContent = texto;
      const e = document.createElement('span');
      e.className = 'entrada';
      e.append(el);
      if (unidad) {
        const i = document.createElement('i');
        i.textContent = unidad;
        e.append(i);
      }
      l.append(s, e);
      return l;
    };
    const ayuda = document.createElement('p');
    ayuda.className = 'ayuda';
    ayuda.textContent = 'Positivo hacia fuera (la estancia crece) y negativo hacia dentro. Si la pared da a otra estancia, el tabique se mueve entero: una crece lo que la otra encoge. Las paredes se numeran como en el plano.';
    const ok = await this.dialogo(`Mover una pared de «${est.nombre}»`, [fila('Pared', sel), fila('Distancia', d, 'cm'), ayuda], 'Mover pared', true);
    if (!ok) return;
    const distancia = Number(d.value.replace(',', '.'));
    if (!Number.isFinite(distancia) || distancia === 0) return this.aviso('Indica cuántos cm se mueve la pared.');
    try {
      const r = moverTabique(this.esp, est.id, Number(sel.value), distancia);
      this.estado.aplicar(r.espacio);
      const vecinas = r.vecinas.map((x) => `«${estanciaDe(this.esp, x.estancia).estancia.nombre}»`);
      const otras = vecinas.length > 1 ? `${vecinas.slice(0, -1).join(', ')} y ${vecinas[vecinas.length - 1]}` : vecinas[0];
      this.aviso(
        otras
          ? `Movido el tabique entre «${est.nombre}» y ${otras} ${formatoCm(Math.abs(distancia))} cm: ${distancia > 0 ? `«${est.nombre}» crece y ${otras} ${vecinas.length > 1 ? 'encogen' : 'encoge'}` : `${otras} ${vecinas.length > 1 ? 'crecen' : 'crece'} y «${est.nombre}» encoge`}.`
          : `Movida la pared ${Number(sel.value) + 1} de «${est.nombre}» ${formatoCm(Math.abs(distancia))} cm hacia ${distancia > 0 ? 'fuera' : 'dentro'}.`,
      );
    } catch (e) {
      this.aviso(mensajeDe(e));
    }
  }

  private seleccionarEstancia(id: string): void {
    if (id === this.estSel) return;
    this.edicion = { ...this.edicion, estancia: id, vertice: null, hueco: null };
    this.alCambiar(false, false);
  }

  /** Añade una estancia de 300 × 300 cm a la derecha de las demás, separada por un tabique del grosor de los muros. */
  private agregarEstanciaNueva(): void {
    this.intentar('e-error', () => {
      const pl = plantaDe(this.esp);
      const caja = cajaContorno(pl.estancias.flatMap((s) => s.contorno));
      const x = caja.maxX + Math.max(pl.grosorExterior, 1);
      const y = caja.minY;
      // Primer «Estancia N» libre (tras quitar una, no se repite un nombre que ya existe).
      let n = pl.estancias.length + 1;
      while (pl.estancias.some((s) => s.nombre === `Estancia ${n}`)) n++;
      const r = agregarEstancia(this.esp, { nombre: `Estancia ${n}`, contorno: [[x, y], [x + 300, y], [x + 300, y + 300], [x, y + 300]] }, plantaActivaId(this.esp));
      this.edicion = { ...this.edicion, estancia: r.id, vertice: null, hueco: null };
      this.estado.aplicar(r.espacio);
      this.escena.reencuadrar();
    });
  }

  private async quitarEstanciaSel(): Promise<void> {
    const s = estanciaDe(this.esp, this.estSel).estancia;
    const ok = await this.confirmar(
      `¿Quitar «${s.nombre}»?`,
      `Se quitan sus paredes${s.huecos.length ? ', puertas y ventanas' : ''}. Los muebles que tenga se quedan donde están, fuera de cualquier estancia, para que los muevas.`,
      'Quitar estancia',
    );
    if (!ok) return;
    this.intentar('e-error', () => {
      this.estado.aplicar(quitarEstancia(this.esp, s.id).espacio);
      this.edicion = { ...this.edicion, estancia: null, vertice: null, hueco: null };
      this.escena.reencuadrar();
    });
  }

  private espacioInicial(): { espacio: Espacio; recuperado: boolean } {
    // La casa que trae la página gana al borrador (revisión independiente del plan R5, B3).
    if (this.abierto) {
      try {
        const r = validar(JSON.parse(this.abierto.texto));
        if (r.ok) {
          this.abiertoV1 = r.migradoDesde === 1;
          return { espacio: r.espacio, recuperado: false };
        }
      } catch {
        /* no debería pasar: el CLI la validó al meterla */
      }
      this.abierto = null;
    }
    const borrador = this.sinBorrador ? null : leerUltimoBorrador();
    if (borrador) {
      try {
        const r = validar(JSON.parse(borrador));
        if (r.ok) return { espacio: r.espacio, recuperado: true };
      } catch {
        /* borrador ilegible: se empieza de cero */
      }
    }
    return { espacio: espacioPorDefecto(), recuperado: false };
  }

  // ---------- Ciclo de cambios ----------

  private alCambiar(cambioEspacio: boolean, porPersona: boolean): void {
    if (cambioEspacio) this.incidencias = analizar(this.esp);
    ponerPlantaActiva(plantaActivaId(this.esp));
    const vivos = new Set(plantaDe(this.esp).muebles.map((m) => m.id));
    for (const id of [...this.grupo]) if (!vivos.has(id) || id === this.estado.seleccion) this.grupo.delete(id);
    if (!this.estado.seleccion) this.grupo.clear();
    this.escena.grupo = this.grupo;
    this.paneles.grupo = this.grupo;
    const n = this.grupo.size + 1;
    $('m-grupo').hidden = this.grupo.size === 0;
    $('m-grupo').textContent = this.grupo.size ? `${n} muebles elegidos (Ctrl+clic añade o quita). Arrastrar, R, las flechas, Ctrl+D y Supr actúan sobre todos; la ficha es la del primero.` : '';
    // Una sola selección a la vez: elegir un mueble suelta la esquina o el hueco.
    if (this.estado.seleccion && (this.edicion.hueco || this.edicion.vertice !== null)) this.edicion = { ...this.edicion, hueco: null, vertice: null };
    // La selección de esquina o hueco puede haber dejado de existir (deshacer, archivo externo…).
    // La estancia elegida puede haber desaparecido: se vuelve a la primera.
    if (this.edicion.estancia !== null && this.edicion.estancia !== this.estSel) this.edicion = { ...this.edicion, estancia: null, vertice: null };
    if (this.edicion.vertice !== null && this.edicion.vertice >= estanciaDe(this.esp, this.estSel).estancia.contorno.length) this.edicion.vertice = null;
    if (this.edicion.hueco && !estanciaDe(this.esp, this.estSel).estancia.huecos.some((h) => h.id === this.edicion.hueco)) this.edicion.hueco = null;
    this.escena.ponerEdicion(this.edicion);
    this.escena.sincronizar(this.esp, this.estado.seleccion, this.conError());
    const activa = plantaActivaId(this.esp);
    const aqui = this.incidencias.filter((i) => !i.planta || i.planta === activa);
    const fuera = this.incidencias.length - aqui.length;
    $('incidencias-otras').hidden = fuera === 0;
    $('incidencias-otras').textContent = fuera ? `Y ${fuera} en otras plantas: elige la planta para verlas.` : '';
    this.paneles.pintar(this.esp, this.estado.seleccion, aqui, this.edicion.hueco, this.edicion.editando, this.estSel);
    if (!this.arrastre) this.mostrarCotasSeleccion();
    this.calco?.pintar();
    this.obra?.pintar();
    this.recorrido?.actualizar();
    this.modelos?.pintar();
    this.fotos?.pintar();
    this.plantas?.pintar();
    // «Casa entera» sólo tiene sentido con más de una planta.
    $('b-casa').hidden = this.esp.plantas.length < 2;
    ($('b-deshacer') as HTMLButtonElement).disabled = !this.estado.puedeDeshacer();
    ($('b-rehacer') as HTMLButtonElement).disabled = !this.estado.puedeRehacer();
    document.title = `${this.esp.nombre} · Espacios 3D`;
    if (cambioEspacio && porPersona) {
      this.sinc.cambioLocal(this.esp);
      if (!this.sinBorrador) guardarBorrador(this.esp.nombre, aJSON(this.esp));
    }
  }

  private conError(): Set<string> {
    return new Set(this.incidencias.filter((i) => i.gravedad === 'error').flatMap((i) => i.muebles));
  }

  private seleccionarHueco(id: string | null): void {
    const estancia = id ? estanciaDeHueco(this.esp, id) : this.edicion.estancia;
    this.edicion = { ...this.edicion, hueco: id, vertice: null, estancia };
    if (id) this.seleccionar(null);
    this.alCambiar(false, false);
  }

  /** Plano acotado para imprimir o guardar en PDF (R4-4): una ventana con el HTML y el diálogo de imprimir. */
  private imprimir(): void {
    // La ventana se abre en el mismo gesto, antes de calcular (si tardara, el navegador la bloquearía).
    const w = window.open('', '_blank');
    if (!w) return this.aviso('El navegador no ha dejado abrir la ventana del plano: permite las ventanas emergentes de esta página y vuelve a pulsar «Imprimir o PDF».');
    let html: string;
    try {
      html = planoImprimible(this.esp).html;
    } catch (e) {
      w.close?.();
      return this.aviso(`No se pudo preparar el plano: ${mensajeDe(e)}`);
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  private async exportar(formato: 'svg' | 'png' | 'glb'): Promise<void> {
    const base = nombreArchivo(this.esp.nombre).replace(/\.espacio\.json$/, '');
    try {
      let blob: Blob | null;
      if (formato === 'svg') blob = new Blob([planoSVG(this.esp, { planta: plantaActivaId(this.esp) })], { type: 'image/svg+xml' });
      else if (formato === 'png') blob = await this.escena.capturaPNG();
      else blob = new Blob([await this.escena.exportarGLB(this.esp)], { type: 'model/gltf-binary' });
      if (!blob) throw new Error('el navegador no ha generado la imagen');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}.${formato}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      (window as unknown as { __ultimaExportacion?: { formato: string; bytes: number } }).__ultimaExportacion = { formato, bytes: blob.size };
    } catch (e) {
      this.aviso(`No se pudo exportar: ${mensajeDe(e)}`);
    }
  }

  /** Aplica las paredes de la tabla; si no cierran, pide confirmación. */
  private async aplicarParedes(tramos: Parameters<typeof contornoDesdeTramos>[0]): Promise<void> {
    try {
      // Anclada al primer vértice y al primer muro actuales: la estancia no se desplaza bajo los muebles.
      const r = contornoDesdeTramos(tramos, anclajeDe(estanciaDe(this.esp, this.estSel).estancia.contorno));
      if (r.descuadre > 0.5) {
        const antes = this.esp;
        const ok = await this.confirmar(
          'Las paredes no cierran',
          `Con estas medidas sobran o faltan ${r.descuadre} cm. La última pared medirá ${r.ultimaReal} cm en lugar de ${tramos[tramos.length - 1]?.longitud} cm.`,
          'Aplicar igualmente',
        );
        if (!ok) return;
        // Si mientras se decidía llegó otra estancia (un agente), no se pisa con medidas viejas.
        if (this.esp !== antes && JSON.stringify(estanciaDe(this.esp, this.estSel).estancia.contorno) !== JSON.stringify(estanciaDe(antes, this.estSel).estancia.contorno)) {
          this.aviso('La estancia cambió mientras decidías: revisa la tabla y vuelve a aplicar.');
          return;
        }
      }
      this.estado.aplicar(cambiarContorno(this.esp, contornoDesdeTramos(tramos, anclajeDe(estanciaDe(this.esp, this.estSel).estancia.contorno)).contorno, this.estSel));
      this.paneles.mostrarError('e-error', null);
      this.paneles.tablaAplicada();
      this.escena.reencuadrar();
    } catch (e) {
      this.paneles.mostrarError('e-error', mensajeDe(e));
    }
  }

  private mostrarCotasSeleccion(): void {
    const id = this.estado.seleccion;
    this.escena.mostrarAyudas(id ? cotas(this.esp, id) : [], []);
  }

  private intentar(campoError: 'e-error' | 'm-error' | 'h-error', f: () => void): void {
    try {
      f();
      this.paneles.mostrarError(campoError, null);
    } catch (e) {
      this.paneles.mostrarError(campoError, mensajeDe(e));
      this.paneles.pintarFicha();
    }
  }

  private aviso(texto: string): void {
    const el = $('aviso');
    el.textContent = texto;
    el.hidden = false;
    window.clearTimeout(this.temporizadorAviso);
    this.temporizadorAviso = window.setTimeout(() => (el.hidden = true), 6000);
  }

  private ponerEstado(texto: string, clase: '' | 'pendiente' | 'fallo' = ''): void {
    const el = $('estado-guardado');
    el.textContent = texto;
    el.className = clase;
  }

  private mostrarBloqueo(errores: string[] | null): void {
    $('bloqueo').hidden = !errores;
    $('bloqueo-errores').replaceChildren(
      ...(errores ?? []).slice(0, 5).map((e) => {
        const li = document.createElement('li');
        li.textContent = e;
        return li;
      }),
    );
  }

  // ---------- Acciones sobre muebles ----------

  private agregar(datos: DatosMueble): void {
    try {
      // En la estancia elegida (también los de «Mis muebles»: revisión independiente, 12).
      const est = datos.estancia ?? this.estSel ?? undefined;
      const r = agregarMueble(this.esp, { ...datos, ...(est ? { estancia: est } : {}) }, plantaActivaId(this.esp));
      this.estado.aplicar(r.espacio);
      this.seleccionar(r.id);
      for (const p of document.querySelectorAll('.panel.abierto')) p.classList.remove('abierto');
    } catch (e) {
      this.aviso(mensajeDe(e));
    }
  }

  /**
   * Deshacer o rehacer. Si lo que cambia es de otra planta (y no de la que se ve), se pasa a esa
   * planta y se dice: si no, el cambio ocurriría sin verse.
   */
  private historial(que: 'deshacer' | 'rehacer'): void {
    const antes = this.esp;
    const activa = plantaActivaId(antes);
    if (que === 'deshacer') this.estado.deshacer();
    else this.estado.rehacer();
    const despues = this.esp;
    if (despues === antes) return;
    const firma = (e: Espacio, id: string): string => JSON.stringify(e.plantas.find((p) => p.id === id) ?? null);
    const ids = [...new Set([...antes.plantas, ...despues.plantas].map((p) => p.id))];
    const cambiadas = ids.filter((id) => firma(antes, id) !== firma(despues, id) && despues.plantas.some((p) => p.id === id));
    if (cambiadas.length && !cambiadas.includes(activa)) {
      const id = cambiadas[0]!;
      this.elegirPlanta(id);
      this.aviso(`${que === 'deshacer' ? 'Deshecho' : 'Rehecho'} un cambio en «${despues.plantas.find((p) => p.id === id)!.nombre}».`);
    }
  }

  /** Elige un solo mueble (o ninguno): suelta el grupo. */
  private seleccionar(id: string | null): void {
    const habia = this.grupo.size > 0;
    this.grupo.clear();
    this.estado.seleccionar(id);
    // Si el elegido no cambia, Estado no avisa: hay que repintar para que el grupo deje de verse.
    if (habia) this.alCambiar(false, false);
  }

  /** Ctrl+clic: añade o quita un mueble de la selección. */
  private alternar(id: string): void {
    const principal = this.estado.seleccion;
    if (!principal) return this.seleccionar(id);
    if (id === principal) {
      // Se quita el principal: el siguiente del grupo pasa a serlo.
      const [siguiente, ...resto] = [...this.grupo];
      this.grupo = new Set(resto);
      this.estado.seleccionar(siguiente ?? null);
    } else if (this.grupo.has(id)) this.grupo.delete(id);
    else this.grupo.add(id);
    this.alCambiar(false, false);
  }

  /** Muebles elegidos: el principal y el grupo. */
  private elegidos(): string[] {
    return this.estado.seleccion ? [this.estado.seleccion, ...this.grupo] : [];
  }

  private conSeleccion(f: (m: Mueble) => void): void {
    const m = plantaDe(this.esp).muebles.find((x) => x.id === this.estado.seleccion);
    if (!m) return;
    try {
      f(m);
    } catch (e) {
      this.aviso(mensajeDe(e));
    }
  }

  private girar(grados: number): void {
    if (this.grupo.size) return this.conGrupo((ids) => this.estado.aplicar(girarGrupo(this.esp, ids, grados)));
    this.conSeleccion((m) => this.estado.aplicar(girarMueble(this.esp, m.id, m.giro + grados)));
  }

  private conGrupo(f: (ids: string[]) => void): void {
    try {
      f(this.elegidos());
    } catch (e) {
      this.aviso(mensajeDe(e));
    }
  }

  private duplicar(): void {
    if (this.grupo.size) {
      return this.conGrupo((ids) => {
        const r = duplicarGrupo(this.esp, ids);
        this.estado.aplicar(r.espacio);
        const [primero, ...resto] = r.ids;
        this.seleccionar(primero!);
        this.grupo = new Set(resto);
        this.alCambiar(false, false);
      });
    }
    this.conSeleccion((m) => {
      const r = duplicarMueble(this.esp, m.id);
      this.estado.aplicar(r.espacio);
      this.seleccionar(r.id);
    });
  }

  private quitar(): void {
    if (this.grupo.size) return this.conGrupo((ids) => this.estado.aplicar(quitarGrupo(this.esp, ids)));
    this.conSeleccion((m) => this.estado.aplicar(quitarMueble(this.esp, m.id)));
  }

  private empujar(adelante: number, derecha: number, paso: number, repetida: boolean): void {
    this.conSeleccion((m) => {
      const r = this.escena.rumboCamara();
      const f: Punto = [Math.cos(r), Math.sin(r)];
      const d: Punto = [-f[1], f[0]];
      let vx = f[0] * adelante + d[0] * derecha;
      let vy = f[1] * adelante + d[1] * derecha;
      // Se cuantiza al eje de planta más cercano: las flechas mueven siempre en x o en y.
      if (Math.abs(vx) >= Math.abs(vy)) [vx, vy] = [Math.sign(vx), 0];
      else [vx, vy] = [0, Math.sign(vy)];
      // Una flecha mantenida es una sola entrada del historial.
      if (!repetida) this.estado.cortarFusion();
      if (this.grupo.size) this.estado.aplicar(moverGrupo(this.esp, this.elegidos(), vx * paso, vy * paso), `empujar:${this.elegidos().join('+')}`);
      else this.estado.aplicar(moverMueble(this.esp, m.id, m.x + vx * paso, m.y + vy * paso), `empujar:${m.id}`);
    });
  }

  // ---------- Barra superior ----------

  private conectarBarra(): void {
    $('b-deshacer').innerHTML = ICONOS.deshacer;
    $('b-rehacer').innerHTML = ICONOS.rehacer;
    $('b-encuadrar').innerHTML = ICONOS.encuadrar;
    $('b-ayuda').innerHTML = ICONOS.ayuda;
    $('b-deshacer').addEventListener('click', () => this.historial('deshacer'));
    $('b-rehacer').addEventListener('click', () => this.historial('rehacer'));
    $('b-encuadrar').addEventListener('click', () => this.escena.encuadrar());
    $('b-mover-pared').addEventListener('click', () => void this.moverPared());
    $('b-ayuda').addEventListener('click', () => void this.ayuda());
    $('b-ayuda-rapida').addEventListener('click', () => void this.ayuda());
    $('v-plano').addEventListener('click', () => this.ponerVista('plano'));
    $('v-3d').addEventListener('click', () => this.ponerVista('3d'));
    $('b-casa').addEventListener('click', () => this.ponerCasaEntera(!this.escena.casaEntera));
    try {
      if (localStorage.getItem('espacios3d.casaEntera') === '1') this.escena.casaEntera = true;
    } catch {
      /* sin almacenamiento: empieza sin la casa entera */
    }
    $('b-casa').setAttribute('aria-pressed', String(this.escena.casaEntera));
    $('b-nuevo').addEventListener('click', () => void this.nuevo());
    $('b-abrir').addEventListener('click', () => void this.abrir());
    $('b-guardar').addEventListener('click', () => void this.guardar());
    $('b-abierto-carpeta').addEventListener('click', () => void this.abrirSuCarpeta());
    $('b-guardar-como').addEventListener('click', () => void this.guardarComo());
    $('b-continuar').addEventListener('click', () => void this.continuar());
    $('b-mi-version').addEventListener('click', () => void this.guardarMiVersion());
    $in('nombre-espacio').addEventListener('change', () => {
      const v = $in('nombre-espacio').value.trim();
      if (v) this.estado.aplicar(renombrarEspacio(this.esp, v));
      else $in('nombre-espacio').value = this.esp.nombre;
    });
    for (const [boton, panel] of [['b-panel-izq', 'panel-izq'], ['b-panel-der', 'panel-der']] as const) {
      $(boton).addEventListener('click', () => {
        const abierto = $(panel).classList.toggle('abierto');
        $(boton).setAttribute('aria-expanded', String(abierto));
      });
    }
    window.addEventListener('beforeunload', (ev) => {
      if (this.sinc.pendiente) ev.preventDefault();
    });
  }

  /** «Casa entera»: todas las plantas apiladas en 3D (si se pide desde el plano, pasa a 3D). */
  private ponerCasaEntera(si: boolean): void {
    this.escena.ponerCasaEntera(si);
    $('b-casa').setAttribute('aria-pressed', String(si));
    try {
      localStorage.setItem('espacios3d.casaEntera', si ? '1' : '0');
    } catch {
      /* sin almacenamiento: no se recuerda */
    }
    if (si && this.escena.vista !== '3d') this.ponerVista('3d');
    else this.escena.encuadrar();
  }

  private ponerVista(v: Vista): void {
    if (v === 'plano' && this.recorrido?.activo) return this.recorrido.salir('plano');
    // Las esquinas se editan en planta: al pasar a 3D se deja de editar.
    if (v === '3d' && this.edicion.editando) {
      this.edicion = { ...this.edicion, editando: false, vertice: null };
      this.alCambiar(false, false);
    }
    this.escena.ponerVista(v);
    $('v-plano').setAttribute('aria-checked', String(v === 'plano'));
    $('v-3d').setAttribute('aria-checked', String(v === '3d'));
  }

  // ---------- Archivo ----------

  private async ofrecerContinuar(): Promise<void> {
    const nombre = await this.sinc.almacen.recordado?.();
    const b = $('b-continuar');
    b.hidden = !nombre;
    if (nombre) b.textContent = `Continuar con ${nombre}`;
  }

  /**
   * Antes de sustituir lo que se ve por otro espacio: con archivo vinculado se guarda lo
   * pendiente; sin archivo (o con el archivo bloqueado por errores) se pide confirmación.
   */
  private async antesDeReemplazar(accion: string): Promise<boolean> {
    if (!this.sinc.pendiente) return true;
    if (this.sinc.almacen.vinculado() && !this.sinc.bloqueadoPor) {
      await this.sinc.guardarAhora();
      return true;
    }
    return this.confirmar('¿Descartar los cambios sin guardar?', 'Lo que has cambiado desde la última vez que guardaste no está en ningún archivo y se perderá.', accion);
  }

  /** Valida lo leído; sólo si es válido lo muestra y vincula el archivo para guardar. */
  /** Devuelve si lo abrió (no, si no es válido o la persona canceló la conversión de la v1). */
  private async usarLeido(leido: Leido | null | undefined): Promise<boolean> {
    if (!leido) return false;
    let datos: unknown;
    try {
      datos = JSON.parse(leido.texto);
    } catch (e) {
      await this.informar('No se pudo abrir el archivo', `«${leido.nombre}» no es un JSON válido: ${mensajeDe(e)}`);
      return false;
    }
    const r = validar(datos);
    if (!r.ok) {
      await this.informar('El archivo tiene errores', `«${leido.nombre}» no se ha abierto. Corrige esto:`, r.errores);
      return false;
    }
    if (r.migradoDesde === 1) {
      // La página no puede dejar una copia junto al archivo (el CLI sí lo hace): se avisa antes.
      const ok = await this.confirmar(
        '¿Abrir y convertir a la versión 2?',
        `«${leido.nombre}» es de la versión 1 de Espacios 3D. Al guardar el primer cambio se convertirá a la versión 2, que las versiones anteriores de la herramienta no abren. Si las necesitas, copia antes el archivo.`,
        'Abrir y convertir',
      );
      if (!ok) return false;
    }
    this.recorrido?.salir();
    this.cinta?.salir();
    ponerPlantaActiva(null);
    this.estado.reemplazar(r.espacio);
    this.escena.reencuadrar();
    await this.sinc.vincular(leido, r.espacio);
    if (!this.sinBorrador) borrarBorrador();
    this.salirDeAbierto();
    $('b-continuar').hidden = true;
    if (r.espacio.plantas.length > 1) this.aviso(`Este espacio tiene ${r.espacio.plantas.length} plantas: elígelas en «Planta», arriba a la izquierda.`);
    return true;
  }

  private async abrir(): Promise<void> {
    if (!(await this.antesDeReemplazar('Descartar y abrir'))) return;
    try {
      await this.usarLeido(await this.sinc.almacen.abrir());
    } catch (e) {
      this.ponerEstado(`No se pudo abrir: ${mensajeDe(e)}`, 'fallo');
    }
  }

  private async continuar(): Promise<void> {
    if (!(await this.antesDeReemplazar('Descartar y continuar'))) return;
    try {
      await this.usarLeido(await this.sinc.almacen.continuar?.());
    } catch (e) {
      this.ponerEstado(`No se pudo reabrir: ${mensajeDe(e)}`, 'fallo');
    }
  }

  private async nuevo(): Promise<void> {
    const vinculado = this.sinc.almacen.vinculado();
    const ok = await this.confirmar(
      '¿Empezar un espacio nuevo?',
      vinculado
        ? `«${this.sinc.almacen.nombreArchivo()}» se queda como está; el espacio nuevo se guardará en otro archivo.`
        : this.sinc.pendiente
          ? 'Lo que no has guardado en un archivo se perderá.'
          : 'Se empieza con una estancia vacía de 350 × 300 cm.',
      'Empezar espacio nuevo',
    );
    if (!ok) return;
    if (vinculado && this.sinc.pendiente && !this.sinc.bloqueadoPor) await this.sinc.guardarAhora();
    this.recorrido?.salir();
    this.cinta?.salir();
    ponerPlantaActiva(null);
    const e = espacioPorDefecto();
    await this.sinc.desvincular(crearAlmacen(), e);
    this.estado.reemplazar(e, 'inicio');
    this.escena.reencuadrar();
    if (!this.sinBorrador) borrarBorrador();
    this.salirDeAbierto();
    void this.ofrecerContinuar();
  }

  private async guardar(): Promise<void> {
    // Con la copia de un agente, guardar es volver a su archivo, con la reconciliación (R5-2, B2).
    if (this.abierto && this.sinc.almacen.abrirCarpeta) return this.abrirSuCarpeta();
    if (!this.sinc.almacen.vinculado()) return this.guardarComo();
    if (this.sinc.bloqueadoPor) {
      this.aviso('El archivo tiene errores hechos fuera: no se guarda encima. Usa «Guardar mi versión encima» si quieres sobrescribirlo.');
      return;
    }
    await this.sinc.guardarAhora();
  }

  private async guardarComo(): Promise<void> {
    if (
      this.abierto &&
      this.sinc.almacen.abrirCarpeta &&
      !(await this.confirmar(
        '¿Guardar una copia aparte?',
        `Se guarda el espacio en el archivo que elijas, sin sus planos de fondo, fotos ni modelos, y deja de estar unido a «${this.abierto.nombre}». Para seguir con ese archivo, cancela y pulsa «Abrir su carpeta».`,
        'Guardar copia aparte',
      ))
    )
      return;
    const ok = await this.sinc.guardarComo(this.sinc.almacen.nombreArchivo() ?? nombreArchivo(this.esp.nombre));
    if (ok) {
      $('b-continuar').hidden = true;
      this.salirDeAbierto();
    }
  }

  // ---------- Página abierta por un agente (ronda 5) ----------

  private mostrarAbierto(): void {
    const d = this.abierto;
    $('abierto').hidden = !d;
    if (!d) return;
    const hora = d.copiadaEn ? new Date(d.copiadaEn).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
    const sinCarpetas = !this.sinc.almacen.abrirCarpeta;
    $('abierto-texto').textContent = sinCarpetas
      ? `Abierta por un agente${hora ? ` a las ${hora}` : ''}: ${d.nombre}. Es una copia y este navegador no abre carpetas: «Guardar» descarga tus cambios en un archivo nuevo.`
      : `Abierta por un agente${hora ? ` a las ${hora}` : ''}: ${d.nombre} (${d.ruta}). Es una copia: lo que el agente cambie después no se ve aquí y tus cambios no se guardan hasta que abras su carpeta.${this.abiertoV1 ? ' Es de la versión 1: al guardar se convertirá a la versión 2.' : ''}`;
    $('abierto-omitidos').replaceChildren(
      ...d.omitidos.slice(0, 5).map((o) => {
        const li = document.createElement('li');
        li.textContent = `No se ve ${o.ruta}: ${o.motivo}`;
        return li;
      }),
    );
    $('b-abierto-carpeta').hidden = sinCarpetas;
    $('b-continuar').hidden = true;
  }

  private salirDeAbierto(): void {
    if (!this.abierto) return;
    this.abierto = null;
    this.mostrarAbierto();
  }

  /** «Abrir su carpeta» (también «Guardar» y Ctrl+S con la copia): busca el archivo y reconcilia. */
  private async abrirSuCarpeta(): Promise<void> {
    const d = this.abierto;
    const alm = this.sinc.almacen;
    if (!d || !alm.abrirCarpeta) return;
    const ruta = normalRuta(d.ruta);
    // La carpeta recordada evita el selector sólo si su nombre está en la ruta del archivo (se mira antes de
    // pedir permiso) y su archivo es idéntico a la copia; si no, se elige (revisión independiente, 4).
    if (!this.sinRecordada && alm.abrirCarpetaRecordada) {
      this.sinRecordada = true;
      try {
        const c = await alm.abrirCarpetaRecordada((n) => ruta.includes(`/${n.toLowerCase()}/`));
        const r = c ? rutaEnCarpetaElegida(d, c) : null;
        if (c && r) {
          const leido = await alm.abrirDeCarpeta!(r);
          if (leido && leido.texto === d.texto) {
            await this.reconciliar(c, r);
            return;
          }
        }
      } catch {
        /* sin permiso o inaccesible: se elige a mano */
      }
    }
    let c: { nombre: string; archivos: string[] } | null = null;
    try {
      c = await alm.abrirCarpeta();
    } catch (e) {
      // Si el permiso de la carpeta recordada consumió el gesto, el selector no se abre: otra pulsación.
      this.aviso(`No se pudo abrir el selector de carpetas (${mensajeDe(e)}): pulsa otra vez «Abrir su carpeta». Sigues con la copia, sin guardar.`);
      return;
    }
    if (!c) {
      this.aviso('No has elegido carpeta: sigues con la copia, sin guardar.');
      return;
    }
    const r = rutaEnCarpetaElegida(d, c);
    if (!r) {
      await this.informar('No está en esa carpeta', `«${d.nombre}» no está en «${c.nombre}» ni en sus subcarpetas. Elige la carpeta donde está: ${d.ruta}`);
      return;
    }
    await this.reconciliar(c, r);
  }

  /** Desde «Carpeta…»: el archivo de la copia se reconcilia; otro, como siempre, sin perder cambios. */
  private async usarDeCarpeta(c: { nombre: string; archivos: string[] }, ruta: string): Promise<void> {
    const alm = this.sinc.almacen;
    if (this.abierto && rutaEnCarpetaElegida(this.abierto, { nombre: c.nombre, archivos: [ruta] })) {
      await this.reconciliar(c, ruta);
      return;
    }
    // Antes «Carpeta…» abría sin preguntar y se perdían los cambios sin guardar (revisión independiente, B2).
    if (!(await this.antesDeReemplazar('Descartar y abrir'))) return;
    try {
      await this.usarLeido(await alm.abrirDeCarpeta!(ruta));
    } catch (e) {
      this.ponerEstado(`No se pudo abrir: ${mensajeDe(e)}`, 'fallo');
    }
  }

  /** Lee un archivo de la carpeta elegida sin romper la copia si falla (revisión independiente, 7). */
  private async leerDeCarpeta(ruta: string): Promise<Leido | null> {
    try {
      return (await this.sinc.almacen.abrirDeCarpeta?.(ruta)) ?? null;
    } catch (e) {
      this.aviso(`No se pudo leer ${ruta}: ${mensajeDe(e)}. Sigues con la copia, sin guardar.`);
      return null;
    }
  }

  /**
   * Une la copia con su archivo del disco (tabla de docs/PLAN_R5.md, R5-2): igual, se vincula (y se
   * guarda lo cambiado); distinto, sin cambios aquí, gana el disco; distinto con cambios, decide la
   * persona; con errores, no se vincula. El archivo se vuelve a leer tras cada diálogo: si cambió
   * mientras tanto (un agente), se reconcilia otra vez con lo nuevo (revisión independiente, 1).
   */
  private async reconciliar(c: { nombre: string; archivos: string[] }, ruta: string, vueltas = 0): Promise<void> {
    const d = this.abierto;
    if (!d) return;
    const leido = await this.leerDeCarpeta(ruta);
    if (!leido) return;
    let r: ReturnType<typeof validar>;
    try {
      r = validar(JSON.parse(leido.texto));
    } catch (e) {
      await this.informar('No se ha unido al archivo', `«${leido.nombre}» no es un JSON válido: ${mensajeDe(e)}. Sigues con la copia, sin guardar.`);
      return;
    }
    if (!r.ok) {
      await this.informar('No se ha unido al archivo', `«${leido.nombre}» tiene errores; sigues con la copia, sin guardar. Errores del archivo:`, r.errores);
      return;
    }
    const cambios = this.sinc.pendiente;
    if (leido.texto === d.texto) {
      // Una v1 que se va a guardar convertida pide la misma confirmación que al abrirla (revisión independiente, 3).
      if (cambios && r.migradoDesde === 1) {
        const ok = await this.confirmar(
          '¿Guardar convertido a la versión 2?',
          `«${leido.nombre}» es de la versión 1 de Espacios 3D. Al guardar tus cambios se convertirá a la versión 2, que las versiones anteriores de la herramienta no abren. Si las necesitas, copia antes el archivo.`,
          'Guardar y convertir',
        );
        if (!ok) {
          this.aviso('Sigues con la copia, sin guardar.');
          return;
        }
        if (vueltas < 3 && (await this.leerDeCarpeta(ruta))?.texto !== leido.texto) return this.reconciliar(c, ruta, vueltas + 1);
      }
      await this.sinc.vincularConservando(leido);
      this.salirDeAbierto();
      this.aviso(cambios ? `Unido a ${leido.nombre}: tus cambios se están guardando.` : `Unido a ${leido.nombre}: desde ahora se guarda solo.`);
      return;
    }
    if (!cambios) {
      if (await this.usarLeido(leido)) this.aviso(`${leido.nombre} cambió después de abrir esta página: se muestra la versión del disco.`);
      return;
    }
    // «Otro archivo» va junto al original, en su misma subcarpeta, para que sigan sus planos, fotos y
    // modelos (revisión independiente, 2).
    const subcarpeta = ruta.includes('/') ? ruta.slice(0, ruta.lastIndexOf('/') + 1) : '';
    const hermanos = c.archivos.filter((x) => x.startsWith(subcarpeta) && !x.slice(subcarpeta.length).includes('/')).map((x) => x.slice(subcarpeta.length));
    const nuevo = subcarpeta + nombreLibre(d.nombre, hermanos);
    const lista = document.createElement('div');
    lista.className = 'opciones';
    const opciones: [string, string][] = [
      ['otro', `Guardar lo mío en otro archivo, «${nuevo}», junto al original (el del disco no se toca)`],
      ['disco', 'Quedarme con el del disco y descartar mis cambios'],
      ['encima', `Guardar lo mío encima de ${leido.nombre}: se pierde lo que cambió en el disco`],
    ];
    opciones.forEach(([v, t], i) => {
      const l = document.createElement('label');
      l.className = 'casilla';
      const inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = 'conflicto-abierto';
      inp.value = v;
      inp.checked = i === 0;
      const s = document.createElement('span');
      s.textContent = t;
      l.append(inp, s);
      lista.append(l);
    });
    const p = document.createElement('p');
    p.textContent = `${leido.nombre} cambió en el disco después de abrir esta página (quizá lo cambió el agente), y tú también has cambiado cosas aquí.`;
    const ok = await this.dialogo('El archivo y tu copia son distintos', [p, lista], 'Continuar', true);
    const eleccion = ok ? ((lista.querySelector('input:checked') as HTMLInputElement | null)?.value ?? null) : null;
    if (eleccion === null) {
      this.aviso('Sigues con la copia, sin guardar.');
      return;
    }
    // Lo que se decidió fue sobre la versión mostrada en el diálogo: si el archivo cambió entretanto, se
    // vuelve a reconciliar con la nueva (como mucho tres veces).
    if (eleccion !== 'otro' && vueltas < 3) {
      const ahora = await this.leerDeCarpeta(ruta);
      if (!ahora) return;
      if (ahora.texto !== leido.texto) return this.reconciliar(c, ruta, vueltas + 1);
    }
    if (eleccion === 'disco') {
      await this.usarLeido(leido);
    } else if (eleccion === 'encima') {
      await this.sinc.vincularConservando(leido);
      this.salirDeAbierto();
    } else {
      let creado: Leido | null = null;
      try {
        creado = (await this.sinc.almacen.crearEnCarpeta?.(nuevo, aJSON(this.esp))) ?? null;
      } catch (e) {
        this.aviso(`No se pudo crear ${nuevo}: ${mensajeDe(e)}. Sigues con la copia, sin guardar.`);
        return;
      }
      if (!creado) {
        this.aviso('No se pudo crear el archivo: sigues con la copia, sin guardar.');
        return;
      }
      if (await this.usarLeido(creado)) this.aviso(`Tus cambios están en ${nuevo}, junto a ${leido.nombre}, que no se ha tocado.`);
    }
  }

  private async guardarMiVersion(): Promise<void> {
    const ok = await this.confirmar(
      '¿Guardar tu versión encima?',
      `Se sobrescribe «${this.sinc.almacen.nombreArchivo()}» con lo que ves y se pierde la versión con errores que hay ahora en el archivo.`,
      'Guardar mi versión encima',
    );
    if (ok) await this.sinc.guardarAhora(true);
  }

  private conectarSoltar(): void {
    const app = $('app');
    app.addEventListener('dragover', (ev) => {
      if (ev.dataTransfer?.types.includes('Files')) ev.preventDefault();
    });
    app.addEventListener('drop', (ev) => {
      const item = ev.dataTransfer?.items[0];
      if (!item || item.kind !== 'file') return;
      ev.preventDefault();
      // Ambas llamadas deben hacerse durante el evento.
      const archivo = item.getAsFile();
      const conManejador = this.sinc.almacen.vincularSoltado?.(item);
      void (async () => {
        try {
          const leido = conManejador ? await conManejador : null;
          if (!(await this.antesDeReemplazar('Descartar y abrir'))) return;
          if (leido) await this.usarLeido(leido);
          else if (archivo) {
            const texto = await archivo.text();
            // Sin manejador no se puede escribir en ese archivo: se desvincula el anterior para no sobrescribirlo.
            await this.usarLeido({ texto, nombre: archivo.name, aceptar: async () => void (this.sinc.almacen = crearAlmacen()) });
          }
        } catch (e) {
          this.ponerEstado(`No se pudo abrir: ${mensajeDe(e)}`, 'fallo');
        }
      })();
    });
  }

  // ---------- Diálogos ----------

  private dialogo(titulo: string, cuerpo: Node[], aceptar: string, conCancelar: boolean): Promise<boolean> {
    const d = $('dialogo') as HTMLDialogElement;
    $('dialogo-titulo').textContent = titulo;
    $('dialogo-cuerpo').replaceChildren(...cuerpo);
    $('dialogo-aceptar').textContent = aceptar;
    $('dialogo-cancelar').hidden = !conCancelar;
    d.returnValue = '';
    const previo = document.activeElement as HTMLElement | null;
    d.showModal();
    ($(conCancelar ? 'dialogo-cancelar' : 'dialogo-aceptar') as HTMLButtonElement).focus();
    return new Promise((res) =>
      d.addEventListener(
        'close',
        () => {
          previo?.focus();
          res(d.returnValue === 'aceptar');
        },
        { once: true },
      ),
    );
  }

  private confirmar(titulo: string, texto: string, aceptar: string): Promise<boolean> {
    const p = document.createElement('p');
    p.textContent = texto;
    return this.dialogo(titulo, [p], aceptar, true);
  }

  private informar(titulo: string, texto: string, lista: string[] = []): Promise<boolean> {
    const p = document.createElement('p');
    p.textContent = texto;
    const nodos: Node[] = [p];
    if (lista.length) {
      const ul = document.createElement('ul');
      for (const l of lista.slice(0, 12)) {
        const li = document.createElement('li');
        li.textContent = l;
        ul.append(li);
      }
      nodos.push(ul);
    }
    return this.dialogo(titulo, nodos, 'Entendido', false);
  }

  private ayuda(): Promise<boolean> {
    const filas: Array<[string, string]> = [
      ['Arrastrar', 'Mover el mueble (encaja en muros y vecinos)'],
      ['Ctrl + clic', 'Elegir varios muebles (en la vista o en la lista); arrastrar, R, flechas, Ctrl+D y Supr actúan sobre todos'],
      ['Mayús + arrastrar', 'Mover sin imán y sin límite'],
      ['R / Mayús+R', 'Girar 15° / 90° (también mientras arrastras)'],
      ['Esc', 'Cancelar el arrastre o quitar la selección'],
      ['Flechas', 'Empujar 1 cm (con Mayús, 10 cm)'],
      ['Supr', 'Quitar el mueble'],
      ['Ctrl+D', 'Duplicar'],
      ['Ctrl+Z / Ctrl+Y', 'Deshacer / rehacer'],
      ['Ctrl+S', 'Guardar'],
      ['V', 'Cambiar entre plano y 3D'],
      ['P', 'Recorrer por dentro en primera persona (W A S D anda; flechas o ratón para mirar, también arriba y abajo; Esc sale)'],
      ['M', 'Medir entre dos puntos (se pegan a esquinas y paredes; Mayús los deja libres)'],
      ['F', 'Encuadrar la estancia'],
      ['Intro', 'Confirmar una medida y volver a la vista'],
    ];
    const t = document.createElement('div');
    t.className = 'tabla-atajos';
    for (const [k, v] of filas) {
      const kb = document.createElement('span');
      kb.innerHTML = k
        .split(' / ')
        .map((x) => `<kbd>${x}</kbd>`)
        .join(' / ');
      const d = document.createElement('span');
      d.textContent = v;
      t.append(kb, d);
    }
    const p = document.createElement('p');
    p.className = 'ayuda';
    p.textContent = `En 3D: arrastra el fondo para girar la cámara, rueda para acercar, botón derecho para desplazar. Espacios 3D ${__VERSION__}.`;
    const atajos = document.createElement('h3');
    atajos.textContent = 'Atajos de teclado';
    return this.dialogo('Ayuda rápida', [ayudaRapida(), atajos, t, p], 'Cerrar', false);
  }

  // ---------- Puntero ----------

  private cmPorPixel(): number {
    const r = $('lienzo').getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const a = this.escena.puntoEnPlano({ clientX: cx, clientY: cy });
    const b = this.escena.puntoEnPlano({ clientX: cx + 10, clientY: cy });
    if (!a || !b) return 1;
    return Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10, 5);
  }

  private empezarArrastreEstancia(ev: PointerEvent, tipo: 'vertice' | 'hueco', k: number, id: string): void {
    const canvas = this.escena.renderer.domElement;
    ev.stopImmediatePropagation();
    this.pulsacionVacia = null;
    let agarre = 0;
    // Un hueco de otra estancia la elige: así se puede pulsar y arrastrar cualquier puerta del plano.
    if (tipo === 'hueco') this.edicion = { ...this.edicion, estancia: estanciaDeHueco(this.esp, id), vertice: null };
    if (tipo === 'hueco') {
      const h = estanciaDe(this.esp, this.estSel).estancia.huecos.find((x) => x.id === id);
      const p = this.escena.puntoEnPlano(ev, 0);
      if (h && p) {
        const [a, b] = muro(estanciaDe(this.esp, this.estSel).estancia.contorno, h.muro);
        const largo = longitudMuro(estanciaDe(this.esp, this.estSel).estancia.contorno, h.muro);
        agarre = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / largo - h.desde;
      }
      this.seleccionar(null);
      this.edicion = { ...this.edicion, hueco: id, vertice: null };
    } else this.edicion = { ...this.edicion, vertice: k, hueco: null };
    this.escena.controles.enabled = false;
    this.escena.congelarEncuadre(true);
    canvas.setPointerCapture(ev.pointerId);
    this.arrastreEstancia = { tipo, k, id, puntero: ev.pointerId, inicio: [ev.clientX, ev.clientY], previa: null, agarre, destino: null, esquinas: estanciaDe(this.esp, this.estSel).estancia.contorno.length };
    this.alCambiar(false, false);
  }

  /** Termina el arrastre de esquina o hueco: con `confirmar` aplica la vista previa; si no, la descarta. */
  private terminarArrastreEstancia(confirmar: boolean): void {
    const ae = this.arrastreEstancia;
    if (!ae) return;
    this.arrastreEstancia = null;
    this.escena.congelarEncuadre(false);
    this.escena.controles.enabled = true;
    const canvas = this.escena.renderer.domElement;
    if (canvas.hasPointerCapture(ae.puntero)) canvas.releasePointerCapture(ae.puntero);
    if (!confirmar || !ae.destino) {
      this.alCambiar(false, false);
      return;
    }
    // Se aplica el destino sobre el espacio actual (no la vista previa): si mientras se arrastraba
    // llegó un cambio del archivo (un agente), se conserva y se le suma este. Si ese cambio añadió o
    // quitó esquinas, el índice ya no es la misma esquina: se cancela.
    if (ae.tipo === 'vertice' && estanciaDe(this.esp, this.estSel).estancia.contorno.length !== ae.esquinas) {
      this.aviso('La estancia cambió mientras arrastrabas la esquina: no se ha movido. Vuelve a intentarlo.');
      this.alCambiar(false, false);
      return;
    }
    try {
      const d = ae.destino;
      this.estado.aplicar('desde' in d ? editarHueco(this.esp, ae.id, { desde: d.desde }) : moverVertice(this.esp, ae.k, d.x, d.y, this.estSel));
    } catch (e) {
      this.aviso(`No se ha aplicado: ${mensajeDe(e).replace(/^El resultado no es válido:\s*-\s*/, '').split('\n')[0]}`);
      this.alCambiar(false, false);
    }
  }

  private cancelarArrastreEstancia(): void {
    this.terminarArrastreEstancia(false);
  }

  /** Vista previa al arrastrar una esquina (con imán a sus vecinas) o un hueco a lo largo de su pared. */
  private moverArrastreEstancia(ev: PointerEvent): void {
    const ae = this.arrastreEstancia;
    if (!ae) return;
    if (!ae.previa && Math.hypot(ev.clientX - ae.inicio[0], ev.clientY - ae.inicio[1]) < 3) return;
    const p = this.escena.puntoEnPlano(ev, 0);
    if (!p) return;
    const c = estanciaDe(this.esp, this.estSel).estancia.contorno;
    try {
      if (ae.tipo === 'vertice') {
        let x = Math.round(p[0]);
        let y = Math.round(p[1]);
        if (!ev.shiftKey) {
          // Imán: se alinea con las esquinas vecinas para conservar paredes rectas a escuadra.
          const u = UMBRAL_IMAN_PX * this.cmPorPixel();
          const vecinas = [c[(ae.k - 1 + c.length) % c.length] as Punto, c[(ae.k + 1) % c.length] as Punto];
          const vx = vecinas.find((q) => Math.abs(q[0] - x) < u);
          const vy = vecinas.find((q) => Math.abs(q[1] - y) < u);
          if (vx) x = vx[0];
          if (vy) y = vy[1];
        }
        ae.previa = moverVertice(this.esp, ae.k, x, y, this.estSel);
        ae.destino = { x, y };
      } else {
        const h = estanciaDe(this.esp, this.estSel).estancia.huecos.find((x) => x.id === ae.id);
        if (!h) return;
        const [a, b] = muro(c, h.muro);
        const largo = longitudMuro(c, h.muro);
        const s = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / largo;
        const desde = Math.round(Math.min(Math.max(s - ae.agarre, 0), largo - h.ancho));
        ae.previa = editarHueco(this.esp, ae.id, { desde });
        ae.destino = { desde };
      }
    } catch (e) {
      // Posición no válida (p. ej. pisaría otro hueco o uno dejaría de caber): se queda la última
      // buena y se dice por qué.
      this.aviso(mensajeDe(e).replace(/^El resultado no es válido:\s*-\s*/, '').split('\n')[0] ?? '');
      return;
    }
    this.escena.ponerEdicion(this.edicion);
    this.escena.sincronizar(ae.previa, this.estado.seleccion, this.conError());
  }

  /** Posición candidata del arrastre a partir del último punto del puntero. */
  private recalcularArrastre(a: Arrastre): void {
    if (!a.ultimo) return;
    const cand: Mueble = { ...a.actual, x: Math.round(a.ultimo[0] + a.desfase[0]), y: Math.round(a.ultimo[1] + a.desfase[1]) };
    let guias: Guia[] = [];
    if (!a.sinIman) {
      // El centro no sale de la caja de la planta: en 3D un rayo rasante lo mandaría lejos.
      const c = cajaContorno(plantaDe(this.esp).estancias.flatMap((s) => s.contorno));
      cand.x = Math.min(c.maxX, Math.max(c.minX, cand.x));
      cand.y = Math.min(c.maxY, Math.max(c.minY, cand.y));
      const r = aplicarIman(this.esp, cand, UMBRAL_IMAN_PX * this.cmPorPixel());
      cand.x = Math.round(r.x * 10) / 10;
      cand.y = Math.round(r.y * 10) / 10;
      guias = r.guias;
    }
    a.actual = cand;
    this.escena.moverTemporal(cand);
    for (const o of a.otros) this.escena.moverTemporal({ ...o, x: o.x + cand.x - a.original.x, y: o.y + cand.y - a.original.y });
    this.escena.mostrarAyudas(cotas(this.esp, cand.id, cand), guias);
  }

  private terminarArrastre(confirmar: boolean): void {
    const a = this.arrastre;
    if (!a) return;
    this.arrastre = null;
    this.escena.controles.enabled = true;
    $('lienzo').classList.remove('arrastrando');
    const canvas = this.escena.renderer.domElement;
    if (canvas.hasPointerCapture(a.puntero)) canvas.releasePointerCapture(a.puntero);
    const cambio = a.actual.x !== a.original.x || a.actual.y !== a.original.y || a.actual.giro !== a.original.giro;
    if (confirmar && cambio) {
      try {
        if (a.otros.length) this.estado.aplicar(moverGrupo(this.esp, [a.id, ...a.otros.map((o) => o.id)], a.actual.x - a.original.x, a.actual.y - a.original.y));
        else this.estado.aplicar(editarMueble(this.esp, a.id, { x: a.actual.x, y: a.actual.y, giro: a.actual.giro }));
      } catch (e) {
        this.aviso(mensajeDe(e));
      }
    } else for (const o of [a.original, ...a.otros]) this.escena.moverTemporal(o);
    this.alCambiar(false, false);
  }

  private conectarPuntero(): void {
    const canvas = this.escena.renderer.domElement;
    canvas.addEventListener(
      'pointerdown',
      (ev) => {
        if (ev.button !== 0 || this.arrastre || this.arrastreEstancia) return;
        // Midiendo con el dedo, el punto se pone al levantarlo sin haber arrastrado (arrastrar mueve la
        // vista, como siempre en el móvil).
        if (this.cinta?.activo && ev.pointerType === 'touch') {
          // Un segundo dedo (pellizco para acercar) anula el toque: no es un punto (revisión independiente, 10).
          if (this.toqueCinta && this.dedos.has(this.toqueCinta.id) && this.toqueCinta.id !== ev.pointerId) this.toqueCinta.anulado = true;
          else this.toqueCinta = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, anulado: false };
          return;
        }
        // Midiendo, cada pulsación es un punto de la cinta (y la cámara no se mueve).
        if (this.cinta?.activo) {
          const p = this.escena.puntoEnPlano(ev, 0);
          if (p) this.cinta.pulsar(p, ev.shiftKey);
          ev.stopImmediatePropagation();
          this.pulsacionVacia = null;
          return;
        }
        // Calibrando o dibujando una estancia, cada pulsación es un punto (y la cámara no se mueve).
        if (this.calco?.activo()) {
          const p = this.escena.puntoEnPlano(ev, 0);
          if (p && this.calco.pulsar(p, ev.shiftKey)) {
            ev.stopImmediatePropagation();
            this.pulsacionVacia = null;
          }
          return;
        }
        if (this.edicion.editando) {
          const k = this.escena.verticeBajo(ev);
          if (k !== null) {
            this.empezarArrastreEstancia(ev, 'vertice', k, '');
            return;
          }
        }
        const hit = this.escena.muebleBajo(ev);
        if (!hit) {
          const idHueco = this.escena.huecoBajo(ev);
          if (idHueco && this.escena.vista === 'plano') {
            this.empezarArrastreEstancia(ev, 'hueco', -1, idHueco);
            return;
          }
          if (idHueco) {
            // En 3D sólo se selecciona: arrastrar sigue girando la cámara.
            this.seleccionarHueco(idHueco);
            this.pulsacionVacia = null;
            return;
          }
          this.pulsacionVacia = [ev.clientX, ev.clientY];
          return;
        }
        // Pulsar un mueble nunca gira ni desplaza la cámara.
        ev.stopImmediatePropagation();
        this.pulsacionVacia = null;
        // Ctrl+clic añade o quita de la selección (sin arrastrar).
        if (ev.ctrlKey || ev.metaKey) {
          this.alternar(hit.id);
          return;
        }
        // Pulsar uno de los elegidos arrastra el conjunto; pulsar otro elige sólo ese.
        const enGrupo = this.grupo.size > 0 && this.elegidos().includes(hit.id);
        if (!enGrupo) this.seleccionar(hit.id);
        const pl = plantaDe(this.esp);
        const m = pl.muebles.find((x) => x.id === hit.id);
        if (!m) return;
        const otros = enGrupo ? pl.muebles.filter((x) => x.id !== m.id && this.elegidos().includes(x.id)) : [];
        const bloqueado = [m, ...otros].find((x) => x.bloqueado);
        if (bloqueado) {
          this.aviso(`«${bloqueado.nombre}» está bloqueado; desbloquéalo en su ficha para moverlo.`);
          return;
        }
        // Si se agarra por encima (o cerca) de la altura de la cámara, el plano de arrastre quedaría
        // casi de canto y el mueble saltaría: entonces se arrastra sobre el suelo.
        const altura = hit.altura > this.escena.alturaCamara() - 40 ? 0 : hit.altura;
        const p = this.escena.puntoEnPlano(ev, altura);
        if (!p) return;
        this.escena.controles.enabled = false;
        canvas.setPointerCapture(ev.pointerId);
        this.arrastre = {
          id: m.id, original: { ...m }, actual: { ...m }, otros: otros.map((o) => ({ ...o })), desfase: [m.x - p[0], m.y - p[1]], altura,
          inicio: [ev.clientX, ev.clientY], ultimo: null, sinIman: false, movido: false, puntero: ev.pointerId,
        };
      },
      { capture: true },
    );
    canvas.addEventListener('pointermove', (ev) => {
      // Si el dedo se ha movido más de 10 px es un arrastre (aunque vuelva al sitio): no pone punto.
      const tc = this.toqueCinta;
      if (tc && tc.id === ev.pointerId && Math.hypot(ev.clientX - tc.x, ev.clientY - tc.y) >= 10) tc.anulado = true;
      // Con el dedo no hay puntero flotando: la medida provisional sólo sigue al ratón.
      if (this.cinta?.activo && ev.pointerType !== 'touch') {
        const p = this.escena.puntoEnPlano(ev, 0);
        if (p) this.cinta.mover(p, ev.shiftKey);
      }
      if (this.calco?.activo()) {
        const p = this.escena.puntoEnPlano(ev, 0);
        if (p) this.calco.mover(p, ev.shiftKey);
      }
      if (this.arrastreEstancia && ev.pointerId === this.arrastreEstancia.puntero) {
        this.moverArrastreEstancia(ev);
        return;
      }
      const a = this.arrastre;
      if (!a || ev.pointerId !== a.puntero) return;
      if (!a.movido && Math.hypot(ev.clientX - a.inicio[0], ev.clientY - a.inicio[1]) < 3) return;
      a.movido = true;
      $('lienzo').classList.add('arrastrando');
      const p = this.escena.puntoEnPlano(ev, a.altura);
      if (!p) return;
      a.ultimo = p;
      a.sinIman = ev.shiftKey;
      this.recalcularArrastre(a);
    });
    const soltar = (ev: PointerEvent): void => {
      const tc = this.toqueCinta;
      if (tc && tc.id === ev.pointerId) {
        this.toqueCinta = null;
        if (ev.type === 'pointerup' && this.cinta?.activo && !tc.anulado && Math.hypot(ev.clientX - tc.x, ev.clientY - tc.y) < 10) {
          const p = this.escena.puntoEnPlano(ev, 0);
          if (p) this.cinta.pulsar(p, false, true);
        }
        return;
      }
      const ae = this.arrastreEstancia;
      if (ae && ev.pointerId === ae.puntero) {
        this.terminarArrastreEstancia(true);
        return;
      }
      const a = this.arrastre;
      if (a && ev.pointerId === a.puntero) {
        this.terminarArrastre(true);
        return;
      }
      if (ev.type === 'pointerup' && this.pulsacionVacia) {
        const [x, y] = this.pulsacionVacia;
        if (Math.hypot(ev.clientX - x, ev.clientY - y) < 4) {
          // Un clic en el vacío suelta cualquier selección: mueble, hueco o esquina. Si cae en el
          // suelo de otra estancia, esa pasa a ser la que se edita.
          const est = this.escena.estanciaBajo(ev);
          const otra = est !== null && est !== this.estSel;
          this.edicion = { ...this.edicion, hueco: null, vertice: null, ...(otra ? { estancia: est } : {}) };
          this.seleccionar(null);
          this.alCambiar(false, false);
        }
      }
      this.pulsacionVacia = null;
    };
    canvas.addEventListener('pointerup', soltar);
    // Los dedos apoyados, vistos desde la ventana (también si otro elemento capturó el puntero).
    window.addEventListener('pointerdown', (ev) => ev.pointerType === 'touch' && this.dedos.add(ev.pointerId), { capture: true });
    for (const tipo of ['pointerup', 'pointercancel'] as const) {
      window.addEventListener(tipo, (ev) => {
        this.dedos.delete(ev.pointerId);
        // Un toque de la cinta cuyo dedo se levantó sin pasar por la vista se olvida.
        if (this.toqueCinta?.id === ev.pointerId) setTimeout(() => this.toqueCinta?.id === ev.pointerId && (this.toqueCinta = null));
      });
    }
    canvas.addEventListener('pointercancel', soltar);
    canvas.addEventListener('lostpointercapture', soltar);
    // Doble clic en una pared (editando esquinas): añade una esquina ahí.
    canvas.addEventListener('dblclick', (ev) => {
      if (this.calco?.dobleClic()) return;
      if (!this.edicion.editando) return;
      const p = this.escena.puntoEnPlano(ev, 0);
      if (!p) return;
      const pm = puntoEnMuro(this.esp, p[0], p[1], this.estSel);
      if (pm.distancia > 14 * this.cmPorPixel()) return;
      try {
        this.estado.aplicar(insertarVertice(this.esp, pm.muro, Math.round(pm.d), this.estSel));
        this.edicion = { ...this.edicion, vertice: pm.muro + 1, hueco: null };
        this.alCambiar(false, false);
      } catch (e) {
        this.aviso(mensajeDe(e));
      }
    });
    $('lienzo').addEventListener('pointerdown', () => {
      for (const p of document.querySelectorAll('.panel.abierto')) p.classList.remove('abierto');
    });
  }

  // ---------- Teclado ----------

  private conectarTeclado(): void {
    const canvas = this.escena.renderer.domElement;
    window.addEventListener('keydown', (ev) => {
      if (($('dialogo') as HTMLDialogElement).open) return;
      const k = ev.key.toLowerCase();
      const ctrl = ev.ctrlKey || ev.metaKey;
      // Calibrando o dibujando: Intro, Retroceso y Esc son del modo (fuera de los campos de texto).
      if (this.calco?.activo() && !(ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) && this.calco.tecla(k)) {
        ev.preventDefault();
        return;
      }

      // Recorriendo, las teclas son del recorrido (andar, mirar, salir), salvo en los campos de texto.
      if (this.recorrido?.activo && !(ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement)) {
        if (this.recorrido.tecla(ev)) return;
      }
      // Midiendo: Esc o M salen de la cinta.
      if (this.cinta?.activo && !(ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) && this.cinta.tecla(k)) {
        ev.preventDefault();
        return;
      }
      // Arrastrando una esquina o un hueco sólo cuenta Esc, que lo cancela.
      if (this.arrastreEstancia) {
        ev.preventDefault();
        if (k === 'escape') this.cancelarArrastreEstancia();
        return;
      }
      // Durante un arrastre sólo cuentan girar y cancelar.
      const a = this.arrastre;
      if (a) {
        ev.preventDefault();
        if (k === 'r' && !a.otros.length) {
          a.actual = { ...a.actual, giro: normalizarGiro(a.actual.giro + (ev.shiftKey ? 90 : 15)) };
          if (a.ultimo) this.recalcularArrastre(a);
          else this.escena.moverTemporal(a.actual);
        } else if (k === 'escape') this.terminarArrastre(false);
        return;
      }

      if (ctrl && k === 's') {
        ev.preventDefault();
        void this.guardar();
        return;
      }
      if (ctrl && k === 'o') {
        ev.preventDefault();
        void this.abrir();
        return;
      }
      const t = ev.target as HTMLElement;
      const enSelector = t instanceof HTMLSelectElement;
      if (esCampoDeTexto(t) || enSelector) {
        // En un formulario con botón de enviar (guardar distribución), Intro lo envía.
        if (k === 'enter' && t.closest('form')?.querySelector('button[type="submit"]')) return;
        // Intro confirma el campo y Esc lo deja como estaba; los dos devuelven el teclado a la vista.
        if (k === 'enter' || k === 'escape') {
          if (k === 'escape' && esCampoDeTexto(t) && t.dataset.original !== undefined) (t as HTMLInputElement).value = t.dataset.original;
          t.blur();
          canvas.focus();
          ev.preventDefault();
          return;
        }
        // En un campo de texto todo se escribe; en un selector sólo las teclas que lo manejan.
        if (!enSelector || k.length === 1 || k.startsWith('arrow') || k === 'home' || k === 'end') return;
      }
      if (ctrl && k === 'z' && !ev.shiftKey) this.historial('deshacer');
      else if (ctrl && (k === 'y' || (k === 'z' && ev.shiftKey))) this.historial('rehacer');
      else if (ctrl && k === 'd') this.duplicar();
      else if (ctrl) return;
      else if (k === 'r') this.girar(ev.shiftKey ? 90 : 15);
      else if (k === 'delete' || k === 'backspace') {
        if (this.edicion.editando && this.edicion.vertice !== null) {
          const v = this.edicion.vertice;
          this.intentar('e-error', () => {
            this.estado.aplicar(quitarVertice(this.esp, v, this.estSel));
            this.edicion = { ...this.edicion, vertice: null };
          });
          this.alCambiar(false, false);
        } else if (this.edicion.hueco && !this.estado.seleccion) {
          const id = this.edicion.hueco;
          this.intentar('h-error', () => this.estado.aplicar(quitarHueco(this.esp, id)));
        } else this.quitar();
      } else if (k === 'escape') {
        this.edicion = { ...this.edicion, vertice: null, hueco: null };
        this.seleccionar(null);
        this.alCambiar(false, false);
      }
      else if (k === 'v') this.ponerVista(this.escena.vista === 'plano' ? '3d' : 'plano');
      else if (k === 'p' && !ctrl) this.recorrido?.entrar();
      else if (k === 'm') this.cinta?.alternar();
      else if (k === 'f') this.escena.encuadrar();
      else if (k === '?') void this.ayuda();
      else if (k.startsWith('arrow')) {
        if (!this.estado.seleccion) return;
        const paso = ev.shiftKey ? 10 : 1;
        if (k === 'arrowup') this.empujar(1, 0, paso, ev.repeat);
        else if (k === 'arrowdown') this.empujar(-1, 0, paso, ev.repeat);
        else if (k === 'arrowright') this.empujar(0, 1, paso, ev.repeat);
        else this.empujar(0, -1, paso, ev.repeat);
      } else return;
      ev.preventDefault();
    });
  }

  // ---------- Ganchos de lectura para las pruebas automáticas ----------

  private exponerParaPruebas(): void {
    const escena = this.escena;
    (window as unknown as Record<string, unknown>).__ESPACIOS3D__ = {
      version: __VERSION__,
      espacio: () => JSON.parse(JSON.stringify(this.esp)) as Espacio,
      seleccion: () => this.estado.seleccion,
      incidencias: () => JSON.parse(JSON.stringify(this.incidencias)) as Incidencia[],
      estancia: () => this.estSel,
      recorrido: () => (this.recorrido ? { activo: this.recorrido.activo, pos: this.recorrido.pos, rumbo: (this.recorrido.rumbo * 180) / Math.PI, cabeceo: (this.recorrido.cabeceo * 180) / Math.PI, planta: this.recorrido.estado.planta, escalera: this.recorrido.estado.escalera, otras: escena.plantasDibujadas().otras } : null),
      plantasDibujadas: () => escena.plantasDibujadas(),
      circulosGiro: () => escena.circulos,
      fotos: (lista: 'mueble' | 'estancia') => this.fotos?.estado(lista) ?? [],
      fondos: () => this.calco?.estadoFondos() ?? [],
      colocarRecorrido: (x: number, y: number, grados: number) => this.recorrido?.colocar(x, y, grados),
      hayMuroEntre: (a: Punto, b: Punto, altura: number) => escena.hayMuroEntre(a, b, altura),
      vista: () => escena.vista,
      plantaActiva: () => plantaActivaId(this.esp),
      formaMueble: (id: string) => escena.formaMueble(id),
      cinta: () => this.cinta?.estado() ?? null,
      elegidos: () => this.elegidos(),
      /** Posición de la cámara de la vista actual (cm, con y hacia arriba). */
      camara: () => escena.camara.position.toArray().map((v) => Math.round(v * 1000) / 10),
      pendiente: () => this.sinc.pendiente,
      historial: () => ({ deshacer: this.estado.puedeDeshacer(), rehacer: this.estado.puedeRehacer() }),
      /** Coordenadas de pantalla de un punto de planta (cm) a la altura dada (cm). */
      aPantalla: (x: number, y: number, z = 0): Punto => {
        const v = new THREE.Vector3(x / 100, z / 100, y / 100).project(escena.camara);
        const r = escena.renderer.domElement.getBoundingClientRect();
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      },
    };
  }
}

new App();
