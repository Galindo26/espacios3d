// Ronda 2 (R2-3) en la página: carpeta de trabajo, plano de fondo (poner, calibrar, opacidad, quitar),
// «Dibujar estancia» clic a clic sobre el plano y las vías para asistentes de chat (copiar el espacio
// y pegar sus cambios). La lógica de formato está en el núcleo; aquí sólo hay interacción.
import type { Espacio, Fondo, Punto } from '../core/index.js';
import { plantaActivaId, plantaDe } from './plantaActiva.js';
import {
  aJSON, agregarEstancia, calibrarFondo, describir, describirTexto, editarFondo, ejecutarLote, planoPng, plantaAFondo,
  ponerFondo, quitarFondo, rutaRelativaValida, validar,
} from '../core/index.js';
import { copiarJuntoAlEspacio, type Almacen, type Leido } from './almacen.js';
import type { Escena } from './escena.js';
import { $, $in } from './ui.js';

export interface Anfitrion {
  esp(): Espacio;
  aplicar(e: Espacio): void;
  almacen(): Almacen;
  escena: Escena;
  aviso(texto: string): void;
  /** Al empezar a calibrar o dibujar: los demás modos de pulsar en la vista se cierran (la cinta). */
  alEmpezarModo?(): void;
  informar(titulo: string, texto: string, lista?: string[]): Promise<boolean>;
  confirmar(titulo: string, texto: string, aceptar: string): Promise<boolean>;
  /** Diálogo con contenido propio; devuelve lo que lea `leer` si se acepta, o null. */
  pedir<T>(titulo: string, nodos: Node[], aceptar: string, leer: () => T): Promise<T | null>;
  elegirEstancia(id: string): void;
  cmPorPixel(): number;
  usarLeido(leido: Leido | null): Promise<void>;
  /** Abrir un espacio elegido en «Carpeta…» (sin perder cambios; con la copia de un agente, reconcilia). */
  usarDeCarpeta(c: { nombre: string; archivos: string[] }, ruta: string): Promise<void>;
}

type Modo = { tipo: 'calibrar'; fondo: string; archivo: string; puntos: Punto[] } | { tipo: 'dibujar'; puntos: Punto[] };

/** Ángulo (rad) dentro del cual un tramo dibujado se endereza a horizontal o vertical. */
const IMAN_ANGULO = (7 * Math.PI) / 180;

export class Calco {
  private modo: Modo | null = null;
  /** Imágenes de fondo por ruta: cargada, cargando o que no se encuentra. */
  private readonly imagenes = new Map<string, ImageBitmap | 'cargando' | 'falta'>();

