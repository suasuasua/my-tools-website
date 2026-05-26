// ——— DOM refs ———
const canvasArea = document.getElementById('canvasArea');
const uploadPlaceholder = document.getElementById('uploadPlaceholder');
const fileInput = document.getElementById('fileInput');
const mainCanvas = document.getElementById('mainCanvas');
const ctx = mainCanvas.getContext('2d');
const previewCanvas = document.getElementById('previewCanvas');
const pctx = previewCanvas.getContext('2d');
const sizeSelect = document.getElementById('sizeSelect');
const lockRatio = document.getElementById('lockRatio');
const customColor = document.getElementById('customColor');
const brushSize = document.getElementById('brushSize');
const brushSizeVal = document.getElementById('brushSizeVal');
const btnBrush = document.getElementById('btnBrush');
const btnAutoRemove = document.getElementById('btnAutoRemove');
const btnResetBg = document.getElementById('btnResetBg');
const btnDownload = document.getElementById('btnDownload');
const brushHint = document.getElementById('brushHint');

// ——— State ———
let image = null;
let imgX = 0, imgY = 0, imgW = 0, imgH = 0;
let cropBox = null;
let maskData = null;
let bgColor = '#ffffff';
let brushActive = false;   // brush mode ON (toggle)
let painting = false;       // actively painting (mouse down)
let outputW = 295, outputH = 413;

// Unified interaction state
let pointer = { mode: 'none', sx: 0, sy: 0, startBox: null, corner: '' };
let lastBrushPos = null;

// ——— Upload ———
uploadPlaceholder.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadImage(e.target.files[0]);
});

canvasArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadPlaceholder.classList.add('drag-over');
});
canvasArea.addEventListener('dragleave', () => {
  uploadPlaceholder.classList.remove('drag-over');
});
canvasArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadPlaceholder.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImage(file);
});

function loadImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      image = img;
      maskData = null;
      brushActive = false;
      painting = false;
      btnBrush.classList.remove('active');
      initCanvas();
      updatePreview();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function initCanvas() {
  const areaW = canvasArea.clientWidth;
  const areaH = canvasArea.clientHeight;
  mainCanvas.width = areaW;
  mainCanvas.height = areaH;
  mainCanvas.style.display = 'block';
  uploadPlaceholder.style.display = 'none';

  const pad = 40;
  const maxW = areaW - pad * 2;
  const maxH = areaH - pad * 2;
  const scale = Math.min(maxW / image.width, maxH / image.height);
  imgW = image.width * scale;
  imgH = image.height * scale;
  imgX = (areaW - imgW) / 2;
  imgY = (areaH - imgH) / 2;

  cropBox = {
    x: imgX + imgW * 0.125,
    y: imgY + imgH * 0.125,
    w: imgW * 0.75,
    h: imgH * 0.75,
  };
  clampCropBox();
  drawScene();
}

// ——— Drawing ———
function drawScene() {
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);

  // Dim area outside crop box
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
  ctx.clearRect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);

  // Draw image inside crop box
  ctx.save();
  ctx.beginPath();
  ctx.rect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
  ctx.clip();
  ctx.drawImage(image, imgX, imgY, imgW, imgH);
  ctx.restore();

  // Crop border
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
  ctx.setLineDash([]);

  // Rule-of-thirds
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    const lx = cropBox.x + (cropBox.w / 3) * i;
    ctx.beginPath(); ctx.moveTo(lx, cropBox.y); ctx.lineTo(lx, cropBox.y + cropBox.h); ctx.stroke();
    const ly = cropBox.y + (cropBox.h / 3) * i;
    ctx.beginPath(); ctx.moveTo(cropBox.x, ly); ctx.lineTo(cropBox.x + cropBox.w, ly); ctx.stroke();
  }

  // Corner handles
  for (const [cx, cy] of [
    [cropBox.x, cropBox.y],
    [cropBox.x + cropBox.w, cropBox.y],
    [cropBox.x, cropBox.y + cropBox.h],
    [cropBox.x + cropBox.w, cropBox.y + cropBox.h],
  ]) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

