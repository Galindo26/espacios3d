import earcut from 'earcut';

// Escritor de glTF 2.0 binario (.glb) sin three ni Node, y mallas sencillas con normales planas.
// Unidades en metros; sistema de glTF: y hacia arriba, mano derecha; caras exteriores en sentido
// antihorario vistas desde fuera.

export type Vec3 = [number, number, number];
export type Cuaternion = [number, number, number, number];

export interface GeometriaGLB {
  posiciones: Float32Array;
  normales: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export interface PrimitivaGLB extends GeometriaGLB {
  /** Índice en `materiales`. */
  material: number;
}

export interface NodoGLB {
  nombre: string;
  traslacion?: Vec3;
  /** Cuaternión [x, y, z, w]; se normaliza si se desvía poco de la unidad. */
  rotacion?: Cuaternion;
  escala?: Vec3;
  malla?: { primitivas: PrimitivaGLB[] };
  hijos?: NodoGLB[];
  /** Datos propios serializables a JSON (glTF «extras»). */
  extras?: Record<string, unknown>;
}

export interface MaterialGLB {
  nombre: string;
  /** sRGB 0–1 y alfa; se guarda en lineal en baseColorFactor. */
  color: [number, number, number, number];
  metalico: number;
  rugosidad: number;
  /** alphaMode BLEND (si no, OPAQUE). */
  transparente?: boolean;
}

export interface EntradaGLB {
  nombreEscena: string;
  nodos: NodoGLB[];
  materiales: MaterialGLB[];
  generador: string;
}

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

/** Componente de color sRGB (0–1) → lineal. */
export function srgbALineal(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const finitos = (v: readonly number[], que: string): void => {
  if (v.some((x) => !Number.isFinite(x))) throw new Error(`GLB: ${que} con valores no finitos`);
};

const entre01 = (x: number, que: string): number => {
  if (!Number.isFinite(x) || x < 0 || x > 1) throw new Error(`GLB: ${que} fuera de 0–1 (${x})`);
  return x;
};

/** Construye un .glb (glTF 2.0 binario) con una escena, sus nodos (TRS), mallas y materiales PBR. */
export function escribirGLB(entrada: EntradaGLB): Uint8Array {
  const json: Record<string, unknown> & {
    nodes: Record<string, unknown>[];
    meshes: Record<string, unknown>[];
    accessors: Record<string, unknown>[];
    bufferViews: Record<string, unknown>[];
  } = {
    asset: { version: '2.0', generator: entrada.generador },
    scene: 0,
    scenes: [] as unknown[],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
  };

  const materiales = entrada.materiales.map((m, i) => {
    if (m.color.length !== 4) throw new Error(`GLB: el material ${i} necesita color [r, g, b, a]`);
    const [r, g, b, a] = m.color.map((c, k) => entre01(c, `color del material «${m.nombre}» (${k})`)) as [number, number, number, number];
    const mat: Record<string, unknown> = {
      name: m.nombre,
      pbrMetallicRoughness: {
        baseColorFactor: [srgbALineal(r), srgbALineal(g), srgbALineal(b), a],
        metallicFactor: entre01(m.metalico, `metálico de «${m.nombre}»`),
        roughnessFactor: entre01(m.rugosidad, `rugosidad de «${m.nombre}»`),
      },
    };
    if (m.transparente) mat.alphaMode = 'BLEND';
    return mat;
  });

  // Datos binarios: cada bufferView empieza alineado a 4 bytes.
  const trozos: Uint8Array[] = [];
  let largo = 0;
  const agregarVista = (datos: Float32Array | Uint16Array | Uint32Array, destino: number): number => {
    const bytes = new Uint8Array(datos.buffer, datos.byteOffset, datos.byteLength);
    const relleno = (4 - (largo % 4)) % 4;
    if (relleno) {
      trozos.push(new Uint8Array(relleno));
      largo += relleno;
    }
    json.bufferViews.push({ buffer: 0, byteOffset: largo, byteLength: bytes.byteLength, target: destino });
    trozos.push(bytes.slice());
    largo += bytes.byteLength;
    return json.bufferViews.length - 1;
  };
  const agregarAccesor = (accesor: Record<string, unknown>): number => {
    json.accessors.push(accesor);
    return json.accessors.length - 1;
  };

  const primitiva = (p: PrimitivaGLB, donde: string): Record<string, unknown> => {
    const { posiciones, normales, indices } = p;
    if (!(posiciones instanceof Float32Array) || !(normales instanceof Float32Array)) {
      throw new Error(`GLB: ${donde}: posiciones y normales deben ser Float32Array`);
    }
    if (posiciones.length === 0 || posiciones.length % 3 !== 0) throw new Error(`GLB: ${donde}: posiciones vacías o no múltiplo de 3`);
    if (normales.length !== posiciones.length) throw new Error(`GLB: ${donde}: hay ${normales.length / 3} normales para ${posiciones.length / 3} vértices`);
    if (indices.length === 0 || indices.length % 3 !== 0) throw new Error(`GLB: ${donde}: índices vacíos o no múltiplo de 3 (triángulos)`);
    if (!Number.isInteger(p.material) || p.material < 0 || p.material >= materiales.length) {
      throw new Error(`GLB: ${donde}: material ${p.material} inexistente`);
    }
    const vertices = posiciones.length / 3;
    const corto = indices instanceof Uint16Array;
    let maximo = 0;
    for (const k of indices) {
      if (k >= vertices) throw new Error(`GLB: ${donde}: índice ${k} fuera de ${vertices} vértices`);
      if (k > maximo) maximo = k;
    }
    if (corto && maximo === 0xffff) throw new Error(`GLB: ${donde}: el índice 65535 está reservado en Uint16; usa Uint32Array`);
    finitos(Array.from(posiciones), `${donde}: posiciones`);
    for (let i = 0; i < normales.length; i += 3) {
      const l = Math.hypot(normales[i]!, normales[i + 1]!, normales[i + 2]!);
      if (!(Math.abs(l - 1) < 0.0005)) throw new Error(`GLB: ${donde}: normal ${i / 3} no unitaria (${l})`);
    }
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < posiciones.length; i++) {
      const v = posiciones[i]!;
      if (v < min[i % 3]!) min[i % 3] = v;
      if (v > max[i % 3]!) max[i % 3] = v;
    }
    const pos = agregarAccesor({ bufferView: agregarVista(posiciones, ARRAY_BUFFER), componentType: FLOAT, count: vertices, type: 'VEC3', min, max });
    const nor = agregarAccesor({ bufferView: agregarVista(normales, ARRAY_BUFFER), componentType: FLOAT, count: vertices, type: 'VEC3' });
    const ind = agregarAccesor({
      bufferView: agregarVista(indices, ELEMENT_ARRAY_BUFFER),
      componentType: corto ? UNSIGNED_SHORT : UNSIGNED_INT,
      count: indices.length,
      type: 'SCALAR',
    });
    return { attributes: { POSITION: pos, NORMAL: nor }, indices: ind, material: p.material, mode: 4 };
  };

  const agregarNodo = (n: NodoGLB, ruta: string): number => {
    const donde = `nodo «${n.nombre}» (${ruta})`;
    const nodo: Record<string, unknown> = { name: n.nombre };
    json.nodes.push(nodo);
    const indice = json.nodes.length - 1;
    if (n.traslacion) {
      finitos(n.traslacion, `${donde}: traslación`);
      nodo.translation = [...n.traslacion];
    }
    if (n.rotacion) {
      finitos(n.rotacion, `${donde}: rotación`);
      const l = Math.hypot(...n.rotacion);
      if (Math.abs(l - 1) > 1e-3) throw new Error(`GLB: ${donde}: la rotación no es un cuaternión unitario (|q| = ${l})`);
      nodo.rotation = n.rotacion.map((c) => c / l);
    }
    if (n.escala) {
      finitos(n.escala, `${donde}: escala`);
      nodo.scale = [...n.escala];
    }
    if (n.malla) {
      if (n.malla.primitivas.length === 0) throw new Error(`GLB: ${donde}: malla sin primitivas`);
      json.meshes.push({ name: n.nombre, primitives: n.malla.primitivas.map((p, i) => primitiva(p, `${donde}, primitiva ${i}`)) });
      nodo.mesh = json.meshes.length - 1;
    }
    if (n.extras !== undefined) nodo.extras = JSON.parse(JSON.stringify(n.extras)) as unknown;
    if (n.hijos?.length) nodo.children = n.hijos.map((h, i) => agregarNodo(h, `${ruta}.${i}`));
    return indice;
  };

  const raices = entrada.nodos.map((n, i) => agregarNodo(n, String(i)));
  // glTF no admite listas vacías: una escena sin nodos va sin «nodes».
  json.scenes = [{ name: entrada.nombreEscena, ...(raices.length ? { nodes: raices } : {}) }];
  if (materiales.length) json.materials = materiales;
  for (const clave of ['nodes', 'meshes', 'accessors', 'bufferViews'] as const) {
    if (json[clave].length === 0) delete (json as Record<string, unknown>)[clave];
  }
  const relleno = (4 - (largo % 4)) % 4;
  if (relleno) {
    trozos.push(new Uint8Array(relleno));
    largo += relleno;
  }
  if (largo > 0) json.buffers = [{ byteLength: largo }];

  // Trozo JSON relleno con espacios y BIN con ceros, ambos a múltiplos de 4.
  const textoJson = new TextEncoder().encode(JSON.stringify(json));
  const largoJson = Math.ceil(textoJson.length / 4) * 4;
  const total = 12 + 8 + largoJson + (largo > 0 ? 8 + largo : 0);
  const salida = new Uint8Array(total);
  const v = new DataView(salida.buffer);
  v.setUint32(0, 0x46546c67, true); // «glTF»
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, largoJson, true);
  v.setUint32(16, 0x4e4f534a, true); // «JSON»
  salida.set(textoJson, 20);
  salida.fill(0x20, 20 + textoJson.length, 20 + largoJson);
  if (largo > 0) {
    let p = 20 + largoJson;
    v.setUint32(p, largo, true);
    v.setUint32(p + 4, 0x004e4942, true); // «BIN\0»
    p += 8;
    for (const t of trozos) {
      salida.set(t, p);
      p += t.length;
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------------------------------
// Geometría: cada cara lleva sus propios vértices (normales planas).

class Constructor {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly ind: number[] = [];

  /** Añade una cara plana: vértices y triángulos (índices locales); orienta cada triángulo según la normal. */
  cara(vertices: Vec3[], triangulos: [number, number, number][], normal: Vec3): void {
    const l = Math.hypot(...normal);
    const n: Vec3 = [normal[0] / l, normal[1] / l, normal[2] / l];
    const base = this.pos.length / 3;
    for (const v of vertices) {
      this.pos.push(...v);
      this.nor.push(...n);
    }
    for (const [a, b, c] of triangulos) {
      const [pa, pb, pc] = [vertices[a]!, vertices[b]!, vertices[c]!];
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const cruz = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      const signo = cruz[0]! * n[0] + cruz[1]! * n[1] + cruz[2]! * n[2];
      this.ind.push(base + a, ...(signo >= 0 ? [base + b, base + c] : [base + c, base + b]));
    }
  }

  /** Cara convexa (cuadrilátero) en abanico. */
  cuadrilatero(vertices: [Vec3, Vec3, Vec3, Vec3], normal: Vec3): void {
    this.cara(vertices, [[0, 1, 2], [0, 2, 3]], normal);
  }

  geometria(): GeometriaGLB {
    const vertices = this.pos.length / 3;
    return {
      posiciones: Float32Array.from(this.pos),
      normales: Float32Array.from(this.nor),
      indices: vertices <= 0xffff ? Uint16Array.from(this.ind) : Uint32Array.from(this.ind),
    };
  }
}

const positivo = (x: number, que: string): void => {
  if (!(x > 0) || !Number.isFinite(x)) throw new Error(`GLB: ${que} debe ser positivo (${x})`);
};

/** Caja centrada en x y z, apoyada en y = 0 (de 0 a alto). 24 vértices, 12 triángulos. */
export function mallaCaja(ancho: number, alto: number, fondo: number): GeometriaGLB {
  positivo(ancho, 'ancho');
  positivo(alto, 'alto');
  positivo(fondo, 'fondo');
  const x = ancho / 2;
  const z = fondo / 2;
  const c = new Constructor();
  c.cuadrilatero([[x, 0, -z], [x, alto, -z], [x, alto, z], [x, 0, z]], [1, 0, 0]);
  c.cuadrilatero([[-x, 0, -z], [-x, 0, z], [-x, alto, z], [-x, alto, -z]], [-1, 0, 0]);
  c.cuadrilatero([[-x, alto, -z], [-x, alto, z], [x, alto, z], [x, alto, -z]], [0, 1, 0]);
  c.cuadrilatero([[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]], [0, -1, 0]);
  c.cuadrilatero([[-x, 0, z], [x, 0, z], [x, alto, z], [-x, alto, z]], [0, 0, 1]);
  c.cuadrilatero([[-x, 0, -z], [-x, alto, -z], [x, alto, -z], [x, 0, -z]], [0, 0, -1]);
  return c.geometria();
}

/** Cilindro de eje y, centrado en x y z, de y = 0 a alto; caras laterales planas (prisma de n lados). */
export function mallaCilindro(radio: number, alto: number, segmentos = 24): GeometriaGLB {
  positivo(radio, 'radio');
  positivo(alto, 'alto');
  if (!Number.isInteger(segmentos) || segmentos < 3) throw new Error(`GLB: segmentos debe ser un entero ≥ 3 (${segmentos})`);
  const base: [number, number][] = [];
  for (let i = 0; i < segmentos; i++) {
    const t = (i / segmentos) * Math.PI * 2;
    base.push([radio * Math.cos(t), radio * Math.sin(t)]);
  }
  return mallaPrisma(base, 0, alto);
}

const areaConSigno = (p: [number, number][]): number => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i]!;
    const [x2, z2] = p[(i + 1) % p.length]!;
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
};

const cruz2 = (o: [number, number], a: [number, number], b: [number, number]): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** ¿Se cortan los segmentos pq y rs (incluido tocarse)? */
function seCortan(p: [number, number], q: [number, number], r: [number, number], s: [number, number]): boolean {
  const d1 = cruz2(r, s, p);
  const d2 = cruz2(r, s, q);
  const d3 = cruz2(p, q, r);
  const d4 = cruz2(p, q, s);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const sobre = (a: [number, number], b: [number, number], c: [number, number], d: number): boolean =>
    d === 0 && Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  return sobre(r, s, p, d1) || sobre(r, s, q, d2) || sobre(p, q, r, d3) || sobre(p, q, s, d4);
}

/**
 * Triangula un polígono simple por orejas. Devuelve triángulos de índices del polígono con el mismo
 * sentido de giro que el polígono. Los vértices alineados se descartan sin triángulos degenerados.
 */
export function triangularPoligono(poligono: [number, number][]): [number, number, number][] {
  const sentido = Math.sign(areaConSigno(poligono));
  const quedan = poligono.map((_, i) => i);
  const resultado: [number, number, number][] = [];
  const dentro = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]): boolean => {
    const s1 = cruz2(a, b, p) * sentido;
    const s2 = cruz2(b, c, p) * sentido;
    const s3 = cruz2(c, a, p) * sentido;
    return s1 >= 0 && s2 >= 0 && s3 >= 0;
  };
  while (quedan.length > 3) {
    let hecho = false;
    for (let k = 0; k < quedan.length && !hecho; k++) {
      const ia = quedan[(k + quedan.length - 1) % quedan.length]!;
      const ib = quedan[k]!;
      const ic = quedan[(k + 1) % quedan.length]!;
      const [a, b, c] = [poligono[ia]!, poligono[ib]!, poligono[ic]!];
      if (cruz2(a, b, c) * sentido <= 0) continue; // reflejo o alineado
      const tapa = quedan.some((j) => {
        if (j === ia || j === ib || j === ic) return false;
        const p = poligono[j]!;
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) return false;
        return dentro(p, a, b, c);
      });
      if (tapa) continue;
      resultado.push([ia, ib, ic]);
      quedan.splice(k, 1);
      hecho = true;
    }
    if (!hecho) {
      // Sin orejas: sólo puede deberse a vértices alineados; se quita uno.
      const k = quedan.findIndex((ib, k2) => {
        const ia = quedan[(k2 + quedan.length - 1) % quedan.length]!;
        const ic = quedan[(k2 + 1) % quedan.length]!;
        return Math.abs(cruz2(poligono[ia]!, poligono[ib]!, poligono[ic]!)) <= 1e-12;
      });
      if (k < 0) throw new Error('GLB: no se pudo triangular el polígono (¿no es simple?)');
      quedan.splice(k, 1);
    }
  }
  const [ia, ib, ic] = quedan as [number, number, number];
  if (Math.abs(cruz2(poligono[ia]!, poligono[ib]!, poligono[ic]!)) > 1e-12) resultado.push([ia, ib, ic]);
  return resultado;
}

