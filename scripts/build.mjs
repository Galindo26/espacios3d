// Compila:
//  - build/core.mjs                      núcleo para las pruebas (node:test)
//  - dist/Espacios3D/Espacios3D.html     página única con todo el JS y el CSS incrustados (abre desde file://)
//  - dist/Espacios3D/...                 archivos de entrega de entrega/
// Uso: node scripts/build.mjs
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(raiz, 'dist', 'Espacios3D');
const pkg = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));

rmSync(join(raiz, 'dist'), { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
mkdirSync(join(raiz, 'build'), { recursive: true });

// Núcleo para pruebas.
await build({
  entryPoints: [join(raiz, 'src/core/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  outfile: join(raiz, 'build/core.mjs'),
  logLevel: 'warning',
});

// Lógica de la página sin DOM (sincronía e historial) para sus pruebas unitarias.
await build({
  entryPoints: [join(raiz, 'src/app/sincronia.ts'), join(raiz, 'src/app/estado.ts'), join(raiz, 'src/app/abierto.ts'), join(raiz, 'src/app/glbEntrada.ts'), join(raiz, 'src/app/almacen.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  outdir: join(raiz, 'build'),
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});

// Módulos sueltos para sus pruebas: rasterizador y GLB (puros) y PNG y MCP (Node).
await build({
  entryPoints: { lienzo: join(raiz, 'src/core/lienzo.ts'), glb: join(raiz, 'src/core/glb.ts') },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  outdir: join(raiz, 'build'),
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});
await build({
  entryPoints: { png: join(raiz, 'src/cli/png.ts'), mcp: join(raiz, 'src/cli/mcp.ts'), jpeg: join(raiz, 'src/cli/jpeg.ts') },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outdir: join(raiz, 'build'),
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});

// Página: IIFE (los módulos ES externos no cargan desde file://).
const app = await build({
  entryPoints: [join(raiz, 'src/app/main.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'warning',
});
const js = app.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(raiz, 'src/app/estilos.css'), 'utf8');
const licencias = readFileSync(join(raiz, 'node_modules/three/LICENSE'), 'utf8');
// Avisos de las librerías de geometría que van incrustadas en la página y en el CLI (MIT, ISC y
// Unlicense piden conservar el aviso). Si una no trae archivo de licencia, se toma de su README; si
// no aparece, la compilación falla.
const TERCEROS = ['polygon-clipping', 'splaytree', 'robust-predicates', 'earcut'];
const licenciaDe = (nombre) => {
  const dir = join(raiz, 'node_modules', nombre);
  const archivo = readdirSync(dir).find((n) => /^licen[cs]e/i.test(n));
  if (archivo) return readFileSync(join(dir, archivo), 'utf8').trim();
  const leeme = readdirSync(dir).find((n) => /^readme/i.test(n));
  const texto = leeme ? readFileSync(join(dir, leeme), 'utf8') : '';
  const i = texto.search(/The MIT License/);
  if (i < 0) throw new Error(`No se encuentra la licencia de ${nombre}`);
  return texto.slice(i).trim();
};
const avisoDe = (nombre) => {
  const meta = JSON.parse(readFileSync(join(raiz, 'node_modules', nombre, 'package.json'), 'utf8'));
  return `${nombre} ${meta.version} (${meta.license}):\n${licenciaDe(nombre)}`;
};
const avisosTerceros = TERCEROS.map(avisoDe).join('\n\n');
// El CLI lleva además jpeg-js (para pintar el calco sobre un plano JPEG); la página no.
const avisosTercerosCLI = [...TERCEROS, 'jpeg-js'].map(avisoDe).join('\n\n');
let html = readFileSync(join(raiz, 'src/app/plantilla.html'), 'utf8');
const sustituir = (marca, valor) => {
  if (!html.includes(marca)) throw new Error(`Falta la marca ${marca} en plantilla.html`);
  html = html.split(marca).join(valor);
};
// Fuente incrustada (sin conexión no se pueden cargar fuentes externas).
const fuentes = [400, 600]
  .map((peso) => {
    const b64 = readFileSync(join(raiz, `node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${peso}-normal.woff2`)).toString('base64');
    return `@font-face{font-family:'Plex';font-style:normal;font-weight:${peso};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  })
  .join('\n');
sustituir('/*@@FUENTES@@*/', fuentes);
sustituir('/*@@CSS@@*/', css);
sustituir('/*@@JS@@*/', js); // split/join: sin patrones «$» de replace()
sustituir('@@VERSION@@', pkg.version);
sustituir('@@LICENCIA_THREE@@', licencias.replace(/--/g, '- -'));
sustituir('@@LICENCIAS_TERCEROS@@', avisosTerceros.replace(/--/g, '- -'));
// Límite de la entrega: la página entera en 1,2 MiB (revisión independiente del plan R5, M12).
const LIMITE_HTML = 1_258_291;
if (Buffer.byteLength(html) > LIMITE_HTML) throw new Error(`Espacios3D.html ocupa ${Buffer.byteLength(html)} bytes: pasa del límite de ${LIMITE_HTML} (1,2 MiB)`);
if (html.split('<!--@@ESPACIOS3D_ABIERTO@@-->').length !== 2) throw new Error('Espacios3D.html debe llevar una sola vez la marca de «abrir»');
writeFileSync(join(dist, 'Espacios3D.html'), html);

// CLI para agentes: un solo archivo ESM sin dependencias (Node >= 18).
await build({
  entryPoints: [join(raiz, 'src/cli/main.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: join(dist, 'espacios3d.mjs'),
  banner: { js: `#!/usr/bin/env node\n// Espacios 3D ${pkg.version} — CLI. Uso: node espacios3d.mjs ayuda\n/*\nIncluye estas librerías, con sus avisos de licencia:\n\n${avisosTercerosCLI.replace(/\*\//g, '* /')}\n*/` },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  legalComments: 'none',
  logLevel: 'warning',
});

// Archivos de entrega (instrucciones, ejemplo, esquema).
const entrega = join(raiz, 'entrega');
if (existsSync(entrega)) cpSync(entrega, dist, { recursive: true });

// ZIP para pasar la carpeta. En Windows, el bsdtar del sistema (el «tar» de Git Bash es GNU y no
// escribe ZIP); en otros sistemas, «zip». Se comprueba la firma «PK» y, si no sale, la compilación falla.
const zip = join(raiz, 'dist', 'Espacios3D.zip');
const r = process.platform === 'win32'
  ? spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', zip, '-C', join(raiz, 'dist'), 'Espacios3D'], { windowsHide: true, encoding: 'utf8' })
  : spawnSync('zip', ['-qr', zip, 'Espacios3D'], { cwd: join(raiz, 'dist'), encoding: 'utf8' });
const esZip = existsSync(zip) && readFileSync(zip).subarray(0, 2).toString('latin1') === 'PK';
if (r.status !== 0 || !esZip) {
  console.error(`build: no se pudo crear un ZIP válido (${(r.stderr || r.error?.message || 'sin firma PK').trim()})`);
  process.exit(1);
}

const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`build: Espacios3D.html ${kb(Buffer.byteLength(html))} (js ${kb(js.length)}) → ${dist}`);
