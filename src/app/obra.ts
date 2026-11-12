// Panel «Obra» (R2-4): añadir columnas, pilares, radiadores, enchufes, vigas, escalones y techo
// inclinado a la estancia elegida, y cambiar sus medidas en una ficha. La geometría y la validación
// son del núcleo; aquí se eligen valores razonables para empezar y se editan.
import type { Elemento, Escalera, Espacio, Estancia, Faldon } from '../core/index.js';
import {
  agregarElemento, agregarEscalera, agregarPlanta, alturaEscalera, cajaContorno, editarElemento, editarEscalera, estancia as estanciaDe, geometriaDe, longitudMuro, peldanosPorDefecto,
  plantaDeEncima, ponerFaldon, quitarElemento, quitarEscalera, quitarFaldon,
} from '../core/index.js';
import { plantaDe } from './plantaActiva.js';
import { $ } from './ui.js';

export interface AnfitrionObra {
  esp(): Espacio;
  aplicar(e: Espacio): void;
  estancia(): string;
  aviso(texto: string): void;
  confirmar(titulo: string, texto: string, aceptar: string): Promise<boolean>;
}

const NOMBRES: Record<string, string> = {
  columna: 'Columna',
  pilar: 'Pilar',
  radiador: 'Radiador',
  chimenea: 'Chimenea',
  enchufe: 'Enchufe',
  interruptor: 'Interruptor',
  toma: 'Toma',
  viga: 'Viga',
  escalon: 'Escalón',
};

/** Campos que se pueden cambiar en la ficha, por forma, con su etiqueta y su unidad. */
const CAMPOS: Record<Elemento['forma'], [string, string][]> = {
  exento: [['x', 'X'], ['y', 'Y'], ['ancho', 'Ancho'], ['fondo', 'Fondo'], ['alto', 'Alto (vacío = techo)'], ['elevacion', 'Elevación'], ['giro', 'Giro (°)']],
  adosado: [['muro', 'Pared'], ['desde', 'Desde'], ['ancho', 'Ancho'], ['fondo', 'Fondo'], ['alto', 'Alto (vacío = techo)'], ['elevacion', 'Elevación']],
  punto: [['muro', 'Pared'], ['desde', 'Desde'], ['altura', 'Altura']],
  viga: [['deX', 'Desde X'], ['deY', 'Desde Y'], ['aX', 'Hasta X'], ['aY', 'Hasta Y'], ['canto', 'Canto'], ['ancho', 'Ancho']],
};

export class PanelObra {
  /** Elemento o faldón elegido en la lista: «el:id» o «faldon:muro». */
  private elegido: string | null = null;