/**
 * Prisma vertical sobre un polígono simple [x, z] (cóncavo o convexo, en cualquier sentido), de y0 a y1.
 * Caras laterales por lado con su normal hacia fuera y tapas triangulizadas por orejas.
 */
export function mallaPrisma(base: [number, number][], y0: number, y1: number): GeometriaGLB {
  if (base.length < 3) throw new Error('GLB: el prisma necesita al menos 3 puntos de base');
  finitos(base.flat(), 'base del prisma');
  finitos([y0, y1], 'alturas del prisma');
  if (!(y1 > y0)) throw new Error(`GLB: el prisma necesita y1 > y0 (${y0}, ${y1})`);
  const n = base.length;
  for (let i = 0; i < n; i++) {
    const [a, b] = [base[i]!, base[(i + 1) % n]!];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) throw new Error(`GLB: puntos repetidos en la base del prisma (${i})`);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // lados contiguos
      if (seCortan(base[i]!, base[(i + 1) % n]!, base[j]!, base[(j + 1) % n]!)) {
        throw new Error(`GLB: la base del prisma se corta a sí misma (lados ${i} y ${j})`);
      }
    }
  }
  const area = areaConSigno(base);
  if (Math.abs(area) < 1e-12) throw new Error('GLB: la base del prisma no tiene área');
  const c = new Constructor();
  for (let i = 0; i < n; i++) {
    const [ax, az] = base[i]!;
    const [bx, bz] = base[(i + 1) % n]!;
    const [dx, dz] = [bx - ax, bz - az];
    // Con área positiva en (x, z) el interior queda a la izquierda de cada lado; fuera es (dz, −dx).
    const fuera: Vec3 = area > 0 ? [dz, 0, -dx] : [-dz, 0, dx];
    c.cuadrilatero([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], fuera);
  }
  const triangulos = triangularPoligono(base);
  c.cara(base.map(([x, z]) => [x, y1, z] as Vec3), triangulos, [0, 1, 0]);
  c.cara(base.map(([x, z]) => [x, y0, z] as Vec3), triangulos, [0, -1, 0]);
  return c.geometria();
}

