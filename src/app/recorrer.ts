// Modo «Recorrer» (R2-5): andar por dentro en primera persona. Teclado (WASD para andar, Mayús corre;
// las flechas miran: ← → a los lados y ↑ ↓ arriba y abajo), ratón con Pointer Lock (o arrastrando si el navegador no lo concede) y Esc para salir.
// Con el dedo (R3-3): un mando a la izquierda para andar (a fondo se corre), arrastrar en la vista
// para mirar y «Salir» en la barra; los dos a la vez, cada uno con su dedo.
// La colisión es la del núcleo (recorrido.ts): no se atraviesan muros ni muebles, y sí las puertas.
import type { Espacio, Punto, Segmento } from '../core/index.js';
import { plantaDe } from './plantaActiva.js';
import { alturaTecho, cotaSuelo, distanciaAlContorno, huellasEscaleras, moverConColision, obstaculosEn, pasoEscaleras, puntoDeSalida, puntoEnPoligono, type EstadoRecorrido } from '../core/index.js';
import type { Escena, Vista } from './escena.js';
import { $ } from './ui.js';

export interface AnfitrionRecorrido {
  esp(): Espacio;
  estancia(): string;
  escena: Escena;
  ponerVista(v: Vista): void;
  aviso(texto: string): void;
  /** Al llegar arriba o abajo por una escalera: pasar a esa planta sin salir del recorrido. */
  cambiarPlanta(id: string): void;
}

/** Velocidades (cm/s) y giro con las flechas (rad/s): ← → a los lados; ↑ ↓ arriba y abajo, hasta CABECEO_MAX. */
const ANDAR = 140;
const CORRER = 320;
const GIRO = 1.8;
const GIRO_VERTICAL = 1.2;
const CABECEO_MAX = 1.2;
const SENSIBILIDAD = 0.0025;
/** Con el dedo se mira algo más rápido que con el ratón (la pantalla es más pequeña). */
const SENSIBILIDAD_DEDO = 0.006;
/** Radio útil del mando (px) y fracción a partir de la cual se corre. */
const RADIO_MANDO = 52;
const A_FONDO = 0.92;

export class Recorrido {
  activo = false;
  pos: Punto = [0, 0];
  /** Rumbo en planta (rad): 0 = hacia +x, π/2 = hacia +y (abajo en el plano). */
  rumbo = 0;
  cabeceo = 0;
  private readonly teclas = new Set<string>();
  private segs: Segmento[] = [];
  /** Planta en la que se está y escalera que se pisa (si se pisa una). */
  estado: EstadoRecorrido = { planta: '', escalera: null };
  private firma = '';
  private ultimo = 0;
  private arrastre: [number, number] | null = null;
  private vistaAntes: Vista = 'plano';
  /** ¿Tenía el ratón capturado (Pointer Lock)? Para salir al soltarlo. */
  private conRaton = false;
  /** Mando táctil: hacia dónde se empuja (x a la derecha, y hacia abajo; módulo ≤ 1) y con qué dedo. */
  private analogico: Punto = [0, 0];
  private dedoMando: number | null = null;
  /** Dedo que mira arrastrando en la vista. */
  private dedoMirar: { id: number; x: number; y: number } | null = null;
  /** ¿Se usa con el dedo? (pantalla táctil o un toque en la vista): se muestra el mando. */
  private tactil = false;

