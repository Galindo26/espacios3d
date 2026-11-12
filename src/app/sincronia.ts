// Sincronía entre la página y el archivo del espacio, que también pueden editar agentes.
//
// Reglas (invariante 4 de AGENTS.md: no pisar a otros escritores):
//  - Toda operación sobre el almacén va en exclusión mutua (una cola): guardar, sondear,
//    vincular y «Guardar como» nunca se intercalan.
//  - Antes de escribir se relee el archivo; si su contenido cambió desde la última lectura o
//    escritura propia, gana el archivo: se carga y se descarta lo pendiente, con aviso.
//  - Si el archivo cambió fuera y tiene errores, queda bloqueado: no se autoguarda encima hasta
//    que se arregle (el sondeo lo recoge) o la persona elija «Guardar mi versión».
//  - Un cambio de fecha sin cambio de contenido no es conflicto.
//  - Un fallo de escritura se reintenta con espera creciente.
import type { Espacio } from '../core/index.js';
import { aJSON, validar } from '../core/index.js';
import type { Almacen, Instantanea, Leido } from './almacen.js';

export type Clase = '' | 'pendiente' | 'fallo';

export interface Avisos {
  estado(texto: string, clase: Clase): void;
  /** Sustituir lo que se ve por el espacio del archivo. */
  cargar(espacio: Espacio, mensaje: string): void;
  /** El archivo vinculado tiene errores (lista) o ya no (null). */
  bloqueo(errores: string[] | null): void;
  /** Todo lo de la página está en el archivo. */
  guardado(): void;
  arrastrando(): boolean;
}

export interface Reloj {
  poner(f: () => void, ms: number): unknown;
  quitar(id: unknown): void;
  hora(): string;
}