/**
 * Prisma vertical sobre un polígono con agujeros [x, z] (exterior y agujeros en cualquier sentido), de
 * y0 a y1: caras laterales hacia fuera del sólido (también en los agujeros) y tapas triangulizadas
 * con earcut. Es la forma de los muros derivados, que rodean a las estancias.
 */
export function mallaPrismaConAgujeros(exterior: [number, number][], agujeros: [number, number][][], y0: number, y1: number): GeometriaGLB {
  if (exterior.length < 3) throw new Error('GLB: el prisma necesita al menos 3 puntos de base');
  finitos([...exterior.flat(), ...agujeros.flat(2), y0, y1], 'prisma con agujeros');
  if (!(y1 > y0)) throw new Error(`GLB: el prisma necesita y1 > y0 (${y0}, ${y1})`);
  const c = new Constructor();
  const lados = (anillo: [number, number][], haciaDentro: boolean): void => {
    const area = areaConSigno(anillo);
    const n = anillo.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = anillo[i]!;
      const [bx, bz] = anillo[(i + 1) % n]!;
      const [dx, dz] = [bx - ax, bz - az];
      if (Math.hypot(dx, dz) < 1e-9) continue;
      let fuera: Vec3 = area > 0 ? [dz, 0, -dx] : [-dz, 0, dx];
      // En un agujero, «fuera del sólido» es hacia dentro del agujero.
      if (haciaDentro) fuera = [-fuera[0], 0, -fuera[2]];
      c.cuadrilatero([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], fuera);
    }
  };
  lados(exterior, false);
  for (const a of agujeros) lados(a, true);
  const todos = [exterior, ...agujeros];
  const plano = todos.flat().flatMap(([x, z]) => [x, z]);
  const indicesAgujeros: number[] = [];
  let k = exterior.length;
  for (const a of agujeros) {
    indicesAgujeros.push(k);
    k += a.length;
  }
  const t = earcut(plano, indicesAgujeros.length ? indicesAgujeros : undefined, 2);
  const triangulos: [number, number, number][] = [];
  for (let i = 0; i + 2 < t.length; i += 3) triangulos.push([t[i]!, t[i + 1]!, t[i + 2]!]);
  const puntos = todos.flat();
  c.cara(puntos.map(([x, z]) => [x, y1, z] as Vec3), triangulos, [0, 1, 0]);
  c.cara(puntos.map(([x, z]) => [x, y0, z] as Vec3), triangulos, [0, -1, 0]);
  return c.geometria();
}

