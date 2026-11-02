# Generates the PNG app icons (a Scrabble-style tile) with Pillow.
from PIL import Image, ImageDraw, ImageFont
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
FONT = next((f for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
                         '/System/Library/Fonts/Supplemental/Arial Bold.ttf'] if os.path.exists(f)), None)

def icon(size, path):
    s = size
    img = Image.new('RGB', (s, s), '#14532d')
    d = ImageDraw.Draw(img)
    pad, r = int(s * .17), int(s * .09)
    d.rounded_rectangle([pad, pad + int(s*.02), s - pad, s - pad + int(s*.02)], r, fill='#a88a48')
    d.rounded_rectangle([pad, pad, s - pad, s - pad], r, fill='#f3e2b8')
    f = ImageFont.truetype(FONT, int(s * .44)) if FONT else ImageFont.load_default()
    d.text((s/2, s/2 + s*.01), 'W', font=f, fill='#2b2112', anchor='mm')
    f2 = ImageFont.truetype(FONT, int(s * .12)) if FONT else ImageFont.load_default()
    d.text((s - pad - s*.06, s - pad - s*.05), '4', font=f2, fill='#2b2112', anchor='rs')
    img.save(path)

icon(192, os.path.join(OUT, 'icon-192.png'))
icon(512, os.path.join(OUT, 'icon-512.png'))
icon(180, os.path.join(OUT, 'apple-touch-icon.png'))
