// Comprobación de un .glb antes de leerlo (sin three ni DOM, para poder probarla sola).

/** Extensiones de glTF que no se leen (necesitarían decodificadores aparte). */
const NO_SOPORTADAS: Record<string, string> = {
  KHR_draco_mesh_compression: 'Draco',
  EXT_meshopt_compression: 'meshopt',
  KHR_texture_basisu: 'KTX2',
};

/**
 * Comprueba el .glb antes de leerlo: que lo sea, qué compresiones pide que no se leen y qué
 * archivos de fuera pide (imágenes o búferes con `uri` que no sea `data:`). Lanza si no es un .glb.
 */
export function comprobarGlb(buf: ArrayBuffer): { raras: string[]; externas: string[] } {
  const dv = new DataView(buf);
  if (buf.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('no es un .glb (glTF binario)');
  const largo = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || 20 + largo > buf.byteLength) throw new Error('el .glb está dañado');
  let json: { extensionsRequired?: string[]; extensionsUsed?: string[]; images?: { uri?: unknown }[]; buffers?: { uri?: unknown }[] };
  try {
    json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, largo)));
  } catch {
    throw new Error('el .glb está dañado');
  }
  // El JSON es un objeto y sus listas, listas: si no, el error sería uno interno y en inglés.
  const lista = (x: unknown): boolean => x === undefined || Array.isArray(x);
  if (typeof json !== 'object' || json === null || Array.isArray(json) || ![json.extensionsRequired, json.extensionsUsed, json.images, json.buffers].every(lista)) {
    throw new Error('el .glb está dañado');
  }
  const raras = [...new Set([...(json.extensionsRequired ?? []), ...(json.extensionsUsed ?? [])])].filter((x) => x in NO_SOPORTADAS).map((x) => NO_SOPORTADAS[x]!);
  const externas = [...(json.images ?? []), ...(json.buffers ?? [])]
    .map((x) => x?.uri)
    .filter((u): u is string => typeof u === 'string' && !/^data:/i.test(u));
  return { raras, externas };
}