/** Esfera de radio r apoyada en y = 0 (centro a la altura r), con normales suaves. */
export function mallaEsfera(radio: number, segmentos = 16, anillos = 10): GeometriaGLB {
  positivo(radio, 'radio');
  const pos: number[] = [];
  const nor: number[] = [];
  for (let j = 0; j <= anillos; j++) {
    const v = (j / anillos) * Math.PI;
    for (let i = 0; i <= segmentos; i++) {
      const u = (i / segmentos) * Math.PI * 2;
      const n: Vec3 = [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)];
      nor.push(...n);
      pos.push(n[0] * radio, radio + n[1] * radio, n[2] * radio);
    }
  }
  const ind: number[] = [];
  const fila = segmentos + 1;
  for (let j = 0; j < anillos; j++) {
    for (let i = 0; i < segmentos; i++) {
      const a = j * fila + i;
      const b = a + fila;
      // Hacia fuera: antihorario visto desde fuera.
      if (j > 0) ind.push(a, a + 1, b);
      if (j < anillos - 1) ind.push(a + 1, b + 1, b);
    }
  }
  return { posiciones: Float32Array.from(pos), normales: Float32Array.from(nor), indices: Uint16Array.from(ind) };
}

/**
 * Cuña (rampa) centrada en x y z, apoyada en y = 0: de altura 0 en el frente (z = +fondo/2) a `alto`
 * detrás (z = −fondo/2), como un respaldo inclinado o un tejadillo.
 */
