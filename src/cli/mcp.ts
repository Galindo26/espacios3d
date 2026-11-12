// Servidor MCP (Model Context Protocol) mínimo por stdio, sin dependencias (Node >= 18).
// JSON-RPC 2.0 con un mensaje por línea. Sólo herramientas (tools/list y tools/call), initialize y ping.
// En la salida sólo se escriben mensajes; los registros van a stderr.
import { createInterface } from 'node:readline';

export const VERSIONES_PROTOCOLO = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'] as const;

export type ContenidoMCP = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface HerramientaMCP {
  nombre: string;
  descripcion: string;
  /** JSON Schema del objeto de argumentos (type: 'object'). */
  esquemaEntrada: object;
  ejecutar(args: Record<string, unknown>): Promise<{ contenido: ContenidoMCP[]; esError?: boolean }>;
}

export interface OpcionesMCP {
  nombre: string;
  version: string;
  instrucciones?: string;
  herramientas: HerramientaMCP[];
}

type Id = string | number | null;

const ERROR = { PARSEO: -32700, PETICION: -32600, METODO: -32601, PARAMETROS: -32602, INTERNO: -32603 } as const;

class ErrorRPC extends Error {
  constructor(
    readonly codigo: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Atiende un cliente MCP por la entrada y salida dadas (stdin/stdout por defecto) hasta que se cierra la
 * entrada; resuelve cuando se han respondido todas las peticiones pendientes.
 */
export function servirMCP(
  opciones: OpcionesMCP,
  entrada: NodeJS.ReadableStream = process.stdin,
  salida: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const porNombre = new Map(opciones.herramientas.map((h) => [h.nombre, h]));
  if (porNombre.size !== opciones.herramientas.length) throw new Error('MCP: nombres de herramienta repetidos');
  const registrar = (texto: string): void => {
    process.stderr.write(`[${opciones.nombre}] ${texto}\n`);
  };
  const enviar = (mensaje: Record<string, unknown>): void => {
    salida.write(`${JSON.stringify({ jsonrpc: '2.0', ...mensaje })}\n`);
  };
  const responderError = (id: Id, codigo: number, mensaje: string): void => {
    enviar({ id, error: { code: codigo, message: mensaje } });
  };

  const metodos: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown> = {
    initialize: (params) => {
      const pedida = params.protocolVersion;
      const protocolVersion = (VERSIONES_PROTOCOLO as readonly unknown[]).includes(pedida)
        ? pedida
        : VERSIONES_PROTOCOLO[VERSIONES_PROTOCOLO.length - 1];
      return {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: opciones.nombre, version: opciones.version },
        ...(opciones.instrucciones ? { instructions: opciones.instrucciones } : {}),
      };
    },
    ping: () => ({}),
    'tools/list': () => ({
      tools: opciones.herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, inputSchema: h.esquemaEntrada })),
    }),
    'tools/call': async (params) => {
      const nombre = params.name;
      if (typeof nombre !== 'string') throw new ErrorRPC(ERROR.PARAMETROS, 'tools/call necesita «name» (texto)');
      const herramienta = porNombre.get(nombre);
      if (!herramienta) throw new ErrorRPC(ERROR.PARAMETROS, `Herramienta desconocida: ${nombre}`);
      const args = params.arguments ?? {};
      if (!esObjeto(args)) throw new ErrorRPC(ERROR.PARAMETROS, '«arguments» debe ser un objeto');
      try {
        const r = await herramienta.ejecutar(args);
        return { content: r.contenido, isError: r.esError === true };
      } catch (e) {
        // Un fallo dentro de la herramienta es un resultado con isError, para que el modelo lo vea.
        const mensaje = e instanceof Error ? e.message : String(e);
        registrar(`error en ${nombre}: ${e instanceof Error && e.stack ? e.stack : mensaje}`);
        return { content: [{ type: 'text', text: mensaje }], isError: true };
      }
    },
  };

  const atender = async (mensaje: unknown): Promise<void> => {
    if (!esObjeto(mensaje)) {
      responderError(null, ERROR.PETICION, Array.isArray(mensaje) ? 'Lotes JSON-RPC no admitidos' : 'Petición no válida');
      return;
    }
    const tieneId = 'id' in mensaje;
    const id = mensaje.id;
    if (tieneId && !(typeof id === 'string' || typeof id === 'number' || id === null)) {
      responderError(null, ERROR.PETICION, 'id no válido');
      return;
    }
    if (typeof mensaje.method !== 'string') {
      // Respuesta del cliente a algo que no hemos pedido: se ignora. Si no, petición mal formada.
      if (!('result' in mensaje || 'error' in mensaje)) responderError((id as Id) ?? null, ERROR.PETICION, 'Falta «method»');
      return;
    }
    if (mensaje.jsonrpc !== '2.0') {
      if (tieneId) responderError(id as Id, ERROR.PETICION, 'jsonrpc debe ser "2.0"');
      return;
    }
    if (!tieneId) return; // notificación (initialized, cancelled…): nunca se responde
    const metodo = Object.hasOwn(metodos, mensaje.method) ? metodos[mensaje.method] : undefined;
    if (!metodo) {
      responderError(id as Id, ERROR.METODO, `Método no encontrado: ${mensaje.method}`);
      return;
    }
    const params = mensaje.params ?? {};
    if (!esObjeto(params)) {
      responderError(id as Id, ERROR.PARAMETROS, '«params» debe ser un objeto');
      return;
    }
    try {
      enviar({ id, result: await metodo(params) });
    } catch (e) {
      if (e instanceof ErrorRPC) responderError(id as Id, e.codigo, e.message);
      else {
        registrar(`error interno en ${mensaje.method}: ${e instanceof Error ? e.stack : String(e)}`);
        responderError(id as Id, ERROR.INTERNO, e instanceof Error ? e.message : String(e));
      }
    }
  };

  return new Promise((resolver, rechazar) => {
    const pendientes = new Set<Promise<void>>();
    const lineas = createInterface({ input: entrada, crlfDelay: Infinity });
    lineas.on('line', (linea) => {
      if (!linea.trim()) return;
      let mensaje: unknown;
      try {
        mensaje = JSON.parse(linea);
      } catch {
        responderError(null, ERROR.PARSEO, 'JSON no válido');
        return;
      }
      const p = atender(mensaje).catch((e: unknown) => registrar(`fallo inesperado: ${String(e)}`));
      pendientes.add(p);
      void p.finally(() => pendientes.delete(p));
    });
    lineas.on('close', () => {
      Promise.all(pendientes).then(() => resolver(), rechazar);
    });
    entrada.on('error', rechazar);
  });
}