// ——— Unified pointer handling ———
function getPos(e) {
  const rect = mainCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function whichCorner(mx, my) {
  const r = 18;
  const corners = [
    { x: cropBox.x, y: cropBox.y, name: 'nw' },
    { x: cropBox.x + cropBox.w, y: cropBox.y, name: 'ne' },
    { x: cropBox.x, y: cropBox.y + cropBox.h, name: 'sw' },
    { x: cropBox.x + cropBox.w, y: cropBox.y + cropBox.h, name: 'se' },
  ];
  for (const c of corners) {
    if (Math.hypot(mx - c.x, my - c.y) <= r) return c.name;
  }
  return null;
}

function insideBox(mx, my) {
  return mx > cropBox.x && mx < cropBox.x + cropBox.w && my > cropBox.y && my < cropBox.y + cropBox.h;
}

canvasArea.addEventListener('pointerdown', (e) => {
  if (!cropBox) return;
  const { x, y } = getPos(e);

  // Brush mode: paint directly (takes priority inside crop box)
  if (brushActive && insideBox(x, y)) {
    if (!maskData) ensureMask();
    painting = true;
    pointer.mode = 'brush';
    mainCanvas.setPointerCapture(e.pointerId);
    paintAt(x, y);
    return;
  }

  // Crop interaction
  const corner = whichCorner(x, y);
  if (corner) {
    pointer = { mode: 'resize', sx: x, sy: y, startBox: { ...cropBox }, corner };
    mainCanvas.setPointerCapture(e.pointerId);
  } else if (insideBox(x, y)) {
    pointer = { mode: 'move', sx: x, sy: y, startBox: { ...cropBox }, corner: '' };
    mainCanvas.setPointerCapture(e.pointerId);
  } else {
    pointer.mode = 'none';
  }
});

canvasArea.addEventListener('pointermove', (e) => {
  if (!cropBox) return;
  const { x, y } = getPos(e);

  if (painting) {
    // Interpolate brush strokes for smooth lines
    if (lastBrushPos) {
      const dx = x - lastBrushPos.x;
      const dy = y - lastBrushPos.y;
      const dist = Math.hypot(dx, dy);
      const steps = Math.ceil(dist / 2);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        paintAt(lastBrushPos.x + dx * t, lastBrushPos.y + dy * t);
      }
    } else {
      paintAt(x, y);
    }
    lastBrushPos = { x, y };
    return;
  }

  if (pointer.mode === 'none') {
    // Update cursor
    const corner = whichCorner(x, y);
    if (corner) {
      mainCanvas.style.cursor = corner + '-resize';
    } else if (insideBox(x, y)) {
      mainCanvas.style.cursor = brushActive ? 'crosshair' : 'move';
    } else {
      mainCanvas.style.cursor = brushActive ? 'crosshair' : 'default';
    }
    return;
  }

  // Drag crop box
  const dx = x - pointer.sx;
  const dy = y - pointer.sy;
  const sb = pointer.startBox;

  if (pointer.mode === 'move') {
    cropBox.x = sb.x + dx;
    cropBox.y = sb.y + dy;
    clampCropBox();
  } else if (pointer.mode === 'resize') {
    applyResize(pointer.corner, sb, dx, dy);
  }

  // Mask is tied to old crop box position
  if (maskData) { maskData = null; brushActive = false; btnBrush.classList.remove('active'); }
  drawScene();
  updatePreview();
});

canvasArea.addEventListener('pointerup', () => {
  if (pointer.mode === 'brush' && painting) {
    painting = false;
    lastBrushPos = null;
    brushHint.textContent = '点击「自动去背景」或「手动擦除」继续处理背景';
    updatePreview();
  }
  pointer.mode = 'none';
});

canvasArea.addEventListener('pointerleave', () => {
  if (painting) {
    painting = false;
    lastBrushPos = null;
    updatePreview();
  }
  pointer.mode = 'none';
});