  constructor(private readonly a: AnfitrionRecorrido) {
    $('b-recorrer').addEventListener('click', () => this.alternar());
    window.addEventListener('keyup', (ev) => this.teclas.delete(ev.key.toLowerCase()));
    window.addEventListener('blur', () => this.teclas.clear());
    const lienzo = a.escena.renderer.domElement;
    // Pulsar en la vista mientras se recorre pide el ratón (Pointer Lock); si no se concede, se mira arrastrando.
    lienzo.addEventListener(
      'pointerdown',
      (ev) => {
        if (!this.activo) return;
        ev.stopImmediatePropagation();
        if (ev.pointerType === 'touch') {
          // Con el dedo no hay Pointer Lock: se mira arrastrando, y aparece el mando para andar. Un segundo
          // dedo en la vista no le quita la mirada al primero (revisión independiente, 11).
          if (!this.dedoMirar) this.dedoMirar = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
          this.ponerTactil(true);
          return;
        }
        this.arrastre = [ev.clientX, ev.clientY];
        if (document.pointerLockElement !== lienzo) {
          try {
            void (lienzo.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => undefined);
          } catch {
            /* sin Pointer Lock: se mira arrastrando */
          }
        }
      },
      { capture: true },
    );
    window.addEventListener('pointerup', (ev) => {
      this.arrastre = null;
      if (this.dedoMirar?.id === ev.pointerId) this.dedoMirar = null;
    });
    window.addEventListener('pointercancel', (ev) => {
      if (this.dedoMirar?.id === ev.pointerId) this.dedoMirar = null;
    });
    lienzo.addEventListener('pointermove', (ev) => {
      const d = this.dedoMirar;
      if (!this.activo || !d || d.id !== ev.pointerId) return;
      const k = SENSIBILIDAD_DEDO / SENSIBILIDAD;
      this.mirar((ev.clientX - d.x) * k, (ev.clientY - d.y) * k);
      d.x = ev.clientX;
      d.y = ev.clientY;
    });
    this.conectarMando();
    // Con el ratón capturado, el primer Esc lo usa el navegador para soltarlo y la página no lo recibe:
    // soltar el ratón (Esc, cambiar de ventana) sale del recorrido, como dice el aviso.
    document.addEventListener('pointerlockchange', () => {
      if (this.activo && document.pointerLockElement !== lienzo && this.conRaton) this.salir();
      this.conRaton = document.pointerLockElement === lienzo;
    });
    // Clic derecho: el menú contextual se come el «keyup»; se suelta todo para no quedarse andando.
    window.addEventListener('contextmenu', () => this.teclas.clear());
    window.addEventListener('mousemove', (ev) => {
      if (!this.activo) return;
      if (document.pointerLockElement === lienzo) this.mirar(ev.movementX, ev.movementY);
      else if (this.arrastre) {
        this.mirar(ev.clientX - this.arrastre[0], ev.clientY - this.arrastre[1]);
        this.arrastre = [ev.clientX, ev.clientY];
      }
    });
  }