  constructor(private readonly a: AnfitrionObra) {
    for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-obra]')) {
      b.addEventListener('click', () => (b.dataset.obra === 'escalera' ? void this.agregarEscalera() : this.agregar(b.dataset.obra!)));
    }
    $('lista-obra').addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button[data-obra-id]') as HTMLButtonElement | null;
      if (!b) return;
      this.elegido = this.elegido === b.dataset.obraId ? null : b.dataset.obraId!;
      this.pintar();
    });
    $('ficha-obra').addEventListener('change', (ev) => {
      const campo = ev.target as HTMLInputElement | HTMLSelectElement;
      if (this.elegido?.startsWith('esc:')) this.cambiarEscalera(campo);
      else this.cambiar(campo as HTMLInputElement);
    });
    $('ficha-obra').addEventListener('submit', (ev) => ev.preventDefault());
    $('obra-quitar').addEventListener('click', () => this.quitar());
  }

  private est(): Estancia {
    return estanciaDe(this.a.esp(), this.a.estancia()).estancia;
  }

  /** Ejecuta un cambio y repinta (el elegido puede haber cambiado después de aplicar el espacio). */
  private intentar(f: () => void): void {
    try {
      f();
    } catch (e) {
      // En la ficha las paredes se numeran desde 1; el núcleo, desde 0.
      const m = (e as Error).message
        .replace(/^El resultado no es válido:\s*-?\s*/, '')
        .replace(/^[\w.[\]]+:\s*/, '')
        .replace(/no existe el muro (\d+) \(hay (\d+): 0 a \d+\)/, (_, n: string, t: string) => `no existe la pared ${Number(n) + 1} (hay ${t})`)
        .replace(/en el muro (\d+)/g, (_, n: string) => `en la pared ${Number(n) + 1}`);
      this.a.aviso(m);
      // El campo vuelve a su valor real (no se queda con el rechazado).
      $('campos-obra').dataset.firma = '';
    }
    this.pintar();
  }

  /** Añade un elemento con medidas de partida en la estancia elegida (o el techo inclinado). */
  private agregar(tipo: string): void {
    const s = this.est();
    const c = cajaContorno(s.contorno);
    const cx = Math.round((c.minX + c.maxX) / 2);
    const cy = Math.round((c.minY + c.maxY) / 2);
    // La pared más larga, para los adosados; el radiador y el pilar, centrados en ella.
    const largos = s.contorno.map((_, i) => longitudMuro(s.contorno, i));
    const muro = largos.indexOf(Math.max(...largos));
    const centrado = (ancho: number): number => Math.max(0, Math.round((largos[muro]! - ancho) / 2));
    this.intentar(() => {
      if (tipo === 'buhardilla') {
        const libre = s.contorno.findIndex((_, i) => !(s.faldones ?? []).some((f) => f.muro === i));
        const m = libre < 0 ? 0 : libre;
        const faldon: Faldon = { muro: m, alturaEnMuro: Math.round(s.altura * 0.5), alcance: Math.round(Math.min(200, Math.min(c.maxX - c.minX, c.maxY - c.minY) / 2)) };
        this.a.aplicar(ponerFaldon(this.a.esp(), faldon, s.id));
        this.elegido = `faldon:${m}`;
        return;
      }
      const datos: Record<string, unknown> & { forma: Elemento['forma'] } =
        tipo === 'columna' ? { forma: 'exento', x: cx, y: cy, ancho: 30, redondo: true }
          : tipo === 'escalon' ? { forma: 'exento', x: cx, y: cy, ancho: 100, fondo: 30, alto: 18 }
            : tipo === 'pilar' ? { forma: 'adosado', muro, desde: centrado(30), ancho: 30, fondo: 30 }
              : tipo === 'radiador' ? { forma: 'adosado', muro, desde: centrado(80), ancho: 80, fondo: 10, alto: 60, elevacion: 15 }
                : tipo === 'enchufe' ? { forma: 'punto', muro, desde: centrado(0), altura: 30 }
                  : { forma: 'viga', de: [c.minX, cy], a: [c.maxX, cy], ancho: 20, canto: 25 };
      const r = agregarElemento(this.a.esp(), { ...datos, tipo }, s.id);
      this.a.aplicar(r.espacio);
      this.elegido = `el:${r.id}`;
    });
  }

  /**
   * Escalera recta de peldaños cómodos (huella de 25 cm) a lo largo del lado mayor de la estancia, con
   * el pie hacia un lado y sitio para pasar. Si no hay planta encima, ofrece crearla con la misma huella.
   */
  private async agregarEscalera(): Promise<void> {
    let e = this.a.esp();
    const pl = plantaDe(e);
    if (!plantaDeEncima(e, pl)) {
      const ok = await this.a.confirmar('No hay planta encima', `La escalera sube a la planta de encima de «${pl.nombre}», que todavía no existe. ¿Añadirla con la misma huella (estancias y ventanas, sin muebles)?`, 'Añadir planta y escalera');
      if (!ok) return;
      try {
        e = agregarPlanta(e, { copiarDe: pl.id, conVentanas: true }).espacio;
      } catch (err) {
        return this.a.aviso((err as Error).message);
      }
    }
    const s = this.est();
    const c = cajaContorno(s.contorno);
    const arriba = plantaDeEncima(e, pl)!;
    const n = peldanosPorDefecto(arriba.nivel - pl.nivel);
    const ancho = c.maxX - c.minX;
    const largo = c.maxY - c.minY;
    const horizontal = ancho >= largo;
    const L = Math.max(100, Math.min(n * 25, (horizontal ? ancho : largo) - 140));
    const cx = Math.round((c.minX + c.maxX) / 2);
    const cy = Math.round((c.minY + c.maxY) / 2);
    const datos = horizontal ? { x: Math.round(cx - L / 2), y: cy, giro: 270 } : { x: cx, y: Math.round(cy - L / 2), giro: 0 };
    this.intentar(() => {
      const r = agregarEscalera(e, { ...datos, forma: 'recta', ancho: 90, largo: Math.round(L) }, pl.id);
      this.a.aplicar(r.espacio);
      this.elegido = `esc:${r.id}`;
    });
  }

  private escalera(): Escalera | null {
    const id = this.elegido?.startsWith('esc:') ? this.elegido.slice(4) : null;
    return (id && (plantaDe(this.a.esp()).escaleras ?? []).find((x) => x.id === id)) || null;
  }

  private cambiarEscalera(campo: HTMLInputElement | HTMLSelectElement): void {
    const esc = this.escalera();
    const clave = campo.dataset.campo;
    if (!esc || !clave) return;
    const texto = campo.value.trim();
    this.intentar(() => {
      let cambios: Partial<Escalera>;
      if (clave === 'forma') {
        const forma = texto as Escalera['forma'];
        const total = esc.forma === 'recta' ? (esc.largo ?? 300) : esc.tramos ? esc.tramos[0] + esc.tramos[1] : 300;
        cambios =
          forma === 'caracol' ? { forma, ancho: esc.forma === 'caracol' ? esc.ancho : Math.min(esc.ancho, 70) }
          : forma === 'recta' ? { forma, largo: esc.forma === 'recta' ? esc.largo : total }
          : { forma, tramos: esc.tramos ?? [Math.round(total * 0.6), Math.round(total * 0.4)] };
      } else if (clave === 'gira') cambios = { gira: texto === 'izquierda' ? 'izquierda' : 'derecha' };
      else if (clave === 'peldanos' && texto === '') cambios = { peldanos: undefined };
      else {
        const v = Number(texto.replace(',', '.'));
        if (texto === '' || !Number.isFinite(v)) return this.pintar();
        if (clave === 'tramo1' || clave === 'tramo2') cambios = { tramos: clave === 'tramo1' ? [v, esc.tramos![1]] : [esc.tramos![0], v] };
        else cambios = { [clave]: v } as Partial<Escalera>;
      }
      this.a.aplicar(editarEscalera(this.a.esp(), esc.id, cambios));
    });
  }

  private cambiar(campo: HTMLInputElement): void {
    const clave = campo.dataset.campo;
    if (!clave || !this.elegido) return;
    const vacio = campo.value.trim() === '';
    const valor = Number(campo.value);
    if (!vacio && !Number.isFinite(valor)) return;
    this.intentar(() => {
      if (this.elegido!.startsWith('faldon:')) {
        const s = this.est();
        const f = (s.faldones ?? []).find((x) => x.muro === Number(this.elegido!.slice(7)));
        if (!f || vacio) return this.pintar();
        const nuevo = { ...f, [clave]: clave === 'muro' ? valor - 1 : valor };
        if (nuevo.muro !== f.muro && (s.faldones ?? []).some((x) => x.muro === nuevo.muro)) {
          this.a.aviso(`La pared ${nuevo.muro + 1} ya tiene techo inclinado: cámbialo en el suyo o quítalo antes.`);
          return;
        }
        let e = this.a.esp();
        if (nuevo.muro !== f.muro) e = quitarFaldon(e, f.muro, s.id);
        this.a.aplicar(ponerFaldon(e, nuevo, s.id));
        this.elegido = `faldon:${nuevo.muro}`;
        return;
      }
      const id = this.elegido!.slice(3);
      // «Alto» vacío = hasta el techo (se quita el campo); la pared se muestra desde 1.
      if (vacio && clave !== 'alto') return this.pintar();
      // Los puntos de la viga se editan por coordenadas sueltas.
      if (['deX', 'deY', 'aX', 'aY'].includes(clave)) {
        const el = (this.est().elementos ?? []).find((x) => x.id === id);
        if (el?.forma !== 'viga') return;
        const de: [number, number] = [clave === 'deX' ? valor : el.de[0], clave === 'deY' ? valor : el.de[1]];
        const a: [number, number] = [clave === 'aX' ? valor : el.a[0], clave === 'aY' ? valor : el.a[1]];
        this.a.aplicar(editarElemento(this.a.esp(), id, { de, a }));
        return;
      }
      this.a.aplicar(editarElemento(this.a.esp(), id, { [clave]: vacio ? undefined : clave === 'muro' ? valor - 1 : valor }));
    });
  }

  private quitar(): void {
    if (!this.elegido) return;
    const s = this.est();
    this.intentar(() => {
      if (this.elegido!.startsWith('esc:')) this.a.aplicar(quitarEscalera(this.a.esp(), this.elegido!.slice(4)));
      else if (this.elegido!.startsWith('faldon:')) this.a.aplicar(quitarFaldon(this.a.esp(), Number(this.elegido!.slice(7)), s.id));
      else this.a.aplicar(quitarElemento(this.a.esp(), this.elegido!.slice(3)));
      this.elegido = null;
    });
  }

  /** Lista de la obra de la estancia elegida y ficha del elegido. */
  pintar(): void {
    const s = this.est();
    const elementos = s.elementos ?? [];
    const faldones = s.faldones ?? [];
    const e = this.a.esp();
    const pl = plantaDe(e);
    const escaleras = pl.escaleras ?? [];
    const claves = [...elementos.map((el) => `el:${el.id}`), ...faldones.map((f) => `faldon:${f.muro}`), ...escaleras.map((x) => `esc:${x.id}`)];
    if (this.elegido && !claves.includes(this.elegido)) this.elegido = null;
    $('contador-obra').textContent = claves.length ? String(claves.length) : '';
    const ul = $('lista-obra');
    ul.replaceChildren(
      ...elementos.map((el) => fila(`el:${el.id}`, el.id === el.tipo ? (NOMBRES[el.tipo] ?? el.tipo) : `${NOMBRES[el.tipo] ?? el.tipo} · ${el.id}`, this.elegido)),
      ...faldones.map((f) => fila(`faldon:${f.muro}`, `Techo inclinado · pared ${f.muro + 1}`, this.elegido)),
      ...escaleras.map((x) => fila(`esc:${x.id}`, `Escalera ${x.forma === 'recta' ? 'recta' : x.forma === 'L' ? 'en L' : x.forma === 'caracol' ? 'de caracol' : 'de dos tramos'} · sube a ${e.plantas.find((p) => p.id === x.hasta)?.nombre ?? x.hasta}`, this.elegido)),
    );
    const ficha = $('ficha-obra');
    ficha.hidden = !this.elegido;
    if (!this.elegido) return;
    const campos = $('campos-obra');
    let pares: [string, string, number | string | undefined, [string, string][]?][];
    const esc = this.escalera();
    if (esc) {
      const geo = geometriaDe(e, pl, esc);
      pares = [
        ['forma', 'Forma', esc.forma, [['recta', 'Recta'], ['L', 'En L'], ['U', 'Dos tramos (U)'], ['caracol', 'De caracol']]],
        ['x', 'Pie: X', esc.x], ['y', 'Pie: Y', esc.y], ['giro', 'Giro (°)', esc.giro], ['ancho', esc.forma === 'caracol' ? 'Ancho del peldaño' : 'Ancho', esc.ancho],
        ...(esc.forma === 'recta'
          ? [['largo', 'Largo', esc.largo] as [string, string, number | undefined]]
          : esc.forma === 'caracol'
            ? ([['gira', 'Gira a la', esc.gira ?? 'derecha', [['derecha', 'derecha de quien sube'], ['izquierda', 'izquierda de quien sube']]], ['poste', 'Poste (diámetro)', esc.poste ?? 20], ['vuelta', 'Vuelta (°)', esc.vuelta ?? 360]] as [string, string, number | string | undefined, [string, string][]?][])
            : [['tramo1', 'Tramo 1', esc.tramos![0]], ['tramo2', 'Tramo 2', esc.tramos![1]], ['gira', 'Gira a la', esc.gira, [['derecha', 'derecha de quien sube'], ['izquierda', 'izquierda de quien sube']]]] as [string, string, number | string | undefined, [string, string][]?][]),
        ...(esc.forma === 'U' ? [['ojo', 'Ojo (hueco entre tramos)', esc.ojo ?? 0] as [string, string, number]] : []),
        ['peldanos', `Peldaños (vacío = ${geo.peldanos} automáticos)`, esc.peldanos],
      ];
    } else if (this.elegido.startsWith('faldon:')) {
      const f = faldones.find((x) => `faldon:${x.muro}` === this.elegido)!;
      pares = [['muro', 'Pared', f.muro + 1], ['alturaEnMuro', 'Altura junto a la pared', f.alturaEnMuro], ['alcance', 'Distancia hasta el techo normal', f.alcance]];
    } else {
      const el = elementos.find((x) => `el:${x.id}` === this.elegido)! as unknown as Record<string, number | undefined> & Elemento;
      const valor = (k: string): number | undefined =>
        el.forma === 'viga' && ['deX', 'deY', 'aX', 'aY'].includes(k) ? (k.startsWith('de') ? el.de : el.a)[k.endsWith('X') ? 0 : 1] : k === 'muro' ? (el[k] as number) + 1 : (el[k] as number | undefined);
      pares = CAMPOS[el.forma].map(([k, et]) => [k, et, valor(k)]);
    }
    // Se repinta sólo si cambian los campos o sus valores (no mientras se escribe en uno).
    const firma = JSON.stringify([this.elegido, pares]);
    if (campos.dataset.firma === firma) return;
    campos.dataset.firma = firma;
    campos.replaceChildren(
      ...pares.map(([k, etiqueta, v, opciones]) => {
        const l = document.createElement('label');
        l.className = 'campo';
        if (opciones) {
          l.innerHTML = '<span></span><span class="entrada"><select></select></span>';
          l.querySelector('span')!.textContent = etiqueta;
          const sel = l.querySelector('select')!;
          sel.dataset.campo = k;
          for (const [valor, texto] of opciones) {
            const o = document.createElement('option');
            o.value = valor;
            o.textContent = texto;
            sel.append(o);
          }
          sel.value = String(v);
          return l;
        }
        const unidad = k === 'muro' || k === 'giro' || k === 'peldanos' || k === 'vuelta' ? '' : '<i>cm</i>';
        l.innerHTML = `<span></span><span class="entrada"><input type="number" inputmode="decimal" step="1">${unidad}</span>`;
        l.querySelector('span')!.textContent = etiqueta;
        const input = l.querySelector('input')!;
        input.dataset.campo = k;
        input.value = v === undefined ? '' : String(Math.round(Number(v) * 10) / 10);
        return l;
      }),
    );
  }
}

function fila(clave: string, texto: string, elegido: string | null): HTMLLIElement {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.obraId = clave;
  b.textContent = texto;
  b.setAttribute('aria-current', String(clave === elegido));
  li.append(b);
  return li;
}
