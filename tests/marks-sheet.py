# Phase 4: contact sheet of REAL rendered frames (software GL, headless Chromium), marks ON vs OFF, under SIMULATED colour-vision deficiency
# (Machado et al. 2009, severity 1.0). Input: tests/evidence-phase4/marks-{on,off}-WxH.png + marks-metrics.json (bbox). Output: marks-sheet-WxH.png
# A model of colour vision, not people. Needs Pillow; marks.mjs skips this step if it is missing.
import json, sys, os
from PIL import Image, ImageDraw
import numpy as np
out = sys.argv[1]
M = {'normal vision': np.eye(3),
     'protanopia (simulated)': np.array([[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]]),
     'deuteranopia (simulated)': np.array([[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]])}
def sim(img, m):
    a = np.asarray(img.convert('RGB'), dtype=float) / 255
    l = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    o = np.clip(l @ m.T, 0, 1)
    g = np.where(o <= 0.0031308, 12.92 * o, 1.055 * np.power(o, 1 / 2.4) - 0.055)
    return Image.fromarray((np.clip(g, 0, 1) * 255 + 0.5).astype(np.uint8))
metrics = json.load(open(os.path.join(out, 'marks-metrics.json')))
for view in ['390x844', '844x390']:
    on_p, off_p = os.path.join(out, f'marks-on-{view}.png'), os.path.join(out, f'marks-off-{view}.png')
    if not (os.path.exists(on_p) and os.path.exists(off_p) and view in metrics['views']): continue
    x0, y0, x1, y1 = [int(round(v)) for v in metrics['views'][view]['bbox']]
    on, off = Image.open(on_p).convert('RGB').crop((x0, y0, x1, y1)), Image.open(off_p).convert('RGB').crop((x0, y0, x1, y1))
    z = 2 if view == '390x844' else 2
    cols = list(M.items()); tw, th = on.width * z, on.height * z
    pad, lab = 6, 16
    sheet = Image.new('RGB', (len(cols) * (tw + pad) + pad, 2 * (th + lab + pad) + pad), (20, 18, 30)); d = ImageDraw.Draw(sheet)
    for ci, (name, m) in enumerate(cols):
        for ri, (tag, im) in enumerate((('marks ON', on), ('marks OFF', off))):
            t = sim(im, m).resize((tw, th), Image.NEAREST)
            X, Y = pad + ci * (tw + pad), pad + ri * (th + lab + pad)
            d.text((X, Y), f'{name} - {tag}', fill=(235, 225, 200)); sheet.paste(t, (X, Y + lab))
    sheet.save(os.path.join(out, f'marks-sheet-{view}.png')); print('wrote', f'marks-sheet-{view}.png', sheet.size)