// ——— Resize ———
function applyResize(corner, sb, dx, dy) {
  const keepRatio = lockRatio.checked;
  const aspect = keepRatio ? outputW / outputH : null;

  let { x, y, w, h } = sb;

  switch (corner) {
    case 'se':
      w += dx;
      h = keepRatio ? w / aspect : h + dy;
      break;
    case 'sw':
      x += dx;
      w -= dx;
      h = keepRatio ? w / aspect : h + dy;
      break;
    case 'ne':
      y += dy;
      w += dx;
      h = keepRatio ? w / aspect : h - dy;
      break;
    case 'nw':
      x += dx;
      y += dy;
      w -= dx;
      h = keepRatio ? w / aspect : h - dy;
      break;
  }

  if (w < 50) {
    if (corner.includes('w')) { x = cropBox.x; w = 50; } else { w = 50; }
  }
  if (h < 50) {
    if (corner.includes('n')) { y = cropBox.y; h = 50; } else { h = 50; }
  }

  cropBox.x = x; cropBox.y = y; cropBox.w = w; cropBox.h = h;
  clampCropBox();
}

function clampCropBox() {
  cropBox.x = Math.max(imgX, Math.min(cropBox.x, imgX + imgW - cropBox.w));
  cropBox.y = Math.max(imgY, Math.min(cropBox.y, imgY + imgH - cropBox.h));
  if (cropBox.w > imgW) cropBox.w = imgW;
  if (cropBox.h > imgH) cropBox.h = imgH;
}

// ——— Brush painting ———
function paintAt(mx, my) {
  if (!insideBox(mx, my)) return;
  const bx = mx - cropBox.x;
  const by = my - cropBox.y;
  const r = parseInt(brushSize.value) / 2;

  // Visual feedback
  ctx.fillStyle = 'rgba(255, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.arc(mx, my, r, 0, Math.PI * 2);
  ctx.fill();

  // Update mask
  const data = maskData.data;
  const mw = maskData.width;
  const mh = maskData.height;
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = Math.floor(bx + dx);
      const py = Math.floor(by + dy);
      if (px < 0 || px >= mw || py < 0 || py >= mh) continue;
      data[(py * mw + px) * 4 + 3] = 0;
    }
  }
}

// ——— Background removal ———
function ensureMask() {
  if (!maskData) {
    const w = Math.round(cropBox.w);
    const h = Math.round(cropBox.h);
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(image,
      (cropBox.x - imgX) / imgW * image.width,
      (cropBox.y - imgY) / imgH * image.height,
      cropBox.w / imgW * image.width,
      cropBox.h / imgH * image.height,
      0, 0, w, h);
    maskData = tctx.getImageData(0, 0, w, h);
  }
}

btnAutoRemove.addEventListener('click', () => {
  if (!cropBox) return;
  ensureMask();
  brushActive = false;
  btnBrush.classList.remove('active');

  const w = maskData.width, h = maskData.height;
  const d = maskData.data;

  // Sample 8 regions (4 corners + 4 edge midpoints) for robust bg detection
  const margin = Math.min(Math.floor(Math.min(w, h) * 0.06), 18);
  const regions = [
    [margin, margin], [w - margin, margin],
    [margin, h - margin], [w - margin, h - margin],
    [Math.floor(w / 2), margin], [Math.floor(w / 2), h - margin],
    [margin, Math.floor(h / 2)], [w - margin, Math.floor(h / 2)],
  ];
  const regionSize = 4;
  const regionAvgs = [];
  for (const [cx, cy] of regions) {
    let rr = 0, rg = 0, rb = 0, n = 0;
    for (let dx = -regionSize; dx <= regionSize; dx++) {
      for (let dy = -regionSize; dy <= regionSize; dy++) {
        const i = ((cy + dy) * w + (cx + dx)) * 4;
        if (i >= 0 && i + 2 < d.length) {
          rr += d[i]; rg += d[i + 1]; rb += d[i + 2];
          n++;
        }
      }
    }
    if (n > 0) regionAvgs.push({ r: rr / n, g: rg / n, b: rb / n });
  }

  // Use median of region averages to reject outlier regions (e.g. hair in a corner)
  const sortedByBrightness = regionAvgs.map(a => a.r + a.g + a.b).sort((a, b) => a - b);
  const medianBrightness = sortedByBrightness[Math.floor(sortedByBrightness.length / 2)];
  const filtered = regionAvgs.filter(a => {
    const brightness = a.r + a.g + a.b;
    return Math.abs(brightness - medianBrightness) < 180;
  });
  const regionsToUse = filtered.length >= 3 ? filtered : regionAvgs;

  let sr = 0, sg = 0, sb = 0;
  for (const a of regionsToUse) { sr += a.r; sg += a.g; sb += a.b; }
  sr /= regionsToUse.length; sg /= regionsToUse.length; sb /= regionsToUse.length;

  // Variance from filtered regions
  let variance = 0;
  for (const a of regionsToUse) {
    variance += (a.r - sr) ** 2 + (a.g - sg) ** 2 + (a.b - sb) ** 2;
  }
  variance /= regionsToUse.length;
  const tolerance = Math.max(Math.sqrt(variance) * 2.2, 36);

  // Remove pixels similar to background
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - sr, dg = d[i + 1] - sg, db = d[i + 2] - sb;
    if (dr * dr + dg * dg + db * db < tolerance * tolerance) d[i + 3] = 0;
  }

  featherMask();
  updatePreview();
  brushHint.textContent = '背景已自动处理，不满意可用笔刷微调';
  btnDownload.disabled = false;
});

