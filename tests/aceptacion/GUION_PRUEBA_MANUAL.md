# Guion de prueba manual: Antigravity con interfaz construye una casa en Espacios 3D

Lo que no puede probar ningún agente por su cuenta (ronda 5). Unos 20 minutos.

1. Copia la carpeta `dist\Espacios3D` del proyecto (o la del ZIP de entrega) a un sitio nuevo, por ejemplo `Documentos\Prueba Espacios3D`.
2. Copia dentro de `espacios\` el plano de una casa (una imagen por planta). Si quieres uno ya preparado: `tests\aceptacion\plano-n-pb.png` y `plano-n-p1.png` (casa N de la aceptación).
3. Abre esa carpeta en Antigravity (el editor) y pídele, con tus palabras, algo como: «Construye la casa de estos planos en Espacios 3D y ábremela».
4. Cuando pida permiso para ejecutar `node espacios3d.mjs …`, apruébalo.
5. Anota:
   - si terminó solo, sin que tuvieras que explicarle cómo usar la herramienta;
   - si se abrió el navegador con la casa cargada (aviso abajo: «Abierta por un agente…»);
   - si están todas las estancias, incluidos los pasillos o distribuidores sin nombre, y si los armarios no salen como habitaciones;
   - si en «Casa entera» las plantas están una encima de otra y por la escalera se sube en «Recorrer».
6. En la página, cambia algo, pulsa **Abrir su carpeta**, elige la carpeta `espacios`, y comprueba que el cambio queda guardado en el archivo (cierra y vuelve a abrir con «Continuar con …»).
7. Anota el resultado en `PROTOCOLO.md`; si algo falla, se arregla con su prueba.
