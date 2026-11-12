# Aceptación final (R2-7e): versión «sucia» del plano C, girada 2,5° y en JPEG de calidad media.
# Uso: python -I sucio.py (tras generar.mjs). Necesita Pillow.
from pathlib import Path
from PIL import Image, ImageFilter

aqui = Path(__file__).parent
im = Image.open(aqui / 'plano-c.png').convert('RGB')
im = im.rotate(2.5, resample=Image.BICUBIC, expand=True, fillcolor=(255, 255, 255)).filter(ImageFilter.GaussianBlur(0.6))
im.save(aqui / 'plano-c.jpg', quality=60)
(aqui / 'plano-c.png').unlink()
print('plano-c.jpg', im.size)
