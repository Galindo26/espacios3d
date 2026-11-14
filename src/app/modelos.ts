// R2-6 en la página: modelos 3D propios (.glb) de los muebles y «Mis muebles».
// - Un mueble puede llevar un modelo .glb de la carpeta de trabajo. Se carga desde la carpeta y se
//   dibuja en lugar de su forma; si falta o no se puede leer (Draco, meshopt, KTX2…), se ve la forma
//   genérica (o sus piezas) y se avisa. Las colisiones usan siempre las medidas del mueble.
// - «Mis muebles» (mis-muebles.json junto al espacio) guarda muebles para usarlos en otros espacios.
import { comprobarGlb } from './glbEntrada.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { DatosMueble, Espacio, MisMuebles, Mueble, MuebleGuardado } from '../core/index.js';
import { plantaDe } from './plantaActiva.js';
import {
  ARCHIVO_MIS_MUEBLES, editarMueble, guardadoDeMueble, guardarEnMisMuebles, misMueblesAJSON, misMueblesVacio,
  quitarDeMisMuebles, tipoMueble, validarMisMuebles,
} from '../core/index.js';
import { copiarJuntoAlEspacio, type Almacen } from './almacen.js';
import type { Escena } from './escena.js';
import { $, $in } from './ui.js';

export interface AnfitrionModelos {
  esp(): Espacio;
  aplicar(e: Espacio): void;
  seleccion(): string | null;
  almacen(): Almacen;
  escena: Escena;
  aviso(texto: string): void;
  informar(titulo: string, texto: string, lista?: string[]): Promise<boolean>;
  confirmar(titulo: string, texto: string, aceptar: string): Promise<boolean>;
  pedir<T>(titulo: string, nodos: Node[], aceptar: string, leer: () => T): Promise<T | null>;
  agregar(datos: DatosMueble): void;
  /** Vuelve a pintar la escena (un modelo terminó de cargarse). */
  repintar(): void;
}

export { comprobarGlb };

type EstadoModelo = THREE.Object3D | 'cargando' | 'falta' | { error: string };

/** Libera la geometría, los materiales y las texturas de un modelo cargado. */
function soltar(x: THREE.Object3D): void {
  x.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of ([] as THREE.Material[]).concat((m.material as THREE.Material | THREE.Material[] | undefined) ?? [])) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

async function leerModelo(buf: ArrayBuffer): Promise<THREE.Object3D> {
  const { raras, externas } = comprobarGlb(buf);
  if (raras.length) throw new Error(`usa compresión ${raras.join(' y ')}, que la herramienta no lee: expórtalo sin compresión`);
  // La herramienta no hace ninguna petición de red: un .glb tiene que llevarlo todo dentro.
  if (externas.length) throw new Error(`pide archivos de fuera (${externas.slice(0, 2).join(', ')}): expórtalo como .glb con todo incluido`);
  // Y, por si acaso, el cargador sólo puede abrir lo que ya está en memoria (blob: y data:).
  const gestor = new THREE.LoadingManager();
  gestor.setURLModifier((url) => (/^(blob|data):/i.test(url) ? url : 'data:,'));
  const gltf = await new GLTFLoader(gestor).parseAsync(buf, '');
  const raiz = gltf.scene;
  let mallas = 0;
  raiz.traverse((o) => {
    if (o instanceof THREE.Mesh) mallas++;
  });
  if (!mallas) throw new Error('no tiene ninguna malla');
  raiz.updateMatrixWorld(true);
  return raiz;
}

const cm = (n: number): string => String(Math.round(n * 10) / 10).replace('.', ',');

export class Modelos {
  private readonly cache = new Map<string, EstadoModelo>();
  /** Cuándo se comprobó por última vez cada modelo y con qué tamaño y fecha (para recargarlo si cambia). */
  private readonly revisado = new Map<string, { firma: string | null; cuando: number }>();
  private readonly avisados = new Set<string>();
  private vinculacion = -1;
  private mios: MisMuebles = misMueblesVacio();
  /** Clave de la carpeta de la que se leyó «Mis muebles» (null: aún no se ha leído). */
  private miosDe: string | null = null;
  private miosError: string | null = null;

