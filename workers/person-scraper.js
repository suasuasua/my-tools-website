// Person Info Scraper — Cloudflare Worker backend
// POST /api/search  { name, hometown, ocrText?, useAI? }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status, extraHeaders) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS,
      ...extraHeaders,
    },
  });
}

// ——— Source 1: Tavily Search API ———
async function searchTavily(query, apiKey) {
  if (!apiKey) return { source: 'tavily', results: [], error: 'TAVILY_API_KEY not configured' };
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        include_answer: true,
        include_images: false,
        max_results: 12,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { source: 'tavily', results: [], error: `Tavily returned ${res.status}: ${errText.slice(0, 100)}` };
    }
    const data = await res.json();
    const results = [];
    if (data.answer) {
      results.push({
        title: query,
        url: data.results?.[0]?.url || '',
        snippet: data.answer.slice(0, 800),
        source: 'tavily',
        relevanceScore: 0.95,
      });
    }
    for (const r of data.results || []) {
      results.push({
        title: r.title,
        url: r.url,
        snippet: (r.content || r.raw_content || '').slice(0, 600),
        source: 'tavily',
        relevanceScore: Math.max(0.3, (r.score || 0.5) * 0.8),
      });
    }
    return { source: 'tavily', results };
  } catch {
    return { source: 'tavily', results: [], error: 'Tavily fetch failed' };
  }
}

// ——— Source 2: Wikipedia (Chinese) ———
const WIKI_HEADERS = { 'User-Agent': 'PersonInfoScraper/1.0 (https://github.com/suasuasua; tools@example.com)' };

async function searchWikipedia(name) {
  try {
    // Try zh Wikipedia first, fall back to en
    for (const lang of ['zh', 'en']) {
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=5`;
      const searchRes = await fetch(searchUrl, { headers: WIKI_HEADERS, signal: AbortSignal.timeout(5000) });
      if (!searchRes.ok) continue;
      const searchData = await searchRes.json();
      const pages = searchData.query?.search || [];
      if (pages.length === 0) continue;

      const pageIds = pages.slice(0, 3).map((p) => p.pageid).join('|');
      const extractUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=1&explaintext=1&inprop=url&pageids=${pageIds}&format=json`;
      const extractRes = await fetch(extractUrl, { headers: WIKI_HEADERS, signal: AbortSignal.timeout(5000) });
      const extractData = await extractRes.json();
      const extracts = extractData.query?.pages || {};

      const results = [];
      for (const p of pages.slice(0, 3)) {
        const detail = extracts[p.pageid] || {};
        const snippet = (detail.extract || p.snippet || '').replace(/<[^>]+>/g, '').slice(0, 600);
        if (!snippet) continue;
        results.push({
          title: p.title,
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
          snippet,
          source: 'wikipedia',
          relevanceScore: 0.8,
          metadata: { wikiPageId: p.pageid },
        });
      }
      if (results.length > 0) return { source: 'wikipedia', results };
    }
    return { source: 'wikipedia', results: [] };
  } catch {
    return { source: 'wikipedia', results: [], error: 'Wikipedia fetch failed' };
  }
}

