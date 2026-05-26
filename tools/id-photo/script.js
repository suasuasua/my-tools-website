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

  // Sample 4 corners, each 9×9, compute per-corner average
  const margin = Math.min(Math.floor(Math.min(w, h) * 0.05), 16);
  const corners = [
    [margin, margin], [w - 1 - margin, margin],
    [margin, h - 1 - margin], [w - 1 - margin, h - 1 - margin],
  ];
  const cornerAvgs = [];
  for (const [cx, cy] of corners) {
    let rr = 0, rg = 0, rb = 0, n = 0;
    for (let dx = -4; dx <= 4; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        const px = cx + dx, py = cy + dy;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const i = (py * w + px) * 4;
        rr += d[i]; rg += d[i + 1]; rb += d[i + 2];
        n++;
      }
    }
    cornerAvgs.push({ r: rr / n, g: rg / n, b: rb / n });
  }

  // Build a background cluster: corners that have at least one "buddy"
  // within similarity threshold (agree on background color).
  const SIMILAR = 50;
  const bgCluster = [];
  for (let i = 0; i < cornerAvgs.length; i++) {
    let buddies = 0;
    for (let j = 0; j < cornerAvgs.length; j++) {
      if (i === j) continue;
      const dr = cornerAvgs[i].r - cornerAvgs[j].r;
      const dg = cornerAvgs[i].g - cornerAvgs[j].g;
      const db = cornerAvgs[i].b - cornerAvgs[j].b;
      if (dr * dr + dg * dg + db * db < SIMILAR * SIMILAR) buddies++;
    }
    if (buddies >= 1) bgCluster.push(cornerAvgs[i]);
  }
  const regionsToUse = bgCluster.length >= 2 ? bgCluster : cornerAvgs;

  let sr = 0, sg = 0, sb = 0;
  for (const a of regionsToUse) { sr += a.r; sg += a.g; sb += a.b; }
  sr /= regionsToUse.length; sg /= regionsToUse.length; sb /= regionsToUse.length;

  // Variance across the background cluster
  let variance = 0;
  for (const a of regionsToUse) {
    variance += (a.r - sr) ** 2 + (a.g - sg) ** 2 + (a.b - sb) ** 2;
  }
  variance /= regionsToUse.length;
  const tolerance = Math.max(Math.sqrt(variance) * 2.5, 45);

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
    // Direct pixel compositing: blend cropped image (with mask alpha) over bg color.
    // Avoids intermediate canvas / drawImage issues entirely.
    const mw = maskData.width, mh = maskData.height;
    const md = maskData.data;
    const bgR = parseInt(bgColor.slice(1, 3), 16);
    const bgG = parseInt(bgColor.slice(3, 5), 16);
    const bgB = parseInt(bgColor.slice(5, 7), 16);

    const outData = pctx.createImageData(outputW, outputH);
    const od = outData.data;
    const scaleX = mw / outputW;
    const scaleY = mh / outputH;

    for (let dy = 0; dy < outputH; dy++) {
      const sy = Math.min(Math.floor(dy * scaleY), mh - 1);
      const srcRow = sy * mw;
      for (let dx = 0; dx < outputW; dx++) {
        const sx = Math.min(Math.floor(dx * scaleX), mw - 1);
        const si = (srcRow + sx) * 4;
        const di = (dy * outputW + dx) * 4;
        const a = md[si + 3] / 255;
        od[di]     = md[si] * a + bgR * (1 - a);
        od[di + 1] = md[si + 1] * a + bgG * (1 - a);
        od[di + 2] = md[si + 2] * a + bgB * (1 - a);
        od[di + 3] = 255;
      }
    }
    pctx.putImageData(outData, 0, 0);
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
