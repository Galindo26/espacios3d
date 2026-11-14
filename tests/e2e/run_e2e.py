"""Prueba de extremo a extremo de dist/Espacios3D/Espacios3D.html con Edge (Playwright).

Abre la página desde file:// con un disco falso de varios archivos inyectado como fábrica de
almacenes (los selectores nativos de archivos no se pueden automatizar) y comprueba: cero
peticiones de red, cero errores de consola, estancia, catálogo, arrastre con imán, teclas durante
el arrastre, atajos tras usar la ficha, bloqueo, deshacer/rehacer, solapes, guardado, cambios de
un agente (válidos, en conflicto y con errores), Nuevo/Abrir sin pisar archivos, borrador, 3D y
móvil. Deja capturas en salidas/e2e/ para revisarlas a ojo.

Uso: python tests/e2e/run_e2e.py   (sale con 1 si falla alguna comprobación)
"""
from __future__ import annotations

import atexit
import base64
import json
import os
import math
import shutil
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
HTML = RAIZ / "dist" / "Espacios3D" / "Espacios3D.html"
SALIDA = RAIZ / "salidas" / "e2e"
ARCHIVO = "mi-habitacion.espacio.json"

DISCO_FALSO = """
window.__disco = { archivos: {}, binarios: {}, carpetaNombre: null, lm: 0, siguienteAbrir: null, siguienteGuardar: null, escrituras: 0, aceptados: 0, recordada: null, selectores: 0 };
window.__agente = (n, t) => { const d = window.__disco; d.archivos[n] = { texto: t, lm: ++d.lm }; };
window.__ESPACIOS3D_ALMACEN__ = () => {
  const d = window.__disco;
  let nombre = null;
  let enCarpeta = null;
  let enRecordada = false;
  return {
    tipo: 'prueba',
    nombreArchivo: () => nombre,
    vinculado: () => nombre !== null,
    abrir: async () => {
      const n = d.siguienteAbrir; d.siguienteAbrir = null;
      if (!n || !d.archivos[n]) return null;
      return { texto: d.archivos[n].texto, nombre: n, aceptar: async () => { nombre = n; d.aceptados += 1; } };
    },
    guardar: async (t) => { d.archivos[nombre] = { texto: t, lm: ++d.lm }; d.escrituras += 1; },
    guardarComo: async (t, s) => {
      const n = d.siguienteGuardar || s; d.siguienteGuardar = null;
      nombre = n; d.archivos[n] = { texto: t, lm: ++d.lm }; d.escrituras += 1; return true;
    },
    leer: async () => (nombre && d.archivos[nombre] ? { ...d.archivos[nombre] } : null),
    abrirCarpeta: async () => { d.selectores += 1; enRecordada = false; return d.carpetaNombre ? { nombre: d.carpetaNombre, archivos: Object.keys(d.archivos).filter((n) => /\\.espacio\\.json$/.test(n)).sort() } : null; },
    abrirCarpetaRecordada: async (valido) => { const r = d.recordada; if (!r || (valido && !valido(r.nombre))) return null; enRecordada = true; return { nombre: r.nombre, archivos: Object.keys(r.archivos).sort() }; },
    abrirDeCarpeta: async (ruta) => ({ texto: (enRecordada ? d.recordada.archivos : d.archivos)[ruta].texto, nombre: ruta, aceptar: async () => { nombre = ruta; enCarpeta = ruta; d.aceptados += 1; } }),
    crearEnCarpeta: async (n, t) => { d.archivos[n] = { texto: t, lm: ++d.lm }; return { texto: t, nombre: n, aceptar: async () => { nombre = n; enCarpeta = n; } }; },
    carpeta: () => (d.carpetaNombre ? { nombre: d.carpetaNombre, archivo: enCarpeta } : null),
    leerRelativo: async (ruta) => d.binarios[ruta] || null,
    escribirRelativo: async (ruta, datos) => { d.binarios[ruta] = datos; },
  };
};
"""

fallos: list[str] = []


def png_sintetico(ancho: int = 900, alto: int = 700) -> bytes:
    """Plano sintético (por defecto 900 x 700 px): una habitación dibujada con líneas negras de (100, 100) a (700, 550)."""
    import struct
    import zlib

    filas = []
    for y in range(alto):
        fila = bytearray(b"\xff" * (ancho * 3))
        for x in range(ancho):
            en_x = 96 <= x <= 704 and (abs(y - 100) <= 4 or abs(y - 550) <= 4)
            en_y = 96 <= y <= 554 and (abs(x - 100) <= 4 or abs(x - 700) <= 4)
            if en_x or en_y:
                fila[x * 3:x * 3 + 3] = b"\x11\x11\x11"
        filas.append(b"\x00" + bytes(fila))
    trozo = lambda tipo, datos: struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", zlib.crc32(tipo + datos) & 0xFFFFFFFF)
    cabecera = struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + trozo(b"IHDR", cabecera) + trozo(b"IDAT", zlib.compress(b"".join(filas))) + trozo(b"IEND", b"")


def comprobar(cond: bool, mensaje: str) -> None:
    print(("  ok   " if cond else "  FALLO ") + mensaje)
    if not cond:
        fallos.append(mensaje)


def espacio(page: Page) -> dict:
    return page.evaluate("window.__ESPACIOS3D__.espacio()")


def mueble(page: Page, id_: str) -> dict:
    return next(m for m in espacio(page)["plantas"][0]["muebles"] if m["id"] == id_)


def ids(page: Page) -> list[str]:
    return [m["id"] for m in espacio(page)["plantas"][0]["muebles"]]


def pantalla(page: Page, x: float, y: float, z: float = 0) -> tuple[float, float]:
    p = page.evaluate("([x, y, z]) => window.__ESPACIOS3D__.aPantalla(x, y, z)", [x, y, z])
    return p[0], p[1]


def mover_raton(page: Page, desde: tuple[float, float], hasta: tuple[float, float], pasos: int = 12) -> None:
    for i in range(1, pasos + 1):
        page.mouse.move(desde[0] + (hasta[0] - desde[0]) * i / pasos, desde[1] + (hasta[1] - desde[1]) * i / pasos)


def arrastrar(page: Page, desde: tuple[float, float], hasta: tuple[float, float], shift: bool = False) -> None:
    page.mouse.move(*desde)
    page.mouse.down()
    if shift:
        page.keyboard.down("Shift")
    mover_raton(page, desde, hasta)
    page.mouse.up()
    if shift:
        page.keyboard.up("Shift")


def poner(page: Page, selector: str, valor: str) -> None:
    page.fill(selector, valor)
    page.press(selector, "Enter")


def archivo(page: Page, nombre: str = ARCHIVO) -> dict | None:
    a = page.evaluate("n => window.__disco.archivos[n] || null", nombre)
    return json.loads(a["texto"]) if a else None


def agente(page: Page, contenido: dict | str, nombre: str = ARCHIVO) -> None:
    texto = contenido if isinstance(contenido, str) else json.dumps(contenido)
    page.evaluate("([n, t]) => window.__agente(n, t)", [nombre, texto])


def aceptar_dialogo(page: Page) -> str:
    page.wait_for_selector("#dialogo[open]")
    texto = page.locator("#dialogo").inner_text()
    page.click("#dialogo-aceptar")
    return texto


def nueva_pagina(ctx, errores: list[str]) -> Page:
    page = ctx.new_page()
    page.on("console", lambda m: errores.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errores.append(str(e)))
    page.on("dialog", lambda d: d.accept())  # beforeunload al recargar con cambios pendientes
    page.goto(HTML.as_uri())
    page.wait_for_function("window.__ESPACIOS3D__ !== undefined")
    page.wait_for_timeout(200)
    return page