export function mallaCuna(ancho: number, alto: number, fondo: number): GeometriaGLB {
  positivo(ancho, 'ancho');
  positivo(alto, 'alto');
  positivo(fondo, 'fondo');
  const x = ancho / 2;
  const z = fondo / 2;
  const c = new Constructor();
  c.cuadrilatero([[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]], [0, -1, 0]);
  c.cuadrilatero([[-x, 0, -z], [-x, alto, -z], [x, alto, -z], [x, 0, -z]], [0, 0, -1]);
  const l = Math.hypot(alto, fondo);
  c.cuadrilatero([[-x, alto, -z], [-x, 0, z], [x, 0, z], [x, alto, -z]], [0, fondo / l, alto / l]);
  c.cara([[x, 0, -z], [x, alto, -z], [x, 0, z]], [[0, 1, 2]], [1, 0, 0]);
  c.cara([[-x, 0, -z], [-x, alto, -z], [-x, 0, z]], [[0, 1, 2]], [-1, 0, 0]);
  return c.geometria();
}

/** Barra de sección cuadrada `grueso` × `grueso` entre dos puntos (en cualquier dirección). */
export function mallaBarra(a: Vec3, b: Vec3, grueso: number): GeometriaGLB {
  positivo(grueso, 'grueso');
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(...d);
  positivo(l, 'largo de la barra');
  const u: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  // Dos perpendiculares a la barra: e1 horizontal (o x si la barra es vertical) y e2 = u × e1.
  let e1: Vec3 = [u[2], 0, -u[0]];
  const le = Math.hypot(...e1);
  e1 = le < 1e-6 ? [1, 0, 0] : [e1[0] / le, 0, e1[2] / le];
  const e2: Vec3 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  const g = grueso / 2;
  const v = (p: Vec3, s1: number, s2: number): Vec3 => [p[0] + (e1[0] * s1 + e2[0] * s2) * g, p[1] + (e1[1] * s1 + e2[1] * s2) * g, p[2] + (e1[2] * s1 + e2[2] * s2) * g];
  const c = new Constructor();
  const neg = (x: Vec3): Vec3 => [-x[0], -x[1], -x[2]];
  c.cuadrilatero([v(a, 1, -1), v(b, 1, -1), v(b, 1, 1), v(a, 1, 1)], e1);
  c.cuadrilatero([v(a, -1, -1), v(a, -1, 1), v(b, -1, 1), v(b, -1, -1)], neg(e1));
  c.cuadrilatero([v(a, -1, 1), v(a, 1, 1), v(b, 1, 1), v(b, -1, 1)], e2);
  c.cuadrilatero([v(a, -1, -1), v(b, -1, -1), v(b, 1, -1), v(a, 1, -1)], neg(e2));
  c.cuadrilatero([v(a, -1, -1), v(a, 1, -1), v(a, 1, 1), v(a, -1, 1)], neg(u));
  c.cuadrilatero([v(b, -1, -1), v(b, -1, 1), v(b, 1, 1), v(b, 1, -1)], u);
  return c.geometria();
}

