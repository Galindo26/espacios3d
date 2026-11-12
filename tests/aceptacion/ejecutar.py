"""Aceptación final (R2-7e): ejecuta UNA prueba según PROTOCOLO.md y la puntúa.

Uso: python -I tests/aceptacion/ejecutar.py <A|B|C|R|ensayo>
     python -I tests/aceptacion/ejecutar.py t3 <A|B|C|R|R-claude|N|N-claude>   (tanda 3, ronda 5; t4 y t5 igual)

Copia dist/Espacios3D fuera del proyecto, pone la imagen al lado, lanza el agente con el encargo
literal, guarda la transcripción y el resultado en tests/aceptacion/resultados/<prueba>/ y puntúa.
Un intento por prueba: si ya hay resultados de esa prueba, no la repite.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[1]
DIST = RAIZ / 'dist' / 'Espacios3D'
AGY = Path(os.environ.get('LOCALAPPDATA', '')) / 'agy' / 'bin' / 'agy.exe'
PLAZO = 30 * 60

ENCARGO = 'Te paso el plano de mi piso: {img}, en esta carpeta. {extra}Hazlo con la herramienta de esta carpeta en espacios/piso.espacio.json, con todas las habitaciones, puertas y ventanas como en el plano.'
PRUEBAS = {
    'A': dict(imagen='plano-a.png', destino='plano.png', ref='ref-a.espacio.json', modo='cotas', agente='claude', salida='espacios/piso.espacio.json',
              encargo=ENCARGO.format(img='plano.png', extra='')),
    'B': dict(imagen='plano-b.png', destino='plano.png', ref='ref-b.espacio.json', modo='medida', agente='agy', salida='espacios/piso.espacio.json',
              encargo=ENCARGO.format(img='plano.png', extra='No tiene medidas, pero el salón mide 520 cm de ancho de pared a pared. ')),
    'C': dict(imagen='plano-c.jpg', destino='plano.jpg', ref='ref-c.espacio.json', modo='cotas', agente='claude', salida='espacios/piso.espacio.json',
              encargo=ENCARGO.format(img='plano.jpg', extra='')),
    'R': dict(imagen='plano-real.jpg', destino='plano.jpg', ref='ref-real.espacio.json', modo='real', agente='agy', salida='espacios/casa.espacio.json',
              encargo='Te paso el plano de una casa: plano.jpg, en esta carpeta. No tiene medidas generales, pero la casa mide 15 m de ancho por fuera, de la fachada oeste a la este. Hazla con la herramienta de esta carpeta en espacios/casa.espacio.json, con todas las estancias, puertas y ventanas de la planta.'),
}
HERRAMIENTAS_MCP = ['nuevo', 'describir', 'aplicar', 'abrir', 'analizar', 'plano_png']
# Tanda 3 (ronda 5, PROTOCOLO.md): las mismas cuatro con la guía nueva, R también con Claude y la casa N de dos
# plantas con Antigravity y con Claude. Resultados en resultados/t3/.
PRUEBAS_T3 = {
    'A': PRUEBAS['A'], 'B': PRUEBAS['B'], 'C': PRUEBAS['C'], 'R': PRUEBAS['R'],
    'R-claude': {**PRUEBAS['R'], 'agente': 'claude'},
    'N': dict(imagenes=[('plano-n-pb.png', 'planta-baja.png'), ('plano-n-p1.png', 'planta-alta.png')], ref='ref-n.espacio.json', modo='cotas', agente='agy',
              salida='espacios/casa.espacio.json',
              encargo='Te paso los planos de mi casa, que tiene dos plantas: planta-baja.png y planta-alta.png, en esta carpeta. Hazla con la herramienta de esta carpeta en espacios/casa.espacio.json, con las dos plantas, todas las estancias, puertas, ventanas y la escalera, como en los planos. Cuando termines, ábremela para verla.'),
}
PRUEBAS_T3['N-claude'] = {**PRUEBAS_T3['N'], 'agente': 'claude'}
# Sustituto fijado en el protocolo: Antigravity no puede ejecutar órdenes sin interfaz (ver PROTOCOLO.md).
PRUEBAS['B-codex'] = {**PRUEBAS['B'], 'agente': 'codex'}
PRUEBAS['R-codex'] = {**PRUEBAS['R'], 'agente': 'codex'}
CODEX = next(iter(sorted((Path(os.environ.get('LOCALAPPDATA', '')) / 'OpenAI' / 'Codex' / 'bin').glob('*/codex.exe'), key=lambda x: x.stat().st_mtime, reverse=True)), None)


def entorno_de(agente: str, carpeta: Path, tanda3: bool) -> dict:
    entorno = {k: v for k, v in os.environ.items() if k != 'ANTHROPIC_API_KEY'}
    if tanda3:
        # «abrir» no abre ventanas durante la prueba; se anota si el agente lo llamó.
        entorno['ESPACIOS3D_NO_LANZAR'] = '1'
    if agente == 'claude':
        # Carpeta temporal propia de cada prueba, junto a la copia de Espacios3D (tanda 5: R-claude leyó en
        # %TEMP%\gen, que en Git Bash es /tmp/gen, lo que dejó la R-claude de la tanda 3). Antigravity no se toca:
        # trabaja en su sandbox y una TEMP fuera de él podría romperle lo que ya funciona.
        temporal = carpeta.parent / 'tmp'
        temporal.mkdir(exist_ok=True)
        for k in ('TEMP', 'TMP', 'TMPDIR'):
            entorno[k] = str(temporal)
    return entorno


def lanzar(agente: str, encargo: str, carpeta: Path, transcripcion: Path, tanda3: bool = False) -> int:
    entorno = entorno_de(agente, carpeta, tanda3)
    if agente == 'claude' and tanda3:
        # Restricción de verdad (pendiente de la tanda 1): sólo esas herramientas, sin ajustes ni plugins del
        # usuario, sin skills ni MCP; en la terminal sólo se preaprueba node y lo demás se deniega (modo -p).
        orden = [shutil.which('claude') or 'claude', '-p', encargo, '--model', 'sonnet', '--tools', 'Bash,Read,Write,Edit,Glob,Grep',
                 '--setting-sources', 'project,local', '--disable-slash-commands', '--strict-mcp-config', '--permission-mode', 'acceptEdits',
                 '--allowedTools', 'Bash(node:*)', 'Read', 'Write', 'Edit', 'Glob', 'Grep', '--output-format', 'stream-json', '--verbose']
    elif agente == 'claude':
        orden = ['claude', '-p', encargo, '--model', 'sonnet', '--strict-mcp-config', '--permission-mode', 'acceptEdits',
                 '--allowedTools', 'Bash(node:*)', 'Read', 'Write', 'Edit', 'Glob', 'Grep', '--output-format', 'stream-json', '--verbose']
        orden[0] = shutil.which('claude') or 'claude'
    elif agente == 'codex':
        orden = [str(CODEX), 'exec', '--cd', str(carpeta), '--sandbox', 'workspace-write', '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"',
                 '-m', 'gpt-6-luna', '--skip-git-repo-check', '--json', encargo]
    else:
        ajustes = json.dumps({'permissions': {'allow': [f'mcp(espacios3d/{h})' for h in HERRAMIENTAS_MCP]}})
        orden = [str(AGY), '-p', encargo, '--model', 'gemini-4-argon-medium', '--sandbox', '--mode', 'accept-edits',
                 '--print-timeout', f'{PLAZO}s', '--output-format', 'stream-json', '--settings', ajustes]
    with transcripcion.open('w', encoding='utf-8') as f:
        p = subprocess.run(orden, cwd=carpeta, stdout=f, stderr=subprocess.STDOUT, env=entorno, timeout=PLAZO + 120,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    return p.returncode


def copiar_resultado(origen: Path, destino: Path, agente: str) -> None:
    """Copia el resultado. Lo que escribe Codex en su sandbox de Windows sólo se lee desde ese sandbox."""
    try:
        shutil.copy(origen, destino)
    except PermissionError:
        if agente != 'codex':
            raise
        leer = "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8'))"
        r = subprocess.run([str(CODEX), 'sandbox', '--', 'node', '-e', leer, str(origen)], cwd=origen.parents[1], capture_output=True, text=True, encoding='utf-8',
                           check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        destino.write_text(r.stdout, encoding='utf-8')


def puntuar(p: dict, salida: Path, resultado: Path, registro: dict) -> None:
    if resultado.exists():
        copiar_resultado(resultado, salida / 'resultado.espacio.json', p['agente'])
        punt = subprocess.run(['node', str(AQUI / 'puntuar.mjs'), str(AQUI / p['ref']), str(salida / 'resultado.espacio.json'), '--modo', p['modo']],
                              capture_output=True, text=True, encoding='utf-8')
        (salida / 'puntuacion.json').write_text(punt.stdout, encoding='utf-8')
        registro['pasa'] = punt.returncode == 0
    else:
        registro['pasa'] = False
        registro['motivo'] = f'no existe {p["salida"]}'
    (salida / 'registro.json').write_text(json.dumps(registro, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(registro, ensure_ascii=False, indent=1))


def llamo_a_abrir(transcripcion: Path) -> bool:
    """El agente ejecutó «abrir»: una llamada a herramienta, no el texto de un mensaje (revisión independiente, 6).

    Claude: un Bash cuya orden es `node … espacios3d.mjs abrir`. Antigravity: un run_command igual o una
    llamada MCP (call_mcp_tool o una herramienta con «abrir» en el nombre) con «abrir» en sus parámetros.
    [Suposición] la forma de los parámetros de call_mcp_tool: ninguna transcripción tiene una llamada MCP real.
    """
    import re
    orden = re.compile(r'espacios3d\.mjs["\']?\s+abrir\b')
    if not transcripcion.exists():
        return False
    for l in transcripcion.read_text(encoding='utf-8', errors='replace').splitlines():
        try:
            e = json.loads(l)
        except ValueError:
            continue
        if e.get('type') == 'assistant':
            for c in (e.get('message') or {}).get('content') or []:
                if isinstance(c, dict) and c.get('type') == 'tool_use' and c.get('name') == 'Bash' and orden.search((c.get('input') or {}).get('command', '')):
                    return True
        paso = e.get('step_update') or {}
        nombre = paso.get('tool_name') or ''
        parametros = (paso.get('tool_info') or {}).get('parameters') or {}
        if nombre == 'run_command' and orden.search(str(parametros.get('CommandLine', ''))):
            return True
        if (nombre == 'call_mcp_tool' or 'mcp' in nombre) and ('abrir' in nombre or '"abrir"' in json.dumps(parametros, ensure_ascii=False)):
            return True
    return False


def rutas_fuera(transcripcion: Path, raiz: Path) -> list:
    """Rutas fuera de la carpeta de la prueba que Claude puso en sus herramientas (tanda 5).

    `/tmp` de Git Bash es la carpeta temporal de todo el sistema aunque cambie TEMP, así que no se puede
    aislar: se detecta y se anota en el registro para revisarlo. Sólo Claude; las de Antigravity se revisan aparte.
    """
    import re
    if not transcripcion.exists():
        return []
    dentro = str(raiz).replace(chr(92), '/').lower().rstrip('/')
    patron = re.compile(r'[a-z]:/[^"\s\'`;|&<>)]+|(?<![\w.])/tmp(?:/[^"\s\'`;|&<>)]*)?')
    fuera = set()
    for l in transcripcion.read_text(encoding='utf-8', errors='replace').splitlines():
        try:
            e = json.loads(l)
        except ValueError:
            continue
        if not isinstance(e, dict) or e.get('type') != 'assistant':
            continue
        for c in (e.get('message') or {}).get('content') or []:
            if not (isinstance(c, dict) and c.get('type') == 'tool_use'):
                continue
            texto = json.dumps(c.get('input'), ensure_ascii=False).replace(chr(92) * 2, '/').replace(chr(92), '/').lower()
            for r in patron.findall(texto):
                if not r.startswith(dentro):
                    fuera.add(r.rstrip('/.,') or r)
    return sorted(fuera)


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] in ('t3', 't4', 't5'):
        return tanda3(sys.argv[2], sys.argv[1])
    if len(sys.argv) == 4 and sys.argv[1] == 'recuperar':
        # Termina de puntuar una prueba ya ejecutada (sin repetirla) cuyo ejecutor falló al copiar.
        prueba, carpeta = sys.argv[2], Path(sys.argv[3])
        p = PRUEBAS[prueba]
        salida = AQUI / 'resultados' / prueba
        registro = {'prueba': prueba, 'agente': p['agente'], 'encargo': p['encargo'], 'carpeta': str(carpeta), 'recuperado': True,
                    'nota': 'el agente terminó; el ejecutor falló al copiar el resultado (permisos del sandbox de Codex) y se puntúa después, sin repetir'}
        puntuar(p, salida, carpeta / p['salida'], registro)
        return 0
    prueba = sys.argv[1] if len(sys.argv) > 1 else ''
    if prueba not in PRUEBAS:
        print('Uso: ejecutar.py A|B|C|R|B-codex|R-codex')
        return 3
    p = PRUEBAS[prueba]
    salida = AQUI / 'resultados' / prueba
    if salida.exists():
        print(f'La prueba {prueba} ya se ejecutó (un intento por prueba): {salida}')
        return 3
    salida.mkdir(parents=True)
    carpeta = Path(tempfile.mkdtemp(prefix=f'e3d-acept-{prueba}-')) / 'Espacios3D'
    shutil.copytree(DIST, carpeta)
    shutil.copy(AQUI / p['imagen'], carpeta / p['destino'])
    registro = {'prueba': prueba, 'agente': p['agente'], 'encargo': p['encargo'], 'carpeta': str(carpeta), 'inicio': time.strftime('%Y-%m-%d %H:%M:%S')}
    if p['agente'] == 'agy':
        subprocess.run([str(AGY), 'mcp', 'add', 'espacios3d', 'node', str(carpeta / 'espacios3d.mjs'), 'mcp'], check=True, capture_output=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    t0 = time.monotonic()
    try:
        codigo = lanzar(p['agente'], p['encargo'], carpeta, salida / 'transcripcion.jsonl')
    except subprocess.TimeoutExpired:
        codigo = -1
    finally:
        if p['agente'] == 'agy':
            subprocess.run([str(AGY), 'mcp', 'remove', 'espacios3d'], capture_output=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    registro.update({'codigo': codigo, 'segundos': round(time.monotonic() - t0)})
    puntuar(p, salida, carpeta / p['salida'], registro)
    return 0


def tanda3(prueba: str, tanda: str = 't3') -> int:
    """Tandas 3, 4 y 5 (ronda 5): mismas pruebas y condiciones; la 4, con la guía «MCP primero»; la 5, con el plano de fondo obligatorio."""
    if prueba not in PRUEBAS_T3:
        print('Uso: ejecutar.py t3 ' + '|'.join(PRUEBAS_T3))
        return 3
    p = PRUEBAS_T3[prueba]
    salida = AQUI / 'resultados' / tanda / prueba
    if salida.exists():
        print(f'La prueba {prueba} de la tanda {tanda[1:]} ya se ejecutó (un intento por prueba): {salida}')
        return 3
    salida.mkdir(parents=True)
    carpeta = Path(tempfile.mkdtemp(prefix=f'e3d-{tanda}-{prueba}-')) / 'Espacios3D'
    shutil.copytree(DIST, carpeta)
    for origen, destino in p.get('imagenes', [(p.get('imagen'), p.get('destino'))]):
        shutil.copy(AQUI / origen, carpeta / destino)
    registro = {'tanda': int(tanda[1:]), 'prueba': prueba, 'agente': p['agente'], 'encargo': p['encargo'], 'carpeta': str(carpeta), 'inicio': time.strftime('%Y-%m-%d %H:%M:%S')}
    if p['agente'] == 'agy':
        subprocess.run([str(AGY), 'mcp', 'add', 'espacios3d', 'node', str(carpeta / 'espacios3d.mjs'), 'mcp'], check=True, capture_output=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    t0 = time.monotonic()
    try:
        codigo = lanzar(p['agente'], p['encargo'], carpeta, salida / 'transcripcion.jsonl', tanda3=True)
    except subprocess.TimeoutExpired:
        codigo = -1
    finally:
        if p['agente'] == 'agy':
            subprocess.run([str(AGY), 'mcp', 'remove', 'espacios3d'], capture_output=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    registro.update({'codigo': codigo, 'segundos': round(time.monotonic() - t0), 'abrir': llamo_a_abrir(salida / 'transcripcion.jsonl')})
    if p['agente'] == 'claude':
        registro['rutas_fuera'] = rutas_fuera(salida / 'transcripcion.jsonl', carpeta.parent)
    puntuar(p, salida, carpeta / p['salida'], registro)
    return 0


if __name__ == '__main__':
    sys.exit(main())
