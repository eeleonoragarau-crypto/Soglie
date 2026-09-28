# python3 tools/sheet.py out.png in1.png in2.png ... (2 columns, scaled to 640 wide)
import sys
from PIL import Image
out, files = sys.argv[1], sys.argv[2:]
ims = [Image.open(f).convert('RGB') for f in files]
w = 640
ims = [im.resize((w, int(im.height * w / im.width))) for im in ims]
cols = 2
rows = (len(ims) + 1) // 2
h = ims[0].height
sheet = Image.new('RGB', (w * cols, h * rows), (0, 0, 0))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out)
