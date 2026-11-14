// Escena three.js: estancia, muebles, cotas y guías; vista en planta (ortográfica) y 3D.
// Unidades: 1 unidad = 1 m. Toda conversión planta→three pasa por aTres() y rotacionY().
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as clonarConEsqueleto } from 'three/addons/utils/SkeletonUtils.js';
import type { Cota, Espacio, Estancia, Fondo, Guia, HuecoEnMuro, Mueble, PoligonoConAgujeros, Punto } from '../core/index.js';
import { plantaDe } from './plantaActiva.js';
import { aTres, cajaContorno, diferencia, ErrorGeometria, estancia as estanciaDe, contornoExterior, distancia, geometriaHueco, huellaElemento, huellaHueco, tipoNormal, modeloPlanta, muro, puntoEnElMuro, rangoAltura, normalInterior, rotacionY, union, piezasDe, llevaMarcaDeFrente, oscurecer, COLOR_CLARO, alturaEnEscalera, alturaEscalera, ejeEscalera, escalerasQueLlegan, geometriaDe, geometriaPieza, huecosDePlanta, lineasPeldanos, piezasEscalera, piezasHueco, sueloConHuecos, mallaPieza, forjadoDePlanta, circuloDeGiro, CIRCULO_GIRO, colorSuelo, mallaCuadros, revestimientoPorMuro, type ModeloPlanta } from '../core/index.js';
import { texturaSuelo } from './texturas.js';
import { mallaCuna, mallaPrismaConAgujeros, type GeometriaGLB } from '../core/glb.js';

export type Vista = 'plano' | '3d';

const CM = 0.01;
const COLOR_CINTA = 0xe3a812;
const COLOR_ERROR = 0xc0392b;

interface Visual {
  grupo: THREE.Group;
  firma: string;
  huella: THREE.Mesh;
  marco: THREE.LineSegments;
  etiqueta: CSS2DObject;
  cuerpo: THREE.Mesh[];
  /** ¿Se ve con su modelo .glb propio (y no con su forma de reserva)? */
  conModelo: boolean;
}

interface MuroVisual {
  malla: THREE.Object3D;
  normal: Punto;
  medio: Punto;
}

/** Edición del contorno en planta: asas en las esquinas y hueco resaltado. */
export interface EstadoEdicion {
  editando: boolean;
  vertice: number | null;
  hueco: string | null;
  /** Estancia seleccionada: sus paredes, esquinas y huecos son los que se editan (null = la primera). */
  estancia: string | null;
}

function liberar(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o.userData.compartido) return; // modelo de la caché: lo libera quien lo cargó
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
    if (o instanceof CSS2DObject) o.element.remove();
  });
}

/** Malla del núcleo (metros, y arriba) como geometría de three. */
function aBuffer(g: GeometriaGLB): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.posiciones, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normales, 3));
  geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
  return geo;
}

/** Forma de three (en el plano XY, con y invertida como los suelos) de un polígono con agujeros. */
function formaConAgujeros(exterior: readonly Punto[], agujeros: readonly (readonly Punto[])[]): THREE.Shape {
  const f = new THREE.Shape(exterior.map(([x, y]) => new THREE.Vector2(x * CM, -y * CM)));
  for (const h of agujeros) f.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x * CM, -y * CM))));
  return f;
}

/** Prisma vertical sobre un cuadrilátero de planta (cm), de y0 a y1 (cm). Grupo 0: lados; grupo 1: tapa superior. */
function prisma(base: Punto[], y0: number, y1: number): THREE.BufferGeometry {
  const v = (p: Punto, y: number): number[] => {
    const t = aTres(p[0], p[1]);
    return [t.X, y * CM, t.Z];
  };
  const lados: number[] = [];
  for (let i = 0; i < base.length; i++) {
    const a = base[i] as Punto;
    const b = base[(i + 1) % base.length] as Punto;
    lados.push(...v(a, y0), ...v(b, y0), ...v(b, y1), ...v(a, y0), ...v(b, y1), ...v(a, y1));
  }
  const tapa: number[] = [];
  for (let i = 1; i < base.length - 1; i++) tapa.push(...v(base[0] as Punto, y1), ...v(base[i] as Punto, y1), ...v(base[i + 1] as Punto, y1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...lados, ...tapa], 3));
  g.addGroup(0, lados.length / 3, 0);
  g.addGroup(lados.length / 3, tapa.length / 3, 1);
  g.computeVertexNormals();
  return g;
}

/** Prisma vertical sobre un polígono con agujeros (cóncavo o no): lados y tapa superior. */
function prismaPoligono(pol: PoligonoConAgujeros, y0: number, y1: number): THREE.BufferGeometry {
  const v = (p: Punto, y: number): number[] => {
    const t = aTres(p[0], p[1]);
    return [t.X, y * CM, t.Z];
  };
  const lados: number[] = [];
  for (const anillo of [pol.exterior, ...pol.agujeros]) {
    for (let i = 0; i < anillo.length; i++) {
      const a = anillo[i] as Punto;
      const b = anillo[(i + 1) % anillo.length] as Punto;
      lados.push(...v(a, y0), ...v(b, y0), ...v(b, y1), ...v(a, y0), ...v(b, y1), ...v(a, y1));
    }
  }
  const aV2 = (r: readonly Punto[]): THREE.Vector2[] => r.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(aV2(pol.exterior), pol.agujeros.map(aV2));
  const todos = [...pol.exterior, ...pol.agujeros.flat()];
  const tapa: number[] = [];
  for (const [a, b, c] of tris) tapa.push(...v(todos[a as number] as Punto, y1), ...v(todos[b as number] as Punto, y1), ...v(todos[c as number] as Punto, y1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...lados, ...tapa], 3));
  g.addGroup(0, lados.length / 3, 0);
  g.addGroup(lados.length / 3, tapa.length / 3, 1);
  g.computeVertexNormals();
  return g;
}