btnBrush.addEventListener('click', () => {
  if (!cropBox) return;
  ensureMask();
  brushActive = !brushActive;
  btnBrush.classList.toggle('active', brushActive);
  if (brushActive) {
    brushHint.textContent = '在照片上涂抹要移除的背景区域，松开停止';
    mainCanvas.style.cursor = 'crosshair';
  } else {
    brushHint.textContent = '已停止擦除，可继续处理';
    mainCanvas.style.cursor = 'default';
  }
});

btnResetBg.addEventListener('click', () => {
  maskData = null;
  brushActive = false;
  btnBrush.classList.remove('active');
  brushHint.textContent = '点击「自动去背景」或「手动擦除」开始处理背景';
  updatePreview();
  drawScene();
});

function featherMask() {
  if (!maskData) return;
  const w = maskData.width, h = maskData.height;
  const d = maskData.data;
  const copy = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          sum += copy[((y + dy) * w + (x + dx)) * 4 + 3];
      d[idx + 3] = Math.round(sum / 9);
    }
  }
}

// ——— Preview ———
function updatePreview() {
  if (!image || !cropBox) return;
  const [ow, oh] = sizeSelect.value.split(',').map(Number);
  outputW = ow; outputH = oh;

  previewCanvas.width = outputW;
  previewCanvas.height = outputH;

  pctx.fillStyle = bgColor;
  pctx.fillRect(0, 0, outputW, outputH);

  if (maskData) {
    // Use stored maskData directly — it already contains the cropped
    // image RGB plus the modified alpha, no need to re-draw the image.
    const src = document.createElement('canvas');
    src.width = maskData.width;
    src.height = maskData.height;
    src.getContext('2d').putImageData(maskData, 0, 0);
    pctx.drawImage(src, 0, 0, outputW, outputH);
  } else {
    const sx = (cropBox.x - imgX) / imgW * image.width;
    const sy = (cropBox.y - imgY) / imgH * image.height;
    const sw = cropBox.w / imgW * image.width;
    const sh = cropBox.h / imgH * image.height;
    if (sw > 0 && sh > 0 && sx >= 0 && sy >= 0) {
      pctx.drawImage(image, sx, sy, sw, sh, 0, 0, outputW, outputH);
    }
  }

  btnDownload.disabled = false;
}

// ——— Controls ———
sizeSelect.addEventListener('change', updatePreview);

document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    bgColor = btn.dataset.color;
    customColor.value = bgColor;
    updatePreview();
  });
});

customColor.addEventListener('input', () => {
  bgColor = customColor.value;
  document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
  updatePreview();
});

brushSize.addEventListener('input', () => {
  brushSizeVal.textContent = brushSize.value + 'px';
});

btnDownload.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `证件照_${outputW}x${outputH}.png`;
  link.href = previewCanvas.toDataURL('image/png');
  link.click();
});