  constructor(private readonly a: AnfitrionModelos) {
    a.escena.fuenteModelos = (archivo) => {
      const x = this.cache.get(this.clave(archivo));
      return x instanceof THREE.Object3D ? x : null;
    };
    $('m-modelo').addEventListener('click', () => void this.empezarPonerModelo());
    $in('f-modelo').addEventListener('change', () => void this.ponerModelo());
    $('m-modelo-quitar').addEventListener('click', () => this.cambiarModelo(null));
    $('m-modelo-medidas').addEventListener('click', () => this.medidasDelModelo());
    ($('m-ajuste') as HTMLSelectElement).addEventListener('change', () => {
      const m = this.mueble();
      if (m?.modelo) this.cambiarModelo({ ...m.modelo, ajuste: ($('m-ajuste') as HTMLSelectElement).value === 'modelo' ? 'modelo' : 'medidas' });
    });
    $in('m-giro-modelo').addEventListener('change', () => {
      const m = this.mueble();
      const g = Number($in('m-giro-modelo').value);
      if (m?.modelo && Number.isFinite(g)) this.cambiarModelo({ ...m.modelo, giro: g });
    });
    $('m-guardar-mio').addEventListener('click', () => void this.guardarMio());
  }

  /** Igual que los fondos: la misma ruta es otro archivo en otro espacio o en otra carpeta. */
  private clave(ruta: string): string {
    const alm = this.a.almacen();
    return JSON.stringify([alm.vinculacion?.() ?? 0, alm.nombreArchivo(), alm.carpeta?.() ?? null, ruta]);
  }

  /** Al vincular otro archivo, los modelos cargados del anterior se liberan. */
  private soltarCache(): void {
    for (const x of this.cache.values()) if (x instanceof THREE.Object3D) soltar(x);
    this.cache.clear();
    this.revisado.clear();
  }

  private mueble(): Mueble | null {
    const id = this.a.seleccion();
    return (id && plantaDe(this.a.esp()).muebles.find((x) => x.id === id)) || null;
  }

  /** Tras cada cambio: carga los modelos que falten, pinta la ficha y «Mis muebles». */
  pintar(): void {
    const gen = this.a.almacen().vinculacion?.() ?? 0;
    if (gen !== this.vinculacion) {
      this.vinculacion = gen;
      this.soltarCache();
    }
    const ahora = performance.now();
    for (const p of this.a.esp().plantas) {
      for (const m of p.muebles) {
        if (!m.modelo) continue;
        const k = this.clave(m.modelo.archivo);
        if (!this.cache.has(k)) void this.cargar(m.modelo.archivo);
        // Cada pocos segundos se mira si el archivo ha aparecido o ha cambiado (un agente lo ha puesto
        // o sustituido): entonces se vuelve a cargar.
        else if (this.cache.get(k) !== 'cargando' && ahora - (this.revisado.get(k)?.cuando ?? 0) > 3000) void this.revisar(m.modelo.archivo);
      }
    }
    this.pintarFicha();
    const carpeta = this.clave('');
    if (this.a.almacen().carpeta?.()?.archivo && this.miosDe !== carpeta) {
      this.miosDe = carpeta;
      void this.leerMios();
    }
    this.pintarMios();
  }

  private static firma(blob: Blob | null): string | null {
    return blob ? `${blob.size}:${(blob as File).lastModified ?? ''}` : null;
  }

  private async revisar(archivo: string): Promise<void> {
    const k = this.clave(archivo);
    const antes = this.revisado.get(k);
    this.revisado.set(k, { firma: antes?.firma ?? null, cuando: performance.now() });
    let blob: Blob | null;
    try {
      blob = (await this.a.almacen().leerRelativo?.(archivo)) ?? null;
    } catch {
      return; // fallo pasajero: se mira otra vez más tarde
    }
    if (Modelos.firma(blob) !== (antes?.firma ?? null) && this.clave(archivo) === k) {
      const viejo = this.cache.get(k);
      this.cache.delete(k);
      if (viejo instanceof THREE.Object3D) soltar(viejo);
      void this.cargar(archivo);
    }
  }