/**
 * Sólido de base horizontal (polígono convexo en x, z a y = 0) y tapa con una altura por vértice
 * (plana si las alturas varían linealmente): una rampa, o un panel que sigue una pendiente.
 */
/** Rampa sobre una base: arriba a `alturas` en cada vértice y abajo a `bajos` (por defecto, el suelo). */
export function mallaRampa(base: [number, number][], alturas: number[], bajos?: number[]): GeometriaGLB {
  if (base.length < 3 || alturas.length !== base.length) throw new Error('GLB: la rampa necesita un polígono y una altura por vértice');
  const n = base.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += base[i]![0] * base[(i + 1) % n]![1] - base[(i + 1) % n]![0] * base[i]![1];
  const s = area >= 0 ? 1 : -1;
  const c = new Constructor();
  const abajo: Vec3[] = base.map(([x, z], i) => [x, Math.min(bajos?.[i] ?? 0, alturas[i]! - 1e-4), z]);
  const arriba: Vec3[] = base.map(([x, z], i) => [x, Math.max(alturas[i]!, 1e-4), z]);
  const abanico = (k: number): [number, number, number][] => Array.from({ length: k - 2 }, (_, i) => [0, i + 1, i + 2] as [number, number, number]);
  c.cara(abajo, abanico(n), [0, -1, 0]);
  // Normal de la tapa: la del primer triángulo no degenerado, hacia arriba.
  let nt: Vec3 = [0, 1, 0];
  for (let i = 1; i + 1 < n; i++) {
    const u: Vec3 = [arriba[i]![0] - arriba[0]![0], arriba[i]![1] - arriba[0]![1], arriba[i]![2] - arriba[0]![2]];
    const w: Vec3 = [arriba[i + 1]![0] - arriba[0]![0], arriba[i + 1]![1] - arriba[0]![1], arriba[i + 1]![2] - arriba[0]![2]];
    const x: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (Math.hypot(...x) > 1e-9) {
      nt = x[1] < 0 ? [-x[0], -x[1], -x[2]] : x;
      break;
    }
  }
  c.cara(arriba, abanico(n), nt);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = base[j]![0] - base[i]![0];
    const dz = base[j]![1] - base[i]![1];
    // Hacia fuera: con la base en el sentido de área positiva (x, z), la normal de (dx, dz) es (dz, −dx).
    c.cara([abajo[i]!, abajo[j]!, arriba[j]!, arriba[i]!], [[0, 1, 2], [0, 2, 3]], [s * dz, 0, -s * dx]);
  }
  return c.geometria();
}