def ronda6_pagina(contexto, errores: list[str]) -> None:
    """Ronda 6, pasada de la página: teclado, modos, recorrido y fichas (revisión independiente)."""
    print("Ronda 6: teclado, modos, recorrido y fichas")
    ctx = contexto(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    q = nueva_pagina(ctx, errores)
    e3d = lambda expr: q.evaluate(f"window.__ESPACIOS3D__.{expr}")
    contorno = lambda: espacio(q)["plantas"][0]["estancias"][0]["contorno"]

    def abrir(nombre: str, casa: dict, titulo: str) -> None:
        q.evaluate("([n, t]) => { window.__agente(n, t); window.__disco.siguienteAbrir = n; }", [nombre, json.dumps(casa)])
        q.click("#b-abrir")
        q.wait_for_function("n => window.__ESPACIOS3D__.espacio().nombre === n", arg=titulo, timeout=5000)

    def reescribir(nombre: str, cambio: str, hecho: str) -> None:
        """El agente cambia el archivo vinculado (partiendo de lo guardado) y se espera a que la página lo lea."""
        q.wait_for_function("!window.__ESPACIOS3D__.pendiente()", timeout=5000)
        q.evaluate("([n, f]) => { const e = JSON.parse(window.__disco.archivos[n].texto); new Function('e', f)(e); window.__agente(n, JSON.stringify(e)); }", [nombre, cambio])
        q.wait_for_function(hecho, timeout=8000)

    def tecla_en(selector: str, tecla: str) -> bool:
        """Una tecla con el foco en un control (aunque esté oculto). Devuelve si la página la anuló."""
        return q.evaluate(
            "([s, k]) => { const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); document.querySelector(s).dispatchEvent(ev); return ev.defaultPrevented; }",
            [selector, tecla],
        )

    # 6. Un error en una medida de la estancia deja los campos como el modelo; un campo vacío no es 0.
    poner(q, "#e-alto", "-10")
    comprobar(q.locator("#e-error").is_visible() and q.input_value("#e-alto") == "250", f"tras un alto rechazado, el campo vuelve a 250 (queda «{q.input_value('#e-alto')}»)")
    poner(q, "#e-ancho", "400")
    comprobar(contorno()[1] == [400, 0] and not q.locator("#e-error").is_visible(), "y el ancho siguiente se aplica sin arrastrar el alto rechazado")
    poner(q, "#e-ancho", "")
    comprobar(q.input_value("#e-ancho") == "400" and not q.locator("#e-error").is_visible(), f"vaciar el ancho lo deja como estaba, sin error (queda «{q.input_value('#e-ancho')}»)")
    poner(q, "#e-ancho", "350")

    # 9 y 10. Con el foco en un deslizador o una casilla, o con la foto ampliada, las teclas no son del mueble.
    q.click('#catalogo button[data-tipo="cama"]')
    antes = mueble(q, "cama")
    anulada = tecla_en("#f-opacidad", "ArrowLeft")
    comprobar(mueble(q, "cama")["x"] == antes["x"] and not anulada, "con el foco en el deslizador de opacidad, ← es del deslizador y no mueve el mueble")
    tecla_en("#f-opacidad", "Delete")
    tecla_en("#m-bloqueado", "Delete")
    comprobar("cama" in ids(q), "Supr con el foco en un deslizador o una casilla no borra el mueble")
    q.evaluate("document.querySelector('#dialogo-foto').showModal()")
    q.keyboard.press("Delete")
    q.keyboard.press("r")
    comprobar("cama" in ids(q) and mueble(q, "cama")["giro"] == antes["giro"], "con la foto ampliada abierta, Supr y R no actúan sobre el mueble de detrás")
    q.evaluate("document.querySelector('#dialogo-foto').close()")

    # 2. Recorrer, Medir y Dibujar se cierran entre sí.
    q.evaluate("document.querySelector('#b-dibujar').click()")
    comprobar(q.get_attribute("#b-dibujar", "aria-pressed") == "true", "«Dibujar» queda activo")
    q.keyboard.press("p")
    comprobar(e3d("recorrido().activo") and q.get_attribute("#b-dibujar", "aria-pressed") == "false", "entrar a recorrer cierra «Dibujar»")
    q.evaluate("document.querySelector('#b-medir').click()")
    comprobar(not e3d("recorrido().activo") and q.get_attribute("#b-medir", "aria-pressed") == "true", "«Medir» mientras se recorre sale del recorrido")
    q.keyboard.press("p")
    comprobar(e3d("recorrido().activo") and q.get_attribute("#b-medir", "aria-pressed") == "false", "y entrar a recorrer cierra «Medir»")
    q.evaluate("document.querySelector('#b-dibujar').click()")
    comprobar(not e3d("recorrido().activo") and q.get_attribute("#b-dibujar", "aria-pressed") == "true", "«Dibujar» mientras se recorre sale del recorrido")
    q.keyboard.press("Escape")

    # 1. Recorriendo, Ctrl+S guarda (no es la S de andar hacia atrás) y Ctrl+D no duplica.
    q.keyboard.press("p")
    pos = e3d("recorrido().pos")
    q.keyboard.down("Control")
    q.keyboard.down("s")
    q.wait_for_timeout(400)
    q.keyboard.up("s")
    q.keyboard.up("Control")
    try:
        q.wait_for_function(f"!!window.__disco.archivos['{ARCHIVO}']", timeout=3000)
        guardado = True
    except Exception:
        guardado = False
    comprobar(guardado, "recorriendo, Ctrl+S guarda")
    comprobar(e3d("recorrido().pos") == pos, f"y no hace andar hacia atrás ({pos} → {e3d('recorrido().pos')})")
    q.keyboard.press("Control+d")
    comprobar(len(ids(q)) == 1, "Ctrl+D no duplica mientras se recorre")

    # 4. El giro con el ratón no se queda enganchado al perder el foco, al cancelarse el puntero ni al salir.
    caja = q.locator("#lienzo canvas").bounding_box()
    cx, cy = caja["x"] + caja["width"] / 2, caja["y"] + caja["height"] / 2
    # Como en un navegador que no concede el ratón (Pointer Lock): se mira arrastrando.
    q.evaluate("() => { document.querySelector('#lienzo canvas').requestPointerLock = () => Promise.reject(new Error('sin Pointer Lock')); }")
    def suelto_tras(accion: str) -> bool:
        q.mouse.move(cx, cy)
        q.mouse.down()
        q.wait_for_timeout(100)
        capturado = q.evaluate("!!document.pointerLockElement")
        q.evaluate(accion)
        rumbo = e3d("recorrido().rumbo")
        q.mouse.move(cx + 90, cy, steps=4)
        igual = e3d("recorrido().rumbo") == rumbo
        q.mouse.up()
        return igual and not capturado
    comprobar(suelto_tras("window.dispatchEvent(new Event('blur'))"), "al perder el foco la ventana, mover el ratón ya no gira la mirada")
    comprobar(suelto_tras("window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }))"), "ni tras cancelarse el puntero")
    q.mouse.move(cx, cy)
    q.mouse.down()
    q.keyboard.press("Escape")
    q.keyboard.press("p")
    rumbo = e3d("recorrido().rumbo")
    q.mouse.move(cx + 90, cy, steps=4)
    comprobar(e3d("recorrido().activo") and e3d("recorrido().rumbo") == rumbo, "ni al salir y volver a entrar sin haber soltado")
    q.mouse.up()
    q.keyboard.press("Escape")

    # 5. «¿Entra por la puerta?» se recalcula al llevar el mueble a otra estancia de la misma planta.
    rect = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    piso = {"formato": "espacios3d", "version": 2, "nombre": "Piso", "plantas": [{"id": "p0", "nombre": "Baja", "nivel": 0, "grosorExterior": 15, "estancias": [
        {"id": "salon", "nombre": "Salón", "contorno": rect(0, 0, 400, 300), "altura": 250, "huecos": [
            {"id": "ext", "tipo": "puerta", "muro": 0, "desde": 50, "ancho": 90, "alto": 205},
            {"id": "p_bano", "tipo": "puerta", "muro": 1, "desde": 50, "ancho": 62, "alto": 203}]},
        {"id": "bano", "nombre": "Baño", "contorno": rect(415, 0, 615, 300), "altura": 250, "huecos": []},
    ], "muebles": [{"id": "arm", "tipo": "armario", "nombre": "Armario", "x": 150, "y": 150, "ancho": 70, "fondo": 70, "alto": 80, "giro": 0}]}]}
    abrir("piso.espacio.json", piso, "Piso")
    q.mouse.click(*pantalla(q, 150, 150, 40))
    q.wait_for_function("window.__ESPACIOS3D__.seleccion() === 'arm'", timeout=3000)
    comprobar(q.inner_text("#m-entra").startswith("Entra por la puerta"), f"el armario entra hasta el salón («{q.inner_text('#m-entra')}»)")
    poner(q, "#m-x", "500")
    comprobar(mueble(q, "arm")["x"] == 500 and q.inner_text("#m-entra").startswith("No entra"), f"y al llevarlo al baño la ficha dice que no entra («{q.inner_text('#m-entra')}»)")

    # 12. «Mover pared» no actúa sobre una estancia que cambió con el diálogo abierto.
    q.keyboard.press("Escape")
    q.evaluate("document.querySelector('#b-mover-pared').click()")
    q.wait_for_selector("#dialogo[open]")
    reescribir("piso.espacio.json", "e.plantas[0].estancias[0].contorno = [[0, 0], [400, 0], [400, 280], [0, 280]];",
               "window.__ESPACIOS3D__.espacio().plantas[0].estancias[0].contorno[2][1] === 280")
    q.click("#dialogo-aceptar")
    q.wait_for_timeout(300)
    comprobar(contorno() == rect(0, 0, 400, 280) and "cambió" in q.inner_text("#aviso"), f"mover pared avisa de que la estancia cambió y no la toca ({contorno()}; «{q.inner_text('#aviso')[:80]}»)")
    if q.locator("#dialogo[open]").count():
        q.keyboard.press("Escape")

    # 3. Recorriendo, si desaparece la escalera que se pisa o la planta en la que se está, se vuelve a pisar suelo.
    casa = {"formato": "espacios3d", "version": 2, "nombre": "Dos plantas", "plantas": [
        {"id": "pb", "nivel": 0, "estancias": [{"id": "s", "contorno": rect(0, 0, 500, 400), "altura": 250, "huecos": []}], "muebles": [],
         "escaleras": [{"id": "esc", "x": 185, "y": 240, "ancho": 150, "largo": 280, "hasta": "p1"}]},
        {"id": "p1", "nivel": 280, "estancias": [{"id": "t", "contorno": rect(0, 0, 500, 400), "altura": 250, "huecos": []}], "muebles": []},
    ]}
    abrir("dos.espacio.json", casa, "Dos plantas")
    q.click("#b-recorrer")
    q.evaluate("window.__ESPACIOS3D__.colocarRecorrido(185, 240, 270)")
    comprobar(e3d("recorrido().escalera") == "esc", "se está en la escalera")
    reescribir("dos.espacio.json", "delete e.plantas[0].escaleras;", "!window.__ESPACIOS3D__.espacio().plantas[0].escaleras")
    q.wait_for_timeout(200)
    comprobar(e3d("recorrido().activo") and e3d("recorrido().escalera") is None, "si un agente quita la escalera que se pisa, se deja de estar en ella")
    q.keyboard.press("Escape")
    q.click('#lista-plantas button[data-planta="p1"]')
    q.wait_for_function("window.__ESPACIOS3D__.plantaActiva() === 'p1'", timeout=3000)
    q.click("#b-recorrer")
    comprobar(e3d("recorrido().planta") == "p1", "se recorre la planta de arriba")
    reescribir("dos.espacio.json", "e.plantas.pop();", "window.__ESPACIOS3D__.espacio().plantas.length === 1")
    q.wait_for_timeout(200)
    comprobar(e3d("recorrido().activo") and e3d("recorrido().planta") == "pb", f"si un agente quita la planta en la que se está, se pasa a la que queda («{e3d('recorrido().planta')}»)")

    # 4 (segunda parte). Salir y volver a entrar en el mismo fotograma no deja dos bucles andando a la vez.
    q.evaluate("() => { for (let i = 0; i < 2; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true })); }")
    comprobar(e3d("recorrido().activo"), "tras salir y entrar seguidos se sigue recorriendo")
    q.evaluate("window.__ESPACIOS3D__.colocarRecorrido(100, 200, 0)")
    q.keyboard.down("w")
    q.wait_for_timeout(600)
    q.keyboard.up("w")
    q.wait_for_timeout(100)
    andado = e3d("recorrido().pos")[0] - 100
    comprobar(40 < andado < 125, f"y se anda a la velocidad de siempre, no al doble ({round(andado)} cm en 0,6 s; a 140 cm/s son 84)")
    q.keyboard.press("Escape")

    # 11. Esc en «Paredes una a una» deshace el campo y también el aviso de descuadre y los «cambios sin aplicar».
    q.click("#paredes summary")
    celda = q.locator("#tabla-paredes tr").nth(0).locator('[data-campo="longitud"]')
    celda.fill("650")
    comprobar("No cierran" in q.inner_text("#descuadre"), "una pared cambiada sin aplicar descuadra la tabla")
    celda.press("Escape")
    comprobar(celda.input_value() == "500" and q.inner_text("#descuadre") == "Las paredes cierran.", f"Esc la deja como estaba y el aviso vuelve a decir que cierran («{q.inner_text('#descuadre')}»)")
    poner(q, "#e-ancho", "480")
    comprobar(contorno()[1] == [480, 0] and "descartado" not in q.inner_text("#descuadre"), f"y un cambio posterior no avisa de cambios descartados que no había («{q.inner_text('#descuadre')}»)")
    ctx.close()


def ronda6_aceptacion() -> None:
    """Ronda 6: el ejecutor de la aceptación con agentes no da por buena una carpeta hermana."""
    print("Ronda 6: ejecutor de la aceptación")
    sys.path.insert(0, str(RAIZ / "tests" / "aceptacion"))
    try:
        import ejecutar
    finally:
        sys.path.pop(0)
    with tempfile.TemporaryDirectory() as tmp:
        raiz = Path(tmp) / "e3d-prueba"
        raiz.mkdir()
        dentro, hermana = (raiz / "casa.espacio.json").as_posix(), (Path(tmp) / "e3d-prueba_otra" / "f.txt").as_posix()
        t = Path(tmp) / "transcripcion.jsonl"
        t.write_text("\n".join(json.dumps({"type": "assistant", "message": {"content": [{"type": "tool_use", "input": {"file_path": r}}]}}) for r in (dentro, hermana)), encoding="utf-8")
        fuera = ejecutar.rutas_fuera(t, raiz)
        comprobar(fuera == [hermana.lower()], f"una ruta en una carpeta hermana con el mismo prefijo cuenta como de fuera, y la de dentro no ({fuera})")


def main() -> int:
    if not HTML.exists():
        print(f"No existe {HTML}; ejecuta antes node scripts/build.mjs")
        return 1
    SALIDA.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        navegador = pw.chromium.launch(channel="msedge", headless=True)
        peticiones: list[str] = []
        errores: list[str] = []

        def contexto(**kw):
            ctx = navegador.new_context(**kw)
            # Criterio: ninguna petición http(s)/ws. Las páginas internas del navegador (edge://, p. ej.
            # el panel de descargas al exportar) no salen a la red.
            ctx.on("request", lambda r: peticiones.append(r.url) if r.url.startswith(("http:", "https:", "ws:", "wss:")) else None)
            ctx.on("websocket", lambda ws: peticiones.append(ws.url))
            ctx.add_init_script(DISCO_FALSO)
            return ctx

        ctx = contexto(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = nueva_pagina(ctx, errores)

        print("Carga")
        comprobar(page.title().endswith("Espacios 3D"), f"título: {page.title()}")
        comprobar(page.locator("canvas").count() == 1, "hay un lienzo WebGL")
        comprobar(espacio(page)["plantas"][0]["estancias"][0]["contorno"] == [[0, 0], [350, 0], [350, 300], [0, 300]], "estancia por defecto 350×300")
        comprobar(page.locator("#estado-guardado").inner_text() == "Sin guardar", "estado inicial «Sin guardar»")
        page.screenshot(path=str(SALIDA / "01_inicio.png"))

        print("Estancia")
        poner(page, "#e-ancho", "380")
        comprobar(espacio(page)["plantas"][0]["estancias"][0]["contorno"][1] == [380, 0], "el ancho cambia a 380")
        poner(page, "#e-ancho", "0")
        comprobar(page.locator("#e-error").is_visible(), "ancho 0 muestra un error")
        comprobar(espacio(page)["plantas"][0]["estancias"][0]["contorno"][1] == [380, 0], "y no cambia la estancia")
        poner(page, "#e-ancho", "380")

        print("Catálogo, arrastre con imán y teclado")
        page.click('#catalogo button[data-tipo="cama"]')
        cama = mueble(page, "cama")
        comprobar((cama["x"], cama["y"]) == (190, 150), f"cama en el centro: {cama['x']}, {cama['y']}")
        comprobar(page.evaluate("window.__ESPACIOS3D__.seleccion()") == "cama", "la cama queda seleccionada")
        arrastrar(page, pantalla(page, 190, 150, 50), pantalla(page, 190, 104, 50))
        cama = mueble(page, "cama")
        comprobar(cama["y"] == 100, f"el imán la pega al muro superior (y = {cama['y']})")
        comprobar(abs(cama["x"] - 190) <= 2, f"sin desviarse en x ({cama['x']})")
        arrastrar(page, pantalla(page, cama["x"], 100, 50), pantalla(page, cama["x"], 104, 50), shift=True)
        comprobar(abs(mueble(page, "cama")["y"] - 104) <= 1.5, f"con Mayús no hay imán (y = {mueble(page, 'cama')['y']})")
        page.keyboard.press("Control+z")
        comprobar(mueble(page, "cama")["y"] == 100, "Ctrl+Z deshace el último arrastre")
        page.keyboard.press("Control+y")
        comprobar(abs(mueble(page, "cama")["y"] - 104) <= 1.5, "Ctrl+Y lo rehace")
        page.keyboard.press("Control+z")
        page.keyboard.press("r")
        comprobar(mueble(page, "cama")["giro"] == 15, "R gira 15°")
        page.keyboard.press("Shift+R")
        comprobar(mueble(page, "cama")["giro"] == 105, "Mayús+R gira 90° más")
        page.keyboard.press("Control+z")
        page.keyboard.press("Control+z")
        comprobar(mueble(page, "cama")["giro"] == 0, "deshacer los giros")
        page.keyboard.press("ArrowDown")
        comprobar(mueble(page, "cama")["y"] == 101, "flecha abajo empuja 1 cm en el plano")
        page.keyboard.press("Shift+ArrowRight")
        comprobar(mueble(page, "cama")["x"] == cama["x"] + 10, "Mayús+flecha derecha empuja 10 cm")
        page.keyboard.press("Control+z")
        page.keyboard.press("Control+z")
        for _ in range(6):
            page.keyboard.down("ArrowDown")  # Playwright marca repeat a partir de la 2.ª
        page.keyboard.up("ArrowDown")
        comprobar(mueble(page, "cama")["y"] == 106, "flecha mantenida: 6 cm")
        page.keyboard.press("Control+z")
        comprobar(mueble(page, "cama")["y"] == 100, "y se deshace de una vez")

        print("Teclas durante el arrastre")
        c0 = pantalla(page, 190, 150, 50)
        page.mouse.move(*c0)
        page.mouse.down()
        mover_raton(page, c0, pantalla(page, 190, 160, 50), 4)
        page.keyboard.press("Shift+R")
        # Agarrada 50 cm por debajo del centro: el centro queda en y ≈ 78, a 3 cm de pegar la trasera girada (75).
        mover_raton(page, pantalla(page, 190, 160, 50), pantalla(page, 190, 128, 50), 10)
        page.mouse.up()
        cama = mueble(page, "cama")
        comprobar(cama["giro"] == 90, f"Mayús+R en pleno arrastre gira la cama (giro {cama['giro']})")
        comprobar(cama["y"] == 75, f"y el imán usa el giro nuevo: trasera contra el muro (y = {cama['y']}, esperado 75)")
        comprobar("«Cama» (cama) se sale" not in page.locator("#lista-incidencias").inner_text(), "la cama no se sale de la estancia")
        page.keyboard.press("Control+z")
        comprobar((mueble(page, "cama")["giro"], mueble(page, "cama")["y"]) == (0, 100), "el arrastre con giro se deshace de una vez")
        antes = mueble(page, "cama")
        c0 = pantalla(page, 190, 100, 50)
        page.mouse.move(*c0)
        page.mouse.down()
        mover_raton(page, c0, pantalla(page, 250, 200, 50), 6)
        page.keyboard.press("Escape")
        page.mouse.up()
        comprobar(mueble(page, "cama") == antes, "Esc cancela el arrastre")
        comprobar(page.evaluate("window.__ESPACIOS3D__.seleccion()") == "cama", "y conserva la selección")

        print("Más muebles, ficha, solapes y atajos tras usar la ficha")
        for t in ["armario", "escritorio", "silla", "mesilla"]:
            page.click(f'#catalogo button[data-tipo="{t}"]')
        comprobar(len(ids(page)) == 5, "cinco muebles")
        comprobar(page.locator("#lista-incidencias li").count() > 0, "los muebles amontonados en el centro dan incidencias")
        page.click('#lista-muebles button[data-id="cama"]')
        poner(page, "#m-x", "190")
        poner(page, "#m-y", "100")
        page.click('#lista-muebles button[data-id="mesilla"]')
        comprobar(page.evaluate("window.__ESPACIOS3D__.seleccion()") == "mesilla", "seleccionar desde la lista")
        poner(page, "#m-x", "280")
        poner(page, "#m-y", "20")
        comprobar((mueble(page, "mesilla")["x"], mueble(page, "mesilla")["y"]) == (280, 20), "mover con la ficha")
        textos = page.locator("#lista-incidencias").inner_text()
        comprobar("«Cama» (cama) y «Mesilla» (mesilla) se solapan" in textos, "la mesilla metida 7,5 cm en la cama se solapa")
        poner(page, "#m-x", "287.5")
        textos = page.locator("#lista-incidencias").inner_text()
        comprobar("«Mesilla» (mesilla) y" not in textos and "y «Mesilla» (mesilla)" not in textos, "a ras de la cama (x 287,5) ya no se solapa")
        page.keyboard.press("r")
        comprobar(mueble(page, "mesilla")["giro"] == 15, "tras Intro en una medida, R vuelve a funcionar")
        page.keyboard.press("Control+z")
        poner(page, "#m-ancho", "-5")
        comprobar(page.locator("#m-error").is_visible(), "ancho negativo muestra un error")
        comprobar(mueble(page, "mesilla")["ancho"] == 45, "y no cambia el mueble")
        poner(page, "#m-ancho", "45")
        page.select_option("#m-tipo", "comoda")
        comprobar(mueble(page, "mesilla")["nombre"] == "Cómoda", "cambiar el tipo actualiza el nombre por defecto")
        page.keyboard.press("r")
        comprobar(mueble(page, "mesilla")["giro"] == 15, "tras usar el selector de tipo, R funciona")
        page.keyboard.press("Control+z")
        page.keyboard.press("Control+z")
        page.keyboard.press("Control+d")
        comprobar(len(ids(page)) == 6 and page.evaluate("window.__ESPACIOS3D__.seleccion()") == "mesilla-2", "Ctrl+D duplica y selecciona la copia")
        page.keyboard.press("Delete")
        comprobar(len(ids(page)) == 5, "Supr quita la copia")

        print("Mueble bloqueado")
        page.click('#lista-muebles button[data-id="armario"]')
        page.check("#m-bloqueado")
        page.keyboard.press("v")
        comprobar(page.evaluate("window.__ESPACIOS3D__.vista()") == "3d", "tras marcar la casilla, V funciona")
        page.keyboard.press("v")
        arm = mueble(page, "armario")
        ref = pantalla(page, 0, 0)
        arrastrar(page, pantalla(page, arm["x"], arm["y"], 200), pantalla(page, arm["x"] + 60, arm["y"] + 60, 200))
        comprobar(mueble(page, "armario") == arm, "arrastrar un mueble bloqueado no lo mueve")
        comprobar(pantalla(page, 0, 0) == ref, "ni desplaza la vista")
        page.locator("canvas").focus()
        page.keyboard.press("Delete")
        comprobar("armario" in ids(page), "Supr no quita un mueble bloqueado")
        comprobar("bloqueado" in page.locator("#aviso").inner_text(), "y avisa de que está bloqueado")
        page.uncheck("#m-bloqueado")
        page.screenshot(path=str(SALIDA / "02_plano_muebles.png"))

        print("Guardado y cambios de un agente")
        page.click("#b-guardar-como")
        page.wait_for_function(f"!!window.__disco.archivos['{ARCHIVO}']")
        comprobar(archivo(page) == espacio(page), "Guardar como escribe el espacio completo con nombre sin tildes")
        comprobar(page.evaluate("localStorage.getItem('espacios3d:borrador:@ultimo')") is None, "tras guardar en archivo se borra el borrador")
        poner(page, "#m-x", "60")
        page.wait_for_function(f"JSON.parse(window.__disco.archivos['{ARCHIVO}'].texto).plantas[0].muebles[1].x === 60", timeout=5000)
        comprobar(True, "se autoguarda tras un cambio (armario x 60)")
        externo = espacio(page)
        externo["plantas"][0]["muebles"][1]["x"] = 70
        agente(page, externo)
        page.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles[1].x === 70", timeout=5000)
        comprobar("desde fuera" in page.locator("#aviso").inner_text(), "un cambio externo se carga solo y se avisa")
        externo["plantas"][0]["muebles"][1]["x"] = 80
        poner(page, "#m-x", "75")
        agente(page, externo)
        page.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles[1].x === 80", timeout=5000)
        page.wait_for_timeout(800)
        comprobar(archivo(page)["plantas"][0]["muebles"][1]["x"] == 80, "en conflicto gana el archivo; no se pisa al agente")
        comprobar("descartado tu último cambio" in page.locator("#aviso").inner_text(), "y se avisa de que se descartó el cambio propio")

        print("Agente que deja el archivo con errores")
        roto = dict(externo, raro=1)
        agente(page, roto)
        page.wait_for_selector("#bloqueo:not([hidden])", timeout=5000)
        comprobar("raro" in page.locator("#bloqueo").inner_text(), "aparece el aviso permanente con el error")
        poner(page, "#m-x", "90")
        page.wait_for_timeout(1500)
        comprobar("raro" in (archivo(page) or {}), "no se guarda encima del archivo con errores")
        page.keyboard.press("Control+s")
        page.wait_for_timeout(300)
        comprobar("raro" in (archivo(page) or {}), "ni con Ctrl+S")
        externo["plantas"][0]["muebles"][1]["x"] = 95
        agente(page, externo)
        page.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles[1].x === 95", timeout=5000)
        comprobar(page.locator("#bloqueo").is_hidden(), "cuando el agente lo arregla, se carga y desaparece el aviso")
        agente(page, roto)
        page.wait_for_selector("#bloqueo:not([hidden])", timeout=5000)
        page.click("#b-mi-version")
        aceptar_dialogo(page)
        page.wait_for_function(f"!JSON.parse(window.__disco.archivos['{ARCHIVO}'].texto).raro", timeout=5000)
        comprobar(archivo(page) == espacio(page), "«Guardar mi versión encima» sobrescribe con lo que se ve")
        comprobar(page.locator("#bloqueo").is_hidden(), "y quita el bloqueo")

        print("Abrir un archivo con errores")
        agente(page, {"formato": "espacios3d", "version": 1, "estancia": {"contorno": [[0, 0], [1, 1]]}}, "malo.espacio.json")
        page.evaluate("window.__disco.siguienteAbrir = 'malo.espacio.json'")
        antes = espacio(page)
        page.click("#b-abrir")
        page.wait_for_selector("#dialogo[open]")
        comprobar("contorno" in page.locator("#dialogo-cuerpo").inner_text(), "el diálogo explica el error de contorno")
        page.click("#dialogo-aceptar")
        comprobar(espacio(page) == antes, "el espacio no cambia")
        comprobar(page.evaluate("window.__disco.aceptados") == 0, "y el archivo con errores no queda vinculado")
        poner(page, "#m-x", "100")
        page.wait_for_timeout(1000)
        comprobar(archivo(page, "malo.espacio.json")["estancia"]["contorno"] == [[0, 0], [1, 1]], "un cambio posterior no escribe en el archivo con errores")
        comprobar(archivo(page)["plantas"][0]["muebles"][1]["x"] == 100, "sigue guardando en el archivo vinculado")

        print("Nuevo y Abrir sin pisar archivos")
        escrituras = page.evaluate("window.__disco.escrituras")
        guardado = archivo(page)
        page.click("#b-nuevo")
        comprobar(ARCHIVO in aceptar_dialogo(page), "Nuevo explica que el archivo actual se queda como está")
        page.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.length === 0", timeout=5000)
        comprobar(espacio(page)["plantas"][0]["muebles"] == [], "el espacio nuevo está vacío")
        page.click('#catalogo button[data-tipo="caja"]')
        page.wait_for_timeout(1000)
        comprobar(page.evaluate("window.__disco.escrituras") == escrituras and archivo(page) == guardado, "los cambios del espacio nuevo no tocan el archivo anterior")
        comprobar("Guardar como" in page.locator("#estado-guardado").inner_text(), "y quedan como pendientes de guardar")
        page.evaluate(f"window.__disco.siguienteAbrir = '{ARCHIVO}'")
        page.click("#b-abrir")
        comprobar("se perderá" in aceptar_dialogo(page), "Abrir con cambios sin archivo pide confirmación")
        page.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.length === 5", timeout=5000)
        comprobar(espacio(page) == guardado and page.evaluate("window.__disco.aceptados") == 1, "y abre el archivo")

        print("Borrador al reabrir la página")
        page.click("#b-nuevo")
        aceptar_dialogo(page)
        page.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.length === 0", timeout=5000)
        page.click('#catalogo button[data-tipo="sofa"]')
        sin_guardar = espacio(page)
        page.reload()
        page.wait_for_function("window.__ESPACIOS3D__ !== undefined")
        comprobar(espacio(page) == sin_guardar, "lo no guardado se recupera al volver a abrir")
        comprobar("Borrador recuperado" in page.locator("#estado-guardado").inner_text(), "y se dice que es un borrador")
        page.click("#b-guardar-como")
        page.wait_for_function("window.__ESPACIOS3D__.pendiente() === false")
        page.reload()
        page.wait_for_function("window.__ESPACIOS3D__ !== undefined")
        comprobar(espacio(page)["plantas"][0]["muebles"] == [] and page.locator("#estado-guardado").inner_text() == "Sin guardar", "tras guardarlo, al reabrir no reaparece el borrador")

        print("Vista 3D")
        page.click('#catalogo button[data-tipo="silla"]')
        page.click("#v-3d")
        page.wait_for_timeout(250)
        comprobar(page.evaluate("window.__ESPACIOS3D__.vista()") == "3d", "cambia a 3D")
        s = mueble(page, "silla")
        arrastrar(page, pantalla(page, s["x"], s["y"], 45), pantalla(page, s["x"], s["y"], 45)[0:1] + (pantalla(page, s["x"], s["y"], 45)[1] - 300,))
        s2 = mueble(page, "silla")
        comprobar(0 <= s2["x"] <= 350 and 0 <= s2["y"] <= 300, f"arrastrar lejos en 3D no saca el mueble de la estancia ({s2['x']}, {s2['y']})")
        page.screenshot(path=str(SALIDA / "03_vista_3d.png"))
        page.keyboard.press("v")
        comprobar(page.evaluate("window.__ESPACIOS3D__.vista()") == "plano", "V vuelve al plano")
        page.click("#b-ayuda")
        page.wait_for_selector("#dialogo[open]")
        page.screenshot(path=str(SALIDA / "04_ayuda.png"))
        page.keyboard.press("Escape")

        print("H3: estancia por paredes, puertas y ventanas, esquinas y formas")
        ctx3 = contexto(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        ph = nueva_pagina(ctx3, errores)
        ph.click("#b-guardar-como")
        ph.wait_for_function(f"!!window.__disco.archivos['{ARCHIVO}']")
        ph.click("#paredes summary")
        comprobar(ph.locator("#tabla-paredes tr").count() == 4, "la tabla muestra las 4 paredes del rectángulo")
        ph.click("#b-pared-mas")
        ph.click("#b-pared-mas")
        ele = [(300, 90), (100, 90), (200, -90), (200, 90), (100, 90), (300, 90)]
        for i, (lon, giro) in enumerate(ele):
            ph.locator("#tabla-paredes tr").nth(i).locator('[data-campo="longitud"]').fill(str(lon))
            ph.locator("#tabla-paredes tr").nth(i).locator('[data-campo="giro"]').fill(str(giro))
        comprobar(ph.locator("#descuadre").inner_text() == "Las paredes cierran.", "la L cierra")
        ph.click("#b-paredes-aplicar")
        comprobar(espacio(ph)["plantas"][0]["estancias"][0]["contorno"] == [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]], "se aplica la estancia en L")
        comprobar(ph.locator("#campo-ancho").is_hidden() and ph.locator("#estancia-libre").is_visible(), "ancho y largo se ocultan en una forma libre")
        ph.locator("#tabla-paredes tr").nth(0).locator('[data-campo="longitud"]').fill("302")
        comprobar("No cierran por 2 cm" in ph.locator("#descuadre").inner_text(), "el descuadre se avisa al escribir")
        ph.click("#b-paredes-aplicar")
        ph.wait_for_selector("#dialogo[open]")
        ph.click("#dialogo-cancelar")
        comprobar(espacio(ph)["plantas"][0]["estancias"][0]["contorno"][1] == [300, 0], "cancelar no cambia la estancia")
        ph.locator("#tabla-paredes tr").nth(0).locator('[data-campo="longitud"]').fill("300")

        ph.click('button[data-hueco="puerta"]')
        hs = espacio(ph)["plantas"][0]["estancias"][0]["huecos"]
        comprobar(len(hs) == 1 and hs[0]["tipo"] == "puerta" and ph.locator("#ficha-hueco").is_visible(), "Añadir puerta la coloca y abre su ficha")
        poner(ph, "#h-desde", "40")
        ph.select_option("#h-abre", "fuera")
        p = espacio(ph)["plantas"][0]["estancias"][0]["huecos"][0]
        comprobar((p["desde"], p["abre"]) == (40, "fuera"), "la ficha cambia desde y sentido de apertura")
        ph.click('button[data-hueco="ventana"]')
        v = next(h for h in espacio(ph)["plantas"][0]["estancias"][0]["huecos"] if h["tipo"] == "ventana")
        comprobar(ph.locator("#campo-antepecho").is_visible() and ph.locator("#campos-puerta").is_hidden(), "la ficha de la ventana muestra el antepecho y no la apertura")
        c = espacio(ph)["plantas"][0]["estancias"][0]["contorno"]
        a, b = c[v["muro"]], c[(v["muro"] + 1) % len(c)]
        largo = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
        t = ((b[0] - a[0]) / largo, (b[1] - a[1]) / largo)
        def en_muro(s: float, dentro: float = 5) -> tuple[float, float]:
            n = (-t[1], t[0])  # contorno horario en planta: interior a la izquierda en ejes matemáticos
            return pantalla(ph, a[0] + t[0] * s + n[0] * dentro, a[1] + t[1] * s + n[1] * dentro)
        medio = v["desde"] + v["ancho"] / 2
        desde0 = v["desde"]
        arrastrar(ph, en_muro(medio), en_muro(medio + 30))
        v2 = next(h for h in espacio(ph)["plantas"][0]["estancias"][0]["huecos"] if h["id"] == v["id"])
        comprobar(abs(v2["desde"] - (desde0 + 30)) <= 2, f"arrastrar la ventana la mueve por su pared ({desde0} → {v2['desde']})")
        ph.keyboard.press("Control+z")
        comprobar(next(h for h in espacio(ph)["plantas"][0]["estancias"][0]["huecos"] if h["id"] == v["id"])["desde"] == desde0, "y se deshace")
        puerta = next(h for h in espacio(ph)["plantas"][0]["estancias"][0]["huecos"] if h["tipo"] == "puerta")
        if puerta["muro"] == v["muro"]:
            arrastrar(ph, en_muro(medio), en_muro(medio - 80))
            v3 = next(h for h in espacio(ph)["plantas"][0]["estancias"][0]["huecos"] if h["id"] == v["id"])
            comprobar(v3["desde"] >= puerta["desde"] + puerta["ancho"], f"no se puede arrastrar encima de la puerta: se para a ras ({v3['desde']})")
            ph.keyboard.press("Control+z")

        ph.check("#editar-esquinas")
        comprobar(ph.evaluate("window.__ESPACIOS3D__.vista()") == "plano", "editar esquinas pasa al plano")
        arrastrar(ph, pantalla(ph, 100, 100), pantalla(ph, 121, 101))
        comprobar(espacio(ph)["plantas"][0]["estancias"][0]["contorno"][3] == [121, 100], f"arrastrar la esquina la mueve y el imán la alinea en y ({espacio(ph)['plantas'][0]['estancias'][0]['contorno'][3]})")
        ph.mouse.dblclick(*pantalla(ph, 200, 100))
        comprobar(len(espacio(ph)["plantas"][0]["estancias"][0]["contorno"]) == 7, "doble clic en una pared añade una esquina")
        ph.locator("canvas").focus()
        ph.keyboard.press("Delete")
        comprobar(len(espacio(ph)["plantas"][0]["estancias"][0]["contorno"]) == 6, "Supr quita la esquina seleccionada")
        ph.screenshot(path=str(SALIDA / "07_l_edicion.png"))
        c_antes = espacio(ph)["plantas"][0]["estancias"][0]["contorno"]
        esq = c_antes[5]
        ph.mouse.move(*pantalla(ph, *esq))
        ph.mouse.down()
        mover_raton(ph, pantalla(ph, *esq), pantalla(ph, esq[0] - 30, esq[1]), 4)
        ph.keyboard.press("Escape")
        ph.mouse.up()
        comprobar(espacio(ph)["plantas"][0]["estancias"][0]["contorno"] == c_antes, "Esc cancela el arrastre de una esquina")
        # Un agente cambia el archivo mientras se arrastra una esquina: su cambio no se pierde.
        externo = espacio(ph)
        externo["plantas"][0]["muebles"].append({"id": "del-agente", "tipo": "caja", "ancho": 40, "fondo": 40, "alto": 40, "x": 50, "y": 200})
        ph.mouse.move(*pantalla(ph, *esq))
        ph.mouse.down()
        mover_raton(ph, pantalla(ph, *esq), pantalla(ph, esq[0] - 30, esq[1]), 4)
        agente(ph, externo)
        ph.wait_for_timeout(1500)
        ph.mouse.up()
        try:
            ph.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.some(m => m.id === 'del-agente')", timeout=6000)
        except Exception:
            print("  DIAG página:", [m["id"] for m in espacio(ph)["plantas"][0]["muebles"]], "archivo:", [m["id"] for m in ((archivo(ph) or {}).get("plantas") or [{}])[0].get("muebles", [])],
                  "pendiente:", ph.evaluate("window.__ESPACIOS3D__.pendiente()"), "estado:", ph.locator("#estado-guardado").inner_text(),
                  "aviso:", ph.locator("#aviso").inner_text(), "contorno:", espacio(ph)["plantas"][0]["estancias"][0]["contorno"])
        ph.wait_for_timeout(800)
        comprobar(any(m["id"] == "del-agente" for m in archivo(ph)["plantas"][0]["muebles"]), "un cambio del agente durante el arrastre de una esquina no se pisa al soltar")
        ph.locator("#tabla-paredes tr").nth(1).locator('[data-campo="longitud"]').fill("123")
        otro = espacio(ph)
        otro["plantas"][0]["estancias"][0]["contorno"][1] = [310, 0]
        agente(ph, otro)
        ph.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].estancias[0].contorno[1][0] === 310", timeout=6000)
        comprobar("se han descartado" in ph.locator("#descuadre").inner_text(), "la tabla con cambios sin aplicar avisa al llegar otro contorno")
        comprobar(ph.locator("#tabla-paredes tr").nth(1).locator('[data-campo="longitud"]').input_value() != "123", "y muestra las paredes actuales")
        ph.uncheck("#editar-esquinas")

        for tipo in ["cama", "armario", "silla", "escritorio"]:
            ph.click(f'#catalogo button[data-tipo="{tipo}"]')
        poner(ph, "#m-x", "60")  # escritorio
        poner(ph, "#m-y", "200")
        ph.click('#lista-muebles button[data-id="cama"]')
        poner(ph, "#m-x", "200")
        poner(ph, "#m-y", "50")
        poner(ph, "#m-giro", "90")
        ph.click('#lista-muebles button[data-id="armario"]')
        poner(ph, "#m-x", "250")
        poner(ph, "#m-y", "70")
        poner(ph, "#m-alto", "200")
        ph.click('#lista-muebles button[data-id="silla"]')
        poner(ph, "#m-x", "60")
        poner(ph, "#m-y", "160")
        poner(ph, "#m-giro", "180")
        ph.screenshot(path=str(SALIDA / "08_l_plano.png"))
        antes = espacio(ph)
        ph.click("#b-paredes-descartar")
        ph.click("#b-paredes-aplicar")
        if ph.locator("#dialogo[open]").count():
            ph.click("#dialogo-aceptar")
        despues = espacio(ph)
        desplazado = max(abs(a - b) for p, q in zip(antes["plantas"][0]["estancias"][0]["contorno"], despues["plantas"][0]["estancias"][0]["contorno"]) for a, b in zip(p, q))
        comprobar(desplazado <= 0.3 and [(m["x"], m["y"]) for m in despues["plantas"][0]["muebles"]] == [(m["x"], m["y"]) for m in antes["plantas"][0]["muebles"]],
                  f"aplicar las paredes sin cambios no mueve la estancia bajo los muebles (máx. {desplazado} cm)")
        ph.click("#v-3d")
        ph.wait_for_timeout(300)
        comprobar(not ph.locator("#editar-esquinas").is_checked(), "al pasar a 3D se deja de editar esquinas")
        v3d = next(h for h in espacio(ph)["plantas"][0]["estancias"][0]["huecos"] if h["tipo"] == "ventana")
        c3 = espacio(ph)["plantas"][0]["estancias"][0]["contorno"]
        a3, b3 = c3[v3d["muro"]], c3[(v3d["muro"] + 1) % len(c3)]
        l3 = ((b3[0] - a3[0]) ** 2 + (b3[1] - a3[1]) ** 2) ** 0.5
        t3 = ((b3[0] - a3[0]) / l3, (b3[1] - a3[1]) / l3)
        s3 = v3d["desde"] + v3d["ancho"] / 2
        punto = (a3[0] + t3[0] * s3 - t3[1] * 8, a3[1] + t3[1] * s3 + t3[0] * 8)
        arrastrar(ph, pantalla(ph, *punto), pantalla(ph, punto[0] + 60, punto[1] + 60))
        comprobar(next(h for h in espacio(ph)["plantas"][0]["estancias"][0]["huecos"] if h["id"] == v3d["id"])["desde"] == v3d["desde"], "en 3D, arrastrar desde una ventana no la mueve (gira la cámara)")
        ph.screenshot(path=str(SALIDA / "09_l_3d.png"))

        print("H4: carpeta de entrega copiada fuera del proyecto")
        copia = Path(tempfile.mkdtemp(prefix="e3d-entrega-")) / "Espacios3D"
        atexit.register(shutil.rmtree, copia.parent, True)  # antes quedaba una copia en %TEMP% por ejecución
        shutil.copytree(HTML.parent, copia)
        presentes = sorted(p.name for p in copia.iterdir())
        comprobar(presentes == [".mcp.json", "AGENTS.md", "CLAUDE.md", "Espacios3D.html", "GEMINI.md", "LEEME.md", "espacios", "espacios3d.mjs", "esquema", "guias"], f"la carpeta lleva lo previsto: {presentes}")
        # Nada del ordenador donde se compiló: ni su carpeta de usuario ni la del proyecto (con las dos barras).
        # E3D_PALABRAS_VETADAS (separadas por comas) añade palabras propias que tampoco deben salir.
        vetadas = {str(Path.home()), Path.home().as_posix(), str(RAIZ), RAIZ.as_posix()}
        vetadas |= {x.strip() for x in os.environ.get("E3D_PALABRAS_VETADAS", "").split(",") if x.strip()}
        sin_personal = all(
            not any(x in p.read_text(encoding="utf-8", errors="ignore") for x in vetadas)
            for p in copia.rglob("*") if p.is_file()
        )
        comprobar(sin_personal, "ningún archivo lleva rutas del ordenador donde se compiló ni palabras vetadas")
        cli = subprocess.run(["node", "espacios3d.mjs", "analizar", "espacios/ejemplo-dormitorio.espacio.json", "--json"], cwd=copia, capture_output=True, text=True)
        comprobar(cli.returncode == 0 and json.loads(cli.stdout)["ok"], f"el CLI funciona desde la copia y el ejemplo no tiene incidencias ({cli.returncode})")
        ctx4 = navegador.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        ctx4.on("request", lambda r: peticiones.append(r.url) if r.url.startswith(("http:", "https:", "ws:", "wss:")) else None)
        ctx4.on("websocket", lambda ws: peticiones.append(ws.url))
        ctx4.add_init_script(DISCO_FALSO)
        p4 = ctx4.new_page()
        p4.on("pageerror", lambda e: errores.append(str(e)))
        p4.on("console", lambda m: errores.append(m.text) if m.type == "error" else None)
        p4.goto((copia / "Espacios3D.html").as_uri())
        p4.wait_for_function("window.__ESPACIOS3D__ !== undefined")
        ejemplo = (copia / "espacios" / "ejemplo-dormitorio.espacio.json").read_text(encoding="utf-8")
        p4.evaluate("t => { window.__agente('ejemplo-dormitorio.espacio.json', t); window.__disco.siguienteAbrir = 'ejemplo-dormitorio.espacio.json'; }", ejemplo)
        p4.click("#b-abrir")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.length === 6")
        comprobar(p4.locator("#sin-incidencias").is_visible(), "el ejemplo se abre sin incidencias")
        comprobar(p4.locator("#lista-distribuciones li").count() == 1, "con su distribución «Inicial»")
        p4.click('#lista-muebles button[data-id="cama"]')
        poner(p4, "#m-x", "200")
        p4.click('#lista-distribuciones button[data-distribucion="Inicial"]')
        comprobar(mueble(p4, "cama")["x"] != 200, "aplicar la distribución devuelve la cama a su sitio")
        p4.fill("#d-nombre", "Otra")
        p4.click('#form-distribucion button[type="submit"]')
        comprobar(p4.locator("#lista-distribuciones li").count() == 2, "guardar otra distribución")
        for formato, minimo in (("svg", 2000), ("png", 5000), ("glb", 5000)):
            with p4.expect_download() as descarga:
                p4.click(f"#x-{formato}")
            ruta = copia.parent / f"exportado.{formato}"
            descarga.value.save_as(ruta)
            datos = ruta.read_bytes()
            comprobar(len(datos) >= minimo, f"exporta {formato} ({len(datos)} bytes, nombre {descarga.value.suggested_filename})")
        glb = (copia.parent / "exportado.glb").read_bytes()
        largo_json = int.from_bytes(glb[12:16], "little")
        gltf = json.loads(glb[20:20 + largo_json])
        nombres = {n.get("name") for n in gltf.get("nodes", [])}
        comprobar(glb[:4] == b"glTF" and {"cama", "armario", "escritorio", "muros", "estancia", "muebles"} <= nombres, f"el .glb es glTF binario con un nodo por mueble y muro ({sorted(n for n in nombres if n)[:8]}…)")
        comprobar(all(m.get("pbrMetallicRoughness") is not None for m in gltf.get("materials", [])), "materiales PBR estándar")
        p4.click("#v-3d")
        p4.wait_for_timeout(300)
        p4.screenshot(path=str(SALIDA / "10_ejemplo_3d.png"))
        # R2-3: el PNG que genera el CLI (plano --png) lo decodifica Edge.
        png_cli = subprocess.run(["node", "espacios3d.mjs", "plano", "espacios/ejemplo-dormitorio.espacio.json", "--png", str(copia.parent / "plano-cli.png"), "--rejilla", "--json"], cwd=copia, capture_output=True, text=True)
        info = json.loads(png_cli.stdout or "{}")
        medidas = p4.evaluate("""u => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = u; })""", (copia.parent / "plano-cli.png").as_uri())
        comprobar(png_cli.returncode == 0 and medidas == [info.get("ancho"), info.get("alto")], f"Edge decodifica el PNG del CLI ({medidas} frente a {info.get('ancho')} x {info.get('alto')})")

        print("R2-1: abrir un archivo de la versión 1")
        v1 = (RAIZ / "tests" / "referencia_v1" / "rectangular" / "espacio.v1.json").read_text(encoding="utf-8")
        p4.evaluate("t => { window.__agente('vieja.espacio.json', t); window.__disco.siguienteAbrir = 'vieja.espacio.json'; }", v1)
        p4.click("#b-abrir")
        p4.wait_for_selector("#dialogo[open]")
        comprobar("versión 1" in p4.locator("#dialogo").inner_text(), "abrir un archivo v1 avisa de que se convertirá")
        p4.click("#dialogo-cancelar")
        comprobar(len(espacio(p4)["plantas"][0]["muebles"]) == 6, "cancelar deja el espacio como estaba")
        p4.evaluate("window.__disco.siguienteAbrir = 'vieja.espacio.json'")
        p4.click("#b-abrir")
        aceptar_dialogo(p4)
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.length === 5", timeout=5000)
        comprobar(archivo(p4, "vieja.espacio.json")["version"] == 1, "abrir no reescribe el archivo")
        p4.click('#lista-muebles button[data-id="cama"]')
        poner(p4, "#m-x", "250")
        p4.wait_for_function("JSON.parse(window.__disco.archivos['vieja.espacio.json'].texto).version === 2", timeout=5000)
        convertido = archivo(p4, "vieja.espacio.json")
        comprobar(next(m for m in convertido["plantas"][0]["muebles"] if m["id"] == "cama")["x"] == 250, "el primer cambio lo guarda convertido a v2")

        print("R2-2: piso de 3 estancias con pasillo")
        p4.click("#v-plano")
        rect = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        piso = {
            "formato": "espacios3d", "version": 2, "nombre": "Piso",
            "plantas": [{
                "id": "pb", "grosorExterior": 10,
                "estancias": [
                    {"id": "pasillo", "nombre": "Pasillo", "contorno": rect(0, 0, 800, 100), "huecos": [{"id": "entrada", "tipo": "puerta", "muro": 3, "desde": 10, "ancho": 80}]},
                    {"id": "salon", "nombre": "Salón", "contorno": rect(0, 110, 300, 410), "huecos": [{"id": "p-salon", "tipo": "puerta", "muro": 0, "desde": 100, "ancho": 80}]},
                    {"id": "cocina", "nombre": "Cocina", "contorno": rect(310, 110, 500, 410), "huecos": [{"id": "p-cocina", "tipo": "paso", "muro": 0, "desde": 50, "ancho": 80}]},
                    {"id": "dormitorio", "nombre": "Dormitorio", "contorno": rect(510, 110, 800, 410), "huecos": [{"id": "p-dormitorio", "tipo": "puerta", "muro": 0, "desde": 100, "ancho": 90}]},
                ],
                "muebles": [{"id": "sofa", "tipo": "sofa", "ancho": 200, "fondo": 90, "alto": 85, "x": 150, "y": 360, "giro": 180}],
            }],
        }
        p4.evaluate("t => { window.__agente('piso.espacio.json', t); window.__disco.siguienteAbrir = 'piso.espacio.json'; }", json.dumps(piso))
        p4.click("#b-abrir")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].estancias.length === 4", timeout=5000)
        chips = p4.locator("#lista-estancias button")
        comprobar(chips.count() == 4 and chips.first.get_attribute("aria-pressed") == "true", "una pastilla por estancia; la primera, elegida")
        p4.click('#lista-estancias button[data-estancia="salon"]')
        comprobar(p4.evaluate("window.__ESPACIOS3D__.estancia()") == "salon" and p4.input_value("#e-nombre") == "Salón", "elegir el salón muestra su nombre")
        comprobar(p4.input_value("#e-ancho") == "300" and p4.input_value("#e-largo") == "300", "y sus medidas")
        # D3 de la revisión de R2-2: la puerta del salón se ve abierta desde los dos lados (también la pared del pasillo).
        comprobar(not p4.evaluate("window.__ESPACIOS3D__.hayMuroEntre([140, 50], [140, 160], 100)"), "la puerta del salón atraviesa la pared del pasillo y la del salón")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.hayMuroEntre([50, 50], [50, 160], 100)"), "fuera de la puerta hay tabique")
        # D4: con el pasillo elegido, arrastrar la puerta del salón la mueve y elige el salón.
        p4.click('#lista-estancias button[data-estancia="pasillo"]')
        x0, y0 = p4.evaluate("window.__ESPACIOS3D__.aPantalla(140, 115)")
        x1, y1 = p4.evaluate("window.__ESPACIOS3D__.aPantalla(200, 115)")
        p4.mouse.move(x0, y0)
        p4.mouse.down()
        p4.mouse.move((x0 + x1) / 2, y0, steps=4)
        p4.mouse.move(x1, y1, steps=4)
        p4.mouse.up()
        p_salon = next(h for s in espacio(p4)["plantas"][0]["estancias"] if s["id"] == "salon" for h in s["huecos"] if h["id"] == "p-salon")
        comprobar(p_salon["desde"] == 160 and p4.evaluate("window.__ESPACIOS3D__.estancia()") == "salon", f"arrastrar la puerta de otra estancia la mueve y elige esa estancia (desde {p_salon['desde']})")
        p4.click('#lista-estancias button[data-estancia="salon"]')
        # Pulsar el suelo de la cocina en el plano la elige.
        x, y = p4.evaluate("window.__ESPACIOS3D__.aPantalla(405, 300)")
        p4.mouse.click(x, y)
        p4.wait_for_function("window.__ESPACIOS3D__.estancia() === 'cocina'", timeout=3000)
        comprobar(p4.input_value("#e-nombre") == "Cocina", "pulsar el suelo de la cocina la elige")
        poner(p4, "#e-alto", "240")
        est = {s["id"]: s for s in espacio(p4)["plantas"][0]["estancias"]}
        comprobar(est["cocina"]["altura"] == 240 and est["salon"]["altura"] == 250, "el alto cambia sólo en la estancia elegida")
        poner(p4, "#e-nombre", "Cocina comedor")
        comprobar(next(s for s in espacio(p4)["plantas"][0]["estancias"] if s["id"] == "cocina")["nombre"] == "Cocina comedor", "renombrar la estancia")
        p4.click('button[data-hueco="ventana"]')
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].estancias.find(s => s.id === 'cocina').huecos.length === 2", timeout=3000)
        comprobar(True, "una ventana nueva va a la estancia elegida")
        p4.click("#b-estancia-mas")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].estancias.length === 5", timeout=3000)
        nueva = espacio(p4)["plantas"][0]["estancias"][-1]
        comprobar(nueva["contorno"][0] == [810, 0] and p4.evaluate("window.__ESPACIOS3D__.estancia()") == nueva["id"], f"Añadir estancia la pone a la derecha, tras un tabique, y la elige ({nueva['contorno'][0]})")
        p4.click("#b-estancia-quitar")
        aceptar_dialogo(p4)
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].estancias.length === 4", timeout=3000)
        comprobar(True, "Quitar estancia con confirmación")
        p4.screenshot(path=str(SALIDA / "11_piso_plano.png"))
        with p4.expect_download() as descarga:
            p4.click("#x-glb")
        ruta = copia.parent / "piso.glb"
        descarga.value.save_as(ruta)
        glb = ruta.read_bytes()
        largo_json = int.from_bytes(glb[12:16], "little")
        gltf = json.loads(glb[20:20 + largo_json])
        nombres = {n.get("name") for n in gltf.get("nodes", [])}
        comprobar({"muros", "suelo-pasillo", "suelo-salon", "suelo-cocina", "suelo-dormitorio", "sofa"} <= nombres, f"el .glb de la página lleva los muros derivados, un suelo por estancia y los muebles ({sorted(n for n in nombres if n)[:10]}…)")
        p4.click("#v-3d")
        p4.wait_for_timeout(300)
        p4.screenshot(path=str(SALIDA / "12_piso_3d.png"))
        p4.click("#v-plano")

        print("R2-3: carpeta de trabajo, plano de fondo, calibrar y calcar; asistentes de chat")
        plano = copia.parent / "plano-sintetico.png"
        plano.write_bytes(png_sintetico())
        rect = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        inicial = {"formato": "espacios3d", "version": 2, "nombre": "Calco", "plantas": [{"id": "pb", "estancias": [{"id": "trastero", "contorno": rect(0, 0, 30, 30)}]}]}
        p4.click("#v-plano")
        p4.evaluate("t => { window.__disco.carpetaNombre = 'casa'; window.__agente('calco.espacio.json', t); }", json.dumps(inicial))
        p4.click("#b-carpeta")
        p4.wait_for_selector("#dialogo[open]")
        p4.check('input[name="archivo-carpeta"][value="calco.espacio.json"]')
        p4.click("#dialogo-aceptar")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().nombre === 'Calco'", timeout=5000)
        comprobar(True, "Carpeta… lista los espacios y abre el elegido")
        with p4.expect_file_chooser() as eleccion:
            p4.click("#b-fondo-poner")
        eleccion.value.set_files(str(plano))
        p4.wait_for_function("(window.__ESPACIOS3D__.espacio().plantas[0].fondos || []).length === 1", timeout=5000)
        f = espacio(p4)["plantas"][0]["fondos"][0]
        comprobar(f["archivo"] == "planos/plano-sintetico.png" and f["anchoPx"] == 900 and f["altoPx"] == 700, f"el plano se copia a planos/ junto al archivo y se anota su tamaño ({f['archivo']}, {f['anchoPx']}x{f['altoPx']})")
        comprobar(p4.evaluate("!!window.__disco.binarios['planos/plano-sintetico.png']"), "y la imagen queda en la carpeta")
        a_plano = lambda f, px, py: (f["x"] + px * f["escala"], f["y"] + py * f["escala"])
        # Calibrar: las dos esquinas de arriba (900 px de ancho, la pared de arriba mide 300 cm).
        for px, py in ((100, 100), (700, 100)):
            x, y = p4.evaluate("([x, y]) => window.__ESPACIOS3D__.aPantalla(x, y)", list(a_plano(f, px, py)))
            p4.mouse.click(x, y)
        p4.wait_for_selector("#dialogo[open]")
        p4.fill("#d-calibrar", "300")
        p4.click("#dialogo-aceptar")
        p4.wait_for_function("Math.abs(window.__ESPACIOS3D__.espacio().plantas[0].fondos[0].escala - 0.5) < 0.01", timeout=5000)
        f = espacio(p4)["plantas"][0]["fondos"][0]
        comprobar(abs(f["escala"] - 0.5) < 0.005, f"calibrar con dos puntos y 300 cm da 0,5 cm por píxel ({f['escala']})")
        # Calcar: dibujar la estancia pulsando las cuatro esquinas del plano y cerrar con Intro.
        p4.click("#b-dibujar")
        esquinas = [a_plano(f, px, py) for px, py in ((100, 100), (700, 100), (700, 550), (100, 550))]
        for xc, yc in esquinas:
            x, y = p4.evaluate("([x, y]) => window.__ESPACIOS3D__.aPantalla(x, y)", [xc, yc])
            p4.mouse.click(x, y)
        p4.keyboard.press("Enter")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].estancias.length === 2", timeout=5000)
        nueva = espacio(p4)["plantas"][0]["estancias"][1]
        xs = [q[0] for q in nueva["contorno"]]
        ys = [q[1] for q in nueva["contorno"]]
        ancho, largo = max(xs) - min(xs), max(ys) - min(ys)
        comprobar(abs(ancho - 300) / 300 < 0.01 and abs(largo - 225) / 225 < 0.01, f"calco de un plano sintético con error < 1 % ({ancho} x {largo} cm frente a 300 x 225)")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.estancia()") == nueva["id"], "la estancia dibujada queda elegida")
        p4.screenshot(path=str(SALIDA / "13_calco.png"))
        # Asistentes de chat: copiar el espacio y pegar una lista de cambios.
        p4.click("#b-copiar-agente")
        p4.wait_for_timeout(300)
        if p4.locator("#dialogo[open]").count():
            p4.click("#dialogo-aceptar")
        copiado = p4.evaluate("window.__ultimoCopiado || ''")
        comprobar('"formato": "espacios3d"' in copiado and "Estancia " in copiado and "lista JSON de operaciones" in copiado, "Copiar para el asistente: instrucciones, descripción y el archivo")
        p4.click("#b-pegar")
        p4.wait_for_selector("#dialogo[open]")
        lote = json.dumps([{"op": "agregar", "tipo": "caja", "id": "pegada", "estancia": nueva["id"]}])
        p4.fill("#dialogo-cuerpo textarea", "Aquí tienes los cambios:\n```json\n" + lote + "\n```")
        p4.click("#dialogo-aceptar")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.some(m => m.id === 'pegada')", timeout=5000)
        comprobar(True, "Pegar cambios aplica una lista de operaciones (también rodeada de ```json)")
        p4.click("#b-pegar")
        p4.wait_for_selector("#dialogo[open]")
        p4.fill("#dialogo-cuerpo textarea", '[{"op": "volar"}]')
        p4.click("#dialogo-aceptar")
        p4.wait_for_selector("#dialogo[open]")
        comprobar("volar" in p4.locator("#dialogo").inner_text(), "un lote erróneo no cambia nada y muestra el error para el asistente")
        p4.click("#dialogo-aceptar")
        comprobar(sum(1 for m in espacio(p4)["plantas"][0]["muebles"] if m["id"] == "pegada") == 1, "y el espacio sigue como estaba")

        print("R2-3: arreglos de la revisión de la página (P1–P5) y Ctrl+V")
        # P2: un plano con el mismo nombre y otro contenido no pisa al anterior.
        otro = copia.parent / "otro" / "plano-sintetico.png"
        otro.parent.mkdir(exist_ok=True)
        otro.write_bytes(png_sintetico(600, 400))
        with p4.expect_file_chooser() as eleccion:
            p4.click("#b-fondo-poner")
        eleccion.value.set_files(str(otro))
        p4.wait_for_function("(window.__ESPACIOS3D__.espacio().plantas[0].fondos || [])[0]?.archivo === 'planos/plano-sintetico-2.png'", timeout=5000)
        comprobar(p4.evaluate("!!window.__disco.binarios['planos/plano-sintetico.png'] && !!window.__disco.binarios['planos/plano-sintetico-2.png']"), "un plano con el mismo nombre se guarda como plano-sintetico-2.png sin pisar el primero")
        # P5: deshacer «Poner plano» sale del modo calibrar.
        p4.keyboard.press("Control+z")
        p4.wait_for_function("(window.__ESPACIOS3D__.espacio().plantas[0].fondos || [])[0]?.archivo === 'planos/plano-sintetico.png'", timeout=5000)
        comprobar(not p4.locator("#modo-ayuda").inner_text().startswith("Calibrar"), "deshacer el plano nuevo sale del modo calibrar")
        # Ronda 6: cambiar la opacidad no deja texturas del plano sin liberar.
        def opacidad(v: str) -> None:
            p4.evaluate("v => { const i = document.querySelector('#f-opacidad'); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); }", v)
            p4.wait_for_function("v => (window.__ESPACIOS3D__.espacio().plantas[0].fondos || [])[0]?.opacidad === Number(v)", arg=v, timeout=5000)
            p4.wait_for_timeout(250)
        opacidad("0.3")
        texturas = p4.evaluate("window.__ESPACIOS3D__.memoria().textures")
        for v in ("0.4", "0.5", "0.6", "0.7"):
            opacidad(v)
        despues = p4.evaluate("window.__ESPACIOS3D__.memoria().textures")
        comprobar(despues <= texturas, f"cambiar la opacidad del plano no acumula texturas ({texturas} → {despues})")
        # P3 y P4: dibujar a pulso (esquinas algo torcidas) y cerrar con un doble clic que se mueve 2 px.
        p4.click("#b-dibujar")
        for xc, yc in ((50, 270), (150, 272), (152, 320)):
            x, y = p4.evaluate("([x, y]) => window.__ESPACIOS3D__.aPantalla(x, y)", [xc, yc])
            p4.mouse.click(x, y)
        x, y = p4.evaluate("([x, y]) => window.__ESPACIOS3D__.aPantalla(x, y)", [53, 322])
        p4.mouse.click(x, y)
        p4.mouse.dblclick(x + 2, y)
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].estancias.length === 3", timeout=5000)
        dibujada = espacio(p4)["plantas"][0]["estancias"][2]["contorno"]
        comprobar(dibujada == [[50, 270], [150, 270], [150, 320], [50, 320]], f"a pulso sale un rectángulo recto (imán a la primera esquina) y el doble clic movido cierra ({dibujada})")
        # P1: «Guardar el espacio actual aquí» y el primer cambio se guarda en el archivo nuevo.
        poner(p4, "#nombre-espacio", "Mi casa")
        p4.click("#b-carpeta")
        p4.wait_for_selector("#dialogo[open]")
        p4.locator('input[name="archivo-carpeta"]').last.check()
        p4.click("#dialogo-aceptar")
        p4.wait_for_function("!!window.__disco.archivos['mi-casa.espacio.json']", timeout=5000)
        poner(p4, "#e-alto", "260")
        p4.wait_for_function("JSON.parse(window.__disco.archivos['mi-casa.espacio.json'].texto).plantas[0].estancias.some(s => s.altura === 260)", timeout=5000)
        comprobar(True, "tras guardar en la carpeta, el primer cambio se guarda en el archivo nuevo")
        # Ctrl+V con una imagen la pone como plano.
        p4.evaluate("""async (b64) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const dt = new DataTransfer();
          dt.items.add(new File([bytes], 'captura.png', { type: 'image/png' }));
          document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
        }""", base64.b64encode(png_sintetico(300, 200)).decode())
        p4.wait_for_function("(window.__ESPACIOS3D__.espacio().plantas[0].fondos || [])[0]?.archivo === 'planos/pegado.png'", timeout=5000)
        comprobar(True, "Ctrl+V con una imagen la pone como plano (planos/pegado.png)")
        p4.keyboard.press("Escape")


        print("R2-4: habitación real (columna, radiador y techo inclinado)")
        p4.click("#v-plano")
        calcada = espacio(p4)["plantas"][0]["estancias"][1]["id"]
        p4.click(f'#lista-estancias button[data-estancia="{calcada}"]')
        p4.click('button[data-obra="columna"]')
        p4.wait_for_function("id => (window.__ESPACIOS3D__.espacio().plantas[0].estancias.find(s => s.id === id).elementos || []).length === 1", arg=calcada, timeout=5000)
        el = next(s for s in espacio(p4)["plantas"][0]["estancias"] if s["id"] == calcada)["elementos"][0]
        comprobar(el["tipo"] == "columna" and el["forma"] == "exento" and el["redondo"], "Columna añade una columna redonda en la estancia elegida")
        comprobar("choca con" in p4.locator("#panel-der").inner_text(), "la caja que había en el centro choca con la columna (incidencia)")
        p4.click('button[data-obra="radiador"]')
        p4.wait_for_selector('#ficha-obra:not([hidden]) input[data-campo="elevacion"]')
        poner(p4, '#ficha-obra input[data-campo="elevacion"]', "20")
        p4.wait_for_function("id => window.__ESPACIOS3D__.espacio().plantas[0].estancias.find(s => s.id === id).elementos.some(e => e.tipo === 'radiador' && e.elevacion === 20)", arg=calcada, timeout=5000)
        comprobar(True, "Radiador con su ficha: cambiar la elevación lo guarda")
        p4.click('button[data-obra="buhardilla"]')
        p4.wait_for_function("id => (window.__ESPACIOS3D__.espacio().plantas[0].estancias.find(s => s.id === id).faldones || []).length === 1", arg=calcada, timeout=5000)
        comprobar(p4.locator('#lista-obra button').count() == 3, "la lista de obra muestra columna, radiador y techo inclinado")
        p4.screenshot(path=str(SALIDA / "14_obra_plano.png"))
        p4.click("#v-3d")
        p4.wait_for_timeout(300)
        p4.screenshot(path=str(SALIDA / "15_obra_3d.png"))
        p4.click("#v-plano")
        # Ronda 6: con paredes pintadas, suelo con textura y el plano de fondo lejos de la casa.
        p4.wait_for_function("JSON.stringify(JSON.parse(window.__disco.archivos['mi-casa.espacio.json'].texto).plantas) === JSON.stringify(window.__ESPACIOS3D__.espacio().plantas)", timeout=8000)
        pintada = espacio(p4)
        est = next(s for s in pintada["plantas"][0]["estancias"] if s["id"] == calcada)
        est["paredes"] = "#c8d6e5"
        est["suelo"] = {"tipo": "parquet"}
        pintada["plantas"][0]["fondos"][0]["x"] -= 3000
        agente(p4, pintada, "mi-casa.espacio.json")
        p4.wait_for_function("id => window.__ESPACIOS3D__.espacio().plantas[0].estancias.find(s => s.id === id).paredes === '#c8d6e5'", arg=calcada, timeout=5000)
        p4.wait_for_function("window.__ESPACIOS3D__.fondos()[0]?.estado === 'imagen'", timeout=8000)
        p4.wait_for_timeout(300)
        with p4.expect_download() as descarga:
            p4.click("#x-glb")
        ruta = copia.parent / "obra.glb"
        descarga.value.save_as(ruta)
        glb = ruta.read_bytes()
        largo_json = int.from_bytes(glb[12:16], "little")
        gltf = json.loads(glb[20:20 + largo_json])
        nombres = {n.get("name") for n in gltf.get("nodes", [])}
        comprobar(any((n or "").startswith(f"pintura-{calcada}-") for n in nombres), "el .glb de la página lleva la pintura de las paredes")
        suelo_nodo = next(n for n in gltf["nodes"] if n.get("name") == f"suelo-{calcada}")
        mat = gltf["materials"][gltf["meshes"][suelo_nodo["mesh"]]["primitives"][0]["material"]]
        comprobar("baseColorTexture" in mat.get("pbrMetallicRoughness", {}), "y la textura del suelo aunque se exporte desde el plano")
        xs = [q[0] for s in pintada["plantas"][0]["estancias"] for q in s["contorno"]]
        ys = [q[1] for s in pintada["plantas"][0]["estancias"] for q in s["contorno"]]
        raiz_glb = next(n for n in gltf["nodes"] if n.get("name") == pintada["nombre"])
        tr = raiz_glb.get("translation", [0, 0, 0])
        comprobar(abs(tr[0] + (min(xs) + max(xs)) / 200) < 0.02 and abs(tr[2] + (min(ys) + max(ys)) / 200) < 0.02, f"y su origen es el centro de las estancias, no el del plano de fondo ({tr})")
        comprobar("obra" in nombres and any((n or "").startswith("obra-") for n in nombres), "el .glb de la página lleva la obra")
        comprobar(not any((n or "").startswith("techo-") for n in nombres), "y no lleva el techo inclinado (ayuda visual), sea cual sea la vista")
        p4.click('button[data-obra="viga"]')
        p4.wait_for_selector('#ficha-obra:not([hidden]) input[data-campo="deY"]')
        poner(p4, '#ficha-obra input[data-campo="deY"]', "100")
        p4.wait_for_function("id => window.__ESPACIOS3D__.espacio().plantas[0].estancias.find(s => s.id === id).elementos.some(e => e.forma === 'viga' && e.de[1] === 100)", arg=calcada, timeout=5000)
        comprobar(True, "la viga se coloca desde su ficha (desde y hasta)")

        print("R2-5: recorrer en primera persona")
        rect = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        casa = {"formato": "espacios3d", "version": 2, "nombre": "Recorrido", "plantas": [{"id": "pb", "grosorExterior": 10, "estancias": [
            {"id": "pasillo", "contorno": rect(0, 0, 800, 100)},
            {"id": "salon", "contorno": rect(0, 110, 300, 410), "huecos": [{"id": "p", "tipo": "puerta", "muro": 0, "desde": 100, "ancho": 80}]},
        ], "muebles": [{"id": "sofa", "tipo": "sofa", "ancho": 200, "fondo": 90, "alto": 85, "x": 150, "y": 360, "giro": 180}]}]}
        p4.evaluate("t => { window.__agente('recorrido.espacio.json', t); window.__disco.siguienteAbrir = 'recorrido.espacio.json'; }", json.dumps(casa))
        p4.click("#b-abrir")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().nombre === 'Recorrido'", timeout=5000)
        p4.click("#b-recorrer")
        r = p4.evaluate("window.__ESPACIOS3D__.recorrido()")
        comprobar(r["activo"] and p4.evaluate("window.__ESPACIOS3D__.vista()") == "3d", "Recorrer pasa a 3D en primera persona")
        def andar(x, y, grados, ms):
            p4.evaluate("([x, y, g]) => window.__ESPACIOS3D__.colocarRecorrido(x, y, g)", [x, y, grados])
            p4.keyboard.down("w")
            p4.wait_for_timeout(ms)
            p4.keyboard.up("w")
            p4.wait_for_timeout(100)
            return p4.evaluate("window.__ESPACIOS3D__.recorrido()")["pos"]
        q = andar(50, 50, 90, 1200)
        comprobar(q[1] < 100 and q[1] > 70, f"andando contra la pared del pasillo no se atraviesa ({[round(v) for v in q]})")
        q = andar(140, 50, 90, 1500)
        comprobar(q[1] > 130, f"por la puerta se pasa al salón ({[round(v) for v in q]})")
        q = andar(150, 200, 90, 2000)
        comprobar(q[1] < 315 - 20 + 2, f"el sofá corta el paso ({[round(v) for v in q]})")
        # Las flechas ↑ ↓ miran arriba y abajo; ya no andan, eso es W y S.
        p4.evaluate("window.__ESPACIOS3D__.colocarRecorrido(140, 40, 90)")
        def mantener(tecla, ms):
            p4.keyboard.down(tecla)
            p4.wait_for_timeout(ms)
            p4.keyboard.up(tecla)
            p4.wait_for_timeout(100)
            return p4.evaluate("window.__ESPACIOS3D__.recorrido()")
        cam0 = p4.evaluate("window.__ESPACIOS3D__.camara()")
        r = mantener("ArrowUp", 400)
        cam1 = p4.evaluate("window.__ESPACIOS3D__.camara()")
        comprobar(r["cabeceo"] > 15 and abs(r["pos"][0] - 140) < 0.5 and abs(r["pos"][1] - 40) < 0.5, f"↑ mira hacia arriba sin andar (cabeceo {round(r['cabeceo'])}°, en {[round(v) for v in r['pos']]})")
        comprobar(cam1 == cam0, "y la cámara se queda en los ojos (sólo gira)")
        r = mantener("ArrowDown", 1200)
        comprobar(r["cabeceo"] < -15, f"↓ mira hacia abajo ({round(r['cabeceo'])}°)")
        r = mantener("ArrowDown", 2500)
        comprobar(abs(r["cabeceo"] + 68.755) < 0.5, f"con un tope, como con el ratón ({round(r['cabeceo'])}°)")
        r = mantener("w", 400)
        comprobar(r["pos"][1] > 45, f"W sigue andando ({[round(v) for v in r['pos']]})")
        p4.evaluate("window.__ESPACIOS3D__.colocarRecorrido(140, 40, 90)")
        p4.wait_for_timeout(200)
        p4.screenshot(path=str(SALIDA / "16_recorrer.png"))
        # Revisión independiente (R1, R3): encuadrar no saca la cámara y el .glb no lleva los techos.
        p4.click("#b-encuadrar")
        p4.wait_for_timeout(100)
        cam = p4.evaluate("window.__ESPACIOS3D__.camara()")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.recorrido()")["activo"] and abs(cam[0] - 140) < 1 and abs(cam[2] - 40) < 1 and cam[1] <= 160.5,
                  f"encuadrar mientras se recorre deja la cámara en los ojos ({cam})")
        with p4.expect_download() as descarga:
            p4.click("#x-glb")
        ruta = copia.parent / "recorrido.glb"
        descarga.value.save_as(ruta)
        glb = ruta.read_bytes()
        largo_json = int.from_bytes(glb[12:16], "little")
        nombres = {n.get("name") or "" for n in json.loads(glb[20:20 + largo_json]).get("nodes", [])}
        comprobar(not any(n.startswith("techo-") for n in nombres), "el .glb exportado mientras se recorre no lleva los techos")
        # R5: Tab no se anula mientras se recorre (sigue moviendo el foco).
        comprobar(p4.evaluate("""() => { const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); window.dispatchEvent(ev); return !ev.defaultPrevented; }"""),
                  "Tab sigue siendo del navegador mientras se recorre")
        p4.keyboard.press("Escape")
        comprobar(not p4.evaluate("window.__ESPACIOS3D__.recorrido()")["activo"], "Esc sale del recorrido")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.camara()")[1] > 300, "y al salir la cámara vuelve a verlo desde fuera")
        # R4: entrar desde 3D y pulsar «Plano» lleva al plano.
        p4.click("#v-3d")
        p4.click("#b-recorrer")
        p4.click("#v-plano")
        comprobar(not p4.evaluate("window.__ESPACIOS3D__.recorrido()")["activo"] and p4.evaluate("window.__ESPACIOS3D__.vista()") == "plano",
                  "«Plano» durante el recorrido sale al plano aunque se entrara desde 3D")
        # R2: «Nuevo» sale del recorrido.
        p4.click("#b-recorrer")
        p4.click("#b-nuevo")
        aceptar_dialogo(p4)
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().nombre !== 'Recorrido'", timeout=5000)
        comprobar(not p4.evaluate("window.__ESPACIOS3D__.recorrido()")["activo"], "«Nuevo» sale del recorrido")

        print("R2-6: piezas, modelos .glb (uno que falta y uno comprimido) y Mis muebles")
        # Modelo de prueba: una caja roja de 1 x 0,5 x 0,6 m escrita con el escritor .glb del núcleo.
        guion = ("import('" + (RAIZ / "build" / "glb.mjs").as_uri() + "').then((G) => process.stdout.write(Buffer.from(G.escribirGLB({ nombreEscena: 'Caja', generador: 'e2e', "
                 "nodos: [{ nombre: 'caja', malla: { primitivas: [{ ...G.mallaCaja(1, 0.5, 0.6), material: 0 }] } }], "
                 "materiales: [{ nombre: 'rojo', color: [0.8, 0.1, 0.1, 1], metalico: 0, rugosidad: 0.5 }] })).toString('base64')))")
        caja_glb = base64.b64decode(subprocess.run(["node", "-e", guion], capture_output=True, text=True, check=True).stdout)
        (copia.parent / "caja.glb").write_bytes(caja_glb)
        # Un .glb que pide Draco (sólo la cabecera y el JSON bastan para que se rechace).
        jd = json.dumps({"asset": {"version": "2.0"}, "extensionsUsed": ["KHR_draco_mesh_compression"], "extensionsRequired": ["KHR_draco_mesh_compression"], "scenes": [{"nodes": []}], "scene": 0}).encode()
        jd += b" " * (-len(jd) % 4)
        draco = b"glTF" + (2).to_bytes(4, "little") + (20 + len(jd)).to_bytes(4, "little") + len(jd).to_bytes(4, "little") + b"JSON" + jd
        # Revisión independiente (M1): un .glb cuya textura apunta a una URL http no debe pedir nada a la red.
        je = json.dumps({"asset": {"version": "2.0"}, "images": [{"uri": "http://127.0.0.1:9/espia.png?quien=usuario"}], "textures": [{"source": 0}],
                         "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}], "scenes": [{"nodes": []}], "scene": 0}).encode()
        je += b" " * (-len(je) % 4)
        espia = b"glTF" + (2).to_bytes(4, "little") + (20 + len(je)).to_bytes(4, "little") + len(je).to_bytes(4, "little") + b"JSON" + je
        conmuebles = {"formato": "espacios3d", "version": 2, "nombre": "Muebles propios", "plantas": [{"id": "pb", "estancias": [{"id": "sala", "contorno": rect(0, 0, 500, 400)}], "muebles": [
            {"id": "lampara", "tipo": "lampara", "ancho": 40, "fondo": 40, "alto": 160, "x": 60, "y": 60, "color": "#666666", "piezas": [
                {"forma": "cilindro", "ancho": 30, "alto": 3}, {"forma": "cilindro", "z": 3, "ancho": 3, "alto": 117}, {"forma": "esfera", "z": 120, "ancho": 40, "color": "#fff3c4"}]},
            {"id": "cubo", "tipo": "caja", "ancho": 80, "fondo": 80, "alto": 80, "x": 250, "y": 200, "modelo": {"archivo": "modelos/caja.glb"}},
            {"id": "perdido", "tipo": "sofa", "ancho": 200, "fondo": 90, "alto": 85, "x": 250, "y": 340, "modelo": {"archivo": "modelos/falta.glb"}},
            {"id": "comprimido", "tipo": "mesa", "ancho": 100, "fondo": 60, "alto": 75, "x": 420, "y": 80, "modelo": {"archivo": "modelos/draco.glb"}},
            {"id": "espia", "tipo": "caja", "ancho": 40, "fondo": 40, "alto": 40, "x": 440, "y": 340, "modelo": {"archivo": "modelos/espia.glb"}},
        ]}]}
        p4.evaluate("""([t, caja, draco, espia]) => {
            const blob = (b) => new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], { type: 'model/gltf-binary' });
            window.__disco.carpetaNombre = 'casa';
            window.__disco.binarios['modelos/caja.glb'] = blob(caja);
            window.__disco.binarios['modelos/draco.glb'] = blob(draco);
            window.__disco.binarios['modelos/espia.glb'] = blob(espia);
            window.__agente('muebles.espacio.json', t);
        }""", [json.dumps(conmuebles), base64.b64encode(caja_glb).decode(), base64.b64encode(draco).decode(), base64.b64encode(espia).decode()])
        p4.click("#b-carpeta")
        p4.wait_for_selector("#dialogo[open]")
        p4.check('input[name="archivo-carpeta"][value="muebles.espacio.json"]')
        p4.click("#dialogo-aceptar")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().nombre === 'Muebles propios'", timeout=5000)
        p4.wait_for_function("window.__ESPACIOS3D__.formaMueble('cubo')?.conModelo === true", timeout=8000)
        forma = lambda i: p4.evaluate("i => window.__ESPACIOS3D__.formaMueble(i)", i)
        comprobar(True, "el modelo .glb de la carpeta se carga y se ve en lugar de la forma")
        comprobar(forma("lampara") == {"conModelo": False, "mallas": 3}, f"la lámpara se dibuja con sus 3 piezas ({forma('lampara')})")
        comprobar(not forma("perdido")["conModelo"] and forma("perdido")["mallas"] >= 1, f"un modelo que falta deja la forma genérica ({forma('perdido')})")
        comprobar(not forma("comprimido")["conModelo"] and forma("comprimido")["mallas"] >= 1, f"un modelo con Draco deja la forma genérica ({forma('comprimido')})")
        def elegir(i):
            p4.click(f'#lista-muebles [data-id="{i}"]')
            p4.wait_for_function("i => window.__ESPACIOS3D__.seleccion() === i", arg=i, timeout=3000)
            return p4.locator("#m-forma-texto").inner_text()
        t = elegir("perdido")
        comprobar("No se encuentra modelos/falta.glb" in t, f"la ficha dice que falta el modelo: «{t}»")
        t = elegir("comprimido")
        comprobar("Draco" in t and "forma genérica" in t, f"y que el comprimido no se puede usar: «{t}»")
        t = elegir("espia")
        comprobar(not forma("espia")["conModelo"] and "pide archivos de fuera" in t, f"un .glb que pide una imagen por http no se usa (y no se pide nada a la red): «{t}»")
        t = elegir("lampara")
        comprobar("3 piezas" in t, f"la ficha de la lámpara cuenta sus piezas: «{t}»")
        t = elegir("cubo")
        comprobar("Modelo modelos/caja.glb" in t and "100 × 60 × 50 cm" in t, f"la ficha del cubo da el tamaño real del modelo: «{t}»")
        p4.click("#m-modelo-medidas")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.find(m => m.id === 'cubo').ancho === 100", timeout=3000)
        c = mueble(p4, "cubo")
        comprobar([c["ancho"], c["fondo"], c["alto"], c["modelo"]["ajuste"]] == [100, 60, 50, "modelo"], f"«Medidas del modelo» le da su tamaño real ({c['ancho']}x{c['fondo']}x{c['alto']}, {c['modelo']['ajuste']})")
        p4.click("#v-3d")
        p4.wait_for_timeout(300)
        p4.screenshot(path=str(SALIDA / "17_muebles_propios.png"))
        # Poner un modelo desde la ficha: se copia a modelos/ (el mismo contenido se reutiliza).
        elegir("lampara")
        with p4.expect_file_chooser() as eleccion:
            p4.click("#m-modelo")
        eleccion.value.set_files(str(copia.parent / "caja.glb"))
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.find(m => m.id === 'lampara').modelo?.archivo === 'modelos/caja.glb'", timeout=5000)
        p4.wait_for_function("window.__ESPACIOS3D__.formaMueble('lampara')?.conModelo === true", timeout=5000)
        comprobar(True, "«Modelo 3D…» copia el .glb a modelos/ y el mueble lo usa")
        p4.click("#m-modelo-quitar")
        p4.wait_for_function("!window.__ESPACIOS3D__.espacio().plantas[0].muebles.find(m => m.id === 'lampara').modelo", timeout=3000)
        comprobar(forma("lampara") == {"conModelo": False, "mallas": 3}, "«Quitar modelo» vuelve a sus piezas")
        # R4-3: una foto para la lámpara: se copia a fotos/, se ve en miniatura, se amplía y se quita.
        foto = copia.parent / "lámpara de pie.png"
        foto.write_bytes(png_sintetico(320, 240))
        with p4.expect_file_chooser() as eleccion:
            p4.click("#b-foto-mueble")
        eleccion.value.set_files(str(foto))
        p4.wait_for_function("(window.__ESPACIOS3D__.espacio().plantas[0].muebles.find(m => m.id === 'lampara').fotos || []).length === 1", timeout=5000)
        ruta_foto = next(m for m in espacio(p4)["plantas"][0]["muebles"] if m["id"] == "lampara")["fotos"][0]
        p4.wait_for_function("window.__ESPACIOS3D__.fotos('mueble').some(f => f.imagen)", timeout=5000)
        comprobar(ruta_foto == "fotos/lampara-de-pie.png" and p4.evaluate("window.__disco.binarios['fotos/lampara-de-pie.png'] !== undefined"),
                  f"«Añadir foto…» la copia a fotos/ con un nombre limpio y la asocia ({ruta_foto})")
        p4.click('#fotos-mueble button.miniatura')
        p4.wait_for_selector("#dialogo-foto[open]")
        comprobar(p4.evaluate("document.getElementById('foto-grande').naturalWidth") == 320, "pulsar la miniatura amplía la foto")
        p4.screenshot(path=str(SALIDA / "33_foto_mueble.png"))
        p4.click("#b-foto-quitar")
        p4.wait_for_function("!window.__ESPACIOS3D__.espacio().plantas[0].muebles.find(m => m.id === 'lampara').fotos", timeout=3000)
        comprobar(not p4.is_visible("#dialogo-foto") and p4.evaluate("window.__ESPACIOS3D__.fotos('mueble').length") == 0, "«Quitar la foto» la quita del mueble (el archivo se queda)")
        # Una foto que no está en la carpeta se ve como «No está» (el agente parte de lo ya guardado).
        p4.wait_for_function("!window.__ESPACIOS3D__.pendiente()", timeout=5000)
        p4.evaluate("() => { const d = window.__disco; const e = JSON.parse(d.archivos['muebles.espacio.json'].texto); e.plantas[0].estancias[0].fotos = ['fotos/perdida.jpg']; window.__agente('muebles.espacio.json', JSON.stringify(e)); }")
        p4.wait_for_function("window.__ESPACIOS3D__.fotos('estancia').length === 1 && !window.__ESPACIOS3D__.fotos('estancia')[0].imagen", timeout=6000)
        comprobar("No está" in p4.inner_text("#fotos-estancia"), "una foto que no está junto al archivo se ve como «No está»")
        # El .glb de la página lleva las mallas del modelo.
        with p4.expect_download() as descarga:
            p4.click("#x-glb")
        ruta = copia.parent / "muebles.glb"
        descarga.value.save_as(ruta)
        glb = ruta.read_bytes()
        nodos = json.loads(glb[20:20 + int.from_bytes(glb[12:16], "little")]).get("nodes", [])
        cubo = next((n for n in nodos if n.get("name") == "cubo"), None)
        comprobar(cubo is not None and len(cubo.get("children", [])) >= 1, "el .glb de la página lleva el modelo del cubo")
        # Mis muebles: guardar el cubo, usarlo y quitarlo.
        elegir("cubo")
        p4.click("#m-guardar-mio")
        p4.wait_for_selector("#dialogo[open] #mio-nombre")
        p4.fill("#mio-nombre", "Cubo rojo")
        # Revisión independiente (M2): mientras el diálogo está abierto, otro (el CLI, un agente) escribe el archivo.
        externo = {"formato": "espacios3d-muebles", "version": 1, "muebles": [{"nombre": "Externo", "tipo": "caja", "ancho": 30, "fondo": 30, "alto": 30}]}
        p4.evaluate("t => { window.__disco.binarios['mis-muebles.json'] = new Blob([t], { type: 'application/json' }); }", json.dumps(externo))
        p4.click("#dialogo-aceptar")
        p4.wait_for_selector('#lista-mios button.mio[data-mio="Cubo rojo"]', timeout=5000)
        guardado = json.loads(p4.evaluate("window.__disco.binarios['mis-muebles.json'].text()"))
        comprobar(guardado["formato"] == "espacios3d-muebles" and [m["nombre"] for m in guardado["muebles"]] == ["Externo", "Cubo rojo"] and guardado["muebles"][1]["modelo"]["archivo"] == "modelos/caja.glb",
                  f"«Guardar en Mis muebles» escribe mis-muebles.json con su modelo, sin perder lo que otro escribió con el diálogo abierto ({[m['nombre'] for m in guardado['muebles']]})")
        antes = len(espacio(p4)["plantas"][0]["muebles"])
        p4.click('#lista-mios button.mio[data-mio="Cubo rojo"]')
        p4.wait_for_function("n => window.__ESPACIOS3D__.espacio().plantas[0].muebles.length === n", arg=antes + 1, timeout=3000)
        nuevo = espacio(p4)["plantas"][0]["muebles"][-1]
        comprobar(nuevo["nombre"] == "Cubo rojo" and nuevo["modelo"]["archivo"] == "modelos/caja.glb" and nuevo["ancho"] == 100, f"pulsar uno de Mis muebles lo añade con sus medidas y su modelo ({nuevo})")
        p4.click('#lista-mios li:has(button[data-mio="Cubo rojo"]) button.quitar')
        aceptar_dialogo(p4)
        p4.wait_for_function("!document.querySelector('#lista-mios button.mio[data-mio=\"Cubo rojo\"]')", timeout=3000)
        comprobar([m["nombre"] for m in json.loads(p4.evaluate("window.__disco.binarios['mis-muebles.json'].text()"))["muebles"]] == ["Externo"], "y quitarlo lo borra de mis-muebles.json")
        p4.click("#v-plano")
        # Revisión independiente (M3): un modelo que faltaba y aparece después (lo pone un agente) se carga.
        p4.evaluate("() => { window.__disco.binarios['modelos/falta.glb'] = window.__disco.binarios['modelos/caja.glb']; }")
        p4.wait_for_timeout(3200)
        elegir("perdido")
        p4.wait_for_function("window.__ESPACIOS3D__.formaMueble('perdido')?.conModelo === true", timeout=5000)
        comprobar(True, "un modelo que faltaba se carga en cuanto aparece en la carpeta")

        print("R2-6: selección múltiple y cinta métrica")
        pos = lambda i: [round(v, 1) for v in (mueble(p4, i)["x"], mueble(p4, i)["y"], mueble(p4, i)["giro"])]
        elegir("cubo")
        p4.click('#lista-muebles [data-id="perdido"]', modifiers=["Control"])
        comprobar(sorted(p4.evaluate("window.__ESPACIOS3D__.elegidos()")) == ["cubo", "perdido"] and p4.locator("#m-grupo").is_visible(),
                  "Ctrl+clic en la lista elige un segundo mueble y la ficha lo dice")
        comprobar(p4.locator('#lista-muebles button[aria-current="true"]').count() == 2, "los dos se ven elegidos en la lista")
        p4.locator("#lienzo canvas").focus()
        p4.keyboard.press("Shift+R")
        comprobar(pos("cubo") == [320, 270, 90] and pos("perdido") == [180, 270, 90], f"Mayús+R gira el conjunto 90° alrededor de su centro ({pos('cubo')}, {pos('perdido')})")
        a0, b0 = pos("cubo"), pos("perdido")
        ini = p4.evaluate("([x, y]) => window.__ESPACIOS3D__.aPantalla(x, y, 50)", a0[:2])
        fin = p4.evaluate("([x, y]) => window.__ESPACIOS3D__.aPantalla(x, y, 50)", [a0[0] + 40, a0[1]])
        p4.mouse.move(*ini)
        p4.mouse.down()
        p4.keyboard.down("Shift")
        for k in range(1, 6):
            p4.mouse.move(ini[0] + (fin[0] - ini[0]) * k / 5, ini[1] + (fin[1] - ini[1]) * k / 5)
        p4.mouse.up()
        p4.keyboard.up("Shift")
        a1, b1 = pos("cubo"), pos("perdido")
        dx, dy = a1[0] - a0[0], a1[1] - a0[1]
        comprobar(abs(dx - 40) <= 3 and abs(dy) <= 3 and [b1[0] - b0[0], b1[1] - b0[1]] == [dx, dy], f"arrastrar uno mueve los dos lo mismo ({dx}, {dy})")
        n = len(espacio(p4)["plantas"][0]["muebles"])
        p4.keyboard.press("Control+d")
        el = p4.evaluate("window.__ESPACIOS3D__.elegidos()")
        comprobar(len(espacio(p4)["plantas"][0]["muebles"]) == n + 2 and len(el) == 2 and "cubo" not in el, f"Ctrl+D duplica los dos y elige las copias ({el})")
        p4.keyboard.press("Delete")
        comprobar(len(espacio(p4)["plantas"][0]["muebles"]) == n, "Supr quita los dos")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.elegidos()") == [], "y no queda nada elegido")
        # Cinta: de esquina a esquina de la sala (500 cm), con el imán.
        p4.keyboard.press("m")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.cinta().activo"), "M empieza a medir")
        for x, y in ((3, 4), (497, 5)):
            p4.mouse.click(*p4.evaluate("([x, y]) => window.__ESPACIOS3D__.aPantalla(x, y)", [x, y]))
        c = p4.evaluate("window.__ESPACIOS3D__.cinta()")
        comprobar(c["distancia"] == 500 and c["a"] == [0, 0] and c["b"] == [500, 0], f"la cinta se pega a las esquinas y mide 500 cm ({c})")
        comprobar("500 cm" in p4.locator(".medida-cinta").inner_text(), "y la medida se ve rotulada")
        p4.screenshot(path=str(SALIDA / "18_cinta.png"))
        p4.keyboard.press("Escape")
        comprobar(not p4.evaluate("window.__ESPACIOS3D__.cinta().activo") and p4.locator(".medida-cinta").count() == 0, "Esc deja de medir y quita la medida")
        # Revisión independiente (S1): soltar el grupo con un clic sin Ctrl en uno de ellos deja de mostrarlo.
        elegir("cubo")
        p4.click('#lista-muebles [data-id="perdido"]', modifiers=["Control"])
        p4.click('#lista-muebles [data-id="cubo"]')
        comprobar(p4.evaluate("window.__ESPACIOS3D__.elegidos()") == ["cubo"] and not p4.locator("#m-grupo").is_visible()
                  and p4.locator('#lista-muebles button[aria-current="true"]').count() == 1, "un clic sin Ctrl suelta el grupo y deja de mostrarse")
        # S4: con el foco en un desplegable, las letras no son atajos.
        p4.focus("#m-tipo")
        p4.keyboard.press("m")
        comprobar(not p4.evaluate("window.__ESPACIOS3D__.cinta().activo"), "con el foco en «Tipo», M no empieza a medir")
        # S2: empezar a dibujar una estancia deja de medir, y medir cancela el dibujo (un modo a la vez).
        p4.locator("#lienzo canvas").focus()
        if p4.evaluate("window.__ESPACIOS3D__.cinta().activo"):
            p4.keyboard.press("Escape")
        p4.keyboard.press("m")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.cinta().activo"), "M empieza a medir (antes de dibujar)")
        p4.click("#b-dibujar")
        comprobar(not p4.evaluate("window.__ESPACIOS3D__.cinta().activo") and p4.get_attribute("#b-dibujar", "aria-pressed") == "true", "«Dibujar estancia» deja de medir")
        p4.locator("#lienzo canvas").focus()
        p4.keyboard.press("m")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.cinta().activo") and p4.get_attribute("#b-dibujar", "aria-pressed") == "false", "y empezar a medir cancela el dibujo")
        p4.keyboard.press("Escape")
        # S3: «Nuevo» deja de medir.
        p4.keyboard.press("m")
        p4.click("#b-nuevo")
        aceptar_dialogo(p4)
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().nombre !== 'Muebles propios'", timeout=5000)
        comprobar(not p4.evaluate("window.__ESPACIOS3D__.cinta().activo"), "«Nuevo» deja de medir")

        print("R2-7a: plantas y tabiques")
        rect = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        casa2 = {"formato": "espacios3d", "version": 2, "nombre": "Dos plantas", "plantas": [{"id": "pb", "nombre": "Planta baja", "grosorExterior": 15, "estancias": [
            {"id": "salon", "nombre": "Salón", "contorno": rect(0, 0, 400, 300), "altura": 260, "huecos": [
                {"id": "p-dorm", "tipo": "puerta", "muro": 1, "desde": 100, "ancho": 80}, {"id": "v-salon", "tipo": "ventana", "muro": 0, "desde": 100, "ancho": 120}]},
            {"id": "dorm", "nombre": "Dormitorio", "contorno": rect(410, 0, 710, 300), "altura": 260, "huecos": []},
        ], "muebles": [{"id": "sofa", "tipo": "sofa", "ancho": 200, "fondo": 90, "alto": 85, "x": 200, "y": 150}]}]}
        p4.evaluate("t => { window.__agente('dos.espacio.json', t); window.__disco.siguienteAbrir = 'dos.espacio.json'; }", json.dumps(casa2))
        p4.click("#b-abrir")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().nombre === 'Dos plantas'", timeout=5000)
        p4.click("#v-plano")
        p4.click("#b-planta-mas")
        texto = aceptar_dialogo(p4)
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas.length === 2", timeout=3000)
        e2 = espacio(p4)
        alta = e2["plantas"][1]
        comprobar(p4.evaluate("window.__ESPACIOS3D__.plantaActiva()") == alta["id"] and [s["contorno"] for s in alta["estancias"]] == [rect(0, 0, 400, 300), rect(410, 0, 710, 300)]
                  and [h["tipo"] for s in alta["estancias"] for h in s["huecos"]] == ["ventana"] and alta["nivel"] == 290,
                  f"«Añadir planta» copia la huella y las ventanas (no las puertas), a 290 cm, y pasa a ella ({alta['id']}, {alta['nivel']})")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.formaMueble('sofa')") is None, "en la planta nueva no se ve el sofá de abajo")
        p4.click('#catalogo button[data-tipo="cama"]')
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[1].muebles.length === 1", timeout=3000)
        comprobar(espacio(p4)["plantas"][0]["muebles"][0]["id"] == "sofa" and len(espacio(p4)["plantas"][0]["muebles"]) == 1, "un mueble nuevo va a la planta que se ve")
        p4.locator("#lienzo canvas").focus()
        p4.keyboard.press("Control+z")
        p4.keyboard.press("Control+z")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas.length === 1", timeout=3000)
        comprobar(p4.evaluate("window.__ESPACIOS3D__.plantaActiva()") == "pb", "deshacer quita la planta y se vuelve a la que queda")
        p4.keyboard.press("Control+y")
        p4.keyboard.press("Control+y")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas.length === 2 && window.__ESPACIOS3D__.espacio().plantas[1].muebles.length === 1", timeout=3000)
        p4.click('#lista-plantas button[data-planta="pb"]')
        comprobar(p4.evaluate("window.__ESPACIOS3D__.plantaActiva()") == "pb" and p4.evaluate("window.__ESPACIOS3D__.formaMueble('sofa')") is not None, "elegir «Planta baja» la muestra con su sofá")
        # Mover el tabique entre el salón y el dormitorio 50 cm hacia el dormitorio.
        p4.click('#lista-estancias button[data-estancia="salon"]')
        p4.click("#b-mover-pared")
        p4.wait_for_selector("#dialogo[open] #mp-pared")
        p4.select_option("#mp-pared", "1")
        p4.fill("#mp-distancia", "50")
        p4.click("#dialogo-aceptar")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].estancias[0].contorno[1][0] === 450", timeout=3000)
        e2 = espacio(p4)
        comprobar(e2["plantas"][0]["estancias"][0]["contorno"] == rect(0, 0, 450, 300) and e2["plantas"][0]["estancias"][1]["contorno"] == rect(460, 0, 710, 300),
                  "«Mover pared…» mueve el tabique entero: el salón crece y el dormitorio encoge, con el mismo grosor")
        p4.screenshot(path=str(SALIDA / "19_plantas.png"))
        # Revisión independiente del paso a (P2, P3, P5, P6, P4).
        p4.click(f'#lista-plantas button[data-planta="{alta["id"]}"]')
        with p4.expect_download() as descarga:
            p4.click("#x-svg")
        svg = Path(descarga.value.path()).read_text(encoding="utf-8")
        comprobar("Cama" in svg and "Sofá" not in svg, "«Plano SVG» exporta la planta que se ve (P2)")
        p4.click("#b-pegar")
        p4.wait_for_selector("#dialogo[open] textarea")
        p4.fill("#dialogo textarea", '[{"op": "agregar", "tipo": "mesa", "id": "mesa-pegada"}]')
        p4.click("#dialogo-aceptar")
        p4.wait_for_function("id => window.__ESPACIOS3D__.espacio().plantas.find(p => p.id === id).muebles.some(m => m.id === 'mesa-pegada')", arg=alta["id"], timeout=3000)
        comprobar(True, "«Pegar cambios» sin planta los aplica en la planta que se ve (P3)")
        p4.click('#lista-plantas button[data-planta="pb"]')
        p4.locator("#lienzo canvas").focus()
        p4.keyboard.press("Control+z")
        p4.wait_for_function("id => !window.__ESPACIOS3D__.espacio().plantas.find(p => p.id === id).muebles.some(m => m.id === 'mesa-pegada')", arg=alta["id"], timeout=3000)
        comprobar(p4.evaluate("window.__ESPACIOS3D__.plantaActiva()") == alta["id"] and "Deshecho un cambio en" in p4.locator("#aviso").inner_text(),
                  "deshacer un cambio de otra planta lleva a ella y lo dice (P5)")
        p4.click("#b-planta-editar")
        p4.wait_for_selector("#dialogo[open] #pl-nivel")
        p4.fill("#pl-nivel", "")
        p4.click("#dialogo-aceptar")
        p4.wait_for_timeout(200)
        comprobar(next(x for x in espacio(p4)["plantas"] if x["id"] == alta["id"])["nivel"] == 290, "dejar el nivel vacío no lo pone a 0 (P6)")
        # Quitar la planta de arriba; con el diálogo abierto, un agente añade un mueble abajo y no se pierde (P4).
        # El agente parte de lo guardado: se espera a que la página haya escrito sus cambios.
        p4.wait_for_function("!window.__ESPACIOS3D__.pendiente()", timeout=5000)
        p4.click("#b-planta-quitar")
        p4.wait_for_selector("#dialogo[open]")
        texto = p4.locator("#dialogo").inner_text()
        p4.evaluate("""() => { const d = window.__disco; const e = JSON.parse(d.archivos['dos.espacio.json'].texto);
            e.plantas[0].muebles.push({ id: 'del-agente', tipo: 'caja', ancho: 40, fondo: 40, alto: 40, x: 60, y: 60 });
            window.__agente('dos.espacio.json', JSON.stringify(e)); }""")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.some(m => m.id === 'del-agente')", timeout=8000)
        p4.click("#dialogo-aceptar")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas.length === 1", timeout=3000)
        comprobar("2 estancias" in texto and "1 mueble" in texto and p4.evaluate("window.__ESPACIOS3D__.plantaActiva()") == "pb", f"«Quitar planta» dice lo que se va y vuelve a la que queda («{texto.strip()[:90]}»)")
        comprobar(any(m["id"] == "del-agente" for m in espacio(p4)["plantas"][0]["muebles"]), "y no pierde lo que un agente cambió con el diálogo abierto (P4)")

        print("R2-7b: escaleras en la página")
        casa3 = {"formato": "espacios3d", "version": 2, "nombre": "Con escalera", "plantas": [{"id": "pb", "nombre": "Planta baja", "estancias": [
            {"id": "sala", "nombre": "Sala", "contorno": rect(0, 0, 600, 460), "altura": 260}], "muebles": []}]}
        p4.evaluate("t => { window.__agente('escalera.espacio.json', t); window.__disco.siguienteAbrir = 'escalera.espacio.json'; }", json.dumps(casa3))
        p4.click("#b-abrir")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().nombre === 'Con escalera'", timeout=5000)
        p4.click("#v-plano")
        p4.click('button[data-obra="escalera"]')
        # Ronda 6: un agente escribe con el diálogo abierto; al aceptar no se pisa su cambio.
        p4.wait_for_selector("#dialogo[open]")
        con_silla = json.loads(json.dumps(casa3))
        con_silla["plantas"][0]["muebles"] = [{"id": "silla-del-agente", "nombre": "Silla", "tipo": "silla", "ancho": 45, "fondo": 45, "alto": 90, "x": 80, "y": 80, "giro": 0}]
        agente(p4, con_silla, "escalera.espacio.json")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.some(m => m.id === 'silla-del-agente')", timeout=5000)
        texto = aceptar_dialogo(p4)
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas.length === 2 && (window.__ESPACIOS3D__.espacio().plantas[0].escaleras || []).length === 1", timeout=3000)
        e3 = espacio(p4)
        comprobar(any(m["id"] == "silla-del-agente" for m in e3["plantas"][0]["muebles"]), "«Escalera» no pisa lo que un agente escribió con su diálogo abierto")
        esc = e3["plantas"][0]["escaleras"][0]
        comprobar("No hay planta encima" in texto and esc["hasta"] == e3["plantas"][1]["id"] and esc["forma"] == "recta",
                  f"«Escalera» sin planta encima ofrece crearla y pone una escalera recta que sube a ella ({esc['largo']} cm, giro {esc['giro']})")
        p4.screenshot(path=str(SALIDA / "20_escalera_plano.png"))
        # Ficha: pasar a L y girar a la izquierda.
        p4.select_option('#campos-obra select[data-campo="forma"]', "L")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].escaleras[0].forma === 'L'", timeout=3000)
        p4.select_option('#campos-obra select[data-campo="gira"]', "izquierda")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].escaleras[0].gira === 'izquierda'", timeout=3000)
        esc = espacio(p4)["plantas"][0]["escaleras"][0]
        comprobar(esc["tramos"][0] + esc["tramos"][1] == esc_largo if (esc_largo := e3["plantas"][0]["escaleras"][0]["largo"]) else False, f"pasar a «En L» reparte el largo en dos tramos ({esc['tramos']})")
        p4.select_option('#campos-obra select[data-campo="forma"]', "recta")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].escaleras[0].forma === 'recta'", timeout=3000)
        p4.click("#v-3d")
        p4.wait_for_timeout(300)
        p4.screenshot(path=str(SALIDA / "21_escalera_3d.png"))
        # Recorrer: subir y bajar.
        esc = espacio(p4)["plantas"][0]["escaleras"][0]
        arriba_id = e3["plantas"][1]["id"]
        import math
        g = math.radians(esc["giro"])
        F = (-math.sin(g), math.cos(g))
        p4.click("#b-recorrer")
        p4.evaluate("([x, y, gr]) => window.__ESPACIOS3D__.colocarRecorrido(x, y, gr)", [esc["x"] - F[0] * 40, esc["y"] - F[1] * 40, math.degrees(math.atan2(F[1], F[0]))])
        p4.keyboard.down("w")
        p4.wait_for_function("window.__ESPACIOS3D__.recorrido().escalera !== null", timeout=4000)
        comprobar(arriba_id in p4.evaluate("window.__ESPACIOS3D__.recorrido().otras"), "al recorrer se dibuja también la planta de arriba")
        p4.wait_for_timeout(900)
        p4.screenshot(path=str(SALIDA / "22_escalera_subiendo.png"))
        p4.wait_for_function("id => window.__ESPACIOS3D__.recorrido().planta === id && window.__ESPACIOS3D__.recorrido().escalera === null", arg=arriba_id, timeout=8000)
        p4.keyboard.up("w")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.plantaActiva()") == arriba_id and p4.evaluate("window.__ESPACIOS3D__.recorrido().activo"),
                  "subiendo se llega a la planta de arriba sin salir del recorrido")
        # Media vuelta: se ve el hueco con su barandilla; y se baja andando hacia delante.
        r = p4.evaluate("window.__ESPACIOS3D__.recorrido()")
        p4.evaluate("([x, y, g]) => window.__ESPACIOS3D__.colocarRecorrido(x, y, g)", [r["pos"][0], r["pos"][1], r["rumbo"] + 180])
        p4.wait_for_timeout(200)
        p4.screenshot(path=str(SALIDA / "23_escalera_arriba.png"))
        p4.keyboard.down("w")
        p4.wait_for_function("window.__ESPACIOS3D__.recorrido().planta === 'pb' && window.__ESPACIOS3D__.recorrido().escalera === null", timeout=10000)
        p4.keyboard.up("w")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.plantaActiva()") == "pb", "y bajando se vuelve a la planta baja")
        p4.keyboard.press("Escape")
        comprobar(not p4.evaluate("window.__ESPACIOS3D__.recorrido().activo") and p4.evaluate("window.__ESPACIOS3D__.plantasDibujadas().otras") == [], "Esc sale y deja de dibujar la otra planta")
        p4.click("#v-plano")

        print("R3-2: caracol en la ficha, casa entera y caja de escalera")
        # Al cambiar de planta recorriendo se suelta lo elegido en «Obra»: se vuelve a elegir la escalera.
        p4.click('#lista-obra button[data-obra-id^="esc:"]')
        p4.select_option('#campos-obra select[data-campo="forma"]', "caracol")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].escaleras[0].forma === 'caracol'", timeout=3000)
        comprobar(p4.locator('#campos-obra input[data-campo="vuelta"]').input_value() == "360" and p4.locator('#campos-obra input[data-campo="poste"]').input_value() == "20",
                  "«De caracol» en la ficha, con Poste (20) y Vuelta (360)")
        poner(p4, '#campos-obra input[data-campo="vuelta"]', "300")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].escaleras[0].vuelta === 300", timeout=3000)
        comprobar("caracol" in p4.locator("#lista-obra").inner_text(), "la lista de la obra la nombra «de caracol» y la vuelta se cambia en la ficha")
        p4.screenshot(path=str(SALIDA / "24_caracol_plano.png"))
        p4.click("#v-3d")
        p4.wait_for_timeout(300)
        p4.screenshot(path=str(SALIDA / "25_caracol_3d.png"))
        p4.click("#v-plano")
        # Casa de tres plantas con una caja de escalera (dos U iguales, una sobre otra).
        def u(id_, hasta):
            return {"id": id_, "forma": "U", "x": 200, "y": 100, "ancho": 100, "giro": 0, "gira": "derecha", "tramos": [240, 240], "hasta": hasta}
        tres = {"formato": "espacios3d", "version": 2, "nombre": "Tres plantas", "plantas": [
            {"id": f"p{i}", "nombre": ["Baja", "Primera", "Segunda"][i], "nivel": 280 * i, "estancias": [{"id": f"s{i}", "nombre": "Planta", "contorno": rect(0, 0, 600, 700), "altura": 250}],
             "muebles": [{"id": f"mesa{i}", "tipo": "mesa", "ancho": 120, "fondo": 80, "alto": 75, "x": 450, "y": 300 + 100 * i}],
             **({"escaleras": [u(f"u{i}", f"p{i + 1}")]} if i < 2 else {})} for i in range(3)]}
        p4.evaluate("t => { window.__agente('tres.espacio.json', t); window.__disco.siguienteAbrir = 'tres.espacio.json'; }", json.dumps(tres))
        p4.click("#b-abrir")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().nombre === 'Tres plantas'", timeout=5000)
        comprobar(p4.evaluate("window.__ESPACIOS3D__.incidencias().filter(i => i.gravedad === 'error').length") == 0, "la caja de escalera no tiene errores en la página")
        comprobar(p4.is_visible("#b-casa"), "con varias plantas aparece «Casa entera»")
        p4.click("#b-casa")
        p4.wait_for_timeout(300)
        d = p4.evaluate("window.__ESPACIOS3D__.plantasDibujadas()")
        comprobar(p4.evaluate("window.__ESPACIOS3D__.vista()") == "3d" and p4.get_attribute("#b-casa", "aria-pressed") == "true" and sorted(d["otras"]) == ["p1", "p2"] and sorted(d["fantasma"]) == ["p1", "p2"],
                  f"«Casa entera» pasa a 3D y dibuja las otras dos plantas, encima en transparente ({d})")
        p4.click('#lista-plantas button[data-planta="p1"]')
        p4.wait_for_function("window.__ESPACIOS3D__.plantaActiva() === 'p1'", timeout=3000)
        p4.wait_for_timeout(200)
        d = p4.evaluate("window.__ESPACIOS3D__.plantasDibujadas()")
        comprobar(sorted(d["otras"]) == ["p0", "p2"] and d["fantasma"] == ["p2"], f"en la primera planta, sólo la de encima va en transparente ({d})")
        p4.click('#lista-muebles button[data-id="mesa1"]')
        antes_rec = p4.evaluate("window.__ESPACIOS3D__.plantasDibujadas().reconstruidas")
        x_mesa1 = lambda: next(m for pl in espacio(p4)["plantas"] for m in pl["muebles"] if m["id"] == "mesa1")["x"]
        antes = x_mesa1()
        p4.locator("canvas").first.focus()
        p4.keyboard.press("ArrowRight")
        p4.wait_for_timeout(200)
        comprobar(x_mesa1() > antes, "con la casa entera se sigue editando la planta activa (la flecha mueve su mesa)")
        rec = p4.evaluate("window.__ESPACIOS3D__.plantasDibujadas().reconstruidas") - antes_rec
        comprobar(rec <= 1, f"mover un mueble de la activa no rehace las otras plantas ({rec} reconstruida)")
        p4.keyboard.press("f")
        p4.wait_for_timeout(300)
        p4.screenshot(path=str(SALIDA / "26_casa_entera.png"))
        # Recorrer: de la planta baja a la segunda por la caja de escalera, sin salir del recorrido.
        p4.click('#lista-plantas button[data-planta="p0"]')
        p4.wait_for_function("window.__ESPACIOS3D__.plantaActiva() === 'p0'", timeout=3000)
        p4.click("#b-recorrer")
        d = p4.evaluate("window.__ESPACIOS3D__.recorrido().otras")
        comprobar(sorted(d) == ["p1", "p2"], f"al recorrer se dibujan todas las plantas ({d})")
        def tramo(x, y, grados, hasta_js):
            p4.evaluate("([x, y, g]) => window.__ESPACIOS3D__.colocarRecorrido(x, y, g)", [x, y, grados])
            p4.keyboard.down("w")
            p4.wait_for_function(hasta_js, timeout=8000)
            p4.keyboard.up("w")
            return p4.evaluate("window.__ESPACIOS3D__.recorrido()")
        for destino in ["p1", "p2"]:
            r = tramo(200, 60, 90, "window.__ESPACIOS3D__.recorrido().pos[1] > 375")
            r = tramo(r["pos"][0], r["pos"][1], 180, "window.__ESPACIOS3D__.recorrido().pos[0] < 105")
            r = tramo(r["pos"][0], r["pos"][1], 270, f"window.__ESPACIOS3D__.recorrido().planta === '{destino}' && window.__ESPACIOS3D__.recorrido().escalera === null")
            comprobar(p4.evaluate("window.__ESPACIOS3D__.plantaActiva()") == destino and r["activo"], f"subiendo por la caja de escalera se llega a «{destino}» sin salir del recorrido")
        # Mirando hacia el hueco: su barandilla y, abajo, la escalera de la planta de debajo.
        r = p4.evaluate("window.__ESPACIOS3D__.recorrido()")
        p4.evaluate("([x, y]) => window.__ESPACIOS3D__.colocarRecorrido(x, y, 60)", r["pos"])
        p4.wait_for_timeout(250)
        p4.screenshot(path=str(SALIDA / "27_caja_escalera_arriba.png"))
        p4.keyboard.press("Escape")
        p4.click("#b-casa")
        comprobar(p4.get_attribute("#b-casa", "aria-pressed") == "false" and p4.evaluate("window.__ESPACIOS3D__.plantasDibujadas().otras") == [], "quitar «Casa entera» deja sólo la planta activa")
        p4.click("#v-plano")

        print("R4-1: acceso (entrar por la puerta, círculo de giro)")
        cuarto = {"formato": "espacios3d", "version": 2, "nombre": "Acceso", "plantas": [{"id": "pb", "estancias": [
            {"id": "sala", "nombre": "Sala", "contorno": rect(0, 0, 400, 300), "altura": 250,
             "huecos": [{"id": "p", "tipo": "puerta", "muro": 0, "desde": 40, "ancho": 80, "alto": 210, "abre": "dentro"}]}],
            "muebles": [{"id": "sofa", "tipo": "sofa", "nombre": "Sofá", "x": 250, "y": 240, "ancho": 220, "fondo": 95, "alto": 85},
                        {"id": "armario", "tipo": "armario", "nombre": "Armario", "x": 360, "y": 110, "ancho": 100, "fondo": 60, "alto": 200, "giro": 270}]}]}
        p4.evaluate("t => { window.__agente('acceso.espacio.json', t); window.__disco.siguienteAbrir = 'acceso.espacio.json'; }", json.dumps(cuarto))
        p4.click("#b-abrir")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().nombre === 'Acceso'", timeout=5000)
        p4.click("#v-plano")
        avisos = p4.evaluate("window.__ESPACIOS3D__.incidencias().filter(i => i.regla === 'acceso').map(i => i.mensaje)")
        comprobar(len(avisos) == 1 and "no entra" in avisos[0] and "sofa" in avisos[0], f"el sofá no entra por la puerta de 80 (aviso): {avisos}")
        p4.click('#lista-muebles button[data-id="sofa"]')
        comprobar("No entra por la puerta" in p4.inner_text("#m-entra"), f"la ficha del sofá lo dice ({p4.inner_text('#m-entra')})")
        p4.click('#lista-muebles button[data-id="armario"]')
        comprobar("Entra por la puerta" in p4.inner_text("#m-entra"), "y la del armario dice que entra")
        p4.check("#e-giro")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].estancias[0].circuloDeGiro === true", timeout=3000)
        c = p4.evaluate("window.__ESPACIOS3D__.circulosGiro()")
        comprobar(c.get("sala") is not None, f"«Comprobar el círculo de giro» lo guarda y lo dibuja donde cabe ({c})")
        p4.screenshot(path=str(SALIDA / "31_circulo_giro.png"))
        p4.uncheck("#e-giro")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].estancias[0].circuloDeGiro === undefined", timeout=3000)

        print("R4-2: materiales (suelo y paredes)")
        p4.select_option("#e-suelo", "parquet")
        p4.wait_for_function("(window.__ESPACIOS3D__.espacio().plantas[0].estancias[0].suelo || {}).tipo === 'parquet'", timeout=3000)
        comprobar(p4.locator("#e-color-suelo").input_value() == "#b98a5a", "elegir «Parquet» pone el suelo de parquet con su color")
        p4.fill("#e-paredes", "#c9dbe8")
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].estancias[0].paredes === '#c9dbe8'", timeout=3000)
        comprobar(True, "el color de las paredes se guarda")
        p4.click("#v-3d")
        p4.wait_for_timeout(300)
        p4.screenshot(path=str(SALIDA / "32_materiales_3d.png"))
        p4.click("#v-plano")
        p4.click("#b-acabados-quitar")
        p4.wait_for_function("(e => !e.suelo && !e.paredes)(window.__ESPACIOS3D__.espacio().plantas[0].estancias[0])", timeout=3000)
        comprobar(p4.is_disabled("#b-acabados-quitar"), "«Sin acabados» los quita y queda deshabilitado")

        print("R4-4: imprimir o PDF y ayuda rápida")
        p4.evaluate("""() => { window.__impreso = { html: '', print: 0 };
            window.open = () => ({ document: { open() {}, write(h) { window.__impreso.html += h; }, close() {} }, focus() {}, print() { window.__impreso.print++; } }); }""")
        p4.click("#x-imprimir")
        imp = p4.evaluate("window.__impreso")
        comprobar(imp["print"] == 1 and imp["html"].count('<section class="hoja">') == 1 and "Escala 1:" in imp["html"] and 'mm" height="' in imp["html"],
                  "«Imprimir o PDF» abre el plano acotado a escala y llama a imprimir")
        p4.click("#b-ayuda")
        p4.wait_for_selector("#dialogo[open] .ayuda-rapida")
        pasos = p4.locator("#dialogo .ayuda-rapida li")
        anim = p4.evaluate("getComputedStyle(document.querySelector('#dialogo .ar-mueble')).animationName")
        comprobar(pasos.count() == 3 and anim == "ar-mueble", f"la ayuda rápida tiene tres pasos animados ({pasos.count()}, {anim})")
        p4.wait_for_timeout(1200)
        p4.screenshot(path=str(SALIDA / "34_ayuda_rapida.png"))
        p4.emulate_media(reduced_motion="reduce")
        anim = p4.evaluate("getComputedStyle(document.querySelector('#dialogo .ar-mueble')).animationName")
        comprobar(anim == "none", f"con «reducir movimiento» los dibujos se quedan quietos ({anim})")
        p4.emulate_media(reduced_motion="no-preference")
        p4.keyboard.press("Escape")

        print("Cosas en la pared")
        p4.click("#v-plano")
        p4.click('#catalogo button[data-tipo="cuadro"]')
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.some(m => m.tipo === 'cuadro')", timeout=3000)
        cuadro = next(m for m in espacio(p4)["plantas"][0]["muebles"] if m["tipo"] == "cuadro")
        avisos = p4.evaluate("window.__ESPACIOS3D__.incidencias().filter(i => i.regla === 'pared').length")
        comprobar(cuadro["elevacion"] == 140 and (cuadro["y"] <= 2 or cuadro["x"] <= 2 or cuadro["x"] >= 398 or cuadro["y"] >= 298) and avisos == 0,
                  f"«Cuadro» se cuelga solo en una pared a 140 cm ({cuadro['x']}, {cuadro['y']}, giro {cuadro['giro']})")
        for t in ["television", "balda", "aplique", "espejo"]:
            p4.click(f'#catalogo button[data-tipo="{t}"]')
        p4.wait_for_function("window.__ESPACIOS3D__.espacio().plantas[0].muebles.filter(m => ['television','balda','aplique','espejo'].includes(m.tipo)).length === 4", timeout=3000)
        errores_pared = p4.evaluate("window.__ESPACIOS3D__.incidencias().filter(i => i.regla === 'pared' || (i.gravedad === 'error' && i.regla === 'solape')).map(i => i.mensaje)")
        comprobar(errores_pared == [], f"televisor, balda, aplique y espejo también quedan colgados, cada uno en su sitio ({errores_pared})")
        p4.click("#v-3d")
        p4.wait_for_timeout(300)
        p4.screenshot(path=str(SALIDA / "35_cosas_en_la_pared.png"))
        p4.click("#v-plano")

        print("R2-7e: la persona retoca el piso que hizo un agente")
        piso_agente = RAIZ / "tests" / "aceptacion" / "resultados" / "A" / "resultado.espacio.json"
        origen = piso_agente if piso_agente.exists() else RAIZ / "tests" / "aceptacion" / "ref-a.espacio.json"
        texto_piso = origen.read_text(encoding="utf-8")
        # Un tabique compartido que se pueda mover 10 cm (lo elige el núcleo).
        guion = ("import('" + (RAIZ / "build" / "core.mjs").as_uri() + "').then((N) => { const e = N.validarOLanzar(JSON.parse(process.argv[1])); "
                 "for (const s of e.plantas[0].estancias) for (let i = 0; i < s.contorno.length; i++) { try { const r = N.moverTabique(e, s.id, i, 10); "
                 "if (r.vecinas.length) { console.log(JSON.stringify({ estancia: s.id, muro: i, antes: s.contorno, despues: N.estancia(r.espacio, s.id).estancia.contorno })); return; } } catch {} } })")
        elegido = json.loads(subprocess.run(["node", "-e", guion, texto_piso], capture_output=True, text=True, check=True).stdout)
        p4.evaluate("t => { window.__agente('del-agente.espacio.json', t); window.__disco.siguienteAbrir = 'del-agente.espacio.json'; }", texto_piso)
        p4.click("#b-abrir")
        p4.wait_for_function("t => window.__ESPACIOS3D__.espacio().nombre === t", arg=json.loads(texto_piso).get("nombre", "Espacio sin nombre"), timeout=5000)
        p4.click("#v-plano")
        p4.click(f'#lista-estancias button[data-estancia="{elegido["estancia"]}"]')
        p4.click("#b-mover-pared")
        p4.wait_for_selector("#dialogo[open] #mp-pared")
        p4.select_option("#mp-pared", str(elegido["muro"]))
        p4.fill("#mp-distancia", "10")
        p4.click("#dialogo-aceptar")
        p4.wait_for_function("([id, c]) => JSON.stringify(JSON.parse(window.__disco.archivos['del-agente.espacio.json'].texto).plantas[0].estancias.find(s => s.id === id).contorno) === JSON.stringify(c)",
                             arg=[elegido["estancia"], elegido["despues"]], timeout=8000)
        guardado = json.loads(p4.evaluate("window.__disco.archivos['del-agente.espacio.json'].texto"))
        est_g = next(s for s in guardado["plantas"][0]["estancias"] if s["id"] == elegido["estancia"])
        comprobar(est_g["contorno"] == elegido["despues"] and est_g["contorno"] != elegido["antes"],
                  f"en el piso que hizo un agente ({origen.parent.name}), mover un tabique compartido y se guarda en el archivo ({elegido['estancia']}, pared {elegido['muro'] + 1})")

        print("Móvil (375 px)")
        movil = contexto(viewport={"width": 375, "height": 780}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pm = nueva_pagina(movil, errores)
        ancho_doc = pm.evaluate("document.documentElement.scrollWidth")
        comprobar(ancho_doc <= 375, f"sin desbordamiento horizontal ({ancho_doc} px)")
        pm.screenshot(path=str(SALIDA / "05_movil.png"))
        pm.click("#b-panel-izq")
        comprobar(pm.locator("#panel-izq").is_visible(), "el panel de estancia se abre en móvil")
        pm.screenshot(path=str(SALIDA / "06_movil_panel.png"))
        pm.click('#catalogo button[data-tipo="cama"]')
        comprobar(not pm.locator("#panel-izq").is_visible(), "al añadir se cierra el panel")
        comprobar(len(pm.evaluate("window.__ESPACIOS3D__.espacio()")["plantas"][0]["muebles"]) >= 1, "se añade la cama en móvil")

        print("R3-3: móvil (mando táctil y Medir con el dedo)")
        tel = contexto(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pt = nueva_pagina(tel, errores)
        cdp = tel.new_cdp_session(pt)

        def toques(tipo, puntos):
            cdp.send("Input.dispatchTouchEvent", {"type": tipo, "touchPoints": [{"x": x, "y": y, "id": i} for i, x, y in puntos]})

        def centro(sel):
            b = pt.locator(sel).bounding_box()
            return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2

        cajas = [pt.locator(s).bounding_box() for s in ("#b-recorrer", "#b-medir")]
        comprobar(all(b and b["height"] >= 44 and b["width"] >= 44 for b in cajas), f"Recorrer y Medir se ven en el móvil y se tocan bien ({[round(b['width']) for b in cajas]} px de ancho)")
        comprobar(pt.evaluate("document.documentElement.scrollWidth") <= 390, "sin desbordamiento horizontal (390 px)")
        comprobar(pt.evaluate("matchMedia('(pointer: coarse)').matches"), "la emulación da un puntero grueso (táctil)")
        pt.tap("#b-recorrer")
        pt.wait_for_function("window.__ESPACIOS3D__.recorrido().activo", timeout=3000)
        comprobar(pt.is_visible("#mando") and pt.is_visible("#b-recorrer") and pt.inner_text("#b-recorrer") == "Salir", "Recorrer en el móvil: aparece el mando y «Salir» queda a la vista")
        pt.evaluate("() => window.__ESPACIOS3D__.colocarRecorrido(100, 150, 0)")
        mx, my = centro("#mando")
        # Andar: empujar el palo hacia arriba (adelante) durante un segundo.
        toques("touchStart", [(0, mx, my)])
        toques("touchMove", [(0, mx, my - 30)])
        pt.wait_for_timeout(900)
        toques("touchEnd", [])
        r = pt.evaluate("window.__ESPACIOS3D__.recorrido()")
        comprobar(r["pos"][0] > 150 and abs(r["pos"][1] - 150) < 2, f"empujar el mando hacia arriba anda hacia delante ({[round(v) for v in r['pos']]})")
        # A fondo se corre y la pared de enfrente para (la estancia mide 350).
        toques("touchStart", [(0, mx, my)])
        toques("touchMove", [(0, mx + 80, my)])
        pt.wait_for_timeout(1200)
        toques("touchEnd", [])
        r2 = pt.evaluate("window.__ESPACIOS3D__.recorrido()")
        comprobar(r2["pos"][1] > r["pos"][1] + 60 and r2["pos"][1] <= 300 - 19, f"a un lado, a fondo, se corre de lado hasta la pared sin atravesarla ({[round(v) for v in r2['pos']]})")
        # Mirar arrastrando en la vista; y los dos dedos a la vez.
        vx, vy = centro("canvas")
        rumbo = r2["rumbo"]
        toques("touchStart", [(1, vx + 60, vy)])
        for k in range(1, 6):
            toques("touchMove", [(1, vx + 60 - 12 * k, vy)])
        toques("touchEnd", [])
        r3 = pt.evaluate("window.__ESPACIOS3D__.recorrido()")
        comprobar(r3["rumbo"] < rumbo - 10, f"arrastrar el dedo en la vista gira la mirada ({round(rumbo)}° → {round(r3['rumbo'])}°)")
        pt.evaluate("() => window.__ESPACIOS3D__.colocarRecorrido(100, 150, 0)")
        toques("touchStart", [(0, mx, my), (1, vx + 60, vy)])
        for k in range(1, 8):
            toques("touchMove", [(0, mx, my - 30), (1, vx + 60 + 8 * k, vy)])
            pt.wait_for_timeout(80)
        toques("touchEnd", [])
        r4 = pt.evaluate("window.__ESPACIOS3D__.recorrido()")
        comprobar(abs(r4["rumbo"]) > 10 and math.hypot(r4["pos"][0] - 100, r4["pos"][1] - 150) > 30, f"con dos dedos se anda y se mira a la vez (rumbo {round(r4['rumbo'])}°, {[round(v) for v in r4['pos']]})")
        pt.screenshot(path=str(SALIDA / "28_movil_recorrer.png"))
        pt.tap("#b-recorrer")
        pt.wait_for_function("!window.__ESPACIOS3D__.recorrido().activo", timeout=3000)
        comprobar(not pt.is_visible("#mando"), "«Salir» termina el recorrido y quita el mando")
        # Medir con el dedo: dos toques cerca de dos esquinas (el imán las coge) y un arrastre no cuenta.
        pt.tap("#v-plano")
        pt.wait_for_timeout(200)
        pt.tap("#b-medir")
        comprobar(pt.evaluate("window.__ESPACIOS3D__.cinta().activo"), "Medir se activa con el dedo")
        # Un pellizco con dos dedos (acercar un poco) no pone un punto, aunque un dedo no se mueva.
        cx, cy = centro("canvas")
        toques("touchStart", [(5, cx, cy)])
        toques("touchStart", [(5, cx, cy), (6, cx + 60, cy)])
        toques("touchMove", [(5, cx, cy), (6, cx + 66, cy)])
        toques("touchEnd", [])
        comprobar(pt.evaluate("window.__ESPACIOS3D__.cinta().a") is None, "un pellizco con dos dedos mientras se mide no pone un punto")
        a = pantalla(pt, 0, 0)
        b = pantalla(pt, 350, 0)
        pt.touchscreen.tap(a[0] + 9, a[1] + 9)
        cx, cy = centro("canvas")
        toques("touchStart", [(2, cx, cy)])
        for k in range(1, 6):
            toques("touchMove", [(2, cx + 12 * k, cy + 6 * k)])
        toques("touchEnd", [])
        comprobar(pt.evaluate("window.__ESPACIOS3D__.cinta().b") is None, "arrastrar mientras se mide mueve la vista y no pone un punto")
        b = pantalla(pt, 350, 0)
        pt.touchscreen.tap(b[0] - 9, b[1] + 9)
        c = pt.evaluate("window.__ESPACIOS3D__.cinta()")
        comprobar(c["distancia"] is not None and abs(c["distancia"] - 350) <= 1, f"dos toques junto a dos esquinas miden la pared con el imán ({c['distancia']} cm)")
        pt.screenshot(path=str(SALIDA / "29_movil_medir.png"))
        pt.tap("#b-medir")
        comprobar(not pt.evaluate("window.__ESPACIOS3D__.cinta().activo"), "tocar «Medir» otra vez deja de medir")
        pt.set_viewport_size({"width": 360, "height": 740})
        pt.wait_for_timeout(200)
        comprobar(pt.evaluate("document.documentElement.scrollWidth") <= 360, "sin desbordamiento horizontal (360 px)")
        pt.screenshot(path=str(SALIDA / "30_movil_360.png"))
        tel.close()

        print("R5: abrir con la casa dentro, reconciliación con el disco y casa de referencia")
        r5 = Path(tempfile.mkdtemp(prefix="espacios3d-r5-"))
        casa_dir = r5 / "casa"
        shutil.copytree(RAIZ / "tests" / "referencia_v2" / "casa", casa_dir)
        casa_json = casa_dir / "casa.espacio.json"
        texto_casa = casa_json.read_text(encoding="utf-8")
        cli_ruta = RAIZ / "dist" / "Espacios3D" / "espacios3d.mjs"

        def cli_r5(*args: str, env: dict | None = None) -> dict:
            r = subprocess.run(["node", str(cli_ruta), *args, "--json"], capture_output=True, text=True, encoding="utf-8",
                               env={**os.environ, "ESPACIOS3D_NO_LANZAR": "1", **(env or {})}, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if r.returncode not in (0, 1):
                raise RuntimeError(f"{args}: {r.stdout}{r.stderr}")
            return json.loads(r.stdout)

        pag = r5 / "abierta.html"
        cli_r5("abrir", str(casa_json), "--salida", str(pag))
        viejo = {"formato": "espacios3d", "version": 2, "nombre": "Viejo", "plantas": [{"id": "pb", "estancias": [{"id": "s", "contorno": [[0, 0], [200, 0], [200, 200], [0, 200]]}]}]}
        borrador_viejo = (
            "try { if (!sessionStorage.getItem('r5')) { sessionStorage.setItem('r5', '1');"
            " localStorage.setItem('espacios3d:borrador:@ultimo', 'Viejo');"
            f" localStorage.setItem('espacios3d:borrador:Viejo', {json.dumps(json.dumps(viejo))}); }} }} catch (e) {{}}"
        )
        contextos_r5 = []

        def abierta(url: str = pag.as_uri()) -> Page:
            c = contexto(viewport={"width": 1280, "height": 860}, device_scale_factor=1)
            c.add_init_script(borrador_viejo)
            contextos_r5.append(c)
            p = c.new_page()
            p.on("console", lambda m: errores.append(m.text) if m.type == "error" else None)
            p.on("pageerror", lambda e: errores.append(str(e)))
            p.on("dialog", lambda d: d.accept())
            p.goto(url)
            p.wait_for_function("window.__ESPACIOS3D__ !== undefined")
            p.wait_for_timeout(200)
            return p

        def en_disco(p: Page, carpeta: str | None, archivos: dict[str, str]) -> None:
            p.evaluate("([c, a]) => { window.__disco.carpetaNombre = c; for (const [n, t] of Object.entries(a)) window.__agente(n, t); }", [carpeta, archivos])

        def retocar(p: Page, nombre: str) -> None:
            p.fill("#nombre-espacio", nombre)
            p.press("#nombre-espacio", "Enter")
            p.wait_for_function("n => window.__ESPACIOS3D__.espacio().nombre === n", arg=nombre, timeout=5000)

        def nombre_en(p: Page, archivo_: str) -> str | None:
            a = archivo(p, archivo_)
            return a["nombre"] if a else None

        borrador = "() => [localStorage.getItem('espacios3d:borrador:@ultimo'), localStorage.getItem('espacios3d:borrador:Viejo')]"
        texto_otro = texto_casa.replace('"Casa de referencia"', '"Cambiada por el agente"')
        assert texto_otro != texto_casa

        # 1. Carga: la casa gana al borrador viejo; aviso fijo; fondo, foto y modelo desde la página.
        p = abierta()
        e = espacio(p)
        comprobar(e["nombre"] == "Casa de referencia" and len(e["plantas"]) == 2, f"la página abre con la casa dentro, no con el borrador viejo ({e['nombre']})")
        comprobar(p.is_visible("#abierto") and "casa.espacio.json" in p.inner_text("#abierto-texto"), "aviso fijo con el archivo y «Abrir su carpeta»")
        comprobar(not p.is_visible("#b-continuar"), "sin «Continuar con …» mientras es una copia")
        p.wait_for_function("window.__ESPACIOS3D__.fondos().length === 1 && window.__ESPACIOS3D__.fondos()[0].estado === 'imagen'", timeout=8000)
        comprobar(True, "el plano de fondo se ve, sacado de la página")
        p.wait_for_function("(window.__ESPACIOS3D__.formaMueble('sillon') || {}).conModelo === true", timeout=8000)
        comprobar(True, "el modelo .glb del sillón también")
        p.click("#v-3d")
        p.wait_for_timeout(400)
        p.screenshot(path=str(SALIDA / "40_abierta_por_agente.png"))
        p.click("#v-plano")
        antes = p.evaluate(borrador)
        retocar(p, "Casa retocada")
        p.wait_for_timeout(300)
        comprobar(p.evaluate(borrador) == antes and antes[0] == "Viejo", f"no escribe ni borra el borrador de otra sesión ({p.evaluate(borrador)[0]})")
        comprobar(p.evaluate("window.__disco.escrituras") == 0, "y no escribe nada en el disco antes de abrir la carpeta")
        # 2. Igual y con cambios: vincula y guarda sin preguntar.
        en_disco(p, "casa", {"casa.espacio.json": texto_casa})
        p.click("#b-abierto-carpeta")
        p.wait_for_function("() => { const a = window.__disco.archivos['casa.espacio.json']; return a && JSON.parse(a.texto).nombre === 'Casa retocada'; }", timeout=5000)
        comprobar(not p.is_visible("#abierto") and p.evaluate("window.__disco.aceptados") == 1, "igual en el disco y con cambios: se une al archivo y guarda los cambios sin preguntar")
        retocar(p, "Casa retocada 2")
        p.wait_for_function("() => JSON.parse(window.__disco.archivos['casa.espacio.json'].texto).nombre === 'Casa retocada 2'", timeout=5000)
        comprobar(True, "desde ahí se guarda solo")
        comprobar(p.evaluate(borrador) == antes, "y sigue sin tocar el borrador de otra sesión")

        # 3. Igual y sin cambios: vincula sin escribir.
        p = abierta()
        en_disco(p, "casa", {"casa.espacio.json": texto_casa})
        p.click("#b-abierto-carpeta")
        p.wait_for_function("!document.querySelector('#abierto') || document.querySelector('#abierto').hidden", timeout=5000)
        comprobar(p.evaluate("window.__disco.escrituras") == 0 and p.evaluate("window.__disco.aceptados") == 1, "igual y sin cambios: se une sin escribir")

        # 4. Distinto y sin cambios: gana el disco.
        p = abierta()
        en_disco(p, "casa", {"casa.espacio.json": texto_otro})
        p.click("#b-abierto-carpeta")
        p.wait_for_function("window.__ESPACIOS3D__.espacio().nombre === 'Cambiada por el agente'", timeout=5000)
        comprobar(nombre_en(p, "casa.espacio.json") == "Cambiada por el agente" and not p.is_visible("#abierto"), "distinto y sin cambios aquí: se ve la versión del disco, unida")

        # 5. Distinto y con cambios: conflicto con tres salidas.
        for eleccion, comprobacion in (
            ("otro", lambda q: nombre_en(q, "casa-mio.espacio.json") == "Casa mía" and nombre_en(q, "casa.espacio.json") == "Cambiada por el agente"),
            ("encima", lambda q: nombre_en(q, "casa.espacio.json") == "Casa mía"),
            ("disco", lambda q: q.evaluate("window.__ESPACIOS3D__.espacio().nombre") == "Cambiada por el agente" and nombre_en(q, "casa.espacio.json") == "Cambiada por el agente"),
        ):
            p = abierta()
            retocar(p, "Casa mía")
            en_disco(p, "casa", {"casa.espacio.json": texto_otro})
            p.click("#b-abierto-carpeta")
            p.wait_for_selector("#dialogo[open]")
            comprobar(p.locator('input[name="conflicto-abierto"]').count() == 3 and p.is_checked('input[name="conflicto-abierto"][value="otro"]'), f"conflicto ({eleccion}): tres salidas, «otro archivo» por defecto")
            p.check(f'input[name="conflicto-abierto"][value="{eleccion}"]')
            p.click("#dialogo-aceptar")
            try:
                p.wait_for_function("!window.__ESPACIOS3D__.pendiente()", timeout=5000)
                p.wait_for_timeout(300)
            except Exception:
                pass
            comprobar(comprobacion(p), f"conflicto: «{eleccion}» hace lo que dice")

        # 6. Disco con errores, carpeta cancelada y archivo que no está (homónimo en otra carpeta).
        p = abierta()
        retocar(p, "Casa mía")
        en_disco(p, "casa", {"casa.espacio.json": '{"formato": "espacios3d", "version": 2}'})
        p.click("#b-abierto-carpeta")
        texto_d = aceptar_dialogo(p)
        comprobar("errores" in texto_d and p.is_visible("#abierto") and p.evaluate("window.__disco.aceptados") == 0, "un archivo con errores no se une y la copia sigue")
        en_disco(p, None, {})
        p.click("#b-abierto-carpeta")
        p.wait_for_timeout(300)
        comprobar(p.is_visible("#abierto") and p.evaluate("window.__ESPACIOS3D__.pendiente()"), "sin elegir carpeta, sigue la copia con sus cambios")
        en_disco(p, "otra", {"casa.espacio.json": texto_casa})
        p.click("#b-abierto-carpeta")
        texto_d = aceptar_dialogo(p)
        comprobar("No está en esa carpeta" in texto_d or "no está en" in texto_d, "un homónimo en otra carpeta no se toma por el archivo")
        comprobar(p.evaluate("window.__disco.escrituras") == 0, "y no se ha escrito nada")

        # 7. «Guardar» (Ctrl+S) y «Carpeta…» con ese archivo pasan por la reconciliación.
        p = abierta()
        retocar(p, "Por Ctrl+S")
        en_disco(p, "casa", {"casa.espacio.json": texto_casa})
        p.evaluate("document.activeElement && document.activeElement.blur()")
        p.keyboard.press("Control+s")
        p.wait_for_function("() => { const a = window.__disco.archivos['casa.espacio.json']; return a && JSON.parse(a.texto).nombre === 'Por Ctrl+S'; }", timeout=5000)
        comprobar(True, "Ctrl+S con la copia: se une al archivo y guarda (no «Guardar como»)")
        p = abierta()
        retocar(p, "Por Carpeta")
        en_disco(p, "casa", {"casa.espacio.json": texto_casa, "otra.espacio.json": json.dumps(viejo)})
        p.click("#b-carpeta")
        p.wait_for_selector("#dialogo[open]")
        p.check('input[name="archivo-carpeta"][value="casa.espacio.json"]')
        p.click("#dialogo-aceptar")
        p.wait_for_function("() => JSON.parse(window.__disco.archivos['casa.espacio.json'].texto).nombre === 'Por Carpeta'", timeout=5000)
        comprobar(not p.is_visible("#abierto"), "«Carpeta…» eligiendo ese archivo: se une y guarda los cambios")
        # Arreglo de un hueco previo: «Carpeta…» con otro archivo ya no descarta cambios sin preguntar.
        p2 = abierta()
        retocar(p2, "Cambio que no se pierde")
        en_disco(p2, "casa", {"casa.espacio.json": texto_casa, "otra.espacio.json": json.dumps(viejo)})
        p2.click("#b-carpeta")
        p2.wait_for_selector("#dialogo[open]")
        p2.check('input[name="archivo-carpeta"][value="otra.espacio.json"]')
        p2.click("#dialogo-aceptar")
        p2.wait_for_selector("#dialogo[open]")
        comprobar("Descartar" in p2.inner_text("#dialogo"), "«Carpeta…» con otro archivo y cambios sin guardar: pregunta antes de descartarlos")
        p2.click("#dialogo-cancelar")
        p2.wait_for_timeout(200)
        comprobar(p2.evaluate("window.__ESPACIOS3D__.espacio().nombre") == "Cambio que no se pierde", "y al cancelar sigue todo como estaba")

        # 8. Nombres peligrosos y tope de tamaño.
        raro = r5 / "raro.espacio.json"
        nombre_raro = "Casa </script><!-- $& ñ"
        cli_r5("nuevo", str(raro), "--ancho", "300", "--largo", "300", "--nombre", nombre_raro)
        pag_raro = r5 / "raro.html"
        cli_r5("abrir", str(raro), "--salida", str(pag_raro))
        p = abierta(pag_raro.as_uri())
        comprobar(espacio(p)["nombre"] == nombre_raro and nombre_raro in p.title(), f"un nombre con </script>, <!-- y $& no rompe la página ({p.title()})")
        pag_tope = r5 / "tope.html"
        cli_r5("abrir", str(casa_json), "--salida", str(pag_tope), env={"ESPACIOS3D_TOPE_INCRUSTADO": "3000"})
        p = abierta(pag_tope.as_uri())
        comprobar(p.locator("#abierto-omitidos li").count() >= 1 and "No se ve" in p.inner_text("#abierto-omitidos"), "lo que no cabe en la página se dice en el aviso")

        # 9. Casa de referencia por «Carpeta…»: se ve todo; un cambio y su inverso dejan el archivo igual.
        p = abierta(HTML.as_uri())
        p.evaluate(
            "([t, b]) => { window.__disco.carpetaNombre = 'casa'; window.__agente('casa.espacio.json', t);"
            " for (const [r, d] of Object.entries(b)) window.__disco.binarios[r] = new Blob([Uint8Array.from(atob(d), (c) => c.charCodeAt(0))]); }",
            [texto_casa, {r: base64.b64encode((casa_dir / r).read_bytes()).decode() for r in ("planos/plano.png", "fotos/salon.png", "modelos/sillon.glb")}],
        )
        p.click("#b-carpeta")
        p.wait_for_selector("#dialogo[open]")
        p.check('input[name="archivo-carpeta"][value="casa.espacio.json"]')
        p.click("#dialogo-aceptar")
        # Esta página recuperó el borrador de otra sesión (pendiente): «Carpeta…» pregunta antes de descartarlo.
        texto_d = aceptar_dialogo(p)
        comprobar("Descartar" in texto_d, "con un borrador recuperado, «Carpeta…» pregunta antes de descartarlo")
        p.wait_for_function("window.__ESPACIOS3D__.espacio().nombre === 'Casa de referencia'", timeout=5000)
        p.wait_for_function("window.__ESPACIOS3D__.fondos().length === 1 && window.__ESPACIOS3D__.fondos()[0].estado === 'imagen'", timeout=8000)
        p.wait_for_function("(window.__ESPACIOS3D__.formaMueble('sillon') || {}).conModelo === true", timeout=8000)
        comprobar(True, "la casa de referencia se abre con su plano de fondo y su modelo")
        retocar(p, "Un momento")
        p.wait_for_function("() => JSON.parse(window.__disco.archivos['casa.espacio.json'].texto).nombre === 'Un momento'", timeout=5000)
        retocar(p, "Casa de referencia")
        p.wait_for_function("() => JSON.parse(window.__disco.archivos['casa.espacio.json'].texto).nombre === 'Casa de referencia'", timeout=5000)
        comprobar(p.evaluate("window.__disco.archivos['casa.espacio.json'].texto") == texto_casa, "un cambio y su inverso guardados dejan el archivo igual byte a byte")
        retocar(p, "Casa guardada por la página")
        p.wait_for_function("() => JSON.parse(window.__disco.archivos['casa.espacio.json'].texto).nombre === 'Casa guardada por la página'", timeout=5000)
        guardada = r5 / "guardada.espacio.json"
        guardada.write_text(p.evaluate("window.__disco.archivos['casa.espacio.json'].texto"), encoding="utf-8")
        v = cli_r5("validar", str(guardada))
        rs = cli_r5("resumen", str(guardada))
        comprobar(v.get("ok") is True and len(rs["plantas"]) == 2, "lo que guarda la página lo lee y valida el CLI")
        # Revisión independiente del código (12/11/2026).
        # 2. «Otro archivo» junto al original, en su subcarpeta (carpeta elegida: la de la entrega).
        entrega_dir = r5 / "Espacios3D" / "espacios"
        entrega_dir.mkdir(parents=True)
        casa_sub = entrega_dir / "casa.espacio.json"
        casa_sub.write_text(texto_casa, encoding="utf-8")
        pag_sub = r5 / "sub.html"
        cli_r5("abrir", str(casa_sub), "--salida", str(pag_sub))
        p = abierta(pag_sub.as_uri())
        retocar(p, "Casa mía")
        en_disco(p, "Espacios3D", {"espacios/casa.espacio.json": texto_otro, "espacios/casa-mio.espacio.json": "{}", "otra.espacio.json": json.dumps(viejo)})
        p.click("#b-abierto-carpeta")
        p.wait_for_selector("#dialogo[open]")
        comprobar("espacios/casa-mio-2.espacio.json" in p.inner_text("#dialogo"), f"conflicto con el archivo en espacios/: «otro archivo» va a su subcarpeta y no pisa casa-mio ({p.inner_text('#dialogo')[:160]})")
        p.click("#dialogo-aceptar")
        p.wait_for_function("() => !!window.__disco.archivos['espacios/casa-mio-2.espacio.json']", timeout=5000)
        comprobar(nombre_en(p, "espacios/casa-mio-2.espacio.json") == "Casa mía" and nombre_en(p, "espacios/casa.espacio.json") == "Cambiada por el agente", "y queda junto al original, que no se toca")

        # 1. El archivo cambia mientras la persona lee el diálogo de conflicto: se vuelve a reconciliar.
        p = abierta()
        retocar(p, "Casa mía")
        en_disco(p, "casa", {"casa.espacio.json": texto_otro})
        p.click("#b-abierto-carpeta")
        p.wait_for_selector("#dialogo[open]")
        texto_ultimo = texto_casa.replace('"Casa de referencia"', '"Lo último del agente"')
        en_disco(p, "casa", {"casa.espacio.json": texto_ultimo})
        p.check('input[name="conflicto-abierto"][value="disco"]')
        p.click("#dialogo-aceptar")
        p.wait_for_timeout(400)
        if p.locator("#dialogo[open]").count():
            p.check('input[name="conflicto-abierto"][value="disco"]')
            p.click("#dialogo-aceptar")
        p.wait_for_function("window.__ESPACIOS3D__.espacio().nombre === 'Lo último del agente'", timeout=5000)
        retocar(p, "Después")
        p.wait_for_function("() => JSON.parse(window.__disco.archivos['casa.espacio.json'].texto).nombre === 'Después'", timeout=5000)
        comprobar(True, "si el agente escribe mientras se decide, se muestra y se guarda sobre su última versión, no sobre la del diálogo")

        # 3. Una v1 abierta por un agente pide confirmación antes de guardarse convertida.
        v1 = r5 / "viejo.espacio.json"
        shutil.copy(RAIZ / "tests" / "referencia_v1" / "rectangular" / "espacio.v1.json", v1)
        texto_v1 = v1.read_text(encoding="utf-8")
        pag_v1 = r5 / "v1.html"
        cli_r5("abrir", str(v1), "--salida", str(pag_v1))
        p = abierta(pag_v1.as_uri())
        comprobar("versión 1" in p.inner_text("#abierto-texto"), "el aviso de una copia v1 dice que se convertirá al guardar")
        retocar(p, "Convertida")
        en_disco(p, r5.name, {"viejo.espacio.json": texto_v1})
        p.click("#b-abierto-carpeta")
        p.wait_for_selector("#dialogo[open]")
        comprobar("versión 1" in p.inner_text("#dialogo"), "unirla con cambios pide confirmar la conversión")
        p.click("#dialogo-cancelar")
        p.wait_for_timeout(200)
        comprobar(p.evaluate("window.__disco.archivos['viejo.espacio.json'].texto") == texto_v1 and p.is_visible("#abierto"), "al cancelar, el v1 sigue intacto y la copia también")

        # 4. Carpeta recordada: sin selector sólo si su archivo es idéntico; si no, se elige.
        p = abierta()
        p.evaluate("t => { window.__disco.recordada = { nombre: 'casa', archivos: { 'casa.espacio.json': { texto: t } } }; }", texto_casa)
        p.click("#b-abierto-carpeta")
        p.wait_for_function("!document.querySelector('#abierto') || document.querySelector('#abierto').hidden", timeout=5000)
        comprobar(p.evaluate("window.__disco.selectores") == 0, "la carpeta recordada con el mismo archivo se usa sin selector")
        p = abierta()
        p.evaluate("t => { window.__disco.recordada = { nombre: 'casa', archivos: { 'casa.espacio.json': { texto: t } } }; }", texto_otro)
        en_disco(p, "casa", {"casa.espacio.json": texto_casa})
        p.click("#b-abierto-carpeta")
        p.wait_for_function("!document.querySelector('#abierto') || document.querySelector('#abierto').hidden", timeout=5000)
        comprobar(p.evaluate("window.__disco.selectores") == 1 and espacio(p)["nombre"] == "Casa de referencia", "con otra copia distinta en la recordada (misma cola de ruta), se abre el selector y no se usa la equivocada")

        # 13. La foto se sirve desde la página, y los fondos siguen tras unirse a la carpeta.
        p = abierta()
        p.wait_for_function("window.__ESPACIOS3D__.fotos('estancia').length === 1 && window.__ESPACIOS3D__.fotos('estancia')[0].imagen", timeout=8000)
        comprobar(True, "la foto de la estancia se ve desde la página")
        p.evaluate(
            "([t, b]) => { window.__disco.carpetaNombre = 'casa'; window.__agente('casa.espacio.json', t);"
            " for (const [r, d] of Object.entries(b)) window.__disco.binarios[r] = new Blob([Uint8Array.from(atob(d), (c) => c.charCodeAt(0))]); }",
            [texto_casa, {r: base64.b64encode((casa_dir / r).read_bytes()).decode() for r in ("planos/plano.png", "fotos/salon.png", "modelos/sillon.glb")}],
        )
        p.click("#b-abierto-carpeta")
        p.wait_for_function("!document.querySelector('#abierto') || document.querySelector('#abierto').hidden", timeout=5000)
        # Sin tocar nada más: al unirse se vuelve a pedir el fondo con la clave nueva (archivo vinculado).
        try:
            p.wait_for_function("window.__ESPACIOS3D__.fondos().length === 1 && window.__ESPACIOS3D__.fondos()[0].estado === 'imagen'", timeout=8000)
            unido = True
        except Exception:
            unido = False
        comprobar(unido, "tras unirse a la carpeta, el plano de fondo se lee de la carpeta sin esperar a otro cambio")

        for c in contextos_r5:
            c.close()
        shutil.rmtree(r5, ignore_errors=True)

        ronda6_pagina(contexto, errores)
        ronda6_aceptacion()

        print("Red y consola")
        comprobar(not peticiones, f"cero peticiones de red: {peticiones[:5]}")
        comprobar(not errores, f"cero errores de consola: {errores[:5]}")
        navegador.close()

    print(f"\n{'FALLAN ' + str(len(fallos)) if fallos else 'TODO BIEN'}; capturas en {SALIDA}")
    return 1 if fallos else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