// ——— Source 3: Baidu Baike ———
async function scrapeBaiduBaike(name) {
  try {
    const url = `https://baike.baidu.com/item/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { source: 'baidu_baike', results: [], error: `Baidu Baike returned ${res.status}` };
    // Check if redirected to error/search page
    if (res.url.includes('/error') || res.url.includes('/search')) {
      return { source: 'baidu_baike', results: [], error: 'Baidu Baike page not found' };
    }

    const buffer = await res.arrayBuffer();
    const ct = res.headers.get('Content-Type') || '';
    const m = ct.match(/charset=([^;]+)/);
    const charset = m ? m[1].toLowerCase() : 'utf-8';
    const html = charset.includes('gb') ? new TextDecoder('gbk').decode(buffer) : new TextDecoder('utf-8').decode(buffer);

    // Extract summary — try multiple patterns
    let snippet = '';
    const summaryPatterns = [
      /<div[^>]*class="[^"]*lemma-summary[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<meta[^>]*name="description"[^>]*content="([^"]+)"/i,
    ];
    for (const pattern of summaryPatterns) {
      const match = html.match(pattern);
      if (match) {
        snippet = match[1].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800);
        break;
      }
    }

    // Extract info box — try multiple class patterns
    const infoBox = {};
    const dtDdRegexes = [
      /<dt[^>]*class="[^"]*(?:basicInfo-item|basicInfo)[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*class="[^"]*(?:basicInfo-item|basicInfo)[^"]*value[^"]*"[^>]*>([\s\S]*?)<\/dd>/gi,
      /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi,
    ];

    for (const regex of dtDdRegexes) {
      let m;
      while ((m = regex.exec(html)) !== null) {
        const key = m[1].replace(/<[^>]+>/g, '').trim();
        const val = m[2].replace(/<[^>]+>/g, '').trim().replace(/&[a-z]+;/g, ' ');
        if (key && val && key.length < 20 && val.length < 200) {
          infoBox[key] = val;
        }
      }
      if (Object.keys(infoBox).length >= 3) break;
    }

    if (!snippet && Object.keys(infoBox).length === 0) {
      return { source: 'baidu_baike', results: [], error: 'No content found on Baidu Baike' };
    }

    return {
      source: 'baidu_baike',
      results: [{
        title: `${name} - 百度百科`,
        url,
        snippet: snippet || Object.entries(infoBox).map(([k, v]) => `${k}: ${v}`).join('; '),
        source: 'baidu_baike',
        relevanceScore: 0.9,
        metadata: { baiduBaikeInfoBox: infoBox },
      }],
    };
  } catch {
    return { source: 'baidu_baike', results: [], error: 'Baidu Baike fetch failed' };
  }
}

// ——— Source 4: DuckDuckGo ———
async function searchDuckDuckGo(name) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(name)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { source: 'duckduckgo', results: [], error: `DuckDuckGo returned ${res.status}` };
    const data = await res.json();
    const results = [];
    if (data.Abstract) {
      results.push({
        title: data.Heading || name,
        url: data.AbstractURL || '',
        snippet: data.Abstract.slice(0, 600),
        source: 'duckduckgo',
        relevanceScore: 0.6,
      });
    }
    for (const topic of data.RelatedTopics || []) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 60),
          url: topic.FirstURL,
          snippet: topic.Text.slice(0, 400),
          source: 'duckduckgo',
          relevanceScore: 0.4,
        });
      }
    }
    return { source: 'duckduckgo', results: results.slice(0, 10) };
  } catch {
    return { source: 'duckduckgo', results: [], error: 'DuckDuckGo fetch failed' };
  }
}

// ——— Source 5: Photo-to-keywords (OCR-enhanced search) ———
// Photos are used for OCR text extraction (done client-side).
// Extracted keywords are added to the main search query for better results.
// Reverse image search is not feasible for free — it requires paid APIs
// (Bing Visual Search, PimEyes, etc.) or JS-rendered pages that can't be scraped.
async function searchByPhotoKeywords(ocrText) {
  if (!ocrText) return { source: 'photo_ocr', results: [], error: 'No OCR text' };
  // The OCR text is already included in the main Tavily/Wikipedia/Baidu queries.
  // This source just reports that OCR keywords were used.
  return {
    source: 'photo_ocr',
    results: [{
      title: '照片 OCR 识别关键词',
      url: '',
      snippet: `已从照片中提取关键词用于搜索: ${ocrText.slice(0, 200)}`,
      source: 'photo_ocr',
      relevanceScore: 0.1,
    }],
  };
}

// ——— Deduplication ———
function normalizeURL(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch { return url; }
}

function normalizeTitle(t) {
  return t.toLowerCase().replace(/[^\w一-鿿]+/g, '').trim();
}

function deduplicateResults(allResults) {
  const seen = new Set();
  const deduped = [];

  for (const r of allResults) {
    const urlKey = normalizeURL(r.url);
    const titleKey = normalizeTitle(r.title);
    const combinedKey = `${urlKey}|${titleKey}`;
    if (seen.has(combinedKey)) continue;
    seen.add(combinedKey);

    // Merge with existing if title is very similar
    const existing = deduped.find((d) => {
      if (d.source !== r.source) return false;
      const dt = normalizeTitle(d.title);
      const rt = normalizeTitle(r.title);
      if (dt === rt) return true;
      if (dt.includes(rt) || rt.includes(dt)) return true;
      return false;
    });

    if (existing) {
      if (r.snippet.length > existing.snippet.length) {
        existing.snippet = r.snippet;
        existing.url = r.url;
      }
      if (r.metadata) Object.assign(existing.metadata || (existing.metadata = {}), r.metadata);
    } else {
      deduped.push(r);
    }
  }

  // Sort by relevance
  deduped.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  return deduped;
}

// ——— AI Summary (DeepSeek) ———
async function generateSummary(results, name, hometown, apiKey) {
  if (!apiKey) return null;
  try {
    const context = results.slice(0, 10).map((r, i) =>
      `[${i + 1}] 来源: ${r.source}\n标题: ${r.title}\n内容: ${r.snippet}`
    ).join('\n\n');

    const prompt = `你是一个信息整理助手。请根据以下关于"${name}"${hometown ? `（籍贯：${hometown}）` : ''}的搜索结果，用中文撰写一份全面的人物简介。

要求：
1. 包含基本信息（姓名、籍贯、职业等）
2. 总结主要经历和成就
3. 整理相关新闻报道要点
4. 如果有社交媒体信息，简要提及公众形象
5. 用第三人称客观叙述
6. 标注信息来源
7. 控制在800字以内

以下是搜索结果：
${context}

请输出markdown格式的人物简介。`;

    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是一个专业的信息整理助手，擅长根据搜索结果撰写客观、全面的人物简介。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1200,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

// ——— Main handler ———
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/search' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ success: false, error: 'Invalid JSON body' }, 400);
      }

      const { name, hometown, ocrText, imageBase64, useAI } = body;
      const nameStr = (name || '').trim();
      const hometownStr = (hometown || '').trim();
      const ocrStr = (ocrText || '').trim();
      const imgStr = (imageBase64 || '').trim();

      if (!nameStr && !hometownStr && !ocrStr && !imgStr) {
        return json({ success: false, error: '请至少填写姓名、籍贯或上传照片' }, 400);
      }

      const searchName = nameStr || ocrStr || hometownStr;
      const queries = {
        main: [nameStr, hometownStr, ocrStr, '个人资料', '简介'].filter(Boolean).join(' '),
        name: searchName || '未知',
      };

      // Parallel fetch all sources (including visual search if image provided)
      const [tavily, wiki, baidu, ddg, visual] = await Promise.allSettled([
        searchTavily(queries.main, env.TAVILY_API_KEY),
        searchWikipedia(queries.name),
        scrapeBaiduBaike(queries.name),
        searchDuckDuckGo(queries.name),
        searchByPhotoKeywords(ocrStr),
      ]);

      const sources = [tavily, wiki, baidu, ddg, visual].map((s) =>
        s.status === 'fulfilled' ? s.value : { source: 'unknown', results: [], error: s.reason?.message }
      );

      const allResults = sources.flatMap((s) => s.results);
      const deduped = deduplicateResults(allResults);
      const errors = sources.filter((s) => s.error).map((s) => `${s.source}: ${s.error}`);
      const sourceStats = {};
      for (const s of sources) {
        sourceStats[s.source] = s.results.length;
      }

      let summary = null;
      if (useAI && deduped.length > 0) {
        summary = await generateSummary(deduped, queries.name, hometown, env.DEEPSEEK_API_KEY);
      }

      return json({
        success: true,
        query: queries.main,
        summary,
        results: deduped,
        sourceStats,
        errors,
      }, 200, { 'Cache-Control': 'public, max-age=3600' });
    }

    return json({ success: false, error: 'Not Found' }, 404);
  },
};
