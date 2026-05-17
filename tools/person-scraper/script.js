// —— DOM refs ——
const photoZone = document.getElementById('photoZone');
const photoPlaceholder = document.getElementById('photoPlaceholder');
const photoPreview = document.getElementById('photoPreview');
const btnRemovePhoto = document.getElementById('btnRemovePhoto');
const photoInput = document.getElementById('photoInput');
const ocrResult = document.getElementById('ocrResult');
const ocrTextEl = document.getElementById('ocrText');
const inputName = document.getElementById('inputName');
const inputHometown = document.getElementById('inputHometown');
const toggleAI = document.getElementById('toggleAI');
const btnSearch = document.getElementById('btnSearch');
const resultsPlaceholder = document.getElementById('resultsPlaceholder');
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const btnRetry = document.getElementById('btnRetry');
const resultsContent = document.getElementById('resultsContent');
const summaryCard = document.getElementById('summaryCard');
const summaryBody = document.getElementById('summaryBody');
const tabBar = document.getElementById('tabBar');
const resultList = document.getElementById('resultList');
const stepAI = document.getElementById('stepAI');
const btnDownloadMD = document.getElementById('btnDownloadMD');
const btnPrint = document.getElementById('btnPrint');
const btnCopySummary = document.getElementById('btnCopySummary');

// —— State ——
let photoFile = null;
let ocrText = '';
let searchData = null;
let activeTab = 'all';

// —— Worker URL ——
// Replace with your Cloudflare Worker URL after deployment
const WORKER_URL = 'https://person-scraper.suasua.workers.dev';

// —— Photo upload ——
photoPlaceholder.addEventListener('click', () => photoInput.click());
photoZone.addEventListener('click', (e) => {
  if (e.target === photoZone) photoInput.click();
});

photoInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handlePhoto(e.target.files[0]);
});

photoZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  photoZone.classList.add('drag-over');
});
photoZone.addEventListener('dragleave', () => {
  photoZone.classList.remove('drag-over');
});
photoZone.addEventListener('drop', (e) => {
  e.preventDefault();
  photoZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handlePhoto(file);
});

function handlePhoto(file) {
  photoFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    photoPreview.src = e.target.result;
    photoPlaceholder.style.display = 'none';
    photoPreview.style.display = 'block';
    btnRemovePhoto.style.display = 'flex';
    runOCR(file);
  };
  reader.readAsDataURL(file);
}

btnRemovePhoto.addEventListener('click', (e) => {
  e.stopPropagation();
  photoFile = null;
  ocrText = '';
  photoPreview.src = '';
  photoPreview.style.display = 'none';
  btnRemovePhoto.style.display = 'none';
  photoPlaceholder.style.display = '';
  ocrResult.style.display = 'none';
  photoInput.value = '';
});

// —— OCR via Tesseract.js ——
async function runOCR(file) {
  ocrResult.style.display = 'block';
  ocrTextEl.textContent = '正在识别文字...';
  ocrResult.style.background = '#fefce8';
  ocrResult.style.borderColor = '#fef08a';

  try {
    // Dynamic import Tesseract from CDN
    if (typeof Tesseract === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load Tesseract'));
        document.head.appendChild(script);
      });
    }

    const { data } = await Tesseract.recognize(file, 'chi_sim+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          ocrTextEl.textContent = `识别中... ${Math.round(m.progress * 100)}%`;
        }
      },
    });

    const text = data.text.trim();
    if (text) {
      ocrText = text.slice(0, 200);
      ocrTextEl.textContent = ocrText;
      ocrResult.style.background = '#f0fdf4';
      ocrResult.style.borderColor = '#bbf7d0';
    } else {
      ocrText = '';
      ocrTextEl.textContent = '未识别到文字';
      ocrResult.style.background = '#fefce8';
      ocrResult.style.borderColor = '#fef08a';
    }
  } catch (err) {
    ocrText = '';
    ocrTextEl.textContent = 'OCR 暂不可用，将仅用文本搜索';
    ocrResult.style.background = '#fef2f2';
    ocrResult.style.borderColor = '#fecaca';
  }
}

// —— Image compression for visual search ——
function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 1024;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = URL.createObjectURL(file);
  });
}

// —— Search ——
btnSearch.addEventListener('click', doSearch);
inputName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