  private async cargar(archivo: string): Promise<void> {
    const k = this.clave(archivo);
    this.cache.set(k, 'cargando');
    let estado: EstadoModelo;
    let blob: Blob | null = null;
    try {
      blob = (await this.a.almacen().leerRelativo?.(archivo)) ?? null;
    } catch {
      blob = null;
    }
    this.revisado.set(k, { firma: Modelos.firma(blob), cuando: performance.now() });
    if (!blob) estado = 'falta';
    else {
      try {
        estado = await leerModelo(await blob.arrayBuffer());
      } catch (e) {
        estado = { error: (e as Error).message };
      }
    }
    if (this.clave(archivo) !== k) {
      // Se vinculó otro archivo mientras se leía: esta carga no vale; al repintar se pide la buena.
      this.cache.delete(k);
      this.a.repintar();
      return;
    }
    this.cache.set(k, estado);
    const aviso = `${k}|${this.revisado.get(k)?.firma ?? ''}`;
    if (!(estado instanceof THREE.Object3D) && !this.avisados.has(aviso)) {
      this.avisados.add(aviso);
      this.a.aviso(
        estado === 'falta'
          ? `No se encuentra ${archivo} junto al archivo: se ve la forma genérica.${this.a.almacen().carpeta?.() ? '' : ' Abre su carpeta con «Carpeta…».'}`
          : `${archivo} no se puede usar (${(estado as { error: string }).error}): se ve la forma genérica.`,
      );
    }
    this.a.repintar();
  }

  private pintarFicha(): void {
    const m = this.mueble();
    if (!m) return;
    const texto = $('m-forma-texto');
    const estado = m.modelo ? this.cache.get(this.clave(m.modelo.archivo)) : undefined;
    const listo = estado instanceof THREE.Object3D;
    if (m.modelo) {
      const a = m.modelo.archivo;
      if (listo) {
        const t = this.tamanoModelo(m);
        const raro = t && (Math.max(...t) > 3000 ? ' ¿Está en centímetros o milímetros? glTF va en metros.' : Math.max(...t) < 1 ? ' ¿Está en metros divididos? Es diminuto.' : '');
        texto.textContent = `Modelo ${a}${t ? ` (a su tamaño, ${cm(t[0])} × ${cm(t[1])} × ${cm(t[2])} cm)` : ''}.${raro || ''}`;
      } else if (estado === 'cargando' || estado === undefined) texto.textContent = `Cargando ${a}…`;
      else if (estado === 'falta') texto.textContent = `No se encuentra ${a} junto al archivo: se ve la forma ${m.piezas?.length ? 'de sus piezas' : 'genérica'}.`;
      else texto.textContent = `${a} no se puede usar (${estado.error}): se ve la forma ${m.piezas?.length ? 'de sus piezas' : 'genérica'}.`;
    } else if (m.piezas?.length) texto.textContent = `Hecho de ${m.piezas.length} piezas. Puedes ponerle un modelo 3D (.glb) propio.`;
    else texto.textContent = `Forma genérica de «${tipoMueble(m.tipo).etiqueta}». Puedes ponerle un modelo 3D (.glb) propio.`;
    $('m-modelo-campos').hidden = !m.modelo;
    $('m-modelo-quitar').hidden = !m.modelo;
    $('m-modelo-medidas').hidden = !listo;
    $('m-modelo').textContent = m.modelo ? 'Cambiar modelo…' : 'Modelo 3D…';
    if (m.modelo) {
      ($('m-ajuste') as HTMLSelectElement).value = m.modelo.ajuste;
      if (document.activeElement !== $in('m-giro-modelo')) $in('m-giro-modelo').value = String(m.modelo.giro);
    }
  }

  /** Tamaño del modelo ya girado (cm: ancho, fondo, alto), o null si no está cargado. */
  private tamanoModelo(m: Mueble): [number, number, number] | null {
    const obj = m.modelo && this.cache.get(this.clave(m.modelo.archivo));
    if (!m.modelo || !(obj instanceof THREE.Object3D)) return null;
    const g = new THREE.Group();
    g.rotation.y = (-m.modelo.giro * Math.PI) / 180;
    g.add(obj.clone(false).copy(obj, true));
    const t = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    return [t.x * 100, t.z * 100, t.y * 100];
  }

  private cambiarModelo(modelo: Mueble['modelo'] | null, id = this.mueble()?.id): void {
    if (!id) return;
    try {
      this.a.aplicar(editarMueble(this.a.esp(), id, { modelo: modelo ?? undefined }));
    } catch (e) {
      this.a.aviso((e as Error).message);
    }
  }

