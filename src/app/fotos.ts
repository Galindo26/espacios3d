// Fotos de estancias y muebles (R4-3): miniaturas en la ficha del mueble y en «Estancia», leídas de
// la carpeta de trabajo como URL de objeto (sin red); pulsar una la amplía (con «Quitar la foto»);
// «Añadir foto…» la copia a fotos/ junto al espacio. Sin carpeta de trabajo se pide abrirla, como con
// los modelos. Una foto que no está se ve como «No está».
import type { Espacio } from '../core/index.js';
import { agregarFoto, estancia as estanciaDe, quitarFoto } from '../core/index.js';
import { plantaDe } from './plantaActiva.js';
import { copiarJuntoAlEspacio, type Almacen } from './almacen.js';
import { $, $in } from './ui.js';

export interface AnfitrionFotos {
  esp(): Espacio;
  aplicar(e: Espacio): void;
  seleccion(): string | null;
  estancia(): string | null;
  almacen(): Almacen;
  aviso(texto: string): void;
  informar(titulo: string, texto: string): Promise<void>;
}

const EXTENSIONES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export class Fotos {
  /** URL de objeto de cada foto leída (null: no está), por almacén y ruta. */
  private readonly urls = new Map<string, string | null>();
  private readonly cargando = new Set<string>();
  /** A qué estancia o mueble va la foto que se elige. */
  private para: string | null = null;
  /** Foto ampliada: de quién y cuál, y qué tenía el foco al abrirla. */
  private abierta: { para: string; foto: string; volver: HTMLElement | null } | null = null;

  constructor(private readonly a: AnfitrionFotos) {
    $('b-foto-mueble').addEventListener('click', () => void this.empezar(this.a.seleccion()));
    $('b-foto-estancia').addEventListener('click', () => void this.empezar(this.idEstancia()));
    $in('f-foto').addEventListener('change', () => void this.copiar());
    $('b-foto-cerrar').addEventListener('click', () => ($('dialogo-foto') as HTMLDialogElement).close());
    $('b-foto-quitar').addEventListener('click', () => this.quitarAbierta());
    $('dialogo-foto').addEventListener('close', () => {
      const v = this.abierta?.volver;
      this.abierta = null;
      v?.focus();
    });
  }

  private idEstancia(): string {
    return estanciaDe(this.a.esp(), this.a.estancia() ?? undefined).estancia.id;
  }

  private clave(ruta: string): string {
    const alm = this.a.almacen();
    return JSON.stringify([alm.vinculacion?.() ?? 0, alm.nombreArchivo(), alm.carpeta?.() ?? null, ruta]);
  }

  private async empezar(para: string | null): Promise<void> {
    if (!para) return;
    const alm = this.a.almacen();
    if (!alm.carpeta?.()?.archivo || !alm.escribirRelativo) {
      await this.a.informar(
        'Primero, la carpeta de trabajo',
        alm.abrirCarpeta
          ? 'La foto se guarda junto al archivo del espacio (en fotos/), para que viaje con él. Pulsa «Carpeta…», elige la carpeta y abre o guarda ahí el espacio.'
          : 'Este navegador no deja trabajar con carpetas. Usa Edge o Chrome, o pídeselo a un asistente con el CLI («foto agregar»).',
      );
      return;
    }
    this.para = para;
    $in('f-foto').value = '';
    $in('f-foto').click();
  }

  private async copiar(): Promise<void> {
    const archivo = $in('f-foto').files?.[0];
    const para = this.para;
    if (!archivo || !para) return;
    const ext = EXTENSIONES[archivo.type] ?? /\.(jpe?g|png|webp)$/i.exec(archivo.name)?.[1]?.toLowerCase().replace('jpeg', 'jpg');
    if (!ext) return this.a.aviso(`«${archivo.name}» no es una foto .jpg, .png o .webp.`);
    let ruta: string;
    try {
      ruta = await copiarJuntoAlEspacio(this.a.almacen(), 'fotos', archivo.name, ext, archivo, 'foto');
    } catch (e) {
      return this.a.aviso(`No se pudo copiar la foto a la carpeta: ${(e as Error).message}`);
    }
    try {
      this.a.aplicar(agregarFoto(this.a.esp(), para, ruta));
      this.a.aviso(`Foto copiada a ${ruta}.`);
    } catch (e) {
      this.a.aviso((e as Error).message);
    }
  }

  private quitarAbierta(): void {
    const x = this.abierta;
    if (!x) return;
    // La miniatura desaparece: el foco vuelve a «Añadir foto…» de su lista (revisión independiente, 11).
    const esMueble = x.para === this.a.seleccion();
    x.volver = $(esMueble ? 'b-foto-mueble' : 'b-foto-estancia');
    ($('dialogo-foto') as HTMLDialogElement).close();
    try {
      this.a.aplicar(quitarFoto(this.a.esp(), x.para, x.foto));
      this.a.aviso(`Quitada la foto ${x.foto} (el archivo sigue en la carpeta).`);
    } catch (e) {
      this.a.aviso((e as Error).message);
    }
  }

  private abrir(para: string, foto: string, boton: HTMLElement): void {
    const url = this.urls.get(this.clave(foto));
    const img = $('foto-grande') as HTMLImageElement;
    img.hidden = !url;
    if (url) img.src = url;
    img.alt = `Foto ${foto}`;
    $('foto-ruta').textContent = url ? foto : this.urls.has(this.clave(foto)) ? `${foto}: no está junto al archivo.` : `${foto}: cargando…`;
    this.abierta = { para, foto, volver: boton };
    ($('dialogo-foto') as HTMLDialogElement).showModal();
  }

  /** Cuándo se vio que faltaba cada foto: se vuelve a mirar pasados 5 s (por si la copian después). */
  private readonly faltaDesde = new Map<string, number>();

  /** Lee la foto de la carpeta (una vez) y repinta al tenerla. */
  private cargar(ruta: string): void {
    const k = this.clave(ruta);
    if (this.urls.get(k) === null && Date.now() - (this.faltaDesde.get(k) ?? 0) > 5000) this.urls.delete(k);
    if (this.urls.has(k) || this.cargando.has(k)) return;
    this.cargando.add(k);
    void (async () => {
      let url: string | null = null;
      try {
        const blob = (await this.a.almacen().leerRelativo?.(ruta)) ?? null;
        url = blob ? URL.createObjectURL(blob) : null;
      } catch {
        url = null;
      }
      this.cargando.delete(k);
      this.urls.set(k, url);
      if (!url) this.faltaDesde.set(k, Date.now());
      this.pintar();
    })();
  }

  private lista(ul: HTMLElement, para: string | null, fotos: readonly string[]): void {
    const firma = JSON.stringify([para, fotos, fotos.map((f) => this.urls.get(this.clave(f)) ?? (this.urls.has(this.clave(f)) ? 'no' : 'cargando'))]);
    if (ul.dataset.firma === firma) return;
    ul.dataset.firma = firma;
    ul.replaceChildren(
      ...fotos.map((f) => {
        this.cargar(f);
        const k = this.clave(f);
        const url = this.urls.get(k);
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'miniatura';
        b.title = f;
        b.dataset.foto = f;
        if (url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = `Foto ${f}`;
          b.append(img);
        } else b.textContent = this.urls.has(k) ? 'No está' : 'Cargando…';
        b.addEventListener('click', () => para && this.abrir(para, f, b));
        li.append(b);
        return li;
      }),
    );
  }

  pintar(): void {
    const e = this.a.esp();
    const sel = this.a.seleccion();
    const m = sel ? plantaDe(e).muebles.find((x) => x.id === sel) : undefined;
    this.lista($('fotos-mueble'), m?.id ?? null, m?.fotos ?? []);
    const s = estanciaDe(e, this.a.estancia() ?? undefined).estancia;
    this.lista($('fotos-estancia'), s.id, s.fotos ?? []);
  }

  /** Para las pruebas: estado de las miniaturas de una lista. */
  estado(lista: 'mueble' | 'estancia'): { foto: string; imagen: boolean }[] {
    return [...$(`fotos-${lista}`).querySelectorAll<HTMLButtonElement>('button.miniatura')].map((b) => ({ foto: b.dataset.foto ?? '', imagen: !!b.querySelector('img') }));
  }
}