export class Escena {
  readonly lienzo: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  private readonly etiquetas: CSS2DRenderer;
  private readonly escena = new THREE.Scene();
  private readonly camPersp = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  private readonly camOrto = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  private readonly ctrlPersp: OrbitControls;
  private readonly ctrlOrto: OrbitControls;
  private readonly luz = new THREE.DirectionalLight(0xffffff, 1.6);
  private readonly grupoEstancia = new THREE.Group();
  private readonly grupoMuebles = new THREE.Group();
  /** Muebles elegidos además del principal (selección múltiple): se ven seleccionados. */
  grupo: ReadonlySet<string> = new Set();
  /** Modelos .glb propios ya cargados, por ruta (los pone la página); null si no está o falta. */
  fuenteModelos: ((archivo: string) => THREE.Object3D | null) | null = null;
  private readonly grupoAyudas = new THREE.Group();
  /** Planos de fondo (calco) y trazo de «Dibujar estancia»: no se borran con las cotas. */
  private readonly grupoFondos = new THREE.Group();
  private readonly grupoTrazo = new THREE.Group();
  private firmaFondos = '';
  private cajaEstancias = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  /** Esquinas de los planos de fondo (cm): el encuadre los incluye para poder calcarlos. */
  private esquinasFondos: Punto[] = [];
  private readonly visuales = new Map<string, Visual>();
  private muros: MuroVisual[] = [];
  private huellasMuro: THREE.Object3D | null = null;
  private etiquetasMuro: CSS2DObject[] = [];
  private asas: THREE.Mesh[] = [];
  private zonasHueco: THREE.Mesh[] = [];
  private edicion: EstadoEdicion = { editando: false, vertice: null, hueco: null, estancia: null };
  private suelos: THREE.Mesh[] = [];
  /** Techos planos de las estancias: sólo se ven al recorrer. */
  private techosPlanos: THREE.Mesh[] = [];
  /** Planos del techo inclinado: sólo se ven en 3D. */
  private techos: THREE.Mesh[] = [];
  private rejilla: THREE.Object3D | null = null;
  private firmaEstancia = '';
  private readonly raycaster = new THREE.Raycaster();
  private pendiente = true;
  vista: Vista = 'plano';
  private caja = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  constructor(lienzo: HTMLElement) {
    this.lienzo = lienzo;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Vista del espacio: arrastra los muebles para moverlos');
    this.renderer.domElement.tabIndex = 0;
    lienzo.prepend(this.renderer.domElement);

    this.etiquetas = new CSS2DRenderer();
    this.etiquetas.domElement.className = 'capa-etiquetas';
    lienzo.append(this.etiquetas.domElement);

    this.escena.add(this.grupoEstancia, this.grupoMuebles, this.grupoAyudas, this.grupoFondos, this.grupoTrazo);
    this.escena.add(new THREE.HemisphereLight(0xffffff, 0xd8cfc2, 2.1));
    this.luz.castShadow = true;
    this.luz.shadow.mapSize.set(2048, 2048);
    this.luz.shadow.bias = -0.0005;
    this.luz.shadow.normalBias = 0.02;
    this.escena.add(this.luz, this.luz.target);

    this.camOrto.up.set(0, 0, -1);
    this.ctrlPersp = new OrbitControls(this.camPersp, this.renderer.domElement);
    this.ctrlPersp.maxPolarAngle = Math.PI / 2 - 0.05;
    this.ctrlPersp.minDistance = 0.5;
    this.ctrlPersp.maxDistance = 60;
    this.ctrlOrto = new OrbitControls(this.camOrto, this.renderer.domElement);
    this.ctrlOrto.enableRotate = false;
    this.ctrlOrto.screenSpacePanning = true;
    this.ctrlOrto.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.ctrlOrto.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.ctrlOrto.minZoom = 0.2;
    this.ctrlOrto.maxZoom = 12;
    for (const c of [this.ctrlPersp, this.ctrlOrto]) c.addEventListener('change', () => this.pedirRender());
    this.ponerVista('plano');

    this.aplicarTema();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.aplicarTema());
    new ResizeObserver(() => this.ajustarTamano()).observe(lienzo);
    this.ajustarTamano();
    const bucle = (): void => {
      if (this.pendiente) {
        this.pendiente = false;
        this.dibujar();
      }
      requestAnimationFrame(bucle);
    };
    requestAnimationFrame(bucle);
  }

  private aplicarTema(): void {
    const fondo = getComputedStyle(document.documentElement).getPropertyValue('--fondo').trim() || '#f4f1ec';
    this.escena.background = new THREE.Color(fondo);
    this.pedirRender();
  }

  pedirRender(): void {
    this.pendiente = true;
  }

  // ---------- Recorrido en primera persona (R2-5) ----------

  /** Primera persona: la cámara 3D va a los ojos de quien recorre y los controles orbitales se apagan. */
  recorriendo = false;
  private camaraAntes: { pos: THREE.Vector3; objetivo: THREE.Vector3; fov: number } | null = null;

  empezarRecorrido(): void {
    if (this.recorriendo) return;
    this.camaraAntes = { pos: this.camPersp.position.clone(), objetivo: this.ctrlPersp.target.clone(), fov: this.camPersp.fov };
    this.recorriendo = true;
    // A la altura de los ojos y cerca de las paredes, un campo de visión más ancho (como una persona).
    this.camPersp.fov = 75;
    this.camPersp.updateProjectionMatrix();
    for (const t of this.techosPlanos) t.visible = true;
    this.ctrlPersp.enabled = false;
    this.actualizarCorte();
    this.ponerOtrasPlantas();
    this.pedirRender();
  }

  // ---------- Las demás plantas (R3-2): al recorrer y en «Casa entera» ----------

  /** «Casa entera»: en 3D se ven todas las plantas, las de encima de la activa en transparente. */
  casaEntera = false;
  private readonly grupoOtras = new THREE.Group();
  /** Plantas reconstruidas desde que se abrió la página (para las pruebas). */
  private reconstruidas = 0;
  private readonly cacheOtras = new Map<string, { firma: string; grupo: THREE.Group; fantasmas: THREE.Material[] }>();
  private otras: string[] = [];
  private ultimoEspacio: Espacio | null = null;
  /** Altura (cm, relativa a la activa) de lo más bajo y lo más alto que se dibuja: para encuadrar la casa. */
  private alturaCasa: [number, number] = [0, 0];

  /** Qué se dibuja además de la planta activa: nada, todas (al recorrer) o todas con transparencia (casa entera). */
  private modoOtras(): 'ninguna' | 'recorrido' | 'casa' {
    if (this.recorriendo) return 'recorrido';
    return this.casaEntera && this.vista === '3d' ? 'casa' : 'ninguna';
  }

  /**
   * Dibuja las demás plantas a su altura con las mismas mallas que el .glb (muros, suelos con sus
   * huecos, forjados, obra no; muebles con su modelo si está cargado, escaleras y huecos). En «Casa
   * entera», las que están encima de la activa van en transparente para poder ver y editar la activa.
   */
  private ponerOtrasPlantas(): void {
    const espacio = this.ultimoEspacio;
    const modo = this.modoOtras();
    const activa = espacio ? plantaDe(espacio) : null;
    const activo = !!espacio && !!activa && modo !== 'ninguna' && espacio.plantas.length > 1;
    if (!this.grupoOtras.parent) this.escena.add(this.grupoOtras);
    // Cada planta se reconstruye sólo si cambia lo que la dibuja: ella, su posición respecto a la activa,
    // si va en transparente, las escaleras que llegan, los niveles y alturas (forjados y huecos) y los
    // modelos cargados (revisión independiente de la ronda 3, 9: antes se rehacía la casa en cada cambio).
    const vivas = new Set<string>();
    if (activo && espacio && activa) {
      const matMuro = (): THREE.Material => new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.9 });
      const matSuelo = (): THREE.Material => new THREE.MeshStandardMaterial({ color: 0xe8e1d5, roughness: 0.95 });
      const matPeldano = (): THREE.Material => new THREE.MeshStandardMaterial({ color: 0xd9d2c5, roughness: 0.85 });
      const matBarandilla = (): THREE.Material => new THREE.MeshStandardMaterial({ color: 0x5b6670, roughness: 0.5 });
      const matForjado = (): THREE.Material => new THREE.MeshStandardMaterial({ color: 0xcfc8bc, roughness: 0.9 });
      const aXZ = (q: readonly Punto[]): [number, number][] => q.map(([x, y]) => [x * CM, y * CM]);
      const malla = (g: GeometriaGLB, m: THREE.Material): THREE.Mesh => {
        const x = new THREE.Mesh(aBuffer(g), m);
        x.receiveShadow = true;
        return x;
      };
      const alturas = espacio.plantas.map((x) => [x.id, x.nivel, x.estancias.map((s) => s.altura)]);
      for (const p of espacio.plantas) {
        vivas.add(p.id);
        const fantasma = modo === 'casa' && p.nivel > activa.nivel;
        const modelosP = p.muebles.map((m) => (m.modelo ? (this.fuenteModelos?.(m.modelo.archivo)?.uuid ?? null) : null));
        // De las escaleras que llegan, sólo su origen y ellas: no los muebles de la planta de abajo.
        const llegan = escalerasQueLlegan(espacio, p.id).map((x) => [x.desde.id, x.escalera]);
        const firma = JSON.stringify([modo, p.id === activa.id, p.nivel - activa.nivel, fantasma, p, llegan, alturas, modelosP]);
        const previa = this.cacheOtras.get(p.id);
        if (previa?.firma === firma) continue;
        if (previa) {
          this.grupoOtras.remove(previa.grupo);
          liberar(previa.grupo);
          for (const m of previa.fantasmas) m.dispose();
        }
        const fantasmas: THREE.Material[] = [];
        const g = new THREE.Group();
        g.name = `planta-${p.id}`;
        g.position.y = (p.nivel - activa.nivel) * CM;
        // El forjado bajo cada planta (también bajo la activa, que no lo dibuja ella).
        const fj = forjadoDePlanta(espacio, p);
        if (fj) for (const pol of fj.poligonos) g.add(malla(mallaPrismaConAgujeros(aXZ(pol.exterior), pol.agujeros.map(aXZ), fj.z0 * CM, fj.z1 * CM), matForjado()));
        if (p.id !== activa.id) {
          try {
            for (const b of modeloPlanta(p).bandas) {
              for (const pol of b.poligonos) g.add(malla(mallaPrismaConAgujeros(aXZ(pol.exterior), pol.agujeros.map(aXZ), b.y0 * CM, b.y1 * CM), matMuro()));
            }
          } catch {
            /* muros que no se pueden calcular: se ve el resto */
          }
          const huecos = huecosDePlanta(espacio, p.id);
          let modeloOtra: ModeloPlanta | null = null;
          try {
            modeloOtra = modeloPlanta(p);
          } catch {
            /* sin modelo: sin pintura */
          }
          for (const s of p.estancias) {
            const ms = s.suelo ? new THREE.MeshStandardMaterial({ color: colorSuelo(s), roughness: 0.95, map: texturaSuelo(s.suelo.tipo) }) : matSuelo();
            for (const pol of sueloConHuecos(s.contorno, huecos)) {
              const suelo = malla(mallaPrismaConAgujeros(aXZ(pol.exterior), pol.agujeros.map(aXZ), -0.02, 0), ms);
              // Las mallas del núcleo no traen coordenadas de textura: las del suelo, en metros, como en la
              // planta activa (revisión independiente, 8).
              const pos = suelo.geometry.getAttribute('position');
              const uv = new Float32Array(pos.count * 2);
              for (let i = 0; i < pos.count; i++) {
                uv[i * 2] = pos.getX(i);
                uv[i * 2 + 1] = -pos.getZ(i);
              }
              suelo.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
              g.add(suelo);
            }
            if (s.paredes && modeloOtra) g.add(malla(mallaCuadros(revestimientoPorMuro(s, modeloOtra).flat()), new THREE.MeshStandardMaterial({ color: s.paredes, roughness: 0.9 })));
          }
          // Obra que ocupa volumen (columnas, pilares, radiadores, vigas, escalones); los enchufes y el
          // techo inclinado son ayudas de la planta que se edita.
          for (const s of p.estancias) {
            for (const el of s.elementos ?? []) {
              if (el.forma === 'punto') continue;
              const [z0, z1] = rangoAltura(s, el);
              const m = new THREE.Mesh(prismaPoligono({ exterior: huellaElemento(s, el)!, agujeros: [] }, z0, z1), matMuro());
              m.receiveShadow = true;
              g.add(m);
            }
          }
          for (const mu of p.muebles) {
            const vis = this.construirMueble(mu, false, false, '');
            vis.etiqueta.visible = false;
            vis.marco.visible = false;
            this.colocar(vis.grupo, mu);
            g.add(vis.grupo);
          }
          for (const esc of p.escaleras ?? []) {
            for (const pz of piezasEscalera(geometriaDe(espacio, p, esc))) g.add(malla(geometriaPieza(pz), pz.tipo === 'barra' ? matBarandilla() : matPeldano()));
          }
          for (const { desde, escalera } of escalerasQueLlegan(espacio, p.id)) {
            const geo = geometriaDe(espacio, desde, escalera);
            for (const pz of piezasHueco(geo, Math.max(2, p.nivel - desde.nivel - Math.max(0, ...desde.estancias.map((s) => s.altura)))).piezas) {
              // El canto, del color del forjado: comparten pared y con otro color parpadearían (revisión independiente, 12).
              g.add(malla(geometriaPieza(pz), pz.tipo === 'barra' ? matBarandilla() : matForjado()));
            }
          }
        }
        // En «Casa entera», lo que queda por encima de la activa, en transparente y sin sombras.
        if (modo === 'casa' && p.nivel > activa.nivel) {
          g.traverse((o) => {
            if (!(o instanceof THREE.Mesh)) return;
            const fantasma = (m: THREE.Material): THREE.Material => {
              const c = m.clone();
              c.transparent = true;
              c.opacity = 0.18;
              c.depthWrite = false;
              fantasmas.push(c);
              if (!o.userData.compartido) m.dispose();
              return c;
            };
            o.material = Array.isArray(o.material) ? o.material.map(fantasma) : fantasma(o.material);
            o.castShadow = false;
            o.userData.fantasma = true;
          });
        }
        this.grupoOtras.add(g);
        this.cacheOtras.set(p.id, { firma, grupo: g, fantasmas });
        this.reconstruidas++;
      }
    }
    for (const [id, x] of [...this.cacheOtras]) {
      if (vivas.has(id)) continue;
      this.grupoOtras.remove(x.grupo);
      liberar(x.grupo);
      for (const m of x.fantasmas) m.dispose();
      this.cacheOtras.delete(id);
    }
    this.otras = activo && activa ? espacio!.plantas.filter((x) => x.id !== activa.id).map((x) => x.id) : [];
    this.alturaCasa = activo && espacio && activa
      ? [Math.min(...espacio.plantas.map((x) => x.nivel)) - activa.nivel, Math.max(0, ...espacio.plantas.map((x) => x.nivel - activa.nivel + Math.max(0, ...x.estancias.map((t) => t.altura))))]
      : [0, 0];
    this.pedirRender();
  }

  /** Activa o quita «Casa entera» (se ve en 3D). */
  ponerCasaEntera(si: boolean): void {
    this.casaEntera = si;
    this.ponerOtrasPlantas();
    this.pedirRender();
  }

  /** Para las pruebas: plantas que se dibujan además de la activa y las que van en transparente. */
  plantasDibujadas(): { otras: string[]; fantasma: string[]; reconstruidas: number } {
    const fantasma: string[] = [];
    for (const g of this.grupoOtras.children) {
      let f = false;
      g.traverse((o) => (f ||= !!o.userData.fantasma));
      if (f) fantasma.push(g.name.slice('planta-'.length));
    }
    return { otras: [...this.otras], fantasma, reconstruidas: this.reconstruidas };
  }

  /** Mira desde un punto de la planta (cm), con un rumbo (rad, 0 = +x) y un cabeceo (rad, arriba > 0). */
  mirarDesde(pos: Punto, rumbo: number, cabeceo: number, ojos = 160): void {
    const o = aTres(pos[0], pos[1]);
    this.camPersp.position.set(o.X, ojos * CM, o.Z);
    this.camPersp.lookAt(o.X + Math.cos(rumbo) * Math.cos(cabeceo), ojos * CM + Math.sin(cabeceo), o.Z + Math.sin(rumbo) * Math.cos(cabeceo));
    this.actualizarCorte();
    this.pedirRender();
  }

  terminarRecorrido(): void {
    if (!this.recorriendo) return;
    this.recorriendo = false;
    if (this.camaraAntes) {
      this.camPersp.position.copy(this.camaraAntes.pos);
      this.camPersp.fov = this.camaraAntes.fov;
      this.camPersp.updateProjectionMatrix();
      this.ctrlPersp.target.copy(this.camaraAntes.objetivo);
      this.ctrlPersp.update();
    }
    this.ctrlPersp.enabled = this.vista === '3d';
    for (const t of this.techosPlanos) t.visible = false;
    this.actualizarCorte();
    this.ponerOtrasPlantas();
    this.pedirRender();
  }

  get camara(): THREE.Camera {
    return this.vista === 'plano' ? this.camOrto : this.camPersp;
  }

  get controles(): OrbitControls {
    return this.vista === 'plano' ? this.ctrlOrto : this.ctrlPersp;
  }

  private ajustarTamano(): void {
    const w = Math.max(1, this.lienzo.clientWidth);
    const h = Math.max(1, this.lienzo.clientHeight);
    this.renderer.setSize(w, h);
    this.etiquetas.setSize(w, h);
    this.camPersp.aspect = w / h;
    this.camPersp.updateProjectionMatrix();
    this.ajustarOrto();
    this.pedirRender();
  }

  /** Frustum ortográfico que encuadra la estancia con margen, conservando la proporción del lienzo. */
  private ajustarOrto(): void {
    const w = Math.max(1, this.lienzo.clientWidth);
    const h = Math.max(1, this.lienzo.clientHeight);
    const { minX, minY, maxX, maxY } = this.caja;
    const margen = 80;
    const anchoM = (maxX - minX + margen * 2) * CM;
    const largoM = (maxY - minY + margen * 2) * CM;
    const aspecto = w / h;
    const medioAlto = Math.max(largoM / 2, anchoM / 2 / aspecto);
    this.camOrto.left = -medioAlto * aspecto;
    this.camOrto.right = medioAlto * aspecto;
    this.camOrto.top = medioAlto;
    this.camOrto.bottom = -medioAlto;
    this.camOrto.updateProjectionMatrix();
  }

  ponerVista(v: Vista): void {
    this.vista = v;
    this.ctrlOrto.enabled = v === 'plano';
    this.ctrlPersp.enabled = v === '3d' && !this.recorriendo;
    this.luz.castShadow = v === '3d';
    for (const vis of this.visuales.values()) vis.etiqueta.visible = v === 'plano';
    for (const et of this.etiquetasMuro) et.visible = v === 'plano';
    for (const t of this.techos) t.visible = v === '3d';
    this.grupoEstancia.traverse((o) => {
      if (o.userData.soloPlano) o.visible = v === 'plano';
    });
    for (const s of this.suelos) {
      const m = s.material as THREE.MeshStandardMaterial;
      const t = (m.userData.textura as THREE.Texture | null | undefined) ?? null;
      if ((v === '3d' ? t : null) !== m.map) {
        m.map = v === '3d' ? t : null;
        m.needsUpdate = true;
      }
    }
    this.actualizarCorte();
    this.ponerOtrasPlantas();
    this.pedirRender();
  }

  encuadrar(): void {
    const casa = this.modoOtras() === 'casa' && this.ultimoEspacio ? this.ultimoEspacio : null;
    const { minX, minY, maxX, maxY } = casa ? this.unirCajasCon(cajaContorno(casa.plantas.flatMap((p) => p.estancias.flatMap((s) => s.contorno)))) : this.caja;
    // Con la casa entera, también su altura: el centro a media altura y el radio con ella.
    const [z0, z1] = casa ? this.alturaCasa : [0, 0];
    const c = aTres((minX + maxX) / 2, (minY + maxY) / 2);
    this.ctrlOrto.target.set(c.X, 0, c.Z);
    this.camOrto.position.set(c.X, 30, c.Z);
    this.camOrto.zoom = 1;
    this.ajustarOrto();
    this.ctrlOrto.update();
    // Distancia para que la estancia entera (con muros) quepa en el campo de visión más estrecho.
    const radio = (Math.hypot(maxX - minX, maxY - minY, z1 - z0) / 2) * CM + 0.4;
    const fovV = (this.camPersp.fov * Math.PI) / 180;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camPersp.aspect);
    const dist = (radio / Math.sin(Math.min(fovV, fovH) / 2)) * 1.05;
    const dir = new THREE.Vector3(0.45, 0.75, 0.75).normalize();
    const medio = casa ? ((z0 + z1) / 2) * CM : 0.4;
    const objetivo = new THREE.Vector3(c.X, medio, c.Z);
    const pos = new THREE.Vector3(c.X + dir.x * dist, medio + dir.y * dist, c.Z + dir.z * dist);
    if (this.recorriendo) {
      // Recorriendo, la cámara está en los ojos de la persona: el encuadre se aplica al salir.
      if (this.camaraAntes) this.camaraAntes = { ...this.camaraAntes, pos, objetivo };
    } else {
      this.ctrlPersp.target.copy(objetivo);
      this.camPersp.position.copy(pos);
      this.ctrlPersp.update();
    }
    this.pedirRender();
  }

  // ---------- Sincronización con el espacio ----------

  private encuadreCongelado = false;

  congelarEncuadre(si: boolean): void {
    this.encuadreCongelado = si;
    if (!si) {
      this.ajustarOrto();
      this.pedirRender();
    }
  }

  /** Cambia el modo de edición del contorno; se aplica en la próxima sincronización. */
  ponerEdicion(e: EstadoEdicion): void {
    this.edicion = { ...e };
  }

  sincronizar(espacio: Espacio, seleccion: string | null, conError: ReadonlySet<string>): void {
    this.ultimoEspacio = espacio;
    const pl = plantaDe(espacio);
    const firmaE = JSON.stringify([pl.estancias, pl.grosorExterior, this.edicion, pl.escaleras ?? null, escalerasQueLlegan(espacio, pl.id), espacio.plantas.map((x) => x.nivel)]);
    if (firmaE !== this.firmaEstancia) {
      const primera = this.firmaEstancia === '';
      this.firmaEstancia = firmaE;
      this.construirEstancia(espacio);
      if (primera) this.encuadrar();
    }
    const vivos = new Set<string>();
    for (const m of pl.muebles) {
      vivos.add(m.id);
      this.ponerMueble(m, m.id === seleccion || this.grupo.has(m.id), conError.has(m.id));
    }
    for (const [id, vis] of this.visuales) {
      if (!vivos.has(id)) {
        this.grupoMuebles.remove(vis.grupo);
        liberar(vis.grupo);
        this.visuales.delete(id);
      }
    }
    this.ponerOtrasPlantas();
    this.ponerCirculosGiro(espacio);
    this.pedirRender();
  }

  // ---------- Círculo de giro (R4-1) ----------

  private readonly grupoGiro = new THREE.Group();
  private firmaGiro = '';
  /** Centros de los círculos dibujados, por estancia (para las pruebas). */
  circulos: Record<string, Punto | null> = {};

  /** En las estancias que lo piden, el círculo de giro de 150 cm donde cabe (discontinuo, a ras de suelo). */
  private ponerCirculosGiro(espacio: Espacio): void {
    const pl = plantaDe(espacio);
    const con = pl.estancias.filter((s) => s.circuloDeGiro);
    const firma = con.length ? JSON.stringify([pl.id, con, pl.muebles, pl.estancias.map((s) => s.elementos ?? null)]) : '';
    if (firma === this.firmaGiro) return;
    this.firmaGiro = firma;
    liberar(this.grupoGiro);
    this.grupoGiro.clear();
    this.circulos = {};
    if (!this.grupoGiro.parent) this.escena.add(this.grupoGiro);
    for (const s of con) {
      const c = circuloDeGiro(pl, s, espacio);
      this.circulos[s.id] = c?.centro ?? null;
      if (!c) continue;
      const r = (CIRCULO_GIRO / 2) * CM;
      const pts = Array.from({ length: 73 }, (_, i) => new THREE.Vector3(c.centro[0] * CM + r * Math.cos((i / 72) * Math.PI * 2), 0.012, c.centro[1] * CM + r * Math.sin((i / 72) * Math.PI * 2)));
      const linea = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x2e7d5b, dashSize: 0.1, gapSize: 0.06 }));
      linea.computeLineDistances();
      linea.name = `giro-${s.id}`;
      linea.renderOrder = 5;
      this.grupoGiro.add(linea);
    }
    this.pedirRender();
  }

  /** Reencuadra si cambió mucho la estancia (por ejemplo al abrir otro archivo). */
  reencuadrar(): void {
    this.encuadrar();
  }

  private construirEstancia(espacio: Espacio): void {
    liberar(this.grupoEstancia);
    this.grupoEstancia.clear();
    const pl = plantaDe(espacio);
    const sel = estanciaDe(espacio, pl.estancias.some((s) => s.id === this.edicion.estancia) ? (this.edicion.estancia ?? undefined) : undefined).estancia;
    const grosorMuros = pl.grosorExterior;
    const g = Math.max(grosorMuros, 1);
    this.cajaEstancias = cajaContorno(pl.estancias.flatMap((s) => contornoExterior(s.contorno, g)));
    this.caja = this.unirCajas();
    // Mientras se arrastra una esquina la escala no cambia: el asa se queda bajo el puntero.
    if (!this.encuadreCongelado) this.ajustarOrto();

    // Suelos: uno por estancia (pulsar uno selecciona esa estancia).
    this.suelos = [];
    this.techosPlanos = [];
    const huecosSuelo = huecosDePlanta(espacio, pl.id);
    const huecosTecho = (pl.escaleras ?? []).flatMap((esc) => geometriaDe(espacio, pl, esc).hueco);
    for (const s of pl.estancias) {
      // Con acabado (R4-2), su color; la textura sólo en 3D (en el plano se leen mejor la rejilla y las cotas).
      const color = s.suelo ? colorSuelo(s) : s.id === sel.id && pl.estancias.length > 1 ? 0xf1e7d2 : 0xe8e1d5;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
      // Con acabado, la estancia elegida se resalta con un brillo cálido (revisión independiente, 11).
      if (s.suelo && s.id === sel.id && pl.estancias.length > 1) mat.emissive = new THREE.Color(0x2a2410);
      const textura = s.suelo ? texturaSuelo(s.suelo.tipo) : null;
      mat.userData.textura = textura;
      if (textura && this.vista === '3d') mat.map = textura;
      for (const pol of sueloConHuecos(s.contorno, huecosSuelo)) {
        const suelo = new THREE.Mesh(new THREE.ShapeGeometry(formaConAgujeros(pol.exterior, pol.agujeros)), mat);
        suelo.rotation.x = -Math.PI / 2;
        suelo.receiveShadow = true;
        suelo.name = `suelo-${s.id}`;
        suelo.userData.estancia = s.id;
        this.suelos.push(suelo);
        this.grupoEstancia.add(suelo);
      }
      // Techo: sólo se ve al recorrer (en planta y en 3D taparía la estancia); con el hueco de la escalera que sube.
      const matTecho = new THREE.MeshStandardMaterial({ color: 0xe9e6e1, roughness: 1, side: THREE.DoubleSide });
      for (const pol of sueloConHuecos(s.contorno, huecosTecho)) {
        const techo = new THREE.Mesh(new THREE.ShapeGeometry(formaConAgujeros(pol.exterior, pol.agujeros)), matTecho);
        techo.rotation.x = -Math.PI / 2;
        techo.position.y = s.altura * CM;
        techo.name = `techo-${s.id}`;
        techo.userData.ayuda = true; // sólo para recorrer: no va al .glb
        techo.visible = this.recorriendo;
        this.techosPlanos.push(techo);
        this.grupoEstancia.add(techo);
      }
    }
    this.construirEscaleras(espacio);

    // Rejilla de 10 cm y de 1 m sobre la caja de la planta.
    this.rejilla = this.crearRejilla();
    this.grupoEstancia.add(this.rejilla);

    // Muros: por cada pared de cada estancia, piezas entre la cara interior y la exterior (con inglete
    // en las esquinas), dejando los huecos. Cada pieza se recorta con las demás estancias para que un
    // muro nunca invada el suelo de la vecina (la exportación usa el modelo derivado del núcleo).
    const matLado = new THREE.MeshStandardMaterial({ color: 0xf7f4ef, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x2a2620 });
    const matTapa = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.8, side: THREE.DoubleSide });
    this.muros = [];
    this.etiquetasMuro = [];
    const huellas: number[] = [];
    // Huecos de cada estancia según el modelo derivado: la pared de la vecina también se abre en ellos
    // (si no, una puerta entre dos estancias se vería tapiada desde el lado de la que no la define).
    let huecosModelo: HuecoEnMuro[] = [];
    try {
      huecosModelo = modeloPlanta(pl).huecos.filter((x) => x.profundidad > 0);
    } catch (e) {
      if (!(e instanceof ErrorGeometria)) throw e;
    }
    // Umbrales: suelo en el grueso del muro de puertas y pasos (como en el .glb).
    const matUmbral = new THREE.MeshStandardMaterial({ color: 0xe8e1d5, roughness: 0.95 });
    for (const h of huecosModelo) {
      if (h.hueco.tipo === 'ventana') continue;
      const umbral = new THREE.Mesh(new THREE.ShapeGeometry(formaConAgujeros(huellaHueco(h), [])), matUmbral);
      umbral.rotation.x = -Math.PI / 2;
      umbral.position.y = -0.001;
      umbral.receiveShadow = true;
      umbral.name = `umbral-${h.hueco.id}`;
      this.grupoEstancia.add(umbral);
    }
    // Paredes pintadas (R4-2): el revestimiento de cada muro va en el grupo del muro.
    let modeloPl: ModeloPlanta | null = null;
    try {
      modeloPl = modeloPlanta(pl);
    } catch (e) {
      if (!(e instanceof ErrorGeometria)) throw e;
    }
    if (pl.estancias.length < 2) huecosModelo = [];
    for (const s of pl.estancias) {
      const { contorno, altura, huecos } = s;
      const pintura = s.paredes && modeloPl ? revestimientoPorMuro(s, modeloPl) : null;
      const matPintura = s.paredes ? new THREE.MeshStandardMaterial({ color: s.paredes, roughness: 0.9 }) : null;
      const exterior = contornoExterior(contorno, g);
      let otras: PoligonoConAgujeros[] = [];
      try {
        otras = union(pl.estancias.filter((o) => o.id !== s.id).map((o) => o.contorno));
      } catch (e) {
        if (!(e instanceof ErrorGeometria)) throw e;
      }
      for (let i = 0; i < contorno.length; i++) {
        const [a, b] = muro(contorno, i);
        const largo = distancia(a, b);
        const t: Punto = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
        const n = normalInterior(contorno, i);
        const ea = exterior[i] as Punto;
        const eb = exterior[(i + 1) % contorno.length] as Punto;
        const P = (s0: number): Punto => [a[0] + t[0] * s0, a[1] + t[1] * s0];
        const E = (s0: number): Punto => (s0 <= 1e-6 ? ea : s0 >= largo - 1e-6 ? eb : [a[0] + t[0] * s0 - n[0] * g, a[1] + t[1] * s0 - n[1] * g]);
        const grupo = new THREE.Group();
        const pieza = (s0: number, s1: number, y0: number, y1: number): void => {
          if (s1 - s0 < 0.05 || y1 - y0 < 0.05) return;
          const base = [P(s0), P(s1), E(s1), E(s0)];
          if (!otras.length) {
            const malla = new THREE.Mesh(prisma(base, y0, y1), [matLado, matTapa]);
            malla.castShadow = true;
            malla.receiveShadow = true;
            grupo.add(malla);
            return;
          }
          let trozos: PoligonoConAgujeros[] = [{ exterior: base, agujeros: [] }];
          try {
            trozos = diferencia(trozos, otras);
          } catch (e) {
            if (!(e instanceof ErrorGeometria)) throw e;
          }
          // Huecos de las demás estancias que caen en esta pieza: se parte por sus alturas y se restan.
          const ajenos = huecosModelo.filter((x) => x.estancia !== s.id && x.tope > y0 && x.base < y1);
          const cortes = [...new Set([y0, y1, ...ajenos.flatMap((x) => [x.base, x.tope]).filter((y) => y > y0 && y < y1)])].sort((p, q) => p - q);
          for (let k = 0; k + 1 < cortes.length; k++) {
            const ya = cortes[k] as number;
            const yb = cortes[k + 1] as number;
            const activos = ajenos.filter((x) => x.base <= ya + 1e-9 && x.tope >= yb - 1e-9);
            let parte = trozos;
            if (activos.length) {
              try {
                parte = diferencia(trozos, union(activos.map(huellaHueco)));
              } catch (e) {
                if (!(e instanceof ErrorGeometria)) throw e;
              }
            }
            for (const trozo of parte) {
              const malla = new THREE.Mesh(prismaPoligono(trozo, ya, yb), [matLado, matTapa]);
              malla.castShadow = true;
              malla.receiveShadow = true;
              grupo.add(malla);
            }
          }
        };
        let s0 = 0;
        for (const h of huecos.filter((x) => x.muro === i).sort((x, y) => x.desde - y.desde)) {
          pieza(s0, h.desde, 0, altura);
          pieza(h.desde, h.desde + h.ancho, 0, h.antepecho);
          pieza(h.desde, h.desde + h.ancho, h.antepecho + h.alto, altura);
          s0 = h.desde + h.ancho;
        }
        pieza(s0, largo, 0, altura);
        const cuadros = pintura?.[i];
        if (cuadros?.length && matPintura) {
          const capa = new THREE.Mesh(aBuffer(mallaCuadros(cuadros)), matPintura);
          capa.name = `pintura-${s.id}-${i}`;
          capa.receiveShadow = true;
          capa.raycast = () => undefined; // no se elige: se pulsa a través de ella
          grupo.add(capa);
        }
        this.grupoEstancia.add(grupo);
        this.muros.push({ malla: grupo, normal: n, medio: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
        for (const q0 of [a, b]) {
          const q = aTres(q0[0], q0[1]);
          huellas.push(q.X, 0.003, q.Z);
        }
        // Longitud de la pared, por fuera, en el plano: sólo de la estancia seleccionada.
        if (s.id !== sel.id) continue;
        const div = document.createElement('div');
        div.className = 'etiqueta muro';
        div.textContent = this.edicion.editando ? `Pared ${i + 1} · ${formatoCm(largo)} cm` : `${formatoCm(largo)} cm`;
        const et = new CSS2DObject(div);
        const m = aTres((a[0] + b[0]) / 2 - n[0] * (g + 16), (a[1] + b[1]) / 2 - n[1] * (g + 16));
        et.position.set(m.X, 0.01, m.Z);
        et.visible = this.vista === 'plano';
        this.etiquetasMuro.push(et);
        this.grupoEstancia.add(et);
      }
      // Nombre de la estancia en el plano, si hay varias.
      if (pl.estancias.length > 1) {
        const cc = cajaContorno(contorno);
        const div = document.createElement('div');
        div.className = `etiqueta estancia${s.id === sel.id ? ' sel' : ''}`;
        div.textContent = s.nombre;
        const et = new CSS2DObject(div);
        const m = aTres((cc.minX + cc.maxX) / 2, (cc.minY + cc.maxY) / 2);
        et.position.set(m.X, 0.01, m.Z);
        et.visible = this.vista === 'plano';
        this.etiquetasMuro.push(et);
        this.grupoEstancia.add(et);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(huellas, 3));
    this.huellasMuro = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x3b4046 }));
    this.grupoEstancia.add(this.huellasMuro);

    this.construirHuecos(espacio, g);
    this.construirObra(espacio, matLado, matTapa);
    this.construirAsas(sel.contorno);

    // Luz que cubre la estancia.
    const c = aTres((this.caja.minX + this.caja.maxX) / 2, (this.caja.minY + this.caja.maxY) / 2);
    const tam = Math.max(this.caja.maxX - this.caja.minX, this.caja.maxY - this.caja.minY) * CM;
    this.luz.position.set(c.X - tam * 0.4, tam + 3, c.Z - tam * 0.6);
    this.luz.target.position.set(c.X, 0, c.Z);
    const sc = this.luz.shadow.camera;
    sc.left = -tam;
    sc.right = tam;
    sc.top = tam;
    sc.bottom = -tam;
    sc.near = 0.1;
    sc.far = tam * 4 + 10;
    sc.updateProjectionMatrix();
    this.actualizarCorte();
  }

  private crearRejilla(): THREE.Object3D {
    const { minX, minY, maxX, maxY } = this.caja;
    const finas: number[] = [];
    const gruesas: number[] = [];
    const y = 0.001;
    for (let x = Math.ceil(minX / 10) * 10; x <= maxX; x += 10) {
      (x % 100 === 0 ? gruesas : finas).push(x * CM, y, minY * CM, x * CM, y, maxY * CM);
    }
    for (let z = Math.ceil(minY / 10) * 10; z <= maxY; z += 10) {
      (z % 100 === 0 ? gruesas : finas).push(minX * CM, y, z * CM, maxX * CM, y, z * CM);
    }
    const g = new THREE.Group();
    const linea = (pos: number[], opacidad: number): THREE.LineSegments => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8b8378, transparent: true, opacity: opacidad, depthWrite: false }));
    };
    g.add(linea(finas, 0.18), linea(gruesas, 0.42));
    g.name = 'rejilla';
    return g;
  }

  /**
   * Obra (R2-4): columnas, pilares, radiadores y escalones como prismas de su huella con el material
   * de pared; vigas bajo el techo; enchufes como una placa en su muro; y el techo inclinado como un
   * plano translúcido (sólo en 3D: en planta taparía la estancia).
   */
  /**
   * Escaleras que suben desde la planta (peldaños, meseta y barandillas, con los cantos de los
   * peldaños y la flecha de subida en planta) y huecos de las que llegan (canto del forjado,
   * barandilla y contorno discontinuo con la flecha de bajada en planta).
   */
  private construirEscaleras(espacio: Espacio): void {
    const pl = plantaDe(espacio);
    const grupo = new THREE.Group();
    grupo.name = 'escaleras';
    const matPeldano = new THREE.MeshStandardMaterial({ color: 0xd9d2c5, roughness: 0.85 });
    const matBarandilla = new THREE.MeshStandardMaterial({ color: 0x5b6670, roughness: 0.5, metalness: 0.2 });
    const matCanto = new THREE.MeshStandardMaterial({ color: 0xcfc8bc, roughness: 0.9 });
    const lineaAyuda = (pts: Punto[], y: (p: Punto) => number, color: number, discontinua = false): THREE.Line => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0] * CM, y(p) * CM + 0.006, p[1] * CM)));
      const mat = discontinua ? new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.05, depthTest: false }) : new THREE.LineBasicMaterial({ color, depthTest: false });
      const l = new THREE.Line(geo, mat);
      if (discontinua) l.computeLineDistances();
      l.renderOrder = 6;
      l.userData.ayuda = true;
      l.userData.soloPlano = true;
      l.visible = this.vista === 'plano';
      return l;
    };
    for (const esc of pl.escaleras ?? []) {
      const geo = geometriaDe(espacio, pl, esc);
      const g = new THREE.Group();
      g.name = `escalera-${esc.id}`;
      g.userData.escalera = esc.id;
      for (const pz of piezasEscalera(geo)) {
        const m = new THREE.Mesh(aBuffer(geometriaPieza(pz)), pz.tipo === 'barra' ? matBarandilla : matPeldano);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
      }
      // En planta: cantos de los peldaños y flecha de subida.
      const suelo = (p: Punto): number => alturaEnEscalera(geo, p) ?? 0;
      for (const [a, b] of lineasPeldanos(geo)) {
        const z = suelo([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) + 0.5;
        g.add(lineaAyuda([a, b], () => z, 0x8b8378));
      }
      g.add(lineaAyuda(ejeEscalera(geo), (p) => suelo(p) + 1, 0x2b2f33));
      grupo.add(g);
    }
    for (const { desde, escalera } of escalerasQueLlegan(espacio, pl.id)) {
      const geo = geometriaDe(espacio, desde, escalera);
      const techoAbajo = Math.max(0, ...desde.estancias.map((s) => s.altura));
      const h = piezasHueco(geo, Math.max(2, pl.nivel - desde.nivel - techoAbajo));
      const g = new THREE.Group();
      g.name = `hueco-${escalera.id}`;
      for (const pz of h.piezas) g.add(new THREE.Mesh(aBuffer(geometriaPieza(pz)), pz.tipo === 'barra' ? matBarandilla : matCanto));
      for (const c of h.contornos) g.add(lineaAyuda([...c, c[0]!], () => 0, 0x5b6670, true));
      g.add(lineaAyuda([...ejeEscalera(geo)].reverse(), () => 0, 0x2b2f33));
      grupo.add(g);
    }
    this.grupoEstancia.add(grupo);
  }

  private construirObra(espacio: Espacio, matLado: THREE.Material, matTapa: THREE.Material): void {
    const obra = new THREE.Group();
    obra.name = 'obra';
    const matEnchufe = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.6 });
    const matTecho = new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.9, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    const matViga = new THREE.MeshStandardMaterial({ color: 0x8d939a, roughness: 0.9, transparent: true, opacity: 0.4, depthWrite: false });
    const matEscalon = new THREE.MeshStandardMaterial({ color: 0xd8d0c2, roughness: 0.9 });
    this.techos = [];
    for (const s of plantaDe(espacio).estancias) {
      for (const el of s.elementos ?? []) {
        let malla: THREE.Mesh;
        if (el.forma === 'punto') {
          const [x, y] = puntoEnElMuro(s, el);
          const n = normalInterior(s.contorno, el.muro);
          const q = aTres(x + n[0] * 1, y + n[1] * 1);
          malla = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.012), matEnchufe);
          malla.position.set(q.X, el.altura * CM, q.Z);
          malla.rotation.y = Math.atan2(n[0], n[1]);
        } else {
          const [z0, z1] = rangoAltura(s, el);
          // La viga, translúcida (en planta se ve lo que hay debajo); el escalón, claro como el suelo.
          const tipo = tipoNormal(el.tipo);
          const mat = el.forma === 'viga' ? [matViga, matViga] : tipo === 'escalon' ? [matEscalon, matEscalon] : [matLado, matTapa];
          malla = new THREE.Mesh(prismaPoligono({ exterior: huellaElemento(s, el)!, agujeros: [] }, z0, z1), mat);
          malla.castShadow = true;
          malla.receiveShadow = true;
        }
        malla.name = `obra-${el.id}`;
        malla.userData = { elemento: el.id, tipo: el.tipo };
        obra.add(malla);
      }
      for (const f of s.faldones ?? []) {
        const [a, b] = muro(s.contorno, f.muro);
        const n = normalInterior(s.contorno, f.muro);
        const v = (p: Punto, h: number): number[] => {
          const q = aTres(p[0], p[1]);
          return [q.X, h * CM, q.Z];
        };
        const a2: Punto = [a[0] + n[0] * f.alcance, a[1] + n[1] * f.alcance];
        const b2: Punto = [b[0] + n[0] * f.alcance, b[1] + n[1] * f.alcance];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([...v(a, f.alturaEnMuro), ...v(b, f.alturaEnMuro), ...v(b2, s.altura), ...v(a, f.alturaEnMuro), ...v(b2, s.altura), ...v(a2, s.altura)], 3));
        geo.computeVertexNormals();
        const techo = new THREE.Mesh(geo, matTecho);
        techo.name = `techo-${s.id}-${f.muro}`;
        // Ayuda visual: no va al .glb (ni el del núcleo lleva techos), en ninguna de las dos vistas.
        techo.userData.ayuda = true;
        // En planta, una línea discontinua donde el techo ya tiene la altura de la estancia.
        const p0 = aTres(a2[0], a2[1]);
        const p1 = aTres(b2[0], b2[1]);
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute([p0.X, 0.01, p0.Z, p1.X, 0.01, p1.Z], 3));
        const linea = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0x5b6670, dashSize: 0.06, gapSize: 0.05 }));
        linea.computeLineDistances();
        linea.name = `linea-techo-${s.id}-${f.muro}`;
        linea.userData.ayuda = true;
        obra.add(linea);
        techo.visible = this.vista === '3d';
        this.techos.push(techo);
        obra.add(techo);
      }
    }
    this.grupoEstancia.add(obra);
  }

  /** Puertas (barrido en el suelo y hoja abierta), ventanas (cristal) y zonas para seleccionarlos. */
  private construirHuecos(espacio: Espacio, grosor: number): void {
    this.zonasHueco = [];
    const y = 0.005;
    const matHoja = new THREE.MeshStandardMaterial({ color: 0xc9a77c, roughness: 0.7 });
    const matCristal = new THREE.MeshStandardMaterial({ color: 0x9cc6e6, transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false });
    const huecosPlanta = plantaDe(espacio).estancias.flatMap((est: Estancia) => est.huecos.map((h) => ({ est, h })));
    for (const { est, h } of huecosPlanta) {
      const gh = geometriaHueco(est.contorno, h);
      const sel = this.edicion.hueco === h.id;
      // Barrido de la puerta: arco discontinuo en el suelo (hacia dentro o hacia fuera).
      if (h.tipo === 'puerta' && h.abre !== 'corredera') {
        const haciaFuera = h.abre === 'fuera';
        const n: Punto = haciaFuera ? [-gh.n[0], -gh.n[1]] : gh.n;
        const bisagra = h.bisagra === 'fin' ? gh.b : gh.a;
        const cerrada: Punto = h.bisagra === 'fin' ? [-gh.t[0], -gh.t[1]] : gh.t;
        const pts: number[] = [];
        for (let i = 0; i <= 16; i++) {
          const ang = (i / 16) * (Math.PI / 2);
          const p = aTres(bisagra[0] + (cerrada[0] * Math.cos(ang) + n[0] * Math.sin(ang)) * h.ancho, bisagra[1] + (cerrada[1] * Math.cos(ang) + n[1] * Math.sin(ang)) * h.ancho);
          pts.push(p.X, y, p.Z);
        }
        const arcoGeo = new THREE.BufferGeometry();
        arcoGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const arco = new THREE.Line(arcoGeo, new THREE.LineDashedMaterial({ color: 0x6b6358, dashSize: 0.04, gapSize: 0.03 }));
        arco.computeLineDistances();
        this.grupoEstancia.add(arco);
        // Hoja abierta 90°, perpendicular al muro desde la bisagra.
        const hoja = new THREE.Mesh(new THREE.BoxGeometry(h.ancho * CM, h.alto * CM, 0.035), matHoja);
        const c = aTres(bisagra[0] + n[0] * (h.ancho / 2) + cerrada[0] * 2, bisagra[1] + n[1] * (h.ancho / 2) + cerrada[1] * 2);
        hoja.position.set(c.X, (h.alto * CM) / 2, c.Z);
        hoja.rotation.y = Math.atan2(-n[1], n[0]);
        hoja.castShadow = true;
        hoja.name = `hoja-${h.id}`;
        this.grupoEstancia.add(hoja);
      } else if (h.tipo === 'puerta') {
        // Corredera: hoja paralela al muro, por dentro.
        const hoja = new THREE.Mesh(new THREE.BoxGeometry(h.ancho * CM, h.alto * CM, 0.03), matHoja);
        const c = aTres((gh.a[0] + gh.b[0]) / 2 + gh.n[0] * 3, (gh.a[1] + gh.b[1]) / 2 + gh.n[1] * 3);
        hoja.position.set(c.X, (h.alto * CM) / 2, c.Z);
        hoja.rotation.y = Math.atan2(-gh.t[1], gh.t[0]);
        hoja.name = `hoja-${h.id}`;
        this.grupoEstancia.add(hoja);
      } else if (h.tipo === 'ventana') {
        const cristal = new THREE.Mesh(new THREE.BoxGeometry(h.ancho * CM, h.alto * CM, 0.01), matCristal);
        const c = aTres((gh.a[0] + gh.b[0]) / 2 - gh.n[0] * (grosor / 2), (gh.a[1] + gh.b[1]) / 2 - gh.n[1] * (grosor / 2));
        cristal.position.set(c.X, (h.antepecho + h.alto / 2) * CM, c.Z);
        cristal.rotation.y = Math.atan2(-gh.t[1], gh.t[0]);
        cristal.name = `cristal-${h.id}`;
        this.grupoEstancia.add(cristal);
      }
      // Zona del hueco en el suelo (de fuera del muro a 20 cm dentro): se resalta al seleccionarlo y sirve para agarrarlo.
      const fondo = grosor + 20;
      const zona = new THREE.Mesh(
        new THREE.PlaneGeometry(h.ancho * CM, fondo * CM),
        new THREE.MeshBasicMaterial({ color: 0xe3a812, transparent: true, opacity: sel ? 0.55 : 0, depthWrite: false }),
      );
      zona.rotation.x = -Math.PI / 2;
      zona.rotation.z = Math.atan2(-gh.t[1], gh.t[0]);
      const c = aTres((gh.a[0] + gh.b[0]) / 2 + gh.n[0] * (20 - fondo / 2), (gh.a[1] + gh.b[1]) / 2 + gh.n[1] * (20 - fondo / 2));
      zona.position.set(c.X, y + 0.001, c.Z);
      zona.userData.hueco = h.id;
      this.zonasHueco.push(zona);
      this.grupoEstancia.add(zona);
    }
  }

  /** Asas de las esquinas, sólo al editar las paredes en planta. */
  private construirAsas(contorno: readonly Punto[]): void {
    this.asas = [];
    if (!this.edicion.editando) return;
    // Tamaño proporcional a la estancia (entre 6 y 20 cm de radio): fácil de agarrar en cualquiera.
    const tam = Math.max(this.caja.maxX - this.caja.minX, this.caja.maxY - this.caja.minY) * CM;
    const radio = Math.min(0.2, Math.max(0.06, tam * 0.018));
    contorno.forEach((p, k) => {
      const sel = this.edicion.vertice === k;
      const asa = new THREE.Mesh(
        new THREE.CylinderGeometry(radio, radio, 0.02, 24),
        new THREE.MeshBasicMaterial({ color: sel ? 0xe3a812 : 0xfbfaf7, depthTest: false }),
      );
      const borde = new THREE.Mesh(new THREE.CylinderGeometry(radio * 1.2, radio * 1.2, 0.015, 24), new THREE.MeshBasicMaterial({ color: 0x2b2f33, depthTest: false }));
      const q = aTres(p[0], p[1]);
      asa.position.set(q.X, 3.2, q.Z);
      borde.position.set(q.X, 3.19, q.Z);
      asa.renderOrder = 11;
      borde.renderOrder = 10;
      asa.userData.vertice = k;
      this.asas.push(asa);
      this.grupoEstancia.add(borde, asa);
    });
  }

  /** Esquina bajo el puntero (sólo editando). */
  verticeBajo(ev: { clientX: number; clientY: number }): number | null {
    if (!this.asas.length) return null;
    this.rayo(ev);
    const hit = this.raycaster.intersectObjects(this.asas, false)[0];
    return (hit?.object.userData.vertice as number | undefined) ?? null;
  }

  /** Geometrías y texturas vivas en la tarjeta gráfica. Para las pruebas. */
  memoria(): { geometries: number; textures: number } {
    return { ...this.renderer.info.memory };
  }

  /** ¿Hay pared entre dos puntos de la planta (cm) a una altura (cm)? Para las pruebas; mira todas las paredes, también las ocultas por el corte. */
  hayMuroEntre(a: Punto, b: Punto, altura: number): boolean {
    this.escena.updateMatrixWorld(true);
    const o = new THREE.Vector3(a[0] * CM, altura * CM, a[1] * CM);
    const d = new THREE.Vector3((b[0] - a[0]) * CM, 0, (b[1] - a[1]) * CM);
    const largo = d.length();
    const r = new THREE.Raycaster(o, d.normalize(), 0, largo);
    return r.intersectObjects(this.muros.map((m) => m.malla), true).length > 0;
  }

  /**
   * Planos de fondo encima del suelo y debajo de paredes y muebles, con su opacidad. Cada imagen va
   * con la esquina de arriba a la izquierda en (x, y) cm, girada y a su escala (cm por píxel).
   */
  ponerFondos(lista: { fondo: Fondo; imagen: ImageBitmap | null }[]): void {
    const firma = JSON.stringify(lista.map((x) => [x.fondo, x.imagen ? x.imagen.width : 0]));
    if (firma === this.firmaFondos) return;
    this.firmaFondos = firma;
    this.esquinasFondos = lista
      .filter((x) => x.imagen)
      .flatMap(({ fondo: f }) => {
        const [c, s] = [Math.cos(f.giro * (Math.PI / 180)), Math.sin(f.giro * (Math.PI / 180))];
        return ([[0, 0], [f.anchoPx, 0], [f.anchoPx, f.altoPx], [0, f.altoPx]] as Punto[]).map(([u, v]) => [f.x + u * f.escala * c - v * f.escala * s, f.y + u * f.escala * s + v * f.escala * c] as Punto);
      });
    this.caja = this.unirCajas();
    // La textura de cada plano es sólo suya: se libera con él (si no, cada cambio de opacidad dejaba una).
    this.grupoFondos.traverse((o) => ((o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined)?.map?.dispose());
    liberar(this.grupoFondos);
    this.grupoFondos.clear();
    for (const { fondo: f, imagen } of lista) {
      if (!imagen) continue;
      const textura = new THREE.Texture(imagen);
      textura.colorSpace = THREE.SRGBColorSpace;
      textura.needsUpdate = true;
      const ancho = f.anchoPx * f.escala * CM;
      const alto = f.altoPx * f.escala * CM;
      const plano = new THREE.Mesh(
        new THREE.PlaneGeometry(ancho, alto),
        new THREE.MeshBasicMaterial({ map: textura, transparent: true, opacity: f.opacidad, depthWrite: false }),
      );
      plano.rotation.x = -Math.PI / 2;
      plano.position.set(ancho / 2, 0, alto / 2);
      plano.renderOrder = 1;
      const g = new THREE.Group();
      g.name = `fondo-${f.id}`;
      g.position.set(f.x * CM, 0.0015, f.y * CM);
      g.rotation.y = rotacionY(f.giro);
      g.add(plano);
      this.grupoFondos.add(g);
    }
    this.pedirRender();
  }

  private unirCajas(): { minX: number; minY: number; maxX: number; maxY: number } {
    if (!this.esquinasFondos.length) return this.cajaEstancias;
    const f = cajaContorno(this.esquinasFondos);
    const e = this.cajaEstancias;
    return { minX: Math.min(e.minX, f.minX), minY: Math.min(e.minY, f.minY), maxX: Math.max(e.maxX, f.maxX), maxY: Math.max(e.maxY, f.maxY) };
  }

  private unirCajasCon(c: { minX: number; minY: number; maxX: number; maxY: number }): { minX: number; minY: number; maxX: number; maxY: number } {
    const e = this.caja;
    return { minX: Math.min(e.minX, c.minX), minY: Math.min(e.minY, c.minY), maxX: Math.max(e.maxX, c.maxX), maxY: Math.max(e.maxY, c.maxY) };
  }

  /** Trazo de «Dibujar estancia» o de «Calibrar»: puntos (cm) unidos y, si se pide, el siguiente provisional. */
  ponerTrazo(puntos: readonly Punto[], provisional: Punto | null = null): void {
    liberar(this.grupoTrazo);
    this.grupoTrazo.clear();
    const todos = provisional ? [...puntos, provisional] : [...puntos];
    if (todos.length) {
      const pos = todos.flatMap(([x, y]) => [x * CM, 0.02, y * CM]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const linea = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: COLOR_CINTA, depthTest: false }));
      linea.renderOrder = 12;
      this.grupoTrazo.add(linea);
      for (const [x, y] of puntos) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), new THREE.MeshBasicMaterial({ color: COLOR_CINTA, depthTest: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(x * CM, 0.021, y * CM);
        m.renderOrder = 12;
        this.grupoTrazo.add(m);
      }
    }
    this.pedirRender();
  }

  private readonly grupoMedida = new THREE.Group();

  /** Cinta métrica: línea de a a b sobre el suelo con su rótulo; sin b, sólo el primer punto. */
  ponerMedida(a: Punto | null, b: Punto | null, texto: string): void {
    liberar(this.grupoMedida);
    this.grupoMedida.clear();
    if (!this.grupoMedida.parent) this.escena.add(this.grupoMedida);
    const mat = new THREE.MeshBasicMaterial({ color: COLOR_CINTA, depthTest: false });
    for (const [x, y] of [a, b].filter((q): q is Punto => !!q)) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), mat.clone());
      m.rotation.x = -Math.PI / 2;
      m.position.set(x * CM, 0.03, y * CM);
      m.renderOrder = 13;
      this.grupoMedida.add(m);
    }
    if (a && b) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([a[0] * CM, 0.03, a[1] * CM, b[0] * CM, 0.03, b[1] * CM], 3));
      const linea = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: COLOR_CINTA, depthTest: false }));
      linea.renderOrder = 13;
      this.grupoMedida.add(linea);
      const div = document.createElement('div');
      div.className = 'etiqueta cota medida-cinta';
      div.textContent = texto;
      const et = new CSS2DObject(div);
      et.position.set(((a[0] + b[0]) / 2) * CM, 0.03, ((a[1] + b[1]) / 2) * CM);
      this.grupoMedida.add(et);
    }
    mat.dispose();
    this.pedirRender();
  }

  /** Estancia cuyo suelo está bajo el puntero. */
  estanciaBajo(ev: { clientX: number; clientY: number }): string | null {
    if (!this.suelos.length) return null;
    this.rayo(ev);
    const hit = this.raycaster.intersectObjects(this.suelos, false)[0];
    return (hit?.object.userData.estancia as string | undefined) ?? null;
  }

  /** Puerta, ventana o paso bajo el puntero. */
  huecoBajo(ev: { clientX: number; clientY: number }): string | null {
    if (!this.zonasHueco.length) return null;
    this.rayo(ev);
    const hit = this.raycaster.intersectObjects(this.zonasHueco, false)[0];
    return (hit?.object.userData.hueco as string | undefined) ?? null;
  }

  /** En 3D oculta los muros que quedan entre la cámara y la estancia. */
  private actualizarCorte(): void {
    const enPlano = this.vista === 'plano';
    const cam = this.camPersp.position;
    const cx = cam.x / CM;
    const cy = cam.z / CM;
    for (const m of this.muros) {
      const haciaCamara = (cx - m.medio[0]) * m.normal[0] + (cy - m.medio[1]) * m.normal[1];
      // Recorriendo se ven todas las paredes: la persona está dentro.
      m.malla.visible = enPlano || this.recorriendo || haciaCamara > 0;
    }
    if (this.rejilla) this.rejilla.visible = enPlano;
  }

  private firmaMueble(m: Mueble, sel: boolean, err: boolean): string {
    const modelo = m.modelo ? (this.fuenteModelos?.(m.modelo.archivo)?.uuid ?? null) : null;
    return JSON.stringify([m.ancho, m.fondo, m.alto, m.huecoInferior, m.elevacion, m.color, m.nombre, m.tipo, sel, err, m.piezas ?? null, m.modelo ?? null, modelo]);
  }

  private ponerMueble(m: Mueble, seleccionado: boolean, conError: boolean): void {
    const firma = this.firmaMueble(m, seleccionado, conError);
    let vis = this.visuales.get(m.id);
    if (!vis || vis.firma !== firma) {
      if (vis) {
        this.grupoMuebles.remove(vis.grupo);
        liberar(vis.grupo);
      }
      vis = this.construirMueble(m, seleccionado, conError, firma);
      this.visuales.set(m.id, vis);
      this.grupoMuebles.add(vis.grupo);
    }
    this.colocar(vis.grupo, m);
  }

  private colocar(g: THREE.Object3D, m: Pick<Mueble, 'x' | 'y' | 'giro' | 'elevacion'>): void {
    const t = aTres(m.x, m.y);
    g.position.set(t.X, m.elevacion * CM, t.Z);
    g.rotation.set(0, rotacionY(m.giro), 0);
  }

  private construirMueble(m: Mueble, sel: boolean, err: boolean, firma: string): Visual {
    const g = new THREE.Group();
    g.userData.id = m.id;
    const a = m.ancho * CM;
    const f = m.fondo * CM;
    const h = m.alto * CM;
    const cuerpo: THREE.Mesh[] = [];
    const sombras = (malla: THREE.Mesh): void => {
      malla.castShadow = true;
      malla.receiveShadow = true;
      cuerpo.push(malla);
    };
    let modelo = m.modelo ? (this.fuenteModelos?.(m.modelo.archivo) ?? null) : null;
    let escala: THREE.Group | null = null;
    if (m.modelo && modelo) {
      // Modelo propio: girado (0, 90, 180 o 270°: así la escala no uniforme no deforma), con su base a
      // ras del suelo del mueble y centrado en su huella; con ajuste «medidas» se estira a ancho ×
      // alto × fondo, con «modelo» conserva su tamaño (metros). SkeletonUtils clona bien los modelos
      // con esqueleto; geometría y materiales se comparten con la caché.
      const copia = clonarConEsqueleto(modelo);
      copia.traverse((o) => {
        o.userData.compartido = true; // de la caché: no se libera con el mueble
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const giro = new THREE.Group();
      giro.rotation.y = rotacionY(m.modelo.giro);
      giro.add(copia);
      escala = new THREE.Group();
      escala.add(giro);
      const caja0 = new THREE.Box3().setFromObject(escala);
      const t = caja0.getSize(new THREE.Vector3());
      if (caja0.isEmpty() || !(t.x > 0 && t.y > 0 && t.z > 0)) {
        modelo = null; // sin volumen (sólo vacíos, luces o cámaras): se ve la forma de reserva
        escala = null;
      } else {
        if (m.modelo.ajuste === 'medidas') escala.scale.set(a / t.x, h / t.y, f / t.z);
        escala.updateMatrixWorld(true);
        const caja1 = new THREE.Box3().setFromObject(escala);
        const centro = caja1.getCenter(new THREE.Vector3());
        escala.position.set(-centro.x, -caja1.min.y, -centro.z);
        g.add(escala);
        // El puntero apunta a una caja invisible con las medidas del mueble, no a las mallas del modelo
        // (un modelo con muchos polígonos haría lento cada movimiento del ratón).
        const caja = new THREE.Mesh(new THREE.BoxGeometry(a, h, f), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
        caja.position.y = h / 2;
        caja.userData.ayuda = true;
        g.add(caja);
        cuerpo.push(caja);
      }
    }
    if (!(m.modelo && modelo)) {
      // Piezas: las del mueble o la forma genérica de su tipo (núcleo, formas.ts), como en el .glb.
      const materiales = new Map<string, THREE.MeshStandardMaterial>();
      const material = (c: string): THREE.MeshStandardMaterial => {
        let x = materiales.get(c);
        if (!x) materiales.set(c, (x = new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: c === COLOR_CLARO ? 0.9 : 0.75 })));
        return x;
      };
      for (const pz of piezasDe(m)) {
        const w = pz.ancho * CM;
        const d = pz.fondo * CM;
        const alto = pz.alto * CM;
        let geo: THREE.BufferGeometry;
        let y = 0;
        if (pz.forma === 'esfera') {
          geo = new THREE.SphereGeometry(w / 2, 24, 16);
          y = w / 2;
        } else if (pz.forma === 'cilindro') {
          geo = new THREE.CylinderGeometry(w / 2, w / 2, alto, 32);
          y = alto / 2;
        } else if (pz.forma === 'cuna') {
          const c = mallaCuna(w, alto, d);
          geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(c.posiciones, 3));
          geo.setAttribute('normal', new THREE.BufferAttribute(c.normales, 3));
          geo.setIndex(new THREE.BufferAttribute(c.indices, 1));
        } else {
          geo = new THREE.BoxGeometry(w, alto, d);
          y = alto / 2;
        }
        const malla = new THREE.Mesh(geo, material(pz.color ?? m.color));
        malla.position.set(pz.x * CM, pz.z * CM + y, pz.y * CM);
        malla.rotation.y = rotacionY(pz.giro);
        sombras(malla);
        g.add(malla);
      }
    }
    if (!(m.modelo && modelo) && llevaMarcaDeFrente(m)) {
      // Marca de frente: listón oscuro sobre la tapa, junto al borde delantero.
      const oscuro = new THREE.MeshStandardMaterial({ color: new THREE.Color(oscurecer(m.color)), roughness: 0.6 });
      const marca = new THREE.Mesh(new THREE.BoxGeometry(a * 0.86, Math.min(0.012, h * 0.1), Math.min(0.05, f * 0.18)), oscuro);
      marca.userData.ayuda = true; // ayuda visual: no se exporta al .glb
      marca.position.set(0, h + 0.006, f / 2 - Math.min(0.05, f * 0.18) / 2 - Math.min(0.02, f * 0.05));
      g.add(marca);
    }

    const marco = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(a, h, f)),
      new THREE.LineBasicMaterial({ color: sel ? COLOR_CINTA : err ? COLOR_ERROR : 0x2b2f33, transparent: !sel && !err, opacity: sel || err ? 1 : 0.55 }),
    );
    marco.position.y = h / 2;
    g.add(marco);

    const huella = new THREE.Mesh(
      new THREE.PlaneGeometry(a + 0.04, f + 0.04),
      new THREE.MeshBasicMaterial({ color: sel ? COLOR_CINTA : COLOR_ERROR, transparent: true, opacity: sel ? 0.35 : 0.3, depthWrite: false }),
    );
    huella.rotation.x = -Math.PI / 2;
    huella.position.y = 0.004 - m.elevacion * CM;
    huella.visible = sel || err;
    g.add(huella);

    const div = document.createElement('div');
    div.className = 'etiqueta';
    div.textContent = m.nombre;
    const etiqueta = new CSS2DObject(div);
    etiqueta.position.set(0, h + 0.02, 0);
    etiqueta.visible = this.vista === 'plano';
    g.add(etiqueta);
    return { grupo: g, firma, huella, marco, etiqueta, cuerpo, conModelo: !!(m.modelo && modelo) };
  }

  /** Para las pruebas: cómo se ve un mueble (con su modelo o no) y cuántas mallas tiene. */
  formaMueble(id: string): { conModelo: boolean; mallas: number } | null {
    const v = this.visuales.get(id);
    if (!v) return null;
    let mallas = 0;
    v.grupo.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.ayuda && o !== v.huella) mallas++;
    });
    return { conModelo: v.conModelo, mallas };
  }

  /** Mueve el visual de un mueble sin tocar el estado (durante el arrastre). */
  moverTemporal(m: Pick<Mueble, 'id' | 'x' | 'y' | 'giro' | 'elevacion'>): void {
    const vis = this.visuales.get(m.id);
    if (!vis) return;
    this.colocar(vis.grupo, m);
    this.pedirRender();
  }

  // ---------- Cotas y guías ----------

  mostrarAyudas(cotas: readonly Cota[], guias: readonly Guia[]): void {
    liberar(this.grupoAyudas);
    this.grupoAyudas.clear();
    const y = 0.02;
    if (cotas.length) {
      const pos: number[] = [];
      for (const c of cotas) {
        const a = aTres(c.desde[0], c.desde[1]);
        const b = aTres(c.hasta[0], c.hasta[1]);
        pos.push(a.X, y, a.Z, b.X, y, b.Z);
        if (c.distancia < 1) continue;
        const div = document.createElement('div');
        div.className = 'cota-et';
        div.textContent = `${formatoCm(c.distancia)} cm`;
        const et = new CSS2DObject(div);
        et.position.set((a.X + b.X) / 2, y, (a.Z + b.Z) / 2);
        this.grupoAyudas.add(et);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.grupoAyudas.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: COLOR_CINTA, depthTest: false })));
    }
    if (guias.length) {
      const pos: number[] = [];
      for (const g of guias) {
        const a = aTres(g.a[0], g.a[1]);
        const b = aTres(g.b[0], g.b[1]);
        pos.push(a.X, y + 0.002, a.Z, b.X, y + 0.002, b.Z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const lineas = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({ color: COLOR_CINTA, dashSize: 0.05, gapSize: 0.03, depthTest: false }));
      lineas.computeLineDistances();
      this.grupoAyudas.add(lineas);
    }
    this.pedirRender();
  }

  // ---------- Selección y suelo bajo el puntero ----------

  private rayo(ev: { clientX: number; clientY: number }): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camara);
    // Tras reconstruir la planta o un mueble, las mallas nuevas no tienen matriz de mundo hasta el
    // próximo fotograma: sin esto, un clic inmediato no las encontraría.
    this.escena.updateMatrixWorld(true);
  }

  /** Mueble bajo el puntero y altura (cm) del punto tocado, para arrastrar sin paralaje en 3D. */
  muebleBajo(ev: { clientX: number; clientY: number }): { id: string; altura: number } | null {
    this.rayo(ev);
    const objetivos: THREE.Object3D[] = [];
    for (const v of this.visuales.values()) objetivos.push(...v.cuerpo);
    const hit = this.raycaster.intersectObjects(objetivos, false)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && o.userData.id === undefined) o = o.parent;
    const id = o?.userData.id as string | undefined;
    return id && hit ? { id, altura: hit.point.y / CM } : null;
  }

  /** Punto del plano horizontal a la altura `alturaCm` bajo el puntero, en cm de planta. */
  puntoEnPlano(ev: { clientX: number; clientY: number }, alturaCm = 0): Punto | null {
    this.rayo(ev);
    const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), -alturaCm * CM);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plano, p)) return null;
    return [p.x / CM, p.z / CM];
  }

  /** Imagen de la vista actual (se dibuja justo antes, porque el lienzo no conserva el último dibujo). */
  capturaPNG(): Promise<Blob | null> {
    this.dibujar();
    return new Promise((res) => this.renderer.domElement.toBlob(res, 'image/png'));
  }

  /**
   * Modelo 3D .glb de la estancia y los muebles, para juegos o programas 3D: un nodo por muro,
   * hueco y mueble (con el id como nombre), origen en el centro del suelo, materiales estándar y
   * sin ayudas visuales (rejilla, cotas, selección, etiquetas).
   */
  async exportarGLB(espacio: Espacio): Promise<ArrayBuffer> {
    const raiz = new THREE.Group();
    raiz.name = espacio.nombre;
    // El centro de las estancias, no el de lo que se ve: un plano de fondo no mueve el modelo.
    const caja = this.cajaEstancias;
    const c = aTres((caja.minX + caja.maxX) / 2, (caja.minY + caja.maxY) / 2);
    raiz.position.set(-c.X, 0, -c.Z);
    let n = 0;
    const copiaMallas = (origen: THREE.Object3D, destino: THREE.Object3D, excluir: Set<THREE.Object3D>): void => {
      origen.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || excluir.has(o) || o.userData.ayuda) return;
        const mat = o.material;
        // Las mallas de un modelo propio van con su material, sea cual sea (sin iluminación, físico…).
        if (!o.userData.compartido && !(mat instanceof THREE.MeshStandardMaterial) && !(Array.isArray(mat) && mat.every((x) => x instanceof THREE.MeshStandardMaterial))) return;
        const copia = o.clone();
        copia.name = `${destino.name}-pieza-${++n}`;
        for (const m of Array.isArray(copia.material) ? copia.material : [copia.material]) if (!m.name) m.name = `${destino.name}-material`;
        o.updateWorldMatrix(true, false);
        origen.updateWorldMatrix(true, false);
        copia.matrix.copy(new THREE.Matrix4().copy(origen.matrixWorld).invert().multiply(o.matrixWorld));
        copia.matrix.decompose(copia.position, copia.quaternion, copia.scale);
        destino.add(copia);
      });
    };
    const estancia = new THREE.Group();
    estancia.name = 'estancia';
    // Muros del modelo derivado del núcleo (muros.ts): un tabique entre dos estancias va una sola vez,
    // con los huecos ya restados por bandas de altura (lo que se ve en pantalla son paredes por estancia).
    const muros = new THREE.Group();
    muros.name = 'muros';
    const matMuro = new THREE.MeshStandardMaterial({ name: 'muro', color: 0xf7f4ef, roughness: 0.9 });
    const modelo = modeloPlanta(plantaDe(espacio));
    const aXZ = (p: readonly Punto[]): [number, number][] => p.map(([x, y]) => [x * CM, y * CM]);
    let k = 0;
    for (const b of modelo.bandas) {
      for (const pol of b.poligonos) {
        const m = mallaPrismaConAgujeros(aXZ(pol.exterior), pol.agujeros.map(aXZ), b.y0 * CM, b.y1 * CM);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(m.posiciones, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(m.normales, 3));
        geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
        const malla = new THREE.Mesh(geo, matMuro);
        malla.name = `muros-${++k}`;
        muros.add(malla);
      }
    }
    muros.userData = { conexiones: modelo.conexiones };
    estancia.add(muros);
    for (const s of this.suelos) {
      const copia = s.clone();
      copia.userData = { estancia: s.userData.estancia };
      // Con su textura sea cual sea la vista (en el plano se quita) y sin el brillo de la elegida.
      const m = s.material as THREE.MeshStandardMaterial;
      copia.material = new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, map: (m.userData.textura as THREE.Texture | null | undefined) ?? null });
      estancia.add(copia);
    }
    // Pintura de las paredes: las capas de cada muro, estén o no a la vista.
    const pintura = new THREE.Group();
    pintura.name = 'pintura';
    this.grupoEstancia.updateWorldMatrix(true, true);
    this.grupoEstancia.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.name.startsWith('pintura-')) return;
      const copia = o.clone();
      copia.visible = true;
      copia.matrix.copy(new THREE.Matrix4().copy(this.grupoEstancia.matrixWorld).invert().multiply(o.matrixWorld));
      copia.matrix.decompose(copia.position, copia.quaternion, copia.scale);
      pintura.add(copia);
    });
    if (pintura.children.length) estancia.add(pintura);
    const obra = this.grupoEstancia.getObjectByName('obra');
    if (obra) {
      const copia = obra.clone();
      // Sin ayudas (techo inclinado translúcido y su línea): el .glb no depende de la vista.
      for (const o of [...copia.children]) if (o.userData.ayuda) copia.remove(o);
      estancia.add(copia);
    }
    // Escaleras y huecos, sin las líneas de ayuda del plano.
    const escaleras = this.grupoEstancia.getObjectByName('escaleras');
    if (escaleras) {
      const copia = escaleras.clone();
      const quitar: THREE.Object3D[] = [];
      copia.traverse((o) => {
        if (o.userData.ayuda) quitar.push(o);
      });
      for (const o of quitar) o.parent?.remove(o);
      estancia.add(copia);
    }
    // Hojas de puerta y cristales: mallas estándar de la planta que no son muros ni suelos.
    const huecos = new THREE.Group();
    huecos.name = 'huecos';
    for (const o of this.grupoEstancia.children) {
      if (o instanceof THREE.Mesh && !this.suelos.includes(o) && !o.userData.ayuda && o.material instanceof THREE.MeshStandardMaterial) huecos.add(o.clone());
    }
    estancia.add(huecos);
    raiz.add(estancia);
    const muebles = new THREE.Group();
    muebles.name = 'muebles';
    for (const m of plantaDe(espacio).muebles) {
      const vis = this.visuales.get(m.id);
      if (!vis) continue;
      const g = new THREE.Group();
      g.name = m.id;
      g.position.copy(vis.grupo.position);
      g.rotation.copy(vis.grupo.rotation);
      copiaMallas(vis.grupo, g, new Set([vis.huella]));
      g.userData = { nombre: m.nombre, tipo: m.tipo, ancho: m.ancho, fondo: m.fondo, alto: m.alto };
      muebles.add(g);
    }
    raiz.add(muebles);
    const exportador = new GLTFExporter();
    // trs: posición, giro y escala por nodo (no matrices), para poder moverlos y animarlos en un motor.
    const res = await exportador.parseAsync(raiz, { binary: true, trs: true });
    return res as ArrayBuffer;
  }

  /** Altura de la cámara en cm (en planta, muy por encima de todo). */
  alturaCamara(): number {
    return this.camara.position.y / CM;
  }

  /** Ángulo (rad) en planta hacia el que «mira» la cámara: para que las flechas sigan a la vista. */
  rumboCamara(): number {
    if (this.vista === 'plano') return -Math.PI / 2; // arriba en pantalla = −y en planta
    const d = new THREE.Vector3();
    this.camPersp.getWorldDirection(d);
    return Math.atan2(d.z, d.x);
  }

  private dibujar(): void {
    if (this.vista === '3d') this.actualizarCorte();
    this.renderer.render(this.escena, this.camara);
    this.etiquetas.render(this.escena, this.camara);
  }
}

export function formatoCm(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 });
}