async function doSearch() {
  const name = inputName.value.trim();
  const hometown = inputHometown.value.trim();

  if (!name && !hometown && !ocrText && !photoFile) {
    inputHometown.focus();
    inputHometown.style.borderColor = '#ef4444';
    setTimeout(() => { inputHometown.style.borderColor = ''; }, 1500);
    return;
  }

  const useAI = toggleAI.checked;

  // Show loading
  resultsPlaceholder.style.display = 'none';
  resultsContent.style.display = 'none';
  errorState.style.display = 'none';
  loadingState.style.display = 'block';
  btnSearch.disabled = true;

  stepAI.style.display = useAI ? 'flex' : 'none';

  // Progress simulation
  const steps = document.querySelectorAll('.progress-steps .step');
  steps.forEach((s) => s.classList.remove('active', 'done', 'error'));
  const simulateProgress = startSimulatedProgress(steps, useAI);

  try {
    // Compress image for visual search
    let imageBase64 = '';
    if (photoFile) {
      imageBase64 = await compressImage(photoFile);
    }

    const response = await fetch(`${WORKER_URL}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, hometown, ocrText, imageBase64, useAI }),
    });

    clearInterval(simulateProgress);
    const data = await response.json();

    if (!data.success) {
      showError(data.error || '搜索失败，请稍后重试');
      return;
    }

    if (data.errors.length > 0 && data.results.length === 0) {
      showError('所有数据源都未能返回结果，请尝试更换姓名或稍后重试');
      return;
    }

    searchData = data;
    markStepsComplete(steps, useAI, data.errors);
    renderResults(data);
    resultsContent.style.display = 'block';
    loadingState.style.display = 'none';
  } catch (err) {
    clearInterval(simulateProgress);
    showError(err.message === 'Failed to fetch'
      ? '无法连接到搜索服务，请检查网络或服务配置'
      : `搜索出错: ${err.message}`);
  } finally {
    btnSearch.disabled = false;
  }
}

function startSimulatedProgress(steps, hasAI) {
  const activeSteps = hasAI ? 6 : 5;
  let current = 0;
  steps[current].classList.add('active');

  return setInterval(() => {
    steps[current].classList.remove('active');
    steps[current].classList.add('done');
    current++;
    if (current < activeSteps) {
      steps[current].classList.add('active');
    }
  }, 800);
}

function markStepsComplete(steps, hasAI, errors) {
  const errorSources = errors.map((e) => {
    const src = e.split(':')[0].trim();
    if (src === 'wikipedia') return 'wikipedia';
    if (src === 'baidu_baike') return 'baidu';
    if (src === 'tavily') return 'tavily';
    if (src === 'visual') return 'visual';
    return '';
  }).filter(Boolean);

  steps.forEach((s) => {
    s.classList.remove('active', 'done', 'error');
    const ds = s.dataset.step;
    if (ds === 'ai' && !hasAI) return;
    if (errorSources.includes(ds)) {
      s.classList.add('error');
      s.querySelector('.step-label').textContent = s.querySelector('.step-label').textContent + ' (超时)';
    } else {
      s.classList.add('done');
    }
  });
}

function showError(msg) {
  loadingState.style.display = 'none';
  resultsContent.style.display = 'none';
  errorMessage.textContent = msg;
  errorState.style.display = 'block';
}

btnRetry.addEventListener('click', doSearch);

// —— Render results ——
function renderResults(data) {
  // Summary
  if (data.summary) {
    summaryCard.style.display = 'block';
    summaryBody.innerHTML = renderMarkdown(data.summary);
  } else {
    summaryCard.style.display = 'none';
  }

  // Tabs
  const tabs = [{ key: 'all', label: '全部', count: data.results.length }];
  for (const [source, count] of Object.entries(data.sourceStats)) {
    if (count > 0) {
      tabs.push({ key: source, label: sourceLabel(source), count });
    }
  }
  tabBar.innerHTML = tabs.map((t) =>
    `<button class="tab${t.key === activeTab ? ' active' : ''}" data-source="${t.key}">${t.label}<span class="count">${t.count}</span></button>`
  ).join('');

  tabBar.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.source;
      tabBar.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      filterResults();
    });
  });

  // Error banner
  if (data.errors.length > 0) {
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.style.cssText = 'padding:8px 12px; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; font-size:0.8rem; color:#991b1b; margin-bottom:12px;';
    banner.textContent = `部分数据源未能获取：${data.errors.map((e) => e.split(':')[0]).join('、')}`;
    resultList.before(banner);
  }

  renderResultCards(data.results);
}

function sourceLabel(source) {
  const map = {
    tavily: 'Tavily 搜索',
    wikipedia: '维基百科',
    baidu_baike: '百度百科',
    duckduckgo: 'DuckDuckGo',
    visual: '图片匹配',
  };
  return map[source] || source;
}

function renderResultCards(results) {
  resultList.innerHTML = results.map((r) => `
    <div class="result-card" data-source="${r.source}">
      <div class="result-card-header">
        <span class="source-badge source-${r.source}">${sourceLabel(r.source)}</span>
        <span class="result-title">
          <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>
        </span>
      </div>
      <div class="result-snippet">${escapeHtml(r.snippet)}</div>
      ${r.snippet.length > 200 ? '<button class="btn-expand">展开全文</button>' : ''}
      ${r.metadata?.baiduBaikeInfoBox ? renderInfoBox(r.metadata.baiduBaikeInfoBox) : ''}
      <div class="result-card-footer">
        <span class="result-url">${escapeHtml(r.url)}</span>
      </div>
    </div>
  `).join('');

  // Expand/collapse
  resultList.querySelectorAll('.btn-expand').forEach((btn) => {
    btn.addEventListener('click', () => {
      const snippet = btn.parentElement.querySelector('.result-snippet');
      const isExpanded = snippet.classList.toggle('expanded');
      btn.textContent = isExpanded ? '收起' : '展开全文';
    });
  });

  // Card click to open URL
  resultList.querySelectorAll('.result-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-expand')) return;
      const link = card.querySelector('a');
      if (link) window.open(link.href, '_blank', 'noopener');
    });
  });
}

function renderInfoBox(infoBox) {
  const rows = Object.entries(infoBox).map(([k, v]) =>
    `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`
  ).join('');
  return `<table class="info-box-table">${rows}</table>`;
}

function filterResults() {
  const cards = resultList.querySelectorAll('.result-card');
  cards.forEach((card) => {
    card.style.display = (activeTab === 'all' || card.dataset.source === activeTab) ? '' : 'none';
  });
}

// —— Markdown generation ——
function generateMarkdown() {
  if (!searchData) return '';
  const name = inputName.value.trim();
  const hometown = inputHometown.value.trim();
  const now = new Date().toLocaleString('zh-CN');

  let md = `# 人物信息: ${name}\n\n`;
  md += `> 搜索时间: ${now}  \n`;
  if (hometown) md += `> 籍贯/关键词: ${hometown}  \n`;
  md += `> 搜索词: ${searchData.query}  \n\n`;

  if (searchData.summary) {
    md += `## AI 摘要\n\n${searchData.summary}\n\n`;
  }

  md += `## 搜索结果 (共 ${searchData.results.length} 条)\n\n`;

  // Group by source
  const grouped = {};
  for (const r of searchData.results) {
    (grouped[r.source] || (grouped[r.source] = [])).push(r);
  }

  for (const [source, results] of Object.entries(grouped)) {
    md += `### ${sourceLabel(source)}\n\n`;
    for (const r of results) {
      md += `- **[${r.title}](${r.url})**  \n`;
      md += `  ${r.snippet.replace(/\n/g, ' ')}\n`;
      if (r.metadata?.baiduBaikeInfoBox) {
        md += `  \n`;
        for (const [k, v] of Object.entries(r.metadata.baiduBaikeInfoBox)) {
          md += `  - ${k}: ${v}\n`;
        }
      }
      md += `\n`;
    }
  }

  if (searchData.errors.length > 0) {
    md += `---\n\n*未能获取的数据源: ${searchData.errors.join('、')}*\n`;
  }

  md += `\n---\n\n*由 [工具集](https://suasuasua.github.io/my-tools-website/) 自动生成*\n`;
  return md;
}

btnDownloadMD.addEventListener('click', () => {
  if (!searchData) return;
  const name = inputName.value.trim() || '人物信息';
  const md = generateMarkdown();
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}_信息汇总_${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
});

// —— Print / PDF ——
btnPrint.addEventListener('click', () => {
  if (!searchData) return;
  const name = inputName.value.trim() || '人物信息';
  const md = generateMarkdown();
  const html = renderMarkdown(md);

  const printWindow = window.open('', '_blank', 'width=800,height=600');
  printWindow.document.write(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${name} - 人物信息</title>
  <style>
    body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; line-height: 1.8; color: #1d1d1f; }
    h1 { border-bottom: 2px solid #4f46e5; padding-bottom: 12px; }
    h2 { margin-top: 24px; color: #4f46e5; }
    h3 { color: #666; font-size: 1rem; margin-top: 16px; }
    a { color: #4f46e5; }
    ul, ol { padding-left: 20px; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0; }
    td { padding: 6px 10px; border: 1px solid #e5e7eb; font-size: 0.9rem; }
    td:first-child { background: #f5f5f7; font-weight: 500; width: 30%; }
    blockquote { border-left: 3px solid #e5e7eb; padding-left: 16px; color: #666; margin: 16px 0; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>${html}</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); }, 500);
});

// —— Copy summary ——
btnCopySummary.addEventListener('click', async () => {
  if (!searchData?.summary) return;
  try {
    await navigator.clipboard.writeText(searchData.summary);
    const orig = btnCopySummary.textContent;
    btnCopySummary.textContent = '✅ 已复制';
    setTimeout(() => { btnCopySummary.textContent = orig; }, 1500);
  } catch {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = searchData.summary;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btnCopySummary.textContent = '✅';
    setTimeout(() => { btnCopySummary.textContent = '📋'; }, 1500);
  }
});

// —— Helpers ——
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderMarkdown(md) {
  // Simple markdown to HTML converter
  let html = md;
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // Blockquote
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');
  // Paragraphs (double newlines)
  const parts = html.split('\n\n');
  html = parts.map((p) => {
    if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<blockquote') || p.startsWith('<hr') || p.startsWith('<table')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}