  /** Mando táctil: el palo sigue al dedo (hasta su borde) y su desplazamiento es la velocidad. */
  private conectarMando(): void {
    const mando = $('mando');
    const palo = $('mando-palo');
    const mover = (ev: PointerEvent): void => {
      const r = mando.getBoundingClientRect();
      let dx = ev.clientX - (r.left + r.width / 2);
      let dy = ev.clientY - (r.top + r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > RADIO_MANDO) {
        dx = (dx / l) * RADIO_MANDO;
        dy = (dy / l) * RADIO_MANDO;
      }
      this.analogico = [dx / RADIO_MANDO, dy / RADIO_MANDO];
      palo.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const soltar = (ev: PointerEvent): void => {
      if (ev.pointerId !== this.dedoMando) return;
      this.dedoMando = null;
      this.analogico = [0, 0];
      palo.style.transform = '';
      mando.classList.remove('activo');
    };
    mando.addEventListener('pointerdown', (ev) => {
      if (!this.activo || (this.dedoMando !== null && this.dedoMando !== ev.pointerId)) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.dedoMando = ev.pointerId;
      mando.setPointerCapture(ev.pointerId);
      mando.classList.add('activo');
      mover(ev);
    });
    mando.addEventListener('pointermove', (ev) => {
      if (ev.pointerId === this.dedoMando) mover(ev);
    });
    mando.addEventListener('pointerup', soltar);
    mando.addEventListener('pointercancel', soltar);
    mando.addEventListener('lostpointercapture', soltar);
  }

  private ponerTactil(si: boolean): void {
    this.tactil = si;
    $('mando').hidden = !(si && this.activo);
  }

  private mirar(dx: number, dy: number): void {
    this.rumbo += dx * SENSIBILIDAD;
    this.cabeceo = Math.max(-CABECEO_MAX, Math.min(CABECEO_MAX, this.cabeceo - dy * SENSIBILIDAD));
    this.mirarAhora();
  }

  /**
   * Ojos a 160 cm sobre lo que se pisa (en una escalera, su rampa) o, bajo un techo más bajo (o
   * inclinado), 12 cm por debajo de él. Al recorrer se dibujan todas las plantas (escena.ts).
   */
  private mirarAhora(): void {
    const e = this.a.esp();
    const pl = plantaDe(e);
    if (this.estado.escalera) {
      const suelo = cotaSuelo(e, this.estado, this.pos) - pl.nivel;
      this.a.escena.mirarDesde(this.pos, this.rumbo, this.cabeceo, suelo + 160);
      return;
    }
    // Dentro de una estancia, su techo; en el umbral de una puerta (fuera de las dos), el más bajo de
    // las estancias que están a un grueso de muro.
    const dentro = pl.estancias.find((x) => puntoEnPoligono(this.pos, x.contorno));
    const cerca = dentro ? [dentro] : pl.estancias.filter((x) => distanciaAlContorno(this.pos, x.contorno) <= 40);
    const techo = Math.min(...cerca.map((x) => alturaTecho(x, this.pos)));
    const ojos = Number.isFinite(techo) ? Math.max(20, Math.min(160, techo - 12)) : 160;
    this.a.escena.mirarDesde(this.pos, this.rumbo, this.cabeceo, ojos);
  }

  alternar(): void {
    if (this.activo) this.salir();
    else this.entrar();
  }

  entrar(): void {
    const pl = plantaDe(this.a.esp());
    this.vistaAntes = this.a.escena.vista;
    // El foco no se queda en «Recorrer»: Intro o Espacio lo volverían a pulsar.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.a.ponerVista('3d');
    this.a.escena.empezarRecorrido();
    this.activo = true;
    this.estado = { planta: pl.id, escalera: null };
    this.actualizar(true);
    this.pos = puntoDeSalida(pl, this.a.estancia(), huellasEscaleras(this.a.esp(), pl.id));
    // Se empieza mirando hacia el lado más largo de la estancia.
    const s = pl.estancias.find((x) => x.id === this.a.estancia()) ?? pl.estancias[0]!;
    const xs = s.contorno.map((q) => q[0]);
    const ys = s.contorno.map((q) => q[1]);
    this.rumbo = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 0 : Math.PI / 2;
    this.cabeceo = 0;
    this.mirarAhora();
    $('b-recorrer').setAttribute('aria-pressed', 'true');
    $('b-recorrer').textContent = 'Salir';
    document.body.classList.add('recorriendo');
    this.ponerTactil(this.tactil || matchMedia('(pointer: coarse)').matches);
    this.a.aviso(
      this.tactil
        ? 'Recorrer: el mando de la izquierda para andar (a fondo, corres), arrastra en la vista para mirar y «Salir» para terminar.'
        : 'Recorrer: W A S D para andar (Mayús corre), las flechas o el ratón para mirar (pulsa en la vista) y Esc para salir.',
    );
    this.ultimo = performance.now();
    requestAnimationFrame((t) => this.bucle(t));
  }

  salir(vista: Vista = this.vistaAntes): void {
    if (!this.activo) return;
    this.activo = false;
    this.teclas.clear();
    this.conRaton = false;
    this.analogico = [0, 0];
    // Al salir con el dedo en el mando, se suelta su captura y deja de verse pulsado (revisión independiente, 11).
    const mando = $('mando');
    if (this.dedoMando !== null && mando.hasPointerCapture?.(this.dedoMando)) mando.releasePointerCapture(this.dedoMando);
    mando.classList.remove('activo');
    this.dedoMando = null;
    this.dedoMirar = null;
    $('mando-palo').style.transform = '';
    mando.hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.a.escena.terminarRecorrido();
    this.a.ponerVista(vista);
    $('b-recorrer').setAttribute('aria-pressed', 'false');
    $('b-recorrer').textContent = 'Recorrer';
    document.body.classList.remove('recorriendo');
  }

  /** Tras un cambio del espacio (un agente, deshacer) o de estado: recalcula contra qué se choca. */
  actualizar(forzar = false): void {
    if (!this.activo) return;
    const e = this.a.esp();
    const firma = JSON.stringify([e.plantas, this.estado]);
    if (!forzar && firma === this.firma) return;
    this.firma = firma;
    try {
      this.segs = obstaculosEn(e, this.estado);
    } catch {
      this.segs = [];
    }
  }

  /**
   * Teclas mientras se recorre. Devuelve true si los atajos de la página no deben actuar; sólo
   * anula lo que hace el navegador con las teclas propias (andar, mirar, salir), no con Tab ni F5.
   */
  tecla(ev: KeyboardEvent): boolean {
    if (!this.activo) return false;
    const k = ev.key.toLowerCase();
    if (k === 'escape' || k === 'p') {
      ev.preventDefault();
      this.salir();
      return true;
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      ev.preventDefault();
      this.teclas.add(k);
      return true;
    }
    // Mientras se recorre no se editan muebles con el teclado.
    return !(ev.ctrlKey || ev.metaKey);
  }

  /** Lo que avanza en un intervalo según las teclas pulsadas (cm, en planta). */
  private paso(dt: number): Punto {
    const t = this.teclas;
    if (t.has('arrowleft')) this.rumbo -= GIRO * dt;
    if (t.has('arrowright')) this.rumbo += GIRO * dt;
    // ↑ ↓ miran arriba y abajo (antes repetían W y S).
    if (t.has('arrowup')) this.cabeceo = Math.min(CABECEO_MAX, this.cabeceo + GIRO_VERTICAL * dt);
    if (t.has('arrowdown')) this.cabeceo = Math.max(-CABECEO_MAX, this.cabeceo - GIRO_VERTICAL * dt);
    let adelante = (t.has('w') ? 1 : 0) - (t.has('s') ? 1 : 0);
    let lado = (t.has('d') ? 1 : 0) - (t.has('a') ? 1 : 0);
    let v = (t.has('shift') ? CORRER : ANDAR) * dt;
    // El mando: empujar hacia arriba avanza; la velocidad crece con lo que se empuja y a fondo se corre.
    const [ax, ay] = this.analogico;
    const m = Math.min(1, Math.hypot(ax, ay));
    if (!adelante && !lado && m > 0.12) {
      adelante = -ay;
      lado = ax;
      v = (m >= A_FONDO ? CORRER : ANDAR * (m / A_FONDO)) * dt;
    }
    if (!adelante && !lado) return [0, 0];
    const f: Punto = [Math.cos(this.rumbo), Math.sin(this.rumbo)];
    // A la derecha de quien mira (en planta, con y hacia abajo): f girado 90° en el sentido del reloj.
    const d: Punto = [-f[1], f[0]];
    const l = Math.hypot(adelante, lado);
    return [((f[0] * adelante + d[0] * lado) / l) * v, ((f[1] * adelante + d[1] * lado) / l) * v];
  }

  private bucle(t: number): void {
    if (!this.activo) return;
    const dt = Math.min(0.1, Math.max(0, (t - this.ultimo) / 1000));
    this.ultimo = t;
    if (($('dialogo') as HTMLDialogElement).open) this.teclas.clear();
    const delta = this.paso(dt);
    if (delta[0] || delta[1] || ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].some((k) => this.teclas.has(k))) {
      if (delta[0] || delta[1]) {
        const antes = this.pos;
        this.pos = moverConColision(this.pos, delta, this.segs);
        const nuevo = pasoEscaleras(this.a.esp(), this.estado, this.pos, antes);
        if (nuevo.planta !== this.estado.planta || nuevo.escalera !== this.estado.escalera) {
          const cambiaPlanta = nuevo.planta !== this.estado.planta;
          this.estado = nuevo;
          if (cambiaPlanta) this.a.cambiarPlanta(nuevo.planta);
          this.actualizar(true);
        }
      }
      this.mirarAhora();
    }
    requestAnimationFrame((t2) => this.bucle(t2));
  }

  /** Para las pruebas: colocar a la persona en un punto y con un rumbo (grados), en la planta que se ve. */
  colocar(x: number, y: number, grados: number): void {
    this.pos = [x, y];
    // Si ya se está en una escalera y el punto sigue en ella, se sigue en ella (con escaleras una encima
    // de otra, desde el suelo no se sabe en cuál se está).
    const e = this.a.esp();
    const sigue = this.estado.escalera ? pasoEscaleras(e, this.estado, this.pos) : null;
    this.estado = sigue && sigue.escalera === this.estado.escalera ? sigue : pasoEscaleras(e, { planta: plantaDe(e).id, escalera: null }, this.pos);
    this.actualizar(true);
    this.rumbo = (grados * Math.PI) / 180;
    this.cabeceo = 0;
    if (this.activo) this.mirarAhora();
  }
}