  /** «Medidas del modelo»: el mueble toma el tamaño real del modelo (para que choque como se ve). */
  private medidasDelModelo(): void {
    const m = this.mueble();
    const t = m && this.tamanoModelo(m);
    if (!m || !t) return;
    const r = (n: number): number => Math.max(1, Math.round(n));
    try {
      const alto = r(t[2]);
      this.a.aplicar(editarMueble(this.a.esp(), m.id, { ancho: r(t[0]), fondo: r(t[1]), alto, huecoInferior: Math.min(m.huecoInferior, alto - 1), modelo: { ...m.modelo!, ajuste: 'modelo' } }));
    } catch (e) {
      this.a.aviso(
        m.piezas?.length && /piezas/.test((e as Error).message)
          ? `Sus piezas no caben en ${r(t[0])} × ${r(t[1])} × ${r(t[2])} cm: el modelo se queda estirado a las medidas del mueble.`
          : (e as Error).message,
      );
    }
  }

  private async exigirCarpeta(que: string): Promise<boolean> {
    if (this.a.almacen().carpeta?.()?.archivo) return true;
    await this.a.informar(
      'Primero, la carpeta de trabajo',
      this.a.almacen().abrirCarpeta
        ? `${que} se guarda junto al archivo del espacio, para que viaje con él. Pulsa «Carpeta…», elige la carpeta y abre o guarda ahí el espacio.`
        : `Este navegador no deja trabajar con carpetas. Usa Edge o Chrome, o hazlo con un asistente (el CLI).`,
    );
    return false;
  }

  private async empezarPonerModelo(): Promise<void> {
    if (!(await this.exigirCarpeta('El modelo'))) return;
    $in('f-modelo').value = '';
    $in('f-modelo').click();
  }

  private async ponerModelo(): Promise<void> {
    const archivo = $in('f-modelo').files?.[0];
    const m = this.mueble();
    if (!archivo || !m) return;
    let obj: THREE.Object3D;
    try {
      obj = await leerModelo(await archivo.arrayBuffer());
    } catch (e) {
      return this.a.aviso(`«${archivo.name}» no se puede usar: ${(e as Error).message}.`);
    }
    let ruta: string;
    try {
      ruta = await copiarJuntoAlEspacio(this.a.almacen(), 'modelos', archivo.name, 'glb', archivo, 'modelo');
    } catch (e) {
      return this.a.aviso(`No se pudo copiar el modelo a la carpeta: ${(e as Error).message}`);
    }
    this.cache.set(this.clave(ruta), obj);
    this.cambiarModelo({ archivo: ruta, giro: m.modelo?.giro ?? 0, ajuste: m.modelo?.ajuste ?? 'medidas' }, m.id);
    this.a.aviso(`Modelo copiado a ${ruta}. «A las medidas» lo estira al mueble; «Medidas del modelo» hace lo contrario.`);
  }

  // ---------- Mis muebles ----------

  private async leerMios(): Promise<void> {
    const clave = this.miosDe;
    let lista = misMueblesVacio();
    let error: string | null = null;
    try {
      const blob = await this.a.almacen().leerRelativo?.(ARCHIVO_MIS_MUEBLES);
      if (blob) {
        const r = validarMisMuebles(JSON.parse(await blob.text()));
        if (r.ok) lista = r.misMuebles;
        else error = `${ARCHIVO_MIS_MUEBLES} tiene errores: ${r.errores.slice(0, 3).join('; ')}`;
      }
    } catch (e) {
      error = `${ARCHIVO_MIS_MUEBLES} no se puede leer: ${(e as Error).message}`;
    }
    if (clave !== this.miosDe) return; // cambió la carpeta mientras se leía
    this.mios = lista;
    this.miosError = error;
    this.pintarMios();
  }