export const relojReal: Reloj = {
  poner: (f, ms) => globalThis.setTimeout(f, ms),
  quitar: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  hora: () => new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
};

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class Sincronizador {
  almacen: Almacen;
  bloqueadoPor: string[] | null = null;
  private conocido: Instantanea | null = null;
  private texto: string | null = null;
  private revision = 0;
  private guardada = 0;
  private cola: Promise<unknown> = Promise.resolve();
  private enCurso = 0;
  private temporizador: unknown;
  private fallos = 0;

  constructor(
    almacen: Almacen,
    private readonly avisos: Avisos,
    private readonly reloj: Reloj = relojReal,
    private readonly retardo = 600,
  ) {
    this.almacen = almacen;
  }

  /** Hay cambios de la persona que no están en ningún archivo. */
  get pendiente(): boolean {
    return this.revision !== this.guardada;
  }

  get ocupado(): boolean {
    return this.enCurso > 0;
  }

  private exclusivo<T>(f: () => Promise<T>): Promise<T> {
    this.enCurso++;
    const p = this.cola.then(f).finally(() => {
      this.enCurso--;
    });
    this.cola = p.catch(() => undefined);
    return p;
  }

  private programar(ms: number): void {
    this.reloj.quitar(this.temporizador);
    this.temporizador = this.reloj.poner(() => void this.guardarAhora(), ms);
  }

  /** El espacio que se ve, sin contarlo como cambio (al cargar un archivo). */
  establecer(espacio: Espacio): void {
    this.texto = aJSON(espacio);
    this.guardada = this.revision;
  }

  /** Cambio hecho por la persona. */
  cambioLocal(espacio: Espacio): void {
    this.texto = aJSON(espacio);
    this.revision++;
    if (!this.almacen.vinculado()) {
      this.avisos.estado('Cambios sin guardar en ningún archivo · Guardar como…', 'pendiente');
      return;
    }
    if (this.bloqueadoPor) {
      this.avisos.estado('El archivo tiene errores: no se guarda encima hasta que se arregle o elijas «Guardar mi versión»', 'fallo');
      return;
    }
    this.avisos.estado('Guardando…', 'pendiente');
    this.programar(this.retardo);
  }

  /** Instantánea tras escribir `texto`: si el archivo ya no es el nuestro, se marca para que el sondeo lo recoja. */
  private async trasEscribir(texto: string): Promise<void> {
    let leido: Instantanea | null = null;
    try {
      leido = await this.almacen.leer();
    } catch {
      /* ilegible un instante: con lm NaN el siguiente sondeo lo vuelve a leer y compara el texto */
    }
    this.conocido = leido && leido.texto === texto ? leido : { texto, lm: Number.NaN };
  }

  /**
   * Al vincular, lo conocido es el texto que se leyó y se está mostrando. Si el archivo ya cambió (un
   * agente escribió entre la lectura y la vinculación, p. ej. mientras la persona leía un diálogo), se
   * marca con lm NaN para que el sondeo lo recoja en vez de pisarlo (revisión independiente de la ronda 5, 1).
   */
  private async conocerLeido(texto: string): Promise<void> {
    let foto: Instantanea | null = null;
    try {
      foto = await this.almacen.leer();
    } catch {
      /* ilegible un instante: con lm NaN el sondeo vuelve a mirar */
    }
    this.conocido = foto && foto.texto === texto ? foto : { texto, lm: Number.NaN };
  }

  /** Tras salir sin escribir (cancelado o fallo), lo pendiente vuelve a quedar programado. */
  private reprogramarPendiente(): void {
    if (this.pendiente && this.almacen.vinculado() && !this.bloqueadoPor) this.programar(this.retardo);
  }

  guardarAhora(forzar = false): Promise<void> {
    this.reloj.quitar(this.temporizador);
    return this.exclusivo(async () => {
      if (!this.almacen.vinculado() || this.texto === null) return;
      if (!forzar && (!this.pendiente || this.bloqueadoPor)) return;
      let foto: Instantanea | null;
      try {
        foto = await this.almacen.leer();
      } catch (e) {
        return this.fallo(e);
      }
      if (!forzar && foto && this.conocido && foto.texto !== this.conocido.texto) {
        await this.aplicarExterno(foto);
        return;
      }
      const rev = this.revision;
      const texto = this.texto;
      try {
        await this.almacen.guardar(texto);
      } catch (e) {
        return this.fallo(e);
      }
      this.fallos = 0;
      await this.trasEscribir(texto);
      this.guardada = rev;
      this.desbloquear();
      if (this.pendiente) this.programar(this.retardo);
      else {
        this.avisos.estado(`Guardado en ${this.almacen.nombreArchivo()} a las ${this.reloj.hora()}`, '');
        this.avisos.guardado();
      }
    });
  }

  private fallo(e: unknown): void {
    this.fallos++;
    const espera = Math.min(30000, 1000 * 2 ** (this.fallos - 1));
    this.avisos.estado(`No se pudo guardar: ${mensajeDe(e)}. Se reintenta en ${Math.round(espera / 1000)} s`, 'fallo');
    this.programar(espera);
  }

  private desbloquear(): void {
    if (this.bloqueadoPor) {
      this.bloqueadoPor = null;
      this.avisos.bloqueo(null);
    }
  }

  /** Carga una versión del archivo hecha fuera; si tiene errores, bloquea el autoguardado. */
  private async aplicarExterno(foto: Instantanea): Promise<void> {
    const habiaPendiente = this.pendiente;
    const estabaBloqueado = this.bloqueadoPor !== null;
    this.conocido = foto;
    let errores: string[];
    try {
      const r = validar(JSON.parse(foto.texto));
      if (r.ok) {
        this.texto = aJSON(r.espacio);
        this.guardada = this.revision;
        this.desbloquear();
        const mensaje = !habiaPendiente
          ? 'Se ha cargado un cambio hecho en el archivo desde fuera.'
          : estabaBloqueado
            ? 'El archivo se ha corregido fuera: se ha cargado y se han descartado los cambios que hiciste mientras tenía errores.'
            : 'El archivo cambió fuera de esta página (quizá un agente): se ha cargado esa versión y se ha descartado tu último cambio.';
        // Un archivo vinculado que vuelve a ser de la v1 (p. ej., alguien restauró la copia) se avisa:
        // el próximo cambio lo escribirá en v2 sin otra confirmación.
        const v1 = r.migradoDesde ? ' Es de la versión 1: el próximo cambio lo guardará convertido a la versión 2, que las versiones anteriores no abren. Si las necesitas, copia antes el archivo.' : '';
        this.avisos.cargar(r.espacio, mensaje + v1);
        this.avisos.estado(`Recargado ${this.almacen.nombreArchivo()}`, '');
        this.avisos.guardado();
        return;
      }
      errores = r.errores;
    } catch (e) {
      errores = [`No es JSON válido: ${mensajeDe(e)}`];
    }
    this.bloqueadoPor = errores;
    this.avisos.bloqueo(errores);
    this.avisos.estado('El archivo cambió fuera y tiene errores: no se guarda encima', 'fallo');
  }

  /** Comprueba si el archivo cambió fuera (cada segundo). */
  sondear(): Promise<void> {
    if (!this.almacen.vinculado() || this.ocupado || this.avisos.arrastrando()) return Promise.resolve();
    return this.exclusivo(async () => {
      if (!this.almacen.vinculado() || !this.conocido) return;
      let foto: Instantanea | null;
      try {
        foto = await this.almacen.leer();
      } catch {
        return; // inaccesible un momento (p. ej. mientras otro programa lo reemplaza)
      }
      if (!foto || foto.lm === this.conocido.lm) return;
      if (foto.texto === this.conocido.texto) {
        this.conocido = foto;
        return;
      }
      // Con cambios propios pendientes, el conflicto lo resuelve guardarAhora() en su turno.
      if (this.pendiente && !this.bloqueadoPor) return;
      // En pleno arrastre no se cambia el espacio bajo el puntero: el siguiente sondeo lo recoge.
      if (this.avisos.arrastrando()) return;
      await this.aplicarExterno(foto);
    });
  }

  /** Vincula un archivo recién abierto cuyo contenido ya se validó y se está mostrando. */
  vincular(leido: Leido, espacio: Espacio): Promise<void> {
    this.reloj.quitar(this.temporizador);
    return this.exclusivo(async () => {
      await leido.aceptar();
      this.establecer(espacio);
      await this.conocerLeido(leido.texto);
      this.desbloquear();
      this.avisos.estado(
        this.almacen.vinculado() ? `Abierto ${leido.nombre}; se guarda solo` : `Abierto ${leido.nombre} · para guardarlo usa Guardar como…`,
        '',
      );
      if (this.almacen.vinculado()) this.avisos.guardado();
    });
  }

  /**
   * Vincula un archivo sin tocar lo que se ve ni lo pendiente (página abierta por un agente, ronda 5):
   * lo conocido pasa a ser el archivo y, si hay cambios de la persona, se guardan sobre él en su turno.
   * Quien llama ya comprobó que el archivo es el que se copió en la página (o que la persona eligió
   * guardar encima).
   */
  vincularConservando(leido: Leido): Promise<void> {
    this.reloj.quitar(this.temporizador);
    return this.exclusivo(async () => {
      await leido.aceptar();
      await this.conocerLeido(leido.texto);
      this.desbloquear();
      if (!this.almacen.vinculado()) return;
      if (this.pendiente) {
        this.avisos.estado('Guardando…', 'pendiente');
        this.programar(0);
      } else {
        this.avisos.estado(`Abierto ${leido.nombre}; se guarda solo`, '');
        this.avisos.guardado();
      }
    });
  }

  guardarComo(sugerido: string): Promise<boolean> {
    this.reloj.quitar(this.temporizador);
    return this.exclusivo(async () => {
      if (this.texto === null) return false;
      const texto = this.texto;
      const rev = this.revision;
      let ok: boolean;
      try {
        ok = await this.almacen.guardarComo(texto, sugerido);
      } catch (e) {
        this.avisos.estado(`No se pudo guardar: ${mensajeDe(e)}`, 'fallo');
        this.reprogramarPendiente();
        return false;
      }
      if (!ok) {
        this.reprogramarPendiente();
        return false;
      }
      await this.trasEscribir(texto);
      this.guardada = rev;
      this.desbloquear();
      const n = this.almacen.nombreArchivo();
      if (this.almacen.vinculado()) {
        this.avisos.estado(`Guardado en ${n}; se guarda solo`, '');
        this.avisos.guardado();
      } else this.avisos.estado(`Descargado ${n}`, '');
      if (this.pendiente && this.almacen.vinculado()) this.programar(this.retardo);
      return true;
    });
  }

  /** Empezar de cero con otro almacén (sin archivo). */
  desvincular(nuevo: Almacen, espacio: Espacio): Promise<void> {
    this.reloj.quitar(this.temporizador);
    return this.exclusivo(async () => {
      this.almacen = nuevo;
      this.conocido = null;
      this.establecer(espacio);
      this.desbloquear();
      this.avisos.estado('Sin guardar', '');
    });
  }
}