  constructor(private readonly a: Anfitrion) {
    $('b-carpeta').hidden = !a.almacen().abrirCarpeta;
    $('b-carpeta').addEventListener('click', () => void this.carpeta());
    $('b-fondo-poner').addEventListener('click', () => void this.empezarPonerPlano());
    $in('f-archivo').addEventListener('change', () => void this.ponerPlano());
    $('b-fondo-calibrar').addEventListener('click', () => this.empezar({ tipo: 'calibrar', fondo: this.fondo()!.id, archivo: this.fondo()!.archivo, puntos: [] }));
    $('b-dibujar').addEventListener('click', () => (this.modo?.tipo === 'dibujar' ? this.cancelar() : this.empezar({ tipo: 'dibujar', puntos: [] })));
    $in('f-opacidad').addEventListener('change', () => {
      const f = this.fondo();
      if (f) this.a.aplicar(editarFondo(this.a.esp(), f.id, { opacidad: Number($in('f-opacidad').value) }));
    });
    $('b-fondo-quitar').addEventListener('click', () => void this.quitarPlano());
    $('b-copiar-agente').addEventListener('click', () => void this.copiarParaAgente());
    $('b-pegar').addEventListener('click', () => void this.pegar());
    // Ctrl+V con una imagen (una captura de un plano en PDF, por ejemplo) la pone como plano de fondo.
    document.addEventListener('paste', (ev) => {
      const destino = ev.target;
      if (destino instanceof HTMLInputElement || destino instanceof HTMLTextAreaElement) return;
      if (($('dialogo') as HTMLDialogElement).open) return;
      const item = [...(ev.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      const archivo = item?.getAsFile();
      if (!archivo) return;
      ev.preventDefault();
      void this.pegarImagen(archivo);
    });
  }

  activo(): boolean {
    return this.modo !== null;
  }

  private fondo(): Fondo | null {
    return plantaDe(this.a.esp()).fondos?.[0] ?? null;
  }

  /** Repinta el panel y los fondos de la escena (tras cada cambio). */
  pintar(): void {
    const fondos = plantaDe(this.a.esp()).fondos ?? [];
    const f = fondos[0] ?? null;
    // Si el fondo que se calibraba desaparece (deshacer, otro archivo), se sale del modo.
    const calibrando = this.modo?.tipo === 'calibrar' ? this.modo : null;
    if (calibrando && !fondos.some((x) => x.id === calibrando.fondo && x.archivo === calibrando.archivo)) {
      this.modo = null;
      this.a.escena.ponerTrazo([]);
    }
    $('b-fondo-calibrar').hidden = !f;
    $('campo-opacidad').hidden = !f;
    $('acciones-fondo').hidden = !f;
    if (f && document.activeElement !== $in('f-opacidad')) $in('f-opacidad').value = String(f.opacidad);
    $('b-dibujar').textContent = this.modo?.tipo === 'dibujar' ? 'Cancelar dibujo' : 'Dibujar estancia';
    $('b-dibujar').setAttribute('aria-pressed', String(this.modo?.tipo === 'dibujar'));
    const faltan = fondos.filter((x) => this.imagenes.get(this.clave(x.archivo)) === 'falta');
    const ayuda = $('modo-ayuda');
    const texto =
      this.modo?.tipo === 'calibrar'
        ? this.modo.puntos.length === 0
          ? 'Calibrar: pulsa en el plano el primer punto de una medida que conozcas.'
          : 'Ahora pulsa el segundo punto. Esc cancela.'
        : this.modo?.tipo === 'dibujar'
          ? 'Pulsa en cada esquina (se endereza a horizontal y vertical; Mayús lo evita). Doble clic, Intro o pulsar la primera esquina cierra la estancia; Retroceso quita la última; Esc cancela.'
          : faltan.length
            ? `No se encuentra ${faltan.map((x) => x.archivo).join(', ')} junto al archivo: abre su carpeta con «Carpeta…».`
            : '';
    ayuda.textContent = texto;
    ayuda.hidden = !texto;
    for (const x of fondos) if (!this.imagenes.has(this.clave(x.archivo))) void this.cargar(x.archivo);
    this.a.escena.ponerFondos(fondos.map((x) => {
      const img = this.imagenes.get(this.clave(x.archivo));
      return { fondo: x, imagen: img instanceof ImageBitmap ? img : null };
    }));
  }

  /**
   * Clave de la caché de imágenes: la misma ruta (planos/piso.png) es otra imagen en otro archivo o
   * en otra carpeta, así que la clave lleva también el archivo vinculado y su carpeta.
   */
  /** Para las pruebas: cómo va cada fondo de la planta que se ve (imagen, falta o cargando). */
  estadoFondos(): { archivo: string; estado: string }[] {
    return (plantaDe(this.a.esp()).fondos ?? []).map((f) => {
      const v = this.imagenes.get(this.clave(f.archivo));
      return { archivo: f.archivo, estado: v === undefined ? 'sin pedir' : typeof v === 'string' ? v : 'imagen' };
    });
  }

  private clave(ruta: string): string {
    const alm = this.a.almacen();
    return JSON.stringify([alm.vinculacion?.() ?? 0, alm.nombreArchivo(), alm.carpeta?.() ?? null, ruta]);
  }

  private async cargar(archivo: string): Promise<void> {
    const k = this.clave(archivo);
    this.imagenes.set(k, 'cargando');
    const blob = await this.a.almacen().leerRelativo?.(archivo).catch(() => null);
    if (!blob) {
      this.imagenes.set(k, 'falta');
    } else {
      try {
        this.imagenes.set(k, await createImageBitmap(blob));
      } catch {
        this.imagenes.set(k, 'falta');
      }
    }
    this.pintar();
  }

  // ---------- Carpeta de trabajo ----------

  private async carpeta(): Promise<void> {
    const alm = this.a.almacen();
    let c: { nombre: string; archivos: string[] } | null;
    try {
      c = (await alm.abrirCarpeta?.()) ?? null;
    } catch (e) {
      this.a.aviso(`No se pudo abrir la carpeta: ${(e as Error).message}`);
      return;
    }
    if (!c) return;
    // Para elegir: un botón de opción por espacio, y uno para guardar el actual como nuevo.
    const NUEVO = '\u0000nuevo';
    const lista = document.createElement('div');
    lista.className = 'opciones';
    const opciones = [...c.archivos, NUEVO];
    opciones.forEach((o, i) => {
      const l = document.createElement('label');
      l.className = 'casilla';
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'archivo-carpeta';
      r.value = o;
      r.checked = i === 0;
      const s = document.createElement('span');
      s.textContent = o === NUEVO ? `Guardar el espacio actual aquí como «${nombreArchivo(this.a.esp().nombre)}»` : o;
      l.append(r, s);
      lista.append(l);
    });
    const p = document.createElement('p');
    p.textContent = c.archivos.length ? `Espacios de «${c.nombre}»:` : `«${c.nombre}» no tiene espacios todavía.`;
    const elegido = await this.a.pedir('Carpeta de trabajo', [p, lista], 'Abrir', () => (lista.querySelector('input:checked') as HTMLInputElement | null)?.value ?? null);
    if (!elegido) return;
    if (elegido === NUEVO) {
      const nombre = nombreArchivo(this.a.esp().nombre);
      if (c.archivos.includes(nombre) && !(await this.a.confirmar(`¿Sustituir «${nombre}»?`, 'Ya hay un archivo con ese nombre en la carpeta; se sustituirá por el espacio actual.', 'Sustituir'))) return;
      // Como al abrir: la página lo valida y lo vincula, y el guardado automático parte de este texto.
      await this.a.usarLeido((await alm.crearEnCarpeta?.(nombre, aJSON(this.a.esp()))) ?? null);
      this.a.aviso(`Guardado en la carpeta «${c.nombre}» como ${nombre}.`);
      return;
    }
    await this.a.usarDeCarpeta(c, elegido);
  }

  // ---------- Plano de fondo ----------

  private async empezarPonerPlano(): Promise<void> {
    const c = this.a.almacen().carpeta?.();
    if (!c?.archivo) {
      await this.a.informar(
        'Primero, la carpeta de trabajo',
        this.a.almacen().abrirCarpeta
          ? 'El plano se guarda junto al archivo del espacio, para que viaje con él. Pulsa «Carpeta…», elige la carpeta y abre o guarda ahí el espacio; después, pon el plano.'
          : 'Este navegador no deja trabajar con carpetas. Usa Edge o Chrome, o pon el plano con un asistente («fondo poner» en el CLI).',
      );
      return;
    }
    $in('f-archivo').value = '';
    $in('f-archivo').click();
  }

  private async ponerPlano(): Promise<void> {
    const archivo = $in('f-archivo').files?.[0];
    if (archivo) await this.ponerImagen(archivo, archivo.name);
  }

  /** Imagen pegada con Ctrl+V (una captura de un PDF, por ejemplo): se pone como plano. */
  async pegarImagen(blob: Blob): Promise<void> {
    if (!this.a.almacen().carpeta?.()?.archivo) return this.empezarPonerPlano();
    await this.ponerImagen(blob, 'pegado.png');
  }

  private async ponerImagen(original: Blob, nombre: string): Promise<void> {
    let img: ImageBitmap;
    try {
      img = await createImageBitmap(original);
    } catch {
      return this.a.aviso('No se puede leer esa imagen: usa un PNG o un JPEG.');
    }
    // Siempre PNG (el CLI compara el calco sólo sobre PNG) y, si es enorme, reducido a 3000 px.
    const MAX = 3000;
    const k = Math.min(1, MAX / Math.max(img.width, img.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(img.width * k));
    lienzo.height = Math.max(1, Math.round(img.height * k));
    lienzo.getContext('2d')!.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const png = await new Promise<Blob | null>((res) => lienzo.toBlob(res, 'image/png'));
    if (!png) return this.a.aviso('No se pudo convertir la imagen a PNG.');
    if (k < 1) img = await createImageBitmap(lienzo);
    let ruta: string;
    try {
      // Sin pisar otro plano con el mismo nombre: plano.png, plano-2.png… (el mismo contenido se reutiliza).
      ruta = await copiarJuntoAlEspacio(this.a.almacen(), 'planos', nombre, 'png', png, 'plano');
    } catch (e) {
      return this.a.aviso(`No se pudo copiar el plano a la carpeta: ${(e as Error).message}`);
    }
    this.imagenes.set(this.clave(ruta), img);
    // Primera colocación: la imagen ocupa más o menos lo que la planta, empezando en su esquina.
    const pl = plantaDe(this.a.esp());
    const xs = pl.estancias.flatMap((s) => s.contorno.map((q) => q[0]));
    const ys = pl.estancias.flatMap((s) => s.contorno.map((q) => q[1]));
    const anchoCm = Math.max(300, Math.max(...xs) - Math.min(...xs));
    const escala = Math.round((anchoCm / img.width) * 1e4) / 1e4;
    const anterior = pl.fondos?.[0];
    let e = this.a.esp();
    if (anterior) e = quitarFondo(e, anterior.id);
    const r = ponerFondo(e, { archivo: ruta, anchoPx: img.width, altoPx: img.height, escala, x: Math.min(...xs), y: Math.min(...ys) }, plantaActivaId(e));
    this.a.aplicar(r.espacio);
    this.a.escena.reencuadrar();
    this.empezar({ tipo: 'calibrar', fondo: r.id, archivo: ruta, puntos: [] });
    this.a.aviso('Plano puesto. Para que las medidas sean reales, calíbralo: pulsa dos puntos de una medida que conozcas.');
  }

  private async quitarPlano(): Promise<void> {
    const f = this.fondo();
    if (!f) return;
    if (!(await this.a.confirmar('¿Quitar el plano de fondo?', `Deja de verse; la imagen ${f.archivo} se queda en la carpeta.`, 'Quitar plano'))) return;
    this.a.aplicar(quitarFondo(this.a.esp(), f.id));
  }

  // ---------- Modos: calibrar y dibujar ----------

  private empezar(m: Modo): void {
    this.a.alEmpezarModo?.();
    this.modo = m;
    this.a.escena.ponerTrazo([]);
    this.pintar();
  }

  cancelar(): void {
    if (!this.modo) return;
    this.modo = null;
    this.a.escena.ponerTrazo([]);
    this.pintar();
  }

  /**
   * Punto con el imán de «Dibujar»: a 1 cm, enderezado respecto al anterior y alineado con la x o
   * la y de la primera esquina si cae cerca (así la pared que cierra queda recta).
   */
  private ajustar(p: Punto, libre: boolean): Punto {
    const r: Punto = [Math.round(p[0]), Math.round(p[1])];
    if (libre || this.modo?.tipo !== 'dibujar') return r;
    const ps = this.modo.puntos;
    const prev = ps[ps.length - 1];
    if (!prev) return r;
    const dx = r[0] - prev[0];
    const dy = r[1] - prev[1];
    if (Math.abs(dy) <= Math.tan(IMAN_ANGULO) * Math.abs(dx)) r[1] = prev[1];
    else if (Math.abs(dx) <= Math.tan(IMAN_ANGULO) * Math.abs(dy)) r[0] = prev[0];
    const primero = ps[0]!;
    const cerca = 10 * this.a.cmPorPixel();
    if (ps.length >= 2) {
      if (Math.abs(r[0] - primero[0]) <= cerca) r[0] = primero[0];
      if (Math.abs(r[1] - primero[1]) <= cerca) r[1] = primero[1];
    }
    return r;
  }

  /** ¿Está a unos pocos píxeles de otro punto? (doble clic, dos clics en el mismo sitio). */
  private casiIgual(a: Punto, b: Punto): boolean {
    return Math.hypot(a[0] - b[0], a[1] - b[1]) <= 4 * this.a.cmPorPixel();
  }

  /** Pulsación en el plano durante un modo. Devuelve true si la ha usado. */
  pulsar(p: Punto, libre: boolean): boolean {
    const m = this.modo;
    if (!m) return false;
    if (m.tipo === 'calibrar') {
      m.puntos.push([p[0], p[1]]);
      this.a.escena.ponerTrazo(m.puntos);
      if (m.puntos.length === 2) void this.terminarCalibrado(m);
      this.pintar();
      return true;
    }
    const q = this.ajustar(p, libre);
    const primero = m.puntos[0];
    if (primero && m.puntos.length >= 3 && Math.hypot(q[0] - primero[0], q[1] - primero[1]) <= 12 * this.a.cmPorPixel()) {
      this.terminarDibujo();
      return true;
    }
    const ultimo = m.puntos[m.puntos.length - 1];
    if (!ultimo || !this.casiIgual(q, ultimo)) m.puntos.push(q);
    this.a.escena.ponerTrazo(m.puntos);
    return true;
  }

  /** Movimiento del puntero durante «Dibujar»: tramo provisional hasta el puntero. */
  mover(p: Punto, libre: boolean): void {
    if (this.modo?.tipo !== 'dibujar' || !this.modo.puntos.length) return;
    this.a.escena.ponerTrazo(this.modo.puntos, this.ajustar(p, libre));
  }

  /** Teclas durante un modo: Intro cierra, Retroceso quita la última esquina, Esc cancela. */
  tecla(k: string): boolean {
    if (!this.modo) return false;
    if (k === 'escape') this.cancelar();
    else if (k === 'enter' && this.modo.tipo === 'dibujar') this.terminarDibujo();
    else if (k === 'backspace' && this.modo.tipo === 'dibujar') {
      this.modo.puntos.pop();
      this.a.escena.ponerTrazo(this.modo.puntos);
    } else return false;
    return true;
  }

  dobleClic(): boolean {
    if (this.modo?.tipo !== 'dibujar') return false;
    // El doble clic ya añadió dos veces el último punto: se quita el repetido.
    const ps = this.modo.puntos;
    while (ps.length >= 2 && this.casiIgual(ps[ps.length - 1]!, ps[ps.length - 2]!)) ps.pop();
    this.terminarDibujo();
    return true;
  }

  private terminarDibujo(): void {
    const m = this.modo;
    if (m?.tipo !== 'dibujar') return;
    // La última esquina sobre la primera es cerrar, no una esquina más.
    if (m.puntos.length > 3 && this.casiIgual(m.puntos[m.puntos.length - 1]!, m.puntos[0]!)) m.puntos.pop();
    if (m.puntos.length < 3) {
      this.a.aviso('Una estancia necesita al menos 3 esquinas.');
      return;
    }
    try {
      const n = plantaDe(this.a.esp()).estancias.length + 1;
      let nombre = `Estancia ${n}`;
      for (let k = n; plantaDe(this.a.esp()).estancias.some((s) => s.nombre === nombre); k++) nombre = `Estancia ${k + 1}`;
      const r = agregarEstancia(this.a.esp(), { nombre, contorno: m.puntos.map(([x, y]) => [x, y] as Punto) }, plantaActivaId(this.a.esp()));
      this.modo = null;
      this.a.escena.ponerTrazo([]);
      this.a.aplicar(r.espacio);
      this.a.elegirEstancia(r.id);
      this.a.aviso(`Añadida «${nombre}». Sus medidas están en el panel «Estancia».`);
    } catch (e) {
      this.a.aviso(`No se pudo crear la estancia: ${errorLegible((e as Error).message)}`);
    }
    this.pintar();
  }

  private async terminarCalibrado(m: Extract<Modo, { tipo: 'calibrar' }>): Promise<void> {
    const f = (plantaDe(this.a.esp()).fondos ?? []).find((x) => x.id === m.fondo);
    const [p1, p2] = m.puntos as [Punto, Punto];
    this.modo = null;
    if (!f) {
      this.a.escena.ponerTrazo([]);
      this.a.aviso('El plano que calibrabas ya no está.');
      return this.pintar();
    }
    const campo = document.createElement('label');
    campo.className = 'campo';
    campo.innerHTML = '<span>Distancia real entre los dos puntos</span><span class="entrada"><input id="d-calibrar" type="number" inputmode="decimal" min="1" step="0.5"><i>cm</i></span>';
    const distancia = await this.a.pedir('Calibrar el plano', [campo], 'Calibrar', () => Number((campo.querySelector('input') as HTMLInputElement).value));
    this.a.escena.ponerTrazo([]);
    if (distancia === null) return this.pintar();
    if (!(distancia > 0)) {
      this.a.aviso('Escribe una distancia mayor que 0 cm.');
      return this.pintar();
    }
    try {
      // Los dos puntos, en píxeles de la imagen; el primero se queda donde está en la planta.
      const a = plantaAFondo(f, p1[0], p1[1]);
      const b = plantaAFondo(f, p2[0], p2[1]);
      this.a.aplicar(calibrarFondo(this.a.esp(), f.id, a, b, distancia));
      this.a.aviso('Plano calibrado: sus medidas ya son reales. Dibuja encima las estancias con «Dibujar estancia».');
    } catch (e) {
      this.a.aviso(`No se pudo calibrar: ${(e as Error).message}`);
    }
    this.pintar();
  }

  // ---------- Asistentes de chat ----------

  private async copiarParaAgente(): Promise<void> {
    const e = this.a.esp();
    const texto = [
      `Este es mi espacio de «Espacios 3D» (formato espacios3d versión 2; medidas en cm; x a la derecha, y hacia abajo).`,
      'Si propones cambios, devuélvemelos como una lista JSON de operaciones, por ejemplo [{"op":"agregar","tipo":"cama","estancia":"dormitorio","muro":1,"desde":20}], o como el espacio entero en JSON. Las operaciones son las de «espacios3d.mjs aplicar» (agregar, mover, girar, editar, quitar, estancia-agregar, hueco-agregar, …).',
      ...(e.plantas.length > 1
        ? [`Tiene ${e.plantas.length} plantas y estoy viendo «${plantaDe(e).nombre}» (id ${plantaDe(e).id}); la imagen es de esa planta. En cada operación indica «estancia» o «planta»: las que no lo digan se aplicarán en la planta que estoy viendo.`]
        : []),
      '',
      ...describirTexto(describir(e)),
      '',
      'Archivo:',
      '```json',
      aJSON(e).trimEnd(),
      '```',
    ].join('\n');
    let conImagen = false;
    try {
      const r = planoPng(e, { planta: plantaActivaId(e) });
      const lienzo = document.createElement('canvas');
      lienzo.width = r.lienzo.ancho;
      lienzo.height = r.lienzo.alto;
      lienzo.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.lienzo.rgba), r.lienzo.ancho, r.lienzo.alto), 0, 0);
      const png = await new Promise<Blob | null>((res) => lienzo.toBlob(res, 'image/png'));
      if (png && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([texto], { type: 'text/plain' }), 'image/png': png })]);
        conImagen = true;
      }
    } catch {
      /* sin imagen: se intenta sólo el texto */
    }
    (window as unknown as { __ultimoCopiado?: string }).__ultimoCopiado = texto;
    if (conImagen) return this.a.aviso('Copiado (texto e imagen del plano). Pégalo en el chat del asistente.');
    try {
      await navigator.clipboard.writeText(texto);
      this.a.aviso('Copiado. Pégalo en el chat del asistente.');
    } catch {
      // Sin portapapeles (algunos navegadores con file://): se muestra para copiarlo a mano.
      const area = document.createElement('textarea');
      area.value = texto;
      area.readOnly = true;
      area.rows = 12;
      area.className = 'copiable';
      await this.a.pedir('Copia este texto', [area], 'Hecho', () => true);
    }
  }

  private async pegar(): Promise<void> {
    const area = document.createElement('textarea');
    area.rows = 12;
    area.className = 'copiable';
    area.placeholder = 'Pega aquí lo que te ha devuelto el asistente: una lista de cambios [{"op": …}] o un espacio entero.';
    const p = document.createElement('p');
    p.textContent = 'Los cambios se aplican todos o ninguno, y se pueden deshacer con Ctrl+Z.';
    const texto = await this.a.pedir('Pegar cambios', [p, area], 'Aplicar', () => area.value);
    if (texto === null || !texto.trim()) return;
    // Del texto del asistente se toma el último bloque ```…``` (suele ser la versión buena), o todo si no hay.
    const bloques = [...texto.matchAll(/```[^\n`]*\n?([\s\S]*?)```/g)].map((m) => m[1]!);
    const limpio = (bloques.length ? bloques[bloques.length - 1]! : texto).trim();
    let datos: unknown;
    try {
      datos = JSON.parse(limpio);
    } catch (e) {
      await this.a.informar('No es JSON válido', `No se ha cambiado nada. ${(e as Error).message}. Pide al asistente que responda sólo con el JSON.`);
      return;
    }
    // Una sola operación suelta cuenta como una lista de una.
    if (datos && typeof datos === 'object' && !Array.isArray(datos) && typeof (datos as { op?: unknown }).op === 'string') datos = [datos];
    if (Array.isArray(datos)) {
      try {
        const r = ejecutarLote(this.a.esp(), conPlantaActiva(this.a.esp(), datos));
        this.a.aplicar(r.espacio);
        this.a.aviso(`Aplicados ${datos.length} cambios (Ctrl+Z para deshacer).`);
      } catch (e) {
        await this.a.informar('No se ha aplicado nada', 'Hay un error en los cambios. Cópiaselo al asistente para que lo corrija:', [(e as Error).message]);
      }
      return;
    }
    const r = validar(datos);
    if (!r.ok) {
      await this.a.informar('El espacio pegado tiene errores', 'No se ha cambiado nada. Cópiaselos al asistente para que los corrija:', r.errores);
      return;
    }
    if (!(await this.a.confirmar('¿Sustituir el espacio?', `Lo que ves se sustituye por «${r.espacio.nombre}». Se puede deshacer con Ctrl+Z.`, 'Sustituir'))) return;
    this.a.aplicar(r.espacio);
  }
}

/** Operaciones que, sin «planta» ni «estancia», irían a la primera planta: se dirigen a la que se ve. */
const CON_PLANTA = new Set(['agregar', 'estancia-agregar', 'fondo-poner', 'escalera-agregar']);
const CON_ESTANCIA = new Set(['hueco-agregar', 'elemento-agregar', 'faldon-poner', 'faldon-quitar', 'estancia', 'estancia-contorno', 'tabique-mover']);

function conPlantaActiva(e: Espacio, ops: unknown[]): unknown[] {
  if (e.plantas.length < 2) return ops;
  const pl = plantaDe(e);
  return ops.map((o) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    const op = o as Record<string, unknown>;
    if (op.planta !== undefined || op.estancia !== undefined) return op;
    if (CON_PLANTA.has(op.op as string)) return { ...op, planta: pl.id };
    if (CON_ESTANCIA.has(op.op as string)) return { ...op, estancia: pl.estancias[0]!.id };
    return op;
  });
}

/** Mensaje del núcleo sin el prefijo técnico ni la ruta del campo («plantas[0].estancias[2].contorno: »). */
function errorLegible(m: string): string {
  return m
    .replace(/^El resultado no es válido:\s*/, '')
    .split('\n')
    .map((l) => l.replace(/^-\s*/, '').replace(/^[\w.[\]]+:\s*/, ''))
    .filter(Boolean)
    .join(' ')
    .replace(/el contorno no es una estancia válida:.*/, 'las esquinas se cruzan o se repiten: vuelve a dibujarla');
}

function nombreArchivo(nombre: string): string {
  const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'espacio';
  return `${base}.espacio.json`;
}