  private pintarMios(): void {
    const conCarpeta = !!this.a.almacen().carpeta?.()?.archivo;
    const ul = $('lista-mios');
    const lista = conCarpeta && !this.miosError ? this.mios.muebles : [];
    $('contador-mios').textContent = lista.length ? String(lista.length) : '';
    const ayuda = $('ayuda-mios');
    ayuda.textContent = !conCarpeta
      ? 'Para guardar tus muebles y usarlos en otros espacios, trabaja en una carpeta («Carpeta…»).'
      : this.miosError
        ? `${this.miosError}. No se guarda nada encima hasta que se corrija.`
        : lista.length
          ? ''
          : 'Guarda aquí un mueble desde su ficha («Guardar en Mis muebles») para usarlo en otros espacios de esta carpeta.';
    ayuda.hidden = !ayuda.textContent;
    ayuda.classList.toggle('error', !!this.miosError);
    ul.replaceChildren(
      ...lista.map((g) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mio';
        b.dataset.mio = g.nombre;
        b.title = `Añadir «${g.nombre}»`;
        const n = document.createElement('span');
        n.textContent = g.nombre;
        const d = document.createElement('span');
        d.className = 'medida';
        d.textContent = `${cm(g.ancho)}×${cm(g.fondo)}${g.modelo ? ' · modelo' : g.piezas?.length ? ' · piezas' : ''}`;
        b.append(n, d);
        b.addEventListener('click', () => this.usarMio(g));
        const q = document.createElement('button');
        q.type = 'button';
        q.className = 'quitar';
        q.textContent = '×';
        q.title = `Quitar «${g.nombre}» de Mis muebles`;
        q.setAttribute('aria-label', `Quitar «${g.nombre}» de Mis muebles`);
        q.addEventListener('click', () => void this.quitarMio(g.nombre));
        li.append(b, q);
        return li;
      }),
    );
  }

  private usarMio(g: MuebleGuardado): void {
    const { tipo, ...resto } = g;
    this.a.agregar({ tipo, ...resto });
  }

  private async escribirMios(lista: MisMuebles): Promise<boolean> {
    const v = validarMisMuebles(lista);
    if (!v.ok) {
      this.a.aviso(`No se guardó: ${v.errores[0]}`);
      return false;
    }
    try {
      await this.a.almacen().escribirRelativo!(ARCHIVO_MIS_MUEBLES, new Blob([misMueblesAJSON(v.misMuebles)], { type: 'application/json' }));
    } catch (e) {
      this.a.aviso(`No se pudo guardar ${ARCHIVO_MIS_MUEBLES}: ${(e as Error).message}`);
      return false;
    }
    this.mios = v.misMuebles;
    this.pintarMios();
    return true;
  }

  private async guardarMio(): Promise<void> {
    const m = this.mueble();
    if (!m || !(await this.exigirCarpeta('«Mis muebles»'))) return;
    await this.leerMios();
    if (this.miosError) return this.a.aviso(`${this.miosError}. Corrígelo antes de guardar.`);
    const campo = document.createElement('input');
    campo.type = 'text';
    campo.maxLength = 60;
    campo.value = m.nombre;
    campo.id = 'mio-nombre';
    const l = document.createElement('label');
    l.className = 'campo';
    const s = document.createElement('span');
    s.textContent = 'Nombre en Mis muebles';
    const e = document.createElement('span');
    e.className = 'entrada';
    e.append(campo);
    l.append(s, e);
    const nombre = (await this.a.pedir('Guardar en Mis muebles', [l], 'Guardar', () => campo.value.trim()))?.trim();
    if (!nombre) return;
    // Se relee justo antes de escribir: otro agente o el CLI pueden haberlo cambiado con el diálogo abierto.
    await this.leerMios();
    if (this.miosError) return this.a.aviso(`${this.miosError}. Corrígelo antes de guardar.`);
    if (this.mios.muebles.some((x) => x.nombre === nombre) && !(await this.a.confirmar(`¿Sustituir «${nombre}»?`, 'Ya hay un mueble con ese nombre en Mis muebles; se sustituirá por este.', 'Sustituir'))) return;
    if (await this.escribirMios(guardarEnMisMuebles(this.mios, guardadoDeMueble(m, nombre)))) this.a.aviso(`«${nombre}» guardado en Mis muebles (${ARCHIVO_MIS_MUEBLES}).`);
  }

  private async quitarMio(nombre: string): Promise<void> {
    if (!(await this.a.confirmar(`¿Quitar «${nombre}» de Mis muebles?`, 'Los espacios que ya lo usan no cambian.', 'Quitar de Mis muebles'))) return;
    await this.leerMios();
    if (this.miosError) return this.a.aviso(`${this.miosError}. Corrígelo antes de quitar nada.`);
    if (await this.escribirMios(quitarDeMisMuebles(this.mios, nombre))) this.a.aviso(`«${nombre}» quitado de Mis muebles.`);
  }
}
